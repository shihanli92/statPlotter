import { formatShortcut, type KeyInput, matchesShortcut, parseShortcut } from './shortcut.ts'

// Keys a view handles itself, outside the command registry (audit 2, U20): on a row of the
// navigator, on the graph's canvas, on a layout page, in the Analyze dialog (audit 4, A18). One table, read by the Keyboard shortcuts
// sheet (its "In the navigator / On the canvas / On a page" sections) and by the handlers, which
// test a key press with `isViewKey`. Only the navigator's Select all (roadmap 47) uses Mod (⌘ on
// macOS, Ctrl elsewhere): its handler passes the platform.

export interface ViewKey {
  /** The keys (shortcut text, `shortcut.ts`), any of which does it. */
  keys: readonly string[]
  /** What it does, for the sheet. */
  label: string
}

const key = (label: string, ...keys: string[]): ViewKey => ({ keys, label })

/** On a sheet's row in the navigator. */
export const NAVIGATOR_KEYS = {
  rows: key('Previous or next row', 'ArrowUp', 'ArrowDown'),
  // Roadmap 47: several sheets selected (also ⌘-click or Ctrl-click, and Shift-click).
  extend: key('Select the row above or below too', 'Shift+ArrowUp', 'Shift+ArrowDown'),
  selectAll: key('Select every sheet shown', 'Mod+A'),
  clear: key('Select only the open sheet', 'Escape'),
  fold: key('Fold or unfold (a family, a folder, a set)', 'ArrowLeft', 'ArrowRight'),
  open: key('Open the sheet', 'Enter'),
  moveUp: key('Move the sheet up', 'Alt+ArrowUp'),
  moveDown: key('Move the sheet down', 'Alt+ArrowDown'),
  rename: key('Rename the sheet or folder', 'F2'),
  remove: key('Delete the sheet, or the selected sheets (undoable)', 'Delete', 'Backspace'),
} as const

/** On a graph's canvas (with the focus on it). */
export const CANVAS_KEYS = {
  nextElement: key('Next part of the graph (title, axes, data sets, legend…)', 'Tab'),
  previousElement: key('Previous part of the graph', 'Shift+Tab'),
  format: key('Into a data set’s points or an axis’ tick labels; else format the part', 'Enter'),
  out: key('Back out (a point to its data set, tick labels to their axis)', 'Shift+Enter'),
  clear: key('Clear the selection (one level at a time)', 'Escape'),
  next: key(
    'Next point, its values read out; with the legend or an entry selected, the next entry',
    ']',
  ),
  previous: key('Previous point (or legend entry)', '['),
  // Audit 3 (A11): what Delete does since roadmaps 47 and 47b.
  remove: key(
    'Delete the selection: annotations and layers deleted; data sets, points and legend entries hidden',
    'Delete',
    'Backspace',
  ),
  // Roadmap 47b: legend entries (the legend clicked, then an entry).
  entryEarlier: key('Move the selected legend entries earlier', 'Alt+ArrowUp', 'Alt+ArrowLeft'),
  entryLater: key('Move the selected legend entries later', 'Alt+ArrowDown', 'Alt+ArrowRight'),
  // Audit 3 (A3): the canvas' own keys, as a page's (they were the app's, so arrows anywhere
  // else moved the selected element).
  nudge: key('Nudge the selection by 1 pt', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'),
  nudgeMore: key(
    'Nudge the selection by 10 pt',
    'Shift+ArrowLeft',
    'Shift+ArrowRight',
    'Shift+ArrowUp',
    'Shift+ArrowDown',
  ),
  // Audit 4 (A18): the canvas scrolls (its keys are the browser's) when nothing is selected.
  pan: key(
    'With nothing selected, move around a zoomed graph',
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'PageUp',
    'PageDown',
    'Home',
    'End',
  ),
} as const

/** On a layout page (with the focus on it). */
export const PAGE_KEYS = {
  format: key('Format the selected graph', 'Enter'),
  remove: key('Remove the selected items from the page', 'Delete', 'Backspace'),
  nudge: key('Nudge the selection by 1 pt', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'),
  nudgeMore: key(
    'Nudge the selection by 10 pt',
    'Shift+ArrowLeft',
    'Shift+ArrowRight',
    'Shift+ArrowUp',
    'Shift+ArrowDown',
  ),
  dropTool: key('Put the drawing tool down', 'Escape'),
  // Roadmap 47b: legend entries of a graph worked in on the page.
  entryEarlier: key('Move the selected legend entries earlier', 'Alt+ArrowUp', 'Alt+ArrowLeft'),
  entryLater: key('Move the selected legend entries later', 'Alt+ArrowDown', 'Alt+ArrowRight'),
  // Audit 4 (A18): the canvas scrolls (its keys are the browser's) when nothing is selected.
  pan: key(
    'With nothing selected, move around a zoomed page',
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'PageUp',
    'PageDown',
    'Home',
    'End',
  ),
} as const

/**
 * Audit 4 (A18): in the Analyze dialog — its own keys (`AnalyzeDialog`'s, which take ⌘ or Ctrl
 * on every platform) and those of the group chips (`GroupChips`) and the search.
 */
export const ANALYZE_KEYS = {
  tabs: key('Guide me or All analyses', 'Mod+1', 'Mod+2'),
  search: key('Search the analyses (All analyses)', 'Mod+K'),
  run: key('Analyze (Apply when editing)', 'Mod+Enter'),
  back: key('Clear the search, then close the list opened over the options', 'Escape'),
  include: key('On a group’s chip: include it or leave it out', ' '),
  reorder: key('On a group’s chip: move it earlier or later', 'Alt+ArrowLeft', 'Alt+ArrowRight'),
  control: key('On a group’s chip: make it the control', 'C'),
} as const

/** The sheet's sections of these keys, after the commands'. */
export const VIEW_KEY_SECTIONS: readonly { title: string; items: readonly ViewKey[] }[] = [
  { title: 'In the navigator', items: Object.values(NAVIGATOR_KEYS) },
  { title: 'On the canvas', items: Object.values(CANVAS_KEYS) },
  { title: 'On a page', items: Object.values(PAGE_KEYS) },
  { title: 'In the Analyze dialog', items: Object.values(ANALYZE_KEYS) },
]

/**
 * Roadmap 50: what the mouse and trackpad do on the graph's canvas and on pages, for the sheet's
 * "With the mouse or trackpad" and the zoom box's tooltip. Gestures are not keys: each is written
 * for macOS and for the other systems.
 */
export interface ViewGesture {
  label: string
  mac: readonly string[]
  other: readonly string[]
}

const gesture = (label: string, mac: string[], other = mac): ViewGesture => ({
  label,
  mac,
  other,
})

export const POINTER_GESTURES = {
  wheelZoom: gesture(
    'Zoom in or out about the pointer',
    ['⌥ + scroll', '⌃ + scroll'],
    ['Alt + scroll', 'Ctrl + scroll'],
  ),
  pinch: gesture('Zoom on a trackpad, about the fingers', ['Pinch']),
  middleDrag: gesture('Move around a zoomed graph or page', ['Middle-button drag']),
  twoFingers: gesture('Move around on a trackpad (any direction)', ['Two-finger drag']),
} as const

/** A gesture as the sheet shows it on this platform. */
export const gestureText = (g: ViewGesture, isMac: boolean): readonly string[] =>
  isMac ? g.mac : g.other

/** The zoom box's tooltip: its keys and gestures. */
export function zoomHint(isMac: boolean): string {
  const g = POINTER_GESTURES
  const keys = `${formatShortcut('Mod+=', isMac)} / ${formatShortcut('Mod+-', isMac)}`
  return `Zoom (${keys}; ${gestureText(g.wheelZoom, isMac).join(' or ')}, or pinch, zooms about the pointer). Move around a zoomed view with a middle-button or two-finger drag`
}

const parsed = new Map<string, ReturnType<typeof parseShortcut>>()

/** Whether a key press is one of this entry's keys (modifiers as written; Mod per `isMac`). */
export function isViewKey(k: ViewKey, e: KeyInput, isMac = false): boolean {
  return k.keys.some((text) => {
    let s = parsed.get(text)
    if (!s) {
      s = parseShortcut(text)
      parsed.set(text, s)
    }
    return matchesShortcut(s, e, isMac)
  })
}
