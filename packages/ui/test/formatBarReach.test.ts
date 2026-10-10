import { DocumentStore } from '@ps/engine'
import { layoutGraph, presetGraph, type StylePath } from '@ps/graph'
import {
  createProject,
  createTable,
  type DataTable,
  type GraphNode,
  type Layer,
  type NodeId,
  newSeriesId,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { appearanceTable, fonts, sampleTable } from '../../graph/test/helpers.ts'
import {
  elementTarget,
  fillCommands,
  lineCommands,
  markCommands,
  markValues,
  sharedCapabilities,
} from '../src/formatBar/selectionStyles.ts'
import { elementKey } from '../src/selection/selection.ts'

// Audit 3 (U6): the format bar offers a control only where it changes what is drawn — a data
// set's Colour where its colour reaches the marks (not where its line, error bars or centre line
// draw in their own colour, a pie's slices colour by category or a mapped variable colours the
// points), its Line on the lines a layer draws, and a symbol size not set by a mapped variable.

const RGB = '#13579b'

function setup(table: DataTable, graph: GraphNode) {
  const store = new DocumentStore(createProject())
  store.dispatch([table, graph].map((node) => ({ type: 'node.add' as const, node })))
  const g = () => store.getState().nodes[graph.id] as GraphNode
  const target = (path: StylePath) =>
    elementTarget(store.getState(), g(), path, elementKey(graph.id, path))
  const drawn = () =>
    JSON.stringify(layoutGraph({ project: store.getState(), graph: g(), fonts }).root)
  /** Whether a change, applied, changes the drawing (undone after). */
  const changes = (cmds: ReturnType<typeof fillCommands>) => {
    const before = drawn()
    store.dispatch(cmds)
    const after = drawn()
    store.undo()
    return before !== after
  }
  return { store, g, target, changes }
}

/** Every control a target offers changes the drawing. */
function expectReach(s: ReturnType<typeof setup>, path: StylePath) {
  const t = s.target(path)
  if (t.fill) expect(s.changes(fillCommands([t.fill], { rgb: RGB })), 'fill').toBe(true)
  if (t.line) {
    expect(s.changes(lineCommands([t.line], { color: { rgb: RGB } })), 'line colour').toBe(true)
    expect(s.changes(lineCommands([t.line], { width: 3.5 })), 'line width').toBe(true)
  }
  if (t.mark && !markValues([t.mark])!.sizeMapped)
    expect(s.changes(markCommands([t.mark], { size: 13 })), 'size').toBe(true)
  return t
}

describe('format bar controls reach the drawing', () => {
  it('error bars and centre lines: no Colour (their own black), a Line of their own', () => {
    const table = sampleTable('column')
    const graph = { ...presetGraph(table, 'points'), id: 'g' as NodeId }
    const s = setup(table, graph)
    const ds = table.dataSets[0]!.id
    const lines = graph.layers.filter((x) => x.geom === 'errorbar' || x.geom === 'center')
    expect(lines).toHaveLength(2)
    for (const l of lines) {
      const t = expectReach(s, ['layers', l.id, 'series', ds])
      expect(t.fill, l.geom).toBeUndefined()
      expect(t.line, l.geom).toBeDefined()
      // The whole layer: its line too.
      expect(expectReach(s, ['layers', l.id]).line, l.geom).toBeDefined()
    }
    // Its points still take the data set's colour.
    const points = graph.layers.find((l) => l.geom === 'points')!
    expect(expectReach(s, ['layers', points.id, 'series', ds]).fill).toBeDefined()
  })

  it('a function’s line in its own colour: a Line, no Colour; its identity no Colour either', () => {
    const table = createTable({ tableKind: 'xy', columns: 1, rows: 3 })
    const base = presetGraph(table, 'meanSd')
    const fn = newSeriesId()
    const functions: Layer = {
      id: 'functions',
      geom: 'line',
      stat: { kind: 'identity' },
      data: {
        from: 'functions',
        functions: [
          {
            id: fn,
            equation: 'agonist-response-variable-slope',
            params: { Bottom: 0, Top: 100, LogEC50: -6, HillSlope: 1 },
            from: -9,
            to: -3,
          },
        ],
      },
      series: {
        [fn]: { style: { stroke: { color: { rgb: '#555555' }, width: 1.25, dash: 'dash' } } },
      },
    } as Layer
    const graph = { ...base, id: 'g' as NodeId, layers: [functions, ...base.layers] }
    const s = setup(table, graph)
    const t = expectReach(s, ['layers', 'functions', 'series', fn])
    expect(t.fill).toBeUndefined()
    expect(t.line?.shown?.color).toEqual({ rgb: '#555555' })
    // Its legend entry formats its identity: no colour that would show.
    expect(expectReach(s, ['seriesOverrides', fn]).fill).toBeUndefined()
  })

  it('pie slices colour by category: no Colour for a data set’s slices', () => {
    const table = sampleTable('partsOfWhole')
    const graph = { ...presetGraph(table, 'pie'), id: 'g' as NodeId }
    const s = setup(table, graph)
    const wedge = graph.layers.find((l) => l.geom === 'wedge')!
    expect(expectReach(s, ['layers', wedge.id, 'series', table.dataSets[0]!.id]).fill).toBe(
      undefined,
    )
  })

  it('bubbles of a mapped colour and size: no Colour; the size not offered', () => {
    const table = appearanceTable()
    const b = presetGraph(table, 'bubble')
    const graph = {
      ...b,
      id: 'g' as NodeId,
      layers: b.layers.map((l) =>
        l.aes ? ({ ...l, aes: { x: 'c', y: 'd', color: 'f', size: 'e' } } as Layer) : l,
      ),
    }
    const s = setup(table, graph)
    const layer = graph.layers.find((l) => l.aes)!
    const t = expectReach(s, ['layers', layer.id, 'series', 'd'])
    expect(t.fill).toBeUndefined()
    expect(markValues([t.mark!])!.sizeMapped).toBe(true)
    expect(sharedCapabilities([t]).has('mark')).toBe(true)
  })
})
