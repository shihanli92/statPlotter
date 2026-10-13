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
import { RESULT_ROWS_SHOWN, ResultsView } from '../src/analysis/ResultsView.tsx'
import { CommandRegistry, CommandsContext } from '../src/commands/index.ts'
import { ServicesContext } from '../src/context.tsx'
import { type AppServices, createServices } from '../src/services.ts'

// Audit 4 (P7): a results table shows its first RESULT_ROWS_SHOWN rows, and the rest on "Show
// all" (multiple t tests over 8,000 rows were 168,638 elements and 872 ms to open the tab).

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

/** A grouped table of `rows` rows, two data sets of three replicates (no random draws). */
function genes(rows: number): DataTable {
  const t = createTable({
    name: 'Genes',
    tableKind: 'grouped',
    columns: 2,
    rows,
    yFormat: { type: 'replicates', count: 3 },
  })
  t.dataSets.forEach((d, k) => {
    d.title = ['Control', 'Treated'][k]!
    d.subcolumns.forEach((sub, j) => {
      sub.values = Array.from({ length: rows }, (_, r) => 10 + ((r * 7 + j * 3 + k * 5) % 11))
    })
  })
  return t
}

function setup(t: DataTable, a: AnalysisNode): AppServices {
  const p: Project = createProject('Results')
  for (const n of [t, a]) {
    p.nodes[n.id] = n
    p.order.push(n.id)
  }
  return createServices({ fonts: {} as never, platform: {} as never, project: p })
}

const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)))

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
  for (let i = 0; i < 100 && !host.querySelector('table.results.grid'); i++) await wait(50)
  return host
}

describe('a results table of many rows (audit 4 P7)', () => {
  it('shows its first rows, and every row on Show all', async () => {
    const n = RESULT_ROWS_SHOWN + 300
    const t = genes(n)
    const def = registry.get('multipleT')!
    const a: AnalysisNode = {
      kind: 'analysis',
      id: newNodeId(),
      name: 'Multiple t tests',
      analysisId: 'multipleT',
      pluginVersion: def.version,
      input: { source: t.id, dataSets: t.dataSets.map((d) => d.id) },
      params: def.params.parse({}),
    }
    const el = await show(setup(t, a), a.id)
    // The tab of the t tests, one row each.
    const tab = [...el.querySelectorAll<HTMLElement>('[role="tab"]')].find(
      (b) => b.textContent === 't tests',
    )!
    act(() => tab.click())
    const big = () =>
      [...el.querySelectorAll('table.results.grid')].find(
        (g) => g.querySelectorAll('tbody tr').length >= RESULT_ROWS_SHOWN,
      )!
    expect(big().querySelectorAll('tbody tr').length).toBe(RESULT_ROWS_SHOWN)
    const more = el.querySelector('.results-more')!
    expect(more.textContent).toBe(`The first 500 of ${n} rows. Show all ${n} rows`)
    act(() => more.querySelector('button')!.click())
    expect(big().querySelectorAll('tbody tr').length).toBe(n)
    expect(el.querySelector('.results-more')).toBeNull()
  })
})
