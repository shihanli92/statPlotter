import type { Layer } from '@ps/model'
import { seriesTitle } from '../../data.ts'
import {
  type AxisPlan,
  asContinuous,
  Extent,
  planCategoricalAxis,
  planContinuousAxis,
  valueAxis,
} from '../../layout/common.ts'
import { composeGraph } from '../../layout/compose.ts'
import { SWATCH } from '../../layout/legend.ts'
import type { Scene } from '../../scene.ts'
import {
  STRIP_GAP,
  stripBand,
  stripNodes,
  treeClusters,
  treeHeights,
  treeLegend,
  treeNodes,
  treeStyle,
} from '../geoms/dendrogram.ts'
import type { LayerKit } from '../kit.ts'
import { clusterOrder, columnsOf, heatmapData, rowName } from '../stats/cell.ts'

// A dendrogram alone (roadmap 49c): the matrix frame without tiles, its tree filling the plot —
// over its leaves along the bottom (`side` 'top' or 'bottom'), or beside its leaves down the left
// ('right' or 'left') — the leaves named by the rows' titles or the data sets' (variables') names,
// the merge heights along the other axis (none drawn for equal steps). The tree is the dendrogram
// layer's own clustering (its distance and linkage).

/** Whether a matrix graph is a dendrogram alone: a tree drawn and no tiles. */
export const isTreeAlone = (layers: readonly Layer[]): boolean =>
  !layers.some((l) => l.geom === 'tile' && l.visible !== false) &&
  layers.some((l) => l.geom === 'dendrogram' && l.visible !== false)

/** An axis drawn without anything (equal steps have no heights to read). */
const hidden = (p: AxisPlan): AxisPlan => ({
  ...p,
  show: false,
  ticks: [],
  minor: [],
  overhang: [0, 0],
  title: null,
  labels: { ...p.labels, show: false, depth: 0 },
})

/** Lays out a dendrogram without a heat map. */
export function layoutTree(kit: LayerKit): Scene {
  const { ctx, graph, theme, palette, warnings } = kit
  const layer = kit.drawn('dendrogram')[0]!
  const data = heatmapData(ctx.project, graph, ctx.result)
  if (!data.rows.length) warnings.push('A dendrogram needs values: the data sets shown have none.')
  const of = layer.stat.of
  const items = of === 'rows' ? data.values : columnsOf(data.values, data.series.length)
  const names =
    of === 'rows' ? data.rows.map((_, i) => rowName(data, i)) : data.series.map(seriesTitle)
  const hc = clusterOrder(items, layer.stat, of, warnings)
  const tree = treeStyle(layer, theme)
  const clusters = hc ? treeClusters(hc, layer.stat.cut, warnings) : null
  const order = hc?.order ?? names.map((_, i) => i)
  const n = names.length

  const W = graph.size.plotWidth
  const H = graph.size.plotHeight
  /** The leaves run down the left (the tree beside them), else along the bottom. */
  const down = tree.side === 'left' || tree.side === 'right'
  const slot = (down ? H : W) / Math.max(n, 1)
  const steps = tree.heights === 'steps'
  const heights = hc ? treeHeights(hc, tree.heights) : []
  const top = heights.reduce((m, h) => Math.max(m, h), 0) || 1

  // The heights' axis: merge heights from 0 at the leaves.
  const spec = asContinuous(down ? graph.axes.x : graph.axes.y)
  const extent = new Extent(false)
  extent.add(0)
  if (hc) extent.add(top)
  const va = valueAxis(spec, extent, true, down ? [0, W] : [H, 0], warnings)
  const plan = planContinuousAxis(ctx, theme, palette, down ? 'x' : 'y', spec, va.dom, va.scale)
  const heightPlan = steps ? hidden(plan) : plan
  /** A height's place across the leaves (0–1 of the tallest): on the axis, or equal steps. */
  const across = (h: number) => (steps ? (down ? h * W : H - h * H) : va.end(h * top))

  const target = ['layers', layer.id]
  const t = { hc: hc!, tree, clusters, palette, id: `dendrogram/${of}`, target }
  const stripped = tree.strip && !!clusters
  const nodes = hc
    ? [
        ...stripNodes({
          ...t,
          rect: (i) => {
            const b = stripBand(i, slot, n)
            return down
              ? { x: -STRIP_GAP - tree.stripWidth, y: b.from, w: tree.stripWidth, h: b.len }
              : { x: b.from, y: H + STRIP_GAP, w: b.len, h: tree.stripWidth }
          },
        }),
        ...treeNodes({
          ...t,
          place: (p, h) => (down ? [across(h), (p + 0.5) * slot] : [(p + 0.5) * slot, across(h)]),
        }),
      ]
    : []
  for (const node of nodes) node.layer = layer.id

  // The leaves' names, beyond a cluster strip.
  const offset = stripped ? 2 * STRIP_GAP + tree.stripWidth : 0
  const labels = order.map((i) => names[i]!)
  const leafPlan = down
    ? planCategoricalAxis(ctx, theme, palette, graph.axes.y, labels, H, offset, {
        which: 'y',
        key: 'y',
      })
    : planCategoricalAxis(ctx, theme, palette, graph.axes.x, labels, W, offset)

  const entries = treeLegend(kit, hc ? [{ layer, tree, clusters }] : [])
  // By data set (the heat maps' plane of trees), or by layer (the list's order).
  if (!kit.seriesMajor) kit.addWholeList(layer, nodes)
  const marks = kit.seriesMajor
    ? [{ id: 'dendrograms', children: nodes }]
    : [{ id: 'series', children: kit.layerPlane([]) }]
  // No axis lines unless a frame is chosen.
  const bare = { ...graph, style: { ...graph.style, frame: graph.style.frame ?? 'none' } }
  return composeGraph({
    ctx: { ...ctx, graph: bare },
    theme,
    palette,
    x: down ? heightPlan : leafPlan,
    y: down ? leafPlan : heightPlan,
    layers: marks,
    legend: { entries, sampleWidth: entries.length ? SWATCH : 0 },
    warnings,
  })
}
