import type { Locator, Page } from '@playwright/test'
import { expect, test } from './fixtures.ts'
import { columnTitles, grid, newTable, runMenu, typeCells } from './helpers-data.ts'
import {
  dialog,
  expand,
  expectUndo,
  inWindow,
  marks,
  menu,
  newGraph,
  preview,
  section,
  undo,
} from './helpers-graph.ts'

// Axis extras (roadmap 36): a +/− treatment grid built in its editor and seeded from the
// categories' names, two-level labels on a grouped graph, a broken axis with a set piece length,
// text at values of a continuous axis, a shaded band at typed values, a scale bar in place of an
// axis and UMAP-style corner arrows — each one undo step. (Fields in a Format dialog apply as
// they are typed; Enter there is the dialog's OK.)

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

async function ok(d: Locator) {
  await d.getByRole('button', { name: 'OK', exact: true }).click()
  await expect(d).toBeHidden()
}

/** Renames a column table's data sets by double-clicking their titles. */
async function renameDataSets(page: Page, titles: readonly string[]) {
  for (const [i, t] of titles.entries()) {
    await columnTitles(page)
      .nth(i + 1)
      .dblclick()
    await grid(page).getByRole('textbox').fill(t)
    await page.keyboard.press('Enter')
  }
  await expect(columnTitles(page)).toHaveText(['', ...titles])
}

/** Opens Format axes on one of the axes (its tab: "X axis", "Y axis"). */
async function formatAxes(page: Page, tab: string): Promise<Locator> {
  await menu(page, 'Format', 'Format axes…')
  const d = await inWindow(page, 'Format axes')
  await expect(d).toBeVisible()
  await d.getByRole('tab', { name: tab, exact: true }).click()
  return d
}

test('a treatment grid seeded from the names, then edited by hand', async ({ page }) => {
  await newTable(page, { kind: 'Column', name: 'Death', dataSets: 3 })
  await typeCells(page, 0, 0, [
    ['100', '92', '41'],
    ['96', '95', '45'],
  ])
  await renameDataSets(page, ['Ctrl', 'TNF', 'TNF+CHX'])
  const svg = await newGraph(page, 'Bars with points', 'Death graph')
  const cells = marks(svg, 'axis/treatments/')

  await runMenu(page, 'Insert', 'Treatment grid (+/−)…')
  const d = dialog(page, 'Treatment grid')
  await d.getByRole('button', { name: 'Seed from the category names' }).click()
  await expect(d.getByRole('status')).toHaveText('Seeded 2 rows from the names.')
  await expect(d.getByRole('textbox', { name: 'Row 1 title' })).toHaveValue('TNF')
  await expect(d.getByRole('textbox', { name: 'CHX, TNF+CHX' })).toHaveValue('+')
  await ok(d)
  // Row titles and a symbol per category; the names under the axis give way to the grid.
  await expect(svg.locator('[data-id="axis/treatments/0/title"]')).toHaveText('TNF')
  await expect(svg.locator('[data-id="axis/treatments/1/title"]')).toHaveText('CHX')
  await expect(svg.locator('text[data-id^="axis/treatments/0/"]')).toHaveText([
    '−',
    '+',
    '+',
    'TNF',
  ])
  await expect(marks(svg, 'axis/x/tickLabel/')).toHaveCount(0)
  await expectUndo(page, 'Treatment grid')

  // A third row typed by hand.
  await runMenu(page, 'Insert', 'Treatment grid (+/−)…')
  await d.getByRole('button', { name: 'Add a row' }).click()
  await d.getByRole('textbox', { name: 'Row 3 title' }).fill('Z-VAD')
  await d.getByRole('textbox', { name: 'Z-VAD, TNF+CHX' }).fill('+')
  await ok(d)
  await expect(svg.locator('[data-id="axis/treatments/2/title"]')).toHaveText('Z-VAD')
  await expect(svg.locator('text[data-id^="axis/treatments/2/"]')).toHaveText([
    '−',
    '−',
    '+',
    'Z-VAD',
  ])
  await undo(page)
  await expect(svg.locator('[data-id="axis/treatments/2/title"]')).toHaveCount(0)
  await undo(page)
  await expect(cells).toHaveCount(0)
})

test('two-level labels on a grouped graph: groups spanning their bars', async ({ page }) => {
  await newTable(page, { kind: 'Grouped', name: 'Stim', sample: true })
  const svg = await newGraph(page, 'Bars with points', 'Stim graph')
  const before = await marks(svg, 'axis/x/tickLabel/').count()
  await runMenu(page, 'Insert', 'Two-level category labels')
  const spans = svg.locator('text[data-id^="axis/spans/1/"]')
  await expect(spans).toHaveCount(before)
  // The bars are named under them: more names than groups.
  expect(await marks(svg, 'axis/x/tickLabel/').count()).toBeGreaterThan(before)
  await expectUndo(page, 'Two-level labels')
  await undo(page)
  await expect(spans).toHaveCount(0)
})

test('a broken axis with a set piece length', async ({ page }) => {
  await newTable(page, { kind: 'Column', name: 'Counts', dataSets: 3 })
  await typeCells(page, 0, 0, [
    ['2', '4', '95'],
    ['3', '5', '102'],
  ])
  const svg = await newGraph(page, 'Bars with points', 'Counts graph')
  const d = await formatAxes(page, 'Y axis')
  const breaks = await expand(d, 'Axis breaks')
  await breaks.getByRole('button', { name: 'Add a break' }).click()
  await breaks.getByRole('spinbutton', { name: 'From' }).fill('10')
  await breaks.getByRole('spinbutton', { name: 'To' }).fill('80')
  await breaks.getByRole('textbox', { name: 'Piece 1' }).fill('0.6')
  await breaks.getByLabel('Marks').selectOption('zigzag')
  await expect(marks(preview(page), 'axis/y/break/0')).toHaveCount(1)
  await ok(d)
  const zigzag = svg.locator('polyline[data-id="axis/y/break/0"]')
  await expect(zigzag).toHaveCount(1)
  // The low piece is 0.6 of the axis: longer than the high one.
  // (The runs of the line go top down: the high piece, then the low one.)
  const high = await svg.locator('[data-id="axis/y/line/0"]').boundingBox()
  const low = await svg.locator('[data-id="axis/y/line/1"]').boundingBox()
  expect(low!.height).toBeGreaterThan(high!.height)
  await expectUndo(page, 'Format axes')
})

test('text at values of a continuous axis', async ({ page }) => {
  await newTable(page, { kind: 'XY', name: 'Bands', sample: true })
  const svg = await newGraph(page, null, 'Bands graph')
  const d = await formatAxes(page, 'X axis')
  const ticks = await expand(d, 'Ticks at values')
  await ticks.getByRole('button', { name: 'Add text at a value' }).click()
  // (The sample's X runs from −9 to −4.)
  await ticks.getByRole('spinbutton', { name: 'Value' }).fill('-6')
  await ticks.getByRole('textbox', { name: 'Text' }).fill('Monomer')
  await ok(d)
  // The ticks are at the text's values alone.
  await expect(marks(svg, 'axis/x/tickLabel/')).toHaveText(['Monomer'])
  await expectUndo(page, 'Format axes')
})

test('a shaded band and a line at typed values', async ({ page }) => {
  await newTable(page, { kind: 'Column', name: 'Levels', sample: true })
  const svg = await newGraph(page, 'Bars with points', 'Levels graph')
  await runMenu(page, 'Insert', 'Shaded band between values…')
  const d = await inWindow(page, 'Format graph')
  await expect(d).toBeVisible()
  const band = section(d, 'Band')
  await band.getByRole('spinbutton', { name: 'From' }).fill('10')
  await band.getByRole('spinbutton', { name: 'To' }).fill('20')
  await d.getByRole('textbox', { name: 'Text', exact: true }).fill('Normal range')
  await ok(d)
  await expect(svg.locator('rect[data-id^="result/"][data-id$="/band"]')).toHaveCount(1)
  await expect(svg.locator('text[data-id$="/lineLabel"]')).toHaveText('Normal range')
  await expectUndo(page, 'Format graph')
  await undo(page)
  await undo(page)
  await expect(svg.locator('rect[data-id^="result/"]')).toHaveCount(0)

  await runMenu(page, 'Insert', 'Line at a value…')
  const f = await inWindow(page, 'Format graph')
  await ok(f)
  await expect(svg.locator('line[data-id^="result/"][data-id$="/line"]')).toHaveCount(1)
})

test('a scale bar in place of the X axis, and corner arrows', async ({ page }) => {
  await newTable(page, { kind: 'XY', name: 'Map', sample: true })
  const svg = await newGraph(page, null, 'Map graph')
  const d = await formatAxes(page, 'X axis')
  const bar = await expand(d, 'Scale bar')
  await bar.getByRole('checkbox', { name: 'Show a scale bar' }).check()
  await bar.getByRole('spinbutton', { name: 'Length (data units)' }).fill('2')
  await bar.getByRole('button', { name: /^Hide the axis/ }).click()
  await ok(d)
  await expect(svg.locator('[data-id="axis/x/scaleBar/line"]')).toHaveCount(1)
  await expect(svg.locator('[data-id="axis/x/scaleBar/label"]')).toHaveText('2')
  await expect(marks(svg, 'axis/x/tick/')).toHaveCount(0)
  await expectUndo(page, 'Format axes')
  await undo(page)
  await expect(svg.locator('[data-id="axis/x/scaleBar/line"]')).toHaveCount(0)

  // Corner arrows: the graph's frame, in its Common settings (roadmap 46).
  await menu(page, 'Format', 'Format graph…')
  const f = await inWindow(page, 'Format graph')
  await section(f, 'Common').getByLabel('Frame', { exact: true }).selectOption('arrows')
  await ok(f)
  await expect(svg.locator('[data-id="arrows/x/line"]')).toHaveCount(1)
  await expect(svg.locator('[data-id="arrows/y/line"]')).toHaveCount(1)
  await expect(marks(svg, 'axis/y/tickLabel/')).toHaveCount(0)
  await expectUndo(page, 'Format graph')
  await undo(page)
  await expect(svg.locator('[data-id="arrows/x/line"]')).toHaveCount(0)
})
