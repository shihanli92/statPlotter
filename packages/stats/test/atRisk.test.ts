import { describe, expect, it } from 'vitest'
import { kaplanMeier, numberAtRisk } from '../src/index.ts'
import { expectDeepClose } from './deep.ts'
import { loadFixtures } from './oracle.ts'

// The number at risk at chosen times (roadmap 35): against survival's summary.survfit(times,
// extend = TRUE)$n.risk.

interface Input {
  time: number[]
  event: number[]
  times: number[]
}

const subjects = (input: Input) =>
  input.time.map((time, i) => ({ time, event: input.event[i] === 1 }))

describe('number at risk vs R', () => {
  for (const f of loadFixtures<Input, { nRisk: number[] }>('atrisk')) {
    it(f.name, () => {
      expectDeepClose({ nRisk: numberAtRisk(subjects(f.input), f.input.times) }, f.expected, {
        rtol: 1e-10,
        ...f.tol,
      })
    })
  }
})

describe('number at risk', () => {
  it('agrees with the Kaplan-Meier steps’ number at risk at each step', () => {
    const f = loadFixtures<Input>('atrisk').find((x) => x.name === 'large')!
    const s = subjects(f.input)
    const km = kaplanMeier(s)
    expect(
      numberAtRisk(
        s,
        km.steps.map((st) => st.time),
      ).slice(1),
    ).toEqual(km.steps.slice(1).map((st) => st.atRisk))
  })

  it('is everyone before any time, no one past the last, none without subjects', () => {
    expect(numberAtRisk([{ time: 2, event: true }], [-1, Number.POSITIVE_INFINITY])).toEqual([1, 0])
    expect(numberAtRisk([], [0, 5])).toEqual([0, 0])
  })
})
