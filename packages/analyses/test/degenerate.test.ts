// Audit 4 (P6): the forms' dialog parts, explanations and sketches (as the dialog has them).
import '../src/dialogEntry.ts'
// Registry-wide safety net: every analysis, on every table kind it accepts, must fail gracefully
// (never throw) on degenerate input, and must not report `ok` for an empty or one-value table.

import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  type AnalysisDef,
  type AnalysisResult,
  createTable,
  normalizeTable,
  type ResultValue,
  type TableKind,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { PATHOLOGICAL_EQUATIONS } from '../../stats/test/pathologicalEquations.ts'
import { registry } from '../src/index.ts'

type Fill = 'empty' | 'one value' | 'constant' | 'too few data sets'

/**
 * Analyses that legitimately report `ok` on an empty or one-value table. Analyses that don't read
 * the data with their default params (simulations, power analysis) and analyses that produce a
 * data table (an empty table in gives an empty table out) are exempt without being listed.
 */
const OK_ALLOWED: Record<string, readonly Fill[]> = {
  // Reports N = 0 (and the statistics of a single value).
  descriptive: ['empty', 'one value'],
  // Reports "N too small" for each test, with an info note of the N each test needs.
  normality: ['empty', 'one value'],
  // One P value is a valid (trivial) input for multiple comparisons.
  pStack: ['one value'],
  // Row statistics / fraction of total of a row with one value are well defined.
  rowStats: ['one value'],
  fractionOfTotal: ['one value'],
}

/** Analyses that give a valid result with fewer data sets than the Analyze dialog asks for. */
const FEW_ALLOWED = new Set([
  // The Friedman test of two matched groups is well defined (a sign test on ranks); matched
  // nonparametric one-way ANOVA of two groups runs it.
  'friedman',
  // PCA of one variable is trivial (one component, loading 1) but well defined.
  'pca',
])

const ROWS = 3

function makeTable(def: AnalysisDef<unknown>, kind: TableKind, fill: Fill) {
  const min = Math.max(def.inputs.min, 1)
  const columns =
    fill === 'too few data sets' ? min - 1 : Math.min(Math.max(min, 2), def.inputs.max)
  const t = createTable({ tableKind: kind, columns, rows: ROWS })
  if (t.x && fill !== 'empty') t.x.subcolumns[0]!.values = [1, 2, 3]
  for (const [i, ds] of t.dataSets.entries())
    for (const sub of ds.subcolumns) {
      if (fill === 'one value')
        sub.values = i === 0 && sub === ds.subcolumns[0] ? [1, null, null] : [null, null, null]
      else if (fill === 'constant') sub.values = [2, 2, 2]
      else if (fill === 'too few data sets') sub.values = [1, 2, 4]
    }
  return t
}

const cases: [string, TableKind, Fill, AnalysisDef<unknown>][] = []
for (const def of registry.list())
  for (const kind of def.accepts)
    for (const fill of ['empty', 'one value', 'constant', 'too few data sets'] as const)
      if (fill !== 'too few data sets' || def.inputs.min > 1) cases.push([def.id, kind, fill, def])

describe('degenerate input', () => {
  it.each(cases)('%s on a %s table: %s', (id, kind, fill, def) => {
    const t = makeTable(def, kind, fill)
    const params = def.params.parse({})
    const r = def.run(normalizeTable(t), params, { tableKind: kind, xTitle: null })
    const exempt = def.usesData?.(params) === false || def.producesTable === true
    if ((fill === 'empty' || fill === 'one value') && !exempt && !OK_ALLOWED[id]?.includes(fill))
      expect(r.status).not.toBe('ok')
    if (fill === 'too few data sets' && def.usesData?.(params) !== false && !FEW_ALLOWED.has(id))
      expect(r.status).toBe('error')
    if (r.status === 'error')
      expect(
        r.diagnostics.some((d) => d.level === 'error' && d.message),
        'error message',
      ).toBe(true)
  })
})

describe('registry', () => {
  it('registers every analysis definition exported from src', async () => {
    const dir = join(import.meta.dirname, '../src')
    const found: string[] = []
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      const mod = (await import(join(dir, file))) as Record<string, unknown>
      for (const [name, value] of Object.entries(mod)) {
        const d = value as Partial<AnalysisDef<unknown>> | null
        if (typeof d !== 'object' || d === null) continue
        if (typeof d.id !== 'string' || typeof d.run !== 'function' || !Array.isArray(d.accepts))
          continue
        expect(registry.get(d.id), `${file}: ${name}`).toBe(d)
        found.push(d.id)
      }
    }
    // Every registered analysis is exported by some module (the Monte Carlo def is built in the
    // index by a factory, so it is the only one that isn't).
    const exported = new Set(found)
    const unexported = registry.list().filter((d) => !exported.has(d.id))
    expect(unexported.map((d) => d.id)).toEqual(['monteCarlo'])
  })
})

/** Degenerate but analysable tables (audit 3, S6): cells by column, row and replicate. */
const UNDEFINED_FILLS: Record<string, (c: number, r: number, s: number) => number | null> = {
  'identical columns': (_c, r, s) => r + 1 + s,
  'constant within columns': (c) => c + 1,
  'one constant column': (c, r, s) => (c === 0 ? 5 : r + 1 + c + s * 0.3),
  ties: (c, r) => Math.floor(r / 2) + 1 + c,
  tiny: (c, r, s) => 1e-200 * (r + 1 + c * 2 + s * 0.5),
}
const SHAPES: Partial<Record<TableKind, { columns: number; reps: number }>> = {
  column: { columns: 3, reps: 1 },
  xy: { columns: 2, reps: 1 },
  grouped: { columns: 3, reps: 2 },
  multipleVariables: { columns: 4, reps: 1 },
  survival: { columns: 2, reps: 1 },
}

/** Each option of the analysis' form on its own (as a user would pick it), and the defaults. */
function variants(def: AnalysisDef<unknown>): [string, unknown][] {
  const out: [string, unknown][] = [['defaults', {}]]
  for (const f of (def.form ?? []) as readonly {
    path?: readonly string[]
    options?: readonly unknown[]
  }[]) {
    if (!f?.path || !Array.isArray(f.options)) continue
    const path = f.path
    for (const o of f.options) {
      const value = typeof o === 'object' && o !== null ? (o as { value: unknown }).value : o
      const raw: Record<string, unknown> = {}
      let at = raw
      path.forEach((k, i) => {
        if (i === path.length - 1) at[k] = value
        else at = at[k] = {} as Record<string, unknown>
      })
      out.push([`${path.join('.')}=${String(value)}`, raw])
    }
  }
  return out
}

function filledTable(
  kind: TableKind,
  columns: number,
  reps: number,
  f: (typeof UNDEFINED_FILLS)[string],
) {
  const t = createTable({
    tableKind: kind,
    columns,
    rows: 6,
    yFormat: { type: 'replicates', count: reps },
  })
  t.dataSets.forEach((ds, c) => {
    ds.subcolumns.forEach((sub, s) => {
      sub.values = Array.from({ length: 6 }, (_, r) => {
        const v = f(c, r, s)
        return kind === 'survival' && v !== null ? Math.abs(Math.round(v)) % 2 : v
      })
    })
  })
  if (t.x) t.x.subcolumns[0]!.values = [1, 2, 3, 4, 5, 6]
  return t
}

/** Text showing NaN or Infinity, and verdicts ("Yes", "Not significant") given with P undefined. */
function undefinedShown(r: AnalysisResult): string[] {
  const out: string[] = []
  type V = ResultValue
  const verdict = (v: V) =>
    v.kind === 'bool' || (v.kind === 'text' && /^(Not )?[Ss]ignificant$/.test(v.v))
  for (const sheet of r.sheets)
    for (const b of sheet.blocks) {
      const values: V[] =
        b.type === 'keyValue'
          ? b.rows.map((x) => x.value)
          : b.type === 'table'
            ? b.rows.flat()
            : b.type === 'summary'
              ? b.parts.flatMap((x) => (typeof x === 'string' ? [] : [x.value]))
              : []
      for (const v of values)
        if (v.kind === 'text' && /NaN|Infinity/.test(v.v))
          out.push(
            `“${v.v}” in ${b.type === 'keyValue' || b.type === 'table' ? (b.title ?? sheet.title) : sheet.title}`,
          )
      if (b.type === 'keyValue') {
        let undefinedP = false
        for (const row of b.rows) {
          if (row.value.kind === 'pvalue') undefinedP = Number.isNaN(row.value.v)
          else if (undefinedP && verdict(row.value))
            out.push(`“${row.label}” answered with P undefined`)
        }
      }
      if (b.type === 'table')
        for (const row of b.rows)
          if (row.some((v) => v.kind === 'pvalue' && Number.isNaN(v.v)) && row.some(verdict))
            out.push(`a verdict with P undefined in ${b.title}`)
    }
  return out
}

describe('undefined results read “—” (audit 3, S6)', () => {
  const SKIP = new Set(['monteCarlo', 'simulateXY', 'simulateColumn', 'simulateContingency'])
  const defs = registry.list().filter((d) => !SKIP.has(d.id))
  it.each(defs.map((d) => [d.id, d] as const))('%s', (_id, def) => {
    const problems: string[] = []
    for (const kind of def.accepts) {
      const shape = SHAPES[kind]
      if (!shape) continue
      const columns = Math.min(Math.max(shape.columns, def.inputs.min), def.inputs.max)
      for (const [fill, f] of Object.entries(UNDEFINED_FILLS)) {
        const t = normalizeTable(filledTable(kind, columns, shape.reps, f))
        for (const [name, raw] of variants(def)) {
          const parsed = def.params.safeParse(raw)
          if (!parsed.success) continue
          const r = def.run(t, parsed.data, { tableKind: kind, xTitle: null })
          for (const p of undefinedShown(r)) problems.push(`${kind} / ${fill} / ${name}: ${p}`)
        }
      }
    }
    expect([...new Set(problems)]).toEqual([])
  })
})

describe('pathological user equations (audit 4 T1)', () => {
  // The run answers each quickly, and the sketch and graph results never throw.
  const table = createTable({ tableKind: 'xy', columns: 2, rows: 4 })
  table.x!.subcolumns[0]!.values = [1, 2, 3, 4]
  table.dataSets.forEach((d, i) => {
    d.subcolumns[0]!.values = [1, 3, 2, 5].map((v) => v + i)
  })
  const input = normalizeTable(table)
  const context = { tableKind: 'xy' as const, xTitle: null }
  it.each(PATHOLOGICAL_EQUATIONS.map((e) => [e.label, e.text] as const))('%s', (_label, text) => {
    for (const id of ['nonlinearFit', 'simulateXY']) {
      const def = registry.get(id)!
      const params = def.params.parse({ equation: 'user', userEquation: text })
      const t0 = performance.now()
      const r = def.run(input, params, context)
      // (A long but valid equation fits or simulates; the others are errors with a message.)
      if (r.status === 'error')
        expect(
          r.diagnostics.some((d) => d.level === 'error' && d.message),
          id,
        ).toBe(true)
      def.sketch?.(input, params, { ...context, maxRows: 50 })
      def.graphResults?.(params, { tableKind: 'xy', dataSets: [] })
      expect(performance.now() - t0, id).toBeLessThan(5000)
    }
  })
})
