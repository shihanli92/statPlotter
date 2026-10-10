import { readFile } from 'node:fs/promises'
import type { Download, Locator, Page } from '@playwright/test'
import { expect, openExample, test } from './fixtures.ts'
import { answer } from './helpers-data.ts'
import {
  builderLayers,
  canvas,
  dialog,
  menu,
  openBuilder,
  openGraph,
  openSheet,
  pickPreset,
  pointMarks,
  presets,
} from './helpers-graph.ts'

// The user's presets (roadmap 33c): saved from the graph builder or a graph's layers, first in the
// builder's presets row, used on another table, a table kind's default, exported, imported,
// renamed and deleted in Manage presets…; kept in the browser's IndexedDB.

test.beforeEach(async ({ page }) => {
  // Chromium's save picker can't be driven by automation: without it the web platform downloads
  // (as in WebKit and Firefox).
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true })
  })
})

/** The names of the builder's layer rows, top to bottom (front to back). */
const layerNames = (b: Locator) =>
  builderLayers(b).evaluateAll((rows) => rows.map((r) => r.getAttribute('aria-label')))

/** The names of the builder's chips, in order. */
const chipNames = (b: Locator) =>
  presets(b).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))

/** Saves the layers shown as a preset (the builder's Save as preset…, or a Format menu path). */
async function savePreset(page: Page, name: string, opts: { isDefault?: boolean } = {}) {
  const d = dialog(page, 'Save as preset')
  await expect(d).toBeVisible()
  await d.getByLabel('Preset name').fill(name)
  if (opts.isDefault) await d.getByRole('checkbox', { name: /^Use as default for/ }).check()
  await d.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(d).toBeHidden()
}

test('a preset saved in the builder comes first and makes the same layers for another table', async ({
  page,
}) => {
  await openExample(page, 'getting-started')
  await openSheet(page, 'Dose response (3 groups)', 'Data Tables')
  let b = await openBuilder(page)
  await pickPreset(b, 'Bars with points')
  await b.getByLabel('Error bars (SD): statistic').selectOption('SEM')
  await b.getByRole('checkbox', { name: /^Horizontal/ }).check()
  await b.getByRole('button', { name: 'Save as preset…' }).click()
  // The name is checked: required, and not a name in use.
  const save = dialog(page, 'Save as preset')
  await save.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(save.getByRole('alert')).toHaveText('Give the preset a name.')
  await save.getByLabel('Preset name').fill('a/b')
  await expect(save.getByRole('alert')).toContainText('can’t contain')
  await savePreset(page, 'Bars ± SEM, sideways')
  await expect(b.getByRole('status')).toContainText('Saved the preset “Bars ± SEM, sideways”')
  // First in the row, starred, before the built-in presets.
  await expect
    .poll(() => chipNames(b))
    .toEqual([
      'Bars ± SEM, sideways',
      'Bars with points',
      'Scatter, mean ± SD',
      'Box with points',
      'Violin with box',
    ])
  await expect(presets(b).first()).toHaveClass(/\buser\b/)
  await b.getByRole('button', { name: 'Cancel' }).click()
  await expect(b).toBeHidden()

  // Another column table: the preset's layers, statistics and orientation.
  await openSheet(page, 'Cell area', 'Data Tables')
  b = await openBuilder(page)
  const mine = b.getByRole('radio', { name: 'Bars ± SEM, sideways', exact: true })
  await mine.click()
  await expect(mine).toHaveAttribute('aria-checked', 'true')
  expect(await layerNames(b)).toEqual(['Error bars (SEM)', 'Points (every value)', 'Bars (mean)'])
  await expect(b.getByRole('checkbox', { name: /^Horizontal/ })).toBeChecked()
  await b.getByLabel('Name', { exact: true }).fill('Cells, my way')
  await b.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(b).toBeHidden()
  const svg = canvas(page)
  await expect(svg.locator('rect[data-id$="/bar"]')).toHaveCount(3)
  await expect(pointMarks(svg)).toHaveCount(180)
  // Horizontal: the categories run down the left.
  const ys = await svg
    .locator('[data-id^="axis/x/tickLabel/"]')
    .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().y))
  expect(ys[1]).toBeGreaterThan(ys[0]! + 2)
})

test('Manage presets: a default, export, delete, import and rename', async ({ page }) => {
  // Saved from a graph's layers (Format › Layers ▸ Save layers as preset…), as the default.
  await openGraph(page, 'getting-started', 'Dose response (bars)')
  await menu(page, 'Format', 'Layers', 'Save layers as preset…')
  await savePreset(page, 'Lab bars', { isDefault: true })

  // The default: chosen when the builder opens for a column table.
  await openSheet(page, 'Cell area', 'Data Tables')
  const b = await openBuilder(page)
  await expect(b.getByRole('radio', { name: 'Lab bars', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await b.getByRole('button', { name: 'Manage presets…' }).click()
  const m = dialog(page, 'Manage presets')
  const row = m.getByRole('listitem', { name: 'Lab bars' })
  await expect(
    row.getByRole('checkbox', { name: 'Use as default for column tables' }),
  ).toBeChecked()

  // Export to a .pspreset file.
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    row.getByRole('button', { name: 'Export Lab bars' }).click(),
  ])
  expect(file.suggestedFilename()).toBe('Lab bars.pspreset')
  const text = await readFile((await (file as Download).path())!, 'utf8')
  expect(JSON.parse(text)).toMatchObject({
    format: 'plotting-software-preset',
    version: 1,
    name: 'Lab bars',
    recipe: { tableKind: 'column', frame: 'category' },
  })
  expect(JSON.parse(text).isDefault).toBeUndefined()

  // Delete (no undo: it asks first).
  await row.getByRole('button', { name: 'Delete Lab bars' }).click()
  await answer(page, 'Delete “Lab bars” for good?', 'Delete')
  await expect(m.getByRole('listitem')).toHaveCount(0)
  await expect(b.getByRole('radio', { name: 'Lab bars', exact: true })).toHaveCount(0)

  // Import it back; a file that isn't a preset is refused with the reason.
  let chooser = page.waitForEvent('filechooser')
  await m.getByRole('button', { name: 'Import…' }).click()
  await (await chooser).setFiles({
    name: 'notes.pspreset',
    mimeType: 'application/json',
    buffer: Buffer.from('{"format":"something-else"}'),
  })
  await expect(m.getByRole('alert')).toContainText('Not a preset file.')
  chooser = page.waitForEvent('filechooser')
  await m.getByRole('button', { name: 'Import…' }).click()
  await (await chooser).setFiles({
    name: 'Lab bars.pspreset',
    mimeType: 'application/json',
    buffer: Buffer.from(text),
  })
  await expect(m.getByRole('status')).toHaveText('Imported the preset “Lab bars”.')
  const back = m.getByRole('listitem', { name: 'Lab bars' })
  await expect(back.getByRole('checkbox', { name: /^Use as default/ })).not.toBeChecked()

  // Rename: checked as typed.
  await back.getByRole('button', { name: 'Rename Lab bars' }).click()
  const field = m.getByLabel('New name for Lab bars')
  await field.fill('')
  await expect(m.getByRole('alert')).toHaveText('Give the preset a name.')
  await field.fill('Lab bars (SEM)')
  await field.press('Enter')
  await expect(m.getByRole('listitem', { name: 'Lab bars (SEM)' })).toBeVisible()
  await m.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(m).toBeHidden()
  await expect(b.getByRole('radio', { name: 'Lab bars (SEM)', exact: true })).toBeVisible()
  await b.getByRole('button', { name: 'Cancel' }).click()
})
