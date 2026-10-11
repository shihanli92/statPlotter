// @vitest-environment happy-dom
import { DocumentStore } from '@ps/engine'
import { createGraphFor, presetGraph } from '@ps/graph'
import {
  createProject,
  createTable,
  type GraphNode,
  type Layer,
  type NodeId,
  type Project,
} from '@ps/model'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { ConfirmContext } from '../src/components/modals.tsx'
import { ServicesContext } from '../src/context.tsx'
import { FormatPanel } from '../src/graph/format/FormatPanel.tsx'
import {
  type FormatTarget,
  graphPlace,
  layerPlace,
  seriesPlace,
} from '../src/graph/format/route.ts'
import type { AppServices } from '../src/services.ts'

// Roadmap 49a: a layer's Appearance table in the Format panel — a row per aesthetic its geom
// draws, each by data set, fixed (or none, or by variable), the recipes, the data sets set by
// hand with their Reset, mixed values, and the graph's orders of shapes and line styles.

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

function setup(edit: (g: GraphNode) => GraphNode = (g) => g, preset?: string) {
  const table = createTable({ tableKind: 'column', columns: 3, rows: 3 })
  table.dataSets.forEach((d, i) => {
    d.subcolumns[0]!.values = [1 + i, 4 + i, 9 + i]
  })
  const base = preset ? presetGraph(table, preset) : createGraphFor(table)
  const graph = edit({ ...base, id: 'g1' as NodeId })
  const project: Project = createProject()
  project.nodes[table.id] = table
  project.nodes[graph.id] = graph
  project.order.push(table.id, graph.id)
  const store = new DocumentStore(project)
  const engine = { subscribe: () => () => {}, version: 0, latest: () => undefined }
  const services = { store, engine, platform: {} } as unknown as AppServices
  const g = () => store.getState().nodes[graph.id] as GraphNode
  const layer = (id: string) =>
    g().layers.find((l) => l.id === id)! as Layer & {
      style?: Record<string, unknown>
    }
  const ds = table.dataSets.map((d) => d.id as string)
  return { store, graph, services, g, layer, ds }
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
          <Panel s={s} start={start} />
        </ConfirmContext.Provider>
      </ServicesContext.Provider>,
    ),
  )
  // Every section open.
  for (let i = 0; i < 5; i++) {
    const closed = [...host.querySelectorAll('button.section-toggle[aria-expanded="false"]')]
    if (!closed.length) break
    act(() => {
      for (const b of closed) (b as HTMLButtonElement).click()
    })
  }
}

/** The table's controls by their labels. */
const labels = () =>
  [...host!.querySelectorAll('.appearance-table label')].map((l) => l.textContent ?? '')
const control = <T extends HTMLElement>(label: string, scope: ParentNode = host!) => {
  const l = [...scope.querySelectorAll('label')].find((x) => x.textContent === label)
  if (!l) throw new Error(`no field ${label}: ${labels().join(', ')}`)
  return document.getElementById((l as HTMLLabelElement).htmlFor) as T
}
const choose = (label: string, value: string) => {
  const sel = control<HTMLSelectElement>(label)
  act(() => {
    sel.value = value
    sel.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
const button = (name: string) => {
  const b = [...host!.querySelectorAll('button')].find(
    (x) => x.textContent === name || x.getAttribute('aria-label') === name,
  )
  if (!b) throw new Error(`no button ${name}`)
  return b as HTMLButtonElement
}
const click = (b: HTMLElement) => act(() => b.click())
const note = () => host!.querySelector('.appearance-note')?.textContent ?? null

describe('the Appearance table', () => {
  it('has a row per aesthetic of points, in place of Hollow and Border', () => {
    const s = setup()
    render(s, layerPlace('points'))
    expect(labels()).toEqual([
      'Fill',
      'Fill colour',
      'Fill opacity',
      'Outline',
      'Outline colour',
      'Outline width (pt)',
      'Shape',
      'Fixed shape',
      'Size (pt)',
    ])
    expect(host!.textContent).not.toContain('Hollow')
    expect(control<HTMLSelectElement>('Fill').value).toBe('series')
    expect(control<HTMLSelectElement>('Shape').value).toBe('fixed')
    // The modes offered: no By variable on a column table.
    expect([...control<HTMLSelectElement>('Fill').options].map((o) => o.textContent)).toEqual([
      'By data set',
      'Fixed',
      'None',
    ])
  })

  it('error bars, centre lines: line colour, width and style, by data set or fixed', () => {
    const s = setup()
    render(s, layerPlace('error'))
    expect(labels()).toEqual([
      'Line',
      'Line colour',
      'Line width (pt)',
      'Line style',
      'Fixed line style',
    ])
    choose('Line style', 'series')
    expect(s.layer('error').style?.line).toMatchObject({ dash: { series: true } })
    expect(s.store.undoLabel).toBe('Line style by data set')
    // The graph's order of line styles, at a glance.
    expect(host!.querySelector('.appearance-cycle summary')?.textContent).toBe('——  – –  ···')
  })

  it('bars: fill and outline, fixed or by data set; fill opacity once', () => {
    const s = setup((g) => g, 'bars')
    render(s, layerPlace('bars'))
    expect(labels().filter((l) => l === 'Fill opacity')).toHaveLength(1)
    expect(host!.textContent).not.toContain('Border (pt)')
    choose('Fill', 'fixed')
    expect(s.layer('bars').style?.fill).toEqual({
      type: 'solid',
      color: { rgb: '#ffffff' },
      opacity: 1,
    })
    choose('Outline', 'fixed')
    expect(s.layer('bars').style?.border).toMatchObject({ color: { rgb: '#000000' } })
    choose('Fill', 'none')
    expect(s.layer('bars').style?.fill).toEqual({ type: 'none' })
    // No fill: no opacity to set.
    expect(labels()).not.toContain('Fill opacity')
  })

  it('shapes by data set: the layer’s shape is the data set’s, the order shown and edited', () => {
    const s = setup()
    render(s, layerPlace('points'))
    choose('Shape', 'series')
    expect(s.layer('points').style?.shape).toEqual({ series: true })
    expect(labels()).not.toContain('Fixed shape')
    const cycle = host!.querySelector('.appearance-cycle summary')!
    expect(cycle.textContent).toBe('●  ■  ▲  ◆  ✕  +')
    // The order, folded under it: the first shape made a diamond (the graph's own list).
    const order = host!.querySelector('.appearance-cycle')!
    choose('Shape 1', 'diamond')
    expect(s.g().style.shapes).toEqual([
      'diamond',
      'square',
      'triangle',
      'diamond',
      'cross',
      'plus',
    ])
    expect(order.querySelector('summary')?.textContent).toBe('◆  ■  ▲  ◆  ✕  +')
    click(button('Remove the last'))
    expect(s.g().style.shapes).toHaveLength(5)
    click(button('Default order'))
    expect(s.g().style.shapes).toBeUndefined()
    choose('Shape', 'fixed')
    expect(s.layer('points').style?.shape).toBe('circle')
  })

  it('recipes: fill and outline in one step, undone at once', () => {
    const s = setup()
    render(s, layerPlace('points'))
    click(button('Filled by group, black outline'))
    expect(s.layer('points').style).toMatchObject({
      fill: { type: 'solid', color: { series: true }, opacity: 1 },
      border: { color: { rgb: '#000000' }, width: 0.75, dash: 'solid' },
    })
    expect(s.store.undoLabel).toBe('Filled by group, black outline')
    expect(control<HTMLSelectElement>('Outline').value).toBe('fixed')
    click(button('Outlined by group, white fill'))
    expect(s.layer('points').style).toMatchObject({
      fill: { type: 'solid', color: { rgb: '#ffffff' } },
      border: { color: { series: true } },
    })
    click(button('Solid by group'))
    expect(s.layer('points').style).toMatchObject({
      fill: { color: { series: true } },
      border: { color: { series: true } },
    })
    act(() => {
      s.store.undo()
      s.store.undo()
    })
    expect(s.layer('points').style).toMatchObject({ border: { color: { rgb: '#000000' } } })
  })

  it('data sets set by hand win, are counted, shown mixed, and Reset clears them', () => {
    const s = setup()
    const [a, b] = s.ds as [string, string]
    act(() => {
      s.store.dispatch(
        [
          {
            type: 'node.set',
            id: s.graph.id,
            path: ['layers', { id: 'points' }, 'series', a, 'style', 'shape'],
            value: 'plus',
          },
          {
            type: 'node.set',
            id: s.graph.id,
            path: ['layers', { id: 'points' }, 'series', b, 'style', 'shape'],
            value: { series: true },
          },
        ],
        'Set by hand',
      )
    })
    render(s, layerPlace('points'))
    expect(note()).toBe('2 data sets set by hand · Reset')
    // Fixed for one, by data set for another: the mode is mixed.
    expect(control<HTMLSelectElement>('Shape').value).toBe('\u0000mixed')
    // The layer's shape changes; the data sets' own stay.
    choose('Shape', 'series')
    expect(s.layer('points').series?.[a]?.style).toEqual({ shape: 'plus' })
    click(button('Reset shape of data sets set by hand'))
    expect(s.layer('points').series?.[a]?.style).toBeUndefined()
    expect(s.layer('points').series?.[b]?.style).toBeUndefined()
    expect(s.store.undoLabel).toBe('Reset data sets’ shape')
    expect(note()).toBeNull()
  })

  it('one data set: its own values, written to its entry', () => {
    const s = setup()
    const [a] = s.ds as [string]
    render(s, seriesPlace({ dataSet: a }, 'points'))
    choose('Shape', 'series')
    expect(s.layer('points').series?.[a]?.style).toEqual({ shape: { series: true } })
    expect(s.layer('points').style?.shape).toBeUndefined()
    expect(note()).toBeNull()
  })

  it('the graph’s place edits the orders of shapes and line styles', () => {
    const s = setup()
    render(s, graphPlace())
    choose('Line style 1', 'dot')
    expect(s.g().style.dashes).toEqual(['dot', 'dash', 'dot'])
    click(button('Add a line style'))
    expect(s.g().style.dashes).toHaveLength(4)
    expect(s.store.undoLabel).toBe('Order of line styles')
  })

  it('a graph of variables: shape and size by variable, colours by the colour variable', () => {
    const table = createTable({ tableKind: 'multipleVariables', columns: 3, rows: 4 })
    table.dataSets[0]!.subcolumns[0]!.values = [1, 2, 3, 4]
    table.dataSets[1]!.subcolumns[0]!.values = [2, 4, 1, 3]
    table.dataSets[2]!.title = 'Site'
    table.dataSets[2]!.text = ['North', 'South', 'North', 'South']
    const graph = { ...presetGraph(table, 'bubble'), id: 'g1' as NodeId }
    const points = graph.layers.find((l) => l.geom === 'points' && l.aes)
    expect(points).toBeDefined()
    const project: Project = createProject()
    project.nodes[table.id] = table
    project.nodes[graph.id] = graph
    project.order.push(table.id, graph.id)
    const store = new DocumentStore(project)
    const engine = { subscribe: () => () => {}, version: 0, latest: () => undefined }
    const services = { store, engine, platform: {} } as unknown as AppServices
    const s = { store, graph, services } as unknown as ReturnType<typeof setup>
    render(s, layerPlace(points!.id))
    const modes = (label: string) =>
      [...control<HTMLSelectElement>(label).options].map((o) => o.textContent)
    expect(modes('Shape')).toEqual(['Fixed', 'By variable'])
    expect(modes('Fill')).toEqual(['By variable', 'Fixed', 'None'])
    choose('Shape', 'variable')
    const g = () => store.getState().nodes[graph.id] as GraphNode
    const aes = () => g().layers.find((l) => l.id === points!.id)!.aes
    expect(aes()?.shape).toBe(table.dataSets[2]!.id)
    expect(control<HTMLSelectElement>('Shape variable').value).toBe(table.dataSets[2]!.id)
    choose('Shape', 'fixed')
    expect(aes()?.shape).toBeUndefined()
  })
})
