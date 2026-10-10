import { lgamma } from '../special/gamma.ts'

/**
 * ANOVA effect sizes for one source of variation (Prism Statistics Guide, "Understanding ANOVA
 * effect sizes"; ω² as Olejnik & Algina 2003, Table 2, between-subjects designs):
 *
 * - η² = SS_effect / SS_total (corrected total)
 * - partial η² = SS_effect / (SS_effect + SS_error)
 * - partial ω² = df_effect·(MS_effect − MS_error) / (df_effect·MS_effect + (N − df_effect)·MS_error);
 *   for one-way ANOVA this is ω² = (SS_between − df_between·MS_within) / (SS_total + MS_within).
 *   It can be negative (reported as computed).
 * - Cohen's f = √(partial η² / (1 − partial η²))
 *
 * With repeated measures, SS_error is the error term the effect is tested against; ω² is only
 * defined here for between-subjects designs (NaN when `n` is omitted).
 */
export interface EffectSizes {
  etaSquared: number
  partialEtaSquared: number
  partialOmegaSquared: number
  cohensF: number
}

export function effectSizes(
  effect: { ss: number; df: number },
  error: { ss: number; df: number },
  ssTotal: number,
  n?: number,
): EffectSizes {
  const pe = effect.ss / (effect.ss + error.ss)
  const msE = effect.ss / effect.df
  const msErr = error.ss / error.df
  const omega =
    n === undefined
      ? Number.NaN
      : (effect.df * (msE - msErr)) / (effect.df * msE + (n - effect.df) * msErr)
  return {
    etaSquared: effect.ss / ssTotal,
    partialEtaSquared: pe,
    partialOmegaSquared: omega,
    cohensF: Math.sqrt(pe / (1 - pe)),
  }
}

/**
 * Standardized difference of two group means (Prism 11 reports these with t tests):
 * - Cohen's d = (mean_B − mean_A) / s_pooled, s_pooled² = ((n_A − 1)s_A² + (n_B − 1)s_B²)/(n_A + n_B − 2)
 * - Hedges' g = d · J(df), J(df) = Γ(df/2) / (√(df/2)·Γ((df − 1)/2)) with df = n_A + n_B − 2
 *   (the exact small-sample correction, Hedges 1981)
 * - Glass's Δ = (mean_B − mean_A) / s_A (the first data set taken as the control)
 * Paired designs: d_z = mean difference / SD of the differences, g_z = d_z·J(n − 1).
 */
export interface StandardizedDifference {
  cohensD: number
  hedgesG: number
  glassDelta?: number
}

/** Hedges' exact bias-correction factor J(df). */
export function hedgesJ(df: number): number {
  if (!(df > 0)) return Number.NaN
  return Math.exp(lgamma(df / 2) - lgamma((df - 1) / 2)) / Math.sqrt(df / 2)
}

export function cohensD(
  a: { mean: number; sd: number; n: number },
  b: { mean: number; sd: number; n: number },
  diff = b.mean - a.mean,
): StandardizedDifference {
  const df = a.n + b.n - 2
  const sp = Math.sqrt(((a.n - 1) * a.sd * a.sd + (b.n - 1) * b.sd * b.sd) / df)
  const d = diff / sp
  return { cohensD: d, hedgesG: d * hedgesJ(df), glassDelta: diff / a.sd }
}

export function cohensDz(meanDiff: number, sdDiff: number, n: number): StandardizedDifference {
  const d = meanDiff / sdDiff
  return { cohensD: d, hedgesG: d * hedgesJ(n - 1) }
}
