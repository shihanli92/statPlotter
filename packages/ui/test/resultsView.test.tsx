// @vitest-environment happy-dom
import { registry } from '@ps/analyses'
import {
  type AnalysisNode,
  createProject,
  createTable,
  type DataTable,
  type NodeId,
  newNodeId,
  type Project,
} from '@ps/model'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { AnalyzeDialog, SKETCH_DEBOUNCE_MS } from '../src/analysis/AnalyzeDialog.tsx'
import { ResultsView } from '../src/analysis/ResultsView.tsx'
import { CommandRegistry, CommandsContext } from '../src/commands/index.ts'
import { ServicesContext } from '../src/context.tsx'
import { type AppServices, createServices } from '../src/services.ts'

// Roadmap 51d (design §8): results that explain themselves, rendered — the summary sentence
// first (the accessible answer), the effect plot, the comparisons first with their header, the
// details collapsed, row headers and star summaries read in words, the method paragraph; and the
// analysis' name following its method until renamed.

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

function doses(): DataTable {
  const t = createTable({ name: 'Dose response', tableKind: 'column', columns: 3, rows: 6 })
  const values = [
    [18.1, 22.4, 15.9, 20.3, 17.5, 19.8],
    [24.0, 26.1, 22.3, 23.8, 25.9, 21.7],
    [30.2, 33.5, 27.8, 31.1, 29.4, 34.0],
  ]
  t.dataSets.forEach((d, i) => {
    d.title = ['Vehicle', '1 mg/kg', '10 mg/kg'][i]!
    d.subcolumns[0]!.values = values[i]!
  })
  return t
}

function setup(nodes: (DataTable | AnalysisNode)[]): AppServices {
  const p: Project = createProject('Results')
  for (const n of nodes) {
    p.nodes[n.id] = n
    p.order.push(n.id)
  }
  return createServices({ fonts: {} as never, platform: {} as never, project: p })
}

const settle = (ms = SKETCH_DEBOUNCE_MS + 60) => act(() => new Promise((r) => setTimeout(r, ms)))

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

const analysis = (t: DataTable, analysisId: string, params: object): AnalysisNode => {
  const def = registry.get(analysisId)!
  return {
    kind: 'analysis',
    id: newNodeId(),
    name: 'An analysis',
    analysisId,
    pluginVersion: def.version,
    input: { source: t.id, dataSets: t.dataSets.map((d) => d.id) },
    params: def.params.parse(params),
  }
}

describe('the results view (51d)', () => {
  it('leads with the answer: the sentence, the effect plot, the comparisons and their header', async () => {
    const t = doses()
    const a = analysis(t, 'oneWayAnova', { comparisons: 'vsControl', control: t.dataSets[0]!.id })
    const el = await show(setup([t, a]), a.id)
    const summary = el.querySelector('section.result-summary')!
    // Named by its heading (audit 4 A7).
    expect(document.getElementById(summary.getAttribute('aria-labelledby')!)?.textContent).toBe(
      'Summary',
    )
    expect(summary.querySelector('.summary-sentence')!.textContent).toMatch(
      /^Compared with Vehicle, 1 mg\/kg is higher by .* Dunnett’s test for 2 comparisons\. Overall: the means differ across the 3 groups/,
    )
    // The effect plot: each group − the control, with its text alternative.
    expect(summary.querySelector('.effect-plot h3')!.textContent).toBe('The effects')
    expect(summary.querySelector('.sketch-description')!.textContent).toMatch(
      /^Effect plot\. 1 mg\/kg − Vehicle: /,
    )
    // The first tab is the comparisons, with what its P values and CIs refer to.
    const tabs = [...el.querySelectorAll('[role="tab"]')].map((b) => b.textContent)
    expect(tabs).toEqual(['Multiple comparisons', 'Table of results'])
    expect(el.querySelector('caption.family-caption')!.textContent).toBe(
      'Dunnett: each of 2 groups − Vehicle, one family; adjusted P values and simultaneous 95% CIs.',
    )
    expect(el.querySelectorAll('thead th[scope="col"]').length).toBeGreaterThan(3)
    expect(el.querySelector('tbody th[scope="row"]')!.textContent).toBe('1 mg/kg − Vehicle')
    // Star summaries are read in words.
    expect(el.querySelector('td[aria-label]')?.getAttribute('aria-label')).toMatch(
      /^(one star|two stars|three stars|four stars), P [=<] 0\.\d+$/,
    )
    // The method, to copy.
    const method = el.querySelector('details.method-section')!
    expect(method.querySelector('.methods-paragraph')!.textContent).toMatch(
      /^Vehicle, 1 mg\/kg and 10 mg\/kg were compared by Ordinary one-way ANOVA\. Multiple comparisons: Dunnett \(Dunnett: each of 2 groups − Vehicle.*\)\. Confidence intervals are 95%\. Analyzed with statPlotter \d+\.\d+\.\d+\.$/,
    )
  })

  it('details collapsed: the omnibus checks and the data analyzed', async () => {
    const t = doses()
    const two = { ...t, dataSets: t.dataSets.slice(0, 2) }
    const a = analysis(two, 'ttest', {})
    const el = await show(setup([two, a]), a.id)
    const details = el.querySelector('details.result-details')!
    expect(details.hasAttribute('open')).toBe(false)
    const titles = [...details.querySelectorAll('thead th[colspan]')].map((th) => th.textContent)
    expect(titles).toEqual(['Data sets', 'Scatter in each group', 'Data analyzed'])
    expect(el.querySelector('.summary-sentence')!.textContent).toMatch(
      /^1 mg\/kg is higher than Vehicle by .*Welch’s t test\. n = 6 each\.$/,
    )
    // The labels are the groups' names.
    const labels = [...el.querySelectorAll('tbody th[scope="row"]')].map((th) => th.textContent)
    expect(labels).toContain('Mean of Vehicle')
    expect(labels).toContain('Difference between means (1 mg/kg − Vehicle)')
    expect(labels.join(' ')).not.toMatch(/column A|column B/)
  })
})

describe('names follow the method (U23)', () => {
  it('a new analysis is named by its method; editing renames it until the user does', async () => {
    const t = doses()
    const two = { ...t, dataSets: t.dataSets.slice(0, 2) }
    const services = setup([two])
    host = document.body.appendChild(document.createElement('div'))
    root = createRoot(host)
    const onCreated = vi.fn()
    act(() =>
      root!.render(
        <ServicesContext.Provider value={services}>
          <AnalyzeDialog
            mode="create"
            tableId={two.id}
            analysisId="ttest"
            onClose={vi.fn()}
            onError={vi.fn()}
            onCreated={onCreated}
          />
        </ServicesContext.Provider>,
      ),
    )
    await settle()
    const analyze = [...document.querySelectorAll('button')].find(
      (b) => b.textContent === 'Analyze',
    )!
    act(() => analyze.click())
    const id = onCreated.mock.calls[0]![0] as NodeId
    const node = () => services.store.getState().nodes[id] as AnalysisNode
    expect(node().name).toBe('Welch’s t test: 1 mg/kg vs Vehicle (Dose response)')
    expect(node().autoName).toBe(true)
    act(() => root!.unmount())
    root = createRoot(host)
    act(() =>
      root!.render(
        <ServicesContext.Provider value={services}>
          <AnalyzeDialog mode="edit" analysisId={id} onClose={vi.fn()} onError={vi.fn()} />
        </ServicesContext.Provider>,
      ),
    )
    await settle()
    const student = [...document.querySelectorAll('label')]
      .find((l) => l.textContent === 'No, equal scatter is known: Student’s t test')!
      .querySelector('input')!
    act(() => student.click())
    const apply = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Apply')!
    act(() => apply.click())
    expect(node().name).toBe('Student’s t test: 1 mg/kg vs Vehicle (Dose response)')
    // Renamed by hand: the name is the user's from then on.
    act(() => services.store.dispatch({ type: 'node.rename', id, name: 'Figure 2B' }, 'Rename'))
    expect(node().autoName).toBeUndefined()
  })
})
