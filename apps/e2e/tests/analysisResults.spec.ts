import type { Locator, Page } from '@playwright/test'
import { expect, test } from './fixtures.ts'
import {
  analyze,
  cell,
  editDialog,
  expectUpToDate,
  newTable,
  okButton,
  openDetails,
  openTier,
  pasteText,
  resultRow,
  resultTable,
  resultValue,
  runMenu,
  sheet,
} from './helpers-data.ts'
import { newGraph, openSheet } from './helpers-graph.ts'

// Roadmap 51d (design §8): results that explain themselves — the answer first in a sentence (a
// t test, one-way ANOVA with Dunnett's comparisons, survival, a curve fit), the user's names in
// labels and in the analysis' name, the effect plot, the details collapsed, the methods
// paragraph, and result labels on graphs still showing their numbers.

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

const summary = (page: Page) => page.getByRole('main').getByRole('region', { name: 'Summary' })
const resultTexts = (scope: Locator) => scope.locator('text[data-id^="result/"]')

test('a t test: the sentence first, names, the effect plot, details and the method', async ({
  page,
}) => {
  await newTable(page, { kind: 'Column', sample: true })
  await analyze(page, 't test')
  // Named by its method and groups (U23).
  const name = 'Welch’s t test: Treated vs Control (Data 1)'
  await expect(sheet(page, name, 'Results')).toHaveClass(/\bon\b/)
  // The answer in the user's names: direction, size with its CI, P with its test, n (U18).
  await expect(summary(page).locator('.summary-sentence')).toHaveText(
    'Treated is higher than Control by 12.7 (95% CI 8.26 to 17.1); P < 0.0001, Welch’s t test. n = 8 each.',
  )
  // The effect plot: the difference with its CI, described for screen readers (U25, U29).
  const plot = summary(page).getByRole('img')
  await expect(plot).toBeVisible()
  await expect(summary(page).locator('.sketch-description')).toContainText(
    'Effect plot. Treated − Control: 12.7 (95% CI 8.26 to 17.1)',
  )
  // Labels say the groups' names (U19); the details are collapsed until opened (U21, U22).
  const diff = resultTable(page, 'How big is the difference?')
  await expect(resultValue(diff, 'Mean of Control')).toBeVisible()
  await expect(resultValue(diff, 'Difference between means (Treated − Control)')).toHaveText(
    '12.66',
  )
  await expect(resultTable(page, 'Data analyzed')).toBeHidden()
  await openDetails(page)
  await expect(resultValue(resultTable(page, 'Data analyzed'), 'Sample size, Treated')).toHaveText(
    '8',
  )
  // The methods paragraph, to copy.
  const method = page.getByRole('main').locator('details.method-section')
  await method.locator('summary').click()
  await expect(method.locator('.methods-paragraph')).toHaveText(
    /^Control and Treated were compared by Welch’s t test \(two-tailed\)\. Confidence intervals are 95%\. Analyzed with statPlotter \d+\.\d+\.\d+\.$/,
  )
  await expect(method.getByRole('button', { name: 'Copy methods text' })).toBeVisible()

  // Student's t test: the name follows the method until the user renames the analysis.
  await page.getByRole('main').getByRole('button', { name: 'Parameters…' }).click()
  const d = editDialog(page)
  await d.getByRole('radio', { name: /Student’s t test$/ }).check()
  await okButton(d).click()
  await expectUpToDate(page)
  await expect(
    sheet(page, 'Student’s t test: Treated vs Control (Data 1)', 'Results'),
  ).toBeVisible()
  await expect(summary(page)).toContainText('Student’s t test')
})

test('one-way ANOVA with Dunnett’s comparisons: the comparisons first, with their header', async ({
  page,
  browserName,
}) => {
  await newTable(page, { kind: 'Column', name: 'Doses' })
  await cell(page, 0, 0).click()
  await pasteText(
    page,
    '4.2\t5.6\t4.9\n4.8\t6.1\t5.2\n5.1\t5.9\t5.0\n4.5\t6.3\t5.4\n4.9\t5.8\t5.3',
    { browserName },
  )
  await expect(cell(page, 4, 2)).toHaveText('5.3')
  await analyze(page, 'One-way ANOVA (and nonparametric)', async (d) => {
    await d.getByRole('radio', { name: 'Each group with a control' }).check()
  })
  await expect(sheet(page, 'One-way ANOVA + Dunnett: Doses', 'Results')).toBeVisible()
  await expect(summary(page).locator('.summary-sentence')).toHaveText(
    /^Compared with Group A, Group B is higher by 1\.24 \(95% CI .* adjusted P < 0\.0001\); and Group C is higher by 0\.\d+ \(95% CI .*, adjusted P = 0\.\d+\); Dunnett’s test for 2 comparisons\. Overall: the means differ across the 3 groups \(ordinary one-way ANOVA, P < 0\.0001\)\.$/,
  )
  // The first tab answers the question asked: the comparisons, with what they refer to (S23).
  const first = page.getByRole('tab').first()
  await expect(first).toHaveText('Multiple comparisons')
  await expect(first).toHaveAttribute('aria-selected', 'true')
  const dunnett = resultTable(page, 'Dunnett’s multiple comparisons test')
  await expect(dunnett.locator('caption')).toHaveText(
    'Dunnett: each of 2 groups − Group A, one family; adjusted P values and simultaneous 95% CIs.',
  )
  await expect(resultRow(dunnett, 'Group B − Group A').nth(1)).toHaveText('1.240')
  // The effect plot: each group − the control.
  await expect(summary(page).locator('.sketch-description')).toContainText(
    'Group B − Group A: 1.24',
  )
})

test('survival: medians in words, the test, and labels on the graph still showing numbers', async ({
  page,
}) => {
  await newTable(page, { kind: 'Survival', name: 'Trial', sample: true })
  const svg = await newGraph(page, null, 'Trial graph')
  await openSheet(page, 'Trial', 'Data Tables')
  await analyze(page, 'Survival curves', async (d) => {
    await openTier(d, 'Reporting')
    await d.getByRole('checkbox', { name: 'Show the log-rank P on the graph' }).check()
  })
  await expect(summary(page).locator('.summary-sentence')).toHaveText(
    /^Median survival 44 on Control and .* on Treated; the curves show no evidence of differing \(log-rank P = 0\.0594\)\. Hazard ratio Treated vs\. Control: 0\.\d+ \(95% CI .*\)\.$/,
  )
  await openSheet(page, 'Trial graph', 'Graphs')
  await expect(resultTexts(svg).first()).toHaveText(/^Log-rank P = 0\.059/)
})

test('a curve fit: EC50 with its unit in the sentence', async ({ page }) => {
  await newTable(page, { kind: 'XY', name: 'Agonist', sample: true })
  await analyze(page, 'Nonlinear regression (curve fit)')
  await expect(summary(page).locator('.summary-sentence')).toHaveText(
    /^EC50 = 62\.\d nM \(log EC50 95% CI −7\.\d+ to −7\.\d+\) for Agonist alone; 7\d\d nM \(log EC50 95% CI .*\) for \+ Antagonist; Hill slope 1\.09 and 1\.09\.$/,
  )
  // No difference to plot for a fit: no effect plot.
  await expect(summary(page).getByRole('img')).toHaveCount(0)
  await runMenu(page, 'View', 'Go to data table')
  await expect(page.getByRole('main').getByRole('grid')).toBeVisible()
})
