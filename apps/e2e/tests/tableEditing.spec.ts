import type { Locator, Page } from '@playwright/test'
import { expect, test } from './fixtures.ts'
import {
  cell,
  columnTitles,
  dialog,
  expectRows,
  grid,
  gridRow,
  menuItem,
  menuPanel,
  newTable,
  pressShortcut,
  rowCells,
  runMenu,
  sheet,
  toast,
  tool,
  typeCells,
} from './helpers-data.ts'
import { canvas, expand, inWindow, layerList, pointLabels } from './helpers-graph.ts'

// Table editing (roadmap 29): sorting, moving rows and columns, fill, find and replace, column
// formats and widths, keyboard jumps.

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

/** A row's number (the gutter left of its cells). */
const rowNumber = (page: Page, r: number) => gridRow(page, r).locator('th.row-num')

/** The first column's texts of the first `n` rows. */
async function firstColumn(page: Page, n: number, c = 0): Promise<string[]> {
  const out: string[] = []
  for (let r = 0; r < n; r++) out.push((await cell(page, r, c).textContent()) ?? '')
  return out
}

/** The focused cell's row and grid column. */
async function focused(page: Page): Promise<{ r: number; c: number }> {
  const td = grid(page).locator('td.focus')
  await expect(td).toHaveCount(1)
  return td.evaluate((el) => ({
    r: Number(el.parentElement!.getAttribute('data-row')),
    c: [...el.parentElement!.children].indexOf(el) - 1,
  }))
}

/** Right-clicks a column header and chooses an item of its menu. */
async function headerMenu(page: Page, header: Locator, item: string | RegExp) {
  await header.click({ button: 'right' })
  const m = menuPanel(page, 'Column')
  await menuItem(m, item).click()
  await expect(m).toBeHidden()
}

test('sorting rows from the header menu and the Sort dialog; labelled rows follow', async ({
  page,
}) => {
  await newTable(page, { kind: 'XY', dataSets: 1, replicates: 1 })
  await page.getByRole('main').getByRole('checkbox', { name: 'Row titles' }).check()
  await typeCells(page, 0, 0, [
    ['c', '1', '10'],
    ['a', '2', '20'],
    ['b', '3', '30'],
  ])
  const titles = () => firstColumn(page, 3)
  expect(await titles()).toEqual(['c', 'a', 'b'])

  // Label row a's point on the table's graph.
  await sheet(page, 'Data 1', 'Graphs').click()
  await expect(canvas(page)).toBeVisible()
  await tool(page, 'Format graph…').click()
  const d = await inWindow(page, 'Format graph')
  // The points' every data set (the graph's list of layers), then their labels.
  await layerList(d).getByRole('option').first().click()
  const labels = await expand(d, 'Label points')
  await labels.getByLabel('Label', { exact: true }).selectOption({ label: 'Row titles' })
  await labels.getByLabel('Which points').selectOption({ label: 'Chosen rows' })
  await labels.getByRole('checkbox', { name: /^a\b/ }).check()
  await d.getByRole('button', { name: 'OK' }).click()
  await expect(d).toBeHidden()
  const labelled = pointLabels(canvas(page))
  await expect(labelled).toHaveText(['a'])

  // Row titles ascending, from the row titles' header.
  await sheet(page, 'Data 1', 'Data Tables').click()
  await headerMenu(page, columnTitles(page).nth(1), 'Sort ascending by Row titles')
  expect(await titles()).toEqual(['a', 'b', 'c'])
  await expect(tool(page, 'Undo Sort rows')).toBeEnabled()
  // The graph still labels row a.
  await sheet(page, 'Data 1', 'Graphs').click()
  await expect(labelled).toHaveText(['a'])

  // Edit › Sort…: by Y descending.
  await sheet(page, 'Data 1', 'Data Tables').click()
  await runMenu(page, 'Edit', 'Sort…')
  const sort = dialog(page, 'Sort rows')
  await expect(sort.getByText(/Sorts every row of “Data 1” \(10 rows\)/)).toBeVisible()
  await sort.getByLabel('Sort by', { exact: true }).selectOption({ label: 'Group A' })
  await sort.getByLabel('Sort by: order').selectOption('desc')
  await sort.getByRole('button', { name: 'Sort' }).click()
  await expect(sort).toBeHidden()
  await expect(rowCells(page, 0)).toHaveText(['b', '3', '30'])
  expect(await titles()).toEqual(['b', 'a', 'c'])
  await sheet(page, 'Data 1', 'Graphs').click()
  await expect(labelled).toHaveText(['a'])

  // Each sort is one undo step.
  await sheet(page, 'Data 1', 'Data Tables').click()
  await pressShortcut(page, 'Mod+Z')
  await expect(rowCells(page, 0)).toHaveText(['a', '2', '20'])
  await pressShortcut(page, 'Mod+Z')
  await expect(rowCells(page, 0)).toHaveText(['c', '1', '10'])
})

test('selecting rows by their numbers, moving and inserting them', async ({ page }) => {
  await newTable(page, { kind: 'Column', dataSets: 1 })
  await typeCells(page, 0, 0, [['1'], ['2'], ['3'], ['4'], ['5']])
  const values = () => firstColumn(page, 5)

  // A row number selects its row; ⌥⌘↑ moves it up, Edit › Move rows down back.
  await rowNumber(page, 2).click()
  await expect(rowNumber(page, 2)).toHaveClass(/\bsel\b/)
  await expect(cell(page, 2, 0)).toHaveClass(/\bsel\b/)
  await pressShortcut(page, 'Mod+Alt+ArrowUp')
  expect(await values()).toEqual(['1', '3', '2', '4', '5'])
  await expect(rowNumber(page, 1)).toHaveClass(/\bsel\b/)
  await runMenu(page, 'Edit', 'Move rows down')
  expect(await values()).toEqual(['1', '2', '3', '4', '5'])

  // Shift-click extends; dragging the selected rows' numbers moves them.
  await rowNumber(page, 0).click()
  await rowNumber(page, 1).click({ modifiers: ['Shift'] })
  await rowNumber(page, 0).dragTo(rowNumber(page, 3))
  expect(await values()).toEqual(['3', '4', '1', '2', '5'])
  await expect(tool(page, 'Undo Move rows')).toBeEnabled()
  await expect(rowNumber(page, 2)).toHaveClass(/\bsel\b/)
  await expect(rowNumber(page, 3)).toHaveClass(/\bsel\b/)

  // Insert rows: as many as are selected, above them.
  await runMenu(page, 'Edit', 'Insert 2 rows')
  expect(await values()).toEqual(['3', '4', '', '', '1'])
  await pressShortcut(page, 'Mod+Z')
  await pressShortcut(page, 'Mod+Z')
  expect(await values()).toEqual(['1', '2', '3', '4', '5'])
})

test('dragging a column header, moving and inserting columns', async ({ page }) => {
  await newTable(page, { kind: 'XY', dataSets: 3, replicates: 1 })
  await typeCells(page, 0, 0, [['1', '10', '20', '30']])
  await expect(columnTitles(page)).toHaveText(['Row', 'X', 'Group A', 'Group B', 'Group C'])

  await columnTitles(page).nth(2).dragTo(columnTitles(page).nth(4))
  await expect(columnTitles(page)).toHaveText(['Row', 'X', 'Group B', 'Group C', 'Group A'])
  await expect(rowCells(page, 0)).toHaveText(['1', '20', '30', '10'])
  await expect(tool(page, 'Undo Move column')).toBeEnabled()

  // Move column left on the selection; X can't move.
  await columnTitles(page).nth(4).click()
  await runMenu(page, 'Edit', 'Move column left')
  await expect(columnTitles(page)).toHaveText(['Row', 'X', 'Group B', 'Group A', 'Group C'])
  await columnTitles(page).nth(1).dragTo(columnTitles(page).nth(3))
  await expect(columnTitles(page)).toHaveText(['Row', 'X', 'Group B', 'Group A', 'Group C'])

  // Insert column: before the selected one.
  await cell(page, 0, 2).click()
  await runMenu(page, 'Edit', 'Insert column')
  await expect(columnTitles(page)).toHaveText([
    'Row',
    'X',
    'Group B',
    'Group D',
    'Group A',
    'Group C',
  ])
  for (let i = 0; i < 3; i++) await pressShortcut(page, 'Mod+Z')
  await expect(columnTitles(page)).toHaveText(['Row', 'X', 'Group A', 'Group B', 'Group C'])
  await expect(rowCells(page, 0)).toHaveText(['1', '10', '20', '30'])
})

test('fill down, fill right and fill series', async ({ page }) => {
  await newTable(page, { kind: 'Column' })
  await typeCells(page, 0, 0, [['5']])
  await cell(page, 0, 0).click()
  await cell(page, 3, 0).click({ modifiers: ['Shift'] })
  await pressShortcut(page, 'Mod+D')
  expect(await firstColumn(page, 5)).toEqual(['5', '5', '5', '5', ''])
  await expect(tool(page, 'Undo Fill down')).toBeEnabled()

  await cell(page, 1, 0).click()
  await cell(page, 1, 2).click({ modifiers: ['Shift'] })
  await pressShortcut(page, 'Mod+R')
  await expect(rowCells(page, 1)).toHaveText(['5', '5', '5'])

  // A series of 1:2 dilutions down the second column, 4 rows from the selected cell.
  await cell(page, 0, 1).click()
  await runMenu(page, 'Edit', 'Fill series…')
  const d = dialog(page, 'Fill series')
  await d.getByLabel('Series').selectOption('multiply')
  await d.getByLabel('Start').fill('100')
  await d.getByLabel('Factor').fill('0.5')
  await d.getByLabel('Number of rows').fill('4')
  await expect(d.getByText('100, 50, 25, 12.5')).toBeVisible()
  await d.getByRole('button', { name: 'Fill' }).click()
  await expect(d).toBeHidden()
  expect(await firstColumn(page, 5, 1)).toEqual(['100', '50', '25', '12.5', ''])
  await pressShortcut(page, 'Mod+Z')
  expect(await firstColumn(page, 5, 1)).toEqual(['', '5', '', '', ''])
})

test('find and replace, with Replace all as one undo step', async ({ page }) => {
  await newTable(page, { kind: 'Column', dataSets: 2 })
  await typeCells(page, 0, 0, [
    ['1.5', '2.5'],
    ['11', '3'],
  ])
  await pressShortcut(page, 'Mod+F')
  const bar = page.getByRole('search', { name: 'Find and replace' })
  const find = bar.getByRole('searchbox', { name: 'Find' })
  await expect(find).toBeFocused()
  await find.fill('1')
  await expect(bar.getByText('1 of 2')).toBeVisible()
  await expect(grid(page).locator('td.match')).toHaveCount(2)
  await expect(cell(page, 0, 0)).toHaveClass(/\bmatch-current\b/)
  await find.press('Enter')
  await expect(bar.getByText('2 of 2')).toBeVisible()
  await expect(cell(page, 1, 0)).toHaveClass(/\bmatch-current\b/)
  await pressShortcut(page, 'Mod+Shift+G')
  await expect(bar.getByText('1 of 2')).toBeVisible()

  // Titles are found too.
  await find.fill('group b')
  await expect(columnTitles(page).nth(2)).toHaveClass(/\bmatch-current\b/)

  // Numbers stay numbers.
  await find.fill('1')
  const replace = bar.getByRole('textbox', { name: 'Replace with' })
  await replace.fill('x')
  await bar.getByRole('button', { name: 'Replace all' }).click()
  await expect(toast(page)).toContainText('"x.5" is not a number.')
  await replace.fill('7')
  await bar.getByRole('button', { name: 'Replace all' }).click()
  await expect(bar.getByText('2 replaced')).toBeVisible()
  await expectRows(page, [
    ['7.5', '2.5'],
    ['77', '3'],
  ])
  await find.press('Escape')
  await expect(bar).toBeHidden()
  await expect(tool(page, 'Undo Replace all')).toBeEnabled()
  await pressShortcut(page, 'Mod+Z')
  await expectRows(page, [
    ['1.5', '2.5'],
    ['11', '3'],
  ])
})

test('column number format and width', async ({ page }) => {
  await newTable(page, { kind: 'Column', dataSets: 2 })
  await typeCells(page, 0, 0, [['1234.5678'], ['0.25']])
  const header = columnTitles(page).nth(1)
  await headerMenu(page, header, 'Format column…')
  const d = dialog(page, 'Format column')
  await d.getByLabel('Numbers').selectOption('fixed')
  await d.getByLabel('Decimals').fill('1')
  await d.getByRole('checkbox', { name: /Group thousands/ }).check()
  await expect(d.getByTestId('format-preview')).toHaveText('1,234.6')
  await d.getByRole('button', { name: 'OK' }).click()
  await expect(d).toBeHidden()
  expect(await firstColumn(page, 2)).toEqual(['1,234.6', '0.3'])
  // Editing shows the value in full.
  await cell(page, 0, 0).dblclick()
  await expect(grid(page).getByRole('textbox')).toHaveValue('1234.5678')
  await page.keyboard.press('Escape')

  // Widths: drag the header's right edge, double-click it to fit the content.
  const width = async () => (await header.boundingBox())!.width
  const before = await width()
  const edge = header.locator('.col-resize')
  const box = (await edge.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 120, box.y + box.height / 2, { steps: 4 })
  await page.mouse.up()
  await expect.poll(width).toBeGreaterThan(before + 80)
  await expect(tool(page, 'Undo Resize column')).toBeEnabled()
  await edge.dblclick()
  await expect.poll(width).toBeLessThan(before + 40)
  await expect(tool(page, 'Undo Fit column')).toBeEnabled()
  await pressShortcut(page, 'Mod+Z')
  await expect.poll(width).toBeGreaterThan(before + 80)
})

test('keyboard: jumps to the data’s edges, Home / End, extending with Shift', async ({ page }) => {
  await newTable(page, { kind: 'Column' })
  await typeCells(page, 0, 0, [['1'], ['2'], ['3']])
  await cell(page, 0, 0).click()
  await pressShortcut(page, 'Mod+ArrowDown')
  expect(await focused(page)).toEqual({ r: 2, c: 0 })
  // Past the data: the table's last row.
  await pressShortcut(page, 'Mod+ArrowDown')
  expect(await focused(page)).toEqual({ r: 9, c: 0 })
  await pressShortcut(page, 'Mod+ArrowUp')
  expect(await focused(page)).toEqual({ r: 2, c: 0 })
  await pressShortcut(page, 'Mod+Shift+ArrowUp')
  expect(await focused(page)).toEqual({ r: 0, c: 0 })
  await expect(grid(page).locator('td.sel')).toHaveCount(3)
  await page.keyboard.press('End')
  expect(await focused(page)).toEqual({ r: 0, c: 2 })
  await page.keyboard.press('Home')
  expect(await focused(page)).toEqual({ r: 0, c: 0 })
  await pressShortcut(page, 'Mod+End')
  expect(await focused(page)).toEqual({ r: 9, c: 2 })
  await pressShortcut(page, 'Mod+Home')
  expect(await focused(page)).toEqual({ r: 0, c: 0 })
  await page.keyboard.press('PageDown')
  expect((await focused(page)).r).toBeGreaterThan(5)
})
