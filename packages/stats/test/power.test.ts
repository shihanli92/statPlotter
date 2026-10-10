import { describe, expect, it } from 'vitest'
import {
  noncentralTCdf,
  powerAnova,
  powerCorrelation,
  powerLogRank,
  powerProportions,
  powerT,
  solveSampleSize,
  type Tails,
} from '../src/index.ts'
import { expectClose, loadFixtures } from './oracle.ts'

interface P {
  design: 'ttest' | 'anova' | 'prop' | 'cor' | 'logrank'
  type?: 'two.sample' | 'paired' | 'one.sample'
  delta?: number
  sd?: number
  groups?: number
  betweenVar?: number
  withinVar?: number
  p1?: number
  p2?: number
  r?: number
  hr?: number
  alpha: number
  tails?: Tails
  n: number
  target: number
  lo: number
}

function powerFn(p: P): (n: number) => number {
  const t = p.tails ?? 2
  switch (p.design) {
    case 'ttest': {
      const kind = p.type === 'two.sample' ? 'two' : p.type === 'paired' ? 'paired' : 'one'
      return (n) => powerT(n, p.delta!, p.sd!, p.alpha, kind, t)
    }
    case 'anova':
      return (n) => powerAnova(n, p.groups!, p.betweenVar!, p.withinVar!, p.alpha)
    case 'prop':
      return (n) => powerProportions(n, p.p1!, p.p2!, p.alpha, t)
    case 'cor':
      return (n) => powerCorrelation(n, p.r!, p.alpha, t)
    case 'logrank':
      return (n) => powerLogRank(n, p.hr!, p.alpha, t)
  }
}

describe('power and sample size vs R', () => {
  for (const f of loadFixtures<unknown, { power: number; nFor: number }>('power')) {
    it(f.name, () => {
      const p = f.params as unknown as P
      const pw = powerFn(p)
      expectClose(pw(p.n), f.expected.power, f.tol, 'power')
      // Root-finding on both sides to ~1e−13 of n.
      expectClose(solveSampleSize(pw, p.target, p.lo), f.expected.nFor, f.tol, 'n')
    })
  }
})

describe('noncentral t', () => {
  it('reduces to the central t at ncp 0 and handles both tails', () => {
    expect(noncentralTCdf(1.5, 10, 0)).toBeCloseTo(0.9177463, 7)
    const lo = noncentralTCdf(-1, 7, 2)
    const hi = noncentralTCdf(-1, 7, 2, false)
    expect(lo + hi).toBeCloseTo(1, 14)
  })
})
