import type { Locator, Page } from '@playwright/test'
import { expect, openExample, test } from './fixtures.ts'
import {
  appMod,
  box,
  drag,
  expectUndo,
  formatPanel,
  inWindow,
  menu,
  openGraph,
  openSheet,
  pointMarks,
  pointOn,
  reachable,
  sectionToggle,
  seriesPicker,
  undo,
} from './helpers-graph.ts'

// Roadmap 44: one selection model on the graph canvas — Shift-click, ⌘A, Tab / Enter / Escape,
// moving, nudging and deleting several elements in one step, wider hits on thin lines, the
// right-click menu of several elements, and a double-click on a point formatting its data set.

test.use({ viewport: { width: 1400, height: 1000 } })

const EXAMPLE = 'getting-started'
const SCATTER = 'Enzyme activity (scatter)'
const BARS = 'Dose response (bars)'

/** The selection halos drawn on the canvas. */
const halos = (svg: Locator) => svg.locator('g.selection > *')
const hint = (page: Page) => page.locator('.selection-hint .selection-text')
const announced = (page: Page) => page.getByTestId('selection-announcement')
/** The bars of a bar graph (one per data set). */
const bars = (svg: Locator) => svg.locator('rect[data-id^="series/"][data-id$="/bar"]')

/** A click where the element can be reached, with modifiers held. */
async function clickAt(el: Locator, modifiers: string[] = [], button: 'left' | 'right' = 'left') {
  const page = el.page()
  const p = await pointOn(el)
  for (const m of modifiers) await page.keyboard.down(m)
  await page.mouse.click(p.x, p.y, { button })
  for (const m of modifiers.reverse()) await page.keyboard.up(m)
}

/** Whether a selection halo is drawn on this element (centred within its box). */
async function haloed(svg: Locator, el: Locator): Promise<boolean> {
  const b = await box(el)
  const all = await halos(svg).evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    }),
  )
  return all.some(
    (h) => h.x >= b.x - 2 && h.x <= b.x + b.w + 2 && h.y >= b.y - 2 && h.y <= b.y + b.h + 2,
  )
}

/** Focuses the canvas by a click on the empty space around the graph (nothing selected). */
async function focusCanvas(page: Page) {
  await page
    .getByRole('main')
    .locator('.canvas')
    .click({ position: { x: 4, y: 4 } })
  await expect(page.getByRole('main').locator('.canvas')).toBeFocused()
}

/** The marquee's live preview: hover halos on what it would pick. */
const preview = (svg: Locator) => svg.locator('g.hover.preview > *')

type Box = { x: number; y: number; w: number; h: number }

/**
 * Draws a box on the canvas from one corner to the other (screen pixels), with modifiers held;
 * `during` runs before the release.
 */
async function marquee(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  opts: { modifiers?: string[]; during?: () => Promise<void> } = {},
) {
  const mods = opts.modifiers ?? []
  for (const m of mods) await page.keyboard.down(m)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 8 })
  await opts.during?.()
  await page.mouse.up()
  for (const m of [...mods].reverse()) await page.keyboard.up(m)
}

/** `b` grown by `pad` pixels on every side. */
const grown = (b: Box, pad: number): Box => ({
  x: b.x - pad,
  y: b.y - pad,
  w: b.w + 2 * pad,
  h: b.h + 2 * pad,
})
const corner = (b: Box, right: boolean, bottom: boolean) => ({
  x: right ? b.x + b.w : b.x,
  y: bottom ? b.y + b.h : b.y,
})

async function relative(el: Locator, svg: Locator) {
  const a = await box(svg.locator('[data-id="axis/y/line"]'))
  const b = await box(el)
  return { x: b.x - a.x, y: b.y - a.y }
}

test('Shift-click selects several bars, each haloed; Shift-click again takes one out', async ({
  page,
}) => {
  const svg = await openGraph(page, EXAMPLE, BARS)
  await expect(bars(svg).nth(1)).toBeAttached()
  const [first, second] = [bars(svg).nth(0), bars(svg).nth(1)]
  await clickAt(first)
  await expect(hint(page)).toContainText('Data set selected')
  await expect.poll(() => haloed(svg, first)).toBe(true)
  expect(await haloed(svg, second)).toBe(false)
  const one = await halos(svg).count()

  await clickAt(second, ['Shift'])
  await expect(hint(page)).toContainText('2 elements selected')
  await expect(announced(page)).toHaveText('2 elements selected')
  await expect.poll(() => haloed(svg, second)).toBe(true)
  expect(await haloed(svg, first)).toBe(true)
  expect(await halos(svg).count()).toBeGreaterThan(one)

  // ⌘-click (Ctrl-click off the Mac) toggles too: the first bar goes out, the second stays.
  await clickAt(first, ['ControlOrMeta'])
  await expect.poll(() => haloed(svg, first)).toBe(false)
  expect(await haloed(svg, second)).toBe(true)
  await expect(hint(page)).toContainText('Data set selected')
})

test('⌘A selects every part of the graph; Escape clears it', async ({ page }) => {
  const svg = await openGraph(page, EXAMPLE, SCATTER)
  await focusCanvas(page)
  await expect(hint(page)).toHaveText(/^Graph: /)
  await page.keyboard.press(`${await appMod(page)}+a`)
  await expect(hint(page)).toContainText(/\d+ elements selected/)
  await expect(announced(page)).toHaveText(/^\d+ elements selected$/)
  // The title, the axis title, the axes, tick labels and data points are haloed.
  for (const id of ['title', 'axis/y/title', 'axis/x/line', 'axis/y/tickLabel/0'])
    await expect.poll(() => haloed(svg, svg.locator(`[data-id="${id}"]`))).toBe(true)
  expect(await halos(svg).count()).toBeGreaterThan(await pointMarks(svg).count())
  await page.keyboard.press('Escape')
  await expect(halos(svg)).toHaveCount(0)
  await expect(hint(page)).toHaveText(/^Graph: /)
  await expect(announced(page)).toHaveText('Graph')
})

test('arrow keys and a drag move two selected titles together, one undo step each', async ({
  page,
}) => {
  const svg = await openGraph(page, EXAMPLE, SCATTER)
  const title = svg.locator('[data-id="title"]')
  const yTitle = svg.locator('[data-id="axis/y/title"]')
  const t0 = await relative(title, svg)
  const y0 = await relative(yTitle, svg)
  await clickAt(title)
  await clickAt(yTitle, ['Shift'])
  await expect(hint(page)).toContainText('2 elements selected')
  await expect(hint(page)).toContainText('arrow keys to move 2')
  // 1 pt = 2 px at 150%.
  await page.keyboard.press('ArrowRight')
  await expect.poll(async () => (await relative(title, svg)).x - t0.x).toBeCloseTo(2, 0)
  await expect.poll(async () => (await relative(yTitle, svg)).x - y0.x).toBeCloseTo(2, 0)
  await expectUndo(page, 'Nudge 2 elements')
  await undo(page)
  await expect.poll(async () => (await relative(title, svg)).x).toBeCloseTo(t0.x, 0)
  await expect.poll(async () => (await relative(yTitle, svg)).x).toBeCloseTo(y0.x, 0)
  // Still both selected: a drag of one moves the two (the plot keeps its place on screen).
  await expect(hint(page)).toContainText('2 elements selected')
  await drag(page, await pointOn(title), 0, 30, {
    during: async () => await expect(hint(page)).toContainText('Moving 2 of 2'),
  })
  await expect.poll(async () => (await relative(title, svg)).y - t0.y).toBeCloseTo(30, -1)
  await expect.poll(async () => (await relative(yTitle, svg)).y - y0.y).toBeCloseTo(30, -1)
  await expectUndo(page, 'Move 2 elements')
  await expect(hint(page)).toContainText('2 elements selected')
})

test('a click 3 px off the Y axis line selects the axis', async ({ page }) => {
  const svg = await openGraph(page, EXAMPLE, BARS)
  const line = svg.locator('[data-id="axis/y/line"]')
  const b = await box(line)
  // Inside the plot, right of the line near its top (no bar there).
  await page.mouse.click(b.x + b.w / 2 + 3, b.y + b.h * 0.08)
  await expect(hint(page)).toContainText('Y axis selected')
  await expect(announced(page)).toHaveText('Y axis')
  // Well away from it: not the axis.
  await page.mouse.click(b.x + b.w / 2 + 14, b.y + b.h * 0.08)
  await expect(hint(page)).not.toContainText('Y axis')
})

test('Delete hides the selected data set in its layer; Undo brings it back', async ({ page }) => {
  const svg = await openGraph(page, EXAMPLE, BARS)
  const n = await bars(svg).count()
  expect(n).toBeGreaterThan(1)
  const id = (await bars(svg).nth(0).getAttribute('data-id'))!
  await clickAt(bars(svg).nth(0))
  await expect(hint(page)).toContainText('Delete hides it in this layer')
  await page.keyboard.press('Delete')
  await expect(bars(svg)).toHaveCount(n - 1)
  await expect(svg.locator(`[data-id="${id}"]`)).toHaveCount(0)
  // Announced with its Undo (roadmap 43), named for the data set and the layer.
  const notice = page.locator('.toast.notice')
  await expect(notice).toHaveText(/^Hide .+ in .+ · Undo/)
  await expect(hint(page)).toHaveText(/^Graph: /)
  await undo(page)
  await expect(bars(svg)).toHaveCount(n)
  await expect(svg.locator(`[data-id="${id}"]`)).toHaveCount(1)
})

test('a double-click on a point formats its data set; Enter on a selected point, the point', async ({
  page,
}) => {
  const svg = await openGraph(page, EXAMPLE, SCATTER)
  const point = await reachable(pointMarks(svg))
  const id = (await point.getAttribute('data-id'))!
  const key = id.slice('series/'.length, id.indexOf('/point/'))
  // The point selected first (a click on its data set, then on it): still the data set.
  await clickAt(point)
  await clickAt(point)
  await expect(hint(page)).toContainText('Data point selected')
  const p = await pointOn(point)
  await page.mouse.dblclick(p.x, p.y)
  const d = await inWindow(page, 'Format graph')
  await expect(seriesPicker(d)).toHaveValue(`dataSet:${key}`)
  // The data set's place, its symbols (the part double-clicked) open (roadmap 46).
  await expect(sectionToggle(d, 'Symbols')).toHaveAttribute('aria-expanded', 'true')
  await expect(d.getByText('This point only')).toHaveCount(0)
  await d.getByRole('button', { name: 'Cancel' }).click()
  await expect(d).toBeHidden()
  // The data set is selected now; a click on the point selects it, Enter formats just it.
  await expect(hint(page)).toContainText('Data set selected')
  await clickAt(point)
  await expect(hint(page)).toContainText('Data point selected')
  await page.keyboard.press('Enter')
  await inWindow(page, 'Format graph')
  await expect(d.getByText('This point only')).toBeVisible()
  await d.getByRole('button', { name: 'Cancel' }).click()
})

test('Tab steps through the parts of the graph; Enter goes in, Shift+Enter out', async ({
  page,
}) => {
  await openGraph(page, EXAMPLE, SCATTER)
  const canvasEl = page.getByRole('main').locator('.canvas')
  await focusCanvas(page)
  await page.keyboard.press('Tab')
  await expect(announced(page)).toHaveText('Graph title')
  await page.keyboard.press('Tab')
  await expect(announced(page)).toHaveText('Y axis title')
  await page.keyboard.press('Tab')
  await expect(announced(page)).toHaveText('Y axis tick labels')
  await page.keyboard.press('Tab')
  await expect(announced(page)).toHaveText('Y axis')
  await expect(canvasEl).toBeFocused()
  // Into the axis: its tick labels; back out with Shift+Enter.
  await page.keyboard.press('Enter')
  await expect(announced(page)).toHaveText('Y axis tick labels')
  await page.keyboard.press('Shift+Enter')
  await expect(announced(page)).toHaveText('Y axis')
  // On to the data sets: the first of the points layer, into its first point, Escape back.
  let tabs = 0
  do {
    await page.keyboard.press('Tab')
    tabs++
    await expect(announced(page)).toHaveText(/^“.+” in “/)
  } while (!/in “Points/.test((await announced(page).textContent()) ?? '') && tabs < 8)
  await expect(announced(page)).toHaveText(/^“.+” in “Points/)
  await page.keyboard.press('Enter')
  await expect(announced(page)).toHaveText(/^Data point of “.+”$/)
  await expect(hint(page)).toContainText('Data point selected')
  await page.keyboard.press('Escape')
  await expect(announced(page)).toHaveText(/^“.+” in “Points/)
  // Back to the start, then past it: the focus leaves the canvas.
  for (let i = 0; i < 3 + tabs; i++) await page.keyboard.press('Shift+Tab')
  await expect(announced(page)).toHaveText('Graph title')
  await page.keyboard.press('Shift+Tab')
  await expect(canvasEl).not.toBeFocused()
})

// Audit 3 (A4): Tab past the last part leaves the canvas with the selection the Tabs started from
// (the panel goes on formatting what was chosen); the canvas' description and hint name ⌘1.
test('Tab out of the canvas keeps the selection it started from; ⌘1 is named', async ({ page }) => {
  const svg = await openGraph(page, EXAMPLE, SCATTER)
  const canvasEl = page.getByRole('main').locator('.canvas')
  const mod = (await appMod(page)) === 'Meta' ? '⌘1' : 'Ctrl+1'
  await expect(hint(page)).toContainText(`${mod} for the Format panel`)
  const description = await canvasEl.getAttribute('aria-describedby')
  await expect(page.locator(`[id="${description}"]`)).toContainText(
    `${mod} moves to the Format panel`,
  )
  await menu(page, 'Format', 'Format graph…')
  await clickAt(svg.locator('[data-id="axis/y/title"]'))
  await expect(announced(page)).toHaveText('Y axis title')
  await expect(page.getByTestId('format-panel').locator('h2').first()).toHaveText('Y axis')
  await expect(canvasEl).toBeFocused()
  let tabs = 0
  while ((await canvasEl.evaluate((c) => c === document.activeElement)) && tabs < 40) {
    await page.keyboard.press('Tab')
    tabs++
  }
  expect(tabs).toBeGreaterThan(1)
  await expect(canvasEl).not.toBeFocused()
  await expect(announced(page)).toHaveText('Y axis title')
  await expect(page.getByTestId('format-panel').locator('h2').first()).toHaveText('Y axis')
  // Another selection, then Tab: the run starts again from it.
  await clickAt(svg.locator('[data-id="title"]'))
  await page.keyboard.press('Tab')
  await expect(announced(page)).toHaveText('Y axis title')
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Shift+Tab')
  await expect(canvasEl).not.toBeFocused()
  await expect(announced(page)).toHaveText('Graph title')
})

test('right-click on one of several selected shows what applies to all of them', async ({
  page,
}) => {
  const svg = await openGraph(page, EXAMPLE, BARS)
  const n = await bars(svg).count()
  await clickAt(bars(svg).nth(0))
  await clickAt(bars(svg).nth(1), ['Shift'])
  await expect(hint(page)).toContainText('2 elements selected')
  await clickAt(bars(svg).nth(0), [], 'right')
  const m = page.getByRole('menu', { name: 'Selected elements' })
  await expect(m).toBeVisible()
  await expect(m.getByRole('menuitem', { name: 'Hide data sets (2)' })).toBeVisible()
  await expect(m.getByRole('menuitem', { name: /^Format axes/ })).toBeVisible()
  // Nothing for one of them alone.
  await expect(m.getByRole('menuitem', { name: /^Format data set/ })).toHaveCount(0)
  await expect(m.getByRole('menuitem', { name: 'Go to row' })).toHaveCount(0)
  // The selection stays.
  await expect(hint(page)).toContainText('2 elements selected')
  await m.getByRole('menuitem', { name: 'Hide data sets (2)' }).click()
  await expect(bars(svg)).toHaveCount(n - 2)
  await expectUndo(page, 'Hide 2 data sets')
  await undo(page)
  await expect(bars(svg)).toHaveCount(n)
})

// Roadmap 44 (O3, decisions 860–862): the marquee on the graph canvas.

test('a box round an axis title selects it; Shift and a box round the other adds it', async ({
  page,
}) => {
  // An XY graph: both axes have titles.
  const svg = await openGraph(page, 'curve-fitting', 'Dose-response')
  const yTitle = svg.locator('[data-id="axis/y/title"]')
  const xTitle = svg.locator('[data-id="axis/x/title"]')
  // From the empty space above-left of the Y title (no element within reach there).
  const y = grown(await box(yTitle), 8)
  await marquee(page, corner(y, false, false), corner(y, true, true), {
    during: async () => {
      await expect(hint(page)).toContainText('Selecting 1 element')
      await expect(preview(svg)).not.toHaveCount(0)
      // No hover card while a box is drawn.
      await expect(page.locator('.hover-card')).toHaveCount(0)
    },
  })
  await expect(announced(page)).toHaveText('Y axis title')
  await expect(preview(svg)).toHaveCount(0)
  await expect(svg.locator('rect.marquee')).toHaveCount(0)
  // From below-right of the X title (above it are its axis' tick labels), Shift held: added.
  const x = grown(await box(xTitle), 8)
  await marquee(page, corner(x, true, true), corner(x, false, false), {
    modifiers: ['Shift'],
    during: async () => await expect(hint(page)).toContainText('Adding 1 element'),
  })
  await expect(announced(page)).toHaveText('2 elements selected')
  await expect.poll(() => haloed(svg, yTitle)).toBe(true)
  expect(await haloed(svg, xTitle)).toBe(true)
  // Without Shift a box replaces the selection.
  await marquee(page, corner(x, true, true), corner(x, false, false))
  await expect(announced(page)).toHaveText('X axis title')
  // A box over nothing clears it.
  await marquee(page, corner(x, true, true), { x: x.x + x.w + 30, y: x.y + x.h + 4 })
  await expect(announced(page)).toHaveText('Graph')
})

test('a box round one bar selects its data set; a click on the plot background as before', async ({
  page,
}) => {
  const svg = await openGraph(page, EXAMPLE, BARS)
  const n = await bars(svg).count()
  expect(n).toBeGreaterThan(1)
  const last = bars(svg).nth(n - 1)
  const b = await box(last)
  // From the plot's empty space right of the last bar, to just below its base on the left.
  await marquee(page, { x: b.x + b.w + 8, y: b.y - 4 }, { x: b.x - 6, y: b.y + b.h + 1 })
  await expect.poll(() => haloed(svg, last)).toBe(true)
  for (let i = 0; i < n - 1; i++) expect(await haloed(svg, bars(svg).nth(i))).toBe(false)
  await expect(announced(page)).not.toHaveText(/axis|Graph/)
  // A plain click on the plot's empty space selects or clears as it did before the marquee.
  await page.mouse.click(b.x + b.w + 8, b.y - 4)
  await expect(halos(svg)).toHaveCount(0)
  await expect(hint(page)).toHaveText(/^Graph: /)
})

test('Alt and a box pick points; Enter formats the primary point', async ({ page }) => {
  const svg = await openGraph(page, EXAMPLE, SCATTER)
  const points = pointMarks(svg)
  await expect(points.first()).toBeAttached()
  const all: Box[] = await points.evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect()
      return { x: r.x, y: r.y, w: r.width, h: r.height }
    }),
  )
  // The three right-most points, and a box round them from a corner with no mark near it (a
  // press there starts a box, not a click on a point).
  const right = [...all].sort((a, c) => c.x - a.x).slice(0, 3)
  const x0 = Math.min(...right.map((p) => p.x))
  const y0 = Math.min(...right.map((p) => p.y))
  const x1 = Math.max(...right.map((p) => p.x + p.w))
  const y1 = Math.max(...right.map((p) => p.y + p.h))
  const area = grown({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, 6)
  const within = (p: Box, q: Box) =>
    p.x >= q.x && p.y >= q.y && p.x + p.w <= q.x + q.w && p.y + p.h <= q.y + q.h
  const expected = all.filter((p) => within(p, area)).length
  expect(expected).toBeGreaterThanOrEqual(3)
  const clear = (c: { x: number; y: number }) =>
    all.every((p) => {
      const g = grown(p, 10)
      return c.x < g.x || c.x > g.x + g.w || c.y < g.y || c.y > g.y + g.h
    })
  const corners = [
    [true, false],
    [true, true],
    [false, false],
    [false, true],
  ] as const
  const [r, d] = corners.find(([cr, cd]) => clear(corner(area, cr, cd))) ?? corners[0]
  const from = corner(area, r, d)
  const to = corner(area, !r, !d)
  await marquee(page, from, to, {
    modifiers: ['Alt'],
    during: async () =>
      await expect(hint(page)).toContainText(`Selecting ${expected} points of every data set`),
  })
  await expect(announced(page)).toHaveText(`${expected} elements selected`)
  await expect(hint(page)).toContainText(`${expected} elements selected`)
  // Enter formats the primary point's place, for every selected point (its point overrides);
  // audit 3 (U5): in the window too.
  await page.keyboard.press('Enter')
  const f = await inWindow(page, 'Format graph')
  await expect(f.getByText(`These ${expected} points`)).toBeVisible()
  await f.getByRole('button', { name: 'Cancel' }).click()
  await expect(f).toBeHidden()
  // The Format panel Enter showed closed: the graph is back where the box was measured.
  await formatPanel(page).getByRole('button', { name: 'Close the Format panel' }).click()
  await expect(formatPanel(page)).toHaveCount(0)
  // With a data set selected, a box picks its points without Alt.
  // (Picked from every data set: Escape goes back to the primary point's data set.)
  await page.keyboard.press('Escape')
  await expect(announced(page)).toHaveText(/^Data set “.+”$/)
  await marquee(page, from, to, {
    during: async () =>
      await expect(hint(page)).toContainText(/Selecting \d+ points? of the selected data set/),
  })
  await expect(announced(page)).toHaveText(/^(\d+ elements selected|Data point of “.+”)$/)
})

// Roadmap 45: Select ▸ Same kind — on the canvas (its context menu and the Edit menu) and on a
// page (across the graphs worked in, every graph on the page, items of a type).

/** Chooses Select ▸ `item` in the open context menu named `name`. */
async function selectSame(page: Page, name: string, item: string | RegExp) {
  const m = page.getByRole('menu', { name, exact: true })
  await m.getByRole('menuitem', { name: /^Select/ }).click()
  await page
    .getByRole('menu', { name: 'Select', exact: true })
    .getByRole('menuitem', { name: item })
    .click()
  await expect(page.getByRole('menu')).toHaveCount(0)
}

/** The count in "N elements selected" / "N elements in 2 graphs". */
const countOf = async (l: Locator) => Number(/^(\d+)/.exec((await l.textContent()) ?? '')?.[1])

test('Select ▸ Same kind: every title; the data sets of a layer, of every layer', async ({
  page,
}) => {
  const svg = await openGraph(page, 'curve-fitting', 'Dose-response')
  const yTitle = svg.locator('[data-id="axis/y/title"]')
  const xTitle = svg.locator('[data-id="axis/x/title"]')
  await clickAt(yTitle)
  await expect(announced(page)).toHaveText('Y axis title')
  await clickAt(yTitle, [], 'right')
  await selectSame(page, 'Graph element', 'All titles')
  const titles = 2 + (await svg.locator('[data-id="title"]').count())
  await expect(announced(page)).toHaveText(`${titles} elements selected`)
  await expect.poll(() => haloed(svg, xTitle)).toBe(true)
  expect(await haloed(svg, yTitle)).toBe(true)

  // A bar: the data sets of its layer (the Edit menu), then of every layer (error bars too).
  const bsvg = await openGraph(page, EXAMPLE, BARS)
  await expect(bars(bsvg).nth(1)).toBeAttached()
  const n = await bars(bsvg).count()
  await clickAt(bars(bsvg).nth(1))
  await expect(hint(page)).toContainText('Data set selected')
  await menu(page, 'Edit', /^Select all data sets in “/)
  await expect(announced(page)).toHaveText(`${n} elements selected`)
  for (let i = 0; i < n; i++) expect(await haloed(bsvg, bars(bsvg).nth(i))).toBe(true)
  await clickAt(bars(bsvg).nth(0), [], 'right')
  await selectSame(page, 'Selected elements', 'All data sets in every layer')
  await expect.poll(() => countOf(announced(page))).toBeGreaterThan(n)
})

test('Same kind on a page: across the graphs worked in, every graph, items of a type', async ({
  page,
}) => {
  await openExample(page, 'getting-started')
  await openSheet(page, 'Figure 1', 'Layouts')
  const pageSvg = page.getByRole('img', { name: 'Layout page' })
  const said = page.getByTestId('page-selection-announcement')
  const heading = page.locator('.inspector .inspector-header h2').first()
  const yTitles = pageSvg.locator('[data-id="axis/y/title"]')
  const [yB, yC] = [yTitles.nth(1), yTitles.nth(2)]
  /** A click at an element's centre (on a page, as `layoutObjects.spec.ts` clicks). */
  const at = async (l: Locator, mods: string[] = [], button: 'left' | 'right' = 'left') => {
    const b = await box(l)
    for (const m of mods) await page.keyboard.down(m)
    await page.mouse.click(b.x + b.w / 2, b.y + b.h / 2, { button })
    for (const m of [...mods].reverse()) await page.keyboard.up(m)
  }
  // B's Y title (the graph first, then its part), and C's with Shift.
  await at(yB)
  await at(yB)
  await expect(said).toHaveText('Y axis title of “Dose response (bars)”')
  await at(yC, ['Shift'])
  await expect(said).toHaveText('2 elements in 2 graphs')
  // A right-click on one of them keeps both: Select ▸ every title of the two graphs.
  await at(yC, [], 'right')
  await selectSame(page, 'Selected elements', 'All titles in 2 graphs')
  await expect(said).toHaveText(/^\d+ elements in 2 graphs$/)
  const two = await countOf(said)
  expect(two).toBeGreaterThanOrEqual(4)
  // Every graph on the page (the Edit menu).
  await menu(page, 'Edit', /^Select all titles in every graph/)
  await expect(said).toHaveText(/^\d+ elements in 3 graphs$/)
  expect(await countOf(said)).toBeGreaterThan(two)
  // Escape out to a graph item; Same kind selects every graph on the page.
  await page.getByRole('main').locator('.canvas').focus()
  await page.keyboard.press('Escape')
  await expect(heading).toHaveText('Graph on page')
  await menu(page, 'Edit', 'Select all graphs')
  await expect(heading).toHaveText('3 items')
})

test('a selected text box stays selected through an undo that puts another back before it', async ({
  page,
}) => {
  // Audit 3 (U2): annotations were selected by their index, so an undo bringing one back before
  // the selected one moved the selection onto it, and Delete removed the wrong one.
  const svg = await openGraph(page, EXAMPLE, SCATTER)
  const texts = svg.locator('[data-id^="annotation/"][data-id$="/text"]')
  await menu(page, 'Insert', 'Text')
  await expect(texts).toHaveCount(1)
  const idA = (await texts.first().getAttribute('data-id'))!
  // A moved out of the way of the next one.
  await drag(page, await pointOn(texts.first()), 200, 150)
  await menu(page, 'Insert', 'Text')
  await expect(texts).toHaveCount(2)
  const ids = await texts.evaluateAll((els) => els.map((e) => e.getAttribute('data-id')))
  const idB = ids.find((x) => x !== idA)!
  const A = svg.locator(`[data-id="${idA}"]`)
  const B = svg.locator(`[data-id="${idB}"]`)
  await clickAt(A)
  await page.keyboard.press('Delete')
  await expect(A).toHaveCount(0)
  await clickAt(B)
  await expect(announced(page)).toHaveText('Text box')
  // A comes back first in the list: B stays the one selected.
  await undo(page)
  await expect(A).toHaveCount(1)
  expect(await haloed(svg, B)).toBe(true)
  expect(await haloed(svg, A)).toBe(false)
  await page.getByRole('main').locator('.canvas').focus()
  await page.keyboard.press('Delete')
  await expect(B).toHaveCount(0)
  await expect(A).toHaveCount(1)
})
