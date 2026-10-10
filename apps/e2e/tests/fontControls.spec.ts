import type { Locator, Page } from '@playwright/test'
import { expect, test } from './fixtures.ts'
import { pressShortcut } from './helpers-data.ts'
import { canvas, dblclickOn, menu, openGraph, undo } from './helpers-graph.ts'

// Word-style font controls (roadmap 28b): the editor's toolbar sets the font, size and colour of
// the selection (and a text box's alignment); the graph draws each run with its own.

const SCATTER = { example: 'getting-started', graph: 'Enzyme activity (scatter)' }

const formatBar = (page: Page) => page.getByRole('toolbar', { name: 'Text format' })
const formatButton = (page: Page, name: string) =>
  formatBar(page).getByRole('button', { name, exact: true })
const sizeBox = (page: Page) => formatBar(page).getByRole('combobox', { name: 'Font size' })

/** A drawn text's runs: text, font family, size, fill and x. */
const runs = (text: Locator) =>
  text.locator('tspan').evaluateAll((els) =>
    els.map((e) => ({
      text: e.textContent,
      font: e.getAttribute('font-family') ?? '',
      size: Number(e.getAttribute('font-size')),
      fill: e.getAttribute('fill'),
      x: Number(e.getAttribute('x')),
    })),
  )

async function press(page: Page, key: string, times: number) {
  for (let i = 0; i < times; i++) await page.keyboard.press(key)
}

test('the toolbar sets a word’s font, size and colour, shows mixed values blank, in one undo step', async ({
  page,
}) => {
  const svg = await openGraph(page, SCATTER.example, SCATTER.graph)
  const title = svg.locator('[data-id="title"]')
  await expect(title).toHaveText('Enzyme activity')
  const before = await runs(title)
  await dblclickOn(title)
  const editor = page.getByRole('textbox', { name: 'Edit text' })
  await expect(editor).toBeFocused()
  // The whole title is selected: the toolbar shows its own font and size.
  await expect(formatButton(page, 'Font')).toHaveText('Sans')
  await expect(sizeBox(page)).toHaveValue(String(before[0]!.size))

  // Select "activity".
  await page.keyboard.press('ArrowRight')
  await press(page, 'Shift+ArrowLeft', 8)
  await formatButton(page, 'Font').click()
  await formatBar(page).getByRole('menuitemradio', { name: 'Mono (Courier-compatible)' }).click()
  await expect(formatButton(page, 'Font')).toHaveText('Mono')
  await expect(editor.locator('span[data-font="mono"]')).toHaveText('activity')

  // Escape closes an open menu, not the editor.
  await formatButton(page, 'Font sizes').click()
  await expect(formatBar(page).getByRole('menu', { name: 'Font sizes' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(formatBar(page).getByRole('menu')).toHaveCount(0)
  await expect(editor).toBeFocused()

  // A size typed in the box, then a step up with the keyboard.
  await sizeBox(page).fill('20')
  await sizeBox(page).press('Enter')
  await expect(editor).toBeFocused()
  await expect(sizeBox(page)).toHaveValue('20')
  await pressShortcut(page, 'Mod+Shift+Period')
  await expect(sizeBox(page)).toHaveValue('22')

  // A palette colour.
  await formatButton(page, 'Text colour').click()
  await formatBar(page).getByRole('menuitemradio', { name: 'Palette colour 2' }).click()
  await expect(editor.locator('span[data-color="p1"]')).toHaveText('activity')

  // The whole text: font, size and colour are mixed, so the toolbar shows them blank.
  await page.keyboard.press('ControlOrMeta+a')
  await expect(formatButton(page, 'Font')).toHaveText('')
  await expect(sizeBox(page)).toHaveValue('')
  await page.keyboard.press('Enter')
  await expect(editor).toBeHidden()

  const drawn = await runs(title)
  expect(drawn.map((r) => r.text)).toEqual(['Enzyme ', 'activity'])
  expect(drawn[0]).toMatchObject({ size: before[0]!.size, fill: null })
  expect(drawn[0]!.font).toContain('Liberation Sans')
  expect(drawn[1]).toMatchObject({ size: 22, fill: '#d55e00' })
  expect(drawn[1]!.font).toContain('Liberation Mono')

  // One document step.
  await expect(page.getByRole('button', { name: /^Undo Edit graph title/ })).toBeVisible()
  await undo(page)
  await expect(title.locator('tspan')).toHaveText(['Enzyme activity'])
})

test('the editor shows the element’s style; Bold off in a bold title makes a word regular', async ({
  page,
}) => {
  const svg = await openGraph(page, SCATTER.example, SCATTER.graph)
  const title = svg.locator('[data-id="title"]')
  const weight = (l: Locator) => l.evaluate((e) => getComputedStyle(e).fontWeight)
  await dblclickOn(title)
  const editor = page.getByRole('textbox', { name: 'Edit text' })
  await expect(editor).toBeFocused()
  // The graph title is bold: so is the editor, and Bold shows pressed.
  expect(Number(await weight(editor))).toBeGreaterThanOrEqual(700)
  await expect(editor).toHaveCSS('font-family', /Liberation Sans/)
  await expect(formatButton(page, 'Bold')).toHaveAttribute('aria-pressed', 'true')

  // "activity" not bold: a regular run in the editor and on the graph.
  await page.keyboard.press('ArrowRight')
  await press(page, 'Shift+ArrowLeft', 8)
  await formatButton(page, 'Bold').click()
  await expect(formatButton(page, 'Bold')).toHaveAttribute('aria-pressed', 'false')
  const regular = editor.locator('span[data-bold="false"]')
  await expect(regular).toHaveText('activity')
  expect(Number(await weight(regular))).toBeLessThan(700)
  await page.keyboard.press('Enter')
  await expect(editor).toBeHidden()
  const weights = await title
    .locator('tspan')
    .evaluateAll((els) => els.map((e) => [e.textContent, e.getAttribute('font-weight')]))
  // The canvas writes weights as numbers (exported SVG: bold or none).
  expect(weights).toEqual([
    ['Enzyme ', '700'],
    ['activity', '400'],
  ])

  // Reopened, the word reads as not bold and the rest as bold; Bold on again merges it back.
  await dblclickOn(title)
  await page.keyboard.press('ArrowRight')
  await press(page, 'Shift+ArrowLeft', 3)
  await expect(formatButton(page, 'Bold')).toHaveAttribute('aria-pressed', 'false')
  await page.keyboard.press('ControlOrMeta+a')
  await expect(formatButton(page, 'Bold')).toHaveAttribute('aria-pressed', 'false')
  await formatButton(page, 'Bold').click()
  await page.keyboard.press('Enter')
  await expect(title.locator('tspan')).toHaveText(['Enzyme activity'])
})

test('a text box’s lines align from the toolbar with its text, in one undo step', async ({
  page,
}) => {
  await openGraph(page, SCATTER.example, SCATTER.graph)
  await menu(page, 'Insert', 'Text')
  const box = canvas(page).locator('text[data-id^="annotation/"]').last()
  await expect(box).toHaveText('Text')
  await dblclickOn(box)
  const editor = page.getByRole('textbox', { name: 'Edit text' })
  await expect(editor).toBeFocused()
  await expect(formatButton(page, 'Align left')).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.type('A longer line')
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.type('short')
  await formatButton(page, 'Align right').click()
  await expect(formatButton(page, 'Align right')).toHaveAttribute('aria-pressed', 'true')
  await expect(formatButton(page, 'Align left')).toHaveAttribute('aria-pressed', 'false')
  await expect(editor).toHaveCSS('text-align', 'right')
  await page.keyboard.press('Enter')
  await expect(editor).toBeHidden()

  const drawn = await runs(box)
  expect(drawn.map((r) => r.text)).toEqual(['A longer line', 'short'])
  // Right-aligned: the short line starts further right.
  expect(drawn[1]!.x).toBeGreaterThan(drawn[0]!.x + 10)
  await expect(page.getByRole('button', { name: /^Undo Edit text/ })).toBeVisible()
  await undo(page)
  await expect(box).toHaveText('Text')
})
