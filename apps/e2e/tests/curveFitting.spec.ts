import type { Locator, Page } from '@playwright/test'
import { expect, test } from './fixtures.ts'
import {
  allAnalyses,
  dialog,
  expectUpToDate,
  newTable,
  okButton,
  resultRow,
  resultTable,
  tool,
  typeCells,
} from './helpers-data.ts'

// Roadmap 51e (docs/design/ANALYSIS_GUIDE.md §9): curve fitting — the model chosen by goal from
// cards with their shape's thumbnail; X entered as concentrations noticed under a log model and
// fixed by Transform X to log10 (a Transform analysis, the fit of its result); the EC50s of two
// data sets compared by the F test chosen before the results; two models that aren't nested
// compared by AICc, the F test greyed with its reason.

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

const summary = (page: Page) =>
  page.getByRole('main').getByRole('region', { name: 'Summary' }).locator('.summary-sentence')

/** The Analyze dialog on the open table, on the curve fit. */
async function curveFit(page: Page): Promise<Locator> {
  await tool(page, 'Analyze…').click()
  const d = dialog(page, /^Analyze “/)
  await expect(d).toBeVisible()
  await allAnalyses(d)
  await d.getByRole('option', { name: 'Nonlinear regression (curve fit)', exact: true }).click()
  await expect(d.locator('.method-title')).toHaveText('Nonlinear regression (curve fit)')
  return d
}

const goal = (d: Locator, name: string) =>
  d.getByRole('tablist', { name: 'Goals' }).getByRole('tab', { name, exact: true })
const model = (d: Locator, name: string) =>
  d.locator('.model-cards').getByRole('radio', { name: new RegExp(`^${escapeRe(name)}`) })
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A falling dose-response: 11 doses, X typed as given. */
const RESPONSES = [
  '99.1',
  '97.4',
  '93.2',
  '85.8',
  '67.0',
  '42.3',
  '21.5',
  '9.8',
  '4.6',
  '2.9',
  '1.7',
]
async function inhibitionTable(page: Page, name: string, x: readonly string[]) {
  await newTable(page, { kind: 'XY', name, dataSets: 1, replicates: 1 })
  await typeCells(
    page,
    0,
    0,
    x.map((v, i) => [v, RESPONSES[i]!]),
  )
}
const LOG_X = ['-9', '-8.5', '-8', '-7.5', '-7', '-6.5', '-6', '-5.5', '-5', '-4.5', '-4']
const CONC_X = LOG_X.map((v) => (10 ** Number(v)).toPrecision(3))

test('an IC50 from a log-X table, chosen by goal through the picker', async ({ page }) => {
  await inhibitionTable(page, 'Inhibition', LOG_X)
  const d = await curveFit(page)
  // Goals, then the goal's models as cards with their thumbnails.
  await expect(goal(d, 'Dose-response: stimulation (EC50)')).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await goal(d, 'Dose-response: inhibition (IC50)').click()
  const card = model(d, 'log(inhibitor) vs. response — Variable slope (four parameters)')
  await expect(card.locator('img.model-thumb')).toBeVisible()
  await expect(card).toContainText('X: log(concentration) · 4 parameters')
  await card.click()
  await expect(card).toHaveAttribute('aria-checked', 'true')
  await expect(d.locator('.model-params')).toContainText(
    'LogIC50: log of the IC50: the dose giving a response half-way between Top and Bottom',
  )
  // The sketch: the model's starting shape, not the fit; no note about X.
  await expect(d.locator('.sketch-caption')).toContainText('the line is its starting shape')
  await expect(d.locator('.checks .check-note')).toHaveCount(0)
  await okButton(d).click()
  await expect(d).toBeHidden()
  await expectUpToDate(page)
  await expect(summary(page)).toHaveText(
    /^IC50 = .*\(log IC50 95% CI −\d\.\d+ to −\d\.\d+\) for Group A; Hill slope −0\.\d+\.$/,
  )
  // Profile-likelihood CIs by default.
  await expect(resultTable(page, '95% CI (profile likelihood)')).toBeVisible()
  await expect(resultRow(resultTable(page, 'Best-fit values'), 'LogIC50').nth(1)).toHaveText(
    /^-6\.\d+$/,
  )
})

test('concentrations under a log model: the note, and Transform X to log10 fixes it', async ({
  page,
}) => {
  await inhibitionTable(page, 'Doses', CONC_X)
  const d = await curveFit(page)
  await goal(d, 'Dose-response: inhibition (IC50)').click()
  await model(d, 'log(inhibitor) vs. response — Variable slope (four parameters)').click()
  const note = d.locator('.checks .check-note')
  await expect(note).toContainText(
    'X looks like concentrations (1e-9 to 1e-4), but this model expects log(concentration).',
  )
  await note.getByRole('button', { name: 'Transform X to log10' }).click()
  await expect(d.locator('.transform-first')).toContainText(
    'X will be transformed to log10 first: Analyze adds a Transform analysis of “Doses” and fits its result.',
  )
  await expect(note).toHaveCount(0)
  await okButton(d).click()
  await expect(d).toBeHidden()
  await expectUpToDate(page)
  // The fit of the transformed table: the same IC50 as on log X.
  await expect(resultRow(resultTable(page, 'Best-fit values'), 'LogIC50').nth(1)).toHaveText(
    /^-6\.\d+$/,
  )
  await expect(page.getByRole('navigation').getByText('log10(X) of Doses')).toBeVisible()
})

test('EC50s of two data sets compared by the F test chosen in advance', async ({ page }) => {
  await newTable(page, { kind: 'XY', name: 'Agonist', sample: true })
  const d = await curveFit(page)
  // Asked only once a comparison is asked for.
  await expect(d.getByText('How will you decide between the two fits?')).toHaveCount(0)
  await d.getByRole('checkbox', { name: 'LogEC50', exact: true }).check()
  const decide = d.getByRole('group', { name: /How will you decide between the two fits\?/ })
  await expect(decide).toBeVisible()
  await expect(decide.getByRole('radio', { name: /Extra sum-of-squares F test/ })).toBeChecked()
  await okButton(d).click()
  await expect(d).toBeHidden()
  await expectUpToDate(page)
  await expect(summary(page)).toContainText(
    'LogEC50 differs between data sets (extra sum-of-squares F test, P',
  )
  await page.getByRole('tab', { name: 'Compare parameters' }).click()
  await expect(page.getByRole('main')).toContainText('Do the best-fit values of LogEC50 differ')
  await expect(page.getByRole('main').locator('table', { hasText: 'AICc' })).toHaveCount(0)
})

test('two models that aren’t nested: the F test greyed, compared by AICc', async ({ page }) => {
  await newTable(page, { kind: 'XY', name: 'Agonist', sample: true })
  const d = await curveFit(page)
  const compare = d.getByRole('combobox', { name: 'Compare with another model' })
  await compare.selectOption({ label: 'Asymmetric sigmoidal, 5PL, X is concentration' })
  const decide = d.getByRole('group', { name: /How will you decide between the two fits\?/ })
  const fTest = decide.getByRole('radio', { name: /Extra sum-of-squares F test/ })
  await expect(fTest).toHaveAttribute('aria-disabled', 'true')
  await expect(okButton(d)).toBeDisabled()
  await expect(d.locator('.ok-reason')).toContainText(
    'These models aren’t nested; compare them by AICc.',
  )
  await decide.getByRole('radio', { name: /^AICc/ }).check()
  await expect(okButton(d)).toBeEnabled()
  await okButton(d).click()
  await expect(d).toBeHidden()
  await expectUpToDate(page)
  await expect(summary(page)).toContainText('(AICc, probability')
  await page.getByRole('tab', { name: 'Comparison of fits' }).click()
  await expect(
    page.getByRole('main').locator('table', { hasText: 'Preferred model (F test)' }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('main').locator('table', { hasText: 'Preferred model (AICc)' }),
  ).toHaveCount(1)
})
