import type {
  AnalysisDef,
  AnalysisResult,
  NormalizedDataSet,
  ResultBlock,
  ResultSheet,
  RunContext,
} from '@ps/model'
import { SUMMARIES } from './families.ts'
import { ALPHA, type ComparisonRow, comparisonRows, sharedSide, type Table } from './read.ts'

// Roadmap 51d (design §8.1–§8.4, U18, U21, S23): results that explain themselves. Every analysis'
// result is finished here, after it is computed, from its own values: the summary sentence
// first, the sheet answering the question first (the comparisons when they were asked for), the
// details marked to be shown collapsed, and each comparisons table's header saying which
// comparisons form the family and what its P values and CIs refer to. No number changes; sheet
// keys, block titles and row labels stay, so references keep working.

/**
 * Blocks shown under Details (collapsed): the omnibus and assumption tables, effect sizes, the
 * data analyzed — by title, or the start of it.
 */
const DETAIL_TITLES = [
  'Data sets',
  'Data analyzed',
  'Data summary',
  'Data',
  'Scatter in each group',
  'Tests for equal SDs',
  'F test to compare variances',
  'Effect size',
  'Effect sizes',
  'ANOVA table',
  'How effective was the pairing?',
  'Ranks',
  'Random effects',
  'Intraclass correlation',
  'Do the subcolumns differ?',
  'Likelihood ratio test of the nested factor',
  'Goodness of fit',
  'Std. Error',
  'Equation',
  'Was the matching effective?',
  'Is there significant matching',
]
const isDetailTitle = (t: string | undefined) =>
  t !== undefined &&
  DETAIL_TITLES.some((d) => t === d || t.startsWith(`${d} (`) || t.startsWith(`${d},`))

/** A block marked as a detail (a note follows the block it explains). */
function markDetails(blocks: readonly ResultBlock[]): ResultBlock[] {
  let previous = false
  return blocks.map((b) => {
    if (b.type === 'summary') return b
    if (b.type === 'note') return previous ? { ...b, detail: true } : b
    previous = isDetailTitle(b.title)
    return previous ? { ...b, detail: true } : b
  })
}

/** The share of comparisons expected to be a false positive by chance in `m` independent tests. */
const anyFalsePositive = (m: number) => 1 - (1 - ALPHA) ** m

/**
 * Roadmap 51d (§8.4, S23): what a comparisons table's P values and CIs refer to — the family, the
 * method, simultaneous or not — from its title, its rows and the analysis' choices. Audit 4 S3:
 * when each row (column) is its own family the caption counts one family's comparisons and
 * never says "as one family" of them all; the control is the group every row is compared with
 * (the table's labels: "KO − WT", "WT:Drug − WT:Vehicle"), the params' only when the rows share
 * none.
 */
export function familyCaption(
  t: Table,
  params: Record<string, unknown>,
  input: readonly NormalizedDataSet[],
  factorNames?: RunContext['factorNames'],
): string | null {
  const title = t.title ?? ''
  const rows = comparisonRows(t)
  const m = rows.length || t.rows.length
  if (!m) return null
  const ciCol = t.columns.find((c) => / CI of diff/.test(c))
  const ci = (pre: string) => (ciCol ? `${pre}${ciCol.split(' ')[0]!} CIs` : `${pre}CIs`)
  const n = (k: number, word: string) => `${k} ${word}${k === 1 ? '' : 's'}`
  const qPct = typeof params.q === 'number' ? params.q : 5
  const fdr = /Benjamini|false discovery|FDR/i.test(title)
  const method = title.split(' — ')[0]!
  // Two-way and multiple one-way: each row (column) its own family unless one family was chosen.
  const within = / — within each (row|column)/.exec(title)?.[1] ?? (params.byRow ? 'row' : null)
  const perBlock =
    within !== null &&
    !(params.family === 'all' && !/^(Tukey|Dunnett|Newman)/.test(method)) &&
    !/^Uncorrected Fisher/.test(method)
  const blocks = perBlock ? new Set(rows.map((r) => r.within)).size || 1 : 1
  const per = Math.round(m / blocks)
  const control = controlOf(rows, params, input)
  // The method's sentence for the whole family (`all`) and for one of several (`each`).
  let all: string
  let each: string
  if (/^Tukey/.test(method)) {
    all = `Tukey: all ${n(m, 'pair')} as one family. P values and ${ci('')} are adjusted so that the chance of any false positive among the ${m} is 5%.`
    each = `P values and ${ci('')} are adjusted so that the chance of any false positive among a family’s ${per} is 5%.`
  } else if (/^(Dunnett’s T3|Games-Howell|Tamhane)/.test(method)) {
    const name = /^Dunnett/.test(method)
      ? 'Dunnett’s T3'
      : /^Games/.test(method)
        ? 'Games-Howell'
        : 'Tamhane’s T2'
    all = `${name}: all ${n(m, 'pair')}, without assuming equal SDs; adjusted P values and ${ci('')}.`
    each = `Without assuming equal SDs; adjusted P values and ${ci('')}.`
  } else if (/^Dunnett/.test(method)) {
    all = `Dunnett: each of ${n(m, 'group')} − ${control}, one family; adjusted P values and simultaneous ${ci('')}.`
    each = `Each group − ${control} within it; adjusted P values and simultaneous ${ci('')}.`
  } else if (/^Holm-Šidák/.test(method)) {
    all = `Holm-Šidák: adjusted P values for the ${n(m, 'comparison')}; no CIs (step-down methods have none).`
    each = 'Adjusted P values; no CIs (step-down methods have none).'
  } else if (/^(Šidák|Bonferroni)/.test(method)) {
    all = `${method.split('’')[0]}: the ${n(m, 'comparison')} as one family; adjusted P values${ciCol ? ci(' and ') : ''}.`
    each = `Adjusted P values${ciCol ? ci(' and ') : ''}.`
  } else if (/^Uncorrected Fisher/.test(method)) {
    all = `Fisher’s LSD: no adjustment; with ${n(m, 'comparison')} the chance of at least one false positive is about ${Math.round(100 * anyFalsePositive(m))}%.`
    each = all
  } else if (/^Newman-Keuls/.test(method)) {
    all = `Newman-Keuls: step-down; it doesn’t keep the chance of any false positive among the ${m} at 5%, and gives no CIs.`
    each = `Step-down; it doesn’t keep the chance of any false positive among a family’s ${per} at 5%, and gives no CIs.`
  } else if (fdr) {
    all = `q values: of the comparisons called discoveries, about ${qPct}% are expected to be false.`
    each = `Of the comparisons called discoveries, about ${qPct}% are expected to be false.`
  } else if (/^Dunn/.test(method)) {
    const how = /, (\w[\w-]*)$/.exec(method)?.[1]
    all = `Dunn’s test${how ? ` (${how})` : ''}: adjusted P values for the ${n(m, 'comparison')}, from the ranks of all groups.`
    each = 'Adjusted P values, from the ranks of all groups.'
  } else return null
  if (!perBlock) return all
  const factor = within === 'row' ? factorNames?.rows || 'row' : factorNames?.columns || 'column'
  return `Each ${factor === 'row' || factor === 'column' ? factor : `level of ${factor}`} is its own family of ${n(per, 'comparison')} (${method.split('’')[0]!.split(' ')[0]}). ${each}`
}

/**
 * The group every comparison is made against: the side all the rows share, else the params'
 * control data set, else the first.
 */
function controlOf(
  rows: readonly ComparisonRow[],
  params: Record<string, unknown>,
  input: readonly NormalizedDataSet[],
): string {
  const key = typeof params.control === 'string' ? params.control : ''
  const named = input.find((d) => d.ref.key === key)?.title
  return sharedSide(rows, named) ?? named ?? input[0]?.title ?? 'the control'
}

/** The sheets in the order of the question: the comparisons first when they were asked for. */
function ordered(sheets: readonly ResultSheet[]): ResultSheet[] {
  const i = sheets.findIndex((s) => s.key === 'comparisons')
  if (i <= 0) return [...sheets]
  return [sheets[i]!, ...sheets.slice(0, i), ...sheets.slice(i + 1)]
}

/** A result finished: summary first, sheets by the question, details marked, headers. */
export function explained(
  id: string,
  result: AnalysisResult,
  input: readonly NormalizedDataSet[],
  params: Record<string, unknown>,
  context?: RunContext,
): AnalysisResult {
  if (result.status === 'error' || !result.sheets.length) return result
  let sheets = ordered(result.sheets).map((s) => ({
    ...s,
    blocks: markDetails(s.blocks).map((b) => {
      if (s.key !== 'comparisons' || b.type !== 'table' || b.caption) return b
      const caption = familyCaption(b, params, input, context?.factorNames)
      return caption ? { ...b, caption } : b
    }),
  }))
  const summarize = SUMMARIES[id]
  let parts: ReturnType<NonNullable<typeof summarize>> = null
  try {
    parts = summarize ? summarize({ result: { ...result, sheets }, input, params, context }) : null
  } catch {
    // A sentence that can't be written is left out; the tables are the results.
    parts = null
  }
  // Kept after the first sheet's blocks (their positions unchanged); the results view and the
  // exports show it first.
  if (parts?.length) {
    const [first, ...rest] = sheets
    sheets = [{ ...first!, blocks: [...first!.blocks, { type: 'summary', parts }] }, ...rest]
  }
  return { ...result, sheets }
}

const wrapped = new WeakSet<AnalysisDef<unknown>>()

/** Makes every definition's `run` finish its result (in place, once). */
export function withSummaries(defs: readonly AnalysisDef<unknown>[]): void {
  for (const d of defs) {
    if (wrapped.has(d)) continue
    wrapped.add(d)
    const run = d.run
    d.run = (input, params, context, progress) =>
      explained(
        d.id,
        run(input, params, context, progress),
        input,
        (params ?? {}) as Record<string, unknown>,
        context,
      )
  }
}

export { SUMMARIES } from './families.ts'
export { type ComparisonRow, comparisonRows, comparisonsTable } from './read.ts'
