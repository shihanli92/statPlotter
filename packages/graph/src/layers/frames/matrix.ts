import type { GraphNode, LayerOf, RichText } from '@ps/model'
import { zScores } from '@ps/stats'
import { rowTitleOf, seriesTitle, tableRow } from '../../data.ts'
import { axisDepth, planCategoricalAxis, unionBoxes } from '../../layout/common.ts'
import { composeGraph } from '../../layout/compose.ts'
import type { Scene, SceneNode } from '../../scene.ts'
import { graphText, resolveStroke } from '../../theme.ts'
import {
  BAR_GAP,
  boundsOf,
  colorBar,
  DENDROGRAM,
  dendrogramLines,
  GAP,
  type HeatOptions,
  heatScale,
  LINE,
  tileMarks,
} from '../geoms/tile.ts'
import type { LayerKit } from '../kit.ts'
import { clusterOrder, heatmapData } from '../stats/cell.ts'

// The matrix frame (heat maps): data sets along the bottom, rows down the left, one tile per
// value. The tile layer owns the axis order (clustering) and the colour scale; a label layer on
// it prints the values. Planes: series (tiles), cellLabels, dendrograms, colorScale.

/** The heat-map options of a tile layer, its value labels and the graph's colour scale. */
function heatmapOf(
  graph: GraphNode,
  tile: LayerOf<'tile'> | undefined,
  values: LayerOf<'label'> | undefined,
  shown: boolean,
): HeatOptions {
  const c = graph.scales?.color ?? {}
  const t = tile?.style ?? {}
  const cluster = t.cluster ?? {}
  const v = values?.style ?? {}
  return {
    colors: c.colors,
    reverse: c.reverse,
    min: c.min,
    max: c.max,
    midpoint: c.midpoint,
    missing: t.missing,
    standardize: tile?.stat.kind === 'cell' ? tile.stat.standardize : undefined,
    clusterRows: cluster.rows,
    clusterColumns: cluster.columns,
    distance: cluster.distance,
    linkage: cluster.linkage,
    dendrogram: cluster.dendrogram,
    labels: { show: shown, format: v.format, text: v.text },
    colorBar: c.bar,
    border: t.border,
  }
}

/** Drawing by layer: the cells and their values in the list's order. */
function layerMarks(
  kit: LayerKit,
  tile: LayerOf<'tile'>,
  values: LayerOf<'label'> | undefined,
  cells: SceneNode[],
  texts: SceneNode[],
): SceneNode[] {
  // As lists: a heat map of every value may have a million cells (too many arguments).
  kit.addWholeList(tile, cells)
  if (values && values.visible !== false) kit.addWholeList(values, texts)
  return kit.layerPlane([])
}

/** Lays out a heat map. */
export function layoutMatrix(kit: LayerKit): Scene {
  const { ctx, graph, theme, palette, warnings } = kit
  const { project, fonts } = ctx
  const tile = kit.drawn('tile')[0]
  const valuesLayer = kit.all('label', (l) => l.on === tile?.id)[0]
  const h = heatmapOf(graph, tile, valuesLayer, !!valuesLayer && valuesLayer.visible !== false)
  const data = heatmapData(project, graph, ctx.result)
  const { series, rows } = data
  if (!rows.length) warnings.push('A heat map needs values: the data sets shown have none.')

  // Values drawn: as entered, or z-scores by row or column.
  const by = h.standardize ?? 'none'
  const values = by === 'none' ? data.values : zScores(data.values, by)
  const nr = rows.length
  const nc = series.length
  const columns = Array.from({ length: nc }, (_, j) => values.map((v) => v[j]!))
  const rowTree = h.clusterRows ? clusterOrder(values, h, 'rows', warnings) : null
  const colTree = h.clusterColumns ? clusterOrder(columns, h, 'columns', warnings) : null
  const order = rowTree?.order ?? rows.map((_, i) => i)
  // On screen, at most the screen's cap of the rows, evenly spread in their order (decision 450);
  // values, z-scores and clusters are of every row.
  const rowOrder = kit.screenSample(order, 'row')
  const colOrder = colTree?.order ?? series.map((_, j) => j)

  const W = graph.size.plotWidth
  const H = graph.size.plotHeight
  const cw = W / Math.max(nc, 1)
  const ch = H / Math.max(rowOrder.length, 1)
  /** A row's height in the dendrogram's order (every row's). */
  const chTree = H / Math.max(nr, 1)
  const scale = heatScale(h, values.flat(), theme.colorMap)
  const border = h.border ? resolveStroke(h.border, palette) : null
  const target = ['style', 'heatmap']

  // --- Cells and their values ------------------------------------------------------------------
  const labels = h.labels ?? {}
  const labelStyle = graphText(theme.pointLabel, graph, labels.text)
  const { cells, texts } = tile
    ? tileMarks({
        ...{ fonts, palette, data, values, rowOrder, colOrder, cw, ch, scale, border, target },
        labels,
        labelStyle,
      })
    : { cells: [], texts: [] }

  // --- Axes: data sets along the bottom, rows down the left -------------------------------------
  const colLabels = colOrder.map((j) => seriesTitle(series[j]!))
  const rowLabels = rowOrder.map((i): string | RichText => {
    const s = series[0]!
    return rowTitleOf(s, rows[i]!) ?? `Row ${tableRow(s, rows[i]!) + 1}`
  })
  const xPlan = planCategoricalAxis(ctx, theme, palette, graph.axes.x, colLabels, W, 0)
  const yPlan = planCategoricalAxis(ctx, theme, palette, graph.axes.y, rowLabels, H, 0, {
    which: 'y',
    key: 'y',
  })

  // --- Dendrograms: the rows' right of the map, the columns' above it ---------------------------
  const depth = h.dendrogram ?? DENDROGRAM
  const trees: SceneNode[] = []
  const tree = (
    hc: NonNullable<typeof rowTree>,
    id: string,
    place: (pos: number, k: number) => [number, number],
  ) => {
    const top = hc.height.reduce((m, h) => Math.max(m, h), 0) || 1
    dendrogramLines(hc).forEach((pts, k) => {
      trees.push({
        id: `${id}/${k}`,
        target,
        prim: { type: 'polyline', points: pts.map(([p, ht]) => place(p, ht / top)), stroke: LINE },
      })
    })
  }
  if (rowTree) tree(rowTree, 'dendrogram/rows', (p, k) => [W + GAP + k * depth, (p + 0.5) * chTree])
  if (colTree) tree(colTree, 'dendrogram/columns', (p, k) => [(p + 0.5) * cw, -GAP - k * depth])

  // --- Colour scale --------------------------------------------------------------------------
  const bar = h.colorBar ?? {}
  const scaleBar = graph.scales?.color?.bar
  const scaleNodes =
    nr && bar.show !== false
      ? colorBar(ctx, palette, scale, {
          position: bar.position ?? 'right',
          title: bar.title ?? (by === 'none' ? '' : 'z-score'),
          at:
            (bar.position ?? 'right') === 'right'
              ? { x: W + (rowTree ? GAP + depth : 0) + BAR_GAP, y: 0 }
              : { x: 0, y: H + axisDepth(xPlan) + BAR_GAP },
          W,
          H,
          target,
          ...(scaleBar?.ticks ? { ticks: scaleBar.ticks } : {}),
          ...(scaleBar?.format ? { format: scaleBar.format } : {}),
          // Counts (text × text graphs of variables) tick at whole numbers.
          integer: by === 'none' && series.length > 0 && series.every((s) => s.counts),
        })
      : []

  const aside = [...trees, ...scaleNodes]
  // The cells and values are their layers' marks, however drawn.
  if (tile) for (const n of cells) n.layer = tile.id
  if (valuesLayer) for (const n of texts) n.layer = valuesLayer.id
  // Drawing by data set too, values moved behind their tiles go there.
  const at = (l: typeof valuesLayer) => (l ? graph.layers.indexOf(l) : -1)
  const valuesBehind = !!tile && !!valuesLayer && at(valuesLayer) < graph.layers.indexOf(tile)
  // No axis lines unless a frame is chosen.
  const bare = { ...graph, style: { ...graph.style, frame: graph.style.frame ?? 'none' } }
  return composeGraph({
    ctx: { ...ctx, graph: bare },
    theme,
    palette,
    x: xPlan,
    y: yPlan,
    // By data set (v1): the cells, then their values; by layer: the list's order.
    layers: [
      ...(kit.seriesMajor || !tile
        ? valuesBehind
          ? [
              { id: 'cellLabels', children: texts },
              { id: 'series', children: cells },
            ]
          : [
              { id: 'series', children: cells },
              { id: 'cellLabels', children: texts },
            ]
        : [{ id: 'series', children: layerMarks(kit, tile, valuesLayer, cells, texts) }]),
      { id: 'dendrograms', children: trees },
      { id: 'colorScale', target, children: scaleNodes },
    ],
    reach: unionBoxes(aside.map((n) => n.bbox ?? boundsOf(n))),
    legend: { entries: [], sampleWidth: 0 },
    warnings,
  })
}
