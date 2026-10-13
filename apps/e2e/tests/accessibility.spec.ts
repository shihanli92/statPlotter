import { fileURLToPath } from 'node:url'
import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { expect, navigator, openExample, test } from './fixtures.ts'
import {
  dialog,
  editDialog,
  expectUpToDate,
  okButton,
  openDetails,
  pressShortcut,
  runMenu,
  tool,
  typeCells,
} from './helpers-data.ts'
import {
  canvas,
  clickOn,
  colourButton,
  colourPopover,
  expand,
  formatPanel,
  inWindow,
  layerList,
  menu,
  openSheet,
  panelHeading,
  sectionToggle,
} from './helpers-graph.ts'

// Roadmap 41: axe (WCAG 2.1 A and AA) on the main screens, in the light and the dark colours;
// then the whole path by keyboard only: import a CSV, make a graph, run an analysis, export.
//
// Waivers (each with its reason; decision 620):
// - The graph, page and preview SVGs are pictures with an accessible name ("Graph", the page's
//   name); the shapes inside are drawn data, excluded from the scan (`.scene` contents), as their
//   colours are the user's and stay on white paper by design (decision 617).
// - The data grid's cells beyond the table (the empty rows to type into) repeat no content and
//   are scanned like the rest.

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url))

/**
 * axe's findings on the page as it is now (WCAG 2.0 / 2.1 A and AA), in one scan (audit 3, T5:
 * two scans a screen took Firefox past the time a test has).
 */
async function audit(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    // Dialogs have names (audit 2, U6): axe's rule for elements with a dialog role, a best
    // practice outside the WCAG tags, run in the same scan (a rule enabled by name runs whatever
    // the tags; set before them, as `options` replaces them).
    // Audit 4 (A21): headings in order and no empty table headers, best practices too.
    .options({
      rules: {
        'aria-dialog-name': { enabled: true },
        'heading-order': { enabled: true },
        'empty-table-header': { enabled: true },
      },
    })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    // Drawn data inside graph and page pictures (see the waivers above).
    .exclude('svg.scene > *')
    .exclude('svg.plot-icon-svg > *')
    .exclude('.nav-thumb img, .gallery-thumb img')
    .analyze()
  const ran = [results.passes, results.violations, results.incomplete, results.inapplicable]
  if (!ran.some((rs) => rs.some((r) => r.id === 'aria-dialog-name')))
    throw new Error('axe did not run aria-dialog-name')
  // The native dialogs axe's dialog-name rule leaves out.
  const unnamed = await page.locator('dialog[open]').evaluateAll((ds) =>
    ds
      .filter((d) => {
        const by = d.getAttribute('aria-labelledby')
        const label = by ? document.getElementById(by)?.textContent : d.getAttribute('aria-label')
        return !label?.trim()
      })
      .map((d) => `aria-dialog-name (serious): dialog.${d.className} — no accessible name`),
  )
  return results.violations
    .flatMap((v) =>
      v.nodes.map((n) => `${v.id} (${v.impact}): ${n.target.join(' ')} — ${n.failureSummary}`),
    )
    .concat(unnamed)
}

/** No findings on this screen (soft: every screen of a test is scanned). */
async function expectClean(page: Page, screen: string) {
  await page.evaluate(() => document.fonts.ready)
  expect.soft(await audit(page), screen).toEqual([])
}

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`${colorScheme} colours`, () => {
    test.use({ colorScheme })

    test('start screen', async ({ page }) => {
      await page.goto('/')
      await expect(page.getByRole('heading', { name: 'Start a project' })).toBeVisible()
      await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme)
      await expectClean(page, 'start screen')
    })

    test('table grid, graph view, layout page', async ({ page, browserName }) => {
      // Six screens or more, each scanned: Firefox's axe takes seconds a scan (audit 3, T5).
      test.slow(browserName === 'firefox', 'many screens scanned')
      await openExample(page, 'getting-started')
      await expect(page.getByRole('main').getByRole('grid')).toBeVisible()
      await expectClean(page, 'table grid')
      await openSheet(page, 'Dose response (bars)', 'Graphs')
      await expectClean(page, 'graph view')
      // Roadmap 43: the toolbar's tooltip (on keyboard focus) and a split button's menu.
      await page.keyboard.press('Shift')
      await tool(page, 'Export…').focus()
      await expect(page.getByRole('tooltip')).toBeVisible()
      await expectClean(page, 'toolbar tooltip')
      await tool(page, 'Export as').click()
      await expect(page.getByRole('menu', { name: 'Export as' })).toBeVisible()
      await expectClean(page, 'export menu')
      await page.keyboard.press('Escape')
      await expect(page.getByRole('menu', { name: 'Export as' })).toBeHidden()
      await openSheet(page, 'Figure 1', 'Layouts')
      await expect(page.locator('svg.scene.page')).toBeVisible()
      await expectClean(page, 'layout page')
      // The navigator's Family view: a tree (audit 2, U16).
      await navigator(page).getByRole('button', { name: 'Families', exact: true }).click()
      await expect(navigator(page).getByRole('tree')).toBeVisible()
      await expectClean(page, 'family view')
    })

    // Roadmap 45: the format bar showing mixed values (two titles of different sizes, two data
    // sets of different colours), and its colour menu.
    test('format bar with mixed values', async ({ page }) => {
      await openExample(page, 'getting-started')
      await openSheet(page, 'Dose response (bars)', 'Graphs')
      const bars = canvas(page).locator('rect[data-id^="series/"][data-id$="/bar"]')
      await clickOn(bars.nth(0))
      // Its hover card (shown once the pointer rests) gone before the next click.
      await page.mouse.move(1, 1)
      await expect(page.getByTestId('hover-card')).toHaveCount(0)
      await page.keyboard.down('Shift')
      await clickOn(bars.nth(1))
      await page.keyboard.up('Shift')
      const formatBar = page.getByTestId('format-bar')
      await expect(formatBar.getByRole('button', { name: /^Selected: 2 elements/ })).toBeVisible()
      await expect(formatBar.locator('.bar-swatch.mixed')).toHaveCount(1)
      await expectClean(page, 'format bar, data sets')
      await formatBar.getByRole('button', { name: 'Colour', exact: true }).click()
      // Roadmap 46: the colour popover (a dialog holding a listbox), as the panel's fields open.
      await expect(page.getByRole('dialog', { name: 'Fill colours' })).toBeVisible()
      await expectClean(page, 'format bar colour menu')
      await page.keyboard.press('Escape')
      await clickOn(canvas(page).locator('[data-id="title"]'))
      await page.keyboard.down('Shift')
      await clickOn(canvas(page).locator('[data-id="axis/y/title"]'))
      await page.keyboard.up('Shift')
      await expect(formatBar.getByRole('combobox', { name: 'Font size' })).toHaveValue('')
      await expectClean(page, 'format bar, mixed text')
    })

    test('Format dialog and analysis dialog', async ({ page, browserName }) => {
      // Six screens or more, each scanned: Firefox's axe takes seconds a scan (audit 3, T5).
      test.slow(browserName === 'firefox', 'many screens scanned')
      await openExample(page, 'getting-started')
      await openSheet(page, 'Dose response (bars)', 'Graphs')
      // Roadmap 46: Format… shows the docked panel; its "Open in window" the dialog.
      // Roadmap 46 (stage 2): by element — the graph's place, its layers listed first.
      await menu(page, 'Format', 'Format graph…')
      await expect(panelHeading(page)).toHaveText('Graph')
      await expect(layerList(formatPanel(page))).toBeVisible()
      await expectClean(page, 'Format panel')
      // The Y axis title: its axis' place, the Title section open; every section open, scanned.
      await clickOn(canvas(page).locator('[data-id="axis/y/title"]'))
      await expect(panelHeading(page)).toHaveText('Y axis')
      await expect(sectionToggle(formatPanel(page), 'Title')).toHaveAttribute(
        'aria-expanded',
        'true',
      )
      for (const title of ['Numbers', 'Ticks', 'Grid lines', 'Axis line and crossing'])
        await expand(formatPanel(page), title)
      await expectClean(page, 'Format panel, Y axis title')
      // Roadmap 46: a colour field's popover open, and the field search showing results.
      const panel = formatPanel(page)
      await colourButton(panel, 'Title colour').click()
      await expect(colourPopover(page).getByRole('listbox')).toBeFocused()
      await expectClean(page, 'colour popover')
      await page.keyboard.press('Escape')
      await expect(colourPopover(page)).toHaveCount(0)
      const search = panel.getByRole('combobox', { name: 'Search the Format options' })
      await search.fill('thousands')
      await expect(panel.getByRole('listbox', { name: 'Matching options' })).toBeVisible()
      await expectClean(page, 'field search results')
      await search.fill('zzzz')
      await expect(panel.getByRole('status')).toBeVisible()
      await expectClean(page, 'field search, no results')
      await search.fill('')
      const format = await inWindow(page, /^Format axes/)
      await expectClean(page, 'Format dialog')
      await format.getByRole('button', { name: 'Cancel' }).click()
      await openSheet(page, 'Enzyme activity', 'Data Tables')
      await tool(page, 'Analyze…').click()
      await expect(dialog(page, /^Analyze “/)).toBeVisible()
      await expectClean(page, 'analysis dialog')
    })

    // Audit 4 (A1, A7, A8, A9, A21): the Analyze dialog with its pictures — Guide me's
    // schematic, All analyses with the sketch, the schematic and the group chips — its results
    // (the summary and its effect plot, the details' tables), and a curve fit's Edit parameters
    // (the model picker, its goals).
    test('Analyze dialog with its pictures, the results, a curve fit’s parameters', async ({
      page,
      browserName,
    }) => {
      test.slow(browserName === 'firefox', 'many screens scanned')
      await page.setViewportSize({ width: 1440, height: 900 })
      await openExample(page, 'getting-started')
      await openSheet(page, 'Dose response (3 groups)', 'Data Tables')
      await tool(page, 'Analyze…').click()
      const d = dialog(page, /^Analyze “/)
      await d.getByRole('tab', { name: 'Guide me' }).click()
      await d.getByRole('button', { name: 'Are the groups different?' }).click()
      await d.getByRole('radio', { name: 'No, different subjects in each group' }).check()
      await d.getByRole('radio', { name: 'Measurements', exact: true }).check()
      await d.getByRole('radio', { name: 'No, similar scatter is expected' }).check()
      await d.getByRole('radio', { name: 'Each group with a control' }).check()
      await expect(d.locator('.schematic-figure')).toBeVisible()
      await expectClean(page, 'Guide me with its schematic')
      await d.getByRole('button', { name: 'Use this' }).click()
      await expect(d.locator('.sketch-panels')).toBeVisible()
      await expect(d.locator('.schematic-figure')).toBeVisible()
      await expect(d.getByRole('listbox', { name: 'Groups' })).toBeVisible()
      await expectClean(page, 'All analyses with the sketch and the schematic')
      await okButton(d).click()
      await expect(d).toBeHidden()
      await expectUpToDate(page)
      await expect(page.getByRole('main').getByRole('region', { name: 'Summary' })).toBeVisible()
      await openDetails(page)
      // Faded while updating: scanned once shown in full (its fade ends).
      await expect(page.getByRole('main').locator('.sheet')).toHaveCSS('opacity', '1')
      await expectClean(page, 'results with their details')

      await openExample(page, 'curve-fitting')
      await openSheet(page, 'Global fit (shared Hill slope)', 'Results')
      await page.getByRole('main').getByRole('button', { name: 'Edit parameters…' }).click()
      const edit = editDialog(page)
      await expect(edit.getByRole('tablist', { name: 'Goals' })).toBeVisible()
      await expectClean(page, 'curve fit’s Edit parameters')
    })

    test('Preferences and the import dialog', async ({ page }) => {
      await page.goto('/')
      await menu(page, 'Edit', 'Preferences…')
      const prefs = dialog(page, 'Preferences')
      await expect(prefs).toBeVisible()
      await expectClean(page, 'Preferences')
      await prefs.getByRole('button', { name: 'Cancel' }).click()
      const chooser = page.waitForEvent('filechooser')
      await runMenu(page, 'File', 'Import data…')
      await (await chooser).setFiles(fixture('growth.csv'))
      await expect(dialog(page, 'Import “growth.csv”')).toBeVisible()
      await expectClean(page, 'import dialog')
    })
  })
}

/** axe's target-size findings (WCAG 2.2, 2.5.8: 24 × 24 px, or spaced as much). */
async function smallTargets(page: Page): Promise<string[]> {
  await page.evaluate(() => document.fonts.ready)
  const results = await new AxeBuilder({ page })
    .withRules(['target-size'])
    .exclude('svg.scene > *')
    .analyze()
  return results.violations.flatMap((v) => v.nodes.map((n) => `${n.target.join(' ')}`))
}

// Audit 3 (A12): the controls added by the UX series are large enough to hit — Getting started's
// "Show me", the legend's entries in the Format panel, the toolbar's split ▾ buttons.
test('targets are at least 24 px (or spaced as much)', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Show me' }).first()).toBeVisible()
  expect.soft(await smallTargets(page), 'start screen').toEqual([])
  await openExample(page, 'grouped')
  await openSheet(page, 'Genotype × treatment × tissue', 'Graphs')
  await menu(page, 'Format', 'Format legend…')
  await expect(panelHeading(page)).toHaveText('Legend')
  await expand(formatPanel(page), 'Entries')
  await expect(formatPanel(page).getByRole('list', { name: /^Legend entries/ })).toBeVisible()
  expect.soft(await smallTargets(page), 'legend place').toEqual([])
})

// Audit 3 (A15): with reduced motion asked for, an analysis' pending badge doesn't pulse.
test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test('the pending badge holds still', async ({ page }) => {
    await page.goto('/')
    const animation = await page.evaluate(() => {
      const b = document.body.appendChild(document.createElement('span'))
      b.className = 'badge pending'
      const name = getComputedStyle(b).animationName
      b.remove()
      return name
    })
    expect(animation).toBe('none')
  })
})

test('dialogs are named by their headings and give the focus back when they close', async ({
  page,
}) => {
  await openExample(page, 'getting-started')
  await openSheet(page, 'Enzyme activity', 'Data Tables')
  // Opened from a toolbar button by keyboard: named; closed with Escape, the button has the
  // focus again (audit 2, U6, U7).
  const analyze = tool(page, 'Analyze…')
  await analyze.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: /^Analyze “/ })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(analyze).toBeFocused()
  await menu(page, 'Edit', 'Preferences…')
  await expect(page.getByRole('dialog', { name: 'Preferences' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // A question (audit 2, U26): the app's alert dialog, named by it, scanned; Escape answers no.
  await typeCells(page, 0, 0, [['12']])
  await runMenu(page, 'File', 'Close project')
  const q = page.getByRole('alertdialog', { name: 'Discard unsaved changes?' })
  await expect(q.getByRole('button', { name: 'Discard' })).toBeFocused()
  await expectClean(page, 'a question')
  await page.keyboard.press('Escape')
  await expect(q).toBeHidden()
  await expect(page.getByRole('grid')).toBeVisible()
})

// ---- Keyboard only -----------------------------------------------------------------------------

/** The focused element's name (its label, or its text). */
const focusedName = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    return (el?.getAttribute('aria-label') ?? el?.innerText ?? '').trim()
  })

/** Whether the focused element shows that it has the focus (an outline or a ring). */
const focusShows = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement
    if (!el || el === document.body) return false
    const cs = getComputedStyle(el)
    const outline = cs.outlineStyle !== 'none' && Number.parseFloat(cs.outlineWidth) > 0
    return outline || cs.boxShadow !== 'none'
  })

/**
 * Presses Tab until a control of this name has the focus, which must show; then Enter. Safari
 * moves Tab between fields only and Option-Tab to buttons too (WebKit's default).
 */
async function tabToAndPress(page: Page, name: RegExp) {
  const webkit = page.context().browser()?.browserType().name() === 'webkit'
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press(webkit ? 'Alt+Tab' : 'Tab')
    if (name.test(await focusedName(page))) {
      expect(await focusShows(page), `focus visible on ${name}`).toBe(true)
      await page.keyboard.press('Enter')
      return
    }
  }
  throw new Error(`Tab never reached ${name}`)
}

/** Tab (WebKit: Option-Tab, to reach buttons too), forwards or with Shift backwards. */
async function tab(page: Page, back = false) {
  const webkit = page.context().browser()?.browserType().name() === 'webkit'
  await page.keyboard.press(`${back ? 'Shift+' : ''}${webkit ? 'Alt+' : ''}Tab`)
}

// Audit 3 (A2): every stop of a Format panel place shows the focus — its sections' headings
// (buttons styled `all: unset`) showed none.
test('every keyboard stop of a Format panel place shows the focus', async ({ page }) => {
  await openExample(page, 'getting-started')
  await openSheet(page, 'Dose response (bars)', 'Graphs')
  await menu(page, 'Format', 'Format graph…')
  await expect(panelHeading(page)).toHaveText('Graph')
  const panel = formatPanel(page)
  await panel.getByRole('combobox', { name: 'Search the Format options' }).focus()
  const inPanel = () => page.evaluate(() => !!document.activeElement?.closest('.format-panel'))
  const stops: string[] = []
  for (let i = 0; i < 80; i++) {
    await tab(page)
    if (!(await inPanel())) break
    const name = await focusedName(page)
    if (!(await focusShows(page))) stops.push(`no focus shown: ${name}`)
    else stops.push(name)
  }
  // The place's section headings are among them (shown in capitals).
  expect(stops.some((s) => /^common$/i.test(s))).toBe(true)
  expect(stops.filter((s) => s.startsWith('no focus shown'))).toEqual([])
})

// Audit 3 (A13): ⌘1 puts the focus into the panel with its ring showing (Chromium doesn't count a
// key pressed with ⌘ towards :focus-visible).
test('⌘1 moves the focus into the Format panel, visibly', async ({ page }) => {
  await openExample(page, 'getting-started')
  await openSheet(page, 'Enzyme activity (scatter)', 'Graphs')
  // Nothing selected: the graph's place, the focus on its first button (+ Add ▾).
  await page.getByRole('main').locator('.canvas').focus()
  await pressShortcut(page, 'Mod+1')
  await expect(panelHeading(page)).toHaveText('Graph')
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe('BUTTON')
  expect(await page.evaluate(() => !!document.activeElement?.closest('.format-panel'))).toBe(true)
  expect(await focusShows(page)).toBe(true)
})

// Audit 3 (A7): undo and redo say what they did, and a keyboard nudge says what moved, in polite
// status regions (screen readers heard nothing).
test('undo, redo and nudges are announced', async ({ page }) => {
  await openExample(page, 'getting-started')
  await openSheet(page, 'Enzyme activity (scatter)', 'Graphs')
  await clickOn(canvas(page).locator('[data-id="title"]'))
  await page.keyboard.press('ArrowRight')
  const status = page.getByRole('status').filter({ hasText: 'Nudge graph title' })
  await expect(status).toBeVisible()
  const announcer = page.getByTestId('announcer')
  await expect(announcer).toHaveAttribute('role', 'status')
  await pressShortcut(page, 'Mod+Z')
  await expect(announcer).toHaveText('Undone: Nudge graph title')
  await pressShortcut(page, 'Mod+Shift+Z')
  await expect(announcer).toHaveText('Redone: Nudge graph title')
  // The same again is announced again (a new node in the region).
  await pressShortcut(page, 'Mod+Z')
  await expect(announcer).toHaveText('Undone: Nudge graph title')
  // From the toolbar too.
  await tool(page, /^Redo/).click()
  await expect(announcer).toHaveText('Redone: Nudge graph title')
})

/** Runs a command from the command palette (⌘K / Ctrl+K), by typing and Enter. */
async function command(page: Page, query: string, option: RegExp) {
  await pressShortcut(page, 'Mod+K')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await expect(palette.getByRole('combobox')).toBeFocused()
  await page.keyboard.type(query)
  const row = palette.getByRole('option', { name: option }).first()
  await expect(row).toBeVisible()
  for (let i = 0; i < 30 && (await row.getAttribute('aria-selected')) !== 'true'; i++)
    await page.keyboard.press('ArrowDown')
  await expect(row).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Enter')
  await expect(palette).toBeHidden()
}

test('keyboard only: import a CSV, make a graph, run an analysis, export', async ({ page }) => {
  // Exports as downloads (no File System Access save picker, which a test can't answer).
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true })
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Start a project' })).toBeVisible()

  // Import: the file itself comes from the system's file chooser.
  const chooser = page.waitForEvent('filechooser')
  await command(page, 'import data', /^Import data…/)
  await (await chooser).setFiles(fixture('growth.csv'))
  const importing = dialog(page, 'Import “growth.csv”')
  await expect(importing).toBeVisible()
  await tabToAndPress(page, /^Import$/)
  await expect(importing).toBeHidden()
  await expect(page.getByRole('main').getByRole('grid')).toBeVisible()

  // A graph of it, from the graph builder.
  await command(page, 'new graph', /^New graph…/)
  const builder = dialog(page, /^(New|Another) graph of/)
  await expect(builder).toBeVisible()
  await tabToAndPress(page, /^Create/)
  await expect(builder).toBeHidden()
  await expect(canvas(page)).toBeVisible()

  // An analysis of the table the graph shows.
  await command(page, 'linear regression', /^Simple linear regression…/)
  const analyze = dialog(page, /^Analyze “/)
  await expect(analyze).toBeVisible()
  await tabToAndPress(page, /^Analyze$/)
  await expect(analyze).toBeHidden()
  await expectUpToDate(page)

  // Back to the graph, and out as a file.
  await command(page, 'go to growth', /^Go to growth\s*Graph/)
  await expect(canvas(page)).toBeVisible()
  await command(page, 'export', /^Export…/)
  const exporting = dialog(page, /^Export “/)
  await expect(exporting).toBeVisible()
  const download = page.waitForEvent('download')
  await tabToAndPress(page, /^Export…$/)
  expect((await download).suggestedFilename()).toMatch(/\.pdf$/)
})
