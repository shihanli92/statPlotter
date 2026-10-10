import { z } from 'zod'
import type { CellColumn, DataTable } from './table.ts'

// Values below or above a detection limit (roadmap 39, decisions 574–576): cells such as "<0.5",
// ">ULOQ" or "BLQ" are imported as a substitute number (LOD/2 by default) with a flag beside the
// cell keeping the side and the original text, so the rule can be changed later and the values
// substituted again from the text. Analyses use the substituted numbers.

export const LimitSide = z.enum(['below', 'above'])
export type LimitSide = z.infer<typeof LimitSide>

/** A cell substituted for a value at a limit: which side, and the text it was imported from. */
export const LimitFlag = z.object({ side: LimitSide, text: z.string().max(200) })
export type LimitFlag = z.infer<typeof LimitFlag>

/** What replaces a value below the limit L: L/2, L, L/√2, nothing, or a fixed number. */
export const BelowMethod = z.enum(['half', 'limit', 'sqrt2', 'blank', 'fixed'])
export type BelowMethod = z.infer<typeof BelowMethod>
/** What replaces a value above the limit L: L, nothing, or a fixed number. */
export const AboveMethod = z.enum(['limit', 'blank', 'fixed'])
export type AboveMethod = z.infer<typeof AboveMethod>

/** Limits typed for cells that don't give theirs ("BLQ"): one for all, or per data set id. */
export const LimitValues = z
  .object({
    all: z.number().finite(),
    columns: z.record(z.string(), z.number().finite()),
  })
  .partial()
export type LimitValues = z.infer<typeof LimitValues>

/** A table's substitution rule (`DataTable.limits`). */
export const LimitRule = z.object({
  below: z.object({ method: BelowMethod, value: z.number().finite().optional() }),
  above: z.object({ method: AboveMethod, value: z.number().finite().optional() }),
  /** Limits of cells without a number, below ("BLQ") and above ("ULOQ+"). */
  lower: LimitValues.optional(),
  upper: LimitValues.optional(),
})
export type LimitRule = z.infer<typeof LimitRule>

/** The default rule: LOD/2 below, the limit above. */
export const DEFAULT_LIMIT_RULE: LimitRule = {
  below: { method: 'half' },
  above: { method: 'limit' },
}

export const BELOW_METHODS: readonly { id: BelowMethod; label: string }[] = [
  { id: 'half', label: 'LOD/2' },
  { id: 'limit', label: 'LOD' },
  { id: 'sqrt2', label: 'LOD/√2' },
  { id: 'blank', label: 'Blank' },
  { id: 'fixed', label: 'A fixed value' },
]
export const ABOVE_METHODS: readonly { id: AboveMethod; label: string }[] = [
  { id: 'limit', label: 'The limit' },
  { id: 'blank', label: 'Blank' },
  { id: 'fixed', label: 'A fixed value' },
]

// --- Reading limit text ----------------------------------------------------------------------

/** A cell's limit: its side and the number it names (null: a word such as "LOD"). */
export interface ParsedLimit {
  side: LimitSide
  limit: number | null
}

const NUMBER = /^[+-]?(?:\d{1,3}(?:,\d{3})+(?:\.\d*)?|\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][+-]?\d+)?/
// Words naming a limit (the cell names no number): detection, quantitation, reporting limits.
const LIMIT_WORD =
  /^(?:the\s+)?(?:l?lo[dq]|lloq|ll?oq|uloq|ul?oq|ulq|llq|lod|loq|dl|ql|mdl|mql|lrl|url|rl|detection(?:\s+limit)?|limit(?:\s+of\s+(?:detection|quantit?(?:ation|ification)))?|(?:quantit?(?:ation|ification)|reporting|detection)\s+limit|range|(?:the\s+)?(?:standard\s+)?curve|assay\s+range|calibration\s+range)\.?$/i
// Single words that are a side and a limit in one.
const BELOW_WORDS =
  /^(?:blq|bloq|bql|bdl|bld|below[-_\s]?(?:lod|loq|lloq|ql|dl)|<\s*(?:lod|loq|lloq)|nq\s*<)$/i
const ABOVE_WORDS = /^(?:alq|aql|aloq|abq|above[-_\s]?(?:uloq|loq|ql)|uloq\s*\+|>\s*uloq)$/i
/** Text that could be a limit: a comparison sign, or a word of the grammar below. */
const MAYBE_LIMIT =
  /[<>≤≥⩽⩾]|&[lg]t;|lo[dq]|l?l[oq]q|u?loq|ulq|llq|\b[mu]?[dqr]?[dlq]\b|bdl|bld|blq|bloq|bql|alq|aql|abq|aloq|nq|below|under|less|lower|smaller|above|over|greater|more|higher|exceed|detection|limit|quanti|reporting|range|curve|upper/i
const UPPER_NAMES = /^(?:uloq|ul?oq|ulq|url|upper)/i

/**
 * The limit a cell names, or null when it isn't one: a comparison sign and a number, optionally
 * with units ("<0.5", "< 0.5 ng/mL", "≤0.5", ">1e4"), a sign and a limit's name ("<LOD", ">ULOQ",
 * "<LLOQ"), words ("below LOD", "above the range", "BLQ"), or a name with + or − ("ULOQ+",
 * "LLOQ-"). Spaces (also non-breaking ones) anywhere; any case.
 */
export function parseLimitText(raw: string): ParsedLimit | null {
  // Most text cells (names, groups) are none: a cheap test before the full reading, as every
  // text cell of a sheet passes here on import.
  if (raw.length > 80 || !MAYBE_LIMIT.test(raw)) return null
  let s = raw
    .replace(/[\s   ]+/g, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .trim()
  if (!s || s.length > 60) return null
  if (BELOW_WORDS.test(s)) return { side: 'below', limit: null }
  if (ABOVE_WORDS.test(s)) return { side: 'above', limit: null }
  let side: LimitSide | null = null
  const sign = /^(<=|=<|≤|⩽|<|>=|=>|≥|⩾|>)\s*/.exec(s)
  if (sign) {
    side = /[<≤⩽]/.test(sign[1]!) ? 'below' : 'above'
    s = s.slice(sign[0].length)
  } else {
    const word =
      /^(below|under|less\s+than|lower\s+than|smaller\s+than|above|over|greater\s+than|more\s+than|higher\s+than|exceeds?)\s+/i.exec(
        s,
      )
    if (word) {
      side = /^(below|under|less|lower|smaller)/i.test(word[1]!) ? 'below' : 'above'
      s = s.slice(word[0].length)
    }
  }
  // A name with + or − after it: "ULOQ+", "LLOQ-".
  if (!side) {
    const suffix = /^(.+?)\s*([+\-−])$/.exec(s)
    if (suffix && LIMIT_WORD.test(suffix[1]!.trim())) {
      return { side: suffix[2] === '+' ? 'above' : 'below', limit: null }
    }
    if (LIMIT_WORD.test(s)) {
      // A bare limit's name: below it, unless it is an upper limit's.
      return { side: UPPER_NAMES.test(s) ? 'above' : 'below', limit: null }
    }
    return null
  }
  if (!s) return null
  const num = NUMBER.exec(s)
  if (num) {
    const rest = s.slice(num[0].length).trim()
    // Units after the number ("ng/mL", "%", "µg/l", "pg ml-1"), not another value: each word
    // of them has a letter (or is %).
    if (rest) {
      if (rest.length > 20 || /^[\d.,]/.test(rest)) return null
      const words = rest.split(' ')
      if (words.length > 3 || !words.every((w) => /^[%a-zA-Zµμ°/·.\-0-9^*]+$/.test(w))) return null
      if (!words.every((w) => /[%a-zA-Zµμ°]/.test(w))) return null
    }
    let t = num[0]
    // A comma: thousands in "1,000" (groups of three after a first figure other than 0),
    // otherwise a decimal comma ("0,5").
    if (/^[+-]?[1-9]\d{0,2}(,\d{3})+(\.\d*)?$/.test(t)) t = t.replace(/,/g, '')
    else if (t.includes(',') && !t.includes('.')) t = t.replace(',', '.')
    else t = t.replace(/,/g, '')
    const v = Number(t)
    if (!Number.isFinite(v)) return null
    return { side, limit: v }
  }
  return LIMIT_WORD.test(s) ? { side, limit: null } : null
}

// --- Substituting ----------------------------------------------------------------------------

/** The limit a word cell of data set `column` takes from the rule's typed limits. */
function typedLimit(rule: LimitRule, side: LimitSide, column: string | undefined): number | null {
  const values = side === 'below' ? rule.lower : rule.upper
  if (!values) return null
  const own = column === undefined ? undefined : values.columns?.[column]
  return own ?? values.all ?? null
}

/**
 * The number that replaces a cell at a limit under `rule` (null: blank): the limit from the cell
 * or, for a word, the one typed for its data set or for all; a cell whose limit is unknown is
 * blank unless the rule gives a fixed value.
 */
export function substituteLimit(
  parsed: ParsedLimit,
  rule: LimitRule,
  column?: string,
): number | null {
  const L = parsed.limit ?? typedLimit(rule, parsed.side, column)
  if (parsed.side === 'below') {
    const { method, value } = rule.below
    if (method === 'fixed') return value ?? null
    if (method === 'blank' || L === null) return null
    if (method === 'half') return L / 2
    if (method === 'sqrt2') return L / Math.SQRT2
    return L
  }
  const { method, value } = rule.above
  if (method === 'fixed') return value ?? null
  if (method === 'blank' || L === null) return null
  return L
}

/** Whether a table has cells substituted for values at a limit. */
export function hasLimitFlags(t: Pick<DataTable, 'dataSets'>): boolean {
  return t.dataSets.some((d) => d.subcolumns.some((c) => c.limit?.some((f) => f !== null)))
}

/** Cells substituted, by side. */
export function countLimitFlags(t: Pick<DataTable, 'dataSets'>): { below: number; above: number } {
  const out = { below: 0, above: 0 }
  for (const d of t.dataSets)
    for (const c of d.subcolumns)
      for (const f of c.limit ?? []) if (f) out[f.side === 'below' ? 'below' : 'above']++
  return out
}

/**
 * A subcolumn's values substituted again under `rule` from its flags' original text (cells
 * without a flag unchanged). Returns the same column when nothing changes.
 */
export function resubstitute(col: CellColumn, rule: LimitRule, column?: string): CellColumn {
  if (!col.limit) return col
  let values: (number | null)[] | null = null
  col.limit.forEach((f, r) => {
    if (!f) return
    const parsed = parseLimitText(f.text) ?? { side: f.side, limit: null }
    const v = substituteLimit({ side: f.side, limit: parsed.limit }, rule, column)
    if (v !== (col.values[r] ?? null)) {
      values ??= col.values.slice()
      values[r] = v
    }
  })
  return values ? { ...col, values } : col
}

/** Short text of a rule for notes: "below a limit: LOD/2; above: the limit". */
export function describeLimitRule(rule: LimitRule): string {
  const below =
    rule.below.method === 'fixed'
      ? String(rule.below.value ?? 'blank')
      : (BELOW_METHODS.find((m) => m.id === rule.below.method)?.label ?? '')
  const above =
    rule.above.method === 'fixed'
      ? String(rule.above.value ?? 'blank')
      : (ABOVE_METHODS.find((m) => m.id === rule.above.method)?.label.toLowerCase() ?? '')
  return `below a limit: ${below}; above: ${above}`
}
