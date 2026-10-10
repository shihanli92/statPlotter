import type { Locator, Page } from '@playwright/test'
import { expect, openExample, test } from './fixtures.ts'
import {
  builderLayers,
  builderPreview,
  canvas,
  marks,
  openBuilder,
  openSheet,
  pickPreset,
  plotStyle,
} from './helpers-graph.ts'

// The layer combinations of roadmap 33d, each built from the graph builder's icons: drawn in its
// preview and on the canvas once created. And drawing by layer: moving a layer in the list moves
// its marks, those a frame draws (before-after lines) included.

/** Toggles plot styles on (or off) in the builder. */
async function toggle(b: Locator, ...styles: string[]): Promise<void> {
  for (const style of styles) {
    const icon = plotStyle(b, style)
    const was = await icon.getAttribute('aria-pressed')
    await icon.click()
    await expect(icon).not.toHaveAttribute('aria-pressed', was ?? '')
  }
}

/** The builder on a table, its layers cleared (a preset's, removed one by one). */
async function emptyBuilder(page: Page, example: string, table: string, preset: string) {
  await openExample(page, example)
  await openSheet(page, table, 'Data Tables')
  const b = await openBuilder(page)
  await pickPreset(b, preset)
  while ((await builderLayers(b).count()) > 0)
    await b
      .getByRole('button', { name: /^Delete / })
      .first()
      .click()
  return b
}

/** Creates the graph and returns its canvas. */
async function create(page: Page, b: Locator): Promise<Locator> {
  await b.getByRole('button', { name: /^Create/ }).click()
  await expect(b).toBeHidden()
  const svg = canvas(page)
  await expect(svg).toBeVisible()
  return svg
}

/** Marks drawn in a scope whose id contains `part`. */
const withPart = (scope: Locator, part: string) => scope.locator(`[data-id*="${part}"]`)

test('column: violin + box + points, a line through the means, mean symbols', async ({ page }) => {
  const b = await emptyBuilder(page, 'getting-started', 'Enzyme activity', 'Scatter, mean ± SD')
  await toggle(b, 'Violin', 'Box', 'Points')
  const shown = builderPreview(b)
  // The violin keeps v1's box-like ids; the box inside it adds its layer's (`box@box`).
  await expect(shown.locator('[data-id$="/box"]').first()).toBeAttached()
  await expect(withPart(shown, '/box@box').first()).toBeAttached()
  await expect(withPart(shown, '/point/').first()).toBeAttached()
  await toggle(b, 'Join means', 'Mean symbol')
  await expect(marks(shown, 'means/').first()).toBeAttached()
  // A second points layer: its marks' ids name it.
  await expect(withPart(shown, '/point@means').first()).toBeAttached()
  const svg = await create(page, b)
  await expect(marks(svg, 'means/').first()).toBeAttached()
  await expect(withPart(svg, '/point@means')).toHaveCount(2)
})

test('column: a histogram of the values, as percents', async ({ page }) => {
  const b = await emptyBuilder(page, 'getting-started', 'Cell area', 'Scatter, mean ± SD')
  await toggle(b, 'Histogram')
  const shown = builderPreview(b)
  await expect(shown.locator('rect[data-id*="/bar/"]').first()).toBeAttached()
  // Only binned bars on a histogram; the measure and the bin width per layer.
  await expect(plotStyle(b, 'Points')).toHaveCount(0)
  await b.getByLabel('Bars (counts): statistic').selectOption('percent')
  await expect(builderLayers(b)).toHaveAttribute('aria-label', 'Bars (percent)')
  await b.getByLabel('Bars (percent): bin width').fill('50')
  const svg = await create(page, b)
  await expect(svg.locator('rect[data-id*="/bar/"]').first()).toBeAttached()
  await expect(marks(svg, 'axis/y/title')).toContainText('Percent')
})

test('grouped: an error band across the rows, box plots with joined means', async ({ page }) => {
  const b = await emptyBuilder(page, 'grouped', 'Genotype × treatment', 'Scatter, mean ± SD')
  await toggle(b, 'Band', 'Join means')
  await b.getByLabel('Groups').selectOption('aligned')
  const shown = builderPreview(b)
  await expect(withPart(shown, '/envelope/').first()).toBeAttached()
  await expect(withPart(shown, '/line/').first()).toBeAttached()
  await toggle(b, 'Band', 'Box')
  await b.getByLabel('Groups').selectOption('dodge')
  await expect(withPart(shown, '/box/').first()).toBeAttached()
  const svg = await create(page, b)
  await expect(withPart(svg, '/line/').first()).toBeAttached()
  await expect(withPart(svg, '/box/').first()).toBeAttached()
})

test('contingency: 100% stacked bars labelled with percents, and a heat map', async ({ page }) => {
  await openExample(page, 'clinical')
  await openSheet(page, 'Response by dose', 'Data Tables')
  const b = await openBuilder(page)
  await b.getByLabel('Groups').selectOption('percent')
  await toggle(b, 'Value labels')
  const shown = builderPreview(b)
  await expect(withPart(shown, '/label/').first()).toContainText('%')
  const svg = await create(page, b)
  await expect(withPart(svg, '/label/')).toHaveCount(6)
  const map = await openBuilder(page)
  await toggle(map, 'Heat map')
  await expect(builderPreview(map).locator('rect[data-id*="/cell/"]')).toHaveCount(6)
  const heat = await create(page, map)
  await expect(heat.locator('rect[data-id*="/cell/"]')).toHaveCount(6)
})

test('XY: stacked areas, and a step line', async ({ page }) => {
  const b = await emptyBuilder(page, 'more-graphs', 'Tumour volume', 'Mean ± SD, joined')
  await toggle(b, 'Area')
  await b.getByLabel('Areas').selectOption('stack')
  const shown = builderPreview(b)
  await expect(withPart(shown, '/area/')).toHaveCount(2)
  // Points would sit at unstacked values: not offered, with the reason.
  await expect(plotStyle(b, 'Points')).toHaveAttribute('aria-disabled', 'true')
  await expect(plotStyle(b, 'Points')).toHaveAccessibleDescription(/stacked areas/)
  await b.getByLabel('Areas').selectOption('overlap')
  await toggle(b, 'Area', 'Step')
  await expect(withPart(shown, '/step/').first()).toBeAttached()
  const svg = await create(page, b)
  await expect(withPart(svg, '/step/').first()).toBeAttached()
})

test('multiple variables: points coloured by a text variable, lines by group', async ({ page }) => {
  await openExample(page, 'multiple-variables')
  await openSheet(page, 'Blood pressure trial', 'Data Tables')
  const b = await openBuilder(page)
  await pickPreset(b, 'Bubble plot')
  await b.getByLabel('Size', { exact: true }).selectOption('')
  // Each variable shows its type (roadmap 34a).
  await b.getByLabel('Colour', { exact: true }).selectOption({ label: 'Group (text)' })
  await toggle(b, 'Lines by group')
  const shown = builderPreview(b)
  // One line per group, in the colour legend's colours.
  await expect(withPart(shown, '/line/')).toHaveCount(3)
  const svg = await create(page, b)
  await expect(withPart(svg, '/line/')).toHaveCount(3)
  await expect(svg.locator('[data-id^="legend/bubble/color/"][data-id$="/swatch"]')).toHaveCount(3)
})

/** The ids of a scene's marks in drawing order (back to front). */
const drawn = (svg: Locator) =>
  svg.evaluate((el) =>
    [...el.querySelectorAll('[data-id]')].map((e) => e.getAttribute('data-id') ?? ''),
  )

test('drawing by layer: moving before-after lines in front of the points and back', async ({
  page,
}) => {
  const b = await emptyBuilder(page, 'getting-started', 'Enzyme activity', 'Scatter, mean ± SD')
  await toggle(b, 'Points', 'Before–after')
  const shown = builderPreview(b)
  const pairsName = 'Before–after (values)'
  /** Whether the before-after lines are drawn after (in front of) the points. */
  const pairsInFront = async (svg: Locator) => {
    const ids = await drawn(svg)
    const pairs = ids.findIndex((id) => id.startsWith('pairs/'))
    const points = ids.findIndex((id) => /^series\/[^/]+\/point\//.test(id))
    expect(pairs).toBeGreaterThanOrEqual(0)
    expect(points).toBeGreaterThanOrEqual(0)
    return pairs > points
  }
  // Added on top of the list: in front of the points.
  await expect(marks(shown, 'pairs/').first()).toBeAttached()
  expect(await pairsInFront(shown)).toBe(true)
  await b.getByRole('button', { name: `Move ${pairsName} down (to the back)` }).click()
  await expect.poll(() => pairsInFront(shown)).toBe(false)
  await b.getByRole('button', { name: `Move ${pairsName} up (to the front)` }).click()
  await expect.poll(() => pairsInFront(shown)).toBe(true)
  // The graph made draws them so too.
  const svg = await create(page, b)
  expect(await pairsInFront(svg)).toBe(true)
})
