// @vitest-environment happy-dom
import {
  createProject,
  createTable,
  type DocNode,
  type FolderId,
  type NodeId,
  type Project,
} from '@ps/model'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { graph, layout } from '../../engine/test/familyFixture.ts'
import { CommandsContext, createCommandRegistry, isMacPlatform } from '../src/commands/index.ts'
import type { CommandRegistry } from '../src/commands/registry.ts'
import { ConfirmContext, type Question } from '../src/components/modals.tsx'
import { ServicesContext } from '../src/context.tsx'
import { Navigator } from '../src/Navigator.tsx'
import { type AppServices, createServices } from '../src/services.ts'

// Roadmap 47 (UX review S8): the navigator with several sheets selected, rendered — ⌘ / Ctrl and
// Shift clicks, the rows' selected state, Shift+↓, ⌘A, Escape, and Delete of the selection as
// one step after one question; the commands' labels counting the sheets.

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
beforeEach(() => {
  try {
    localStorage.removeItem('ps.nav.view')
    localStorage.removeItem('ps.nav.collapsed')
  } catch {}
})

/** Tables A, B, C, a graph of each, a page placing the first two. */
function project(): { project: Project; ids: Record<string, NodeId> } {
  const p = createProject('Nav')
  const tables = ['A', 'B', 'C'].map((name) => createTable({ name, rows: 2, columns: 1 }))
  const graphs = tables.map((t) => graph(`${t.name} graph`, t.id))
  const page = layout('Figure', [graphs[0]!.id, graphs[1]!.id])
  const nodes: DocNode[] = [...tables, ...graphs, page]
  for (const n of nodes) {
    p.nodes[n.id] = n
    p.order.push(n.id)
  }
  return { project: p, ids: Object.fromEntries(nodes.map((n) => [n.name, n.id])) }
}

interface Rendered {
  services: AppServices
  registry: CommandRegistry
  ids: Record<string, NodeId>
  asked: Question[]
  open: () => NodeId | null
  styled: NodeId[][]
  exported: NodeId[][]
}

function render(answer = true): Rendered {
  const { project: p, ids } = project()
  const services = createServices({ fonts: {} as never, platform: {} as never, project: p })
  const registry = createCommandRegistry()
  const asked: Question[] = []
  const styled: NodeId[][] = []
  const exported: NodeId[][] = []
  let opened: NodeId | null = null
  function Harness() {
    const [selected, setSelected] = useState<NodeId | null>(ids.A!)
    opened = selected
    return (
      <Navigator
        selected={selected}
        onSelect={setSelected}
        onApplyStyle={(g) => styled.push(g)}
        onExport={(s) => exported.push(s)}
      />
    )
  }
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() =>
    root!.render(
      <ServicesContext.Provider value={services}>
        <CommandsContext.Provider value={registry}>
          <ConfirmContext.Provider
            value={(q) => {
              asked.push(q)
              return Promise.resolve(answer)
            }}
          >
            <Harness />
          </ConfirmContext.Provider>
        </CommandsContext.Provider>
      </ServicesContext.Provider>,
    ),
  )
  return { services, registry, ids, asked, open: () => opened, styled, exported }
}

const MOD = isMacPlatform() ? { metaKey: true } : { ctrlKey: true }

const row = (id: NodeId) => host!.querySelector<HTMLElement>(`.nav-item[data-node="${id}"]`)!
const click = (id: NodeId, mods: MouseEventInit = {}) =>
  act(() => {
    row(id).dispatchEvent(new MouseEvent('click', { bubbles: true, ...mods }))
  })
const key = (id: NodeId, k: string, mods: KeyboardEventInit = {}) =>
  act(() => {
    row(id).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...mods }))
  })
const selectedNames = (r: Rendered) => {
  const names = new Map(Object.entries(r.ids).map(([k, v]) => [v, k]))
  return [...host!.querySelectorAll<HTMLElement>('.nav-item[aria-selected="true"]')].map((el) =>
    names.get(el.dataset.node as NodeId),
  )
}

describe('the navigator with several sheets selected', () => {
  it('is a tree per section, multi-selectable, its rows saying which are selected', () => {
    const r = render()
    const trees = [...host!.querySelectorAll('[role="tree"]')]
    expect(trees.map((t) => t.getAttribute('aria-label'))).toEqual([
      'Data Tables',
      'Graphs',
      'Layouts',
    ])
    expect(trees.every((t) => t.getAttribute('aria-multiselectable') === 'true')).toBe(true)
    expect(row(r.ids.A!).getAttribute('role')).toBe('treeitem')
    expect(selectedNames(r)).toEqual(['A'])
    // The open sheet alone looks as it did.
    expect(host!.querySelector('.nav-item.selected')).toBeNull()
  })

  it('⌘ / Ctrl-click adds without opening; Shift-click selects a range; a plain click resets', () => {
    const r = render()
    click(r.ids['B graph']!, MOD)
    expect(r.open()).toBe(r.ids.A)
    expect(selectedNames(r)).toEqual(['A', 'B graph'])
    expect(row(r.ids['B graph']!).classList.contains('selected')).toBe(true)
    expect(host!.querySelector('[role="status"]')!.textContent).toBe('2 sheets selected')
    // From the anchor (B graph) to the page, in the order shown.
    click(r.ids.Figure!, { shiftKey: true })
    expect(selectedNames(r)).toEqual(['B graph', 'C graph', 'Figure'])
    expect(r.open()).toBe(r.ids.A)
    // The commands count them.
    expect(r.registry.get('edit.deleteSheet')!.label).toBe('Delete 3 sheets')
    expect(r.registry.get('edit.duplicateSheet')!.label).toBe('Duplicate 3 sheets')
    expect(r.registry.get('edit.moveToFolder')!.label).toBe('Move 3 sheets to folder…')
    expect(r.registry.get('edit.renameSheet')!.enabled).toBe(false)
    expect(r.registry.get('edit.moveSheetUp')!.enabled).toBe(false)
    expect(r.registry.get('file.export.selected')!.label).toBe('Selected in the navigator (3)…')
    expect(r.registry.get('format.applyStyleSelected')!.label).toBe(
      'Apply style to the selected graphs (2)…',
    )
    r.registry.run('format.applyStyleSelected')
    r.registry.run('file.export.selected')
    expect(r.styled).toEqual([[r.ids['B graph'], r.ids['C graph']]])
    expect(r.exported).toEqual([[r.ids['B graph'], r.ids['C graph'], r.ids.Figure]])
    // A plain click opens one and selects it alone.
    click(r.ids.C!)
    expect(r.open()).toBe(r.ids.C)
    expect(selectedNames(r)).toEqual(['C'])
    expect(r.registry.get('edit.deleteSheet')!.label).toBe('Delete sheet')
  })

  it('Shift+↓ extends, ⌘A selects every sheet shown, Escape goes back to the open sheet', () => {
    const r = render()
    key(r.ids.A!, 'ArrowDown', { shiftKey: true })
    key(r.ids.B!, 'ArrowDown', { shiftKey: true })
    expect(selectedNames(r)).toEqual(['A', 'B', 'C'])
    key(r.ids.C!, 'a', MOD)
    expect(selectedNames(r)).toHaveLength(7)
    key(r.ids.C!, 'Escape')
    expect(selectedNames(r)).toEqual(['A'])
    expect(r.open()).toBe(r.ids.A)
  })

  it('Delete on a selected row: one question, one step; undo brings them back', async () => {
    const r = render()
    const before = r.services.store.getState()
    click(r.ids.B!, MOD)
    click(r.ids.Figure!, MOD)
    await act(async () => key(r.ids.B!, 'Delete'))
    expect(r.asked).toHaveLength(1)
    expect(r.asked[0]!.title).toBe('Delete 3 sheets?')
    // A (open, so selected), B and the page; the tables' graphs go with them.
    expect(r.asked[0]!.message).toBe(
      '“A”, “B” and “Figure” will be deleted. With them: 2 graphs (“A graph” and “B graph”). You can undo this.',
    )
    const doc = r.services.store.getState()
    expect(doc.order.map((id) => doc.nodes[id]!.name)).toEqual(['C', 'C graph'])
    expect(r.services.store.undoLabel).toBe('Delete 3 sheets')
    expect(r.services.store.historyLength.undo).toBe(1)
    // The open sheet was deleted: the one now where the first deleted one was is opened.
    expect(r.open()).toBe(r.ids.C)
    act(() => {
      r.services.store.undo()
    })
    expect(r.services.store.getState()).toEqual(before)
  })

  it('Delete on a row outside the selection deletes that row only; a no keeps everything', async () => {
    const r = render(false)
    const before = r.services.store.getState()
    click(r.ids.B!, MOD)
    await act(async () => key(r.ids.A!, 'Delete'))
    expect(r.asked).toHaveLength(1)
    expect(r.services.store.getState()).toBe(before)
    // C isn't selected: deleted alone, without a question (no warning).
    await act(async () => key(r.ids['C graph']!, 'Delete'))
    expect(r.asked).toHaveLength(1)
    expect(r.services.store.getState().nodes[r.ids['C graph']!]).toBeUndefined()
  })

  it('deleting a sheet that isn’t open keeps the open one open (audit 3, U3)', async () => {
    const r = render()
    expect(r.open()).toBe(r.ids.A)
    // Delete on C graph's row (focused, not open), and Edit › Delete sheet on its row.
    await act(async () => key(r.ids['C graph']!, 'Delete'))
    expect(r.services.store.getState().nodes[r.ids['C graph']!]).toBeUndefined()
    expect(r.open()).toBe(r.ids.A)
    await act(async () => key(r.ids['B graph']!, 'Delete'))
    expect(r.open()).toBe(r.ids.A)
    // The open sheet deleted: the next one opens, as before.
    await act(async () => key(r.ids.A!, 'Delete'))
    expect(r.open()).not.toBe(r.ids.A)
    expect(r.open()).not.toBeNull()
  })

  it('Duplicate and Move to folder of the selection are one step each', () => {
    const r = render()
    click(r.ids.B!, MOD)
    act(() => r.registry.run('edit.duplicateSheet'))
    const doc = r.services.store.getState()
    expect(doc.order.map((id) => doc.nodes[id]!.name).slice(0, 4)).toEqual([
      'A',
      'A (copy)',
      'B',
      'B (copy)',
    ])
    expect(r.services.store.undoLabel).toBe('Duplicate 2 sheets')
    // The copies are selected, the first opened.
    expect(selectedNames(r)).toHaveLength(2)
    expect(r.open()).toBe(doc.order[1])
    act(() => {
      r.services.store.dispatch({
        type: 'folder.add',
        folder: { id: 'f' as FolderId, name: 'F' },
      })
    })
    act(() => r.registry.run('edit.moveToFolder'))
    const dialog = document.querySelector('dialog')!
    expect(dialog.textContent).toContain('Move 2 sheets to a folder')
  })
})
