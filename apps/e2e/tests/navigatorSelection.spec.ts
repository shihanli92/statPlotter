import { readFile } from 'node:fs/promises'
import type { Download, Locator, Page } from '@playwright/test'
import { unzipSync } from 'fflate'
import { expect, navigator, openExample, test } from './fixtures.ts'
import { newTable, pressShortcut } from './helpers-data.ts'
import {
  box,
  canvas,
  centre,
  dialog,
  expectUndo,
  menu,
  openSheet,
  sheet,
  undo,
} from './helpers-graph.ts'

// Roadmap 47 (UX review S8): several sheets selected in the navigator — ⌘-click (Ctrl-click
// elsewhere), Shift-click ranges in both views, Shift+↓, ⌘A, Escape — and what is done to them
// at once, one undo step each: Delete (one question listing what goes with them), Duplicate,
// Move to folder and dragging, Apply style and Match format to the selected graphs, Export
// selected (a zip in the browser).

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // Downloads rather than Chromium's save picker (which automation can't drive).
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true })
    // Each test starts in the by-kind view.
    try {
      localStorage.removeItem('ps.nav.view')
      localStorage.removeItem('ps.nav.collapsed')
    } catch {}
  })
})

/** The key that adds a sheet to the selection: ⌘ on macOS, Ctrl elsewhere (either works). */
const TOGGLE = 'ControlOrMeta'

/** A section of the by-kind navigator. */
const section = (page: Page, title: string) =>
  navigator(page)
    .locator('.nav-section')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) })

/** The sheet names shown in a section, in order. */
const names = (page: Page, title: string) => section(page, title).locator('.nav-item .name')

/** The names of the selected rows, in the order shown. */
const selected = (scope: Locator) => scope.locator('.nav-item[aria-selected="true"] .name')

/** The sheet names inside a folder, in a section. */
const inFolder = (page: Page, title: string, name: string) =>
  section(page, title)
    .locator('.nav-folder-group')
    .filter({ has: page.locator('.nav-folder', { hasText: name }) })
    .locator('.nav-item .name')

/** A folder's row in a section. */
const folder = (page: Page, title: string, name: string) =>
  section(page, title).locator('.nav-folder').filter({ hasText: name })

/** A real pointer drag from one element to a point of another (`at`: 0 top … 1 bottom). */
async function dragTo(page: Page, from: Locator, to: Locator, at = 0.5) {
  const a = await centre(from)
  const b = await box(to)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(b.x + b.w / 2, b.y + b.h * at, { steps: 12 })
  await page.mouse.up()
}

/** A sheet's row's context menu item. */
async function rowMenu(page: Page, row: Locator, item: string) {
  await row.click({ button: 'right' })
  await page.getByRole('menu').getByRole('menuitem', { name: item, exact: true }).click()
}

/** Tables A, B and C (each with its graph). */
async function threeTables(page: Page) {
  await page.goto('/')
  for (const name of ['A', 'B', 'C']) await newTable(page, { name })
  await expect(names(page, 'Data Tables')).toHaveText(['A', 'B', 'C'])
  await expect(names(page, 'Graphs')).toHaveText(['A', 'B', 'C'])
}

/**
 * The open graph's width in inches, as its size readout shows it ("4.00 × 3.00 in"): the plot's
 * width and the margins of its Y axis' labels (the same for graphs of one table).
 */
const graphWidth = async (page: Page) =>
  /(\d+\.\d+) × \d+\.\d+ in$/.exec((await page.locator('.selection-hint').textContent()) ?? '')?.[1]

test('⌘-click and Shift-click select several sheets; Shift+↓, ⌘A and Escape', async ({ page }) => {
  await threeTables(page)
  const nav = navigator(page)
  await openSheet(page, 'A', 'Data Tables')
  // Every section is a multi-selectable tree; the open sheet alone is selected.
  await expect(nav.getByRole('tree', { name: 'Data Tables' })).toHaveAttribute(
    'aria-multiselectable',
    'true',
  )
  await expect(selected(nav)).toHaveText(['A'])

  // ⌘-click adds C without opening it.
  await sheet(page, 'C', 'Data Tables').click({ modifiers: [TOGGLE] })
  await expect(selected(nav)).toHaveText(['A', 'C'])
  await expect(sheet(page, 'A', 'Data Tables')).toHaveClass(/\bon\b/)
  await expect(sheet(page, 'C', 'Data Tables')).toHaveClass(/\bselected\b/)
  await expect(sheet(page, 'C', 'Data Tables')).not.toHaveClass(/\bon\b/)
  await expect(nav.getByRole('status')).toHaveText('2 sheets selected')
  await expect(page.getByRole('main').getByRole('grid')).toHaveAccessibleName('A')

  // Shift-click: from the anchor (C) to graph B, in the order shown.
  await sheet(page, 'B', 'Graphs').click({ modifiers: ['Shift'] })
  await expect(selected(nav)).toHaveText(['C', 'A', 'B'])
  // Escape: the open sheet alone again.
  await sheet(page, 'B', 'Graphs').press('Escape')
  await expect(selected(nav)).toHaveText(['A'])
  await expect(nav.locator('.nav-selection')).toHaveText('')

  // Shift+↓ extends from the open sheet; ⌘A selects every sheet shown.
  await sheet(page, 'A', 'Data Tables').focus()
  await page.keyboard.press('Shift+ArrowDown')
  await page.keyboard.press('Shift+ArrowDown')
  await expect(selected(nav)).toHaveText(['A', 'B', 'C'])
  await pressShortcut(page, 'Mod+A')
  await expect(selected(nav)).toHaveText(['A', 'B', 'C', 'A', 'B', 'C'])
  // A plain click opens one sheet and selects it alone.
  await sheet(page, 'B', 'Graphs').click()
  await expect(sheet(page, 'B', 'Graphs')).toHaveClass(/\bon\b/)
  await expect(selected(nav)).toHaveText(['B'])

  // The Family view: a range runs over the tree as shown, a folded family left out.
  await nav.getByRole('button', { name: 'Families', exact: true }).click()
  const tree = nav.getByRole('tree', { name: 'Sheets by family' })
  await expect(tree).toHaveAttribute('aria-multiselectable', 'true')
  const table = (name: string) => tree.locator('.nav-item[data-kind="table"]', { hasText: name })
  await table('A').click()
  await table('C').click({ modifiers: ['Shift'] })
  await expect(selected(tree)).toHaveText(['A', 'A', 'B', 'B', 'C'])
  await table('B').locator('.chevron').click()
  await table('A').click()
  await table('C').click({ modifiers: ['Shift'] })
  await expect(selected(tree)).toHaveText(['A', 'A', 'B', 'C'])
})

test('Delete several sheets: one question listing what goes too, one undo step', async ({
  page,
}) => {
  await threeTables(page)
  await openSheet(page, 'A', 'Data Tables')
  await sheet(page, 'B', 'Data Tables').click({ modifiers: [TOGGLE] })
  await sheet(page, 'B', 'Data Tables').press('Delete')
  const q = page.getByRole('alertdialog', { name: 'Delete 2 sheets?' })
  await expect(q).toContainText('“A” and “B” will be deleted. With them: 2 graphs (“A” and “B”).')
  await q.getByRole('button', { name: 'Delete 2 sheets', exact: true }).click()
  await expect(q).toBeHidden()
  await expect(names(page, 'Data Tables')).toHaveText(['C'])
  await expect(names(page, 'Graphs')).toHaveText(['C'])
  await expect(sheet(page, 'C', 'Data Tables')).toHaveClass(/\bon\b/)
  await expectUndo(page, 'Delete 2 sheets')
  await undo(page)
  await expect(names(page, 'Data Tables')).toHaveText(['A', 'B', 'C'])
  await expect(names(page, 'Graphs')).toHaveText(['A', 'B', 'C'])

  // The menu of a selected row acts on the selection: Duplicate (2), one step.
  await openSheet(page, 'A', 'Data Tables')
  await sheet(page, 'C', 'Data Tables').click({ modifiers: [TOGGLE] })
  await sheet(page, 'C', 'Data Tables').click({ button: 'right' })
  const m = page.getByRole('menu')
  await expect(m.getByRole('menuitem', { name: 'Delete (2)', exact: true })).toBeVisible()
  await expect(m.getByRole('menuitem', { name: 'Export selected…', exact: true })).toBeDisabled()
  await expect(m.getByRole('menuitem', { name: /^Rename/ })).toHaveCount(0)
  await m.getByRole('menuitem', { name: 'Duplicate (2)', exact: true }).click()
  await expect(names(page, 'Data Tables')).toHaveText(['A', 'A (copy)', 'B', 'C', 'C (copy)'])
  await expectUndo(page, 'Duplicate 2 sheets')
  await undo(page)
  await expect(names(page, 'Data Tables')).toHaveText(['A', 'B', 'C'])

  // A right-click on a row outside the selection selects (and opens) that row first.
  await openSheet(page, 'A', 'Data Tables')
  await sheet(page, 'C', 'Data Tables').click({ modifiers: [TOGGLE] })
  await sheet(page, 'B', 'Graphs').click({ button: 'right' })
  await expect(page.getByRole('menu').getByRole('menuitem', { name: 'Rename…' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(selected(navigator(page))).toHaveText(['B'])
})

// Audit 3 (A5): after Delete on a row (one sheet, or several once asked) the focus is on the row
// that took the deleted one's place, so deleting goes on from the keyboard.
test('the focus stays in the navigator after deleting sheets', async ({ page }) => {
  await threeTables(page)
  await openSheet(page, 'A', 'Data Tables')
  await sheet(page, 'B', 'Graphs').focus()
  await page.keyboard.press('Delete')
  await expect(names(page, 'Graphs')).toHaveText(['A', 'C'])
  await expect(sheet(page, 'C', 'Graphs')).toBeFocused()
  // Several, after their question (Enter on its focused Delete).
  await sheet(page, 'A', 'Data Tables').focus()
  await page.keyboard.press('Shift+ArrowDown')
  await page.keyboard.press('Delete')
  const q = page.getByRole('alertdialog', { name: 'Delete 2 sheets?' })
  await expect(q.getByRole('button', { name: 'Delete 2 sheets', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(q).toBeHidden()
  await expect(names(page, 'Data Tables')).toHaveText(['C'])
  await expect(sheet(page, 'C', 'Data Tables')).toBeFocused()
  // And again, on the row now focused.
  await page.keyboard.press('Delete')
  await expect(names(page, 'Data Tables')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('nav'))).toBe(true)
})

test('Move to folder and dragging several sheets, one step each', async ({ page }) => {
  await threeTables(page)
  await menu(page, 'Insert', 'New folder')
  const rename = navigator(page).getByRole('textbox', { name: 'Folder name' })
  await rename.fill('Experiment')
  await rename.press('Enter')

  // Move to folder… (2) from the selection's menu.
  await openSheet(page, 'A', 'Data Tables')
  await sheet(page, 'C', 'Data Tables').click({ modifiers: [TOGGLE] })
  await rowMenu(page, sheet(page, 'C', 'Data Tables'), 'Move to folder (2)…')
  const d = dialog(page, 'Move 2 sheets to a folder')
  await d.getByRole('radio', { name: 'Experiment' }).check()
  await d.getByRole('button', { name: 'Move', exact: true }).click()
  await expect(d).toBeHidden()
  await expect(inFolder(page, 'Data Tables', 'Experiment')).toHaveText(['A', 'C'])
  await expectUndo(page, 'Move 2 sheets to folder')
  await undo(page)
  await expect(names(page, 'Data Tables')).toHaveText(['A', 'B', 'C'])

  // Two selected graphs dragged into the folder together.
  await openSheet(page, 'A', 'Graphs')
  await sheet(page, 'B', 'Graphs').click({ modifiers: [TOGGLE] })
  await dragTo(page, sheet(page, 'A', 'Graphs'), folder(page, 'Graphs', 'Experiment'))
  await expect(inFolder(page, 'Graphs', 'Experiment')).toHaveText(['A', 'B'])
  await expectUndo(page, 'Move 2 sheets')
  await undo(page)
  await expect(inFolder(page, 'Graphs', 'Experiment')).toHaveCount(0)

  // Two selected tables dragged below C, in their order.
  await openSheet(page, 'A', 'Data Tables')
  await sheet(page, 'B', 'Data Tables').click({ modifiers: [TOGGLE] })
  await dragTo(page, sheet(page, 'B', 'Data Tables'), sheet(page, 'C', 'Data Tables'), 0.8)
  await expect(names(page, 'Data Tables')).toHaveText(['C', 'A', 'B'])
  await expectUndo(page, 'Move 2 sheets')
  await undo(page)
  await expect(names(page, 'Data Tables')).toHaveText(['A', 'B', 'C'])
})

test('Apply style and Match format to the graphs selected in the navigator', async ({ page }) => {
  await openExample(page, 'getting-started')
  const yTitle = () => canvas(page).locator('[data-id="axis/y/title"] tspan').first()
  await openSheet(page, 'Cell area (swarm)', 'Graphs')
  await sheet(page, 'Cell area (violin)', 'Graphs').click({ modifiers: [TOGGLE] })
  await rowMenu(page, sheet(page, 'Cell area (violin)', 'Graphs'), 'Apply style (2)…')
  const styles = dialog(page, 'Styles')
  await styles.getByRole('button', { name: /^Journal: Nature-style/ }).click()
  await expect(
    styles.getByRole('radio', { name: /^The graphs selected in the navigator \(2\)/ }),
  ).toBeChecked()
  await styles.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(styles).toBeHidden()
  await expectUndo(page, 'Apply style to 2 graphs')
  await expect(yTitle()).toHaveAttribute('font-size', '7')
  await openSheet(page, 'Cell area (violin)', 'Graphs')
  await expect(yTitle()).toHaveAttribute('font-size', '7')
  await openSheet(page, 'Dose response (bars)', 'Graphs')
  await expect(yTitle()).toHaveAttribute('font-size', '12')

  // The bars graph fitted to a double column: the model for the other two.
  await menu(page, 'Format', 'Fit to column…')
  const fit = dialog(page, 'Fit to column')
  await fit.getByRole('radio', { name: /^Double column/ }).check()
  await fit.getByRole('button', { name: 'Fit', exact: true }).click()
  await expect(fit).toBeHidden()
  await expectUndo(page, 'Fit to column')
  await openSheet(page, 'Cell area (swarm)', 'Graphs')
  await expect.poll(() => graphWidth(page)).toBeTruthy()
  const before = await graphWidth(page)
  await sheet(page, 'Cell area (violin)', 'Graphs').click({ modifiers: [TOGGLE] })
  await rowMenu(page, sheet(page, 'Cell area (violin)', 'Graphs'), 'Match format (2)…')
  const match = dialog(page, 'Match format')
  await match
    .getByLabel('Make the selected graphs look like')
    .selectOption({ label: 'Dose response (bars)' })
  await expect(match).toContainText('2 graphs change.')
  await match.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(match).toBeHidden()
  await expectUndo(page, 'Match format of 2 graphs')
  // Both now the bars graph's size and kind (the same table's, so laid out alike).
  await expect.poll(() => graphWidth(page)).not.toBe(before)
  const matched = await graphWidth(page)
  await openSheet(page, 'Cell area (violin)', 'Graphs')
  await expect.poll(() => graphWidth(page)).toBe(matched)
  await undo(page)
  await expect.poll(() => graphWidth(page)).not.toBe(matched)
  await openSheet(page, 'Cell area (swarm)', 'Graphs')
  await expect.poll(() => graphWidth(page)).toBe(before)
})

test('Export selected: the selected graphs and pages in one zip', async ({ page }) => {
  await openExample(page, 'getting-started')
  await openSheet(page, 'Dose response (bars)', 'Graphs')
  await sheet(page, 'Cell area (swarm)', 'Graphs').click({ modifiers: [TOGGLE] })
  await sheet(page, 'Figure 1', 'Layouts').click({ modifiers: [TOGGLE] })
  // A data table selected too: not exported.
  await sheet(page, 'Cell area', 'Data Tables').click({ modifiers: [TOGGLE] })
  await rowMenu(page, sheet(page, 'Figure 1', 'Layouts'), 'Export selected (3)…')
  const d = dialog(page, 'Export the selected graphs and pages')
  await d.getByRole('radio', { name: 'SVG (vector)' }).check()
  await expect(d.locator('.export-summary')).toContainText('3 graphs and pages, each')
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    d.getByRole('button', { name: 'Export…' }).click(),
  ])
  await expect(d).toBeHidden()
  expect(download.suggestedFilename()).toBe('Untitled selected.zip')
  const bytes = new Uint8Array(await readFile(await (download as Download).path()))
  expect(Object.keys(unzipSync(bytes)).sort()).toEqual([
    'Cell area (swarm).svg',
    'Dose response (bars).svg',
    'Figure 1.svg',
  ])
  // Also File › Export ▸, named with the count.
  await menu(page, 'File', 'Export', 'Selected in the navigator (3)…')
  await expect(dialog(page, 'Export the selected graphs and pages')).toBeVisible()
})
