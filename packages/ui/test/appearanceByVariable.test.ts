import { DocumentStore } from '@ps/engine'
import { layoutGraph, MISSING_POINT_COLOR, presetGraph, type Scene, themeFor } from '@ps/graph'
import { readProjectFile, writeProjectFile } from '@ps/io'
import {
  type ColumnId,
  createProject,
  type GraphNode,
  levelKey,
  type NodeId,
  parseProject,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { appearanceTable, byId, flatten, fonts, prim } from '../../graph/test/helpers.ts'
import {
  appearanceAllowed,
  appearanceVariables,
  type BuilderAction,
  type BuilderState,
  builderChange,
  builderIssues,
  builderReducer,
  initialBuilder,
} from '../src/graph/builder/builderState.ts'

// Variables mapped to appearance (roadmap 34b): the builder's Colour, Shape, Size and Label rows
// (what the matrix allows for the layers chosen, the frame following a text colour variable), and
// graphs following table edits, undo and redo, and a save and reopen.

const table = appearanceTable()
const run = (actions: BuilderAction[], from: BuilderState = initialBuilder(table)) =>
  actions.reduce((s, a) => builderReducer(table, s, a), from)
const byGroup: BuilderAction[] = [
  { type: 'map', field: 'x', key: 'a' },
  { type: 'map', field: 'y', key: 'c' },
]

describe('the builder’s Colour, Shape, Size and Label rows', () => {
  it('shape, size and labels keep a category graph; a text colour groups it, a number doesn’t', () => {
    const s = run([
      ...byGroup,
      { type: 'appearance', field: 'shape', key: 'b' },
      { type: 'appearance', field: 'size', key: 'd' },
      { type: 'appearance', field: 'label', key: 'f' },
    ])
    expect(s.frame).toBe('category')
    expect(s.mapping).toEqual({ x: 'a', y: 'c', shape: 'b', size: 'd', label: 'f' })
    expect(builderIssues(table, s)).toEqual([])
    // A number colour: still categories, on viridis with a colour bar.
    const n = run([{ type: 'appearance', field: 'color', key: 'e' }], s)
    expect(n.frame).toBe('category')
    expect(n.mapping?.color).toBe('e')
    expect(n.scales?.color).toEqual({ colors: 'viridis', bar: { show: true } })
    // A text colour: groups within the categories; the other mappings stay.
    const g = run([{ type: 'appearance', field: 'color', key: 'b' }], s)
    expect(g.frame).toBe('grouped')
    expect(g.mapping).toEqual({ x: 'a', y: 'c', color: 'b', shape: 'b', size: 'd', label: 'f' })
    // Unmapped: back to the categories.
    const none = run([{ type: 'appearance', field: 'color' }], g)
    expect(none.frame).toBe('category')
    expect(builderChange(none).mapping).toEqual({
      x: 'a',
      y: 'c',
      shape: 'b',
      size: 'd',
      label: 'f',
    })
  })

  it('XY graphs map them on their points; turning to categories takes them along', () => {
    const s = run([
      { type: 'map', field: 'x', key: 'c' },
      { type: 'map', field: 'y', key: 'd' },
      { type: 'appearance', field: 'shape', key: 'b' },
      { type: 'appearance', field: 'label', key: 'a' },
      { type: 'appearance', field: 'color', key: 'e' },
    ])
    expect(s.frame).toBe('xy')
    expect(appearanceVariables(s)).toEqual({ color: 'e', shape: 'b', label: 'a' })
    expect(s.scales?.color?.colors).toBe('viridis')
    const cats = run([{ type: 'map', field: 'x', key: 'a' }], s)
    expect(cats.frame).toBe('category')
    expect(cats.mapping).toMatchObject({ x: 'a', shape: 'b', label: 'a' })
  })

  it('offers what the matrix allows: types, points of every row, not text × text', () => {
    const s = run(byGroup)
    expect(appearanceAllowed(table, s, 'shape', 'b').allowed).toBe(true)
    expect(appearanceAllowed(table, s, 'shape', 'c').allowed).toBe(false)
    expect(appearanceAllowed(table, s, 'size', 'b').allowed).toBe(false)
    expect(appearanceAllowed(table, s, 'color', 'a')).toEqual({
      allowed: false,
      reason: 'on an axis',
    })
    const bars = run([{ type: 'preset', id: 'bars' }], s)
    expect(appearanceAllowed(table, bars, 'size', 'd')).toEqual({
      allowed: false,
      reason: 'needs points of every row',
    })
    expect(appearanceAllowed(table, bars, 'color', 'b').allowed).toBe(true)
    const tt = run([{ type: 'map', field: 'y', key: 'b' }], s)
    expect(appearanceAllowed(table, tt, 'shape', 'f').allowed).toBe(false)
  })
})

/** A graph of Score by Group shaped by Sex and coloured by BMI, in a store. */
function setup() {
  const graph: GraphNode = {
    ...presetGraph(table, 'groupBoxPoints', 'By group', {
      mapping: { x: 'a', y: 'c', shape: 'f', color: 'e' },
    }),
    id: 'g1' as NodeId,
  }
  const project = createProject()
  project.nodes[table.id] = structuredClone(table)
  project.nodes[graph.id] = graph
  project.order.push(table.id, graph.id)
  const store = new DocumentStore(project)
  const g = () => store.getState().nodes[graph.id] as GraphNode
  const scene = () => layoutGraph({ project: store.getState(), graph: g(), fonts })
  const setText = (col: string, row: number, value: string | null) =>
    store.dispatch({
      type: 'table.setText',
      table: table.id,
      edits: [{ col: col as ColumnId, row, value }],
    })
  return { store, g, scene, setText }
}
const symbol = (s: Scene, row: number, level: string) =>
  prim(byId(s, `series/${levelKey(level)}/point/${row}`), 'symbol')
/** A legend's entry labels, in the order they are drawn. */
const legendLabels = (s: Scene, prefix: string) =>
  flatten(s.root)
    .filter((n) => new RegExp(`^legend/aes/${prefix}/\\d+/label$`).test(n.id))
    .map((n) =>
      prim(n, 'text')
        .layout.runs.map((r) => r.text)
        .join(''),
    )

describe('graphs with variables mapped to appearance follow the table', () => {
  it('a level renamed or new is drawn in its symbol, with the legend; undo and redo', () => {
    const { store, scene, setText } = setup()
    expect(legendLabels(scene(), 'shape')).toEqual(['South', 'North'])
    setText('f', 0, 'West')
    // Row 0 now has the first level of the table: West takes the first symbol, North the next.
    expect(legendLabels(scene(), 'shape')).toEqual(['West', 'North', 'South'])
    expect(symbol(scene(), 0, 'Low').shape).toBe('circle')
    store.undo()
    expect(legendLabels(scene(), 'shape')).toEqual(['South', 'North'])
    store.redo()
    expect(legendLabels(scene(), 'shape')).toEqual(['West', 'North', 'South'])
  })

  it('a value edited recolours its point; a value cleared draws it in the missing colour', () => {
    const { store, scene } = setup()
    const before = symbol(scene(), 1, 'High').fill?.color
    store.dispatch({
      type: 'table.setCells',
      table: table.id,
      edits: [{ col: 'e' as ColumnId, sub: 0, row: 1, value: null }],
    })
    expect(symbol(scene(), 1, 'High').fill?.color).toBe(MISSING_POINT_COLOR)
    store.undo()
    expect(symbol(scene(), 1, 'High').fill?.color).toBe(before)
  })

  it('Format edits (a level’s symbol, the colour map) are undoable and survive a save', () => {
    const { store, g, scene } = setup()
    store.dispatch({
      type: 'node.set',
      id: g().id,
      path: ['scales', 'shape', 'levels', levelKey('North')],
      value: 'diamond',
    })
    expect(symbol(scene(), 1, 'High').shape).toBe('diamond')
    store.dispatch({
      type: 'node.set',
      id: g().id,
      path: ['scales', 'color', 'colors'],
      value: 'magma',
    })
    store.dispatch({ type: 'node.set', id: g().id, path: ['legend', 'reverse'], value: true })
    const bytes = writeProjectFile(store.getState())
    const back = readProjectFile(bytes).project
    expect(parseProject(JSON.parse(JSON.stringify(back)))).toBeTruthy()
    const graph = back.nodes['g1' as NodeId] as GraphNode
    expect(graph.mapping).toEqual({ x: 'a', y: 'c', shape: 'f', color: 'e' })
    expect(graph.scales?.shape?.levels).toEqual({ [levelKey('North')]: 'diamond' })
    const reopened = layoutGraph({ project: back, graph, fonts })
    expect(legendLabels(reopened, 'shape')).toEqual(['North', 'South'])
    store.undo()
    store.undo()
    store.undo()
    expect(symbol(scene(), 1, 'High').shape).not.toBe('diamond')
    expect(themeFor(back.settings.theme).palette.length).toBeGreaterThan(0)
  })
})
