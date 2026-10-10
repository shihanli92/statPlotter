import type { Locator, Page } from '@playwright/test'
import { expect, test } from './fixtures.ts'
import {
  box,
  centre,
  clickOn,
  drag,
  expand,
  expectUndo,
  fontSize,
  inWindow,
  menu,
  openGraph,
  pointOn,
  reachable,
  undo,
  undoButton,
} from './helpers-graph.ts'

// Canvas editing (roadmaps 22, 23): real pointer drags on the plot's resize handles and on the
// graph's elements, with snapping guides, nudges, Reset position and one undo step per edit.

test.use({ viewport: { width: 1400, height: 1000 } })

const SCATTER = { example: 'getting-started', graph: 'Enzyme activity (scatter)' }

type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'
const HANDLES: Handle[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']

/** Which sides a handle moves (1: right / bottom, −1: left / top). */
const sides = (h: Handle) => ({
  x: h.includes('e') ? 1 : h.includes('w') ? -1 : 0,
  y: h.includes('s') ? 1 : h.includes('n') ? -1 : 0,
})

/** The corner that stays put while `h` is dragged (the bottom and left along unmoved sides). */
function anchorOf(h: Handle): Handle {
  const s = sides(h)
  return `${s.y === 1 ? 'n' : 's'}${s.x === -1 ? 'e' : 'w'}` as Handle
}

const handle = (svg: Locator, h: Handle) => svg.locator(`rect.resize-handle[data-handle="${h}"]`)
const readout = (page: Page) => page.getByRole('main').locator('.drag-readout')
/** The whole graph's size in the view toolbar ("3.08 × 3.75 in"). */
const graphSize = async (page: Page) =>
  /(\d+\.\d+ × \d+\.\d+) in$/.exec((await page.locator('.selection-hint').textContent()) ?? '')?.[1]

const READOUT = /^Plot (\d+\.\d\d) × (\d+\.\d\d) in( \(.*\))? · text ([\d.]+)%( \(kept\))?$/

for (const h of HANDLES) {
  test(`dragging the ${h} handle resizes the plot, scales the text, keeps the ${anchorOf(h)} corner put`, async ({
    page,
  }) => {
    const svg = await openGraph(page, SCATTER.example, SCATTER.graph)
    const yTitle = svg.locator('[data-id="axis/y/title"]')
    const text0 = await fontSize(yTitle)
    const size0 = await graphSize(page)
    const anchor = handle(svg, anchorOf(h))
    const a0 = await centre(anchor)
    const start = await centre(handle(svg, h))
    const s = sides(h)
    // Outwards by 40 px (20 pt at 150%): the plot grows.
    await drag(page, start, s.x * 40, s.y * 40, {
      during: async () => {
        await expect(readout(page)).toHaveText(READOUT)
        const [, w, hh, , pct] = READOUT.exec((await readout(page).textContent())!)!
        // Sizes snap to 0.1 in; the text scale follows the area.
        expect(Math.round(Number(w) * 100) % 10).toBe(0)
        expect(Math.round(Number(hh) * 100) % 10).toBe(0)
        expect(Number(pct)).toBeGreaterThan(100)
        // The opposite corner stays put on screen, the dragged handle follows the pointer.
        const a1 = await centre(anchor)
        expect(Math.abs(a1.x - a0.x)).toBeLessThan(1.5)
        expect(Math.abs(a1.y - a0.y)).toBeLessThan(1.5)
        const moved = await centre(handle(svg, h))
        expect(Math.abs(moved.x - (start.x + s.x * 40))).toBeLessThan(10)
        expect(Math.abs(moved.y - (start.y + s.y * 40))).toBeLessThan(10)
        await expect(page.locator('.selection-hint')).toContainText('Shift keeps the proportions')
      },
    })
    await expect(readout(page)).toBeHidden()
    await expect.poll(() => fontSize(yTitle)).toBeGreaterThan(text0)
    expect(await graphSize(page)).not.toBe(size0)
    await expectUndo(page, 'Resize graph')
    await undo(page)
    await expect.poll(() => fontSize(yTitle)).toBe(text0)
    expect(await graphSize(page)).toBe(size0)
    await expect(undoButton(page)).toBeDisabled()
  })
}

test('the readout’s plot size is what the graph’s Size shows after the drag', async ({ page }) => {
  const svg = await openGraph(page, SCATTER.example, SCATTER.graph)
  let shown: RegExpExecArray | null = null
  await drag(page, await centre(handle(svg, 'se')), 60, 30, {
    during: async () => {
      await expect(readout(page)).toHaveText(READOUT)
      shown = READOUT.exec((await readout(page).textContent())!)
    },
  })
  const [, w, h, , pct] = shown!
  await menu(page, 'Format', 'Format graph…')
  const d = await inWindow(page, 'Format graph')
  await expand(d, 'Size of the plot area')
  await expect(d.getByLabel('Width (in)')).toHaveValue(String(Number(w)))
  await expect(d.getByLabel('Height (in)')).toHaveValue(String(Number(h)))
  // The readout rounds the scale to 0.1 %; the field shows it to 0.01 %.
  const scale = Number(await d.getByLabel('Scale text and marks (%)').inputValue())
  expect(Math.abs(scale - Number(pct))).toBeLessThanOrEqual(0.05)
  await d.getByRole('button', { name: 'Cancel' }).click()
})

test('⌘/Ctrl-drag resizes the plot but keeps the text size', async ({ page }) => {
  const svg = await openGraph(page, SCATTER.example, SCATTER.graph)
  const yTitle = svg.locator('[data-id="axis/y/title"]')
  const text0 = await fontSize(yTitle)
  const size0 = await graphSize(page)
  await drag(page, await centre(handle(svg, 'ne')), 50, -50, {
    modifiers: ['ControlOrMeta'],
    during: async () => {
      await expect(readout(page)).toHaveText(/ · text 100% \(kept\)$/)
    },
  })
  await expect(readout(page)).toBeHidden()
  await expect.poll(graphSize.bind(null, page)).not.toBe(size0)
  expect(await fontSize(yTitle)).toBe(text0)
  await expectUndo(page, 'Resize graph')
})

/** An element's box relative to the Y axis line (the scene may shift as the graph grows). */
async function relative(el: Locator, svg: Locator) {
  const a = await box(svg.locator('[data-id="axis/y/line"]'))
  const b = await box(el)
  return { x: b.x - a.x, y: b.y - a.y }
}

/** Presses on text (a glyph, see `pointOn`) and drags it by (dx, dy). */
async function dragText(
  page: Page,
  el: Locator,
  dx: number,
  dy: number,
  opts: Parameters<typeof drag>[4] = {},
) {
  await drag(page, await pointOn(el), dx, dy, opts)
}

const near = (a: number, b: number, tol = 9) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol)

test('dragging the graph title moves it, with snapping guides; Alt moves freely', async ({
  page,
}) => {
  const svg = await openGraph(page, SCATTER.example, SCATTER.graph)
  const title = svg.locator('[data-id="title"]')
  const r0 = await relative(title, svg)
  const guides = svg.locator('line.snap-guide')
  // Straight up: the title's centre stays on the plot's centre line, and a guide shows it.
  await dragText(page, title, 0, -30, {
    during: async () => {
      await expect(guides.first()).toBeAttached()
      await expect(page.locator('.selection-hint')).toContainText('Alt: no snapping')
    },
  })
  await expect(guides).toHaveCount(0)
  const r1 = await relative(title, svg)
  near(r1.y - r0.y, -30)
  near(r1.x - r0.x, 0, 1)
  await expectUndo(page, 'Move graph title')
  await undo(page)
  await expect.poll(async () => (await relative(title, svg)).y).toBeCloseTo(r0.y, 0)

  // With Alt, nothing snaps: no guides, and the title lands exactly where it was dropped.
  await dragText(page, title, 13, -21, {
    modifiers: ['Alt'],
    during: async () => {
      await expect(page.locator('.selection-hint')).toContainText('Moving')
      await expect(guides).toHaveCount(0)
    },
  })
  const r2 = await relative(title, svg)
  near(r2.x - r0.x, 13, 1.5)
  near(r2.y - r0.y, -21, 1.5)
})

test('dragging an axis title and tick labels moves them (one undo each)', async ({ page }) => {
  const svg = await openGraph(page, SCATTER.example, SCATTER.graph)
  const yTitle = svg.locator('[data-id="axis/y/title"]')
  const t0 = await relative(yTitle, svg)
  await dragText(page, yTitle, -24, 40)
  const t1 = await relative(yTitle, svg)
  near(t1.x - t0.x, -24)
  near(t1.y - t0.y, 40)
  await expectUndo(page, 'Move axis title')

  // Tick labels move across their axis only, all together.
  const labels = svg.locator('[data-id^="axis/y/tickLabel/"]')
  const first = labels.first()
  const l0 = await relative(first, svg)
  const last0 = await relative(labels.last(), svg)
  await dragText(page, await reachable(labels), -20, 15)
  const l1 = await relative(first, svg)
  near(l1.x - l0.x, -20)
  near(l1.y - l0.y, 0, 1)
  near((await relative(labels.last(), svg)).x - last0.x, -20)
  await expectUndo(page, 'Move tick labels')
  await undo(page)
  await expect.poll(async () => (await relative(first, svg)).x).toBeCloseTo(l0.x, 0)
  await expectUndo(page, 'Move axis title')
})

test('dragging the legend moves it', async ({ page }) => {
  const svg = await openGraph(page, 'formatting', 'Temperature and heart rate')
  const label = svg.locator('text[data-id^="legend/"][data-id$="/label"]').first()
  const r0 = await relative(label, svg)
  await dragText(page, label, -60, 36)
  // Roadmap 43: the drag is announced with its Undo; dragging it again replaces the notice.
  const notice = page.locator('.toast.notice')
  await expect(notice).toHaveText(/^Move legend · Undo/)
  const r1 = await relative(label, svg)
  near(r1.x - r0.x, -60)
  near(r1.y - r0.y, 36)
  await dragText(page, label, 40, 0)
  await expect(notice).toHaveCount(1)
  await notice.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(notice).toHaveCount(0)
  await expect.poll(async () => (await relative(label, svg)).x).toBeCloseTo(r1.x, 0)
  await expectUndo(page, 'Move legend')
})

test('arrow keys nudge the selected title; Reset position puts it back', async ({ page }) => {
  const svg = await openGraph(page, SCATTER.example, SCATTER.graph)
  const title = svg.locator('[data-id="title"]')
  const r0 = await relative(title, svg)
  await clickOn(title)
  await expect(page.locator('.selection-hint')).toContainText('drag or arrow keys to move')
  // 1 pt = 2 px at 150%; Shift: 10 pt.
  await page.keyboard.press('ArrowRight')
  await expect.poll(async () => (await relative(title, svg)).x - r0.x).toBeCloseTo(2, 0)
  await expectUndo(page, 'Nudge graph title')
  await page.keyboard.press('Shift+ArrowUp')
  await expect.poll(async () => (await relative(title, svg)).y - r0.y).toBeCloseTo(-20, 0)
  await menu(page, 'Format', 'Reset position')
  await expect.poll(async () => (await relative(title, svg)).y).toBeCloseTo(r0.y, 0)
  expect((await relative(title, svg)).x).toBeCloseTo(r0.x, 0)
  await expectUndo(page, 'Reset position')
  await undo(page)
  await expect.poll(async () => (await relative(title, svg)).y - r0.y).toBeCloseTo(-20, 0)
})

// Audit 3 (A3): arrow keys elsewhere — a navigator row, the toolbar, the view's Add ▾ — never move
// the selected element (the canvas handles its nudges itself, as a page does); a leaf row of the
// navigator keeps ← and → to itself.
test('arrow keys off the canvas never nudge the selected element', async ({ page }) => {
  const svg = await openGraph(page, SCATTER.example, SCATTER.graph)
  const title = svg.locator('[data-id="title"]')
  await clickOn(title)
  const r0 = await relative(title, svg)
  await expect(undoButton(page)).toBeDisabled()
  // What reaches the window after the row's own handler.
  await page.evaluate(() => {
    const w = window as unknown as { arrows: boolean[] }
    w.arrows = []
    window.addEventListener('keydown', (e) => {
      if (e.key.startsWith('Arrow')) w.arrows.push(e.defaultPrevented)
    })
  })
  const row = page
    .getByRole('navigation', { name: 'Project' })
    .locator('.nav-item')
    .filter({ hasText: SCATTER.graph })
    .first()
  const places = [
    row,
    page.getByRole('toolbar', { name: 'Toolbar' }).getByRole('button').first(),
    page.getByRole('main').getByRole('button', { name: 'Add ▾' }),
  ]
  for (const [i, el] of places.entries()) {
    await el.focus()
    // (Shift+↓ on a row selects the next sheet too.)
    const keys = ['ArrowRight', 'ArrowLeft', ...(i ? ['Shift+ArrowDown', 'ArrowUp'] : [])]
    for (const key of keys) await page.keyboard.press(key)
  }
  await expect(undoButton(page)).toBeDisabled()
  expect(await relative(title, svg)).toEqual(r0)
  // The leaf row's ← and → went no further.
  const seen = await page.evaluate(() => (window as unknown as { arrows: boolean[] }).arrows)
  expect(seen.slice(0, 2)).toEqual([true, true])
  // On the canvas they still nudge.
  await page.getByRole('main').locator('.canvas').focus()
  await page.keyboard.press('ArrowRight')
  await expectUndo(page, 'Nudge graph title')
})

test('dragging a point label moves it off its point, with a leader line', async ({ page }) => {
  const svg = await openGraph(page, 'grouped', 'Volcano plot')
  const label = await reachable(svg.locator('text[data-id^="pointLabel/"]'))
  const id = (await label.getAttribute('data-id'))!
  const same = svg.locator(`[data-id="${id}"]`)
  const r0 = await relative(same, svg)
  await dragText(page, same, 50, -40)
  const r1 = await relative(same, svg)
  near(r1.x - r0.x, 50)
  near(r1.y - r0.y, -40)
  await expect(svg.locator(`[data-id="${id}/leader"]`)).toBeAttached()
  await expectUndo(page, 'Move point label')
  // Its point is selected: Reset position clears the label's offset.
  await menu(page, 'Format', 'Reset position')
  await expect.poll(async () => (await relative(same, svg)).x).toBeCloseTo(r0.x, 0)
})
