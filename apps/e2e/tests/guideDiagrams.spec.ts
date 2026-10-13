import type { Locator, Page } from '@playwright/test'
import { expect, openExample, test } from './fixtures.ts'
import { dialog, tool } from './helpers-data.ts'
import { openSheet } from './helpers-graph.ts'

// Roadmap 51f: Guide me's diagrams — "What will be tested", a schematic of the question built up
// as it is answered (the user's names, what is compared, the comparisons as arrows, matched
// subjects as links, a grouped table's grid and its independent units), and the map of the path
// under the question chosen (a step goes back to its question, keeping the later answers that
// still apply; by keyboard too). No P value anywhere.

async function guide(page: Page, table: string): Promise<Locator> {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openExample(page, table === 'Genotype × treatment' ? 'grouped' : 'getting-started')
  await openSheet(page, table, 'Data Tables')
  await tool(page, 'Analyze…').click()
  const d = dialog(page, `Analyze “${table}”`)
  await d.getByRole('tab', { name: 'Guide me' }).click()
  return d
}

const schematic = (d: Locator) =>
  d.getByRole('complementary', { name: 'What will be tested' }).locator('.schematic')
/** The schematic's text alternative (what the picture shows, in words). */
const pictured = (d: Locator) => schematic(d).locator('.visually-hidden')
const map = (d: Locator) => d.getByRole('list', { name: /^Your path/ })

test('answering builds the schematic step by step, in the user’s names', async ({ page }) => {
  const d = await guide(page, 'Dose response (3 groups)')
  await expect(d.getByRole('complementary', { name: 'What will be tested' })).toContainText(
    'Choose a question',
  )
  await d.getByRole('button', { name: 'Are the groups different?' }).click()
  await expect(schematic(d).locator('img')).toBeVisible()
  await expect(pictured(d)).toContainText('Boxes: Vehicle; 1 mg/kg; 10 mg/kg.')
  await expect(schematic(d)).toContainText('Next: Were the same subjects measured in every group?')

  await d.getByRole('radio', { name: 'No, different subjects in each group' }).check()
  await d.getByRole('radio', { name: 'Measurements', exact: true }).check()
  await expect(schematic(d).locator('.schematic-question')).toHaveText(
    'Do Vehicle, 1 mg/kg and 10 mg/kg differ in their mean?',
  )
  await d.getByRole('radio', { name: 'No, similar scatter is expected' }).check()
  await expect(schematic(d)).toContainText(
    'No effect: If the treatment had no effect, the means of all 3 groups would differ only by chance.',
  )

  // Every pair against each with a control: the arrows change.
  await d.getByRole('radio', { name: 'Every pair of groups' }).check()
  await expect(pictured(d)).toContainText(
    'Compared: Vehicle with 1 mg/kg; Vehicle with 10 mg/kg; 1 mg/kg with 10 mg/kg.',
  )
  await expect(schematic(d)).toContainText('Every pair: 3 comparisons, one family (Tukey).')
  const everyPair = await schematic(d).locator('img').getAttribute('src')
  await d.getByRole('radio', { name: 'Each group with a control' }).check()
  await expect(pictured(d)).toContainText('Compared: Vehicle with 1 mg/kg; Vehicle with 10 mg/kg.')
  await expect(pictured(d)).toContainText('Vehicle (control)')
  await expect(schematic(d)).toContainText('Each group against Vehicle: 2 comparisons')
  expect(await schematic(d).locator('img').getAttribute('src')).not.toBe(everyPair)
  // The control chosen elsewhere: the arrows re-root.
  await d.getByLabel('Control group').selectOption({ label: '10 mg/kg' })
  await expect(pictured(d)).toContainText('Compared: 10 mg/kg with Vehicle; 10 mg/kg with 1 mg/kg.')

  // The map: the table's count, the answers, then the method they lead to.
  await expect(map(d).getByRole('button')).toHaveText([
    /How many groups.*Three or more groups/,
    /Were the same subjects.*No, different subjects/,
    /What kind of values.*Measurements/,
    /Could a treatment change.*No, similar scatter/,
    /Which comparisons.*Each group with a control/,
    'Leads to: One-way ANOVA',
  ])
  // Never a statistic.
  await expect(d).not.toContainText(/P = |P < 0\.|P value of/)
})

test('matched subjects are linked; clicking a step goes back and keeps later answers', async ({
  page,
}) => {
  const d = await guide(page, 'Enzyme activity')
  await d.getByRole('button', { name: 'Are the groups different?' }).click()
  await d.getByRole('radio', { name: 'No, different subjects in each group' }).check()
  await d
    .getByRole('radio', { name: 'Measurements (activity, area, the concentration of one analyte)' })
    .check()
  await d.getByRole('radio', { name: 'Yes, or not sure' }).check()
  await expect(schematic(d).locator('.schematic-question')).toHaveText(
    'Is the mean of Treated different from that of Control?',
  )
  await expect(pictured(d)).not.toContainText('Linked')

  // Back to the matching question from the map: it is focused there.
  await map(d)
    .getByRole('button', { name: /^Step 2: Were the same subjects/ })
    .click()
  await expect(d.getByRole('radio', { name: 'No, different subjects in each group' })).toBeFocused()
  await d.getByRole('radio', { name: 'Yes, each row is one subject, plate or day' }).check()
  // "What kind of values?" is asked again on this branch: kept; the scatter question isn't.
  await expect(map(d).getByRole('button')).toHaveText([
    /How many groups.*Two groups/,
    /Were the same subjects.*Yes, each row is one subject/,
    /What kind of values.*Measurements/,
    'Leads to: Paired t test',
  ])
  await expect(d.getByRole('heading', { name: 'Recommended: Paired t test' })).toBeVisible()
  await expect(pictured(d)).toContainText('Linked, same subjects, row by row: Control, Treated.')
  await expect(schematic(d).locator('.schematic-question')).toHaveText(
    'Is the mean change from Control to Treated different from zero?',
  )
  await expect(schematic(d)).toContainText('Independent units: 10 subjects')
  await expect(d).not.toContainText(/P = |P < 0\./)
})

test('the map by keyboard: arrows move along the path, Enter goes back', async ({ page }) => {
  const d = await guide(page, 'Enzyme activity')
  await d.getByRole('button', { name: 'Are the groups different?' }).click()
  await d.getByRole('radio', { name: 'No, different subjects in each group' }).check()
  await d
    .getByRole('radio', { name: 'Measurements (activity, area, the concentration of one analyte)' })
    .check()
  const next = map(d).getByRole('button', { name: /next: Can the groups vary/ })
  await expect(next).toHaveAttribute('aria-current', 'step')
  await expect(next).toHaveAttribute('tabindex', '0')
  await next.focus()
  await page.keyboard.press('ArrowUp')
  await expect(map(d).getByRole('button', { name: /^Step 3: What kind of values/ })).toBeFocused()
  await page.keyboard.press('Home')
  const first = map(d).getByRole('button', { name: /^Step 1: How many groups/ })
  await expect(first).toBeFocused()
  await expect(first).toHaveAttribute('aria-label', /from your table/)
  await page.keyboard.press('ArrowDown')
  await expect(
    map(d).getByRole('button', { name: /^Step 2: Were the same subjects/ }),
  ).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(d.getByRole('radio', { name: 'No, different subjects in each group' })).toBeFocused()
  // End: the last step, the recommendation still to come (greyed, still focusable).
  await map(d)
    .getByRole('button', { name: /^Step 1/ })
    .focus()
  await page.keyboard.press('End')
  await expect(map(d).getByRole('button', { name: /^Then: a recommendation/ })).toBeFocused()
})

test('two-way: the factor grid, links within the subjects and the independent units', async ({
  page,
}) => {
  const d = await guide(page, 'Genotype × treatment')
  await d
    .getByRole('button', { name: 'How do two factors affect the response (and do they interact)?' })
    .click()
  await expect(pictured(d)).toContainText(
    'A grid of Row factor (Wild type and Knockout) by Column factor (Vehicle and Drug).',
  )
  await d.getByRole('radio', { name: 'Both factors' }).check()
  await expect(schematic(d)).toContainText('Independent units: 6 subjects, not 24 values.')
  await expect(pictured(d)).toContainText('Linked, same subjects')
  await d.getByRole('radio', { name: 'No, a different subject in every cell' }).check()
  await expect(schematic(d)).toContainText('Independent units: 24 values, one subject each.')
  await expect(pictured(d)).not.toContainText('Linked')
  await d.getByRole('radio', { name: 'At each row, compare the columns (simple effects)' }).check()
  await d.getByRole('radio', { name: 'Every pair', exact: true }).check()
  await expect(schematic(d).locator('.schematic-question')).toHaveText(
    'At each level of Row factor, which Column factor means differ?',
  )
  await expect(schematic(d)).toContainText(
    'Each level of Row factor is its own family of 1 comparison (Šidák).',
  )
  await expect(d).not.toContainText(/P = |P < 0\./)
})

test('a narrow dialog: the schematic is a strip above the questions', async ({ page }) => {
  const d = await guide(page, 'Enzyme activity')
  await page.setViewportSize({ width: 860, height: 800 })
  await d.getByRole('button', { name: 'Are the groups different?' }).click()
  const strip = d.locator('.guide-strip')
  await expect(strip.locator('.schematic img')).toBeVisible()
  await expect(d.getByRole('complementary', { name: 'What will be tested' })).toHaveCount(0)
  await strip.getByRole('button', { name: 'Hide what will be tested' }).click()
  await expect(strip.locator('.schematic')).toHaveCount(0)
  await strip.getByRole('button', { name: 'Show what will be tested' }).click()
  await expect(strip.locator('.schematic img')).toBeVisible()
})
