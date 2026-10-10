import type { Locator, Page } from '@playwright/test'
import { expect, openExample, test } from './fixtures.ts'
import { cell } from './helpers-data.ts'
import {
  box,
  builderPreview,
  canvas,
  dialog,
  expand,
  inWindow,
  marks,
  menu,
  openBuilder,
  openSheet,
  plotStyle,
  pointMarks,
  undo,
} from './helpers-graph.ts'

// Graphs of a multiple-variables table's variables straight from the table (roadmap 34a): the
// builder's Map variables takes X and Y of any type and the graph follows — text × number a
// category per level (grouped by a text colour variable), number × text turned, text × text
// counts (bars, percents, a heat map), number × number an XY graph of the rows; the order of the
// levels (natural for new graphs, roadmap 34f); a table edit's new level drawn at once.

const TRIAL = 'Blood pressure trial'

/** The builder over the trial table (the multiple-variables example). */
async function trialBuilder(page: Page): Promise<Locator> {
  await openExample(page, 'multiple-variables')
  await openSheet(page, TRIAL, 'Data Tables')
  return openBuilder(page)
}

const mapping = (b: Locator) => b.getByRole('group', { name: 'Map variables' })

/** Picks a variable on X, Y or colour by its label in the list ("Group (text)"). */
async function map(b: Locator, field: 'X' | 'Y' | 'Colour' | 'Show', label: string) {
  await mapping(b).getByLabel(field, { exact: true }).selectOption({ label })
}

/** The texts of the canvas's category tick labels, in their order. */
const tickTexts = (svg: Locator) =>
  marks(svg, 'axis/x/tickLabel/').evaluateAll((els) => els.map((e) => e.textContent ?? ''))

async function create(page: Page, b: Locator): Promise<Locator> {
  await b.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(b).toBeHidden()
  const svg = canvas(page)
  await expect(svg).toBeVisible()
  return svg
}

test('text × number: a category per level, each variable’s type shown', async ({ page }) => {
  const b = await trialBuilder(page)
  // Every variable is offered on X with its type.
  const x = mapping(b).getByLabel('X', { exact: true })
  await expect(x.locator('option', { hasText: 'Group (text)' })).toHaveCount(1)
  await expect(x.locator('option', { hasText: 'BMI (number, calculated)' })).toHaveCount(1)
  await map(b, 'X', 'Group (text)')
  await map(b, 'Y', 'Change (number, calculated)')
  // The icons follow the axes: before-after lines join a row across variables, not offered.
  await expect(plotStyle(b, 'Before–after')).toHaveCount(0)
  await expect(plotStyle(b, 'Violin')).toHaveAttribute('aria-disabled', 'false')
  await expect(builderPreview(b)).toBeVisible()
  const svg = await create(page, b)
  // A new graph's levels in natural order (roadmap 34f).
  expect(await tickTexts(svg)).toEqual(['High dose', 'Low dose', 'Placebo'])
  await expect(pointMarks(svg).first()).toBeAttached()
  // The two missed visits (no Change) are left out, and said so.
  await expect(
    page
      .getByRole('main')
      .locator('.warnings li')
      .filter({ hasText: '2 rows without a value of Change (empty or excluded) left out.' }),
  ).toHaveCount(1)
})

test('a text colour variable groups the categories, side by side and stacked', async ({ page }) => {
  const b = await trialBuilder(page)
  await b.getByRole('radio', { name: 'Box with points by group', exact: true }).click()
  await map(b, 'Colour', 'Sex (text)')
  await expect(b.getByLabel('Groups', { exact: true })).toHaveValue('dodge')
  const svg = await create(page, b)
  await expect(marks(svg, 'legend/').filter({ hasText: /^F$/ })).toHaveCount(1)
  await expect(marks(svg, 'legend/').filter({ hasText: /^M$/ })).toHaveCount(1)
  expect(await tickTexts(svg)).toEqual(['High dose', 'Low dose', 'Placebo'])
  // Stacked: bars of the means (boxes and points don't stack, said so).
  await menu(page, 'Insert', 'New graph…')
  const s = dialog(page, /^(New|Another) graph of/)
  await map(s, 'X', 'Group (text)')
  await map(s, 'Colour', 'Sex (text)')
  await s.getByLabel('Groups', { exact: true }).selectOption('stack')
  await expect(s.getByRole('status').filter({ hasText: /^Stacked bars draw no/ })).toHaveCount(1)
  const stacked = await create(page, s)
  await expect(stacked.locator('[data-id^="series/"][data-id*="/bar/"]')).toHaveCount(6)
})

test('number × text: the graph turned, categories down the left', async ({ page }) => {
  const b = await trialBuilder(page)
  await map(b, 'X', 'SBP before (number)')
  await map(b, 'Y', 'Group (text)')
  await expect(b.getByRole('checkbox', { name: /^Horizontal/ })).toBeChecked()
  const svg = await create(page, b)
  const [first, second] = [
    await box(marks(svg, 'axis/x/tickLabel/0')),
    await box(marks(svg, 'axis/x/tickLabel/1')),
  ]
  // Stacked down the left: one under the other.
  expect(second.y).toBeGreaterThan(first.y + first.h / 2)
  expect(Math.abs(second.x + second.w - (first.x + first.w))).toBeLessThan(2)
})

test('text × text: counts, percents and a count heat map', async ({ page }) => {
  const b = await trialBuilder(page)
  await map(b, 'X', 'Group (text)')
  await map(b, 'Y', 'Sex (text)')
  // The Y variable gives the groups; bars count the rows of each combination.
  await expect(mapping(b).getByLabel('Colour', { exact: true })).toBeDisabled()
  await expect(plotStyle(b, 'Bars')).toHaveAttribute('aria-pressed', 'true')
  await expect(plotStyle(b, 'Points')).toHaveCount(0)
  await map(b, 'Show', 'Percent of total')
  await b.getByLabel('Groups', { exact: true }).selectOption('stack')
  const svg = await create(page, b)
  await expect(marks(svg, 'axis/y/title')).toHaveText('Percent of total')
  await expect(svg.locator('[data-id^="series/"][data-id*="/bar/"]').first()).toBeAttached()
  // A heat map of the counts.
  await menu(page, 'Insert', 'New graph…')
  const h = dialog(page, /^(New|Another) graph of/)
  await map(h, 'X', 'Group (text)')
  await map(h, 'Y', 'Sex (text)')
  await plotStyle(h, 'Heat map').click()
  const heat = await create(page, h)
  await expect(heat.locator('rect[data-id*="/cell/"]').first()).toBeAttached()
})

test('number × number: an XY graph of the rows', async ({ page }) => {
  const b = await trialBuilder(page)
  await map(b, 'X', 'Age (number)')
  await map(b, 'Y', 'BMI (number, calculated)')
  await expect(mapping(b).getByLabel('Size', { exact: true })).toBeVisible()
  const svg = await create(page, b)
  await expect(pointMarks(svg).first()).toBeAttached()
})

test('the order of levels: in the builder, then in Format graph, undoably', async ({ page }) => {
  const b = await trialBuilder(page)
  await map(b, 'X', 'Group (text)')
  await mapping(b).getByRole('button', { name: 'Order of levels…' }).click()
  const order = dialog(page, 'Order of levels')
  // Natural order to start with (roadmap 34f): High dose, Low dose, Placebo.
  await expect(order.getByRole('button', { name: 'Move High dose up' })).toBeDisabled()
  await order.getByRole('button', { name: 'Move Placebo up' }).click()
  await order.getByRole('button', { name: 'Move Placebo up' }).click()
  await order.getByRole('button', { name: 'Done' }).click()
  const svg = await create(page, b)
  expect(await tickTexts(svg)).toEqual(['Placebo', 'High dose', 'Low dose'])
  // The graph's place › Order of levels: sorted A→Z.
  await menu(page, 'Format', 'Format graph…')
  const f = await inWindow(page, /^Format graph/)
  await expand(f, 'Order of levels')
  await f
    .getByRole('group', { name: /^Group \(categories\)/ })
    .getByRole('button', {
      name: 'Sort A→Z',
    })
    .click()
  await f.getByRole('button', { name: 'OK', exact: true }).click()
  await expect(f).toBeHidden()
  await expect.poll(() => tickTexts(svg)).toEqual(['High dose', 'Low dose', 'Placebo'])
  await undo(page)
  await expect.poll(() => tickTexts(svg)).toEqual(['Placebo', 'High dose', 'Low dose'])
})

test('a text cell edited to a new level appears on the graph', async ({ page }) => {
  const b = await trialBuilder(page)
  await map(b, 'X', 'Group (text)')
  const graphName = await b.getByLabel('Name', { exact: true }).inputValue()
  const svg = await create(page, b)
  expect(await tickTexts(svg)).toEqual(['High dose', 'Low dose', 'Placebo'])
  await openSheet(page, TRIAL, 'Data Tables')
  // Row 1's Group (the grid's second column: after the row title).
  await cell(page, 0, 1).click()
  await page.keyboard.type('Run-in')
  await page.keyboard.press('Enter')
  await openSheet(page, graphName, 'Graphs')
  // A new graph's levels in natural order (roadmap 34f): the new one by its name.
  await expect
    .poll(() => tickTexts(canvas(page)))
    .toEqual(['High dose', 'Low dose', 'Placebo', 'Run-in'])
})
