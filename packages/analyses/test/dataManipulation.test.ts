import {
  type AnalysisDef,
  createTable,
  type DataTable,
  type NormalizedDataSet,
  normalizeTable,
  type SummaryData,
  type SummaryPreset,
  tableIssues,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { arr, expectClose, loadFixtures } from '../../stats/test/oracle.ts'
import { growthRatio } from '../../stats/test/timing.ts'
import {
  aggregateDef,
  filterRowsDef,
  percentagesDef,
  survivalTimeDef,
  transformDef,
} from '../src/index.ts'
import { runWithContext } from './helpers.ts'

// Roadmap 38: tables derived from a table (Filter rows, Aggregate by group, percentages, time
// units), R-checked where they compute statistics, safe on degenerate input, linear in the rows.

function mv(cols: Record<string, (number | null)[] | (string | null)[] | string>): DataTable {
  const titles = Object.keys(cols)
  const rows = Math.max(0, ...Object.values(cols).map((v) => (Array.isArray(v) ? v.length : 0)))
  const t = createTable({ tableKind: 'multipleVariables', columns: titles.length, rows })
  titles.forEach((title, i) => {
    const ds = t.dataSets[i]!
    ds.title = title
    const v = cols[title]!
    if (typeof v === 'string') ds.formula = v
    else if (v.some((x) => typeof x === 'string')) ds.text = v as (string | null)[]
    else ds.subcolumns[0]!.values = v as (number | null)[]
  })
  return t
}

const column = (t: DataTable, title: string) => {
  const ds = t.dataSets.find((d) => d.title === title)!
  return ds.text ?? ds.subcolumns[0]!.values
}

describe('Filter rows', () => {
  const t = mv({
    sample: ['S1', 'S2', 'S1', 'S1', null, 'S2'],
    nCount: [600, 900, 400, 501, 800, null],
    pct: [1, 2, 3, 4, 5, 6],
  })

  it('keeps the rows that meet the condition, every variable, as a multiple-variables table', () => {
    const r = runWithContext(filterRowsDef, t, { condition: 'sample == "S1" and nCount > 500' })
    expect(r.status).toBe('ok')
    const out = r.table!
    expect(tableIssues(out)).toEqual([])
    expect(out.tableKind).toBe('multipleVariables')
    expect(out.rowCount).toBe(2)
    expect(column(out, 'sample')).toEqual(['S1', 'S1'])
    expect(column(out, 'nCount')).toEqual([600, 501])
    expect(column(out, 'pct')).toEqual([1, 4])
    // Stable ids: the source's.
    expect(out.dataSets.map((d) => d.id)).toEqual(t.dataSets.map((d) => d.id))
    expect(r.values.kept).toEqual({ kind: 'integer', v: 2 })
  })

  it('leaves out rows missing a value the condition needs, and says so', () => {
    const r = runWithContext(filterRowsDef, t, { condition: 'nCount >= 800 or Row = 1' })
    expect(column(r.table!, 'pct')).toEqual([1, 2, 5])
    expect(r.diagnostics.some((d) => d.message.includes('1 row with a value'))).toBe(true)
  })

  it('reports a condition that can’t be used, and no rows as a warning', () => {
    expect(runWithContext(filterRowsDef, t, { condition: 'Weight > 1' }).status).toBe('error')
    expect(
      runWithContext(filterRowsDef, t, { condition: 'concat(sample)' }).diagnostics[0]!.message,
    ).toContain('text')
    const none = runWithContext(filterRowsDef, t, { condition: 'pct > 100' })
    expect(none.status).toBe('warning')
    expect(none.table!.rowCount).toBe(0)
    expect(tableIssues(none.table!)).toEqual([])
  })

  it('filters XY tables by X or Y, keeping X and replicates', () => {
    const xy = createTable({
      tableKind: 'xy',
      columns: 2,
      rows: 4,
      yFormat: { type: 'replicates', count: 2 },
    })
    xy.x!.subcolumns[0]!.values = [0, 1, 2, 3]
    xy.dataSets[0]!.title = 'A'
    xy.dataSets[0]!.subcolumns[0]!.values = [1, 2, 3, 4]
    xy.dataSets[0]!.subcolumns[1]!.values = [3, 4, 5, 6]
    xy.dataSets[1]!.title = 'B'
    const r = runWithContext(filterRowsDef, xy, { condition: 'X >= 1 and A < 5' })
    const out = r.table!
    expect(tableIssues(out)).toEqual([])
    expect(out.tableKind).toBe('xy')
    expect(out.x!.subcolumns[0]!.values).toEqual([1, 2])
    // A is the row's mean of its replicates.
    expect(out.dataSets[0]!.subcolumns[1]!.values).toEqual([4, 5])
    expect(out.yFormat).toEqual({ type: 'replicates', count: 2 })
  })

  it('filters column and grouped tables by row title or values', () => {
    const g = createTable({ tableKind: 'grouped', columns: 2, rows: 3 })
    g.rowTitles = ['Day 1', 'Day 2', 'Week 1']
    g.dataSets[0]!.subcolumns[0]!.values = [1, 2, 3]
    const r = runWithContext(filterRowsDef, g, { condition: 'startswith(Row_title, "day")' })
    expect(r.table!.rowTitles).toEqual(['Day 1', 'Day 2'])
    expect(r.table!.tableKind).toBe('grouped')
  })

  it('keeps summary data as mean, SD and N', () => {
    const s = createTable({
      tableKind: 'grouped',
      columns: 1,
      rows: 3,
      yFormat: { type: 'summary', preset: 'meanSdN' },
    })
    s.dataSets[0]!.title = 'A'
    s.dataSets[0]!.subcolumns[0]!.values = [1, 5, 9]
    s.dataSets[0]!.subcolumns[1]!.values = [0.1, 0.5, 0.9]
    s.dataSets[0]!.subcolumns[2]!.values = [3, 3, 3]
    const out = runWithContext(filterRowsDef, s, { condition: 'A > 2' }).table!
    expect(tableIssues(out)).toEqual([])
    expect(out.dataSets[0]!.subcolumns.map((c) => c.values)).toEqual([
      [5, 9],
      [0.5, 0.9],
      [3, 3],
    ])
  })

  // Audit 2 (decision 681): every summary preset keeps what it draws: SEM without N, CV as SD,
  // ± error and upper / lower bounds.
  const SUMMARY_CASES: [SummaryPreset, (number | null)[][], string][] = [
    [
      'meanSdN',
      [
        [1, 5, 9],
        [0.1, 0.5, 0.9],
        [3, 4, 5],
      ],
      'meanSdN',
    ],
    [
      'meanSemN',
      [
        [1, 5, 9],
        [0.1, 0.5, 0.9],
        [3, 4, 5],
      ],
      'meanSemN',
    ],
    [
      'meanCvN',
      [
        [1, 5, 9],
        [0.1, 0.2, 0.3],
        [3, 4, 5],
      ],
      'meanSdN',
    ],
    [
      'meanSd',
      [
        [1, 5, 9],
        [0.1, 0.5, 0.9],
      ],
      'meanSdN',
    ],
    [
      'meanSem',
      [
        [1, 5, 9],
        [0.1, 0.5, 0.9],
      ],
      'meanSemN',
    ],
    [
      'meanPlusMinus',
      [
        [1, 5, 9],
        [0.3, 0.7, 1.1],
        [0.1, 0.2, 0.4],
      ],
      'meanUpperLower',
    ],
    [
      'meanUpperLower',
      [
        [1, 5, 9],
        [1.5, 6, 9.9],
        [0.5, 4.5, 8.1],
      ],
      'meanUpperLower',
    ],
  ]
  it.each(SUMMARY_CASES)('keeps %s summary data as it draws', (preset, cols, outPreset) => {
    const s = createTable({
      tableKind: 'grouped',
      columns: 1,
      rows: 3,
      yFormat: { type: 'summary', preset },
    })
    s.dataSets[0]!.title = 'A'
    cols.forEach((v, i) => {
      s.dataSets[0]!.subcolumns[i]!.values = v
    })
    const out = runWithContext(filterRowsDef, s, { condition: 'A > 2' }).table!
    expect(tableIssues(out)).toEqual([])
    expect(out.yFormat).toEqual({ type: 'summary', preset: outPreset })
    const before = normalizeTable(s)[0]!.data as SummaryData
    const after = normalizeTable(out)[0]!.data as SummaryData
    const kept = (a: Float64Array | undefined) => (a ? Array.from(a).slice(1) : undefined)
    const of = (a: Float64Array | undefined) => (a ? Array.from(a) : undefined)
    expect(of(after.mean)).toEqual(kept(before.mean))
    if (outPreset === 'meanUpperLower') {
      expect(of(after.lo)).toEqual(kept(before.lo))
      expect(of(after.hi)).toEqual(kept(before.hi))
    } else {
      expect(of(after.sd)).toEqual(kept(before.sd))
      expect(of(after.sem)).toEqual(kept(before.sem))
      expect(of(after.n)).toEqual(kept(before.n))
    }
  })

  it('reads calculated variables, text ones too', () => {
    const c = mv({ x: [1, 5, 10], Bin: '=cut(x, 0, 4, 20, "low", "high")' })
    const out = runWithContext(filterRowsDef, c, { condition: 'Bin = "high"' }).table!
    expect(column(out, 'x')).toEqual([5, 10])
    expect(column(out, 'Bin')).toEqual(['high', 'high'])
  })
})

describe('Aggregate by group', () => {
  it('summarises number variables by the text variables, groups in first-seen order', () => {
    const t = mv({
      sample: ['S2', 'S1', 'S2', 'S1', null],
      cond: ['a', 'a', 'b', 'a', 'a'],
      v: [1, 2, 3, 4, 100],
    })
    const r = runWithContext(aggregateDef, t, { stats: ['mean', 'n', 'pctAbove'], threshold: 2 })
    expect(r.status).toBe('ok')
    const out = r.table!
    expect(tableIssues(out)).toEqual([])
    expect(column(out, 'sample')).toEqual(['S2', 'S1', 'S2'])
    expect(column(out, 'cond')).toEqual(['a', 'a', 'b'])
    expect(column(out, 'v mean')).toEqual([1, 3, 3])
    expect(column(out, 'v n')).toEqual([1, 2, 1])
    expect(column(out, 'v % > 2')).toEqual([0, 50, 100])
    expect(r.diagnostics.some((d) => d.message.startsWith('1 row'))).toBe(true)
  })

  it('says when the results sheet shows only the first 1000 groups (audit 2)', () => {
    const many = (k: number) =>
      mv({
        g: Array.from({ length: k }, (_, i) => `G${i}`),
        v: Array.from({ length: k }, (_, i) => i),
      })
    const note = (k: number) => {
      const r = runWithContext(aggregateDef, many(k), { stats: ['mean'] })
      expect(r.table!.rowCount).toBe(k)
      const rows = r.sheets[0]!.blocks.find((b) => b.type === 'table')
      expect(rows?.type === 'table' && rows.rows.length).toBe(Math.min(k, 1000))
      return r.diagnostics.find((d) => d.message.startsWith('The results sheet shows'))
    }
    expect(note(1000)).toBeUndefined()
    expect(note(1001)).toMatchObject({
      level: 'info',
      message:
        'The results sheet shows the first 1000 of the 1001 groups; the table made has every group.',
    })
  })

  it('needs a text variable and a statistic', () => {
    expect(runWithContext(aggregateDef, mv({ v: [1, 2] })).status).toBe('error')
    expect(runWithContext(aggregateDef, mv({ g: ['a'], v: [1] }), { stats: [] }).status).toBe(
      'error',
    )
  })

  const fixtures = loadFixtures<
    { groups: Record<string, (string | null)[]>; values: Record<string, (number | null)[]> },
    Record<string, unknown>
  >('aggregate')
  for (const f of fixtures)
    it(`matches R’s tapply: ${f.name}`, () => {
      const cols: Record<string, (number | null)[] | (string | null)[]> = {}
      for (const [k, v] of Object.entries(f.input.groups))
        cols[k] = (arr(v) as (string | null)[]).map((s) => (s === 'NA' ? null : s))
      for (const [k, v] of Object.entries(f.input.values))
        cols[k] = (arr(v) as unknown as number[]).map((x) => (Number.isNaN(x) ? null : x))
      const t = mv(cols)
      const stats = [
        'mean',
        'median',
        'sd',
        'sem',
        'n',
        'min',
        'max',
        'sum',
        'pctAbove',
        'pctNonzero',
      ] as const
      const threshold = f.params.threshold as number
      const out = runWithContext(aggregateDef, t, { stats, threshold }).table!
      const groupNames = Object.keys(f.input.groups)
      const keys = out.dataSets[0]!.text!.map((_, r) =>
        groupNames.map((g) => column(out, g)[r]).join('|'),
      )
      const rKeys = arr(f.expected.keys as string | string[]) as string[]
      expect([...keys].sort()).toEqual(rKeys)
      for (const name of Object.keys(f.input.values)) {
        const want = f.expected[name] as Record<string, unknown>
        for (const stat of stats) {
          const title =
            stat === 'pctAbove'
              ? `${name} % > ${threshold}`
              : `${name} ${{ mean: 'mean', median: 'median', sd: 'SD', sem: 'SEM', n: 'n', min: 'min', max: 'max', sum: 'sum', pctNonzero: '% non-zero' }[stat]}`
          const got = column(out, title) as (number | null)[]
          const w = arr(want[stat] as number | number[]) as number[]
          rKeys.forEach((key, i) => {
            const v = got[keys.indexOf(key)] ?? Number.NaN
            expectClose(v, w[i]!, {}, `${name} ${stat} ${key}`)
          })
        }
      }
    })
})

describe('Percentages and time units', () => {
  it('gives row, column and total % of a contingency table', () => {
    const t = createTable({ tableKind: 'contingency', columns: 2, rows: 2 })
    t.dataSets[0]!.subcolumns[0]!.values = [10, 30]
    t.dataSets[1]!.subcolumns[0]!.values = [30, 30]
    const row = runWithContext(percentagesDef, t, { of: 'row' }).table!
    expect(row.tableKind).toBe('contingency')
    expect(row.dataSets.map((d) => d.subcolumns[0]!.values)).toEqual([
      [25, 50],
      [75, 50],
    ])
    const col = runWithContext(percentagesDef, t, { of: 'column' }).table!
    expect(col.dataSets.map((d) => d.subcolumns[0]!.values)).toEqual([
      [25, 75],
      [50, 50],
    ])
    const tot = runWithContext(percentagesDef, t, { of: 'total' }).table!
    expect(tot.dataSets.map((d) => d.subcolumns[0]!.values)).toEqual([
      [10, 30],
      [30, 30],
    ])
  })

  it('takes parts of whole tables, and Transform accepts them', () => {
    const t = createTable({ tableKind: 'partsOfWhole', columns: 1, rows: 3 })
    t.dataSets[0]!.subcolumns[0]!.values = [1, 1, 2]
    const pct = runWithContext(percentagesDef, t, { of: 'column' }).table!
    expect(pct.dataSets[0]!.subcolumns[0]!.values).toEqual([25, 25, 50])
    expect(transformDef.accepts).toContain('partsOfWhole')
    const tr = runWithContext(transformDef, t, { y: 'multiplyK', k: 10 }).table!
    expect(tr.tableKind).toBe('partsOfWhole')
    expect(tr.dataSets[0]!.subcolumns[0]!.values).toEqual([10, 10, 20])
  })

  it('converts a survival table’s days to weeks, months and years', () => {
    const t = createTable({ tableKind: 'survival', columns: 1, rows: 2 })
    t.x!.subcolumns[0]!.values = [14, 365.25]
    t.dataSets[0]!.subcolumns[0]!.values = [1, 0]
    const w = runWithContext(survivalTimeDef, t, { from: 'days', to: 'weeks' }).table!
    expect(w.x!.subcolumns[0]!.values).toEqual([2, 52.17857142857143])
    expect(w.x!.title).toBe('Weeks elapsed')
    const y = runWithContext(survivalTimeDef, t, { from: 'days', to: 'years' }).table!
    expect(y.x!.subcolumns[0]!.values[1]).toBe(1)
    const m = runWithContext(survivalTimeDef, w, { from: 'weeks', to: 'months' }).table!
    expectClose(m.x!.subcolumns[0]!.values[0]!, 14 / (365.25 / 12))
    expect(w.dataSets[0]!.subcolumns[0]!.values).toEqual([1, 0])
  })
})

describe('degenerate input with real parameters', () => {
  const cases: [string, DataTable, unknown, typeof filterRowsDef | typeof aggregateDef][] = [
    ['filter of an empty table', mv({ a: [], g: [] }), { condition: 'a > 1' }, filterRowsDef],
    [
      'filter of blank cells',
      mv({ a: [null, null], g: [null, null] }),
      { condition: 'g = "x"' },
      filterRowsDef,
    ],
    [
      'aggregate of an empty table',
      mv({ g: [] as string[], v: [] }),
      { stats: ['mean', 'sd', 'median'] },
      aggregateDef as never,
    ],
    ['aggregate of blank groups', mv({ g: [null, null], v: [1, 2] }), {}, aggregateDef as never],
    [
      'aggregate of one value',
      mv({ g: ['a'], v: [1] }),
      { stats: ['sd', 'sem', 'median', 'pctNonzero'] },
      aggregateDef as never,
    ],
  ]
  for (const [name, t, params, def] of cases)
    it(name, () => {
      const r = runWithContext(def as unknown as AnalysisDef<unknown>, t, params)
      if (r.table) expect(tableIssues(r.table)).toEqual([])
      if (r.status === 'error') expect(r.diagnostics.some((d) => d.level === 'error')).toBe(true)
    })
})

// ---------------------------------------------------------------------------------------------
// Growth guards: filter and aggregate at 100k vs 1M rows (roadmap 34e sizes)
// ---------------------------------------------------------------------------------------------

describe('growth at 100k vs 1M rows', () => {
  const N = 1_000_000
  const sample = new Array<string>(N)
  const count = new Float64Array(N)
  let s = 7
  for (let i = 0; i < N; i++) {
    s = (s * 16807) % 2147483647
    sample[i] = `S${s % 8}`
    count[i] = s % 2000
  }
  const inputs = new Map<number, NormalizedDataSet[]>()
  const inputOf = (n: number): NormalizedDataSet[] => {
    let v = inputs.get(n)
    if (!v) {
      const t = createTable({ tableKind: 'multipleVariables', columns: 2, rows: n })
      t.dataSets[0]!.title = 'sample'
      t.dataSets[0]!.text = sample.slice(0, n)
      t.dataSets[1]!.title = 'nCount'
      t.dataSets[1]!.subcolumns[0]!.values = Array.from(count.subarray(0, n))
      v = normalizeTable(t)
      inputs.set(n, v)
    }
    return v
  }
  const ctx = { tableKind: 'multipleVariables' as const, xTitle: null }
  it('filter rows', () => {
    const p = filterRowsDef.params.parse({ condition: 'sample = "S1" and nCount > 500' })
    const ratio = growthRatio((n) => filterRowsDef.run(inputOf(n), p, ctx), 100_000, 10, 2)
    expect(ratio).toBeLessThan(25)
  }, 300_000)
  it('aggregate by group', () => {
    const p = aggregateDef.params.parse({ stats: ['mean', 'median', 'sd', 'n', 'pctNonzero'] })
    const ratio = growthRatio((n) => aggregateDef.run(inputOf(n), p, ctx), 100_000, 10, 2)
    expect(ratio).toBeLessThan(25)
  }, 300_000)
})
