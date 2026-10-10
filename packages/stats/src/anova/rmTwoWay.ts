import { chiSqSf } from '../dist/chisq.ts'
import { fSf } from '../dist/f.ts'
import { maxOf } from '../regression/initialRules.ts'
import { designRow } from './coding.ts'
import type { McMethod, McRow } from './comparisons.ts'
import {
  containmentDf,
  contrastCov,
  contrastEstimate,
  fitReml,
  satterthwaiteDf,
  unitRows,
  type VcDesign,
  type VcFit,
  type VcTerm,
  waldF,
} from './mixedModel.ts'
import { type ContrastRow, contrastComparisons } from './rmCompare.ts'
import { dunnettLambdas, ggEpsilon, type RMDdf, type RMSource } from './rmOneWay.ts'

/**
 * Two-way ANOVA with repeated measures in one or both factors, and the mixed-effects model
 * Prism fits instead when values are missing.
 *
 * Data are long: y (NaN = missing), 0-based row and column levels, and a subject id per value.
 * `repeated` names the within-subject factor(s), as Prism's "Matching by which factor(s)?":
 *   'columns' — "each column represents a different time point, so matched values are spread
 *               across a row": subjects are nested in rows (row = between-subjects factor);
 *   'rows'    — "matched values are stacked into a subcolumn": subjects nested in columns;
 *   'both'    — every subject has every row × column cell.
 *
 * Complete data (every subject has all its cells) — RM ANOVA. One factor repeated (between
 * factor A with a levels and n_g subjects per level, within factor B with b levels; Maxwell &
 * Delaney 2004 ch. 12, "split-plot"; unequal n_g allowed, Prism "How Prism computes two-way
 * ANOVA"): the between stratum is the one-way ANOVA of subject means (SS_A, SS_subjects);
 * the within stratum takes orthonormal contrasts of B within each subject: SS_B tests the
 * unweighted mean of the group profiles (Type III), SS_AB the group differences in profile,
 * SS_residual the within-group scatter of the profiles (car::Anova(mlm, idata, type = 3)).
 * F: A / subjects, B / residual, A×B / residual, subjects / residual (Prism, "ANOVA table in
 * two way RM ANOVA": "for the factor that is not repeated measures, the denominator MS is
 * MSsubjects"). Both factors repeated (M&D Table 12.2): Row / (Row × Subjects), Column /
 * (Column × Subjects), Interaction / Residual; the Subjects row is tested against the residual.
 * Geisser–Greenhouse ε̂ for every within-subject effect, from its error SSP matrix
 * (tr(E)²/(df·‖E‖²_F)); with 'gg' each within effect gets pCorrected from F(ε·dfn, ε·dfd)
 * (Prism: "If you do not assume sphericity, Prism uses the Greenhouse-Geisser correction").
 *
 * Missing values, or `interaction: false` — mixed model (REML, mixedModel.ts), with the random
 * effects of Prism's SAS code (FAQ 2104: RANDOM Int A B / SUBJECT=S when both factors are
 * repeated; a random subject intercept otherwise), sum-to-zero coded fixed effects and Wald F
 * tests of the Type III hypotheses, denominator df by containment (default; SAS's default for
 * that code) or Satterthwaite (lmerTest). Containment: the between factor is contained in the
 * subject term (nested subjects); with both factors repeated, row in subject × row and column in
 * subject × column; everything else gets the residual df N − rank([X Z]). No GG correction for
 * mixed fits (Prism's ε with missing values is undocumented). The additive (main-effects) model
 * is only fitted as a mixed model.
 *
 * Invalid shapes throw (unequal array lengths, negative or non-integer levels, a duplicated
 * subject × cell, a subject in two levels of the between factor); degenerate data give NaN
 * with `error`.
 */

export interface TwoWayRMData {
  y: number[]
  row: number[]
  col: number[]
  subject: number[]
}

export type RepeatedFactor = 'rows' | 'columns' | 'both'

export type RMSourceKey =
  | 'interaction'
  | 'row'
  | 'column'
  | 'subjects'
  | 'rowSubjects'
  | 'columnSubjects'
  | 'residual'

export interface TwoWayRMSource extends RMSource {
  key: RMSourceKey
  /** Denominator df of the F test (effects only). */
  dfd?: number
  /** Geisser–Greenhouse ε̂ (within-subject effects of ANOVA fits). */
  epsilon?: number
  /** GG-corrected P (with sphericity 'gg'). */
  pCorrected?: number
}

export interface TwoWayRMOptions {
  sphericity?: 'assumed' | 'gg'
  interaction?: boolean
  ddf?: RMDdf
}

export interface TwoWayRMResult {
  kind: 'anova' | 'mixed'
  repeated: RepeatedFactor
  interaction: boolean
  /**
   * ANOVA: interaction, row, column, subjects, [rowSubjects, columnSubjects,] residual.
   * Mixed: the fixed effects only (ss and ms NaN, df = numerator df, dfd = denominator df).
   */
  sources: TwoWayRMSource[]
  sphericity: 'assumed' | 'gg'
  ddf: RMDdf
  mixed: {
    /** subject, subjectRow, subjectColumn (both factors repeated), residual. */
    variances: Record<string, number>
    logLik: number
    nObs: number
    nSubjects: number
    /** Likelihood-ratio χ² of the random effects (df = number of variance components). */
    matching: { chi2: number; df: number; p: number }
  } | null
  /** Cell means [row][col] (least-squares means for mixed fits). */
  cellMeans: number[][]
  cellN: number[][]
  error?: 'empty-cells' | 'not-estimable' | 'no-residual-df' | 'degenerate'
}

interface Obs {
  y: number
  r: number
  c: number
  s: number
}

interface Prepared {
  R: number
  C: number
  obs: Obs[]
  nSubjects: number
  /** Between-factor level of each subject ('rows'/'columns' designs). */
  group: number[]
  shift: number
  complete: boolean
  cellN: number[][]
}

function isLevel(v: number): boolean {
  return Number.isInteger(v) && v >= 0
}

function prepare(data: TwoWayRMData, repeated: RepeatedFactor): Prepared {
  const N = data.y.length
  if (data.row.length !== N || data.col.length !== N || data.subject.length !== N) {
    throw new RangeError('twoWayRM: y, row, col and subject must have the same length')
  }
  let R = 0
  let C = 0
  const ids = new Map<number, number>()
  const seen = new Set<string>()
  for (let i = 0; i < N; i++) {
    const r = data.row[i]!
    const c = data.col[i]!
    const s = data.subject[i]!
    if (!isLevel(r) || !isLevel(c) || !isLevel(s)) {
      throw new RangeError('twoWayRM: levels and subjects must be non-negative integers')
    }
    const key = `${s},${r},${c}`
    if (seen.has(key))
      throw new RangeError(`twoWayRM: duplicate value for subject ${s}, cell ${r},${c}`)
    seen.add(key)
    R = Math.max(R, r + 1)
    C = Math.max(C, c + 1)
  }
  const obs: Obs[] = []
  let shift = Number.NaN
  for (let i = 0; i < N; i++) {
    const y = data.y[i]!
    if (Number.isNaN(y)) continue
    if (Number.isNaN(shift) && Number.isFinite(y)) shift = y
    let s = ids.get(data.subject[i]!)
    if (s === undefined) {
      s = ids.size
      ids.set(data.subject[i]!, s)
    }
    obs.push({ y, r: data.row[i]!, c: data.col[i]!, s })
  }
  if (Number.isNaN(shift)) shift = 0
  for (const o of obs) o.y -= shift
  const nSubjects = ids.size
  // Between-factor level per subject (checked over all entries, missing ones included).
  const group = new Array<number>(nSubjects).fill(-1)
  if (repeated !== 'both') {
    const byId = new Map<number, number>()
    for (let i = 0; i < N; i++) {
      const g = repeated === 'columns' ? data.row[i]! : data.col[i]!
      const prev = byId.get(data.subject[i]!)
      if (prev !== undefined && prev !== g) {
        throw new RangeError(
          `twoWayRM: subject ${data.subject[i]} appears in two ${repeated === 'columns' ? 'rows' : 'columns'}; with repeated '${repeated}' subjects are nested in the other factor`,
        )
      }
      byId.set(data.subject[i]!, g)
    }
    for (const [id, s] of ids) group[s] = byId.get(id)!
  }
  const cellN = Array.from({ length: R }, () => new Array<number>(C).fill(0))
  for (const o of obs) cellN[o.r]![o.c]!++
  const perSubject = new Array<number>(nSubjects).fill(0)
  for (const o of obs) perSubject[o.s]!++
  const need = repeated === 'both' ? R * C : repeated === 'columns' ? C : R
  const complete = nSubjects > 0 && perSubject.every((k) => k === need)
  return { R, C, obs, nSubjects, group, shift, complete, cellN }
}

function rawCellMeans(P: Prepared): number[][] {
  const s = Array.from({ length: P.R }, () => new Array<number>(P.C).fill(0))
  for (const o of P.obs) s[o.r]![o.c]! += o.y
  return s.map((row, r) =>
    row.map((v, c) => (P.cellN[r]![c]! > 0 ? P.shift + v / P.cellN[r]![c]! : Number.NaN)),
  )
}

const NaNs = { ss: Number.NaN, df: Number.NaN, ms: Number.NaN, F: Number.NaN, p: Number.NaN }

const NAMES: Record<RMSourceKey, string> = {
  interaction: 'Interaction',
  row: 'Row Factor',
  column: 'Column Factor',
  subjects: 'Subjects',
  rowSubjects: 'Row Factor x Subjects',
  columnSubjects: 'Column Factor x Subjects',
  residual: 'Residual',
}

export function twoWayRM(
  data: TwoWayRMData,
  repeated: RepeatedFactor,
  opts: TwoWayRMOptions = {},
): TwoWayRMResult {
  const sphericity = opts.sphericity ?? 'assumed'
  const interaction = opts.interaction ?? true
  const ddf = opts.ddf ?? 'containment'
  const P = prepare(data, repeated)
  if (P.complete && interaction) {
    return repeated === 'both'
      ? anovaBoth(P, sphericity, ddf)
      : anovaSplit(P, repeated, sphericity, ddf)
  }
  return mixed(P, repeated, sphericity, interaction, ddf)
}

// ---- RM ANOVA, one factor repeated -------------------------------------------------------------

interface SplitStats {
  a: number
  b: number
  /** Subjects per between level. */
  ng: number[]
  /** Group mean profiles ȳ_g[w]. */
  prof: number[][]
  ms: { A: number; S: number; B: number; AB: number; E: number }
  df: { A: number; S: number; B: number; AB: number; E: number }
}

function splitStats(
  P: Prepared,
  repeated: 'rows' | 'columns',
): SplitStats & { ss: SplitStats['ms']; eps: number } {
  const a = repeated === 'columns' ? P.R : P.C
  const b = repeated === 'columns' ? P.C : P.R
  const Y = Array.from({ length: P.nSubjects }, () => new Array<number>(b).fill(0))
  for (const o of P.obs) Y[o.s]![repeated === 'columns' ? o.c : o.r] = o.y
  const ng = new Array<number>(a).fill(0)
  for (const g of P.group) ng[g]!++
  const prof = Array.from({ length: a }, () => new Array<number>(b).fill(0))
  Y.forEach((y, s) => {
    y.forEach((v, w) => {
      prof[P.group[s]!]![w]! += v
    })
  })
  prof.forEach((p, g) => {
    for (let w = 0; w < b; w++) p[w] = p[w]! / ng[g]!
  })
  const mean = (x: readonly number[]) => x.reduce((s, v) => s + v, 0) / x.length
  const used = [...Array(a).keys()].filter((g) => ng[g]! > 0)
  const N = P.nSubjects
  const subjMean = Y.map(mean)
  const grpMean = prof.map(mean)
  const grand = subjMean.reduce((s, v) => s + v, 0) / N
  let ssA = 0
  for (const g of used) ssA += b * ng[g]! * (grpMean[g]! - grand) ** 2
  let ssS = 0
  let ssE = 0
  const E = new Float64Array(b * b)
  Y.forEach((y, s) => {
    const g = P.group[s]!
    ssS += b * (subjMean[s]! - grpMean[g]!) ** 2
    const e = y.map((v, w) => v - prof[g]![w]! - subjMean[s]! + grpMean[g]!)
    for (let u = 0; u < b; u++) {
      ssE += e[u]! * e[u]!
      for (let w = 0; w < b; w++) E[u * b + w] = E[u * b + w]! + e[u]! * e[w]!
    }
  })
  // Within effects: centred profiles.
  const centre = (x: readonly number[]) => {
    const m = mean(x)
    return x.map((v) => v - m)
  }
  const unweighted = new Array<number>(b).fill(0)
  const weighted = new Array<number>(b).fill(0)
  for (const g of used) {
    for (let w = 0; w < b; w++) {
      unweighted[w] = unweighted[w]! + prof[g]![w]! / used.length
      weighted[w] = weighted[w]! + (ng[g]! * prof[g]![w]!) / N
    }
  }
  const cu = centre(unweighted)
  const cw = centre(weighted)
  let invN = 0
  for (const g of used) invN += 1 / ng[g]!
  const ssB = cu.reduce((s, v) => s + v * v, 0) / (invN / (used.length * used.length))
  let ssAB = 0
  for (const g of used) {
    const cg = centre(prof[g]!)
    for (let w = 0; w < b; w++) ssAB += ng[g]! * (cg[w]! - cw[w]!) ** 2
  }
  const aa = used.length
  const df = { A: aa - 1, S: N - aa, B: b - 1, AB: (aa - 1) * (b - 1), E: (N - aa) * (b - 1) }
  const ss = { A: ssA, S: ssS, B: ssB, AB: ssAB, E: ssE }
  const ms = {
    A: ssA / df.A,
    S: ssS / df.S,
    B: ssB / df.B,
    AB: ssAB / df.AB,
    E: ssE / df.E,
  }
  return { a, b, ng, prof, ms, df, ss, eps: ggEpsilon(E, b, b - 1) }
}

function effect(
  key: RMSourceKey,
  ss: number,
  df: number,
  msErr: number,
  dfErr: number,
  eps?: number,
  gg?: boolean,
): TwoWayRMSource {
  const ms = ss / df
  const F = ms / msErr
  const ok = df > 0 && dfErr > 0
  const out: TwoWayRMSource = {
    key,
    name: NAMES[key],
    ss,
    df,
    ms,
    F: ok ? F : Number.NaN,
    p: ok ? fSf(F, df, dfErr) : Number.NaN,
    dfd: dfErr,
  }
  if (eps !== undefined) {
    out.epsilon = eps
    if (gg) out.pCorrected = ok ? fSf(F, eps * df, eps * dfErr) : Number.NaN
  }
  return out
}

function errorRow(key: RMSourceKey, ss: number, df: number): TwoWayRMSource {
  return { key, name: NAMES[key], ss, df, ms: ss / df, F: Number.NaN, p: Number.NaN }
}

function anovaSplit(
  P: Prepared,
  repeated: 'rows' | 'columns',
  sphericity: 'assumed' | 'gg',
  ddf: RMDdf,
): TwoWayRMResult {
  const st = splitStats(P, repeated)
  const gg = sphericity === 'gg'
  const { ss, df, ms, eps } = st
  const between = effect(repeated === 'columns' ? 'row' : 'column', ss.A, df.A, ms.S, df.S)
  const within = effect(repeated === 'columns' ? 'column' : 'row', ss.B, df.B, ms.E, df.E, eps, gg)
  const inter = effect('interaction', ss.AB, df.AB, ms.E, df.E, eps, gg)
  const subjects = effect('subjects', ss.S, df.S, ms.E, df.E)
  const sources =
    repeated === 'columns'
      ? [inter, between, within, subjects, errorRow('residual', ss.E, df.E)]
      : [inter, within, between, subjects, errorRow('residual', ss.E, df.E)]
  const out: TwoWayRMResult = {
    kind: 'anova',
    repeated,
    interaction: true,
    sources,
    sphericity,
    ddf,
    mixed: null,
    cellMeans: rawCellMeans(P),
    cellN: P.cellN,
  }
  const nonEmpty = st.ng.filter((n) => n > 0).length
  if (nonEmpty < st.a || st.a < 2 || st.b < 2) out.error = 'not-estimable'
  else if (!(df.S > 0)) out.error = 'no-residual-df'
  return out
}

// ---- RM ANOVA, both factors repeated -----------------------------------------------------------

interface BothStats {
  n: number
  ss: Record<'R' | 'C' | 'RC' | 'S' | 'RS' | 'CS' | 'E', number>
  df: Record<'R' | 'C' | 'RC' | 'S' | 'RS' | 'CS' | 'E', number>
  eps: { R: number; C: number; RC: number }
}

function bothStats(P: Prepared): BothStats {
  const { R, C } = P
  const n = P.nSubjects
  const Y = Array.from({ length: n }, () =>
    Array.from({ length: R }, () => new Array<number>(C).fill(0)),
  )
  for (const o of P.obs) Y[o.s]![o.r]![o.c] = o.y
  const cell = Array.from({ length: R }, (_, r) =>
    Array.from({ length: C }, (_, c) => Y.reduce((s, y) => s + y[r]![c]!, 0) / n),
  )
  const rowM = cell.map((x) => x.reduce((s, v) => s + v, 0) / C)
  const colM = Array.from({ length: C }, (_, c) => cell.reduce((s, x) => s + x[c]!, 0) / R)
  const g = rowM.reduce((s, v) => s + v, 0) / R
  const subj = Y.map((y) => y.reduce((s, x) => s + x.reduce((t, v) => t + v, 0), 0) / (R * C))
  const sr = Y.map((y) => y.map((x) => x.reduce((s, v) => s + v, 0) / C))
  const sc = Y.map((y) => Array.from({ length: C }, (_, c) => y.reduce((s, x) => s + x[c]!, 0) / R))
  const ss = { R: 0, C: 0, RC: 0, S: 0, RS: 0, CS: 0, E: 0 }
  for (let r = 0; r < R; r++) ss.R += n * C * (rowM[r]! - g) ** 2
  for (let c = 0; c < C; c++) ss.C += n * R * (colM[c]! - g) ** 2
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) ss.RC += n * (cell[r]![c]! - rowM[r]! - colM[c]! + g) ** 2
  }
  const ER = new Float64Array(R * R)
  const EC = new Float64Array(C * C)
  const K = R * C
  const EI = new Float64Array(K * K)
  for (let s = 0; s < n; s++) {
    ss.S += K * (subj[s]! - g) ** 2
    const er = sr[s]!.map((v, r) => v - subj[s]! - rowM[r]! + g)
    const ec = sc[s]!.map((v, c) => v - subj[s]! - colM[c]! + g)
    for (let r = 0; r < R; r++) {
      ss.RS += C * er[r]! ** 2
      for (let u = 0; u < R; u++) ER[r * R + u] = ER[r * R + u]! + er[r]! * er[u]!
    }
    for (let c = 0; c < C; c++) {
      ss.CS += R * ec[c]! ** 2
      for (let u = 0; u < C; u++) EC[c * C + u] = EC[c * C + u]! + ec[c]! * ec[u]!
    }
    const e = new Float64Array(K)
    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) {
        const v =
          Y[s]![r]![c]! -
          sr[s]![r]! -
          sc[s]![c]! +
          subj[s]! -
          (cell[r]![c]! - rowM[r]! - colM[c]! + g)
        e[r * C + c] = v
        ss.E += v * v
      }
    }
    for (let a = 0; a < K; a++)
      for (let b = 0; b < K; b++) EI[a * K + b] = EI[a * K + b]! + e[a]! * e[b]!
  }
  const df = {
    R: R - 1,
    C: C - 1,
    RC: (R - 1) * (C - 1),
    S: n - 1,
    RS: (R - 1) * (n - 1),
    CS: (C - 1) * (n - 1),
    E: (R - 1) * (C - 1) * (n - 1),
  }
  return {
    n,
    ss,
    df,
    eps: {
      R: ggEpsilon(ER, R, R - 1),
      C: ggEpsilon(EC, C, C - 1),
      RC: ggEpsilon(EI, K, (R - 1) * (C - 1)),
    },
  }
}

function anovaBoth(P: Prepared, sphericity: 'assumed' | 'gg', ddf: RMDdf): TwoWayRMResult {
  const st = bothStats(P)
  const { ss, df, eps } = st
  const gg = sphericity === 'gg'
  const ms = (k: keyof BothStats['ss']) => ss[k] / df[k]
  const sources = [
    effect('interaction', ss.RC, df.RC, ms('E'), df.E, eps.RC, gg),
    effect('row', ss.R, df.R, ms('RS'), df.RS, eps.R, gg),
    effect('column', ss.C, df.C, ms('CS'), df.CS, eps.C, gg),
    effect('subjects', ss.S, df.S, ms('E'), df.E),
    errorRow('rowSubjects', ss.RS, df.RS),
    errorRow('columnSubjects', ss.CS, df.CS),
    errorRow('residual', ss.E, df.E),
  ]
  const out: TwoWayRMResult = {
    kind: 'anova',
    repeated: 'both',
    interaction: true,
    sources,
    sphericity,
    ddf,
    mixed: null,
    cellMeans: rawCellMeans(P),
    cellN: P.cellN,
  }
  if (P.R < 2 || P.C < 2) out.error = 'not-estimable'
  else if (!(df.S > 0)) out.error = 'no-residual-df'
  return out
}

// ---- Mixed model -------------------------------------------------------------------------------

interface MixedDesign {
  design: VcDesign
  /** Coefficient ranges [from, to) of the row, column and interaction blocks. */
  blocks: { row: [number, number]; col: [number, number]; inter: [number, number] | null }
  /** Design row (sum-to-zero coding) of cell (r, c). */
  x: (r: number, c: number) => number[]
  /** Random terms containing the row / column effect (containment df). */
  contains: { row: number[]; col: number[] }
  termNames: string[]
}

function buildMixed(P: Prepared, repeated: RepeatedFactor, interaction: boolean): MixedDesign {
  const { R, C } = P
  const fixed = interaction ? [[0], [1], [0, 1]] : [[0], [1]]
  const x = (r: number, c: number): number[] => designRow([r, c], [R, C], fixed)
  const p = x(0, 0).length
  const N = P.obs.length
  const X = new Float64Array(N * p)
  P.obs.forEach((o, i) => {
    X.set(x(o.r, o.c), i * p)
  })
  const block = new Int32Array(N)
  const y = new Float64Array(N)
  for (let i = 0; i < N; i++) {
    block[i] = P.obs[i]!.s
    y[i] = P.obs[i]!.y
  }
  const terms: VcTerm[] = [{ name: 'subject', level: block, nLevels: P.nSubjects }]
  const compact = (key: (o: Obs) => number): VcTerm['level'] => {
    const ids = new Map<number, number>()
    const level = new Int32Array(N)
    for (let i = 0; i < N; i++) {
      const k = key(P.obs[i]!)
      let v = ids.get(k)
      if (v === undefined) {
        v = ids.size
        ids.set(k, v)
      }
      level[i] = v
    }
    return level
  }
  if (repeated === 'both') {
    const sr = compact((o) => o.s * R + o.r)
    const sc = compact((o) => o.s * C + o.c)
    terms.push({ name: 'subjectRow', level: sr, nLevels: Math.max(0, maxOf(sr)) + 1 })
    terms.push({ name: 'subjectColumn', level: sc, nLevels: Math.max(0, maxOf(sc)) + 1 })
  }
  const contains =
    repeated === 'both'
      ? { row: [1], col: [2] }
      : repeated === 'columns'
        ? { row: [0], col: [] }
        : { row: [], col: [0] }
  return {
    design: {
      y,
      X,
      p,
      block,
      nBlocks: P.nSubjects,
      terms,
    },
    blocks: {
      row: [1, R],
      col: [R, R + C - 1],
      inter: interaction ? [R + C - 1, p] : null,
    },
    x,
    contains,
    termNames: terms.map((t) => t.name),
  }
}

function mixed(
  P: Prepared,
  repeated: RepeatedFactor,
  sphericity: 'assumed' | 'gg',
  interaction: boolean,
  ddf: RMDdf,
): TwoWayRMResult {
  const keys: RMSourceKey[] = interaction ? ['interaction', 'row', 'column'] : ['row', 'column']
  const fail = (error: TwoWayRMResult['error']): TwoWayRMResult => ({
    kind: 'mixed',
    repeated,
    interaction,
    sources: keys.map((key) => ({ key, name: NAMES[key], ...NaNs, dfd: Number.NaN })),
    sphericity,
    ddf,
    mixed: null,
    cellMeans: rawCellMeans(P),
    cellN: P.cellN,
    error,
  })
  const { R, C } = P
  if (R < 2 || C < 2) return fail('not-estimable')
  if (interaction && P.cellN.some((row) => row.some((n) => n === 0))) return fail('empty-cells')
  if (P.cellN.some((row) => row.every((n) => n === 0))) return fail('not-estimable')
  if (P.cellN[0]!.some((_, c) => P.cellN.every((row) => row[c] === 0))) return fail('not-estimable')
  const md = buildMixed(P, repeated, interaction)
  const fit = fitReml(md.design)
  if (!fit.ok) return fail(fit.reason)
  const p = md.design.p
  const test = (key: RMSourceKey, range: [number, number], contains: number[]) => {
    const w = waldF(fit, unitRows(p, ...range))
    const dfd = ddf === 'satterthwaite' ? w.dfdSatterthwaite() : containmentDf(md.design, contains)
    return {
      key,
      name: NAMES[key],
      ss: Number.NaN,
      df: w.dfn,
      ms: Number.NaN,
      F: w.F,
      p: fSf(w.F, w.dfn, dfd),
      dfd,
    }
  }
  const sources: TwoWayRMSource[] = []
  if (interaction) sources.push(test('interaction', md.blocks.inter!, []))
  sources.push(test('row', md.blocks.row, md.contains.row))
  sources.push(test('column', md.blocks.col, md.contains.col))
  const variances: Record<string, number> = {}
  md.termNames.forEach((name, t) => {
    variances[name] = fit.variances[t]!
  })
  variances.residual = fit.sigma2
  const chi2 = Math.max(0, 2 * (fit.logLik - fit.logLik0))
  const nVc = md.termNames.length
  return {
    kind: 'mixed',
    repeated,
    interaction,
    sources,
    sphericity,
    ddf,
    mixed: {
      variances,
      logLik: fit.logLik,
      nObs: fit.nObs,
      nSubjects: P.nSubjects,
      matching: { chi2, df: nVc, p: chiSqSf(chi2, nVc) },
    },
    cellMeans: Array.from({ length: R }, (_, r) =>
      Array.from({ length: C }, (_, c) => P.shift + contrastEstimate(fit, md.x(r, c)).est),
    ),
    cellN: P.cellN,
  }
}

// ---- Multiple comparisons ----------------------------------------------------------------------

export interface TwoWayRMComparisonSpec {
  /**
   * withinRows: compare columns within each row (simple effects); withinColumns: rows within
   * each column; mainRows / mainColumns: least-squares marginal means.
   */
  family: 'withinRows' | 'withinColumns' | 'mainRows' | 'mainColumns'
  kind: 'allPairs' | 'vsControl'
  method: McMethod
  confLevel?: number
  alpha?: number
  /** vsControl: the control level of the compared factor (default 0). */
  control?: number
  /**
   * Simple effects: one family for all rows (columns) instead of one per row (Prism's
   * recommended default). Widens Šidák/Bonferroni/Holm/Fisher/FDR only; Tukey and Dunnett stay
   * per row (as the ordinary two-way comparisons, DATA_MODEL §11).
   */
  singleFamily?: boolean
}

export type TwoWayRMComparison = McRow & {
  rowA?: number
  rowB?: number
  colA?: number
  colB?: number
}

interface MeanDef {
  /** Row / column of the mean (−1 for a marginal mean over that factor). */
  r: number
  c: number
}

/**
 * Multiple comparisons after twoWayRM, diff = mean A − mean B (for vsControl, control − other,
 * as Prism lists "Control vs. X"). Error terms:
 * - ANOVA (complete data): "Prism always computes the multiple comparison tests using a pooled
 *   error term" (Prism, "Interpreting results: repeated measures two-way ANOVA"; M&D p. 583).
 *   With A between and B within: B-levels within an A level: SE² = 2 MS_res/n_g; B main
 *   effect: 2 MS_res (1/a²)Σ1/n_g; A-levels within a B level: (MS_subjects + (b − 1) MS_res)/b ·
 *   (1/n_g + 1/n_h) (M&D's pooled within-cell variance); A main effect: MS_subjects/b ·
 *   (1/n_g + 1/n_h). Both repeated: cells within a row: 2(MS_C×S + (R − 1) MS_res)/(R n);
 *   column main effect: 2 MS_C×S/(R n) (and symmetrically). These are the mixed model's SEs
 *   with the ANOVA (moment) variance estimates. df: with ddf 'containment' the df of the
 *   effect the comparison belongs to (cells → interaction/residual df, "(n-1)(a-1)" and
 *   "(n-1)(a-1)(b-1)" in Prism's guide; main effects → that effect's error df); with
 *   'satterthwaite' the Satterthwaite df of the combined mean square.
 *   The sphericity choice does not change comparisons (pooled error either way; Prism 8.4+
 *   disables main-effect comparisons of a repeated factor under GG — FAQ 2172 — which is left to
 *   the caller).
 * - Mixed model: model-based SEs of differences of least-squares means; df = the containment df
 *   of the corresponding effect (interaction for cells with the full model) or Satterthwaite's
 *   per comparison.
 */
export function twoWayRMComparisons(
  data: TwoWayRMData,
  res: TwoWayRMResult,
  spec: TwoWayRMComparisonSpec,
): TwoWayRMComparison[] {
  const P = prepare(data, res.repeated)
  const { R, C } = P
  const simple = spec.family === 'withinRows' || spec.family === 'withinColumns'
  const alongCols = spec.family === 'withinRows' || spec.family === 'mainColumns'
  const L = alongCols ? C : R // levels compared
  const outer = simple ? (alongCols ? R : C) : 1
  const control = spec.control ?? 0
  if (spec.kind === 'vsControl' && !(control >= 0 && control < L)) {
    throw new RangeError('twoWayRMComparisons: bad control level')
  }
  const levelPairs: [number, number][] = []
  if (spec.kind === 'vsControl') {
    for (let k = 0; k < L; k++) if (k !== control) levelPairs.push([control, k])
  } else {
    for (let a = 0; a < L; a++) for (let b = a + 1; b < L; b++) levelPairs.push([a, b])
  }
  const meanOf = (o: number, lev: number): MeanDef =>
    simple
      ? alongCols
        ? { r: o, c: lev }
        : { r: lev, c: o }
      : alongCols
        ? { r: -1, c: lev }
        : { r: lev, c: -1 }
  const est = estimator(P, res, spec.family)
  const fams: {
    rows: ContrastRow[]
    cov: (a: number, b: number) => number
    meta: [MeanDef, MeanDef][]
  }[] = []
  for (let o = 0; o < outer; o++) {
    const meta = levelPairs.map(([a, b]) => [meanOf(o, a), meanOf(o, b)] as [MeanDef, MeanDef])
    const e = est(meta)
    fams.push({ ...e, meta })
  }
  const method = spec.method
  const perFamily = !spec.singleFamily || method === 'tukey' || method === 'dunnett'
  const results: McRow[][] = []
  const opts = (
    rows: ContrastRow[],
    cov: (a: number, b: number) => number,
    familySize?: number,
  ) => ({
    method,
    confLevel: spec.confLevel,
    alpha: spec.alpha,
    nMeans: L,
    familySize,
    lambda: method === 'dunnett' ? dunnettLambdas(rows.length, cov) : undefined,
  })
  if (perFamily) {
    for (const f of fams) results.push(contrastComparisons(f.rows, opts(f.rows, f.cov)))
  } else {
    const all = fams.flatMap((f) => f.rows)
    const flat = contrastComparisons(
      all,
      opts(all, () => Number.NaN, all.length),
    )
    let k = 0
    for (const f of fams) {
      results.push(flat.slice(k, k + f.rows.length))
      k += f.rows.length
    }
  }
  const cellIndex = (m: MeanDef) => (m.r >= 0 && m.c >= 0 ? m.r * C : 0) + (m.c >= 0 ? m.c : m.r)
  return results.flatMap((rows, fi) =>
    rows.map((row, k) => {
      const [A, B] = fams[fi]!.meta[k]!
      const out: TwoWayRMComparison = { ...row, i: cellIndex(A), j: cellIndex(B) }
      if (A.r >= 0) {
        out.rowA = A.r
        out.rowB = B.r
      }
      if (A.c >= 0) {
        out.colA = A.c
        out.colB = B.c
      }
      return out
    }),
  )
}

type Estimator = (meta: [MeanDef, MeanDef][]) => {
  rows: ContrastRow[]
  cov: (a: number, b: number) => number
}

function nanEstimator(): Estimator {
  return (meta) => ({
    rows: meta.map(() => ({ i: 0, j: 0, diff: Number.NaN, se: Number.NaN, df: Number.NaN })),
    cov: () => Number.NaN,
  })
}

function estimator(
  P: Prepared,
  res: TwoWayRMResult,
  family: TwoWayRMComparisonSpec['family'],
): Estimator {
  if (res.error) return nanEstimator()
  return res.kind === 'anova' ? anovaEstimator(P, res, family) : mixedEstimator(P, res, family)
}

/**
 * ANOVA comparisons as independent means with variances V·w_k (compound symmetry), V a
 * (combined) mean square with df.
 */
function anovaEstimator(
  P: Prepared,
  res: TwoWayRMResult,
  family: TwoWayRMComparisonSpec['family'],
): Estimator {
  const { R, C } = P
  const src = (k: RMSourceKey) => res.sources.find((s) => s.key === k)!
  // Cell means of the shifted data (res.cellMeans carry the shift back).
  const cm = rawCellMeans(P).map((row) => row.map((v) => v - P.shift))
  const mean = (m: MeanDef): number => {
    if (m.r >= 0 && m.c >= 0) return cm[m.r]![m.c]!
    if (m.r >= 0) return cm[m.r]!.reduce((s, v) => s + v, 0) / C
    return cm.reduce((s, row) => s + row[m.c]!, 0) / R
  }
  const comb = (parts: [number, number, number][]): { V: number; df: number } => {
    // Σ a·MS with Satterthwaite df; parts = [coef, ms, df]
    let V = 0
    let den = 0
    for (const [a, ms, df] of parts) {
      V += a * ms
      den += (a * ms) ** 2 / df
    }
    return { V, df: (V * V) / den }
  }
  const resid = src('residual')
  let V: number
  let df: number
  let weight: (m: MeanDef) => number
  const satt = res.ddf === 'satterthwaite'
  if (res.repeated === 'both') {
    const n = P.nSubjects
    const rs = src('rowSubjects')
    const cs = src('columnSubjects')
    if (family === 'withinRows' || family === 'withinColumns') {
      const e = family === 'withinRows' ? cs : rs
      const other = family === 'withinRows' ? R : C
      const c = comb([
        [1 / other, e.ms, e.df],
        [(other - 1) / other, resid.ms, resid.df],
      ])
      V = c.V
      df = satt ? c.df : resid.df
      weight = () => 1 / n
    } else {
      const e = family === 'mainColumns' ? cs : rs
      const other = family === 'mainColumns' ? R : C
      V = e.ms / other
      df = e.df
      weight = () => 1 / n
    }
  } else {
    const betweenIsRow = res.repeated === 'columns'
    const a = betweenIsRow ? R : C
    const b = betweenIsRow ? C : R
    const ng = new Array<number>(a).fill(0)
    for (const g of P.group) ng[g]!++
    const subj = src('subjects')
    const grp = (m: MeanDef) => (betweenIsRow ? m.r : m.c)
    const withinFamily = betweenIsRow
      ? family === 'withinRows' || family === 'mainColumns'
      : family === 'withinColumns' || family === 'mainRows'
    if (withinFamily) {
      V = resid.ms
      df = resid.df
      if (family === 'withinRows' || family === 'withinColumns') weight = (m) => 1 / ng[grp(m)]!
      else {
        const inv = ng.reduce((s, n) => s + 1 / n, 0) / (a * a)
        weight = () => inv
      }
    } else if (family === 'withinRows' || family === 'withinColumns') {
      const c = comb([
        [1 / b, subj.ms, subj.df],
        [(b - 1) / b, resid.ms, resid.df],
      ])
      V = c.V
      df = satt ? c.df : resid.df
      weight = (m) => 1 / ng[grp(m)]!
    } else {
      V = subj.ms / b
      df = subj.df
      weight = (m) => 1 / ng[grp(m)]!
    }
  }
  return (meta) => {
    const w = meta.map(([A, B]) => [weight(A), weight(B)] as const)
    const key = (m: MeanDef) => `${m.r},${m.c}`
    const rows = meta.map(([A, B], k) => ({
      i: 0,
      j: 0,
      diff: mean(A) - mean(B),
      se: Math.sqrt(V * (w[k]![0] + w[k]![1])),
      df,
    }))
    const cov = (x: number, y: number) => {
      const [A1, B1] = meta[x]!
      const [A2, B2] = meta[y]!
      let s = 0
      if (key(A1) === key(A2)) s += weight(A1)
      if (key(A1) === key(B2)) s -= weight(A1)
      if (key(B1) === key(A2)) s -= weight(B1)
      if (key(B1) === key(B2)) s += weight(B1)
      return V * s
    }
    return { rows, cov }
  }
}

function mixedEstimator(
  P: Prepared,
  res: TwoWayRMResult,
  family: TwoWayRMComparisonSpec['family'],
): Estimator {
  const { R, C } = P
  const md = buildMixed(P, res.repeated, res.interaction)
  const fit = fitReml(md.design)
  if (!fit.ok) return nanEstimator()
  const f: VcFit = fit
  const p = md.design.p
  const lOf = (m: MeanDef): number[] => {
    if (m.r >= 0 && m.c >= 0) return md.x(m.r, m.c)
    const out = new Array<number>(p).fill(0)
    const K = m.r >= 0 ? C : R
    for (let k = 0; k < K; k++) {
      const x = m.r >= 0 ? md.x(m.r, k) : md.x(k, m.c)
      for (let a = 0; a < p; a++) out[a] = out[a]! + x[a]! / K
    }
    return out
  }
  const simple = family === 'withinRows' || family === 'withinColumns'
  const alongCols = family === 'withinRows' || family === 'mainColumns'
  let contDf: number
  if (simple && res.interaction) contDf = containmentDf(md.design, [])
  else contDf = containmentDf(md.design, alongCols ? md.contains.col : md.contains.row)
  return (meta) => {
    const ls = meta.map(([A, B]) => {
      const a = lOf(A)
      const b = lOf(B)
      return a.map((v, k) => v - b[k]!)
    })
    const dfs = res.ddf === 'satterthwaite' ? satterthwaiteDf(f, ls) : ls.map(() => contDf)
    const rows = ls.map((l, k) => {
      const e = contrastEstimate(f, l)
      return { i: 0, j: 0, diff: e.est, se: e.se, df: dfs[k]! }
    })
    return { rows, cov: contrastCov(f, ls) }
  }
}
