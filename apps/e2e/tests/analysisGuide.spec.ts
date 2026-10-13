import { expect, navigator, openExample, test } from './fixtures.ts'
import {
  allAnalyses,
  dialog,
  expectUpToDate,
  newTable,
  okButton,
  resultTable,
  runMenu,
  tool,
} from './helpers-data.ts'
import { openSheet } from './helpers-graph.ts'

// Roadmap 51a (docs/design/ANALYSIS_GUIDE.md §2–§3): Guide me — questions about the experiment
// lead to an analysis set up with its reasons, which Analyze then runs; questions another table
// kind answers ("Not here?"); search by question; the explanation lines of the form; Help ›
// Choosing an analysis; the empty Results' questions.

test('Guide me: the questions, the recommendation and its reasons, then Analyze runs it', async ({
  page,
}) => {
  await openExample(page, 'getting-started')
  await openSheet(page, 'Dose response (3 groups)', 'Data Tables')
  await tool(page, 'Analyze…').click()
  const d = dialog(page, 'Analyze “Dose response (3 groups)”')
  await expect(d.getByRole('tab', { name: 'Guide me' })).toHaveAttribute('aria-selected', 'true')
  // The table's shape, as facts (never a statistic).
  await expect(
    d.getByText(/3 groups \(Vehicle, 1 mg\/kg, 10 mg\/kg\), 8 values each/),
  ).toBeVisible()

  await d.getByRole('button', { name: 'Is each group different from a control?' }).click()
  // Three groups: a fact of the table, not a question.
  await expect(d.getByText('Three or more groups', { exact: true })).toBeVisible()
  await d.getByRole('radio', { name: 'No, different subjects in each group' }).check()
  await d.getByRole('radio', { name: 'Measurements', exact: true }).check()
  // Scatter that can differ: Welch ANOVA.
  await d.getByRole('radio', { name: 'Yes', exact: true }).check()
  await expect(d.getByRole('heading', { name: 'Recommended: Welch ANOVA' })).toBeVisible()
  await expect(d.getByText(/Welch ANOVA and its comparisons/)).toBeVisible()
  // Changing an earlier answer changes the recommendation.
  await d.getByRole('radio', { name: 'No, similar scatter is expected' }).check()
  const rec = d.getByRole('region', { name: 'Recommended: One-way ANOVA' })
  await expect(rec.getByText(/^One-way ANOVA tests all groups at once/)).toBeVisible()
  await expect(rec.getByText('One-way ANOVA · Dunnett · 95% CI')).toBeVisible()
  await expect(rec.getByText(/You will get:/)).toBeVisible()
  // The control, Vehicle first.
  await expect(d.getByLabel('Control group')).toHaveValue(/.+/)
  await expect(okButton(d)).toBeDisabled()
  await rec.getByRole('button', { name: 'Use this' }).click()

  // The form, set up: on All analyses, with each option's line and the method's card.
  await expect(d.getByRole('tab', { name: 'All analyses' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(
    d.getByRole('listbox', { name: 'Analyses' }).getByRole('option', { selected: true }),
  ).toHaveText('One-way ANOVA (and nonparametric)')
  await expect(d.getByRole('radio', { name: 'Each group with a control' })).toBeChecked()
  await expect(
    d.getByText('Which comparisons answer your question, decided before the experiment.'),
  ).toBeVisible()
  // Roadmap 51b: the cards in the side panel, open.
  await expect(d.getByRole('heading', { name: 'About this method' })).toBeVisible()
  await expect(d.getByRole('region', { name: 'Dunnett’s multiple comparisons test' })).toBeVisible()
  await okButton(d).click()
  await expect(d).toBeHidden()
  await expectUpToDate(page)
  await page.getByRole('tab', { name: 'Multiple comparisons' }).click()
  await expect(resultTable(page, 'Dunnett’s multiple comparisons test')).toBeVisible()
  // How to read this: the cards with the groups' names, and the question it came from.
  await page.getByText('How to read this').click()
  await expect(
    page.getByText(/Set up with Guide me: “Is each group different from a control\?”/),
  ).toBeVisible()
})

test('a question another table kind answers: Not here?, then a new table of that kind', async ({
  page,
}) => {
  await page.goto('/')
  await newTable(page, { kind: 'Column', sample: true })
  await tool(page, 'Analyze…').click()
  const d = dialog(page, /^Analyze “/)
  await d.getByText('Not here?').click()
  const item = d
    .getByRole('listitem')
    .filter({ hasText: 'Fit a dose-response curve (EC50 / IC50)' })
  await expect(item).toContainText('Needs an XY table')
  await item.getByRole('button', { name: 'New XY table…' }).click()
  const create = dialog(page, 'New data table')
  await expect(create).toBeVisible()
  await expect(create.getByRole('radio', { name: /^XY —/ })).toBeChecked()
  await create.getByRole('button', { name: 'Cancel' }).click()
})

test('search by question, across table kinds, by keyboard', async ({ page }) => {
  await page.goto('/')
  await newTable(page, { kind: 'Column', sample: true })
  await tool(page, 'Analyze…').click()
  const d = dialog(page, /^Analyze “/)
  await allAnalyses(d)
  const search = d.getByRole('combobox', { name: 'Search analyses' })
  await expect(search).toBeFocused()
  // Another kind's analysis: greyed, with what it needs.
  await page.keyboard.type('surv')
  await expect(d.getByText('Need another table kind')).toBeVisible()
  await expect(
    d.getByText('Survival needs a survival table (time, then event or censored).').first(),
  ).toBeVisible()
  // A question, words in any order: Enter opens the chooser on it.
  await search.fill('groups compare')
  const list = d.getByRole('listbox', { name: 'Analyses' })
  await expect(
    list.getByRole('group', { name: 'Questions' }).getByRole('option').first(),
  ).toHaveText('Are the groups different?')
  await page.keyboard.press('Enter')
  await expect(d.getByRole('tab', { name: 'Guide me' })).toHaveAttribute('aria-selected', 'true')
  await expect(d.getByRole('heading', { name: 'Are the groups different?' })).toBeVisible()
  await d.getByRole('button', { name: 'Cancel' }).click()
})

test('Help › Choosing an analysis, and the empty Results’ questions', async ({ page }) => {
  await page.goto('/')
  await newTable(page, { kind: 'Column', sample: true, name: 'Weights' })
  // A table with no analyses: what the chooser can answer, from the navigator.
  const prompt = navigator(page).getByRole('region', { name: 'Results' })
  await expect(prompt).toContainText('What do you want to know about “Weights”?')
  await prompt.getByRole('button', { name: 'Are the groups different?' }).click()
  const d = dialog(page, 'Analyze “Weights”')
  await expect(d.getByRole('heading', { name: 'Are the groups different?' })).toBeVisible()
  await d.getByRole('button', { name: 'Cancel' }).click()

  await runMenu(page, 'Help', 'Choosing an analysis')
  const help = dialog(page, 'Choosing an analysis')
  await expect(help.getByRole('region', { name: 'Are the groups different?' })).toBeVisible()
  await expect(help.getByRole('region', { name: 'Welch’s t test' })).toBeAttached()
  await help.getByRole('tab', { name: 'XY' }).click()
  await expect(
    help.getByRole('region', { name: 'Fit a dose-response curve (EC50 / IC50)' }),
  ).toBeVisible()
  await help.getByRole('button', { name: 'Close' }).click()
  await expect(help).toBeHidden()
})
