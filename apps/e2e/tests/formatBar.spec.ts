import type { Locator, Page } from '@playwright/test'
import { expect, openExample, test } from './fixtures.ts'
import { pressShortcut, runMenu } from './helpers-data.ts'
import {
  box,
  canvas,
  centre,
  colourPopover,
  dblclickOn,
  expectUndo,
  fontSize,
  openGraph,
  openSheet,
  pointOn,
  undo,
  undoButton,
} from './helpers-graph.ts'

// Roadmap 45: the format bar under the graph and layout views' toolbars — formats for every
// selected element at once (one undo step each, quick repeats merged), mixed values, the
// selection switcher, run mode while text is edited in place, and the format painter.

test.use({ viewport: { width: 1400, height: 1000 } })

const bar = (page: Page) => page.getByTestId('format-bar')
const barButton = (page: Page, name: string | RegExp) =>
  bar(page).getByRole('button', { name, exact: typeof name === 'string' })
const sizeBox = (page: Page) => bar(page).getByRole('combobox', { name: 'Font size' })
const barMenu = (page: Page, name: string) => page.getByRole('menu', { name, exact: true })

/** A click where the element can be reached, with modifiers held. */
async function clickAt(el: Locator, modifiers: string[] = []) {
  const page = el.page()
  const p = await pointOn(el)
  for (const m of modifiers) await page.keyboard.down(m)
  await page.mouse.click(p.x, p.y)
  for (const m of [...modifiers].reverse()) await page.keyboard.up(m)
}

/** Every `<tspan>` font weight of a text element. */
const weights = (text: Locator) =>
  text.locator('tspan').evaluateAll((ts) => ts.map((t) => t.getAttribute('font-weight')))

/** The fill of a data set's first point. */
const fillOf = (svg: Locator, key: string) =>
  svg.locator(`[data-id="series/${key}/point/0"]`).getAttribute('fill')

/** Selects an element with the bar's ▾ (Excel's "Current selection"). */
async function pick(page: Page, name: string | RegExp) {
  await barButton(page, /^Selected: /).click()
  const m = barMenu(page, 'Select')
  await m
    .getByRole('menuitemradio', { name, exact: typeof name === 'string' })
    .first()
    .click()
  await expect(m).toBeHidden()
}

/** The bars of a bar graph (one per data set). */
const bars = (svg: Locator) => svg.locator('rect[data-id^="series/"][data-id$="/bar"]')

/** The data sets' keys of a graph, from their points. */
async function dataSets(svg: Locator): Promise<string[]> {
  const ids = await svg
    .locator('path[data-id^="series/"][data-id$="/point/0"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-id')!))
  return ids.map((id) => id.split('/')[1]!)
}

const EXAMPLE = 'curve-fitting'
const GRAPH = 'Dose-response'

test('three titles: one size for all from the bar, one undo step, no dialog; the bar keeps its height', async ({
  page,
}) => {
  const svg = await openGraph(page, EXAMPLE, GRAPH)
  const titles = ['title', 'axis/y/title', 'axis/x/title'].map((id) =>
    svg.locator(`[data-id="${id}"]`),
  )
  const before = await Promise.all(titles.map(fontSize))
  const height = (await box(bar(page))).h
  const top = (await box(svg)).y
  // Nothing selected: the graph's own text.
  await expect(barButton(page, /^Selected: Graph\./)).toBeVisible()
  await clickAt(titles[0]!)
  await clickAt(titles[1]!, ['Shift'])
  await clickAt(titles[2]!, ['Shift'])
  await expect(barButton(page, /^Selected: 3 elements\./)).toBeVisible()
  // Their sizes differ: blank; groups they lack greyed in place.
  await expect(sizeBox(page)).toHaveValue('')
  await expect(barButton(page, 'Symbol shape')).toBeDisabled()
  expect((await box(bar(page))).h).toBe(height)
  expect((await box(svg)).y).toBe(top)
  await sizeBox(page).fill('10')
  await sizeBox(page).press('Enter')
  for (const t of titles) await expect.poll(() => fontSize(t)).toBe(10)
  await expect(sizeBox(page)).toHaveValue('10')
  await expect(page.locator('dialog[open]')).toHaveCount(0)
  await expectUndo(page, 'Font size 10 pt (3 elements)')
  await undo(page)
  for (const [i, t] of titles.entries()) await expect.poll(() => fontSize(t)).toBe(before[i])
  // A data set selected: the bar's height and the graph's place are the same.
  await pick(page, /in “Points/)
  await expect(barButton(page, 'Symbol shape')).toBeEnabled()
  expect((await box(bar(page))).h).toBe(height)
  expect((await box(svg)).y).toBe(top)
})

test('bold on a tick-label group, a colour for two data sets, A↑ five times as one step', async ({
  page,
}) => {
  const svg = await openGraph(page, EXAMPLE, GRAPH)
  // The name's ▾ selects any element (Excel's "Current selection").
  await pick(page, 'Y axis tick labels')
  await expect(barButton(page, /^Selected: Y axis tick labels\./)).toBeVisible()
  const tick = svg.locator('[data-id^="axis/y/tickLabel/"]').first()
  expect(await weights(tick)).not.toContain('700')
  await barButton(page, 'Bold').click()
  await expect.poll(() => weights(tick)).toEqual(expect.arrayContaining(['700']))
  await expect(barButton(page, 'Bold')).toHaveAttribute('aria-pressed', 'true')
  await expectUndo(page, 'Bold')

  // A↑ five times quickly: one step, undone at once.
  const title = svg.locator('[data-id="title"]')
  const size = await fontSize(title)
  await clickAt(title)
  const steps = (await undoButton(page).getAttribute('aria-label')) ?? ''
  for (let i = 0; i < 5; i++) await barButton(page, 'Grow font').click()
  await expect.poll(() => fontSize(title)).toBeGreaterThan(size + 4)
  await expectUndo(page, 'Grow font')
  await undo(page)
  await expect.poll(() => fontSize(title)).toBe(size)
  // The step before (Bold) is next.
  await expect(undoButton(page)).toHaveAccessibleName(steps)
})

test('a colour for two data sets (Shift-click two bars)', async ({ page }) => {
  const svg = await openGraph(page, 'getting-started', 'Dose response (bars)')
  const [first, second] = [bars(svg).nth(0), bars(svg).nth(1)]
  await clickAt(first)
  // Its hover card (shown once the pointer rests) gone before the next click.
  await page.mouse.move(1, 1)
  await expect(page.getByTestId('hover-card')).toHaveCount(0)
  await clickAt(second, ['Shift'])
  await expect(barButton(page, /^Selected: 2 elements\./)).toBeVisible()
  // Their colours differ: a striped swatch.
  await expect(barButton(page, 'Colour').locator('.bar-swatch.mixed')).toHaveCount(1)
  const third = await bars(svg).nth(2).getAttribute('fill')
  await barButton(page, 'Colour').click()
  // Roadmap 46: the colour popover the Format panel's colour fields open too.
  await expect(colourPopover(page)).toHaveAccessibleName('Fill colours')
  await colourPopover(page).getByRole('option', { name: 'Palette colour 4', exact: true }).click()
  await expect(colourPopover(page)).toHaveCount(0)
  await expect.poll(() => first.getAttribute('fill')).toBe(await second.getAttribute('fill'))
  expect(await bars(svg).nth(2).getAttribute('fill')).toBe(third)
  await expect(barButton(page, 'Colour').locator('.bar-swatch.mixed')).toHaveCount(0)
  await expectUndo(page, 'Colour (2 elements)')
})

test('the format painter: the Y title’s format onto the X title; data sets keep their colour unless asked', async ({
  page,
}) => {
  const svg = await openGraph(page, EXAMPLE, GRAPH)
  const yTitle = svg.locator('[data-id="axis/y/title"]')
  const xTitle = svg.locator('[data-id="axis/x/title"]')
  await clickAt(yTitle)
  await sizeBox(page).fill('17')
  await sizeBox(page).press('Enter')
  await expect.poll(() => fontSize(yTitle)).toBe(17)
  await pressShortcut(page, 'Mod+Alt+C')
  await clickAt(xTitle)
  await pressShortcut(page, 'Mod+Alt+V')
  await expect.poll(() => fontSize(xTitle)).toBe(17)
  await expectUndo(page, 'Paste format')

  // A data set's symbols and colour; the paintbrush, then the other data set selected.
  const keys = await dataSets(svg)
  const width = (k: string) => box(svg.locator(`[data-id="series/${k}/point/0"]`)).then((b) => b.w)
  const before = await Promise.all(keys.map(width))
  await pick(page, /Agonist A.* in “Points/)
  await barButton(page, 'Symbol size').click()
  await barMenu(page, 'Symbol sizes').getByRole('menuitemradio', { name: '14 pt' }).click()
  // The source: the data set whose symbols grew.
  const grownNow = async () =>
    (await Promise.all(keys.map(width))).map((w, i) => w > before[i]! + 3)
  await expect.poll(async () => (await grownNow()).includes(true)).toBe(true)
  const grown = await grownNow()
  const a = keys[grown.indexOf(true)]!
  const b = keys[grown.indexOf(false)]!
  const colourB = await fillOf(svg, b)
  await barButton(page, 'Colour').click()
  // Roadmap 46: the colour popover the Format panel's colour fields open too.
  await expect(colourPopover(page)).toHaveAccessibleName('Fill colours')
  await colourPopover(page).getByRole('option', { name: 'Palette colour 5', exact: true }).click()
  await expect(colourPopover(page)).toHaveCount(0)
  await expect.poll(() => fillOf(svg, a)).not.toBe(colourB)
  const colourA = await fillOf(svg, a)
  await barButton(page, 'Format painter').click()
  await expect(barButton(page, 'Format painter (on)')).toHaveAttribute('aria-pressed', 'true')
  await pick(page, /Agonist B.* in “Points/)
  await expect.poll(async () => Math.round(await width(b))).toBe(Math.round(await width(a)))
  expect(await fillOf(svg, b)).toBe(colourB)
  // One-shot: the painter is off again.
  await expect(barButton(page, 'Format painter')).toHaveAttribute('aria-pressed', 'false')
  await expectUndo(page, 'Paste format')
  // With colour, from the Format menu.
  await runMenu(page, 'Format', 'Paste format with colour')
  await expect.poll(() => fillOf(svg, b)).toBe(colourA)
  await expectUndo(page, 'Paste format with colour')
})

test('editing text in place: the bar takes the editor’s toolbar; the whole text sets the title', async ({
  page,
}) => {
  const svg = await openGraph(page, EXAMPLE, GRAPH)
  const title = svg.locator('[data-id="title"]')
  const height = (await box(bar(page))).h
  await dblclickOn(title)
  const editor = page.getByRole('textbox', { name: 'Edit text' })
  await expect(editor).toBeFocused()
  // Run mode: the text editor's toolbar is docked in the bar, none floats over the canvas.
  const docked = bar(page).getByRole('toolbar', { name: 'Text format' })
  await expect(docked).toBeVisible()
  await expect(page.getByRole('toolbar', { name: 'Text format' })).toHaveCount(1)
  await expect(bar(page)).toContainText('Editing graph title')
  expect((await box(bar(page))).h).toBe(height)
  // The whole text selected (as it opens): the size goes to the title's style.
  const size = docked.getByRole('combobox', { name: 'Font size' })
  await size.fill('19')
  await size.press('Enter')
  await expect(editor).toBeFocused()
  await expect.poll(() => fontSize(title)).toBe(19)
  await expect(undoButton(page)).toHaveAccessibleName('Undo Font size 19 pt')
  await editor.press('Enter')
  await expect(editor).toBeHidden()
  // Back to the bar's own groups; the title is the selection.
  await expect(docked).toBeHidden()
  await expect(barButton(page, 'Bold')).toBeVisible()
  // The step was the style's alone: no text edit after it.
  await expectUndo(page, 'Font size 19 pt')
})

test('on a page: 9 pt for two graphs’ Y titles at once', async ({ page }) => {
  await openExample(page, 'getting-started')
  await openSheet(page, 'Figure 1', 'Layouts')
  const pageSvg = page.getByRole('img', { name: 'Layout page' })
  const yTitles = pageSvg.locator('[data-id="axis/y/title"]')
  const [yB, yC] = [yTitles.nth(1), yTitles.nth(2)]
  const click = async (l: Locator, mods: string[] = []) => {
    const c = await centre(l)
    for (const m of mods) await page.keyboard.down(m)
    await page.mouse.click(c.x, c.y)
    for (const m of [...mods].reverse()) await page.keyboard.up(m)
  }
  await click(yB)
  await click(yB)
  await click(yC, ['Shift'])
  await expect(barButton(page, /^Selected: 2 elements in 2 graphs\./)).toBeVisible()
  await sizeBox(page).fill('9')
  await sizeBox(page).press('Enter')
  await expect.poll(() => fontSize(yB)).toBe(9)
  await expect.poll(() => fontSize(yC)).toBe(9)
  await expectUndo(page, 'Font size 9 pt (2 elements)')
  // Each graph's own document changed.
  await openSheet(page, 'Dose response (bars)', 'Graphs')
  await expect.poll(() => fontSize(canvas(page).locator('[data-id="axis/y/title"]'))).toBe(9)
})
