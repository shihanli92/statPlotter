import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures.ts'
import {
  answerCellsPrompt,
  cell,
  cellsPrompt,
  columnTitles,
  dialog,
  expectRows,
  grid,
  pressShortcut,
  rowCells,
  runMenu,
  sheet,
  toast,
} from './helpers-data.ts'

// File › Import data… with the committed files in apps/e2e/fixtures:
// - growth.csv: time and two growth curves (an XY table with a header row);
// - semicolon-decimal-comma.csv: "Dose;Response" with decimal commas (European spreadsheets);
// - long-format.csv: one row per mouse (mouse, genotype, weight), R / pandas style;
// - two-sheets.xlsx: sheet "Weights" (Control / Treated columns, one value missing) and sheet
//   "Counts" (a 2×2 table with row titles), written as a minimal workbook with fflate;
// - xy-with-exclusions.pzfx: packages/io/test/fixtures/pzfx/x_y_with_strike.pzfx (an XY table
//   with row titles, duplicates and struck-out values).

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url))

type FileInput = string | { name: string; mimeType: string; buffer: Buffer }

/** File › Import data…, choosing a file in the (web) file chooser. */
async function importFile(page: Page, file: FileInput): Promise<void> {
  const chooser = page.waitForEvent('filechooser')
  await runMenu(page, 'File', 'Import data…')
  await (await chooser).setFiles(typeof file === 'string' ? fixture(file) : file)
}

/** The import dialog's "Imports as" preview: its table and the line describing it. */
const importsAs = (page: Page) => importDialog(page).locator('.import-preview.result')
const importDialog = (page: Page) => dialog(page, /^Import “/)

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('the start screen offers Import data…, and dropping a file', async ({ page }) => {
  // Roadmap 43: the second action of an empty project, the File menu's command.
  const main = page.getByRole('main')
  await expect(main.getByText('or drop a file anywhere in the window')).toBeVisible()
  const chooser = page.waitForEvent('filechooser')
  await main.getByRole('button', { name: 'Import data… (CSV, Excel, .pzfx)' }).click()
  await (await chooser).setFiles(fixture('growth.csv'))
  const d = dialog(page, 'Import “growth.csv”')
  await expect(d).toBeVisible()
  await d.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(d).toBeHidden()
  await expect(grid(page)).toBeVisible()
  await expect(sheet(page, 'growth', 'Data Tables')).toBeVisible()
})

test('CSV: the detected XY layout, another table type, a name', async ({ page }) => {
  await importFile(page, 'growth.csv')
  const d = dialog(page, 'Import “growth.csv”')
  await expect(d).toBeVisible()
  // The file as read, and what it gives.
  await expect(d.getByRole('table').first().getByRole('row').first()).toHaveText(
    /Time \(h\)\s*Wild type\s*Knockout/,
  )
  await expect(importsAs(page)).toContainText('XY table · 2 data sets · 4 rows')
  await expect(d.getByRole('radio', { name: 'XY (first column is X)' })).toBeChecked()
  await expect(d.getByRole('checkbox', { name: 'First row holds column titles' })).toBeChecked()
  await expect(d).toContainText('X = Time (h)')

  // As a column table, time becomes a data set; without a header row, titles become values.
  await d.getByRole('radio', { name: 'Column', exact: true }).check()
  await expect(importsAs(page)).toContainText('Column table · 3 data sets · 4 rows')
  await expect(d.getByRole('checkbox', { name: 'Use the detected layout' })).not.toBeChecked()
  await d.getByRole('checkbox', { name: 'First row holds column titles' }).uncheck()
  await expect(importsAs(page)).toContainText('· 5 rows')

  // Back to the detected layout.
  await d.getByRole('checkbox', { name: 'Use the detected layout' }).check()
  await expect(importsAs(page)).toContainText('XY table · 2 data sets · 4 rows')
  await d.getByRole('textbox', { name: 'Table name' }).fill('Growth curve')
  await d.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(d).toBeHidden()

  await expect(grid(page)).toHaveAccessibleName('Growth curve')
  await expect(columnTitles(page)).toHaveText(['Row', 'Time (h)', 'Wild type', 'Knockout'])
  await expectRows(page, [
    ['0', '1.5', '1.4'],
    ['2', '2.9', '2.1'],
    ['4', '4.1', '2.6'],
    ['8', '6.2', '3.3'],
  ])
  await expect(sheet(page, 'Growth curve', 'Graphs')).toBeVisible()

  // One undo step removes the table and its graph.
  await pressShortcut(page, 'Mod+Z')
  await expect(sheet(page, 'Growth curve')).toHaveCount(0)
})

test('CSV: delimiter and decimal separator', async ({ page }) => {
  await importFile(page, 'semicolon-decimal-comma.csv')
  const d = importDialog(page)
  const fileRows = d.getByRole('table').first().getByRole('row')
  // Detected: semicolons between values, commas in numbers.
  await expect(fileRows.nth(1).getByRole('cell')).toHaveText(['0', '1.25'])

  // Read with commas as the delimiter instead, the numbers fall apart.
  await d.getByRole('combobox', { name: 'Delimiter' }).selectOption({ label: 'Comma' })
  await expect(fileRows.nth(1).getByRole('cell')).toHaveText(['0;1', '25'])
  await d.getByRole('combobox', { name: 'Delimiter' }).selectOption({ label: 'Semicolon' })
  await d
    .getByRole('combobox', { name: 'Decimal separator' })
    .selectOption({ label: 'Comma (1,5)' })
  await expect(fileRows.nth(1).getByRole('cell')).toHaveText(['0', '1.25'])
  await expect(importsAs(page)).toContainText('XY table · 1 data set · 3 rows')

  await d.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(grid(page)).toHaveAccessibleName('semicolon-decimal-comma')
  await expectRows(page, [
    ['0', '1.25'],
    ['1', '2.5'],
    ['2', '3.75'],
  ])
})

test('CSV in long format: data sets by a column, or every column a variable', async ({ page }) => {
  await importFile(page, 'long-format.csv')
  const d = importDialog(page)
  const longMode = d.getByRole('radio', { name: /^One value per row \(long format\)/ })
  await expect(longMode).toBeChecked()
  await expect(d.getByRole('combobox', { name: 'Values' })).toHaveValue('2')
  await expect(importsAs(page)).toContainText('Column table · 2 data sets · 3 rows')

  // Subjects matched by mouse put each mouse on its own row.
  await d.getByRole('combobox', { name: 'Subjects (matching)' }).selectOption({
    label: 'mouse (6 levels)',
  })
  await expect(importsAs(page)).toContainText('· 6 rows')
  await d.getByRole('combobox', { name: 'Subjects (matching)' }).selectOption({ label: 'None' })
  // Only one genotype.
  await d.getByRole('combobox', { name: 'Only rows where' }).selectOption({
    label: 'genotype (2 levels)',
  })
  await d.getByRole('combobox', { name: 'equals' }).selectOption('KO')
  await expect(importsAs(page)).toContainText('Column table · 1 data set · 3 rows')
  await d.getByRole('combobox', { name: 'Only rows where' }).selectOption({ label: 'None' })

  // Every column a variable: a multiple-variables table, text columns kept as text.
  await d
    .getByRole('radio', { name: /^Every column a variable \(multiple-variables table/ })
    .check()
  await expect(importsAs(page)).toContainText('Multiple variables table · 3 variables (2 text)')
  await d.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(d).toBeHidden()
  await expect(columnTitles(page)).toHaveText(['Row', /mouse\s*abc/, /genotype\s*abc/, 'weight'])
  await expect(rowCells(page, 3)).toHaveText(['m4', 'KO', '25.4'])
})

test('XLSX: a sheet of the workbook, then every table in it', async ({ page }) => {
  await importFile(page, 'two-sheets.xlsx')
  const d = importDialog(page)
  const sheetSelect = d.getByRole('combobox', { name: 'Sheet' })
  await expect(sheetSelect).toHaveValue('0')
  await expect(d.getByRole('textbox', { name: 'Table name' })).toHaveValue('two-sheets – Weights')
  await expect(importsAs(page)).toContainText('Column table · 2 data sets · 4 rows')

  // The second sheet: groups in rows, with their titles.
  await sheetSelect.selectOption({ label: 'Counts' })
  await expect(d.getByRole('textbox', { name: 'Table name' })).toHaveValue('two-sheets – Counts')
  await expect(importsAs(page)).toContainText(/Drug\s*42\s*8/)
  await sheetSelect.selectOption({ label: 'Weights' })
  await d.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(grid(page)).toHaveAccessibleName('two-sheets – Weights')
  await expectRows(page, [
    ['21.5', '25.1'],
    ['19.8', '27.3'],
    ['22.4', '24.8'],
    ['20.1', ''],
  ])

  // Again, every table in the file in one step.
  await importFile(page, 'two-sheets.xlsx')
  await importDialog(page).getByRole('button', { name: 'Import all 2 tables in the file' }).click()
  await expect(importDialog(page)).toBeHidden()
  await expect(sheet(page, 'Weights', 'Data Tables')).toBeVisible()
  await expect(sheet(page, 'Counts', 'Data Tables')).toBeVisible()
  await sheet(page, 'Counts', 'Data Tables').click()
  await expect(rowCells(page, 0)).toHaveText(['Drug', '42', '8'])
  await expect(rowCells(page, 1)).toHaveText(['Placebo', '30', '20'])
  await expect(columnTitles(page)).toHaveText(['Row', '', 'Alive', 'Dead'])
})

test('PZFX: tables in, excluded values kept', async ({ page }) => {
  await importFile(page, 'xy-with-exclusions.pzfx')
  // The file's tables are typed already: the dialog only offers the file's graphs (roadmap 39;
  // importInterop.spec.ts imports them). Without them, what wasn't imported is reported.
  const d = dialog(page, 'Import “xy-with-exclusions.pzfx”')
  await expect(d).toContainText('1 XY table.')
  await d.getByRole('checkbox', { name: 'Import graphs' }).uncheck()
  await d.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(d).toBeHidden()
  await expect(toast(page)).toContainText(
    'Analyses, graphs and layouts in the file were not imported.',
  )
  // The message goes by itself after a while, or with its button.
  await toast(page).getByRole('button', { name: 'Dismiss' }).click()
  await expect(toast(page)).toBeHidden()
  await expect(grid(page)).toBeVisible()
  await expect(columnTitles(page)).toHaveText(['Row', '', 'XX', 'Ya', 'Yb', 'Yc'])
  await expect(rowCells(page, 0)).toHaveText(['A', '1', '100', '50', '1', '10', '5', '2'])
  await expect(rowCells(page, 1)).toHaveText(['B', '2', '90*', '60*', '2*', '9', '5', '2'])
  await expect(cell(page, 1, 2)).toHaveClass(/\bexcluded\b/)
  await expect(cell(page, 1, 5)).not.toHaveClass(/\bexcluded\b/)
  await expect(sheet(page, 'Data 1', 'Graphs')).toBeVisible()
})

test('cancelling an import and files that have no data', async ({ page }) => {
  await importFile(page, 'growth.csv')
  await importDialog(page).getByRole('button', { name: 'Cancel' }).click()
  await expect(importDialog(page)).toBeHidden()
  await expect(page.getByRole('heading', { name: 'Start a project' })).toBeVisible()

  await importFile(page, { name: 'empty.csv', mimeType: 'text/csv', buffer: Buffer.from('') })
  await expect(toast(page)).toHaveText(/The file has no data\./)
  await expect(importDialog(page)).toHaveCount(0)
})

test('a data frame of cells: every column a variable, the cell ids left out until ticked', async ({
  page,
}) => {
  // 300 cells: a unique id each, a cluster, four measurements (a Seurat-like export).
  const lines = ['cell,cluster,UMAP_1,UMAP_2,nCount,GENE1']
  for (let r = 0; r < 300; r++)
    lines.push(`AACG${1000 + r}-1,C${r % 5},${(r % 17) / 3},${(r % 13) / 2},${900 + r},${r % 7}`)
  await importFile(page, {
    name: 'cells.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(`${lines.join('\n')}\n`),
  })
  const d = importDialog(page)
  await expect(
    d.getByRole('radio', { name: /^Every column a variable \(multiple-variables table/ }),
  ).toBeChecked()
  const id = d.getByRole('checkbox', { name: 'cell', exact: true })
  await expect(id).not.toBeChecked()
  await expect(
    d
      .locator('.large-import-column')
      .filter({ has: page.getByRole('checkbox', { name: 'cell', exact: true }) }),
  ).toContainText('300 distinct values: left out (tick to import)')
  await expect(importsAs(page)).toContainText('Multiple variables table · 5 variables (1 text)')
  // Ticked: imported after all.
  await id.check()
  await expect(importsAs(page)).toContainText('· 6 variables (2 text)')
  await id.uncheck()
  await d.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(d).toBeHidden()
  await expect(columnTitles(page)).toHaveText([
    'Row',
    /cluster\s*abc/,
    'UMAP_1',
    'UMAP_2',
    'nCount',
    'GENE1',
  ])
})

test('a table of more than 5,000 rows asks whether it is a cells table', async ({ page }) => {
  // Decision 456: a cluster and four measurements per row; 6,000 rows ask, 4,000 don't.
  const csv = (rows: number) => {
    const lines = ['cluster,UMAP_1,UMAP_2,nCount,GENE1']
    for (let r = 0; r < rows; r++)
      lines.push(`C${r % 5},${(r % 17) / 3},${(r % 13) / 2},${900 + (r % 400)},${r % 7}`)
    return {
      name: `rows${rows}.csv`,
      mimeType: 'text/csv',
      buffer: Buffer.from(`${lines.join('\n')}\n`),
    }
  }
  const tableBox = page
    .getByRole('main')
    .getByRole('checkbox', { name: 'Cells table (single-cell / cytometry)' })
  const importAs = async (rows: number, name: string) => {
    await importFile(page, csv(rows))
    const d = importDialog(page)
    await expect(importsAs(page)).toContainText('Multiple variables table')
    await d.getByLabel('Table name', { exact: true }).fill(name)
    return d
  }

  // 6,000 rows: no checkbox; Import asks, naming the size. Cancel imports nothing.
  let d = await importAs(6000, 'cancelled')
  await expect(d.getByRole('checkbox', { name: /^Treat as a cells table/ })).toHaveCount(0)
  await d.getByRole('button', { name: 'Import', exact: true }).click()
  const prompt = cellsPrompt(page)
  await expect(prompt.getByRole('heading')).toHaveText('Large table: 6,000 rows × 5 variables')
  await expect(prompt).toContainText('recommended for single-cell / cytometry data')
  await expect(prompt.getByRole('button', { name: 'Treat as a cells table' })).toBeFocused()
  await prompt.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(prompt).toBeHidden()
  await expect(d).toBeVisible()
  await d.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(d).toBeHidden()
  await expect(sheet(page, 'cancelled', 'Data Tables')).toHaveCount(0)

  // A cells table (the default answer): the table's setting on.
  d = await importAs(6000, 'cells')
  await d.getByRole('button', { name: 'Import', exact: true }).click()
  await answerCellsPrompt(page, true)
  await expect(d).toBeHidden()
  await expect(sheet(page, 'cells', 'Data Tables')).toBeVisible()
  await expect(grid(page)).toHaveAccessibleName('cells')
  await expect(tableBox).toBeChecked()

  // An ordinary table: off.
  d = await importAs(6000, 'ordinary')
  await d.getByRole('button', { name: 'Import', exact: true }).click()
  await answerCellsPrompt(page, false)
  await expect(d).toBeHidden()
  await expect(grid(page)).toHaveAccessibleName('ordinary')
  await expect(tableBox).not.toBeChecked()

  // 4,000 rows: no popup, the dialog's checkbox (off) decides.
  d = await importAs(4000, 'small')
  await expect(d.getByRole('checkbox', { name: /^Treat as a cells table/ })).not.toBeChecked()
  await d.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(d).toBeHidden()
  await expect(cellsPrompt(page)).toHaveCount(0)
  await expect(grid(page)).toHaveAccessibleName('small')
  await expect(tableBox).not.toBeChecked()
})
