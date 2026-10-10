// Keyboard shortcuts written as text: modifiers and a key joined by '+', e.g. 'Mod+Shift+S',
// 'Mod+Z', 'F2', 'Delete', 'Alt+ArrowUp'. `Mod` is ⌘ on macOS and Ctrl elsewhere; `Ctrl` is the
// Control key on every platform. Keys are compared without case for single characters and by
// their KeyboardEvent.key name otherwise.

export interface Shortcut {
  mod: boolean
  ctrl: boolean
  shift: boolean
  alt: boolean
  /** Lower case for single characters ('s', '=', '0'), else the KeyboardEvent.key name. */
  key: string
}

/** The parts of a KeyboardEvent a shortcut is matched against. */
export interface KeyInput {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  /** The physical key ('KeyC', 'Period'), for shortcuts whose character the modifiers change. */
  code?: string
}

const MODIFIERS = new Set(['mod', 'ctrl', 'shift', 'alt'])

const normKey = (k: string) => (k.length === 1 ? k.toLowerCase() : k)

/** Parses 'Mod+Shift+S'. Throws on an empty key or an unknown modifier. */
export function parseShortcut(text: string): Shortcut {
  // 'Mod++' is the plus key.
  const plus = text === '+' || text.endsWith('++')
  const parts = (plus ? text.slice(0, -1) : text).split('+')
  const key = plus ? '+' : (parts.pop() ?? '')
  if (plus) parts.pop()
  const s: Shortcut = { mod: false, ctrl: false, shift: false, alt: false, key: normKey(key) }
  if (!s.key) throw new Error(`Shortcut “${text}” has no key`)
  for (const p of parts) {
    const m = p.toLowerCase()
    if (!MODIFIERS.has(m)) throw new Error(`Shortcut “${text}”: unknown modifier “${p}”`)
    s[m as 'mod' | 'ctrl' | 'shift' | 'alt'] = true
  }
  return s
}

/** Whether a key press is this shortcut. With Shift, "?" or "+" style keys match either case. */
export function matchesShortcut(s: Shortcut, e: KeyInput, isMac: boolean): boolean {
  const wantMeta = isMac && s.mod
  const wantCtrl = s.ctrl || (!isMac && s.mod)
  if (e.metaKey !== wantMeta || e.ctrlKey !== wantCtrl) return false
  if (e.altKey !== s.alt || e.shiftKey !== s.shift) return false
  if (normKey(e.key) === s.key) return true
  // Only where the character typed may differ from the key's (other layouts keep their keys).
  const byPosition = s.alt || s.key === '>' || s.key === '<'
  return byPosition && !!e.code && codeKey(e.code, e.shiftKey) === s.key
}

/**
 * The character a physical key types on a US layout: Option changes the character on macOS (⌥⌘C
 * reports 'ç'), so Alt shortcuts and ⌘⇧> / ⌘⇧< (roadmap 45) also match by key position.
 */
function codeKey(code: string, shift: boolean): string | undefined {
  const m = /^Key([A-Z])$/.exec(code) ?? /^Digit([0-9])$/.exec(code)
  if (m) return m[1]!.toLowerCase()
  if (code === 'Period') return shift ? '>' : '.'
  if (code === 'Comma') return shift ? '<' : ','
  return undefined
}

const MAC_KEYS: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Enter: '↩',
  Escape: '⎋',
  Delete: '⌦',
  Backspace: '⌫',
  Tab: '⇥',
  ' ': 'Space',
}

const OTHER_KEYS: Record<string, string> = {
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Escape: 'Esc',
  Delete: 'Del',
  ' ': 'Space',
}

/** How a shortcut is shown in menus and tooltips: '⇧⌘S' on macOS, 'Ctrl+Shift+S' elsewhere. */
export function formatShortcut(s: Shortcut | string, isMac: boolean): string {
  const sc = typeof s === 'string' ? parseShortcut(s) : s
  const key = sc.key.length === 1 ? sc.key.toUpperCase() : sc.key
  if (isMac) {
    return (
      (sc.ctrl ? '⌃' : '') +
      (sc.alt ? '⌥' : '') +
      (sc.shift ? '⇧' : '') +
      (sc.mod ? '⌘' : '') +
      (MAC_KEYS[key] ?? key)
    )
  }
  const mods = [sc.ctrl || sc.mod ? 'Ctrl' : '', sc.alt ? 'Alt' : '', sc.shift ? 'Shift' : '']
  return [...mods.filter(Boolean), OTHER_KEYS[key] ?? key].join('+')
}

/** Whether the app runs on macOS (⌘ shortcuts). */
export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
  const p = nav.userAgentData?.platform ?? nav.platform ?? ''
  return /mac|iphone|ipad/i.test(p)
}

/** Focus is in a text field, where plain keys and most shortcuts belong to the field. */
export function isTextTarget(el: EventTarget | null): boolean {
  return (
    typeof HTMLElement !== 'undefined' &&
    el instanceof HTMLElement &&
    (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
  )
}
