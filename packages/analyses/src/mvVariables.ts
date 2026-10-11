import type { Diagnostic, FormField, NormalizedDataSet } from '@ps/model'
import { type DesignVariable, type TermDesign, termDesign } from '@ps/stats'
import { z } from 'zod'
import { firstCol, rowCountOf } from './common.ts'

// ---------------------------------------------------------------------------------------------
// Variables of multiple-variables tables for the models of roadmap item 19: numeric variables,
// text (categorical) variables (`NormalizedDataSet.text`) and numeric variables the user treats
// as categorical, coded for regression (reference / dummy coding) or ANOVA.
//
// Conventions (the multiple regression "Reference level" tab and multifactor ANOVA):
// - A text value is trimmed; an empty text cell is a missing value. A numeric variable treated as
//   categorical has one level per distinct number, labelled with the number as written by JS.
// - Levels are ordered by their first appearance in the table (displayed in the same order
//   that they appear in the data table); levels that occur only in rows left out
//   (missing values) are not levels of the analysis.
// - Reference level: the automatic rules — the first level (default), the last, the most or
//   the least frequent in the analyzed rows (ties: the earlier level) — or a level chosen per
//   variable.
// - Rows are analyzed when every variable of the model has a value (complete cases); rows with a
//   value in every predictor but no outcome are the rows to interpolate.
// ---------------------------------------------------------------------------------------------

type ReferenceRule = 'first' | 'last' | 'mostFrequent' | 'leastFrequent'

const referenceRule = z.enum(['first', 'last', 'mostFrequent', 'leastFrequent']).default('first')

/** Params shared by the regression models that take categorical predictors. */
export const categoricalParams = {
  /** Numeric predictors (data set keys) treated as categorical; text variables always are. */
  categorical: z.array(z.string()).default([]),
  referenceRule,
  /** A chosen reference level per categorical variable (data set key → level label). */
  referenceLevels: z.record(z.string(), z.string()).default({}),
  /** Interactions: two or three predictor keys each (products of their columns). */
  interactions: z.array(z.array(z.string()).min(2).max(3)).default([]),
}

/** Prediction ("interpolation") params of linear, logistic and Poisson regression. */
export const predictionParams = {
  /** Predict the outcome of rows with every predictor but no outcome ("Interpolation"). */
  interpolate: z.boolean().default(false),
  /** Points to predict: predictor key → number or level (missing: mean / reference level). */
  predictions: z.array(z.record(z.string(), z.union([z.number(), z.string()]))).default([]),
}

const REFERENCE_RULE_FIELD: FormField = {
  path: ['referenceRule'],
  label: 'Reference level of categorical variables',
  kind: 'radio',
  options: [
    { value: 'first', label: 'First level in the table (recommended)' },
    { value: 'last', label: 'Last level in the table' },
    { value: 'mostFrequent', label: 'Most frequent level' },
    { value: 'leastFrequent', label: 'Least frequent level' },
  ],
}

/**
 * Form fields for categorical predictors. `roles` names the params holding the variables that
 * are not predictors, with their fallback positions (e.g. 'y=0', or 'time=0,event=1'), so the
 * editors list the predictors.
 */
export const categoricalFields = (roles: string): FormField[] => [
  {
    path: ['categorical'],
    label: 'Categorical predictors',
    kind: 'custom',
    component: `mv.categorical:${roles}`,
  },
  REFERENCE_RULE_FIELD,
  {
    path: ['referenceLevels'],
    label: 'Reference levels',
    kind: 'custom',
    component: `mv.reference:${roles}`,
  },
  {
    path: ['interactions'],
    label: 'Interactions',
    kind: 'custom',
    component: `mv.interactions:${roles}`,
  },
]

export const predictionFields = (roles: string, what: string): FormField[] => [
  {
    path: ['interpolate'],
    label: `Predict ${what} for rows with every predictor but no ${what}`,
    kind: 'checkbox',
  },
  {
    path: ['predictions'],
    label: `Predict ${what} at these predictor values`,
    kind: 'custom',
    component: `mv.predictions:${roles}`,
  },
]

/** A variable's cells: numbers (NaN = missing) or trimmed text (null = missing). */
type Cells = { kind: 'numeric'; values: Float64Array } | { kind: 'text'; values: (string | null)[] }

export function cellsOf(ds: NormalizedDataSet): Cells {
  if (ds.text) {
    const values = Array.from({ length: ds.rowCount }, (_, r) => {
      const t = ds.text![r]
      const s = typeof t === 'string' ? t.trim() : ''
      return s === '' ? null : s
    })
    return { kind: 'text', values }
  }
  const col = firstCol(ds)
  return {
    kind: 'numeric',
    values: Float64Array.from({ length: ds.rowCount }, (_, r) => col[r] ?? Number.NaN),
  }
}

const has = (c: Cells, r: number) =>
  c.kind === 'text' ? c.values[r] != null : !Number.isNaN(c.values[r] ?? Number.NaN)

/** The label of a categorical cell (text, or the number written out); null when missing. */
export function labelOf(c: Cells, r: number): string | null {
  if (c.kind === 'text') return c.values[r] ?? null
  const v = c.values[r] ?? Number.NaN
  return Number.isNaN(v) ? null : String(v)
}

/** Distinct labels in order of first appearance over the given rows (all rows by default). */
export function levelsOf(c: Cells, rows?: readonly number[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const n = c.values.length
  const idx = rows ?? Array.from({ length: n }, (_, r) => r)
  for (const r of idx) {
    const l = labelOf(c, r)
    if (l !== null && !seen.has(l)) {
      seen.add(l)
      out.push(l)
    }
  }
  return out
}

/** Index of the reference level by rule (counts over the analyzed rows). */
function referenceIndex(levels: readonly string[], counts: readonly number[], rule: ReferenceRule) {
  if (rule === 'last') return levels.length - 1
  if (rule === 'first') return 0
  let best = 0
  counts.forEach((c, i) => {
    if (rule === 'mostFrequent' ? c > counts[best]! : c < counts[best]!) best = i
  })
  return best
}

interface ModelVariable {
  /** Position among the analyzed data sets. */
  index: number
  key: string
  title: string
  categorical: boolean
  /** Categorical: levels in table order (only those in the analyzed rows). */
  levels: string[]
  reference: number
  /** Rows at each level (analyzed rows). */
  counts: number[]
}

export interface PreparedModel {
  /** Table rows analyzed (complete cases). */
  rows: number[]
  /** Outcome values on the analyzed rows, one array per outcome. */
  outcomes: number[][]
  /** Predictors kept in the model (single-level categorical variables are left out). */
  predictors: ModelVariable[]
  /** The model's terms as indices into `predictors`: main effects, then interactions. */
  terms: number[][]
  design: TermDesign
  /** Design variables (stats) for the analyzed rows, parallel to `predictors`. */
  designVars: DesignVariable[]
  /** Rows with every predictor but a missing outcome (candidates for interpolation). */
  predictRows: number[]
  diagnostics: Diagnostic[]
}

interface PrepareOptions {
  /** Numeric outcome variables (indices into input), e.g. [y] or [time, event]. */
  outcomes: readonly number[]
  predictors: readonly number[]
  /** Numeric variables treated as categorical (keys). */
  categorical: readonly string[]
  referenceRule: ReferenceRule
  referenceLevels: Readonly<Record<string, string>>
  interactions: readonly (readonly string[])[]
}

const quote = (s: string) => `“${s}”`

/**
 * Reads the outcome and predictor variables, keeps complete cases, orders levels, picks
 * reference levels and builds the dummy-coded design. Returns an error message (for `failure`)
 * when the model can't be set up.
 */
export function prepareModel(
  input: readonly NormalizedDataSet[],
  opts: PrepareOptions,
): PreparedModel | { error: string; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = []
  const cells = input.map(cellsOf)
  for (const o of opts.outcomes)
    if (cells[o]!.kind === 'text')
      return {
        error: `The outcome ${quote(input[o]!.title)} is a text variable; it must hold numbers.`,
        diagnostics,
      }
  const catSet = new Set(opts.categorical)
  const isCat = (i: number) => cells[i]!.kind === 'text' || catSet.has(input[i]!.ref.key)
  const n = rowCountOf(input)
  const rows: number[] = []
  const predictRows: number[] = []
  let dropped = 0
  const used = [...opts.outcomes, ...opts.predictors]
  for (let r = 0; r < n; r++) {
    const filled = used.filter((i) => has(cells[i]!, r)).length
    if (filled === used.length) rows.push(r)
    else {
      if (filled > 0) dropped++
      if (opts.predictors.every((i) => has(cells[i]!, r))) predictRows.push(r)
    }
  }
  if (dropped > 0)
    diagnostics.push({
      level: 'info',
      message: `${dropped} row${dropped > 1 ? 's' : ''} with a missing value ${dropped > 1 ? 'were' : 'was'} left out.`,
    })

  const predictors: ModelVariable[] = []
  for (const i of opts.predictors) {
    const ds = input[i]!
    const c = cells[i]!
    const base = { index: i, key: ds.ref.key, title: ds.title }
    if (!isCat(i)) {
      predictors.push({ ...base, categorical: false, levels: [], reference: -1, counts: [] })
      continue
    }
    const analyzed = new Set(levelsOf(c, rows))
    const levels = levelsOf(c).filter((l) => analyzed.has(l))
    const counts = levels.map(() => 0)
    const pos = new Map(levels.map((l, k) => [l, k]))
    for (const r of rows) counts[pos.get(labelOf(c, r)!)!]!++
    if (levels.length < 2) {
      if (rows.length)
        diagnostics.push({
          level: 'warning',
          message: `${quote(ds.title)} has a single level${levels[0] ? ` (${levels[0]})` : ''} in the analyzed rows, so it was left out of the model.`,
        })
      continue
    }
    let reference = referenceIndex(levels, counts, opts.referenceRule)
    const chosen = opts.referenceLevels[ds.ref.key]
    if (chosen !== undefined && chosen !== '') {
      const k = levels.indexOf(chosen.trim())
      if (k >= 0) reference = k
      else
        diagnostics.push({
          level: 'warning',
          message: `The reference level “${chosen}” of ${quote(ds.title)} is not in the analyzed rows; ${levels[reference]} was used.`,
        })
    }
    predictors.push({ ...base, categorical: true, levels, reference, counts })
  }

  const byKey = new Map(predictors.map((p, k) => [p.key, k]))
  const terms: number[][] = predictors.map((_, k) => [k])
  const seen = new Set<string>()
  for (const inter of opts.interactions) {
    const idx = inter.map((key) => byKey.get(key))
    if (idx.some((k) => k === undefined) || new Set(idx).size !== idx.length) continue
    const t = (idx as number[]).slice().sort((a, b) => a - b)
    const id = t.join(',')
    if (seen.has(id)) continue
    seen.add(id)
    terms.push(t)
  }
  terms.sort((a, b) => a.length - b.length)

  const designVars: DesignVariable[] = predictors.map((p) => {
    const c = cells[p.index]!
    if (!p.categorical)
      return { kind: 'numeric', name: p.title, values: rows.map((r) => c.values[r] as number) }
    const pos = new Map(p.levels.map((l, k) => [l, k]))
    return {
      kind: 'categorical',
      name: p.title,
      levels: p.levels,
      codes: rows.map((r) => pos.get(labelOf(c, r)!)!),
      reference: p.reference,
    }
  })
  const outcomes = opts.outcomes.map((o) => rows.map((r) => cells[o]!.values[r] as number))
  return {
    rows,
    outcomes,
    predictors,
    terms,
    design: termDesign(designVars, terms),
    designVars,
    predictRows,
    diagnostics,
  }
}

/** A note naming the reference level of each categorical predictor (none when there are none). */
export function referenceNote(m: PreparedModel): { type: 'note'; text: string }[] {
  const cats = m.predictors.filter((p) => p.categorical)
  if (!cats.length) return []
  return [
    {
      type: 'note',
      text: `Reference level${cats.length > 1 ? 's' : ''} (no parameter): ${cats
        .map((p) => `${p.title} = ${p.levels[p.reference]}`)
        .join('; ')}. Each other level’s parameter compares it with the reference level.`,
    },
  ]
}

/** Levels of categorical predictors at which the outcome never varies (separation hints). */
export function constantOutcomeLevels(
  m: PreparedModel,
  y: readonly number[],
  test: (values: number[]) => boolean,
): string[] {
  const out: string[] = []
  m.predictors.forEach((p, k) => {
    if (!p.categorical) return
    const v = m.designVars[k] as Extract<DesignVariable, { kind: 'categorical' }>
    p.levels.forEach((level, l) => {
      const ys = y.filter((_, i) => v.codes[i] === l)
      if (ys.length && test(ys)) out.push(`${p.title} = ${level}`)
    })
  })
  return out
}
