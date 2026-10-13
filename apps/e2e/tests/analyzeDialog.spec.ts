import type { Locator, Page } from '@playwright/test'
import { expect, openExample, test } from './fixtures.ts'
import {
  allAnalyses,
  chip,
  dialog,
  expectUpToDate,
  newTable,
  okButton,
  openTier,
  pressShortcut,
  tool,
} from './helpers-data.ts'
import { openSheet } from './helpers-graph.ts'

// Roadmap 51b (docs/design/ANALYSIS_GUIDE.md §4–§5): the Analyze dialog in three panels — the
// list, the options in tiers, the live sketch and checks — its sizes; the groups as chips in the
// analysis' order with the comparison spelled out; the sketch following the options (pairs
// joined, Welch's own SDs or the pooled SD, ranks, the comparisons); an option greyed with its
// reason; a check before Analyze; switching methods keeping the shared choices; roles for an
// analysis of variables; and no P value anywhere before Analyze.

async function openAnalyze(page: Page, table: string, analysis: string): Promise<Locator> {
  await openSheet(page, table, 'Data Tables')
  await tool(page, 'Analyze…').click()
  const d = dialog(page, `Analyze “${table}”`)
  await allAnalyses(d)
  await pick(d, analysis)
  await expect(d.locator('.method-title')).toHaveText(analysis)
  return d
}

/** Another analysis from the list (the method switched, the shared choices kept). */
const pick = (d: Locator, analysis: string) =>
  d
    .getByRole('listbox', { name: 'Analyses' })
    .getByRole('option', { name: analysis, exact: true })
    .click()

const sketch = (d: Locator) => d.locator('.sketch')
const panels = (d: Locator) => d.locator('.sketch-panel')

test('three panels; at 1024 px the list folds to a strip; the size is remembered', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openExample(page, 'getting-started')
  const d = await openAnalyze(page, 'Enzyme activity', 't test')
  await expect(d.getByRole('navigation', { name: 'Analyses' })).toBeVisible()
  await expect(d.getByRole('combobox', { name: 'Search analyses' })).toBeVisible()
  await expect(d.locator('.analyze-options-column')).toBeVisible()
  await expect(d.getByRole('complementary', { name: 'Your data and the method' })).toBeVisible()
  const box = (await d.boundingBox())!
  // min(1200 px, 94vw).
  expect(Math.round(box.width)).toBe(1200)
  await d.getByRole('button', { name: 'Cancel' }).click()

  await page.setViewportSize({ width: 1024, height: 768 })
  await tool(page, 'Analyze…').click()
  const narrow = dialog(page, 'Analyze “Enzyme activity”')
  await expect(narrow.locator('.analyze3')).toHaveClass(/\bmedium\b/)
  // The list folded to a strip naming the method; it opens over the options.
  await expect(narrow.getByRole('combobox', { name: 'Search analyses' })).toBeHidden()
  await narrow.locator('.rail-toggle').click()
  await expect(narrow.getByRole('combobox', { name: 'Search analyses' })).toBeVisible()
  const side = (await narrow.locator('.analyze-side').boundingBox())!
  expect(Math.round(side.width)).toBeLessThanOrEqual(300)
  await narrow.getByRole('button', { name: 'Cancel' }).click()
})

test('chips set the groups and their order; the comparison is spelled out', async ({ page }) => {
  await openExample(page, 'getting-started')
  const d = await openAnalyze(page, 'Enzyme activity', 't test')
  const comparing = d.locator('.comparing')
  await expect(comparing).toHaveText('Comparing: “Treated” − “Control”.')
  await d.getByRole('button', { name: 'Swap the two groups' }).click()
  await expect(comparing).toHaveText('Comparing: “Control” − “Treated”.')
  // By keyboard: Alt + → moves the focused chip back.
  await chip(d, 'Treated').focus()
  await page.keyboard.press('Alt+ArrowRight')
  await expect(comparing).toHaveText('Comparing: “Treated” − “Control”.')
  // One chip left out: the check says so and Analyze waits, with the reason.
  await chip(d, 'Control').click()
  await expect(chip(d, 'Control')).toHaveAttribute('aria-selected', 'false')
  await expect(okButton(d)).toBeDisabled()
  await expect(d.locator('.ok-reason')).toHaveText('Choose 2 groups (1 chosen).')
  await expect(d.getByRole('region', { name: 'Checks' })).toContainText('Error: Choose 2 groups')
  await chip(d, 'Control').click()
  await expect(okButton(d)).toBeEnabled()
})

test('the sketch follows the options: Welch or Student, pairs, ranks', async ({ page }) => {
  await openExample(page, 'getting-started')
  const d = await openAnalyze(page, 'Enzyme activity', 't test')
  await expect(sketch(d)).toContainText('own scatter')
  await expect(panels(d)).toHaveCount(1)
  await d.getByRole('radio', { name: 'No, equal scatter is known: Student’s t test' }).check()
  await expect(sketch(d)).toContainText('pooled SD')
  // Paired: a line per pair, and the differences.
  await d.getByRole('radio', { name: 'Yes, each row is one subject, plate or day' }).check()
  await expect(d.locator('.sketch-panel[data-panel="pairs"]')).toBeVisible()
  await expect(d.locator('.sketch-panel[data-panel="diff"]')).toContainText(
    'Differences Treated − Control',
  )
  await expect(d.locator('.sketch-counts')).toContainText('10 pairs · matched')
  // The text alternative describes it.
  const img = d.locator('.sketch-panels[role="img"]')
  await expect(img).toHaveAttribute('aria-describedby', /.+/)
  // A rank test draws the values as ranks.
  await pick(d, 'Mann-Whitney test')
  await expect(d.locator('.method-title')).toHaveText('Mann-Whitney test')
  await expect(d.locator('.sketch-panel[data-panel="ranks"] figcaption')).toHaveText(/^Ranks/)
  await expect(sketch(d)).toContainText('Rank sums:')
})

test('comparisons change the sketch; a greyed option says why; switching keeps choices', async ({
  page,
}) => {
  await openExample(page, 'getting-started')
  const d = await openAnalyze(page, 'Dose response (3 groups)', 'One-way ANOVA (and nonparametric)')
  const counts = d.locator('.sketch-counts')
  await expect(counts).toContainText('every pair: 3 comparisons')
  await d.getByRole('radio', { name: 'Each group with a control' }).check()
  await expect(counts).toContainText('2 comparisons')
  await expect(d.locator('.comparing')).toContainText('each group − “Vehicle”')
  // Matched rows: the trend test can't be chosen, and says why.
  await d.getByRole('radio', { name: 'Yes, each row is one subject, plate or day' }).check()
  const trend = d.getByRole('radio', { name: 'A steady trend across the groups, in order' })
  await expect(trend).toHaveAttribute('aria-disabled', 'true')
  await expect(d.getByText(/Not with matched rows: the trend test uses/)).toBeVisible()
  await expect(d.locator('.sketch-panel[data-panel="data"] figcaption')).toHaveText(
    'Each line is one subject',
  )
  // The confidence level (Reporting) and matching carry over to Friedman's test and back.
  await openTier(d, 'Reporting')
  await d.getByRole('combobox', { name: 'Confidence level' }).selectOption({ label: '99%' })
  await pick(d, 'Friedman test')
  await expect(d.locator('.method-title')).toHaveText('Friedman test')
  await expect(d.getByRole('radio', { name: 'Each group with a control' })).toBeChecked()
  await pick(d, 'One-way ANOVA (and nonparametric)')
  await expect(
    d.getByRole('radio', { name: 'Yes, each row is one subject, plate or day' }),
  ).toBeChecked()
  await expect(d.locator('.method-line')).toContainText('99% CI')
})

test('a check before Analyze: one-tailed P needs the direction', async ({ page }) => {
  await openExample(page, 'getting-started')
  const d = await openAnalyze(page, 'Enzyme activity', 't test')
  await openTier(d, 'Advanced')
  await d.getByRole('radio', { name: /^One-tailed/ }).check()
  await expect(okButton(d)).toBeDisabled()
  await expect(d.locator('.ok-reason')).toHaveText(/^Say which direction you predicted/)
  await d.getByRole('radio', { name: '“Treated” higher than “Control”' }).check()
  await expect(okButton(d)).toBeEnabled()
  await expect(sketch(d)).toContainText('Predicted before the experiment')
  // No P value, CI or verdict anywhere before Analyze: the options, the sketch, the checks and
  // the method line (the method's card explains what P means, without a value of it).
  const result = /P\s*[=<>]\s*0?[.,]\d|Significant\?|\d+\.\d+ to \d+\.\d+/
  for (const part of ['.analyze-options-column', '.sketch', '.checks', '.method-line'])
    await expect(d.locator(part)).not.toContainText(result)
  // ⌘Enter runs it.
  await pressShortcut(page, 'Mod+Enter')
  await expect(d).toBeHidden()
  await expectUpToDate(page)
})

test('roles for an analysis of variables: the outcome first, then Analyze', async ({ page }) => {
  await page.goto('/')
  await newTable(page, { kind: 'Multiple variables', sample: true, name: 'Cohort' })
  await tool(page, 'Analyze…').click()
  const d = dialog(page, 'Analyze “Cohort”')
  await allAnalyses(d)
  await pick(d, 'Multiple linear regression')
  await expect(d.getByRole('group', { name: 'Outcome (Y)' })).toBeVisible()
  await expect(d.getByRole('group', { name: 'Predictors', exact: true })).toBeVisible()
  await expect(okButton(d)).toBeDisabled()
  await expect(d.locator('.ok-reason')).toHaveText('Choose the outcome.')
  await d
    .getByRole('combobox', { name: 'Add to Outcome (Y)' })
    .selectOption({ label: 'SBP (number)' })
  // Never also a predictor; the sketch draws it against each predictor.
  await expect(d.getByRole('list', { name: 'Predictors', exact: true })).not.toContainText('SBP')
  await expect(d.locator('.sketch-counts')).toContainText('Outcome: SBP')
  await expect(okButton(d)).toBeEnabled()
  await okButton(d).click()
  await expect(d).toBeHidden()
  await expectUpToDate(page)
})

// Audit 4 (A11, A3): Escape steps back one thing at a time — the query, then the list opened over
// the options — before it closes the dialog; with the list folded (1024 px) the focus starts on
// the strip naming the method (the search is hidden).
test('Escape clears the search, then closes the folded list, then the dialog', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openExample(page, 'getting-started')
  const d = await openAnalyze(page, 'Enzyme activity', 't test')
  const search = d.getByRole('combobox', { name: 'Search analyses' })
  await search.fill('kruskal')
  await page.keyboard.press('Escape')
  await expect(search).toHaveValue('')
  await expect(d).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(d).toBeHidden()

  await page.setViewportSize({ width: 1024, height: 768 })
  await tool(page, 'Analyze…').click()
  const narrow = dialog(page, 'Analyze “Enzyme activity”')
  const toggle = narrow.locator('.rail-toggle')
  await expect(toggle).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(narrow.getByRole('combobox', { name: 'Search analyses' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(narrow).toBeVisible()
  await expect(toggle).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(narrow).toBeHidden()
})

// Audit 4 (A15): at 200 % zoom on a 768-pixel-high screen the dialog fits: its title and its
// buttons are on screen.
test('the dialog fits a short window (200 % zoom)', async ({ page }) => {
  await page.setViewportSize({ width: 683, height: 340 })
  await openExample(page, 'getting-started')
  await openSheet(page, 'Enzyme activity', 'Data Tables')
  await tool(page, 'Analyze…').click()
  const d = dialog(page, 'Analyze “Enzyme activity”')
  await expect(d).toBeVisible()
  const box = (await d.boundingBox())!
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.y + box.height).toBeLessThanOrEqual(340)
  await expect(d.getByRole('heading', { name: 'Analyze “Enzyme activity”' })).toBeInViewport()
  await expect(d.getByRole('button', { name: 'Cancel' })).toBeInViewport({ ratio: 1 })
})
