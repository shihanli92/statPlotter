import { expect, openExample, test } from './fixtures.ts'
import { escapeRegExp, grid, newTable, typeCells } from './helpers-data.ts'
import {
  builderPreview,
  canvas,
  changeLayers,
  dialog,
  expectUndo,
  inWindow,
  layerList,
  marks,
  menu,
  newGraph,
  openGraph,
  openSheet,
  pickPreset,
  plotStyle,
  pointMarks,
  presets,
  sheet,
  undo,
} from './helpers-graph.ts'

// Graphs (roadmap 24; the graph builder of roadmap 33c): every preset offered for each table
// kind, changing a graph's layers from Format graph › Graph settings, and what the presets draw.
//
// Audit 2 (U19): the sweeps through every preset run in Chromium; WebKit and Firefox draw the
// first and last of each list (the unit tests lay out every preset, so a preset drawing nothing
// would fail there whatever the browser).

/** The presets a sweep goes through: all in Chromium, the first and last elsewhere. */
const swept = (names: string[], browserName: string) =>
  browserName === 'chromium' || names.length <= 2 ? names : [names[0]!, names.at(-1)!]

/** A table of each kind in the example projects. */
const TABLES = [
  { kind: 'column', example: 'getting-started', table: 'Dose response (3 groups)' },
  { kind: 'XY', example: 'curve-fitting', table: 'Dose-response' },
  { kind: 'grouped', example: 'grouped', table: 'Genotype × treatment' },
  { kind: 'contingency', example: 'clinical', table: 'Adverse events' },
  { kind: 'survival', example: 'clinical', table: 'Survival by treatment' },
  { kind: 'nested', example: 'data-processing', table: 'Dendritic spines' },
  { kind: 'multiple variables', example: 'multiple-variables', table: 'Blood pressure trial' },
  { kind: 'parts of whole', example: 'parts-of-whole', table: 'Immune cells by tissue' },
] as const

for (const t of TABLES) {
  test(`New graph… of a ${t.kind} table: every preset draws its data`, async ({
    page,
    browserName,
  }) => {
    test.slow()
    await openExample(page, t.example)
    await openSheet(page, t.table, 'Data Tables')
    await menu(page, 'Insert', 'New graph…')
    // "Another graph of" a table with graphs already (roadmap 43).
    const d = dialog(page, new RegExp(`^(New|Another) graph of “${escapeRegExp(t.table)}”$`))
    const options = await presets(d).evaluateAll((els) =>
      els.map((e) => e.getAttribute('aria-label')!),
    )
    await d.getByRole('button', { name: 'Cancel' }).click()
    expect(options.length).toBeGreaterThan(0)

    for (const [i, option] of swept(options, browserName).entries()) {
      await openSheet(page, t.table, 'Data Tables')
      const name = `E2E ${i + 1}`
      const svg = await newGraph(page, option, name)
      await expect(sheet(page, name), option).toHaveClass(/\bon\b/)
      // Data marks of every preset are scene nodes under `series/` (points, bars, boxes,
      // slices, survival steps…).
      await expect(marks(svg, 'series/').first(), option).toBeAttached()
      await expect(page.getByRole('main').locator('.banner.error')).toHaveCount(0)
    }
  })
}

/** The graph's layers as its place lists them (front first). */
const layerNames = (d: import('@playwright/test').Locator) =>
  layerList(d)
    .getByRole('option')
    .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')).join(', '))

/** Opens the graph's place (Format graph…) in the dialog. */
async function graphSettings(page: import('@playwright/test').Page) {
  await menu(page, 'Format', 'Format graph…')
  return inWindow(page, 'Format graph')
}

test('an empty table’s graph says where its values go; a second graph of it is “Data 1 (2)”', async ({
  page,
}) => {
  // Roadmap 43.
  await page.goto('/')
  await newTable(page, { kind: 'Column' })
  // The table's graph draws its frame, and a note on screen (not in the graph) leads to the table.
  await openSheet(page, 'Data 1', 'Graphs')
  await expect(canvas(page)).toBeVisible()
  const note = page.getByRole('main').getByRole('note').filter({ hasText: 'No values yet' })
  await expect(note).toContainText('No values yet: enter data in “Data 1”')
  await expect(canvas(page)).not.toContainText('No values yet')
  await note.getByRole('button', { name: 'Go to table' }).click()
  await expect(grid(page)).toHaveAccessibleName('Data 1')
  await expect(sheet(page, 'Data 1', 'Data Tables')).toHaveClass(/\bon\b/)
  await typeCells(page, 0, 0, [['5']])
  await openSheet(page, 'Data 1', 'Graphs')
  await expect(pointMarks(canvas(page))).toHaveCount(1)
  await expect(note).toHaveCount(0)

  // New graph… of a table with a graph: plainly another one, named so.
  await openSheet(page, 'Data 1', 'Data Tables')
  await menu(page, 'Insert', 'New graph…')
  let b = dialog(page, 'Another graph of “Data 1”')
  await expect(b.getByLabel('Name', { exact: true })).toHaveValue('Data 1 (2)')
  await b.getByRole('button', { name: /^Create/ }).click()
  await expect(b).toBeHidden()
  await expect(sheet(page, 'Data 1 (2)', 'Graphs')).toHaveClass(/\bon\b/)
  await openSheet(page, 'Data 1', 'Data Tables')
  await menu(page, 'Insert', 'New graph…')
  b = dialog(page, 'Another graph of “Data 1”')
  await expect(b.getByLabel('Name', { exact: true })).toHaveValue('Data 1 (3)')
  await b.getByRole('button', { name: 'Cancel' }).click()
  await expect(b).toBeHidden()
})

test('a bar graph changed to a dot plot with Change layers… shows its points', async ({ page }) => {
  await openExample(page, 'getting-started')
  await openSheet(page, 'Dose response (3 groups)', 'Data Tables')
  // Bars with points, the points' icon off: bars and error bars.
  const svg = await newGraph(page, 'Bars with points', 'Bars only', { styles: ['Points'] })
  await expect(marks(svg, 'series/').and(page.locator('rect'))).toHaveCount(3)
  await expect(pointMarks(svg)).toHaveCount(0)

  const d = await graphSettings(page)
  const b = await changeLayers(page, d)
  await pickPreset(b, 'Scatter, mean ± SD')
  await expect(pointMarks(builderPreview(b))).toHaveCount(24)
  await b.getByRole('button', { name: 'OK' }).click()
  await expect(b).toBeHidden()
  // The Format dialog's preview follows at once; the canvas only on its OK.
  await expect(pointMarks(d.getByRole('img', { name: /^Preview/ }))).toHaveCount(24)
  await expect(pointMarks(svg)).toHaveCount(0)
  await d.getByRole('button', { name: 'OK' }).click()
  await expect(d).toBeHidden()
  await expect(pointMarks(svg)).toHaveCount(24)
  await expect(svg.locator('rect[data-id$="/bar"]')).toHaveCount(0)
  await expectUndo(page, 'Format graph')
  await undo(page)
  await expect(pointMarks(svg)).toHaveCount(0)
  await expect(svg.locator('rect[data-id$="/bar"]')).toHaveCount(3)
})

for (const g of [
  { example: 'getting-started', graph: 'Dose response (bars)' },
  { example: 'grouped', graph: 'Genotype × treatment' },
  // One chip (the pie): a frame choice among the icons changes it for real.
  { example: 'parts-of-whole', graph: 'Spleen (donut)', icon: '100% bars' },
  { example: 'multiple-variables', graph: 'Change by group' },
] as { example: string; graph: string; icon?: string }[]) {
  test(`“${g.graph}” through every preset of Change layers…`, async ({ page, browserName }) => {
    const svg = await openGraph(page, g.example, g.graph)
    const d = await graphSettings(page)
    const start = await layerNames(d)
    const b = await changeLayers(page, d)
    const names = await presets(b).evaluateAll((els) =>
      els.map((e) => e.getAttribute('aria-label')!),
    )
    expect(names.length).toBeGreaterThan(g.icon ? 0 : 1)
    const shown = builderPreview(b)
    for (const name of swept(names, browserName)) {
      const chip = b.getByRole('radio', { name, exact: true })
      await chip.click()
      await expect(chip).toHaveAttribute('aria-checked', 'true')
      await expect(marks(shown, 'series/').first(), name).toBeAttached()
    }
    // Another preset (or frame) for real: one step for the Format dialog.
    if (g.icon) {
      await plotStyle(b, g.icon).click()
      await expect(plotStyle(b, g.icon)).toHaveAttribute('aria-pressed', 'true')
    } else await b.getByRole('radio', { name: names.at(-1)!, exact: true }).click()
    await b.getByRole('button', { name: 'OK' }).click()
    await expect(b).toBeHidden()
    const changed = await layerNames(d)
    expect(changed).not.toBe(start)
    await d.getByRole('button', { name: 'OK' }).click()
    await expect(d).toBeHidden()
    await expect(marks(svg, 'series/').first()).toBeAttached()
    await expectUndo(page, 'Format graph')
    await undo(page)
    const reverted = await graphSettings(page)
    await expect.poll(() => layerNames(reverted)).toBe(start)
    await reverted.getByRole('button', { name: 'Cancel' }).click()
  })
}

test('presets draw what they say', async ({ page }) => {
  await openExample(page, 'getting-started')
  const cases = [
    { preset: 'Bars with points', points: 24, bars: 3, errors: true },
    { preset: 'Scatter, mean ± SD', points: 24, bars: 0, errors: true, centre: true },
    { preset: 'Box with points', points: 24, bars: 0, errors: false },
    { preset: 'Violin with box', points: 0, bars: 0, errors: false },
  ]
  for (const c of cases) {
    await openSheet(page, 'Dose response (3 groups)', 'Data Tables')
    const svg = await newGraph(page, c.preset)
    await expect(pointMarks(svg), c.preset).toHaveCount(c.points)
    await expect(svg.locator('rect[data-id$="/bar"]'), c.preset).toHaveCount(c.bars)
    const errors = svg.locator('[data-id*="/error/"]')
    if (c.errors) await expect(errors.first(), c.preset).toBeAttached()
    else await expect(errors, c.preset).toHaveCount(0)
    if (c.centre) await expect(svg.locator('[data-id$="/center"]').first(), c.preset).toBeAttached()
  }
  await expect(canvas(page)).toBeVisible()
})
