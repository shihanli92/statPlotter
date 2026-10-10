import { expect } from 'vitest'
import type { McRow, TwoWayRMData } from '../src/index.ts'
import { expectDeepClose } from './deep.ts'
import { arr, type Tolerance } from './oracle.ts'

/** Shared by rmanova.test.ts and mixed.test.ts. */

export { arr }

/** null (missing) → NaN. */
export const nanRows = (rows: (number | null)[][]): number[][] =>
  rows.map((r) => r.map((v) => (v === null ? Number.NaN : v)))

export const toData = (input: {
  y: (number | null)[]
  row: number[]
  col: number[]
  subject: number[]
}): TwoWayRMData => ({
  y: arr(input.y).map((v) => (v === null ? Number.NaN : v)),
  row: arr(input.row),
  col: arr(input.col),
  subject: arr(input.subject),
})

export interface CmpExpected {
  diff: number[]
  se: number[]
  df: number[]
  stat: number[]
  p: number[]
  lo: number[]
  hi: number[]
  tolP: number
  method: string
  rowA?: number[]
  rowB?: number[]
  colA?: number[]
  colB?: number[]
}

/** Compares comparison rows with an oracle entry (p at the entry's tolP; Tukey CIs at 1e-6). */
export function expectRows(got: McRow[], e: CmpExpected, tol: Partial<Tolerance>, label: string) {
  const cols = (k: keyof McRow) => got.map((r) => r[k] as number)
  expect(got.length, `${label} rows`).toBe(arr(e.diff).length)
  expectDeepClose(
    { diff: cols('diff'), se: cols('se'), df: cols('df'), stat: cols('stat') },
    { diff: arr(e.diff), se: arr(e.se), df: arr(e.df), stat: arr(e.stat) },
    tol,
    label,
  )
  const pTol = { rtol: tol.rtol ?? 1e-10, atol: e.tolP }
  expectDeepClose(cols('p'), arr(e.p), pTol, `${label} p`)
  // Tukey: critical value by uniroot on R's ptukey; Dunnett: root of the pdun reference.
  const ciTol =
    e.method === 'tukey'
      ? { rtol: 1e-6, atol: 1e-9 }
      : e.method === 'dunnett'
        ? { rtol: Math.max(tol.rtol ?? 1e-10, 1e-9), atol: 1e-8 }
        : tol
  expectDeepClose(cols('lo'), arr(e.lo), ciTol, `${label} lo`)
  expectDeepClose(cols('hi'), arr(e.hi), ciTol, `${label} hi`)
  for (const k of ['rowA', 'rowB', 'colA', 'colB'] as const) {
    if (e[k] !== undefined)
      expect(
        got.map((r) => (r as unknown as Record<string, unknown>)[k]),
        `${label} ${k}`,
      ).toEqual(arr(e[k]))
  }
}
