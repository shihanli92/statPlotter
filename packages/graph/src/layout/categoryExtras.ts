import {
  type AxisSpec,
  type CategorySpans,
  categoryKeyParts,
  labelRuns,
  type RichText,
  richPlain,
  type TextStyle,
  type TreatmentGrid,
} from '@ps/model'
import type { FontRegistry } from '../fonts/registry.ts'
import type { Box, SceneNode, Stroke } from '../scene.ts'
import { layoutText } from '../text/layout.ts'
import { graphText, resolveColor, resolveStroke, type Theme } from '../theme.ts'
import type { GraphContext, Orientation } from './common.ts'
import { type HAnchor, placeText, type VAnchor } from './text.ts'

// Roadmap 36: what a category axis carries beyond its names — a +/− treatment grid (rows of
// treatments, a cell per category) and labels spanning groups of categories (two-level category
// labels). Every frame with a category axis (category and grouped frames, vertical or turned)
// hands its categories' places to the axis plan (`CategoryLayout`); the plan sizes and draws the
// extras outward from the names, before the axis title, so the graph grows for them and exports
// include them. Cells and spans name categories by key (`CategoryKey`), never by position.

/** A category (or a bar within a group) along the axis: plot-local, along the axis. */
export interface CategorySlot {
  key: string
  title: RichText
  from: number
  to: number
  center: number
}

/** The categories a frame draws along its category axis. */
export interface CategoryLayout {
  /** Category frames: a slot per data set (or level); grouped frames: a group per row (level). */
  groups: CategorySlot[]
  /** Grouped frames: each group's bars side by side (empty when they sit at the centre). */
  bars: (CategorySlot & { group: string })[]
}

/** Distances (pt): between names and the extras, a grid's cells' padding, spans' parts. */
export const EXTRAS = {
  gap: 4,
  cellPad: 3,
  titleGap: 6,
  spanGap: 3,
  spanTick: 3,
  spanInset: 2,
  textGap: 2,
} as const

/** Maps a place along the axis and a distance out from its line to graph coordinates. */
export type AxisPoint = (along: number, out: number) => [number, number]

/** A category axis' extras, sized: drawn from distance `d0` out of the axis line. */
export interface CategoryExtras {
  /** How far they reach out beyond where they start. */
  depth: number
  /** How far row titles reach beyond the plot's start and end along the axis. */
  overhang: [number, number]
  /** Ticks and names at these places instead of the categories' (a grouped graph's bars). */
  ticks?: { pos: number; content: RichText }[]
  /** The names hidden under a grid. */
  hideNames: boolean
  draw(at: AxisPoint, d0: number, target: (string | number)[]): SceneNode[]
}

/** Whether a grid or spans are shown on a categorical axis spec. */
const gridOf = (spec: AxisSpec): TreatmentGrid | undefined =>
  spec.type === 'categorical' && spec.treatments?.show !== false && spec.treatments?.rows.length
    ? spec.treatments
    : undefined
const spansOf = (spec: AxisSpec): CategorySpans | undefined =>
  spec.type === 'categorical' && spec.spans && spec.spans.show !== false ? spec.spans : undefined

/** A '+' or '-' cell (the minus as typed: hyphen, or the Unicode minus or dashes). */
const sign = (cell: string): '+' | '-' | null => {
  const t = cell.trim()
  if (t === '+') return '+'
  if (t === '-' || t === '−' || t === '–' || t === '—') return '-'
  return null
}

/** A span to draw: its place along the axis, its label and its level (1: nearest the names). */
interface PlacedSpan {
  from: number
  to: number
  label: RichText
  level: number
}

/** The spans of a category axis: from the data (groups over their bars), then typed ones. */
export function categorySpans(spans: CategorySpans, layout: CategoryLayout): PlacedSpan[] {
  const out: PlacedSpan[] = []
  const auto = spans.auto !== false && layout.bars.length > 0
  if (auto)
    for (const g of layout.groups) {
      const renamed = spans.rename?.[g.key]
      const bars = layout.bars.filter((b) => b.group === g.key)
      if (!bars.length) continue
      out.push({
        from: Math.min(...bars.map((b) => b.from)),
        to: Math.max(...bars.map((b) => b.to)),
        label: renamed === undefined ? g.title : labelRuns(renamed),
        level: 1,
      })
    }
  const extent = (key: string): [number, number] | null => {
    const g = layout.groups.find((s) => s.key === key)
    if (g) {
      const bars = layout.bars.filter((b) => b.group === key)
      return bars.length
        ? [Math.min(...bars.map((b) => b.from)), Math.max(...bars.map((b) => b.to))]
        : [g.from, g.to]
    }
    const b = layout.bars.find((s) => s.key === key)
    if (b) return [b.from, b.to]
    // A bar's key naming a group's series where bars sit at the centre: the group.
    const { group, series } = categoryKeyParts(key)
    if (series !== undefined && !layout.bars.length) {
      const og = layout.groups.find((s) => s.key === group)
      if (og) return [og.from, og.to]
    }
    return null
  }
  for (const span of spans.list ?? []) {
    const parts = span.keys.map(extent).filter((e): e is [number, number] => !!e)
    if (!parts.length) continue
    out.push({
      from: Math.min(...parts.map((p) => p[0])),
      to: Math.max(...parts.map((p) => p[1])),
      label: labelRuns(span.label),
      level: span.level ?? (auto ? 2 : 1),
    })
  }
  return out
}

/** The slots a grid has cells for: bars (grid by bar, bars side by side), else the groups. */
export function gridSlots(grid: TreatmentGrid, layout: CategoryLayout): CategorySlot[] {
  return grid.by === 'bar' && layout.bars.length ? layout.bars : layout.groups
}

/**
 * The extras of a category axis drawn along `which` ('x': under the plot; 'y': down the left,
 * categories from the top), or null when it has none. With spans from the data on a grouped
 * graph, the names under the axis are the bars' (each data set or level under its bar).
 */
export function categoryExtras(
  ctx: GraphContext,
  theme: Theme,
  palette: readonly string[],
  spec: AxisSpec,
  which: Orientation,
  layout: CategoryLayout,
): CategoryExtras | null {
  const grid = gridOf(spec)
  const spans = spansOf(spec)
  if (!grid && !spans) return null
  const { fonts, graph } = ctx
  const base = spec.tickLabels
  const across = which === 'x'
  const ticks =
    spans && spans.auto !== false && layout.bars.length
      ? layout.bars.map((b) => ({ pos: b.center, content: b.title }))
      : undefined

  // --- The grid: its rows (across X) or columns (down the left) ---------------------------------
  const gridText = grid ? graphText(theme.tickLabel, graph, { ...base, ...grid.text }) : null
  const slots = grid ? gridSlots(grid, layout) : []
  const lineH = gridText ? lineHeight(fonts, gridText) : 0
  const rowSize = (row: TreatmentGrid['rows'][number]): number => {
    if (!grid || !gridText) return 0
    if (across) return grid.rowSpacing ?? lineH + EXTRAS.cellPad
    const widths = slots.map((s) => cellWidth(fonts, row.cells[s.key] ?? '', gridText))
    return Math.max(lineH, ...widths) + 2 * EXTRAS.cellPad
  }
  const sizes = grid ? grid.rows.map(rowSize) : []
  const gridDepth = sizes.reduce((a, b) => a + b, 0)
  const titleAt = grid?.titles === 'end' ? 'end' : 'start'
  const titleExtent = (row: TreatmentGrid['rows'][number]) =>
    gridText ? layoutText(fonts, labelRuns(row.title), gridText).width : 0
  const titlesReach = grid ? Math.max(0, ...grid.rows.map(titleExtent)) : 0
  const first = Math.min(...slots.map((s) => s.from))
  const last = Math.max(...slots.map((s) => s.to))
  const length = Math.max(0, ...layout.groups.map((g) => g.to))
  const overhang: [number, number] = [0, 0]
  if (grid && titlesReach > 0) {
    if (titleAt === 'start') overhang[0] = Math.max(0, titlesReach + EXTRAS.titleGap - first)
    else overhang[1] = Math.max(0, last + EXTRAS.titleGap + titlesReach - length)
  }

  // --- Spans, level by level --------------------------------------------------------------------
  const spanText = spans ? graphText(theme.tickLabel, graph, { ...base, ...spans.text }) : null
  const placed = spans ? categorySpans(spans, layout) : []
  const levels = [...new Set(placed.map((s) => s.level))].sort((a, b) => a - b)
  const markOf = spans?.mark ?? 'line'
  const spanStroke: Stroke | null =
    spans && markOf !== 'none'
      ? resolveStroke({ ...theme.axisLine, width: 0.75, ...spec.line, ...spans.line }, palette)
      : null
  const gap = spans?.gap ?? EXTRAS.spanGap
  const levelSize = (level: number): number => {
    if (!spanText) return 0
    const mark = spanStroke ? spanStroke.width + EXTRAS.textGap : 0
    const labels = placed.filter((s) => s.level === level)
    const h = lineHeight(fonts, spanText)
    const extent = across
      ? h
      : Math.max(0, ...labels.map((s) => layoutText(fonts, s.label, spanText).width))
    return gap + mark + extent
  }
  const levelSizes = levels.map(levelSize)
  const spansDepth = levelSizes.reduce((a, b) => a + b, 0)
  const depth = (grid ? gridDepth : 0) + (grid && levels.length ? EXTRAS.gap : 0) + spansDepth

  return {
    depth,
    overhang,
    ticks,
    hideNames: !!grid && grid.names !== 'above',
    draw(at, d0, target) {
      const nodes: SceneNode[] = []
      let d = d0
      if (grid && gridText) {
        const gt = [...target, 'treatments']
        const color = resolveColor(gridText.color, palette)
        const lines = grid.lines ? resolveStroke(grid.lines, palette) : null
        grid.rows.forEach((row, ri) => {
          const size = sizes[ri]!
          const mid = d + size / 2
          if (lines && ri > 0)
            nodes.push(segment(`axis/treatments/line/${ri}`, gt, at, first, last, d, lines))
          slots.forEach((s) => {
            const cell = row.cells[s.key] ?? ''
            const id = `axis/treatments/${ri}/${s.key}`
            nodes.push(
              ...cellNodes(
                ctx.fonts,
                id,
                gt,
                cell,
                grid,
                gridText,
                palette,
                color,
                at(s.center, mid),
                // Roadmap 41: across X a text cell keeps to its category's width.
                across ? s.to - s.from - EXTRAS.cellPad : undefined,
              ),
            )
          })
          const title = labelRuns(row.title)
          if (richPlain(title)) {
            const p = titleAt === 'start' ? first - EXTRAS.titleGap : last + EXTRAS.titleGap
            const [x, y] = at(p, mid)
            const anchor: [HAnchor, VAnchor] = across
              ? [titleAt === 'start' ? 'end' : 'start', 'middle']
              : [titleAt === 'start' ? 'start' : 'end', 'middle']
            nodes.push(
              placeText(
                ctx.fonts,
                `axis/treatments/${ri}/title`,
                title,
                gridText,
                palette,
                x,
                y,
                anchor[0],
                anchor[1],
                {
                  target: gt,
                  ...(across ? {} : { angle: -90 }),
                },
              ).node,
            )
          }
          d += size
        })
        if (levels.length) d += EXTRAS.gap
      }
      if (spans && spanText) {
        const st = [...target, 'spans']
        levels.forEach((level, li) => {
          const size = levelSizes[li]!
          const lineAt = d + gap
          placed
            .filter((s) => s.level === level)
            .forEach((s, si) => {
              const id = `axis/spans/${level}/${si}`
              const [a, b] = [s.from + EXTRAS.spanInset, s.to - EXTRAS.spanInset]
              if (spanStroke && b > a) {
                nodes.push(segment(`${id}/line`, st, at, a, b, lineAt, spanStroke))
                if (markOf === 'bracket')
                  for (const [k, p] of [a, b].entries()) {
                    const [x1, y1] = at(p, lineAt)
                    const [x2, y2] = at(p, lineAt - EXTRAS.spanTick)
                    nodes.push({
                      id: `${id}/tick/${k}`,
                      target: st,
                      prim: { type: 'line', x1, y1, x2, y2, stroke: spanStroke },
                    })
                  }
              }
              if (!richPlain(s.label)) return
              const out = lineAt + (spanStroke ? spanStroke.width + EXTRAS.textGap : 0)
              const [x, y] = at((s.from + s.to) / 2, out)
              nodes.push(
                placeText(
                  ctx.fonts,
                  `${id}/label`,
                  s.label,
                  spanText,
                  palette,
                  x,
                  y,
                  across ? 'middle' : 'end',
                  across ? 'top' : 'middle',
                  {
                    target: st,
                  },
                ).node,
              )
            })
          d += size
        })
      }
      return nodes
    },
  }
}

/** A line along the axis from `a` to `b` at distance `d` out. */
function segment(
  id: string,
  target: (string | number)[],
  at: AxisPoint,
  a: number,
  b: number,
  d: number,
  stroke: Stroke,
): SceneNode {
  const [x1, y1] = at(a, d)
  const [x2, y2] = at(b, d)
  return { id, target, prim: { type: 'line', x1, y1, x2, y2, stroke } }
}

/** A line's height in a text style (ascent + descent of a probe). */
function lineHeight(fonts: FontRegistry, style: TextStyle): number {
  const t = layoutText(fonts, [{ text: 'Mg' }], style)
  return t.ascent + t.descent
}

/** A cell's width as drawn (signs as their symbols: about a line's height). */
function cellWidth(fonts: FontRegistry, cell: string, style: TextStyle): number {
  if (sign(cell)) return lineHeight(fonts, style) * 0.7
  return cell.trim() ? layoutText(fonts, [{ text: cell.trim() }], style).width : 0
}

/**
 * Roadmap 41 (decision 623): a text cell wider than its category is cut to fit, whole characters
 * and an ellipsis, so it never runs into its neighbours (the full text stays in the grid's
 * editor); text that fits is drawn as typed.
 */
export function fitted(fonts: FontRegistry, text: string, style: TextStyle, room: number): string {
  const width = (t: string) => layoutText(fonts, [{ text: t }], style).width
  if (width(text) <= room) return text
  const chars = [...text]
  const cut = (n: number) => `${chars.slice(0, n).join('').trimEnd()}…`
  let lo = 0
  let hi = chars.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (width(cut(mid)) <= room) lo = mid
    else hi = mid - 1
  }
  return cut(lo)
}

/** A grid cell: '+' / '−' as text, ● / ○ or ✓ / nothing as shapes, other text as typed. */
function cellNodes(
  fonts: FontRegistry,
  id: string,
  target: (string | number)[],
  cell: string,
  grid: TreatmentGrid,
  style: TextStyle,
  palette: readonly string[],
  color: string,
  [x, y]: [number, number],
  room?: number,
): SceneNode[] {
  const s = sign(cell)
  const size = style.size
  if (s && grid.symbols === 'dots') {
    const d = size * 0.55
    return [
      {
        id,
        target,
        prim: {
          type: 'symbol',
          shape: 'circle',
          cx: x,
          cy: y,
          size: d,
          stroke: { color, width: Math.max(0.5, size / 14), dash: 'solid' },
          fill: s === '+' ? { color, opacity: 1 } : null,
        },
      },
    ]
  }
  if (s && grid.symbols === 'check') {
    if (s === '-') return []
    const k = size * 0.32
    return [
      {
        id,
        target,
        prim: {
          type: 'polyline',
          points: [
            [x - k, y],
            [x - k * 0.25, y + k * 0.75],
            [x + k, y - k * 0.85],
          ],
          stroke: { color, width: Math.max(0.75, size / 10), dash: 'solid' },
        },
      },
    ]
  }
  const typed = s === '+' ? '+' : s === '-' ? '−' : cell.trim()
  if (!typed) return []
  const text = !s && room !== undefined ? fitted(fonts, typed, style, room) : typed
  const placed = placeText(fonts, id, [{ text }], style, palette, x, y, 'middle', 'middle', {
    target,
  })
  return [{ ...placed.node, bbox: placed.bbox as Box }]
}
