import type { AnalysisDef, NormalizedDataSet, SketchContext, SketchSpec } from '@ps/model'
import { contingencySketch, survivalSketch } from './counts.ts'
import { factorialSketch, manyRowsSketch, nestedSketch, oneWaySketch } from './groups.ts'
import {
  blandAltmanSketch,
  ksSketch,
  mannWhitneySketch,
  oneSampleSketch,
  rocSketch,
  tTestSketch,
  wilcoxonSketch,
} from './twoGroups.ts'
import { variablesSketch } from './variables.ts'
import { correlationSketch, curveSketch, lineSketch, logisticSketch } from './xy.ts'

// Roadmap 51b (design §5): each analysis' live sketch — what it will look at, as data (a
// transient table, a native preset, brackets and lines) that `@ps/graph` draws without knowing
// analyses. The branching on the method is here, where it belongs; drawing never branches on it.
// Sketches read the normalized input and params only: never `run`, never a test (an import
// boundary test checks `sketch/`).

type Sketch = (
  input: readonly NormalizedDataSet[],
  params: Record<string, unknown>,
  ctx: SketchContext,
) => SketchSpec | null

const variables =
  (id: string): Sketch =>
  (input, params, ctx) =>
    variablesSketch(id, input, params, ctx)

/** The sketch of each analysis (absent: none — tools and simulations draw no sketch). */
export const SKETCHES: Readonly<Record<string, Sketch>> = {
  ttest: tTestSketch,
  mannWhitney: mannWhitneySketch,
  wilcoxon: wilcoxonSketch,
  kolmogorovSmirnov: ksSketch,
  oneSample: oneSampleSketch,
  roc: rocSketch,
  blandAltman: blandAltmanSketch,
  oneWayAnova: (i, p, c) => oneWaySketch(i, p, c),
  friedman: (i, p, c) => oneWaySketch(i, p, c, true),
  nestedT: nestedSketch,
  nestedOneWay: nestedSketch,
  twoWayAnova: (i, p, c) => factorialSketch(i, p, c),
  threeWayAnova: (i, p, c) => factorialSketch(i, p, c, true),
  multipleT: (i, p, c) => manyRowsSketch(i, p, c, 't tests'),
  multipleOneWay: (i, p, c) => manyRowsSketch(i, p, c, 'one-way ANOVAs'),
  correlation: correlationSketch,
  linearRegression: (i, p, c) => lineSketch(i, p, c),
  deming: (i, p, c) => lineSketch(i, p, c, true),
  simpleLogistic: logisticSketch,
  nonlinearFit: curveSketch,
  contingency: contingencySketch,
  survival: survivalSketch,
  multipleRegression: variables('multipleRegression'),
  logisticRegression: variables('logisticRegression'),
  poissonRegression: variables('poissonRegression'),
  coxRegression: variables('coxRegression'),
  multifactorAnova: variables('multifactorAnova'),
  survivalFromVariables: variables('survivalFromVariables'),
  nonlinearFitMV: variables('nonlinearFitMV'),
  pca: variables('pca'),
}

/** Attaches every analysis' sketch (in place, as the explanations are). */
export function attachSketches(defs: readonly AnalysisDef<unknown>[]): void {
  for (const d of defs) {
    const s = SKETCHES[d.id]
    if (s) d.sketch = s as AnalysisDef<unknown>['sketch']
  }
}

export { SKETCH_MAX_ROWS, sampledRows } from './tables.ts'
