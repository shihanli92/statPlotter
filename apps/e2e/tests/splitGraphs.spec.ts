import type { Locator, Page } from '@playwright/test'
import { expect, openExample, test } from './fixtures.ts'
import { cell } from './helpers-data.ts'
import {
  canvas,
  dialog,
  inWindow,
  menu,
  openBuilder,
  openSheet,
  pointMarks,
  pointOn,
  preview,
  sheet,
  undo,
} from './helpers-graph.ts'

// One graph per level (roadmap 34d): a graph of the trial table split into a set — from the
// builder and from a graph's menu — on a page, a new level in the table getting its graph (undone
// with the edit); hovering a point shows its whole row, and Go to row selects it in the table.

test.use({ viewport: { width: 1400, height: 1000 } })

const TRIAL = 'Blood pressure trial'
const BUBBLE = 'Age, BMI and weight (bubble plot)'
const pageSvg = (page: Page) => page.getByRole('img', { name: 'Layout page' })
const items = (page: Page) => pageSvg(page).locator('[data-testid^="layout-item-"]')
const card = (page: Page) => page.getByTestId('hover-card')

/** Hovers a point of a graph's canvas (the card of its row). */
async function hover(page: Page, point: Locator): Promise<Locator> {
  const p = await pointOn(point)
  await page.mouse.move(p.x, p.y)
  await expect(card(page)).toBeVisible()
  return card(page)
}

test('from the builder: a graph per level of Sex on a page; a new level gets its graph', async ({
  page,
}) => {
  await openExample(page, 'multiple-variables')
  await openSheet(page, TRIAL, 'Data Tables')
  const b = await openBuilder(page)
  await b.getByRole('radio', { name: 'Box with points by group', exact: true }).click()
  await b.getByRole('radio', { name: /^One graph per level of a text variable/ }).check()
  await expect(b.getByLabel('Variable', { exact: true })).toHaveValue(/.+/)
  await b.getByLabel('Variable', { exact: true }).selectOption({ label: 'Sex' })
  await b.getByRole('button', { name: 'Create 2 graphs', exact: true }).click()
  await expect(b).toBeHidden()
  // The page with the two graphs, one per level, in a grid.
  await expect(items(page)).toHaveCount(2)
  await expect(sheet(page, `${TRIAL} – F`, 'Graphs')).toBeVisible()
  await expect(sheet(page, `${TRIAL} – M`, 'Graphs')).toBeVisible()
  await expect(page.getByText(/^2 graphs in a grid/)).toBeVisible()
  // Hovering a point of a graph on the page: its row.
  const onPage = await pageSvg(page).locator('path[data-id*="/point/"]').first().boundingBox()
  await page.mouse.move(onPage!.x + onPage!.width / 2, onPage!.y + onPage!.height / 2)
  await expect(card(page).locator('dt', { hasText: /^Sex$/ })).toBeVisible()
  await page.mouse.move(2, 400)

  // A new level in the table: its graph comes with the edit, on the page too.
  await openSheet(page, TRIAL, 'Data Tables')
  // Row 1's Sex (after the row title and Group).
  await cell(page, 0, 2).click()
  await page.keyboard.type('X')
  await page.keyboard.press('Enter')
  await expect(sheet(page, `${TRIAL} – X`, 'Graphs')).toBeVisible()
  // The page is named after the builder's name: the table's, as no graph has it (roadmap 43).
  await openSheet(page, `${TRIAL} (one per level of Sex)`, 'Layouts')
  await expect(items(page)).toHaveCount(3)
  // One undo step takes the edit and the graph away.
  await undo(page)
  await expect(sheet(page, `${TRIAL} – X`, 'Graphs')).toHaveCount(0)
  await expect(items(page)).toHaveCount(2)
})

test('from a graph’s menu: Split into one graph per…', async ({ page }) => {
  await openExample(page, 'multiple-variables')
  await openSheet(page, BUBBLE, 'Graphs')
  const svg = canvas(page)
  await expect(svg).toBeVisible()
  // Right-click around the graph: the graph's own menu.
  const area = page.getByRole('main').locator('.canvas')
  const b = await area.boundingBox()
  await page.mouse.click(b!.x + 8, b!.y + 8, { button: 'right' })
  await page.getByRole('menuitem', { name: /^Split into one graph per/ }).click()
  const d = dialog(page, /^Split “/)
  await d.getByLabel('Variable', { exact: true }).selectOption({ label: 'Sex' })
  await expect(d.getByLabel(/^Share the Y axis range/)).toBeChecked()
  await d.getByRole('button', { name: 'Make 2 graphs', exact: true }).click()
  await expect(d).toBeHidden()
  await expect(items(page)).toHaveCount(2)
  await expect(sheet(page, `${TRIAL} – F`, 'Graphs')).toBeVisible()
  // The original graph stays.
  await expect(sheet(page, BUBBLE, 'Graphs')).toBeVisible()
})

test('hovering a point shows its whole row; Go to row selects it in the table', async ({
  page,
}) => {
  await openExample(page, 'multiple-variables')
  await openSheet(page, BUBBLE, 'Graphs')
  const svg = canvas(page)
  const point = svg.locator('[data-id$="/point/18"]').first()
  const c = await hover(page, point)
  // Every variable of row 19 (P19), calculated ones too.
  await expect(c.getByText('P19', { exact: true })).toBeVisible()
  for (const name of ['Group', 'Sex', 'Age', 'BMI', 'Change', 'Treated'])
    await expect(c.locator('dt', { hasText: new RegExp(`^${name}`) }).first()).toBeVisible()
  await c.getByRole('button', { name: 'Go to row' }).click()
  // The table, row 19 selected (its row number and every cell).
  const row = page.getByRole('main').getByRole('grid').locator('tr[data-row="18"]')
  await expect(row).toBeVisible()
  await expect(row.locator('td.sel').first()).toBeVisible()
  await expect(row.locator('td.sel')).not.toHaveCount(0)
})

test('the keyboard: ] selects a point, its card stays, Tab reaches Go to row', async ({
  page,
  browserName,
}) => {
  await openExample(page, 'multiple-variables')
  await openSheet(page, BUBBLE, 'Graphs')
  await expect(pointMarks(canvas(page)).first()).toBeAttached()
  await page.getByRole('main').locator('.canvas').focus()
  await page.keyboard.press(']')
  await expect(card(page)).toBeVisible()
  await expect(card(page)).toHaveAttribute('role', 'status')
  // Safari moves Tab between fields only; Option-Tab reaches buttons (WebKit's default).
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab')
  await expect(card(page).getByRole('button', { name: 'Go to row' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('main').getByRole('grid').locator('tr td.sel').first()).toBeVisible()
})

test('a bar’s card: the mean, SD and n the graph draws', async ({ page }) => {
  await openExample(page, 'multiple-variables')
  await openSheet(page, 'Change by group', 'Graphs')
  const bar = canvas(page).locator('[data-id^="series/"][data-id*="/bar"]').first()
  const p = await pointOn(bar)
  await page.mouse.move(p.x, p.y)
  const c = card(page)
  await expect(c).toBeVisible()
  await expect(c.locator('dt', { hasText: /^Mean$/ })).toBeVisible()
  await expect(c.locator('dt', { hasText: /^n$/ })).toBeVisible()
  // Summaries have no single row to go to.
  await expect(c.getByRole('button', { name: 'Go to row' })).toHaveCount(0)
})

test('the Format preview shows a hovered point’s row too', async ({ page }) => {
  await openExample(page, 'multiple-variables')
  await openSheet(page, BUBBLE, 'Graphs')
  await menu(page, 'Format', 'Format graph…')
  const f = await inWindow(page, /^Format graph/)
  const point = preview(page).locator('[data-id$="/point/18"]').first()
  const p = await pointOn(point)
  await page.mouse.move(p.x, p.y)
  await expect(f.getByTestId('hover-card').getByText('P19', { exact: true })).toBeVisible()
  // No Go to row here: the dialog's changes aren't applied yet.
  await expect(f.getByTestId('hover-card').getByRole('button')).toHaveCount(0)
})
