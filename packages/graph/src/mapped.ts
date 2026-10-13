import {
  type DataSetColumn,
  type DataTable,
  type GraphNode,
  type LevelMeasure,
  levelAt,
  levelKey,
  type NormalizedDataSet,
  naturalCompare,
  normalizeDataSet,
  orderedLevels,
  plural,
  primaryValues,
  type VariableMapping,
} from '@ps/model'
import { mean } from '@ps/stats'
import { aesVariables, mappedPointsLayer, mappedVariable } from './aesthetics.ts'
import { histogramLayer } from './binned.ts'
import type { GraphSeries, PlotPoint } from './data.ts'

// Graphs of a multiple-variables table's variables straight from the table (roadmap 34a): a text
// variable's levels as the categories of a category or grouped frame, a number variable as the
// values, a second text variable (mapped to colour, or the other axis) as the groups. A data
// adapter: the frames draw these series exactly as they draw a column or grouped table's data
// sets, so every geom, stat, legend and axis works unchanged.
//
// - category frame: one series per category level (its rows' values, like a row slice);
// - grouped frame: one series per group level (or one, the value variable, without groups),
//   a cluster per category level, each cell its rows' values (`GraphSeries.cells`); text × text:
//   each cell's count (or percent);
// - matrix frame (text × text): one column per category level, a row per group level, each cell
//   its count (or percent).
//
// A series' key is its level's (`levelKey`): formats follow the level, whatever the order. Rows
// missing a level or a value are left out (`mappedNotes` says how many). Results are cached per
// table object (documents are immutable), mapping, order of levels and rows shown.

/** A variable's type: text (categorical), else a number (calculated variables included). */
export type VariableType = 'number' | 'text'

/** The types of a graph's X and Y variables: number × number, text × number… */
export type MappedAxes = 'nn' | 'tn' | 'nt' | 'tt'

export const variableType = (
  table: Pick<DataTable, 'dataSets'>,
  key: string | undefined,
): VariableType | undefined => {
  const d = key === undefined ? undefined : table.dataSets.find((x) => x.id === key)
  return d ? (d.text ? 'text' : 'number') : undefined
}

/** The axis types of a mapping's variables; undefined when one is missing from the table. */
export function mappingAxes(
  table: Pick<DataTable, 'dataSets'>,
  mapping: Pick<VariableMapping, 'x' | 'y'>,
): MappedAxes | undefined {
  const x = variableType(table, mapping.x)
  const y = variableType(table, mapping.y)
  if (!x || !y) return undefined
  return `${x[0]}${y[0]}` as MappedAxes
}

/** The roles of a mapping's variables: categories, values, groups. */
export interface MappedVariables {
  axes: MappedAxes
  /** The text variable whose levels are the categories (X, or Y when only Y is text). */
  cat: DataSetColumn
  /** The number variable (absent for text × text). */
  value?: DataSetColumn
  /** Text × number: the colour variable (when text); text × text: the Y variable. */
  group?: DataSetColumn
}

/** What each variable of a mapping does; null without a text variable on an axis. */
export function mappedVariables(
  table: Pick<DataTable, 'dataSets'>,
  mapping: VariableMapping,
): MappedVariables | null {
  const axes = mappingAxes(table, mapping)
  if (!axes || axes === 'nn') return null
  const find = (k: string) => table.dataSets.find((d) => d.id === k)!
  const [x, y] = [find(mapping.x), find(mapping.y)]
  if (axes === 'tt') return { axes, cat: x, group: y }
  const [cat, value] = axes === 'tn' ? [x, y] : [y, x]
  const color = mapping.color === undefined ? undefined : find(mapping.color)
  const group = color?.text && color.id !== cat.id ? color : undefined
  return { axes, cat, value, ...(group ? { group } : {}) }
}

/** A mapped graph's rows, by category and group level. */
export interface MappedData {
  vars: MappedVariables
  /** Category levels, in the graph's order. */
  cats: string[]
  /** Group levels in the graph's order (none without groups). */
  groups: string[]
  /** Table rows of each category level and group level (`[cat][group]`; group 0 without). */
  cells: number[][][]
  /** The number variable's value of each table row (NaN: none); null for text × text. */
  values: Float64Array | null
  /** The first table row of each category level and group level (stable keys of cells). */
  firstCat: number[]
  firstGroup: number[]
  /** Rows used. */
  n: number
  /** Rows with something in the variables but left out: without a level, without a value. */
  left: { level: number; value: number }
}

const cache = new WeakMap<DataTable, Map<string, MappedData | null>>()
const KEPT = 16

/** The levels a graph keeps an order of (none for no such variable). */
const storedOrder = (
  graph: Pick<GraphNode, 'levels' | 'levelOrder'>,
  ds: DataSetColumn | undefined,
) => (ds ? graph.levels?.[ds.id] : undefined)

/** A mapped graph's rows of `table`; null without a text variable on an axis. */
export function mappedData(
  table: DataTable,
  graph: Pick<GraphNode, 'mapping' | 'levels' | 'levelOrder'>,
  rows: readonly number[] | null,
): MappedData | null {
  const mapping = graph.mapping
  if (!mapping) return null
  const vars = mappedVariables(table, mapping)
  const key = JSON.stringify([
    mapping,
    vars && storedOrder(graph, vars.cat),
    vars && storedOrder(graph, vars.group),
    graph.levelOrder ?? 'appearance',
    rows,
  ])
  let byKey = cache.get(table)
  if (byKey?.has(key)) return byKey.get(key)!
  const out = vars ? computeMapped(table, graph, vars, rows) : null
  if (!byKey) {
    byKey = new Map()
    cache.set(table, byKey)
  }
  if (byKey.size >= KEPT) byKey.delete(byKey.keys().next().value!)
  byKey.set(key, out)
  return out
}

function computeMapped(
  table: DataTable,
  graph: Pick<GraphNode, 'levels' | 'levelOrder'>,
  vars: MappedVariables,
  rows: readonly number[] | null,
): MappedData {
  const { cat, value, group } = vars
  const values = value ? primaryValues(normalizeDataSet(table, value)) : null
  const level = (ds: DataSetColumn, r: number) =>
    ds.subcolumns[0]?.excluded?.[r] ? null : levelAt(ds.text, r)
  const shown = rows ?? Array.from({ length: table.rowCount }, (_, r) => r)
  const left = { level: 0, value: 0 }
  const used: { r: number; c: string; g: string }[] = []
  for (const r of shown) {
    const c = level(cat, r)
    const g = group ? level(group, r) : ''
    const ok = values ? Number.isFinite(values[r]!) : true
    if (c !== null && g !== null && ok) {
      used.push({ r, c, g })
      continue
    }
    // Rows with nothing in these variables aren't data left out (blank rows at the end).
    const hasValue = !!values && (ok || (value?.subcolumns[0]?.values[r] ?? null) !== null)
    if (c === null && (!group || g === null) && !hasValue) continue
    if (c === null || g === null) left.level++
    else left.value++
  }
  // Levels in the order they first appear in the table (the rows shown), whether or not that
  // row has a value (excluding a value doesn't reorder the categories); those drawn. A graph in
  // natural order (roadmap 34f) sorts those it keeps no order of.
  const first = (ds: DataSetColumn | undefined, drawn: Set<string>) => {
    const at = new Map<string, number>()
    if (!ds) return at
    for (const r of shown) {
      const t = level(ds, r)
      if (t !== null && drawn.has(t) && !at.has(t)) at.set(t, r)
    }
    return at
  }
  const catFirst = first(cat, new Set(used.map((u) => u.c)))
  const groupFirst = first(group, new Set(used.map((u) => u.g)))
  const order = graph.levelOrder
  const cats = orderedLevels([...catFirst.keys()], storedOrder(graph, cat), order)
  const groups = group
    ? orderedLevels([...groupFirst.keys()], storedOrder(graph, group), order)
    : []
  const ci = new Map(cats.map((c, i) => [c, i]))
  const gi = new Map(groups.map((g, i) => [g, i]))
  const cells = cats.map(() => Array.from({ length: Math.max(1, groups.length) }, () => []))
  for (const u of used) (cells[ci.get(u.c)!]![group ? gi.get(u.g)! : 0] as number[]).push(u.r)
  return {
    vars,
    cats,
    groups,
    cells,
    values,
    firstCat: cats.map((c) => catFirst.get(c)!),
    firstGroup: groups.map((g) => groupFirst.get(g)!),
    n: used.length,
    left,
  }
}

/** Each cell's count, or its percent of its category's rows or of every row (text × text). */
export function cellMeasure(d: MappedData, measure: LevelMeasure = 'count'): number[][] {
  const counts = d.cells.map((row) => row.map((rs) => rs.length))
  if (measure === 'count') return counts
  return counts.map((row) => {
    const total = measure === 'percentOfX' ? row.reduce((a, b) => a + b, 0) : d.n
    return row.map((n) => (total > 0 ? (100 * n) / total : Number.NaN))
  })
}

/** A data set as the frames read it, of values by row (`rows`: table rows; titles by row). */
function dataSet(
  table: DataTable,
  key: string,
  title: string,
  values: Float64Array,
  rowTitles: readonly (string | null)[] | null,
): NormalizedDataSet {
  return {
    ref: { node: table.id, key },
    title,
    rowCount: values.length,
    rowTitles,
    x: null,
    data: { shape: 'replicates', reps: [values] },
    counts: { empty: 0, excluded: 0 },
  }
}

/** The series a frame draws of a mapped graph (see the module comment); null: not mapped. */
export function mappedSeries(
  table: DataTable,
  graph: Pick<GraphNode, 'mapping' | 'levels' | 'levelOrder' | 'frame'>,
  rows: readonly number[] | null,
): GraphSeries[] | null {
  if (!isMapped(graph)) return null
  const d = mappedData(table, drawn(graph), rows)
  if (!d) return []
  const titles = table.rowTitles
  const series = (
    key: string,
    title: string,
    index: number,
    ds: NormalizedDataSet,
    more: Partial<GraphSeries> = {},
  ): GraphSeries => ({ key, title, index, ds, ...more })
  const measure = graph.mapping?.measure

  if (graph.frame === 'category') {
    // One series per category: its rows' values, as a row slice of the table.
    return d.cats.map((c, i) => {
      const rs = d.cells[i]!.flat().sort((a, b) => a - b)
      const values = d.values ? Float64Array.from(rs, (r) => d.values![r]!) : new Float64Array()
      const rowTitles = titles ? rs.map((r) => titles[r] ?? null) : null
      return series(levelKey(c), c, i, dataSet(table, levelKey(c), c, values, rowTitles), {
        rows: rs,
      })
    })
  }

  // Counts tick at whole numbers (percents don't).
  const counts = (measure ?? 'count') === 'count' ? { counts: true as const } : {}
  if (graph.frame === 'matrix') {
    if (!d.groups.length) return []
    // Text × text: a column per category, a row per group, each cell's count.
    const m = cellMeasure(d, measure)
    return d.cats.map((c, i) => {
      const values = Float64Array.from(d.groups, (_, g) => m[i]![g]!)
      return series(levelKey(c), c, i, dataSet(table, levelKey(c), c, values, d.groups), {
        rows: d.firstGroup,
        ...counts,
      })
    })
  }

  // Grouped: a cluster per category, a series per group (or the value variable alone).
  const groups = d.groups.length
    ? d.groups.map((g, j) => ({ key: levelKey(g), title: g, j }))
    : [{ key: d.vars.value?.id ?? d.vars.cat.id, title: d.vars.value?.title ?? '', j: 0 }]
  if (!d.values) {
    const m = cellMeasure(d, measure)
    return groups.map(({ key, title, j }) => {
      const values = Float64Array.from(d.cats, (_, i) => m[i]![j]!)
      return series(key, title, j, dataSet(table, key, title, values, d.cats), {
        rows: d.firstCat,
        ...counts,
      })
    })
  }
  return groups.map(({ key, title, j }) => {
    const cells = d.cats.map((_, i): PlotPoint[] =>
      d.cells[i]![j]!.map((r) => ({ value: d.values![r]!, row: r })),
    )
    // The cells' values are uneven: the frame reads `cells`, not replicates.
    const ds = dataSet(table, key, title, new Float64Array(d.cats.length).fill(Number.NaN), d.cats)
    return series(key, title, j, ds, {
      rows: d.firstCat,
      cells,
      ...(titles ? { cellRowTitles: titles } : {}),
    })
  })
}

/** A graph's mapping as its frame draws it: a category frame has no colour groups. */
function drawn<G extends Pick<GraphNode, 'mapping' | 'frame'>>(graph: G): G {
  if (graph.frame !== 'category' || graph.mapping?.color === undefined) return graph
  const { color: _, ...mapping } = graph.mapping
  return { ...graph, mapping }
}

/** The table rows a mapped graph draws (each in a category, and a group), in table order. */
export function mappedRows(
  table: DataTable,
  graph: Pick<GraphNode, 'mapping' | 'levels' | 'levelOrder' | 'frame'>,
  rows: readonly number[] | null,
): number[] {
  if (!isMapped(graph)) return []
  const d = mappedData(table, drawn(graph), rows)
  return d ? d.cells.flat(2).sort((a, b) => a - b) : []
}

/** Whether a graph draws its table's variables through a mapping (category, grouped, matrix). */
export const isMapped = (graph: Pick<GraphNode, 'mapping' | 'frame'>): boolean =>
  !!graph.mapping &&
  (graph.frame === 'category' || graph.frame === 'grouped' || graph.frame === 'matrix')

/**
 * The notes a mapped graph adds to its warnings: variables missing or of the wrong type, and the
 * rows left out (without a level or a value).
 */
export function mappedNotes(
  table: DataTable | undefined,
  graph: Pick<GraphNode, 'mapping' | 'levels' | 'levelOrder' | 'frame'>,
  rows: readonly number[] | null,
): string[] {
  if (!table || !isMapped(graph) || !graph.mapping) return []
  const axes = mappingAxes(table, graph.mapping)
  if (!axes) return ['A variable the graph shows is no longer in the table.']
  if (axes === 'nn')
    return ['X and Y are both number variables: map a text variable to X or Y to draw categories.']
  if (axes !== 'tt' && graph.frame === 'matrix')
    return ['A heat map of variables counts the levels of two text variables.']
  const d = mappedData(table, drawn(graph), rows)
  if (!d) return []
  const out: string[] = []
  const { level, value } = d.left
  if (level) {
    const names = [d.vars.cat, d.vars.group].filter(Boolean).map((v) => v!.title || 'untitled')
    out.push(`${plural(level, 'row')} without a level of ${names.join(' or ')} left out.`)
  }
  if (value && d.vars.value)
    out.push(
      `${plural(value, 'row')} without a value of ${d.vars.value.title || 'the variable'} (empty or excluded) left out.`,
    )
  return out
}

/**
 * A text variable whose levels a graph of variables orders: its categories, its groups, or (roadmap
 * 34b) the levels of a variable mapped to colour (XY graphs) or shape.
 */
export interface LevelVariable {
  id: string
  title: string
  role: 'categories' | 'groups' | 'colours' | 'shapes'
  /** Its levels drawn, in the graph's order. */
  levels: string[]
  /** The number variable the levels can be sorted by the mean of (none for text × text). */
  value?: string
}

/** What a graph's levels are read from (layers: an XY graph's mapped points). */
type LevelGraph = Pick<GraphNode, 'mapping' | 'levels' | 'levelOrder' | 'frame'> &
  Partial<Pick<GraphNode, 'layers'>>

/** The number variable a graph's levels sort by the mean of: its values, or an XY graph's Y. */
function valueVariable(table: DataTable, graph: LevelGraph): DataSetColumn | undefined {
  if (isMapped(graph) && graph.mapping) return mappedVariables(table, graph.mapping)?.value
  // A histogram of a variable (roadmap 34f): the variable binned.
  const hist = histogramLayer({ frame: graph.frame, layers: graph.layers ?? [] })
  const y = hist ? hist.aes?.x : mappedPointsLayer({ layers: graph.layers ?? [] })?.aes?.y
  const d = table.dataSets.find((x) => x.id === y)
  return d && !d.text ? d : undefined
}

/**
 * The text variables a graph of variables draws the levels of: categories first, then groups,
 * then those mapped to colour (on an XY graph) and shape (roadmap 34b).
 */
export function levelVariables(
  table: DataTable,
  graph: LevelGraph,
  rows: readonly number[] | null,
): LevelVariable[] {
  const out: LevelVariable[] = []
  const value = valueVariable(table, graph)
  const more = value ? { value: value.title || 'the values' } : {}
  if (isMapped(graph)) {
    const d = mappedData(table, drawn(graph), rows)
    if (d) {
      const { cat, group } = d.vars
      out.push({ id: cat.id, title: cat.title, role: 'categories', levels: d.cats, ...more })
      if (group)
        out.push({ id: group.id, title: group.title, role: 'groups', levels: d.groups, ...more })
    }
  }
  const aes = aesVariables({
    frame: graph.frame,
    mapping: graph.mapping,
    layers: graph.layers ?? [],
  })
  const hist = histogramLayer({ frame: graph.frame, layers: graph.layers ?? [] })
  // Roadmap 34g: a dot plot's rows are its group variable's levels.
  const dots = (graph.layers ?? []).find((l) => l.stat.kind === 'dotplot')?.aes?.group
  const roles = [
    ['groups', dots],
    ['colours', graph.frame === 'xy' ? (hist ? hist.aes?.color : aes.color) : undefined],
    ['shapes', aes.shape],
  ] as const
  for (const [role, key] of roles) {
    if (key === undefined || out.some((v) => v.id === key)) continue
    const v = mappedVariable(table, graph, key, rows)
    const d = table.dataSets.find((x) => x.id === key)
    if (v?.type !== 'text' || !d) continue
    out.push({ id: d.id, title: d.title, role, levels: v.order ?? [], ...more })
  }
  return out
}

/** How the user can sort a variable's levels in "Order of levels…". */
export type LevelSort = 'alpha' | 'natural' | 'mean' | 'count'

/**
 * A variable's levels sorted: A→Z (numbers in their order), naturally (roadmap 34f,
 * `naturalCompare`: "C2" before "C10", the same on every machine), by the mean of the graph's
 * number variable over each level's rows (lowest first; levels without one last), or by the
 * number of rows (most first). Ties keep their order.
 */
export function sortLevels(
  table: DataTable,
  graph: LevelGraph,
  variable: string,
  levels: readonly string[],
  by: LevelSort,
  rows: readonly number[] | null = null,
): string[] {
  if (by === 'alpha')
    return [...levels].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }),
    )
  if (by === 'natural') return [...levels].sort(naturalCompare)
  const d = isMapped(graph) ? mappedData(table, drawn(graph), rows) : null
  const ds = table.dataSets.find((x) => x.id === variable)
  if (!ds) return [...levels]
  // Each level's rows (of the variable, whether it gives the categories or the groups); a
  // variable mapped to colour or shape (34b): its rows shown with a value.
  const isCat = d?.vars.cat.id === variable
  const isGroup = d?.vars.group?.id === variable
  let rowsOf: Map<string, number[]>
  let values: Float64Array | null
  if (d && (isCat || isGroup)) {
    rowsOf = new Map<string, number[]>(
      isCat
        ? d.cats.map((c, i) => [c, d.cells[i]!.flat()])
        : d.groups.map((g, j) => [g, d.cells.flatMap((row) => row[j]!)]),
    )
    values = d.values
  } else {
    const value = valueVariable(table, graph)
    values = value ? primaryValues(normalizeDataSet(table, value)) : null
    rowsOf = new Map()
    const excluded = ds.subcolumns[0]?.excluded
    for (const r of rows ?? Array.from({ length: table.rowCount }, (_, i) => i)) {
      const t = excluded?.[r] ? null : levelAt(ds.text, r)
      if (!t || (values && !Number.isFinite(values[r]!))) continue
      const list = rowsOf.get(t)
      if (list) list.push(r)
      else rowsOf.set(t, [r])
    }
  }
  const score = (t: string) => {
    const rs = rowsOf.get(t) ?? []
    if (by === 'count') return -rs.length
    if (!values || !rs.length) return Number.POSITIVE_INFINITY
    return mean(rs.map((r) => values![r]!))
  }
  const scores = new Map(levels.map((t) => [t, score(t)]))
  return levels
    .map((t, i) => [t, i] as const)
    .sort((a, b) => {
      const [sa, sb] = [scores.get(a[0])!, scores.get(b[0])!]
      return sa === sb ? a[1] - b[1] : sa < sb ? -1 : 1
    })
    .map(([t]) => t)
}
