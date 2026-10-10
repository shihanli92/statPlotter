// Contour lines of a function on a grid by marching squares (roadmap 34g: density contours),
// checked against `grDevices::contourLines` as point sets (oracle suite `density2d`).
//
// A level crosses a grid edge where one end is at or above it and the other below; the crossing
// point is linear between the ends (x = x₀ + f (x₁ − x₀), f = (level − z₀) / (z₁ − z₀), as R).
// Within a cell the crossings are joined so the region at or above the level stays on the left
// (walking with X to the right and Y up): rings round a peak run counter-clockwise, round a dip
// clockwise, so a ring set filled by the nonzero rule is the region at or above the level, holes
// and all. Saddle cells (two opposite corners above) join the above corners when the cell's mean
// is at or above the level. Cells with a missing corner are skipped. A grid value exactly at the
// level is raised by 10⁻³ of the grid's range first, as R does ("change that value by a tiny
// amount", `GEcontourLines`), so lines never run through grid points.

import { valueRange } from '../arrays.ts'

/** A contour line: its points (closed rings don't repeat the first point at the end). */
export interface ContourLine {
  level: number
  x: number[]
  y: number[]
  closed: boolean
}

/** z[i + j · nx] at (x[i], y[j]): R's matrix layout. */
interface Grid {
  x: ArrayLike<number>
  y: ArrayLike<number>
  z: ArrayLike<number>
}

/**
 * The contour lines of `grid` at each level, in level order: within a level, lines from the
 * grid's edge first (open), then rings (closed), each in the order its first cell is reached.
 */
export function contourLines(grid: Grid, levels: readonly number[]): ContourLine[] {
  const atom = atomOf(grid.z)
  return levels.flatMap((level) => isolines(grid, level, atom))
}

/** R's nudge of values at a level: 10⁻³ of the range of the finite values. */
function atomOf(z: ArrayLike<number>): number {
  const [lo, hi] = valueRange(z, true)
  return hi > lo ? 1e-3 * (hi - lo) : 0
}

/**
 * The boundary rings of the region where the grid is at or above `level`, closed along the
 * grid's edges (the grid surrounded by values below every level): filled by the nonzero rule
 * they are the region (filled density bands).
 */
export function levelRegion(grid: Grid, level: number): ContourLine[] {
  const nx = grid.x.length
  const ny = grid.y.length
  // A ring of -∞ at the same coordinates as the edge: crossings there sit on the edge itself.
  const px = new Float64Array(nx + 2)
  const py = new Float64Array(ny + 2)
  for (let i = 0; i < nx; i++) px[i + 1] = grid.x[i]!
  for (let j = 0; j < ny; j++) py[j + 1] = grid.y[j]!
  px[0] = grid.x[0]!
  px[nx + 1] = grid.x[nx - 1]!
  py[0] = grid.y[0]!
  py[ny + 1] = grid.y[ny - 1]!
  const pz = new Float64Array((nx + 2) * (ny + 2)).fill(Number.NEGATIVE_INFINITY)
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) pz[i + 1 + (j + 1) * (nx + 2)] = grid.z[i + j * nx]!
  return isolines({ x: px, y: py, z: pz }, level, atomOf(grid.z))
}

/** A grid value, raised by `atom` when it is exactly at the level (see the module comment). */
function nudged(z: ArrayLike<number>, k: number, level: number, atom: number): number {
  const v = z[k]!
  return v === level ? v + atom : v
}

/**
 * Adds the crossing point on an edge to (xs, ys): linear between the edge's nodes, an end at -∞
 * putting it on the other end.
 */
function addCrossing(
  grid: Grid,
  edge: number,
  level: number,
  atom: number,
  xs: number[],
  ys: number[],
): void {
  const { x, y, z } = grid
  const nx = x.length
  const H = (nx - 1) * y.length
  let i: number
  let j: number
  let a: number
  let b: number
  let x1: number
  let y1: number
  if (edge < H) {
    i = edge % (nx - 1)
    j = (edge - i) / (nx - 1)
    a = i + j * nx
    b = a + 1
    x1 = x[i + 1]!
    y1 = y[j]!
  } else {
    const k = edge - H
    i = k % nx
    j = (k - i) / nx
    a = i + j * nx
    b = a + nx
    x1 = x[i]!
    y1 = y[j + 1]!
  }
  const x0 = x[i]!
  const y0 = y[j]!
  const z0 = nudged(z, a, level, atom)
  const z1 = nudged(z, b, level, atom)
  if (z0 === Number.NEGATIVE_INFINITY) {
    xs.push(x1)
    ys.push(y1)
  } else if (z1 === Number.NEGATIVE_INFINITY) {
    xs.push(x0)
    ys.push(y0)
  } else {
    const f = (level - z0) / (z1 - z0)
    xs.push(x0 + f * (x1 - x0))
    ys.push(y0 + f * (y1 - y0))
  }
}

/**
 * One line, from the edge `start` along `next` until an edge already drawn or one leading
 * nowhere (an open line's last edge is drawn, then the walk stops).
 */
function walk(
  grid: Grid,
  next: ReadonlyMap<number, number>,
  done: Set<number>,
  start: number,
  closed: boolean,
  level: number,
  atom: number,
): ContourLine {
  const xs: number[] = []
  const ys: number[] = []
  let e: number | undefined = start
  while (e !== undefined && !done.has(e)) {
    done.add(e)
    addCrossing(grid, e, level, atom, xs, ys)
    e = next.get(e)
  }
  return { level, x: xs, y: ys, closed }
}

/** One level's lines (see the module comment). */
function isolines(grid: Grid, level: number, atom: number): ContourLine[] {
  const { x, y, z } = grid
  const nx = x.length
  const ny = y.length
  if (nx < 2 || ny < 2 || !Number.isFinite(level)) return []
  // Edge ids: horizontal edge (i, j) from node (i, j) to (i + 1, j); vertical edge (i, j) from
  // node (i, j) to (i, j + 1), after every horizontal one.
  const H = (nx - 1) * ny
  const next = new Map<number, number>()
  const isTo = new Set<number>()
  const order: number[] = []
  const corner = new Float64Array(4)
  const up = new Uint8Array(4)
  const edges = new Array<number>(4)
  const kinds = new Int8Array(4)
  for (let j = 0; j < ny - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      // Corners counter-clockwise: bottom-left, bottom-right, top-right, top-left.
      corner[0] = nudged(z, i + j * nx, level, atom)
      corner[1] = nudged(z, i + 1 + j * nx, level, atom)
      corner[2] = nudged(z, i + 1 + (j + 1) * nx, level, atom)
      corner[3] = nudged(z, i + (j + 1) * nx, level, atom)
      if (
        Number.isNaN(corner[0]) ||
        Number.isNaN(corner[1]) ||
        Number.isNaN(corner[2]) ||
        Number.isNaN(corner[3])
      )
        continue
      for (let e = 0; e < 4; e++) up[e] = corner[e]! >= level ? 1 : 0
      if (up[0] === up[1] && up[1] === up[2] && up[2] === up[3]) continue
      // Edges counter-clockwise: bottom, right, top, left.
      edges[0] = i + j * (nx - 1)
      edges[1] = H + i + 1 + j * nx
      edges[2] = i + (j + 1) * (nx - 1)
      edges[3] = H + i + j * nx
      // 1: falling (above to below going round), -1: rising, 0: no crossing.
      let saddle = true
      for (let e = 0; e < 4; e++) {
        const p = up[e]!
        const q = up[(e + 1) % 4]!
        kinds[e] = p === q ? 0 : p ? 1 : -1
        if (p === q) saddle = false
      }
      const mean = (corner[0]! + corner[1]! + corner[2]! + corner[3]!) / 4
      const ccw = !saddle || mean >= level
      for (let e = 0; e < 4; e++) {
        if (kinds[e] !== 1) continue
        for (let s = 1; s < 4; s++) {
          const f = ccw ? (e + s) % 4 : (e - s + 4) % 4
          if (kinds[f] !== -1) continue
          next.set(edges[e]!, edges[f]!)
          isTo.add(edges[f]!)
          order.push(edges[e]!)
          break
        }
      }
    }
  const out: ContourLine[] = []
  const done = new Set<number>()
  for (const e of order)
    if (!isTo.has(e) && !done.has(e)) out.push(walk(grid, next, done, e, false, level, atom))
  for (const e of order) if (!done.has(e)) out.push(walk(grid, next, done, e, true, level, atom))
  return out
}
