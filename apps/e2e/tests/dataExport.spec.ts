import { readFile } from 'node:fs/promises'
import type { Download, Page } from '@playwright/test'
import { readXlsx } from '../../../packages/io/src/import/xlsx.ts'
import { expect, openExample, test } from './fixtures.ts'
import { cell, grid, menuItem, menuPanel, runMenu, toast } from './helpers-data.ts'
import { dialog, menu, openSheet } from './helpers-graph.ts'

// Data and results out (roadmap 26): data tables, results sheets, a figure's source data and the
// whole project as CSV / Excel downloads; copies of cells and results as text and HTML tables.

const EXAMPLE = 'getting-started'
const TABLE = 'Enzyme activity'
const RESULTS = 'Unpaired t test'

test.beforeEach(async ({ page }) => {
  // Chromium's save picker can't be driven by automation: without it the web platform downloads
  // (as in WebKit and Firefox).
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true })
  })
})

/** Runs `action` and returns the download it starts: its name and bytes. */
async function download(page: Page, action: () => Promise<void>) {
  const [d] = await Promise.all([page.waitForEvent('download'), action()])
  const path = await (d as Download).path()
  return { name: d.suggestedFilename(), bytes: await readFile(path) }
}

/** A CSV file's text: a byte-order mark first, CRLF line ends; rows split at commas. */
function csvRows(bytes: Buffer): string[][] {
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
  const text = bytes.subarray(3).toString('utf8')
  expect(text.endsWith('\r\n')).toBe(true)
  return text
    .slice(0, -2)
    .split('\r\n')
    .map((l) => l.split(','))
}

/** The tab titles of the results view. */
const tabs = (page: Page) => page.getByRole('main').getByRole('tab').allTextContents()

test('a data table exports as CSV and as Excel, excluded values kept or left blank', async ({
  page,
}) => {
  await openExample(page, EXAMPLE)
  await openSheet(page, TABLE, 'Data Tables')
  const first = await cell(page, 0, 0).textContent()

  const csv = await download(page, () => menu(page, 'File', 'Export', 'CSV…'))
  expect(csv.name).toBe(`${TABLE}.csv`)
  const rows = csvRows(csv.bytes)
  expect(rows[0]).toEqual(['Control', 'Treated'])
  expect(rows[1]![0]).toBe(first)
  expect(rows).toHaveLength(11)

  // Exclude the first value, then Export… with it left blank.
  await cell(page, 0, 0).click()
  await runMenu(page, 'Edit', 'Exclude / include values')
  await page
    .getByRole('toolbar', { name: 'Toolbar' })
    .getByRole('button', { name: 'Export…' })
    .click()
  const d = dialog(page, `Export “${TABLE}”`)
  await d.getByRole('radio', { name: 'Excel workbook (.xlsx)' }).check()
  await d.getByRole('radio', { name: 'Leave them blank' }).check()
  const xlsx = await download(page, () => d.getByRole('button', { name: 'Export…' }).click())
  expect(xlsx.name).toBe(`${TABLE}.xlsx`)
  const [sheet] = readXlsx(new Uint8Array(xlsx.bytes))
  expect(sheet!.name).toBe(TABLE)
  expect(sheet!.rows[0]).toEqual(['Control', 'Treated'])
  expect(sheet!.rows[1]![0]).toBeNull()
  expect(sheet!.rows[2]![0]).toBe(Number(await cell(page, 1, 0).textContent()))
})

test('a results sheet exports as CSV; all results as one workbook', async ({ page }) => {
  await openExample(page, EXAMPLE)
  await openSheet(page, RESULTS, 'Results')
  const csv = await download(page, () => menu(page, 'File', 'Export', 'CSV…'))
  // Named after the analysis and the sheet shown, whose heading comes first.
  expect(csv.name).toMatch(new RegExp(`^${RESULTS} – .+\\.csv$`))
  const rows = csvRows(csv.bytes)
  expect(rows[0]![0]).toBe(csv.name.slice(0, -4))
  // As displayed: the P value as the view shows it.
  const p = await page
    .getByRole('main')
    .getByRole('row', { name: /^P value / })
    .first()
    .getByRole('cell')
    .first()
    .textContent()
  expect(rows).toContainEqual(['P value', p])

  const all = await download(page, () => menu(page, 'File', 'Export', 'All results (Excel)…'))
  expect(all.name).toBe(`${RESULTS}.xlsx`)
  const sheets = readXlsx(new Uint8Array(all.bytes))
  // A worksheet per tab (the view shows tabs when there are several).
  const titles = await tabs(page)
  expect(sheets.map((s) => s.name)).toEqual(titles.length ? titles : [sheets[0]!.name])
  for (const s of sheets) expect(s.rows[0]![0]).toBe(`${RESULTS} – ${s.name}`)
})

test('source data of a graph and of a layout page', async ({ page }) => {
  await openExample(page, EXAMPLE)
  await openSheet(page, 'Enzyme activity (scatter)', 'Graphs')
  const graph = await download(page, () => menu(page, 'File', 'Export', 'Source data (Excel)…'))
  expect(graph.name).toBe('Enzyme activity (scatter) source data.xlsx')
  const [sheet] = readXlsx(new Uint8Array(graph.bytes))
  const firsts = sheet!.rows.map((r) => r[0])
  expect(firsts).toContain(`Data: ${TABLE}`)
  expect(firsts.some((v) => typeof v === 'string' && v.startsWith(`Results: ${RESULTS} – `))).toBe(
    true,
  )

  await openSheet(page, 'Figure 1', 'Layouts')
  const layout = await download(page, () => menu(page, 'File', 'Export', 'Source data (Excel)…'))
  expect(layout.name).toBe('Figure 1 source data.xlsx')
  const panels = readXlsx(new Uint8Array(layout.bytes))
  expect(panels.map((s) => s.name)).toEqual(['A', 'B', 'C'])
  expect(panels[0]!.rows[0]![0]).toBe('A: Enzyme activity (scatter)')
})

test('all data and results: a contents sheet, then every table and results sheet', async ({
  page,
}) => {
  await openExample(page, EXAMPLE)
  const file = await download(page, () => menu(page, 'File', 'Export', 'All data and results…'))
  expect(file.name).toBe('Untitled data and results.xlsx')
  const sheets = readXlsx(new Uint8Array(file.bytes))
  expect(sheets[0]!.name).toBe('Contents')
  const names = sheets.map((s) => s.name)
  expect(names).toContain(TABLE)
  expect(names.some((n) => n.startsWith(`${RESULTS} – `))).toBe(true)
  // The contents list every other sheet (full names, which may be longer than a sheet name).
  const listed = sheets[0]!.rows.slice(3).filter((r) => r[1] !== 'Results (not calculated yet)')
  expect(listed).toHaveLength(sheets.length - 1)
})

/**
 * Records what copies put on the clipboard through copy events (`setData`), in any browser: the
 * copy-event route menu commands take first.
 */
async function recordCopies(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { copied: Record<string, string> }
    w.copied = {}
    const set = DataTransfer.prototype.setData
    DataTransfer.prototype.setData = function (type: string, data: string) {
      w.copied[type] = data
      return set.call(this, type, data)
    }
  })
}
const copied = (page: Page) =>
  page.evaluate(() => (window as unknown as { copied: Record<string, string> }).copied)

test('Edit › Copy with titles and results Copy put text and an HTML table on the clipboard', async ({
  page,
}) => {
  await recordCopies(page)
  await openExample(page, EXAMPLE)
  await openSheet(page, TABLE, 'Data Tables')
  await cell(page, 0, 0).click()
  await runMenu(page, 'Edit', 'Copy with titles')
  await expect
    .poll(async () => (await copied(page))['text/plain']?.split('\n')[0])
    .toBe('Control\tTreated')
  const table = await copied(page)
  expect(table['text/html']).toMatch(/^<html>.*<table.*>Control<\/th>/)

  await openSheet(page, RESULTS, 'Results')
  await page
    .getByRole('main')
    .getByRole('rowheader', { name: 'P value', exact: true })
    .first()
    .click()
  await runMenu(page, 'Edit', 'Copy')
  await expect.poll(async () => (await copied(page))['text/plain']).toMatch(/\nP value\t/)
  expect((await copied(page))['text/html']).toContain('>P value</td>')
  await expect(toast(page)).toHaveCount(0)
})

test.describe('the system clipboard (Chromium)', () => {
  test.beforeEach(async ({ browserName, context }) => {
    test.skip(
      browserName !== 'chromium',
      'Only Chromium lets a page read the clipboard back under automation',
    )
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  })

  /** The clipboard's item: its types, text and HTML. */
  const clipboard = (page: Page) =>
    page.evaluate(async () => {
      const [item] = await navigator.clipboard.read()
      const read = async (t: string) =>
        item!.types.includes(t) ? (await item!.getType(t)).text() : null
      return { types: item!.types, text: await read('text/plain'), html: await read('text/html') }
    })

  test('⌘C on cells: values as text, and an HTML table', async ({ page }) => {
    await openExample(page, EXAMPLE)
    await openSheet(page, TABLE, 'Data Tables')
    await cell(page, 0, 0).click()
    await cell(page, 1, 1).click({ modifiers: ['Shift'] })
    await page.keyboard.press('ControlOrMeta+C')
    const texts = [
      [await cell(page, 0, 0).textContent(), await cell(page, 0, 1).textContent()],
      [await cell(page, 1, 0).textContent(), await cell(page, 1, 1).textContent()],
    ]
    await expect
      .poll(async () => (await clipboard(page)).text)
      .toBe(texts.map((r) => r.join('\t')).join('\n'))
    const clip = await clipboard(page)
    expect(clip.types).toEqual(expect.arrayContaining(['text/plain', 'text/html']))
    expect(clip.html).toContain('<table')
    expect(clip.html).toContain(`>${texts[1]![1]}</td>`)
    // Pasting back in the grid gives the same values.
    await cell(page, 5, 0).click()
    await page.keyboard.press('ControlOrMeta+V')
    await expect(cell(page, 5, 0)).toHaveText(texts[0]![0]!)
    await expect(cell(page, 6, 1)).toHaveText(texts[1]![1]!)
    await expect(grid(page)).toBeVisible()
  })

  test('results: ⌘C copies the sheet; right-click › Copy table one block', async ({ page }) => {
    await openExample(page, EXAMPLE)
    await openSheet(page, RESULTS, 'Results')
    const main = page.getByRole('main')
    await main.getByRole('rowheader', { name: 'P value', exact: true }).first().click()
    await page.keyboard.press('ControlOrMeta+C')
    await expect.poll(async () => (await clipboard(page)).text).toMatch(/\nP value\t/)
    const sheet = await clipboard(page)
    expect(sheet.html).toContain('<table')

    const blocks = main.locator('.sheet > .block')
    const count = await blocks.count()
    await blocks.last().locator('table').click({ button: 'right' })
    await menuItem(menuPanel(page, 'Results'), 'Copy table').click()
    await expect.poll(async () => (await clipboard(page)).html?.split('<table').length).toBe(2)
    expect(count).toBeGreaterThan(1)
  })
})
