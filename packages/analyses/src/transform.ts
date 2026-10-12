import {
  type AnalysisDef,
  type Diagnostic,
  type NormalizedDataSet,
  type ResultValue,
  roundDecimal,
  type YFormat,
} from '@ps/model'
import { maxOf, meanOf, midranks, minOf, normalQuantile } from '@ps/stats'
import { z } from 'zod'
import {
  exclusionNotes,
  failure,
  int,
  kv,
  num,
  pick,
  rowCountOf,
  rowMeans,
  table,
  text,
} from './common.ts'
import {
  applySummaryFormat,
  type OutDataSet,
  rowLabel,
  type SummaryCols,
  sourceKind,
  sourceX,
  stableId,
  tableResult,
} from './resultTable.ts'

// ---------------------------------------------------------------------------------------------
// Transform (Analyze › Transform, concentrations and data). The standard functions: each value
// becomes f(Y) (or f(X) for X values of
// XY tables); a value the function isn't defined for (log of a negative number, logit outside
// 0–1…) becomes an empty cell and is counted. Trigonometric functions use radians, probit adds 5
// (the older definition of probit), rank and z score are computed within
// each data set (column) over all its values, ties getting the average rank.
// ---------------------------------------------------------------------------------------------

interface FnDef {
  label: string
  /** Element-wise function of the value, K and the row's X. */
  f?: (y: number, k: number, x: number) => number
  /** Column-wise functions (need every value of the data set). */
  column?: 'rank' | 'zscore'
  usesK?: boolean
  usesX?: boolean
  /** Linear functions: SD multiplier (so entered SD / SEM transform exactly). */
  sdScale?: (k: number, x: number) => number
}

const log10 = Math.log10
const one = () => 1

const ELEMENTWISE = {
  multiplyK: { label: 'Y = Y * K', f: (y, k) => y * k, usesK: true, sdScale: (k) => Math.abs(k) },
  addK: { label: 'Y = Y + K', f: (y, k) => y + k, usesK: true, sdScale: one },
  subtractK: { label: 'Y = Y − K', f: (y, k) => y - k, usesK: true, sdScale: one },
  divideK: { label: 'Y = Y / K', f: (y, k) => y / k, usesK: true, sdScale: (k) => 1 / Math.abs(k) },
  square: { label: 'Y = Y squared', f: (y) => y * y },
  powerK: { label: 'Y = Y ^ K', f: (y, k) => y ** k, usesK: true },
  // Roadmap 51c (S38, decision 1285): log10 named as such (ln and log2 are separate).
  log10: { label: 'Y = log10(Y)', f: (y) => log10(y) },
  negLog10: { label: 'Y = −1 * log10(Y)', f: (y) => -log10(y) },
  ln: { label: 'Y = ln(Y)', f: (y) => Math.log(y) },
  log2: { label: 'Y = log2(Y)', f: (y) => Math.log2(y) },
  pow10: { label: 'Y = 10 ^ Y', f: (y) => 10 ** y },
  exp: { label: 'Y = exp(Y)', f: (y) => Math.exp(y) },
  pow2: { label: 'Y = 2 ^ Y', f: (y) => 2 ** y },
  reciprocal: { label: 'Y = 1 / Y', f: (y) => 1 / y },
  sqrt: { label: 'Y = sqrt(Y)', f: (y) => Math.sqrt(y) },
  abs: { label: 'Y = abs(Y)', f: (y) => Math.abs(y) },
  sin: { label: 'Y = sin(Y) (radians)', f: (y) => Math.sin(y) },
  cos: { label: 'Y = cos(Y) (radians)', f: (y) => Math.cos(y) },
  tan: { label: 'Y = tan(Y) (radians)', f: (y) => Math.tan(y) },
  arcsin: { label: 'Y = arcsin(Y) (radians)', f: (y) => Math.asin(y) },
  arcsinSqrt: { label: 'Y = arcsin(sqrt(Y)) (radians)', f: (y) => Math.asin(Math.sqrt(y)) },
  logit: { label: 'Y = logit(Y) = ln(Y / (1 − Y))', f: (y) => Math.log(y / (1 - y)) },
  probit: {
    label: 'Y = probit(Y) (+5, Y between 0 and 1)',
    f: (y) => (y > 0 && y < 1 ? 5 + normalQuantile(y) : Number.NaN),
  },
  kMinusY: { label: 'Y = K − Y', f: (y, k) => k - y, usesK: true, sdScale: one },
  kDivY: { label: 'Y = K / Y', f: (y, k) => k / y, usesK: true },
  round: {
    label: 'Y = Y rounded to K digits after the decimal point',
    f: (y, k) => roundTo(y, k),
    usesK: true,
  },
} satisfies Record<string, FnDef>

const RELATIONAL = {
  xDivY: { label: 'Y = X / Y', f: (y, _k, x) => x / y, usesX: true },
  yDivX: {
    label: 'Y = Y / X',
    f: (y, _k, x) => y / x,
    usesX: true,
    sdScale: (_k, x) => 1 / Math.abs(x),
  },
  yMinusX: { label: 'Y = Y − X', f: (y, _k, x) => y - x, usesX: true, sdScale: one },
  yPlusX: { label: 'Y = Y + X', f: (y, _k, x) => y + x, usesX: true, sdScale: one },
  yTimesX: {
    label: 'Y = Y * X',
    f: (y, _k, x) => y * x,
    usesX: true,
    sdScale: (_k, x) => Math.abs(x),
  },
  xMinusY: { label: 'Y = X − Y', f: (y, _k, x) => x - y, usesX: true, sdScale: one },
} satisfies Record<string, FnDef>

const COLUMN = {
  rank: { label: 'Y = rank(Y) (within each data set)', column: 'rank' },
  zscore: { label: 'Y = zscore(Y) (SDs from the data set mean)', column: 'zscore' },
} satisfies Record<string, FnDef>

const Y_FUNCTIONS: Record<string, FnDef> = {
  none: { label: 'No transform', f: (y) => y, sdScale: one },
  ...ELEMENTWISE,
  ...COLUMN,
  ...RELATIONAL,
}
/** X functions: the element-wise ones, written for X. */
const X_FUNCTIONS: Record<string, FnDef> = Object.fromEntries(
  Object.entries({ none: Y_FUNCTIONS.none!, ...ELEMENTWISE }).map(([id, d]) => [
    id,
    { ...d, label: d.label.replace(/Y/g, 'X') },
  ]),
)

const Y_IDS = Object.keys(Y_FUNCTIONS) as [string, ...string[]]
const X_IDS = Object.keys(X_FUNCTIONS) as [string, ...string[]]

/**
 * Rounds half away from zero to `k` decimals (k truncated to an integer; negative: tens…), on the
 * decimal digits as spreadsheets do (`roundDecimal`: round(1.005, 2) = 1.01).
 */
const roundTo = (y: number, k: number): number => roundDecimal(y, k)

/** Average ranks (1 = smallest) of the finite values; NaN stays NaN. */
function averageRanks(values: ArrayLike<number>): Float64Array {
  const idx: number[] = []
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i]!)) idx.push(i)
  const finite = new Float64Array(idx.length)
  for (let k = 0; k < idx.length; k++) finite[k] = values[idx[k]!]!
  const { ranks } = midranks(finite)
  const out = new Float64Array(values.length).fill(Number.NaN)
  for (let k = 0; k < idx.length; k++) out[idx[k]!] = ranks[k]!
  return out
}

/**
 * Applies a Y function to one data set's values (all subcolumns, flattened row-major by the
 * caller). `x[i]` is the X of value i (NaN if none).
 */
function transformValues(
  fn: string,
  values: ArrayLike<number>,
  k: number,
  x?: ArrayLike<number>,
): Float64Array {
  const d = Y_FUNCTIONS[fn]
  if (!d) throw new RangeError(`unknown transform ${fn}`)
  const n = values.length
  const out = new Float64Array(n).fill(Number.NaN)
  if (d.column === 'rank') return averageRanks(values)
  if (d.column === 'zscore') {
    const v = Array.from(values).filter(Number.isFinite)
    const m = v.reduce((s, y) => s + y, 0) / v.length
    const s = Math.sqrt(v.reduce((a, y) => a + (y - m) ** 2, 0) / (v.length - 1))
    for (let i = 0; i < n; i++) if (Number.isFinite(values[i]!)) out[i] = (values[i]! - m) / s
    return out
  }
  for (let i = 0; i < n; i++) {
    const y = values[i]!
    if (!Number.isFinite(y)) continue
    const r = d.f!(y, k, x ? x[i]! : Number.NaN)
    out[i] = Number.isFinite(r) ? r : Number.NaN
  }
  return out
}

function transformX(fn: string, values: ArrayLike<number>, k: number): Float64Array {
  const d = X_FUNCTIONS[fn]
  if (!d?.f) throw new RangeError(`unknown X transform ${fn}`)
  return Float64Array.from(values, (v) => {
    if (!Number.isFinite(v)) return Number.NaN
    const r = d.f!(v, k, Number.NaN)
    return Number.isFinite(r) ? r : Number.NaN
  })
}

const TransformParams = z.object({
  y: z.enum(Y_IDS).default('log10'),
  k: z.number().default(1),
  /** A separate K per data set (by data set key); the others use `k`. */
  kByDataSet: z.record(z.string(), z.number()).default({}),
  x: z.enum(X_IDS).default('none'),
  kx: z.number().default(1),
})
type TransformParams = z.infer<typeof TransformParams>

const usesK = (fn: string) => Y_FUNCTIONS[fn]?.usesK === true

function countFinite(a: ArrayLike<number>): number {
  let n = 0
  for (let i = 0; i < a.length; i++) if (Number.isFinite(a[i]!)) n++
  return n
}

/** A per-cell map of every subcolumn of a data set (column functions see all its values). */
function mapDataSet(
  ds: NormalizedDataSet,
  cols: readonly Float64Array[],
  f: (flat: Float64Array, xFlat: Float64Array) => Float64Array,
): Float64Array[] {
  const R = ds.rowCount
  const C = cols.length
  const flat = new Float64Array(R * C)
  const xf = new Float64Array(R * C)
  for (let c = 0; c < C; c++)
    for (let r = 0; r < R; r++) {
      flat[c * R + r] = cols[c]![r] ?? Number.NaN
      xf[c * R + r] = ds.x?.[r] ?? Number.NaN
    }
  const res = f(flat, xf)
  return cols.map((_, c) => res.slice(c * R, (c + 1) * R))
}

export const transformDef: AnalysisDef<TransformParams> = {
  id: 'transform',
  version: 1,
  title: 'Transform',
  category: 'Data processing',
  description:
    'Transform Y values (logarithms, powers, reciprocals, logit, probit, rank, z score, Y × K …) and, on XY tables, X values; the result is a new table.',
  // Roadmap 38: parts of whole too (each part's value transformed; the parts stay rows).
  accepts: ['xy', 'column', 'grouped', 'nested', 'partsOfWhole'],
  inputs: { min: 1, max: Number.POSITIVE_INFINITY },
  params: TransformParams,
  producesTable: true,
  form: [
    {
      path: ['y'],
      label: 'Transform Y values using',
      kind: 'select',
      options: Y_IDS.map((id) => ({ value: id, label: Y_FUNCTIONS[id]!.label })),
    },
    {
      path: ['k'],
      label: 'K',
      kind: 'number',
      showIf: { path: ['y'], in: Y_IDS.filter(usesK) },
    },
    {
      path: ['kByDataSet'],
      label: 'K for each data set',
      kind: 'custom',
      component: 'transform.kByDataSet',
      showIf: { path: ['y'], in: Y_IDS.filter(usesK) },
    },
    {
      path: ['x'],
      label: 'Transform X values using (XY tables)',
      kind: 'select',
      options: X_IDS.map((id) => ({ value: id, label: X_FUNCTIONS[id]!.label })),
    },
    {
      path: ['kx'],
      label: 'K for X',
      kind: 'number',
      showIf: { path: ['x'], in: X_IDS.filter((id) => X_FUNCTIONS[id]!.usesK) },
    },
  ],
  run(input, params, context) {
    const diagnostics = exclusionNotes(input)
    const kind = sourceKind(input, context)
    const yf = Y_FUNCTIONS[params.y]!
    const xs = sourceX(input, context)
    if (yf.usesX && !xs) return failure(`${yf.label} needs X values (an XY table).`, diagnostics)
    if (params.x !== 'none' && !xs)
      return failure('Only XY tables have X values to transform.', diagnostics)
    const R = rowCountOf(input)
    const kOf = (ds: NormalizedDataSet) => params.kByDataSet[ds.ref.key] ?? params.k
    let transformed = 0
    let blanked = 0
    let erased = false
    const summary = input.every((d) => d.data.shape === 'summary')
    if (!summary && input.some((d) => d.data.shape === 'summary'))
      return failure('The data sets mix raw and summary data.', diagnostics)
    const out: OutDataSet[] = []
    const summaryCols: SummaryCols[] = []
    for (const ds of input) {
      const k = kOf(ds)
      if (ds.data.shape === 'replicates') {
        const cols = mapDataSet(ds, ds.data.reps, (flat, xf) =>
          transformValues(params.y, flat, k, xf),
        )
        ds.data.reps.forEach((rep, c) => {
          const n0 = countFinite(rep)
          const n1 = countFinite(cols[c]!)
          transformed += n1
          blanked += n0 - n1
        })
        out.push({ id: stableId(ds.ref.key), title: ds.title, subcolumns: cols })
      } else {
        const d = ds.data
        const [mean] = mapDataSet(ds, [d.mean], (flat, xf) =>
          transformValues(params.y, flat, k, xf),
        )
        const m = mean!
        transformed += countFinite(m)
        blanked += countFinite(d.mean) - countFinite(m)
        const scale = yf.sdScale
        if (!scale) erased = true
        const sc = (a: Float64Array) =>
          Float64Array.from(a, (v, r) =>
            scale && Number.isFinite(m[r]!) ? v * scale(k, ds.x?.[r] ?? Number.NaN) : Number.NaN,
          )
        summaryCols.push({ mean: m, sd: sc(d.sd), sem: sc(d.sem), n: Float64Array.from(d.n) })
        out.push({ id: stableId(ds.ref.key), title: ds.title, subcolumns: [m] })
      }
    }
    let yFormat: YFormat | undefined
    if (summary && !erased) yFormat = applySummaryFormat(out, summaryCols)
    else if (summary) {
      yFormat = { type: 'replicates', count: 1 }
      diagnostics.push({
        level: 'info',
        message:
          'This transform is not linear, so SD and SEM can’t be transformed: the result has the transformed means only.',
      })
    }
    let x = xs
    let xBlank = 0
    if (xs && params.x !== 'none') {
      const tx = transformX(params.x, xs.values, params.kx)
      xBlank = countFinite(xs.values) - countFinite(tx)
      x = { title: xs.title, values: tx }
    }
    if (blanked + xBlank > 0)
      diagnostics.push({
        level: 'info',
        message: `${blanked + xBlank} value${blanked + xBlank > 1 ? 's' : ''} could not be transformed and ${blanked + xBlank > 1 ? 'were' : 'was'} left blank.`,
      })
    const rows: [string, ResultValue][] = [['Y values', text(yf.label)]]
    if (yf.usesK) rows.push(['K', num(params.k)])
    if (xs) rows.push(['X values', text(X_FUNCTIONS[params.x]!.label)])
    if (xs && X_FUNCTIONS[params.x]!.usesK) rows.push(['K for X', num(params.kx)])
    rows.push(['Values transformed', int(transformed)])
    rows.push(['Values left blank (not defined)', int(blanked)])
    if (xs && params.x !== 'none') rows.push(['X values left blank', int(xBlank)])
    return tableResult(
      'Transform',
      [kv('Transform', rows)],
      diagnostics,
      input,
      {
        name: 'Transform',
        tableKind: kind,
        rowCount: R,
        rowTitles: input[0]?.rowTitles ?? null,
        x,
        dataSets: out,
        yFormat,
      },
      { transformed: int(transformed), blanked: int(blanked) },
    )
  },
}

// ---------------------------------------------------------------------------------------------
// Normalize: each data set is rescaled so that its 0% and 100% values
// become 0 and 100 (or 0 and 1): Y' = (Y − Z) / (H − Z). "If you have entered replicate values,
// zero and one hundred percent are defined by the mean of the replicates"; SD and SEM are
// divided by (H − Z) as well. Z: the smallest value, the first value or a value you enter; H: the
// largest value, the last value, a value you enter, the sum or the mean of the values (of the row
// means).
// ---------------------------------------------------------------------------------------------

const NormalizeParams = z.object({
  zero: z.enum(['smallest', 'first', 'value']).default('smallest'),
  zeroValue: z.number().default(0),
  hundred: z.enum(['largest', 'last', 'value', 'sum', 'mean']).default('largest'),
  hundredValue: z.number().default(100),
  display: z.enum(['percent', 'fraction']).default('percent'),
})
type NormalizeParams = z.infer<typeof NormalizeParams>

/** The 0% and 100% values of one data set from its row means. */
function normalizeRefs(
  means: ArrayLike<number>,
  p: Pick<NormalizeParams, 'zero' | 'zeroValue' | 'hundred' | 'hundredValue'>,
): { zero: number; hundred: number } {
  const v = Array.from(means).filter(Number.isFinite)
  if (!v.length) return { zero: Number.NaN, hundred: Number.NaN }
  const zero = p.zero === 'smallest' ? minOf(v) : p.zero === 'first' ? v[0]! : p.zeroValue
  const sum = v.reduce((s, x) => s + x, 0)
  const hundred =
    p.hundred === 'largest'
      ? maxOf(v)
      : p.hundred === 'last'
        ? v[v.length - 1]!
        : p.hundred === 'value'
          ? p.hundredValue
          : p.hundred === 'sum'
            ? sum
            : sum / v.length
  return { zero, hundred }
}

export const normalizeDef: AnalysisDef<NormalizeParams> = {
  id: 'normalize',
  version: 1,
  title: 'Normalize',
  category: 'Data processing',
  description:
    'Rescale each data set so that a chosen value (smallest, first, entered) is 0% and another (largest, last, entered, sum or mean) is 100%.',
  accepts: ['xy', 'column', 'grouped', 'nested'],
  inputs: { min: 1, max: Number.POSITIVE_INFINITY },
  params: NormalizeParams,
  producesTable: true,
  form: [
    {
      path: ['zero'],
      label: 'How is 0% defined?',
      kind: 'radio',
      options: [
        { value: 'smallest', label: 'Smallest value in each data set' },
        { value: 'first', label: 'First value in each data set' },
        { value: 'value', label: 'Y = a value you enter' },
      ],
    },
    {
      path: ['zeroValue'],
      label: '0% value',
      kind: 'number',
      showIf: { path: ['zero'], in: ['value'] },
    },
    {
      path: ['hundred'],
      label: 'How is 100% defined?',
      kind: 'radio',
      options: [
        { value: 'largest', label: 'Largest value in each data set' },
        { value: 'last', label: 'Last value in each data set' },
        { value: 'value', label: 'Y = a value you enter' },
        { value: 'sum', label: 'Sum of all values in each data set' },
        { value: 'mean', label: 'Average of all values in each data set' },
      ],
    },
    {
      path: ['hundredValue'],
      label: '100% value',
      kind: 'number',
      showIf: { path: ['hundred'], in: ['value'] },
    },
    {
      path: ['display'],
      label: 'Present results as',
      kind: 'radio',
      options: [
        { value: 'percent', label: 'Percentages' },
        { value: 'fraction', label: 'Fractions' },
      ],
    },
  ],
  run(input, params, context) {
    const diagnostics: Diagnostic[] = exclusionNotes(input)
    const summary = input.every((d) => d.data.shape === 'summary')
    if (!summary && input.some((d) => d.data.shape === 'summary'))
      return failure('The data sets mix raw and summary data.', diagnostics)
    const scale = params.display === 'percent' ? 100 : 1
    const out: OutDataSet[] = []
    const refRows: ResultValue[][] = []
    const summaryCols: SummaryCols[] = []
    for (const ds of input) {
      const { zero, hundred } = normalizeRefs(rowMeans(ds), params)
      const range = hundred - zero
      const ok = Number.isFinite(range) && range !== 0
      if (!ok)
        diagnostics.push({
          level: 'warning',
          message: `“${ds.title}” can’t be normalized: its 0% and 100% values are ${Number.isFinite(range) ? 'equal' : 'undefined'}.`,
        })
      const f = (v: number) =>
        ok && Number.isFinite(v) ? (scale * (v - zero)) / range : Number.NaN
      const g = (v: number) =>
        ok && Number.isFinite(v) ? (scale * v) / Math.abs(range) : Number.NaN
      refRows.push([text(ds.title), num(zero), num(hundred)])
      if (ds.data.shape === 'replicates') {
        out.push({
          id: stableId(ds.ref.key),
          title: ds.title,
          subcolumns: ds.data.reps.map((c) => Float64Array.from(c, f)),
        })
      } else {
        const d = ds.data
        summaryCols.push({
          mean: Float64Array.from(d.mean, f),
          sd: Float64Array.from(d.sd, g),
          sem: Float64Array.from(d.sem, g),
          n: Float64Array.from(d.n),
        })
        out.push({ id: stableId(ds.ref.key), title: ds.title, subcolumns: [] })
      }
    }
    const yFormat = summary ? applySummaryFormat(out, summaryCols) : undefined
    return tableResult(
      'Normalize',
      [
        table('Values that define 0% and 100%', ['Data set', '0%', '100%'], refRows),
        {
          type: 'note',
          text: `Results are ${params.display === 'percent' ? 'percentages' : 'fractions'}; with replicates, 0% and 100% are defined by the row means.`,
        },
      ],
      diagnostics,
      input,
      {
        name: 'Normalize',
        tableKind: sourceKind(input, context),
        rowCount: rowCountOf(input),
        rowTitles: input[0]?.rowTitles ?? null,
        x: sourceX(input, context),
        dataSets: out,
        yFormat,
      },
    )
  },
}

// ---------------------------------------------------------------------------------------------
// Remove baseline and column math. Three layouts:
// - baseline data set: every other data set minus (or ÷, or % change from) the baseline data set,
//   row by row;
// - baseline rows: each data set minus its own value in the first (or last) row(s), averaged
//   over those rows;
// - pairs (column math): A op B, C op D, … for consecutive pairs of data sets.
// With replicates the baseline is the mean of the baseline's replicates (`match: 'mean'`) or the
// replicate with the same index (`match: 'replicate'`).
// ---------------------------------------------------------------------------------------------

const BaselineParams = z.object({
  mode: z.enum(['dataSet', 'rows', 'pairs']).default('dataSet'),
  /** Baseline data set key ('' = the first data set). */
  baseline: z.string().default(''),
  rowsAt: z.enum(['first', 'last']).default('first'),
  rowCount: z.number().int().min(1).default(1),
  operation: z.enum(['difference', 'ratio', 'percentDifference', 'sum']).default('difference'),
  match: z.enum(['mean', 'replicate']).default('mean'),
})
type BaselineParams = z.infer<typeof BaselineParams>

const OP_LABEL: Record<BaselineParams['operation'], string> = {
  difference: 'Difference (Y − baseline)',
  ratio: 'Ratio (Y / baseline)',
  percentDifference: 'Percent difference (100 × (Y − baseline) / baseline)',
  sum: 'Sum (Y + baseline)',
}
const OP_SYMBOL: Record<BaselineParams['operation'], string> = {
  difference: '−',
  ratio: '/',
  percentDifference: '% change from',
  sum: '+',
}

function combine(op: BaselineParams['operation'], y: number, b: number): number {
  if (!Number.isFinite(y) || !Number.isFinite(b)) return Number.NaN
  const r =
    op === 'difference'
      ? y - b
      : op === 'ratio'
        ? y / b
        : op === 'sum'
          ? y + b
          : (100 * (y - b)) / b
  return Number.isFinite(r) ? r : Number.NaN
}

export const removeBaselineDef: AnalysisDef<BaselineParams> = {
  id: 'removeBaseline',
  version: 1,
  title: 'Remove baseline and column math',
  category: 'Data processing',
  description:
    'Subtract (or divide by) a baseline data set or baseline rows, or combine pairs of data sets (A − B, A / B, A + B, % change).',
  accepts: ['xy', 'column', 'grouped', 'nested'],
  inputs: { min: 1, max: Number.POSITIVE_INFINITY },
  params: BaselineParams,
  producesTable: true,
  form: [
    {
      path: ['mode'],
      label: 'Where are the baseline values?',
      kind: 'radio',
      options: [
        { value: 'dataSet', label: 'In a baseline data set (column)' },
        { value: 'rows', label: 'In the first or last row(s) of each data set' },
        { value: 'pairs', label: 'Column math: combine data sets in pairs (A with B, C with D …)' },
      ],
    },
    {
      path: ['baseline'],
      label: 'Baseline data set',
      kind: 'custom',
      component: 'dataset.pick',
      showIf: { path: ['mode'], in: ['dataSet'] },
    },
    {
      path: ['rowsAt'],
      label: 'Baseline rows',
      kind: 'radio',
      options: [
        { value: 'first', label: 'First row(s)' },
        { value: 'last', label: 'Last row(s)' },
      ],
      showIf: { path: ['mode'], in: ['rows'] },
    },
    {
      path: ['rowCount'],
      label: 'Number of baseline rows (averaged)',
      kind: 'number',
      min: 1,
      step: 1,
      showIf: { path: ['mode'], in: ['rows'] },
    },
    {
      path: ['operation'],
      label: 'Calculate',
      kind: 'select',
      options: [
        { value: 'difference', label: OP_LABEL.difference },
        { value: 'ratio', label: OP_LABEL.ratio },
        { value: 'percentDifference', label: OP_LABEL.percentDifference },
        { value: 'sum', label: OP_LABEL.sum },
      ],
    },
    {
      path: ['match'],
      label: 'Replicates',
      kind: 'radio',
      options: [
        { value: 'mean', label: 'Use the mean of the baseline’s replicates' },
        { value: 'replicate', label: 'Use the baseline replicate with the same index' },
      ],
      showIf: { path: ['mode'], in: ['dataSet', 'rows'] },
    },
  ],
  run(input, params, context) {
    const diagnostics = exclusionNotes(input)
    if (input.some((d) => d.data.shape !== 'replicates'))
      return failure('Remove baseline needs raw values, not summary data.', diagnostics)
    const reps = (d: NormalizedDataSet) => (d.data as { reps: Float64Array[] }).reps
    const R = rowCountOf(input)
    const out: OutDataSet[] = []
    let desc = ''
    const byRep = params.match === 'replicate'
    if (params.mode === 'dataSet') {
      if (input.length < 2)
        return failure('Choose a baseline data set and at least one other.', diagnostics)
      const bi = pick(input, params.baseline)
      const base = input[bi]!
      const bm = rowMeans(base)
      desc = `Baseline data set: ${base.title}`
      input.forEach((ds, i) => {
        if (i === bi) return
        out.push({
          id: stableId(ds.ref.key),
          title: ds.title,
          subcolumns: reps(ds).map((c, j) =>
            Float64Array.from(c, (y, r) =>
              combine(params.operation, y, byRep ? (reps(base)[j]?.[r] ?? Number.NaN) : bm[r]!),
            ),
          ),
        })
      })
    } else if (params.mode === 'rows') {
      const n = Math.min(params.rowCount, R)
      desc = `Baseline: mean of the ${params.rowsAt} ${n === 1 ? 'row' : `${n} rows`} with values`
      for (const ds of input) {
        const cols = reps(ds)
        const filled = [...Array(R).keys()].filter((r) => cols.some((c) => Number.isFinite(c[r]!)))
        const baseRows = params.rowsAt === 'first' ? filled.slice(0, n) : filled.slice(-n)
        const all = meanOf(baseRows.map((r) => meanOf(cols.map((c) => c[r]!))))
        out.push({
          id: stableId(ds.ref.key),
          title: ds.title,
          subcolumns: cols.map((c) => {
            const b = byRep ? meanOf(baseRows.map((r) => c[r]!)) : all
            return Float64Array.from(c, (y) => combine(params.operation, y, b))
          }),
        })
      }
    } else {
      if (input.length < 2) return failure('Column math needs at least two data sets.', diagnostics)
      if (input.length % 2 === 1)
        diagnostics.push({
          level: 'info',
          message: `“${input[input.length - 1]!.title}” has no partner and was left out.`,
        })
      desc = 'Pairs of data sets: A with B, C with D, …'
      for (let i = 0; i + 1 < input.length; i += 2) {
        const a = input[i]!
        const b = input[i + 1]!
        const bm = rowMeans(b)
        out.push({
          id: stableId('pair', a.ref.key, b.ref.key),
          title: `${a.title} ${OP_SYMBOL[params.operation]} ${b.title}`,
          subcolumns: reps(a).map((c, j) =>
            Float64Array.from(c, (y, r) =>
              combine(params.operation, y, byRep ? (reps(b)[j]?.[r] ?? Number.NaN) : bm[r]!),
            ),
          ),
        })
      }
    }
    return tableResult(
      'Remove baseline',
      [
        kv('Remove baseline and column math', [
          ['Calculation', text(OP_LABEL[params.operation])],
          ['Baseline', text(desc)],
          ['Data sets in the result', int(out.length)],
        ]),
      ],
      diagnostics,
      input,
      {
        name: 'Remove baseline',
        tableKind: sourceKind(input, context),
        rowCount: R,
        rowTitles: input[0]?.rowTitles ?? null,
        x: sourceX(input, context),
        dataSets: out,
      },
    )
  },
}

// ---------------------------------------------------------------------------------------------
// Transpose: each row becomes a data set and each data set (each of its replicates) a row.
// ---------------------------------------------------------------------------------------------

const TransposeParams = z.object({
  output: z.enum(['grouped', 'column']).default('grouped'),
})
type TransposeParams = z.infer<typeof TransposeParams>

export const transposeDef: AnalysisDef<TransposeParams> = {
  id: 'transpose',
  version: 1,
  title: 'Transpose X and Y',
  category: 'Data processing',
  description:
    'Swap rows and columns: each row becomes a data set (titled by its row title or X value) and each data set a row.',
  accepts: ['xy', 'column', 'grouped'],
  inputs: { min: 1, max: Number.POSITIVE_INFINITY },
  params: TransposeParams,
  producesTable: true,
  form: [
    {
      path: ['output'],
      label: 'New table',
      kind: 'radio',
      options: [
        { value: 'grouped', label: 'Grouped table (data set titles become row titles)' },
        { value: 'column', label: 'Column table' },
      ],
    },
  ],
  run(input, params) {
    const diagnostics = exclusionNotes(input)
    if (input.some((d) => d.data.shape !== 'replicates'))
      return failure('Transpose needs raw values, not summary data.', diagnostics)
    const R = rowCountOf(input)
    const cols: { title: string; values: Float64Array }[] = []
    for (const ds of input) {
      const reps = (ds.data as { reps: Float64Array[] }).reps
      reps.forEach((c, j) => {
        cols.push({ title: reps.length > 1 ? `${ds.title} (${j + 1})` : ds.title, values: c })
      })
    }
    const rows = [...Array(R).keys()].filter((r) => cols.some((c) => Number.isFinite(c.values[r]!)))
    if (!rows.length) return failure('There are no values.', diagnostics)
    const dataSets: OutDataSet[] = rows.map((r) => ({
      id: stableId('row', String(r)),
      title: rowLabel(input, r),
      subcolumns: [Float64Array.from(cols, (c) => c.values[r] ?? Number.NaN)],
    }))
    return tableResult(
      'Transpose',
      [
        kv('Transpose', [
          ['Rows became data sets', int(rows.length)],
          ['Data sets (replicates) became rows', int(cols.length)],
        ]),
      ],
      diagnostics,
      input,
      {
        name: 'Transpose',
        tableKind: params.output,
        rowCount: cols.length,
        rowTitles: params.output === 'grouped' ? cols.map((c) => c.title) : null,
        x: null,
        dataSets,
      },
    )
  },
}

// ---------------------------------------------------------------------------------------------
// Prune rows: keep every Kth row, keep rows whose X is in a range (XY), or average every K rows.
// ---------------------------------------------------------------------------------------------

const PruneParams = z.object({
  mode: z.enum(['everyK', 'xRange', 'average']).default('everyK'),
  k: z.number().int().min(1).default(2),
  xMin: z.number().default(0),
  xMax: z.number().default(100),
})
type PruneParams = z.infer<typeof PruneParams>

function pruneRows(rowCount: number, x: ArrayLike<number> | null, p: PruneParams): number[][] {
  const groups: number[][] = []
  if (p.mode === 'everyK') {
    for (let r = 0; r < rowCount; r += p.k) groups.push([r])
  } else if (p.mode === 'xRange') {
    for (let r = 0; r < rowCount; r++) {
      const v = x?.[r] ?? Number.NaN
      if (v >= p.xMin && v <= p.xMax) groups.push([r])
    }
  } else {
    for (let r = 0; r < rowCount; r += p.k)
      groups.push([...Array(Math.min(p.k, rowCount - r)).keys()].map((i) => r + i))
  }
  return groups
}

export const pruneDef: AnalysisDef<PruneParams> = {
  id: 'prune',
  version: 1,
  title: 'Prune rows',
  category: 'Data processing',
  description:
    'Make a smaller table: keep every Kth row, keep rows whose X is within a range, or average every K rows.',
  accepts: ['xy', 'column', 'grouped', 'nested'],
  inputs: { min: 1, max: Number.POSITIVE_INFINITY },
  params: PruneParams,
  producesTable: true,
  form: [
    {
      path: ['mode'],
      label: 'Prune',
      kind: 'radio',
      options: [
        { value: 'everyK', label: 'Keep every Kth row (starting with the first)' },
        { value: 'xRange', label: 'Keep rows with X between two values (XY tables)' },
        { value: 'average', label: 'Average every K rows (X too)' },
      ],
    },
    {
      path: ['k'],
      label: 'K',
      kind: 'number',
      min: 1,
      step: 1,
      showIf: { path: ['mode'], in: ['everyK', 'average'] },
    },
    {
      path: ['xMin'],
      label: 'Smallest X',
      kind: 'number',
      showIf: { path: ['mode'], in: ['xRange'] },
    },
    {
      path: ['xMax'],
      label: 'Largest X',
      kind: 'number',
      showIf: { path: ['mode'], in: ['xRange'] },
    },
  ],
  run(input, params, context) {
    const diagnostics = exclusionNotes(input)
    const xs = sourceX(input, context)
    if (params.mode === 'xRange' && !xs)
      return failure('Only XY tables have X values.', diagnostics)
    const avg = params.mode === 'average'
    if (avg && input.some((d) => d.data.shape !== 'replicates'))
      return failure('Averaging rows needs raw values, not summary data.', diagnostics)
    const R = rowCountOf(input)
    const groups = pruneRows(R, xs?.values ?? null, params)
    const pickCol = (c: ArrayLike<number>) =>
      Float64Array.from(groups, (g) => (avg ? meanOf(g.map((r) => c[r]!)) : c[g[0]!]!))
    const summary = input.every((d) => d.data.shape === 'summary')
    const out: OutDataSet[] = []
    const summaryCols: SummaryCols[] = []
    for (const ds of input) {
      if (ds.data.shape === 'replicates') {
        out.push({
          id: stableId(ds.ref.key),
          title: ds.title,
          subcolumns: ds.data.reps.map(pickCol),
        })
      } else {
        const d = ds.data
        summaryCols.push({
          mean: pickCol(d.mean),
          sd: pickCol(d.sd),
          sem: pickCol(d.sem),
          n: pickCol(d.n),
        })
        out.push({ id: stableId(ds.ref.key), title: ds.title, subcolumns: [] })
      }
    }
    const yFormat = summary ? applySummaryFormat(out, summaryCols) : undefined
    const titles = input[0]?.rowTitles
    let kind = sourceKind(input, context)
    // A column table with summary data has exactly one row; keep that shape.
    if (kind === 'column' && summary && groups.length !== 1) kind = 'grouped'
    return tableResult(
      'Prune rows',
      [
        kv('Prune rows', [
          ['Rows in the data table', int(R)],
          ['Rows in the result', int(groups.length)],
        ]),
      ],
      diagnostics,
      input,
      {
        name: 'Pruned',
        tableKind: kind,
        rowCount: groups.length,
        rowTitles: titles ? groups.map((g) => titles[g[0]!] ?? null) : null,
        x: xs ? { title: xs.title, values: pickCol(xs.values) } : null,
        dataSets: out,
        yFormat,
      },
    )
  },
}
