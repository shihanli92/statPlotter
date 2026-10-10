import { createWriteStream } from 'node:fs'
import type { Locator, Page } from '@playwright/test'
import { expect, test } from './fixtures.ts'
import { answerCellsPrompt, grid, runMenu } from './helpers-data.ts'
import {
  canvas,
  dialog,
  openBuilder,
  openSheet,
  pickPreset,
  plotStyle,
  presets,
  undo,
  undoButton,
} from './helpers-graph.ts'

// Cells tables (roadmap 34f): a single-cell table of 25,000 cells (made here) imported as a cells
// table, whose graph builder offers only what scales (a swarm's chip and icon disabled, saying
// why), draws its preview from a sample of the rows, takes plot styles clicked in quick succession
// at once (laying out only the last), makes histograms of a variable by group, and colours 14
// clusters with 14 colours in natural order (C0, C1 … C13). The table's setting and the import
// dialogs' checkbox turn it on and off.
//
// Audit 2 (U19): the tables are as small as what they show allows (more rows than the preview's
// sample of 5,000, and so than a crowded swarm placed point by point, 1,000 since decision 750:
// `SWARM_MAX_POINTS`; the wide table more than 1,000 rows per column on screen
// and 20 variables previewed), and nothing is bounded by the clock (CLAUDE.md, Tests): that the
// preview's cost doesn't grow with the rows is a CPU-time guard in `ui/test/cellsBuilder.test.ts`.

const ROWS = 25_000
const WIDE_ROWS = 10_000
const wideRows = WIDE_ROWS.toLocaleString('en-US')
const CELLS = 'Cells table (single-cell / cytometry)'

/** A Seurat-like CSV of `rows` cells: samples, 14 clusters (first seen in no order), a UMAP. */
async function writeCells(path: string, rows: number, genes = 3): Promise<void> {
  const out = createWriteStream(path)
  let a = 7
  const u = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const g = () => Math.sqrt(-2 * Math.log(Math.max(u(), 1e-12))) * Math.cos(2 * Math.PI * u())
  const centres = Array.from({ length: 14 }, () => [g() * 8, g() * 8])
  const head = ['sample', 'cluster', 'UMAP_1', 'UMAP_2', 'nCount_RNA']
  for (let k = 1; k <= genes; k++) head.push(`GENE${k}`)
  out.write(`${head.join(',')}\n`)
  let lines: string[] = []
  for (let r = 0; r < rows; r++) {
    const c = Math.min(13, Math.floor(14 * u() ** 1.3))
    const [cx, cy] = centres[c]!
    const row = [
      `S${1 + Math.floor(u() * 4)}`,
      `C${c}`,
      (cx! + g() * 0.6).toFixed(3),
      (cy! + g() * 0.6).toFixed(3),
      Math.round(Math.exp(7.5 + g() * 0.5)),
    ]
    for (let k = 0; k < genes; k++) row.push(u() < 0.4 ? Number(Math.exp(g()).toFixed(2)) : 0)
    lines.push(row.join(','))
    if (lines.length === 10_000) {
      out.write(`${lines.join('\n')}\n`)
      lines = []
    }
  }
  if (lines.length) out.write(`${lines.join('\n')}\n`)
  await new Promise<void>((resolve) => out.end(resolve))
}

/** A CSV of `rows` rows × `cols` number variables (small integers: under 8 MB) and a cluster. */
async function writeWide(path: string, rows: number, cols: number): Promise<void> {
  const out = createWriteStream(path)
  out.write(`cluster,${Array.from({ length: cols }, (_, k) => `G${k + 1}`).join(',')}\n`)
  let a = 11
  let lines: string[] = []
  for (let r = 0; r < rows; r++) {
    const row = [`C${r % 7}`]
    for (let k = 0; k < cols; k++) {
      a = (Math.imul(a, 1103515245) + 12345) >>> 0
      row.push(String(k + (a % 97)))
    }
    lines.push(row.join(','))
    if (lines.length === 5000) {
      out.write(`${lines.join('\n')}\n`)
      lines = []
    }
  }
  if (lines.length) out.write(`${lines.join('\n')}\n`)
  await new Promise<void>((resolve) => out.end(resolve))
}

/** File › Import data… with the file; the import dialog. */
async function chooseFile(page: Page, path: string, name: string): Promise<Locator> {
  const chooser = page.waitForEvent('filechooser')
  await runMenu(page, 'File', 'Import data…')
  await (await chooser).setFiles(path)
  const d = dialog(page, `Import “${name}”`)
  await expect(d).toBeVisible()
  return d
}

/** Imports the cells as a multiple-variables table, as a cells table or not. */
async function importCells(
  page: Page,
  path: string,
  cells: boolean,
  name = 'cells',
): Promise<void> {
  const d = await chooseFile(page, path, `${name}.csv`)
  await expect(d.locator('.import-preview.result')).toContainText(/Multiple variables table/, {
    timeout: 60_000,
  })
  // More than 5,000 rows: no checkbox, the popup on Import asks (decision 456).
  await expect(d.getByRole('checkbox', { name: /^Treat as a cells table/ })).toHaveCount(0)
  await d.getByLabel('Table name', { exact: true }).fill(name)
  await d.getByRole('button', { name: 'Import', exact: true }).click()
  await answerCellsPrompt(page, cells)
  await expect(d).toBeHidden({ timeout: 60_000 })
  await expect(grid(page)).toHaveAccessibleName(name)
}

const tableBox = (page: Page) => page.getByRole('main').getByRole('checkbox', { name: CELLS })
const chip = (b: Locator, name: string) =>
  presets(b).and(b.getByRole('radio', { name, exact: true }))
const mapField = (b: Locator, name: string) =>
  b.getByRole('group', { name: 'Map variables' }).getByLabel(name, { exact: true })

/** The legend's colour levels: their names and swatches' colours, in order. */
async function legendLevels(svg: Locator): Promise<{ names: string[]; colours: string[] }> {
  return svg.evaluate((s) => {
    const entries = [...s.querySelectorAll('[data-id^="legend/"]')]
    const of = (suffix: string) =>
      entries
        .filter((e) => /^legend\/[^/]+\/color\/\d+\//.test(e.getAttribute('data-id') ?? ''))
        .filter((e) => e.getAttribute('data-id')!.endsWith(suffix))
    return {
      names: of('/label').map((e) => e.textContent ?? ''),
      colours: of('/swatch').map(
        (e) => (e.matches('rect') ? e : e.querySelector('rect'))?.getAttribute('fill') ?? '',
      ),
    }
  })
}

test.describe.configure({ timeout: 300_000 })

test('a cells table’s builder: only what scales, a sampled preview, quick clicks, histograms', async ({
  page,
}, info) => {
  await page.goto('/')
  const path = info.outputPath('cells.csv')
  await writeCells(path, ROWS)
  await importCells(page, path, true)
  await expect(tableBox(page)).toBeChecked()

  // The builder starts as a UMAP-like XY graph, its preview a sample of the rows.
  let b = await openBuilder(page)
  await expect(b.getByText(`Preview of 5,000 of ${ROWS.toLocaleString('en-US')} rows`)).toBeVisible(
    {
      timeout: 60_000,
    },
  )
  await expect(plotStyle(b, 'Bubbles')).toHaveAttribute('aria-pressed', 'true')
  // The swarm's chip is disabled and says why; violins by group are offered.
  const swarm = chip(b, 'Box with points by group')
  await expect(swarm).toHaveAttribute('aria-disabled', 'true')
  await expect(swarm).toHaveAccessibleDescription(
    `${ROWS.toLocaleString('en-US')} rows: too many points for a swarm. Use a violin or box.`,
  )
  // (Clicked as a user would: Playwright won't click an element marked disabled.)
  await swarm.dispatchEvent('click')
  await expect(swarm).toHaveAttribute('aria-checked', 'false')
  await pickPreset(b, 'Violin by group')
  const points = plotStyle(b, 'Points')
  await expect(points).toHaveAttribute('aria-disabled', 'true')
  await expect(points).toHaveAccessibleDescription(/too many points for a swarm/)
  await expect(plotStyle(b, 'Violin')).toHaveAttribute('aria-pressed', 'true')

  // Clicking across plot styles quickly: every click takes at once, the preview follows the last.
  await mapField(b, 'X').selectOption({ label: 'UMAP_1 (number)' })
  await expect(plotStyle(b, 'Bubbles')).toHaveAttribute('aria-pressed', 'true')
  const clicks = ['Histogram', 'Bubbles', 'Columns', 'Histogram', 'Bubbles', 'Columns']
  const seen = await b.evaluate(async (dlg, labels) => {
    const icon = (label: string) =>
      [...dlg.querySelectorAll<HTMLButtonElement>('.builder-styles button')].find(
        (x) => x.getAttribute('aria-label') === label,
      )!
    const preview = dlg.querySelector('section.builder-preview')
    const out: string[] = []
    for (const label of [...labels, ...labels]) {
      icon(label).click()
      // Well inside the preview's wait for the next change (PREVIEW_DELAY, 120 ms): timers run
      // in the order they fall due, so this one runs first however busy the machine.
      await new Promise((r) => setTimeout(r, 10))
      out.push(`${icon(label).getAttribute('aria-pressed')} ${preview?.getAttribute('aria-busy')}`)
    }
    return out
  }, clicks)
  // Each click took at once (its icon pressed), and none laid the preview out (still waiting).
  expect(seen).toEqual(Array(clicks.length * 2).fill('true true'))
  await expect(plotStyle(b, 'Columns')).toHaveAttribute('aria-pressed', 'true')
  const preview = b.getByRole('region', { name: 'Preview' })
  await expect(preview).toHaveAttribute('aria-busy', 'false', { timeout: 60_000 })
  await expect(b.getByRole('img', { name: /^Preview: Box/ })).toBeVisible()

  // A histogram of a variable, stacked by sample.
  await plotStyle(b, 'Histogram').click()
  await expect(plotStyle(b, 'Histogram')).toHaveAttribute('aria-pressed', 'true')
  await mapField(b, 'X').selectOption({ label: 'nCount_RNA (number)' })
  await mapField(b, 'Colour').selectOption({ label: 'sample (text)' })
  await mapField(b, 'Groups').selectOption({ label: 'Stacked' })
  await b.getByRole('button', { name: /^Create/ }).click()
  await expect(b).toBeHidden({ timeout: 60_000 })
  let svg = canvas(page)
  await expect(svg.locator('rect[data-id^="series/"]').first()).toBeVisible({ timeout: 60_000 })
  expect(await svg.locator('rect[data-id^="series/"]').count()).toBeGreaterThan(8)
  await expect(svg.locator('[data-id^="legend/"]').getByText('S1', { exact: true })).toBeVisible()
  await expect(svg.locator('[data-id^="legend/"]').getByText('S4', { exact: true })).toBeVisible()

  // A UMAP of the 14 clusters: 14 colours, in natural order.
  await openSheet(page, 'cells', 'Data Tables')
  b = await openBuilder(page)
  await mapField(b, 'X').selectOption({ label: 'UMAP_1 (number)' })
  await mapField(b, 'Y').selectOption({ label: 'UMAP_2 (number)' })
  await mapField(b, 'Colour').selectOption({ label: 'cluster (text)' })
  await b.getByRole('button', { name: /^Create/ }).click()
  await expect(b).toBeHidden({ timeout: 60_000 })
  svg = canvas(page)
  await expect(svg.locator('[data-id^="legend/"]').getByText('C13', { exact: true })).toBeVisible({
    timeout: 60_000,
  })
  const legend = await legendLevels(svg)
  expect(legend.names).toEqual(Array.from({ length: 14 }, (_, i) => `C${i}`))
  expect(new Set(legend.colours.map((c) => c.toLowerCase())).size).toBe(14)
})

test('the cells-table setting: the table view’s checkbox and View menu, with undo', async ({
  page,
}, info) => {
  await page.goto('/')
  const path = info.outputPath('cells.csv')
  await writeCells(path, 25_000, 1)
  await importCells(page, path, true)
  await expect(tableBox(page)).toBeChecked()
  await tableBox(page).uncheck()
  await expect(undoButton(page)).toHaveAccessibleName('Undo Not a cells table')
  await page.getByRole('menubar').getByRole('menuitem', { name: 'View', exact: true }).click()
  const item = page
    .getByRole('menu', { name: 'View' })
    .getByRole('menuitemcheckbox', { name: CELLS })
  await expect(item).toHaveAttribute('aria-checked', 'false')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')

  // Not a cells table: the swarm's chip is offered.
  let b = await openBuilder(page)
  await expect(chip(b, 'Box with points by group')).not.toHaveAttribute('aria-disabled', 'true')
  await expect(chip(b, 'Violin by group')).toHaveCount(0)
  await b.getByRole('button', { name: 'Cancel' }).click()
  await expect(b).toBeHidden()

  // The View menu turns it back on; undo turns it off.
  await runMenu(page, 'View', CELLS)
  await expect(tableBox(page)).toBeChecked()
  await undo(page)
  await expect(tableBox(page)).not.toBeChecked()
  await undo(page)
  await expect(tableBox(page)).toBeChecked()
  b = await openBuilder(page)
  await expect(chip(b, 'Box with points by group')).toHaveAttribute('aria-disabled', 'true')
  await b.getByRole('button', { name: 'Cancel' }).click()
})

test('the import dialogs ask: an ordinary table when told; large CSVs once read', async ({
  page,
}, info) => {
  await page.goto('/')
  const path = info.outputPath('cells.csv')
  await writeCells(path, 25_000, 1)
  await importCells(page, path, false)
  await expect(tableBox(page)).not.toBeChecked()

  // A file of 8 MB or more opens the large-file dialog: no checkbox, it asks once read.
  const big = info.outputPath('big.csv')
  await writeCells(big, 160_000, 12)
  const d = await chooseFile(page, big, 'big.csv')
  await expect(d.getByText(/A large file/)).toBeVisible()
  await expect(d.getByRole('checkbox', { name: /^Treat as a cells table/ })).toHaveCount(0)
  await expect(
    d.getByText(/more than 5,000 rows asks, once read, whether it is a cells/),
  ).toBeVisible()
  await d.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(d).toBeHidden()
})

test('a wide table’s Columns: bounded previews, 1,000 points per column on screen, clouds', async ({
  page,
}, info) => {
  // Decisions 450–453: rows × 60 number variables, an ordinary table (as the user's single-cell
  // export of 30,000 rows imports): "Columns" draws every variable's points. That the work stays
  // bounded is shown by what is drawn (previews of a sample, clouds as images), not by the clock.
  await page.goto('/')
  const path = info.outputPath('wide.csv')
  await writeWide(path, WIDE_ROWS, 60)
  await importCells(page, path, false, 'wide')
  await expect(tableBox(page)).not.toBeChecked()

  // Quick clicks across plot styles: the page stays responsive, the preview bounded and saying so.
  const b = await openBuilder(page)
  await expect(b.locator('.builder-preview-note')).toBeVisible({ timeout: 60_000 })
  await b.evaluate(async (dlg) => {
    const icon = (label: string) =>
      [...dlg.querySelectorAll<HTMLButtonElement>('.builder-styles button')].find(
        (x) => x.getAttribute('aria-label') === label,
      )!
    for (const label of ['Columns', 'Box', 'Violin', 'Box', 'Violin', 'Heat map', 'Columns']) {
      icon(label).click()
      await new Promise((r) => setTimeout(r, 30))
    }
  })
  await expect(plotStyle(b, 'Columns')).toHaveAttribute('aria-pressed', 'true')
  const preview = b.getByRole('region', { name: 'Preview' })
  await expect(preview).toHaveAttribute('aria-busy', 'false', { timeout: 60_000 })
  await expect(b.locator('.builder-preview-note')).toHaveText(
    `Preview of 20 of 60 variables, 5,000 of ${wideRows} rows`,
  )
  expect(await preview.locator('path').count()).toBeLessThan(8000)

  // The graph made: every variable, at most 1,000 points per column on screen, as images.
  await b.getByRole('button', { name: /^Create/ }).click()
  await expect(b).toBeHidden({ timeout: 60_000 })
  const svg = canvas(page)
  const note = page.getByRole('main').locator('.screen-sample-note')
  await expect(note).toContainText(
    `Showing 1,000 of ${wideRows} points per column on screen; exports and statistics use all`,
    { timeout: 60_000 },
  )
  await expect(svg.locator('image')).toHaveCount(60)
  expect(await svg.locator('path[data-id*="/point/"]').count()).toBe(0)
  // A hovered point is a row of the table; the column's mean and SD are of every row.
  const card = page.locator('.hover-card')
  const box = (await svg.locator('image').first().boundingBox())!
  // Once the pointer rests on a mark (roadmap 44: cards wait 300 ms).
  const cardText = async () => {
    await card.waitFor({ timeout: 450 }).catch(() => {})
    return (await card.count()) ? ((await card.textContent()) ?? '') : ''
  }
  let sawRow = false
  let sawAll = false
  for (let i = 0; i < 40 && !(sawRow && sawAll); i++) {
    const [fx, fy] = [0.1 + ((i * 0.37) % 0.8), 0.15 + ((i * 0.23) % 0.7)]
    await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy)
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    const text = await cardText()
    if (/Row \d+/.test(text)) sawRow = true
    if (new RegExp(`n\\s*${wideRows.replace(',', ',?')}`).test(text)) sawAll = true
    if (!sawRow) {
      await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy)
      if (/Row \d+/.test(await cardText())) sawRow = true
    }
  }
  expect(sawRow).toBe(true)
  expect(sawAll).toBe(true)

  // Every point on screen, by choice, and back.
  await note.getByRole('button', { name: 'Show all on screen' }).click()
  await expect(note.getByRole('button', { name: 'Show at most 1,000 per column' })).toBeVisible({
    timeout: 60_000,
  })
  await expect(svg.locator('image')).toHaveCount(60)
  await note.getByRole('button', { name: 'Show at most 1,000 per column' }).click()
  await expect(note).toContainText(`Showing 1,000 of ${wideRows}`, { timeout: 60_000 })

  // As a cells table, Columns summarise the first 20 variables as boxes, saying so.
  await openSheet(page, 'wide', 'Data Tables')
  await tableBox(page).check()
  const c = await openBuilder(page)
  await plotStyle(c, 'Columns').click()
  await expect(
    c.getByText('Summarising 20 of 60 number variables: tick others under Data sets.'),
  ).toBeVisible()
  await expect(c.getByRole('img', { name: /^Preview: Box/ })).toBeVisible({ timeout: 60_000 })
  await c.getByRole('button', { name: 'Cancel' }).click()
})
