// @vitest-environment happy-dom
import { DocumentStore } from '@ps/engine'
import { presetGraph } from '@ps/graph'
import {
  createProject,
  createTable,
  type GraphNode,
  type LayerOf,
  type NodeId,
  type Project,
} from '@ps/model'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { LiveFields } from '../src/components/fields.tsx'
import { ConfirmContext } from '../src/components/modals.tsx'
import { ServicesContext } from '../src/context.tsx'
import { FormatPanel } from '../src/graph/format/FormatPanel.tsx'
import { type FormatTarget, layerPlace, picksSeries } from '../src/graph/format/route.ts'
import { clusterCommands } from '../src/graph/inspector/LayerFields.tsx'
import type { AppServices } from '../src/services.ts'

// Roadmap 49c: a heat map's clustering adding and removing its trees, and a tree's own Format
// view (docked panel): its clustering (the heat map's, or its own alone), its cut, side, size,
// gap, branch heights, colours and strip; a dendrogram alone turned with its axes.

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

let root: Root | null = null
let host: HTMLElement | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  host?.remove()
  host = null
})

/** A grouped table of 6 rows × 4 data sets, and a graph of it in a preset. */
function setup(preset: string, edit: (g: GraphNode) => GraphNode = (g) => g) {
  const table = createTable({ tableKind: 'grouped', columns: 4, rows: 6 })
  const rows = [
    [1, 9, 2, 8],
    [2, 7, 1, 9],
    [0, 8, 3, 7],
    [9, 1, 8, 2],
    [8, 2, 9, 1],
    [5, 5, 4, 6],
  ]
  table.dataSets.forEach((d, j) => {
    d.subcolumns[0]!.values = rows.map((r) => r[j]!)
  })
  const graph = edit({ ...presetGraph(table, preset), id: 'g1' as NodeId })
  const project: Project = createProject()
  project.nodes[table.id] = table
  project.nodes[graph.id] = graph
  project.order.push(table.id, graph.id)
  const store = new DocumentStore(project)
  const engine = { subscribe: () => () => {}, version: 0, latest: () => undefined }
  const services = { store, engine, platform: {} } as unknown as AppServices
  const g = () => store.getState().nodes[graph.id] as GraphNode
  const tree = (of: 'rows' | 'columns') =>
    g().layers.find((l) => l.geom === 'dendrogram' && l.stat.of === of) as
      | LayerOf<'dendrogram'>
      | undefined
  return { store, graph, services, g, tree }
}

function Panel({ s, start }: { s: ReturnType<typeof setup>; start: FormatTarget }) {
  const [target, setTarget] = useState(start)
  return (
    <FormatPanel
      graphId={s.graph.id}
      target={target}
      setTarget={setTarget}
      name="Layer"
      scope="test"
      onSelect={() => {}}
      onOpenWindow={() => {}}
      onClose={() => {}}
      onEscape={() => {}}
      focus={null}
    />
  )
}

function render(s: ReturnType<typeof setup>, start: FormatTarget) {
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  act(() =>
    root!.render(
      <ServicesContext.Provider value={s.services}>
        <ConfirmContext.Provider value={() => Promise.resolve(true)}>
          <LiveFields.Provider value={true}>
            <Panel s={s} start={start} />
          </LiveFields.Provider>
        </ConfirmContext.Provider>
      </ServicesContext.Provider>,
    ),
  )
  openAll()
}

/** Every section open. */
function openAll() {
  for (let i = 0; i < 5; i++) {
    const closed = [...host!.querySelectorAll('button.section-toggle[aria-expanded="false"]')]
    if (!closed.length) break
    act(() => {
      for (const b of closed) (b as HTMLButtonElement).click()
    })
  }
}

const allLabels = () => [...host!.querySelectorAll('label')].map((l) => l.textContent ?? '')
const control = <T extends HTMLElement>(label: string) => {
  const l = [...host!.querySelectorAll('label')].find((x) => x.textContent === label)
  if (!l) throw new Error(`no field ${label}: ${allLabels().join(', ')}`)
  const byFor = (l as HTMLLabelElement).htmlFor
  return (byFor ? document.getElementById(byFor) : l.querySelector('input')) as T
}
const has = (label: string) => allLabels().includes(label)
const choose = (label: string, value: string) => {
  const sel = control<HTMLSelectElement>(label)
  act(() => {
    sel.value = value
    sel.dispatchEvent(new Event('change', { bubbles: true }))
  })
  openAll()
}
const type = (label: string, v: number) => {
  const input = control<HTMLInputElement>(label)
  act(() => {
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')
    desc?.set?.call(input, String(v))
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  openAll()
}
const check = (label: string) => {
  const box = control<HTMLInputElement>(label)
  act(() => box.click())
  openAll()
}

/** A heat map clustering its rows and columns, with both trees (as clustering on adds them). */
const clustered = (g: GraphNode): GraphNode => ({
  ...g,
  layers: [
    ...g.layers.map((l) =>
      l.geom === 'tile' ? { ...l, style: { cluster: { rows: true, columns: true } } } : l,
    ),
    { id: 'rowTree', geom: 'dendrogram', stat: { kind: 'cluster', of: 'rows' } },
    { id: 'columnTree', geom: 'dendrogram', stat: { kind: 'cluster', of: 'columns' } },
  ],
})

describe('a heat map’s clustering', () => {
  it('turned on adds the axis’ tree at the front, off removes it, one step each', () => {
    const s = setup('heatmap')
    render(s, layerPlace('cells'))
    check('Cluster rows')
    expect(s.g().layers.map((l) => l.id)).toEqual(['cells', 'rowTree'])
    expect(s.tree('rows')?.stat).toEqual({ kind: 'cluster', of: 'rows' })
    check('Cluster columns')
    expect(s.g().layers.map((l) => l.id)).toEqual(['cells', 'rowTree', 'columnTree'])
    // The trees' size is theirs: no depth with the heat map's clustering.
    expect(has('Dendrogram depth (pt)')).toBe(false)
    check('Cluster rows')
    expect(s.tree('rows')).toBeUndefined()
    expect(s.g().layers.find((l) => l.id === 'cells')!.style).toEqual({
      cluster: { columns: true },
    })
    act(() => s.store.undo())
    expect(s.tree('rows')).toBeDefined()
  })

  it('keeps a tree already there (hidden) when turned on again', () => {
    const s = setup('heatmap')
    const g = s.g()
    const cmds = clusterCommands(g, g.layers[0]!, 'rows', true)
    expect(cmds.map((c) => c.type)).toEqual(['node.set', 'graph.addLayer'])
    const withTree = clustered(g)
    expect(clusterCommands(withTree, withTree.layers[0]!, 'rows', true).map((c) => c.type)).toEqual(
      ['node.set'],
    )
    expect(
      clusterCommands(withTree, withTree.layers[0]!, 'columns', false).map((c) => c.type),
    ).toEqual(['node.set', 'graph.removeLayer'])
  })
})

describe('a tree’s Format view', () => {
  it('picks no data set; edits the heat map’s distance and linkage, its own cut', () => {
    const s = setup('heatmap', clustered)
    expect(picksSeries(s.tree('rows')!)).toBe(false)
    render(s, layerPlace('rowTree'))
    expect(has('Tree of')).toBe(false)
    choose('Linkage', 'ward')
    // The heat map's clustering, shared by its trees.
    expect(s.g().layers[0]!.style).toEqual({
      cluster: { rows: true, columns: true, linkage: 'ward' },
    })
    expect(s.tree('rows')!.stat).toEqual({ kind: 'cluster', of: 'rows' })
    choose('Cut the tree', 'k')
    expect(s.tree('rows')!.stat.cut).toEqual({ k: 2 })
    type('Clusters', 3)
    expect(s.tree('rows')!.stat.cut).toEqual({ k: 3 })
    choose('Cut the tree', 'h')
    const cut = s.tree('rows')!.stat.cut as { h: number }
    expect(cut.h).toBeGreaterThan(0)
    expect(host!.textContent).toMatch(/2 clusters at this height/)
    choose('Cut the tree', 'none')
    expect(s.tree('rows')!.stat).toEqual({ kind: 'cluster', of: 'rows' })
  })

  it('sets the side, size, gap and branch heights; defaults are written as absent', () => {
    const s = setup('heatmap', clustered)
    render(s, layerPlace('columnTree'))
    expect(control<HTMLSelectElement>('Side').value).toBe('top')
    choose('Side', 'bottom')
    expect(s.tree('columns')!.style).toEqual({ side: 'bottom' })
    type('Tree height (pt)', 50)
    type('Gap to the map (pt)', 0)
    choose('Branch heights', 'steps')
    expect(s.tree('columns')!.style).toEqual({
      side: 'bottom',
      depth: 50,
      gap: 0,
      heights: 'steps',
    })
    choose('Side', 'top')
    type('Tree height (pt)', 36)
    expect(s.tree('columns')!.style).toEqual({ gap: 0, heights: 'steps' })
  })

  it('a cut tree’s colours and strip; the line in the Appearance table', () => {
    const s = setup('heatmap', clustered)
    render(s, layerPlace('rowTree'))
    expect(has('Cluster colours')).toBe(false)
    choose('Cut the tree', 'k')
    check('Branches below the cut in their cluster’s colour')
    expect(s.tree('rows')!.style).toEqual({ colorBranches: false })
    check('Cluster strip between the tree and the map')
    type('Strip width (pt)', 12)
    expect(s.tree('rows')!.style).toEqual({ colorBranches: false, strip: true, stripWidth: 12 })
    // A swatch per cluster.
    expect(host!.querySelector('.cluster-colors')?.textContent).toMatch(/Cluster 1.*Cluster 2/)
    // The tree's line, fixed: its width.
    type('Line width (pt)', 1.5)
    expect(s.tree('rows')!.style!.line).toEqual({
      color: { rgb: '#000000' },
      width: 1.5,
      dash: 'solid',
    })
  })
})

describe('a dendrogram alone', () => {
  it('chooses its axis and turns its leaves with the axes and plot, one step', () => {
    const s = setup('dendrogram')
    const before = s.g()
    render(s, layerPlace('rowTree'))
    expect(has('Side')).toBe(false)
    expect(has('Tree width (pt)')).toBe(false)
    expect(control<HTMLSelectElement>('Leaves').value).toBe('bottom')
    choose('Leaves', 'left')
    const g = s.g()
    expect(s.tree('rows')!.style).toEqual({ side: 'right' })
    expect(g.axes.x).toEqual(before.axes.y)
    expect(g.axes.y).toEqual(before.axes.x)
    expect(g.size.plotWidth).toBe(before.size.plotHeight)
    act(() => s.store.undo())
    expect(s.g()).toEqual(before)
    // Its own clustering: of the columns, by 1 − Pearson r.
    choose('Tree of', 'columns')
    choose('Distance', 'pearson')
    expect(s.tree('columns')!.stat).toEqual({ kind: 'cluster', of: 'columns', distance: 'pearson' })
  })
})
