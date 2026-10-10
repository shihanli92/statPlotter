import type {
  AnalysisResult,
  DataTable,
  Diagnostic,
  NormalizedDataSet,
  ResultValue,
} from '@ps/model'
import { designRow, linearPredictor, predictionInterval } from '@ps/stats'
import { interval, num, pct, table, text } from './common.ts'
import { rowTitleOf } from './grouped.ts'
import { cellsOf, labelOf, type PreparedModel } from './mvVariables.ts'
import { buildTable, type OutDataSet, stableId } from './resultTable.ts'

// ---------------------------------------------------------------------------------------------
// Prediction ("interpolation") from the regression models of multiple-variables tables, as
// Prism's Interpolation tab: (1) the table's rows with a value for every predictor but no
// outcome, and (2) points whose predictor values the user enters. A numeric predictor left blank
// in a point takes the mean of its analyzed values, a categorical one its reference level.
//
// The predicted outcome at design row x is g⁻¹(x·β) with a CI from the SE of x·β — t with the
// residual df for least squares, z (Wald, on the link scale, then transformed) for logistic
// (probability) and Poisson (expected count) regression. The results are a sheet and a
// multiple-variables result table (predictors, predicted value and CI limits) that can be
// graphed or analyzed further.
// ---------------------------------------------------------------------------------------------

interface PredictPoint {
  label: string
  /** Value of each predictor of the model: a number, or a level index. */
  values: (number | { level: number })[]
  /** Values as shown (numbers, or level labels). */
  shown: (number | string)[]
}

function predictionPoints(
  input: readonly NormalizedDataSet[],
  m: PreparedModel,
  interpolate: boolean,
  points: readonly Readonly<Record<string, number | string>>[],
): { points: PredictPoint[]; diagnostics: Diagnostic[] } {
  const out: PredictPoint[] = []
  const diagnostics: Diagnostic[] = []
  const cells = m.predictors.map((p) => cellsOf(input[p.index]!))
  let unknown = 0
  if (interpolate) {
    for (const r of m.predictRows) {
      const values: PredictPoint['values'] = []
      const shown: PredictPoint['shown'] = []
      let ok = true
      m.predictors.forEach((p, k) => {
        const c = cells[k]!
        if (!p.categorical) {
          const v = c.values[r] as number
          values.push(v)
          shown.push(v)
          return
        }
        const l = p.levels.indexOf(labelOf(c, r)!)
        if (l < 0) ok = false
        values.push({ level: l })
        shown.push(labelOf(c, r)!)
      })
      if (!ok) {
        unknown++
        continue
      }
      out.push({ label: rowTitleOf(input, r), values, shown })
    }
    if (unknown)
      diagnostics.push({
        level: 'info',
        message: `${unknown} row${unknown > 1 ? 's have' : ' has'} a level the model wasn’t fit with and ${unknown > 1 ? 'were' : 'was'} not interpolated.`,
      })
  }
  points.forEach((pt, i) => {
    const values: PredictPoint['values'] = []
    const shown: PredictPoint['shown'] = []
    let bad: string | null = null
    m.predictors.forEach((p, k) => {
      const given = pt[p.key]
      if (!p.categorical) {
        const x =
          given === undefined || given === ''
            ? mean(m.designVars[k]!.kind === 'numeric' ? m.designVars[k]!.values : [])
            : Number(given)
        if (!Number.isFinite(x)) bad = `${p.title} = ${given}`
        values.push(x)
        shown.push(x)
        return
      }
      const label = given === undefined || given === '' ? null : String(given).trim()
      const l = label === null ? p.reference : p.levels.indexOf(label)
      if (l < 0) bad = `${p.title} = ${label}`
      values.push({ level: l })
      shown.push(p.levels[l] ?? String(label))
    })
    if (bad !== null) {
      diagnostics.push({
        level: 'warning',
        message: `Point ${i + 1} was not predicted: ${bad} is not a value of the model.`,
      })
      return
    }
    out.push({ label: `Point ${i + 1}`, values, shown })
  })
  return { points: out, diagnostics }
}

function mean(v: readonly number[]): number {
  let s = 0
  for (const x of v) s += x
  return s / v.length
}

interface PredictionOutput {
  sheet: AnalysisResult['sheets'][number]
  table: DataTable
}

/**
 * Predicted values with CIs for the points, as a sheet and a result table. `coef` / `cov` are the
 * fit's (intercept first when `intercept`); `inverse` maps the linear predictor to the outcome
 * scale; `df` gives t-based CIs (least squares), else z.
 */
function predictionOutput(
  input: readonly NormalizedDataSet[],
  m: PreparedModel,
  points: readonly PredictPoint[],
  fit: {
    coef: readonly number[]
    cov: readonly (readonly number[])[]
    intercept: boolean
    confLevel: number
    df?: number
    inverse?: (eta: number) => number
  },
  yName: string,
  what: string,
): PredictionOutput {
  const inv = fit.inverse ?? ((e: number) => e)
  const level = fit.confLevel
  const pred = points.map((pt) => {
    const x = [...(fit.intercept ? [1] : []), ...designRow(m.designVars, m.terms, pt.values)]
    const p = linearPredictor(fit.coef, fit.cov, x)
    const ci = predictionInterval(p, level, fit.df)
    return { value: inv(p.eta), lower: inv(ci.lower), upper: inv(ci.upper) }
  })
  const head = m.predictors.map((p) => p.title)
  const rows: ResultValue[][] = points.map((pt, i) => [
    text(pt.label),
    ...pt.shown.map((v) => (typeof v === 'number' ? num(v) : text(v))),
    num(pred[i]!.value),
    interval(pred[i]!.lower, pred[i]!.upper, level),
  ])
  const sheet = {
    key: 'interpolated',
    title: 'Interpolated values',
    blocks: [
      table(
        `Predicted ${what} of ${yName}`,
        ['', ...head, `Predicted ${what}`, `${pct(level)} CI`],
        rows,
      ),
    ],
  }
  const dataSets: OutDataSet[] = m.predictors.map((p, k) => {
    const shown = points.map((pt) => pt.shown[k]!)
    return p.categorical && input[p.index]!.text
      ? { id: stableId(p.key), title: p.title, subcolumns: [], text: shown.map(String) }
      : {
          id: stableId(p.key),
          title: p.title,
          subcolumns: [
            Float64Array.from(points, (pt) => {
              const v = pt.shown[k]!
              return typeof v === 'number' ? v : Number(v)
            }),
          ],
        }
  })
  dataSets.push(
    {
      id: stableId('predicted', yName),
      title: `Predicted ${yName}`,
      subcolumns: [Float64Array.from(pred, (p) => p.value)],
    },
    {
      id: stableId('lower', yName),
      title: `Lower ${pct(level)} CI`,
      subcolumns: [Float64Array.from(pred, (p) => p.lower)],
    },
    {
      id: stableId('upper', yName),
      title: `Upper ${pct(level)} CI`,
      subcolumns: [Float64Array.from(pred, (p) => p.upper)],
    },
  )
  return {
    sheet,
    table: buildTable(input, {
      name: 'Interpolated values',
      tableKind: 'multipleVariables',
      rowCount: points.length,
      rowTitles: points.map((p) => p.label),
      x: null,
      dataSets,
      notes: `Predicted ${what} of ${yName} from the model, with ${pct(level)} confidence intervals.`,
    }),
  }
}

/**
 * The predictions asked for (the rows to interpolate and the entered points, when either is
 * chosen), adding the points' notes to `diagnostics`. `fit` is null when the fit has no estimates:
 * nothing is predicted and `notes.unusable` (if given) says so; `notes.empty` is the note when
 * interpolation finds no rows or points.
 */
export function addPredictions(
  input: readonly NormalizedDataSet[],
  m: PreparedModel,
  params: {
    interpolate: boolean
    predictions: readonly Readonly<Record<string, number | string>>[]
  },
  diagnostics: Diagnostic[],
  fit: Parameters<typeof predictionOutput>[3] | null,
  yName: string,
  what: string,
  notes: { unusable?: string; empty?: string } = {},
): PredictionOutput | undefined {
  if (!params.interpolate && !params.predictions.length) return undefined
  const pts = predictionPoints(input, m, params.interpolate, params.predictions)
  diagnostics.push(...pts.diagnostics)
  const note = (message?: string) => {
    if (message) diagnostics.push({ level: 'info', message })
  }
  if (!fit) note(notes.unusable)
  else if (pts.points.length) return predictionOutput(input, m, pts.points, fit, yName, what)
  else if (params.interpolate) note(notes.empty)
  return undefined
}
