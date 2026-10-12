import type { Page } from '@playwright/test'
import { expect, test } from './fixtures.ts'
import {
  analyze,
  dialog,
  expectUpToDate,
  newTable,
  pressShortcut,
  resultTable,
  runMenu,
  sheet,
} from './helpers-data.ts'
import { newGraph } from './helpers-graph.ts'

// Roadmap 51c (docs/design/ANALYSIS_GUIDE.md §7): changing a test after its results were seen is
// visible — a notice in the parameters dialog (never blocking: Apply, or Add as a new analysis),
// the change and its reason in the method history under the results, one undo step; a
// one-tailed test asks the predicted direction in the groups' names; two tests of one
// comparison on a graph are flagged.

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

async function editParameters(page: Page) {
  await page.getByRole('main').getByRole('button', { name: 'Parameters…' }).click()
  const d = dialog(page, 'Analysis parameters')
  await expect(d).toBeVisible()
  return d
}

const history = (page: Page) => page.getByRole('main').locator('details.method-history')

test('a method changed after its results were seen: the notice, the reason, the history', async ({
  page,
}) => {
  await newTable(page, { kind: 'Column', sample: true })
  await analyze(page, 't test')
  await expect(resultTable(page, 'Unpaired t test with Welch’s correction')).toBeVisible()
  await expect(history(page)).toHaveCount(0)

  const d = await editParameters(page)
  // Nothing changed yet: no notice.
  await expect(d.getByRole('note').filter({ hasText: 'after seeing results' })).toHaveCount(0)
  await d.getByRole('radio', { name: /Student’s t test$/ }).check()
  const notice = d
    .getByRole('note')
    .filter({ hasText: 'You are changing the method after seeing results.' })
  await expect(notice).toBeVisible()
  await expect(notice.getByRole('listitem')).toHaveText([/→ .*Student/])
  await notice.getByLabel('Reason (optional)').fill('the protocol specified equal SDs')
  await d.getByRole('button', { name: 'OK' }).click()
  await expect(d).toBeHidden()
  await expectUpToDate(page)
  await expect(resultTable(page, 'Unpaired t test')).toBeVisible()

  const h = history(page)
  await expect(h.locator('summary')).toHaveText(
    'Method history: changed after results were seen (1)',
  )
  await expect(h.getByRole('listitem')).toHaveText([
    /changed after its results were seen \(it was t test\): .*Student.*reason: “the protocol specified equal SDs”/,
  ])
  // One undo step: the method and its history.
  await pressShortcut(page, 'Mod+Z')
  await expect(resultTable(page, 'Unpaired t test with Welch’s correction')).toBeVisible()
  await expect(history(page)).toHaveCount(0)
})

test('Add as a new analysis keeps the first; one-tailed asks the direction by the groups’ names', async ({
  page,
}) => {
  await newTable(page, { kind: 'Column', sample: true })
  await analyze(page, 't test')
  const d = await editParameters(page)
  await d.getByRole('radio', { name: /^One-tailed/ }).check()
  // The prediction, in the data sets' names (S1).
  await expect(d.getByRole('radio', { name: '“Treated” higher than “Control”' })).toBeVisible()
  await d.getByRole('radio', { name: '“Treated” higher than “Control”' }).check()
  const notice = d.getByRole('note').filter({ hasText: 'after seeing results' })
  await expect(notice).toBeVisible()
  await notice.getByRole('button', { name: 'Add as a new analysis' }).click()
  await expect(d).toBeHidden()
  await expectUpToDate(page)
  // The new analysis, one-tailed in the predicted direction.
  await expect(
    page
      .getByRole('main')
      .getByText(/one-tailed/i)
      .first(),
  ).toBeVisible()
  await expect(history(page)).toHaveCount(0)
  // The first, unchanged, with no history.
  await sheet(page, 't test of Data 1', 'Results').first().click()
  await expectUpToDate(page)
  await expect(history(page)).toHaveCount(0)
})

test('two tests of one comparison on a graph are flagged; removing one clears it', async ({
  page,
}) => {
  await newTable(page, { kind: 'XY', name: 'Course', sample: true })
  await newGraph(page, null, 'Course graph')
  // First, all data sets: a two-way ANOVA compared at each X (§7.3).
  await runMenu(page, 'Insert', 'Result', 'Bracket at one X…')
  let d = dialog(page, 'Add bracket at one X')
  await d.getByRole('radio', { name: /^All data sets: two-way ANOVA/ }).check()
  await d.getByRole('button', { name: 'Add' }).click()
  await expect(d).toBeHidden()
  const badge = page.getByTestId('duplicate-tests')
  await expect(badge).toHaveCount(0)
  // Then a test of its own at the same X: the same comparison twice.
  await runMenu(page, 'Insert', 'Result', 'Bracket at one X…')
  d = dialog(page, 'Add bracket at one X')
  await expect(d.getByRole('radio', { name: /^All data sets: two-way ANOVA/ })).toBeChecked()
  await d.getByRole('radio', { name: 'One test at this X only' }).check()
  await d.getByRole('button', { name: 'Add' }).click()
  await expect(d).toBeHidden()
  await expect(badge.locator('summary')).toHaveText(/2 tests of .+ vs .+ shown/)
  await badge.locator('summary').click()
  await badge.getByRole('button', { name: 'Remove this label' }).last().click()
  await expect(badge).toHaveCount(0)
})
