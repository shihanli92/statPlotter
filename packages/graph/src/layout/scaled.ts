import type { GraphNode } from '@ps/model'
import type { Box, PathCmd, Prim, Scene, SceneAxis, SceneNode, Stroke } from '../scene.ts'
import type { TextLayout } from '../text/layout.ts'
import { scalePoints } from './cloud.ts'

// Scaling a whole graph (roadmap 23): `GraphNode.size.scale` makes text, symbols, line widths,
// gaps and the legend grow and shrink with the plot. The graph is laid out at plot size ÷ scale
// with its own style sizes (so ticks, label placement and wrapping are those of the smaller or
// larger graph, as when scaling a picture), then every length in the scene is multiplied here.
// One place, so everything scales exactly in proportion and a scale of 1 changes nothing.

/** A graph's scale: text, marks and gaps are drawn this many times their size (absent = 1). */
export const graphScale = (graph: GraphNode): number => graph.size.scale ?? 1

/** The graph as the layout engine sees it before scaling: its plot size ÷ scale, scale 1. */
export function unscaledGraph<G extends GraphNode>(graph: G): G {
  const s = graphScale(graph)
  if (s === 1) return graph
  const { plotWidth, plotHeight } = graph.size
  return { ...graph, size: { plotWidth: plotWidth / s, plotHeight: plotHeight / s } }
}

const box = (b: Box, s: number): Box => ({ x: b.x * s, y: b.y * s, w: b.w * s, h: b.h * s })
const stroke = (k: Stroke | null, s: number): Stroke | null => k && { ...k, width: k.width * s }
const points = (ps: readonly [number, number][], s: number): [number, number][] =>
  ps.map(([x, y]) => [x * s, y * s])

function text(t: TextLayout, s: number): TextLayout {
  return {
    width: t.width * s,
    ascent: t.ascent * s,
    descent: t.descent * s,
    runs: t.runs.map((r) => ({
      ...r,
      x: r.x * s,
      dy: r.dy * s,
      width: r.width * s,
      size: r.size * s,
    })),
    ...(t.underlines ? { underlines: t.underlines.map((u) => ({ ...u, ...box(u, s) })) } : {}),
  }
}

function prim(p: Prim, s: number): Prim {
  switch (p.type) {
    case 'line':
      return {
        ...p,
        x1: p.x1 * s,
        y1: p.y1 * s,
        x2: p.x2 * s,
        y2: p.y2 * s,
        stroke: stroke(p.stroke, s)!,
      }
    case 'polyline':
      return { ...p, points: points(p.points, s), stroke: stroke(p.stroke, s)! }
    case 'polygon':
      return { ...p, points: points(p.points, s), stroke: stroke(p.stroke, s) }
    case 'rect':
      return {
        ...p,
        x: p.x * s,
        y: p.y * s,
        w: p.w * s,
        h: p.h * s,
        stroke: stroke(p.stroke, s),
        ...(p.rx !== undefined ? { rx: p.rx * s } : {}),
      }
    case 'image':
      return { ...p, x: p.x * s, y: p.y * s, w: p.w * s, h: p.h * s }
    case 'ellipse':
      return {
        ...p,
        cx: p.cx * s,
        cy: p.cy * s,
        rx: p.rx * s,
        ry: p.ry * s,
        stroke: stroke(p.stroke, s),
      }
    case 'path':
      return {
        ...p,
        d: p.d.map((c) => [c[0], ...c.slice(1).map((v) => (v as number) * s)] as PathCmd),
        stroke: stroke(p.stroke, s),
      }
    case 'symbol':
      return { ...p, cx: p.cx * s, cy: p.cy * s, size: p.size * s, stroke: stroke(p.stroke, s) }
    case 'points':
      return scalePoints(p, s)
    case 'text':
      return {
        ...p,
        x: p.x * s,
        y: p.y * s,
        layout: text(p.layout, s),
        ...(p.halo ? { halo: { ...p.halo, width: p.halo.width * s } } : {}),
        ...(p.rotate ? { rotate: { ...p.rotate, cx: p.rotate.cx * s, cy: p.rotate.cy * s } } : {}),
      }
  }
}

/**
 * A subtree with every length multiplied by `s`: coordinates, bounds, stroke widths (dash
 * patterns follow them), symbol sizes, font sizes and text metrics, point-label offsets and
 * placed subtrees' offsets. Colours, angles and opacity are unchanged.
 */
export function scaleNode(node: SceneNode, s: number): SceneNode {
  const out: SceneNode = { ...node }
  if (node.bbox) out.bbox = box(node.bbox, s)
  if (node.prim) out.prim = prim(node.prim, s)
  if (node.children) out.children = node.children.map((c) => scaleNode(c, s))
  if (node.labelOffset)
    out.labelOffset = { dx: node.labelOffset.dx * s, dy: node.labelOffset.dy * s }
  if (node.transform)
    out.transform = { ...node.transform, x: node.transform.x * s, y: node.transform.y * s }
  return out
}

const axis = (a: SceneAxis, s: number): SceneAxis => ({
  categorical: a.categorical,
  toPx: (v) => a.toPx(v) * s,
  fromPx: (px) => a.fromPx(px / s),
})

/** A graph scene scaled by `s` (the same scene when `s` is 1). */
export function scaleScene(scene: Scene, s: number): Scene {
  if (s === 1) return scene
  const { axes } = scene
  return {
    ...scene,
    width: scene.width * s,
    height: scene.height * s,
    root: scaleNode(scene.root, s),
    plot: box(scene.plot, s),
    ...(axes
      ? {
          axes: {
            x: axis(axes.x, s),
            y: axis(axes.y, s),
            ...(axes.y2 ? { y2: axis(axes.y2, s) } : {}),
          },
        }
      : {}),
  }
}
