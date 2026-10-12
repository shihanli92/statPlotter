import { entriesFor, GUIDE_ENTRIES, methodCard, NEEDS_LINE, registry } from '@ps/analyses'
import type { AnalysisDef, FormField, GuideEntry, TableKind } from '@ps/model'
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
// Roadmap 51a (U2): each analysis is listed once; the Common ones under Common only.
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
      keywords: analysisWords(def),
      enabled: true,
    }))
    const words = query.trim().split(/\s+/)
    const found = rankPalette(entries, query).filter((e) =>
      words.every((w) => paletteScore(e, w) > 1),
    )
    return [{ title: null, defs: found.map((e) => e.def) }]
  }
  const pinned = common.length && common.length < defs.length ? common : []
  const rest = defs.filter((d) => !pinned.includes(d))
  const categories = [...new Set(rest.map((d) => d.category))]
  return [
    ...(pinned.length ? [{ title: COMMON_TITLE, defs: pinned }] : []),
    ...categories.map((c) => ({ title: c, defs: rest.filter((d) => d.category === c) })),
  ]
}

// ---- Search by question, across table kinds (roadmap 51a, U3; design §3.6) -------------------

/** The method cards' names an analysis offers (its default and every option's method). */
function cardNames(def: AnalysisDef): string[] {
  const ids = new Set<string>()
  try {
    for (const id of def.cards?.(def.params.parse({})) ?? []) ids.add(id)
  } catch {}
  for (const f of def.form as readonly FormField[])
    if (f.kind === 'select' || f.kind === 'radio')
      for (const o of f.options) if (o.explain?.method) ids.add(o.explain.method)
  return [...ids].flatMap((id) => {
    const c = methodCard(id)
    return c ? [c.name, c.shortName] : []
  })
}

/** Words an analysis is found by: its keywords and its methods' names. */
const analysisWords = (def: AnalysisDef) => [
  ...(ANALYSIS_KEYWORDS[def.id] ?? []),
  ...cardNames(def),
]

/** Every query word matches the entry's label, keywords or section. */
const matchesAll = (e: Parameters<typeof paletteScore>[0], query: string) =>
  query
    .trim()
    .split(/\s+/)
    .every((w) => paletteScore(e, w) > 1)

/** An analysis or a question another table kind answers, with what it needs. */
export interface ElsewhereMatch {
  id: string
  label: string
  needs: TableKind
  line: string
  /** The question, when the match is one (else an analysis). */
  entry?: GuideEntry
  def?: AnalysisDef
}

export interface SearchResults {
  /** The questions of this table's kind (open the chooser there). */
  questions: GuideEntry[]
  /** The analyses offered for this table, best first. */
  here: AnalysisDef[]
  /** Questions and analyses of other table kinds (greyed, with what they need). */
  elsewhere: ElsewhereMatch[]
}

/**
 * The dialog's search (design §3.6): the chooser's questions and their keywords, the analyses of
 * this table (titles, keywords, methods' names) and, greyed, what other table kinds answer.
 * Words match in any order and by their start ("surv", "dose resp").
 */
export function searchAnalyses(
  offered: readonly AnalysisDef[],
  kind: TableKind,
  query: string,
): SearchResults {
  if (!query.trim()) return { questions: [], here: [], elsewhere: [] }
  const entryOf = (e: GuideEntry) => ({
    id: e.id,
    label: e.question,
    section: 'Question',
    keywords: e.keywords,
    enabled: true,
    entry: e,
  })
  const questions = rankPalette(entriesFor(kind).map(entryOf), query)
    .filter((e) => matchesAll(e, query))
    .map((e) => e.entry)
  const here = [...(analysisGroups(offered, kind, query)[0]?.defs ?? [])]
  const otherDefs = registry
    .list()
    .filter((d) => !d.accepts.includes(kind) && d.inputs.min > 0)
    .map((def) => ({
      id: def.id,
      label: def.title,
      section: def.category,
      keywords: analysisWords(def),
      enabled: true,
      def,
    }))
  const otherQuestions = GUIDE_ENTRIES.filter((e) => !e.kinds.includes(kind)).map(entryOf)
  const elsewhere: ElsewhereMatch[] = [
    ...rankPalette(otherQuestions, query)
      .filter((e) => matchesAll(e, query))
      .map((e) => ({
        id: `q:${e.id}`,
        label: e.label,
        needs: e.entry.kinds[0]!,
        line: NEEDS_LINE[e.entry.kinds[0]!],
        entry: e.entry,
      })),
    ...rankPalette(otherDefs, query)
      .filter((e) => matchesAll(e, query))
      .map((e) => ({
        id: `a:${e.id}`,
        label: e.label,
        needs: e.def.accepts[0]!,
        line: NEEDS_LINE[e.def.accepts[0]!],
        def: e.def,
      })),
  ]
  return { questions, here, elsewhere }
}
