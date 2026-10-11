import { DocumentStore, DraftStore } from '@ps/engine'
import {
  createGraphFor,
  hitTest,
  layoutGraph,
  layoutPage,
  type Prim,
  type SceneNode,
} from '@ps/graph'
import {
  createProject,
  createTable,
  type GraphNode,
  type LayoutNode,
  type NodeId,
  newLayoutItemId,
  newNodeId,
  type Project,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { byId, flatten, fonts } from '../../graph/test/helpers.ts'
import { axisPlace, graphPlace } from '../src/graph/format/route.ts'
import { formatOnPage, pageFormatChoices } from '../src/layout/formatOnPage.ts'

const ITEM = { x: 100, y: 60, scale: 0.5 }

function setup() {
  const project: Project = createProject()
  const add = (n: Project['nodes'][NodeId]) => {
    project.nodes[n.id] = n
    project.order.push(n.id)
  }
  const table = createTable({ columns: 2, rows: 3 })
  table.dataSets[0]!.subcolumns[0]!.values = [1, 2, 3]
  table.dataSets[1]!.subcolumns[0]!.values = [4, 5, 6]
  add(table)
  const graph = createGraphFor(table, 'One')
  add(graph)
  const layout: LayoutNode = {
    kind: 'layout',
    id: newNodeId(),
    name: 'Figure 1',
    page: { width: 612, height: 792 },
    items: [
      { type: 'graph', id: newLayoutItemId(), graph: graph.id, ...ITEM },
      {
        type: 'text',
        id: newLayoutItemId(),
        x: 400,
        y: 400,
        content: { content: [{ text: 'Note' }] },
      },
    ],
    panelLabels: { show: true, style: 'A', size: 14 },
  }
  add(layout)
  const keys = table.dataSets.map((d) => d.id as string)
  return { project, graph, layout, keys }
}

/** A graph-scene point on the page. */
const onPage = (x: number, y: number) => ({
  x: ITEM.x + x * ITEM.scale,
  y: ITEM.y + y * ITEM.scale,
})

describe('scene hit-testing', () => {
  it('finds the topmost painted element, through transforms, with a tolerance for thin lines', () => {
    const line: Prim = {
      type: 'line',
      x1: 0,
      y1: 10,
      x2: 100,
      y2: 10,
      stroke: { color: '#000000', width: 1, dash: 'solid' },
    }
    const rect: Prim = {
      type: 'rect',
      x: 40,
      y: 0,
      w: 20,
      h: 20,
      stroke: null,
      fill: { color: '#ff0000', opacity: 1 },
    }
    const root: SceneNode = {
      id: 'root',
      transform: { x: 10, y: 10, scale: 2 },
      children: [
        { id: 'line', target: ['a'], prim: line },
        { id: 'box', target: ['b'], prim: rect },
      ],
    }
    // (x, y) in root coordinates = 10 + 2 × local.
    expect(hitTest(root, 10 + 2 * 20, 10 + 2 * 11)?.node.id).toBe('line')
    expect(hitTest(root, 10 + 2 * 50, 10 + 2 * 10)?.node.id).toBe('box') // drawn later: on top
    expect(hitTest(root, 10 + 2 * 20, 10 + 2 * 30)).toBeNull()
    expect(hitTest(root, 10 + 2 * 50, 10 + 2 * 10)?.target).toEqual(['b'])
  })
})

describe('Format dialogs from a layout page', () => {
  it('opens the dialog of the element under the pointer, as on the graph', () => {
    const { project, graph, layout, keys } = setup()
    const page = layoutPage({ project, layout, fonts })
    const scene = layoutGraph({ project, graph, fonts })

    const point = byId(scene, `series/${keys[1]}/point/2`)!.prim as Extract<
      Prim,
      { type: 'symbol' }
    >
    const f = formatOnPage(project, layout, page, 0, onPage(point.cx, point.cy))
    // The mark on top there (a point, or the error bar drawn over it): its layer and data set.
    expect(f).toMatchObject({
      graphId: graph.id,
      target: { place: 'layer', series: { dataSet: keys[1]! } },
      what: 'data set',
    })
    expect(['points', 'error']).toContain((f!.target as { layer?: string }).layer)

    const tick = byId(scene, 'axis/y/tickLabel/1')!.bbox!
    const onTick = onPage(tick.x + tick.w / 2, tick.y + tick.h / 2)
    expect(formatOnPage(project, layout, page, 0, onTick)?.target).toEqual(axisPlace('y'))

    // An empty spot of the graph (the plot between the two columns, near its top): the graph.
    const at = onPage(scene.plot.x + scene.plot.w / 2, scene.plot.y + 3)
    expect(formatOnPage(project, layout, page, 0, at)?.target).toEqual(graphPlace())
    // Text items have no Format dialog.
    expect(formatOnPage(project, layout, page, 1, { x: 401, y: 401 })).toBeNull()
  })

  it('offers the element, the graph and the axes on right-click', () => {
    const { project, layout, keys, graph } = setup()
    const page = layoutPage({ project, layout, fonts })
    const scene = layoutGraph({ project, graph, fonts })
    const point = byId(scene, `series/${keys[0]}/point/0`)!.prim as Extract<
      Prim,
      { type: 'symbol' }
    >
    const f = formatOnPage(project, layout, page, 0, onPage(point.cx, point.cy))!
    expect(pageFormatChoices(f).map((c) => c.label)).toEqual([
      'Format data set…',
      'Format graph…',
      'Format axes…',
    ])
  })

  it('edits a draft shown on the page; OK is one undo step, Cancel leaves the page as it was', () => {
    const { project, graph, layout } = setup()
    const store = new DocumentStore(project)
    const before = store.getState()
    const titleOf = (p: Project) => {
      const page = layoutPage({ project: p, layout: p.nodes[layout.id] as LayoutNode, fonts })
      return flatten(page.root)
        .filter((n) => n.id === 'title' && n.prim?.type === 'text')
        .map((n) =>
          (n.prim as Extract<Prim, { type: 'text' }>).layout.runs.map((r) => r.text).join(''),
        )
    }
    // Cancel: the dialog's draft is dropped.
    const cancelled = new DraftStore(store)
    cancelled.dispatch({
      type: 'node.set',
      id: graph.id,
      path: ['title'],
      value: { content: [{ text: 'Draft' }] },
    })
    expect(titleOf(cancelled.getState())).toEqual(['Draft'])
    expect(store.getState()).toBe(before)

    // OK: the page (a view of the same document) shows the change, as one undo step.
    const draft = new DraftStore(store)
    draft.dispatch({
      type: 'node.set',
      id: graph.id,
      path: ['title'],
      value: { content: [{ text: 'Renamed' }] },
    })
    draft.dispatch({ type: 'node.set', id: graph.id, path: ['style', 'frame'], value: 'box' })
    expect(draft.commit('Format graph')).toBe(true)
    expect(titleOf(store.getState())).toEqual(['Renamed'])
    expect((store.getState().nodes[graph.id] as GraphNode).style.frame).toBe('box')
    expect(store.undoLabel).toBe('Format graph')
    store.undo()
    expect(store.getState().nodes[graph.id]).toEqual(before.nodes[graph.id])
  })
})
