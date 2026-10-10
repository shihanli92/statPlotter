import { normalQuantile } from '../dist/normal.ts'
import { findQuantile } from '../gpl/survfitQuantile.ts'

/** One subject: time to the event or to censoring. */
export interface SurvivalSubject {
  time: number
  /** false = censored. */
  event: boolean
}

/**
 * Pointwise CI of the survival fraction: 'asymmetric' is Prism's recommended "log-log
 * transform" (exponential Greenwood) interval, identical to R's survfit(conf.type =
 * "log-log"); 'symmetric' is S ± z·SE truncated to [0, 1].
 */
export type SurvivalCiMethod = 'asymmetric' | 'symmetric'

export interface KaplanMeierStep {
  time: number
  /** Subjects at risk just before `time`. */
  atRisk: number
  events: number
  censored: number
  /** Survival fraction (0..1) just after `time`. */
  survival: number
  /** Greenwood standard error of `survival`. */
  se: number
  lower: number
  upper: number
}

export interface KaplanMeier {
  n: number
  events: number
  censored: number
  /** Time 0 (survival 1), then one step per distinct time (event or censoring), ascending. */
  steps: KaplanMeierStep[]
  /**
   * Median survival: the time the step curve first drops below ½ (the midpoint of the flat
   * part when it sits exactly at ½), with Brookmeyer–Crowley CI on the log-log scale (the
   * times where the log-log CI of S(t) contains ½). NaN when undefined (the curve never
   * reaches ½); upper = ∞ when the upper CI curve never reaches ½, lower NaN when the lower
   * one does not.
   */
  median: { value: number; lower: number; upper: number }
}

export interface KaplanMeierOptions {
  /** Default 0.95. */
  confLevel?: number
  /** Default 'asymmetric'. */
  ciMethod?: SurvivalCiMethod
}

/** Throws unless every subject has a finite time ≥ 0 and a boolean event flag. */
export function checkSubjects(subjects: readonly SurvivalSubject[], what: string): void {
  for (const s of subjects) {
    if (!(Number.isFinite(s.time) && s.time >= 0)) {
      throw new Error(`${what}: times must be finite and ≥ 0, got ${s.time}`)
    }
    if (typeof s.event !== 'boolean') throw new Error(`${what}: event must be a boolean`)
  }
}

/**
 * Kaplan–Meier product-limit estimate with Greenwood standard errors (Prism's survival
 * analysis). At a time with both events and censorings the events come first (the censored
 * subjects count as at risk), as in Prism and R.
 *
 * Conventions where the formulas are undefined: while S = 1 the SE is 0 and the CI is [1, 1];
 * once S = 0 the SE is reported as 0 and the CI as [0, 0] (R's survfit gives NaN / NA
 * there). For the median CI, S = 0 points are ignored as in R (the log-log CI is undefined).
 * An empty group gives n = 0, no steps and a NaN median.
 */
export function kaplanMeier(
  subjects: readonly SurvivalSubject[],
  opts: KaplanMeierOptions = {},
): KaplanMeier {
  checkSubjects(subjects, 'kaplanMeier')
  const conf = opts.confLevel ?? 0.95
  const method = opts.ciMethod ?? 'asymmetric'
  const z = normalQuantile(1 - (1 - conf) / 2)
  const n = subjects.length
  const sorted = [...subjects].sort((a, b) => a.time - b.time)
  const events = sorted.reduce((s, x) => s + (x.event ? 1 : 0), 0)
  const nan = { value: Number.NaN, lower: Number.NaN, upper: Number.NaN }
  if (n === 0) return { n, events: 0, censored: 0, steps: [], median: nan }

  const steps: KaplanMeierStep[] = [
    { time: 0, atRisk: n, events: 0, censored: 0, survival: 1, se: 0, lower: 1, upper: 1 },
  ]
  // Log-log limits for the median CI (NaN where undefined, as survfit).
  const llLower: number[] = [Number.NaN]
  const llUpper: number[] = [Number.NaN]
  let S = 1
  let gw = 0 // Greenwood sum Σ d / (n (n − d))
  let i = 0
  while (i < n) {
    const t = sorted[i]!.time
    const atRisk = n - i
    let d = 0
    let c = 0
    while (i < n && sorted[i]!.time === t) {
      if (sorted[i]!.event) d++
      else c++
      i++
    }
    if (d > 0) {
      S *= 1 - d / atRisk
      gw += d < atRisk ? d / (atRisk * (atRisk - d)) : Number.POSITIVE_INFINITY
      if (d === atRisk) S = 0
    }
    const sigma = Math.sqrt(gw) // SE of ln S
    const se = S === 0 ? 0 : S * sigma
    let ll: [number, number] = [Number.NaN, Number.NaN]
    if (S > 0 && S < 1) {
      const k = (z * sigma) / Math.log(S)
      const lls = Math.log(-Math.log(S))
      ll = [Math.exp(-Math.exp(lls - k)), Math.exp(-Math.exp(lls + k))]
    }
    let lower: number
    let upper: number
    if (S === 0 || S === 1) {
      lower = S
      upper = S
    } else if (method === 'symmetric') {
      lower = Math.max(0, S - z * se)
      upper = Math.min(1, S + z * se)
    } else {
      ;[lower, upper] = ll
    }
    steps.push({ time: t, atRisk, events: d, censored: c, survival: S, se, lower, upper })
    llLower.push(ll[0])
    llUpper.push(ll[1])
  }

  const x = steps.map((s) => s.time)
  const value = findQuantile(
    x,
    steps.map((s) => 1 - s.survival),
    0.5,
  )
  const lower = findQuantile(
    x,
    llLower.map((v, k) => (k === 0 ? 0 : 1 - v)),
    0.5,
  )
  const upper = findQuantile(
    x,
    llUpper.map((v, k) => (k === 0 ? 0 : 1 - v)),
    0.5,
  )
  return {
    n,
    events,
    censored: n - events,
    steps,
    median: { value, lower, upper: Number.isNaN(upper) ? Number.POSITIVE_INFINITY : upper },
  }
}
