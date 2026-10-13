// @vitest-environment happy-dom
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { registry } from '@ps/analyses'
import { type RoleAssignment, type RoleVariable, rolesOf } from '@ps/analyses/dialog'
import { FontRegistry } from '@ps/graph'
import {
  type AnalysisNode,
  createProject,
  createTable,
  type DataTable,
  type DocNode,
  type NodeId,
  newNodeId,
  type Project,
} from '@ps/model'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { AnalyzeDialog, SKETCH_DEBOUNCE_MS } from '../src/analysis/AnalyzeDialog.tsx'
import { ResultsView } from '../src/analysis/ResultsView.tsx'
import { RoleBoxes } from '../src/analysis/RoleBoxes.tsx'
import { CommandRegistry, CommandsContext } from '../src/commands/index.ts'
import { ServicesContext } from '../src/context.tsx'
import { type AppServices, createServices } from '../src/services.ts'

// Audit 4 (step 4): the Analyze dialog and the results by keyboard and screen reader — the
// pictures named (A1), what blocks Analyze announced (A2), the focus after Use this and on
// opening when the list is folded (A3), new results announced and the summary's heading (A7),
// the group chips' names and keys (A9), Escape in the search and the folded list (A11), a
// role's variable removed (A12), the model picker's own-equation tab and Home / End (A13), the
// equation's error (A14), Guide me's scrolling with reduced motion (A16), one name for editing
// (A17), the factor names' labels (A19), headings and tab stops (A21).

// The bundled fonts, read by path (happy-dom's URLs aren't Node's): the pictures are drawn.
const FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../graph/assets/fonts')
const fonts = await FontRegistry.load(
  async (file) => new Uint8Array(await readFile(join(FONT_DIR, file))),
)

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const proto = HTMLDialogElement.prototype as { showModal?: () => void; close?: () => void }
  proto.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  proto.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open')
  }
})

let root: Root | null = null
let host: HTMLElement | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  host?.remove()
  host = null
})

function columnTable(n = 3): DataTable {
  const t = createTable({ name: 'Doses', tableKind: 'column', columns: n, rows: 6 })
  t.dataSets.forEach((d, i) => {
    d.title = ['Vehicle', 'Low', 'High', 'Max'][i]!
    d.subcolumns[0]!.values = [1, 2, 3, 4, 5, 6].map((v) => v * (i + 1) + (v % 3))
  })
  return t
}

function setup(nodes: DocNode[]): AppServices {
  const p: Project = createProject('A11y')
  for (const n of nodes) {
    p.nodes[n.id] = n
    p.order.push(n.id)
  }
  return createServices({ fonts, platform: {} as never, project: p })
}

const settle = (ms = SKETCH_DEBOUNCE_MS + 30) => act(() => new Promise((r) => setTimeout(r, ms)))

async function open(
  services: AppServices,
  props: Parameters<typeof AnalyzeDialog>[0],
): Promise<HTMLDialogElement> {
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  act(() =>
    root!.render(
      <ServicesContext.Provider value={services}>
        <AnalyzeDialog {...props} />
      </ServicesContext.Provider>,
    ),
  )
  await settle()
  return document.querySelector('dialog')!
}

const callbacks = () => ({ onClose: vi.fn(), onError: vi.fn(), onCreated: vi.fn() })
const button = (d: Element, name: string | RegExp) =>
  [...d.querySelectorAll('button')].find((b) =>
    typeof name === 'string' ? b.textContent === name : name.test(b.textContent ?? ''),
  )!

/** An element's accessible name from its label attributes (aria-labelledby first). */
function nameOf(el: Element): string {
  const by = el.getAttribute('aria-labelledby')
  const text = by
    ? by
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ')
    : (el.getAttribute('aria-label') ?? '')
  return text.trim()
}

const analysis = (t: DataTable, analysisId: string, params: object): AnalysisNode => {
  const def = registry.get(analysisId)!
  return {
    kind: 'analysis',
    id: newNodeId(),
    name: 'Doses ANOVA',
    analysisId,
    pluginVersion: def.version,
    input: { source: t.id, dataSets: t.dataSets.map((d) => d.id) },
    params: def.params.parse(params),
  }
}

describe('the pictures are named and described once (A1)', () => {
  it('the sketch and the schematic of All analyses', async () => {
    const t = columnTable()
    const d = await open(setup([t]), {
      mode: 'create',
      tableId: t.id,
      analysisId: 'oneWayAnova',
      ...callbacks(),
    })
    const pictures = [...d.querySelectorAll('[role="img"]')]
    expect(pictures.map((p) => p.className)).toEqual(
      expect.arrayContaining(['schematic-figure', 'sketch-panels']),
    )
    for (const p of pictures) {
      expect(nameOf(p), p.className).not.toBe('')
      // The description is the picture's: hidden from the reading flow (read once, with it).
      const desc = document.getElementById(p.getAttribute('aria-describedby') ?? '')!
      expect(desc.textContent).not.toBe('')
      expect(desc.getAttribute('aria-hidden'), p.className).toBe('true')
    }
  })
})

describe('headings and tab stops (A21)', () => {
  it('Guide me’s question list is a level-3 heading; the list of analyses no tab stop', async () => {
    const t = columnTable()
    const s = setup([t])
    let d = await open(s, { mode: 'create', tableId: t.id, tab: 'guide', ...callbacks() })
    expect(d.querySelector('h2')).not.toBeNull()
    expect(d.querySelector('#guide-rail-title')?.tagName).toBe('H3')
    act(() => root?.unmount())
    host?.remove()
    d = await open(s, { mode: 'create', tableId: t.id, tab: 'all', ...callbacks() })
    expect(
      d.querySelector('[role="listbox"][aria-label="Analyses"]')?.getAttribute('tabindex'),
    ).toBe('-1')
  })
})

describe('the results view (A7)', () => {
  async function show(services: AppServices, id: NodeId): Promise<HTMLElement> {
    host = document.body.appendChild(document.createElement('div'))
    root = createRoot(host)
    act(() =>
      root!.render(
        <ServicesContext.Provider value={services}>
          <CommandsContext.Provider value={new CommandRegistry()}>
            <ResultsView id={id} onEdit={vi.fn()} onError={vi.fn()} />
          </CommandsContext.Provider>
        </ServicesContext.Provider>,
      ),
    )
    for (let i = 0; i < 50 && !host.querySelector('.summary-sentence'); i++) await settle(40)
    return host
  }

  it('the summary has a heading; a re-run’s new answer is announced', async () => {
    const t = columnTable()
    const a = analysis(t, 'oneWayAnova', {})
    const s = setup([t, a])
    const el = await show(s, a.id)
    const summary = el.querySelector('section.result-summary')!
    expect(nameOf(summary)).toBe('Summary')
    expect(summary.querySelector('h2')?.textContent).toBe('Summary')
    const status = el.querySelector('.view-toolbar [role="status"]')!
    const before = status.firstElementChild
    // A value changed: the analysis runs again, its answer said when it is up to date.
    act(() =>
      s.store.dispatch(
        {
          type: 'table.setCells',
          table: t.id,
          edits: [{ col: t.dataSets[2]!.id, sub: 0, row: 0, value: 40 }],
        },
        'Edit cells',
      ),
    )
    for (let i = 0; i < 50 && status.firstElementChild === before; i++) await settle(40)
    await settle(40)
    expect(status.firstElementChild).not.toBe(before)
    expect(status.textContent).toMatch(/^Results up to date: /)
    expect(status.textContent).toContain(el.querySelector('.summary-sentence')!.textContent!)
  })
})

const key = (target: Element, k: string, mods: { ctrlKey?: boolean } = {}) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...mods })
  act(() => {
    target.dispatchEvent(e)
  })
  return e
}

/** Answers Guide me's open questions with their first available answer until Use this. */
async function walkToUse(d: Element) {
  for (let k = 0; k < 12 && !button(d, 'Use this'); k++) {
    const q = [...d.querySelectorAll('fieldset.guide-question')].find(
      (x) => !x.querySelector('input[type="radio"]:checked'),
    )
    if (!q) break
    act(() =>
      [...q.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
        .find((x) => x.getAttribute('aria-disabled') !== 'true')!
        .click(),
    )
    await settle(10)
  }
}

describe('what keeps Analyze disabled is announced (A2)', () => {
  it('the first check’s reason in a polite status; ⌘Enter while blocked says it again', async () => {
    const t = columnTable(2)
    const d = await open(setup([t]), {
      mode: 'create',
      tableId: t.id,
      analysisId: 'ttest',
      ...callbacks(),
    })
    const status = d.querySelector('footer [role="status"]')!
    expect(status.textContent).toBe('')
    const second = d.querySelectorAll<HTMLElement>('.chips [role="option"]')[1]!
    act(() => second.click())
    await settle()
    expect(button(d, 'Analyze').disabled).toBe(true)
    expect(status.textContent).toBe('Choose 2 groups (1 chosen).')
    const said = status.firstElementChild
    key(d, 'Enter', { ctrlKey: true })
    expect(status.firstElementChild).not.toBe(said)
    expect(status.textContent).toBe('Choose 2 groups (1 chosen).')
    // Chosen again: nothing to say.
    act(() => second.click())
    await settle()
    expect(status.textContent).toBe('')
  })

  it('Guide me: ⌘Enter says what to do first', async () => {
    const t = columnTable()
    const d = await open(setup([t]), {
      mode: 'create',
      tableId: t.id,
      tab: 'guide',
      ...callbacks(),
    })
    const status = d.querySelector('footer [role="status"]')!
    expect(status.textContent).toBe('')
    key(d, 'Enter', { ctrlKey: true })
    expect(status.textContent).toMatch(/^Choose an analysis/)
  })
})

describe('Escape in the search and in the folded list (A11)', () => {
  it('clears a query first, then closes the open list; the dialog stays', async () => {
    const t = columnTable()
    const d = await open(setup([t]), {
      mode: 'create',
      tableId: t.id,
      analysisId: 'oneWayAnova',
      ...callbacks(),
    })
    const search = d.querySelector<HTMLInputElement>('input[aria-label="Search analyses"]')!
    const layout = d.querySelector('.analyze3')!
    // happy-dom's window is narrow: the list folded; ⌘K opens it on the search.
    expect(layout.className).not.toMatch(/rail-open/)
    key(d, 'k', { ctrlKey: true })
    await settle(10)
    expect(layout.className).toMatch(/rail-open/)
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      set.call(search, 'kruskal')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(search.value).toBe('kruskal')
    let e = key(search, 'Escape')
    expect(e.defaultPrevented).toBe(true)
    expect(search.value).toBe('')
    expect(layout.className).toMatch(/rail-open/)
    e = key(search, 'Escape')
    expect(e.defaultPrevented).toBe(true)
    expect(layout.className).not.toMatch(/rail-open/)
    await settle(10)
    expect(document.activeElement).toBe(d.querySelector('.rail-toggle'))
    // Nothing left to close: Escape closes the dialog (not prevented).
    e = key(d.querySelector('.rail-toggle')!, 'Escape')
    expect(e.defaultPrevented).toBe(false)
  })
})

describe('the focus where the work starts when the list is folded (A3)', () => {
  it('Use this, and opening on All analyses: the list’s button naming the method', async () => {
    const t = columnTable()
    const s = setup([t])
    let d = await open(s, {
      mode: 'create',
      tableId: t.id,
      tab: 'guide',
      entry: 'vsControl',
      ...callbacks(),
    })
    await walkToUse(d)
    const use = button(d, 'Use this')
    use.focus()
    act(() => use.click())
    await settle(30)
    const toggle = d.querySelector('.rail-toggle')!
    expect(d.querySelector('.analyze3')!.className).not.toMatch(/rail-open/)
    expect(document.activeElement).toBe(toggle)
    expect(toggle.textContent).toMatch(/One-way ANOVA/)
    act(() => root?.unmount())
    host?.remove()
    d = await open(s, { mode: 'create', tableId: t.id, tab: 'all', ...callbacks() })
    await settle(30)
    expect(document.activeElement).toBe(d.querySelector('.rail-toggle'))
  })
})

describe('the group chips (A9)', () => {
  it('named with their place and the control; C makes the control; the keys described', async () => {
    const t = columnTable()
    const d = await open(setup([t]), {
      mode: 'create',
      tableId: t.id,
      analysisId: 'oneWayAnova',
      ...callbacks(),
    })
    const vsControl = [...d.querySelectorAll('label')].find((l) =>
      /control/i.test(l.textContent ?? ''),
    )!
    act(() => vsControl.querySelector('input')!.click())
    await settle()
    const list = d.querySelector('.chips[role="listbox"]')!
    const names = () => [...list.querySelectorAll('[role="option"]')].map(nameOf)
    expect(names()).toEqual(['Vehicle, 1st, control', 'Low, 2nd', 'High, 3rd'])
    // Nothing interactive inside an option (axe nested-interactive).
    expect(list.querySelector('button, [tabindex="-1"] [tabindex]')).toBeNull()
    const low = [...list.querySelectorAll<HTMLElement>('[role="option"]')][1]!
    low.focus()
    key(low, 'c')
    await settle()
    expect(names()).toEqual(['Low, 1st, control', 'Vehicle, 2nd', 'High, 3rd'])
    const help = document.getElementById(list.getAttribute('aria-describedby')!)!.textContent
    expect(help).toMatch(/^Choose 2 or more groups\. /)
    expect(help).toMatch(/Space/)
    expect(help).toMatch(/Alt \+ ←\/→/)
    expect(help).toMatch(/C makes it the control/)
  })
})

describe('a role’s variable removed (A12)', () => {
  it('the focus goes to the next ×, the previous one, then the Add… menu', async () => {
    const roles = rolesOf(registry.get('multipleRegression')!)!
    const variables: RoleVariable[] = ['Y', 'A', 'B', 'C'].map((k) => ({
      key: k,
      title: k,
      type: 'number',
    }))
    function Harness() {
      const [a, setA] = useState<RoleAssignment>({ outcome: ['Y'], predictors: ['A', 'B', 'C'] })
      return <RoleBoxes roles={roles} variables={variables} assignment={a} onChange={setA} />
    }
    host = document.body.appendChild(document.createElement('div'))
    root = createRoot(host)
    act(() => root!.render(<Harness />))
    const remove = (name: string) =>
      host!.querySelector<HTMLButtonElement>(`button[aria-label^="Remove “${name}” from"]`)!
    remove('B').focus()
    act(() => remove('B').click())
    await settle(10)
    expect(document.activeElement).toBe(remove('C'))
    act(() => remove('C').click())
    await settle(10)
    expect(document.activeElement).toBe(remove('A'))
    act(() => remove('A').click())
    await settle(10)
    expect(document.activeElement).toBe(
      host.querySelector('select[aria-label="Add to Predictors"]'),
    )
    act(() => remove('Y').click())
    await settle(10)
    expect(document.activeElement).toBe(
      host.querySelector('select[aria-label="Add to Outcome (Y)"]'),
    )
  })
})

describe('the factor names (A19)', () => {
  it('are named by their visible labels', async () => {
    const t = createTable({
      name: 'G',
      tableKind: 'grouped',
      columns: 2,
      rows: 2,
      yFormat: { type: 'replicates', count: 3 },
    })
    t.dataSets.forEach((d, i) => {
      d.title = ['WT', 'KO'][i]!
      d.subcolumns.forEach((s, j) => {
        s.values = [1 + i + j, 2 + i * j]
      })
    })
    const d = await open(setup([t]), {
      mode: 'create',
      tableId: t.id,
      analysisId: 'twoWayAnova',
      ...callbacks(),
    })
    const inputs = [...d.querySelectorAll<HTMLInputElement>('.factor-names input')]
    expect(inputs.map((i) => i.getAttribute('aria-label'))).toEqual([null, null])
    expect(inputs.map((i) => i.closest('label')?.textContent?.trim())).toEqual([
      'Rows are',
      'Data sets are',
    ])
  })
})

/** An XY table of a falling dose-response (log X). */
function doses(): DataTable {
  const x = [-9, -8, -7, -6.5, -6, -5, -4]
  const t = createTable({ name: 'Inhibition', tableKind: 'xy', columns: 1, rows: x.length })
  t.x!.subcolumns[0]!.values = x
  t.dataSets[0]!.title = 'Drug'
  t.dataSets[0]!.subcolumns[0]!.values = [98, 95, 85, 60, 30, 12, 5]
  return t
}

const goalTab = (d: Element, name: string) =>
  [...d.querySelectorAll<HTMLElement>('.model-goals [role="tab"]')].find(
    (b) => b.textContent === name,
  )!
const modelNow = (d: Element) => d.querySelector('.model-current')?.textContent ?? ''

describe('the model picker’s goals by keyboard (A13)', () => {
  it('Home and End; My own equation reached by keys offers it, picked on a button', async () => {
    const t = doses()
    const d = await open(setup([t]), {
      mode: 'create',
      tableId: t.id,
      analysisId: 'nonlinearFit',
      ...callbacks(),
    })
    const first = goalTab(d, 'Dose-response: stimulation (EC50)')
    expect(first.getAttribute('aria-selected')).toBe('true')
    const before = modelNow(d)
    first.focus()
    key(first, 'End')
    await settle(30)
    const own = goalTab(d, 'My own equation')
    expect(own.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(own)
    // Shown, not picked: the model is the one before until the button says so.
    expect(modelNow(d)).toBe(before)
    expect(d.querySelector('textarea.equation-text')).toBeNull()
    act(() => button(d, 'Use my own equation').click())
    await settle()
    expect(modelNow(d)).toMatch(/^Your own equation/)
    expect(d.querySelector('textarea.equation-text')).not.toBeNull()
    key(own, 'Home')
    await settle(30)
    expect(first.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(first)
  })
})

describe('the equation’s error (A14)', () => {
  it('said politely once typing pauses (or on leaving), the field marked and linked', async () => {
    const t = doses()
    const d = await open(setup([t]), {
      mode: 'create',
      tableId: t.id,
      analysisId: 'nonlinearFit',
      ...callbacks(),
    })
    act(() => goalTab(d, 'My own equation').click())
    await settle()
    const area = d.querySelector<HTMLTextAreaElement>('textarea.equation-text')!
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      set.call(area, 'Y = (Top')
      area.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(d.querySelector('[role="alert"]')).toBeNull()
    // While typing: no error yet.
    expect(d.querySelector('.equation-error')?.textContent ?? '').toBe('')
    expect(area.getAttribute('aria-invalid')).not.toBe('true')
    await settle(1000)
    const error = d.querySelector('.equation-error')!
    expect(error.getAttribute('aria-live')).toBe('polite')
    expect(error.textContent).toMatch(/^Line 1, column \d+: /)
    expect(area.getAttribute('aria-invalid')).toBe('true')
    const described = (area.getAttribute('aria-describedby') ?? '').split(/\s+/)
    expect(described.map((id) => document.getElementById(id)?.textContent).join(' ')).toMatch(
      /^Line 1, column/,
    )
  })
})

describe('Guide me’s scrolling with reduced motion asked for (A16)', () => {
  it('jumps (no smooth scroll) to the recommendation', async () => {
    const calls: (ScrollIntoViewOptions | boolean | undefined)[] = []
    const proto = HTMLElement.prototype as { scrollIntoView?: unknown }
    const had = proto.scrollIntoView
    proto.scrollIntoView = (o?: ScrollIntoViewOptions | boolean) => {
      calls.push(o)
    }
    const media = vi.spyOn(window, 'matchMedia').mockImplementation(
      (q: string) =>
        ({
          matches: q.includes('prefers-reduced-motion: reduce'),
          media: q,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    )
    try {
      const t = columnTable()
      const d = await open(setup([t]), {
        mode: 'create',
        tableId: t.id,
        tab: 'guide',
        entry: 'vsControl',
        ...callbacks(),
      })
      await walkToUse(d)
      const smooth = calls.filter((o) => typeof o === 'object' && o.behavior === 'smooth')
      expect(calls.length).toBeGreaterThan(0)
      expect(smooth).toEqual([])
    } finally {
      media.mockRestore()
      proto.scrollIntoView = had
    }
  })
})

describe('one name for editing an analysis (A17)', () => {
  it('Edit parameters… on the results, the dialog’s title and the undo step', async () => {
    const t = columnTable()
    const a = analysis(t, 'oneWayAnova', {})
    const s = setup([t, a])
    host = document.body.appendChild(document.createElement('div'))
    root = createRoot(host)
    const onEdit = vi.fn()
    act(() =>
      root!.render(
        <ServicesContext.Provider value={s}>
          <CommandsContext.Provider value={new CommandRegistry()}>
            <ResultsView id={a.id} onEdit={onEdit} onError={vi.fn()} />
          </CommandsContext.Provider>
        </ServicesContext.Provider>,
      ),
    )
    const labels = [...host.querySelectorAll('.view-toolbar button')].map((b) => b.textContent)
    expect(labels).toContain('Edit parameters…')
    expect(labels).not.toContain('Parameters…')
    act(() => root?.unmount())
    host.remove()
    const d = await open(s, { mode: 'edit', analysisId: a.id, ...callbacks() })
    expect(d.querySelector('h2')?.textContent).toBe('Edit parameters of “Doses ANOVA”')
    const tukey = [...d.querySelectorAll('label')].find((l) =>
      /control/i.test(l.textContent ?? ''),
    )!
    act(() => tukey.querySelector('input')!.click())
    await settle()
    act(() => button(d, 'Apply').click())
    expect(s.store.undoLabel).toBe('Edit parameters')
  })
})

describe('the dialog’s keys as the platform writes them (A18)', () => {
  it('the folded list’s tooltip: Ctrl+K off macOS', async () => {
    const was = Object.getOwnPropertyDescriptor(navigator, 'platform')
    Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true })
    try {
      const t = columnTable()
      const d = await open(setup([t]), {
        mode: 'create',
        tableId: t.id,
        tab: 'all',
        ...callbacks(),
      })
      expect(d.querySelector('.rail-toggle')?.getAttribute('title')).toBe('All analyses (Ctrl+K)')
    } finally {
      if (was) Object.defineProperty(navigator, 'platform', was)
      else delete (navigator as { platform?: string }).platform
    }
  })
})
