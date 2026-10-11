import {
  backSolve,
  cholesky,
  cholSolve,
  forwardSolve,
  forwardSolveRows,
  spdInverse,
  spdSolve,
} from '../linalg/cholesky.ts'
import { bilinear } from '../linalg/forms.ts'
import { applyQ, applyQt, norm2, qrFactor } from '../linalg/qr.ts'

/**
 * Linear mixed model with independent random-intercept variance components nested within
 * subjects, fitted by restricted maximum likelihood (REML) — the "mixed-effects model" for
 * repeated measures with missing values:
 *
 *   y = Xβ + Σ_t Z_t b_t + e,  b_t ~ N(0, σ_t² I),  e ~ N(0, σ² I),
 *
 * where every random term t (subject, subject × row, subject × column) has levels nested
 * within subjects, so V = σ²W with W = I + Σ_t ρ_t Z_t Z_tᵀ (ρ_t = σ_t²/σ²) is block-diagonal
 * by subject. Variances are constrained to ρ_t ≥ 0 (as lme4: a variance must be positive).
 *
 * Fitting: σ² is profiled out and the REML criterion
 *   d(ρ) = (N − p) log(rᵀW⁻¹r) + log|W| + log|XᵀW⁻¹X|
 * is minimised by projected Newton iterations with the analytic gradient and Hessian
 * (Harville 1977, JASA 72, 320–338; Searle, Casella & McCulloch 1992, Variance Components,
 * §6.6): with P = W⁻¹ − W⁻¹X(XᵀW⁻¹X)⁻¹XᵀW⁻¹ and u_t = Z_tᵀPy,
 *   ∂d/∂ρ_t = −(N − p) u_tᵀu_t / yᵀPy + tr(Z_tᵀPZ_t),
 *   ∂²d/∂ρ_t∂ρ_s = (N − p)[2 u_tᵀ(Z_tᵀPZ_s)u_s / yᵀPy − (u_tᵀu_t)(u_sᵀu_s)/(yᵀPy)²]
 *                  − ‖Z_tᵀPZ_s‖²_F.
 * Several starting points are tried and the best optimum is kept.
 * σ̂² = yᵀPy/(N − p). The reported REML log-likelihood is lme4's:
 *   −½[(N − p)(1 + log(2πσ̂²)) + log|W| + log|XᵀW⁻¹X|],
 * which depends on the coding of X (the callers use sum-to-zero coding, as
 * options(contrasts = c("contr.sum", "contr.poly")) in R).
 *
 * Evaluating d(ρ): with one random term (nested designs, the one-way mixed model) W is
 * block-diagonal by level, W_c⁻¹ = I − ρ/(1 + n_cρ)·11ᵀ, so every product with W⁻¹ is a
 * within-level sum (computed once) plus the level means weighted by 1/(1 + n_cρ), and
 * log|W| = Σ log(1 + n_cρ): linear in the observations, however many replicates a level has.
 * With several terms each subject's W_s is factored by Cholesky (subjects have few
 * observations in those designs).
 *
 * Satterthwaite degrees of freedom for a contrast l (as lmerTest; Kuznetsova, Brockhoff &
 * Christensen 2017, J. Stat. Softw. 82(13)): ν = 2(lᵀCl)² / (gᵀAg), C = cov(β̂) =
 * (XᵀV⁻¹X)⁻¹, g_a = lᵀ(∂C/∂θ_a)l over the variance parameters θ = (σ_t², σ²), and A the
 * inverse of the observed REML information −∂²ℓ/∂θ² = yᵀPV_aPV_bPy − ½tr(PV_aPV_b) at the
 * optimum. lmerTest parameterises θ differently (Cholesky factor and σ) and differentiates
 * numerically; at an interior optimum ν does not depend on the parameterisation. Variance
 * components estimated at exactly zero are held fixed (at lmerTest's θ = 0 their gradient
 * vanishes and the information is block-diagonal, which gives the same ν). The derivatives
 * of V with respect to σ² (V_a = I) are expressed through PVP = P, so no N×N matrix is formed.
 * Multi-df F tests combine the eigen-decomposed contrasts as lmerTest's contestMD does.
 */

export interface VcTerm {
  name: string
  /** Level of this term for each observation (0..nLevels − 1, every level used). */
  level: Int32Array
  nLevels: number
}

export interface VcDesign {
  /** Response (already shifted by a constant, see the callers). */
  y: Float64Array
  /** N × p design matrix, row-major. */
  X: Float64Array
  p: number
  /** Subject of each observation (0..nBlocks − 1). Random-term levels nest within subjects. */
  block: Int32Array
  nBlocks: number
  terms: VcTerm[]
}

interface Block {
  obs: number[]
  /** Global Z column of each local column. */
  cols: number[]
  /** For each observation of the block and each term, the local Z column. */
  local: Int32Array[]
}

/**
 * With at most one random term, W is block-diagonal by cluster (a level of the term, or with no
 * term a subject, where W = I): W_c = I + ρ11ᵀ, W_c⁻¹ = I − ρ/(1 + nρ)·11ᵀ. A cluster keeps its
 * within-cluster cross-products, which don't depend on ρ, so an evaluation costs O(p²) per
 * cluster plus one pass over the residuals, whatever the number of replicates.
 */
interface Cluster {
  obs: Int32Array
  /** Global Z column (−1: no random term). */
  col: number
  n: number
  xbar: Float64Array
  ybar: number
  /** Σ(x − x̄)(x − x̄)ᵀ (lower triangle, row-major p×p) and Σ(x − x̄)(y − ȳ). */
  sxx: Float64Array
  sxy: Float64Array
}

interface Eval {
  dev: number
  grad: Float64Array
  hess: Float64Array
  beta: Float64Array
  /** Cholesky factor of M = XᵀW⁻¹X (lower, row-major p×p). */
  mChol: Float64Array
  logdetW: number
  logdetM: number
  /** yᵀPy = rᵀW⁻¹r. */
  yPy: number
  /** ‖W⁻¹r‖². */
  vv: number
  /** u = ZᵀW⁻¹r (q). */
  u: Float64Array
  /** Per term: u_tᵀu_t and tr(Z_tᵀPZ_t). */
  uu: Float64Array
  trPG: Float64Array
  /** Per pair of terms (T×T): Q_ts = u_tᵀ(Z_tᵀPZ_s)u_s and T_ts = ‖Z_tᵀPZ_s‖²_F. */
  Qm: Float64Array
  Tm: Float64Array
  /** B = ZᵀW⁻¹X (q×p, row-major). */
  B: Float64Array
}

export interface VcFit {
  ok: true
  beta: Float64Array
  /** cov(β̂) = σ²(XᵀW⁻¹X)⁻¹, row-major p×p. */
  cov: Float64Array
  sigma2: number
  /** σ_t² per term. */
  variances: number[]
  rho: number[]
  /** REML log-likelihood (lme4's logLik(fit) for the same X). */
  logLik: number
  /** REML log-likelihood of the model without random effects (for the likelihood-ratio test). */
  logLik0: number
  nObs: number
  p: number
  /** Internal state for Satterthwaite df. */
  state: SattState
}

export type VcResult =
  | VcFit
  | { ok: false; reason: 'not-estimable' | 'no-residual-df' | 'degenerate' }

interface SattState {
  ev: Eval
  q: number
  colTerm: Int32Array
  nTerms: number
}

function buildBlocks(d: VcDesign): { blocks: Block[]; q: number; colTerm: Int32Array } {
  const N = d.y.length
  const offsets: number[] = []
  let q = 0
  for (const t of d.terms) {
    offsets.push(q)
    q += t.nLevels
  }
  const colTerm = new Int32Array(q)
  d.terms.forEach((t, k) => {
    colTerm.fill(k, offsets[k]!, offsets[k]! + t.nLevels)
  })
  const blocks: Block[] = Array.from({ length: d.nBlocks }, () => ({
    obs: [],
    cols: [],
    local: [],
  }))
  const localOf: Map<number, number>[] = blocks.map(() => new Map())
  for (let i = 0; i < N; i++) {
    const b = d.block[i]!
    const blk = blocks[b]!
    const loc = new Int32Array(d.terms.length)
    d.terms.forEach((t, k) => {
      const col = offsets[k]! + t.level[i]!
      let l = localOf[b]!.get(col)
      if (l === undefined) {
        l = blk.cols.length
        blk.cols.push(col)
        localOf[b]!.set(col, l)
      }
      loc[k] = l
    })
    blk.obs.push(i)
    blk.local.push(loc)
  }
  return { blocks: blocks.filter((b) => b.obs.length > 0), q, colTerm }
}

/** The clusters of a design with at most one random term, with their within-cluster sums. */
function clusters(d: VcDesign, blocks: readonly Block[]): Cluster[] {
  const p = d.p
  const t = d.terms[0]
  const groups = new Map<number, number[]>()
  // With a term, a cluster is a Z column (a term level, which lies in one subject); without one,
  // a subject.
  blocks.forEach((blk) => {
    blk.obs.forEach((i, r) => {
      const key = t ? blk.cols[blk.local[r]![0]!]! : -1 - d.block[i]!
      let g = groups.get(key)
      if (!g) {
        g = []
        groups.set(key, g)
      }
      g.push(i)
    })
  })
  const out: Cluster[] = []
  for (const [key, list] of groups) {
    const obs = Int32Array.from(list)
    const n = obs.length
    const xbar = new Float64Array(p)
    for (let k = 0; k < p; k++) xbar[k] = meanOf(obs, (i) => d.X[i * p + k]!)
    const ybar = meanOf(obs, (i) => d.y[i]!)
    const sxx = new Float64Array(p * p)
    const sxy = new Float64Array(p)
    const dx = new Float64Array(p)
    for (const i of obs) {
      const dy = d.y[i]! - ybar
      for (let k = 0; k < p; k++) dx[k] = d.X[i * p + k]! - xbar[k]!
      for (let a = 0; a < p; a++) {
        const xa = dx[a]!
        if (xa === 0) continue
        sxy[a] = sxy[a]! + xa * dy
        for (let b = 0; b <= a; b++) sxx[a * p + b] = sxx[a * p + b]! + xa * dx[b]!
      }
    }
    out.push({ obs, col: key >= 0 ? key : -1, n, xbar, ybar, sxx, sxy })
  }
  return out
}

/** Mean of v over obs by two passes (the second adds the mean deviation from the first). */
function meanOf(obs: Int32Array, v: (i: number) => number): number {
  let s = 0
  for (const i of obs) s += v(i)
  const m = s / obs.length
  let c = 0
  for (const i of obs) c += v(i) - m
  return m + c / obs.length
}

/** The products evaluate() needs from W⁻¹, and the residual quantities once β is known. */
interface Whitened {
  /** M = XᵀW⁻¹X (lower triangle), XᵀW⁻¹y, B = ZᵀW⁻¹X, the subject blocks of ZᵀW⁻¹Z. */
  M: Float64Array
  bv: Float64Array
  B: Float64Array
  zwz: Float64Array[]
  logdetW: number
  /** yᵀPy = rᵀW⁻¹r, ‖W⁻¹r‖² and u = ZᵀW⁻¹r for r = y − Xβ. */
  residuals: (beta: Float64Array) => { yPy: number; vv: number; u: Float64Array }
}

/** At most one random term: the closed form per cluster (see `Cluster`). */
function whitenClusters(
  d: VcDesign,
  blocks: readonly Block[],
  clus: readonly Cluster[],
  q: number,
  rho: readonly number[],
): Whitened {
  const p = d.p
  const r0 = d.terms.length > 0 ? rho[0]! : 0
  const M = new Float64Array(p * p)
  const bv = new Float64Array(p)
  const B = new Float64Array(q * p)
  const colNw = new Float64Array(q)
  // w = 1/(1 + nρ) weighs a cluster's mean: W⁻¹v = (v − v̄1) + w·v̄1, so uᵀW⁻¹v is the
  // within-cluster cross-product plus n·w·ū·v̄, two terms that never cancel.
  const w = clus.map((c) => 1 / (1 + c.n * r0))
  let logdetW = 0
  clus.forEach((c, j) => {
    const nw = c.n * w[j]!
    if (c.col >= 0) {
      logdetW += Math.log1p(c.n * r0)
      colNw[c.col] = nw
      for (let b = 0; b < p; b++) B[c.col * p + b] = nw * c.xbar[b]!
    }
    for (let a = 0; a < p; a++) {
      const xa = c.xbar[a]!
      bv[a] = bv[a]! + c.sxy[a]! + nw * xa * c.ybar
      for (let b = 0; b <= a; b++)
        M[a * p + b] = M[a * p + b]! + c.sxx[a * p + b]! + nw * xa * c.xbar[b]!
    }
  })
  // ZᵀW⁻¹Z is diagonal: n·w per column.
  const zwz = blocks.map((blk) => {
    const qs = blk.cols.length
    const zb = new Float64Array(qs * qs)
    for (let l = 0; l < qs; l++) zb[l * qs + l] = colNw[blk.cols[l]!]!
    return zb
  })
  const residuals = (beta: Float64Array) => {
    const u = new Float64Array(q)
    let yPy = 0
    let vv = 0
    let r = new Float64Array(0)
    clus.forEach((c, j) => {
      const n = c.n
      if (r.length < n) r = new Float64Array(n)
      let s = 0
      for (let k = 0; k < n; k++) {
        const i = c.obs[k]!
        let v = d.y[i]!
        for (let a = 0; a < p; a++) v -= d.X[i * p + a]! * beta[a]!
        r[k] = v
        s += v
      }
      let mean = s / n
      let corr = 0
      for (let k = 0; k < n; k++) corr += r[k]! - mean
      mean += corr / n
      let ss = 0
      for (let k = 0; k < n; k++) ss += (r[k]! - mean) ** 2
      const wj = w[j]!
      yPy += ss + n * wj * mean * mean
      vv += ss + n * wj * wj * mean * mean
      if (c.col >= 0) u[c.col] = n * wj * mean
    })
    return { yPy, vv, u }
  }
  return { M, bv, B, zwz, logdetW, residuals }
}

/**
 * Several random terms: each subject's W_s = L Lᵀ (dense Cholesky; a subject has few
 * observations in these designs), and everything from the whitened blocks L⁻¹[X y Z]:
 *   M = XᵀW⁻¹X = X̃ᵀX̃,  B = ZᵀW⁻¹X = Z̃ᵀX̃,  c = ZᵀW⁻¹y,  ZᵀW⁻¹Z = Z̃ᵀZ̃ (block-diagonal).
 */
function whitenDense(
  d: VcDesign,
  blocks: readonly Block[],
  q: number,
  rho: readonly number[],
): Whitened | null {
  const p = d.p
  const T = d.terms.length
  const M = new Float64Array(p * p)
  const bv = new Float64Array(p)
  const B = new Float64Array(q * p)
  const c = new Float64Array(q)
  const zwz: Float64Array[] = []
  const Ls: Float64Array[] = []
  const Xt: Float64Array[] = []
  const Yt: Float64Array[] = []
  let logdetW = 0
  for (const blk of blocks) {
    const m = blk.obs.length
    const qs = blk.cols.length
    const W = new Float64Array(m * m)
    for (let i = 0; i < m; i++) {
      for (let j = 0; j <= i; j++) {
        let v = i === j ? 1 : 0
        for (let t = 0; t < T; t++) if (blk.local[i]![t] === blk.local[j]![t]) v += rho[t]!
        W[i * m + j] = v
        W[j * m + i] = v
      }
    }
    if (!cholesky(W, m)) return null
    for (let i = 0; i < m; i++) logdetW += 2 * Math.log(W[i * m + i]!)
    const xt = new Float64Array(m * p)
    for (let i = 0; i < m; i++)
      for (let k = 0; k < p; k++) xt[i * p + k] = d.X[blk.obs[i]! * p + k]!
    forwardSolveRows(W, m, xt, p)
    const yt = new Float64Array(m)
    for (let i = 0; i < m; i++) yt[i] = d.y[blk.obs[i]!]!
    forwardSolve(W, m, yt, 0, 1)
    const zt = new Float64Array(m * qs)
    for (let i = 0; i < m; i++) for (let t = 0; t < T; t++) zt[i * qs + blk.local[i]![t]!] = 1
    forwardSolveRows(W, m, zt, qs)
    Ls.push(W)
    Xt.push(xt)
    Yt.push(yt)
    for (let i = 0; i < m; i++) {
      const yi = yt[i]!
      for (let a = 0; a < p; a++) {
        const xa = xt[i * p + a]!
        if (xa === 0) continue
        bv[a] = bv[a]! + xa * yi
        for (let b = 0; b <= a; b++) M[a * p + b] = M[a * p + b]! + xa * xt[i * p + b]!
      }
    }
    const zb = new Float64Array(qs * qs)
    for (let l = 0; l < qs; l++) {
      const g = blk.cols[l]!
      for (let i = 0; i < m; i++) {
        const z = zt[i * qs + l]!
        if (z === 0) continue
        c[g] = c[g]! + z * yt[i]!
        for (let b = 0; b < p; b++) B[g * p + b] = B[g * p + b]! + z * xt[i * p + b]!
        for (let l2 = 0; l2 <= l; l2++) zb[l * qs + l2] = zb[l * qs + l2]! + z * zt[i * qs + l2]!
      }
    }
    for (let l = 0; l < qs; l++) for (let l2 = 0; l2 < l; l2++) zb[l2 * qs + l] = zb[l * qs + l2]!
    zwz.push(zb)
  }
  // yᵀPy = ‖L⁻¹r‖², and W⁻¹r = L⁻ᵀ(L⁻¹r) for ‖W⁻¹r‖².
  const residuals = (beta: Float64Array) => {
    let yPy = 0
    let vv = 0
    blocks.forEach((blk, s) => {
      const xt = Xt[s]!
      const yt = Yt[s]!
      const m = blk.obs.length
      const rt = new Float64Array(m)
      for (let i = 0; i < m; i++) {
        let r = yt[i]!
        for (let k = 0; k < p; k++) r -= xt[i * p + k]! * beta[k]!
        rt[i] = r
        yPy += r * r
      }
      backSolve(Ls[s]!, m, rt)
      for (let i = 0; i < m; i++) vv += rt[i]! * rt[i]!
    })
    const u = new Float64Array(q)
    for (let g = 0; g < q; g++) {
      let s = c[g]!
      for (let k = 0; k < p; k++) s -= B[g * p + k]! * beta[k]!
      u[g] = s
    }
    return { yPy, vv, u }
  }
  return { M, bv, B, zwz, logdetW, residuals }
}

function evaluate(
  d: VcDesign,
  blocks: readonly Block[],
  clus: readonly Cluster[] | null,
  q: number,
  colTerm: Int32Array,
  rho: readonly number[],
): Eval | null {
  const N = d.y.length
  const p = d.p
  const T = d.terms.length
  const wh = clus ? whitenClusters(d, blocks, clus, q, rho) : whitenDense(d, blocks, q, rho)
  if (!wh) return null
  const { M, bv, B, zwz, logdetW } = wh
  for (let a = 0; a < p; a++) for (let b = 0; b < a; b++) M[b * p + a] = M[a * p + b]!
  const mChol = Float64Array.from(M)
  if (!cholesky(mChol, p)) return null
  let logdetM = 0
  for (let a = 0; a < p; a++) logdetM += 2 * Math.log(mChol[a * p + a]!)
  const beta = Float64Array.from(bv)
  cholSolve(mChol, p, beta)
  const { yPy, vv, u } = wh.residuals(beta)
  // ZᵀPZ = ZᵀW⁻¹Z − B M⁻¹ Bᵀ = ZᵀW⁻¹Z − K Kᵀ with K = B L_M⁻ᵀ (rows K_g = L_M⁻¹B_gᵀ). The
  // Newton iterations need only its diagonal and, per pair of terms, Q_ts = u_tᵀ(Z_tᵀPZ_s)u_s
  // and T_ts = ‖Z_tᵀPZ_s‖²_F, which follow from the subject blocks A of ZᵀW⁻¹Z and p×p
  // products, without forming the dense q×q matrix:
  //   Q_ts = Σ_blocks u_tᵀA u_s − k_t·k_s,  k_t = Σ_{g∈t} u_g K_g,
  //   T_ts = Σ_blocks A_gh (A_gh − 2 K_g·K_h) + tr(G_t G_s),  G_t = Σ_{g∈t} K_gK_gᵀ.
  const K = Float64Array.from(B)
  for (let g = 0; g < q; g++) forwardSolve(mChol, p, K, g * p, 1)
  const kk = (g: number, h: number): number => {
    let s = 0
    for (let k = 0; k < p; k++) s += K[g * p + k]! * K[h * p + k]!
    return s
  }
  const uu = new Float64Array(T)
  const trPG = new Float64Array(T)
  const Qm = new Float64Array(T * T)
  const Tm = new Float64Array(T * T)
  blocks.forEach((blk, b) => {
    const zb = zwz[b]!
    const qs = blk.cols.length
    for (let l1 = 0; l1 < qs; l1++) {
      const g = blk.cols[l1]!
      const t = colTerm[g]!
      const a = zb[l1 * qs + l1]!
      const kgg = kk(g, g)
      trPG[t] = trPG[t]! + (a - kgg)
      const tt = t * T + t
      Qm[tt] = Qm[tt]! + u[g]! * a * u[g]!
      Tm[tt] = Tm[tt]! + a * (a - 2 * kgg)
      // Both (g, h) and (h, g): the blocks and K Kᵀ are symmetric.
      for (let l2 = 0; l2 < l1; l2++) {
        const h = blk.cols[l2]!
        const a = zb[l1 * qs + l2]!
        if (a === 0) continue
        const s = colTerm[h]!
        const qv = u[g]! * a * u[h]!
        const tv = a * (a - 2 * kk(g, h))
        Qm[t * T + s] = Qm[t * T + s]! + qv
        Qm[s * T + t] = Qm[s * T + t]! + qv
        Tm[t * T + s] = Tm[t * T + s]! + tv
        Tm[s * T + t] = Tm[s * T + t]! + tv
      }
    }
  })
  const kt = new Float64Array(T * p)
  const G = new Float64Array(T * p * p)
  for (let g = 0; g < q; g++) {
    const t = colTerm[g]!
    uu[t] = uu[t]! + u[g]! * u[g]!
    for (let k = 0; k < p; k++) {
      const v = K[g * p + k]!
      kt[t * p + k] = kt[t * p + k]! + u[g]! * v
      for (let k2 = 0; k2 <= k; k2++) {
        G[(t * p + k) * p + k2] = G[(t * p + k) * p + k2]! + v * K[g * p + k2]!
      }
    }
  }
  for (let t = 0; t < T; t++) {
    for (let s = 0; s < T; s++) {
      let qv = 0
      for (let k = 0; k < p; k++) qv += kt[t * p + k]! * kt[s * p + k]!
      // tr(G_t G_s) over the stored lower triangles (symmetric matrices).
      let tr = 0
      for (let i = 0; i < p; i++) {
        tr += G[(t * p + i) * p + i]! * G[(s * p + i) * p + i]!
        for (let j = 0; j < i; j++) tr += 2 * G[(t * p + i) * p + j]! * G[(s * p + i) * p + j]!
      }
      Qm[t * T + s] = Qm[t * T + s]! - qv
      Tm[t * T + s] = Tm[t * T + s]! + tr
    }
  }
  const np = N - p
  const dev = np * Math.log(yPy) + logdetW + logdetM
  const grad = new Float64Array(T)
  for (let t = 0; t < T; t++) grad[t] = (-np * uu[t]!) / yPy + trPG[t]!
  const hess = new Float64Array(T * T)
  for (let t = 0; t < T; t++) {
    for (let s = 0; s < T; s++) {
      hess[t * T + s] =
        np * ((2 * Qm[t * T + s]!) / yPy - (uu[t]! * uu[s]!) / (yPy * yPy)) - Tm[t * T + s]!
    }
  }
  return { dev, grad, hess, beta, mChol, logdetW, logdetM, yPy, vv, u, uu, trPG, Qm, Tm, B }
}

/**
 * Minimises the profiled REML criterion over ρ ≥ 0 from one start: projected Newton with
 * backtracking; variables at the bound whose gradient points outward are held there.
 */
function newton(
  f: (rho: readonly number[]) => Eval | null,
  start: readonly number[],
): { rho: number[]; ev: Eval } | null {
  const T = start.length
  let rho = start.slice()
  let ev = f(rho)
  if (!ev) return null
  for (let iter = 0; iter < 200; iter++) {
    const free: number[] = []
    for (let t = 0; t < T; t++) if (!(rho[t] === 0 && ev.grad[t]! >= 0)) free.push(t)
    if (free.length === 0) break
    const nf = free.length
    const Hf = new Float64Array(nf * nf)
    const gf = new Float64Array(nf)
    free.forEach((t, a) => {
      gf[a] = -ev!.grad[t]!
      free.forEach((s, b) => {
        Hf[a * nf + b] = ev!.hess[t * T + s]!
      })
    })
    let step = spdSolve(Hf, nf, gf)
    if (!step) {
      // Not convex here: Levenberg-damped Newton, falling back to scaled steepest descent.
      let lam = 1e-8
      for (let k = 0; k < 40 && !step; k++) {
        const Hd = Float64Array.from(Hf)
        let scale = 0
        for (let a = 0; a < nf; a++) scale = Math.max(scale, Math.abs(Hf[a * nf + a]!))
        for (let a = 0; a < nf; a++) Hd[a * nf + a] = Hd[a * nf + a]! + lam * Math.max(scale, 1)
        step = spdSolve(Hd, nf, gf)
        lam *= 10
      }
      if (!step) return { rho, ev }
    }
    let alpha = 1
    let accepted = false
    let maxRel = 0
    for (let ls = 0; ls < 60; ls++) {
      const trial = rho.slice()
      free.forEach((t, a) => {
        trial[t] = Math.max(0, rho[t]! + alpha * step![a]!)
      })
      const et = f(trial)
      if (et && et.dev <= ev.dev + 1e-14 * Math.abs(ev.dev)) {
        maxRel = 0
        for (let t = 0; t < T; t++) {
          maxRel = Math.max(maxRel, Math.abs(trial[t]! - rho[t]!) / (1 + rho[t]!))
        }
        const improved = et.dev < ev.dev
        rho = trial
        ev = et
        accepted = improved || maxRel === 0
        break
      }
      alpha /= 2
    }
    if (!accepted || maxRel < 1e-14) break
  }
  return { rho, ev }
}

/** Fits the model by REML. `starts` are ρ vectors to try (default: 0.1, 1 and 10 for all). */
export function fitReml(d: VcDesign, starts?: readonly (readonly number[])[]): VcResult {
  const N = d.y.length
  const p = d.p
  const T = d.terms.length
  if (N - p <= 0) return { ok: false, reason: 'no-residual-df' }
  const { blocks, q, colTerm } = buildBlocks(d)
  const clus = T <= 1 ? clusters(d, blocks) : null
  const f = (rho: readonly number[]) => evaluate(d, blocks, clus, q, colTerm, rho)
  const e0 = f(new Array<number>(T).fill(0))
  if (!e0) return { ok: false, reason: 'not-estimable' }
  if (!(e0.yPy > 0) || !Number.isFinite(e0.yPy)) return { ok: false, reason: 'degenerate' }
  const tries = starts ?? [0.1, 1, 10].map((v) => new Array<number>(T).fill(v))
  let best: { rho: number[]; ev: Eval } | null = null
  for (const s of tries) {
    const r = newton(f, s)
    if (r && (!best || r.ev.dev < best.ev.dev)) best = r
  }
  if (!best) return { ok: false, reason: 'degenerate' }
  // A last polish from the best point (cheap; converges in 0–1 steps).
  const pol = newton(f, best.rho)
  if (pol && pol.ev.dev <= best.ev.dev) best = pol
  const { rho, ev } = best
  const np = N - p
  const sigma2 = ev.yPy / np
  // No residual variation left (the data are exactly additive in subject and treatment): the
  // REML optimum has σ² → 0 and every test statistic is rounding noise.
  if (!(sigma2 > 1e-12 * (e0.yPy / np))) return { ok: false, reason: 'degenerate' }
  const fullDev = (e: Eval) =>
    np * (1 + Math.log((2 * Math.PI * e.yPy) / np)) + e.logdetW + e.logdetM
  // cov(β̂) = σ² M⁻¹
  const cov = new Float64Array(p * p)
  for (let k = 0; k < p; k++) {
    const col = new Float64Array(p)
    col[k] = 1
    cholSolve(ev.mChol, p, col)
    for (let a = 0; a < p; a++) cov[a * p + k] = sigma2 * col[a]!
  }
  return {
    ok: true,
    beta: ev.beta,
    cov,
    sigma2,
    variances: rho.map((r) => r * sigma2),
    rho,
    logLik: -0.5 * fullDev(ev),
    logLik0: -0.5 * fullDev(e0),
    nObs: N,
    p,
    state: { ev, q, colTerm, nTerms: T },
  }
}

/**
 * Observed REML information for θ = (σ_t² for terms with ρ_t > 0, σ²) and the Jacobian
 * builder for contrasts.
 */
function sattPieces(fit: VcFit): {
  A: Float64Array | null
  free: number[]
  grad: (l: ArrayLike<number>) => Float64Array
} {
  const { ev, q, colTerm, nTerms: T } = fit.state
  const { rho, sigma2: s2, p } = fit
  const N = fit.nObs
  // The per-term sums over ZᵀPZ come from evaluate(), which forms them block by block: no q × q
  // matrix (1.2 GB at 12,000 subjects).
  const { Qm, Tm, trPG, uu } = ev
  // Rows/columns for V_a = I from the identity Σ_a θ_a V_a = V (P V P = P), in W units.
  const TI = new Float64Array(T)
  const QI = new Float64Array(T)
  let trP = N - fit.p
  for (let s = 0; s < T; s++) {
    let t1 = trPG[s]!
    let q1 = uu[s]!
    for (let t = 0; t < T; t++) {
      t1 -= rho[t]! * Tm[t * T + s]!
      q1 -= rho[t]! * Qm[t * T + s]!
    }
    TI[s] = t1
    QI[s] = q1
    trP -= rho[s]! * trPG[s]!
  }
  let TII = trP
  let QII = ev.vv
  for (let t = 0; t < T; t++) {
    TII -= rho[t]! * TI[t]!
    QII -= rho[t]! * QI[t]!
  }
  const free = [...Array(T).keys()].filter((t) => rho[t]! > 0)
  const n = free.length + 1
  const info = new Float64Array(n * n)
  const s4 = s2 * s2
  const s6 = s4 * s2
  const idx = (a: number) => (a < free.length ? free[a]! : -1)
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      const ta = idx(a)
      const tb = idx(b)
      let Tv: number
      let Qv: number
      if (ta >= 0 && tb >= 0) {
        Tv = Tm[ta * T + tb]!
        Qv = Qm[ta * T + tb]!
      } else if (ta >= 0 || tb >= 0) {
        const t = ta >= 0 ? ta : tb
        Tv = TI[t]!
        Qv = QI[t]!
      } else {
        Tv = TII
        Qv = QII
      }
      info[a * n + b] = Qv / s6 - (0.5 * Tv) / s4
    }
  }
  const A = spdInverse(info, n)
  const grad = (l: ArrayLike<number>): Float64Array => {
    const w = new Float64Array(p)
    for (let k = 0; k < p; k++) w[k] = l[k]!
    cholSolve(ev.mChol, p, w)
    const gt = new Float64Array(T)
    for (let g = 0; g < q; g++) {
      let s = 0
      for (let k = 0; k < p; k++) s += ev.B[g * p + k]! * w[k]!
      gt[colTerm[g]!] = gt[colTerm[g]!]! + s * s
    }
    let lw = 0
    for (let k = 0; k < p; k++) lw += l[k]! * w[k]!
    let gI = lw
    for (let t = 0; t < T; t++) gI -= rho[t]! * gt[t]!
    const out = new Float64Array(n)
    free.forEach((t, a) => {
      out[a] = gt[t]!
    })
    out[n - 1] = gI
    return out
  }
  return { A, free, grad }
}

/** lᵀβ̂, its SE, and Satterthwaite's df for a contrast l. */
export function contrastEstimate(
  fit: VcFit,
  l: ArrayLike<number>,
): { est: number; se: number; varEst: number } {
  const p = fit.p
  let est = 0
  for (let a = 0; a < p; a++) est += l[a]! * fit.beta[a]!
  const v = bilinear(l, fit.cov, l, p)
  return { est, se: Math.sqrt(v), varEst: v }
}

/** Covariance of the estimates of contrasts ls[a] and ls[b]: l_aᵀ Cov(β̂) l_b. */
export function contrastCov(fit: VcFit, ls: readonly ArrayLike<number>[]) {
  return (a: number, b: number): number => bilinear(ls[a]!, fit.cov, ls[b]!, fit.p)
}

/** Unit rows e_from … e_{to−1} of length p: L testing that those coefficients are 0. */
export function unitRows(p: number, from: number, to: number): number[][] {
  return Array.from({ length: to - from }, (_, k) => {
    const l = new Array<number>(p).fill(0)
    l[from + k] = 1
    return l
  })
}

export function satterthwaiteDf(fit: VcFit, ls: readonly ArrayLike<number>[]): number[] {
  const { A, grad } = sattPieces(fit)
  return ls.map((l) => {
    const { varEst } = contrastEstimate(fit, l)
    if (!A) return Number.NaN
    const g = grad(l)
    return (2 * varEst * varEst) / bilinear(g, A, g)
  })
}

export interface WaldF {
  F: number
  dfn: number
  /**
   * Satterthwaite denominator df (lmerTest's contestMD), worked out when first called: the
   * containment df needs none of it.
   */
  dfdSatterthwaite: () => number
}

/**
 * Wald F test of Lβ = 0 (rows of L are contrasts in β), F = (Lβ̂)ᵀ(LCLᵀ)⁻¹(Lβ̂)/q, with
 * lmerTest's multi-df Satterthwaite df: LCLᵀ = PDPᵀ, ν_m for each eigen-contrast p_mᵀL, and
 * ν = 2E/(E − q), E = Σ ν_m/(ν_m − 2) (2 if any ν_m ≤ 2; the common value if all are equal
 * to 1e-8).
 */
export function waldF(fit: VcFit, L: readonly (readonly number[])[]): WaldF {
  const p = fit.p
  const m = L.length
  const LC = L.map((l) => {
    const out = new Float64Array(p)
    for (let b = 0; b < p; b++) {
      let s = 0
      for (let a = 0; a < p; a++) s += l[a]! * fit.cov[a * p + b]!
      out[b] = s
    }
    return out
  })
  const S = new Float64Array(m * m)
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < m; j++) {
      let s = 0
      for (let b = 0; b < p; b++) s += LC[i]![b]! * L[j]![b]!
      S[i * m + j] = s
    }
  }
  const { values, vectors } = symmetricEigen(S, m)
  const tol = Math.max(Math.sqrt(Number.EPSILON) * values[0]!, 0)
  const pos = values.map((v, k) => (v > tol ? k : -1)).filter((k) => k >= 0)
  const qn = pos.length
  if (qn === 0) return { F: Number.NaN, dfn: 0, dfdSatterthwaite: () => Number.NaN }
  const rows = pos.map((k) => {
    const out = new Float64Array(p)
    for (let i = 0; i < m; i++) {
      const v = vectors[i * m + k]!
      for (let b = 0; b < p; b++) out[b] = out[b]! + v * L[i]![b]!
    }
    return out
  })
  let F = 0
  rows.forEach((r, a) => {
    let e = 0
    for (let b = 0; b < p; b++) e += r[b]! * fit.beta[b]!
    F += (e * e) / values[pos[a]!]!
  })
  F /= qn
  let dfd: number | null = null
  const dfdSatterthwaite = () => {
    dfd ??= combineDf(satterthwaiteDf(fit, rows))
    return dfd
  }
  return { F, dfn: qn, dfdSatterthwaite }
}

function combineDf(nu: readonly number[]): number {
  if (nu.length === 1) return nu[0]!
  if (nu.some((v) => Number.isNaN(v))) return Number.NaN
  let same = true
  for (let i = 1; i < nu.length; i++) if (!(Math.abs(nu[i]! - nu[i - 1]!) < 1e-8)) same = false
  if (same) return nu.reduce((s, v) => s + v, 0) / nu.length
  if (nu.some((v) => v <= 2)) return 2
  const E = nu.reduce((s, v) => s + v / (v - 2), 0)
  return (2 * E) / (E - nu.length)
}

/**
 * Eigen-decomposition of a small symmetric matrix by cyclic Jacobi rotations (Golub & Van Loan,
 * Matrix Computations, 4th ed., Alg. 8.5.3). Eigenvalues in decreasing order; eigenvectors in
 * the columns of `vectors` (row-major n×n).
 */
function symmetricEigen(
  S: ArrayLike<number>,
  n: number,
): { values: number[]; vectors: Float64Array } {
  const a = Float64Array.from(S)
  const v = new Float64Array(n * n)
  for (let i = 0; i < n; i++) v[i * n + i] = 1
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0
    let tot = 0
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const x = a[i * n + j]! * a[i * n + j]!
        tot += x
        if (i !== j) off += x
      }
    }
    if (off <= 1e-32 * tot || off === 0) break
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p * n + q]!
        if (apq === 0) continue
        const tau = (a[q * n + q]! - a[p * n + p]!) / (2 * apq)
        const t = Math.sign(tau || 1) / (Math.abs(tau) + Math.sqrt(1 + tau * tau))
        const c = 1 / Math.sqrt(1 + t * t)
        const s = t * c
        for (let k = 0; k < n; k++) {
          const akp = a[k * n + p]!
          const akq = a[k * n + q]!
          a[k * n + p] = c * akp - s * akq
          a[k * n + q] = s * akp + c * akq
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p * n + k]!
          const aqk = a[q * n + k]!
          a[p * n + k] = c * apk - s * aqk
          a[q * n + k] = s * apk + c * aqk
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k * n + p]!
          const vkq = v[k * n + q]!
          v[k * n + p] = c * vkp - s * vkq
          v[k * n + q] = s * vkp + c * vkq
        }
      }
    }
  }
  const order = [...Array(n).keys()].sort((i, j) => a[j * n + j]! - a[i * n + i]!)
  const vectors = new Float64Array(n * n)
  order.forEach((k, col) => {
    for (let i = 0; i < n; i++) vectors[i * n + col] = v[i * n + k]!
  })
  return { values: order.map((k) => a[k * n + k]!), vectors }
}

/**
 * Containment denominator df (SAS PROC MIXED's default DDFM=CONTAIN with a RANDOM statement,
 * the usual SAS code for these models): for a
 * fixed effect contained in random terms `containing`, the smallest rank contribution of those
 * terms to [X Z] (here: the drop in rank(X Z) when the term's columns are removed); with no
 * containing term, the residual df N − rank(X Z).
 */
export function containmentDf(d: VcDesign, containing: readonly number[]): number {
  const N = d.y.length
  const full = designRank(d, [])
  if (containing.length === 0) return N - full
  let best = Number.POSITIVE_INFINITY
  for (const t of containing) best = Math.min(best, full - designRank(d, [t]))
  return best
}

/**
 * Containment df from the sequential rank contribution of the containing term `t` (random terms
 * in their order, which lists every term after the terms nested in it):
 * rank([X Z₀ … Z_t]) − rank([X Z₀ … Z_{t−1}]); the residual df N − rank([X Z]) for t = −1.
 * Equal to `containmentDf` when no later term spans the containing one; needed when it does
 * (three-way designs with every factor repeated, where subject × row lies in the span of
 * subject × row × column).
 */
export function containmentDfSequential(d: VcDesign, t: number): number {
  const N = d.y.length
  const all = d.terms.map((_, k) => k)
  if (t < 0) return N - designRank(d, [])
  return (
    designRank(
      d,
      all.filter((k) => k > t),
    ) -
    designRank(
      d,
      all.filter((k) => k >= t),
    )
  )
}

/**
 * rank([X Z]) without the terms in `drop`, from the subject-block structure of Z: every Z
 * column lives in one subject's rows, so
 *   rank([X Z]) = Σ_b rank(Z_b) + rank((I − P_Z) X),
 * with P_Z the block-diagonal projection onto col(Z). Each Z_b gets a small pivoted QR, which
 * also gives that block's rows of (I − P_Z)X; only the N × p residual of X needs one more QR.
 * A diagonal of R counts when it exceeds 1e−9 times the largest column norm of [X Z] (what a
 * pivoted QR of the whole matrix has as |r₁₁|).
 */
function designRank(d: VcDesign, drop: readonly number[]): number {
  const N = d.y.length
  const p = d.p
  const terms = d.terms.filter((_, k) => !drop.includes(k))
  // Largest column norm of [X Z].
  let ref = 0
  const xcol = new Float64Array(N)
  for (let k = 0; k < p; k++) {
    for (let i = 0; i < N; i++) xcol[i] = d.X[i * p + k]!
    ref = Math.max(ref, norm2(xcol, 0, N))
  }
  for (const t of terms) {
    const count = new Int32Array(t.nLevels)
    for (let i = 0; i < N; i++) count[t.level[i]!]!++
    for (const c of count) ref = Math.max(ref, Math.sqrt(c))
  }
  if (!(ref > 0)) return 0
  const tol = 1e-9 * ref
  const countRank = (rdiag: Float64Array, steps: number): number => {
    let r = 0
    while (r < steps && Math.abs(rdiag[r]!) > tol) r++
    return r
  }
  const byBlock: number[][] = Array.from({ length: d.nBlocks }, () => [])
  for (let i = 0; i < N; i++) byBlock[d.block[i]!]!.push(i)
  // (I − P_Z)X, column-major N × p; rows grouped by block (row order does not affect rank).
  const E = new Float64Array(N * p)
  let rank = 0
  let row = 0
  for (const obs of byBlock) {
    const nb = obs.length
    if (nb === 0) continue
    // Local Z columns of this block: one per level of each term present.
    const cols: number[][] = []
    for (const t of terms) {
      const local = new Map<number, number>()
      obs.forEach((i, r) => {
        let c = local.get(t.level[i]!)
        if (c === undefined) {
          c = cols.length
          local.set(t.level[i]!, c)
          cols.push([])
        }
        cols[c]!.push(r)
      })
    }
    const qb = cols.length
    const y = new Float64Array(nb)
    let f: ReturnType<typeof qrFactor> | null = null
    let rb = 0
    if (qb > 0) {
      const Zb = new Float64Array(nb * qb)
      cols.forEach((rows, c) => {
        for (const r of rows) Zb[c * nb + r] = 1
      })
      f = qrFactor(Zb, nb, qb, true)
      rb = countRank(f.rdiag, Math.min(nb, qb))
      rank += rb
    }
    for (let k = 0; k < p; k++) {
      for (let r = 0; r < nb; r++) y[r] = d.X[obs[r]! * p + k]!
      if (f && rb > 0) {
        applyQt(f, y)
        y.fill(0, 0, rb)
        applyQ(f, y)
      }
      E.set(y, k * N + row)
    }
    row += nb
  }
  if (p > 0) rank += countRank(qrFactor(E, N, p, true).rdiag, Math.min(N, p))
  return rank
}
