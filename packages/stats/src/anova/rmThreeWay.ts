import { chiSqSf } from '../dist/chisq.ts'
import { fSf } from '../dist/f.ts'
import { symmetricInverse } from '../linalg/leastSquares.ts'
import { maxOf } from '../regression/initialRules.ts'
import { designRow, subsets, termWidth } from './coding.ts'
import {
  containmentDfSequential,
  contrastEstimate,
  fitReml,
  unitRows,
  type VcDesign,
  type VcTerm,
  waldF,
} from './mixedModel.ts'
import { ggEpsilon, type RMDdf } from './rmOneWay.ts'

/**
 * Three-way ANOVA with repeated measures (Prism's 2 × 2 × k three-way ANOVA, "Repeated measures
 * design" tab: any of the three factors can be repeated), and the mixed-effects model Prism
 * fits instead when values are missing.
 *
 * Factors: 0 = the row factor (k levels), 1 = column factor 1 (A, B vs. C, D), 2 = column
 * factor 2 (A, C vs. B, D). `repeated` lists the within-subject factors W (at least one); the
 * others B are between subjects, and every subject stays in one level of each of them.
 *
 * Complete data — RM ANOVA by the multivariate (profile) route, as car::Anova(mlm, idata,
 * idesign, type = 3) computes the univariate tests: each subject's values over the within cells
 * are transformed, for every W′ ⊆ W, by the Kronecker product of orthonormal contrasts (factors
 * in W′) and normalised averages (factors in W \ W′); the scores are regressed on the
 * sum-to-zero coded full factorial of the between factors; the Type III hypothesis of each
 * between term B′ ⊆ B gives the effect B′ ∪ W′, with SS = trace of its SSP matrix, and its
 * error is the stratum Subjects × W′ (SS = trace of the residual SSP, df = (n_subjects − #between
 * cells)·q). Subject counts may differ between the between-subject cells. Geisser–Greenhouse
 * ε̂ = tr(E)²/(q·tr(E²)) per stratum (1 for one-df strata); with 'gg' within effects get
 * pCorrected from F(ε·dfn, ε·dfd).
 *
 * Missing values (or method 'mixed') — REML mixed model (mixedModel.ts) with sum-to-zero coded
 * fixed effects (full factorial), a random intercept per subject and per subject × W′ for every
 * proper subset W′ ⊂ W (the RM ANOVA error strata; for two repeated factors this is Prism's
 * published SAS code, RANDOM Int A B / SUBJECT=S), Wald F tests of the Type III hypotheses and
 * denominator df by containment (effect E is contained in subject × (E ∩ W), or the residual when
 * E ∩ W = W; the sequential rank contribution, as SAS computes it, since the lower-order
 * subject terms lie in the span of the higher ones) or Satterthwaite. With complete data and positive variance components the F tests
 * equal the RM ANOVA's (sphericity assumed).
 */

export interface ThreeWayRMData {
  y: readonly number[]
  /** Levels per observation: [row (0..k−1), column factor 1 (0/1), column factor 2 (0/1)]. */
  row: readonly number[]
  col1: readonly number[]
  col2: readonly number[]
  subject: readonly number[]
}

export interface ThreeWayRMOptions {
  /** Which factors are repeated (0 row, 1 column factor 1, 2 column factor 2). */
  repeated: readonly number[]
  sphericity?: 'assumed' | 'gg'
  /** 'auto' (default): RM ANOVA with complete data, else the mixed model. */
  method?: 'auto' | 'anova' | 'mixed'
  ddf?: RMDdf
}

export interface ThreeWayRMSource {
  /** Factor indices of an effect (sorted), e.g. [0, 2]. */
  factors: number[]
  ss: number
  df: number
  ms: number
  F: number
  p: number
  /** Denominator df. */
  dfd: number
  /** Error stratum (within factors W′ of the effect). */
  stratum: number[]
  epsilon?: number
  pCorrected?: number
}

export interface ThreeWayRMStratum {
  /** Within factors W′ of the stratum ([] = subjects). */
  within: number[]
  ss: number
  df: number
  ms: number
  epsilon: number
}

export interface ThreeWayRMResult {
  kind: 'anova' | 'mixed'
  repeated: number[]
  /** The seven effects in the order row, col1, col2, row×col1, row×col2, col1×col2, all three. */
  effects: ThreeWayRMSource[]
  /** RM ANOVA error strata (subjects, subjects × W′…; the full W stratum is the residual). */
  strata: ThreeWayRMStratum[]
  sphericity: 'assumed' | 'gg'
  ddf: RMDdf
  mixed: {
    /** Variance per random term name ('Subject', 'Subject × Row factor' …) and 'Residual'. */
    variances: Record<string, number>
    logLik: number
    nObs: number
    nSubjects: number
    matching: { chi2: number; df: number; p: number }
  } | null
  nSubjects: number
  /** Cell means [row][col1][col2] (least-squares means for mixed fits). */
  cellMeans: number[][][]
  error?: 'empty-cells' | 'not-estimable' | 'no-residual-df' | 'degenerate' | 'incomplete'
}

const THREE_WAY_EFFECTS: readonly number[][] = [[0], [1], [2], [0, 1], [0, 2], [1, 2], [0, 1, 2]]

const NaN_ = Number.NaN

/** Orthonormal Helmert contrasts, L × (L − 1). */
function helmert(L: number): number[][] {
  const H = Array.from({ length: L }, () => new Array<number>(L - 1).fill(0))
  for (let j = 1; j < L; j++) {
    const norm = Math.sqrt(j * (j + 1))
    for (let i = 0; i < j; i++) H[i]![j - 1] = 1 / norm
    H[j]![j - 1] = -j / norm
  }
  return H
}

/** Kronecker product of matrices given as row arrays. */
function kron(a: number[][], b: number[][]): number[][] {
  const out: number[][] = []
  for (const ra of a)
    for (const rb of b) {
      const row: number[] = []
      for (const x of ra) for (const y of rb) row.push(x * y)
      out.push(row)
    }
  return out
}

interface Subject {
  id: number
  /** Levels of the three factors fixed for this subject (between factors), −1 for within. */
  between: number[]
  /** Values by within-cell index (NaN = missing). */
  values: number[]
}

export function threeWayRM(data: ThreeWayRMData, opts: ThreeWayRMOptions): ThreeWayRMResult {
  const n = data.y.length
  for (const a of [data.row, data.col1, data.col2, data.subject])
    if (a.length !== n) throw new RangeError('threeWayRM: arrays differ in length')
  const W = [...new Set(opts.repeated)].sort((a, b) => a - b)
  if (!W.length || W.some((f) => ![0, 1, 2].includes(f)))
    throw new RangeError('threeWayRM: repeated must name one to three of the factors 0, 1, 2')
  const Bt = [0, 1, 2].filter((f) => !W.includes(f))
  const k = Math.max(0, maxOf(data.row)) + 1
  const L = [k, 2, 2]
  const lv = (i: number) => [data.row[i]!, data.col1[i]!, data.col2[i]!]
  for (let i = 0; i < n; i++)
    lv(i).forEach((v, f) => {
      if (!(Number.isInteger(v) && v >= 0 && v < L[f]!))
        throw new RangeError(`threeWayRM: bad level ${v} of factor ${f}`)
    })
  const sphericity = opts.sphericity ?? 'gg'
  const ddf = opts.ddf ?? 'containment'
  const withinCells = W.reduce((s, f) => s * L[f]!, 1)
  const withinIndex = (l: number[]) => W.reduce((s, f) => s * L[f]! + l[f]!, 0)
  const betweenCells = Bt.reduce((s, f) => s * L[f]!, 1)
  const betweenIndex = (l: number[]) => Bt.reduce((s, f) => s * L[f]! + l[f]!, 0)

  // Subjects.
  const subjects = new Map<number, Subject>()
  const obs: { y: number; l: number[]; s: number }[] = []
  for (let i = 0; i < n; i++) {
    const y = data.y[i]!
    const l = lv(i)
    let s = subjects.get(data.subject[i]!)
    if (!s) {
      s = {
        id: subjects.size,
        between: [0, 1, 2].map((f) => (Bt.includes(f) ? l[f]! : -1)),
        values: new Array<number>(withinCells).fill(NaN_),
      }
      subjects.set(data.subject[i]!, s)
    }
    if (Bt.some((f) => s.between[f] !== l[f]))
      throw new RangeError('threeWayRM: a subject is in two levels of a between-subjects factor')
    const w = withinIndex(l)
    if (!Number.isNaN(s.values[w]!))
      throw new RangeError('threeWayRM: a subject has two values in one cell')
    if (!Number.isFinite(y)) continue
    s.values[w] = y
    obs.push({ y, l, s: s.id })
  }
  const subs = [...subjects.values()].filter((s) => s.values.some(Number.isFinite))
  const nS = subs.length
  const cellN: number[][][] = Array.from({ length: k }, () => [
    [0, 0],
    [0, 0],
  ])
  for (const o of obs) cellN[o.l[0]!]![o.l[1]!]![o.l[2]!]!++
  const rawMeans = (): number[][][] => {
    const s: number[][][] = Array.from({ length: k }, () => [
      [0, 0],
      [0, 0],
    ])
    for (const o of obs) s[o.l[0]!]![o.l[1]!]![o.l[2]!]! += o.y
    return s.map((r, a) => r.map((c, b) => c.map((v, d) => v / cellN[a]![b]![d]!)))
  }
  const complete = subs.every((s) => s.values.every(Number.isFinite))
  const base = {
    repeated: W,
    sphericity,
    ddf,
    nSubjects: nS,
  }
  const fail = (error: ThreeWayRMResult['error'], kind: 'anova' | 'mixed'): ThreeWayRMResult => ({
    ...base,
    kind,
    effects: THREE_WAY_EFFECTS.map((f) => ({
      factors: f,
      ss: NaN_,
      df: NaN_,
      ms: NaN_,
      F: NaN_,
      p: NaN_,
      dfd: NaN_,
      stratum: f.filter((x) => W.includes(x)),
    })),
    strata: [],
    mixed: null,
    cellMeans: rawMeans(),
    error,
  })
  if (cellN.some((r) => r.some((c) => c.some((v) => v === 0)))) return fail('empty-cells', 'anova')
  const method = opts.method ?? 'auto'
  if (method === 'anova' || (method === 'auto' && complete)) {
    if (!complete) return fail('incomplete', 'anova')
    return anova(subs, W, Bt, L, betweenCells, betweenIndex, base, rawMeans())
  }
  return mixed(obs, nS, W, L, base, rawMeans)
}

function anova(
  subs: Subject[],
  W: number[],
  Bt: number[],
  L: number[],
  betweenCells: number,
  betweenIndex: (l: number[]) => number,
  base: Pick<ThreeWayRMResult, 'repeated' | 'sphericity' | 'ddf' | 'nSubjects'>,
  cellMeans: number[][][],
): ThreeWayRMResult {
  const nS = subs.length
  const cellsUsed = new Set(subs.map((s) => betweenIndex(s.between))).size
  if (cellsUsed < betweenCells)
    return {
      ...base,
      kind: 'anova',
      effects: [],
      strata: [],
      mixed: null,
      cellMeans,
      error: 'empty-cells',
    }
  const dfE = nS - betweenCells
  // Between design: sum-to-zero full factorial of the between factors.
  const bTerms = subsets(Bt).filter((t) => t.length > 0)
  const X = subs.map((s) =>
    designRow(
      s.between.map((v) => Math.max(v, 0)),
      L,
      bTerms,
    ),
  )
  const m = X[0]!.length
  const XtX = new Float64Array(m * m)
  for (const row of X)
    for (let a = 0; a < m; a++) for (let b = 0; b < m; b++) XtX[a * m + b]! += row[a]! * row[b]!
  const XtXi = symmetricInverse(XtX, m)
  if (!XtXi || dfE <= 0)
    return {
      ...base,
      kind: 'anova',
      effects: [],
      strata: [],
      mixed: null,
      cellMeans,
      error: 'no-residual-df',
    }
  // Columns of each between term (after the intercept).
  const termCols: number[][] = [[0]]
  let col = 1
  for (const t of bTerms) {
    const w = termWidth(t, L)
    termCols.push(Array.from({ length: w }, (_, i) => col + i))
    col += w
  }
  const allB = [[], ...bTerms]
  const effects = new Map<string, ThreeWayRMSource>()
  const strata: ThreeWayRMStratum[] = []
  for (const Wp of subsets(W)) {
    // Transformation of the within cells (W in ascending order, last factor fastest).
    let P: number[][] = [[1]]
    for (const f of W) {
      const Lf = L[f]!
      const M = Wp.includes(f) ? helmert(Lf) : Array.from({ length: Lf }, () => [1 / Math.sqrt(Lf)])
      P = kron(P, M)
    }
    const q = P[0]!.length
    const Z = subs.map((s) =>
      Array.from({ length: q }, (_, c) => s.values.reduce((acc, v, w) => acc + v * P[w]![c]!, 0)),
    )
    // β = (XᵀX)⁻¹XᵀZ (m × q).
    const XtZ = Array.from({ length: m }, (_, a) =>
      Array.from({ length: q }, (_, c) =>
        subs.reduce((acc, _s, i) => acc + X[i]![a]! * Z[i]![c]!, 0),
      ),
    )
    const beta = Array.from({ length: m }, (_, a) =>
      Array.from({ length: q }, (_, c) => {
        let v = 0
        for (let b = 0; b < m; b++) v += XtXi[a * m + b]! * XtZ[b]![c]!
        return v
      }),
    )
    // Residual SSP.
    const E = new Float64Array(q * q)
    subs.forEach((_, i) => {
      const r = Array.from({ length: q }, (_, c) => {
        let fit = 0
        for (let a = 0; a < m; a++) fit += X[i]![a]! * beta[a]![c]!
        return Z[i]![c]! - fit
      })
      for (let a = 0; a < q; a++) for (let b = 0; b < q; b++) E[a * q + b]! += r[a]! * r[b]!
    })
    let trE = 0
    for (let a = 0; a < q; a++) trE += E[a * q + a]!
    const epsilon = q > 1 ? Math.min(1, ggEpsilon(E, q, q)) : 1
    const ssE = trE
    const dfErr = dfE * q
    strata.push({ within: Wp, ss: ssE, df: dfErr, ms: ssE / dfErr, epsilon })
    allB.forEach((Bp, ti) => {
      const factors = [...Bp, ...Wp].sort((a, b) => a - b)
      if (!factors.length) return
      const cols = termCols[ti]!
      const h = cols.length
      // SSP_H = (Lβ)ᵀ [L(XᵀX)⁻¹Lᵀ]⁻¹ (Lβ).
      const V = new Float64Array(h * h)
      for (let i = 0; i < h; i++)
        for (let j = 0; j < h; j++) V[i * h + j] = XtXi[cols[i]! * m + cols[j]!]!
      const Vi = symmetricInverse(V, h)
      if (!Vi) return
      let ssH = 0
      for (let c = 0; c < q; c++)
        for (let i = 0; i < h; i++)
          for (let j = 0; j < h; j++)
            ssH += beta[cols[i]!]![c]! * Vi[i * h + j]! * beta[cols[j]!]![c]!
      const df = h * q
      const ms = ssH / df
      const F = ms / (ssE / dfErr)
      const src: ThreeWayRMSource = {
        factors,
        ss: ssH,
        df,
        ms,
        F,
        p: fSf(F, df, dfErr),
        dfd: dfErr,
        stratum: Wp,
      }
      if (Wp.length) {
        src.epsilon = epsilon
        src.pCorrected = fSf(F, epsilon * df, epsilon * dfErr)
      }
      effects.set(factors.join(','), src)
    })
  }
  return {
    ...base,
    kind: 'anova',
    effects: THREE_WAY_EFFECTS.map((f) => effects.get(f.join(','))!),
    strata,
    mixed: null,
    cellMeans,
  }
}

const FACTOR = ['Row factor', 'Column factor 1', 'Column factor 2']
export const stratumName = (within: readonly number[], W: readonly number[]): string =>
  within.length === W.length && within.length > 0
    ? 'Residual'
    : ['Subject', ...within.map((f) => FACTOR[f]!)].join(' × ')

function mixed(
  obs: { y: number; l: number[]; s: number }[],
  nS: number,
  W: number[],
  L: number[],
  base: Pick<ThreeWayRMResult, 'repeated' | 'sphericity' | 'ddf' | 'nSubjects'>,
  rawMeans: () => number[][][],
): ThreeWayRMResult {
  const terms3 = THREE_WAY_EFFECTS
  const shift = obs[0]?.y ?? 0
  const rowOf = (l: number[]) => designRow(l, L, terms3)
  const p = rowOf([0, 0, 0]).length
  const N = obs.length
  const X = new Float64Array(N * p)
  obs.forEach((o, i) => {
    X.set(rowOf(o.l), i * p)
  })
  const block = new Int32Array(N)
  const y = new Float64Array(N)
  for (let i = 0; i < N; i++) {
    block[i] = obs[i]!.s
    y[i] = obs[i]!.y - shift
  }
  const randomW = subsets(W).filter((s) => s.length < W.length)
  const terms: VcTerm[] = randomW.map((Wp) => {
    const ids = new Map<string, number>()
    const level = new Int32Array(N)
    for (let i = 0; i < N; i++) {
      const o = obs[i]!
      const key = [o.s, ...Wp.map((f) => o.l[f])].join(',')
      let v = ids.get(key)
      if (v === undefined) {
        v = ids.size
        ids.set(key, v)
      }
      level[i] = v
    }
    return { name: stratumName(Wp, W), level, nLevels: ids.size }
  })
  const design: VcDesign = {
    y,
    X,
    p,
    block,
    nBlocks: nS,
    terms,
  }
  const fit = fitReml(design)
  if (!fit.ok)
    return {
      ...base,
      kind: 'mixed',
      effects: [],
      strata: [],
      mixed: null,
      cellMeans: rawMeans(),
      error: fit.reason,
    }
  // Coefficient ranges of the effects.
  let col = 1
  const effects = terms3.map((t) => {
    const w = termWidth(t, L)
    const range: [number, number] = [col, col + w]
    col += w
    const wf = waldF(fit, unitRows(p, ...range))
    const within = t.filter((f) => W.includes(f))
    const containing =
      within.length === W.length ? -1 : randomW.findIndex((s) => s.join(',') === within.join(','))
    const dfd =
      base.ddf === 'satterthwaite'
        ? wf.dfdSatterthwaite()
        : containmentDfSequential(design, containing)
    return {
      factors: [...t],
      ss: NaN_,
      df: wf.dfn,
      ms: NaN_,
      F: wf.F,
      p: fSf(wf.F, wf.dfn, dfd),
      dfd,
      stratum: within,
    }
  })
  const variances: Record<string, number> = {}
  terms.forEach((t, i) => {
    variances[t.name] = fit.variances[i]!
  })
  variances.Residual = fit.sigma2
  const chi2 = Math.max(0, 2 * (fit.logLik - fit.logLik0))
  const k = L[0]!
  return {
    ...base,
    kind: 'mixed',
    effects,
    strata: [],
    mixed: {
      variances,
      logLik: fit.logLik,
      nObs: fit.nObs,
      nSubjects: nS,
      matching: { chi2, df: terms.length, p: chiSqSf(chi2, terms.length) },
    },
    cellMeans: Array.from({ length: k }, (_, r) =>
      [0, 1].map((a) => [0, 1].map((b) => shift + contrastEstimate(fit, rowOf([r, a, b])).est)),
    ),
  }
}
