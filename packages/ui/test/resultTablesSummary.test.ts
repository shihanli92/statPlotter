import { registry } from '@ps/analyses'
import { inlineRunner, prepareJob } from '@ps/engine'
import {
  headerRowCount,
  layoutGraph,
  layoutPage,
  type PageTableCell,
  presetGraph,
  resultSheetCells,
  sceneToSvg,
} from '@ps/graph'
import { pageTableGrid } from '@ps/io'
import {
  type AnalysisNode,
  type AnalysisResult,
  type AnnotationId,
  type ColumnId,
  createProject,
  createTable,
  type DataTable,
  type GraphNode,
  type LayoutItemId,
  type LayoutNode,
  type NodeId,
  type Project,
  summaryText,
} from '@ps/model'
import { beforeAll, describe, expect, it } from 'vitest'
import { fonts } from '../../graph/test/helpers.ts'

// Audit 4 (G1; the user's answer Q2): result tables on graphs (inset tables) and on pages
// (page tables) leave out the summary sentence, as before 0.3.11 — it made them three times as
// wide, took the place of the header, and moved saved row ranges onto other rows. Checked with
// a real result (which has a summary block) and pinned as SVGs (`__snapshots__/resultTables/`).

let project: Project
let table: DataTable
let node: AnalysisNode
let result: AnalysisResult

beforeAll(async () => {
  table = createTable({ name: 'Enzyme', tableKind: 'column', columns: 2, rows: 6 })
  table.dataSets.forEach((d, i) => {
    d.id = `d${i}` as ColumnId
    d.title = ['Control', 'Treated'][i]!
    d.subcolumns[0]!.values = [
      [10, 12, 11, 13, 12, 14],
      [15, 17, 16, 19, 18, 17],
    ][i]!
  })
  const def = registry.get('ttest')!
  node = {
    kind: 'analysis',
    id: 'tt' as NodeId,
    name: 'Unpaired t test',
    analysisId: 'ttest',
    pluginVersion: def.version,
    input: { source: table.id, dataSets: ['d0', 'd1'] },
    params: def.params.parse({}),
  }
  project = createProject('Results', new Date(0))
  for (const n of [table, node]) {
    project.nodes[n.id] = n
    project.order.push(n.id)
  }
  const job = prepareJob(project, node, registry)
  if (job.ok !== true) throw new Error('not prepared')
  result = await inlineRunner(registry)(job.job)
})

const sheetKey = () => result.sheets.find((s) => s.blocks.some((b) => b.type === 'summary'))!.key

const texts = (rows: readonly PageTableCell[][]) => rows.flat().map((c) => c.text)

describe('result tables leave out the summary sentence (audit 4 G1)', () => {
  it('a real result has one, and the tables don’t show it', () => {
    const sheet = result.sheets.find((s) => s.key === sheetKey())!
    const summary = sheet.blocks.find((b) => b.type === 'summary')!
    expect(summary).toBeDefined()
    for (const rows of [
      resultSheetCells(sheet, project.settings),
      (() => {
        const g = pageTableGrid(
          project,
          { kind: 'results', node: node.id, sheet: sheet.key },
          () => result,
        )
        if ('error' in g) throw new Error(g.error)
        return g.rows
      })(),
    ]) {
      // Starts with a block's title (the header), never the sentence or a blank row.
      expect(rows[0]![0]!.style).toBe('title')
      expect(headerRowCount(rows)).toBeGreaterThan(0)
      expect(texts(rows).some((t) => /Treated|Control/.test(t) && t.length > 60)).toBe(false)
    }
  })

  it('an inset table of the result on a graph, pinned', async () => {
    const graph: GraphNode = {
      ...presetGraph(table, 'bars'),
      id: 'g' as NodeId,
      annotations: [
        {
          type: 'table',
          id: 'n1' as AnnotationId,
          analysis: node.id,
          sheet: sheetKey(),
          rows: { from: 0, to: 1 },
        } as never,
      ],
    }
    const p = { ...project, nodes: { ...project.nodes, [graph.id]: graph } }
    const scene = layoutGraph({ project: p, graph, fonts, result: () => result })
    await expect(sceneToSvg(scene)).toMatchFileSnapshot(
      './__snapshots__/resultTables/inset-ttest.svg',
    )
  })

  it('a page table of the result, rows 0–1 its first table’s, pinned', async () => {
    const layout: LayoutNode = {
      kind: 'layout',
      id: 'pg' as NodeId,
      name: 'Page',
      page: { width: 300, height: 200 },
      panelLabels: { show: false, style: 'A', size: 14 },
      items: [
        {
          type: 'table',
          id: 'a' as LayoutItemId,
          x: 20,
          y: 20,
          source: { kind: 'results', node: node.id, sheet: sheetKey() },
          rows: { from: 0, to: 1 },
        },
      ],
    } as LayoutNode
    const p = { ...project, nodes: { ...project.nodes, [layout.id]: layout } }
    const scene = layoutPage({
      project: p,
      layout,
      fonts,
      result: () => result,
      table: (source) => pageTableGrid(p, source, () => result),
    })
    const svg = sceneToSvg(scene, { ids: true })
    expect(svg).toContain('Treated − Control')
    const summary = result.sheets.flatMap((s) => s.blocks).find((b) => b.type === 'summary')!
    expect(svg).not.toContain(summaryText(summary as never, project.settings).slice(0, 30))
    await expect(svg).toMatchFileSnapshot('./__snapshots__/resultTables/page-ttest.svg')
  })
})
