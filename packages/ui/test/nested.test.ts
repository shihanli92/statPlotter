import { DocumentStore, type ResultState } from '@ps/engine'
import { createGraphFor, nestedOf } from '@ps/graph'
import { parseClipboardGrid } from '@ps/io'
import {
  type AnalysisNode,
  type AnalysisResult,
  type ColumnId,
  createProject,
  createTable,
  type DataTable,
  DocNode,
  newNodeId,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { dataNodeFor, givesTable, sourceProblem } from '../src/resultTables.ts'
import { sampleTable } from '../src/samples.ts'
import {
  gridColumns,
  hasSubHeader,
  pasteCommands,
  subcolumnNoun,
  subLabel,
  subTitleCommand,
} from '../src/table/gridModel.ts'

function nested(subjects = 2, groups = 2) {
  const table = createTable({
    tableKind: 'nested',
    yFormat: { type: 'replicates', count: subjects },
    columns: groups,
    rows: 3,
  })
  const store = new DocumentStore(createProject())
  store.dispatch({ type: 'node.add', node: table })
  const t = () => store.getState().nodes[table.id] as DataTable
  let n = 0
  const newId = () => `new${n++}` as ColumnId
  return { store, t, newId }
}

describe('nested table editor', () => {
  it('always shows the subject row, with default names until named', () => {
    const { store, t } = nested(1)
    const cols = gridColumns(t())
    expect(hasSubHeader(t(), cols)).toBe(true)
    expect(cols.map((c) => subLabel(t(), c))).toEqual(['Subject 1', 'Subject 1'])
    const cmd = subTitleCommand(t(), cols[0] as never, '  Mouse A ')
    expect(cmd).toMatchObject({ type: 'table.setSubcolumnTitle', sub: 0, title: 'Mouse A' })
    store.dispatch(cmd!)
    expect(subLabel(t(), gridColumns(t())[0]!)).toBe('Mouse A')
    // Clearing, or typing the default name, removes the title; no change → no command.
    expect(subTitleCommand(t(), gridColumns(t())[0] as never, 'Subject 1')).toMatchObject({
      title: null,
    })
    expect(subTitleCommand(t(), gridColumns(t())[0] as never, 'Mouse A')).toBeNull()
    expect(subTitleCommand(t(), gridColumns(t())[1] as never, '')).toBeNull()
  })

  it('names the subcolumns that can be added', () => {
    expect(subcolumnNoun(nested().t())).toEqual({ one: 'subject', many: 'subjects' })
    expect(subcolumnNoun(createTable({ tableKind: 'grouped' }))?.one).toBe('replicate')
    expect(subcolumnNoun(createTable())).toBeNull()
    expect(
      subcolumnNoun(createTable({ yFormat: { type: 'summary', preset: 'meanSd' } })),
    ).toBeNull()
  })

  it('pastes group titles, subject names and values from a spreadsheet', () => {
    const { store, t, newId } = nested(2, 1)
    const grid = parseClipboardGrid('Control\t\tTreated\t\nM1\tM2\tM3\tM4\n1\t2\t3\t4\n5\t6\t7\t8')
    const res = pasteCommands(t(), gridColumns(t()), { r: 0, c: 0 }, grid, newId)
    if (!res.ok) throw new Error(res.error)
    store.dispatch(res.commands)
    const [a, b] = t().dataSets
    expect([a!.title, b!.title]).toEqual(['Control', 'Treated'])
    expect(a!.subcolumnTitles).toEqual(['M1', 'M2'])
    expect(b!.subcolumnTitles).toEqual(['M3', 'M4'])
    expect(b!.subcolumns.map((c) => c.values.slice(0, 2))).toEqual([
      [3, 7],
      [4, 8],
    ])
  })

  it('reads a single header row over every subcolumn as subject names', () => {
    const { store, t, newId } = nested(2, 2)
    const grid = parseClipboardGrid('M1\tM2\tM3\tM4\n1\t2\t3\t4')
    const res = pasteCommands(t(), gridColumns(t()), { r: 0, c: 0 }, grid, newId)
    if (!res.ok) throw new Error(res.error)
    store.dispatch(res.commands)
    expect(t().dataSets.map((d) => d.subcolumnTitles)).toEqual([
      ['M1', 'M2'],
      ['M3', 'M4'],
    ])
    expect(t().dataSets.map((d) => d.title)).toEqual(['Group A', 'Group B'])
  })

  it('keeps a header row over the first subcolumns as group titles', () => {
    const { store, t, newId } = nested(2, 2)
    const grid = parseClipboardGrid('WT\t\tKO\t\n1\t2\t3\t4')
    const res = pasteCommands(t(), gridColumns(t()), { r: 0, c: 0 }, grid, newId)
    if (!res.ok) throw new Error(res.error)
    store.dispatch(res.commands)
    expect(t().dataSets.map((d) => d.title)).toEqual(['WT', 'KO'])
    expect(t().dataSets.map((d) => d.subcolumnTitles)).toEqual([undefined, undefined])
  })
})

describe('nested sample and default graph', () => {
  it('builds a valid nested table with named subjects and a nested graph', () => {
    const table = sampleTable('nested', 'Nested')
    expect(DocNode.safeParse(table).success).toBe(true)
    expect(table.yFormat).toEqual({ type: 'replicates', count: 3 })
    expect(table.dataSets.map((d) => d.subcolumnTitles?.[0])).toEqual(['Mouse 1', 'Mouse 4'])
    expect(
      table.dataSets.every((d) => d.subcolumns.every((c) => c.values.every((v) => v !== null))),
    ).toBe(true)
    expect(nestedOf(createGraphFor(table).layers).layout).toBe('subjects')
    expect(createGraphFor(table).layers.find((l) => l.id === 'points')?.position).toEqual({
      kind: 'dodge',
      by: 'subject',
    })
  })
})

describe('result tables in the UI', () => {
  const table = createTable()
  const analysis: AnalysisNode = {
    kind: 'analysis',
    id: newNodeId(),
    name: 'Transform of Data 1',
    analysisId: 'transform',
    pluginVersion: 1,
    input: { source: table.id, dataSets: [] },
    params: {},
  }
  const withTable: AnalysisResult = {
    status: 'ok',
    diagnostics: [],
    sheets: [],
    values: {},
    comparisons: [],
    outputs: {},
    table: createTable(),
  }
  const none = () => undefined
  const produces = { producesTable: true }

  it('analyze and graph an analysis’ own table when it gives one, else what it analyzed', () => {
    expect(dataNodeFor(table, () => undefined, none)).toBe(table.id)
    expect(dataNodeFor(analysis, () => undefined, none)).toBe(table.id)
    expect(dataNodeFor(analysis, () => produces, none)).toBe(analysis.id)
    expect(
      dataNodeFor(
        analysis,
        () => undefined,
        () => withTable,
      ),
    ).toBe(analysis.id)
    const graph = createGraphFor({ ...createTable(), id: analysis.id })
    expect(dataNodeFor(graph, () => undefined, none)).toBe(analysis.id)
    expect(dataNodeFor(undefined, () => undefined, none)).toBeNull()
    expect(givesTable(table, produces, none)).toBe(false)
  })

  it('say why a result table is not there yet', () => {
    const pending: ResultState = { status: 'pending', inputKey: 'k' }
    const failed: ResultState = { status: 'error', inputKey: 'k', message: 'boom' }
    expect(sourceProblem(analysis, undefined, pending)).toMatch(/still computing/)
    expect(sourceProblem(analysis, undefined, failed)).toMatch(/could not be computed: boom/)
    expect(sourceProblem(analysis, undefined, undefined)).toMatch(/has no data table/)
    expect(sourceProblem(analysis, withTable.table, undefined)).toBeNull()
    expect(sourceProblem(undefined, undefined, undefined)).toMatch(/no data table/)
  })
})
