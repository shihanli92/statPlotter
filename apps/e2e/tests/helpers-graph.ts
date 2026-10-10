import type { Locator, Page } from '@playwright/test'
import { expect, navigator, openExample } from './fixtures.ts'

// Helpers for the graph, format, canvas, layout and export journeys (roadmap 24, half B).

/** Chooses a menu bar command: `menu(page, 'File', 'Export', 'SVG…')` (submenus by their label). */
export async function menu(page: Page, top: string, ...path: (string | RegExp)[]): Promise<void> {
  await page.getByRole('menubar').getByRole('menuitem', { name: top, exact: true }).click()
  let panel = page.getByRole('menu', { name: top, exact: true })
  for (const [i, item] of path.entries()) {
    const name = typeof item === 'string' ? new RegExp(`^${escapeRegExp(item)}`) : item
    const entry = panel.getByRole('menuitem', { name }).first()
    await entry.click()
    if (i < path.length - 1) {
      const label = typeof item === 'string' ? item : ((await entry.textContent()) ?? '')
      panel = page.getByRole('menu', { name: label.replace(/▸$/, '').trim(), exact: true })
    }
  }
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The navigator's sections. */
export type Section = 'Data Tables' | 'Results' | 'Graphs' | 'Layouts'

/**
 * A navigator row by the sheet's exact name, in one section if given (a table and its graph often
 * share a name); the first where names repeat.
 */
export function sheet(page: Page, name: string, section?: Section): Locator {
  const scope = section
    ? navigator(page)
        .locator('.nav-section')
        .filter({ has: page.getByRole('heading', { name: section, exact: true }) })
    : navigator(page)
  return scope
    .locator('.nav-item')
    .filter({ has: page.locator('.name', { hasText: new RegExp(`^${escapeRegExp(name)}$`) }) })
    .first()
}

/** Opens a sheet from the navigator. */
export async function openSheet(page: Page, name: string, section?: Section): Promise<void> {
  const row = sheet(page, name, section)
  await row.click()
  await expect(row).toHaveClass(/\bon\b/)
}

/** Opens an example and one of its graphs; returns the graph's canvas. */
export async function openGraph(page: Page, example: string, graph: string): Promise<Locator> {
  await openExample(page, example)
  await openSheet(page, graph, 'Graphs')
  const svg = canvas(page)
  await expect(svg).toBeVisible()
  return svg
}

/** The graph view's canvas (the scene SVG). */
export const canvas = (page: Page): Locator =>
  page.getByRole('main').getByRole('img', { name: 'Graph', exact: true })

/** The live preview in an open Format dialog. */
export const preview = (page: Page): Locator =>
  page.getByRole('img', { name: 'Preview of the formatted graph' })

/** Scene elements whose `data-id` starts with `prefix`. */
export const marks = (scope: Locator, prefix: string): Locator =>
  scope.locator(`[data-id^="${prefix}"]`)

/** Every data point symbol (`series/<key>/point/<row>[/<sub>]`). */
export const pointMarks = (scope: Locator): Locator =>
  scope.locator('path[data-id^="series/"][data-id*="/point/"]')

/** Point labels (`pointLabel/<series>/<point>`). */
export const pointLabels = (scope: Locator): Locator =>
  scope.locator('text[data-id^="pointLabel/"]')

/** An open modal dialog by its heading (the Format dialogs, New graph, Export…). */
export const dialog = (page: Page, title: string | RegExp): Locator =>
  page
    .locator('dialog[open]')
    .filter({ has: page.getByRole('heading', { name: title, exact: typeof title === 'string' }) })

/**
 * Roadmap 46: the Format panel docked beside the canvas (Format…, Enter, double-click and ⌘1
 * show it; it follows the selection).
 */
export const formatPanel = (page: Page): Locator => page.locator('aside.format-panel')

/**
 * The Format panel's place in the dialog: its "Open in window" (after whatever showed the panel:
 * a double-click, Enter, Format…); returns the dialog, by its heading.
 */
export async function inWindow(page: Page, title: string | RegExp): Promise<Locator> {
  await formatPanel(page).getByRole('button', { name: 'Open in window' }).click()
  const d = dialog(page, title)
  await expect(d).toBeVisible()
  return d
}

/** The icon toolbar's Undo button; its name carries the step ("Undo Format graph"). */
export const undoButton = (page: Page): Locator =>
  page.getByRole('toolbar', { name: 'Toolbar' }).getByRole('button', { name: /^Undo\b/ })

/** Asserts the next undo step's label on the toolbar button and in the Edit menu. */
export async function expectUndo(page: Page, label: string): Promise<void> {
  await expect(undoButton(page)).toHaveAccessibleName(`Undo ${label}`)
  const edit = page.getByRole('menubar').getByRole('menuitem', { name: 'Edit', exact: true })
  await edit.click()
  await expect(
    page.getByRole('menu', { name: 'Edit' }).getByRole('menuitem', { name: `Undo ${label}` }),
  ).toBeVisible()
  // Escape closes the menu onto its bar item; a second one leaves the bar, focus going back to
  // where it was (the canvas, for the keys that follow).
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu', { name: 'Edit' })).toBeHidden()
  await expect(edit).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(edit).not.toBeFocused()
}

/** Clicks the toolbar's Undo. */
export const undo = (page: Page) => undoButton(page).click()

/** A locator's bounding box (it must be visible). */
export async function box(l: Locator): Promise<{ x: number; y: number; w: number; h: number }> {
  // The page's own client rect: Playwright's boundingBox() of SVG text in WebKit is off (it
  // disagrees with getBoundingClientRect and doesn't follow changes of the text's position).
  return l.evaluate((e) => {
    const r = e.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height }
  })
}

/** Centre of a locator's bounding box. */
export async function centre(l: Locator): Promise<{ x: number; y: number }> {
  const b = await box(l)
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 }
}

/**
 * A real pointer drag from `from` by (dx, dy) in steps. `during` runs while the button is still
 * down at the end point (to check the live state); `modifiers` are held throughout.
 */
export async function drag(
  page: Page,
  from: { x: number; y: number },
  dx: number,
  dy: number,
  opts: { steps?: number; modifiers?: string[]; during?: () => Promise<void> } = {},
): Promise<void> {
  const mods = opts.modifiers ?? []
  for (const m of mods) await page.keyboard.down(m)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + dx, from.y + dy, { steps: opts.steps ?? 8 })
  await opts.during?.()
  await page.mouse.up()
  for (const m of mods.reverse()) await page.keyboard.up(m)
}

/** The first `<tspan>` font size of a text element (points). */
export async function fontSize(text: Locator): Promise<number> {
  return Number(await text.locator('tspan').first().getAttribute('font-size'))
}

/** The graph builder's presets (radio chips named by their labels). */
export const presets = (builder: Locator): Locator =>
  builder.getByRole('radiogroup', { name: 'Presets' }).getByRole('radio')

/** Picks a preset in the graph builder. */
export async function pickPreset(builder: Locator, label: string): Promise<void> {
  const chip = builder
    .getByRole('radiogroup', { name: 'Presets' })
    .getByRole('radio', { name: label, exact: true })
  await chip.click()
  await expect(chip).toHaveAttribute('aria-checked', 'true')
}

/** A plot-style toggle of the graph builder (a button pressed while the style is on the graph). */
export const plotStyle = (builder: Locator, label: string): Locator =>
  builder.locator('.builder-styles').getByRole('button', { name: label, exact: true })

/** The graph builder's live preview. */
export const builderPreview = (builder: Locator): Locator =>
  builder.getByRole('img', { name: /^Preview:/ })

/** The graph builder's layer rows, named by their layers: front first (the top row in front). */
export const builderLayers = (builder: Locator): Locator =>
  builder.getByRole('grid', { name: 'Layers, front to back' }).getByRole('row')

/** Opens the graph builder of the open table (Insert › New graph…). */
export async function openBuilder(page: Page): Promise<Locator> {
  await menu(page, 'Insert', 'New graph…')
  const d = dialog(page, /^(New|Another) graph of/)
  await expect(d).toBeVisible()
  return d
}

/**
 * Creates a graph of the open table with Insert › New graph…: one of the builder's presets
 * (null: the one it starts with), then plot styles toggled (their icons), in order.
 */
export async function newGraph(
  page: Page,
  preset: string | null,
  name?: string,
  opts: { horizontal?: boolean; styles?: string[] } = {},
): Promise<Locator> {
  const d = await openBuilder(page)
  if (name) await d.getByLabel('Name', { exact: true }).fill(name)
  if (preset) await pickPreset(d, preset)
  for (const style of opts.styles ?? []) {
    const icon = plotStyle(d, style)
    const was = await icon.getAttribute('aria-pressed')
    await icon.click()
    await expect(icon).not.toHaveAttribute('aria-pressed', was ?? '')
  }
  if (opts.horizontal) await d.getByRole('checkbox', { name: /^Horizontal/ }).check()
  await d.getByRole('button', { name: /^Create/ }).click()
  await expect(d).toBeHidden()
  const svg = canvas(page)
  await expect(svg).toBeVisible()
  return svg
}

/**
 * The graph's place › Graph type and presets › Change layers…: the graph builder over the panel's
 * or dialog's graph (after Format graph…, which shows the graph's place).
 */
export async function changeLayers(page: Page, format: Locator): Promise<Locator> {
  await expand(format, 'Graph type and presets')
  await format.getByRole('button', { name: 'Change layers…' }).click()
  const b = dialog(page, /^Change layers of/)
  await expect(b).toBeVisible()
  return b
}

/**
 * The list of layers: at the top of the graph's place (Format graph…), and in a layer's place
 * (its Layers section).
 */
export const layerList = (format: Locator): Locator =>
  format.getByRole('listbox', { name: 'Layers, front to back' })

/**
 * The list of layers' + Add ▾ › a family › a plot style, in a panel or dialog (audit 3, A6: the
 * app's menu, a submenu per family of plot styles).
 */
export async function addLayer(format: Locator, family: string, style: string): Promise<void> {
  await format.getByRole('button', { name: '+ Add ▾' }).click()
  const menu = format.getByRole('menu', { name: 'Add a layer' })
  await menu.getByRole('menuitem', { name: family }).click()
  await menu
    .getByRole('menu', { name: family })
    .getByRole('menuitem', { name: style, exact: true })
    .click()
}

/**
 * The series picker of a data set's or a layer's place: "Data set" (or "Curve", "Function"),
 * its value "all" in a layer's place (every data set it draws), else `dataSet:<key>`.
 */
export const seriesPicker = (format: Locator): Locator =>
  format.getByLabel(/^(Data set|Curve|Function)$/)

/**
 * Chooses a layer in the graph's list of layers (Format graph… shows it) by its name: the panel
 * or dialog shows that layer's place, every data set it draws.
 */
export async function selectLayer(format: Locator, name: string | RegExp): Promise<void> {
  const option = layerList(format).getByRole('option', { name })
  await option.click()
  await expect(option).toHaveAttribute('aria-selected', 'true')
}

/**
 * The app's `Mod` key as the page sees its platform: ⌘ on macOS, else Ctrl. The device
 * descriptors emulate Windows for Chromium and Firefox and macOS for WebKit, whatever the host,
 * so Playwright's `ControlOrMeta` (the host's) can differ from the app's shortcuts. Native
 * browser keys (⌘V's paste event) stay the host's `ControlOrMeta`.
 */
export async function appMod(page: Page): Promise<'Meta' | 'Control'> {
  const mac = await page.evaluate(() => {
    const nav = globalThis.navigator as Navigator & { userAgentData?: { platform?: string } }
    return /mac|iphone|ipad/i.test(nav.userAgentData?.platform ?? nav.platform ?? '')
  })
  return mac ? 'Meta' : 'Control'
}

/**
 * The toasts: an error (in the alert region) and a notice (in the status region), but the notice
 * of a table just made (roadmap 43; see helpers-data's `NEW_TABLE_NOTICE`).
 */
export const toast = (page: Page): Locator =>
  page.locator('.toast').filter({ hasNotText: /created, with a graph of it/ })

/**
 * The first of `candidates` that a click at its centre would reach (not covered by another mark,
 * e.g. a mean line over a point), as a locator of that one element.
 */
export async function reachable(candidates: Locator): Promise<Locator> {
  const n = await candidates.count()
  for (let i = 0; i < n; i++) {
    const c = candidates.nth(i)
    if (
      await pointOn(c).then(
        () => true,
        () => false,
      )
    )
      return c
  }
  throw new Error('no reachable element')
}

/**
 * A screen point on a line or outline where a click reaches it (half-way along, else the nearest
 * uncovered point: a resize handle sits in the middle of each plot side, a bracket's label over
 * its middle). Lines are too thin for their bounding box, and a bracket's box centre is empty.
 */
export async function pointOn(el: Locator): Promise<{ x: number; y: number }> {
  const p = await el.evaluate((e) => {
    const m = (e as SVGGraphicsElement).getScreenCTM()!
    const screen = (q: { x: number; y: number }) => ({
      x: m.a * q.x + m.c * q.y + m.e,
      y: m.b * q.x + m.d * q.y + m.f,
    })
    const candidates: { x: number; y: number }[] = []
    if (e instanceof SVGTextContentElement) {
      // Text: the middle of a glyph (WebKit hit-tests glyphs, so a word gap is empty space).
      const n = e.getNumberOfChars()
      const order = [...Array(n).keys()].sort(
        (a, b) => Math.abs(a - (n - 1) / 2) - Math.abs(b - (n - 1) / 2),
      )
      for (const i of order) {
        const r = e.getExtentOfChar(i)
        if (r.width > 0.5) candidates.push(screen({ x: r.x + r.width / 2, y: r.y + r.height / 2 }))
      }
    } else {
      const g = e as SVGGeometryElement
      // Filled shapes (symbols, bars): their middle first.
      if (e.getAttribute('fill') && e.getAttribute('fill') !== 'none') {
        const b = g.getBBox()
        candidates.push(screen({ x: b.x + b.width / 2, y: b.y + b.height / 2 }))
      }
      const len = g.getTotalLength()
      for (const f of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.1, 0.9])
        candidates.push(screen(g.getPointAtLength(len * f)))
    }
    return (
      candidates.find((c) => {
        const hit = document.elementFromPoint(c.x, c.y)
        return !!hit && e.contains(hit)
      }) ?? null
    )
  })
  if (!p) throw new Error('no point along the element can be clicked')
  return p
}

/** Double-clicks a line, outline or text where it can be reached (see `pointOn`). */
export async function dblclickOn(el: Locator): Promise<void> {
  const p = await pointOn(el)
  await el.page().mouse.dblclick(p.x, p.y)
}

/** Clicks a line, outline or text where it can be reached (see `pointOn`). */
export async function clickOn(el: Locator, button: 'left' | 'right' = 'left'): Promise<void> {
  const p = await pointOn(el)
  await el.page().mouse.click(p.x, p.y, { button })
}

/** An inspector section (collapsible) by its title, in a dialog or panel. */
export const section = (scope: Locator, title: string): Locator =>
  scope
    .locator('section.inspector-section')
    .filter({ has: scope.page().getByRole('button', { name: title, exact: true }) })

/**
 * A section's toggle (its heading's button): `aria-expanded` says whether it is open. Roadmap 46:
 * a place opens on Common, the rest closed until opened (remembered per kind of element), the
 * section a click goes to open (an axis title: its axis' Title; a data set's mark: its part).
 */
export const sectionToggle = (scope: Locator, title: string): Locator =>
  section(scope, title).getByRole('button', { name: title, exact: true })

/** The Format panel's heading: the element it formats ("Y axis", "Graph", "Control"…). */
export const panelHeading = (page: Page): Locator =>
  formatPanel(page).getByRole('heading', { level: 2 })

/** Opens a collapsed inspector section. */
export async function expand(scope: Locator, title: string): Promise<Locator> {
  const s = section(scope, title)
  const toggle = s.getByRole('button', { name: title, exact: true })
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  return s
}

/**
 * A colour field's button (roadmap 46: one button per colour, named by its label and what it
 * holds, "Data set colour Automatic"), by the field's exact label.
 */
export const colourButton = (scope: Locator, field: string): Locator =>
  scope
    .locator('.color-button-field')
    .filter({
      has: scope
        .page()
        .locator(':scope > label', { hasText: new RegExp(`^${escapeRegExp(field)}$`) }),
    })
    .getByRole('button')

/** The open colour popover (the panel's fields' and the format bar's). */
export const colourPopover = (page: Page): Locator => page.getByTestId('color-popover')

/**
 * Picks a colour for a colour field: its button, then the popover's choice by name ("Palette
 * colour 4", "Black", "Automatic", "Same colour as the data set"); the popover closes.
 */
export async function pickColour(
  scope: Locator,
  field: string,
  choice: string | RegExp,
): Promise<void> {
  await colourButton(scope, field).first().click()
  const pop = colourPopover(scope.page())
  await pop
    .getByRole('option', { name: choice, exact: typeof choice === 'string' })
    .first()
    .click()
  await expect(pop).toHaveCount(0)
}

/** Sets the graph view's zoom (the view toolbar's select). */
export async function setZoom(page: Page, percent: number): Promise<void> {
  await page
    .getByRole('main')
    .getByLabel('Zoom')
    .selectOption(`${percent / 100}`)
}
