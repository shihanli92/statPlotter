import { graphRows, panelLabel } from '@ps/graph'
import {
  type ExportSheet,
  header,
  type NumberMode,
  type ResultsExportOptions,
  type Row,
  resultSheetFileRows,
  resultSheetRows,
  type Section,
  stackSections,
  tableRows,
  title,
} from '@ps/io'
import {
  type DataTable,
  type GraphableDataSet,
  type GraphNode,
  graphOutputs,
  type LayoutNode,
  type NodeId,
  type Project,
  type ResultLookup,
  sourceTable,
  type TableKind,
} from '@ps/model'
import { tableRowsOfInfo } from '../organise/infoExport.ts'

// What goes into the workbooks of roadmap 26: a figure's source data (a graph, or a layout page's
// panels) and everything in the project. The rows come from @ps/io; this decides which tables and
// results a graph shows, which needs the graph package (row slices, panel letters).

export interface WorkbookContext {
  project: Project
  /** Latest results (the engine's). */
  result: ResultLookup
  mode?: NumberMode
}

const TABLE_KIND_LABELS: Record<TableKind, string> = {
  column: 'Column',
  xy: 'XY',
  grouped: 'Grouped',
  contingency: 'Contingency',
  survival: 'Survival',
  multipleVariables: 'Multiple variables',
  partsOfWhole: 'Parts of whole',
  nested: 'Nested',
}

const resultOptions = (ctx: WorkbookContext): ResultsExportOptions => ({
  settings: ctx.project.settings,
  mode: ctx.mode ?? 'displayed',
})

/**
 * The data sets a graph plots, in its order: its series, or the variables a layer maps to X, Y,
 * size and colour (bubble plots).
 */
export function plottedDataSets(graph: GraphNode, table: DataTable): string[] {
  const has = (k: string | undefined): k is string => !!table.dataSets.find((d) => d.id === k)
  const aes = graph.layers.find((l) => l.geom === 'points' && l.aes)?.aes
  // Vectors' ends (roadmap 34c) are plotted too.
  const ends = graph.layers.flatMap((l) => (l.geom === 'segment' ? [l.aes?.xend, l.aes?.yend] : []))
  if (aes) return [...new Set([aes.x, aes.y, aes.size, aes.color, ...ends].filter(has))]
  const include = graph.seriesSource.include
  const keys = include === 'all' ? table.dataSets.map((d) => d.id as string) : include
  // Text variables are never plotted as series.
  return keys.filter((k) => has(k) && !table.dataSets.find((d) => d.id === k)!.text)
}

/** A curve or other graphable output as columns: (row title,) X, Y (, lower, upper). */
function outputRows(out: GraphableDataSet): Row[] {
  const n = (v: number | undefined) => (v === undefined || Number.isNaN(v) ? null : v)
  const titles = !!out.rowTitles
  const band = !!(out.lo && out.hi)
  const head = [
    ...(titles ? [header('Row title')] : []),
    header('X'),
    header('Y'),
    ...(band ? [header('Lower'), header('Upper')] : []),
  ]
  return [
    head,
    ...out.x.map((x, i) => [
      ...(titles ? [out.rowTitles![i] ?? null] : []),
      n(x),
      n(out.y[i]),
      ...(band ? [n(out.lo![i]), n(out.hi![i])] : []),
    ]),
  ]
}

/**
 * What a graph shows, as sections: the data it plots (its data sets and rows, as the table has
 * them), the curves and other analysis outputs it draws, and every sheet of the analyses those
 * come from and of the analyses whose comparisons its brackets show.
 */
export function graphSections(ctx: WorkbookContext, graph: GraphNode): Section[] {
  const { project } = ctx
  const sections: Section[] = []
  const table = sourceTable(project, graph.seriesSource.table, ctx.result)
  if (table) {
    const dataSets = plottedDataSets(graph, table)
    const rows = graphRows(graph, table) ?? undefined
    if (dataSets.length)
      sections.push({ title: `Data: ${table.name}`, rows: tableRows(table, { dataSets, rows }) })
  }
  const analyses = new Set<NodeId>()
  for (const { series: s } of graphOutputs(graph)) {
    const node = project.nodes[s.ref.node]
    const out = ctx.result(s.ref.node)?.outputs[s.ref.key]
    if (out)
      sections.push({ title: `${node?.name ?? 'Analysis'}: ${out.title}`, rows: outputRows(out) })
    if (node?.kind === 'analysis') analyses.add(node.id)
  }
  for (const a of graph.annotations)
    if (a.type === 'bracket' && a.label.source === 'analysis') analyses.add(a.label.analysis)
  for (const id of analyses) {
    const node = project.nodes[id]
    if (node?.kind !== 'analysis') continue
    const result = ctx.result(id)
    if (!result) sections.push({ title: `Results: ${node.name}`, rows: [['Not calculated yet']] })
    for (const sheet of result?.sheets ?? [])
      sections.push({
        title: `Results: ${node.name} – ${sheet.title}`,
        rows: resultSheetRows(sheet, resultOptions(ctx)),
      })
  }
  return sections
}

const sheetOf = (name: string, heading: string, sections: Section[]): ExportSheet => ({
  name,
  rows: stackSections([{ title: heading, rows: [] }, ...sections]),
})

/** A graph's source data: one worksheet, named after the graph. */
export const graphSourceSheets = (ctx: WorkbookContext, graph: GraphNode): ExportSheet[] => [
  sheetOf(graph.name, graph.name, graphSections(ctx, graph)),
]

/**
 * A layout page's source data: a worksheet per graph on the page, named by its panel letter as
 * the page letters it (a, b, … in the page's style), with the graph's sections one under another.
 */
export function layoutSourceSheets(ctx: WorkbookContext, layout: LayoutNode): ExportSheet[] {
  const sheets: ExportSheet[] = []
  let index = 0
  for (const item of layout.items) {
    if (item.type !== 'graph') continue
    const letter = panelLabel(index++, layout.panelLabels.style)
    const graph = ctx.project.nodes[item.graph]
    if (graph?.kind !== 'graph') continue
    sheets.push(sheetOf(letter, `${letter}: ${graph.name}`, graphSections(ctx, graph)))
  }
  return sheets
}

/**
 * Everything in the project: a contents sheet listing every worksheet (linked) with its kind and
 * source, then every data table, then each analysis' result table and results sheets, in the
 * navigator's order. Analyses without results yet are listed as such.
 */
export function projectSheets(ctx: WorkbookContext): ExportSheet[] {
  const { project } = ctx
  const sheets: ExportSheet[] = []
  const contents: Row[] = [[header('Sheet'), header('Kind'), header('Source')]]
  const add = (name: string, kind: string, source: string, rows: Row[]) => {
    sheets.push({ name, rows })
    // The contents sheet comes first: this sheet's index in the workbook is its count.
    contents.push([{ v: name, link: sheets.length }, kind, source])
  }
  const order = project.order.map((id) => project.nodes[id])
  for (const node of order) {
    if (node?.kind === 'table')
      add(node.name, `Data table (${TABLE_KIND_LABELS[node.tableKind]})`, '', tableRows(node))
  }
  // Roadmap 40: info sheets (fields and notes).
  for (const node of order)
    if (node?.kind === 'info') add(node.name, 'Info sheet', '', tableRowsOfInfo(node))
  for (const node of order) {
    if (node?.kind !== 'analysis') continue
    const source = project.nodes[node.input.source]?.name ?? ''
    const result = ctx.result(node.id)
    if (!result) {
      contents.push([node.name, 'Results (not calculated yet)', source])
      continue
    }
    const table = sourceTable(project, node.id, ctx.result)
    if (table) add(`${node.name} – Data table`, 'Result table', source, tableRows(table))
    for (const sheet of result.sheets) {
      const name = `${node.name} – ${sheet.title}`
      add(name, 'Results', source, resultSheetFileRows(name, result, sheet, resultOptions(ctx)))
    }
  }
  const heading = project.meta.title || 'Project'
  return [{ name: 'Contents', rows: [[title(heading)], [], ...contents] }, ...sheets]
}
