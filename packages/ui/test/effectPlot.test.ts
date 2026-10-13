import { writeFileSync } from 'node:fs'
import { effectPlot, registry } from '@ps/analyses'
import { layoutGraph, sceneToSvg, sketchGraph } from '@ps/graph'
import { createTable, normalizeTable } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { fonts } from '../../graph/test/helpers.ts'

// Roadmap 51d (design §8.5, U25): the effect plot beside comparison results — each difference
// with its CI, a line at no difference — drawn by @ps/graph from a transient table and a native
// preset, its numbers the result's.

function table(groups: number[][], titles: string[]) {
  const t = createTable({ tableKind: 'column', columns: groups.length, rows: groups[0]!.length })
  groups.forEach((g, i) => {
    t.dataSets[i]!.title = titles[i]!
    t.dataSets[i]!.subcolumns[0]!.values = [...g]
  })
  return t
}

const doses = table(
  [
    [18.1, 22.4, 15.9, 20.3, 17.5, 19.8],
    [24.0, 26.1, 22.3, 23.8, 25.9, 21.7],
    [30.2, 33.5, 27.8, 31.1, 29.4, 34.0],
  ],
  ['Vehicle', '1 mg/kg', '10 mg/kg'],
)

const run = (id: string, t: ReturnType<typeof table>, params: Record<string, unknown> = {}) => {
  const def = registry.get(id)!
  return def.run(normalizeTable(t), def.params.parse(params), {
    tableKind: t.tableKind,
    xTitle: null,
  })
}

describe('the effect plot (design §8.5)', () => {
  it('draws each comparison’s difference and CI, group − control, from the result', () => {
    const r = run('oneWayAnova', doses, {
      comparisons: 'vsControl',
      control: doses.dataSets[0]!.id,
    })
    const spec = effectPlot(r, ['Vehicle', '1 mg/kg', '10 mg/kg'])!
    expect(spec.counts).toBe('2 differences')
    const panel = spec.panels[0]!
    expect(panel.table.dataSets.map((d) => d.title)).toEqual([
      '1 mg/kg − Vehicle',
      '10 mg/kg − Vehicle',
    ])
    expect(panel.lines).toEqual([{ at: 0 }])
    const cmp = r.sheets.find((s) => s.key === 'comparisons')!.blocks[0]!
    if (cmp.type !== 'table') throw new Error('table')
    // The plotted numbers are the comparisons table's.
    expect(panel.table.dataSets[1]!.subcolumns[0]!.values[0]).toBe(
      (cmp.rows[1]![1] as { v: number }).v,
    )
    const { project, graph } = sketchGraph(panel)
    const scene = layoutGraph({ project, graph, fonts })
    const svg = sceneToSvg(scene, { background: '#ffffff' })
    if (process.env.EFFECT_SVG) writeFileSync(process.env.EFFECT_SVG, svg)
    expect(svg).toContain('10 mg/kg − Vehicle')
    expect(spec.description).toMatch(/^Effect plot\. 1 mg\/kg − Vehicle: \d+\.\d+ \(95% CI /)
  })

  it('a t test’s difference, and nothing for results without a CI', () => {
    const two = table(
      [
        [41, 44, 39, 46, 42],
        [55, 52, 58, 49, 61],
      ],
      ['Control', 'Treated'],
    )
    const spec = effectPlot(run('ttest', two), ['Control', 'Treated'])!
    expect(spec.panels[0]!.table.dataSets.map((d) => d.title)).toEqual(['Treated − Control'])
    expect(effectPlot(run('kolmogorovSmirnov', two), ['Control', 'Treated'])).toBeNull()
    expect(effectPlot(run('descriptive', two), ['Control', 'Treated'])).toBeNull()
  })
})
