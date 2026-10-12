import {
  type AnalysisDef,
  type AnalysisNode,
  type AnalysisResult,
  createProject,
  createTable,
  type DataTable,
  MAX_METHOD_HISTORY,
  type MethodChange,
  modifyInput,
  newNodeId,
  normalizeTable,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  type AnalysisJob,
  type AnalysisRegistry,
  DocumentStore,
  withSourceNotes,
} from '../src/index.ts'
import { startedEngine } from './helpers.ts'

// Roadmap 51c (design §7.1, S13/S20, §7.4): an analysis' method changes kept in its node; the
// notes on analyses of outlier-cleaned or normalized values; the values of an XY table compared
// at each X, as a grouped table's rows.

const change = (k: number): MethodChange => ({
  at: `2026-10-13T00:00:${String(k % 60).padStart(2, '0')}Z`,
  from: { analysisId: 'ttest', pluginVersion: 2, params: { tails: 'two' }, dataSets: ['a', 'b'] },
  changes: [`P value: Two-tailed → One-tailed (${k})`],
  afterResults: true,
})

function storeWithAnalysis() {
  const table = createTable({ tableKind: 'column', rows: 2, columns: 2 })
  const analysis: AnalysisNode = {
    kind: 'analysis',
    id: newNodeId(),
    name: 'a',
    analysisId: 'ttest',
    pluginVersion: 2,
    input: { source: table.id, dataSets: table.dataSets.map((d) => d.id) },
    params: {},
  }
  const store = new DocumentStore(createProject('T', new Date('2026-01-01T00:00:00Z')))
  store.dispatch([
    { type: 'node.add', node: table },
    { type: 'node.add', node: analysis },
  ])
  const node = () => store.getState().nodes[analysis.id] as AnalysisNode
  return { store, analysis, node }
}

describe('method history', () => {
  it('records a change with the change itself, in one undo step', () => {
    const { store, analysis, node } = storeWithAnalysis()
    store.dispatch([
      { type: 'analysis.setParams', id: analysis.id, params: { tails: 'one' } },
      { type: 'analysis.recordChange', id: analysis.id, change: { ...change(1), reason: 'typo' } },
    ])
    expect(node().history).toEqual([{ ...change(1), reason: 'typo' }])
    expect(node().params).toEqual({ tails: 'one' })
    store.undo()
    expect(node().history).toBeUndefined()
    expect(node().params).toEqual({})
  })

  it(`keeps the last ${MAX_METHOD_HISTORY} and counts the earlier ones`, () => {
    const { store, analysis, node } = storeWithAnalysis()
    for (let k = 0; k < MAX_METHOD_HISTORY + 3; k++)
      store.dispatch({ type: 'analysis.recordChange', id: analysis.id, change: change(k) })
    expect(node().history).toHaveLength(MAX_METHOD_HISTORY)
    expect(node().historyEarlier).toBe(3)
    expect(node().history![0]!.changes[0]).toMatch(/\(3\)$/)
  })

  it('refuses a change that is not one', () => {
    const { store, analysis } = storeWithAnalysis()
    expect(() =>
      store.dispatch({
        type: 'analysis.recordChange',
        id: analysis.id,
        change: { ...change(1), afterResults: 'yes' } as unknown as MethodChange,
      }),
    ).toThrow()
  })
})

const job = (source: AnalysisJob['context']['source'], table: DataTable): AnalysisJob => ({
  analysisId: 'ttest',
  params: {},
  input: normalizeTable(table),
  context: { tableKind: table.tableKind, xTitle: null, source },
})

const okResult: AnalysisResult = {
  status: 'ok',
  diagnostics: [],
  sheets: [],
  values: {},
  comparisons: [],
  outputs: {},
}

describe('notes on analyses of processed values (S13, S20)', () => {
  const table = createTable({ tableKind: 'column', rows: 3, columns: 2 })
  table.dataSets[0]!.subcolumns[0]!.values = [100, 100, 100]
  table.dataSets[1]!.subcolumns[0]!.values = [80, 120, 95]

  it('outliers removed before the analysis: say so, and to report both', () => {
    const r = withSourceNotes(
      okResult,
      job(
        { analysisId: 'identifyOutliers', name: 'Outliers', note: '2 values were removed' },
        table,
      ),
    )
    expect(r.status).toBe('warning')
    expect(r.diagnostics[0]!.message).toMatch(
      /^2 values were removed in “Outliers” before this analysis\. .*with and without them/,
    )
  })

  it('a group normalized to itself has no variation: compare with 100 by a one-sample test', () => {
    const r = withSourceNotes(okResult, job({ analysisId: 'normalize', name: 'Normalized' }, table))
    expect(r.diagnostics).toHaveLength(1)
    expect(r.diagnostics[0]!.message).toMatch(/no variation \(every value is 100\).*one-sample t/)
  })

  it('nothing to say otherwise', () => {
    expect(withSourceNotes(okResult, job(undefined, table))).toBe(okResult)
    expect(withSourceNotes(okResult, job({ analysisId: 'transform', name: 'T' }, table))).toBe(
      okResult,
    )
  })
})

describe('compared at each X (byX)', () => {
  /** XY: X 0, 0, 24 (two rows at 0); two data sets of two replicates. */
  function xy(): DataTable {
    const t = createTable({
      tableKind: 'xy',
      rows: 3,
      columns: 2,
      yFormat: { type: 'replicates', count: 2 },
    })
    t.x!.subcolumns[0]!.values = [0, 0, 24]
    t.dataSets[0]!.subcolumns[0]!.values = [1, 2, 3]
    t.dataSets[0]!.subcolumns[1]!.values = [1, null, 4]
    t.dataSets[1]!.subcolumns[0]!.values = [5, 6, 7]
    t.dataSets[1]!.subcolumns[1]!.values = [5, 6, 8]
    return t
  }

  it('a grouped table: a row per X, its values side by side', () => {
    const m = modifyInput(normalizeTable(xy()), { byX: true }, 'xy')
    if ('error' in m) throw new Error(m.error)
    expect(m.tableKind).toBe('grouped')
    const [a, b] = m.input
    expect(a!.rowCount).toBe(2)
    expect(a!.rowTitles).toEqual(['0', '24'])
    const rows = (d: typeof a) =>
      d!.data.shape === 'replicates'
        ? Array.from({ length: d!.rowCount }, (_, r) =>
            d!.data.shape === 'replicates'
              ? d!.data.reps.map((rep) => rep[r]!).filter((v) => !Number.isNaN(v))
              : [],
          )
        : []
    expect(rows(a).map((r) => [...r].sort())).toEqual([
      [1, 1, 2],
      [3, 4],
    ])
    expect(rows(b).map((r) => [...r].sort())).toEqual([
      [5, 5, 6, 6],
      [7, 8],
    ])
  })

  it('needs X values', () => {
    const t = createTable({ tableKind: 'column', rows: 2, columns: 2 })
    expect(modifyInput(normalizeTable(t), { byX: true }, 'column')).toEqual({
      error: 'Comparing at each X needs a table with X values.',
    })
  })

  it('runs through the engine as a grouped table', async () => {
    const seen: string[] = []
    const def: AnalysisDef<Record<string, never>> = {
      id: 'kind',
      version: 1,
      title: 'Kind',
      category: 'Test',
      description: 'Its table kind.',
      form: [],
      accepts: ['grouped'],
      inputs: { min: 1, max: 8 },
      params: z.object({}),
      run(input, _p, context) {
        seen.push(`${context?.tableKind} ${input.map((d) => d.rowCount).join(',')}`)
        return okResult
      },
    }
    const registry: AnalysisRegistry = {
      engineVersion: 'test',
      get: (id) => (id === 'kind' ? (def as AnalysisDef<unknown>) : undefined),
    }
    const t = xy()
    const store = new DocumentStore(createProject())
    store.dispatch([
      { type: 'node.add', node: t },
      {
        type: 'node.add',
        node: {
          kind: 'analysis',
          id: newNodeId(),
          name: 'k',
          analysisId: 'kind',
          pluginVersion: 1,
          input: { source: t.id, dataSets: t.dataSets.map((d) => d.id), byX: true },
          params: {},
        },
      },
    ])
    const engine = await startedEngine(store, registry)
    engine.stop()
    expect(seen).toEqual(['grouped 2,2'])
  })
})
