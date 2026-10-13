import { resolveResultRef } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { registry } from '../src/index.ts'
import {
  expectEveryDesign,
  INPUTS,
  PROFILED,
  SETTINGS,
  WITH_TEMPLATES,
} from './graphResultsCases.ts'
import { columnTable, runWithContext } from './helpers.ts'

// Results on graphs (roadmap 35): every ready label, line and band an analysis offers names values
// its results have, for every design (graphResultsCases.ts). The curve fits' designs are checked
// in graphResultsFit.test.ts and graphResultsFitMV.test.ts (audit 4, T8), beside this file.

describe('ready results on graphs: every design, every field, the sheet’s value', () => {
  it('covers every analysis with ready results and every table kind it accepts', () => {
    expect(WITH_TEMPLATES.map((d) => d.id).sort()).toEqual(Object.keys(INPUTS).sort())
    for (const def of WITH_TEMPLATES) {
      const params = def.params.parse({}) as Record<string, unknown>
      const kinds = new Set(INPUTS[def.id]!(params).map((i) => i.table.tableKind))
      expect([...kinds].sort(), def.id).toEqual([...def.accepts].sort())
    }
    // The curve fits, each in a file of its own.
    expect([...PROFILED].sort()).toEqual(['nonlinearFit', 'nonlinearFitMV'])
  })

  it.each(WITH_TEMPLATES.filter((d) => !PROFILED.has(d.id)).map((d) => [d.id, d] as const))(
    '%s',
    (_, def) => expectEveryDesign(def),
  )
})

describe('ready results on graphs: particular cases', () => {
  it('labels the paired t test with its df (pairs − 1), not the number of pairs', () => {
    const def = registry.get('ttest')!
    const table = columnTable([
      [12, 15, 11, 14, 13],
      [18, 21, 17, 22, 20],
    ])
    const params = { design: 'paired' }
    const result = runWithContext(def, table, params)
    const t = def.graphResults!(def.params.parse(params), { tableKind: 'column', dataSets: [] })
    const df = t.find((x) => x.id === 'tdf')!.stat.fields.df!
    expect(resolveResultRef(result, df.ref, SETTINGS)).toEqual({ kind: 'integer', v: 4 })
  })

  it('labels matched one-way ANOVA with its own F and df, and Friedman with its statistic', () => {
    const def = registry.get('oneWayAnova')!
    const table = columnTable([
      [12, 15, 11, 14],
      [18, 21, 17, 22],
      [9, 11, 10, 8],
    ])
    const ctx = { tableKind: 'column' as const, dataSets: [] }
    const rm = runWithContext(def, table, { matched: true })
    const f = def.graphResults!(def.params.parse({ matched: true }), ctx).find((x) => x.id === 'F')!
    const at = (k: string) => resolveResultRef(rm, f.stat.fields[k]!.ref, SETTINGS)
    // Sphericity not assumed (the default): Geisser-Greenhouse corrected df, as the sheet shows.
    const row = rm.sheets
      .find((s) => s.key === 'results')!
      .blocks.flatMap((b) => (b.type === 'keyValue' ? b.rows : []))
    const fRow = row.find((r) => r.label === 'F (DFn, DFd)')!.value
    const dfn = (at('dfn') as { v: number }).v
    const dfd = (at('dfd') as { v: number }).v
    expect(fRow).toMatchObject({ kind: 'text' })
    expect((fRow as { v: string }).v).toBe(
      `F (${+dfn.toPrecision(4)}, ${+dfd.toPrecision(4)}) = ${+(at('F') as { v: number }).v.toPrecision(4)}`,
    )
    const fr = runWithContext(def, table, { matched: true, gaussian: false })
    const tpl = def.graphResults!(def.params.parse({ matched: true, gaussian: false }), ctx)
    expect(tpl.some((x) => x.title.startsWith('Kruskal-Wallis'))).toBe(false)
    const stat = tpl.find((x) => x.id === 'friedman')!.stat.fields.stat!
    const sheetStat = fr.sheets
      .find((s) => s.key === 'results')!
      .blocks.flatMap((b) => (b.type === 'keyValue' ? b.rows : []))
    expect(resolveResultRef(fr, stat.ref, SETTINGS)).toEqual(
      sheetStat.find((r) => r.label === 'Friedman statistic')!.value,
    )
  })

  it('offers IC50 (or EC50) with drop lines at its X: the log on a log form', () => {
    const def = registry.get('nonlinearFit')!
    const ctx = { tableKind: 'xy' as const, dataSets: ['a'] }
    const log = def.graphResults!(def.params.parse({}), ctx)
    expect(log.find((t) => t.kind === 'line')?.stat).toMatchObject({ at: 'LogEC50', drop: 'both' })
    const conc = def.graphResults!(
      def.params.parse({ equation: 'inhibitor-conc-response-variable-slope' }),
      ctx,
    )
    expect(conc.find((t) => t.kind === 'line')?.stat).toMatchObject({ at: 'IC50' })
    expect(conc.find((t) => t.id === 'IC50')?.stat.fields.IC50?.format).toMatchObject({
      axisUnit: 'x',
    })
    // Fit Ki fits logKi on a log X: its IC50 (derived, a concentration) is offered as a value
    // only, with no drop lines (they would sit at the concentration on the log axis) or CI.
    const ki = def.graphResults!(def.params.parse({ equation: 'one-site-fit-logki' }), ctx)
    expect(ki.map((t) => t.id)).toEqual(['IC50', 'topBottom', 'r2'])
    expect(ki[0]!.stat.fields.IC50?.ref).toMatchObject({ block: 'Best-fit values', row: 'IC50' })
  })
})
