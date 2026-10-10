import { describe, expect, it } from 'vitest'
import { compareSurvival, kaplanMeier, type SurvivalSubject } from '../src/index.ts'
import { expectDeepClose } from './deep.ts'
import { loadFixtures } from './oracle.ts'

interface Input {
  time: number[][]
  event: number[][]
}

interface Params {
  confLevel?: number
  ciMethod?: 'asymmetric' | 'symmetric'
}

function subjects(input: Input): SurvivalSubject[][] {
  return input.time.map((t, j) => t.map((time, i) => ({ time, event: input.event[j]![i] === 1 })))
}

describe('survival vs R', () => {
  for (const f of loadFixtures<Input>('survival')) {
    it(f.name, () => {
      const p = f.params as Params
      const groups = subjects(f.input)
      const { km, ...cmp } = f.expected as { km: unknown[] } & Record<string, unknown>
      groups.forEach((g, j) => {
        expectDeepClose(
          kaplanMeier(g, { confLevel: p.confLevel, ciMethod: p.ciMethod }),
          km[j],
          f.tol,
          `km[${j}]`,
        )
      })
      expectDeepClose(compareSurvival(groups, { confLevel: p.confLevel }), cmp, f.tol)
    })
  }
})

describe('survival invariants', () => {
  const a: SurvivalSubject[] = [
    { time: 3, event: true },
    { time: 5, event: false },
    { time: 7, event: true },
    { time: 9, event: true },
  ]
  const b: SurvivalSubject[] = [
    { time: 2, event: true },
    { time: 4, event: true },
    { time: 6, event: false },
    { time: 8, event: true },
  ]

  it('swapping the groups inverts the hazard ratios and the median ratio', () => {
    const ab = compareSurvival([a, b])
    const ba = compareSurvival([b, a])
    expect(ba.logRank.chiSq).toBeCloseTo(ab.logRank.chiSq, 12)
    expect(ba.hazardRatio!.mantelHaenszel.value).toBeCloseTo(
      1 / ab.hazardRatio!.mantelHaenszel.value,
      12,
    )
    expect(ba.hazardRatio!.logRank.lower).toBeCloseTo(1 / ab.hazardRatio!.logRank.upper, 12)
    expect(ba.medianRatio!.value).toBeCloseTo(1 / ab.medianRatio!.value, 12)
  })

  it('degenerate input does not throw', () => {
    const empty = kaplanMeier([])
    expect(empty.n).toBe(0)
    expect(empty.steps).toEqual([])
    expect(empty.median.value).toBeNaN()
    const r = compareSurvival([a, []])
    expect(r.logRank.chiSq).toBeNaN()
    expect(r.logRank.df).toBe(0)
    expect(r.hazardRatio!.logRank.value).toBeNaN()
    expect(r.medianRatio).toBeNull()
    const none = compareSurvival([])
    expect(none.logRank.chiSq).toBeNaN()
    expect(none.logRankTrend).toBeNull()
    const censored = compareSurvival([[{ time: 1, event: false }], [{ time: 2, event: false }]])
    expect(censored.logRank.p).toBeNaN()
  })

  it('rejects invalid times', () => {
    expect(() => kaplanMeier([{ time: -1, event: true }])).toThrow(/≥ 0/)
    expect(() => kaplanMeier([{ time: Number.NaN, event: true }])).toThrow()
  })
})
