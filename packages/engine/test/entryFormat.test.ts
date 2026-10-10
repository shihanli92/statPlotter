import { createProject, createTable, type DataTable, type GraphNode, type YFormat } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { CommandError, canConvert, convertTable, DocumentStore } from '../src/index.ts'
import { graph } from './familyFixture.ts'

const summary = (preset: Extract<YFormat, { type: 'summary' }>['preset']): YFormat => ({
  type: 'summary',
  preset,
})

/** A grouped table in `format` whose first data set holds `rows` (one array per subcolumn). */
function table(
  format: YFormat,
  rows: (number | null)[][],
  kind: DataTable['tableKind'] = 'grouped',
) {
  const t = createTable({ tableKind: kind, yFormat: format, rows: rows[0]!.length, columns: 1 })
  t.dataSets[0]!.subcolumns.forEach((c, i) => {
    c.values = rows[i]!
  })
  return t
}

const values = (subcolumns: { values: (number | null)[] }[]) => subcolumns.map((c) => c.values)

describe('entry format conversions', () => {
  it('offers only conversions that are exact or computed', () => {
    const reps: YFormat = { type: 'replicates', count: 3 }
    expect(canConvert('grouped', reps, summary('meanSdN'))).toBe(true)
    expect(canConvert('grouped', reps, summary('meanPlusMinus'))).toBe(false)
    expect(canConvert('grouped', summary('meanSdN'), summary('meanCvN'))).toBe(true)
    expect(canConvert('grouped', summary('meanSdN'), summary('meanUpperLower'))).toBe(false)
    expect(canConvert('grouped', summary('meanPlusMinus'), summary('meanUpperLower'))).toBe(true)
    expect(canConvert('grouped', summary('meanSdN'), reps)).toBe(false)
    expect(canConvert('grouped', reps, reps)).toBe(false)
    expect(canConvert('nested', reps, summary('meanSdN'))).toBe(false)
    expect(canConvert('contingency', { type: 'replicates', count: 1 }, summary('meanSdN'))).toBe(
      false,
    )
  })

  it('summarizes replicates per row (excluded values left out)', () => {
    const t = table({ type: 'replicates', count: 3 }, [
      [1, 5, null],
      [2, null, null],
      [3, 7, 4],
    ])
    t.dataSets[0]!.subcolumns[2]!.excluded = [false, false, true]
    const c = convertTable(t, summary('meanSdN'))
    // Row 1: 1, 2, 3 → mean 2, SD 1; row 2: 5, 7 → 6, √2; row 3: nothing left.
    expect(values(c.subcolumns[0]!)).toEqual([
      [2, 6, null],
      [1, Number(Math.SQRT2.toPrecision(15)), null],
      [3, 2, null],
    ])
    expect(c.lost).toBe(6)
    const sem = convertTable(t, summary('meanSemN')).subcolumns[0]!
    expect(sem[1]!.values[0]).toBeCloseTo(1 / Math.sqrt(3), 14)
    const cv = convertTable(t, summary('meanCvN')).subcolumns[0]!
    expect(cv[1]!.values).toEqual([0.5, Number((Math.SQRT2 / 6).toPrecision(15)), null])
  })

  it('makes one row of a column table’s stacked replicates', () => {
    const t = table({ type: 'replicates', count: 1 }, [[4, 6, 8, null]], 'column')
    const c = convertTable(t, summary('meanSemN'))
    expect(c.rowCount).toBe(1)
    expect(values(c.subcolumns[0]!)).toEqual([
      [6],
      [Number((2 / Math.sqrt(3)).toPrecision(15))],
      [3],
    ])
  })

  it('converts SD, SEM and CV exactly given N', () => {
    const t = table(summary('meanSdN'), [
      [10, -4, 5],
      [2, 1, 3],
      [4, 9, null],
    ])
    const sem = convertTable(t, summary('meanSemN'))
    expect(values(sem.subcolumns[0]!)).toEqual([
      [10, -4, 5],
      [1, Number((1 / 3).toPrecision(15)), null],
      [4, 9, null],
    ])
    // Without N, an SD gives no SEM: that value is lost.
    expect(sem.lost).toBe(1)
    const back = convertTable(
      {
        ...t,
        yFormat: summary('meanSemN'),
        dataSets: [{ ...t.dataSets[0]!, subcolumns: sem.subcolumns[0]! }],
      },
      summary('meanSdN'),
    )
    expect(back.subcolumns[0]![1]!.values[0]).toBe(2)
    expect(back.subcolumns[0]![1]!.values[1]).toBeCloseTo(1, 14)
    const cv = convertTable(t, summary('meanCvN'))
    expect(cv.subcolumns[0]![1]!.values).toEqual([0.2, 0.25, 0.6])
    expect(cv.lost).toBe(0)
    // Dropping N loses the entered N values.
    expect(convertTable(t, summary('meanSd')).lost).toBe(2)
  })

  it('converts ± errors to limits and back', () => {
    const t = table(summary('meanPlusMinus'), [
      [10, 20],
      [1, null],
      [2, 3],
    ])
    const lim = convertTable(t, summary('meanUpperLower'))
    expect(values(lim.subcolumns[0]!)).toEqual([
      [10, 20],
      [11, null],
      [8, 17],
    ])
    expect(lim.lost).toBe(0)
  })
})

describe('table.setYFormat', () => {
  it('converts in one undo step and moves what named dropped rows', () => {
    const t = table({ type: 'replicates', count: 1 }, [[4, 6, 8]], 'column')
    const g = graph('G', t.id, {
      seriesSource: { table: t.id, include: 'all', rows: [0, 2] },
    })
    const store = new DocumentStore(createProject())
    store.dispatch([
      { type: 'node.add', node: t },
      { type: 'node.add', node: g },
    ])
    const before = store.getState()
    store.dispatch({ type: 'table.setYFormat', table: t.id, format: summary('meanSdN') })
    const next = store.getState()
    expect(next.nodes[t.id]).toMatchObject({ rowCount: 1, yFormat: summary('meanSdN') })
    expect((next.nodes[g.id] as GraphNode).seriesSource.rows).toEqual([0])
    store.undo()
    expect(store.getState()).toEqual(before)
    expect(() =>
      store.dispatch({ type: 'table.setYFormat', table: t.id, format: summary('meanPlusMinus') }),
    ).toThrow(CommandError)
  })
})
