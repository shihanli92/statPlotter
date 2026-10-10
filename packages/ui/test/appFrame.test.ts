import { describe, expect, it, vi } from 'vitest'
import {
  type Command,
  CommandRegistry,
  GROUPS,
  menuPaths,
  NativeKeyGate,
  nativeCommandItems,
  nativeMenuSpec,
  nativeStructureKey,
  type PaletteEntry,
  rankPalette,
  toAccelerator,
} from '../src/commands/index.ts'
import { menuItemsFor } from '../src/components/commandItems.ts'
import { shortcutSections } from '../src/components/HelpDialogs.tsx'
import { hasIcon } from '../src/components/icons.tsx'
import { addRecent, MAX_RECENT, parseRecentPaths } from '../src/recent.ts'

const cmd = (id: string, extra: Partial<Command> = {}): Command => ({
  id,
  label: id,
  run: () => {},
  ...extra,
})

const key = (k: string, mods: { meta?: boolean; ctrl?: boolean; shift?: boolean } = {}) => ({
  key: k,
  metaKey: !!mods.meta,
  ctrlKey: !!mods.ctrl,
  shiftKey: !!mods.shift,
  altKey: false,
})

/** A small app-like registry: File with a submenu, Edit, Help. */
function sample() {
  const r = new CommandRegistry()
  r.set('app', 'app', [
    cmd('file.open', {
      label: 'Open…',
      shortcut: 'Mod+O',
      menu: { menu: 'file', group: GROUPS.file.open, order: 20 },
    }),
    cmd('file.recent.0', {
      label: 'a.psproj',
      menu: { menu: 'file', group: GROUPS.file.open, order: 30, submenu: 'Open recent' },
    }),
    cmd('file.save', {
      label: 'Save',
      shortcut: 'Mod+S',
      menu: { menu: 'file', group: GROUPS.file.save },
    }),
    cmd('edit.undo', {
      label: 'Undo Rename',
      shortcut: 'Mod+Z',
      menu: { menu: 'edit', group: GROUPS.edit.undo },
    }),
    cmd('view.navigator', {
      label: 'Show navigator',
      shortcut: 'Mod+\\',
      checked: true,
      menu: { menu: 'view', group: GROUPS.view.panels },
    }),
    cmd('help.palette', {
      label: 'Command palette…',
      shortcut: 'Mod+K',
      menu: { menu: 'help', group: GROUPS.help.commands },
    }),
    cmd('help.about', {
      label: 'About statPlotter',
      menu: { menu: 'help', group: GROUPS.help.about },
    }),
  ])
  return r
}

describe('menu bar items', () => {
  it('turn separators into dividers, nest submenus and format shortcuts', () => {
    const run = vi.fn()
    const [file] = sample().menus()
    const items = menuItemsFor(file!.items, run, true)
    expect(items.map((i) => i.label)).toEqual(['Open…', 'Open recent', 'Save'])
    expect(items[0]).toMatchObject({ shortcut: '⌘O', disabled: false })
    expect(items[0]!.separator).toBeUndefined()
    expect(items[1]!.submenu?.map((i) => i.label)).toEqual(['a.psproj'])
    expect(items[2]).toMatchObject({ separator: true, shortcut: '⌘S' })
    items[1]!.submenu![0]!.onSelect!()
    expect(run).toHaveBeenCalledWith('file.recent.0')
    expect(menuItemsFor(file!.items, run, false)[2]!.shortcut).toBe('Ctrl+S')
  })

  it('carry checked state', () => {
    const view = sample()
      .menus()
      .find((m) => m.id === 'view')!
    expect(menuItemsFor(view.items, () => {}, true)[0]).toMatchObject({ checked: true })
  })
})

describe('command palette', () => {
  const e = (label: string, extra: Partial<PaletteEntry> = {}): PaletteEntry => ({
    id: label,
    label,
    section: 'Command',
    enabled: true,
    ...extra,
  })

  it('knows each command’s menu path', () => {
    const paths = menuPaths(sample().menus())
    expect(paths.get('file.save')).toBe('File')
    expect(paths.get('file.recent.0')).toBe('File › Open recent')
  })

  it('matches every word, in labels, keywords or the section', () => {
    const entries = [
      e('One-way ANOVA…', { keywords: ['kruskal'] }),
      e('Two-way ANOVA…'),
      e('t test…', { section: 'Analyze' }),
      e('Save'),
    ]
    expect(rankPalette(entries, 'anova').map((x) => x.label)).toEqual([
      'One-way ANOVA…',
      'Two-way ANOVA…',
    ])
    expect(rankPalette(entries, 'two anova').map((x) => x.label)).toEqual(['Two-way ANOVA…'])
    expect(rankPalette(entries, 'kruskal').map((x) => x.label)).toEqual(['One-way ANOVA…'])
    expect(rankPalette(entries, 'analyze').map((x) => x.label)).toEqual(['t test…'])
    expect(rankPalette(entries, 'zzz')).toEqual([])
  })

  it('ranks prefixes above substrings above scattered letters, enabled first', () => {
    const entries = [
      e('Nonlinear regression'),
      e('Simple linear regression'),
      e('Linear regression (disabled)', { enabled: false }),
      e('Row statistics'),
    ]
    expect(rankPalette(entries, 'lin').map((x) => x.label)).toEqual([
      'Simple linear regression',
      'Nonlinear regression',
      'Linear regression (disabled)',
    ])
    // Scattered letters only in labels: "nlr" → NonLinear Regression.
    expect(rankPalette(entries, 'nlr')[0]!.label).toBe('Nonlinear regression')
  })

  it('ignores accents and case, keeps the given order for an empty query', () => {
    const entries = [e('Šídák comparisons'), e('Tukey', { enabled: false }), e('Dunn')]
    expect(rankPalette(entries, 'SIDAK').map((x) => x.label)).toEqual(['Šídák comparisons'])
    expect(rankPalette(entries, '').map((x) => x.label)).toEqual([
      'Šídák comparisons',
      'Dunn',
      'Tukey',
    ])
  })
})

describe('keyboard shortcut sheet', () => {
  it('groups commands with shortcuts by menu, the rest under Other', () => {
    const r = sample()
    r.set('view', 'view', [cmd('table.fill', { label: 'Fill down', shortcut: 'Mod+D' })])
    const sections = shortcutSections(r.all())
    expect(sections.map((s) => s.title)).toEqual(['File', 'Edit', 'View', 'Help', 'Other'])
    expect(sections[0]!.items.map((c) => c.id)).toEqual(['file.open', 'file.save'])
    expect(sections.at(-1)!.items.map((c) => c.id)).toEqual(['table.fill'])
  })
})

describe('native menus', () => {
  it('converts shortcuts to accelerators', () => {
    expect(toAccelerator('Mod+Shift+S')).toBe('CmdOrCtrl+Shift+S')
    expect(toAccelerator('Mod+\\')).toBe('CmdOrCtrl+Backslash')
    expect(toAccelerator('Mod+/')).toBe('CmdOrCtrl+Slash')
    expect(toAccelerator('Mod+=')).toBe('CmdOrCtrl+Equal')
    expect(toAccelerator('Ctrl+Tab')).toBe('Ctrl+Tab')
    expect(toAccelerator('Mod+F2')).toBe('CmdOrCtrl+F2')
    // Keys without ⌘ / Ctrl stay with the webview.
    expect(toAccelerator('Delete')).toBeUndefined()
    expect(toAccelerator('F2')).toBeUndefined()
    expect(toAccelerator('Hyper+X')).toBeUndefined()
  })

  it('on macOS: app menu with About, accelerators, Window menu, system clipboard items', () => {
    const spec = nativeMenuSpec(sample().menus(), { isMac: true, appName: 'statPlotter' })
    expect(spec.map((m) => m.text)).toEqual([
      'statPlotter',
      'File',
      'Edit',
      'View',
      'Window',
      'Help',
    ])
    expect(spec[0]!.items[0]).toMatchObject({
      kind: 'command',
      id: 'help.about',
      text: 'About statPlotter',
    })
    const help = spec.find((m) => m.text === 'Help')!
    expect(help.role).toBe('help')
    // About moved out of Help, and no separator left dangling.
    expect(help.items).toEqual([
      {
        kind: 'command',
        id: 'help.palette',
        text: 'Command palette…',
        enabled: true,
        accelerator: 'CmdOrCtrl+K',
      },
    ])
    const edit = spec.find((m) => m.text === 'Edit')!
    expect(
      edit.items.map((it) => (it.kind === 'predefined' ? it.item : it.kind === 'command' && it.id)),
    ).toEqual(['edit.undo', 'Separator', 'Cut', 'Copy', 'Paste', 'SelectAll'])
    const view = spec.find((m) => m.text === 'View')!
    expect(view.items[0]).toMatchObject({ checked: true, accelerator: 'CmdOrCtrl+Backslash' })
    const file = spec.find((m) => m.text === 'File')!
    expect(file.items[1]).toMatchObject({ kind: 'submenu', text: 'Open recent' })
  })

  it('uses the system items for browser clipboard commands, and leaves out keys taken', () => {
    const r = sample()
    r.set('view', 'view', [
      cmd('edit.copy', {
        label: 'Copy cells',
        shortcut: 'Mod+C',
        nativeShortcut: true,
        menu: { menu: 'edit', group: GROUPS.edit.clipboard },
      }),
      cmd('edit.selectAll', {
        label: 'Select all cells',
        shortcut: 'Mod+A',
        menu: { menu: 'edit', group: GROUPS.edit.clipboard, order: 9 },
      }),
    ])
    const edit = nativeMenuSpec(r.menus(), { isMac: true, appName: 'P' }).find(
      (m) => m.text === 'Edit',
    )!
    expect(edit.items).toContainEqual({ kind: 'predefined', item: 'Copy', text: 'Copy cells' })
    expect(edit.items).toContainEqual(
      expect.objectContaining({ id: 'edit.selectAll', accelerator: 'CmdOrCtrl+A' }),
    )
    const system = edit.items.flatMap((it) => (it.kind === 'predefined' ? [it.item] : []))
    expect(system.filter((s) => s === 'SelectAll')).toEqual([])
    expect(system.filter((s) => s === 'Copy')).toEqual(['Copy'])
    expect(system).toContain('Cut')
  })

  it('elsewhere: the menus as they are, without accelerators or extras', () => {
    const spec = nativeMenuSpec(sample().menus(), { isMac: false, appName: 'P' })
    expect(spec.map((m) => m.text)).toEqual(['File', 'Edit', 'View', 'Help'])
    expect(nativeCommandItems(spec).every((c) => c.accelerator === undefined)).toBe(true)
    expect(nativeCommandItems(spec).map((c) => c.id)).toContain('help.about')
  })

  it('rebuilds only for structure changes', () => {
    const r = sample()
    const keyOf = () => nativeStructureKey(nativeMenuSpec(r.menus(), { isMac: true, appName: 'P' }))
    const before = keyOf()
    r.set('app', 'app', [
      ...sample()
        .all()
        .map((c) => (c.id === 'edit.undo' ? { ...c, label: 'Undo Delete', enabled: false } : c)),
    ])
    expect(keyOf()).toBe(before)
    r.set('view', 'view', [cmd('view.zoomIn', { menu: { menu: 'view', group: GROUPS.view.zoom } })])
    expect(keyOf()).not.toBe(before)
  })

  it('tells key presses the page left alone from clicks', () => {
    const gate = new NativeKeyGate()
    const opts = { isMac: true, dialogOpen: false, now: 1000 }
    // A click.
    expect(gate.decide('Mod+S', opts)).toEqual({ kind: 'run' })
    expect(gate.decide('Mod+S', { ...opts, dialogOpen: true })).toEqual({ kind: 'ignore' })
    // ⌘Z in a text field: the field's own undo.
    gate.unhandled(key('z', { meta: true }), true, 900)
    expect(gate.decide('Mod+Z', opts)).toEqual({ kind: 'textEdit', command: 'undo' })
    gate.unhandled(key('Z', { meta: true, shift: true }), true, 900)
    expect(gate.decide('Mod+Shift+Z', opts)).toEqual({ kind: 'textEdit', command: 'redo' })
    gate.unhandled(key('a', { meta: true }), true, 900)
    expect(gate.decide('Mod+A', opts)).toEqual({ kind: 'textEdit', command: 'selectAll' })
    // ⌘S left alone outside a text field (a dialog was open): not run behind the dialog.
    gate.unhandled(key('s', { meta: true }), false, 900)
    expect(gate.decide('Mod+S', opts)).toEqual({ kind: 'ignore' })
    // An old or different key press doesn't count.
    gate.unhandled(key('s', { meta: true }), false, 100)
    expect(gate.decide('Mod+S', opts)).toEqual({ kind: 'run' })
    gate.unhandled(key('o', { meta: true }), false, 900)
    expect(gate.decide('Mod+S', opts)).toEqual({ kind: 'run' })
  })
})

describe('open recent', () => {
  const same = (a: { p: string }, b: { p: string }) => a.p === b.p

  it('puts the newest first, without duplicates, at most MAX_RECENT', () => {
    let list: { p: string }[] = []
    for (let i = 0; i < 12; i++) list = addRecent(list, { p: `f${i}` }, same)
    expect(list).toHaveLength(MAX_RECENT)
    expect(list[0]!.p).toBe('f11')
    list = addRecent(list, { p: 'f5' }, same)
    expect(list.map((x) => x.p).slice(0, 3)).toEqual(['f5', 'f11', 'f10'])
    expect(list.filter((x) => x.p === 'f5')).toHaveLength(1)
  })

  it('reads stored paths defensively', () => {
    expect(parseRecentPaths(null)).toEqual([])
    expect(parseRecentPaths('not json')).toEqual([])
    expect(parseRecentPaths('{"a":1}')).toEqual([])
    expect(
      parseRecentPaths(
        JSON.stringify([{ name: 'a', path: '/x/a.psproj', extra: 1 }, { name: 2 }, null]),
      ),
    ).toEqual([{ name: 'a', path: '/x/a.psproj' }])
  })
})

describe('icons', () => {
  it('has the app’s and the views’ likely icons', () => {
    for (const name of [
      'table',
      'folder-open',
      'save',
      'undo-2',
      'redo-2',
      'flask-conical',
      'chart-column',
      'square-function',
      'layout-dashboard',
      'settings-2',
      'ruler',
      'download',
      'zoom-in',
      'zoom-out',
      'copy',
      'scissors',
      'clipboard-paste',
    ])
      expect(hasIcon(name), name).toBe(true)
    expect(hasIcon('no-such-icon')).toBe(false)
  })
})
