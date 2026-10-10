import {
  alignedGrid,
  equalizePlotSizes,
  type FontRegistry,
  layoutGraph,
  levelCount,
  MANY_LEVELS,
  type SplitOptions,
  splitGraphs,
} from '@ps/graph'
import type { DataTable, GraphNode, LayoutNode, Project, ResultLookup, SplitSpec } from '@ps/model'
import { graphItems, newPageOf, type PageSize, withGraphs } from '../layout/figure.ts'

// Splitting a graph into a set (roadmap 34d): one graph per level of a text variable, per data
// set or per row, on a new page in a grid (decision 381), from the graph builder, a graph's menu
// or Format graph.

/** The columns a set's grid starts with: 1, 2 up to four graphs, 3 up to nine, then 4. */
export const autoColumns = (n: number): number => (n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4)

/** What a set is one graph per, in words: "level of Sex", "data set", "row". */
export function splitWhat(
  split: Pick<SplitSpec, 'by' | 'variable'>,
  table: Pick<DataTable, 'dataSets'> | undefined,
): string {
  if (split.by === 'dataSet') return 'data set'
  if (split.by === 'row') return 'row'
  const v = table?.dataSets.find((d) => d.id === split.variable)
  return `level of ${v?.title ? `“${v.title}”` : 'a variable'}`
}

/**
 * The text variable a graph is split by at first: one it doesn't show (on its axes, mapped to
 * colour or shape, or giving paths), else one mapped to colour or shape, else the first.
 */
export function defaultSplitVariable(
  graph: Pick<GraphNode, 'mapping' | 'layers'>,
  vars: readonly { id: string }[],
): string {
  const m = graph.mapping
  const aes = graph.layers.find((l) => l.aes)?.aes
  const used = new Set<string | undefined>([
    m?.x,
    m?.y,
    m?.color,
    m?.shape,
    aes?.x,
    aes?.y,
    aes?.color,
    aes?.shape,
    aes?.group,
  ])
  const free = vars.find((v) => !used.has(v.id))
  const mapped = [m?.color, m?.shape, aes?.color, aes?.shape].find((k) =>
    vars.some((v) => v.id === k),
  )
  return free?.id ?? mapped ?? vars[0]?.id ?? ''
}

/**
 * The text variables a graph of a table can be split by: those of at most `MANY_LEVELS` levels
 * (roadmap 34e: a graph per cell id would be thousands of graphs).
 */
export const textVariables = (table: DataTable) =>
  table.dataSets.filter((d) => d.text && levelCount(d) <= MANY_LEVELS)

/**
 * The ways a graph of `table` splits: by a text variable's levels (multiple-variables tables
 * with one), per data set (unless the graph draws variables), per row (grouped and
 * contingency tables).
 */
export function splitKinds(
  table: DataTable,
  graph: Pick<GraphNode, 'mapping' | 'frame' | 'layers'>,
) {
  // A graph of variables (on its axes, or its points' variables) has no data sets to split.
  const mapped = (!!graph.mapping && graph.frame !== 'xy') || graph.layers.some((l) => l.aes)
  return {
    level: textVariables(table).length > 0,
    dataSet: !mapped && table.dataSets.filter((d) => !d.text).length > 1,
    row: table.tableKind === 'grouped' || table.tableKind === 'contingency',
  }
}

/**
 * A set of `base` split as asked, with plot areas of one size, and a new page (the size chosen in
 * Preferences, unless `pageSize` is given) placing them
 * on a grid in the set's order (`LayoutNode.grids`); null when the table has nothing to split by.
 */
export function splitSet(
  project: Project,
  fonts: FontRegistry,
  table: DataTable,
  base: GraphNode,
  opts: SplitOptions & { columns?: number; pageSize?: PageSize },
  result?: ResultLookup,
): { graphs: GraphNode[]; layout: LayoutNode } | null {
  const graphs = equalizePlotSizes(splitGraphs(table, base, opts))
  if (!graphs.length) return null
  // Laid out together so linked axes see every graph of the set.
  const all = withGraphs(project, graphs)
  const scenes = graphs.map((g) => ({
    scene: layoutGraph({ project: all, graph: g, fonts, result }),
  }))
  const columns = Math.min(graphs.length, opts.columns ?? autoColumns(graphs.length))
  const what = splitWhat(graphs[0]!.split!, table)
  let grid!: ReturnType<typeof alignedGrid>
  const layout = newPageOf(
    `${base.name} (one per ${what.replace(/[“”]/g, '')})`,
    (page) => {
      grid = alignedGrid(scenes, page, { columns, equalPlotSize: true })
      return graphItems(graphs, grid.placements)
    },
    { size: opts.pageSize },
  )
  layout.grids = [
    {
      set: graphs[0]!.split!.set,
      columns: grid.columns,
      x: grid.x,
      y: grid.y,
      dx: grid.dx,
      dy: grid.dy,
    },
  ]
  return { graphs, layout }
}
