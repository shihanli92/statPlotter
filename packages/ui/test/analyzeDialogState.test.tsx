// @vitest-environment happy-dom
import { registry } from '@ps/analyses'
import { prepareJob } from '@ps/engine'
import { presetGraph } from '@ps/graph'
import {
  type AnalysisNode,
  createProject,
  createTable,
  type DataTable,
  type DocNode,
  type GraphNode,
  type NodeId,
  type Project,
} from '@ps/model'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { AnalyzeDialog, SKETCH_DEBOUNCE_MS } from '../src/analysis/AnalyzeDialog.tsx'
import { ServicesContext } from '../src/context.tsx'
import { showOnGraphsCommands } from '../src/graph/results/resultActions.ts'
import { type AppServices, createServices } from '../src/services.ts'

// Audit 4 (step 2): the Analyze dialog's and Guide me's state — answers hidden, not lost, when
// one changes (A4); a control left out of the groups (U3); data sets deleted since Guide me
// remembered them (U4); editing an analysis with input modifiers (U2); factor names of a result
// table (U6); Show on graph while editing (U7); Apply with nothing changed (U8); the curve fit
// made through Transform X to log10 keeping Guide me's origin (U11).

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

function columnTable(n = 4): DataTable {
  const t = createTable({ name: 'Enzyme', tableKind: 'column', columns: n, rows: 5 })
  t.dataSets.forEach((d, i) => {
    d.title = ['A', 'B', 'C', 'D', 'E'][i]!
    d.subcolumns[0]!.values = [1, 2, 3, 4, 5].map((v) => v * (i + 1) + (v % 3))
  })
  return t
}

function setup(nodes: DocNode[]): AppServices {
  const p: Project = createProject('Dialog')
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

function close() {
  act(() => root?.unmount())
  root = null
  host?.remove()
  host = null
}

const button = (d: Element, name: string | RegExp) =>
  [...d.querySelectorAll('button')].find((b) =>
    typeof name === 'string' ? b.textContent === name : name.test(b.textContent ?? ''),
  )!
const radio = (d: Element, label: string) =>
  [...d.querySelectorAll('label')].find((l) => l.textContent === label)!.querySelector('input')!
const chip = (d: Element, name: string) =>
  [...d.querySelectorAll('.chips [role="option"]')].find(
    (o) => o.querySelector('.chip-title')?.textContent === name,
  ) as HTMLElement
const callbacks = () => ({ onClose: vi.fn(), onError: vi.fn(), onCreated: vi.fn() })
const analyses = (s: AppServices) =>
  Object.values(s.store.getState().nodes).filter((n): n is AnalysisNode => n.kind === 'analysis')

/** Answers Guide me's open questions with their first available answer until Use this. */
async function walkToUse(d: Element) {
  for (let k = 0; k < 12 && !button(d, 'Use this'); k++) {
    const open = [...d.querySelectorAll('fieldset.guide-question')].find(
      (q) => !q.querySelector('input[type="radio"]:checked'),
    )
    if (!open) break
    const r = [...open.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find(
      (x) => x.getAttribute('aria-disabled') !== 'true',
    )!
    act(() => r.click())
    await settle(10)
  }
}

describe('Guide me keeps answers a change hides (audit 4 A4)', () => {
  it('another answer and back: the later answers and the recommendation return', async () => {
    const t = columnTable(3)
    const d = await open(setup([t]), {
      mode: 'create',
      tableId: t.id,
      tab: 'guide',
      entry: 'vsControl',
      ...callbacks(),
    })
    act(() => radio(d, 'No, different subjects in each group').click())
    act(() => radio(d, 'Measurements').click())
    act(() => radio(d, 'No, similar scatter is expected').click())
    await settle(10)
    const recommended = () => d.querySelector('.guide-recommendation h3')?.textContent
    expect(recommended()).toBe('Recommended: One-way ANOVA')
    // As arrowing does: the next answer of "What kind of values?", then back.
    const values = radio(d, 'Measurements').closest('fieldset')!
    const other = [...values.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find(
      (x) => !x.checked && x.getAttribute('aria-disabled') !== 'true',
    )!
    act(() => other.click())
    await settle(10)
    expect(recommended()).not.toBe('Recommended: One-way ANOVA')
    act(() => radio(d, 'Measurements').click())
    await settle(10)
    expect(recommended()).toBe('Recommended: One-way ANOVA')
    expect(radio(d, 'No, similar scatter is expected').checked).toBe(true)
  })
})

describe('a control left out of the groups (audit 4 U3)', () => {
  const controlOf = (n: AnalysisNode) => (n.params as { control: string }).control

  it('the chips: the first chosen group becomes the control, as the run compares', async () => {
    const t = columnTable()
    const s = setup([t])
    const d = await open(s, {
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
    act(() => chip(d, 'D').querySelector<HTMLElement>('.chip-control')!.click())
    await settle()
    expect(d.querySelector('.comparing')?.textContent).toMatch(/D/)
    act(() => chip(d, 'D').click())
    await settle()
    // Said, stored and run alike: each group against A.
    expect(d.querySelector('.comparing')?.textContent).not.toMatch(/D/)
    expect(d.querySelector('.comparing')?.textContent).toMatch(/A/)
    act(() => button(d, 'Analyze').click())
    const n = analyses(s)[0]!
    expect(n.input.dataSets).not.toContain(t.dataSets[3]!.id)
    expect([n.input.dataSets[0], '']).toContain(controlOf(n))
  })

  it('Guide me: Use this carries the control the select shows', async () => {
    const t = columnTable()
    const s = setup([t])
    const d = await open(s, {
      mode: 'create',
      tableId: t.id,
      tab: 'guide',
      entry: 'vsControl',
      ...callbacks(),
    })
    await walkToUse(d)
    const select = () => d.querySelector<HTMLSelectElement>('.guide-ask select')!
    act(() => {
      select().value = t.dataSets[3]!.id
      select().dispatchEvent(new Event('change', { bubbles: true }))
    })
    await settle(10)
    const box = [...d.querySelectorAll('.guide-groups label')]
      .find((l) => l.textContent === 'D')!
      .querySelector('input')!
    act(() => box.click())
    await settle(10)
    await walkToUse(d)
    const shown = select().value
    expect(shown).not.toBe(t.dataSets[3]!.id)
    act(() => button(d, 'Use this').click())
    await settle()
    act(() => button(d, 'Analyze').click())
    const n = analyses(s)[0]!
    expect(controlOf(n)).toBe(shown)
    expect(n.input.dataSets).toContain(controlOf(n))
  })
})

describe('data sets deleted since Guide me remembered them (audit 4 U4)', () => {
  it('are dropped: the facts, Use this and the analysis name only those left', async () => {
    const t = columnTable(4)
    const s = setup([t])
    const cb = callbacks()
    let d = await open(s, {
      mode: 'create',
      tableId: t.id,
      tab: 'guide',
      entry: 'groupsDiffer',
      ...cb,
    })
    act(() =>
      d.querySelector<HTMLInputElement>('fieldset.guide-question input[type="radio"]')!.click(),
    )
    await settle(10)
    close()
    const gone = t.dataSets[1]!.id
    s.store.dispatch({ type: 'table.removeDataSets', table: t.id, ids: [gone] })
    d = await open(s, { mode: 'create', tableId: t.id, tab: 'guide', ...cb })
    expect(d.querySelector('.guide-facts')?.textContent ?? '').toMatch(/3 groups/)
    await walkToUse(d)
    act(() => button(d, 'Use this').click())
    await settle()
    expect(d.querySelector('.comparing')?.textContent ?? '').not.toMatch(/6 comparisons/)
    expect(button(d, 'Analyze').disabled).toBe(false)
    act(() => button(d, 'Analyze').click())
    expect(cb.onError).not.toHaveBeenCalled()
    const n = analyses(s)[0]!
    expect(n.input.dataSets).not.toContain(gone)
    const table = s.store.getState().nodes[t.id] as DataTable
    for (const k of n.input.dataSets) expect(table.dataSets.some((x) => x.id === k)).toBe(true)
    expect(prepareJob(s.store.getState(), n, registry).ok).toBe(true)
  })
})

/** An XY table of two data sets, three replicates, X = 1, 2, 3 twice. */
function xyTable(): DataTable {
  const t = createTable({
    name: 'Course',
    tableKind: 'xy',
    columns: 2,
    rows: 6,
    yFormat: { type: 'replicates', count: 3 },
  })
  t.x!.subcolumns[0]!.values = [1, 2, 3, 1, 2, 3]
  t.dataSets.forEach((d, i) => {
    d.title = ['Control', 'Treated'][i]!
    d.subcolumns.forEach((s, j) => {
      s.values = [1, 2, 3, 4, 5, 6].map((v) => v + i * 2 + j * 0.5 + (v % 2) * 0.3)
    })
  })
  return t
}

describe('editing an analysis with input modifiers (audit 4 U2)', () => {
  const nodeOf = (t: DataTable, id: string, input: Partial<AnalysisNode['input']>, p = {}) => {
    const def = registry.get(id)!
    return {
      kind: 'analysis',
      id: 'm1' as NodeId,
      name: 'Modified',
      analysisId: id,
      pluginVersion: def.version,
      input: { source: t.id, dataSets: t.dataSets.map((d) => d.id), ...input },
      params: def.params.parse(p),
    } as AnalysisNode
  }

  it('a t test at one X: its values, and the methods of a column of values', async () => {
    const t = xyTable()
    const s = setup([t, nodeOf(t, 'ttest', { atX: 2 })])
    const cb = callbacks()
    const d = await open(s, { mode: 'edit', analysisId: 'm1' as NodeId, ...cb })
    // At X = 2: two rows of three replicates, six values each (not all eighteen).
    expect(d.querySelector('.sketch-counts')?.textContent).toMatch(/\b6 values each/)
    expect(button(d, 'Apply').disabled).toBe(false)
    act(() => button(d, 'Change method…').click())
    const offered = [...d.querySelectorAll('.analyze-options [role="option"]')].map(
      (o) => o.textContent ?? '',
    )
    expect(offered.some((o) => /^t test/.test(o))).toBe(true)
    expect(offered.some((o) => /linear regression/i.test(o))).toBe(false)
    act(() => button(d, 'Apply').click())
    expect(cb.onError).not.toHaveBeenCalled()
  })

  it('two-way ANOVA at each X: the cells of the X values, Apply allowed', async () => {
    const t = xyTable()
    const s = setup([
      t,
      nodeOf(t, 'twoWayAnova', { byX: true }, { comparisons: 'withinRows', kind: 'allPairs' }),
    ])
    const d = await open(s, { mode: 'edit', analysisId: 'm1' as NodeId, ...callbacks() })
    expect(button(d, 'Apply').disabled).toBe(false)
    const words = `${d.querySelector('.sketch-counts')?.textContent} ${d.querySelector('.sketch-description')?.textContent}`
    expect(words).not.toMatch(/× 6|6 rows/)
    expect(words).toMatch(/× 3|3 rows/)
  })
})

describe('factor names of a result table (audit 4 U6)', () => {
  it('are asked of data tables only: nothing is written onto the upstream analysis', async () => {
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
        s.values = [1 + i + j, 3 + i * 2 - j]
      })
    })
    const tr = registry.get('transform')!
    const up: AnalysisNode = {
      kind: 'analysis',
      id: 'tr1' as NodeId,
      name: 'Transform of G',
      analysisId: 'transform',
      pluginVersion: tr.version,
      input: { source: t.id, dataSets: t.dataSets.map((d) => d.id) },
      params: tr.params.parse({ y: 'log10' }),
    }
    const s = setup([t, up])
    await s.engine.idle()
    const d = await open(s, {
      mode: 'create',
      tableId: up.id,
      analysisId: 'twoWayAnova',
      tab: 'all',
      ...callbacks(),
    })
    expect(d.querySelector('.factor-names')).toBeNull()
    act(() => button(d, 'Analyze').click())
    expect('factorNames' in (s.store.getState().nodes[up.id] as object)).toBe(false)
    // A data table still asks.
    close()
    const d2 = await open(s, {
      mode: 'create',
      tableId: t.id,
      analysisId: 'twoWayAnova',
      tab: 'all',
      ...callbacks(),
    })
    expect(d2.querySelector('.factor-names')).not.toBeNull()
  })
})

describe('Show on graph while editing (audit 4 U7)', () => {
  it('a result already shown is ticked, and Apply adds no second copy', async () => {
    const t = xyTable()
    const def = registry.get('linearRegression')!
    const node: AnalysisNode = {
      kind: 'analysis',
      id: 'lr' as NodeId,
      name: 'Linear regression',
      analysisId: 'linearRegression',
      pluginVersion: def.version,
      input: { source: t.id, dataSets: [t.dataSets[0]!.id] },
      params: def.params.parse({}),
    }
    const graph: GraphNode = { ...presetGraph(t, 'meanSd'), id: 'g1' as NodeId }
    const s = setup([t, node, graph])
    await s.engine.idle()
    const offer = 'Show the equation and R² on the graph'
    const templates = def.graphResults!(node.params, {
      tableKind: 'xy',
      dataSets: node.input.dataSets,
    }).filter((x) => x.offer === offer)
    s.store.dispatch(
      showOnGraphsCommands(s.store.getState(), node, templates, (id) => s.engine.latest(id)),
      'Show',
    )
    const shown = () =>
      (s.store.getState().nodes['g1' as NodeId] as GraphNode).layers.filter(
        (l) => l.data?.from === 'analysis',
      ).length
    const before = shown()
    expect(before).toBeGreaterThan(0)
    const d = await open(s, { mode: 'edit', analysisId: node.id, ...callbacks() })
    for (const toggle of d.querySelectorAll<HTMLButtonElement>(
      '.tier-toggle[aria-expanded="false"]',
    ))
      act(() => toggle.click())
    const box = [...d.querySelectorAll('label')]
      .find((l) => l.textContent === offer)!
      .querySelector('input')!
    expect(box.checked).toBe(true)
    act(() => box.click())
    act(() => button(d, 'Apply').click())
    expect(shown()).toBe(before)
  })
})

describe('Apply with nothing changed (audit 4 U8)', () => {
  it('closes without an undo step, the document clean', async () => {
    const t = columnTable(2)
    const def = registry.get('ttest')!
    const node: AnalysisNode = {
      kind: 'analysis',
      id: 'a3' as NodeId,
      name: 'My t test',
      analysisId: 'ttest',
      pluginVersion: def.version,
      input: { source: t.id, dataSets: t.dataSets.map((d) => d.id) },
      params: def.params.parse({}),
    }
    const s = setup([t, node])
    const cb = callbacks()
    const before = s.store.historyLength
    const d = await open(s, { mode: 'edit', analysisId: node.id, ...cb })
    act(() => button(d, 'Apply').click())
    expect(cb.onClose).toHaveBeenCalled()
    expect(s.store.historyLength).toEqual(before)
    expect(s.store.dirty).toBe(false)
    // A change still makes its step.
    const d2 = await (async () => {
      close()
      return open(s, { mode: 'edit', analysisId: node.id, ...callbacks() })
    })()
    act(() => radio(d2, 'No, equal scatter is known: Student’s t test').click())
    await settle()
    act(() => button(d2, 'Apply').click())
    expect(s.store.historyLength.undo).toBe(before.undo + 1)
  })
})

describe('Compare these columns… of a nested table (audit 4 U10)', () => {
  it('opens Guide me on the nested question, not an empty page', async () => {
    const t = createTable({
      name: 'N',
      tableKind: 'nested',
      columns: 2,
      rows: 4,
      yFormat: { type: 'replicates', count: 2 },
    })
    const d = await open(setup([t]), {
      mode: 'create',
      tableId: t.id,
      tab: 'guide',
      entry: 'groupsDiffer',
      dataSets: t.dataSets.map((x) => x.id),
      ...callbacks(),
    })
    expect(d.querySelector('.guide-start')).toBeNull()
    expect(d.querySelector('.guide-entries [aria-pressed="true"]')).not.toBeNull()
    expect(
      d.querySelector('fieldset.guide-question, .guide-fact, .guide-recommendation'),
    ).not.toBeNull()
  })
})
