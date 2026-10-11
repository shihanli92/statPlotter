// @vitest-environment happy-dom
import { DocumentStore } from '@ps/engine'
import { createGraphFor, frontFirst } from '@ps/graph'
import {
  createProject,
  createTable,
  type GraphNode,
  type Layer,
  type NodeId,
  type Project,
} from '@ps/model'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ServicesContext } from '../src/context.tsx'
import { FormatPanel } from '../src/graph/format/FormatPanel.tsx'
import {
  clickSelection,
  entryPlace,
  type FormatTarget,
  formatTargetFor,
  homeLayer,
  landOn,
  layerPlace,
  layerView,
  pointPlace,
  selectionTarget,
  seriesTarget,
  stepLayer,
  targetPaths,
} from '../src/graph/format/route.ts'
import { jumpTarget, type SearchEntry, searchPlaces } from '../src/graph/format/search.ts'
import { FORMAT_SECTIONS } from '../src/graph/format/sections.tsx'
import type { AppServices } from '../src/services.ts'

// Roadmap 49b: one layer at a time in the Format view — a mark opens the layer that drew it with
// its data set picked; ‹ › step through every layer in the Layers list's order (front first),
// keeping the data set where the next layer draws it; the data set's own colour is a row at the
// top; several data sets of one layer selected are formatted together.

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

/** A column scatter (points, error bars, centre line) with a grand mean in front of them. */
function setup() {
  const table = createTable({ tableKind: 'column', columns: 3, rows: 3 })
  table.dataSets.forEach((d, i) => {
    d.subcolumns[0]!.values = [1 + i, 4 + i, 9 + i]
  })
  const base = createGraphFor(table)
  const grandMean = {
    id: 'grandMean',
    geom: 'refline',
    stat: { kind: 'summary', center: 'mean', by: 'all' },
  } as Layer
  const graph: GraphNode = { ...base, id: 'g1' as NodeId, layers: [...base.layers, grandMean] }
  const project: Project = createProject()
  project.nodes[table.id] = table
  project.nodes[graph.id] = graph
  project.order.push(table.id, graph.id)
  const store = new DocumentStore(project)
  const engine = { subscribe: () => () => {}, version: 0, latest: () => undefined }
  const services = { store, engine, platform: {} } as unknown as AppServices
  const ds = table.dataSets.map((d) => d.id as string)
  const g = () => store.getState().nodes[graph.id] as GraphNode
  return { store, graph, project, services, ds, g }
}

describe('routing to one layer (roadmap 49b)', () => {
  it('a mark opens the layer that drew it, its data set picked; Alt-click the whole layer', () => {
    const { graph, ds } = setup()
    for (const l of graph.layers.filter((x) => x.geom !== 'refline'))
      expect(formatTargetFor(['layers', l.id, 'series', ds[1]!], graph)).toEqual({
        place: 'layer',
        layer: l.id,
        series: { dataSet: ds[1]! },
      })
    const marks = ['layers', 'points', 'series', ds[1]!]
    expect(formatTargetFor(clickSelection(marks, 'r0s0', null, 1, true), graph)).toEqual(
      layerPlace('points'),
    )
    // A layer whose view picks no data set (the grand mean: one line): its own view.
    expect(formatTargetFor(['layers', 'grandMean', 'series', ds[0]!], graph)).toEqual(
      layerPlace('grandMean'),
    )
    // A point stays a point, remembering its layer; its whole data set is that layer's view.
    expect(formatTargetFor(['pointOverrides', ds[0]!, 'r1s0'], graph, 'points')).toEqual(
      pointPlace(ds[0]!, 'r1s0', 'points'),
    )
    expect(seriesTarget(graph, { dataSet: ds[0]! }, 'points')).toEqual(
      layerView('points', { dataSet: ds[0]! }),
    )
  })

  it('a data set’s identity and legend entry open its home layer (not attached error bars)', () => {
    const { graph, ds } = setup()
    const home = homeLayer(graph, { dataSet: ds[2]! })!
    expect(home.on).toBeUndefined()
    expect(home.geom).not.toBe('refline')
    expect(formatTargetFor(['seriesOverrides', ds[2]!], graph)).toEqual(
      layerView(home.id, { dataSet: ds[2]! }),
    )
    expect(entryPlace(ds[2]!, ['seriesOverrides', ds[2]!], graph)).toEqual({
      ...layerView(home.id, { dataSet: ds[2]! }),
      entry: ds[2],
    })
  })
})

describe('the arrows (roadmap 49b)', () => {
  it('step through every layer in the list’s order, the front first, and stop at the ends', () => {
    const { graph, ds } = setup()
    const rows = frontFirst(graph.layers).map((l) => l.id)
    expect(rows[0]).toBe('grandMean')
    // From the back layer › is the end; ‹ walks to the front.
    let t: FormatTarget | null = layerView(rows.at(-1)!, { dataSet: ds[0]! })
    expect(stepLayer(graph, t, 1)).toBeNull()
    const seen = [rows.at(-1)]
    for (t = stepLayer(graph, t, -1); t; t = stepLayer(graph, t, -1))
      seen.push((t as { layer: string }).layer)
    expect(seen).toEqual([...rows].reverse())
    expect(stepLayer(graph, layerPlace(rows[0]!), -1)).toBeNull()
    // Another place has no arrows.
    expect(stepLayer(graph, { place: 'graph' }, 1)).toBeNull()
  })

  it('keep the data set where the next layer draws it, else every series', () => {
    const { graph, ds } = setup()
    const rows = frontFirst(graph.layers).map((l) => l.id)
    const second = rows[1]!
    // A data set kept between layers drawing it.
    expect(stepLayer(graph, layerView(second, { dataSet: ds[1]! }), 1)).toEqual(
      layerView(rows[2]!, { dataSet: ds[1]! }),
    )
    // The grand mean picks none: its own view; past it, nothing is picked any more.
    const atMean = stepLayer(graph, layerView(second, { dataSet: ds[1]! }), -1)
    expect(atMean).toEqual(layerPlace('grandMean'))
    expect(stepLayer(graph, atMean!, 1)).toEqual(layerPlace(second))
    // Several data sets stay together; a point's data set is kept from its layer.
    expect(landOn(graph, layerView(second, { dataSets: [ds[0]!, ds[2]!] }), rows[2]!)).toEqual(
      layerView(rows[2]!, { dataSets: [ds[0]!, ds[2]!] }),
    )
    expect(landOn(graph, pointPlace(ds[0]!, 'r1s0', second), rows[2]!)).toEqual(
      layerView(rows[2]!, { dataSet: ds[0]! }),
    )
  })

  it('select what the layer landed on formats: its marks of each data set, else the layer', () => {
    const { ds } = setup()
    expect(targetPaths(layerView('points', { dataSet: ds[0]! }))).toEqual([
      ['layers', 'points', 'series', ds[0]],
    ])
    expect(targetPaths(layerView('points', { dataSets: [ds[0]!, ds[1]!] }))).toEqual([
      ['layers', 'points', 'series', ds[0]],
      ['layers', 'points', 'series', ds[1]],
    ])
    expect(targetPaths(layerPlace('grandMean'))).toEqual([['layers', 'grandMean']])
    expect(targetPaths(pointPlace(ds[0]!, 'r1s0'))).toEqual([['pointOverrides', ds[0], 'r1s0']])
  })
})

describe('several marks selected (roadmap 49b)', () => {
  it('several data sets of one layer: its view of them together; other layers’ left out', () => {
    const { graph, ds } = setup()
    const m = (layer: string, k: string) => ['layers', layer, 'series', k]
    const primary = m('points', ds[2]!)
    expect(selectionTarget([m('points', ds[0]!), primary], primary, graph)).toEqual(
      layerView('points', { dataSets: [ds[2]!, ds[0]!] }),
    )
    // Marks of another layer too: the primary's layer, with its own data sets only.
    const other = graph.layers.find((l) => l.id !== 'points' && l.geom !== 'refline')!.id
    expect(selectionTarget([m(other, ds[1]!), primary], primary, graph)).toEqual(
      layerView('points', { dataSet: ds[2]! }),
    )
    // Not marks: the primary's place.
    expect(selectionTarget([['title'], primary], ['title'], graph)).toEqual({ place: 'title' })
  })
})

describe('the Format search reaches layers one at a time', () => {
  it('lists the data set shown in its layer, and jumps to a layer’s view and section', () => {
    const { project, graph, ds } = setup()
    const ctx = { project, graph, lookup: () => undefined } as never
    const shown = layerView('error', { dataSet: ds[1]! })
    const places = searchPlaces(ctx, shown)
    expect(places.some((p) => JSON.stringify(p.target) === JSON.stringify(shown))).toBe(true)
    for (const l of graph.layers)
      expect(
        places.some((p) => JSON.stringify(p.target) === JSON.stringify(layerPlace(l.id))),
      ).toBe(true)
    const entry = { target: shown, section: 'fields' } as SearchEntry
    expect(jumpTarget(entry)).toEqual({ ...shown, section: 'fields' })
  })
})

interface Props {
  target: FormatTarget
  scope: string
  onSelect?: (path: unknown, t: FormatTarget, more?: unknown) => void
  onNotice?: (msg: string) => void
}

function render(s: ReturnType<typeof setup>, p: Props) {
  host ??= document.body.appendChild(document.createElement('div'))
  root ??= createRoot(host)
  act(() =>
    root!.render(
      <ServicesContext.Provider value={s.services}>
        <FormatPanel
          graphId={s.graph.id}
          target={p.target}
          setTarget={() => {}}
          name="Layer"
          scope={p.scope}
          onSelect={p.onSelect ?? (() => {})}
          onOpenWindow={() => {}}
          onClose={() => {}}
          onEscape={() => {}}
          focus={null}
          onNotice={p.onNotice ?? (() => {})}
        />
      </ServicesContext.Provider>,
    ),
  )
}

const panel = () => host!.querySelector('aside.format-panel') as HTMLElement
const named = (label: string) =>
  panel().querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement
const button = (text: string) =>
  [...panel().querySelectorAll('button')].find((b) => b.textContent === text) as HTMLButtonElement
const selectLabelled = (text: string) => {
  const label = [...panel().querySelectorAll('label')].find((l) => l.textContent === text)!
  return document.getElementById(label.htmlFor) as HTMLSelectElement
}
function choose(select: HTMLSelectElement, value: string) {
  act(() => {
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

describe('a layer’s view in the panel', () => {
  it('shows ‹ n of m ›, its data set’s colour row, and steps by selecting the next layer', () => {
    const s = setup()
    const onSelect = vi.fn()
    const rows = frontFirst(s.graph.layers).map((l) => l.id)
    render(s, { target: layerView(rows[1]!, { dataSet: s.ds[0]! }), scope: 'a', onSelect })
    const steps = panel().querySelector('.layer-steps')!
    expect(steps.textContent).toContain(`2 of ${rows.length}`)
    expect(named('Layer in front').disabled).toBe(false)
    // The data set's own colour, the row at the top, writes its identity's colour.
    const colour = panel().querySelector('[data-format-section="colour"]')!
    expect(colour.textContent).toContain('Data set colour (every layer)')
    // Only this layer's sections: no section of another layer.
    expect(panel().querySelectorAll('[data-format-section^="layer:"]')).toHaveLength(0)
    act(() => named('Layer behind').click())
    expect(onSelect).toHaveBeenCalledWith(
      ['layers', rows[2], 'series', s.ds[0]],
      layerView(rows[2]!, { dataSet: s.ds[0]! }),
      [],
    )
    act(() => named('Layer in front').click())
    expect(onSelect).toHaveBeenLastCalledWith(['layers', 'grandMean'], layerPlace('grandMean'), [])
  })

  it('has no data set picker or colour row on a layer of its own (the grand mean)', () => {
    const s = setup()
    render(s, { target: layerPlace('grandMean'), scope: 'gm' })
    expect(panel().querySelector('.series-picker')).toBeNull()
    expect(panel().querySelector('.series-colour-row')).toBeNull()
    expect(named('Layer in front').disabled).toBe(true)
  })

  it('every data set: the picker on All, no colour row', () => {
    const s = setup()
    render(s, { target: layerPlace('points'), scope: 'p' })
    expect(selectLabelled('Data set').value).toBe('all')
    expect(panel().querySelector('.series-colour-row')).toBeNull()
  })

  it('formats several data sets of one layer together, each one’s own entry', () => {
    const s = setup()
    const two = [s.ds[0]!, s.ds[2]!]
    render(s, { target: layerView('points', { dataSets: two }), scope: 'two' })
    expect(selectLabelled('Data set').value).toBe('several')
    const plot = selectLabelled('Plot')
    choose(plot, 'mean')
    const points = s.g().layers.find((l) => l.id === 'points')!
    for (const k of two) expect(points.series?.[k]?.stat).toMatchObject({ kind: 'summary' })
    expect(points.series?.[s.ds[1]!]?.stat).toBeUndefined()
    expect(points.stat.kind).toBe('identity')
  })

  it('Revert takes back the changes made on the layer shown, not those on another', () => {
    const s = setup()
    const onNotice = vi.fn()
    const view = (layer: string) => layerView(layer, { dataSet: s.ds[0]! })
    render(s, { target: view('points'), scope: 'points', onNotice })
    choose(selectLabelled('Plot'), 'mean')
    expect(s.store.historyLength.undo).toBe(1)
    // The arrows land on another layer: a new selection, so a new scope for Revert.
    const other = frontFirst(s.graph.layers).find((l) => l.id !== 'points' && l.geom !== 'refline')!
    render(s, { target: view(other.id), scope: other.id, onNotice })
    expect(button('Revert').disabled).toBe(true)
    const name = panel().querySelector('[data-format-section="fields"] select') as HTMLSelectElement
    const next = [...name.options].find((o) => !o.selected)!.value
    choose(name, next)
    expect(s.store.historyLength.undo).toBe(2)
    act(() => button('Revert').click())
    // Only the change on this layer is undone; the points' change stays.
    expect(s.store.historyLength.undo).toBe(1)
    expect(s.g().layers.find((l) => l.id === 'points')!.series?.[s.ds[0]!]?.stat).toBeDefined()
    expect(onNotice).toHaveBeenCalledWith('Reverted 1 change to Layer')
  })

  it('keeps the view’s sections in order, the data set’s colour before Common', () => {
    const ids = FORMAT_SECTIONS.layer.map((x) => x.id)
    expect(ids.indexOf('picker')).toBeLessThan(ids.indexOf('colour'))
    expect(ids.indexOf('colour')).toBeLessThan(ids.indexOf('common'))
    expect(ids).not.toContain('parts')
    expect(Object.keys(FORMAT_SECTIONS)).not.toContain('series')
  })
})
