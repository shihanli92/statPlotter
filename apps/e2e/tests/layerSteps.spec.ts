import type { Locator, Page } from '@playwright/test'
import { expect, test } from './fixtures.ts'
import {
  colourButton,
  dblclickOn,
  expectUndo,
  formatPanel,
  inWindow,
  openGraph,
  panelHeading,
  pickColour,
  preview,
  seriesPicker,
} from './helpers-graph.ts'

// Roadmap 49b: one layer at a time in the Format view. A mark clicked opens only the layer that
// drew it, its data set picked; ‹ and › step through every layer of the graph in the Layers
// list's order (the front first), the data set kept where the next layer draws it, the canvas'
// selection following; "n of m ▾" is a menu of every layer; the data set's own colour is a row at
// the top. The same in the docked panel and in its window.

const SCATTER = { example: 'getting-started', graph: 'Enzyme activity (scatter)' }

const steps = (scope: Locator) => scope.locator('.layer-steps')
const inFront = (scope: Locator) => scope.getByRole('button', { name: 'Layer in front' })
const behind = (scope: Locator) => scope.getByRole('button', { name: 'Layer behind' })
const layerMenu = (scope: Locator) => scope.getByRole('button', { name: /^Layer \d+ of \d+/ })
const hint = (page: Page) => page.locator('.selection-hint')
const COLOUR = 'Data set colour (every layer)'

/** The first data point of the first data set, and that data set's key. */
async function firstPoint(svg: Locator) {
  const point = svg.locator('[data-id^="series/"][data-id$="/point/0"]').first()
  const key = (await point.getAttribute('data-id'))!.split('/')[1]!
  return { point, key }
}

test('docked panel: a point opens its layer alone; ‹ › and the menu reach every layer', async ({
  page,
}) => {
  const svg = await openGraph(page, SCATTER.example, SCATTER.graph)
  const { point, key } = await firstPoint(svg)
  await dblclickOn(point)
  const p = formatPanel(page)
  // The points' layer (the back one of three), its data set picked; only its own sections.
  await expect(panelHeading(page)).toHaveText(/^Points/)
  await expect(layerMenu(p)).toHaveText('3 of 3 ▾')
  await expect(seriesPicker(p)).toHaveValue(`dataSet:${key}`)
  await expect(behind(p)).toBeDisabled()
  await expect(p.getByRole('button', { name: 'Error bars', exact: true })).toHaveCount(0)
  await expect(colourButton(p, COLOUR)).toBeVisible()

  // ‹ (from the keyboard): the error bars in front of the points, the data set kept, the
  // selection following, the focus staying on the arrow.
  await inFront(p).focus()
  await page.keyboard.press('Enter')
  await expect(panelHeading(page)).toHaveText(/^Error bars/)
  await expect(layerMenu(p)).toHaveText('2 of 3 ▾')
  await expect(seriesPicker(p)).toHaveValue(`dataSet:${key}`)
  await expect(hint(page)).toContainText('selected in “Error bars')
  await expect(inFront(p)).toBeFocused()
  // ‹ again: the front layer; ‹ stops there (no wrap), the focus kept on the menu.
  await page.keyboard.press('Enter')
  await expect(panelHeading(page)).toHaveText(/^Centre line/)
  await expect(inFront(p)).toBeDisabled()
  await expect(layerMenu(p)).toBeFocused()

  // The menu lists every layer, the front first; choosing one jumps to it.
  await layerMenu(p).click()
  const items = page
    .getByRole('menu', { name: 'Layers of the graph' })
    .getByRole('menuitemcheckbox')
  await expect(items).toHaveText([/Centre line/, /Error bars/, /Points/])
  await expect(items.first()).toHaveAttribute('aria-checked', 'true')
  await items.nth(2).click()
  await expect(panelHeading(page)).toHaveText(/^Points/)
  await expect(seriesPicker(p)).toHaveValue(`dataSet:${key}`)
  await expect(hint(page)).toContainText('selected in “Points')

  // Every data set: the picker's All, no colour row; the arrows keep it (the whole layer).
  await seriesPicker(p).selectOption('all')
  await expect(colourButton(p, COLOUR)).toHaveCount(0)
  await inFront(p).click()
  await expect(seriesPicker(p)).toHaveValue('all')
  await expect(hint(page)).toContainText('Layer “Error bars')
})

test('docked panel: the data set’s colour row colours it in every layer', async ({ page }) => {
  const svg = await openGraph(page, SCATTER.example, SCATTER.graph)
  const { point, key } = await firstPoint(svg)
  const fill = () => point.getAttribute('fill')
  const automatic = await fill()
  await dblclickOn(point)
  const p = formatPanel(page)
  await expect(colourButton(p, COLOUR)).toHaveAccessibleName(`${COLOUR} Automatic`)
  await pickColour(p, COLOUR, 'Palette colour 5')
  await expectUndo(page, 'Colour')
  await expect.poll(fill).not.toBe(automatic)
  const colour = (await fill())!
  // The error bars' view shows the same row; drawn by data set, they take the colour too.
  await inFront(p).click()
  await expect(colourButton(p, COLOUR)).toHaveAccessibleName(`${COLOUR} ${colour.toUpperCase()}`)
  await seriesPicker(p).selectOption('all')
  await p.getByLabel('Line', { exact: true }).selectOption('series')
  await expect
    .poll(() => svg.locator(`[data-id^="series/${key}/error"]`).first().getAttribute('stroke'))
    .toBe(colour)
})

test('in its window: the arrows and the menu, the preview’s highlight following', async ({
  page,
}) => {
  const svg = await openGraph(page, SCATTER.example, SCATTER.graph)
  const { point, key } = await firstPoint(svg)
  await dblclickOn(point)
  const d = await inWindow(page, 'Format graph')
  // The window names the layer beside its number.
  await expect(layerMenu(d)).toContainText('Points')
  await expect(layerMenu(d)).toContainText('3 of 3')
  await expect(seriesPicker(d)).toHaveValue(`dataSet:${key}`)
  const halos = preview(page).locator('.selection')
  await expect(halos.first()).toBeAttached()
  await inFront(d).click()
  await expect(layerMenu(d)).toContainText('Error bars')
  await expect(seriesPicker(d)).toHaveValue(`dataSet:${key}`)
  await expect(halos.first()).toBeAttached()
  // A change on the layer landed on, applied with OK as one step.
  await d.getByLabel('Cap width (pt)').fill('14')
  await d.getByLabel('Cap width (pt)').press('Tab')
  await layerMenu(d).click()
  await page
    .getByRole('menu', { name: 'Layers of the graph' })
    .getByRole('menuitemcheckbox', { name: /^Centre line/ })
    .click()
  await expect(layerMenu(d)).toContainText('Centre line')
  await expect(steps(d)).toContainText('1 of 3')
  await d.getByRole('button', { name: 'OK' }).click()
  await expect(d).toHaveCount(0)
  await expectUndo(page, 'Format graph')
})
