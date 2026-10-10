import type { Locator, Page } from '@playwright/test'
import { expect, openExample, test } from './fixtures.ts'
import { cell } from './helpers-data.ts'
import {
  canvas,
  dialog,
  expand,
  inWindow,
  marks,
  menu,
  openBuilder,
  openSheet,
  plotStyle,
  pointLabels,
  pointMarks,
  undo,
} from './helpers-graph.ts'

// Variables mapped to appearance (roadmap 34b): the builder's Colour, Shape, Size and Label rows
// (only what the layers chosen can show), the legends they bring (a colour bar for a number),
// Format graph › Appearance by variable with undo, and a table edit's new level drawn at once.

const TRIAL = 'Blood pressure trial'

async function trialBuilder(page: Page): Promise<Locator> {
  await openExample(page, 'multiple-variables')
  await openSheet(page, TRIAL, 'Data Tables')
  return openBuilder(page)
}

const mapping = (b: Locator) => b.getByRole('group', { name: 'Map variables' })
const field = (b: Locator, name: string) => mapping(b).getByLabel(name, { exact: true })

async function map(b: Locator, name: string, label: string) {
  await field(b, name).selectOption({ label })
}

async function create(page: Page, b: Locator): Promise<Locator> {
  await b.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(b).toBeHidden()
  const svg = canvas(page)
  await expect(svg).toBeVisible()
  return svg
}

/** A legend's entry labels (`legend/aes/<aes>/<k>/label`), in the order drawn. */
const legendTexts = (svg: Locator, aes: string) =>
  svg
    .locator(`[data-id^="legend/aes/${aes}/"][data-id$="/label"]`)
    .evaluateAll((els) =>
      els
        .filter((e) => /\/\d+\/label$/.test(e.getAttribute('data-id') ?? ''))
        .map((e) => e.textContent ?? ''),
    )

test('Shape, Size and Label rows: the variables of their types, what the layers can show', async ({
  page,
}) => {
  const b = await trialBuilder(page)
  await map(b, 'X', 'Group (text)')
  await map(b, 'Y', 'SBP after (number)')
  // Shapes are a text variable's levels, sizes a number variable's values.
  await expect(field(b, 'Shape').locator('option', { hasText: 'Sex (text)' })).toHaveCount(1)
  await expect(field(b, 'Shape').locator('option', { hasText: 'Age (number)' })).toHaveCount(0)
  await expect(field(b, 'Size').locator('option', { hasText: 'Sex (text)' })).toHaveCount(0)
  await map(b, 'Shape', 'Sex (text)')
  await map(b, 'Size', 'Age (number)')
  await map(b, 'Label', 'Group (text)')
  const svg = await create(page, b)
  await expect.poll(() => legendTexts(svg, 'shape')).toEqual(['F', 'M'])
  await expect(marks(svg, 'legend/aes/size/0/symbol')).toBeAttached()
  // Different sizes, and every point labelled with its group.
  const sizes = await pointMarks(svg).evaluateAll((els) =>
    els.map((e) => Math.round((e as SVGGraphicsElement).getBBox().width)),
  )
  expect(new Set(sizes).size).toBeGreaterThan(2)
  await expect(pointLabels(svg).first()).toBeAttached()
  // Bars alone show no row's point: the rows say why, disabled.
  await menu(page, 'Insert', 'New graph…')
  const n = dialog(page, /^(New|Another) graph of/)
  await map(n, 'X', 'Group (text)')
  await plotStyle(n, 'Points').click()
  await expect(field(n, 'Shape')).toBeDisabled()
  await expect(mapping(n).locator('.map-why').first()).toHaveText('Needs points of every row')
})

test('colour by a number: a colour bar; Format graph’s colour map and a level’s symbol, undoably', async ({
  page,
}) => {
  const b = await trialBuilder(page)
  await map(b, 'X', 'Group (text)')
  await map(b, 'Y', 'SBP after (number)')
  await map(b, 'Colour', 'BMI (number, calculated)')
  await map(b, 'Shape', 'Sex (text)')
  const svg = await create(page, b)
  const band = marks(svg, 'legend/aes/color/bar/band/0')
  await expect(band).toBeAttached()
  const before = await band.getAttribute('fill')
  await menu(page, 'Format', 'Format graph…')
  const f = await inWindow(page, /^Format graph/)
  const s = await expand(f, 'Appearance by variable')
  await s.getByLabel('Colour map', { exact: true }).selectOption('magma')
  await s.getByLabel('M', { exact: true }).selectOption('triangle')
  await f.getByRole('button', { name: 'OK', exact: true }).click()
  await expect(f).toBeHidden()
  await expect.poll(() => band.getAttribute('fill')).not.toBe(before)
  await expect(marks(svg, 'legend/aes/shape/1/symbol')).toHaveAttribute('d', /.+/)
  const triangle = await marks(svg, 'legend/aes/shape/1/symbol').getAttribute('d')
  await undo(page)
  await expect.poll(() => band.getAttribute('fill')).toBe(before)
  await expect
    .poll(() => marks(svg, 'legend/aes/shape/1/symbol').getAttribute('d'))
    .not.toBe(triangle)
})

test('a table edit’s new level takes the next symbol, in the legend at once', async ({ page }) => {
  const b = await trialBuilder(page)
  await map(b, 'X', 'Group (text)')
  await map(b, 'Y', 'SBP after (number)')
  await map(b, 'Shape', 'Sex (text)')
  const graphName = await b.getByLabel('Name', { exact: true }).inputValue()
  const svg = await create(page, b)
  await expect.poll(() => legendTexts(svg, 'shape')).toEqual(['F', 'M'])
  await openSheet(page, TRIAL, 'Data Tables')
  // Row 1's Sex (the grid's third column: after the row title and Group).
  await cell(page, 0, 2).click()
  await page.keyboard.type('X')
  await page.keyboard.press('Enter')
  await openSheet(page, graphName, 'Graphs')
  // A new graph's levels are in natural order (roadmap 34f): the new level by its name.
  await expect.poll(() => legendTexts(canvas(page), 'shape')).toEqual(['F', 'M', 'X'])
  await undo(page)
  await expect.poll(() => legendTexts(canvas(page), 'shape')).toEqual(['F', 'M'])
})

test('XY graphs: colour and shape of one variable share one legend', async ({ page }) => {
  const b = await trialBuilder(page)
  await map(b, 'X', 'Age (number)')
  await map(b, 'Y', 'BMI (number, calculated)')
  await map(b, 'Colour', 'Sex (text)')
  await map(b, 'Shape', 'Sex (text)')
  const svg = await create(page, b)
  await expect(marks(svg, 'legend/bubble/color/0/symbol')).toBeAttached()
  await expect(marks(svg, 'legend/bubble/shape')).toHaveCount(0)
})
