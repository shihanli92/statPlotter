import type { ArrowHead, LineEnds } from '@ps/model'
import type { Prim, Stroke } from '../scene.ts'

// Lines with arrowheads (roadmap 32): layout-page lines and graph line annotations share them.
// A filled triangle at size 1 is drawn exactly as graph arrows always were.

/** Arrowhead length and half-width for a line of the given width (size 1). */
export const arrowSize = (width: number) => {
  const length = 4 + 2.5 * width
  return { length, half: length * 0.4 }
}

export interface LineWithHeads {
  /** The stroked line, stopped short where a head covers its end. */
  line: { x1: number; y1: number; x2: number; y2: number }
  /** The heads' shapes: the end's first, then the start's. */
  heads: Prim[]
  /** How far the heads reach from the line's ends (for bounds). */
  reach: number
}

/**
 * A line from (x1, y1) to (x2, y2) with heads at its ends: the line trimmed so its end doesn't
 * poke through a head, and each head's shapes in the line's colour. A line of no length has none.
 */
export function lineWithHeads(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  stroke: Stroke,
  ends: LineEnds,
): LineWithHeads {
  const len = Math.hypot(x2 - x1, y2 - y1)
  const heads: Prim[] = []
  let [sx, sy, ex, ey] = [x1, y1, x2, y2]
  let reach = 0
  if (len > 0) {
    const [ux, uy] = [(x2 - x1) / len, (y2 - y1) / len]
    const place = (head: ArrowHead | undefined, tx: number, ty: number, dx: number, dy: number) => {
      if (!head) return null
      const h = arrowHead(head, tx, ty, dx, dy, stroke)
      heads.push(...h.prims)
      reach = Math.max(reach, h.reach)
      const cut = Math.min(h.cut, len / 2)
      return [tx - dx * cut, ty - dy * cut] as const
    }
    const e = place(ends.end, x2, y2, ux, uy)
    if (e) [ex, ey] = e
    const s = place(ends.start, x1, y1, -ux, -uy)
    if (s) [sx, sy] = s
  }
  return { line: { x1: sx, y1: sy, x2: ex, y2: ey }, heads, reach }
}

/**
 * One head with its tip at (tx, ty) pointing along (ux, uy): its shapes, how much of the line it
 * covers (`cut`) and how far it reaches from the tip.
 */
export function arrowHead(
  head: ArrowHead,
  tx: number,
  ty: number,
  ux: number,
  uy: number,
  stroke: Stroke,
): { prims: Prim[]; cut: number; reach: number } {
  const k = head.size ?? 1
  const { length: l0, half: h0 } = arrowSize(stroke.width)
  const [length, half] = [l0 * k, h0 * k]
  const fill = { color: stroke.color, opacity: 1 }
  const [bx, by] = [tx - ux * length, ty - uy * length]
  const left: [number, number] = [bx - uy * half, by + ux * half]
  const right: [number, number] = [bx + uy * half, by - ux * half]
  const w = stroke.width
  switch (head.shape) {
    case 'triangle':
      return {
        prims: [{ type: 'polygon', points: [[tx, ty], left, right], fill, stroke: null }],
        cut: length / 2,
        reach: half,
      }
    case 'open':
      return {
        prims: [
          {
            type: 'path',
            d: [
              ['M', ...left],
              ['L', tx, ty],
              ['L', ...right],
            ],
            stroke: { ...stroke, dash: 'solid' },
            fill: null,
          },
        ],
        cut: w / 2,
        reach: half + w,
      }
    case 'bar':
      return {
        prims: [
          {
            type: 'line',
            x1: tx - uy * half,
            y1: ty + ux * half,
            x2: tx + uy * half,
            y2: ty - ux * half,
            stroke: { ...stroke, dash: 'solid' },
          },
        ],
        cut: w / 2,
        reach: half + w,
      }
    case 'circle': {
      const r = length * 0.3
      return {
        prims: [{ type: 'ellipse', cx: tx, cy: ty, rx: r, ry: r, fill, stroke: null }],
        cut: r,
        reach: r,
      }
    }
  }
}
