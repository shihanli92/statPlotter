import { createGraphFor } from '@ps/graph'
import {
  createInfoSheet,
  createProject,
  createTable,
  type DocNode,
  type GraphNode,
  newNodeId,
  type Project,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { emptyGraphTable } from '../src/graph/emptyGraph.ts'
import { plotFunctionNodes } from '../src/graph/plotFunction.ts'
import { kindSections, shownSections } from '../src/organise/navModel.ts'
import { sampleTable } from '../src/samples.ts'
import { hasGraphOf, newGraphName, sampleByDefault } from '../src/util.ts'

// Roadmap 43, part B: a first session's defaults — sample data in a blank project's first table,
// a table's second graph named "Data 1 (2)", the note on a graph with no values yet, and the
// navigator's sections of a new project.

const projectOf = (...nodes: DocNode[]): Project => {
  const p = createProject()
  for (const n of nodes) {
    p.nodes[n.id] = n
    p.order.push(n.id)
  }
  return p
}

describe('a first session', () => {
  it('ticks “Start with sample data” only while the project has no data tables', () => {
    expect(sampleByDefault(projectOf())).toBe(true)
    // An info sheet is not a data table.
    expect(sampleByDefault(projectOf(createInfoSheet(newNodeId(), 'Info')))).toBe(true)
    expect(sampleByDefault(projectOf(createTable({ name: 'Data 1' })))).toBe(false)
  })

  it('names a table’s first graph after it, the next ones “Data 1 (2)”, “Data 1 (3)”…', () => {
    const table = createTable({ name: 'Data 1' })
    let p = projectOf(table)
    expect(hasGraphOf(p, table.id)).toBe(false)
    expect(newGraphName(p, table.name)).toBe('Data 1')
    p = projectOf(table, createGraphFor(table, 'Data 1'))
    expect(hasGraphOf(p, table.id)).toBe(true)
    expect(newGraphName(p, table.name)).toBe('Data 1 (2)')
    p = projectOf(table, createGraphFor(table, 'Data 1'), createGraphFor(table, 'Data 1 (2)'))
    expect(newGraphName(p, table.name)).toBe('Data 1 (3)')
    // A table's name is not a graph's: another table "Data 1" leaves the graph name free.
    expect(newGraphName(projectOf(table), 'Data 2')).toBe('Data 2')
  })

  it('finds the table an empty graph waits for, and nothing once it has a value', () => {
    const empty = createTable({ name: 'Data 1' })
    const graph = createGraphFor(empty, 'Data 1')
    expect(emptyGraphTable(projectOf(empty, graph), graph)?.id).toBe(empty.id)

    // One value is enough.
    const one = structuredClone(empty)
    one.dataSets[1]!.subcolumns[0]!.values[4] = 2.5
    expect(emptyGraphTable(projectOf(one, graph), graph)).toBeUndefined()
    // Values entered but all excluded are values too.
    const excluded = structuredClone(one)
    excluded.dataSets[1]!.subcolumns[0]!.excluded = Array.from(
      { length: one.rowCount },
      (_, r) => r === 4,
    )
    expect(emptyGraphTable(projectOf(excluded, graph), graph)).toBeUndefined()

    // Every kind's sample data has values; every kind's empty table has none.
    for (const kind of [
      'column',
      'xy',
      'grouped',
      'contingency',
      'survival',
      'multipleVariables',
      'nested',
      'partsOfWhole',
    ] as const) {
      const sample = sampleTable(kind, 'S')
      const g = createGraphFor(sample, 'S')
      expect(emptyGraphTable(projectOf(sample, g), g), kind).toBeUndefined()
      const blank = createTable({ name: 'E', tableKind: kind })
      const b = createGraphFor(blank, 'E')
      expect(emptyGraphTable(projectOf(blank, b), b)?.id, kind).toBe(blank.id)
    }
  })

  it('says nothing on a function plot, a graph of no data sets or of a missing table', () => {
    const fn = plotFunctionNodes({ nodes: {} })
    expect(emptyGraphTable(projectOf(fn.table, fn.graph), fn.graph)).toBeUndefined()

    const table = createTable({ name: 'Data 1' })
    const graph = createGraphFor(table, 'Data 1')
    const none: GraphNode = { ...graph, seriesSource: { ...graph.seriesSource, include: [] } }
    expect(emptyGraphTable(projectOf(table, none), none)).toBeUndefined()

    const orphan: GraphNode = {
      ...graph,
      seriesSource: { ...graph.seriesSource, table: newNodeId() },
    }
    expect(emptyGraphTable(projectOf(table, orphan), orphan)).toBeUndefined()
  })

  it('shows Data Tables always and the other sections once they hold something', () => {
    const titles = (p: Project) => shownSections(kindSections(p, new Set())).map((s) => s.title)
    expect(titles(projectOf())).toEqual(['Data Tables'])
    const table = createTable({ name: 'Data 1' })
    expect(titles(projectOf(table, createGraphFor(table, 'Data 1')))).toEqual([
      'Data Tables',
      'Graphs',
    ])
    expect(titles(projectOf(createInfoSheet(newNodeId(), 'Info')))).toEqual([
      'Data Tables',
      'Info sheets',
    ])
    // A folder shows in every section (to drag sheets into), so they all show.
    const p = projectOf()
    p.folders = [{ id: 'f' as never, name: 'Experiment', members: [] }]
    expect(titles(p)).toEqual(['Data Tables', 'Info sheets', 'Results', 'Graphs', 'Layouts'])
  })
})
