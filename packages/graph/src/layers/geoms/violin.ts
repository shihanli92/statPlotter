import type { LayerOf } from '@ps/model'
import type { SceneNode, Stroke } from '../../scene.ts'
import { type ResolvedSeriesStyle, resolveFill, resolveStroke } from '../../theme.ts'
import { type ViolinStats, violinOf } from '../../violin.ts'
import type { CategorySlot } from '../frames/category.ts'
import type { GroupedCell } from '../frames/grouped.ts'
import { barFraction } from './bar.ts'

// Violins: the `density` stat's outline mirrored, with lines at the centre and quartiles; the
// marks are `violinMarks`.

/** A data set's violin in its category (category frame). */
export function categoryViolin(c: CategorySlot, layer: LayerOf<'violin'>): void {
  const { kit, key, x0, band, target, color, stats } = c
  const style = kit.style(layer, key)
  const v = violinOf(stats, style.violin)
  if (!v) return
  const m = violinMarks({
    v,
    ids: {
      box: `series/${key}/${kit.part(layer, key, 'box')}`,
      center: `series/${key}/${kit.part(layer, key, 'center')}`,
    },
    x0,
    w: barFraction(kit.graph, layer, key, style) * band,
    target,
    style,
    palette: kit.palette,
    color,
    yEnd: c.Y.end,
    yPoint: c.Y.point,
  })
  kit.addList(layer, key, m.nodes)
  c.touch(m.top)
}

/** The opts of a grouped cell's box or violin: its own fill and border, in its slot. */
export function cellBox(g: GroupedCell, layer: LayerOf<'box'> | LayerOf<'violin'>) {
  const { kit, key, own, target, color, tRow, r } = g
  const style = kit.style(layer, key)
  const { sub, cx } = g.slots(layer)
  return {
    style,
    sub,
    opts: {
      x0: cx(g.gi, g.si),
      w: style.bar.width * sub,
      target,
      style: {
        ...style,
        box: {
          ...style.box,
          fill: own?.box?.fill ?? style.box.fill,
          border: own?.box?.border ?? style.box.border,
        },
      },
      palette: kit.palette,
      color,
      yEnd: g.axis.end,
      yPoint: g.axis.point,
    },
    ids: {
      box: `series/${key}/${kit.part(layer, key, 'box')}/${tRow(r)}`,
      center: `series/${key}/${kit.part(layer, key, 'center')}/${tRow(r)}`,
    },
  }
}

/** A cell's violin in its slot (grouped frame). */
export function groupedViolin(g: GroupedCell, layer: LayerOf<'violin'>): void {
  if (g.hidden) return
  const { style, opts, ids } = cellBox(g, layer)
  const v = violinOf(g.c, style.violin)
  if (!v) return
  const m = violinMarks({ v, ids, ...opts })
  g.kit.addList(layer, g.key, m.nodes.map(g.mark))
  g.top = Math.min(g.top, m.top)
}

export interface ViolinMarkOptions {
  v: ViolinStats
  /** Centre and width (at the widest point) of the violin. */
  x0: number
  w: number
  ids: { box: string; center: string }
  target: (string | number)[]
  style: ResolvedSeriesStyle
  palette: readonly string[]
  color: string
  /** Pixel y of a value clipped to the plot (the outline), or NaN when hidden (lines). */
  yEnd: (v: number) => number
  yPoint: (v: number) => number
}

/**
 * A violin: the density outline mirrored about x0 (widest point `w` wide), filled like a box,
 * with a line at the centre (median or mean, across the violin's width there) and, when chosen,
 * lines at the quartiles. `top` is the highest pixel drawn.
 */
export function violinMarks(o: ViolinMarkOptions): { nodes: SceneNode[]; top: number } {
  const { v, x0, w, ids, target, style, yEnd, yPoint } = o
  const half = (d: number) => (v.maxDensity > 0 ? (w / 2) * (d / v.maxDensity) : 0)
  const right: [number, number][] = v.ys.map((y, i) => [x0 + half(v.density[i]!), yEnd(y)])
  const left: [number, number][] = v.ys.map((y, i) => [x0 - half(v.density[i]!), yEnd(y)])
  const points = [...right, ...left.reverse()]
  const stroke = resolveStroke(style.box.border, o.palette, o.color)
  const ys = points.map((p) => p[1])
  const top = Math.min(...ys)
  const bbox = { x: x0 - w / 2, y: top, w, h: Math.max(...ys) - top }
  const nodes: SceneNode[] = [
    {
      id: ids.box,
      target: [...target, 'box'],
      prim: {
        type: 'polygon',
        points,
        fill: resolveFill(style.box.fill, o.palette, o.color) ?? { color: o.color, opacity: 0 },
        stroke,
      },
      bbox,
    },
  ]
  const across = (id: string, at: number, line: Stroke, path: string) => {
    const y = yPoint(at)
    const h = half(v.densityAt(at))
    if (!Number.isFinite(y) || !(h > 0)) return
    nodes.push({
      id,
      target: [...target, path],
      prim: { type: 'line', x1: x0 - h, y1: y, x2: x0 + h, y2: y, stroke: line },
    })
  }
  if (style.violin.quartiles) {
    const q = resolveStroke(style.violin.quartileLine, o.palette, o.color)
    across(`${ids.box}/q1`, v.q1, q, 'violin')
    across(`${ids.box}/q3`, v.q3, q, 'violin')
  }
  const c = style.center.stat
  if (c !== 'none')
    across(
      ids.center,
      c === 'mean' ? v.mean : v.median,
      resolveStroke(style.center.line, o.palette, o.color),
      'center',
    )
  return { nodes, top }
}
