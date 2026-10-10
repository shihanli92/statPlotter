import { type AnalysisDef, createTable, type DataTable, normalizeTable } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { nonlinearFitDef, nonlinearFitMVDef, pcaDef, registry } from '../src/index.ts'
import { mvTable, xyTable } from './helpers.ts'

// Roadmap 42: the analyses that can run long report how far they have got. Reporting must not
// change what they compute (the same result with and without a listener), and what they report
// only goes forward, ending at the total where the run's steps are all known.

/** Runs a plugin with and without a listener; the reports as fractions. */
function both<P>(def: AnalysisDef<P>, t: DataTable, params: object = {}) {
  const input = normalizeTable(t)
  const p = def.params.parse(params)
  const context = { tableKind: t.tableKind, xTitle: t.x?.title ?? null }
  const quiet = def.run(input, p, context)
  const heard: number[] = []
  const totals = new Set<number>()
  const loud = def.run(input, p, context, (done, total) => {
    heard.push(done / total)
    totals.add(total)
  })
  return { quiet, loud, heard, totals }
}

/** Never back, never beyond the end. */
function expectForward(heard: number[]) {
  for (let i = 1; i < heard.length; i++) expect(heard[i]).toBeGreaterThanOrEqual(heard[i - 1]!)
  for (const f of heard) expect(f >= 0 && f <= 1).toBe(true)
}

// Fixed noise (no Math functions of random numbers).
const NOISE = [0.31, -0.42, 0.17, -0.08, 0.26, -0.33, 0.05, 0.12, -0.21]

function mvData(rows: number) {
  const cols: Record<string, number[]> = { A: [], B: [], C: [], D: [] }
  for (let i = 0; i < rows; i++) {
    const s = (i % 11) - 5
    cols.A!.push(s + NOISE[i % 9]!)
    cols.B!.push(0.5 * s + NOISE[(i + 3) % 9]!)
    cols.C!.push(NOISE[(i * 7) % 9]! + (i % 3))
    cols.D!.push(-s + NOISE[(i + 5) % 9]! * 2)
  }
  return mvTable(cols)
}

const X = [0.5, 1, 2, 4, 8, 16, 32]
/** Michaelis–Menten curves (Vmax 100 − 10 k, Km 3 + k) with fixed noise. */
function mmTable(sets: number) {
  return xyTable(
    X,
    Array.from({ length: sets }, (_, k) =>
      X.map((x, i) => ((100 - 10 * k) * x) / (3 + k + x) + 2 * NOISE[(i + k) % 9]!),
    ),
  )
}

describe('progress of long analyses changes no result', () => {
  it('PCA with parallel analysis: every so many simulations (and with PCR, both runs)', () => {
    // 250 rows of 4 variables: a simulation is about 4,000 operations, so a report every 250.
    const t = mvData(250)
    const r = both(pcaDef, t, { select: 'parallel', simulations: 1000 })
    expect(r.quiet.status).toBe('ok')
    expect(r.loud).toEqual(r.quiet)
    expect(r.heard).toEqual([0.25, 0.5, 0.75, 1])
    // With a PCR the PCA (of the 3 other variables: a report every 444) runs twice, each half
    // the progress.
    const keys = normalizeTable(t).map((d) => d.ref.key)
    const pcr = both(pcaDef, t, { select: 'parallel', simulations: 888, pcr: true, pcrY: keys[3] })
    expect(pcr.quiet.status).not.toBe('error')
    expect(pcr.loud).toEqual(pcr.quiet)
    expect(pcr.heard).toEqual([0.25, 0.5, 0.75, 1])
    // Other selection rules simulate nothing: nothing to report.
    expect(both(pcaDef, t, { select: 'kaiser' }).heard).toEqual([])
  })

  it('Monte Carlo: every few simulations', () => {
    const mc = registry.get('monteCarlo')!
    const r = both(mc, createTable({ rows: 3, columns: 1 }), { simulations: 50 })
    expect(r.quiet.status).toBe('ok')
    expect(r.loud).toEqual(r.quiet)
    expectForward(r.heard)
    expect(r.heard.length).toBeGreaterThan(3)
    expect(r.totals).toEqual(new Set([50]))
  })

  it('nonlinear regression: each data set fitted, over every fit the run makes', () => {
    const t = mmTable(4)
    const keys = normalizeTable(t).map((d) => d.ref.key)
    const cases: [string, object, number[]][] = [
      ['one fit per data set', { equation: 'michaelis-menten' }, [0.25, 0.5, 0.75, 1]],
      [
        'shared Km: one global fit',
        { equation: 'michaelis-menten', constraints: { Km: { kind: 'shared' } } },
        [1],
      ],
      [
        'ROUT, the fit and another model',
        { equation: 'michaelis-menten', outliers: 'eliminate', compareWith: 'straight-line' },
        [1 / 3, 5 / 12, 1 / 2, 7 / 12, 2 / 3, 3 / 4, 5 / 6, 11 / 12, 1],
      ],
      [
        'Km compared between data sets',
        { equation: 'michaelis-menten', compareParams: ['Km'] },
        [1 / 12, 2 / 12, 3 / 12, 4 / 12, 8 / 12, 1],
      ],
      ['robust', { equation: 'michaelis-menten', fitMethod: 'robust' }, [1]],
      [
        'two equations: each group its share',
        {
          equation: 'michaelis-menten',
          equationByDataSet: { [keys[3]!]: { equation: 'straight-line' } },
        },
        [0.25, 0.5, 0.75, 1],
      ],
    ]
    for (const [name, params, expected] of cases) {
      const r = both(nonlinearFitDef, t, params)
      expect(r.quiet.status, name).not.toBe('error')
      expect(r.loud, name).toEqual(r.quiet)
      expectForward(r.heard)
      expect(r.heard.length, name).toBe(expected.length)
      for (const [i, f] of r.heard.entries()) expect(f, name).toBeCloseTo(expected[i]!, 12)
    }
  })

  it('nonlinear regression of a multiple-variables table: each group', () => {
    const dose = [...X, ...X, ...X]
    const grp = dose.map((_, i) => Math.floor(i / X.length))
    const resp = dose.map((d, i) => ((90 - 5 * grp[i]!) * d) / (4 + grp[i]! + d) + NOISE[i % 9]!)
    const t = mvTable({ Dose: dose, Group: grp, Response: resp })
    const keys = normalizeTable(t).map((d) => d.ref.key)
    const r = both(nonlinearFitMVDef, t, {
      x: keys[0],
      y: keys[2],
      group: keys[1],
      equation: 'michaelis-menten',
    })
    expect(r.quiet.status).toBe('ok')
    expect(r.loud).toEqual(r.quiet)
    expect(r.heard.map((f) => +f.toFixed(12))).toEqual([1 / 3, 2 / 3, 1].map((f) => +f.toFixed(12)))
  })
})
