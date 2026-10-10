import { type LegendSpec, labelRuns, type RichText } from '@ps/model'
import { type GraphSeries, seriesTitle } from '../data.ts'
import type { LegendGlyph } from '../layers/glyphs.ts'
import type { Fill, LegendItem, SceneNode, Stroke, StylePath } from '../scene.ts'
import { layoutText } from '../text/layout.ts'
import {
  graphText,
  type ResolvedSeriesStyle,
  resolveFill,
  resolveStroke,
  type Theme,
} from '../theme.ts'
import type { GraphContext } from './common.ts'
import { symbolPaint } from './points.ts'
import { placeText } from './text.ts'

/** Distance between the plot (or its right-hand labels) and a legend on the right. */
export const LEGEND_GAP = 12
export const LEGEND_ROW = 16
/** Space between a sample and its label, between columns, and inside a legend box. */
export const LEGEND_LABEL_GAP = 4
export const LEGEND_COLUMN_GAP = 12
export const LEGEND_BOX_PAD = 4
/** Distance of a default 'inside' legend from the plot's top-right corner. */
export const LEGEND_INSIDE_PAD = 6
/** Space between a 'top' legend and the plot. */
export const LEGEND_TOP_GAP = 8

export interface LegendEntry {
  /**
   * Data set key, extra-series id or another entry's own key, matched against `legend.hidden`,
   * `legend.order` and `legend.labels`.
   */
  key: string
  /** Scene id of the entry, e.g. 'legend/<key>'. */
  id: string
  target: StylePath
  /** Plain or rich text (formatted data set titles). */
  label: string | RichText
  /** Draws the sample (line, symbol, swatch) with its left edge at x, centred on cy. */
  sample: (x: number, cy: number) => SceneNode[]
  /** Height of the entry's row when taller than a text row (e.g. a large bubble). */
  height?: number
  /** The entry's whole width, when its sample is wider than the samples' column (a colour bar). */
  width?: number
  /**
   * Roadmap 47b: the group of entries it is ordered within (`legend.order`): a mapped variable's
   * guide, a density layer's colour bar…; absent: the data sets' group (data sets, curves,
   * functions, Significance classes, result lines, pie categories).
   */
  group?: string
  /**
   * Roadmap 47b: a heading, a colour bar, or a "… more" or "Missing" line: it keeps its place in
   * its group and its own label (never ordered, relabelled or selected as an entry).
   */
  fixed?: boolean
  /** Roadmap 47b: runs after the label (a result's values), kept after a legend-only label. */
  suffix?: RichText
}

/** Roadmap 47b: the group of the data sets' entries (and every entry without a group of its own). */
export const DATA_SET_GROUP = 'dataSets'

/**
 * Roadmap 47b: `entries` reversed when the legend asks (`reverse`), unless its `order` lists a key
 * of their group (`group`: the group's entries, these by default): `reverse` doesn't apply to an
 * ordered group.
 */
export function reversedEntries<T extends { key: string }>(
  legend: Pick<LegendSpec, 'reverse' | 'order'>,
  entries: T[],
  group: readonly { key: string }[] = entries,
): T[] {
  if (!legend.reverse) return entries
  if (legend.order?.length) {
    const listed = new Set(legend.order)
    if (group.some((e) => listed.has(e.key))) return entries
  }
  return [...entries].reverse()
}

/**
 * Roadmap 47b: the entries in the legend's order — within each group, the movable entries
 * `order` lists in its order, then the others in their own, in the places the group's movable
 * entries had (headings, colour bars and "… more" lines stay put, as do other groups).
 */
export function orderedEntries<T extends Pick<LegendEntry, 'key' | 'group' | 'fixed'>>(
  order: readonly string[] | undefined,
  all: readonly T[],
): T[] {
  if (!order?.length) return [...all]
  const rank = new Map<string, number>()
  order.forEach((k, i) => {
    if (!rank.has(k)) rank.set(k, i)
  })
  const slots = new Map<string, number[]>()
  all.forEach((e, i) => {
    if (e.fixed) return
    const g = e.group ?? DATA_SET_GROUP
    const list = slots.get(g)
    if (list) list.push(i)
    else slots.set(g, [i])
  })
  const out = [...all]
  for (const at of slots.values()) {
    const members = at.map((i) => all[i]!)
    if (!members.some((e) => rank.has(e.key))) continue
    const listed = members
      .filter((e) => rank.has(e.key))
      .sort((a, b) => rank.get(a.key)! - rank.get(b.key)!)
    const rest = members.filter((e) => !rank.has(e.key))
    const seq = [...listed, ...rest]
    at.forEach((slot, j) => {
      out[slot] = seq[j]!
    })
  }
  return out
}

/**
 * Roadmap 47b: an entry as the legend shows it — its legend-only label (`legend.labels`; not a
 * fixed entry's) in place of its own, then its suffix.
 */
export function labelledEntry(labels: LegendSpec['labels'], e: LegendEntry): LegendEntry {
  const own = !e.fixed && labels && Object.hasOwn(labels, e.key) ? labels[e.key]! : e.label
  if (e.suffix) return { ...e, label: [...labelRuns(own), ...e.suffix] }
  return own === e.label ? e : { ...e, label: own }
}

/**
 * Roadmap 47b: every entry the legend has, in its order, for the legend's editors (the Format
 * panel's list, the canvas' reordering): shown or hidden, with their own labels.
 */
export function legendItems(spec: LegendSpec, all: readonly LegendEntry[]): LegendItem[] {
  const hidden = new Set(spec.hidden ?? [])
  return orderedEntries(spec.order, all).map((e) => ({
    key: e.key,
    group: e.group ?? DATA_SET_GROUP,
    label: e.label,
    hidden: hidden.has(e.key),
    ...(e.fixed ? { fixed: true } : {}),
  }))
}

/** Width of legend samples (swatches and symbols) on column and grouped graphs. */
export const SWATCH = 14
/** Width of legend samples (line and symbol) on XY and survival graphs. */
export const LEGEND_SAMPLE = 22

/** A swatch's rectangle, left edge at x, centred on cy. */
export const swatchRect = (x: number, cy: number) => ({
  x,
  y: cy - SWATCH / 2 + 2,
  w: SWATCH,
  h: SWATCH - 4,
})

/** A point symbol sample centred on (cx, cy). */
export function symbolSample(
  id: string,
  target: StylePath,
  style: ResolvedSeriesStyle,
  color: string,
  palette: readonly string[],
  cx: number,
  cy: number,
): SceneNode {
  const { shape, size } = style.points
  const paint = symbolPaint(style.points, palette, color)
  return { id: `${id}/symbol`, target, prim: { type: 'symbol', shape, cx, cy, size, ...paint } }
}

/** A line sample, LEGEND_SAMPLE long from x, at cy. */
export const lineSample = (
  id: string,
  target: StylePath,
  stroke: Stroke,
  x: number,
  cy: number,
): SceneNode => ({
  id: `${id}/line`,
  target,
  prim: { type: 'line', x1: x, y1: cy, x2: x + LEGEND_SAMPLE, y2: cy, stroke },
})

/**
 * Roadmap 34c: an ellipse's or hull's sample — a small ellipse with its fill and outline, left edge
 * at x, centred on cy.
 */
export function polygonSample(
  id: string,
  target: StylePath,
  paint: { fill: Fill | null; stroke: Stroke | null },
  x: number,
  cy: number,
): SceneNode {
  return {
    id: `${id}/polygon`,
    target,
    prim: { type: 'ellipse', cx: x + SWATCH / 2, cy, rx: SWATCH / 2, ry: SWATCH / 3, ...paint },
  }
}

/**
 * Legend sample for a bar/box (swatch), points (symbol), an area or band (its fill), or a line,
 * centre line, error bar or censored time's tick (its stroke), SWATCH wide: left edge at x,
 * centred on cy.
 */
export function swatchSample(
  id: string,
  target: StylePath,
  kind: Exclude<LegendGlyph, 'polygon' | 'arrow'>,
  style: ResolvedSeriesStyle,
  color: string,
  palette: readonly string[],
  x: number,
  cy: number,
): SceneNode {
  if (kind === 'points') return symbolSample(id, target, style, color, palette, x + SWATCH / 2, cy)
  // An area or an error envelope: its fill, as drawn (no border).
  if (kind === 'area' || kind === 'band')
    return {
      id: `${id}/swatch`,
      target,
      prim: {
        type: 'rect',
        ...swatchRect(x, cy),
        stroke: null,
        fill: { color, opacity: kind === 'area' ? style.area.opacity : style.envelope.opacity },
      },
    }
  // Audit 2 (G4): a joining line or centre line across the sample, an error bar up it.
  if (kind === 'line' || kind === 'center') {
    const stroke = resolveStroke(
      kind === 'line' ? style.line.stroke : style.center.line,
      palette,
      color,
    )
    return {
      id: `${id}/line`,
      target,
      prim: { type: 'line', x1: x, y1: cy, x2: x + SWATCH, y2: cy, stroke },
    }
  }
  if (kind === 'censor') {
    const stroke = resolveStroke(style.points.border, palette, color)
    const [mid, h] = [x + SWATCH / 2, style.points.size / 2]
    return {
      id: `${id}/censor`,
      target,
      prim: { type: 'line', x1: mid, y1: cy - h, x2: mid, y2: cy + h, stroke },
    }
  }
  if (kind === 'errorbar') {
    const stroke = resolveStroke(style.error.line, palette, color)
    const [mid, half, cap] = [x + SWATCH / 2, SWATCH / 2 - 1, style.error.capWidth > 0 ? 3 : 0]
    const lines: [number, number, number, number][] = [[mid, cy - half, mid, cy + half]]
    if (cap) lines.push([mid - cap, cy - half, mid + cap, cy - half])
    if (cap) lines.push([mid - cap, cy + half, mid + cap, cy + half])
    return {
      id: `${id}/error`,
      target,
      children: lines.map(([x1, y1, x2, y2], k) => ({
        id: `${id}/error/${k}`,
        target,
        prim: { type: 'line', x1, y1, x2, y2, stroke },
      })),
    }
  }
  const s = kind === 'bar' ? style.bar : style.box
  return {
    id: `${id}/swatch`,
    target,
    prim: {
      type: 'rect',
      ...swatchRect(x, cy),
      stroke: resolveStroke(s.border, palette, color),
      fill: resolveFill(s.fill, palette, color),
    },
  }
}

/** One entry per data set, labelled with its title, its sample drawn by `sample`. */
export function seriesEntries<P extends { s: GraphSeries }>(
  series: readonly P[],
  sample: (p: P, id: string, target: StylePath, x: number, cy: number) => SceneNode[],
): LegendEntry[] {
  return series.map((p) => {
    const id = `legend/${p.s.key}`
    const target = ['seriesOverrides', p.s.key]
    return {
      key: p.s.key,
      id,
      target,
      label: seriesTitle(p.s),
      sample: (x, cy) => sample(p, id, target, x, cy),
    }
  })
}

export interface LegendBlock {
  position: 'right' | 'top' | 'inside'
  width: number
  height: number
  /** The legend with its top-left corner at (x, y), in graph coordinates. */
  draw: (x: number, y: number) => SceneNode
}

/** Most entries a legend lists (roadmap 34e); the rest are counted in a last line. */
export const LEGEND_MAX_ENTRIES = 100

/**
 * Measures the legend: entries (in the legend's order, minus `legend.hidden`, with their
 * legend-only labels) in a grid of `legend.columns` columns (default: one row for 'top', one
 * column otherwise) filled across its rows (or, `fill: 'columns'`, down its columns), with an
 * optional box. Null when the legend is off or empty.
 */
export function legendBlock(
  ctx: GraphContext,
  theme: Theme,
  palette: readonly string[],
  all: readonly LegendEntry[],
  sampleWidth: number,
): LegendBlock | null {
  const { graph, fonts } = ctx
  const spec = graph.legend
  const hidden = new Set(spec.hidden ?? [])
  // Roadmap 47b: ordered and labelled here, once, for every frame (before the cap).
  const shown = spec.show
    ? orderedEntries(spec.order, all)
        .filter((e) => !hidden.has(e.key))
        .map((e) => labelledEntry(spec.labels, e))
    : []
  // Roadmap 34e: a legend of thousands of entries (data sets that are the levels of a text
  // variable of thousands) lists the first `LEGEND_MAX_ENTRIES`, then how many more there are.
  const entries =
    shown.length > LEGEND_MAX_ENTRIES
      ? [
          ...shown.slice(0, LEGEND_MAX_ENTRIES),
          {
            key: '\u0000more',
            id: 'legend/more',
            target: ['legend'],
            label: `… and ${(shown.length - LEGEND_MAX_ENTRIES).toLocaleString('en-US')} more`,
            sample: () => [],
            fixed: true,
          },
        ]
      : shown
  if (!entries.length) return null
  const style = graphText(theme.legend, graph, spec.text)
  const widths = entries.map(
    (e) =>
      e.width ??
      sampleWidth + LEGEND_LABEL_GAP + layoutText(fonts, labelRuns(e.label), style).width,
  )
  const n = entries.length
  const asked = Math.max(1, Math.min(n, spec.columns ?? (spec.position === 'top' ? n : 1)))
  const rows = Math.ceil(n / asked)
  // Roadmap 47b: down the columns, as many columns as the rows need (5 in 4 asked: 3 of 2).
  const down = spec.fill === 'columns'
  const cols = down ? Math.ceil(n / rows) : asked
  const colOf = (i: number) => (down ? Math.floor(i / rows) : i % cols)
  const rowOf = (i: number) => (down ? i % rows : Math.floor(i / cols))
  const colWidth = Array.from({ length: cols }, (_, c) =>
    Math.max(0, ...widths.filter((_, i) => colOf(i) === c)),
  )
  const colX = colWidth.map((_, c) =>
    colWidth.slice(0, c).reduce((a, w) => a + w + LEGEND_COLUMN_GAP, 0),
  )
  const boxed = !!(spec.border || (spec.background && spec.background.type !== 'none'))
  const pad = boxed ? LEGEND_BOX_PAD : 0
  const inner = colWidth.reduce((a, b) => a + b, 0) + (cols - 1) * LEGEND_COLUMN_GAP
  const width = inner + 2 * pad
  // Rows are a text row high (taller for a label with larger runs, in proportion), or as tall as
  // their tallest sample.
  const textRow = (e: LegendEntry) =>
    LEGEND_ROW * Math.max(1, ...labelRuns(e.label).map((r) => (r.size ?? 0) / style.size))
  const rowHeight = Array.from({ length: rows }, (_, r) =>
    Math.max(
      ...entries.filter((_, i) => rowOf(i) === r).map((e) => Math.max(textRow(e), e.height ?? 0)),
    ),
  )
  const rowY = rowHeight.map((_, r) => rowHeight.slice(0, r).reduce((a, h) => a + h, 0))
  const height = rowHeight.reduce((a, h) => a + h, 0) + 2 * pad

  return {
    position: spec.position,
    width,
    height,
    draw: (x, y) => {
      const children: SceneNode[] = []
      if (boxed) {
        children.push({
          id: 'legend/box',
          target: ['legend'],
          prim: {
            type: 'rect',
            x,
            y,
            w: width,
            h: height,
            stroke: spec.border ? resolveStroke(spec.border, palette) : null,
            fill: spec.background ? resolveFill(spec.background, palette) : null,
          },
          bbox: { x, y, w: width, h: height },
        })
      }
      entries.forEach((e, i) => {
        const col = colOf(i)
        const row = rowOf(i)
        const lx = x + (pad + colX[col]!)
        const rh = rowHeight[row]!
        const ly = y + (pad + rowY[row]! + rh / 2)
        children.push({
          id: e.id,
          target: e.target,
          children: [
            ...e.sample(lx, ly),
            placeText(
              fonts,
              `${e.id}/label`,
              labelRuns(e.label),
              style,
              palette,
              lx + sampleWidth + LEGEND_LABEL_GAP,
              ly,
              'start',
              'middle',
              { target: e.target },
            ).node,
          ],
          bbox: { x: lx, y: ly - rh / 2, w: colWidth[col]!, h: rh },
          // Roadmap 47b: what selecting and moving the entry acts on.
          ...(e.fixed ? {} : { legendEntry: { key: e.key, group: e.group ?? DATA_SET_GROUP } }),
        })
      })
      return { id: 'legend', target: ['legend'], children, bbox: { x, y, w: width, h: height } }
    },
  }
}
