import type { Locator, Page } from '@playwright/test'
import { expect, openExample, test } from './fixtures.ts'
import { analyze, openTier } from './helpers-data.ts'
import {
  addLayer,
  canvas,
  dialog,
  inWindow,
  menu,
  openBuilder,
  openSheet,
  pickPreset,
  presets,
  section,
  selectLayer,
  undo,
} from './helpers-graph.ts'

// Group overlays, paths and PCA plots (roadmap 34c): the builder's "Scatter with ellipses" and
// "Trajectories" chips on a table with a text variable, Format graph's ellipse, hull and arrow
// options with undo, and a PCA grouped by a text variable with an ellipse per group.

const TRIAL = 'Blood pressure trial'
const ARMS = ['Placebo', 'Low dose', 'High dose']

/** The ids of an SVG's marks matching a pattern. */
const ids = (svg: Locator, re: RegExp) =>
  svg.evaluate(
    (el, source) =>
      [...el.querySelectorAll('[data-id]')]
        .map((e) => e.getAttribute('data-id') ?? '')
        .filter((id) => new RegExp(source).test(id)),
    re.source,
  )

const ELLIPSE_FILLS = /\/ellipses?\/fill\/\d+$/
const HULL_LINES = /\/hull\/\d+\/\d+$/

async function trialGraph(page: Page, chip: string): Promise<Locator> {
  await openExample(page, 'multiple-variables')
  await openSheet(page, TRIAL, 'Data Tables')
  const b = await openBuilder(page)
  const chips = await presets(b).evaluateAll((els) => els.map((e) => e.textContent?.trim()))
  expect(chips).toEqual(expect.arrayContaining(['Scatter with ellipses', 'Trajectories']))
  await pickPreset(b, chip)
  await b.getByRole('button', { name: /^Create/ }).click()
  await expect(b).toBeHidden()
  const svg = canvas(page)
  await expect(svg).toBeVisible()
  return svg
}

test('Scatter with ellipses: an ellipse per group; Trajectories: paths with arrowheads', async ({
  page,
}) => {
  const svg = await trialGraph(page, 'Scatter with ellipses')
  // Coloured by Group: three arms, an ellipse each, named in the legend.
  await expect.poll(async () => (await ids(svg, ELLIPSE_FILLS)).length).toBe(3)
  for (const arm of ARMS) await expect(svg.getByText(arm, { exact: true })).toBeVisible()
  await menu(page, 'Insert', 'New graph…')
  const b = dialog(page, /^(New|Another) graph of/)
  await pickPreset(b, 'Trajectories')
  await b.getByRole('button', { name: /^Create/ }).click()
  await expect(b).toBeHidden()
  await expect.poll(async () => (await ids(canvas(page), /\/path\/head\//)).length).toBe(3)
})

test('Format graph: ellipse to hull, outline only, arrowheads along a path, each undoable', async ({
  page,
}) => {
  const svg = await trialGraph(page, 'Scatter with ellipses')
  await expect.poll(async () => (await ids(svg, ELLIPSE_FILLS)).length).toBe(3)
  // The ellipses become convex hulls.
  await menu(page, 'Format', 'Format graph…')
  let f = await inWindow(page, 'Format graph')
  await selectLayer(f, /^Ellipses/)
  await section(f, 'Ellipses').getByLabel('Shape', { exact: true }).selectOption('hull')
  await f.getByRole('button', { name: 'OK', exact: true }).click()
  await expect(f).toBeHidden()
  await expect.poll(async () => (await ids(svg, HULL_LINES)).length).toBeGreaterThan(0)
  await expect.poll(async () => (await ids(svg, ELLIPSE_FILLS)).length).toBe(0)
  await undo(page)
  await expect.poll(async () => (await ids(svg, ELLIPSE_FILLS)).length).toBe(3)
  // Outline only: no fills, outlines drawn.
  await menu(page, 'Format', 'Format graph…')
  f = await inWindow(page, 'Format graph')
  await selectLayer(f, /^Ellipses/)
  await section(f, 'Ellipses').getByLabel('Draw', { exact: true }).selectOption('outline')
  await f.getByRole('button', { name: 'OK', exact: true }).click()
  await expect(f).toBeHidden()
  await expect.poll(async () => (await ids(svg, ELLIPSE_FILLS)).length).toBe(0)
  await expect
    .poll(async () => (await ids(svg, /\/ellipses?\/\d+\/\d+$/)).length)
    .toBeGreaterThan(0)
  await undo(page)
  await expect.poll(async () => (await ids(svg, ELLIPSE_FILLS)).length).toBe(3)
  // A path of each group, then arrowheads along it.
  await menu(page, 'Format', 'Format graph…')
  f = await inWindow(page, 'Format graph')
  await addLayer(section(f, 'Layers'), 'Connections', 'Path')
  await selectLayer(f, /^Path/)
  await section(f, 'Paths').getByLabel('Arrowheads', { exact: true }).selectOption('along')
  await f.getByRole('button', { name: 'OK', exact: true }).click()
  await expect(f).toBeHidden()
  await expect.poll(async () => (await ids(svg, /\/path\/head\//)).length).toBeGreaterThan(9)
  await undo(page)
  await expect.poll(async () => (await ids(svg, /\/path\//)).length).toBe(0)
})

test('PCA grouped by a text variable: the score plot coloured by group with ellipses', async ({
  page,
}) => {
  await openExample(page, 'multiple-variables')
  await openSheet(page, TRIAL, 'Data Tables')
  await analyze(page, 'Principal component analysis', async (d) => {
    // The number variables start in the Variables box (phase 42); roadmap 51b: the grouping
    // variable goes into the Group by box; the ellipses are under Reporting.
    await d
      .getByRole('combobox', { name: 'Add to Group by (colours the scores)' })
      .selectOption({ label: 'Group (text)' })
    await openTier(d, 'Reporting')
    await d.getByLabel(/^Ellipses per group/).check()
  })
  await openSheet(page, 'PC scores', 'Graphs')
  const svg = canvas(page)
  await expect(svg).toBeVisible()
  await expect.poll(async () => (await ids(svg, ELLIPSE_FILLS)).length).toBe(3)
  for (const arm of ARMS) await expect(svg.getByText(arm, { exact: true })).toBeVisible()
})
