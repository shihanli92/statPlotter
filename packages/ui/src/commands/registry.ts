import { MENUS, type MenuId, OPTIONAL_MENUS } from './menus.ts'
import {
  isTextTarget,
  type KeyInput,
  matchesShortcut,
  parseShortcut,
  type Shortcut,
} from './shortcut.ts'

/**
 * One thing the user can do, wherever it is offered: menu bar, icon toolbar, keyboard shortcut,
 * command palette, context menus. Commands are plain values re-registered when their state
 * changes (labels, enabled, checked), not callbacks polled by the menus. Menus, toolbars and the
 * palette call `registry.run(id)` rather than a `run` they kept, so the latest one runs.
 */
export interface Command {
  /** Stable, dotted: 'file.save', 'edit.undo', 'graph.formatAxes', 'nav.goto.<nodeId>'. */
  id: string
  /** Menu and palette text, current state included ("Undo Rename"). Ends in "…" if it asks more. */
  label: string
  /** Where it sits in the menu bar; absent = not in the menus (palette / toolbar / keys only). */
  menu?: MenuPlacement
  /** Shortcut text ('Mod+Shift+S'); see `shortcut.ts`. */
  shortcut?: string
  /**
   * The shortcut is shown but the browser's own handling does the work (Cut / Copy / Paste, whose
   * clipboard events the views listen to); the dispatcher leaves the key press alone.
   */
  nativeShortcut?: boolean
  /** Fire the shortcut while focus is in a text field (Save, Open); default no. */
  inTextFields?: boolean
  /** Icon name (lucide, kebab case, e.g. 'save', 'undo-2'); needed for the toolbar. */
  icon?: string
  /** On the icon toolbar in this group (see `TOOLBAR_GROUPS`). */
  toolbar?: ToolbarPlacement
  /** Greyed out; default enabled. */
  enabled?: boolean
  /**
   * Why it is greyed out, when that is known ("Open a data table first"): the toolbar's tooltip
   * shows it on a disabled button (roadmap 43).
   */
  disabledReason?: string
  /** A toggle's state, shown as a tick; absent for plain commands. */
  checked?: boolean
  /** Left out of the palette (e.g. items that only make sense in a submenu). */
  hideInPalette?: boolean
  /** Extra words the palette matches ("anova", "export pdf"). */
  keywords?: readonly string[]
  /** Longer text for tooltips and the palette. */
  hint?: string
  /** Its return value is ignored (a promise is not awaited). */
  run: () => unknown
}

/** Where a command sits on the icon toolbar (roadmap 43: labelled, with split buttons). */
export interface ToolbarPlacement {
  /** A group of `TOOLBAR_GROUPS`; groups are separated by dividers. */
  group: number
  /** Order within the group (then registration order). */
  order?: number
  /** The short label under the icon ("New table"); default the command's label, without "…". */
  label?: string
  /**
   * A split button: its ▾ opens a menu of these commands (by id, '-' for a divider; ids not
   * registered are left out), named `label` ("More export formats").
   */
  split?: { label: string; items: readonly string[] }
}

export interface MenuPlacement {
  menu: MenuId
  /** A group number from `GROUPS[menu]`; groups are separated by dividers. */
  group: number
  /** Order within the group (then registration order). */
  order?: number
  /** Nest under a submenu of this title within the group ('Export', 'Open recent', 'Examples'). */
  submenu?: string
}

/**
 * Who registered a set of commands. Shortcuts resolve to the highest scope first, so a view's
 * ⌘A (select all cells) wins over an app-wide one while that view is open.
 */
export type CommandScope = 'app' | 'view' | 'panel'

const SCOPE_RANK: Record<CommandScope, number> = { app: 0, view: 1, panel: 2 }

interface Entry {
  owner: string
  scope: CommandScope
  seq: number
  commands: readonly Command[]
}

export type MenuNode =
  | { kind: 'command'; command: Command }
  | { kind: 'submenu'; title: string; items: MenuNode[] }
  | { kind: 'separator' }

export interface MenuModel {
  id: MenuId
  title: string
  items: MenuNode[]
}

/**
 * The commands on offer right now: each owner (the app shell, the open view, a panel) replaces
 * its whole set with `set` and removes it with `remove`. Subscribers hear of every change.
 */
export class CommandRegistry {
  private entries = new Map<string, Entry>()
  private listeners = new Set<() => void>()
  private seq = 0
  private shortcuts = new Map<string, Shortcut>()
  /** Changes on every update; for useSyncExternalStore snapshots and memo keys. */
  version = 0

  set(owner: string, scope: CommandScope, commands: readonly Command[]): void {
    const prev = this.entries.get(owner)
    for (const c of commands) if (c.shortcut) this.shortcutOf(c.shortcut)
    // Always keep the latest run functions (they close over current state), but only tell
    // subscribers when something they show changed.
    const quiet = prev?.scope === scope && sameCommands(prev.commands, commands)
    this.entries.set(owner, { owner, scope, seq: prev?.seq ?? this.seq++, commands })
    if (!quiet) this.changed()
  }

  remove(owner: string): void {
    if (this.entries.delete(owner)) this.changed()
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /**
   * Every command, highest scope first, then latest registered first. A command id registered
   * twice keeps the first in this order (a view can override an app command by reusing its id).
   */
  all(): Command[] {
    const seen = new Set<string>()
    const out: Command[] = []
    for (const e of this.ordered()) {
      for (const c of e.commands) {
        if (seen.has(c.id)) continue
        seen.add(c.id)
        out.push(c)
      }
    }
    return out
  }

  get(id: string): Command | undefined {
    return this.all().find((c) => c.id === id)
  }

  /** Runs a command by id if it exists and is enabled; returns whether it ran. */
  run(id: string): boolean {
    const c = this.get(id)
    if (!c || c.enabled === false) return false
    void c.run()
    return true
  }

  /**
   * The command a key press triggers, if any: enabled, not native, allowed in text fields when
   * `inText`. Highest scope wins.
   */
  match(e: KeyInput, isMac: boolean, inText: boolean): Command | undefined {
    for (const c of this.all()) {
      if (!c.shortcut || c.nativeShortcut || c.enabled === false) continue
      if (inText && !c.inTextFields) continue
      if (matchesShortcut(this.shortcutOf(c.shortcut), e, isMac)) return c
    }
    return undefined
  }

  /**
   * The menu bar: every menu of `MENUS` in order (optional ones only when they have commands),
   * groups sorted and separated, submenus collected where their first item falls.
   */
  menus(): MenuModel[] {
    const cmds = this.all().filter((c) => c.menu)
    return MENUS.flatMap(({ id, title }) => {
      const mine = cmds
        .filter((c) => c.menu!.menu === id)
        .sort((a, b) => byPlacement(a.menu!, b.menu!))
      if (!mine.length && OPTIONAL_MENUS.has(id)) return []
      const items: MenuNode[] = []
      let group: number | null = null
      const subs = new Map<string, MenuNode & { kind: 'submenu' }>()
      for (const c of mine) {
        const m = c.menu!
        if (group !== null && m.group !== group) {
          items.push({ kind: 'separator' })
          subs.clear()
        }
        group = m.group
        if (m.submenu) {
          let sub = subs.get(m.submenu)
          if (!sub) {
            sub = { kind: 'submenu', title: m.submenu, items: [] }
            subs.set(m.submenu, sub)
            items.push(sub)
          }
          sub.items.push({ kind: 'command', command: c })
        } else items.push({ kind: 'command', command: c })
      }
      return [{ id, title, items }]
    })
  }

  /** Toolbar buttons in order, grouped (a divider between groups). */
  toolbar(): Command[][] {
    const cmds = this.all()
      .filter((c) => c.toolbar)
      .sort((a, b) => byPlacement(a.toolbar!, b.toolbar!))
    const groups: Command[][] = []
    for (const c of cmds) {
      const last = groups.at(-1)
      if (last && last[0]!.toolbar!.group === c.toolbar!.group) last.push(c)
      else groups.push([c])
    }
    return groups
  }

  private ordered(): Entry[] {
    return [...this.entries.values()].sort(
      (a, b) => SCOPE_RANK[b.scope] - SCOPE_RANK[a.scope] || b.seq - a.seq,
    )
  }

  private shortcutOf(text: string): Shortcut {
    let s = this.shortcuts.get(text)
    if (!s) {
      s = parseShortcut(text)
      this.shortcuts.set(text, s)
    }
    return s
  }

  private changed() {
    this.version++
    for (const fn of [...this.listeners]) fn()
  }
}

/**
 * Menu or toolbar order: by group, then order within it; the sort is stable, so ties keep the
 * order `all()` gives (the latest registration first).
 */
const byPlacement = (a: { group: number; order?: number }, b: { group: number; order?: number }) =>
  a.group - b.group || (a.order ?? 0) - (b.order ?? 0)

/** Same commands in the same state (run functions may differ: they are re-created per render). */
function sameCommands(a: readonly Command[], b: readonly Command[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  return a.every((c, i) => {
    const d = b[i]!
    return (
      c.id === d.id &&
      c.label === d.label &&
      c.enabled === d.enabled &&
      c.checked === d.checked &&
      c.shortcut === d.shortcut &&
      c.icon === d.icon &&
      c.hint === d.hint &&
      c.disabledReason === d.disabledReason &&
      c.menu?.menu === d.menu?.menu &&
      c.menu?.group === d.menu?.group &&
      c.menu?.order === d.menu?.order &&
      c.menu?.submenu === d.menu?.submenu &&
      c.toolbar?.group === d.toolbar?.group &&
      c.toolbar?.order === d.toolbar?.order &&
      c.toolbar?.label === d.toolbar?.label &&
      c.toolbar?.split?.label === d.toolbar?.split?.label &&
      sameIds(c.toolbar?.split?.items, d.toolbar?.split?.items)
    )
  })
}

const sameIds = (a: readonly string[] | undefined, b: readonly string[] | undefined) =>
  a === b || (!!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]))

/**
 * The shell's one keydown handler: runs the matching command and returns whether it did. Leaves
 * key presses alone while a modal dialog is open (dialogs handle their own keys) or after
 * another handler called preventDefault.
 */
export function dispatchKey(
  registry: CommandRegistry,
  e: KeyInput & { target: EventTarget | null; defaultPrevented: boolean; preventDefault(): void },
  isMac: boolean,
): boolean {
  if (e.defaultPrevented) return false
  if (typeof document !== 'undefined' && document.querySelector('dialog[open]')) return false
  const c = registry.match(e, isMac, isTextTarget(e.target))
  if (!c) return false
  e.preventDefault()
  registry.run(c.id)
  return true
}
