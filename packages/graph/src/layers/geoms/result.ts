import {
  type AnalysisNode,
  axisUnit,
  type FieldDataSet,
  fillTemplate,
  formatField,
  type GraphableDataSet,
  type GraphNode,
  isValueSourced,
  type Layer,
  type LayerOf,
  labelPlain,
  nodeById,
  type ResultRef,
  type ResultStat,
  type ResultValue,
  type RichText,
  resolveResultRef,
  richPlain,
  type StrokeStyle,
  type TextStyle,
  valueNumber,
} from '@ps/model'
import type { LegendEntry } from '../../layout/legend.ts'
import { LEGEND_SAMPLE, SWATCH, swatchRect } from '../../layout/legend.ts'
import { placeLabels, type RepelLabel, type RepelObstacle } from '../../layout/repel.ts'
import { placeText } from '../../layout/text.ts'
import type { Scale } from '../../scale.ts'
import type { Box, SceneNode, StylePath } from '../../scene.ts'
import { layoutText } from '../../text/layout.ts'
import { graphText, resolveColor, resolveStroke } from '../../theme.ts'
import type { FramePlane, LayerKit } from '../kit.ts'
import { lineEquation, slopedRuns, slopedValues } from './sloped.ts'
import { cutoffValue } from './threshold.ts'

// Results on graphs (roadmap 35): layers with an analysis source (`data: { from: 'analysis' }`,
// stat `result`) — labels of an analysis' values ("r = 0.82, P = 0.003") in a corner, at a data
// position or beside a fitted curve's end; reference lines at a value (across the plot, along it
// at an X, or drop lines from a curve's point to the axes); bands between two values. Every frame
// with value axes draws them through `drawResults`; their values come from the analysis' latest
// result (`ctx.result`), so they are live. Fields read once, or once per data set (`per`), in
// its colour.

/** Theme defaults of result layers. */
export const RESULT_THEME = {
  /** Labels: the point labels' text (9 pt), a little in from the plot's edges, stacked. */
  pad: 4,
  gap: 1,
  box: { fill: '#ffffff', opacity: 0.85, border: '#7f7f7f', pad: 2 },
  halo: { color: '#ffffff', width: 2.5 },
  /** Lines: dashed, in the data set's colour (else grey). */
  line: { color: { series: true }, width: 1, dash: 'dash' } satisfies StrokeStyle,
  /** Bands: the data set's colour (else grey) at 20%. */
  opacity: 0.2,
  grey: '#808080',
} as const

/** A layer drawing an analysis' results, or values typed in (roadmap 36: manual lines, bands). */
export type ResultLayer = LayerOf<'label' | 'refline' | 'band'> & {
  stat: ResultStat
  data: { from: 'analysis'; analysis: AnalysisNode['id'] } | { from: 'values' }
}

export const isResultLayer = (l: Layer): l is ResultLayer =>
  isValueSourced(l) &&
  l.stat.kind === 'result' &&
  (l.geom === 'label' || l.geom === 'refline' || l.geom === 'band')

/** The analysis a result layer reads (none for values typed in). */
const analysisIdOf = (l: ResultLayer): AnalysisNode['id'] | undefined =>
  l.data.from === 'analysis' ? l.data.analysis : undefined

/** The analysis' latest result (none for values typed in, which need none). */
const resultOf = (kit: LayerKit, l: ResultLayer) => {
  const id = analysisIdOf(l)
  return id === undefined ? undefined : kit.ctx.result?.(id)
}

/** The graph's drawn result layers, in list order (of a geom when given). */
export const resultLayers = (kit: LayerKit, geom?: ResultLayer['geom']): ResultLayer[] =>
  kit.graph.layers.filter(
    (l): l is ResultLayer =>
      l.visible !== false && isResultLayer(l) && (geom === undefined || l.geom === geom),
  )

/** A data set as result layers see it: its key, title and colour. */
export interface ResultSeries {
  key: string
  title: string
  color: string
}

/** What a result layer draws once: for a data set (its fields read for it), or for the analysis. */
export interface ResultTarget {
  key: string | null
  ds: FieldDataSet | undefined
  color: string | null
  /** Roadmap 46b: a mirrored line's other one (at −c): its numbers read negated. */
  negate?: boolean
}

const analysisOf = (kit: LayerKit, l: ResultLayer): AnalysisNode | undefined => {
  const id = analysisIdOf(l)
  const n = id === undefined ? undefined : nodeById(kit.ctx.project.nodes, id)
  return n?.kind === 'analysis' ? n : undefined
}

/**
 * Whom a result layer draws for: the analysis once, or (`per: 'dataSet'`) each data set of the
 * graph it analyzed — else, for an analysis of a table's variables (fits per level), each data
 * set whose title one of its fields is found for.
 */
export function resultTargets(
  kit: LayerKit,
  layer: ResultLayer,
  series: readonly ResultSeries[],
): ResultTarget[] {
  // Values typed in (roadmap 36) are drawn once.
  if (layer.stat.per !== 'dataSet' || layer.data.from === 'values')
    return [{ key: null, ds: undefined, color: null }]
  const analysis = analysisOf(kit, layer)
  const shown = (s: ResultSeries) => kit.shows(layer, s.key)
  const byKey = series.filter((s) => shown(s) && analysis?.input.dataSets.includes(s.key))
  const result = resultOf(kit, layer)
  const settings = kit.ctx.project.settings
  const found = byKey.length
    ? byKey
    : series.filter(
        (s) =>
          shown(s) &&
          Object.values(layer.stat.fields).some(
            (f) => resolveResultRef(result, f.ref, settings, s) !== null,
          ),
      )
  return found.map((s) => ({ key: s.key, ds: { key: s.key, title: s.title }, color: s.color }))
}

/** A field's value as text for a target ("…" while the analysis computes; "—" when gone). */
export function resultText(
  kit: LayerKit,
  layer: ResultLayer,
  name: string,
  t: ResultTarget,
): RichText | null {
  const field = layer.stat.fields[name]
  if (!field) return null
  const result = resultOf(kit, layer)
  if (!result && layer.data.from === 'analysis') return [{ text: '…' }]
  const settings = kit.ctx.project.settings
  const v = negated(t, resolveRef(kit, result, field.ref, t))
  if (!v) warnMissing(kit, layer, name)
  const axis = field.format?.axisUnit
  const title = axis ? kit.graph.axes[axis].title : null
  const unit = title ? axisUnit(richPlain(title.content)) : null
  return formatField(v, field.format, settings, unit)
}

/** A field's number for a target (lines, bands), null when it has none. */
export function resultNumber(
  kit: LayerKit,
  layer: ResultLayer,
  name: string | undefined,
  t: ResultTarget,
): number | null {
  const field = name === undefined ? undefined : layer.stat.fields[name]
  if (!field) return null
  const result = resultOf(kit, layer)
  if (!result && layer.data.from === 'analysis') return null
  const v = negated(t, resolveRef(kit, result, field.ref, t))
  if (!v) warnMissing(kit, layer, name!)
  return valueNumber(v)
}

/**
 * A field's value: from the analysis' result, typed in, or (roadmap 46b) one of the graph's
 * cut-offs (`GraphNode.cutoffs`, shared with its Significance layer).
 */
function resolveRef(
  kit: LayerKit,
  result: ReturnType<typeof resultOf>,
  ref: ResultRef,
  t: ResultTarget,
): ResultValue | null {
  if (ref.from === 'cutoff') {
    const v = cutoffValue(kit.graph, ref.which)
    return Number.isFinite(v) ? { kind: 'number', v } : null
  }
  return resolveResultRef(result, ref, kit.ctx.project.settings, t.ds)
}

/** A value of a mirrored line's other one (roadmap 46b): its number negated. */
const negated = (t: ResultTarget, v: ResultValue | null): ResultValue | null =>
  t.negate && v && (v.kind === 'number' || v.kind === 'integer') ? { ...v, v: -v.v } : v

/**
 * The values a line of a layer stands at (roadmap 46b): its value, and with `mirror` its negative
 * too (once when 0).
 */
function mirrored(layer: ResultLayer, value: number): number[] {
  if (!layer.stat.mirror) return [value]
  const c = Math.abs(value)
  return c === 0 ? [0] : [c, -c]
}

function warnMissing(kit: LayerKit, layer: ResultLayer, name: string) {
  if (layer.data.from === 'values') {
    kit.warnings.push(
      `“${name}” of “${resultName(layer, kit.graph)}” isn’t a number: shown as “—”.`,
    )
    return
  }
  const a = analysisOf(kit, layer)
  kit.warnings.push(
    `“${name}” is no longer in the results of “${a?.name ?? 'the analysis'}”: shown as “—”.`,
  )
}

/** A label's text for a target: its template with the fields filled in. */
export function resultLabel(kit: LayerKit, layer: ResultLayer, t: ResultTarget): RichText {
  const { runs, unknown } = fillTemplate(layer.stat.template ?? '', (f) =>
    resultText(kit, layer, f, t),
  )
  for (const f of unknown)
    kit.warnings.push(`The label’s field {${f}} isn’t one of its fields: shown as “—”.`)
  return runs
}

/** The values a layer's lines and bands stand at on an axis, for the axes' extents. */
export function resultExtent(
  kit: LayerKit,
  axis: 'x' | 'y',
  series: readonly ResultSeries[],
  add: (v: number) => void,
): void {
  for (const l of resultLayers(kit)) {
    // Sloped lines (roadmap 46b) never widen the axes.
    if (l.geom === 'label' || l.stat.slope !== undefined) continue
    const on = l.stat.axis ?? 'y'
    for (const t of resultTargets(kit, l, series)) {
      if (l.geom === 'refline') {
        if (l.stat.drop) {
          if (axis === 'x') add(resultNumber(kit, l, l.stat.at, t) ?? Number.NaN)
        } else if (on === axis)
          for (const v of mirrored(l, resultNumber(kit, l, l.stat.at, t) ?? Number.NaN)) add(v)
      } else if (on === axis && l.stat.mirror) {
        // Roadmap 46b: a band between −c and +c (or beyond them) reaches both.
        const c = Math.abs(resultNumber(kit, l, l.stat.at, t) ?? Number.NaN)
        add(-c)
        add(c)
      } else if (on === axis) {
        add(resultNumber(kit, l, l.stat.lo, t) ?? Number.NaN)
        add(resultNumber(kit, l, l.stat.hi, t) ?? Number.NaN)
      }
    }
  }
}

/** A fitted curve of an analysis on the graph: its data and drawn points (plot-local). */
export interface ResultCurve {
  node: string
  /** The data set it was fitted to (its colour's), if any. */
  colorOf?: string
  data: GraphableDataSet
  color: string
}

/**
 * Where a frame draws results. Lines and bands are drawn in the frame's drawing frame (`U` × `V`;
 * a horizontal category graph's is the vertical one, turned afterwards): `v` maps a value on the
 * value (Y) axis, `u` an X value (XY frames only). Labels are placed where they are seen (`W` ×
 * `H`; `point` maps axis values, a category's index on category axes), boxes turned back with
 * `toDrawing` so the frame's turn puts them there.
 */
export interface ResultFrame {
  kit: LayerKit
  U: number
  V: number
  v: (y: number) => number
  u?: (x: number) => number
  W: number
  H: number
  point: (x: number, y: number) => [number, number]
  toDrawing?: (b: Box) => Box
  series: readonly ResultSeries[]
  curves?: readonly ResultCurve[]
  /** Drawn points (where they are seen) labels placed apart keep off. */
  obstacles?: readonly RepelObstacle[]
  /** A drawing-frame point where it is seen (a horizontal graph's turn; absent: the same). */
  toFinal?: (u: number, v: number) => [number, number]
  /** Roadmap 46b: the X and Y scales of a plot of two continuous axes (sloped lines). */
  scales?: { x: Scale; y: Scale }
}

/**
 * What result lines and bands drew, for the labels to keep off (drawing frame): their segments,
 * their bands' boxes, and each drop line's point on its curve (by layer analysis and data set).
 */
interface ResultMarks {
  segments: [number, number, number, number][]
  boxes: Box[]
  drops: Map<string, [number, number]>
  /** Roadmap 41: the labels of lines and bands, where seen (the free labels keep off them). */
  labels: Box[]
}

const dropKey = (analysis: string, key: string | null) => `${analysis}\u0000${key ?? ''}`

/** A target's curve: its data set's fit by the layer's analysis, else the analysis' first. */
function curveOf(f: ResultFrame, layer: ResultLayer, t: ResultTarget): ResultCurve | undefined {
  const id = analysisIdOf(layer)
  if (id === undefined) return undefined
  const own = (f.curves ?? []).filter((c) => c.node === id)
  return (t.key ? own.find((c) => c.colorOf === t.key) : undefined) ?? (t.key ? undefined : own[0])
}

/** A curve's Y at X: linear between its points (sorted by X), null outside them. */
export function curveAt(data: GraphableDataSet, x: number): number | null {
  const pts = data.x
    .map((vx, i) => [vx, data.y[i]!] as const)
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b))
    .sort((a, b) => a[0] - b[0])
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, y0] = pts[i]!
    const [x1, y1] = pts[i + 1]!
    if (x >= x0 && x <= x1) return x1 === x0 ? y0 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0)
  }
  return null
}

const finite = (...vs: number[]) => vs.every(Number.isFinite)

/** A target's id part: its data set's key, or 'all'. */
const part = (t: ResultTarget) => t.key ?? 'all'

/** Records a layer's marks for its target (a data set's, or the layer's as a whole). */
function record(kit: LayerKit, layer: Layer, t: ResultTarget, nodes: SceneNode[]) {
  if (!nodes.length) return
  if (t.key) kit.addList(layer, t.key, nodes)
  else kit.addWholeList(layer, nodes)
}

const targetOf = (layer: Layer, t: ResultTarget): StylePath =>
  t.key ? ['layers', layer.id, 'series', t.key] : ['layers', layer.id]

/**
 * A result line's default stroke: dashed, in its data set's colour (else grey); a sloped line
 * (roadmap 46b) the theme's reference line (dashed grey, a style's data line width), in its data
 * set's colour when drawn per data set.
 */
export function resultLineBase(
  theme: { refline: StrokeStyle },
  layer: Pick<ResultLayer, 'stat'>,
  perDataSet = false,
): StrokeStyle {
  if (layer.stat.slope === undefined) return RESULT_THEME.line
  return perDataSet ? { ...theme.refline, color: { series: true } } : theme.refline
}

/** A line's stroke: the layer's (the data set's own over it) over the theme's. */
function strokeOf(kit: LayerKit, layer: ResultLayer, t: ResultTarget, color: string | null) {
  const own = t.key ? (layer.series?.[t.key]?.style as { line?: StrokeStyle } | undefined) : {}
  const base = resultLineBase(kit.theme, layer, !!color)
  const style = { ...base, ...(layer.style as { line?: StrokeStyle })?.line }
  return resolveStroke({ ...style, ...own?.line }, kit.palette, color ?? RESULT_THEME.grey)
}

/** Lines of a refline layer: across or along the plot at its value, or drop lines. */
function drawLines(f: ResultFrame, layer: ResultLayer, drawn: ResultMarks) {
  const { kit } = f
  for (const t of resultTargets(kit, layer, f.series)) {
    if (layer.stat.slope !== undefined) {
      drawSloped(f, layer, t, drawn)
      continue
    }
    const value = resultNumber(kit, layer, layer.stat.at, t)
    if (value === null) continue
    const id = `result/${layer.id}/${part(t)}`
    const target = targetOf(layer, t)
    const nodes: SceneNode[] = []
    const line = (
      k: string,
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      color: string | null,
    ) => {
      if (!finite(x1, y1, x2, y2)) return
      drawn.segments.push([x1, y1, x2, y2])
      const stroke = strokeOf(kit, layer, t, color)
      nodes.push({
        id: `${id}/${k}`,
        target,
        prim: { type: 'line', x1, y1, x2, y2, stroke },
        bbox: {
          x: Math.min(x1, x2) - 2,
          y: Math.min(y1, y2) - 2,
          w: Math.abs(x2 - x1) + 4,
          h: Math.abs(y2 - y1) + 4,
        },
      })
    }
    const drop = layer.stat.drop
    // Roadmap 46b: ±c — a line at +c (its ids as one line's) and one at −c (`mirror/…`).
    const lines = drop ? [value] : mirrored(layer, value)
    if (lines.length > 1) {
      for (const [k, v] of lines.entries()) {
        const at = (name: string) => (k ? `mirror/${name}` : name)
        // Its label's numbers are the line's own: negated where the line is the value's negative.
        const tk: ResultTarget = v !== value ? { ...t, negate: true } : t
        const color = strokeOf(kit, layer, t, t.color).color
        if ((layer.stat.axis ?? 'y') === 'x') {
          if (!f.u) continue
          const px = f.u(v)
          if (!(px >= 0 && px <= f.U)) continue
          line(at('line'), px, 0, px, f.V, t.color)
          nodes.push(...lineLabel(f, layer, tk, [px, f.V], [px, 0], color, false, drawn, at))
        } else {
          const py = f.v(v)
          if (!(py >= 0 && py <= f.V)) continue
          line(at('line'), 0, py, f.U, py, t.color)
          nodes.push(...lineLabel(f, layer, tk, [0, py], [f.U, py], color, false, drawn, at))
        }
      }
    } else if (drop) {
      // From the curve's point at X down to the X axis and across to the Y axis.
      const curve = curveOf(f, layer, t)
      const y = curve ? curveAt(curve.data, value) : null
      if (!f.u || !curve || y === null) {
        kit.warnings.push('Drop lines need the analysis’ fitted curve on the graph at that X.')
        continue
      }
      const [px, py] = [f.u(value), f.v(y)]
      if (!(px >= 0 && px <= f.U && py >= 0 && py <= f.V)) continue
      const color = t.color ?? curve.color
      drawn.drops.set(dropKey(analysisIdOf(layer) ?? '', t.key), [px, py])
      if (drop !== 'y') line('drop/x', px, py, px, f.V, color)
      if (drop !== 'x') line('drop/y', 0, py, px, py, color)
    } else if ((layer.stat.axis ?? 'y') === 'x') {
      if (!f.u) continue
      const px = f.u(value)
      if (px >= 0 && px <= f.U) {
        line('line', px, 0, px, f.V, t.color)
        const color = strokeOf(kit, layer, t, t.color).color
        nodes.push(...lineLabel(f, layer, t, [px, f.V], [px, 0], color, false, drawn))
      }
    } else {
      const py = f.v(value)
      if (py >= 0 && py <= f.V) {
        line('line', 0, py, f.U, py, t.color)
        const color = strokeOf(kit, layer, t, t.color).color
        nodes.push(...lineLabel(f, layer, t, [0, py], [f.U, py], color, false, drawn))
      }
    }
    record(kit, layer, t, nodes)
  }
}

/**
 * Roadmap 46b: a sloped line y = slope·x + intercept across the plot, edge to edge (`slopedRuns`:
 * clipped to the plot, cut at axis breaks, bent on axes that bend it), with its label.
 */
function drawSloped(f: ResultFrame, layer: ResultLayer, t: ResultTarget, drawn: ResultMarks) {
  const { kit } = f
  const a = resultNumber(kit, layer, layer.stat.slope, t)
  const b =
    layer.stat.intercept === undefined ? 0 : resultNumber(kit, layer, layer.stat.intercept, t)
  if (a === null || b === null) return
  if (!f.scales) {
    kit.warnings.push('A sloped line needs a graph with two continuous axes (an XY graph).')
    return
  }
  const runs = slopedRuns(f.scales.x, f.scales.y, a, b, f.U, f.V)
  if (!runs.length) return
  const id = `result/${layer.id}/${part(t)}/line`
  const target = targetOf(layer, t)
  const stroke = strokeOf(kit, layer, t, t.color)
  const nodes: SceneNode[] = runs.map((points, k) => {
    for (let i = 1; i < points.length; i++)
      drawn.segments.push([points[i - 1]![0], points[i - 1]![1], points[i]![0], points[i]![1]])
    const xs = points.map((p) => p[0])
    const ys = points.map((p) => p[1])
    const [x0, y0] = [Math.min(...xs), Math.min(...ys)]
    return {
      id: k ? `${id}/${k}` : id,
      target,
      prim: { type: 'polyline', points, stroke },
      bbox: { x: x0 - 2, y: y0 - 2, w: Math.max(...xs) - x0 + 4, h: Math.max(...ys) - y0 + 4 },
    }
  })
  nodes.push(...slopedLabel(f, layer, t, runs, stroke.color, drawn))
  record(kit, layer, t, nodes)
}

/**
 * A sloped line's label (`stat.lineLabel`): its text level, at the line's start or end inside the
 * plot, beside the line — above it where there is room, else below — kept inside the plot.
 */
function slopedLabel(
  f: ResultFrame,
  layer: ResultLayer,
  t: ResultTarget,
  runs: readonly [number, number][][],
  color: string,
  drawn: ResultMarks,
): SceneNode[] {
  const at = layer.stat.lineLabel
  if (!at || !layer.stat.template) return []
  const { kit } = f
  const runsText = resultLabel(kit, layer, t)
  if (!richPlain(runsText)) return []
  const own = (layer.style as { text?: Partial<TextStyle> } | undefined)?.text
  const base = graphText(kit.theme.pointLabel, kit.graph, own)
  const text: TextStyle = own?.color ? base : { ...base, color: { rgb: color } }
  const tl = layoutText(kit.ctx.fonts, runsText, text)
  const [w, h] = [tl.width, tl.ascent + tl.descent]
  const pts = runs.flat()
  const end = at === 'end' ? pts.at(-1)! : pts[0]!
  const other = at === 'end' ? pts[0]! : pts.at(-1)!
  const G = LINE_LABEL_GAP
  // Along the plot from the end, towards the line's other end.
  const right = other[0] >= end[0]
  const x0 = right ? end[0] + G : end[0] - G - w
  const [lo, hi] = [x0, x0 + w]
  // The line's highest and lowest points over the label's width.
  const over = pts.filter((p) => p[0] >= lo && p[0] <= hi).map((p) => p[1])
  const yAt = (x: number) => lineY(pts, x)
  const ys = [...over, yAt(lo), yAt(hi)].filter(Number.isFinite)
  const top = ys.length ? Math.min(...ys) : end[1]
  const bottom = ys.length ? Math.max(...ys) : end[1]
  const above = top - G - h
  const below = bottom + G
  const fits = (y: number) => y >= 0 && y + h <= f.H
  const y = fits(above) ? above : fits(below) ? below : Math.min(Math.max(above, 0), f.H - h)
  const x = Math.min(Math.max(x0, 0), Math.max(0, f.W - w))
  const placed = placeText(
    kit.ctx.fonts,
    `result/${layer.id}/${part(t)}/lineLabel`,
    runsText,
    text,
    kit.palette,
    x,
    y,
    'start',
    'top',
    { target: targetOf(layer, t) },
  )
  drawn.labels.push(placed.bbox as Box)
  return [{ ...placed.node, bbox: placed.bbox }]
}

/** A polyline's Y at X (linear between its points), NaN off it. */
function lineY(pts: readonly [number, number][], x: number): number {
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1]!
    const [bx, by] = pts[i]!
    if (x >= Math.min(ax, bx) && x <= Math.max(ax, bx))
      return bx === ax ? ay : ay + ((by - ay) * (x - ax)) / (bx - ax)
  }
  return Number.NaN
}

/** The fill of a band: the layer's colour, else its data set's, else grey. */
function bandFill(kit: LayerKit, layer: ResultLayer, t: ResultTarget) {
  const own = t.key ? (layer.series?.[t.key]?.style as Record<string, unknown> | undefined) : {}
  const style = { ...(layer.style as Record<string, unknown> | undefined), ...own } as {
    color?: Parameters<typeof resolveColor>[0]
    opacity?: number
  }
  const color = style.color
    ? resolveColor(style.color, kit.palette, t.color ?? RESULT_THEME.grey)
    : (t.color ?? RESULT_THEME.grey)
  return { color, opacity: style.opacity ?? RESULT_THEME.opacity }
}

/** Bands between two values, across the plot (or along it at X values). */
function drawBands(f: ResultFrame, layer: ResultLayer, drawn: ResultMarks) {
  const { kit } = f
  for (const t of resultTargets(kit, layer, f.series)) {
    const alongX = (layer.stat.axis ?? 'y') === 'x'
    if (alongX && !f.u) continue
    const map = alongX ? f.u! : f.v
    const len = alongX ? f.U : f.V
    // Roadmap 46b: a band between −c and +c, or beyond them.
    if (layer.stat.mirror) {
      mirroredBand(f, layer, t, drawn, map, len, alongX)
      continue
    }
    const lo = resultNumber(kit, layer, layer.stat.lo, t)
    const hi = resultNumber(kit, layer, layer.stat.hi, t)
    if (lo === null || hi === null) continue
    const [a, b] = seenSpan(map, lo, hi)
    if (!finite(a, b)) continue
    const p0 = Math.max(0, Math.min(a, b))
    const p1 = Math.min(len, Math.max(a, b))
    if (p1 <= p0) continue
    const box = alongX ? { x: p0, y: 0, w: p1 - p0, h: f.V } : { x: 0, y: p0, w: f.U, h: p1 - p0 }
    drawn.boxes.push(box)
    const fill = bandFill(kit, layer, t)
    // A label along the band's middle (roadmap 36), from its start to its end.
    const mid = (p0 + p1) / 2
    const ends: [[number, number], [number, number]] = alongX
      ? [
          [mid, f.V],
          [mid, 0],
        ]
      : [
          [0, mid],
          [f.U, mid],
        ]
    record(kit, layer, t, [
      {
        id: `result/${layer.id}/${part(t)}/band`,
        target: targetOf(layer, t),
        prim: { type: 'rect', ...box, stroke: null, fill },
        bbox: box,
      },
      ...lineLabel(f, layer, t, ends[0], ends[1], fill.color, true, drawn),
    ])
  }
}

/**
 * Roadmap 46b: a band at ± a value `c` (its `at`): between −c and +c (one band, its ids as a
 * band's), or (`outside`) beyond them to the axis' ends (two, `band/0` beyond +c, `band/1` beyond
 * −c; on a log axis only the first). The label on the first drawn.
 */
function mirroredBand(
  f: ResultFrame,
  layer: ResultLayer,
  t: ResultTarget,
  drawn: ResultMarks,
  map: (v: number) => number,
  len: number,
  alongX: boolean,
) {
  const { kit } = f
  const c = Math.abs(resultNumber(kit, layer, layer.stat.at, t) ?? Number.NaN)
  if (Number.isNaN(c)) return
  const outside = !!layer.stat.outside
  const spans: [number, number][] = outside ? outsideSpans(map, len, c) : [seenSpan(map, -c, c)]
  const fill = bandFill(kit, layer, t)
  const nodes: SceneNode[] = []
  let labelled = false
  for (const [k, [a, b]] of spans.entries()) {
    if (!finite(a, b)) continue
    const p0 = Math.max(0, Math.min(a, b))
    const p1 = Math.min(len, Math.max(a, b))
    if (p1 <= p0) continue
    const box = alongX ? { x: p0, y: 0, w: p1 - p0, h: f.V } : { x: 0, y: p0, w: f.U, h: p1 - p0 }
    drawn.boxes.push(box)
    nodes.push({
      id: `result/${layer.id}/${part(t)}/band${outside ? `/${k}` : ''}`,
      target: targetOf(layer, t),
      prim: { type: 'rect', ...box, stroke: null, fill },
      bbox: box,
    })
    if (labelled) continue
    labelled = true
    const mid = (p0 + p1) / 2
    const ends: [[number, number], [number, number]] = alongX
      ? [
          [mid, f.V],
          [mid, 0],
        ]
      : [
          [0, mid],
          [f.U, mid],
        ]
    nodes.push(...lineLabel(f, layer, t, ends[0], ends[1], fill.color, true, drawn))
  }
  record(kit, layer, t, nodes)
}

/**
 * Roadmap 46b: the spans of a band outside ±c along an axis (`map` a value to its place, `len` the
 * axis' length): from +c to the end of the axis' higher values, then from −c to the end of its
 * lower ones, each where it can be drawn (on a log axis −c can't).
 */
function outsideSpans(map: (v: number) => number, len: number, c: number): [number, number][] {
  // Audit 3 (G6): a value inside an axis break starts its band where the axis shows values again.
  const hi = seenEnd(map, c, beyond(map, c, 1))
  const lo = seenEnd(map, -c, beyond(map, -c, -1))
  // Which way values grow along the axis, from two places that map.
  const probe = (
    [
      [lo, hi],
      [hi, map(c * 2 + 1)],
    ] as const
  ).find(([a, b]) => finite(a, b) && a !== b)
  if (!probe) return []
  const up = probe[1] > probe[0]
  const out: [number, number][] = []
  if (Number.isFinite(hi)) out.push(up ? [hi, len] : [0, hi])
  if (Number.isFinite(lo)) out.push(up ? [0, lo] : [lo, len])
  return out
}

/**
 * Audit 3 (G6): where a band's end `v` is seen. A value the axis shows nothing at (inside an axis
 * break, at or below 0 on a log axis) is taken to the nearest value towards `toward` (inside the
 * band) that it shows — the break's edge, the log axis' start — so the band draws the part of it
 * that is seen. NaN when neither is seen.
 */
function seenEnd(map: (v: number) => number, v: number, toward: number): number {
  const p = map(v)
  if (Number.isFinite(p)) return p
  if (!Number.isFinite(toward) || !Number.isFinite(map(toward))) return Number.NaN
  // Bisection between the unseen end and the seen one: the edge of what is seen.
  let [out, seen] = [v, toward]
  for (let i = 0; i < 80 && out !== seen; i++) {
    const mid = (out + seen) / 2
    if (mid === out || mid === seen) break
    if (Number.isFinite(map(mid))) seen = mid
    else out = mid
  }
  return map(seen)
}

/** A band between two values where it is seen (`seenEnd` at each end, towards the other). */
const seenSpan = (map: (v: number) => number, a: number, b: number): [number, number] => [
  seenEnd(map, a, b),
  seenEnd(map, b, a),
]

/** A value beyond `v` (`dir` 1 above, −1 below) that the axis shows, NaN if none is found. */
function beyond(map: (v: number) => number, v: number, dir: 1 | -1): number {
  const step = Math.abs(v) + 1
  for (let k = 0; k < 40; k++) {
    const w = v + dir * step * 2 ** k
    if (Number.isFinite(map(w))) return w
  }
  return Number.NaN
}

/** Room between a line and its label, and the label's inset from the plot's edge (pt). */
const LINE_LABEL_GAP = 2

/**
 * Roadmap 36: the label of a line or band (`stat.lineLabel`): its template's text at the line's
 * start or end (drawing-frame points `a` to `b`), inside the plot — above a line seen level, right
 * of one seen upright; on a band, centred across it. Placed where it is seen (`toFinal`).
 *
 * Roadmap 41 (decision 624): it keeps off the data as 35's labels do — where that spot covers
 * drawn points, the label moves along the line (a fifth of it at a time) and to its other side
 * (not a band's), taking the first place that covers none (else the one that covers fewest),
 * inside the plot. Where nothing is in the way it stays where it was.
 */
function lineLabel(
  f: ResultFrame,
  layer: ResultLayer,
  t: ResultTarget,
  a: [number, number],
  b: [number, number],
  color: string,
  band = false,
  drawn?: ResultMarks,
  /** Roadmap 46b: a mirrored line's ids (`mirror/lineLabel` for the line at −c). */
  idOf: (name: string) => string = (name) => name,
): SceneNode[] {
  const at = layer.stat.lineLabel
  if (!at || !layer.stat.template) return []
  const { kit } = f
  const runs = resultLabel(kit, layer, t)
  if (!richPlain(runs)) return []
  const own = (layer.style as { text?: Partial<TextStyle> } | undefined)?.text
  const base = graphText(kit.theme.pointLabel, kit.graph, own)
  const text: TextStyle = own?.color ? base : { ...base, color: { rgb: color } }
  const [p, q] = [toFinal(f, a[0], a[1]), toFinal(f, b[0], b[1])]
  const [s, e] = at === 'end' ? [q, p] : [p, q]
  const G = LINE_LABEL_GAP
  const level = Math.abs(e[0] - s[0]) >= Math.abs(e[1] - s[1])
  const id = `result/${layer.id}/${part(t)}/${idOf('lineLabel')}`
  const target = targetOf(layer, t)
  // The label sits at `s` (moved `k` of the way to `e`), reading along the plot from it, on the
  // line's first side or (`other`) its second.
  const placeAt = (k: number, other: boolean) => {
    const [x, y] = [s[0] + (e[0] - s[0]) * k, s[1] + (e[1] - s[1]) * k]
    return level
      ? placeText(
          kit.ctx.fonts,
          id,
          runs,
          text,
          kit.palette,
          x + (e[0] > s[0] ? G : -G),
          band ? y : other ? y + G : y - G,
          e[0] > s[0] ? 'start' : 'end',
          band ? 'middle' : other ? 'top' : 'bottom',
          { target },
        )
      : placeText(
          kit.ctx.fonts,
          id,
          runs,
          text,
          kit.palette,
          band ? x : other ? x - G : x + G,
          y + (e[1] > s[1] ? G : -G),
          band ? 'middle' : other ? 'end' : 'start',
          e[1] > s[1] ? 'top' : 'bottom',
          { target },
        )
  }
  const points = f.obstacles ?? []
  const covered = (bx: Box) =>
    points.reduce((n, o) => {
      const dx = Math.max(bx.x - o.x, 0, o.x - (bx.x + bx.w))
      const dy = Math.max(bx.y - o.y, 0, o.y - (bx.y + bx.h))
      return dx * dx + dy * dy < o.r * o.r ? n + 1 : n
    }, 0)
  const inside = (bx: Box) =>
    bx.x >= -1e-6 && bx.y >= -1e-6 && bx.x + bx.w <= f.W + 1e-6 && bx.y + bx.h <= f.H + 1e-6
  let placed = placeAt(0, false)
  let fewest = points.length ? covered(placed.bbox as Box) : 0
  if (fewest > 0) {
    search: for (const k of [0, 0.2, 0.4, 0.6, 0.8])
      for (const other of band ? [false] : [false, true]) {
        if (k === 0 && !other) continue
        const p = placeAt(k, other)
        const bx = p.bbox as Box
        if (!inside(bx)) continue
        const n = covered(bx)
        if (n < fewest) {
          placed = p
          fewest = n
          if (n === 0) break search
        }
      }
  }
  drawn?.labels.push(placed.bbox as Box)
  return [{ ...placed.node, bbox: placed.bbox }]
}

/** A label's format: its text, background (none, a halo, a box). */
function labelFormat(kit: LayerKit, layer: ResultLayer) {
  const style = (layer.style ?? {}) as { text?: Partial<TextStyle>; background?: string }
  return {
    text: graphText(kit.theme.pointLabel, kit.graph, style.text),
    background: (style.background ?? 'none') as 'none' | 'halo' | 'box',
  }
}

interface LabelItem {
  layer: ResultLayer
  t: ResultTarget
  runs: RichText
  text: TextStyle
  background: 'none' | 'halo' | 'box'
  w: number
  h: number
}

/** The labels: stacked in corners, at data positions, or beside their curves' ends (repelled). */
function drawLabels(f: ResultFrame, layers: readonly ResultLayer[], drawn: ResultMarks) {
  const { kit } = f
  const fonts = kit.ctx.fonts
  const corners = new Map<string, LabelItem[]>()
  const free: { item: LabelItem; label: RepelLabel }[] = []
  const stacked = new Map<string, number>()
  for (const layer of layers) {
    if ((layer.stat.show ?? 'plot') === 'legend') continue
    const fmt = labelFormat(kit, layer)
    for (const t of resultTargets(kit, layer, f.series)) {
      const runs = resultLabel(kit, layer, t)
      if (!richPlain(runs)) continue
      const color = fmt.text.color
      const own = layer.style as { text?: Partial<TextStyle> } | undefined
      const text: TextStyle =
        t.color && !own?.text?.color
          ? { ...fmt.text, color: { rgb: t.color } }
          : { ...fmt.text, color }
      const pad = fmt.background === 'box' ? RESULT_THEME.box.pad : 0
      const tl = layoutText(fonts, runs, text)
      const item: LabelItem = {
        layer,
        t,
        runs,
        text,
        background: fmt.background,
        w: tl.width + 2 * pad,
        h: tl.ascent + tl.descent + 2 * pad,
      }
      const place = layer.stat.place ?? { at: 'corner', corner: 'topLeft' }
      const curve = place.at === 'curve' ? curveOf(f, layer, t) : undefined
      if (place.at === 'data') {
        const [px, py] = f.point(place.x, place.y)
        if (!finite(px, py)) continue
        // Per data set, stacked down from the point.
        const k = `${layer.id}`
        const dy = stacked.get(k) ?? 0
        stacked.set(k, dy + item.h + RESULT_THEME.gap)
        free.push({
          item,
          label: {
            x: px,
            y: py,
            r: 0,
            w: item.w,
            h: item.h,
            at: { x: px + item.w / 2, y: py + dy + item.h / 2 },
          },
        })
      } else if (curve && f.u) {
        // Beside its drop lines' point on the curve (an IC50's), else the curve's last point
        // inside the plot.
        const drop = drawn.drops.get(dropKey(analysisIdOf(layer) ?? '', t.key))
        const end = drop ? toFinal(f, drop[0], drop[1]) : curveEnd(f, curve.data)
        if (!end) continue
        free.push({ item, label: { x: end[0], y: end[1], r: 2, w: item.w, h: item.h } })
      } else {
        const corner = place.at === 'corner' ? place.corner : 'topLeft'
        const list = corners.get(corner) ?? []
        list.push(item)
        corners.set(corner, list)
      }
    }
  }
  const draw = (item: LabelItem, box: Box) => {
    const { layer, t } = item
    const id = `result/${layer.id}/${part(t)}/label`
    const target = targetOf(layer, t)
    const pad = item.background === 'box' ? RESULT_THEME.box.pad : 0
    const placed = placeText(
      fonts,
      id,
      item.runs,
      item.text,
      kit.palette,
      box.x + pad,
      box.y + pad,
      'start',
      'top',
      { target },
    )
    const nodes: SceneNode[] = []
    if (item.background === 'box') {
      const b = RESULT_THEME.box
      nodes.push({
        id: `${id}/box`,
        target,
        prim: {
          type: 'rect',
          ...(f.toDrawing ? f.toDrawing(box) : box),
          fill: { color: b.fill, opacity: b.opacity },
          stroke: { color: b.border, width: 0.5, dash: 'solid' },
          rx: 2,
        },
      })
    }
    const node =
      item.background === 'halo' && placed.node.prim?.type === 'text'
        ? { ...placed.node, prim: { ...placed.node.prim, halo: RESULT_THEME.halo } }
        : placed.node
    nodes.push({ ...node, bbox: placed.bbox })
    record(kit, layer, t, nodes)
  }
  // Corners: stacked from the corner inwards, in the list's and the data sets' order.
  const P = RESULT_THEME.pad
  for (const [corner, items] of corners) {
    const top = corner.startsWith('top')
    const left = corner.endsWith('Left')
    let y = top ? P : f.H - P
    for (const item of top ? items : [...items].reverse()) {
      const x = left ? P : f.W - P - item.w
      const box = { x, y: top ? y : y - item.h, w: item.w, h: item.h }
      draw(item, box)
      y = top ? y + item.h + RESULT_THEME.gap : y - item.h - RESULT_THEME.gap
    }
  }
  // Elsewhere: apart from each other (a dragged-like fixed spot at data positions), off the
  // points, the curves and the result lines and bands, a little inside the plot (off the axes).
  if (!free.length) return
  const curvePoints: RepelObstacle[] = (f.curves ?? []).flatMap((c) =>
    c.data.x.flatMap((vx, i) => {
      const [px, py] = f.point(vx, c.data.y[i]!)
      return finite(px, py) ? [{ x: px, y: py, r: 1.5 }] : []
    }),
  )
  const I = LABEL_INSET
  const inset = (o: RepelObstacle): RepelObstacle => ({ ...o, x: o.x - I, y: o.y - I })
  const placed = placeLabels(
    free.map(({ label: l }) => ({
      ...l,
      x: l.x - I,
      y: l.y - I,
      ...(l.at ? { at: { x: l.at.x - I, y: l.at.y - I } } : {}),
    })),
    [...(f.obstacles ?? []), ...curvePoints, ...markObstacles(f, drawn)].map(inset),
    { width: Math.max(0, f.W - 2 * I), height: Math.max(0, f.H - 2 * I) },
  )
  free.forEach((x, i) => {
    const b = placed[i]!.box
    draw(x.item, { ...b, x: b.x + I, y: b.y + I })
  })
}

/** Labels placed apart stay this far inside the plot's edges (off the axes). */
const LABEL_INSET = 2
/** Spacing of the points standing for result lines and bands as obstacles. */
const OBSTACLE_STEP = 3
/** Most obstacle points a band stands for (a band's area, sampled). */
const MAX_BAND_POINTS = 4000

/** A drawing-frame point where it is seen. */
const toFinal = (f: ResultFrame, u: number, v: number): [number, number] =>
  f.toFinal ? f.toFinal(u, v) : [u, v]

/** Result lines and bands as obstacles: points along the lines and over the bands (seen). */
function markObstacles(f: ResultFrame, drawn: ResultMarks): RepelObstacle[] {
  const out: RepelObstacle[] = []
  const at = (u: number, v: number, r: number) => {
    const [x, y] = toFinal(f, u, v)
    out.push({ x, y, r })
  }
  for (const [x1, y1, x2, y2] of drawn.segments) {
    const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / OBSTACLE_STEP))
    for (let k = 0; k <= n; k++) at(x1 + ((x2 - x1) * k) / n, y1 + ((y2 - y1) * k) / n, 1.5)
  }
  for (const b of drawn.boxes) {
    const step = Math.max(OBSTACLE_STEP, Math.sqrt((b.w * b.h) / MAX_BAND_POINTS))
    for (let v = b.y; v <= b.y + b.h + 1e-9; v += step)
      for (let u = b.x; u <= b.x + b.w + 1e-9; u += step) at(u, v, step / 2)
  }
  // Roadmap 41: the lines' and bands' own labels (already where they are seen).
  for (const b of drawn.labels)
    for (let y = b.y; y <= b.y + b.h + 1e-9; y += OBSTACLE_STEP)
      for (let x = b.x; x <= b.x + b.w + 1e-9; x += OBSTACLE_STEP)
        out.push({ x, y, r: OBSTACLE_STEP / 2 })
  return out
}

/** A curve's last point inside the plot (plot-local), if any. */
function curveEnd(f: ResultFrame, data: GraphableDataSet): [number, number] | null {
  let best: [number, number] | null = null
  let bx = Number.NEGATIVE_INFINITY
  data.x.forEach((vx, i) => {
    const [px, py] = f.point(vx, data.y[i]!)
    if (!finite(px, py) || px < 0 || px > f.W || py < 0 || py > f.H) return
    if (px > bx) {
      bx = px
      best = [px, py]
    }
  })
  return best
}

/** Draws every result layer of the graph into the frame (marks recorded per layer). */
export function drawResults(f: ResultFrame): void {
  const layers = resultLayers(f.kit)
  if (!layers.length) return
  const drawn: ResultMarks = { segments: [], boxes: [], drops: new Map(), labels: [] }
  for (const l of layers) {
    if (l.geom === 'refline') drawLines(f, l, drawn)
    else if (l.geom === 'band') drawBands(f, l, drawn)
  }
  drawLabels(
    f,
    layers.filter((l) => l.geom === 'label'),
    drawn,
  )
}

// --- Legends ---------------------------------------------------------------------------------

/** A result line's or band's name in the legend: its own, else its fields'. */
export function resultName(
  layer: ResultLayer,
  /** The graph, for lines at its cut-offs (roadmap 46b). */
  graph?: Pick<GraphNode, 'cutoffs'>,
): string {
  if (layer.name) return layer.name
  // Values typed in (roadmap 36): the label's text, else the numbers.
  if (layer.data.from === 'values') {
    const label = layer.stat.template ? labelPlain(layer.stat.template) : ''
    if (label && !label.includes('{')) return label
    // A sloped line (roadmap 46b): its equation.
    if (layer.stat.slope !== undefined) {
      const ab = slopedValues(layer.stat)
      return ab ? lineEquation(ab.a, ab.b) : 'y = a·x + b'
    }
    const n = (name: string | undefined) => {
      const ref = name === undefined ? undefined : layer.stat.fields[name]?.ref
      if (ref?.from === 'cutoff') {
        const v = graph ? cutoffValue(graph, ref.which) : Number.NaN
        return Number.isFinite(v) ? String(+v.toPrecision(4)) : '—'
      }
      return ref?.from === 'number' ? String(ref.v) : (name ?? '')
    }
    // Roadmap 46b: lines and bands at ± a value ("±1"; a band beyond it "beyond ±1").
    if (layer.stat.mirror) {
      const c = n(layer.stat.at).replace(/^-/, '')
      return layer.geom === 'band' && layer.stat.outside ? `beyond ±${c}` : `±${c}`
    }
    return layer.geom === 'band' ? `${n(layer.stat.lo)} to ${n(layer.stat.hi)}` : n(layer.stat.at)
  }
  if (layer.geom === 'band') return `${layer.stat.lo ?? ''} to ${layer.stat.hi ?? ''}`
  if (layer.stat.slope !== undefined) return 'y = a·x + b'
  return layer.stat.at ?? 'Result'
}

/** Half the rise of a sloped line's legend sample (pt). */
const SLOPED_SAMPLE_RISE = 3

/**
 * Legend entries of result lines and bands (each layer once, in the first data set's colour),
 * unless their legend is hidden; by name (then id), so moving a layer in the list leaves the
 * legend as it is.
 */
export function resultLegend(
  kit: LayerKit,
  series: readonly ResultSeries[],
  /** The legend's samples' width (a line's length, a swatch centred in it). */
  sampleWidth = LEGEND_SAMPLE,
): LegendEntry[] {
  const out: LegendEntry[] = []
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
  const sorted = [...resultLayers(kit)].sort(
    (a, b) => cmp(resultName(a, kit.graph), resultName(b, kit.graph)) || cmp(a.id, b.id),
  )
  for (const l of sorted) {
    if (l.geom === 'label' || l.legend === 'hide') continue
    const t = resultTargets(kit, l, series)[0]
    if (!t) continue
    const id = `legend/result/${l.id}`
    const target: StylePath = ['layers', l.id]
    // A sloped line's sample (roadmap 46b) rises (or falls) with its slope.
    const a = l.stat.slope === undefined ? 0 : (resultNumber(kit, l, l.stat.slope, t) ?? 0)
    const rise = a > 0 ? SLOPED_SAMPLE_RISE : a < 0 ? -SLOPED_SAMPLE_RISE : 0
    const sample =
      l.geom === 'refline'
        ? (x: number, cy: number): SceneNode[] => [
            {
              id: `${id}/line`,
              target,
              prim: {
                type: 'line',
                x1: x,
                y1: cy + rise,
                x2: x + sampleWidth,
                y2: cy - rise,
                stroke: strokeOf(kit, l, t, t.color),
              },
            },
          ]
        : (x: number, cy: number): SceneNode[] => {
            const r = swatchRect(x + (sampleWidth - SWATCH) / 2, cy)
            return [
              {
                id: `${id}/swatch`,
                target,
                prim: { type: 'rect', ...r, stroke: null, fill: bandFill(kit, l, t) },
              },
            ]
          }
    out.push({ key: `@${l.id}`, id, target, label: resultName(l, kit.graph), sample })
  }
  return out
}

/**
 * Legend entries with result labels appended ("Treated (IC50 = 1.2 µM)"): a label per data set
 * to its data set's entry, a label of the analysis to its first analyzed data set's.
 */
export function withResultLabels(
  kit: LayerKit,
  entries: readonly LegendEntry[],
  series: readonly ResultSeries[],
): LegendEntry[] {
  const layers = resultLayers(kit, 'label').filter(
    (l) => l.stat.show === 'legend' || l.stat.show === 'both',
  )
  if (!layers.length) return [...entries]
  const extra = new Map<string, RichText[]>()
  for (const l of layers)
    for (const t of resultTargets(kit, l, series)) {
      const key =
        t.key ?? analysisOf(kit, l)?.input.dataSets.find((k) => entries.some((e) => e.key === k))
      if (!key) continue
      const runs = resultLabel(kit, l, t)
      if (!richPlain(runs)) continue
      extra.set(key, [...(extra.get(key) ?? []), runs])
    }
  // Roadmap 47b: after the label, kept after a legend-only label (the legend's layout joins them).
  return entries.map((e) => {
    const more = extra.get(e.key)
    if (!more) return e
    const suffix: RichText = [...(e.suffix ?? [])]
    for (const runs of more) suffix.push({ text: ' (' }, ...runs, { text: ')' })
    return { ...e, suffix }
  })
}

/**
 * Drawing by data set (v1): result layers' marks in a plane of their own (beneath the data sets'
 * groups unless listed in front of them, as every frame-drawn plane).
 */
export function resultPlanes(kit: LayerKit, keys: readonly string[]): FramePlane[] {
  const layers = resultLayers(kit)
  if (!layers.length) return []
  return [
    {
      id: 'results',
      layers,
      draw: (ls: readonly Layer[]) =>
        ls.flatMap((l) => [...keys.flatMap((k) => kit.nodes(l, k)), ...kit.wholeOf(l)]),
    },
  ]
}

/** The data sets as result layers see them (roadmap 35): their keys, titles and colours. */
export const resultSeriesOf = (
  series: readonly { s: { key: string; title: string }; color: string }[],
): ResultSeries[] => series.map((p) => ({ key: p.s.key, title: p.s.title, color: p.color }))
