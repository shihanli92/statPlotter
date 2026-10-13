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

// Roadmap 51e (design §9): the curve fit in the Analyze dialog — the model picker by goal (goals
// as tabs, models as cards), the X-scale note with its fixes (the concentration form; Transform
// X to log10, which makes a Transform analysis and fits its result), the comparison decided in
// advance with the F test greyed for models that aren't nested (§4.4 row 22), and Edit opened
// by a result warning's fix.

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

/** An XY table of a falling dose-response, X as given. */
function doses(x: number[], name = 'Inhibition'): DataTable {
  const t = createTable({ name, tableKind: 'xy', columns: 1, rows: x.length })
  t.x!.subcolumns[0]!.values = x
  t.dataSets[0]!.title = 'Drug'
  t.dataSets[0]!.subcolumns[0]!.values = [98, 95, 85, 60, 30, 12, 5].slice(0, x.length)
  return t
}

function setup(nodes: (DataTable | AnalysisNode)[]): AppServices {
  const p: Project = createProject('Fits')
  for (const n of nodes) {
    p.nodes[n.id] = n
    p.order.push(n.id)
  }
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
const tab = (d: Element, name: string) =>
  [...d.querySelectorAll('.model-goals [role="tab"]')].find(
    (b) => b.textContent === name,
  ) as HTMLElement
const card = (d: Element, id: string) =>
  d.querySelector(`.model-cards [data-model="${id}"]`) as HTMLElement
const current = (d: Element) => d.querySelector('.model-current .model-name')?.textContent
const callbacks = () => ({ onClose: vi.fn(), onError: vi.fn(), onCreated: vi.fn() })

const LOG = [-9, -8, -7, -6.5, -6, -5, -4]
const CONC = [1e-9, 1e-8, 1e-7, 3e-7, 1e-6, 1e-5, 1e-4]

describe('the curve-fit picker (51e)', () => {
  it('goals as tabs, models as cards: an IC50 from a log-X table', async () => {
    const t = doses(LOG)
    const services = setup([t])
    const d = await open(services, {
      mode: 'create',
      tableId: t.id,
      analysisId: 'nonlinearFit',
      ...callbacks(),
    })
    const goals = [...d.querySelectorAll('.model-goals [role="tab"]')].map((b) => b.textContent)
    expect(goals.slice(0, 2)).toEqual([
      'Dose-response: stimulation (EC50)',
      'Dose-response: inhibition (IC50)',
    ])
    expect(goals.slice(-2)).toEqual(['All equations', 'My own equation'])
    expect(tab(d, 'Dose-response: stimulation (EC50)').getAttribute('aria-selected')).toBe('true')
    expect(card(d, 'agonist-response-variable-slope').getAttribute('aria-checked')).toBe('true')
    act(() => tab(d, 'Dose-response: inhibition (IC50)').click())
    const ic50 = card(d, 'inhibitor-response-variable-slope')
    expect(ic50.textContent).toMatch(/X: log\(concentration\) · 4 parameters/)
    act(() => ic50.click())
    await settle()
    expect(current(d)).toBe('log(inhibitor) vs. response — Variable slope (four parameters)')
    expect(d.querySelector('.model-params')?.textContent).toMatch(
      /LogIC50: log of the IC50: the dose giving a response half-way between Top and Bottom/,
    )
    // X is log molar: no note about X.
    expect(d.querySelector('.checks')?.textContent ?? '').not.toMatch(/looks like/)
    // The sketch shows the model's starting shape, not the fit.
    expect(d.querySelector('.sketch-caption')?.textContent).toMatch(
      /^log\(inhibitor\) vs\. response — Variable slope \(four parameters\): the line is its starting shape/,
    )
    act(() => button(d, 'Analyze').click())
    const nodes = Object.values(services.store.getState().nodes).filter(
      (n): n is AnalysisNode => n.kind === 'analysis',
    )
    expect(nodes.map((n) => [n.analysisId, (n.params as { equation: string }).equation])).toEqual([
      ['nonlinearFit', 'inhibitor-response-variable-slope'],
    ])
    expect((nodes[0]!.params as { ciMethod: string }).ciMethod).toBe('profile')
  })

  it('concentrations under a log model: the note, and the concentration form in one click', async () => {
    const t = doses(CONC)
    const d = await open(setup([t]), {
      mode: 'create',
      tableId: t.id,
      analysisId: 'nonlinearFit',
      ...callbacks(),
    })
    const note = d.querySelector('.checks .check-note')!
    expect(note.textContent).toMatch(
      /X looks like concentrations \(1e-9 to 1e-4\), but this model expects log\(concentration\)\./,
    )
    expect([...note.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'Transform X to log10',
      'Use the concentration form of this model',
    ])
    act(() => button(d, 'Use the concentration form of this model').click())
    await settle()
    expect(current(d)).toBe('[Agonist] vs. response — Variable slope')
    expect(d.querySelector('.checks .check-note')).toBeNull()
  })

  it('Transform X to log10: a Transform analysis, and the fit of its result', async () => {
    const t = doses(CONC)
    const services = setup([t])
    const d = await open(services, {
      mode: 'create',
      tableId: t.id,
      analysisId: 'nonlinearFit',
      ...callbacks(),
    })
    act(() => button(d, 'Transform X to log10').click())
    await settle()
    expect(d.querySelector('.transform-first')?.textContent).toMatch(
      /X will be transformed to log10 first/,
    )
    // The checks now see log X: the note is gone.
    expect(d.querySelector('.checks .check-note')).toBeNull()
    act(() => button(d, 'Analyze').click())
    const nodes = Object.values(services.store.getState().nodes).filter(
      (n): n is AnalysisNode => n.kind === 'analysis',
    )
    const transform = nodes.find((n) => n.analysisId === 'transform')!
    const fit = nodes.find((n) => n.analysisId === 'nonlinearFit')!
    expect(transform.params).toMatchObject({ x: 'log10', y: 'none' })
    expect(transform.input.source).toBe(t.id)
    expect(fit.input).toEqual({ source: transform.id, dataSets: [t.dataSets[0]!.id] })
  })

  it('§4.4 row 22: models that aren’t nested — the F test greyed, AICc allowed', async () => {
    const t = doses(LOG)
    const d = await open(setup([t]), {
      mode: 'create',
      tableId: t.id,
      analysisId: 'nonlinearFit',
      ...callbacks(),
    })
    const decide = () =>
      [...d.querySelectorAll('legend, label')].find((l) =>
        /How will you decide between the two fits\?/.test(l.textContent ?? ''),
      )
    expect(decide()).toBeUndefined()
    const compare = d.querySelector<HTMLSelectElement>(
      'select#' +
        CSS.escape(
          [...d.querySelectorAll('label')].find(
            (l) => l.textContent === 'Compare with another model',
          )!.htmlFor,
        ),
    )!
    // Nested with the 4PL first.
    expect(compare.querySelector('optgroup')?.label).toBe('Nested with this model (F test or AICc)')
    act(() => {
      compare.value = 'agonist-response'
      compare.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await settle()
    expect(decide()).toBeDefined()
    expect(button(d, 'Analyze').disabled).toBe(false)
    act(() => {
      compare.value = 'gaussian'
      compare.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await settle()
    expect(button(d, 'Analyze').disabled).toBe(true)
    expect(d.querySelector('.ok-reason')?.textContent).toMatch(
      /These models aren’t nested; compare them by AICc\./,
    )
    const aicc = [...d.querySelectorAll('label')]
      .find((l) => /^AICc/.test(l.textContent ?? ''))!
      .querySelector('input')!
    act(() => aicc.click())
    await settle()
    expect(button(d, 'Analyze').disabled).toBe(false)
  })

  it('Edit opened by a warning’s fix shows it applied (Fix Bottom = 0)', async () => {
    const t = doses(LOG)
    const node: AnalysisNode = {
      kind: 'analysis',
      id: 'fit1' as NodeId,
      name: 'Fit',
      analysisId: 'nonlinearFit',
      pluginVersion: 3,
      input: { source: t.id, dataSets: [t.dataSets[0]!.id] },
      params: { equation: 'inhibitor-response-variable-slope' },
    }
    const d = await open(setup([t, node]), {
      mode: 'edit',
      analysisId: node.id,
      fix: {
        label: 'Fix Bottom = 0',
        set: [{ path: ['constraints', 'Bottom'], value: { kind: 'constant', value: 0 } }],
      },
      ...callbacks(),
    })
    const bottom = d.querySelector<HTMLSelectElement>('select[aria-label="Bottom constraint"]')!
    expect(bottom.value).toBe('constant')
    expect(d.querySelector<HTMLInputElement>('[aria-label="Bottom value"]')?.value).toBe('0')
  })
})
