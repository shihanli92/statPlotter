import type { AnalysisFacts, NormalizedDataSet, TableKind } from '@ps/model'

// Roadmap 51b (design §4.4): the facts the Analyze dialog's conditions read — counts and shapes of
// the chosen data sets, never a test of the data.

const finite = (v: number | undefined): v is number => v !== undefined && Number.isFinite(v)

/** A row has a value in this data set (any replicate; a summary's mean). */
const hasRow = (d: NormalizedDataSet, r: number) =>
  d.data.shape === 'replicates'
    ? d.data.reps.some((a) => finite(a[r]))
    : finite(d.data.mean[r]) || !!d.text?.[r]

/**
 * Roadmap 51c (S5): whether a subject lacks a value the others have among the chosen data sets —
 * a column table's row with some values but not all, a grouped table's row whose replicates
 * aren't all filled — so matched values would be fit by a mixed-effects model.
 */
export function missingInMatched(kind: TableKind, sets: readonly NormalizedDataSet[]): boolean {
  if (sets.length < 2 || sets.some((d) => d.data.shape !== 'replicates')) return false
  const reps = sets.map((d) => (d.data.shape === 'replicates' ? d.data.reps : []))
  const rowCount = Math.max(...sets.map((d) => d.rowCount))
  const width = kind === 'grouped' ? Math.max(...reps.map((r) => r.length)) : 1
  for (let r = 0; r < rowCount; r++) {
    const cells = reps.flatMap((rs) =>
      Array.from({ length: width }, (_, j) => finite(rs[j]?.[r] ?? Number.NaN)),
    )
    if (cells.some(Boolean) && !cells.every(Boolean)) return true
  }
  return false
}

/** Values in the fullest cell (a grouped table's row of a data set; other tables: 1 or more). */
function maxPerCell(kind: TableKind, sets: readonly NormalizedDataSet[]): number {
  let most = 0
  for (const d of sets) {
    if (d.data.shape === 'summary') {
      for (const n of d.data.n) if (finite(n) && n > most) most = n
      continue
    }
    const reps = d.data.reps
    for (let r = 0; r < d.rowCount; r++) {
      let n = 0
      for (const a of reps) if (finite(a[r])) n++
      if (n > most) most = n
    }
  }
  return kind === 'grouped' ? most : Math.max(most, sets.length ? 1 : 0)
}

/**
 * The facts of the data sets chosen for an analysis of a `kind` table (`params`: a
 * multiple-variables ANOVA's factors, the variables in no other role).
 */
export function analysisFacts(
  kind: TableKind,
  input: readonly NormalizedDataSet[],
  params: Record<string, unknown> = {},
): AnalysisFacts {
  const numeric = input.filter((d) => !d.text)
  const rowCount = input.reduce((m, d) => Math.max(m, d.rowCount), 0)
  let rows = 0
  for (let r = 0; r < rowCount; r++) if (input.some((d) => hasRow(d, r))) rows++
  const factorList = Array.isArray(params.factors) ? (params.factors as unknown[]) : []
  const y = typeof params.y === 'string' && params.y ? params.y : undefined
  const factors =
    factorList.length || kind !== 'multipleVariables'
      ? factorList.length
      : input.filter((d) => d.ref.key !== (y ?? input[0]?.ref.key)).length
  return {
    raw: numeric.every((d) => d.data.shape === 'replicates'),
    hasX: kind === 'xy' || kind === 'survival' || input.some((d) => d.x),
    twoByTwo: kind === 'contingency' && numeric.length === 2 && rows === 2,
    missingInMatched: missingInMatched(kind, numeric),
    groups: numeric.length,
    dataSets: input.length,
    maxPerCell: maxPerCell(kind, numeric),
    rows,
    columns: numeric.length,
    factors,
  }
}
