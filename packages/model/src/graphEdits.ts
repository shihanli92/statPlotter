import type { GraphNode, Layer } from './layers.ts'

// Changes to a graph node as data: values set at paths (`{ id }` segments name a layer or an
// output by its id) and layer lists replaced. What a command list making a graph change holds
// (`graph.setLayers`, `node.set`), computed by comparing the graph before and after.

/** A path into a graph node; `{ id }` names an array element (a layer, an output) by its id. */
export type GraphPathSegment = string | number | { id: string }
export type GraphPath = GraphPathSegment[]

/**
 * A change to a graph: a value set at a path (`undefined` removes it), or its layer list
 * replaced (layers added, removed or moved).
 */
export type GraphEdit =
  | { kind: 'set'; path: GraphPath; value: unknown }
  | { kind: 'layers'; layers: Layer[] }

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Structural equality of plain document data. */
export function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false
    return a.every((x, i) => sameData(x, b[i]))
  }
  if (isPlainObject(a)) {
    if (!isPlainObject(b)) return false
    const ka = Object.keys(a).filter((k) => a[k] !== undefined)
    const kb = Object.keys(b).filter((k) => b[k] !== undefined)
    return ka.length === kb.length && ka.every((k) => sameData(a[k], b[k]))
  }
  return false
}

/** The sets turning `a` into `b`, at the deepest paths where they differ (records walked). */
export function diffValue(a: unknown, b: unknown, path: GraphPath, out: GraphEdit[]) {
  if (sameData(a, b)) return
  if (isPlainObject(a) && isPlainObject(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)]))
      diffValue(a[k], b[k], [...path, k], out)
    return
  }
  out.push({ kind: 'set', path, value: b })
}

/** The edits turning graph `a` into graph `b` (both the same node). */
export function graphEdits(a: GraphNode, b: GraphNode): GraphEdit[] {
  const out: GraphEdit[] = []
  const ra = a as unknown as Record<string, unknown>
  const rb = b as unknown as Record<string, unknown>
  for (const k of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
    if (k === 'layers' || k === 'id' || k === 'kind') continue
    diffValue(ra[k], rb[k], [k], out)
  }
  const ids = (g: GraphNode) => g.layers.map((l) => l.id).join()
  if (ids(a) !== ids(b)) out.push({ kind: 'layers', layers: b.layers })
  else
    a.layers.forEach((l, i) => {
      diffValue(l, b.layers[i], ['layers', { id: l.id }], out)
    })
  return out
}

/** The value at a path (undefined where it is missing); `{ id }` as in `setAt`. */
export function getAt(target: unknown, path: readonly GraphPathSegment[]): unknown {
  let at = target
  for (const head of path) {
    if (typeof head === 'object')
      at = Array.isArray(at) ? at.find((x) => isPlainObject(x) && x.id === head.id) : undefined
    else if (Array.isArray(at) && typeof head === 'number') at = at[head]
    else at = isPlainObject(at) ? at[head as string] : undefined
    if (at === undefined) return undefined
  }
  return at
}

/** Sets a value at a path (copy on write); `{ id }` finds the array element with that id. */
export function setAt(target: unknown, path: GraphPath, value: unknown): unknown {
  if (!path.length) return value
  const [head, ...rest] = path
  if (typeof head === 'object') {
    if (!Array.isArray(target)) throw new Error(`no list for ${head.id}`)
    const i = target.findIndex((x) => isPlainObject(x) && x.id === head.id)
    if (i < 0) throw new Error(`no element ${head.id}`)
    const out = [...target]
    out[i] = setAt(target[i], rest, value)
    return out
  }
  if (Array.isArray(target) && typeof head === 'number') {
    const out = [...target]
    out[head] = setAt(target[head], rest, value)
    return out
  }
  const obj = isPlainObject(target) ? target : {}
  if (rest.length === 0 && value === undefined) {
    if (!(head in obj)) return target
    const { [head as string]: _, ...others } = obj
    return others
  }
  const next = setAt(obj[head as string], rest, value)
  return next === obj[head as string] ? target : { ...obj, [head as string]: next }
}
