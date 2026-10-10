import { normalizeTable } from '@ps/model'
import { areaUnderCurve, autoBinWidth, frequencyDistribution, niceFloor } from '@ps/stats'
import { describe, expect, it } from 'vitest'
import { arr, expectClose, loadFixtures } from '../../stats/test/oracle.ts'
import { aucDef, aucPoints, frequencyDef } from '../src/frequency.ts'
import { type Cell, makeTable, outTable, runWithContext as run, tableBlock } from './helpers.ts'

describe('frequency distribution vs R', () => {
  for (const f of loadFixtures<{ dataSets: number[][] | number[] }>('frequency')) {
    it(f.name, () => {
      const p = f.params as { binWidth?: number; firstCenter?: number; upperLimit?: number }
      const raw = f.input.dataSets
      const ds = (Array.isArray(raw[0]) ? raw : [raw]) as number[][]
      const got = frequencyDistribution(ds, p)
      const e = f.expected as {
        binWidth: number
        firstCenter: number
        centers: number[]
        counts: number[][]
        below: number[] | number
        above: number[] | number
      }
      expectClose(got.binWidth, e.binWidth, f.tol, 'width')
      expectClose(got.firstCenter, e.firstCenter, f.tol, 'first centre')
      expect(got.centers.length).toBe(e.centers.length)
      got.centers.forEach((c, i) => {
        expectClose(c, e.centers[i]!, f.tol, `centre ${i}`)
      })
      expect(got.counts).toEqual(e.counts)
      expect(got.below).toEqual(arr(e.below))
      expect(got.above).toEqual(arr(e.above))
    })
  }

  it('nice widths and the integer rule', () => {
    expect(niceFloor(3.7)).toBe(3.5)
    expect(niceFloor(0.0461)).toBe(0.045)
    expect(niceFloor(1.13)).toBe(1)
    expect(niceFloor(24)).toBe(22)
    expect(niceFloor(100)).toBe(100)
    expect(autoBinWidth([[1, 2, 3, 4, 5, 6, 7, 8]])).toBe(1)
    expect(autoBinWidth([[5, 5, 5]])).toBe(1)
  })

  it('plugin: an XY table of bin centres; percentages and cumulative', () => {
    const t = makeTable('column', [[[1], [2], [2], [3], [3], [3], [9]]])
    const r = run(frequencyDef, t, {
      autoBinWidth: false,
      binWidth: 2,
      autoFirstCenter: false,
      firstCenter: 2,
    })
    const out = outTable(r)
    expect(out.tableKind).toBe('xy')
    expect(out.x!.title).toBe('Bin center')
    expect(out.x!.subcolumns[0]!.values).toEqual([2, 4, 6, 8, 10])
    expect(out.dataSets[0]!.id).toBe(t.dataSets[0]!.id)
    expect(out.dataSets[0]!.subcolumns[0]!.values).toEqual([3, 3, 0, 0, 1])
    const c = outTable(
      run(frequencyDef, t, {
        autoBinWidth: false,
        binWidth: 2,
        autoFirstCenter: false,
        firstCenter: 2,
        tabulate: 'relativePercent',
        cumulative: true,
      }),
    )
    const vals = c.dataSets[0]!.subcolumns[0]!.values as number[]
    expect(vals[vals.length - 1]).toBeCloseTo(100, 12)
    expect(vals[0]).toBeCloseTo(300 / 7, 12)
  })
})

describe('area under the curve vs R', () => {
  for (const f of loadFixtures<{
    x: Cell[]
    rows?: Cell[][]
    mean?: number[]
    sem?: number[]
  }>('auc')) {
    it(f.name, () => {
      const p = f.params as {
        baseline: number
        minHeight: number
        minPoints: number
        direction: 'above' | 'both'
      }
      const t = f.input.rows
        ? makeTable('xy', [f.input.rows], f.input.x)
        : makeTable('xy', [f.input.mean!.map((m, i) => [m, f.input.sem![i]!])], f.input.x, {
            type: 'summary',
            preset: 'meanSem',
          })
      const pts = aucPoints(normalizeTable(t)[0]!)
      const got = areaUnderCurve(pts.x, pts.y, pts.semSq, {
        baseline: p.baseline,
        minHeight: p.minHeight,
        minPoints: p.minPoints,
        direction: p.direction,
      })
      const e = f.expected as Record<string, number> & {
        regions: Record<string, number[] | number | boolean[] | boolean>
      }
      for (const k of ['totalArea', 'totalPeakArea', 'netArea', 'se', 'lo', 'hi'])
        expectClose(got[k as 'se'], e[k]!, f.tol, k)
      expect(got.nPeaks).toBe(e.nPeaks)
      const region = (k: string) => arr(e.regions[k]) as (number | boolean)[]
      expect(got.regions.length).toBe(region('area').length)
      got.regions.forEach((g, i) => {
        for (const k of ['startX', 'endX', 'peakX', 'peakY', 'area', 'sign'] as const)
          expectClose(g[k], region(k)[i] as number, f.tol, `region ${i} ${k}`)
        expect(g.counted, `region ${i} counted`).toBe(region('counted')[i])
      })
    })
  }

  it('plugin: one column per data set, peaks listed', () => {
    const t = makeTable('xy', [[[0], [2], [4], [2], [0]]], [0, 1, 2, 3, 4])
    const r = run(aucDef, t, {})
    const b = tableBlock(r, 'results')
    expect(b.rows[1]![1]).toEqual({ kind: 'number', v: 8 })
    expect(r.values[`auc:${t.dataSets[0]!.id}`]).toEqual({ kind: 'number', v: 8 })
    const peaks = tableBlock(r, 'peaks')
    expect(peaks.rows).toHaveLength(1)
    expect(r.table).toBeUndefined()
  })
})
