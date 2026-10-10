import { describe, expect, it } from 'vitest'
import { applyPreset } from '../src/index.ts'
import { graphOf, layerOf, withLayer, withSeriesStyle } from './graphs.ts'
import { sampleTable } from './helpers.ts'

// A bar graph (no points layer) turned into a dot plot shows its points; the error bars' formats
// stay with the graph.
describe('retyping a bar graph as a dot plot', () => {
  for (const kind of ['grouped', 'column'] as const) {
    it(`${kind}: bars → points`, () => {
      const table = sampleTable(kind)
      const bars = withLayer(graphOf(table, 'bars'), 'error', { style: { capWidth: 9 } })
      expect(bars.layers.some((l) => l.geom === 'points')).toBe(false)
      const dots = applyPreset(bars, 'points', table)
      expect(dots.look).toBe(`${kind}.scatter`)
      expect(layerOf(dots, 'points').geom).toBe('points')
      // The error bars' own formats are kept; the stat is the dot plot's (mean ± SD).
      expect(layerOf(dots, 'error').style).toEqual(layerOf(bars, 'error').style)
      expect(layerOf(dots, 'error').stat).toEqual(layerOf(bars, 'error').stat)
    })
  }

  it('keeps a data set that hides its own points, and dot → bar keeps the error bars', () => {
    const table = sampleTable('grouped')
    const key = table.dataSets[0]!.id
    const barsPoints = graphOf(table, 'barsPoints')
    const own = withLayer(barsPoints, 'points', { series: { [key]: { hide: true } } })
    expect(layerOf(applyPreset(own, 'points', table), 'points').series?.[key]?.hide).toBe(true)
    const dots = withSeriesStyle(graphOf(table, 'points'), 'error', key, { capWidth: 4 })
    const bars = applyPreset(dots, 'bars', table)
    expect(bars.style).toEqual(dots.style)
    expect(layerOf(bars, 'error').series).toEqual(layerOf(dots, 'error').series)
  })
})
