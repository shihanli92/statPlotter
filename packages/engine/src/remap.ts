import {
  type AnalysisNode,
  type DataTable,
  type DocNode,
  type GraphNode,
  mapGraphRefs,
  type NodeId,
  nodeById,
  type Project,
  remapRowParams,
} from '@ps/model'
import { copyData } from './data.ts'

// Rewriting a copy of an analysis, graph or layout so its references point elsewhere (roadmap
// 31): other nodes (the copies of a family, another table), the data sets of another table, and
// that table's rows. Duplicate family, Apply to other tables, methods, New graph like this and
// Change the analyzed table all go through `remapNode`.

/** A data set key → its key in the other table, or null when it has no match there. */
export type KeyMap = ReadonlyMap<string, string | null>

/** A table row → its row in the other table, or null when that table has no such row. */
export type RowMap = (row: number) => number | null

export interface Remap {
  /** Node ids to replace (copied nodes, or a table → the table it now uses). */
  nodes: ReadonlyMap<NodeId, NodeId>
  /** Data set keys of the source table (and of result tables made from it) to replace. */
  keys: KeyMap
  /**
   * The table whose rows `rows` maps (by its id before remapping): row slices, point labels and
   * formats, brackets and row parameters of nodes reading it directly follow it.
   */
  rowsOf?: NodeId
  rows?: RowMap
  /**
   * Shared-axis groups (`links`) and sets of split graphs (`split.set`, page grids; roadmap 34d)
   * to replace, filled with fresh ids as they are met.
   */
  links?: Map<string, string>
  newLink?: () => string
  /** Where a node that pointed at the source table's analyses got them from (for comparisons). */
  analysisSource?: (analysis: NodeId) => NodeId | undefined
  /** Titles of data set keys, for messages. */
  title?: (key: string) => string
  /** Reports what could not be carried over, by node name. */
  warn?: (node: string, message: string) => void
}

const TOKEN = /[0-9a-z]+/g
const ROW_KEY = /^row(\d+):(.*)$/
const COL_KEY = /^col([0-9a-z]+):(\d+)\|(\d+)$/
const CELL_KEY = /^cell(\d+):([^|]+)\|(\d+):(.+)$/

/**
 * A key with the data set ids in it replaced ('curve:<id>', '<a>|<b>'): ids are the runs of
 * [0-9a-z] between separators. Null when one of them has no match.
 */
function mapTokens(s: string, keys: KeyMap): string | null {
  if (!keys.size) return s
  let lost = false
  const out = s.replace(TOKEN, (t) => {
    if (!keys.has(t)) return t
    const to = keys.get(t)
    if (to === null || to === undefined) lost = true
    return to ?? t
  })
  return lost ? null : out
}

/**
 * A data set key, an output key ('curve:<id>') or a comparison key with its data set ids and
 * (given `rows`) the row indices embedded in grouped comparisons (`row<r>:…`, `col<id>:<r>|<r>`,
 * `cell<r>:<id>|<r>:<id>`) replaced; null when something it names has no match.
 */
export function mapKey(key: string, keys: KeyMap, rows?: RowMap): string | null {
  const row = (r: string) => (rows ? rows(Number(r)) : Number(r))
  const byRow = ROW_KEY.exec(key)
  if (byRow) {
    const r = row(byRow[1]!)
    const rest = mapTokens(byRow[2]!, keys)
    return r === null || rest === null ? null : `row${r}:${rest}`
  }
  const byCol = COL_KEY.exec(key)
  if (byCol) {
    const id = mapTokens(byCol[1]!, keys)
    const [a, b] = [row(byCol[2]!), row(byCol[3]!)]
    return id === null || a === null || b === null ? null : `col${id}:${a}|${b}`
  }
  const byCell = CELL_KEY.exec(key)
  if (byCell) {
    const [a, b] = [row(byCell[1]!), row(byCell[3]!)]
    const [ka, kb] = [mapTokens(byCell[2]!, keys), mapTokens(byCell[4]!, keys)]
    return a === null || b === null || ka === null || kb === null
      ? null
      : `cell${a}:${ka}|${b}:${kb}`
  }
  return mapTokens(key, keys)
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)

/**
 * Analysis parameters with data set keys replaced wherever a string or a record key is exactly
 * one (outcome and predictor variables, a K per data set…). Keys without a match are left out of
 * lists and records; a single field naming one keeps it (the analysis then reports it missing).
 */
export function mapParams(value: unknown, keys: KeyMap): unknown {
  if (!keys.size) return value
  if (typeof value === 'string') return keys.get(value) ?? value
  if (Array.isArray(value))
    return value
      .filter((v) => typeof v !== 'string' || keys.get(v) !== null)
      .map((v) => mapParams(v, keys))
  if (!isRecord(value)) return value
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) {
    const to = keys.has(k) ? keys.get(k) : k
    if (to === null || to === undefined) continue
    out[to] = mapParams(v, keys)
  }
  return out
}

/** The rows of a list that have a place in the other table; the others are reported. */
function mapRows(rows: readonly number[], map: RowMap, lost: number[]): number[] {
  const out: number[] = []
  for (const r of rows) {
    const to = map(r)
    if (to === null) lost.push(r)
    else out.push(to)
  }
  return out
}

const rowList = (rows: number[]) => {
  const list = [...new Set(rows)].sort((a, b) => a - b)
  return `${list.length === 1 ? 'row' : 'rows'} ${list.map((r) => r + 1).join(', ')}`
}

/** A copy of a node with its references rewritten by `m` (the node itself is not modified). */
export function remapNode<N extends DocNode>(node: N, m: Remap): N {
  if (node.kind === 'graph') return remapGraph(node, m) as N
  const out = copyData(node)
  if (out.kind === 'analysis') remapAnalysis(out, m)
  else if (out.kind === 'layout') {
    if (out.grids && m.links) for (const grid of out.grids) grid.set = freshLink(m, grid.set)
    for (const item of out.items) {
      // Graphs and live tables (a data table, a result table or a results sheet) follow;
      // images keep their asset (shared), groups their ids (scoped to the page).
      if (item.type === 'graph') item.graph = m.nodes.get(item.graph) ?? item.graph
      else if (item.type === 'table')
        item.source = { ...item.source, node: m.nodes.get(item.source.node) ?? item.source.node }
    }
  }
  return out
}

/** The fresh id of a shared-axis group or a split set (made the first time it is met). */
function freshLink(m: Remap, id: string): string {
  let to = m.links!.get(id)
  if (!to) {
    to = m.newLink?.() ?? id
    m.links!.set(id, to)
  }
  return to
}

function remapAnalysis(a: AnalysisNode, m: Remap) {
  const warn = (msg: string) => m.warn?.(a.name, msg)
  const onTable = m.rows !== undefined && a.input.source === m.rowsOf
  a.input.source = m.nodes.get(a.input.source) ?? a.input.source
  const lost: string[] = []
  a.input.dataSets = a.input.dataSets.flatMap((k) => {
    const to = mapKey(k, m.keys)
    if (to === null) lost.push(m.title?.(k) ?? k)
    return to === null ? [] : [to]
  })
  if (lost.length) warn(`no match for ${quoteList(lost)}, left out`)
  // Pooled data sets (roadmap 35): a pool keeps the members that have a match.
  if (a.input.pools) {
    const pools = a.input.pools
      .map((pool) => pool.flatMap((k) => mapKey(k, m.keys) ?? []))
      .filter((pool) => pool.length >= 2)
    if (pools.length) a.input.pools = pools
    else delete a.input.pools
  }
  a.params = mapParams(a.params, m.keys)
  if (onTable) {
    const next = remapRowParams(a.analysisId, a.params, (r) => m.rows!(r))
    if (next !== undefined) {
      a.params = next
      warn('rows it names past the end of the table were dropped')
    }
  }
}

const quoteList = (items: readonly string[]) => [...new Set(items)].map((t) => `“${t}”`).join(', ')

/**
 * A copy of a graph pointing elsewhere: every reference `graphRefs` finds — its source, the
 * data sets it names (shown, formatted, mapped to aesthetics, in brackets and the legend), the
 * outputs its layers draw, the rows it names — then its shared-axis groups.
 */
function remapGraph(graph: GraphNode, m: Remap): GraphNode {
  const warn = (msg: string) => m.warn?.(graph.name, msg)
  const title = (k: string) => m.title?.(k) ?? k
  const rows = m.rows !== undefined && graph.seriesSource.table === m.rowsOf ? m.rows : undefined
  const key = (k: string) => mapKey(k, m.keys)
  const lostKeys: string[] = []
  const lostRows: number[] = []
  const droppedBrackets: string[] = []

  const g = mapGraphRefs(copyData(graph), {
    source: (node) => m.nodes.get(node) ?? node,
    output: (o) => {
      const node = m.nodes.get(o.ref.node) ?? o.ref.node
      const remapped = m.nodes.has(o.ref.node) || o.ref.node === m.rowsOf
      const refKey = remapped ? key(o.ref.key) : o.ref.key
      if (refKey === null) return 'drop'
      if (node === o.ref.node && refKey === o.ref.key) return 'keep'
      return { ref: { node, key: refKey }, colorOf: o.colorOf }
    },
    key: (k, role) => {
      const to = key(k)
      // A data set shown or mapped to an aesthetic that has no match is reported; formats of
      // it simply go.
      if (
        to === null &&
        (role === 'include' || role === 'aes' || role === 'mapping' || role === 'filter')
      )
        lostKeys.push(title(k))
      return to === null ? 'drop' : to
    },
    rows: (list) => (rows ? mapRows(list, rows, lostRows) : 'keep'),
    row: (r) => (rows ? rows(r) : r),
    // Roadmap 35: result layers and tables follow their analysis' copy; the keys of values and
    // comparisons they read follow the data sets.
    analysis: (node) => m.nodes.get(node) ?? node,
    // Comparison keys of an analysis of the table name its rows (audit 2, M4). A key naming a
    // data set or row with no match (deleted, or not in the other table) drops its field, which
    // reads "—" (audit 2, M12: it kept naming a deleted data set).
    resultKey: (k, analysis) => {
      const onTable = rows && m.analysisSource?.(analysis) === m.rowsOf
      return mapKey(k, m.keys, onTable ? rows : undefined)
    },
    bracket: (a) => {
      const [ka, kb] = [key(a.a), key(a.b)]
      // A group pooled with `a` (roadmap 35) keeps the members that have a match.
      const group = a.group?.flatMap((k) => key(k) ?? [])
      const ra = a.rowA === undefined || !rows ? a.rowA : rows(a.rowA)
      const rb = a.rowB === undefined || !rows ? a.rowB : rows(a.rowB)
      let comparison: string | null = null
      const out = { ...a }
      if (a.label.source === 'analysis') {
        const onTable = rows && m.analysisSource?.(a.label.analysis) === m.rowsOf
        comparison = mapKey(a.label.comparison, m.keys, onTable ? rows : undefined)
        out.label = { ...a.label, analysis: m.nodes.get(a.label.analysis) ?? a.label.analysis }
      }
      if (
        ka === null ||
        kb === null ||
        ra === null ||
        rb === null ||
        (a.label.source === 'analysis' && comparison === null)
      ) {
        droppedBrackets.push(`${title(a.a)} vs ${title(a.b)}`)
        return 'drop'
      }
      out.a = ka
      out.b = kb
      if (group?.length) out.group = group
      else delete out.group
      if (ra !== undefined) out.rowA = ra
      if (rb !== undefined) out.rowB = rb
      if (out.label.source === 'analysis') out.label = { ...out.label, comparison: comparison! }
      return out
    },
  })

  if (g.links && m.links) {
    const fresh = (id: string | undefined) => (id === undefined ? undefined : freshLink(m, id))
    g.links = { x: fresh(g.links.x), y: fresh(g.links.y) }
    if (g.links.x === undefined) delete g.links.x
    if (g.links.y === undefined) delete g.links.y
  }
  if (g.split && m.links) g.split = { ...g.split, set: freshLink(m, g.split.set) }

  if (lostKeys.length) warn(`no match for ${quoteList(lostKeys)}, left out`)
  if (lostRows.length) warn(`${rowList(lostRows)} past the end of the table, left out`)
  if (droppedBrackets.length)
    warn(
      `${droppedBrackets.length === 1 ? 'a bracket' : 'brackets'} left out (${quoteList(droppedBrackets)})`,
    )
  return g
}

/**
 * The data sets of `from` matched to those of `to`: by position (the first with the first…) or
 * by title (ignoring case and surrounding spaces; repeated titles in order). Unmatched → null.
 */
export function dataSetMap(from: DataTable, to: DataTable, match: 'position' | 'title'): KeyMap {
  const out = new Map<string, string | null>()
  if (match === 'position') {
    for (const [i, d] of from.dataSets.entries()) out.set(d.id, to.dataSets[i]?.id ?? null)
    return out
  }
  const norm = (s: string) => s.trim().toLowerCase()
  const used = new Set<string>()
  for (const d of from.dataSets) {
    const hit = to.dataSets.find((t) => !used.has(t.id) && norm(t.title) === norm(d.title))
    if (hit) used.add(hit.id)
    out.set(d.id, hit?.id ?? null)
  }
  return out
}

/** Rows of a table with `count` rows: every row below it, none past its end. */
export const rowsUpTo =
  (count: number): RowMap =>
  (r) =>
    r < count ? r : null

/** Where an analysis of `doc` reads from (for comparison keys naming its table's rows). */
export const analysisSourceIn =
  (doc: Pick<Project, 'nodes'>) =>
  (id: NodeId): NodeId | undefined => {
    const n = nodeById(doc.nodes, id)
    return n?.kind === 'analysis' ? n.input.source : undefined
  }

/** `name` with every `find` replaced (nothing to find: unchanged). */
export const substitute = (name: string, find: string, replace: string) =>
  find ? name.split(find).join(replace) : name

/**
 * Collects `Remap.warn` reports by node, and gives them as one line per node (in the order the
 * nodes were first reported).
 */
export function warnings(): {
  warn: (node: string, message: string) => void
  list: () => string[]
} {
  const byNode = new Map<string, Set<string>>()
  return {
    warn: (node, message) => {
      const set = byNode.get(node) ?? new Set<string>()
      byNode.set(node, set.add(message))
    },
    list: () => [...byNode].map(([node, msgs]) => `“${node}”: ${[...msgs].join('; ')}.`),
  }
}
