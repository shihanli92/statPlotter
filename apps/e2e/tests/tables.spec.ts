import { expect, test } from './fixtures.ts'
import {
  answer,
  cell,
  columnTitles,
  dialog,
  expectRows,
  grid,
  menuItem,
  menuPanel,
  newTable,
  openMenu,
  pasteText,
  pressShortcut,
  rowCells,
  runMenu,
  sheet,
  type TableKindLabel,
  toast,
  tool,
  typeCells,
} from './helpers-data.ts'

// Data tables: every kind created, typed into, pasted into, excluded, rearranged, undone.

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

/** Per kind: the column titles of a new empty table and the first row of its sample data. */
const KINDS: Record<TableKindLabel, { titles: string[]; hint: RegExp; sampleRow: string[] }> = {
  Column: {
    titles: ['Row', 'Group A', 'Group B', 'Group C'],
    hint: /Replicate values stacked in columns/,
    sampleRow: ['34.1', '45.2'],
  },
  XY: {
    titles: ['Row', 'X', 'Group A', 'Group B', 'Group C'],
    hint: /XY table: X values in the first column/,
    sampleRow: ['-9', '1', '6.1', '2', '2.7', '4.5', '1.4'],
  },
  Grouped: {
    titles: ['Row', '', 'Group A', 'Group B', 'Group C'],
    hint: /Grouped table: one row per level of the row factor/,
    sampleRow: ['Wild type', '37', '37.5', '42.2', '39.8', '43.4', '50.3', '44.2', '47.5'],
  },
  Contingency: {
    titles: ['Row', '', 'Group A', 'Group B', 'Group C'],
    hint: /Contingency table: counts/,
    sampleRow: ['Treated', '15', '85'],
  },
  Survival: {
    titles: ['Row', 'Days elapsed', 'Group A', 'Group B', 'Group C'],
    hint: /Survival table: one subject per row/,
    sampleRow: ['12', '1', ''],
  },
  'Multiple variables': {
    titles: ['Row', 'Group A', 'Group B', 'Group C'],
    hint: /Multiple variables: one row per observation/,
    sampleRow: ['40', '20.4', '0', '116.5', '0', '133', '0'],
  },
  'Parts of whole': {
    titles: ['Row', '', 'Group A', 'Group B', 'Group C'],
    hint: /Parts of whole: one part \(category\) per row/,
    sampleRow: ['T cells', '412', '355'],
  },
  Nested: {
    titles: ['Row', 'Group A', 'Group B', 'Group C'],
    hint: /Nested table: a column per group, a subcolumn per subject/,
    sampleRow: ['15.7', '21.6', '21.1', '26.4', '28', '26.1'],
  },
}

for (const [kind, want] of Object.entries(KINDS) as [TableKindLabel, (typeof KINDS)['XY']][]) {
  test(`a new ${kind} table, empty and with sample data`, async ({ page }) => {
    await newTable(page, { kind })
    await expect(columnTitles(page)).toHaveText(want.titles)
    await expect(page.getByRole('main').getByText(want.hint)).toBeVisible()
    // Every new table gets a linked graph of the same name.
    await expect(sheet(page, 'Data 1', 'Data Tables')).toBeVisible()
    await expect(sheet(page, 'Data 1', 'Graphs')).toBeVisible()

    await newTable(page, { kind, sample: true })
    await expect(rowCells(page, 0)).toHaveText(want.sampleRow)
    await expect(sheet(page, 'Data 2', 'Data Tables')).toHaveClass(/\bon\b/)
  })
}

test('a blank project’s first table starts with sample data, in view at 1024 × 768; a notice says what Create made', async ({
  page,
}) => {
  // Roadmap 43: the dialog's choices beside the table types, none below the fold.
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.getByRole('main').getByRole('button', { name: 'New data table' }).click()
  const d = dialog(page, 'New data table')
  const sample = d.getByRole('checkbox', { name: /^Start with sample data/ })
  await expect(sample).toBeChecked()
  await expect(sample).toBeInViewport()
  await expect(d.getByRole('radio', { name: /^Nested —/ })).toBeInViewport()
  // Sample data has its own format and size: those are for an empty table.
  await expect(d.getByRole('group', { name: 'Y values' })).toHaveCount(0)
  await expect(d.getByRole('spinbutton', { name: 'Number of data sets' })).toHaveCount(0)
  await sample.uncheck()
  // The tallest choice: an XY table's formats and sizes.
  await d.getByRole('radio', { name: /^XY —/ }).check()
  await expect(d.getByRole('radio', { name: 'Mean with upper and lower limits' })).toBeInViewport()
  await expect(d.getByRole('spinbutton', { name: 'Number of data sets' })).toBeInViewport()
  const body = d.locator('.dialog-body')
  expect(await body.evaluate((e) => e.scrollHeight <= e.clientHeight)).toBe(true)

  await d.getByRole('radio', { name: /^Column —/ }).check()
  await sample.check()
  await d.getByRole('button', { name: 'Create' }).click()
  await expect(d).toBeHidden()
  await expect(rowCells(page, 0)).toHaveText(KINDS.Column.sampleRow)
  await expect(page.getByRole('status').locator('.toast')).toHaveText(
    /“Data 1” created, with a graph of it/,
  )
  await expect(sheet(page, 'Data 1', 'Graphs')).toBeVisible()

  // Once the project has a table, a new one starts empty.
  await runMenu(page, 'Insert', 'New data table…')
  await expect(sample).not.toBeChecked()
  await expect(d.getByRole('spinbutton', { name: 'Number of data sets' })).toBeVisible()
  await d.getByRole('button', { name: 'Cancel' }).click()
  await expect(d).toBeHidden()
})

test('a table with replicates and a named table', async ({ page }) => {
  await newTable(page, { kind: 'XY', name: 'Dose response', dataSets: 2, replicates: 2 })
  const subTitles = grid(page).getByRole('rowgroup').first().getByRole('row').nth(1)
  await expect(subTitles.getByRole('columnheader')).toHaveText(['Y1', 'Y2', 'Y1', 'Y2'])
  await expect(rowCells(page, 0)).toHaveCount(5)
  await expect(sheet(page, 'Dose response', 'Data Tables')).toBeVisible()
})

test('typing values and titles, with undo and redo', async ({ page }) => {
  await newTable(page, { kind: 'XY', dataSets: 1, replicates: 1 })
  await typeCells(page, 0, 0, [
    ['1', '2.5'],
    ['2', '-3'],
    ['3', '1e3'],
  ])
  await expectRows(page, [
    ['1', '2.5'],
    ['2', '-3'],
    ['3', '1000'],
  ])

  // Editing an existing value (F2), cancelling an edit (Escape).
  await cell(page, 1, 1).click()
  await page.keyboard.press('F2')
  const editor = grid(page).getByRole('textbox')
  await expect(editor).toHaveValue('-3')
  await editor.fill('-4')
  await page.keyboard.press('Enter')
  await expect(cell(page, 1, 1)).toHaveText('-4')
  await cell(page, 2, 1).dblclick()
  await editor.fill('99')
  await page.keyboard.press('Escape')
  await expect(editor).toBeHidden()
  await expect(cell(page, 2, 1)).toHaveText('1000')

  // Text isn't a number: the edit stays open with a message.
  await cell(page, 0, 1).click()
  await page.keyboard.type('abc')
  await page.keyboard.press('Enter')
  await expect(toast(page)).toContainText(/number/i)
  await page.keyboard.press('Escape')
  await expect(cell(page, 0, 1)).toHaveText('2.5')
  // Roadmap 43: a validation message goes by itself after a while (failures stay).
  await expect(toast(page)).toHaveCount(0, { timeout: 12_000 })

  // Titles: a data set and the X column, renamed by double-click.
  await columnTitles(page).filter({ hasText: 'Group A' }).dblclick()
  await grid(page).getByRole('textbox').fill('Response')
  await page.keyboard.press('Enter')
  await columnTitles(page).nth(1).dblclick()
  await grid(page).getByRole('textbox').fill('Dose')
  await page.keyboard.press('Enter')
  await expect(columnTitles(page)).toHaveText(['Row', 'Dose', 'Response'])

  // Undo steps back through the X title, the data set title and the edited value; redo returns.
  await expect(tool(page, 'Undo Rename X column')).toBeEnabled()
  await pressShortcut(page, 'Mod+Z')
  await expect(columnTitles(page)).toHaveText(['Row', 'X', 'Response'])
  await pressShortcut(page, 'Mod+Z')
  await expect(columnTitles(page)).toHaveText(['Row', 'X', 'Group A'])
  await pressShortcut(page, 'Mod+Z')
  await expect(cell(page, 1, 1)).toHaveText('-3')
  await pressShortcut(page, 'Mod+Shift+Z')
  await expect(cell(page, 1, 1)).toHaveText('-4')
  await pressShortcut(page, 'Mod+Shift+Z')
  await pressShortcut(page, 'Mod+Shift+Z')
  await expect(columnTitles(page)).toHaveText(['Row', 'Dose', 'Response'])
  await expect(tool(page, 'Redo')).toBeDisabled()
})

test.describe('pasting', () => {
  test.beforeEach(async ({ context, browserName }) => {
    if (browserName === 'chromium')
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  })

  test('pasting TSV and pasting transposed, with undo', async ({ page, browserName }) => {
    await newTable(page, { kind: 'Column' })
    await cell(page, 0, 0).click()
    await pasteText(page, '1\t2\t3\n4\t5\t6\n', { browserName })
    await expectRows(page, [
      ['1', '2', '3'],
      ['4', '5', '6'],
    ])
    await expect(tool(page, 'Undo Paste')).toBeEnabled()
    await pressShortcut(page, 'Mod+Z')
    await expectRows(page, [['', '', '']])

    // Rows become columns; pasted from the second column on.
    await cell(page, 0, 1).click()
    await pasteText(page, '1\t2\t3\n4\t5\t6', { browserName, transposed: true })
    await expectRows(page, [
      ['', '1', '4'],
      ['', '2', '5'],
      ['', '3', '6'],
    ])
    await expect(tool(page, 'Undo Paste transposed')).toBeEnabled()
    await pressShortcut(page, 'Mod+Z')
    await expectRows(page, [['', '', '']])
    await pressShortcut(page, 'Mod+Shift+Z')
    await expect(rowCells(page, 2)).toHaveText(['', '3', '6'])

    // A paste longer than the table (10 rows) adds rows.
    await cell(page, 0, 0).click()
    await pasteText(page, Array.from({ length: 12 }, (_, i) => `${i + 1}`).join('\n'), {
      browserName,
    })
    await expect(cell(page, 11, 0)).toHaveText('12')
  })

  // Audit 2 X13.
  test('formula-like text is guarded for spreadsheets and pastes back unchanged', async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName !== 'chromium',
      'Only Chromium lets a test read and write the clipboard without a permission prompt',
    )
    await newTable(page, { kind: 'Column', sample: true })
    await page.getByRole('main').getByRole('checkbox', { name: 'Row titles' }).check()
    await typeCells(page, 0, 0, [['=1+1']])
    await typeCells(page, 1, 0, [['-x']])
    await cell(page, 0, 0).click()
    await cell(page, 1, 1).click({ modifiers: ['Shift'] })
    await page.keyboard.press('ControlOrMeta+C')
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe("'=1+1\t34.1\n'-x\t38.5")

    // ⌘V, then Edit › Paste: the exact text from the copy's HTML.
    for (const [at, paste] of [
      [3, () => page.keyboard.press('ControlOrMeta+V')],
      [6, () => runMenu(page, 'Edit', 'Paste')],
    ] as const) {
      await cell(page, at, 0).click()
      await paste()
      await expect(cell(page, at, 0)).toHaveText('=1+1')
      await expect(cell(page, at, 1)).toHaveText('34.1')
      await expect(cell(page, at + 1, 0)).toHaveText('-x')
      await expect(cell(page, at + 1, 1)).toHaveText('38.5')
    }
  })

  test('copy, cut and the Edit menu’s Paste use the clipboard', async ({ page, browserName }) => {
    test.skip(
      browserName !== 'chromium',
      'Only Chromium lets a test read and write the clipboard without a permission prompt',
    )
    await newTable(page, { kind: 'Column', sample: true })
    await cell(page, 0, 0).click()
    await cell(page, 1, 1).click({ modifiers: ['Shift'] })
    await page.keyboard.press('ControlOrMeta+C')
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe('34.1\t45.2\n38.5\t52.8')

    await page.keyboard.press('ControlOrMeta+X')
    await expectRows(page, [
      ['', ''],
      ['', ''],
      ['29.8', '48.1'],
    ])

    // Edit › Paste (no key: reads the clipboard) at row 3, then Paste transposed.
    await cell(page, 2, 0).click()
    await runMenu(page, 'Edit', 'Paste')
    await expectRows(page, [
      ['', ''],
      ['', ''],
      ['34.1', '45.2'],
      ['38.5', '52.8'],
    ])
    await cell(page, 0, 0).click()
    await runMenu(page, 'Edit', 'Paste transposed')
    await expectRows(page, [
      ['34.1', '38.5'],
      ['45.2', '52.8'],
    ])
  })

  test('text selected outside the grid does not take its ⌘C / ⌘V', async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName !== 'chromium',
      'Only Chromium lets a test read and write the clipboard without a permission prompt',
    )
    await newTable(page, { kind: 'Column', sample: true })
    // What a right-click does on macOS (e.g. for a sheet's Duplicate): selects the word under it.
    const selectSheetName = () =>
      page.evaluate(() => {
        const nav = document.querySelector('nav[aria-label="Project"] .nav-item')!
        getSelection()!.selectAllChildren(nav)
      })
    await selectSheetName()
    await cell(page, 0, 0).click()
    await page.keyboard.press('ControlOrMeta+C')
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('34.1')

    await page.evaluate(() => navigator.clipboard.writeText('1\t2\n3\t4'))
    await selectSheetName()
    await cell(page, 0, 0).click()
    await page.keyboard.press('ControlOrMeta+V')
    await expectRows(page, [
      ['1', '2'],
      ['3', '4'],
    ])
  })
})

test('clearing cells and selecting all, with undo', async ({ page }) => {
  await newTable(page, { kind: 'Column', sample: true })
  // A range by shift-click, cleared with the Delete key.
  await cell(page, 0, 0).click()
  await cell(page, 1, 1).click({ modifiers: ['Shift'] })
  for (const [r, c] of [
    [0, 0],
    [1, 1],
  ] as const)
    await expect(cell(page, r, c)).toHaveClass(/\bsel\b/)
  await expect(cell(page, 2, 0)).not.toHaveClass(/\bsel\b/)
  await page.keyboard.press('Delete')
  await expectRows(page, [
    ['', ''],
    ['', ''],
    ['29.8', '48.1'],
  ])
  await expect(tool(page, 'Undo Clear cells')).toBeEnabled()
  await pressShortcut(page, 'Mod+Z')
  await expect(rowCells(page, 0)).toHaveText(['34.1', '45.2'])

  // Select all (⌘A), then Edit › Clear.
  await pressShortcut(page, 'Mod+A')
  await expect(cell(page, 7, 1)).toHaveClass(/\bsel\b/)
  await expect(cell(page, 0, 0)).toHaveClass(/\bsel\b/)
  await runMenu(page, 'Edit', 'Clear')
  await expect(rowCells(page, 0)).toHaveText(['', ''])
  await expect(rowCells(page, 7)).toHaveText(['', ''])
  await runMenu(page, 'Edit', 'Undo Clear cells')
  await expect(rowCells(page, 7)).toHaveText(['30.4', '51.5'])

  // Select all from the menu too.
  await cell(page, 3, 0).click()
  await runMenu(page, 'Edit', 'Select all')
  await expect(cell(page, 0, 0)).toHaveClass(/\bsel\b/)
  await expect(cell(page, 7, 1)).toHaveClass(/\bsel\b/)
})

test('excluding and including values (⌘E)', async ({ page }) => {
  await newTable(page, { kind: 'Column', sample: true })
  const excluded = cell(page, 1, 0)
  await excluded.click()
  await pressShortcut(page, 'Mod+E')
  // Excluded values stay in the table, in italics with an asterisk.
  await expect(excluded).toHaveText('38.5*')
  await expect(excluded).toHaveClass(/\bexcluded\b/)
  await expect(excluded).toHaveCSS('font-style', 'italic')
  await expect(cell(page, 0, 0)).not.toHaveClass(/\bexcluded\b/)
  await expect(tool(page, 'Undo Exclude values')).toBeEnabled()

  // A range with an excluded value in it: all excluded, then all included again.
  await cell(page, 0, 0).click()
  await cell(page, 2, 0).click({ modifiers: ['Shift'] })
  await runMenu(page, 'Edit', 'Exclude / include values')
  await expect(rowCells(page, 0)).toHaveText(['34.1*', '45.2'])
  await expect(cell(page, 2, 0)).toHaveText('29.8*')
  await runMenu(page, 'Edit', 'Exclude / include values')
  for (const r of [0, 1, 2]) await expect(cell(page, r, 0)).not.toHaveClass(/\bexcluded\b/)
  await expect(tool(page, 'Undo Include values')).toBeEnabled()

  await pressShortcut(page, 'Mod+Z')
  await expect(cell(page, 1, 0)).toHaveText('38.5*')
  await pressShortcut(page, 'Mod+Z')
  await pressShortcut(page, 'Mod+Z')
  await expect(cell(page, 1, 0)).toHaveText('38.5')
  await pressShortcut(page, 'Mod+Y')
  await expect(cell(page, 1, 0)).toHaveText('38.5*')

  // Empty cells can't be excluded.
  await cell(page, 10, 0).click()
  await pressShortcut(page, 'Mod+E')
  await expect(cell(page, 10, 0)).not.toHaveClass(/\bexcluded\b/)
})

test('inserting and deleting rows and columns, with undo', async ({ page }) => {
  await newTable(page, { kind: 'Column', sample: true })
  await cell(page, 1, 0).click()
  await runMenu(page, 'Edit', 'Insert row')
  await expectRows(page, [
    ['34.1', '45.2'],
    ['', ''],
    ['38.5', '52.8'],
  ])
  await pressShortcut(page, 'Mod+Z')
  await expect(rowCells(page, 1)).toHaveText(['38.5', '52.8'])

  // The view's own Insert row button, and the cells' context menu.
  await cell(page, 0, 1).click()
  await page.getByRole('main').getByRole('button', { name: 'Insert row' }).click()
  await expect(rowCells(page, 0)).toHaveText(['', ''])
  await cell(page, 0, 0).click({ button: 'right' })
  const cells = menuPanel(page, 'Cells')
  await menuItem(cells, 'Delete rows').click()
  await expect(cells).toBeHidden()
  await expect(rowCells(page, 0)).toHaveText(['34.1', '45.2'])

  // Delete two rows at once.
  await cell(page, 0, 0).click()
  await cell(page, 1, 0).click({ modifiers: ['Shift'] })
  await runMenu(page, 'Edit', 'Delete rows')
  await expect(rowCells(page, 0)).toHaveText(['29.8', '48.1'])
  await pressShortcut(page, 'Mod+Z')
  await expect(rowCells(page, 0)).toHaveText(['34.1', '45.2'])

  // Columns: + Column, Edit › Add column, Edit › Delete column.
  await page.getByRole('main').getByRole('button', { name: '+ Column' }).click()
  await expect(columnTitles(page)).toHaveText(['Row', 'Control', 'Treated', 'Group C'])
  await runMenu(page, 'Edit', 'Add column')
  await expect(columnTitles(page)).toHaveText(['Row', 'Control', 'Treated', 'Group C', 'Group D'])
  await cell(page, 0, 0).click()
  await runMenu(page, 'Edit', 'Delete column')
  await expect(columnTitles(page)).toHaveText(['Row', 'Treated', 'Group C', 'Group D'])
  await expect(rowCells(page, 0)).toHaveText(['45.2', '', ''])
  await pressShortcut(page, 'Mod+Z')
  await expect(columnTitles(page)).toHaveText(['Row', 'Control', 'Treated', 'Group C', 'Group D'])
  await expect(rowCells(page, 0)).toHaveText(['34.1', '45.2', '', ''])
  await pressShortcut(page, 'Mod+Z')
  await pressShortcut(page, 'Mod+Z')
  await expect(columnTitles(page)).toHaveText(['Row', 'Control', 'Treated'])
})

test('replicate subcolumns of a grouped table', async ({ page }) => {
  await newTable(page, { kind: 'Grouped', dataSets: 2, replicates: 2 })
  const subTitles = () =>
    grid(page).getByRole('rowgroup').first().getByRole('row').nth(1).getByRole('columnheader')
  await expect(subTitles()).toHaveText(['Y1', 'Y2', 'Y1', 'Y2'])
  await runMenu(page, 'Edit', 'Add replicate subcolumn')
  await expect(subTitles()).toHaveText(['Y1', 'Y2', 'Y3', 'Y1', 'Y2', 'Y3'])
  await runMenu(page, 'Edit', 'Remove replicate subcolumn')
  await runMenu(page, 'Edit', 'Remove replicate subcolumn')
  // One value per cell: no subcolumn titles.
  await expect(grid(page).getByRole('rowgroup').first().getByRole('row')).toHaveCount(1)
  await expect(rowCells(page, 0)).toHaveText(['Row 1', '', ''])
  // One subcolumn left: nothing more to remove.
  const edit = await openMenu(page, 'Edit')
  await expect(menuItem(edit, 'Remove replicate subcolumn')).toBeDisabled()
  await page.keyboard.press('Escape')
})

test('row titles on and off', async ({ page }) => {
  await newTable(page, { kind: 'Column', sample: true })
  const toggle = page.getByRole('main').getByRole('checkbox', { name: 'Row titles' })
  await toggle.check()
  await expect(columnTitles(page)).toHaveText(['Row', '', 'Control', 'Treated'])
  await typeCells(page, 0, 0, [['Mouse 1']])
  await typeCells(page, 1, 0, [['Mouse 2']])
  await expect(rowCells(page, 0)).toHaveText(['Mouse 1', '34.1', '45.2'])
  await expect(rowCells(page, 1)).toHaveText(['Mouse 2', '38.5', '52.8'])

  // The View menu's toggle shows the state and turns them off.
  const view = await openMenu(page, 'View')
  await expect(view.getByRole('menuitemcheckbox', { name: /Row titles/ })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await view.getByRole('menuitemcheckbox', { name: /Row titles/ }).click()
  await expect(columnTitles(page)).toHaveText(['Row', 'Control', 'Treated'])
  await expect(toggle).not.toBeChecked()
  await pressShortcut(page, 'Mod+Z')
  await expect(rowCells(page, 0)).toHaveText(['Mouse 1', '34.1', '45.2'])

  // A title typed below the last row adds rows up to it.
  await typeCells(page, 9, 0, [['Mouse 10']])
  await expect(rowCells(page, 9)).toHaveText(['Mouse 10', '', ''])
  await expect(grid(page).getByRole('rowgroup').nth(1).getByRole('row').nth(9)).not.toHaveClass(
    /beyond/,
  )
})

test('multiple variables: text and calculated variables', async ({ page }) => {
  await newTable(page, { kind: 'Multiple variables' })
  const formula = page.getByRole('textbox', { name: 'Formula' })
  const variableKind = page.getByRole('combobox', { name: /Variable/ })
  await typeCells(page, 0, 0, [['1'], ['2'], ['3']])
  await expect(cell(page, 2, 0)).toHaveText('3')

  // Text typed into a numeric variable: after confirming, it becomes a text variable.
  await typeCells(page, 0, 1, [['WT']])
  await answer(page, /^"WT" is not a number. Make “Group B” a text/, 'Make text')
  await expect(cell(page, 0, 1)).toHaveText('WT')
  await expect(columnTitles(page).nth(2)).toHaveText(/Group B\s*abc/)
  await cell(page, 0, 1).click()
  await expect(variableKind).toHaveValue('text')
  await typeCells(page, 1, 1, [['KO']])
  await expect(cell(page, 1, 1)).toHaveText('KO')

  // A calculated variable from the formula bar.
  await page.getByRole('button', { name: '+ Calculated variable' }).click()
  await page.getByRole('textbox', { name: 'Name of the new variable' }).fill('Double')
  await formula.fill('=[Group A] * 2')
  await formula.press('Enter')
  await expect(columnTitles(page).nth(4)).toHaveText(/Double\s*ƒx/)
  await expect(cell(page, 0, 3)).toHaveText('2')
  await expect(cell(page, 2, 3)).toHaveText('6')

  // It follows the values it is calculated from, and can't be typed into.
  await typeCells(page, 0, 0, [['10']])
  await expect(cell(page, 0, 3)).toHaveText('20')
  await cell(page, 1, 3).dblclick()
  await expect(toast(page)).toContainText('calculated from its formula')
  await cell(page, 1, 3).click()
  await expect(variableKind).toHaveValue('calculated')
  await expect(formula).toHaveValue('=[Group A] * 2')

  // Edit the formula in the bar.
  await formula.fill('=[Group A] + 1')
  await formula.press('Enter')
  await expect(cell(page, 0, 3)).toHaveText('11')

  // Undo: the formula, the edit of Group A, the new variable; redo brings them back.
  await pressShortcut(page, 'Mod+Z')
  await expect(cell(page, 0, 3)).toHaveText('20')
  await pressShortcut(page, 'Mod+Z')
  await expect(cell(page, 0, 3)).toHaveText('2')
  await pressShortcut(page, 'Mod+Z')
  await expect(columnTitles(page)).toHaveCount(4)
  await pressShortcut(page, 'Mod+Shift+Z')
  await expect(columnTitles(page).nth(4)).toHaveText(/Double/)
  await expect(cell(page, 1, 3)).toHaveText('4')

  // Back to numbers: the text values that aren't numbers are cleared (after confirming).
  await cell(page, 0, 1).click()
  await variableKind.selectOption('number')
  await answer(page, 'Make it numeric?', 'Make numeric')
  await expect(cell(page, 0, 1)).toHaveText('')
  await expect(columnTitles(page).nth(2)).toHaveText('Group B')
})

test('undoing a new table and deleting a sheet', async ({ page }) => {
  await newTable(page, { kind: 'Column' })
  await expect(tool(page, 'Undo New table')).toBeEnabled()
  await tool(page, 'Undo New table').click()
  await expect(page.getByRole('heading', { name: 'Start a project' })).toBeVisible()
  await tool(page, 'Redo New table').click()
  await expect(grid(page)).toBeVisible()

  await runMenu(page, 'Edit', 'Delete sheet')
  // The table's graph is left: it shows next.
  await expect(sheet(page, 'Data 1', 'Data Tables')).toHaveCount(0)
  await pressShortcut(page, 'Mod+Z')
  await expect(sheet(page, 'Data 1', 'Data Tables')).toBeVisible()
  await expect(dialog(page, 'New data table')).toHaveCount(0)
})
