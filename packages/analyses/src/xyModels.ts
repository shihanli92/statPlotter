import type {
  AnalysisDef,
  AnalysisResult,
  GraphableDataSet,
  NormalizedDataSet,
  OutputDecl,
  ResultBlock,
  ResultSheet,
  ResultValue,
} from '@ps/model'
import {
  type DemingFit,
  demingRegression,
  type LogisticResult,
  logisticRegression,
  rocCurve,
  valueRange,
} from '@ps/stats'
import { z } from 'zod'
import {
  CONFIDENCE_FIELD,
  confidenceLevel,
  curveXs,
  exclusionNotes,
  expit,
  failure,
  int,
  interval,
  labelTable,
  missingXNote,
  num,
  pct,
  psum,
  pval,
  result,
  resultsSheet,
  significance,
  table,
  text,
  UNDEFINED,
  yCols,
} from './common.ts'
import { xyPointRows } from './curveTools.ts'
import { rowName } from './grouped.ts'

// XY analyses of roadmap item 18: Deming (model II) regression and simple logistic regression.
// Both fit each analyzed data set on its own (every replicate a point) and put a curve on graphs
// of the table, like simple linear regression.

// ---------------------------------------------------------------------------------------------
// Deming regression
// ---------------------------------------------------------------------------------------------

const DemingParams = z.object({
  /** X and Y equally uncertain (orthogonal regression), or entered SDs of the X and Y errors. */
  errors: z.enum(['equal', 'sd']).default('equal'),
  sdX: z.number().gt(0).default(1),
  sdY: z.number().gt(0).default(1),
  /** Report Y (with SE and CI) at this X; 0 = the Y intercept. */
  xForY: z.number().default(0),
  confidenceLevel,
})
type DemingParams = z.infer<typeof DemingParams>

const fmtLine = (slope: number, intercept: number) =>
  !Number.isFinite(slope) || !Number.isFinite(intercept)
    ? UNDEFINED
    : `Y = ${slope.toPrecision(4)}*X ${intercept < 0 ? '−' : '+'} ${Math.abs(intercept).toPrecision(4)}`

export const demingDef: AnalysisDef<DemingParams> = {
  id: 'deming',
  version: 1,
  title: 'Deming (model II) linear regression',
  category: 'XY analyses',
  description:
    'Fit a straight line when both X and Y are measured with error (method comparison): X and Y equally uncertain, or entered SDs of each.',
  accepts: ['xy'],
  inputs: { min: 1, max: Number.POSITIVE_INFINITY },
  params: DemingParams,
  form: [
    {
      path: ['errors'],
      label: 'Uncertainty of X and Y',
      kind: 'radio',
      options: [
        { value: 'equal', label: 'X and Y have equal uncertainty (same units; orthogonal)' },
        { value: 'sd', label: 'X and Y have different uncertainties: enter the SD of each' },
      ],
    },
    {
      path: ['sdX'],
      label: 'SD of X errors',
      kind: 'number',
      min: 0,
      showIf: { path: ['errors'], in: ['sd'] },
    },
    {
      path: ['sdY'],
      label: 'SD of Y errors',
      kind: 'number',
      min: 0,
      showIf: { path: ['errors'], in: ['sd'] },
    },
    { path: ['xForY'], label: 'Report Y (with its CI) when X =', kind: 'number' },
    CONFIDENCE_FIELD,
  ],
  outputs: (keys) => keys.map((k) => ({ key: `line:${k}`, forDataSet: k })),
  run(input, params): AnalysisResult {
    const diagnostics = [...exclusionNotes(input), ...missingXNote(input)]
    const lambda = params.errors === 'equal' ? 1 : (params.sdX / params.sdY) ** 2
    const level = params.confidenceLevel
    const fits: { ds: NormalizedDataSet; x: Float64Array; fit: DemingFit }[] = []
    for (const ds of input) {
      const pts = xyPointRows(ds)
      const x = Float64Array.from(pts, (p) => p.x)
      const y = Float64Array.from(pts, (p) => p.y)
      if (x.length < 3) {
        diagnostics.push({
          level: 'warning',
          message: `“${ds.title}” has fewer than 3 points; no line was fit.`,
        })
        continue
      }
      if (x.every((v) => v === x[0]) || y.every((v) => v === y[0])) {
        diagnostics.push({
          level: 'warning',
          message: `Every X or every Y of “${ds.title}” is the same; no line was fit.`,
        })
        continue
      }
      fits.push({
        ds,
        x,
        fit: demingRegression(x, y, { lambda, confLevel: level, xForY: params.xForY }),
      })
    }
    if (!fits.length) return failure('No data set has enough points for a line.', diagnostics)
    const cols = fits.map((f) => f.ds.title)
    const each = (g: (f: DemingFit) => ResultValue) => fits.map((f) => g(f.fit))
    const yAt = `Y when X = ${params.xForY}`
    const blocks: ResultBlock[] = [
      labelTable('Best-fit values', cols, [
        ['Slope', each((f) => num(f.slope))],
        ['Y-intercept', each((f) => num(f.intercept))],
        ['X-intercept', each((f) => num(f.xIntercept))],
        ['1/slope', each((f) => num(f.inverseSlope))],
      ]),
      labelTable('Std. Error', cols, [
        ['Slope', each((f) => num(f.slopeSE))],
        ['Y-intercept', each((f) => num(f.interceptSE))],
      ]),
      labelTable(`${pct(level)} Confidence Intervals`, cols, [
        ['Slope', each((f) => interval(f.slopeLo, f.slopeHi, level))],
        ['Y-intercept', each((f) => interval(f.interceptLo, f.interceptHi, level))],
      ]),
      labelTable(yAt, cols, [
        ['Y', each((f) => num(f.yAtX.y))],
        ['Std. Error', each((f) => num(f.yAtX.se))],
        [`${pct(level)} CI`, each((f) => interval(f.yAtX.lo, f.yAtX.hi, level))],
      ]),
      labelTable('Is slope significantly non-zero?', cols, [
        ['F', each((f) => num(f.F))],
        ['DFn, DFd', each((f) => text(`1, ${f.df}`))],
        ['P value', each((f) => pval(f.p))],
        ['P value summary', each((f) => psum(f.p))],
        ['Deviation from zero?', each((f) => significance(f.p))],
      ]),
      labelTable('Equation', cols, [['', each((f) => text(fmtLine(f.slope, f.intercept)))]]),
      labelTable('Data', cols, [
        ['Number of points analyzed', fits.map((f) => int(f.fit.n))],
        ['λ = (SD of X errors / SD of Y errors)²', fits.map(() => num(lambda))],
      ]),
      {
        type: 'note',
        text: 'Deming regression reports no R²: it has no generally accepted meaning here.',
      },
    ]
    const outputs: Record<string, GraphableDataSet> = {}
    for (const f of fits) {
      const [lo, hi] = valueRange(f.x)
      outputs[`line:${f.ds.ref.key}`] = {
        title: `${f.ds.title} (Deming line)`,
        x: [lo, hi],
        y: [f.fit.intercept + f.fit.slope * lo, f.fit.intercept + f.fit.slope * hi],
      }
    }
    return result({
      blocks,
      diagnostics,
      values: Object.fromEntries(
        fits.flatMap((f) => [
          [`slope:${f.ds.ref.key}`, num(f.fit.slope)],
          [`intercept:${f.ds.ref.key}`, num(f.fit.intercept)],
        ]),
      ),
      outputs,
    })
  },
}

// ---------------------------------------------------------------------------------------------
// Simple logistic regression (XY table, Y = 0 or 1)
// ---------------------------------------------------------------------------------------------

const LogisticXYParams = z.object({
  ciMethod: z.enum(['profile', 'wald']).default('profile'),
  /** ROC curve (output graph) and its area. */
  roc: z.boolean().default(true),
  /** "Classification of each subject": predicted probability for every row with an X. */
  rowPrediction: z.boolean().default(true),
  /** Draw the curve over [min X, max X] of the data, or over the range entered. */
  range: z.enum(['data', 'custom']).default('data'),
  rangeMin: z.number().default(0),
  rangeMax: z.number().default(1),
  confidenceLevel,
})
type LogisticXYParams = z.infer<typeof LogisticXYParams>

export const simpleLogisticDef: AnalysisDef<LogisticXYParams> = {
  id: 'simpleLogistic',
  version: 1,
  title: 'Simple logistic regression',
  category: 'XY analyses',
  description:
    'Model the probability that Y = 1 (Y coded 0 or 1) from X: β0, β1, odds ratio, X at 50%, likelihood-ratio test, pseudo R² and ROC area, with the logistic curve on the graph.',
  accepts: ['xy'],
  inputs: { min: 1, max: Number.POSITIVE_INFINITY },
  params: LogisticXYParams,
  form: [
    {
      path: ['ciMethod'],
      label: 'Confidence intervals',
      kind: 'radio',
      options: [
        { value: 'profile', label: 'Profile likelihood (recommended)' },
        { value: 'wald', label: 'Wald (asymptotic)' },
      ],
    },
    { path: ['roc'], label: 'ROC curve and area under it', kind: 'checkbox' },
    {
      path: ['rowPrediction'],
      label: 'Classification of each subject (predicted probability for every X)',
      kind: 'checkbox',
    },
    {
      path: ['range'],
      label: 'Plot the curve over',
      kind: 'radio',
      options: [
        { value: 'data', label: 'The range of the X values' },
        { value: 'custom', label: 'A range I enter' },
      ],
    },
    {
      path: ['rangeMin'],
      label: 'Start at X =',
      kind: 'number',
      showIf: { path: ['range'], in: ['custom'] },
    },
    {
      path: ['rangeMax'],
      label: 'End at X =',
      kind: 'number',
      showIf: { path: ['range'], in: ['custom'] },
    },
    CONFIDENCE_FIELD,
  ],
  outputs: (keys, params) => [
    ...keys.map((k): OutputDecl => ({ key: `curve:${k}`, forDataSet: k })),
    ...(params.roc
      ? keys.map(
          (k): OutputDecl => ({
            key: `roc:${k}`,
            forDataSet: k,
            graph: {
              id: 'roc',
              name: 'ROC curve',
              xTitle: '1 − Specificity',
              yTitle: 'Sensitivity',
              xRange: [0, 1],
              yRange: [0, 1],
              square: true,
            },
          }),
        )
      : []),
  ],
  run(input, params): AnalysisResult {
    const diagnostics = [...exclusionNotes(input), ...missingXNote(input)]
    const level = params.confidenceLevel
    const fits: { ds: NormalizedDataSet; x: number[]; y: number[]; res: LogisticResult }[] = []
    for (const ds of input) {
      const pts = xyPointRows(ds)
      const x = pts.map((p) => p.x)
      const y = pts.map((p) => p.y)
      if (y.some((v) => v !== 0 && v !== 1))
        return failure(`The Y values of “${ds.title}” must be coded 0 or 1.`, diagnostics)
      if (y.length < 3) {
        diagnostics.push({
          level: 'warning',
          message: `“${ds.title}” has fewer than 3 points; no curve was fit.`,
        })
        continue
      }
      if (y.every((v) => v === y[0])) {
        diagnostics.push({
          level: 'warning',
          message: `Every Y of “${ds.title}” is ${y[0]}; logistic regression needs both 0s and 1s.`,
        })
        continue
      }
      const res = logisticRegression(
        y,
        x.map((v) => [v]),
        ['X'],
        { confLevel: level, ciMethod: params.ciMethod },
      )
      if (res.status === 'separation')
        diagnostics.push({
          level: 'warning',
          message: `X perfectly separates the 0s and 1s of “${ds.title}”, so the coefficients can’t be estimated.`,
        })
      else if (res.status !== 'ok')
        diagnostics.push({
          level: 'warning',
          message: `The fit of “${ds.title}” did not converge (or every X is the same).`,
        })
      fits.push({ ds, x, y, res })
    }
    if (!fits.length) return failure('No data set can be fit.', diagnostics)
    const cols = fits.map((f) => f.ds.title)
    const each = (g: (r: LogisticResult) => ResultValue) => fits.map((f) => g(f.res))
    const b0 = (r: LogisticResult) => r.coefficients[0]!
    const b1 = (r: LogisticResult) => r.coefficients[1]!
    const blocks: ResultBlock[] = [
      labelTable('Best-fit values', cols, [
        ['β0', each((r) => num(b0(r).estimate))],
        ['β1', each((r) => num(b1(r).estimate))],
        ['X at 50%', each((r) => num(-b0(r).estimate / b1(r).estimate))],
      ]),
      labelTable('Std. Error', cols, [
        ['β0', each((r) => num(b0(r).se))],
        ['β1', each((r) => num(b1(r).se))],
      ]),
      labelTable(
        `${pct(level)} CI (${params.ciMethod === 'profile' ? 'profile likelihood' : 'Wald'})`,
        cols,
        [
          ['β0', each((r) => interval(b0(r).lower, b0(r).upper, level))],
          ['β1', each((r) => interval(b1(r).lower, b1(r).upper, level))],
        ],
      ),
      labelTable('Odds ratios', cols, [
        ['β0', each((r) => num(b0(r).oddsRatio))],
        ['β1', each((r) => num(b1(r).oddsRatio))],
        [`β0 ${pct(level)} CI`, each((r) => interval(b0(r).orLower, b0(r).orUpper, level))],
        [`β1 ${pct(level)} CI`, each((r) => interval(b1(r).orLower, b1(r).orUpper, level))],
      ]),
      labelTable('Is β1 different from zero? (Wald test)', cols, [
        ['|Z|', each((r) => num(Math.abs(b1(r).stat)))],
        ['P value', each((r) => pval(b1(r).p))],
        ['P value summary', each((r) => psum(b1(r).p))],
      ]),
      labelTable('Likelihood ratio test (vs. the intercept-only model)', cols, [
        ['Chi square', each((r) => num(r.lrChiSq))],
        ['df', each((r) => int(r.lrDf))],
        ['P value', each((r) => pval(r.lrP))],
        ['P value summary', each((r) => psum(r.lrP))],
      ]),
      labelTable('Goodness of fit', cols, [
        ['Tjur’s R squared', each((r) => num(r.pseudoR2.tjur))],
        ['Cox-Snell’s R squared', each((r) => num(r.pseudoR2.coxSnell))],
        ['Model deviance (G²)', each((r) => num(-2 * r.logLik))],
        ['AICc', each((r) => num(r.aicc))],
      ]),
      ...(params.roc
        ? [
            labelTable('Area under the ROC curve', cols, [
              ['Area', each((r) => num(r.auc.value))],
              ['Std. Error', each((r) => num(r.auc.se))],
              [`${pct(level)} CI`, each((r) => interval(r.auc.lower, r.auc.upper, level))],
              ['P value', each((r) => pval(r.auc.p))],
            ]),
          ]
        : []),
      labelTable('Data summary', cols, [
        ['Number of observations', each((r) => int(r.n))],
        ['Number of 1s', each((r) => int(r.nEvents))],
        ['Number of 0s', each((r) => int(r.n - r.nEvents))],
      ]),
    ]
    const sheets: ResultSheet[] = [resultsSheet(blocks)]
    const outputs: Record<string, GraphableDataSet> = {}
    for (const f of fits) {
      if (f.res.status === 'separation') continue
      const beta0 = b0(f.res).estimate
      const beta1 = b1(f.res).estimate
      const [lo, hi] =
        params.range === 'custom' ? [params.rangeMin, params.rangeMax] : valueRange(f.x)
      const xs = [...curveXs(Math.min(lo, hi), Math.max(lo, hi))]
      outputs[`curve:${f.ds.ref.key}`] = {
        title: `${f.ds.title} (logistic curve)`,
        x: xs,
        y: xs.map((v) => expit(beta0 + beta1 * v)),
      }
      if (params.roc) {
        const controls = f.res.fitted.filter((_, i) => f.y[i] === 0)
        const patients = f.res.fitted.filter((_, i) => f.y[i] === 1)
        const roc = rocCurve(controls, patients, { direction: 'higher' })
        outputs[`roc:${f.ds.ref.key}`] = {
          title: `${f.ds.title} (ROC)`,
          x: roc.curve.map((p) => p.x),
          y: roc.curve.map((p) => p.y),
        }
      }
    }
    if (params.rowPrediction) {
      sheets.push({
        key: 'rows',
        title: 'Row prediction',
        blocks: fits
          .filter((f) => f.res.status !== 'separation')
          .map((f): ResultBlock => {
            const ds = f.ds
            const beta0 = b0(f.res).estimate
            const beta1 = b1(f.res).estimate
            const rows: ResultValue[][] = []
            for (let r = 0; r < ds.rowCount; r++) {
              const xv = ds.x?.[r] ?? Number.NaN
              if (Number.isNaN(xv)) continue
              const ys = yCols(ds)
                .map((c) => c[r]!)
                .filter((v) => !Number.isNaN(v))
              rows.push([
                text(rowName(ds, r)),
                num(xv),
                text(ys.join(', ')),
                num(expit(beta0 + beta1 * xv)),
              ])
            }
            return table(
              `Predicted probability that Y = 1, ${ds.title}`,
              ['Row', 'X', 'Observed Y', 'Predicted probability'],
              rows,
            )
          }),
      })
    }
    return result({
      diagnostics,
      sheets,
      values: Object.fromEntries(
        fits.flatMap((f) => [
          [`beta0:${f.ds.ref.key}`, num(b0(f.res).estimate)],
          [`beta1:${f.ds.ref.key}`, num(b1(f.res).estimate)],
          [`p:${f.ds.ref.key}`, pval(f.res.lrP)],
        ]),
      ),
      outputs,
    })
  },
}
