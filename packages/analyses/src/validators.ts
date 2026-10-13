import { type NormalizedDataSet, type Problem, pairedRows } from '@ps/model'
import {
  directionIssue,
  exclusionNotes,
  PAIRED_NEEDS_RAW,
  type Predicted,
  problem,
  RANK_NEEDS_RAW,
  rawValues,
  unpairedRowsNote,
} from './common.ts'

// Roadmap 51b (design §4.6): the problems found before computing, for the analyses whose checks
// need nothing of their own module (the others' `validate` sits beside their `run`). Each mirrors
// the start of its analysis' `run`, in the same order with the same messages and notes, and is
// what `run` returns (`withValidate`), so the dialog's block and the result agree.

type Tails = { tails: 'two' | 'one'; predicted: Predicted }

/** Mann-Whitney: two data sets, a stated direction, raw values, values in both groups. */
export function validateMannWhitney(
  input: readonly NormalizedDataSet[],
  params: Tails,
): Problem | null {
  if (input.length < 2) return problem('The Mann-Whitney test compares two data sets.')
  const notes = exclusionNotes(input)
  const unset = directionIssue(params, notes)
  if (unset) return unset
  const a = rawValues(input[0]!)
  const b = rawValues(input[1]!)
  if (!a || !b)
    return problem(
      `The Mann-Whitney test needs raw values, not summary data.${RANK_NEEDS_RAW}`,
      'table',
      notes,
    )
  if (a.length < 1 || b.length < 1 || a.length + b.length < 3)
    return problem(
      'The Mann-Whitney test needs values in both groups (at least three in total).',
      'table',
      notes,
    )
  return null
}

/** Wilcoxon: two data sets, a stated direction, raw paired values, two complete pairs. */
export function validateWilcoxon(
  input: readonly NormalizedDataSet[],
  params: Tails,
): Problem | null {
  if (input.length < 2) return problem('The Wilcoxon test compares two paired data sets.')
  const [A, B] = input as [NormalizedDataSet, NormalizedDataSet]
  const notes = exclusionNotes(input)
  const unset = directionIssue(params, notes)
  if (unset) return unset
  if (A.data.shape !== 'replicates' || B.data.shape !== 'replicates')
    return problem(
      `The Wilcoxon test needs raw paired values, not summary data.${PAIRED_NEEDS_RAW}`,
      'table',
      notes,
    )
  const pairs = pairedRows(A.data.reps[0]!, B.data.reps[0]!)
  if (pairs.a.length < 2)
    return problem('The Wilcoxon test needs at least two complete pairs.', 'table', [
      ...notes,
      ...unpairedRowsNote(A.data.reps[0]!, B.data.reps[0]!),
    ])
  return null
}

/** Kolmogorov-Smirnov: two data sets of raw values, each with a value. */
export function validateKS(input: readonly NormalizedDataSet[]): Problem | null {
  if (input.length < 2) return problem('The Kolmogorov-Smirnov test compares two data sets.')
  const notes = exclusionNotes(input)
  const a = rawValues(input[0]!)
  const b = rawValues(input[1]!)
  if (!a || !b)
    return problem(
      'The Kolmogorov-Smirnov test needs raw values, not summary data.',
      'table',
      notes,
    )
  if (a.length < 1 || b.length < 1)
    return problem('Both groups need at least one value.', 'table', notes)
  return null
}

/** The Friedman test: raw values, two complete rows (rows with gaps noted). */
export function validateFriedman(input: readonly NormalizedDataSet[]): Problem | null {
  const notes = exclusionNotes(input)
  if (input.some((d) => d.data.shape !== 'replicates'))
    return problem(
      `The Friedman test needs raw values, not summary data.${RANK_NEEDS_RAW}`,
      'table',
      notes,
    )
  const cols = input.map((d) => (d.data.shape === 'replicates' ? d.data.reps[0]! : null)!)
  const rowCount = Math.max(0, ...cols.map((c) => c.length))
  let complete = 0
  let incomplete = 0
  for (let r = 0; r < rowCount; r++) {
    const filled = cols.filter((c) => !Number.isNaN(c[r] ?? Number.NaN)).length
    if (filled === cols.length) complete++
    else if (filled > 0) incomplete++
  }
  if (complete >= 2) return null
  if (incomplete > 0)
    notes.push({
      level: 'info',
      message: `${incomplete} row${incomplete > 1 ? 's' : ''} with missing values ${incomplete > 1 ? 'were' : 'was'} ignored (the Friedman test needs complete rows).`,
    })
  return problem('The Friedman test needs at least two complete rows.', 'table', notes)
}

/** One sample tests: a stated direction, raw values, two values in each group. */
export function validateOneSample(
  input: readonly NormalizedDataSet[],
  params: Tails,
): Problem | null {
  const notes = exclusionNotes(input)
  const unset = directionIssue(params, notes)
  if (unset) return unset
  const samples = input.map(rawValues)
  if (samples.some((s) => !s))
    return problem('This test needs raw values, not summary data.', 'table', notes)
  const small = samples.findIndex((x) => x!.length < 2)
  if (small >= 0)
    return problem(`“${input[small]!.title}” needs at least two values.`, 'table', notes)
  return null
}
