import {
  type GraphNode,
  type NormalizedDataSet,
  type Project,
  primaryValues,
  type ResultLookup,
  type RichText,
} from '@ps/model'
import { type GraphSeries, resolveSeries, rowTitleOf, tableRow } from '../../data.ts'

// The `fraction` stat (parts of whole): each data set is a whole, its rows the parts.

/** One part of one whole. */
export interface Part {
  /** Table row (the slice's point key). */
  row: number
  /** Position among the categories (drives the default colour). */
  category: number
  title: string
  /** The title with its formatting (a formatted row title). */
  rich: RichText
  value: number
  /** Fraction of the whole. */
  fraction: number
}

/** A data set as a whole: its total and parts. */
export interface PartsOf {
  s: GraphSeries
  total: number
  parts: Part[]
}

const valueAt = (ds: NormalizedDataSet, r: number) => primaryValues(ds)[r]!

/**
 * The wholes a graph shows: per data set, its parts (rows with a value, in table order) and
 * their fractions of the total. Rows empty in every data set are not categories; negative values
 * are left out (with a warning).
 */
export function partsOf(
  project: Project,
  graph: Pick<GraphNode, 'seriesSource'>,
  result: ResultLookup | undefined,
  warnings: string[] = [],
) {
  const series = resolveSeries(project, graph, result)
  const rowCount = series[0]?.ds.rowCount ?? 0
  const rows = Array.from({ length: rowCount }, (_, r) => r).filter((r) =>
    series.some((s) => Number.isFinite(valueAt(s.ds, r))),
  )
  const titles = rows.map((r) => {
    const t = series[0]?.ds.rowTitles?.[r]
    return t || `Row ${(series[0] ? tableRow(series[0], r) : r) + 1}`
  })
  const rich = rows.map((r, k) => (series[0] && rowTitleOf(series[0], r)) || [{ text: titles[k]! }])
  const wholes: PartsOf[] = series.map((s) => {
    const vals = rows.map((r) => valueAt(s.ds, r))
    if (vals.some((v) => v < 0)) warnings.push(`${s.title}: negative values are left out.`)
    const ok = (v: number) => Number.isFinite(v) && v >= 0
    const total = vals.filter(ok).reduce((a, b) => a + b, 0)
    const parts: Part[] = []
    rows.forEach((r, k) => {
      const v = vals[k]!
      if (ok(v))
        parts.push({
          row: tableRow(s, r),
          category: k,
          title: titles[k]!,
          rich: rich[k]!,
          value: v,
          fraction: total > 0 ? v / total : 0,
        })
    })
    return { s, total, parts }
  })
  return {
    wholes,
    categories: rows.map((r, k) => ({
      row: series[0] ? tableRow(series[0], r) : r,
      title: titles[k]!,
      rich: rich[k]!,
    })),
  }
}
