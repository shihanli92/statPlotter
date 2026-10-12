import type {
  AnalysisDef,
  AnalysisResult,
  DataTable,
  NormalizedDataSet,
  ResultBlock,
  RunContext,
} from '@ps/model'
import {
  akimaSpline,
  type Curve,
  lowess,
  naturalCubicSpline,
  pointToPoint,
  regressionSpline,
} from '@ps/stats'
import { z } from 'zod'
import { exclusionNotes, failure, int, labelTable, missingXNote, num, result } from './common.ts'
import { xyPointRows } from './curveTools.ts'
import { buildTable, stableId } from './resultTable.ts'

// "Fit spline/LOWESS": a curve without
// a model through or near each data set, drawn on graphs of the table like a fitted curve. There
// are no parameters to report; an optional table holds the curve's XY coordinates.

/** Share of the points in each local fit for the three LOWESS choices (our values). */
export const LOWESS_SPAN = { coarse: 2 / 3, medium: 1 / 3, fine: 0.1 } as const

const Params = z.object({
  method: z
    .enum(['lowess', 'smoothingSpline', 'akima', 'cubicSpline', 'pointToPoint'])
    .default('lowess'),
  lowess: z.enum(['coarse', 'medium', 'fine']).default('medium'),
  /** Knots of the smoothing spline, the two ends included. */
  knots: z.number().int().min(2).max(50).default(5),
  /** Line segments of the curve (at least 4 per data point). */
  segments: z.number().int().min(10).max(10000).default(200),
  /** A result table with the XY coordinates of each curve. */
  table: z.boolean().default(false),
})
type Params = z.infer<typeof Params>

const TITLE: Record<Params['method'], string> = {
  lowess: 'LOWESS',
  smoothingSpline: 'Smoothing spline',
  akima: 'Akima spline',
  cubicSpline: 'Cubic spline',
  pointToPoint: 'Point to point',
}

/** Distinct X values (ascending) with the mean of their Y values (replicates averaged). */
function meansByX(x: readonly number[], y: readonly number[]): { x: number[]; y: number[] } {
  const idx = x.map((_, i) => i).sort((a, b) => x[a]! - x[b]!)
  const ox: number[] = []
  const oy: number[] = []
  for (let k = 0; k < idx.length; ) {
    const xv = x[idx[k]!]!
    let s = 0
    let c = 0
    while (k < idx.length && x[idx[k]!] === xv) {
      s += y[idx[k]!]!
      c++
      k++
    }
    ox.push(xv)
    oy.push(s / c)
  }
  return { x: ox, y: oy }
}

interface CurveOut {
  ds: NormalizedDataSet
  x: number[]
  y: number[]
  n: number
  note?: string
}

function curveOf(ds: NormalizedDataSet, params: Params): CurveOut | string {
  const pts = xyPointRows(ds)
  const x = pts.map((p) => p.x)
  const y = pts.map((p) => p.y)
  const name = `“${ds.title}”`
  if (x.length < 2) return `${name} needs at least two points.`
  const m = meansByX(x, y)
  if (m.x.length < 2) return `${name} needs at least two different X values.`
  const lo = m.x[0]!
  const hi = m.x[m.x.length - 1]!
  const segments = Math.max(params.segments, 4 * x.length)
  const grid = Array.from({ length: segments + 1 }, (_, i) => lo + ((hi - lo) * i) / segments)
  const on = (c: Curve) => ({ x: grid, y: grid.map(c) })
  switch (params.method) {
    case 'lowess': {
      const l = lowess(x, y, { f: LOWESS_SPAN[params.lowess] })
      // Tied X values share one fitted value: keep the curve's distinct points.
      const cx: number[] = []
      const cy: number[] = []
      l.x.forEach((v, i) => {
        if (cx.length && cx[cx.length - 1] === v) return
        cx.push(v)
        cy.push(l.y[i]!)
      })
      return { ds, x: cx, y: cy, n: x.length }
    }
    case 'smoothingSpline': {
      if (m.x.length < params.knots)
        return `${name} has ${m.x.length} different X values, fewer than the ${params.knots} knots.`
      const r = regressionSpline(x, y, params.knots)
      return { ds, ...on(r.curve), n: x.length }
    }
    case 'akima':
      return { ds, ...on(akimaSpline(m.x, m.y)), n: x.length }
    case 'cubicSpline':
      return { ds, ...on(naturalCubicSpline(m.x, m.y)), n: x.length }
    case 'pointToPoint':
      return { ds, ...on(pointToPoint(m.x, m.y)), n: x.length }
  }
}

export const smoothingDef: AnalysisDef<Params> = {
  id: 'fitSpline',
  version: 1,
  title: 'Fit spline/LOWESS',
  category: 'XY analyses',
  description:
    'Draw a smooth curve without a model: LOWESS (coarse, medium or fine), a smoothing spline with a chosen number of knots, an Akima or cubic spline through every point, or point to point.',
  accepts: ['xy'],
  inputs: { min: 1, max: Number.POSITIVE_INFINITY },
  params: Params,
  form: [
    {
      path: ['method'],
      label: 'Curve',
      kind: 'radio',
      options: [
        { value: 'lowess', label: 'LOWESS (follows the trend)' },
        { value: 'smoothingSpline', label: 'Smoothing spline (choose the number of knots)' },
        { value: 'akima', label: 'Akima spline (through every point)' },
        { value: 'cubicSpline', label: 'Cubic spline (through every point)' },
        { value: 'pointToPoint', label: 'Point to point (straight lines)' },
      ],
    },
    {
      path: ['lowess'],
      label: 'Smoothness',
      kind: 'radio',
      options: [
        { value: 'coarse', label: 'Coarse' },
        { value: 'medium', label: 'Medium' },
        { value: 'fine', label: 'Fine' },
      ],
      showIf: { path: ['method'], in: ['lowess'] },
    },
    {
      path: ['knots'],
      label: 'Number of knots',
      kind: 'number',
      min: 2,
      max: 50,
      step: 1,
      showIf: { path: ['method'], in: ['smoothingSpline'] },
    },
    {
      path: ['segments'],
      label: 'Number of line segments',
      kind: 'number',
      min: 10,
      max: 10000,
      step: 50,
    },
    { path: ['table'], label: 'Create a table of the curve’s XY coordinates', kind: 'checkbox' },
  ],
  outputs: (keys) => keys.map((k) => ({ key: `curve:${k}`, forDataSet: k })),
  run(input, params, context): AnalysisResult {
    const diagnostics = [...exclusionNotes(input), ...missingXNote(input)]
    const curves: CurveOut[] = []
    for (const ds of input) {
      const c = curveOf(ds, params)
      if (typeof c === 'string') diagnostics.push({ level: 'warning', message: c })
      else curves.push(c)
    }
    if (!curves.length) return failure('No data set can be smoothed.', diagnostics)
    if (params.method === 'lowess' && curves.some((c) => c.n < 20))
      diagnostics.push({
        level: 'info',
        message: 'LOWESS curves are only meaningful with well over twenty points.',
      })
    const outputs: AnalysisResult['outputs'] = {}
    for (const c of curves)
      outputs[`curve:${c.ds.ref.key}`] = {
        title: `${c.ds.title} (${TITLE[params.method]})`,
        x: c.x,
        y: c.y,
      }
    const detail =
      params.method === 'lowess'
        ? `${params.lowess} (each local fit uses ${+(LOWESS_SPAN[params.lowess] * 100).toFixed(1)}% of the points; three robustness steps)`
        : params.method === 'smoothingSpline'
          ? `${params.knots} knots, equally spaced from the smallest to the largest X`
          : 'through the mean Y at each X'
    const blocks: ResultBlock[] = [
      { type: 'note', text: `${TITLE[params.method]}: ${detail}.` },
      labelTable(
        'Data',
        curves.map((c) => c.ds.title),
        [
          ['Number of points', curves.map((c) => int(c.n))],
          ['Points on the curve', curves.map((c) => int(c.x.length))],
          ['X from', curves.map((c) => num(c.x[0]!))],
          ['X to', curves.map((c) => num(c.x[c.x.length - 1]!))],
        ],
      ),
      {
        type: 'note',
        text: 'Splines and LOWESS curves are drawings, not models: there are no parameters to report.',
      },
    ]
    return result({
      blocks,
      diagnostics,
      outputs,
      table: params.table ? curveTable(input, curves, params, context) : undefined,
    })
  },
}

/** The curves' XY coordinates: one row per point, each data set's in its own column. */
function curveTable(
  input: readonly NormalizedDataSet[],
  curves: CurveOut[],
  params: Params,
  context: RunContext | undefined,
): DataTable {
  const rows = curves.reduce((s, c) => s + c.x.length, 0)
  const xs: number[] = []
  const cols = curves.map(() => new Array<number>(rows).fill(Number.NaN))
  curves.forEach((c, k) => {
    c.x.forEach((v, i) => {
      cols[k]![xs.length] = c.y[i]!
      xs.push(v)
    })
  })
  return buildTable(input, {
    name: `${TITLE[params.method]} curve`,
    tableKind: 'xy',
    rowCount: rows,
    rowTitles: null,
    x: { title: context?.xTitle ?? 'X', values: xs },
    dataSets: curves.map((c, k) => ({
      id: stableId(c.ds.ref.key),
      title: c.ds.title,
      subcolumns: [cols[k]!],
    })),
  })
}
