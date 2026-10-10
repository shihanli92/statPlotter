import { readFileSync } from 'node:fs'
import type { Locator, Page } from '@playwright/test'
import { expect, openExample, test } from './fixtures.ts'
import { pressShortcut } from './helpers-data.ts'
import {
  box,
  centre,
  clickOn,
  colourButton,
  colourPopover,
  dblclickOn,
  expectUndo,
  fontSize,
  formatPanel,
  inWindow,
  marks,
  menu,
  openGraph,
  openSheet,
  pickColour,
  preview,
  section,
  sectionToggle,
  undo,
  undoButton,
} from './helpers-graph.ts'

// Roadmap 46: the Format panel docked right of the canvas formats the real graph. It follows the
// selection; each change is one undo step, quick repeats of one field merged; Revert undoes what
// it did since the selection began; ⌘1 shows and hides it; "Open in window" is the dialog, its
// OK / Cancel as before; a drawer over the canvas in narrow windows; on a page, a part's panel
// edits that part's own graph.

const SCATTER = { example: 'getting-started', graph: 'Enzyme activity (scatter)' }

/**
 * How close in time two changes of one field must be to merge into one undo step (the engine's
 * `COALESCE_MS`, read from its source). Audit 3 (T2): the tests that depend on merging run on
 * Playwright's clock (installed before the app loads, as the store keeps its clock), moving it on
 * by this much where steps must stay apart, and holding it still where they must merge, so the
 * steps never depend on how fast the machine is.
 */
const COALESCE_MS = Number(
  readFileSync(new URL('../../../packages/engine/src/store.ts', import.meta.url), 'utf8').match(
    /export const COALESCE_MS = (\d+)/,
  )![1],
)

/** Ends the merging of steps: the next change is a step of its own. */
const stepApart = (page: Page) => page.clock.runFor(COALESCE_MS + 1)

/** Runs `edits` with the clock held still, so their steps merge as quick repeats do. */
async function atOnce(page: Page, edits: () => Promise<void>) {
  // A little ahead: the page's clock runs on while this is sent.
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 500)
  try {
    await edits()
  } finally {
    await page.clock.resume()
  }
}

const heading = (page: Page) => formatPanel(page).getByRole('heading', { level: 2 })
const selectedTab = (scope: Locator) => scope.getByRole('tab', { selected: true })
const openDialogs = (page: Page) => page.locator('dialog[open]')
const canvasArea = (page: Page) => page.getByRole('main').locator('.canvas')

/** Tick label texts of the Y axis, top to bottom as drawn. */
const yTicks = (scope: Locator) =>
  marks(scope, 'axis/y/tickLabel/').evaluateAll((els) =>
    els
      .map((e) => ({ text: e.textContent, y: e.getBoundingClientRect().y }))
      .sort((a, b) => a.y - b.y)
      .map((t) => t.text),
  )

test('the panel follows the selection and edits the graph itself; quick repeats of a field merge', async ({
  page,
}) => {
  await page.clock.install()
  const svg = await openGraph(page, SCATTER.example, SCATTER.graph)
  await clickOn(svg.locator('[data-id="title"]'))
  // ⌘1 shows it, the focus moving in (opened from the keyboard).
  await pressShortcut(page, 'Mod+1')
  const panel = formatPanel(page)
  await expect(panel).toBeVisible()
  await expect(panel).toHaveRole('complementary')
  await expect(heading(page)).toHaveText('Graph title')
  // Roadmap 46 (stage 2): the title's own place, no tabs; the focus on its first field.
  await expect(panel.getByRole('tab')).toHaveCount(0)
  await expect(section(panel, 'Common').getByLabel('Title font')).toBeFocused()

  // A click on the Y axis: the panel shows it, the focus staying on the canvas.
  await clickOn(svg.locator('[data-id="axis/y/line"]'))
  await expect(heading(page)).toHaveText('Y axis')
  await expect(selectedTab(panel)).toHaveText('Y axis')
  await expect(canvasArea(page)).toBeFocused()

  // A change shows on the canvas at once, no dialog; one undo step, announced with its Undo.
  const before = await yTicks(svg)
  await panel.getByLabel('Automatic range').uncheck()
  await expect.poll(() => yTicks(svg)).not.toEqual(before)
  await expect(openDialogs(page)).toHaveCount(0)
  await expectUndo(page, 'Axis range')
  await expect(page.locator('.toast.notice')).toHaveText(/^Axis range · Undo/)
  const manual = await yTicks(svg)
  expect(manual[0]).toBe('10')

  // The maximum typed key by key (6, then 60): each drawn, one undo step for both.
  const max = panel.getByLabel('Maximum')
  await atOnce(page, async () => {
    await max.fill('')
    await max.pressSequentially('60', { delay: 60 })
  })
  await expect.poll(async () => (await yTicks(svg))[0]).toBe('60')
  await max.blur()
  await undo(page)
  await expect.poll(() => yTicks(svg)).toEqual(manual)
  await expect(max).toHaveValue('10')
  // The next undo takes back the range itself (another field, its own step).
  await expectUndo(page, 'Axis range')
  await undo(page)
  await expect.poll(() => yTicks(svg)).toEqual(before)
  await expect(panel.getByLabel('Automatic range')).toBeChecked()
  await expect(undoButton(page)).toBeDisabled()
})

test('Revert undoes what the panel did to the selection; keys typed in it stay in it; ⌘1 toggles', async ({
  page,
}) => {
  const svg = await openGraph(page, SCATTER.example, SCATTER.graph)
  const before = await yTicks(svg)
  // A double-click shows the panel at the element, the focus left on the canvas.
  await dblclickOn(svg.locator('[data-id="axis/y/line"]'))
  const panel = formatPanel(page)
  await expect(heading(page)).toHaveText('Y axis')
  await expect(canvasArea(page)).toBeFocused()
  const revert = panel.getByRole('button', { name: 'Revert' })
  await expect(revert).toBeDisabled()

  // Two changes, two steps; Revert takes both back and says so.
  await panel.getByLabel('Reverse the axis').check()
  await expect.poll(() => yTicks(svg)).toEqual([...before].reverse())
  await panel.getByLabel('Automatic range').uncheck()
  await expect.poll(async () => (await yTicks(svg)).at(-1)).toBe('10')
  await expect(revert).toBeEnabled()
  await revert.click()
  await expect.poll(() => yTicks(svg)).toEqual(before)
  await expect(page.locator('.toast.notice')).toHaveText(/Reverted 2 changes to Y axis/)
  await expect(revert).toBeDisabled()
  await expect(undoButton(page)).toBeDisabled()

  // Another selection is another scope: a change made to the Y axis is not the X axis' to revert.
  await panel.getByLabel('Reverse the axis').check()
  await clickOn(svg.locator('[data-id="axis/x/line"]'))
  await expect(heading(page)).toHaveText('X axis')
  await expect(revert).toBeDisabled()
  await undo(page)
  await expect.poll(() => yTicks(svg)).toEqual(before)

  // Keys typed in the panel never reach the canvas: an arrow on a checkbox nudges nothing,
  // Delete deletes nothing.
  await clickOn(svg.locator('[data-id="title"]'))
  await expect(heading(page)).toHaveText('Graph title')
  const bold = section(panel, 'Common').getByLabel('Bold title')
  await bold.focus()
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('Delete')
  await expect(undoButton(page)).toBeDisabled()
  await expect(svg.locator('[data-id="title"]')).toBeVisible()
  // Escape gives the focus back to the canvas, whose keys work again.
  await page.keyboard.press('Escape')
  await expect(canvasArea(page)).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expectUndo(page, 'Nudge graph title')
  await undo(page)

  // ⌘1 hides it, and shows it again with the focus inside.
  await pressShortcut(page, 'Mod+1')
  await expect(panel).toHaveCount(0)
  await pressShortcut(page, 'Mod+1')
  await expect(heading(page)).toHaveText('Graph title')
  await expect(section(panel, 'Common').getByLabel('Title font')).toBeFocused()
  // And from inside, hides it again, the focus back on the canvas.
  await pressShortcut(page, 'Mod+1')
  await expect(panel).toHaveCount(0)
  await expect(canvasArea(page)).toBeFocused()
})

test('Open in window: the dialog at the panel’s place, its OK and Cancel as before', async ({
  page,
}) => {
  const svg = await openGraph(page, SCATTER.example, SCATTER.graph)
  const before = await yTicks(svg)
  await dblclickOn(svg.locator('[data-id="axis/y/line"]'))
  await expect(heading(page)).toHaveText('Y axis')
  // Cancel: the graph as it was, nothing to undo.
  let d = await inWindow(page, 'Format axes')
  await expect(selectedTab(d)).toHaveText('Y axis')
  await d.getByLabel('Reverse the axis').check()
  await expect.poll(() => yTicks(preview(page))).toEqual([...before].reverse())
  expect(await yTicks(svg)).toEqual(before)
  await d.getByRole('button', { name: 'Cancel' }).click()
  await expect(d).toBeHidden()
  await expect(undoButton(page)).toBeDisabled()
  // Format › Format in window… does the same; OK is one step, which the panel then shows.
  await menu(page, 'Format', 'Format in window…')
  d = openDialogs(page)
  await expect(selectedTab(d)).toHaveText('Y axis')
  await d.getByLabel('Reverse the axis').check()
  await d.getByRole('button', { name: 'OK' }).click()
  await expect(d).toBeHidden()
  await expect.poll(() => yTicks(svg)).toEqual([...before].reverse())
  await expectUndo(page, 'Format axes')
  await expect(formatPanel(page).getByLabel('Reverse the axis')).toBeChecked()
  // The dialog's step isn't the panel's to revert.
  await expect(formatPanel(page).getByRole('button', { name: 'Revert' })).toBeDisabled()
})

test('at 1024 px the panel is a drawer over the canvas; the graph keeps its size', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 })
  const svg = await openGraph(page, SCATTER.example, SCATTER.graph)
  const area = canvasArea(page)
  const [areaBefore, svgBefore] = [await box(area), await box(svg)]
  await dblclickOn(svg.locator('[data-id="axis/y/line"]'))
  const panel = formatPanel(page)
  await expect(heading(page)).toHaveText('Y axis')
  // Over the canvas, which keeps its width; the graph its size.
  expect(await panel.evaluate((e) => getComputedStyle(e).position)).toBe('absolute')
  const [p, a] = [await box(panel), await box(area)]
  expect(a.w).toBe(areaBefore.w)
  expect(p.x).toBeLessThan(a.x + a.w)
  expect((await box(svg)).w).toBeCloseTo(svgBefore.w, 1)
  // The graph scrolls out from under it: its right edge can reach the drawer's left.
  await area.evaluate((e) => {
    e.scrollLeft = e.scrollWidth
  })
  await expect.poll(async () => (await box(svg)).x + (await box(svg)).w).toBeLessThan(p.x)
  // Still usable: a click on the graph's title switches the drawer to it.
  await area.evaluate((e) => {
    e.scrollLeft = 0
  })
  await clickOn(svg.locator('[data-id="title"]'))
  await expect(heading(page)).toHaveText('Graph title')
  await panel.getByRole('button', { name: 'Close the Format panel' }).click()
  await expect(panel).toHaveCount(0)
  await expect(area).toBeFocused()
})

// Audit 3 (A14): the drawer opening over the selection (the legend, at the graph's right) scrolls
// the canvas so the selection is clear of it.
test('at 1024 px the drawer never covers the selection: the canvas scrolls it clear', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 })
  const svg = await openGraph(page, 'grouped', 'Genotype × treatment × tissue')
  const legend = svg.locator('[data-id^="legend/"]')
  const right = async () => {
    const boxes = await legend.evaluateAll((els) =>
      els.map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0),
    )
    return Math.max(...boxes.map((r) => r.right))
  }
  await canvasArea(page).focus()
  await menu(page, 'Format', 'Format legend…')
  await expect(heading(page)).toHaveText('Legend')
  const panel = await box(formatPanel(page))
  await expect.poll(right).toBeLessThanOrEqual(panel.x)
})

/** Controls of `scope` (shown ones) reaching past its left or right edge. */
async function overflowing(scope: Locator): Promise<string[]> {
  return scope.evaluate((root) => {
    const r = root.getBoundingClientRect()
    return [...root.querySelectorAll<HTMLElement>('input, select, button, textarea, [role="tab"]')]
      .filter((el) => el.offsetParent !== null)
      .filter((el) => {
        const b = el.getBoundingClientRect()
        return b.left < r.left - 0.5 || b.right > r.right + 0.5
      })
      .map((el) => el.getAttribute('aria-label') ?? el.textContent ?? el.tagName)
  })
}

test('at 1024 px nothing in the drawer is cut off; the page’s inspector folds to a strip; the dialog fits and keeps a size given it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 })
  const svg = await openGraph(page, SCATTER.example, SCATTER.graph)
  const panel = formatPanel(page)
  const options = panel.locator('.format-options')
  for (const el of [
    svg.locator('[data-id="axis/y/line"]'),
    svg.locator('[data-id^="series/"][data-id$="/point/0"]').first(),
    svg.locator('[data-id="title"]'),
  ]) {
    await dblclickOn(el)
    await expect(panel).toBeVisible()
    // The tabs wrap, the fields keep inside: nothing past the drawer's edges, no sideways scroll.
    expect(await overflowing(panel)).toEqual([])
    expect(await options.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true)
    expect((await box(panel)).x + (await box(panel)).w).toBeLessThanOrEqual(1024)
  }

  // "Open in window": the dialog fits the window; a size given it by its corner is kept.
  let d = await inWindow(page, 'Format title')
  const fits = async () => {
    const b = await box(d)
    expect(b.x).toBeGreaterThanOrEqual(0)
    expect(b.y).toBeGreaterThanOrEqual(0)
    expect(b.x + b.w).toBeLessThanOrEqual(1024)
    expect(b.y + b.h).toBeLessThanOrEqual(768)
  }
  await fits()
  await d.dispatchEvent('pointerdown')
  await d.evaluate((el) => {
    el.style.width = '700px'
    el.style.height = '500px'
    window.dispatchEvent(new PointerEvent('pointerup'))
  })
  await d.getByRole('button', { name: 'Cancel' }).click()
  d = await inWindow(page, 'Format title')
  expect(await box(d)).toMatchObject({ w: 700, h: 500 })
  await fits()
  await d.getByRole('button', { name: 'Cancel' }).click()
  await panel.getByRole('button', { name: 'Close the Format panel' }).click()

  // A layout page: its inspector a strip (its heading down it), the page given the room.
  await openSheet(page, 'Figure 1', 'Layouts')
  const pageSvg = page.getByRole('img', { name: 'Layout page' })
  await expect(pageSvg).toBeVisible()
  const dock = page.getByTestId('inspector-dock')
  await expect(dock.getByRole('heading', { name: 'Page' })).toBeVisible()
  expect((await box(dock)).w).toBeLessThan(50)
  const show = dock.getByRole('button', { name: 'Show the inspector' })
  await expect(show).toHaveAttribute('aria-expanded', 'false')
  const canvasWidth = (await box(canvasArea(page))).w
  // Shown: a drawer over the page, which keeps its width; its fields inside the window.
  await show.click()
  const hide = dock.getByRole('button', { name: 'Hide the inspector' })
  await expect(hide).toHaveAttribute('aria-expanded', 'true')
  await expect(dock.getByLabel('Orientation')).toBeVisible()
  expect((await box(canvasArea(page))).w).toBe(canvasWidth)
  const drawer = dock.locator('.inspector')
  expect(await overflowing(drawer)).toEqual([])
  expect((await box(drawer)).x + (await box(drawer)).w).toBeLessThanOrEqual(1024)
  await hide.click()
  await expect(dock.getByLabel('Orientation')).toBeHidden()
})

test('on a page, a part’s panel edits its own graph', async ({ page }) => {
  await openExample(page, 'getting-started')
  await openSheet(page, 'Figure 1', 'Layouts')
  const pageSvg = page.getByRole('img', { name: 'Layout page' })
  const titles = pageSvg.locator('[data-id="axis/y/title"]')
  const [yA, yB] = [titles.nth(0), titles.nth(1)]
  const at = async (l: Locator) => {
    const c = await centre(l)
    await page.mouse.click(c.x, c.y)
  }
  // The graph B, then its Y axis title; Enter shows the panel there, in the inspector's place.
  await at(yB)
  await at(yB)
  await expect(page.getByTestId('page-selection-announcement')).toHaveText(
    'Y axis title of “Dose response (bars)”',
  )
  await page.keyboard.press('Enter')
  const panel = formatPanel(page)
  // Roadmap 46 (stage 2): the axis' place, its Title section open.
  await expect(heading(page)).toHaveText('Y axis')
  await expect(panel).toContainText('Dose response (bars)')
  await expect(page.locator('.inspector:not(.format-options)')).toHaveCount(0)
  await expect(selectedTab(panel)).toHaveText('Y axis')
  await expect(selectedTab(panel)).toBeFocused()
  await expect(sectionToggle(panel, 'Title')).toHaveAttribute('aria-expanded', 'true')
  // Its size: graph B's title grows on the page, graph A's stays; one undo step.
  const [sizeA, sizeB] = [await fontSize(yA), await fontSize(yB)]
  const size = section(panel, 'Common').getByLabel('Title size (pt)')
  await size.fill(String(sizeB + 6))
  await expect.poll(() => fontSize(yB)).toBe(sizeB + 6)
  expect(await fontSize(yA)).toBe(sizeA)
  await size.blur()
  await expectUndo(page, 'Format axis title')
  await undo(page)
  await expect.poll(() => fontSize(yB)).toBe(sizeB)
  // Escape in the panel: the focus back on the page, whose Escape steps out to the graph item
  // (the panel formats the whole graph), then to nothing: the inspector is back.
  await selectedTab(panel).focus()
  await page.keyboard.press('Escape')
  await expect(canvasArea(page)).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(heading(page)).toHaveText('Graph')
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
  await expect(page.locator('.inspector .inspector-header h2').first()).toHaveText('Page')
})

test('a colour field is one button opening the colour popover: a data set’s colour, Automatic, keys, a custom colour remembered', async ({
  page,
}) => {
  await page.clock.install()
  const svg = await openGraph(page, SCATTER.example, SCATTER.graph)
  const point = svg.locator('[data-id^="series/"][data-id$="/point/0"]').first()
  const fill = () => point.getAttribute('fill')
  const automatic = await fill()
  await dblclickOn(point)
  const panel = formatPanel(page)
  await expect(heading(page)).toHaveText(/^Control$/)
  const button = colourButton(panel, 'Data set colour')
  // Unset: Automatic, in the colour the style gives it.
  await expect(button).toHaveAccessibleName('Data set colour Automatic')
  await expect(button).toHaveAttribute('aria-expanded', 'false')

  // A palette colour: drawn at once, one step; the button says which colour.
  await pickColour(panel, 'Data set colour', 'Palette colour 5')
  await expect.poll(fill).not.toBe(automatic)
  const fifth = (await fill())!
  await expectUndo(page, 'Colour')
  await expect(button).toHaveAccessibleName(`Data set colour ${fifth.toUpperCase()}`)

  // From the keyboard: the list has the focus on the current colour; → then Enter picks the next,
  // the focus back on the button.
  await button.click()
  const pop = colourPopover(page)
  await expect(pop).toHaveRole('dialog')
  const list = pop.getByRole('listbox')
  await expect(list).toBeFocused()
  await expect(pop.getByRole('option', { name: 'Palette colour 5' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await page.keyboard.press('ArrowRight')
  await expect(list).toHaveAttribute(
    'aria-activedescendant',
    (await pop.getByRole('option', { name: 'Palette colour 6' }).getAttribute('id'))!,
  )
  await page.keyboard.press('Enter')
  await expect(pop).toHaveCount(0)
  await expect(button).toBeFocused()
  await expect.poll(fill).not.toBe(fifth)
  // Escape closes, nothing chosen.
  const sixth = await fill()
  await page.keyboard.press('Enter')
  await expect(list).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Escape')
  await expect(pop).toHaveCount(0)
  await expect(button).toBeFocused()
  expect(await fill()).toBe(sixth)

  // Automatic: the style's colour again (the override removed), a step of its own.
  await stepApart(page)
  await pickColour(panel, 'Data set colour', 'Automatic')
  await expect.poll(fill).toBe(automatic)
  await expect(button).toHaveAccessibleName('Data set colour Automatic')

  // A custom colour typed as hex: drawn, and offered among the recent colours next time; a step
  // of its own, which Undo takes back to Automatic.
  await stepApart(page)
  await button.click()
  await pop.getByRole('textbox', { name: 'Hex colour' }).fill('#123456')
  await page.keyboard.press('Enter')
  await expect.poll(fill).toBe('#123456')
  await page.keyboard.press('Escape')
  await expect(pop).toHaveCount(0)
  await button.click()
  await expect(pop.getByRole('option', { name: 'Recent colour #123456' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await page.keyboard.press('Escape')
  await undo(page)
  await expect.poll(fill).toBe(automatic)
})

test('the field search: "thousands" → Enter selects the Y axis and focuses the field; a collapsed section opens', async ({
  page,
}) => {
  const svg = await openGraph(page, SCATTER.example, SCATTER.graph)
  await pressShortcut(page, 'Mod+1')
  const panel = formatPanel(page)
  await expect(heading(page)).toHaveText('Graph')
  const search = panel.getByRole('combobox', { name: 'Search the Format options' })
  await search.click()
  await search.fill('thousands')
  const results = panel.getByRole('listbox', { name: 'Matching options' })
  await expect(results.getByRole('option').first()).toHaveText(
    /^(X|Y) axis › Numbers › Thousands separators \(1,000\)$/,
  )
  const y = results.getByRole('option', {
    name: 'Y axis › Numbers › Thousands separators (1,000)',
  })
  await expect(y).toBeVisible()
  // ↓ to it (the first is active), Enter: the Y axis selected on the canvas, its field focused.
  while ((await y.getAttribute('aria-selected')) !== 'true') await search.press('ArrowDown')
  await expect(search).toHaveAttribute('aria-activedescendant', (await y.getAttribute('id'))!)
  await search.press('Enter')
  await expect(heading(page)).toHaveText('Y axis')
  await expect(page.locator('.selection-hint')).toContainText('Y axis selected')
  await expect(panel.getByLabel('Thousands separators (1,000)')).toBeFocused()
  await expect(panel.locator('.search-hit')).toHaveCount(1)
  await expect(search).toHaveValue('')
  await expect(svg).toBeVisible()

  // A field in a collapsed section: the section opens.
  const toggle = section(panel, 'Grid lines').getByRole('button', { name: 'Grid lines' })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await search.fill('major grid')
  await results.getByRole('option', { name: 'Y axis › Grid lines › Major grid lines' }).click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(panel.getByLabel('Major grid lines')).toBeFocused()

  // Other words, an empty result, Escape clears (and a second leaves the panel).
  for (const word of ['gap', 'italic', 'cap']) {
    await search.fill(word)
    await expect(results.getByRole('option').first()).toBeVisible()
  }
  await search.fill('zzzz')
  await expect(panel.getByRole('status')).toHaveText('No options match “zzzz”.')
  await expect(search).toHaveAttribute('aria-expanded', 'false')
  await search.press('Escape')
  await expect(search).toHaveValue('')
  await expect(search).toBeFocused()
  await search.press('Escape')
  await expect(canvasArea(page)).toBeFocused()
})
