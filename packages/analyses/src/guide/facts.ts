import type { NormalizedDataSet, TableFacts, TableKind } from '@ps/model'
import { xLooks } from '../curveAdvice.ts'

// Roadmap 51a: what the guided chooser may know about the table (design §3.1): its shape, counted
// from the data sets chosen, nothing inferential (no test, no P, no fit).

const finite = (v: number) => !Number.isNaN(v) && Number.isFinite(v)

/** The smallest and largest of `values` (no spread: tables can be large). */
function extent(values: readonly number[]): [number, number] {
  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY
  for (const v of values) {
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  return [lo, hi]
}

/** The values of a data set (every replicate; a summary's means). */
function valuesOf(d: NormalizedDataSet): number[] {
  const out: number[] = []
  const arrays = d.data.shape === 'replicates' ? d.data.reps : [d.data.mean]
  for (const a of arrays) for (const v of a) if (finite(v)) out.push(v)
  return out
}

/** How many values a data set has (a summary's N summed). */
function countOf(d: NormalizedDataSet): number {
  if (d.data.shape === 'replicates') return valuesOf(d).length
  let n = 0
  for (let r = 0; r < d.data.n.length; r++) {
    const v = d.data.n[r]!
    if (finite(v) && finite(d.data.mean[r]!)) n += v
  }
  return n
}

/** A row has a value in this data set (any replicate). */
function hasRow(d: NormalizedDataSet, r: number): boolean {
  const arrays = d.data.shape === 'replicates' ? d.data.reps : [d.data.mean]
  return arrays.some((a) => finite(a[r] ?? Number.NaN))
}

/**
 * The facts of the data sets chosen from a table of `kind`. Text variables (multiple-variables
 * tables) count as variables, not groups.
 */
export function tableFacts(kind: TableKind, input: readonly NormalizedDataSet[]): TableFacts {
  const numeric = input.filter((d) => !d.text)
  const groups = numeric.map((d) => ({ key: d.ref.key as string, title: d.title, n: countOf(d) }))
  const all = numeric.flatMap(valuesOf)
  const rows = input.reduce((m, d) => Math.max(m, d.rowCount), 0)
  let completeRows = 0
  if (numeric.length)
    for (let r = 0; r < rows; r++) if (numeric.every((d) => hasRow(d, r))) completeRows++
  const positive = all.filter((v) => v > 0)
  const distinct = new Set(all.slice(0, 100_000))
  const titles = input[0]?.rowTitles ?? []
  const numericRowTitles = titles.filter(
    (t) => t !== null && t.trim() !== '' && finite(Number(t)),
  ).length

  const facts: TableFacts = {
    kind,
    groups,
    raw: numeric.every((d) => d.data.shape === 'replicates'),
    completeRows,
    allPositive: all.length > 0 && positive.length === all.length,
    spanRatio: positive.length ? extent(positive)[1] / extent(positive)[0] : 0,
    wholeNumbers: all.length > 0 && all.every((v) => v >= 0 && Number.isInteger(v)),
    distinctValues: distinct.size,
    replicates: input.reduce(
      (m, d) => Math.max(m, d.data.shape === 'replicates' ? d.data.reps.length : 1),
      1,
    ),
    rows,
    numericRowTitles,
  }

  const xs = input[0]?.x
  if (xs && (kind === 'xy' || kind === 'survival')) {
    // Roadmap 51e (§9.2): the same reading of X as the curve fit's checks (`xLooks`).
    const look = xLooks(xs)
    if (look)
      facts.x = {
        min: look.min,
        max: look.max,
        looksLog: look.looksLog,
        looksConcentration: look.looksConcentration,
        hasZero: look.zeros > 0,
      }
  }

  if (kind === 'contingency' && numeric.length) {
    const counts: number[][] = []
    for (let r = 0; r < rows; r++) {
      const row = numeric.map((d) =>
        d.data.shape === 'replicates' ? (d.data.reps[0]?.[r] ?? NaN) : NaN,
      )
      if (row.some(finite)) counts.push(row.map((v) => (finite(v) ? v : 0)))
    }
    const total = counts.flat().reduce((s, v) => s + v, 0)
    let minExpected = Number.POSITIVE_INFINITY
    for (const row of counts) {
      const rt = row.reduce((s, v) => s + v, 0)
      row.forEach((_, c) => {
        const ct = counts.reduce((s, x) => s + (x[c] ?? 0), 0)
        if (total > 0) minExpected = Math.min(minExpected, (rt * ct) / total)
      })
    }
    facts.contingency = {
      rows: counts.length,
      columns: numeric.length,
      minExpected: Number.isFinite(minExpected) ? minExpected : 0,
    }
  }

  if (kind === 'survival') facts.survival = { codes: [...new Set(all)].sort((a, b) => a - b) }

  if (kind === 'multipleVariables') {
    const of = (d: NormalizedDataSet) => ({ key: d.ref.key as string, title: d.title })
    const binary = numeric.filter((d) => {
      const s = new Set(valuesOf(d))
      return s.size === 2 && s.has(0) && s.has(1)
    })
    facts.variables = {
      numbers: numeric.filter((d) => !binary.includes(d)).map(of),
      texts: input.filter((d) => d.text).map(of),
      binary: binary.map(of),
    }
  }
  return facts
}
