import type { ResultValue, SummaryPart } from '@ps/model'
import {
  ALPHA,
  CI,
  type ComparisonRow,
  cell,
  comparisonRows,
  comparisonsTable,
  computedCi,
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
  sharedSide,
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

/**
 * Audit 4 S6: three-valued — P below the threshold, not below it, or not computed (NaN). A P
 * that wasn't computed is never "no evidence of a difference".
 */
type Verdict = 'yes' | 'no' | 'na'
const sig = (p: number): Verdict => (!Number.isFinite(p) ? 'na' : p < ALPHA ? 'yes' : 'no')
/** The direction of an effect in words; null when it has none (0) or wasn't computed (NaN). */
const higher = (d: number): 'higher' | 'lower' | null => (d > 0 ? 'higher' : d < 0 ? 'lower' : null)
const isSig = (p: number) => sig(p) === 'yes'
const NO_P = 'P could not be computed'
/** "P = 0.003", or "P could not be computed". */
const pOr = (p: number): Parts => (Number.isFinite(p) ? [P(p)] : [NO_P])
const testName = (s: SummaryInput, fallback: string): string => {
  const t = s.result.values.test
  return t?.kind === 'text' ? t.v : fallback
}
const lower1 = (t: string) => t.charAt(0).toLowerCase() + t.slice(1)
/** Tests named after people keep their capital mid-sentence; "Paired t test" reads "paired t test". */
const PROPER =
  /^(Mann|Wilcoxon|Kolmogorov|Kruskal|Friedman|Fisher|Pearson|Spearman|Welch|Student|Dunnett|Tukey|Dunn|Gehan|Bonferroni|Šidák|Holm|Brown|Bartlett|Shapiro|Anderson|D’Agostino|Games|Tamhane|Newman)/
const inSentence = (t: string) => (PROPER.test(t) ? t : lower1(t))

/**
 * ", one-tailed (predicted: Treated higher than Control)" when one-tailed: the result's
 * Predicted direction row, else `words` ([increase, decrease]) for the analyses without one.
 */
function tailWords(s: SummaryInput, words?: readonly [string, string]): string {
  if (s.params.tails !== 'one') return ''
  const said = row(s.result, { label: 'Predicted direction' })
  if (said?.kind === 'text') return `, one-tailed (predicted: ${said.v})`
  const w =
    s.params.predicted === 'increase'
      ? words?.[0]
      : s.params.predicted === 'decrease'
        ? words?.[1]
        : undefined
  return w ? `, one-tailed (predicted: ${w})` : ', one-tailed'
}

/** A one-tailed effect that went the other way to the direction predicted. */
const againstPrediction = (s: SummaryInput, effect: number) =>
  s.params.tails === 'one' &&
  ((s.params.predicted === 'increase' && effect < 0) ||
    (s.params.predicted === 'decrease' && effect > 0))

/**
 * Audit 4 S7: the unpaired t test's words for a one-tailed result that went the other way, for
 * every analysis with a predicted direction: ", the opposite way to the prediction (predicted:
 * …); one-tailed P = 0.99, {test}".
 */
const opposite = (p: number, test: string, tail: string): Parts => [
  `, the opposite way to the prediction${tail.replace(/^, one-tailed/, '')}; one-tailed `,
  ...pOr(p),
  `, ${test}`,
]

/**
 * The end of a sentence after its effect, by the verdict: "; P = 0.003, {test}{tail}", "; no
 * evidence of a difference (P = 0.4, {test}{tail})", "; P could not be computed ({test}{tail})",
 * or the opposite way to the prediction (S7).
 */
function verdictEnd(
  p: number,
  test: string,
  tail: string,
  against: boolean,
  noEvidence = 'no evidence of a difference',
): Parts {
  if (against) return opposite(p, test, tail)
  const v = sig(p)
  if (v === 'na') return [`; ${NO_P} (${test}${tail})`]
  if (v === 'no') return [`; ${noEvidence} (`, P(p), `, ${test}${tail})`]
  return ['; ', P(p), `, ${test}${tail}`]
}

/** The CI's parts in parentheses-less form ("95% CI 1 to 2"), none when it wasn't computed. */
const ciIn = (ci: { lo: number; hi: number; level: number } | null, unit?: string): Parts => {
  const c = computedCi(ci)
  return c ? [CI(c, unit)] : []
}

// --- Two groups -----------------------------------------------------------------------------------

/** " (…)" around parts, nothing when there are none. */
const paren = (parts: Parts): Parts => (parts.length ? [' (', ...parts, ')'] : [])

/** An interval oriented for a difference read the other way (−hi to −lo), kept when null. */
const flipped = (ci: { lo: number; hi: number; level: number } | null) => (ci ? negated(ci) : null)

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
  const d = est.value
  const level = intervalOf(row(s.result, { key: 'ci' }))?.level ?? 0.95
  const ci = computedCi({ lo: est.lo, hi: est.hi, level })
  const unit = unitOf(s, 'y')
  const tail = tailWords(s)
  const ratio = s.params.design === 'paired' && row(s.result, { key: 'ratio' }) !== null
  if (!Number.isFinite(d))
    return [
      `The ${ratio ? `ratio ${b} / ${a}` : `difference ${b} − ${a}`} could not be computed (${test}${tail}).`,
    ]
  if (s.params.design === 'paired') {
    const pairs = numOf(row(s.result, { key: 'pairs' }))
    if (ratio) {
      const ratioCi = intervalOf(row(s.result, { key: 'ratioCi' }))
      return [
        `${b} is `,
        n3(d),
        ` times ${a} on average (geometric mean ratio${ratioCi ? ', ' : ''}`,
        ...(ratioCi ? [CI(ratioCi)] : []),
        ') across ',
        count(pairs),
        ' pairs',
        ...verdictEnd(p, test, tail, againstPrediction(s, d - 1)),
        '.',
      ]
    }
    const dir = higher(d)
    const against = againstPrediction(s, d)
    if (sig(p) === 'yes' && dir && !against)
      return [
        `${b} is ${dir} than ${a} by `,
        n3(Math.abs(d), unit),
        ' on average across ',
        count(pairs),
        ' pairs',
        ...paren(ciIn(d >= 0 ? ci : flipped(ci), unit)),
        ...verdictEnd(p, test, tail, false),
        '.',
      ]
    return [
      `${b} − ${a} averages `,
      n3(d, unit),
      ' across ',
      count(pairs),
      ' pairs',
      ...paren(ciIn(ci, unit)),
      ...verdictEnd(p, test, tail, against),
      '.',
    ]
  }
  const n = [numOf(row(s.result, { key: 'nA' })), numOf(row(s.result, { key: 'nB' }))]
  const against = againstPrediction(s, d)
  const dir = higher(d)
  const head: Parts =
    sig(p) === 'yes' && dir && !against
      ? [
          `${b} is ${dir} than ${a} by `,
          n3(Math.abs(d), unit),
          ...paren(ciIn(d >= 0 ? ci : flipped(ci), unit)),
        ]
      : [
          `${b} and ${a} differ by `,
          n3(d, unit),
          ` (${b} − ${a}`,
          ...ciIn(ci, unit).flatMap((x) => [', ', x]),
          ')',
        ]
  return [...head, ...verdictEnd(p, test, tail, against), '. ', ...sizes(n), '.']
}

/**
 * Mann-Whitney: values in B tend to be higher than in A (the Hodges-Lehmann shift). Without a
 * shift (S6: tied values can leave it uncomputed) the direction is the medians'.
 */
const mannWhitney: Summarize = (s) => {
  const [A, B] = s.input
  const c = s.result.comparisons[0]
  if (!A || !B || !c?.estimate) return null
  const [a, b] = [A.title, B.title]
  const est = c.estimate
  const level = intervalOf(row(s.result, { key: 'ci' }))?.level ?? 0.95
  const ci = computedCi({ lo: est.lo, hi: est.hi, level })
  const mA = numOf(row(s.result, { key: 'medianA' }))
  const mB = numOf(row(s.result, { key: 'medianB' }))
  const medians: Parts = [
    ' Medians ',
    n3(mA),
    ` (${a}) and `,
    n3(mB),
    ` (${b}); `,
    ...sizes([numOf(row(s.result, { key: 'nA' })), numOf(row(s.result, { key: 'nB' }))]),
    '.',
  ]
  const tail = tailWords(s)
  const test = 'Mann-Whitney test'
  const shifted = Number.isFinite(est.value)
  const effect = shifted ? est.value : mB - mA
  const shift: Parts = shifted
    ? [`shift ${b} − ${a} `, n3(est.value), ...ciIn(ci).flatMap((x) => [', ', x])]
    : []
  const against = againstPrediction(s, effect)
  const dir = higher(effect)
  const v = sig(c.p)
  if (against)
    return [
      `Values in ${b} and ${a} differ`,
      ...paren(shift),
      ...opposite(c.p, test, tail),
      '.',
      ...medians,
    ]
  if (v === 'na')
    return [
      shifted
        ? `The shift ${b} − ${a} is `
        : `Values in ${b} against ${a}: ${NO_P} (${test}${tail}).`,
      ...(shifted ? [n3(est.value), ...paren(ciIn(ci)), `; ${NO_P} (${test}${tail}).`] : []),
      ...medians,
    ]
  if (v === 'no' || !dir)
    return [
      `No evidence that values in ${b} and ${a} tend to differ (`,
      ...shift,
      ...(shift.length ? ['; '] : []),
      P(c.p),
      `, ${test}${tail}).`,
      ...medians,
    ]
  return [
    `Values in ${b} tend to be ${dir} than in ${a}`,
    ...paren(shift),
    '; ',
    P(c.p),
    `, ${test}${tail}.`,
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
  const ci = computedCi({ lo: est.lo, hi: est.hi, level })
  const pairs = numOf(row(s.result, { key: 'pairs' }))
  const tail = tailWords(s)
  const test = 'Wilcoxon matched-pairs test'
  const median: Parts = Number.isFinite(est.value)
    ? [`median difference ${b} − ${a} `, n3(est.value), ...ciIn(ci).flatMap((x) => [', ', x])]
    : []
  const against = againstPrediction(s, est.value)
  const dir = higher(est.value)
  const v = sig(c.p)
  const n: Parts = [', ', count(pairs), ' pairs.']
  if (against)
    return [
      `Within pairs, ${b} and ${a} differ`,
      ...paren(median),
      ...opposite(c.p, test, tail),
      ...n,
    ]
  if (v === 'na')
    return [`Within pairs, ${b} against ${a}`, ...paren(median), `: ${NO_P} (${test}${tail})`, ...n]
  const head =
    v === 'yes'
      ? dir
        ? `Within pairs, ${b} tends to be ${dir} than ${a}`
        : `Within pairs, ${b} and ${a} tend to differ`
      : `Within pairs, no evidence that ${b} and ${a} tend to differ`
  return [head, ...paren(median), '; ', P(c.p), `, ${test}${tail}`, ...n]
}

/** Kolmogorov-Smirnov: the distributions differ, or no evidence. */
const kolmogorovSmirnov: Summarize = (s) => {
  const [A, B] = s.input
  const p = numOf(s.result.values.p)
  if (!A || !B || Number.isNaN(p)) return null
  return [
    sig(p) === 'yes'
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
  const hText = Number.isFinite(h) ? `${+h.toPrecision(3)}` : 'the hypothetical value'
  // S7: the one-tailed prediction in words (this result has no Predicted direction row).
  const tail = tailWords(s, [`above ${hText}`, `below ${hText}`])
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
    const dir = d > 0 ? 'above' : d < 0 ? 'below' : null
    const head: Parts = [`the ${what} of ${name}, `, n3(center, unit)]
    if (againstPrediction(s, d))
      return [
        ...head,
        ', differs from ',
        n3(h, unit),
        ' by ',
        n3(d, unit),
        ...paren(ciIn(ci, unit)),
        ', the opposite way to the prediction; one-tailed ',
        ...pOr(p),
      ]
    const v = sig(p)
    if (v === 'na') return [...head, ', against ', n3(h, unit), `: ${NO_P}`]
    if (v === 'yes' && dir)
      return [
        ...head,
        `, is ${dir} `,
        n3(h, unit),
        ' by ',
        n3(Math.abs(d), unit),
        ...paren(ciIn(d >= 0 ? ci : flipped(ci), unit)),
        '; ',
        P(p),
      ]
    return [
      ...head,
      ', shows no evidence of differing from ',
      n3(h, unit),
      ' (difference ',
      n3(d, unit),
      ...ciIn(ci, unit).flatMap((x) => [' (', x, ')']),
      ', ',
      P(p),
      ')',
    ]
  })
  const more = main.columns.length - 1 - items.length
  const parts = joinParts(items, '; ')
  const first = parts[0]
  if (typeof first === 'string') parts[0] = first.charAt(0).toUpperCase() + first.slice(1)
  return [
    ...parts,
    `${more > 0 ? `; ${more} more in the table` : ''} (${t ? 'Wilcoxon signed-rank test' : 'one-sample t test'}${tail}).`,
  ]
}

// --- Several groups -------------------------------------------------------------------------------

/** The adjusted P of a comparison: "adjusted P = 0.007" or "q = 0.01". */
const adjusted = (r: ComparisonRow): Parts =>
  !Number.isFinite(r.p)
    ? [`${r.q ? 'q value' : 'adjusted P'} could not be computed`]
    : r.q
      ? [{ value: { kind: 'pvalue', v: r.p }, role: 'q' }]
      : ['adjusted ', P(r.p)]

/** The groups' medians a rank test's comparisons name (its Data summary's Median row). */
type Medians = ReadonlyMap<string, number>

/** The Median row of a result's Data summary, by group title (empty when it has none). */
function mediansOf(s: SummaryInput): Medians {
  const t = tableBlock(s.result, 'Data summary')
  const out = new Map<string, number>()
  const r = t?.rows.find((x) => x[0]?.kind === 'text' && x[0].v === 'Median')
  if (t && r) for (let j = 1; j < t.columns.length; j++) out.set(t.columns[j]!, numOf(r[j]))
  return out
}

/**
 * Audit 4 S1 (Q3): a rank comparison says which group is higher and gives the medians — never
 * the mean-rank or rank-sum difference, which isn't a difference of the data: "(medians 20.1
 * and 10.1, adjusted P = 0.0096)", or without medians "(adjusted P = 0.0096)".
 */
function rankParts(
  r: ComparisonRow,
  names: readonly string[],
  medians: Medians,
  unit: string | undefined,
  word = 'medians',
  sep = ' and ',
): Parts {
  const ms = names.map((n) => medians.get(n) ?? Number.NaN)
  if (!ms.every(Number.isFinite)) return ['(', ...adjusted(r), ')']
  return [
    `(${word} `,
    ...joinParts(
      ms.map((m) => [n3(m, unit)]),
      sep,
    ),
    ', ',
    ...adjusted(r),
    ')',
  ]
}

/** One comparison against the control, oriented group − control. */
function vsControlItem(
  r: ComparisonRow,
  control: string,
  unit?: string,
  medians: Medians = new Map(),
): Parts {
  const flip = r.left === control
  const group = flip ? r.right : r.left
  const d = flip ? -r.diff : r.diff
  const ci = r.ci ? (flip ? negated(r.ci) : r.ci) : null
  const finite = Number.isFinite(d)
  if (!finite) return [`${group} (`, ...adjusted(r), ')']
  if (r.rank) {
    const values = rankParts(r, [group, control], medians, unit, 'median', ' vs. ')
    return isSig(r.p) && d !== 0
      ? [`${group} is ${higher(d)} `, ...values]
      : [`${group} shows no evidence of a difference `, ...values]
  }
  if (isSig(r.p))
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
function pairItem(r: ComparisonRow, unit?: string, medians: Medians = new Map()): Parts {
  const within = r.within ? `${r.within}: ` : ''
  if (!Number.isFinite(r.diff)) return [`${within}${r.left} vs. ${r.right} (`, ...adjusted(r), ')']
  const [hi, lo] = r.diff >= 0 ? [r.left, r.right] : [r.right, r.left]
  if (r.rank)
    return [`${within}${hi} is higher than ${lo} `, ...rankParts(r, [hi, lo], medians, unit)]
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
  const medians = mediansOf(s)
  if (
    controlName &&
    rows.every((r) => !r.within && (r.left === controlName || r.right === controlName))
  ) {
    const shown = rows.slice(0, 4).map((r) => vsControlItem(r, controlName, unit, medians))
    return [
      `Compared with ${controlName}, `,
      ...joinParts(shown, '; ', '; and '),
      `${m > shown.length ? `; ${m - shown.length} more in the table` : ''}; ${method} for ${m} comparison${m === 1 ? '' : 's'}. `,
    ]
  }
  const differ = rows.filter((r) => isSig(r.p))
  const largest = [...differ].sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff) || x.p - y.p)
  const shown = largest.slice(0, 3).map((r) => pairItem(r, unit, medians))
  const pairsWord = m === 1 ? 'comparison' : 'comparisons'
  if (!differ.length) {
    const ps = rows.map((r) => r.p).filter(Number.isFinite)
    if (!ps.length)
      return [
        `${m === 1 ? 'The comparison’s adjusted P' : `The ${m} comparisons’ adjusted P values`} could not be computed (${method}). `,
      ]
    const smallest = Math.min(...ps)
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

/**
 * The control's title: the side every row shares (audit 4 S3: a two-way table's rows are compared
 * with a row or a cell, not the params' data set), else the params' control data set, else the
 * first.
 */
function controlTitle(s: SummaryInput, rows: readonly ComparisonRow[]): string | null {
  const key = typeof s.params.control === 'string' ? s.params.control : ''
  const named = s.input.find((d) => d.ref.key === key)?.title
  return sharedSide(rows, named) ?? named ?? s.input[0]?.title ?? null
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
  const v = sig(p)
  const overall: Parts =
    v === 'na'
      ? [`The ${inSentence(test)}’s ${NO_P}. `]
      : nonparametric
        ? [
            v === 'yes'
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
              v === 'yes'
                ? `Within subjects, the mean changes across the ${k} groups (`
                : `Within subjects, no evidence that the mean changes across the ${k} groups (`,
              `${inSentence(test)}, `,
              P(p),
              ...subjectsParts(s),
              '). ',
            ]
          : [
              v === 'yes'
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
  if (sig(t.v) === 'na') return [`The test for a linear trend’s ${NO_P}. `]
  return [
    isSig(t.v)
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
  // Audit 4 S13: what describes the interaction follows the comparisons chosen.
  const describedBy =
    s.params.comparisons === 'withinRows'
      ? `the comparisons within each level of ${rowF} describe it`
      : s.params.comparisons === 'withinColumns'
        ? `the comparisons within each level of ${col} describe it`
        : s.params.comparisons === 'allCells'
          ? 'the comparisons between the cells describe it'
          : s.params.comparisons === 'mainColumns' || s.params.comparisons === 'mainRows'
            ? `the main-effect comparisons average over it; comparisons within each level of ${rowF} would describe it`
            : `comparisons within each level of ${rowF} would describe it`
  const head: Parts = isSig(pi)
    ? [
        `The effect of ${col} depends on ${rowF} (interaction `,
        P(pi),
        `, ${test}); ${describedBy}. `,
      ]
    : [
        `${cap(col)}: `,
        ...pOr(pc),
        `; ${cap(rowF).replace(/^Row factor$/, 'row factor')}: `,
        ...pOr(pr),
        ...(Number.isNaN(pi)
          ? ['. ']
          : ['; no evidence that one changes the effect of the other (interaction ', P(pi), '). ']),
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
  const below = rows.filter((r) => isSig(r.p))
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
  const tail = tailWords(s)
  const against = againstPrediction(s, d)
  const dir = higher(d)
  if (isSig(p) && dir && !against)
    return [
      `${b} is ${dir} than ${a} by `,
      n3(Math.abs(d), unit),
      ...paren(ciIn(d >= 0 ? ci : flipped(ci), unit)),
      ...verdictEnd(p, 'nested t test', tail, false),
      '.',
    ]
  return [
    `${b} and ${a} differ by `,
    n3(d, unit),
    ...(ci ? [` (${b} − ${a}, `, CI(ci, unit), ')'] : []),
    ...verdictEnd(p, 'nested t test', tail, against),
    '.',
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
  const alpha = typeof s.params.alpha === 'number' ? s.params.alpha : ALPHA
  // Audit 4 S13: without a correction, the rows below α — not "after correction".
  const what = fdr
    ? `discoveries at a false discovery rate of ${q}%${family?.kind === 'text' ? ` (${lower1(family.v)})` : ''}`
    : s.params.approach === 'none'
      ? `below the threshold (P < ${+alpha.toPrecision(12)}, not corrected for the ${tests} rows)`
      : `below the threshold after correction${family?.kind === 'text' ? ` (${lower1(family.v)})` : ''}`
  return [
    count(flagged),
    ` of `,
    count(tests),
    ` rows are ${what}, comparing ${diff} by ${test?.kind === 'text' ? inSentence(test.v.replace(/ \(.*\)$/, '')) : 'a t test'} in each row.`,
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
  // Audit 4 S2: the P values corrected across the pairs, by the correction chosen (q values or
  // Holm's), decide which pairs correlate — as the table's Significant column does.
  const adjCol = t.columns.find((c) => c.startsWith('q value') || c.startsWith('Holm-adjusted'))
  const name = spearman ? 'Spearman correlation' : 'Pearson correlation'
  const pairs = t.rows.map((r) => {
    const label = r[0]?.kind === 'text' ? r[0].v : ''
    const get = (c: string | undefined) => (c ? r[t.columns.indexOf(c)] : undefined)
    return {
      label,
      r: numOf(get(rCol)),
      p: numOf(get(pCol)),
      adj: adjCol ? numOf(get(adjCol)) : Number.NaN,
      ci: intervalOf(get(ciCol)),
      n: numOf(get(nCol)),
    }
  })
  if (pairs.length === 1) {
    const x = pairs[0]!
    const [X, Y] = x.label.split(' vs. ')
    const both = X && Y ? `${X} and ${Y}` : x.label
    if (!Number.isFinite(x.r)) return [`r of ${both} could not be computed (${name}).`]
    // S7: the one-tailed prediction, and a result against it, in the unpaired t test's words.
    const tail = tailWords(s, ['a positive correlation', 'a negative correlation'])
    const against = againstPrediction(s, x.r)
    const v = sig(x.p)
    const how =
      v === 'yes' && !against
        ? x.r > 0
          ? ' rise together'
          : x.r < 0
            ? ' move in opposite directions'
            : ''
        : ''
    const stats: Parts = [
      `${both}${how}: r = `,
      n3(x.r),
      ...paren(ciIn(x.ci)),
      ', ',
      count(x.n),
      ' pairs',
    ]
    if (against || v === 'na') return [...stats, ...verdictEnd(x.p, name, tail, against), '.']
    return [
      ...stats,
      `; ${v === 'yes' ? '' : 'no evidence of a correlation, '}`,
      P(x.p),
      `, ${name}${tail}.`,
    ]
  }
  const fam = pairs.filter((x) => isSig(adjCol ? x.adj : x.p))
  const strongest = [...fam].sort((a, b) => Math.abs(b.r) - Math.abs(a.r)).slice(0, 3)
  const n = pairs.length
  const rule = !adjCol
    ? `P < ${ALPHA}, not corrected for the ${n} pairs`
    : adjCol.startsWith('q value')
      ? `q < ${ALPHA}, corrected for the ${n} pairs`
      : `Holm-adjusted P < ${ALPHA}, corrected for the ${n} pairs`
  return [
    `${fam.length} of ${n} pairs correlate (${rule}; ${name})`,
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

/** "The slopes differ (P = …)", "… show no evidence of differing (…)" or "… could not be compared". */
function linesCompared(p: number, what: string, how = ''): Parts {
  const v = sig(p)
  if (v === 'na') return [`${what}${how} could not be compared (${NO_P})`]
  return [
    v === 'yes' ? `${what}${how} differ (` : `${what}${how} show no evidence of differing (`,
    P(p),
    ')',
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
    // S6: a slope that wasn't computed is neither rising nor falling.
    if (!Number.isFinite(slope)) return [`The slope of ${name} could not be computed`]
    const ci = intervalOf(cell(cis, 'Slope', name))
    const p = numOf(cell(nonZero, 'P value', name))
    const r2 = numOf(cell(fit, 'R squared', name))
    const moves = slope > 0 ? 'rises' : slope < 0 ? 'falls' : null
    return [
      ...(moves
        ? [`${name} ${moves} by `, n3(Math.abs(slope), unit), ` per unit of ${xName}`]
        : [`${name} has a slope of 0 per unit of ${xName}`]),
      ...paren(ciIn(slope >= 0 ? ci : flipped(ci), unit)),
      ...(Number.isFinite(r2) ? ['; R² = ', n3(r2)] : []),
      ...(Number.isFinite(p)
        ? isSig(p)
          ? ['; the slope differs from zero (', P(p), ')']
          : ['; no evidence the slope differs from zero (', P(p), ')']
        : []),
    ]
  })
  const out: Parts = [...joinParts(items, '. '), '. ']
  const slopes = row(s.result, { block: 'Are the slopes equal?', label: 'P value' })
  const elev = row(s.result, { block: 'Are the elevations or intercepts equal?', label: 'P value' })
  if (slopes?.kind === 'pvalue') {
    out.push(...linesCompared(slopes.v, 'The slopes'))
    if (elev?.kind === 'pvalue')
      out.push(
        '; ',
        ...linesCompared(elev.v, 'the intercepts', ', compared assuming a common slope,'),
      )
    out.push('. ')
  }
  return trim(out)
}

/** The value of a parameter held constant: its best-fit cell reads "= 100". */
const constantOf = (v: ResultValue | null): number => {
  const m = v?.kind === 'text' ? /^= (.+)$/.exec(v.v) : null
  return m ? Number(m[1]) : Number.NaN
}
const isConstant = (v: ResultValue | null) => Number.isFinite(constantOf(v))

/**
 * Audit 4 S11: a best-fit value in a sentence — the number, or a constant's value marked "(constant)"
 * (its cell is text, which read as a number gave "—").
 */
function paramParts(v: ResultValue | null, unit?: string): Parts {
  const c = constantOf(v)
  return Number.isFinite(c) ? [n3(c, unit), ' (constant)'] : [n3(numOf(v), unit)]
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
      const logCi = logLabel ? intervalOf(cell(ciTable, logLabel, n)) : null
      const ci = !logLabel ? intervalOf(cell(ciTable, ec, n)) : null
      // Audit 4 S9: a profile CI unbounded on both sides says the data don't determine it.
      const unbounded = (c: { lo: number; hi: number } | null) =>
        c !== null && c.lo === Number.NEGATIVE_INFINITY && c.hi === Number.POSITIVE_INFINITY
      return [
        ...paramParts(cell(best, ec, n), unit),
        ...(unbounded(logCi ?? ci)
          ? [` (its CI is unbounded: the data don’t determine ${logCi ? `log ${ec}` : ec})`]
          : logCi
            ? [` (log ${ec} `, CI(logCi), ')']
            : ci
              ? [' (', CI(ci, unit), ')']
              : []),
        ` for ${n}`,
      ]
    })
    out.push(`${ec} = `, ...joinParts(items, '; '))
    const hill = labels.find((l) => l === 'HillSlope')
    if (hill && ok.length)
      out.push(
        '; Hill slope ',
        ...joinParts(
          ok.slice(0, 4).map((n) => paramParts(cell(best, hill, n))),
          ', ',
          ok.length > 1 ? ' and ' : '',
        ),
      )
    out.push(`${ok.length > 4 ? `; ${ok.length - 4} more in the table` : ''}. `)
  } else if (ok.length) {
    const used = (l: string) =>
      ok.some((n) => cell(best, l, n)?.kind !== 'text' || isConstant(cell(best, l, n)))
    const shown = labels.filter((l) => l && used(l)).slice(0, 3)
    const items = ok.slice(0, 3).map(
      (n): Parts => [
        `${n}: `,
        ...joinParts(
          shown.map((l) => [`${l} = `, ...paramParts(cell(best, l, n))]),
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
    // Audit 4 S5: a fit that failed, or a statistic that isn't defined, decides nothing.
    if (x.name === '—')
      out.push(
        `The models could not be compared${many ? ` for ${x.title}` : ''} (see the warnings). `,
      )
    else if (!Number.isNaN(x.p)) out.push(lead, 'extra sum-of-squares F test, ', P(x.p), '). ')
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
        isSig(p)
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
    // S7: the risk in the exposed row minus the other's, the effect a prediction is about.
    const [pe, po] = order.map((i) => numOf(pct.rows[i]![oc + 1]))
    out.push(...verdictEnd(p, inSentence(test), tailWords(s), againstPrediction(s, pe! - po!)), '.')
  } else {
    out.push(
      isSig(p)
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
  if (trend?.kind === 'pvalue' && Number.isFinite(trend.v))
    out.push(
      isSig(trend.v)
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
      isSig(p) ? '; the curves differ (' : '; the curves show no evidence of differing (',
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
    if (!Number.isFinite(mean)) return [`${n}: no values`]
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
  const below = preds.filter((r) => isSig(r.p))
  const what = ratioCol >= 0 ? t.columns[ratioCol]!.toLowerCase() : 'estimate'
  return [
    ...(Number.isNaN(p)
      ? []
      : [
          isSig(p)
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
    if (sig(p.v) === 'na') return [[`${d.title}: ${NO_P}`]]
    return [
      [
        isSig(p.v)
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
