import {
  type AnalysisDef,
  type AnalysisResult,
  createTable,
  type DataTable,
  normalizeTable,
  type ResultBlock,
  type RunContext,
  resultSummary,
  summaryText,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { registry } from '../src/index.ts'
import { familyCaption } from '../src/summary/index.ts'
import {
  columnTable,
  countsTable,
  groupedTable,
  runDef,
  summaryTable,
  xyReplicatesTable,
  xyTable,
} from './helpers.ts'

// Roadmap 51d (design §8.2, U18): every family's summary sentence on fixtures covering both P
// branches, both directions, a one-tailed P with and against its prediction, missing values and
// long group lists — written from the result's own values in the data sets' names.

const GP = { pValueStyle: 'GP', pValueDigits: 4 } as const

const def = (id: string) => registry.get(id) as AnalysisDef<unknown>

/** Titles the data sets of a table. */
function titled(t: DataTable, titles: readonly string[]): DataTable {
  titles.forEach((x, i) => {
    if (t.dataSets[i]) t.dataSets[i]!.title = x
  })
  return t
}

/** The summary of an analysis run as the engine runs it (with the table's context). */
function sentence(
  id: string,
  t: DataTable,
  params: Record<string, unknown> = {},
  ctx: Partial<RunContext> = {},
): string {
  const d = def(id)
  const parsed = d.params.parse(controlled(t, params)) as Record<string, unknown>
  const r = d.run(normalizeTable(t), parsed, {
    tableKind: t.tableKind,
    xTitle: t.x?.title ?? null,
    ...ctx,
  })
  return textOf(r)
}

/** `control: n` → the n-th data set's key. */
function controlled(t: DataTable, params: Record<string, unknown>): Record<string, unknown> {
  return typeof params.control === 'number'
    ? { ...params, control: t.dataSets[params.control]!.id }
    : params
}

function textOf(r: AnalysisResult): string {
  const s = resultSummary(r.sheets)
  if (!s) return `(no summary: ${r.diagnostics.map((d) => d.message).join(' ')})`
  return summaryText(s, GP)
}

const control = [41.3, 44.2, 39.8, 46.1, 42.7, 40.9, 45.5, 43.0, 38.6, 42.2]
const treated = [55.1, 52.3, 58.7, 49.9, 61.2, 54.4, 57.8, 53.0, 50.6, 59.4]
const similar = [42.0, 45.1, 40.2, 44.9, 43.3, 41.8, 46.0, 42.5, 39.9, 43.7]

const twoGroups = (b: number[], a = control, titles = ['Control', 'Treated']) =>
  titled(columnTable([a, b]), titles)

describe('summary sentences (design §8.2)', () => {
  it('t tests: Welch, Student, non-significant, paired, ratio, summary data, missing values', () => {
    const out = {
      welch: sentence('ttest', twoGroups(treated)),
      lower: sentence('ttest', titled(columnTable([treated, control]), ['Before', 'After'])),
      student: sentence('ttest', twoGroups(treated), { unpaired: { assumeEqualSD: true } }),
      notSignificant: sentence('ttest', twoGroups(similar)),
      paired: sentence('ttest', titled(columnTable([control, similar]), ['Before', 'After']), {
        design: 'paired',
      }),
      ratio: sentence('ttest', titled(columnTable([control, treated]), ['Before', 'After']), {
        design: 'paired',
        paired: { measure: 'ratio' },
      }),
      summaryData: sentence(
        'ttest',
        titled(
          summaryTable('meanSdN', [
            [42.4, 2.4, 10],
            [55.2, 3.6, 12],
          ]),
          ['Control', 'Treated'],
        ),
      ),
      missing: sentence(
        'ttest',
        twoGroups(
          [...treated.slice(0, 7), Number.NaN, 50.6, 59.4].map((x) =>
            Number.isNaN(x) ? null : x,
          ) as number[],
        ),
      ),
      oneTailedAsPredicted: sentence('ttest', twoGroups(treated), {
        tails: 'one',
        predicted: 'increase',
      }),
      oneTailedAgainst: sentence('ttest', twoGroups(treated), {
        tails: 'one',
        predicted: 'decrease',
      }),
    }
    expect(out).toMatchSnapshot()
    expect(out.welch).toMatch(
      /^Treated is higher than Control by 12\.8 \(95% CI 9\.73 to 15\.9\); P < 0\.0001, Welch’s t test\. n = 10 each\.$/,
    )
    expect(out.lower).toMatch(/^After is lower than Before by 12\.8 /)
    expect(out.notSignificant).toMatch(/no evidence of a difference \(P = 0\.\d+, Welch’s t test\)/)
    expect(out.notSignificant).not.toMatch(/no difference/)
    expect(out.missing).toMatch(/n = 10 and 9\.$/)
    expect(out.oneTailedAgainst).toMatch(
      /the opposite way to the prediction \(predicted: Treated lower than Control\); one-tailed P > 0\.9999, Welch’s t test\./,
    )
    expect(out.oneTailedAsPredicted).toMatch(
      /one-tailed \(predicted: Treated higher than Control\)/,
    )
  })

  it('rank tests: Mann-Whitney, Wilcoxon, Kolmogorov-Smirnov; one sample', () => {
    const out = {
      mannWhitney: sentence('mannWhitney', twoGroups(treated)),
      mannWhitneyNs: sentence('mannWhitney', twoGroups(similar)),
      wilcoxon: sentence('wilcoxon', titled(columnTable([control, treated]), ['Before', 'After'])),
      ks: sentence('kolmogorovSmirnov', twoGroups(treated)),
      oneSample: sentence('oneSample', twoGroups(treated), { hypothetical: 45 }),
      oneSampleWilcoxon: sentence('oneSample', twoGroups(treated), {
        hypothetical: 45,
        test: 'wilcoxon',
      }),
    }
    expect(out).toMatchSnapshot()
    expect(out.mannWhitney).toMatch(/^Values in Treated tend to be higher than in Control/)
    expect(out.mannWhitneyNs).toMatch(
      /^No evidence that values in Treated and Control tend to differ/,
    )
  })

  const doses = () =>
    titled(
      columnTable([
        [18.1, 22.4, 15.9, 20.3, 17.5, 19.8, 14.6, 18.3],
        [24.0, 26.1, 22.3, 23.8, 25.9, 21.7, 24.4, 24.9],
        [30.2, 33.5, 27.8, 31.1, 29.4, 34.0, 26.9, 29.9],
      ]),
      ['Vehicle', '1 mg/kg', '10 mg/kg'],
    )

  it('one-way ANOVA: Dunnett, Tukey, saved signs, none, Kruskal-Wallis, RM, Welch, long lists', () => {
    const many = titled(
      columnTable(
        Array.from({ length: 7 }, (_, g) =>
          Array.from({ length: 6 }, (_, i) => 10 + 3 * g + ((i * 7) % 5)),
        ),
      ),
      ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
    )
    const out = {
      dunnett: sentence('oneWayAnova', doses(), { comparisons: 'vsControl', control: 0 }),
      dunnettSaved: sentence('oneWayAnova', doses(), {
        comparisons: 'vsControl',
        control: 0,
        differenceAs: 'earlierMinusLater',
      }),
      tukey: sentence('oneWayAnova', doses()),
      none: sentence('oneWayAnova', doses(), { comparisons: 'none' }),
      kruskalWallis: sentence('oneWayAnova', doses(), { gaussian: false }),
      repeated: sentence('oneWayAnova', doses(), { matched: true, comparisons: 'none' }),
      welch: sentence('oneWayAnova', doses(), { equalSD: 'welch' }),
      friedman: sentence('friedman', doses()),
      longList: sentence('oneWayAnova', many),
      noneDiffer: sentence(
        'oneWayAnova',
        titled(columnTable([control, similar, [...control].reverse()]), ['A', 'B', 'C']),
      ),
    }
    expect(out).toMatchSnapshot()
    expect(out.dunnett).toMatch(
      /^Compared with Vehicle, 1 mg\/kg is higher by .*; and 10 mg\/kg is higher by .*Dunnett’s test for 2 comparisons\. Overall: the means differ across the 3 groups \(ordinary one-way ANOVA, P < 0\.0001\)\.$/,
    )
    // Saved analyses (earlier − later) read the same way: each group against the control.
    expect(out.dunnettSaved).toBe(out.dunnett)
    expect(out.longList).toMatch(/more in the table/)
    expect(out.noneDiffer).toMatch(/No evidence of a difference in the 3 comparisons/)
  })

  it('two-way ANOVA with and without an interaction, factor names', () => {
    const cells = (shift: number) => [
      [
        [10, 11, 12],
        [12, 13, 14],
      ],
      [
        [11, 12, 13],
        [13 + shift, 14 + shift, 15 + shift],
      ],
      [
        [12, 13, 14],
        [14 + 2 * shift, 15 + 2 * shift, 16 + 2 * shift],
      ],
    ]
    const t = (shift: number) =>
      titled(groupedTable(cells(shift), ['Day 1', 'Day 3', 'Day 7']), ['Vehicle', 'Drug'])
    const out = {
      interaction: sentence(
        'twoWayAnova',
        t(6),
        {},
        {
          factorNames: { rows: 'Time', columns: 'Treatment' },
        },
      ),
      additive: sentence('twoWayAnova', t(0)),
    }
    expect(out).toMatchSnapshot()
    expect(out.interaction).toMatch(/^The effect of Treatment depends on Time \(interaction P/)
    expect(out.additive).toMatch(/no evidence that one changes the effect of the other/)
  })

  it('many rows: multiple t tests, multiple one-way ANOVAs', () => {
    const t = titled(
      groupedTable(
        [
          [
            [1, 2, 3],
            [5, 6, 7],
          ],
          [
            [1, 2, 3],
            [1.5, 2.5, 3.5],
          ],
          [
            [4, 5, 6],
            [9, 10, 11],
          ],
        ],
        ['Gene 1', 'Gene 2', 'Gene 3'],
      ),
      ['WT', 'KO'],
    )
    const out = {
      multipleT: sentence('multipleT', t),
      multipleOneWay: sentence('multipleOneWay', t),
    }
    expect(out).toMatchSnapshot()
    expect(out.multipleT).toMatch(/comparing KO − WT/)
  })

  it('relationships: correlation (one pair, several), regression (one line, two)', () => {
    const x = [1, 2, 3, 4, 5, 6, 7, 8]
    const y1 = [2.1, 3.9, 6.2, 7.8, 10.1, 12.2, 13.8, 16.1]
    const y2 = [9.8, 8.1, 7.2, 5.9, 4.1, 3.2, 1.8, 0.4]
    const y3 = [5, 3, 6, 2, 7, 4, 5, 3]
    const xy = xyTable(x, [y1, y2], ['Signal', 'Background'])
    xy.x!.title = 'Dose'
    const out = {
      correlation: sentence('correlation', titled(columnTable([x, y1]), ['Age', 'Pressure'])),
      correlationNs: sentence('correlation', titled(columnTable([x, y3]), ['Age', 'Noise'])),
      correlationPairs: sentence(
        'correlation',
        titled(columnTable([x, y1, y2, y3]), ['Age', 'Pressure', 'Rate', 'Noise']),
      ),
      regression: sentence('linearRegression', xy),
    }
    expect(out).toMatchSnapshot()
    expect(out.correlation).toMatch(/^Age and Pressure rise together: r = /)
    expect(out.correlationNs).toMatch(/no evidence of a correlation/)
    expect(out.regression).toMatch(/^Signal rises by 2 per unit of Dose/)
  })

  it('curve fits: EC50 with its unit from the X title', () => {
    const x = [-9, -8.5, -8, -7.5, -7, -6.5, -6, -5.5, -5]
    const curve = (ec: number) => x.map((v, i) => 100 / (1 + 10 ** (ec - v)) + ((i % 3) - 1) * 1.5)
    const t = xyReplicatesTable(x, [[curve(-7.1)], [curve(-6.2)]], ['Agonist A', 'Agonist B'])
    t.x!.title = 'log[Agonist], M'
    const s = sentence('nonlinearFit', t, { model: 'logAgonistNormalized' })
    expect(s).toMatchSnapshot()
    expect(s).toMatch(
      /^EC50 = \d+(\.\d+)? nM \(log EC50 95% CI .*\) for Agonist A; .* nM .* for Agonist B; Hill slope /,
    )
  })

  it('survival: medians, not reached, the test, the hazard ratio', () => {
    const t = createTable({ tableKind: 'survival', columns: 2, rows: 16 })
    const times = [3, 5, 8, 9, 12, 14, 18, 20, 4, 15, 22, 30, 35, 40, 45, 50]
    const events = [1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0]
    times.forEach((x, r) => {
      t.x!.subcolumns[0]!.values[r] = x
      t.dataSets[r < 8 ? 0 : 1]!.subcolumns[0]!.values[r] = events[r]!
    })
    t.x!.title = 'Time (days)'
    titled(t, ['Placebo', 'Drug'])
    const s = sentence('survival', t)
    expect(s).toMatchSnapshot()
    expect(s).toMatch(
      /^Median survival 10\.5 days on Placebo and not reached on Drug; the curves differ/,
    )
  })

  it('contingency: a 2 × 2 with its roles, a larger table with a trend', () => {
    const two = titled(
      countsTable(
        'contingency',
        [
          [9, 91],
          [21, 79],
        ],
        ['Drug', 'Placebo'],
      ),
      ['Adverse event', 'No event'],
    )
    const three = titled(
      countsTable(
        'contingency',
        [
          [12, 38],
          [21, 29],
          [30, 20],
        ],
        ['10 mg', '20 mg', '40 mg'],
      ),
      ['Responder', 'Non-responder'],
    )
    const out = {
      twoByTwo: sentence('contingency', two),
      otherRow: sentence('contingency', two, { exposedRow: 1 }),
      trend: sentence('contingency', three, { trend: true }),
    }
    expect(out).toMatchSnapshot()
    expect(out.twoByTwo).toMatch(
      /^Adverse event: 9% in Drug, 21% in Placebo; relative risk 0\.429 \(95% CI/,
    )
    expect(out.otherRow).toMatch(/^Adverse event: 21% in Placebo, 9% in Drug; relative risk 2\.33/)
  })

  it('describe and check: normality, descriptive, ROC, Bland-Altman, outliers', () => {
    const t = twoGroups(treated)
    const out = {
      normality: sentence('normality', t),
      descriptive: sentence('descriptive', t),
      roc: sentence('roc', t, { direction: 'higher' }),
      blandAltman: sentence(
        'blandAltman',
        titled(columnTable([control, similar]), ['Lab', 'Point of care']),
      ),
      outliers: sentence('identifyOutliers', t),
    }
    expect(out).toMatchSnapshot()
    expect(out.blandAltman).toMatch(/^Point of care − Lab: bias /)
  })

  it('tools and simulations have no summary; failures have none', () => {
    const t = twoGroups(treated)
    expect(sentence('transform', t)).toMatch(/^\(no summary/)
    expect(sentence('ttest', twoGroups([1]))).toMatch(/^\(no summary/)
  })

  it('the summary comes first, then the sheet that answers the question', () => {
    const r = runDef(def('oneWayAnova'), doses(), {})
    expect(r.sheets.map((s) => s.key)).toEqual(['comparisons', 'results'])
    expect(r.sheets[0]!.blocks.at(-1)!.type).toBe('summary')
    const t = runDef(def('ttest'), twoGroups(treated))
    const details = t.sheets[0]!.blocks.filter((b) => 'detail' in b && b.detail)
    expect(details.map((b) => (b.type === 'keyValue' ? b.title : b.type))).toEqual([
      'Data sets',
      'Scatter in each group',
      'note',
      'Data analyzed',
    ])
  })
})

describe('comparisons-table headers (design §8.4, S23)', () => {
  const doses = () =>
    titled(
      columnTable([
        [18.1, 22.4, 15.9, 20.3],
        [24.0, 26.1, 22.3, 23.8],
        [30.2, 33.5, 27.8, 31.1],
        [31.2, 32.5, 28.8, 30.1],
      ]),
      ['Vehicle', '1 mg', '10 mg', '30 mg'],
    )
  const caption = (params: Record<string, unknown>) => {
    const t = doses()
    const r = runDef(def('oneWayAnova'), t, controlled(t, params))
    const b = r.sheets.find((s) => s.key === 'comparisons')?.blocks.find((x) => x.type === 'table')
    return (b as Extract<ResultBlock, { type: 'table' }>).caption
  }
  it('says the family and what the P values and CIs refer to', () => {
    expect(caption({})).toBe(
      'Tukey: all 6 pairs as one family. P values and 95% CIs are adjusted so that the chance of any false positive among the 6 is 5%.',
    )
    expect(caption({ comparisons: 'vsControl', control: 0 })).toBe(
      'Dunnett: each of 3 groups − Vehicle, one family; adjusted P values and simultaneous 95% CIs.',
    )
    expect(caption({ allPairsMethod: 'holm-sidak' })).toBe(
      'Holm-Šidák: adjusted P values for the 6 comparisons; no CIs (step-down methods have none).',
    )
    expect(caption({ allPairsMethod: 'fisher' })).toBe(
      'Fisher’s LSD: no adjustment; with 6 comparisons the chance of at least one false positive is about 26%.',
    )
    expect(caption({ allPairsMethod: 'sidak' })).toMatch(/^Šidák: the 6 comparisons as one family/)
    expect(caption({ gaussian: false })).toMatch(
      /^Dunn’s test \(Holm\): adjusted P values for the 6/,
    )
    expect(caption({ equalSD: 'welch' })).toMatch(
      /^Dunnett’s T3: all 6 pairs, without assuming equal SDs/,
    )
  })
  it('two-way comparisons within each row: each row its own family', () => {
    const t = titled(
      groupedTable(
        [
          [
            [1, 2, 3],
            [5, 6, 7],
          ],
          [
            [1, 2, 3],
            [2, 3, 4],
          ],
        ],
        ['WT', 'KO'],
      ),
      ['Vehicle', 'Drug'],
    )
    const r = runDef(
      def('twoWayAnova'),
      t,
      {},
      {
        tableKind: 'grouped',
        xTitle: null,
        factorNames: { rows: 'Genotype' },
      },
    )
    const b = r.sheets[0]!.blocks.find((x) => x.type === 'table') as Extract<
      ResultBlock,
      { type: 'table' }
    >
    expect(b.caption).toMatch(
      /^Each level of Genotype is its own family of 1 comparison \(Šidák\)\./,
    )
    expect(familyCaption(b, {}, [])).toMatch(/^Each row is its own family/)
  })
})
