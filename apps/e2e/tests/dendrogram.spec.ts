import type { Locator, Page } from '@playwright/test'
import { expect, openExample, test } from './fixtures.ts'
import { runMenu } from './helpers-data.ts'
import {
  box,
  clickOn,
  colourPopover,
  dblclickOn,
  drag,
  expectUndo,
  formatPanel,
  layerList,
  marks,
  menu,
  newGraph,
  openSheet,
  panelHeading,
  pointOn,
  undo,
} from './helpers-graph.ts'

// Roadmap 49c: dendrograms as layers. Clustering a heat map's rows or columns adds its tree as a
// layer of its own (Row dendrogram, Column dendrogram) in the list of layers; a tree is selected
// on the canvas, opens its own Format view, and is resized from its field or by dragging its outer
// edge, moved to the map's other side, cut into clusters (branches coloured, a strip) and hidden;
// a dendrogram alone comes from New graph.

test.use({ viewport: { width: 1400, height: 1000 } })

/** The union of the client rects of marks (a tree's lines), as `box` gives one's. */
const unionBox = (l: Locator) =>
  l.evaluateAll((els) => {
    const rs = els.map((e) => e.getBoundingClientRect())
    const x = Math.min(...rs.map((r) => r.x))
    const y = Math.min(...rs.map((r) => r.y))
    const w = Math.max(...rs.map((r) => r.x + r.width)) - x
    const h = Math.max(...rs.map((r) => r.y + r.height)) - y
    return { x, y, w, h }
  })
const rowLines = (svg: Locator) => svg.locator('polyline[data-id^="dendrogram/rows/"]')
const columnLines = (svg: Locator) => svg.locator('polyline[data-id^="dendrogram/columns/"]')
const cells = (svg: Locator) => svg.locator('rect[data-id*="/cell/"]')
const rowNames = (svg: Locator) => marks(svg, 'axis/y/tickLabel/').allTextContents()
const handle = (page: Page) => page.getByTestId('tree-handle')

/** The graph's list of layers (Format graph…), its rows' names front first. */
async function layerNames(page: Page): Promise<string[]> {
  await runMenu(page, 'Format', 'Format graph…')
  const list = layerList(formatPanel(page))
  await expect(list).toBeVisible()
  return list
    .getByRole('option')
    .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''))
}

/** A heat map of the more-graphs example's genes, made with New graph (no clustering). */
async function geneMap(page: Page): Promise<Locator> {
  await openExample(page, 'more-graphs')
  await openSheet(page, 'Gene expression', 'Data Tables')
  const svg = await newGraph(page, null, 'Expression map', { styles: ['Heat map'] })
  await expect(cells(svg)).toHaveCount(60)
  await expect(svg.locator('[data-id^="dendrogram/"]')).toHaveCount(0)
  return svg
}

test('clustering adds the trees as layers; a tree is selected, resized, moved, cut and hidden', async ({
  page,
}) => {
  const svg = await geneMap(page)
  const tableOrder = await rowNames(svg)
  // The heat map's own view: clustering its rows and columns adds their trees, one step each.
  await dblclickOn(cells(svg).first())
  const p = formatPanel(page)
  await expect(panelHeading(page)).toHaveText(/^Heat map/)
  await p.getByRole('checkbox', { name: 'Cluster rows' }).check()
  await expect(rowLines(svg)).toHaveCount(9)
  await expectUndo(page, 'Cluster rows')
  await p.getByRole('checkbox', { name: 'Cluster columns' }).check()
  await expect(columnLines(svg)).toHaveCount(5)
  expect(await rowNames(svg)).not.toEqual(tableOrder)
  expect(await layerNames(page)).toEqual([
    'Column dendrogram',
    'Row dendrogram',
    expect.stringMatching(/^Heat map/),
  ])

  // A tree selected on the canvas opens its own view; its width from the field.
  await dblclickOn(rowLines(svg).first())
  await expect(panelHeading(page)).toHaveText('Row dendrogram')
  const before = await unionBox(rowLines(svg))
  await p.getByLabel('Tree width (pt)').fill('72')
  await p.getByLabel('Tree width (pt)').press('Tab')
  await expectUndo(page, 'Dendrogram size')
  await expect.poll(async () => (await unionBox(rowLines(svg))).w).toBeGreaterThan(before.w * 1.6)

  // Dragging its outer edge's handle: deeper, one step.
  await expect(handle(page)).toBeVisible()
  await expect(handle(page)).toHaveAttribute('data-side', 'right')
  const wide = await unionBox(rowLines(svg))
  const h = await box(handle(page))
  await drag(page, { x: h.x + h.w / 2, y: h.y + h.h / 2 }, 60, 0)
  await expectUndo(page, 'Dendrogram size')
  await expect.poll(async () => (await unionBox(rowLines(svg))).w).toBeGreaterThan(wide.w + 30)
  await expect.poll(() => p.getByLabel('Tree width (pt)').inputValue()).not.toBe('72')
  await undo(page)
  await expect(p.getByLabel('Tree width (pt)')).toHaveValue('72')

  // The other side of the map: left of the cells, the row names beyond it.
  await p.getByLabel('Side').selectOption('left')
  await expect
    .poll(async () => (await unionBox(rowLines(svg))).x + (await unionBox(rowLines(svg))).w)
    .toBeLessThan((await box(cells(svg).first())).x)
  const name = await box(marks(svg, 'axis/y/tickLabel/0'))
  expect(name.x + name.w).toBeLessThan((await unionBox(rowLines(svg))).x)

  // Cut into three clusters: branches in their colours, a strip, entries in the legend.
  await p.getByLabel('Cut the tree').selectOption('k')
  await p.getByLabel('Clusters', { exact: true }).fill('3')
  await p.getByLabel('Clusters', { exact: true }).press('Tab')
  const strokes = () =>
    rowLines(svg).evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute('stroke')))])
  await expect.poll(async () => (await strokes()).length).toBeGreaterThanOrEqual(3)
  await p.getByRole('checkbox', { name: /^Cluster strip/ }).check()
  await expect(svg.locator('rect[data-id^="dendrogram/rows/strip/"]')).toHaveCount(10)

  // The column tree hidden: not drawn, the columns still in their clustered order.
  const columns = await marks(svg, 'axis/x/tickLabel/').allTextContents()
  await runMenu(page, 'Format', 'Format graph…')
  const list = layerList(p)
  await list.getByRole('option', { name: 'Column dendrogram' }).click()
  await p.locator('.layers-toolbar').getByRole('button', { name: 'Hide', exact: true }).click()
  await expect(columnLines(svg)).toHaveCount(0)
  expect(await marks(svg, 'axis/x/tickLabel/').allTextContents()).toEqual(columns)
  await expect(rowLines(svg).first()).toBeAttached()
})

// Roadmap 49c's leftovers (done with 49d): the tree's handle on a graph placed on a layout page,
// the format bar's Line group on a selected tree, and hover cards on branches, leaves and strips.

/** The gene map with its rows and columns clustered (their trees added), the panel open. */
async function clusteredMap(page: Page): Promise<Locator> {
  const svg = await geneMap(page)
  await dblclickOn(cells(svg).first())
  const p = formatPanel(page)
  await p.getByRole('checkbox', { name: 'Cluster rows' }).check()
  await expect(rowLines(svg)).toHaveCount(9)
  await p.getByRole('checkbox', { name: 'Cluster columns' }).check()
  await expect(columnLines(svg)).toHaveCount(5)
  return svg
}

/** A point `f` of the way along segment `seg` of a polyline, on screen. */
const alongLine = (line: Locator, seg: number, f: number) =>
  line.evaluate(
    (e, [seg, f]) => {
      const pts = (e.getAttribute('points') ?? '')
        .trim()
        .split(/\s+/)
        .map((p) => p.split(',').map(Number) as [number, number])
      const [a, b] = [pts[seg]!, pts[seg + 1]!]
      const [x, y] = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]
      const m = (e as SVGGraphicsElement).getScreenCTM()!
      return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f }
    },
    [seg, f] as const,
  )

test('a tree’s handle on a graph placed on a layout page resizes it, one step', async ({
  page,
}) => {
  await clusteredMap(page)
  // A page of the heat map alone.
  await menu(page, 'Insert', 'New layout')
  const pageSvg = page.getByRole('img', { name: 'Layout page' })
  await expect(pageSvg).toBeVisible()
  await menu(page, 'Edit', 'Select all')
  await menu(page, 'Arrange', 'Remove items from page')
  await menu(page, 'Insert', 'Graph on page', 'Expression map')
  const lines = rowLines(pageSvg)
  await expect(lines).toHaveCount(9)
  // Its row tree selected (a click on a graph not worked in may select the graph first): the
  // handle on the tree's outer edge.
  const said = page.getByTestId('page-selection-announcement')
  const tree = 'Layer “Row dendrogram” of “Expression map”'
  const on = await alongLine(lines.first(), 1, 0.25)
  await page.mouse.click(on.x, on.y)
  if ((await said.textContent()) !== tree) {
    await expect(handle(page)).toHaveCount(0)
    await page.mouse.click(on.x, on.y)
  }
  await expect(said).toHaveText(tree)
  await expect(handle(page)).toBeVisible()
  await expect(handle(page)).toHaveAttribute('data-side', 'right')
  const before = await unionBox(lines)
  const cell = await box(cells(pageSvg).first())
  const h = await box(handle(page))
  // Dragged out: the tree deeper (the handle following it), one step.
  await drag(page, { x: h.x + h.w / 2, y: h.y + h.h / 2 }, 50, 0, {
    during: async () => {
      await expect(page.getByText(/^Width [\d.]+ pt · Alt: not rounded/)).toBeVisible()
    },
  })
  await expectUndo(page, 'Dendrogram size')
  await expect.poll(async () => (await unionBox(lines)).w).toBeGreaterThan(before.w + 20)
  const moved = await box(handle(page))
  expect(moved.x).toBeGreaterThan(h.x + 20)
  // The plot stayed put on the page: the cells didn't move.
  const after = await box(cells(pageSvg).first())
  expect(Math.abs(after.x - cell.x) + Math.abs(after.y - cell.y)).toBeLessThan(1)
  await undo(page)
  await expect.poll(async () => (await unionBox(lines)).w).toBeCloseTo(before.w, 0)
  await expect(said).toHaveText(tree)
})

test('the format bar’s Line group formats a selected tree; two trees mixed', async ({ page }) => {
  const svg = await clusteredMap(page)
  const bar = page.getByTestId('format-bar')
  const more = bar.getByRole('button', { name: 'More format options', exact: true })
  /** A bar button, from More ▾ when the docked panel folds the Line group into it. */
  const control = async (name: string): Promise<Locator> => {
    await expect(
      bar.getByRole('button', { name: 'Format…', exact: true }).or(more).first(),
    ).toBeVisible()
    const inBar = bar.getByRole('button', { name, exact: true })
    if (await inBar.count()) return inBar
    if (!(await page.getByRole('toolbar', { name: 'More format options' }).count()))
      await more.click()
    return page
      .getByRole('toolbar', { name: 'More format options' })
      .getByRole('button', { name, exact: true })
  }
  const strokes = (l: Locator) =>
    l.evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute('stroke')))])
  const widths = (l: Locator) =>
    l.evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute('stroke-width')))])

  // The row tree selected: its line as drawn (0.75 pt).
  await clickOn(rowLines(svg).first())
  await expect(panelHeading(page)).toHaveText('Row dendrogram')
  await expect(await control('Line width')).toHaveText('0.75 pt')
  await (await control('Line width')).click()
  await page
    .getByRole('menu', { name: 'Line widths', exact: true })
    .getByRole('menuitemradio', { name: '2 pt' })
    .click()
  await expect.poll(() => widths(rowLines(svg))).toEqual(['2'])
  await expectUndo(page, 'Line width 2 pt')
  // The Appearance table's Line width says the same (one field, two places).
  await expect(formatPanel(page).getByLabel('Line width (pt)')).toHaveValue('2')
  // Its colour.
  const black = await strokes(rowLines(svg))
  await (await control('Line colour')).click()
  await colourPopover(page).getByRole('option', { name: 'Palette colour 4', exact: true }).click()
  await expect.poll(async () => (await strokes(rowLines(svg))).length).toBe(1)
  await expect.poll(() => strokes(rowLines(svg))).not.toEqual(black)
  await expectUndo(page, 'Line colour')
  expect(await strokes(columnLines(svg))).toEqual(black)

  // With the column tree too: the widths differ (mixed, —); one width for both, one step.
  await page.mouse.move(1, 1)
  const p = await pointOn(columnLines(svg).first())
  await page.keyboard.down('Shift')
  await page.mouse.click(p.x, p.y)
  await page.keyboard.up('Shift')
  await expect(bar.getByRole('button', { name: /^Selected: 2 elements\./ })).toBeVisible()
  await expect(await control('Line width')).toHaveText('—')
  await (await control('Line width')).click()
  await page
    .getByRole('menu', { name: 'Line widths', exact: true })
    .getByRole('menuitemradio', { name: '1.5 pt' })
    .click()
  await expect.poll(() => widths(rowLines(svg))).toEqual(['1.5'])
  await expect.poll(() => widths(columnLines(svg))).toEqual(['1.5'])
  await expectUndo(page, 'Line width 1.5 pt (2 elements)')
})

test('hover cards on a tree: a branch’s merge, a leaf’s row, a strip band’s cluster', async ({
  page,
}) => {
  const svg = await clusteredMap(page)
  const card = page.getByTestId('hover-card')
  // Deeper, so the legs down to the leaves are long enough to rest on.
  const p = formatPanel(page)
  await dblclickOn(rowLines(svg).first())
  await expect(panelHeading(page)).toHaveText('Row dendrogram')
  await p.getByLabel('Tree width (pt)').fill('160')
  await p.getByLabel('Tree width (pt)').press('Tab')
  await expectUndo(page, 'Dendrogram size')
  await page.keyboard.press('Escape')

  // A branch's bar (off its middle, where the branch above it starts): its merge (two leaves).
  const first = svg.locator('polyline[data-id="dendrogram/rows/0"]')
  await page.mouse.move(1, 1)
  const across = await alongLine(first, 1, 0.2)
  await page.mouse.move(across.x, across.y)
  await expect(card).toBeVisible()
  await expect(card.locator('.hover-card-title')).toHaveText('Row dendrogram')
  await expect(card.locator('dt')).toHaveText(['Height', 'Leaves'])
  await expect(card.locator('dd').nth(1)).toHaveText('2')

  // Along the branch to its leg down to a leaf: that leaf's row (a name down the map's side).
  const names = await rowNames(svg)
  const leg = await alongLine(first, 0, 0.4)
  await page.mouse.move(leg.x, leg.y, { steps: 6 })
  await expect(card.locator('dt')).toHaveText(['Row'])
  expect(names).toContain(await card.locator('dd').first().textContent())

  // Cut into three with a strip: a band tells its leaf's row and cluster.
  await page.mouse.move(1, 1)
  await expect(card).toHaveCount(0)
  await dblclickOn(first)
  await p.getByLabel('Cut the tree').selectOption('k')
  await p.getByLabel('Clusters', { exact: true }).fill('3')
  await p.getByLabel('Clusters', { exact: true }).press('Tab')
  await p.getByRole('checkbox', { name: /^Cluster strip/ }).check()
  const band = svg.locator('rect[data-id="dendrogram/rows/strip/0"]')
  await expect(band).toBeAttached()
  await page.keyboard.press('Escape')
  await page.mouse.move(1, 1)
  const b = await box(band)
  await page.mouse.move(b.x + b.w / 2, b.y + b.h / 2)
  await expect(card.locator('dt')).toHaveText(['Row', 'Cluster'])
  // The first band is the first name along the tree (the map's top row).
  await expect(card.locator('dd').first()).toHaveText(names[0]!)
  await expect(card.locator('dd').nth(1)).toHaveText(/^[123]$/)
})

test('a dendrogram alone from New graph, its leaves along the bottom or down the left', async ({
  page,
}) => {
  await openExample(page, 'more-graphs')
  await openSheet(page, 'Gene expression', 'Data Tables')
  const svg = await newGraph(page, null, 'Gene tree', { styles: ['Dendrogram'] })
  await expect(rowLines(svg)).toHaveCount(9)
  await expect(cells(svg)).toHaveCount(0)
  // Its leaves named along the bottom, the merge heights up the left.
  const leaves = marks(svg, 'axis/x/tickLabel/')
  await expect(leaves).toHaveCount(10)
  await expect(marks(svg, 'axis/y/title')).toHaveText('Height')
  const tree = await unionBox(rowLines(svg))
  expect((await box(leaves.first())).y).toBeGreaterThan(tree.y + tree.h - 1)

  // Down the left: the leaves turned with the axes, one step.
  await dblclickOn(rowLines(svg).first())
  const p = formatPanel(page)
  await expect(panelHeading(page)).toHaveText('Row dendrogram')
  await p.getByLabel('Leaves').selectOption('left')
  await expectUndo(page, 'Leaves down the left')
  const names = marks(svg, 'axis/y/tickLabel/')
  await expect(names).toHaveCount(10)
  await expect(marks(svg, 'axis/x/title')).toHaveText('Height')
  // Cut at a height: the clusters it leaves are said.
  await p.getByLabel('Cut the tree').selectOption('h')
  await expect(p.getByText(/clusters at this height/)).toBeVisible()
  await expect
    .poll(() =>
      rowLines(svg).evaluateAll((els) => new Set(els.map((e) => e.getAttribute('stroke'))).size),
    )
    .toBeGreaterThan(1)
})
