import {
  type AnalysisResult,
  axisUnit,
  type NormalizedDataSet,
  type ResultBlock,
  type ResultValue,
  type RunContext,
  type SummaryPart,
} from '@ps/model'

// Roadmap 51d (design §8.2): reading an analysis' own result for its summary sentence — values,
// rows by key or label, tables by title — and the pieces a sentence is made of. Nothing here
// computes a statistic: the numbers are the result's.

/** What a summary is written from. */
export interface SummaryInput {
  result: AnalysisResult
  input: readonly NormalizedDataSet[]
  params: Record<string, unknown>
  context?: RunContext
}

export type KV = Extract<ResultBlock, { type: 'keyValue' }>
export type Table = Extract<ResultBlock, { type: 'table' }>

export const ALPHA = 0.05

/** Every block of every sheet (or of one sheet). */
export function blocksOf(result: AnalysisResult, sheet?: string): ResultBlock[] {
  return result.sheets
    .filter((s) => sheet === undefined || s.key === sheet)
    .flatMap((s) => s.blocks)
}

/** The first key-value block titled so (or starting so). */
export function kvBlock(result: AnalysisResult, title: string, sheet?: string): KV | null {
  for (const b of blocksOf(result, sheet))
    if (b.type === 'keyValue' && b.title !== undefined && b.title.startsWith(title)) return b
  return null
}

/** The first table titled so (or starting so). */
export function tableBlock(result: AnalysisResult, title: string, sheet?: string): Table | null {
  for (const b of blocksOf(result, sheet))
    if (b.type === 'table' && b.title !== undefined && b.title.startsWith(title)) return b
  return null
}

/** A key-value row's value by key, else by label, anywhere in the result (or in a block). */
export function row(
  result: AnalysisResult,
  which: { key?: string; label?: string; block?: string },
): ResultValue | null {
  for (const b of blocksOf(result)) {
    if (b.type !== 'keyValue') continue
    if (which.block !== undefined && !b.title?.startsWith(which.block)) continue
    const r = b.rows.find(
      (x) =>
        (which.key !== undefined && x.key === which.key) ||
        (which.label !== undefined && x.label === which.label),
    )
    if (r) return r.value
  }
  return null
}

/** A label table's cell: the row whose first cell reads `label`, the column titled `column`. */
export function cell(t: Table | null, label: string, column: string): ResultValue | null {
  if (!t) return null
  const j = t.columns.indexOf(column)
  const r = t.rows.find((x) => x[0]?.kind === 'text' && x[0].v === label)
  return j < 0 || !r ? null : (r[j] ?? null)
}

/** A number value's number (NaN otherwise). */
export const numOf = (v: ResultValue | null | undefined): number =>
  v && (v.kind === 'number' || v.kind === 'integer' || v.kind === 'pvalue') ? v.v : Number.NaN

/** An interval value, or null. */
export const intervalOf = (
  v: ResultValue | null | undefined,
): { lo: number; hi: number; level: number } | null =>
  v?.kind === 'interval' ? { lo: v.lo, hi: v.hi, level: v.level } : null

// --- Pieces of a sentence ---------------------------------------------------------------------

/** A number (three significant digits) with the data's unit. */
export const n3 = (v: number, unit?: string): SummaryPart => ({
  value: { kind: 'number', v, digits: 3 },
  role: 'estimate',
  ...(unit ? { unit } : {}),
})
/** A whole number. */
export const count = (v: number): SummaryPart => ({ value: { kind: 'integer', v } })
/** "P = 0.0014" / "P < 0.0001" in the project's style. */
export const P = (p: number): SummaryPart => ({ value: { kind: 'pvalue', v: p }, role: 'p' })
/** "95% CI 4.3 to 18.7" (with the unit after the upper limit). */
export const CI = (ci: { lo: number; hi: number; level: number }, unit?: string): SummaryPart => ({
  value: { kind: 'interval', lo: ci.lo, hi: ci.hi, level: ci.level },
  role: 'ci',
  ...(unit ? { unit } : {}),
})

/** An interval of the opposite difference (−hi to −lo). */
export const negated = (ci: { lo: number; hi: number; level: number }) => ({
  lo: -ci.hi,
  hi: -ci.lo,
  level: ci.level,
})

/** "A", "A and B", "A, B and C". */
export function listed(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** Parts joined with separators between items ("; ", and " and " before the last). */
export function joinParts(items: readonly SummaryPart[][], sep = '; ', last = sep): SummaryPart[] {
  const out: SummaryPart[] = []
  items.forEach((it, i) => {
    if (i > 0) out.push(i === items.length - 1 ? last : sep)
    out.push(...it)
  })
  return out
}

/** Sample sizes: "n = 10 each" when equal, else "n = 10 and 12". */
export function sizes(ns: readonly number[]): SummaryPart[] {
  const finite = ns.filter(Number.isFinite)
  if (!finite.length) return []
  if (finite.length > 1 && finite.every((n) => n === finite[0]))
    return ['n = ', count(finite[0]!), ' each']
  return [
    'n = ',
    ...joinParts(
      finite.map((n) => [count(n)]),
      ', ',
      ' and ',
    ),
  ]
}

/**
 * The unit of the analyzed values when the titles state it: the X title's for X values (a time,
 * a concentration); for Y values the unit every analyzed data set's title ends with ("Glucose
 * (mM)"), if they share one.
 */
export function unitOf(s: SummaryInput, axis: 'x' | 'y'): string | undefined {
  if (axis === 'x') return axisUnit(s.context?.xTitle) ?? undefined
  const units = s.input.map((d) => /\(([^()]{1,20})\)\s*$/.exec(d.title)?.[1]?.trim())
  const u = units[0]
  return u && units.every((x) => x === u) ? u : undefined
}

// --- Comparisons tables -------------------------------------------------------------------------

/** One row of a comparisons table, read in its sign: `diff` = `left` − `right`. */
export interface ComparisonRow {
  label: string
  /** The row (or column) the comparison is within, in a two-way table ("Day 1"). */
  within?: string
  left: string
  right: string
  diff: number
  ci: { lo: number; hi: number; level: number } | null
  p: number
  /** P values that are q values (FDR). */
  q: boolean
}

/**
 * "Treated − Control" or "Control vs. Treated" (the sign of saved analyses) → its sides, at the
 * first separator; "Day 1: …" names what the comparison is within.
 */
function sides(label: string): { within?: string; left: string; right: string } | null {
  for (const sep of [' − ', ' vs. ']) {
    const i = label.indexOf(sep)
    if (i < 0) continue
    const head = label.slice(0, i)
    const right = label.slice(i + sep.length)
    const colon = head.indexOf(': ')
    if (colon >= 0 && !right.includes(': '))
      return { within: head.slice(0, colon), left: head.slice(colon + 2), right }
    return { left: head, right }
  }
  return null
}

/** The rows of a comparisons table (one-way, two-way, nested, Kruskal-Wallis' Dunn…). */
export function comparisonRows(t: Table | null): ComparisonRow[] {
  if (!t) return []
  const col = (re: RegExp) => t.columns.findIndex((c) => re.test(c))
  const jDiff = col(/^(Mean Diff\.|Mean rank diff\.|Rank sum diff\.|Mean diff|Difference)/)
  const jCi = col(/CI of diff/)
  const jP = col(/^(Adjusted P Value|q value|P value|Adjusted P value|Step-down P value)$/i)
  const q = jP >= 0 && /^q value$/i.test(t.columns[jP]!)
  const out: ComparisonRow[] = []
  for (const r of t.rows) {
    const label = r[0]?.kind === 'text' ? r[0].v : ''
    const s = sides(label)
    if (!s) continue
    out.push({
      label,
      ...s,
      diff: jDiff >= 0 ? numOf(r[jDiff]) : Number.NaN,
      ci: jCi >= 0 ? intervalOf(r[jCi]) : null,
      p: jP >= 0 ? numOf(r[jP]) : Number.NaN,
      q,
    })
  }
  return out
}

/** The comparisons table of a result (its 'comparisons' sheet's first table). */
export const comparisonsTable = (result: AnalysisResult): Table | null => {
  const sheet = result.sheets.find((s) => s.key === 'comparisons')
  return (sheet?.blocks.find((b) => b.type === 'table') as Table | undefined) ?? null
}
