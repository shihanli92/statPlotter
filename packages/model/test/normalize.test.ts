import { describe, expect, it } from 'vitest'
import {
  createTable,
  type DataTable,
  finiteValues,
  normalizeColumn,
  normalizeTable,
  pairedRows,
  type SummaryData,
  type SummaryPreset,
} from '../src/index.ts'

const arr = (a: Float64Array) => Array.from(a)

function summaryTable(preset: SummaryPreset, values: number[]): DataTable {
  const t = createTable({ columns: 1, yFormat: { type: 'summary', preset } })
  values.forEach((v, i) => {
    t.dataSets[0]!.subcolumns[i]!.values = [v]
  })
  return t
}

const summaryOf = (t: DataTable) => normalizeTable(t)[0]!.data as SummaryData

describe('replicate data', () => {
  it('maps empty and excluded cells to NaN and counts them', () => {
    const t = createTable({ columns: 1, rows: 4 })
    const col = t.dataSets[0]!.subcolumns[0]!
    col.values = [1, null, 3, 4]
    col.excluded = [false, false, true, false]

    const ds = normalizeTable(t)[0]!
    expect(ds.data.shape).toBe('replicates')
    if (ds.data.shape !== 'replicates') return
    expect(arr(ds.data.reps[0]!)).toEqual([1, Number.NaN, Number.NaN, 4])
    expect(ds.counts).toEqual({ empty: 1, excluded: 1 })
    expect(ds.ref).toEqual({ node: t.id, key: t.dataSets[0]!.id })
  })

  it('does not count an excluded empty cell as excluded', () => {
    const t = createTable({ columns: 1, rows: 2 })
    t.dataSets[0]!.subcolumns[0]!.excluded = [true, false]
    expect(normalizeTable(t)[0]!.counts).toEqual({ empty: 2, excluded: 0 })
  })
})

describe('summary data', () => {
  it('Mean, SD, N passes through and derives SEM', () => {
    const s = summaryOf(summaryTable('meanSdN', [10, 2, 4]))
    expect([s.mean[0], s.sd[0], s.n[0], s.sem[0]]).toEqual([10, 2, 4, 1])
    expect(s.lo).toBeUndefined()
  })

  it('Mean, SEM, N derives SD', () => {
    const s = summaryOf(summaryTable('meanSemN', [10, 1, 9]))
    expect(s.sd[0]).toBe(3)
    expect(s.sem[0]).toBe(1)
  })

  it('Mean, SEM without N keeps SEM but leaves SD unknown', () => {
    const s = summaryOf(summaryTable('meanSem', [10, 1]))
    expect(s.sem[0]).toBe(1)
    expect(s.sd[0]).toBeNaN()
    expect(s.n[0]).toBeNaN()
  })

  it('Mean, CV, N treats CV as a fraction', () => {
    const s = summaryOf(summaryTable('meanCvN', [-20, 0.1, 4]))
    expect(s.sd[0]).toBeCloseTo(2, 15)
    expect(s.sem[0]).toBeCloseTo(1, 15)
  })

  it('asymmetric presets produce absolute bounds', () => {
    const pm = summaryOf(summaryTable('meanPlusMinus', [10, 2, 3]))
    expect([pm.lo![0], pm.hi![0]]).toEqual([7, 12])
    expect(pm.sd[0]).toBeNaN()

    const ul = summaryOf(summaryTable('meanUpperLower', [10, 13, 8]))
    expect([ul.lo![0], ul.hi![0]]).toEqual([8, 13])
  })
})

describe('normalization cache', () => {
  it('returns the same object for an unchanged column', () => {
    const t = createTable({ columns: 2, rows: 2 })
    const a = normalizeColumn(t, t.dataSets[0]!.id)
    expect(normalizeColumn({ ...t }, t.dataSets[0]!.id)).toBe(a)
  })

  it('recomputes when a table-level input changes identity', () => {
    const t = createTable({ columns: 1, rows: 2 })
    const a = normalizeColumn(t, t.dataSets[0]!.id)
    const renamedRows = { ...t, rowTitles: ['r1', 'r2'] }
    const b = normalizeColumn(renamedRows, t.dataSets[0]!.id)
    expect(b).not.toBe(a)
    expect(b!.rowTitles).toEqual(['r1', 'r2'])
  })

  it('returns null for an unknown column', () => {
    expect(normalizeColumn(createTable(), 'nope')).toBeNull()
  })
})

describe('helpers', () => {
  it('finiteValues drops NaN', () => {
    expect(arr(finiteValues(Float64Array.from([1, Number.NaN, 3])))).toEqual([1, 3])
  })

  it('pairedRows drops rows missing on either side', () => {
    const a = Float64Array.from([1, Number.NaN, 3, 4])
    const b = Float64Array.from([5, 6, Number.NaN, 8, 9])
    const p = pairedRows(a, b)
    expect(p.rows).toEqual([0, 3])
    expect(arr(p.a)).toEqual([1, 4])
    expect(arr(p.b)).toEqual([5, 8])
  })
})
