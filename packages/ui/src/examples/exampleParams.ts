import { type AnalysisDef, paramsWrittenFor } from '@ps/model'

/**
 * Roadmap 51c (design §6.1 item 5): the examples' analyses were written against the analyses'
 * params of 0.3.8 (version 1 of every definition): Student's t test, the tests of equal SDs,
 * one-tailed P in the observed direction, comparisons as earlier − later, Q = 1%… They keep
 * those choices, so each example still shows what it was made to show (the published examples
 * reproduce their papers, which used them); only the analyses' version and the new fields that
 * pin the old behaviour are added to their documents.
 */
export const EXAMPLE_PARAMS_VERSION = 1

/** An example's params for `def`, as written (version 1), brought up to date. */
export const exampleParams = <P>(def: AnalysisDef<P>, raw: unknown): P =>
  paramsWrittenFor(def, raw, EXAMPLE_PARAMS_VERSION)
