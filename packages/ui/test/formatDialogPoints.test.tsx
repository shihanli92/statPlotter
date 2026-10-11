// @vitest-environment happy-dom
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createGraphFor, FontRegistry } from '@ps/graph'
import { createProject, createTable, type GraphNode, type NodeId } from '@ps/model'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { ServicesContext } from '../src/context.tsx'
import { FormatDialog } from '../src/graph/format/FormatDialog.tsx'
import { pointPlace } from '../src/graph/format/route.ts'
import type { PointRef } from '../src/graph/pointEdits.ts'
import { createServices } from '../src/services.ts'

// Audit 3 (U5): "Open in window" with several points selected formats them all, as the panel
// does (roadmap 47), not only the primary one.

// The dialog's preview lays the graph out: the bundled fonts, read by path (happy-dom's URLs
// aren't Node's, so not the graph test helpers' loader).
const FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../graph/assets/fonts')
const fonts = await FontRegistry.load(
  async (file) => new Uint8Array(await readFile(join(FONT_DIR, file))),
)

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
  const table = createTable({ tableKind: 'column', columns: 1, rows: 3 })
  table.dataSets[0]!.subcolumns[0]!.values = [1, 4, 9]
  const graph: GraphNode = { ...createGraphFor(table), id: 'g1' as NodeId }
  const project = createProject()
  project.nodes[table.id] = table
  project.nodes[graph.id] = graph
  project.order.push(table.id, graph.id)
  const services = createServices({ fonts, platform: {} as never, project })
  return { services, ds: table.dataSets[0]!.id as string, graph }
}

describe('the Format dialog of several points', () => {
  it('writes a point’s change to every selected point, in one step', () => {
    const { services, ds, graph } = setup()
    const points: PointRef[] = [
      [ds, 'r0s0'],
      [ds, 'r2s0'],
    ]
    host = document.body.appendChild(document.createElement('div'))
    root = createRoot(host)
    act(() =>
      root!.render(
        <ServicesContext.Provider value={services}>
          <FormatDialog
            graphId={graph.id}
            initial={pointPlace(ds, 'r0s0')}
            points={points}
            onClose={() => {}}
          />
        </ServicesContext.Provider>,
      ),
    )
    const label = [...host.querySelectorAll('label')].find((l) => l.textContent === 'Size (pt)')!
    const size = document.getElementById(label.htmlFor) as HTMLInputElement
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    act(() => {
      set.call(size, '11')
      size.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const ok = [...host.querySelectorAll('button')].find((b) => b.textContent === 'OK')!
    act(() => ok.click())
    const g = services.store.getState().nodes[graph.id] as GraphNode
    expect(g.pointOverrides?.[ds]?.r0s0?.size).toBe(11)
    expect(g.pointOverrides?.[ds]?.r2s0?.size).toBe(11)
    expect(g.pointOverrides?.[ds]?.r1s0).toBeUndefined()
    expect(services.store.historyLength.undo).toBe(1)
  })
})
