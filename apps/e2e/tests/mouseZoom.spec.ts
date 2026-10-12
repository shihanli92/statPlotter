import type { Locator, Page } from '@playwright/test'
import { expect, openExample, test } from './fixtures.ts'
import { pressShortcut } from './helpers-data.ts'
import {
  box,
  canvas,
  centre,
  dialog,
  expectUndo,
  menu,
  openGraph,
  pointMarks,
  sheet,
  undoButton,
} from './helpers-graph.ts'

// Roadmap 50: zoom and pan with the mouse, on the graph view and on layout pages. Alt (Option)
// or Ctrl with the wheel (a trackpad's pinch is Ctrl + wheel) zooms about the pointer, the point
// under it staying put; the wheel alone (a trackpad's two-finger drag) scrolls as the browser
// does; the middle button dragged moves a zoomed view. None of it selects, edits or makes an undo
// step, and the zoom box shows the zoom between its levels.

test.use({ viewport: { width: 1400, height: 1000 } })

const SCATTER = { example: 'getting-started', graph: 'Enzyme activity (scatter)' }

const main = (page: Page) => page.getByRole('main')
/** The scrolling canvas (graph view or page). */
const area = (page: Page) => main(page).locator('div.canvas')
const zoomBox = (page: Page) => main(page).getByLabel('Zoom')
/** What the zoom box shows ("165%"). */
const zoomShown = (page: Page) =>
  zoomBox(page).evaluate((s: HTMLSelectElement) => s.selectedOptions[0]?.textContent ?? '')
const setZoom = (page: Page, z: number) => zoomBox(page).selectOption(String(z))
const scroll = (page: Page) =>
  area(page).evaluate((e) => ({ left: e.scrollLeft, top: e.scrollTop }))
const pageSvg = (page: Page) => page.getByRole('img', { name: 'Layout page' })
/** The scaled content: the graph's scene, or the page. */
const content = (page: Page, view: 'graph' | 'page') =>
  view === 'graph' ? canvas(page) : pageSvg(page)

/** Where a window point falls on the content, as fractions of its size. */
async function placeOf(l: Locator, p: { x: number; y: number }) {
  return l.evaluate(
    (e, q) => {
      const r = e.getBoundingClientRect()
      return { fx: (q.x - r.left) / r.width, fy: (q.y - r.top) / r.height }
    },
    { x: p.x, y: p.y },
  )
}
/** Where a fraction of the content is in the window now. */
async function windowPoint(l: Locator, f: { fx: number; fy: number }) {
  return l.evaluate((e, g) => {
    const r = e.getBoundingClientRect()
    return { x: r.left + g.fx * r.width, y: r.top + g.fy * r.height }
  }, f)
}

/** Whether the last wheel event that reached the window was cancelled (by the canvas). */
async function watchWheel(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { wheelPrevented: boolean | null }
    w.wheelPrevented = null
    window.addEventListener('wheel', (e) => {
      w.wheelPrevented = e.defaultPrevented
    })
  })
}
const wheelPrevented = (page: Page) =>
  page.evaluate(() => (window as unknown as { wheelPrevented: boolean | null }).wheelPrevented)

/** One wheel event at `at` with a modifier held (as the browser reports it). */
async function wheelWith(
  page: Page,
  key: 'Alt' | 'Control' | null,
  at: { x: number; y: number },
  dy: number,
  dx = 0,
) {
  await page.mouse.move(at.x, at.y)
  if (key) await page.keyboard.down(key)
  await page.mouse.wheel(dx, dy)
  if (key) await page.keyboard.up(key)
}

/** The wheel alone, horizontal and vertical at once (a two-finger drag), scrolls until `done`. */
async function scrollsWith(
  page: Page,
  at: { x: number; y: number },
  dy: number,
  dx: number,
  done: (s: { left: number; top: number }) => boolean,
) {
  await wheelWith(page, null, at, dy, dx)
  await expect.poll(async () => done(await scroll(page))).toBe(true)
}

/** Zooms about `at` with the wheel and checks the point there stays under the pointer. */
async function zoomsAbout(
  page: Page,
  view: 'graph' | 'page',
  key: 'Alt' | 'Control',
  at: { x: number; y: number },
  dy: number,
  shown: string,
) {
  const c = content(page, view)
  const f = await placeOf(c, at)
  await wheelWith(page, key, at, dy)
  await expect.poll(() => zoomShown(page)).toBe(shown)
  // The content's point that was under the pointer is under it still.
  await expect
    .poll(async () => {
      const p = await windowPoint(c, f)
      return Math.max(Math.abs(p.x - at.x), Math.abs(p.y - at.y))
    })
    .toBeLessThan(2)
  expect(await wheelPrevented(page)).toBe(true)
}

/** A middle-button drag from `from` by (dx, dy), checking the grabbing cursor on the way. */
async function middleDrag(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down({ button: 'middle' })
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 })
  await expect(area(page)).toHaveAttribute('data-panning', '')
  const cursor = await page.evaluate(
    ({ x, y }) => {
      const el = document.elementFromPoint(x, y)
      return el ? getComputedStyle(el).cursor : null
    },
    { x: from.x + dx / 2, y: from.y + dy / 2 },
  )
  expect(cursor).toBe('grabbing')
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 })
  await page.mouse.up({ button: 'middle' })
  await expect(area(page)).not.toHaveAttribute('data-panning')
}

/** The canvas scrolls both ways (the content is larger than it). */
async function expectOverflow(page: Page) {
  await expect
    .poll(() =>
      area(page).evaluate(
        (e) => e.scrollWidth > e.clientWidth + 150 && e.scrollHeight > e.clientHeight + 150,
      ),
    )
    .toBe(true)
}

/** The middle of the visible canvas (inside its scroll bars). */
const middleOf = (page: Page) =>
  area(page).evaluate((e) => {
    const r = e.getBoundingClientRect()
    return { x: r.left + e.clientWidth / 2, y: r.top + e.clientHeight / 2 }
  })

/** Opens an example and a new layout of its graphs. */
async function newLayout(page: Page, example: string) {
  await openExample(page, example)
  const layouts = await page
    .getByRole('navigation', { name: 'Project' })
    .locator('.nav-section')
    .filter({ has: page.getByRole('heading', { name: 'Layouts' }) })
    .locator('.nav-item')
    .count()
  await menu(page, 'Insert', 'New layout')
  await expect(sheet(page, `Layout ${layouts + 1}`, 'Layouts')).toHaveClass(/\bon\b/)
  await expect(pageSvg(page)).toBeVisible()
  await expectUndo(page, 'New layout')
}

test('graph: Alt + wheel zooms in and out about the pointer; the zoom box shows it', async ({
  page,
}) => {
  await openGraph(page, SCATTER.example, SCATTER.graph)
  await watchWheel(page)
  expect(await zoomShown(page)).toBe('150%')
  // Zoomed far enough in that the graph overflows the canvas both ways (it scrolls to anchor).
  await setZoom(page, 6)
  await expectOverflow(page)
  const at = await middleOf(page)
  const at2 = { x: at.x - 120, y: at.y + 90 }
  await zoomsAbout(page, 'graph', 'Alt', at2, -100, '660%')
  await zoomsAbout(page, 'graph', 'Alt', at2, -100, '726%')
  await zoomsAbout(page, 'graph', 'Alt', at2, 100, '660%')
  // ⌘= steps on from between levels; the zoom box lists the levels again.
  await expect(zoomBox(page).locator('option')).toHaveCount(12)
  await zoomBox(page).focus()
  await pressShortcut(page, 'Mod+=')
  await expect.poll(() => zoomShown(page)).toBe('800%')
  await expect(zoomBox(page).locator('option')).toHaveCount(11)
  // A view change: nothing to undo.
  await expect(undoButton(page)).toBeDisabled()
})

test('graph: Ctrl + wheel (a pinch) zooms about the pointer, never the page itself', async ({
  page,
}) => {
  await openGraph(page, SCATTER.example, SCATTER.graph)
  await watchWheel(page)
  await setZoom(page, 6)
  await expectOverflow(page)
  const at = await middleOf(page)
  const dpr = await page.evaluate(() => window.devicePixelRatio)
  await zoomsAbout(page, 'graph', 'Control', { x: at.x + 80, y: at.y - 60 }, -100, '660%')
  // A pinch: small deltas (×e^0.1).
  await zoomsAbout(page, 'graph', 'Control', at, -10, '729%')
  // The page's own zoom is untouched.
  expect(await page.evaluate(() => window.devicePixelRatio)).toBe(dpr)
  expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1)
  await expect(undoButton(page)).toBeDisabled()
})

test('graph: the wheel alone scrolls a zoomed graph both ways; zooms stop at 25% and 800%', async ({
  page,
}) => {
  await openGraph(page, SCATTER.example, SCATTER.graph)
  await watchWheel(page)
  await setZoom(page, 6)
  await expectOverflow(page)
  const s0 = await scroll(page)
  // A two-finger drag on a trackpad: horizontal and vertical deltas together, no modifier.
  await scrollsWith(page, await middleOf(page), 120, 90, (s) => {
    return s.top > s0.top + 50 && s.left > s0.left + 40
  })
  expect(await wheelPrevented(page)).toBe(false)
  expect(await zoomShown(page)).toBe('600%')
  // The ends.
  await setZoom(page, 8)
  await wheelWith(page, 'Alt', await middleOf(page), -100)
  await wheelWith(page, 'Alt', await middleOf(page), -100)
  expect(await zoomShown(page)).toBe('800%')
  expect(await wheelPrevented(page)).toBe(true)
  await setZoom(page, 0.25)
  await wheelWith(page, 'Alt', await middleOf(page), 100)
  expect(await zoomShown(page)).toBe('25%')
  await wheelWith(page, 'Alt', await middleOf(page), -100)
  await expect.poll(() => zoomShown(page)).toBe('28%')
})

test('graph: a middle-button drag over a mark pans; the selection and the document stay', async ({
  page,
}) => {
  const svg = await openGraph(page, SCATTER.example, SCATTER.graph)
  const said = page.getByTestId('selection-announcement')
  // A data set selected.
  await pointMarks(svg).first().click()
  await expect(said).not.toHaveText('')
  const selected = await said.textContent()
  await setZoom(page, 6)
  await expectOverflow(page)
  // A point brought to the middle of the canvas (as far as it scrolls).
  const mark = pointMarks(svg).first()
  const c0 = await centre(mark)
  const mid = await middleOf(page)
  await area(page).evaluate((e, d) => e.scrollBy(d.x, d.y), {
    x: c0.x - mid.x,
    y: c0.y - mid.y,
  })
  const from = await centre(mark)
  const s0 = await scroll(page)
  const max = await area(page).evaluate((e) => ({
    left: e.scrollWidth - e.clientWidth,
    top: e.scrollHeight - e.clientHeight,
  }))
  // Dragged towards where there is room to scroll.
  const dx = s0.left > max.left / 2 ? 100 : -100
  const dy = s0.top > max.top / 2 ? 80 : -80
  await middleDrag(page, from, dx, dy)
  await expect.poll(async () => (await scroll(page)).left).toBeCloseTo(s0.left - dx, -0.5)
  await expect.poll(async () => (await scroll(page)).top).toBeCloseTo(s0.top - dy, -0.5)
  // Nothing moved, nothing selected or edited.
  await expect(said).toHaveText(selected!)
  await expect(undoButton(page)).toBeDisabled()
  expect(await zoomShown(page)).toBe('600%')
})

test('page: Alt and Ctrl + wheel zoom about the pointer, the wheel scrolls, the middle button pans', async ({
  page,
}) => {
  await newLayout(page, 'parts-of-whole')
  await watchWheel(page)
  const said = page.getByTestId('page-selection-announcement')
  // An item selected.
  await pageSvg(page).getByTestId('layout-item-0').click()
  await expect(said).not.toHaveText('')
  const selected = await said.textContent()
  expect(await zoomShown(page)).toBe('100%')
  await setZoom(page, 3)
  await expectOverflow(page)
  const at = await middleOf(page)
  await zoomsAbout(page, 'page', 'Alt', { x: at.x + 100, y: at.y + 50 }, -100, '330%')
  await zoomsAbout(page, 'page', 'Control', { x: at.x - 60, y: at.y - 40 }, -100, '363%')
  await zoomsAbout(page, 'page', 'Alt', { x: at.x - 60, y: at.y - 40 }, -100, '399%')
  // To the end, and no further.
  await zoomsAbout(page, 'page', 'Alt', { x: at.x - 60, y: at.y - 40 }, -100, '400%')
  await wheelWith(page, 'Alt', at, -100)
  expect(await zoomShown(page)).toBe('400%')
  // The wheel alone scrolls both ways.
  const s0 = await scroll(page)
  await scrollsWith(page, at, 100, -80, (s) => s.top > s0.top + 40 && s.left < s0.left - 40)
  expect(await wheelPrevented(page)).toBe(false)
  // The middle button over an item: the page moves, the item does not.
  const s1 = await scroll(page)
  const item = await pageSvg(page)
    .getByTestId('layout-item-0')
    .evaluate((e) => [e.getAttribute('x'), e.getAttribute('y')].join())
  await middleDrag(page, at, -120, -90)
  await expect.poll(async () => (await scroll(page)).left).toBeCloseTo(s1.left + 120, -0.5)
  await expect.poll(async () => (await scroll(page)).top).toBeCloseTo(s1.top + 90, -0.5)
  expect(
    await pageSvg(page)
      .getByTestId('layout-item-0')
      .evaluate((e) => [e.getAttribute('x'), e.getAttribute('y')].join()),
  ).toBe(item)
  await expect(said).toHaveText(selected!)
  await expectUndo(page, 'New layout')
})

test('page: a hover card is on the canvas — the wheel over it zooms, it follows the zoom', async ({
  page,
}) => {
  await newLayout(page, SCATTER.example)
  await watchWheel(page)
  await setZoom(page, 2)
  const point = pageSvg(page).locator('path[data-id^="series/"][data-id*="/point/"]').first()
  await point.scrollIntoViewIfNeeded()
  const card = page.getByTestId('hover-card')
  // Under the item's hit area: the page finds the mark under the pointer.
  const p = await centre(point)
  await page.mouse.move(p.x + 1, p.y)
  await page.mouse.move(p.x, p.y)
  await expect(card).toBeVisible()
  // In the canvas: it scrolls with the page, and the wheel over it is the canvas'.
  await expect(area(page).getByTestId('hover-card')).toHaveCount(1)
  // The card's place from the point (8 px beside the mark it shows, 4 px above its top: offsets
  // that scale with the zoom but for those).
  const offset = async () => {
    const m = await box(point)
    const c = await box(card)
    const right = c.x > m.x
    return {
      dx: right ? c.x - (m.x + m.w) - 8 : c.x + c.w - m.x + 8,
      dy: c.y - m.y + 4,
      title: await card.locator('.hover-card-title').textContent(),
    }
  }
  const before = await offset()
  const over = await centre(card)
  await wheelWith(page, 'Alt', over, -100)
  await expect.poll(() => zoomShown(page)).toBe('220%')
  expect(await wheelPrevented(page)).toBe(true)
  // Placed at the old zoom: gone; back beside the mark on the next move over it.
  await expect(card).toHaveCount(0)
  const q = await centre(point)
  await page.mouse.move(q.x + 1, q.y)
  await page.mouse.move(q.x, q.y)
  await expect(card).toBeVisible()
  const after = await offset()
  expect(after.title).toBe(before.title)
  expect(Math.abs(after.dx - 1.1 * before.dx)).toBeLessThan(3)
  expect(Math.abs(after.dy - 1.1 * before.dy)).toBeLessThan(3)
})

test('the shortcut sheet lists the mouse and trackpad gestures', async ({ page }) => {
  await openGraph(page, SCATTER.example, SCATTER.graph)
  await menu(page, 'Help', 'Keyboard shortcuts')
  const sheetDialog = dialog(page, 'Keyboard shortcuts')
  const section = sheetDialog
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'With the mouse or trackpad' }) })
  await expect(section).toContainText('Zoom in or out about the pointer')
  await expect(section).toContainText('Pinch')
  await expect(section).toContainText('Middle-button drag')
  await expect(section).toContainText('Two-finger drag')
})
