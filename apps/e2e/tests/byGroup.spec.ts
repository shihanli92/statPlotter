import type { Locator } from '@playwright/test'
import { expect, test } from './fixtures.ts'
import {
  expectUndo,
  formatPanel,
  inWindow,
  menu,
  openGraph,
  pointMarks,
  preview,
  selectLayer,
  seriesPicker,
  undo,
} from './helpers-graph.ts'

// Roadmap 49a: a layer's appearance by data set or fixed — ggplot's `aes(fill = group)` beside
// `geom_point(colour = 'black')`. The Format panel's Appearance table (docked, and in the window
// "Open in window" makes) sets each aesthetic by data set, fixed or none; recipes set fill and
// outline in one step; shapes cycle through the graph's order; a data set set by hand keeps its
// own until Reset.

const SCATTER = { example: 'getting-started', graph: 'Enzyme activity (scatter)' }
const BARS = { example: 'getting-started', graph: 'Dose response (bars)' }

/** The fill and stroke of every point symbol, by data set key. */
async function symbolPaint(svg: Locator) {
  return pointMarks(svg).evaluateAll((els) =>
    els.map((e) => ({
      key: (e.getAttribute('data-id') ?? '').split('/')[1],
      fill: e.getAttribute('fill'),
      stroke: e.getAttribute('stroke'),
      round: /a[\d.]+,[\d.]+ 0 1,0/.test(e.getAttribute('d') ?? ''),
    })),
  )
}

/** The table of the layer shown in a Format place. */
const table = (scope: Locator) => scope.locator('.appearance-table')

test('docked panel: a recipe, then shapes by data set; each one undo step', async ({ page }) => {
  const svg = await openGraph(page, SCATTER.example, SCATTER.graph)
  await menu(page, 'Format', 'Format graph…')
  const p = formatPanel(page)
  await selectLayer(p, /^Points/)
  await expect(table(p)).toBeVisible()
  // No Hollow or Border: the table's Fill and Outline rows.
  await expect(p.getByLabel('Hollow')).toHaveCount(0)
  await expect(p.getByLabel('Fill', { exact: true })).toHaveValue('series')

  // ggplot's shape 21 with colour = 'black': each data set's fill, a black outline.
  await p.getByRole('button', { name: 'Filled by group, black outline' }).click()
  await expectUndo(page, 'Filled by group, black outline')
  await expect
    .poll(async () => {
      const paint = await symbolPaint(svg)
      return {
        black: paint.every((s) => s.stroke === '#000000'),
        fills: new Set(paint.map((s) => s.fill)).size,
      }
    })
    .toEqual({ black: true, fills: 2 })
  await expect(p.getByLabel('Outline', { exact: true })).toHaveValue('fixed')

  // Shapes by data set: the first data set's circles, the second's squares.
  await p.getByLabel('Shape', { exact: true }).selectOption('series')
  await expectUndo(page, 'Shape by data set')
  await expect
    .poll(async () => {
      const paint = await symbolPaint(svg)
      const keys = [...new Set(paint.map((s) => s.key))]
      return keys.map((k) => paint.filter((s) => s.key === k).every((s) => s.round))
    })
    .toEqual([true, false])
  await expect(p.locator('.appearance-cycle summary')).toHaveText('●  ■  ▲  ◆  ✕  +')
  await undo(page)
  await expect.poll(async () => (await symbolPaint(svg)).every((s) => s.round)).toBe(true)
})

test('docked panel: a data set set by hand keeps its shape until Reset', async ({ page }) => {
  const svg = await openGraph(page, SCATTER.example, SCATTER.graph)
  await menu(page, 'Format', 'Format graph…')
  const p = formatPanel(page)
  await selectLayer(p, /^Points/)
  // One data set: diamonds of its own.
  const options = await seriesPicker(p)
    .locator('option')
    .evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value))
  const first = options.find((v) => v.startsWith('dataSet:'))!
  await seriesPicker(p).selectOption(first)
  await p.getByLabel('Fixed shape').first().selectOption('diamond')
  // Back to every data set: the layer's shape by data set; the diamond stays (set by hand).
  await seriesPicker(p).selectOption('all')
  await p.getByLabel('Shape', { exact: true }).selectOption('series')
  const note = p.locator('.appearance-note')
  await expect(note).toHaveText('1 data set set by hand · Reset')
  const key = first.slice('dataSet:'.length)
  const own = svg.locator(`path[data-id^="series/${key}/point/"]`).first()
  await expect
    .poll(async () => /a[\d.]+,[\d.]+ 0 1,0/.test((await own.getAttribute('d')) ?? ''))
    .toBe(false)
  await note.getByRole('button', { name: 'Reset shape of data sets set by hand' }).click()
  await expectUndo(page, 'Reset data sets’ shape')
  await expect(note).toHaveCount(0)
  // Its place's shape now: the first data set's, a circle.
  await expect
    .poll(async () => /a[\d.]+,[\d.]+ 0 1,0/.test((await own.getAttribute('d')) ?? ''))
    .toBe(true)
})

test('in a window: bars with a fixed fill and outline, by the table’s modes', async ({ page }) => {
  // (The colour popovers inside the modal window are another branch's fix: this checks the window
  // through the table's mode controls, which need no popover.)
  const svg = await openGraph(page, BARS.example, BARS.graph)
  await menu(page, 'Format', 'Format graph…')
  const d = await inWindow(page, 'Format graph')
  await selectLayer(d, /^Bars/)
  await d.getByLabel('Fill', { exact: true }).selectOption('fixed')
  await d.getByLabel('Outline', { exact: true }).selectOption('series')
  const bars = (scope: Locator) =>
    scope
      .locator('rect[data-id^="series/"][data-id*="/bar"]')
      .evaluateAll((els) =>
        els.map((e) => ({ fill: e.getAttribute('fill'), stroke: e.getAttribute('stroke') })),
      )
  // The preview first: white bars outlined in their data set's colours.
  await expect
    .poll(async () => {
      const b = await bars(preview(page))
      return [b.every((x) => x.fill === '#ffffff'), new Set(b.map((x) => x.stroke)).size > 1]
    })
    .toEqual([true, true])
  // The example's translucent bars keep their opacity; made solid here.
  const opacity = d.getByLabel('Fill opacity')
  await expect(opacity).toHaveValue('0.35')
  await opacity.fill('1')
  await opacity.press('Tab')
  await expect
    .poll(
      async () =>
        (await preview(page)
          .locator('rect[data-id^="series/"][data-id*="/bar"]')
          .first()
          .getAttribute('fill-opacity')) ?? '1',
    )
    .toBe('1')
  await d.getByRole('button', { name: 'OK', exact: true }).click()
  await expect(d).toBeHidden()
  await expect.poll(async () => (await bars(svg)).every((x) => x.fill === '#ffffff')).toBe(true)
  await undo(page)
  await expect.poll(async () => (await bars(svg)).some((x) => x.fill !== '#ffffff')).toBe(true)
})

test('in a window: the graph’s order of shapes, edited like the palette', async ({ page }) => {
  const svg = await openGraph(page, SCATTER.example, SCATTER.graph)
  await menu(page, 'Format', 'Format graph…')
  const d = await inWindow(page, 'Format graph')
  await selectLayer(d, /^Points/)
  await d.getByLabel('Shape', { exact: true }).selectOption('series')
  // The order folded under the row: the second place a triangle.
  await d.locator('.appearance-cycle summary').click()
  await d.getByLabel('Shape 2', { exact: true }).selectOption('triangle')
  await expect(d.locator('.appearance-cycle summary')).toHaveText('●  ▲  ▲  ◆  ✕  +')
  await d.getByRole('button', { name: 'OK', exact: true }).click()
  await expect(d).toBeHidden()
  await expect
    .poll(async () =>
      svg
        .locator('path[data-id^="series/"][data-id*="/point/"]')
        .evaluateAll((els) => els.some((e) => /^M[\d.]+,[\d.]+L/.test(e.getAttribute('d') ?? ''))),
    )
    .toBe(true)
})
