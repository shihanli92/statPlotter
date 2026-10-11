import type { Locator, Page } from '@playwright/test'
import { expect, test } from './fixtures.ts'
import { pressShortcut } from './helpers-data.ts'
import {
  canvas,
  clickOn,
  colourButton,
  colourPopover,
  dblclickOn,
  expectUndo,
  formatPanel,
  layerList,
  openGraph,
  preview,
  undo,
  undoButton,
} from './helpers-graph.ts'

// Decision 1212: the Format panel's "Open in window" is a modal dialog (`showModal()`, in the top
// layer, everything outside it inert). Its pop-ups (colour popovers, menus, tooltips, the rich
// text toolbar's lists) are portalled into the dialog (`portalHost`), and the dialog is never a
// containing block for them: each opens where its button is, on top, takes presses and keys
// (Escape closes the pop-up, not the dialog; Enter never presses OK), and its choice reaches the
// dialog's draft, applied on OK as one undo step.

const SCATTER = { example: 'getting-started', graph: 'Enzyme activity (scatter)' }

/** The open Format dialog. */
const formatWindow = (page: Page): Locator => page.locator('dialog.format-dialog[open]')

/** The Format panel for what is selected (⌘1), then its Open in window. */
async function openWindow(page: Page): Promise<Locator> {
  const panel = formatPanel(page)
  if (!(await panel.isVisible())) await pressShortcut(page, 'Mod+1')
  await panel.getByRole('button', { name: 'Open in window' }).click()
  const d = formatWindow(page)
  await expect(d).toBeVisible()
  return d
}

/**
 * Why a press at the centre of `el` (scrolled into view) would not reach it ('' when it does):
 * covered by something else, or (a pop-up) drawn under the dialog.
 */
const unreachable = (el: Locator, scroll = true): Promise<string> =>
  el.evaluate((e, scroll) => {
    if (scroll) e.scrollIntoView({ block: 'center' })
    const r = e.getBoundingClientRect()
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + Math.min(r.height / 2, 12))
    if (hit && (e === hit || e.contains(hit))) return ''
    if (hit instanceof HTMLElement && (hit.closest('label') as HTMLLabelElement)?.control === e)
      return ''
    return `covered by ${hit?.tagName.toLowerCase()}.${hit?.className}`
  }, scroll)

/**
 * Why a pop-up is not beside its button ('' when it is): it hangs under or over it, from its left
 * edge (or moved left to stay inside the window).
 */
async function besideItsButton(popup: Locator, button: Locator): Promise<string> {
  const [p, b] = await Promise.all(
    [popup, button].map((l) => l.evaluate((e) => e.getBoundingClientRect().toJSON() as DOMRect)),
  )
  const width = await popup.evaluate(() => window.innerWidth)
  const vertical = Math.abs(p!.top - b!.bottom) <= 8 || Math.abs(p!.bottom - b!.top) <= 8
  const horizontal =
    Math.abs(p!.left - b!.left) <= 8 || (p!.left < b!.left && p!.right >= width - 12)
  return vertical && horizontal
    ? ''
    : `at ${[p!.left, p!.top].map(Math.round)}, its button at ${[b!.left, b!.top, b!.bottom].map(Math.round)}`
}

test('Open in window: a data set’s colour from the popover and a custom hex, previewed; OK is one undo step', async ({
  page,
}) => {
  const svg = await openGraph(page, SCATTER.example, SCATTER.graph)
  await expect(undoButton(page)).toBeDisabled()
  const point = (scope: Locator) =>
    scope.locator('[data-id^="series/"][data-id$="/point/0"]').first()
  const fill = (scope: Locator) => point(scope).getAttribute('fill')
  const automatic = await fill(svg)
  await dblclickOn(point(svg))
  const d = await openWindow(page)
  const title = (await d.locator('.format-header h2').textContent())!
  const button = colourButton(d, 'Data set colour')
  await expect(button).toHaveAccessibleName('Data set colour Automatic')

  // The popover opens inside the dialog, under its button, on top: a press on it reaches it.
  await button.click()
  const pop = colourPopover(page)
  await expect(pop).toBeVisible()
  await expect(d.getByTestId('color-popover')).toHaveCount(1)
  expect(await unreachable(pop, false)).toBe('')
  expect(await besideItsButton(pop, button)).toBe('')
  await expect(pop.getByRole('listbox')).toBeFocused()
  await pop.getByRole('option', { name: 'Palette colour 5' }).click()
  await expect(pop).toHaveCount(0)
  await expect(button).toBeFocused()
  // The preview shows it; the graph waits for OK.
  await expect.poll(() => fill(preview(page))).not.toBe(automatic)
  expect(await fill(svg)).toBe(automatic)

  // From the keyboard: Enter on the list picks (and never presses OK). The pointer out of the
  // way first (a popover opening under a resting pointer gets a pointer-enter that would set the
  // active choice in WebKit).
  await page.mouse.move(1, 1)
  await page.keyboard.press('Enter')
  await expect(pop).toBeVisible()
  const list = pop.getByRole('listbox')
  await expect(list).toBeFocused()
  const fifth = await fill(preview(page))
  await page.keyboard.press('ArrowRight')
  await expect(list).toHaveAttribute(
    'aria-activedescendant',
    (await pop.getByRole('option', { name: 'Palette colour 6' }).getAttribute('id'))!,
  )
  await page.keyboard.press('Enter')
  await expect(pop).toHaveCount(0)
  await expect(d).toBeVisible()
  await expect.poll(() => fill(preview(page))).not.toBe(fifth)

  // A custom colour typed as hex: Enter applies it, the popover and the dialog stay; Escape closes
  // the popover only, the focus back on its button.
  await button.click()
  await pop.getByRole('textbox', { name: 'Hex colour' }).fill('#123456')
  await page.keyboard.press('Enter')
  await expect.poll(() => fill(preview(page))).toBe('#123456')
  await expect(pop).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(pop).toHaveCount(0)
  await expect(d).toBeVisible()
  await expect(button).toBeFocused()
  await expect(button).toHaveAccessibleName('Data set colour #123456')

  // A press elsewhere in the dialog closes it, nothing chosen.
  await button.click()
  await expect(pop).toBeVisible()
  await d.locator('.format-header h2').click()
  await expect(pop).toHaveCount(0)
  await expect(d).toBeVisible()
  expect(await fill(preview(page))).toBe('#123456')
  expect(await fill(svg)).toBe(automatic)

  // OK: the graph changes, one undo step, which takes it all back.
  await d.getByRole('button', { name: 'OK' }).click()
  await expect(d).toBeHidden()
  await expect.poll(() => fill(svg)).toBe('#123456')
  await expectUndo(page, title)
  await undo(page)
  await expect.poll(() => fill(svg)).toBe(automatic)
  await expect(undoButton(page)).toBeDisabled()
})

// ---- Every control of every place ---------------------------------------------------------------

/** Opens every closed section of the options shown. */
async function expandAll(d: Locator) {
  for (let i = 0; i < 80; i++) {
    const t = d.locator('.format-options .section-toggle[aria-expanded="false"]').first()
    if (!(await t.count())) return
    await t.click()
  }
}

/** The pop-up a press on `button` opened: a colour popover or a menu. */
const popupOf = (page: Page) =>
  page.locator('[data-testid="color-popover"], [role="menu"]:not(.rt-popup)').last()

/**
 * Walks the options of the place shown: every control reachable by a press; every colour button
 * and menu button opens its pop-up beside it, on top, and Escape closes the pop-up, not the
 * dialog; every rich text field's toolbar and its lists the same. Returns what failed.
 */
async function walk(page: Page, d: Locator, place: string): Promise<string[]> {
  const fails: string[] = []
  await expandAll(d)
  const controls = d.locator(
    '.format-options :is(button, select, input, [role="listbox"], [role="textbox"]):visible',
  )
  const n = await controls.count()
  expect(n, `${place}: controls`).toBeGreaterThan(0)
  for (let i = 0; i < n; i++) {
    const c = controls.nth(i)
    if (await c.isDisabled()) continue
    const what = await c.evaluate(
      (e) =>
        `${e.tagName.toLowerCase()} “${(e.getAttribute('aria-label') ?? e.textContent ?? '').trim().slice(0, 40)}”`,
    )
    const name = `${place}: ${what}`
    const covered = await unreachable(c)
    if (covered) fails.push(`${name} ${covered}`)
    const kind = await c.evaluate((e) =>
      e.classList.contains('color-button')
        ? 'colour'
        : e.getAttribute('aria-haspopup') === 'menu'
          ? 'menu'
          : e.getAttribute('role') === 'textbox' && (e as HTMLElement).isContentEditable
            ? 'rich'
            : '',
    )
    if (!kind || covered) continue
    if (kind === 'rich') {
      fails.push(...(await richText(page, d, c, name)))
      continue
    }
    await c.click()
    const popup = popupOf(page)
    if (!(await popup.isVisible())) {
      fails.push(`${name}: no pop-up`)
      continue
    }
    const under = await unreachable(popup, false)
    if (under) fails.push(`${name}: its pop-up is ${under}`)
    const away = await besideItsButton(popup, c)
    if (away) fails.push(`${name}: its pop-up is ${away}`)
    await page.keyboard.press('Escape')
    await expect(popup).toBeHidden()
    if (!(await d.isVisible())) {
      fails.push(`${name}: Escape closed the dialog`)
      break
    }
  }
  return fails
}

/** A rich text field: its toolbar beside it and on top, each list of the toolbar too. */
async function richText(page: Page, d: Locator, field: Locator, name: string) {
  const fails: string[] = []
  await field.click()
  const bar = page.getByRole('toolbar', { name: 'Text format' })
  await expect(bar).toBeVisible()
  const under = await unreachable(bar, false)
  if (under) fails.push(`${name}: its toolbar is ${under}`)
  const away = await besideItsButton(bar, field)
  if (away) fails.push(`${name}: its toolbar is ${away}`)
  for (const list of ['Font', 'Font sizes', 'Text colour', 'Insert symbol']) {
    await bar.getByRole('button', { name: list, exact: true }).click()
    const popup = bar.locator('.rt-popup')
    await expect(popup).toBeVisible()
    const hidden = await unreachable(popup, false)
    if (hidden) fails.push(`${name} › ${list}: ${hidden}`)
    await page.keyboard.press('Escape')
    await expect(popup).toHaveCount(0)
    if (!(await d.isVisible())) {
      fails.push(`${name} › ${list}: Escape closed the dialog`)
      return fails
    }
  }
  // Leave the field: a press on the footer's text (the toolbar may cover the title bar, and Tab
  // goes into the toolbar's size box). Its toolbar goes.
  await d.locator('.format-footer > span').click()
  await expect(bar).toBeHidden()
  return fails
}

/** The dialog's place, by its title. */
const placeTitle = (d: Locator) => d.locator('.format-header h2').textContent()

const GRAPHS = [
  { kind: 'an XY graph', example: 'curve-fitting', graph: 'Dose-response' },
  { kind: 'a column scatter', ...SCATTER },
  { kind: 'a grouped bar graph', example: 'grouped', graph: 'Genotype × treatment' },
  {
    kind: 'a multiple-variables graph',
    example: 'multiple-variables',
    graph: 'Age, BMI and weight (bubble plot)',
  },
]

for (const g of GRAPHS)
  test(`Open in window, ${g.kind}: every control of every place reachable, every pop-up beside its button, on top, Escape closing it alone`, async ({
    page,
  }) => {
    test.slow()
    const svg = await openGraph(page, g.example, g.graph)
    // The graph's place (nothing selected).
    await svg.click({ position: { x: 4, y: 4 } })
    const d = await openWindow(page)
    const fails: string[] = []
    const seen = new Set<string>()
    const at = async (place: string) => {
      const shown = (await placeTitle(d))!
      // A place by its title and its sections (a layer's, a data set's and a point's are all in
      // Format graph).
      seen.add(`${shown}: ${await d.locator('.format-options .section-toggle').allTextContents()}`)
      const title = `${place} (${shown})`
      fails.push(...(await walk(page, d, title)))
      // Nothing more to walk once the dialog is gone.
      if (!(await d.isVisible())) expect(fails).toEqual([])
    }
    await at('graph')
    // A layer (from the list of layers at the top of the graph's place).
    await layerList(d).getByRole('option').first().click()
    await at('layer')
    const pv = preview(page)
    const places: [string, string][] = [
      ['title', '[data-id="title"]'],
      ['X axis', '[data-id="axis/x/line"]'],
      ['Y axis', '[data-id="axis/y/line"]'],
      ['legend', '[data-id^="legend/"]'],
      ['data set', 'path[data-id^="series/"][data-id*="/point/"]'],
      ['bracket', 'polyline[data-id^="annotation/"]'],
    ]
    for (const [place, sel] of places) {
      const el = pv.locator(sel).first()
      if (!(await el.count())) continue
      await clickOn(el)
      await at(place)
      // A second click on a point of the data set shown: the point.
      if (place === 'data set') {
        await clickOn(pv.locator(sel).first())
        await at('point')
      }
    }
    expect(fails).toEqual([])
    // Every place visited showed its own options.
    expect(seen.size, [...seen].join('\n')).toBeGreaterThanOrEqual(6)
    // The search box's results are on top too, and Enter on one jumps (never OK).
    const search = d.getByRole('combobox', { name: 'Search the Format options' })
    await search.fill('font')
    const results = d.getByRole('listbox', { name: 'Matching options' })
    await expect(results).toBeVisible()
    expect(await unreachable(results, false)).toBe('')
    await page.keyboard.press('Enter')
    await expect(results).toBeHidden()
    await expect(d).toBeVisible()
    await d.getByRole('button', { name: 'Cancel' }).click()
    await expect(d).toBeHidden()
    await expect(canvas(page)).toBeVisible()
  })

test('Open in window: the list of layers, + Add ▾, Change layers…, presets and Match format act in the window, over it', async ({
  page,
}) => {
  const svg = await openGraph(page, SCATTER.example, SCATTER.graph)
  await svg.click({ position: { x: 4, y: 4 } })
  const d = await openWindow(page)
  await expandAll(d)
  const layers = layerList(d).getByRole('option')
  const n = await layers.count()

  // + Add ▾ › a family › a style: the menu beside its button, on top; a layer more.
  const add = d.getByRole('button', { name: '+ Add ▾' })
  await add.click()
  const menu = d.getByRole('menu', { name: 'Add a layer' })
  await expect(menu).toBeVisible()
  expect(await unreachable(menu, false)).toBe('')
  expect(await besideItsButton(menu, add)).toBe('')
  await menu.getByRole('menuitem').first().click()
  const sub = menu.getByRole('menu').first()
  await expect(sub).toBeVisible()
  expect(await unreachable(sub, false)).toBe('')
  await sub.getByRole('menuitem').first().click()
  await expect(menu).toBeHidden()
  await expect(layers).toHaveCount(n + 1)

  // The list's buttons: Duplicate, Hide / Show, back and forward, Delete.
  await layers.first().click()
  await d.getByRole('button', { name: 'Duplicate', exact: true }).click()
  await expect(layers).toHaveCount(n + 2)
  await d.getByRole('button', { name: 'Hide', exact: true }).click()
  await d.getByRole('button', { name: 'Show', exact: true }).click()
  await expect(d.getByRole('button', { name: 'Hide', exact: true })).toBeVisible()
  const front = (await layers.first().getAttribute('aria-label'))!
  await d.getByRole('button', { name: 'Send layer backward' }).click()
  await expect(layers.nth(1)).toHaveAttribute('aria-label', front)
  await d.getByRole('button', { name: 'Bring layer forward' }).click()
  await expect(layers.first()).toHaveAttribute('aria-label', front)
  await d.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(layers).toHaveCount(n + 1)
  await expect(d).toBeVisible()

  // Graph type and presets (the graph's place again: a click around the preview): each dialog it
  // opens is over the window; Escape closes that one.
  await d.locator('.format-preview-canvas').click({ position: { x: 3, y: 3 } })
  await expandAll(d)
  for (const name of ['Change layers…', 'Save layers as preset…', 'Manage presets…']) {
    await d.getByRole('button', { name, exact: true }).click()
    await expect(page.locator('dialog[open]')).toHaveCount(2)
    const over = page.locator('dialog[open]:not(.format-dialog)')
    expect(await unreachable(over.locator('h2').first(), false)).toBe('')
    await page.keyboard.press('Escape')
    await expect(page.locator('dialog[open]')).toHaveCount(1)
    await expect(d).toBeVisible()
  }

  // Match format: another graph's look, into the window's draft.
  const from = d.getByLabel('Make this graph look like')
  await from.selectOption({ index: 1 })
  await d.getByRole('button', { name: 'Apply format', exact: true }).click()
  await expect(d.locator('.format-error')).toHaveCount(0)

  // OK: all of it, one undo step.
  const title = (await placeTitle(d))!
  await d.getByRole('button', { name: 'OK' }).click()
  await expect(d).toBeHidden()
  await expectUndo(page, title)
})

test('Open in window, moved by its title bar and in a narrow window: pop-ups stay beside their buttons', async ({
  page,
}) => {
  const svg = await openGraph(page, SCATTER.example, SCATTER.graph)
  await dblclickOn(svg.locator('[data-id^="series/"][data-id$="/point/0"]').first())
  const d = await openWindow(page)
  const button = colourButton(d, 'Data set colour')
  const pop = colourPopover(page)
  const check = async () => {
    await button.click()
    await expect(pop).toBeVisible()
    expect(await unreachable(pop, false)).toBe('')
    expect(await besideItsButton(pop, button)).toBe('')
    await page.keyboard.press('Escape')
    await expect(pop).toHaveCount(0)
    await expect(d).toBeVisible()
  }
  // Moved: the whole dialog, its pop-ups with it.
  const before = (await d.boundingBox())!
  const bar = (await d.locator('.format-header .muted').boundingBox())!
  await page.mouse.move(bar.x + 4, bar.y + 4)
  await page.mouse.down()
  await page.mouse.move(bar.x - 76, bar.y + 44, { steps: 6 })
  await page.mouse.up()
  const after = (await d.boundingBox())!
  expect(Math.round(after.x - before.x)).toBe(-80)
  expect(Math.round(after.y - before.y)).toBe(40)
  expect(Math.round(after.width)).toBe(Math.round(before.width))
  await check()

  // Narrow (640 px or less): the preview above the options, as before.
  await page.setViewportSize({ width: 600, height: 760 })
  await expect(d).toHaveClass(/\bnarrow\b/)
  const [options, pane] = await Promise.all(
    [d.locator('.format-options'), d.locator('.format-preview')].map((l) => l.boundingBox()),
  )
  expect(pane!.y + pane!.height).toBeLessThanOrEqual(options!.y + 1)
  // Centred again (a double-click on the title bar).
  await d.locator('.format-header .muted').dblclick()
  await check()
  await page.setViewportSize({ width: 1280, height: 720 })
  await expect(d).not.toHaveClass(/\bnarrow\b/)
})
