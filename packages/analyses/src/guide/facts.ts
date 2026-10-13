import type { NormalizedDataSet, TableFacts, TableKind } from '@ps/model'
import { xLooks } from '../curveAdvice.ts'

// Roadmap 51a: what the guided chooser may know about the table (design §3.1): its shape, counted
// from the data sets chosen, nothing inferential (no test, no P, no fit).

const finite = (v: number) => !Number.isNaN(v) && Number.isFinite(v)

/** Values of a data set: every replicate, a summary's means. */
const arraysOf = (d: NormalizedDataSet): readonly Float64Array[] =>
  d.data.shape === 'replicates' ? d.data.reps : [d.data.mean]

/** How many values a data set has (a summary's N summed). */
function countOf(d: NormalizedDataSet): number {
  let n = 0
  if (d.data.shape === 'replicates') {
    for (const a of d.data.reps) for (let i = 0; i < a.length; i++) if (finite(a[i]!)) n++
    return n
  }
  for (let r = 0; r < d.data.n.length; r++) {
    const v = d.data.n[r]!
    if (finite(v) && finite(d.data.mean[r]!)) n += v
  }
  return n
}

/** A row has a value in this data set (any replicate). */
function hasRow(d: NormalizedDataSet, r: number): boolean {
  for (const a of arraysOf(d)) if (finite(a[r] ?? Number.NaN)) return true
  return false
}

/** Every value is 0 or 1, and both occur (stops at the first other value). */
function isBinary(d: NormalizedDataSet): boolean {
  let zero = false
  let one = false
  for (const a of arraysOf(d))
    for (let i = 0; i < a.length; i++) {
      const v = a[i]!
      if (!finite(v)) continue
      if (v === 0) zero = true
      else if (v === 1) one = true
      else return false
    }
  return zero && one
}

/** At most this many values are looked at for the count of distinct values. */
const DISTINCT_SAMPLE = 100_000

/**
 * Audit 4 (P2): the facts of an input, once per input (the dialog asks again on every change of
 * the options and of the schematic; the input is the same until the data sets or the data change).
 */
const cache = new WeakMap<readonly NormalizedDataSet[], Map<TableKind, TableFacts>>()

/**
 * The facts of the data sets chosen from a table of `kind`. Text variables (multiple-variables
 * tables) count as variables, not groups. The same input gives the same (shared) facts.
 */
export function tableFacts(kind: TableKind, input: readonly NormalizedDataSet[]): TableFacts {
  let byKind = cache.get(input)
  if (!byKind) {
    byKind = new Map()
    cache.set(input, byKind)
  }
  let facts = byKind.get(kind)
  if (!facts) {
    facts = computeFacts(kind, input)
    byKind.set(kind, facts)
  }
  return facts
}

function computeFacts(kind: TableKind, input: readonly NormalizedDataSet[]): TableFacts {
  const numeric = input.filter((d) => !d.text)
  const groups = numeric.map((d) => ({ key: d.ref.key as string, title: d.title, n: countOf(d) }))
  // One pass over every value (no copies: tables can be large).
  let count = 0
  let positives = 0
  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY
  let whole = true
  const distinct = new Set<number>()
  let sampled = 0
  const codes = kind === 'survival' ? new Set<number>() : null
  for (const d of numeric)
    for (const a of arraysOf(d))
      for (let i = 0; i < a.length; i++) {
        const v = a[i]!
        if (!finite(v)) continue
        count++
        if (v > 0) {
          positives++
          if (v < lo) lo = v
          if (v > hi) hi = v
        }
        if (whole && !(v >= 0 && Number.isInteger(v))) whole = false
        if (sampled < DISTINCT_SAMPLE) {
          sampled++
          distinct.add(v)
        }
        codes?.add(v)
      }
  const rows = input.reduce((m, d) => Math.max(m, d.rowCount), 0)
  let completeRows = 0
  if (numeric.length)
    for (let r = 0; r < rows; r++) if (numeric.every((d) => hasRow(d, r))) completeRows++
  const titles = input[0]?.rowTitles ?? []
  const numericRowTitles = titles.filter(
    (t) => t !== null && t.trim() !== '' && finite(Number(t)),
  ).length

  const facts: TableFacts = {
    kind,
    groups,
    raw: numeric.every((d) => d.data.shape === 'replicates'),
    completeRows,
    allPositive: count > 0 && positives === count,
    spanRatio: positives ? hi / lo : 0,
    wholeNumbers: count > 0 && whole,
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

  if (codes) facts.survival = { codes: [...codes].sort((a, b) => a - b) }

  if (kind === 'multipleVariables') {
    const of = (d: NormalizedDataSet) => ({ key: d.ref.key as string, title: d.title })
    const binary = numeric.filter(isBinary)
    facts.variables = {
      numbers: numeric.filter((d) => !binary.includes(d)).map(of),
      texts: input.filter((d) => d.text).map(of),
      binary: binary.map(of),
    }
  }
  return facts
}
