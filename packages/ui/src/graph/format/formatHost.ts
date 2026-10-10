import { useRef, useState } from 'react'
import { type Command, GROUPS } from '../../commands/index.ts'
import type { FormatTarget } from './route.ts'

// Roadmap 46: what a view hosting the docked Format panel keeps (the graph view, a layout page):
// whether the panel is open (remembered, shared by the views), where it is when that isn't the
// selection's own place, a request to move the focus into it, and the modal dialog of "Open in
// window". The view says what is selected (`scope`, a key; `selected`, the place the selection
// formats); the panel shows `target`.

const OPEN_KEY = 'ps.formatPanel'

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === '1'
  } catch {
    return false
  }
}

function writeOpen(open: boolean) {
  try {
    localStorage.setItem(OPEN_KEY, open ? '1' : '0')
  } catch {}
}

/** The same place (targets are plain data). */
export const sameTarget = (a: FormatTarget, b: FormatTarget): boolean =>
  a === b || JSON.stringify(a) === JSON.stringify(b)

/** A request to move the focus into the panel (`seq` changes per request), at a section. */
export interface FormatFocus {
  seq: number
  /** The section to scroll to and focus (`data-format-section`); else the current tab. */
  section?: string
}

export interface ShowOptions {
  /** Move the focus into the panel (opened from the keyboard: Enter, ⌘1). */
  focus?: boolean
  /** Scroll to this section and focus its first control (a field search's jump). */
  section?: string
}

export interface FormatHost {
  open: boolean
  /** What the panel shows: a place chosen for this scope, else the selection's. */
  target: FormatTarget
  focus: FormatFocus | null
  /** Opens the panel at `target` (default: the selection's place). */
  show: (target?: FormatTarget | null, opts?: ShowOptions) => void
  /** Another place for the scope `scope` (default: the current one), the panel staying as it is. */
  setTarget: (target: FormatTarget, scope?: string) => void
  /** ⌘1: open (the focus moving in) or closed. */
  toggle: (opts?: ShowOptions) => void
  close: () => void
  /** The Format dialog open over the view ("Open in window"), if any. */
  window: FormatTarget | null
  openWindow: (target?: FormatTarget) => void
  closeWindow: () => void
}

/**
 * The panel's state in a view. `scope` names what is selected (the panel's target for another
 * scope is forgotten: it follows the selection); `selected` is the place the selection formats;
 * `initial` opens the panel at a place at once (a graph just made, on its function).
 */
export function useFormatHost(
  scope: string,
  selected: FormatTarget,
  initial?: FormatTarget,
): FormatHost {
  const [open, setOpenState] = useState(() => !!initial || readOpen())
  const [chosen, setChosen] = useState<{ scope: string; target: FormatTarget } | null>(() =>
    initial ? { scope, target: initial } : null,
  )
  const [focus, setFocus] = useState<FormatFocus | null>(null)
  const [window, setWindow] = useState<FormatTarget | null>(null)
  const setOpen = (v: boolean) => {
    setOpenState(v)
    writeOpen(v)
  }
  const target = chosen?.scope === scope ? chosen.target : selected
  // What is selected now, for callers made before the selection last changed (a context menu's
  // items are made at the right-click, which then selects what was clicked).
  const now = useRef({ scope, selected, target })
  now.current = { scope, selected, target }
  // A request stays until the next opening: one by pointer drops it (a panel opened again must
  // not take the focus on an old request).
  const request = (opts: ShowOptions = {}) =>
    setFocus((f) =>
      opts.focus || opts.section
        ? { seq: (f?.seq ?? 0) + 1, ...(opts.section ? { section: opts.section } : {}) }
        : null,
    )
  return {
    open,
    target,
    focus,
    show: (t, opts) => {
      const { scope: s, selected: sel } = now.current
      setOpen(true)
      setChosen(t && !sameTarget(t, sel) ? { scope: s, target: t } : null)
      request(opts)
    },
    setTarget: (t, s = now.current.scope) => setChosen({ scope: s, target: t }),
    toggle: (opts) => {
      setOpen(!open)
      if (!open) request(opts)
    },
    close: () => setOpen(false),
    window,
    openWindow: (t = now.current.target) => setWindow(t),
    closeWindow: () => setWindow(null),
  }
}

/**
 * Format › Format panel (⌘1, a toggle; also in the text fields, so it closes from inside) and
 * Format › Format in window… (the dialog at the panel's place). `canFormat`: something can be
 * formatted (a page needs a graph selected).
 */
export function formatPanelCommands(
  host: FormatHost,
  canFormat: boolean,
  /** The focus back on the canvas when the panel closes from within. */
  onClosed: () => void,
): Command[] {
  return [
    {
      id: 'format.panel',
      label: 'Format panel',
      menu: { menu: 'format', group: GROUPS.format.graph, order: 1 },
      shortcut: 'Mod+1',
      inTextFields: true,
      checked: host.open,
      keywords: ['inspector', 'sidebar', 'format cells', 'properties'],
      hint: 'Show or hide the Format panel beside the graph: it formats what is selected',
      run: () => {
        const inside = !!document.activeElement?.closest('.format-panel')
        host.toggle({ focus: true })
        if (host.open && inside) onClosed()
      },
    },
    {
      id: 'format.window',
      label: 'Format in window…',
      menu: { menu: 'format', group: GROUPS.format.graph, order: 22 },
      enabled: canFormat,
      disabledReason: 'Select a graph on the page',
      keywords: ['format dialog', 'open in window', 'preview'],
      hint: 'The Format options in a dialog with a preview: OK applies them as one undo step',
      run: () => host.openWindow(),
    },
  ]
}

/**
 * Whether a key pressed in the panel stays there (the view's keys never see it): every key
 * without ⌘ / Ctrl (arrows would nudge the selection, Delete remove it, Enter format it), and
 * the ⌘ keys acting on the canvas' selection (⌘A selects every element; ⌘B / ⌘I, ⌘⇧> / ⌘⇧<
 * and ⌥⌘C / ⌥⌘V format it). The rest (⌘Z, ⌘S, ⌘1, ⌘, ⇧⌘E…) reach the app.
 */
export function panelKeyStays(e: {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}): boolean {
  if (!e.metaKey && !e.ctrlKey) return true
  const k = e.key.toLowerCase()
  if (e.altKey && (k === 'c' || k === 'v' || k === 'ç' || k === '√')) return true
  // ⌘⇧> / ⌘⇧< (the key may read '.' / ',' with Shift); ⌘, (Preferences) reaches the app (U7).
  if (k === '.' || k === ',') return e.shiftKey
  return ['a', 'b', 'i', '>', '<'].includes(k)
}
