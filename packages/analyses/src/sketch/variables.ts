import type { NormalizedDataSet, SketchContext, SketchPanel, SketchSpec } from '@ps/model'
import { columnTable, sketchRows, xyTable } from './tables.ts'
import { countsLine, nameList, q } from './words.ts'

// Roadmap 51b (design §5.6): analyses of a multiple-variables table — the outcome against each
// predictor (up to six small panels: a scatter for a number, the outcome by level for a text or
// coded variable), the roles named. No coefficient, P or fit.

type Params = Record<string, unknown>

/** Panels shown at most. */
const MAX_PANELS = 6

const keyOf = (input: readonly NormalizedDataSet[], key: unknown, fallback: number) =>
  input.find((d) => d.ref.key === key) ?? input[fallback]

/** Few distinct numbers (codes): drawn by level. */
function isCoded(d: NormalizedDataSet, rows: readonly number[]): boolean {
  if (d.text) return true
  const seen = new Set<number>()
  const v = d.data.shape === 'replicates' ? d.data.reps[0]! : d.data.mean
  for (const r of rows) {
    const x = v[r] ?? Number.NaN
    if (Number.isFinite(x)) seen.add(x)
    if (seen.size > 6) return false
  }
  return seen.size <= 6
}

/** One panel of the outcome against a predictor. */
function panelOf(
  outcome: NormalizedDataSet,
  p: NormalizedDataSet,
  rows: readonly number[],
  i: number,
): SketchPanel {
  const y = outcome.data.shape === 'replicates' ? outcome.data.reps[0]! : outcome.data.mean
  const xv = p.data.shape === 'replicates' ? p.data.reps[0]! : p.data.mean
  if (isCoded(p, rows)) {
    const levels = new Map<string, (number | null)[]>()
    for (const r of rows) {
      const level = p.text ? p.text[r] : Number.isFinite(xv[r]!) ? String(xv[r]) : null
      const value = y[r] ?? Number.NaN
      if (!level || !Number.isFinite(value)) continue
      const list = levels.get(level) ?? []
      list.push(value)
      levels.set(level, list)
    }
    const sets = [...levels.entries()].map(([level, values], k) => ({
      key: `l${i}x${k}`,
      title: level,
      reps: [values],
    }))
    return {
      id: `p${i}`,
      title: `${outcome.title} by ${p.title}`,
      table: columnTable(`p${i}`, sets),
      preset: 'pointsOnly',
    }
  }
  const x: (number | null)[] = []
  const ys: (number | null)[] = []
  for (const r of rows) {
    if (!Number.isFinite(xv[r]!) || !Number.isFinite(y[r]!)) continue
    x.push(xv[r]!)
    ys.push(y[r]!)
  }
  return {
    id: `p${i}`,
    title: `${outcome.title} against ${p.title}`,
    table: xyTable(`p${i}`, x, [{ key: `y${i}`, title: outcome.title, reps: [ys] }], p.title),
    preset: 'each',
    axes: { xTitle: p.title, yTitle: outcome.title },
  }
}

/** The outcome and predictors of an analysis of variables, from its params. */
function rolesOf(id: string, input: readonly NormalizedDataSet[], params: Params) {
  if (id === 'coxRegression' || id === 'survivalFromVariables') {
    const time = keyOf(input, params.time, 0)
    const event = keyOf(input, id === 'coxRegression' ? params.event : params.status, 1)
    const groups = Array.isArray(params.groups) ? (params.groups as string[]) : null
    const predictors = input.filter(
      (d) =>
        d !== time &&
        d !== event &&
        (!groups || id !== 'survivalFromVariables' || groups.includes(d.ref.key)),
    )
    return { outcome: time, predictors, outcomeRole: 'Time' }
  }
  if (id === 'nonlinearFitMV') {
    const xv = keyOf(input, params.x, 0)
    const yv = keyOf(input, params.y, 1)
    return { outcome: yv, predictors: xv ? [xv] : [], outcomeRole: 'Y' }
  }
  const outcome = keyOf(input, params.y, 0)
  const factors = Array.isArray(params.factors) ? (params.factors as string[]) : []
  const predictors = input.filter(
    (d) => d !== outcome && (!factors.length || factors.includes(d.ref.key)),
  )
  return { outcome, predictors, outcomeRole: 'Outcome' }
}

/** The outcome against each predictor (§5.6). */
export function variablesSketch(
  id: string,
  input: readonly NormalizedDataSet[],
  params: Params,
  ctx: SketchContext,
): SketchSpec {
  const total = input.reduce((m, d) => Math.max(m, d.rowCount), 0)
  if (id === 'pca') {
    const { sampled } = sketchRows(input, ctx.maxRows)
    const numbers = input.filter((d) => !d.text && d.ref.key !== params.groupBy)
    const group = input.find((d) => d.ref.key === params.groupBy)
    return {
      panels: [],
      caption: `PCA finds the directions along which ${numbers.length} variables vary together${params.standardize === false ? '' : ', each standardized first'}.`,
      description: `${numbers.length} variables (${nameList(numbers.map((d) => d.title))})${group ? `, grouped by ${q(group.title)}` : ''}; ${total} rows.`,
      counts: countsLine([
        `${numbers.length} variables`,
        `${total} rows`,
        params.standardize === false ? 'raw' : 'standardized',
      ]),
      ...(sampled ? { sampled } : {}),
    }
  }
  const { outcome, predictors, outcomeRole } = rolesOf(id, input, params)
  if (!outcome)
    return {
      panels: [],
      caption: 'Choose the variables for each role.',
      description: 'No outcome chosen yet.',
      counts: '',
    }
  // Audit 4 (P3): SKETCH_MAX_POINTS over the panels drawn (two values a row each).
  const drawn = predictors.slice(0, MAX_PANELS)
  const { rows, sampled } = sketchRows(input, ctx.maxRows, 2 * Math.max(1, drawn.length))
  const panels = drawn.map((p, i) => panelOf(outcome, p, rows, i))
  const notes =
    predictors.length > MAX_PANELS
      ? [`The first ${MAX_PANELS} of ${predictors.length} predictors.`]
      : []
  return {
    panels,
    caption: `${outcomeRole}: ${q(outcome.title)}, against each of ${predictors.length} predictor${predictors.length === 1 ? '' : 's'}.`,
    description: `${outcomeRole} ${q(outcome.title)}; predictors ${nameList(predictors.map((d) => d.title)) || 'none'}; ${total} rows.`,
    counts: countsLine([
      `${outcomeRole}: ${outcome.title}`,
      `${predictors.length} predictor${predictors.length === 1 ? '' : 's'}`,
      `${total} rows`,
    ]),
    notes,
    ...(sampled ? { sampled } : {}),
  }
}
