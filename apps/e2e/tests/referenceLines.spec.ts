import type { Locator, Page } from '@playwright/test'
import { expect, test } from './fixtures.ts'
import { menuItem, newTable, openMenu, runMenu, typeCells } from './helpers-data.ts'
import {
  clickOn,
  dialog,
  expand,
  expectUndo,
  formatPanel,
  marks,
  newGraph,
  openGraph,
  panelHeading,
  undo,
} from './helpers-graph.ts'

// Reference lines (roadmap 46b). The identity line: Insert › Identity line (y = x) adds y = x
// across an XY graph and shows its Format panel; its slope and intercept move it (one undo step
// each); the format bar's Line group formats it; Delete removes it; the Add ▾ menu offers it;
// graphs without two continuous axes don't. Lines at ± a value (one layer, one value to edit) and
// a volcano plot's thresholds — the lines at ± the fold change's cut-off and at the P value's, and
// the Significance layer colouring the points up, down or not significant with their counts in
// the legend; the cut-offs shared, so one edit moves the lines and re-colours the points in one
// step.

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

/** A scatter of paired measurements from 1 to 8 (y = x crosses the whole plot). */
async function pairedGraph(page: Page): Promise<Locator> {
  await newTable(page, { kind: 'XY', name: 'Methods', dataSets: 1, replicates: 1 })
  await typeCells(page, 0, 0, [
    ['1', '1.3'],
    ['2', '1.8'],
    ['4', '4.6'],
    ['6', '5.5'],
    ['8', '8.2'],
  ])
  return newGraph(page, null, 'Methods graph')
}

/** A polyline's points as numbers. */
const pointsOf = async (line: Locator): Promise<number[][]> =>
  ((await line.getAttribute('points')) ?? '')
    .trim()
    .split(/\s+/)
    .map((p) => p.split(',').map(Number))

test.describe('identity line', () => {
  test('inserted from the menu, its slope and intercept edited in the panel, each one undo step', async ({
    page,
  }) => {
    const svg = await pairedGraph(page)
    const line = svg.locator('[data-id="result/identity/all/line"]')
    await expect(line).toHaveCount(0)
    await runMenu(page, 'Insert', 'Identity line (y = x)')
    await expect(line).toHaveCount(1)
    // Dashed grey, and its Format panel open at it.
    await expect(line).toHaveAttribute('stroke', '#808080')
    await expect(line).toHaveAttribute('stroke-dasharray', /\d/)
    const panel = formatPanel(page)
    await expect(panel).toBeVisible()
    await expect(panelHeading(page)).toHaveText('Identity line (y = x)')
    await expectUndo(page, 'Add identity line')
    const first = await pointsOf(line)
    // Straight (both axes linear), rising to the right (up the page).
    expect(first).toHaveLength(2)
    expect(first[1]![0]!).toBeGreaterThan(first[0]![0]!)
    expect(first[1]![1]!).toBeLessThan(first[0]![1]!)

    const options = await expand(panel, 'Line')
    const slope = options.getByRole('spinbutton', { name: 'Slope' })
    await slope.fill('0.5')
    await expect.poll(() => pointsOf(line)).not.toEqual(first)
    await expect(panelHeading(page)).toHaveText('Reference line (y = 0.5x)')
    await slope.blur()
    await expectUndo(page, 'Line slope')
    const halved = await pointsOf(line)
    // Shallower: it rises less across the plot.
    expect(halved[0]![1]! - halved.at(-1)![1]!).toBeLessThan(first[0]![1]! - first.at(-1)![1]!)

    const intercept = options.getByRole('spinbutton', { name: 'Intercept' })
    await intercept.fill('2')
    await expect.poll(() => pointsOf(line)).not.toEqual(halved)
    await intercept.blur()
    await expectUndo(page, 'Line intercept')
    await undo(page)
    await expect.poll(() => pointsOf(line)).toEqual(halved)
    await expect(intercept).toHaveValue('0')
    await undo(page)
    await expect.poll(() => pointsOf(line)).toEqual(first)
    await expect(slope).toHaveValue('1')
    await undo(page)
    await expect(line).toHaveCount(0)
  })

  test('its label, the format bar’s Line group, and Delete', async ({ page }) => {
    const svg = await pairedGraph(page)
    const line = svg.locator('[data-id="result/identity/all/line"]')
    // From the graph's Add ▾ menu.
    await page.getByRole('main').getByRole('button', { name: 'Add ▾' }).click()
    await page
      .getByRole('menu', { name: 'Add to graph' })
      .getByRole('menuitem', { name: 'Identity line (y = x)' })
      .click()
    await expect(line).toHaveCount(1)

    // Its label, the equation, at its end.
    const panel = formatPanel(page)
    const label = await expand(panel, 'Label')
    await label.getByLabel('Where').selectOption('end')
    await expect(svg.locator('[data-id="result/identity/all/lineLabel"]')).toHaveText('y = x')
    await expectUndo(page, 'Line label place')

    // Selected on the canvas: the format bar's line width applies to it.
    await clickOn(line)
    await expect(panelHeading(page)).toHaveText('Identity line (y = x)')
    // Beside the docked panel the Line group may be folded into More ▾ (roadmap 47).
    const bar = page.getByTestId('format-bar')
    const more = bar.getByRole('button', { name: 'More format options', exact: true })
    const inBar = bar.getByRole('button', { name: 'Line width', exact: true })
    // Folded or not, the bar has settled once Format… (the first to fold) or More shows.
    await expect(
      bar.getByRole('button', { name: 'Format…', exact: true }).or(more).first(),
    ).toBeVisible()
    if (await inBar.count()) await inBar.click()
    else {
      await more.click()
      await page
        .getByRole('toolbar', { name: 'More format options' })
        .getByRole('button', { name: 'Line width', exact: true })
        .click()
    }
    await page
      .getByRole('menu', { name: 'Line widths', exact: true })
      .getByRole('menuitemradio', { name: '2 pt' })
      .click()
    await expect(line).toHaveAttribute('stroke-width', '2')
    await expectUndo(page, 'Line width 2 pt')

    // Delete removes it (one step), Undo brings it back.
    await clickOn(line)
    await page.keyboard.press('Delete')
    await expect(line).toHaveCount(0)
    await expectUndo(page, 'Delete line')
    await undo(page)
    await expect(line).toHaveCount(1)
    await expect(line).toHaveAttribute('stroke-width', '2')
  })

  test('is offered only on graphs with two continuous axes', async ({ page }) => {
    await newTable(page, { kind: 'Column', name: 'Groups', sample: true })
    await newGraph(page, null, 'Groups graph')
    const insert = await openMenu(page, 'Insert')
    await expect(menuItem(insert, 'Identity line (y = x)')).toBeDisabled()
    await page.keyboard.press('Escape')
  })
})

/** A line's x (a vertical line's) in the canvas. */
const xOf = async (line: Locator) => Number(await line.getAttribute('x1'))

test.describe('cut-offs', () => {
  test('a line at a value made ±: two lines, one value', async ({ page }) => {
    await newTable(page, { kind: 'XY', name: 'Levels', sample: true })
    const svg = await newGraph(page, null, 'Levels graph')
    await runMenu(page, 'Insert', 'Line at a value…')
    const panel = formatPanel(page)
    const line = await expand(panel, 'Line')
    await line.getByRole('checkbox', { name: '± (lines at −c and +c)' }).check()
    const lines = svg.locator('line[data-id^="result/"][data-id$="/line"]')
    await expect(lines).toHaveCount(2)
    await expect(svg.locator('line[data-id$="/mirror/line"]')).toHaveCount(1)
    await expectUndo(page, 'Line at ±')
    // One value moves both.
    const [a, b] = [lines.nth(0), lines.nth(1)]
    const before = [await a.getAttribute('y1'), await b.getAttribute('y1')]
    await line.getByRole('spinbutton', { name: 'At ± (c)' }).fill('3')
    await expect(a).not.toHaveAttribute('y1', before[0]!)
    await expect(b).not.toHaveAttribute('y1', before[1]!)
    await expectUndo(page, 'Line value')
    await undo(page)
    await expect(a).toHaveAttribute('y1', before[0]!)
    await undo(page)
    await expect(lines).toHaveCount(1)
  })
})

test.describe('volcano', () => {
  test('Volcano thresholds on the volcano plot: lines, the classes counted, one shared cut-off', async ({
    page,
  }) => {
    const svg = await openGraph(page, 'grouped', 'Volcano plot')
    const points = marks(svg, 'curve/')
    const greyBefore = await points.first().getAttribute('fill')
    await runMenu(page, 'Insert', 'Volcano thresholds…')
    const d = dialog(page, 'Volcano thresholds')
    await expect(d).toBeVisible()
    await expect(d.getByRole('spinbutton', { name: 'log2 fold change cut-off (±)' })).toHaveValue(
      '1',
    )
    await expect(d.getByRole('spinbutton', { name: 'P cut-off' })).toHaveValue('0.05')
    await expect(d).toContainText('−log10 P = 1.301')
    await d.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(d).toBeHidden()

    // The lines at ±1 and at −log10 0.05, and the classes' counts in the legend.
    const plus = svg.locator('[data-id="result/foldCut/all/line"]')
    const minus = svg.locator('[data-id="result/foldCut/all/mirror/line"]')
    await expect(plus).toHaveCount(1)
    await expect(minus).toHaveCount(1)
    await expect(svg.locator('[data-id="result/pCut/all/line"]')).toHaveCount(1)
    const label = (k: string) => svg.locator(`[data-id="legend/threshold/sig/${k}/label"]`)
    await expect(label('up')).toHaveText(/^Up \(\d+\)$/)
    await expect(label('down')).toHaveText(/^Down \(\d+\)$/)
    await expect(label('ns')).toHaveText(/^NS \(\d+\)$/)
    const counts = async () =>
      Promise.all(['up', 'down', 'ns'].map(async (k) => (await label(k).textContent()) ?? ''))
    const total = (cs: string[]) => cs.reduce((n, c) => n + Number(/\((\d+)\)/.exec(c)![1]), 0)
    const at1 = await counts()
    expect(total(at1)).toBe(30)
    expect(Number(/\((\d+)\)/.exec(at1[0]!)![1])).toBeGreaterThan(0)
    // The points beneath turned grey; the significant ones in the classes' colours.
    await expect(marks(svg, 'curve/').first()).not.toHaveAttribute('fill', greyBefore ?? '')
    await expectUndo(page, 'Volcano thresholds')

    // The Format panel shows the Significance layer: one cut-off moves the lines and re-counts.
    const panel = formatPanel(page)
    const cuts = await expand(panel, 'Common')
    await expect(cuts).toContainText('Points exactly at a cut-off count as significant')
    const x1 = await xOf(plus)
    const x1m = await xOf(minus)
    await cuts.getByRole('spinbutton', { name: 'Fold change cut-off (±)' }).fill('1.5')
    await expect(plus).not.toHaveAttribute('x1', String(x1))
    await expect(minus).not.toHaveAttribute('x1', String(x1m))
    expect(await xOf(plus)).toBeGreaterThan(x1)
    expect(await xOf(minus)).toBeLessThan(x1m)
    await expect.poll(counts).not.toEqual(at1)
    expect(total(await counts())).toBe(30)
    await expectUndo(page, 'Fold change cut-off')

    // Undo restores the cut-off (lines and counts) in one step, then removes the thresholds.
    await undo(page)
    await expect(plus).toHaveAttribute('x1', String(x1))
    await expect.poll(counts).toEqual(at1)
    await undo(page)
    await expect(plus).toHaveCount(0)
    await expect(label('up')).toHaveCount(0)
    await expect(marks(svg, 'curve/').first()).toHaveAttribute('fill', greyBefore ?? '')
  })
})
