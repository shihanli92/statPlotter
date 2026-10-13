import type { NormalizedDataSet } from '@ps/model'

// Roadmap 51b (design §5.7): the words around a sketch — names, counts, plain numbers — shared by
// the families. Only counts, means, SDs and their ratio, ranks: never a test's result.

/** A name in quotes (“untitled” for an empty title). */
export const q = (s: string) => `“${s || 'untitled'}”`

/** "Control, 1 mg and 10 mg" (at most `max` names, then "and 4 more"). */
export function nameList(names: readonly string[], max = 6): string {
  const shown = names.slice(0, max).map((n) => n || 'untitled')
  const rest = names.length - shown.length
  if (rest > 0) return `${shown.join(', ')} and ${rest} more`
  if (shown.length <= 1) return shown.join('')
  return `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`
}

/** "8 values each" or "8, 6 and 7 values". */
export function sizesText(ns: readonly number[]): string {
  if (!ns.length) return 'no values'
  if (ns.every((n) => n === ns[0]))
    return ns.length > 1 ? `${ns[0]} values each` : `${ns[0]} value${ns[0] === 1 ? '' : 's'}`
  return `${nameList(ns.map(String))} values`
}

/** A plain number for a sentence (3 significant digits, no exponent for ordinary sizes). */
export function plain(v: number): string {
  if (!Number.isFinite(v)) return '—'
  const a = Math.abs(v)
  if (a !== 0 && (a < 1e-3 || a >= 1e6)) return v.toPrecision(3)
  return String(+v.toPrecision(3))
}

/** Number of values a data set holds (a summary's N). */
export function countOf(d: NormalizedDataSet): number {
  if (d.data.shape === 'summary') {
    let n = 0
    for (let r = 0; r < d.rowCount; r++) {
      const v = d.data.n[r]!
      if (Number.isFinite(v) && Number.isFinite(d.data.mean[r]!)) n += v
    }
    return n
  }
  let n = 0
  for (const a of d.data.reps) for (const v of a) if (Number.isFinite(v)) n++
  return n
}

/** "3 comparisons" / "1 comparison". */
export const comparisons = (n: number) => `${n} comparison${n === 1 ? '' : 's'}`

/** The counts line (§5.7): parts joined by " · ". */
export const countsLine = (parts: readonly (string | null | false | undefined)[]) =>
  parts.filter(Boolean).join(' · ')
