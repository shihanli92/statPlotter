import type { Locator, Page } from '@playwright/test'
import { expect, openExample, test } from './fixtures.ts'
import {
  cell,
  chip,
  columnTitles,
  dialog,
  expectUpToDate,
  grid,
  newTable,
  okButton,
  pressShortcut,
  resultTable,
  resultValue,
  runMenu,
  typeCells,
} from './helpers-data.ts'
import { canvas, expectUndo, marks, openSheet, pointMarks, sheet } from './helpers-graph.ts'

// Roadmap 38, data manipulation: Swap X and Y with undo; a transform of variables within groups;
// the new formula functions in the formula bar (autocomplete, the functions' reference); a
// filter built in the condition editor following an edit of its source; an aggregate by group,
// graphed and frozen; recoded and binned variables used as colours.

const TRIAL = 'Blood pressure trial'
const manipulate = (page: Page, item: string) => runMenu(page, 'Analyze', 'Data manipulation', item)

async function trial(page: Page) {
  await openExample(page, 'multiple-variables')
  await openSheet(page, TRIAL, 'Data Tables')
  await expect(grid(page)).toBeVisible()
}

/** The grid column (0-based, row titles first) of a variable by its title. */
async function columnOf(page: Page, title: string): Promise<number> {
  let i = -1
  // Polled: a variable just added may not be drawn yet. The first header is the row numbers'
  // corner.
  await expect
    .poll(
      async () => {
        const titles = await columnTitles(page).allTextContents()
        i = titles.findIndex((t) => t.replace(/\s*(abc|ƒx)\s*$/, '').trim() === title)
        return i
      },
      { message: `column ${title}` },
    )
    .toBeGreaterThan(0)
  return i - 1
}

const mapping = (b: Locator) => b.getByRole('group', { name: 'Map variables' })
async function map(b: Locator, field: 'X' | 'Y' | 'Colour', label: string) {
  await mapping(b).getByLabel(field, { exact: true }).selectOption({ label })
}

test('Swap X and Y of an XY table, and undo', async ({ page }) => {
  await page.goto('/')
  await newTable(page, { kind: 'XY', replicates: 1 })
  await typeCells(page, 0, 0, [
    ['1', '10'],
    ['2', '20'],
    ['3', '30'],
  ])
  await expect(cell(page, 2, 1)).toHaveText('30')
  await manipulate(page, 'Swap X and Y…')
  const d = dialog(page, 'Swap X and Y')
  await expect(d.getByText(/becomes X/)).toBeVisible()
  await d.getByRole('button', { name: 'Swap', exact: true }).click()
  await expect(d).toBeHidden()
  await expect(cell(page, 0, 0)).toHaveText('10')
  await expect(cell(page, 0, 1)).toHaveText('1')
  await expect(cell(page, 2, 0)).toHaveText('30')
  await expectUndo(page, 'Swap X and Y')
  await pressShortcut(page, 'Mod+Z')
  await expect(cell(page, 0, 0)).toHaveText('1')
  await expect(cell(page, 0, 1)).toHaveText('10')
})

test('Transform variables within the groups of a text variable', async ({ page }) => {
  await trial(page)
  await manipulate(page, 'Transform variables…')
  const d = dialog(page, 'Transform variables')
  // Shown (its code may still be loading, audit 2 P8) before its boxes are listed.
  await expect(d).toBeVisible()
  for (const box of await d.getByRole('checkbox').all()) await box.uncheck()
  await d.getByRole('checkbox', { name: 'SBP before', exact: true }).check()
  await d
    .getByLabel('Transform', { exact: true })
    .selectOption({ label: 'z-score, (x − mean) / SD' })
  await d.getByLabel('Within each group of').selectOption({ label: 'Group' })
  await expect(d.getByText('=zscore([SBP before], Group)', { exact: true })).toBeVisible()
  await d.getByRole('button', { name: 'Add variables' }).click()
  await expect(d).toBeHidden()
  const c = await columnOf(page, 'SBP before z by Group')
  await cell(page, 0, c).click()
  await expect(page.getByRole('textbox', { name: 'Formula' })).toHaveValue(
    '=zscore([SBP before], Group)',
  )
  // Each group's z-scores: numbers, none invalid.
  await expect(cell(page, 0, c)).toHaveText(/^-?\d/)
  await expectUndo(page, 'Transform variable')
})

test('new formula functions in the formula bar, with suggestions and a reference', async ({
  page,
}) => {
  await trial(page)
  await page.getByRole('button', { name: '+ Calculated variable' }).click()
  await page.getByRole('textbox', { name: 'Name of the new variable' }).fill('SBP rank')
  const formula = page.getByRole('textbox', { name: 'Formula' })
  await formula.click()
  await formula.press('End')
  await page.keyboard.type('ran')
  const list = page.locator('.formula-suggestions')
  await expect(list.getByRole('option').first()).toContainText('rank(x[, ties[, group…]])')
  await page.keyboard.press('Tab')
  await expect(formula).toHaveValue('=rank(')
  await page.keyboard.type('[SBP before], "min", Group)')
  await page.keyboard.press('Enter')
  const c = await columnOf(page, 'SBP rank')
  // Ranks within each arm of 12 patients.
  await expect(cell(page, 0, c)).toHaveText(/^([1-9]|1[0-2])$/)
  // The functions' reference lists every function by kind.
  await page.getByRole('button', { name: 'Formula functions' }).click()
  const ref = page.getByRole('dialog', { name: 'Formula functions' })
  await expect(ref.getByRole('heading', { name: 'Statistics' })).toBeVisible()
  await expect(ref.getByRole('button', { name: 'quantile(x, p[, type[, group…]])' })).toBeVisible()
  await expect(ref.getByRole('button', { name: /^concat\(/ })).toBeVisible()
  await ref.getByRole('button', { name: 'Close the functions' }).click()
  await expect(ref).toBeHidden()
  // A text formula is a text variable.
  await page.getByRole('button', { name: '+ Calculated variable' }).click()
  await page.getByRole('textbox', { name: 'Name of the new variable' }).fill('Arm')
  await formula.fill('=concat(upper(left(Group, 1)), "-", Sex)')
  await formula.press('Enter')
  const arm = await columnOf(page, 'Arm')
  await expect(cell(page, 0, arm)).toHaveText(/^[PLH]-[FM]$/)
})

test('Filter rows built in the condition editor follows its source', async ({ page }) => {
  await trial(page)
  await manipulate(page, 'Filter rows…')
  const d = dialog(page, /^Analyze “/)
  const editor = d.getByRole('group', { name: 'Keep the rows where' })
  await editor.getByLabel('Variable', { exact: true }).selectOption({ label: 'Group' })
  await editor.getByLabel('Value', { exact: true }).fill('Placebo')
  await editor.getByRole('button', { name: '+ And' }).click()
  await editor.getByLabel('Variable', { exact: true }).nth(1).selectOption({ label: 'SBP before' })
  await editor.getByLabel('Operator', { exact: true }).nth(1).selectOption({ label: '>' })
  await editor.getByLabel('Value', { exact: true }).nth(1).fill('0')
  await expect(
    editor.getByText('Formula: Group = "Placebo" and [SBP before] > 0', { exact: true }),
  ).toBeVisible()
  await okButton(d).click()
  await expect(d).toBeHidden()
  await expectUpToDate(page)
  // The filtered table first, then what was done.
  await expect(grid(page)).toBeVisible()
  await page.getByRole('tab', { name: 'Filter rows' }).click()
  await expect(resultValue(resultTable(page, 'Filter rows'), 'Rows kept')).toHaveText('12')
  // An edit of the source reaches it: the first patient moves to another arm.
  await openSheet(page, TRIAL, 'Data Tables')
  await typeCells(page, 0, await columnOf(page, 'Group'), [['Low dose']])
  await expect(cell(page, 0, await columnOf(page, 'Group'))).toHaveText('Low dose')
  await openSheet(page, 'Filter rows of Blood pressure trial', 'Results')
  await page.getByRole('tab', { name: 'Filter rows' }).click()
  await expect(resultValue(resultTable(page, 'Filter rows'), 'Rows kept')).toHaveText('11')
})

test('Aggregate by group, graphed, then frozen as a data table', async ({ page }) => {
  await trial(page)
  await manipulate(page, 'Aggregate by group…')
  const d = dialog(page, /^Analyze “/)
  // Grouped by Group only (Sex left out of the data sets analyzed: its chip, roadmap 51b).
  await chip(d, 'Sex').click()
  await expect(chip(d, 'Sex')).toHaveAttribute('aria-selected', 'false')
  await d.getByRole('checkbox', { name: 'Median', exact: true }).check()
  await okButton(d).click()
  await expect(d).toBeHidden()
  await expectUpToDate(page)
  await page.getByRole('tab', { name: 'Aggregate' }).click()
  await expect(resultValue(resultTable(page, 'Aggregate by group'), 'Groups')).toHaveText('3')
  await page.getByRole('tab', { name: 'Data table' }).click()
  await expect(grid(page)).toBeVisible()
  // One row per arm, ready to graph.
  await runMenu(page, 'Analyze', 'Graph this table…')
  const b = dialog(page, /^(New|Another) graph of/)
  await map(b, 'X', 'Group (text)')
  await map(b, 'Y', 'SBP before mean (number)')
  await b.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(b).toBeHidden()
  const svg = canvas(page)
  await expect(svg).toBeVisible()
  await expect(marks(svg, 'axis/x/tickLabel/')).toHaveCount(3)
  // Freeze: an editable copy, one undo step.
  await openSheet(page, 'Aggregate by group of Blood pressure trial', 'Results')
  await runMenu(page, 'Analyze', 'Freeze as data table')
  await expect(
    sheet(page, 'Aggregate by group of Blood pressure trial (frozen)', 'Data Tables'),
  ).toBeVisible()
  await expect(grid(page)).toHaveAccessibleName(
    'Aggregate by group of Blood pressure trial (frozen)',
  )
  await typeCells(page, 0, 1, [['99']])
  await expect(cell(page, 0, 1)).toHaveText('99')
  await pressShortcut(page, 'Mod+Z')
  await expectUndo(page, 'Freeze as data table')
})

test('recoded and binned variables colour a graph', async ({ page }) => {
  await trial(page)
  await manipulate(page, 'Recode levels…')
  const r = dialog(page, 'Recode levels')
  await r.getByLabel('Text variable').selectOption({ label: 'Group' })
  await r.getByLabel('New level for Placebo').fill('Control')
  await r.getByLabel('New level for Low dose').fill('Treated')
  await r.getByLabel('New level for High dose').fill('Treated')
  await expect(r.getByRole('status', { name: 'Levels' })).toContainText('Control (12)')
  await r.getByRole('button', { name: 'Add variable' }).click()
  await expect(r).toBeHidden()
  await expect(cell(page, 0, await columnOf(page, 'Group (recoded)'))).toHaveText('Control')

  await manipulate(page, 'Bin a variable…')
  const bin = dialog(page, 'Bin a variable')
  await bin.getByLabel('Number variable').selectOption({ label: 'Age' })
  await bin.getByLabel('Number of intervals').fill('2')
  await bin.getByLabel(/^Labels/).fill('younger, older')
  await expect(bin.getByRole('status', { name: 'Levels' })).toContainText('younger')
  await bin.getByRole('button', { name: 'Add variable' }).click()
  await expect(bin).toBeHidden()
  await expect(cell(page, 0, await columnOf(page, 'Age bins'))).toHaveText(/^(younger|older)$/)

  for (const [colour, levels] of [
    ['Group (recoded) (text)', ['Control', 'Treated']],
    ['Age bins (text)', ['younger', 'older']],
  ] as const) {
    await openSheet(page, TRIAL, 'Data Tables')
    await runMenu(page, 'Insert', 'New graph…')
    const b = dialog(page, /^(New|Another) graph of/)
    await map(b, 'X', 'SBP before (number)')
    await map(b, 'Y', 'SBP after (number)')
    await map(b, 'Colour', colour)
    await b.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(b).toBeHidden()
    const svg = canvas(page)
    await expect(pointMarks(svg).first()).toBeAttached()
    for (const level of levels)
      await expect(marks(svg, 'legend/').filter({ hasText: new RegExp(`^${level}$`) })).toHaveCount(
        1,
      )
  }
  // Swap X and Y of the graph of variables: one step.
  await runMenu(page, 'Format', 'Swap X and Y')
  await expectUndo(page, 'Swap X and Y')
})
