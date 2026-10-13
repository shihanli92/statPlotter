import type { SummaryPart } from '@ps/model'
import {
  ALPHA,
  CI,
  type ComparisonRow,
  cell,
  comparisonRows,
  comparisonsTable,
  count,
  intervalOf,
  joinParts,
  kvBlock,
  listed,
  n3,
  negated,
  numOf,
  P,
  row,
  type SummaryInput,
  sizes,
  type Table,
  tableBlock,
  unitOf,
} from './read.ts'

// Roadmap 51d (design §8.2, U18): the summary sentence of each family, written from the result's
// own values in the user's names — the direction in words, the size with its CI, P with its test,
// n. P ≥ 0.05 says "no evidence of a difference" (never "no difference"); a one-tailed P says the
// direction predicted; comparisons say which pairs, adjusted. Templates are by family, in one
// place, as the explanations and the sketches are.

type Parts = SummaryPart[]
export type Summarize = (s: SummaryInput) => Parts | null

const sig = (p: number) => p < ALPHA
const higher = (d: number) => (d >= 0 ? 'higher' : 'lower')
const testName = (s: SummaryInput, fallback: string): string => {
  const t = s.result.values.test
  return t?.kind === 'text' ? t.v : fallback
}
const lower1 = (t: string) => t.charAt(0).toLowerCase() + t.slice(1)
/** Tests named after people keep their capital mid-sentence; "Paired t test" reads "paired t test". */
const PROPER =
  /^(Mann|Wilcoxon|Kolmogorov|Kruskal|Friedman|Fisher|Pearson|Spearman|Welch|Student|Dunnett|Tukey|Dunn|Gehan|Bonferroni|Šidák|Holm|Brown|Bartlett|Shapiro|Anderson|D’Agostino|Games|Tamhane|Newman)/
const inSentence = (t: string) => (PROPER.test(t) ? t : lower1(t))

/** ", one-tailed (predicted: Treated higher than Control)" when one-tailed. */
function tailWords(s: SummaryInput): string {
  if (s.params.tails !== 'one') return ''
  const said = row(s.result, { label: 'Predicted direction' })
  return said?.kind === 'text' ? `, one-tailed (predicted: ${said.v})` : ', one-tailed'
}

/** A one-tailed effect that went the other way to the direction predicted. */
const againstPrediction = (s: SummaryInput, effect: number) =>
  s.params.tails === 'one' &&
  ((s.params.predicted === 'increase' && effect < 0) ||
    (s.params.predicted === 'decrease' && effect > 0))

// --- Two groups -----------------------------------------------------------------------------------

/** t tests: unpaired (raw or summary data), paired, ratio paired. */
const tTest: Summarize = (s) => {
  const [A, B] = s.input
  if (!A || !B) return null
  const [a, b] = [A.title, B.title]
  const c = s.result.comparisons[0]
  if (!c?.estimate) return null
  const test = inSentence(testName(s, 't test'))
  const p = c.p
  const est = c.estimate
  const level = intervalOf(row(s.result, { key: 'ci' }))?.level ?? 0.95
  const ci = { lo: est.lo, hi: est.hi, level }
  const unit = unitOf(s, 'y')
  const tail = tailWords(s)
  if (s.params.design === 'paired') {
    const pairs = numOf(row(s.result, { key: 'pairs' }))
    if (row(s.result, { key: 'ratio' })) {
      const ratioCi = intervalOf(row(s.result, { key: 'ratioCi' }))
      return [
        `${b} is `,
        n3(est.value),
        ` times ${a} on average (geometric mean ratio${ratioCi ? ', ' : ''}`,
        ...(ratioCi ? [CI(ratioCi)] : []),
        ') across ',
        count(pairs),
        ' pairs; ',
        P(p),
        `, ${test}${tail}.`,
      ]
    }
    if (!sig(p))
      return [
        `${b} − ${a} averages `,
        n3(est.value, unit),
        ' across ',
        count(pairs),
        ' pairs (',
        CI(ci, unit),
        '); no evidence of a difference (',
        P(p),
        `, ${test}${tail}).`,
      ]
    return [
      `${b} is ${higher(est.value)} than ${a} by `,
      n3(Math.abs(est.value), unit),
      ' on average across ',
      count(pairs),
      ' pairs (',
      CI(est.value >= 0 ? ci : negated(ci), unit),
      '); ',
      P(p),
      `, ${test}${tail}.`,
    ]
  }
  const n = [numOf(row(s.result, { key: 'nA' })), numOf(row(s.result, { key: 'nB' }))]
  if (againstPrediction(s, est.value))
    return [
      `${b} and ${a} differ by `,
      n3(est.value, unit),
      ` (${b} − ${a}, `,
      CI(ci, unit),
      `), the opposite way to the prediction${tail.replace(/^, one-tailed/, '')}; one-tailed `,
      P(p),
      `, ${test}. `,
      ...sizes(n),
      '.',
    ]
  if (!sig(p))
    return [
      `${b} and ${a} differ by `,
      n3(est.value, unit),
      ` (${b} − ${a}, `,
      CI(ci, unit),
      '); no evidence of a difference (',
      P(p),
      `, ${test}${tail}). `,
      ...sizes(n),
      '.',
    ]
  return [
    `${b} is ${higher(est.value)} than ${a} by `,
    n3(Math.abs(est.value), unit),
    ' (',
    CI(est.value >= 0 ? ci : negated(ci), unit),
    '); ',
    P(p),
    `, ${test}${tail}. `,
    ...sizes(n),
    '.',
  ]
}

/** Mann-Whitney: values in B tend to be higher than in A (the Hodges-Lehmann shift). */
const mannWhitney: Summarize = (s) => {
  const [A, B] = s.input
  const c = s.result.comparisons[0]
  if (!A || !B || !c?.estimate) return null
  const [a, b] = [A.title, B.title]
  const est = c.estimate
  const level = intervalOf(row(s.result, { key: 'ci' }))?.level ?? 0.95
  const ci = { lo: est.lo, hi: est.hi, level }
  const medians: Parts = [
    ' Medians ',
    n3(numOf(row(s.result, { key: 'medianA' }))),
    ` (${a}) and `,
    n3(numOf(row(s.result, { key: 'medianB' }))),
    ` (${b}); `,
    ...sizes([numOf(row(s.result, { key: 'nA' })), numOf(row(s.result, { key: 'nB' }))]),
    '.',
  ]
  const tail = tailWords(s)
  if (!sig(c.p))
    return [
      `No evidence that values in ${b} and ${a} tend to differ (shift ${b} − ${a} `,
      n3(est.value),
      ', ',
      CI(ci),
      '; ',
      P(c.p),
      `, Mann-Whitney test${tail}).`,
      ...medians,
    ]
  return [
    `Values in ${b} tend to be ${higher(est.value)} than in ${a} (shift ${b} − ${a} `,
    n3(est.value),
    ', ',
    CI(ci),
    '); ',
    P(c.p),
    `, Mann-Whitney test${tail}.`,
    ...medians,
  ]
}

/** Wilcoxon matched pairs. */
const wilcoxon: Summarize = (s) => {
  const [A, B] = s.input
  const c = s.result.comparisons[0]
  if (!A || !B || !c?.estimate) return null
  const [a, b] = [A.title, B.title]
  const est = c.estimate
  const level = intervalOf(row(s.result, { key: 'ci' }))?.level ?? 0.95
  const ci = { lo: est.lo, hi: est.hi, level }
  const pairs = numOf(row(s.result, { key: 'pairs' }))
  const tail = tailWords(s)
  const head = sig(c.p)
    ? `Within pairs, ${b} tends to be ${higher(est.value)} than ${a}`
    : `Within pairs, no evidence that ${b} and ${a} tend to differ`
  return [
    `${head} (median difference ${b} − ${a} `,
    n3(est.value),
    ', ',
    CI(ci),
    '); ',
    P(c.p),
    `, Wilcoxon matched-pairs test${tail}, `,
    count(pairs),
    ' pairs.',
  ]
}

/** Kolmogorov-Smirnov: the distributions differ, or no evidence. */
const kolmogorovSmirnov: Summarize = (s) => {
  const [A, B] = s.input
  const p = numOf(s.result.values.p)
  if (!A || !B || Number.isNaN(p)) return null
  return [
    sig(p)
      ? `The distributions of ${A.title} and ${B.title} differ (`
      : `No evidence that the distributions of ${A.title} and ${B.title} differ (`,
    P(p),
    ', Kolmogorov-Smirnov test). ',
    ...sizes([numOf(row(s.result, { key: 'nA' })), numOf(row(s.result, { key: 'nB' }))]),
    '.',
  ]
}

/** One sample: each data set's mean (median) against the hypothetical value. */
const oneSample: Summarize = (s) => {
  const t = s.params.test === 'wilcoxon'
  const main = tableBlock(s.result, t ? 'Wilcoxon signed-rank test' : 'One sample t test')
  const size = tableBlock(s.result, 'How big is the discrepancy?')
  if (!main || !size) return null
  const h = numOf(cell(main, t ? 'Theoretical median' : 'Theoretical mean', main.columns[1]!))
  const unit = unitOf(s, 'y')
  const items = main.columns.slice(1, 4).map((name): Parts => {
    const center = numOf(cell(main, t ? 'Actual median' : 'Actual mean', name))
    const p = numOf(cell(main, 'P value', name))
    const d = numOf(
      cell(
        size,
        t ? 'Hodges-Lehmann estimate of the discrepancy' : 'Discrepancy (actual − theoretical)',
        name,
      ),
    )
    const ciRow = size.rows.find((r) => r[0]?.kind === 'text' && / CI of /.test(r[0].v))
    const j = size.columns.indexOf(name)
    const ci = ciRow ? intervalOf(ciRow[j]) : null
    const what = t ? 'median' : 'mean'
    return [
      `the ${what} of ${name}, `,
      n3(center, unit),
      sig(p) ? `, is ${d >= 0 ? 'above' : 'below'} ` : ', shows no evidence of differing from ',
      n3(h, unit),
      sig(p) ? ' by ' : ' (difference ',
      ...(sig(p) ? [n3(Math.abs(d), unit)] : [n3(d, unit)]),
      ...(ci ? [' (', CI(d >= 0 || !sig(p) ? ci : negated(ci), unit), ')'] : []),
      sig(p) ? '; ' : ', ',
      P(p),
      sig(p) ? '' : ')',
    ]
  })
  const more = main.columns.length - 1 - items.length
  const parts = joinParts(items, '; ')
  const first = parts[0]
  if (typeof first === 'string') parts[0] = first.charAt(0).toUpperCase() + first.slice(1)
  return [
    ...parts,
    `${more > 0 ? `; ${more} more in the table` : ''} (${t ? 'Wilcoxon signed-rank test' : 'one-sample t test'}).`,
  ]
}

// --- Several groups -------------------------------------------------------------------------------

/** The adjusted P of a comparison: "adjusted P = 0.007" or "q = 0.01". */
const adjusted = (r: ComparisonRow): Parts =>
  r.q ? [{ value: { kind: 'pvalue', v: r.p }, role: 'q' }] : ['adjusted ', P(r.p)]

/** One comparison against the control, oriented group − control. */
function vsControlItem(r: ComparisonRow, control: string, unit?: string): Parts {
  const flip = r.left === control
  const group = flip ? r.right : r.left
  const d = flip ? -r.diff : r.diff
  const ci = r.ci ? (flip ? negated(r.ci) : r.ci) : null
  const finite = Number.isFinite(d)
  if (!finite) return [`${group} (`, ...adjusted(r), ')']
  if (sig(r.p))
    return [
      `${group} is ${higher(d)} by `,
      n3(Math.abs(d), unit),
      ' (',
      ...(ci ? [CI(d >= 0 ? ci : negated(ci), unit), ', '] : []),
      ...adjusted(r),
      ')',
    ]
  return [
    `${group} differs by `,
    n3(d, unit),
    ' (',
    ...(ci ? [CI(ci, unit), ', '] : []),
    ...adjusted(r),
    ')',
  ]
}

/** One pair, the larger first: "10 mg/kg is higher than Vehicle by 12.0 (95% CI …, adjusted P …)". */
function pairItem(r: ComparisonRow, unit?: string): Parts {
  const within = r.within ? `${r.within}: ` : ''
  if (!Number.isFinite(r.diff)) return [`${within}${r.left} vs. ${r.right} (`, ...adjusted(r), ')']
  const [hi, lo] = r.diff >= 0 ? [r.left, r.right] : [r.right, r.left]
  const ci = r.ci ? (r.diff >= 0 ? r.ci : negated(r.ci)) : null
  return [
    `${within}${hi} is higher than ${lo} by `,
    n3(Math.abs(r.diff), unit),
    ' (',
    ...(ci ? [CI(ci, unit), ', '] : []),
    ...adjusted(r),
    ')',
  ]
}

/** The comparisons' method in words ("Dunnett’s test", "Tukey’s adjustment"…). */
function methodWords(t: Table): string {
  const title = (t.title ?? '').split(' — ')[0]!
  return title
    .replace(/ multiple comparisons test/, ' test')
    .replace(/^Uncorrected Fisher’s LSD/, 'Fisher’s LSD (uncorrected)')
}

/** The sentence about a comparisons table, by its kind (each with a control, or pairs). */
function comparisonsParts(s: SummaryInput, t: Table | null, unit?: string): Parts {
  const rows = comparisonRows(t)
  if (!t || !rows.length) return []
  const m = rows.length
  const method = methodWords(t)
  const control = s.params.comparisons === 'vsControl' || s.params.kind === 'vsControl'
  const controlName = control ? controlTitle(s, rows) : null
  if (
    controlName &&
    rows.every((r) => !r.within && (r.left === controlName || r.right === controlName))
  ) {
    const shown = rows.slice(0, 4).map((r) => vsControlItem(r, controlName, unit))
    return [
      `Compared with ${controlName}, `,
      ...joinParts(shown, '; ', '; and '),
      `${m > shown.length ? `; ${m - shown.length} more in the table` : ''}; ${method} for ${m} comparison${m === 1 ? '' : 's'}. `,
    ]
  }
  const differ = rows.filter((r) => sig(r.p))
  const largest = [...differ].sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff) || x.p - y.p)
  const shown = largest.slice(0, 3).map((r) => pairItem(r, unit))
  const pairsWord = m === 1 ? 'comparison' : 'comparisons'
  if (!differ.length) {
    const smallest = Math.min(...rows.map((r) => r.p))
    return [
      `No evidence of a difference in the ${m} ${pairsWord} after adjustment (${method}; smallest adjusted `,
      P(smallest),
      '). ',
    ]
  }
  return [
    `${differ.length} of ${m} ${pairsWord} ${differ.length === 1 ? 'differs' : 'differ'} (${method}): `,
    ...joinParts(shown, '; '),
    `${differ.length > shown.length ? `; and ${differ.length - shown.length} more in the table` : ''}. `,
  ]
}

/** The control's title: the params' control data set (else the first). */
function controlTitle(s: SummaryInput, rows: readonly ComparisonRow[]): string | null {
  const key = typeof s.params.control === 'string' ? s.params.control : ''
  const named = s.input.find((d) => d.ref.key === key)?.title
  if (named) return named
  // Saved analyses' first group; else the side every row shares.
  const shared = [rows[0]?.left, rows[0]?.right].find(
    (x) => x !== undefined && rows.every((r) => r.left === x || r.right === x),
  )
  return shared ?? s.input[0]?.title ?? null
}

/** One-way ANOVA (ordinary, Welch, Brown-Forsythe, repeated measures), Kruskal-Wallis, Friedman. */
const oneWay: Summarize = (s) => {
  const p = numOf(s.result.values.p)
  if (Number.isNaN(p) && !s.result.comparisons.length) return null
  const test = testName(s, 'one-way ANOVA')
  const k = s.input.length
  const unit = unitOf(s, 'y')
  const nonparametric = /Kruskal|Friedman/.test(test)
  const matched = /Repeated|Mixed|Friedman/.test(test)
  const exact = row(s.result, { label: 'Exact or approximate P value?' })
  const exactWord = exact?.kind === 'text' ? `${lower1(exact.v)} ` : ''
  const overall: Parts = nonparametric
    ? [
        sig(p)
          ? matched
            ? 'Within subjects, values tend to differ between the groups ('
            : 'Values tend to differ between groups ('
          : 'No evidence that values tend to differ between groups (',
        `${test}, ${exactWord}`,
        P(p),
        '). ',
      ]
    : matched
      ? [
          sig(p)
            ? `Within subjects, the mean changes across the ${k} groups (`
            : `Within subjects, no evidence that the mean changes across the ${k} groups (`,
          `${inSentence(test)}, `,
          P(p),
          ...subjectsParts(s),
          '). ',
        ]
      : [
          sig(p)
            ? `The means differ across the ${k} groups (`
            : `No evidence that the means differ across the ${k} groups (`,
          `${inSentence(test)}, `,
          P(p),
          '). ',
        ]
  const comparisons = comparisonsParts(s, comparisonsTable(s.result), unit)
  if (!comparisons.length) return trim([...overall, ...trendParts(s)])
  return trim([
    ...comparisons,
    'Overall: ',
    ...overall.map((x, i) => (i === 0 && typeof x === 'string' ? lower1(x) : x)),
    ...trendParts(s),
  ])
}

/** "; 12 subjects" of a repeated-measures analysis. */
function subjectsParts(s: SummaryInput): Parts {
  const n = numOf(row(s.result, { label: 'Number of subjects' }))
  return Number.isFinite(n) ? ['; ', count(n), ' subjects'] : []
}

/** The test for a linear trend, when asked. */
function trendParts(s: SummaryInput): Parts {
  const t = row(s.result, { block: 'Test for linear trend', label: 'P value' })
  if (t?.kind !== 'pvalue') return []
  return [
    sig(t.v)
      ? 'A linear trend across the groups in their order ('
      : 'No evidence of a linear trend across the groups in their order (',
    P(t.v),
    '). ',
  ]
}

/** Two-way ANOVA: the interaction first, then the comparisons. */
const twoWay: Summarize = (s) => {
  const pi = numOf(s.result.values['p.interaction'])
  const pr = numOf(s.result.values['p.row'])
  const pc = numOf(s.result.values['p.column'])
  if ([pi, pr, pc].every(Number.isNaN)) return null
  const f = s.context?.factorNames
  const col = f?.columns || 'the column factor'
  const rowF = f?.rows || 'the row factor'
  const cap = (t: string) => (t.startsWith('the ') ? t.charAt(4).toUpperCase() + t.slice(5) : t)
  const test = inSentence(testName(s, 'two-way ANOVA'))
  const head: Parts =
    !Number.isNaN(pi) && sig(pi)
      ? [
          `The effect of ${col} depends on ${rowF} (interaction `,
          P(pi),
          `, ${test}); the comparisons within each level of ${rowF} describe it. `,
        ]
      : [
          `${cap(col)}: `,
          P(pc),
          `; ${cap(rowF).replace(/^Row factor$/, 'row factor')}: `,
          P(pr),
          ...(Number.isNaN(pi)
            ? ['. ']
            : [
                '; no evidence that one changes the effect of the other (interaction ',
                P(pi),
                '). ',
              ]),
        ]
  return trim([...head, ...comparisonsParts(s, comparisonsTable(s.result), unitOf(s, 'y'))])
}

/** Factorial ANOVAs with a table of effects (three-way, multifactor): the effects below 0.05. */
const effects: Summarize = (s) => {
  const t =
    tableBlock(s.result, 'Three-way ANOVA') ??
    tableBlock(s.result, 'ANOVA table') ??
    tableBlock(s.result, 'Type')
  if (!t) return null
  const jP = t.columns.findIndex((c) => c === 'P value')
  if (jP < 0) return null
  const rows = t.rows
    .map((r) => ({ name: r[0]?.kind === 'text' ? r[0].v : '', p: numOf(r[jP]) }))
    .filter((r) => r.name && !/^(Residual|Total|Error)/.test(r.name) && Number.isFinite(r.p))
  if (!rows.length) return null
  const below = rows.filter((r) => sig(r.p))
  const test = inSentence(testName(s, 'ANOVA'))
  if (!below.length)
    return [
      `No effect shows evidence of a difference (${test}; smallest `,
      P(Math.min(...rows.map((r) => r.p))),
      ').',
    ]
  return [
    `Effects with P < ${ALPHA}: `,
    ...joinParts(
      below.slice(0, 4).map((r) => [`${r.name} (`, P(r.p), ')']),
      '; ',
    ),
    `${below.length > 4 ? `; ${below.length - 4} more` : ''}; ${rows.length - below.length} of ${rows.length} show no evidence of an effect (${test}).`,
  ]
}

/** Nested t test: like a t test, the subcolumns accounted for. */
const nestedT: Summarize = (s) => {
  const [A, B] = s.input
  if (!A || !B) return null
  const p = numOf(s.result.values.p)
  const d = numOf(s.result.values.diff)
  const ci =
    intervalOf(row(s.result, { label: '95% confidence interval' })) ??
    intervalOf(
      kvBlock(s.result, 'How big is the difference?')?.rows.find((r) => r.value.kind === 'interval')
        ?.value,
    )
  if (Number.isNaN(p) || Number.isNaN(d)) return null
  const unit = unitOf(s, 'y')
  const [a, b] = [A.title, B.title]
  if (!sig(p))
    return [
      `${b} and ${a} differ by `,
      n3(d, unit),
      ...(ci ? [` (${b} − ${a}, `, CI(ci, unit), ')'] : []),
      '; no evidence of a difference (',
      P(p),
      `, nested t test${tailWords(s)}).`,
    ]
  return [
    `${b} is ${higher(d)} than ${a} by `,
    n3(Math.abs(d), unit),
    ...(ci ? [' (', CI(d >= 0 ? ci : negated(ci), unit), ')'] : []),
    '; ',
    P(p),
    `, nested t test${tailWords(s)}.`,
  ]
}

/** Multiple t tests: the rows that are discoveries (or below the threshold). */
const multipleT: Summarize = (s) => {
  const [A, B] = s.input
  const tests = numOf(s.result.values.tests)
  const flagged = numOf(s.result.values.flagged)
  if (!A || !B || Number.isNaN(tests)) return null
  const compared = row(s.result, { key: 'compared' })
  const diff = compared?.kind === 'text' ? compared.v : `${B.title} − ${A.title}`
  const test = row(s.result, { label: 'Test' })
  const family = row(s.result, { label: 'Multiple comparisons' })
  const fdr = s.params.approach === 'fdr'
  const q = typeof s.params.q === 'number' ? s.params.q : 5
  const what = fdr
    ? `discoveries at a false discovery rate of ${q}%`
    : `below the threshold after correction`
  return [
    count(flagged),
    ` of `,
    count(tests),
    ` rows are ${what}${family?.kind === 'text' ? ` (${lower1(family.v)})` : ''}, comparing ${diff} by ${test?.kind === 'text' ? inSentence(test.v.replace(/ \(.*\)$/, '')) : 'a t test'} in each row.`,
  ]
}

/** Multiple one-way ANOVAs: the rows whose ANOVA is a discovery. */
const multipleOneWay: Summarize = (s) => {
  const block = kvBlock(s.result, 'Analysis')
  if (!block) return null
  const analyzed = numOf(row(s.result, { block: 'Analysis', label: 'Number of rows analyzed' }))
  const disc =
    row(s.result, { block: 'Analysis', label: 'Number of discoveries' }) ??
    row(s.result, { block: 'Analysis', label: 'Number below threshold' }) ??
    row(s.result, { block: 'Analysis', label: 'Number of rows with P < 0.05' })
  const correction = row(s.result, { block: 'Analysis', label: 'Correction across rows' })
  const test = testName(s, 'one-way ANOVA')
  if (Number.isNaN(analyzed)) return null
  if (!disc) return [`One ${inSentence(test)} per row, `, count(analyzed), ' rows analyzed.']
  return [
    count(numOf(disc)),
    ' of ',
    count(analyzed),
    ` rows differ between the groups (${inSentence(test)} in each row${correction?.kind === 'text' ? `; ${lower1(correction.v)} across rows` : ''}).`,
  ]
}

// --- Relationships, curves ------------------------------------------------------------------------

/** Correlation: one pair in words; several pairs counted. */
const correlation: Summarize = (s) => {
  const t = tableBlock(s.result, 'Pearson') ?? tableBlock(s.result, 'Spearman')
  if (!t) return null
  const spearman = (t.title ?? '').startsWith('Spearman')
  const rCol = t.columns.find((c) => / r$/.test(c)) ?? t.columns[1]!
  const pCol = t.columns.find((c) => c.startsWith('P value')) ?? 'P value'
  const ciCol = t.columns.find((c) => c.endsWith('CI'))
  const nCol = t.columns.find((c) => c.startsWith('Number of'))
  const qCol = t.columns.find((c) => c.startsWith('q value'))
  const name = spearman ? 'Spearman correlation' : 'Pearson correlation'
  const pairs = t.rows.map((r) => {
    const label = r[0]?.kind === 'text' ? r[0].v : ''
    const get = (c: string | undefined) => (c ? r[t.columns.indexOf(c)] : undefined)
    return {
      label,
      r: numOf(get(rCol)),
      p: numOf(get(pCol)),
      q: qCol ? numOf(get(qCol)) : Number.NaN,
      ci: intervalOf(get(ciCol)),
      n: numOf(get(nCol)),
    }
  })
  if (pairs.length === 1) {
    const x = pairs[0]!
    const [X, Y] = x.label.split(' vs. ')
    const both = X && Y ? `${X} and ${Y}` : x.label
    const how = !sig(x.p) ? '' : x.r >= 0 ? ' rise together' : ' move in opposite directions'
    return [
      sig(x.p) ? `${both}${how}: r = ` : `${both}: r = `,
      n3(x.r),
      ...(x.ci ? [' (', CI(x.ci), ')'] : []),
      ', ',
      count(x.n),
      ` pairs; ${sig(x.p) ? '' : 'no evidence of a correlation, '}`,
      P(x.p),
      `, ${name}.`,
    ]
  }
  const fam = qCol ? pairs.filter((x) => x.q < ALPHA) : pairs.filter((x) => sig(x.p))
  const strongest = [...fam].sort((a, b) => Math.abs(b.r) - Math.abs(a.r)).slice(0, 3)
  return [
    `${fam.length} of ${pairs.length} pairs correlate (${qCol ? `q < ${ALPHA}, corrected for the ${pairs.length} pairs` : `P < ${ALPHA}, not corrected for the ${pairs.length} pairs`}; ${name})`,
    ...(strongest.length
      ? [
          ': ',
          ...joinParts(
            strongest.map((x) => [`${x.label}, r = `, n3(x.r)]),
            '; ',
          ),
        ]
      : []),
    '.',
  ]
}

/** Linear (and Deming) regression: the slope per data set, then the comparison of lines. */
const regression: Summarize = (s) => {
  const best = tableBlock(s.result, 'Best-fit values')
  const cis = tableBlock(s.result, '95% Confidence') ?? tableBlock(s.result, '9')
  const nonZero = tableBlock(s.result, 'Is slope significantly non-zero?')
  const fit = tableBlock(s.result, 'Goodness of Fit')
  if (!best) return null
  const xName = s.context?.xTitle || 'X'
  const unit = unitOf(s, 'y')
  const items = best.columns.slice(1, 4).map((name): Parts => {
    const slope = numOf(cell(best, 'Slope', name))
    const ci = intervalOf(cell(cis, 'Slope', name))
    const p = numOf(cell(nonZero, 'P value', name))
    const r2 = numOf(cell(fit, 'R squared', name))
    return [
      `${name} ${slope >= 0 ? 'rises' : 'falls'} by `,
      n3(Math.abs(slope), unit),
      ` per unit of ${xName}`,
      ...(ci ? [' (', CI(slope >= 0 ? ci : negated(ci), unit), ')'] : []),
      ...(Number.isFinite(r2) ? ['; R² = ', n3(r2)] : []),
      ...(Number.isFinite(p)
        ? sig(p)
          ? ['; the slope differs from zero (', P(p), ')']
          : ['; no evidence the slope differs from zero (', P(p), ')']
        : []),
    ]
  })
  const out: Parts = [...joinParts(items, '. '), '. ']
  const slopes = row(s.result, { block: 'Are the slopes equal?', label: 'P value' })
  const elev = row(s.result, { block: 'Are the elevations or intercepts equal?', label: 'P value' })
  if (slopes?.kind === 'pvalue') {
    out.push(
      sig(slopes.v) ? 'The slopes differ (' : 'The slopes show no evidence of differing (',
      P(slopes.v),
      ')',
    )
    if (elev?.kind === 'pvalue')
      out.push(
        sig(elev.v)
          ? '; the intercepts, compared assuming a common slope, differ ('
          : '; the intercepts, compared assuming a common slope, show no evidence of differing (',
        P(elev.v),
        ')',
      )
    out.push('. ')
  }
  return trim(out)
}

/** Nonlinear fits: EC50 (IC50…) per data set with its unit, else the first parameters. */
const nonlinear: Summarize = (s) => {
  const best = tableBlock(s.result, 'Best-fit values')
  if (!best) return null
  const ciTable = tableBlock(s.result, '95% CI') ?? tableBlock(s.result, '9')
  const statusTable = tableBlock(s.result, 'Fit')
  const names = best.columns.slice(1)
  const labels = best.rows.map((r) => (r[0]?.kind === 'text' ? r[0].v : ''))
  const ec = labels.find((l) => /^(EC50|IC50|ED50|ID50|EC\d+|IC\d+)$/.test(l))
  const unit = unitOf(s, 'x')
  const failed = names.filter((n) => {
    const st = cell(statusTable, 'Status', n)
    return st?.kind === 'text' && !/^Converged/.test(st.v)
  })
  const ok = names.filter((n) => !failed.includes(n))
  const out: Parts = []
  if (ec && ok.length) {
    const logLabel = labels.find((l) => l === `Log${ec}`)
    const items = ok.slice(0, 4).map((n): Parts => {
      const v = numOf(cell(best, ec, n))
      const logCi = logLabel ? intervalOf(cell(ciTable, logLabel, n)) : null
      const ci = !logLabel ? intervalOf(cell(ciTable, ec, n)) : null
      return [
        n3(v, unit),
        ...(logCi ? [` (log ${ec} `, CI(logCi), ')'] : ci ? [' (', CI(ci, unit), ')'] : []),
        ` for ${n}`,
      ]
    })
    out.push(`${ec} = `, ...joinParts(items, '; '))
    const hill = labels.find((l) => l === 'HillSlope')
    if (hill && ok.length)
      out.push(
        '; Hill slope ',
        ...joinParts(
          ok.slice(0, 4).map((n) => [n3(numOf(cell(best, hill, n)))]),
          ', ',
          ok.length > 1 ? ' and ' : '',
        ),
      )
    out.push(`${ok.length > 4 ? `; ${ok.length - 4} more in the table` : ''}. `)
  } else if (ok.length) {
    const shown = labels.filter(Boolean).slice(0, 3)
    const items = ok.slice(0, 3).map(
      (n): Parts => [
        `${n}: `,
        ...joinParts(
          shown.map((l) => [`${l} = `, n3(numOf(cell(best, l, n)))]),
          ', ',
        ),
      ],
    )
    out.push(...joinParts(items, '; '), '. ')
  }
  if (failed.length) out.push(`The fit of ${listed(failed)} did not converge (see the Fit rows). `)
  out.push(...fitComparison(s, labels))
  return out.length ? trim(out) : null
}

/**
 * Roadmap 51e (§9.4, S18): the one verdict of a curve fit's comparison, by the method chosen in
 * advance — the preferred model (F test with its P, or AICc with its probability), and whether
 * the compared parameters differ between data sets.
 */
function fitComparison(s: SummaryInput, labels: readonly string[]): Parts {
  const out: Parts = []
  const v = s.result.values
  const byKey = new Map(s.input.map((d) => [d.ref.key, d.title]))
  const verdicts = Object.keys(v)
    .filter((k) => k.startsWith('preferredModel:'))
    .map((k) => {
      const key = k.slice('preferredModel:'.length)
      const name = v[k]
      return {
        title: byKey.get(key) ?? key,
        name: name?.kind === 'text' ? name.v : '',
        p: numOf(v[`modelP:${key}`]),
        prob: numOf(v[`modelProbability:${key}`]),
      }
    })
    .filter((x) => x.name)
  const many = verdicts.length > 1
  for (const x of verdicts.slice(0, 3)) {
    const lead = `Preferred model${many ? ` for ${x.title}` : ''}: ${x.name} (`
    if (!Number.isNaN(x.p)) out.push(lead, 'extra sum-of-squares F test, ', P(x.p), '). ')
    else if (!Number.isNaN(x.prob))
      out.push(lead, `AICc, probability ${Math.round(x.prob * 1000) / 10}%). `)
  }
  if (verdicts.length > 3) out.push(`${verdicts.length - 3} more in the table. `)
  const compared = (Array.isArray(s.params.compareParams) ? s.params.compareParams : []).filter(
    (n): n is string => typeof n === 'string' && labels.includes(n),
  )
  if (compared.length) {
    const names = listed(compared)
    const one = compared.length === 1
    const p = numOf(v.compareP)
    const shared = numOf(v.compareProbShared)
    if (!Number.isNaN(p))
      out.push(
        sig(p)
          ? `${names} ${one ? 'differs' : 'differ'} between data sets (extra sum-of-squares F test, `
          : `No evidence that ${names} ${one ? 'differs' : 'differ'} between data sets (extra sum-of-squares F test, `,
        P(p),
        '). ',
      )
    else if (!Number.isNaN(shared))
      out.push(
        shared >= 0.5
          ? `AICc prefers one ${names} for all data sets (probability ${Math.round(shared * 1000) / 10}%). `
          : `AICc prefers ${one ? 'a different' : 'different'} ${names} for each data set (probability ${Math.round((1 - shared) * 1000) / 10}%). `,
      )
  }
  return out
}

// --- Counts and survival -------------------------------------------------------------------------

/** Contingency: the outcome's percentages by row, the effect, the test. */
const contingency: Summarize = (s) => {
  const p = numOf(s.result.values.p)
  if (Number.isNaN(p)) return null
  const test = testName(s, 'chi-square test')
  const pct = tableBlock(s.result, 'Percent of row total')
  const rowNames = pct?.rows.map((r) => (r[0]?.kind === 'text' ? r[0].v : '')) ?? []
  const outcomes = pct?.columns.slice(1) ?? []
  const twoByTwo = rowNames.length === 2 && outcomes.length === 2
  const out: Parts = []
  if (twoByTwo && pct) {
    const oc = Number(s.params.outcomeColumn ?? 0) === 1 ? 1 : 0
    const ex = Number(s.params.exposedRow ?? 0) === 1 ? 1 : 0
    const outcome = outcomes[oc]!
    const order = ex === 1 ? [1, 0] : [0, 1]
    out.push(
      `${outcome}: `,
      ...joinParts(
        order.map((i) => [n3(numOf(pct.rows[i]![oc + 1])), `% in ${rowNames[i]}`]),
        ', ',
      ),
    )
    const rr = row(s.result, { label: 'Relative risk' })
    const rrCi = intervalOf(
      kvBlock(s.result, 'Relative risk of')?.rows.find((r) => r.value.kind === 'interval')?.value,
    )
    if (rr) out.push('; relative risk ', n3(numOf(rr)), ...(rrCi ? [' (', CI(rrCi), ')'] : []))
    else {
      const or = row(s.result, { label: 'Odds ratio' })
      const orCi = intervalOf(
        kvBlock(s.result, 'Odds ratio')?.rows.find((r) => r.value.kind === 'interval')?.value,
      )
      if (or) out.push('; odds ratio ', n3(numOf(or)), ...(orCi ? [' (', CI(orCi), ')'] : []))
    }
    out.push(
      sig(p) ? '; ' : '; no evidence of a difference (',
      P(p),
      `, ${inSentence(test)}${tailWords(s)}${sig(p) ? '' : ')'}.`,
    )
  } else {
    out.push(
      sig(p)
        ? `The outcomes differ between the ${rowNames.length || 'rows'} rows (`
        : `No evidence that the outcomes differ between the ${rowNames.length || ''} rows (`.replace(
            '  ',
            ' ',
          ),
      P(p),
      `, ${inSentence(test)}).`,
    )
  }
  const trend = row(s.result, { block: 'Chi-square test for trend', label: 'P value' })
  if (trend?.kind === 'pvalue')
    out.push(
      sig(trend.v)
        ? ' The outcome changes with the order of the rows (chi-square for trend, '
        : ' No evidence of a trend with the order of the rows (chi-square for trend, ',
      P(trend.v),
      ').',
    )
  return out
}

/** Survival: the medians (not reached), the test, the hazard ratio. */
const survival: Summarize = (s) => {
  const t = tableBlock(s.result, 'Median survival')
  const unit = unitOf(s, 'x')
  const items: Parts[] = (t?.rows ?? []).slice(0, 5).map((r) => {
    const name = r[0]?.kind === 'text' ? r[0].v : ''
    const m = r[1]
    return m?.kind === 'number' ? [n3(m.v, unit), ` on ${name}`] : [`not reached on ${name}`]
  })
  const out: Parts = []
  if (items.length) out.push('Median survival ', ...joinParts(items, ', ', ' and '))
  const p = numOf(s.result.values.p)
  const test = testName(s, 'log-rank test')
  if (!Number.isNaN(p))
    out.push(
      sig(p) ? '; the curves differ (' : '; the curves show no evidence of differing (',
      `${inSentence(test.replace(/ \(.*\)/, '').replace(/ test$/, ''))} `,
      P(p),
      ')',
    )
  const hr = kvBlock(s.result, 'Hazard ratio')
  const ratio = hr?.rows[0]
  const ci = intervalOf(hr?.rows[1]?.value)
  if (ratio && ratio.value.kind === 'number') {
    const m = /^Ratio \((.*)\/(.*)\)$/.exec(ratio.label)
    out.push(
      `. Hazard ratio${m ? ` ${m[1]} vs. ${m[2]}` : ''}: `,
      n3(ratio.value.v),
      ...(ci ? [' (', CI(ci), ')'] : []),
    )
  }
  const pairwise = s.result.sheets.find((x) => x.key === 'pairwise')
  if (pairwise) {
    const pt = pairwise.blocks.find((b) => b.type === 'table') as Table | undefined
    const jP = pt ? pt.columns.findIndex((c) => /^Adjusted P/i.test(c)) : -1
    if (pt && jP >= 0) {
      const differ = pt.rows.filter((r) => numOf(r[jP]) < ALPHA).length
      out.push(
        `. ${differ} of ${pt.rows.length} pairs of curves differ (${pt.title ?? 'adjusted'})`,
      )
    }
  }
  return out.length ? [...out, '.'] : null
}

// --- Describe and check ----------------------------------------------------------------------------

/** Normality: the chosen test (the first table), per data set. */
const normality: Summarize = (s) => {
  const t = s.result.sheets[0]?.blocks.find((b) => b.type === 'table') as Table | undefined
  if (!t?.title) return null
  const test = t.title.replace(/ normality test$/, '').replace(/ test$/, '')
  const names = t.columns.slice(1)
  const ps = names.map((n) => numOf(cell(t, 'P value', n)))
  const against = names.filter((_, i) => ps[i]! < ALPHA)
  const none = names.filter((_, i) => ps[i]! >= ALPHA)
  const out: Parts = []
  if (none.length)
    out.push(
      `No evidence against a normal distribution in ${listed(none.slice(0, 4))}${none.length > 4 ? ` and ${none.length - 4} more` : ''} (${test} `,
      ...pList(ps.filter((p) => p >= ALPHA).slice(0, 4)),
      ')',
    )
  if (against.length)
    out.push(
      `${out.length ? '; evidence' : 'Evidence'} against a normal distribution in ${listed(against.slice(0, 4))} (${test} `,
      ...pList(ps.filter((p) => p < ALPHA).slice(0, 4)),
      ')',
    )
  if (!out.length) return null
  return [...out, '; see the QQ plot.']
}

/** "P = 0.42, 0.31 and 0.77": the first after "P =", the others as numbers. */
const pList = (ps: readonly number[]): Parts =>
  joinParts(
    ps.map((p, i): Parts => (i === 0 ? [P(p)] : [{ value: { kind: 'pvalue', v: p } }])),
    ', ',
    ' and ',
  )

/** Descriptive statistics: mean ± SD (n) per data set. */
const descriptive: Summarize = (s) => {
  const t = s.result.sheets[0]?.blocks.find((b) => b.type === 'table') as Table | undefined
  if (!t) return null
  const names = t.columns.slice(1)
  const unit = unitOf(s, 'y')
  const items = names.slice(0, 4).map((n, i): Parts => {
    const key = s.input[i]?.ref.key
    const mean = numOf(key ? s.result.values[`mean:${key}`] : null)
    const sd = numOf(key ? s.result.values[`sd:${key}`] : null)
    const count0 = numOf(cell(t, 'Number of values', n))
    return [
      `${n} `,
      n3(mean, unit),
      ' ± ',
      n3(sd, unit),
      ...(Number.isFinite(count0) ? [' (n = ', count(count0), ')'] : []),
    ]
  })
  if (!items.length) return null
  return [
    'Mean ± SD: ',
    ...joinParts(items, '; '),
    `${names.length > 4 ? `; ${names.length - 4} more in the table` : ''}.`,
  ]
}

/** ROC: the area, its CI, P against no discrimination. */
const roc: Summarize = (s) => {
  const auc = numOf(s.result.values.auc)
  const p = numOf(s.result.values.p)
  if (Number.isNaN(auc)) return null
  const ci = intervalOf(
    row(s.result, { block: 'Area under the ROC curve', label: '95% CI' }) ??
      kvBlock(s.result, 'Area under the ROC curve')?.rows.find((r) => r.value.kind === 'interval')
        ?.value,
  )
  return [
    'The area under the ROC curve is ',
    n3(auc),
    ...(ci ? [' (', CI(ci), ')'] : []),
    '; ',
    P(p),
    ' against 0.5 (no discrimination). ',
    count(numOf(row(s.result, { label: 'Number of controls' }))),
    ' controls and ',
    count(numOf(row(s.result, { label: 'Number of patients' }))),
    ' patients.',
  ]
}

/** Bland-Altman: the bias and the limits of agreement. */
const blandAltman: Summarize = (s) => {
  const bias = numOf(s.result.values.bias)
  if (Number.isNaN(bias)) return null
  const compared = row(s.result, { key: 'compared' })
  const biasCi = intervalOf(
    kvBlock(s.result, 'Bias')?.rows.find((r) => r.value.kind === 'interval')?.value,
  )
  const lo = numOf(row(s.result, { label: 'From' }))
  const hi = numOf(row(s.result, { label: 'To' }))
  const level = biasCi?.level ?? 0.95
  return [
    compared?.kind === 'text' ? `${compared.v}: bias ` : 'Bias ',
    n3(bias),
    ...(biasCi ? [' (', CI(biasCi), ')'] : []),
    `; ${+(level * 100).toFixed(2)}% limits of agreement `,
    n3(lo),
    ' to ',
    n3(hi),
    '; ',
    count(numOf(row(s.result, { key: 'pairs' }))),
    ' pairs.',
  ]
}

/** Regression models of variables: the model's test and the predictors below 0.05. */
const models: Summarize = (s) => {
  const t = s.result.sheets[0]?.blocks.find((b) => b.type === 'table') as Table | undefined
  if (!t) return null
  const jP = t.columns.indexOf('P value')
  const p = numOf(s.result.values.p)
  if (jP < 0) return null
  const ratioCol = t.columns.findIndex((c) => /^(Hazard ratio|Odds ratio|Rate ratio)$/.test(c))
  const preds = t.rows
    .map((r) => ({
      name: r[0]?.kind === 'text' ? r[0].v : '',
      p: numOf(r[jP]),
      v: numOf(r[ratioCol >= 0 ? ratioCol : 1]),
    }))
    .filter((r) => r.name && r.name !== 'Intercept' && Number.isFinite(r.p))
  const below = preds.filter((r) => sig(r.p))
  const what = ratioCol >= 0 ? t.columns[ratioCol]!.toLowerCase() : 'estimate'
  return [
    ...(Number.isNaN(p)
      ? []
      : [
          sig(p)
            ? 'The model explains the outcome better than none ('
            : 'No evidence the model explains the outcome better than none (',
          P(p),
          '). ',
        ]),
    `${below.length} of ${preds.length} terms have P < ${ALPHA}`,
    ...(below.length
      ? [
          ': ',
          ...joinParts(
            below.slice(0, 4).map((r) => [`${r.name} (${what} `, n3(r.v), ', ', P(r.p), ')']),
            '; ',
          ),
        ]
      : []),
    '.',
  ]
}

/** Monte Carlo: the fraction of hits. */
const monteCarlo: Summarize = (s) => {
  const hits = numOf(s.result.values.hits)
  const frac = numOf(s.result.values.hitFraction)
  if (Number.isNaN(hits)) return null
  const t = tableBlock(s.result, 'Fraction of hits')
  const ci = t ? intervalOf(t.rows[0]?.[2]) : null
  return [
    count(hits),
    ' simulations were hits (',
    n3(100 * frac),
    '%',
    ...(ci ? ['; ', CI({ lo: 100 * ci.lo, hi: 100 * ci.hi, level: ci.level }, '%')] : []),
    `)${t?.title ? `: ${lower1(t.title.replace(/^Fraction of hits /, ''))}` : ''}.`,
  ]
}

/** Power analysis: the sample size and the power it gives. */
const power: Summarize = (s) => {
  const n = numOf(s.result.values.n)
  const pw = numOf(s.result.values.power)
  if (Number.isNaN(n) || Number.isNaN(pw)) return null
  return [
    count(n),
    ' per group gives ',
    n3(100 * pw),
    '% power for the planned analysis (see the inputs).',
  ]
}

/** Identify outliers: how many were found. */
const outliers: Summarize = (s) => {
  const n = numOf(s.result.values.outliers)
  if (Number.isNaN(n)) return null
  return [
    n === 0
      ? 'No outliers were found.'
      : `${n} ${n === 1 ? 'value was' : 'values were'} identified as outliers.`,
  ]
}

/** PCA: the components retained and the variance they explain. */
const pca: Summarize = (s) => {
  const t = tableBlock(s.result, 'Eigenvalues')
  const k = numOf(s.result.values.selected)
  if (!t || Number.isNaN(k) || k < 1) return null
  const j = t.columns.indexOf('Cumulative proportion')
  const cum = j >= 0 ? numOf(t.rows[k - 1]?.[j]) : Number.NaN
  return [
    count(k),
    ` component${k === 1 ? '' : 's'} retained`,
    ...(Number.isFinite(cum) ? [', explaining ', n3(100 * cum), '% of the variance'] : []),
    '.',
  ]
}

/** Goodness of fit: each data set's counts against the expected. */
const goodnessOfFit: Summarize = (s) => {
  const items = s.input.slice(0, 4).flatMap((d): Parts[] => {
    const p =
      row(s.result, { block: `Chi-square goodness of fit, ${d.title}`, label: 'P value' }) ??
      row(s.result, { block: 'Chi-square goodness of fit', label: 'P value' })
    if (p?.kind !== 'pvalue') return []
    return [
      [
        sig(p.v)
          ? `${d.title} differs from the expected (`
          : `${d.title} shows no evidence of differing from the expected (`,
        P(p.v),
        ')',
      ],
    ]
  })
  if (!items.length) return null
  return [...joinParts(items, '; '), ' (chi-square goodness of fit).']
}

/** Any other analysis with a P and a named test: one line. */
export const generic: Summarize = (s) => {
  const p = s.result.values.p
  const t = s.result.values.test
  if (p?.kind !== 'pvalue' || t?.kind !== 'text') return null
  return [`${t.v}: `, P(p.v), '.']
}

/** Trailing spaces trimmed off the last text part. */
function trim(parts: Parts): Parts {
  const out = [...parts]
  const last = out[out.length - 1]
  if (typeof last === 'string') out[out.length - 1] = last.trimEnd()
  return out
}

/** The summary of each analysis (absent: none — tools, simulations and drawings answer nothing). */
export const SUMMARIES: Readonly<Record<string, Summarize>> = {
  ttest: tTest,
  mannWhitney,
  wilcoxon,
  kolmogorovSmirnov,
  oneSample,
  oneWayAnova: oneWay,
  friedman: oneWay,
  nestedOneWay: oneWay,
  nestedT,
  twoWayAnova: twoWay,
  threeWayAnova: effects,
  multifactorAnova: effects,
  multipleT,
  multipleOneWay,
  correlation,
  linearRegression: regression,
  deming: regression,
  nonlinearFit: nonlinear,
  nonlinearFitMV: nonlinear,
  contingency,
  survival,
  survivalFromVariables: survival,
  normality,
  descriptive,
  roc,
  blandAltman,
  multipleRegression: models,
  logisticRegression: models,
  poissonRegression: models,
  coxRegression: models,
  monteCarlo,
  powerAnalysis: power,
  identifyOutliers: outliers,
  pca,
  goodnessOfFit,
  simpleLogistic: generic,
  pStack: generic,
}
