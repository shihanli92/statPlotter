// @vitest-environment happy-dom
import { DocumentStore } from '@ps/engine'
import { createGraphFor, mixColor, presetGraph } from '@ps/graph'
import {
  createProject,
  createTable,
  type DataTable,
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
import { type FormatTarget, layerPlace, layerView } from '../src/graph/format/route.ts'
import { lighterPalette } from '../src/graph/palettes.ts'
import type { AppServices } from '../src/services.ts'

// Roadmap 49d: fill and outline mapped separately in the Format panel — a data set's fill colour
// beside its colour ("Data set fill (every layer)", or the link giving it one), the data sets'
// fill colours in Common, the recipe "Light fill, dark outline by group", and on graphs of
// variables the Fill row's own variable (the outline's the colour variable).

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

const OKABE = [
  '#0072b2',
  '#d55e00',
  '#009e73',
  '#cc79a7',
  '#e69f00',
  '#56b4e9',
  '#f0e442',
  '#000000',
]

function setupWith(table: DataTable, graph: GraphNode) {
  const project: Project = createProject()
  project.nodes[table.id] = table
  project.nodes[graph.id] = graph
  project.order.push(table.id, graph.id)
  const store = new DocumentStore(project)
  const engine = { subscribe: () => () => {}, version: 0, latest: () => undefined }
  const services = { store, engine, platform: {} } as unknown as AppServices
  const g = () => store.getState().nodes[graph.id] as GraphNode
  const layer = (id: string) =>
    g().layers.find((l) => l.id === id)! as Layer & { style?: Record<string, unknown> }
  return { store, graph, services, g, layer, ds: table.dataSets.map((d) => d.id as string) }
}

function columnSetup(edit: (g: GraphNode) => GraphNode = (g) => g) {
  const table = createTable({ tableKind: 'column', columns: 3, rows: 3 })
  table.dataSets.forEach((d, i) => {
    d.subcolumns[0]!.values = [1 + i, 4 + i, 9 + i]
  })
  return setupWith(table, edit({ ...createGraphFor(table), id: 'g1' as NodeId }))
}

/** A multiple-variables table: Score, Age (numbers), Site, Group (text). */
function variablesTable(): DataTable {
  const table = createTable({ tableKind: 'multipleVariables', columns: 4, rows: 4 })
  table.dataSets[0]!.subcolumns[0]!.values = [1, 2, 3, 4]
  table.dataSets[1]!.subcolumns[0]!.values = [2, 4, 1, 3]
  table.dataSets[2]!.title = 'Site'
  table.dataSets[2]!.text = ['North', 'South', 'North', 'South']
  table.dataSets[3]!.title = 'Group'
  table.dataSets[3]!.text = ['A', 'A', 'B', 'B']
  return table
}

type Setup = ReturnType<typeof setupWith>

function Panel({ s, start }: { s: Setup; start: FormatTarget }) {
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

function render(s: Setup, start: FormatTarget) {
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
  for (let i = 0; i < 5; i++) {
    const closed = [...host.querySelectorAll('button.section-toggle[aria-expanded="false"]')]
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
  return document.getElementById((l as HTMLLabelElement).htmlFor) as T
}
const has = (label: string) => allLabels().includes(label)
const choose = (label: string, value: string) => {
  const sel = control<HTMLSelectElement>(label)
  act(() => {
    sel.value = value
    sel.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
const modes = (label: string) =>
  [...control<HTMLSelectElement>(label).options].map((o) => o.textContent)
const button = (name: string) => {
  const b = [...host!.querySelectorAll('button')].find(
    (x) => x.textContent === name || x.getAttribute('aria-label') === name,
  )
  if (!b) throw new Error(`no button ${name}`)
  return b as HTMLButtonElement
}
const click = (b: HTMLElement) => act(() => b.click())

describe('a data set’s fill colour', () => {
  it('a link gives it one (lighter), then its own row; Automatic clears it', () => {
    const s = columnSetup()
    const [a] = s.ds as [string]
    render(s, layerView('points', { dataSet: a }))
    expect(has('Data set fill (every layer)')).toBe(false)
    click(button('Set a separate fill colour'))
    expect(s.g().seriesOverrides[a]?.fill).toEqual({ rgb: mixColor(OKABE[0]!, '#ffffff', 0.5) })
    expect(s.store.undoLabel).toBe('Fill colour')
    expect(has('Data set colour (every layer)')).toBe(true)
    expect(has('Data set fill (every layer)')).toBe(true)
  })

  it('shown for every data set once the graph has fill colours of its own', () => {
    const s = columnSetup((g) => ({ ...g, style: { ...g.style, fillPalette: ['#eeeeee'] } }))
    const [, b] = s.ds as [string, string]
    render(s, layerView('points', { dataSet: b }))
    expect(has('Data set fill (every layer)')).toBe(true)
  })
})

describe('the data sets’ fill colours (Common)', () => {
  it('lighter colours, a scheme, back to their colours (their own fills cleared)', () => {
    const s = columnSetup()
    const [a] = s.ds as [string]
    render(s, layerPlace('points'))
    expect(control<HTMLSelectElement>('Fill colours of the data sets').value).toBe('same')
    choose('Fill colours of the data sets', 'lighter')
    expect(s.g().style.fillPalette).toEqual(lighterPalette(OKABE))
    choose('Fill colours of the data sets', 'pastel')
    expect(s.g().style.fillPalette?.[0]).toBe('#8dd3c7')
    act(() => {
      s.store.dispatch(
        [
          {
            type: 'node.set',
            id: s.graph.id,
            path: ['seriesOverrides', a, 'fill'],
            value: { rgb: '#123456' },
          },
        ],
        'Own fill',
      )
    })
    choose('Fill colours of the data sets', 'same')
    expect(s.g().style.fillPalette).toBeUndefined()
    expect(s.g().seriesOverrides[a]?.fill).toBeUndefined()
    expect(s.store.undoLabel).toBe('Fill colours')
  })
})

describe('the recipe “Light fill, dark outline by group”', () => {
  it('fill and outline by data set, lighter fill colours, one step', () => {
    const s = columnSetup()
    render(s, layerPlace('points'))
    click(button('Light fill, dark outline by group'))
    expect(s.layer('points').style).toMatchObject({
      fill: { type: 'solid', color: { series: true }, opacity: 1 },
      border: { color: { series: true } },
    })
    expect(s.g().style.fillPalette).toEqual(lighterPalette(OKABE))
    expect(s.store.undoLabel).toBe('Light fill, dark outline by group')
    act(() => s.store.undo())
    expect(s.g().style.fillPalette).toBeUndefined()
    // Fill colours of its own already: kept.
    const own = columnSetup((g) => ({ ...g, style: { ...g.style, fillPalette: ['#eeeeee'] } }))
    act(() => root?.unmount())
    host?.remove()
    render(own, layerPlace('points'))
    click(button('Light fill, dark outline by group'))
    expect(own.g().style.fillPalette).toEqual(['#eeeeee'])
  })
})

describe('fill by a variable of its own (graphs of variables)', () => {
  it('XY: the Fill row maps the fill variable, the Outline row the colour variable', () => {
    const table = variablesTable()
    const graph = { ...presetGraph(table, 'bubble'), id: 'g1' as NodeId }
    const points = graph.layers.find((l) => l.geom === 'points' && l.aes)!
    const s = setupWith(table, graph)
    render(s, layerPlace(points.id))
    expect(modes('Fill')).toEqual(['By variable', 'Fixed', 'None'])
    const aes = () => s.g().layers.find((l) => l.id === points.id)!.aes!
    expect(control<HTMLSelectElement>('Fill').value).toBe('variable')
    // "Same as the colour" until a fill variable is chosen.
    expect(control<HTMLSelectElement>('Fill variable').value).toBe('')
    const site = table.dataSets[2]!.id
    choose('Fill variable', site)
    expect(aes().fill).toBe(site)
    expect(s.store.undoLabel).toBe('Fill by variable')
    // A number fill variable starts on viridis with a colour bar.
    choose('Fill variable', table.dataSets[1]!.id)
    expect(s.g().scales?.fill).toEqual({ colors: 'viridis', bar: { show: true } })
    // The outline's variable, the colour's.
    const group = table.dataSets[3]!.id
    choose('Outline variable', group)
    expect(aes().color).toBe(group)
    // A fixed fill unmaps the fill variable (its legend goes too).
    choose('Fill', 'fixed')
    expect(aes().fill).toBeUndefined()
    expect(s.layer(points.id).style?.fill).toMatchObject({ color: { rgb: '#ffffff' } })
  })

  it('a category graph of variables: By data set (the groups) or By variable (the rows)', () => {
    const table = variablesTable()
    const graph = {
      ...presetGraph(table, 'points', undefined, {
        mapping: { x: table.dataSets[3]!.id, y: table.dataSets[0]!.id },
      }),
      id: 'g1' as NodeId,
    }
    const points = graph.layers.find((l) => l.geom === 'points' && l.stat.kind === 'identity')!
    const s = setupWith(table, graph)
    render(s, layerPlace(points.id))
    expect(modes('Fill')).toEqual(['By data set', 'Fixed', 'None', 'By variable'])
    choose('Fill', 'variable')
    const fill = s.g().mapping?.fill
    expect(fill).toBeDefined()
    expect(control<HTMLSelectElement>('Fill').value).toBe('variable')
    expect(control<HTMLSelectElement>('Fill variable').value).toBe(fill)
    choose('Fill', 'series')
    expect(s.g().mapping?.fill).toBeUndefined()
  })

  it('Appearance by variable: Fill by, its levels’ fill colours and legend heading', () => {
    const table = variablesTable()
    const graph = { ...presetGraph(table, 'bubble'), id: 'g1' as NodeId }
    const points = graph.layers.find((l) => l.geom === 'points' && l.aes)!
    const s = setupWith(table, {
      ...graph,
      layers: graph.layers.map((l) =>
        l.id === points.id
          ? ({ ...l, aes: { ...l.aes, fill: table.dataSets[2]!.id } } as Layer)
          : l,
      ),
    })
    render(s, layerPlace(points.id))
    expect(control<HTMLSelectElement>('Fill by').value).toBe(table.dataSets[2]!.id)
    expect(has('North')).toBe(true)
    expect(has('South')).toBe(true)
    expect(has('Legend heading')).toBe(true)
  })
})
