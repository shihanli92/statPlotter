import type { Locator, Page } from '@playwright/test'
import { expect, openExample, test } from './fixtures.ts'
import { pressShortcut } from './helpers-data.ts'
import {
  builderLayers,
  builderPreview,
  canvas,
  dialog,
  expectUndo,
  inWindow,
  layerList,
  marks,
  menu,
  openBuilder,
  openGraph,
  openSheet,
  pickPreset,
  plotStyle,
  pointMarks,
  presets,
  reachable,
  section,
  sectionToggle,
  selectLayer,
  seriesPicker,
  sheet,
  undo,
} from './helpers-graph.ts'

// The graph builder (roadmap 33c): presets, plot-style icons drawn by the engine, the layer
// table and the live preview, for new graphs, Duplicate as… and Change layers…; the Layers of
// Format graph › Appearance and the Format › Layers commands; selecting marks by layer on the
// canvas (decision 243).

/** The names of the builder's layer rows, top to bottom (front to back). */
const layerNames = (b: Locator) =>
  builderLayers(b).evaluateAll((rows) => rows.map((r) => r.getAttribute('aria-label')))

/** The names of Format graph's layers, top to bottom (front to back). */
const formatLayerNames = (d: Locator) =>
  layerList(d)
    .getByRole('option')
    .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))

/** The selection halos drawn on the canvas. */
const halos = (svg: Locator) => svg.locator('g.selection > *')

test('a grouped graph of bars (mean), points and SEM error bars', async ({ page }) => {
  await openExample(page, 'grouped')
  await openSheet(page, 'Genotype × treatment', 'Data Tables')
  const b = await openBuilder(page)
  await expect(b.locator('.builder-context')).toHaveText(
    /^Grouped table · \d+ rows × \d+ data sets/,
  )
  // A grouped table starts as bars with points: the bars' mean, every value, SD error bars.
  await expect(b.getByRole('radio', { name: 'Bars with points', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  expect(await layerNames(b)).toEqual(['Error bars (SD)', 'Points (every value)', 'Bars (mean)'])
  await expect(plotStyle(b, 'Points')).toHaveAttribute('aria-pressed', 'true')
  // The error bars' SEM: no preset any more, but where it came from.
  await b.getByLabel('Error bars (SD): statistic').selectOption('SEM')
  expect(await layerNames(b)).toEqual(['Error bars (SEM)', 'Points (every value)', 'Bars (mean)'])
  await expect(b.getByText('Custom', { exact: true })).toBeVisible()
  await expect(presets(b).and(b.locator('[aria-checked="true"]'))).toHaveCount(0)
  const shown = builderPreview(b)
  await expect(shown).toHaveAccessibleName(
    /^Preview: Bars \(mean\), Points \(every value\) and error bars \(SEM\), \d+ data sets$/,
  )
  await expect(pointMarks(shown).first()).toBeAttached()

  await b.getByLabel('Name', { exact: true }).fill('Bars, points, SEM')
  await b.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(b).toBeHidden()
  await expect(sheet(page, 'Bars, points, SEM', 'Graphs')).toHaveClass(/\bon\b/)
  const svg = canvas(page)
  await expect(svg.locator('rect[data-id*="/bar"]').first()).toBeAttached()
  await expect(pointMarks(svg).first()).toBeAttached()
  await expect(svg.locator('[data-id*="/error/"]').first()).toBeAttached()
  await expectUndo(page, 'New graph')
})

test('unavailable plot styles say why, and the preset row follows the arrow keys', async ({
  page,
}) => {
  await openExample(page, 'grouped')
  await openSheet(page, 'Genotype × treatment', 'Data Tables')
  const b = await openBuilder(page)
  await pickPreset(b, 'Stacked bars')
  // Stacked bars draw no points over them: the icon is there, disabled, with the reason.
  const points = plotStyle(b, 'Points')
  await expect(points).toHaveAttribute('aria-disabled', 'true')
  await expect(points).toHaveAccessibleDescription(/stacked bars/i)
  await points.click({ force: true })
  await expect(points).toHaveAttribute('aria-pressed', 'false')
  expect(await layerNames(b)).toEqual(['Error bars (SD)', 'Bars (mean)'])
  // Arrow keys move along the presets (a radio group), choosing as they go.
  const stacked = b.getByRole('radio', { name: 'Stacked bars', exact: true })
  await stacked.focus()
  await page.keyboard.press('ArrowLeft')
  const next = b.getByRole('radio', { name: 'Violin with box', exact: true })
  await expect(next).toBeFocused()
  await expect(next).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('Home')
  await expect(presets(b).first()).toBeFocused()
  await expect(presets(b).first()).toHaveAttribute('aria-checked', 'true')
  await b.getByRole('button', { name: 'Cancel' }).click()
  await expect(b).toBeHidden()
})

test('a graph made with the keyboard alone', async ({ page }) => {
  await openExample(page, 'getting-started')
  await openSheet(page, 'Dose response (3 groups)', 'Data Tables')
  // The command palette opens the builder; the chosen preset has the focus.
  await pressShortcut(page, 'Mod+K')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await palette.getByRole('combobox').fill('New graph')
  await palette.getByRole('combobox').press('Enter')
  const b = dialog(page, /^(New|Another) graph of/)
  await expect(b).toBeVisible()
  const scatter = b.getByRole('radio', { name: 'Scatter, mean ± SD', exact: true })
  await expect(scatter).toBeFocused()
  await expect(scatter).toHaveAttribute('aria-checked', 'true')
  // Bars with points: the chip before it.
  await page.keyboard.press('ArrowLeft')
  await expect(b.getByRole('radio', { name: 'Bars with points', exact: true })).toBeFocused()
  await expect(b.getByRole('radio', { name: 'Bars with points', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  // A plot style toggled off and on with Space.
  await plotStyle(b, 'Points').focus()
  await page.keyboard.press('Space')
  await expect(plotStyle(b, 'Points')).toHaveAttribute('aria-pressed', 'false')
  expect(await layerNames(b)).toEqual(['Error bars (SD)', 'Bars (mean)'])
  await page.keyboard.press('Space')
  await expect(plotStyle(b, 'Points')).toHaveAttribute('aria-pressed', 'true')
  // Added on top: in front of the bars and their error bars.
  expect(await layerNames(b)).toEqual(['Points (every value)', 'Error bars (SD)', 'Bars (mean)'])
  // Layer rows: Alt+↓ moves the focused one back (down), behind the bars and their error bars;
  // the focus follows it; Delete removes the focused row.
  const pointsRow = builderLayers(b).filter({ has: page.getByText('Points (every value)') })
  await pointsRow.focus()
  await page.keyboard.press('Alt+ArrowDown')
  expect(await layerNames(b)).toEqual(['Error bars (SD)', 'Bars (mean)', 'Points (every value)'])
  await expect(builderLayers(b).nth(2)).toBeFocused()
  await page.keyboard.press('Alt+ArrowUp')
  expect(await layerNames(b)).toEqual(['Points (every value)', 'Error bars (SD)', 'Bars (mean)'])
  await expect(builderLayers(b).first()).toBeFocused()
  await page.keyboard.press('Alt+ArrowDown')
  await expect(builderLayers(b).nth(2)).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowUp')
  await expect(builderLayers(b).first()).toBeFocused()
  await page.keyboard.press('Delete')
  expect(await layerNames(b)).toEqual(['Bars (mean)', 'Points (every value)'])
  // Create, with Enter on its button.
  await b.getByRole('button', { name: 'Create', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(b).toBeHidden()
  const svg = canvas(page)
  await expect(svg.locator('rect[data-id$="/bar"]')).toHaveCount(3)
  await expect(pointMarks(svg)).toHaveCount(24)
  await expect(svg.locator('[data-id*="/error/"]')).toHaveCount(0)
  // The points behind the bars: drawn first.
  const order = await svg
    .locator('[data-id^="series/"]')
    .evaluateAll((els) =>
      els.map((e) => (e.getAttribute('data-id')!.includes('/point/') ? 'p' : 'b')),
    )
  expect(order.indexOf('p')).toBeLessThan(order.indexOf('b'))
})

/** Opens the graph's place (its layers listed first) from the Format menu, in the dialog. */
async function appearance(page: Page): Promise<Locator> {
  await menu(page, 'Format', 'Format graph…')
  return inWindow(page, 'Format graph')
}

test('Format graph › Layers: reorder, hide and remove, each one undo step', async ({ page }) => {
  await openExample(page, 'getting-started')
  await openSheet(page, 'Dose response (3 groups)', 'Data Tables')
  await menu(page, 'Insert', 'New graph…')
  const b = dialog(page, /^(New|Another) graph of/)
  await pickPreset(b, 'Bars with points')
  await b.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(b).toBeHidden()
  const svg = canvas(page)
  await expect(pointMarks(svg)).toHaveCount(24)

  // Move the points behind the bars with the keyboard (the list holds the focus): down the
  // list, whose top row is in front.
  let d = await appearance(page)
  expect(await formatLayerNames(d)).toEqual([
    'Error bars (SD) on Bars (mean)',
    'Points (every value)',
    'Bars (mean)',
  ])
  await selectLayer(d, /^Points/)
  await layerList(d).focus()
  await page.keyboard.press('Alt+ArrowDown')
  expect(await formatLayerNames(d)).toEqual([
    'Error bars (SD) on Bars (mean)',
    'Bars (mean)',
    'Points (every value)',
  ])
  await d.getByRole('button', { name: 'OK' }).click()
  await expect(d).toBeHidden()
  await expectUndo(page, 'Format graph')

  // Hide the error bars (Space on the selected layer), then remove the points.
  d = await appearance(page)
  await selectLayer(d, /^Error bars/)
  await layerList(d).focus()
  await page.keyboard.press('Space')
  await expect(layerList(d).getByRole('option', { name: /^Error bars/ })).toHaveAccessibleName(
    /\(hidden\)$/,
  )
  await d.getByRole('button', { name: 'OK' }).click()
  await expect(svg.locator('[data-id*="/error/"]')).toHaveCount(0)
  await expectUndo(page, 'Format graph')
  d = await appearance(page)
  await selectLayer(d, /^Points/)
  await section(d, 'Layers').getByRole('button', { name: 'Delete', exact: true }).click()
  await d.getByRole('button', { name: 'OK' }).click()
  await expect(pointMarks(svg)).toHaveCount(0)
  await expectUndo(page, 'Format graph')

  // Each was one step.
  await undo(page)
  await expect(pointMarks(svg)).toHaveCount(24)
  await expect(svg.locator('[data-id*="/error/"]')).toHaveCount(0)
  await undo(page)
  await expect(svg.locator('[data-id*="/error/"]').first()).toBeAttached()
  d = await appearance(page)
  expect(await formatLayerNames(d)).toEqual([
    'Error bars (SD) on Bars (mean)',
    'Bars (mean)',
    'Points (every value)',
  ])
  await d.getByRole('button', { name: 'Cancel' }).click()
  await undo(page)
  d = await appearance(page)
  expect((await formatLayerNames(d)).at(-1)).toBe('Bars (mean)')
  await d.getByRole('button', { name: 'Cancel' }).click()
})

test('Format › Layers and the canvas: select a layer, move, hide and remove it', async ({
  page,
}) => {
  const svg = await openGraph(page, 'getting-started', 'Enzyme activity (scatter)')
  const point = await reachable(pointMarks(svg))
  await point.click({ button: 'right' })
  const ctx = page.getByRole('menu', { name: 'Graph element' })
  await expect(ctx.getByRole('menuitem', { name: 'Hide this layer' })).toBeVisible()
  await ctx.getByRole('menuitem', { name: 'Hide this layer' }).click()
  await expect(pointMarks(svg)).toHaveCount(0)
  await expectUndo(page, 'Hide layer')
  await undo(page)
  await expect(pointMarks(svg).first()).toBeAttached()
  // The Format menu acts on the selected layer.
  await point.click()
  await menu(page, 'Format', 'Layers', 'Delete')
  await expect(pointMarks(svg)).toHaveCount(0)
  await expectUndo(page, 'Delete layer')
  await undo(page)
  await expect(pointMarks(svg).first()).toBeAttached()
})

test('canvas: a click selects a layer’s data set, a second its point; Escape steps back; Alt-click the whole layer', async ({
  page,
}) => {
  const svg = await openGraph(page, 'getting-started', 'Enzyme activity (scatter)')
  const point = await reachable(pointMarks(svg))
  const id = (await point.getAttribute('data-id'))!
  const series = id.slice(0, id.indexOf('/point/'))
  const own = await svg.locator(`path[data-id^="${series}/point/"]`).count()
  const all = await pointMarks(svg).count()
  expect(own).toBeLessThan(all)
  const hint = page.locator('.selection-hint')

  await point.click()
  await expect(hint).toContainText('Data set selected in “Points (every value)”')
  // The halo: that data set's points, not its error bars or the other data set's points.
  await expect(halos(svg)).toHaveCount(own)
  await point.click()
  await expect(hint).toContainText('Data point selected')
  await expect(halos(svg)).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(hint).toContainText('Data set selected in “Points (every value)”')
  await expect(halos(svg)).toHaveCount(own)
  await page.keyboard.press('Escape')
  await expect(hint).not.toContainText('selected')
  await expect(halos(svg)).toHaveCount(0)

  await point.click({ modifiers: ['Alt'] })
  await expect(hint).toContainText('Layer “Points (every value)” selected')
  await expect(halos(svg)).toHaveCount(all)
  // A double-click formats that data set, the part clicked (its symbols) open (roadmap 46).
  await page.keyboard.press('Escape')
  await point.dblclick()
  const d = await inWindow(page, 'Format graph')
  await expect(sectionToggle(d, 'Symbols')).toHaveAttribute('aria-expanded', 'true')
  await expect(seriesPicker(d)).toHaveValue(`dataSet:${series.slice(7)}`)
  await d.getByRole('button', { name: 'Cancel' }).click()
})

test('Duplicate as… makes a copy with other layers', async ({ page }) => {
  const svg = await openGraph(page, 'getting-started', 'Enzyme activity (scatter)')
  await expect(pointMarks(svg).first()).toBeAttached()
  await menu(page, 'Format', 'Duplicate as…')
  const b = dialog(page, 'Duplicate “Enzyme activity (scatter)”')
  await expect(b).toBeVisible()
  await pickPreset(b, 'Bars with points')
  await plotStyle(b, 'Points').click()
  await expect(plotStyle(b, 'Points')).toHaveAttribute('aria-pressed', 'false')
  await b.getByRole('checkbox', { name: /^Put both on a new layout page/ }).uncheck()
  await b.getByLabel('Name of the copy').fill('Enzyme activity (bars)')
  await b.getByRole('button', { name: 'Duplicate', exact: true }).click()
  await expect(b).toBeHidden()
  await expect(sheet(page, 'Enzyme activity (bars)', 'Graphs')).toHaveClass(/\bon\b/)
  await expect(canvas(page).locator('rect[data-id$="/bar"]').first()).toBeAttached()
  await expect(pointMarks(canvas(page))).toHaveCount(0)
  await expectUndo(page, 'Duplicate graph')
  // The original keeps its layers.
  await sheet(page, 'Enzyme activity (scatter)', 'Graphs').click()
  await expect(pointMarks(canvas(page)).first()).toBeAttached()
})

test('Change layers… keeps the formats of the layers that stay', async ({ page }) => {
  const svg = await openGraph(page, 'getting-started', 'Enzyme activity (scatter)')
  // Diamonds for the points.
  const d = await appearance(page)
  await selectLayer(d, /^Points/)
  await section(d, 'Symbols').getByLabel('Shape').selectOption('diamond')
  await d.getByRole('button', { name: 'OK' }).click()
  await expect(d).toBeHidden()
  /** The points' shape, as Format graph shows it. */
  const shape = async () => {
    const f = await appearance(page)
    await selectLayer(f, /^Points/)
    const value = await section(f, 'Symbols').getByLabel('Shape').inputValue()
    await f.getByRole('button', { name: 'Cancel' }).click()
    await expect(f).toBeHidden()
    return value
  }
  expect(await shape()).toBe('diamond')

  await menu(page, 'Format', 'Layers', 'Change layers…')
  const b = dialog(page, 'Change layers of “Enzyme activity (scatter)”')
  await plotStyle(b, 'Bars').click()
  await expect(plotStyle(b, 'Bars')).toHaveAttribute('aria-pressed', 'true')
  await b.getByRole('button', { name: 'OK', exact: true }).click()
  await expect(b).toBeHidden()
  await expect(svg.locator('rect[data-id$="/bar"]').first()).toBeAttached()
  // Bars added (behind the points: a fill); the points are still diamonds.
  expect(await shape()).toBe('diamond')
  await expectUndo(page, 'Change layers')
  await undo(page)
  await expect(svg.locator('rect[data-id$="/bar"]')).toHaveCount(0)
  expect(await shape()).toBe('diamond')
})

test('a heat map from the builder’s frame choices', async ({ page }) => {
  await openExample(page, 'grouped')
  await openSheet(page, 'Genotype × treatment', 'Data Tables')
  const b = await openBuilder(page)
  await plotStyle(b, 'Heat map').click()
  expect(await layerNames(b)).toEqual(['Heat map (cell means)'])
  await expect(plotStyle(b, 'Heat map')).toHaveAttribute('aria-pressed', 'true')
  await expect(builderPreview(b).locator('rect[data-id*="/cell/"]').first()).toBeAttached()
  await b.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(b).toBeHidden()
  await expect(canvas(page).locator('rect[data-id*="/cell/"]').first()).toBeAttached()
})

test('a bubble plot from the builder’s frame choices, its variables mapped', async ({ page }) => {
  await openExample(page, 'multiple-variables')
  await openSheet(page, 'Blood pressure trial', 'Data Tables')
  const b = await openBuilder(page)
  await plotStyle(b, 'Bubbles').click()
  const map = b.getByRole('group', { name: 'Map variables' })
  await expect(map.getByLabel('X', { exact: true })).toBeVisible()
  await expect(map.getByLabel('Size', { exact: true })).toBeVisible()
  await b.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(b).toBeHidden()
  await expect(marks(canvas(page), 'series/').first()).toBeAttached()
})
