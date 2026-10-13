import {
  type NormalizedDataSet,
  type SketchContext,
  type SketchSpec,
  survivalData,
} from '@ps/model'
import { countsTable, survivalTable } from './tables.ts'
import { dataSketch } from './twoGroups.ts'
import { countsLine, nameList, plain, q } from './words.ts'

// Roadmap 51b (design §5.7): contingency tables (the outcome's share in each row, a 2 × 2's roles,
// expected counts below 5) and survival (the Kaplan-Meier steps with censor marks, codes that
// are ignored, the reference group). Counts, expected counts and KM steps only.

type Params = Record<string, unknown>

/** A contingency table: each row's outcome as a share, the roles of a 2 × 2. */
export function contingencySketch(
  input: readonly NormalizedDataSet[],
  params: Params,
  ctx: SketchContext,
): SketchSpec {
  if (input.length < 2)
    return dataSketch(input, ctx, 'A contingency table needs two or more columns.')
  const n = input.reduce((m, d) => Math.max(m, d.rowCount), 0)
  const value = (d: NormalizedDataSet, r: number) =>
    d.data.shape === 'replicates' ? (d.data.reps[0]![r] ?? Number.NaN) : Number.NaN
  const rows = Array.from({ length: n }, (_, r) => r).filter((r) =>
    input.some((d) => Number.isFinite(value(d, r))),
  )
  const titles = rows.map((r) => input[0]!.rowTitles?.[r] || `Row ${r + 1}`)
  const counts = rows.map((r) => input.map((d) => (Number.isFinite(value(d, r)) ? value(d, r) : 0)))
  const total = counts.flat().reduce((s, v) => s + v, 0)
  const rowSums = counts.map((c) => c.reduce((s, v) => s + v, 0))
  const colSums = input.map((_, j) => counts.reduce((s, c) => s + (c[j] ?? 0), 0))
  let small = 0
  if (total > 0)
    for (const rs of rowSums) for (const cs of colSums) if ((rs * cs) / total < 5) small++
  const notes: string[] = []
  if (small)
    notes.push(
      `${small} cell${small === 1 ? '' : 's'} expect${small === 1 ? 's' : ''} fewer than 5 subjects${params.test === 'chiSquare' ? ': the chi-square approximation is rough there' : ''}.`,
    )
  const twoByTwo = rows.length === 2 && input.length === 2
  if (twoByTwo) {
    const er = params.exposedRow === 1 ? 1 : 0
    const oc = params.outcomeColumn === 1 ? 1 : 0
    notes.push(
      `Group 1 = ${q(titles[er]!)} (row ${er + 1}), the outcome = ${q(input[oc]!.title)} (column ${oc + 1}).`,
    )
  }
  if (params.trend === true && rows.length >= 3)
    notes.push('A trend test takes the rows in this order.')
  return {
    panels: [
      {
        id: 'counts',
        title: 'Each row’s outcomes as a share of the row',
        table: countsTable(
          'counts',
          titles,
          input.map((d, j) => ({
            key: d.ref.key,
            title: d.title,
            counts: counts.map((c) => c[j]!),
          })),
        ),
        preset: 'stackedPercent',
      },
    ],
    caption: 'Each bar is one row (group): its subjects split by outcome.',
    description: `A ${rows.length} × ${input.length} table of ${plain(total)} subjects: rows ${nameList(titles)}; outcomes ${nameList(input.map((d) => d.title))}.`,
    counts: countsLine([
      `${rows.length} × ${input.length} table`,
      `${plain(total)} subjects`,
      twoByTwo ? '2 × 2' : null,
    ]),
    notes,
  }
}

/** Survival curves: Kaplan-Meier steps with censor marks; ignored codes; the reference group. */
export function survivalSketch(
  input: readonly NormalizedDataSet[],
  params: Params,
  _ctx: SketchContext,
): SketchSpec {
  const event = typeof params.eventCode === 'number' ? params.eventCode : 1
  const censored = typeof params.censoredCode === 'number' ? params.censoredCode : 0
  const groups = input.map((d) => {
    const s = survivalData(d, { event, censored })
    return { key: d.ref.key, title: d.title, subjects: s.subjects, ignored: s.invalidCode }
  })
  const ignored = groups.reduce((s, g) => s + g.ignored, 0)
  const notes: string[] = []
  if (ignored)
    notes.push(
      `${ignored} value${ignored === 1 ? ' is' : 's are'} neither ${event} (event) nor ${censored} (censored) and ${ignored === 1 ? 'is' : 'are'} ignored.`,
    )
  const control = input.find((d) => d.ref.key === params.control) ?? input[0]
  if (control && input.length > 1)
    notes.push(`Reference group (hazard ratios): ${q(control.title)}.`)
  if (params.trend === true && input.length >= 3)
    notes.push('A trend test takes the groups in this order.')
  const events = groups.reduce((s, g) => s + g.subjects.filter((x) => x.event).length, 0)
  const n = groups.reduce((s, g) => s + g.subjects.length, 0)
  return {
    panels: input.length
      ? [
          {
            id: 'km',
            table: survivalTable('km', groups),
            preset: 'survival',
            ...(control && input.length > 1 ? { highlight: [control.ref.key] } : {}),
          },
        ]
      : [],
    caption: 'Kaplan-Meier steps: each drop is an event, each tick a censored subject.',
    description: `${input.length} group${input.length === 1 ? '' : 's'} (${nameList(input.map((d) => d.title))}), ${n} subjects, ${events} events.`,
    counts: countsLine([
      `${input.length} group${input.length === 1 ? '' : 's'}`,
      `${n} subjects`,
      `${events} events`,
    ]),
    notes,
  }
}
