import type { Locator, Page } from '@playwright/test'
import { expect, test } from './fixtures.ts'
import { columnTitles, pressShortcut } from './helpers-data.ts'
import {
  box,
  colourPopover,
  expectUndo,
  formatPanel,
  menu,
  openGraph,
  openSheet,
  panelHeading,
  pointOn,
  undo,
} from './helpers-graph.ts'

// Roadmap 47b: editing the legend. The first click on the legend selects it whole, a second click
// on an entry that entry (Escape steps back); a selected entry formats its data set, moves in the
// legend (drag, Alt+arrows) without changing the drawing order, hides with Delete, and takes a
// label on the legend alone (double-click its text); with the legend selected, the format bar's
// Layout group sets its columns and fill (4 entries in 2 columns: a 2 × 2 legend).

test.use({ viewport: { width: 1400, height: 1000 } })

const EXAMPLE = 'grouped'
/** Four entries: WT · Vehicle, WT · Drug, KO · Vehicle, KO · Drug. */
const FOUR = 'Genotype × treatment × tissue'
/** Two entries named by the table's data sets: Vehicle, Drug. */
const TWO = 'Genotype × treatment'

const bar = (page: Page) => page.getByTestId('format-bar')
const barButton = (page: Page, name: string) => bar(page).getByRole('button', { name, exact: true })
const announcement = (page: Page) => page.getByTestId('selection-announcement')
const labels = (svg: Locator) => svg.locator('text[data-id^="legend/"][data-id$="/label"]')
const label = (svg: Locator, text: string) => labels(svg).filter({ hasText: text })
/** The legend's labels, in the order drawn. */
const order = (svg: Locator) => labels(svg).allTextContents()
/** An entry's key, from its label's id (`legend/<key>/label`). */
const keyOf = async (l: Locator) => {
  const id = (await l.getAttribute('data-id'))!
  return id.slice('legend/'.length, -'/label'.length)
}

/** A click where the element can be reached, with modifiers held. */
async function clickAt(el: Locator, modifiers: string[] = []) {
  const page = el.page()
  const p = await pointOn(el)
  for (const m of modifiers) await page.keyboard.down(m)
  await page.mouse.click(p.x, p.y)
  for (const m of [...modifiers].reverse()) await page.keyboard.up(m)
}

/**
 * Selects one entry: a click on its sample selects the legend, a click on its label (elsewhere,
 * so not the second click of a double-click) the entry.
 */
async function selectEntry(svg: Locator, text: string) {
  const page = svg.page()
  const l = label(svg, text)
  const key = await keyOf(l)
  await clickAt(svg.locator(`[data-id^="legend/${key}/"]:not([data-id$="/label"])`).first())
  await expect(announcement(page)).toHaveText('Legend')
  await clickAt(l)
  await expect(announcement(page)).toHaveText(`Legend entry “${text}”`)
}

test('the legend first, then an entry; Escape steps back; Shift-click adds entries', async ({
  page,
}) => {
  const svg = await openGraph(page, EXAMPLE, FOUR)
  await selectEntry(svg, 'WT · Drug')
  await expect(bar(page).getByRole('button', { name: /^Selected: Legend entry/ })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(announcement(page)).toHaveText('Legend')
  await page.keyboard.press('Escape')
  await expect(announcement(page)).toHaveText('Graph')
  // Shift-click: entries together once the legend is entered.
  await selectEntry(svg, 'WT · Vehicle')
  await clickAt(label(svg, 'KO · Drug'), ['Shift'])
  await expect(announcement(page)).toHaveText('2 elements selected')
})

test('Alt+arrows move an entry in the legend, not the drawing order; one undo step', async ({
  page,
}) => {
  const svg = await openGraph(page, EXAMPLE, FOUR)
  const before = await order(svg)
  const marks = () =>
    svg.evaluate((el) =>
      [...el.querySelectorAll('[data-id^="series/"]')].map((e) => e.getAttribute('data-id')),
    )
  const drawn = await marks()
  await selectEntry(svg, 'WT · Vehicle')
  await page.keyboard.press('Alt+ArrowDown')
  await expect.poll(() => order(svg)).toEqual([before[1], before[0], before[2], before[3]])
  expect(await marks()).toEqual(drawn)
  await expectUndo(page, 'Move legend entry')
  // Still selected: again, then back up.
  await page.keyboard.press('Alt+ArrowDown')
  await expect.poll(() => order(svg)).toEqual([before[1], before[2], before[0], before[3]])
  await page.keyboard.press('Alt+ArrowUp')
  await expect.poll(() => order(svg)).toEqual([before[1], before[0], before[2], before[3]])
  await undo(page)
  await undo(page)
  await undo(page)
  await expect.poll(() => order(svg)).toEqual(before)
})

test('dragging a selected entry reorders it (a line shows where); undo puts it back', async ({
  page,
}) => {
  const svg = await openGraph(page, EXAMPLE, FOUR)
  const before = await order(svg)
  await selectEntry(svg, 'WT · Vehicle')
  const from = await pointOn(label(svg, 'WT · Vehicle'))
  const last = await box(label(svg, 'KO · Drug'))
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x, from.y + 10, { steps: 3 })
  await page.mouse.move(from.x, last.y + last.h - 1, { steps: 6 })
  // (A line has no area: attached, not "visible".)
  await expect(page.getByTestId('legend-insertion')).toHaveCount(1)
  await page.mouse.up()
  await expect.poll(() => order(svg)).toEqual([before[1], before[2], before[3], before[0]])
  await expect(page.getByTestId('legend-insertion')).toHaveCount(0)
  await expectUndo(page, 'Move legend entry')
  // The legend itself still drags as a whole when no entry is selected.
  await undo(page)
  await expect.poll(() => order(svg)).toEqual(before)
})

test('the format bar’s Layout: 2 columns filled down make a 2 × 2 legend', async ({ page }) => {
  const svg = await openGraph(page, EXAMPLE, FOUR)
  const names = await order(svg)
  await selectEntry(svg, names[0]!)
  await page.keyboard.press('Escape')
  await expect(announcement(page)).toHaveText('Legend')
  await expect(page.getByTestId('legend-columns')).toHaveText('1 col')
  await barButton(page, 'More legend columns').click()
  await expect(page.getByTestId('legend-columns')).toHaveText('2 col')
  await expectUndo(page, 'Legend columns 2')
  await barButton(page, 'Fill down columns').click()
  await expect(barButton(page, 'Fill down columns')).toHaveAttribute('aria-pressed', 'true')
  await expectUndo(page, 'Legend fill down columns')
  // Down the columns: 0 2 / 1 3.
  const at = async (i: number) => box(label(svg, names[i]!))
  const [a, b, c, d] = [await at(0), await at(1), await at(2), await at(3)]
  expect(Math.abs(a.x - b.x)).toBeLessThan(1)
  expect(Math.abs(c.x - d.x)).toBeLessThan(1)
  expect(c.x).toBeGreaterThan(a.x + 10)
  expect(Math.abs(a.y - c.y)).toBeLessThan(1)
  expect(Math.abs(b.y - d.y)).toBeLessThan(1)
  expect(b.y).toBeGreaterThan(a.y + 5)
  // Across the rows again: 0 1 / 2 3.
  await barButton(page, 'Fill down columns').click()
  await expect.poll(async () => Math.abs((await at(0)).y - (await at(1)).y)).toBeLessThan(1)
})

test('a legend-only label by double-click; the table’s name stays; Use data set name', async ({
  page,
}) => {
  const svg = await openGraph(page, EXAMPLE, TWO)
  await page.mouse.dblclick(
    ...(Object.values(await pointOn(label(svg, 'Drug'))) as [number, number]),
  )
  const inline = page.getByRole('textbox', { name: 'Edit text' })
  await expect(inline).toBeVisible()
  await page.keyboard.type('Drug (10 mg/kg)')
  await page.keyboard.press('Enter')
  await expect(label(svg, 'Drug (10 mg/kg)')).toHaveCount(1)
  await expectUndo(page, 'Legend label')
  // The data set keeps its name in the table.
  await openSheet(page, TWO, 'Data Tables')
  await expect(columnTitles(page).filter({ hasText: /^Drug$/ })).toHaveCount(1)
  await expect(columnTitles(page).filter({ hasText: '10 mg/kg' })).toHaveCount(0)
  await openSheet(page, TWO, 'Graphs')
  // Right-click › Use data set name.
  await clickAt(label(svg, 'Drug (10 mg/kg)'))
  const p = await pointOn(label(svg, 'Drug (10 mg/kg)'))
  await page.mouse.click(p.x, p.y, { button: 'right' })
  await page.getByRole('menuitem', { name: 'Use data set name' }).click()
  await expect(label(svg, 'Drug')).toHaveText('Drug')
  await expectUndo(page, 'Use data set name')
})

test('Delete hides a selected entry from the legend; undo shows it again', async ({ page }) => {
  const svg = await openGraph(page, EXAMPLE, FOUR)
  await selectEntry(svg, 'KO · Vehicle')
  await page.keyboard.press('Delete')
  await expect(label(svg, 'KO · Vehicle')).toHaveCount(0)
  await expect(labels(svg)).toHaveCount(3)
  await expectUndo(page, 'Hide legend entry')
  await undo(page)
  await expect(label(svg, 'KO · Vehicle')).toHaveCount(1)
})

test('a selected entry formats its data set: its colour from the format bar', async ({ page }) => {
  const svg = await openGraph(page, EXAMPLE, TWO)
  const key = await keyOf(label(svg, 'Drug'))
  const bars = svg.locator(`rect[data-id^="series/${key}/"]`)
  const before = await bars.first().getAttribute('fill')
  await selectEntry(svg, 'Drug')
  await barButton(page, 'Colour').click()
  await colourPopover(page).getByRole('option', { name: 'Palette colour 5', exact: true }).click()
  await expect(colourPopover(page)).toHaveCount(0)
  await expect.poll(() => bars.first().getAttribute('fill')).not.toBe(before)
  const swatch = svg.locator(`[data-id="legend/${key}/swatch"]`)
  await expect.poll(() => swatch.getAttribute('fill')).toBe(await bars.first().getAttribute('fill'))
  await expectUndo(page, 'Colour')
  // The Format panel shows its data set's place, headed by the entry's legend-only actions.
  await page.keyboard.press('Enter')
  await expect(formatPanel(page).getByText('Legend entry', { exact: true })).toBeVisible()
  await expect(formatPanel(page).getByRole('button', { name: 'Hide from legend' })).toBeVisible()
})

// Audit 3 (A1): the legend by keyboard alone — Tab reaches it (it has no box: none of its nodes
// targets the legend itself), ] and [ step through its entries, Alt+arrows move one, Delete hides
// it; ⌘A and the bar's list hold the legend; Format › Format legend… shows its place.
test('the legend and its entries by keyboard alone', async ({ page }) => {
  const svg = await openGraph(page, EXAMPLE, FOUR)
  const canvasArea = page.getByRole('main').locator('.canvas')
  await canvasArea.focus()
  const seen: string[] = []
  for (let i = 0; i < 40 && !seen.includes('Legend'); i++) {
    await page.keyboard.press('Tab')
    await expect(canvasArea).toBeFocused()
    seen.push((await announcement(page).textContent()) ?? '')
  }
  expect(seen).toContain('Legend')
  const all = await order(svg)
  const [first, second] = all
  await page.keyboard.press(']')
  await expect(announcement(page)).toHaveText(`Legend entry “${first}”`)
  await page.keyboard.press(']')
  await expect(announcement(page)).toHaveText(`Legend entry “${second}”`)
  await page.keyboard.press('[')
  await expect(announcement(page)).toHaveText(`Legend entry “${first}”`)
  // From the legend, [ goes to the last entry.
  await page.keyboard.press('Escape')
  await expect(announcement(page)).toHaveText('Legend')
  await page.keyboard.press('[')
  await expect(announcement(page)).toHaveText(`Legend entry “${all.at(-1)}”`)
  await page.keyboard.press('Escape')
  await page.keyboard.press(']')
  await page.keyboard.press('Alt+ArrowDown')
  await expect.poll(() => order(svg)).toEqual([second, first, ...all.slice(2)])
  await expectUndo(page, 'Move legend entry')
  await undo(page)
  await expect.poll(() => order(svg)).toEqual(all)
  await canvasArea.focus()
  await page.keyboard.press('Delete')
  await expect(labels(svg)).toHaveCount(all.length - 1)
  await expectUndo(page, 'Hide legend entry')
  await undo(page)
  await expect(labels(svg)).toHaveCount(all.length)

  // ⌘A takes the legend in; the bar's list of elements names it.
  await canvasArea.focus()
  await pressShortcut(page, 'Mod+A')
  await expect(announcement(page)).toHaveText(/elements selected/)
  await bar(page)
    .getByRole('button', { name: /^Selected:/ })
    .click()
  await expect(
    page.getByRole('menu', { name: 'Select' }).getByRole('menuitemradio', { name: 'Legend' }),
  ).toBeVisible()
  await page.keyboard.press('Escape')

  // Format › Format legend…: the legend selected, its place shown with the focus in it.
  await menu(page, 'Format', 'Format legend…')
  await expect(announcement(page)).toHaveText('Legend')
  await expect(panelHeading(page)).toHaveText('Legend')
  await expect
    .poll(() => page.evaluate(() => !!document.activeElement?.closest('.format-panel')))
    .toBe(true)
})
