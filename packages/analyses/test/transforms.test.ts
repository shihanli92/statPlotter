import { describe, expect, it } from 'vitest'
import { expectClose, loadFixtures } from '../../stats/test/oracle.ts'
import { aucDef, frequencyDef } from '../src/frequency.ts'
import { outliersDef } from '../src/outliers.ts'
import { stableId } from '../src/resultTable.ts'
import {
  normalizeDef,
  pruneDef,
  removeBaselineDef,
  transformDef,
  transposeDef,
} from '../src/transform.ts'
import {
  type Cell,
  expectMatrix,
  kvOf,
  makeTable,
  matrixOf,
  num,
  outTable,
  runWithContext as run,
  v,
} from './helpers.ts'

describe('transform, normalize, remove baseline, prune vs R', () => {
  for (const f of loadFixtures<Record<string, unknown>>('processing')) {
    it(f.name, () => {
      const p = f.params as Record<string, unknown>
      const input = f.input as { rows?: Cell[][]; x?: Cell[] | null; dataSets?: Cell[][][] }
      const e = f.expected as Record<string, unknown>
      switch (p.kind) {
        case 'transformAll': {
          const t = makeTable('xy', [input.rows!], input.x)
          for (const [fn, want] of Object.entries(e)) {
            const r = run(transformDef, t, { y: fn, k: p.k })
            expectMatrix(matrixOf(outTable(r), 0), want as Cell[][], f.tol, fn)
          }
          break
        }
        case 'transform': {
          const t = input.x
            ? makeTable('xy', [input.rows!], input.x)
            : makeTable('grouped', [input.rows!])
          const r = run(transformDef, t, { y: p.y, k: p.k, x: p.x ?? 'none', kx: p.kx ?? 1 })
          const out = outTable(r)
          expectMatrix(matrixOf(out, 0), e.rows as Cell[][], f.tol, 'rows')
          if (e.x)
            (e.x as Cell[]).forEach((w, i) => {
              expectClose(out.x!.subcolumns[0]!.values[i] ?? Number.NaN, num(w), f.tol, `x${i}`)
            })
          break
        }
        case 'normalize': {
          const r = run(normalizeDef, makeTable('grouped', [input.rows!]), p)
          expectMatrix(matrixOf(outTable(r), 0), e.rows as Cell[][], f.tol, 'rows')
          break
        }
        case 'baseline': {
          const t = makeTable('grouped', input.dataSets!)
          const r = run(removeBaselineDef, t, {
            ...p,
            baseline: t.dataSets[p.baselineIndex as number]!.id,
          })
          const out = outTable(r)
          const want = e.dataSets as Cell[][][]
          expect(out.dataSets.length).toBe(want.length)
          want.forEach((m, i) => {
            expectMatrix(matrixOf(out, i), m, f.tol, `data set ${i}`)
          })
          break
        }
        case 'prune': {
          const t = makeTable('xy', [input.rows!], input.x)
          const out = outTable(run(pruneDef, t, p))
          expectMatrix(matrixOf(out, 0), e.rows as Cell[][], f.tol, 'rows')
          ;(e.x as Cell[]).forEach((w, i) => {
            expectClose(out.x!.subcolumns[0]!.values[i] ?? Number.NaN, num(w), f.tol, `x${i}`)
          })
          break
        }
        default:
          throw new Error(`unknown kind ${String(p.kind)}`)
      }
    })
  }
})

describe('result tables', () => {
  const t = makeTable('grouped', [
    [
      [1, 2],
      [3, 4],
      [5, null],
    ],
    [
      [10, 20],
      [30, 40],
      [50, 60],
    ],
  ])

  it('keep the source data set ids, whatever the params', () => {
    const a = outTable(run(transformDef, t, { y: 'log10' }))
    const b = outTable(run(transformDef, t, { y: 'sqrt' }))
    expect(a.dataSets.map((d) => d.id)).toEqual(t.dataSets.map((d) => d.id))
    expect(b.dataSets.map((d) => d.id)).toEqual(t.dataSets.map((d) => d.id))
    expect(a.tableKind).toBe('grouped')
    expect(a.rowTitles).toEqual(t.rowTitles)
  })

  it('derive ids of combined data sets deterministically', () => {
    const r1 = outTable(run(removeBaselineDef, t, { mode: 'pairs' }))
    const r2 = outTable(run(removeBaselineDef, t, { mode: 'pairs', operation: 'ratio' }))
    expect(r1.dataSets[0]!.id).toBe(r2.dataSets[0]!.id)
    expect(r1.dataSets[0]!.id).toMatch(/^[0-9a-z]{12}$/)
    expect(stableId('pair', 'a', 'b')).not.toBe(stableId('pair', 'b', 'a'))
    expect(stableId('abc123')).toBe('abc123')
  })

  it('K per data set, and blanks for undefined values', () => {
    const r = run(transformDef, t, {
      y: 'multiplyK',
      k: 2,
      kByDataSet: { [t.dataSets[1]!.id]: 10 },
    })
    const out = outTable(r)
    expect(out.dataSets[0]!.subcolumns[0]!.values).toEqual([2, 6, 10])
    expect(out.dataSets[1]!.subcolumns[1]!.values).toEqual([200, 400, 600])
    const neg = makeTable('column', [[[-1], [4], [9]]])
    const s = run(transformDef, neg, { y: 'sqrt' })
    expect(outTable(s).dataSets[0]!.subcolumns[0]!.values).toEqual([null, 2, 3])
    expect(v(kvOf(s, 'Values left blank (not defined)'))).toBe(1)
    expect(s.diagnostics.map((d) => d.message)).toContain(
      '1 value could not be transformed and was left blank.',
    )
  })

  it('transforms summary data: SD scales with linear transforms; logs keep the means only', () => {
    const st = makeTable(
      'grouped',
      [
        [
          [10, 2, 5],
          [20, 4, 5],
        ],
      ],
      null,
      {
        type: 'summary',
        preset: 'meanSdN',
      },
    )
    const lin = outTable(run(transformDef, st, { y: 'multiplyK', k: -3 }))
    expect(lin.yFormat).toEqual({ type: 'summary', preset: 'meanSdN' })
    expect(matrixOf(lin, 0)).toEqual([
      [-30, 6, 5],
      [-60, 12, 5],
    ])
    const lg = run(transformDef, st, { y: 'log10' })
    expect(outTable(lg).yFormat).toEqual({ type: 'replicates', count: 1 })
    expect(matrixOf(outTable(lg), 0)).toEqual([[1], [Math.log10(20)]])
    const nz = outTable(run(normalizeDef, st, {}))
    expect(matrixOf(nz, 0)).toEqual([
      [0, 20, 5],
      [100, 40, 5],
    ])
  })

  it('rounds to K digits on the decimal digits, as spreadsheets (audit 2, decision 682)', () => {
    const t = makeTable('column', [[[1.005], [2.675], [-1.005], [0.125], [1234.5]]])
    const r = run(transformDef, t, { y: 'round', k: 2 })
    expect(outTable(r).dataSets[0]!.subcolumns[0]!.values).toEqual([
      1.01, 2.68, -1.01, 0.13, 1234.5,
    ])
    const tens = run(transformDef, t, { y: 'round', k: -1 })
    expect(outTable(tens).dataSets[0]!.subcolumns[0]!.values).toEqual([0, 0, 0, 0, 1230])
  })

  it('refuses relational transforms without X', () => {
    const r = run(transformDef, t, { y: 'yDivX' })
    expect(r.status).toBe('error')
  })

  it('transposes rows into data sets', () => {
    const out = outTable(run(transposeDef, t, {}))
    expect(out.tableKind).toBe('grouped')
    expect(out.dataSets.map((d) => d.title)).toEqual(['Row 1', 'Row 2', 'Row 3'])
    expect(out.rowTitles).toEqual(['Group A (1)', 'Group A (2)', 'Group B (1)', 'Group B (2)'])
    expect(matrixOf(out, 2).map((r) => r[0])).toEqual([5, Number.NaN, 50, 60])
  })

  it('every table-producing plugin says so and is registered', () => {
    for (const def of [
      transformDef,
      normalizeDef,
      removeBaselineDef,
      transposeDef,
      pruneDef,
      frequencyDef,
      outliersDef,
    ]) {
      expect(def.producesTable, def.id).toBe(true)
    }
    expect(aucDef.producesTable).toBeUndefined()
  })
})
