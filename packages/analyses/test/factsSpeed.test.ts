import { type NormalizedDataSet, normalizeTable } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { cpuRatio } from '../../stats/test/timing.ts'
import { analysisFacts, missingInMatched } from '../src/dialog/facts.ts'
import { tableFacts } from '../src/guide/facts.ts'
import { columnTable, groupedTable, mvTable } from './helpers.ts'

// Audit 4 (P2): the Analyze dialog's facts read the data once per input, in passes that allocate
// nothing per value (they took 590 ms and 341 ms on 250,000 rows × 12 variables, on every change
// of the options).

/** Rows × variables of whole-number-ish values (no random draws: the same data every run). */
function input(rows: number, cols = 12): NormalizedDataSet[] {
  const c: Record<string, (number | null)[]> = {}
  for (let k = 0; k < cols; k++)
    c[`V${k}`] = Array.from({ length: rows }, (_, r) => ((r * 7919 + k * 104729) % 1000) / 10)
  return normalizeTable(mvTable(c))
}

/** One plain pass over every value: the least any fact of every value can cost. */
function sumAll(sets: readonly NormalizedDataSet[]): number {
  let s = 0
  for (const d of sets)
    if (d.data.shape === 'replicates')
      for (const a of d.data.reps)
        for (let i = 0; i < a.length; i++) if (!Number.isNaN(a[i]!)) s += a[i]!
  return s
}

describe('the dialog facts of a large table (audit 4 P2)', () => {
  const big = input(50_000)
  const fresh = () => [...big]

  it('cost a few plain passes over the values, not an allocation per value', () => {
    // Before: ≈ 50 (analysisFacts) and ≈ 22 (tableFacts) times a plain pass; now ≈ 2 and ≈ 4.
    expect(
      cpuRatio(
        () => sumAll(big),
        () => analysisFacts('multipleVariables', fresh()),
      ),
    ).toBeLessThan(10)
    expect(
      cpuRatio(
        () => sumAll(big),
        () => tableFacts('multipleVariables', fresh()),
      ),
    ).toBeLessThan(10)
  })

  it('are read once per input: asking again costs nothing', () => {
    const once = tableFacts('multipleVariables', big)
    expect(tableFacts('multipleVariables', big)).toBe(once)
    analysisFacts('multipleVariables', big, {})
    expect(
      cpuRatio(
        () => analysisFacts('multipleVariables', fresh(), {}),
        () => analysisFacts('multipleVariables', big, { factors: ['V1'] }),
      ),
    ).toBeLessThan(0.1)
    // Each kind its own facts.
    expect(tableFacts('column', big)).not.toBe(once)
  })

  it('the facts are as before', () => {
    const t = columnTable([
      [1, 2, null, 4],
      [0, 1, 1, 0],
      [3, null, 5, 7],
    ])
    const sets = normalizeTable(t)
    expect(analysisFacts('column', sets)).toMatchObject({
      raw: true,
      missingInMatched: true,
      groups: 3,
      rows: 4,
      maxPerCell: 1,
    })
    expect(missingInMatched('column', [sets[1]!, sets[1]!])).toBe(false)
    const f = tableFacts('column', sets)
    expect(f).toMatchObject({
      completeRows: 2,
      allPositive: false,
      wholeNumbers: true,
      distinctValues: 7,
      spanRatio: 7,
    })
    expect(f.groups.map((g) => g.n)).toEqual([3, 4, 3])
    const g = normalizeTable(
      groupedTable([
        [[1, 2], [3]],
        [
          [4, 5],
          [6, 7],
        ],
      ]),
    )
    expect(analysisFacts('grouped', g)).toMatchObject({ missingInMatched: true, maxPerCell: 2 })
    const mv = normalizeTable(mvTable({ a: [0, 1, 1, 0], b: [0, 1, 2, 0], c: [1, 1, 1, 1] }))
    expect(tableFacts('multipleVariables', mv).variables!.binary.map((v) => v.title)).toEqual(['a'])
  })
})
