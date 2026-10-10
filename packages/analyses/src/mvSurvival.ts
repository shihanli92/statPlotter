import type { AnalysisDef, Diagnostic } from '@ps/model'
import type { SurvivalSubject } from '@ps/stats'
import { z } from 'zod'
import {
  CONFIDENCE_FIELD,
  confidenceLevel,
  exclusionNotes,
  failure,
  indicesOf,
  pick,
  rowCountOf,
} from './common.ts'
import { cellsOf, labelOf, levelsOf } from './mvVariables.ts'
import { buildTable, stableId } from './resultTable.ts'
import { CI_METHOD_FIELD, ciMethod, survivalResult } from './survival.ts'

// ---------------------------------------------------------------------------------------------
// Kaplan-Meier survival analysis of a multiple-variables table (Prism 11: "Running Kaplan-Meier
// survival analysis from the Multiple Variables data table"): one row per subject, a time
// variable, a status variable — numeric codes (1 = event, 0 = censored by default) or text with a
// chosen level meaning an event — and optional grouping variables; one curve per combination of
// the grouping variables' levels that occurs (ordered by the first variable's levels, then the
// next's…). The calculations are those of survival tables (the same result sheets), and the
// plugin produces the survival table it analyzed (X = time, one data set per group, 1 = event,
// 0 = censored), which graphs as Kaplan-Meier curves.
// ---------------------------------------------------------------------------------------------

const Params = z.object({
  time: z.string().default(''),
  /** Status (censoring) variable; '' = the second analyzed variable. */
  status: z.string().default(''),
  /** Grouping variables (data set keys); [] = one curve. */
  groups: z.array(z.string()).default([]),
  /** Numeric status: codes for an event and for a censored subject. */
  eventCode: z.number().default(1),
  censoredCode: z.number().default(0),
  /** Text status: the level that means an event; others are censored unless `censoredLevel`. */
  eventLevel: z.string().default(''),
  /** Text status: the level that means censored ('' = every level other than the event's). */
  censoredLevel: z.string().default(''),
  ciMethod,
  confidenceLevel,
})
type Params = z.infer<typeof Params>

export const survivalFromVariablesDef: AnalysisDef<Params> = {
  id: 'survivalFromVariables',
  version: 1,
  title: 'Survival curves (Kaplan-Meier)',
  category: 'Survival analyses',
  description:
    'Kaplan-Meier curves from one row per subject: a time variable, a status variable (codes or text) and optional grouping variables, compared by the log-rank, trend and Gehan-Breslow-Wilcoxon tests; makes the survival table for graphing.',
  accepts: ['multipleVariables'],
  inputs: { min: 2, max: 64 },
  params: Params,
  form: [
    { path: ['time'], label: 'Time variable', kind: 'custom', component: 'dataset.pick' },
    {
      path: ['status'],
      label: 'Status (censoring) variable',
      kind: 'custom',
      component: 'dataset.pick:1',
    },
    {
      path: ['groups'],
      label: 'Grouping variables (a curve for each combination of their levels)',
      kind: 'custom',
      component: 'mv.variables:time=0,status=1',
    },
    { path: ['eventCode'], label: 'Numeric status: code for an event', kind: 'number', step: 1 },
    {
      path: ['censoredCode'],
      label: 'Numeric status: code for a censored subject',
      kind: 'number',
      step: 1,
    },
    {
      path: ['eventLevel'],
      label: 'Text status: the value that means an event',
      kind: 'custom',
      component: 'mv.level:status=1',
    },
    {
      path: ['censoredLevel'],
      label: 'Text status: the value that means censored (blank = any other)',
      kind: 'custom',
      component: 'mv.level:status=1',
    },
    CI_METHOD_FIELD,
    CONFIDENCE_FIELD,
  ],
  run(input, params) {
    const diagnostics: Diagnostic[] = exclusionNotes(input)
    const ti = pick(input, params.time)
    const si = pick(input, params.status, 1)
    if (ti === si) return failure('Choose different variables for time and status.', diagnostics)
    const cells = input.map(cellsOf)
    const timeCells = cells[ti]!
    if (timeCells.kind === 'text')
      return failure(`The time variable “${input[ti]!.title}” must hold numbers.`, diagnostics)
    const groupIdx = indicesOf(input, params.groups, [ti, si])
    const status = cells[si]!
    const textStatus = status.kind === 'text'
    const eventLevel = params.eventLevel.trim()
    const censoredLevel = params.censoredLevel.trim()
    if (textStatus) {
      if (!eventLevel)
        return failure(
          `“${input[si]!.title}” holds text: choose the value that means an event.`,
          diagnostics,
        )
      if (eventLevel === censoredLevel)
        return failure('The event and censored values must differ.', diagnostics)
    } else if (params.eventCode === params.censoredCode)
      return failure('The event and censored codes must differ.', diagnostics)

    const n = rowCountOf(input)
    const subjects: { row: number; time: number; event: boolean; group: string }[] = []
    let missing = 0
    let badTime = 0
    let badCode = 0
    let noGroup = 0
    for (let r = 0; r < n; r++) {
      const t = timeCells.values[r] as number
      const s = labelOf(status, r)
      if (Number.isNaN(t) && s === null) continue
      if (Number.isNaN(t) || s === null) {
        missing++
        continue
      }
      if (t < 0) {
        badTime++
        continue
      }
      let event: boolean
      if (textStatus) {
        if (s === eventLevel) event = true
        else if (!censoredLevel || s === censoredLevel) event = false
        else {
          badCode++
          continue
        }
      } else {
        const code = status.values[r] as number
        if (code === params.eventCode) event = true
        else if (code === params.censoredCode) event = false
        else {
          badCode++
          continue
        }
      }
      const labels = groupIdx.map((g) => labelOf(cells[g]!, r))
      if (labels.some((l) => l === null)) {
        noGroup++
        continue
      }
      subjects.push({ row: r, time: t, event, group: labels.join('\u0000') })
    }
    const note = (count: number, what: string) => {
      if (count)
        diagnostics.push({
          level: 'warning',
          message: `${count} row${count > 1 ? 's' : ''} ${what} and ${count > 1 ? 'were' : 'was'} left out.`,
        })
    }
    note(missing, 'had a time or a status but not both')
    note(badTime, 'had a negative time')
    note(
      badCode,
      textStatus
        ? `had a status other than “${eventLevel}”${censoredLevel ? ` or “${censoredLevel}”` : ''}`
        : `had a status other than ${params.eventCode} (event) or ${params.censoredCode} (censored)`,
    )
    note(noGroup, 'had no value in a grouping variable')
    if (!subjects.length) return failure('No subjects to analyze.', diagnostics)

    // Groups: combinations that occur, ordered by each variable's level order (table order).
    const rows = subjects.map((s) => s.row)
    const order = groupIdx.map((g) => {
      const lv = levelsOf(cells[g]!, rows)
      return new Map(lv.map((l, k) => [l, k]))
    })
    const keys = [...new Set(subjects.map((s) => s.group))]
    const rank = (key: string) => key.split('\u0000').map((l, j) => order[j]!.get(l)!)
    keys.sort((a, b) => {
      const ra = rank(a)
      const rb = rank(b)
      for (let j = 0; j < ra.length; j++) if (ra[j] !== rb[j]) return ra[j]! - rb[j]!
      return 0
    })
    const titles = groupIdx.length
      ? keys.map((k) => k.split('\u0000').join(', '))
      : [input[si]!.title]
    const groups: SurvivalSubject[][] = keys.map((k) =>
      subjects.filter((s) => s.group === k).map((s) => ({ time: s.time, event: s.event })),
    )
    const result = survivalResult(titles, groups, params, diagnostics)
    if (result.status === 'error') return result

    // The survival table analyzed: one row per subject, the code in its group's column.
    const groupOf = new Map(keys.map((k, g) => [k, g]))
    result.table = buildTable(input, {
      name: 'Survival data',
      tableKind: 'survival',
      rowCount: subjects.length,
      rowTitles: null,
      x: { title: input[ti]!.title, values: Float64Array.from(subjects, (s) => s.time) },
      dataSets: titles.map((title, g) => ({
        id: stableId('group', title),
        title,
        subcolumns: [
          Float64Array.from(subjects, (s) =>
            groupOf.get(s.group) === g ? (s.event ? 1 : 0) : Number.NaN,
          ),
        ],
      })),
      notes: `Survival data of ${input[ti]!.title} and ${input[si]!.title}, one row per subject (1 = event, 0 = censored).`,
    })
    return result
  },
}
