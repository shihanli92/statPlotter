import type {
  DataTable,
  GraphableDataSet,
  NormalizedDataSet,
  OutputDecl,
  ResultBlock,
  ResultSheet,
  ResultValue,
  RunContext,
} from '@ps/model'
import {
  type CurveWithBand,
  correlationMatrix,
  dependency,
  interpolateX,
  interpolateY,
  replicatesTest,
  runsTest,
  valueRange,
} from '@ps/stats'
import { z } from 'zod'
import {
  int,
  interval,
  labelTable,
  num,
  pct,
  psum,
  pval,
  rowCountOf,
  significance,
  significant,
  table,
  text,
  yCols,
} from './common.ts'
import { rowName } from './grouped.ts'
import { TESTS, testBlock } from './normality.ts'
import { buildTable, stableId } from './resultTable.ts'

// ---------------------------------------------------------------------------------------------
// Pieces shared by nonlinear and linear regression (Phase 14): XY points with their rows,
// interpolation of unknowns from a standard curve, and fit diagnostics.
// ---------------------------------------------------------------------------------------------

/** A fitted point and where it lives in the table. */
export interface XYPoint {
  row: number
  /** Replicate subcolumn (0 for summary data, whose means are used). */
  sub: number
  x: number
  y: number
}

/** XY points in the order `xyPoints` gives them, with their rows and subcolumns. */
export function xyPointRows(ds: NormalizedDataSet): XYPoint[] {
  const out: XYPoint[] = []
  if (!ds.x) return out
  const cols = yCols(ds)
  for (let row = 0; row < ds.rowCount; row++) {
    const x = ds.x[row]!
    if (Number.isNaN(x)) continue
    cols.forEach((c, sub) => {
      const y = c[row]!
      if (!Number.isNaN(y)) out.push({ row, sub, x, y })
    })
  }
  return out
}

/**
 * One point per row: the mean of the row's replicate Y values that are present ("only consider
 * the mean Y value of each point"); summary data give their entered means, as always.
 */
export function meanPointRows(ds: NormalizedDataSet): XYPoint[] {
  const out: XYPoint[] = []
  if (!ds.x) return out
  const cols = yCols(ds)
  for (let row = 0; row < ds.rowCount; row++) {
    const x = ds.x[row]!
    if (Number.isNaN(x)) continue
    let s = 0
    let n = 0
    for (const c of cols) {
      const y = c[row]!
      if (!Number.isNaN(y)) {
        s += y
        n++
      }
    }
    if (n > 0) out.push({ row, sub: 0, x, y: s / n })
  }
  return out
}

// ---- interpolation ---------------------------------------------------------------------------

export const INTERPOLATE_FIELD = {
  path: ['interpolate'],
  label: 'Interpolate unknowns from the standard curve',
  help: 'Rows below the standards with a Y but no X get an X from the curve; rows with an X but no Y get a Y.',
  kind: 'checkbox',
} as const

/**
 * Unknowns: the rows below every row that has both an X and a Y (in any
 * analyzed data set). Among them, rows with Y values but no X are interpolated for X, rows with
 * an X but no Y in any data set for Y. Rows higher up with a missing X or Y are ignored.
 */
function findUnknowns(input: readonly NormalizedDataSet[]): {
  yRows: number[]
  xRows: number[]
} {
  const rows = rowCountOf(input)
  const hasX = (r: number) => input.some((d) => d.x && !Number.isNaN(d.x[r] ?? Number.NaN))
  const xOf = (r: number) => input.find((d) => d.x)?.x?.[r] ?? Number.NaN
  const hasY = (r: number) =>
    input.some((d) => yCols(d).some((c) => !Number.isNaN(c[r] ?? Number.NaN)))
  let last = -1
  for (let r = 0; r < rows; r++) if (hasX(r) && hasY(r)) last = r
  const yRows: number[] = []
  const xRows: number[] = []
  for (let r = last + 1; r < rows; r++) {
    if (!Number.isNaN(xOf(r))) {
      if (!hasY(r)) xRows.push(r)
    } else if (hasY(r)) yRows.push(r)
  }
  return { yRows, xRows }
}

/**
 * Interpolated values: a results sheet (every replicate's X with its CI, the mean X per unknown
 * row, and Ys at the X unknowns) and an XY result table of the interpolated points. The table
 * stacks, for each data set, one row per Y-unknown replicate (X = the interpolated X, Y in that
 * data set's column = the entered Y), then one row per X-unknown (X = the entered X, each data
 * set's interpolated Y); its data sets keep the source's ids. `fits` are the fitted data sets
 * (with their standards' X values), `curveOf` a fit's curve (null: not usable).
 */
export function interpolation<F extends { ds: NormalizedDataSet; x: ArrayLike<number> }>(
  input: readonly NormalizedDataSet[],
  fits: readonly F[],
  curveOf: (f: F) => CurveWithBand | null,
  confLevel: number,
  context: RunContext | undefined,
  noCI = false,
): { sheet: ResultSheet; table?: DataTable } {
  const byKey = new Map(fits.map((f) => [f.ds.ref.key, f]))
  // Each data set's curve (null when it wasn't fitted) and its standards' X range.
  const curves = input.map((ds) => {
    const f = byKey.get(ds.ref.key)
    const [xmin, xmax] = f ? valueRange(f.x) : [Number.NaN, Number.NaN]
    return { ds, curve: f ? curveOf(f) : null, xmin, xmax }
  })
  const { yRows, xRows } = findUnknowns(input)
  const level = pct(confLevel)
  if (!yRows.length && !xRows.length) {
    return {
      sheet: {
        key: 'interpolated',
        title: 'Interpolated values',
        blocks: [
          {
            type: 'note',
            text: 'No unknowns to interpolate: enter them below the standards, with a Y and no X (or an X and no Y).',
          },
        ],
      },
    }
  }
  const ci = (lo: number, hi: number): ResultValue =>
    noCI || !(Number.isFinite(lo) && Number.isFinite(hi)) ? text('') : interval(lo, hi, confLevel)
  const xRowsOut: ResultValue[][] = []
  const meanRows: ResultValue[][] = []
  const yRowsOut: ResultValue[][] = []
  // Result table columns (per data set) and rows.
  const tX: number[] = []
  const tTitles: string[] = []
  const tY: number[][] = curves.map(() => [])
  const pushRow = (x: number, title: string, ys: (number | undefined)[]) => {
    tX.push(x)
    tTitles.push(title)
    curves.forEach((_, k) => {
      tY[k]!.push(ys[k] ?? Number.NaN)
    })
  }
  let extrapolated = 0
  let blank = 0
  const reps = curves.some((c) => yCols(c.ds).length > 1)
  curves.forEach((c, k) => {
    const cols = yCols(c.ds)
    for (const r of yRows) {
      const xs: number[] = []
      const ys: number[] = []
      cols.forEach((col, sub) => {
        const y = col[r] ?? Number.NaN
        if (Number.isNaN(y)) return
        const res = c.curve
          ? interpolateX(c.curve, y, c.xmin, c.xmax)
          : { x: Number.NaN, lo: Number.NaN, hi: Number.NaN, extrapolated: false }
        if (Number.isNaN(res.x)) blank++
        if (res.extrapolated) extrapolated++
        xRowsOut.push([
          text(c.ds.title),
          text(rowName(c.ds, r)),
          ...(reps ? [int(sub + 1)] : []),
          num(y),
          Number.isNaN(res.x) ? text('') : num(res.x),
          ci(res.lo, res.hi),
          text(res.extrapolated ? 'Extrapolated' : Number.isNaN(res.x) ? 'Out of range' : ''),
        ])
        ys.push(y)
        if (!Number.isNaN(res.x)) xs.push(res.x)
        const row: (number | undefined)[] = []
        row[k] = y
        pushRow(res.x, rowName(c.ds, r), row)
      })
      if (cols.length > 1 && ys.length) {
        meanRows.push([
          text(c.ds.title),
          text(rowName(c.ds, r)),
          num(ys.reduce((s, v) => s + v, 0) / ys.length),
          xs.length ? num(xs.reduce((s, v) => s + v, 0) / xs.length) : text(''),
          int(xs.length),
        ])
      }
    }
  })
  for (const r of xRows) {
    const x = input.find((d) => d.x)?.x?.[r] ?? Number.NaN
    const row: number[] = []
    curves.forEach((c, k) => {
      const res = c.curve
        ? interpolateY(c.curve, x, c.xmin, c.xmax)
        : { y: Number.NaN, lo: Number.NaN, hi: Number.NaN, extrapolated: false }
      if (Number.isNaN(res.y)) blank++
      if (res.extrapolated) extrapolated++
      row[k] = res.y
      yRowsOut.push([
        text(c.ds.title),
        text(rowName(c.ds, r)),
        num(x),
        Number.isNaN(res.y) ? text('') : num(res.y),
        ci(res.lo, res.hi),
        text(res.extrapolated ? 'Extrapolated' : Number.isNaN(res.y) ? 'Out of range' : ''),
      ])
    })
    pushRow(x, rowName(input[0]!, r), row)
  }
  const blocks: ResultBlock[] = []
  if (xRowsOut.length)
    blocks.push(
      table(
        'Interpolated X values',
        ['Data set', 'Row', ...(reps ? ['Replicate'] : []), 'Y', 'X', `${level} CI of X`, ''],
        xRowsOut,
      ),
    )
  if (meanRows.length)
    blocks.push(
      table('Interpolated mean X values', ['Data set', 'Row', 'Mean Y', 'Mean X', 'N'], meanRows),
    )
  if (yRowsOut.length)
    blocks.push(
      table(
        'Interpolated Y values',
        ['Data set', 'Row', 'X', 'Y', `${level} CI of Y`, ''],
        yRowsOut,
      ),
    )
  const notes: string[] = []
  if (blank)
    notes.push(
      `${blank} value${blank > 1 ? 's' : ''} couldn’t be interpolated: the curve doesn’t reach ${blank > 1 ? 'them' : 'it'} within its range (the standards’ X range extended by half its length each way).`,
    )
  if (extrapolated)
    notes.push(
      `${extrapolated} value${extrapolated > 1 ? 's are' : ' is'} extrapolated beyond the standards.`,
    )
  if (noCI) notes.push('Confidence intervals are not available with robust regression.')
  notes.push(
    'Values are in the units of X (with X as log(concentration), transform the table with X = 10^X for concentrations).',
  )
  blocks.push({ type: 'note', text: notes.join(' ') })
  const unknowns = buildTable(input, {
    name: 'Interpolated values',
    tableKind: 'xy',
    rowCount: tX.length,
    rowTitles: tTitles,
    x: { title: context?.xTitle ?? 'X', values: tX },
    dataSets: curves.map((c, k) => ({
      id: stableId(c.ds.ref.key),
      title: c.ds.title,
      subcolumns: [tY[k]!],
    })),
  })
  return { sheet: { key: 'interpolated', title: 'Interpolated values', blocks }, table: unknowns }
}

// ---- diagnostics -----------------------------------------------------------------------------

export const Diagnostics = z
  .object({
    /** A residual plot (an output graph) and a table of residuals. */
    residuals: z.boolean().default(false),
    runsTest: z.boolean().default(false),
    replicatesTest: z.boolean().default(false),
    normality: z.boolean().default(false),
  })
  .default({ residuals: false, runsTest: false, replicatesTest: false, normality: false })

export const DIAGNOSTIC_FIELDS = [
  { path: ['diagnostics', 'residuals'], label: 'Residual plot and table', kind: 'checkbox' },
  {
    path: ['diagnostics', 'runsTest'],
    label: 'Runs test (do the points deviate systematically from the curve?)',
    kind: 'checkbox',
  },
  {
    path: ['diagnostics', 'replicatesTest'],
    label: 'Replicates test for lack of fit',
    kind: 'checkbox',
  },
  {
    path: ['diagnostics', 'normality'],
    label: 'Test residuals for normality',
    kind: 'checkbox',
  },
] as const

/** Graphable residual outputs, on one "Residuals" graph. */
export function residualOutputs(keys: readonly string[]): OutputDecl[] {
  return keys.map((k) => ({
    key: `residuals:${k}`,
    forDataSet: k,
    graph: { id: 'residuals', name: 'Residuals', xTitle: 'X', yTitle: 'Residual' },
    mark: 'points',
  }))
}

export interface ResidualSet {
  ds: NormalizedDataSet
  points: XYPoint[]
  /** Y − Ŷ per point (data scale). */
  residuals: ArrayLike<number>
  /** Weights at the curve per point (1 when unweighted), for the replicates test. */
  weights?: ArrayLike<number>
  ss: number
  df: number
}

/**
 * The residuals sheet of a fit (every point's Y, the Y of the fitted `what` and the residual),
 * adding the residual-plot outputs to `outputs`.
 */
export function residualsSheet(
  sets: readonly ResidualSet[],
  what: 'line' | 'curve',
  outputs: Record<string, GraphableDataSet>,
): ResultSheet {
  for (const s of sets)
    outputs[`residuals:${s.ds.ref.key}`] = {
      title: `${s.ds.title} (residuals)`,
      x: s.points.map((p) => p.x),
      y: Array.from(s.residuals),
    }
  const rows = sets.flatMap((s) =>
    s.points.map((p, i) => [
      text(s.ds.title),
      text(rowName(s.ds, p.row)),
      num(p.x),
      num(p.y),
      num(p.y - s.residuals[i]!),
      num(s.residuals[i]!),
    ]),
  )
  return {
    key: 'residuals',
    title: 'Residuals',
    blocks: [
      table(
        `Residuals (Y − ${what})`,
        ['Data set', 'Row', 'X', 'Y', `Y of ${what}`, 'Residual'],
        rows,
      ),
    ],
  }
}

/** Sheets for the chosen diagnostics, per data set. */
export function diagnosticBlocks(
  sets: readonly ResidualSet[],
  opts: z.infer<typeof Diagnostics>,
): ResultBlock[] {
  const cols = sets.map((s) => s.ds.title)
  const blocks: ResultBlock[] = []
  const NONE = text('—')
  if (opts.runsTest) {
    const runs = sets.map((s) => {
      // Only with one Y per X (points in X order).
      if (new Set(s.points.map((p) => p.x)).size !== s.points.length) return null
      const order = s.points.map((_, i) => i).sort((a, b) => s.points[a]!.x - s.points[b]!.x)
      return runsTest(order.map((i) => s.residuals[i]!))
    })
    blocks.push(
      labelTable('Runs test', cols, [
        ['Points above curve', runs.map((r) => (r ? int(r.nAbove) : NONE))],
        ['Points below curve', runs.map((r) => (r ? int(r.nBelow) : NONE))],
        ['Number of runs', runs.map((r) => (r ? int(r.runs) : NONE))],
        ['P value (runs test)', runs.map((r) => (r && Number.isFinite(r.p) ? pval(r.p) : NONE))],
        [
          'Deviation from model',
          runs.map((r) => (r && Number.isFinite(r.p) ? significance(r.p) : NONE)),
        ],
      ]),
    )
    if (runs.some((r) => !r))
      blocks.push({
        type: 'note',
        text: 'The runs test needs one Y value per X; it isn’t done for data sets with replicates.',
      })
  }
  if (opts.replicatesTest) {
    const tests = sets.map((s) =>
      replicatesTest(
        s.points.map((p) => p.x),
        s.points.map((p) => p.y),
        s.ss,
        s.df,
        s.weights,
      ),
    )
    blocks.push(
      labelTable('Replicates test for lack of fit', cols, [
        ['SD replicates', tests.map((t) => (t ? num(t.sdReplicates) : NONE))],
        ['SD lack of fit', tests.map((t) => (t ? num(t.sdLackOfFit) : NONE))],
        ['Discrepancy (F)', tests.map((t) => (t ? num(t.F) : NONE))],
        ['DFn, DFd', tests.map((t) => (t ? text(`${t.dfLackOfFit}, ${t.dfReplicates}`) : NONE))],
        ['P value', tests.map((t) => (t ? pval(t.p) : NONE))],
        ['P value summary', tests.map((t) => (t ? psum(t.p) : NONE))],
        ['Evidence of inadequate model?', tests.map((t) => (t ? significant(t.p) : NONE))],
      ]),
    )
    if (tests.some((t) => !t))
      blocks.push({
        type: 'note',
        text: 'The replicates test needs replicate Y values at some X and more distinct X values than parameters.',
      })
  }
  if (opts.normality) {
    const samples = sets.map((s) => Float64Array.from(s.residuals))
    for (const t of TESTS) blocks.push(testBlock(t, samples, cols, 'normality'))
  }
  return blocks
}

/** Correlation matrix and dependency of a data set's fitted parameters. */
export function covarianceBlocks(
  names: readonly string[],
  cov: ArrayLike<number>,
  title: string,
): ResultBlock[] {
  const q = names.length
  if (q < 1 || !Array.from(cov).every(Number.isFinite)) return []
  const R = correlationMatrix(cov, q)
  const dep = dependency(cov, q)
  return [
    labelTable(
      `Correlation matrix of the parameters${title ? ` (${title})` : ''}`,
      names,
      names.map((n, a) => [n, names.map((_, b) => num(R[a * q + b]!))]),
    ),
    table(
      `Dependency${title ? ` (${title})` : ''}`,
      ['Parameter', 'Dependency'],
      names.map((n, i) => [text(n), num(dep[i]!)]),
    ),
  ]
}
