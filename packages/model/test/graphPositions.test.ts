import { describe, expect, it } from 'vitest'
import { Annotation, AxisSpec, Offset, PointLabels, PointStyle, SeriesStyle } from '../src/index.ts'

// Roadmap 22 contract: element offsets and point labels are optional additions to the graph.
describe('graph positions and point labels', () => {
  it('accepts offsets on titles, tick labels and brackets', () => {
    expect(Offset.safeParse({ dx: 4, dy: -12.5 }).success).toBe(true)
    expect(Offset.safeParse({ dx: 5000, dy: 0 }).success).toBe(false)
    const axis = AxisSpec.parse({
      type: 'categorical',
      title: null,
      labels: 'dataSetTitles',
      rotation: 0,
      titleOffset: { dx: 0, dy: 6 },
      tickLabelOffset: -3,
    })
    expect(axis.titleOffset).toEqual({ dx: 0, dy: 6 })
    const bracket = Annotation.parse({
      type: 'bracket',
      id: 'b1',
      a: 'A',
      b: 'B',
      label: { source: 'manual', text: '*' },
      level: 'auto',
      offset: -8,
    })
    expect(bracket.type === 'bracket' && bracket.offset).toBe(-8)
  })

  it('describes volcano-style point labels', () => {
    const labels = PointLabels.parse({
      source: 'rowTitle',
      which: 'threshold',
      thresholds: [
        { value: 'x', test: 'abs', limit: 1 },
        { value: 'y', test: 'above', limit: 2 },
      ],
      combine: 'and',
    })
    expect(SeriesStyle.parse({ pointLabels: labels }).pointLabels?.source).toBe('rowTitle')
    expect(
      PointStyle.parse({ label: 'TP53', labelOffset: { dx: 10, dy: -4 } }).labelOffset,
    ).toEqual({
      dx: 10,
      dy: -4,
    })
    expect(PointLabels.safeParse({ source: 'rowTitle' }).success).toBe(false)
  })
})
