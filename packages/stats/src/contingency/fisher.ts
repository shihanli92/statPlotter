import { hyperPmf } from '../dist/binomial.ts'
import { lgamma } from '../special/gamma.ts'
import { checkTable, colSums, rowSums } from './validate.ts'

export interface FisherResult {
  /** Two-sided: sum of the probabilities of tables no more likely than the observed one. */
  p: number
  /** 2 × 2 only: P(X ≤ a) for the top-left cell a (R's alternative = "less"); NaN for r × c. */
  pLess: number
  /** 2 × 2 only: P(X ≥ a) (alternative = "greater"); NaN for r × c. */
  pGreater: number
}

/** Relative tolerance for "no more likely than observed", as R's fisher.test. */
const REL_ERR = 1 + 1e-7

/**
 * Work cap for r × c tables: the largest number of (partial table, cell split) steps the
 * network algorithm takes before giving up.
 */
export const FISHER_MAX_TABLES = 20_000_000

export interface FisherOptions {
  /** Work cap for r × c tables (default FISHER_MAX_TABLES); exceeding it throws. */
  maxWork?: number
}

/**
 * Fisher's exact test. Two-sided P by the method of summing small P values (as R's
 * fisher.test, including its 1e−7 relative tolerance for ties).
 *
 * 2 × 2 tables use the hypergeometric distribution of the top-left cell directly. Larger
 * tables (Freeman–Halton extension) use a network algorithm over the tables
 * with the observed margins (see fisherRxC); this throws if the work exceeds FISHER_MAX_TABLES
 * steps (`opts.maxWork`; use the chi-square test then). An all-zero table (or any table whose margins admit
 * only one table) gives P = 1.
 */
export function fisherExact(
  table: readonly (readonly number[])[],
  opts: FisherOptions = {},
): FisherResult {
  const t = checkTable(table, 'fisherExact')
  if (t.length === 2 && t[0]!.length === 2) return fisher2x2(t)
  const p = fisherRxC(t, opts.maxWork ?? FISHER_MAX_TABLES)
  return { p, pLess: Number.NaN, pGreater: Number.NaN }
}

function fisher2x2(t: number[][]): FisherResult {
  const [[a, b], [c, d]] = t as [[number, number], [number, number]]
  const m = a + c // first column total ("white balls")
  const n = b + d
  const k = a + b // first row total (draws)
  const lo = Math.max(0, k - n)
  const hi = Math.min(k, m)
  const probs: number[] = []
  let total = 0
  for (let x = lo; x <= hi; x++) {
    const px = hyperPmf(x, m, n, k)
    probs.push(px)
    total += px
  }
  const pObs = probs[a - lo]! * REL_ERR
  let p = 0
  let pLess = 0
  let pGreater = 0
  for (let x = lo; x <= hi; x++) {
    const px = probs[x - lo]! / total
    if (probs[x - lo]! <= pObs) p += px
    if (x <= a) pLess += px
    if (x >= a) pGreater += px
  }
  return { p: Math.min(1, p), pLess: Math.min(1, pLess), pGreater: Math.min(1, pGreater) }
}

/**
 * Network algorithm (after Mehta & Patel 1983, "A network algorithm for performing Fisher's
 * exact test in r × c contingency tables", JASA 78:427–434). The probability of a table is
 * Π rᵢ! Π cⱼ! / (N! Π nᵢⱼ!); only S = Σ ln nᵢⱼ! varies, and a table counts when
 * S ≥ S_obs − ln(1 + 1e−7). Columns are filled one at a time (the largest last, where the
 * cells are forced). A node is the multiset of row totals still to fill; rows are exchangeable
 * from there on, so partial tables reaching the same node are merged, keeping for each
 * distinct past value S_p (to 1e−9) the number of partial tables that reach it. At each node,
 * bounds L ≤ S_f ≤ U on the rest of the table settle most pasts at once:
 *   S_p + L ≥ threshold: every completion counts, and their total weight is known in closed
 *     form, Σ Π 1/nᵢⱼ! = M! / (Π r'ᵢ! Π c'ⱼ!) over the remaining margins (total M);
 *   S_p + U < threshold: no completion counts.
 * Only the remaining pasts are carried to the next column. L and U come from relaxing the
 * table to its columns (or rows) alone, each with the other margin as a cap: Σ ln n! is convex,
 * so a column's minimum is its most even split and its maximum the greediest one.
 */
function fisherRxC(t0: number[][], maxWork: number): number {
  // Keep the row totals (the node state) the shorter side, and drop empty rows and columns.
  const t = t0.length > t0[0]!.length ? t0[0]!.map((_, j) => t0.map((row) => row[j]!)) : t0
  const rs = rowSums(t).filter((r) => r > 0)
  const cs = colSums(t)
    .filter((c) => c > 0)
    .sort((x, y) => x - y)
  const N = rs.reduce((s, x) => s + x, 0)
  if (N === 0 || rs.length < 2 || cs.length < 2) return 1
  const C = cs.length
  const lf = new Float64Array(N + 1)
  for (let i = 2; i <= N; i++) lf[i] = lgamma(i + 1)
  // ln of the constant Π rᵢ! Π cⱼ! / N!
  let lconst = -lf[N]!
  for (const r of rs) lconst += lf[r]!
  for (const c of cs) lconst += lf[c]!
  let obs = 0
  for (const row of t) for (const x of row) obs += lf[x]!
  // A table is at most as likely as the observed one when Σ ln n! ≥ obs − ln(REL_ERR).
  const threshold = obs - Math.log(REL_ERR)
  // Σ_{k ≥ j} ln cₖ!
  const lfColsFrom = new Float64Array(C + 1)
  for (let j = C - 1; j >= 0; j--) lfColsFrom[j] = lfColsFrom[j + 1]! + lf[cs[j]!]!

  let p = 0
  let work = 0
  const tick = (n: number): void => {
    work += n
    if (work > maxWork) {
      throw new Error(
        `fisherExact: more than ${maxWork} steps; the table is too large for the ` +
          'exact test (use the chi-square test)',
      )
    }
  }

  interface Node {
    rows: number[] // remaining row totals, descending, no zeros
    s: number[] // past values S_p (unmerged until the node is expanded)
    w: number[] // number of partial tables with that past
  }
  let nodes = new Map<string, Node>()
  const start = rs.slice().sort((x, y) => y - x)
  nodes.set(start.join(','), { rows: start, s: [0], w: [1] })

  const x: number[] = []
  for (let j = 0; j < C - 1; j++) {
    const next = new Map<string, Node>()
    const c = cs[j]!
    for (const node of nodes.values()) {
      const rows = node.rows
      const R = rows.length
      let M = 0
      let lfRows = 0
      for (const r of rows) {
        M += r
        lfRows += lf[r]!
      }
      const [L, U] = bounds(rows, cs, j, lf)
      // ln of Σ over completions of Π 1/n! = M! / (Π r'! Π c'!)
      const lcomplete = lf[M]! - lfRows - lfColsFrom[j]!
      const [keepS, keepW] = mergePasts(node.s, node.w)
      // Settle the pasts the bounds decide; the rest are carried into column j.
      let nk = 0
      for (let i = 0; i < keepS.length; i++) {
        const sp = keepS[i]!
        if (sp + L >= threshold) p += keepW[i]! * Math.exp(lconst - sp + lcomplete)
        else if (sp + U >= threshold) {
          keepS[nk] = sp
          keepW[nk++] = keepW[i]!
        }
      }
      keepS.length = nk
      keepW.length = nk
      if (keepS.length === 0) continue
      // Every split of column j over the remaining rows, each cell at most the row's total.
      const split = (i: number, left: number, add: number): void => {
        if (i === R - 1) {
          if (left > rows[i]!) return
          x[i] = left
          add += lf[left]!
          const nr: number[] = []
          for (let r = 0; r < R; r++) if (rows[r]! > x[r]!) nr.push(rows[r]! - x[r]!)
          nr.sort((u, v) => v - u)
          const key = nr.join(',')
          let child = next.get(key)
          if (!child) {
            child = { rows: nr, s: [], w: [] }
            next.set(key, child)
          }
          tick(nk)
          for (let k = 0; k < nk; k++) {
            child.s.push(keepS[k]! + add)
            child.w.push(keepW[k]!)
          }
          return
        }
        let roomAfter = 0
        for (let r = i + 1; r < R; r++) roomAfter += rows[r]!
        const from = Math.max(0, left - roomAfter)
        const to = Math.min(left, rows[i]!)
        for (let v = from; v <= to; v++) {
          x[i] = v
          split(i + 1, left - v, add + lf[v]!)
        }
      }
      split(0, c, 0)
    }
    nodes = next
  }
  // The last column is forced: its cells are the remaining row totals.
  for (const node of nodes.values()) {
    let sf = 0
    for (const r of node.rows) sf += lf[r]!
    for (let i = 0; i < node.s.length; i++) {
      const sp = node.s[i]!
      if (sp + sf >= threshold) p += node.w[i]! * Math.exp(lconst - sp - sf)
    }
  }
  return Math.min(1, p)
}

/**
 * Sorts the pasts by S_p and merges those within 1e−9 of the first of a run (partial tables
 * that differ only in the order of their cells, up to rounding), adding their counts.
 */
function mergePasts(s: number[], w: number[]): [number[], number[]] {
  const order = Array.from(s.keys()).sort((a, b) => s[a]! - s[b]!)
  const ms: number[] = []
  const mw: number[] = []
  let head = Number.NEGATIVE_INFINITY
  for (const i of order) {
    if (s[i]! - head <= 1e-9) mw[mw.length - 1]! += w[i]!
    else {
      head = s[i]!
      ms.push(head)
      mw.push(w[i]!)
    }
  }
  return [ms, mw]
}

/**
 * Bounds [L, U] on Σ ln n! over the completions of a table with row totals `rows` and column
 * totals cs[j..]: the larger of the column-wise and row-wise minima (each line split as evenly
 * as its caps allow) and the smaller of the maxima (each line filled greedily).
 */
function bounds(rows: number[], cs: number[], j: number, lf: Float64Array): [number, number] {
  const cols = cs.slice(j)
  let lc = 0
  let uc = 0
  for (const c of cols) {
    lc += evenSplit(c, rows, lf)
    uc += greedySplit(c, rows, lf)
  }
  let lr = 0
  let ur = 0
  for (const r of rows) {
    lr += evenSplit(r, cols, lf)
    ur += greedySplit(r, cols, lf)
  }
  return [Math.max(lc, lr), Math.min(uc, ur)]
}

/** min Σ ln xᵢ! over xᵢ ≤ capᵢ with Σ xᵢ = total (water filling; caps must allow it). */
function evenSplit(total: number, caps: number[], lf: Float64Array): number {
  const sorted = caps.slice().sort((a, b) => a - b)
  let left = total
  let s = 0
  let k = sorted.length
  for (const cap of sorted) {
    const level = left / k
    if (cap <= level) {
      s += lf[cap]!
      left -= cap
      k--
    } else {
      const q = Math.floor(left / k)
      const extra = left - q * k
      return s + extra * lf[q + 1]! + (k - extra) * lf[q]!
    }
  }
  return s
}

/** max Σ ln xᵢ! over xᵢ ≤ capᵢ with Σ xᵢ = total (fill the largest caps first). */
function greedySplit(total: number, caps: number[], lf: Float64Array): number {
  const sorted = caps.slice().sort((a, b) => b - a)
  let left = total
  let s = 0
  for (const cap of sorted) {
    if (left <= 0) break
    const v = Math.min(cap, left)
    s += lf[v]!
    left -= v
  }
  return s
}
