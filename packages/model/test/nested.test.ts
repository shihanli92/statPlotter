import { describe, expect, it } from 'vitest'
import {
  type AnalysisResult,
  createProject,
  createTable,
  DataTable,
  isYFormatAllowed,
  type NodeId,
  normalizeTable,
  resultTableAs,
  sourceTable,
  tableIssues,
} from '../src/index.ts'

const arr = (a: Float64Array) => Array.from(a)

/** Two groups of three subjects, two replicate measurements each; group B has two subjects. */
function nestedTable(): DataTable {
  const t = createTable({
    tableKind: 'nested',
    yFormat: { type: 'replicates', count: 3 },
    columns: 2,
    rows: 2,
  })
  const [a, b] = t.dataSets
  a!.subcolumnTitles = ['Mouse 1', 'Mouse 2', null]
  a!.subcolumns[0]!.values = [1, 2]
  a!.subcolumns[1]!.values = [3, null]
  a!.subcolumns[2]!.values = [5, 6]
  a!.subcolumns[2]!.excluded = [false, true]
  b!.subcolumns[0]!.values = [7, 8]
  b!.subcolumns[1]!.values = [9, 10]
  return t
}

describe('nested tables', () => {
  it('take raw replicate values only', () => {
    expect(isYFormatAllowed('nested', { type: 'replicates', count: 4 })).toBe(true)
    expect(isYFormatAllowed('nested', { type: 'summary', preset: 'meanSdN' })).toBe(false)
  })

  it('validate with subject titles', () => {
    const t = nestedTable()
    expect(tableIssues(t)).toEqual([])
    expect(DataTable.parse(t).dataSets[0]!.subcolumnTitles).toEqual(['Mouse 1', 'Mouse 2', null])
  })

  it('normalize to one replicate array per subject (rows = its measurements)', () => {
    const [a, b] = normalizeTable(nestedTable())
    if (a!.data.shape !== 'replicates' || b!.data.shape !== 'replicates') throw new Error()
    expect(a!.data.reps.map(arr)).toEqual([
      [1, 2],
      [3, Number.NaN],
      [5, Number.NaN], // excluded
    ])
    expect(a!.counts).toEqual({ empty: 1, excluded: 1 })
    // A group with fewer subjects than the widest has empty subcolumns: all NaN.
    expect(b!.data.reps.map(arr)).toEqual([
      [7, 8],
      [9, 10],
      [Number.NaN, Number.NaN],
    ])
    expect(b!.counts).toEqual({ empty: 2, excluded: 0 })
  })
})

describe('source tables', () => {
  const table = createTable({ columns: 1, rows: 2 })
  const produced: DataTable = { ...createTable({ columns: 2, rows: 3 }), name: 'Plugin name' }
  const result = (t?: DataTable): AnalysisResult => ({
    status: 'ok',
    diagnostics: [],
    sheets: [],
    values: {},
    comparisons: [],
    outputs: {},
    ...(t ? { table: t } : {}),
  })
  const project = createProject()
  const analysis = {
    kind: 'analysis' as const,
    id: 'an1' as NodeId,
    name: 'Transform of Data 1',
    analysisId: 'x',
    pluginVersion: 1,
    input: { source: table.id, dataSets: [] },
    params: {},
  }
  project.nodes[table.id] = table
  project.nodes[analysis.id] = analysis

  it('is the table itself for a data table', () => {
    expect(sourceTable(project, table.id)).toBe(table)
  })

  it('is an analysis’ result table, under the analysis’ id and name', () => {
    const lookup = () => result(produced)
    const t = sourceTable(project, analysis.id, lookup)!
    expect(t.id).toBe(analysis.id)
    expect(t.name).toBe('Transform of Data 1')
    expect(t.dataSets).toBe(produced.dataSets)
    // Same result → same object (graphs and normalization stay cached).
    expect(sourceTable(project, analysis.id, lookup)).toBe(t)
    expect(resultTableAs(produced, analysis.id, analysis.name)).toBe(t)
  })

  it('is missing without a result, a result table, or a known node', () => {
    expect(sourceTable(project, analysis.id)).toBeUndefined()
    expect(sourceTable(project, analysis.id, () => result())).toBeUndefined()
    expect(sourceTable(project, 'nosuch', () => result(produced))).toBeUndefined()
    expect(sourceTable(project, 'constructor', () => result(produced))).toBeUndefined()
  })
})
