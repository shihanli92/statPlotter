import type { Page } from '@playwright/test'
import { expect, test } from './fixtures.ts'
import {
  analyze,
  answer,
  cell,
  columnTitles,
  expectUpToDate,
  grid,
  menuItem,
  menuPanel,
  newTable,
  openMenu,
  pressShortcut,
  resultTable,
  resultValue,
  rowCells,
  runMenu,
  sheet,
  toast,
  tool,
  toolbar,
  typeCells,
} from './helpers-data.ts'

// Saving and reopening projects (.psproj). The web app saves with the File System Access API
// where the browser has it (Chromium) and as a download elsewhere; it opens through the API or an
// <input type=file>.

/** The unsaved-changes dot next to the file name. */
const dirtyDot = (page: Page) => toolbar(page).getByRole('img', { name: 'Unsaved changes' })

/** A small project: a named table with an edited title and an excluded value, and a t test. */
async function buildProject(page: Page) {
  await newTable(page, { kind: 'Column', name: 'Weights', sample: true })
  await columnTitles(page).filter({ hasText: 'Control' }).dblclick()
  await grid(page).getByRole('textbox').fill('Vehicle')
  await page.keyboard.press('Enter')
  await cell(page, 1, 0).click()
  await pressShortcut(page, 'Mod+E')
  // Student's t test, chosen (roadmap 51c: Welch's is the default).
  await analyze(page, 't test', (d) => d.getByRole('radio', { name: /Student’s t test$/ }).check())
  // R: t.test(var.equal = TRUE) without the excluded 38.5: t = 6.1819.
  await expect(resultValue(resultTable(page, 'Unpaired t test'), 't')).toHaveText('6.182')
  await sheet(page, 'Weights', 'Data Tables').click()
}

/** The project that buildProject made, as reopened, its t test giving `t`. */
async function expectProject(page: Page, t = '6.182') {
  await expect(sheet(page, 'Weights', 'Data Tables')).toHaveClass(/\bon\b/)
  await expect(sheet(page, 'Weights', 'Graphs')).toBeVisible()
  await expect(columnTitles(page)).toHaveText(['Row', 'Vehicle', 'Treated'])
  await expect(rowCells(page, 0)).toHaveText(['34.1', '45.2'])
  await expect(cell(page, 1, 0)).toHaveText('38.5*')
  await sheet(page, 'Student’s t test: Treated vs Vehicle (Weights)', 'Results').click()
  await expectUpToDate(page)
  await expect(resultValue(resultTable(page, 'Unpaired t test'), 't')).toHaveText(t)
  await expect(dirtyDot(page)).toHaveCount(0)
}

test.describe('download and file input', () => {
  test.beforeEach(async ({ page }) => {
    // Chromium's File System Access pickers are native dialogs a test can't drive: take them
    // away so the app downloads (save) and uses a file input (open), as in the other browsers.
    await page.addInitScript(() => {
      const w = window as unknown as Record<string, unknown>
      for (const name of ['showSaveFilePicker', 'showOpenFilePicker']) {
        delete (Window.prototype as unknown as Record<string, unknown>)[name]
        delete w[name]
      }
    })
    await page.goto('/')
  })

  test('save, then open the file again', async ({ page }, testInfo) => {
    await buildProject(page)
    await expect(dirtyDot(page)).toBeVisible()
    await expect(page).toHaveTitle('Untitled • — statPlotter')

    const download = page.waitForEvent('download')
    await runMenu(page, 'File', 'Save')
    const file = await download
    expect(file.suggestedFilename()).toBe('Untitled.psproj')
    const path = testInfo.outputPath('project.psproj')
    await file.saveAs(path)
    // Saved: no dot, the file's name as the title.
    await expect(dirtyDot(page)).toHaveCount(0)
    await expect(page).toHaveTitle('Untitled.psproj — statPlotter')
    await expect(toolbar(page)).toContainText('Untitled.psproj')

    // A change makes it dirty again; closing asks, and the project goes.
    await typeCells(page, 0, 1, [['99']])
    await expect(dirtyDot(page)).toBeVisible()
    await runMenu(page, 'File', 'Close project')
    await answer(page, 'Discard unsaved changes?', 'Discard')
    await expect(page.getByRole('heading', { name: 'Start a project' })).toBeVisible()

    // File › Open… reads it back: sheets, values, exclusions, results, the open sheet.
    const chooser = page.waitForEvent('filechooser')
    await runMenu(page, 'File', 'Open…')
    await (await chooser).setFiles(path)
    await expect(page).toHaveTitle('project.psproj — statPlotter')
    await expectProject(page)
  })

  test('save and open by the keys; Save as… downloads again', async ({ page }, testInfo) => {
    await newTable(page, { kind: 'XY', sample: true, name: 'Curves' })
    let download = page.waitForEvent('download')
    await pressShortcut(page, 'Mod+S')
    const path = testInfo.outputPath('curves.psproj')
    await (await download).saveAs(path)
    await expect(dirtyDot(page)).toHaveCount(0)

    // Save as… always asks where (here: another download).
    download = page.waitForEvent('download')
    await pressShortcut(page, 'Mod+Shift+S')
    expect((await download).suggestedFilename()).toBe('Untitled.psproj')

    // Nothing changed since the save: opening doesn't ask.
    const chooser = page.waitForEvent('filechooser')
    await pressShortcut(page, 'Mod+O')
    await (await chooser).setFiles(path)
    await expect(page).toHaveTitle('curves.psproj — statPlotter')
    await expect(grid(page)).toHaveAccessibleName('Curves')
    await expect(rowCells(page, 0)).toHaveText(['-9', '1', '6.1', '2', '2.7', '4.5', '1.4'])
  })

  test('a file that is not a project says so', async ({ page }) => {
    const chooser = page.waitForEvent('filechooser')
    await runMenu(page, 'File', 'Open…')
    await (await chooser).setFiles({
      name: 'broken.psproj',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('not a zip'),
    })
    await expect(toast(page)).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Start a project' })).toBeVisible()
  })
})

test('Open recent is offered only with the File System Access API', async ({
  page,
  browserName,
}) => {
  await page.goto('/')
  const file = await openMenu(page, 'File')
  if (browserName !== 'chromium') {
    // WebKit and Firefox have no file handles to remember.
    await expect(menuItem(file, 'Open recent')).toHaveCount(0)
    return
  }
  await menuItem(file, 'Open recent').click()
  const recent = menuPanel(page, 'Open recent')
  await expect(menuItem(recent, 'No recent files')).toBeDisabled()
  await expect(menuItem(recent, 'Clear recent')).toBeDisabled()
})

test('Chromium: save to a file handle, then again in place without asking', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'The File System Access API exists only in Chromium')
  // The save picker is a native dialog: a stand-in returns a real handle of the origin-private
  // file system, which the app writes like a picked file. Open recent is left out: storing a
  // file handle in IndexedDB (as the app remembers recent files) crashes Playwright's Chromium,
  // so without showOpenFilePicker the app neither remembers files nor uses the open picker.
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown> & { pickerCalls: string[] }
    delete (Window.prototype as unknown as Record<string, unknown>).showOpenFilePicker
    delete w.showOpenFilePicker
    w.pickerCalls = []
    w.showSaveFilePicker = async (opts: { suggestedName: string }) => {
      w.pickerCalls.push(opts.suggestedName)
      const dir = await navigator.storage.getDirectory()
      return dir.getFileHandle(opts.suggestedName, { create: true })
    }
  })
  await page.goto('/')
  const pickerCalls = () =>
    page.evaluate(() => (window as unknown as { pickerCalls: string[] }).pickerCalls.length)

  await buildProject(page)
  await tool(page, 'Save').click()
  await expect(dirtyDot(page)).toHaveCount(0)
  await expect(page).toHaveTitle('Untitled.psproj — statPlotter')
  expect(await pickerCalls()).toBe(1)

  // A second save writes the same file without asking; Save as… asks again.
  await typeCells(page, 9, 0, [['1']])
  await expect(dirtyDot(page)).toBeVisible()
  await pressShortcut(page, 'Mod+S')
  await expect(dirtyDot(page)).toHaveCount(0)
  expect(await pickerCalls()).toBe(1)
  await runMenu(page, 'File', 'Save as…')
  await expect.poll(pickerCalls).toBe(2)

  // What was written opens again (through the file input).
  const bytes = await page.evaluate(async () => {
    const dir = await navigator.storage.getDirectory()
    const file = await (await dir.getFileHandle('Untitled.psproj')).getFile()
    return [...new Uint8Array(await file.arrayBuffer())]
  })
  await runMenu(page, 'File', 'Close project')
  const chooser = page.waitForEvent('filechooser')
  await runMenu(page, 'File', 'Open…')
  await (await chooser).setFiles({
    name: 'Untitled.psproj',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(bytes),
  })
  await expect(cell(page, 9, 0)).toHaveText('1')
  // R: with the 1 added to Control, t = 3.7595.
  await expectProject(page, '3.760')
})
