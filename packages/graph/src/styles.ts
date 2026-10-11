import {
  type AxisSpec,
  effectiveStyle,
  type FigureStyle,
  type Geom,
  type GraphNode,
  isValueSourced,
  type Layer,
  type LayoutItem,
  type LayoutNode,
  mergeStyles,
  type NodeId,
  type ProjectSettings,
  statOf,
  styleRequired,
  type TextStyle,
} from '@ps/model'
import { layerStyle } from './layers/theme.ts'
import type { GraphContext } from './layout/common.ts'
import { layoutGraph } from './layout/dispatch.ts'
import { layoutPage } from './page.ts'
import type { Scene } from './scene.ts'
import { graphPalette, graphText, resolveBracketStyle, type Theme, themeOf } from './theme.ts'

// Styles on graphs (roadmap 37): applying a style keeps what the user set (decision 531), Reset
// to style clears it (decision 533), a graph's look saved as a style, and graphs fitted to a
// style's column widths (decision 535).
//
// "Set by the user" is an explicit value in the document: a style changes only what is absent.
// Two settings the document always holds — a continuous axis' frame (touching or offset) and the
// legend's place — are the user's when they differ from what the graph's style gives them; a
// style change moves those still at the old style's value to the new one's.

const NO_STYLE: FigureStyle = {}

// --- Reset to style ---------------------------------------------------------------------------

/**
 * Layer style fields a style sets (symbol size, line widths, bar and box fills), per geom. Audit 2
 * (G9, decision 664): the newer geoms too — censored ticks' and differences' size, pair lines'
 * and differences' line (error bars' width), outlines of ellipses and hulls, paths, vectors,
 * contour lines and the grand mean line (data lines' width). Areas' and bands' opacities and
 * densities' own colours (as a number variable's colours or a heat map's) are no style's.
 */
export const STYLED_LAYER_FIELDS: Partial<Record<Geom, readonly string[]>> = {
  points: ['size'],
  bar: ['fill', 'border'],
  box: ['fill', 'border'],
  violin: ['fill', 'border'],
  errorbar: ['line'],
  center: ['line'],
  line: ['stroke'],
  step: ['stroke'],
  censor: ['size'],
  connector: ['line'],
  difference: ['size', 'line'],
  refline: ['line'],
  polygon: ['border'],
  path: ['stroke'],
  segment: ['stroke'],
  contour: ['stroke'],
}

const TEXT_FIELDS = ['font', 'size', 'color', 'bold', 'italic'] as const

/** An object without some keys; undefined when nothing is left. */
function without<T extends object>(o: T | undefined, keys: readonly string[]): T | undefined {
  if (!o) return o
  const out = { ...o } as Record<string, unknown>
  for (const k of keys) delete out[k]
  return Object.keys(out).length ? (out as T) : undefined
}

/** Sets or removes a key (undefined removes it). */
function put<T extends object, K extends keyof T>(o: T, k: K, v: T[K] | undefined): T {
  const out = { ...o }
  if (v === undefined) delete out[k]
  else out[k] = v
  return out
}

function resetLayer(l: Layer): Layer {
  const fields = STYLED_LAYER_FIELDS[l.geom]
  // Result labels' text (roadmap 35) is the "result labels" role.
  const keys = l.geom === 'label' && isValueSourced(l) ? ['text'] : (fields ?? [])
  if (!keys.length) return l
  let out = put(l, 'style', without(l.style as Record<string, unknown>, keys) as never)
  if (l.series) {
    const series = Object.fromEntries(
      Object.entries(l.series).map(([k, s]) => [
        k,
        put(s, 'style', without(s.style as Record<string, unknown> | undefined, keys) as never),
      ]),
    )
    out = { ...out, series } as Layer
  }
  return out
}

/**
 * A graph with the user's own formatting of what styles set cleared (Reset to style, decision
 * 533): fonts and sizes of its titles, tick labels, legend, base text, text annotations and
 * bracket labels; axis and tick line widths, tick marks; bracket lines; the palette; symbol sizes,
 * line widths and bar fills of its layers; continuous axes' frame and the legend's place set to
 * the style's. Per-data-set colours, titles' wording, sizes and everything else stay.
 */
export function resetToStyle(
  graph: GraphNode,
  settings: Pick<ProjectSettings, 'theme' | 'style'>,
): GraphNode {
  const req = styleRequired(effectiveStyle(settings, graph))
  const axes = { ...graph.axes } as GraphNode['axes']
  for (const k of ['x', 'y', 'y2'] as const) {
    const a = axes[k]
    if (!a) continue
    let n = { ...a } as AxisSpec
    n = put(n, 'tickLabels', undefined)
    n = put(n, 'line', without(n.line, ['width']))
    n = put(n, 'tickStyle', without(n.tickStyle, ['width', 'length', 'minorLength', 'direction']))
    if (n.title) n = { ...n, title: put(n.title, 'style', without(n.title.style, TEXT_FIELDS)) }
    if (n.type === 'continuous') n = { ...n, frame: req.frame }
    ;(axes as Record<string, AxisSpec>)[k] = n
  }
  const bracket = graph.style.bracket
  // Roadmap 49a: the cycles of symbols and line patterns go with the palette.
  const style = put(
    put(put(put(graph.style, 'text', undefined), 'palette', undefined), 'shapes', undefined),
    'dashes',
    undefined,
  ) as GraphNode['style']
  const nextBracket = bracket
    ? without(
        {
          ...bracket,
          ...(bracket.line ? { line: without(bracket.line, ['width']) } : {}),
          ...(bracket.label ? { label: without(bracket.label, TEXT_FIELDS) } : {}),
        },
        [
          ...(bracket.line && !without(bracket.line, ['width']) ? ['line'] : []),
          ...(bracket.label && !without(bracket.label, TEXT_FIELDS) ? ['label'] : []),
        ],
      )
    : undefined
  const legendText = without(graph.legend.text, TEXT_FIELDS)
  return {
    ...graph,
    axes,
    style: put(style, 'bracket', nextBracket),
    title: graph.title ? put(graph.title, 'style', without(graph.title.style, TEXT_FIELDS)) : null,
    legend: {
      ...put(graph.legend, 'text', legendText),
      position: graph.legend.position === 'inside' ? 'inside' : req.legend,
    },
    annotations: graph.annotations.map((a) =>
      a.type === 'text'
        ? { ...a, content: put(a.content, 'style', without(a.content.style, TEXT_FIELDS)) }
        : a,
    ),
    layers: graph.layers.map(resetLayer),
  }
}

/** Whether Reset to style would change the graph (it holds formatting a style sets). */
export const hasOwnFormatting = (
  graph: GraphNode,
  settings: Pick<ProjectSettings, 'theme' | 'style'>,
): boolean => JSON.stringify(resetToStyle(graph, settings)) !== JSON.stringify(graph)

// --- A graph's look as a style ---------------------------------------------------------------

const textOf = (t: TextStyle) => ({
  font: t.font,
  size: t.size,
  bold: t.bold,
  italic: t.italic,
  ...('rgb' in t.color ? { color: t.color } : {}),
})

/** The first layer of a geom, resolved (its layer style over the theme's defaults). */
function resolvedOf(theme: Theme, graph: GraphNode, geoms: readonly Geom[]) {
  const l = graph.layers.find((x) => geoms.includes(x.geom) && x.visible !== false)
  return l ? layerStyle(theme, graph, l, '', statOf(l, '')) : undefined
}

/**
 * The graph's look as a style ("Save this graph's look as a style…", decision 534): its fonts and
 * sizes per role, line widths, symbol size and bar fill as drawn (its own formats over its
 * style), its palette, colour map, axis look, legend place, the project's P values and its
 * style's column widths.
 */
export function styleFromGraph(
  graph: GraphNode,
  settings: Pick<ProjectSettings, 'theme' | 'style' | 'pValueStyle' | 'pValueDigits'>,
): FigureStyle {
  const base = effectiveStyle(settings, graph)
  const theme = themeOf(base ?? NO_STYLE)
  const y = graph.axes.y
  const x = graph.axes.x
  const yLine = { ...theme.axisLine, ...y.line }
  const ticks = y.tickStyle ?? {}
  const bracket = resolveBracketStyle(theme, graph)
  const points = resolvedOf(theme, graph, ['points'])
  const bars = resolvedOf(theme, graph, ['bar', 'box', 'violin'])
  const errors = resolvedOf(theme, graph, ['errorbar'])
  const lines = resolvedOf(theme, graph, ['line', 'step'])
  const continuous = [y, x].find((a) => a.type === 'continuous') as
    | Extract<AxisSpec, { type: 'continuous' }>
    | undefined
  const text = graph.annotations.find((a) => a.type === 'text')
  const own = graph.style.palette
  return mergeStyles(base, {
    font: graphText(theme.axisTitle, graph, y.title?.style).font,
    text: {
      title: textOf(graphText(theme.graphTitle, graph, graph.title?.style)),
      axisTitle: textOf(graphText(theme.axisTitle, graph, y.title?.style)),
      tickLabel: textOf(graphText(theme.tickLabel, graph, y.tickLabels)),
      legend: textOf(graphText(theme.legend, graph, graph.legend.text)),
      annotation: textOf(
        graphText(theme.text, graph, text?.type === 'text' ? text.content.style : undefined),
      ),
      bracket: textOf(bracket.label),
      resultLabel: textOf(graphText(theme.pointLabel, graph)),
    },
    lines: {
      axis: yLine.width,
      tick: ticks.width ?? theme.tickWidth ?? yLine.width,
      bracket: bracket.line.width,
      ...(errors ? { errorBar: errors.error.line.width } : {}),
      ...(lines ? { dataLine: lines.line.stroke.width } : {}),
      ...(bars ? { barOutline: bars.bar.border.width } : {}),
    },
    ...(points ? { symbolSize: points.points.size } : {}),
    ...(bars && bars.bar.fill.type === 'solid' && bars.bar.fill.opacity < 1
      ? { barFillOpacity: bars.bar.fill.opacity }
      : {}),
    palette: [...(own ?? graphPalette(graph, theme).slice(0, theme.palette.length))],
    // Roadmap 49a: the cycles of symbols and line patterns, when the graph or its style has them.
    ...((graph.style.shapes ?? theme.shapes)
      ? { shapes: [...(graph.style.shapes ?? theme.shapes)!] }
      : {}),
    ...((graph.style.dashes ?? theme.dashes)
      ? { dashes: [...(graph.style.dashes ?? theme.dashes)!] }
      : {}),
    ...(theme.colorMap ? { colorMap: theme.colorMap } : {}),
    axes: {
      ...(continuous ? { frame: continuous.frame } : {}),
      tickDirection: ticks.direction ?? theme.tickDirection,
      tickLength: ticks.length ?? theme.tickLength,
      minorTickLength: ticks.minorLength ?? theme.minorTickLength,
    },
    pValue: { style: settings.pValueStyle, digits: settings.pValueDigits },
    legend: { position: graph.legend.position },
  })
}

// --- Fit to column ------------------------------------------------------------------------------

/** Which of a style's column widths. */
export type ColumnWidth = 'single' | 'oneAndHalf' | 'double'

export const COLUMN_LABELS: Record<ColumnWidth, string> = {
  single: 'Single column',
  oneAndHalf: '1.5 columns',
  double: 'Double column',
}

/** When a style names no widths: the common ones (85, 114 and 174 mm). */
export const DEFAULT_COLUMNS: Record<ColumnWidth, number> = {
  single: (85 * 72) / 25.4,
  oneAndHalf: (114 * 72) / 25.4,
  double: (174 * 72) / 25.4,
}

/** A style's column width (points), else the common one. */
export const columnWidthOf = (style: FigureStyle | undefined, which: ColumnWidth): number =>
  style?.columns?.[which] ?? DEFAULT_COLUMNS[which]

/** What Fit to column keeps of the plot: its proportions, or its height. */
export type FitKeep = 'aspect' | 'height'

const PLOT_MIN = 18
const PLOT_MAX = 14_400

/**
 * A graph's size fitted to an overall width (points; decision 535): laid out at its scale 1
 * (`size.scale` dropped, so text, symbols and lines are at their point sizes), the plot widened
 * or narrowed until the whole graph — axes, labels, legend — is that wide; its height in the
 * plot's proportions (`aspect`) or kept (`height`). Margins depend a little on the plot's size
 * (tick labels), so the width is corrected a few times. A width narrower than the margins leaves
 * the smallest plot.
 */
export function fitToWidth(
  ctx: Omit<GraphContext, 'graph'> & { graph: GraphNode },
  width: number,
  keep: FitKeep,
): GraphNode['size'] {
  const g = ctx.graph
  const ratio = g.size.plotHeight / Math.max(g.size.plotWidth, 1e-9)
  const sizeOf = (w: number): GraphNode['size'] => ({
    plotWidth: w,
    plotHeight:
      keep === 'aspect' ? Math.min(PLOT_MAX, Math.max(PLOT_MIN, w * ratio)) : g.size.plotHeight,
  })
  const clamp = (v: number) => Math.min(PLOT_MAX, Math.max(PLOT_MIN, v))
  const at = (w: number): Scene => layoutGraph({ ...ctx, graph: { ...g, size: sizeOf(w) } })
  let w = clamp(g.size.plotWidth)
  let scene = at(w)
  let rate = 1
  for (let i = 0; i < 12 && Math.abs(scene.width - width) > 0.01; i++) {
    const next = clamp(w + (width - scene.width) / rate)
    if (next === w) break
    const s = at(next)
    const dp = next - w
    rate = Math.abs(dp) > 1e-6 ? Math.min(1.5, Math.max(0.25, (s.width - scene.width) / dp)) : 1
    w = next
    scene = s
  }
  const r = (v: number) => Math.round(v * 100) / 100
  const size = sizeOf(w)
  return { plotWidth: r(size.plotWidth), plotHeight: r(size.plotHeight) }
}

/** What fitting a page changes: the page, its items, and the sizes of the graphs on it. */
export interface PageFit {
  page: LayoutNode['page']
  items: LayoutItem[]
  /** Each graph's new size (scale dropped), by node id. */
  sizes: Map<NodeId, GraphNode['size']>
}

/**
 * A layout page fitted to a column (decision 535): the page made that wide, everything on it
 * placed in proportion (positions, text boxes' widths, lines, shapes and images scaled by the
 * widths' ratio, their text not), each graph drawn at scale 1 and resized (`fitToWidth`) to fill
 * the width its item took, so its fonts are at their point sizes. The page's height follows the
 * ratio. A graph placed twice is fitted to its first place.
 */
export function fitPageToWidth(
  ctx: Omit<GraphContext, 'graph'>,
  layout: LayoutNode,
  width: number,
  keep: FitKeep,
): PageFit {
  const f = width / layout.page.width
  const placed = layoutPage({ ...ctx, layout })
  const boxes = new Map(placed.items.map((b) => [b.id, b]))
  const sizes = new Map<NodeId, GraphNode['size']>()
  const s = (v: number) => Math.round(v * f * 100) / 100
  const items = layout.items.map((it): LayoutItem => {
    switch (it.type) {
      case 'graph': {
        const graph = ctx.project.nodes[it.graph]
        const box = boxes.get(it.id)
        if (graph?.kind === 'graph' && box && !sizes.has(graph.id))
          sizes.set(graph.id, fitToWidth({ ...ctx, graph }, box.w * f, keep))
        return { ...it, x: s(it.x), y: s(it.y), scale: 1 }
      }
      case 'text':
        return { ...it, x: s(it.x), y: s(it.y), ...(it.width ? { width: s(it.width) } : {}) }
      case 'line':
        return {
          ...it,
          from: { x: s(it.from.x), y: s(it.from.y) },
          to: { x: s(it.to.x), y: s(it.to.y) },
        }
      case 'shape':
      case 'image':
        return { ...it, x: s(it.x), y: s(it.y), w: s(it.w), h: s(it.h) }
      default:
        return { ...it, x: s(it.x), y: s(it.y) }
    }
  })
  return { page: { width, height: s(layout.page.height) }, items, sizes }
}
