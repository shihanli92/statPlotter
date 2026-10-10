import {
  type GraphNode,
  type LayerOf,
  type NormalizedDataSet,
  type Project,
  type ResultLookup,
  seriesShown,
} from '@ps/model'
import { autoBinWidth, histogram } from '@ps/stats'
import { resolveSeries, valueStats, type XYRow } from '../../data.ts'
import type { Transform } from '../../transform.ts'
import { transformOf } from '../../transform.ts'

// The `bin` stat (roadmap 33d): a column table's values as a histogram on an xy graph. The data
// sets a layer draws share one set of bins (the frequency distribution's: FAQ 1660's automatic
// width unless the layer sets one); each bin's bar measures its count, or its percent or
// fraction of the data set's values. The numbers come from `@ps/stats` (`histogram`, checked
// against R's binning in the `frequency` oracle suite); this module only reshapes them into the
// rows an xy graph draws (X = the bin's centre).
//
// Roadmap 34f: a histogram of a multiple-variables table bins the number variable its layer maps
// to X, per level of a text variable (its data sets: `binned.ts`, through `resolveSeries`). Bars
// of a stacked layer (`position` stack) stand on the data sets before them.
//
// Roadmap 34g: on an arcsinh or logicle X axis the bins are the transformed values' (equal widths
// on the axis, as cytometry histograms bin them; a set width is in transformed units), each bar's
// edges back in raw units (`XYRow.edges`). Log axes bin raw values as before.

/** Every value of a data set a histogram bins (entered means have none to bin). */
export function binValues(ds: NormalizedDataSet): number[] {
  if (ds.data.shape !== 'replicates') return []
  const out: number[] = []
  for (const rep of ds.data.reps) for (const v of rep) if (Number.isFinite(v)) out.push(v)
  return out
}

/** A histogram layer of a graph of variables (roadmap 34f): it bins the variable on its X. */
export const binsVariable = (layer: LayerOf<'bar'>): boolean =>
  layer.stat.kind === 'bin' && !!layer.aes

/**
 * The bin width a histogram layer draws with now (its own, else the automatic one for the data
 * sets it draws): what Format graph starts from when the user sets a width.
 */
export function histogramWidth(
  project: Project,
  graph: GraphNode,
  layer: LayerOf<'bar'>,
  result?: ResultLookup,
): number {
  const sets = resolveSeries(project, graph, result)
    .filter((s) => seriesShown(layer, s.key))
    .map((s) => s.ds)
  return binRows(layer, sets, histogramTransform(graph)).width
}

/**
 * The transform a histogram bins in (roadmap 34g): its X axis' when that is arcsinh or logicle,
 * else none (raw values).
 */
export function histogramTransform(graph: Pick<GraphNode, 'axes'>): Transform | undefined {
  const x = graph.axes.x
  if (x.type !== 'continuous') return undefined
  const t = transformOf(x)
  return t.cyto ? t : undefined
}

/**
 * Roadmap 41 (decision 621): bins of values that are all ≥ 0 start at 0 (edges 0, w, 2w…, as R's
 * `hist` makes them) where the automatic first bin, centred on a multiple of the width, would
 * reach below 0 — so a histogram of counts, times or concentrations has no bar, and no axis,
 * left of zero. The first bin's centre (w / 2), or undefined to keep the automatic bins (values
 * below 0, or a first bin that starts at or above 0 anyway).
 */
export function firstCenterFrom0(
  dataSets: readonly (readonly number[])[],
  width: number | undefined,
): number | undefined {
  let min = Number.POSITIVE_INFINITY
  for (const v of dataSets) for (const x of v) if (x < min) min = x
  if (!(min >= 0) || !Number.isFinite(min)) return undefined
  const w = width ?? autoBinWidth(dataSets)
  if (!(w > 0) || !Number.isFinite(w)) return undefined
  const lo = w * Math.floor(min / w + 0.5) - w / 2
  return lo < 0 ? w / 2 : undefined
}

/** A histogram's rows per data set (bins without values left out) and its bin width. */
export interface Bins {
  width: number
  rows: XYRow[][]
  /** Each data set's own measure per bin (stacked bars' rows stand at their running totals). */
  values: number[][]
  /** Each bin's centre. */
  centers: number[]
  /** Roadmap 34g: each bin's edges in raw units, when binned in an axis' transformed units. */
  edges?: [number, number][]
}

const binsCache = new WeakMap<
  LayerOf<'bar'>,
  { sets: readonly NormalizedDataSet[]; transform: Transform | undefined; out: Bins }
>()

/**
 * The bins of the data sets `series` (those the layer draws), as xy rows: `row` the bin's
 * index, `x` its centre, the measure as the row's value. A stacked layer's bars (roadmap 34f)
 * stand on the data sets before them: a row's value is the running total, `base` the total below.
 * The last result is kept per layer object (hover cards ask again).
 */
export function binRows(
  layer: LayerOf<'bar'>,
  series: readonly NormalizedDataSet[],
  transform?: Transform,
): Bins {
  const last = binsCache.get(layer)
  if (
    last &&
    last.transform === transform &&
    last.sets.length === series.length &&
    last.sets.every((s, i) => s === series[i])
  )
    return last.out
  const stat = layer.stat.kind === 'bin' ? layer.stat : { kind: 'bin' as const }
  const values = series.map(binValues)
  const t = transform
  const binned = t ? values.map((v) => v.map(t.forward).filter(Number.isFinite)) : values
  const first = firstCenterFrom0(binned, stat.width)
  const h = histogram(binned, {
    ...(stat.width !== undefined ? { binWidth: stat.width } : {}),
    ...(first !== undefined ? { firstCenter: first } : {}),
    measure: stat.measure ?? 'count',
  })
  let out: Bins
  if (h.error)
    out = {
      width: Number.NaN,
      rows: series.map(() => []),
      values: series.map(() => []),
      centers: [],
    }
  else {
    const stacked = layer.position?.kind === 'stack'
    const below = h.centers.map(() => 0)
    const rows = h.values.map((values) =>
      values.flatMap((v, i): XYRow[] => {
        if (!(v > 0 && Number.isFinite(v))) return []
        const c = h.centers[i]!
        // Transformed bins: the centre and edges back in raw units.
        const at = t
          ? {
              x: t.inverse(c),
              edges: [t.inverse(c - h.binWidth / 2), t.inverse(c + h.binWidth / 2)] as [
                number,
                number,
              ],
            }
          : { x: c }
        if (!stacked) return [{ row: i, ...at, stats: valueStats(v) }]
        const base = below[i]!
        below[i] = base + v
        return [{ row: i, ...at, stats: valueStats(base + v), base }]
      }),
    )
    out = {
      width: h.binWidth,
      rows,
      values: h.values,
      centers: t ? h.centers.map((c) => t.inverse(c)) : h.centers,
      ...(t
        ? {
            edges: h.centers.map((c): [number, number] => [
              t.inverse(c - h.binWidth / 2),
              t.inverse(c + h.binWidth / 2),
            ]),
          }
        : {}),
    }
  }
  binsCache.set(layer, { sets: series, transform, out })
  return out
}
