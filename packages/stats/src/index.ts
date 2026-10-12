export * from './agreement/blandAltman.ts'
export {
  type DunnOptions,
  type DunnRow,
  dunnComparisons,
  type McCell,
  type McMethod,
  type McOptions,
  type McRow,
  multipleComparisons,
  type WelchMcMethod,
  type WelchMcOptions,
  welchComparisons,
} from './anova/comparisons.ts'
export * from './anova/effectSize.ts'
export {
  type FactorialInput,
  type FactorialResult,
  type FactorialSource,
  factorialAnova,
} from './anova/factorial.ts'
export {
  correctFamily,
  type FamilyMethod,
  type FamilyOptions,
  type FamilyResult,
} from './anova/family.ts'
export type { GroupData, GroupStats } from './anova/groups.ts'
export * from './anova/multifactor.ts'
export {
  type NestedResult,
  type NestedTTest,
  nestedAnova,
  nestedComparisons,
  nestedTTest,
} from './anova/nested.ts'
export {
  brownForsytheAnova,
  type FTest,
  type KruskalWallisResult,
  kruskalWallis,
  type OneWayResult,
  oneWayAnova,
  welchAnova,
} from './anova/oneway.ts'
export { adjustP, type PAdjustMethod } from './anova/padjust.ts'
export type {
  ContrastMcOptions,
  ContrastRow,
} from './anova/rmCompare.ts'
export {
  type OneWayRMOptions,
  type OneWayRMResult,
  oneWayRM,
  type RMComparisonOptions,
  type RMDdf,
  type RMSource,
  rmComparisons,
} from './anova/rmOneWay.ts'
export * from './anova/rmThreeWay.ts'
export {
  type RepeatedFactor,
  type RMSourceKey,
  type TwoWayRMComparison,
  type TwoWayRMComparisonSpec,
  type TwoWayRMData,
  type TwoWayRMOptions,
  type TwoWayRMResult,
  type TwoWayRMSource,
  twoWayRM,
  twoWayRMComparisons,
} from './anova/rmTwoWay.ts'
export { type LinearTrend, linearTrend } from './anova/trend.ts'
export {
  type TwoWayCell,
  type TwoWayOptions,
  type TwoWayResult,
  type TwoWaySource,
  type TwoWaySourceName,
  twoWayAnova,
} from './anova/twoway.ts'
export { meanAcross, valueRange } from './arrays.ts'
export * from './contingency/chiSquare.ts'
export * from './contingency/fisher.ts'
export * from './contingency/pairwise.ts'
export * from './contingency/proportion.ts'
export * from './contingency/twoByTwo.ts'
export * from './correlation/pearson.ts'
export * from './correlation/spearman.ts'
export * from './cytometry/transforms.ts'
export * from './descriptive/basic.ts'
export * from './descriptive/describe.ts'
export * from './descriptive/dotPlot.ts'
export * from './descriptive/interval.ts'
export * from './descriptive/moments.ts'
export * from './descriptive/quantile.ts'
export * from './descriptive/thresholds.ts'
export * from './diagnostic/roc.ts'
export { betaQuantile, chiSqQuantile } from './dist/betaGammaQuantile.ts'
export { binomPmf, hyperLogPmf, hyperPmf } from './dist/binomial.ts'
export * from './dist/chisq.ts'
export { dunnettP, dunnettQuantile, smmP, smmQuantile } from './dist/dunnett.ts'
export * from './dist/f.ts'
export { kolmogorovSf } from './dist/kolmogorov.ts'
export * from './dist/normal.ts'
export { permutationCorrelationP } from './dist/permutationCorrelation.ts'
export * from './dist/t.ts'
export { ptukey, qtukey } from './dist/tukey.ts'
export * from './gpl/lilliefors.ts'
export * from './gpl/lowess.ts'
export * from './gpl/noncentralT.ts'
export { pretty } from './gpl/pretty.ts'
export {
  type LeastSquaresFit,
  type LeastSquaresOptions,
  leastSquares,
  symmetricInverse,
} from './linalg/leastSquares.ts'
export * from './multivariate/cluster.ts'
export * from './multivariate/ellipse.ts'
export * from './multivariate/pca.ts'
export * from './multivariate/pcr.ts'
export * from './normality/andersonDarling.ts'
export type { NormalityTest } from './normality/common.ts'
export * from './normality/dagostino.ts'
export * from './normality/qq.ts'
export * from './normality/shapiroWilk.ts'
export * from './outliers/outliers.ts'
export * from './power/power.ts'
export * from './processing/auc.ts'
export * from './processing/frequency.ts'
export * from './progress.ts'
export * from './regression/categorical.ts'
export {
  type CoxOptions,
  type CoxResult,
  type CoxTest,
  coxRegression,
} from './regression/cox.ts'
export * from './regression/coxSurvival.ts'
export * from './regression/deming.ts'
export * from './regression/diagnostics.ts'
export type { SpecialFn } from './regression/equationFunctions.ts'
export {
  defaultFitOptions,
  EQUATIONS,
  type EquationCategory,
  type EquationDef,
  equation,
  meanOf,
  type ParamInfo,
} from './regression/equations.ts'
export {
  INITIAL_RULES,
  type InitialRule,
  initialFromRule,
  maxOf,
  minOf,
} from './regression/initialRules.ts'
export * from './regression/interpolate.ts'
export * from './regression/linear.ts'
export {
  hosmerLemeshow,
  type LogisticCoefficient,
  type LogisticOptions,
  type LogisticResult,
  logisticRegression,
} from './regression/logistic.ts'
export {
  type MultipleLinearOptions,
  type MultipleLinearResult,
  multipleLinearRegression,
  type RegCoefficient,
} from './regression/multiple.ts'
export {
  aiccLeastSquares,
  type CurveModel,
  compareFits,
  curveBand,
  type DataSetStats,
  type FitComparison,
  type FitData,
  type FitOptions,
  type FitStatus,
  modelFor,
  type NonlinearFit,
  nonlinearFit,
  type ParamConstraint,
  type ParamEstimate,
  type Weighting,
} from './regression/nonlinear.ts'
export * from './regression/nonlinearDiagnostics.ts'
export { type OdeOptions, type OdeSolution, type OdeSystem, solveOde } from './regression/ode.ts'
export {
  type PoissonCoefficient,
  type PoissonOptions,
  type PoissonResult,
  poissonRegression,
} from './regression/poisson.ts'
export * from './regression/polynomial.ts'
export * from './regression/robust.ts'
export {
  dataSetLetter,
  EquationError,
  type EquationProgram,
  type ParsedEquation,
  parseEquation,
  userCurveModel,
} from './regression/userEquation.ts'
export { Random, substream } from './simulate/random.ts'
export * from './smoothing/contour.ts'
export * from './smoothing/density.ts'
export * from './smoothing/hexbin.ts'
export * from './smoothing/kde2d.ts'
export * from './smoothing/splines.ts'
export { betaInc, betaIncComplement } from './special/beta.ts'
export * from './special/functions.ts'
export { lbeta, lgamma } from './special/gamma.ts'
export { gammaIncLower, gammaIncUpper } from './special/gammaInc.ts'
export * from './summation.ts'
export * from './survival/atRisk.ts'
export * from './survival/compare.ts'
export * from './survival/kaplanMeier.ts'
export type { Alternative } from './tests/common.ts'
export * from './tests/friedman.ts'
export * from './tests/ftest.ts'
export {
  arrangements,
  type KruskalExact,
  KW_EXACT_LIMIT,
  kruskalWallisExact,
} from './tests/kruskalExact.ts'
export * from './tests/ksTwoSample.ts'
export * from './tests/mannWhitney.ts'
export * from './tests/multipleT.ts'
export * from './tests/oneSampleT.ts'
export { midranks } from './tests/ranks.ts'
export * from './tests/ttest.ts'
export * from './tests/wilcoxon.ts'
