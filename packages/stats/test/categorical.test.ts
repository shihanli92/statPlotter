import { describe, expect, it } from 'vitest'
import {
  type DesignVariable,
  designRank,
  designRow,
  levelCombinations,
  linearPredictor,
  marginalMeans,
  multifactorAnova,
  termDesign,
} from '../src/index.ts'

const age: DesignVariable = { kind: 'numeric', name: 'Age', values: [30, 40, 50, 60] }
const arm: DesignVariable = {
  kind: 'categorical',
  name: 'Arm',
  levels: ['P', 'L', 'H'],
  codes: [0, 1, 2, 1],
  reference: 0,
}

describe('dummy-coded designs', () => {
  it('code the non-reference levels and interaction products, first variable slowest', () => {
    const d = termDesign([age, arm], [[0], [1], [0, 1]])
    expect(d.names).toEqual(['Age', 'Arm[L]', 'Arm[H]', 'Age:Arm[L]', 'Age:Arm[H]'])
    expect(d.terms.map((t) => [t.name, t.columns])).toEqual([
      ['Age', [0]],
      ['Arm', [1, 2]],
      ['Age:Arm', [3, 4]],
    ])
    expect(d.X[3]).toEqual([60, 1, 0, 60, 0])
    const other = termDesign([age, { ...arm, reference: 2 }], [[1]])
    expect(other.names).toEqual(['Arm[P]', 'Arm[L]'])
  })

  it('build the design row of a new point', () => {
    expect(designRow([age, arm], [[0], [1], [0, 1]], [45, { level: 2 }])).toEqual([45, 0, 1, 0, 45])
  })

  it('count the rank a term adds', () => {
    const d = termDesign([arm], [[0]])
    expect(designRank(d.X, [0, 1], true)).toBe(3)
    expect(designRank(d.X, [], true)).toBe(1)
  })

  it('predict without aliased coefficients', () => {
    const p = linearPredictor(
      [1, 2, Number.NaN],
      [
        [0.25, 0, Number.NaN],
        [0, 0.04, Number.NaN],
        [Number.NaN, Number.NaN, Number.NaN],
      ],
      [1, 3, 5],
    )
    expect(p.eta).toBe(7)
    expect(p.se).toBeCloseTo(Math.sqrt(0.25 + 9 * 0.04), 14)
  })
})

describe('multifactor ANOVA', () => {
  it('equals one-way ANOVA for one factor, with marginal means = group means', () => {
    const y = [1, 2, 3, 4, 6, 8, 5, 5]
    const g = [0, 0, 0, 1, 1, 1, 2, 2]
    const r = multifactorAnova({ y, factors: [g], nLevels: [3], terms: [[0]] })
    const means = [2, 6, 5]
    const grand = y.reduce((a, b) => a + b) / y.length
    const ssb = [3, 3, 2].reduce((s, n, i) => s + n * (means[i]! - grand) ** 2, 0)
    expect(r.sources[0]!.ss).toBeCloseTo(ssb, 12)
    expect(r.residual.df).toBe(5)
    expect(marginalMeans(r, [0]).map((m) => m.mean)).toEqual(
      means.map((m) => expect.closeTo(m, 12)),
    )
  })

  it('reports aliased interactions (empty cells)', () => {
    const r = multifactorAnova({
      y: [1, 2, 3, 4, 5],
      factors: [
        [0, 0, 1, 1, 0],
        [0, 1, 0, 0, 0],
      ],
      nLevels: [2, 2],
      terms: [[0], [1], [0, 1]],
    })
    expect(r.error).toBe('aliased')
    expect(r.aliasedTerms).toEqual([2])
  })

  it('lists level combinations with the first factor slowest', () => {
    expect(levelCombinations([2, 3], [0, 1])).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 0],
      [1, 1],
      [1, 2],
    ])
  })
})
