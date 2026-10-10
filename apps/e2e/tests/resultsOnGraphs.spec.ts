import type { Locator, Page } from '@playwright/test'
import { expect, openExample, test } from './fixtures.ts'
import { analyze, newTable, runMenu, typeCells } from './helpers-data.ts'
import {
  dblclickOn,
  dialog,
  expectUndo,
  inWindow,
  newGraph,
  openSheet,
  preview,
  undo,
} from './helpers-graph.ts'

// Results on graphs (roadmap 35): an analysis' values drawn on its table's graphs, live — a
// correlation's r and P shown from the analysis dialog, its text edited, following a data edit;
// EC50 with drop lines; the number at risk under survival curves; a bracket at one X of an XY
// graph and one from a group of bars to one, each with its analysis; an inset results table.

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

/** Result labels on a scene (text of result layers). */
const resultTexts = (scope: Locator) => scope.locator('text[data-id^="result/"]')

/** Chooses Insert › Result › <item> from the menu bar (a plain or a ticked item). */
const insertResult = (page: Page, item: string) => runMenu(page, 'Insert', 'Result', item)

async function ok(d: Locator) {
  await d.getByRole('button', { name: 'OK', exact: true }).click()
  await expect(d).toBeHidden()
}

test('r and P from the analysis dialog: edited, then following a data edit', async ({ page }) => {
  await newTable(page, { kind: 'XY', name: 'Doses', sample: true })
  const svg = await newGraph(page, null, 'Doses graph')
  await openSheet(page, 'Doses', 'Data Tables')
  await analyze(page, 'Correlation', async (d) => {
    await d.getByRole('checkbox', { name: 'Show r and P on the graph' }).check()
  })
  await openSheet(page, 'Doses graph', 'Graphs')
  const labels = resultTexts(svg)
  // One label per data set, in its colour.
  await expect(labels).toHaveCount(2)
  await expect(labels.first()).toHaveText(/^r = 0\.\d\d, P [<=] /)
  await expectUndo(page, 'New Correlation')

  // Its text edited in Format graph (the label's layer): a field of the results in braces.
  await dblclickOn(labels.first())
  const d = await inWindow(page, 'Format graph')
  const text = d.getByRole('textbox', { name: /^Label \(values in braces/ })
  await text.click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type('Pearson {r}')
  await expect(resultTexts(preview(page)).first()).toHaveText(/^Pearson 0\.\d\d$/)
  await ok(d)
  await expect(labels.first()).toHaveText(/^Pearson 0\.\d\d$/)
  await expectUndo(page, 'Format graph')
  const before = (await labels.first().textContent()) ?? ''

  // A value of the table changed: the label follows.
  await openSheet(page, 'Doses', 'Data Tables')
  await typeCells(page, 0, 1, [['95']])
  await openSheet(page, 'Doses graph', 'Graphs')
  await expect(labels.first()).not.toHaveText(before)
  await expect(labels.first()).toHaveText(/^Pearson 0\.\d\d$/)
})

test('EC50 with drop lines from a dose-response fit', async ({ page }) => {
  await newTable(page, { kind: 'XY', name: 'Agonist', sample: true })
  const svg = await newGraph(page, null, 'Agonist graph')
  await openSheet(page, 'Agonist', 'Data Tables')
  await analyze(page, 'Nonlinear regression (curve fit)', async (d) => {
    await d.getByRole('checkbox', { name: 'Show EC50 on the graph' }).check()
    await d.getByRole('checkbox', { name: 'Drop lines at EC50' }).check()
  })
  await openSheet(page, 'Agonist graph', 'Graphs')
  await expect(resultTexts(svg)).toHaveCount(2)
  await expect(resultTexts(svg).first()).toHaveText(/^EC50 = \S+ M$/)
  // Each fit's drop lines: down to the X axis, across to the Y axis.
  await expect(svg.locator('line[data-id^="result/"][data-id*="/drop/"]')).toHaveCount(4)
})

test('the number at risk under survival curves, one undo step', async ({ page }) => {
  await newTable(page, { kind: 'Survival', name: 'Trial', sample: true })
  const svg = await newGraph(page, null, 'Trial graph')
  const table = svg.locator('text[data-id^="riskTable/"]')
  await expect(table).toHaveCount(0)
  await insertResult(page, 'Number at risk')
  await expect(svg.locator('[data-id="riskTable/title"]')).toHaveText('Number at risk')
  // A count per group under each X tick.
  const ticks = await svg.locator('text[data-id^="axis/x/tickLabel/"]').count()
  await expect(svg.locator('text[data-id^="riskTable/"][data-id$="/0"]')).toHaveCount(2)
  expect(await table.count()).toBeGreaterThanOrEqual(1 + 2 * (ticks + 1))
  await expectUndo(page, 'Show number at risk')
  await undo(page)
  await expect(table).toHaveCount(0)
})

test('a bracket at one X of an XY graph, labelled by its own analysis', async ({ page }) => {
  await newTable(page, { kind: 'XY', name: 'Course', sample: true })
  const svg = await newGraph(page, null, 'Course graph')
  await insertResult(page, 'Bracket at one X…')
  const d = dialog(page, 'Add bracket at one X')
  await expect(d.getByLabel('At X =')).toHaveValue('-4')
  await d.getByLabel('Label', { exact: true }).selectOption('p')
  await d.getByRole('button', { name: 'Add' }).click()
  await expect(d).toBeHidden()
  await expect(svg.locator('polyline[data-id^="annotation/"]')).toHaveCount(1)
  await expect(svg.locator('text[data-id^="annotation/"]')).toHaveText(/^P [<=] /)
  await expectUndo(page, 'Add bracket at one X')
})

test('a bracket from a group of bars to one bar, the group pooled', async ({ page }) => {
  await newTable(page, { kind: 'Column', name: 'Donors', dataSets: 4 })
  await typeCells(page, 0, 0, [
    ['10', '11', '9', '18'],
    ['12', '13', '12', '21'],
    ['11', '12', '10', '20'],
  ])
  const svg = await newGraph(page, 'Bars with points', 'Donors graph')
  await insertResult(page, 'Bracket from a group to one…')
  const d = dialog(page, 'Add bracket from a group to one')
  await d.getByLabel('Label', { exact: true }).selectOption('p')
  await d.getByRole('button', { name: 'Add' }).click()
  await expect(d).toBeHidden()
  // The bracket and the line spanning the group.
  await expect(svg.locator('polyline[data-id^="annotation/"]')).toHaveCount(2)
  await expect(svg.locator('polyline[data-id$="/group"]')).toHaveCount(1)
  await expect(svg.locator('text[data-id^="annotation/"]')).toHaveText(/^P [<=] /)
})

test('an inset table of descriptive statistics in the plot', async ({ page }) => {
  await openExample(page, 'getting-started')
  await openSheet(page, 'Enzyme activity (scatter)', 'Graphs')
  await insertResult(page, 'Inset results table…')
  const d = dialog(page, 'Add inset results table')
  await d.getByLabel('Analysis', { exact: true }).selectOption({ label: 'Descriptive statistics' })
  await d.getByRole('button', { name: 'Add' }).click()
  await expect(d).toBeHidden()
  const cells = page
    .getByRole('main')
    .getByRole('img', { name: 'Graph', exact: true })
    .locator('text[data-id^="annotation/"][data-id*="/table/cell/"]')
  await expect(cells.filter({ hasText: /^Mean$/ })).toHaveCount(1)
  await expectUndo(page, 'Add inset results table')
})
