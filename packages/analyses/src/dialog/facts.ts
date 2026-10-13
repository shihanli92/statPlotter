import type { AnalysisFacts, NormalizedDataSet, TableKind } from '@ps/model'
import { comparisonFacts } from '../nonlinear.ts'

// Roadmap 51b (design §4.4): the facts the Analyze dialog's conditions read — counts and shapes of
// the chosen data sets, never a test of the data.

const finite = (v: number | undefined): v is number => v !== undefined && Number.isFinite(v)

/** A row has a value in this data set (any replicate; a summary's mean). */
function hasRow(d: NormalizedDataSet, r: number): boolean {
  if (d.data.shape !== 'replicates') return finite(d.data.mean[r]) || !!d.text?.[r]
  for (const a of d.data.reps) if (finite(a[r])) return true
  return false
}

/**
 * Roadmap 51c (S5): whether a subject lacks a value the others have among the chosen data sets —
 * a column table's row with some values but not all, a grouped table's row whose replicates
 * aren't all filled — so matched values would be fit by a mixed-effects model. Audit 4 (P2): one
 * pass, no allocation, stopping at the first such row.
 */
export function missingInMatched(kind: TableKind, sets: readonly NormalizedDataSet[]): boolean {
  if (sets.length < 2 || sets.some((d) => d.data.shape !== 'replicates')) return false
  const reps = sets.map((d) => (d.data.shape === 'replicates' ? d.data.reps : []))
  const rowCount = Math.max(...sets.map((d) => d.rowCount))
  const width = kind === 'grouped' ? Math.max(...reps.map((r) => r.length)) : 1
  for (let r = 0; r < rowCount; r++) {
    let some = false
    let all = true
    for (const rs of reps)
      for (let j = 0; j < width; j++) {
        if (finite(rs[j]?.[r] ?? Number.NaN)) some = true
        else all = false
        if (some && !all) return true
      }
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

/** The facts of the data alone (not the params). */
type DataFacts = Omit<AnalysisFacts, 'factors' | 'modelComparison' | 'modelsNested'>

/**
 * Audit 4 (P2): the data's facts once per input — the dialog asks for the facts on every change
 * of the options, with the same input until the data sets chosen or the data change.
 */
const cache = new WeakMap<readonly NormalizedDataSet[], Map<TableKind, DataFacts>>()

function dataFacts(kind: TableKind, input: readonly NormalizedDataSet[]): DataFacts {
  let byKind = cache.get(input)
  if (!byKind) {
    byKind = new Map()
    cache.set(input, byKind)
  }
  const hit = byKind.get(kind)
  if (hit) return hit
  const numeric = input.filter((d) => !d.text)
  const rowCount = input.reduce((m, d) => Math.max(m, d.rowCount), 0)
  let rows = 0
  for (let r = 0; r < rowCount; r++) {
    for (const d of input)
      if (hasRow(d, r)) {
        rows++
        break
      }
  }
  const facts: DataFacts = {
    raw: numeric.every((d) => d.data.shape === 'replicates'),
    hasX: kind === 'xy' || kind === 'survival' || input.some((d) => d.x),
    twoByTwo: kind === 'contingency' && numeric.length === 2 && rows === 2,
    missingInMatched: missingInMatched(kind, numeric),
    groups: numeric.length,
    dataSets: input.length,
    maxPerCell: maxPerCell(kind, numeric),
    rows,
    columns: numeric.length,
  }
  byKind.set(kind, facts)
  return facts
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
  const factorList = Array.isArray(params.factors) ? (params.factors as unknown[]) : []
  const y = typeof params.y === 'string' && params.y ? params.y : undefined
  const factors =
    factorList.length || kind !== 'multipleVariables'
      ? factorList.length
      : input.filter((d) => d.ref.key !== (y ?? input[0]?.ref.key)).length
  return {
    ...dataFacts(kind, input),
    factors,
    // Roadmap 51e (§9.4): a curve fit's comparison, from its params (absent params: none).
    ...('compareBy' in params
      ? comparisonFacts(params)
      : { modelComparison: false, modelsNested: false }),
  }
}
