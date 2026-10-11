import { z } from 'zod'
import { ColorMapName, SymbolShape } from './graph.ts'
import { Dash, FontId, Pt, RGB, TextStyle } from './style.ts'

// Styles (roadmap 37): a named set of graph defaults — fonts and sizes per role, line weights,
// symbol size, bar fill, palettes, axis look, P values, legend placement and figure column widths
// — that graphs take wherever they don't set a value themselves. Plain data, every field optional
// (a style may say only what it changes). The app's own look is the empty style ("Default").
//
// Precedence (decision 531): a value set in the graph itself (an explicit field in the document)
// > the graph's own style (`GraphNode.theme`) > the project's style (`ProjectSettings.style`)
// > the app's defaults. Styles are resolved into the graph package's theme (`themeOf`).

/** P-value formats (as `ProjectSettings.pValueStyle`). */
export const PValueStyle = z.enum(['GP', 'APA', 'NEJM'])
export type PValueStyle = z.infer<typeof PValueStyle>

/** A role's text: any of font, size, colour, bold, italic. */
export const StyleText = TextStyle.partial()
export type StyleText = z.infer<typeof StyleText>

/** The text roles a style sets, in the order the Style editor shows them. */
export const STYLE_TEXT_ROLES = [
  'title',
  'axisTitle',
  'tickLabel',
  'legend',
  'annotation',
  'bracket',
  'resultLabel',
] as const
export type StyleTextRole = (typeof STYLE_TEXT_ROLES)[number]

/** The line roles a style sets (widths in points). */
export const STYLE_LINE_ROLES = [
  'axis',
  'tick',
  'errorBar',
  'dataLine',
  'barOutline',
  'bracket',
] as const
export type StyleLineRole = (typeof STYLE_LINE_ROLES)[number]

const Width = Pt.max(20)

export const FigureStyle = z.object({
  /** Shown in menus and the Style editor. */
  name: z.string().max(120).optional(),
  description: z.string().max(2000).optional(),
  /** The font of every text (a role's own font wins). */
  font: FontId.optional(),
  /** Text per role: the graph title, axis titles, tick labels, legend, text annotations and
   * labels of results and points, bracket labels. */
  text: z
    .object({
      title: StyleText,
      axisTitle: StyleText,
      tickLabel: StyleText,
      legend: StyleText,
      annotation: StyleText,
      bracket: StyleText,
      resultLabel: StyleText,
    })
    .partial()
    .optional(),
  /** Line widths per role (points): axes, ticks, error bars, data lines, bar outlines, brackets. */
  lines: z
    .object({
      axis: Width,
      tick: Width,
      errorBar: Width,
      dataLine: Width,
      barOutline: Width,
      bracket: Width,
    })
    .partial()
    .optional(),
  /** Symbols' size (points) on every graph. */
  symbolSize: Pt.min(0.5).max(60).optional(),
  /** Bars' (and boxes') fill opacity. */
  barFillOpacity: z.number().min(0).max(1).optional(),
  /** The categorical colours, in order (data sets and levels take them in turn). */
  palette: z.array(RGB).min(1).max(64).optional(),
  /**
   * Roadmap 49a: the symbols and line patterns data sets take in turn where a layer's shape or
   * dash is the data set's (as their colours take the palette's), each list as a whole.
   */
  shapes: z.array(SymbolShape).min(1).max(24).optional(),
  dashes: z.array(Dash).min(1).max(12).optional(),
  /** The default colour map of continuous colour (heat maps, densities, colour by a number). */
  colorMap: ColorMapName.optional(),
  /** Axis look: continuous axes touching or offset at the origin; tick marks. */
  axes: z
    .object({
      frame: z.enum(['plain', 'offset']),
      tickDirection: z.enum(['out', 'in', 'cross', 'none']),
      tickLength: Pt.max(36),
      minorTickLength: Pt.max(36),
    })
    .partial()
    .optional(),
  /** P values (a project setting: applied with the project's style, decision 534). */
  pValue: z
    .object({ style: PValueStyle, digits: z.number().int().min(1).max(15) })
    .partial()
    .optional(),
  /** Where new graphs' legends go. */
  legend: z
    .object({ position: z.enum(['right', 'top', 'inside']) })
    .partial()
    .optional(),
  /** A journal's figure widths (points), for Fit to column. */
  columns: z
    .object({
      single: Pt.min(36).max(2000),
      oneAndHalf: Pt.min(36).max(2000),
      double: Pt.min(36).max(2000),
    })
    .partial()
    .optional(),
})
export type FigureStyle = z.infer<typeof FigureStyle>

/**
 * A style chosen for a project or a graph: which one (a built-in's id or `user:<name>`, for menus
 * and provenance) and its values, copied in so the file looks the same anywhere.
 */
export const StyleChoice = z.object({ id: z.string().min(1).max(200), style: FigureStyle })
export type StyleChoice = z.infer<typeof StyleChoice>

/** Points per millimetre. */
export const PT_PER_MM = 72 / 25.4
const mm = (v: number) => Math.round(v * PT_PER_MM * 100) / 100

/** The id of the app's own look (the empty style). */
export const DEFAULT_STYLE_ID = 'default'

const journal = (
  size: { title: number; axisTitle: number; tick: number; other: number },
  lines: { axis: number; data: number },
): FigureStyle => ({
  font: 'sans',
  text: {
    title: { size: size.title, bold: true },
    axisTitle: { size: size.axisTitle, bold: false },
    tickLabel: { size: size.tick },
    legend: { size: size.other },
    annotation: { size: size.other },
    bracket: { size: size.other },
    resultLabel: { size: size.other },
  },
  lines: {
    axis: lines.axis,
    tick: lines.axis,
    errorBar: lines.axis,
    dataLine: lines.data,
    barOutline: lines.axis,
    bracket: lines.axis,
  },
  symbolSize: 3.5,
  axes: { frame: 'plain', tickDirection: 'out', tickLength: 2.5, minorTickLength: 1.5 },
})

const NOT_ENDORSED =
  'Approximate: check the journal’s current figure guidelines. Not affiliated with or endorsed by the journal.'

/**
 * The built-in styles (decision 532): the app's own look, unchanged, and four sized after
 * journals' published figure guidelines as we understand them (from memory, not checked against
 * the current pages; descriptive names, never the journals' branding).
 */
export const BUILTIN_STYLES: readonly StyleChoice[] = [
  {
    id: DEFAULT_STYLE_ID,
    style: {
      name: 'Default',
      description: 'The app’s own look: 11–14 pt text, 1 pt lines, 6 pt symbols.',
    },
  },
  {
    id: 'journal-nature',
    style: {
      ...journal({ title: 8, axisTitle: 7, tick: 6, other: 6 }, { axis: 0.5, data: 0.75 }),
      name: 'Journal: Nature-style (7 pt, 89/183 mm)',
      description: `Sans-serif text of 5–7 pt, lines of 0.25–1 pt; single and double columns of 89 and 183 mm (1.5 columns about 120 mm). ${NOT_ENDORSED}`,
      columns: { single: mm(89), oneAndHalf: mm(120), double: mm(183) },
    },
  },
  {
    id: 'journal-cell',
    style: {
      ...journal({ title: 8, axisTitle: 7, tick: 6, other: 6 }, { axis: 0.5, data: 0.75 }),
      name: 'Journal: Cell-style (7 pt, 85/174 mm)',
      description: `Sans-serif text of 6–8 pt, lines of 0.5–1 pt; columns of 85, 114 (1.5) and 174 mm. ${NOT_ENDORSED}`,
      columns: { single: mm(85), oneAndHalf: mm(114), double: mm(174) },
    },
  },
  {
    id: 'journal-science',
    style: {
      ...journal({ title: 8, axisTitle: 7, tick: 7, other: 7 }, { axis: 0.5, data: 1 }),
      name: 'Journal: Science-style (7 pt, 55/120/183 mm)',
      description: `Sans-serif text of about 7 pt, lines of 0.5–1 pt; one, two and three columns of 55, 120 and 183 mm. ${NOT_ENDORSED}`,
      columns: { single: mm(55), oneAndHalf: mm(120), double: mm(183) },
    },
  },
  {
    id: 'journal-pnas',
    style: {
      ...journal({ title: 8, axisTitle: 7, tick: 6, other: 6 }, { axis: 0.5, data: 0.75 }),
      name: 'Journal: PNAS-style (7 pt, 87/178 mm)',
      description: `Sans-serif text of 6–8 pt, lines of at least 0.5 pt; columns of 87, 114 (1.5) and 178 mm. ${NOT_ENDORSED}`,
      columns: { single: mm(87), oneAndHalf: mm(114), double: mm(178) },
    },
  },
]

/** A built-in style by id. */
export const builtinStyle = (id: string): StyleChoice | undefined =>
  BUILTIN_STYLES.find((s) => s.id === id)

/** The id of a user style of this name. */
export const userStyleId = (name: string) => `user:${name}`

/** A style choice's name for menus: the style's own, else its id. */
export const styleName = (c: Pick<StyleChoice, 'id' | 'style'>): string =>
  c.style.name ?? (c.id.startsWith('user:') ? c.id.slice(5) : c.id)

/** Fields of `b` over `a` (both partial objects; nothing undefined is kept). */
function over<T extends object>(a: T | undefined, b: T | undefined): T | undefined {
  if (!a) return b
  if (!b) return a
  const out = { ...a } as Record<string, unknown>
  for (const [k, v] of Object.entries(b)) if (v !== undefined) out[k] = v
  return out as T
}

/**
 * Styles layered, the later over the earlier, field by field (a role's text by its fields; a
 * palette as a whole). Name and description are the last one's.
 */
export function mergeStyles(...styles: (FigureStyle | undefined)[]): FigureStyle {
  let out: FigureStyle = {}
  for (const s of styles) {
    if (!s) continue
    const text: NonNullable<FigureStyle['text']> = { ...out.text }
    for (const [role, t] of Object.entries(s.text ?? {}))
      text[role as StyleTextRole] = over(text[role as StyleTextRole], t)
    out = {
      ...out,
      ...Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined)),
      ...(s.text || out.text ? { text } : {}),
      ...(s.lines || out.lines ? { lines: over(out.lines, s.lines) } : {}),
      ...(s.axes || out.axes ? { axes: over(out.axes, s.axes) } : {}),
      ...(s.pValue || out.pValue ? { pValue: over(out.pValue, s.pValue) } : {}),
      ...(s.legend || out.legend ? { legend: over(out.legend, s.legend) } : {}),
      ...(s.columns || out.columns ? { columns: over(out.columns, s.columns) } : {}),
    }
  }
  return out
}

/** Whether a style sets nothing that draws (name and description aside): the app's own look. */
export const isEmptyStyle = (s: FigureStyle | undefined): boolean =>
  !s || Object.keys(s).every((k) => k === 'name' || k === 'description')
