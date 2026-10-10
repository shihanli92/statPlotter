import { describe, expect, it } from 'vitest'
import {
  type AnalysisNode,
  ColumnId,
  createProject,
  createTable,
  findCycle,
  type GraphNode,
  type MigrationNote,
  migrateProject,
  NodeId,
  newNodeId,
  newSeriesId,
  type Project,
  parseProject,
  projectIssues,
  UnsupportedVersionError,
} from '../src/index.ts'

function analysisOf(source: NodeId): AnalysisNode {
  return {
    kind: 'analysis',
    id: newNodeId(),
    name: 't test',
    analysisId: 'ttest',
    pluginVersion: 1,
    input: { source, dataSets: [] },
    params: {},
  }
}

function graphOf(table: NodeId): GraphNode {
  return {
    kind: 'graph',
    id: newNodeId(),
    name: 'Graph',
    frame: 'category',
    look: 'column.scatter',
    layers: [{ id: 'points', geom: 'points', stat: { kind: 'identity' } }],
    seriesSource: { table, include: 'all' },
    seriesOverrides: {},
    size: { plotWidth: 144, plotHeight: 180 },
    axes: {
      x: { type: 'categorical', title: null, labels: 'dataSetTitles', rotation: 0 },
      y: {
        type: 'continuous',
        title: null,
        scale: 'linear',
        range: 'auto',
        ticks: 'auto',
        format: { mode: 'auto' },
        frame: 'plain',
        breaks: [],
      },
    },
    annotations: [],
    legend: { show: false, position: 'right' },
    title: null,
    style: {},
  }
}

function withNodes(...nodes: Project['nodes'][NodeId][]): Project {
  const p = createProject('Test', new Date('2026-09-28T00:00:00Z'))
  for (const n of nodes) {
    p.nodes[n.id] = n
    p.order.push(n.id)
  }
  return p
}

/** Round-trips through JSON, as a saved file would. */
const reload = (p: Project) => parseProject(JSON.parse(JSON.stringify(p)))

const issues = (p: Project) => {
  try {
    reload(p)
    return []
  } catch (e) {
    return (e as { issues: { message: string }[] }).issues.map((i) => i.message)
  }
}

describe('project', () => {
  it('round-trips a table → analysis → graph family through JSON', () => {
    const table = createTable()
    const analysis = analysisOf(table.id)
    const graph = graphOf(table.id)
    graph.annotations.push({
      type: 'bracket',
      id: 'b1' as never,
      a: table.dataSets[0]!.id,
      b: table.dataSets[1]!.id,
      label: { source: 'analysis', analysis: analysis.id, comparison: 'x', show: 'stars' },
      level: 'auto',
    })
    const p = withNodes(table, analysis, graph)
    expect(reload(p)).toEqual(p)
  })

  it('rejects references to missing nodes', () => {
    const p = withNodes(analysisOf('ghost' as NodeId))
    expect(issues(p)).toContain('references missing node ghost')
  })

  it('rejects references to the wrong kind of node', () => {
    const table = createTable()
    const graph = graphOf(table.id)
    const graphOfGraph = graphOf(graph.id)
    expect(issues(withNodes(table, graph, graphOfGraph))).toContain(
      'must reference a table or analysis, not a graph',
    )
  })

  it('accepts graphs of an analysis (its result table)', () => {
    const table = createTable()
    const analysis = analysisOf(table.id)
    const graph = graphOf(analysis.id)
    expect(issues(withNodes(table, analysis, graph))).toEqual([])
  })

  it('rejects an order that does not list exactly the nodes', () => {
    const table = createTable()
    const p = withNodes(table)
    p.order = []
    expect(issues(p)).toContain(`node ${table.id} missing from order`)
    p.order = [table.id, table.id]
    expect(issues(p)).toContain('duplicate ids in order')
  })

  it('detects dependency cycles', () => {
    const a = analysisOf('b' as NodeId)
    const b = analysisOf(a.id)
    a.input.source = b.id
    const p = withNodes(a, b)
    expect(findCycle(p.nodes)).toHaveLength(2)
    expect(issues(p).some((m) => m.startsWith('dependency cycle'))).toBe(true)
  })

  it('ids are lowercase letters and digits only', () => {
    for (const bad of ['__proto__', 'Abc', 'a-b', 'a.b', '', 'toString']) {
      expect(NodeId.safeParse(bad).success).toBe(false)
      expect(ColumnId.safeParse(bad).success).toBe(false)
    }
    expect(NodeId.safeParse(newNodeId()).success).toBe(true)
    const table = createTable()
    table.dataSets[0]!.id = '__proto__' as never
    expect(issues(withNodes(table))).toContain('ids are lowercase letters and digits')
  })

  it('Object.prototype members are not nodes', () => {
    const table = createTable()
    const p = withNodes(table)
    p.order = [table.id, 'constructor' as NodeId]
    expect(issues(p)).toContain('order lists missing node constructor')
    expect(issues(withNodes(analysisOf('constructor' as NodeId)))).toContain(
      'references missing node constructor',
    )
    const graph = graphOf(table.id)
    graph.layers.push({
      id: 'curves',
      geom: 'line',
      stat: { kind: 'identity' },
      data: {
        from: 'outputs',
        series: [{ id: newSeriesId(), ref: { node: 'constructor' as NodeId, key: 'k' } }],
      },
    })
    expect(issues(withNodes(table, graph))).toContain('references missing node constructor')
    expect(projectIssues(withNodes(table))).toEqual([])
  })

  it('layer ids are unique, and attached layers and shared data name layers of the graph', () => {
    const table = createTable()
    const graph = graphOf(table.id)
    graph.layers.push(
      { id: 'points', geom: 'points', stat: { kind: 'identity' } },
      { id: 'error', geom: 'errorbar', stat: { kind: 'summary', center: 'mean' }, on: 'bars' },
      { id: 'band', geom: 'band', stat: { kind: 'identity' }, data: { from: 'layer', layer: 'x' } },
    )
    const found = issues(withNodes(table, graph))
    expect(found).toContain('layer id points repeated')
    expect(found).toContain('no host layer bars')
    expect(found).toContain('no layer x')
  })

  it('invalid tables inside a project are reported', () => {
    const table = createTable()
    table.dataSets[0]!.subcolumns[0]!.values.pop()
    expect(issues(withNodes(table))).toContain('expected 10 values, got 9')
  })
})

describe('migrations', () => {
  it('rejects files from a newer app version', () => {
    expect(() => migrateProject({ schemaVersion: 99 })).toThrow(UnsupportedVersionError)
    expect(() => migrateProject({ schemaVersion: 99 })).toThrow(/newer version/)
  })

  it('rejects files without a version', () => {
    expect(() => migrateProject({})).toThrow(UnsupportedVersionError)
    expect(() => migrateProject(null)).toThrow(UnsupportedVersionError)
  })

  it('passes current-version files through unchanged', () => {
    const p = createProject()
    expect(p.schemaVersion).toBe(2)
    expect(migrateProject(p)).toBe(p)
  })

  it('says which version wrote a newer file and which this one reads', () => {
    expect(() => migrateProject({ schemaVersion: 3 })).toThrow(
      'This project was saved by a newer version of the app (file format v3; this version reads up to v2). Open it in the newer version.',
    )
  })

  it('migrates a v1 graph to a frame and layers, with notes', () => {
    const table = createTable()
    const v1 = {
      kind: 'graph',
      id: 'g1',
      name: 'Old',
      graphType: 'column.bar',
      seriesSource: { table: table.id, include: 'all' },
      seriesOverrides: {
        [table.dataSets[0]!.id]: { color: { rgb: '#ff0000' }, bar: { width: 0.4 } },
      },
      extraSeries: [],
      size: { plotWidth: 144, plotHeight: 180 },
      axes: graphOf(table.id).axes,
      annotations: [],
      legend: { show: false, position: 'right' },
      title: null,
      style: { arrangement: 'stacked' },
    }
    const raw = {
      ...createProject(),
      schemaVersion: 1,
      nodes: { [table.id]: table, g1: v1 },
      order: [table.id, 'g1'],
    }
    const notes: MigrationNote[] = []
    const p = parseProject(JSON.parse(JSON.stringify(raw)), notes)
    expect(p.schemaVersion).toBe(2)
    const g = p.nodes['g1' as NodeId] as GraphNode
    expect(g).toMatchObject({ frame: 'category', look: 'column.bar', drawOrder: 'series' })
    expect(g.layers.map((l) => l.id)).toEqual(['bars', 'points', 'error'])
    expect(g.seriesOverrides).toEqual({ [table.dataSets[0]!.id]: { color: { rgb: '#ff0000' } } })
    expect(g.layers[0]!.series).toEqual({ [table.dataSets[0]!.id]: { style: { width: 0.4 } } })
    expect(notes).toEqual([
      {
        kind: 'dropped',
        text: 'style.arrangement / stack: not used by column.bar graphs',
        graph: 'Old',
      },
    ])
  })

  it('reports an invalid v1 graph where it is', () => {
    const raw = {
      ...createProject(),
      schemaVersion: 1,
      nodes: { g1: { kind: 'graph', id: 'g1', graphType: 'nope' } },
      order: ['g1'],
    }
    try {
      parseProject(raw)
      expect.unreachable()
    } catch (e) {
      const paths = (e as { issues: { path: PropertyKey[] }[] }).issues.map((i) => i.path.join('.'))
      expect(paths).toContain('nodes.g1.graphType')
    }
  })
})
