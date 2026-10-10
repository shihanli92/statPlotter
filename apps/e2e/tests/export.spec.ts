import { readFile } from 'node:fs/promises'
import type { Download, Locator, Page } from '@playwright/test'
import { expect, test } from './fixtures.ts'
import { appMod, canvas, dialog, menu, openGraph, openSheet, toast } from './helpers-graph.ts'

// Copy and export (roadmaps 21B, 23): File › Export ▸ SVG / PNG and the Export… dialog save
// downloads of the right size and content; Copy graph puts PNG, SVG and the SVG code on the
// clipboard (read back in Chromium, the one engine that lets a page read it under automation).

const GRAPH = { example: 'getting-started', graph: 'Enzyme activity (scatter)' }

test.beforeEach(async ({ page }) => {
  // Chromium's File System Access save picker can't be driven by automation: without it the web
  // platform falls back to a download (as in WebKit and Firefox).
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true })
  })
})

/** The scene's size in points (the canvas SVG's viewBox). */
async function sceneSize(svg: Locator): Promise<{ w: number; h: number }> {
  const [, , w, h] = (await svg.getAttribute('viewBox'))!.split(' ').map(Number)
  return { w: w!, h: h! }
}

/** The graph's size as the view toolbar shows it, in points ("2.31 × 3.47 in"). */
async function readoutSize(page: Page): Promise<{ w: number; h: number }> {
  const text = (await page.locator('.selection-hint').textContent()) ?? ''
  const m = /(\d+\.\d+) × (\d+\.\d+) in$/.exec(text)!
  return { w: Number(m[1]) * 72, h: Number(m[2]) * 72 }
}

/** Runs `action` and returns the download it starts, with its bytes. */
async function download(page: Page, action: () => Promise<void>) {
  const [d] = await Promise.all([page.waitForEvent('download'), action()])
  const path = await (d as Download).path()
  return { name: d.suggestedFilename(), bytes: await readFile(path) }
}

/** Parses SVG code in the page; returns its root's size attributes and text. */
async function parseSvg(page: Page, code: string) {
  return page.evaluate((text) => {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
    const root = doc.documentElement
    return {
      error: doc.getElementsByTagName('parsererror').length > 0,
      tag: root.tagName,
      width: root.getAttribute('width'),
      height: root.getAttribute('height'),
      viewBox: root.getAttribute('viewBox'),
      text: [...doc.getElementsByTagName('text')].map((t) => t.textContent),
    }
  }, code)
}

/** A PNG's pixel size, from its IHDR chunk. */
function pngSize(bytes: Buffer): { w: number; h: number } {
  expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  expect(bytes.subarray(12, 16).toString('ascii')).toBe('IHDR')
  return { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) }
}

/** Width and height attributes in points ("166.64pt"). */
const pt = (v: string | null) => {
  expect(v).toMatch(/^[\d.]+pt$/)
  return Number(v!.slice(0, -2))
}

test('File › Export ▸ SVG saves the graph at its size, with its text', async ({ page }) => {
  const svg = await openGraph(page, GRAPH.example, GRAPH.graph)
  const size = await sceneSize(svg)
  const shown = await readoutSize(page)
  const file = await download(page, () => menu(page, 'File', 'Export', 'SVG…'))
  expect(file.name).toBe(`${GRAPH.graph}.svg`)
  const parsed = await parseSvg(page, file.bytes.toString('utf8'))
  expect(parsed.error).toBe(false)
  expect(parsed.tag).toBe('svg')
  // The size in points: the scene's, and what the toolbar says (to its 0.01 in).
  expect(pt(parsed.width)).toBeCloseTo(size.w, 1)
  expect(pt(parsed.height)).toBeCloseTo(size.h, 1)
  expect(Math.abs(pt(parsed.width) - shown.w)).toBeLessThanOrEqual(0.36)
  expect(Math.abs(pt(parsed.height) - shown.h)).toBeLessThanOrEqual(0.36)
  expect(parsed.text).toContain('Enzyme activity')
  expect(parsed.text).toContain('Activity (U/mg)')
})

test('File › Export ▸ PNG (300 dpi) saves an image of the graph at 300 dpi', async ({ page }) => {
  const svg = await openGraph(page, GRAPH.example, GRAPH.graph)
  const size = await sceneSize(svg)
  const file = await download(page, () => menu(page, 'File', 'Export', 'PNG (300 dpi)…'))
  expect(file.name).toBe(`${GRAPH.graph}.png`)
  expect(pngSize(file.bytes)).toEqual({
    w: Math.round((size.w * 300) / 72),
    h: Math.round((size.h * 300) / 72),
  })
})

test('the Export… dialog saves a PNG at the chosen resolution, or an SVG', async ({ page }) => {
  const svg = await openGraph(page, GRAPH.example, GRAPH.graph)
  const size = await sceneSize(svg)
  const exportButton = page
    .getByRole('toolbar', { name: 'Toolbar' })
    .getByRole('button', { name: 'Export…' })
  await exportButton.click()
  const d = dialog(page, `Export “${GRAPH.graph}”`)
  await d.getByRole('radio', { name: 'PNG (image)' }).check()
  await d.getByLabel('Resolution').selectOption({ label: '150 dpi' })
  const png = await download(page, () => d.getByRole('button', { name: 'Export…' }).click())
  await expect(d).toBeHidden()
  expect(png.name).toBe(`${GRAPH.graph}.png`)
  expect(pngSize(png.bytes)).toEqual({
    w: Math.round((size.w * 150) / 72),
    h: Math.round((size.h * 150) / 72),
  })

  await exportButton.click()
  await d.getByRole('radio', { name: 'SVG (vector)' }).check()
  await expect(d.getByLabel('Resolution')).toHaveCount(0)
  const vector = await download(page, () => d.getByRole('button', { name: 'Export…' }).click())
  expect(vector.name).toBe(`${GRAPH.graph}.svg`)
  expect(pt((await parseSvg(page, vector.bytes.toString('utf8'))).width)).toBeCloseTo(size.w, 1)
})

test('a layout page exports as an SVG of the page', async ({ page }) => {
  await openGraph(page, GRAPH.example, GRAPH.graph)
  await openSheet(page, 'Figure 1', 'Layouts')
  const file = await download(page, () => menu(page, 'File', 'Export', 'SVG…'))
  expect(file.name).toBe('Figure 1.svg')
  const parsed = await parseSvg(page, file.bytes.toString('utf8'))
  expect(parsed.error).toBe(false)
  // US Letter, landscape.
  expect(pt(parsed.width)).toBeCloseTo(792, 1)
  expect(pt(parsed.height)).toBeCloseTo(612, 1)
  expect(parsed.text).toContain('Enzyme activity')
})

test('Copy graph puts PNG, SVG and the SVG code on the clipboard', async ({
  page,
  browserName,
  context,
}) => {
  test.skip(
    browserName !== 'chromium',
    'Only Chromium lets a page read the clipboard back under automation (clipboard-read permission); layouts.spec.ts covers copying in WebKit and Firefox',
  )
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const svg = await openGraph(page, GRAPH.example, GRAPH.graph)
  const size = await sceneSize(svg)
  await canvas(page).click({ position: { x: 2, y: 2 } })
  await page.keyboard.press(`${await appMod(page)}+Shift+C`)
  await expect(toast(page)).toHaveText(
    /^Copied “Enzyme activity \(scatter\)” as vector \(SVG\) and image \(PNG\)\./,
  )
  const clip = await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read()
    const read = async (type: string) => (item!.types.includes(type) ? item!.getType(type) : null)
    const png = await read('image/png')
    const bytes = png ? [...new Uint8Array(await png.arrayBuffer()).subarray(0, 24)] : null
    return {
      types: item!.types,
      text: await (await read('text/plain'))?.text(),
      svg: await (await read('image/svg+xml'))?.text(),
      png: bytes,
    }
  })
  expect(clip.types).toEqual(expect.arrayContaining(['image/png', 'text/plain', 'image/svg+xml']))
  const parsed = await parseSvg(page, clip.text!)
  expect(parsed.error).toBe(false)
  expect(pt(parsed.width)).toBeCloseTo(size.w, 1)
  expect(pt(parsed.height)).toBeCloseTo(size.h, 1)
  expect(parsed.text).toContain('Enzyme activity')
  expect((await parseSvg(page, clip.svg!)).error).toBe(false)
  // The PNG at 300 dpi.
  expect(pngSize(Buffer.from(clip.png!))).toEqual({
    w: Math.round((size.w * 300) / 72),
    h: Math.round((size.h * 300) / 72),
  })
})
