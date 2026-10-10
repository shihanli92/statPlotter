import { type CellColumn, type DataTable, nodeById, type Project } from '@ps/model'
import { applyCommand, type Command, CommandError } from './commands.ts'
import { BIG_ARRAY, type DocPatch } from './docPatches.ts'

// Row inserts and deletes without Immer (audit 2, M2). Under Immer every per-row array the
// command replaces is walked when the draft is finished, and the patches then compared element by
// element to make them compact (`compactRowPatches`): deleting three rows of a table of a million
// rows and 32 columns took 1.7 s. Here the ordinary reducer runs on copies of only what it may
// write (the table down to its subcolumns, and the graphs and analyses whose row references it
// moves, each a shallow copy: it replaces their fields whole), and the patches are what changed:
// fields replaced, added or removed, and a large per-row array as the rows taken out or put in.

type RowCommand = Extract<Command, { type: 'table.insertRows' } | { type: 'table.deleteRows' }>

export interface RowEdit {
  next: Project
  patches: DocPatch[]
  inverse: DocPatch[]
  /**
   * Each per-row array made, with the array it was made from (the same path before): its rows
   * with some taken out or new empty ones put in, so it holds what that one may (the store checks
   * neither again: `withKnownRowArrays`).
   */
  derived: Map<unknown, unknown>
}

type Path = (string | number)[]

/** Per-row array fields: the arrays the row commands rebuild. */
const ROW_FIELDS = new Set(['values', 'excluded', 'limit', 'text', 'rowTitles', 'rowTitlesRich'])

/**
 * The next document and its patches for one row insert or delete, or null for anything else (the
 * caller applies it with Immer). Refuses (CommandError) what the reducer refuses, leaving `doc`
 * untouched.
 */
export function rowEditPatches(doc: Project, commands: readonly Command[]): RowEdit | null {
  if (commands.length !== 1) return null
  const cmd = commands[0]!
  if (cmd.type !== 'table.insertRows' && cmd.type !== 'table.deleteRows') return null
  const table = nodeById(doc.nodes, cmd.table)
  if (table?.kind !== 'table') return null

  // Writable copies, marked so the diff descends into them.
  const copies = new Set<object>()
  const own = <T extends object>(o: T): T => {
    copies.add(o)
    return o
  }
  const columns = (subs: readonly CellColumn[]) => own(subs.map((c) => own({ ...c })))
  const t: DataTable = own({
    ...table,
    dataSets: own(table.dataSets.map((d) => own({ ...d, subcolumns: columns(d.subcolumns) }))),
    x: table.x && own({ ...table.x, subcolumns: columns(table.x.subcolumns) }),
  })
  const root: Project = own({ ...doc, nodes: own({ ...doc.nodes }) })
  root.nodes[t.id] = t
  for (const n of Object.values(doc.nodes))
    if (n.kind === 'graph' || n.kind === 'analysis') root.nodes[n.id] = own({ ...n })
  try {
    applyCommand(root, cmd)
  } catch (e) {
    if (e instanceof CommandError) throw e
    // The reducer wrote somewhere not copied here: Immer's way, which copies on write.
    return null
  }

  const patches: DocPatch[] = []
  const inverse: DocPatch[] = []
  const derived = new Map<unknown, unknown>()
  const runs = rowRuns(cmd, table.rowCount)
  /** A value the reducer made (not a copy made here) replacing `a` at `path`. */
  const made = (path: Path, a: unknown, b: unknown) => {
    const rowArray =
      path[1] === t.id &&
      ROW_FIELDS.has(String(path.at(-1))) &&
      Array.isArray(a) &&
      Array.isArray(b)
    if (rowArray) {
      derived.set(b, a)
      const compact = Math.max(a.length, b.length) >= BIG_ARRAY && rowsPatches(path, a, b, runs)
      if (compact) {
        patches.push(compact[0])
        inverse.push(compact[1])
        return
      }
    }
    patches.push({ op: 'replace', path, value: b })
    inverse.push({ op: 'replace', path, value: a })
  }
  /** What to keep at `path`: `a` when nothing changed there, else `b` (patches written). */
  const diff = (path: Path, a: unknown, b: unknown): unknown => {
    if (Object.is(a, b)) return a
    if (!copies.has(b as object) || a === null || typeof a !== 'object') {
      made(path, a, b)
      return b
    }
    const ao = a as Record<string, unknown>
    const bo = b as Record<string, unknown>
    if (Array.isArray(ao) !== Array.isArray(bo) || (Array.isArray(ao) && ao.length !== bo.length)) {
      made(path, a, b)
      return b
    }
    let changed = false
    for (const k of Object.keys(bo)) {
      const at = Array.isArray(bo) ? Number(k) : k
      if (!Object.hasOwn(ao, k)) {
        patches.push({ op: 'add', path: [...path, at], value: bo[k] })
        inverse.push({ op: 'remove', path: [...path, at] })
        changed = true
        continue
      }
      const v = diff([...path, at], ao[k], bo[k])
      bo[k] = v
      if (v !== ao[k]) changed = true
    }
    for (const k of Object.keys(ao))
      if (!Object.hasOwn(bo, k)) {
        patches.push({ op: 'remove', path: [...path, k] })
        inverse.push({ op: 'add', path: [...path, k], value: ao[k] })
        changed = true
      }
    return changed ? b : a
  }
  const next = diff([], doc, root) as Project
  // Undone last change first.
  inverse.reverse()
  return { next, patches, inverse, derived }
}

/** The rows a command takes out (indices before) or puts in (indices after), as [start, length]. */
function rowRuns(cmd: RowCommand, rowCount: number): [number, number][] {
  if (cmd.type === 'table.insertRows') return [[cmd.at, cmd.count]]
  const rows = [...new Set(cmd.rows)].filter((r) => r < rowCount).sort((a, b) => a - b)
  const runs: [number, number][] = []
  for (const r of rows) {
    const last = runs.at(-1)
    if (last && last[0] + last[1] === r) last[1]++
    else runs.push([r, 1])
  }
  return runs
}

/**
 * A large array's change as its rows (`removeRows` / `insertRows`, decision 670), both ways; null
 * when `b` is not `a` with exactly those rows taken out or put in (then it is held whole).
 */
function rowsPatches(
  path: Path,
  a: readonly unknown[],
  b: readonly unknown[],
  runs: [number, number][],
): [DocPatch, DocPatch] | null {
  let n = 0
  for (const [, len] of runs) n += len
  if (b.length === a.length - n) {
    const values: unknown[] = []
    for (const [start, len] of runs) for (let i = start; i < start + len; i++) values.push(a[i])
    return [
      { op: 'removeRows', path, runs },
      { op: 'insertRows', path, runs, values },
    ]
  }
  if (b.length === a.length + n && runs.length === 1) {
    const [start] = runs[0]!
    const fill = b[start]
    for (let i = start; i < start + n; i++) if (!Object.is(b[i], fill)) return null
    return [
      { op: 'insertRows', path, runs, fill },
      { op: 'removeRows', path, runs },
    ]
  }
  return null
}
