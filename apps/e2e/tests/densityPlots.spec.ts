import { createWriteStream } from 'node:fs'
import type { Locator, Page } from '@playwright/test'
import { expect, test } from './fixtures.ts'
import { answerCellsPrompt, grid, runMenu } from './helpers-data.ts'
import {
  addLayer,
  canvas,
  dblclickOn,
  dialog,
  inWindow,
  menu,
  openBuilder,
  openSheet,
  pickPreset,
  plotStyle,
  presets,
  section,
  selectLayer,
  undo,
} from './helpers-graph.ts'

// Cytometry axes and density plots (roadmap 34g) on a cells table of 25,000 cells made here: the
// builder's "Density" chip (hexagons coloured by count, a colour bar), a scatter of two raw
// fluorescence channels on logicle and arcsinh axes (Format axes, with undo), density contours
// added in Format graph and filled (with undo), a UMAP coloured by the cells' local density (the
// builder's checkbox), and the "Dot plot" chip of genes by cluster with its scaling turned off in
// Format graph (with undo). (Audit 2, U19: 25,000 cells, not 50,000: what is drawn is the same
// kind, from half the import's work.)

const ROWS = 25_000

/** A cells CSV: sample, 8 clusters, a UMAP, two channels with negatives, four genes. */
async function writeCells(path: string, rows: number): Promise<void> {
  const out = createWriteStream(path)
  let a = 34
  const u = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const g = () => Math.sqrt(-2 * Math.log(Math.max(u(), 1e-12))) * Math.cos(2 * Math.PI * u())
  const centres = Array.from({ length: 8 }, () => [g() * 6, g() * 6])
  out.write('sample,cluster,UMAP_1,UMAP_2,CD3,CD19,GENE1,GENE2,GENE3,GENE4\n')
  let lines: string[] = []
  for (let r = 0; r < rows; r++) {
    const c = Math.min(7, Math.floor(8 * u() ** 1.2))
    const [cx, cy] = centres[c]!
    const channel = (on: boolean) =>
      on ? Math.round(10 ** (3.4 + g() * 0.25)) : Math.round(g() * 150)
    const gene = (k: number) => (u() < (c % 4 === k ? 0.8 : 0.1) ? Math.exp(g()).toFixed(2) : 0)
    lines.push(
      [
        `S${1 + Math.floor(u() * 3)}`,
        `C${c}`,
        (cx! + g() * 0.7).toFixed(3),
        (cy! + g() * 0.7).toFixed(3),
        channel(c < 4),
        channel(c >= 6),
        gene(0),
        gene(1),
        gene(2),
        gene(3),
      ].join(','),
    )
    if (lines.length === 10_000) {
      out.write(`${lines.join('\n')}\n`)
      lines = []
    }
  }
  if (lines.length) out.write(`${lines.join('\n')}\n`)
  await new Promise<void>((resolve) => out.end(resolve))
}

/** Imports the CSV as a cells table named "cells". */
async function importCells(page: Page, path: string): Promise<void> {
  const chooser = page.waitForEvent('filechooser')
  await runMenu(page, 'File', 'Import data…')
  await (await chooser).setFiles(path)
  const d = dialog(page, 'Import “cells.csv”')
  await expect(d.locator('.import-preview.result')).toContainText(/Multiple variables table/, {
    timeout: 60_000,
  })
  await d.getByLabel('Table name', { exact: true }).fill('cells')
  await d.getByRole('button', { name: 'Import', exact: true }).click()
  await answerCellsPrompt(page, true)
  await expect(d).toBeHidden({ timeout: 60_000 })
  await expect(grid(page)).toHaveAccessibleName('cells')
}

const mapField = (b: Locator, name: string) =>
  b.getByRole('group', { name: 'Map variables' }).getByLabel(name, { exact: true })

/** The ids of an SVG's marks matching a pattern. */
const ids = (svg: Locator, re: RegExp) =>
  svg.evaluate(
    (el, source) =>
      [...el.querySelectorAll('[data-id]')]
        .map((e) => e.getAttribute('data-id') ?? '')
        .filter((id) => new RegExp(source).test(id)),
    re.source,
  )

/** An axis' tick labels as their text (a power's superscript run follows its base: "103"). */
const ticks = (svg: Locator, axis: 'x' | 'y') =>
  svg
    .locator(`[data-id^="axis/${axis}/tickLabel/"]`)
    .evaluateAll((els) => els.map((e) => e.textContent ?? ''))

/** Creates the builder's graph and waits for the canvas to draw marks matching `marks`. */
async function create(page: Page, b: Locator, marks: RegExp): Promise<Locator> {
  await b.getByRole('button', { name: /^Create/ }).click()
  await expect(b).toBeHidden({ timeout: 60_000 })
  const svg = canvas(page)
  await expect
    .poll(async () => (await ids(svg, marks)).length, { timeout: 60_000 })
    .toBeGreaterThan(0)
  return svg
}

test.describe.configure({ timeout: 300_000 })

test('density plots and cytometry axes of a cells table, Format edits with undo', async ({
  page,
}, info) => {
  await page.goto('/')
  const path = info.outputPath('cells.csv')
  await writeCells(path, ROWS)
  await importCells(page, path)

  // The Density chip: hexagons over the first two number variables (the UMAP), a colour bar.
  let b = await openBuilder(page)
  const chips = await presets(b).evaluateAll((els) => els.map((e) => e.textContent?.trim()))
  expect(chips).toEqual(expect.arrayContaining(['Density', 'Dot plot']))
  await pickPreset(b, 'Density')
  await expect(plotStyle(b, 'Hexagons')).toHaveAttribute('aria-pressed', 'true')
  let svg = await create(page, b, /\/hex\/\d+$/)
  expect((await ids(svg, /\/hex\/\d+$/)).length).toBeGreaterThan(30)
  await expect(svg.locator('[data-id^="legend/density/"]').getByText('Count')).toBeVisible()

  // A scatter of two raw channels, then logicle (X) and arcsinh with cofactor 150 (Y) axes.
  await openSheet(page, 'cells', 'Data Tables')
  b = await openBuilder(page)
  await mapField(b, 'X').selectOption({ label: 'CD3 (number)' })
  await mapField(b, 'Y').selectOption({ label: 'CD19 (number)' })
  await mapField(b, 'Colour').selectOption({ label: 'cluster (text)' })
  svg = await create(page, b, /^axis\/x\/tickLabel\//)
  const linear = await ticks(svg, 'x')
  await dblclickOn(svg.locator('[data-id="axis/x/line"]'))
  const d = await inWindow(page, 'Format axes')
  const scale = () => section(d, 'Common').getByLabel('Scale', { exact: true })
  await scale().selectOption('logicle')
  await expect(d.getByLabel('Top of scale (T)', { exact: true })).toHaveValue('262144')
  await d.getByRole('tab', { name: 'Y axis', exact: true }).click()
  await scale().selectOption('arcsinh')
  await d.getByLabel('Typical', { exact: true }).selectOption('150')
  await d.getByRole('button', { name: 'OK', exact: true }).click()
  await expect(d).toBeHidden()
  await expect.poll(() => ticks(svg, 'x')).toEqual(['0', '103', '104', '105'])
  await expect.poll(async () => (await ticks(svg, 'y')).includes('0')).toBe(true)
  expect(await ticks(svg, 'y')).toContain('103')
  await undo(page)
  await expect.poll(() => ticks(svg, 'x')).toEqual(linear)

  // Density contours per cluster added in the graph's list of layers, then filled, each undoable.
  await menu(page, 'Format', 'Format graph…')
  let f = await inWindow(page, 'Format graph')
  await addLayer(section(f, 'Layers'), 'Summaries', 'Density contours')
  await f.getByRole('button', { name: 'OK', exact: true }).click()
  await expect(f).toBeHidden()
  await expect
    .poll(async () => (await ids(svg, /\/contour\/\d+\/\d+\/\d+$/)).length, { timeout: 60_000 })
    .toBeGreaterThan(8)
  await menu(page, 'Format', 'Format graph…')
  f = await inWindow(page, 'Format graph')
  await selectLayer(f, /^Density contours/)
  await section(f, 'Density contours').getByLabel('Draw', { exact: true }).selectOption('bands')
  await f.getByRole('button', { name: 'OK', exact: true }).click()
  await expect(f).toBeHidden()
  await expect.poll(async () => (await ids(svg, /\/band\/\d+\/\d+$/)).length).toBeGreaterThan(3)
  await undo(page)
  await expect.poll(async () => (await ids(svg, /\/band\/\d+\/\d+$/)).length).toBe(0)
  await expect
    .poll(async () => (await ids(svg, /\/contour\/\d+\/\d+\/\d+$/)).length)
    .toBeGreaterThan(8)

  // A UMAP coloured by the cells' local density: a colour bar headed "Density".
  await openSheet(page, 'cells', 'Data Tables')
  b = await openBuilder(page)
  await mapField(b, 'X').selectOption({ label: 'UMAP_1 (number)' })
  await mapField(b, 'Y').selectOption({ label: 'UMAP_2 (number)' })
  await b.getByRole('checkbox', { name: 'Colour the points by their local density' }).check()
  await expect(mapField(b, 'Colour')).toBeDisabled()
  svg = await create(page, b, /^legend\/bubble\/color\/bar\//)
  await expect(
    svg.locator('[data-id^="legend/"]').getByText('Density', { exact: true }),
  ).toBeVisible()

  // The Dot plot chip: genes by cluster, sizes and a colour bar of scaled averages.
  await openSheet(page, 'cells', 'Data Tables')
  b = await openBuilder(page)
  await pickPreset(b, 'Dot plot')
  svg = await create(page, b, /\/dot\/lv_/)
  await expect(svg.getByText('Percent expressed', { exact: true })).toBeVisible()
  await expect(svg.getByText('Average (scaled)', { exact: true })).toBeVisible()
  await menu(page, 'Format', 'Format graph…')
  f = await inWindow(page, 'Format graph')
  await selectLayer(f, /^Dot plot/)
  await section(f, 'Symbols')
    .getByRole('checkbox', { name: /^Scale each variable across the groups/ })
    .uncheck()
  await f.getByRole('button', { name: 'OK', exact: true }).click()
  await expect(f).toBeHidden()
  await expect(svg.getByText('Average', { exact: true })).toBeVisible()
  await undo(page)
  await expect(svg.getByText('Average (scaled)', { exact: true })).toBeVisible()
})
