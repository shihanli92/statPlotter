import type { NormalizedDataSet, SketchContext, SketchPanel, SketchSpec } from '@ps/model'
import { mean, midranks } from '@ps/stats'
import { columnTable, groupedTable, type SketchSet, setOf, valuesOf } from './tables.ts'
import { dataSketch, ranksOf, rowsOf } from './twoGroups.ts'
import { comparisons, countOf, countsLine, nameList, plain, q, sizesText } from './words.ts'

// Roadmap 51b (design §5.3–§5.5): three or more groups, one factor (one-way ANOVA, Kruskal-Wallis,
// Friedman, nested), two or three factors (the factor grid) and many rows (multiple t tests and
// one-way ANOVAs): the groups in their order, the matched rows joined, ranks, the grand mean, the
// comparisons as brackets, what counts as a replicate. No P, no CI.

type Params = Record<string, unknown>

/** Most brackets drawn (§5.3: above, the count only). */
const MAX_BRACKETS = 10

/** The comparisons of a one-factor analysis as brackets, and their count. */
export function comparisonBrackets(
  groups: readonly NormalizedDataSet[],
  mode: unknown,
  controlKey: unknown,
  laterMinusEarlier: boolean,
): { brackets: { a: string; b: string; label: string }[]; count: number; control?: string } {
  const k = groups.length
  const label = (i: number, j: number) =>
    laterMinusEarlier
      ? `${groups[j]!.title} − ${groups[i]!.title}`
      : `${groups[i]!.title} vs ${groups[j]!.title}`
  if (mode === 'allPairs') {
    const pairs: [number, number][] = []
    for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) pairs.push([i, j])
    return {
      brackets:
        pairs.length <= MAX_BRACKETS
          ? pairs.map(([i, j]) => ({
              a: groups[i]!.ref.key,
              b: groups[j]!.ref.key,
              label: label(i, j),
            }))
          : [],
      count: pairs.length,
    }
  }
  if (mode === 'vsControl') {
    const c = Math.max(
      0,
      groups.findIndex((g) => g.ref.key === controlKey),
    )
    const others = groups.map((_, j) => j).filter((j) => j !== c)
    return {
      brackets: others.slice(0, MAX_BRACKETS).map((j) => ({
        a: groups[c]!.ref.key,
        b: groups[j]!.ref.key,
        label: `${groups[j]!.title} − ${groups[c]!.title}`,
      })),
      count: others.length,
      control: groups[c]!.ref.key,
    }
  }
  return { brackets: [], count: 0 }
}

/** Ranks within each complete row (1…k), by group: Friedman's view of matched values. */
function rowRanks(groups: readonly NormalizedDataSet[], rows: readonly number[]): SketchSet[] {
  const cols = groups.map((g) =>
    g.data.shape === 'replicates' ? g.data.reps[0]! : new Float64Array(),
  )
  const out: (number | null)[][] = groups.map(() => [])
  for (const r of rows) {
    const vals = cols.map((c) => c[r] ?? Number.NaN)
    if (!vals.every(Number.isFinite)) {
      for (const o of out) o.push(null)
      continue
    }
    const { ranks } = midranks(vals)
    out.forEach((o, i) => {
      o.push(ranks[i]!)
    })
  }
  return groups.map((g, i) => ({ key: g.ref.key, title: g.title, reps: [out[i]!] }))
}

/**
 * One-way ANOVA and its neighbours (§5.3): ordinary ANOVA's points with the grand mean,
 * Welch's own SDs, matched rows joined, Kruskal-Wallis' ranks, Friedman's ranks within rows, the
 * comparisons as brackets (from the control, highlighted), a trend's order.
 */
export function oneWaySketch(
  input: readonly NormalizedDataSet[],
  params: Params,
  ctx: SketchContext,
  friedman = false,
): SketchSpec {
  if (input.length < 2) return dataSketch(input, ctx, 'Choose two or more groups.')
  const { rows, sampled } = rowsOf(input, ctx)
  const matched = friedman || params.matched === true
  const ranks = friedman || params.gaussian === false
  const equal = params.equalSD === 'yes' || params.equalSD === undefined
  const raw = input.every((d) => d.data.shape === 'replicates')
  const later = params.differenceAs !== 'earlierMinusLater'
  const cmp = comparisonBrackets(input, params.comparisons, params.control, later)
  const names = input.map((d) => d.title)
  const sizes = input.map(countOf)
  const notes: string[] = []
  let panel: SketchPanel
  let caption: string
  let design: string
  if (matched && raw) {
    const table = ranks
      ? columnTable('data', rowRanks(input, rows))
      : columnTable(
          'data',
          input.map((d) => setOf(d, rows)),
        )
    panel = {
      id: 'data',
      title: ranks ? 'Ranks within each row (1 = smallest)' : 'Each line is one subject',
      table,
      preset: 'beforeAfter',
    }
    caption = ranks
      ? 'Friedman’s test ranks each subject’s values from 1 to the number of groups.'
      : 'Each line is one subject: its own differences between groups are what count.'
    design = `matched: ${rowCount(input, rows)} subjects`
    if (!ranks && hasGaps(input, rows))
      notes.push(
        params.rmMethod === 'anova'
          ? 'Some subjects miss a value: repeated-measures ANOVA leaves them out.'
          : 'Some subjects miss a value: a mixed-effects model will use the rest.',
      )
  } else if (ranks && raw) {
    const r = ranksOf(input)
    panel = {
      id: 'data',
      title: 'Ranks among all values (1 = smallest)',
      table: columnTable('data', r.sets),
      preset: 'pointsMedian',
    }
    caption = 'Kruskal-Wallis replaces every value by its rank among all the values.'
    notes.push(
      `Mean ranks: ${input.map((d, i) => `${q(d.title)} ${plain(r.sums[i]! / Math.max(1, sizes[i]!))}`).join(', ')}.`,
    )
    design = 'not matched, ranks'
  } else {
    const all = input.flatMap(valuesOf)
    const grand = raw ? mean(all) : Number.NaN
    panel = {
      id: 'data',
      table: columnTable(
        'data',
        input.map((d) => setOf(d, rows)),
      ),
      preset: equal ? 'pointsMean' : 'points',
      ...(equal && Number.isFinite(grand) ? { lines: [{ at: grand, label: 'grand mean' }] } : {}),
    }
    caption = equal
      ? 'ANOVA compares how far apart the group means are with the scatter inside the groups (the line: the grand mean).'
      : params.equalSD === 'brownForsythe'
        ? 'Brown-Forsythe ANOVA: each group keeps its own scatter, measured around its median.'
        : 'Welch ANOVA: each group keeps its own scatter (its SD bars).'
    design = 'not matched'
  }
  panel = {
    ...panel,
    ...(cmp.brackets.length ? { brackets: cmp.brackets } : {}),
    ...(cmp.control ? { highlight: [cmp.control] } : {}),
  }
  if (params.comparisons === 'trend')
    notes.push('A trend test assumes the groups are ordered as chosen and equally spaced.')
  if (cmp.count > MAX_BRACKETS)
    notes.push(`${cmp.count} comparisons, one family (too many to draw).`)
  const compText =
    params.comparisons === 'allPairs'
      ? `every pair: ${comparisons(cmp.count)}`
      : params.comparisons === 'vsControl'
        ? `each group with ${q(input.find((d) => d.ref.key === cmp.control)?.title ?? '')}: ${comparisons(cmp.count)}`
        : params.comparisons === 'trend'
          ? 'a trend across the groups in order'
          : 'no comparisons'
  return {
    panels: [panel],
    caption,
    description: `${input.length} groups (${nameList(names)}), ${sizesText(sizes)}, ${design}; ${compText}.`,
    counts: countsLine([`${input.length} groups`, sizesText(sizes), design, compText]),
    notes,
    ...(sampled ? { sampled } : {}),
  }
}

/** Rows with any value among the groups. */
function rowCount(input: readonly NormalizedDataSet[], rows: readonly number[]): number {
  return rows.filter((r) =>
    input.some(
      (d) =>
        d.data.shape === 'replicates' &&
        d.data.reps.some((a) => Number.isFinite(a[r] ?? Number.NaN)),
    ),
  ).length
}

/** A row with some values but not all (a subject missing a value). */
function hasGaps(input: readonly NormalizedDataSet[], rows: readonly number[]): boolean {
  return rows.some((r) => {
    const has = input.map(
      (d) => d.data.shape === 'replicates' && Number.isFinite(d.data.reps[0]![r] ?? Number.NaN),
    )
    return has.some(Boolean) && !has.every(Boolean)
  })
}

/** Nested analyses (§5.3): each subject's mean, the subjects as the independent units. */
export function nestedSketch(
  input: readonly NormalizedDataSet[],
  params: Params,
  ctx: SketchContext,
): SketchSpec {
  if (input.length < 2) return dataSketch(input, ctx, 'Choose two or more groups.')
  const subjects = input.map((d) => {
    const reps = d.data.shape === 'replicates' ? d.data.reps : []
    return reps.map((a) => Array.from(a).filter(Number.isFinite)).filter((v) => v.length)
  })
  const sets: SketchSet[] = input.map((d, i) => ({
    key: d.ref.key,
    title: d.title,
    reps: [subjects[i]!.map((v) => mean(v))],
  }))
  const later = params.differenceAs !== 'earlierMinusLater'
  const cmp =
    input.length === 2
      ? {
          brackets: [
            {
              a: input[0]!.ref.key,
              b: input[1]!.ref.key,
              label: `${input[1]!.title} − ${input[0]!.title}`,
            },
          ],
          count: 1,
        }
      : comparisonBrackets(input, params.comparisons, params.control, later)
  const nSubjects = subjects.reduce((s, v) => s + v.length, 0)
  const nValues = subjects.flat().reduce((s, v) => s + v.length, 0)
  return {
    panels: [
      {
        id: 'subjects',
        title: 'Each point is one subject’s mean',
        table: columnTable('subjects', sets),
        preset: 'pointsMean',
        ...(cmp.brackets.length ? { brackets: cmp.brackets } : {}),
      },
    ],
    caption:
      'Subjects are the independent units: their replicates are averaged within each subject.',
    description: `${input.length} groups (${nameList(input.map((d) => d.title))}) of ${nSubjects} subjects in all, ${nValues} values; the groups are compared on their subjects.`,
    counts: countsLine([
      `${input.length} groups`,
      `${nSubjects} subjects (not ${nValues} values)`,
      comparisons(cmp.count),
    ]),
  }
}

// ---- Two and three factors; many rows (§5.4, §5.5) -----------------------------------------------

const rowTitle = (d: NormalizedDataSet | undefined, r: number) =>
  d?.rowTitles?.[r] || `Row ${r + 1}`

/** The rows of a grouped table with any value. */
function rowsWithData(input: readonly NormalizedDataSet[], rows: readonly number[]): number[] {
  return rows.filter((r) =>
    input.some((d) =>
      d.data.shape === 'replicates'
        ? d.data.reps.some((a) => Number.isFinite(a[r] ?? Number.NaN))
        : Number.isFinite(d.data.mean[r] ?? Number.NaN),
    ),
  )
}

/** The grouped table's cells at these rows (raw replicates, else the means). */
function cellsTable(id: string, input: readonly NormalizedDataSet[], rows: readonly number[]) {
  return groupedTable(
    id,
    rows.map((r) => rowTitle(input[0], r)),
    input.map((d) => setOf(d, rows)),
  )
}

/** Two- and three-way ANOVA (§5.4): the factor grid as an interaction plot; what's a replicate. */
export function factorialSketch(
  input: readonly NormalizedDataSet[],
  params: Params,
  ctx: SketchContext,
  threeWay = false,
): SketchSpec {
  if (input.length < 2) return dataSketch(input, ctx, 'Choose two or more data sets.')
  const { rows: all, sampled } = rowsOf(input, ctx)
  const rows = rowsWithData(input, all)
  const reps = Math.max(
    1,
    ...input.map((d) => (d.data.shape === 'replicates' ? d.data.reps.length : 1)),
  )
  const values = input.reduce((s, d) => s + countOf(d), 0)
  const repeated = threeWay
    ? [
        params.repeatedRows && 'rows',
        params.repeatedCol1 && 'column factor 1',
        params.repeatedCol2 && 'column factor 2',
      ]
        .filter(Boolean)
        .join(' and ')
    : params.repeated !== 'none' && params.repeated !== undefined
      ? String(params.repeated)
      : ''
  const subjects = !repeated
    ? null
    : threeWay || params.repeated === 'both'
      ? reps
      : params.repeated === 'columns'
        ? rows.length * reps
        : input.length * reps
  const k = input.length
  const R = rows.length
  const pairs = (n: number) => (n * (n - 1)) / 2
  const kind = params.kind === 'vsControl'
  const per = (n: number) => (kind ? n - 1 : pairs(n))
  const count =
    params.comparisons === 'withinRows'
      ? R * per(k)
      : params.comparisons === 'withinColumns'
        ? k * per(R)
        : params.comparisons === 'allCells'
          ? per(R * k)
          : params.comparisons === 'mainColumns'
            ? per(k)
            : params.comparisons === 'mainRows'
              ? per(R)
              : 0
  const family =
    params.comparisons === 'withinRows' || params.comparisons === 'withinColumns'
      ? params.family === 'all'
        ? `1 family of ${count}`
        : `${params.comparisons === 'withinRows' ? R : k} families of ${params.comparisons === 'withinRows' ? per(k) : per(R)}`
      : count
        ? `1 family of ${count}`
        : null
  const notes: string[] = []
  if (params.interaction === false)
    notes.push(
      'Main effects only: the model assumes the lines are parallel (the effect of one factor doesn’t depend on the other).',
    )
  if (input.some((d) => rows.some((r) => !cellHas(d, r)))) notes.push('Some cells are empty.')
  const unit = subjects ? `${subjects} subjects (not ${values} values)` : `${values} values`
  return {
    panels: [
      {
        id: 'grid',
        title: 'Cell means, one line per data set',
        table: cellsTable('grid', input, rows),
        preset: 'connected',
      },
    ],
    caption: repeated
      ? `Repeated across ${repeated}: each subject’s values are linked, and subjects are the independent units.`
      : 'Each cell’s values are independent; the lines join the cell means across the rows.',
    description: `${k} data sets × ${R} rows${threeWay ? ' (two column factors)' : ''}, ${values} values${repeated ? `, repeated across ${repeated}` : ', not matched'}; ${count ? `${count} comparisons` : 'no comparisons'}.`,
    counts: countsLine([`${k} × ${R} cells`, `Independent units: ${unit}`, family]),
    notes,
    ...(sampled ? { sampled } : {}),
  }
}

const cellHas = (d: NormalizedDataSet, r: number) =>
  d.data.shape === 'replicates'
    ? d.data.reps.some((a) => Number.isFinite(a[r] ?? Number.NaN))
    : Number.isFinite(d.data.mean[r] ?? Number.NaN)

/** Rows shown of many (§5.5). */
const MANY_ROWS = 20

/** Multiple t tests and one-way ANOVAs (§5.5): the first rows' groups, one test per row. */
export function manyRowsSketch(
  input: readonly NormalizedDataSet[],
  params: Params,
  ctx: SketchContext,
  name: string,
): SketchSpec {
  if (input.length < 2)
    return dataSketch(input, ctx, 'Choose the data sets to compare in each row.')
  const { rows: all } = rowsOf(input, ctx)
  const rows = rowsWithData(input, all)
  const shown = rows.slice(0, MANY_ROWS)
  const fdr = params.approach === 'fdr'
  const q100 = typeof params.q === 'number' ? params.q : 5
  const alpha = typeof params.alpha === 'number' ? params.alpha * 100 : 5
  const family = fdr
    ? `False discovery rate: about ${plain(q100)}% of the discoveries are expected to be false.`
    : params.approach === 'significance'
      ? `Chance of any false positive among the rows ≤ ${plain(alpha)}%.`
      : 'No correction across the rows.'
  const notes = [family]
  if (params.distribution === 'lognormal')
    notes.push('Lognormal: the logarithms of the values are compared.')
  if (params.distribution === 'nonparametric' || params.gaussian === false)
    notes.push('Nonparametric: each row’s values are ranked.')
  return {
    panels: [
      {
        id: 'rows',
        title:
          shown.length < rows.length
            ? `The first ${shown.length} of ${rows.length} rows`
            : 'Each row is one test',
        table: cellsTable('rows', input, shown),
        preset: 'points',
      },
    ],
    caption: `${rows.length} ${name}, one per row.`,
    description: `${rows.length} rows, each comparing ${nameList(input.map((d) => d.title))}; ${family}`,
    counts: countsLine([
      `${rows.length} tests, one per row`,
      `${input.length} data sets`,
      fdr ? `FDR ${plain(q100)}%` : null,
    ]),
    notes,
  }
}
