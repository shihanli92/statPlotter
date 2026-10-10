import type { AnalysisDef, TableKind } from '@ps/model'
import { paletteScore, rankPalette } from '../commands/index.ts'

// Roadmap 43 (UX review F20): the Analyze dialog's list opens with the analyses most asked of a
// table of its kind ("Common"), then every analysis by category; a search box filters it by
// names and the words people use for them ("anova", "kaplan meier", "ic50"), ranked as the
// command palette ranks (`rankPalette`), but each word must be in a name or a keyword (not
// letters scattered through a title: "anova" isn't "Analyze a stack of P values").

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

/**
 * Words the search matches besides an analysis' title: those of the Analyze menu's quick list
 * and the palette, and the names of the tests and methods each one offers.
 */
export const ANALYSIS_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  descriptive: ['mean', 'sd', 'sem', 'median', 'quartiles', 'summary'],
  normality: ['shapiro-wilk', 'gaussian', 'lognormal', 'anderson-darling', 'qq'],
  oneSample: ['hypothetical value', 'signed rank'],
  ttest: ['unpaired', 'paired', 'welch', 'student', 'compare two'],
  mannWhitney: ['nonparametric', 'rank sum', 'compare two'],
  kolmogorovSmirnov: ['ks', 'nonparametric', 'distributions'],
  wilcoxon: ['paired', 'nonparametric', 'signed rank'],
  oneWayAnova: ['anova', 'kruskal-wallis', 'tukey', 'dunnett', 'welch', 'brown-forsythe', 'groups'],
  friedman: ['repeated measures', 'nonparametric'],
  twoWayAnova: ['anova', 'interaction', 'sidak', 'tukey'],
  multipleT: ['t test', 'per row'],
  multipleOneWay: ['anova', 'per row'],
  threeWayAnova: ['anova'],
  correlation: ['pearson', 'spearman', 'r'],
  linearRegression: ['line', 'slope', 'least squares', 'fit'],
  deming: ['model ii', 'method comparison'],
  simpleLogistic: ['binary', 'logit'],
  nonlinearFit: ['fit', 'curve', 'dose response', 'ic50', 'ec50', 'nls', 'exponential'],
  nonlinearFitMV: ['fit', 'curve', 'dose response', 'nls'],
  fitSpline: ['smooth', 'lowess', 'loess'],
  roc: ['receiver operating', 'auc', 'sensitivity', 'specificity'],
  blandAltman: ['method comparison', 'agreement', 'bias'],
  contingency: ['chi-square', 'fisher', 'odds ratio', 'relative risk'],
  goodnessOfFit: ['chi-square', 'expected'],
  survival: ['kaplan meier', 'log-rank'],
  survivalFromVariables: ['kaplan meier', 'log-rank'],
  multipleRegression: ['regression', 'predictors'],
  logisticRegression: ['binary', 'logit'],
  poissonRegression: ['counts'],
  coxRegression: ['hazard', 'survival'],
  multifactorAnova: ['anova', 'factors'],
  pca: ['pca', 'principal components', 'loadings', 'scores'],
  frequencyDistribution: ['histogram', 'bins'],
  identifyOutliers: ['grubbs', 'rout'],
  areaUnderCurve: ['auc', 'integral'],
  nestedT: ['t test', 'hierarchical'],
  nestedOneWay: ['anova', 'hierarchical'],
  filterRows: ['subset', 'where', 'select rows', 'condition'],
  aggregate: ['summarise', 'summarize', 'group by', 'pseudobulk', 'per sample'],
  percentages: ['row %', 'column %', 'proportions'],
  powerAnalysis: ['sample size', 'power'],
  simulateXY: ['simulate', 'random', 'generate'],
  simulateColumn: ['simulate', 'random', 'generate'],
  simulateContingency: ['simulate', 'random', 'generate'],
  monteCarlo: ['simulate', 'random', 'generate'],
}

/** A group of the list: its heading and its analyses (no heading: search results). */
export interface AnalysisGroup {
  title: string | null
  defs: readonly AnalysisDef[]
}

export const COMMON_TITLE = 'Common'

/**
 * The list's groups. No query: the Common group (those of `kind` on offer, when some are and
 * not every one is), then every analysis offered by category in the order given. A query: one
 * group of the matches, best first (titles above keywords and categories; Common ones first
 * among equals).
 */
export function analysisGroups(
  defs: readonly AnalysisDef[],
  kind: TableKind,
  query: string,
): AnalysisGroup[] {
  const common = (COMMON_ANALYSES[kind] ?? []).flatMap((id) => {
    const d = defs.find((x) => x.id === id)
    return d ? [d] : []
  })
  if (query.trim()) {
    const ordered = [...common, ...defs.filter((d) => !common.includes(d))]
    const entries = ordered.map((def) => ({
      def,
      id: def.id,
      label: def.title,
      section: def.category,
      keywords: ANALYSIS_KEYWORDS[def.id],
      enabled: true,
    }))
    const words = query.trim().split(/\s+/)
    const found = rankPalette(entries, query).filter((e) =>
      words.every((w) => paletteScore(e, w) > 1),
    )
    return [{ title: null, defs: found.map((e) => e.def) }]
  }
  const categories = [...new Set(defs.map((d) => d.category))]
  return [
    ...(common.length && common.length < defs.length
      ? [{ title: COMMON_TITLE, defs: common }]
      : []),
    ...categories.map((c) => ({ title: c, defs: defs.filter((d) => d.category === c) })),
  ]
}
