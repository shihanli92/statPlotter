import type { NormalizedDataSet, SketchContext, SketchPanel, SketchSpec } from '@ps/model'
import { mean, midranks, sd } from '@ps/stats'
import {
  columnTable,
  midrankIn,
  type SketchSet,
  setOf,
  sketchRows,
  summaryTable,
  valuesOf,
  xyTable,
} from './tables.ts'
import { countOf, countsLine, nameList, plain, q, sizesText } from './words.ts'

// Roadmap 51b (design §5.2): the sketch of two groups — the t tests, Mann-Whitney, Wilcoxon,
// Kolmogorov-Smirnov, one sample — showing what the test will look at: the two groups with their
// own or a pooled SD, the pairs joined and their differences, the values as ranks, the
// cumulative curves. Data and structure only (§5.8): no P, CI or effect size.

type Params = Record<string, unknown>

/**
 * The rows drawn (at most `ctx.maxRows`, and SKETCH_MAX_POINTS values over every group), and
 * the sample note when the table is larger.
 */
export function rowsOf(input: readonly NormalizedDataSet[], ctx: SketchContext) {
  const { rows, sampled } = sketchRows(input, ctx.maxRows)
  return { rows, sampled }
}

/** One panel of the chosen groups as they are (a fallback, and too few groups chosen). */
export function dataSketch(
  input: readonly NormalizedDataSet[],
  ctx: SketchContext,
  caption: string,
): SketchSpec {
  const { rows, sampled } = rowsOf(input, ctx)
  const names = input.map((d) => d.title)
  return {
    panels: input.length
      ? [
          {
            id: 'data',
            table: columnTable(
              'data',
              input.map((d) => setOf(d, rows)),
            ),
            preset: 'pointsOnly',
          },
        ]
      : [],
    caption,
    description: input.length
      ? `${input.length} group${input.length === 1 ? '' : 's'} (${nameList(names)}). ${caption}`
      : caption,
    counts: countsLine([`${input.length} chosen`]),
    ...(sampled ? { sampled } : {}),
  }
}

/** "“Treated”’s SD is 3.1 × “Control”’s" (descriptive, §5.2's assumption panel). */
export function sdRatioNote(a: NormalizedDataSet, b: NormalizedDataSet): string | null {
  const sa = a.data.shape === 'replicates' ? sd(valuesOf(a)) : a.data.sd[0]!
  const sb = b.data.shape === 'replicates' ? sd(valuesOf(b)) : b.data.sd[0]!
  if (!(sa > 0) || !(sb > 0)) return null
  const [big, small, bn, sn] = sa >= sb ? [sa, sb, a.title, b.title] : [sb, sa, b.title, a.title]
  return `${q(bn)}’s SD is ${plain(big / small)} × ${q(sn)}’s (a description of the data; it doesn’t choose the test).`
}

/** The groups' mean, SD and N (raw values or the entered summary). */
function summaryOfSet(d: NormalizedDataSet) {
  if (d.data.shape === 'summary')
    return { mean: d.data.mean[0]!, sd: d.data.sd[0]!, n: d.data.n[0]! }
  const v = valuesOf(d)
  return { mean: mean(v), sd: sd(v), n: v.length }
}

const predictedNote = (params: Params, up: string, down: string): string | null =>
  params.tails === 'one'
    ? params.predicted === 'increase'
      ? `Predicted before the experiment: ${up}.`
      : params.predicted === 'decrease'
        ? `Predicted before the experiment: ${down}.`
        : 'One-tailed: say which direction you predicted.'
    : null

/** The pairs of two columns: rows with both values, and how many rows lack a partner. */
function pairsOf(a: NormalizedDataSet, b: NormalizedDataSet, rows: readonly number[]) {
  const xa = a.data.shape === 'replicates' ? a.data.reps[0]! : new Float64Array()
  const xb = b.data.shape === 'replicates' ? b.data.reps[0]! : new Float64Array()
  const both: { r: number; a: number; b: number }[] = []
  let lone = 0
  for (const r of rows) {
    const va = xa[r] ?? Number.NaN
    const vb = xb[r] ?? Number.NaN
    if (Number.isFinite(va) && Number.isFinite(vb)) both.push({ r, a: va, b: vb })
    else if (Number.isFinite(va) || Number.isFinite(vb)) lone++
  }
  return { both, lone }
}

/** The pairs joined (before–after), and a panel of their differences (or ratios) around 0 (1). */
function pairedPanels(
  a: NormalizedDataSet,
  b: NormalizedDataSet,
  rows: readonly number[],
  ratio: boolean,
): { panels: SketchPanel[]; lone: number; n: number } {
  const { both, lone } = pairsOf(a, b, rows)
  const pairsTable = columnTable('pairs', [
    { key: a.ref.key, title: a.title, reps: [both.map((p) => p.a)] },
    { key: b.ref.key, title: b.title, reps: [both.map((p) => p.b)] },
  ])
  const label = ratio ? `${b.title} / ${a.title}` : `${b.title} − ${a.title}`
  const diffs = both.map((p) => (ratio ? (p.a > 0 && p.b > 0 ? p.b / p.a : null) : p.b - p.a))
  return {
    panels: [
      {
        id: 'pairs',
        title: 'Each line is one pair',
        table: pairsTable,
        preset: 'beforeAfter',
        ...(ratio ? { axes: { yLog: true } } : {}),
      },
      {
        id: 'diff',
        title: ratio ? `Ratios ${label}` : `Differences ${label}`,
        table: columnTable('diff', [{ key: 'diff', title: label, reps: [diffs] }]),
        preset: 'pointsMean',
        lines: [{ at: ratio ? 1 : 0 }],
        ...(ratio ? { axes: { yLog: true } } : {}),
      },
    ],
    lone,
    n: both.length,
  }
}

/** The t test (§5.2): Welch's own SDs, Student's pooled SD, the pairs and their differences. */
export function tTestSketch(
  input: readonly NormalizedDataSet[],
  params: Params,
  ctx: SketchContext,
): SketchSpec {
  if (input.length < 2) return dataSketch(input, ctx, 'A t test compares two groups: choose two.')
  const [A, B] = input as [NormalizedDataSet, NormalizedDataSet]
  const { rows, sampled } = rowsOf(input, ctx)
  const notes: string[] = []
  const direction = predictedNote(
    params,
    `${q(B.title)} higher than ${q(A.title)}`,
    `${q(B.title)} lower than ${q(A.title)}`,
  )
  const raw = A.data.shape === 'replicates' && B.data.shape === 'replicates'
  if (params.design === 'paired' && raw) {
    const ratio = (params.paired as { measure?: string } | undefined)?.measure === 'ratio'
    const p = pairedPanels(A, B, rows, ratio)
    if (p.lone)
      notes.push(
        `${p.lone} row${p.lone === 1 ? '' : 's'} without a pair ${p.lone === 1 ? 'is' : 'are'} left out.`,
      )
    if (direction) notes.push(direction)
    const what = ratio
      ? `the ratios ${B.title} / ${A.title}`
      : `the differences ${B.title} − ${A.title}`
    return {
      panels: p.panels,
      caption: `Each line links a subject’s two values: the test looks at ${what}, not at the groups.`,
      description: `${p.n} pairs of ${q(A.title)} and ${q(B.title)}, matched by row; the paired t test analyzes ${what}${ratio ? ' on a log scale' : ''}.`,
      counts: countsLine([
        `${p.n} pairs`,
        'matched',
        ratio ? 'ratio' : 'difference',
        '1 comparison',
      ]),
      notes,
      ...(sampled ? { sampled } : {}),
    }
  }
  const welch = !(params.unpaired as { assumeEqualSD?: boolean } | undefined)?.assumeEqualSD
  const sa = summaryOfSet(A)
  const sb = summaryOfSet(B)
  const ratioNote = sdRatioNote(A, B)
  if (ratioNote) notes.push(ratioNote)
  if (direction) notes.push(direction)
  const bracket = { a: A.ref.key, b: B.ref.key, label: `${B.title} − ${A.title}` }
  let panel: SketchPanel
  if (welch) {
    panel = raw
      ? {
          id: 'data',
          table: columnTable('data', [setOf(A, rows), setOf(B, rows)]),
          preset: 'points',
          brackets: [bracket],
        }
      : {
          id: 'data',
          table: summaryTable('data', [
            { key: A.ref.key, title: A.title, ...sa },
            { key: B.ref.key, title: B.title, ...sb },
          ]),
          preset: 'meanSd',
          brackets: [bracket],
        }
  } else {
    const df = sa.n + sb.n - 2
    const pooled =
      df > 0 ? Math.sqrt(((sa.n - 1) * sa.sd ** 2 + (sb.n - 1) * sb.sd ** 2) / df) : Number.NaN
    panel = {
      id: 'data',
      title: 'Each group with the pooled SD',
      table: summaryTable('data', [
        { key: A.ref.key, title: A.title, mean: sa.mean, sd: pooled, n: sa.n },
        { key: B.ref.key, title: B.title, mean: sb.mean, sd: pooled, n: sb.n },
      ]),
      preset: 'meanSd',
      brackets: [bracket],
    }
  }
  return {
    panels: [panel],
    caption: welch
      ? 'Welch’s t test: each group keeps its own scatter (its SD bars).'
      : 'Student’s t test: both groups share one scatter, the pooled SD (equal bars).',
    description: `Two groups, ${q(A.title)} (${sa.n} values) and ${q(B.title)} (${sb.n} values), not matched; comparing ${B.title} − ${A.title}, ${welch ? 'each with its own SD' : 'with the pooled SD'}.`,
    counts: countsLine([
      '2 groups',
      sizesText([sa.n, sb.n]),
      'not matched',
      welch ? 'own SDs' : 'pooled SD',
      '1 comparison',
    ]),
    notes,
    ...(sampled ? { sampled } : {}),
  }
}

/** Mann-Whitney (§5.2): the values as ranks 1…N on one axis, each group's rank sum. */
export function mannWhitneySketch(
  input: readonly NormalizedDataSet[],
  params: Params,
  ctx: SketchContext,
): SketchSpec {
  if (input.length < 2 || input.some((d) => d.data.shape !== 'replicates'))
    return dataSketch(input, ctx, 'The Mann-Whitney test ranks the raw values of two groups.')
  const [A, B] = input as [NormalizedDataSet, NormalizedDataSet]
  // Audit 4 (P3): every value ranked, the sampled rows' ranks drawn.
  const { rows, sampled } = rowsOf([A, B], ctx)
  const ranked = ranksOf([A, B], rows)
  const notes = [
    `Rank sums: ${q(A.title)} ${plain(ranked.sums[0]!)}, ${q(B.title)} ${plain(ranked.sums[1]!)}.`,
  ]
  const direction = predictedNote(
    params,
    `${q(B.title)} higher than ${q(A.title)}`,
    `${q(B.title)} lower than ${q(A.title)}`,
  )
  if (direction) notes.push(direction)
  return {
    panels: [
      {
        id: 'ranks',
        title: 'Ranks (1 = smallest of all values)',
        table: columnTable('ranks', ranked.sets),
        preset: 'pointsOnly',
        brackets: [{ a: A.ref.key, b: B.ref.key, label: `${B.title} vs ${A.title}` }],
      },
    ],
    caption: 'Every value is replaced by its rank among all the values; ties share a rank.',
    description: `Two groups, ${q(A.title)} and ${q(B.title)}, ranked together from 1 to ${ranked.n}; the test compares where each group's ranks fall.`,
    counts: countsLine(['2 groups', sizesText(ranked.sizes), 'ranks', '1 comparison']),
    notes,
    ...(sampled ? { sampled } : {}),
  }
}

/**
 * Every value's rank among all the groups' values (midranks for ties), by group: each group's
 * size and rank sum over all its values, and the ranks drawn — the values at `rows` (every row
 * by default; audit 4 P3: a sample of a large table's rows).
 */
export function ranksOf(
  groups: readonly NormalizedDataSet[],
  rows?: readonly number[],
): { sets: SketchSet[]; sums: number[]; sizes: number[]; n: number } {
  const values = groups.map(valuesOf)
  let n = 0
  for (const v of values) n += v.length
  const sorted = new Float64Array(n)
  let at = 0
  for (const v of values) {
    sorted.set(v, at)
    at += v.length
  }
  sorted.sort()
  // Each group's values in order, walked along all of them: a rank per value in one pass. Ranks
  // are halves, so the sums are exact in any order.
  const sums = values.map((v) => {
    const own = Float64Array.from(v).sort()
    let s = 0
    let lo = 0
    let hi = 0
    for (let i = 0; i < own.length; i++) {
      const x = own[i]!
      if (i === 0 || x !== own[i - 1]) {
        while (sorted[lo]! < x) lo++
        hi = lo
        while (hi < n && sorted[hi]! <= x) hi++
      }
      s += (lo + hi + 1) / 2
    }
    return s
  })
  const sets = groups.map((g, i): SketchSet => {
    if (!rows)
      return { key: g.ref.key, title: g.title, reps: [values[i]!.map((x) => midrankIn(sorted, x))] }
    const drawn: number[] = []
    for (const a of g.data.shape === 'replicates' ? g.data.reps : [g.data.mean])
      for (const r of rows) {
        const x = a[r]
        if (x !== undefined && Number.isFinite(x)) drawn.push(midrankIn(sorted, x))
      }
    return { key: g.ref.key, title: g.title, reps: [drawn] }
  })
  return { sets, sums, sizes: values.map((v) => v.length), n }
}

/** Wilcoxon (§5.2): the pairs, and the differences ranked by size with their sign. */
export function wilcoxonSketch(
  input: readonly NormalizedDataSet[],
  params: Params,
  ctx: SketchContext,
): SketchSpec {
  if (input.length < 2 || input.some((d) => d.data.shape !== 'replicates'))
    return dataSketch(input, ctx, 'The Wilcoxon test ranks the differences of paired raw values.')
  const [A, B] = input as [NormalizedDataSet, NormalizedDataSet]
  const { rows, sampled } = rowsOf(input, ctx)
  const p = pairedPanels(A, B, rows, false)
  const { both } = pairsOf(A, B, rows)
  const d = both.map((x) => x.b - x.a)
  const pratt = params.zeroHandling === 'pratt'
  const kept = pratt ? d : d.filter((v) => v !== 0)
  const zeros = d.length - d.filter((v) => v !== 0).length
  const { ranks } = midranks(kept.map(Math.abs))
  const signed = kept.map((v, i) => (v === 0 ? 0 : Math.sign(v) * ranks[i]!))
  const notes: string[] = []
  if (p.lone)
    notes.push(
      `${p.lone} row${p.lone === 1 ? '' : 's'} without a pair ${p.lone === 1 ? 'is' : 'are'} left out.`,
    )
  if (zeros)
    notes.push(
      pratt
        ? `${zeros} zero difference${zeros === 1 ? ' is' : 's are'} ranked with the others (Pratt), then set aside.`
        : `${zeros} zero difference${zeros === 1 ? ' is' : 's are'} dropped (Wilcoxon).`,
    )
  const direction = predictedNote(
    params,
    `${q(B.title)} higher than ${q(A.title)}`,
    `${q(B.title)} lower than ${q(A.title)}`,
  )
  if (direction) notes.push(direction)
  return {
    panels: [
      p.panels[0]!,
      {
        id: 'signed',
        title: `Signed ranks of ${B.title} − ${A.title}`,
        table: columnTable('signed', [{ key: 'signed', title: 'Signed rank', reps: [signed] }]),
        preset: 'pointsOnly',
        lines: [{ at: 0 }],
      },
    ],
    caption: 'Each pair’s difference is ranked by its size, then given its sign.',
    description: `${p.n} pairs of ${q(A.title)} and ${q(B.title)}, matched by row; the test ranks the differences ${B.title} − ${A.title} by size and compares the positive and negative ranks.`,
    counts: countsLine([`${p.n} pairs`, 'matched', 'signed ranks', '1 comparison']),
    notes,
    ...(sampled ? { sampled } : {}),
  }
}

/** Kolmogorov-Smirnov (§5.2): each group's cumulative curve. */
export function ksSketch(
  input: readonly NormalizedDataSet[],
  _params: Params,
  ctx: SketchContext,
): SketchSpec {
  if (input.length < 2 || input.some((d) => d.data.shape !== 'replicates'))
    return dataSketch(
      input,
      ctx,
      'The Kolmogorov-Smirnov test compares the raw values’ distributions.',
    )
  const [A, B] = input as [NormalizedDataSet, NormalizedDataSet]
  // Audit 4 (P3): each curve through at most ECDF_MAX_STEPS of its steps.
  const ca = ecdfPoints(valuesOf(A))
  const cb = ecdfPoints(valuesOf(B))
  const x = [...ca.x, ...cb.x]
  const yA = [...ca.y, ...cb.x.map(() => null)]
  const yB = [...ca.x.map(() => null), ...cb.y]
  const total = Math.max(A.rowCount, B.rowCount)
  const shown = Math.max(ca.x.length, cb.x.length)
  return {
    panels: [
      {
        id: 'ecdf',
        title: 'Cumulative fraction of values',
        table: xyTable(
          'ecdf',
          x,
          [
            { key: A.ref.key, title: A.title, reps: [yA] },
            { key: B.ref.key, title: B.title, reps: [yB] },
          ],
          'Value',
        ),
        preset: 'meanSdJoined',
        axes: { yTitle: 'Fraction ≤ value' },
      },
    ],
    caption:
      'Each curve rises by one step per value; the test looks at the widest gap between them.',
    description: `The cumulative distributions of ${q(A.title)} and ${q(B.title)}; the test compares their shapes, not only their centres.`,
    counts: countsLine(['2 groups', sizesText([countOf(A), countOf(B)]), 'distributions']),
    ...(ca.thinned || cb.thinned ? { sampled: { shown, total } } : {}),
  }
}

/** Audit 4 (P3): the steps a cumulative curve of the sketch is drawn through at most. */
export const ECDF_MAX_STEPS = 1000

/**
 * A cumulative curve's points (value, fraction ≤ value): every step up to ECDF_MAX_STEPS, else
 * that many evenly spaced among them, the first and the last included.
 */
export function ecdfPoints(values: readonly number[]): {
  x: number[]
  y: number[]
  thinned: boolean
} {
  const v = Float64Array.from(values).sort()
  const n = v.length
  const m = Math.min(n, ECDF_MAX_STEPS)
  const x: number[] = []
  const y: number[] = []
  for (let k = 0; k < m; k++) {
    const i = m === n ? k : Math.round((k * (n - 1)) / (m - 1))
    x.push(v[i]!)
    y.push((i + 1) / n)
  }
  return { x, y, thinned: m < n }
}

/** One sample (§5.2): each group's values with a line at the hypothetical value. */
export function oneSampleSketch(
  input: readonly NormalizedDataSet[],
  params: Params,
  ctx: SketchContext,
): SketchSpec {
  const h = typeof params.hypothetical === 'number' ? params.hypothetical : 0
  const { rows, sampled } = rowsOf(input, ctx)
  const median = params.test === 'wilcoxon'
  const notes: string[] = []
  const direction = predictedNote(params, `above ${plain(h)}`, `below ${plain(h)}`)
  if (direction) notes.push(direction)
  return {
    panels: input.length
      ? [
          {
            id: 'data',
            table: columnTable(
              'data',
              input.map((d) => setOf(d, rows)),
            ),
            preset: median ? 'pointsMedian' : 'pointsMean',
            lines: [{ at: h, label: `${plain(h)}` }],
          },
        ]
      : [],
    caption: `Each group's ${median ? 'median' : 'mean'} is compared with ${plain(h)} (the line).`,
    description: `${input.length} group${input.length === 1 ? '' : 's'} (${nameList(input.map((d) => d.title))}), each compared with the hypothetical value ${plain(h)}.`,
    counts: countsLine([
      `${input.length} group${input.length === 1 ? '' : 's'}`,
      sizesText(input.map(countOf)),
      `vs ${plain(h)}`,
    ]),
    notes,
    ...(sampled ? { sampled } : {}),
  }
}

/** ROC (§5.2's neighbours): controls and patients' values side by side. */
export function rocSketch(
  input: readonly NormalizedDataSet[],
  params: Params,
  ctx: SketchContext,
): SketchSpec {
  if (input.length < 2) return dataSketch(input, ctx, 'A ROC curve needs controls and patients.')
  const [C, P] = input as [NormalizedDataSet, NormalizedDataSet]
  const { rows, sampled } = rowsOf(input, ctx)
  const dir =
    params.direction === 'higher'
      ? `patients (${q(P.title)}) have higher values`
      : params.direction === 'lower'
        ? `patients (${q(P.title)}) have lower values`
        : 'say whether patients have higher or lower values'
  return {
    panels: [
      {
        id: 'data',
        table: columnTable('data', [setOf(C, rows), setOf(P, rows)]),
        preset: 'pointsOnly',
      },
    ],
    caption: `A cutoff swept across these values classifies each subject; ${dir}.`,
    description: `Controls ${q(C.title)} (${countOf(C)} values) and patients ${q(P.title)} (${countOf(P)} values); ${dir}.`,
    counts: countsLine([`${countOf(C)} controls`, `${countOf(P)} patients`]),
    ...(sampled ? { sampled } : {}),
  }
}

/** Bland-Altman: each pair's difference against its average, around 0. */
export function blandAltmanSketch(
  input: readonly NormalizedDataSet[],
  params: Params,
  ctx: SketchContext,
): SketchSpec {
  if (input.length < 2 || input.some((d) => d.data.shape !== 'replicates'))
    return dataSketch(input, ctx, 'Bland-Altman compares two methods measuring the same subjects.')
  const [A, B] = input as [NormalizedDataSet, NormalizedDataSet]
  const { rows, sampled } = rowsOf(input, ctx)
  const { both, lone } = pairsOf(A, B, rows)
  const bMinusA = params.order === 'bMinusA'
  const [first, second] = bMinusA ? [B.title, A.title] : [A.title, B.title]
  const measure =
    params.measure === 'ratio' ? 'ratio' : params.measure === 'percent' ? 'percent' : 'difference'
  const y = both.map(({ a, b }) => {
    const [u, v] = bMinusA ? [b, a] : [a, b]
    const avg = (a + b) / 2
    return measure === 'ratio'
      ? v !== 0
        ? u / v
        : null
      : measure === 'percent'
        ? avg !== 0
          ? (100 * (u - v)) / avg
          : null
        : u - v
  })
  const label =
    measure === 'ratio'
      ? `${first} / ${second}`
      : measure === 'percent'
        ? `% difference`
        : `${first} − ${second}`
  return {
    panels: [
      {
        id: 'ba',
        table: xyTable(
          'ba',
          both.map((p) => (p.a + p.b) / 2),
          [{ key: 'diff', title: label, reps: [y] }],
          'Average',
        ),
        preset: 'each',
        lines: [{ at: measure === 'ratio' ? 1 : 0 }],
        axes: { xTitle: 'Average of the two methods', yTitle: label },
      },
    ],
    caption: 'Each point is one subject: its two methods’ difference against their average.',
    description: `${both.length} subjects measured by ${q(A.title)} and ${q(B.title)}; each pair's ${measure} (${label}) against its average.`,
    counts: countsLine([`${both.length} pairs`, lone ? `${lone} without a pair` : null]),
    ...(sampled ? { sampled } : {}),
  }
}
