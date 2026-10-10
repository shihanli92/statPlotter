// Data-sized arrays must not be spread into call arguments (Math.max(...values) overflows the
// call stack above ~10⁵ values). The spread guard makes such a call fail at 1000 arguments.

import {
  type AnalysisDef,
  createTable,
  type DataTable,
  normalizeTable,
  type TableKind,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { withSpreadGuard } from '../../stats/test/spreadGuard.ts'
import { aucDef, normalizeDef, pcaDef, threeWayAnovaDef, twoWayAnovaDef } from '../src/index.ts'

const N = 2000

function table(kind: TableKind, columns: number, fill: (i: number, j: number) => number) {
  const t = createTable({ tableKind: kind, columns, rows: N })
  if (t.x) t.x.subcolumns[0]!.values = Array.from({ length: N }, (_, i) => i / 10)
  t.dataSets.forEach((ds, j) => {
    ds.subcolumns[0]!.values = Array.from({ length: N }, (_, i) => fill(i, j))
  })
  return t
}

/** A grouped table of `rows` × `columns` cells, each with 256 replicates (the most allowed). */
function groupedTable(rows: number, columns: number) {
  const t = createTable({
    tableKind: 'grouped',
    yFormat: { type: 'replicates', count: 256 },
    columns,
    rows,
  })
  t.dataSets.forEach((ds, j) => {
    ds.subcolumns.forEach((sub, s) => {
      sub.values = Array.from({ length: rows }, (_, r) => 10 + r + j + Math.sin(s * 7.3 + r * j))
    })
  })
  return t
}

function run<P>(def: AnalysisDef<P>, t: DataTable, params: object = {}) {
  const input = normalizeTable(t)
  const p = def.params.parse(params)
  return withSpreadGuard(() => def.run(input, p, { tableKind: t.tableKind, xTitle: null }))
}

describe('analyses on large data sets spread no data array', () => {
  it('area under the curve', () => {
    const r = run(
      aucDef,
      table('xy', 1, (i) => Math.sin(i / 50)),
    )
    expect(r.status).not.toBe('error')
  })

  it('normalize to the smallest and largest values', () => {
    const r = run(
      normalizeDef,
      table('xy', 1, (i) => (i * 7919) % 1000),
    )
    expect(r.status).toBe('ok')
  })

  it('PCA with a biplot', () => {
    const r = run(
      pcaDef,
      table('multipleVariables', 3, (i, j) => Math.sin(i * (j + 1)) + i / N),
      {
        select: 'kaiser',
        biplot: true,
      },
    )
    expect(r.status).not.toBe('error')
  })

  it('two-way mixed-effects model with both factors repeated (1023 values)', () => {
    const t = groupedTable(2, 2)
    t.dataSets[0]!.subcolumns[0]!.values[0] = null // a missing value: the mixed-effects model
    const r = run(twoWayAnovaDef, t, { repeated: 'both' })
    expect(r.status).not.toBe('error')
  })

  it('three-way ANOVA with repeated rows (2048 values)', () => {
    const r = run(threeWayAnovaDef, groupedTable(2, 4), { repeatedRows: true })
    expect(r.status).not.toBe('error')
  })
})
