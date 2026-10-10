import { Immer, type Patch } from 'immer'

// The document's immutability without whole-column costs (roadmap 34e, decision 401). Immer's
// automatic freezing deep-freezes every new part of the document, and V8 stores a frozen array of
// doubles as boxed numbers: freezing a table of a million rows took seconds and tripled its
// memory. So the store's Immer doesn't freeze; `freezeDoc` freezes the document itself, leaving
// out large arrays (a table's per-row cells, which nothing writes in place: edits copy them), and
// patches are applied by `applyDocPatches`, which copies only along their paths (Immer's
// `applyPatches` deep-copies every value it inserts, a whole table when redoing its import).

/** The store's Immer: patches on, no automatic freezing (see `freezeDoc`). */
export const docImmer = new Immer({ autoFreeze: false })
docImmer.setUseStrictShallowCopy(false)

/** Arrays at least this long (a table's per-row cells) are left unfrozen. */
export const BIG_ARRAY = 10_000

/**
 * Freezes the document's new parts in place: every object and array not frozen yet, except
 * arrays of `BIG_ARRAY` elements or more (and what they hold). A frozen object's parts were frozen
 * with it, so the walk stops there: after an edit it visits only the copies the edit made.
 */
export function freezeDoc<T>(value: T): T {
  freezeWalk(value)
  return value
}

function freezeWalk(v: unknown): void {
  if (v === null || typeof v !== 'object' || Object.isFrozen(v)) return
  if (Array.isArray(v)) {
    if (v.length >= BIG_ARRAY) return
    Object.freeze(v)
    for (let i = 0; i < v.length; i++) freezeWalk(v[i])
    return
  }
  Object.freeze(v)
  for (const k in v) freezeWalk((v as Record<string, unknown>)[k])
}

type Container = Record<string | number, unknown> | unknown[]

/**
 * Audit 2 (M1): rows taken out of, or put into, a large array (a table's per-row cells) without
 * holding the whole array. `runs` are [start, length] pairs, ascending: for `removeRows`, indices
 * in the array before; for `insertRows`, indices in the array after, filled from `values` in order
 * (or every one with `fill`).
 */
export type RowsPatch =
  | { op: 'removeRows'; path: (string | number)[]; runs: [number, number][] }
  | {
      op: 'insertRows'
      path: (string | number)[]
      runs: [number, number][]
      values?: unknown[]
      fill?: unknown
    }

/** A patch of the document's history: Immer's, or rows of a large array. */
export type DocPatch = Patch | RowsPatch

/**
 * The elements of `long` that are not in `short`, when `short` is `long` with some elements taken
 * out (greedy matching finds such an embedding whenever there is one): their runs in `long` and
 * values. Null when `short` is not such a subsequence.
 */
function takenOut(
  long: readonly unknown[],
  short: readonly unknown[],
): { runs: [number, number][]; values: unknown[] } | null {
  const extra = long.length - short.length
  if (extra <= 0) return null
  const runs: [number, number][] = []
  const values: unknown[] = []
  let j = 0
  for (let i = 0; i < long.length; i++) {
    if (j < short.length && Object.is(long[i], short[j])) {
      j++
      continue
    }
    if (values.length === extra) return null
    values.push(long[i])
    const last = runs.at(-1)
    if (last && last[0] + last[1] === i) last[1]++
    else runs.push([i, 1])
  }
  return j === short.length ? { runs, values } : null
}

/**
 * Runs at most this many are taken out of a copy by splicing: a copy and a few moves of the
 * elements after a run take about half the time of copying the elements one by one (audit 2, M2).
 */
const SPLICED_RUNS = 8

/** `arr` without the elements in `runs` (ascending [start, length] pairs, indices of `arr`). */
export function withoutRuns<T>(arr: readonly T[], runs: readonly [number, number][]): T[] {
  if (runs.length <= SPLICED_RUNS) {
    const out = arr.slice()
    for (let r = runs.length - 1; r >= 0; r--) out.splice(runs[r]![0], runs[r]![1])
    return out
  }
  let gone = 0
  for (const [, n] of runs) gone += n
  const out = new Array(arr.length - gone)
  let k = 0
  let i = 0
  for (const [start, n] of runs) {
    while (i < start) out[k++] = arr[i++]
    i += n
  }
  while (i < arr.length) out[k++] = arr[i++]
  return out
}

/**
 * `arr` with elements put in at `runs` (ascending [start, length] pairs, indices of the result),
 * from `values` in order or every one `fill`.
 */
export function withRuns<T>(
  arr: readonly T[],
  runs: readonly [number, number][],
  values: readonly T[] | undefined,
  fill?: T,
): T[] {
  // One pass (a copy grown by splicing is copied again).
  let added = 0
  for (const [, n] of runs) added += n
  const out = new Array(arr.length + added)
  let k = 0
  let i = 0
  let v = 0
  for (const [start, n] of runs) {
    while (k < start) out[k++] = arr[i++]
    for (let c = 0; c < n; c++) out[k++] = values ? values[v++] : fill
  }
  while (i < arr.length) out[k++] = arr[i++]
  return out
}

const pathKey = (path: readonly (string | number)[]) => path.join('\u0000')

/**
 * Patches of row inserts and deletes made compact (audit 2, M1): a large array (`BIG_ARRAY` or
 * more elements) replaced by itself with elements taken out or put in is held as the rows that
 * changed (`RowsPatch`) both ways, not as the arrays before and after. Other patches stay.
 */
export function compactRowPatches(
  patches: readonly Patch[],
  inverse: readonly Patch[],
): [DocPatch[], DocPatch[]] {
  const before = new Map<string, number>()
  inverse.forEach((q, i) => {
    if (q.op === 'replace' && Array.isArray(q.value)) before.set(pathKey(q.path), i)
  })
  if (!before.size) return [patches as DocPatch[], inverse as DocPatch[]]
  const fwd: DocPatch[] = [...patches]
  const inv: DocPatch[] = [...inverse]
  patches.forEach((p, i) => {
    if (p.op !== 'replace' || !Array.isArray(p.value)) return
    const qi = before.get(pathKey(p.path))
    if (qi === undefined) return
    const a = inverse[qi]!.value as unknown[]
    const b = p.value as unknown[]
    if (Math.max(a.length, b.length) < BIG_ARRAY || a.length === b.length) return
    const path = p.path as (string | number)[]
    if (b.length < a.length) {
      const out = takenOut(a, b)
      if (!out) return
      fwd[i] = { op: 'removeRows', path, runs: out.runs }
      inv[qi] = { op: 'insertRows', path, runs: out.runs, values: out.values }
    } else {
      const added = takenOut(b, a)
      if (!added) return
      const same = added.values.every((v) => Object.is(v, added.values[0]))
      fwd[i] = same
        ? { op: 'insertRows', path, runs: added.runs, fill: added.values[0] }
        : { op: 'insertRows', path, runs: added.runs, values: added.values }
      inv[qi] = { op: 'removeRows', path, runs: added.runs }
    }
  })
  return [fwd, inv]
}

/**
 * About how many values a history entry's patches hold (audit 2, M1): the elements of the arrays
 * in them (a large array counted by its length, not walked), for the history's size bound.
 */
export function patchCells(patches: readonly DocPatch[]): number {
  let n = 0
  for (const p of patches) {
    if (p.op === 'removeRows') n += p.runs.length
    else if (p.op === 'insertRows') n += p.runs.length + (p.values?.length ?? 0)
    else n += cellsOf(p.value)
  }
  return n
}

function cellsOf(v: unknown): number {
  if (v === null || typeof v !== 'object') return 0
  if (Array.isArray(v)) {
    let n = v.length
    if (v.length < BIG_ARRAY)
      for (const x of v) if (x !== null && typeof x === 'object') n += cellsOf(x)
    return n
  }
  let n = 0
  for (const k in v) n += cellsOf((v as Record<string, unknown>)[k])
  return n
}

/**
 * A copy-on-write editor of a document: containers along a path are copied once per edit (the
 * root first), so everything not on an edited path stays shared with the original.
 */
export class CowWriter<T extends object> {
  root: T
  private readonly copies = new Set<unknown>()

  constructor(base: T) {
    this.root = base
  }

  private copy<C>(c: C): C {
    const out = (Array.isArray(c) ? c.slice() : { ...(c as object) }) as C
    this.copies.add(out)
    return out
  }

  /** The container at `path` (a writable copy, as are its ancestors). */
  at(path: readonly (string | number)[]): Container {
    if (!this.copies.has(this.root)) this.root = this.copy(this.root)
    let node = this.root as unknown as Container
    for (const k of path) {
      const child = (node as Record<string | number, unknown>)[k]
      if (child === null || typeof child !== 'object')
        throw new Error(`patch path: no container at ${String(k)}`)
      const writable = this.copies.has(child) ? child : this.copy(child)
      ;(node as Record<string | number, unknown>)[k] = writable
      node = writable as Container
    }
    return node
  }

  /** Whether `c` is a copy this writer made (so it may be written in place). */
  owns(c: unknown): boolean {
    return this.copies.has(c)
  }
}

/**
 * Applies Immer-style patches (in order) to a document, copying only the containers on their
 * paths; values are inserted as they are (document data is never written in place). The result
 * is frozen as the document is (`freezeDoc`).
 */
export function applyDocPatches<T extends object>(base: T, patches: readonly DocPatch[]): T {
  if (!patches.length) return base
  const w = new CowWriter(base)
  for (const p of patches) {
    if (p.op === 'removeRows' || p.op === 'insertRows') {
      const parent = w.at(p.path.slice(0, -1)) as Record<string | number, unknown>
      const key = p.path.at(-1)!
      const arr = parent[key]
      if (!Array.isArray(arr)) throw new Error(`patch path: no array at ${String(key)}`)
      parent[key] =
        p.op === 'removeRows' ? withoutRuns(arr, p.runs) : withRuns(arr, p.runs, p.values, p.fill)
      continue
    }
    if (!p.path.length) {
      if (p.op === 'remove') throw new Error('patch: cannot remove the root')
      w.root = p.value as T
      continue
    }
    const parent = w.at(p.path.slice(0, -1) as (string | number)[])
    const key = p.path.at(-1)!
    if (Array.isArray(parent)) {
      const i = key === '-' ? parent.length : Number(key)
      if (p.op === 'add') parent.splice(i, 0, p.value)
      else if (p.op === 'remove') parent.splice(i, 1)
      else parent[i] = p.value
    } else if (p.op === 'remove') delete parent[key as string]
    else parent[key as string] = p.value
  }
  return freezeDoc(w.root)
}
