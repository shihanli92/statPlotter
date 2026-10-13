import { readFile } from 'node:fs/promises'
import type { Locator, Page } from '@playwright/test'
import { expect, test } from './fixtures.ts'
import {
  analyze,
  answer,
  cell,
  columnTitles,
  dialog,
  grid,
  newTable,
  pressShortcut,
  runMenu,
  sheet,
  toast,
  tool,
  typeCells,
} from './helpers-data.ts'

// Import and interop (roadmap 39): files dropped on the window (a CSV, an XLSX, a project, images
// on a page and off it, several at once), the user's missing codes and values at detection limits
// (LOD/2, changed later in Edit › Limits…, marked in the grid, noted on results), and a .pzfx
// file's graphs imported with a report. Fixtures: apps/e2e/fixtures (growth.csv,
// two-sheets.xlsx, photo.jpg, micrograph.png, xy-with-exclusions.pzfx: a real .pzfx file from the
// pzfx R package, MIT).

const FIXTURES = new URL('../fixtures/', import.meta.url)
const fixtureFile = async (name: string, type: string) => ({
  name,
  type,
  bytes: [...(await readFile(new URL(name, FIXTURES)))],
})
const textFile = (name: string, text: string, type = 'text/csv') => ({
  name,
  type,
  bytes: [...Buffer.from(text, 'utf8')],
})
type DropFile = { name: string; type: string; bytes: number[] }

/**
 * Drags files over an element and drops them there (DragEvents carrying a DataTransfer of File
 * objects, as a drop from the desktop gives), checking the overlay names what will happen.
 */
async function dropFiles(
  page: Page,
  target: Locator,
  files: DropFile[],
  opts: { overlay?: RegExp; at?: { x: number; y: number } } = {},
) {
  await target.evaluate(
    (el, { files, at, phase }) => {
      const dt = new DataTransfer()
      for (const f of files)
        dt.items.add(new File([new Uint8Array(f.bytes)], f.name, { type: f.type }))
      const init = {
        dataTransfer: dt,
        bubbles: true,
        cancelable: true,
        ...(at ? { clientX: at.x, clientY: at.y } : {}),
      }
      el.dispatchEvent(new DragEvent('dragenter', init))
      el.dispatchEvent(new DragEvent('dragover', init))
      ;(window as unknown as { __drop?: () => void }).__drop = () =>
        el.dispatchEvent(new DragEvent('drop', init))
      void phase
    },
    { files, at: opts.at, phase: 'over' },
  )
  const overlay = page.getByTestId('drop-overlay')
  await expect(overlay).toBeVisible()
  if (opts.overlay) await expect(overlay).toContainText(opts.overlay)
  await page.evaluate(() => (window as unknown as { __drop: () => void }).__drop())
  await expect(overlay).toBeHidden()
}

const main = (page: Page) => page.getByRole('main')
const importDialog = (page: Page, name: string) => dialog(page, `Import “${name}”`)

test.beforeEach(async ({ page }) => {
  // Saving downloads the project (as in browsers without the File System Access API).
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>
    for (const name of ['showSaveFilePicker', 'showOpenFilePicker']) {
      delete (Window.prototype as unknown as Record<string, unknown>)[name]
      delete w[name]
    }
  })
  await page.goto('/')
})

test('drop a CSV, an XLSX and a project on the window; several files one by one', async ({
  page,
}, testInfo) => {
  // A CSV: the import dialog, as File › Import data… opens it.
  await dropFiles(page, main(page), [await fixtureFile('growth.csv', 'text/csv')], {
    overlay: /CSV, TSV, TXT and Excel files open the import dialog/,
  })
  const csv = importDialog(page, 'growth.csv')
  await expect(csv).toBeVisible()
  await csv.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(csv).toBeHidden()
  await expect(grid(page)).toHaveAccessibleName('growth')

  // An Excel workbook: its sheets in the import dialog.
  await dropFiles(page, main(page), [
    await fixtureFile(
      'two-sheets.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ),
  ])
  const xlsx = importDialog(page, 'two-sheets.xlsx')
  await expect(xlsx.getByRole('combobox', { name: 'Sheet' })).toBeVisible()
  await xlsx.getByRole('button', { name: /^Import( this table)?$/ }).click()
  await expect(xlsx).toBeHidden()
  await expect(sheet(page, 'two-sheets – Weights', 'Data Tables')).toBeVisible()

  // Saved, changed, then the saved project dropped: asked first, it replaces the changed one.
  const download = page.waitForEvent('download')
  await pressShortcut(page, 'Mod+S')
  const path = testInfo.outputPath('dropped.psproj')
  await (await download).saveAs(path)
  await newTable(page, { name: 'After the save' })
  await expect(sheet(page, 'After the save', 'Data Tables')).toBeVisible()
  await dropFiles(page, main(page), [
    { name: 'dropped.psproj', type: '', bytes: [...(await readFile(path))] },
  ])
  // Roadmap 40: onto an open project, asked whether to open it or import from it.
  const ask = dialog(page, 'Open dropped.psproj?')
  await expect(ask).toBeVisible()
  await ask.getByRole('button', { name: 'Open', exact: true }).click()
  await answer(page, 'Discard unsaved changes?', 'Discard')
  await expect(page).toHaveTitle('dropped.psproj — statPlotter')
  await expect(sheet(page, 'growth', 'Data Tables')).toBeVisible()
  await expect(sheet(page, 'After the save', 'Data Tables')).toHaveCount(0)

  // Several files at once: the CSV's dialog first, then the rest, then a summary.
  await dropFiles(page, main(page), [
    textFile('more.csv', 'A,B\n1,2\n3,4\n'),
    textFile('notes.docx', 'not a spreadsheet', 'application/octet-stream'),
  ])
  const more = importDialog(page, 'more.csv')
  await expect(more).toBeVisible()
  await more.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(toast(page)).toContainText('2 files dropped: 1 handled, 1 not.')
  await expect(toast(page)).toContainText('notes.docx: not a file this app opens.')
  await expect(sheet(page, 'more', 'Data Tables')).toBeVisible()
})

test('images: on a page where dropped; on a graph, put on a page of your choice', async ({
  page,
}) => {
  await newTable(page, { name: 'Weights', sample: true })
  await runMenu(page, 'Insert', 'New layout')
  const pageSvg = page.getByRole('img', { name: 'Layout page' })
  await expect(pageSvg).toBeVisible()
  const items = pageSvg.locator('[data-testid^="layout-item-"]')
  const before = await items.count()
  const canvasBox = (await main(page).locator('.canvas').boundingBox())!
  await dropFiles(
    page,
    main(page).locator('.canvas'),
    [await fixtureFile('photo.jpg', 'image/jpeg')],
    {
      overlay: /Images are placed on this page where you drop them/,
      at: { x: canvasBox.x + canvasBox.width / 2, y: canvasBox.y + 200 },
    },
  )
  await expect(items).toHaveCount(before + 1)

  // On a graph: a page is offered (this one, or a new one), or the image ignored.
  await sheet(page, 'Weights', 'Graphs').click()
  await dropFiles(page, main(page), [await fixtureFile('micrograph.png', 'image/png')], {
    overlay: /Images: you choose a page to put them on/,
  })
  const ask = dialog(page, 'Add “micrograph.png” to a page?')
  await expect(ask.getByRole('combobox', { name: 'Page' })).toHaveValue(/.+/)
  await ask.getByRole('button', { name: 'Add to page' }).click()
  await expect(ask).toBeHidden()
  await expect(pageSvg).toBeVisible()
  await expect(items).toHaveCount(before + 2)

  // Ignored: nothing added.
  await sheet(page, 'Weights', 'Graphs').click()
  await dropFiles(page, main(page), [await fixtureFile('micrograph.png', 'image/png')])
  await dialog(page, 'Add “micrograph.png” to a page?')
    .getByRole('button', { name: 'Ignore' })
    .click()
  await sheet(page, 'Layout 1', 'Layouts').click()
  await expect(items).toHaveCount(before + 2)
})

test('missing codes and values at detection limits: LOD/2, marked, changed later, noted on results', async ({
  page,
}) => {
  const csv = textFile(
    'cytokines.csv',
    'Control,Treated\n1.2,ND\n<0.5,3.4\n-999,<LOD\n2.0,5.1\n1.6,4.4\n',
  )
  await dropFiles(page, main(page), [csv])
  const d = importDialog(page, 'cytokines.csv')
  await expect(d).toBeVisible()
  const rules = d.getByRole('group', { name: 'Missing values and detection limits' })
  // Found in the sheet, so read by default; LOD/2 below.
  await expect(rules).toContainText('2 below and 0 above in this sheet')
  await expect(rules.getByRole('checkbox', { name: /^Values at detection limits/ })).toBeChecked()
  await expect(rules.getByRole('combobox', { name: 'Below a limit, use' })).toHaveValue('half')
  await rules.getByRole('textbox', { name: 'Missing-value codes' }).fill('ND, -999')
  // "<LOD" names no number: its limit typed for its column.
  await rules
    .getByRole('group', { name: /Lower limit of the 1 cell without a number/ })
    .getByRole('textbox', { name: 'Treated' })
    .fill('1')
  await d.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(d).toBeHidden()

  await expect(columnTitles(page)).toHaveText(['Row', 'Control', 'Treated'])
  // Control: 1.2, <0.5 → 0.25, -999 → empty; Treated: ND → empty, <LOD → 1/2.
  await expect(cell(page, 1, 0)).toHaveText(/0\.25/)
  await expect(cell(page, 2, 0)).toHaveText('')
  await expect(cell(page, 0, 1)).toHaveText('')
  await expect(cell(page, 2, 1)).toHaveText(/0\.5/)
  await expect(cell(page, 1, 0)).toHaveClass(/\bat-limit\b/)
  await expect(cell(page, 2, 1)).toHaveClass(/\bat-limit\b/)
  await expect(cell(page, 0, 0)).not.toHaveClass(/\bat-limit\b/)
  await expect(cell(page, 1, 0)).toHaveAttribute('title', /Imported as “<0\.5”/)

  // Edit › Limits…: the limit itself instead, substituted again from the kept text; undoable.
  await runMenu(page, 'Edit', 'Limits…')
  const lim = dialog(page, 'Limits of “cytokines”')
  await expect(lim).toContainText('2 cells below a limit and 0 above')
  await lim.getByRole('combobox', { name: 'Below a limit, use' }).selectOption('limit')
  await lim.getByRole('button', { name: 'Apply' }).click()
  await expect(lim).toBeHidden()
  await expect(cell(page, 1, 0)).toHaveText(/^\D*0\.5$/)
  await expect(cell(page, 2, 1)).toHaveText(/^\D*1$/)
  await expect(tool(page, 'Undo Limits')).toBeVisible()
  await tool(page, 'Undo Limits').click()
  await expect(cell(page, 1, 0)).toHaveText(/0\.25/)

  // A value typed over a flagged cell is the user's.
  await typeCells(page, 1, 0, [['0.3']])
  await expect(cell(page, 1, 0)).not.toHaveClass(/\bat-limit\b/)

  // Results say the analysis used substituted values.
  await analyze(page, 't test')
  await expect(page.locator('.limit-note')).toContainText(
    '1 value of “cytokines” was imported at a detection limit and substituted',
  )
})

test('a .pzfx file with Import graphs: graphs from its settings, and the report', async ({
  page,
}) => {
  await dropFiles(page, main(page), [
    await fixtureFile('xy-with-exclusions.pzfx', 'application/octet-stream'),
  ])
  const d = importDialog(page, 'xy-with-exclusions.pzfx')
  await expect(d).toContainText('1 XY table.')
  await expect(d).toContainText('1 graph: 1 drawn from the file’s settings.')
  await expect(d.getByRole('checkbox', { name: 'Import graphs' })).toBeChecked()
  await d.getByRole('button', { name: 'Import', exact: true }).click()

  const report = dialog(page, 'Graphs in “xy-with-exclusions.pzfx”')
  const lines = report.getByRole('list', { name: 'Graph report' }).getByRole('listitem')
  await expect(lines).toHaveCount(1)
  await expect(lines.first()).toContainText('Data 1 — Read')
  await expect(lines.first()).toContainText('From the file: data sets (3)')
  await expect(lines.first()).toContainText('Y axis range')
  await expect(lines.first()).toContainText('Default: kind of graph')
  await report.getByRole('button', { name: 'Done' }).click()
  await expect(report).toBeHidden()

  await sheet(page, 'Data 1', 'Graphs').click()
  const svg = main(page).getByRole('img', { name: 'Graph', exact: true })
  await expect(svg).toBeVisible()
  // The file's axis titles ("XX"; "YTitle", a default the file holds, shown as the file shows it).
  await expect(svg).toContainText('XX')
  await expect(svg).toContainText('YTitle')
})
