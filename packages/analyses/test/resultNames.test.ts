import {
  type AnalysisDef,
  type AnalysisNode,
  type MethodNames,
  normalizeTable,
  type ResultRef,
  resolveResultRef,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { methodNameOf, methodsParagraph, registry } from '../src/index.ts'
import { columnTable, groupedTable, runDef } from './helpers.ts'

// Roadmap 51d (design §8.2, §8.6, §8.1): the user's names in labels and references that keep
// working (keys first, then labels, then the labels of before 0.3.11); names that follow the
// method; the methods paragraph.

const GP = { pValueStyle: 'GP', pValueDigits: 4 } as const
const def = (id: string) => registry.get(id) as AnalysisDef<unknown>
const names = { dataSets: ['Control', 'Treated'], table: 'Enzyme activity' }

describe('names that follow the method (U23)', () => {
  const name = (id: string, params: Record<string, unknown>, n: MethodNames = names) =>
    methodNameOf(def(id), def(id).params.parse(params), n)
  it('says the method and the groups', () => {
    expect(name('ttest', {})).toBe('Welch’s t test: Treated vs Control (Enzyme activity)')
    expect(name('ttest', { unpaired: { assumeEqualSD: true } })).toBe(
      'Student’s t test: Treated vs Control (Enzyme activity)',
    )
    expect(name('ttest', { design: 'paired' })).toBe(
      'Paired t test: Treated vs Control (Enzyme activity)',
    )
    expect(name('mannWhitney', {})).toBe('Mann-Whitney test: Treated vs Control (Enzyme activity)')
    expect(name('oneWayAnova', {})).toBe('One-way ANOVA + Tukey: Enzyme activity')
    expect(name('oneWayAnova', { comparisons: 'vsControl' })).toBe(
      'One-way ANOVA + Dunnett: Enzyme activity',
    )
    expect(name('oneWayAnova', { gaussian: false })).toBe('Kruskal-Wallis + Dunn: Enzyme activity')
    expect(name('oneWayAnova', { equalSD: 'welch' })).toBe(
      'Welch ANOVA + Dunnett’s T3: Enzyme activity',
    )
    expect(name('oneWayAnova', { comparisons: 'none', matched: true })).toBe(
      'RM one-way ANOVA: Enzyme activity',
    )
    expect(
      name(
        'twoWayAnova',
        { repeated: 'rows' },
        {
          ...names,
          factors: { rows: 'Time', columns: 'Genotype' },
        },
      ),
    ).toBe('Two-way RM ANOVA: Genotype × Time')
    // Analyses without their own words keep the former name.
    expect(name('transform', {})).toBe('Transform of Enzyme activity')
  })
})

describe('references keep working (§8.2)', () => {
  const t = columnTable([
    [41, 44, 39, 46, 42],
    [55, 52, 58, 49, 61],
  ])
  t.dataSets[0]!.title = 'Control'
  t.dataSets[1]!.title = 'Treated'
  const r = runDef(def('ttest'), t)
  const read = (ref: Omit<Extract<ResultRef, { from: 'cell' }>, 'from'>) =>
    resolveResultRef(r, { from: 'cell', ...ref }, GP)
  it('labels are the data sets’ names; keys and labels of before 0.3.11 find them', () => {
    const now = read({ sheet: 'results', row: 'Mean of Control' })
    expect(now?.kind).toBe('number')
    expect(read({ sheet: 'results', row: 'anything', rowKey: 'meanA' })).toEqual(now)
    // A label placed on a graph before 0.3.11 reads the same number.
    expect(read({ sheet: 'results', row: 'Mean of column A' })).toEqual(now)
    expect(
      read({
        sheet: 'results',
        block: 'How big is the difference?',
        row: 'Difference between means (B − A)',
      }),
    ).toEqual(read({ sheet: 'results', row: 'Difference between means (Treated − Control)' }))
    expect(read({ sheet: 'results', row: 'Sample size, column B' })).toEqual({
      kind: 'integer',
      v: 5,
    })
    // Renaming the groups keeps keyed references.
    const renamed = columnTable([
      [41, 44, 39, 46, 42],
      [55, 52, 58, 49, 61],
    ])
    const r2 = runDef(def('ttest'), renamed)
    expect(
      resolveResultRef(
        r2,
        { from: 'cell', sheet: 'results', row: 'Mean of Control', rowKey: 'meanA' },
        GP,
      ),
    ).toEqual(now)
  })

  it('two-way ANOVA: factor names in the tables, rows keyed, old labels read', () => {
    const g = groupedTable(
      [
        [
          [1, 2, 3],
          [5, 6, 7],
        ],
        [
          [2, 3, 4],
          [8, 9, 9],
        ],
      ],
      ['WT', 'KO'],
    )
    const res = def('twoWayAnova').run(normalizeTable(g), def('twoWayAnova').params.parse({}), {
      tableKind: 'grouped',
      xTitle: null,
      factorNames: { rows: 'Genotype', columns: 'Treatment' },
    })
    const b = res.sheets.find((s) => s.key === 'results')!.blocks[0]!
    if (b.type !== 'table') throw new Error('table')
    expect(b.rows.map((x) => (x[0] as { v: string }).v)).toEqual([
      'Interaction',
      'Genotype',
      'Treatment',
    ])
    expect(b.rowKeys).toEqual(['interaction', 'row', 'column'])
    const p = resolveResultRef(
      res,
      {
        from: 'cell',
        sheet: 'results',
        block: 'Two-way ANOVA',
        row: 'Row factor',
        column: 'P value',
      },
      GP,
    )
    expect(p).toEqual(res.values['p.row'])
  })
})

describe('the methods paragraph (§8.1, §7.2)', () => {
  const node = (over: Partial<AnalysisNode> = {}): AnalysisNode => ({
    kind: 'analysis',
    id: 'a1' as AnalysisNode['id'],
    name: 'x',
    analysisId: 'ttest',
    pluginVersion: def('ttest').version,
    input: { source: 't1' as AnalysisNode['id'], dataSets: ['c1', 'c2'] },
    params: def('ttest').params.parse({}),
    ...over,
  })
  const text = (n: AnalysisNode) =>
    methodsParagraph({
      node: n,
      def: def(n.analysisId),
      names,
      defOf: (id) => registry.get(id),
      titleOf: (k) => ({ c1: 'Control', c2: 'Treated', c3: 'Mouse 3' })[k],
      appVersion: '0.3.11',
    })
  it('says the method, its options and the software', () => {
    expect(text(node())).toBe(
      'Control and Treated were compared by Welch’s t test (two-tailed). Confidence intervals are 95%. Analyzed with statPlotter 0.3.11.',
    )
  })
  it('names the method used before when it changed after results were seen', () => {
    const n = node({
      history: [
        {
          at: '2026-10-12T10:00:00.000Z',
          from: {
            analysisId: 'ttest',
            pluginVersion: 2,
            params: def('ttest').params.parse({ unpaired: { assumeEqualSD: true } }),
            dataSets: ['c1', 'c2'],
          },
          changes: ['Can the groups vary by different amounts?: No → Yes'],
          afterResults: true,
          reason: 'unequal group sizes',
        },
      ],
    })
    expect(text(n)).toContain(
      'The analysis was first run as Student’s t test and changed after its results were seen (Can the groups vary by different amounts?: No → Yes), 12 Oct 2026; reason: “unequal group sizes”.',
    )
  })
  it('says a bracket’s test is not corrected for other comparisons', () => {
    expect(text(node({ origin: { bracket: true } }))).toContain(
      'not corrected for other comparisons',
    )
  })
})
