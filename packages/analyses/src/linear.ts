import type {
  AnalysisDef,
  AnalysisResult,
  GraphableDataSet,
  ResultBlock,
  ResultValue,
} from '@ps/model'
import {
  compareLinear,
  fittedLine,
  type LinearFit,
  linearBand,
  linearRegression,
  valueRange,
} from '@ps/stats'
import { z } from 'zod'
import {
  CONFIDENCE_FIELD,
  confidenceLevel,
  curveXs,
  exclusionNotes,
  failure,
  int,
  interval,
  kv,
  labelTable,
  missingXNote,
  num,
  pct,
  pSig,
  psum,
  pval,
  result,
  resultsSheet,
  significance,
  text,
  UNDEFINED,
} from './common.ts'
import {
  DIAGNOSTIC_FIELDS,
  Diagnostics,
  diagnosticBlocks,
  INTERPOLATE_FIELD,
  interpolation,
  meanPointRows,
  residualOutputs,
  residualsSheet,
  xyPointRows,
} from './curveTools.ts'

const Params = z.object({
  throughOrigin: z.boolean().default(false),
  /** Force the line through (pointX, pointY) instead (ignored with throughOrigin). */
  throughPoint: z.boolean().default(false),
  pointX: z.number().default(0),
  pointY: z.number().default(0),
  /** Fit every replicate Y as its own point (Prism's default), or only the mean Y of each row. */
  replicates: z.enum(['each', 'mean']).default('each'),
  band: z.enum(['none', 'confidence', 'prediction']).default('none'),
  compare: z.boolean().default(true),
  interpolate: z.boolean().default(false),
  diagnostics: Diagnostics,
  confidenceLevel,
})
type Params = z.infer<typeof Params>

const BAND_FIELD = {
  path: ['band'],
  label: 'Show on graph',
  kind: 'radio',
  options: [
    { value: 'none', label: 'Best-fit line only' },
    { value: 'confidence', label: 'Confidence band of the line' },
    { value: 'prediction', label: 'Prediction band (where new points are expected)' },
  ],
} as const

const fmtEq = (f: LinearFit, origin: boolean) => {
  if (!Number.isFinite(f.slope) || !Number.isFinite(f.intercept)) return UNDEFINED
  const s = f.slope.toPrecision(4)
  if (origin && f.intercept === 0) return `Y = ${s}*X`
  const b = f.intercept
  return `Y = ${s}*X ${b < 0 ? '−' : '+'} ${Math.abs(b).toPrecision(4)}`
}

export const linearRegressionDef: AnalysisDef<Params> = {
  id: 'linearRegression',
  version: 1,
  title: 'Simple linear regression',
  category: 'XY analyses',
  description: 'Fit a straight line to each data set; test whether slopes and intercepts differ.',
  accepts: ['xy'],
  inputs: { min: 1, max: Number.POSITIVE_INFINITY },
  params: Params,
  form: [
    {
      path: ['throughOrigin'],
      label: 'Force the line through the origin (X = 0, Y = 0)',
      kind: 'checkbox',
    },
    {
      path: ['throughPoint'],
      label: 'Force the line through another point',
      kind: 'checkbox',
      showIf: { path: ['throughOrigin'], in: [false] },
    },
    {
      path: ['pointX'],
      label: 'X of the point',
      kind: 'number',
      showIf: [
        { path: ['throughOrigin'], in: [false] },
        { path: ['throughPoint'], in: [true] },
      ],
    },
    {
      path: ['pointY'],
      label: 'Y of the point',
      kind: 'number',
      showIf: [
        { path: ['throughOrigin'], in: [false] },
        { path: ['throughPoint'], in: [true] },
      ],
    },
    {
      path: ['replicates'],
      label: 'Replicate Y values',
      kind: 'radio',
      options: [
        { value: 'each', label: 'Consider each replicate Y value as an individual point' },
        { value: 'mean', label: 'Only consider the mean Y value of each point' },
      ],
      help: 'Fit the means when the replicates are not independent (e.g. repeated measurements of one animal per X).',
    },
    {
      path: ['compare'],
      label: 'Test whether slopes and intercepts are significantly different',
      kind: 'checkbox',
      showIf: [
        { path: ['throughOrigin'], in: [false] },
        { path: ['throughPoint'], in: [false] },
      ],
    },
    INTERPOLATE_FIELD,
    BAND_FIELD,
    ...DIAGNOSTIC_FIELDS,
    CONFIDENCE_FIELD,
  ],
  outputs: (keys, params) => [
    ...keys.map((k) => ({ key: `line:${k}`, forDataSet: k })),
    ...(params.diagnostics?.residuals ? residualOutputs(keys) : []),
  ],
  run(input, params, context): AnalysisResult {
    const diagnostics = [...exclusionNotes(input), ...missingXNote(input)]
    const level = pct(params.confidenceLevel)
    const point = params.throughOrigin
      ? { x: 0, y: 0 }
      : params.throughPoint
        ? { x: params.pointX, y: params.pointY }
        : null
    const constrained = point !== null
    const minN = constrained ? 2 : 3
    const fits = input.map((ds) => {
      const pts = params.replicates === 'mean' ? meanPointRows(ds) : xyPointRows(ds)
      const x = Float64Array.from(pts, (p) => p.x)
      const y = Float64Array.from(pts, (p) => p.y)
      if (x.length < minN) {
        diagnostics.push({
          level: 'warning',
          message: `“${ds.title}” has fewer than ${minN} points; no line was fit.`,
        })
        return null
      }
      if (x.every((v) => v === x[0]))
        diagnostics.push({
          level: 'warning',
          message: `Every X of “${ds.title}” is the same, so the slope can’t be determined.`,
        })
      return {
        ds,
        pts,
        x,
        y,
        fit: linearRegression(x, y, {
          ...(point ? { throughPoint: point } : {}),
          confLevel: params.confidenceLevel,
        }),
      }
    })
    const ok = fits.filter((f) => f !== null)
    if (ok.length === 0)
      return failure(`No data set has enough points for a line (at least ${minN}).`, diagnostics)

    const cols = ok.map((f) => f.ds.title)
    const each = (g: (f: LinearFit) => ResultValue) => ok.map((f) => g(f.fit))
    const blocks: ResultBlock[] = [
      labelTable('Best-fit values', cols, [
        ['Slope', each((f) => num(f.slope))],
        ...(params.throughOrigin
          ? []
          : ([['Y-intercept', each((f) => num(f.intercept))]] as [string, ResultValue[]][])),
        ['X-intercept', each((f) => num(f.xIntercept))],
        ['1/slope', each((f) => num(f.inverseSlope))],
      ]),
      labelTable('Std. Error', cols, [
        ['Slope', each((f) => num(f.slopeSE))],
        ...(constrained
          ? []
          : ([['Y-intercept', each((f) => num(f.interceptSE))]] as [string, ResultValue[]][])),
      ]),
      labelTable(`${level} Confidence Intervals`, cols, [
        ['Slope', each((f) => interval(f.slopeLo, f.slopeHi, params.confidenceLevel))],
        ...(constrained
          ? []
          : ([
              [
                'Y-intercept',
                each((f) => interval(f.interceptLo, f.interceptHi, params.confidenceLevel)),
              ],
            ] as [string, ResultValue[]][])),
        ...(constrained
          ? []
          : ([
              [
                'X-intercept',
                each((f) => interval(f.xInterceptLo, f.xInterceptHi, params.confidenceLevel)),
              ],
            ] as [string, ResultValue[]][])),
      ]),
      // Prism reports no R² when the line is constrained (it would be ambiguous).
      labelTable('Goodness of Fit', cols, [
        ...(constrained
          ? []
          : ([['R squared', each((f) => num(f.r2))]] as [string, ResultValue[]][])),
        ['Sy.x', each((f) => num(f.syx))],
      ]),
      labelTable('Is slope significantly non-zero?', cols, [
        ['F', each((f) => num(f.F))],
        ['DFn, DFd', each((f) => text(`${f.dfn}, ${f.dfd}`))],
        ['P value', each((f) => pval(f.p))],
        ['P value summary', each((f) => psum(f.p))],
        ['Deviation from zero?', each((f) => significance(f.p))],
      ]),
      labelTable('Equation', cols, [['', each((f) => text(fmtEq(f, constrained)))]]),
      labelTable('Data', cols, [
        ['Number of points analyzed', ok.map((f) => int(f.x.length))],
        ...(params.replicates === 'mean'
          ? ([['Fit to', ok.map(() => text('Mean Y of each row'))]] as [string, ResultValue[]][])
          : []),
      ]),
    ]
    if (point && !params.throughOrigin)
      blocks.push({
        type: 'note',
        text: `The line was forced through X = ${point.x}, Y = ${point.y}; only the slope was fit.`,
      })

    const sheets = [resultsSheet(blocks)]
    if (params.compare && ok.length >= 2 && !constrained) {
      const c = compareLinear(ok.map((f) => ({ x: f.x, y: f.y })))
      const compareBlocks: ResultBlock[] = [
        kv('Are the slopes equal?', [
          ['F', num(c.slopes.F)],
          ['DFn, DFd', text(`${c.slopes.dfn}, ${c.slopes.dfd}`)],
          ...pSig(c.slopes.p, 'Slopes significantly different'),
        ]),
      ]
      if (c.intercepts) {
        compareBlocks.push(
          kv('Are the elevations or intercepts equal?', [
            ['Pooled slope', num(c.pooledSlope)],
            ['F', num(c.intercepts.F)],
            ['DFn, DFd', text(`${c.intercepts.dfn}, ${c.intercepts.dfd}`)],
            ...pSig(c.intercepts.p, 'Intercepts significantly different'),
          ]),
        )
      } else {
        compareBlocks.push({
          type: 'note',
          text: 'The slopes differ, so it is not meaningful to compare intercepts.',
        })
        if (ok.length === 2) {
          // Where the two lines cross (Prism's guide gives this when the slopes differ).
          const [a, b] = [ok[0]!.fit, ok[1]!.fit]
          const xc = (b.intercept - a.intercept) / (a.slope - b.slope)
          compareBlocks.push(
            kv('Intersection of the two lines', [
              ['X', num(xc)],
              ['Y', num(a.intercept + a.slope * xc)],
            ]),
          )
        }
      }
      sheets.push({ key: 'compare', title: 'Compare slopes and intercepts', blocks: compareBlocks })
    }

    const outputs: Record<string, GraphableDataSet> = {}
    const dg = params.diagnostics
    const residualSets = ok.map((f) => ({
      ds: f.ds,
      points: f.pts,
      residuals: f.pts.map((p) => p.y - (f.fit.intercept + f.fit.slope * p.x)),
      ss: f.fit.ssResidual,
      df: f.fit.df,
    }))
    if (dg.runsTest || dg.replicatesTest || dg.normality)
      sheets.push({
        key: 'diagnostics',
        title: 'Diagnostics',
        blocks: diagnosticBlocks(residualSets, dg),
      })
    if (dg.residuals) sheets.push(residualsSheet(residualSets, 'line', outputs))
    let resultTable: AnalysisResult['table']
    if (params.interpolate) {
      const r = interpolation(
        input,
        ok,
        (f) => fittedLine(f.fit, params.confidenceLevel),
        params.confidenceLevel,
        context,
      )
      sheets.push(r.sheet)
      resultTable = r.table
    }
    for (const f of ok) {
      const [lo, hi] = valueRange(f.x)
      const xs = params.band === 'none' ? Float64Array.of(lo, hi) : curveXs(lo, hi, 100)
      const b = linearBand(f.fit, xs, {
        confLevel: params.confidenceLevel,
        kind: params.band === 'prediction' ? 'prediction' : 'confidence',
      })
      outputs[`line:${f.ds.ref.key}`] = {
        title: `${f.ds.title} (line)`,
        x: [...xs],
        y: [...b.y],
        ...(params.band === 'none' ? {} : { lo: [...b.lo], hi: [...b.hi] }),
      }
    }

    return result({
      diagnostics,
      sheets,
      values: Object.fromEntries(
        ok.flatMap((f) => [
          [`slope:${f.ds.ref.key}`, num(f.fit.slope)],
          [`intercept:${f.ds.ref.key}`, num(f.fit.intercept)],
        ]),
      ),
      outputs,
      table: resultTable,
    })
  },
}
