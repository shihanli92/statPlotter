import type { NodeId } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { deepFamily } from '../../engine/test/familyFixture.ts'
import { familyItems, kindSections, shownSections } from '../src/organise/navModel.ts'
import {
  actingOn,
  afterClick,
  clearToOpen,
  clickKind,
  currentSelection,
  extendTo,
  type NavSelection,
  onlyOpen,
  selectAllShown,
  showsSelection,
  visibleSheets,
} from '../src/organise/navSelection.ts'

// Roadmap 47 (UX review S8): the navigator's selection of several sheets — a plain click, ⌘ /
// Ctrl-click, Shift ranges over the rows shown in either view, Shift+↑/↓, ⌘A, Escape, and
// starting again when another sheet opens.

const byKind = (f: ReturnType<typeof deepFamily>, collapsed = new Set<string>()) =>
  visibleSheets(shownSections(kindSections(f.store.getState(), collapsed)).flatMap((s) => s.items))
const byFamily = (f: ReturnType<typeof deepFamily>, collapsed = new Set<string>()) =>
  visibleSheets(familyItems(f.store.getState(), collapsed))

describe('the navigator’s selection', () => {
  it('a plain click selects one sheet (the caller opens it); ⌘-click toggles without opening', () => {
    const f = deepFamily()
    const shown = byKind(f)
    let sel = onlyOpen(f.day1.id)
    expect(sel).toEqual({ ids: [f.day1.id], anchor: f.day1.id, open: f.day1.id })
    expect(showsSelection(sel)).toBe(false)
    sel = afterClick(sel, f.g1.id, 'toggle', shown)
    sel = afterClick(sel, f.whole.id, 'toggle', shown)
    expect(sel.ids).toEqual([f.day1.id, f.g1.id, f.whole.id])
    expect(sel.open).toBe(f.day1.id)
    expect(sel.anchor).toBe(f.whole.id)
    expect(showsSelection(sel)).toBe(true)
    // Again: out of the selection.
    sel = afterClick(sel, f.g1.id, 'toggle', shown)
    expect(sel.ids).toEqual([f.day1.id, f.whole.id])
    // A plain click starts again from the sheet clicked.
    expect(afterClick(sel, f.g2.id, 'plain', shown)).toEqual(onlyOpen(f.g2.id))
  })

  it('⌘ or Ctrl toggles (as on the canvas); Shift for ranges', () => {
    const e = (m: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }>) => ({
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      ...m,
    })
    expect(clickKind(e({ metaKey: true }))).toBe('toggle')
    expect(clickKind(e({ ctrlKey: true }))).toBe('toggle')
    expect(clickKind(e({ shiftKey: true }))).toBe('range')
    expect(clickKind(e({ shiftKey: true, metaKey: true }))).toBe('addRange')
    expect(clickKind(e({ shiftKey: true, ctrlKey: true }))).toBe('addRange')
    expect(clickKind(e({}))).toBe('plain')
  })

  it('Shift-click selects the rows from the anchor in the order shown (By kind)', () => {
    const f = deepFamily()
    const shown = byKind(f)
    // Sections in order: Data Tables, Results, Graphs, Layouts.
    expect(shown).toEqual([
      f.day1.id,
      f.other.id,
      f.scale.id,
      f.sumOfScale.id,
      f.sum.id,
      f.gof.id,
      f.g1.id,
      f.g2.id,
      f.gOther.id,
      f.whole.id,
      f.mixed.id,
    ])
    let sel = onlyOpen(f.sum.id)
    sel = afterClick(sel, f.g2.id, 'range', shown)
    expect(sel.ids).toEqual([f.sum.id, f.gof.id, f.g1.id, f.g2.id])
    // Upwards from the same anchor: replaces the range, nearest first.
    sel = afterClick(sel, f.sumOfScale.id, 'range', shown)
    expect(sel.ids).toEqual([f.sum.id, f.sumOfScale.id])
    expect(sel.anchor).toBe(f.sum.id)
    // ⌘-click elsewhere moves the anchor; ⌘⇧ adds a range to what is selected.
    sel = afterClick(sel, f.whole.id, 'toggle', shown)
    sel = afterClick(sel, f.mixed.id, 'addRange', shown)
    expect(sel.ids).toEqual([f.sum.id, f.sumOfScale.id, f.whole.id, f.mixed.id])
    // The open sheet is unchanged by all of it.
    expect(sel.open).toBe(f.sum.id)
  })

  it('ranges skip what folded folders and families hold (Families view)', () => {
    const f = deepFamily()
    const open = byFamily(f)
    // Day 1's family under it, then Other's, then the pages.
    const i = open.indexOf(f.day1.id)
    const j = open.indexOf(f.other.id)
    expect(j - i).toBeGreaterThan(1)
    const sel = afterClick(onlyOpen(f.day1.id), f.other.id, 'range', open)
    expect(sel.ids).toEqual(open.slice(i, j + 1))
    expect(sel.ids).toContain(f.g1.id)
    // Day 1's family folded: the range is the two tables.
    const folded = byFamily(f, new Set([`family:node:${f.day1.id}`]))
    expect(folded).not.toContain(f.g1.id)
    expect(afterClick(onlyOpen(f.day1.id), f.other.id, 'range', folded).ids).toEqual([
      f.day1.id,
      f.other.id,
    ])
    // A graph shown again under the page placing it is not a row of its own.
    expect(open.filter((id) => id === f.g1.id)).toHaveLength(1)
    // By kind with a folder folded: its sheets are left out too.
    f.store.dispatch([
      { type: 'folder.add', folder: { id: 'fold' as never, name: 'F' } },
      { type: 'folder.file', ids: [f.g2.id], folder: 'fold' as never },
    ])
    expect(byKind(f)).toContain(f.g2.id)
    expect(byKind(f, new Set(['kind:folder:fold']))).not.toContain(f.g2.id)
  })

  it('Shift+↑/↓ extends from the anchor; ⌘A selects every sheet shown; Escape clears', () => {
    const f = deepFamily()
    const shown = byKind(f)
    let sel = onlyOpen(f.g1.id)
    sel = extendTo(sel, f.g2.id, shown)
    sel = extendTo(sel, f.gOther.id, shown)
    expect(sel.ids).toEqual([f.g1.id, f.g2.id, f.gOther.id])
    sel = extendTo(sel, f.g2.id, shown)
    expect(sel.ids).toEqual([f.g1.id, f.g2.id])
    sel = selectAllShown(sel, shown)
    expect(sel.ids).toEqual(shown)
    expect(sel.open).toBe(f.g1.id)
    expect(clearToOpen(sel)).toEqual(onlyOpen(f.g1.id))
  })

  it('starts again when another sheet opens; drops sheets gone from the project', () => {
    const f = deepFamily()
    const has = (id: NodeId) => !!f.store.getState().nodes[id]
    const sel: NavSelection = { ids: [f.g1.id, f.g2.id], anchor: f.g2.id, open: f.g1.id }
    expect(currentSelection(sel, f.g1.id, has)).toBe(sel)
    expect(currentSelection(sel, f.whole.id, has)).toEqual(onlyOpen(f.whole.id))
    f.store.dispatch({ type: 'node.remove', id: f.g2.id })
    expect(currentSelection(sel, f.g1.id, has)).toEqual({
      ids: [f.g1.id],
      anchor: f.g1.id,
      open: f.g1.id,
    })
  })

  it('commands act on the selected sheets in navigator order, else the open one', () => {
    const f = deepFamily()
    const order = f.store.getState().order
    expect(actingOn({ ids: [f.whole.id, f.day1.id], anchor: null, open: f.g1.id }, order)).toEqual([
      f.day1.id,
      f.whole.id,
    ])
    expect(actingOn({ ids: [], anchor: null, open: f.g1.id }, order)).toEqual([f.g1.id])
    expect(actingOn(onlyOpen(null), order)).toEqual([])
  })
})
