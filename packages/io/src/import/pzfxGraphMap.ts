/**
 * Prism graphs as native graphs (roadmap 39, decision 571): each decoded Prism graph becomes its
 * table's default graph (the preset New graph makes, `createGraphFor`) with what was read from
 * Prism set on it — its name, data sets and their order, the graph and axis titles (hidden ones
 * removed), the axes' ranges, each data set's colour and symbol. What wasn't read (the kind of
 * marks, error bars, log scales, fonts and sizes) stays the default, and the report says so per
 * graph, so nothing is guessed silently.
 */
import { createGraphFor } from '@ps/graph'
import { type ContinuousAxisSpec, type DataTable, GraphNode, plainText, setAt } from '@ps/model'
import type { PrismAxis, PrismGraph, PrismGraphs, PrismTableInfo, PrismText } from './pzfxGraphs.ts'

/** What became of one Prism graph. */
export interface PzfxGraphReport {
  /** The graph's name in Prism. */
  name: string
  /** The table it draws (its name here); null when that table wasn't imported. */
  table: string | null
  /**
   * `decoded`: drawn from what was read; `default`: the table's default graph (its data sets
   * couldn't be read); `skipped`: not imported (its table isn't, e.g. an analysis's results).
   */
  status: 'decoded' | 'default' | 'skipped'
  /** What was taken from Prism ("Title", "Y axis range 0 to 4000"…). */
  matched: string[]
  /** What is this app's default instead. */
  defaulted: string[]
}

export interface PzfxGraphImport {
  /** Graphs to add, each of `tables[tableIndex]`. */
  graphs: { graph: GraphNode; tableIndex: number }[]
  report: PzfxGraphReport[]
  /** Prism graphs in the file. */
  found: number
  /** Graphs drawn from decoded settings. */
  decoded: number
  /** Why Prism's graphs couldn't be read at all (default graphs per table instead). */
  problem?: string
  /** Layouts in the file (not imported). */
  layouts: number
}

/** What every imported graph leaves to the defaults (nothing of it is decoded). */
export const NOT_DECODED = [
  'kind of graph (bars, points, lines: the table’s default graph)',
  'error bars',
  'axis scales (log scales are not read: linear)',
  'fonts, sizes, ticks and legend',
]

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

/** Number for a report: at most 6 significant digits. */
const num = (v: number) => String(Number(v.toPrecision(6)))

/**
 * Pairs the binary section's tables with the XML's (`xmlTables`: each XML table's title and Y
 * column titles, in file order): the first unpaired one with the same name and the same last
 * columns, else the only one of that name. Binary tables left over are analyses' results.
 */
export function pairTables(
  binary: readonly PrismTableInfo[],
  xmlTables: readonly { title: string; yTitles: string[] }[],
): (number | null)[] {
  const used = new Set<number>()
  return binary.map((b) => {
    const bTitles = b.columns.map((c) => norm(c.title))
    const sameName = xmlTables
      .map((x, i) => ({ x, i }))
      .filter(({ x, i }) => !used.has(i) && norm(x.title) === norm(b.name))
    const exact = sameName.find(({ x }) => {
      const tail = bTitles.slice(bTitles.length - x.yTitles.length)
      return (
        x.yTitles.length > 0 &&
        bTitles.length > x.yTitles.length &&
        x.yTitles.every((t, k) => norm(t) === tail[k])
      )
    })
    const pick = exact ?? (sameName.length === 1 ? sameName[0] : undefined)
    if (!pick) return null
    used.add(pick.i)
    return pick.i
  })
}

const textSpec = (t: PrismText) => ({ content: plainText(t.text) })

function setRange(axis: GraphNode['axes']['x'], a: PrismAxis): GraphNode['axes']['x'] | null {
  if (axis.type !== 'continuous') return null
  const next: ContinuousAxisSpec = { ...axis, range: { min: a.min, max: a.max } }
  return next
}

/**
 * The native graph of one decoded Prism graph of `table`, and what was matched; null when none
 * of the graph's data sets is one of the table's.
 */
export function graphFromPrism(
  prism: PrismGraph,
  table: DataTable,
  info: PrismTableInfo,
): { graph: GraphNode; matched: string[]; defaulted: string[] } | null {
  // Binary columns are row titles, then X when the table has one, then the Y columns.
  const yStart = info.columns.length - table.dataSets.length
  const keys: string[] = []
  const styles = new Map<string, { color?: string; shape?: string }>()
  for (const ds of prism.dataSets) {
    const d = table.dataSets[ds.column - yStart]
    if (!d || keys.includes(d.id)) continue
    keys.push(d.id)
    styles.set(d.id, { color: ds.color, shape: ds.shape })
  }
  if (!keys.length) return null

  let g: GraphNode = createGraphFor(table, prism.name || table.name)
  const matched: string[] = []
  const defaulted = [...NOT_DECODED]
  const set = (path: (string | number | { id: string })[], value: unknown) => {
    g = setAt(g, path, value) as GraphNode
  }

  const all = table.dataSets.map((d) => d.id as string)
  const inTableOrder = keys.length === all.length && keys.every((k, i) => k === all[i])
  if (!inTableOrder) set(['seriesSource', 'include'], keys)
  matched.push(
    keys.length === 1
      ? 'data set'
      : inTableOrder
        ? `data sets (${keys.length})`
        : `data sets (${keys.length}, in Prism’s order)`,
  )

  if (prism.title) {
    set(['title'], prism.title.hidden || !prism.title.text.trim() ? null : textSpec(prism.title))
    matched.push(prism.title.hidden ? 'title (hidden)' : 'title')
  }
  const axisTitle = (which: 'x' | 'y', label: string, a: PrismAxis | null) => {
    if (!a?.title) return
    const hidden = a.title.hidden || !a.title.text.trim()
    set(['axes', which, 'title'], hidden ? null : textSpec(a.title))
    matched.push(`${label} title${hidden ? ' (hidden)' : ''}`)
  }
  axisTitle('x', 'X axis', prism.x)
  axisTitle('y', 'Y axis', prism.y)

  if (prism.y) {
    const y = setRange(g.axes.y, prism.y)
    if (y) {
      set(['axes', 'y'], y)
      matched.push(`Y axis range ${num(prism.y.min)} to ${num(prism.y.max)}`)
    }
  }
  const xNumericHere = g.axes.x.type === 'continuous'
  if (prism.x && prism.xNumeric && xNumericHere) {
    const x = setRange(g.axes.x, prism.x)
    if (x) {
      set(['axes', 'x'], x)
      matched.push(`X axis range ${num(prism.x.min)} to ${num(prism.x.max)}`)
    }
  } else if (!prism.xNumeric && xNumericHere)
    defaulted.unshift('X as categories (Prism drew X values as categories; here X is numeric)')

  let colors = 0
  let shapes = 0
  const points = g.layers.filter((l) => l.geom === 'points')
  for (const [key, s] of styles) {
    if (s.color) {
      set(['seriesOverrides', key, 'color'], { rgb: s.color })
      colors++
    }
    if (s.shape && points.length) {
      for (const l of points)
        set(['layers', { id: l.id }, 'series', key, 'style', 'shape'], s.shape)
      shapes++
    }
  }
  if (colors) matched.push(colors === keys.length ? 'colours' : `colours (${colors})`)
  if (shapes) matched.push(shapes === keys.length ? 'symbols' : `symbols (${shapes})`)
  else if (points.length) defaulted.push('symbols')

  const parsed = GraphNode.safeParse(g)
  if (!parsed.success) return null
  return { graph: parsed.data, matched, defaulted }
}

/**
 * Graphs for a .pzfx import: one per Prism graph whose table was imported (`tableOf` gives the
 * imported table of a binary table, or null), drawn from what decoded, else its table's default
 * graph.
 */
export function graphsFromPrism(
  decoded: PrismGraphs,
  tables: readonly DataTable[],
  tableOf: (binaryTable: number) => number | null,
): PzfxGraphImport {
  const out: PzfxGraphImport = {
    graphs: [],
    report: [],
    found: decoded.graphs.length,
    decoded: 0,
    layouts: decoded.layouts,
  }
  for (const prism of decoded.graphs) {
    const binaryTables = [...new Set(prism.dataSets.map((d) => d.table))]
    const ti = binaryTables.length === 1 ? tableOf(binaryTables[0]!) : null
    const table = ti === null ? undefined : tables[ti]
    const name = prism.name || 'Graph'
    if (!table || ti === null) {
      out.report.push({
        name,
        table: null,
        status: 'skipped',
        matched: [],
        defaulted: [
          binaryTables.length > 1
            ? 'not imported: it draws data sets of several tables'
            : 'not imported: it draws an analysis’s results or a table that wasn’t imported',
        ],
      })
      continue
    }
    const built = graphFromPrism(prism, table, decoded.tables[binaryTables[0]!]!)
    if (built) {
      out.graphs.push({ graph: built.graph, tableIndex: ti })
      out.report.push({
        name,
        table: table.name,
        status: 'decoded',
        matched: built.matched,
        defaulted: built.defaulted,
      })
      out.decoded++
    } else {
      out.graphs.push({ graph: createGraphFor(table, name), tableIndex: ti })
      out.report.push({
        name,
        table: table.name,
        status: 'default',
        matched: [],
        defaulted: ['everything: the table’s default graph (its settings couldn’t be read)'],
      })
    }
  }
  return out
}

/** Default graphs per imported table, when Prism's graphs can't be read at all. */
export function defaultGraphsFor(
  tables: readonly DataTable[],
  found: number,
  problem: string,
): PzfxGraphImport {
  return {
    graphs: tables.map((t, tableIndex) => ({ graph: createGraphFor(t, t.name), tableIndex })),
    report: tables.map((t) => ({
      name: t.name,
      table: t.name,
      status: 'default' as const,
      matched: [],
      defaulted: ['everything: the table’s default graph'],
    })),
    found,
    decoded: 0,
    problem,
    layouts: 0,
  }
}
