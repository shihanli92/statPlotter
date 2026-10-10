import { existsSync } from 'node:fs'
import type { Locator, Page } from '@playwright/test'
import { expect, openExample, test } from './fixtures.ts'
import { canvas, openGraph, openSheet } from './helpers-graph.ts'

// Visual checks (roadmap 24): screenshots of representative graph canvases and a layout page,
// compared pixel for pixel. Font rasterization differs between systems, so they run only in CI's
// Linux Playwright environment, in Chromium, where the baselines live
// (`visual.spec.ts-snapshots/*-chromium-linux.png`). To create or update them there:
//   CI=1 pnpm e2e --project=chromium tests/visual.spec.ts --update-snapshots
// Baselines from other systems (…-darwin.png, …-win32.png) are never committed.

test.skip(
  ({ browserName }) => !process.env.CI || browserName !== 'chromium',
  'Visual checks run only in CI (Linux), in Chromium: rasterized text differs between systems',
)
// Until the first baselines are committed (made by the "Visual baselines" workflow), there is
// nothing to compare with; that workflow sets VISUAL_BASELINES to create them.
test.skip(
  !process.env.VISUAL_BASELINES &&
    !existsSync(new URL('./visual.spec.ts-snapshots/', import.meta.url)),
  'No visual baselines yet: run the "Visual baselines" workflow and commit its images',
)

test.use({ viewport: { width: 1400, height: 1000 } })

/** The graph alone: the plot's resize handles are view chrome, drawn over it while unselected. */
const HIDE_HANDLES = '.resize-handle { display: none }'

/** Waits for the fonts and moves the pointer away (no hover halos) before a screenshot. */
async function settle(page: Page, target: Locator) {
  await expect(target).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await page.mouse.move(0, 0)
}

const GRAPHS = [
  { example: 'getting-started', graph: 'Dose response (bars)', file: 'bars-points-brackets' },
  { example: 'curve-fitting', graph: 'Dose-response', file: 'xy-global-fit' },
  { example: 'grouped', graph: 'Volcano plot', file: 'volcano-point-labels' },
  { example: 'formatting', graph: 'Temperature and heart rate', file: 'right-axis-legend' },
  { example: 'parts-of-whole', graph: 'Spleen (donut)', file: 'donut' },
]

for (const g of GRAPHS) {
  test(`graph canvas: ${g.graph}`, async ({ page }) => {
    await openGraph(page, g.example, g.graph)
    const svg = canvas(page)
    await settle(page, svg)
    await page.addStyleTag({ content: HIDE_HANDLES })
    await expect(svg.locator('.resize-handle').first()).toBeHidden()
    await expect(svg).toHaveScreenshot(`${g.file}.png`)
  })
}

test.describe(() => {
  // Wide enough for the whole page (landscape Letter at 100%) between navigator and inspector.
  test.use({ viewport: { width: 1800, height: 1100 } })

  test('layout page: Figure 1', async ({ page }) => {
    await openExample(page, 'getting-started')
    await openSheet(page, 'Figure 1', 'Layouts')
    const pageSvg = page.getByRole('img', { name: 'Layout page' })
    await settle(page, pageSvg)
    await expect(pageSvg).toHaveScreenshot('figure-1-page.png')
  })
})
