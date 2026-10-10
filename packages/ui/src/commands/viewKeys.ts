import { type KeyInput, matchesShortcut, parseShortcut } from './shortcut.ts'

// Keys a view handles itself, outside the command registry (audit 2, U20): on a row of the
// navigator, on the graph's canvas, on a layout page. One table, read by the Keyboard shortcuts
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
} as const

/** The sheet's sections of these keys, after the commands'. */
export const VIEW_KEY_SECTIONS: readonly { title: string; items: readonly ViewKey[] }[] = [
  { title: 'In the navigator', items: Object.values(NAVIGATOR_KEYS) },
  { title: 'On the canvas', items: Object.values(CANVAS_KEYS) },
  { title: 'On a page', items: Object.values(PAGE_KEYS) },
]

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
