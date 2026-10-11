// @vitest-environment happy-dom
import { DocumentStore } from '@ps/engine'
import { createGraphFor } from '@ps/graph'
import { createProject, createTable, type GraphNode, type NodeId, type Project } from '@ps/model'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ServicesContext } from '../src/context.tsx'
import { FormatPanel, fieldOf } from '../src/graph/format/FormatPanel.tsx'
import type { FormatFocus } from '../src/graph/format/formatHost.ts'
import { panelKeyStays } from '../src/graph/format/formatHost.ts'
import { PanelSteps } from '../src/graph/format/panelSteps.ts'
import {
  axisPlace,
  type FormatTarget,
  graphPlace,
  LEGEND_PLACE,
  layerView,
  pointPlace,
} from '../src/graph/format/route.ts'
import { FORMAT_SECTIONS, placeOf, sectionsFor } from '../src/graph/format/sections.tsx'
import type { AppServices } from '../src/services.ts'

// Roadmap 46: the docked Format panel's shell — it follows the place it is given (the canvas'
// selection), writes straight to the document with one step per change (quick repeats of one
// field merged), Revert takes back what it did since the selection began, the focus moves in only
// when asked and Escape gives it back; keys typed in it never reach the view's.

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
  const graph: GraphNode = { ...createGraphFor(table), id: 'g1' as NodeId }
  const project: Project = createProject()
  project.nodes[table.id] = table
  project.nodes[graph.id] = graph
  project.order.push(table.id, graph.id)
  let now = 1000
  const store = new DocumentStore(project, { now: () => now })
  const clock = (ms: number) => {
    now += ms
  }
  const engine = { subscribe: () => () => {}, version: 0, latest: () => undefined }
  const services = { store, engine, platform: {} } as unknown as AppServices
  return { store, graph, services, clock }
}

interface Props {
  target: FormatTarget
  scope: string
  focus?: FormatFocus | null
  onEscape?: () => void
  onNotice?: (msg: string) => void
}

function render(s: ReturnType<typeof setup>, p: Props) {
  host ??= document.body.appendChild(document.createElement('div'))
  root ??= createRoot(host)
  act(() =>
    root!.render(
      <ServicesContext.Provider value={s.services}>
        <button type="button">canvas</button>
        <FormatPanel
          graphId={s.graph.id}
          target={p.target}
          setTarget={() => {}}
          name="Y axis"
          scope={p.scope}
          onSelect={() => {}}
          onOpenWindow={() => {}}
          onClose={() => {}}
          onEscape={p.onEscape ?? (() => {})}
          focus={p.focus ?? null}
          onNotice={p.onNotice ?? (() => {})}
        />
      </ServicesContext.Provider>,
    ),
  )
  return host
}

const panel = () => host!.querySelector('aside.format-panel') as HTMLElement
const byLabel = (text: string) => {
  const label = [...panel().querySelectorAll('label')].find((l) => l.textContent === text)!
  // A checkbox inside its label, else the control the label is for.
  return (label.querySelector('input') ??
    document.getElementById(label.htmlFor)) as HTMLInputElement
}
const button = (name: string) =>
  [...panel().querySelectorAll('button')].find((b) => b.textContent === name) as HTMLButtonElement
const selectedTab = () => panel().querySelector('[role="tab"][aria-selected="true"]')

/** Types a value into a field as a user would (React listens for `input`). */
function type(input: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const click = (el: HTMLElement) => act(() => el.click())

describe('the Format panel', () => {
  it('is a labelled complementary region that follows the place it is given', () => {
    const s = setup()
    render(s, { target: axisPlace('y'), scope: 'y' })
    // An aside: role complementary, named by its heading.
    expect(panel().tagName).toBe('ASIDE')
    expect(panel().getAttribute('aria-labelledby')).toBe(panel().querySelector('h2')!.id)
    expect(selectedTab()?.textContent).toBe('Y axis')
    render(s, { target: axisPlace('x'), scope: 'x' })
    expect(selectedTab()?.textContent).toBe('X axis')
    // Places other than the axes have no tabs.
    render(s, { target: graphPlace(), scope: 'graph' })
    expect(selectedTab()).toBeNull()
  })

  it('writes to the document at once: one step per field, quick repeats merged', () => {
    const s = setup()
    render(s, { target: axisPlace('y'), scope: 'y' })
    click(byLabel('Automatic range'))
    expect(s.store.historyLength.undo).toBe(1)
    const range = () => (s.store.getState().nodes[s.graph.id] as GraphNode).axes.y
    // Two keystrokes of the maximum: one step.
    type(byLabel('Maximum'), '6')
    s.clock(300)
    type(byLabel('Maximum'), '60')
    expect(s.store.historyLength.undo).toBe(2)
    expect((range() as { range: { max: number } }).range.max).toBe(60)
    // The minimum is another field: its own step; the maximum again, after it, too.
    type(byLabel('Minimum'), '5')
    type(byLabel('Maximum'), '70')
    expect(s.store.historyLength.undo).toBe(4)
    // A pause longer than the merge window: a new step for the same field.
    s.clock(5000)
    type(byLabel('Maximum'), '80')
    expect(s.store.historyLength.undo).toBe(5)
    // Undoing the merged step puts back the maximum from before both keystrokes.
    act(() => {
      for (let i = 0; i < 3; i++) s.store.undo()
    })
    expect((range() as { range: { max: number } }).range.max).toBe(60)
    act(() => s.store.undo())
    expect((range() as { range: { max: number } }).range.max).toBe(10)
  })

  it('follows an outside change while a field has focus, and never writes it back on blur', () => {
    // Audit 3 (U1): a focused live field kept its stale text through an Undo (menu, toolbar,
    // notice) or a format-bar change, and wrote it back on blur: the undo silently re-done.
    const s = setup()
    render(s, { target: axisPlace('y'), scope: 'y' })
    click(byLabel('Automatic range'))
    const range = () =>
      (s.store.getState().nodes[s.graph.id] as GraphNode).axes.y as { range: { max: number } }
    const max = byLabel('Maximum')
    act(() => max.focus())
    type(max, '60')
    expect(range().range.max).toBe(60)
    act(() => s.store.undo())
    // The field shows the value undone to, while it still has the focus …
    expect(document.activeElement).toBe(max)
    expect(max.value).toBe('10')
    // … and leaving it writes nothing: the undo stays undone, its redo kept.
    act(() => max.blur())
    expect(range().range.max).toBe(10)
    expect(s.store.historyLength.redo).toBe(1)
    // A field focused but not typed in, changed from outside (the format bar): it follows, and
    // its blur writes nothing.
    const depth = s.store.historyLength.undo
    act(() => max.focus())
    act(() =>
      s.store.dispatch({
        type: 'node.set',
        id: s.graph.id,
        path: ['axes', 'y', 'range', 'max'],
        value: 25,
      }),
    )
    expect(max.value).toBe('25')
    act(() => max.blur())
    expect(range().range.max).toBe(25)
    expect(s.store.historyLength.undo).toBe(depth + 1)
  })

  it('keeps a rich text field in step with an outside change while it has focus', () => {
    const s = setup()
    render(s, { target: axisPlace('y', 'title'), scope: 'y/title' })
    const box = panel().querySelector('[role="textbox"]') as HTMLElement
    const title = () => (s.store.getState().nodes[s.graph.id] as GraphNode).axes.y.title
    const before = JSON.stringify(title())
    act(() => box.focus())
    act(() => {
      box.textContent = 'Typed'
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(JSON.stringify(title())).not.toBe(before)
    act(() => s.store.undo())
    expect(JSON.stringify(title())).toBe(before)
    expect(box.textContent).not.toBe('Typed')
    act(() => box.blur())
    expect(JSON.stringify(title())).toBe(before)
    expect(s.store.historyLength.redo).toBe(1)
  })

  it('merges quick repeats of one field only, when fields share an object (audit 3, U4)', () => {
    localStorage.clear()
    const s = setup()
    render(s, { target: axisPlace('y'), scope: 'y' })
    click(button('Ticks'))
    // Length, then thickness within the merge window: two fields of `tickStyle`, two steps.
    type(byLabel('Tick length (pt)'), '6')
    s.clock(300)
    type(byLabel('Tick thickness (pt)'), '2')
    expect(s.store.historyLength.undo).toBe(2)
    // Thickness again: merged into its own step.
    s.clock(300)
    type(byLabel('Tick thickness (pt)'), '3')
    expect(s.store.historyLength.undo).toBe(2)
    const y = () => (s.store.getState().nodes[s.graph.id] as GraphNode).axes.y
    expect(y().tickStyle).toMatchObject({ length: 6, width: 3 })
    act(() => s.store.undo())
    expect(y().tickStyle).toMatchObject({ length: 6 })
    expect(y().tickStyle?.width).toBeUndefined()
    localStorage.clear()
  })

  it('reverts what it did since its scope began, and says so', () => {
    const s = setup()
    const onNotice = vi.fn()
    render(s, { target: axisPlace('y'), scope: 'y', onNotice })
    expect(button('Revert').disabled).toBe(true)
    click(byLabel('Reverse the axis'))
    click(byLabel('Automatic range'))
    expect(button('Revert').disabled).toBe(false)
    click(button('Revert'))
    expect(s.store.historyLength.undo).toBe(0)
    expect(onNotice).toHaveBeenCalledWith('Reverted 2 changes to Y axis')
    expect(button('Revert').disabled).toBe(true)
    // Another scope: what was done before is not its to revert.
    click(byLabel('Reverse the axis'))
    render(s, { target: axisPlace('y'), scope: 'another' })
    expect(button('Revert').disabled).toBe(true)
  })

  it('moves the focus in only when asked; Escape gives it back; its keys stay in it', () => {
    const s = setup()
    const onEscape = vi.fn()
    render(s, { target: axisPlace('y'), scope: 'y', onEscape })
    expect(panel().contains(document.activeElement)).toBe(false)
    render(s, { target: axisPlace('y'), scope: 'y', onEscape, focus: { seq: 1 } })
    expect(document.activeElement).toBe(selectedTab())
    // A key pressed in the panel never reaches the window (the view's keys: nudges, Delete).
    const heard = vi.fn()
    window.addEventListener('keydown', heard)
    const box = byLabel('Reverse the axis')
    act(() => {
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    })
    expect(heard).not.toHaveBeenCalled()
    // ⌘Z still does (the app's undo).
    act(() => {
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }))
    })
    expect(heard).toHaveBeenCalledTimes(1)
    window.removeEventListener('keydown', heard)
    act(() => {
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onEscape).toHaveBeenCalledTimes(1)
    // At a section: scrolled to and its first control focused (a field search's jump).
    render(s, {
      target: axisPlace('x'),
      scope: 'x',
      onEscape,
      focus: { seq: 2, section: 'title' },
    })
    const at = panel().querySelector('[data-format-section="title"]')!
    expect(at.contains(document.activeElement)).toBe(true)
  })
})

describe('places by element (stage 2)', () => {
  /** The panel's section toggles: title → open. */
  const toggles = () =>
    Object.fromEntries(
      [...panel().querySelectorAll<HTMLButtonElement>('button.section-toggle')].map((b) => [
        b.textContent!,
        b.getAttribute('aria-expanded') === 'true',
      ]),
    )

  it('opens on Common, the other sections closed, their state remembered per kind', () => {
    localStorage.clear()
    const s = setup()
    render(s, { target: axisPlace('y'), scope: 'y' })
    expect(Object.keys(toggles())[0]).toBe('Common')
    expect(toggles()).toMatchObject({ Common: true, Numbers: false, 'Grid lines': false })
    // Common holds the range and scale, the interval, the tick marks and the title's font.
    for (const label of ['Scale', 'Automatic range', 'Tick marks', 'Tick label font'])
      expect(byLabel(label), label).toBeTruthy()
    // Opened on one axis, Grid lines is open on the other too (the same kind of element)…
    click(button('Grid lines'))
    render(s, { target: axisPlace('x'), scope: 'x' })
    expect(toggles()).toMatchObject({ Common: true, 'Grid lines': true, Labels: false })
    // … but not in another kind's place.
    render(s, { target: LEGEND_PLACE, scope: 'legend' })
    expect(toggles()).toMatchObject({ Common: true, Entries: false, Text: false })
    localStorage.clear()
  })

  it('opens the section a target names (an axis title clicked: its Title)', () => {
    localStorage.clear()
    const s = setup()
    render(s, { target: axisPlace('y', 'title'), scope: 'y/title' })
    expect(toggles()).toMatchObject({ Common: true, Title: true, Numbers: false })
    expect(byLabel('Extra space between title and axis (pt)')).toBeTruthy()
  })

  it('shows a data set in one layer: its colour row first, then that layer’s sections only', () => {
    localStorage.clear()
    const s = setup()
    const table = Object.values(s.store.getState().nodes).find((n) => n.kind === 'table')!
    const first = (table as { dataSets: { id: string }[] }).dataSets[0]!.id
    render(s, { target: layerView('points', { dataSet: first }), scope: 'ds' })
    const t = toggles()
    // Roadmap 49b: the points' own sections (Symbols open), no other layer's (no Error bars).
    expect(Object.keys(t)[0]).toBe('Symbols')
    expect(t).toMatchObject({ Symbols: true, Advanced: false })
    expect(Object.keys(t)).not.toContain('Error bars')
    expect(panel().querySelector('[role="listbox"]')).toBeNull()
    const colour = panel().querySelector('[data-format-section="colour"]')!
    expect(colour.textContent).toContain('Data set colour (every layer)')
    // The arrows head the view: ‹ 1 of n ▾ ›.
    expect(panel().querySelector('.layer-steps')).not.toBeNull()
  })
})

describe('the panel’s steps (Revert)', () => {
  it('follows undo and redo, and ends at a step made elsewhere', () => {
    const s = setup()
    const steps = new PanelSteps(s.store)
    const off = steps.attach()
    steps.begin('y')
    const set = (path: string[], value: unknown) =>
      steps.run(() => s.store.dispatch({ type: 'node.set', id: 'g1' as NodeId, path, value }))
    set(['axes', 'y', 'reverse'], true)
    set(['axes', 'y', 'range'], { min: 0, max: 10 })
    expect(steps.count).toBe(2)
    s.store.undo()
    expect(steps.count).toBe(1)
    s.store.redo()
    expect(steps.count).toBe(2)
    // A change that changes nothing is no step.
    set(['axes', 'y', 'reverse'], true)
    expect(steps.count).toBe(2)
    // A step made elsewhere: nothing to revert any more.
    s.store.dispatch({ type: 'node.set', id: 'g1' as NodeId, path: ['name'], value: 'Other' })
    expect(steps.count).toBe(0)
    expect(steps.revert()).toBe(0)
    expect(s.store.historyLength.undo).toBe(3)
    off()
  })

  it('keys its merges by scope and field', () => {
    const s = setup()
    const steps = new PanelSteps(s.store)
    steps.begin('y')
    const a = steps.key('g1:axes/y/range/max')
    steps.begin('x')
    steps.begin('y')
    // Back to the same selection: a new scope, so no merge into the earlier one's step.
    expect(steps.key('g1:axes/y/range/max')).not.toBe(a)
    expect(steps.key('g1:axes/y/range/min')).not.toBe(steps.key('g1:axes/y/range/max'))
  })
})

describe('the panel’s parts', () => {
  it('merges node.set changes by the paths they write, never other commands', () => {
    const id = 'g1' as NodeId
    expect(fieldOf({ type: 'node.set', id, path: ['axes', 'y', 'reverse'], value: true })).toBe(
      'g1:axes/y/reverse',
    )
    expect(
      fieldOf([
        { type: 'node.set', id, path: ['a'], value: 1 },
        { type: 'node.set', id, path: ['b'], value: 2 },
      ]),
    ).toBe('g1:a|g1:b')
    expect(fieldOf({ type: 'graph.removeLayer', id, layer: 'l1' })).toBeUndefined()
  })

  it('keeps plain keys and the canvas’ ⌘ keys in the panel, the app’s ⌘ keys not', () => {
    const k = (
      key: string,
      mods: Partial<Record<'meta' | 'ctrl' | 'alt' | 'shift', boolean>> = {},
    ) =>
      panelKeyStays({
        key,
        metaKey: !!mods.meta,
        ctrlKey: !!mods.ctrl,
        altKey: !!mods.alt,
        shiftKey: !!mods.shift,
      })
    for (const key of ['ArrowLeft', 'Delete', 'Backspace', 'Enter', 'a', ']', 'Tab'])
      expect(k(key)).toBe(true)
    for (const key of ['a', 'b', 'i']) expect(k(key, { meta: true })).toBe(true)
    expect(k('>', { meta: true, shift: true })).toBe(true)
    // Audit 3 (U7): ⌘, (Preferences) and ⌘. reach the app; with Shift they size the text.
    expect(k(',', { meta: true })).toBe(false)
    expect(k('.', { ctrl: true })).toBe(false)
    expect(k(',', { meta: true, shift: true })).toBe(true)
    expect(k('.', { ctrl: true, shift: true })).toBe(true)
    expect(k('c', { meta: true, alt: true })).toBe(true)
    for (const key of ['z', 's', '1', 'p', 'k']) expect(k(key, { meta: true })).toBe(false)
    expect(k('E', { ctrl: true, shift: true })).toBe(false)
  })

  it('gives every place its sections, ids unique within each', () => {
    for (const [place, list] of Object.entries(FORMAT_SECTIONS)) {
      expect(list.length, place).toBeGreaterThan(0)
      expect(new Set(list.map((x) => x.id)).size, place).toBe(list.length)
    }
    expect(placeOf(axisPlace('y'))).toBe('axis')
    expect(placeOf(LEGEND_PLACE)).toBe('legend')
    expect(placeOf(pointPlace('a', 'r1s0'))).toBe('point')
    expect(placeOf(layerView('l', { dataSet: 'a' }))).toBe('layer')
    expect(sectionsFor(graphPlace()).map((x) => x.id)).toContain('size')
    // Every place opens on its Common settings (the graph: its layer list, then Common).
    for (const [place, list] of Object.entries(FORMAT_SECTIONS)) {
      const first = list.findIndex((x) => x.id === 'common')
      if (first >= 0)
        expect(
          list.slice(0, first).every((x) => x.open),
          place,
        ).toBe(true)
    }
  })
})
