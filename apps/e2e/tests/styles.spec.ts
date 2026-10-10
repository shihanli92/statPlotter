import { readFile } from 'node:fs/promises'
import type { Download, Locator, Page } from '@playwright/test'
import { expect, openExample, sheets, test } from './fixtures.ts'
import { answer } from './helpers-data.ts'
import {
  canvas,
  clickOn,
  dialog,
  inWindow,
  menu,
  openGraph,
  openSheet,
  section,
  undo,
} from './helpers-graph.ts'

// Styles (roadmap 37): a journal style for the project, a graph's own font kept through another
// style, Reset to style, a graph's look saved as a style and used on another graph, a .psstyle
// exported and imported, Preferences giving new projects a style, a page fitted to a column;
// each with undo where it changes the project.

test.beforeEach(async ({ page }) => {
  // Chromium's save picker can't be driven by automation: without it the web platform downloads.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true })
  })
})

/** A text element's first run's font size, as drawn. */
const size = (svg: Locator, id: string) => svg.locator(`[data-id="${id}"] tspan`).first()

/** Format › Styles…, a style picked and applied to a target (a radio's label). */
async function applyStyle(page: Page, style: string | RegExp, target: string | RegExp) {
  await menu(page, 'Format', 'Styles…')
  const d = dialog(page, 'Styles')
  await d.getByRole('button', { name: style }).click()
  await d.getByRole('radio', { name: target }).check()
  await d.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(d).toBeHidden()
}

/** The graph title's place (selected, then Format title…), in the dialog: its size. */
async function setTitleSize(page: Page, pt: number) {
  await clickOn(canvas(page).locator('[data-id="title"]'))
  await menu(page, 'Format', 'Format title…')
  const d = await inWindow(page, 'Format title')
  await section(d, 'Common').getByLabel('Title size (pt)').fill(String(pt))
  await d.getByRole('button', { name: 'OK', exact: true }).click()
  await expect(d).toBeHidden()
}

test('a journal style for the project; a graph’s own font kept through another style; Reset to style; undo', async ({
  page,
}) => {
  const svg = await openGraph(page, 'getting-started', 'Dose response (bars)')
  const yTitle = size(svg, 'axis/y/title')
  const title = size(svg, 'title')
  const tick = size(svg, 'axis/y/tickLabel/0')
  await expect(yTitle).toHaveAttribute('font-size', '12')

  await applyStyle(page, /^Journal: Nature-style/, /^The whole project/)
  await expect(yTitle).toHaveAttribute('font-size', '7')
  await expect(title).toHaveAttribute('font-size', '8')
  await expect(tick).toHaveAttribute('font-size', '6')

  // The user's own title size: kept when another style is applied.
  await setTitleSize(page, 15)
  await expect(title).toHaveAttribute('font-size', '15')
  await applyStyle(page, /^Journal: Science-style/, /^The whole project/)
  await expect(tick).toHaveAttribute('font-size', '7')
  await expect(title).toHaveAttribute('font-size', '15')

  // Reset to style clears it, with a confirm; undo brings it back.
  await menu(page, 'Format', 'Reset to style…')
  const r = dialog(page, 'Reset to style')
  await r.getByRole('button', { name: 'Reset', exact: true }).click()
  await expect(title).toHaveAttribute('font-size', '8')
  await undo(page)
  await expect(title).toHaveAttribute('font-size', '15')
  // Undo the second style, the title edit, the first style: the app's own look.
  await undo(page)
  await expect(tick).toHaveAttribute('font-size', '6')
  await undo(page)
  await undo(page)
  await expect(yTitle).toHaveAttribute('font-size', '12')
})

test('a graph’s look saved as a style, used on another graph, exported, deleted and imported', async ({
  page,
}) => {
  await openGraph(page, 'getting-started', 'Dose response (bars)')
  await setTitleSize(page, 20)
  await menu(page, 'Format', 'Save this graph’s look as a style…')
  const save = dialog(page, 'Save this graph’s look as a style')
  await save.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(save.getByRole('alert')).toHaveText('Give the style a name.')
  await save.getByLabel('Style name').fill('Lab')
  await save.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(save).toBeHidden()

  // Another graph, its own style.
  await openSheet(page, 'Cell area (swarm)', 'Graphs')
  const title = size(canvas(page), 'title')
  await expect(title).toHaveAttribute('font-size', '14')
  await applyStyle(page, /^Lab\b/, /^This graph/)
  await expect(title).toHaveAttribute('font-size', '20')
  await undo(page)
  await expect(title).toHaveAttribute('font-size', '14')

  // Export to a .psstyle file, delete, import it back.
  await menu(page, 'Format', 'Styles…')
  const d = dialog(page, 'Styles')
  await d.getByRole('button', { name: /^Lab\b/ }).click()
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    d.getByRole('button', { name: 'Export…' }).click(),
  ])
  expect(file.suggestedFilename()).toBe('Lab.psstyle')
  const text = await readFile((await (file as Download).path())!, 'utf8')
  expect(JSON.parse(text)).toMatchObject({
    format: 'plotting-software-style',
    version: 1,
    name: 'Lab',
    style: { text: { title: { size: 20 } } },
  })
  await d.getByRole('button', { name: 'Delete', exact: true }).click()
  await answer(page, 'Delete “Lab” for good?', 'Delete')
  await expect(d.getByRole('list', { name: 'Your styles' }).getByRole('button')).toHaveCount(0)
  let chooser = page.waitForEvent('filechooser')
  await d.getByRole('button', { name: 'Import…' }).click()
  await (await chooser).setFiles({
    name: 'notes.psstyle',
    mimeType: 'application/json',
    buffer: Buffer.from('{"format":"something-else"}'),
  })
  await expect(d.getByRole('alert')).toContainText('Not a style file.')
  chooser = page.waitForEvent('filechooser')
  await d.getByRole('button', { name: 'Import…' }).click()
  await (await chooser).setFiles({
    name: 'Lab.psstyle',
    mimeType: 'application/json',
    buffer: Buffer.from(text),
  })
  await expect(d.getByRole('status')).toHaveText('Imported the style “Lab”.')
  await d.getByRole('radio', { name: /^This graph/ }).check()
  await d.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(title).toHaveAttribute('font-size', '20')
})

test('Preferences give new projects a style; projects open keep theirs', async ({ page }) => {
  await openExample(page, 'getting-started')
  await menu(page, 'Edit', 'Preferences…')
  const p = dialog(page, 'Preferences')
  await p.getByLabel('Style').selectOption({ label: 'Journal: Cell-style (7 pt, 85/174 mm)' })
  await p.getByLabel('Sizes in').selectOption('mm')
  await p.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(p).toBeHidden()

  // This project keeps the app's own look.
  await menu(page, 'Format', 'Styles…')
  let d = dialog(page, 'Styles')
  await expect(d.getByRole('button', { name: /^Default · the project’s/ })).toBeVisible()
  await d.getByRole('button', { name: 'Close', exact: true }).click()

  // A new project takes the style; its graphs draw with it.
  await menu(page, 'File', 'New project')
  await expect(sheets(page)).toHaveCount(0)
  await menu(page, 'Format', 'Styles…')
  d = dialog(page, 'Styles')
  await expect(
    d.getByRole('button', { name: /^Journal: Cell-style.*· the project’s/ }),
  ).toBeVisible()
  await d.getByRole('button', { name: 'Close', exact: true }).click()
  // Preferences are kept for the next visit, whose blank project is new too.
  await page.goto('/')
  await menu(page, 'Format', 'Styles…')
  d = dialog(page, 'Styles')
  await expect(
    d.getByRole('button', { name: /^Journal: Cell-style.*· the project’s/ }),
  ).toBeVisible()
  await d.getByRole('button', { name: 'Close', exact: true }).click()
  await menu(page, 'Edit', 'Preferences…')
  await expect(dialog(page, 'Preferences').getByLabel('Sizes in')).toHaveValue('mm')
})

test('a layout page fitted to a column, with undo', async ({ page }) => {
  await openExample(page, 'getting-started')
  await openSheet(page, 'Figure 1', 'Layouts')
  const pageSize = page.getByRole('combobox', { name: 'Size', exact: true })
  await expect(pageSize).toHaveValue('letter')
  await applyStyle(page, /^Journal: Nature-style/, /^The whole project/)
  await menu(page, 'Format', 'Fit to column…')
  const f = dialog(page, 'Fit to column')
  await f.getByRole('radio', { name: /^Double column \(183 mm\)/ }).check()
  await f.getByRole('button', { name: 'Fit', exact: true }).click()
  await expect(f).toBeHidden()
  await expect(pageSize.locator('option:checked')).toHaveText(/^Custom \(183 × \d+ mm\)$/)
  await undo(page)
  await expect(pageSize).toHaveValue('letter')
})
