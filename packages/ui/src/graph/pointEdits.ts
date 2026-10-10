import type { Command } from '@ps/engine'
import { identityStyle, layerStyle, type ResolvedSeriesStyle, type Theme } from '@ps/graph'
import { type GraphNode, type GraphPathSegment, type Layer, statOf } from '@ps/model'
import { type FormatTarget, singleMarkName } from './format/route.ts'

// Roadmap 47: formatting several selected points at once. The Format panel shows the primary
// point's place; what its fields write at that point's override (`['pointOverrides', data set,
// point, …]`) is written at each selected point's in the same step. Pure: commands for the store.

/** A point of a graph: its data set's key and its point key. */
export type PointRef = readonly [dataSet: string, point: string]

const isPlain = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** The value at a path of a graph's node (plain segments only). */
function valueAt(graph: GraphNode, path: readonly GraphPathSegment[]): unknown {
  let at: unknown = graph
  for (const seg of path) {
    if (!isPlain(at) || typeof seg === 'object') return undefined
    at = at[seg as string]
  }
  return at
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * What a point draws with at a path of its override (`['pointOverrides', key, point, …rest]`):
 * its own value there, else what it inherits (its data set's in the layer drawing it, the
 * theme's): a whole stroke or fill (`border`, `fill`, a bar's or box's `bar.border`…); a bar's or
 * box's own `MarkFill` (partial: its fields resolve one by one).
 */
export type PointEffective = (path: readonly GraphPathSegment[]) => unknown

/** A graph's points' effective values (`PointEffective`), against its theme. */
export function pointEffective(theme: Theme, graph: GraphNode): PointEffective {
  const styles = new Map<string, ResolvedSeriesStyle>()
  /** The data set's style in the first shown layer drawing these geoms (its identity's else). */
  const style = (key: string, geoms: readonly Layer['geom'][]) => {
    const id = `${key}\u0000${geoms.join()}`
    let s = styles.get(id)
    if (!s) {
      const layer = graph.layers.find((l) => geoms.includes(l.geom) && l.visible !== false)
      s = layer
        ? layerStyle(theme, graph, layer, key, statOf(layer, key))
        : identityStyle(theme, graph, key)
      styles.set(id, s)
    }
    return s
  }
  return (path) => {
    const own = valueAt(graph, path)
    if (own !== undefined || path[0] !== 'pointOverrides') return own
    const key = String(path[1])
    const rest = path.slice(3).map(String)
    const [field, part] = rest
    // The whole value inherited, then down to the field asked for (a border's width).
    let base: unknown
    let depth: number
    if ((field === 'bar' || field === 'box') && (part === 'fill' || part === 'border')) {
      base = style(key, field === 'bar' ? ['bar'] : ['box', 'violin'])[field][part]
      depth = 2
    } else if (field === 'bar' || field === 'box') return rest.length === 1 ? {} : undefined
    else if (field === 'border' || field === 'fill') {
      base = style(key, ['points']).points[field]
      depth = 1
    } else return undefined
    for (const seg of rest.slice(depth)) base = isPlain(base) ? base[seg] : undefined
    return base
  }
}

/** A change of an object as the fields it changes (nested objects field by field), else whole. */
type Change = { whole: unknown } | { fields: Record<string, Change> }

/**
 * What writing `next` at `path` changes against what the point drew with there (`effective`,
 * nested paths resolved too: a bar's own `MarkFill` holding no border still draws one): the
 * fields that differ, nested objects field by field; a value of another kind (a fill turned
 * from solid to none: its `type` differs) whole.
 */
function changeOf(
  path: GraphPathSegment[],
  next: unknown,
  effective: PointEffective,
): Change | null {
  const prev = effective(path)
  if (same(prev, next)) return null
  const typed = (v: Record<string, unknown>) => v.type
  if (!isPlain(prev) || !isPlain(next) || typed(prev) !== typed(next)) return { whole: next }
  const fields: Record<string, Change> = {}
  for (const k of new Set([...Object.keys(prev), ...Object.keys(next)])) {
    const c = changeOf([...path, k], next[k], effective)
    if (c) fields[k] = c
  }
  return { fields }
}

/** A change made on another point: on what that point draws with there, field by field. */
function applyChange(path: GraphPathSegment[], change: Change, effective: PointEffective) {
  if ('whole' in change) return change.whole
  const base = effective(path)
  const out: Record<string, unknown> = isPlain(base) ? { ...base } : {}
  for (const [k, c] of Object.entries(change.fields)) {
    const v = applyChange([...path, k], c, effective)
    if (v === undefined) delete out[k]
    else out[k] = v
  }
  return out
}

/**
 * The commands writing what `cmds` write at the primary point's override at every one of
 * `points` too, each composed from what that point draws with (`effective`): a field set alike;
 * an object (a border, a fill, a bar's fill and border) changed only in the fields the edit
 * changes against what the primary drew with, so a width changed keeps every point's own
 * colour and dash. Other commands pass unchanged.
 */
export function fanOutPoints(
  graph: GraphNode,
  cmds: readonly Command[],
  primary: PointRef,
  points: readonly PointRef[],
  effective: PointEffective,
): Command[] {
  const [ds, pt] = primary
  return cmds.flatMap((c): Command[] => {
    if (
      c.type !== 'node.set' ||
      c.id !== graph.id ||
      c.path[0] !== 'pointOverrides' ||
      c.path[1] !== ds ||
      c.path[2] !== pt
    )
      return [c]
    const rest = c.path.slice(3)
    // Reset (the whole override) and plain fields: alike; objects: by the fields changed.
    const change: Change =
      rest.length && c.value !== undefined
        ? (changeOf([...c.path], c.value, effective) ?? { fields: {} })
        : { whole: c.value }
    // Nothing changed: nothing to write elsewhere.
    if ('fields' in change && !Object.keys(change.fields).length) return [c]
    const others = points.filter(([d, p]) => !(d === ds && p === pt))
    return [
      c,
      ...others.map(([d, p]): Command => {
        const path: GraphPathSegment[] = ['pointOverrides', d, p, ...rest]
        return { type: 'node.set', id: graph.id, path, value: applyChange(path, change, effective) }
      }),
    ]
  })
}

/** "Format point" for several: "Format point (3 points)". */
export const pointsLabel = (label: string | undefined, n: number): string | undefined =>
  n > 1 ? `${label ?? 'Format point'} (${n} points)` : label

/**
 * The points a Format place's changes go to (the panel's and, audit 3 U5, the dialog's): the
 * point it shows and every selected point, when it shows one of several selected; else null.
 */
export function pointsFormatted(
  target: FormatTarget,
  points: readonly PointRef[] | undefined,
): { shown: PointRef; all: readonly PointRef[] } | null {
  const series = target.place === 'series' ? target.series : null
  const shown: PointRef | null =
    series && 'dataSet' in series && series.point ? [series.dataSet, series.point] : null
  if (!shown || !points || points.length < 2) return null
  return points.some((p) => p[0] === shown[0] && p[1] === shown[1]) ? { shown, all: points } : null
}

/** A place's changes written to each point it formats (`pointsFormatted`), and their label. */
export function writePoints(
  graph: GraphNode,
  theme: Theme,
  formatted: ReturnType<typeof pointsFormatted>,
  input: Command | Command[],
  label: string | undefined,
): { cmds: Command | Command[]; label: string | undefined } {
  if (!formatted) return { cmds: input, label }
  const list = Array.isArray(input) ? input : [input]
  return {
    cmds: fanOutPoints(graph, list, formatted.shown, formatted.all, pointEffective(theme, graph)),
    label: pointsLabel(label, formatted.all.length),
  }
}

/** Commands hiding points on the graph (the table untouched): PointPanel's "Hide this point". */
export const hidePointsCommands = (graph: GraphNode, points: readonly PointRef[]): Command[] =>
  points.map(([d, p]) => ({
    type: 'node.set',
    id: graph.id,
    path: ['pointOverrides', d, p, 'hide'],
    value: true,
  }))

/**
 * The Format panel's heading for several points selected when it shows one of them: "3 points",
 * "2 bars" (null otherwise).
 */
export function pointsName(
  target: FormatTarget,
  graph: Pick<GraphNode, 'frame' | 'layers'>,
  points: readonly PointRef[],
): string | null {
  if (points.length < 2 || target.place !== 'series') return null
  const s = target.series
  if (!('dataSet' in s) || !s.point || !points.some(([d, p]) => d === s.dataSet && p === s.point))
    return null
  const what = singleMarkName(graph, s.point).replace('data ', '')
  return `${points.length} ${what}${what === 'box' ? 'es' : 's'}`
}
