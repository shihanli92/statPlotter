import {
  type DataTable,
  type GraphNode,
  type Layer,
  type LayerOf,
  levelKey,
  pointKey,
} from '@ps/model'
import { mappedVariable } from '../../aesthetics.ts'
import { graphRows, variableValues } from '../../data.ts'
import { CloudBuilder, drawOrder, drawsCloud } from '../../layout/cloud.ts'
import {
  asContinuous,
  clipPolyline,
  planContinuousAxis,
  tickFit,
  valueAxis,
} from '../../layout/common.ts'
import { composeGraph } from '../../layout/compose.ts'
import { type LegendEntry, reversedEntries, SWATCH } from '../../layout/legend.ts'
import { pointLayer, pointNodes } from '../../layout/points.ts'
import type { Scale } from '../../scale.ts'
import type { Scene, SceneNode, Stroke } from '../../scene.ts'
import { resolveStroke, seriesColor } from '../../theme.ts'
import { isLogScale, type Transform } from '../../transform.ts'
import { curveSources, outputCurves, type XYAxis, type XYCurveCtx } from '../curves.ts'
import { xyCurveBand } from '../geoms/band.ts'
import { drawCentroids } from '../geoms/centroid.ts'
import {
  type DensityGroup,
  type DensityGuide,
  densityAxes,
  densityGuides,
  drawContours,
  drawHexes,
  drawRaster,
} from '../geoms/density.ts'
import { xyCurve } from '../geoms/line.ts'
import {
  drawPath,
  drawPolygon,
  drawSegment,
  type OverlayGroup,
  overlayAxes,
  overlayExtent,
} from '../geoms/overlay.ts'
import { xyCurvePoints } from '../geoms/points.ts'
import {
  drawResults,
  type ResultSeries,
  resultExtent,
  resultLayers,
  resultLegend,
} from '../geoms/result.ts'
import {
  cutoffValues,
  drawClassed,
  edgePlacer,
  isThresholdLayer,
  type PlotMap,
  thresholdLegend,
} from '../geoms/threshold.ts'
import type { LayerKit } from '../kit.ts'
import { linkedExtent } from '../links.ts'
import {
  aesRows,
  type BubbleData,
  type BubbleRow,
  bubbleExtent,
  pickVariables,
} from '../stats/aes.ts'
import {
  cached,
  densityGrid,
  type PlotPoints,
  plotPoints,
  pointDensities,
} from '../stats/density.ts'
import { ownField, pointsOption } from '../theme.ts'

// Bubble plots: the xy frame with a points layer mapping variables (`aes`) of a
// multiple-variables table — X, Y, size (`scales.size`) and colour (`scales.color`, or by
// category for a text variable). The legend is the scales'.

/** The graph's mapped points layer. */
const bubbleLayer = (kit: LayerKit): LayerOf<'points'> | undefined =>
  kit.all('points', (l) => !!l.aes && !isThresholdLayer(l))[0]

/** The graph's rows at its mapped variables, once per layout (audit 2, G7). */
const bubbleData = (kit: LayerKit): BubbleData =>
  kit.memo('bubble/data', () => {
    const layer = bubbleLayer(kit)
    return aesRows(kit.ctx.project, kit.graph, kit.ctx.result, (t) =>
      pickVariables(layer?.aes ?? {}, t),
    )
  })

/**
 * Rows in table order (the drawing order of bubbles all one size): as they are when they already
 * are (a graph of every row; audit 3, P4: no sort of a million rows per layout).
 */
function byRow(rows: readonly BubbleRow[]): BubbleRow[] {
  for (let i = 1; i < rows.length; i++)
    if (rows[i]!.row < rows[i - 1]!.row) return [...rows].sort((a, b) => a.row - b.row)
  return [...rows]
}

/** Lays out a bubble plot. */
export function layoutBubble(kit: LayerKit): Scene {
  const { ctx, graph, theme, palette, warnings } = kit
  const layer = bubbleLayer(kit)!
  const data = bubbleData(kit)
  const { vars, rows } = data
  if (data.table && data.table.dataSets.length < 2)
    warnings.push('A bubble plot needs two variables or more (X and Y).')

  const yKey = vars.y ?? ''
  const style = kit.style(layer, yKey)

  const xSpec = asContinuous(graph.axes.x)
  const ySpec = asContinuous(graph.axes.y)
  const W = graph.size.plotWidth
  const H = graph.size.plotHeight
  const axisOf = (spec: typeof xSpec, which: 'x' | 'y') => {
    const log = isLogScale(spec.scale)
    const own = extentOf(kit, data, which, log)
    const extent = linkedExtent(kit, which, own, log)
    const fit = tickFit(ctx, theme, which, spec, which === 'x' ? W : H)
    return valueAxis(spec, extent, which === 'y', which === 'x' ? [0, W] : [H, 0], warnings, fit)
  }
  const X = axisOf(xSpec, 'x')
  const Y = axisOf(ySpec, 'y')

  // Roadmap 34g: the points in the axes' transformed coordinates, for densities of them.
  const density = densityPoints(kit, data, X.scale, Y.scale)
  // Points coloured by their local density: each row's, by table row.
  const byDensity = ownField(layer, yKey, 'colorBy') === 'density'
  const localDensity = byDensity && density ? rowDensities(layer, yKey, data, density) : null

  // Size, colour, shape and labels by variables (roadmap 34b; the scales: `aesthetics.ts`).
  const looks = kit.looks({
    drawn: rows.map((r) => r.row),
    prefix: 'bubble',
    target: ['style', 'bubble'],
    points: style.points,
    ...(localDensity ? { density: localDensity } : {}),
  })
  const { labels: pointLabels, marksCtx } = pointLayer(
    ctx,
    theme,
    palette,
    (k) => (k === yKey ? style.pointLabels : undefined),
    undefined,
    looks,
  )
  const rowTitles = data.table?.rowTitles
  const index = Math.max(0, data.table?.dataSets.findIndex((d) => d.id === yKey) ?? 0)
  const baseColor = seriesColor(style.color, palette, index)
  const baseFill = kit.fillOf(yKey)
  const sizeOf = (r: BubbleRow) => looks?.row?.size?.(r.row) ?? style.points.size
  const colorOf = (row: number) => looks?.row?.color?.(row) ?? baseColor
  // Roadmap 49d: the fill colours of rows (a fill variable's, a colour level's fill colour) and of
  // the points as a whole (the Y variable's fill colour), for groups' ellipses and hulls.
  const fills: GroupFills = {
    of: (row) => looks?.row?.fill?.(row) ?? colorOf(row),
    base: kit.fillOf(yKey),
  }

  // The drawing order (roadmap 34e): largest bubbles first, so small ones stay visible on top
  // (the table's order, the default); by the colour (else size) variable's value, highest on
  // top; or shuffled with a fixed seed.
  const target = ['seriesOverrides', yKey]
  const drawn = layer.visible !== false && kit.shows(layer, yKey)
  const aes = layer.aes ?? {}
  const order = pointsOption(layer, yKey, 'order')
  const byValue =
    order === 'value' && data.table
      ? (localDensity ?? numberValues(data.table, aes.color) ?? numberValues(data.table, aes.size))
      : null
  const perm = drawOrder(rows.length, order, byValue ? (i) => byValue[rows[i]!.row]! : undefined)
  const ordered = perm
    ? Array.from(perm, (i) => rows[i]!)
    : looks?.row?.size
      ? [...rows].sort((a, b) => sizeOf(b) - sizeOf(a) || a.row - b.row)
      : byRow(rows)
  // Many points: one cloud, an image on screen (roadmap 34e).
  const part = kit.part(layer, yKey, 'point')
  const cloud = drawsCloud(pointsOption(layer, yKey, 'render'), rows.length)
    ? new CloudBuilder(`series/${yKey}/${part}`)
    : null
  const cloudTarget = [...target, 'points']
  let added = false
  for (const r of ordered) {
    if (!drawn) break
    if ((X.log && r.x <= 0) || (Y.log && r.y <= 0)) continue
    const cx = X.scale(r.x)
    const cy = Y.scale(r.y)
    if (
      !Number.isFinite(cx) ||
      !Number.isFinite(cy) ||
      cx < -0.5 ||
      cx > W + 0.5 ||
      cy < -0.5 ||
      cy > H + 0.5
    )
      continue
    const nodes = pointNodes(marksCtx, {
      // A cloud's points are no nodes: no id or target each (audit 3, P4).
      id: cloud ? '' : `series/${yKey}/${part}/${r.row}`,
      target: cloud ? cloudTarget : [...target, 'points'],
      series: yKey,
      key: pointKey(r.row),
      style: style.points,
      color: baseColor,
      ...(baseFill ? { fill: baseFill } : {}),
      cx,
      cy,
      label: { row: r.row, title: rowTitles?.[r.row] ?? null, x: r.x, y: r.y },
      aesRow: r.row,
      ...(cloud ? { cloud: { into: cloud, row: r.row } } : {}),
    })
    // A cloud's points add nothing (once, as the layer's first mark).
    if (nodes.length || !added) kit.addList(layer, yKey, nodes)
    added = true
  }
  if (cloud?.count)
    kit.add(layer, yKey, {
      id: `series/${yKey}/${part}`,
      target: [...target, 'points'],
      prim: cloud.build(),
    })

  // --- Significance (roadmap 46b): the mapped rows classed by the graph's cut-offs ------------
  const classed = kit.drawn('points', isThresholdLayer)
  const map: PlotMap = (vx, vy) => {
    if ((X.log && vx <= 0) || (Y.log && vy <= 0)) return null
    const at: [number, number] = [X.scale(vx), Y.scale(vy)]
    return at.every(Number.isFinite) ? at : null
  }
  const inside = (cx: number, cy: number) =>
    cx >= -0.5 && cx <= W + 0.5 && cy >= -0.5 && cy <= H + 0.5
  for (const l of classed) {
    if (!kit.shows(l, yKey)) continue
    const lpart = kit.part(l, yKey, 'point')
    drawClassed(
      kit,
      l,
      yKey,
      rows.map((r) => ({
        vx: r.x,
        vy: r.y,
        id: `series/${yKey}/${lpart}/${r.row}`,
        row: r.row,
      })),
      (vx, vy) => {
        const at = map(vx, vy)
        return at && inside(at[0], at[1]) ? at : null
      },
      `series/${yKey}/${lpart}`,
      edgePlacer(cutoffValues(kit.graph), map, inside, W, H),
    )
  }

  // --- Ellipses, hulls, paths and vectors by group (roadmap 34c) -------------------------------
  const axes = overlayAxes(
    X.scale,
    Y.scale,
    (vx, vy) =>
      Number.isFinite(vx) && Number.isFinite(vy) && (!X.log || vx > 0) && (!Y.log || vy > 0),
    W,
    H,
  )
  const overlays = overlayLayers(kit)
  for (const l of overlays.polygons)
    if (kit.shows(l, yKey))
      for (const g of overlayGroups(kit, data, undefined, colorOf, baseColor, fills))
        drawPolygon(kit, l, g, axes)
  for (const l of overlays.paths)
    if (kit.shows(l, yKey))
      for (const g of overlayGroups(kit, data, l.aes?.group, colorOf, baseColor))
        drawPath(kit, l, g, axes)
  for (const l of overlays.segments) {
    if (!kit.shows(l, yKey) || !data.table) continue
    const [xe, ye] = [numberValues(data.table, l.aes?.xend), numberValues(data.table, l.aes?.yend)]
    if (!xe || !ye) continue
    const part = kit.part(l, yKey, 'vector')
    for (const r of rows)
      drawSegment(
        kit,
        l,
        {
          key: yKey,
          id: `series/${yKey}/${part}/${r.row}`,
          target,
          color: colorOf(r.row),
          index: groupIndex(kit, data, r.row),
          from: [r.x, r.y],
          to: [xe[r.row]!, ye[r.row]!],
        },
        axes,
      )
  }

  // --- Densities of the points (roadmap 34g) ---------------------------------------------------
  const densityLayers = densityLayersOf(kit)
  const guides: DensityGuide[] = []
  if (density) {
    const dAxes = densityAxes(X.scale, Y.scale, W, H)
    const pts = density
    for (const l of densityLayers.hexes)
      if (kit.shows(l, yKey)) {
        const g = drawHexes(kit, l, yKey, pts, dAxes, data.table)
        if (g) guides.push(g)
      }
    for (const l of densityLayers.rasters)
      if (kit.shows(l, yKey)) {
        const g = drawRaster(kit, l, yKey, pts, dAxes, data.table)
        if (g) guides.push(g)
      }
    if (densityLayers.contours.length) {
      const groups = densityGroups(kit, data, pts, colorOf, baseColor)
      for (const l of densityLayers.contours)
        if (kit.shows(l, yKey)) {
          const g = drawContours(kit, l, pts, groups, dAxes, data.table)
          if (g) guides.push(g)
        }
    }
  }

  // --- Groups' names at their centres (roadmap 34e) ---------------------------------------------
  const centroids = kit.drawn('label', (l) => l.stat.kind === 'centroid')
  for (const l of centroids)
    if (kit.shows(l, yKey))
      drawCentroids(kit, l, yKey, overlayGroups(kit, data, undefined, colorOf, baseColor), axes)

  // --- Analysis outputs over the points (roadmap 34c: a biplot's vectors) ----------------------
  // Fits per group (roadmap 35) in their group's colour.
  // Grouped only when something reads the groups (audit 3, P4: a million rows sorted and grouped
  // in every layout).
  let shown: ReturnType<typeof overlayGroups> | undefined
  const groupsShown = () => {
    shown ??= overlayGroups(kit, data, undefined, colorOf, baseColor)
    return shown
  }
  const groupColor = (name: string) => groupsShown().find((g) => g.name === name)?.color
  const outputs = outputLayersOf(kit)
  const curves = outputCurves(kit, 0, new Map(), groupColor)
  const yAxis: XYAxis = { ...Y, ok: axes.ok }
  const curveCtx: XYCurveCtx = {
    kit,
    x: X.scale,
    left: yAxis,
    right: yAxis,
    W,
    H,
    inside: (px, py) => px >= -0.5 && px <= W + 0.5 && py >= -0.5 && py <= H + 0.5,
    pointLabels,
  }
  for (const c of curves) {
    for (const l of outputs.bands) if (kit.shows(l, c.id)) xyCurveBand(curveCtx, c, l)
    for (const l of outputs.lines) if (kit.shows(l, c.id)) xyCurve(curveCtx, c, l)
    for (const l of outputs.points) if (kit.shows(l, c.id)) xyCurvePoints(curveCtx, c, l)
  }

  // --- Labels, lines and bands of analyses' results (roadmap 35), per group ------------------
  const results = resultLayers(kit).length ? resultSeriesOfGroups(groupsShown(), yKey) : []
  drawResults({
    kit,
    U: W,
    V: H,
    W,
    H,
    u: X.scale,
    v: Y.scale,
    scales: { x: X.scale, y: Y.scale },
    point: (vx, vy) => (axes.ok(vx, vy) ? [X.scale(vx), Y.scale(vy)] : [Number.NaN, Number.NaN]),
    series: results,
    curves: curveSources(kit, curves),
  })

  // --- Lines by group: each group's rows joined in X order ------------------------------------
  const groups = groupLines(kit, data, colorOf, baseColor, W, H, (vx, vy) =>
    (X.log && vx <= 0) || (Y.log && vy <= 0)
      ? [Number.NaN, Number.NaN]
      : [X.scale(vx), Y.scale(vy)],
  )

  // --- Legend: sizes, colours and shapes by variable, then groups -----------------------------
  const looksGuides =
    looks && rows.length ? looks.guides(SWATCH) : { entries: [], sampleWidth: SWATCH }
  const entries: LegendEntry[] = [...looksGuides.entries]
  const sampleWidth = looksGuides.sampleWidth
  // Outputs drawn as lines (a biplot's vectors): a line sample each.
  for (const c of curves) {
    const line = outputs.lines.find((l) => kit.shows(l, c.id))
    if (!line) continue
    const stroke = resolveStroke(kit.style(line, c.id).line.stroke, palette, c.color)
    const id = `legend/curve/${c.index}`
    entries.push({
      key: c.id,
      id,
      target: ['extraSeries', c.index],
      label: c.data.title,
      sample: (x, cy) => [
        {
          id: `${id}/line`,
          target: ['extraSeries', c.index],
          prim: { type: 'line', x1: x, y1: cy, x2: x + sampleWidth, y2: cy, stroke },
        },
      ],
    })
  }
  const legendTarget = ['style', 'bubble']
  // Groups the colour legend doesn't name get their own line samples.
  if (groups.title && rows.length) {
    entries.push({
      key: 'group',
      id: 'legend/group',
      target: legendTarget,
      label: groups.title,
      sample: () => [],
      group: 'group',
      fixed: true,
    })
    const items = groups.legend.map(
      ({ label, color }, k): LegendEntry => ({
        // Keyed by its level (audit 3, G2), its node by its place.
        key: `group/${levelKey(label)}`,
        id: `legend/group/${k}`,
        target: legendTarget,
        label,
        group: 'group',
        sample: (x, cy) => [
          {
            id: `legend/group/${k}/line`,
            target: legendTarget,
            prim: {
              type: 'line',
              x1: x,
              y1: cy,
              x2: x + sampleWidth,
              y2: cy,
              stroke: { ...groups.stroke, color },
            },
          },
        ],
      }),
    )
    entries.push(...reversedEntries(graph.legend, items))
  }
  // Density layers' colour bars (roadmap 34g).
  entries.push(...densityGuides(ctx, palette, guides))
  // The classes of Significance layers, counted (roadmap 46b).
  entries.push(...thresholdLegend(kit, sampleWidth))
  // Lines and bands of analyses' results (roadmap 35).
  entries.push(...resultLegend(kit, results, sampleWidth))
  // Result layers' marks per group are kept under the groups' keys.
  const resultKeys = resultLayers(kit).length
    ? results.map((r) => r.key).filter((k) => k !== yKey)
    : []

  const series: SceneNode[] = kit.seriesMajor
    ? kit.seriesPlane(
        kit.inList([
          layer,
          ...classed,
          ...groups.layers,
          ...overlays.polygons,
          ...overlays.paths,
          ...overlays.segments,
          ...densityLayers.hexes,
          ...densityLayers.rasters,
          ...densityLayers.contours,
          ...centroids,
          ...outputs.bands,
          ...outputs.lines,
          ...outputs.points,
          ...resultLayers(kit),
        ]),
        [yKey, ...curves.map((c) => c.id), ...resultKeys],
      )
    : kit.layerPlane([yKey, ...curves.map((c) => c.id), ...resultKeys])
  return composeGraph({
    ctx,
    theme,
    palette,
    x: planContinuousAxis(ctx, theme, palette, 'x', xSpec, X.dom, X.scale),
    y: planContinuousAxis(ctx, theme, palette, 'y', ySpec, Y.dom, Y.scale),
    layers: [
      { id: 'series', children: series },
      { id: 'pointLabels', children: pointLabels.nodes(W, H) },
    ],
    legend: { entries, sampleWidth },
    warnings,
  })
}

/**
 * Lines by group (roadmap 33d): each line layer joins the rows of every group in X order — the
 * group variable (`aes.group`, else the colour variable when it is a text variable; without
 * either, all rows are one group) — in the group's colour: the colour legend's when the group is
 * the colour variable (that legend then names the groups), else the palette's by group, with
 * legend entries of their own (`title`, `legend`).
 */
function groupLines(
  kit: LayerKit,
  data: BubbleData,
  colorOf: (row: number) => string,
  baseColor: string,
  W: number,
  H: number,
  at: (x: number, y: number) => [number, number],
) {
  const layers = kit.drawn('line', (l) => l.stat.kind === 'identity')
  const out = {
    layers: layers as Layer[],
    title: undefined as string | undefined,
    legend: [] as { label: string; color: string }[],
    stroke: { color: baseColor, width: 1, dash: 'solid' } as Stroke,
  }
  const { table, vars, rows } = data
  const yKey = vars.y ?? ''
  if (!table) return out
  const textOf = (key: string | undefined) => table.dataSets.find((d) => d.id === key)?.text
  for (const layer of layers) {
    if (!kit.shows(layer, yKey)) continue
    const key = layer.aes?.group ?? (textOf(vars.color) ? vars.color : undefined)
    const text = textOf(key)
    const byColor = !!text && key === vars.color
    // Groups in order of first appearance among the rows drawn.
    const names: string[] = []
    const members = new Map<string, BubbleRow[]>()
    for (const r of rows) {
      const name = text ? (text[r.row]?.trim() ?? '') : ''
      if (text && !name) continue
      if (!members.has(name)) {
        members.set(name, [])
        names.push(name)
      }
      members.get(name)!.push(r)
    }
    const style = kit.style(layer, yKey)
    const part = kit.part(layer, yKey, 'line')
    names.forEach((name, g) => {
      const list = members.get(name)!
      const color = !text
        ? baseColor
        : byColor
          ? colorOf(list[0]!.row)
          : kit.palette[g % kit.palette.length]!
      const stroke = resolveStroke(style.line.stroke, kit.palette, color)
      const pts = [...list].sort((a, b) => a.x - b.x || a.row - b.row).map((r) => at(r.x, r.y))
      clipPolyline(pts, W, H).forEach((run, k) => {
        kit.add(layer, yKey, {
          id: `series/${yKey}/${part}/${g}/${k}`,
          target: ['seriesOverrides', yKey, 'line'],
          prim: { type: 'polyline', points: run, stroke },
        })
      })
      if (text && !byColor && out.title === undefined) out.legend.push({ label: name, color })
      out.stroke = stroke
    })
    if (text && !byColor && out.title === undefined) out.title = data.titles[key!] ?? 'Group'
  }
  return out
}

/** A bubble plot's extent along an axis (no text laid out). */
export const bubbleExtentOf = (kit: LayerKit, axis: 'x' | 'y', log: boolean) =>
  extentOf(kit, bubbleData(kit), axis, log)

/** The drawn layers of analysis outputs (lines, bands, points) on a graph of variables. */
const outputLayersOf = (kit: LayerKit) => {
  const of = (l: Layer) => kit.data(l).from === 'outputs'
  return {
    bands: kit.drawn('band', of),
    lines: kit.drawn('line', of),
    points: kit.drawn('points', of),
  }
}

/** The drawn layers of roadmap 34c's geoms on a graph of variables. */
const overlayLayers = (kit: LayerKit) => ({
  polygons: kit.drawn('polygon'),
  paths: kit.drawn('path'),
  segments: kit.drawn('segment'),
})

/** A number variable's values by table row (null: no such number variable). */
const numberValues = (table: DataTable, key: string | undefined) => variableValues(table, key, true)

/**
 * The points' extent with the ellipses and hulls of every group and the vectors' ends (roadmap
 * 34c).
 */
function extentOf(kit: LayerKit, data: BubbleData, axis: 'x' | 'y', log: boolean) {
  const e = bubbleExtent(data, axis, log)
  // Analysis outputs drawn over the points (a biplot's vectors).
  const outputs = outputLayersOf(kit)
  for (const c of outputCurves(kit, 0)) {
    const shown = (ls: readonly Layer[]) => ls.some((l) => kit.shows(l, c.id))
    if (!shown([...outputs.lines, ...outputs.points, ...outputs.bands])) continue
    e.addAll(axis === 'x' ? c.data.x : c.data.y)
    if (axis === 'y' && shown(outputs.bands)) {
      e.addAll(c.data.lo ?? [])
      e.addAll(c.data.hi ?? [])
    }
  }
  const yKey = data.vars.y ?? ''
  // Lines and bands at an analysis' values (roadmap 35).
  if (resultLayers(kit).length)
    resultExtent(
      kit,
      axis,
      resultSeriesOfGroups(
        overlayGroups(kit, data, undefined, () => '', ''),
        yKey,
      ),
      (v) => e.add(v),
    )
  const { polygons, segments } = overlayLayers(kit)
  if (polygons.length)
    overlayExtent(
      kit,
      polygons,
      overlayGroups(kit, data, undefined, () => '', ''),
      axis,
      e,
    )
  for (const l of segments) {
    if (!kit.shows(l, yKey) || !data.table) continue
    const ends = numberValues(data.table, axis === 'x' ? l.aes?.xend : l.aes?.yend)
    if (!ends || !numberValues(data.table, axis === 'x' ? l.aes?.yend : l.aes?.xend)) continue
    for (const r of data.rows) e.add(ends[r.row]!)
  }
  return e
}

/**
 * The groups of a graph of variables' overlays (roadmap 34c), each its rows in table order: the
 * levels of `by` (a path's own group variable), else of the colour variable when it is a text
 * variable, else of the shape variable; without one, every row is one group. A group by the
 * colour variable takes the colour legend's colour; otherwise the points' colour. The rows are
 * grouped once per layout and grouping variable (audit 2, G7: they were sorted and grouped for
 * every layer and both extents).
 */
/**
 * Roadmap 49d: the fill colours of a graph of variables' groups — a row's (its fill variable's
 * level's, or its colour level's fill colour) and the points' as a whole (absent: their colour).
 */
interface GroupFills {
  of: (row: number) => string
  base: string | undefined
}

function overlayGroups(
  kit: LayerKit,
  data: BubbleData,
  by: string | undefined,
  colorOf: (row: number) => string,
  baseColor: string,
  fills?: GroupFills,
): (OverlayGroup & { name: string; by: string | undefined })[] {
  const { table, vars } = data
  const yKey = vars.y ?? ''
  if (!table) return []
  const { key, text, byColor, groups, order } = groupsOf(kit, data, by)
  // Roadmap 49d: a group's fill is its level's fill colour when the groups are the fill
  // variable's levels, or the colour variable's with no fill variable; the points' as a whole
  // when they are one group; else its colour.
  const fillVar = kit.all('points', (l) => !!l.aes)[0]?.aes?.fill
  const byFill = !!text && (key === fillVar || (byColor && fillVar === undefined))
  const fillOf = (first: number): string | undefined =>
    !fills ? undefined : byFill ? fills.of(first) : text ? undefined : fills.base
  return groups.map(({ name, first, xs, ys, rows }, g) => {
    const fill = fillOf(first)
    return {
      key: yKey,
      id: (part: string) => `series/${yKey}/${part}/${g}`,
      target: ['seriesOverrides', yKey],
      color: byColor ? colorOf(first) : baseColor,
      ...(fill ? { fill } : {}),
      // Roadmap 49d: its level's place in its variable's order (a line pattern by group).
      index: text ? Math.max(0, order.indexOf(name)) : 0,
      label: text ? `“${name}”` : 'the points',
      // Every row one group: named after the points' Y variable (as its legend entry would be).
      name: text ? name : (data.titles[yKey] ?? ''),
      by: key,
      xs,
      ys,
      rows,
    }
  })
}

/** The rows grouped by a variable (`overlayGroups`), once per layout and variable. */
function groupsOf(kit: LayerKit, data: BubbleData, by: string | undefined) {
  return kit.memo(`bubble/groups/${by ?? ''}`, () => {
    const { table, rows } = data
    const textOf = (key: string | undefined) => table?.dataSets.find((d) => d.id === key)?.text
    const aes = kit.all('points', (l) => !!l.aes)[0]?.aes ?? {}
    const key = [by, aes.color, aes.shape].find((k) => !!textOf(k))
    const text = textOf(key)
    const byColor = !!text && key === aes.color
    const names: string[] = []
    const members = new Map<string, BubbleRow[]>()
    for (const r of [...rows].sort((a, b) => a.row - b.row)) {
      const name = text ? (text[r.row]?.trim() ?? '') : ''
      if (text && !name) continue
      if (!members.has(name)) {
        members.set(name, [])
        names.push(name)
      }
      members.get(name)!.push(r)
    }
    const groups = names.map((name) => {
      const list = members.get(name)!
      return {
        name,
        first: list[0]!.row,
        xs: list.map((r) => r.x),
        ys: list.map((r) => r.y),
        rows: list.map((r) => r.row),
      }
    })
    // Roadmap 49d: the levels in the graph's order (each group's place, as its colour's).
    const order =
      text && table
        ? (mappedVariable(table, kit.graph, key, graphRows(kit.graph, table))?.order ?? [])
        : []
    return { key, text, byColor, groups, order }
  })
}

/** Roadmap 49d: a row's group's place (its level's in the grouping variable's order; else 0). */
function groupIndex(kit: LayerKit, data: BubbleData, row: number): number {
  const { text, order } = groupsOf(kit, data, undefined)
  const t = text?.[row]?.trim()
  return t ? Math.max(0, order.indexOf(t)) : 0
}

/**
 * The groups as result layers see them (roadmap 35): each level of the colour variable by its
 * level key and name (a fit per level's column), else the points' Y variable.
 */
function resultSeriesOfGroups(
  groups: readonly (OverlayGroup & { name: string })[],
  yKey: string,
): ResultSeries[] {
  return groups.map((g) => ({
    key: g.label === 'the points' ? yKey : levelKey(g.name),
    title: g.name,
    color: g.color,
  }))
}

/** The drawn density layers of a graph of variables (roadmap 34g). */
const densityLayersOf = (kit: LayerKit) => ({
  hexes: kit.drawn('hex'),
  contours: kit.drawn('contour'),
  rasters: kit.drawn('raster'),
})

/**
 * The points drawn in the axes' transformed coordinates (roadmap 34g), one object for the same
 * points (densities of them are cached by it): null without a density layer or points coloured
 * by density.
 */
function densityPoints(kit: LayerKit, data: BubbleData, x: Scale, y: Scale): PlotPoints | null {
  const layers = densityLayersOf(kit)
  const points = kit.all('points', (l) => !!l.aes)[0]
  const wanted =
    layers.hexes.length ||
    layers.contours.length ||
    layers.rasters.length ||
    (points && ownField(points, data.vars.y ?? '', 'colorBy') === 'density')
  if (!wanted || !data.table) return null
  const { graph } = kit
  // Per table and rows shown (by identity: `graphRows`' arrays, audit 2 G8), then what else the
  // points depend on (a short key).
  const key = JSON.stringify([
    data.vars,
    transformKey(x.transform, graph.axes.x),
    transformKey(y.transform, graph.axes.y),
  ])
  const shown = graphRows(graph, data.table) ?? data.table
  const pts = cached([data.table, shown], `points|${key}`, () =>
    plotPoints(
      data.rows.map((r) => r.x),
      data.rows.map((r) => r.y),
      data.rows.map((r) => r.row),
      x.transform,
      y.transform,
    ),
  )
  return pts
}

/** What a scale's transform depends on (its kind and parameters). */
const transformKey = (t: Transform, spec: GraphNode['axes']['x']) =>
  spec.type === 'continuous'
    ? JSON.stringify([t.kind, spec.arcsinh ?? null, spec.logicle ?? null])
    : t.kind

/**
 * Roadmap 34g: each table row's local density — the points' 2D density (`kde2d` on a 100 × 100
 * grid over the points, ggplot2's bandwidths times the layer's `adjust`) at the point, by bilinear
 * interpolation (NaN for rows not drawn).
 */
function rowDensities(
  layer: Layer,
  key: string,
  data: BubbleData,
  p: PlotPoints,
): Float64Array | null {
  const table = data.table
  if (!table) return null
  const adjust = (ownField(layer, key, 'adjust') as number | undefined) ?? 1
  return cached([table, p], `local|${adjust}`, () => {
    const out = new Float64Array(table.rowCount).fill(Number.NaN)
    const grid = densityGrid(p.tx, p.ty, p.lims, { adjust })
    if (!grid) return out
    const at = pointDensities(grid, p.tx, p.ty)
    for (let i = 0; i < p.rows.length; i++) out[p.rows[i]!] = at[i]!
    return out
  })
}

/**
 * The groups a contour layer draws the density of: the levels of the text colour variable (else
 * the shape variable), each in its colour, else every point (roadmap 34c's groups, as indices into
 * the plot points).
 */
function densityGroups(
  kit: LayerKit,
  data: BubbleData,
  p: PlotPoints,
  colorOf: (row: number) => string,
  baseColor: string,
): DensityGroup[] {
  const table = data.table
  if (!table) return []
  const index = new Int32Array(table.rowCount).fill(-1)
  p.rows.forEach((r, i) => {
    index[r] = i
  })
  return overlayGroups(kit, data, undefined, colorOf, baseColor).flatMap((g, k) => {
    const members = Int32Array.from(g.rows.map((r) => index[r]!).filter((i) => i >= 0))
    if (members.length < 2) return []
    return [
      {
        key: g.key,
        id: g.id,
        target: g.target,
        color: g.color,
        ...(g.index ? { index: g.index } : {}),
        members: members.length === p.rows.length ? null : members,
        // The grouping variable too: groups of another variable may share level names.
        name: `${k}\u0000${g.by ?? ''}\u0000${g.name}`,
      },
    ]
  })
}
