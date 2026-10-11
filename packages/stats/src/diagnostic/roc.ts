import { proportionCI } from '../contingency/proportion.ts'
import { normalQuantile, normalSf } from '../dist/normal.ts'

/**
 * Empirical ROC curve of a diagnostic test from control and patient values:
 *
 * - Thresholds: the pooled values sorted, adjacent values averaged ("each threshold value is
 *   midway between two values in the data"). Tied values are merged first, so every threshold
 *   lies strictly between two distinct values. Listed in ascending order.
 * - Direction 'higher' (patients have higher values): sensitivity = fraction of patients above
 *   the threshold, specificity = fraction of controls below it; 'lower' mirrors both. 'auto'
 *   uses 'higher' unless that gives an area below 0.5.
 * - Sensitivity / specificity CIs: Clopper–Pearson ("the Clopper method"), no multiplicity
 *   correction. Likelihood ratio = sensitivity / (1 − specificity) (+∞ when specificity is 1).
 * - Area: trapezoidal area of the whole curve from (0, 0) to (1, 1) = the Mann–Whitney
 *   probability P(patient more abnormal) + ½ P(tie).
 * - SE of the area: Hanley & McNeil (1982) with Q1 and Q2 estimated from the data (IBM SPSS's
 *   ROC algorithm "SE of the area under the ROC curve statistic, nonparametric assumption"):
 *   over the distinct values x,
 *     Q1 = Σ n₋(=x)·[n₊(>x)² + n₊(>x)·n₊(=x) + n₊(=x)²/3] / (n₋·n₊²)
 *     Q2 = Σ n₊(=x)·[n₋(<x)² + n₋(<x)·n₋(=x) + n₋(=x)²/3] / (n₋²·n₊)
 *     SE = √([A(1 − A) + (n₊ − 1)(Q1 − A²) + (n₋ − 1)(Q2 − A²)] / (n₊·n₋))
 *   (₊ patients, ₋ controls; the same for either direction, since Var(1 − A) = Var(A)).
 * - CI of the area: A ± z·SE (z of the confidence level), truncated to [0, 1].
 * - P value (H0: area = 0.5): z = (A − 0.5) / SE₀ with SE₀ = √((n₊ + n₋ + 1) / (12·n₊·n₋)),
 *   i.e. Q1 = Q2 = 1/3 (1/12 is often written 0.083333); two-tailed, normal distribution.
 */

export interface RocPoint {
  threshold: number
  sensitivity: number
  sensLower: number
  sensUpper: number
  specificity: number
  specLower: number
  specUpper: number
  /** sensitivity / (1 − specificity); +∞ at specificity 1 (NaN if sensitivity is also 0). */
  likelihoodRatio: number
}

export interface RocResult {
  /** The sensitivity / specificity table: one row per threshold, ascending thresholds. */
  points: RocPoint[]
  /**
   * The curve for plotting, as fractions: (1 − specificity, sensitivity) from (0, 0) to (1, 1)
   * with both ends included (the results table leaves them out, but the area is computed over
   * the whole curve).
   */
  curve: { x: number; y: number }[]
  auc: number
  se: number
  lower: number
  upper: number
  p: number
  /** Standard error under H0 (area 0.5), used for P. */
  se0: number
  z: number
  direction: 'higher' | 'lower'
  nControls: number
  nPatients: number
}

export interface RocOptions {
  confLevel?: number
  /** Default 'auto'. */
  direction?: 'auto' | 'higher' | 'lower'
  /** Sensitivity / specificity CIs. Default 'clopperPearson'. */
  ciMethod?: 'wilsonBrown' | 'clopperPearson'
}

/**
 * ROC analysis. Throws for non-finite values. An empty group gives NaN statistics and no points.
 */
export function rocCurve(
  controls: readonly number[],
  patients: readonly number[],
  opts: RocOptions = {},
): RocResult {
  for (const v of controls) if (!Number.isFinite(v)) throw new RangeError('roc: non-finite control')
  for (const v of patients) if (!Number.isFinite(v)) throw new RangeError('roc: non-finite patient')
  const confLevel = opts.confLevel ?? 0.95
  const ciMethod = opts.ciMethod ?? 'clopperPearson'
  const nC = controls.length
  const nP = patients.length
  if (nC === 0 || nP === 0) {
    const nan = Number.NaN
    return {
      points: [],
      curve: [],
      auc: nan,
      se: nan,
      lower: nan,
      upper: nan,
      p: nan,
      se0: nan,
      z: nan,
      direction: opts.direction === 'lower' ? 'lower' : 'higher',
      nControls: nC,
      nPatients: nP,
    }
  }

  const { values, cEq, cBelow, pAbove, area: w, se, se0 } = hanleyMcNeil(controls, patients)
  const m = values.length

  const direction: 'higher' | 'lower' =
    opts.direction === 'higher' || opts.direction === 'lower'
      ? opts.direction
      : w < 0.5
        ? 'lower'
        : 'higher'
  const auc = direction === 'higher' ? w : 1 - w
  const zc = normalQuantile((1 + confLevel) / 2)
  const lower = Math.max(0, auc - zc * se)
  const upper = Math.min(1, auc + zc * se)
  const z = (auc - 0.5) / se0
  const p = Math.min(1, 2 * normalSf(Math.abs(z)))

  const points: RocPoint[] = []
  for (let i = 0; i + 1 < m; i++) {
    const threshold = (values[i]! + values[i + 1]!) / 2
    // Controls ≤ values[i] and patients > values[i] (threshold lies between i and i + 1).
    const cLow = cBelow[i]! + cEq[i]!
    const pHigh = pAbove[i]!
    const tp = direction === 'higher' ? pHigh : nP - pHigh
    const tn = direction === 'higher' ? cLow : nC - cLow
    const sens = proportionCI(tp, nP, { confLevel, method: ciMethod })
    const spec = proportionCI(tn, nC, { confLevel, method: ciMethod })
    const fpr = 1 - spec.value
    points.push({
      threshold,
      sensitivity: sens.value,
      sensLower: sens.lower,
      sensUpper: sens.upper,
      specificity: spec.value,
      specLower: spec.lower,
      specUpper: spec.upper,
      likelihoodRatio:
        fpr === 0 ? (sens.value === 0 ? Number.NaN : Number.POSITIVE_INFINITY) : sens.value / fpr,
    })
  }

  // Curve from (0, 0): the strictest threshold first.
  const inner = points.map((pt) => ({ x: 1 - pt.specificity, y: pt.sensitivity }))
  if (direction === 'higher') inner.reverse()
  const curve = [{ x: 0, y: 0 }, ...inner, { x: 1, y: 1 }]

  return {
    points,
    curve,
    auc,
    se,
    lower,
    upper,
    p,
    se0,
    z,
    direction,
    nControls: nC,
    nPatients: nP,
  }
}

/**
 * The empirical ROC area for direction 'higher' (P(patient > control) + ½ P(tie)) with the
 * Hanley–McNeil SE and the SE at area ½ (formulas above), from non-empty groups; also the
 * distinct pooled values (ascending) with, per value, the controls equal to it and below it and
 * the patients above it.
 */
export function hanleyMcNeil(controls: readonly number[], patients: readonly number[]) {
  const nC = controls.length
  const nP = patients.length
  const values = [...new Set([...controls, ...patients])].sort((a, b) => a - b)
  const m = values.length
  const index = new Map(values.map((v, i) => [v, i]))
  const cEq = new Float64Array(m)
  const pEq = new Float64Array(m)
  for (const v of controls) cEq[index.get(v)!]!++
  for (const v of patients) pEq[index.get(v)!]!++
  // cBelow[i] = controls < values[i]; pAbove[i] = patients > values[i].
  const cBelow = new Float64Array(m)
  const pAbove = new Float64Array(m)
  for (let i = 1; i < m; i++) cBelow[i] = cBelow[i - 1]! + cEq[i - 1]!
  for (let i = m - 2; i >= 0; i--) pAbove[i] = pAbove[i + 1]! + pEq[i + 1]!

  // Exact rational arithmetic in doubles for the area: counts are integers or halves.
  let w = 0
  let q1 = 0
  let q2 = 0
  for (let i = 0; i < m; i++) {
    const c = cEq[i]!
    const a = pEq[i]!
    w += c * (pAbove[i]! + a / 2)
    q1 += c * (pAbove[i]! ** 2 + pAbove[i]! * a + (a * a) / 3)
    q2 += a * (cBelow[i]! ** 2 + cBelow[i]! * c + (c * c) / 3)
  }
  w /= nC * nP
  q1 /= nC * nP * nP
  q2 /= nC * nC * nP
  // Clamped at 0: near perfect separation rounding can take the variance below.
  const variance = (w * (1 - w) + (nP - 1) * (q1 - w * w) + (nC - 1) * (q2 - w * w)) / (nP * nC)
  return {
    values,
    cEq,
    cBelow,
    pAbove,
    area: w,
    se: Math.sqrt(Math.max(0, variance)),
    se0: Math.sqrt((nP + nC + 1) / (12 * nP * nC)),
  }
}
