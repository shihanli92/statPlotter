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

describe('audit 4: what the results say', () => {
  const groups = () =>
    titled(
      columnTable([
        [10, 11, 9, 10.5, 9.5, 10.2],
        [200, 210, 190, 205, 195, 202],
        [10.1, 11.3, 8.8, 10.6, 9.4, 10.0],
      ]),
      ['Ctrl (mg)', 'High (mg)', 'Low (mg)'],
    )

  it('S1: rank comparisons say which group is higher and give the medians, no rank numbers', () => {
    const kw = sentence('oneWayAnova', groups(), { gaussian: false })
    expect(kw).toMatch(
      /^2 of 3 comparisons differ \(Dunn’s test, Holm\): High \(mg\) is higher than (Low|Ctrl) \(mg\) \(medians 2\d\d mg and 10\.\d+ mg, adjusted P = 0\.\d+\)/,
    )
    expect(kw).not.toMatch(/ by \d/)
    const vs = sentence('oneWayAnova', groups(), {
      gaussian: false,
      comparisons: 'vsControl',
      control: 1,
    })
    expect(vs).toMatch(
      /^Compared with High \(mg\), Ctrl \(mg\) is lower \(median 10\.1 mg vs\. 2\d\d mg, adjusted P/,
    )
    expect(vs).not.toMatch(/ by \d/)
    const ctrl = sentence('oneWayAnova', groups(), {
      gaussian: false,
      comparisons: 'vsControl',
      control: 0,
    })
    expect(ctrl).toMatch(
      /Low \(mg\) shows no evidence of a difference \(median 10\.\d+ mg vs\. 10\.1 mg, adjusted P/,
    )
    const fr = sentence('friedman', groups())
    expect(fr).toMatch(
      /High \(mg\) is higher than (Low|Ctrl) \(mg\) \(medians 2\d\d mg and 10\.\d+ mg, adjusted P/,
    )
    expect(fr).not.toMatch(/ by \d/)
  })

  it('S6: no direction or verdict from a value that was not computed', () => {
    const fives = [5, 5, 5, 5, 5, 5, 5, 5]
    const sevens = [7, 7, 7, 7, 7, 7, 7, 7]
    const mw = sentence('mannWhitney', titled(columnTable([fives, sevens]), ['A', 'B']))
    // The shift isn't computed with every value tied: the medians give the direction.
    expect(mw).toMatch(/^Values in B tend to be higher than in A; P = 0\.\d+, Mann-Whitney test\./)
    const welch = sentence('ttest', titled(columnTable([fives, sevens]), ['A', 'B']))
    expect(welch).toMatch(/P could not be computed \(Welch’s t test\)/)
    expect(welch).not.toMatch(/no evidence/)
    const x = [1, 2, 3, 4, 5, 6, 7, 8]
    const huge = xyTable(x, [x.map((r) => 1e300 * (1 + r * 0.013))], ['Signal'])
    const deming = sentence('deming', huge)
    expect(deming).toMatch(/^The slope of Signal could not be computed/)
    for (const t of [mw, welch, deming]) expect(t).not.toMatch(/—|NaN/)
  })

  it('S7: one-tailed results against the prediction say so in every family', () => {
    const one = { tails: 'one', predicted: 'decrease' }
    const against = /the opposite way to the prediction.*; one-tailed P [=>] 0\.9\d+/
    const pair = titled(columnTable([control, treated]), ['Before', 'After'])
    const out = {
      paired: sentence('ttest', pair, { design: 'paired', ...one }),
      mannWhitney: sentence('mannWhitney', twoGroups(treated), one),
      wilcoxon: sentence('wilcoxon', pair, one),
      oneSample: sentence('oneSample', twoGroups(treated), { hypothetical: 45, ...one }),
      correlation: sentence(
        'correlation',
        titled(columnTable([[1, 2, 3, 4, 5, 6, 7, 8], treated.slice(0, 8).sort()]), ['X', 'Y']),
        one,
      ),
      contingency: sentence(
        'contingency',
        titled(
          countsTable(
            'contingency',
            [
              [30, 20],
              [15, 35],
            ],
            ['Drug', 'Placebo'],
          ),
          ['Died', 'Alive'],
        ),
        one,
      ),
    }
    for (const [k, t] of Object.entries(out)) {
      expect(t, k).toMatch(against)
      expect(t, k).not.toMatch(/no evidence/)
    }
    expect(out.oneSample).toMatch(/one-tailed \(predicted: below 45\)/)
    expect(out.correlation).toMatch(/predicted: a negative correlation/)
    // As predicted, the one-sample sentence says it is one-tailed (it never did).
    expect(
      sentence('oneSample', twoGroups(treated), {
        hypothetical: 45,
        tails: 'one',
        predicted: 'increase',
      }),
    ).toMatch(/is above 45 by .*one-sample t test, one-tailed \(predicted: above 45\)\)\.$/)
  })

  const genes = () =>
    titled(
      groupedTable(
        [
          [
            [1, 2, 3],
            [5, 6, 7],
          ],
          [
            [1, 2, 3],
            [3.4, 4.2, 5.0],
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

  it('S12: multiple one-way ANOVAs without a correction decide at the alpha asked for', () => {
    const r = runDef(def('multipleOneWay'), genes(), { approach: 'none', alpha: 0.01 })
    const main = r.sheets
      .flatMap((x) => x.blocks)
      .find((b) => b.type === 'table' && b.title?.endsWith('one per row')) as Extract<
      ResultBlock,
      { type: 'table' }
    >
    const j = main.columns.indexOf('Significant (P < 0.01)?')
    expect(j, main.columns.join()).toBeGreaterThan(0)
    const jP = main.columns.indexOf('P value')
    const ps = main.rows.map((x) => (x[jP] as { v: number }).v)
    expect(
      ps.some((p) => p >= 0.01 && p < 0.05),
      ps.join(),
    ).toBe(true)
    for (const x of main.rows)
      expect(x[j]).toEqual({ kind: 'bool', v: (x[jP] as { v: number }).v < 0.01 })
    const below = ps.filter((p) => p < 0.01).length
    expect(sentence('multipleOneWay', genes(), { approach: 'none', alpha: 0.01 })).toMatch(
      new RegExp(`^${below} of 3 rows differ between the groups`),
    )
  })

  it('S13: the wording follows the correction and the comparisons chosen', () => {
    expect(sentence('multipleT', genes(), { approach: 'none' })).toMatch(
      /rows are below the threshold \(P < 0\.05, not corrected for the 3 rows\), comparing/,
    )
    expect(sentence('multipleT', genes(), { approach: 'significance' })).toMatch(
      /below the threshold after correction \(statistical significance: holm-šidák method\)/i,
    )
    const t = titled(
      groupedTable(
        [
          [
            [10, 11, 12],
            [20, 21, 22],
          ],
          [
            [20, 21, 22],
            [10, 11, 12.5],
          ],
          [
            [15, 15.5, 16],
            [15, 16, 15.2],
          ],
        ],
        ['WT', 'KO', 'Het'],
      ),
      ['Vehicle', 'Drug'],
    )
    const two = (comparisons: string) =>
      sentence(
        'twoWayAnova',
        t,
        { comparisons },
        { factorNames: { rows: 'Genotype', columns: 'Treatment' } },
      )
    expect(two('withinRows')).toMatch(
      /; the comparisons within each level of Genotype describe it\./,
    )
    expect(two('none')).toMatch(/; comparisons within each level of Genotype would describe it\.$/)
    expect(two('mainColumns')).toMatch(
      /; the main-effect comparisons average over it; comparisons within each level of Genotype would describe it\./,
    )
    expect(two('withinColumns')).toMatch(
      /; the comparisons within each level of Treatment describe it\./,
    )
  })

  it('S11: a parameter held constant reads as its value, marked constant', () => {
    const x = [0, 1, 2, 3, 4, 6, 8, 10, 15, 20, 30]
    const y = x.map((v, i) => 5 + 95 * Math.exp(-0.3 * v) + ((i % 3) - 1) * 0.8)
    const s = sentence('nonlinearFit', xyTable(x, [y], ['Decay']), {
      equation: 'one-phase-decay',
      constraints: { Y0: { kind: 'constant', value: 100 } },
    })
    expect(s).toMatch(/^Decay: Y0 = 100 \(constant\), Plateau = \d/)
    expect(s).not.toMatch(/—|NaN/)
  })

  it('S3: captions count each family and name the control the rows are compared with', () => {
    const cells = [
      [
        [10, 11, 12],
        [20, 21, 22],
        [14, 15, 15.5],
      ],
      [
        [20, 21, 22],
        [10, 11, 12.5],
        [13, 14, 16],
      ],
      [
        [15, 15.5, 16],
        [15, 16, 15.2],
        [11, 12, 13],
      ],
    ]
    const t = titled(groupedTable(cells, ['WT', 'KO', 'Het']), ['Vehicle', 'Drug', 'Drug2'])
    const caption = (params: Record<string, unknown>) => {
      const r = runDef(def('twoWayAnova'), t, params, {
        tableKind: 'grouped',
        xTitle: null,
        factorNames: { rows: 'Genotype', columns: 'Treatment' },
      })
      const b = r.sheets
        .find((s) => s.key === 'comparisons')
        ?.blocks.find((x) => x.type === 'table') as Extract<ResultBlock, { type: 'table' }>
      return b.caption ?? ''
    }
    expect(caption({})).toBe(
      'Each level of Genotype is its own family of 3 comparisons (Šidák). Adjusted P values and 95% CIs.',
    )
    expect(caption({ family: 'all' })).toBe(
      'Šidák: the 9 comparisons as one family; adjusted P values and 95% CIs.',
    )
    const tukey = caption({ comparisons: 'withinRows', kind: 'allPairs', allPairsMethod: 'tukey' })
    expect(tukey).toMatch(/^Each level of Genotype is its own family of 3 comparisons \(Tukey\)\./)
    expect(tukey).not.toMatch(/ 9 |one family/)
    expect(caption({ comparisons: 'withinRows', kind: 'vsControl' })).toMatch(
      /family of 2 comparisons \(Dunnett\)\. Each group − Vehicle within it;/,
    )
    expect(caption({ comparisons: 'withinColumns', kind: 'vsControl' })).toMatch(
      /^Each level of Treatment is its own family of 2 comparisons \(Dunnett\)\. Each group − WT within it;/,
    )
    expect(caption({ comparisons: 'mainRows', kind: 'vsControl' })).toMatch(
      /^Dunnett: each of 2 groups − WT, one family;/,
    )
    expect(caption({ comparisons: 'allCells', kind: 'vsControl' })).toMatch(
      /^Dunnett: each of 8 groups − WT:Vehicle, one family;/,
    )
    // The summary names the same control.
    expect(
      sentence(
        'twoWayAnova',
        t,
        { comparisons: 'mainRows', kind: 'vsControl' },
        { factorNames: { rows: 'Genotype', columns: 'Treatment' } },
      ),
    ).toMatch(/Compared with WT, /)
  })

  it('S2: several correlation pairs are counted by the corrected P the table decides by', () => {
    const cols = [
      [2.58, 11.11, 7.33, -1.51, 5.53, 8.24, 6.07, 1.27, 10.13, 4.98],
      [5.91, 13.51, -2.39, 2.29, 13.22, 7.97, 5.31, 8.6, 13.32, 11.15],
      [-1.79, 6.9, 7.61, -0.24, 2.43, 2.49, 2.29, 4.65, 13.67, 6.23],
    ]
    const holm = sentence('correlation', columnTable(cols), { correction: 'holm' })
    expect(holm).toMatch(
      /^0 of 3 pairs correlate \(Holm-adjusted P < 0\.05, corrected for the 3 pairs; Pearson correlation\)\.$/,
    )
    expect(sentence('correlation', columnTable(cols), { correction: 'none' })).toMatch(
      /^1 of 3 pairs correlate \(P < 0\.05, not corrected/,
    )
  })
})
