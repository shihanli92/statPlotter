import type { Locator, Page } from '@playwright/test'
import { expect, openExample, test } from './fixtures.ts'
import { cell, columnTitles, grid, pressShortcut } from './helpers-data.ts'
import {
  canvas,
  clickOn,
  dblclickOn,
  inWindow,
  marks,
  menu,
  openGraph,
  openSheet,
  preview,
  section,
  undo,
} from './helpers-graph.ts'

// Rich text (roadmap 28): one editor on the canvas, in Format dialogs and in table titles; typing
// is literal, formatting comes from its toolbar and shortcuts; formatted titles reach the grid
// header, legends and category labels.

const SCATTER = { example: 'getting-started', graph: 'Enzyme activity (scatter)' }

/** The floating format toolbar of the focused editor. */
const formatBar = (page: Page) => page.getByRole('toolbar', { name: 'Text format' })
const formatButton = (page: Page, name: string) =>
  formatBar(page).getByRole('button', { name, exact: true })

/** A drawn text's runs: text, size, weight, style and baseline. */
const runs = (text: Locator) =>
  text.locator('tspan').evaluateAll((els) =>
    els.map((e) => ({
      text: e.textContent,
      size: Number(e.getAttribute('font-size')),
      bold: ['bold', '700'].includes(e.getAttribute('font-weight') ?? ''),
      italic: e.getAttribute('font-style') === 'italic',
      y: Number(e.getAttribute('y')),
    })),
  )

/** Whether a drawn text has an underline (a rect drawn right after it). */
const underlined = (text: Locator) => text.evaluate((t) => t.nextElementSibling?.tagName === 'rect')

async function press(page: Page, key: string, times: number) {
  for (let i = 0; i < times; i++) await page.keyboard.press(key)
}

test('the canvas editor formats with its toolbar and keys, over two lines, in one undo step', async ({
  page,
}) => {
  const svg = await openGraph(page, SCATTER.example, SCATTER.graph)
  const title = svg.locator('[data-id="title"]')
  await dblclickOn(title)
  const editor = page.getByRole('textbox', { name: 'Edit text' })
  await expect(editor).toBeFocused()
  await expect(editor).toHaveAttribute('aria-multiline', 'true')
  // Typing replaces the selected title; markup characters are ordinary text.
  await page.keyboard.type('IC50 (nM) x^2')
  await press(page, 'ArrowLeft', 9)
  await press(page, 'Shift+ArrowLeft', 2)
  await formatButton(page, 'Subscript').click()
  await expect(formatButton(page, 'Subscript')).toHaveAttribute('aria-pressed', 'true')
  await expect(editor.locator('sub')).toHaveText('50')
  // The title is bold (its style), so Bold shows pressed; off at the caret formats what is typed
  // next as not bold, and on again.
  await press(page, 'ArrowRight', 10)
  await expect(formatButton(page, 'Bold')).toHaveAttribute('aria-pressed', 'true')
  await pressShortcut(page, 'Mod+B')
  await expect(formatButton(page, 'Bold')).toHaveAttribute('aria-pressed', 'false')
  await page.keyboard.type('!')
  await pressShortcut(page, 'Mod+B')
  // A second line, a symbol from the picker and a superscript by its shortcut.
  await page.keyboard.press('Shift+Enter')
  await formatButton(page, 'Insert symbol').click()
  await formatBar(page).getByRole('button', { name: 'Delta', exact: true }).click()
  await page.keyboard.type('t = 3')
  await page.keyboard.press('Shift+ArrowLeft')
  await pressShortcut(page, 'Mod+Shift+Equal')
  await expect(editor.locator('sup')).toHaveText('3')
  await page.keyboard.press('Enter')
  await expect(editor).toBeHidden()

  await expect(title).toHaveText('IC50 (nM) x^2!Δt = 3')
  const drawn = await runs(title)
  const at = (t: string) => drawn.find((r) => r.text === t)!
  expect(drawn.map((r) => r.text)).toEqual(['IC', '50', ' (nM) x^2', '!', 'Δt = ', '3'])
  expect(at('50').size).toBeLessThan(at('IC').size)
  expect(at('!').bold).toBe(false)
  expect(at('IC').bold).toBe(true)
  // The second line sits a line lower.
  expect(at('Δt = ').y).toBeGreaterThan(at('IC').y + at('IC').size)
  expect(at('3').y).toBeLessThan(at('Δt = ').y)
  expect(at('3').size).toBeLessThan(at('Δt = ').size)

  // One document step; undo brings back the plain title.
  await expect(page.getByRole('button', { name: /^Undo Edit graph title/ })).toBeVisible()
  await undo(page)
  await expect(title).toHaveText('Enzyme activity')
})

test('Escape leaves the text as it was; the editor keeps its own undo', async ({ page }) => {
  const svg = await openGraph(page, SCATTER.example, SCATTER.graph)
  const title = svg.locator('[data-id="title"]')
  await dblclickOn(title)
  const editor = page.getByRole('textbox', { name: 'Edit text' })
  await page.keyboard.press('ArrowRight')
  await page.keyboard.type(' 2')
  await expect(editor).toHaveText('Enzyme activity 2')
  await pressShortcut(page, 'Mod+Z')
  await expect(editor).toHaveText('Enzyme activity')
  await pressShortcut(page, 'Mod+Shift+Z')
  await expect(editor).toHaveText('Enzyme activity 2')
  await page.keyboard.press('Escape')
  await expect(editor).toBeHidden()
  await expect(title).toHaveText('Enzyme activity')
})

test('a Format dialog field formats the preview live and commits with OK', async ({ page }) => {
  const svg = await openGraph(page, SCATTER.example, SCATTER.graph)
  const title = svg.locator('[data-id="title"]')
  await clickOn(title, 'right')
  await page
    .getByRole('menu', { name: 'Graph element' })
    .getByRole('menuitem', { name: 'Format title…' })
    .click()
  const d = await inWindow(page, 'Format title')
  const field = section(d, 'Common').getByRole('textbox', { name: 'Title', exact: true })
  await field.click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type('Rate *k*_off')
  await press(page, 'ArrowLeft', 8)
  await press(page, 'Shift+ArrowLeft', 4)
  await formatButton(page, 'Italic').click()
  await press(page, 'ArrowRight', 9)
  await formatButton(page, 'Underline').click()
  await page.keyboard.type('!')
  const shown = preview(page).locator('[data-id="title"]')
  await expect(shown.locator('tspan')).toHaveText(['Rate', ' *k*_off', '!'])
  await expect(shown.locator('tspan').first()).toHaveAttribute('font-style', 'italic')
  // The underline is a rect drawn after the text.
  await expect.poll(() => underlined(shown)).toBe(true)
  await d.getByRole('button', { name: 'OK' }).click()
  await expect(title.locator('tspan')).toHaveText(['Rate', ' *k*_off', '!'])
  expect(await underlined(title)).toBe(true)
})

test('formatted titles in the grid, the legend and the category labels', async ({ page }) => {
  await openExample(page, 'grouped')
  await openSheet(page, 'Genotype × treatment', 'Data Tables')

  // A row title in italics.
  await cell(page, 0, 0).dblclick()
  const editor = grid(page).getByRole('textbox')
  await expect(editor).toHaveText('Wild type')
  await page.keyboard.press('ControlOrMeta+A')
  await pressShortcut(page, 'Mod+I')
  await page.keyboard.press('Enter')
  await expect(cell(page, 0, 0).locator('i')).toHaveText('Wild type')

  // A data set title with a superscript.
  await columnTitles(page).filter({ hasText: 'Vehicle' }).dblclick()
  await expect(editor).toHaveText('Vehicle')
  await page.keyboard.type('Ca2+')
  await press(page, 'Shift+ArrowLeft', 2)
  await formatButton(page, 'Superscript').click()
  await page.keyboard.press('Enter')
  await expect(columnTitles(page).filter({ hasText: 'Ca2+' }).locator('sup')).toHaveText('2+')

  await openSheet(page, 'Genotype × treatment', 'Graphs')
  const svg = canvas(page)
  const legendLabel = (text: string) =>
    svg.locator('text[data-id^="legend/"][data-id$="/label"]').filter({ hasText: text })
  await expect(legendLabel('Ca2+').locator('tspan')).toHaveText(['Ca', '2+'])
  const ca = await runs(legendLabel('Ca2+'))
  expect(ca.map((r) => r.text)).toEqual(['Ca', '2+'])
  expect(ca[1]!.size).toBeLessThan(ca[0]!.size)
  expect(ca[1]!.y).toBeLessThan(ca[0]!.y)
  const wt = await runs(marks(svg, 'axis/x/tickLabel/').filter({ hasText: 'Wild type' }))
  expect(wt).toMatchObject([{ text: 'Wild type', italic: true }])

  // A legend-only label (roadmap 47b): underlined as typed; the grid's title stays as it was.
  await dblclickOn(legendLabel('Drug'))
  const inline = page.getByRole('textbox', { name: 'Edit text' })
  await expect(inline).toHaveAttribute('aria-multiline', 'false')
  await page.keyboard.type('D')
  await pressShortcut(page, 'Mod+U')
  await page.keyboard.type('rug')
  await page.keyboard.press('Enter')
  await expect(legendLabel('Drug').locator('tspan')).toHaveText(['D', 'rug'])
  expect(await underlined(legendLabel('Drug'))).toBe(true)
  await undo(page)
  await expect(legendLabel('Drug').locator('tspan')).toHaveText(['Drug'])
  await openSheet(page, 'Genotype × treatment', 'Data Tables')
  await expect(columnTitles(page).filter({ hasText: 'Drug' }).locator('u')).toHaveCount(0)
  await expect(columnTitles(page).filter({ hasText: 'Ca2+' }).locator('sup')).toHaveText('2+')
})

test('a layout text edits in place and in its inspector, keeping its formatting', async ({
  page,
}) => {
  await openExample(page, SCATTER.example)
  await openSheet(page, 'Figure 1', 'Layouts')
  const pageSvg = page.getByRole('img', { name: 'Layout page' })
  await menu(page, 'Insert', 'Text')
  await pageSvg.locator('[data-testid^="layout-item-"]').last().dblclick()
  const editor = page.getByRole('textbox', { name: 'Edit text' })
  await expect(editor).toHaveText('Text')
  await page.keyboard.type('Cell area')
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.type('(µm2)')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('Shift+ArrowLeft')
  await pressShortcut(page, 'Mod+Shift+Equal')
  await page.keyboard.press('Enter')
  const text = pageSvg.locator('text').filter({ hasText: /^Cell area\(µm/ })
  await expect(text.locator('tspan')).toHaveText(['Cell area', '(µm', '2', ')'])

  // The inspector's field shows and keeps the formatting while the text changes there.
  const field = page.getByRole('textbox', { name: 'Text', exact: true })
  await expect(field.locator('sup')).toHaveText('2')
  await field.click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.type('!')
  await field.blur()
  await expect(text.locator('tspan')).toHaveText(['Cell area', '(µm', '2', ')!'])
})
