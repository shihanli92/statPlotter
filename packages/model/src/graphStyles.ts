import {
  builtinStyle,
  DEFAULT_STYLE_ID,
  type FigureStyle,
  mergeStyles,
  type StyleChoice,
} from './figureStyle.ts'
import type { AxisSpec } from './graph.ts'
import type { GraphNode } from './layers.ts'
import type { ProjectSettings } from './project.ts'

// Styles of projects and graphs (roadmap 37): which style a graph takes, and the two settings
// every graph holds that a style gives (decision 531).
//
// "Set by the user" is an explicit value in the document: a style changes only what is absent.
// Two settings the document always holds — a continuous axis' frame (touching or offset) and the
// legend's place — are the user's when they differ from what the graph's style gives them; a
// style change moves those still at the old style's value to the new one's.

type StyleSettings = Pick<ProjectSettings, 'theme' | 'style'>

/**
 * A project's style: its values (`settings.style`), else a built-in named by `settings.theme`
 * (absent or 'default': none, the app's own look).
 */
export function projectStyleOf(settings: StyleSettings): FigureStyle | undefined {
  if (settings.style) return settings.style
  return settings.theme && settings.theme !== DEFAULT_STYLE_ID
    ? builtinStyle(settings.theme)?.style
    : undefined
}

const merged = new WeakMap<FigureStyle, WeakMap<FigureStyle, FigureStyle>>()

/** A graph's style: its own over its project's (each absent: the app's own look). */
export function effectiveStyle(
  settings: StyleSettings,
  graph?: { theme?: StyleChoice | undefined },
): FigureStyle | undefined {
  const p = projectStyleOf(settings)
  const g = graph?.theme?.style
  if (!g) return p
  if (!p) return g
  let inner = merged.get(p)
  if (!inner) {
    inner = new WeakMap()
    merged.set(p, inner)
  }
  let m = inner.get(g)
  if (!m) {
    m = mergeStyles(p, g)
    inner.set(g, m)
  }
  return m
}

/** What the graph's style gives its required axis frame and legend place. */
export function styleRequired(style: FigureStyle | undefined) {
  return {
    frame: style?.axes?.frame ?? 'plain',
    legend: style?.legend?.position ?? 'right',
  } as const
}

/** A graph's continuous axes (and the right one), by key. */
const axisKeys = (g: GraphNode) =>
  (['x', 'y', 'y2'] as const).filter((k) => g.axes[k]?.type === 'continuous')

/**
 * The graph's required, style-given settings moved from one style's value to another's where
 * the user left them at the old one's (decision 531): continuous axes' frame, the legend's place.
 */
export function moveRequired(
  g: GraphNode,
  from: FigureStyle | undefined,
  to: FigureStyle | undefined,
) {
  const a = styleRequired(from)
  const b = styleRequired(to)
  let out = g
  for (const k of axisKeys(g)) {
    const axis = out.axes[k] as Extract<AxisSpec, { type: 'continuous' }>
    if (axis.frame === a.frame && axis.frame !== b.frame)
      out = { ...out, axes: { ...out.axes, [k]: { ...axis, frame: b.frame } } }
  }
  if (out.legend.position === a.legend && a.legend !== b.legend)
    out = { ...out, legend: { ...out.legend, position: b.legend } }
  return out
}

/**
 * A graph given a style of its own (`choice`; null: the project's again), keeping everything the
 * user set: only `theme` changes, and the axis frames and legend place still at the old style's
 * values follow the new one.
 */
export function withGraphStyle(
  graph: GraphNode,
  settings: StyleSettings,
  choice: StyleChoice | null,
): GraphNode {
  const before = effectiveStyle(settings, graph)
  const { theme: _, ...rest } = graph
  const next: GraphNode = choice ? { ...rest, theme: choice } : rest
  return moveRequired(next, before, effectiveStyle(settings, next))
}

/**
 * A graph following its project's style changing from `from` to `to` (Apply style to the whole
 * project, Set as the project's style): its own style dropped when `dropOwn` (every graph then
 * follows the project), the axis frames and legend place moved as in `withGraphStyle`.
 */
export function withProjectStyle(
  graph: GraphNode,
  from: StyleSettings,
  to: StyleSettings,
  dropOwn: boolean,
): GraphNode {
  const before = effectiveStyle(from, graph)
  let next = graph
  if (dropOwn && graph.theme) {
    const { theme: _, ...rest } = graph
    next = rest
  }
  return moveRequired(next, before, effectiveStyle(to, next))
}

/**
 * A new graph taking its project's style (decision 531): its axis frames and legend place the
 * style's (graphs are made with the app's defaults: touching axes, the legend on the right).
 */
export const styledNewGraph = (graph: GraphNode, settings: StyleSettings): GraphNode =>
  moveRequired(graph, undefined, effectiveStyle(settings, graph))
