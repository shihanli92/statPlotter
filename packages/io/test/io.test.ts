import {
  type AnalysisNode,
  type AnalysisResult,
  createProject,
  createTable,
  type LayoutNode,
  type NodeId,
  newLayoutItemId,
  newNodeId,
  type Project,
} from '@ps/model'
import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import {
  gridToTsv,
  ProjectFileError,
  parseClipboardGrid,
  parseNumber,
  readProjectFile,
  transposeGrid,
  writeProjectFile,
} from '../src/index.ts'

function sampleProject(): { project: Project; analysis: AnalysisNode } {
  const project = createProject('Sample', new Date('2026-09-28T00:00:00Z'))
  const table = createTable({ rows: 2, columns: 2 })
  table.dataSets[0]!.subcolumns[0]!.values = [1.25, null]
  table.dataSets[0]!.subcolumns[0]!.excluded = [false, true]
  const analysis: AnalysisNode = {
    kind: 'analysis',
    id: newNodeId(),
    name: 't test',
    analysisId: 'ttest',
    pluginVersion: 1,
    input: { source: table.id, dataSets: table.dataSets.map((d) => d.id) },
    params: { tails: 'two' },
  }
  project.nodes[table.id] = table
  project.nodes[analysis.id] = analysis
  project.order.push(table.id, analysis.id)
  return { project, analysis }
}

const result: AnalysisResult = {
  status: 'ok',
  diagnostics: [],
  sheets: [],
  values: {
    p: { kind: 'pvalue', v: 1e-300 },
    ci: {
      kind: 'interval',
      lo: Number.NEGATIVE_INFINITY,
      hi: Number.POSITIVE_INFINITY,
      level: 0.95,
    },
    nan: { kind: 'number', v: Number.NaN },
  },
  comparisons: [],
  outputs: {},
}

describe('project file', () => {
  it('round-trips the document, results cache (with non-finite numbers), and view state', () => {
    const { project, analysis } = sampleProject()
    const bytes = writeProjectFile(project, {
      results: new Map([[analysis.id, { inputKey: 'k1', result }]]),
      view: { selected: analysis.id },
      now: new Date('2026-09-29T12:00:00Z'),
    })
    const loaded = readProjectFile(bytes)
    expect(loaded.project).toEqual({
      ...project,
      meta: { ...project.meta, modified: '2026-09-29T12:00:00.000Z' },
    })
    expect(loaded.results.get(analysis.id)).toEqual({ inputKey: 'k1', result })
    expect(loaded.view).toEqual({ selected: analysis.id })
    expect(loaded.template).toBe(false)
  })

  it('marks templates in the manifest', () => {
    const { project } = sampleProject()
    const loaded = readProjectFile(writeProjectFile(project, { template: true }))
    expect(loaded.template).toBe(true)
    expect(loaded.project.order).toEqual(project.order)
    expect(loaded.results.size).toBe(0)
  })

  it('round-trips layouts', () => {
    const { project } = sampleProject()
    const layout: LayoutNode = {
      kind: 'layout',
      id: newNodeId(),
      name: 'Figure 1',
      page: { width: 792, height: 612 },
      items: [
        {
          type: 'text',
          id: newLayoutItemId(),
          x: 36,
          y: 40,
          content: { content: [{ text: 'Legend' }], style: { size: 9 } },
        },
      ],
      panelLabels: { show: false, style: '(a)', size: 12 },
    }
    project.nodes[layout.id] = layout
    project.order.push(layout.id)
    const loaded = readProjectFile(writeProjectFile(project, { results: new Map(), view: null }))
    expect(loaded.project.nodes[layout.id]).toEqual(layout)
  })

  it('drops cached results that are invalid or orphaned', () => {
    const { project, analysis } = sampleProject()
    const bytes = writeProjectFile(project, {
      results: new Map<NodeId, never>([
        [analysis.id, { inputKey: 'k', result: { status: 'nope' } } as never],
        ['ghost' as NodeId, { inputKey: 'k', result } as never],
      ]),
    })
    expect(readProjectFile(bytes).results.size).toBe(0)
  })

  it('reports readable errors for bad files', () => {
    expect(() => readProjectFile(strToU8('hello'))).toThrow(ProjectFileError)
    expect(() => readProjectFile(zipSync({ 'a.txt': strToU8('x') }))).toThrow(/no manifest/)

    const { project } = sampleProject()
    const future = zipSync({
      'manifest.json': strToU8(
        JSON.stringify({ format: 'plotting-software-project', schemaVersion: 99, order: [] }),
      ),
    })
    expect(() => readProjectFile(future)).toThrow(/newer version/)

    const broken = writeProjectFile({ ...project, order: [] })
    expect(() => readProjectFile(broken)).toThrow(/Invalid project file: order/)
  })
})

describe('clipboard', () => {
  it('parses spreadsheet TSV with blanks, text, and a trailing newline', () => {
    expect(parseClipboardGrid('Control\tTreated\r\n1.5\t\r\n-2\t3e-2\r\n')).toEqual([
      ['Control', 'Treated'],
      [1.5, null],
      [-2, 0.03],
    ])
  })
  it('transposes a pasted grid (rows become columns), padding ragged rows', () => {
    expect(transposeGrid([['A', 'B', 'C'], [1, 2], [3]])).toEqual([
      ['A', 1, 3],
      ['B', 2, null],
      ['C', null, null],
    ])
    expect(transposeGrid([])).toEqual([])
  })

  it('parses number formats strictly', () => {
    expect(parseNumber('1,234.5')).toBe(1234.5)
    expect(parseNumber('−3')).toBe(-3)
    expect(parseNumber('+.5')).toBe(0.5)
    expect(parseNumber('1e5')).toBe(100000)
    for (const bad of ['12 mg', '1.2.3', '1,23', '.', 'e5', 'NaN', 'Infinity', '1e999']) {
      expect(parseNumber(bad), bad).toBeNull()
    }
  })

  it('serializes back to TSV', () => {
    expect(gridToTsv([[1, null, 'a']])).toBe('1\t\ta')
  })
})
