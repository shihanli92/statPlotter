import { registry } from '@ps/analyses'
import { panelLabel } from '@ps/graph'
import { cellOf, exportText, type Row, readXlsx, writeXlsx } from '@ps/io'
import {
  type AnalysisResult,
  type DocNode,
  type GraphNode,
  graphOutputs,
  type LayoutNode,
  type NodeId,
  type Project,
} from '@ps/model'
import { beforeAll, describe, expect, it } from 'vitest'
import { startedEngine } from '../../engine/test/helpers.ts'
import { fonts, sampleTable } from '../../graph/test/helpers.ts'
import { createCurveFitting } from '../src/examples/synthetic/curveFitting.ts'
import { createGettingStarted } from '../src/examples/synthetic/gettingStarted.ts'
import {
  graphSections,
  graphSourceSheets,
  layoutSourceSheets,
  plottedDataSets,
  projectSheets,
  type WorkbookContext,
} from '../src/export/workbooks.ts'

// Data and results out (roadmap 26): what a graph's, a page's and the project's workbooks hold.

async function computed(project: Project): Promise<WorkbookContext> {
  const engine = await startedEngine(project, registry)
  engine.stop()
  return { project, result: (id: NodeId) => engine.latest(id) }
}

const byName = <K extends 'graph' | 'layout' | 'analysis'>(p: Project, kind: K, name: string) =>
  Object.values(p.nodes).find((n) => n.kind === kind && n.name === name) as Extract<
    DocNode,
    { kind: K }
  >

/** Section titles: the rows holding a title cell alone. */
const titlesOf = (rows: readonly Row[]) =>
  rows
    .filter((r) => r.length === 1 && cellOf(r[0]!).style === 'title')
    .map((r) => exportText(r[0]!))

describe('source data of a figure', () => {
  let ctx: WorkbookContext
  beforeAll(async () => {
    ctx = await computed(createGettingStarted(fonts))
  })

  it('a graph: the data it plots and the results its brackets show', () => {
    const graph = byName(ctx.project, 'graph', 'Enzyme activity (scatter)')
    const sheets = graphSourceSheets(ctx, graph)
    expect(sheets.map((s) => s.name)).toEqual(['Enzyme activity (scatter)'])
    const titles = titlesOf(sheets[0]!.rows)
    expect(titles[0]).toBe('Enzyme activity (scatter)')
    expect(titles[1]).toBe('Data: Enzyme activity')
    const t = ctx.result(byName(ctx.project, 'analysis', 'Unpaired t test').id)!
    expect(titles.filter((s) => s.startsWith('Results: '))).toEqual(
      t.sheets.map((s) => `Results: Unpaired t test – ${s.title}`),
    )
    // Not the analyses it doesn't show.
    expect(titles.join()).not.toContain('Welch')
    // The data table's header row and every value.
    const data = sheets[0]!.rows
    const head = data.findIndex((r) => exportText(r[0] ?? null) === 'Data: Enzyme activity')
    expect(data[head + 1]!.map(exportText)).toEqual(['Control', 'Treated'])
    const read = readXlsx(writeXlsx(sheets))
    expect(read[0]!.name).toBe('Enzyme activity (scatter)')
  })

  it('a layout page: a sheet per panel, named by its letter', () => {
    const layout = Object.values(ctx.project.nodes).find(
      (n): n is LayoutNode => n.kind === 'layout',
    )!
    const sheets = layoutSourceSheets(ctx, layout)
    const graphs = layout.items.flatMap((i) => (i.type === 'graph' ? [i.graph] : []))
    const letters = graphs.map((_, i) => panelLabel(i, layout.panelLabels.style))
    expect(sheets.map((s) => s.name)).toEqual(letters)
    sheets.forEach((s, i) => {
      const g = ctx.project.nodes[graphs[i]!] as GraphNode
      expect(titlesOf(s.rows)[0]).toBe(`${letters[i]}: ${g.name}`)
      expect(titlesOf(s.rows)).toContain(`Data: ${ctx.project.nodes[g.seriesSource.table]!.name}`)
    })
    // A graph removed from the project keeps its letter; its panel has no sheet.
    const gone = {
      ...layout,
      items: [{ ...layout.items[0]!, graph: 'gone' as NodeId }, ...layout.items.slice(1)],
    } as LayoutNode
    expect(layoutSourceSheets(ctx, gone).map((s) => s.name)).toEqual(letters.slice(1))
  })

  it("a graph's slice: only its data sets and rows", () => {
    const graph = byName(ctx.project, 'graph', 'Enzyme activity (scatter)')
    const table = ctx.project.nodes[graph.seriesSource.table]!
    if (table.kind !== 'table') throw new Error('table expected')
    const second = table.dataSets[1]!.id
    const sliced: GraphNode = {
      ...graph,
      seriesSource: { ...graph.seriesSource, include: [second], rows: [2, 0] },
      annotations: [],
    }
    const [data] = graphSections(ctx, sliced)
    expect(data!.rows.map((r) => r.map(exportText))).toEqual([
      ['Treated'],
      [String(table.dataSets[1]!.subcolumns[0]!.values[2])],
      [String(table.dataSets[1]!.subcolumns[0]!.values[0])],
    ])
    // A graph of analysis output only (no data sets of its table) has no data section.
    const outputOnly = { ...sliced, seriesSource: { ...sliced.seriesSource, include: [] } }
    expect(graphSections(ctx, outputOnly)).toEqual([])
  })

  it('bubble plots: their variables', () => {
    const t = sampleTable('multipleVariables')
    const graph = {
      frame: 'xy',
      layers: [
        {
          id: 'bubbles',
          geom: 'points',
          stat: { kind: 'identity' },
          aes: { x: 'b', y: 'a', size: 'b', color: 'zz' },
        },
      ],
      seriesSource: { table: t.id, include: 'all' },
    } as unknown as GraphNode
    expect(plottedDataSets(graph, t)).toEqual(['b', 'a'])
    t.dataSets[3]!.text = t.dataSets[3]!.subcolumns[0]!.values.map(() => 'x')
    const column = { ...graph, frame: 'category', layers: [] } as GraphNode
    expect(plottedDataSets(column, t)).toEqual(['a', 'b', 'c'])
  })
})

describe('curves', () => {
  it('a fitted curve: its points, and the fit’s results', async () => {
    const ctx = await computed(createCurveFitting(fonts))
    const graph = Object.values(ctx.project.nodes).find(
      (n): n is GraphNode => n.kind === 'graph' && graphOutputs(n).length > 0,
    )!
    const sections = graphSections(ctx, graph)
    const ref = graphOutputs(graph)[0]!.series.ref
    const out = ctx.result(ref.node)!.outputs[ref.key]!
    const fit = ctx.project.nodes[ref.node]!
    const curve = sections.find((s) => s.title === `${fit.name}: ${out.title}`)!
    expect(curve.rows[0]!.map(exportText).slice(0, 2)).toEqual(['X', 'Y'])
    expect(curve.rows).toHaveLength(out.x.length + 1)
    expect(cellOf(curve.rows[1]![0]!).v).toBe(out.x[0])
    expect(sections.some((s) => s.title?.startsWith(`Results: ${fit.name} – `))).toBe(true)
  })
})

describe('all data and results', () => {
  it('a contents sheet linking every table and results sheet', async () => {
    const ctx = await computed(createGettingStarted(fonts))
    const sheets = projectSheets(ctx)
    expect(sheets[0]!.name).toBe('Contents')
    const contents = sheets[0]!.rows.slice(3)
    const linked = contents.filter((r) => cellOf(r[0]!).link !== undefined)
    // Every sheet after the contents is listed, by its index.
    expect(linked.map((r) => cellOf(r[0]!).link)).toEqual(sheets.slice(1).map((_, i) => i + 1))
    expect(linked.map((r) => exportText(r[0]!))).toEqual(sheets.slice(1).map((s) => s.name))
    const nodes = Object.values(ctx.project.nodes)
    const tables = nodes.filter((n) => n.kind === 'table')
    const analyses = nodes.filter((n) => n.kind === 'analysis')
    const results = analyses.flatMap((a) => (ctx.result(a.id) as AnalysisResult).sheets)
    expect(linked.filter((r) => exportText(r[1]!).startsWith('Data table'))).toHaveLength(
      tables.length,
    )
    expect(linked.filter((r) => exportText(r[1]!) === 'Results')).toHaveLength(results.length)
    const read = readXlsx(writeXlsx(sheets))
    expect(read).toHaveLength(sheets.length)
    for (const s of read) expect(s.name.length).toBeLessThanOrEqual(31)
  })

  it('lists analyses without results as such', async () => {
    const ctx = await computed(createGettingStarted(fonts))
    const none = { ...ctx, result: () => undefined }
    const sheets = projectSheets(none)
    const analyses = Object.values(ctx.project.nodes).filter((n) => n.kind === 'analysis')
    expect(
      sheets[0]!.rows.filter((r) => exportText(r[1] ?? null) === 'Results (not calculated yet)'),
    ).toHaveLength(analyses.length)
  })
})
