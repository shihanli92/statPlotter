// Roadmap 51a: each analysis' `cards(params)`: the method cards of the method its params choose,
// the test first, then its comparisons (design §2.1). Pure functions of params.

// biome-ignore lint/suspicious/noExplicitAny: params of every analysis, read loosely by path
type P = any

/** A multiple-comparison option value → its card. */
export const COMPARISON_CARD: Readonly<Record<string, string>> = {
  tukey: 'tukey',
  dunnett: 'dunnett',
  sidak: 'sidak',
  bonferroni: 'bonferroni',
  'holm-sidak': 'holmSidak',
  fisher: 'fisherLsd',
  bky: 'fdr',
  bh: 'fdrBh',
  by: 'fdrBy',
  'newman-keuls': 'newmanKeuls',
  'dunnett-t3': 'dunnettT3',
  'games-howell': 'gamesHowell',
  'tamhane-t2': 'tamhaneT2',
  none: 'noCorrection',
}

/** The option fields whose values are multiple-comparison methods. */
export const METHOD_FIELDS: ReadonlySet<string> = new Set([
  'allPairsMethod',
  'controlMethod',
  'welchMethod',
  'oneFactorMethod',
])

const cmp = (v: string | undefined): string[] =>
  v && COMPARISON_CARD[v] ? [COMPARISON_CARD[v]] : []

/** One-way ANOVA's test and comparisons (shared by multiple one-way ANOVAs). */
function oneWay(p: P, matched: boolean): string[] {
  const test = !p.gaussian
    ? matched
      ? 'friedman'
      : 'kruskalWallis'
    : matched
      ? 'rmOneWay'
      : p.equalSD === 'welch'
        ? 'welchAnova'
        : p.equalSD === 'brownForsythe'
          ? 'brownForsytheAnova'
          : 'oneWayAnova'
  if (p.comparisons === 'none') return [test]
  if (p.comparisons === 'trend') return [test, 'linearTrend']
  if (!p.gaussian) return [test, 'dunn']
  if (!matched && p.equalSD !== 'yes') return [test, ...cmp(p.welchMethod)]
  return [test, ...cmp(p.comparisons === 'vsControl' ? p.controlMethod : p.allPairsMethod)]
}

const survival = () => ['kaplanMeier', 'logRank', 'gehanBreslowWilcoxon']

const fit = (p: P): string[] => [
  p.fitMethod === 'robust' ? 'robustFit' : 'nonlinearFit',
  ...(p.fitMethod !== 'robust' && p.outliers !== 'none' ? ['rout'] : []),
  ...((p.compareWith && p.compareWith !== 'none') || p.compareParams?.length
    ? ['modelComparison']
    : []),
]

const rowCorrection = (p: P): string[] =>
  p.approach === 'fdr'
    ? cmp(p.fdrMethod)
    : p.approach === 'significance'
      ? cmp(p.sigMethod)
      : ['noCorrection']

export const CARDS_OF: Readonly<Record<string, (p: P) => readonly string[]>> = {
  descriptive: () => ['descriptive'],
  normality: () => ['normality'],
  oneSample: (p) => [p.test === 'wilcoxon' ? 'oneSampleWilcoxon' : 'oneSampleT'],
  ttest: (p) =>
    p.design === 'paired'
      ? [p.paired?.measure === 'ratio' ? 'ratioPairedT' : 'pairedT']
      : [p.unpaired?.assumeEqualSD ? 'studentT' : 'welchT'],
  mannWhitney: () => ['mannWhitney'],
  kolmogorovSmirnov: () => ['kolmogorovSmirnov'],
  wilcoxon: () => ['wilcoxon'],
  oneWayAnova: (p) => oneWay(p, !!p.matched),
  friedman: (p) =>
    p.comparisons === 'none'
      ? ['friedman']
      : ['friedman', p.correction === 'none' ? 'noCorrection' : 'dunn'],
  twoWayAnova: (p) => [
    p.repeated === 'none' ? 'twoWayAnova' : 'twoWayRm',
    ...(p.comparisons === 'none'
      ? []
      : cmp(p.kind === 'vsControl' ? p.controlMethod : p.allPairsMethod)),
  ],
  multipleT: (p) => [
    'multipleT',
    p.distribution === 'nonparametric'
      ? p.design === 'paired'
        ? 'wilcoxon'
        : p.rankTest === 'kolmogorovSmirnov'
          ? 'kolmogorovSmirnov'
          : 'mannWhitney'
      : p.design === 'paired'
        ? p.distribution === 'lognormal'
          ? 'ratioPairedT'
          : 'pairedT'
        : p.variance === 'welch'
          ? 'welchT'
          : 'studentT',
    ...rowCorrection(p),
  ],
  multipleOneWay: (p) => ['multipleOneWay', ...oneWay(p, false)],
  threeWayAnova: (p) => [
    'threeWayAnova',
    ...(p.comparisons === 'allCells'
      ? cmp(p.allPairsMethod)
      : p.comparisons === 'vsControl'
        ? cmp(p.controlMethod)
        : p.comparisons === 'oneFactor'
          ? cmp(p.oneFactorMethod)
          : []),
  ],
  correlation: (p) => [p.method === 'spearman' ? 'spearman' : 'pearson'],
  linearRegression: () => ['linearRegression'],
  deming: () => ['deming'],
  simpleLogistic: () => ['simpleLogistic'],
  nonlinearFit: fit,
  nonlinearFitMV: fit,
  fitSpline: (p) => [
    p.method === 'lowess'
      ? 'lowess'
      : p.method === 'smoothingSpline'
        ? 'smoothingSpline'
        : 'splineThroughPoints',
  ],
  roc: () => ['roc'],
  blandAltman: () => ['blandAltman'],
  contingency: (p) => [
    p.test === 'chiSquare' ? 'chiSquare' : 'fisherExact',
    ...(p.trend ? ['chiSquareTrend'] : []),
    ...(p.pairwise && p.pairwise !== 'none' ? cmp(p.pairwiseMethod) : []),
  ],
  goodnessOfFit: (p) =>
    p.test === 'binomial' ? ['binomialTest', 'goodnessOfFit'] : ['goodnessOfFit'],
  survival,
  survivalFromVariables: survival,
  multipleRegression: () => ['multipleRegression'],
  logisticRegression: () => ['logisticRegression'],
  poissonRegression: () => ['poissonRegression'],
  coxRegression: () => ['coxRegression'],
  multifactorAnova: (p) => [
    'multifactorAnova',
    ...(p.comparisons && p.comparisons !== 'none' ? cmp(p.method) : []),
  ],
  pca: () => ['pca'],
  pStack: (p) => ['pStack', ...rowCorrection(p)],
  rowStats: () => ['rowStats'],
  fractionOfTotal: () => ['fractionOfTotal'],
  transform: () => ['transform'],
  normalize: () => ['normalize'],
  removeBaseline: () => ['removeBaseline'],
  frequencyDistribution: () => ['frequencyDistribution'],
  transpose: () => ['transpose'],
  prune: () => ['prune'],
  areaUnderCurve: () => ['areaUnderCurve'],
  identifyOutliers: (p) => [p.method === 'rout' ? 'rout' : 'grubbs'],
  filterRows: () => ['filterRows'],
  aggregate: () => ['aggregate'],
  percentages: () => ['percentages'],
  survivalTime: () => ['survivalTime'],
  nestedT: () => ['nestedT'],
  nestedOneWay: (p) => [
    'nestedOneWay',
    ...(p.comparisons === 'none'
      ? []
      : cmp(p.comparisons === 'vsControl' ? p.controlMethod : p.allPairsMethod)),
  ],
  powerAnalysis: () => ['power'],
  simulateXY: () => ['simulateXY'],
  simulateColumn: () => ['simulateColumn'],
  simulateContingency: () => ['simulateContingency'],
  monteCarlo: () => ['monteCarlo'],
}
