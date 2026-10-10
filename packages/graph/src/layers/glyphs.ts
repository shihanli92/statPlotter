import type { Geom } from '@ps/model'

// Each geom's legend glyph (audit 2, G4; beside the matrix, `matrix.ts`): what a data set's
// legend sample draws when that geom's layer is what stands for the data set. Null: the geom
// draws no mark in a data set's own look (a label's text, a reference line, lines joining data
// sets, a difference axis), or its frame keeps a legend of its own (tiles, wedges, densities:
// colour bars and swatches by level).

/** A legend sample's kind: a swatch, a symbol, or a short line in a mark's stroke. */
export type LegendGlyph =
  /** A bar's fill and border. */
  | 'bar'
  /** A box's (or violin's) fill and border. */
  | 'box'
  /** A point's symbol. */
  | 'points'
  /** A censored time's tick (survival curves). */
  | 'censor'
  /** An area's fill (no border). */
  | 'area'
  /** An error envelope's fill (no border). */
  | 'band'
  /** A line in the joining line's stroke. */
  | 'line'
  /** A short line in the centre line's stroke. */
  | 'center'
  /** An error bar (with its caps) in the error bars' stroke. */
  | 'errorbar'
  /** An ellipse's or hull's fill and outline. */
  | 'polygon'
  /** A path's or vector's line with its head. */
  | 'arrow'

export const LEGEND_GLYPHS: Readonly<Record<Geom, LegendGlyph | null>> = {
  points: 'points',
  bar: 'bar',
  errorbar: 'errorbar',
  center: 'center',
  box: 'box',
  violin: 'box',
  line: 'line',
  step: 'line',
  censor: 'censor',
  area: 'area',
  band: 'band',
  connector: null,
  refline: null,
  difference: null,
  tile: null,
  wedge: null,
  label: null,
  polygon: 'polygon',
  path: 'arrow',
  segment: 'arrow',
  hex: null,
  contour: null,
  raster: null,
}

/**
 * Which layer's glyph stands for a data set drawn by several: the first kind here that a layer
 * drawing it has (bars before boxes before points, as before audit 2; then a coloured line, an
 * area or band, error bars, a centre line). By kind, not by the layers' order, so moving a layer
 * front or back moves only its marks, never the legend (`zorder.test.ts`).
 */
export const GLYPH_PRECEDENCE: readonly LegendGlyph[] = [
  'bar',
  'box',
  'points',
  'censor',
  'polygon',
  'arrow',
  'line',
  'area',
  'band',
  'errorbar',
  'center',
]

/** The layer whose glyph stands for a data set among those drawing it (first in the list, of the
 * first kind by `GLYPH_PRECEDENCE`), and its glyph. */
export function glyphLayer<L extends { geom: Geom }>(
  drawing: readonly L[],
  allowed: readonly LegendGlyph[] = GLYPH_PRECEDENCE,
): [LegendGlyph, L] | undefined {
  for (const g of GLYPH_PRECEDENCE) {
    if (!allowed.includes(g)) continue
    const l = drawing.find((x) => LEGEND_GLYPHS[x.geom] === g)
    if (l) return [g, l]
  }
  return undefined
}
