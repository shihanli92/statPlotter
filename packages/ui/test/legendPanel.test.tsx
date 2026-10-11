// @vitest-environment happy-dom
import { DocumentStore } from '@ps/engine'
import { createGraphFor, type LegendItem } from '@ps/graph'
import { createProject, createTable, type GraphNode, type NodeId, type Project } from '@ps/model'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { CommandsContext, createCommandRegistry } from '../src/commands/index.ts'
import { ServicesContext } from '../src/context.tsx'
import { FormatBar } from '../src/formatBar/FormatBar.tsx'
import { FormatPanel } from '../src/graph/format/FormatPanel.tsx'
import { type FormatTarget, seriesTarget } from '../src/graph/format/route.ts'
import { elementKey, type Selection, single } from '../src/selection/selection.ts'
import type { AppServices } from '../src/services.ts'

// Roadmap 47b: the Format panel's legend Entries (every entry, moved with Alt+↑ / ↓ on its
// handle, shown or hidden, labelled), the Legend entry head of an entry's place, and the format
// bar's Layout group (columns stepped, quick repeats one step; the fill toggled).

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

/** A column graph of four data sets (A, B, C, D) with its legend shown, and its entries. */
function setup() {
  const table = createTable({ tableKind: 'column', columns: 4, rows: 3 })
  table.dataSets.forEach((d, i) => {
    d.title = 'ABCD'[i]!
    d.subcolumns[0]!.values = [1 + i, 2 + i, 3 + i]
  })
  const base = createGraphFor(table)
  const graph: GraphNode = {
    ...base,
    id: 'g1' as NodeId,
    legend: { ...base.legend, show: true, position: 'right' },
  }
  const project: Project = createProject()
  project.nodes[table.id] = table
  project.nodes[graph.id] = graph
  project.order.push(table.id, graph.id)
  const store = new DocumentStore(project)
  const engine = { subscribe: () => () => {}, version: 0, latest: () => undefined }
  const services = { store, engine, platform: {} } as unknown as AppServices
  const g = () => store.getState().nodes[graph.id] as GraphNode
  const ds = table.dataSets.map((d) => d.id as string)
  // The legend as laid out (\`Scene.legend\`): its data sets, in their order.
  const legend = (): LegendItem[] => {
    const order = g().legend.order ?? []
    const keys = [...ds].sort(
      (a, b) =>
        (order.includes(a) ? order.indexOf(a) : 99 + ds.indexOf(a)) -
        (order.includes(b) ? order.indexOf(b) : 99 + ds.indexOf(b)),
    )
    return keys.map((k) => ({
      key: k,
      group: 'dataSets',
      label: 'ABCD'[ds.indexOf(k)]!,
      hidden: (g().legend.hidden ?? []).includes(k),
    }))
  }
  return { store, graph, services, g, ds, legend }
}

const LEGEND = ['legend']

describe('the Format panel and the format bar (roadmap 47b)', () => {
  function renderPanel(s: ReturnType<typeof setup>, target: FormatTarget) {
    host = document.body.appendChild(document.createElement('div'))
    root = createRoot(host)
    act(() =>
      root!.render(
        <ServicesContext.Provider value={s.services}>
          <FormatPanel
            graphId={s.graph.id}
            target={target}
            setTarget={() => {}}
            name="Legend"
            scope="test"
            onSelect={() => {}}
            onOpenWindow={() => {}}
            onClose={() => {}}
            onEscape={() => {}}
            focus={null}
            legend={s.legend()}
          />
        </ServicesContext.Provider>,
      ),
    )
  }
  const section = (title: string) =>
    [...host!.querySelectorAll('.inspector-section')].find((x) =>
      x.querySelector('.inspector-section-title, summary, button')?.textContent?.includes(title),
    ) as HTMLElement | undefined
  const button = (name: string) =>
    [...host!.querySelectorAll('button')].find((b) => b.textContent === name) as HTMLButtonElement

  it('lists every entry to move (Alt+↓ on its handle), show or hide, and label', () => {
    const s = setup()
    renderPanel(s, { place: 'legend' })
    const open = [...host!.querySelectorAll('button')].find((b) =>
      /Entries/.test(b.textContent ?? ''),
    )
    if (open && open.getAttribute('aria-expanded') === 'false') act(() => open.click())
    const rows = () => [...host!.querySelectorAll('.legend-entry-row')] as HTMLElement[]
    expect(rows().map((r) => r.dataset.entry)).toEqual(s.ds)
    const grip = rows()[0]!.querySelector('.grip') as HTMLElement
    act(() => {
      grip.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true }),
      )
    })
    expect(s.g().legend.order).toEqual([s.ds[1], s.ds[0], s.ds[2], s.ds[3]])
    expect(s.store.undoLabel).toBe('Move legend entry')
    const box = rows()[2]!.querySelector('input[type="checkbox"]') as HTMLInputElement
    act(() => box.click())
    expect(s.g().legend.hidden).toEqual([s.ds[2]])
    expect(s.store.undoLabel).toBe('Hide legend entry')
    // Columns at every position (the "Entries per row" of before), and the fill.
    expect(host!.textContent).toContain('Columns')
    expect(host!.textContent).not.toContain('Entries per row')
    expect(section('Entries')).toBeDefined()
  })

  it('heads an entry’s data set place with its legend-only actions', () => {
    const s = setup()
    renderPanel(s, {
      ...seriesTarget(s.g(), { dataSet: s.ds[1]! }),
      entry: s.ds[1],
    } as FormatTarget)
    expect(host!.textContent).toContain('Legend entry')
    act(() => button('Move earlier').click())
    expect(s.g().legend.order).toEqual([s.ds[1], s.ds[0], s.ds[2], s.ds[3]])
    act(() => button('Hide from legend').click())
    expect(s.g().legend.hidden).toEqual([s.ds[1]])
  })

  function renderBar(s: ReturnType<typeof setup>, sel: Selection) {
    host = document.body.appendChild(document.createElement('div'))
    root = createRoot(host)
    act(() =>
      root!.render(
        <ServicesContext.Provider value={s.services}>
          <CommandsContext.Provider value={createCommandRegistry()}>
            <FormatBar
              sel={sel}
              graph={s.graph.id}
              name="Legend"
              elements={() => []}
              onSelect={() => {}}
              legendEntries={() => 4}
            />
          </CommandsContext.Provider>
        </ServicesContext.Provider>,
      ),
    )
  }
  const bar = (label: string) =>
    host!.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null

  it('the Layout group: columns stepped (quick repeats one step) and the fill toggled', () => {
    const s = setup()
    renderBar(s, single(elementKey(s.graph.id, LEGEND)))
    expect(host!.querySelector('[data-testid="legend-columns"]')?.textContent).toBe('1 col')
    expect(bar('Fewer legend columns')!.disabled).toBe(true)
    act(() => bar('More legend columns')!.click())
    act(() => bar('More legend columns')!.click())
    expect(s.g().legend.columns).toBe(3)
    expect(s.store.historyLength.undo).toBe(1)
    expect(s.store.undoLabel).toBe('Legend columns 3')
    act(() => bar('More legend columns')!.click())
    expect(s.g().legend.columns).toBe(4)
    expect(bar('More legend columns')!.disabled).toBe(true)
    act(() => bar('Fill down columns')!.click())
    expect(s.g().legend.fill).toBe('columns')
    expect(bar('Fill down columns')!.getAttribute('aria-pressed')).toBe('true')
    expect(s.store.undoLabel).toBe('Legend fill down columns')
  })

  it('no Layout group without the legend selected (an entry formats its data set)', () => {
    const s = setup()
    renderBar(s, single(elementKey(s.graph.id, ['seriesOverrides', s.ds[0]!])))
    expect(bar('More legend columns')).toBeNull()
  })
})
