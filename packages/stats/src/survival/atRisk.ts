import type { SurvivalSubject } from './kaplanMeier.ts'

/**
 * The number of subjects at risk at each time (roadmap 35, a Kaplan-Meier graph's number-at-risk
 * table): those whose time — of the event or of censoring — is at or after it, as R's
 * `summary(survfit(Surv(time, event) ~ 1), times, extend = TRUE)$n.risk` (oracle suite
 * `atrisk`). A subject with an event or censoring at exactly t is still at risk at t; past the
 * last time nobody is. Times may come in any order; O((n + m) log n).
 */
export function numberAtRisk(
  subjects: readonly SurvivalSubject[],
  times: readonly number[],
): number[] {
  const sorted = new Float64Array(subjects.length)
  for (let i = 0; i < subjects.length; i++) sorted[i] = subjects[i]!.time
  sorted.sort()
  const n = sorted.length
  return times.map((t) => {
    if (!Number.isFinite(t)) return t > 0 ? 0 : n
    // The first subject with time ≥ t.
    let lo = 0
    let hi = n
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (sorted[mid]! < t) lo = mid + 1
      else hi = mid
    }
    return n - lo
  })
}
