import {
  type AnalysisDef,
  type AnalysisResult,
  createTable,
  type DataTable,
  normalizeTable,
  type ResultValue,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { arr, expectClose, loadFixtures } from '../../stats/test/oracle.ts'
import {
  coxRegressionDef,
  logisticRegressionDef,
  multifactorAnovaDef,
  multipleRegressionDef,
  poissonRegressionDef,
  survivalDef,
  survivalFromVariablesDef,
} from '../src/index.ts'
import { kvOf, runDef, v } from './helpers.ts'

type Column = (number | string | null)[]
type Columns = Record<string, Column>

/** A multiple-variables table; columns holding any string are text variables. */
export function mvTextTable(cols: Columns): DataTable {
  const names = Object.keys(cols)
  const rows = Math.max(...names.map((n) => cols[n]!.length))
  const t = createTable({ tableKind: 'multipleVariables', columns: names.length, rows })
  names.forEach((n, i) => {
    const ds = t.dataSets[i]!
    ds.title = n
    const v = cols[n]!
    if (v.some((x) => typeof x === 'string'))
      ds.text = Array.from({ length: rows }, (_, r) => (v[r] == null ? null : String(v[r])))
    else ds.subcolumns[0]!.values = Array.from({ length: rows }, (_, r) => (v[r] as number) ?? null)
  })
  return t
}

const iv = (x: ResultValue | undefined) => x as { lo: number; hi: number }

function block(r: AnalysisResult, sheet: string, title: string) {
  const s = r.sheets.find((x) => x.key === sheet)
  const b = s?.blocks.find((x) => x.type === 'table' && x.title?.startsWith(title))
  if (b?.type !== 'table')
    throw new Error(`no ${title}: ${r.diagnostics.map((d) => d.message).join('; ')}`)
  return b
}
const col = (b: { columns: string[] }, name: string) => {
  const j = b.columns.findIndex((c) => c === name || c.startsWith(name))
  if (j < 0) throw new Error(`no column ${name} in ${b.columns.join(', ')}`)
  return j
}
/** Replaces variable names by data set keys in the params the fixtures give. */
function keyed(t: DataTable, p: Record<string, unknown>): Record<string, unknown> {
  const key = (name: string) => t.dataSets.find((d) => d.title === name)!.id as string
  const out: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(p)) {
    if (x === null || x === undefined) out[k] = x
    else if (['y', 'time', 'event', 'status', 'compareFactor', 'byFactor'].includes(k))
      out[k] = key(String(x))
    else if (k === 'categorical' || k === 'groups' || k === 'factors')
      out[k] = (x as string[]).map(key)
    else if (k === 'interactions') out[k] = (x as string[][]).map((t2) => t2.map(key))
    else if (k === 'referenceLevels')
      out[k] = Object.fromEntries(
        Object.entries(x as Record<string, string>).map(([n, l]) => [key(n), l]),
      )
    else if (k === 'predictions' || k === 'survivalCurves')
      out[k] = (x as Record<string, unknown>[]).map((pt) =>
        Object.fromEntries(Object.entries(pt).map(([n, l]) => [key(n), l])),
      )
    else out[k] = x
  }
  return out
}

function run(def: AnalysisDef<unknown>, cols: Columns, p: Record<string, unknown>) {
  const t = mvTextTable(cols)
  const params = def.params.parse(keyed(t, p))
  return def.run(normalizeTable(t), params, { tableKind: 'multipleVariables', xTitle: null })
}

/** Our coefficient names as R's: 'Sex[M]:Arm[B]' → 'SexM:ArmB'. */
const rName = (s: string) => (s === 'Intercept' ? '(Intercept)' : s.replace(/[[\]]/g, ''))

interface CatregExpected {
  n: number
  coefficients: {
    name: string
    estimate: number
    se: number
    lower: number
    upper: number
    stat: number
    p: number
    ratio?: number
    ratioLower?: number
    ratioUpper?: number
  }[]
  terms: { name: string; ss?: number; chiSq?: number; df: number; F?: number; p: number }[]
  model?: { ss: number; df: number; F: number; p: number }
  residual?: { ss: number; df: number }
  total?: { ss: number; df: number }
  predictions?: { value: number; lower: number; upper: number }[]
  curves?: number[][]
}

const DEFS = {
  linear: multipleRegressionDef,
  logistic: logisticRegressionDef,
  poisson: poissonRegressionDef,
  cox: coxRegressionDef,
} as const
const RATIO = { logistic: 'Odds ratio', poisson: 'Rate ratio', cox: 'Hazard ratio' } as const

describe('categorical predictors vs R (catreg)', () => {
  for (const f of loadFixtures<{ columns: Columns }>('catreg')) {
    it(f.name, () => {
      const model = f.params.model as keyof typeof DEFS
      const e = f.expected as unknown as CatregExpected
      const r = run(DEFS[model] as AnalysisDef<unknown>, f.input.columns, f.params)
      expect(r.status, r.diagnostics.map((d) => d.message).join('; ')).not.toBe('error')
      const coefs = r.sheets[0]!.blocks[0]!
      if (coefs.type !== 'table') throw new Error('coefficients')
      expect(coefs.rows.map((row) => rName((row[0] as { v: string }).v)).sort()).toEqual(
        e.coefficients.map((c) => c.name).sort(),
      )
      const statCol = coefs.columns.findIndex((c) => c.startsWith('|'))
      for (const c of e.coefficients) {
        const row = coefs.rows.find((x) => rName((x[0] as { v: string }).v) === c.name)!
        const L = `${f.name} ${c.name}`
        expectClose(v(row[col(coefs, 'Estimate')]), c.estimate, f.tol, `${L} estimate`)
        expectClose(v(row[col(coefs, 'Standard error')]), c.se, f.tol, `${L} se`)
        const ci = iv(row[3])
        expectClose(ci.lo, c.lower, f.tol, `${L} lower`)
        expectClose(ci.hi, c.upper, f.tol, `${L} upper`)
        expectClose(v(row[statCol]), Math.abs(c.stat), f.tol, `${L} stat`)
        expectClose(v(row[col(coefs, 'P value')]), c.p, f.tol, `${L} p`)
        if (model !== 'linear') {
          expectClose(v(row[col(coefs, RATIO[model])]), c.ratio!, f.tol, `${L} ratio`)
          const rci = iv(row[col(coefs, RATIO[model]) + 1])
          expectClose(rci.lo, c.ratioLower!, f.tol, `${L} ratio lower`)
          expectClose(rci.hi, c.ratioUpper!, f.tol, `${L} ratio upper`)
        }
      }
      if (model === 'linear') {
        const a = block(r, 'results', 'ANOVA table')
        const rowOf = (name: string) => a.rows.find((x) => (x[0] as { v: string }).v === name)!
        for (const t of e.terms) {
          const row = rowOf(t.name)
          expectClose(v(row[1]), t.ss!, f.tol, `${t.name} SS`)
          expect(v(row[2])).toBe(t.df)
          expectClose(v(row[5]), t.p, f.tol, `${t.name} P`)
        }
        const reg = rowOf('Regression')
        expectClose(v(reg[1]), e.model!.ss, f.tol, 'model SS')
        expect(v(reg[2])).toBe(e.model!.df)
        expectClose(v(reg[5]), e.model!.p, f.tol, 'model P')
        expectClose(v(rowOf('Residual')[1]), e.residual!.ss, f.tol, 'residual SS')
        expect(v(rowOf('Residual')[2])).toBe(e.residual!.df)
        expectClose(v(rowOf('Total')[1]), e.total!.ss, f.tol, 'total SS')
        expect(v(kvOf(r, 'Number of rows analyzed'))).toBe(e.n)
      } else {
        const lr = block(r, 'results', 'Effect of each variable')
        expect(lr.rows.map((x) => (x[0] as { v: string }).v)).toEqual(e.terms.map((t) => t.name))
        e.terms.forEach((t, k) => {
          expectClose(v(lr.rows[k]![1]), t.chiSq!, f.tol, `${t.name} chi`)
          expect(v(lr.rows[k]![2])).toBe(t.df)
          expectClose(v(lr.rows[k]![3]), t.p, f.tol, `${t.name} P`)
        })
      }
      if (e.predictions) {
        const b = block(r, 'interpolated', 'Predicted')
        expect(b.rows).toHaveLength(e.predictions.length)
        const pc = b.columns.findIndex((c) => c.startsWith('Predicted'))
        e.predictions.forEach((p, k) => {
          expectClose(v(b.rows[k]![pc]), p.value, f.tol, `prediction ${k}`)
          expectClose(iv(b.rows[k]![pc + 1]).lo, p.lower, f.tol, `prediction ${k} lower`)
          expectClose(iv(b.rows[k]![pc + 1]).hi, p.upper, f.tol, `prediction ${k} upper`)
        })
        // The result table: predictors, predicted value and CI limits by row.
        const table = r.table!
        expect(table.tableKind).toBe('multipleVariables')
        expect(table.rowCount).toBe(e.predictions.length)
        const pred = table.dataSets.at(-3)!.subcolumns[0]!.values
        e.predictions.forEach((p, k) => {
          expectClose(pred[k]!, p.value, f.tol, `table ${k}`)
        })
      }
      if (e.curves) {
        e.curves.forEach((surv, i) => {
          const out = r.outputs[`survival:${i}`]!
          surv.forEach((s, k) => {
            expectClose(out.y[2 * k + 2]!, s, f.tol, `curve ${i} step ${k}`)
          })
        })
      }
    })
  }
})

interface MultifactorExpected {
  n: number
  sources: {
    name: string
    ss: number
    df: number
    F: number
    p: number
    etaSquared: number
    partialEtaSquared: number
    cohensF: number
    pctOfTotal: number
  }[]
  residual: { ss: number; df: number }
  total: { ss: number; df: number }
  means: { factor: string; mean: unknown; se: unknown; lower: unknown; upper: unknown }[]
  comparisons?: Record<string, unknown>
}

describe('multifactor ANOVA vs R (multifactor)', () => {
  for (const f of loadFixtures<{ columns: Columns }>('multifactor')) {
    it(f.name, () => {
      const e = f.expected as unknown as MultifactorExpected
      const r = run(multifactorAnovaDef as AnalysisDef<unknown>, f.input.columns, f.params)
      expect(r.status, r.diagnostics.map((d) => d.message).join('; ')).not.toBe('error')
      const a = block(r, 'results', 'ANOVA table')
      expect(a.rows.map((x) => (x[0] as { v: string }).v)).toEqual([
        ...e.sources.map((s) => s.name),
        'Residual',
        'Total',
      ])
      e.sources.forEach((s, k) => {
        const row = a.rows[k]!
        expectClose(v(row[1]), s.ss, f.tol, `${s.name} SS`)
        expect(v(row[2])).toBe(s.df)
        expectClose(v(row[5]), s.p, f.tol, `${s.name} P`)
      })
      expectClose(v(a.rows.at(-2)![1]), e.residual.ss, f.tol, 'residual SS')
      expect(v(a.rows.at(-2)![2])).toBe(e.residual.df)
      expectClose(v(a.rows.at(-1)![1]), e.total.ss, f.tol, 'total SS')
      const es = block(r, 'results', 'Effect sizes')
      const pct = block(r, 'results', 'Multifactor ANOVA')
      e.sources.forEach((s, k) => {
        expectClose(v(es.rows[k]![1]), s.etaSquared, f.tol, `${s.name} eta2`)
        expectClose(v(es.rows[k]![2]), s.partialEtaSquared, f.tol, `${s.name} partial`)
        expectClose(v(es.rows[k]![3]), s.cohensF, f.tol, `${s.name} f`)
        expectClose(v(pct.rows[k]![1]), s.pctOfTotal, f.tol, `${s.name} %`)
      })
      for (const m of e.means) {
        const b = block(r, 'means', `${m.factor}: estimated`)
        arr(m.mean).forEach((x, k) => {
          expectClose(v(b.rows[k]![1]), x, f.tol, `${m.factor} mean ${k}`)
          expectClose(v(b.rows[k]![2]), arr(m.se)[k]!, f.tol, `${m.factor} se ${k}`)
          expectClose(iv(b.rows[k]![3]).lo, arr(m.lower)[k]!, f.tol, `${m.factor} lower ${k}`)
          expectClose(iv(b.rows[k]![3]).hi, arr(m.upper)[k]!, f.tol, `${m.factor} upper ${k}`)
        })
      }
      if (e.comparisons) {
        const c = e.comparisons
        const b = block(r, 'comparisons', '')
        const det = block(r, 'comparisons', 'Test details')
        const diff = arr(c.diff)
        expect(b.rows).toHaveLength(diff.length)
        const pCol = b.columns.indexOf('Adjusted P Value')
        const ciCol = b.columns.findIndex((x) => x.endsWith('CI of diff.'))
        diff.forEach((d, k) => {
          expectClose(v(b.rows[k]![1]), d, f.tol, `diff ${k}`)
          expectClose(v(det.rows[k]![2]), arr(c.se)[k]!, f.tol, `se ${k}`)
          expectClose(v(b.rows[k]![pCol]), arr(c.p)[k]!, f.tol, `p ${k}`)
          const lo = arr(c.lower)[k]!
          if (Number.isNaN(lo)) expect(ciCol).toBe(-1)
          else {
            expectClose(iv(b.rows[k]![ciCol]).lo, lo, f.tol, `lo ${k}`)
            expectClose(iv(b.rows[k]![ciCol]).hi, arr(c.upper)[k]!, f.tol, `hi ${k}`)
          }
        })
      }
    })
  }
})

describe('survival from a multiple-variables table vs R (mvsurvival)', () => {
  for (const f of loadFixtures<{ columns: Columns }>('mvsurvival')) {
    it(f.name, () => {
      const e = f.expected as unknown as {
        titles: string[]
        n: number[]
        events: number[]
        median: number[]
        logRankChiSq: number
        logRankP: number
      }
      const r = run(survivalFromVariablesDef as AnalysisDef<unknown>, f.input.columns, f.params)
      expect(r.status).not.toBe('error')
      const summary = block(r, 'summary', 'Data summary')
      expect(summary.columns.slice(1)).toEqual(e.titles)
      expect(summary.rows[0]!.slice(1).map(v)).toEqual(e.n)
      expect(summary.rows[1]!.slice(1).map(v)).toEqual(e.events)
      e.median.forEach((m, k) => {
        const cell = summary.rows[3]![k + 1]!
        if (Number.isNaN(m)) expect(cell).toEqual({ kind: 'text', v: 'Not reached' })
        else expectClose(v(cell), m, f.tol, `median ${k}`)
      })
      expectClose(v(r.values.chiSq), e.logRankChiSq, f.tol, 'log-rank chi-square')
      expectClose(v(r.values.p), e.logRankP, f.tol, 'log-rank P')
      // The survival table it produces analyzes to the same log-rank test.
      const table = r.table!
      expect(table.tableKind).toBe('survival')
      const again = runDef(survivalDef, table)
      expectClose(v(again.values.chiSq), e.logRankChiSq, f.tol, 'result table log-rank')
    })
  }
})

describe('multiple-variables table analyses', () => {
  it('accept multiple-variables tables', () => {
    for (const d of [multifactorAnovaDef, survivalFromVariablesDef]) {
      expect(d.accepts).toEqual(['multipleVariables'])
    }
  })
})

describe('a variable chosen twice counts once', () => {
  const Y = [5.1, 6.3, 4.8, 7.2, 6.9, 5.5, 8.1, 7.7, 6.0, 5.9, 7.4, 6.6]
  const A = ['a', 'b', 'a', 'b', 'a', 'b', 'a', 'b', 'a', 'b', 'a', 'b']
  const B = ['x', 'x', 'y', 'y', 'z', 'z', 'x', 'x', 'y', 'y', 'z', 'z']
  it('multifactor ANOVA factors', () => {
    const once = run(
      multifactorAnovaDef as AnalysisDef<unknown>,
      { Y, A, B },
      { y: 'Y', factors: ['A', 'B'] },
    )
    const twice = run(
      multifactorAnovaDef as AnalysisDef<unknown>,
      { Y, A, B },
      { y: 'Y', factors: ['A', 'B', 'A'] },
    )
    expect(once.status).toBe('ok')
    expect(twice.sheets).toEqual(once.sheets)
  })
  it('survival grouping variables', () => {
    const cols = { T: Y.map((y) => Math.round(y * 10)), E: Y.map((_, i) => (i % 4 ? 1 : 0)), A }
    const def = survivalFromVariablesDef as AnalysisDef<unknown>
    const once = run(def, cols, { time: 'T', status: 'E', groups: ['A'] })
    const twice = run(def, cols, { time: 'T', status: 'E', groups: ['A', 'A'] })
    expect(once.status).not.toBe('error')
    expect(twice.sheets).toEqual(once.sheets)
  })
})

const messages = (r: AnalysisResult) => r.diagnostics.map((d) => d.message).join(' | ')
const first = (row: ResultValue[]) => (row[0] as { v: string }).v

describe('categorical predictors: diagnostics', () => {
  const Y = [5.1, 6.3, 4.8, 7.2, 6.9, 5.5, 8.1, 7.7, 6.0, 5.9, 7.4, 6.6]
  const X = [1, 2, 1.5, 3, 2.8, 1.9, 3.9, 3.5, 2.2, 2.1, 3.3, 2.7]
  const G = ['a', 'b', 'c', 'a', 'b', 'c', 'a', 'b', 'c', 'a', 'b', 'c']
  const mlr = multipleRegressionDef as AnalysisDef<unknown>
  it('leaves out a categorical variable with one level, with a warning', () => {
    const r = run(mlr, { Y, X, Site: G.map(() => 'one') }, { y: 'Y' })
    expect(r.status).toBe('warning')
    expect(messages(r)).toMatch(/“Site” has a single level \(one\).*left out/)
    const coefs = r.sheets[0]!.blocks[0]!
    expect(coefs.type === 'table' && coefs.rows.map(first)).toEqual(['Intercept', 'X'])
  })
  it('warns when the chosen reference level is not in the data, and names the references', () => {
    const r = run(mlr, { Y, X, G }, { y: 'Y', referenceLevels: { G: 'zzz' } })
    expect(messages(r)).toMatch(/reference level “zzz” of “G” is not in the analyzed rows; a/)
    const note = r.sheets[0]!.blocks.find((b) => b.type === 'note')
    expect(note?.type === 'note' && note.text).toMatch(/G = a/)
  })
  it('refuses a text outcome', () => {
    const r = run(mlr, { G, X }, { y: 'G' })
    expect(r.status).toBe('error')
    expect(messages(r)).toMatch(/text variable/)
  })
  it('names levels that separate a logistic outcome', () => {
    const out = [1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 0, 1]
    const r = run(
      logisticRegressionDef as AnalysisDef<unknown>,
      { Out: out, X, G },
      { y: 'Out', ciMethod: 'wald' },
    )
    expect(messages(r)).toMatch(/G = a.*same outcome/)
  })
  it('names levels without events (Cox) and with only zero counts (Poisson)', () => {
    const cox = run(
      coxRegressionDef as AnalysisDef<unknown>,
      { T: X.map((x) => x * 10), E: G.map((g) => (g === 'c' ? 0 : 1)), G },
      { time: 'T', event: 'E', ciMethod: 'wald' },
    )
    expect(messages(cox)).toMatch(/No events among the rows with G = c/)
    const pois = run(
      poissonRegressionDef as AnalysisDef<unknown>,
      { N: G.map((g, i) => (g === 'b' ? 0 : (i % 4) + 1)), X, G },
      { y: 'N' },
    )
    expect(messages(pois)).toMatch(/G = b is 0/)
  })
  it('skips prediction points with unknown levels', () => {
    const r = run(mlr, { Y, X, G }, { y: 'Y', predictions: [{ G: 'nope' }, { X: 2 }] })
    expect(messages(r)).toMatch(/Point 1 was not predicted: G = nope/)
    const b = block(r, 'interpolated', 'Predicted')
    expect(b.rows).toHaveLength(1)
    expect(b.rows[0]!.slice(0, 3)).toEqual([
      { kind: 'text', v: 'Point 2' },
      { kind: 'number', v: 2 },
      { kind: 'text', v: 'a' },
    ])
    // The result table keeps the text variable as text.
    expect(r.table!.dataSets[1]!.text).toEqual(['a'])
  })
  it('gives numeric-only models the Type III ANOVA table, SS = t²·MSE', () => {
    const Z = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5, 8]
    const r = run(mlr, { Y, X, Z }, { y: 'Y' })
    const coefs = r.sheets[0]!.blocks[0]!
    if (coefs.type !== 'table') throw new Error('table')
    const a = block(r, 'results', 'ANOVA table')
    const mse = v(a.rows.find((x) => first(x) === 'Residual')![3])
    for (const name of ['X', 'Z']) {
      const t = v(coefs.rows.find((x) => first(x) === name)![4])
      const ss = v(a.rows.find((x) => first(x) === name)![1])
      expectClose(ss, t * t * mse, { rtol: 1e-10 }, name)
    }
    // Without categorical variables or interactions there is no likelihood-ratio block.
    const lr = run(
      logisticRegressionDef as AnalysisDef<unknown>,
      { Out: [1, 0, 1, 1, 0, 1, 0, 1, 0, 1, 0, 1], X },
      { y: 'Out' },
    )
    expect(
      lr.sheets[0]!.blocks.some((b) => b.type === 'table' && b.title?.startsWith('Effect of')),
    ).toBe(false)
  })
})

describe('multifactor ANOVA: diagnostics', () => {
  const Y = [5, 6, 7, 5.5, 6.5, 8, 9, 7.5, 6, 7]
  const A = ['x', 'x', 'x', 'y', 'y', 'y', 'z', 'z', 'x', 'y']
  const B = ['p', 'q', 'p', 'q', 'p', 'q', 'p', 'p', 'q', 'p']
  const mf = multifactorAnovaDef as AnalysisDef<unknown>
  it('refuses an interaction with an empty combination, and fits without it', () => {
    const r = run(mf, { Y, A, B }, { y: 'Y' })
    expect(r.status).toBe('error')
    expect(messages(r)).toMatch(/no data for A = z, B = q.*interaction A:B/)
    const ok = run(mf, { Y, A, B }, { y: 'Y', interactions: [] })
    expect(ok.status).toBe('ok')
    expect(block(ok, 'results', 'ANOVA table').rows.map(first)).toEqual([
      'A',
      'B',
      'Residual',
      'Total',
    ])
  })
  it('warns about numeric factors with many levels and refuses one-level factors', () => {
    const n = 30
    const r = run(
      mf,
      {
        Y: Array.from({ length: n }, (_, i) => (i * 7) % 11),
        Age: Array.from({ length: n }, (_, i) => Math.floor(i / 1.4)),
      },
      { y: 'Y' },
    )
    expect(messages(r)).toMatch(/“Age” has 21 different values/)
    const one = run(mf, { Y, A: A.map(() => 'x') }, { y: 'Y' })
    expect(messages(one)).toMatch(/single level \(x\)/)
  })
})

describe('survival from variables: status', () => {
  const sv = survivalFromVariablesDef as AnalysisDef<unknown>
  it('needs the text that means an event', () => {
    const r = run(sv, { T: [1, 2, 3], S: ['dead', 'alive', 'dead'] }, { time: 'T', status: 'S' })
    expect(messages(r)).toMatch(/choose the value that means an event/)
    const ok = run(
      sv,
      { T: [1, 2, 3, 4], S: ['dead', 'alive', 'dead', 'lost'] },
      { time: 'T', status: 'S', eventLevel: 'dead', censoredLevel: 'alive' },
    )
    expect(messages(ok)).toMatch(/1 row had a status other than “dead” or “alive”/)
    expect(v(block(ok, 'summary', 'Data summary').rows[0]![1])).toBe(3)
  })
})
