import type { AnalysisDef } from '@ps/model'
import { oneWayAnovaDef, twoWayAnovaDef } from './anova.ts'
import { contingencyDef } from './contingency.ts'
import { correlationDef } from './correlation.ts'
import { aggregateDef, filterRowsDef, percentagesDef, survivalTimeDef } from './dataManipulation.ts'
import { fractionOfTotalDef, rowStatsDef } from './dataProcessing.ts'
import { descriptive } from './descriptive.ts'
import { attachDialog, withValidate } from './dialog/index.ts'
import { attachExplanations } from './explain/index.ts'
import { aucDef, frequencyDef } from './frequency.ts'
import { GRAPH_RESULTS } from './graphResults.ts'
import { linearRegressionDef } from './linear.ts'
import { makeMonteCarloDef } from './monteCarlo.ts'
import { multifactorAnovaDef } from './multifactor.ts'
import { multipleOneWayDef } from './multipleOneWay.ts'
import { multipleTDef } from './multipleT.ts'
import { blandAltmanDef, pcaDef, rocDef } from './multivariate.ts'
import { survivalFromVariablesDef } from './mvSurvival.ts'
import { attachNames } from './naming.ts'
import { nestedOneWayDef, nestedTDef } from './nested.ts'
import { nonlinearFitDef } from './nonlinear.ts'
import { nonlinearFitMVDef } from './nonlinearMV.ts'
import { friedmanDef, kolmogorovSmirnovDef } from './nonparametric.ts'
import { normalityDef } from './normality.ts'
import { oneSampleDef } from './oneSample.ts'
import { outliersDef } from './outliers.ts'
import { goodnessOfFitDef } from './partsOfWhole.ts'
import { poissonRegressionDef } from './poisson.ts'
import { powerAnalysisDef } from './power.ts'
import { pStackDef } from './pStack.ts'
import { mannWhitney, wilcoxon } from './rank.ts'
import { coxRegressionDef, logisticRegressionDef, multipleRegressionDef } from './regression.ts'
import { simulateColumnDef, simulateContingencyDef, simulateXYDef } from './simulate.ts'
import { attachSketches } from './sketch/index.ts'
import { smoothingDef } from './smoothing.ts'
import { withSummaries } from './summary/index.ts'
import { survivalDef } from './survival.ts'
import { threeWayAnovaDef } from './threeWay.ts'
import {
  normalizeDef,
  pruneDef,
  removeBaselineDef,
  transformDef,
  transposeDef,
} from './transform.ts'
import { ttest } from './ttest.ts'
import { demingDef, simpleLogisticDef } from './xyModels.ts'

/**
 * Version of the analysis + statistics code. Part of every result-cache key: bump it whenever a
 * change could alter any numeric result, so saved results are recomputed.
 */
// 1.3.3 (audit 2): Filter rows keeps summary tables' SEM and error bounds; Transform's
// round() rounds as written in decimal; matched one-way ANOVA gives its df as values.
// 1.4.0 (audit 3, step 1B): ANOVA rounding noise is no effect (S2) and warnings for no residual
// variation and extreme magnitudes (S2, S4); scale-invariant SDs and t tests (S4); "—" for
// verdicts on undefined P and no NaN / Infinity in result text (S6); P = 0 at −log10 of the
// smallest double in multiple t tests (S5); the two-stage step-up q values (RTA-1);
// lognormal tests leave values ≤ 0 out of the row (RTA-2).
// 1.4.1 (roadmap 48b): result text only — the Deming note and the LOWESS info message no longer
// name another program; every number is unchanged.
// 1.5.0 (roadmap 51c): safer defaults (Welch, Holm for Dunn, FDR across rows and correlation
// pairs, Q = 5%, log-rank only, trend off, Shapiro-Wilk only) for new analyses, saved ones pinned
// by their params version; a one-tailed P for the predicted direction (large when the data went
// the other way); Kruskal-Wallis' exact P; Satterthwaite's df; RM main effects by per-contrast
// errors; the mixed model for matched values with gaps; new comparisons later − earlier; pairwise
// log-rank tests; result text (names, units, P < threshold, notes).
// 1.6.0 (roadmap 51d): results that explain themselves — a summary sentence in every statistical
// result, the comparisons sheet first, details marked, comparisons tables' headers, the user's
// names in labels (rows keyed for references), factor names, later − earlier for new multiple t
// tests and Bland-Altman, "Not reached" medians, NNT as a positive number for one fewer or more.
// Every number is unchanged.
// 1.6.1 (roadmap 51e): curve fits — dose-response warnings (a midpoint outside the doses,
// plateaus not reached, a midpoint the data don't determine, too few doses, what to do about an
// ambiguous fit) with their fixes; one model-comparison verdict in the values and the summary;
// nesting decided by the models' declared relatives (not the count of parameters) for fits saved
// from 0.3.9 on; profile-likelihood CIs for new fits (saved ones pinned to the asymptotic CIs).
export const ANALYSES_VERSION = '1.6.1'

export const ANALYSES: readonly AnalysisDef<unknown>[] = [
  descriptive,
  normalityDef,
  oneSampleDef,
  ttest,
  mannWhitney,
  kolmogorovSmirnovDef,
  wilcoxon,
  oneWayAnovaDef,
  friedmanDef,
  twoWayAnovaDef,
  multipleTDef,
  multipleOneWayDef,
  threeWayAnovaDef,
  correlationDef,
  linearRegressionDef,
  demingDef,
  simpleLogisticDef,
  nonlinearFitDef,
  nonlinearFitMVDef,
  smoothingDef,
  rocDef,
  blandAltmanDef,
  contingencyDef,
  goodnessOfFitDef,
  survivalDef,
  multipleRegressionDef,
  logisticRegressionDef,
  poissonRegressionDef,
  coxRegressionDef,
  multifactorAnovaDef,
  survivalFromVariablesDef,
  pcaDef,
  pStackDef,
  rowStatsDef,
  fractionOfTotalDef,
  transformDef,
  normalizeDef,
  removeBaselineDef,
  frequencyDef,
  transposeDef,
  pruneDef,
  aucDef,
  outliersDef,
  filterRowsDef,
  aggregateDef,
  percentagesDef,
  survivalTimeDef,
  nestedTDef,
  nestedOneWayDef,
  powerAnalysisDef,
  simulateXYDef,
  simulateColumnDef,
  simulateContingencyDef,
  makeMonteCarloDef((id) => byId.get(id)),
] as unknown as AnalysisDef<unknown>[]

// Roadmap 35: each analysis' ready results on graphs (curated in one place, `graphResults.ts`).
for (const d of ANALYSES) {
  const g = GRAPH_RESULTS[d.id]
  if (g) d.graphResults = g as AnalysisDef<unknown>['graphResults']
}

// Roadmap 51a: every analysis' explanations (its form's text, `cards`; `explain/`).
attachExplanations(ANALYSES)

// Roadmap 51b: the Analyze dialog's words, tiers and conditions (`dialog/rules.ts`), and `run`
// returning `validate`'s problem as its failure (one function for the dialog's checks and run).
attachDialog(ANALYSES)
withValidate(ANALYSES)
// Roadmap 51b: each analysis' live sketch (`sketch/`).
attachSketches(ANALYSES)
// Roadmap 51d: every result finished — its summary sentence first, the sheets by the question,
// details marked, the comparisons' headers (`summary/`).
withSummaries(ANALYSES)
// Roadmap 51d (U23): names that follow the method (`naming.ts`).
attachNames(ANALYSES)

const byId: Map<string, AnalysisDef<unknown>> = new Map(ANALYSES.map((d) => [d.id, d]))

export const registry = {
  engineVersion: ANALYSES_VERSION,
  get: (id: string): AnalysisDef<unknown> | undefined => byId.get(id),
  list: (): readonly AnalysisDef<unknown>[] => ANALYSES,
}

/** The user-defined equation parser (for an equation editor): parameters, or message + position. */
export { INITIAL_RULES, parseEquation } from '@ps/stats'
export {
  curveWarnings,
  TRANSFORM_LOG10_X,
  withLog10X,
  type XLooks,
  xLooks,
  xScaleChecks,
  xText,
  xValuesOf,
} from './curveAdvice.ts'
export {
  AGGREGATE_STATS,
  type AggregateStat,
  filterColumns,
  matchingRows,
  TIME_UNITS,
} from './dataManipulation.ts'
export * from './dialog/index.ts'
export {
  EQUATION_META,
  type EquationMeta,
  equationMeta,
  goalOf,
  isSpecialCase,
  MODEL_GOALS,
  type ModelGoal,
  type ModelGoalId,
  modelsNested,
  nestedRelatives,
  type ParamUnit,
  unitWords,
  type XScale,
} from './explain/equations.ts'
export {
  CARD_FAMILIES,
  CARDS_OF,
  explainedForm,
  FORM_TEXT,
  fieldText,
  METHOD_CARDS,
  methodCard,
  withNames,
} from './explain/index.ts'
export * from './guide/index.ts'
export { isMethodField, type MethodState, methodChanges } from './methodChanges.ts'
export { type MethodsInput, methodsParagraph } from './methodsText.ts'
export {
  labelOf,
  type MonteCarloParams,
  runSimulation,
  withInnerVersion,
} from './monteCarlo.ts'
export { methodNameOf } from './naming.ts'
export {
  type Constraint,
  comparisonFacts,
  EQUATIONS,
  effectiveConstraint,
  equation,
  type FitModel,
  resolveEquation,
  USER_EQUATION,
} from './nonlinear.ts'
export * from './schematic/index.ts'
export { defaultParamValue, SIMULATIONS } from './simulate.ts'
export { SKETCH_MAX_ROWS, SKETCHES, sampledRows } from './sketch/index.ts'
export { modelThumbnail, THUMBNAIL_PLOT } from './sketch/thumbnail.ts'
export { effectPlot } from './summary/effectPlot.ts'
export {
  type ComparisonRow,
  comparisonRows,
  comparisonsTable,
  familyCaption,
  SUMMARIES,
} from './summary/index.ts'
export {
  aggregateDef,
  aucDef,
  blandAltmanDef,
  contingencyDef,
  correlationDef,
  coxRegressionDef,
  demingDef,
  descriptive,
  filterRowsDef,
  fractionOfTotalDef,
  frequencyDef,
  friedmanDef,
  goodnessOfFitDef,
  kolmogorovSmirnovDef,
  linearRegressionDef,
  logisticRegressionDef,
  mannWhitney,
  multifactorAnovaDef,
  multipleOneWayDef,
  multipleRegressionDef,
  multipleTDef,
  nestedOneWayDef,
  nestedTDef,
  nonlinearFitDef,
  nonlinearFitMVDef,
  normalityDef,
  normalizeDef,
  oneSampleDef,
  oneWayAnovaDef,
  outliersDef,
  pcaDef,
  percentagesDef,
  poissonRegressionDef,
  powerAnalysisDef,
  pruneDef,
  pStackDef,
  removeBaselineDef,
  rocDef,
  rowStatsDef,
  simpleLogisticDef,
  simulateColumnDef,
  simulateContingencyDef,
  simulateXYDef,
  smoothingDef,
  survivalDef,
  survivalFromVariablesDef,
  survivalTimeDef,
  threeWayAnovaDef,
  transformDef,
  transposeDef,
  ttest,
  twoWayAnovaDef,
  wilcoxon,
}
