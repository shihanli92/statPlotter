import { readFile, writeFile } from 'node:fs/promises'
import type { Download, Locator, Page } from '@playwright/test'
import { readPng } from '../../../packages/graph/test/imageRead.ts'
import { expect, openExample, test } from './fixtures.ts'
import { pressShortcut, tool, typeCells } from './helpers-data.ts'
import {
  appMod,
  box,
  canvas,
  centre,
  drag,
  expectUndo,
  fontSize,
  formatPanel,
  inWindow,
  menu,
  openGraph,
  openSheet,
  section,
  sheet,
  toast,
  undo,
} from './helpers-graph.ts'

// Layout objects (roadmap 32): drawing tools, handles, images, groups, arranging, locks, live
// tables, and pages with images exported and saved.

test.use({ viewport: { width: 1400, height: 1000 } })

const pageSvg = (page: Page) => page.getByRole('img', { name: 'Layout page' })
const items = (page: Page) => pageSvg(page).locator('[data-testid^="layout-item-"]')
const item = (page: Page, i: number) => pageSvg(page).getByTestId(`layout-item-${i}`)
const tools = (page: Page) => page.getByRole('toolbar', { name: 'Drawing tools' })
const inspector = (page: Page) => page.locator('.inspector')
const heading = (page: Page) => inspector(page).locator('.inspector-header h2').first()
const FIXTURES = new URL('../fixtures/', import.meta.url)

/** An item's box on the page, in points (its hit rectangle's attributes). */
async function itemBox(l: Locator) {
  const [x, y, w, h] = await l.evaluate((e) =>
    ['x', 'y', 'width', 'height'].map((a) => Number(e.getAttribute(a))),
  )
  return { x: x!, y: y!, w: w!, h: h! }
}

/** Screen pixels per page point. */
async function scale(page: Page): Promise<number> {
  const [, , w] = (await pageSvg(page).getAttribute('viewBox'))!.split(' ').map(Number)
  return (await box(pageSvg(page))).w / w!
}

/** A page point on the screen. */
async function at(page: Page, x: number, y: number) {
  const b = await box(pageSvg(page))
  const k = await scale(page)
  return { x: b.x + x * k, y: b.y + y * k }
}

/** Draws from one page point to another with the tool in hand. */
async function draw(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  modifiers: string[] = [],
) {
  const k = await scale(page)
  await drag(page, await at(page, from.x, from.y), (to.x - from.x) * k, (to.y - from.y) * k, {
    modifiers,
  })
}

/** The getting-started example with a new, empty layout page. */
async function blankLayout(page: Page) {
  await openExample(page, 'getting-started')
  await menu(page, 'Insert', 'New layout')
  await expect(pageSvg(page)).toBeVisible()
  await menu(page, 'Edit', 'Select all')
  await menu(page, 'Arrange', 'Remove items from page')
  await expect(items(page)).toHaveCount(0)
}

const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol

test('drawing tools make rectangles, ellipses, lines, arrows and text boxes', async ({ page }) => {
  await blankLayout(page)
  const rect = tools(page).getByRole('button', { name: 'Rectangle' })
  await rect.click()
  await expect(rect).toHaveAttribute('aria-pressed', 'true')
  await draw(page, { x: 80, y: 80 }, { x: 200, y: 140 })
  await expect(items(page)).toHaveCount(1)
  // The tool is put down once used; the new object is selected.
  await expect(rect).toHaveAttribute('aria-pressed', 'false')
  await expect(heading(page)).toHaveText('Rectangle')
  await expectUndo(page, 'Add rectangle')
  const r = await itemBox(item(page, 0))
  expect(near(r.x, 80) && near(r.y, 80) && near(r.w, 120) && near(r.h, 60)).toBe(true)

  // Shift makes a circle.
  await tools(page).getByRole('button', { name: 'Ellipse' }).click()
  await draw(page, { x: 260, y: 80 }, { x: 340, y: 110 }, ['Shift'])
  const e = await itemBox(item(page, 1))
  expect(near(e.w, e.h, 0.5)).toBe(true)
  expect(near(e.w, 80)).toBe(true)
  await expect(pageSvg(page).locator('ellipse[data-id^="item/"]')).toHaveCount(1)

  // Shift keeps a line level (45° steps).
  await tools(page).getByRole('button', { name: 'Line' }).click()
  await draw(page, { x: 80, y: 220 }, { x: 240, y: 232 }, ['Shift'])
  const l = await itemBox(item(page, 2))
  // Level: the hit box's least height.
  expect(l.h).toBeLessThanOrEqual(4)
  expect(near(l.w, 160, 4)).toBe(true)
  await expectUndo(page, 'Add line')

  // Arrow from the Insert menu: a line with a filled head.
  // (The tools are ticked in the menu while in hand: menu item checkboxes.)
  await page.getByRole('menubar').getByRole('menuitem', { name: 'Insert', exact: true }).click()
  await page
    .getByRole('menu', { name: 'Insert', exact: true })
    .getByRole('menuitemcheckbox', { name: 'Arrow' })
    .click()
  await draw(page, { x: 300, y: 220 }, { x: 420, y: 300 })
  await expect(pageSvg(page).locator('polygon[data-id$="/head/0"]')).toHaveCount(1)
  await expectUndo(page, 'Add arrow')
  await expect(heading(page)).toHaveText('Arrow')

  // A click makes a text box of the default size, typed into straight away.
  await tools(page).getByRole('button', { name: 'Text box' }).click()
  const p = await at(page, 80, 360)
  await page.mouse.click(p.x, p.y)
  const editor = page.getByRole('textbox', { name: 'Edit text' })
  await expect(editor).toBeFocused()
  await page.keyboard.type('Hello page')
  await page.keyboard.press('Enter')
  await expect(pageSvg(page).locator('text[data-id^="item/"]')).toHaveText('Hello page')
  await expect(items(page)).toHaveCount(5)

  // Escape puts a tool down without drawing.
  const line = tools(page).getByRole('button', { name: 'Line' })
  await line.click()
  await page.keyboard.press('Escape')
  await expect(line).toHaveAttribute('aria-pressed', 'false')
  await expect(pageSvg(page).getByTestId('draw-surface')).toHaveCount(0)
  await undo(page)
  await undo(page)
  await expect(items(page)).toHaveCount(4)
})

test('handles resize boxes (Shift keeps the proportions) and move line ends', async ({ page }) => {
  await blankLayout(page)
  await tools(page).getByRole('button', { name: 'Rectangle' }).click()
  await draw(page, { x: 100, y: 100 }, { x: 200, y: 150 })
  const k = await scale(page)
  const handle = (h: string) => pageSvg(page).locator(`.item-handle[data-handle="${h}"]`)
  await expect(handle('se')).toHaveCount(1)
  await expect(pageSvg(page).locator('.item-handle[data-handle]')).toHaveCount(8)
  await drag(page, await centre(handle('se')), 40 * k, 20 * k, { modifiers: ['Alt'] })
  await expect.poll(async () => near((await itemBox(item(page, 0))).w, 140)).toBe(true)
  expect(near((await itemBox(item(page, 0))).h, 70)).toBe(true)
  await expectUndo(page, 'Resize item')
  // From the right edge with Shift: the height follows, centred.
  await drag(page, await centre(handle('e')), 70 * k, 0, { modifiers: ['Shift', 'Alt'] })
  await expect.poll(async () => near((await itemBox(item(page, 0))).w, 210)).toBe(true)
  expect(near((await itemBox(item(page, 0))).h, 105)).toBe(true)

  // A line's end: dragged freely, then along 45° with Shift.
  await tools(page).getByRole('button', { name: 'Line' }).click()
  await draw(page, { x: 100, y: 300 }, { x: 250, y: 300 })
  const end = pageSvg(page).locator('.item-handle[data-end="to"]')
  await expect(end).toHaveCount(1)
  await drag(page, await centre(end), 0, 60 * k, { modifiers: ['Alt'] })
  await expect.poll(async () => (await itemBox(item(page, 1))).h).toBeGreaterThan(55)
  await expectUndo(page, 'Move line end')
  await drag(page, await centre(end), 10 * k, 30 * k, { modifiers: ['Shift'] })
  const b = await itemBox(item(page, 1))
  // At 45°: as wide as it is tall (the heads-free line's box adds its half width all round).
  expect(near(b.w, b.h, 2)).toBe(true)
})

test('images: Insert › Image… from a file, crop, proportions, a drop and what isn’t allowed', async ({
  page,
}) => {
  await blankLayout(page)
  const chooser = page.waitForEvent('filechooser')
  await menu(page, 'Insert', 'Image…')
  await (await chooser).setFiles(new URL('micrograph.png', FIXTURES).pathname)
  await expect(items(page)).toHaveCount(1)
  await expectUndo(page, 'Add image')
  await expect(heading(page)).toHaveText('Image')
  await expect(inspector(page)).toContainText('160 × 100 pixels, PNG')
  // 144 dpi: 80 × 50 pt.
  const b0 = await itemBox(item(page, 0))
  expect(near(b0.w, 80) && near(b0.h, 50)).toBe(true)
  await expect(pageSvg(page).locator('svg[data-id$="/image"] image')).toHaveAttribute(
    'href',
    /^blob:/,
  )

  // Crop half off the left: the box keeps the picture's scale and moves with the edge.
  const left = inspector(page).getByLabel('Left', { exact: true }).first()
  await left.fill('50')
  await left.press('Enter')
  await expectUndo(page, 'Crop image')
  await expect.poll(async () => near((await itemBox(item(page, 0))).w, 40)).toBe(true)
  expect(near((await itemBox(item(page, 0))).x, b0.x + 40)).toBe(true)
  await expect(pageSvg(page).locator('svg[data-id$="/image"]')).toHaveAttribute(
    'viewBox',
    '80 0 80 100',
  )

  // Resizing keeps the proportions; Alt frees them.
  const k = await scale(page)
  const se = pageSvg(page).locator('.item-handle[data-handle="e"]')
  await drag(page, await centre(se), 40 * k, 0)
  await expect.poll(async () => near((await itemBox(item(page, 0))).w, 80)).toBe(true)
  expect(near((await itemBox(item(page, 0))).h, 100)).toBe(true)
  await drag(page, await centre(se), 20 * k, 0, { modifiers: ['Alt'] })
  await expect.poll(async () => near((await itemBox(item(page, 0))).w, 100)).toBe(true)
  expect(near((await itemBox(item(page, 0))).h, 100)).toBe(true)

  // A JPEG dropped on the page lands where it was dropped.
  const jpeg = [...(await readFile(new URL('photo.jpg', FIXTURES)))]
  const spot = await at(page, 400, 400)
  await page
    .getByRole('main')
    .locator('.canvas')
    .evaluate(
      (el, { bytes, spot }) => {
        const dt = new DataTransfer()
        dt.items.add(new File([new Uint8Array(bytes)], 'photo.jpg', { type: 'image/jpeg' }))
        const opts = {
          dataTransfer: dt,
          bubbles: true,
          cancelable: true,
          clientX: spot.x,
          clientY: spot.y,
        }
        el.dispatchEvent(new DragEvent('dragover', opts))
        el.dispatchEvent(new DragEvent('drop', opts))
      },
      { bytes: jpeg, spot },
    )
  await expect(items(page)).toHaveCount(2)
  const dropped = await itemBox(item(page, 1))
  // 180 × 120 px at 150 dpi, centred where it fell.
  expect(near(dropped.w, 86.4) && near(dropped.x + dropped.w / 2, 400)).toBe(true)

  // An image pasted (a paste event carrying the file, as from a screenshot): placed too.
  const png = [...(await readFile(new URL('micrograph.png', FIXTURES)))]
  await page.getByRole('main').locator('.canvas').focus()
  await page.evaluate((bytes) => {
    const dt = new DataTransfer()
    dt.items.add(new File([new Uint8Array(bytes)], 'image.png', { type: 'image/png' }))
    const e = new ClipboardEvent('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(e, 'clipboardData', { value: dt })
    document.dispatchEvent(e)
  }, png)
  await expect(items(page)).toHaveCount(3)
  await expectUndo(page, 'Add image')
  await undo(page)
  await expect(items(page)).toHaveCount(2)

  // TIFF can't be placed: a message says why.
  const tiff = page.waitForEvent('filechooser')
  await menu(page, 'Insert', 'Image…')
  await (await tiff).setFiles({
    name: 'blot.tif',
    mimeType: 'image/tiff',
    buffer: Buffer.from([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0]),
  })
  await expect(toast(page)).toContainText('blot.tif: TIFF images can’t be placed')
  await expect(items(page)).toHaveCount(2)
})

test('group, align, distribute, duplicate and lock', async ({ page }) => {
  await blankLayout(page)
  for (const [x, y] of [
    [60, 80],
    [240, 120],
    [420, 100],
  ]) {
    await tools(page).getByRole('button', { name: 'Rectangle' }).click()
    const p = await at(page, x!, y!)
    await page.mouse.click(p.x, p.y)
  }
  await expect(items(page)).toHaveCount(3)
  const boxes = async () => Promise.all([0, 1, 2].map((i) => itemBox(item(page, i))))

  // The selection follows the items, not their places in the stack (audit 2, U1): bring the
  // first to the front, undo, delete: the first one goes.
  const xs = async () => (await boxes()).map((b) => b.x)
  const order = await xs()
  await item(page, 0).click()
  await menu(page, 'Arrange', 'Bring to front')
  await expectUndo(page, 'Bring to front')
  await page.keyboard.press(`${await appMod(page)}+Z`)
  await expect.poll(xs).toEqual(order)
  await expect(heading(page)).toHaveText('Rectangle')
  await page.keyboard.press('Delete')
  await expect(items(page)).toHaveCount(2)
  const left = await Promise.all([0, 1].map((i) => itemBox(item(page, i))))
  expect(left.map((b) => b.x)).toEqual(order.slice(1))
  await undo(page)
  await expect(items(page)).toHaveCount(3)
  await expect.poll(xs).toEqual(order)

  await menu(page, 'Edit', 'Select all')
  await expect(heading(page)).toHaveText('3 items')
  await menu(page, 'Arrange', 'Align', 'Top')
  await expectUndo(page, 'Align top')
  expect(new Set((await boxes()).map((b) => b.y)).size).toBe(1)
  // Spread unevenly, then distributed: equal gaps, the outer ones staying.
  await menu(page, 'Arrange', 'Distribute', 'Horizontally')
  await expectUndo(page, 'Distribute horizontally')
  const [a, b, c] = await boxes()
  expect(near(b!.x - (a!.x + a!.w), c!.x - (b!.x + b!.w), 0.5)).toBe(true)
  expect(a!.x).toBeCloseTo(60, 0)

  // Group the first two: a click on one selects both; they move together.
  await item(page, 0).click()
  await item(page, 1).click({ modifiers: ['Shift'] })
  const mod = await appMod(page)
  await page.keyboard.press(`${mod}+G`)
  await expectUndo(page, 'Group')
  await pageSvg(page).click({ position: { x: 5, y: 5 } })
  await item(page, 0).click()
  await expect(heading(page)).toHaveText('2 items')
  const before = await boxes()
  const k = await scale(page)
  await drag(page, await centre(item(page, 0)), 0, 50 * k, { modifiers: ['Alt'] })
  const after = await boxes()
  expect(near(after[0]!.y - before[0]!.y, 50)).toBe(true)
  expect(near(after[1]!.y - before[1]!.y, 50)).toBe(true)
  expect(after[2]!.y).toBe(before[2]!.y)
  // Corner handles scale the group as one.
  await expect(pageSvg(page).locator('.item-handle[data-handle]')).toHaveCount(4)
  await page.keyboard.press(`${mod}+Shift+G`)
  await expectUndo(page, 'Ungroup')
  await item(page, 0).click()
  await expect(heading(page)).toHaveText('Rectangle')

  // Duplicate: a copy 12 pt down and right, selected.
  await page.keyboard.press(`${mod}+D`)
  await expect(items(page)).toHaveCount(4)
  await expectUndo(page, 'Duplicate')
  const copy = await itemBox(item(page, 3))
  expect(copy.x - after[0]!.x).toBeCloseTo(12, 0)
  expect(copy.y - after[0]!.y).toBeCloseTo(12, 0)

  // Locked: clicks pass through it; the page panel lists it; Unlock all frees it.
  await menu(page, 'Arrange', 'Lock')
  await expectUndo(page, 'Lock item')
  // Its bottom-right corner, clear of the original under it.
  const lockedBox = await box(item(page, 3))
  await item(page, 3).click({
    force: true,
    position: { x: lockedBox.w - 4, y: lockedBox.h - 4 },
  })
  await expect(heading(page)).toHaveText('Page')
  const locked = inspector(page).locator('section').filter({ hasText: 'Locked items' })
  await expect(locked.getByRole('button', { name: /^Rectangle/ })).toHaveCount(1)
  await menu(page, 'Arrange', 'Unlock all')
  await item(page, 3).click()
  await expect(heading(page)).toHaveText('Rectangle')
})

test('the page marquee picks the items it touches, locked ones passed by, groups whole', async ({
  page,
}) => {
  // Roadmap 44: the page's marquee goes through the shared `pickInBox` (decision 191 kept).
  await blankLayout(page)
  for (const [x, y] of [
    [60, 80],
    [240, 80],
    [420, 80],
  ]) {
    await tools(page).getByRole('button', { name: 'Rectangle' }).click()
    const p = await at(page, x!, y!)
    await page.mouse.click(p.x, p.y)
  }
  await expect(items(page)).toHaveCount(3)
  const [a, b, c] = await Promise.all([0, 1, 2].map((i) => itemBox(item(page, i))))
  /** A box from the empty page below the items up to their middle, from page x `x0` to `x1`. */
  const sweep = (x0: number, x1: number, modifiers: string[] = []) =>
    draw(page, { x: x0, y: a!.y + a!.h + 40 }, { x: x1, y: a!.y + a!.h / 2 }, modifiers)
  const clear = () => pageSvg(page).click({ position: { x: 5, y: 5 } })

  // Touching is enough: half of the first, a corner of the second.
  await sweep(a!.x + a!.w / 2, b!.x + 4)
  await expect(heading(page)).toHaveText('2 items')
  // Short of the second: the first alone.
  await clear()
  await sweep(a!.x + 4, b!.x - 4)
  await expect(heading(page)).toHaveText('Rectangle')
  // Shift adds: the third.
  await sweep(c!.x + 4, c!.x + c!.w + 10, ['Shift'])
  await expect(heading(page)).toHaveText('2 items')

  // Locked items are passed by.
  await item(page, 1).click()
  await menu(page, 'Arrange', 'Lock')
  await clear()
  await sweep(a!.x + 4, c!.x + 4)
  await expect(heading(page)).toHaveText('2 items')
  await menu(page, 'Arrange', 'Unlock all')

  // A group is picked whole: a box touching the second picks the third with it.
  await item(page, 1).click()
  await item(page, 2).click({ modifiers: ['Shift'] })
  await page.keyboard.press(`${await appMod(page)}+G`)
  await expectUndo(page, 'Group')
  await clear()
  await sweep(b!.x + 4, b!.x + 10)
  await expect(heading(page)).toHaveText('2 items')
})

test('a live table follows its data and results', async ({ page }) => {
  await blankLayout(page)
  // On a page, the Insert menu has the page's Table… and the app's New data table… (audit 2, U2).
  await page.getByRole('menubar').getByRole('menuitem', { name: 'Insert', exact: true }).click()
  const insertMenu = page.getByRole('menu', { name: 'Insert', exact: true })
  await expect(insertMenu.getByRole('menuitem', { name: /^New data table…/ })).toBeVisible()
  await expect(insertMenu.getByRole('menuitem', { name: /^Table…/ })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(insertMenu).toBeHidden()
  await tools(page).getByRole('button', { name: 'Table…' }).click()
  const d = page.locator('dialog[open]')
  await d
    .getByLabel('Table to show')
    .selectOption({ label: 'Descriptive statistics – Descriptive statistics' })
  await d.getByRole('button', { name: 'Insert' }).click()
  await expect(items(page)).toHaveCount(1)
  await expectUndo(page, 'Add table')
  const cells = pageSvg(page).locator('text[data-id*="/cell/"]')
  await expect(cells.filter({ hasText: /^Mean$/ })).toHaveCount(1)
  await expect(cells.filter({ hasText: /^43\.48$/ })).toHaveCount(1)
  // First data rows only.
  await inspector(page).getByLabel('Last row (0: all)').fill('2')
  await inspector(page).getByLabel('Last row (0: all)').press('Enter')
  await expect(cells.filter({ hasText: /^Mean$/ })).toHaveCount(0)
  await undo(page)
  await expect(cells.filter({ hasText: /^Mean$/ })).toHaveCount(1)

  // A value 100 higher raises the mean of ten by 10.
  const layoutName = (await page.locator('.nav-item.on .name').textContent())!
  await openSheet(page, 'Enzyme activity', 'Data Tables')
  await typeCells(page, 0, 0, [['142.3']])
  await openSheet(page, layoutName, 'Layouts')
  await expect(cells.filter({ hasText: /^53\.48$/ })).toHaveCount(1)
})

/** Runs `action` and returns the download it starts, with its bytes. */
async function download(page: Page, action: () => Promise<void>) {
  const [d] = await Promise.all([page.waitForEvent('download'), action()])
  const path = await (d as Download).path()
  return { name: d.suggestedFilename(), bytes: new Uint8Array(await readFile(path)) }
}

test.describe('pages with images', () => {
  test.beforeEach(async ({ page }) => {
    // Downloads and a file input rather than Chromium's native pickers.
    await page.addInitScript(() => {
      const w = window as unknown as Record<string, unknown>
      for (const name of ['showSaveFilePicker', 'showOpenFilePicker']) {
        delete (Window.prototype as unknown as Record<string, unknown>)[name]
        delete w[name]
      }
    })
  })

  async function withImage(page: Page) {
    await blankLayout(page)
    const chooser = page.waitForEvent('filechooser')
    await menu(page, 'Insert', 'Image…')
    await (await chooser).setFiles(new URL('micrograph.png', FIXTURES).pathname)
    await expect(items(page)).toHaveCount(1)
    return itemBox(item(page, 0))
  }

  test('export to PDF and PNG with the image in them', async ({ page }) => {
    const b = await withImage(page)
    const pdf = await download(page, () => menu(page, 'File', 'Export', 'PDF…'))
    const text = Buffer.from(pdf.bytes).toString('latin1')
    expect(text).toContain('/Subtype /Image /Width 160 /Height 100')
    // Its alpha as a soft mask.
    expect(text).toMatch(/\/SMask \d+ 0 R/)
    const png = await download(page, () => menu(page, 'File', 'Export', 'PNG (300 dpi)…'))
    const img = readPng(png.bytes)
    const px = (x: number, y: number) => {
      const i = (Math.round((y * 300) / 72) * img.width + Math.round((x * 300) / 72)) * img.channels
      return [...img.pixels.subarray(i, i + 3)]
    }
    // The image's opaque left part: blue 180, little red.
    const [r, , blue] = px(b.x + 3, b.y + 3)
    expect(blue).toBeGreaterThan(150)
    expect(r).toBeLessThan(60)
    // Outside it: the white page.
    expect(px(b.x + b.w + 20, b.y + 3)).toEqual([255, 255, 255])
  })

  test('save and open again: the image comes back with the page', async ({ page }, testInfo) => {
    const b = await withImage(page)
    const file = await download(page, () => menu(page, 'File', 'Save'))
    expect(file.name).toMatch(/\.psproj$/)
    const layoutName = (await page.locator('.nav-item.on .name').textContent())!
    const path = testInfo.outputPath('with-image.psproj')
    await writeFile(path, file.bytes)
    // Saved: closed without a question.
    await menu(page, 'File', 'Close project')
    await expect(page.getByRole('heading', { name: 'Start a project' })).toBeVisible()
    const chooser = page.waitForEvent('filechooser')
    await menu(page, 'File', 'Open…')
    await (await chooser).setFiles(path)
    await expect(page).toHaveTitle('with-image.psproj — statPlotter')
    await sheet(page, layoutName, 'Layouts').click()
    await expect(pageSvg(page).locator('svg[data-id$="/image"] image')).toHaveAttribute(
      'href',
      /^blob:/,
    )
    expect(await itemBox(item(page, 0))).toEqual(b)
    await expect(pageSvg(page)).not.toContainText('Missing image')
  })
})

test('graph line annotations: end handles and arrowheads', async ({ page }) => {
  const svg = await openGraph(page, 'getting-started', 'Enzyme activity (scatter)')
  await menu(page, 'Insert', 'Arrow')
  const end = svg.locator('.item-handle[data-end="to"]')
  await expect(end).toHaveCount(1)
  const line = svg.locator('line[data-id$="/line"][data-id^="annotation/"]')
  const x0 = Number(await line.getAttribute('x2'))
  await drag(page, await centre(end), 40, 0, { modifiers: ['Alt'] })
  await expectUndo(page, 'Move line end')
  await expect.poll(async () => Number(await line.getAttribute('x2'))).toBeGreaterThan(x0 + 10)
  await expect(canvas(page).locator('polygon[data-id^="annotation/"]')).toHaveCount(1)
})

// Roadmap 44 (stage 2): parts of graphs on a page — a click on a part of the graph selected alone
// selects it (halo through the item's transform, named in the hint, Format and ⇧⌘E open it),
// Shift-click adds parts of other graphs, Escape steps back out, a drag moves the selected parts
// together; several items show the fields they share.

const hint = (page: Page) => page.getByRole('main').locator('.view-toolbar .hint')
/** Every graph's Y axis title on Figure 1 (A: scatter, B: bars, C: swarm). */
const yTitles = (page: Page) => pageSvg(page).locator('[data-id="axis/y/title"]')
/** A click at an element's centre, with modifiers held. */
async function clickCentre(page: Page, l: Locator, modifiers: string[] = []) {
  const c = await centre(l)
  for (const m of modifiers) await page.keyboard.down(m)
  await page.mouse.click(c.x, c.y)
  for (const m of [...modifiers].reverse()) await page.keyboard.up(m)
}
/** Whether a part halo on the page is drawn round this element. */
async function haloed(page: Page, l: Locator): Promise<boolean> {
  const b = await box(l)
  const halos = await pageSvg(page)
    .locator('.page-element-halo > *, .page-element-halo g > *')
    .evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect()
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
      }),
    )
  return halos.some(
    (h) => h.x >= b.x - 3 && h.x <= b.x + b.w + 3 && h.y >= b.y - 3 && h.y <= b.y + b.h + 3,
  )
}

test('a click on a part of the graph selected alone selects it; Format opens it on its graph', async ({
  page,
}) => {
  await openExample(page, 'getting-started')
  await openSheet(page, 'Figure 1', 'Layouts')
  const [yA, yB, yC] = [0, 1, 2].map((i) => yTitles(page).nth(i))
  // A click on B's title first selects the graph B (the first click is the item's).
  await clickCentre(page, yB!)
  await expect(heading(page)).toHaveText('Graph on page')
  await expect(pageSvg(page).locator('.page-element-halo')).toHaveCount(0)
  // The second, its Y axis title: haloed through the item's transform, named in the hint.
  await clickCentre(page, yB!)
  await expect(heading(page)).toHaveText('Y axis title')
  await expect(hint(page)).toContainText('Y axis title of “Dose response (bars)”')
  await expect(page.getByTestId('page-selection-announcement')).toHaveText(
    'Y axis title of “Dose response (bars)”',
  )
  expect(await haloed(page, yB!)).toBe(true)
  expect(await haloed(page, yC!)).toBe(false)
  // The Format button names it; ⇧⌘E opens graph B's Y axis, at its title (roadmap 46).
  await expect(tool(page, /^Format .+…$/)).toHaveAccessibleName('Format Y axis title…')
  const sizeB = await fontSize(yB!)
  const sizeA = await fontSize(yA!)
  await pressShortcut(page, 'Mod+Shift+E')
  const d = await inWindow(page, 'Format axes')
  await expect(d.getByRole('tab', { name: 'Y axis', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  const size = section(d, 'Common').getByLabel('Title size (pt)')
  await size.fill(String(sizeB + 6))
  await d.getByRole('button', { name: 'OK' }).click()
  await expect(d).toBeHidden()
  // Roadmap 46: the Format panel ⇧⌘E showed has the inspector's place while a graph is worked
  // in; closed, the inspector is back.
  await expect(formatPanel(page).getByRole('heading', { level: 2 })).toHaveText('Y axis')
  await formatPanel(page).getByRole('button', { name: 'Close the Format panel' }).click()
  await expect(heading(page)).toHaveText('Y axis title')
  // Graph B's own document changed, one undo step; graph A's title stays.
  await expect.poll(() => fontSize(yB!)).toBe(sizeB + 6)
  expect(await fontSize(yA!)).toBe(sizeA)
  await expectUndo(page, 'Format axes')
  await openSheet(page, 'Dose response (bars)', 'Graphs')
  await expect
    .poll(() => fontSize(canvas(page).locator('[data-id="axis/y/title"]')))
    .toBe(sizeB + 6)
  await openSheet(page, 'Figure 1', 'Layouts')
  await undo(page)
  await expect.poll(() => fontSize(yB!)).toBe(sizeB)

  // Shift-click C's Y title too: both selected, across the two graphs; Delete leaves the titles
  // (nothing to delete) and the graphs on the page.
  await clickCentre(page, yB!)
  await clickCentre(page, yB!)
  await expect(heading(page)).toHaveText('Y axis title')
  await clickCentre(page, yC!, ['Shift'])
  await expect(heading(page)).toHaveText('2 elements in 2 graphs')
  expect(await haloed(page, yB!)).toBe(true)
  expect(await haloed(page, yC!)).toBe(true)
  const count = await items(page).count()
  await page.keyboard.press('Delete')
  await expect(items(page)).toHaveCount(count)
  await expect(yTitles(page)).toHaveCount(3)

  // A drag on one moves both (Alt: no snapping), one undo step.
  const [b0, c0] = [await box(yB!), await box(yC!)]
  await drag(page, await centre(yB!), -12, 0, { modifiers: ['Alt'] })
  await expectUndo(page, 'Move 2 elements')
  const [b1, c1] = [await box(yB!), await box(yC!)]
  expect(b1.x).toBeLessThan(b0.x - 4)
  expect(c1.x).toBeLessThan(c0.x - 2)
  await expect(heading(page)).toHaveText('2 elements in 2 graphs')
  await undo(page)
  await expect.poll(async () => Math.abs((await box(yC!)).x - c0.x)).toBeLessThan(0.6)

  // Escape: back to the primary part's graph item, then nothing.
  await page.keyboard.press('Escape')
  await expect(heading(page)).toHaveText('Graph on page')
  await page.keyboard.press('Escape')
  await expect(heading(page)).toHaveText('Page')
})

test('a press-drag on a part still moves it; Delete hides selected data sets in their layer', async ({
  page,
}) => {
  await openExample(page, 'getting-started')
  await openSheet(page, 'Figure 1', 'Layouts')
  const yB = yTitles(page).nth(1)
  await item(page, 1).click()
  await expect(heading(page)).toHaveText('Graph on page')
  // Dragged without being selected first: moved (decision 120), then selected.
  const b0 = await box(yB)
  await drag(page, await centre(yB), -10, 0, { modifiers: ['Alt'] })
  await expectUndo(page, 'Move axis title')
  expect((await box(yB)).x).toBeLessThan(b0.x - 4)
  await expect(heading(page)).toHaveText('Y axis title')
  await undo(page)

  // B's bars: a data set, then another with Shift; Delete hides both in their layer.
  const bars = pageSvg(page).locator('rect[data-id^="series/"][data-id$="/bar"]')
  const n = await bars.count()
  expect(n).toBeGreaterThan(2)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await item(page, 1).click()
  await clickCentre(page, bars.nth(0))
  await expect(hint(page)).toContainText('of “Dose response (bars)”')
  // The first bar's hover card (shown once the pointer rests) gone before the next click.
  await page.mouse.move(1, 1)
  await expect(page.getByTestId('hover-card')).toHaveCount(0)
  await clickCentre(page, bars.nth(n - 1), ['Shift'])
  await expect(heading(page)).toHaveText('2 elements of “Dose response (bars)”')
  await page.keyboard.press('Delete')
  await expect(bars).toHaveCount(n - 2)
  await expectUndo(page, 'Hide 2 data sets')
  // The graph stays on the page, selected.
  await expect(heading(page)).toHaveText('Graph on page')
  await undo(page)
  await expect(bars).toHaveCount(n)
})

test('several items: the fields they share above Arrange, mixed values blank; no page panel', async ({
  page,
}) => {
  await openExample(page, 'getting-started')
  await openSheet(page, 'Figure 1', 'Layouts')
  const n = await items(page).count()
  await menu(page, 'Edit', 'Select all')
  await expect(heading(page)).toHaveText(`${n} items`)
  // The page's own panel is a click away, not repeated; aligning is in the view toolbar only.
  await expect(inspector(page).getByRole('button', { name: '← Page' })).toBeVisible()
  await expect(inspector(page).getByText('Panel labels')).toHaveCount(0)
  await expect(inspector(page).getByRole('button', { name: /^Align / })).toHaveCount(0)
  const bar = page.getByRole('toolbar', { name: 'Arrange the selected graphs' })
  await expect(bar.getByRole('button', { name: 'Align ▾' })).toBeVisible()
  // The size on the page of every graph at once, one step.
  const size = inspector(page).getByLabel('Size on page (%)')
  const before = await Promise.all([0, 1, 2].map((i) => itemBox(item(page, i))))
  await size.fill('40')
  await size.press('Enter')
  await expectUndo(page, 'Resize graphs')
  const after = await Promise.all([0, 1, 2].map((i) => itemBox(item(page, i))))
  for (const [i, b] of after.entries()) expect(b.w).toBeLessThan(before[i]!.w)
  // One of them different: the field shows blank (mixed).
  await item(page, 0).click()
  await expect(heading(page)).toHaveText('Graph on page')
  const one = inspector(page).getByLabel('Size on page (%)')
  await one.fill('30')
  await one.press('Enter')
  await menu(page, 'Edit', 'Select all')
  await expect(heading(page)).toHaveText(`${n} items`)
  await expect(inspector(page).getByLabel('Size on page (%)')).toHaveValue('')
  // ← Page: the page's panel.
  await inspector(page).getByRole('button', { name: '← Page' }).click()
  await expect(heading(page)).toHaveText('Page')
  await expect(inspector(page).getByText('Panel labels')).toBeVisible()
})
