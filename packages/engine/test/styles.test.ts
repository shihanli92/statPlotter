import { builtinStyle, createProject, createTable, type GraphNode, newNodeId } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { CommandError, DocumentStore } from '../src/index.ts'
import { POINTS } from './graphs.ts'

// Roadmap 37: a project's style set and cleared with undo; new graphs take its axis frames and
// legend place, copies keep theirs (decision 531).

const offset = {
  id: 'user:Offset',
  style: { axes: { frame: 'offset' as const }, legend: { position: 'top' as const } },
}

function setup() {
  const table = createTable({ rows: 2, columns: 1 })
  const project = createProject()
  project.nodes[table.id] = table
  project.order.push(table.id)
  return { store: new DocumentStore(project), table }
}

const graphOf = (table: string): GraphNode => ({
  kind: 'graph',
  id: newNodeId(),
  name: 'g',
  frame: 'category',
  look: 'column.scatter',
  layers: [POINTS],
  seriesSource: { table: table as never, include: 'all' },
  seriesOverrides: {},
  size: { plotWidth: 100, plotHeight: 100 },
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
  legend: { show: true, position: 'right' },
  title: null,
  style: {},
})

describe('project styles', () => {
  it('are set and cleared as one undo step', () => {
    const { store } = setup()
    const nature = builtinStyle('journal-nature')!
    store.dispatch(
      { type: 'project.setSettings', settings: { theme: nature.id, style: nature.style } },
      'Apply style',
    )
    expect(store.getState().settings.style).toEqual(nature.style)
    store.dispatch(
      { type: 'project.setSettings', settings: { theme: 'default' }, clear: ['style'] },
      'Apply style',
    )
    expect(store.getState().settings).not.toHaveProperty('style')
    store.undo()
    expect(store.getState().settings.theme).toBe(nature.id)
    store.undo()
    expect(store.getState().settings).not.toHaveProperty('style')
    expect(() =>
      store.dispatch({ type: 'project.setSettings', settings: {}, clear: ['theme' as never] }),
    ).toThrow(CommandError)
  })

  it('new graphs take the style’s axis frames and legend place; copies keep theirs', () => {
    const { store, table } = setup()
    store.dispatch({
      type: 'project.setSettings',
      settings: { theme: offset.id, style: offset.style },
    })
    const fresh = graphOf(table.id)
    store.dispatch({ type: 'node.add', node: fresh, fresh: true })
    const g = store.getState().nodes[fresh.id] as GraphNode
    expect(g.axes.y.type === 'continuous' && g.axes.y.frame).toBe('offset')
    expect(g.legend.position).toBe('top')
    const copy = graphOf(table.id)
    store.dispatch({ type: 'node.add', node: copy })
    expect((store.getState().nodes[copy.id] as GraphNode).legend.position).toBe('right')
  })

  it('a graph’s own style is a document field (undo)', () => {
    const { store, table } = setup()
    const g = graphOf(table.id)
    store.dispatch({ type: 'node.add', node: g })
    const cell = builtinStyle('journal-cell')!
    store.dispatch({ type: 'node.set', id: g.id, path: ['theme'], value: cell })
    expect((store.getState().nodes[g.id] as GraphNode).theme).toEqual(cell)
    store.undo()
    expect((store.getState().nodes[g.id] as GraphNode).theme).toBeUndefined()
  })
})
