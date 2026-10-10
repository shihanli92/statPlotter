import type {
  AnalysisDef,
  AnalysisResult,
  Diagnostic,
  FormField,
  NormalizedDataSet,
  ResultBlock,
  ResultValue,
  RunContext,
  TableKind,
} from '@ps/model'
import { dataSetLetter, modelFor, Random } from '@ps/stats'
import { z } from 'zod'
import {
  failure,
  int,
  kv,
  labelTable,
  num,
  result,
  resultsSheet,
  rowMeans,
  text,
} from './common.ts'
import { defaultEquationId, type FitModel, resolveEquation, USER_EQUATION } from './nonlinear.ts'
import { buildTable, stableId } from './resultTable.ts'

// Simulations (Prism's "Simulate and generate"; Statistics Guide, "Simulating data"): analyses
// that need no input data and make a data table (`producesTable`) of random data, reproducible
// from a random seed.
//
// - Simulate XY data: X values as an arithmetic or geometric series (start, increment or ratio,
//   stop when X equals or exceeds the end) or the analyzed table's X; Y from a built-in or
//   user-defined equation with parameter values per data set (or the analyzed table's Y), with
//   replicates; random error as Prism offers it: none, Gaussian (constant SD), relative
//   (Gaussian, SD a percentage of Y), double Gaussian (a percentage of the points with one SD,
//   the rest with another), Poisson (Y is the mean), t (df, scaled by the SD) or Lorentzian
//   (Cauchy, = t with df 1); then optionally a number of outliers: randomly chosen points to
//   which a value uniform between two limits is added or subtracted.
// - Simulate column data: columns of values, each column's mean given or drawn at random from a
//   Gaussian of means, with the same random-error choices.
// - Simulate a contingency table: Prism's 2 × 2 designs — cross-sectional (only the grand total
//   fixed: a multinomial over the four cells), prospective and experimental (row totals fixed:
//   a binomial outcome in each row), case-control (column totals fixed: a binomial exposure in
//   each column).
//
// Random numbers: `Random` in @ps/stats (xoshiro128**; normal and t by inversion; Poisson and
// binomial by inversion of the CDF), not Prism's Numerical Recipes routines, so the numbers
// differ from Prism's but follow the same distributions. The seed is a parameter: the same seed
// gives the same table on every machine; "New seed" in the dialog draws new data.

const ALL_KINDS: readonly TableKind[] = [
  'column',
  'xy',
  'grouped',
  'contingency',
  'survival',
  'partsOfWhole',
  'multipleVariables',
  'nested',
]

const seed = z.number().int().default(1)
const SEED_FIELD: FormField = {
  path: ['seed'],
  label: 'Random seed',
  kind: 'custom',
  component: 'sim.seed',
}

// ---- random error -------------------------------------------------------------------------------

const ErrorParams = {
  error: z
    .enum(['none', 'gaussian', 'relative', 'doubleGaussian', 'poisson', 't', 'lorentzian'])
    .default('gaussian'),
  /** Gaussian, t and Lorentzian: the SD (the scale for t and Lorentzian); double: SD 1. */
  sd: z.number().min(0).default(1),
  /** Relative: the SD as a percentage of Y. */
  percent: z.number().min(0).default(10),
  /** Double Gaussian: the percentage of points with SD 1 (`sd`), the others with SD 2. */
  doublePercent: z.number().min(0).max(100).default(50),
  sd2: z.number().min(0).default(5),
  df: z.number().gt(0).default(4),
  /** Outliers: how many points, and the limits of the uniform value added or subtracted. */
  outliers: z.number().int().min(0).default(0),
  outlierLow: z.number().default(10),
  outlierHigh: z.number().default(20),
}
const ErrorSchema = z.object(ErrorParams)
type ErrorModel = z.infer<typeof ErrorSchema>

const errorIs = (...kinds: string[]) => ({ path: ['error'], in: kinds })

const ERROR_FIELDS: FormField[] = [
  {
    path: ['error'],
    label: 'Random error',
    kind: 'select',
    options: [
      { value: 'none', label: 'Don’t add random error' },
      { value: 'gaussian', label: 'Gaussian, absolute (constant SD)' },
      { value: 'relative', label: 'Gaussian, relative (SD a percentage of Y)' },
      { value: 'doubleGaussian', label: 'Double Gaussian (two SDs)' },
      { value: 'poisson', label: 'Poisson' },
      { value: 't', label: 't distribution' },
      { value: 'lorentzian', label: 'Lorentzian (very wide)' },
    ],
  },
  {
    path: ['sd'],
    label: 'SD',
    kind: 'number',
    min: 0,
    showIf: errorIs('gaussian', 'doubleGaussian', 't', 'lorentzian'),
  },
  {
    path: ['percent'],
    label: 'SD as a percentage of Y',
    kind: 'number',
    min: 0,
    showIf: errorIs('relative'),
  },
  {
    path: ['doublePercent'],
    label: 'Percentage of points with the first SD',
    kind: 'number',
    min: 0,
    max: 100,
    showIf: errorIs('doubleGaussian'),
  },
  { path: ['sd2'], label: 'Second SD', kind: 'number', min: 0, showIf: errorIs('doubleGaussian') },
  { path: ['df'], label: 'Degrees of freedom', kind: 'number', showIf: errorIs('t') },
  { path: ['outliers'], label: 'Number of points to turn into outliers', kind: 'number', min: 0 },
  { path: ['outlierLow'], label: 'Outliers: add or subtract at least', kind: 'number' },
  { path: ['outlierHigh'], label: 'Outliers: and at most', kind: 'number' },
]

function errorLabel(p: ErrorModel): string {
  switch (p.error) {
    case 'none':
      return 'None'
    case 'gaussian':
      return `Gaussian, SD = ${p.sd}`
    case 'relative':
      return `Gaussian, relative: SD = ${p.percent}% of Y`
    case 'doubleGaussian':
      return `Double Gaussian: ${p.doublePercent}% with SD = ${p.sd}, the rest with SD = ${p.sd2}`
    case 'poisson':
      return 'Poisson (Y is the mean)'
    case 't':
      return `t distribution, df = ${p.df}, scaled by ${p.sd}`
    case 'lorentzian':
      return `Lorentzian (Cauchy), scale ${p.sd}`
  }
}

/** Y with random error added (NaN when the error can't apply: Poisson of Y < 0). */
function addError(yIdeal: number, p: ErrorModel, rng: Random): number {
  if (!Number.isFinite(yIdeal)) return Number.NaN
  switch (p.error) {
    case 'none':
      return yIdeal
    case 'gaussian':
      return yIdeal + p.sd * rng.normal()
    case 'relative':
      return yIdeal + Math.abs(yIdeal) * (p.percent / 100) * rng.normal()
    case 'doubleGaussian': {
      const sd = rng.uniform() * 100 < p.doublePercent ? p.sd : p.sd2
      return yIdeal + sd * rng.normal()
    }
    case 'poisson':
      return yIdeal >= 0 ? rng.poisson(yIdeal) : Number.NaN
    case 't':
      return yIdeal + p.sd * rng.t(p.df)
    case 'lorentzian':
      return yIdeal + p.sd * rng.t(1)
  }
}

/**
 * Turns `p.outliers` randomly chosen values (of those that aren't blank) into outliers: each
 * gets a value uniform between the limits added or subtracted (at random). Returns how many.
 */
/** The random error, the outliers added (`nOut` of them) and the seed, as result rows. */
function errorRows(p: ErrorModel & { seed: number }, nOut: number): [string, ResultValue][] {
  return [
    ['Random error', text(errorLabel(p))],
    ...(nOut
      ? ([['Outliers', text(`${nOut}, ± ${p.outlierLow} to ${p.outlierHigh}`)]] as [
          string,
          ResultValue,
        ][])
      : []),
    ['Random seed', int(p.seed)],
  ]
}

function addOutliers(cols: Float64Array[], p: ErrorModel, rng: Random): number {
  if (p.outliers <= 0) return 0
  const cells: [number, number][] = []
  cols.forEach((c, j) => {
    c.forEach((v, i) => {
      if (Number.isFinite(v)) cells.push([j, i])
    })
  })
  const n = Math.min(p.outliers, cells.length)
  const [lo, hi] = [Math.min(p.outlierLow, p.outlierHigh), Math.max(p.outlierLow, p.outlierHigh)]
  // A random sample without replacement (partial Fisher–Yates).
  for (let k = 0; k < n; k++) {
    const r = k + Math.floor(rng.uniform() * (cells.length - k))
    ;[cells[k], cells[r]] = [cells[r]!, cells[k]!]
    const [j, i] = cells[k]!
    const size = lo + (hi - lo) * rng.uniform()
    cols[j]![i] = cols[j]![i]! + (rng.uniform() < 0.5 ? -size : size)
  }
  return n
}

// ---- XY ---------------------------------------------------------------------------------------

const XYParams = z.object({
  xMode: z.enum(['arithmetic', 'geometric', 'table']).default('arithmetic'),
  /** First X; the increment (arithmetic) or ratio (geometric); stop once X equals or exceeds. */
  xStart: z.number().default(0),
  xStep: z.number().default(1),
  xEnd: z.number().default(10),
  yFrom: z.enum(['equation', 'table']).default('equation'),
  equation: z.string().default(() => defaultEquationId()),
  userEquation: z.string().default(''),
  /**
   * One entry per simulated data set: its title ('' = Data Set A, B…) and parameter values by
   * name (missing ones take the equation's default).
   */
  dataSets: z
    .array(
      z.object({
        title: z.string().default(''),
        values: z.record(z.string(), z.number()).default({}),
      }),
    )
    .min(1)
    .default([{ title: '', values: {} }]),
  replicates: z.number().int().min(1).max(100).default(1),
  ...ErrorParams,
  seed,
})
type SimulateXYParams = z.infer<typeof XYParams>

/** A parameter value to simulate with when none is given (as Plot a function). */
export function defaultParamValue(eq: Pick<FitModel, 'paramInfo'>, name: string): number {
  const c = eq.paramInfo[name]?.defaultConstraint
  if (c && typeof c === 'object' && 'constant' in c) return c.constant
  if (/^(bottom|baseline|y0|y\[0\]|nonspecific|ns|background|basal)$/i.test(name)) return 0
  if (/^(top|plateau|ym|ymax|bmax|vmax|amplitude|span|effectmax)$/i.test(name)) return 100
  if (/^log(ec|ic)50/i.test(name)) return -6
  return 1
}

const MAX_X = 100_000

function xValues(p: SimulateXYParams, input: readonly NormalizedDataSet[]): Float64Array | string {
  if (p.xMode === 'table') {
    const x = input.find((d) => d.x)?.x
    if (!x) return 'X values from the analyzed table need an XY table.'
    return Float64Array.from(x)
  }
  const geo = p.xMode === 'geometric'
  if (geo && !(p.xStart > 0 && p.xStep > 1))
    return 'A geometric series needs a first X above 0 and a ratio above 1.'
  if (!geo && !(p.xStep > 0)) return 'The increment must be above 0.'
  const xs: number[] = []
  // Stop once X equals or exceeds the end (that X included).
  for (let i = 0; i < MAX_X; i++) {
    const x = geo ? p.xStart * p.xStep ** i : p.xStart + p.xStep * i
    xs.push(x)
    if (x >= p.xEnd - 1e-9 * Math.abs(p.xStep) || !Number.isFinite(x)) break
  }
  return Float64Array.from(xs)
}

const xSeries = { path: ['xMode'], in: ['arithmetic', 'geometric'] }

export const simulateXYDef: AnalysisDef<SimulateXYParams> = {
  id: 'simulateXY',
  version: 1,
  title: 'Simulate XY data',
  category: 'Simulate and generate',
  description:
    'Make an XY table of simulated data: Y from an equation (built-in or your own) at a series of X values, with Gaussian, relative, double Gaussian, Poisson, t or Lorentzian random error and outliers, several data sets and replicates, reproducible from a random seed.',
  accepts: ALL_KINDS,
  inputs: { min: 0, max: 64 },
  usesData: (p) => p.xMode === 'table',
  producesTable: true,
  params: XYParams,
  form: [
    {
      path: ['xMode'],
      label: 'X values',
      kind: 'radio',
      options: [
        { value: 'arithmetic', label: 'Arithmetic series (start, increment)' },
        { value: 'geometric', label: 'Geometric series (start, ratio)' },
        { value: 'table', label: 'The X values of the analyzed table' },
      ],
    },
    { path: ['xStart'], label: 'Starting X', kind: 'number', showIf: xSeries },
    {
      path: ['xStep'],
      label: 'Increment (arithmetic) or ratio (geometric)',
      kind: 'number',
      showIf: xSeries,
    },
    { path: ['xEnd'], label: 'Stop when X equals or exceeds', kind: 'number', showIf: xSeries },
    {
      path: ['yFrom'],
      label: 'Y values',
      kind: 'radio',
      options: [
        { value: 'equation', label: 'From an equation' },
        { value: 'table', label: 'The Y values of the analyzed table (plus random error)' },
      ],
    },
    {
      path: ['equation'],
      label: 'Equation',
      kind: 'custom',
      component: 'nlfit.equation',
      showIf: { path: ['yFrom'], in: ['equation'] },
    },
    {
      path: ['userEquation'],
      label: 'Your equation',
      kind: 'custom',
      component: 'nlfit.userEquation',
      showIf: [
        { path: ['yFrom'], in: ['equation'] },
        { path: ['equation'], in: [USER_EQUATION] },
      ],
    },
    {
      path: ['dataSets'],
      label: 'Parameter values of each data set',
      kind: 'custom',
      component: 'sim.dataSets',
      showIf: { path: ['yFrom'], in: ['equation'] },
    },
    { path: ['replicates'], label: 'Replicates (Y values at each X)', kind: 'number', min: 1 },
    ...ERROR_FIELDS,
    SEED_FIELD,
  ],
  run: (input, params) => simulateXY(input, params),
}

function simulateXY(input: readonly NormalizedDataSet[], p: SimulateXYParams): AnalysisResult {
  const xs = xValues(p, input)
  if (typeof xs === 'string') return failure(xs)
  const rng = new Random(p.seed)
  const diagnostics: Diagnostic[] = []
  const n = xs.length
  const sets: { id: string; title: string; subcolumns: Float64Array[] }[] = []
  const blocks: ResultBlock[] = []
  if (p.yFrom === 'table') {
    const src = input.filter((d) => d.x)
    if (!src.length) return failure('Y values from the table need an XY table with data sets.')
    src.forEach((d, k) => {
      const ideal = rowMeans(d)
      const subcolumns = Array.from({ length: p.replicates }, () => new Float64Array(n))
      for (let r = 0; r < n; r++)
        for (const c of subcolumns) c[r] = addError(r < d.rowCount ? ideal[r]! : Number.NaN, p, rng)
      sets.push({ id: stableId('simxy', String(k)), title: d.title, subcolumns })
    })
    blocks.push({ type: 'note', text: 'Y: the mean Y of each row of the analyzed table.' })
  } else {
    const r = resolveEquation({
      equation: p.equation,
      userEquation: p.userEquation,
      initialValues: {},
    })
    if (!r.ok) return failure(r.message)
    const model = r.model
    p.dataSets.forEach((ds, k) => {
      const values = model.params.map((name) => ds.values[name] ?? defaultParamValue(model, name))
      let m: Pick<FitModel, 'f'> = model
      try {
        m = modelFor(model, { dataSet: k })
      } catch (e) {
        diagnostics.push({ level: 'warning', message: e instanceof Error ? e.message : String(e) })
      }
      const subcolumns = Array.from({ length: p.replicates }, () => new Float64Array(n))
      let bad = 0
      for (let i = 0; i < n; i++) {
        const yi = m.f(xs[i]!, values)
        if (!Number.isFinite(yi)) bad++
        for (const c of subcolumns) c[i] = addError(yi, p, rng)
      }
      if (bad)
        diagnostics.push({
          level: 'warning',
          message: `The equation isn’t defined at ${bad} X value${bad === 1 ? '' : 's'} of data set ${dataSetLetter(k)}; those Y values are blank.`,
        })
      sets.push({
        id: stableId('simxy', String(k)),
        title: ds.title || `Data Set ${dataSetLetter(k)}`,
        subcolumns,
      })
    })
    blocks.push(
      { type: 'note', text: `${model.name}: ${model.formula}` },
      labelTable(
        'Parameter values',
        sets.map((s) => s.title),
        model.params.map((name) => [
          name,
          p.dataSets.map((ds) => num(ds.values[name] ?? defaultParamValue(model, name))),
        ]),
      ),
    )
  }
  const nOut = addOutliers(
    sets.flatMap((s) => s.subcolumns),
    p,
    rng,
  )
  if (p.error === 'poisson' && sets.some((s) => s.subcolumns.some((c) => c.some(Number.isNaN))))
    diagnostics.push({
      level: 'info',
      message: 'Poisson error needs Y ≥ 0; Y values below zero are left blank.',
    })
  blocks.push(
    kv('Simulation', [
      ['Number of X values', int(n)],
      ['Data sets', int(sets.length)],
      ['Replicates', int(p.replicates)],
      ...errorRows(p, nOut),
    ]),
  )
  return result({
    diagnostics,
    sheets: [resultsSheet(blocks, 'Simulation')],
    table: buildTable(input, {
      name: 'Simulated XY data',
      tableKind: 'xy',
      rowCount: n,
      rowTitles: null,
      x: { title: 'X', values: xs },
      dataSets: sets,
      notes: `Simulated data (seed ${p.seed}).`,
    }),
  })
}

// ---- column -----------------------------------------------------------------------------------

const ColumnParams = z.object({
  /** Each column's population mean as entered, or drawn from a Gaussian of means. */
  meanMode: z.enum(['entered', 'random']).default('entered'),
  meanOfMeans: z.number().default(10),
  sdOfMeans: z.number().min(0).default(2),
  /** One entry per column: title ('' = A, B…), number of values, population mean. */
  columns: z
    .array(
      z.object({
        title: z.string().default(''),
        n: z.number().int().min(1).max(100000).default(10),
        mean: z.number().default(10),
      }),
    )
    .min(1)
    .default([
      { title: '', n: 10, mean: 10 },
      { title: '', n: 10, mean: 12 },
    ]),
  ...ErrorParams,
  seed,
})
type SimulateColumnParams = z.infer<typeof ColumnParams>

export const simulateColumnDef: AnalysisDef<SimulateColumnParams> = {
  id: 'simulateColumn',
  version: 1,
  title: 'Simulate column data',
  category: 'Simulate and generate',
  description:
    'Make a column table of random values: a population mean for each column (entered, or drawn at random) plus Gaussian, relative, double Gaussian, Poisson, t or Lorentzian random error and outliers, reproducible from a random seed.',
  accepts: ALL_KINDS,
  inputs: { min: 0, max: 64 },
  usesData: () => false,
  producesTable: true,
  params: ColumnParams,
  form: [
    {
      path: ['meanMode'],
      label: 'Column means',
      kind: 'radio',
      options: [
        { value: 'entered', label: 'Enter the population mean of each column' },
        { value: 'random', label: 'Choose each column’s mean at random' },
      ],
    },
    {
      path: ['meanOfMeans'],
      label: 'Mean of the column means',
      kind: 'number',
      showIf: { path: ['meanMode'], in: ['random'] },
    },
    {
      path: ['sdOfMeans'],
      label: 'SD of the column means',
      kind: 'number',
      min: 0,
      showIf: { path: ['meanMode'], in: ['random'] },
    },
    { path: ['columns'], label: 'Columns', kind: 'custom', component: 'sim.columns' },
    ...ERROR_FIELDS,
    SEED_FIELD,
  ],
  run: (_input, p) => simulateColumn(p),
}

function simulateColumn(p: SimulateColumnParams): AnalysisResult {
  const rng = new Random(p.seed)
  const means = p.columns.map((c) =>
    p.meanMode === 'random' ? p.meanOfMeans + p.sdOfMeans * rng.normal() : c.mean,
  )
  const rowCount = Math.max(...p.columns.map((c) => c.n))
  const cols = p.columns.map((c, k) => {
    const v = new Float64Array(rowCount).fill(Number.NaN)
    for (let i = 0; i < c.n; i++) v[i] = addError(means[k]!, p, rng)
    return v
  })
  const nOut = addOutliers(cols, p, rng)
  const sets = cols.map((v, k) => ({
    id: stableId('simcol', String(k)),
    title: p.columns[k]!.title || dataSetLetter(k),
    subcolumns: [v],
  }))
  return result({
    sheets: [
      resultsSheet(
        [
          labelTable(
            'Columns',
            sets.map((s) => s.title),
            [
              ['N', p.columns.map((c) => int(c.n))],
              [
                p.meanMode === 'random' ? 'Population mean (drawn)' : 'Population mean',
                means.map((m) => num(m)),
              ],
            ],
          ),
          kv('Simulation', errorRows(p, nOut)),
        ],
        'Simulation',
      ),
    ],
    table: buildTable([], {
      name: 'Simulated column data',
      tableKind: 'column',
      rowCount,
      rowTitles: null,
      x: null,
      dataSets: sets,
      notes: `Simulated data (seed ${p.seed}).`,
    }),
  })
}

// ---- contingency ------------------------------------------------------------------------------

const ContingencyParams = z.object({
  /** Grand total of the four cells. */
  total: z.number().int().min(1).max(100_000_000).default(100),
  design: z
    .enum(['crossSectional', 'prospective', 'experimental', 'caseControl'])
    .default('experimental'),
  rowTitles: z.tuple([z.string(), z.string()]).default(['Treated', 'Control']),
  columnTitles: z.tuple([z.string(), z.string()]).default(['Outcome', 'No outcome']),
  /** Fraction of subjects in the first row (all designs but case-control). */
  pRow1: z.number().min(0).max(1).default(0.5),
  /** Probability of the first outcome in the first and second rows (all but case-control). */
  pOutcome1: z.number().min(0).max(1).default(0.3),
  pOutcome2: z.number().min(0).max(1).default(0.5),
  /** Case-control: fraction of cases (first column), probability of the first row in each. */
  pCases: z.number().min(0).max(1).default(0.5),
  pExposedCases: z.number().min(0).max(1).default(0.4),
  pExposedControls: z.number().min(0).max(1).default(0.2),
  seed,
})
type SimulateContingencyParams = z.infer<typeof ContingencyParams>

const notCaseControl = {
  path: ['design'],
  in: ['crossSectional', 'prospective', 'experimental'],
}
const caseControl = { path: ['design'], in: ['caseControl'] }

export const simulateContingencyDef: AnalysisDef<SimulateContingencyParams> = {
  id: 'simulateContingency',
  version: 1,
  title: 'Simulate contingency table',
  category: 'Simulate and generate',
  description:
    'Make a 2 × 2 contingency table at random for a cross-sectional, prospective, experimental or case-control design, reproducible from a random seed.',
  accepts: ALL_KINDS,
  inputs: { min: 0, max: 64 },
  usesData: () => false,
  producesTable: true,
  params: ContingencyParams,
  form: [
    { path: ['total'], label: 'Total sample size', kind: 'number', min: 1 },
    {
      path: ['design'],
      label: 'Experimental design',
      kind: 'radio',
      options: [
        { value: 'crossSectional', label: 'Cross-sectional (only the total is fixed)' },
        { value: 'prospective', label: 'Prospective (row totals fixed)' },
        { value: 'experimental', label: 'Experimental (row totals fixed)' },
        { value: 'caseControl', label: 'Case-control, retrospective (column totals fixed)' },
      ],
    },
    { path: ['rowTitles'], label: 'Titles', kind: 'custom', component: 'sim.titles2x2' },
    {
      path: ['pRow1'],
      label: 'Fraction of subjects in the first row',
      kind: 'number',
      min: 0,
      max: 1,
      showIf: notCaseControl,
    },
    {
      path: ['pOutcome1'],
      label: 'Probability of the first outcome, first row',
      kind: 'number',
      min: 0,
      max: 1,
      showIf: notCaseControl,
    },
    {
      path: ['pOutcome2'],
      label: 'Probability of the first outcome, second row',
      kind: 'number',
      min: 0,
      max: 1,
      showIf: notCaseControl,
    },
    {
      path: ['pCases'],
      label: 'Fraction of subjects that are cases (first column)',
      kind: 'number',
      min: 0,
      max: 1,
      showIf: caseControl,
    },
    {
      path: ['pExposedCases'],
      label: 'Probability of the first row among cases',
      kind: 'number',
      min: 0,
      max: 1,
      showIf: caseControl,
    },
    {
      path: ['pExposedControls'],
      label: 'Probability of the first row among controls',
      kind: 'number',
      min: 0,
      max: 1,
      showIf: caseControl,
    },
    SEED_FIELD,
  ],
  run: (_input, p) => simulateContingency(p),
}

/** The four cells [[a, b], [c, d]] of a simulated 2 × 2 table. */
function contingencyCells(p: SimulateContingencyParams, rng: Random): number[][] {
  const N = p.total
  if (p.design === 'caseControl') {
    const cases = Math.round(N * p.pCases)
    const controls = N - cases
    const a = rng.binomial(cases, p.pExposedCases)
    const b = rng.binomial(controls, p.pExposedControls)
    return [
      [a, b],
      [cases - a, controls - b],
    ]
  }
  if (p.design === 'crossSectional') {
    // Multinomial over the cells by successive binomials.
    const probs = [
      p.pRow1 * p.pOutcome1,
      p.pRow1 * (1 - p.pOutcome1),
      (1 - p.pRow1) * p.pOutcome2,
      (1 - p.pRow1) * (1 - p.pOutcome2),
    ]
    const cells: number[] = []
    let left = N
    let pLeft = 1
    for (let j = 0; j < 3; j++) {
      const x = pLeft > 0 ? rng.binomial(left, Math.min(1, probs[j]! / pLeft)) : 0
      cells.push(x)
      left -= x
      pLeft -= probs[j]!
    }
    cells.push(left)
    return [
      [cells[0]!, cells[1]!],
      [cells[2]!, cells[3]!],
    ]
  }
  const n1 = Math.round(N * p.pRow1)
  const n2 = N - n1
  const a = rng.binomial(n1, p.pOutcome1)
  const c = rng.binomial(n2, p.pOutcome2)
  return [
    [a, n1 - a],
    [c, n2 - c],
  ]
}

function simulateContingency(p: SimulateContingencyParams): AnalysisResult {
  const rng = new Random(p.seed)
  const cells = contingencyCells(p, rng)
  const DESIGN: Record<SimulateContingencyParams['design'], string> = {
    crossSectional: 'Cross-sectional: the grand total is fixed',
    prospective: 'Prospective: row totals fixed',
    experimental: 'Experimental: row totals fixed',
    caseControl: 'Case-control: column totals fixed',
  }
  const probs: [string, ResultValue][] =
    p.design === 'caseControl'
      ? [
          ['Fraction of cases', num(p.pCases)],
          [`P(${p.rowTitles[0]}) among cases`, num(p.pExposedCases)],
          [`P(${p.rowTitles[0]}) among controls`, num(p.pExposedControls)],
        ]
      : [
          [`Fraction in ${p.rowTitles[0]}`, num(p.pRow1)],
          [`P(${p.columnTitles[0]}) in ${p.rowTitles[0]}`, num(p.pOutcome1)],
          [`P(${p.columnTitles[0]}) in ${p.rowTitles[1]}`, num(p.pOutcome2)],
        ]
  return result({
    sheets: [
      resultsSheet(
        [
          kv('Design', [
            ['Design', text(DESIGN[p.design])],
            ['Total', int(p.total)],
            ...probs,
            ['Random seed', int(p.seed)],
          ]),
        ],
        'Simulation',
      ),
    ],
    table: buildTable([], {
      name: 'Simulated contingency table',
      tableKind: 'contingency',
      rowCount: 2,
      rowTitles: [...p.rowTitles],
      x: null,
      dataSets: p.columnTitles.map((title, j) => ({
        id: stableId('simct', String(j)),
        title,
        subcolumns: [Float64Array.from(cells, (r) => r[j]!)],
      })),
      notes: `Simulated counts (seed ${p.seed}).`,
    }),
  })
}

/** The simulation analyses, by id (the Monte Carlo analysis reruns them). */
export const SIMULATIONS: Record<
  string,
  { def: AnalysisDef<unknown>; context: RunContext; title: string }
> = {
  simulateXY: {
    def: simulateXYDef as unknown as AnalysisDef<unknown>,
    context: { tableKind: 'xy', xTitle: 'X' },
    title: 'Simulated XY data',
  },
  simulateColumn: {
    def: simulateColumnDef as unknown as AnalysisDef<unknown>,
    context: { tableKind: 'column', xTitle: null },
    title: 'Simulated column data',
  },
  simulateContingency: {
    def: simulateContingencyDef as unknown as AnalysisDef<unknown>,
    context: { tableKind: 'contingency', xTitle: null },
    title: 'Simulated contingency table',
  },
}
