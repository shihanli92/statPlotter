import { columnOf, shifted } from '../arrays.ts'
import { mean, sd } from '../descriptive/basic.ts'
import { quantileSorted } from '../descriptive/quantile.ts'
import { LecuyerRng } from '../gpl/rngLecuyer.ts'
import { norm2, qrFactor } from '../linalg/qr.ts'
import { type ProgressFn, progressStride, reportProgress } from '../progress.ts'

/**
 * Principal component analysis as GraphPad Prism documents it
 * (https://www.graphpad.com/guides/prism/latest/statistics/stat_pca_options_tab.htm and the
 * pages linked from it):
 *
 * - Data are standardized ((x − mean) / SD, SD with n − 1; "PCA on the correlation matrix",
 *   Prism's recommended default) or only centered ("PCA on the covariance matrix").
 * - Eigenvalues are those of the correlation / covariance matrix (divisor n − 1), in descending
 *   order; proportion = eigenvalue / Σ eigenvalues.
 * - Loadings = eigenvector × √eigenvalue (the correlations, or covariances, between variables
 *   and components). Scores = standardized or centered data × eigenvectors.
 * - Component selection: parallel analysis (Prism's recommendation), eigenvalue > threshold
 *   (Kaiser rule, threshold 1 by default), the smallest number of components whose cumulative
 *   proportion reaches a target percent, a fixed number, or all components.
 *
 * Computation: Householder QR of the n × p preprocessed data, then one-sided Jacobi (Hestenes)
 * SVD of R, so eigenvalues come from singular values (as R's prcomp) without forming the
 * covariance matrix. Eigenvalues below p·n·ε·λ₁ are set to 0 (rank-deficient data, n ≤ p).
 *
 * Sign convention (Prism's is undocumented; LAPACK's is arbitrary): each eigenvector is
 * oriented so that the sum of its elements is positive; when that sum is 0 (|sum| ≤ 1e−8),
 * its first element with |v| > 1e−8 is made positive. Scores and loadings follow.
 */

export type PcaSelectMethod = 'kaiser' | 'parallel' | 'variance' | 'fixed' | 'all'

export interface PcaSelectOptions {
  method: PcaSelectMethod
  /**
   * kaiser: eigenvalue threshold (default 1; components with eigenvalue > value are kept).
   * variance: target cumulative percent of total variance, 0–100 (default 75).
   * fixed: number of components (default 2).
   * parallel: the upper percentile (default 95).
   */
  value?: number
  /** Parallel analysis: number of simulated data sets (default 1000, as Prism). */
  simulations?: number
  /** Parallel analysis seed (default 1). Same generator as R's set.seed(seed, kind = "L'Ecuyer-CMRG"). */
  seed?: number
}

export interface PcaOptions {
  /** Default true (PCA on the correlation matrix). */
  standardize?: boolean
  /** Default { method: 'parallel' } (Prism's recommendation). */
  select?: PcaSelectOptions
  /** Hears how many of parallel analysis' simulations are done (roadmap 42). */
  progress?: ProgressFn
}

export interface PcaParallel {
  /** Mean simulated eigenvalue of each component. */
  mean: number[]
  /** Upper percentile (default 95th) of each component's simulated eigenvalues. */
  percentile: number[]
  /** Lower percentile (100 − upper, default 5th), which Prism also lists. */
  lower: number[]
  level: number
  simulations: number
  seed: number
}

export interface PcaResult {
  eigenvalues: number[]
  proportion: number[]
  cumulative: number[]
  /** p × p; column k is component k. Deterministic signs (see above). */
  eigenvectors: number[][]
  /** p × p: eigenvector × √eigenvalue. */
  loadings: number[][]
  /** n × p. */
  scores: number[][]
  /** Number of components retained by the selection rule (≤ rank). */
  selected: number
  /** Number of components with a non-zero eigenvalue (Prism's "number of components"). */
  rank: number
  parallel?: PcaParallel
  means: number[]
  /** SD of each variable (n − 1); used to scale when standardizing. */
  sds: number[]
  n: number
  standardized: boolean
}

const EPS = 2 ** -52

/**
 * PCA of the n × p matrix X (rows = observations, complete rows only). Throws for a ragged
 * matrix, no columns, or non-finite values. Degenerate data (n < 2, or a constant column when
 * standardizing) give NaN statistics and selected = 0.
 */
export function pca(X: readonly (readonly number[])[], opts: PcaOptions = {}): PcaResult {
  const n = X.length
  const p = n > 0 ? X[0]!.length : 0
  if (n > 0 && p === 0) throw new RangeError('pca: X has no columns')
  for (let i = 0; i < n; i++) {
    const row = X[i]!
    if (row.length !== p)
      throw new RangeError(`pca: row ${i + 1} has ${row.length} values, not ${p}`)
    for (const v of row) if (!Number.isFinite(v)) throw new RangeError('pca: non-finite value')
  }
  const standardize = opts.standardize ?? true
  const select = opts.select ?? { method: 'parallel' }

  // Columns shifted by their first value (exact for clustered data such as 1e9 + noise), so
  // centering loses nothing to the rounding of the mean.
  const cols: Float64Array[] = []
  for (let j = 0; j < p; j++) cols.push(shifted(columnOf(X, j), X[0]![j]!))
  const means = cols.map((c, j) => X[0]![j]! + mean(c))
  const sds = cols.map((c) => sd(c))

  const degenerate = n < 2 || (standardize && sds.some((s) => !(s > 0)))
  if (degenerate) return nanResult(n, p, means, sds, standardize)

  const z = preprocess(cols, n, p, standardize)
  const { values, vectors } = decompose(z, n, p, true)
  const rank = values.filter((v) => v > 0).length
  const total = values.reduce((s, v) => s + v, 0)
  const proportion = values.map((v) => v / total)
  const cumulative: number[] = []
  let acc = 0
  for (const v of proportion) {
    acc += v
    cumulative.push(acc)
  }

  const V = vectors!
  for (let k = 0; k < p; k++) orient(V, p, k)

  const eigenvectors = matrix(p, p, (j, k) => V[j + k * p]!)
  const loadings = matrix(p, p, (j, k) => V[j + k * p]! * Math.sqrt(values[k]!))
  const scores = matrix(n, p, (i, k) => {
    let s = 0
    for (let j = 0; j < p; j++) s += z[i + j * n]! * V[j + k * p]!
    return s
  })

  let parallel: PcaParallel | undefined
  let selected: number
  switch (select.method) {
    case 'kaiser': {
      const t = select.value ?? 1
      selected = values.filter((v) => v > t).length
      break
    }
    case 'variance': {
      const target = (select.value ?? 75) / 100
      selected = cumulative.findIndex((c) => c >= target * (1 - 1e-12)) + 1
      if (selected === 0) selected = p
      break
    }
    case 'fixed':
      selected = Math.max(0, Math.floor(select.value ?? 2))
      break
    case 'all':
      selected = rank
      break
    case 'parallel': {
      parallel = parallelAnalysis(n, p, sds, standardize, select, opts.progress)
      selected = 0
      while (selected < p && values[selected]! > parallel.percentile[selected]!) selected++
      break
    }
    default:
      throw new RangeError(`pca: unknown selection method ${(select as { method: string }).method}`)
  }
  selected = Math.min(selected, rank)

  return {
    eigenvalues: values,
    proportion,
    cumulative,
    eigenvectors,
    loadings,
    scores,
    selected,
    rank,
    ...(parallel ? { parallel } : {}),
    means,
    sds,
    n,
    standardized: standardize,
  }
}

/**
 * Horn's parallel analysis as Prism describes it
 * (https://www.graphpad.com/guides/prism/latest/statistics/stat_pca_options_tab.htm): each
 * simulated data set has n × p normal values with mean 0 and the SD of the corresponding input
 * variable, and is analysed exactly as the data (standardized or centered). The components
 * retained are the leading ones whose eigenvalue exceeds the upper percentile of the simulated
 * eigenvalues of the same rank. Percentiles use the type 6 definition (as our other
 * percentiles). Values are drawn column by column, as R's matrix(rnorm(n * p), n, p).
 */
function parallelAnalysis(
  n: number,
  p: number,
  sds: readonly number[],
  standardize: boolean,
  select: PcaSelectOptions,
  progress: ProgressFn | undefined,
): PcaParallel {
  const simulations = Math.max(1, Math.floor(select.simulations ?? 1000))
  const seed = select.seed ?? 1
  const level = select.value ?? 95
  const rng = new LecuyerRng(seed)
  const sims = Array.from({ length: p }, () => new Float64Array(simulations))
  const cols: Float64Array[] = Array.from({ length: p }, () => new Float64Array(n))
  const z = new Float64Array(n * p)
  const work = new Float64Array(n * p)
  // A simulation's decomposition costs about n p² operations.
  const stride = progressStride(n * p * p)
  for (let s = 0; s < simulations; s++) {
    for (let j = 0; j < p; j++) rng.fillNormal(cols[j]!, sds[j]!)
    preprocess(cols, n, p, standardize, z)
    const values = singularEigenvalues(z, n, p, work)
    for (let k = 0; k < p; k++) sims[k]![s] = values[k]!
    reportProgress(progress, s + 1, simulations, stride)
  }
  const meanOut: number[] = []
  const upper: number[] = []
  const lower: number[] = []
  for (let k = 0; k < p; k++) {
    const v = sims[k]!.sort()
    meanOut.push(mean(v))
    upper.push(quantileSorted(v, level / 100))
    lower.push(quantileSorted(v, 1 - level / 100))
  }
  return { mean: meanOut, percentile: upper, lower, level, simulations, seed }
}

/** Column-major n × p centered (and scaled) data (into `z` when given). */
function preprocess(
  cols: readonly Float64Array[],
  n: number,
  p: number,
  standardize: boolean,
  z = new Float64Array(n * p),
): Float64Array {
  for (let j = 0; j < p; j++) {
    const c = cols[j]!
    const m = mean(c)
    const s = standardize ? sd(c) : 1
    for (let i = 0; i < n; i++) z[i + j * n] = (c[i]! - m) / s
  }
  return z
}

/**
 * Eigen-decomposition of zᵀz / (n − 1) via the SVD of z: z = QR (Householder), then one-sided
 * Jacobi on R (Hestenes 1958; Demmel & Veselić 1992), which orthogonalizes the columns of R by
 * plane rotations accumulated in V. Returns eigenvalues in descending order and, if asked, V
 * (column-major p × p) with columns in the same order.
 */
function decompose(
  z: Float64Array,
  n: number,
  p: number,
  wantVectors: boolean,
): { values: number[]; vectors?: Float64Array } {
  const k = Math.min(n, p)
  const f = qrFactor(z, n, p, false)
  // B = R (k × p, upper trapezoidal), column-major.
  const B = new Float64Array(k * p)
  for (let j = 0; j < p; j++) {
    for (let i = 0; i < Math.min(j, k); i++) B[i + j * k] = f.qr[i + j * n]!
    if (j < k) B[j + j * k] = f.rdiag[j]!
  }
  const V = wantVectors ? new Float64Array(p * p) : null
  if (V) for (let j = 0; j < p; j++) V[j + j * p] = 1
  const sv = jacobiColumnNorms(B, k, p, V)
  const order = sv.map((_, j) => j).sort((x, y) => sv[y]! - sv[x]! || x - y)
  const smax = sv[order[0]!] ?? 0
  const cutoff = smax * Math.max(n, p) * EPS
  const values = order.map((j) => (sv[j]! <= cutoff ? 0 : sv[j]! ** 2 / (n - 1)))
  if (!V) return { values }
  const vectors = new Float64Array(p * p)
  order.forEach((j, col) => {
    for (let i = 0; i < p; i++) vectors[i + col * p] = V[i + j * p]!
  })
  return { values, vectors }
}

/**
 * One-sided Jacobi (Hestenes): orthogonalizes the p columns of B (k × p, column-major) in
 * place by plane rotations, accumulated in V (p × p) when given, and returns the column norms
 * (the singular values, unordered).
 */
function jacobiColumnNorms(
  B: Float64Array,
  k: number,
  p: number,
  V: Float64Array | null,
): number[] {
  const tol = Math.max(1e-15, k * EPS)
  for (let sweep = 0; sweep < 100; sweep++) {
    let rotated = false
    for (let a = 0; a < p - 1; a++) {
      for (let b = a + 1; b < p; b++) {
        let alpha = 0
        let beta = 0
        let gamma = 0
        for (let i = 0; i < k; i++) {
          const x = B[i + a * k]!
          const y = B[i + b * k]!
          alpha += x * x
          beta += y * y
          gamma += x * y
        }
        if (gamma === 0 || Math.abs(gamma) <= tol * Math.sqrt(alpha * beta)) continue
        rotated = true
        const zeta = (beta - alpha) / (2 * gamma)
        const t = (zeta >= 0 ? 1 : -1) / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta))
        const c = 1 / Math.sqrt(1 + t * t)
        const s = c * t
        for (let i = 0; i < k; i++) {
          const x = B[i + a * k]!
          const y = B[i + b * k]!
          B[i + a * k] = c * x - s * y
          B[i + b * k] = s * x + c * y
        }
        if (V) {
          for (let i = 0; i < p; i++) {
            const x = V[i + a * p]!
            const y = V[i + b * p]!
            V[i + a * p] = c * x - s * y
            V[i + b * p] = s * x + c * y
          }
        }
      }
    }
    if (!rotated) break
  }
  const sv: number[] = []
  for (let j = 0; j < p; j++) {
    let ss = 0
    for (let i = 0; i < k; i++) ss += B[i + j * k]! ** 2
    sv.push(Math.sqrt(ss))
  }
  return sv
}

/**
 * The eigenvalues of zᵀz / (n − 1) alone (descending, length p), for the parallel-analysis
 * simulations: as decompose without vectors, but with a lean unpivoted Householder QR that
 * writes into `work` (n·p doubles), and, when p > n, on zᵀ (p × n), whose n × n triangle
 * has the same singular values; the other p − n eigenvalues are exactly 0.
 */
function singularEigenvalues(z: Float64Array, n: number, p: number, work: Float64Array): number[] {
  const flip = p > n
  const m = flip ? p : n // rows
  const c = flip ? n : p // columns (= k, the size of R)
  const a = work
  if (flip) {
    for (let i = 0; i < n; i++) for (let j = 0; j < p; j++) a[j + i * p] = z[i + j * n]!
  } else a.set(z)
  const B = new Float64Array(c * c)
  for (let k = 0; k < c; k++) {
    const ck = k * m
    let ss = 0
    for (let i = k; i < m; i++) ss += a[ck + i]! * a[ck + i]!
    // Plain sum of squares unless it could have overflowed or underflowed.
    let nrm = ss > 1e-280 && ss < 1e280 ? Math.sqrt(ss) : norm2(a, ck + k, ck + m)
    if (nrm === 0) continue
    if (a[ck + k]! < 0) nrm = -nrm
    for (let i = k; i < m; i++) a[ck + i] = a[ck + i]! / nrm
    a[ck + k] = a[ck + k]! + 1
    const vk = a[ck + k]!
    for (let j = k + 1; j < c; j++) {
      const cj = j * m
      let dot = 0
      for (let i = k; i < m; i++) dot += a[ck + i]! * a[cj + i]!
      const t = -dot / vk
      for (let i = k; i < m; i++) a[cj + i] = a[cj + i]! + t * a[ck + i]!
      B[k + j * c] = a[cj + k]!
    }
    B[k + k * c] = -nrm
  }
  const sv = jacobiColumnNorms(B, c, c, null)
  const all = sv.concat(new Array<number>(p - c).fill(0))
  const order = all.map((_, j) => j).sort((x, y) => all[y]! - all[x]! || x - y)
  const smax = all[order[0]!] ?? 0
  const cutoff = smax * Math.max(n, p) * EPS
  return order.map((j) => (all[j]! <= cutoff ? 0 : all[j]! ** 2 / (n - 1)))
}

/** Flips column k of V (p × p, column-major) to the documented sign convention. */
function orient(V: Float64Array, p: number, k: number): void {
  let s = 0
  for (let i = 0; i < p; i++) s += V[i + k * p]!
  let sign = s > 0 ? 1 : -1
  if (Math.abs(s) <= 1e-8) {
    for (let i = 0; i < p; i++) {
      const v = V[i + k * p]!
      if (Math.abs(v) > 1e-8) {
        sign = v > 0 ? 1 : -1
        break
      }
    }
  }
  if (sign < 0) for (let i = 0; i < p; i++) V[i + k * p] = -V[i + k * p]!
}

function matrix(r: number, c: number, f: (i: number, j: number) => number): number[][] {
  return Array.from({ length: r }, (_, i) => Array.from({ length: c }, (_, j) => f(i, j)))
}

function nanResult(
  n: number,
  p: number,
  means: number[],
  sds: number[],
  standardized: boolean,
): PcaResult {
  const nanVec = () => Array.from({ length: p }, () => Number.NaN)
  return {
    eigenvalues: nanVec(),
    proportion: nanVec(),
    cumulative: nanVec(),
    eigenvectors: matrix(p, p, () => Number.NaN),
    loadings: matrix(p, p, () => Number.NaN),
    scores: matrix(n, p, () => Number.NaN),
    selected: 0,
    rank: 0,
    means,
    sds,
    n,
    standardized,
  }
}
