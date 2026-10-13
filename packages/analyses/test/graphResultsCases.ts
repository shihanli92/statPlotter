import {
  type AnalysisDef,
  type AnalysisResult,
  createTable,
  type DataTable,
  type FieldDataSet,
  normalizeTable,
  type ResultRef,
  type ResultTemplate,
  type ResultValue,
  resolveResultRef,
  valueNumber,
} from '@ps/model'
import { EQUATIONS, equation } from '@ps/stats'
import { expect } from 'vitest'
import type { z } from 'zod'
import { pct } from '../src/common.ts'
import { registry } from '../src/index.ts'
import { columnTable, runWithContext } from './helpers.ts'

// The cases of graphResults*.test.ts (audit 4, T8: the curve fits' designs in files of their own,
// so that they run beside the others). Results on graphs (roadmap 35): every ready label, line and band an analysis offers names values
// its results have. Generated (audit 2, S5): for every analysis with ready results, every value
// of every parameter its templates read (found by reading them through a proxy, until no new one
// turns up) is combined with the others, and each combination runs on small tables of every kind
// the analysis accepts. Each field must resolve (per data set where drawn per data set) and equal
// the value on the results sheet it names, as written here independently of the templates (the
// paired t test's df reading the number of pairs, S1, and matched one-way ANOVA's F reading the
// ordinary sheet's rows, S2, fail this).

export const SETTINGS = { pValueStyle: 'GP' as const, pValueDigits: 4 }

/** An XY table: X, then data sets of one replicate each. */
function xyTable(x: number[], ...ys: number[][]): DataTable {
  const t = createTable({ tableKind: 'xy', columns: ys.length, rows: x.length })
  t.x!.subcolumns[0]!.values = x
  ys.forEach((y, i) => {
    t.dataSets[i]!.subcolumns[0]!.values = y
  })
  return t
}

function survivalTable(groups: number): DataTable {
  const times = [3, 5, 6, 8, 10, 12, 15, 18, 20, 24]
  const t = createTable({ tableKind: 'survival', columns: groups, rows: times.length * groups })
  t.x!.subcolumns[0]!.values = Array.from(
    { length: times.length * groups },
    (_, r) => times[r % times.length]! + Math.floor(r / times.length) * 2,
  )
  t.dataSets.forEach((d, g) => {
    d.subcolumns[0]!.values = Array.from({ length: times.length * groups }, (_, r) =>
      Math.floor(r / times.length) === g ? (r % 4 === 3 ? 0 : 1) : null,
    )
  })
  return t
}

function contingencyTable(): DataTable {
  const t = createTable({ tableKind: 'contingency', columns: 2, rows: 2 })
  t.dataSets[0]!.subcolumns[0]!.values = [30, 12]
  t.dataSets[1]!.subcolumns[0]!.values = [10, 28]
  t.rowTitles = ['Treated', 'Control']
  return t
}

const TWO = [
  [12, 15, 11, 14, 13],
  [18, 25, 17, 29, 20],
]
const THREE = [
  [12, 15, 11, 14, 13],
  [18, 21, 17, 22, 19],
  [9, 11, 10, 8, 12],
]
const X12 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
const Y12 = [2, 3.1, 3.9, 5.2, 6.1, 6.8, 8.2, 9.1, 9.8, 11.2, 12.1, 12.8]
const Y12B = [1, 1.5, 3, 2.5, 4, 3.5, 5, 6, 5.5, 7, 6.5, 8]
const NOISE = [0.8, -1.1, 0.4, 1.6, -0.9, 0.7, -1.3, 0.5, -0.2, 0.3, -0.6, 1.0]

/**
 * Data that a built-in equation fits: its curve at the initial values its rules find for a
 * sigmoid or a decay (on log doses, concentrations or doubling doses), plus 1% noise. The first
 * X grid and shape whose curve is finite; null when none is (the equation is then skipped).
 */
function curveData(id: string): { x: number[]; y: number[][] } | null {
  const eq = equation(id)
  if (!eq) return null
  const grids = [
    X12.map((i) => -9 + ((i - 1) * 4) / 11),
    X12.map((i) => i - 0.5),
    X12.map((i) => 2 ** (i - 3)),
  ]
  for (const x of grids) {
    const lo = x[0]!
    const hi = x.at(-1)!
    const w = (hi - lo) / 8
    const shapes = [
      x.map((v) => 5 + 90 / (1 + Math.exp(-(v - (lo + hi) / 2) / w))),
      x.map((v) => 95 - 90 / (1 + Math.exp(-(v - (lo + hi) / 2) / w))),
      x.map((v) => 100 * Math.exp(-(v - lo) / (3 * w))),
    ]
    for (const shape of shapes) {
      let p: number[]
      try {
        p = eq.initial(x, shape)
      } catch {
        continue
      }
      if (!p.every(Number.isFinite)) continue
      const y = x.map((v) => eq.f(v, p))
      if (!y.every(Number.isFinite)) continue
      const span = Math.max(...y) - Math.min(...y) || 1
      const noisy = (k: number) => y.map((v, i) => v + NOISE[(i + k) % 12]! * 0.01 * span)
      return { x, y: [noisy(0), noisy(5)] }
    }
  }
  return null
}

/** A table to run on, with parameters naming its variables (multiple-variables tables). */
interface Input {
  table: DataTable
  params?: Record<string, unknown>
}

/** The tables each analysis runs on, for its parameters (a fit's data come from its equation). */
export const INPUTS: Record<string, (params: Record<string, unknown>) => Input[]> = {
  descriptive: () =>
    [columnTable(TWO.slice(0, 1)), columnTable(TWO), columnTable(THREE)].map((table) => ({
      table,
    })),
  ttest: () => [{ table: columnTable(TWO) }],
  mannWhitney: () => [{ table: columnTable(TWO) }],
  wilcoxon: () => [{ table: columnTable(TWO) }],
  kolmogorovSmirnov: () => [{ table: columnTable(TWO) }],
  // Matched with a missing value: the mixed-effects model.
  oneWayAnova: () => [
    { table: columnTable(THREE) },
    { table: columnTable(THREE.map((c, i) => (i === 1 ? [c[0]!, null, ...c.slice(2)] : c))) },
  ],
  friedman: () => [{ table: columnTable(THREE) }],
  // A one-tailed test states its direction (roadmap 51c, S1).
  correlation: () => [
    { table: columnTable([X12.slice(0, 6), Y12.slice(0, 6)]), params: { predicted: 'increase' } },
    { table: xyTable(X12, Y12, Y12B), params: { predicted: 'increase' } },
  ],
  linearRegression: () => [{ table: xyTable(X12.slice(0, 8), Y12.slice(0, 8), Y12B.slice(0, 8)) }],
  nonlinearFit: (p) => {
    const d = curveData(p.equation as string)
    return d ? [{ table: xyTable(d.x, ...d.y) }] : []
  },
  // X, Y and a numeric grouping variable: a fit per group, or one of every row.
  nonlinearFitMV: (p) => {
    const d = curveData(p.equation as string)
    if (!d) return []
    const table = columnTable(
      [
        [...d.x, ...d.x],
        [...d.y[0]!, ...d.y[1]!],
        [...d.x.map(() => 1), ...d.x.map(() => 2)],
      ],
      { kind: 'multipleVariables' },
    )
    const [x, y, group] = normalizeTable(table).map((s) => s.ref.key)
    return [
      { table, params: { x, y, group } },
      { table, params: { x, y } },
    ]
  },
  survival: () => [1, 2, 3].map((n) => ({ table: survivalTable(n) })),
  contingency: () => [{ table: contingencyTable() }],
}

/** Analyses whose runs may fail on generated data (curve fits): each label set must run once. */
export const MAY_FAIL = new Set(['nonlinearFit', 'nonlinearFitMV'])

/**
 * Curve fits, whose default profile-likelihood CIs refit the model for every bound (roadmap 51e):
 * audit 4 (T8) runs each set of labels once with them (its first run that gives results) and the
 * other designs with the asymptotic CIs, which the labels read from the same cells. That was
 * half of the unit tests' critical path, every design profiled.
 */
export const PROFILED = new Set(['nonlinearFit', 'nonlinearFitMV'])

// --- The parameters the templates read and the values each can take ---------------------------

/** Values of parameters that aren't a choice (a number, an equation's id). */
const SPECIAL: Record<string, readonly unknown[]> = {
  confidenceLevel: [0.95, 0.9],
  equation: EQUATIONS.map((e) => e.id),
}

type Schema = z.ZodType & {
  def: { type: string; innerType?: Schema; shape?: Record<string, Schema> }
}

const unwrap = (s: Schema): Schema =>
  ['default', 'optional', 'prefault', 'nullable'].includes(s.def.type)
    ? unwrap(s.def.innerType!)
    : s

/** Every value a parameter at `path` can take: a choice's, a switch's, or SPECIAL's. */
function choices(schema: Schema, path: string): readonly unknown[] {
  if (SPECIAL[path]) return SPECIAL[path]!
  let s = unwrap(schema)
  for (const k of path.split('.')) s = unwrap(s.def.shape![k]!)
  if (s.def.type === 'boolean') return [false, true]
  if (s.def.type === 'enum') return (s as unknown as { options: unknown[] }).options
  throw new Error(`templates read ${path} (${s.def.type}): give its values in SPECIAL`)
}

/** `obj` whose reads of leaf values (not objects) are recorded in `reads` by path. */
function recording<T>(obj: T, reads: Set<string>, path: string[] = []): T {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return obj
  return new Proxy(obj as object, {
    get(t, k) {
      const v = Reflect.get(t, k)
      if (typeof k !== 'string') return v
      if (v === null || typeof v !== 'object' || Array.isArray(v)) reads.add([...path, k].join('.'))
      return recording(v, reads, [...path, k])
    },
  }) as T
}

/** Parameters with `values` set at their dotted paths. */
function withPaths(values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [path, v] of Object.entries(values)) {
    const keys = path.split('.')
    let o = out
    for (const k of keys.slice(0, -1)) {
      o[k] ??= {}
      o = o[k] as Record<string, unknown>
    }
    o[keys.at(-1)!] = v
  }
  return out
}

const contextOf = (table: DataTable) => ({
  tableKind: table.tableKind,
  dataSets: normalizeTable(table).map((d) => d.ref.key),
})

/**
 * Every combination of the values of the parameters the templates read, on every input: found by
 * reading the templates of each combination and adding what they read, until nothing is new.
 */
function designs(def: AnalysisDef<unknown>): Record<string, unknown>[] {
  const axes = new Map<string, readonly unknown[]>()
  let combos: Record<string, unknown>[] = [{}]
  for (;;) {
    const before = axes.size
    for (const c of combos) {
      const params = def.params.parse(withPaths(c)) as Record<string, unknown>
      for (const input of INPUTS[def.id]!(params)) {
        const reads = new Set<string>()
        def.graphResults!(recording(params, reads) as never, contextOf(input.table))
        for (const r of reads) if (!axes.has(r)) axes.set(r, choices(def.params as Schema, r))
      }
    }
    if (axes.size === before) return combos
    combos = [...axes].reduce<Record<string, unknown>[]>(
      (acc, [path, values]) => acc.flatMap((c) => values.map((v) => ({ ...c, [path]: v }))),
      [{}],
    )
  }
}

// --- The value on the results sheet each field names -------------------------------------------

/** A sheet's cell, as a template names one; `parse`: a number inside the text 'F (DFn, DFd) = F'. */
type Where = Omit<Extract<ResultRef, { from: 'cell' }>, 'from'> & { parse?: 'F' | 'dfn' | 'dfd' }

interface FieldContext {
  template: ResultTemplate
  params: Record<string, unknown>
  /** The analyzed data sets' titles, in order. */
  titles: string[]
  /** The data set the field is read for (templates drawn per data set). */
  ds?: FieldDataSet
}

type Expect = (field: string, c: FieldContext) => Where | undefined

const results = (row: string, more: Partial<Where> = {}): Where => ({
  sheet: 'results',
  row,
  ...more,
})

/** The fit's midpoint as a template id names it (IC50, IC50drop, IC50CI…). */
const midOf = (id: string) => /^(IC50|EC50)/.exec(id)?.[1]

const EXPECT: Record<string, Expect> = {
  descriptive: (f, c) => {
    const level = pct(c.params.confidenceLevel as number)
    const column = c.template.id === 'control' ? c.titles[0] : c.ds?.title
    const row = {
      mean: 'Mean',
      sd: 'Std. Deviation',
      lo: `Lower ${level} CI of mean`,
      hi: `Upper ${level} CI of mean`,
    }[f]
    return row ? { sheet: 'descriptive', row, column } : undefined
  },
  ttest: (f, c) => {
    const p = c.params as { design: string; unpaired: { assumeEqualSD: boolean } }
    const welch = p.design === 'unpaired' && !p.unpaired.assumeEqualSD
    if (f === 'P') return results('P value')
    if (f === 't') return results(welch ? 'Welch-corrected t' : 't')
    if (f === 'df') return results('df')
    if (f === 'd')
      return results(
        p.design === 'paired'
          ? 'Cohen’s d (d_z: mean difference / SD of differences)'
          : 'Cohen’s d (pooled SD)',
        { block: 'How big is the difference?' },
      )
  },
  oneWayAnova: (f, c) => {
    const matched = c.params.matched === true
    switch (f) {
      case 'P':
        return results('P value')
      case 'F':
        return matched ? results('F (DFn, DFd)', { parse: 'F' }) : results('F')
      case 'dfn':
      case 'dfd':
        return results('F (DFn, DFd)', { parse: f })
      case 'df':
        return results('DFn, DFd')
      case 'eta':
        return results('Eta squared (R squared)', { block: 'Effect size' })
      case 'H':
        return results('Kruskal-Wallis statistic')
      case 'stat':
        return results('Friedman statistic')
    }
  },
  mannWhitney: (f) =>
    ({
      P: results('P value'),
      U: results('Mann-Whitney U'),
      hl: results('Shift (Hodges-Lehmann: median of all differences B − A)'),
    })[f],
  wilcoxon: (f) => ({ P: results('P value'), W: results('Sum of signed ranks (W)') })[f],
  friedman: (f) => (f === 'P' ? results('P value') : undefined),
  kolmogorovSmirnov: (f) => (f === 'P' ? results('P value') : undefined),
  correlation: (f, c) => {
    const spearman = c.params.method === 'spearman'
    const block = spearman ? 'Spearman correlation' : 'Pearson correlation'
    const row = c.ds ? `X vs. ${c.ds.title}` : `${c.titles[0]} vs. ${c.titles[1]}`
    const column = {
      r: spearman ? 'Spearman r' : 'Pearson r',
      P: c.params.tails === 'one' ? 'P value (one-tailed)' : 'P value (two-tailed)',
      n: 'Number of XY pairs',
      ci: `${pct(c.params.confidenceLevel as number)} CI`,
    }[f]
    return column ? results(row, { block, column }) : undefined
  },
  linearRegression: (f, c) => {
    const at = {
      eq: ['Equation', ''],
      R2: ['Goodness of Fit', 'R squared'],
      slope: ['Best-fit values', 'Slope'],
      se: ['Std. Error', 'Slope'],
      P: ['Is slope significantly non-zero?', 'P value'],
    }[f]
    return at && results(at[1]!, { block: at[0], column: c.ds!.title })
  },
  nonlinearFit: (f, c) => {
    const column = c.ds!.title
    const best = (row: string) => results(row, { block: 'Best-fit values', column })
    const mid = midOf(c.template.id)
    // The midpoint the curve is fitted against: its log where the equation fits that.
    const fitted =
      mid && equation(c.params.equation as string)!.params.includes(`Log${mid}`) ? `Log${mid}` : mid
    if (f === 'v') return best(fitted!)
    if (f === 'ci')
      return results(fitted!, { block: `${pct(c.params.confidenceLevel as number)} CI`, column })
    if (f === 'R2') return results('R squared', { block: 'Goodness of Fit', column })
    const row = { h: 'HillSlope', top: 'Top', bottom: 'Bottom' }[f] ?? f
    if (
      ['EC50', 'IC50', 'LogEC50', 'LogIC50', 'Kd', 'Bmax', 'HillSlope', 'Top', 'Bottom'].includes(
        row,
      )
    )
      return best(row)
  },
  nonlinearFitMV: (f, c) => EXPECT.nonlinearFit!(f, c),
  survival: (f, c) => {
    const level = pct(c.params.confidenceLevel as number)
    const comparison = (block: string, row: string, more: Partial<Where> = {}): Where => ({
      sheet: 'comparison',
      block,
      row,
      ...more,
    })
    // Audit 4 S8: the hazard ratio and its CI are the method's shown.
    const hr = `Hazard ratio (${c.params.hazardRatio === 'logRank' ? 'log-rank' : 'Mantel-Haenszel'})`
    switch (f) {
      case 'm':
        return { sheet: 'summary', row: 'Median survival', column: c.ds!.title }
      case 'P':
        return comparison('Log-rank (Mantel-Cox) test', 'P value')
      case 'hr':
        return comparison(hr, `Ratio (${c.titles[1]}/${c.titles[0]})`)
      case 'lo':
      case 'hi':
        return comparison(hr, `${level} CI of ratio`, { end: f })
    }
  },
  contingency: (f, c) => {
    const level = pct(c.params.confidenceLevel as number)
    if (f === 'P')
      return results('P value', {
        block: c.params.test === 'fisher' ? 'Fisher’s exact test' : 'Chi-square test',
      })
    const block = { or: 'Odds ratio', rr: 'Relative risk' }[c.template.id]
    if (!block) return undefined
    if (f === 'ci') return results(`${level} CI`, { block })
    if (f === c.template.id) return results(block, { block })
  },
}

/** The number a sheet's text 'F (DFn, DFd) = F' gives (to its 4 significant digits). */
function parsed(text: string, part: 'F' | 'dfn' | 'dfd'): number | null {
  const m = /^F \(([^,]+), ([^)]+)\) = (.+)$/.exec(text)
  if (!m) return null
  return Number(m[{ dfn: 1, dfd: 2, F: 3 }[part]])
}

/** Whether a field's value is the sheet's (numbers exactly; a parsed text to its digits). */
function same(got: ResultValue, want: ResultValue, where: Where): boolean {
  if (where.parse) {
    const n = valueNumber(got)
    return want.kind === 'text' && n !== null && +n.toPrecision(4) === parsed(want.v, where.parse)
  }
  const [a, b] = [valueNumber(got), valueNumber(want)]
  if (a !== null || b !== null) return a === b
  return JSON.stringify(got) === JSON.stringify(want)
}

/** The problems with an analysis' templates for one design and input (none: all is well). */
function check(
  def: AnalysisDef<unknown>,
  all: Record<string, unknown>,
  input: Input,
  result: AnalysisResult,
): string[] {
  const problems: string[] = []
  const parsedParams = def.params.parse(all) as Record<string, unknown>
  const normalized = normalizeTable(input.table)
  const titles = normalized.map((d) => d.title)
  const templates: ResultTemplate[] = def.graphResults!(
    parsedParams as never,
    contextOf(input.table),
  )
  if (!templates.length) problems.push('no templates')
  // Drawn per data set: each analyzed data set, or (fits from a table's variables) each fit's.
  const fits = def.id === 'nonlinearFitMV'
  const sets: FieldDataSet[] = fits
    ? ((
        result.sheets.find((s) => s.key === 'results')?.blocks.find((b) => b.type === 'table') as
          | { columns: string[] }
          | undefined
      )?.columns
        .slice(1)
        .map((title) => ({ key: title, title })) ?? [])
    : normalized.map((d) => ({ key: d.ref.key, title: d.title }))
  for (const t of templates) {
    const targets = t.stat.per === 'dataSet' ? sets : [undefined]
    for (const n of [t.stat.at, t.stat.lo, t.stat.hi])
      if (n && !t.stat.fields[n]) problems.push(`${t.id}: names a field ${n} it lacks`)
    for (const [name, field] of Object.entries(t.stat.fields))
      for (const ds of targets) {
        const what = `${t.id}.${name}${ds ? ` for ${ds.title}` : ''}`
        const got = resolveResultRef(result, field.ref, SETTINGS, ds)
        if (!got) {
          problems.push(`${what}: doesn’t resolve (${JSON.stringify(field.ref)})`)
          continue
        }
        // Roadmap 51c (§7.4): the test's name, a value of its own (no sheet cell holds it).
        if (field.ref.from === 'value' && field.ref.key === 'test') {
          if (got.kind !== 'text' || !got.v) problems.push(`${what}: no test name`)
          continue
        }
        const where = EXPECT[def.id]!(name, { template: t, params: parsedParams, titles, ds })
        if (!where) {
          problems.push(`${what}: no sheet value is named for it in EXPECT`)
          continue
        }
        const { parse: _, ...ref } = where
        const want = resolveResultRef(result, { from: 'cell', ...ref }, SETTINGS)
        if (!want) problems.push(`${what}: the sheet has no ${JSON.stringify(where)}`)
        else if (!same(got, want, where))
          problems.push(`${what}: ${JSON.stringify(got)}, the sheet’s ${JSON.stringify(want)}`)
      }
  }
  return problems
}

export const WITH_TEMPLATES = registry.list().filter((d) => d.graphResults)

/**
 * Every design of an analysis on every input: the problems found, the template sets seen (as
 * JSON) and those run with profile-likelihood CIs (PROFILED analyses).
 */
export function everyDesign(def: AnalysisDef<unknown>): {
  problems: string[]
  templateSets: string[]
  profiled: Set<string>
} {
  const id = def.id
  const problems: string[] = []
  /** Template sets (as JSON) seen, and whether one of their runs succeeded. */
  const ran = new Map<string, boolean>()
  /** Template sets with a run that gave results with profile-likelihood CIs (PROFILED). */
  const profiled = new Set<string>()
  for (const design of designs(def)) {
    const params = def.params.parse(withPaths(design)) as Record<string, unknown>
    for (const input of INPUTS[id]!(params)) {
      const key = JSON.stringify(def.graphResults!(params as never, contextOf(input.table)))
      const profile = PROFILED.has(id) && !profiled.has(key)
      const all = {
        ...withPaths(design),
        ...input.params,
        ...(PROFILED.has(id) ? { ciMethod: profile ? 'profile' : 'symmetric' } : {}),
      }
      const shown = `${JSON.stringify(all)} on ${input.table.tableKind} (${input.table.dataSets.length} data sets)`
      const result = runWithContext(def, input.table, all)
      if (result.status === 'error') {
        if (!MAY_FAIL.has(id)) problems.push(`${shown}: ${JSON.stringify(result.diagnostics)}`)
        if (!ran.has(key)) ran.set(key, false)
        continue
      }
      ran.set(key, true)
      if (profile) profiled.add(key)
      problems.push(...check(def, all, input, result).map((p) => `${shown}: ${p}`))
    }
  }
  // Curve fits of generated data: every set of labels ran at least once (three of the 126
  // built-in equations, which need data set constants, don't fit these data), and once with
  // profile-likelihood CIs.
  for (const [key, ok] of ran) {
    if (!ok) problems.push(`no run of ${id} gave results for the labels ${key.slice(0, 300)}`)
    else if (PROFILED.has(id) && !profiled.has(key))
      problems.push(`no run of ${id} with profile CIs for the labels ${key.slice(0, 300)}`)
  }
  return { problems, templateSets: [...ran.keys()], profiled }
}

/** Checks every design of an analysis (the body of each analysis' test). */
export function expectEveryDesign(def: AnalysisDef<unknown>): void {
  const { problems, templateSets, profiled } = everyDesign(def)
  if (PROFILED.has(def.id)) expect(profiled.size).toBeGreaterThan(0)
  expect(problems).toEqual([])
  // Some design offers one in the analysis dialog (descriptive statistics' are lines).
  const offered = templateSets.some((k) => (JSON.parse(k) as ResultTemplate[]).some((t) => t.offer))
  expect(offered || def.id === 'descriptive').toBe(true)
}
