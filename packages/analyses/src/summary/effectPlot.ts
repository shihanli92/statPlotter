import type { AnalysisResult, ColumnId, DataTable, NodeId, SketchSpec } from '@ps/model'
import { readableNumber } from '@ps/model'
import { comparisonRows, comparisonsTable } from './read.ts'

// Roadmap 51d (design §8.5, U25): the small effect plot beside comparison results — each
// difference as a point with its CI bar and a reference line at no difference — as a sketch is
// drawn (a transient table, a native preset, typed lines; `@ps/graph`'s `sketchGraph`), from the
// result's own numbers. Drawing never knows the method: the plot is data.

/** The preset drawing a value with its entered limits (a mean with error bars). */
export const EFFECT_PRESET = 'meanSd'

interface Effect {
  label: string
  value: number
  lo: number
  hi: number
}

/** The differences a result reports, in its sign: two groups' estimate, or its comparisons. */
export function effects(result: AnalysisResult, names: readonly string[]): Effect[] {
  const rows = comparisonRows(comparisonsTable(result))
  if (rows.length)
    return rows
      .filter((r) => Number.isFinite(r.diff) && r.ci && Number.isFinite(r.ci.lo))
      .map((r) => ({
        label: `${r.within ? `${r.within}: ` : ''}${r.left} − ${r.right}`,
        value: r.diff,
        lo: r.ci!.lo,
        hi: r.ci!.hi,
      }))
  const c = result.comparisons.length === 1 ? result.comparisons[0] : undefined
  if (!c?.estimate || !Number.isFinite(c.estimate.lo)) return []
  const [a, b] = names
  const ratio = /ratio/i.test(c.estimate.label)
  const label = a && b ? `${b} ${ratio ? '/' : '−'} ${a}` : c.estimate.label
  return [{ label, value: c.estimate.value, lo: c.estimate.lo, hi: c.estimate.hi }]
}

/** At most this many differences are drawn (the table has the rest). */
export const EFFECT_MAX = 12

/**
 * The effect plot of a result, or null when it reports no difference with a CI. `names`: the
 * analyzed data sets' titles in order (two groups: A, B).
 */
export function effectPlot(result: AnalysisResult, names: readonly string[]): SketchSpec | null {
  if (result.status === 'error') return null
  const all = effects(result, names)
  if (!all.length) return null
  const shown = all.slice(0, EFFECT_MAX)
  const ratio =
    shown.every((e) => e.lo > 0) && /ratio/i.test(result.comparisons[0]?.estimate?.label ?? '')
  const table: DataTable = {
    kind: 'table',
    id: 'sketcheffects' as NodeId,
    name: 'Effects',
    tableKind: 'column',
    yFormat: { type: 'summary', preset: 'meanUpperLower' },
    rowCount: 1,
    rowTitles: null,
    x: null,
    dataSets: shown.map((e, i) => ({
      id: `e${i}` as ColumnId,
      title: e.label,
      subcolumns: [
        { type: 'number', values: [e.value] },
        { type: 'number', values: [e.hi] },
        { type: 'number', values: [e.lo] },
      ],
    })),
    notes: '',
  }
  const level = /(\d+(?:\.\d+)?)%/.exec(
    comparisonsTable(result)?.columns.find((c) => / CI of diff/.test(c)) ?? '',
  )?.[1]
  const ci = `${level ?? '95'}% CI`
  const described = shown
    .map(
      (e) =>
        `${e.label}: ${readableNumber(e.value)} (${ci} ${readableNumber(e.lo)} to ${readableNumber(e.hi)})`,
    )
    .join('; ')
  return {
    panels: [
      {
        id: 'effects',
        table,
        preset: EFFECT_PRESET,
        lines: [{ at: ratio ? 1 : 0 }],
        axes: { yTitle: ratio ? 'Ratio' : 'Difference', ...(ratio ? { yLog: true } : {}) },
      },
    ],
    caption: `Each difference with its ${ci}; the line is no difference (${ratio ? '1' : '0'}).`,
    description: `Effect plot. ${described}${all.length > shown.length ? `; ${all.length - shown.length} more in the table` : ''}.`,
    counts:
      all.length > shown.length
        ? `${shown.length} of ${all.length} differences`
        : `${all.length} difference${all.length === 1 ? '' : 's'}`,
  }
}
