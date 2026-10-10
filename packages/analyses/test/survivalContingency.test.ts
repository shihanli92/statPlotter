import {
  contingencyCounts,
  createTable,
  type DataTable,
  normalizeTable,
  survivalData,
} from '@ps/model'
import {
  chiSquareTest,
  chiSquareTrend,
  compareSurvival,
  fisherExact,
  kaplanMeier,
  twoByTwo,
} from '@ps/stats'
import { describe, expect, it } from 'vitest'
import { contingencyDef, survivalDef } from '../src/index.ts'
import { kvOf, runDef, v } from './helpers.ts'

/** Survival table: each group's subjects on their own rows, time in X. */
function survivalTable(groups: { time: number; code: number }[][]): DataTable {
  const rows = groups.reduce((s, g) => s + g.length, 0)
  const t = createTable({ tableKind: 'survival', columns: groups.length, rows })
  let r = 0
  groups.forEach((g, c) => {
    for (const s of g) {
      t.x!.subcolumns[0]!.values[r] = s.time
      t.dataSets[c]!.subcolumns[0]!.values[r] = s.code
      r++
    }
  })
  return t
}

const A = [
  { time: 5, code: 1 },
  { time: 8, code: 1 },
  { time: 8, code: 0 },
  { time: 12, code: 1 },
  { time: 15, code: 0 },
  { time: 20, code: 1 },
]
const B = [
  { time: 10, code: 1 },
  { time: 14, code: 0 },
  { time: 22, code: 1 },
  { time: 30, code: 0 },
  { time: 31, code: 1 },
  { time: 40, code: 0 },
]
const subjects = (g: { time: number; code: number }[]) =>
  g.map((s) => ({ time: s.time, event: s.code === 1 }))

describe('survival data in the model', () => {
  it('reads one subject per row, with its group’s code', () => {
    const t = survivalTable([A, B])
    const [a, b] = normalizeTable(t)
    expect(survivalData(a!).subjects.map((s) => [s.time, s.event])).toEqual(
      A.map((s) => [s.time, s.code === 1]),
    )
    expect(survivalData(b!).subjects).toHaveLength(6)
  })

  it('counts missing times and unknown codes', () => {
    const t = survivalTable([A])
    t.x!.subcolumns[0]!.values[0] = null
    t.dataSets[0]!.subcolumns[0]!.values[1] = 2
    const d = survivalData(normalizeTable(t)[0]!)
    expect(d.missingTime).toBe(1)
    expect(d.invalidCode).toBe(1)
    expect(d.subjects).toHaveLength(4)
  })
})

describe('survival curves plugin', () => {
  const run = (t: DataTable, p: object = {}) => runDef(survivalDef, t, p)

  it('accepts survival tables', () => {
    expect(survivalDef.accepts).toEqual(['survival'])
  })

  it('reports the log-rank and Gehan-Breslow-Wilcoxon tests and the hazard ratio', () => {
    const r = run(survivalTable([A, B]))
    expect(r.status).toBe('ok')
    const ref = compareSurvival([subjects(A), subjects(B)])
    expect(v(kvOf(r, 'P value', 'Log-rank (Mantel-Cox) test'))).toBe(ref.logRank.p)
    expect(v(kvOf(r, 'Chi square', 'Gehan-Breslow-Wilcoxon test'))).toBe(
      ref.gehanBreslowWilcoxon.chiSq,
    )
    expect(v(r.values.hazardRatio!)).toBe(ref.hazardRatio!.mantelHaenszel.value)
    expect(r.sheets.map((s) => s.key)).toEqual(['comparison', 'survival', 'summary'])
  })

  it('tabulates percent survival for each group', () => {
    const r = run(survivalTable([A, B]))
    const b = r.sheets.find((s) => s.key === 'survival')!.blocks[0]!
    if (b.type !== 'table') throw new Error('table expected')
    const km = kaplanMeier(subjects(A))
    expect(b.rows).toHaveLength(km.steps.length)
    expect(v(b.rows[1]![4]!)).toBeCloseTo(100 * km.steps[1]!.survival, 12)
  })

  it('adds the trend test with three groups, and none with one', () => {
    const C = A.map((s) => ({ ...s, time: s.time + 3 }))
    const three = run(survivalTable([A, B, C]))
    const ref = compareSurvival([subjects(A), subjects(B), subjects(C)])
    expect(v(kvOf(three, 'P value', 'Log-rank test for trend'))).toBe(ref.logRankTrend!.p)
    expect(run(survivalTable([A])).sheets.map((s) => s.key)).toEqual(['survival', 'summary'])
  })

  it('honours custom codes and warns about unknown ones', () => {
    const t = survivalTable([A.map((s) => ({ ...s, code: s.code ? 2 : 9 }))])
    const r = run(t, { eventCode: 2, censoredCode: 9 })
    expect(r.status).toBe('ok')
    expect(run(t).status).toBe('error') // no subject has a 1/0 code
  })
})

describe('contingency plugin', () => {
  const run = (counts: number[][], p: object = {}) => {
    const t = createTable({
      tableKind: 'contingency',
      columns: counts[0]!.length,
      rows: counts.length,
    })
    counts.forEach((row, r) => {
      row.forEach((c, j) => {
        t.dataSets[j]!.subcolumns[0]!.values[r] = c
      })
    })
    return runDef(contingencyDef, t, p)
  }
  const table = [
    [15, 85],
    [30, 70],
  ]

  it('collects complete rows and flags partly filled ones', () => {
    const t = createTable({ tableKind: 'contingency', columns: 2, rows: 4 })
    t.dataSets[0]!.subcolumns[0]!.values = [1, 2, null, 4]
    t.dataSets[1]!.subcolumns[0]!.values = [5, 6, null, null]
    const c = contingencyCounts(normalizeTable(t))
    expect(c.counts).toEqual([
      [1, 5],
      [2, 6],
    ])
    expect(c.incompleteRows).toEqual([3])
  })

  it('2×2: Fisher’s exact test with relative risk and odds ratio', () => {
    const r = run(table)
    expect(v(kvOf(r, 'P value', 'Fisher’s exact test'))).toBe(fisherExact(table).p)
    const e = twoByTwo(table)
    expect(v(r.values.relativeRisk!)).toBe(e.relativeRisk.value)
    expect(v(r.values.oddsRatio!)).toBe(e.oddsRatio.value)
    expect(r.sheets.map((s) => s.key)).toEqual(['results', 'expected', 'percentages'])
  })

  it('chi-square with and without Yates’ correction', () => {
    const plain = run(table, { test: 'chiSquare' })
    const yates = run(table, { test: 'chiSquare', yates: true })
    expect(v(plain.values.chiSq!)).toBe(chiSquareTest(table).chiSq)
    expect(v(yates.values.chiSq!)).toBe(chiSquareTest(table, { yates: true }).chiSq)
    expect(v(yates.values.chiSq!)).toBeLessThan(v(plain.values.chiSq!))
  })

  it('larger tables: chi-square for trend on k×2', () => {
    const counts = [
      [10, 40],
      [15, 35],
      [25, 25],
    ]
    const r = run(counts, { test: 'chiSquare' })
    expect(v(kvOf(r, 'P value', 'Chi-square test for trend'))).toBe(chiSquareTrend(counts).p)
    expect(r.values.relativeRisk).toBeUndefined()
  })

  it('names a row with a blank title “Row n”', () => {
    const t = createTable({ tableKind: 'contingency', columns: 2, rows: 3 })
    t.rowTitles = ['Low', '', 'High']
    t.dataSets[0]!.subcolumns[0]!.values = [1, 2, 3]
    t.dataSets[1]!.subcolumns[0]!.values = [4, null, 6]
    const r = runDef(contingencyDef, t)
    expect(r.diagnostics.at(-1)!.message).toBe(
      'Every cell of a row needs a count; Row 2 is incomplete.',
    )
  })

  it('refuses non-integer or incomplete counts', () => {
    expect(
      run([
        [1.5, 2],
        [3, 4],
      ]).status,
    ).toBe('error')
  })
})
