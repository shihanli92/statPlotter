import { createWriteStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import type { Download, Locator, Page } from '@playwright/test'
import { expect, test } from './fixtures.ts'
import { answerCellsPrompt, cellsPrompt, grid, runMenu } from './helpers-data.ts'
import { canvas, dialog, openBuilder, openGraph, plotStyle, sheet } from './helpers-graph.ts'

// Large single-cell tables (roadmap 34e): a CSV of 120,000 cells (a Seurat-like export: ids,
// samples, clusters, a clustered UMAP, counts and 20 genes, made here) imported in the
// background with progress and Cancel; its UMAP coloured by cluster drawn as an image on screen;
// hovering a point shows its row; exports are vectors with a notice, or the points as an image.
// (Audit 2, U19: 120,000 rows, not 200,000: still a file of more than 8 MB, the large-file
// dialog's, and more than the 100,000 points whose vector export carries a notice.)

const ROWS = 120_000
const rows = ROWS.toLocaleString('en-US')

/** Writes the CSV (about 15 MB) where the test keeps its files. */
async function writeCells(path: string): Promise<void> {
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
  const centres = Array.from({ length: 12 }, () => [g() * 8, g() * 8])
  const head = ['cell', 'sample', 'cluster', 'UMAP_1', 'UMAP_2', 'nCount_RNA']
  for (let k = 1; k <= 20; k++) head.push(`GENE${k}`)
  out.write(`${head.join(',')}\n`)
  let lines: string[] = []
  for (let r = 0; r < ROWS; r++) {
    const c = Math.min(11, Math.floor(12 * u() ** 1.5))
    const [cx, cy] = centres[c]!
    const row = [
      `cell${r}`,
      `S${1 + Math.floor(u() * 4)}`,
      `C${c}`,
      (cx! + g() * 0.6).toFixed(4),
      (cy! + g() * 0.6).toFixed(4),
      Math.round(Math.exp(7.5 + g() * 0.5)),
    ]
    for (let k = 0; k < 20; k++) row.push(u() < 0.4 ? Number(Math.exp(g()).toFixed(3)) : 0)
    lines.push(row.join(','))
    if (lines.length === 10_000) {
      out.write(`${lines.join('\n')}\n`)
      lines = []
    }
  }
  await new Promise<void>((resolve) => out.end(resolve))
}

test.beforeEach(async ({ page }) => {
  // Downloads rather than Chromium's save picker (which automation can't drive).
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true })
  })
})

/** File › Import data… with the file. */
async function chooseFile(page: Page, path: string): Promise<Locator> {
  const chooser = page.waitForEvent('filechooser')
  await runMenu(page, 'File', 'Import data…')
  await (await chooser).setFiles(path)
  const d = dialog(page, 'Import “cells.csv”')
  await expect(d).toBeVisible()
  return d
}

async function download(page: Page, action: () => Promise<void>) {
  const [d] = await Promise.all([page.waitForEvent('download'), action()])
  return new TextDecoder().decode(await readFile((await (d as Download).path())!))
}

test('a 120,000-row CSV: imported in the background, plotted, hovered and exported', async ({
  page,
}, info) => {
  test.setTimeout(300_000)
  await page.goto('/')
  const path = info.outputPath('cells.csv')
  await writeCells(path)

  // The large-file dialog: the columns read from the start of the file, with their types.
  let d = await chooseFile(page, path)
  await expect(d.getByText(/A large file/)).toBeVisible()
  await expect(d.getByLabel('Type of cluster')).toHaveValue('auto')
  await expect(d.getByLabel('Type of cluster').locator('option').first()).toHaveText(
    'Text (detected)',
  )
  await expect(d.getByLabel('Type of UMAP_1').locator('option').first()).toHaveText(
    'Number (detected)',
  )
  // The cell ids (a value per row) are left out by default, saying why; clusters are kept.
  await expect(d.getByRole('checkbox', { name: 'cell', exact: true })).not.toBeChecked()
  await expect(
    d
      .locator('.large-import-column')
      .filter({ has: page.getByRole('checkbox', { name: 'cell', exact: true }) }),
  ).toContainText(/distinct values in the first [\d,]+ rows: left out \(tick to import\)/)
  await expect(d.getByRole('checkbox', { name: 'cluster', exact: true })).toBeChecked()
  // Cancel stops the import: nothing is added, and it can start again.
  // Clicked in the page as soon as it shows: a fast engine reads the file in under a second.
  const cancelled = await d.evaluate(async (dlg) => {
    const button = (t: string) =>
      [...dlg.querySelectorAll('button')].find((b) => b.textContent === t)
    button('Import')!.click()
    for (let i = 0; i < 2000; i++) {
      const c = button('Cancel import')
      if (c) {
        c.click()
        return true
      }
      await new Promise((r) => setTimeout(r, 1))
    }
    return false
  })
  expect(cancelled).toBe(true)
  await expect(d.getByRole('button', { name: 'Import', exact: true })).toBeEnabled()
  await d.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(d).toBeHidden()
  await expect(sheet(page, 'cells', 'Data Tables')).toHaveCount(0)

  // Imported with a column left out (nCount_RNA): progress, then the table.
  d = await chooseFile(page, path)
  await d.getByRole('checkbox', { name: 'nCount_RNA' }).uncheck()
  await d.getByRole('button', { name: 'Import', exact: true }).click()
  // Read: 120,000 rows, asked whether it is a cells table (decision 456).
  await expect(cellsPrompt(page).getByRole('heading')).toHaveText(
    new RegExp(`^Large table: ${rows} rows × \\d+ variables$`),
    { timeout: 120_000 },
  )
  await answerCellsPrompt(page, true)
  await expect(d).toBeHidden({ timeout: 120_000 })
  await expect(sheet(page, 'cells', 'Data Tables')).toBeVisible()
  await expect(grid(page)).toHaveAccessibleName('cells')

  // UMAP coloured by cluster: the points are one image on screen.
  const b = await openBuilder(page)
  const field = (name: string) =>
    b.getByRole('group', { name: 'Map variables' }).getByLabel(name, { exact: true })
  await field('X').selectOption({ label: 'UMAP_1 (number)' })
  await field('Y').selectOption({ label: 'UMAP_2 (number)' })
  await field('Colour').selectOption({ label: 'cluster (text)' })
  await field('Size').selectOption({ index: 0 })
  // Each cluster's name at its centre.
  await plotStyle(b, 'Group names').click()
  await b.getByRole('button', { name: /^Create/ }).click()
  await expect(b).toBeHidden({ timeout: 60_000 })
  const svg = canvas(page)
  const image = svg.locator('image[data-id^="series/"]')
  await expect(image).toHaveCount(1, { timeout: 60_000 })
  await expect(svg.locator('path[data-id*="/point/"]')).toHaveCount(0)
  await expect(svg.locator('text[data-id*="/centroid/"]')).toHaveCount(12)
  await expect(svg.locator('text[data-id*="/centroid/"]', { hasText: /^C0$/ })).toBeVisible()

  // Hovering a point (found in the cloud's grid) shows its row.
  const box = (await image.boundingBox())!
  const card = page.getByTestId('hover-card')
  let found = false
  for (let i = 1; i < 12 && !found; i++)
    for (let j = 1; j < 12 && !found; j++) {
      await page.mouse.move(box.x + (box.width * i) / 12, box.y + (box.height * j) / 12)
      // A point's card (not a group name's, which has none), once the pointer rests (roadmap 44:
      // cards wait 300 ms).
      found = await card
        .locator('dt', { hasText: /^cluster$/ })
        .waitFor({ timeout: 450 })
        .then(
          () => true,
          () => false,
        )
    }
  expect(found).toBe(true)
  await expect(card.locator('dt', { hasText: /^cluster$/ })).toBeVisible()
  await expect(card.getByRole('button', { name: 'Go to row' })).toBeVisible()
  await page.mouse.move(0, 0)

  // Exports: vectors by default, with a notice; the points as an image when asked.
  const exportDialog = async () => {
    await page
      .getByRole('toolbar', { name: 'Toolbar' })
      .getByRole('button', { name: 'Export…' })
      .click()
    const e = dialog(page, /^Export “/)
    await expect(e).toBeVisible()
    await e.getByRole('radio', { name: 'SVG (vector)' }).check()
    return e
  }
  let e = await exportDialog()
  await e.getByRole('checkbox', { name: 'Points as image' }).uncheck()
  await expect(e.getByRole('note')).toContainText(`${rows} points drawn as vectors`)
  const vector = await download(page, () => e.getByRole('button', { name: 'Export…' }).click())
  expect(vector.match(/<path /g)?.length ?? 0).toBeGreaterThanOrEqual(ROWS)
  expect(vector).not.toContain('<image')

  e = await exportDialog()
  await e.getByRole('checkbox', { name: 'Points as image' }).check()
  await expect(e.getByRole('note')).toHaveCount(0)
  await expect(e.getByLabel('Points’ resolution')).toBeVisible()
  const raster = await download(page, () => e.getByRole('button', { name: 'Export…' }).click())
  expect(raster).toContain('data:image/png;base64,')
  expect(raster.match(/<path /g)?.length ?? 0).toBeLessThan(1000)
  expect(raster.length).toBeLessThan(vector.length / 5)
  // The setting is remembered; reset it for other tests in this browser.
  e = await exportDialog()
  await e.getByRole('checkbox', { name: 'Points as image' }).uncheck()
  await e.getByRole('button', { name: 'Cancel' }).click()
})

test('the single-cell example: its UMAP’s points one image, the clusters named', async ({
  page,
}) => {
  const svg = await openGraph(page, 'single-cell', 'UMAP by cluster')
  await expect(svg.locator('image[data-id^="series/"]')).toHaveCount(1)
  await expect(svg.locator('path[data-id*="/point/"]')).toHaveCount(0)
  await expect(svg.locator('text[data-id*="/centroid/"]')).toHaveCount(10)
})
