// @vitest-environment happy-dom
import { registry } from '@ps/analyses'
import { DocumentStore } from '@ps/engine'
import { createGraphFor } from '@ps/graph'
import {
  type AnalysisNode,
  createProject,
  createTable,
  type DocNode,
  type GraphNode,
  type NodeId,
  newNodeId,
  type Project,
} from '@ps/model'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  type Command,
  CommandsContext,
  createCommandRegistry,
  useCommands,
} from '../src/commands/index.ts'
import type { CommandRegistry } from '../src/commands/registry.ts'
import { ServicesContext } from '../src/context.tsx'
import { GettingStarted } from '../src/onboarding/GettingStarted.tsx'
import {
  documentTicks,
  doneCount,
  GETTING_STARTED_KEY,
  isFormatEdit,
  NO_TICKS,
  readCardPref,
  tableHasValues,
  tickMore,
  writeCardPref,
} from '../src/onboarding/steps.ts'
import type { AppServices } from '../src/services.ts'

// Roadmap 47 (UX findings N8, N9): the getting-started checklist — its steps ticked off by the
// document, its changes and finished exports; shown on a new project only, hidden with × for good
// (localStorage) and shown again by Help › Getting started; "Show me" running the next command.

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
beforeEach(() => localStorage.clear())

let root: Root | null = null
let host: HTMLElement | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  host?.remove()
  host = null
})

const projectOf = (...nodes: DocNode[]): Project => {
  const p = createProject()
  for (const n of nodes) {
    p.nodes[n.id] = n
    p.order.push(n.id)
  }
  return p
}
const analysisOf = (t: ReturnType<typeof createTable>): AnalysisNode => ({
  kind: 'analysis',
  id: newNodeId(),
  name: 'Descriptive statistics',
  analysisId: 'descriptive',
  pluginVersion: registry.get('descriptive')!.version,
  input: { source: t.id, dataSets: t.dataSets.map((d) => d.id) },
  params: registry.get('descriptive')!.params.parse({}),
})
const filledTable = () => {
  const t = createTable({ tableKind: 'column', columns: 2, rows: 3, name: 'Data 1' })
  t.dataSets[0]!.subcolumns[0]!.values = [1, 2, 3]
  return t
}

describe('the checklist’s steps', () => {
  it('see data, a graph and an analysis in the document', () => {
    const empty = createTable({ tableKind: 'column', columns: 2, rows: 3 })
    expect(tableHasValues(empty)).toBe(false)
    expect(documentTicks(projectOf(empty))).toEqual({})
    const text = createTable({ tableKind: 'multipleVariables', columns: 1, rows: 2 })
    text.dataSets[0]!.text = [null, 'a']
    expect(tableHasValues(text)).toBe(true)
    const t = filledTable()
    const g = createGraphFor(t, 'Data 1')
    const a = analysisOf(t)
    expect(documentTicks(projectOf(t, g, a))).toEqual({ data: true, graph: true, analysis: true })
  })

  it('stay ticked, and count', () => {
    let t = tickMore(NO_TICKS, { data: true, graph: false })
    expect(t).toMatchObject({ data: true, graph: false })
    expect(tickMore(t, { data: true })).toBe(t)
    t = tickMore(t, { export: true })
    expect(doneCount(t)).toBe(2)
  })

  it('count a change to an existing graph as formatting, not a rename or a step adding a sheet', () => {
    const t = filledTable()
    const g = createGraphFor(t, 'Data 1')
    const store = new DocumentStore(projectOf(t, g))
    const changes: boolean[] = []
    let before = store.getState()
    store.subscribe((after, change) => {
      changes.push(isFormatEdit(before, after, change))
      before = after
    })
    // A graph's style: formatting.
    const styled: GraphNode = { ...g, style: { ...g.style, text: { size: 14 } } } as GraphNode
    store.dispatch({ type: 'node.replace', node: styled } as never)
    // A rename: not.
    store.dispatch({ type: 'node.rename', id: g.id, name: 'Renamed' } as never)
    // A new graph with a change to the old one in the same step: not.
    const g2 = createGraphFor(t, 'Data 1 (2)')
    store.dispatch([
      { type: 'node.add', node: g2 },
      { type: 'node.replace', node: { ...styled, name: 'Renamed', style: g.style } },
    ] as never)
    // Undo: not.
    store.undo()
    // A table's cells: not.
    store.dispatch({
      type: 'table.setCells',
      table: t.id,
      edits: [{ col: t.dataSets[0]!.id, sub: 0, row: 0, value: 9 }],
    } as never)
    expect(changes).toEqual([true, false, false, false, false])
  })

  it('remember the card hidden or folded (localStorage)', () => {
    expect(readCardPref()).toBe('open')
    writeCardPref('hidden')
    expect(localStorage.getItem(GETTING_STARTED_KEY)).toBe('hidden')
    expect(readCardPref()).toBe('hidden')
    writeCardPref('collapsed')
    expect(readCardPref()).toBe('collapsed')
    writeCardPref('open')
    expect(localStorage.getItem(GETTING_STARTED_KEY)).toBeNull()
    // Storage that throws: shown open.
    expect(
      readCardPref({
        getItem: () => {
          throw new Error('denied')
        },
      }),
    ).toBe('open')
  })
})

/** A fake figure exporter: `finish()` as an export finishing. */
function fakeExporter() {
  const listeners = new Set<() => void>()
  const x = {
    finished: 0,
    subscribe: (fn: () => void) => {
      listeners.add(fn)
      return () => void listeners.delete(fn)
    },
    finish() {
      x.finished++
      for (const fn of listeners) fn()
    },
  }
  return x
}

interface Ran {
  id: string
  selected: NodeId | null
}

/** The shell around the card: the selection, and commands that need a table or a graph shown. */
function Shell({
  ran,
  exporter,
  onReady,
}: {
  ran: Ran[]
  exporter: ReturnType<typeof fakeExporter>
  onReady: (select: (id: NodeId | null) => void) => void
}) {
  const [selected, setSelected] = useState<NodeId | null>(null)
  onReady(setSelected)
  const kind = selected ? 'sheet' : null
  const cmd = (id: string, enabled = true): Command => ({
    id,
    label: id,
    enabled,
    run: () => ran.push({ id, selected }),
  })
  useCommands('app', [
    cmd('insert.table'),
    cmd('insert.graph', kind !== null),
    cmd('analyze.guide', kind !== null),
    cmd('format.graph', kind !== null),
    cmd('file.export', kind !== null),
  ])
  return (
    <GettingStarted
      selected={selected}
      onSelect={setSelected}
      onShow={() => ran.push({ id: 'navigator', selected })}
      exporter={exporter}
    />
  )
}

function mount(project: Project) {
  const store = new DocumentStore(project)
  const registry: CommandRegistry = createCommandRegistry()
  const services = { store, engine: {}, platform: {} } as unknown as AppServices
  const ran: Ran[] = []
  const exporter = fakeExporter()
  let select: (id: NodeId | null) => void = () => {}
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  act(() =>
    root!.render(
      <ServicesContext.Provider value={services}>
        <CommandsContext.Provider value={registry}>
          <Shell ran={ran} exporter={exporter} onReady={(s) => (select = s)} />
        </CommandsContext.Provider>
      </ServicesContext.Provider>,
    ),
  )
  return { store, registry, ran, exporter, select: (id: NodeId | null) => act(() => select(id)) }
}

const card = () => host!.querySelector('section.getting-started')
const count = () => card()?.querySelector('.gs-count')?.textContent
const doneSteps = () =>
  [...(card()?.querySelectorAll('li.done') ?? [])].map((li) => (li as HTMLElement).dataset.step)
const showMe = (step: string) =>
  card()!.querySelector<HTMLButtonElement>(`li[data-step="${step}"] .gs-show`)!
const click = (el: Element) => act(() => (el as HTMLElement).click())
const settle = () => act(() => new Promise((r) => setTimeout(r, 20)))

describe('the getting-started card', () => {
  it('shows on a new project and ticks its steps as they are done', async () => {
    const m = mount(createProject())
    expect(card()).not.toBeNull()
    expect(count()).toBe('0 of 5')
    // Nothing takes the focus.
    expect(card()!.contains(document.activeElement)).toBe(false)
    const t = filledTable()
    const g = createGraphFor(t, 'Data 1')
    act(() =>
      m.store.dispatch([
        { type: 'node.add', node: t },
        { type: 'node.add', node: g },
      ]),
    )
    expect(doneSteps()).toEqual(['data', 'graph'])
    // A format edit.
    act(() =>
      m.store.dispatch({
        type: 'node.replace',
        node: { ...g, style: { ...g.style, text: { size: 14 } } },
      } as never),
    )
    expect(doneSteps()).toEqual(['data', 'graph', 'format'])
    // An analysis.
    const a = analysisOf(t)
    act(() => m.store.dispatch({ type: 'node.add', node: a }))
    // An export finished.
    act(() => m.exporter.finish())
    expect(count()).toBe('5 of 5')
    expect(card()!.querySelector('.gs-all')?.textContent).toContain('All done')
    // Deleting the graph unticks nothing.
    act(() => m.store.dispatch({ type: 'node.remove', id: g.id } as never))
    expect(count()).toBe('5 of 5')
    // Its "Hide this" hides it for good.
    click(card()!.querySelector('.gs-all button')!)
    expect(card()).toBeNull()
    expect(readCardPref()).toBe('hidden')
  })

  it('is not shown on a project opened with sheets (a file, an example), until asked for', () => {
    const t = filledTable()
    const m = mount(projectOf(t, createGraphFor(t, 'Data 1')))
    expect(card()).toBeNull()
    // Help › Getting started: shown (the navigator too), with what the document has done.
    expect(m.registry.get('help.gettingStarted')?.menu?.menu).toBe('help')
    act(() => void m.registry.run('help.gettingStarted'))
    expect(card()).not.toBeNull()
    expect(doneSteps()).toEqual(['data', 'graph'])
    expect(m.ran.map((r) => r.id)).toEqual(['navigator'])
  })

  it('comes back for a new project, its steps to do again', () => {
    const t = filledTable()
    const m = mount(projectOf(t))
    expect(card()).toBeNull()
    act(() => m.store.reset(createProject()))
    expect(count()).toBe('0 of 5')
    // An example (a project with sheets) replaces it: gone.
    act(() => m.store.reset(projectOf(filledTable())))
    expect(card()).toBeNull()
  })

  it('hides with × (remembered), folds, and Help › Getting started shows it again', () => {
    const m = mount(createProject())
    const toggle = card()!.querySelector<HTMLButtonElement>('.gs-toggle')!
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    click(toggle)
    expect(card()!.querySelector('.gs-steps')).toBeNull()
    expect(readCardPref()).toBe('collapsed')
    click(card()!.querySelector('.gs-toggle')!)
    expect(card()!.querySelector('.gs-steps')).not.toBeNull()
    click(card()!.querySelector('[aria-label="Hide getting started"]')!)
    expect(card()).toBeNull()
    expect(localStorage.getItem(GETTING_STARTED_KEY)).toBe('hidden')
    act(() => void m.registry.run('help.gettingStarted'))
    expect(card()).not.toBeNull()
    expect(readCardPref()).toBe('open')
  })

  it('hidden from the keyboard, gives the focus to what comes before it (audit 3, A8)', () => {
    // The navigator's last row, before the card.
    const before = document.body.appendChild(document.createElement('button'))
    before.textContent = 'Last row'
    try {
      const m = mount(createProject())
      const close = card()!.querySelector<HTMLButtonElement>('[aria-label="Hide getting started"]')!
      act(() => close.focus())
      click(close)
      expect(card()).toBeNull()
      expect(document.activeElement).toBe(before)
      // "Hide this", once every step is done.
      act(() => void m.registry.run('help.gettingStarted'))
      act(() => m.exporter.finish())
      const t = filledTable()
      act(() =>
        m.store.dispatch([
          { type: 'node.add', node: t },
          { type: 'node.add', node: createGraphFor(t, 'Data 1') },
          { type: 'node.add', node: analysisOf(t) },
        ]),
      )
      const g = Object.values(m.store.getState().nodes).find((n) => n.kind === 'graph')!
      act(() =>
        m.store.dispatch({
          type: 'node.replace',
          node: { ...g, style: { ...(g as GraphNode).style, text: { size: 14 } } },
        } as never),
      )
      const hideThis = card()!.querySelector<HTMLButtonElement>('.gs-all button')!
      act(() => hideThis.focus())
      click(hideThis)
      expect(card()).toBeNull()
      expect(document.activeElement).toBe(before)
    } finally {
      before.remove()
    }
  })

  it('stays hidden in a new window once hidden', () => {
    writeCardPref('hidden')
    mount(createProject())
    expect(card()).toBeNull()
  })

  it('“Show me” runs the next command, showing a table or graph first when it needs one', async () => {
    const m = mount(createProject())
    // No table yet: New data table…, for every step that needs one.
    click(showMe('data'))
    click(showMe('graph'))
    click(showMe('format'))
    expect(m.ran.map((r) => r.id)).toEqual(['insert.table', 'insert.table', 'insert.table'])
    m.ran.length = 0
    const t = filledTable()
    const g = createGraphFor(t, 'Data 1')
    act(() =>
      m.store.dispatch([
        { type: 'node.add', node: t },
        { type: 'node.add', node: g },
      ]),
    )
    // Guide me… on the table (roadmap 51a; shown first: the command then enabled).
    click(showMe('analysis'))
    await settle()
    expect(m.ran).toEqual([{ id: 'analyze.guide', selected: t.id }])
    // The Format panel and Export… on the graph (shown first).
    click(showMe('format'))
    await settle()
    click(showMe('export'))
    await settle()
    expect(m.ran.slice(1)).toEqual([
      { id: 'format.graph', selected: g.id },
      { id: 'file.export', selected: g.id },
    ])
  })
})
