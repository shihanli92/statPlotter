// Hexagonal binning (roadmap 34g: hexbin plots), as `hexbin::hexbin` and `hcell2xy` return it.
//
// Provenance (audit 3, T1; decision 1086): a clean reimplementation, written from the published
// algorithm — D. B. Carr, R. J. Littlefield, W. L. Nicholson and J. S. Littlefield (1987),
// "Scatterplot matrix techniques for large N", JASA 82:424–436 (§2: the hexagon tessellation as
// two interleaved rectangular lattices, each point binned to the nearer lattice centre) — and
// standard hexagonal-grid geometry, without consulting any hexbin package source. It replaced a
// translation of GPL-2-only code. The R package defines only the output it is checked against:
// oracle suite `hexbin` (`tools/oracle/r/hexbin.R`).
//
// The plot's X range [x₀, x₁] holds `xbins` hexagon widths; the hexagons are regular on a plot
// whose height is `shape` times its width (pointed top and bottom). Scaled to hexagon widths,
//
//   sx = xbins (x − x₀) / (x₁ − x₀),   sy = xbins · shape (y − y₀) / ((y₁ − y₀) √3),
//
// the centres are lattice A, (i, j), and lattice B, (i + ½, j + ½), for integers i, j: rows of
// centres sy = j/2 apart (√3/2 hexagon widths on the plot) alternately shifted by half a width.
// A point belongs to the hexagon of the nearer centre in the plot's own (isotropic) metric,
// Δsx² + 3 Δsy² (a unit of sy is √3 widths), lattice A on a tie. Rows interleave A and B
// (row 2j is A's row j, 2j + 1 is B's), each `xbins + 1` columns wide, and a cell is numbered
// from 1 along the rows: cell = row · columns + column + 1.

/** Points counted in hexagons: the occupied cells in increasing order. */
export interface HexBins {
  /** The cells' numbers (1-based, along the rows from the bottom left). */
  cell: Int32Array
  /** The points in each cell. */
  count: Int32Array
  /** Each cell's centre of mass (the mean of its points). */
  xcm: Float64Array
  ycm: Float64Array
  xbins: number
  shape: number
  xbnds: [number, number]
  ybnds: [number, number]
  /** Rows and columns of the lattice (hexbin's `dimen`). */
  dimen: [number, number]
  /** The points given (some may lie outside the bounds or be missing). */
  n: number
}

export interface HexbinOptions {
  /** Hexagons across the X range (default 30). */
  xbins?: number
  /** The plot's height over its width (default 1). */
  shape?: number
  /** The binned range (default: the points' ranges); points outside it are left out. */
  xbnds?: [number, number]
  ybnds?: [number, number]
}

/** The finite range of values, or null when there are none. */
function finiteRange(v: ArrayLike<number>): [number, number] | null {
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < v.length; i++) {
    const a = v[i]!
    if (!Number.isFinite(a)) continue
    if (a < lo) lo = a
    if (a > hi) hi = a
  }
  return lo <= hi ? [lo, hi] : null
}

/**
 * The points (x, y) in hexagons (`hexbin::hexbin`): null when there are no finite points or a
 * range is empty. Points that are missing or outside the bounds are left out.
 */
export function hexbin(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  options: HexbinOptions = {},
): HexBins | null {
  const xbins = options.xbins ?? 30
  const shape = options.shape ?? 1
  const n = Math.min(x.length, y.length)
  const xb = options.xbnds ?? finiteRange(x)
  const yb = options.ybnds ?? finiteRange(y)
  if (!xb || !yb || !(xb[1] > xb[0]) || !(yb[1] > yb[0])) return null
  if (!(xbins > 0) || !(shape > 0)) return null
  const [x0, x1] = xb
  const [y0, y1] = yb
  const toSx = xbins / (x1 - x0)
  const toSy = (xbins * shape) / ((y1 - y0) * Math.sqrt(3))
  // Columns: lattice A's 0 … round(xbins), B's 0 … ⌊xbins⌋. Rows: pairs (A's row j, B's row j)
  // for j = 0 … round of the scaled height.
  const columns = Math.floor(xbins + 0.5) + 1
  const rows = 2 * (Math.floor((y1 - y0) * toSy + 0.5) + 1)
  const counts = new Map<number, { count: number; sx: number; sy: number }>()
  for (let k = 0; k < n; k++) {
    const px = x[k]!
    const py = y[k]!
    if (!(px >= x0 && px <= x1 && py >= y0 && py <= y1)) continue
    const sx = (px - x0) * toSx
    const sy = (py - y0) * toSy
    // Nearest centre of lattice A (rounded) and of lattice B (the half-integers around).
    const ai = Math.floor(sx + 0.5)
    const aj = Math.floor(sy + 0.5)
    const bi = Math.floor(sx)
    const bj = Math.floor(sy)
    const da = (sx - ai) ** 2 + 3 * (sy - aj) ** 2
    const db = (sx - bi - 0.5) ** 2 + 3 * (sy - bj - 0.5) ** 2
    const cell = da <= db ? 2 * aj * columns + ai + 1 : (2 * bj + 1) * columns + bi + 1
    const c = counts.get(cell)
    if (c) {
      c.count++
      c.sx += px
      c.sy += py
    } else counts.set(cell, { count: 1, sx: px, sy: py })
  }
  const cells = [...counts.keys()].sort((a, b) => a - b)
  const out: HexBins = {
    cell: Int32Array.from(cells),
    count: new Int32Array(cells.length),
    xcm: new Float64Array(cells.length),
    ycm: new Float64Array(cells.length),
    xbins,
    shape,
    xbnds: [x0, x1],
    ybnds: [y0, y1],
    dimen: [rows, columns],
    n,
  }
  cells.forEach((cell, k) => {
    const c = counts.get(cell)!
    out.count[k] = c.count
    out.xcm[k] = c.sx / c.count
    out.ycm[k] = c.sy / c.count
  })
  return out
}

/** The distance between hexagon centres along a row (dx) and between rows (dy), in data units. */
function spacing(h: HexBins): { dx: number; dy: number } {
  const dx = (h.xbnds[1] - h.xbnds[0]) / h.xbins
  const dy = ((h.ybnds[1] - h.ybnds[0]) * Math.sqrt(3)) / (2 * h.xbins * h.shape)
  return { dx, dy }
}

/** The cells' centres (`hexbin::hcell2xy`). */
export function hexCenters(h: HexBins): { x: Float64Array; y: Float64Array } {
  const { dx, dy } = spacing(h)
  const columns = h.dimen[1]
  const x = new Float64Array(h.cell.length)
  const y = new Float64Array(h.cell.length)
  for (let k = 0; k < h.cell.length; k++) {
    const c = h.cell[k]! - 1
    const row = Math.floor(c / columns)
    const col = c - row * columns
    x[k] = h.xbnds[0] + dx * (row % 2 === 0 ? col : col + 0.5)
    y[k] = h.ybnds[0] + dy * row
  }
  return { x, y }
}

/**
 * A hexagon's six corners about its centre, in data units: pointed top and bottom (two thirds of
 * the row spacing up and down), the side corners half a width across and a third of the row
 * spacing up or down; clockwise from the upper right.
 */
export function hexCorners(h: HexBins): [number, number][] {
  const { dx, dy } = spacing(h)
  const w = dx / 2
  const t = dy / 3
  return [
    [w, t],
    [w, -t],
    [0, -2 * t],
    [-w, -t],
    [-w, t],
    [0, 2 * t],
  ]
}
