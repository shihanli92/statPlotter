import type { GraphNode, LayerOf } from '@ps/model'
import { type HClust, zScores } from '@ps/stats'
import { seriesTitle } from '../../data.ts'
import { axisDepth, planCategoricalAxis, unionBoxes } from '../../layout/common.ts'
import { composeGraph } from '../../layout/compose.ts'
import { SWATCH } from '../../layout/legend.ts'
import { nodeBounds, type Scene, type SceneNode } from '../../scene.ts'
import { graphText, resolveStroke } from '../../theme.ts'
import {
  type ResolvedTree,
  STRIP_GAP,
  stripBand,
  stripNodes,
  type TreeClusters,
  treeClusters,
  treeLegend,
  treeNodes,
  treeStyle,
} from '../geoms/dendrogram.ts'
import {
  BAR_GAP,
  boundsOf,
  colorBar,
  type HeatOptions,
  heatScale,
  tileMarks,
} from '../geoms/tile.ts'
import type { LayerKit } from '../kit.ts'
import { clusterOrder, columnsOf, heatmapData, rowName } from '../stats/cell.ts'

// The matrix frame (heat maps): data sets along the bottom, rows down the left, one tile per
// value. The tile layer owns the axis order (its clustering) and the colour scale; a label layer
// on it prints the values; dendrogram layers (roadmap 49c) draw the trees of the clustered rows
// and columns beside the map. Planes: series (tiles), cellLabels, dendrograms, colorScale.

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
    labels: { show: shown, format: v.format, text: v.text },
    colorBar: c.bar,
    border: t.border,
  }
}

/** A tree a frame draws: its layer, look, clusters (cut) and scene nodes. */
export interface DrawnTree {
  layer: LayerOf<'dendrogram'>
  tree: ResolvedTree
  clusters: TreeClusters | null
  nodes: SceneNode[]
}

/** Drawing by layer: the cells, their values and the trees in the list's order. */
function layerMarks(
  kit: LayerKit,
  tile: LayerOf<'tile'>,
  values: LayerOf<'label'> | undefined,
  cells: SceneNode[],
  texts: SceneNode[],
  trees: readonly DrawnTree[],
): SceneNode[] {
  // As lists: a heat map of every value may have a million cells (too many arguments).
  kit.addWholeList(tile, cells)
  if (values && values.visible !== false) kit.addWholeList(values, texts)
  for (const t of trees) kit.addWholeList(t.layer, t.nodes)
  return kit.layerPlane([])
}

/**
 * Roadmap 49c: the tree ordering an axis of the matrix — the tile layer's clustering when it
 * clusters that axis (its distance and linkage), else the front-most drawn dendrogram layer's of
 * that axis (its own) — and the dendrogram layer drawing it (the first drawn of that axis).
 */
export function axisTree(
  kit: LayerKit,
  of: 'rows' | 'columns',
  items: readonly (readonly number[])[],
  tile: LayerOf<'tile'> | undefined,
): { hc: HClust | null; layer: LayerOf<'dendrogram'> | undefined } {
  const layer = kit.drawn('dendrogram', (l) => l.stat.of === of)[0]
  const cluster = tile?.style?.cluster
  const by = cluster?.[of] ? cluster : layer ? layer.stat : null
  const hc = by ? clusterOrder(items, by, of, kit.warnings) : null
  return { hc, layer }
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
  // The trees ordering the rows and columns: the tile's clustering, else a dendrogram layer's.
  const rowAxis = axisTree(kit, 'rows', values, tile)
  const colAxis = axisTree(kit, 'columns', columnsOf(values, nc), tile)
  const rowTree = rowAxis.hc
  const colTree = colAxis.hc
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

  // --- Dendrograms (roadmap 49c): the rows' right (or left) of the map, the columns' above (or
  // below) it, `gap` from the map, a cut tree's cluster strip between ---------------------------
  const trees: DrawnTree[] = []
  /** How far a tree (with its strip) reaches out from the map. */
  const reachOf = (t: DrawnTree) =>
    t.tree.gap + (t.tree.strip && t.clusters ? t.tree.stripWidth + STRIP_GAP : 0) + t.tree.depth
  const drawTree = (
    hc: HClust,
    layer: LayerOf<'dendrogram'>,
    id: string,
    place: (
      t: ResolvedTree,
      start: number,
    ) => {
      tree: (pos: number, k: number) => [number, number]
      strip: (slot: number) => { x: number; y: number; w: number; h: number }
    },
  ): DrawnTree => {
    const tree = treeStyle(layer, theme)
    const clusters = treeClusters(hc, layer.stat.cut, warnings)
    const at = place(tree, tree.gap + (tree.strip && clusters ? tree.stripWidth + STRIP_GAP : 0))
    const t = { target: ['layers', layer.id], palette, hc, tree, clusters, id }
    const nodes = [...stripNodes({ ...t, rect: at.strip }), ...treeNodes({ ...t, place: at.tree })]
    const drawn = { layer, tree, clusters, nodes }
    trees.push(drawn)
    return drawn
  }
  const rowLeft = rowAxis.layer?.style?.side === 'left'
  const colBelow = colAxis.layer?.style?.side === 'bottom'
  const rowDrawn =
    rowTree && rowAxis.layer
      ? drawTree(rowTree, rowAxis.layer, 'dendrogram/rows', (t, start) => {
          const out = (k: number) => start + k * t.depth
          return {
            tree: (p, k) => [rowLeft ? -out(k) : W + out(k), (p + 0.5) * chTree],
            strip: (slot) => {
              const b = stripBand(slot, chTree, nr)
              const x = rowLeft ? -t.gap - t.stripWidth : W + t.gap
              return { x, y: b.from, w: t.stripWidth, h: b.len }
            },
          }
        })
      : null
  const colDrawn =
    colTree && colAxis.layer
      ? drawTree(colTree, colAxis.layer, 'dendrogram/columns', (t, start) => {
          const out = (k: number) => start + k * t.depth
          return {
            tree: (p, k) => [(p + 0.5) * cw, colBelow ? H + out(k) : -out(k)],
            strip: (slot) => {
              const b = stripBand(slot, cw, nc)
              const y = colBelow ? H + t.gap : -t.gap - t.stripWidth
              return { x: b.from, y, w: b.len, h: t.stripWidth }
            },
          }
        })
      : null
  // The trees in the list's order (drawing by data set too: their plane's).
  trees.sort((a, b) => graph.layers.indexOf(a.layer) - graph.layers.indexOf(b.layer))
  const rowReach = rowDrawn ? reachOf(rowDrawn) : 0
  const colReach = colDrawn ? reachOf(colDrawn) : 0

  // --- Axes: data sets along the bottom, rows down the left (beyond a tree standing there) ------
  const colLabels = colOrder.map((j) => seriesTitle(series[j]!))
  const rowLabels = rowOrder.map((i) => rowName(data, i))
  const xOffset = colDrawn && colBelow ? colReach : 0
  const xPlan = planCategoricalAxis(ctx, theme, palette, graph.axes.x, colLabels, W, xOffset)
  const yOffset = rowDrawn && rowLeft ? rowReach : 0
  const yPlan = planCategoricalAxis(ctx, theme, palette, graph.axes.y, rowLabels, H, yOffset, {
    which: 'y',
    key: 'y',
  })

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
              ? { x: W + (rowDrawn && !rowLeft ? rowReach : 0) + BAR_GAP, y: 0 }
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

  const treeMarks = trees.flatMap((t) => t.nodes)
  const reach = unionBoxes([
    ...treeMarks.map(nodeBounds),
    ...scaleNodes.map((n) => n.bbox ?? boundsOf(n)),
  ])
  // Roadmap 49c: a cut tree's clusters in the legend (when shown), beyond the trees and scale.
  const entries = treeLegend(kit, trees)
  const aside = entries.length && reach ? Math.max(0, reach.x + reach.w - W) : undefined
  // The cells, values and trees are their layers' marks, however drawn.
  if (tile) for (const n of cells) n.layer = tile.id
  if (valuesLayer) for (const n of texts) n.layer = valuesLayer.id
  for (const t of trees) for (const n of t.nodes) n.layer = t.layer.id
  // Drawing by data set too, values moved behind their tiles go there.
  const at = (l: typeof valuesLayer) => (l ? graph.layers.indexOf(l) : -1)
  const valuesBehind = !!tile && !!valuesLayer && at(valuesLayer) < graph.layers.indexOf(tile)
  const byLayer = !!tile && !kit.seriesMajor
  // No axis lines unless a frame is chosen.
  const bare = { ...graph, style: { ...graph.style, frame: graph.style.frame ?? 'none' } }
  return composeGraph({
    ctx: { ...ctx, graph: bare },
    theme,
    palette,
    x: xPlan,
    y: yPlan,
    // By data set (v1): the cells, their values, then the trees; by layer: the list's order.
    layers: [
      ...(byLayer
        ? [{ id: 'series', children: layerMarks(kit, tile, valuesLayer, cells, texts, trees) }]
        : valuesBehind
          ? [
              { id: 'cellLabels', children: texts },
              { id: 'series', children: cells },
            ]
          : [
              { id: 'series', children: cells },
              { id: 'cellLabels', children: texts },
            ]),
      { id: 'dendrograms', children: byLayer ? [] : treeMarks },
      { id: 'colorScale', target, children: scaleNodes },
    ],
    reach,
    ...(aside !== undefined ? { aside } : {}),
    legend: { entries, sampleWidth: entries.length ? SWATCH : 0 },
    warnings,
  })
}
