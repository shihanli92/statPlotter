import { createTable } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { expectClose, loadFixtures } from '../../stats/test/oracle.ts'
import { threeWayAnovaDef } from '../src/index.ts'
import { groupedTable, runDef, tableBlock, v } from './helpers.ts'

type Cells = { levels: number[]; values: number[] }[]
type Cmp = Record<string, number[]>
interface Expected {
  sources: Record<string, number[]>
  effectSizes: Record<string, number[]>
  allCells?: Cmp
  oneFactor?: Cmp
  vsControl?: Cmp
}

/** The 2 × 2 × k layout: row = factor A level; data set = 2·B + C. */
function tableOf(cells: Cells) {
  const R = Math.max(...cells.map((c) => c.levels[0]!)) + 1
  const grid: number[][][] = Array.from({ length: R }, () => [[], [], [], []])
  for (const c of cells) grid[c.levels[0]!]![2 * c.levels[1]! + c.levels[2]!] = c.values
  return groupedTable(grid)
}

const run = (cells: Cells, p: object) => {
  const t = tableOf(cells)
  return runDef(threeWayAnovaDef, t, p)
}

/**
 * The ANOVA table and effect sizes are compared with R for every fixture in
 * stats/test/anovaExtras.test.ts; here one fixture checks that the plugin shows them in the right
 * rows and columns (the fixture without comparisons). The comparisons are only checked here.
 */
const WIRING = 'offset_1e9'

describe('three-way ANOVA plugin vs R', () => {
  for (const f of loadFixtures<{ cells: Cells }>('threeway')) {
    if ((f.params as { summary?: boolean }).summary) continue
    it(f.name, () => {
      const e = f.expected as unknown as Expected
      if (f.name === WIRING) {
        const r = run(f.input.cells, {})
        expect(r.status).toBe('ok')
        const anova = tableBlock(r, 'results', 2)
        anova.rows.slice(0, 7).forEach((row, i) => {
          expectClose(v(row[1]), e.sources.ss![i]!, f.tol, `SS ${i}`)
          expectClose(v(row[5]), e.sources.p![i]!, f.tol, `P ${i}`)
        })
        const es = tableBlock(r, 'results', 3)
        es.rows.forEach((row, i) => {
          expectClose(v(row[2]), e.effectSizes.partialEtaSquared![i]!, f.tol, `pe ${i}`)
          expectClose(v(row[3]), e.effectSizes.partialOmegaSquared![i]!, f.tol, `pw ${i}`)
        })
      }
      if (!e.allCells) return
      const check = (params: object, exp: Cmp, pKey: string, ci?: [string, string]) => {
        const res = run(f.input.cells, params)
        expect(res.status).toBe('ok')
        const b = tableBlock(res, 'comparisons')
        const pCol = b.columns.findIndex((c) => c.startsWith('Adjusted P') || c === 'q value')
        expect(b.rows).toHaveLength(exp.diff!.length)
        b.rows.forEach((row, k) => {
          expectClose(v(row[1]), exp.diff![k]!, f.tol, `diff ${k}`)
          expectClose(v(row[pCol]), exp[pKey]![k]!, f.tol, `${pKey} ${k}`)
          if (ci) {
            const iv = row[2] as { lo: number; hi: number }
            expectClose(iv.lo, exp[ci[0]]![k]!, f.tol, `lo ${k}`)
            expectClose(iv.hi, exp[ci[1]]![k]!, f.tol, `hi ${k}`)
          }
        })
      }
      check({ comparisons: 'allCells' }, e.allCells, 'pTukey', ['loTukey', 'hiTukey'])
      check({ comparisons: 'allCells', allPairsMethod: 'sidak' }, e.allCells, 'pSidak')
      check({ comparisons: 'oneFactor' }, e.oneFactor!, 'pHolmSidak')
      check({ comparisons: 'oneFactor', oneFactorMethod: 'sidak' }, e.oneFactor!, 'pSidak')
      check({ comparisons: 'vsControl', controlMethod: 'sidak' }, e.vsControl!, 'pSidak')
    })
  }
})

describe('three-way ANOVA plugin', () => {
  it('needs every cell', () => {
    const t = groupedTable([
      [
        [1, 2],
        [3, 4],
        [5, 6],
        [7, 8],
      ],
      [[1, 3], [], [5, 7], [8, 9]],
    ])
    const r = runDef(threeWayAnovaDef, t)
    expect(r.status).toBe('error')
    expect(r.diagnostics.at(-1)!.message).toContain('Every cell needs values')
  })

  it('runs from mean/SD/N', () => {
    const t = createTable({
      tableKind: 'grouped',
      yFormat: { type: 'summary', preset: 'meanSdN' },
      columns: 4,
      rows: 2,
    })
    t.dataSets.forEach((ds, d) => {
      for (let r = 0; r < 2; r++) {
        ds.subcolumns[0]!.values[r] = 10 + d + 3 * r
        ds.subcolumns[1]!.values[r] = 1 + 0.1 * d
        ds.subcolumns[2]!.values[r] = 4
      }
    })
    const r = runDef(threeWayAnovaDef, t)
    expect(r.status).toBe('ok')
    expect(tableBlock(r, 'results', 2).rows).toHaveLength(8)
  })

  it('no variation within cells: a warning, no P for zero interactions (audit 3, S2)', () => {
    const grid = [0, 1, 2].map((r) =>
      [0, 1, 2, 3].map((d) => [0, 1].map(() => 0.3 * r + 0.11 * (d >> 1) + 0.7 * (d & 1))),
    )
    const r = runDef(threeWayAnovaDef, groupedTable(grid), { comparisons: 'none' })
    expect(r.status).toBe('warning')
    expect(r.diagnostics.map((d) => d.message).join(' ')).toMatch(/no variation within/)
    const ps = tableBlock(r, 'results', 1).rows.map((row) => v(row[2]))
    expect(ps.slice(0, 3)).toEqual([0, 0, 0])
    expect(ps.slice(3).every(Number.isNaN)).toBe(true)
  })
})
