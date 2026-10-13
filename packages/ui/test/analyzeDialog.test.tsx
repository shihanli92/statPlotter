// @vitest-environment happy-dom
import {
  type AnalysisNode,
  createProject,
  createTable,
  type DataTable,
  type NodeId,
  type Project,
} from '@ps/model'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { AnalyzeDialog, SKETCH_DEBOUNCE_MS } from '../src/analysis/AnalyzeDialog.tsx'
import { ServicesContext } from '../src/context.tsx'
import { type AppServices, createServices } from '../src/services.ts'

// Roadmap 51b (design §4, §5): the three-panel Analyze dialog, rendered — the rail, the options
// in tiers and the side panel's sketch and checks; the groups as chips with the comparison
// spelled out; Analyze disabled with its reason; a greyed option with its reason; switching
// methods keeping the shared choices; roles for an analysis of variables; editing on the
// current method; and no P value anywhere before Analyze.

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

function columnTable(): DataTable {
  const t = createTable({ name: 'Enzyme', tableKind: 'column', columns: 3, rows: 5 })
  const values = [
    [1, 2, 3, 4, 5],
    [3, 4, 6, 7, 9],
    [2, 6, 7, 9, 12],
  ]
  t.dataSets.forEach((d, i) => {
    d.title = ['Control', 'Treated', 'High'][i]!
    d.subcolumns[0]!.values = values[i]!
  })
  return t
}

function variablesTable(): DataTable {
  const t = createTable({ name: 'Cohort', tableKind: 'multipleVariables', columns: 3, rows: 6 })
  const values = [
    [60, 72, 65, 80, 77, 70],
    [30, 41, 35, 52, 49, 44],
    [0, 1, 0, 1, 1, 0],
  ]
  t.dataSets.forEach((d, i) => {
    d.title = ['Weight', 'Age', 'Male'][i]!
    d.subcolumns[0]!.values = values[i]!
  })
  return t
}

function setup(nodes: (DataTable | AnalysisNode)[]): AppServices {
  const p: Project = createProject('Dialog')
  for (const n of nodes) {
    p.nodes[n.id] = n
    p.order.push(n.id)
  }
  // The panels' pictures are checked with the fonts in analysisSketch.test.ts; here the spec.
  return createServices({ fonts: {} as never, platform: {} as never, project: p })
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

const button = (d: Element, name: string | RegExp) =>
  [...d.querySelectorAll('button')].find((b) =>
    typeof name === 'string' ? b.textContent === name : name.test(b.textContent ?? ''),
  )!
const option = (d: Element, name: string) =>
  [...d.querySelectorAll('[role="option"]')].find((o) => o.textContent?.startsWith(name))!
const chip = (d: Element, name: string) =>
  [...d.querySelectorAll('.chips [role="option"]')].find(
    (o) => o.querySelector('.chip-title')?.textContent === name,
  ) as HTMLElement
const radio = (d: Element, label: string) =>
  [...d.querySelectorAll('label')].find((l) => l.textContent === label)!.querySelector('input')!

const callbacks = () => ({ onClose: vi.fn(), onError: vi.fn(), onCreated: vi.fn() })

describe('the Analyze dialog (51b)', () => {
  it('three panels; chips with the comparison; Analyze disabled with its reason', async () => {
    const t = columnTable()
    const d = await open(setup([t]), {
      mode: 'create',
      tableId: t.id,
      analysisId: 'ttest',
      ...callbacks(),
    })
    expect(d.querySelector('.analyze-rail')).not.toBeNull()
    expect(d.querySelector('.analyze-options-column')).not.toBeNull()
    expect(d.querySelector('aside.analyze-side')).not.toBeNull()
    const analyze = button(d, 'Analyze')
    expect(analyze.disabled).toBe(false)
    expect(d.querySelector('.comparing')?.textContent).toBe('Comparing: “Treated” − “Control”.')
    // Reorder: Alt + ← on Treated puts it first: the sign follows.
    act(() =>
      chip(d, 'Treated').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true }),
      ),
    )
    expect(d.querySelector('.comparing')?.textContent).toBe('Comparing: “Control” − “Treated”.')
    // A third group: too many for a t test — Analyze waits, saying why.
    act(() => chip(d, 'High').click())
    await settle()
    expect(button(d, 'Analyze').disabled).toBe(true)
    const reason = d.querySelector('.ok-reason')!
    expect(reason.textContent).toBe('Choose 2 groups (3 chosen).')
    expect(button(d, 'Analyze').getAttribute('aria-describedby')).toBe(reason.id)
    expect(d.querySelector('.checks .check-block')?.textContent).toMatch(/Error: Choose 2 groups/)
  })

  it('the sketch follows the options: pairs joined, Welch’s own SDs or the pooled SD', async () => {
    const t = columnTable()
    const d = await open(setup([t]), {
      mode: 'create',
      tableId: t.id,
      analysisId: 'ttest',
      ...callbacks(),
    })
    const panels = () =>
      [...d.querySelectorAll('.sketch-panel')].map((p) => p.getAttribute('data-panel'))
    expect(panels()).toEqual(['data'])
    expect(d.querySelector('.sketch-caption')?.textContent).toMatch(/own scatter/)
    act(() => radio(d, 'No, equal scatter is known: Student’s t test').click())
    await settle()
    expect(d.querySelector('.sketch-caption')?.textContent).toMatch(/pooled SD/)
    act(() => radio(d, 'Yes, each row is one subject, plate or day').click())
    await settle()
    expect(panels()).toEqual(['pairs', 'diff'])
    expect(d.querySelector('[role="img"]')?.getAttribute('aria-describedby')).toBeTruthy()
  })

  it('a greyed option says why; switching method keeps the shared choices', async () => {
    const t = columnTable()
    const d = await open(setup([t]), {
      mode: 'create',
      tableId: t.id,
      analysisId: 'ttest',
      ...callbacks(),
    })
    act(() => radio(d, 'Yes, each row is one subject, plate or day').click())
    act(() => (option(d, 'One-way ANOVA') as HTMLElement).click())
    await settle()
    expect(d.querySelector('.method-title')?.textContent).toBe('One-way ANOVA (and nonparametric)')
    // Matched carried over from the paired t test.
    expect(radio(d, 'Yes, each row is one subject, plate or day').checked).toBe(true)
    const trend = radio(d, 'A steady trend across the groups, in order')
    expect(trend.getAttribute('aria-disabled')).toBe('true')
    expect(
      document.getElementById(trend.getAttribute('aria-describedby')!.split(' ')[0]!)?.textContent,
    ).toMatch(/Not with matched rows/)
    act(() => trend.click())
    expect(trend.checked).toBe(false)
    // Back to the t test: as it was.
    act(() => (option(d, 't test') as HTMLElement).click())
    expect(radio(d, 'Yes, each row is one subject, plate or day').checked).toBe(true)
  })

  it('roles: the outcome starts empty, Analyze waits for it', async () => {
    const t = variablesTable()
    const d = await open(setup([t]), {
      mode: 'create',
      tableId: t.id,
      analysisId: 'multipleRegression',
      ...callbacks(),
    })
    const boxes = [...d.querySelectorAll('.role-box legend')].map((l) => l.textContent)
    expect(boxes).toEqual(['Outcome (Y)', 'Predictors'])
    expect(button(d, 'Analyze').disabled).toBe(true)
    expect(d.querySelector('.ok-reason')?.textContent).toBe('Choose the outcome.')
    const add = d.querySelector<HTMLSelectElement>('select[aria-label="Add to Outcome (Y)"]')!
    act(() => {
      add.value = add.options[1]!.value
      add.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await settle()
    expect(button(d, 'Analyze').disabled).toBe(false)
    const members = [...d.querySelectorAll('.role-box')].map((b) =>
      [...b.querySelectorAll('.chip-title')].map((x) => x.textContent),
    )
    expect(members).toEqual([['Weight'], ['Age', 'Male']])
  })

  it('edits an analysis on its method, with Change method… and Apply', async () => {
    const t = columnTable()
    const node: AnalysisNode = {
      kind: 'analysis',
      id: 'an1' as NodeId,
      name: 'Welch of Enzyme',
      analysisId: 'ttest',
      pluginVersion: 2,
      input: { source: t.id, dataSets: [t.dataSets[1]!.id, t.dataSets[0]!.id] },
      params: {},
    }
    const d = await open(setup([t, node]), { mode: 'edit', analysisId: node.id, ...callbacks() })
    expect(d.querySelector('h2')?.textContent).toBe('Edit “Welch of Enzyme”')
    expect(d.querySelector('.analyze3')?.classList.contains('editing')).toBe(true)
    expect(d.querySelector('.analyze-search')).toBeNull()
    expect(button(d, 'Apply')).toBeDefined()
    // The stored order is the chips' order.
    expect(d.querySelector('.comparing')?.textContent).toBe('Comparing: “Control” − “Treated”.')
    act(() => button(d, 'Change method…').click())
    expect(d.querySelector('.analyze-search')).not.toBeNull()
  })

  it('shows no P value, CI or verdict before Analyze', async () => {
    const t = columnTable()
    const d = await open(setup([t]), {
      mode: 'create',
      tableId: t.id,
      analysisId: 'oneWayAnova',
      ...callbacks(),
    })
    const text = d.textContent ?? ''
    expect(text).not.toMatch(/P\s*[=<>]\s*0?[.,]\d|\bP value =|Significant\?|\bCI\b.*\d+\.\d+ to/)
  })
})
