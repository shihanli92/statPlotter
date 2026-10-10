import {
  type CellColumn,
  type DataTable,
  isYFormatAllowed,
  type SubcolumnRole,
  type SummaryPreset,
  subcolumnRoles,
  tidyNumber,
  type YFormat,
} from '@ps/model'

// Changing a table's entry format without retyping it (roadmap 31): replicates → a summary
// (mean with SD, SEM or CV, and N) computed from the values; between summaries whose spread
// converts exactly given N (SD = SEM·√N = CV·|mean|); mean ± errors ↔ upper / lower limits.
// Replicate counts change with `table.setReplicateCount`.

/** Summary formats whose spread is an SD, an SEM or a CV (convertible into each other). */
const SPREAD: readonly SummaryPreset[] = ['meanSdN', 'meanSemN', 'meanCvN', 'meanSd', 'meanSem']
const LIMITS: readonly SummaryPreset[] = ['meanPlusMinus', 'meanUpperLower']

const sameFormat = (a: YFormat, b: YFormat) =>
  a.type === 'replicates'
    ? b.type === 'replicates' && a.count === b.count
    : b.type === 'summary' && a.preset === b.preset

/** Whether a table in `from` can be converted to `to` by `convertTable` (not the same format). */
export function canConvert(kind: DataTable['tableKind'], from: YFormat, to: YFormat): boolean {
  if (sameFormat(from, to) || !isYFormatAllowed(kind, to) || to.type === 'replicates') return false
  if (from.type === 'replicates') return SPREAD.includes(to.preset)
  const group = (p: SummaryPreset) => (SPREAD.includes(p) ? 1 : LIMITS.includes(p) ? 2 : 0)
  return group(from.preset) === group(to.preset)
}

export interface Conversion {
  /** The table's data sets' new subcolumns (by data set, in order) and row count. */
  subcolumns: CellColumn[][]
  rowCount: number
  /**
   * Entered values the new format can't hold or derive (replicates summarized; N dropped; an SEM
   * without N, which gives no SD), counted.
   */
  lost: number
}

const finite = (v: number) => (Number.isFinite(v) ? tidyNumber(v) : null)

/** Mean, SD (n − 1), N of the values given (null when not defined). */
function summarize(values: readonly number[]) {
  const n = values.length
  if (!n) return { mean: null, sd: null, n: null }
  const mean = values.reduce((a, b) => a + b, 0) / n
  const sd = n > 1 ? Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1)) : null
  return { mean, sd, n }
}

/** A value per target role from mean, SD and N (SEM = SD/√N, CV = SD/|mean|, a fraction). */
function fromStats(
  role: SubcolumnRole,
  s: { mean: number | null; sd: number | null; n: number | null },
): number | null {
  const { mean, sd, n } = s
  switch (role) {
    case 'mean':
      return mean === null ? null : finite(mean)
    case 'sd':
      return sd === null ? null : finite(sd)
    case 'sem':
      return sd === null || n === null || n <= 0 ? null : finite(sd / Math.sqrt(n))
    case 'cv':
      return sd === null || mean === null || mean === 0 ? null : finite(sd / Math.abs(mean))
    case 'n':
      return n
    default:
      return null
  }
}

/**
 * The table's values in format `to` (see `canConvert`). Excluded values are left out of
 * summaries; in summary → summary conversions a cell stays excluded when the value it comes from
 * was. A column table's replicates (stacked in rows) become one row per data set.
 */
export function convertTable(t: DataTable, to: YFormat): Conversion {
  if (!canConvert(t.tableKind, t.yFormat, to)) throw new RangeError('these formats do not convert')
  const roles = subcolumnRoles(to)
  const fromRoles = subcolumnRoles(t.yFormat)
  let lost = 0
  const cell = (c: CellColumn | undefined, r: number) =>
    c && !c.excluded?.[r] ? (c.values[r] ?? null) : null

  // Replicates → summary: of each row's replicates (a column table: of the whole column).
  if (t.yFormat.type === 'replicates') {
    const stacked = t.tableKind === 'column'
    const rowCount = stacked ? 1 : t.rowCount
    const subcolumns = t.dataSets.map((d) => {
      const rowsOf = (r: number) =>
        (stacked ? d.subcolumns[0]!.values.map((_, i) => i) : [r]).flatMap((row) =>
          (stacked ? [d.subcolumns[0]] : d.subcolumns).flatMap((c) => {
            const v = cell(c, row)
            return v === null ? [] : [v]
          }),
        )
      const stats = Array.from({ length: rowCount }, (_, r) => summarize(rowsOf(r)))
      for (const c of d.subcolumns) lost += c.values.filter((v) => v !== null).length
      return roles.map((role) => ({
        type: 'number' as const,
        values: stats.map((s) => fromStats(role, s)),
      }))
    })
    return { subcolumns, rowCount, lost }
  }

  // Summary → summary. Each target value comes from one entered value (its source role).
  const pair: Partial<Record<SubcolumnRole, SubcolumnRole>> = {
    upper: 'plusErr',
    lower: 'minusErr',
    plusErr: 'upper',
    minusErr: 'lower',
  }
  const spreadOf = (rs: readonly SubcolumnRole[]) => rs.find((x) => x !== 'mean' && x !== 'n')
  const sourceRole = (role: SubcolumnRole): SubcolumnRole | undefined =>
    fromRoles.includes(role)
      ? role
      : role === 'mean' || role === 'n'
        ? undefined
        : SPREAD.includes((to as { preset: SummaryPreset }).preset)
          ? spreadOf(fromRoles)
          : pair[role]
  const subcolumns = t.dataSets.map((d) => {
    const col = (role: SubcolumnRole | undefined) =>
      role === undefined ? undefined : d.subcolumns[fromRoles.indexOf(role)]
    const at = (role: SubcolumnRole, r: number) =>
      cell(col(fromRoles.includes(role) ? role : undefined), r)
    const out = roles.map(() => ({ values: [] as (number | null)[], excluded: [] as boolean[] }))
    for (let r = 0; r < t.rowCount; r++) {
      const mean = at('mean', r)
      const n = at('n', r)
      const sd = at('sd', r)
      const sem = at('sem', r)
      const cv = at('cv', r)
      const spread =
        sd ??
        (sem !== null && n !== null && n > 0 ? sem * Math.sqrt(n) : null) ??
        (cv !== null && mean !== null ? Math.abs(cv * mean) : null)
      const plus =
        at('plusErr', r) ??
        (at('upper', r) === null || mean === null ? null : at('upper', r)! - mean)
      const minus =
        at('minusErr', r) ??
        (at('lower', r) === null || mean === null ? null : mean - at('lower', r)!)
      const values = roles.map((role): number | null => {
        if (role === 'plusErr') return plus === null ? null : finite(plus)
        if (role === 'minusErr') return minus === null ? null : finite(minus)
        if (role === 'upper') return plus === null || mean === null ? null : finite(mean + plus)
        if (role === 'lower') return minus === null || mean === null ? null : finite(mean - minus)
        return fromStats(role, { mean, sd: spread, n })
      })
      roles.forEach((role, i) => {
        out[i]!.values.push(values[i]!)
        out[i]!.excluded.push(!!col(sourceRole(role))?.excluded?.[r])
      })
      // Entered values with no place in the new format, or that give no value there.
      fromRoles.forEach((role, i) => {
        if (role === 'mean' || d.subcolumns[i]!.values[r] === null) return
        const target = roles.findIndex((x) => sourceRole(x) === role)
        if (target < 0 || values[target] === null) lost++
      })
    }
    return out.map(
      (c): CellColumn =>
        c.excluded.includes(true)
          ? { type: 'number', values: c.values, excluded: c.excluded }
          : { type: 'number', values: c.values },
    )
  })
  return { subcolumns, rowCount: t.rowCount, lost }
}
