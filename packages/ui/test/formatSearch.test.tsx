// @vitest-environment happy-dom
import { DocumentStore } from '@ps/engine'
import { createGraphFor } from '@ps/graph'
import { createProject, createTable, type GraphNode, type NodeId, type Project } from '@ps/model'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { ServicesContext } from '../src/context.tsx'
import { FormatPanel } from '../src/graph/format/FormatPanel.tsx'
import { optionsOf } from '../src/graph/format/FormatSearch.tsx'
import { axisPlace, type FormatTarget, graphPlace, layerPlace } from '../src/graph/format/route.ts'
import {
  fold,
  harvestFields,
  revealField,
  type SearchEntry,
  searchFields,
} from '../src/graph/format/search.ts'
import type { AppServices } from '../src/services.ts'

// Roadmap 46 (V5): the Format panel's field search — an index read off a rendering of every place
// of the graph (labels, sections, hints), results "Element › Section › Field", and a jump that
// selects the element, shows its place, opens a collapsed section and focuses the field.

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

const entry = (p: Partial<SearchEntry> & { label: string }): SearchEntry => ({
  target: axisPlace('y'),
  element: 'Y axis',
  section: 'axis',
  heading: null,
  hint: '',
  nth: 0,
  ...p,
})

describe('the search index', () => {
  it('is read off the rendered sections: labels, checkboxes, legends, section titles, hints', () => {
    const el = document.createElement('div')
    el.innerHTML = `
      <div data-format-section="axis">
        <section class="inspector-section">
          <h3><button class="section-toggle" aria-expanded="true"><span>▾</span>Numbers</button></h3>
          <div class="field"><label for="a">Prefix</label><input id="a" title="Before each number"></div>
          <label class="check field"><input type="checkbox">Thousands separators (1,000)</label>
          <div class="field-row">
            <div class="field"><label>Size (pt)</label><input></div>
            <div class="field"><label>Size (pt)</label><input></div>
          </div>
        </section>
        <fieldset class="field"><legend>Where</legend><label class="check"><input type="radio">Left</label></fieldset>
        <div class="field"><label>Note</label><input><div class="help">Shown under the graph</div></div>
      </div>`
    const entries = harvestFields(el, { target: axisPlace('y'), element: 'Y axis' })
    expect(entries.map((e) => [e.heading, e.label, e.nth])).toEqual([
      ['Numbers', 'Prefix', 0],
      ['Numbers', 'Thousands separators (1,000)', 0],
      ['Numbers', 'Size (pt)', 0],
      ['Numbers', 'Size (pt)', 1],
      [null, 'Where', 0],
      [null, 'Note', 0],
    ])
    expect(entries[0]!.hint).toContain('Before each number')
    expect(entries[5]!.hint).toContain('Shown under the graph')
    expect(entries.every((e) => e.section === 'axis' && e.element === 'Y axis')).toBe(true)
  })

  it('matches every word in the label, section, element or hint; labels first; British and American spellings alike', () => {
    const entries = [
      entry({ element: 'Legend', label: 'Border', hint: 'colour of the box' }),
      entry({ heading: 'Numbers', label: 'Thousands separators (1,000)' }),
      entry({ heading: 'Labels', label: 'Colour' }),
      entry({ element: 'X axis', heading: 'Numbers', label: 'Thousands separators (1,000)' }),
      entry({ heading: 'Gaps', label: 'Width' }),
    ]
    expect(searchFields(entries, 'thousands').map((r) => `${r.path} › ${r.entry.label}`)).toEqual([
      'Y axis › Numbers › Thousands separators (1,000)',
      'X axis › Numbers › Thousands separators (1,000)',
    ])
    // "color" finds "Colour"; the label's match before the hint's.
    expect(searchFields(entries, 'color').map((r) => r.entry.label)).toEqual(['Colour', 'Border'])
    expect(searchFields(entries, 'y thousands').map((r) => r.path)).toEqual(['Y axis › Numbers'])
    expect(searchFields(entries, 'gap').map((r) => r.entry.label)).toEqual(['Width'])
    expect(searchFields(entries, '   ')).toEqual([])
    expect(searchFields(entries, 'zzz')).toEqual([])
    expect(fold('Centre & Grey Colours')).toBe('center and gray colors')
  })

  it('lists a shared setting once and a per-layer setting as one result naming its layers, front first (roadmap 47)', () => {
    const layer = (id: string, name: string, p: Partial<SearchEntry> & { label: string }) =>
      entry({ target: layerPlace(id), element: `Layer “${name}”`, layer: name, ...p })
    const entries = [
      entry({
        target: graphPlace(),
        element: 'Graph',
        section: 'layers',
        label: 'Drawing order',
        shared: true,
      }),
      // Layers back to front, as the index lists them.
      layer('a', 'Points', { section: 'common', heading: 'Common', label: 'Size' }),
      layer('a', 'Points', { section: 'layers', label: 'Drawing order', shared: true }),
      layer('b', 'Mean ± SD', { section: 'common', heading: 'Common', label: 'Size' }),
      layer('b', 'Mean ± SD', { section: 'layers', label: 'Drawing order', shared: true }),
      layer('b', 'Mean ± SD', { section: 'fields', heading: 'Error bars', label: 'Size' }),
    ]
    const order = searchFields(entries, 'drawing order')
    expect(order).toHaveLength(1)
    expect(order[0]).toMatchObject({ path: 'Graph', entry: { target: graphPlace() } })
    const size = searchFields(entries, 'size')
    expect(size.map((r) => [r.path, r.entry.label, r.layers?.map((l) => l.layer)])).toEqual([
      ['Layers › Common', 'Size', ['Mean ± SD', 'Points']],
      ['Layer “Mean ± SD” › Error bars', 'Size', undefined],
    ])
    // The first is the front-most layer's.
    expect(size[0]!.entry.target).toEqual(layerPlace('b'))
    // A layer named in the query: only its own.
    expect(searchFields(entries, 'points size').map((r) => [r.path, r.layers])).toEqual([
      ['Layer “Points” › Common', undefined],
    ])
    // The options: one per layer, in the row's order.
    expect(optionsOf(size).map((o) => o.entry.layer ?? o.entry.element)).toEqual([
      'Mean ± SD',
      'Points',
      'Mean ± SD',
    ])
  })

  it('reveals a field: opening its collapsed section first, then focusing and highlighting it', () => {
    const el = document.body.appendChild(document.createElement('div'))
    el.innerHTML = `
      <div data-format-section="axis">
        <section class="inspector-section">
          <h3><button class="section-toggle" aria-expanded="false"><span>▸</span>Grid lines</button></h3>
        </section>
      </div>`
    const toggle = el.querySelector('button')!
    toggle.addEventListener('click', () => {
      toggle.setAttribute('aria-expanded', 'true')
      toggle
        .closest('section')!
        .insertAdjacentHTML(
          'beforeend',
          '<label class="check field"><input type="checkbox">Major grid lines</label>',
        )
    })
    const e = entry({ heading: 'Grid lines', label: 'Major grid lines' })
    expect(revealField(el, e)).toBe('retry')
    expect(revealField(el, e)).toBe('done')
    expect(document.activeElement).toBe(el.querySelector('input'))
    expect(el.querySelector('.search-hit')?.textContent).toBe('Major grid lines')
    expect(revealField(el, entry({ section: 'nowhere', label: 'x' }))).toBe('missing')
    el.remove()
  })
})

function setup() {
  const table = createTable({ tableKind: 'column', columns: 2, rows: 3 })
  table.dataSets[0]!.subcolumns[0]!.values = [1, 4, 9]
  table.dataSets[1]!.subcolumns[0]!.values = [2, 3, 5]
  const graph: GraphNode = { ...createGraphFor(table), id: 'g1' as NodeId }
  const project: Project = createProject()
  project.nodes[table.id] = table
  project.nodes[graph.id] = graph
  project.order.push(table.id, graph.id)
  const store = new DocumentStore(project)
  const engine = { subscribe: () => () => {}, version: 0, latest: () => undefined }
  return { store, graph, services: { store, engine, platform: {} } as unknown as AppServices }
}

/** The panel with a canvas behind it: a jump's selection shows its place, as the views do. */
function Harness({
  graph,
  selected,
}: {
  graph: NodeId
  selected: { path: (string | number)[] | null; target: FormatTarget }[]
}) {
  const [target, setTarget] = useState<FormatTarget>(graphPlace())
  return (
    <FormatPanel
      graphId={graph}
      target={target}
      setTarget={setTarget}
      name="Graph"
      scope="graph"
      onSelect={(path, t) => {
        selected.push({ path, target: t })
        setTarget(t)
      }}
      onOpenWindow={() => {}}
      onClose={() => {}}
      onEscape={() => {}}
      focus={null}
    />
  )
}

const panel = () => host!.querySelector('aside.format-panel') as HTMLElement
const combobox = () => panel().querySelector('[role="combobox"]') as HTMLInputElement
const options = () =>
  [...panel().querySelectorAll('[role="option"]')].map((o) => o.textContent ?? '')
function type(input: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const key = (el: HTMLElement, k: string) =>
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
  })
const frames = () => act(() => new Promise((r) => setTimeout(r, 120)))

describe('the panel’s search', () => {
  it('finds a field of any place of the graph and jumps to it: the element selected, its field focused', async () => {
    const s = setup()
    const selected: { path: (string | number)[] | null; target: FormatTarget }[] = []
    host = document.body.appendChild(document.createElement('div'))
    root = createRoot(host)
    act(() =>
      root!.render(
        <ServicesContext.Provider value={s.services}>
          <Harness graph={s.graph.id} selected={selected} />
        </ServicesContext.Provider>,
      ),
    )
    const box = combobox()
    expect(box.getAttribute('aria-expanded')).toBe('false')
    type(box, 'thousands')
    expect(options()).toContain('Y axis › Numbers › Thousands separators (1,000)')
    expect(box.getAttribute('aria-expanded')).toBe('true')
    const list = panel().querySelector('[role="listbox"]')!
    expect(box.getAttribute('aria-controls')).toBe(list.id)
    // ↓ until the Y axis' is active, Enter.
    const want = 'Y axis › Numbers › Thousands separators (1,000)'
    for (let i = 0; i < 10; i++) {
      const active = document.getElementById(box.getAttribute('aria-activedescendant')!)
      if (active?.textContent === want) break
      key(box, 'ArrowDown')
    }
    key(box, 'Enter')
    await frames()
    expect(selected.at(-1)).toMatchObject({
      path: ['axes', 'y'],
      target: { place: 'axis', axis: 'y' },
    })
    expect(box.value).toBe('')
    const focused = document.activeElement as HTMLInputElement
    expect(focused.type).toBe('checkbox')
    expect(focused.closest('label')?.textContent).toBe('Thousands separators (1,000)')
    expect(focused.closest('.search-hit')).not.toBeNull()
    // Nothing written: the search reads, the index's rendering writes nowhere.
    expect(s.store.historyLength.undo).toBe(0)

    // A field in a collapsed section: it opens.
    type(box, 'major grid')
    const grid = options().findIndex((o) => o.startsWith('Y axis › Grid lines'))
    expect(grid).toBeGreaterThanOrEqual(0)
    for (let i = 0; i < grid; i++) key(box, 'ArrowDown')
    key(box, 'Enter')
    await frames()
    expect((document.activeElement as HTMLElement).closest('label')?.textContent).toBe(
      'Major grid lines',
    )

    // Nothing found: said so, the list closed; Escape clears.
    type(box, 'zzzz')
    expect(panel().querySelector('[role="status"]')?.textContent).toBe('No options match “zzzz”.')
    expect(box.getAttribute('aria-expanded')).toBe('false')
    key(box, 'Escape')
    expect(box.value).toBe('')
  })

  it('shows a setting of several layers as one row, each layer an option to jump to (roadmap 47)', async () => {
    const s = setup()
    const selected: { path: (string | number)[] | null; target: FormatTarget }[] = []
    host = document.body.appendChild(document.createElement('div'))
    root = createRoot(host)
    act(() =>
      root!.render(
        <ServicesContext.Provider value={s.services}>
          <Harness graph={s.graph.id} selected={selected} />
        </ServicesContext.Provider>,
      ),
    )
    const layers = s.graph.layers
    expect(layers.length).toBeGreaterThan(1)
    const box = combobox()
    type(box, 'colours of the data sets')
    const row = panel().querySelector('[role="listbox"] [role="group"]')!
    expect(row.getAttribute('aria-label')).toBe(
      `Layers › Common › Colours of the data sets, in ${layers.length} layers`,
    )
    // One option per layer, the front-most (the list's last) first.
    const names = [...row.querySelectorAll('[role="option"]')].map((o) => o.textContent)
    expect(names).toHaveLength(layers.length)
    // The drawing order is listed once, however many places show it.
    type(box, 'drawing order')
    const results = panel().querySelector('[aria-label="Matching options"]')!
    expect([...results.querySelectorAll('[role="option"]')].map((o) => o.textContent)).toEqual([
      'Graph › Layers › Drawing order',
    ])
    // ↓ to the second layer of the row, Enter: that layer's place.
    type(box, 'colours of the data sets')
    key(box, 'ArrowDown')
    const active = document.getElementById(box.getAttribute('aria-activedescendant')!)!
    expect(active.textContent).toBe(names[1])
    key(box, 'Enter')
    await frames()
    expect(selected.at(-1)?.target).toMatchObject({
      place: 'layer',
      layer: layers.at(-2)!.id,
    })
  })
})
