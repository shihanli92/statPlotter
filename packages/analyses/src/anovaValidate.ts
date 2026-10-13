import type { Diagnostic, NormalizedDataSet, Problem } from '@ps/model'
import { sd as sampleSd } from '@ps/stats'
import { groupData } from './anovaCommon.ts'
import {
  exclusionNotes,
  PAIRED_NEEDS_RAW,
  problem,
  RANK_NEEDS_RAW,
  rawValues,
  rowCountOf,
  summaryProblem,
} from './common.ts'
import { cellGroup, rowTitleOf } from './grouped.ts'
import { validateFriedman } from './validators.ts'

// Roadmap 51b (design §4.6): one- and two-way ANOVA's problems before computing — the start of
// their `run`, in the same order with the same messages and notes (`withValidate` returns them).

export const NK_RM_MESSAGE =
  'Newman-Keuls comparisons are available without repeated measures. Choose Tukey or another test.'
export const TREND_MESSAGE =
  'The test for linear trend follows ordinary one-way ANOVA. Choose “No matching”, a Gaussian distribution and equal SDs, or other comparisons.'
export const ALL_CELLS_RM_MESSAGE =
  'Comparing every cell with every other is available without repeated measures. Choose comparisons within rows or within columns.'
export const ONE_PER_CELL_MESSAGE =
  'With one value per cell, choose “Main effects only”: the interaction can’t be estimated.'

/** Repeated-measures ANOVA drops subjects with gaps when chosen (`rmMethod: 'anova'`). */
function droppedNote(notes: Diagnostic[], dropped: number) {
  if (dropped > 0)
    notes.push({
      level: 'warning',
      message: `${dropped} subject${dropped > 1 ? 's' : ''} with a missing value ${dropped > 1 ? 'were' : 'was'} left out: repeated-measures ANOVA analyzes complete subjects only.`,
    })
}

interface OneWayCheck {
  matched: boolean
  gaussian: boolean
  equalSD: 'yes' | 'welch' | 'brownForsythe'
  comparisons: string
  allPairsMethod: string
  rmMethod: 'auto' | 'anova' | 'mixed'
}

/** One-way ANOVA (and Kruskal-Wallis, Friedman, repeated measures). */
export function validateOneWay(
  input: readonly NormalizedDataSet[],
  params: OneWayCheck,
): Problem | null {
  if (input.length < 2)
    return problem('One-way ANOVA compares two or more data sets.', 'table', exclusionNotes(input))
  if (
    params.comparisons === 'trend' &&
    (params.matched || !params.gaussian || params.equalSD !== 'yes')
  )
    return problem(TREND_MESSAGE, 'params', exclusionNotes(input))
  if (params.matched && !params.gaussian) return validateFriedman(input)
  const notes = exclusionNotes(input)
  if (params.matched) {
    if (params.comparisons === 'allPairs' && params.allPairsMethod === 'newman-keuls')
      return problem(NK_RM_MESSAGE, 'params', notes)
    if (input.some((d) => d.data.shape !== 'replicates'))
      return problem(
        `Repeated measures ANOVA needs raw values, not summary data.${PAIRED_NEEDS_RAW}`,
        'table',
        notes,
      )
    const cols = input.map((d) => (d.data.shape === 'replicates' ? d.data.reps[0]! : null)!)
    const n = rowCountOf(input)
    let all = 0
    let complete = 0
    for (let r = 0; r < n; r++) {
      const filled = cols.filter((c) => !Number.isNaN(c[r] ?? Number.NaN)).length
      if (filled > 0) all++
      if (filled === cols.length) complete++
    }
    const rows = params.rmMethod === 'anova' ? complete : all
    if (rows < 2) {
      droppedNote(notes, all - rows)
      return problem('Need at least two subjects (rows).', 'table', notes)
    }
    return null
  }
  if (!params.gaussian) {
    const raws = input.map(rawValues)
    if (raws.some((r) => !r))
      return problem(
        `The Kruskal-Wallis test needs raw values, not summary data.${RANK_NEEDS_RAW}`,
        'table',
        notes,
      )
    if (raws.some((g) => g!.length === 0))
      return problem('Every group needs at least one value.', 'table', notes)
    return null
  }
  for (const ds of input) {
    const issue = summaryProblem(ds)
    if (issue) return problem(issue, 'table', notes)
  }
  const groups = input.map(groupData)
  const missing = groups.findIndex((g) => !g)
  if (missing >= 0)
    return problem(`“${input[missing]!.title}” needs raw values or mean, SD and N.`, 'table', notes)
  const stats = groups.map((g) =>
    'values' in g! ? { n: g.values.length, sd: sampleSd(g.values) } : { n: g!.n, sd: g!.sd },
  )
  if (stats.some((x) => x.n < 1))
    return problem('Every group needs at least one value.', 'table', notes)
  if (stats.reduce((s, x) => s + x.n, 0) - stats.length < 1)
    return problem('There are too few values to estimate the residual variance.', 'table', notes)
  if (params.equalSD !== 'yes') {
    const name = params.equalSD === 'welch' ? 'Welch ANOVA' : 'Brown-Forsythe ANOVA'
    const small = stats.findIndex((x) => x.n < 2)
    if (small >= 0)
      return problem(
        `${name} needs at least two values in every group (“${input[small]!.title}”).`,
        'table',
        notes,
      )
    const flat = stats.findIndex((x) => !(x.sd > 0))
    if (params.equalSD === 'welch' && flat >= 0)
      return problem(
        `Welch ANOVA needs variation within every group; the values of “${input[flat]!.title}” are all the same.`,
        'table',
        notes,
      )
  }
  return null
}

interface TwoWayCheck {
  repeated: 'none' | 'rows' | 'columns' | 'both'
  comparisons: string
  kind: string
  allPairsMethod: string
  interaction: boolean
}

/** Two-way ANOVA (ordinary and repeated measures). */
export function validateTwoWay(
  input: readonly NormalizedDataSet[],
  params: TwoWayCheck,
): Problem | null {
  const notes = exclusionNotes(input)
  const rowCount = input[0]?.rowCount ?? 0
  if (params.repeated !== 'none') {
    if (
      params.comparisons !== 'none' &&
      params.kind === 'allPairs' &&
      params.allPairsMethod === 'newman-keuls'
    )
      return problem(NK_RM_MESSAGE, 'params', notes)
    if (params.comparisons === 'allCells') return problem(ALL_CELLS_RM_MESSAGE, 'params', notes)
    if (input.some((d) => d.data.shape !== 'replicates'))
      return problem(
        `Repeated measures need raw values, not summary data.${PAIRED_NEEDS_RAW}`,
        'table',
        notes,
      )
    let rows = 0
    for (let r = 0; r < rowCount; r++)
      if (
        input.some(
          (ds) =>
            ds.data.shape === 'replicates' && ds.data.reps.some((rep) => !Number.isNaN(rep[r]!)),
        )
      )
        rows++
    if (rows < 2) return problem('Two-way ANOVA needs at least two rows with data.', 'table', notes)
    return null
  }
  for (const ds of input)
    for (let r = 0; r < rowCount; r++) {
      const issue = summaryProblem(ds, r, 1, rowTitleOf(input, r))
      if (issue) return problem(issue, 'table', notes)
    }
  const rows = Array.from({ length: rowCount }, (_, r) => r).filter((r) =>
    input.some((ds) => cellGroup(ds, r)),
  )
  if (rows.length < 2)
    return problem('Two-way ANOVA needs at least two rows with data.', 'table', notes)
  let cells = 0
  let maxN = 0
  for (const r of rows)
    for (const ds of input) {
      const g = cellGroup(ds, r)
      if (!g) continue
      cells++
      maxN = Math.max(maxN, 'values' in g ? g.values.length : g.n)
    }
  if (cells < rows.length * input.length)
    return problem('Every cell (row × column) needs at least one value.', 'table', notes)
  if (params.interaction && maxN < 2) return problem(ONE_PER_CELL_MESSAGE, 'params', notes)
  return null
}
