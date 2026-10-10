import type { Locator, Page } from '@playwright/test'
import { expect, openExample, test } from './fixtures.ts'
import {
  appMod,
  box,
  centre,
  drag,
  expectUndo,
  menu,
  openGraph,
  openSheet,
  sheet,
  toast,
  undo,
} from './helpers-graph.ts'

// Layout pages (roadmap 24): a new layout, graphs added with Insert › Graph on page, the Arrange
// menu, a graph's plot resized on the page, its size on the page, and a copied graph pasted.

test.use({ viewport: { width: 1400, height: 1000 } })

const pageSvg = (page: Page) => page.getByRole('img', { name: 'Layout page' })
const items = (page: Page) => pageSvg(page).locator('[data-testid^="layout-item-"]')
const item = (page: Page, i: number) => pageSvg(page).getByTestId(`layout-item-${i}`)

/** An item's box on the page, in points (its hit rectangle's attributes). */
async function itemBox(l: Locator) {
  const [x, y, w, h] = await l.evaluate((e) =>
    ['x', 'y', 'width', 'height'].map((a) => Number(e.getAttribute(a))),
  )
  return { x: x!, y: y!, w: w!, h: h! }
}
const boxes = async (page: Page) => {
  const n = await items(page).count()
  return Promise.all([...Array(n).keys()].map((i) => itemBox(item(page, i))))
}

/** Opens an example and a new layout of its graphs; returns the number of items placed. */
async function newLayout(page: Page, example: string): Promise<number> {
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
  return items(page).count()
}

test('Insert › New layout places the graphs; Graph on page adds one at a time', async ({
  page,
}) => {
  const n = await newLayout(page, 'parts-of-whole')
  expect(n).toBe(4)
  // Clear the page, then add graphs one by one.
  await menu(page, 'Edit', 'Select all')
  await menu(page, 'Arrange', 'Remove items from page')
  await expect(items(page)).toHaveCount(0)
  await expectUndo(page, 'Remove items')
  await menu(page, 'Insert', 'Graph on page', 'Spleen (donut)')
  await expect(items(page)).toHaveCount(1)
  await expectUndo(page, 'Add graph to layout')
  await menu(page, 'Insert', 'Graph on page', 'Survey (pie)')
  await expect(items(page)).toHaveCount(2)
  // Each added graph is stepped 12 pt down and right of the one before (then Arrange lays out).
  const [a, b] = await boxes(page)
  expect(b!.x - a!.x).toBeCloseTo(12, 1)
  expect(b!.y - a!.y).toBeCloseTo(12, 1)
  await menu(page, 'Arrange', /^Arrange in a grid/)
  await expectUndo(page, 'Arrange graphs')
  const [c, d] = await boxes(page)
  const overlap =
    c!.x < d!.x + d!.w && d!.x < c!.x + c!.w && c!.y < d!.y + d!.h && d!.y < c!.y + c!.h
  expect(overlap).toBe(false)
  await undo(page)
  await undo(page)
  await expect(items(page)).toHaveCount(1)
})

/** Selects page items: a click on the first, Shift-clicks on the others. */
async function selectItems(page: Page, ...indices: number[]) {
  for (const [k, i] of indices.entries())
    await item(page, i).click({ modifiers: k ? ['Shift'] : [] })
  if (indices.length > 1)
    await expect(page.getByRole('toolbar', { name: 'Arrange the selected graphs' })).toBeVisible()
}

/** Screen left edges of the plots (Y axis lines) of the page's graphs, in item order. */
const plotLefts = (page: Page) =>
  pageSvg(page)
    .locator('[data-id="axis/y/line"]')
    .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().x))

test('Arrange: stack, side by side, align and same size move the selected graphs', async ({
  page,
}) => {
  const n = await newLayout(page, 'getting-started')
  expect(n).toBeGreaterThanOrEqual(3)
  await selectItems(page, 0, 2)
  const before = await boxes(page)

  await menu(page, 'Arrange', 'Stack vertically')
  await expectUndo(page, 'Stack graphs')
  let [a, , c] = await boxes(page)
  // One above the other.
  expect(a!.y + a!.h <= c!.y + 0.5 || c!.y + c!.h <= a!.y + 0.5).toBe(true)
  await undo(page)
  await expect.poll(() => boxes(page)).toEqual(before)

  await menu(page, 'Arrange', 'Side by side')
  await expectUndo(page, 'Place graphs side by side')
  ;[a, , c] = await boxes(page)
  expect(a!.x + a!.w <= c!.x + 0.5 || c!.x + c!.w <= a!.x + 0.5).toBe(true)
  await undo(page)
  await expect.poll(() => boxes(page)).toEqual(before)

  // Align plot left edges: two graphs of different grid columns (one column's plots line up
  // already) — their plots' left edges line up.
  await pageSvg(page).click({ position: { x: 3, y: 3 } })
  await selectItems(page, 0, 1)
  const lefts0 = await plotLefts(page)
  expect(Math.abs(lefts0[0]! - lefts0[1]!)).toBeGreaterThan(20)
  await menu(page, 'Arrange', 'Align plot left edges')
  await expectUndo(page, 'Align plot left edges')
  const lefts = await plotLefts(page)
  expect(Math.abs(lefts[0]! - lefts[1]!)).toBeLessThan(0.5)
  expect(await boxes(page)).not.toEqual(before)
  await undo(page)

  // Same size, from the align bar this time.
  await page
    .getByRole('toolbar', { name: 'Arrange the selected graphs' })
    .getByRole('button', { name: /Same size/ })
    .click()
  await expectUndo(page, 'Make plot sizes equal')
  const sized = await boxes(page)
  expect(sized).not.toEqual(before)
})

test('a graph selected on the page resizes from its plot handles, opposite corner put', async ({
  page,
}) => {
  await openExample(page, 'getting-started')
  await openSheet(page, 'Figure 1', 'Layouts')
  const target = item(page, 0)
  await target.click()
  await expect(page.getByRole('heading', { name: 'Graph on page' })).toBeVisible()
  const handles = pageSvg(page).locator('rect.resize-handle')
  await expect(handles).toHaveCount(8)
  const b0 = await itemBox(target)
  const anchor = handles.and(page.locator('[data-handle="nw"]'))
  const a0 = await centre(anchor)
  await drag(page, await centre(handles.and(page.locator('[data-handle="se"]'))), 40, 30, {
    during: async () => {
      await expect(page.getByRole('main').locator('.hint')).toContainText(/Plot [\d.]+ × [\d.]+ in/)
      const a1 = await centre(anchor)
      expect(Math.abs(a1.x - a0.x)).toBeLessThan(1.5)
      expect(Math.abs(a1.y - a0.y)).toBeLessThan(1.5)
    },
  })
  await expect.poll(async () => (await itemBox(target)).w).toBeGreaterThan(b0.w)
  expect((await itemBox(target)).h).toBeGreaterThan(b0.h)
  await expectUndo(page, 'Resize graph')
  await undo(page)
  await expect.poll(() => itemBox(target)).toEqual(b0)
})

test('Size on page (%) scales the placed graph', async ({ page }) => {
  await openExample(page, 'getting-started')
  await openSheet(page, 'Figure 1', 'Layouts')
  const target = item(page, 1)
  await target.click()
  const size = page.getByLabel('Size on page (%)')
  const pct = Number(await size.inputValue())
  const b0 = await itemBox(target)
  await size.fill(String(pct / 2))
  await size.press('Enter')
  await expect.poll(async () => (await itemBox(target)).w).toBeCloseTo(b0.w / 2, 0)
  expect((await itemBox(target)).h).toBeCloseTo(b0.h / 2, 0)
  await expectUndo(page, 'Resize graph')
  // Moving it by dragging, one undo step.
  const from = await centre(target)
  await drag(page, from, 60, 40)
  await expect.poll(async () => (await itemBox(target)).x).not.toBeCloseTo(b0.x, 0)
  await expectUndo(page, 'Move item')
})

/** Copies “Dose response (bars)” with Copy graph (⇧⌘C) and opens the Figure 1 page. */
async function copyBarsGraph(page: Page, copied: RegExp) {
  await openGraph(page, 'getting-started', 'Dose response (bars)')
  await page.keyboard.press(`${await appMod(page)}+Shift+C`)
  await expect(toast(page)).toContainText(copied)
  await openSheet(page, 'Figure 1', 'Layouts')
}

/** The pasted graph is the one selected, with its own inspector. */
async function expectPasted(page: Page, count: number) {
  await expect(items(page)).toHaveCount(count)
  await expectUndo(page, 'Paste graph')
  await expect(page.getByRole('heading', { name: 'Graph on page' })).toBeVisible()
  await expect(page.getByLabel('Graph', { exact: true }).locator('option:checked')).toHaveText(
    'Dose response (bars)',
  )
}

test('a copied graph pastes onto a layout page with ⌘V, at the pointer', async ({
  page,
  browserName,
  context,
}) => {
  if (browserName === 'chromium')
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  // What each browser takes: SVG where ClipboardItem.supports says so (Chromium, WebKit), a PNG,
  // and the SVG code as text.
  await copyBarsGraph(
    page,
    browserName === 'firefox'
      ? /^Copied “Dose response \(bars\)” as image \(PNG\) and SVG code/
      : /^Copied “Dose response \(bars\)” as vector \(SVG\) and image \(PNG\)\./,
  )
  const n = await items(page).count()
  const view = await box(pageSvg(page))
  const at = { x: view.x + view.w * 0.3, y: view.y + view.h * 0.7 }
  await page.mouse.move(at.x, at.y)
  await page.getByRole('main').locator('.canvas').focus()
  // The browser's own paste (the host's key): its event carries the SVG code copied, so the app
  // knows the clipboard still holds that graph.
  await page.keyboard.press('ControlOrMeta+V')
  await expectPasted(page, n + 1)
  // Centred on the pointer, as far as the page allows.
  const b = await box(item(page, n))
  expect(Math.abs(b.x + b.w / 2 - at.x)).toBeLessThan(20)
  expect(Math.abs(b.y + b.h / 2 - at.y)).toBeLessThan(20)
})

test('when the clipboard refuses the copy, the graph still pastes from Edit › Paste graph', async ({
  page,
}) => {
  // A browser that refuses the asynchronous clipboard (permissions, an embedding webview).
  await page.addInitScript(() => {
    const refuse = () =>
      Promise.reject(new DOMException('Write permission denied.', 'NotAllowedError'))
    Object.defineProperty(navigator.clipboard, 'write', { value: refuse })
    Object.defineProperty(navigator.clipboard, 'writeText', { value: refuse })
  })
  await copyBarsGraph(
    page,
    /^The clipboard could not be written here \(.*\)\. The graph can still be pasted onto a layout page\. Export… saves it as a file\./,
  )
  const n = await items(page).count()
  await menu(page, 'Edit', 'Paste graph')
  await expectPasted(page, n + 1)
  // Pasted again: stepped off the first copy.
  await menu(page, 'Edit', 'Paste graph')
  await expect(items(page)).toHaveCount(n + 2)
  const [a, b] = [await itemBox(item(page, n)), await itemBox(item(page, n + 1))]
  expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(1)
})
