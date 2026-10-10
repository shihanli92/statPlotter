import { describe, expect, it } from 'vitest'
import { growthRatio } from '../../stats/test/timing.ts'
import type { BlockLayout } from '../src/import/layout.ts'
import { longToTable, type Sheet, sheetToTable, transposeGrid } from '../src/index.ts'

/** Long data: `rows` rows, two per subject (groups A and B), the row number as the score. */
function longSheet(rows: number): Sheet {
  const out: Sheet['rows'] = [['subject', 'group', 'score']]
  for (let i = 0; i < rows; i++) out.push([`s${i >> 1}`, i % 2 ? 'B' : 'A', i])
  return { name: 'S', rows: out }
}

/**
 * Sheets with more rows than a call takes arguments (~120k): spreading their rows into
 * `Math.max(...)` / `push(...)` overflowed the call stack.
 */
const N = 300_000

describe('data-sized imports', () => {
  it('imports a detected block of 300k rows and accounts for a left-out column', () => {
    const rows: Sheet['rows'] = [['Control', 'Treated', 'P value']]
    for (let i = 0; i < N; i++) rows.push([i, i + 0.5, 0.01])
    const layout: BlockLayout = {
      kind: 'column',
      orient: 'columns',
      rows: Array.from({ length: N }, (_, i) => i + 1),
      labelCol: null,
      sets: [
        { title: 'Control', cols: [0] },
        { title: 'Treated', cols: [1] },
      ],
    }
    const { table, account } = sheetToTable(
      { name: 'S', rows },
      {
        name: 'Big',
        tableKind: 'column',
        headerRow: true,
        firstColumn: 'data',
        layout,
        area: { r0: 0, c0: 0, r1: N, c1: 2 },
      },
    )
    expect(table.rowCount).toBe(N)
    expect(table.dataSets[1]!.subcolumns[0]!.values[N - 1]).toBe(N - 0.5)
    expect(account!.values).toBe(2 * N)
    expect(account!.groups).toEqual([{ where: 'column C “P value”', count: N }])
  })

  it('transposes a pasted grid of 300k rows', () => {
    const grid = Array.from({ length: N }, (_, i) => [i, i + 1])
    const t = transposeGrid(grid)
    expect(t).toHaveLength(2)
    expect(t[1]![N - 1]).toBe(N)
  })

  it('imports long data with 100k subjects in 200k rows, in linear time', () => {
    // Levels were looked up with `includes` / `indexOf`: quadratic in the distinct levels.
    const M = 200_000
    const paired = longToTable(longSheet(M), { name: 'Long', value: 2, group: 1, subject: 0 })
    const grouped = longToTable(longSheet(M), { name: 'Long', value: 2, group: 1, row: 0 })
    expect(paired.table.rowCount).toBe(M / 2)
    expect(paired.table.rowTitles![M / 2 - 1]).toBe(`s${M / 2 - 1}`)
    expect(paired.table.dataSets[1]!.subcolumns[0]!.values[M / 2 - 1]).toBe(M - 1)
    expect(grouped.table.rowCount).toBe(M / 2)
    expect(grouped.table.dataSets[0]!.subcolumns[0]!.values[3]).toBe(6)
    expect(paired.account!.values).toBe(M)
    // CPU time at 4× the rows (CLAUDE.md: no wall-clock bounds): about 4 when linear, 16 when
    // quadratic in the subjects.
    const sheets = new Map([12_500, 50_000].map((n) => [n, longSheet(n)]))
    const run = (n: number) => {
      longToTable(sheets.get(n)!, { name: 'Long', value: 2, group: 1, subject: 0 })
    }
    expect(growthRatio(run, 12_500)).toBeLessThan(10)
  })
})
