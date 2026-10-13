import type { AnalysisDef, MethodNames } from '@ps/model'
import { METHOD_SHORT } from './anovaCommon.ts'

// Roadmap 51d (design §8.6, U23): an analysis' automatic name follows its method and groups —
// "Welch’s t test: Treated vs Control", "One-way ANOVA + Tukey: Dose response", "Kruskal-Wallis +
// Dunn: Cell area", "Two-way RM ANOVA: Genotype × Time". A node made with one carries
// `autoName: true` and is renamed when its method or groups change, until the user renames it.

type P = Record<string, unknown>
type Name = (p: P, n: MethodNames) => string

/**
 * The groups compared, "Treated vs Control", with the table's name after them ("(Day 1)") so the
 * copies Duplicate family and Apply make (which put the new table's name in place of the old's)
 * keep names of their own.
 */
const inTable = (groups: string, n: MethodNames) => (n.table ? `${groups} (${n.table})` : groups)
const vs = (n: MethodNames) => {
  const [a, b] = n.dataSets
  return a && b ? inTable(`${b} vs ${a}`, n) : (a ?? n.table)
}
const sub = (p: unknown, key: string): unknown =>
  p && typeof p === 'object' ? (p as P)[key] : undefined

const tTest: Name = (p, n) => {
  const method =
    p.design === 'paired'
      ? sub(p.paired, 'measure') === 'ratio'
        ? 'Ratio paired t test'
        : 'Paired t test'
      : sub(p.unpaired, 'assumeEqualSD') === true
        ? 'Student’s t test'
        : 'Welch’s t test'
  return `${method}: ${vs(n)}`
}

/** "+ Tukey", "+ Dunnett", "+ Dunn" — the comparisons a one-factor analysis makes. */
function oneFactorComparisons(p: P, gaussian: boolean, matched: boolean): string {
  if (p.comparisons === 'none' || p.comparisons === undefined) return ''
  if (p.comparisons === 'trend') return ' + trend'
  if (!gaussian) return ' + Dunn'
  const welch = !matched && (p.equalSD === 'welch' || p.equalSD === 'brownForsythe')
  const method = welch
    ? p.welchMethod
    : p.comparisons === 'vsControl'
      ? p.controlMethod
      : p.allPairsMethod
  const short = typeof method === 'string' ? (METHOD_SHORT[method] ?? method) : ''
  return short ? ` + ${short.replace(/, uncorrected$/, '')}` : ''
}

const oneWay: Name = (p, n) => {
  const gaussian = p.gaussian !== false
  const matched = p.matched === true
  const test = !gaussian
    ? matched
      ? 'Friedman'
      : 'Kruskal-Wallis'
    : matched
      ? 'RM one-way ANOVA'
      : p.equalSD === 'welch'
        ? 'Welch ANOVA'
        : p.equalSD === 'brownForsythe'
          ? 'Brown-Forsythe ANOVA'
          : 'One-way ANOVA'
  return `${test}${oneFactorComparisons(p, gaussian, matched)}: ${n.table}`
}

const factors = (n: MethodNames) =>
  n.factors?.rows && n.factors?.columns ? `${n.factors.columns} × ${n.factors.rows}` : n.table

const twoWay: Name = (p, n) =>
  `Two-way ${p.repeated && p.repeated !== 'none' ? 'RM ' : ''}ANOVA: ${factors(n)}`

const NAMES: Readonly<Record<string, Name>> = {
  ttest: tTest,
  mannWhitney: (_p, n) => `Mann-Whitney test: ${vs(n)}`,
  wilcoxon: (_p, n) => `Wilcoxon matched-pairs test: ${vs(n)}`,
  kolmogorovSmirnov: (_p, n) => `Kolmogorov-Smirnov test: ${vs(n)}`,
  oneSample: (p, n) =>
    `${p.test === 'wilcoxon' ? 'One-sample Wilcoxon test' : 'One-sample t test'}: ${
      n.dataSets.length === 1 ? inTable(n.dataSets[0]!, n) : n.table
    }`,
  oneWayAnova: oneWay,
  friedman: (p, n) => `Friedman${p.comparisons === 'none' ? '' : ' + Dunn'}: ${n.table}`,
  twoWayAnova: twoWay,
  threeWayAnova: (_p, n) => `Three-way ANOVA: ${n.table}`,
  nestedT: (_p, n) => `Nested t test: ${vs(n)}`,
  nestedOneWay: (_p, n) => `Nested one-way ANOVA: ${n.table}`,
  multipleT: (p, n) =>
    `${p.distribution === 'nonparametric' ? 'Multiple rank tests' : 'Multiple t tests'}: ${vs(n)}`,
  multipleOneWay: (_p, n) => `Multiple one-way ANOVAs: ${n.table}`,
  correlation: (p, n) =>
    `${p.method === 'spearman' ? 'Spearman' : 'Pearson'} correlation: ${
      n.dataSets.length === 2 ? inTable(`${n.dataSets[0]} and ${n.dataSets[1]}`, n) : n.table
    }`,
  contingency: (p, n) =>
    `${p.test === 'chiSquare' ? 'Chi-square test' : 'Fisher’s exact test'}: ${n.table}`,
  survival: (p, n) =>
    `Survival (${p.test === 'gehanBreslowWilcoxon' ? 'Gehan-Breslow-Wilcoxon' : 'log-rank'}): ${n.table}`,
  blandAltman: (p, n) => {
    const [a, b] = n.dataSets
    return `Bland-Altman: ${a && b ? inTable(p.order === 'aMinusB' ? `${a} vs ${b}` : `${b} vs ${a}`, n) : n.table}`
  },
}

/** The automatic name of an analysis: by its method, else "{title} of {table}" (as before). */
export function methodNameOf(def: AnalysisDef<unknown>, params: unknown, n: MethodNames): string {
  const own = def.methodName?.(params, n)
  if (own) return own
  return `${def.title} of ${n.table}`
}

/** Attaches every analysis' method name (in place). */
export function attachNames(defs: readonly AnalysisDef<unknown>[]): void {
  for (const d of defs) {
    const name = NAMES[d.id]
    if (name) d.methodName = (params, n) => name((params ?? {}) as P, n)
  }
}
