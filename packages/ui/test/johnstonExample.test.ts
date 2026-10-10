import { layoutPage } from '@ps/graph'
import type { AnalysisNode, DataTable, GraphNode, LayoutNode } from '@ps/model'
import { describe, expect, it, vi } from 'vitest'
import { fonts } from '../../graph/test/helpers.ts'
import { EXAMPLES } from '../src/examples/registry.ts'
import { JOHNSTON_DATA } from '../src/johnstonData.ts'
import { buildJohnston, JOHNSTON } from '../src/johnstonExample.ts'

/*
 * The Johnston et al. 2026 example (Nature Immunology, CC BY 4.0). Its source data are embedded
 * (`johnstonData.ts`), so unlike the other published-data examples these tests run everywhere and
 * may hold the P values the paper prints: the licence allows the data and the values in the
 * repository. The example builds every figure page from those tables, runs the analyses the
 * figures' statistics come from, and records printed-versus-computed agreement; a difference must
 * stay a difference and is explained in the spec (`PrintedP.differs`).
 */

vi.mock('../../model/src/ids.ts', async (importOriginal) =>
  (await import('./countedIds.ts')).countedIds(await importOriginal(), { always: false }),
)

const built = buildJohnston({ fonts, sourceFile: async () => null })

describe('Johnston et al. 2026 example', () => {
  it('builds every panel, with a page per figure', async () => {
    const { project } = await built
    const nodes = project.order.map((id) => project.nodes[id])
    const tables = nodes.filter((n): n is DataTable => n?.kind === 'table')
    const graphs = nodes.filter((n): n is GraphNode => n?.kind === 'graph')
    const analyses = nodes.filter((n): n is AnalysisNode => n?.kind === 'analysis')
    const pages = nodes.filter((n): n is LayoutNode => n?.kind === 'layout')
    expect(JOHNSTON.panels).toHaveLength(47)
    // A table per panel, plus the tables the analyses of other numbers are run on.
    expect(tables).toHaveLength(54)
    expect(graphs).toHaveLength(48)
    expect(analyses).toHaveLength(25)
    expect(pages.map((p) => p.name)).toEqual([
      'Fig. 1 (reproduced)',
      'Fig. 2 (reproduced)',
      'Fig. 3 (reproduced)',
      'Fig. 5 (reproduced)',
      'Fig. 6 (reproduced)',
    ])
    // Every table holds values, and every panel's notes name its source and legend.
    for (const t of tables) {
      expect(t.rowCount, t.name).toBeGreaterThan(0)
      expect(t.dataSets.length, t.name).toBeGreaterThan(0)
    }
    for (const panel of JOHNSTON.panels) {
      const t = tables.find((x) => x.name === panel.name)
      expect(t, panel.name).toBeDefined()
      expect(t!.notes).toContain('Johnston')
      expect(t!.notes).toContain('Legend:')
    }
  })

  it('agrees with the P values the figures print, except where the spec says why', async () => {
    const { checks } = await built
    const printed = JOHNSTON.panels.flatMap((p) => (p.analyses ?? []).flatMap((a) => a.printed))
    expect(checks).toHaveLength(printed.length)
    expect(checks.length).toBe(37)
    for (const c of checks) {
      const label = `${c.analysis} › ${c.comparison}: printed ${c.printed}, app ${c.computed}`
      if (c.expectedToDiffer) expect(c.agreement, label).toBe('differs')
      else expect(c.agreement, label).not.toBe('differs')
    }
    // Two thirds of the printed values are reproduced exactly; the rest are explained in the spec.
    expect(checks.filter((c) => c.agreement !== 'differs')).toHaveLength(22)
  })

  it('draws every figure page without a warning', async () => {
    const { project, results } = await built
    const pages = project.order
      .map((id) => project.nodes[id])
      .filter((n): n is LayoutNode => n?.kind === 'layout')
    for (const layout of pages) {
      const scene = layoutPage({ project, layout, fonts, result: (id) => results.get(id) })
      expect(scene.warnings, layout.name).toEqual([])
      expect(scene.items.length, layout.name).toBeGreaterThan(0)
    }
  })

  it('is an example of every build, with its data embedded and nothing read from disk', async () => {
    const def = EXAMPLES.find((e) => e.id === 'johnston')
    expect(def).toBeDefined()
    expect(def!.section).toBe('published')
    // No `available`: the data are in the app, so the example is offered everywhere (and has a
    // thumbnail, which `exampleThumbnails.test.ts` draws for the examples without one).
    expect(def!.available).toBeUndefined()
    expect(def!.description).toContain('CC BY 4.0')
    const project = await def!.build({
      fonts,
      sourceFile: async () => {
        throw new Error('the embedded example must not read the local source_data folder')
      },
    })
    expect(Object.keys(project.nodes).length).toBeGreaterThan(100)
    const names = project.order.map((id) => project.nodes[id]?.name)
    expect(names).toContain(def!.thumbnail)
  })

  it('embeds only the tables the panels use, with the licence in the data file', async () => {
    const used = new Set(
      JOHNSTON.panels.flatMap((p) => [p.file, ...(p.with ?? []).map((w) => w.file)]),
    )
    expect(new Set(Object.keys(JOHNSTON_DATA))).toEqual(used)
    const bytes = Object.values(JOHNSTON_DATA).reduce((n, csv) => n + csv.length, 0)
    expect(bytes).toBeLessThan(150_000)
  })
})
