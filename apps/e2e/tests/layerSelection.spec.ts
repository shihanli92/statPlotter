import type { Locator, Page } from '@playwright/test'
import { expect, test } from './fixtures.ts'
import { runMenu } from './helpers-data.ts'
import {
  appMod,
  box,
  colourPopover,
  expectUndo,
  formatPanel,
  layerList,
  marks,
  openGraph,
  pointMarks,
  pointOn,
  reachable,
  undo,
} from './helpers-graph.ts'

// Roadmap 47 (UX finding S9): the Format panel's list of layers selects several rows (⌘- or
// Ctrl-click, Shift-click, Shift+↑ / ↓), and hiding, moving and removing act on all of them in
// one undo step; Delete on the canvas removes a whole layer (asking first when others go with
// it) and hides a selected point on the graph; the format bar formats several points at once.

test.use({ viewport: { width: 1400, height: 1000 } })

const EXAMPLE = 'getting-started'
const SCATTER = 'Enzyme activity (scatter)'
const BARS = 'Dose response (bars)'

const rows = (list: Locator) => list.getByRole('option')
const row = (list: Locator, name: RegExp) => list.getByRole('option', { name })
/** The rows' names, top (front) to bottom. */
const rowNames = (list: Locator) =>
  rows(list).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''))
const selectedNames = (list: Locator) =>
  rows(list).evaluateAll((els) =>
    els
      .filter((e) => e.getAttribute('aria-selected') === 'true')
      .map((e) => e.getAttribute('aria-label') ?? ''),
  )
const toolbar = (page: Page, name: string) =>
  formatPanel(page).locator('.layers-toolbar').getByRole('button', { name, exact: true })

/** The centre lines', error bars' and points' marks of a scatter graph. */
const centres = (svg: Locator) => svg.locator('[data-id^="series/"][data-id$="/center"]')
const errors = (svg: Locator) => svg.locator('[data-id^="series/"][data-id*="/error"]')

/** The ids of an SVG's marks in drawing order (back to front). */
const drawn = (svg: Locator) =>
  svg.evaluate((el) =>
    [...el.querySelectorAll('[data-id]')].map((e) => e.getAttribute('data-id') ?? ''),
  )

/** A click where the element can be reached, with modifiers held. */
async function clickAt(el: Locator, modifiers: string[] = [], button: 'left' | 'right' = 'left') {
  const page = el.page()
  const p = await pointOn(el)
  for (const m of modifiers) await page.keyboard.down(m)
  await page.mouse.click(p.x, p.y, { button })
  for (const m of [...modifiers].reverse()) await page.keyboard.up(m)
}

/** The graph's list of layers (Format graph…). */
async function layersOf(page: Page): Promise<Locator> {
  await runMenu(page, 'Format', 'Format graph…')
  const list = layerList(formatPanel(page))
  await expect(list).toBeVisible()
  return list
}

/** Two points of one data set selected on the canvas (a click on its data set, then on each). */
async function twoPoints(svg: Locator) {
  const first = await reachable(pointMarks(svg))
  const id = (await first.getAttribute('data-id'))!
  const key = id.slice('series/'.length, id.indexOf('/point/'))
  const second = await reachable(
    svg.locator(`path[data-id^="series/${key}/point/"]:not([data-id="${id}"])`),
  )
  await clickAt(first)
  await clickAt(first)
  await expect(svg.page().locator('.selection-hint .selection-text')).toContainText(
    'Data point selected',
  )
  // Its hover card gone before the next click.
  await svg.page().mouse.move(1, 1)
  await clickAt(second, ['Shift'])
  await expect(svg.page().locator('.selection-hint .selection-text')).toContainText(
    '2 elements selected',
  )
  return { first, second, key }
}

test('the list: ⌘ / Ctrl and Shift select several; hide, move and remove them in one step each', async ({
  page,
}) => {
  const svg = await openGraph(page, EXAMPLE, SCATTER)
  const list = await layersOf(page)
  // The host's ⌘ or Ctrl (a Ctrl-click on macOS is a right-click; the list takes either).
  expect(await rowNames(list)).toEqual([
    'Centre line (mean)',
    'Error bars (SD)',
    'Points (every value)',
  ])
  await expect(list).toHaveAttribute('aria-multiselectable', 'true')
  // ⌘- (Ctrl-) click adds a row; the panel shows the last one clicked.
  await row(list, /^Centre line/).click()
  await row(list, /^Points/).click({ modifiers: ['ControlOrMeta'] })
  expect(await selectedNames(list)).toEqual(['Centre line (mean)', 'Points (every value)'])
  await expect(formatPanel(page).getByText(/^2 layers selected/)).toBeVisible()
  // The canvas holds them too: its hint counts them.
  await expect(page.locator('.selection-hint .selection-text')).toContainText('2 elements selected')

  // Hide: both, one step.
  const n = await pointMarks(svg).count()
  await toolbar(page, 'Hide').click()
  await expect(pointMarks(svg)).toHaveCount(0)
  await expect(centres(svg)).toHaveCount(0)
  expect(await errors(svg).count()).toBeGreaterThan(0)
  await expectUndo(page, 'Hide 2 layers')
  await undo(page)
  await expect(pointMarks(svg)).toHaveCount(n)
  await expect(centres(svg)).not.toHaveCount(0)

  // ⌘A (Ctrl+A) in the list: every row.
  await list.focus()
  await page.keyboard.press(`${await appMod(page)}+A`)
  await expect(rows(list).and(list.locator('[aria-selected="true"]'))).toHaveCount(3)
  await expect(formatPanel(page).getByText(/^3 layers selected/)).toBeVisible()
  // Shift-click: a range, front first.
  await row(list, /^Error bars/).click()
  await row(list, /^Points/).click({ modifiers: ['Shift'] })
  expect(await selectedNames(list)).toEqual(['Error bars (SD)', 'Points (every value)'])
  await list.focus()
  // Alt+↑: the two together past the centre line, in their order.
  await page.keyboard.press('Alt+ArrowUp')
  await expect
    .poll(() => rowNames(list))
    .toEqual(['Error bars (SD)', 'Points (every value)', 'Centre line (mean)'])
  expect(await selectedNames(list)).toEqual(['Error bars (SD)', 'Points (every value)'])
  // The canvas follows (this graph draws data set by data set): each data set's points over its
  // centre line, its error bars over its points.
  const ids = await drawn(svg)
  const key = ids.find((id) => id.endsWith('/center'))!.split('/')[1]!
  const at = (part: string) => ids.findIndex((id) => id.startsWith(`series/${key}/${part}`))
  expect(at('center')).toBeLessThan(at('point/'))
  expect(at('point/')).toBeLessThan(at('error'))
  await expectUndo(page, 'Bring 2 layers forward')

  // Delete in the list removes both (nothing attached to them: nothing asked).
  await list.focus()
  await page.keyboard.press('Delete')
  await expect(rows(list)).toHaveCount(1)
  await expect(pointMarks(svg)).toHaveCount(0)
  await expectUndo(page, 'Delete 2 layers')
  await undo(page)
  await expect(rows(list)).toHaveCount(3)
  await expect(pointMarks(svg)).toHaveCount(n)
})

// Audit 3 (A6): + Add ▾ is the app's menu — Enter puts the focus in it, the arrows move and open a
// family, Escape closes it back onto the button (the panel staying open), Enter adds a layer.
test('the list’s + Add ▾ is a keyboard menu', async ({ page }) => {
  await openGraph(page, EXAMPLE, SCATTER)
  const list = await layersOf(page)
  const add = toolbar(page, '+ Add ▾')
  await add.focus()
  await page.keyboard.press('Enter')
  const menu = page.getByRole('menu', { name: 'Add a layer' })
  await expect(menu.getByRole('menuitem', { name: /^Raw values/ })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(menu.getByRole('menuitem', { name: /^Summaries/ })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(add).toBeFocused()
  await expect(add).toHaveAttribute('aria-expanded', 'false')
  await expect(formatPanel(page)).toBeVisible()
  const n = await rows(list).count()
  await page.keyboard.press('Enter')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowRight')
  const summaries = menu.getByRole('menu', { name: 'Summaries' })
  await expect(summaries.getByRole('menuitem').first()).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(menu).toHaveCount(0)
  await expect(rows(list)).toHaveCount(n + 1)
})

test('canvas Delete removes a whole layer — chosen in the list, or Alt-clicked — asking first when others go with it', async ({
  page,
}) => {
  const svg = await openGraph(page, EXAMPLE, SCATTER)
  const list = await layersOf(page)
  await row(list, /^Error bars/).click()
  // Escape gives the focus back to the canvas; the layer stays selected.
  await list.focus()
  await page.keyboard.press('Escape')
  const canvasEl = page.getByRole('main').locator('.canvas')
  await expect(canvasEl).toBeFocused()
  await expect(page.locator('.selection-hint .selection-text')).toContainText(
    'Delete deletes the layer',
  )
  await page.keyboard.press('Delete')
  await expect(errors(svg)).toHaveCount(0)
  await expect(page.locator('.toast.notice')).toHaveText(/^Delete layer · Undo/)
  await expectUndo(page, 'Delete layer')
  await undo(page)
  await expect(errors(svg)).not.toHaveCount(0)

  // Bars with error bars and labels on them: Alt-click selects the layer, Delete asks first.
  const bars = await openGraph(page, EXAMPLE, BARS)
  const bar = marks(bars, 'series/').and(bars.locator('[data-id$="/bar"]')).first()
  const labels = bars.locator('[data-id^="series/"][data-id$="/label"]')
  await expect(labels).not.toHaveCount(0)
  await clickAt(bar, ['Alt'])
  await expect(page.locator('.selection-hint .selection-text')).toContainText(
    'Delete deletes the layer',
  )
  await page.keyboard.press('Delete')
  const ask = page.getByRole('alertdialog', {
    name: /^Delete Bars \(mean\) and what is on it/,
  })
  await expect(ask).toBeVisible()
  await expect(ask).toContainText(/Error bars \(SD\)/)
  // Cancelled: nothing goes.
  await ask.getByRole('button', { name: 'Cancel' }).click()
  await expect(ask).toBeHidden()
  await expect(bars.locator('[data-id$="/bar"]')).not.toHaveCount(0)
  await clickAt(bar, ['Alt'])
  await page.keyboard.press('Delete')
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
  await expect(bars.locator('[data-id^="series/"][data-id$="/bar"]')).toHaveCount(0)
  await expect(labels).toHaveCount(0)
  await expect(bars.locator('[data-id^="series/"][data-id*="/error"]')).toHaveCount(0)
  await expect(bars.locator('[data-id^="series/"][data-id*="/point/"]')).not.toHaveCount(0)
  await expectUndo(page, 'Delete layer')
  await undo(page)
  await expect(labels).not.toHaveCount(0)
  await expect(bars.locator('[data-id^="series/"][data-id$="/bar"]')).not.toHaveCount(0)
})

test('canvas Delete hides selected points on the graph; the right-click menu counts them', async ({
  page,
}) => {
  const svg = await openGraph(page, EXAMPLE, SCATTER)
  const n = await pointMarks(svg).count()
  const { first, second } = await twoPoints(svg)
  const ids = [await first.getAttribute('data-id'), await second.getAttribute('data-id')]
  await clickAt(first, [], 'right')
  const m = page.getByRole('menu', { name: 'Selected elements' })
  await expect(m.getByRole('menuitem', { name: 'Hide points (2)' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(m).toBeHidden()
  await page.getByRole('main').locator('.canvas').focus()
  await page.keyboard.press('Delete')
  await expect(pointMarks(svg)).toHaveCount(n - 2)
  for (const id of ids) await expect(svg.locator(`[data-id="${id}"]`)).toHaveCount(0)
  await expect(page.locator('.toast.notice')).toHaveText(/^Hide 2 points · Undo/)
  await expectUndo(page, 'Hide 2 points')
  await undo(page)
  await expect(pointMarks(svg)).toHaveCount(n)
})

test('the format bar formats several points: their colour and symbol size, one step each', async ({
  page,
}) => {
  const svg = await openGraph(page, EXAMPLE, SCATTER)
  const { first, second, key } = await twoPoints(svg)
  const ids = [(await first.getAttribute('data-id'))!, (await second.getAttribute('data-id'))!]
  const others = svg.locator(
    `path[data-id^="series/${key}/point/"]:not([data-id="${ids[0]}"]):not([data-id="${ids[1]}"])`,
  )
  const bar = page.getByTestId('format-bar')
  const barButton = (name: string) => bar.getByRole('button', { name, exact: true })
  const fill = (id: string) => svg.locator(`[data-id="${id}"]`).getAttribute('fill')
  const before = await fill(ids[0]!)
  const other = await others.first().getAttribute('fill')
  await barButton('Colour').click()
  await expect(colourPopover(page)).toHaveAccessibleName('Fill colours')
  await colourPopover(page).getByRole('option', { name: 'Palette colour 4', exact: true }).click()
  await expect(colourPopover(page)).toHaveCount(0)
  await expect.poll(() => fill(ids[0]!)).not.toBe(before)
  expect(await fill(ids[1]!)).toBe(await fill(ids[0]!))
  expect(await others.first().getAttribute('fill')).toBe(other)
  await expectUndo(page, 'Colour (2 elements)')

  // Symbol size: both grow, the data set's other points stay.
  const width = (id: string) => box(svg.locator(`[data-id="${id}"]`)).then((b) => b.w)
  const w0 = await width(ids[0]!)
  const wOther = await box(others.first()).then((b) => b.w)
  await barButton('Symbol size').click()
  await page
    .getByRole('menu', { name: 'Symbol sizes', exact: true })
    .getByRole('menuitemradio', { name: '14 pt' })
    .click()
  await expect.poll(() => width(ids[0]!)).toBeGreaterThan(w0 + 3)
  await expect.poll(() => width(ids[1]!)).toBeGreaterThan(w0 + 3)
  expect(Math.round(await box(others.first()).then((b) => b.w))).toBe(Math.round(wOther))
  await expectUndo(page, 'Symbol size 14 pt (2 elements)')

  // Enter: the Format panel at the last one, for both.
  await page.getByRole('main').locator('.canvas').focus()
  await page.keyboard.press('Enter')
  await expect(formatPanel(page).getByRole('heading', { level: 2 })).toHaveText('2 points')
  await expect(formatPanel(page).getByText('These 2 points')).toBeVisible()
})
