import { normalizeTable } from '@ps/model'
import { pca, principalComponentRegression, qqPlot } from '@ps/stats'
import { describe, expect, it } from 'vitest'
import { normalityDef, pcaDef } from '../src/index.ts'
import { columnTable, mvTable, runDef, tableBlock, v } from './helpers.ts'

describe('normality test: QQ plot', () => {
  const a = [4.1, 5.3, 3.8, 6.2, 5.0, 4.7, 5.9, 4.4, 5.1, 4.9]
  const b = [12, 15, 9, 22, 14, 11, 30, 13, 17, 10]
  it('declares and draws one QQ series per column plus the line of identity', () => {
    const t = columnTable([a, b])
    const keys = t.dataSets.map((d) => d.id)
    const params = normalityDef.params.parse({ qqPlot: true })
    const decl = normalityDef.outputs!(keys, params)
    expect(decl.map((d) => d.key)).toEqual([`qq:${keys[0]}`, `qq:${keys[1]}`, 'qq:identity'])
    expect(decl.every((d) => d.graph?.id === 'qq')).toBe(true)
    const r = normalityDef.run(normalizeTable(t), params)
    const q = qqPlot(a)
    expect(r.outputs[`qq:${keys[0]}`]).toEqual({
      title: t.dataSets[0]!.title,
      x: q.actual,
      y: q.predicted,
    })
    const id = r.outputs['qq:identity']!
    expect(id.x).toEqual(id.y)
  })
  it('is on by default (51c, S14), off when unticked, and lognormal when only lognormality is tested', () => {
    const t = columnTable([b])
    expect(normalityDef.outputs!([t.dataSets[0]!.id], normalityDef.params.parse({}))).toHaveLength(
      2,
    )
    expect(
      normalityDef.outputs!([t.dataSets[0]!.id], normalityDef.params.parse({ qqPlot: false })),
    ).toEqual([])
    const r = runDef(normalityDef, t, { qqPlot: true, distribution: 'lognormal' })
    expect(r.outputs[`qq:${t.dataSets[0]!.id}`]!.y).toEqual(
      qqPlot(b, { lognormal: true }).predicted,
    )
  })
})

describe('PCA: loadings plot, biplot, principal component regression', () => {
  const cols = {
    Y: [5.1, 6.3, 4.2, 7.9, 6.6, 5.5, 8.1, 4.9, 6.0, 7.2, 5.8, 6.9],
    A: [1.2, 2.1, 0.8, 3.3, 2.4, 1.5, 3.6, 1.0, 1.9, 2.9, 1.7, 2.6],
    B: [1.0, 2.3, 0.9, 3.0, 2.6, 1.2, 3.8, 1.1, 2.2, 2.7, 1.4, 2.9],
    C: [7.1, 5.2, 6.8, 4.1, 5.5, 6.0, 3.9, 7.4, 5.9, 4.6, 6.3, 5.0],
  }
  it('draws each variable as a vector from the origin', () => {
    const t = mvTable({ A: cols.A, B: cols.B, C: cols.C })
    const params = pcaDef.params.parse({
      select: 'fixed',
      components: 2,
      biplot: true,
      loadingsPlot: true,
    })
    const r = pcaDef.run(normalizeTable(t), params)
    const ref = pca(
      cols.A.map((_, i) => [cols.A[i]!, cols.B[i]!, cols.C[i]!]),
      { select: { method: 'fixed', value: 2 } },
    )
    const kA = t.dataSets[0]!.id
    expect(r.outputs[`loading:${kA}`]).toEqual({
      title: 'A',
      x: [0, ref.loadings[0]![0]],
      y: [0, ref.loadings[0]![1]],
    })
    const bi = r.outputs[`biplot:${kA}`]!
    const sMax = Math.max(...ref.scores.flatMap((s) => [Math.abs(s[0]!), Math.abs(s[1]!)]))
    const lMax = Math.max(...ref.loadings.flatMap((l) => [Math.abs(l[0]!), Math.abs(l[1]!)]))
    expect(bi.x[1]).toBeCloseTo((ref.loadings[0]![0]! * 0.9 * sMax) / lMax, 12)
    const keys = t.dataSets.map((d) => d.id)
    const decl = pcaDef.outputs!(keys, params).map((d) => d.key)
    expect(decl).toEqual(expect.arrayContaining(['loadings', 'biplot:scores', `biplot:${kA}`]))
  })

  it('runs PCR with the outcome left out of the PCA', () => {
    const t = mvTable(cols)
    const yKey = t.dataSets[0]!.id
    const params = pcaDef.params.parse({
      select: 'fixed',
      components: 2,
      pcr: true,
      pcrY: yKey,
      loadingsPlot: true,
    })
    const r = pcaDef.run(normalizeTable(t), params)
    expect(r.status).toBe('ok')
    const X = cols.A.map((_, i) => [cols.A[i]!, cols.B[i]!, cols.C[i]!])
    const ref = principalComponentRegression(cols.Y, X, ['A', 'B', 'C'], {
      select: { method: 'fixed', value: 2 },
    })
    const b = tableBlock(r, 'pcr', 1)
    expect(b.rows.map((row) => (row[0] as { v: string }).v)).toEqual(['Intercept', 'A', 'B', 'C'])
    expect(v(b.rows[1]![1])).toBeCloseTo(ref.original[1]!.estimate, 12)
    // The loadings plot has no vector for the outcome.
    expect(
      pcaDef.outputs!(
        t.dataSets.map((d) => d.id),
        params,
      ).map((d) => d.key),
    ).not.toContain(`loading:${yKey}`)
  })
})
