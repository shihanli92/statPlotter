import { type GraphNode, levelKey, type NodeId } from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  firstCenterFrom0,
  layoutGraph,
  newGraphNode,
  presetGraph,
  splitGraphs,
  variableHistogram,
} from '../src/index.ts'
import { fonts, projectOf, sampleVariables } from './helpers.ts'

// Roadmap 41's polish of the graphs: histograms of values ≥ 0 start at 0 (decision 621).

describe('histograms of values that are all ≥ 0', () => {
  it('start their bins at 0 where the automatic first bin would reach below', () => {
    // Width 1: the automatic first bin would be centred on 0, [-0.5, 0.5); now [0, 1).
    expect(firstCenterFrom0([[0, 1, 1, 2, 3, 5, 8]], 1)).toBe(0.5)
    // The automatic width (2 here): [0, 2).
    expect(firstCenterFrom0([[0, 1, 1, 2, 3, 5, 8]], undefined)).toBe(1)
    expect(firstCenterFrom0([[0.2, 3.9]], 2)).toBe(1)
    // Bins that start at or above 0 anyway, or values below 0: as before.
    expect(firstCenterFrom0([[10, 12, 15, 30]], 5)).toBeUndefined()
    expect(firstCenterFrom0([[-1, 2, 3]], 1)).toBeUndefined()
    expect(firstCenterFrom0([[]], undefined)).toBeUndefined()
  })

  it('draws no axis left of zero', () => {
    const t = sampleVariables()
    // Counts from 0: the Score variable made small whole numbers.
    const counts = structuredClone(t)
    const v = counts.dataSets[2]!.subcolumns[0]!.values
    for (let r = 0; r < v.length; r++) if (v[r] !== null) v[r] = r % 5
    const g: GraphNode = {
      ...newGraphNode(counts, {
        frame: 'xy',
        look: 'xy.scatter',
        layers: [variableHistogram(counts.dataSets[2]!.id)],
      }),
      id: 'g1' as NodeId,
    }
    const s = layoutGraph({ project: projectOf(counts, g), graph: g, fonts })
    const x = s.axes!.x
    expect(x.fromPx(s.plot.x)).toBeCloseTo(0, 9)
    expect(x.fromPx(s.plot.x + s.plot.w)).toBeGreaterThan(4)
  })
})

describe('a graph split by the variable that colours it (34d nit)', () => {
  const t = sampleVariables()
  it('keeps each level’s colour of the unsplit graph', () => {
    // Score by Group as boxes: Low, High, Mid are palette 0, 1, 2; split by Group.
    const box = presetGraph(t, 'groupBoxPoints', undefined, { mapping: { x: 'a', y: 'c' } })
    const set = splitGraphs(t, box, { by: 'level', variable: 'a' })
    expect(set).toHaveLength(3)
    for (const [k, level] of ['Low', 'High', 'Mid'].entries())
      expect(set[k]!.seriesOverrides[levelKey(level)]?.color).toEqual({ palette: k })
    // A level's own colour stays its own.
    const own = {
      ...box,
      seriesOverrides: { [levelKey('High')]: { color: { rgb: '#123456' } } },
    }
    const kept = splitGraphs(t, own, { by: 'level', variable: 'a' })
    expect(kept[1]!.seriesOverrides[levelKey('High')]?.color).toEqual({ rgb: '#123456' })
  })

  it('pins nothing when the split variable colours nothing', () => {
    const box = presetGraph(t, 'groupBoxPoints', undefined, { mapping: { x: 'a', y: 'c' } })
    const bySex = splitGraphs(t, box, { by: 'level', variable: 'b' })
    for (const g of bySex) expect(g.seriesOverrides).toEqual(box.seriesOverrides)
  })
})
