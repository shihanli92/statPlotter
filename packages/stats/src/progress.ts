// Roadmap 42: long computations say how far they have got. A loop over heavy steps (simulations,
// fits) reports `done` of `total` every `stride` steps through `reportProgress` (a module-level
// function, so the loop calls no closure of its own: decision 131); the caller's callback
// throttles further. Reporting reads nothing the computation writes, so results don't change.

/** Hears that `done` of `total` steps are done. */
export type ProgressFn = (done: number, total: number) => void

/** About how many operations go between two reports (about a millisecond's work). */
const WORK_PER_REPORT = 1e6

/**
 * How many steps of about `work` operations each go between two reports: a report about every
 * millisecond, so its cost (a call and a clock read) is lost in the steps' work.
 */
export function progressStride(work: number): number {
  if (work >= WORK_PER_REPORT) return 1
  // Less than an operation (or not a number): the most steps between reports.
  if (!(work >= 1)) return WORK_PER_REPORT
  return Math.floor(WORK_PER_REPORT / work)
}

/** Reports step `done` of `total` to `progress`, if any, every `stride` steps. */
export function reportProgress(
  progress: ProgressFn | undefined,
  done: number,
  total: number,
  stride: number,
): void {
  if (progress !== undefined && done % stride === 0) progress(done, total)
}
