import {
  type DataSetKey,
  type DataTable,
  type GraphNode,
  type LayerOf,
  levelAt,
  levelKey,
  type NormalizedDataSet,
  normalizeDataSet,
  orderedLevels,
  primaryValues,
} from '@ps/model'
import type { GraphSeries } from './data.ts'

// Histograms of a multiple-variables table (roadmap 34f): a bar layer with the `bin` stat that
// maps a number variable to X (`aes.x`) bins its values over the graph's rows — as one data set
// (keyed by the variable), or one per level of the text variable it maps to colour (`aes.color`,
// in the graph's order of levels, keyed by `levelKey` so formats follow a level, as the levels of
// a graph of variables do). The graph's data sets are these (`resolveSeries`), so the frame,
// legend, Format panels and hover cards read them as any data sets. Rows with a value but no level
// are left out and counted (roadmap 34a's rule).

/** The histogram layer of a graph of variables (its first bar layer binning a variable). */
export function histogramLayer(
  graph: Pick<GraphNode, 'frame' | 'layers'>,
): LayerOf<'bar'> | undefined {
  if (graph.frame !== 'xy') return undefined
  return graph.layers.find(
    (l): l is LayerOf<'bar'> =>
      l.geom === 'bar' && l.stat.kind === 'bin' && !!l.aes && l.visible !== false,
  )
}

/** What a histogram of variables bins. */
export interface VariableBins {
  series: GraphSeries[]
  /** Rows with a value but no level of the colour variable (left out). */
  noLevel: number
  /** The colour variable's title, when it groups the values. */
  groupTitle?: string
}

/** A data set of values, as binning reads it (one replicate of `values`). */
function valuesSet(
  table: DataTable,
  key: string,
  title: string,
  values: number[],
): NormalizedDataSet {
  return {
    ref: { node: table.id, key: key as DataSetKey },
    title,
    rowCount: values.length,
    rowTitles: null,
    x: null,
    data: { shape: 'replicates', reps: [Float64Array.from(values)] },
    counts: { empty: 0, excluded: 0 },
  }
}

interface Kept {
  key: string
  rows: readonly number[] | null
  out: VariableBins
}
const cache = new WeakMap<DataTable, Kept[]>()
const KEPT = 8

/**
 * A histogram of variables' data sets over `rows` (null: every row; see the module comment).
 * Cached per table object, variables, order of levels and rows array.
 */
export function variableBins(
  table: DataTable,
  graph: Pick<GraphNode, 'levels' | 'levelOrder'>,
  layer: Pick<LayerOf<'bar'>, 'aes'>,
  rows: readonly number[] | null,
): VariableBins {
  const xCol = table.dataSets.find((d) => d.id === layer.aes?.x && !d.text)
  const colorCol = table.dataSets.find((d) => d.id === layer.aes?.color && !!d.text)
  const key = JSON.stringify([
    xCol?.id,
    colorCol?.id,
    colorCol ? graph.levels?.[colorCol.id] : null,
    graph.levelOrder ?? 'appearance',
  ])
  let kept = cache.get(table)
  const hit = kept?.find((k) => k.key === key && k.rows === rows)
  if (hit) return hit.out
  const out = compute(table, graph, xCol, colorCol, rows)
  if (!kept) {
    kept = []
    cache.set(table, kept)
  }
  if (kept.length >= KEPT) kept.shift()
  kept.push({ key, rows, out })
  return out
}

type Column = DataTable['dataSets'][number]

function compute(
  table: DataTable,
  graph: Pick<GraphNode, 'levels' | 'levelOrder'>,
  xCol: Column | undefined,
  colorCol: Column | undefined,
  rows: readonly number[] | null,
): VariableBins {
  if (!xCol) return { series: [], noLevel: 0 }
  const xs = primaryValues(normalizeDataSet(table, xCol))
  const n = Math.min(table.rowCount, xs.length)
  const each = (f: (r: number) => void) => {
    if (rows) for (const r of rows) f(r)
    else for (let r = 0; r < n; r++) f(r)
  }
  const title = xCol.title || xCol.id
  if (!colorCol?.text) {
    const values: number[] = []
    each((r) => {
      const x = xs[r]!
      if (Number.isFinite(x)) values.push(x)
    })
    // Coloured as the variable's own data set would be (the bubble plot's rule).
    const index = Math.max(0, table.dataSets.indexOf(xCol))
    return {
      series: [{ key: xCol.id, title, index, ds: valuesSet(table, xCol.id, title, values) }],
      noLevel: 0,
    }
  }
  // Each row's level (an excluded level is none), the levels present in the rows shown.
  const text = colorCol.text
  const excluded = colorCol.subcolumns[0]?.excluded
  const present: string[] = []
  const byLevel = new Map<string, number[]>()
  let noLevel = 0
  each((r) => {
    const x = xs[r]!
    const t = excluded?.[r] ? null : levelAt(text, r)
    if (t !== null && !byLevel.has(t)) {
      byLevel.set(t, [])
      present.push(t)
    }
    if (!Number.isFinite(x)) return
    if (t === null) noLevel++
    else byLevel.get(t)!.push(x)
  })
  const order = orderedLevels(present, graph.levels?.[colorCol.id], graph.levelOrder)
  const series = order.map(
    (t, k): GraphSeries => ({
      key: levelKey(t),
      title: t,
      index: k,
      ds: valuesSet(table, levelKey(t), t, byLevel.get(t) ?? []),
    }),
  )
  return { series, noLevel, groupTitle: colorCol.title || colorCol.id }
}
