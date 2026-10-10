import { describe, expect, it } from 'vitest'
import { expectClose, loadFixtures } from '../../stats/test/oracle.ts'
import { boxStats, centerOf, errorBounds, statsOfPoints } from '../src/index.ts'

// Roadmap 30: the geometric error bars and the box plots' whisker percentiles against R
// (tools/oracle/r/plotstats.R).

interface In {
  values: number[]
}
interface Expected {
  n: number
  geoMean: number
  geoSdFactor: number
  geoSdLo: number
  geoSdHi: number
  geoCiLo: number
  geoCiHi: number
  probs: number[]
  quantiles: number[]
  q1: number
  q3: number
  tukeyLo: number
  tukeyHi: number
  outliers: number[] | number
}

const WHISKERS = [
  ['p1p99', 0.01],
  ['p025p975', 0.025],
  ['p5p95', 0.05],
  ['p10p90', 0.1],
] as const

describe('graph statistics vs R', () => {
  for (const f of loadFixtures<In, Expected>('plotstats')) {
    it(f.name, () => {
      const level = (f.params.level as number | undefined) ?? 0.95
      const s = statsOfPoints(
        f.input.values.map((value, row) => ({ value, row })),
        level,
      )
      const e = f.expected
      expect(s.n).toBe(e.n)
      expectClose(s.gmean, e.geoMean, f.tol, 'geometric mean')
      expectClose(s.gsdf, e.geoSdFactor, f.tol, 'geometric SD factor')
      expectClose(s.gciLo, e.geoCiLo, f.tol, 'geometric CI lo')
      expectClose(s.gciHi, e.geoCiHi, f.tol, 'geometric CI hi')
      // Error bars around the geometric mean, whatever the centre passed.
      const sd = errorBounds(s, 'geoSD', s.mean)
      const ci = errorBounds(s, 'geoCI', s.mean)
      if (Number.isNaN(e.geoSdLo)) expect(sd).toBeNull()
      else {
        expectClose(sd![0], e.geoSdLo, f.tol, 'geoSD lo')
        expectClose(sd![1], e.geoSdHi, f.tol, 'geoSD hi')
      }
      if (Number.isNaN(e.geoCiLo)) expect(ci).toBeNull()
      else expect(ci).toEqual([s.gciLo, s.gciHi])
      expect(centerOf(s, 'geomean')).toBe(s.gmean)
      // Whiskers.
      for (const [w, p] of WHISKERS) {
        const b = boxStats(s, w)!
        expectClose(b.whiskerLo, e.quantiles[e.probs.indexOf(p)]!, f.tol, `${w} lo`)
        expectClose(b.whiskerHi, e.quantiles[e.probs.indexOf(1 - p)]!, f.tol, `${w} hi`)
        const outside = s.points
          .map((q) => q.value)
          .filter((v) => v < b.whiskerLo || v > b.whiskerHi)
        expect(b.outliers.map((o) => o.value).sort((a, c) => a - c)).toEqual(
          outside.sort((a, c) => a - c),
        )
      }
      const t = boxStats(s, 'tukey')!
      expectClose(t.q1, e.q1, f.tol, 'q1')
      expectClose(t.q3, e.q3, f.tol, 'q3')
      expect(t.whiskerLo).toBe(e.tukeyLo)
      expect(t.whiskerHi).toBe(e.tukeyHi)
      // (R writes a single outlier as a number.)
      expect(t.outliers.map((o) => o.value).sort((a, c) => a - c)).toEqual([e.outliers].flat())
    })
  }
})
