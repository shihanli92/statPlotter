import { DocumentStore } from '@ps/engine'
import { createGraphFor, layoutGraph, type Prim, themeFor } from '@ps/graph'
import { createTable, type GraphNode, type Project } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { flatten, fonts, projectOf } from '../../graph/test/helpers.ts'
import { differsAcross, resolvedStyles, styleCommands } from '../src/graph/inspector/layers.ts'

function setup(kind: 'column' | 'grouped' = 'column') {
  const table = createTable({ tableKind: kind, columns: 3, rows: 3 })
  table.dataSets.forEach((d, i) => {
    d.subcolumns[0]!.values = [1 + i, 4 + i, 9 + i]
  })
  const graph = createGraphFor(table)
  const project = projectOf(table, graph)
  const keys = table.dataSets.map((d) => d.id as string)
  return { project, graph, keys }
}

/** Each data set's look in a layer, as the panels resolve it. */
const stylesOf = (graph: GraphNode, keys: string[], layer = 'points') =>
  resolvedStyles(themeFor(undefined), graph, graph.layers.find((l) => l.id === layer)!, keys)

describe('"All data sets" shows values that differ as mixed', () => {
  it('a field is mixed only where data sets differ; setting it for all makes it common', () => {
    const { project, graph, keys } = setup()
    const store = new DocumentStore(project)
    const g = () => store.getState().nodes[graph.id] as GraphNode
    const points = () => g().layers.find((l) => l.id === 'points')!
    store.dispatch(styleCommands(g(), points(), keys[1]!, [['size', 11]]))
    store.dispatch({
      type: 'node.set',
      id: graph.id,
      path: ['layers', { id: 'points' }, 'series', keys[2]!, 'hide'],
      value: true,
    })
    let styles = stylesOf(g(), keys)
    expect(differsAcross(styles, (s) => s.points.size)).toBe(true)
    expect(differsAcross(styles, (s) => s.points.shape)).toBe(false)
    expect(differsAcross(styles, (s) => s.error.capWidth)).toBe(false)
    // Objects compare as data (a hollow fill vs a solid one).
    store.dispatch(styleCommands(g(), points(), keys[0]!, [['fill', { type: 'none' }]]))
    styles = stylesOf(g(), keys)
    expect(differsAcross(styles, (s) => s.points.fill.type === 'none')).toBe(true)

    // Setting the field with "All data sets" applies to every data set.
    store.dispatch(styleCommands(g(), points(), null, [['size', 7]]))
    styles = stylesOf(g(), keys)
    expect(styles.map((s) => s.points.size)).toEqual([7, 7, 7])
    expect(differsAcross(styles, (s) => s.points.size)).toBe(false)
    // A data set's own entry keeps what wasn't set for all (its fill, its hidden points).
    expect(points().series?.[keys[1]!]).toBeUndefined()
    expect(points().series?.[keys[0]!]).toEqual({ style: { fill: { type: 'none' } } })
    expect(points().series?.[keys[2]!]).toEqual({ hide: true })
  })

  it('one data set is never mixed', () => {
    const { graph, keys } = setup()
    expect(differsAcross(stylesOf(graph, keys).slice(0, 1), (s) => s.color)).toBe(false)
  })
})

const lineLength = (graph: GraphNode, project: Project, id: string) => {
  const n = flatten(layoutGraph({ project, graph, fonts }).root).find((x) => x.id === id)
  const p = n?.prim as Extract<Prim, { type: 'line' }>
  return p.x2 - p.x1
}

describe('centre line length', () => {
  it('defaults to a short line: 0.3 of a column, 0.45 of a grouped data set’s slot', () => {
    const { project, graph, keys } = setup()
    const band = graph.size.plotWidth / 3
    expect(lineLength(graph, project, `series/${keys[0]}/center`)).toBeCloseTo(0.3 * band, 6)
    const grouped = setup('grouped')
    const g: GraphNode = {
      ...grouped.graph,
      look: 'grouped.scatter',
      layers: [{ id: 'center', geom: 'center', stat: { kind: 'summary', center: 'mean' } }],
    }
    const sub = ((g.size.plotWidth / 3) * 0.8) / 3
    expect(lineLength(g, grouped.project, `series/${grouped.keys[0]}/center/0`)).toBeCloseTo(
      0.45 * sub,
      6,
    )
  })

  it('follows the centre layer’s width for one data set or all of them', () => {
    const { project, graph, keys } = setup()
    const band = graph.size.plotWidth / 3
    const store = new DocumentStore(project)
    const g = () => store.getState().nodes[graph.id] as GraphNode
    const center = () => g().layers.find((l) => l.id === 'center')!
    store.dispatch(styleCommands(g(), center(), null, [['width', 0.6]]))
    store.dispatch(styleCommands(g(), center(), keys[1]!, [['width', 0.1]]))
    const p = store.getState()
    expect(lineLength(g(), p, `series/${keys[0]}/center`)).toBeCloseTo(0.6 * band, 6)
    expect(lineLength(g(), p, `series/${keys[1]}/center`)).toBeCloseTo(0.1 * band, 6)
  })
})
