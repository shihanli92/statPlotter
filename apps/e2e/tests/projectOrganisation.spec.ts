import { readFile } from 'node:fs/promises'
import type { Locator, Page } from '@playwright/test'
import { expect, navigator, openExample, test } from './fixtures.ts'
import {
  analyze,
  cell,
  columnTitles,
  dialog,
  grid,
  newTable,
  pressShortcut,
  sheet,
  toast,
} from './helpers-data.ts'
import { box, canvas, centre, expectUndo, menu, openSheet, undo } from './helpers-graph.ts'

// Project organisation (roadmap 40): sheets reordered by dragging and by Alt+↑/↓; the user's
// folders; the Family view; info sheets with a formula reading an info field; project search
// jumping to a column; thumbnails and the Gallery (Apply style, Add to page); Import from project
// with a family, and a project dropped with Alt; undo of each.

/** A section of the by-kind navigator. */
const section = (page: Page, title: string) =>
  navigator(page)
    .locator('.nav-section')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) })

/** The sheet names shown in a section, in order. */
const names = (page: Page, title: string) => section(page, title).locator('.nav-item .name')

/** A folder's header row in a section. */
const folder = (page: Page, title: string, name: string) =>
  section(page, title).locator('.nav-folder').filter({ hasText: name })

/** The sheet names inside a folder, in a section. */
const inFolder = (page: Page, title: string, name: string) =>
  section(page, title)
    .locator('.nav-folder-group')
    .filter({ has: page.locator('.nav-folder', { hasText: name }) })
    .locator('.nav-item .name')

/** A real pointer drag from one element to a point of another (`at`: 0 top … 1 bottom). */
async function dragTo(
  page: Page,
  from: Locator,
  to: Locator,
  at = 0.5,
  during?: () => Promise<void>,
) {
  const a = await centre(from)
  const b = await box(to)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(b.x + b.w / 2, b.y + b.h * at, { steps: 12 })
  await during?.()
  await page.mouse.up()
}

/** The grid column (0-based, row titles first) of a variable by its title. */
async function columnOf(page: Page, title: string): Promise<number> {
  const titles = await columnTitles(page).allTextContents()
  const i = titles.findIndex((t) => t.replace(/\s*(abc|ƒx)\s*$/, '').trim() === title)
  expect(i, `column ${title}`).toBeGreaterThan(0)
  return i - 1
}

const searchBox = (page: Page) => page.getByRole('searchbox', { name: 'Search the project' })

test.beforeEach(async ({ page }) => {
  // Saving downloads, opening uses a file input (as in browsers without File System Access).
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>
    for (const name of ['showSaveFilePicker', 'showOpenFilePicker']) {
      delete (Window.prototype as unknown as Record<string, unknown>)[name]
      delete w[name]
    }
    // Each test starts in the by-kind view without thumbnails.
    try {
      localStorage.removeItem('ps.nav.view')
      localStorage.removeItem('ps.nav.thumbnails')
    } catch {}
  })
  await page.goto('/')
})

test('a new project’s navigator: Data Tables, then each section with its first sheet', async ({
  page,
}) => {
  // Roadmap 43: no empty headings but the one a project starts in.
  const headings = navigator(page).locator('.nav-section h3')
  await expect(headings).toHaveText(['Data Tables'])
  await expect(section(page, 'Data Tables')).toContainText('No data tables yet.')
  await newTable(page, { name: 'Day 1', sample: true })
  await expect(headings).toHaveText(['Data Tables', 'Graphs'])
  await expect(section(page, 'Data Tables')).not.toContainText('No data tables yet.')
  // Info sheets, as the Insert menu calls them.
  await menu(page, 'Insert', 'Info sheet', 'Blank')
  await expect(headings).toHaveText(['Data Tables', 'Info sheets', 'Graphs'])
  await expect(names(page, 'Info sheets')).toHaveText(['Info'])
  await openSheet(page, 'Day 1', 'Data Tables')
  await analyze(page, 't test')
  await expect(headings).toHaveText(['Data Tables', 'Info sheets', 'Results', 'Graphs'])
  await menu(page, 'Insert', 'New layout')
  await expect(headings).toHaveText(['Data Tables', 'Info sheets', 'Results', 'Graphs', 'Layouts'])
  // Undone, the section goes again.
  await undo(page)
  await expect(headings).toHaveText(['Data Tables', 'Info sheets', 'Results', 'Graphs'])
})

test('reorder sheets by dragging and by Alt+↑/↓, with undo', async ({ page }) => {
  for (const name of ['A', 'B', 'C']) await newTable(page, { name })
  await expect(names(page, 'Data Tables')).toHaveText(['A', 'B', 'C'])

  // C dragged onto the top half of A: before it, a marker showing where while dragging.
  await dragTo(page, sheet(page, 'C', 'Data Tables'), sheet(page, 'A', 'Data Tables'), 0.2, () =>
    expect(sheet(page, 'A', 'Data Tables')).toHaveClass(/\bdrop-before\b/),
  )
  await expect(names(page, 'Data Tables')).toHaveText(['C', 'A', 'B'])
  // The graphs keep their own order.
  await expect(names(page, 'Graphs')).toHaveText(['A', 'B', 'C'])
  await expectUndo(page, 'Move sheet')
  await undo(page)
  await expect(names(page, 'Data Tables')).toHaveText(['A', 'B', 'C'])

  // Alt+↑ on the focused sheet moves it up; it keeps the focus.
  await sheet(page, 'C', 'Data Tables').focus()
  await page.keyboard.press('Alt+ArrowUp')
  await expect(names(page, 'Data Tables')).toHaveText(['A', 'C', 'B'])
  await expect(sheet(page, 'C', 'Data Tables')).toBeFocused()
  await page.keyboard.press('Alt+ArrowUp')
  await expect(names(page, 'Data Tables')).toHaveText(['C', 'A', 'B'])
  await expectUndo(page, 'Move up')
  // Edit › Move sheet down on the selected sheet.
  await sheet(page, 'C', 'Data Tables').click()
  await menu(page, 'Edit', 'Move sheet down')
  await expect(names(page, 'Data Tables')).toHaveText(['A', 'C', 'B'])
  await undo(page)
  await undo(page)
  await undo(page)
  await expect(names(page, 'Data Tables')).toHaveText(['A', 'B', 'C'])
})

test('folders: new, move to, drag in, fold, delete keeping the sheets; undo', async ({ page }) => {
  for (const name of ['A', 'B']) await newTable(page, { name })
  await menu(page, 'Insert', 'New folder')
  const rename = navigator(page).getByRole('textbox', { name: 'Folder name' })
  await rename.fill('Experiment 1')
  await rename.press('Enter')
  // An empty folder shows in every section, to drag sheets into.
  await expect(folder(page, 'Data Tables', 'Experiment 1')).toBeVisible()
  await expect(folder(page, 'Graphs', 'Experiment 1')).toBeVisible()

  // Move to folder… from the sheet's menu.
  await sheet(page, 'B', 'Data Tables').click({ button: 'right' })
  await page.getByRole('menu').getByRole('menuitem', { name: 'Move to folder…' }).click()
  const d = dialog(page, 'Move “B” to a folder')
  await d.getByRole('radio', { name: 'Experiment 1' }).check()
  await d.getByRole('button', { name: 'Move', exact: true }).click()
  await expect(d).toBeHidden()
  await expect(inFolder(page, 'Data Tables', 'Experiment 1')).toHaveText(['B'])
  // Only folders with graphs show among the graphs now.
  await expect(folder(page, 'Graphs', 'Experiment 1')).toHaveCount(0)

  // A dragged into the folder.
  await dragTo(
    page,
    sheet(page, 'A', 'Data Tables'),
    folder(page, 'Data Tables', 'Experiment 1'),
    0.5,
    () => expect(folder(page, 'Data Tables', 'Experiment 1')).toHaveClass(/\bdrop-into\b/),
  )
  await expect(inFolder(page, 'Data Tables', 'Experiment 1')).toHaveText(['A', 'B'])
  await expectUndo(page, 'Move to folder')

  // Folded and unfolded.
  await folder(page, 'Data Tables', 'Experiment 1').click()
  await expect(folder(page, 'Data Tables', 'Experiment 1')).toHaveAttribute(
    'aria-expanded',
    'false',
  )
  await expect(sheet(page, 'A', 'Data Tables')).toHaveCount(0)
  await folder(page, 'Data Tables', 'Experiment 1').click()
  await expect(sheet(page, 'A', 'Data Tables')).toBeVisible()

  // Deleting the folder keeps its sheets; undo brings it back with them.
  await folder(page, 'Data Tables', 'Experiment 1').click({ button: 'right' })
  await page
    .getByRole('menu')
    .getByRole('menuitem', { name: 'Delete folder (keeps its sheets)' })
    .click()
  await expect(folder(page, 'Data Tables', 'Experiment 1')).toHaveCount(0)
  await expect(names(page, 'Data Tables')).toHaveText(['A', 'B'])
  await expectUndo(page, 'Delete folder')
  await undo(page)
  await expect(inFolder(page, 'Data Tables', 'Experiment 1')).toHaveText(['A', 'B'])
})

test('the Family view nests analyses and graphs under their table, graphs under pages', async ({
  page,
}) => {
  await newTable(page, { kind: 'Column', name: 'Day 1', sample: true })
  await analyze(page, 't test')
  await menu(page, 'Insert', 'New layout')
  await navigator(page).getByRole('button', { name: 'Families', exact: true }).click()
  const family = navigator(page)
    .locator('.nav-branch')
    .filter({ has: page.locator('.nav-item[data-kind="table"]') })
    .first()
  await expect(family.locator('.nav-item .name')).toHaveText(['Day 1', 't test of Day 1', 'Day 1'])
  const page1 = navigator(page)
    .locator('.nav-branch')
    .filter({ has: page.locator('.nav-item[data-kind="layout"]') })
  await expect(page1.locator('.nav-item.link .name')).toHaveText(['Day 1'])
  // A tree (audit 2, U16): tree items with their levels, the open sheet the current one.
  const tree = navigator(page).getByRole('tree', { name: 'Sheets by family' })
  await expect(tree.getByRole('treeitem', { name: /^Day 1/ }).first()).toHaveAttribute(
    'aria-level',
    '1',
  )
  await expect(tree.getByRole('treeitem', { name: /^t test of Day 1/ }).first()).toHaveAttribute(
    'aria-level',
    '2',
  )
  await expect(navigator(page).locator('[aria-current="page"]')).toHaveAttribute(
    'data-kind',
    'layout',
  )
  // ← folds a family; → unfolds it.
  const table = family.locator('.nav-item[data-kind="table"]')
  await table.focus()
  await page.keyboard.press('ArrowLeft')
  await expect(table).toHaveAttribute('aria-expanded', 'false')
  await expect(family.locator('.nav-item')).toHaveCount(1)
  await page.keyboard.press('ArrowRight')
  await expect(family.locator('.nav-item')).toHaveCount(3)
  // A link opens the graph it names: its own row is the current one.
  await page1.locator('.nav-item.link').click()
  await expect(canvas(page)).toBeVisible()
  await expect(navigator(page).locator('[aria-current="page"]')).toHaveAttribute(
    'data-kind',
    'graph',
  )
  // The view is remembered per user; back to sheets by kind.
  await navigator(page).getByRole('button', { name: 'By kind', exact: true }).click()
  await expect(section(page, 'Data Tables')).toBeVisible()
})

test('an info sheet’s field in a formula, live; renames follow; search jumps to a column', async ({
  page,
}) => {
  await menu(page, 'Insert', 'Info sheet', 'Blank')
  await expect(sheet(page, 'Info')).toHaveClass(/\bon\b/)
  await page.getByRole('button', { name: 'Add field' }).click()
  await page.getByRole('textbox', { name: 'Field 1 label' }).fill('Dilution')
  await page.getByRole('textbox', { name: 'Field 1 label' }).press('Enter')
  await page.getByRole('textbox', { name: 'Dilution value' }).fill('10')
  await page.getByRole('textbox', { name: 'Dilution value' }).press('Enter')
  await expectUndo(page, 'Edit info')
  // Tab from field to field keeps the focus, each edit kept (audit 2, U8).
  await page.getByRole('button', { name: 'Add field' }).click()
  const label2 = page.getByRole('textbox', { name: 'Field 2 label' })
  await label2.click()
  await page.keyboard.type('Temperature')
  await page.keyboard.press('Tab')
  const value2 = page.getByRole('textbox', { name: 'Temperature value' })
  await expect(value2).toBeFocused()
  await page.keyboard.type('37')
  await page.keyboard.press('Shift+Tab')
  await expect(label2).toBeFocused()
  await expect(label2).toHaveValue('Temperature')
  await expect(value2).toHaveValue('37')
  await expectUndo(page, 'Edit info')

  await newTable(page, { kind: 'Multiple variables', name: 'Assay', sample: true })
  await page.getByRole('button', { name: '+ Calculated variable' }).click()
  await page.getByRole('textbox', { name: 'Name of the new variable' }).fill('Diluted')
  const formula = page.getByRole('textbox', { name: 'Formula' })
  await formula.fill('=[Info: Dilution] * 2')
  await formula.press('Enter')
  const c = await columnOf(page, 'Diluted')
  await expect(cell(page, 0, c)).toHaveText('20')

  // A new value: the formula follows.
  await openSheet(page, 'Info')
  await page.getByRole('textbox', { name: 'Dilution value' }).fill('5')
  await page.getByRole('textbox', { name: 'Dilution value' }).press('Enter')
  await openSheet(page, 'Assay', 'Data Tables')
  await expect(cell(page, 0, c)).toHaveText('10')

  // A renamed field: the formula's reference follows.
  await openSheet(page, 'Info')
  await page.getByRole('textbox', { name: 'Field 1 label' }).fill('Dilution factor')
  await page.getByRole('textbox', { name: 'Field 1 label' }).press('Enter')
  await openSheet(page, 'Assay', 'Data Tables')
  await cell(page, 0, c).click()
  await expect(formula).toHaveValue('=[Info: Dilution factor] * 2')
  await expect(cell(page, 0, c)).toHaveText('10')

  // Project search (⌘F away from a table): the variable's title, then a jump to its column.
  await openSheet(page, 'Info')
  await pressShortcut(page, 'Mod+F')
  await expect(searchBox(page)).toBeFocused()
  await searchBox(page).fill('dilut')
  const results = navigator(page).getByRole('listbox', { name: 'Search results' })
  await expect(results.getByRole('group', { name: 'Assay' })).toContainText('Diluted')
  await expect(results.getByRole('group', { name: 'Info' })).toContainText('Dilution factor')
  await results
    .getByRole('option')
    .filter({ hasText: /^Variable/ })
    .click()
  await expect(grid(page)).toHaveAccessibleName('Assay')
  await expect(cell(page, 0, c)).toHaveClass(/\bfocus\b/)
  // Escape in the box clears it; the sheets are back.
  await searchBox(page).press('Escape')
  await expect(results).toHaveCount(0)
  await expect(sheet(page, 'Assay', 'Data Tables')).toHaveClass(/\bon\b/)

  // The field removed: the formula's error leaves the cells empty.
  await openSheet(page, 'Info')
  await page.getByRole('button', { name: 'Remove Dilution factor' }).click()
  await openSheet(page, 'Assay', 'Data Tables')
  await expect(cell(page, 0, c)).toHaveText('')
  await undo(page)
  await expect(cell(page, 0, c)).toHaveText('10')
})

test('thumbnails in the navigator; the Gallery: Apply style and Add to page', async ({ page }) => {
  await openExample(page, 'getting-started')
  await navigator(page).getByRole('button', { name: 'Thumbnails', exact: true }).click()
  await expect(section(page, 'Graphs').locator('.nav-thumb img').first()).toBeVisible()
  await expect(section(page, 'Layouts').locator('.nav-thumb img').first()).toBeVisible()

  await menu(page, 'View', 'Gallery')
  const g = dialog(page, 'Gallery')
  await expect(g.locator('.gallery-thumb img').first()).toBeVisible()
  await g.getByRole('checkbox', { name: 'Choose Dose response (bars)' }).check()
  await g.getByRole('button', { name: 'Apply style…' }).click()
  const styles = dialog(page, 'Styles')
  await styles.getByRole('button', { name: /^Journal: Nature-style/ }).click()
  await expect(
    styles.getByRole('radio', { name: /^The graphs chosen in the Gallery \(1\)/ }),
  ).toBeChecked()
  await styles.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(styles).toBeHidden()
  await openSheet(page, 'Dose response (bars)', 'Graphs')
  await expect(canvas(page).locator('[data-id="axis/y/title"] tspan').first()).toHaveAttribute(
    'font-size',
    '7',
  )

  // Two graphs on a new page, one step.
  await menu(page, 'View', 'Gallery')
  await g.getByRole('checkbox', { name: 'Choose Cell area (swarm)' }).check()
  await g.getByRole('checkbox', { name: 'Choose Cell area (violin)' }).check()
  await g.getByRole('combobox', { name: 'Page' }).selectOption({ label: 'New page' })
  await g.getByRole('button', { name: 'Add to page', exact: true }).click()
  await expect(g).toBeHidden()
  await expect(toast(page)).toContainText('2 graphs on “Layout 2”')
  await expect(sheet(page, 'Layout 2', 'Layouts')).toHaveClass(/\bon\b/)
  await expectUndo(page, 'Add to page')
})

test('Import from project with a family, names made unique, one undo step; a project dropped with Alt', async ({
  page,
}, testInfo) => {
  await newTable(page, { kind: 'Column', name: 'Day 1', sample: true })
  await analyze(page, 't test')
  const download = page.waitForEvent('download')
  await pressShortcut(page, 'Mod+S')
  const path = testInfo.outputPath('day1.psproj')
  await (await download).saveAs(path)

  // A new project with a table of the same name.
  await menu(page, 'File', 'New project')
  await newTable(page, { name: 'Day 1' })
  const chooser = page.waitForEvent('filechooser')
  await menu(page, 'File', 'Import from project…')
  await (await chooser).setFiles(path)
  const d = dialog(page, 'Import from day1.psproj')
  const list = d.getByRole('list', { name: 'Sheets of the other project' })
  await expect(list.getByRole('checkbox')).toHaveCount(3)
  await expect(d.getByRole('checkbox', { name: /Tables bring their families/ })).toBeChecked()
  await d.getByRole('button', { name: 'Import 3 sheets' }).click()
  await expect(d).toBeHidden()
  await expect(toast(page)).toContainText('3 sheets imported from day1.psproj')
  await expect(names(page, 'Data Tables')).toHaveText(['Day 1', 'Day 1 (2)'])
  await expect(names(page, 'Results')).toHaveText(['t test of Day 1'])
  await expect(names(page, 'Graphs')).toHaveText(['Day 1', 'Day 1 (2)'])
  // The imported t test reads the imported table.
  await openSheet(page, 't test of Day 1', 'Results')
  await expect(page.getByRole('main').getByText('Up to date', { exact: true })).toBeVisible()
  await expectUndo(page, 'Import from day1.psproj')
  await undo(page)
  await expect(names(page, 'Data Tables')).toHaveText(['Day 1'])
  await expect(names(page, 'Results')).toHaveCount(0)

  // Dropped with Alt on the open project: straight to the import.
  const bytes = [...(await readFile(path))]
  await page.getByRole('main').evaluate((el, bytes) => {
    const dt = new DataTransfer()
    dt.items.add(new File([new Uint8Array(bytes)], 'day1.psproj', { type: '' }))
    const init = { dataTransfer: dt, bubbles: true, cancelable: true, altKey: true }
    el.dispatchEvent(new DragEvent('dragenter', init))
    el.dispatchEvent(new DragEvent('dragover', init))
    el.dispatchEvent(new DragEvent('drop', init))
  }, bytes)
  const again = dialog(page, 'Import from day1.psproj')
  await expect(again).toBeVisible()
  await again.getByRole('button', { name: 'Untick all' }).click()
  await again.getByRole('checkbox', { name: /Tables bring their families/ }).uncheck()
  await list.getByRole('checkbox').first().check()
  await again.getByRole('button', { name: 'Import 1 sheet' }).click()
  await expect(names(page, 'Data Tables')).toHaveText(['Day 1', 'Day 1 (2)'])
  await expect(names(page, 'Results')).toHaveCount(0)

  // A project that can't be read, dropped with Alt: the message, and the drops after it still
  // handled (audit 2, U4: the queue waited for a dialog that never opened).
  const drop = (name: string, bytes: number[], altKey: boolean) =>
    page.getByRole('main').evaluate(
      (el, { name, bytes, altKey }) => {
        const dt = new DataTransfer()
        dt.items.add(new File([new Uint8Array(bytes)], name, { type: '' }))
        const init = { dataTransfer: dt, bubbles: true, cancelable: true, altKey }
        el.dispatchEvent(new DragEvent('dragenter', init))
        el.dispatchEvent(new DragEvent('dragover', init))
        el.dispatchEvent(new DragEvent('drop', init))
      },
      { name, bytes, altKey },
    )
  await drop('broken.psproj', [...Buffer.from('not a project', 'utf8')], true)
  // An error: in the alert region, kept until dismissed (audit 2, U15).
  await expect(page.getByRole('alert').locator('.toast')).toContainText('Not a project file')
  await drop('more.csv', [...Buffer.from('x,y\n1,2\n3,4\n', 'utf8')], false)
  await expect(dialog(page, 'Import “more.csv”')).toBeVisible()
})
