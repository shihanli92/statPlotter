import {
  type Command,
  type CommandRegistry,
  formatShortcut,
  isMacPlatform,
  type MenuNode,
} from '../commands/index.ts'
import type { MenuItem } from './Menu.tsx'

/**
 * A command as a menu item: its current label, enabled state, tick and shortcut. Choosing it runs
 * the command by id, so the latest registration runs.
 */
function commandItem(c: Command, run: (id: string) => void, isMac: boolean): MenuItem {
  const item: MenuItem = {
    label: c.label,
    onSelect: () => run(c.id),
    disabled: c.enabled === false,
  }
  if (c.checked !== undefined) item.checked = c.checked
  if (c.shortcut) item.shortcut = formatShortcut(c.shortcut, isMac)
  return item
}

/** Menu items made by `item` (null leaves an entry out); '-' separates the next item, if any. */
function withDividers<E>(entries: readonly E[], item: (e: E) => MenuItem | '-' | null) {
  const out: MenuItem[] = []
  let divider = false
  for (const e of entries) {
    const it = item(e)
    if (it === '-') divider = out.length > 0
    else if (it) {
      if (divider) it.separator = true
      divider = false
      out.push(it)
    }
  }
  return out
}

/** A menu item's tooltip: why it is disabled when known, else its hint. */
const tipOf = (c: Command): { title?: string } => {
  const tip = (c.enabled === false && c.disabledReason) || c.hint
  return tip ? { title: tip } : {}
}

/**
 * A menu of the menu bar as `Menu` items: separators become a divider above the next item,
 * submenus nest, shortcuts are formatted for the platform.
 */
export function menuItemsFor(
  nodes: readonly MenuNode[],
  run: (id: string) => void,
  isMac: boolean,
): MenuItem[] {
  return withDividers(nodes, (n) =>
    n.kind === 'separator'
      ? '-'
      : n.kind === 'submenu'
        ? { label: n.title, submenu: menuItemsFor(n.items, run, isMac) }
        : {
            ...commandItem(n.command, run, isMac),
            ...tipOf(n.command),
          },
  )
}

/**
 * A command in a context menu (`MenuEntry`), with what the menu changes of it: its label (or a
 * function of its current label), danger styling, the count of selected elements it acts on
 * (roadmap 45: "Paste format (3)" for several, as the multi-selection menu's own items), and
 * whether it is left out while disabled.
 */
export interface CommandRef {
  command: string
  label?: string | ((current: string) => string)
  danger?: boolean
  /** Several (2 or more): " (n)" after the label (before a closing "…"). */
  count?: number
  /** Left out of the menu while disabled (else shown greyed out). */
  ifEnabled?: boolean
}

/** A submenu of entries (▸), left out when none of them is on offer. */
export interface SubmenuEntry {
  submenu: string
  entries: readonly MenuEntry[]
}

/**
 * An entry of a context menu built from commands: a command id, `'-'` for a divider before the
 * next item, a command with its label or danger styling changed for the menu (`CommandRef`), a
 * submenu of entries, or a plain item (things that only make sense where the pointer is, e.g.
 * "Format this point…").
 */
export type MenuEntry = string | CommandRef | SubmenuEntry | MenuItem

/** A label with the count of what it acts on: "Paste format (3)", "Copy format (2)…". */
export function countedLabel(label: string, count: number | undefined): string {
  if (!count || count < 2) return label
  const dots = label.endsWith('…')
  return `${dots ? label.slice(0, -1) : label} (${count})${dots ? '…' : ''}`
}

/**
 * The context-menu items for `entries`, from the commands registered now. Commands not
 * registered (e.g. PDF export where there is none) are left out, and so are dividers with nothing
 * on one side and submenus with nothing in them.
 */
export function commandItems(
  registry: Pick<CommandRegistry, 'get' | 'run'>,
  entries: readonly MenuEntry[],
): MenuItem[] {
  return withDividers(entries, (e) => {
    if (e === '-') return '-'
    if (typeof e !== 'string' && 'entries' in e) {
      const items = commandItems(registry, e.entries)
      return items.length ? { label: e.submenu, submenu: items } : null
    }
    if (typeof e !== 'string' && !('command' in e)) return { ...e }
    const ref: CommandRef = typeof e === 'string' ? { command: e } : e
    const c = registry.get(ref.command)
    if (!c || (ref.ifEnabled && c.enabled === false)) return null
    const label = typeof ref.label === 'function' ? ref.label(c.label) : (ref.label ?? c.label)
    return {
      ...commandItem(c, (id) => registry.run(id), isMacPlatform()),
      label: countedLabel(label, ref.count),
      danger: 'danger' in ref ? ref.danger : undefined,
    }
  })
}
