import type { ColumnId, DataTable, NodeId, NormalizedDataSet, TableKind } from '@ps/model'

// Roadmap 51b (design §5.1): the transient tables a sketch draws — plain data built from the
// normalized input (values, ranks, differences, cell means, counts), never a statistic of a test.
// Ids are fixed (the panel's, the data sets' own keys) so a sketch is a pure function of its
// input and brackets name the user's groups.

/** Rows drawn per group at most (§5.8): larger tables are sampled by rows. */
export const SKETCH_MAX_ROWS = 2000

type Cell = number | null
export interface SketchSet {
  key: string
  title: string
  /** One array per replicate (subcolumn). */
  reps: readonly (readonly Cell[])[]
}

const cell = (v: number | undefined): Cell => (v === undefined || !Number.isFinite(v) ? null : v)
const pad = (a: readonly Cell[], n: number): Cell[] =>
  Array.from({ length: n }, (_, i) => a[i] ?? null)
const tableId = (id: string) => `sketch${id.replace(/[^0-9a-z]/g, '')}` as NodeId
const columnId = (key: string) => key as ColumnId

/**
 * The rows a sketch draws (§5.8): all of them up to `max`, else every k-th row in table order
 * (deterministic, so pairs and subjects stay whole).
 */
export function sampledRows(rowCount: number, max = SKETCH_MAX_ROWS): number[] {
  if (rowCount <= max) return Array.from({ length: rowCount }, (_, i) => i)
  const k = Math.ceil(rowCount / max)
  const out: number[] = []
  for (let r = 0; r < rowCount; r += k) out.push(r)
  return out
}

/**
 * Audit 4 (P3): values a sketch draws at most over all its groups (§5.8 promises a sample; a
 * cap per group let many groups, or many replicates, draw hundreds of thousands of points).
 */
export const SKETCH_MAX_POINTS = 4000

/**
 * The rows a sketch of these data sets draws: at most `maxRows`, and few enough that the values
 * of every set at those rows (`perRow` each row; default each set's replicates) stay within
 * SKETCH_MAX_POINTS. With the sample note when the table is larger.
 */
export function sketchRows(
  input: readonly NormalizedDataSet[],
  maxRows = SKETCH_MAX_ROWS,
  perRow = input.reduce((s, d) => s + (d.data.shape === 'replicates' ? d.data.reps.length : 1), 0),
): { rows: number[]; sampled?: { shown: number; total: number } } {
  const total = input.reduce((m, d) => Math.max(m, d.rowCount), 0)
  const cap = Math.max(1, Math.floor(SKETCH_MAX_POINTS / Math.max(1, perRow)))
  const rows = sampledRows(total, Math.min(maxRows, cap))
  return rows.length < total ? { rows, sampled: { shown: rows.length, total } } : { rows }
}

/**
 * Audit 4 (P3): the midrank of each value among `sorted` (ascending, finite), as the stats'
 * `midranks` gives it — by binary search, so a sketch ranks every value without sorting an index.
 */
export function midrankIn(sorted: Float64Array, v: number): number {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const m = (lo + hi) >>> 1
    if (sorted[m]! < v) lo = m + 1
    else hi = m
  }
  const first = lo
  hi = sorted.length
  while (lo < hi) {
    const m = (lo + hi) >>> 1
    if (sorted[m]! <= v) lo = m + 1
    else hi = m
  }
  // Positions first … lo − 1 (0-based) hold v: ranks first + 1 … lo, their mean.
  return (first + lo + 1) / 2
}

/** A data set's replicate values at these rows (a summary's means), as cells. */
export function setOf(d: NormalizedDataSet, rows: readonly number[]): SketchSet {
  const arrays = d.data.shape === 'replicates' ? d.data.reps : [d.data.mean]
  return {
    key: d.ref.key,
    title: d.title || 'untitled',
    reps: arrays.map((a) => rows.map((r) => cell(a[r]))),
  }
}

/** The finite values of a data set (every replicate). */
export function valuesOf(d: NormalizedDataSet): number[] {
  const out: number[] = []
  const arrays = d.data.shape === 'replicates' ? d.data.reps : [d.data.mean]
  for (const a of arrays) for (const v of a) if (Number.isFinite(v)) out.push(v)
  return out
}

function base(id: string, kind: TableKind, rows: number): DataTable {
  return {
    kind: 'table',
    id: tableId(id),
    name: 'Sketch',
    tableKind: kind,
    yFormat: { type: 'replicates', count: 1 },
    rowCount: rows,
    rowTitles: null,
    x: null,
    dataSets: [],
    notes: '',
  }
}

/** A column table: each set a group, its values down the rows. */
export function columnTable(id: string, sets: readonly SketchSet[]): DataTable {
  const values = sets.map((s) => s.reps.flat())
  const rows = Math.max(1, ...values.map((v) => v.length))
  return {
    ...base(id, 'column', rows),
    dataSets: sets.map((s, i) => ({
      id: columnId(s.key),
      title: s.title,
      subcolumns: [{ type: 'number', values: pad(values[i]!, rows) }],
    })),
  }
}

/** A column table of mean, SD and N per group (a summary: Student's pooled SD, §5.2). */
export function summaryTable(
  id: string,
  sets: readonly { key: string; title: string; mean: number; sd: number; n: number }[],
): DataTable {
  return {
    ...base(id, 'column', 1),
    yFormat: { type: 'summary', preset: 'meanSdN' },
    dataSets: sets.map((s) => ({
      id: columnId(s.key),
      title: s.title,
      subcolumns: [
        { type: 'number', values: [cell(s.mean)] },
        { type: 'number', values: [cell(s.sd)] },
        { type: 'number', values: [cell(s.n)] },
      ],
    })),
  }
}

/** A grouped table: rows titled, each set's replicates side by side. */
export function groupedTable(
  id: string,
  rowTitles: readonly string[],
  sets: readonly SketchSet[],
): DataTable {
  const reps = Math.max(1, ...sets.map((s) => s.reps.length))
  const rows = rowTitles.length
  return {
    ...base(id, 'grouped', rows),
    yFormat: { type: 'replicates', count: reps },
    rowTitles: [...rowTitles],
    dataSets: sets.map((s) => ({
      id: columnId(s.key),
      title: s.title,
      subcolumns: Array.from({ length: reps }, (_, j) => ({
        type: 'number' as const,
        values: pad(s.reps[j] ?? [], rows),
      })),
    })),
  }
}

/** An XY table: shared X, each set's Y replicates. */
export function xyTable(
  id: string,
  x: readonly Cell[],
  sets: readonly SketchSet[],
  xTitle = 'X',
): DataTable {
  const rows = Math.max(1, x.length)
  const reps = Math.max(1, ...sets.map((s) => s.reps.length))
  return {
    ...base(id, 'xy', rows),
    yFormat: { type: 'replicates', count: reps },
    x: {
      title: xTitle,
      xFormat: 'numbers',
      subcolumns: [{ type: 'number', values: pad(x, rows) }],
    },
    dataSets: sets.map((s) => ({
      id: columnId(s.key),
      title: s.title,
      subcolumns: Array.from({ length: reps }, (_, j) => ({
        type: 'number' as const,
        values: pad(s.reps[j] ?? [], rows),
      })),
    })),
  }
}

/** A survival table: a row per subject, its time in X and 1 (event) or 0 in its group's column. */
export function survivalTable(
  id: string,
  groups: readonly {
    key: string
    title: string
    subjects: readonly { time: number; event: boolean }[]
  }[],
): DataTable {
  const x: Cell[] = []
  const cols: Cell[][] = groups.map(() => [])
  groups.forEach((g, k) => {
    for (const s of g.subjects) {
      x.push(s.time)
      cols.forEach((c, j) => {
        c.push(j === k ? (s.event ? 1 : 0) : null)
      })
    }
  })
  const rows = Math.max(1, x.length)
  return {
    ...base(id, 'survival', rows),
    x: {
      title: 'Time',
      xFormat: 'numbers',
      subcolumns: [{ type: 'number', values: pad(x, rows) }],
    },
    dataSets: groups.map((g, k) => ({
      id: columnId(g.key),
      title: g.title,
      subcolumns: [{ type: 'number', values: pad(cols[k]!, rows) }],
    })),
  }
}

/** A contingency table of counts: rows titled, a column per outcome. */
export function countsTable(
  id: string,
  rowTitles: readonly string[],
  columns: readonly { key: string; title: string; counts: readonly Cell[] }[],
): DataTable {
  const rows = Math.max(1, rowTitles.length)
  return {
    ...base(id, 'contingency', rows),
    rowTitles: [...rowTitles],
    dataSets: columns.map((c) => ({
      id: columnId(c.key),
      title: c.title,
      subcolumns: [{ type: 'number', values: pad(c.counts, rows) }],
    })),
  }
}
