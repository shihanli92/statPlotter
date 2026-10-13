import { z } from 'zod'
import type { AnalysisResult, ResultBlock, ResultValue } from './analysis.ts'
import { formatNumber, formatP, pSummary } from './format.ts'
import type { ProjectSettings } from './project.ts'
import { mergeRuns, RichLabel, type RichText, type TextRun } from './style.ts'

// Results on graphs (roadmap 35): references to the values of an analysis' results, their number
// formats, and templates of text with fields ("r = {r}, P = {P}"). Layers with an analysis source
// (`LayerData` `from: 'analysis'`, stat `result`) draw labels, reference lines and bands from
// them, live: a field resolves against the analysis' latest result whenever the graph is laid
// out. References name values by keys (a sheet's key, a block's title, a row's label, a column's
// title), never by position, so they survive recomputes; a value gone is shown as "—".

/** A field's name in a template (`{name}`): letters, digits and underscores, a letter first. */
export const FieldName = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,31}$/)
export type FieldName = z.infer<typeof FieldName>

/**
 * Where a value is in an analysis' results. In a field drawn per data set, `{key}` (in a value's
 * key) and `{dataSet}` (in a cell's block, row or column) stand for the data set's key and title.
 */
export const ResultRef = z.discriminatedUnion('from', [
  /** A machine-readable value: `AnalysisResult.values[key]` ('p', 'slope:<key>'…). */
  z.object({ from: z.literal('value'), key: z.string().min(1).max(200) }),
  /**
   * A cell of a results sheet: the sheet's key, the block's title (absent: the first block with
   * the row; a title matches a block titled so or starting with it, "Odds ratio" matching "Odds
   * ratio, A vs. B"), the row's label (a key-value row's label, a table row's first cell as
   * shown) and, in tables, the column's title. An interval may be read at one end.
   */
  z.object({
    from: z.literal('cell'),
    sheet: z.string().max(200),
    block: z.string().max(400).optional(),
    row: z.string().max(400),
    column: z.string().max(400).optional(),
    end: z.enum(['lo', 'hi']).optional(),
    /**
     * Roadmap 51d (§8.2): the block's, row's and column's stable keys, tried before the labels
     * (labels name the user's groups and so change with them; keys don't).
     */
    blockKey: z.string().max(200).optional(),
    rowKey: z.string().max(200).optional(),
    columnKey: z.string().max(200).optional(),
  }),
  /** A comparison (a bracket's): its P value (adjusted when it has one) or its estimate. */
  z.object({
    from: z.literal('comparison'),
    key: z.string().min(1).max(400),
    what: z.enum(['p', 'estimate']).optional(),
  }),
  /** Roadmap 36: a number typed in (a manual line's or band's value). */
  z.object({ from: z.literal('number'), v: z.number() }),
  /**
   * Roadmap 46b: one of the graph's shared cut-offs (`GraphNode.cutoffs`): the fold change's
   * (`fold`) or the significance's as an axis value (`sig`; −log10 of a P cut-off). Read by the
   * graph (it has no value in an analysis' results), so the volcano thresholds' lines and the
   * Significance layer move together.
   */
  z.object({ from: z.literal('cutoff'), which: z.enum(['fold', 'sig']) }),
])
export type ResultRef = z.infer<typeof ResultRef>

/** How a P value is written in a field. */
export const PFormat = z.enum([
  /** The project's P value style (Settings: GP, APA or NEJM), as results show it. */
  'project',
  /** Exactly, with `digits` significant digits (absent: 2). */
  'exact',
  /** Exactly, but "< 0.0001" below `below` (absent: 0.0001). */
  'below',
  /** Scientific: 1.2 × 10⁻⁵ (`digits` significant digits, absent 2). */
  'scientific',
  /** Stars (the project's style: * to ****), "ns" when not significant (unless `ns` is false). */
  'stars',
])
export type PFormat = z.infer<typeof PFormat>

/** A field's number format (sparse). */
export const FieldFormat = z
  .object({
    /** Significant digits of numbers (absent: 3). */
    digits: z.number().int().min(1).max(15),
    /** Fixed decimals of numbers (wins over `digits`). */
    decimals: z.number().int().min(0).max(15),
    /** P values (values of kind P, comparisons' P): how they are written (absent: 'below'). */
    p: PFormat,
    /** 'below': the threshold (absent: 0.0001). */
    below: z.number().gt(0).lt(1),
    /** 'stars': "ns" when not significant (absent: true). */
    ns: z.boolean(),
    /** Text after the number ("µM"). */
    unit: z.string().max(40),
    /** The unit of an axis' title ("Concentration (µM)" → µM), when it has one. */
    axisUnit: z.enum(['x', 'y']),
  })
  .partial()
export type FieldFormat = z.infer<typeof FieldFormat>

/** A field of a template, or a value a line or band is drawn at. */
export const ResultField = z.object({ ref: ResultRef, format: FieldFormat.optional() })
export type ResultField = z.infer<typeof ResultField>

/** Corners of the plot. */
export const PlotCorner = z.enum(['topLeft', 'topRight', 'bottomLeft', 'bottomRight'])
export type PlotCorner = z.infer<typeof PlotCorner>

/**
 * Where a result label sits: in a corner of the plot (labels there stacked), at a data position
 * (axis values; a category's index on category axes), or beside the end of its data set's fitted
 * curve (else in the top-left corner). Labels away from corners move apart (repel).
 */
export const ResultPlace = z.discriminatedUnion('at', [
  z.object({ at: z.literal('corner'), corner: PlotCorner }),
  z.object({ at: z.literal('data'), x: z.number(), y: z.number() }),
  z.object({ at: z.literal('curve') }),
])
export type ResultPlace = z.infer<typeof ResultPlace>

/**
 * The stat of a layer drawing an analysis' results (roadmap 35): its fields, and what each geom
 * makes of them — a label's text (`template`, placed by `place`, in the plot or appended to the
 * legend's entries), a reference line at a field (`at`, across the plot at a Y value or along it
 * at an X; `drop`: from the fitted curve's point at that X to the axes) or a band between two
 * (`lo`, `hi`). Drawn once, or (`per: 'dataSet'`) once per data set, its fields read for each in
 * the data set's colour.
 */
export const ResultStat = z.object({
  kind: z.literal('result'),
  fields: z.record(FieldName, ResultField),
  template: RichLabel.optional(),
  place: ResultPlace.optional(),
  /** Labels: in the plot (absent), appended to the legend's entry, or both. */
  show: z.enum(['plot', 'legend', 'both']).optional(),
  at: FieldName.optional(),
  lo: FieldName.optional(),
  hi: FieldName.optional(),
  /** Lines and bands: at Y values (absent: across the plot) or at X values ('x'). */
  axis: z.enum(['x', 'y']).optional(),
  /** Lines at an X value: from the curve's point down to the X axis, across to the Y axis, or both. */
  drop: z.enum(['x', 'y', 'both']).optional(),
  per: z.enum(['analysis', 'dataSet']).optional(),
  /**
   * Roadmap 36: lines and bands: the template drawn as the line's (band's) label at its start or
   * end (absent: no label on the line).
   */
  lineLabel: z.enum(['start', 'end']).optional(),
  /**
   * Roadmap 46b: reference lines y = slope·x + intercept (an identity line, y = x, by default):
   * with `slope` set, a refline is drawn across the plot along that line, on graphs with two
   * continuous axes (`at`, `axis` and `drop` unused); `intercept` absent = 0. It never widens
   * the axes.
   */
  slope: FieldName.optional(),
  intercept: FieldName.optional(),
  /**
   * Roadmap 46b: lines and bands at ± a value: the value `c` of `at` drawn at −c and +c (a line
   * each, one layer), a band shading between −c and +c, or (`outside`) beyond them to the axis'
   * ends. `lo` and `hi` aren't read.
   */
  mirror: z.boolean().optional(),
  /** Roadmap 46b: a mirrored band shades outside ±c (absent: between −c and +c). */
  outside: z.boolean().optional(),
})
export type ResultStat = z.infer<typeof ResultStat>

/**
 * A ready result label, line or band an analysis offers (`AnalysisDef.graphResults`): the
 * curated values of each analysis, one click away in the UI.
 */
export interface ResultTemplate {
  id: string
  /** In menus: "r and P", "IC50 with drop lines". */
  title: string
  kind: 'label' | 'line' | 'band'
  stat: Omit<ResultStat, 'kind'>
  /** The analysis dialog's checkbox ("Show r and P on the graph"), when offered there. */
  offer?: string
  /** Frames it makes sense on (absent: every frame result layers are drawn on). */
  frames?: readonly ('category' | 'grouped' | 'xy')[]
}

// --- Resolving references --------------------------------------------------------------------

/** The data set a field is read for (per data set): its key and title. */
export interface FieldDataSet {
  key: string
  title: string
}

const fill = (s: string, ds: FieldDataSet | undefined, token: string, by: 'key' | 'title') =>
  ds ? s.split(token).join(ds[by]) : s

/** A table row's label: its first cell as shown (text as it is). */
export function rowLabel(
  row: readonly ResultValue[],
  settings: Pick<ProjectSettings, 'pValueStyle' | 'pValueDigits'>,
): string {
  const first = row[0]
  if (!first) return ''
  return first.kind === 'text' ? first.v : formatValueText(first, settings)
}

const formatValueText = (
  v: ResultValue,
  settings: Pick<ProjectSettings, 'pValueStyle' | 'pValueDigits'>,
): string => {
  switch (v.kind) {
    case 'number':
      return formatNumber(v.v, v.digits ?? 4)
    case 'integer':
      return Number.isFinite(v.v) ? String(Math.round(v.v)) : formatNumber(v.v)
    case 'pvalue':
      return formatP(v.v, settings)
    case 'pSummary':
      return pSummary(v.v, settings.pValueStyle)
    case 'interval':
      return `${formatNumber(v.lo)} to ${formatNumber(v.hi)}`
    case 'text':
      return v.v
    case 'bool':
      return v.v ? 'Yes' : 'No'
  }
}

/** Whether a block's title matches a reference's: the same, or starting with it. */
const blockMatches = (b: ResultBlock, title: string | undefined): boolean =>
  title === undefined ||
  ((b.type === 'keyValue' || b.type === 'table') &&
    b.title !== undefined &&
    (b.title === title || b.title.startsWith(title)))

/**
 * Roadmap 51d (§8.2): a cell by keys — the block's (any block when absent), the row's and, in
 * tables, the column's (else the column titled `column`, else the first value column).
 */
function cellByKeys(
  blocks: readonly ResultBlock[],
  keys: { block?: string; row: string; column?: string; columnTitle?: string },
): ResultValue | null {
  for (const b of blocks) {
    if (b.type !== 'keyValue' && b.type !== 'table') continue
    if (keys.block !== undefined && b.key !== keys.block) continue
    if (b.type === 'keyValue') {
      if (keys.column !== undefined || keys.columnTitle !== undefined) continue
      const r = b.rows.find((x) => x.key === keys.row)
      if (r) return r.value
      continue
    }
    const i = b.rowKeys?.indexOf(keys.row) ?? -1
    if (i < 0) continue
    const j =
      keys.column !== undefined
        ? (b.columnKeys?.indexOf(keys.column) ?? -1)
        : keys.columnTitle !== undefined
          ? b.columns.indexOf(keys.columnTitle)
          : 1
    const v = j < 0 ? undefined : b.rows[i]?.[j]
    if (v) return v
  }
  return null
}

/** A cell of a block by row label and column title (key-value blocks: no column). */
function cellOf(
  b: ResultBlock,
  row: string,
  column: string | undefined,
  settings: Pick<ProjectSettings, 'pValueStyle' | 'pValueDigits'>,
): ResultValue | null {
  if (b.type === 'keyValue') {
    if (column !== undefined) return null
    return b.rows.find((r) => r.label === row)?.value ?? null
  }
  if (b.type !== 'table') return null
  const j = column === undefined ? 1 : b.columns.indexOf(column)
  if (j < 0) return null
  const r = b.rows.find((cells) => rowLabel(cells, settings) === row)
  return r?.[j] ?? null
}

/**
 * The value a reference names in a result, read for a data set when given; null when the result
 * has no such value (a sheet, block, row or column gone).
 */
export function resolveResultRef(
  result: AnalysisResult | undefined,
  ref: ResultRef,
  settings: Pick<ProjectSettings, 'pValueStyle' | 'pValueDigits'>,
  ds?: FieldDataSet,
): ResultValue | null {
  if (ref.from === 'number') return Number.isFinite(ref.v) ? { kind: 'number', v: ref.v } : null
  // Roadmap 46b: a graph's cut-off is the graph's to read (`resultNumber` in @ps/graph).
  if (ref.from === 'cutoff' || !result) return null
  switch (ref.from) {
    case 'value':
      return result.values[fill(ref.key, ds, '{key}', 'key')] ?? null
    case 'comparison': {
      const c = result.comparisons.find((x) => x.key === fill(ref.key, ds, '{key}', 'key'))
      if (!c) return null
      if (ref.what === 'estimate')
        return c.estimate ? { kind: 'number', v: c.estimate.value } : null
      return { kind: 'pvalue', v: c.pAdjusted ?? c.p }
    }
    case 'cell': {
      const sheet = result.sheets.find((s) => s.key === ref.sheet)
      if (!sheet) return null
      const atEnd = (v: ResultValue): ResultValue =>
        ref.end && v.kind === 'interval' ? { kind: 'number', v: v[ref.end] } : v
      const block = ref.block === undefined ? undefined : fill(ref.block, ds, '{dataSet}', 'title')
      const row = fill(ref.row, ds, '{dataSet}', 'title')
      const column =
        ref.column === undefined ? undefined : fill(ref.column, ds, '{dataSet}', 'title')
      // Roadmap 51d (§8.2): keys first — they survive the labels' renaming to the user's names.
      if (ref.rowKey !== undefined) {
        const v = cellByKeys(sheet.blocks, {
          ...(ref.blockKey === undefined ? {} : { block: ref.blockKey }),
          row: fill(ref.rowKey, ds, '{key}', 'key'),
          ...(ref.columnKey !== undefined
            ? { column: fill(ref.columnKey, ds, '{key}', 'key') }
            : column !== undefined
              ? { columnTitle: column }
              : {}),
        })
        if (v) return atEnd(v)
      }
      // Roadmap 51c: a label renamed since the reference was made reads its new name.
      const blocks = [block, ...(block === undefined ? [] : renamedLabel(block, BLOCK_RENAMES))]
      const rows = [row, ...renamedLabel(row, ROW_RENAMES)]
      for (const bt of blocks)
        for (const r of rows)
          for (const b of sheet.blocks) {
            if (!blockMatches(b, bt)) continue
            const v = cellOf(b, r, column, settings)
            if (v) return atEnd(v)
          }
      // Roadmap 51d (§8.2): a label of before 0.3.11 ("Mean of column A") reads the row now
      // keyed for it ("Mean of Control", `meanA`), in the block it named.
      for (const r of rows) {
        const key = legacyRowKey(r)
        if (!key) continue
        for (const bt of blocks) {
          const v = cellByKeys(
            sheet.blocks.filter((b) => blockMatches(b, bt)),
            column === undefined ? { row: key } : { row: key, columnTitle: column },
          )
          if (v) return atEnd(v)
        }
      }
      return null
    }
  }
}

/**
 * Roadmap 51c: result labels renamed (S12's rank-test wording, S43's "(pooled SD)"), old → new,
 * so result labels on graphs made before keep their values. `{level}` stands for a confidence
 * level ("95%"). Only renames that keep the value's meaning are listed.
 */
const ROW_RENAMES: readonly [string, string][] = [
  ['Cohen’s d', 'Cohen’s d (pooled SD)'],
  ['Hedges’ g', 'Hedges’ g (pooled SD)'],
  ['Difference: Hodges-Lehmann', 'Shift (Hodges-Lehmann: median of all differences B − A)'],
  ['Difference: actual (B − A)', 'Difference between medians (B − A)'],
  ['{level} CI of Hodges-Lehmann difference', '{level} CI of the shift'],
  [
    'Do the medians vary significantly (P < 0.05)?',
    'Do the values tend to differ between groups (P < 0.05)?',
  ],
  [
    'Are the medians significantly different (P < 0.05)?',
    'Do the values tend to differ between groups (P < 0.05)?',
  ],
]
const BLOCK_RENAMES: readonly [string, string][] = [
  ['Difference between medians', 'Shift between groups'],
]

/**
 * Roadmap 51d (§8.2, U19): labels that named positions ("column A") or the sign in letters
 * ("B − A") before 0.3.11, now the user's names, and the keys of the rows they became. Only the
 * two-group analyses had them. A level ("95% CI of log10(B/A)") is matched with any level.
 */
const LEGACY_ROW_KEY_LIST: readonly [string, string][] = [
  ['Column A', 'dataSetA'],
  ['Column B', 'dataSetB'],
  ['Mean of column A', 'meanA'],
  ['Mean of column B', 'meanB'],
  ['Sample size, column A', 'nA'],
  ['Sample size, column B', 'nB'],
  ['Median of column A', 'medianA'],
  ['Median of column B', 'medianB'],
  ['Sum of ranks in column A', 'rankSumA'],
  ['Sum of ranks in column B', 'rankSumB'],
  ['Difference between means (B − A)', 'diff'],
  ['Mean difference (B − A)', 'diff'],
  ['Glass’s delta (SD of column A)', 'glassDelta'],
  ['Shift (Hodges-Lehmann: median of all differences B − A)', 'shift'],
  ['Difference between medians (B − A)', 'medianDiff'],
  ['Median of differences (B − A)', 'medianDiff'],
  ['Mean of log10(B/A)', 'logRatio'],
  // Two-way ANOVA's factors, named by the table since 0.3.11.
  ['Row factor', 'row'],
  ['Column factor', 'column'],
  ['Geometric mean of ratios (B/A)', 'ratio'],
]
const LEGACY_ROW_KEYS = new Map(LEGACY_ROW_KEY_LIST)
const legacyRowKey = (label: string): string | undefined =>
  LEGACY_ROW_KEYS.get(label) ??
  (/^\d+(?:\.\d+)?% CI of log10\(B\/A\)$/.test(label) ? 'logRatioCi' : undefined)

/** A label's current name(s), when it was renamed. */
function renamedLabel(label: string, renames: readonly [string, string][]): string[] {
  const out: string[] = []
  for (const [from, to] of renames) {
    if (from === label) out.push(to)
    else if (from.startsWith('{level}')) {
      const m = /^(\d+(?:\.\d+)?%)(.*)$/.exec(label)
      if (m && m[2] === from.slice('{level}'.length)) out.push(m[1] + to.slice('{level}'.length))
    }
  }
  return out
}

/** A value's number, if it is one (a P value, a count, a number; an interval's ends aside). */
export function valueNumber(v: ResultValue | null): number | null {
  if (!v) return null
  switch (v.kind) {
    case 'number':
    case 'integer':
    case 'pvalue':
    case 'pSummary':
      return Number.isFinite(v.v) ? v.v : null
    default:
      return null
  }
}

// --- Formats -----------------------------------------------------------------------------------

/**
 * The unit in an axis title: the text in its last parentheses ("Concentration (µM)" → µM), else
 * after its last comma ("log[Inhibitor], M" → M); none otherwise.
 */
export function axisUnit(title: string | null | undefined): string | null {
  if (!title) return null
  const paren = /\(([^()]{1,40})\)\s*$/.exec(title)
  if (paren) return paren[1]!.trim() || null
  const comma = /,\s*([^,]{1,20})$/.exec(title)
  return comma ? comma[1]!.trim() || null : null
}

const SUPERSCRIPT_MINUS = '−'

/** A number with `digits` significant digits in scientific form: "1.2 × 10" with a raised "−5". */
function scientific(v: number, digits: number): RichText {
  if (!Number.isFinite(v)) return [{ text: formatNumber(v) }]
  if (v === 0) return [{ text: '0' }]
  const [mant, exp] = v.toExponential(Math.max(0, digits - 1)).split('e')
  const e = Number(exp)
  if (e === 0) return [{ text: mant! }]
  return [
    { text: `${mant} × 10` },
    { text: e < 0 ? `${SUPERSCRIPT_MINUS}${-e}` : String(e), sup: true },
  ]
}

/** A number in a field's format: fixed decimals, else `digits` significant digits (3). */
export function formatFieldNumber(v: number, f: FieldFormat = {}): string {
  if (!Number.isFinite(v)) return formatNumber(v)
  if (f.decimals !== undefined) return v.toFixed(f.decimals).replace(/^-(0\.?0*)$/, '$1')
  const sig = f.digits ?? 3
  if (v === 0) return '0'
  const mag = Math.floor(Math.log10(Math.abs(v)))
  if (mag < -4 || mag >= 9) return v.toExponential(sig - 1)
  // Significant digits without trailing noise, never dropping integer digits.
  const decimals = Math.min(15, Math.max(0, sig - 1 - mag))
  return v.toFixed(decimals)
}

/** A P value in a field's format (a leading "<" kept for the template's "P = …" to read right). */
export function formatFieldP(
  p: number,
  f: FieldFormat,
  settings: Pick<ProjectSettings, 'pValueStyle' | 'pValueDigits'>,
): RichText {
  if (Number.isNaN(p)) return [{ text: '—' }]
  switch (f.p ?? 'below') {
    case 'project':
      return [{ text: formatP(p, settings) }]
    case 'stars': {
      const s = pSummary(p, settings.pValueStyle)
      return s === 'ns' && f.ns === false ? [] : [{ text: s }]
    }
    case 'scientific':
      return scientific(p, f.digits ?? 2)
    case 'exact':
      return [{ text: formatFieldNumber(p, { digits: f.digits ?? 2, decimals: f.decimals }) }]
    case 'below': {
      const below = f.below ?? 0.0001
      if (p < below) return [{ text: `< ${formatFieldNumber(below, { digits: 1 })}` }]
      return [{ text: formatFieldNumber(p, { digits: f.digits ?? 2, decimals: f.decimals }) }]
    }
  }
}

/**
 * A resolved value as text in a field's format: numbers by digits or decimals with their unit,
 * P values in the P format, an interval "lo to hi", text as it is; null (missing) as "—".
 */
export function formatField(
  v: ResultValue | null,
  f: FieldFormat = {},
  settings: Pick<ProjectSettings, 'pValueStyle' | 'pValueDigits'>,
  unit?: string | null,
): RichText {
  if (!v) return [{ text: '—' }]
  const u = f.unit ?? unit
  const withUnit = (rt: RichText): RichText =>
    u ? [...rt, { text: `${u.startsWith('%') ? '' : ' '}${u}` }] : rt
  switch (v.kind) {
    case 'pvalue':
      return formatFieldP(v.v, f, settings)
    case 'pSummary':
      return [{ text: pSummary(v.v, settings.pValueStyle) }]
    case 'number':
    case 'integer':
      if (f.p !== undefined && v.v >= 0 && v.v <= 1) return formatFieldP(v.v, f, settings)
      if (v.kind === 'integer' && f.decimals === undefined && Number.isFinite(v.v))
        return withUnit([{ text: String(Math.round(v.v)) }])
      return withUnit([{ text: formatFieldNumber(v.v, f) }])
    case 'interval':
      return withUnit([{ text: `${formatFieldNumber(v.lo, f)} to ${formatFieldNumber(v.hi, f)}` }])
    case 'text':
      return [{ text: v.v }]
    case 'bool':
      return [{ text: v.v ? 'Yes' : 'No' }]
  }
}

// --- Templates ---------------------------------------------------------------------------------

/** A run of a template: text, or a field (`{name}`) in the format of the text around it. */
export type TemplatePart =
  | { text: string; run: Omit<TextRun, 'text'> }
  | { field: string; run: Omit<TextRun, 'text'> }

const FIELD = /\{([A-Za-z][A-Za-z0-9_]{0,31})\}|\{\{|\}\}/g

/**
 * A template's parts: its runs' text with `{name}` fields picked out (a field spanning runs takes
 * the format of the run its brace opens in); `{{` and `}}` are literal braces.
 */
export function parseTemplate(template: RichLabel | null | undefined): TemplatePart[] {
  const runs: RichText =
    typeof template === 'string' ? [{ text: template }] : (template ?? ([] as RichText))
  // Joined text with each character's run, so fields may span runs.
  let text = ''
  const owner: number[] = []
  runs.forEach((r, i) => {
    text += r.text
    for (let k = 0; k < r.text.length; k++) owner.push(i)
  })
  const fmt = (i: number): Omit<TextRun, 'text'> => {
    const { text: _, ...rest } = runs[owner[i]!] ?? { text: '' }
    return rest
  }
  const out: TemplatePart[] = []
  const pushText = (from: number, to: number) => {
    for (let i = from; i < to; i++) {
      const last = out[out.length - 1]
      if (i > from && last && 'text' in last && owner[i] === owner[i - 1]) last.text += text[i]
      else out.push({ text: text[i]!, run: fmt(i) })
    }
  }
  let at = 0
  for (const m of text.matchAll(FIELD)) {
    const i = m.index
    pushText(at, i)
    if (m[1] !== undefined) out.push({ field: m[1], run: fmt(i) })
    else out.push({ text: m[0][0]!, run: fmt(i) })
    at = i + m[0].length
  }
  pushText(at, text.length)
  return out
}

/** The fields a template names, each once, in order. */
export const templateFields = (template: RichLabel | null | undefined): string[] => [
  ...new Set(parseTemplate(template).flatMap((p) => ('field' in p ? [p.field] : []))),
]

/**
 * A template filled in: each field's runs (from `value`, which says null for a field it doesn't
 * know) in the format of the text around it, the field's own formatting (a superscript, a raised
 * minus) over it. Unknown fields read "—" and are listed in `unknown`.
 */
export function fillTemplate(
  template: RichLabel | null | undefined,
  value: (field: string) => RichText | null,
): { runs: RichText; unknown: string[] } {
  const out: TextRun[] = []
  const unknown: string[] = []
  for (const part of parseTemplate(template)) {
    if ('text' in part) {
      out.push({ ...part.run, text: part.text })
      continue
    }
    const runs = value(part.field)
    if (!runs) {
      if (!unknown.includes(part.field)) unknown.push(part.field)
      out.push({ ...part.run, text: '—' })
      continue
    }
    // "P = {P}" with P below a threshold reads "P < 0.0001", not "P = < 0.0001".
    const first = runs[0]
    const bound = first && /^[<>]/.exec(first.text)
    const last = out[out.length - 1]
    if (bound && last && /=\s*$/.test(last.text)) {
      last.text = last.text.replace(/=\s*$/, '')
      if (last.text && !last.text.endsWith(' ')) last.text += ' '
      const rest = first.text.slice(1).trimStart()
      out.push({ ...part.run, ...first, text: `${bound[0]} ${rest}` })
      for (const r of runs.slice(1)) out.push({ ...part.run, ...r })
      continue
    }
    for (const r of runs) out.push({ ...part.run, ...r })
  }
  return { runs: mergeRuns(out), unknown }
}
