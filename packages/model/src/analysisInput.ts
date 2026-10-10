import type { AnalysisNode } from './analysis.ts'
import type { NormalizedDataSet, ReplicateData, SummaryData } from './normalize.ts'
import type { TableKind } from './table.ts'

// Roadmap 35: what an analysis' input may do to the data sets before the analysis reads them —
// take the values at one X of an XY table (a comparison at a time point), and pool data sets
// into one (a group of controls against one patient). Pure, shared by the engine and tests.

/** The input's modifiers: values at one X, pools of data sets. */
export type InputModifiers = Pick<AnalysisNode['input'], 'atX' | 'pools'>

/** Whether an input changes its data sets before the analysis. */
export const hasModifiers = (m: InputModifiers): boolean => m.atX !== undefined || !!m.pools?.length

/** A pooled data set's title: its members' titles joined ("HC1 + HC2 + HC3"). */
export const poolTitle = (titles: readonly string[]): string => titles.join(' + ')

/** The rows of a data set whose X is `x` (exactly, as typed). */
function rowsAt(ds: NormalizedDataSet, x: number): number[] {
  const out: number[] = []
  if (!ds.x) return out
  for (let r = 0; r < ds.rowCount; r++) if (ds.x[r] === x) out.push(r)
  return out
}

const pick = (a: Float64Array, rows: readonly number[]) => Float64Array.from(rows, (r) => a[r]!)

/**
 * A data set's values at one X, as a column table's data set: every replicate of every row at
 * that X down one column (entered means: those rows' summaries).
 */
function valuesAt(ds: NormalizedDataSet, x: number): NormalizedDataSet {
  const rows = rowsAt(ds, x)
  let data: ReplicateData | SummaryData
  let rowCount: number
  if (ds.data.shape === 'replicates') {
    const values: number[] = []
    for (const r of rows) for (const rep of ds.data.reps) values.push(rep[r]!)
    data = { shape: 'replicates', reps: [Float64Array.from(values)] }
    rowCount = values.length
  } else {
    const s = ds.data
    data = {
      shape: 'summary',
      mean: pick(s.mean, rows),
      sd: pick(s.sd, rows),
      sem: pick(s.sem, rows),
      n: pick(s.n, rows),
      ...(s.lo ? { lo: pick(s.lo, rows) } : {}),
      ...(s.hi ? { hi: pick(s.hi, rows) } : {}),
    }
    rowCount = rows.length
  }
  const { text: _, formula: __, ...rest } = ds
  return { ...rest, rowCount, rowTitles: null, x: null, data }
}

/**
 * Data sets pooled into one under the first's key: each member's replicates as more subcolumns
 * of the same rows (a grouped table's cells pooled row by row; a column table's values together),
 * shorter members padded with no values.
 */
function pooled(members: readonly NormalizedDataSet[]): NormalizedDataSet | string {
  if (members.some((m) => m.data.shape !== 'replicates'))
    return 'Pooling needs the values themselves, not entered means and SDs.'
  const rowCount = Math.max(...members.map((m) => m.rowCount))
  const reps: Float64Array[] = []
  for (const m of members)
    for (const rep of (m.data as ReplicateData).reps) {
      if (rep.length === rowCount) reps.push(rep)
      else {
        const padded = new Float64Array(rowCount).fill(Number.NaN)
        padded.set(rep)
        reps.push(padded)
      }
    }
  const first = members[0]!
  const longest = members.find((m) => m.rowCount === rowCount) ?? first
  return {
    ref: first.ref,
    title: poolTitle(members.map((m) => m.title)),
    rowCount,
    rowTitles: longest.rowTitles,
    x: longest.x,
    data: { shape: 'replicates', reps },
    counts: {
      empty: members.reduce((s, m) => s + m.counts.empty, 0),
      excluded: members.reduce((s, m) => s + m.counts.excluded, 0),
    },
  }
}

/**
 * The data sets an analysis reads after its input's modifiers: the values at `atX` (an XY
 * table's become a column table's: `tableKind` 'column'), then each pool as one data set at its
 * first member's place. An error says why it can't (no X column, pooled means).
 */
export function modifyInput(
  input: readonly NormalizedDataSet[],
  m: InputModifiers,
  tableKind: TableKind,
): { input: NormalizedDataSet[]; tableKind: TableKind } | { error: string } {
  let out = [...input]
  let kind = tableKind
  if (m.atX !== undefined) {
    if (out.some((d) => !d.x)) return { error: 'Values at one X need a table with X values.' }
    const x = m.atX
    out = out.map((d) => valuesAt(d, x))
    if (out.every((d) => d.rowCount === 0)) return { error: `No values at X = ${x}.` }
    kind = 'column'
  }
  for (const pool of m.pools ?? []) {
    const members = pool.flatMap((k) => out.filter((d) => d.ref.key === k))
    if (members.length < 2) continue
    const p = pooled(members)
    if (typeof p === 'string') return { error: p }
    const at = out.indexOf(members[0]!)
    out = out.flatMap((d, i) => (i === at ? [p] : members.includes(d) ? [] : [d]))
  }
  return { input: out, tableKind: kind }
}
