import { fSf } from '../dist/f.ts'
import { maxOf } from '../regression/initialRules.ts'
import { designRow } from './coding.ts'
import { cellSummary, fitCellMeans, type GroupData, groupStats, roundedSS } from './groups.ts'

/**
 * Two-way ANOVA (ordinary, not repeated measures) for cells that may have unequal n.
 *
 * Every cell is reduced to (n, mean, SD), so raw and summary (mean/SD/N) input give identical
 * results. The residual (within-cell) SS is Σ (n − 1)·SD². The effects are fitted by weighted
 * least squares on the cell means (weights n), which gives exactly the same estimates and
 * effect sums of squares as the fit to the raw values, because the within-cell deviations are
 * orthogonal to every between-cell contrast.
 *
 * Coding and sums of squares: effect (sum-to-zero) coding with the last level as −1, and
 * Type III sums of squares — the increase in the (cell-mean) residual SS when that effect's
 * columns are dropped from the full model — which is what car::Anova(type = 3) reports with
 * contr.sum (the regression approach, the usual choice for unbalanced data). For
 * balanced data they are the classical sums of squares. With `interaction: false` the additive
 * model is fitted ("assume no interaction"): the interaction SS is pooled into the residual,
 * whose df becomes N − r − c + 1; the row/column SS are then Type II = Type III.
 *
 * Percent of total variation = 100·SS/SS_total with SS_total = Σ (x − grand mean)² (for
 * unbalanced data the Type III SS need not add up to the total).
 *
 * Degenerate designs return NaN sources with `error` set instead of throwing:
 * - 'empty-cells': a row × column combination has no data and the interaction model was asked
 *   for (Type III tests are then not defined). The additive model is fine
 *   with empty cells as long as the rows and columns are connected.
 * - 'no-residual-df': one value per cell with the interaction model (use interaction: false).
 * - 'not-estimable': the additive model's effects are not estimable (disconnected design), or
 *   fewer than two rows or columns have data.
 *
 * Rows and columns are identified by their indices; rows / columns with no data at all are
 * ignored (their marginal means are NaN).
 */

export type TwoWayCell = { row: number; col: number } & GroupData

export type TwoWaySourceName = 'Interaction' | 'Row factor' | 'Column factor' | 'Residual'

export interface TwoWaySource {
  source: TwoWaySourceName
  ss: number
  df: number
  ms: number
  F: number
  p: number
  pctOfTotal: number
}

export interface TwoWayResult {
  /** Interaction (omitted when interaction is false), Row factor, Column factor, Residual. */
  sources: TwoWaySource[]
  ssTotal: number
  /** Residual mean square and df: the pooled error for multiple comparisons. */
  mse: number
  dfResidual: number
  cells: { row: number; col: number; n: number; mean: number; sd: number }[]
  /** Least-squares (unweighted) marginal means, indexed by row / column index. */
  rowMeans: number[]
  colMeans: number[]
  /** Every row × column cell has data, all with the same n. */
  balanced: boolean
  error?: 'empty-cells' | 'no-residual-df' | 'not-estimable'
}

export interface TwoWayOptions {
  /** Fit the interaction (default true). false = additive model ("assume no interaction"). */
  interaction?: boolean
}

interface CellFit {
  r: number // row level (0..R−1)
  c: number // column level
  n: number
  mean: number
}

interface Fit {
  rss: number
  rank: number
  p: number
  coef: Float64Array
}

/** Weighted LS of the (centred) cell means on the chosen effect blocks. */
function fitCells(
  cells: readonly CellFit[],
  R: number,
  C: number,
  blocks: readonly boolean[],
  centre: number,
): Fit {
  // Effect-coded design [1 | rows | cols | rows×cols], with the chosen blocks.
  const terms = [[0], [1], [0, 1]].filter((_, b) => blocks[b])
  const f = fitCellMeans(
    cells.map((c) => designRow([c.r, c.c], [R, C], terms)),
    cells,
    centre,
  )
  return { rss: f.rss, rank: f.rank, p: f.coef.length, coef: f.coef }
}

export function twoWayAnova(input: readonly TwoWayCell[], opts: TwoWayOptions = {}): TwoWayResult {
  const interaction = opts.interaction ?? true
  const seen = new Set<string>()
  const cells = input.map((cell) => {
    const key = `${cell.row},${cell.col}`
    if (seen.has(key)) throw new RangeError(`twoWayAnova: duplicate cell ${key}`)
    seen.add(key)
    const s = groupStats(cell)
    return { row: cell.row, col: cell.col, n: s.n, mean: s.mean, sd: s.sd }
  })
  // Fit on the data shifted by a common constant (see centredStats); report original means.
  const { shift, used, N, grand, ssWithin, ssTotal } = cellSummary(cells, input)
  const rowIds = [...new Set(used.map((c) => c.row))].sort((a, b) => a - b)
  const colIds = [...new Set(used.map((c) => c.col))].sort((a, b) => a - b)
  const R = rowIds.length
  const C = colIds.length
  const maxRow = Math.max(-1, maxOf(cells.map((c) => c.row)))
  const maxCol = Math.max(-1, maxOf(cells.map((c) => c.col)))
  const fits: CellFit[] = used.map((c) => ({
    r: rowIds.indexOf(c.row),
    c: colIds.indexOf(c.col),
    n: c.n,
    mean: c.mean,
  }))
  const full = used.length === R * C
  const balanced = full && used.every((c) => c.n === used[0]!.n) && used.length > 0

  const rowMeans = new Array<number>(maxRow + 1).fill(Number.NaN)
  const colMeans = new Array<number>(maxCol + 1).fill(Number.NaN)
  const names: TwoWaySourceName[] = interaction
    ? ['Interaction', 'Row factor', 'Column factor', 'Residual']
    : ['Row factor', 'Column factor', 'Residual']
  const nanResult = (error: TwoWayResult['error'], mse = Number.NaN, dfRes = Number.NaN) => ({
    sources: names.map((source) => ({
      source,
      ss: Number.NaN,
      df: Number.NaN,
      ms: Number.NaN,
      F: Number.NaN,
      p: Number.NaN,
      pctOfTotal: Number.NaN,
    })),
    ssTotal,
    mse,
    dfResidual: dfRes,
    cells,
    rowMeans,
    colMeans,
    balanced,
    error,
  })

  if (R < 2 || C < 2) return nanResult('not-estimable')

  if (interaction && !full) return nanResult('empty-cells')
  const blocksFull = [true, true, interaction]
  const fFull = fitCells(fits, R, C, blocksFull, grand)
  if (fFull.rank < fFull.p) return nanResult('not-estimable')

  // LS marginal means from the full fit: μ + α_i (effect coding sums to zero over levels).
  const mu = fFull.coef[0]! + grand + shift
  const alpha = (i: number) => (i < R - 1 ? fFull.coef[1 + i]! : -sumRange(fFull.coef, 1, R))
  const beta = (j: number) => (j < C - 1 ? fFull.coef[R + j]! : -sumRange(fFull.coef, R, R + C - 1))
  rowIds.forEach((id, i) => {
    rowMeans[id] = mu + alpha(i)
  })
  colIds.forEach((id, j) => {
    colMeans[id] = mu + beta(j)
  })

  const dfRes = interaction ? N - R * C : N - R - C + 1
  const ssRes = roundedSS(ssWithin + (interaction ? 0 : fFull.rss), ssTotal)
  const mse = ssRes / dfRes
  if (!(dfRes > 0)) return nanResult('no-residual-df', mse, dfRes)

  const effect = (drop: number, df: number): Omit<TwoWaySource, 'source'> => {
    const blocks = blocksFull.map((b, i) => b && i !== drop)
    const ss = roundedSS(Math.max(0, fitCells(fits, R, C, blocks, grand).rss - fFull.rss), ssTotal)
    const ms = ss / df
    const F = ms / mse
    return { ss, df, ms, F, p: fSf(F, df, dfRes), pctOfTotal: (100 * ss) / ssTotal }
  }
  const sources: TwoWaySource[] = []
  if (interaction) sources.push({ source: 'Interaction', ...effect(2, (R - 1) * (C - 1)) })
  sources.push({ source: 'Row factor', ...effect(0, R - 1) })
  sources.push({ source: 'Column factor', ...effect(1, C - 1) })
  sources.push({
    source: 'Residual',
    ss: ssRes,
    df: dfRes,
    ms: mse,
    F: Number.NaN,
    p: Number.NaN,
    pctOfTotal: (100 * ssRes) / ssTotal,
  })
  return { sources, ssTotal, mse, dfResidual: dfRes, cells, rowMeans, colMeans, balanced }
}

function sumRange(a: Float64Array, from: number, to: number): number {
  let s = 0
  for (let i = from; i < to; i++) s += a[i]!
  return s
}
