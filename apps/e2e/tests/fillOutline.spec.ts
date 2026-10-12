import type { Locator, Page } from '@playwright/test'
import { expect, openExample, test } from './fixtures.ts'
import {
  canvas,
  colourButton,
  expectUndo,
  formatPanel,
  inWindow,
  menu,
  openBuilder,
  openGraph,
  openSheet,
  pickPreset,
  pointMarks,
  selectLayer,
  seriesPicker,
  undo,
} from './helpers-graph.ts'

// Roadmap 49d: fill and outline mapped separately — ggplot's `fill =` beside `colour =`. A data
// set's fill colour beside its colour (the recipe "Light fill, dark outline by group", the data
// sets' fill colours in Common, "Data set fill (every layer)"); on a graph of variables the Fill
// row's own variable with a legend of its own; ellipses' outlines dashed by group.

const SCATTER = { example: 'getting-started', graph: 'Enzyme activity (scatter)' }

/** The fill and stroke of every point symbol, by data set key. */
const symbolPaint = (svg: Locator) =>
  pointMarks(svg).evaluateAll((els) =>
    els.map((e) => ({
      key: (e.getAttribute('data-id') ?? '').split('/')[1],
      fill: e.getAttribute('fill'),
      stroke: e.getAttribute('stroke'),
    })),
  )

/** The legend's symbols' fill and stroke. */
const legendPaint = (svg: Locator) =>
  svg
    .locator('path[data-id^="legend/"][data-id$="/symbol"]')
    .evaluateAll((els) =>
      els.map((e) => ({ fill: e.getAttribute('fill'), stroke: e.getAttribute('stroke') })),
    )

/** The ids of an SVG's marks matching a pattern. */
const ids = (svg: Locator, re: RegExp) =>
  svg.evaluate(
    (el, source) =>
      [...el.querySelectorAll('[data-id]')]
        .map((e) => e.getAttribute('data-id') ?? '')
        .filter((id) => new RegExp(source).test(id)),
    re.source,
  )

test('docked panel: light fill, dark outline by group; back to one colour; a data set’s fill', async ({
  page,
}) => {
  const svg = await openGraph(page, SCATTER.example, SCATTER.graph)
  await menu(page, 'Format', 'Format graph…')
  const p = formatPanel(page)
  await selectLayer(p, /^Points/)
  await p.getByRole('button', { name: 'Light fill, dark outline by group' }).click()
  await expectUndo(page, 'Light fill, dark outline by group')
  // Each data set filled lighter than its outline, the legend's symbols the same.
  await expect
    .poll(async () => {
      const paint = await symbolPaint(svg)
      return {
        two: paint.every((s) => s.fill !== s.stroke),
        fills: new Set(paint.map((s) => s.fill)).size,
      }
    })
    .toEqual({ two: true, fills: 2 })
  await expect
    .poll(async () => (await legendPaint(svg)).every((s) => s.fill !== s.stroke))
    .toBe(true)
  // Common: the data sets' fills back to their colours.
  const fills = p.getByLabel('Fill colours of the data sets')
  await expect(fills).toHaveValue('lighter')
  await fills.selectOption('same')
  await expectUndo(page, 'Fill colours')
  await expect
    .poll(async () => (await symbolPaint(svg)).every((s) => s.fill === s.stroke))
    .toBe(true)

  // One data set: a fill colour of its own, from the link.
  const options = await seriesPicker(p)
    .locator('option')
    .evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value))
  const first = options.find((v) => v.startsWith('dataSet:'))!
  const key = first.slice('dataSet:'.length)
  await seriesPicker(p).selectOption(first)
  await p.getByRole('button', { name: 'Set a separate fill colour' }).click()
  await expectUndo(page, 'Fill colour')
  await expect(colourButton(p, 'Data set fill (every layer)')).toBeVisible()
  await expect
    .poll(async () => {
      const paint = await symbolPaint(svg)
      return [
        paint.filter((s) => s.key === key).every((s) => s.fill !== s.stroke),
        paint.filter((s) => s.key !== key).every((s) => s.fill === s.stroke),
      ]
    })
    .toEqual([true, true])
  await undo(page)
  await expect
    .poll(async () => (await symbolPaint(svg)).every((s) => s.fill === s.stroke))
    .toBe(true)
})

/** The multiple-variables example's trial as a scatter coloured by Group with ellipses. */
async function trialGraph(page: Page): Promise<Locator> {
  await openExample(page, 'multiple-variables')
  await openSheet(page, 'Blood pressure trial', 'Data Tables')
  const b = await openBuilder(page)
  await pickPreset(b, 'Scatter with ellipses')
  await b.getByRole('button', { name: /^Create/ }).click()
  await expect(b).toBeHidden()
  const svg = canvas(page)
  await expect(svg).toBeVisible()
  return svg
}

test('a graph of variables: fill by a variable of its own, two legends; ellipses dashed by group', async ({
  page,
}) => {
  const svg = await trialGraph(page)
  await menu(page, 'Format', 'Format graph…')
  const p = formatPanel(page)
  await selectLayer(p, /^(Bubbles|Points)/)
  await expect(p.getByLabel('Fill', { exact: true })).toHaveValue('variable')
  const variable = p.getByLabel('Fill variable')
  // Until one is chosen, the fill follows the colour (Group).
  await expect(variable).toHaveValue('')
  const sex = await variable
    .locator('option')
    .evaluateAll(
      (os) => (os as HTMLOptionElement[]).find((o) => o.textContent?.startsWith('Sex'))?.value,
    )
  await variable.selectOption(sex!)
  await expectUndo(page, 'Fill by variable')
  // Outlines by Group, fills by Sex: two legends, each headed by its variable.
  await expect
    .poll(async () => (await ids(svg, /^legend\/bubble\/fill\//)).length)
    .toBeGreaterThan(1)
  await expect(svg.getByText('Sex', { exact: true })).toBeVisible()
  await expect(svg.getByText('Group', { exact: true })).toBeVisible()
  await expect
    .poll(async () => (await symbolPaint(svg)).some((s) => s.fill !== s.stroke))
    .toBe(true)
  // A fixed fill unmaps it: one legend again.
  await p.getByLabel('Fill', { exact: true }).selectOption('fixed')
  await expect.poll(async () => (await ids(svg, /^legend\/bubble\/fill\//)).length).toBe(0)
  await undo(page)
  await expect
    .poll(async () => (await ids(svg, /^legend\/bubble\/fill\//)).length)
    .toBeGreaterThan(1)

  // The ellipses' outlines by group, in the graph's line styles (in a window, OK one step).
  const d = await inWindow(page, 'Format graph')
  await selectLayer(d, /^Ellipses/)
  await d.getByLabel('Line style', { exact: true }).selectOption('series')
  await d.getByRole('button', { name: 'OK', exact: true }).click()
  await expect(d).toBeHidden()
  await expectUndo(page, 'Format graph')
  await expect
    .poll(async () =>
      svg
        .locator('polyline[data-id*="/ellipse"]')
        .evaluateAll(
          (els) => new Set(els.map((e) => e.getAttribute('stroke-dasharray') ?? 'solid')).size,
        ),
    )
    .toBeGreaterThan(1)
})
