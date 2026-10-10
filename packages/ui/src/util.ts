import { type DocNode, type GraphNode, type NodeId, type Project, uniqueName } from '@ps/model'

/** The project's graphs in navigator order. */
export const graphsOf = (project: Project): GraphNode[] =>
  project.order.map((id) => project.nodes[id]).filter((n): n is GraphNode => n?.kind === 'graph')

/** Whether a table (or an analysis, for its result table) has a graph drawing it. */
export const hasGraphOf = (project: Pick<Project, 'nodes'>, table: NodeId): boolean =>
  Object.values(project.nodes).some((n) => n.kind === 'graph' && n.seriesSource.table === table)

/**
 * A new graph's default name (roadmap 43): the table's name, as the graph a new table gets is
 * named, or "Data 1 (2)", "Data 1 (3)"… when a graph has that name, so a second graph of a table
 * shows as one.
 */
export const newGraphName = (project: Pick<Project, 'nodes'>, tableName: string): string =>
  uniqueName(
    tableName,
    Object.values(project.nodes).flatMap((n) => (n.kind === 'graph' ? [n.name] : [])),
  )

/**
 * Whether the New data table dialog starts with "Start with sample data" ticked (roadmap 43):
 * only while the project has no data tables, so a first table has values to analyze and graph.
 */
export const sampleByDefault = (project: Pick<Project, 'nodes'>): boolean =>
  !Object.values(project.nodes).some((n) => n.kind === 'table')

/** A new sheet's default name: "Data 3" for the third table, "Layout 2" for the second page. */
export function nextName(project: Project, kind: Extract<DocNode['kind'], 'table' | 'layout'>) {
  const count = Object.values(project.nodes).filter((n) => n.kind === kind).length
  return `${kind === 'table' ? 'Data' : 'Layout'} ${count + 1}`
}

/**
 * The sheet to show: `selected` while it exists, else the first sheet, or none in an empty
 * project. A project that gains sheets while none is shown (undo back to empty, then redo) shows
 * its first one rather than the empty-project page.
 */
export function validSelection(project: Project, selected: NodeId | null): NodeId | null {
  if (selected && project.nodes[selected]) return selected
  return project.order[0] ?? null
}

/** The text with its first letter in upper case ("graph" → "Graph"). */
export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** What went wrong, for a message: an error's message (its first line only), or the value. */
export const errorMessage = (e: unknown, firstLine = false): string =>
  e instanceof Error ? (firstLine ? e.message.split('\n')[0]! : e.message) : String(e)
