import { type GraphNode, sourceTable } from '@ps/model'
import { graphRows } from '../data.ts'
import type { Extent, GraphContext } from '../layout/common.ts'
import { isMapped, mappedNotes } from '../mapped.ts'
import type { Scene } from '../scene.ts'
import { bubbleExtentOf, layoutBubble } from './frames/bubble.ts'
import { categoryExtentOf, layoutCategory } from './frames/category.ts'
import { isDotPlot, layoutDotPlot } from './frames/dotplot.ts'
import { groupedExtentOf, layoutGrouped } from './frames/grouped.ts'
import { layoutMatrix } from './frames/matrix.ts'
import { layoutParts } from './frames/parts.ts'
import { layoutSurvival, survivalExtentOf } from './frames/survival.ts'
import { isTreeAlone, layoutTree } from './frames/tree.ts'
import { layoutXY, xyExtentOf } from './frames/xy.ts'
import { LayerKit } from './kit.ts'

// The layer engine (roadmap 33): a graph is a frame plus layers (geom × stat × position). Each
// frame lays out its scales and slots, its layers' geoms draw per data set, and the frame
// assembles their marks into planes and composes the graph. A frame's scaffold follows from its
// layers' stats: `fraction` bars stack wholes, `km` fixes survival axes, `aes` maps variables.

/** 100% stacked bars: a category frame whose bars stack fractions of each whole. */
const fractionBars = (graph: GraphNode) =>
  graph.layers.some((l) => l.geom === 'bar' && l.stat.kind === 'fraction')
const km = (graph: GraphNode) => graph.layers.some((l) => l.stat.kind === 'km')
const mapped = (graph: GraphNode) => graph.layers.some((l) => l.geom === 'points' && !!l.aes)

/** Lays out a layered graph (unscaled; see `layoutGraph` for the scale). */
export function layoutLayers(ctx: GraphContext): Scene {
  const kit = new LayerKit(ctx)
  const { graph } = ctx
  // A graph of a table's variables (roadmap 34a): what it leaves out, and why.
  if (isMapped(graph)) {
    const table = sourceTable(ctx.project, graph.seriesSource.table, ctx.result)
    const rows = table ? graphRows(graph, table) : null
    kit.warnings.push(...mappedNotes(table, graph, rows))
  }
  // A split graph (roadmap 34d) whose variable is gone shows no rows: say why.
  const filter = graph.seriesSource.filter
  if (filter) {
    const table = sourceTable(ctx.project, graph.seriesSource.table, ctx.result)
    if (table && !table.dataSets.some((d) => d.id === filter.variable && d.text))
      kit.warnings.push(
        'The text variable this graph shows one level of is no longer in the table.',
      )
  }
  const scene = layoutFrame(kit)
  // On screen, fewer per-row points than the data has (decision 450): the view's note.
  return kit.sampled ? { ...scene, sampled: kit.sampled } : scene
}

function layoutFrame(kit: LayerKit): Scene {
  const { graph } = kit
  switch (graph.frame) {
    case 'matrix':
      // Roadmap 34g: a dot plot's layers (stat `dotplot`) summarise variables by groups.
      if (isDotPlot(graph.layers)) return layoutDotPlot(kit)
      // Roadmap 49c: a dendrogram without a heat map (its tree fills the plot).
      if (isTreeAlone(graph.layers)) return layoutTree(kit)
      return layoutMatrix(kit)
    case 'polar':
      return layoutParts(kit, false)
    case 'category':
      if (fractionBars(graph)) return layoutParts(kit, true)
      return layoutCategory(kit)
    case 'grouped':
      return layoutGrouped(kit)
    case 'xy':
      if (km(graph)) return layoutSurvival(kit)
      if (mapped(graph)) return layoutBubble(kit)
      return layoutXY(kit)
  }
}

/** A graph's data extent along an axis (no text laid out); null without a value axis. */
export function frameExtent(kit: LayerKit, axis: 'x' | 'y', log: boolean): Extent | null {
  const { graph } = kit
  if (graph.frame === 'xy') {
    if (km(graph)) return survivalExtentOf(kit, axis)
    if (mapped(graph)) return bubbleExtentOf(kit, axis, log)
    return xyExtentOf(kit, axis, log)
  }
  if (graph.frame === 'grouped' && axis === 'y') return groupedExtentOf(kit, log)
  if (graph.frame === 'category' && !fractionBars(graph) && axis === 'y')
    return categoryExtentOf(kit, log)
  return null
}
