// @vitest-environment happy-dom
import { DocumentStore } from '@ps/engine'
import { createGraphFor } from '@ps/graph'
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
import { type FormatTarget, layerPlace } from '../src/graph/format/route.ts'
import type { LayerSelection } from '../src/graph/inspector/context.ts'
import type { PointRef } from '../src/graph/pointEdits.ts'
import type { AppServices } from '../src/services.ts'

// Roadmap 47: the Format panel's list of layers selects several rows (⌘- / Ctrl-click toggles,
// Shift-click and Shift+↑ / ↓ a range front first, ⌘A all), the view holding the selection; its
// toolbar, eye and keys act on every selected layer in one undo step; a point's place shown for
// one of several selected points writes to each.

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

function setup() {
  const table = createTable({ tableKind: 'column', columns: 2, rows: 3 })
  table.dataSets[0]!.subcolumns[0]!.values = [1, 4, 9]
  table.dataSets[1]!.subcolumns[0]!.values = [2, 3, 5]
  const base = createGraphFor(table)
  const error = base.layers.find((l) => l.id === 'error')!
  // Back to front: points, error, center, centerError (on center).
  const graph: GraphNode = {
    ...base,
    id: 'g1' as NodeId,
    layers: [...base.layers, { ...error, id: 'centerError', on: 'center' } as Layer],
  }
  const project: Project = createProject()
  project.nodes[table.id] = table
  project.nodes[graph.id] = graph
  project.order.push(table.id, graph.id)
  const store = new DocumentStore(project)
  const engine = { subscribe: () => () => {}, version: 0, latest: () => undefined }
  const services = { store, engine, platform: {} } as unknown as AppServices
  const g = () => store.getState().nodes[graph.id] as GraphNode
  const order = () =>
    g()
      .layers.map((l) => l.id)
      .join(' ')
  const ds = table.dataSets.map((d) => d.id as string)
  return { store, graph, services, g, order, ds }
}

/** What the view holds: the layers selected and the place shown (as GraphView does). */
const view: { ids: readonly string[]; primary: string | null; target: FormatTarget | null } = {
  ids: [],
  primary: null,
  target: null,
}
let answer = true

function Panel({
  s,
  start,
  points,
}: {
  s: ReturnType<typeof setup>
  start: FormatTarget
  points?: readonly PointRef[]
}) {
  const [held, setHeld] = useState<{ ids: readonly string[]; primary: string | null }>({
    ids: [],
    primary: null,
  })
  const [target, setTarget] = useState(start)
  const layerSelection: LayerSelection = {
    ids: held.ids,
    primary: held.primary ?? undefined,
    select: (ids, primary) => {
      setHeld({ ids, primary })
      if (primary) setTarget(layerPlace(primary, 'layers'))
      Object.assign(view, { ids, primary, target: primary ? layerPlace(primary) : null })
    },
  }
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
      layerSelection={layerSelection}
      {...(points ? { points } : {})}
    />
  )
}

function render(s: ReturnType<typeof setup>, start: FormatTarget, points?: readonly PointRef[]) {
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  act(() =>
    root!.render(
      <ServicesContext.Provider value={s.services}>
        <ConfirmContext.Provider value={() => Promise.resolve(answer)}>
          <Panel s={s} start={start} {...(points ? { points } : {})} />
        </ConfirmContext.Provider>
      </ServicesContext.Provider>,
    ),
  )
}

const list = () => host!.querySelector('[role="listbox"]') as HTMLElement
const rows = () => [...list().querySelectorAll('[role="option"]')] as HTMLElement[]
const row = (i: number) => rows()[i]!
const selectedRows = () =>
  rows().flatMap((r, i) => (r.getAttribute('aria-selected') === 'true' ? [i] : []))
const toolbar = (name: string) =>
  [...host!.querySelectorAll('.layers-toolbar button')].find(
    (b) => b.textContent === name || b.getAttribute('aria-label') === name,
  ) as HTMLButtonElement
const click = (el: HTMLElement, opts: MouseEventInit = {}) =>
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, ...opts }))
  })
const key = (k: string, opts: KeyboardEventInit = {}) =>
  act(() => {
    list().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...opts }))
  })

describe('the list of layers, several selected', () => {
  it('selects with ⌘- / Ctrl-click, Shift-click and Shift+arrows, front first', () => {
    const s = setup()
    render(s, layerPlace('centerError', 'layers'))
    expect(list().getAttribute('aria-multiselectable')).toBe('true')
    // Rows front first: centerError, center, error, points.
    expect(rows().map((r) => r.id.split('-').at(-1))).toEqual([
      'centerError',
      'center',
      'error',
      'points',
    ])
    expect(selectedRows()).toEqual([0])
    click(row(1))
    expect(selectedRows()).toEqual([1])
    click(row(3), { ctrlKey: true })
    expect(selectedRows()).toEqual([1, 3])
    expect(view.primary).toBe('points')
    // ⌘-click again takes it out.
    click(row(3), { metaKey: true })
    expect(selectedRows()).toEqual([1])
    // Shift: from the row last clicked without Shift (center) to this one.
    click(row(1))
    click(row(3), { shiftKey: true })
    expect(selectedRows()).toEqual([1, 2, 3])
    expect(view.ids).toEqual(['center', 'error', 'points'])
    expect(view.primary).toBe('points')
    // Shift+↑ from the last (points) towards the front: the range shrinks to center…error.
    key('ArrowUp', { shiftKey: true })
    expect(selectedRows()).toEqual([1, 2])
    // A plain arrow: one row.
    key('ArrowDown')
    expect(selectedRows()).toEqual([3])
    // Every row with ⌘A / Ctrl+A.
    key('a', { ctrlKey: true, metaKey: true })
    expect(selectedRows()).toEqual([0, 1, 2, 3])
    expect(host!.querySelector('.layers-count')?.textContent).toMatch(/^4 layers selected/)
  })

  it('hides, moves and removes every selected layer, one undo step each', async () => {
    const s = setup()
    answer = true
    render(s, layerPlace('points', 'layers'))
    click(row(3))
    click(row(2), { ctrlKey: true })
    // Hide (the toolbar): both, one step.
    click(toolbar('Hide'))
    expect(s.store.undoLabel).toBe('Hide 2 layers')
    expect(
      s
        .g()
        .layers.filter((l) => l.visible === false)
        .map((l) => l.id),
    ).toEqual(['points', 'error'])
    // Space shows them again; the eye on a selected row acts on both too.
    key(' ')
    expect(s.store.undoLabel).toBe('Show 2 layers')
    click(row(3).querySelector('.eye') as HTMLElement)
    expect(s.store.undoLabel).toBe('Hide 2 layers')
    act(() => s.store.undo())
    // Alt+↑: the block forward past the centre line and its error bars.
    key('ArrowUp', { altKey: true })
    expect(s.order()).toBe('center centerError points error')
    expect(s.store.undoLabel).toBe('Bring 2 layers forward')
    expect(toolbar('Bring layer forward').disabled).toBe(true)
    act(() => s.store.undo())
    // Duplicate: copies selected.
    click(toolbar('Duplicate'))
    expect(s.store.undoLabel).toBe('Duplicate 2 layers')
    expect(s.g().layers).toHaveLength(6)
    expect(view.ids).toHaveLength(2)
    act(() => s.store.undo())
    // Delete: the centre line with them takes its error bars along, asked first.
    click(row(0))
    click(row(1), { shiftKey: true })
    click(row(3), { ctrlKey: true })
    expect(selectedRows()).toEqual([0, 1, 3])
    await act(async () => {
      key('Delete')
    })
    expect(s.store.undoLabel).toBe('Delete 3 layers')
    expect(s.order()).toBe('error')
    act(() => s.store.undo())
    expect(s.order()).toBe('points error center centerError')
    // Cancelled: nothing removed.
    answer = false
    click(row(1))
    await act(async () => {
      click(toolbar('Delete'))
    })
    expect(s.order()).toBe('points error center centerError')
  })
})

describe('+ Add ▾ (audit 3, A6)', () => {
  const press = (k: string) =>
    act(() => {
      ;(document.activeElement as HTMLElement).dispatchEvent(
        new KeyboardEvent('keydown', { key: k, bubbles: true }),
      )
    })
  const menus = () => [...host!.querySelectorAll('[role="menu"]')] as HTMLElement[]
  const item = () => document.activeElement as HTMLElement

  it('is the app’s menu: the focus in it, arrows, a family’s submenu, Escape back to the button', () => {
    const s = setup()
    render(s, layerPlace('points', 'layers'))
    const add = toolbar('+ Add ▾')
    act(() => add.focus())
    click(add)
    expect(add.getAttribute('aria-expanded')).toBe('true')
    const [menu] = menus()
    expect(menu?.getAttribute('aria-label')).toBe('Add a layer')
    // Families first, each a submenu; the focus on the first.
    expect(item().getAttribute('role')).toBe('menuitem')
    expect(item().getAttribute('aria-haspopup')).toBe('menu')
    expect(item().textContent).toMatch(/^Raw values/)
    press('ArrowDown')
    expect(item().textContent).toMatch(/^Summaries/)
    // Escape: closed, the focus back on the button (not the panel's Escape to the canvas).
    press('Escape')
    expect(menus()).toHaveLength(0)
    expect(add.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(add)
    // → opens a family; Enter adds the style focused, one step, and selects the new layer.
    click(add)
    press('ArrowDown')
    press('ArrowRight')
    expect(menus()).toHaveLength(2)
    const style = item().textContent ?? ''
    const before = s.g().layers.length
    act(() => item().click())
    expect(menus()).toHaveLength(0)
    expect(s.g().layers).toHaveLength(before + 1)
    expect(s.store.undoLabel).toBe(`Add ${style.toLowerCase()}`)
  })
})

describe('the Format panel on several points', () => {
  it('heads the point, writes each change to every selected point', () => {
    const s = setup()
    const [A, B] = s.ds as [string, string]
    const pts: PointRef[] = [
      [A, 'r0s0'],
      [A, 'r1s0'],
      [B, 'r2s0'],
    ]
    render(s, { place: 'series', series: { dataSet: A, point: 'r0s0' } } as FormatTarget, pts)
    expect(host!.querySelector('.point-banner strong')?.textContent).toBe('These 3 points')
    const hide = [...host!.querySelectorAll('label')].find((l) =>
      l.textContent?.startsWith('Hide this point'),
    )!
    click(hide.querySelector('input')!)
    expect(s.store.undoLabel).toBe('Format point (3 points)')
    for (const [d, p] of pts) expect(s.g().pointOverrides?.[d as never]?.[p]?.hide).toBe(true)
    act(() => s.store.undo())
    expect(s.g().pointOverrides).toBeUndefined()
  })

  it('a border width keeps each point’s own border colour and dash', () => {
    const s = setup()
    const [A, B] = s.ds as [string, string]
    const red = { color: { rgb: '#ff0000' }, width: 1, dash: 'solid' }
    const blue = { color: { rgb: '#0000ff' }, width: 1.5, dash: 'dash' }
    // Shown: a point with no border of its own; the others have their own colours.
    const pts: PointRef[] = [
      [A, 'r0s0'],
      [B, 'r1s0'],
      [A, 'r2s0'],
    ]
    s.store.dispatch(
      [
        {
          type: 'node.set',
          id: s.graph.id,
          path: ['pointOverrides', A, 'r0s0', 'border'],
          value: red,
        },
        {
          type: 'node.set',
          id: s.graph.id,
          path: ['pointOverrides', B, 'r1s0', 'border'],
          value: blue,
        },
      ],
      'Format point',
    )
    render(s, { place: 'series', series: { dataSet: A, point: 'r2s0' } } as FormatTarget, pts)
    const label = [...host!.querySelectorAll('label')].find((l) => l.textContent === 'Border (pt)')!
    const input = (label.querySelector('input') ??
      document.getElementById(label.htmlFor)) as HTMLInputElement
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    act(() => {
      setValue.call(input, '3')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const border = (d: string, p: string) => s.g().pointOverrides?.[d as never]?.[p]?.border
    expect(border(A, 'r0s0')).toEqual({ ...red, width: 3 })
    expect(border(B, 'r1s0')).toEqual({ ...blue, width: 3 })
    expect(border(A, 'r2s0')?.width).toBe(3)
    expect(s.store.undoLabel).toBe('Format point (3 points)')
  })
})
