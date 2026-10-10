import type { Download, Page } from '@playwright/test'
import { expect, navigator, sheets, test } from './fixtures.ts'
import { runMenu } from './helpers-data.ts'
import { canvas, dialog, formatPanel, openGraph } from './helpers-graph.ts'

// Roadmap 47 (UX findings N8, N9): getting started — the checklist card at the bottom of the
// navigator on a new project, its steps ticking as a table, a graph, an analysis, a format edit
// and an export are made, "Show me" doing the next thing, × and Help › Getting started; the
// Examples dialog's cards; the format bar folding into More ▾ beside the docked Format panel.

test.beforeEach(async ({ page }) => {
  // Chromium's File System Access save picker can't be driven by automation: without it the web
  // platform falls back to a download (as in WebKit and Firefox).
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true })
  })
})

const card = (page: Page) => page.getByRole('region', { name: 'Getting started' })
const count = (page: Page) => card(page).locator('.gs-count')
const step = (page: Page, id: string) => card(page).locator(`li[data-step="${id}"]`)
const showMe = (page: Page, id: string) =>
  step(page, id).getByRole('button', { name: 'Show me', exact: true })

test('the checklist on a new project: Show me does each step, and each ticks itself off', async ({
  page,
}) => {
  await page.goto('/')
  await expect(card(page)).toBeVisible()
  await expect(count(page)).toHaveText('0 of 5')
  // It never takes the focus.
  expect(await card(page).evaluate((c) => c.contains(document.activeElement))).toBe(false)

  // 1, 2: New data table… (sample data ticked in a new project), which makes its graph too.
  await showMe(page, 'data').click()
  const newTable = dialog(page, 'New data table')
  await expect(newTable).toBeVisible()
  await newTable.getByRole('button', { name: 'Create' }).click()
  await expect(newTable).toBeHidden()
  await expect(count(page)).toHaveText('2 of 5')
  await expect(step(page, 'data')).toHaveClass(/\bdone\b/)
  await expect(step(page, 'graph')).toHaveClass(/\bdone\b/)
  await expect(showMe(page, 'graph')).toHaveCount(0)

  // 3: Analyze… on the table.
  await showMe(page, 'analysis').click()
  const analyze = dialog(page, /^Analyze “/)
  await expect(analyze).toBeVisible()
  await analyze.getByRole('option', { name: 'Descriptive statistics', exact: true }).first().click()
  await analyze.getByRole('button', { name: 'OK', exact: true }).click()
  await expect(analyze).toBeHidden()
  await expect(count(page)).toHaveText('3 of 5')

  // 4: the graph shown and its Format panel open; a change made in the format bar.
  await showMe(page, 'format').click()
  await expect(canvas(page)).toBeVisible()
  await expect(formatPanel(page)).toBeVisible()
  await expect(count(page)).toHaveText('3 of 5')
  await page.getByTestId('format-bar').getByRole('button', { name: 'Bold', exact: true }).click()
  await expect(count(page)).toHaveText('4 of 5')

  // 5: Export… of the graph.
  await showMe(page, 'export').click()
  const exportDialog = dialog(page, /^Export “/)
  await expect(exportDialog).toBeVisible()
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    exportDialog.getByRole('button', { name: 'Export…' }).click(),
  ])
  expect((file as Download).suggestedFilename()).toMatch(/\.pdf$/)
  await expect(count(page)).toHaveText('5 of 5')
  await expect(card(page).getByRole('status')).toContainText('All done')

  // Hide this: gone, and still gone in a new project after a reload.
  await card(page).getByRole('button', { name: 'Hide this' }).click()
  await expect(card(page)).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Start a project' })).toBeVisible()
  await expect(card(page)).toHaveCount(0)
})

test('× hides the card for good, Help › Getting started shows it again; examples don’t show it', async ({
  page,
}) => {
  await page.goto('/')
  await expect(card(page)).toBeVisible()
  // Folded and opened from its header.
  const toggle = card(page).getByRole('button', { name: /^Getting started/ })
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(step(page, 'data')).toHaveCount(0)
  await toggle.click()
  await expect(step(page, 'data')).toBeVisible()
  // Audit 3 (A8): hidden from the keyboard, the focus stays in the navigator.
  await card(page).getByRole('button', { name: 'Hide getting started' }).focus()
  await page.keyboard.press('Enter')
  await expect(card(page)).toHaveCount(0)
  await expect
    .poll(() => page.evaluate(() => !!document.activeElement?.closest('.navigator-slot')))
    .toBe(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Start a project' })).toBeVisible()
  await expect(card(page)).toHaveCount(0)

  await runMenu(page, 'Help', 'Getting started')
  await expect(card(page)).toBeVisible()
  await expect(count(page)).toHaveText('0 of 5')

  // An example is not a new project: no card.
  await page.goto('/?example=parts-of-whole')
  await expect(sheets(page).first()).toBeVisible()
  await expect(card(page)).toHaveCount(0)
  // Asked for: shown, with what the example has done ticked.
  await runMenu(page, 'Help', 'Getting started')
  await expect(card(page)).toBeVisible()
  await expect(step(page, 'data')).toHaveClass(/\bdone\b/)
  await expect(step(page, 'graph')).toHaveClass(/\bdone\b/)
})

test('Open an example… shows cards with thumbnails; Tab and arrow keys move, Enter opens one', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Open an example…' }).click()
  const d = dialog(page, 'Examples')
  await expect(d).toBeVisible()
  const cards = d.locator('.example-card')
  const first = cards.first()
  await expect(first).toHaveAccessibleName('Getting started: column data')
  await expect(first).toContainText('Start here')
  await expect(d.getByRole('heading', { name: 'Published data' })).toBeVisible()
  // Every card of the app's examples has its thumbnail, drawn.
  const images = d.locator('.example-thumb img')
  await expect(images).toHaveCount(await cards.count())
  await first.scrollIntoViewIfNeeded()
  await expect
    .poll(() => first.locator('img').evaluate((i: HTMLImageElement) => i.naturalWidth))
    .toBeGreaterThan(0)

  // Audit 3 (A9): every card in the tab order — Tab reaches the next one, and the published
  // data's — and arrows move between them too.
  await first.focus()
  const webkit = page.context().browser()?.browserType().name() === 'webkit'
  await page.keyboard.press(webkit ? 'Alt+Tab' : 'Tab')
  await expect(cards.nth(1)).toBeFocused()
  const published = d
    .locator('.examples-section')
    .filter({ has: page.getByRole('heading', { name: 'Published data' }) })
    .locator('.example-card')
    .first()
  await published.focus()
  expect(await published.evaluate((e) => (e as HTMLElement).tabIndex)).toBe(0)
  await first.focus()
  await page.keyboard.press('ArrowRight')
  await expect(cards.nth(1)).toBeFocused()
  await expect(cards.nth(1)).toHaveAccessibleName('Grouped data')
  // ↓: the card below it, in the next row.
  await page.keyboard.press('ArrowDown')
  const at = await cards.evaluateAll((cs) => cs.indexOf(document.activeElement as HTMLElement))
  expect(at).toBeGreaterThan(1)
  const from = (await cards.nth(1).boundingBox())!
  const to = (await cards.nth(at).boundingBox())!
  expect(to.y).toBeGreaterThan(from.y)
  expect(Math.abs(to.x - from.x)).toBeLessThan(5)
  await page.keyboard.press('Home')
  await expect(first).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Enter')
  await expect(d).toBeHidden()
  await expect(
    navigator(page).getByText('Genotype × treatment', { exact: true }).first(),
  ).toBeVisible()
  // An example is not a new project.
  await expect(card(page)).toHaveCount(0)
})

test.describe('the format bar beside the docked Format panel', () => {
  test.use({ viewport: { width: 1210, height: 800 } })

  test('folds the groups that don’t fit into More ▾; nothing scrolls out of sight', async ({
    page,
  }) => {
    await openGraph(page, 'getting-started', 'Enzyme activity (scatter)')
    const bar = page.getByTestId('format-bar')
    await expect(bar.getByRole('button', { name: 'More format options', exact: true })).toHaveCount(
      0,
    )
    await bar.getByRole('button', { name: 'Format…', exact: true }).click()
    await expect(formatPanel(page)).toBeVisible()
    const more = bar.getByRole('button', { name: 'More format options', exact: true })
    await expect(more).toBeVisible()
    // Format… went first; the text controls stayed.
    await expect(bar.getByRole('button', { name: 'Format…', exact: true })).toHaveCount(0)
    await expect(bar.getByRole('button', { name: 'Bold', exact: true })).toBeVisible()
    // Every control in the bar is in sight: nothing scrolls.
    await expect
      .poll(() => bar.evaluate((b) => b.scrollWidth - b.clientWidth))
      .toBeLessThanOrEqual(0)
    const right = await bar.evaluate((b) => b.getBoundingClientRect().right)
    for (const item of await bar.locator('[data-bar-item]').all())
      expect((await item.boundingBox())!.x + (await item.boundingBox())!.width).toBeLessThanOrEqual(
        right + 0.5,
      )

    // More ▾ shows the folded groups' controls, which work as in the bar.
    await more.click()
    const folded = page.getByRole('toolbar', { name: 'More format options' })
    await expect(folded).toBeVisible()
    await expect(more).toHaveAttribute('aria-expanded', 'true')
    await expect(folded.getByRole('button', { name: 'Format painter' })).toBeVisible()
    await folded.getByRole('button', { name: 'Format…', exact: true }).click()
    await expect(formatPanel(page)).toBeVisible()
    // Escape closes it, the focus back on More.
    await more.click()
    await expect(folded).toBeHidden()
    await more.press('Enter')
    await expect(folded).toBeVisible()
    await expect(folded.locator(':focus')).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(folded).toBeHidden()
    await expect(more).toBeFocused()

    // The panel closed: room again, nothing folded.
    await formatPanel(page).getByRole('button', { name: 'Close the Format panel' }).click()
    await expect(formatPanel(page)).toHaveCount(0)
    await expect(more).toHaveCount(0)
    await expect(bar.getByRole('button', { name: 'Format…', exact: true })).toBeVisible()
  })
})
