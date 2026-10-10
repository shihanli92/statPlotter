import {
  type Annotation,
  type DataTable,
  type GraphNode,
  type Layer,
  levelKey,
  memberOf,
  newAnnotationId,
  newNodeId,
  pinLevelColour,
  type RichText,
  richPlain,
  type SeriesIdentity,
  type SplitBy,
  type SplitSpec,
  storedLevels,
  tableSlices,
  titleRuns,
} from '@ps/model'
import { graphRows } from './data.ts'
import { levelVariables } from './mapped.ts'

export interface SliceOptions {
  /** Share the Y axis' automatic range across the slices (default true). */
  linkY?: boolean
  /** Share the X axis' automatic range (continuous X axes only; default false). */
  linkX?: boolean
}

type Bracket = Extract<Annotation, { type: 'bracket' }>

/** Layers with per-data-set entries only for `keep`, and outputs only those `output` keeps. */
function sliceLayers(
  layers: readonly Layer[],
  keep: (key: string) => boolean,
  output: (colorOf: string | undefined) => boolean,
): Layer[] {
  return layers.map((l) => {
    let out = l
    if (l.data?.from === 'outputs')
      out = { ...out, data: { ...l.data, series: l.data.series.filter((e) => output(e.colorOf)) } }
    if (!l.series) return out
    const series = Object.fromEntries(Object.entries(l.series).filter(([k]) => keep(k)))
    const { series: _, ...rest } = out
    return (Object.keys(series).length ? { ...rest, series } : rest) as Layer
  })
}

/**
 * Small multiples: one new graph per row (grouped and contingency tables: each shows that row
 * across the base graph's data sets) or per data set (any table: each shows that data set only,
 * across the base graph's rows). Each is a copy of `base` (frame, layers, look, size, axes,
 * legend) with a new id, named "<table> – <slice>" and titled with the slice's title; its
 * `include` and `rows` are the base's intersected with the slice. The copies share a fresh link
 * group on Y (and on X when asked and X is continuous), so they keep one scale as data change.
 *
 * Slices with no values (every cell empty) are skipped. Brackets that don't fit the slice (their
 * data sets or rows aren't shown) are dropped; the others, and text/line annotations, are copied
 * with new ids. Slicing by data set keeps that data set's formats (and its analysis curves, and
 * curves of no data set) and pins its colour to the base graph's (unless it has one), so data
 * sets keep their colours across the multiples. Returns [] when `by` doesn't apply to the table
 * (rows of column, XY or survival tables).
 */
export function sliceGraphs(
  table: DataTable,
  by: 'row' | 'dataSet',
  base: GraphNode,
  opts: SliceOptions = {},
): GraphNode[] {
  const include = base.seriesSource.include
  const keys = (include === 'all' ? table.dataSets.map((d) => d.id as string) : include).filter(
    (k) => table.dataSets.some((d) => d.id === k),
  )
  const baseRows = graphRows(base, table) ?? [...Array(table.rowCount).keys()]
  const hasValue = (key: string, rows: readonly number[]) => {
    const ds = table.dataSets.find((d) => d.id === key)
    return !!ds?.subcolumns.some((c) => rows.some((r) => c.values[r] != null))
  }

  const links: GraphNode['links'] = {}
  if (opts.linkY !== false) links.y = newNodeId()
  if (opts.linkX && base.axes.x.type === 'continuous') links.x = newNodeId()

  const copy = (
    title: RichText,
    seriesSource: GraphNode['seriesSource'],
    keep: (b: Bracket) => boolean,
    changes: Pick<GraphNode, 'seriesOverrides' | 'layers'>,
  ): GraphNode => ({
    ...base,
    ...changes,
    id: newNodeId(),
    name: `${table.name} – ${richPlain(title)}`,
    seriesSource,
    annotations: base.annotations
      .filter((a) => a.type !== 'bracket' || keep(a))
      .map((a) => ({ ...a, id: newAnnotationId() })),
    title: {
      ...(base.title?.style ? { style: base.title.style } : {}),
      content: title,
    },
    links: { ...links },
  })

  if (by === 'row') {
    if (table.tableKind !== 'grouped' && table.tableKind !== 'contingency') return []
    return baseRows
      .filter((r) => keys.some((k) => hasValue(k, [r])))
      .map((r) =>
        copy(
          table.rowTitles?.[r]
            ? titleRuns(table.rowTitles[r], table.rowTitlesRich?.[r])
            : [{ text: `Row ${r + 1}` }],
          { table: table.id, include: base.seriesSource.include, rows: [r] },
          (b) => (b.rowA === undefined || b.rowA === r) && (b.rowB === undefined || b.rowB === r),
          { seriesOverrides: base.seriesOverrides, layers: base.layers },
        ),
      )
  }

  const graphColor = base.style.seriesDefaults?.color
  const outputIds = (keepOutput: (colorOf: string | undefined) => boolean) =>
    new Set(
      base.layers.flatMap((l) =>
        l.data?.from === 'outputs'
          ? l.data.series.filter((e) => keepOutput(e.colorOf)).map((e) => e.id as string)
          : l.data?.from === 'functions'
            ? l.data.functions.map((f) => f.id as string)
            : [],
      ),
    )
  return keys.flatMap((key, index) => {
    if (!hasValue(key, baseRows)) return []
    const ds = table.dataSets.find((d) => d.id === key)!
    // Curves fitted to this data set, and curves not tied to any data set.
    const output = (colorOf: string | undefined) => !colorOf || colorOf === key
    const others = outputIds(output)
    const own = base.seriesOverrides[key]
    // Default colours follow the series' position, which is 0 in every copy: pin the base's.
    const byPosition = !own?.color && (!graphColor || 'series' in graphColor)
    const pinned: SeriesIdentity | undefined = byPosition
      ? { ...own, color: { palette: index } }
      : own
    const seriesOverrides: Record<string, SeriesIdentity> = {
      ...(pinned ? { [key]: pinned } : {}),
      ...Object.fromEntries(Object.entries(base.seriesOverrides).filter(([k]) => others.has(k))),
    }
    const layers = sliceLayers(base.layers, (k) => k === key || others.has(k), output)
    const g = copy(
      titleRuns(ds.title, ds.titleRich),
      {
        table: table.id,
        include: [key],
        ...(base.seriesSource.rows ? { rows: base.seriesSource.rows } : {}),
      },
      (b) => b.a === key && b.b === key,
      { seriesOverrides, layers: layers.map((l) => binnedVariable(l, key)) },
    )
    return [histogramOf(table, base, g, key)]
  })
}

/**
 * Roadmap 34g: a histogram of a variable (`aes.x` of a binning bar layer) sliced by data set is
 * one histogram per variable — each copy bins its own.
 */
const binnedVariable = (l: Layer, key: string): Layer =>
  l.geom === 'bar' && l.stat.kind === 'bin' && l.aes?.x ? { ...l, aes: { ...l.aes, x: key } } : l

/** A copy binning another variable (roadmap 34g) titles its X axis after it, as the base did. */
function histogramOf(table: DataTable, base: GraphNode, g: GraphNode, key: string): GraphNode {
  const from = base.layers.find((l) => l.geom === 'bar' && l.stat.kind === 'bin' && l.aes?.x)
  const was = table.dataSets.find((d) => d.id === from?.aes?.x)
  const now = table.dataSets.find((d) => d.id === key)
  const title = base.axes.x.title
  if (!from || !was || !now || !title || richPlain(title.content) !== (was.title || was.id))
    return g
  return {
    ...g,
    axes: {
      ...g.axes,
      x: { ...g.axes.x, title: { ...title, content: titleRuns(now.title, now.titleRich) } },
    },
  }
}

/** How to split a graph into a set (roadmap 34d). */
export interface SplitOptions {
  by: SplitBy
  /** By level: the text variable. */
  variable?: string
  /** Share the X / Y axis' automatic range across the set (continuous axes; default true). */
  linkX?: boolean
  linkY?: boolean
}

/**
 * A set of split graphs (roadmap 34d, decisions 380–381): one ordinary graph per level of a text
 * variable (each the base filtered to that level's rows, `seriesSource.filter`), per data set or
 * per row (`sliceGraphs`), in the set's order (the base's order of levels; data sets and rows as
 * in the table), each titled with its slice, sharing a new set id (`split`) and link groups on
 * their continuous axes, the legend shown on the last only. Empty when the table has no such
 * slices (a level split of a variable that isn't text, rows of a table without row groups).
 */
export function splitGraphs(table: DataTable, base: GraphNode, opts: SplitOptions): GraphNode[] {
  const set = newNodeId()
  const split: SplitSpec =
    opts.by === 'level' ? { set, by: 'level', variable: opts.variable } : { set, by: opts.by }
  const linkX = opts.linkX !== false && base.axes.x.type === 'continuous'
  const linkY = opts.linkY !== false && base.axes.y.type === 'continuous'
  const { split: _, ...plain } = base
  let graphs: GraphNode[]
  if (opts.by === 'level') {
    // Every graph of the set lists the levels it draws (categories, groups, colours, shapes) in
    // the whole table's order, so categories and colours match across the set (decision 384).
    const levels = { ...plain.levels }
    const vars = levelVariables(table, plain, graphRows(plain, table))
    for (const v of vars)
      if (v.id !== opts.variable) levels[v.id] = storedLevels(v.levels, plain.levels?.[v.id])
    // Roadmap 41: split by the variable that colours the graph (its categories, groups or
    // colours), each level keeps the colour it has in the unsplit graph.
    const colours = vars.find(
      (v) =>
        v.id === opts.variable &&
        (v.role === 'colours' ||
          v.role === 'groups' ||
          (v.role === 'categories' && plain.frame !== 'grouped')),
    )
    let seriesOverrides = plain.seriesOverrides
    colours?.levels.forEach((t, k) => {
      seriesOverrides = pinLevelColour(seriesOverrides, levelKey(t), k)
    })
    const template: GraphNode = {
      ...plain,
      ...(Object.keys(levels).length ? { levels } : {}),
      seriesOverrides,
      split,
    }
    const links: GraphNode['links'] = {
      ...(linkX ? { x: newNodeId() } : {}),
      ...(linkY ? { y: newNodeId() } : {}),
    }
    graphs = tableSlices(table, split, template).map((s) => {
      const { links: _, ...rest } = memberOf(template, s, table, base.legend.show)
      return Object.keys(links).length ? { ...rest, links: { ...links } } : rest
    })
  } else {
    graphs = sliceGraphs(table, opts.by, plain, { linkX, linkY }).map((g) => {
      const { links, ...rest } = g
      const own = { ...links }
      if (!own.y) delete own.y
      if (!own.x) delete own.x
      return { ...rest, ...(Object.keys(own).length ? { links: own } : {}), split }
    })
  }
  return graphs.map((g, i) =>
    i < graphs.length - 1 && g.legend.show ? { ...g, legend: { ...g.legend, show: false } } : g,
  )
}
