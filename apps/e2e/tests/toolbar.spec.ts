import type { Page } from '@playwright/test'
import { expect, openExample, test } from './fixtures.ts'
import {
  analyze,
  appIsMac,
  dialog,
  menuItem,
  menuPanel,
  newTable,
  openMenu,
  pressShortcut,
  runMenu,
  tool,
  toolbar,
} from './helpers-data.ts'
import {
  canvas,
  clickOn,
  formatPanel,
  inWindow,
  newGraph,
  openGraph,
  openSheet,
} from './helpers-graph.ts'

// Roadmap 43: the labelled toolbar (a label under each icon; View › Toolbar › Icons only,
// remembered), the app's tooltips (name, shortcut, why a button is disabled; on hover and on
// keyboard focus), split buttons (New graph ▾, Analyze ▾, Export ▾), the Format button named by
// the selection, and view toolbars that keep their height when the selection changes.

const tooltip = (page: Page) => page.getByRole('tooltip')
const labels = (page: Page) => toolbar(page).locator('.tool-label')

test('the toolbar labels its buttons; tooltips give the shortcut on focus and hover, and why a button is disabled', async ({
  page,
}) => {
  await page.goto('/')
  const isMac = await appIsMac(page)
  await expect(labels(page)).toHaveText([
    'New table',
    'Import',
    'Open',
    'Save',
    'Undo',
    'Redo',
    'Analyze',
    'New graph',
    'Function',
    'Layout',
  ])
  // The main buttons are at least 32 px wide, on one row at this width.
  const mains = toolbar(page).locator('.tool-button:not(.split-arrow)')
  const tops = new Set<number>()
  for (const b of await mains.all()) {
    const r = (await b.boundingBox())!
    expect(r.width).toBeGreaterThanOrEqual(32)
    tops.add(Math.round(r.y))
  }
  expect(tops.size).toBe(1)
  // No native titles: the app's tooltip replaces them.
  await expect(toolbar(page).locator('button[title]')).toHaveCount(0)

  // Keyboard focus: the tooltip at once, with the shortcut; Escape hides it.
  await page.keyboard.press('Shift')
  await tool(page, 'Open…').focus()
  await expect(tooltip(page)).toHaveText(isMac ? /^Open…⌘O$/ : /^Open…Ctrl\+O$/)
  await expect(tool(page, 'Open…')).toHaveAccessibleDescription(/^Open…\s*(⌘O|Ctrl\+O)$/)
  await page.keyboard.press('Escape')
  await expect(tooltip(page)).toHaveCount(0)
  await tool(page, 'Open…').blur()

  // The pointer resting on a button.
  await tool(page, 'Save').hover()
  await expect(tooltip(page)).toHaveText(isMac ? /^Save⌘S/ : /^SaveCtrl\+S/)
  // A disabled button says why.
  await tool(page, 'Analyze…').locator('xpath=..').hover()
  await expect(tooltip(page)).toHaveText(/^Analyze….*Open a data table first$/)
  await page.mouse.move(600, 600)
  await expect(tooltip(page)).toHaveCount(0)

  // Import data… is on the toolbar too (it opens the file picker).
  await expect(tool(page, 'Import data…')).toBeEnabled()
})

test('View › Toolbar › Icons only is remembered across reloads', async ({ page }) => {
  await page.goto('/')
  await expect(labels(page)).toHaveCount(10)
  await runMenu(page, 'View', 'Toolbar', 'Icons only')
  await expect(labels(page)).toHaveCount(0)
  // The same buttons, by the same names, with the same tooltips.
  await expect(tool(page, 'New data table…')).toBeVisible()
  await page.keyboard.press('Shift')
  await tool(page, 'New data table…').focus()
  await expect(tooltip(page)).toHaveText('New data table…')

  await page.reload()
  await expect(tool(page, 'New data table…')).toBeVisible()
  await expect(labels(page)).toHaveCount(0)
  const view = await openMenu(page, 'View')
  await menuItem(view, 'Toolbar').click()
  await expect(menuItem(menuPanel(page, 'Toolbar'), 'Icons only')).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')

  await runMenu(page, 'View', 'Toolbar', 'Icons only')
  await expect(labels(page)).toHaveCount(10)
  await page.reload()
  await expect(labels(page)).toHaveCount(10)
})

test('split buttons: Analyze ▾ and New graph ▾ offer the last choices, Export ▾ the formats', async ({
  page,
}) => {
  // Chromium's save picker can't be driven by automation: without it, a download (export.spec).
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true })
  })
  await page.goto('/')
  await newTable(page, { kind: 'Column', name: 'Weights', sample: true })

  // Nothing chosen yet; the menu opens and closes by keyboard, focus back on ▾.
  const recentAnalyses = tool(page, 'Recent analyses')
  await expect(recentAnalyses).toHaveAttribute('aria-haspopup', 'menu')
  await recentAnalyses.focus()
  await page.keyboard.press('Enter')
  const analyses = menuPanel(page, 'Recent analyses')
  await expect(analyses).toBeVisible()
  await expect(menuItem(analyses, 'No recent analyses')).toBeDisabled()
  await expect(menuItem(analyses, 'Analyze…')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(analyses).toBeHidden()
  await expect(recentAnalyses).toBeFocused()

  // An analysis run is offered again, and opens preselected.
  await analyze(page, 'One-way ANOVA (and nonparametric)')
  await openSheet(page, 'Weights', 'Data Tables')
  await recentAnalyses.click()
  await menuItem(analyses, 'One-way ANOVA (and nonparametric)…').click()
  const d = dialog(page, 'Analyze “Weights”')
  await expect(
    d.getByRole('group', { name: 'Could a treatment change how much values vary?' }),
  ).toBeVisible()
  await d.getByRole('button', { name: 'Cancel' }).click()
  await expect(d).toBeHidden()

  // A graph type chosen in the builder is offered again, the builder opening on it.
  const recentGraphs = tool(page, 'Recent graph types')
  const graphTypes = menuPanel(page, 'Recent graph types')
  await recentGraphs.click()
  await expect(menuItem(graphTypes, 'No recent graph types')).toBeDisabled()
  await page.keyboard.press('Escape')
  await newGraph(page, 'Violin with box')

  // Export ▾ on the graph: the four formats straight away.
  await tool(page, 'Export as').click()
  const formats = menuPanel(page, 'Export as')
  await expect(formats.getByRole('menuitem')).toHaveText([
    'SVG…',
    'PDF…',
    'PNG (300 dpi)…',
    'TIFF (300 dpi)…',
  ])
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    menuItem(formats, 'TIFF (300 dpi)…').click(),
  ])
  expect(download.suggestedFilename()).toMatch(/\.tif$/)

  await openSheet(page, 'Weights', 'Data Tables')
  await recentGraphs.click()
  await menuItem(graphTypes, 'Violin with box…').click()
  const builder = dialog(page, /^(New|Another) graph of/)
  await expect(
    builder
      .getByRole('radiogroup', { name: 'Presets' })
      .getByRole('radio', { name: 'Violin with box', exact: true }),
  ).toHaveAttribute('aria-checked', 'true')
  await builder.getByRole('button', { name: 'Cancel' }).click()
  await expect(builder).toBeHidden()
})

test('the Format button is named by the selection and has a shortcut', async ({ page }) => {
  const svg = await openGraph(page, 'getting-started', 'Dose response (bars)')
  const isMac = await appIsMac(page)
  const format = tool(page, /^Format .+…$/)
  await expect(format).toHaveAccessibleName('Format graph…')
  await expect(format.locator('.tool-label')).toHaveText('Format graph')
  await clickOn(svg.locator('[data-id="axis/y/line"]'))
  await expect(format).toHaveAccessibleName('Format Y axis…')
  await expect(format.locator('.tool-label')).toHaveText('Format Y axis')
  await page.keyboard.press('Shift')
  await format.focus()
  await expect(tooltip(page)).toHaveText(
    new RegExp(`^Format Y axis…${isMac ? '⇧⌘E' : 'Ctrl\\+Shift\\+E'}`),
  )
  await format.blur()
  // ⇧⌘E shows the Format panel at the selection, as the button does (roadmap 46); its Open in
  // window, the dialog on the same tab.
  await pressShortcut(page, 'Mod+Shift+E')
  await expect(formatPanel(page).getByRole('heading', { level: 2 })).toHaveText('Y axis')
  const axes = await inWindow(page, 'Format axes')
  await expect(axes).toBeVisible()
  await expect(axes.getByRole('tab', { name: 'Y axis', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await axes.getByRole('button', { name: 'Cancel' }).click()
  await expect(axes).toBeHidden()
  // The Format menu: the selection first, then the graph and the axes, as in the context menu.
  const menu = await openMenu(page, 'Format')
  await expect(menu.getByRole('menuitem').first()).toHaveAccessibleName(/^Format Y axis…/)
  await expect(menuItem(menu, 'Format graph…')).toBeEnabled()
  await expect(menuItem(menu, 'Format axes…')).toBeEnabled()
  await page.keyboard.press('Escape')
  // Nothing selected: the graph.
  await page.locator('.graph-view .canvas').click({ position: { x: 4, y: 4 } })
  await expect(format).toHaveAccessibleName('Format graph…')
  await expect(format.locator('.tool-label')).toHaveText('Format graph')
})

test.describe('at 1024 px', () => {
  test.use({ viewport: { width: 1024, height: 768 } })

  test('the selection never moves the graph or the page: the view toolbars keep their height', async ({
    page,
  }) => {
    await openExample(page, 'getting-started')
    // The toolbar fits: no part of it beyond the window.
    const bar = (await toolbar(page).boundingBox())!
    expect(bar.x + bar.width).toBeLessThanOrEqual(1024)
    for (const b of await toolbar(page).getByRole('button').all())
      expect((await b.boundingBox())!.x + (await b.boundingBox())!.width).toBeLessThanOrEqual(1024)

    await openSheet(page, 'Dose response (bars)', 'Graphs')
    const svg = canvas(page)
    const graphTop = async () => (await svg.boundingBox())!.y
    const before = await graphTop()
    // Roadmap 45: the format bar under the view toolbar keeps its height too, and fits.
    const formatBar = page.getByTestId('format-bar')
    const barHeight = async () => (await formatBar.boundingBox())!.height
    const height = await barHeight()
    const fits = async () => {
      for (const b of await formatBar.locator('[data-bar-item]').all())
        expect((await b.boundingBox())!.x + (await b.boundingBox())!.width).toBeLessThanOrEqual(
          1024,
        )
    }
    await fits()
    await clickOn(svg.locator('[data-id="axis/y/title"]'))
    await expect(page.locator('.selection-hint')).toContainText('selected')
    expect(await graphTop()).toBe(before)
    expect(await barHeight()).toBe(height)
    // A data set (a bar), then several elements of different kinds: the same.
    await clickOn(svg.locator('rect[data-id^="series/"][data-id$="/bar"]').first())
    await expect(page.locator('.selection-hint')).toContainText('Data set selected')
    expect(await graphTop()).toBe(before)
    expect(await barHeight()).toBe(height)
    await page.keyboard.press(`${(await appIsMac(page)) ? 'Meta' : 'Control'}+A`)
    await expect(page.locator('.selection-hint')).toContainText('elements selected')
    expect(await graphTop()).toBe(before)
    expect(await barHeight()).toBe(height)
    await fits()

    await openSheet(page, 'Figure 1', 'Layouts')
    const pageSvg = page.getByRole('img', { name: 'Layout page' })
    await expect(pageSvg).toBeVisible()
    const pageTop = async () => (await pageSvg.boundingBox())!.y
    const top = await pageTop()
    const item = (i: number) => pageSvg.getByTestId(`layout-item-${i}`)
    await item(0).click()
    await expect(page.getByRole('heading', { name: 'Graph on page' })).toBeVisible()
    expect(await pageTop()).toBe(top)
    expect(await barHeight()).toBe(height)
    await item(1).click({ modifiers: ['Shift'] })
    await expect(page.getByRole('toolbar', { name: 'Arrange the selected graphs' })).toBeVisible()
    expect(await pageTop()).toBe(top)
    expect(await barHeight()).toBe(height)
    // Beside the page's inspector the strip scrolls sideways (its scroll bar hidden): the focused
    // control is scrolled into view, the strip never wider than the view.
    const strip = (await formatBar.boundingBox())!
    expect(strip.x + strip.width).toBeLessThanOrEqual(1024)
    const last = formatBar.locator('[data-bar-item]:not(:disabled)').last()
    await last.focus()
    const f = (await last.boundingBox())!
    expect(f.x + f.width).toBeLessThanOrEqual(strip.x + strip.width + 0.5)
    // The hint's whole text is in its tooltip.
    await pageSvg.click({ position: { x: 3, y: 3 } })
    await page.getByRole('main').locator('.hint').hover()
    await expect(tooltip(page)).toHaveText(/^Drag items to move them .* select several\.$/)
    expect(await pageTop()).toBe(top)
  })
})
