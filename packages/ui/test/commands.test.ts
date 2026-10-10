import { describe, expect, it, vi } from 'vitest'
import {
  type Command,
  CommandRegistry,
  formatShortcut,
  GROUPS,
  matchesShortcut,
  parseShortcut,
} from '../src/commands/index.ts'

const key = (
  k: string,
  mods: Partial<Record<'meta' | 'ctrl' | 'shift' | 'alt', boolean>> = {},
) => ({
  key: k,
  metaKey: !!mods.meta,
  ctrlKey: !!mods.ctrl,
  shiftKey: !!mods.shift,
  altKey: !!mods.alt,
})

const cmd = (id: string, extra: Partial<Command> = {}): Command => ({
  id,
  label: id,
  run: () => {},
  ...extra,
})

describe('shortcuts', () => {
  it('parses modifiers and keys', () => {
    expect(parseShortcut('Mod+Shift+S')).toEqual({
      mod: true,
      ctrl: false,
      shift: true,
      alt: false,
      key: 's',
    })
    expect(parseShortcut('F2').key).toBe('F2')
    expect(parseShortcut('Mod++')).toMatchObject({ mod: true, key: '+' })
    expect(parseShortcut('Mod+=')).toMatchObject({ mod: true, key: '=' })
    expect(() => parseShortcut('Hyper+S')).toThrow(/unknown modifier/)
  })

  it('maps Mod to ⌘ on macOS and Ctrl elsewhere', () => {
    const s = parseShortcut('Mod+S')
    expect(matchesShortcut(s, key('s', { meta: true }), true)).toBe(true)
    expect(matchesShortcut(s, key('s', { ctrl: true }), true)).toBe(false)
    expect(matchesShortcut(s, key('s', { ctrl: true }), false)).toBe(true)
    expect(matchesShortcut(s, key('s', { meta: true }), false)).toBe(false)
  })

  it('requires exactly the modifiers given', () => {
    const s = parseShortcut('Mod+Z')
    expect(matchesShortcut(s, key('Z', { meta: true, shift: true }), true)).toBe(false)
    expect(
      matchesShortcut(parseShortcut('Mod+Shift+Z'), key('Z', { meta: true, shift: true }), true),
    ).toBe(true)
  })

  it('formats for each platform', () => {
    expect(formatShortcut('Mod+Shift+S', true)).toBe('⇧⌘S')
    expect(formatShortcut('Mod+Shift+S', false)).toBe('Ctrl+Shift+S')
    expect(formatShortcut('Alt+ArrowUp', true)).toBe('⌥↑')
    expect(formatShortcut('Delete', false)).toBe('Del')
  })
})

describe('command registry', () => {
  it('lets a view override an app command and wins shortcuts', () => {
    const r = new CommandRegistry()
    const appRun = vi.fn()
    const viewRun = vi.fn()
    r.set('app', 'app', [cmd('edit.selectAll', { shortcut: 'Mod+A', run: appRun })])
    r.set('view', 'view', [cmd('table.selectAll', { shortcut: 'Mod+A', run: viewRun })])
    const hit = r.match(key('a', { meta: true }), true, false)
    expect(hit?.id).toBe('table.selectAll')
    r.remove('view')
    expect(r.match(key('a', { meta: true }), true, false)?.id).toBe('edit.selectAll')
    r.set('view2', 'view', [cmd('edit.selectAll', { label: 'Select all cells', run: viewRun })])
    expect(r.get('edit.selectAll')?.label).toBe('Select all cells')
  })

  it('skips disabled, native and (in text fields) unmarked shortcuts', () => {
    const r = new CommandRegistry()
    r.set('a', 'app', [
      cmd('undo', { shortcut: 'Mod+Z', enabled: false }),
      cmd('copy', { shortcut: 'Mod+C', nativeShortcut: true }),
      cmd('save', { shortcut: 'Mod+S', inTextFields: true }),
      cmd('open', { shortcut: 'Mod+O' }),
    ])
    expect(r.match(key('z', { meta: true }), true, false)).toBeUndefined()
    expect(r.match(key('c', { meta: true }), true, false)).toBeUndefined()
    expect(r.match(key('s', { meta: true }), true, true)?.id).toBe('save')
    expect(r.match(key('o', { meta: true }), true, true)).toBeUndefined()
    expect(r.match(key('o', { meta: true }), true, false)?.id).toBe('open')
  })

  it('runs the latest run function without notifying when nothing shown changed', () => {
    const r = new CommandRegistry()
    const listener = vi.fn()
    r.subscribe(listener)
    const first = vi.fn()
    const second = vi.fn()
    r.set('a', 'app', [cmd('x', { run: first })])
    expect(listener).toHaveBeenCalledTimes(1)
    r.set('a', 'app', [cmd('x', { run: second })])
    expect(listener).toHaveBeenCalledTimes(1)
    expect(r.run('x')).toBe(true)
    expect(second).toHaveBeenCalled()
    expect(first).not.toHaveBeenCalled()
    r.set('a', 'app', [cmd('x', { run: second, enabled: false })])
    expect(listener).toHaveBeenCalledTimes(2)
    expect(r.run('x')).toBe(false)
  })

  it('builds menus with groups, separators, submenus and optional menus', () => {
    const r = new CommandRegistry()
    r.set('app', 'app', [
      cmd('file.save', { menu: { menu: 'file', group: GROUPS.file.save, order: 10 } }),
      cmd('file.open', { menu: { menu: 'file', group: GROUPS.file.open, order: 10 } }),
      cmd('file.saveAs', { menu: { menu: 'file', group: GROUPS.file.save, order: 20 } }),
    ])
    r.set('graph', 'view', [
      cmd('graph.exportSvg', {
        label: 'SVG…',
        menu: { menu: 'file', group: GROUPS.file.export, submenu: 'Export' },
      }),
      cmd('graph.exportPdf', {
        label: 'PDF…',
        menu: { menu: 'file', group: GROUPS.file.export, submenu: 'Export' },
      }),
    ])
    const menus = r.menus()
    expect(menus.map((m) => m.id)).not.toContain('arrange')
    expect(menus.map((m) => m.title)).toContain('Help')
    const file = menus.find((m) => m.id === 'file')!
    const shape = file.items.map((n) =>
      n.kind === 'command'
        ? n.command.id
        : n.kind === 'submenu'
          ? `${n.title}[${n.items.map((i) => (i.kind === 'command' ? i.command.label : '?')).join(',')}]`
          : '---',
    )
    expect(shape).toEqual([
      'file.open',
      '---',
      'file.save',
      'file.saveAs',
      '---',
      'Export[SVG…,PDF…]',
    ])

    r.set('layout', 'view', [cmd('layout.front', { menu: { menu: 'arrange', group: 10 } })])
    expect(r.menus().map((m) => m.id)).toContain('arrange')
  })

  it('groups toolbar buttons in order', () => {
    const r = new CommandRegistry()
    r.set('app', 'app', [
      cmd('redo', { toolbar: { group: 20, order: 2 } }),
      cmd('save', { toolbar: { group: 10, order: 3 } }),
      cmd('undo', { toolbar: { group: 20, order: 1 } }),
      cmd('open', { toolbar: { group: 10, order: 2 } }),
      cmd('plain'),
    ])
    expect(r.toolbar().map((g) => g.map((c) => c.id))).toEqual([
      ['open', 'save'],
      ['undo', 'redo'],
    ])
  })
})
