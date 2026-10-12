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
import { expectClose, loadFixtures } from '../../stats/test/oracle.ts'
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

  it('reports the test chosen in advance and one hazard ratio (51c, S16)', () => {
    const r = run(survivalTable([A, B]))
    expect(r.status).toBe('ok')
    const ref = compareSurvival([subjects(A), subjects(B)])
    expect(v(kvOf(r, 'P value', 'Log-rank (Mantel-Cox) test'))).toBe(ref.logRank.p)
    expect(() => kvOf(r, 'Chi square', 'Gehan-Breslow-Wilcoxon test')).toThrow()
    expect(() => kvOf(r, 'Ratio (A/B)', 'Hazard ratio (Mantel-Haenszel)')).toThrow()
    expect(() => kvOf(r, 'Ratio (B/A)', 'Hazard ratio (log-rank)')).toThrow()
    expect(v(r.values.hazardRatio!)).toBe(ref.hazardRatio!.mantelHaenszel.value)
    expect(r.sheets.map((s) => s.key)).toEqual(['comparison', 'survival', 'summary'])
    const gbw = run(survivalTable([A, B]), { test: 'gehanBreslowWilcoxon' })
    expect(v(gbw.values.p!)).toBe(ref.gehanBreslowWilcoxon.p)
    expect(() => kvOf(gbw, 'P value', 'Log-rank (Mantel-Cox) test')).toThrow()
    // The reference group second: the ratio is A ÷ B.
    const t = survivalTable([A, B])
    const flipped = run(t, { control: t.dataSets[1]!.id })
    expect(v(flipped.values.hazardRatio!)).toBeCloseTo(
      1 / ref.hazardRatio!.mantelHaenszel.value,
      14,
    )
    // Saved before 0.3.9: every test and both hazard ratios, as before.
    const saved = run(survivalTable([A, B]), { test: 'all', trend: true, hazardRatio: 'both' })
    expect(v(kvOf(saved, 'Chi square', 'Gehan-Breslow-Wilcoxon test'))).toBe(
      ref.gehanBreslowWilcoxon.chiSq,
    )
    expect(v(saved.values.p!)).toBe(ref.logRank.p)
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
    // Roadmap 51c (S16): only when the groups are said to be ordered.
    expect(() =>
      kvOf(run(survivalTable([A, B, C])), 'P value', 'Log-rank test for trend'),
    ).toThrow()
    const three = run(survivalTable([A, B, C]), { trend: true })
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
    // Roadmap 51c (S21): the trend test only when the rows are said to be ordered.
    expect(() =>
      kvOf(run(counts, { test: 'chiSquare' }), 'P value', 'Chi-square test for trend'),
    ).toThrow()
    const r = run(counts, { test: 'chiSquare', trend: true })
    expect(v(kvOf(r, 'P value', 'Chi-square test for trend'))).toBe(chiSquareTrend(counts).p)
    expect(r.values.relativeRisk).toBeUndefined()
  })

  // Roadmap 51c (S22): the user says which row is exposed and which column the outcome; a table
  // entered the other way round gives R's estimates of the table oriented as stated (suite
  // `contingency`, each 2×2 case with its rows and/or columns swapped back by the roles).
  type Estimate = { value: number }
  for (const f of loadFixtures<
    { table: number[][] },
    { fisher: { p: number }; twoByTwo?: Record<'relativeRisk' | 'oddsRatio', Estimate> }
  >('contingency')) {
    const two = f.expected.twoByTwo
    const t = f.input.table
    if (!two || t.length !== 2 || t[0]!.length !== 2) continue
    // An empty row or column is refused (degenerate), whichever way round.
    if (t.some((r) => r[0]! + r[1]! === 0) || [0, 1].some((j) => t[0]![j]! + t[1]![j]! === 0))
      continue
    it(`2×2 roles: ${f.name}`, () => {
      const flipRows = [t[1]!, t[0]!]
      const flipCols = t.map((r) => [r[1]!, r[0]!])
      const both = flipRows.map((r) => [r[1]!, r[0]!])
      for (const [entered, exposedRow, outcomeColumn] of [
        [flipRows, 1, 0],
        [flipCols, 0, 1],
        [both, 1, 1],
      ] as const) {
        const r = run(entered, { exposedRow, outcomeColumn })
        const at = `${exposedRow}${outcomeColumn}`
        expectClose(v(r.values.p!), f.expected.fisher.p, f.tol, `${at} Fisher P`)
        expectClose(v(r.values.relativeRisk!), two.relativeRisk.value, f.tol, `${at} RR`)
        expectClose(v(r.values.oddsRatio!), two.oddsRatio.value, f.tol, `${at} OR`)
      }
    })
  }

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
