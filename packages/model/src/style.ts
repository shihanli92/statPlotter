import { z } from 'zod'

/** Length in points (1/72 inch). All graph geometry uses points. */
export const Pt = z.number().min(0)
export type Pt = z.infer<typeof Pt>

/**
 * A move of a graph element from where the layout engine puts it, in points (x right, y down).
 * Stored relative to the computed position, so the element keeps following the plot when it is
 * resized or reflowed.
 */
export const Offset = z.object({
  dx: z.number().min(-2000).max(2000),
  dy: z.number().min(-2000).max(2000),
})
export type Offset = z.infer<typeof Offset>

export const RGB = z.string().regex(/^#[0-9a-fA-F]{6}$/)

/**
 * A palette index resolves against the active theme, so theme changes recolour it. `series`
 * means "the colour of the series this belongs to" (e.g. error bars matching their points).
 */
export const ColorRef = z.union([
  z.object({ palette: z.number().int().min(0) }),
  z.object({ rgb: RGB }),
  z.object({ series: z.literal(true) }),
])
export type ColorRef = z.infer<typeof ColorRef>

export const StrokeStyle = z.object({
  color: ColorRef,
  width: Pt,
  dash: z.enum(['solid', 'dash', 'dot']),
})
export type StrokeStyle = z.infer<typeof StrokeStyle>

export const FillStyle = z.union([
  z.object({ type: z.literal('none') }),
  z.object({ type: z.literal('solid'), color: ColorRef, opacity: z.number().min(0).max(1) }),
])
export type FillStyle = z.infer<typeof FillStyle>

/**
 * An arrowhead at a line's end (layout lines, graph line annotations): a filled triangle, an open
 * V, a bar across the line (a tee) or a filled circle. `size` is relative to the default for the
 * line's width (1: `arrowSize` in the graph package).
 */
export const ArrowShape = z.enum(['triangle', 'open', 'bar', 'circle'])
export type ArrowShape = z.infer<typeof ArrowShape>

export const ArrowHead = z.object({
  shape: ArrowShape,
  size: z.number().min(0.25).max(5).optional(),
})
export type ArrowHead = z.infer<typeof ArrowHead>

/** The heads at a line's start and end; an absent end has none. */
export const LineEnds = z.object({ start: ArrowHead.optional(), end: ArrowHead.optional() })
export type LineEnds = z.infer<typeof LineEnds>

/**
 * Fonts are referenced by ID from the bundled set so text measurement is deterministic: Liberation
 * Sans, Serif, Mono and Sans Narrow (metric-compatible with Arial, Times New Roman, Courier New and
 * Arial Narrow).
 */
export const FontId = z.enum(['sans', 'serif', 'mono', 'narrow'])
export type FontId = z.infer<typeof FontId>

export const TextStyle = z.object({
  font: FontId,
  size: Pt,
  color: ColorRef,
  bold: z.boolean(),
  italic: z.boolean(),
})
export type TextStyle = z.infer<typeof TextStyle>

/**
 * A run of text in one format. `text` may hold line breaks ('\n') where a field is multi-line.
 * Absent fields take the element's `TextStyle`; `size` is in points (a script is 0.7 of it).
 */
export const TextRun = z.object({
  text: z.string(),
  sup: z.boolean().optional(),
  sub: z.boolean().optional(),
  italic: z.boolean().optional(),
  bold: z.boolean().optional(),
  underline: z.boolean().optional(),
  font: FontId.optional(),
  size: Pt.optional(),
  color: ColorRef.optional(),
})
export type TextRun = z.infer<typeof TextRun>

export const RichText = z.array(TextRun)
export type RichText = z.infer<typeof RichText>

/** How the lines of multi-line text line up (text boxes; titles are centred). */
export const TextAlign = z.enum(['left', 'center', 'right'])
export type TextAlign = z.infer<typeof TextAlign>

export const TextSpec = z.object({
  content: RichText,
  style: TextStyle.partial().optional(),
  /** Lines of text boxes (annotations, layout text): absent = left. Titles are always centred. */
  align: TextAlign.optional(),
})
export type TextSpec = z.infer<typeof TextSpec>

export const NumberDisplay = z.object({
  /**
   * auto: shortest clean form; fixed: `digits` decimals; scientific: 1.2e+3; power10: 1.2×10³
   * (10ⁿ on log axes); percent: value × 100 with a % sign.
   */
  mode: z.enum(['auto', 'fixed', 'scientific', 'power10', 'percent']),
  digits: z.number().int().min(0).max(15).optional(),
  /** Group thousands (1,000,000). */
  thousands: z.boolean().optional(),
  prefix: z.string().max(20).optional(),
  suffix: z.string().max(20).optional(),
})
export type NumberDisplay = z.infer<typeof NumberDisplay>

/** Convenience for building plain rich text. */
export const plainText = (text: string): RichText => [{ text }]

/** The characters of rich text without its formatting (line breaks as '\n'). */
export const richPlain = (rt: RichText | null | undefined): string =>
  (rt ?? []).map((r) => r.text).join('')

/** Whether two runs have the same format. */
export const sameFormat = (a: TextRun, b: TextRun): boolean =>
  !!a.sup === !!b.sup &&
  !!a.sub === !!b.sub &&
  !!a.underline === !!b.underline &&
  a.bold === b.bold &&
  a.italic === b.italic &&
  a.font === b.font &&
  a.size === b.size &&
  sameColor(a.color, b.color)

/** Whether two colour references are the same (both absent included). */
export const sameColor = (a: ColorRef | undefined, b: ColorRef | undefined): boolean =>
  a === b || (!!a && !!b && JSON.stringify(a) === JSON.stringify(b))

/** Whether any run is formatted (anything a plain string can't say). */
export const isFormatted = (rt: RichText): boolean =>
  rt.some(
    (r) =>
      r.text !== '' &&
      (r.sup ||
        r.sub ||
        r.underline ||
        r.bold !== undefined ||
        r.italic !== undefined ||
        r.font !== undefined ||
        r.size !== undefined ||
        r.color !== undefined),
  )

/** Rich text without empty runs, adjacent runs of the same format merged. */
export function mergeRuns(rt: RichText): RichText {
  const out: TextRun[] = []
  for (const r of rt) {
    if (r.text === '') continue
    const last = out[out.length - 1]
    if (last && sameFormat(last, r)) out[out.length - 1] = { ...last, text: last.text + r.text }
    else out.push({ ...r })
  }
  return out
}

/**
 * Text that may be formatted (a bracket's manual label, a point's label, a function's legend
 * title): a plain string, or runs when formatted. Older files hold strings.
 */
export const RichLabel = z.union([z.string(), RichText])
export type RichLabel = z.infer<typeof RichLabel>

/** A label as runs. */
export const labelRuns = (l: RichLabel | null | undefined): RichText =>
  typeof l === 'string' ? [{ text: l }] : (l ?? [])

/** A label's plain text. */
export const labelPlain = (l: RichLabel | null | undefined): string =>
  typeof l === 'string' ? l : richPlain(l)

/** What to store for typed rich text: a string when it is plain, else its merged runs. */
export const toLabel = (rt: RichText): RichLabel =>
  isFormatted(rt) ? mergeRuns(rt) : richPlain(rt)

/**
 * A table title (data set, X, row or subcolumn) as runs: its rich form (`titleRich` and the like)
 * when there is one that still spells the plain title, else the plain title. Plain edits leave the
 * rich form stale, so a mismatch means it no longer applies.
 */
export function titleRuns(title: string, rich: RichText | null | undefined): RichText {
  return rich && richPlain(rich) === title ? rich : [{ text: title }]
}

/** The rich form to store beside a title typed as `rt`: its runs when formatted, else nothing. */
export const richTitleOf = (rt: RichText | null | undefined): RichText | undefined =>
  rt && isFormatted(rt) ? mergeRuns(rt) : undefined
