import { describe, it } from 'vitest'
import { bandwidthNrd0, kernelDensity } from '../src/index.ts'
import { expectClose, loadFixtures } from './oracle.ts'

// The graph layers' statistics (roadmap 33): violin densities against R (bw.nrd0 and the
// Gaussian kernel density evaluated exactly; tools/oracle/r/graphstats.R).

interface In {
  values: number[]
  at: number[]
}
interface Expected {
  bw: number
  density: number[]
}

describe('kernel density vs R', () => {
  for (const f of loadFixtures<In, Expected>('graphstats')) {
    it(f.name, () => {
      const adjust = (f.params.adjust as number | undefined) ?? 1
      const bw = bandwidthNrd0(f.input.values) * adjust
      expectClose(bw, f.expected.bw, f.tol, 'bandwidth')
      f.input.at.forEach((at, i) => {
        expectClose(
          kernelDensity(f.input.values, bw, at),
          f.expected.density[i]!,
          f.tol,
          `density at ${at}`,
        )
      })
    })
  }
})
