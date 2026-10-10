import type { Page } from '@playwright/test'
import { expect, test } from './fixtures.ts'
import {
  analyze,
  answer,
  cell,
  columnTitles,
  dialog,
  expectUpToDate,
  grid,
  newTable,
  resultTable,
  resultValue,
  rowCells,
  runMenu,
  sheet,
  toast,
  tool,
  typeCells,
} from './helpers-data.ts'

// Reusing analyses (roadmap 31): duplicate a family, apply analyses and graphs to other tables,
// change the analyzed table, new graph like this, templates, methods, the table's entry format
// and sheet notes.

/** A column table of the sample data (Control, Treated) with an unpaired t test. */
async function tableWithTTest(page: Page, name: string) {
  await newTable(page, { kind: 'Column', name, sample: true })
  await analyze(page, 't test')
}

/** The t of the open t test's results. */
const tValue = (page: Page) => resultValue(resultTable(page, 'Unpaired t test'), 't')

/** Opens a sheet's right-click menu in the navigator and chooses an item. */
async function sheetMenu(
  page: Page,
  name: string,
  section: Parameters<typeof sheet>[2],
  item: string,
) {
  await sheet(page, name, section).click({ button: 'right' })
  await page.getByRole('menu').getByRole('menuitem', { name: item }).click()
}

test.beforeEach(async ({ page }) => {
  // Downloads and <input type=file> in every engine (Chromium's pickers are native dialogs).
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>
    for (const name of ['showSaveFilePicker', 'showOpenFilePicker']) {
      delete (Window.prototype as unknown as Record<string, unknown>)[name]
      delete w[name]
    }
  })
  await page.goto('/')
})

test('duplicate a family with a name substitution, in one undo step', async ({ page }) => {
  await tableWithTTest(page, 'Day 1')
  const t1 = await tValue(page).textContent()
  await sheetMenu(page, 'Day 1', 'Data Tables', 'Duplicate family…')
  const d = dialog(page, 'Duplicate “Day 1” with its family')
  await expect(d.getByRole('textbox', { name: 'In the copies’ names, replace' })).toHaveValue(
    'Day 1',
  )
  await expect(d.getByRole('textbox', { name: 'with' })).toHaveValue('Day 2')
  await d.getByRole('textbox', { name: 'with' }).fill('Day 2 (repeat)')
  await expect(d.getByRole('list', { name: 'The copies' }).getByRole('listitem')).toHaveText([
    'Day 2 (repeat)',
    't test of Day 2 (repeat)',
    'Day 2 (repeat)',
  ])
  await d.getByRole('button', { name: 'Duplicate' }).click()
  await expect(d).toBeHidden()
  // The copy opens, with the values.
  await expect(grid(page)).toHaveAccessibleName('Day 2 (repeat)')
  await expect(rowCells(page, 0)).toHaveText(['34.1', '45.2'])
  await expect(sheet(page, 'Day 2 (repeat)', 'Graphs')).toBeVisible()

  // Its t test analyses the copy: an edit there changes it, not the original's.
  await typeCells(page, 0, 0, [['80']])
  await sheet(page, 't test of Day 2 (repeat)', 'Results').click()
  await expectUpToDate(page)
  await expect(tValue(page)).not.toHaveText(t1!)
  await sheet(page, 't test of Day 1', 'Results').click()
  await expect(tValue(page)).toHaveText(t1!)

  // Undo the edit, then the whole duplicate at once.
  await tool(page, 'Undo Edit cells').click()
  await tool(page, 'Undo Duplicate family').click()
  await expect(sheet(page, 't test of Day 2 (repeat)', 'Results')).toHaveCount(0)
  await expect(sheet(page, 'Day 2 (repeat)', 'Data Tables')).toHaveCount(0)
})

test('apply analyses and graphs to two tables, with what has no match reported', async ({
  page,
}) => {
  await tableWithTTest(page, 'Day 1')
  const t1 = await tValue(page).textContent()
  await newTable(page, { kind: 'Column', name: 'Day 2', sample: true })
  // Day 3 has one data set: the t test's second has no match there.
  await newTable(page, { kind: 'Column', name: 'Day 3', dataSets: 1 })
  await typeCells(page, 0, 0, [['1'], ['2'], ['3']])
  await sheet(page, 'Day 1', 'Data Tables').click()

  await runMenu(page, 'Analyze', 'Apply analyses and graphs to…')
  const d = dialog(page, 'Apply the analyses and graphs of “Day 1”')
  await d.getByRole('checkbox', { name: 'Day 2' }).check()
  await d.getByRole('checkbox', { name: 'Day 3' }).check()
  await expect(d.getByRole('status', { name: 'Not carried over' })).toContainText(
    '“t test of Day 3”: no match for “Treated”, left out.',
  )
  await d.getByRole('button', { name: 'Apply' }).click()
  await expect(d).toBeHidden()

  // Day 2 has the same values as Day 1: the same t.
  await sheet(page, 't test of Day 2', 'Results').click()
  await expectUpToDate(page)
  await expect(tValue(page)).toHaveText(t1!)
  // It has an error (one data set), badged in the navigator.
  await expect(
    page
      .getByRole('navigation', { name: 'Project' })
      .getByRole('treeitem', { name: /^t test of Day 3 !/ }),
  ).toBeVisible()
  // A graph each (besides the one every new table gets).
  await expect(sheet(page, 'Day 3', 'Graphs')).toHaveCount(2)

  await tool(page, 'Undo Apply analyses and graphs').click()
  await expect(sheet(page, 't test of Day 2', 'Results')).toHaveCount(0)
  await expect(sheet(page, 'Day 3', 'Graphs')).toHaveCount(1)
})

test('change the analyzed table in the analysis parameters', async ({ page }) => {
  await tableWithTTest(page, 'Day 1')
  const t1 = await tValue(page).textContent()
  await newTable(page, { kind: 'Column', name: 'Day 2', sample: true })
  await typeCells(page, 0, 0, [['60']])

  await sheet(page, 't test of Day 1', 'Results').click()
  await page.getByRole('main').getByRole('button', { name: 'Parameters…' }).click()
  const d = dialog(page, 'Analysis parameters')
  await d.getByRole('combobox', { name: 'Analyze' }).selectOption({ label: 'Day 2' })
  await d.getByRole('combobox', { name: 'matching data sets' }).selectOption('title')
  await expect(d.getByRole('checkbox', { name: 'Control' })).toBeChecked()
  await d.getByRole('button', { name: 'OK', exact: true }).click()
  await expect(d).toBeHidden()

  // Renamed after the table it analyzes, and computed from it.
  await expect(sheet(page, 't test of Day 2', 'Results')).toBeVisible()
  await sheet(page, 't test of Day 2', 'Results').click()
  await expectUpToDate(page)
  await expect(tValue(page)).not.toHaveText(t1!)
  await tool(page, 'Undo Change analyzed table').click()
  await sheet(page, 't test of Day 1', 'Results').click()
  await expect(tValue(page)).toHaveText(t1!)
})

test('new graph like this: an empty table like the graph’s, and the graph on it', async ({
  page,
}) => {
  await newTable(page, { kind: 'Column', name: 'Day 1', sample: true })
  await sheet(page, 'Day 1', 'Graphs').click()
  await runMenu(page, 'Insert', 'New graph like this…')
  const d = dialog(page, 'New graph like “Day 1”')
  await expect(d.getByRole('textbox', { name: 'Name of the new table' })).toHaveValue('Day 2')
  await d.getByRole('button', { name: 'Create' }).click()
  await expect(d).toBeHidden()
  // The new table opens, empty, with the same data sets.
  await expect(grid(page)).toHaveAccessibleName('Day 2')
  await expect(columnTitles(page)).toHaveText(['', 'Control', 'Treated'])
  await expect(rowCells(page, 0)).toHaveText(['', ''])
  await typeCells(page, 0, 0, [['5', '6']])
  await sheet(page, 'Day 2', 'Graphs').click()
  await expect(page.getByRole('main').locator('svg').first()).toBeVisible()
})

test('save a template (a download) and start a project from it', async ({ page }, testInfo) => {
  await tableWithTTest(page, 'Day 1')
  await runMenu(page, 'File', 'Save as template…')
  const d = dialog(page, 'Save as template')
  await d.getByRole('textbox', { name: 'Template name' }).fill('Weekly assay')
  const download = page.waitForEvent('download')
  await d.getByRole('button', { name: 'Save…' }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe('Weekly assay.pstemplate')
  const path = testInfo.outputPath('weekly.pstemplate')
  await file.saveAs(path)
  await expect(d).toBeHidden()

  // Remembered in this browser: listed by New from template….
  await runMenu(page, 'File', 'New from template…')
  let t = dialog(page, 'New from template')
  await t.getByRole('button', { name: /^Weekly assay/ }).click()
  await t.getByRole('button', { name: 'Open', exact: true }).click()
  await answer(page, 'Discard unsaved changes?', 'Discard')
  await expect(t).toBeHidden()
  await expect(page).toHaveTitle('Untitled — statPlotter')
  await expect(grid(page)).toHaveAccessibleName('Day 1')
  await expect(columnTitles(page)).toHaveText(['', 'Control', 'Treated'])
  await expect(rowCells(page, 0)).toHaveText(['', ''])
  await expect(sheet(page, 't test of Day 1', 'Results')).toBeVisible()

  // From the start screen, a template file picked with Browse….
  await page.goto('/')
  await page.getByRole('button', { name: 'New from template…' }).click()
  t = dialog(page, 'New from template')
  const chooser = page.waitForEvent('filechooser')
  await t.getByRole('button', { name: 'Browse…' }).click()
  await (await chooser).setFiles(path)
  await expect(t).toBeHidden()
  await expect(grid(page)).toHaveAccessibleName('Day 1')

  // The next experiment's values, saved as a new project (not over the template).
  await typeCells(page, 0, 0, [
    ['30', '40'],
    ['31', '41'],
    ['29', '45'],
  ])
  await sheet(page, 't test of Day 1', 'Results').click()
  await expectUpToDate(page)
  const save = page.waitForEvent('download')
  await runMenu(page, 'File', 'Save')
  expect((await save).suggestedFilename()).toBe('Untitled.psproj')
})

test('save a method, apply it to another table, export and import it', async ({
  page,
}, testInfo) => {
  await tableWithTTest(page, 'Day 1')
  const t1 = await tValue(page).textContent()
  await runMenu(page, 'Analyze', 'Save as method…')
  let d = dialog(page, 'Save as method')
  await d.getByRole('textbox', { name: 'Method name' }).fill('Two groups')
  await d.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(d).toBeHidden()
  await expect(toast(page)).toContainText('Saved the method “Two groups”')

  await newTable(page, { kind: 'Column', name: 'Plate 7', sample: true })
  await runMenu(page, 'Analyze', 'Apply method…')
  d = dialog(page, 'Apply a method')
  await d.getByRole('option', { name: 'Two groups' }).click()
  await expect(d.getByRole('checkbox', { name: 'Plate 7' })).toBeChecked()
  await expect(d.getByRole('textbox', { name: 'In the new sheets’ names, the text' })).toHaveValue(
    'Day 1',
  )

  // Exported to share, deleted, imported back.
  const download = page.waitForEvent('download')
  await d.getByRole('button', { name: 'Export…' }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe('Two groups.psmethod')
  const path = testInfo.outputPath('two.psmethod')
  await file.saveAs(path)
  await d.getByRole('button', { name: 'Delete' }).click()
  await answer(page, 'Delete the method “Two groups”?', 'Delete')
  await expect(d.getByRole('option')).toHaveCount(0)
  const chooser = page.waitForEvent('filechooser')
  await d.getByRole('button', { name: 'Import…' }).click()
  await (await chooser).setFiles(path)
  await expect(d.getByRole('option', { name: 'Two groups' })).toHaveAttribute(
    'aria-selected',
    'true',
  )

  await d.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(d).toBeHidden()
  await sheet(page, 't test of Plate 7', 'Results').click()
  await expectUpToDate(page)
  await expect(tValue(page)).toHaveText(t1!)
})

test('change the entry format: replicates to mean, SD and N, then SD to SEM', async ({ page }) => {
  await newTable(page, { kind: 'Column', name: 'W', sample: true })
  await runMenu(page, 'Format', 'Change table format…')
  let d = dialog(page, 'Change table format')
  await d.getByRole('radio', { name: 'Mean, SD, N' }).check()
  await expect(d.getByRole('status')).toContainText('Replaces the 16 values entered')
  await d.getByRole('button', { name: 'Change format' }).click()
  await expect(d).toBeHidden()
  // One row per data set: mean, SD (n − 1), N.
  await expect(rowCells(page, 0)).toHaveText([
    '34.85',
    '3.978154633208',
    '8',
    '47.5125',
    '4.22896052746501',
    '8',
  ])
  await expect(rowCells(page, 1)).toHaveCount(0)

  await runMenu(page, 'Format', 'Change table format…')
  d = dialog(page, 'Change table format')
  await d.getByRole('radio', { name: 'Mean, SEM, N' }).check()
  await expect(d.getByRole('status')).toContainText('Every value converts exactly')
  await d.getByRole('button', { name: 'Change format' }).click()
  await expect(rowCells(page, 0)).toHaveText([
    '34.85',
    '1.40649005887503',
    '8',
    '47.5125',
    '1.49516333317037',
    '8',
  ])

  // Each change is one undo step.
  await tool(page, 'Undo Change table format').click()
  await tool(page, 'Undo Change table format').click()
  await expect(rowCells(page, 0)).toHaveText(['34.1', '45.2'])
  await expect(cell(page, 7, 0)).toHaveText('30.4')
})

test('edit the notes of a table, its results, a graph and a layout page', async ({ page }) => {
  await tableWithTTest(page, 'Day 1')
  await runMenu(page, 'Insert', 'New layout')
  const notes = page.getByRole('main').getByRole('textbox', { name: 'Notes' })
  for (const [name, section] of [
    ['Day 1', 'Data Tables'],
    ['t test of Day 1', 'Results'],
    ['Day 1', 'Graphs'],
    ['Layout 1', 'Layouts'],
  ] as const) {
    await sheet(page, name, section).click()
    await page.getByRole('main').getByText('Notes', { exact: true }).click()
    await notes.fill(`About ${section}`)
    await notes.blur()
    await expect(tool(page, 'Undo Edit notes')).toBeVisible()
  }
  // Kept with each sheet.
  await sheet(page, 'Day 1', 'Data Tables').click()
  await expect(notes).toHaveValue('About Data Tables')
  await sheet(page, 'Day 1', 'Graphs').click()
  await expect(notes).toHaveValue('About Graphs')
  // Undo takes the last edit back.
  await tool(page, 'Undo Edit notes').click()
  await sheet(page, 'Layout 1', 'Layouts').click()
  await expect(page.getByRole('main').getByText('Notes', { exact: true })).toBeVisible()
  await expect(notes).toHaveCount(0)
})
