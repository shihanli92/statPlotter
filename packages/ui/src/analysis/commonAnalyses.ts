import type { TableKind } from '@ps/model'

// Roadmap 43 (UX review F20); audit 4 (P6): apart from the analysis search, so the Analyze menu's
// quick list doesn't bring the search's explanations and guide into the start-up bundle.

/** The analyses offered first, by the kind of table analyzed, in this order. */
export const COMMON_ANALYSES: Readonly<Record<TableKind, readonly string[]>> = {
  column: ['ttest', 'oneWayAnova', 'descriptive', 'normality'],
  xy: ['linearRegression', 'nonlinearFit', 'correlation'],
  grouped: ['twoWayAnova', 'multipleT', 'rowStats'],
  contingency: ['contingency'],
  survival: ['survival'],
  partsOfWhole: ['fractionOfTotal', 'goodnessOfFit'],
  multipleVariables: ['multipleRegression', 'pca', 'logisticRegression', 'nonlinearFitMV'],
  nested: ['nestedT', 'nestedOneWay'],
}
