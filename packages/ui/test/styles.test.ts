import { DocumentStore } from '@ps/engine'
import { DEFAULT_THEME, graphTheme, layoutGraph, presetGraph } from '@ps/graph'
import {
  builtinStyle,
  createProjectWith,
  type GraphNode,
  type LayoutNode,
  type NodeId,
  readStyle,
  userStyleChoice,
} from '@ps/model'
import { describe, expect, it, vi } from 'vitest'
import { fonts, projectOf, sampleTable } from '../../graph/test/helpers.ts'
import { CommandRegistry, GROUPS, nativeMenuSpec } from '../src/commands/index.ts'
import { sparseStroke } from '../src/components/formatFields.tsx'
import { memoryLibrary, resilientLibrary } from '../src/reuse/library.ts'
import type { Library } from '../src/services.ts'
import {
  applyStyleCommands,
  columnWidth,
  fitGraphCommands,
  fitPageCommands,
  pageGraphs,
  projectChoice,
  resetStyleCommands,
} from '../src/styles/styleActions.ts'
import {
  currentPreferences,
  deleteStyle,
  exportStyle,
  importStyle,
  loadPreferences,
  loadStyles,
  renameStyle,
  savePreferences,
  saveStyle,
  updateStyle,
} from '../src/styles/styleStore.ts'
import { inUnit, UNITS } from '../src/styles/units.ts'

// Roadmap 37 in the app: the user's styles and preferences in their library, applying a style
// (the user's edits kept), Reset to style (undo), Fit to column, Format edits written sparsely,
// Preferences on the macOS application menu.

const nature = builtinStyle('journal-nature')!
const cell = builtinStyle('journal-cell')!
const names = async (l: Library) => (await loadStyles(l)).map((s) => s.name)

describe('the style library', () => {
  it('saves, edits, renames and deletes styles', async () => {
    const lib = memoryLibrary()
    await saveStyle(lib, 'Lab', nature.style)
    await saveStyle(lib, 'Posters', { text: { axisTitle: { size: 20 } } })
    expect(await names(lib)).toEqual(['Lab', 'Posters'])
    await expect(saveStyle(lib, 'lab', {})).rejects.toThrow(/already a style/)
    await updateStyle(lib, 'Lab', { ...nature.style, symbolSize: 2 })
    expect((await loadStyles(lib))[0]!.style).toMatchObject({ name: 'Lab', symbolSize: 2 })
    await renameStyle(lib, 'Lab', 'Lab 2026')
    expect(await names(lib)).toEqual(['Lab 2026', 'Posters'])
    expect((await loadStyles(lib))[0]!.style.name).toBe('Lab 2026')
    await expect(renameStyle(lib, 'Posters', 'a/b')).rejects.toThrow(/can’t contain/)
    await deleteStyle(lib, 'Posters')
    expect(await names(lib)).toEqual(['Lab 2026'])
  })

  it('exports a .psstyle file another library imports under a free name', async () => {
    const lib = memoryLibrary()
    await saveStyle(lib, 'Lab', cell.style)
    const text = exportStyle((await loadStyles(lib))[0]!)
    expect(readStyle(text).order).toBeUndefined()
    const other = memoryLibrary()
    expect((await importStyle(other, text)).name).toBe('Lab')
    expect((await importStyle(other, text)).name).toBe('Lab (2)')
    const back = await loadStyles(other)
    expect(back[1]!.style).toEqual({ ...cell.style, name: 'Lab (2)' })
    await expect(importStyle(other, '{"format":"x"}')).rejects.toThrow('Not a style file.')
  })

  it('skips stray entries and falls back to memory when storage fails', async () => {
    const lib = memoryLibrary()
    await lib.write('junk', new TextEncoder().encode('hello'))
    await saveStyle(lib, 'Lab', {})
    expect(await names(lib)).toEqual(['Lab'])
    const broken: Library = {
      list: () => Promise.reject(new Error('blocked')),
      read: () => Promise.reject(new Error('blocked')),
      write: () => Promise.reject(new Error('blocked')),
      remove: () => Promise.reject(new Error('blocked')),
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = resilientLibrary(broken)
    await saveStyle(r, 'Lab', {})
    expect(await names(r)).toEqual(['Lab'])
    warn.mockRestore()
  })
})

describe('preferences', () => {
  it('are stored, read back, and only new projects take them', async () => {
    const lib = memoryLibrary()
    expect(await loadPreferences(lib)).toEqual({})
    await savePreferences(lib, { style: nature, units: 'mm', pValueStyle: 'NEJM' })
    expect(await loadPreferences(memoryLibrary())).toEqual({})
    expect(await loadPreferences(lib)).toEqual({ style: nature, units: 'mm', pValueStyle: 'NEJM' })
    expect(currentPreferences().units).toBe('mm')
    // A new project takes them; an existing one keeps its settings.
    const p = createProjectWith(currentPreferences())
    expect(p.settings).toMatchObject({ theme: nature.id, style: nature.style, pValueStyle: 'NEJM' })
    const existing = projectOf(sampleTable('column'))
    expect(existing.settings.theme).toBe('default')
    // Unreadable stored preferences: none.
    await lib.write('preferences', new TextEncoder().encode('{nope'))
    expect(await loadPreferences(lib)).toEqual(expect.any(Object))
    await savePreferences(lib, {})
  })

  it('units convert sizes for display', () => {
    expect(inUnit(72, UNITS.in)).toBe(1)
    expect(inUnit(72, UNITS.mm)).toBe(25.4)
    expect(inUnit(72, UNITS.pt)).toBe(72)
  })

  it('Preferences… is the application menu’s Settings… on macOS, Edit › Preferences… elsewhere', () => {
    const r = new CommandRegistry()
    r.set('app', 'app', [
      {
        id: 'app.preferences',
        label: 'Preferences…',
        shortcut: 'Mod+,',
        menu: { menu: 'edit', group: GROUPS.edit.preferences },
        run: () => {},
      },
      {
        id: 'edit.undo',
        label: 'Undo',
        shortcut: 'Mod+Z',
        menu: { menu: 'edit', group: GROUPS.edit.undo },
        run: () => {},
      },
    ])
    const mac = nativeMenuSpec(r.menus(), { isMac: true, appName: 'P' })
    expect(mac[0]!.items[2]).toMatchObject({
      kind: 'command',
      id: 'app.preferences',
      text: 'Settings…',
      accelerator: 'CmdOrCtrl+Comma',
    })
    const edit = mac.find((m) => m.text === 'Edit')!
    expect(edit.items.some((i) => i.kind === 'command' && i.id === 'app.preferences')).toBe(false)
    const other = nativeMenuSpec(r.menus(), { isMac: false, appName: 'P' })
    const editOther = other.find((m) => m.text === 'Edit')!
    expect(editOther.items.some((i) => i.kind === 'command' && i.id === 'app.preferences')).toBe(
      true,
    )
  })
})

describe('applying styles', () => {
  const setup = () => {
    const table = sampleTable('column')
    const g1 = { ...presetGraph(table, 'barsPoints'), id: 'g1' as NodeId }
    const g2 = { ...presetGraph(table, 'points'), id: 'g2' as NodeId }
    const store = new DocumentStore(projectOf(table, g1, g2))
    const graph = (id: string) => store.getState().nodes[id as NodeId] as GraphNode
    return { store, graph }
  }

  it('to the project, keeping the user’s edits; another style keeps them too; undo', () => {
    const { store, graph } = setup()
    store.dispatch(
      applyStyleCommands(store.getState(), nature, { kind: 'project', followAll: true }),
      'Apply style',
    )
    expect(projectChoice(store.getState().settings)?.id).toBe(nature.id)
    expect(graphTheme(store.getState(), graph('g1')).axisTitle.size).toBe(7)
    // The user's own font on one graph.
    store.dispatch(
      {
        type: 'node.set',
        id: 'g1' as NodeId,
        path: ['axes', 'y', 'tickLabels'],
        value: { size: 13 },
      },
      'Format numbers',
    )
    store.dispatch(
      applyStyleCommands(store.getState(), cell, { kind: 'project', followAll: true }),
      'Apply style',
    )
    expect(store.getState().settings.theme).toBe(cell.id)
    expect(graph('g1').axes.y.tickLabels).toEqual({ size: 13 })
    // Reset to style clears it; undo brings it back.
    store.dispatch(resetStyleCommands(store.getState(), ['g1' as NodeId]), 'Reset to style')
    expect(graph('g1').axes.y.tickLabels).toBeUndefined()
    store.undo()
    expect(graph('g1').axes.y.tickLabels).toEqual({ size: 13 })
    store.undo()
    store.undo()
    store.undo()
    expect(store.getState().settings).not.toHaveProperty('style')
    expect(graphTheme(store.getState(), graph('g1'))).toBe(DEFAULT_THEME)
  })

  it('to some graphs: their own style; the project’s own style means none', () => {
    const { store, graph } = setup()
    store.dispatch(
      applyStyleCommands(store.getState(), cell, { kind: 'graphs', ids: ['g2' as NodeId] }),
    )
    expect(graph('g2').theme).toEqual(cell)
    expect(graph('g1').theme).toBeUndefined()
    store.dispatch(
      applyStyleCommands(store.getState(), cell, { kind: 'project', followAll: false }),
    )
    // The project's style only: g2 keeps its own.
    expect(graph('g2').theme).toEqual(cell)
    store.dispatch(
      applyStyleCommands(store.getState(), cell, { kind: 'graphs', ids: ['g2' as NodeId] }),
    )
    expect(graph('g2').theme).toBeUndefined()
    const user = userStyleChoice({
      name: 'Lab',
      created: '',
      appVersion: '',
      style: { symbolSize: 2 },
    })
    store.dispatch(applyStyleCommands(store.getState(), user, { kind: 'project', followAll: true }))
    expect(store.getState().settings).toMatchObject({
      theme: 'user:Lab',
      style: { symbolSize: 2, name: 'Lab' },
    })
    // The app's own look again: no style values kept.
    store.dispatch(
      applyStyleCommands(store.getState(), builtinStyle('default')!, {
        kind: 'project',
        followAll: true,
      }),
    )
    expect(store.getState().settings).not.toHaveProperty('style')
    expect(store.getState().settings.theme).toBe('default')
  })

  it('a style’s P values become the project’s', () => {
    const { store } = setup()
    const p = { id: 'user:P', style: { pValue: { style: 'APA' as const, digits: 3 } } }
    store.dispatch(applyStyleCommands(store.getState(), p, { kind: 'project', followAll: true }))
    expect(store.getState().settings).toMatchObject({ pValueStyle: 'APA', pValueDigits: 3 })
  })
})

describe('Format edits write only what changed', () => {
  const axis = DEFAULT_THEME.axisLine
  it('a line’s width alone, not the colour and dash it inherits', () => {
    expect(sparseStroke({ ...axis, width: 2 }, axis, undefined)).toEqual({ width: 2 })
    expect(sparseStroke({ ...axis, width: 2, dash: 'dot' }, axis, { width: 2 })).toEqual({
      width: 2,
      dash: 'dot',
    })
    expect(sparseStroke(axis, axis, undefined)).toBeUndefined()
    // A field the element set stays its own, even when it equals the inherited value.
    expect(sparseStroke(axis, axis, { width: 1 })).toEqual({ width: 1 })
  })
})

describe('Fit to column', () => {
  it('a graph and a page, one undo step each', () => {
    const table = sampleTable('column')
    const g = {
      ...presetGraph(table, 'barsPoints'),
      id: 'g1' as NodeId,
      size: { plotWidth: 100, plotHeight: 80, scale: 1.5 },
    }
    const layout: LayoutNode = {
      kind: 'layout',
      id: 'p1' as NodeId,
      name: 'Page',
      page: { width: 612, height: 400 },
      items: [{ type: 'graph', id: 'i1' as never, graph: g.id, x: 36, y: 36, scale: 0.5 }],
      panelLabels: { show: true, style: 'A', size: 12 },
    }
    const base = projectOf(table, g, layout)
    const store = new DocumentStore({
      ...base,
      settings: { ...base.settings, theme: nature.id, style: nature.style },
    })
    const width = columnWidth(store.getState(), 'single')
    expect(width).toBeCloseTo((89 * 72) / 25.4, 1)
    store.dispatch(fitGraphCommands(store.getState(), fonts, g, width, 'aspect'), 'Fit to column')
    const fitted = store.getState().nodes[g.id] as GraphNode
    expect(fitted.size.scale).toBeUndefined()
    expect(layoutGraph({ project: store.getState(), graph: fitted, fonts }).width).toBeCloseTo(
      width,
      1,
    )
    store.undo()
    expect((store.getState().nodes[g.id] as GraphNode).size.scale).toBe(1.5)
    expect(pageGraphs(store.getState(), layout)).toEqual([g.id])
    const double = columnWidth(store.getState(), 'double')
    store.dispatch(
      fitPageCommands(store.getState(), fonts, layout, double, 'aspect'),
      'Fit to column',
    )
    const page = store.getState().nodes[layout.id] as LayoutNode
    expect(page.page.width).toBeCloseTo(double, 5)
    expect(page.items[0]).toMatchObject({ scale: 1 })
    store.undo()
    expect((store.getState().nodes[layout.id] as LayoutNode).page.width).toBe(612)
  })
})
