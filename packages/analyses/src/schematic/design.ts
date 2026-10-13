import type { SchematicComparisons, SchematicDesign } from '@ps/model'
import { equationMeta } from '../explain/equations.ts'

// Roadmap 51f: what an analysis' params say about the question it asks ("What will be tested"):
// the measure compared, how, matched or not, the family's correction, a one-tailed direction.
// Read from the params alone (the raw params of a Guide me recommendation, or the dialog's
// parsed ones), with the schemas' defaults where a key is absent. Never a result, never the data.

type P = Readonly<Record<string, unknown>>

const str = (p: P, k: string, d = ''): string => (typeof p[k] === 'string' ? (p[k] as string) : d)
const bool = (p: P, k: string, d: boolean): boolean =>
  typeof p[k] === 'boolean' ? (p[k] as boolean) : d
const obj = (p: P, k: string): P => (p[k] && typeof p[k] === 'object' ? (p[k] as P) : ({} as P))

/** A one-tailed test's stated direction (51c: `tails: 'one'` with `predicted`). */
function tailsOf(p: P): Pick<SchematicDesign, 'direction'> {
  const predicted = str(p, 'predicted')
  return str(p, 'tails', 'two') === 'one' && (predicted === 'increase' || predicted === 'decrease')
    ? { direction: predicted }
    : {}
}

/** A comparison method in words, for the family's note. */
export const CORRECTION_WORDS: Readonly<Record<string, string>> = {
  tukey: 'Tukey',
  dunnett: 'Dunnett',
  sidak: 'Šidák',
  bonferroni: 'Bonferroni',
  'holm-sidak': 'Holm-Šidák',
  holm: 'Holm',
  fisher: 'none (Fisher’s LSD)',
  none: 'none',
  bky: 'the false discovery rate',
  bh: 'the false discovery rate',
  by: 'the false discovery rate',
  'newman-keuls': 'Newman-Keuls',
  'games-howell': 'Games-Howell',
  'dunnett-t3': 'Dunnett’s T3',
  'tamhane-t2': 'Tamhane’s T2',
}

const words = (method: string) => CORRECTION_WORDS[method] ?? method

/** A one-way analysis' comparisons and their correction. */
function oneWayComparisons(p: P, gaussian: boolean, welch: boolean): SchematicDesign {
  const comparisons = str(p, 'comparisons', 'allPairs') as SchematicComparisons
  const control = str(p, 'control')
  const correction =
    comparisons === 'allPairs' || comparisons === 'vsControl'
      ? !gaussian
        ? `Dunn’s test, ${words(str(p, 'dunnMethod', 'holm'))}`
        : welch
          ? words(str(p, 'welchMethod', 'dunnett-t3'))
          : comparisons === 'allPairs'
            ? words(str(p, 'allPairsMethod', 'tukey'))
            : words(str(p, 'controlMethod', 'dunnett'))
      : undefined
  return {
    comparisons,
    ...(comparisons === 'vsControl' && control ? { control } : {}),
    ...(correction ? { correction } : {}),
  }
}

/** "LogEC50" → "log EC50" (a parameter's name, never its value). */
export const parameterWords = (name: string) => name.replace(/^Log(?=[A-Z])/, 'log ')

/** A model's shape in its boxes, from its metadata's words. */
function curveOf(equation: string): SchematicDesign['curve'] {
  const meta = equationMeta(equation)
  const shape = `${equation} ${meta?.shape ?? ''}`.toLowerCase()
  if (/gauss|lorentz|peak/.test(shape)) return 'peak'
  if (/line|polynomial|straight/.test(shape) && !/sigmoid/.test(shape)) return 'line'
  if (/inhibit|decay|dissociat|fall|declin|decreas/.test(shape)) return 'down'
  return 'up'
}

/** The parameters a model fits, in words ("Bottom, Top, log EC50 and HillSlope"). */
function parametersOf(equation: string): string | undefined {
  const meta = equationMeta(equation)
  if (!meta) return undefined
  const names = Object.keys(meta.params).map(parameterWords)
  if (!names.length) return undefined
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

/** How a family of rows' P values is corrected (multiple t tests and one-way ANOVAs). */
function familyWords(p: P): string {
  const approach = str(p, 'approach', 'fdr')
  if (approach === 'none') return 'none'
  if (approach === 'significance')
    return `${words(str(p, 'sigMethod', 'holm-sidak'))} (the chance of any false positive)`
  return `the false discovery rate (Q = ${typeof p.q === 'number' ? p.q : 5}%)`
}

const groups = (d: SchematicDesign): SchematicDesign => ({ layout: 'groups', ...d })

/** Design for each analysis Guide me can recommend (absent: nothing to draw). */
const DESIGNS: Readonly<Record<string, (p: P) => SchematicDesign>> = {
  ttest: (p) =>
    str(p, 'design', 'unpaired') === 'paired'
      ? groups({
          comparisons: 'pair',
          matched: 'yes',
          measure:
            str(obj(p, 'paired'), 'measure', 'difference') === 'ratio' ? 'ratio' : 'difference',
          ...tailsOf(p),
        })
      : groups({
          comparisons: 'pair',
          matched: 'no',
          measure: 'mean',
          scatter: bool(obj(p, 'unpaired'), 'assumeEqualSD', false) ? 'pooled' : 'own',
          ...tailsOf(p),
        }),
  mannWhitney: (p) =>
    groups({ comparisons: 'pair', matched: 'no', measure: 'ranks', ...tailsOf(p) }),
  wilcoxon: (p) =>
    groups({ comparisons: 'pair', matched: 'yes', measure: 'signedRanks', ...tailsOf(p) }),
  kolmogorovSmirnov: () => groups({ comparisons: 'pair', matched: 'no', measure: 'distribution' }),
  oneSample: (p) =>
    groups({
      comparisons: 'vsValue',
      measure: str(p, 'test', 't') === 'wilcoxon' ? 'signedRanks' : 'mean',
      hypothetical: typeof p.hypothetical === 'number' ? p.hypothetical : 0,
      ...tailsOf(p),
    }),
  oneWayAnova: (p) => {
    const matched = bool(p, 'matched', false)
    const gaussian = bool(p, 'gaussian', true)
    const welch = gaussian && !matched && str(p, 'equalSD', 'yes') !== 'yes'
    return groups({
      matched: matched ? 'yes' : 'no',
      measure: gaussian ? 'mean' : 'ranks',
      ...(gaussian && !matched ? { scatter: welch ? 'own' : 'pooled' } : {}),
      ...oneWayComparisons(p, gaussian, welch),
    })
  },
  friedman: (p) =>
    groups({ matched: 'yes', measure: 'ranks', ...oneWayComparisons(p, false, false) }),
  nestedT: (p) =>
    groups({ nested: true, measure: 'mean', comparisons: 'pair', matched: 'no', ...tailsOf(p) }),
  nestedOneWay: (p) =>
    groups({ nested: true, measure: 'mean', matched: 'no', ...oneWayComparisons(p, true, false) }),
  twoWayAnova: (p) => {
    const comparisons = str(p, 'comparisons', 'withinRows') as SchematicComparisons
    const kind = str(p, 'kind', 'allPairs') === 'vsControl' ? 'vsControl' : 'allPairs'
    const repeated = str(p, 'repeated', 'none')
    const method =
      kind === 'vsControl' && comparisons !== 'allCells'
        ? str(p, 'controlMethod', 'dunnett')
        : str(p, 'allPairsMethod', 'sidak')
    return {
      layout: 'grid',
      measure: 'mean',
      matched: repeated === 'none' ? 'no' : (repeated as 'rows' | 'columns' | 'both'),
      comparisons,
      kind,
      ...(comparisons === 'none' ? {} : { correction: words(method) }),
      ...(comparisons !== 'none' && str(p, 'family', 'perBlock') === 'all'
        ? { notes: ['All comparisons form one family.'] }
        : {}),
    }
  },
  threeWayAnova: () => ({ layout: 'grid', measure: 'mean', comparisons: 'none' }),
  multipleT: (p) => {
    const distribution = str(p, 'distribution', 'gaussian')
    return {
      layout: 'grid',
      comparisons: 'perRow',
      matched: str(p, 'design', 'unpaired') === 'paired' ? 'columns' : 'no',
      measure:
        distribution === 'lognormal'
          ? 'logMean'
          : distribution === 'nonparametric'
            ? 'ranks'
            : 'mean',
      correction: familyWords(p),
    }
  },
  multipleOneWay: (p) => {
    const within = str(p, 'comparisons', 'allPairs')
    return {
      layout: 'grid',
      comparisons: 'perRow',
      matched: 'no',
      measure: bool(p, 'gaussian', true) ? 'mean' : 'ranks',
      ...(within === 'allPairs' || within === 'vsControl' ? { kind: within } : {}),
      correction: familyWords(p),
    }
  },
  correlation: (p) => ({
    layout: 'pair',
    measure: 'association',
    comparisons: 'together',
    ...tailsOf(p),
    notes: [
      str(p, 'method', 'pearson') === 'spearman'
        ? 'A steady rise or fall, by ranks (Spearman).'
        : 'A straight-line association (Pearson).',
    ],
  }),
  blandAltman: () => ({ layout: 'pair', measure: 'agreement', comparisons: 'together' }),
  deming: () => ({ layout: 'xy', measure: 'agreement', comparisons: 'together' }),
  roc: (p) => {
    const d = str(p, 'direction', 'unset')
    return {
      layout: 'pair',
      measure: 'separation',
      comparisons: 'pair',
      ...(d === 'higher'
        ? { direction: 'increase' }
        : d === 'lower'
          ? { direction: 'decrease' }
          : {}),
    }
  },
  linearRegression: (p) =>
    bool(p, 'interpolate', false)
      ? { layout: 'standard', measure: 'interpolate', comparisons: 'none', curve: 'line' }
      : groups({
          measure: 'slope',
          curve: 'line',
          parameter: 'slope',
          comparisons: bool(p, 'compare', true) ? 'shared' : 'vsValue',
          hypothetical: 0,
        }),
  simpleLogistic: () => ({ layout: 'xy', measure: 'probability', comparisons: 'predict' }),
  nonlinearFit: (p) => {
    const equation = str(p, 'equation')
    const curve = equation ? curveOf(equation) : undefined
    if (bool(p, 'interpolate', false))
      return {
        layout: 'standard',
        measure: 'interpolate',
        comparisons: 'none',
        curve: curve ?? 'up',
      }
    const compared = Array.isArray(p.compareParams) ? (p.compareParams as string[]) : []
    const by = str(p, 'compareBy', 'fTest')
    const parameters = equation ? parametersOf(equation) : undefined
    return compared.length
      ? groups({
          measure: 'parameter',
          parameter: compared.map(parameterWords).join(' and '),
          comparisons: 'shared',
          ...(curve ? { curve } : {}),
          decideBy: by === 'aicc' ? 'AICc' : 'the extra sum-of-squares F test',
        })
      : groups({
          measure: 'curve',
          comparisons: 'none',
          ...(curve ? { curve } : {}),
          ...(parameters ? { parameter: parameters } : {}),
        })
  },
  contingency: (p) => {
    const pairwise = str(p, 'pairwise', 'none')
    const diagnostic = bool(p, 'diagnostic', false)
    const risk = bool(p, 'riskEstimates', true)
    const odds = bool(p, 'oddsRatio', true)
    return {
      layout: 'rows',
      measure: diagnostic
        ? 'diagnostic'
        : risk && !odds
          ? 'risk'
          : odds && !risk
            ? 'odds'
            : 'proportion',
      comparisons: diagnostic
        ? 'none'
        : bool(p, 'trend', false)
          ? 'trend'
          : pairwise === 'all'
            ? 'allPairs'
            : pairwise === 'control'
              ? 'vsControl'
              : 'none',
      ...(pairwise === 'control' ? { control: str(p, 'pairwiseControl', '0') } : {}),
      ...(pairwise !== 'none' ? { correction: words(str(p, 'pairwiseMethod', 'bonferroni')) } : {}),
      exposedRow: typeof p.exposedRow === 'number' ? p.exposedRow : 0,
      outcomeColumn: typeof p.outcomeColumn === 'number' ? p.outcomeColumn : 0,
      ...tailsOf(p),
    }
  },
  survival: (p) => survivalDesign(p, false),
  survivalFromVariables: (p) => survivalDesign(p, true),
  descriptive: () => groups({ measure: 'summary', comparisons: 'none' }),
  rowStats: () => ({ layout: 'grid', measure: 'summary', comparisons: 'none' }),
  normality: () => groups({ measure: 'shape', comparisons: 'none' }),
  identifyOutliers: () => groups({ measure: 'outliers', comparisons: 'none' }),
  goodnessOfFit: () => ({ layout: 'rows', measure: 'counts', comparisons: 'shared' }),
  fractionOfTotal: () => ({ layout: 'rows', measure: 'fraction', comparisons: 'none' }),
  areaUnderCurve: () => groups({ measure: 'area', comparisons: 'none' }),
  fitSpline: () => groups({ measure: 'smooth', comparisons: 'none' }),
  multipleRegression: (p) => predict(p, 'The outcome’s mean, by multiple regression.'),
  logisticRegression: (p) => predict(p, 'The odds of “yes”, by logistic regression.'),
  poissonRegression: (p) => predict(p, 'The rate of the counted event, by Poisson regression.'),
  coxRegression: (p) => ({
    layout: 'predict',
    measure: 'predict',
    comparisons: 'predict',
    ...(str(p, 'event') ? { outcome: str(p, 'event') } : {}),
    notes: ['The hazard of the event, by Cox regression.'],
  }),
  multifactorAnova: (p) => predict(p, 'Each factor and their interactions, by multifactor ANOVA.'),
  pca: () => ({ layout: 'predict', measure: 'components', comparisons: 'predict' }),
  nonlinearFitMV: () => ({ layout: 'predict', measure: 'curve', comparisons: 'predict' }),
  powerAnalysis: () => ({ layout: 'none', measure: 'plan' }),
}

function predict(p: P, note: string): SchematicDesign {
  return {
    layout: 'predict',
    measure: 'predict',
    comparisons: 'predict',
    ...(str(p, 'y') ? { outcome: str(p, 'y') } : {}),
    notes: [note],
  }
}

function survivalDesign(p: P, variables: boolean): SchematicDesign {
  const pairwise = str(p, 'pairwise', 'none')
  const test = str(p, 'test', 'logRank')
  return {
    layout: variables ? 'predict' : 'groups',
    measure: 'survival',
    comparisons: bool(p, 'trend', false)
      ? 'trend'
      : pairwise === 'all'
        ? 'allPairs'
        : pairwise === 'control'
          ? 'vsControl'
          : 'none',
    ...(str(p, 'control') ? { control: str(p, 'control') } : {}),
    ...(pairwise !== 'none' ? { correction: words(str(p, 'pairwiseMethod', 'holm')) } : {}),
    notes: [
      test === 'gehanBreslowWilcoxon'
        ? 'Gehan-Breslow-Wilcoxon test: early differences weigh more.'
        : test === 'all'
          ? 'Every test reported (work saved before 0.3.9).'
          : 'Log-rank test: the whole follow-up counts alike.',
    ],
  }
}

/** What an analysis' params say about its question; null when it draws no schematic. */
export function designOfParams(analysisId: string, params: P): SchematicDesign | null {
  const f = DESIGNS[analysisId]
  return f ? f(params) : null
}

/** The analyses with a schematic. */
export const SCHEMATIC_ANALYSES: readonly string[] = Object.keys(DESIGNS)

/** `b` over `a`: its fields win; notes add up (once each). */
export function mergeDesign(a: SchematicDesign, b: SchematicDesign): SchematicDesign {
  const notes = [...(a.notes ?? []), ...(b.notes ?? [])]
  const out: SchematicDesign = { ...a, ...b }
  if (notes.length) out.notes = [...new Set(notes)]
  return out
}
