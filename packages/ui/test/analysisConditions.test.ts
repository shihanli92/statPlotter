import {
  analysisChecks,
  analysisFacts,
  fieldStates,
  INVALID_COMBINATIONS,
  NEEDS_RAW,
  registry,
} from '@ps/analyses'
import {
  createTable,
  type DataTable,
  normalizeTable,
  type TableKind,
  type YFormat,
} from '@ps/model'
import { describe, expect, it } from 'vitest'

// Roadmap 51b (design §4.4, S10, U8): every invalid combination the reviews found is hidden or
// greyed with its reason in the Analyze dialog (or blocked before Analyze with what to change),
// and `run` still refuses the ones it refused (the guard stays for files and scripts).

type Params = Record<string, unknown>
type Cell = number | null

function table(
  kind: TableKind,
  columns: Cell[][][],
  opts: { yFormat?: YFormat; x?: Cell[]; rows?: number } = {},
): DataTable {
  const rows = opts.rows ?? Math.max(...columns.flatMap((c) => c.map((s) => s.length)))
  const t = createTable({
    tableKind: kind,
    columns: columns.length,
    rows,
    yFormat: opts.yFormat ?? { type: 'replicates', count: columns[0]!.length },
  })
  if (t.x && opts.x) t.x.subcolumns[0]!.values = opts.x
  t.dataSets.forEach((d, i) => {
    d.title = ['Control', 'Treated', 'High', 'Late'][i] ?? `G${i}`
    d.subcolumns.forEach((s, j) => {
      s.values = Array.from({ length: rows }, (_, r) => columns[i]![j]?.[r] ?? null)
    })
  })
  return t
}
const column = (...groups: Cell[][]) =>
  table(
    'column',
    groups.map((g) => [g]),
  )
const summary = () =>
  table(
    'column',
    [
      [[10], [2], [5]],
      [[12], [3], [5]],
      [[14], [2], [6]],
    ],
    {
      yFormat: { type: 'summary', preset: 'meanSdN' },
    },
  )
const grouped = (perCell: number) =>
  table(
    'grouped',
    [0, 1].map((c) => Array.from({ length: perCell }, (_, j) => [1 + c + j, 2 + c + j, 4 - c + j])),
  )
const counts = (rows: number[][]) =>
  table(
    'contingency',
    rows[0]!.map((_, c) => [rows.map((r) => r[c]!)]),
  )

interface Case {
  row: number
  analysis: string
  table: DataTable
  params: Params
  path: string
  /** The option greyed (absent: the field itself). */
  option?: unknown
  expect: 'hidden' | 'shown' | 'greyed' | 'block' | 'label' | 'tier'
  reason?: RegExp
  /** `run` with these params fails (the old refusal kept). */
  refused?: boolean
}

const RAW3 = column([1, 2, 3, 4], [3, 4, 5, 7], [2, 6, 7, 9])
const GAP3 = column([1, 2, 3, 4], [3, 4, null, 7], [2, 6, 7, 9])

const CASES: Case[] = [
  {
    row: 1,
    analysis: 'oneWayAnova',
    table: RAW3,
    params: { matched: true, comparisons: 'trend' },
    path: 'comparisons',
    option: 'trend',
    expect: 'greyed',
    reason: /matched rows/,
    refused: true,
  },
  {
    row: 2,
    analysis: 'oneWayAnova',
    table: RAW3,
    params: { gaussian: false, comparisons: 'trend' },
    path: 'comparisons',
    option: 'trend',
    expect: 'greyed',
    reason: /Not with ranks/,
    refused: true,
  },
  {
    row: 3,
    analysis: 'oneWayAnova',
    table: RAW3,
    params: { equalSD: 'welch', comparisons: 'trend' },
    path: 'comparisons',
    option: 'trend',
    expect: 'greyed',
    reason: /similar scatter/,
    refused: true,
  },
  {
    row: 4,
    analysis: 'oneWayAnova',
    table: RAW3,
    params: { matched: true, comparisons: 'allPairs', allPairsMethod: 'newman-keuls' },
    path: 'allPairsMethod',
    option: 'newman-keuls',
    expect: 'greyed',
    reason: /repeated measures/,
    refused: true,
  },
  {
    row: 5,
    analysis: 'oneWayAnova',
    table: GAP3,
    params: { matched: true, rmMethod: 'auto' },
    path: 'sphericity',
    expect: 'greyed',
    reason: /mixed-effects model/,
  },
  {
    row: 6,
    analysis: 'oneWayAnova',
    table: RAW3,
    params: { equalSD: 'welch', comparisons: 'vsControl' },
    path: 'welchMethod',
    expect: 'label',
    reason: /each with the control/,
  },
  {
    row: 7,
    analysis: 'twoWayAnova',
    table: grouped(2),
    params: { repeated: 'columns', comparisons: 'allCells' },
    path: 'comparisons',
    option: 'allCells',
    expect: 'greyed',
    reason: /pooled error term/,
    refused: true,
  },
  {
    row: 8,
    analysis: 'twoWayAnova',
    table: grouped(2),
    params: {
      repeated: 'rows',
      comparisons: 'withinRows',
      kind: 'allPairs',
      allPairsMethod: 'newman-keuls',
    },
    path: 'allPairsMethod',
    option: 'newman-keuls',
    expect: 'greyed',
    reason: /repeated measures/,
    refused: true,
  },
  {
    row: 10,
    analysis: 'twoWayAnova',
    table: grouped(2),
    params: { comparisons: 'withinRows', kind: 'allPairs', allPairsMethod: 'tukey', family: 'all' },
    path: 'family',
    option: 'all',
    expect: 'greyed',
    reason: /adjust within one row/,
  },
  {
    row: 11,
    analysis: 'twoWayAnova',
    table: grouped(1),
    params: { interaction: true },
    path: 'interaction',
    option: true,
    expect: 'greyed',
    reason: /One value per cell/,
    refused: true,
  },
  {
    row: 12,
    analysis: 'threeWayAnova',
    table: table(
      'grouped',
      [0, 1, 2, 3].map((c) => [
        [1 + c, 2, 3],
        [2, 3 + c, 1],
      ]),
    ),
    params: {},
    path: 'rmMethod',
    expect: 'hidden',
  },
  {
    row: 13,
    analysis: 'threeWayAnova',
    table: table(
      'grouped',
      [0, 1, 2, 3].map((c) => [
        [1 + c, 2, 3],
        [2, 3 + c, 1],
      ]),
    ),
    params: { repeatedRows: true, comparisons: 'allCells' },
    path: 'comparisons',
    option: 'allCells',
    expect: 'greyed',
    reason: /Not yet available with repeated measures/,
  },
  {
    row: 14,
    analysis: 'multifactorAnova',
    table: table('multipleVariables', [[[1, 2, 3, 4, 5, 6]], [[1, 1, 2, 2, 3, 3]]]),
    params: { comparisons: 'simpleEffects' },
    path: 'comparisons',
    option: 'simpleEffects',
    expect: 'greyed',
    reason: /Needs two factors/,
    refused: true,
  },
  {
    row: 15,
    analysis: 'contingency',
    table: counts([
      [3, 5],
      [6, 2],
      [4, 4],
    ]),
    params: {},
    path: 'riskEstimates',
    expect: 'hidden',
  },
  {
    row: 15,
    analysis: 'contingency',
    table: counts([
      [3, 5],
      [6, 2],
      [4, 4],
    ]),
    params: {},
    path: 'tails',
    expect: 'hidden',
  },
  {
    row: 15,
    analysis: 'contingency',
    table: counts([
      [3, 5],
      [6, 2],
    ]),
    params: {},
    path: 'oddsRatio',
    expect: 'shown',
  },
  {
    row: 16,
    analysis: 'contingency',
    table: counts([
      [3, 5],
      [6, 2],
    ]),
    params: {},
    path: 'trend',
    expect: 'hidden',
  },
  {
    row: 16,
    analysis: 'contingency',
    table: counts([
      [3, 5, 1],
      [6, 2, 2],
      [4, 4, 1],
    ]),
    params: {},
    path: 'trend',
    expect: 'hidden',
  },
  {
    row: 16,
    analysis: 'contingency',
    table: counts([
      [3, 5],
      [6, 2],
      [4, 4],
    ]),
    params: {},
    path: 'trend',
    expect: 'shown',
  },
  {
    row: 17,
    analysis: 'linearRegression',
    table: table('xy', [[[1, 2, 4]]], { x: [1, 2, 3] }),
    params: {},
    path: 'compare',
    expect: 'hidden',
  },
  {
    row: 17,
    analysis: 'linearRegression',
    table: table('xy', [[[1, 2, 4]], [[2, 2, 5]]], { x: [1, 2, 3] }),
    params: {},
    path: 'compare',
    expect: 'shown',
  },
  {
    row: 18,
    analysis: 'linearRegression',
    table: table('xy', [[[1, 2, 4]]], { x: [1, 2, 3] }),
    params: { throughOrigin: true },
    path: 'throughPoint',
    expect: 'greyed',
    reason: /through the origin/,
  },
  {
    row: 19,
    analysis: 'ttest',
    table: summary(),
    params: { design: 'paired' },
    path: 'design',
    option: 'paired',
    expect: 'greyed',
    reason: /raw values/,
    refused: true,
  },
  {
    row: 19,
    analysis: 'oneWayAnova',
    table: summary(),
    params: { gaussian: false },
    path: 'gaussian',
    option: false,
    expect: 'greyed',
    reason: /raw values/,
    refused: true,
  },
  {
    row: 19,
    analysis: 'oneWayAnova',
    table: summary(),
    params: { matched: true },
    path: 'matched',
    option: true,
    expect: 'greyed',
    reason: /raw values/,
    refused: true,
  },
  {
    row: 19,
    analysis: 'mannWhitney',
    table: summary(),
    params: {},
    path: '',
    expect: 'block',
    reason: /raw values/,
    refused: true,
  },
  {
    row: 20,
    analysis: 'ttest',
    table: column([1, 2, 3], [2, -1, 4]),
    params: { design: 'paired', paired: { measure: 'ratio' } },
    path: '',
    expect: 'block',
    reason: /all values to be positive/,
    refused: true,
  },
  {
    row: 21,
    analysis: 'nonlinearFit',
    table: table('xy', [[[1, 2, 4, 8]]], { x: [1, 2, 3, 4] }),
    params: { fitMethod: 'robust' },
    path: 'compareWith',
    expect: 'greyed',
    reason: /best-fit values only/,
  },
  // Roadmap 51e: the F test between models that aren't nested (and the comparison's question
  // shown only when a comparison is asked for).
  {
    row: 22,
    analysis: 'nonlinearFit',
    table: table('xy', [[[1, 2, 4, 8, 4, 2]]], { x: [1, 2, 3, 4, 5, 6] }),
    params: { equation: 'gaussian', compareWith: 'lorentzian' },
    path: 'compareBy',
    option: 'fTest',
    expect: 'greyed',
    reason: /These models aren’t nested; compare them by AICc\./,
  },
  {
    row: 22,
    analysis: 'nonlinearFit',
    table: table('xy', [[[1, 2, 4, 8]]], { x: [1, 2, 3, 4] }),
    params: {},
    path: 'compareBy',
    expect: 'hidden',
  },
  {
    row: 23,
    analysis: 'survival',
    table: table('survival', [[[1, 0, 1]], [[1, 1, 0]]], { x: [3, 5, 8] }),
    params: {},
    path: 'trend',
    expect: 'hidden',
  },
  {
    row: 23,
    analysis: 'survival',
    table: table('survival', [[[1, 0, 1]], [[1, 1, 0]], [[0, 1, 1]]], { x: [3, 5, 8] }),
    params: {},
    path: 'trend',
    expect: 'shown',
  },
  {
    row: 24,
    analysis: 'survival',
    table: table('survival', [[[1, 0, 1]], [[1, 1, 0]]], { x: [3, 5, 8] }),
    params: {},
    path: 'pairwise',
    expect: 'hidden',
  },
  {
    row: 25,
    analysis: 'multipleT',
    table: grouped(2),
    params: { distribution: 'nonparametric' },
    path: 'rankTest',
    expect: 'tier',
  },
  {
    row: 26,
    analysis: 'multipleOneWay',
    table: table(
      'grouped',
      [
        [[10], [2], [5]],
        [[12], [3], [5]],
        [[14], [2], [6]],
      ],
      { yFormat: { type: 'summary', preset: 'meanSdN' } },
    ),
    params: { gaussian: false },
    path: 'gaussian',
    option: false,
    expect: 'greyed',
    reason: /raw values/,
    refused: true,
  },
  {
    row: 27,
    analysis: 'ttest',
    table: column([1, 2, 3], [2, 3, 5]),
    params: { tails: 'one' },
    path: '',
    expect: 'block',
    reason: /Say which direction you predicted/,
    refused: true,
  },
  {
    row: 28,
    analysis: 'roc',
    table: column([1, 2, 3], [2, 3, 5]),
    params: { direction: 'unset' },
    path: '',
    expect: 'block',
    reason: /higher or lower values/,
    refused: true,
  },
]

const ctx = (t: DataTable) => ({ tableKind: t.tableKind, xTitle: t.x?.title ?? null })

describe('invalid combinations (design §4.4)', () => {
  it('every row of the table has a case (row 9 was fixed in 51c)', () => {
    const rows = new Set(CASES.map((c) => c.row))
    for (const r of INVALID_COMBINATIONS) expect(rows.has(r.row), `row ${r.row}`).toBe(true)
    expect(INVALID_COMBINATIONS.map((r) => r.row)).not.toContain(9)
    // Roadmap 51e: row 22 with the models' nesting (`explain/equations.ts`).
    expect(INVALID_COMBINATIONS.map((r) => r.row)).toContain(22)
  })

  it.each(
    CASES.map(
      (c, i) => [`${c.row} ${c.analysis} ${c.path} ${String(c.option ?? '')} #${i}`, c] as const,
    ),
  )('row %s', (_name, c) => {
    const def = registry.get(c.analysis)!
    const input = normalizeTable(c.table).slice(0, def.inputs.max)
    const params = def.params.parse(c.params) as Params
    const facts = analysisFacts(c.table.tableKind, input, params)
    const states = fieldStates(def.form, params, facts).filter(
      (s) => s.field.path.join('.') === c.path,
    )
    const shown = states.filter((s) => s.shown)
    switch (c.expect) {
      case 'hidden':
        expect(states.length).toBeGreaterThan(0)
        expect(shown).toEqual([])
        break
      case 'shown':
        expect(shown.length).toBeGreaterThan(0)
        break
      case 'label':
        expect(shown.map((s) => s.field.label).join(' ')).toMatch(c.reason!)
        break
      case 'tier':
        expect(shown[0]?.tier).toBe('advanced')
        break
      case 'greyed': {
        expect(shown.length, 'shown').toBeGreaterThan(0)
        const reasons =
          c.option === undefined
            ? shown.map((s) => s.unavailable)
            : shown.map((s) => s.options.get(String(c.option)))
        expect(reasons.join(' ')).toMatch(c.reason!)
        if (c.option !== undefined) {
          // Chosen anyway (a stored value): Analyze waits until it is changed.
          const checks = analysisChecks({
            def,
            kind: c.table.tableKind,
            input,
            params,
            facts,
            context: ctx(c.table),
          })
          expect(checks[0]).toMatchObject({ level: 'block', where: 'params' })
        }
        break
      }
      case 'block': {
        const checks = analysisChecks({
          def,
          kind: c.table.tableKind,
          input,
          params,
          facts,
          context: ctx(c.table),
        })
        expect(checks[0]?.level).toBe('block')
        expect(checks[0]?.message).toMatch(c.reason!)
        break
      }
    }
    if (c.refused) {
      const r = def.run(input, params, ctx(c.table))
      expect(r.status, 'run refuses it').toBe('error')
    }
  })

  it('never suggests changing an assumption to unlock a feature', () => {
    for (const d of registry.list())
      for (const f of d.form) {
        const reasons = [
          ...(f.unavailable ?? []).map((u) => u.reason),
          ...('options' in f
            ? f.options.flatMap((o) => (o.unavailable ?? []).map((u) => u.reason))
            : []),
        ]
        for (const r of reasons)
          expect(r, `${d.id}.${f.path.join('.')}`).not.toMatch(/\b(assume|choose “?yes)/i)
      }
    expect(NEEDS_RAW).toBe('Needs the raw values, not mean/SD/N.')
  })
})
