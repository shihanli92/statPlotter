import { registry } from '@ps/analyses'
import { DocumentStore } from '@ps/engine'
import { createGraphFor, resolveSeries } from '@ps/graph'
import {
  type AnalysisNode,
  type CellColumn,
  createProject,
  createTable,
  type DataSetKey,
  type NodeId,
  newNodeId,
  sourceTable,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { startedEngine } from '../../engine/test/helpers.ts'

// Real table-producing plugins feeding chained analyses and graphs, and the nested tests on
// nested tables (Phase 13).

const values = (c: CellColumn | undefined) => (c?.type === 'number' ? c.values : [])

function analysis(
  analysisId: string,
  source: NodeId,
  dataSets: DataSetKey[],
  params: object = {},
): AnalysisNode {
  return {
    kind: 'analysis',
    id: newNodeId(),
    name: analysisId,
    analysisId,
    pluginVersion: registry.get(analysisId)!.version,
    input: { source, dataSets },
    params,
  }
}

describe('result tables from real plugins', () => {
  it('a t test and a graph of a log transform follow edits to the source table', async () => {
    const table = createTable({ rows: 3, columns: 2 })
    const cells = [
      [1, 10, 100],
      [1000, 10000, 100],
    ]
    table.dataSets.forEach((d, i) => {
      d.subcolumns[0] = { type: 'number', values: cells[i]! }
    })
    const keys = table.dataSets.map((d) => d.id as DataSetKey)
    const store = new DocumentStore(createProject('P', new Date('2026-01-01T00:00:00Z')))
    store.dispatch({ type: 'node.add', node: table })
    const log = analysis('transform', table.id, keys, { y: 'log10' })
    store.dispatch({ type: 'node.add', node: log })
    // The transform keeps the source keys, so the t test names them on the result table.
    const t = analysis('ttest', log.id, keys)
    store.dispatch({ type: 'node.add', node: t })

    const engine = await startedEngine(store, registry)
    const produced = engine.latest(log.id)!.table!
    expect(produced.dataSets.map((d) => values(d.subcolumns[0]))).toEqual([
      [0, 1, 2],
      [3, 4, 2],
    ])
    expect(engine.get(t.id)?.status).toBe('ready')
    const p0 = engine.latest(t.id)!.comparisons[0]!.p

    // Same numbers typed into a plain table give the same P.
    const direct = createTable({ rows: 3, columns: 2 })
    direct.dataSets.forEach((d, i) => {
      d.subcolumns[0] = { type: 'number', values: values(produced.dataSets[i]!.subcolumns[0]) }
    })
    const store2 = new DocumentStore(createProject('Q', new Date('2026-01-01T00:00:00Z')))
    store2.dispatch({ type: 'node.add', node: direct })
    const t2 = analysis(
      'ttest',
      direct.id,
      direct.dataSets.map((d) => d.id as DataSetKey),
    )
    store2.dispatch({ type: 'node.add', node: t2 })
    const engine2 = await startedEngine(store2, registry)
    expect(p0).toBeCloseTo(engine2.latest(t2.id)!.comparisons[0]!.p, 12)

    // A graph of the result table draws the transformed values.
    const lookup = (id: NodeId) => engine.latest(id)
    const source = sourceTable(store.getState(), log.id, lookup)!
    const graph = createGraphFor(source, 'Log graph')
    expect(graph.seriesSource.table).toBe(log.id)
    store.dispatch({ type: 'node.add', node: graph })
    const series = () => resolveSeries(store.getState(), graph, lookup)
    expect(series().map((s) => s.title)).toEqual(table.dataSets.map((d) => d.title))

    // Editing the source reruns the transform and the t test.
    store.dispatch({
      type: 'table.setCells',
      table: table.id,
      edits: [{ col: table.dataSets[0]!.id, sub: 0, row: 0, value: 1000 }],
    })
    await engine.idle()
    expect(values(engine.latest(log.id)!.table!.dataSets[0]!.subcolumns[0])).toEqual([3, 1, 2])
    expect(engine.latest(t.id)!.comparisons[0]!.p).not.toBeCloseTo(p0, 6)
    expect(series()).toHaveLength(2)
  })

  it('a nested t test runs on a nested table', async () => {
    const table = createTable({
      tableKind: 'nested',
      rows: 3,
      columns: 2,
      yFormat: { type: 'replicates', count: 3 },
    })
    // Two groups × three subjects × three measurements; group B is shifted up.
    table.dataSets.forEach((d, g) => {
      d.subcolumns = [0, 1, 2].map((s) => ({
        type: 'number' as const,
        values: [0, 1, 2].map((r) => 10 + 5 * g + s + 0.3 * r + 0.1 * ((s * 7 + r * 3) % 5)),
      }))
    })
    const store = new DocumentStore(createProject('N', new Date('2026-01-01T00:00:00Z')))
    store.dispatch({ type: 'node.add', node: table })
    const nested = analysis(
      'nestedT',
      table.id,
      table.dataSets.map((d) => d.id as DataSetKey),
    )
    store.dispatch({ type: 'node.add', node: nested })
    const engine = await startedEngine(store, registry)
    const state = engine.get(nested.id)
    expect(state?.status).toBe('ready')
    const r = engine.latest(nested.id)!
    expect(r.status).not.toBe('error')
    expect(r.comparisons[0]!.p).toBeGreaterThan(0)
    expect(r.comparisons[0]!.p).toBeLessThan(0.05)
  })
})
