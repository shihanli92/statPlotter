import type { Page } from '@playwright/test'
import { expect, openExample, test } from './fixtures.ts'
import {
  analyze,
  cell,
  dialog,
  expectUpToDate,
  newTable,
  pasteText,
  pressShortcut,
  resultRow,
  resultTable,
  resultValue,
  runMenu,
  sheet,
  toast,
  tool,
  typeCells,
} from './helpers-data.ts'
import { openSheet } from './helpers-graph.ts'

// Representative analyses per table kind, run from the Analyze dialog. Tables start from the
// New data table dialog's sample data (fixed values, packages/ui/src/samples.ts); the numbers
// checked here were computed from the same values in R 4 (t.test, aov + TukeyHSD, lm / anova,
// nls, survdiff, fisher.test, chisq.test), as the unit tests' oracles do.

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

/** The toolbar's Parameters… of the open results: the Analyze dialog in edit mode. */
async function editParameters(page: Page) {
  await page.getByRole('main').getByRole('button', { name: 'Parameters…' }).click()
  const d = dialog(page, 'Analysis parameters')
  await expect(d).toBeVisible()
  return d
}

test('t test: results, parameters edited, recomputed after a data edit', async ({ page }) => {
  await newTable(page, { kind: 'Column', sample: true })
  await analyze(page, 't test')
  await expect(sheet(page, 't test of Data 1', 'Results')).toHaveClass(/\bon\b/)
  const test = resultTable(page, 'Unpaired t test')
  // R: t.test(Treated, Control, var.equal = TRUE): t = 6.1686, df = 14, p = 2.441e-05.
  await expect(resultValue(test, 't')).toHaveText('6.169')
  await expect(resultValue(test, 'df')).toHaveText('14')
  await expect(resultValue(test, 'P value')).toHaveText('<0.0001')
  const diff = resultTable(page, 'How big is the difference?')
  await expect(resultValue(diff, 'Difference between means (B − A)')).toHaveText('12.66')
  await expect(resultValue(diff, '95% confidence interval')).toHaveText('8.260 to 17.07')

  // Welch's t test (R: df = 13.948).
  const d = await editParameters(page)
  await d.getByRole('checkbox', { name: /^Assume both populations have the same SD/ }).uncheck()
  await d.getByRole('button', { name: 'OK' }).click()
  await expectUpToDate(page)
  const welch = resultTable(page, 'Unpaired t test with Welch’s correction')
  await expect(welch).toBeVisible()
  await expect(resultValue(welch, 'df')).toHaveText('13.95')
  await expect(tool(page, 'Undo Change analysis')).toBeEnabled()
  await pressShortcut(page, 'Mod+Z')
  await expect(resultValue(resultTable(page, 'Unpaired t test'), 'df')).toHaveText('14')

  // Editing a value of the table recomputes the results (R: t = 4.8626, difference 11.41).
  await runMenu(page, 'View', 'Go to data table')
  await typeCells(page, 0, 0, [['44.1']])
  await runMenu(page, 'View', 'Go to results')
  await expectUpToDate(page)
  await expect(resultValue(resultTable(page, 'Unpaired t test'), 't')).toHaveText('4.863')
  await expect(resultValue(diff, 'Difference between means (B − A)')).toHaveText('11.41')

  // So does excluding one (R, without Control's 38.5: t = 6.1819, df = 13).
  await runMenu(page, 'View', 'Go to data table')
  await pressShortcut(page, 'Mod+Z')
  await cell(page, 1, 0).click()
  await pressShortcut(page, 'Mod+E')
  await runMenu(page, 'View', 'Go to results')
  await expectUpToDate(page)
  await expect(resultValue(resultTable(page, 'Unpaired t test'), 't')).toHaveText('6.182')
  await expect(resultValue(resultTable(page, 'Data analyzed'), 'Sample size, column A')).toHaveText(
    '7',
  )
})

test('one-way ANOVA with Tukey comparisons, and brackets on the graph', async ({
  page,
  browserName,
}) => {
  await newTable(page, { kind: 'Column' })
  await cell(page, 0, 0).click()
  await pasteText(
    page,
    '4.2\t5.6\t4.9\n4.8\t6.1\t5.2\n5.1\t5.9\t5.0\n4.5\t6.3\t5.4\n4.9\t5.8\t5.3',
    {
      browserName,
    },
  )
  await expect(cell(page, 4, 2)).toHaveText('5.3')
  await analyze(page, 'One-way ANOVA (and nonparametric)')

  // R: aov: F(2, 12) = 24.46, p = 5.85e-05.
  const anova = resultTable(page, 'Ordinary one-way ANOVA')
  await expect(resultValue(anova, 'F')).toHaveText('24.46')
  await expect(resultValue(anova, 'DFn, DFd')).toHaveText('2, 12')
  await expect(resultValue(anova, 'P value')).toHaveText('<0.0001')

  // R: TukeyHSD: B−A p = 4.44e-05, C−A p = 0.0597, C−B p = 0.00251.
  await page.getByRole('tab', { name: 'Multiple comparisons' }).click()
  await expect(page.getByRole('tab', { name: 'Multiple comparisons' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  const tukey = resultTable(page, 'Tukey’s multiple comparisons test')
  await expect(resultRow(tukey, 'Group A vs. Group B')).toHaveText([
    'Group A vs. Group B',
    '-1.240',
    '-1.718 to -0.7618',
    'Yes',
    '****',
    '<0.0001',
  ])
  await expect(resultRow(tukey, 'Group A vs. Group C').last()).toHaveText('0.0597')
  await expect(resultRow(tukey, 'Group B vs. Group C').last()).toHaveText('0.0025')

  // Brackets for the significant comparisons, added to the table's graph in one undo step.
  await page.getByRole('button', { name: 'Add brackets to “Data 1”' }).click()
  await expect(tool(page, 'Undo Add significance brackets')).toBeEnabled()
  await page.getByRole('button', { name: 'Add brackets to “Data 1”' }).click()
  await expect(toast(page)).toContainText('No new comparisons to add to “Data 1”')
  await runMenu(page, 'View', 'Go to graph')
  const graph = page.getByRole('main').getByRole('img', { name: 'Graph' })
  await expect(graph).toContainText('****')
  await expect(graph).toContainText('**')
  await pressShortcut(page, 'Mod+Z')
  await expect(graph).not.toContainText('*')
})

test('two-way ANOVA on a grouped table, then main effects only', async ({ page }) => {
  await newTable(page, { kind: 'Grouped', sample: true })
  await analyze(page, 'Two-way ANOVA')
  // R: anova(lm(y ~ row * column)): F = 26.197 (interaction), 60.167 (rows), 201.42 (columns).
  const table = resultTable(page, 'ANOVA table')
  await expect(resultRow(table, 'Interaction').nth(4)).toHaveText('F (2, 18) = 26.20')
  await expect(resultRow(table, 'Row factor').nth(4)).toHaveText('F (2, 18) = 60.17')
  await expect(resultRow(table, 'Column factor').nth(4)).toHaveText('F (1, 18) = 201.4')
  await expect(page.getByRole('tab', { name: 'Multiple comparisons' })).toBeVisible()

  // Analyze › Edit parameters… (the same dialog as the view's Parameters… button).
  await runMenu(page, 'Analyze', 'Edit parameters…')
  const d = dialog(page, 'Analysis parameters')
  await d.getByRole('radio', { name: /^Main effects only/ }).check()
  await d.getByRole('button', { name: 'OK' }).click()
  await expectUpToDate(page)
  await expect(resultRow(table, 'Interaction')).toHaveCount(0)
  await expect(resultRow(table, 'Row factor').nth(2)).toHaveText('2')
})

test('nonlinear regression of dose-response curves; confidence level edited', async ({ page }) => {
  await newTable(page, { kind: 'XY', sample: true })
  await analyze(page, 'Nonlinear regression (curve fit)')
  // R: nls of the four-parameter logistic: LogEC50 = −7.2032 and −6.1091, HillSlope 1.0869, 1.0932.
  const best = resultTable(page, 'Best-fit values')
  await expect(resultRow(best, 'LogEC50')).toHaveText(['LogEC50', '-7.203', '-6.109'])
  await expect(resultRow(best, 'HillSlope')).toHaveText(['HillSlope', '1.087', '1.093'])
  await expect(resultRow(resultTable(page, 'Fit'), 'Status')).toHaveText([
    'Status',
    'Converged',
    'Converged',
  ])
  await expect(resultTable(page, '95% CI (asymptotic)')).toBeVisible()

  const d = await editParameters(page)
  // The last of the form's two "Confidence level" fields is the fit's.
  await d.getByRole('combobox', { name: 'Confidence level' }).last().selectOption({ label: '90%' })
  await d.getByRole('button', { name: 'OK' }).click()
  await expectUpToDate(page)
  await expect(resultTable(page, '90% CI (asymptotic)')).toBeVisible()
  await expect(resultTable(page, '95% CI (asymptotic)')).toHaveCount(0)
  // The fitted curves are drawn on the table's graph.
  await runMenu(page, 'View', 'Go to graph')
  await expect(page.getByRole('main').getByRole('img', { name: 'Graph' })).toBeVisible()
})

test('survival curves: log-rank test and survival proportions', async ({ page }) => {
  await newTable(page, { kind: 'Survival', sample: true })
  await analyze(page, 'Survival curves')
  // R: survdiff: chi-square = 3.55 on 1 df, p = 0.06.
  const logRank = resultTable(page, 'Log-rank (Mantel-Cox) test')
  await expect(resultValue(logRank, 'Chi square')).toHaveText('3.554')
  await expect(resultValue(logRank, 'P value')).toHaveText('0.0594')
  await expect(resultRow(resultTable(page, 'Median survival'), 'Control').nth(1)).toHaveText(
    '44.00',
  )
  await page.getByRole('tab', { name: 'Survival proportions' }).click()
  await expect(page.getByRole('main').getByRole('table').first()).toBeVisible()
  await expect(logRank).toHaveCount(0)
})

test('contingency table: Fisher’s exact test, then chi-square', async ({ page }) => {
  await newTable(page, { kind: 'Contingency', sample: true })
  await analyze(page, 'Chi-square (and Fisher’s exact) test')
  // R: fisher.test: p = 0.01715.
  await expect(resultValue(resultTable(page, 'Fisher’s exact test'), 'P value')).toHaveText(
    '0.0171',
  )
  await expect(
    resultValue(
      resultTable(page, 'Relative risk of “Progressed”, Treated vs. Placebo'),
      'Relative risk',
    ),
  ).toHaveText('0.5000')

  // R: chisq.test(correct = FALSE): X² = 6.4516, p = 0.01109.
  const d = await editParameters(page)
  await d.getByRole('radio', { name: 'Chi-square test' }).check()
  await d.getByRole('button', { name: 'OK' }).click()
  await expectUpToDate(page)
  const chi = resultTable(page, 'Chi-square test')
  await expect(resultValue(chi, 'Chi-square')).toHaveText('6.452')
  await expect(resultValue(chi, 'P value')).toHaveText('0.0111')
  await page.getByRole('tab', { name: 'Expected counts' }).click()
  await expect(page.getByRole('main').getByRole('table').first()).toContainText('22.50')
})

test('multiple linear regression on a multiple-variables table', async ({ page }) => {
  await newTable(page, { kind: 'Multiple variables', sample: true })
  await analyze(page, 'Multiple linear regression', async (d) => {
    await d.getByRole('combobox', { name: 'Dependent (Y) variable' }).selectOption({ label: 'SBP' })
  })
  const params = resultTable(page, 'Multiple linear regression: SBP')
  await expect(params).toBeVisible()
  for (const v of ['Intercept', 'Age', 'BMI', 'Dose'])
    await expect(resultRow(params, v)).not.toHaveCount(0)
  const fit = resultTable(page, 'Goodness of fit')
  await expect(resultValue(fit, 'R squared')).toHaveText(/^0\.\d{4}$/)
  await expect(
    resultValue(resultTable(page, 'Data analyzed'), 'Number of rows analyzed'),
  ).toHaveText('40')
})

// Roadmap 43 (UX review F20): the common analyses of the table's kind first, then every one by
// category; a search box filters by names and keywords, ↑ / ↓ and Enter pick.
test('the Analyze dialog: the Common group first, a search picked with Enter', async ({ page }) => {
  await newTable(page, { kind: 'Column', sample: true })
  await tool(page, 'Analyze…').click()
  const d = dialog(page, /^Analyze “/)
  const list = d.getByRole('listbox', { name: 'Analyses' })
  await expect(list.getByRole('group').first()).toHaveAccessibleName('Common')
  await expect(list.getByRole('group', { name: 'Common' }).getByRole('option')).toHaveText([
    't test',
    'One-way ANOVA (and nonparametric)',
    'Descriptive statistics',
    'Normality and lognormality tests',
  ])
  // The full list by category below.
  await expect(
    list.getByRole('group', { name: 'Column analyses' }).getByRole('option', { name: 't test' }),
  ).toBeVisible()
  const search = d.getByRole('combobox', { name: 'Search analyses' })
  await expect(search).toBeFocused()
  await page.keyboard.type('anova')
  await expect(list.getByRole('group')).toHaveCount(1)
  await expect(list.getByRole('option').first()).toHaveText('One-way ANOVA (and nonparametric)')
  await page.keyboard.press('Enter')
  await expect(list.getByRole('option', { selected: true })).toHaveText(
    'One-way ANOVA (and nonparametric)',
  )
  // ↓ moves through the matches, the one shown is the one picked until Enter.
  await page.keyboard.press('ArrowDown')
  await expect(search).toHaveAttribute('aria-activedescendant', /.+/)
  await expect(list.getByRole('option', { selected: true })).toHaveText(
    'One-way ANOVA (and nonparametric)',
  )
  await search.fill('zzz')
  await expect(d.getByText('No analysis matches “zzz”.')).toBeVisible()
  await expect(search).toHaveAttribute('aria-expanded', 'false')
  await search.fill('')
  await d.getByRole('button', { name: 'OK', exact: true }).click()
  await expectUpToDate(page)
  await expect(sheet(page, 'One-way ANOVA (and nonparametric) of Data 1', 'Results')).toHaveClass(
    /\bon\b/,
  )
})

// Roadmap 43 (UX review F22): an analysis short of values says what it needs and links to its
// table.
test('a results error: what the analysis needs, and Go to table', async ({ page }) => {
  await newTable(page, { kind: 'Column', dataSets: 2 })
  await typeCells(page, 0, 0, [['1', '2']])
  await analyze(page, 't test')
  const error = page.getByRole('main').locator('.results-error')
  await expect(error).toContainText('Each group needs at least two values.')
  await expect(error).toContainText('A t test compares two data sets (columns)')
  await error.getByRole('button', { name: 'Go to table' }).click()
  await expect(sheet(page, 'Data 1', 'Data Tables')).toHaveClass(/\bon\b/)
  await expect(page.getByRole('main').getByRole('grid')).toBeVisible()
})

test('descriptive statistics of a column table', async ({ page }) => {
  await newTable(page, { kind: 'Column', sample: true })
  await analyze(page, 'Descriptive statistics')
  // R: mean 34.85 / 47.5125, sd 3.978 / 4.229, median 34.85 / 47.85.
  const main = page.getByRole('main')
  await expect(main.getByRole('row', { name: /^Mean\s/ }).first()).toHaveText(/34\.85\s*47\.51/)
  await expect(main.getByRole('row', { name: /^Std\. Deviation\s/ })).toHaveText(/3\.978\s*4\.229/)
  await expect(main.getByRole('row', { name: /^Median\s/ })).toHaveText(/34\.85\s*47\.85/)
})

test('nested t test and fraction of total', async ({ page }) => {
  await newTable(page, { kind: 'Nested', sample: true })
  await analyze(page, 'Nested t test')
  const nested = resultTable(page, 'Nested t test')
  await expect(resultValue(nested, 't, df')).toHaveText('t = 3.266, df = 4')
  await expect(resultValue(nested, 'P value')).toHaveText('0.0309')

  await newTable(page, { kind: 'Parts of whole', sample: true })
  await analyze(page, 'Fraction of total')
  // Blood: 412 / 900 T cells.
  await expect(resultRow(resultTable(page, 'Fraction of column total'), 'T cells')).toHaveText([
    'T cells',
    '0.4578',
    '0.3550',
  ])
})

test('a simulation with no table open, then a Monte Carlo analysis of it', async ({ page }) => {
  // No table: the simulation gets one of its own, in the same undo step.
  await runMenu(page, 'Analyze', 'Simulate column data…')
  const sim = dialog(page, /^Analyze “/)
  await expect(sim.getByRole('group', { name: 'Data sets to analyze' })).toHaveCount(0)
  await sim.getByRole('textbox', { name: 'Values in column 1' }).fill('6')
  await sim.getByRole('textbox', { name: 'Values in column 1' }).blur()
  await sim.getByRole('button', { name: 'OK' }).click()
  await expectUpToDate(page)
  await expect(sheet(page, 'Simulate column data', 'Results')).toHaveClass(/\bon\b/)
  await expect(sheet(page, 'Data 1', 'Data Tables')).toBeVisible()
  // The simulated table, 6 values in A and 10 in B.
  const simulated = page.getByRole('main').getByRole('grid', { name: 'Simulate column data' })
  await expect(simulated.getByRole('columnheader', { name: 'A', exact: true })).toBeVisible()
  await expect(simulated.getByRole('rowgroup').nth(1).getByRole('row')).toHaveCount(10)
  await expect(
    simulated.getByRole('rowgroup').nth(1).getByRole('row').nth(6).getByRole('cell').first(),
  ).toHaveText('')

  // Monte Carlo: repeat the simulation and a t test; tabulate P values and hits.
  await runMenu(page, 'Analyze', 'Monte Carlo analysis…')
  const mc = dialog(page, /^Analyze “/)
  await mc.getByRole('textbox', { name: 'Number of simulations' }).fill('50')
  await mc.getByRole('textbox', { name: 'Number of simulations' }).blur()
  await mc.getByRole('button', { name: 'OK' }).click()
  await expectUpToDate(page)
  const runs = page.getByRole('main').getByRole('grid', { name: /^Monte Carlo analysis of / })
  await expect(runs.getByRole('columnheader', { name: 'Hit (1 = yes)' })).toBeVisible()
  await page.getByRole('tab', { name: 'Monte Carlo' }).click()
  await expect(page.getByRole('main')).toContainText('50')

  // One undo removes the Monte Carlo analysis; two more the simulation and its table.
  await expect(sheet(page, 'Monte Carlo analysis of Simulate column data', 'Results')).toBeVisible()
  await pressShortcut(page, 'Mod+Z')
  await expect(sheet(page, 'Monte Carlo analysis of Simulate column data')).toHaveCount(0)
  await expect(sheet(page, 'Simulate column data', 'Results')).toBeVisible()
  await pressShortcut(page, 'Mod+Z')
  await expect(sheet(page, 'Data 1')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Start a project' })).toBeVisible()
})

test('chained analyses: a transform, then a t test of its table', async ({ page }) => {
  await newTable(page, { kind: 'Column', sample: true })
  await analyze(page, 'Transform')
  // Y = log(Y) by default; the result is a table, shown first.
  const transformed = page.getByRole('main').getByRole('grid', { name: 'Transform of Data 1' })
  await expect(transformed.getByRole('rowgroup').nth(1).getByRole('row').first()).toHaveText(
    /1\.53275\s*1\.65514/,
  )
  await runMenu(page, 'Analyze', 'Analyze this table…')
  const d = dialog(page, 'Analyze “Transform of Data 1”')
  await d.getByRole('option', { name: 't test', exact: true }).first().click()
  await d.getByRole('button', { name: 'OK' }).click()
  await expectUpToDate(page)
  // R: t.test(log10(Treated), log10(Control), var.equal = TRUE): t = 6.0346.
  await expect(resultValue(resultTable(page, 'Unpaired t test'), 't')).toHaveText('6.035')
  await expect(sheet(page, 't test of Transform of Data 1', 'Results')).toHaveClass(/\bon\b/)

  // The chain follows the data: an edit of the table reaches the t test through the transform.
  await sheet(page, 'Data 1', 'Data Tables').click()
  await typeCells(page, 0, 0, [['44.1']])
  await sheet(page, 't test of Transform of Data 1', 'Results').click()
  await expectUpToDate(page)
  await expect(resultValue(resultTable(page, 'Unpaired t test'), 't')).not.toHaveText('6.035')
  await sheet(page, 'Transform of Data 1', 'Results').click()
  await expect(transformed.getByRole('rowgroup').nth(1).getByRole('row').first()).toHaveText(
    /1\.64444\s*1\.65514/,
  )
})

// Audit 2, P4: a long computation shows its time and a Cancel; a cancelled analysis says so and
// runs again; a computation no longer wanted (its parameters changed) is stopped, so the new one
// doesn't wait behind it.
test('a long analysis: progress, Cancel and Run again; a change stops it', async ({ page }) => {
  await openExample(page, 'single-cell')
  await openSheet(page, 'T cells', 'Data Tables')
  await tool(page, 'Analyze…').click()
  const d = dialog(page, /^Analyze “/)
  await d.getByRole('option', { name: 'Principal component analysis', exact: true }).first().click()
  // Parallel analysis of 30,000 rows with 10,000 simulations: minutes of computing.
  // The number variables are ticked, the text ones offered but not (phase 42: a text variable
  // would leave every row out).
  for (const text of ['sample', 'seurat_clusters', 'cell_type'])
    await expect(d.getByRole('checkbox', { name: text, exact: true })).not.toBeChecked()
  await expect(d.getByRole('checkbox', { name: 'UMAP_1', exact: true })).toBeChecked()
  await d.getByLabel('Simulations', { exact: true }).fill('10000')
  await d.getByRole('button', { name: 'OK', exact: true }).click()
  await expect(d).toBeHidden()
  const main = page.getByRole('main')
  const progress = main.getByRole('progressbar', { name: 'Computing' })
  await expect(progress).toBeVisible()
  await expect(main.getByText(/^Computing… \d+ s$/)).toBeVisible()
  await main.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(main.getByRole('status').filter({ hasText: /^Cancelled/ })).toBeVisible()
  await expect(progress).toHaveCount(0)
  await expect(main.getByText('Updating…')).toHaveCount(0)

  await main.getByRole('button', { name: 'Run again', exact: true }).click()
  await expect(progress).toBeVisible()
  // Roadmap 42: parallel analysis reports its simulations, so the bar fills (a determinate bar,
  // the percentage and the time left) as they are done.
  const done = () => progress.evaluate((e) => (e as HTMLProgressElement).position)
  await expect.poll(done).toBeGreaterThan(0)
  const before = await done()
  await expect.poll(done).toBeGreaterThan(before)
  await expect(main.getByText(/^\d+%, (about \d+ (s|min|h)|a few seconds) left$/)).toBeVisible()
  // Fewer simulations: the job running is no longer wanted and stops; the new one takes seconds.
  const p = await editParameters(page)
  await p.getByLabel('Simulations', { exact: true }).fill('20')
  await p.getByRole('button', { name: 'OK' }).click()
  await expectUpToDate(page)
  await expect(progress).toHaveCount(0)
})
