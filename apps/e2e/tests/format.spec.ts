import type { Locator, Page } from '@playwright/test'
import { expect, openExample, test } from './fixtures.ts'
import {
  canvas,
  clickOn,
  dblclickOn,
  expand,
  expectUndo,
  inWindow,
  layerList,
  marks,
  newGraph,
  openGraph,
  openSheet,
  pointLabels,
  pointMarks,
  preview,
  reachable,
  section,
  sectionToggle,
  selectLayer,
  seriesPicker,
  undo,
  undoButton,
} from './helpers-graph.ts'

// Format dialogs (roadmap 24): a double-click on each element opens its place, changes show in
// the live preview, OK is one undo step and Cancel leaves the graph as it was; single points,
// brackets and point labels. Roadmap 46: the double-click (Enter, a menu) shows the Format panel
// at that place; its Open in window (`inWindow`) is the dialog tested here. Stage 2: the places
// are elements (the axes' tabs switch between the axes), each opening on its Common settings.

const SCATTER = { example: 'getting-started', graph: 'Enzyme activity (scatter)' }

/** The selected tab of a dialog. */
const selectedTab = (d: Locator) => d.getByRole('tab', { selected: true })

/** Every point mark's `d` attribute, in document order. */
const shapes = (scope: Locator) =>
  pointMarks(scope).evaluateAll((els) => els.map((e) => e.getAttribute('d')))

/** Tick label texts of a vertical axis, top to bottom as drawn. */
const ticks = (scope: Locator, axis: string) =>
  marks(scope, `axis/${axis}/tickLabel/`).evaluateAll((els) =>
    els
      .map((e) => ({ text: e.textContent, y: Number(e.querySelector('tspan')?.getAttribute('y')) }))
      .sort((a, b) => a.y - b.y)
      .map((t) => t.text),
  )

async function ok(d: Locator) {
  await d.getByRole('button', { name: 'OK' }).click()
  await expect(d).toBeHidden()
}

async function cancel(d: Locator) {
  await d.getByRole('button', { name: 'Cancel' }).click()
  await expect(d).toBeHidden()
}

test('double-clicking the Y axis opens Format axes › Y axis; OK is one undo step', async ({
  page,
}) => {
  const svg = await openGraph(page, SCATTER.example, SCATTER.graph)
  await expect(undoButton(page)).toBeDisabled()
  const before = await ticks(svg, 'y')
  await dblclickOn(svg.locator('[data-id="axis/y/line"]'))
  const d = await inWindow(page, 'Format axes')
  await expect(d).toBeVisible()
  await expect(selectedTab(d)).toHaveText('Y axis')
  // In its Common settings, with the range and scale.
  await section(d, 'Common').getByLabel('Reverse the axis').check()
  // Live preview: the reversed axis lists its ticks top-down the other way; the canvas waits.
  await expect.poll(() => ticks(preview(page), 'y')).toEqual([...before].reverse())
  expect(await ticks(svg, 'y')).toEqual(before)
  await ok(d)
  await expect.poll(() => ticks(svg, 'y')).toEqual([...before].reverse())
  await expectUndo(page, 'Format axes')
  await undo(page)
  await expect.poll(() => ticks(svg, 'y')).toEqual(before)
  await expect(undoButton(page)).toBeDisabled()
})

// Roadmap 43 (UX review F17): OK says what it did, with an Undo of just that step.
test('OK announces the step with an Undo that puts the graph back', async ({ page }) => {
  const svg = await openGraph(page, SCATTER.example, SCATTER.graph)
  const before = await ticks(svg, 'y')
  await dblclickOn(svg.locator('[data-id="axis/y/line"]'))
  const d = await inWindow(page, 'Format axes')
  await d.getByLabel('Reverse the axis').check()
  await ok(d)
  const notice = page.locator('.toast.notice')
  await expect(notice).toHaveText(/^Format axes · Undo/)
  // A real button in the status region, reachable by keyboard.
  await notice.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(notice).toHaveCount(0)
  await expect.poll(() => ticks(svg, 'y')).toEqual(before)
  await expect(undoButton(page)).toBeDisabled()

  // It goes after a few seconds by itself; and Cancel announces nothing.
  await dblclickOn(svg.locator('[data-id="axis/y/line"]'))
  await inWindow(page, 'Format axes')
  await d.getByLabel('Reverse the axis').check()
  await ok(d)
  await expect(notice).toHaveText(/^Format axes · Undo/)
  await page.mouse.move(0, 0)
  await expect(notice).toHaveCount(0, { timeout: 10_000 })
  await expect(undoButton(page)).toBeEnabled()
  await dblclickOn(svg.locator('[data-id="axis/y/line"]'))
  await inWindow(page, 'Format axes')
  await cancel(d)
  await expect(notice).toHaveCount(0)
})

test('double-clicking the X axis opens Format axes › X axis; Cancel reverts', async ({ page }) => {
  const svg = await openGraph(page, SCATTER.example, SCATTER.graph)
  await dblclickOn(svg.locator('[data-id="axis/x/line"]'))
  const d = await inWindow(page, 'Format axes')
  await expect(selectedTab(d)).toHaveText('X axis')
  // Other tabs by the keyboard, as a tab list.
  await selectedTab(d).press('ArrowRight')
  await expect(selectedTab(d)).toHaveText('Y axis')
  const before = await ticks(svg, 'y')
  await d.getByLabel('Reverse the axis').check()
  await expect.poll(() => ticks(preview(page), 'y')).toEqual([...before].reverse())
  await cancel(d)
  expect(await ticks(svg, 'y')).toEqual(before)
  await expect(undoButton(page)).toBeDisabled()
  // Escape cancels too.
  await dblclickOn(svg.locator('[data-id="axis/x/line"]'))
  await inWindow(page, 'Format axes')
  await expect(selectedTab(d)).toHaveText('X axis')
  await d.getByRole('tab', { name: 'Y axis', exact: true }).click()
  await d.getByLabel('Reverse the axis').check()
  await expect.poll(() => ticks(preview(page), 'y')).toEqual([...before].reverse())
  await page.keyboard.press('Escape')
  await expect(d).toBeHidden()
  await expect(undoButton(page)).toBeDisabled()
})

test('a click on empty space in the preview deselects, as on the canvas: the graph', async ({
  page,
}) => {
  const svg = await openGraph(page, SCATTER.example, SCATTER.graph)
  const point = await reachable(svg.locator('path[data-id*="/point/"]'))
  await point.dblclick()
  const d = await inWindow(page, 'Format graph')
  await expect(seriesPicker(d)).toHaveValue(/^dataSet:/)
  const pv = preview(page)
  const halos = pv.locator('g.selection > *')
  await expect.poll(() => halos.count()).toBeGreaterThan(0)
  // The preview's corner is empty space (no mark there).
  await pv.click({ position: { x: 3, y: 3 } })
  await expect(halos).toHaveCount(0)
  // The graph's place: its layers listed, none chosen; no data set picker.
  await expect(layerList(d).getByRole('option')).toHaveCount(3)
  await expect(layerList(d).getByRole('option', { selected: true })).toHaveCount(0)
  await expect(seriesPicker(d)).toHaveCount(0)
  await cancel(d)
})

test('double-clicking a data set formats that data set', async ({ page }) => {
  const svg = await openGraph(page, SCATTER.example, SCATTER.graph)
  const series = (await svg
    .locator('[data-id$="/center"]')
    .evaluateAll((els) =>
      els.map((e) => e.getAttribute('data-id')!.replace(/\/center$/, '')),
    )) as string[]
  expect(series).toHaveLength(2)
  const [first, second] = series as [string, string]
  const point = await reachable(svg.locator(`path[data-id^="${first}/point/"]`))
  const before = await shapes(svg)
  await point.dblclick()
  const d = await inWindow(page, 'Format graph')
  // That data set, opening on its Common settings (its colour, its error bars), its Symbols open:
  // the part double-clicked (decision 243). No layers, no drawing order (V1).
  await expect(seriesPicker(d)).toHaveValue(`dataSet:${first.slice('series/'.length)}`)
  await expect(section(d, 'Common').getByLabel('Data set colour')).toBeVisible()
  await expect(section(d, 'Common').getByLabel('Error bars')).toBeVisible()
  await expect(sectionToggle(d, 'Symbols')).toHaveAttribute('aria-expanded', 'true')
  await expect(sectionToggle(d, 'Error bars')).toHaveAttribute('aria-expanded', 'false')
  await expect(layerList(d)).toHaveCount(0)
  await expect(d.getByLabel('Drawing order')).toHaveCount(0)
  await expect(d.getByText('This point only')).toHaveCount(0)
  const symbols = section(d, 'Symbols')
  await symbols.getByLabel('Shape').selectOption('diamond')
  // Only the chosen data set's points change in the preview.
  const pv = preview(page)
  await expect
    .poll(async () => {
      const changed = await pv
        .locator(`path[data-id^="${first}/point/"]`)
        .evaluateAll((els) => els.map((e) => e.getAttribute('d')))
      return changed.some((x) => !before.includes(x))
    })
    .toBe(true)
  const others = await pv
    .locator(`path[data-id^="${second}/point/"]`)
    .evaluateAll((els) => els.map((e) => e.getAttribute('d')))
  expect(others.every((x) => before.includes(x))).toBe(true)
  expect(await shapes(svg)).toEqual(before)
  await ok(d)
  await expect.poll(() => shapes(svg)).not.toEqual(before)
  await expectUndo(page, 'Format graph')
  await undo(page)
  await expect.poll(() => shapes(svg)).toEqual(before)
})

test('a single point: select it with a second click, Enter formats just that point', async ({
  page,
}) => {
  const svg = await openGraph(page, SCATTER.example, SCATTER.graph)
  const point = await reachable(pointMarks(svg))
  const id = (await point.getAttribute('data-id'))!
  const before = await shapes(svg)
  // First click: the data set; second: the point; then Enter formats it (roadmap 44: a
  // double-click on a point formats its data set, selection.spec.ts).
  await point.click()
  await expect(page.locator('.selection-hint')).toContainText('Data set selected')
  await point.click()
  await expect(page.locator('.selection-hint')).toContainText('Data point selected')
  await page.keyboard.press('Enter')
  const d = await inWindow(page, 'Format graph')
  await expect(d.getByText('This point only')).toBeVisible()
  const symbol = section(d, 'Point symbol')
  await symbol.getByLabel('Size (pt)').fill('16')
  const pv = preview(page)
  await expect
    .poll(() => pv.locator(`[data-id="${id}"]`).getAttribute('d'))
    .not.toBe(before[await indexOf(svg, id)])
  // A label beside the point: a text label drawn for it.
  await section(d, 'Point label and visibility').getByLabel('Label beside the point').fill('Peak')
  await expect(pointLabels(pv)).toHaveText(['Peak'])
  await ok(d)
  const after = await shapes(svg)
  const changed = after.filter((x, i) => x !== before[i])
  expect(changed).toHaveLength(1)
  await expect(pointLabels(svg)).toHaveText(['Peak'])
  await expectUndo(page, 'Format graph')
  await undo(page)
  await expect.poll(() => shapes(svg)).toEqual(before)
  await expect(pointLabels(svg)).toHaveCount(0)

  // From the context menu too: on a point of an unselected data set, “Format this point…”.
  await page
    .getByRole('main')
    .locator('.canvas')
    .click({ position: { x: 4, y: 4 } })
  await expect(page.locator('.selection-hint')).not.toContainText('selected')
  await point.click({ button: 'right' })
  await page
    .getByRole('menu', { name: 'Graph element' })
    .getByRole('menuitem', {
      name: /^Format this point/,
    })
    .click()
  await inWindow(page, 'Format graph')
  await expect(d.getByText('This point only')).toBeVisible()
  await cancel(d)
})

async function indexOf(svg: Locator, id: string): Promise<number> {
  return pointMarks(svg).evaluateAll(
    (els, target) => els.findIndex((e) => e.getAttribute('data-id') === target),
    id,
  )
}

test('the title edits in place on a double-click; its format is on the context menu', async ({
  page,
}) => {
  const svg = await openGraph(page, SCATTER.example, SCATTER.graph)
  const title = svg.locator('[data-id="title"]')
  await expect(title).toHaveText('Enzyme activity')
  await dblclickOn(title)
  const input = page.getByRole('textbox', { name: 'Edit text' })
  await expect(input).toHaveText('Enzyme activity')
  await input.fill('Enzyme activity, day 3')
  await input.press('Enter')
  await expect(title).toHaveText('Enzyme activity, day 3')
  await expect(undoButton(page)).toHaveAccessibleName(/^Undo Edit /)
  await undo(page)
  await expect(title).toHaveText('Enzyme activity')

  // Right-click › Format title… opens the title's place: its text and font in Common.
  await clickOn(title, 'right')
  await page
    .getByRole('menu', { name: 'Graph element' })
    .getByRole('menuitem', {
      name: 'Format title…',
    })
    .click()
  const d = await inWindow(page, 'Format title')
  await expect(d.getByRole('tab')).toHaveCount(0)
  const size = section(d, 'Common').getByLabel('Title size (pt)')
  const pvTitle = preview(page).locator('[data-id="title"] tspan').first()
  const before = Number(await pvTitle.getAttribute('font-size'))
  await size.fill(String(before + 10))
  await expect(pvTitle).toHaveAttribute('font-size', String(before + 10))
  await ok(d)
  await expect(title.locator('tspan').first()).toHaveAttribute('font-size', String(before + 10))
  await expectUndo(page, 'Format title')
})

test('double-clicking the legend opens Format legend', async ({ page }) => {
  const svg = await openGraph(page, 'formatting', 'Temperature and heart rate')
  const legend = marks(svg, 'legend/')
  const count = await legend.count()
  expect(count).toBeGreaterThan(0)
  await (await reachable(svg.locator('[data-id^="legend/"][data-id$="/symbol"]'))).dblclick()
  const d = await inWindow(page, 'Format legend')
  await expect(d).toBeVisible()
  await expect(d.getByRole('tab')).toHaveCount(0)
  await d.getByLabel('Show legend').uncheck()
  await expect(marks(preview(page), 'legend/')).toHaveCount(0)
  await expect(legend).toHaveCount(count)
  await ok(d)
  await expect(legend).toHaveCount(0)
  await expectUndo(page, 'Format legend')
  await undo(page)
  await expect(legend).toHaveCount(count)
})

test('double-clicking a bracket opens Format significance bracket', async ({ page }) => {
  const svg = await openGraph(page, SCATTER.example, SCATTER.graph)
  const bracket = svg.locator('polyline[data-id^="annotation/"]').first()
  await dblclickOn(bracket)
  const d = await inWindow(page, 'Format significance bracket')
  // This bracket first; every bracket's style in a section below, closed until opened.
  await expect(d.getByRole('tab')).toHaveCount(0)
  await expect(sectionToggle(d, 'Significance bracket')).toHaveAttribute('aria-expanded', 'true')
  await expect(sectionToggle(d, 'Significance brackets')).toHaveAttribute('aria-expanded', 'false')
  const all = await expand(d, 'Significance brackets')
  await expect(all.getByLabel('Spacing (pt)')).toBeVisible()
  await cancel(d)
  await expect(undoButton(page)).toBeDisabled()
})

/** Adds brackets from the view toolbar's Add ▾ menu. */
async function addBrackets(page: Page, analysis: string) {
  await page.getByRole('main').getByRole('button', { name: 'Add ▾' }).click()
  await page
    .getByRole('menu', { name: 'Add to graph' })
    .getByRole('menuitem', { name: `Significance brackets from “${analysis}”` })
    .click()
}

test('Add ▾ › Significance brackets draws them, one undo step', async ({ page }) => {
  await openExample(page, 'getting-started')
  await openSheet(page, 'Dose response (3 groups)', 'Data Tables')
  const svg = await newGraph(page, 'Scatter, mean ± SD', 'No brackets yet')
  const brackets = svg.locator('polyline[data-id^="annotation/"]')
  await expect(brackets).toHaveCount(0)
  await addBrackets(page, 'One-way ANOVA (Tukey)')
  await expect(brackets.first()).toBeVisible()
  const n = await brackets.count()
  await expect(svg.locator('text[data-id^="annotation/"]')).toHaveCount(n)
  await expectUndo(page, 'Add significance brackets')
  // Again: nothing new to add.
  await addBrackets(page, 'One-way ANOVA (Tukey)')
  await expect(page.locator('.toast')).toContainText('No new comparisons to add')
  await undo(page)
  await expect(brackets).toHaveCount(0)
  // From the graph's place (Format graph…) › Significance brackets as well.
  await page
    .getByRole('toolbar', { name: 'Toolbar' })
    .getByRole('button', {
      name: 'Format graph…',
    })
    .click()
  const d = await inWindow(page, 'Format graph')
  const brackets2 = await expand(d, 'Significance brackets')
  await brackets2.getByRole('button', { name: 'Add brackets from “One-way ANOVA (Tukey)”' }).click()
  await expect(preview(page).locator('polyline[data-id^="annotation/"]')).toHaveCount(n)
  await ok(d)
  await expect(brackets).toHaveCount(n)
  await expectUndo(page, 'Format graph')
})

test('Label points: Y values on every point, then only past a threshold', async ({ page }) => {
  const svg = await openGraph(page, SCATTER.example, SCATTER.graph)
  const total = await pointMarks(svg).count()
  await page
    .getByRole('toolbar', { name: 'Toolbar' })
    .getByRole('button', {
      name: 'Format graph…',
    })
    .click()
  const d = await inWindow(page, 'Format graph')
  await selectLayer(d, /^Points/)
  await expect(seriesPicker(d)).toHaveValue('all')
  const labels = await expand(d, 'Label points')
  await labels.getByLabel('Label', { exact: true }).selectOption({ label: 'Y values' })
  const pv = preview(page)
  await expect(pointLabels(pv)).toHaveCount(total)
  const values = (await pointLabels(pv).allTextContents()).map(Number).sort((a, b) => a - b)
  expect(values.every(Number.isFinite)).toBe(true)
  // Label only the values at or above the upper quartile.
  const limit = values[Math.floor(values.length * 0.75)]!
  const expected = values.filter((v) => v >= limit).length
  await labels.getByLabel('Which points').selectOption({ label: 'Points past thresholds' })
  await labels.getByLabel('Test').selectOption({ label: '≥' })
  await labels.getByLabel('Limit').fill(String(limit))
  await expect(pointLabels(pv)).toHaveCount(expected)
  expect(expected).toBeLessThan(total)
  await expect(pointLabels(svg)).toHaveCount(0)
  await ok(d)
  await expect(pointLabels(svg)).toHaveCount(expected)
  for (const t of await pointLabels(svg).allTextContents())
    expect(Number(t)).toBeGreaterThanOrEqual(limit)
  await expectUndo(page, 'Format graph')
  await undo(page)
  await expect(pointLabels(svg)).toHaveCount(0)
})

test('Label points by row title: the volcano plot’s gene names', async ({ page }) => {
  const svg = await openGraph(page, 'grouped', 'Volcano plot')
  const labels = pointLabels(svg)
  await expect(labels.first()).toBeVisible()
  const n = await labels.count()
  // Gene names, not numbers.
  for (const t of await labels.allTextContents()) expect(t).toMatch(/[A-Za-z]/)
  // A label formats the analysis output it belongs to.
  await dblclickOn(await reachable(labels))
  const d = await inWindow(page, 'Format graph')
  await expect(seriesPicker(d)).toHaveValue(/^output:/)
  const section = await expand(d, 'Label points')
  await expect(section.getByLabel('Label', { exact: true })).toHaveValue('rowTitle')
  await section.getByLabel('Label', { exact: true }).selectOption('none')
  await expect(pointLabels(preview(page))).toHaveCount(0)
  await cancel(d)
  await expect(labels).toHaveCount(n)
  await expect(canvas(page)).toBeVisible()
})
