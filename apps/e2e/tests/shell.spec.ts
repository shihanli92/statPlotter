import { expect, test } from './fixtures.ts'
import {
  answer,
  appIsMac,
  cell,
  dialog,
  escapeRegExp,
  grid,
  itemName,
  menuItem,
  menuPanel,
  newTable,
  openMenu,
  pressShortcut,
  runMenu,
  sheet,
  tool,
  toolbar,
  topMenu,
  typeCells,
} from './helpers-data.ts'
import { formatPanel } from './helpers-graph.ts'

const MENUS = ['File', 'Edit', 'View', 'Insert', 'Analyze', 'Format', 'Help']

test('the app opens with its menu bar, toolbar and empty project', async ({ page }) => {
  await page.goto('/')
  const menubar = page.getByRole('menubar')
  for (const name of MENUS) {
    await expect(menubar.getByRole('menuitem', { name, exact: true })).toBeVisible()
  }
  await expect(page.getByRole('heading', { name: 'Start a project' })).toBeVisible()
  await expect(page).toHaveTitle('Untitled — statPlotter')
})

test('the start screen says where the data stays, and opens to the whole note', async ({
  page,
}) => {
  await page.goto('/')
  const main = page.getByRole('main')
  const note = main.getByText('Your data stays on this device.')
  await expect(note).toBeVisible()
  const full = main.getByText(/statPlotter runs entirely in your browser/)
  await expect(full).toBeHidden()
  await note.click()
  await expect(full).toBeVisible()
  await expect(full).toContainText('no tracking or analytics')
  await expect(full).toContainText('allows connections only to its own address')
})

test.describe('menus', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await newTable(page, { kind: 'Column', sample: true })
  })

  test('every menu opens by click, and by hovering while one is open', async ({ page }) => {
    const firstItems: Record<string, string> = {
      File: 'New project',
      Edit: 'Undo New table',
      View: 'Show navigator',
      Insert: 'New data table…',
      Analyze: 'Analyze…',
      // Roadmap 37: Styles… first on a table (Format column… after it).
      Format: 'Styles…',
      Help: 'Command palette…',
    }
    for (const name of MENUS) {
      const panel = await openMenu(page, name)
      await expect(topMenu(page, name)).toHaveAttribute('aria-expanded', 'true')
      // The first item (a plain or a checkbox item).
      await expect(panel.locator('[role^="menuitem"]').first()).toHaveAccessibleName(
        itemName(firstItems[name]!),
      )
      await page.keyboard.press('Escape')
      await expect(panel).toBeHidden()
      // Escape leaves the focus on the menu's button in the bar.
      await expect(topMenu(page, name)).toBeFocused()
    }

    // With a menu open, pointing at another opens that one instead.
    await openMenu(page, 'File')
    await topMenu(page, 'Analyze').hover()
    await expect(menuPanel(page, 'Analyze')).toBeVisible()
    await expect(menuPanel(page, 'File')).toBeHidden()
    // A second click on the open menu's button closes it.
    await topMenu(page, 'Analyze').click()
    await expect(page.getByRole('menu')).toHaveCount(0)
    // So does a click elsewhere.
    await openMenu(page, 'Help')
    await cell(page, 3, 1).click()
    await expect(page.getByRole('menu')).toHaveCount(0)
  })

  test('a menu opened from the keyboard under a resting pointer keeps the keyboard item', async ({
    page,
  }) => {
    // Where Insert › Plot a function… appears (found with the mouse, then the menu closed).
    await openMenu(page, 'Insert')
    const box = (await menuItem(menuPanel(page, 'Insert'), 'Plot a function…').boundingBox())!
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toHaveCount(0)
    // The pointer rests there while the keyboard opens the menu over it (CI's Linux fonts put an
    // item under the last click this way): the first item keeps focus and Enter runs it.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.keyboard.press('F10')
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight')
    await expect(topMenu(page, 'Insert')).toBeFocused()
    await page.keyboard.press('Enter')
    const insert = menuPanel(page, 'Insert')
    await expect(menuItem(insert, 'New data table…')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(dialog(page, 'New data table')).toBeVisible()
    await page.keyboard.press('Escape')
    // Moving the pointer then does highlight the item under it, as before.
    await openMenu(page, 'Insert')
    const plot = menuItem(menuPanel(page, 'Insert'), 'Plot a function…')
    await page.mouse.move(box.x + box.width / 2, box.y - 30)
    await plot.hover()
    await expect(plot).toBeFocused()
  })

  test('menus by keyboard: F10, arrows, Enter and Escape', async ({ page }) => {
    await cell(page, 0, 0).click()
    await expect(grid(page)).toBeFocused()
    await page.keyboard.press('F10')
    await expect(topMenu(page, 'File')).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await expect(topMenu(page, 'Edit')).toBeFocused()
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await expect(topMenu(page, 'Help')).toBeFocused()
    await page.keyboard.press('Home')
    await expect(topMenu(page, 'File')).toBeFocused()

    // ↓ opens the menu on its first item; arrows move; → goes on to the next menu.
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowDown')
    const edit = menuPanel(page, 'Edit')
    await expect(menuItem(edit, 'Undo New table')).toBeFocused()
    await page.keyboard.press('ArrowDown')
    // Redo is disabled: skipped.
    await expect(menuItem(edit, 'Cut')).toBeFocused()
    await page.keyboard.press('End')
    // Roadmap 37: Preferences… ends the Edit menu.
    await expect(menuItem(edit, 'Preferences…')).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(menuItem(edit, 'Undo New table')).toBeFocused()
    await page.keyboard.press('ArrowRight')
    const view = menuPanel(page, 'View')
    await expect(view).toBeVisible()
    await expect(edit).toBeHidden()
    await expect(view.getByRole('menuitemcheckbox', { name: /Show navigator/ })).toBeFocused()

    // Escape closes the menu (focus on its button), a second Escape leaves the bar for the grid.
    await page.keyboard.press('Escape')
    await expect(view).toBeHidden()
    await expect(topMenu(page, 'View')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(grid(page)).toBeFocused()

    // Enter opens a menu from the bar and runs the focused item.
    await page.keyboard.press('F10')
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight')
    await expect(topMenu(page, 'Insert')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(menuItem(menuPanel(page, 'Insert'), 'New data table…')).toBeFocused()
    await page.keyboard.press('Enter')
    const d = dialog(page, 'New data table')
    await expect(d).toBeVisible()
    // F10 does nothing while a dialog is open.
    await page.keyboard.press('F10')
    await expect(topMenu(page, 'File')).not.toBeFocused()
    await d.getByRole('button', { name: 'Cancel' }).click()
    await expect(d).toBeHidden()

    // ↑ on the bar opens a menu on its last item.
    await page.keyboard.press('F10')
    await page.keyboard.press('End')
    await page.keyboard.press('ArrowUp')
    await expect(menuItem(menuPanel(page, 'Help'), 'About statPlotter')).toBeFocused()
    await page.keyboard.press('Enter')
    const about = dialog(page, 'About statPlotter')
    await expect(about).toContainText('version')
    await expect(about).toContainText('Copyright (C) 2026 Shihan Li')
    await expect(about).toContainText('statPlotter runs entirely in your browser')
    await about.getByRole('button', { name: 'OK' }).click()
    await expect(about).toBeHidden()
  })

  test('submenus: Examples ▸ and Export ▸', async ({ page }) => {
    // By pointer: the Examples submenu opens beside its item.
    const file = await openMenu(page, 'File')
    await menuItem(file, 'Examples').hover()
    const examples = menuPanel(page, 'Examples')
    await expect(examples).toBeVisible()
    await expect(menuItem(examples, 'Grouped data')).toBeVisible()
    await expect(menuItem(examples, 'Browse examples…')).toBeVisible()
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toHaveCount(0)

    // By keyboard: → opens it on its first item, ← goes back, Enter opens an example (after
    // confirming that the unsaved table may go). The pointer is moved off the menus first (a
    // hovered item takes the focus, as in native menus).
    await page.mouse.move(600, 500)
    await topMenu(page, 'File').focus()
    await page.keyboard.press('ArrowDown')
    const fileMenu = menuPanel(page, 'File')
    await expect(menuItem(fileMenu, 'New project')).toBeFocused()
    while (!(await menuItem(fileMenu, 'Examples').evaluate((el) => el === document.activeElement)))
      await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowRight')
    await expect(menuItem(examples, 'Getting started: column data')).toBeFocused()
    await page.keyboard.press('ArrowLeft')
    await expect(examples).toBeHidden()
    await expect(menuItem(fileMenu, 'Examples')).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowDown')
    await expect(menuItem(examples, 'Grouped data')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('menu')).toHaveCount(0)
    // Asked in the app's own dialog (audit 2, U26), the button that goes ahead focused: Enter.
    const q = page.getByRole('alertdialog', { name: 'Discard unsaved changes?' })
    await expect(q.getByRole('button', { name: 'Discard' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(q).toBeHidden()
    await expect(sheet(page, 'Data 1', 'Data Tables')).toHaveCount(0)
    await expect(sheet(page, 'Genotype × treatment', 'Graphs')).toBeVisible()

    // Export ▸ offers what the open sheet exports (a table's data; a graph's Export… dialog, its
    // formats and its source data), every graph or layout page, and the whole project's data and
    // results.
    const tableFile = await openMenu(page, 'File')
    await menuItem(tableFile, 'Export').click()
    const exportMenu = menuPanel(page, 'Export')
    await expect(exportMenu.getByRole('menuitem')).toHaveText([
      /^CSV…/,
      /^TSV…/,
      /^Excel \(\.xlsx\)…/,
      /^All graphs…/,
      /^All layout pages…/,
      /^Selected in the navigator…/,
      /^All data and results…/,
    ])
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await sheet(page, 'Genotype × treatment', 'Graphs').click()
    await expect(page.getByRole('main').getByRole('img', { name: 'Graph' })).toBeVisible()
    const fileOnGraph = await openMenu(page, 'File')
    await menuItem(fileOnGraph, 'Export').click()
    await expect(exportMenu.getByRole('menuitem')).toHaveText([
      /^Export…/,
      /^SVG…/,
      /^PDF…/,
      /^PNG \(300 dpi\)…/,
      /^TIFF \(300 dpi\)…/,
      /^Source data \(Excel\)…/,
      /^All graphs…/,
      /^All layout pages…/,
      /^Selected in the navigator…/,
      /^All data and results…/,
    ])
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
  })

  test('items are enabled and disabled by what is open', async ({ page }) => {
    // Column table: column analyses on, others off; the table's Edit items.
    let analyze = await openMenu(page, 'Analyze')
    await expect(menuItem(analyze, 'Analyze…')).toBeEnabled()
    await expect(menuItem(analyze, 'Guide me…')).toBeEnabled()
    // Roadmap 51a (U5): the common analyses of the table's kind, then every one by category.
    await expect(menuItem(analyze, 't test…')).toBeEnabled()
    await expect(menuItem(analyze, 'Two-way ANOVA…')).toHaveCount(0)
    await menuItem(analyze, 'Grouped analyses').hover()
    await expect(menuItem(menuPanel(page, 'Grouped analyses'), 'Two-way ANOVA…')).toBeDisabled()
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    analyze = await openMenu(page, 'Analyze')
    await menuItem(analyze, 'Simulate and generate').hover()
    await expect(
      menuItem(menuPanel(page, 'Simulate and generate'), 'Monte Carlo analysis…'),
    ).toBeEnabled()
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    const edit = await openMenu(page, 'Edit')
    await expect(menuItem(edit, 'Exclude / include values')).toBeEnabled()
    await expect(menuItem(edit, 'Redo')).toBeDisabled()
    await page.keyboard.press('Escape')
    const format = await openMenu(page, 'Format')
    await expect(menuItem(format, 'Format column…')).toBeEnabled()
    await page.keyboard.press('Escape')

    // XY table: curve fitting on, t test off.
    await newTable(page, { kind: 'XY' })
    analyze = await openMenu(page, 'Analyze')
    await expect(menuItem(analyze, 'Nonlinear regression (curve fit)…')).toBeEnabled()
    await expect(menuItem(analyze, 't test…')).toHaveCount(0)
    await menuItem(analyze, 'Column analyses').hover()
    await expect(menuItem(menuPanel(page, 'Column analyses'), 't test…')).toBeDisabled()
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')

    // A graph: no table commands; Format has the graph's.
    await sheet(page, 'Data 1', 'Graphs').click()
    const editGraph = await openMenu(page, 'Edit')
    await expect(menuItem(editGraph, 'Exclude / include values')).toHaveCount(0)
    await page.keyboard.press('Escape')
    const formatGraph = await openMenu(page, 'Format')
    await expect(menuItem(formatGraph, 'Format column…')).toHaveCount(0)
    await expect(formatGraph.getByRole('menuitem').first()).toBeEnabled()
    await page.keyboard.press('Escape')
  })
})

// Audit 3 (T7): the preview server sends the deployed headers (public/_headers), and a
// violation of its Content-Security-Policy fails a test (the console-error check, fixtures.ts).
test('runs under the deployed Content-Security-Policy; a violation is an error', async ({
  page,
  consoleErrors,
}) => {
  const response = await page.goto('/')
  expect(response?.headers()['content-security-policy']).toContain("script-src 'self'")
  await expect(page.getByRole('heading', { name: 'Start a project' })).toBeVisible()
  expect(consoleErrors).toEqual([])
  // Inline script, which the policy refuses.
  await page.evaluate(() => {
    const s = document.createElement('script')
    s.textContent = 'window.__inlineRan = true'
    document.head.append(s)
  })
  await expect
    .poll(() => consoleErrors.some((e) => e.includes('Content-Security-Policy violation')))
    .toBe(true)
  expect(await page.evaluate(() => '__inlineRan' in window)).toBe(false)
  // Seen: the check itself would fail the test otherwise.
  consoleErrors.length = 0
})

test('with no table open, table commands are disabled', async ({ page }) => {
  await page.goto('/')
  await expect(tool(page, 'Analyze…')).toBeDisabled()
  // Roadmap 43: its tooltip says why (the wrapper hears the pointer: a disabled button doesn't).
  await tool(page, 'Analyze…').locator('xpath=..').hover()
  await expect(page.getByRole('tooltip')).toContainText('Open a data table first')
  await expect(tool(page, 'New graph…')).toBeDisabled()
  const insert = await openMenu(page, 'Insert')
  await expect(menuItem(insert, 'New graph…')).toBeDisabled()
  await expect(menuItem(insert, 'New data table…')).toBeEnabled()
  await page.keyboard.press('Escape')
  const analyze = await openMenu(page, 'Analyze')
  await expect(menuItem(analyze, 'Analyze…')).toBeDisabled()
  await expect(menuItem(analyze, 'Guide me…')).toBeDisabled()
  // Roadmap 51a (U5): every analysis by category; simulations need no data (they make a table
  // of their own).
  await menuItem(analyze, 'Column analyses').hover()
  await expect(
    menuItem(menuPanel(page, 'Column analyses'), 'One-way ANOVA (and nonparametric)…'),
  ).toBeDisabled()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  const again = await openMenu(page, 'Analyze')
  await menuItem(again, 'Simulate and generate').hover()
  await expect(
    menuItem(menuPanel(page, 'Simulate and generate'), 'Simulate column data…'),
  ).toBeEnabled()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  const edit = await openMenu(page, 'Edit')
  await expect(menuItem(edit, 'Undo')).toBeDisabled()
  await expect(menuItem(edit, 'Delete sheet')).toBeDisabled()
  await page.keyboard.press('Escape')
})

test('the command palette runs commands, opens analyses and goes to sheets', async ({ page }) => {
  await page.goto('/')
  await newTable(page, { kind: 'Column', name: 'Weights', sample: true })
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  const search = palette.getByRole('combobox')

  // "anova": the one-way ANOVA opens in the Analyze dialog, preselected.
  await pressShortcut(page, 'Mod+K')
  await expect(search).toBeFocused()
  await search.fill('anova')
  await expect(
    palette.getByRole('option', { name: /^One-way ANOVA \(and nonparametric\)…/ }),
  ).toBeVisible()
  // Two-way ANOVA doesn't fit a column table.
  await expect(palette.getByRole('option', { name: /^Two-way ANOVA…/ }).first()).toHaveAttribute(
    'aria-disabled',
    'true',
  )
  await palette.getByRole('option', { name: /^One-way ANOVA \(and nonparametric\)…/ }).click()
  await expect(palette).toBeHidden()
  const analyze = dialog(page, 'Analyze “Weights”')
  await expect(
    analyze.getByRole('group', { name: 'Could a treatment change how much values vary?' }),
  ).toBeVisible()
  await analyze.getByRole('button', { name: 'Cancel' }).click()

  // "go to": the table's graph, by keyboard.
  await pressShortcut(page, 'Mod+K')
  await search.fill('go to weights')
  const rows = palette.getByRole('option')
  await expect(rows.filter({ hasText: /^Go to Weights/ })).toHaveCount(2)
  // The open sheet is disabled; ↓ / Enter choose among the others.
  await expect(rows.filter({ hasText: /Data table/ })).toHaveAttribute('aria-disabled', 'true')
  const graphRow = rows.filter({ hasText: /^Go to Weights\s*Graph/ })
  while ((await graphRow.getAttribute('aria-selected')) !== 'true') await search.press('ArrowDown')
  await search.press('Enter')
  await expect(page.getByRole('main').getByRole('img', { name: 'Graph' })).toBeVisible()
  await expect(sheet(page, 'Weights', 'Graphs')).toHaveClass(/\bon\b/)

  // A registry command with its menu path; Escape closes without running anything.
  await pressShortcut(page, 'Mod+K')
  await search.fill('keyboard shortcuts')
  await expect(rows.first()).toContainText('Help')
  await search.press('Escape')
  await expect(palette).toBeHidden()
  await pressShortcut(page, 'Mod+K')
  await search.fill('zzzz nothing')
  await expect(palette).toContainText('Nothing matches')
  await pressShortcut(page, 'Mod+K')
  await expect(palette).toBeHidden()
})

test('Help › Keyboard shortcuts lists the shortcuts on offer', async ({ page }) => {
  await page.goto('/')
  await runMenu(page, 'Help', 'Keyboard shortcuts')
  const sheetDialog = dialog(page, 'Keyboard shortcuts')
  await expect(sheetDialog.getByRole('heading', { name: 'File' })).toBeVisible()
  await expect(sheetDialog.getByText('Command palette…')).toBeVisible()
  // The table's shortcuts appear only while a table is open.
  await expect(sheetDialog.getByText('Exclude / include values')).toHaveCount(0)
  const isMac = await appIsMac(page)
  await expect(sheetDialog.getByText(isMac ? '⌘K' : 'Ctrl+K', { exact: true })).toBeVisible()
  // Keys the views handle themselves (audit 2, U20).
  for (const title of ['In the navigator', 'On the canvas', 'On a page'])
    await expect(sheetDialog.getByRole('heading', { name: title })).toBeVisible()
  const moveUp = sheetDialog.locator('dl > div').filter({ hasText: /^Move the sheet up/ })
  await expect(moveUp.locator('kbd')).toHaveText(isMac ? '⌥↑' : 'Alt+Up')
  await sheetDialog.getByRole('button', { name: 'Close' }).click()
  await expect(sheetDialog).toBeHidden()

  await newTable(page, { kind: 'Column' })
  await pressShortcut(page, 'Mod+/')
  await expect(sheetDialog.getByRole('heading', { name: 'Edit' })).toBeVisible()
  await expect(sheetDialog.getByText('Exclude / include values')).toBeVisible()
  await expect(sheetDialog.getByText(isMac ? '⌘E' : 'Ctrl+E', { exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(sheetDialog).toBeHidden()
})

test('toolbar buttons carry labels and tooltips and run their commands', async ({ page }) => {
  await page.goto('/')
  const isMac = await appIsMac(page)
  // Roadmap 43: a label under each icon; ▾ of the split buttons beside Analyze and New graph.
  const buttons = toolbar(page).getByRole('button')
  await expect(buttons).toHaveCount(12)
  for (const b of await buttons.all()) expect(await b.getAttribute('aria-label')).toBeTruthy()
  await expect(tool(page, 'New data table…')).toHaveText('New table')
  // The app's tooltip, at once on keyboard focus: the name and the shortcut.
  await page.keyboard.press('Shift')
  await tool(page, 'Open…').focus()
  await expect(page.getByRole('tooltip')).toHaveText(
    new RegExp(`^Open…${escapeRegExp(isMac ? '⌘O' : 'Ctrl+O')}$`),
  )
  await tool(page, 'Open…').blur()

  // New data table… opens its dialog; Plot a function… and New layout add sheets.
  await tool(page, 'New data table…').click()
  await dialog(page, 'New data table').getByRole('button', { name: 'Cancel' }).click()
  await tool(page, 'New layout').click()
  await expect(sheet(page, 'Layout 1', 'Layouts')).toHaveClass(/\bon\b/)
  await tool(page, 'Plot a function…').click()
  // It opens the new graph with the Format panel on its function (roadmap 46), headed by the
  // function's name, its picker on it.
  await expect(formatPanel(page).getByLabel('Function', { exact: true })).toHaveValue(/^function:/)
  await expect(formatPanel(page).getByRole('heading', { level: 2 })).not.toHaveText('Graph')
  await expect(page.getByRole('main').getByRole('img', { name: 'Graph' })).toBeVisible()
  // The file's toolbar group shows the unsaved-changes dot.
  await expect(toolbar(page).getByRole('img', { name: 'Unsaved changes' })).toBeVisible()
})

test('hiding the navigator (⌘\\) keeps the sheet commands working', async ({ page }) => {
  await page.goto('/')
  await newTable(page, { kind: 'Column', sample: true })
  const nav = page.getByRole('navigation', { name: 'Project' })
  await pressShortcut(page, 'Mod+\\')
  await expect(nav).toBeHidden()
  const view = await openMenu(page, 'View')
  await expect(view.getByRole('menuitemcheckbox', { name: /Show navigator/ })).toHaveAttribute(
    'aria-checked',
    'false',
  )
  await page.keyboard.press('Escape')

  // The sheet commands still work on the open sheet.
  await runMenu(page, 'View', 'Go to graph')
  await expect(page.getByRole('main').getByRole('img', { name: 'Graph' })).toBeVisible()
  await runMenu(page, 'View', 'Go to data table')
  await expect(grid(page)).toHaveAccessibleName('Data 1')
  await runMenu(page, 'Edit', 'Duplicate sheet')
  await expect(grid(page)).toHaveAccessibleName('Data 1 (copy)')
  // The copy is the data only: it has no graph to go to.
  const viewCopy = await openMenu(page, 'View')
  await expect(menuItem(viewCopy, 'Go to graph')).toBeDisabled()
  await page.keyboard.press('Escape')

  // Shown again from the View menu, with the copy listed and open.
  await runMenu(page, 'View', 'Show navigator')
  await expect(nav).toBeVisible()
  await expect(sheet(page, 'Data 1 (copy)', 'Data Tables')).toHaveClass(/\bon\b/)
  await pressShortcut(page, 'Mod+\\')
  await expect(nav).toBeHidden()
  await pressShortcut(page, 'Mod+\\')
  await expect(nav).toBeVisible()
})

test('undo and redo from the menu, the toolbar and the keys', async ({ page }) => {
  await page.goto('/')
  await newTable(page, { kind: 'Column' })
  await typeCells(page, 0, 0, [['1'], ['2']])
  await expect(cell(page, 1, 0)).toHaveText('2')

  // Toolbar: labels name the step.
  await tool(page, 'Undo Edit cells').click()
  await expect(cell(page, 1, 0)).toHaveText('')
  await tool(page, 'Redo Edit cells').click()
  await expect(cell(page, 1, 0)).toHaveText('2')

  // Menu.
  await runMenu(page, 'Edit', 'Undo Edit cells')
  await runMenu(page, 'Edit', 'Undo Edit cells')
  await expect(cell(page, 0, 0)).toHaveText('')
  await runMenu(page, 'Edit', 'Redo Edit cells')
  await expect(cell(page, 0, 0)).toHaveText('1')

  // Keys: ⌘Z, ⇧⌘Z and ⌘Y.
  await pressShortcut(page, 'Mod+Z')
  await expect(cell(page, 0, 0)).toHaveText('')
  await pressShortcut(page, 'Mod+Shift+Z')
  await expect(cell(page, 0, 0)).toHaveText('1')
  await pressShortcut(page, 'Mod+Shift+Z')
  await expect(cell(page, 1, 0)).toHaveText('2')
  await pressShortcut(page, 'Mod+Z')
  await pressShortcut(page, 'Mod+Y')
  await expect(cell(page, 1, 0)).toHaveText('2')
  await expect(tool(page, 'Redo')).toBeDisabled()

  // Undo back to the empty project, and redo to the table again.
  for (let i = 0; i < 3; i++) await pressShortcut(page, 'Mod+Z')
  await expect(page.getByRole('heading', { name: 'Start a project' })).toBeVisible()
  await expect(tool(page, 'Undo')).toBeDisabled()
  await pressShortcut(page, 'Mod+Shift+Z')
  await expect(grid(page)).toBeVisible()
  await expect(cell(page, 0, 0)).toHaveText('')
})

test('New project and Close project ask before discarding changes', async ({ page }) => {
  await page.goto('/')
  // Nothing to lose: no question.
  await runMenu(page, 'File', 'New project')
  await expect(page.getByRole('heading', { name: 'Start a project' })).toBeVisible()
  await expect(page.getByRole('alertdialog')).toHaveCount(0)

  await newTable(page, { kind: 'Column', name: 'Keep me' })
  await expect(page).toHaveTitle('Untitled • — statPlotter')
  // Declined (Cancel, or Escape): the project stays.
  await runMenu(page, 'File', 'New project')
  await answer(page, 'Discard unsaved changes?', 'Cancel')
  await expect(sheet(page, 'Keep me', 'Data Tables')).toBeVisible()
  await runMenu(page, 'File', 'Close project')
  const q = page.getByRole('alertdialog', { name: 'Discard unsaved changes?' })
  await expect(q).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(q).toBeHidden()
  await expect(sheet(page, 'Keep me', 'Data Tables')).toBeVisible()

  // Accepted: an empty, unmodified project.
  await runMenu(page, 'File', 'Close project')
  await answer(page, 'Discard unsaved changes?', 'Discard')
  await expect(page.getByRole('heading', { name: 'Start a project' })).toBeVisible()
  await expect(sheet(page, 'Keep me')).toHaveCount(0)
  await expect(page).toHaveTitle('Untitled — statPlotter')
  await expect(tool(page, 'Undo')).toBeDisabled()
})
