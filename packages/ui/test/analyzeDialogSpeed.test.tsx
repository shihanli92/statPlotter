// @vitest-environment happy-dom
import { createProject, createTable, type DataTable, type Project } from '@ps/model'
import { act, Profiler } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { AnalyzeDialog, SKETCH_DEBOUNCE_MS } from '../src/analysis/AnalyzeDialog.tsx'
import { ServicesContext } from '../src/context.tsx'
import { createServices } from '../src/services.ts'

// Audit 4 (step 3, speed): the Analyze dialog does no work while nothing changes (U1).

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
  const t = createTable({ name: 'Enzyme', tableKind: 'column', columns: n, rows: 5 })
  t.dataSets.forEach((d, i) => {
    d.title = ['A', 'B', 'C', 'D', 'E'][i]!
    d.subcolumns[0]!.values = [1, 2, 3, 4, 5].map((v) => v * (i + 1) + (v % 3))
  })
  return t
}

const settle = (ms = SKETCH_DEBOUNCE_MS + 30) => act(() => new Promise((r) => setTimeout(r, ms)))

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

describe('the Analyze dialog at rest (audit 4 U1)', () => {
  it.each([
    ['ttest', columnTable],
    ['oneWayAnova', columnTable],
    ['powerAnalysis', columnTable],
    ['multipleRegression', variablesTable],
  ] as const)(
    '%s: nothing more renders once the sketch and checks have settled',
    async (id, make) => {
      const t = make()
      const p: Project = createProject('Dialog')
      p.nodes[t.id] = t
      p.order.push(t.id)
      const services = createServices({ fonts: {} as never, platform: {} as never, project: p })
      let commits = 0
      host = document.body.appendChild(document.createElement('div'))
      root = createRoot(host)
      const callbacks = { onClose: vi.fn(), onError: vi.fn(), onCreated: vi.fn() }
      const draw = () =>
        root!.render(
          <ServicesContext.Provider value={services}>
            <Profiler id="dialog" onRender={() => commits++}>
              <AnalyzeDialog mode="create" tableId={t.id} analysisId={id} {...callbacks} />
            </Profiler>
          </ServicesContext.Provider>,
        )
      act(draw)
      await settle()
      // Any render (as the dialog's own size observer makes in a browser) once it has settled.
      act(draw)
      await settle()
      await settle()
      const settled = commits
      // Each act flushes what its timers set: a debounce loop commits once per wait.
      for (let k = 0; k < 6; k++) await settle()
      expect(commits - settled).toBe(0)
    },
  )
})
