import type { Fill, Prim, Stroke } from '../scene.ts'

// Audit 2 (G2): the SVG and PDF writers never print a non-finite number. NaN in a PDF content
// stream makes the file invalid, and in an SVG a mark that silently isn't there. Marks are meant
// to leave such points out before they reach a scene; a primitive that still holds one is
// dropped (a point cloud's point by point), and in development the drop is reported, since it
// means a mark's code let a NaN through.

const ok = Number.isFinite

const okAll = (...vs: (number | undefined)[]) => vs.every((v) => v === undefined || ok(v))

const okStroke = (s: Stroke | null | undefined) => !s || ok(s.width)
const okFill = (f: Fill | null | undefined) => !f || f.opacity === undefined || ok(f.opacity)
const okPoints = (ps: readonly (readonly [number, number])[]) =>
  ps.every(([x, y]) => ok(x) && ok(y))

/**
 * Whether every number a primitive is drawn with is finite. A point cloud's points are checked
 * one by one where they are drawn (`cloudPointFinite`), so a single bad point drops only itself.
 */
export function primFinite(p: Prim): boolean {
  switch (p.type) {
    case 'line':
      return ok(p.x1) && ok(p.y1) && ok(p.x2) && ok(p.y2) && okStroke(p.stroke)
    case 'polyline':
      return okPoints(p.points) && okStroke(p.stroke)
    case 'polygon':
      return okPoints(p.points) && okFill(p.fill) && okStroke(p.stroke)
    case 'rect':
      return okAll(p.x, p.y, p.w, p.h, p.rx) && okFill(p.fill) && okStroke(p.stroke)
    case 'ellipse':
      return okAll(p.cx, p.cy, p.rx, p.ry) && okFill(p.fill) && okStroke(p.stroke)
    case 'path':
      return (
        p.d.every((c) => c.every((v, i) => i === 0 || ok(v as number))) &&
        okFill(p.fill) &&
        okStroke(p.stroke)
      )
    case 'image':
      return okAll(p.x, p.y, p.w, p.h, p.crop?.x, p.crop?.y, p.crop?.w, p.crop?.h)
    case 'symbol':
      // Inline (no argument list to allocate): a scene can hold 100k+ symbols.
      return ok(p.cx) && ok(p.cy) && ok(p.size) && okFill(p.fill) && okStroke(p.stroke)
    case 'points':
      return p.paints.every((q) => okFill(q.fill) && okStroke(q.stroke))
    case 'text':
      return (
        okAll(p.x, p.y, p.rotate?.angle, p.rotate?.cx, p.rotate?.cy, p.halo?.width) &&
        p.layout.runs.every((r) => okAll(r.x, r.dy, r.size)) &&
        (p.layout.underlines ?? []).every((u) => okAll(u.x, u.y, u.w, u.h))
      )
  }
}

/** Whether a point cloud's i-th point can be drawn (finite place and size). */
export const cloudPointFinite = (p: Extract<Prim, { type: 'points' }>, i: number) =>
  ok(p.x[i]!) && ok(p.y[i]!) && ok(p.size[i]!)

const DEV = (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true

/** Reports a dropped primitive in development (see the module comment). */
export function droppedNonFinite(p: Prim, where: string): void {
  if (DEV) console.error(`${where}: dropped a ${p.type} with a non-finite number`)
}

/** A number as written: rounded to 1/1000; never NaN or ±Infinity (0, reported in development). */
export function finiteNumber(v: number): string {
  if (!ok(v)) {
    if (DEV) console.error(`a non-finite number (${v}) written as 0`)
    return '0'
  }
  const r = Math.round(v * 1000) / 1000
  return Object.is(r, -0) ? '0' : String(r)
}
