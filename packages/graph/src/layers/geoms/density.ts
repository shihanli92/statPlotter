import type { AssetId, DataTable, LayerOf } from '@ps/model'
import {
  contourLines,
  type Density2d,
  hexCenters,
  hexCorners,
  levelRegion,
  valueRange,
} from '@ps/stats'
import { colorAlong } from '../../aesthetics.ts'
import { hexToRgb } from '../../color.ts'
import { clipPolyline, type GraphContext } from '../../layout/common.ts'
import type { LegendEntry } from '../../layout/legend.ts'
import { pngWriter } from '../../render/raster.ts'
import type { Scale } from '../../scale.ts'
import type { PathCmd, StylePath } from '../../scene.ts'
import { graphDashes, resolveStroke, type Theme } from '../../theme.ts'
import { transformOf } from '../../transform.ts'
import type { LayerKit } from '../kit.ts'
import { colorBarEntry } from '../looks.ts'
import {
  cached,
  contourLevels,
  densityGrid,
  HEX_BINS,
  hexCellsOf,
  type PlotPoints,
  pointDensities,
} from '../stats/density.ts'
import { DENSITY_THEME, GROUP_BAND_OPACITY } from '../theme.ts'
import {
  clipPolygon,
  clipPolygonToPieces,
  groupStroke,
  type PlotPieces,
  plotPieces,
} from './overlay.ts'

// Densities of a graph of variables' points (roadmap 34g), drawn on its XY frame: hexagons tiling
// the plot coloured by the points in each (`hex` × `hexbin`), contour lines and filled bands of
// the points' 2D density per group (`contour` × `density2d`), and the density as an image
// (`raster` × `density2d`). Computed in the axes' transformed coordinates (`stats/density.ts`),
// placed by them; the colours by value come from the layer's own colour map, with a colour bar in
// the legend. A density never asks what the table is.

/** Where density marks go: transformed values to plot-local points, and the plot's size. */
export interface DensityAxes {
  px: (tx: number) => number
  py: (ty: number) => number
  W: number
  H: number
  /**
   * Audit 2 (G2), with axis breaks: positions of filled shapes' corners and of the density
   * image, a value inside a break at the break's edge; and the plot's pieces between breaks that
   * fills are cut to. Absent without breaks.
   */
  breaks?: { px: (tx: number) => number; py: (ty: number) => number; pieces: PlotPieces }
}

/** The axes of a frame's X and Y scales (positions linear in their transformed values). */
export function densityAxes(x: Scale, y: Scale, W: number, H: number): DensityAxes {
  const axes: DensityAxes = {
    px: (t) => x(x.transform.inverse(t)),
    py: (t) => y(y.transform.inverse(t)),
    W,
    H,
  }
  if (!x.gaps.length && !y.gaps.length) return axes
  const { xEdge, yEdge, pieces } = plotPieces(x, y, W, H)
  return {
    ...axes,
    breaks: {
      px: (t) => xEdge(x.transform.inverse(t)),
      py: (t) => yEdge(y.transform.inverse(t)),
      pieces,
    },
  }
}

/** A filled ring's parts in the plot (cut at axis breaks; see `clipPolygonToPieces`). */
const fillParts = (
  axes: DensityAxes,
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
): [number, number][][] => {
  const { px, py } = axes.breaks ?? axes
  const ring = Array.from(xs, (v, i): [number, number] => [px(v), py(ys[i]!)])
  if (!axes.breaks) {
    const clipped = clipPolygon(ring, axes.W, axes.H)
    return clipped.length > 2 ? [clipped] : []
  }
  return clipPolygonToPieces(ring, axes.W, axes.H, axes.breaks.pieces)
}

type Style<G extends 'hex' | 'contour' | 'raster'> = Required<
  Omit<NonNullable<LayerOf<G>['style']>, 'opacity'>
> &
  Pick<NonNullable<LayerOf<G>['style']>, 'opacity'>

/** A density layer's style for a data set: the theme's defaults, the layer's, the data set's. */
export function densityStyle<G extends 'hex' | 'contour' | 'raster'>(
  layer: LayerOf<G>,
  key: string,
  theme?: Pick<Theme, 'colorMap' | 'density'>,
): Style<G> {
  const l = layer as LayerOf<'hex' | 'contour' | 'raster'>
  // Roadmap 37: a style's colour map in place of viridis; its line widths (audit 2, G9).
  const map = theme?.colorMap ? { colors: theme.colorMap } : {}
  return {
    ...(theme?.density ?? DENSITY_THEME)[l.geom],
    ...map,
    ...l.style,
    ...l.series?.[key]?.style,
  } as unknown as Style<G>
}

/** Values to colours on a density layer's colour map (log: by log10 of the value). */
export function densityColors(
  style: {
    colors: NonNullable<LayerOf<'hex'>['style']>['colors']
    reverse?: boolean
    log?: boolean
  },
  lo: number,
  hi: number,
) {
  const tr = transformOf(style.log ? 'log10' : 'linear')
  // One value (every hexagon one count): a range up to twice it, so the colour bar has a length.
  const top = hi > lo ? hi : lo + (lo === 0 ? 1 : Math.abs(lo))
  const [t0, t1] = [tr.forward(lo), tr.forward(top)]
  const t = (v: number) => (t1 > t0 ? (tr.forward(v) - t0) / (t1 - t0) : 1)
  return {
    lo,
    hi: top,
    transform: tr,
    color: (v: number) => colorAlong(style.colors ?? 'viridis', t(v), style.reverse),
  }
}

/** The colour scale and heading a density layer shows in the legend. */
export interface DensityGuide {
  layer: LayerOf<'hex' | 'contour' | 'raster'>
  heading: string
  scale: ReturnType<typeof densityColors>
  integer?: boolean
}

/** Legend entries of the density layers' colour bars (each layer's heading and bar). */
export function densityGuides(
  ctx: GraphContext,
  palette: readonly string[],
  guides: readonly DensityGuide[],
): LegendEntry[] {
  return guides.flatMap((g) => {
    if (g.layer.legend === 'hide' || !(g.scale.hi >= g.scale.lo)) return []
    const target: StylePath = ['layers', g.layer.id]
    const key = `density/${g.layer.id}`
    return [
      {
        key,
        id: `legend/${key}`,
        target,
        label: g.heading,
        sample: () => [],
        group: key,
        fixed: true,
      },
      colorBarEntry({
        group: key,
        ctx,
        palette,
        target,
        key: `${key}/bar`,
        scale: g.scale,
        ...(g.scale.transform.kind !== 'linear' ? { transform: g.scale.transform } : {}),
        ...(g.integer ? { integer: true } : {}),
      }),
    ]
  })
}

// --- Hexagons --------------------------------------------------------------------------------

/**
 * A hex layer's hexagons over the points (the cells of `hexbin`, regular on screen: shape the
 * plot's height over its width across the points' span), each a polygon coloured by its count;
 * returns the colour scale for the legend.
 */
export function drawHexes(
  kit: LayerKit,
  layer: LayerOf<'hex'>,
  key: string,
  p: PlotPoints,
  axes: DensityAxes,
  owner: DataTable | undefined,
): DensityGuide | null {
  const bins = layer.stat.kind === 'hexbin' ? (layer.stat.bins ?? HEX_BINS) : HEX_BINS
  const [x0, x1, y0, y1] = p.lims
  const wPx = Math.abs(axes.px(x1) - axes.px(x0))
  const hPx = Math.abs(axes.py(y1) - axes.py(y0))
  const shape = wPx > 0 && hPx > 0 ? hPx / wPx : 1
  const h = cached([owner, p], `hex|${bins}|${shape.toFixed(9)}`, () => hexCellsOf(p, bins, shape))
  if (!h?.count.length) return null
  const style = densityStyle(layer, key, kit.theme)
  const [lo, hi] = valueRange(h.count, true)
  const scale = densityColors(style, lo, hi)
  const centers = hexCenters(h)
  const corners = hexCorners(h)
  const border = style.border.width > 0 ? resolveStroke(style.border, kit.palette) : null
  const part = kit.part(layer, key, 'hex')
  const target = ['seriesOverrides', key, 'hex']
  for (let k = 0; k < h.cell.length; k++) {
    const cx = centers.x[k]!
    const cy = centers.y[k]!
    const parts = fillParts(
      axes,
      corners.map(([dx]) => cx + dx),
      corners.map(([, dy]) => cy + dy),
    )
    parts.forEach((points, j) => {
      kit.add(layer, key, {
        id: `series/${key}/${part}/${h.cell[k]}${j ? `/${j}` : ''}`,
        target,
        prim: {
          type: 'polygon',
          points,
          fill: { color: scale.color(h.count[k]!), opacity: style.opacity ?? 1 },
          stroke: border,
        },
      })
    })
  }
  return { layer, heading: 'Count', scale, integer: !style.log }
}

// --- Contours --------------------------------------------------------------------------------

/** A group of points a contour layer draws the density of (a colour level, or every row). */
export interface DensityGroup {
  key: string
  id: (part: string) => string
  target: StylePath
  color: string
  /** Roadmap 49d: its place among the groups (a line pattern by group; absent: 0). */
  index?: number
  /** Its points' rows' indices into the plot points (`PlotPoints`), or null for every point. */
  members: Int32Array | null
  /** A stable name for caching (the level's text). */
  name: string
}

/** The density grid and the density at the points of one group (cached). */
function groupDensity(
  p: PlotPoints,
  g: DensityGroup,
  stat: { adjust?: number; n?: number },
  owner: DataTable | undefined,
): { grid: Density2d | null; at: Float64Array | null } {
  return cached([owner, p], `kde|${g.name}|${stat.adjust ?? 1}|${stat.n ?? ''}`, () => {
    const m = g.members
    const tx = m ? Float64Array.from(m, (i) => p.tx[i]!) : p.tx
    const ty = m ? Float64Array.from(m, (i) => p.ty[i]!) : p.ty
    const grid = densityGrid(tx, ty, p.lims, stat)
    return { grid, at: grid ? pointDensities(grid, tx, ty) : null }
  })
}

/** Path commands of rings (each closed). */
const ringsPath = (rings: readonly (readonly [number, number])[][]): PathCmd[] =>
  rings.flatMap((r): PathCmd[] =>
    r.length < 3
      ? []
      : [['M', r[0]![0], r[0]![1]], ...r.slice(1).map(([x, y]): PathCmd => ['L', x, y]), ['Z']],
  )

/**
 * A contour layer's lines and filled bands of each group's density (`density2d`): the levels
 * ggplot2 draws (`pretty` of every group's densities, the same for all) or those enclosing
 * shares of each group's points. Lines in the group's colour (or the layer's); bands filled with
 * the regions at or above each level, stacked from the lowest — by level on the colour map with
 * one group, each group's colour at a low opacity per level with several. Returns the colour
 * scale of the bands for the legend (one group).
 */
export function drawContours(
  kit: LayerKit,
  layer: LayerOf<'contour'>,
  p: PlotPoints,
  groups: readonly DensityGroup[],
  axes: DensityAxes,
  owner: DataTable | undefined,
): DensityGuide | null {
  if (layer.stat.kind !== 'density2d' || !groups.length) return null
  const stat = layer.stat
  const dens = groups.map((g) => groupDensity(p, g, stat, owner))
  const levels = contourLevels(
    stat,
    dens.map((d) => d.grid),
    dens.map((d) => d.at),
  )
  const toPx = (x: readonly number[], y: readonly number[]) =>
    x.map((v, i): [number, number] => [axes.px(v), axes.py(y[i]!)])
  const one = groups.length === 1
  let guide: DensityGuide | null = null
  groups.forEach((g, gi) => {
    const grid = dens[gi]!.grid
    if (!grid) return
    const style = densityStyle(layer, g.key, kit.theme)
    const ls = levels[gi]!
    const zMin = valueRange(grid.z, true)[0]
    // Bands: the regions at or above each level drawn above the grid's least value (the whole
    // grid isn't filled), lowest first.
    if (style.draw !== 'lines') {
      const filled = ls.filter((l) => l > zMin)
      const scale = densityColors(style, filled[0] ?? 0, filled.at(-1) ?? 1)
      if (one && filled.length) guide = { layer, heading: 'Density', scale }
      filled.forEach((level, k) => {
        const rings = levelRegion(grid, level).flatMap((r) =>
          axes.breaks ? fillParts(axes, r.x, r.y) : [clipPolygon(toPx(r.x, r.y), axes.W, axes.H)],
        )
        const d = ringsPath(rings)
        if (!d.length) return
        const fill = one
          ? { color: scale.color(level), opacity: style.opacity ?? 1 }
          : { color: g.color, opacity: style.opacity ?? GROUP_BAND_OPACITY }
        kit.add(layer, g.key, {
          id: g.id(`${kit.part(layer, g.key, 'band')}/${k}`),
          target: [...g.target, 'contour'],
          prim: { type: 'path', d, fill, stroke: null },
        })
      })
    }
    if (style.draw !== 'bands' && style.stroke.width > 0) {
      const line = groupStroke(style.stroke, graphDashes(kit.graph, kit.theme), g.index)
      const stroke = resolveStroke(line, kit.palette, g.color)
      const part = kit.part(layer, g.key, 'contour')
      contourLines(grid, ls).forEach((line, k) => {
        const pts = toPx(line.x, line.y)
        if (line.closed && pts.length) pts.push(pts[0]!)
        clipPolyline(pts, axes.W, axes.H).forEach((run, j) => {
          kit.add(layer, g.key, {
            id: g.id(`${part}/${k}/${j}`),
            target: [...g.target, 'contour'],
            prim: { type: 'polyline', points: run, stroke },
          })
        })
      })
    }
  })
  return guide
}

// --- Density image ---------------------------------------------------------------------------

/**
 * A raster layer's image of the points' density (`density2d`): the grid's cells as pixels
 * coloured on the layer's colour map (each centred on its grid point), as an image over the
 * grid's span, cut to the plot. Returns the colour scale for the legend.
 */
export function drawRaster(
  kit: LayerKit,
  layer: LayerOf<'raster'>,
  key: string,
  p: PlotPoints,
  axes: DensityAxes,
  owner: DataTable | undefined,
): DensityGuide | null {
  if (layer.stat.kind !== 'density2d') return null
  const stat = layer.stat
  const { grid } = groupDensity(
    p,
    { key, id: () => '', target: [], color: '', members: null, name: '' },
    stat,
    owner,
  )
  if (!grid) return null
  const style = densityStyle(layer, key, kit.theme)
  const [lo, hi] = valueRange(grid.z, true)
  const scale = densityColors(style, lo, hi)
  const n1 = grid.x.length
  const n2 = grid.y.length
  // Pixel columns left to right and rows top to bottom, whichever way the axes run.
  // With axis breaks, grid points inside one sit at its edge (none is NaN; G2).
  const { px, py } = axes.breaks ?? axes
  const xs = Array.from(grid.x, (v) => px(v))
  const ys = Array.from(grid.y, (v) => py(v))
  const cols = [...xs.keys()].sort((a, b) => xs[a]! - xs[b]!)
  const rows = [...ys.keys()].sort((a, b) => ys[a]! - ys[b]!)
  const half = (v: readonly number[]) => Math.abs(v.at(-1)! - v[0]!) / Math.max(1, v.length - 1) / 2
  const [hx, hy] = [half(xs), half(ys)]
  const box = {
    x: Math.min(...xs) - hx,
    y: Math.min(...ys) - hy,
    w: Math.abs(xs.at(-1)! - xs[0]!) + 2 * hx,
    h: Math.abs(ys.at(-1)! - ys[0]!) + 2 * hy,
  }
  const rgba = new Uint8Array(n1 * n2 * 4)
  const alpha = Math.round((style.opacity ?? 1) * 255)
  rows.forEach((j, r) => {
    cols.forEach((i, c) => {
      const v = grid.z[i + j * n1]!
      if (!Number.isFinite(v)) return
      const [R, G, B] = hexToRgb(scale.color(v))
      const o = (r * n1 + c) * 4
      rgba[o] = R
      rgba[o + 1] = G
      rgba[o + 2] = B
      rgba[o + 3] = alpha
    })
  })
  const w = pngWriter(n1, n2, { alpha: true, dpi: 72, level: 6 })
  w.write(rgba)
  const asset = {
    id: '0'.repeat(32) as AssetId,
    mime: 'image/png' as const,
    width: n1,
    height: n2,
    bytes: w.finish(),
  }
  // Cut to the plot.
  const x0 = Math.max(0, box.x)
  const y0 = Math.max(0, box.y)
  const x1 = Math.min(axes.W, box.x + box.w)
  const y1 = Math.min(axes.H, box.y + box.h)
  if (!(x1 > x0 && y1 > y0)) return null
  const crop =
    x0 > box.x || y0 > box.y || x1 < box.x + box.w || y1 < box.y + box.h
      ? {
          crop: {
            x: (x0 - box.x) / box.w,
            y: (y0 - box.y) / box.h,
            w: (x1 - x0) / box.w,
            h: (y1 - y0) / box.h,
          },
        }
      : {}
  kit.add(layer, key, {
    id: `series/${key}/${kit.part(layer, key, 'raster')}`,
    target: ['seriesOverrides', key, 'raster'],
    prim: { type: 'image', x: x0, y: y0, w: x1 - x0, h: y1 - y0, asset, ...crop },
  })
  return { layer, heading: 'Density', scale }
}
