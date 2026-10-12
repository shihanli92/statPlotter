import { expect, type Locator, type Page } from '@playwright/test'

// Helpers for the shell, table, import, analysis and file journeys (roadmap 24, half A).

// ---- Keys ---------------------------------------------------------------------------------------

/**
 * Whether the app treats the platform as macOS (its `isMacPlatform`). Playwright's "Desktop
 * Chrome" and "Desktop Firefox" devices report Windows user agents, so on a Mac host Chromium's app
 * uses Ctrl shortcuts while Firefox (whose navigator.platform stays "MacIntel") and WebKit use ⌘.
 */
export async function appIsMac(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
    return /mac|iphone|ipad/i.test(nav.userAgentData?.platform ?? nav.platform ?? '')
  })
}

/**
 * Presses one of the app's shortcuts, written as in the command registry ('Mod+Shift+Z'): `Mod`
 * is the key the app reads as its command key. The browser's own clipboard keys (copy / paste
 * events) follow the host OS instead: use `ControlOrMeta` for those.
 */
export async function pressShortcut(page: Page, shortcut: string): Promise<void> {
  const mod = (await appIsMac(page)) ? 'Meta' : 'Control'
  await page.keyboard.press(shortcut.replace(/\bMod\b/, mod))
}

// ---- Menus --------------------------------------------------------------------------------------

export const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * A menu item's accessible name is its label, then its shortcut hint if any ('Save Ctrl+S',
 * 'Save ⌘S', '✓ Show navigator ⌘\'): matches the label exactly, whatever the platform.
 */
export function itemName(label: string | RegExp): RegExp {
  if (label instanceof RegExp) return label
  return new RegExp(`^(✓ )?${escapeRegExp(label)}( (Ctrl|Alt|Shift|Del|Esc|[⌃⌥⇧⌘⌫⌦]).*)?$`)
}

export const menubar = (page: Page) => page.getByRole('menubar', { name: 'Main menu' })

/** A menu of the menu bar (its button). */
export const topMenu = (page: Page, name: string) =>
  menubar(page).getByRole('menuitem', { name, exact: true })

/** An open menu (or submenu) panel by its title. */
export const menuPanel = (page: Page, name: string) => page.getByRole('menu', { name, exact: true })

/** An item of an open menu panel (plain or checkbox item). */
export const menuItem = (menu: Locator, label: string | RegExp) =>
  menu
    .getByRole('menuitem', { name: itemName(label) })
    .or(menu.getByRole('menuitemcheckbox', { name: itemName(label) }))

/** Opens a menu of the menu bar with a click and returns its panel. */
export async function openMenu(page: Page, name: string): Promise<Locator> {
  await topMenu(page, name).click()
  const panel = menuPanel(page, name)
  await expect(panel).toBeVisible()
  return panel
}

/**
 * Chooses a menu bar item by clicks: `runMenu(page, 'Edit', 'Insert row')`, or through
 * submenus: `runMenu(page, 'File', 'Examples', 'Grouped data')`.
 */
export async function runMenu(page: Page, menu: string, ...path: string[]): Promise<void> {
  let panel = await openMenu(page, menu)
  for (const [i, label] of path.entries()) {
    const item = menuItem(panel, label)
    await item.click()
    if (i < path.length - 1) {
      panel = menuPanel(page, label)
      await expect(panel).toBeVisible()
    }
  }
  await expect(page.getByRole('menu')).toHaveCount(0)
}

// ---- Dialogs, toolbar, navigator ----------------------------------------------------------------

/** An open modal dialog by the title in its heading. */
export const dialog = (page: Page, title: string | RegExp) =>
  page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: title, exact: typeof title === 'string' }) })

/**
 * Answers the app's question (audit 2, U26: an alert dialog of its own, never the browser's
 * confirm) by its title, with this button ("Cancel", or the one that goes ahead).
 */
export async function answer(page: Page, title: string | RegExp, button: string): Promise<void> {
  const q = page.getByRole('alertdialog', { name: title })
  await expect(q).toBeVisible()
  await q.getByRole('button', { name: button, exact: true }).click()
  await expect(q).toBeHidden()
}

/** The popup importing a multiple-variables table of more than 5,000 rows opens (decision 456). */
export const cellsPrompt = (page: Page) =>
  // Its own heading (it opens inside the import dialog, which holds it too).
  page.locator('dialog[open]').filter({
    has: page.locator(':scope > header').getByRole('heading', { name: /^Large table: / }),
  })

/** Answers the import's cells-table popup: a cells table, or an ordinary table. */
export async function answerCellsPrompt(page: Page, cells: boolean): Promise<void> {
  const p = cellsPrompt(page)
  await expect(p).toBeVisible({ timeout: 120_000 })
  await p
    .getByRole('button', {
      name: cells ? 'Treat as a cells table' : 'Import as an ordinary table',
      exact: true,
    })
    .click()
  await expect(p).toBeHidden()
}

export const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Toolbar' })

/** A toolbar button by its label (the command's label, e.g. "Undo New table"). */
export const tool = (page: Page, name: string | RegExp) =>
  toolbar(page).getByRole('button', { name, exact: typeof name === 'string' })

/** The navigator's row for a sheet; `section` picks among sheets of the same name. */
export function sheet(
  page: Page,
  name: string,
  section?: 'Data Tables' | 'Results' | 'Graphs' | 'Layouts',
): Locator {
  const nav = page.getByRole('navigation', { name: 'Project' })
  const scope = section
    ? nav.locator('.nav-section').filter({ has: page.getByRole('heading', { name: section }) })
    : nav
  // A hovered row shows its delete button, whose label joins the row's name. Roadmap 47: rows are
  // tree items in both views (By kind's were buttons).
  const label = escapeRegExp(name)
  return scope.getByRole('treeitem', { name: new RegExp(`^${label}( Delete ${label})?$`) })
}

/**
 * What Create in the New data table dialog says (roadmap 43): a notice for a few seconds, which
 * `toast` leaves out so it doesn't stand beside the toast a later step checks.
 */
export const NEW_TABLE_NOTICE = /created, with a graph of it/

/**
 * The toasts: an error (in the alert region) and a notice (in the status region), but the notice
 * of a table just made (`NEW_TABLE_NOTICE`).
 */
export const toast = (page: Page) => page.locator('.toast').filter({ hasNotText: NEW_TABLE_NOTICE })

// ---- Tables -------------------------------------------------------------------------------------

export type TableKindLabel =
  | 'Column'
  | 'XY'
  | 'Grouped'
  | 'Contingency'
  | 'Survival'
  | 'Multiple variables'
  | 'Parts of whole'
  | 'Nested'

export const TABLE_KINDS: readonly TableKindLabel[] = [
  'Column',
  'XY',
  'Grouped',
  'Contingency',
  'Survival',
  'Multiple variables',
  'Parts of whole',
  'Nested',
]

/** Creates a table with the New data table dialog (toolbar button) and waits for its grid. */
export async function newTable(
  page: Page,
  opts: {
    kind?: TableKindLabel
    name?: string
    sample?: boolean
    dataSets?: number
    replicates?: number
  } = {},
): Promise<Locator> {
  await tool(page, 'New data table…').click()
  const d = dialog(page, 'New data table')
  await expect(d).toBeVisible()
  if (opts.name !== undefined) await d.getByRole('textbox', { name: 'Name' }).fill(opts.name)
  const name = await d.getByRole('textbox', { name: 'Name' }).inputValue()
  await d
    .getByRole('radio', { name: new RegExp(`^${escapeRegExp(opts.kind ?? 'Column')} —`) })
    .check()
  // Roadmap 43: ticked by default in a project without tables, so set either way (before the
  // sizes, which show for an empty table only).
  await d
    .getByRole('checkbox', { name: /^Start with sample data/ })
    .setChecked(opts.sample ?? false)
  if (opts.replicates !== undefined)
    await d
      .getByRole('spinbutton', { name: /^(Replicates|Subjects)/ })
      .fill(String(opts.replicates))
  if (opts.dataSets !== undefined)
    await d.getByRole('spinbutton', { name: /^Number of/ }).fill(String(opts.dataSets))
  await d.getByRole('button', { name: 'Create' }).click()
  await expect(d).toBeHidden()
  const g = grid(page)
  await expect(g).toHaveAccessibleName(name)
  return g
}

/** The data table grid of the open sheet. */
export const grid = (page: Page) => page.getByRole('main').getByRole('grid')

/** Grid row `r` (0-based, as rendered: the grid is scrolled to the top). */
export const gridRow = (page: Page, r: number) =>
  grid(page).getByRole('rowgroup').nth(1).getByRole('row').nth(r)

/** The data cells of row `r`: row title, X and Y subcolumns in grid order. */
export const rowCells = (page: Page, r: number) => gridRow(page, r).getByRole('cell')

/** Grid cell at row `r`, grid column `c` (both 0-based, not counting the row numbers). */
export const cell = (page: Page, r: number, c: number) => rowCells(page, r).nth(c)

/** The table's column titles, in order (the first header row). */
export const columnTitles = (page: Page) =>
  grid(page).getByRole('rowgroup').first().getByRole('row').first().getByRole('columnheader')

/** Expects the first rows of the grid to show these texts (one array of cell texts per row). */
export async function expectRows(page: Page, rows: readonly (readonly string[])[]): Promise<void> {
  for (const [r, texts] of rows.entries()) await expect(rowCells(page, r)).toHaveText([...texts])
}

/**
 * Types rows of values into the grid from cell (r, c): each row starts with a click on its first
 * cell, Tab moves between its values and Enter commits the last.
 */
export async function typeCells(
  page: Page,
  r: number,
  c: number,
  rows: readonly (readonly string[])[],
): Promise<void> {
  for (const [i, values] of rows.entries()) {
    await cell(page, r + i, c).click()
    for (const [j, v] of values.entries()) {
      if (v !== '') await page.keyboard.type(v)
      await page.keyboard.press(j < values.length - 1 ? 'Tab' : 'Enter')
    }
  }
}

/**
 * Pastes text into the grid at the focused cell, as a spreadsheet's copy (tab-separated). In
 * Chromium a plain paste goes through the real clipboard and keys (clipboard permissions are
 * granted to the page's context). Elsewhere, where scripts can't write the clipboard without a
 * prompt, and for a transposed paste everywhere (headless Chromium on macOS gives ⇧⌘V no paste
 * event), it is the grid's own events: ⇧⌘V's keydown, which marks the next paste as transposed,
 * then the paste event carrying the text.
 */
export async function pasteText(
  page: Page,
  text: string,
  opts: { transposed?: boolean; browserName: string },
): Promise<void> {
  if (opts.browserName === 'chromium' && !opts.transposed) {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.evaluate((t) => navigator.clipboard.writeText(t), text)
    await page.keyboard.press('ControlOrMeta+V')
    return
  }
  const isMac = await appIsMac(page)
  await grid(page).evaluate(
    (el, { text, transposed, isMac }) => {
      if (transposed) {
        el.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'V',
            shiftKey: true,
            metaKey: isMac,
            ctrlKey: !isMac,
            bubbles: true,
            cancelable: true,
          }),
        )
      }
      const data = new DataTransfer()
      data.setData('text/plain', text)
      const event = new Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'clipboardData', { value: data })
      el.dispatchEvent(event)
    },
    { text, transposed: !!opts.transposed, isMac },
  )
}

// ---- Analyses and results -----------------------------------------------------------------------

/**
 * Runs an analysis of the open table from the Analyze dialog (toolbar Analyze…): picks it in the
 * list, lets `configure` set parameters, presses OK and waits until the results are up to date.
 */
export async function analyze(
  page: Page,
  title: string,
  configure?: (d: Locator) => Promise<void>,
): Promise<void> {
  await tool(page, 'Analyze…').click()
  const d = dialog(page, /^Analyze “/)
  await expect(d).toBeVisible()
  await allAnalyses(d)
  await d.getByRole('option', { name: title, exact: true }).click()
  await configure?.(d)
  await d.getByRole('button', { name: 'OK', exact: true }).click()
  await expect(d).toBeHidden()
  await expectUpToDate(page)
}

/**
 * Roadmap 51a: the Analyze dialog's All analyses tab (Analyze… opens on Guide me the first time
 * in a project, and on the tab last used after that).
 */
export async function allAnalyses(d: Locator): Promise<void> {
  await expect(d).toBeVisible()
  const tab = d.getByRole('tab', { name: 'All analyses', exact: true })
  if ((await tab.count()) && (await tab.getAttribute('aria-selected')) !== 'true') await tab.click()
  await expect(d.getByRole('combobox', { name: 'Search analyses' })).toBeVisible()
}

/** The results view shows finished results with no error banner. */
export async function expectUpToDate(page: Page): Promise<void> {
  const main = page.getByRole('main')
  await expect(main.getByText('Up to date', { exact: true })).toBeVisible()
  await expect(main.locator('.banner.error')).toHaveCount(0)
}

/** A results table by the title in its first header row. */
export const resultTable = (page: Page, title: string) =>
  page
    .getByRole('main')
    .getByRole('table')
    .filter({ has: page.getByRole('columnheader', { name: title, exact: true }) })

/** The cells of the row labelled `label` in a results table (label first). */
export const resultRow = (table: Locator, label: string) =>
  table
    .getByRole('row')
    .filter({ has: table.page().getByRole('cell', { name: label, exact: true }) })
    .getByRole('cell')

/** The value next to a label in a key-value results table. */
export const resultValue = (table: Locator, label: string) => resultRow(table, label).nth(1)
