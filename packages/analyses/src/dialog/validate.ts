import type { AnalysisDef } from '@ps/model'
import { failure } from '../common.ts'

// Roadmap 51b (design §4.6): each analysis' early failures (counts and shapes) are found by one
// function, `validate`, which the dialog shows as a block before Analyze and `run` returns as its
// failure — the two can't disagree.

const wrapped = new WeakSet<AnalysisDef<unknown>>()

/**
 * Makes every definition's `run` call its `validate` first (in place, once: the registry's
 * definitions are the ones every package uses), returning the problem as the failure with the
 * notes that come before it.
 */
export function withValidate(defs: readonly AnalysisDef<unknown>[]): void {
  for (const d of defs) {
    if (!d.validate || wrapped.has(d)) continue
    wrapped.add(d)
    const run = d.run
    const validate = d.validate
    d.run = (input, params, context, progress) => {
      const problem = validate(input, params, context)
      return problem
        ? failure(problem.message, problem.diagnostics ?? [])
        : run(input, params, context, progress)
    }
  }
}
