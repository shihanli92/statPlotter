import type { Locator, Page } from '@playwright/test'
import { expect, openExample, test } from './fixtures.ts'
import {
  addLayer,
  box,
  newGraph as builderGraph,
  expand,
  expectUndo,
  inWindow,
  layerList,
  marks,
  menu,
  openSheet,
  preview,
  section,
  selectLayer,
  undo,
} from './helpers-graph.ts'

// More graph types (roadmap 30): horizontal and stacked graphs, bar baselines, XY time-course
// options and heat maps — made from the graph builder's presets and changed in Format graph
// (layers in Appearance, roadmap 33c), checked in the scene's SVG.

/** Insert › New graph… with a preset, plot styles toggled (and the Horizontal box when asked). */
const newGraph = (
  page: Page,
  preset: string | null,
  opts: { name?: string; horizontal?: boolean; styles?: string[] } = {},
) => builderGraph(page, preset, opts.name, { horizontal: opts.horizontal, styles: opts.styles })

/** The graph's place (Format graph…), in the dialog. */
async function graphSettings(page: Page): Promise<Locator> {
  await menu(page, 'Format', 'Format graph…')
  return inWindow(page, 'Format graph')
}

/** Whether the category labels run down the left (horizontal) rather than along the bottom. */
async function categoriesDown(svg: Locator): Promise<boolean> {
  const [a, b] = [
    await box(marks(svg, 'axis/x/tickLabel/0')),
    await box(marks(svg, 'axis/x/tickLabel/1')),
  ]
  // Down the left: the second label below the first (along the bottom they share a line).
  return b.y > a.y + a.h / 2
}

/** A rect's own geometry (browsers' client rects differ on whether the stroke counts). */
const rectOf = (l: Locator) =>
  l.evaluate((e) => ({
    x: Number(e.getAttribute('x')),
    y: Number(e.getAttribute('y')),
    w: Number(e.getAttribute('width')),
    h: Number(e.getAttribute('height')),
  }))

test('horizontal stacked bars from the graph builder, turned back in Format graph', async ({
  page,
}) => {
  await openExample(page, 'grouped')
  await openSheet(page, 'Genotype × treatment', 'Data Tables')
  const svg = await newGraph(page, 'Stacked bars', {
    name: 'Stacked',
    horizontal: true,
  })
  await expect.poll(() => categoriesDown(svg)).toBe(true)
  // One bar per row: the data sets' segments share their y and sit end to end.
  const bars = svg.locator('rect[data-id^="series/"][data-id*="/bar/"]')
  await expect(bars.first()).toBeAttached()
  const ids = await bars.evaluateAll((els) => els.map((e) => e.getAttribute('data-id')!))
  const keys = [...new Set(ids.map((id) => id.split('/')[1]!))]
  expect(keys.length).toBeGreaterThan(1)
  const [first, second] = keys.map((k) => svg.locator(`rect[data-id="series/${k}/bar/0"]`))
  const [p, q] = [await rectOf(first!), await rectOf(second!)]
  expect(Math.abs(p.y - q.y)).toBeLessThan(0.01)
  expect(Math.abs(p.x + p.w - q.x)).toBeLessThan(0.01)

  // Vertical again in the graph's Arrangement, and percent of the row total: the bars' position.
  const d = await graphSettings(page)
  const arrangement = await expand(d, 'Arrangement and spacing')
  await arrangement.getByLabel('Orientation').selectOption('vertical')
  await expect.poll(() => categoriesDown(preview(page))).toBe(false)
  await selectLayer(d, /^Bars/)
  await section(d, 'Bars').getByLabel('Data sets in each row').selectOption('percent')
  await d.getByRole('button', { name: 'OK' }).click()
  await expect(d).toBeHidden()
  await expect.poll(() => categoriesDown(svg)).toBe(false)
  const ticks = await marks(svg, 'axis/y/tickLabel/').allTextContents()
  expect(ticks).toContain('100')
  await expectUndo(page, 'Format graph')
  await undo(page)
  await expect.poll(() => categoriesDown(svg)).toBe(true)
})

/** The graph's place (its layers listed first), from the Format menu, in the dialog. */
async function appearance(page: Page): Promise<Locator> {
  await menu(page, 'Format', 'Format graph…')
  return inWindow(page, 'Format graph')
}

test('a spaghetti plot from the graph builder, then an error band and gaps', async ({ page }) => {
  await openExample(page, 'more-graphs')
  await openSheet(page, 'Tumour volume', 'Data Tables')
  const svg = await newGraph(page, 'Each replicate (spaghetti)', { name: 'Mice' })
  // A line per mouse (six per group), behind each group's mean line.
  await expect(svg.locator('polyline[data-id*="/subject/"]')).toHaveCount(12)
  await expect(svg.locator('polyline[data-id*="/line/"]')).toHaveCount(2)

  const d = await appearance(page)
  // The replicates' lines hidden (their layer's eye), a band added for the SEM.
  await layerList(d)
    .getByTitle(/^Hide Line per replicate/)
    .click()
  await addLayer(d, 'Trends', 'Band')
  await section(d, 'Band').getByLabel('Band', { exact: true }).selectOption('SEM')
  await expect(preview(page).locator('polygon[data-id*="/envelope/"]').first()).toBeAttached()
  await selectLayer(d, /^Line \(mean\)/)
  await section(d, 'Line')
    .getByRole('checkbox', { name: /^Break the line at missing values/ })
    .check()
  await d.getByRole('button', { name: 'OK' }).click()
  await expect(d).toBeHidden()
  await expect(svg.locator('polyline[data-id*="/subject/"]')).toHaveCount(0)
  // The treated group has no values on day 17: its line and band stop there (day 21 is a point
  // alone), where joined they reached all seven days.
  const pointCounts = () =>
    svg
      .locator('polyline[data-id*="/line/"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('points')!.trim().split(/\s+/).length))
  await expect.poll(pointCounts).toEqual([7, 5])
  await expect(svg.locator('polygon[data-id*="/envelope/"]')).toHaveCount(2)
  await expectUndo(page, 'Format graph')
  await undo(page)
  await expect(svg.locator('polygon[data-id*="/envelope/"]')).toHaveCount(0)
  await expect(svg.locator('polyline[data-id*="/subject/"]')).toHaveCount(12)
})

test('geometric error bars and a grand mean line in Format graph', async ({ page }) => {
  await openExample(page, 'more-graphs')
  await openSheet(page, 'Antibody titres', 'Data Tables')
  const svg = await newGraph(page, 'Scatter, mean ± SD', { name: 'Titres' })
  const d = await appearance(page)
  await selectLayer(d, /^Error bars/)
  await section(d, 'Error bars').getByLabel('Centre').selectOption('geomean')
  // The spread follows the centre: the geometric SD factor (what error bars show: Common).
  await expect(section(d, 'Common').getByLabel('Error bars')).toHaveValue('geoSD')
  // A line at the mean of all values: the grand mean's layer.
  await addLayer(d, 'Summaries', 'Grand mean')
  await expect(marks(preview(page), 'grandMean')).toBeAttached()
  await d.getByRole('button', { name: 'OK' }).click()
  await expect(d).toBeHidden()
  await expect(marks(svg, 'grandMean')).toBeAttached()
  await expect(svg.locator('line[data-id^="series/"][data-id*="/error/"]').first()).toBeAttached()
})

test('a heat map from the graph builder: colour map, z-scores and clustering', async ({ page }) => {
  await openExample(page, 'more-graphs')
  await openSheet(page, 'Gene expression', 'Data Tables')
  // The heat map: a frame choice among the plot styles.
  const svg = await newGraph(page, null, { name: 'Expression map', styles: ['Heat map'] })
  const cells = svg.locator('rect[data-id*="/cell/"]')
  await expect(cells).toHaveCount(60)
  await expect(svg.locator('rect[data-id^="colorScale/band/"]')).toHaveCount(64)
  await expect(svg.locator('[data-id^="dendrogram/"]')).toHaveCount(0)
  const rows = () => marks(svg, 'axis/y/tickLabel/').allTextContents()
  const tableOrder = await rows()
  expect(tableOrder.slice(0, 3)).toEqual(['Il6', 'Tnf', 'Il1b'])
  const firstFill = await cells.first().getAttribute('fill')

  const d = await appearance(page)
  await selectLayer(d, /^Heat map/)
  // The heat map's fields in one section: colours, scaling and clustering, values.
  const colours = section(d, 'Heat map')
  await colours.getByLabel('Colour map').selectOption('blueRed')
  const scaling = colours
  await scaling.getByLabel('Values shown').selectOption('row')
  await scaling.getByRole('checkbox', { name: 'Cluster rows' }).check()
  await scaling.getByRole('checkbox', { name: 'Cluster columns' }).check()
  await scaling.getByLabel('Linkage').selectOption('average')
  const shown = preview(page)
  await expect(shown.locator('polyline[data-id^="dendrogram/rows/"]')).toHaveCount(9)
  await expect(shown.locator('polyline[data-id^="dendrogram/columns/"]')).toHaveCount(5)
  await d.getByRole('button', { name: 'OK' }).click()
  await expect(d).toBeHidden()
  await expect(svg.locator('polyline[data-id^="dendrogram/rows/"]')).toHaveCount(9)
  await expect(marks(svg, 'colorScale/title')).toHaveText('z-score')
  expect(await cells.first().getAttribute('fill')).not.toBe(firstFill)
  // Clustered: the rows are no longer in table order, but the same genes.
  const clustered = await rows()
  expect(clustered).not.toEqual(tableOrder)
  expect([...clustered].sort()).toEqual([...tableOrder].sort())
  await expectUndo(page, 'Format graph')
  await undo(page)
  await expect(svg.locator('[data-id^="dendrogram/"]')).toHaveCount(0)
  expect(await rows()).toEqual(tableOrder)
})

test('side-by-side bars stacked in Format graph', async ({ page }) => {
  await openExample(page, 'grouped')
  await openSheet(page, 'Genotype × treatment', 'Data Tables')
  const svg = await newGraph(page, 'Bars with points', { name: 'Side by side' })
  const d = await appearance(page)
  await selectLayer(d, /^Bars/)
  await section(d, 'Bars').getByLabel('Data sets in each row').selectOption('stack')
  await d.getByRole('button', { name: 'OK' }).click()
  await expect(d).toBeHidden()
  const bars = svg.locator('rect[data-id$="/bar/0"]')
  const xs = await bars.evaluateAll((els) => els.map((e) => Number(e.getAttribute('x'))))
  expect(xs.length).toBeGreaterThan(1)
  expect(new Set(xs.map((x) => x.toFixed(2))).size).toBe(1)
})

test('a column graph turned horizontal in Format graph', async ({ page }) => {
  await openExample(page, 'getting-started')
  await openSheet(page, 'Dose response (3 groups)', 'Data Tables')
  const col = await newGraph(page, 'Bars with points', { name: 'Across' })
  await expect.poll(() => categoriesDown(col)).toBe(false)
  const g = await graphSettings(page)
  await (await expand(g, 'Arrangement and spacing'))
    .getByLabel('Orientation')
    .selectOption('horizontal')
  await g.getByRole('button', { name: 'OK' }).click()
  await expect(g).toBeHidden()
  await expect.poll(() => categoriesDown(col)).toBe(true)
  // The value axis runs along the bottom.
  const plot = await box(col.locator('rect[data-id$="/bar"]').first())
  const tick = await box(marks(col, 'axis/y/tickLabel/0'))
  expect(tick.y).toBeGreaterThan(plot.y + plot.h)
})
