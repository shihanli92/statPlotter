import type { Locator, Page } from '@playwright/test'
import { expect, openExample, test } from './fixtures.ts'
import {
  builderLayers,
  builderPreview,
  canvas,
  expectUndo,
  inWindow,
  layerList,
  menu,
  openBuilder,
  openSheet,
  plotStyle,
  pointMarks,
  reachable,
  section,
  selectLayer,
} from './helpers-graph.ts'

// Layer order (roadmap 33e): every layer list shows the front first (the top row is drawn in
// front, as in Illustrator, PowerPoint or Photoshop); up moves a layer towards the front, in the
// graph builder, the Format panel's list of layers, the canvas's context menu and with the
// keyboard; and the preview and the canvas draw what the list says.

/** The ids of an SVG's marks in drawing order (back to front). */
const drawn = (svg: Locator) =>
  svg.evaluate((el) =>
    [...el.querySelectorAll('[data-id]')].map((e) => e.getAttribute('data-id') ?? ''),
  )

/**
 * Whether every mark matching `front` is drawn after (over) every mark matching `back`; both
 * must be drawn.
 */
async function over(svg: Locator, front: RegExp, back: RegExp): Promise<boolean> {
  const ids = await drawn(svg)
  const at = (re: RegExp) => ids.flatMap((id, i) => (re.test(id) ? [i] : []))
  const f = at(front)
  const b = at(back)
  expect(f.length, `${front} drawn`).toBeGreaterThan(0)
  expect(b.length, `${back} drawn`).toBeGreaterThan(0)
  if (Math.min(...f) > Math.max(...b)) return true
  if (Math.max(...f) < Math.min(...b)) return false
  throw new Error(`${front} and ${back} interleave`)
}

/** The builder's rows' names, top to bottom. */
const rowNames = (b: Locator) =>
  builderLayers(b).evaluateAll((rows) => rows.map((r) => r.getAttribute('aria-label') ?? ''))

/** A builder row by its layer's name. */
const row = (b: Locator, name: RegExp) => builderLayers(b).filter({ has: b.page().getByText(name) })

/** The builder on a table, its layers cleared, then plot styles added in turn. */
async function builder(page: Page, example: string, table: string, styles: string[]) {
  await openExample(page, example)
  await openSheet(page, table, 'Data Tables')
  const b = await openBuilder(page)
  // The top row first: attached layers sit above their hosts, so nothing asks.
  while ((await builderLayers(b).count()) > 0)
    await b
      .getByRole('button', { name: /^Delete / })
      .first()
      .click()
  for (const style of styles) {
    await plotStyle(b, style).click()
    await expect(plotStyle(b, style)).toHaveAttribute('aria-pressed', 'true')
  }
  return b
}

const POINTS = /^series\/[^/]+\/point\//
const PAIRS = /^pairs\//

test('builder: before-after lines moved to the top row draw over the points, then under', async ({
  page,
}) => {
  const b = await builder(page, 'getting-started', 'Enzyme activity', ['Before–after', 'Points'])
  const shown = builderPreview(b)
  // Each new layer on top: the points over the lines.
  expect(await rowNames(b)).toEqual(['Points (every value)', 'Before–after (values)'])
  await expect(row(b, /^Points/).locator('.layer-end')).toHaveText(/front/)
  expect(await over(shown, POINTS, PAIRS)).toBe(true)
  // The lines up to the top row: drawn after the points.
  const pairs = row(b, /^Before–after/)
  await pairs.getByRole('button', { name: /up \(to the front\)$/ }).click()
  expect(await rowNames(b)).toEqual(['Before–after (values)', 'Points (every value)'])
  await expect.poll(() => over(shown, PAIRS, POINTS)).toBe(true)
  // At the top, up is off; down puts them back under the points.
  await expect(pairs.getByRole('button', { name: /up \(to the front\)$/ })).toBeDisabled()
  await pairs.getByRole('button', { name: /down \(to the back\)$/ }).click()
  expect(await rowNames(b)).toEqual(['Points (every value)', 'Before–after (values)'])
  await expect.poll(() => over(shown, POINTS, PAIRS)).toBe(true)
  // The keyboard: Alt+↑ on a focused row moves it up (to the front), the focus going along.
  await row(b, /^Before–after/).focus()
  await page.keyboard.press('Alt+ArrowUp')
  expect(await rowNames(b)).toEqual(['Before–after (values)', 'Points (every value)'])
  await expect(builderLayers(b).first()).toBeFocused()
  await expect.poll(() => over(shown, PAIRS, POINTS)).toBe(true)
  // The graph made draws it so.
  await b.getByRole('button', { name: /^Create/ }).click()
  await expect(b).toBeHidden()
  expect(await over(canvas(page), PAIRS, POINTS)).toBe(true)
})

/** Opens the graph's place (Format graph…) in the dialog: its layers listed at the top. */
async function appearance(page: Page): Promise<Locator> {
  await menu(page, 'Format', 'Format graph…')
  return inWindow(page, 'Format graph')
}

/** Format graph's layer names, top to bottom. */
const formatNames = (d: Locator) =>
  layerList(d)
    .getByRole('option')
    .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''))

test('Format › Layers and the canvas menu: forward and backward, the canvas following', async ({
  page,
}) => {
  const b = await builder(page, 'getting-started', 'Enzyme activity', ['Points', 'Before–after'])
  await b.getByRole('button', { name: /^Create/ }).click()
  await expect(b).toBeHidden()
  const svg = canvas(page)
  expect(await over(svg, PAIRS, POINTS)).toBe(true)

  // Format graph › Layers: the top row in front; Send backward moves the lines down, under the
  // points; the canvas follows on OK, one undo step.
  let d = await appearance(page)
  expect(await formatNames(d)).toEqual(['Before–after (values)', 'Points (every value)'])
  await selectLayer(d, /^Before–after/)
  const layers = section(d, 'Layers')
  await expect(layers.getByRole('button', { name: 'Bring layer forward' })).toBeDisabled()
  await layers.getByRole('button', { name: 'Send layer backward' }).click()
  expect(await formatNames(d)).toEqual(['Points (every value)', 'Before–after (values)'])
  await d.getByRole('button', { name: 'OK' }).click()
  await expect(d).toBeHidden()
  await expect.poll(() => over(svg, POINTS, PAIRS)).toBe(true)
  await expectUndo(page, 'Format graph')

  // Bring forward again with the keyboard: Alt+↑ in the list.
  d = await appearance(page)
  await selectLayer(d, /^Before–after/)
  await layerList(d).focus()
  await page.keyboard.press('Alt+ArrowUp')
  expect(await formatNames(d)).toEqual(['Before–after (values)', 'Points (every value)'])
  await d.getByRole('button', { name: 'OK' }).click()
  await expect(d).toBeHidden()
  await expect.poll(() => over(svg, PAIRS, POINTS)).toBe(true)

  // The canvas: a point's menu sends its layer backward (under the lines), then brings it
  // forward again.
  const point = await reachable(pointMarks(svg))
  await point.click({ button: 'right' })
  let ctx = page.getByRole('menu', { name: 'Graph element' })
  await expect(ctx.getByRole('menuitem', { name: 'Send layer backward' })).toBeDisabled()
  await ctx.getByRole('menuitem', { name: 'Bring layer forward' }).click()
  await expect.poll(() => over(svg, POINTS, PAIRS)).toBe(true)
  await expectUndo(page, 'Bring layer forward')
  // (Nothing selected: a right-click on a point of the selected layer would pick the point.)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await (await reachable(pointMarks(svg))).click({ button: 'right' })
  ctx = page.getByRole('menu', { name: 'Graph element' })
  await expect(ctx.getByRole('menuitem', { name: 'Bring layer forward' })).toBeDisabled()
  await ctx.getByRole('menuitem', { name: 'Send layer backward' }).click()
  await expect.poll(() => over(svg, PAIRS, POINTS)).toBe(true)
  await expectUndo(page, 'Send layer backward')
  // And Format › Layers › Move forward on the selected layer.
  await (await reachable(pointMarks(svg))).click()
  await menu(page, 'Format', 'Layers', 'Move forward')
  await expect.poll(() => over(svg, POINTS, PAIRS)).toBe(true)
})

/**
 * In the builder, as added: `front` drawn over `back`; `back` moved up drawn over it, then down
 * again under it.
 */
async function swap(
  b: Locator,
  front: { row: RegExp; marks: RegExp },
  back: { row: RegExp; marks: RegExp },
) {
  const shown = builderPreview(b)
  expect(await over(shown, front.marks, back.marks)).toBe(true)
  await row(b, back.row)
    .getByRole('button', { name: /up \(to the front\)$/ })
    .click()
  await expect.poll(() => over(shown, back.marks, front.marks)).toBe(true)
  await row(b, back.row)
    .getByRole('button', { name: /down \(to the back\)$/ })
    .click()
  await expect.poll(() => over(shown, front.marks, back.marks)).toBe(true)
  await b.getByRole('button', { name: 'Cancel' }).click()
  await expect(b).toBeHidden()
}

const LINE = { row: /^Line/, marks: /^series\/[^/]+\/line\// }
const BAND = { row: /^Band/, marks: /^series\/[^/]+\/envelope\// }
const POINTS_ROW = { row: /^Points/, marks: POINTS }
const BARS = { row: /^Bars/, marks: /^series\/[^/]+\/bar\// }

// New layers: a fill (bars, a band, the grand mean…) goes behind the marks already there, a mark
// (points, a line…) on top.
test('XY: a band added to a line goes behind it; either in front', async ({ page }) => {
  const b = await builder(page, 'more-graphs', 'Tumour volume', ['Line', 'Band'])
  await swap(b, LINE, BAND)
})

test('grouped: bars added to points go behind them; either in front', async ({ page }) => {
  const b = await builder(page, 'grouped', 'Genotype × treatment', ['Points', 'Bars'])
  await swap(b, POINTS_ROW, BARS)
})

test('grouped: points added to bars go in front of them', async ({ page }) => {
  const b = await builder(page, 'grouped', 'Genotype × treatment', ['Bars', 'Points'])
  await swap(b, POINTS_ROW, BARS)
})

test('category: the grand mean added to points goes behind them; either in front', async ({
  page,
}) => {
  const b = await builder(page, 'getting-started', 'Enzyme activity', ['Points', 'Grand mean'])
  await swap(b, POINTS_ROW, { row: /^Grand mean/, marks: /^grandMean/ })
})
