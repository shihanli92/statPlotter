import type { Locator, Page } from '@playwright/test'
import { expect, navigator, openExample, test } from './fixtures.ts'
import { dialog } from './helpers-data.ts'
import {
  canvas,
  formatPanel,
  preview as formatPreview,
  inWindow,
  menu,
  openSheet,
  pointMarks,
} from './helpers-graph.ts'

// Roadmap 41: the app's colours follow the system or Preferences (System / Light / Dark); graphs,
// pages, previews and thumbnails stay on white paper; hover cards read in both.

test.use({ viewport: { width: 1400, height: 1000 } })

const theme = (page: Page) => page.locator('html')
/** A computed colour of an element, as "rgb(r, g, b)". */
const colour = (l: Locator, prop: 'backgroundColor' | 'color' | 'fill') =>
  l.evaluate((el, p) => getComputedStyle(el)[p as 'color'], prop)
/** The relative luminance of a computed "rgb(…)" colour (0 black … 1 white). */
const luminance = (rgb: string) => {
  const [r, g, b] = (rgb.match(/[\d.]+/g) ?? []).slice(0, 3).map((v) => {
    const c = Number(v) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number]
  return (x + 0.05) / (y + 0.05)
}

async function choose(page: Page, label: 'As the system (light or dark)' | 'Light' | 'Dark') {
  await menu(page, 'Edit', 'Preferences…')
  const prefs = dialog(page, 'Preferences')
  await prefs.getByLabel('Colours').selectOption({ label })
  await prefs.getByRole('button', { name: 'Save' }).click()
  await expect(prefs).toBeHidden()
}

test.describe('with a dark system', () => {
  test.use({ colorScheme: 'dark' })

  test('follows the system, or the colours chosen in Preferences, kept after a reload', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(theme(page)).toHaveAttribute('data-theme', 'dark')
    const body = page.locator('body')
    expect(luminance(await colour(body, 'backgroundColor'))).toBeLessThan(0.05)

    await choose(page, 'Light')
    await expect(theme(page)).toHaveAttribute('data-theme', 'light')
    expect(luminance(await colour(body, 'backgroundColor'))).toBeGreaterThan(0.8)
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Start a project' })).toBeVisible()
    await expect(theme(page)).toHaveAttribute('data-theme', 'light')

    await choose(page, 'As the system (light or dark)')
    await expect(theme(page)).toHaveAttribute('data-theme', 'dark')
  })

  test('graphs, pages, previews and thumbnails stay on white paper', async ({ page }) => {
    await openExample(page, 'getting-started')
    await openSheet(page, 'Dose response (bars)', 'Graphs')
    const svg = canvas(page)
    await expect(svg).toBeVisible()
    // The paper is white; around it the canvas is dark, and the paper has a shadow.
    expect(await colour(svg.locator('rect').first(), 'fill')).toBe('rgb(255, 255, 255)')
    expect(luminance(await colour(page.locator('.canvas'), 'backgroundColor'))).toBeLessThan(0.1)
    expect(await svg.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe('none')
    // The graph's own text keeps its colour (black on paper), as exported.
    const title = svg.locator('text').first()
    expect(await colour(title, 'fill')).toBe('rgb(0, 0, 0)')

    // Roadmap 46: the Format panel is the app's (dark), the graph beside it stays on white paper.
    await menu(page, 'Format', 'Format graph…')
    expect(luminance(await colour(formatPanel(page), 'backgroundColor'))).toBeLessThan(0.1)
    expect(await colour(svg.locator('rect').first(), 'fill')).toBe('rgb(255, 255, 255)')
    // The Format dialog's preview.
    const format = await inWindow(page, /^Format graph/)
    const preview = formatPreview(page)
    await expect(preview).toBeVisible()
    expect(await colour(preview.locator('rect').first(), 'fill')).toBe('rgb(255, 255, 255)')
    // Roadmap 46 (V9): its paper has a 1 px edge (the shadow doesn't show on the dark pane).
    expect(
      await preview.evaluate((el) => {
        const s = getComputedStyle(el)
        return `${s.outlineStyle} ${s.outlineWidth}`
      }),
    ).toBe('solid 1px')
    await format.getByRole('button', { name: 'Cancel' }).click()

    // A layout page.
    await openSheet(page, 'Figure 1', 'Layouts')
    const pageSvg = page.locator('svg.scene.page')
    await expect(pageSvg).toBeVisible()
    expect(await colour(pageSvg.locator('rect').first(), 'fill')).toBe('rgb(255, 255, 255)')

    // Thumbnails in the navigator.
    await navigator(page).getByRole('button', { name: 'Thumbnails', exact: true }).click()
    const thumb = navigator(page).locator('.nav-thumb').first()
    await expect(thumb.locator('img')).toBeVisible()
    expect(await colour(thumb, 'backgroundColor')).toBe('rgb(255, 255, 255)')
  })

  test('hover cards read in the dark colours', async ({ page }) => {
    await openExample(page, 'multiple-variables')
    await openSheet(page, 'Age, BMI and weight (bubble plot)', 'Graphs')
    await expect(pointMarks(canvas(page)).first()).toBeAttached()
    await page.getByRole('main').locator('.canvas').focus()
    await page.keyboard.press(']')
    const card = page.getByTestId('hover-card')
    await expect(card).toBeVisible()
    const bg = await colour(card, 'backgroundColor')
    expect(luminance(bg)).toBeLessThan(0.05)
    expect(contrast(await colour(card, 'color'), bg)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(await colour(card.locator('dt').first(), 'color'), bg)).toBeGreaterThan(4.5)
  })
})

test.describe('with a light system', () => {
  test.use({ colorScheme: 'light' })

  test('Dark in Preferences turns the app dark; the graph stays as it is', async ({ page }) => {
    await openExample(page, 'getting-started')
    await openSheet(page, 'Dose response (bars)', 'Graphs')
    const svg = canvas(page)
    const before = await svg.innerHTML()
    await expect(theme(page)).toHaveAttribute('data-theme', 'light')
    await choose(page, 'Dark')
    await expect(theme(page)).toHaveAttribute('data-theme', 'dark')
    expect(luminance(await colour(page.locator('body'), 'backgroundColor'))).toBeLessThan(0.05)
    // The drawing is the same, mark for mark.
    expect(await svg.innerHTML()).toBe(before)
  })
})
