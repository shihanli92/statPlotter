import { isValueSourced, type Layer, mergeRuns } from '@ps/model'
import {
  boxOf,
  centerOf,
  errorBounds,
  type GraphSeries,
  type PlotStats,
  plotStats,
  resolveSeries,
  seriesTitle,
} from '../../data.ts'
import { type BracketSpan, layoutBrackets } from '../../layout/annotations.ts'
import {
  asContinuous,
  type ContinuousAxis,
  Extent,
  OFFSET_FRAME,
  tickFit,
  type ValueAxis,
  valueAxis,
} from '../../layout/common.ts'
import { composeGraph } from '../../layout/compose.ts'
import { SWATCH, seriesEntries, swatchSample } from '../../layout/legend.ts'
import { type Subject, subjectsOf } from '../../layout/nested.ts'
import { asideOf, categoryPlan, flipNode, orientedFrame, valuePlan } from '../../layout/orient.ts'
import { type PointMarkContext, pointLayer } from '../../layout/points.ts'
import { isMapped } from '../../mapped.ts'
import type { Box, Scene, SceneNode, StylePath } from '../../scene.ts'
import { resolveStroke, seriesColor } from '../../theme.ts'
import { isLogScale } from '../../transform.ts'
import { violinOf } from '../../violin.ts'
import { type BarEnds, categoryBar } from '../geoms/bar.ts'
import { categoryBox } from '../geoms/box.ts'
import { categoryCenter } from '../geoms/center.ts'
import { pairLines } from '../geoms/connector.ts'
import { differenceMarks, ESTIMATION_AXIS } from '../geoms/difference.ts'
import { categoryError } from '../geoms/errorbar.ts'
import { categoryLabel } from '../geoms/label.ts'
import { categoryLine } from '../geoms/line.ts'
import { categoryPoints } from '../geoms/points.ts'
import { reflineNode } from '../geoms/refline.ts'
import {
  drawResults,
  resultExtent,
  resultLegend,
  resultPlanes,
  resultSeriesOf,
  withResultLabels,
} from '../geoms/result.ts'
import { categoryViolin } from '../geoms/violin.ts'
import type { LayerKit } from '../kit.ts'
import { linkedExtent } from '../links.ts'
import { frameLooks, legendGlyph, legendWith } from '../slotLegend.ts'
import { estimationDiffs, grandMeanOf } from '../stats/difference.ts'

// The category frame: one slot per data set (column tables, nested groups, multiple variables as
// columns), plus slots a difference layer adds. Planes: grandMean (a bare node),
// estimation/guides, estimation, pairs, series, pointLabels. Horizontal graphs are drawn in the
// vertical frame and turned (`flipNode`).

/** One data set in its category, as the geoms draw it. */
export interface CategorySlot {
  kit: LayerKit
  key: string
  s: GraphSeries
  stats: PlotStats
  color: string
  /** The category's centre and width (plot-local, in the vertical frame). */
  x0: number
  band: number
  target: StylePath
  Y: ValueAxis
  ySpec: ContinuousAxis
  marksCtx: PointMarkContext
  /** A nested group's subjects (none for summary data or a single subcolumn). */
  subjects: Subject[]
  /** Horizontal graphs: the value axis' length (labels are placed turned). */
  across: number | undefined
  /** Records how high the data set's marks reach (for labels and brackets). */
  touch: (py: number) => void
  /**
   * Records where a table row's point was drawn across the category (spread in a swarm or
   * jittered), so before-after lines end on the points. The first placement of a row counts.
   */
  placed?: (row: number, px: number) => void
}

interface CategorySeries {
  s: GraphSeries
  stats: PlotStats
  color: string
}

/** The order the frame draws its geoms in, per data set (labels last: they sit above all). */
function rank(l: Layer): number {
  // Layers of an analysis' results (roadmap 35) are drawn by `drawResults`.
  if (isValueSourced(l)) return -1
  switch (l.geom) {
    case 'bar':
      return l.stat.kind === 'summary' ? 0 : -1
    case 'violin':
      return 1
    case 'box':
      return 2
    case 'points':
      return 3
    case 'center':
      return l.stat.by === 'subject' ? 4 : 6
    case 'errorbar':
      return 5
    case 'label':
      return 7
    case 'line':
      // Means joined across the categories: drawn once all of them are placed.
      return l.stat.kind === 'summary' ? 8 : -1
    default:
      return -1
  }
}

function categorySeries(kit: LayerKit): CategorySeries[] {
  const { project, result } = kit.ctx
  const conf = project.settings.defaultConfidenceLevel
  return resolveSeries(project, kit.graph, result).map((s) => ({
    s,
    stats: plotStats(s.ds, conf),
    color: seriesColor(kit.identity(s.key).color, kit.palette, s.index),
  }))
}

/** Y extent of a category graph: points shown, centres and error bars, or box whiskers. */
function categoryExtent(
  kit: LayerKit,
  series: readonly CategorySeries[],
  log: boolean,
  warnings?: string[],
): Extent {
  const extent = new Extent(log)
  const include = (v: number) => extent.add(v)
  const conf = kit.ctx.project.settings.defaultConfidenceLevel
  const shownBy = <L extends Layer>(layers: L[], key: string) =>
    layers.find((l) => kit.shows(l, key))
  // Estimation plots: the differences sit on the control's mean (the right axis' zero).
  const diff = kit.drawn('difference')[0]
  if (diff)
    for (const d of estimationDiffs(series, diff.stat.ci === 'welch', conf))
      for (const v of [d.diff, d.lo, d.hi]) include(d.control + v)
  if (kit.drawn('refline', (l) => l.stat.kind === 'summary').length) include(grandMeanOf(series))
  // Lines and bands at an analysis' values (roadmap 35).
  resultExtent(kit, 'y', resultSeriesOf(series), include)
  const points = kit.drawn('points')
  const violins = kit.drawn('violin')
  const boxes = kit.drawn('box')
  const errors = kit.drawn('errorbar')
  const bars = kit.drawn('bar', (l) => l.stat.kind === 'summary')
  const lines = kit.drawn('line', (l) => l.stat.kind === 'summary')
  const centers = kit.drawn('center')
  const labels = kit.drawn('label', (l) => l.stat.kind !== 'result')
  const connectors = kit.drawn('connector')
  for (const p of series) {
    const key = p.s.key
    // Every value (points, before-after lines through them, subjects' means among them), or (a
    // mean symbol, a line through the means, a centre line, a label) the centre.
    const every = [...points.filter((l) => kit.stat(l, key).kind === 'identity'), ...connectors]
    if (
      every.some((l) => kit.shows(l, key)) ||
      centers.some((l) => {
        const st = kit.stat(l, key)
        return kit.shows(l, key) && st.kind === 'summary' && st.by === 'subject'
      })
    )
      for (const pt of p.stats.points) include(pt.value)
    for (const l of [...points, ...lines, ...centers, ...labels])
      if (kit.shows(l, key) && kit.stat(l, key).kind === 'summary')
        include(centerOf(p.stats, kit.style(l, key).center.stat))
    const violin = shownBy(violins, key)
    const box = shownBy(boxes, key)
    if (violin) {
      const v = violinOf(p.stats, kit.style(violin, key).violin)
      if (v) [v.ys[0]!, v.ys.at(-1)!].forEach(include)
      else if (p.stats.n > 0) warnings?.push(`${p.s.title}: violin plots need raw data.`)
    } else if (box) {
      const style = kit.style(box, key)
      const b = boxOf(p.stats, style.box, style.center.stat)
      if (b) [b.whiskerLo, b.whiskerHi, ...b.outliers.map((o) => o.value)].forEach(include)
      else if (p.stats.n > 0) warnings?.push(`${p.s.title}: box plots need raw data.`)
    } else {
      // A summary's centre and its error bar.
      for (const l of errors) {
        if (!kit.shows(l, key)) continue
        const style = kit.style(l, key)
        const center = centerOf(p.stats, style.center.stat)
        include(center)
        const e = errorBounds(p.stats, style.error.stat, center)
        if (e) e.forEach(include)
      }
      // Bars from a chosen baseline reach it.
      for (const l of bars) {
        if (!kit.shows(l, key)) continue
        const style = kit.style(l, key)
        const center = centerOf(p.stats, style.center.stat)
        include(center)
        if (style.bar.baseline !== undefined && Number.isFinite(center)) include(style.bar.baseline)
      }
    }
  }
  return extent
}

/** A category graph's value extent (no text laid out). */
export function categoryExtentOf(kit: LayerKit, log: boolean): Extent {
  return categoryExtent(kit, categorySeries(kit), log)
}

/** Lays out a category graph (scatter, bars, boxes, violins, before-after, estimation). */
export function layoutCategory(kit: LayerKit): Scene {
  const { ctx, graph, theme, palette, warnings } = kit
  const series = categorySeries(kit)
  // Horizontal graphs: marks are drawn in the vertical frame and turned (see `flipNode`).
  const frame = orientedFrame(graph, graph.style.orientation === 'horizontal')
  const across = frame.horizontal ? frame.val : undefined
  // Variables mapped to appearance (roadmap 34b): each row's point colour, symbol, size, label.
  const looks = frameLooks(kit)
  const { labels: pointLabels, marksCtx } = pointLayer(
    ctx,
    theme,
    palette,
    (k) => kit.identity(k).pointLabels,
    frame.horizontal ? frame.flip : undefined,
    looks,
  )

  const yAxis = graph.axes.y
  const xAxis = graph.axes.x
  if (yAxis.type !== 'continuous' || xAxis.type !== 'categorical') {
    warnings.push('Column graphs need a categorical X axis and a continuous Y axis.')
  }
  const ySpec = asContinuous(yAxis)
  const isLog = isLogScale(ySpec.scale)

  const conf = ctx.project.settings.defaultConfidenceLevel
  // Estimation plots: each data set's difference from the first, on a floating right axis.
  const diffLayer = kit.drawn('difference')[0]
  const est = !!diffLayer
  if (est && isLog) warnings.push('Estimation plots need a linear Y axis for the differences.')
  if (est && series.length < 2) warnings.push('An estimation plot needs two or more data sets.')
  const diffs =
    diffLayer && !isLog ? estimationDiffs(series, diffLayer.stat.ci === 'welch', conf) : []

  // --- Data extent (widened by linked graphs) --------------------------------------------------
  const extent = linkedExtent(kit, 'y', categoryExtent(kit, series, isLog, warnings), isLog)

  // --- Scales (plot-local coordinates: origin at plot top-left) ------------------------------
  const W = frame.cat
  const H = frame.val
  const fit = tickFit(ctx, theme, frame.horizontal ? 'x' : 'y', ySpec, H)
  const Y = valueAxis(ySpec, extent, true, [H, 0], warnings, fit)
  const { ok: inPlot, point: yPoint } = Y
  const n = Math.max(series.length + diffs.length, 1)
  const band = W / n
  const cx = (i: number) => (i + 0.5) * band

  // --- Series marks and per-category data tops (for brackets) ---------------------------------
  const dataTop = series.map(() => Number.POSITIVE_INFINITY) // smallest plot-y reached
  const touch = (i: number, py: number) => {
    if (Number.isFinite(py)) dataTop[i] = Math.min(dataTop[i]!, py)
  }
  /** Top of the highest bar label (plot-local; above the plot when < 0). */
  let labelTop = 0

  // Where each data set's points landed, by table row (before-after lines end on them).
  const placedX = series.map(() => new Map<number, number>())
  const planeLayers = graph.layers.filter((l) => l.visible !== false && rank(l) >= 0)
  const drawing = [...planeLayers].sort((a, b) => rank(a) - rank(b))
  // Means joined across the categories (before labels, which sit above them).
  for (const layer of kit.drawn('line', (l) => l.stat.kind === 'summary'))
    categoryLine(
      kit,
      layer,
      series.map((p, i) => ({
        key: p.s.key,
        stats: p.stats,
        x: cx(i),
        touch: (py: number) => touch(i, py),
      })),
      Y,
    )
  series.forEach((p, i) => {
    const key = p.s.key
    const slot: CategorySlot = {
      kit,
      key,
      s: p.s,
      stats: p.stats,
      color: p.color,
      x0: cx(i),
      band,
      target: ['seriesOverrides', key],
      Y,
      ySpec,
      marksCtx,
      subjects: subjectsOf(p.s, p.stats.points),
      across,
      touch: (py) => touch(i, py),
      placed: (row, px) => {
        if (!placedX[i]!.has(row)) placedX[i]!.set(row, px)
      },
    }
    const ends = new Map<string, BarEnds | undefined>()
    for (const layer of drawing) {
      if (!kit.shows(layer, key)) continue
      if (layer.geom === 'bar') ends.set(layer.id, categoryBar(slot, layer))
      else if (layer.geom === 'violin') categoryViolin(slot, layer)
      else if (layer.geom === 'box') categoryBox(slot, layer)
      else if (layer.geom === 'points') categoryPoints(slot, layer)
      else if (layer.geom === 'center') categoryCenter(slot, layer)
      else if (layer.geom === 'errorbar') categoryError(slot, layer)
      else if (layer.geom === 'label') {
        // Above the column's marks (its value, mean, n…), drawn over them.
        const top = categoryLabel(slot, layer, dataTop[i]!, ends.get(layer.on ?? ''))
        if (top !== undefined) labelTop = Math.min(labelTop, top)
      }
    }
  })
  const keys = series.map((p) => p.s.key)
  // Every data set's marks are drawn: settle them (clouds of many points) now, as reading them
  // does. Only drawing by data set groups them by data set (audit 2, G15).
  kit.settle()
  const marks = kit.seriesMajor ? kit.seriesPlane(planeLayers, keys) : []

  // Before-after connecting lines (by data set: beneath the points), each layer's.
  const pairLayers = kit.drawn('connector')
  const pairsOf = (pairs: Layer): SceneNode[] => {
    const joined = series.filter((p) => kit.shows(pairs, p.s.key))
    const at = joined.map((p) => series.indexOf(p))
    if (series.length < 2) return []
    // On screen with points sampled (decision 450): the rows whose points are drawn.
    const keep = kit.sampled
      ? (row: number | string) => at.some((i) => placedX[i]!.has(row as number))
      : undefined
    const nodes = pairLines(
      joined,
      (j, row) => placedX[at[j]!]!.get(row as number) ?? cx(at[j]!),
      Y,
      W,
      H,
      resolveStroke(kit.style(pairs, keys[0]!).error.line, palette, '#000000'),
      kit.part(pairs, '', 'pairs'),
      undefined,
      keep,
    )
    for (const n of nodes) n.layer = pairs.id
    return nodes
  }
  const connectors = pairLayers.map((l) => [l, pairsOf(l)] as const)

  // --- Estimation: differences with their CIs, guides, the difference axis --------------------
  const estimation = diffLayer
    ? differenceMarks(ctx, theme, palette, {
        series: series.map((p) => ({ ...p, style: kit.style(diffLayer, p.s.key) })),
        diffs,
        cx,
        y: Y,
        W,
        H,
        touch,
        horizontal: frame.horizontal,
        guides: diffLayer.style?.guides !== false,
        axisSpec: graph.axes.y2 ?? ESTIMATION_AXIS,
        part: (key) => kit.part(diffLayer, key, 'estimation'),
      })
    : null
  // The differences and their guides are the difference layer's marks.
  if (estimation && diffLayer)
    for (const n of [...estimation.nodes, ...estimation.guides]) n.layer = diffLayer.id

  // --- Significance brackets ------------------------------------------------------------------
  const indexOf = new Map(series.map((p, i) => [p.s.key, i]))
  const spans: BracketSpan[] = graph.annotations.flatMap((a, idx) => {
    // Brackets at one X (roadmap 35) belong to XY graphs.
    if (a.type !== 'bracket' || a.x !== undefined) return []
    const ia = indexOf.get(a.a)
    const ib = indexOf.get(a.b)
    if (ia === undefined || ib === undefined) return []
    // A group of data sets pooled against one (roadmap 35).
    const members = [ia, ...(a.group ?? []).flatMap((k) => indexOf.get(k) ?? [])]
    if (a.group?.length && members.length > 1) {
      const gx = members.map(cx)
      const [g1, g2] = [Math.min(...gx), Math.max(...gx)]
      const to = cx(ib)
      return [{ a, idx, x1: Math.min(g1, to), x2: Math.max(g2, to), group: { x1: g1, x2: g2, to } }]
    }
    return [{ a, idx, x1: cx(Math.min(ia, ib)), x2: cx(Math.max(ia, ib)) }]
  })
  const brackets = layoutBrackets(
    ctx,
    theme,
    palette,
    spans,
    dataTop.map((top, i) => ({ x: cx(i), top })),
    H,
    across,
  )

  // --- Axes, legend, frame ---------------------------------------------------------------------
  const yPlan = valuePlan(ctx, theme, palette, frame.horizontal, ySpec, Y)
  const offset = ySpec.frame === 'offset' ? OFFSET_FRAME : 0
  const xPlan = categoryPlan(
    ctx,
    theme,
    palette,
    frame.horizontal,
    [
      ...series.map((p) => seriesTitle(p.s)),
      ...diffs.map((d) =>
        diffs.length === 1
          ? 'Difference'
          : mergeRuns([
              ...seriesTitle(series[d.index]!.s),
              { text: ' − ' },
              ...seriesTitle(series[0]!.s),
            ]),
      ),
    ],
    W,
    offset,
    // Roadmap 36: each data set's (level's) slot, by key, for a treatment grid and spans.
    {
      groups: series.map((p, i) => ({
        key: p.s.key,
        title: seriesTitle(p.s),
        from: i * band,
        to: (i + 1) * band,
        center: cx(i),
      })),
      bars: [],
    },
  )
  // A graph of variables' categories are on the axis: its legend is of the variables mapped to
  // appearance alone (roadmap 34b).
  const results = resultSeriesOf(series)
  const legend = legendWith(
    kit,
    looks,
    withResultLabels(
      kit,
      seriesEntries(series, (p, id, target, x, cy) => {
        const [kind, layer] = legendGlyph(kit, p.s.key)
        if (!kind) return []
        const style = layer ? kit.style(layer, p.s.key) : kit.identity(p.s.key)
        // The line through the centres is one black line for the graph unless styled.
        const color = kind === 'line' ? '#000000' : p.color
        return [swatchSample(id, target, kind, style, color, palette, x, cy)]
      }),
      results,
    ),
    { keep: !isMapped(graph), extra: resultLegend(kit, results, SWATCH) },
  )

  // Labels, lines and bands of analyses' results (roadmap 35): lines at values, labels where seen.
  const L = H
  drawResults({
    kit,
    U: W,
    V: H,
    v: (y) => (inPlot(y) ? yPoint(y) : Number.NaN),
    W: graph.size.plotWidth,
    H: graph.size.plotHeight,
    point: (i, y) => (inPlot(y) ? frame.flip(cx(i), yPoint(y)) : [Number.NaN, Number.NaN]),
    ...(frame.horizontal
      ? {
          toDrawing: (b: Box) => ({ x: b.y, y: L - b.x - b.w, w: b.h, h: b.w }),
          toFinal: frame.flip,
        }
      : {}),
    series: results,
  })

  // A line across the plot at the mean of every value (the grand mean), each layer's.
  const reflines = kit.drawn('refline', (l) => l.stat.kind === 'summary')
  const gm = reflines.length ? grandMeanOf(series) : Number.NaN
  const gy = inPlot(gm) ? yPoint(gm) : Number.NaN
  const grand = reflines.map((l) => {
    const nodes = reflineNode(l, gy, W, palette, kit.part(l, '', 'grandMean'), kit.theme.refline)
    // Frame-drawn marks of layers (the grand mean, before-after lines) carry their layer.
    for (const n of nodes) n.layer = l.id
    return [l, nodes] as const
  })
  // By data set (v1): planes beneath the data sets' marks. By layer: in the list's order.
  if (!kit.seriesMajor) {
    for (const [l, nodes] of grand) kit.addWholeList(l, nodes)
    if (estimation && diffLayer)
      kit.addWholeList(diffLayer, [...estimation.guides, ...estimation.nodes])
    for (const [l, nodes] of connectors) kit.addWholeList(l, nodes)
  }
  /** The frame-drawn marks of some of these layers. */
  const of =
    (drawn: readonly (readonly [Layer, SceneNode[]])[]) =>
    (ls: readonly Layer[]): SceneNode[] =>
      drawn.filter(([l]) => ls.includes(l)).flatMap(([, nodes]) => nodes)
  const diffList = diffLayer ? [diffLayer] : []
  const marksLayers: SceneNode[] = kit.seriesMajor
    ? kit.planesAround(
        [
          { id: 'grandMean', layers: reflines, draw: of(grand), bare: true },
          ...(estimation
            ? [
                {
                  id: 'estimation/guides',
                  layers: diffList,
                  draw: (ls: readonly Layer[]) => (ls.length ? estimation.guides : []),
                },
                {
                  id: 'estimation',
                  layers: diffList,
                  draw: (ls: readonly Layer[]) => (ls.length ? estimation.nodes : []),
                },
              ]
            : []),
          { id: 'pairs', layers: pairLayers, draw: of(connectors) },
          ...resultPlanes(kit, keys),
        ],
        planeLayers,
        { id: 'series', children: marks },
      )
    : [{ id: 'series', children: kit.layerPlane(keys) }]
  const top = Math.min(brackets.top, labelTop)
  const { plotWidth, plotHeight } = graph.size
  const pointLabelLayer = { id: 'pointLabels', children: pointLabels.nodes(plotWidth, plotHeight) }
  if (frame.horizontal)
    return composeGraph({
      ctx,
      theme,
      palette,
      x: yPlan,
      y: xPlan,
      ...(estimation?.axis ? { top: estimation.axis } : {}),
      layers: [...marksLayers.map((n) => flipNode(n, H)), pointLabelLayer],
      brackets: { nodes: brackets.nodes, top: 0 },
      aside: asideOf(top),
      legend,
      warnings,
    })
  return composeGraph({
    ctx,
    theme,
    palette,
    x: xPlan,
    y: yPlan,
    ...(estimation?.axis ? { y2: estimation.axis } : {}),
    layers: [...marksLayers, pointLabelLayer],
    brackets: { nodes: brackets.nodes, top },
    legend,
    warnings,
  })
}
