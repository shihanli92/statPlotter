import { z } from 'zod'
import { Pt, RichLabel, StrokeStyle, TextStyle } from './style.ts'

// Axis extras (roadmap 36): what an axis may carry besides its ticks — a +/− treatment grid and
// labels spanning groups of categories under a category axis; set lengths of a broken axis'
// pieces and the marks at its breaks; ticks at listed values and text at values; a scale bar. All
// optional: an axis without them draws exactly as before.

/**
 * A category's key on a category axis (decision 511): a series key (a data set's id, a level's
 * key `lv_…`) for a slot of a category frame or a bar of a group; `@<row>` for a group of a
 * grouped table's rows (its table row, kept in step with row edits); `<group>/<series>` for a bar
 * within a group (the group's key, then the bar's data set or level). Never a position, so cells
 * and spans keep their categories through reordering, slices and new categories.
 */
export const CategoryKey = z.string().min(1).max(400)
export type CategoryKey = z.infer<typeof CategoryKey>

/** A grouped table's group (table row `row`) as a category key. */
export const rowCategoryKey = (row: number): string => `@${row}`
/** The table row of a group's category key, or null for other keys. */
export function rowOfCategoryKey(key: string): number | null {
  const m = /^@(\d+)$/.exec(key)
  return m ? Number(m[1]) : null
}
/** A bar within a group as a category key. */
export const barCategoryKey = (group: string, series: string): string => `${group}/${series}`
/** A category key's parts: a bar's group and series, else the key alone. */
export function categoryKeyParts(key: string): { group: string; series?: string } {
  const i = key.indexOf('/')
  return i < 0 ? { group: key } : { group: key.slice(0, i), series: key.slice(i + 1) }
}

/** What a treatment grid's cell holds: '+', '-' (drawn as the grid's symbols), '' or any text. */
export const TreatmentCell = z.string().max(40)

/** A row of a treatment grid: its title ("TNF") and a cell per category, by category key. */
export const TreatmentRow = z.object({
  title: RichLabel,
  cells: z.record(CategoryKey, TreatmentCell),
})
export type TreatmentRow = z.infer<typeof TreatmentRow>

/** How a grid draws its '+' and '-' cells (other text as typed). */
export const TreatmentSymbols = z.enum(['plusMinus', 'dots', 'check'])
export type TreatmentSymbols = z.infer<typeof TreatmentSymbols>

/**
 * A +/− treatment grid under a category axis (roadmap 36, decision 510): rows of treatments, a
 * cell per category ('+', '-', blank or short text), row titles beside them, part of the axis'
 * depth (the graph grows for it, exports include it).
 */
export const TreatmentGrid = z.object({
  rows: z.array(TreatmentRow).max(24),
  /** Absent: shown. */
  show: z.boolean().optional(),
  /** Grouped frames: a cell per group (absent) or per bar within the groups. */
  by: z.enum(['group', 'bar']).optional(),
  /** '+' and '-' drawn as + / − (absent), ● / ○, or ✓ / blank. */
  symbols: TreatmentSymbols.optional(),
  /** Font of the cells and row titles (absent: the axis' tick labels'). */
  text: TextStyle.partial().optional(),
  /** Distance between rows' baselines (pt; absent: the text's line height + 2). */
  rowSpacing: Pt.optional(),
  /** Lines between the rows (absent: none). */
  lines: StrokeStyle.optional(),
  /** Row titles before the first category (absent: left / top) or after the last. */
  titles: z.enum(['start', 'end']).optional(),
  /** The category names: hidden while the grid shows (absent) or kept above it. */
  names: z.enum(['hidden', 'above']).optional(),
})
export type TreatmentGrid = z.infer<typeof TreatmentGrid>

/** A label spanning categories (by key; a group's key spans its bars), on a level of spans. */
export const CategorySpan = z.object({
  label: RichLabel,
  keys: z.array(CategoryKey).min(1).max(1000),
  /** 1: the first row under the category names; absent: the row after the data's spans. */
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
})
export type CategorySpan = z.infer<typeof CategorySpan>

/**
 * Labels spanning groups of categories under a category axis (roadmap 36, decision 512): from the
 * data (a grouped graph's groups spanning their bars, the bars named by their data sets or
 * levels), renamed by key, and spans typed by hand; a line, bracket or nothing over each.
 */
export const CategorySpans = z.object({
  /** Absent: shown. */
  show: z.boolean().optional(),
  /** The data's spans (absent: true): a grouped graph's groups over its bars. */
  auto: z.boolean().optional(),
  /** The data's spans renamed, by their key ('' hides one). */
  rename: z.record(CategoryKey, RichLabel).optional(),
  /** Spans typed by hand. */
  list: z.array(CategorySpan).max(200).optional(),
  /** What runs over each span's categories: a line (absent), a bracket (ticked ends) or nothing. */
  mark: z.enum(['line', 'bracket', 'none']).optional(),
  line: StrokeStyle.partial().optional(),
  text: TextStyle.partial().optional(),
  /** Space between the names (or the row above) and the spans' line (pt; absent 3). */
  gap: Pt.optional(),
})
export type CategorySpans = z.infer<typeof CategorySpans>

/** A piece of a broken axis: a fraction of the axis' length or points (decision 513). */
export const PieceLength = z.object({
  value: z.number().positive(),
  unit: z.enum(['fraction', 'pt']),
})
export type PieceLength = z.infer<typeof PieceLength>

/** Marks at an axis' breaks: '//' slanted strokes at both edges (absent), a zigzag, nothing. */
export const BreakMark = z
  .object({ style: z.enum(['slash', 'zigzag', 'gap']), size: Pt.max(36) })
  .partial()
export type BreakMark = z.infer<typeof BreakMark>

/**
 * Ticks at listed values (decision 514): major ticks at `major`, minor ones at `minor` (absent:
 * none); values the axis can't show (outside it, ≤ 0 on a log axis, in a break) are left out.
 */
export const TickValues = z.object({
  major: z.array(z.number()).max(500),
  minor: z.array(z.number()).max(5000).optional(),
})
export type TickValues = z.infer<typeof TickValues>

/** Text at a value of a continuous axis ("Monomer" at 1): the tick's label there. */
export const TickText = z.object({ value: z.number(), text: RichLabel })
export type TickText = z.infer<typeof TickText>

/** Where a scale bar sits: a corner of the plot, or starting at a data position. */
export const ScaleBarPlace = z.union([
  z.enum(['bottomLeft', 'bottomRight', 'topLeft', 'topRight']),
  z.object({ x: z.number(), y: z.number() }),
])
export type ScaleBarPlace = z.infer<typeof ScaleBarPlace>

/**
 * A scale bar along an axis (decision 516): `length` data units long ("10 µm", "1 day"), with a
 * label (absent: the length and the axis title's unit), in a corner of the plot (absent: bottom
 * right) or from a data position. Bars of X and Y in the same corner meet in an L.
 */
export const ScaleBar = z.object({
  length: z.number().positive(),
  label: RichLabel.optional(),
  place: ScaleBarPlace.optional(),
  /** Absent: shown. */
  show: z.boolean().optional(),
  /** Absent: 2 pt, the axis line's colour. */
  line: StrokeStyle.partial().optional(),
  /** Absent: the axis' tick labels'. */
  text: TextStyle.partial().optional(),
})
export type ScaleBar = z.infer<typeof ScaleBar>

/**
 * Corner arrows (decision 517, `GraphStyle.frame` 'arrows'): short L-shaped arrows from the plot's
 * corner with the axis titles beside them, no ticks or frame; their length a fraction of the
 * plot's side (absent: 0.2) or points.
 */
export const CornerArrows = z
  .object({
    length: z.number().positive(),
    unit: z.enum(['fraction', 'pt']),
    corner: z.enum(['bottomLeft', 'bottomRight', 'topLeft', 'topRight']),
    line: StrokeStyle.partial(),
  })
  .partial()
export type CornerArrows = z.infer<typeof CornerArrows>
