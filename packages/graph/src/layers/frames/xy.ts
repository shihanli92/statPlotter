import { type FunctionDef, type Layer, labelRuns, type RichText, sourceTable } from '@ps/model'
import { variableBins } from '../../binned.ts'
import { mixColor } from '../../color.ts'
import {
  errorBounds,
  type GraphSeries,
  graphRows,
  resolveSeries,
  seriesTitle,
  type XYRow,
  xyRows,
} from '../../data.ts'
import { evaluateFunction } from '../../functions.ts'
import { layoutXYBrackets, type XYBracketSpan } from '../../layout/annotations.ts'
import {
  asContinuous,
  Extent,
  planContinuousAxis,
  tickFit,
  valueAxis,
} from '../../layout/common.ts'
import { composeGraph } from '../../layout/compose.ts'
import {
  LEGEND_SAMPLE,
  type LegendEntry,
  lineSample,
  polygonSample,
  reversedEntries,
  SWATCH,
  swatchSample,
  symbolSample,
} from '../../layout/legend.ts'
import { type PointMarkContext, pointLayer } from '../../layout/points.ts'
import type { Scene, SceneNode, StylePath } from '../../scene.ts'
import { graphDashes, type ResolvedSeriesStyle, resolveStroke, seriesColor } from '../../theme.ts'
import { isLogScale } from '../../transform.ts'
import {
  curveSources,
  outputCurves,
  outputsOf,
  type XYAxis,
  type XYCurve,
  type XYCurveCtx,
} from '../curves.ts'
import { areaStack, xyArea, xyStackedAreas } from '../geoms/area.ts'
import { xyCurveBand, xyEnvelope } from '../geoms/band.ts'
import { xyBars, xyBinWidth } from '../geoms/bar.ts'
import { xyBox } from '../geoms/box.ts'
import { xyError } from '../geoms/errorbar.ts'
import { xyLabels } from '../geoms/label.ts'
import { xyCurve, xyFunction, xyLine, xySpaghetti, xyStep } from '../geoms/line.ts'
import {
  drawPath,
  drawPolygon,
  lineStyleOf,
  type OverlayGroup,
  overlayAxes,
  overlayExtent,
  polygonSwatch,
} from '../geoms/overlay.ts'
import { xyCurvePoints, xyPoints } from '../geoms/points.ts'
import {
  drawResults,
  isResultLayer,
  resultExtent,
  resultLegend,
  resultPlanes,
  resultSeriesOf,
  withResultLabels,
} from '../geoms/result.ts'
import {
  isThresholdLayer,
  onlyClassed,
  thresholdLegend,
  xyCurveThreshold,
  xyThreshold,
} from '../geoms/threshold.ts'
import { type XYFrame, xyBoxes, xyCenter } from '../geoms/xyMarks.ts'
import { glyphLayer } from '../glyphs.ts'
import type { LayerKit } from '../kit.ts'
import { linkedExtent } from '../links.ts'
import { binRows, binsVariable, histogramTransform } from '../stats/bin.ts'

// The xy frame: continuous X and Y — the table's data sets (rows at their X: means or every
// replicate, lines, spaghetti, envelopes, areas, bars, boxes, error bars, labels), analysis
// outputs (curves, bands, points) and functions, with a right Y axis. Planes: bands, areas
// (when any), curves, series, pointLabels.

export interface XYSeries {
  s: GraphSeries
  rows: XYRow[]
  /** Plotted against the right Y axis. */
  right: boolean
  color: string
  /** A histogram's bin width (its rows are bins of the data set's values, `bin` stat). */
  binWidth?: number
}

/** A table data set as the geoms draw it. */
export interface XYSlot {
  kit: LayerKit
  key: string
  p: XYSeries
  /** Every table data set (bins of XY bars span all those drawn as bars). */
  series: readonly XYSeries[]
  target: StylePath
  axis: XYAxis
  frame: XYFrame
  x: (v: number) => number
  W: number
  H: number
  xLog: boolean
  inside: (px: number, py: number) => boolean
  marksCtx: PointMarkContext
  /** Highest mark drawn at each row (plot-local y), for labels. */
  touch: (row: number, py: number) => void
  tops: Map<number, number>
  barTops: Map<number, { top: number; base: number }>
}

/** The table's data sets, outputs and functions of an xy graph. */
interface XYData {
  series: XYSeries[]
  curves: XYCurve[]
  functions: XYCurve[]
  outputCount: number
}

const tableData = (kit: LayerKit, l: Layer) => kit.data(l).from === 'table'

function functionsOf(kit: LayerKit): FunctionDef[] {
  return kit.graph.layers.flatMap((l) => (l.data?.from === 'functions' ? l.data.functions : []))
}

/**
 * The points layer of the table's data sets: every replicate (identity) or each row's mean; else
 * (roadmap 46b) a Significance layer, which draws every replicate.
 */
const pointsLayer = (kit: LayerKit) =>
  kit.all('points', (l) => tableData(kit, l) && !l.aes && !isThresholdLayer(l))[0] ??
  kit.all('points', (l) => tableData(kit, l) && isThresholdLayer(l))[0]

/** Whether a data set is plotted as every replicate (its points layer's stat is identity). */
const eachOf = (kit: LayerKit, key: string) => {
  const l = pointsLayer(kit)
  return !!l && (isThresholdLayer(l) || kit.stat(l, key).kind === 'identity')
}

/**
 * A data set as a group of points (roadmap 34c): every value at its X (each replicate; entered
 * means: the row's centre) for ellipses and hulls, or (`centres`) the rows' centres in table row
 * order for paths.
 */
function overlayGroup(kit: LayerKit, p: XYSeries, centres: boolean): OverlayGroup {
  const key = p.s.key
  const id = kit.identity(key)
  const xs: number[] = []
  const ys: number[] = []
  const rows: number[] = []
  for (const r of [...p.rows].sort((a, b) => a.row - b.row)) {
    const each =
      !centres && r.stats.raw ? r.stats.points.map((pt) => pt.value) : [xyCenter(r.stats, id)]
    for (const v of each) {
      if (!Number.isFinite(v)) continue
      xs.push(r.x)
      ys.push(v)
      rows.push(r.row)
    }
  }
  // Roadmap 49d: its fill colour (fills by data set) and place (a line pattern by group).
  const fill = kit.fillOf(key)
  return {
    key,
    id: (part) => `series/${key}/${part}`,
    target: ['seriesOverrides', key],
    color: p.color,
    ...(fill ? { fill } : {}),
    index: p.s.index,
    label: `“${p.s.title}”`,
    xs,
    ys,
    rows,
  }
}

function xyData(kit: LayerKit): XYData {
  const { project, result } = kit.ctx
  const { graph, palette } = kit
  const conf = project.settings.defaultConfidenceLevel
  const y2 = !!graph.axes.y2
  // A histogram: the data sets' values in shared bins (rows: one per bin with values); a graph of
  // variables' bins its X variable, per level of its colour variable (roadmap 34f).
  const bin = kit.drawn('bar', (l) => l.stat.kind === 'bin')[0]
  const series: XYSeries[] = resolveSeries(project, graph, result).map((s) => ({
    s,
    rows: bin ? [] : xyRows(s.ds, conf),
    right: y2 && kit.identity(s.key).yAxis === 'right',
    color: seriesColor(kit.identity(s.key).color, palette, s.index),
  }))
  if (bin) {
    const binned = series.filter((p) => kit.shows(bin, p.s.key))
    const bins = binRows(
      bin,
      binned.map((p) => p.s.ds),
      histogramTransform(graph),
    )
    for (const p of series) {
      const i = binned.indexOf(p)
      p.rows = i < 0 ? [] : bins.rows[i]!
      p.binWidth = bins.width
    }
  }
  const colorOfKey = new Map(series.map((p) => [p.s.key, p.color]))
  const outputs = outputsOf(kit)
  return {
    series,
    curves: outputCurves(kit, series.length, colorOfKey),
    functions: [],
    outputCount: outputs.length,
  }
}

/**
 * Evaluates the graph's functions: over their own X range, else over `xRange` (the X axis'
 * domain once known; before that, the data's X extent).
 */
function xyFunctions(
  kit: LayerKit,
  d: XYData,
  xRange: [number, number],
  xLog: boolean,
  warnings?: string[],
): XYCurve[] {
  const out: XYCurve[] = []
  const y2 = !!kit.graph.axes.y2
  functionsOf(kit).forEach((fc, index) => {
    const data = evaluateFunction(fc, xRange, xLog, warnings)
    if (!data) return
    const id = kit.identity(fc.id, true)
    out.push({
      id: fc.id,
      index,
      data,
      color: seriesColor(id.color, kit.palette, d.series.length + d.outputCount + index),
      matched: false,
      right: y2 && kit.graph.seriesOverrides[fc.id]?.yAxis === 'right',
    })
  })
  return out
}

/** The data with functions over the data's X extent (before the X axis is known). */
function withFunctions(kit: LayerKit): XYData {
  const d = xyData(kit)
  // Functions without their own range span the data's X extent (the layout widens them to the
  // axis once it knows it).
  const graphX = kit.graph.axes.x.type === 'continuous' ? kit.graph.axes.x : null
  const xLog = graphX ? isLogScale(graphX.scale) : false
  const xe = xyExtent(kit, d, 'x', xLog)
  for (const fc of functionsOf(kit)) xe.addAll([fc.from ?? Number.NaN, fc.to ?? Number.NaN])
  const manual = graphX && graphX.range !== 'auto' ? graphX.range : null
  const range: [number, number] = manual
    ? [manual.min, manual.max]
    : xe.empty
      ? [0, 1]
      : [xe.lo, xe.hi]
  d.functions = xyFunctions(kit, d, range, xLog)
  return d
}

/**
 * Extent of an xy graph along an axis: every row of the data sets (each replicate, or the row's
 * centre with its error), with bars, areas, lines through each replicate and boxes shown; the
 * curves and bands of outputs and functions. 'y' is the left Y axis, 'y2' the right one; 'x'
 * takes everything.
 */
function xyExtent(kit: LayerKit, d: XYData, axis: 'x' | 'y' | 'y2', log: boolean): Extent {
  const e = new Extent(log)
  // A histogram's counts tick at whole numbers (roadmap 34b).
  const bin = kit.drawn('bar', (l) => l.stat.kind === 'bin')[0]
  e.integer = axis !== 'x' && bin?.stat.kind === 'bin' && (bin.stat.measure ?? 'count') === 'count'
  const counts = (right: boolean) => axis === 'x' || right === (axis === 'y2')
  const shownBy = <L extends Layer>(layers: L[], key: string) =>
    layers.find((l) => kit.shows(l, key))
  const table = <L extends Layer>(layers: L[]) => layers.filter((l) => tableData(kit, l))
  const bars = table(kit.drawn('bar'))
  const areas = table(kit.drawn('area'))
  const errors = table(kit.drawn('errorbar'))
  const envelopes = table(kit.drawn('band', (l) => l.stat.kind === 'summary'))
  const spaghetti = table(kit.drawn('line', (l) => l.stat.kind === 'identity'))
  // Audit 3 (G7): a Significance layer draws every replicate, over mean points too.
  const classed = table(kit.drawn('points', isThresholdLayer))
  const boxes = table(kit.drawn('box'))
  const polygons = table(kit.drawn('polygon'))
  for (const p of d.series) {
    if (!counts(p.right)) continue
    const key = p.s.key
    const each = eachOf(kit, key)
    // Bars reach half a bin either side of their X, and down to the baseline.
    const bar = shownBy(bars, key)
    const barStyle = bar && kit.style(bar, key)
    const half = barStyle ? (xyBinWidth(kit, bar, d.series, barStyle) * barStyle.bar.width) / 2 : 0
    if (barStyle && axis !== 'x' && p.rows.length) e.add(barStyle.bar.baseline ?? 0)
    const area = shownBy(areas, key)
    if (area && axis !== 'x' && p.rows.length) e.add(kit.style(area, key).area.baseline ?? 0)
    const error = shownBy(errors, key)
    const envelope = shownBy(envelopes, key)
    const errorStyle = error ? kit.style(error, key) : undefined
    const xErr = errorStyle && errorStyle.error.x !== false ? p.s.xErr : undefined
    // The row's centre: the error bars' (the data set's summary).
    const centerStyle: ResolvedSeriesStyle = errorStyle ?? kit.identity(key)
    const bounded = [errorStyle, envelope && kit.style(envelope, key)].filter(
      (s): s is ResolvedSeriesStyle => !!s,
    )
    const replicates = !!shownBy(spaghetti, key) || !!shownBy(classed, key)
    for (const r of p.rows) {
      const c = xyCenter(r.stats, centerStyle)
      if (axis === 'x') {
        // Bins in an axis' transformed units (roadmap 34g) reach their own edges.
        if (r.edges) e.addAll([r.x, ...r.edges])
        else e.addAll(half ? [r.x, r.x - half, r.x + half] : [r.x])
        const xe = xErr?.[r.row] ?? Number.NaN
        if (xe > 0 && !each) e.addAll([r.x - xe, r.x + xe])
      } else if (each && r.stats.raw) e.addAll(r.stats.points.map((pt) => pt.value))
      else {
        e.add(c)
        for (const s of bounded) e.addAll(errorBounds(r.stats, s.error.stat, c) ?? [])
        // Lines through each replicate, and a Significance layer's points, reach every value.
        if (replicates) e.addAll(r.stats.points.map((pt) => pt.value))
      }
    }
    // Ellipses and hulls reach past the points (roadmap 34c).
    if (polygons.length)
      overlayExtent(kit, polygons, [overlayGroup(kit, p, false)], axis === 'x' ? 'x' : 'y', e)
    const box = shownBy(boxes, key)
    if (axis !== 'x' && box)
      for (const { b } of xyBoxes({ style: kit.style(box, key), rows: p.rows }))
        e.addAll([b.whiskerLo, b.whiskerHi, ...b.outliers.map((o) => o.value)])
  }
  // Stacked areas (on the left axis) reach their stacks' tops.
  if (axis !== 'y2')
    for (const l of areas.filter((a) => a.position?.kind === 'stack')) {
      const { xs, at, base } = areaStack(kit, l, d.series)
      if (axis === 'x') e.addAll(xs)
      else if (xs.length) e.addAll([base, ...at.flat()])
    }
  // Lines and bands at an analysis' values (roadmap 35), on the left Y axis.
  if (axis !== 'y2') resultExtent(kit, axis, resultSeriesOf(d.series), (v) => e.add(v))
  const bandLayers = kit.drawn('band', (l) => !tableData(kit, l) && !isResultLayer(l))
  for (const c of [...d.curves, ...d.functions]) {
    if (!counts(c.right)) continue
    if (axis === 'x') e.addAll(c.data.x)
    else {
      e.addAll(c.data.y)
      if (shownBy(bandLayers, c.id)) {
        e.addAll(c.data.lo ?? [])
        e.addAll(c.data.hi ?? [])
      }
    }
  }
  return e
}

/** An xy graph's extent along an axis (no text laid out). */
export function xyExtentOf(kit: LayerKit, axis: 'x' | 'y', log: boolean): Extent {
  return xyExtent(kit, withFunctions(kit), axis, log)
}

/** Lays out an xy graph: data points (mean ± error or each replicate), lines, fitted curves. */
export function layoutXY(kit: LayerKit): Scene {
  const { ctx, graph, theme, palette, warnings } = kit
  const data = withFunctions(kit)
  const { series, curves } = data
  const { labels: pointLabels, marksCtx } = pointLayer(ctx, theme, palette, (k) =>
    curves.some((c) => c.id === k)
      ? kit.identity(k, true).pointLabels
      : series.some((p) => p.s.key === k)
        ? kit.identity(k).pointLabels
        : undefined,
  )

  const xSpec = asContinuous(graph.axes.x)
  const ySpec = asContinuous(graph.axes.y)
  const y2Spec = graph.axes.y2
  if (graph.axes.x.type !== 'continuous') warnings.push('XY graphs need a continuous X axis.')
  const xLog = isLogScale(xSpec.scale)

  // --- Extents (widened by linked graphs; the right axis is never linked) ---------------------
  const xe = linkedExtent(kit, 'x', xyExtent(kit, data, 'x', xLog), xLog)
  const W = graph.size.plotWidth
  const H = graph.size.plotHeight
  const xFit = tickFit(ctx, theme, 'x', xSpec, W)
  const { dom: xDom, scale: x } = valueAxis(xSpec, xe, false, [0, W], warnings, xFit)
  // Functions without their own X range span the whole X axis.
  const fns = xyFunctions(kit, data, [xDom.min, xDom.max], xLog, warnings)
  data.functions = fns

  /** A Y axis' domain and scale, and the mappings the marks use. */
  const yAxisOf = (spec: typeof ySpec, which: 'y' | 'y2'): XYAxis => {
    const log = isLogScale(spec.scale)
    const own = xyExtent(kit, data, which, log)
    const extent = which === 'y' ? linkedExtent(kit, 'y', own, log) : own
    const axis = valueAxis(spec, extent, true, [H, 0], warnings, tickFit(ctx, theme, 'y', spec, H))
    const ok = (vx: number, vy: number) => Number.isFinite(vx) && (!xLog || vx > 0) && axis.ok(vy)
    return { ...axis, ok }
  }
  const left = yAxisOf(ySpec, 'y')
  const right = y2Spec ? yAxisOf(y2Spec, 'y2') : left
  const inside = (px: number, py: number) =>
    px >= -0.5 && px <= W + 0.5 && py >= -0.5 && py <= H + 0.5

  // --- Marks (plot-local) ----------------------------------------------------------------------
  const outputBands = kit.drawn('band', (l) => !tableData(kit, l) && !isResultLayer(l))
  const outputLines = kit.drawn('line', (l) => kit.data(l).from === 'outputs')
  const outputPoints = kit.drawn('points', (l) => !tableData(kit, l))
  const functionLines = kit.drawn('line', (l) => kit.data(l).from === 'functions')
  const curveCtx: XYCurveCtx = { kit, x, left, right, W, H, inside, pointLabels }
  for (const c of curves) {
    for (const l of outputBands) if (kit.shows(l, c.id)) xyCurveBand(curveCtx, c, l)
    for (const l of outputLines) if (kit.shows(l, c.id)) xyCurve(curveCtx, c, l)
    for (const l of outputPoints)
      if (!kit.shows(l, c.id)) continue
      else if (isThresholdLayer(l)) xyCurveThreshold(curveCtx, c, l)
      else xyCurvePoints(curveCtx, c, l)
  }
  // Functions ("Plot a function"): a line over their X range.
  for (const f of fns)
    for (const l of functionLines) if (kit.shows(l, f.id)) xyFunction(curveCtx, f, l)

  /** Top of the highest bar label (plot-local; above the plot when < 0). */
  let labelTop = 0
  const tableLayers = graph.layers.filter((l) => l.visible !== false && tableData(kit, l))
  const areaLayers = tableLayers.filter(
    (l) => l.geom === 'area' || (l.geom === 'band' && l.stat.kind === 'summary'),
  )
  const planeLayers = tableLayers.filter((l) => !areaLayers.includes(l))
  for (const p of series) {
    const key = p.s.key
    const axis = p.right ? right : left
    const tops = new Map<number, number>()
    const slot: XYSlot = {
      kit,
      key,
      p,
      series,
      target: ['seriesOverrides', key],
      axis,
      frame: { W, H, x, y: axis.scale, yEnd: axis.end, ok: axis.ok },
      x,
      W,
      H,
      xLog,
      inside,
      marksCtx,
      touch: (row, py) => {
        if (Number.isFinite(py))
          tops.set(row, Math.min(tops.get(row) ?? Number.POSITIVE_INFINITY, py))
      },
      tops,
      barTops: new Map(),
    }
    const shows = (l: Layer) => kit.shows(l, key)
    const of = <G extends Layer['geom']>(geom: G, test: (l: Layer) => boolean = () => true) =>
      tableLayers.filter((l) => l.geom === geom && test(l) && shows(l)) as Extract<
        Layer,
        { geom: G }
      >[]
    const axes = overlayAxes(x, axis.scale, axis.ok, W, H)
    // Ellipses and hulls behind the data set's marks (roadmap 34c).
    const polygons = of('polygon')
    if (polygons.length) {
      const g = overlayGroup(kit, p, false)
      for (const l of polygons) drawPolygon(kit, l, g, axes)
    }
    // Bars from the baseline to each point, a bin wide (histograms of bin centres).
    for (const l of of('bar')) xyBars(slot, l)
    // Behind every data set's marks: the area under its line and its error envelope; behind its
    // own line, a line through each replicate.
    for (const l of of('area', (a) => a.position?.kind !== 'stack')) xyArea(slot, l)
    for (const l of of('band', (b) => b.stat.kind === 'summary')) xyEnvelope(slot, l)
    for (const l of of('line', (b) => b.stat.kind === 'identity')) xySpaghetti(slot, l)
    // A box and whiskers of the replicates at each X.
    for (const l of of('box')) xyBox(slot, l)
    for (const l of of('line', (b) => b.stat.kind === 'summary')) xyLine(slot, l)
    for (const l of of('step')) xyStep(slot, l)
    // The rows' centres joined in table row order (roadmap 34c).
    const paths = of('path')
    if (paths.length) {
      const g = overlayGroup(kit, p, true)
      for (const l of paths) drawPath(kit, l, g, axes, slot.touch)
    }
    // Error bars (X errors, then Y unless drawn as an envelope).
    for (const l of of('errorbar')) xyError(slot, l)
    for (const l of of('points'))
      if (isThresholdLayer(l)) xyThreshold(slot, l)
      else xyPoints(slot, l)
    // Labels above the bars (or points): the value, n, etc.
    for (const l of of('label')) labelTop = Math.min(labelTop, xyLabels(slot, l))
  }
  // Areas stacked on the data sets before them (on the left axis).
  for (const l of tableLayers)
    if (l.geom === 'area' && l.position?.kind === 'stack')
      xyStackedAreas({ W, H, x, y: left.scale, yEnd: left.end, ok: left.ok }, kit, l, series)
  // Labels, lines and bands of analyses' results (roadmap 35), with their fitted curves.
  const results = resultSeriesOf(series)
  drawResults({
    kit,
    U: W,
    V: H,
    W,
    H,
    u: x,
    v: left.scale,
    scales: { x, y: left.scale },
    point: (vx, vy) => (left.ok(vx, vy) ? [x(vx), left.scale(vy)] : [Number.NaN, Number.NaN]),
    series: results,
    curves: curveSources(kit, curves),
    obstacles: series.flatMap((p) => {
      const axis = p.right ? right : left
      const id = kit.identity(p.s.key)
      return p.rows.flatMap((r) => {
        const c = xyCenter(r.stats, id)
        return axis.ok(r.x, c) ? [{ x: x(r.x), y: axis.scale(c), r: 3 }] : []
      })
    }),
  })
  // Brackets at one X (roadmap 35): between two data sets' centres there, right of their points.
  const brackets = layoutXYBrackets(
    ctx,
    theme,
    palette,
    xyBracketSpans(kit, series, x, left, right),
    W,
  )
  const keys = series.map((p) => p.s.key)
  const curveKeys = [...curves.map((c) => c.id), ...fns.map((f) => f.id)]
  const bin = kit.drawn('bar', (l) => l.stat.kind === 'bin')[0]
  if (bin && series.every((p) => !p.rows.length))
    warnings.push(
      binsVariable(bin)
        ? 'A histogram needs a number variable with values on X.'
        : 'A histogram needs raw values to bin: the data sets shown have none.',
    )
  // A histogram of variables by group (roadmap 34f): rows of no group left out, counted.
  if (bin && binsVariable(bin)) {
    const table = sourceTable(ctx.project, graph.seriesSource.table, ctx.result)
    const n = table ? variableBins(table, graph, bin, graphRows(graph, table)).noLevel : 0
    if (n > 0)
      warnings.push(
        `${n.toLocaleString('en-US')} row${n === 1 ? '' : 's'} without a level of the colour variable left out.`,
      )
  }

  // --- Legend, axes ----------------------------------------------------------------------------
  const entries = [
    ...withResultLabels(kit, legendEntries(kit, data, fns), results),
    ...thresholdLegend(kit),
    ...resultLegend(kit, results),
  ]
  const areas = kit.plane(areaLayers, keys)
  // By data set (v1): bands, areas and curves in planes beneath the data sets' marks (over them
  // when moved to the top of the list). By layer: every layer's marks in the list's order.
  const planes: SceneNode[] = kit.seriesMajor
    ? kit.planesAround(
        [
          { id: 'bands', layers: outputBands, draw: (ls) => kit.plane(ls, curveKeys) },
          ...(areas.length
            ? [
                {
                  id: 'areas',
                  layers: areaLayers,
                  draw: (ls: readonly Layer[]) => kit.plane(ls, keys),
                },
              ]
            : []),
          {
            id: 'curves',
            layers: kit.inList([...outputLines, ...outputPoints, ...functionLines]),
            draw: (ls) => kit.plane(ls, curveKeys),
          },
          ...resultPlanes(kit, keys),
        ],
        planeLayers,
        { id: 'series', children: kit.seriesPlane(planeLayers, keys) },
      )
    : [{ id: 'series', children: kit.layerPlane([...keys, ...curveKeys]) }]
  return composeGraph({
    ctx,
    theme,
    palette,
    x: planContinuousAxis(ctx, theme, palette, 'x', xSpec, xDom, x),
    y: planContinuousAxis(ctx, theme, palette, 'y', ySpec, left.dom, left.scale),
    ...(y2Spec
      ? {
          y2: planContinuousAxis(ctx, theme, palette, 'y', y2Spec, right.dom, right.scale, {
            right: true,
          }),
        }
      : {}),
    layers: [...planes, { id: 'pointLabels', children: pointLabels.nodes(W, H) }],
    brackets: { nodes: brackets.nodes, top: labelTop },
    ...(brackets.right > 0 ? { aside: brackets.right } : {}),
    legend: {
      entries: reversedEntries(graph.legend, entries),
      sampleWidth: LEGEND_SAMPLE,
    },
    warnings,
  })
}

/**
 * The spans of brackets at one X (roadmap 35): each data set's centre at the first row with that
 * X (as its error bars centre it), the points' reach right of X (half the larger symbol).
 */
function xyBracketSpans(
  kit: LayerKit,
  series: readonly XYSeries[],
  x: (v: number) => number,
  left: XYAxis,
  right: XYAxis,
): XYBracketSpan[] {
  const out: XYBracketSpan[] = []
  const errors = kit.drawn('errorbar', (l) => tableData(kit, l))
  const points = kit.drawn('points', (l) => tableData(kit, l))
  kit.graph.annotations.forEach((a, idx) => {
    if (a.type !== 'bracket' || a.x === undefined) return
    const at = (key: string) => {
      const p = series.find((q) => q.s.key === key)
      const r = p?.rows.find((row) => row.x === a.x)
      if (!p || !r) return null
      const error = errors.find((l) => kit.shows(l, key))
      const c = xyCenter(r.stats, error ? kit.style(error, key) : kit.identity(key))
      const axis = p.right ? right : left
      if (!axis.ok(a.x!, c)) return null
      const symbol = points.find((l) => kit.shows(l, key))
      const size = symbol ? kit.style(symbol, key).points.size : 0
      return { y: axis.scale(c), reach: size / 2 }
    }
    const [pa, pb] = [at(a.a), at(a.b)]
    const px = x(a.x)
    if (!pa || !pb || !Number.isFinite(px)) return
    out.push({ a, idx, x: px, reach: Math.max(pa.reach, pb.reach), y1: pa.y, y2: pb.y })
  })
  return out
}

/**
 * The legend: each data set (a bar or box swatch, else its line and symbol as drawn), outputs
 * not drawn in a data set's colour, and functions.
 */
function legendEntries(kit: LayerKit, d: XYData, fns: readonly XYCurve[]): LegendEntry[] {
  const { palette } = kit
  const defs = functionsOf(kit)
  const first = <L extends Layer>(layers: L[], key: string) => layers.find((l) => kit.shows(l, key))
  const table = (l: Layer) => tableData(kit, l)
  const bars = kit.drawn('bar', table)
  const boxes = kit.drawn('box', table)
  // Stacked areas (new in roadmap 33d; v1's areas under a line keep its legend).
  const areas = kit.drawn('area', (l) => table(l) && l.position?.kind === 'stack')
  const lines = kit.inList([
    ...kit.drawn('line', (l) => table(l) && l.stat.kind === 'summary'),
    ...kit.drawn('step', table),
  ])
  const anyLine = kit.all('line', (l) => table(l) && l.stat.kind === 'summary')[0]
  // Roadmap 46b: a Significance layer's points are in its classes' colours (their own entries).
  const points = kit.drawn('points', (l) => table(l) && !l.aes && !isThresholdLayer(l))
  const polygons = kit.drawn('polygon', table)
  const paths = kit.drawn('path', table)
  const outputLines = kit.drawn('line', (l) => kit.data(l).from === 'outputs')
  const outputPoints = kit.drawn('points', (l) => !table(l) && !isThresholdLayer(l))
  const functionLines = kit.all('line', (l) => kit.data(l).from === 'functions')
  // A data set (output) only Significance layers draw has no entry of its own (roadmap 46b).
  const tableLayers = kit.graph.layers.filter((l) => l.visible !== false && table(l))
  const outputLayers = kit.graph.layers.filter(
    (l) => l.visible !== false && kit.data(l).from === 'outputs',
  )

  /** What a legend sample draws with: swatch, line and symbol from the layers drawing them. */
  const sampleStyle = (
    id: ResolvedSeriesStyle,
    parts: { bar?: Layer; box?: Layer; line?: Layer; points?: Layer },
    key: string,
  ): ResolvedSeriesStyle => ({
    ...id,
    bar: parts.bar ? kit.style(parts.bar, key).bar : id.bar,
    box: parts.box ? kit.style(parts.box, key).box : id.box,
    line: parts.line ? kit.style(parts.line, key).line : id.line,
    points: parts.points ? kit.style(parts.points, key).points : { ...id.points, show: false },
  })

  return [
    ...d.series
      .filter((p) => !onlyClassed(kit, tableLayers, p.s.key))
      .map((p) => {
        const key = p.s.key
        const bar = first(bars, key)
        const box = first(boxes, key)
        const path = first(paths, key)
        const line = first(lines, key)
        const symbols = first(points, key)
        const curve = !!line || !!path || d.curves.some((c) => c.matched && c.color === p.color)
        // Ellipses or hulls alone: a swatch of their fill and outline (roadmap 34c).
        const polygon = !bar && !box && !curve && !symbols ? first(polygons, key) : undefined
        // Areas alone (stacked areas): a swatch of the area's fill.
        const area = !bar && !box && !curve && !symbols ? first(areas, key) : undefined
        const style = sampleStyle(
          kit.identity(key),
          { bar, box, line: line ?? anyLine, points: symbols },
          key,
        )
        const dashes = graphDashes(kit.graph, kit.theme)
        const groupFill = polygon ? kit.fillOf(key) : undefined
        const pathStroke =
          !line && path ? lineStyleOf(path, key, kit.theme, dashes, p.s.index).stroke : undefined
        // Audit 2 (G4): nothing above stands for the data set (an area under no line, an error
        // envelope, error bars or the replicates' lines alone): the glyph of a layer drawing it
        // (`glyphLayer`). The replicates' lines are in their faded colour.
        const alone =
          !bar && !box && !curve && !symbols && !polygon && !area
            ? glyphLayer(
                kit.graph.layers.filter((l) => table(l) && kit.shows(l, key)),
                ['line', 'area', 'band', 'errorbar'],
              )
            : undefined
        const aloneStyle = alone && kit.style(alone[1], key)
        const spaghetti = alone?.[0] === 'line' && aloneStyle
        return {
          key,
          id: `legend/${key}`,
          target: ['seriesOverrides', key],
          label: seriesTitle(p.s) as string | RichText,
          color: p.color,
          style: {
            ...(area ? { ...style, area: kit.style(area, key).area } : style),
            ...(pathStroke ? { line: { ...style.line, stroke: pathStroke } } : {}),
          },
          curve,
          bar: bar ? ('bar' as const) : box ? ('box' as const) : area ? ('area' as const) : false,
          polygon: polygon
            ? polygonSwatch(polygon, key, palette, p.color, kit.theme, {
                ...(groupFill ? { fill: groupFill } : {}),
                dashes,
                index: p.s.index,
              })
            : undefined,
          ...(alone && aloneStyle
            ? {
                glyph: alone[0] as 'line' | 'area' | 'band' | 'errorbar',
                glyphStyle: spaghetti
                  ? {
                      ...aloneStyle,
                      line: { ...aloneStyle.line, stroke: aloneStyle.spaghetti.stroke },
                    }
                  : aloneStyle,
                glyphColor: spaghetti
                  ? mixColor(p.color, '#ffffff', aloneStyle.spaghetti.fade)
                  : p.color,
              }
            : {}),
        }
      }),
    ...d.curves
      .filter((c) => !c.matched && !onlyClassed(kit, outputLayers, c.id))
      .map((c) => {
        const line = first(outputLines, c.id)
        return {
          key: c.id,
          id: `legend/curve/${c.index}`,
          target: ['extraSeries', c.index],
          label: c.data.title as string | RichText,
          color: c.color,
          style: sampleStyle(
            kit.identity(c.id, true),
            {
              line: line ?? kit.all('line', (l) => kit.data(l).from === 'outputs')[0],
              points: first(outputPoints, c.id),
            },
            c.id,
          ),
          curve: !!line,
          bar: false as const,
          polygon: undefined,
        }
      }),
    ...fns.map((f) => {
      const fc = defs[f.index]!
      return {
        key: f.id,
        id: `legend/function/${f.index}`,
        target: ['functions', f.index],
        label: fc.title ? labelRuns(fc.title) : (f.data.title as string | RichText),
        color: f.color,
        style: sampleStyle(kit.identity(f.id, true), { line: functionLines[0] }, f.id),
        curve: true,
        bar: false as const,
        polygon: undefined,
      }
    }),
  ].map((e) => ({
    key: e.key,
    id: e.id,
    target: e.target,
    label: e.label,
    sample: (lx: number, ly: number) => {
      if ('glyph' in e && e.glyph && e.glyphStyle)
        return [
          swatchSample(
            e.id,
            e.target,
            e.glyph,
            e.glyphStyle,
            e.glyphColor ?? e.color,
            palette,
            lx + (LEGEND_SAMPLE - SWATCH) / 2,
            ly,
          ),
        ]
      if (e.polygon)
        return [polygonSample(e.id, e.target, e.polygon, lx + (LEGEND_SAMPLE - SWATCH) / 2, ly)]
      // Bars (boxes): a swatch of the bar's (box's) fill and border.
      if (e.bar)
        return [
          swatchSample(
            e.id,
            e.target,
            e.bar as 'bar' | 'box' | 'area',
            e.style,
            e.color,
            palette,
            lx + (LEGEND_SAMPLE - SWATCH) / 2,
            ly,
          ),
        ]
      const kids: SceneNode[] = []
      const stroke = resolveStroke(e.style.line.stroke, palette, e.color)
      if (e.curve) kids.push(lineSample(e.id, e.target, stroke, lx, ly))
      if (e.style.points.show)
        kids.push(
          symbolSample(e.id, e.target, e.style, e.color, palette, lx + LEGEND_SAMPLE / 2, ly),
        )
      return kids
    },
  }))
}
