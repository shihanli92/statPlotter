// The menu bar's menus and the groups within each (separated by dividers), in order. Commands
// name a menu and a group; `order` sorts items within a group. Groups are spaced by 10 so a view
// can slot a group in between without renumbering.

export const MENUS = [
  { id: 'file', title: 'File' },
  { id: 'edit', title: 'Edit' },
  { id: 'view', title: 'View' },
  { id: 'insert', title: 'Insert' },
  { id: 'analyze', title: 'Analyze' },
  { id: 'format', title: 'Format' },
  { id: 'arrange', title: 'Arrange' },
  { id: 'help', title: 'Help' },
] as const

export type MenuId = (typeof MENUS)[number]['id']

/**
 * Menus shown only while some command in them is visible (Arrange: only on a layout).
 */
export const OPTIONAL_MENUS: ReadonlySet<MenuId> = new Set(['arrange'])

/** Group numbers per menu. Who provides the commands is noted for the two halves of item 21. */
export const GROUPS = {
  file: {
    /** New project, New from template…, Open…, Open recent ▸, Examples ▸ (app). */
    open: 10,
    /** Save, Save as…, Save as template… (app). */
    save: 20,
    /** Import data… (app). */
    import: 30,
    /** Export ▸ (views: graph / layout export as SVG, PDF, PNG). */
    export: 40,
    /** Print… (graph / layout views). */
    print: 50,
    /** Close project (app). */
    close: 90,
  },
  edit: {
    /** Undo, Redo (app). */
    undo: 10,
    /** Cut, Copy, Paste, Paste transposed, Delete, Select all (views). */
    clipboard: 20,
    /** Find and replace, Find next / previous (table view). */
    find: 25,
    /** Exclude values, Insert / delete rows and columns (table view). */
    table: 30,
    /** Sort, Fill ▸, Move rows / columns (table view). */
    arrange: 35,
    /** Rename sheet, Duplicate sheet, Duplicate family…, Delete sheet (navigator, app). */
    sheet: 40,
    /** Preferences… (app; on macOS the application menu's Settings…, roadmap 37). */
    preferences: 90,
  },
  view: {
    /** Show navigator, Toolbar ▸ Icons only (app). */
    panels: 10,
    /** Zoom in, Zoom out, Actual size (graph / layout views). */
    zoom: 20,
    /** Go to the linked table / results / graph (views). */
    goTo: 30,
    /** Row titles and other view toggles (views). */
    options: 40,
  },
  insert: {
    /** New data table, New graph…, New graph like this…, New layout, Plot a function… (app). */
    sheets: 10,
    /** Text, graph on a page, drawing tools, image, table (layout view). */
    page: 20,
  },
  analyze: {
    /** Analyze…, Guide me…, All analyses… (app), Edit parameters… (results / graph views). */
    analyze: 10,
    /** Apply analyses and graphs to…, Save as method…, Apply method… (app, roadmap 31). */
    reuse: 15,
    /**
     * The common analyses of the table's kind (the dialog's Common, one source), then Recent
     * analyses ▸ (app; roadmap 51a, U5).
     */
    quick: 20,
    /** Every analysis, a submenu per category (app; roadmap 51a). */
    all: 30,
  },
  format: {
    /** Format graph…, Format axes…, Duplicate as… (graph / layout views). */
    graph: 10,
    /** Text ▸ Bold, Italic, Grow / Shrink font, Font size…; Copy / Paste format (format bar). */
    text: 12,
    /** Styles…, Save this graph's look as a style…, Reset to style…, Fit to column… (app). */
    styles: 15,
    /** Graph type / style shortcuts (graph view). */
    style: 20,
    /** Format column… (table view), Change table format… (app). */
    table: 30,
  },
  arrange: {
    /** Bring to front, Send to back, Remove from page (layout view). */
    order: 10,
    /** Group, Ungroup, Lock, Unlock all (layout view). */
    group: 15,
    /** Align, stack, side by side, same size (layout view). */
    align: 20,
    /** Share Y range, match format, arrange in a grid: several graphs or the page (layout view). */
    graphs: 30,
  },
  help: {
    /** Command palette, Keyboard shortcuts (app). */
    commands: 10,
    /** Statistics guide links, About (app). */
    about: 20,
  },
} as const satisfies Record<MenuId, Record<string, number>>

/** Toolbar groups (dividers between), in order. */
export const TOOLBAR_GROUPS = {
  /** New table, Import, Open, Save (app). */
  file: 10,
  /** Undo, Redo (app). */
  undo: 20,
  /** Analyze, New graph, Plot a function, New layout (app). */
  create: 30,
  /** View-specific: Copy, Export ▾ (graph / layout / table / results views), Format… last. */
  view: 40,
} as const
