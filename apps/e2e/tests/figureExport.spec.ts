import { readFile } from 'node:fs/promises'
import type { Download, Locator, Page } from '@playwright/test'
import { strFromU8, unzipSync } from 'fflate'
import { readJpeg, readPng, readTiff } from '../../../packages/graph/test/imageRead.ts'
import { expect, navigator, test } from './fixtures.ts'
import { appMod, canvas, dialog, menu, openGraph, openSheet } from './helpers-graph.ts'

// Figure export and printing (roadmap 27): vector PDF in the browser, TIFF / JPEG / PNG with
// their resolution in the file, widths in mm with the text size kept, a transparent background,
// every graph at once as a zip, and File › Print… setting up the page at the graph's real size.

const GRAPH = { example: 'getting-started', graph: 'Enzyme activity (scatter)' }
const MM = 72 / 25.4

test.beforeEach(async ({ page }) => {
  // Downloads rather than Chromium's save picker (which automation can't drive).
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true })
  })
})

/** Runs `action` and returns the download it starts, with its bytes. */
async function download(page: Page, action: () => Promise<void>) {
  const [d] = await Promise.all([page.waitForEvent('download'), action()])
  const path = await (d as Download).path()
  return { name: d.suggestedFilename(), bytes: new Uint8Array(await readFile(path)) }
}

/** The scene's size in points (the canvas SVG's viewBox). */
async function sceneSize(svg: Locator): Promise<{ w: number; h: number }> {
  const [, , w, h] = (await svg.getAttribute('viewBox'))!.split(' ').map(Number)
  return { w: w!, h: h! }
}

const latin1 = (b: Uint8Array) => Buffer.from(b).toString('latin1')

async function openExportDialog(page: Page, name = GRAPH.graph) {
  await page
    .getByRole('toolbar', { name: 'Toolbar' })
    .getByRole('button', { name: 'Export…' })
    .click()
  return dialog(page, `Export “${name}”`)
}

/** Sets the width box and its unit. */
async function setWidth(d: Locator, value: string, unit: string) {
  await d.getByLabel('Width unit').selectOption(unit)
  const box = d.getByLabel('Width', { exact: true })
  await box.fill(value)
  await box.blur()
}

test('File › Export ▸ PDF… saves a vector PDF in the browser, fonts embedded', async ({ page }) => {
  const svg = await openGraph(page, GRAPH.example, GRAPH.graph)
  const size = await sceneSize(svg)
  const file = await download(page, () => menu(page, 'File', 'Export', 'PDF…'))
  expect(file.name).toBe(`${GRAPH.graph}.pdf`)
  const text = latin1(file.bytes)
  expect(text.startsWith('%PDF-1.7')).toBe(true)
  expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
  const box = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(text)!
  expect(Number(box[1])).toBeCloseTo(size.w, 2)
  expect(Number(box[2])).toBeCloseTo(size.h, 2)
  expect(text).toMatch(/\/BaseFont \/[A-Z]{6}\+LiberationSans/)
  expect(text).toContain('/FontFile2')
  expect(text).toContain('/ToUnicode')
  expect(text).toMatch(/\/Producer <FEFF/)
})

test('Export…: TIFF at 600 dpi, 85 mm wide keeping the text size; the settings remembered', async ({
  page,
}) => {
  const svg = await openGraph(page, GRAPH.example, GRAPH.graph)
  const size = await sceneSize(svg)
  const d = await openExportDialog(page)
  await d.getByRole('radio', { name: 'TIFF (image)' }).check()
  await d.getByRole('button', { name: /^Single column/ }).click()
  await expect(d.getByLabel('Width', { exact: true })).toHaveValue('85')
  await d.getByLabel('Resolution').selectOption({ label: '600 dpi' })
  await expect(d.getByRole('radio', { name: 'Keep text size' })).toBeChecked()
  const summary = d.locator('.export-summary')
  const w = Math.round(85 * MM * (600 / 72))
  await expect(summary).toContainText(`Size: 85 × `)
  await expect(summary).toContainText(`${w.toLocaleString('en-US')} × `)
  // Keeping the text size: the smallest text is the graph's; scaling shrinks it.
  // Measured in the export worker (roadmap 42): read once the summary is the size set.
  const smallest = async () => {
    await expect(summary).toHaveAttribute('aria-busy', 'false')
    return Number(/Smallest text: ([\d.]+) pt/.exec((await summary.textContent()) ?? '')![1])
  }
  const kept = await smallest()
  await d.getByRole('radio', { name: 'Scale everything' }).check()
  const scaled = await smallest()
  expect(scaled).toBeCloseTo((kept * 85 * MM) / size.w, 0)
  await d.getByRole('radio', { name: 'Keep text size' }).check()

  const file = await download(page, () => d.getByRole('button', { name: 'Export…' }).click())
  await expect(d).toBeHidden()
  expect(file.name).toBe(`${GRAPH.graph}.tif`)
  expect([...file.bytes.subarray(0, 4)]).toEqual([0x49, 0x49, 42, 0])
  const tiff = readTiff(file.bytes)
  expect(tiff.width).toBe(w)
  expect(tiff.height).toBeGreaterThan(0)
  expect(tiff.dpi).toEqual({ x: 600, y: 600 })
  expect(tiff.channels).toBe(3)
  // Something drawn: not every pixel white.
  expect(tiff.pixels.some((v) => v < 128)).toBe(true)

  // Remembered for next time.
  const again = await openExportDialog(page)
  await expect(again.getByRole('radio', { name: 'TIFF (image)' })).toBeChecked()
  await expect(again.getByLabel('Width', { exact: true })).toHaveValue('85')
  await expect(again.getByLabel('Resolution')).toHaveValue('600')
})

test('Export…: JPEG with its density; PNG with a transparent background', async ({ page }) => {
  const svg = await openGraph(page, GRAPH.example, GRAPH.graph)
  const size = await sceneSize(svg)
  let d = await openExportDialog(page)
  await d.getByRole('radio', { name: 'JPEG (image)' }).check()
  await expect(d.getByLabel('Transparent background')).toHaveCount(0)
  await d.getByLabel('Resolution').selectOption('custom')
  const custom = d.getByLabel('Dots per inch')
  await custom.fill('200')
  await custom.blur()
  await d.getByLabel('Quality').fill('50')
  const jpg = await download(page, () => d.getByRole('button', { name: 'Export…' }).click())
  expect(jpg.name).toBe(`${GRAPH.graph}.jpg`)
  expect(readJpeg(jpg.bytes)).toEqual({
    width: Math.round((size.w * 200) / 72),
    height: Math.round((size.h * 200) / 72),
    dpi: { x: 200, y: 200 },
    jfif: true,
  })

  d = await openExportDialog(page)
  await d.getByRole('radio', { name: 'PNG (image)' }).check()
  await d.getByLabel('Resolution').selectOption({ label: '150 dpi' })
  await d.getByLabel('Transparent background').check()
  const png = await download(page, () => d.getByRole('button', { name: 'Export…' }).click())
  expect(png.name).toBe(`${GRAPH.graph}.png`)
  const img = readPng(png.bytes)
  expect([img.width, img.height]).toEqual([
    Math.round((size.w * 150) / 72),
    Math.round((size.h * 150) / 72),
  ])
  expect(img.dpi).toEqual({ x: 150, y: 150 })
  expect(img.channels).toBe(4)
  // The corner is empty (transparent); the plot is drawn (opaque pixels).
  expect(img.pixels[3]).toBe(0)
  expect(img.pixels.some((v, i) => i % 4 === 3 && v === 255)).toBe(true)
})

test('figures are made in the export worker, started by the first export (roadmap 42)', async ({
  page,
}) => {
  // The workers the page starts, by script.
  await page.addInitScript(() => {
    const started: string[] = []
    ;(window as unknown as { started: string[] }).started = started
    const Base = window.Worker
    window.Worker = class extends Base {
      constructor(url: string | URL, opts?: WorkerOptions) {
        super(url, opts)
        started.push(String(url))
      }
    }
  })
  const figureWorkers = () =>
    page.evaluate(
      () =>
        (window as unknown as { started: string[] }).started.filter((u) =>
          u.includes('figureExport'),
        ).length,
    )
  await openGraph(page, GRAPH.example, GRAPH.graph)
  expect(await figureWorkers()).toBe(0)
  const pdf = await download(page, () => menu(page, 'File', 'Export', 'PDF…'))
  expect(latin1(pdf.bytes).startsWith('%PDF-')).toBe(true)
  expect(await figureWorkers()).toBe(1)
  // The next export uses the same worker.
  const svg = await download(page, () => menu(page, 'File', 'Export', 'SVG…'))
  expect(Buffer.from(svg.bytes).toString('utf8')).toContain('Enzyme activity')
  expect(await figureWorkers()).toBe(1)
})

test('File › Export ▸ All graphs… saves one zip of every graph', async ({ page }) => {
  await openGraph(page, GRAPH.example, GRAPH.graph)
  const graphs = await navigator(page)
    .locator('.nav-section')
    .filter({ has: page.getByRole('heading', { name: 'Graphs', exact: true }) })
    .locator('.nav-item .name')
    .allTextContents()
  await menu(page, 'File', 'Export', 'All graphs…')
  const d = dialog(page, 'Export all graphs')
  await d.getByRole('radio', { name: 'SVG (vector)' }).check()
  await setWidth(d, '114', 'mm')
  await expect(d.locator('.export-summary')).toContainText(
    `${graphs.length} graphs, each 114 mm wide`,
  )
  const file = await download(page, () => d.getByRole('button', { name: 'Export…' }).click())
  await expect(d).toBeHidden()
  expect(file.name).toBe('Untitled graphs.zip')
  const zip = unzipSync(file.bytes)
  expect(Object.keys(zip).sort()).toEqual(graphs.map((g) => `${g}.svg`).sort())
  for (const data of Object.values(zip)) {
    const w = /width="([\d.]+)pt"/.exec(strFromU8(data))!
    expect(Number(w[1])).toBeCloseTo(114 * MM, 1)
  }
})

test('File › Print… (⌘P) prints the graph at its size; a layout page on its own paper', async ({
  page,
}) => {
  const svg = await openGraph(page, GRAPH.example, GRAPH.graph)
  const size = await sceneSize(svg)
  // Record the call instead of opening the print dialog.
  await page.evaluate(() => {
    ;(window as unknown as { printed: number }).printed = 0
    window.print = () => {
      ;(window as unknown as { printed: number }).printed++
    }
  })
  await page.keyboard.press(`${await appMod(page)}+P`)
  expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1)
  const root = page.locator('.print-root')
  await expect(root).toHaveCount(1)
  const printed = root.locator('svg')
  expect(Number.parseFloat((await printed.getAttribute('width'))!)).toBeCloseTo(size.w, 2)
  expect(await printed.getAttribute('width')).toMatch(/pt$/)
  const rule = await page.locator('#print-page-style').textContent()
  const m = /size: ([\d.]+)pt ([\d.]+)pt; margin: 36pt;/.exec(rule!)!
  expect(Number(m[1])).toBeCloseTo(size.w + 72, 1)
  expect(Number(m[2])).toBeCloseTo(size.h + 72, 1)
  // On paper: only the graph, at its size in points (1/72 in; CSS px are 3/4 of a point).
  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('#root')).toBeHidden()
  await expect(root).toBeVisible()
  const px = await printed.boundingBox()
  expect(px!.width).toBeCloseTo((size.w * 4) / 3, 0)
  await page.emulateMedia({ media: 'screen' })
  await expect(root).toBeHidden()
  // Cleared once printing is over.
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')))
  await expect(root).toHaveCount(0)

  await openSheet(page, 'Figure 1', 'Layouts')
  await menu(page, 'File', 'Print…')
  expect(await page.locator('#print-page-style').textContent()).toBe(
    '@page { size: 792pt 612pt; margin: 0pt; }',
  )
  await expect(page.locator('.print-root svg')).toHaveAttribute('width', '792pt')
  expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(2)
  void canvas
})
