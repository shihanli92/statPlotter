import type { MenuModel, MenuNode } from './registry.ts'
import { type KeyInput, matchesShortcut, parseShortcut, type Shortcut } from './shortcut.ts'

// The desktop app's native menu bar, as plain data built from the registry's menus; the platform
// turns it into Tauri menu items (apps/web/src/nativeMenu.ts). Shortcuts stay resolved by the
// webview's one keydown dispatcher (decision 111): on macOS the items carry accelerators so the
// menus show them, and WKWebView offers every key press to the page before the menu, so a key
// the dispatcher handled (preventDefault) never reaches the menu; see `nativeActivation` for
// the presses it left alone. Elsewhere accelerators would pre-empt the webview, so none are set.

/** Tauri's predefined items used here (their behaviour is the operating system's). */
export type NativePredefined =
  | 'Separator'
  | 'Cut'
  | 'Copy'
  | 'Paste'
  | 'SelectAll'
  | 'Services'
  | 'Hide'
  | 'HideOthers'
  | 'ShowAll'
  | 'Quit'
  | 'Minimize'
  | 'Maximize'
  | 'Fullscreen'
  | 'About'

export type NativeItem =
  | {
      kind: 'command'
      id: string
      text: string
      enabled: boolean
      /** Present (true / false) for toggles, drawn as check items. */
      checked?: boolean
      accelerator?: string
    }
  | { kind: 'predefined'; item: NativePredefined; text?: string }
  | { kind: 'submenu'; text: string; items: NativeItem[] }

export interface NativeMenu {
  text: string
  items: NativeItem[]
  /** macOS: the Window and Help menus get the system's extras (window list, help search). */
  role?: 'window' | 'help'
}

const KEY_NAMES: Record<string, string> = {
  '\\': 'Backslash',
  '/': 'Slash',
  '=': 'Equal',
  '-': 'Minus',
  ',': 'Comma',
  '.': 'Period',
  ';': 'Semicolon',
  "'": 'Quote',
  '`': 'Backquote',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  ' ': 'Space',
}

const NAMED = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Backspace',
  'Delete',
  'Enter',
  'Escape',
  'Tab',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Insert',
])

/**
 * A shortcut as a Tauri accelerator ('Mod+Shift+S' → 'CmdOrCtrl+Shift+S'), or undefined when
 * it has none: keys without ⌘ / Ctrl (Delete, F2, arrows) stay with the webview, where text
 * fields need them, and keys Tauri can't name are left out.
 */
export function toAccelerator(text: string): string | undefined {
  let s: Shortcut
  try {
    s = parseShortcut(text)
  } catch {
    return undefined
  }
  if (!s.mod && !s.ctrl) return undefined
  const k = s.key
  let key: string | undefined
  if (/^[a-z0-9]$/.test(k)) key = k.toUpperCase()
  else if (KEY_NAMES[k]) key = KEY_NAMES[k]
  else if (/^F([1-9]|1\d|2[0-4])$/.test(k) || NAMED.has(k)) key = k
  if (!key) return undefined
  const mods = [s.mod ? 'CmdOrCtrl' : '', s.ctrl ? 'Ctrl' : '', s.alt ? 'Alt' : '']
  return [...mods.filter(Boolean), s.shift ? 'Shift' : '', key].filter(Boolean).join('+')
}

/** The clipboard keys whose menu items must be the system's own on macOS (text fields). */
const CLIPBOARD: [string, NativePredefined][] = [
  ['CmdOrCtrl+X', 'Cut'],
  ['CmdOrCtrl+C', 'Copy'],
  ['CmdOrCtrl+V', 'Paste'],
  ['CmdOrCtrl+A', 'SelectAll'],
]

/**
 * The native menu bar for these menus. On macOS: the application menu first (About, Services,
 * Hide, Quit), accelerators on the items, a Window menu, and Cut / Copy / Paste / Select All as
 * the system's items unless a command already takes their keys (without them the webview's text
 * fields lose the clipboard keys). Commands whose shortcut the browser handles (`nativeShortcut`:
 * Cut / Copy / Paste) become those system items, which send the webview the same clipboard
 * events. Elsewhere: the menus as they are, without accelerators.
 */
export function nativeMenuSpec(
  menus: readonly MenuModel[],
  opts: { isMac: boolean; appName: string },
): NativeMenu[] {
  const { isMac } = opts
  const aboutId = 'help.about'
  let about: (MenuNode & { kind: 'command' }) | undefined
  // Roadmap 37: Preferences… is the application menu's Settings… on macOS.
  const prefsId = 'app.preferences'
  let prefs: (MenuNode & { kind: 'command' }) | undefined
  const taken = new Set<string>()

  const convert = (nodes: readonly MenuNode[]): NativeItem[] => {
    const out: NativeItem[] = []
    for (const n of nodes) {
      if (n.kind === 'separator') out.push({ kind: 'predefined', item: 'Separator' })
      else if (n.kind === 'submenu')
        out.push({ kind: 'submenu', text: n.title, items: convert(n.items) })
      else {
        const c = n.command
        // On macOS About goes to the application menu.
        if (isMac && c.id === aboutId) {
          about = n
          continue
        }
        if (isMac && c.id === prefsId) {
          prefs = n
          continue
        }
        const acc = isMac && c.shortcut ? toAccelerator(c.shortcut) : undefined
        const system = acc && CLIPBOARD.find(([a]) => a === acc)?.[1]
        if (system && c.nativeShortcut) {
          taken.add(acc)
          out.push({ kind: 'predefined', item: system, text: c.label })
          continue
        }
        if (acc && !c.nativeShortcut) taken.add(acc)
        out.push({
          kind: 'command',
          id: c.id,
          text: c.label,
          enabled: c.enabled !== false,
          ...(c.checked !== undefined ? { checked: c.checked } : {}),
          ...(acc && !c.nativeShortcut ? { accelerator: acc } : {}),
        })
      }
    }
    return tidy(out)
  }

  const bar: NativeMenu[] = menus.map((m) => ({
    text: m.title,
    items: convert(m.items),
    ...(m.id === 'help' ? { role: 'help' as const } : {}),
  }))
  if (!isMac) return bar.filter((m) => m.items.length)

  const edit = bar.find((_, i) => menus[i]!.id === 'edit')
  const missing = CLIPBOARD.filter(([a]) => !taken.has(a)).map(([, item]) => item)
  if (edit && missing.length) {
    // After Undo / Redo, as in every Mac app.
    const at = edit.items.findIndex((it) => it.kind === 'predefined' && it.item === 'Separator')
    const block: NativeItem[] = missing.map((item) => ({ kind: 'predefined', item }))
    const sep: NativeItem = { kind: 'predefined', item: 'Separator' }
    if (at < 0) edit.items.push(...(edit.items.length ? [sep] : []), ...block)
    else edit.items.splice(at, 0, sep, ...block)
  }

  const sep: NativeItem = { kind: 'predefined', item: 'Separator' }
  const aboutItem: NativeItem = about
    ? {
        kind: 'command',
        id: about.command.id,
        text: `About ${opts.appName}`,
        enabled: about.command.enabled !== false,
      }
    : { kind: 'predefined', item: 'About' }
  const prefsAcc = prefs?.command.shortcut ? toAccelerator(prefs.command.shortcut) : undefined
  const prefsItems: NativeItem[] = prefs
    ? [
        {
          kind: 'command',
          id: prefs.command.id,
          text: 'Settings…',
          enabled: prefs.command.enabled !== false,
          ...(prefsAcc ? { accelerator: prefsAcc } : {}),
        },
        sep,
      ]
    : []
  const app: NativeMenu = {
    text: opts.appName,
    items: [
      aboutItem,
      sep,
      ...prefsItems,
      { kind: 'predefined', item: 'Services' },
      sep,
      { kind: 'predefined', item: 'Hide' },
      { kind: 'predefined', item: 'HideOthers' },
      { kind: 'predefined', item: 'ShowAll' },
      sep,
      { kind: 'predefined', item: 'Quit' },
    ],
  }
  const window: NativeMenu = {
    text: 'Window',
    role: 'window',
    items: [
      { kind: 'predefined', item: 'Minimize' },
      { kind: 'predefined', item: 'Maximize' },
      sep,
      { kind: 'predefined', item: 'Fullscreen' },
    ],
  }
  const out = bar.map((m) => ({ ...m, items: tidy(m.items) })).filter((m) => m.items.length)
  const help = out.findIndex((m) => m.role === 'help')
  out.splice(help < 0 ? out.length : help, 0, window)
  return [app, ...out]
}

/** No separators at the ends or twice in a row (e.g. after About moved out of Help). */
function tidy(items: NativeItem[]): NativeItem[] {
  const isSep = (it: NativeItem | undefined) => it?.kind === 'predefined' && it.item === 'Separator'
  const out: NativeItem[] = []
  for (const it of items) if (!(isSep(it) && (!out.length || isSep(out.at(-1))))) out.push(it)
  while (isSep(out.at(-1))) out.pop()
  return out
}

/**
 * What decides whether the native menu must be rebuilt rather than updated in place: everything
 * but the command items' text, enabled and checked state (which items can change themselves).
 */
export function nativeStructureKey(menus: readonly NativeMenu[]): string {
  const item = (it: NativeItem): unknown =>
    it.kind === 'command'
      ? ['c', it.id, it.checked !== undefined, it.accelerator ?? '']
      : it.kind === 'predefined'
        ? ['p', it.item, it.text ?? '']
        : ['s', it.text, it.items.map(item)]
  return JSON.stringify(menus.map((m) => [m.text, m.role ?? '', m.items.map(item)]))
}

/** Every command item of a native menu bar (for updating text / enabled / checked in place). */
export function nativeCommandItems(
  menus: readonly NativeMenu[],
): (NativeItem & { kind: 'command' })[] {
  const out: (NativeItem & { kind: 'command' })[] = []
  const walk = (items: readonly NativeItem[]) => {
    for (const it of items) {
      if (it.kind === 'command') out.push(it)
      else if (it.kind === 'submenu') walk(it.items)
    }
  }
  for (const m of menus) walk(m.items)
  return out
}

/** What to do when a native menu item is activated. */
export type NativeAction =
  | { kind: 'run' }
  | { kind: 'ignore' }
  /** The key press was a text field's own: do its editing command there instead. */
  | { kind: 'textEdit'; command: 'undo' | 'redo' | 'selectAll' }

/** How long after an unhandled key press a menu activation counts as caused by it. */
const KEY_WINDOW_MS = 500

/**
 * Tells a native menu activation caused by a key press the page left alone (⌘Z in a text field,
 * any shortcut while a dialog is open or its command disabled) from a click on the item. On
 * macOS such key presses reach the menu after the page (see the file comment); running the
 * command then would undo the document instead of the text field, or act behind a dialog.
 */
export class NativeKeyGate {
  private last: { at: number; key: KeyInput; inText: boolean } | null = null

  /** The dispatcher left this key press with ⌘ / Ctrl alone. */
  unhandled(key: KeyInput, inText: boolean, now: number): void {
    this.last = { at: now, key, inText }
  }

  decide(
    shortcut: string | undefined,
    opts: { isMac: boolean; dialogOpen: boolean; now: number },
  ): NativeAction {
    const last = this.last
    this.last = null
    let s: Shortcut | undefined
    try {
      s = shortcut ? parseShortcut(shortcut) : undefined
    } catch {
      s = undefined
    }
    if (
      last &&
      s &&
      opts.now - last.at < KEY_WINDOW_MS &&
      matchesShortcut(s, last.key, opts.isMac)
    ) {
      if (!last.inText || s.alt || s.ctrl) return { kind: 'ignore' }
      if (s.key === 'z') return { kind: 'textEdit', command: s.shift ? 'redo' : 'undo' }
      if (s.key === 'y' && !s.shift) return { kind: 'textEdit', command: 'redo' }
      if (s.key === 'a' && !s.shift) return { kind: 'textEdit', command: 'selectAll' }
      return { kind: 'ignore' }
    }
    return opts.dialogOpen ? { kind: 'ignore' } : { kind: 'run' }
  }
}
