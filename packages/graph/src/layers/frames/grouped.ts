import {
  barCategoryKey,
  isValueSourced,
  type Layer,
  labelRuns,
  levelKey,
  type PointStyle,
  type Position,
  rowCategoryKey,
  sourceTable,
} from '@ps/model'
import {
  boxOf,
  centerOf,
  errorBounds,
  type GraphSeries,
  type PlotStats,
  resolveSeries,
  rowTitleOf,
  seriesCellStats,
  seriesTitle,
  tableRow,
} from '../../data.ts'
import { type BracketSpan, layoutBrackets } from '../../layout/annotations.ts'
import {
  asContinuous,
  Extent,
  OFFSET_FRAME,
  tickFit,
  type ValueAxis,
  valueAxis,
} from '../../layout/common.ts'
import { composeGraph } from '../../layout/compose.ts'
import { SWATCH, seriesEntries, swatchSample, symbolSample } from '../../layout/legend.ts'
import { asideOf, categoryPlan, flipNode, orientedFrame, valuePlan } from '../../layout/orient.ts'
import { type PointMarkContext, pointLayer, pointOverride } from '../../layout/points.ts'
import { isMapped, mappedVariables } from '../../mapped.ts'
import type { Box, Scene, SceneNode, StylePath } from '../../scene.ts'
import { resolveColor, resolveStroke, seriesColor } from '../../theme.ts'
import { isLogScale } from '../../transform.ts'
import { violinOf } from '../../violin.ts'
import { groupedBand } from '../geoms/band.ts'
import { type BarEnds, groupedBar } from '../geoms/bar.ts'
import { groupedBox } from '../geoms/box.ts'
import { groupedCenter } from '../geoms/center.ts'
import { pairLines, subjectOf } from '../geoms/connector.ts'
import { groupedError, hostBars } from '../geoms/errorbar.ts'
import { groupedLabel } from '../geoms/label.ts'
import { groupedLine } from '../geoms/line.ts'
import { groupedPoints } from '../geoms/points.ts'
import {
  drawResults,
  isResultLayer,
  resultExtent,
  resultLegend,
  resultPlanes,
  resultSeriesOf,
  withResultLabels,
} from '../geoms/result.ts'
import { groupedViolin } from '../geoms/violin.ts'
import type { LayerKit } from '../kit.ts'
import { linkedExtent } from '../links.ts'
import { groupedSlots, type StackSegment, stackCells } from '../positions.ts'
import { frameLooks, legendGlyph, legendWith } from '../slotLegend.ts'

// The grouped frame: one cluster per table row, one slot per data set within it — side by side
// (dodge), all at the row's centre (aligned), or stacked bars. Grouped and contingency tables.
// Planes: series, pointLabels. Horizontal graphs are drawn vertical and turned (`flipNode`).

export interface GroupedSeries {
  s: GraphSeries
  /** Statistics of each row's cell (rows of the possibly sliced data set). */
  cells: PlotStats[]
  color: string
  /** Plotted against the right Y axis. */
  right: boolean
}

/** One cell (row × data set) as the geoms draw it. */
export interface GroupedCell {
  kit: LayerKit
  key: string
  si: number
  p: GroupedSeries
  /** Row of the data set, and its position among the rows shown. */
  r: number
  gi: number
  c: PlotStats
  target: StylePath
  /** The cell's point key (`r<row>`) and own format, which its bar, box and labels take. */
  cell: string
  own: PointStyle | undefined
  hidden: boolean
  /** The cell's colour: its own, else the data set's. */
  color: string
  axis: ValueAxis
  marksCtx: PointMarkContext
  rowTitles: readonly (string | null)[] | null | undefined
  across: number | undefined
  tRow: (r: number) => number
  /** Slot centre and width of a layer's position. */
  slots: (layer: Layer) => ReturnType<typeof groupedSlots>
  /** A stacked bar layer's segments, per data set and row. */
  stacks: (layer: Layer) => (StackSegment | null)[][] | null
  /** Each cell's share of its row's total in a layer, as 100% stacked bars stack them. */
  shares: (layer: Layer) => (StackSegment | null)[][]
  /** The highest mark drawn in the cell so far (plot-local). */
  top: number
  /** Marks this cell's own (its key: a click selects the cell). */
  mark: (n: SceneNode) => SceneNode
  /** Where each point of the cell was placed (plot-local x by `subject`), for pair lines. */
  placed?: Map<string, number>
}

/** The order the frame draws a cell's geoms in (labels last). */
function rank(l: Layer): number {
  // Layers of an analysis' results (roadmap 35) are drawn by `drawResults`.
  if (isValueSourced(l)) return -1
  switch (l.geom) {
    case 'line':
    case 'band':
      return l.stat.kind === 'summary' ? 0 : -1
    case 'violin':
      return 1
    case 'box':
      return 2
    case 'bar':
      return l.stat.kind === 'summary' ? 3 : -1
    case 'points':
      return l.stat.kind === 'summary' ? 6 : 4
    case 'errorbar':
      return 5
    case 'center':
      return 6
    case 'label':
      return 7
    // Pair lines (roadmap 34c): drawn after the cells, their marks the first data set's.
    case 'connector':
      return 8
    default:
      return -1
  }
}

const stackOf = (l: Layer): Extract<Position, { kind: 'stack' }> | undefined =>
  l.position?.kind === 'stack' ? l.position : undefined

function groupedSeries(kit: LayerKit) {
  const { project, result } = kit.ctx
  const conf = project.settings.defaultConfidenceLevel
  const resolved = resolveSeries(project, kit.graph, result)
  const rowCount = resolved[0]?.ds.rowCount ?? 0
  const series: GroupedSeries[] = resolved.map((s) => ({
    s,
    cells: Array.from({ length: rowCount }, (_, r) => seriesCellStats(s, r, conf)),
    color: seriesColor(kit.identity(s.key).color, kit.palette, s.index),
    right: !!kit.graph.axes.y2 && kit.identity(s.key).yAxis === 'right',
  }))
  // Rows with any data become groups on the X axis.
  const rows = Array.from({ length: rowCount }, (_, r) => r).filter((r) =>
    series.some((p) => p.cells[r]!.n > 0 || Number.isFinite(p.cells[r]!.mean)),
  )
  return { series, rows }
}

/** The stacked bar layer, if the graph stacks its bars (all data sets then on the left axis). */
const stackedBars = (kit: LayerKit) =>
  kit.drawn('bar', (l) => l.stat.kind === 'summary' && !!stackOf(l))[0]

/**
 * Y extent of a grouped graph: means, error bars and points shown, or boxes, of the data sets on
 * one side (the left Y axis by default); stacked bars: the stacks' ends and error bars.
 */
function groupedExtent(
  kit: LayerKit,
  d: ReturnType<typeof groupedSeries>,
  log: boolean,
  side: 'left' | 'right' = 'left',
): Extent {
  const ye = new Extent(log)
  // Counts (text × text graphs of variables) tick at whole numbers, stacked or not.
  ye.integer = d.series.length > 0 && d.series.every((p) => p.s.counts)
  // Lines and bands at an analysis' values (roadmap 35), on the left axis.
  if (side === 'left') resultExtent(kit, 'y', resultSeriesOf(d.series), (v) => ye.add(v))
  const stacked = stackedBars(kit)
  if (stacked) {
    if (side === 'right') return ye
    const stacks = stackCells(
      { series: d.series.map((p) => ({ cells: p.cells, style: kit.style(stacked, p.s.key) })) },
      !!stackOf(stacked)!.percent,
    )
    d.series.forEach((p, i) => {
      const key = p.s.key
      const error = kit.drawn('errorbar').find((l) => l.on === stacked.id && kit.shows(l, key))
      for (const r of d.rows) {
        const seg = stacks[i]![r]
        if (!seg) continue
        const c = p.cells[r]!
        const center = centerOf(c, kit.style(stacked, key).center.stat)
        const stat = error ? kit.style(error, key).error.stat : 'none'
        const e = errorBounds(c, stat, center) ?? [center, center]
        ye.addAll([seg.start, seg.end, ...e.map((v) => seg.end + (v - center) * seg.k)])
      }
    })
    return ye
  }
  const shownBy = <L extends Layer>(layers: L[], key: string) =>
    layers.find((l) => kit.shows(l, key))
  const points = kit.drawn('points', (l) => l.stat.kind === 'identity')
  const violins = kit.drawn('violin')
  const boxes = kit.drawn('box')
  const errors = kit.drawn('errorbar')
  const bars = kit.drawn('bar', (l) => l.stat.kind === 'summary')
  const bands = kit.drawn('band', (l) => l.stat.kind === 'summary')
  const lines = kit.drawn('line', (l) => l.stat.kind === 'summary')
  const symbols = kit.drawn('points')
  // Centre lines and labels at the centre (without them, nothing else may reach it).
  const centers = [...kit.drawn('center'), ...kit.drawn('label', (l) => l.stat.kind !== 'result')]
  for (const p of d.series) {
    if (p.right !== (side === 'right')) continue
    const key = p.s.key
    const violin = shownBy(violins, key)
    const box = shownBy(boxes, key)
    const each =
      !!points.find((l) => kit.shows(l, key) && kit.stat(l, key).kind === 'identity') ||
      kit.drawn('connector').some((l) => kit.shows(l, key))
    for (const r of d.rows) {
      const c = p.cells[r]!
      const values = c.points.map((pt) => pt.value)
      // Bands across the rows, the means a line joins, mean symbols.
      for (const l of [...bands, ...lines, ...symbols, ...centers]) {
        if (!kit.shows(l, key) || kit.stat(l, key).kind !== 'summary') continue
        const style = kit.style(l, key)
        const center = centerOf(c, style.center.stat)
        ye.add(center)
        if (l.geom === 'band') ye.addAll(errorBounds(c, style.error.stat, center) ?? [])
      }
      if (violin || box) {
        if (violin) {
          const v = violinOf(c, kit.style(violin, key).violin)
          if (v) ye.addAll([v.ys[0]!, v.ys.at(-1)!])
        } else if (box) {
          const style = kit.style(box, key)
          const b = boxOf(c, style.box, style.center.stat)
          if (b) ye.addAll([b.whiskerLo, b.whiskerHi, ...b.outliers.map((o) => o.value)])
        }
        if (each) ye.addAll(values)
        continue
      }
      for (const l of errors) {
        if (!kit.shows(l, key)) continue
        const style = kit.style(l, key)
        const center = centerOf(c, style.center.stat)
        ye.addAll([center, ...(errorBounds(c, style.error.stat, center) ?? [])])
      }
      if (each) ye.addAll(values)
      // Bars from a chosen baseline reach it.
      for (const l of bars) {
        if (!kit.shows(l, key)) continue
        const style = kit.style(l, key)
        const center = centerOf(c, style.center.stat)
        ye.add(center)
        if (style.bar.baseline !== undefined && Number.isFinite(center)) ye.add(style.bar.baseline)
      }
    }
  }
  return ye
}

/** A grouped graph's (left) value extent (no text laid out). */
export function groupedExtentOf(kit: LayerKit, log: boolean): Extent {
  return groupedExtent(kit, groupedSeries(kit), log, 'left')
}

/**
 * Grouped graph: one cluster per table row, one bar (or dot column) per data set within it.
 * This is Prism's "interleaved" grouped layout.
 */
export function layoutGrouped(kit: LayerKit): Scene {
  const { ctx, graph, theme, palette, warnings } = kit
  const data = groupedSeries(kit)
  const { series, rows } = data
  const rowTitles = series[0]?.s.ds.rowTitles
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
  /** Table row of a shown row (they differ when the graph shows a row slice). */
  const tRow = (r: number) => (series[0] ? tableRow(series[0].s, r) : r)

  const ySpec = asContinuous(graph.axes.y)
  const y2Spec = graph.axes.y2
  const W = frame.cat
  const H = frame.val
  // Stacked bars: one bar per row, its segments the data sets (all on the left axis).
  const stacked = stackedBars(kit)
  /** A Y axis' domain and scale, and the mappings the marks use (left: linked; right: never). */
  const yAxisOf = (spec: typeof ySpec, side: 'left' | 'right') => {
    const isLog = isLogScale(spec.scale)
    const own = groupedExtent(kit, data, isLog, side)
    const extent = side === 'left' ? linkedExtent(kit, 'y', own, isLog) : own
    const fit = tickFit(ctx, theme, frame.horizontal ? 'x' : 'y', spec, H)
    return valueAxis(spec, extent, true, [H, 0], warnings, fit)
  }
  const leftAxis = yAxisOf(ySpec, 'left')
  const rightAxis = y2Spec ? yAxisOf(y2Spec, 'right') : leftAxis

  const planeLayers = graph.layers.filter((l) => l.visible !== false && rank(l) >= 0)
  const lines = kit.drawn('line', (l) => l.stat.kind === 'summary')
  const bands = kit.drawn('band', (l) => l.stat.kind === 'summary')
  const drawing = [...planeLayers].sort((a, b) => rank(a) - rank(b))
  const slotCache = new Map<Layer, ReturnType<typeof groupedSlots>>()
  const slots = (layer: Layer) => {
    let s = slotCache.get(layer)
    if (!s) {
      // An attached layer (error bars, labels) sits where its host does.
      const placed = (layer.on && kit.byId(layer.on)) || layer
      s = groupedSlots(placed.position, rows.length, series.length, W, graph.style.categoryGap)
      slotCache.set(layer, s)
    }
    return s
  }
  // The cells' places for brackets: the first drawn layer's (all layers share one in v1).
  const primary = drawing[0]
    ? slots(drawing[0])
    : groupedSlots(undefined, rows.length, series.length, W, graph.style.categoryGap)
  const stackCache = new Map<Layer, (StackSegment | null)[][]>()
  const stacks = (layer: Layer) => {
    const st = stackOf(layer)
    if (!st) return null
    let s = stackCache.get(layer)
    if (!s) {
      s = stackCells(
        { series: series.map((p) => ({ cells: p.cells, style: kit.style(layer, p.s.key) })) },
        !!st.percent,
      )
      stackCache.set(layer, s)
    }
    return s
  }
  const shareCache = new Map<Layer, (StackSegment | null)[][]>()
  const shares = (layer: Layer) => {
    let s = shareCache.get(layer)
    if (!s) {
      s = stackCells(
        { series: series.map((p) => ({ cells: p.cells, style: kit.style(layer, p.s.key) })) },
        true,
      )
      shareCache.set(layer, s)
    }
    return s
  }

  // --- Marks, tracking the highest point drawn at each x (for brackets) -----------------------
  const tops: { x: number; top: number }[] = []
  /** Top of the highest bar label (plot-local; above the plot when < 0). */
  let labelTop = 0
  /** Where each data set's points went, by subject (pair lines join them). */
  const placed = series.map(() => new Map<string, number>())
  series.forEach((p, si) => {
    const key = p.s.key
    const target = ['seriesOverrides', key]
    const axis = p.right && !stacked ? rightAxis : leftAxis
    // The error as a band, and the means (or medians) joined, across the rows: a time course
    // kept as a grouped table.
    for (const layer of bands)
      if (kit.shows(layer, key))
        tops.push(
          ...groupedBand({ kit, key, si, p, rows, axis, target, x: slots(layer).cx }, layer),
        )
    for (const layer of lines)
      if (kit.shows(layer, key))
        groupedLine({ kit, key, si, p, rows, axis, target, x: slots(layer).cx }, layer)
    rows.forEach((r, gi) => {
      // The cell's own format (`pointOverrides` under its row key): its bar or box, error bar,
      // centre and mean symbol.
      const cell = `r${tRow(r)}`
      const own = pointOverride(graph, key, cell)
      const g: GroupedCell = {
        kit,
        key,
        si,
        p,
        r,
        gi,
        c: p.cells[r]!,
        target,
        cell,
        own,
        hidden: !!own?.hide,
        color: own?.color ? resolveColor(own.color, palette, p.color) : p.color,
        axis,
        marksCtx,
        rowTitles,
        across,
        tRow,
        slots,
        stacks,
        shares,
        top: Number.POSITIVE_INFINITY,
        mark: (n) => ({ ...n, point: cell }),
        placed: placed[si]!,
      }
      const ends = new Map<string, BarEnds | undefined>()
      for (const layer of drawing) {
        if (!kit.shows(layer, key)) continue
        if (layer.geom === 'violin') groupedViolin(g, layer)
        else if (layer.geom === 'box') groupedBox(g, layer)
        else if (layer.geom === 'bar') ends.set(layer.id, groupedBar(g, layer))
        else if (layer.geom === 'points') groupedPoints(g, layer)
        else if (layer.geom === 'errorbar') groupedError(g, layer)
        else if (layer.geom === 'center') groupedCenter(g, layer)
        else if (layer.geom === 'label') {
          const host = hostBars(kit, layer, key)
          const top = groupedLabel(g, layer, host, ends.get(host?.id ?? ''))
          if (top !== undefined) labelTop = Math.min(labelTop, top)
        }
      }
      if (Number.isFinite(g.top)) tops.push({ x: primary.cx(gi, si), top: g.top })
    })
  })
  const keys = series.map((p) => p.s.key)
  // Pair lines (roadmap 34c): each subject's points joined across the data sets within a row.
  for (const layer of kit.drawn('connector')) {
    const joined = series.filter((p) => kit.shows(layer, p.s.key))
    if (joined.length < 2) continue
    const at = joined.map((p) => series.indexOf(p))
    const own = !!series[0]?.s.cells
    const part = kit.part(layer, '', 'pairs')
    const stroke = resolveStroke(kit.style(layer, keys[0]!).error.line, palette, '#000000')
    rows.forEach((r, gi) => {
      const nodes = pairLines(
        joined.map((p) => ({ s: p.s, stats: p.cells[r]! })),
        (j, subject) => placed[at[j]!]!.get(String(subject)) ?? primary.cx(gi, at[j]!),
        leftAxis,
        W,
        H,
        stroke,
        `${part}/${tRow(r)}`,
        (_s, pt) => subjectOf(pt, tRow(r), own),
        // On screen with points sampled (decision 450): the subjects whose points are drawn.
        kit.sampled ? (subject) => at.some((i) => placed[i]!.has(String(subject))) : undefined,
      )
      if (nodes.length) kit.addList(layer, joined[0]!.s.key, nodes)
    })
  }
  // Labels, lines and bands of analyses' results (roadmap 35): at the clusters' centres and
  // the left axis' values; drawn by layer in the list's order, by data set over the groups.
  const results = resultSeriesOf(series)
  const L = H
  const rowAt = (i: number) => (i + 0.5) * (W / Math.max(rows.length, 1))
  drawResults({
    kit,
    U: W,
    V: H,
    v: (y) => (leftAxis.ok(y) ? leftAxis.point(y) : Number.NaN),
    W: graph.size.plotWidth,
    H: graph.size.plotHeight,
    point: (i, y) =>
      leftAxis.ok(y) ? frame.flip(rowAt(i), leftAxis.point(y)) : [Number.NaN, Number.NaN],
    ...(frame.horizontal
      ? {
          toDrawing: (b: Box) => ({ x: b.y, y: L - b.x - b.w, w: b.h, h: b.w }),
          toFinal: frame.flip,
        }
      : {}),
    series: results,
  })
  const withResults = graph.layers.filter(
    (l) => l.visible !== false && (rank(l) >= 0 || isResultLayer(l)),
  )
  const marks = kit.seriesMajor
    ? [
        ...kit.seriesPlane(planeLayers, keys),
        ...resultPlanes(kit, keys).flatMap((p) => [{ id: p.id, children: p.draw(p.layers) }]),
      ]
    : kit.seriesPlane(withResults, keys)

  // --- Brackets between cells ------------------------------------------------------------------
  const seriesIndex = new Map(series.map((p, i) => [p.s.key, i]))
  // Brackets name table rows; those outside a row slice are skipped.
  const groupIndex = new Map(rows.map((r, gi) => [tRow(r), gi]))
  const xOf = (key: string, row: number | undefined) => {
    const si = seriesIndex.get(key)
    const gi = row === undefined ? undefined : groupIndex.get(row)
    return si === undefined || gi === undefined ? undefined : primary.cx(gi, si)
  }
  const spans: BracketSpan[] = graph.annotations.flatMap((a, idx) => {
    // Brackets at one X (roadmap 35) belong to XY graphs.
    if (a.type !== 'bracket' || a.x !== undefined) return []
    const xa = xOf(a.a, a.rowA)
    const xb = xOf(a.b, a.rowB)
    if (xa === undefined || xb === undefined) return []
    // A group of data sets pooled against one (roadmap 35), in a's row.
    const gx = [xa, ...(a.group ?? []).flatMap((k) => xOf(k, a.rowA) ?? [])]
    if (a.group?.length && gx.length > 1) {
      const [g1, g2] = [Math.min(...gx), Math.max(...gx)]
      return [
        { a, idx, x1: Math.min(g1, xb), x2: Math.max(g2, xb), group: { x1: g1, x2: g2, to: xb } },
      ]
    }
    return [{ a, idx, x1: Math.min(xa, xb), x2: Math.max(xa, xb) }]
  })
  const brackets = layoutBrackets(ctx, theme, palette, spans, tops, H, across)

  // --- Axes, legend ----------------------------------------------------------------------------
  const rowLabel = (r: number) =>
    (series[0] && rowTitleOf(series[0].s, r)) ?? rowTitles?.[r] ?? `Row ${tRow(r) + 1}`
  // Roadmap 36: the groups (a table's rows by row, a graph of variables' levels by their text)
  // and their bars, by key, for a treatment grid and spans.
  const mapped = isMapped(graph)
  const groupKey = (r: number) =>
    mapped ? levelKey(rowTitles?.[r] ?? '') : rowCategoryKey(tRow(r))
  const groupW = W / Math.max(rows.length, 1)
  const dodged = series.length < 2 || primary.cx(0, 0) !== primary.cx(0, 1)
  const xPlan = categoryPlan(
    ctx,
    theme,
    palette,
    frame.horizontal,
    rows.map(rowLabel),
    W,
    ySpec.frame === 'offset' ? OFFSET_FRAME : 0,
    {
      groups: rows.map((r, gi) => ({
        key: groupKey(r),
        title: labelRuns(rowLabel(r)),
        from: gi * groupW,
        to: (gi + 1) * groupW,
        center: (gi + 0.5) * groupW,
      })),
      bars: dodged
        ? rows.flatMap((r, gi) =>
            series.map((p, si) => {
              const center = primary.cx(gi, si)
              return {
                key: barCategoryKey(groupKey(r), p.s.key),
                group: groupKey(r),
                title: seriesTitle(p.s),
                from: center - primary.sub / 2,
                to: center + primary.sub / 2,
                center,
              }
            }),
          )
        : [],
    },
  )
  // The groups' legend: a level's symbol when shape maps their variable (roadmap 34b).
  const own = seriesEntries(series, (p, id, target, x, cy) => {
    const [kind, layer] = legendGlyph(kit, p.s.key)
    if (!kind) return []
    const style = layer ? kit.style(layer, p.s.key) : kit.identity(p.s.key)
    const shape = looks?.seriesShape(p.s.key)
    if (!shape) return [swatchSample(id, target, kind, style, p.color, palette, x, cy)]
    const symbol = { ...style, points: { ...style.points, shape } }
    if (kind === 'points') return [swatchSample(id, target, kind, symbol, p.color, palette, x, cy)]
    return [
      swatchSample(id, target, kind, style, p.color, palette, x, cy),
      symbolSample(`${id}/level`, target, symbol, p.color, palette, x + SWATCH / 2, cy),
    ]
  })
  const legend = legendWith(kit, looks, withResultLabels(kit, own, results), {
    keep: true,
    title: groupsTitle(kit),
    extra: resultLegend(kit, results, SWATCH),
  })

  const yPlan = valuePlan(ctx, theme, palette, frame.horizontal, ySpec, leftAxis)
  const y2Plan =
    y2Spec && valuePlan(ctx, theme, palette, frame.horizontal, y2Spec, rightAxis, { right: true })
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
      ...(y2Plan ? { top: y2Plan } : {}),
      layers: [flipNode({ id: 'series', children: marks }, H), pointLabelLayer],
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
    ...(y2Plan ? { y2: y2Plan } : {}),
    layers: [{ id: 'series', children: marks }, pointLabelLayer],
    brackets: { nodes: brackets.nodes, top },
    legend,
    warnings,
  })
}

/** The variable a grouped graph of variables' groups are the levels of: its colour, or Y (counts). */
function groupsTitle(kit: LayerKit): string | undefined {
  const { graph } = kit
  if (!graph.mapping) return undefined
  const table = sourceTable(kit.ctx.project, graph.seriesSource.table, kit.ctx.result)
  const group = table && mappedVariables(table, graph.mapping)?.group
  return group ? group.title || group.id : undefined
}
