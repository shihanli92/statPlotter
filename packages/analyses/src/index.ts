import type { AnalysisDef } from '@ps/model'
import { oneWayAnovaDef, twoWayAnovaDef } from './anova.ts'
import { contingencyDef } from './contingency.ts'
import { correlationDef } from './correlation.ts'
import { aggregateDef, filterRowsDef, percentagesDef, survivalTimeDef } from './dataManipulation.ts'
import { fractionOfTotalDef, rowStatsDef } from './dataProcessing.ts'
import { descriptive } from './descriptive.ts'
import { aucDef, frequencyDef } from './frequency.ts'
import { GRAPH_RESULTS } from './graphResults.ts'
import { linearRegressionDef } from './linear.ts'
import { makeMonteCarloDef } from './monteCarlo.ts'
import { multifactorAnovaDef } from './multifactor.ts'
import { multipleOneWayDef } from './multipleOneWay.ts'
import { multipleTDef } from './multipleT.ts'
import { blandAltmanDef, pcaDef, rocDef } from './multivariate.ts'
import { survivalFromVariablesDef } from './mvSurvival.ts'
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
import { smoothingDef } from './smoothing.ts'
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
export const ANALYSES_VERSION = '1.4.1'

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

const byId: Map<string, AnalysisDef<unknown>> = new Map(ANALYSES.map((d) => [d.id, d]))

export const registry = {
  engineVersion: ANALYSES_VERSION,
  get: (id: string): AnalysisDef<unknown> | undefined => byId.get(id),
  list: (): readonly AnalysisDef<unknown>[] => ANALYSES,
}

/** The user-defined equation parser (for an equation editor): parameters, or message + position. */
export { INITIAL_RULES, parseEquation } from '@ps/stats'
export {
  AGGREGATE_STATS,
  type AggregateStat,
  filterColumns,
  matchingRows,
  TIME_UNITS,
} from './dataManipulation.ts'
export { labelOf, type MonteCarloParams, runSimulation } from './monteCarlo.ts'
export {
  type Constraint,
  EQUATIONS,
  effectiveConstraint,
  equation,
  type FitModel,
  resolveEquation,
  USER_EQUATION,
} from './nonlinear.ts'
export { defaultParamValue, SIMULATIONS } from './simulate.ts'
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
