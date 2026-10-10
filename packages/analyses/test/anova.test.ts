import { type AnalysisResult, createTable, type DataTable } from '@ps/model'
import {
  friedmanTest,
  kruskalWallis,
  oneWayAnova,
  oneWayRM,
  tTestUnpaired,
  welchAnova,
} from '@ps/stats'
import { describe, expect, it } from 'vitest'
import { oneWayAnovaDef, twoWayAnovaDef } from '../src/index.ts'
import {
  columnTable,
  groupedTable,
  kvOf,
  rowOf,
  runDef,
  summaryTable,
  tableBlock,
  v,
} from './helpers.ts'

const A = [4.2, 5.1, 3.9, 4.8, 5.5, 4.4]
const B = [6.1, 5.8, 7.2, 6.6, 5.9, 6.4]
const C = [5.0, 4.6, 5.9, 5.3, 4.9, 5.6]

describe('one-way ANOVA plugin', () => {
  const run = (t: DataTable, p: object = {}) => runDef(oneWayAnovaDef, t, p)

  it('reports the ANOVA and Tukey comparisons of all pairs, with bracket-ready comparisons', () => {
    const t = columnTable([A, B, C])
    const r = run(t)
    const ref = oneWayAnova([{ values: A }, { values: B }, { values: C }])
    expect((kvOf(r, 'P value', 'Ordinary one-way ANOVA') as { v: number }).v).toBe(ref.p)
    expect(tableBlock(r, 'comparisons').title).toMatch(/Tukey/)
    expect(r.comparisons.map((c) => c.key)).toEqual([
      `${t.dataSets[0]!.id}|${t.dataSets[1]!.id}`,
      `${t.dataSets[0]!.id}|${t.dataSets[2]!.id}`,
      `${t.dataSets[1]!.id}|${t.dataSets[2]!.id}`,
    ])
  })

  it('with two groups, F equals t² of the pooled t test', () => {
    const r = run(columnTable([A, B]), { comparisons: 'none' })
    const F = (kvOf(r, 'F', 'Ordinary one-way ANOVA') as { v: number }).v
    expect(F).toBeCloseTo(tTestUnpaired(A, B).t ** 2, 9)
    expect(r.sheets.map((s) => s.key)).toEqual(['results'])
  })

  it('compares each group with the chosen control (Dunnett)', () => {
    const t = columnTable([A, B, C])
    const r = run(t, { comparisons: 'vsControl', control: t.dataSets[1]!.id })
    expect(tableBlock(r, 'comparisons').title).toMatch(/Dunnett/)
    expect(r.comparisons.every((c) => c.a.key === t.dataSets[1]!.id)).toBe(true)
    expect(r.comparisons).toHaveLength(2)
  })

  it('Welch ANOVA uses unequal-variance comparisons', () => {
    const r = run(columnTable([A, B, C]), { equalSD: 'welch' })
    const ref = welchAnova([{ values: A }, { values: B }, { values: C }])
    expect(v(kvOf(r, 'P value', 'Welch ANOVA test'))).toBe(ref.p)
    expect(tableBlock(r, 'comparisons').title).toMatch(/T3/)
  })

  it('Kruskal-Wallis with Dunn’s test; refuses summary data', () => {
    const r = run(columnTable([A, B, C]), { gaussian: false })
    expect(v(kvOf(r, 'P value', 'Kruskal-Wallis test'))).toBe(kruskalWallis([A, B, C]).p)
    expect(tableBlock(r, 'comparisons').title).toMatch(/Dunn/)
    expect(
      run(
        summaryTable('meanSdN', [
          [1, 1, 5],
          [2, 1, 5],
        ]),
        { gaussian: false },
      ).status,
    ).toBe('error')
  })

  it('summary data (mean, SD, N) gives the same ANOVA as raw data', () => {
    const stats = [A, B, C].map((x) => {
      const m = x.reduce((s, v) => s + v, 0) / x.length
      const sd = Math.sqrt(x.reduce((s, v) => s + (v - m) ** 2, 0) / (x.length - 1))
      return [m, sd, x.length] as [number, number, number]
    })
    const raw = run(columnTable([A, B, C]))
    const sum = run(summaryTable('meanSdN', stats))
    const p = (r: AnalysisResult) =>
      (kvOf(r, 'P value', 'Ordinary one-way ANOVA') as { v: number }).v
    expect(p(sum)).toBeCloseTo(p(raw), 10)
  })

  it('no variation within the groups: a warning (audit 3, S2)', () => {
    const r = run(
      columnTable([
        [1, 1, 1],
        [2, 2, 2],
        [0.3, 0.3, 0.3],
      ]),
      { comparisons: 'none' },
    )
    expect(r.status).toBe('warning')
    expect(r.diagnostics.map((d) => d.message).join(' ')).toMatch(/no variation within/)
    expect(run(columnTable([A, B, C])).diagnostics).toEqual([])
  })

  it('values too small or large to square: a warning (audit 3, S4)', () => {
    for (const k of [1e-200, 1e200]) {
      const r = run(columnTable([A, B, C].map((x) => x.map((y) => y * k))), { comparisons: 'none' })
      expect(r.status).toBe('warning')
      expect(r.diagnostics.map((d) => d.message).join(' ')).toMatch(/too (small|large) to square/)
    }
    const two = runDef(
      twoWayAnovaDef,
      groupedTable([
        [
          [1e-200, 2e-200],
          [3e-200, 5e-200],
        ],
        [
          [2e-200, 2.5e-200],
          [1e-200, 4e-200],
        ],
      ]),
      { comparisons: 'none' },
    )
    expect(two.diagnostics.map((d) => d.message).join(' ')).toMatch(/too small to square/)
  })
})

describe('two-way ANOVA plugin', () => {
  const cells = [
    [
      [40, 42, 44],
      [46, 47, 49],
    ],
    [
      [43, 44, 46],
      [66, 68, 71],
    ],
    [
      [42, 43, 45],
      [54, 55, 57],
    ],
  ]
  const run = (t: DataTable, p: object = {}) => runDef(twoWayAnovaDef, t, p)

  it('reports interaction, row, and column effects', () => {
    const r = run(groupedTable(cells))
    expect(r.status).not.toBe('error')
    const sources = r.sheets[0]!.blocks[0]!
    if (sources.type !== 'table') throw new Error('table expected')
    expect(sources.rows.map((row) => (row[0] as { v: string }).v)).toEqual(
      expect.arrayContaining(['Interaction', 'Row factor', 'Column factor']),
    )
  })

  it('within-row comparisons carry the row, for grouped-graph brackets', () => {
    const t = groupedTable(cells)
    const r = run(t)
    expect(r.comparisons).toHaveLength(3) // one pair (2 columns) in each of 3 rows
    expect(r.comparisons.map((c) => c.rowA)).toEqual([0, 1, 2])
    expect(r.comparisons.every((c) => c.rowA === c.rowB && c.a.key === t.dataSets[0]!.id)).toBe(
      true,
    )
  })

  it('within-column comparisons compare rows of one data set', () => {
    const r = run(groupedTable(cells), { comparisons: 'withinColumns' })
    expect(r.comparisons).toHaveLength(6) // 3 row pairs × 2 columns
    expect(r.comparisons.every((c) => c.a.key === c.b.key && c.rowA !== c.rowB)).toBe(true)
  })

  it('all-cells comparisons: one family over every cell, keyed by both cells', () => {
    const t = groupedTable(cells)
    const r = run(t, { comparisons: 'allCells', allPairsMethod: 'tukey' })
    expect(r.comparisons).toHaveLength(15) // 6 cells
    const [c0, c1] = t.dataSets.map((d) => d.id)
    expect(r.comparisons[0]).toMatchObject({ rowA: 0, rowB: 0, key: `cell0:${c0}|0:${c1}` })
    expect(r.comparisons[1]).toMatchObject({ rowA: 0, rowB: 1, key: `cell0:${c0}|1:${c0}` })
    // Šídák corrects over all 15; vs control compares each cell with the first.
    const sidak = run(t, { comparisons: 'allCells', allPairsMethod: 'sidak' })
    const raw = run(t, { comparisons: 'allCells', allPairsMethod: 'fisher' })
    sidak.comparisons.forEach((c, i) => {
      expect(c.p).toBeCloseTo(1 - (1 - raw.comparisons[i]!.p) ** 15, 12)
    })
    const ctrl = run(t, { comparisons: 'allCells', kind: 'vsControl' })
    expect(ctrl.comparisons).toHaveLength(5)
    expect(ctrl.comparisons.every((c) => c.rowA === 0 && c.a.key === c0)).toBe(true)
    // Repeated measures: not offered.
    expect(run(t, { comparisons: 'allCells', repeated: 'rows' }).status).toBe('error')
  })

  it('main-effect comparisons have no rows', () => {
    const r = run(groupedTable(cells), { comparisons: 'mainColumns' })
    expect(r.comparisons).toHaveLength(1)
    expect(r.comparisons[0]!.rowA).toBeUndefined()
  })

  it('a blank row title is labelled “Row n” in comparisons', () => {
    const labels = (r: AnalysisResult) =>
      tableBlock(r, 'comparisons').rows.map((row) => (row[0] as { v: string }).v)
    const t = groupedTable(cells)
    t.rowTitles = ['Low', '', 'High']
    expect(labels(run(t))).toEqual([
      'Low: Group A vs. Group B',
      'Row 2: Group A vs. Group B',
      'High: Group A vs. Group B',
    ])
    const rm = run(t, { repeated: 'rows', comparisons: 'withinRows' })
    expect(labels(rm)).toContain('Row 2: Group A vs. Group B')
  })

  it('summary data: a cell with N = 1 and no SD counts as one value (it adds no residual df)', () => {
    // The summary cells of `cells`, with row 2 / Group B cut to its first value.
    const raw = cells.map((row, r) => row.map((c, j) => (r === 1 && j === 1 ? [c[0]!] : c)))
    const t = createTable({
      tableKind: 'grouped',
      yFormat: { type: 'summary', preset: 'meanSdN' },
      columns: 2,
      rows: 3,
    })
    raw.forEach((row, r) => {
      row.forEach((vals, j) => {
        const n = vals.length
        const m = vals.reduce((s, x) => s + x, 0) / n
        const sd = n > 1 ? Math.sqrt(vals.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1)) : null
        const [mean, sdCol, nCol] = t.dataSets[j]!.subcolumns
        mean!.values[r] = m
        sdCol!.values[r] = sd
        nCol!.values[r] = n
      })
    })
    const fromSummary = run(t)
    expect(fromSummary.status).not.toBe('error')
    const fromRaw = run(groupedTable(raw))
    // The ANOVA table: SS, DF and P value of each source.
    const anovaTable = (r: AnalysisResult) => {
      const b = r.sheets.find((s) => s.key === 'results')!.blocks[1]!
      if (b.type !== 'table' || b.title !== 'ANOVA table') throw new Error('ANOVA table expected')
      return b.rows.map((row) => [v(row[1]), v(row[2]), v(row[5])])
    }
    const want = anovaTable(fromRaw)
    const got = anovaTable(fromSummary)
    expect(got).toHaveLength(want.length)
    got.forEach((row, i) => {
      row.forEach((x, j) => {
        if (typeof x === 'number') expect(x).toBeCloseTo(want[i]![j]!, 9)
        else expect(x).toBe(want[i]![j]) // the residual has no P value
      })
    })
  })

  it('one value per cell requires the main-effects model', () => {
    const single = cells.map((row) => row.map((c) => [c[0]!]))
    expect(run(groupedTable(single)).status).toBe('error')
    expect(run(groupedTable(single), { interaction: false }).status).not.toBe('error')
  })

  it('no variation within cells: no F for an effect zero within rounding, a warning (audit 3, S2)', () => {
    // Additive cell means, every value of a cell equal.
    const flat = [0, 1, 2].map((r) => [0, 1].map((c) => [0, 1, 2].map(() => 0.1 * r + 0.7 * c)))
    const r = run(groupedTable(flat), { comparisons: 'none' })
    expect(r.status).toBe('warning')
    expect(r.diagnostics.map((d) => d.message).join(' ')).toMatch(/no variation within/)
    const inter = rowOf(r, 'Interaction', 'Two-way ANOVA')
    expect(Number.isNaN(v(inter[1]))).toBe(true)
    expect(v(rowOf(r, 'Column factor', 'Two-way ANOVA')[1])).toBe(0)
  })
})

describe('repeated measures', () => {
  // Subjects in rows, treatments in columns.
  const S = [
    [10, 14, 13],
    [12, 15, 17],
    [9, 13, 12],
    [14, 18, 19],
    [11, 12, 16],
  ]
  const cols = [0, 1, 2].map((j) => S.map((r) => r[j]!))
  const run = (t: DataTable, p: object = {}) => runDef(oneWayAnovaDef, t, { matched: true, ...p })

  it('complete data: RM ANOVA with Geisser-Greenhouse, matching, and comparisons', () => {
    const r = run(columnTable(cols))
    const ref = oneWayRM(S, { sphericity: 'gg' })
    expect(ref.kind).toBe('anova')
    expect(v(r.values.p)).toBe(ref.corrected!.p)
    expect(() => kvOf(r, 'P value', 'Was the matching effective?')).not.toThrow()
    expect(r.comparisons).toHaveLength(3)
    const assumed = run(columnTable(cols), { sphericity: 'assumed' })
    expect(v(assumed.values.p)).toBe(oneWayRM(S, { sphericity: 'assumed' }).treatment.p)
  })

  it('a missing value switches to the mixed-effects model', () => {
    const t = columnTable(cols)
    t.dataSets[1]!.subcolumns[0]!.values[2] = null
    const r = run(t)
    expect(r.diagnostics.some((d) => /mixed-effects/.test(d.message))).toBe(true)
    const rows = S.map((row, i) => row.map((y, j) => (i === 2 && j === 1 ? Number.NaN : y)))
    const ref = oneWayRM(rows, { sphericity: oneWayAnovaDef.params.parse({}).sphericity })
    expect(ref.kind).toBe('mixed')
    expect(v(kvOf(r, 'P value', 'Mixed-effects model (REML) — fixed effect (type III)'))).toBe(
      ref.treatment.p,
    )
  })

  it('matched and nonparametric is the Friedman test', () => {
    const r = run(columnTable(cols), { gaussian: false })
    const ref = friedmanTest(S)
    expect(v(kvOf(r, 'P value', 'Friedman test'))).toBe(ref.pExact ?? ref.p)
  })

  it('two-way with repeated rows: subjects are the replicate subcolumns', () => {
    const t = groupedTable([
      [
        [10, 12, 11],
        [14, 15, 13],
      ],
      [
        [13, 15, 14],
        [19, 22, 20],
      ],
      [
        [12, 13, 13],
        [16, 18, 17],
      ],
    ])
    const r = runDef(twoWayAnovaDef, t, { repeated: 'rows', comparisons: 'withinRows' })
    expect(r.status).not.toBe('error')
    const sources = r.sheets[0]!.blocks[0]!
    if (sources.type !== 'table') throw new Error('table expected')
    expect(sources.rows.map((row) => (row[0] as { v: string }).v)).toContain('Subjects (matching)')
    expect(r.comparisons.map((c) => c.rowA)).toEqual([0, 1, 2])
    // Main-effect comparisons of the repeated factor need sphericity (Prism 8.4+).
    const main = runDef(twoWayAnovaDef, t, { repeated: 'rows', comparisons: 'mainRows' })
    expect(main.sheets.map((s) => s.key)).toEqual(['results'])
  })
})
