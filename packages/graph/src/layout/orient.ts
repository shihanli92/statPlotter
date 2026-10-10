import type { GraphNode, RichText } from '@ps/model'
import { makeAxisScale } from '../scale.ts'
import type { Box, PathCmd, Prim, SceneNode } from '../scene.ts'
import type { Theme } from '../theme.ts'
import { transformOf } from '../transform.ts'
import type { CategoryLayout } from './categoryExtras.ts'
import { movePoints } from './cloud.ts'
import {
  type AxisPlan,
  type ContinuousAxis,
  type GraphContext,
  planCategoricalAxis,
  planContinuousAxis,
  type ValueAxis,
} from './common.ts'

// Horizontal column and grouped graphs (roadmap 30): the categories run down the left and the
// values across. The layouts draw their marks in the usual vertical frame — categories along u
// (0 at the left), values along v (plot-local y: 0 at the top) — and `flipNode` turns the marks
// into the horizontal frame: (u, v) → (L − v, u), L the value axis' length, so the first category
// is at the top and larger values are to the right. Symbols keep their shape; text is placed
// directly in the horizontal frame by the code drawing it (bar labels, brackets, point labels).

/** A graph, as far as orientation goes. */
type Oriented = Pick<GraphNode, 'frame' | 'style'>

/** Whether a graph's frame can be drawn horizontally (category and grouped graphs). */
const turnable = (graph: Oriented): boolean =>
  graph.frame === 'category' || graph.frame === 'grouped'

/** Whether a graph is drawn with its categories down the left (`style.orientation`). */
export const isHorizontal = (graph: Oriented): boolean =>
  graph.style.orientation === 'horizontal' && turnable(graph)

/** The graph drawn horizontally or vertically (unchanged when its frame can't be turned). */
export function withOrientation<G extends GraphNode>(graph: G, horizontal: boolean): G {
  if (!turnable(graph)) return graph
  const { orientation: _, ...style } = graph.style
  return { ...graph, style: horizontal ? { ...style, orientation: 'horizontal' } : style }
}

/**
 * The frame of a graph drawn with its categories down the left (`horizontal`) or along X: `cat`
 * along the categories, `val` along the values (plot width and height when vertical, swapped
 * when horizontal), and the mapping of a vertical-frame point to the plot.
 */
export function orientedFrame(
  graph: Pick<GraphNode, 'size'>,
  horizontal: boolean,
): {
  horizontal: boolean
  cat: number
  val: number
  flip: (u: number, v: number) => [number, number]
} {
  const { plotWidth: W, plotHeight: H } = graph.size
  return horizontal
    ? { horizontal, cat: H, val: W, flip: (u, v) => [W - v, u] }
    : { horizontal, cat: W, val: H, flip: (u, v) => [u, v] }
}

/** A vertical-frame box in the horizontal frame (L: the value axis' length). */
export const flipBox = (b: Box, L: number): Box => ({ x: L - b.y - b.h, y: b.x, w: b.h, h: b.w })

function flipPrim(p: Prim, L: number): Prim {
  const pt = ([u, v]: readonly [number, number]): [number, number] => [L - v, u]
  switch (p.type) {
    case 'line':
      return { ...p, x1: L - p.y1, y1: p.x1, x2: L - p.y2, y2: p.x2 }
    case 'polyline':
    case 'polygon':
      return { ...p, points: p.points.map(pt) }
    case 'rect':
    case 'image':
      return { ...p, ...flipBox(p, L) }
    case 'ellipse':
      return { ...p, cx: L - p.cy, cy: p.cx, rx: p.ry, ry: p.rx }
    case 'path':
      return {
        ...p,
        d: p.d.map((c) => {
          if (c[0] === 'Z') return c
          const out: (string | number)[] = [c[0]]
          for (let i = 1; i + 1 < c.length; i += 2)
            out.push(...pt([c[i] as number, c[i + 1] as number]))
          return out as PathCmd
        }),
      }
    case 'symbol':
      return { ...p, cx: L - p.cy, cy: p.cx }
    case 'points':
      return movePoints(p, (u, v) => [L - v, u])
    case 'text':
      return p
  }
}

/**
 * A subtree drawn in the vertical frame, turned horizontal (L: the value axis' length). Text
 * (and the bounds of text nodes) is left where it is: it is placed in the horizontal frame.
 */
export function flipNode(n: SceneNode, L: number): SceneNode {
  const out: SceneNode = { ...n }
  const text = n.prim?.type === 'text'
  if (n.prim && !text) out.prim = flipPrim(n.prim, L)
  if (n.bbox && !text) out.bbox = flipBox(n.bbox, L)
  if (n.children) out.children = n.children.map((c) => flipNode(c, L))
  return out
}

/**
 * The value axis of a column or grouped graph as drawn: the left Y axis (vertical), or along the
 * bottom (horizontal; `right`: the second value axis, along the top), from its domain and scale
 * in the vertical frame.
 */
export function valuePlan(
  ctx: GraphContext,
  theme: Theme,
  palette: readonly string[],
  horizontal: boolean,
  spec: ContinuousAxis,
  axis: Pick<ValueAxis, 'dom' | 'scale'>,
  opts: { right?: boolean } = {},
): AxisPlan {
  const { dom, scale } = axis
  if (!horizontal) return planContinuousAxis(ctx, theme, palette, 'y', spec, dom, scale, opts)
  const L = Math.abs(scale.range[1] - scale.range[0])
  const across = makeAxisScale(transformOf(spec), [dom.min, dom.max], [0, L], {
    reverse: spec.reverse,
    breaks: spec.breaks,
    pieces: spec.pieces,
  })
  return planContinuousAxis(ctx, theme, palette, 'x', spec, dom, across, {
    ...opts,
    key: opts.right ? 'y2' : 'y',
  })
}

/**
 * The category axis of a column or grouped graph as drawn: along the bottom, or down the left;
 * with its categories' places (roadmap 36) for a treatment grid and spans.
 */
export function categoryPlan(
  ctx: GraphContext,
  theme: Theme,
  palette: readonly string[],
  horizontal: boolean,
  labels: readonly (string | RichText)[],
  length: number,
  offset: number,
  categories?: CategoryLayout,
): AxisPlan {
  const spec = ctx.graph.axes.x
  const more = categories ? { categories } : {}
  return horizontal
    ? planCategoricalAxis(ctx, theme, palette, spec, labels, length, offset, {
        which: 'y',
        key: 'x',
        ...more,
      })
    : planCategoricalAxis(ctx, theme, palette, spec, labels, length, offset, more)
}

/**
 * How far marks reach right of a horizontal plot, from the top they reach in the vertical frame
 * (plot-local, < 0 above the plot).
 */
export const asideOf = (top: number): number => Math.max(0, -top)
