import type { Locator, Page } from '@playwright/test'
import { expect, openExample, test } from './fixtures.ts'
import { runMenu } from './helpers-data.ts'
import {
  box,
  dblclickOn,
  drag,
  expectUndo,
  formatPanel,
  layerList,
  marks,
  newGraph,
  openSheet,
  panelHeading,
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
