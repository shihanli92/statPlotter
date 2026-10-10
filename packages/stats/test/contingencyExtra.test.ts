import { describe, expect, it } from 'vitest'
import { contingencyPairwise, cramersV, type FamilyMethod, phiCoefficient } from '../src/index.ts'
import { expectDeepClose } from './deep.ts'
import { expectClose, loadFixtures } from './oracle.ts'

interface Params {
  test?: 'fisher' | 'chiSquare'
  yates?: boolean
  compare?: 'all' | 'control'
  control?: number
  method?: FamilyMethod
}

describe('contingency effect sizes and pairwise comparisons vs R', () => {
  for (const f of loadFixtures<
    { table: number[][] },
    { cramersV: number; phi?: number; pairwise: unknown[] }
  >('contingency_extra')) {
    it(f.name, () => {
      const t = f.input.table
      const p = f.params as Params
      expectClose(cramersV(t), f.expected.cramersV, f.tol, 'cramersV')
      if (f.expected.phi !== undefined) {
        expectClose(phiCoefficient(t), f.expected.phi, f.tol, 'phi')
        expectClose(cramersV(t), f.expected.phi, f.tol, 'V = phi for 2 × 2')
      }
      expectDeepClose(contingencyPairwise(t, p), f.expected.pairwise, f.tol, 'pairwise')
    })
  }
})

describe('contingency pairwise invariants', () => {
  it('flags by adjusted P < α and leaves empty rows out of the family', () => {
    const rows = contingencyPairwise(
      [
        [10, 2],
        [0, 0],
        [2, 10],
      ],
      { test: 'chiSquare', method: 'bonferroni' },
    )
    expect(rows.map((r) => [r.rowA, r.rowB])).toEqual([
      [0, 1],
      [0, 2],
      [1, 2],
    ])
    expect(rows[0]!.p).toBeNaN()
    expect(rows[2]!.p).toBeNaN()
    // One tested pair: the Bonferroni family has m = 1.
    expect(rows[1]!.adjusted).toBe(rows[1]!.p)
    expect(rows[1]!.flagged).toBe(true)
  })

  it('rejects a control row outside the table', () => {
    expect(() =>
      contingencyPairwise(
        [
          [1, 2],
          [3, 4],
        ],
        { compare: 'control', control: 2 },
      ),
    ).toThrow(/control row/)
  })

  it('phi and V are NaN with an empty margin', () => {
    expect(
      phiCoefficient([
        [0, 3],
        [0, 4],
      ]),
    ).toBeNaN()
    expect(
      cramersV([
        [0, 3, 1],
        [0, 4, 2],
      ]),
    ).toBeNaN()
  })
})
