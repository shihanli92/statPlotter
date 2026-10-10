import type { AnalysisDef } from '@ps/model'

// Roadmap 43 (UX review F22): when an analysis fails for want of values ("Each group needs at
// least two values."), the results say in one line what it needs, beside a Go to table link.

/** Messages about too few values, data sets, rows or points. */
const TOO_FEW =
  /\b(at least|too few|fewer than|not enough|no values|no data|need(s)? (one|two|three|\d))\b/i

/** What the analyses asked of most need, in one line each. */
const NEEDS: Readonly<Record<string, string>> = {
  descriptive: 'Descriptive statistics need at least one value in each data set analyzed.',
  normality:
    'Normality tests need at least three values in each data set; some of the tests need more.',
  oneSample: 'A one sample test needs at least two values in each data set analyzed.',
  ttest:
    'A t test compares two data sets (columns) with at least two values each; a paired test needs two complete pairs.',
  mannWhitney: 'The Mann-Whitney test compares two data sets (columns) with values in each.',
  wilcoxon: 'The Wilcoxon test compares two data sets (columns) of paired values, one row a pair.',
  oneWayAnova:
    'One-way ANOVA compares two or more data sets (columns, one per group) with at least two values each.',
  twoWayAnova:
    'Two-way ANOVA needs two or more data sets (columns) and rows, with values in each cell.',
  correlation: 'Correlation needs two data sets (or X and Y) with at least three complete pairs.',
  linearRegression:
    'Linear regression needs at least two rows with both X and Y, at two or more different X values.',
  nonlinearFit:
    'A curve fit needs more rows with both X and Y than the model has parameters to fit.',
  nonlinearFitMV: 'A curve fit needs more complete rows than the model has parameters to fit.',
  multipleRegression:
    'Multiple regression needs a Y variable, at least one predictor and more complete rows than coefficients.',
  pca: 'PCA needs at least two number variables and at least two complete rows.',
  survival: 'Survival curves need, in each data set, times (X) with an event or censored code (Y).',
  contingency: 'The test needs at least two rows and two columns of counts.',
}

/**
 * One line on what `def` needs when `message` (its error) is about too few values; null when
 * the message is about something else. Analyses without their own line get one from the number
 * of data sets they take.
 */
export function needsHint(def: AnalysisDef | undefined, message: string): string | null {
  if (!def || !TOO_FEW.test(message)) return null
  const own = NEEDS[def.id]
  if (own) return own
  const { min, max } = def.inputs
  if (min === 0) return null
  const sets =
    min === max
      ? `${min} data set${min === 1 ? '' : 's'}`
      : `${min === 1 ? 'one' : min} or more data sets`
  return `${def.title} analyzes ${sets}; check they have enough values (empty and excluded cells don’t count).`
}
