import type { FieldText, FormText } from './types.ts'

// Roadmap 51a: the text of the data-processing, manipulation and simulation analyses.

/** What each function of Transform does to a value V (Y or X). */
const FUNCTIONS: Readonly<Record<string, (v: string) => string>> = {
  none: () => 'Leave the values as they are.',
  multiplyK: (v) => `Multiply each ${v} by K (a change of units).`,
  addK: (v) => `Add K to each ${v}.`,
  subtractK: (v) => `Subtract K from each ${v} (a background).`,
  divideK: (v) => `Divide each ${v} by K (a change of units).`,
  square: (v) => `${v} squared.`,
  powerK: (v) => `${v} to the power K.`,
  log10: (v) => `The base-10 logarithm: a ratio of ${v}s becomes a difference.`,
  negLog10: () => 'Minus the base-10 logarithm (P values to −log10 P, pH).',
  ln: (v) => `The natural logarithm of ${v}.`,
  log2: () => 'The base-2 logarithm: one unit is a doubling (fold changes).',
  pow10: (v) => `10 to the power ${v}: undoes log10.`,
  exp: (v) => `e to the power ${v}: undoes ln.`,
  pow2: (v) => `2 to the power ${v}: undoes log2.`,
  reciprocal: (v) => `1 / ${v}, e.g. a rate from a time.`,
  sqrt: (v) => `The square root of ${v} (counts).`,
  abs: (v) => `${v} without its sign.`,
  sin: (v) => `The sine of ${v}, in radians.`,
  cos: (v) => `The cosine of ${v}, in radians.`,
  tan: (v) => `The tangent of ${v}, in radians.`,
  arcsin: (v) => `The arcsine of ${v}, in radians.`,
  arcsinSqrt: (v) => `The arcsine of the square root of ${v} (proportions).`,
  logit: (v) => `The log odds of a proportion ${v} between 0 and 1.`,
  probit: (v) => `The normal quantile of a proportion ${v}, plus 5.`,
  kMinusY: (v) => `K minus ${v}, e.g. 100 − % alive.`,
  kDivY: (v) => `K divided by ${v}.`,
  round: (v) => `${v} rounded to K decimal places.`,
  rank: () => 'The rank of each value within its data set.',
  zscore: () => 'How many SDs each value lies from its data set’s mean.',
  xDivY: () => 'X divided by Y (XY tables).',
  yDivX: () => 'Y divided by X (XY tables).',
  yMinusX: () => 'Y minus X (XY tables).',
  yPlusX: () => 'Y plus X (XY tables).',
  yTimesX: () => 'Y times X (XY tables).',
  xMinusY: () => 'X minus Y (XY tables).',
}

const functions = (v: 'Y' | 'X', ids: readonly string[]) =>
  Object.fromEntries(ids.map((id) => [id, FUNCTIONS[id]!(v)]))

const Y_IDS = Object.keys(FUNCTIONS)
/** X functions: the element-wise ones (no ranks, z scores or functions of both X and Y). */
const NOT_FOR_X = ['rank', 'zscore', 'xDivY', 'yDivX', 'yMinusX', 'yPlusX', 'yTimesX', 'xMinusY']
const X_IDS = Y_IDS.filter((id) => !NOT_FOR_X.includes(id))

const RANDOM_ERROR: FieldText = {
  line: 'The kind of scatter added to each simulated value.',
  options: {
    none: 'No scatter: the values exactly.',
    gaussian: 'Normal scatter with the same SD everywhere.',
    relative: 'Normal scatter with an SD proportional to the value.',
    doubleGaussian: 'A mixture of two normal scatters (a few wilder values).',
    poisson: 'Counts: the scatter grows with the square root of the value.',
    t: 't-distributed scatter: heavier tails than normal.',
    lorentzian: 'Very heavy tails: many extreme values.',
  },
}

const SIM_ERROR: FormText = {
  error: RANDOM_ERROR,
  sd: { line: 'The SD of the random error.' },
  percent: { line: 'The SD as a percentage of each value.' },
  doublePercent: { line: 'The share of values drawn with the first SD.' },
  sd2: { line: 'The SD of the other values.' },
  df: { line: 'Fewer degrees of freedom, heavier tails.' },
  outliers: { line: 'How many values to push far from the rest.' },
  outlierLow: { line: 'Outliers move at least this far.' },
  outlierHigh: { line: 'And at most this far.' },
}

export const TOOL_TEXT: Readonly<Record<string, FormText>> = {
  fractionOfTotal: {
    divideBy: {
      line: 'Which total each value is divided by.',
      options: {
        column: 'Its column’s total.',
        row: 'Its row’s total.',
        grand: 'The total of the whole table.',
      },
    },
    display: {
      line: 'Show the results as fractions or percentages.',
      options: { fraction: 'Between 0 and 1.', percent: 'Between 0 and 100.' },
    },
  },
  transform: {
    y: {
      line: 'log10(Y) is the base-10 logarithm; values ≤ 0 have none and are left empty.',
      options: functions('Y', Y_IDS),
    },
    k: { line: 'The constant K of the function chosen.' },
    kByDataSet: { line: 'A different K for some data sets.' },
    x: {
      line: 'XY tables: a function of X too (log10 of doses for log-dose models).',
      options: functions('X', X_IDS),
    },
    kx: { line: 'The constant K of the X function.' },
  },
  normalize: {
    zero: {
      line: 'Which value becomes 0%.',
      options: {
        smallest: 'The smallest value in each data set.',
        first: 'The first value in each data set.',
        value: 'A value you enter (e.g. the blank).',
      },
    },
    zeroValue: { line: 'The value that becomes 0%.' },
    hundred: {
      line: 'Which value becomes 100%.',
      options: {
        largest: 'The largest value in each data set.',
        last: 'The last value in each data set.',
        value: 'A value you enter (e.g. the untreated control).',
        sum: 'The sum of each data set.',
        mean: 'The mean of each data set.',
      },
    },
    hundredValue: { line: 'The value that becomes 100%.' },
    display: {
      line: 'Show the results as percentages or fractions.',
      options: { percent: 'From 0 to 100.', fraction: 'From 0 to 1.' },
    },
  },
  removeBaseline: {
    mode: {
      line: 'Where the baseline values are.',
      options: {
        dataSet: 'In a data set of its own (a blank or vehicle column).',
        rows: 'In the first or last rows of each data set (before treatment).',
        pairs: 'Combine data sets in pairs: A with B, C with D.',
      },
    },
    baseline: { line: 'The data set holding the baseline.' },
    rowsAt: {
      line: 'Which rows hold the baseline.',
      options: { first: 'The first rows.', last: 'The last rows.' },
    },
    rowCount: { line: 'How many baseline rows are averaged.' },
    operation: {
      line: 'How each value is combined with its baseline.',
      options: {
        difference: 'Value minus baseline.',
        ratio: 'Value divided by baseline.',
        percentDifference: 'The change as a percentage of the baseline.',
        sum: 'Value plus baseline.',
      },
    },
    match: {
      line: 'Use the baseline’s mean, or its replicate with the same index.',
      options: {
        mean: 'The mean of the baseline’s replicates.',
        replicate: 'Replicate i of the baseline for replicate i of each data set.',
      },
    },
  },
  transpose: {
    output: {
      line: 'The kind of table the rows become.',
      options: {
        grouped: 'A grouped table; data set titles become row titles.',
        column: 'A column table.',
      },
    },
  },
  prune: {
    mode: {
      line: 'Which rows to keep.',
      options: {
        everyK: 'Every Kth row, starting with the first.',
        xRange: 'Rows with X between two values (XY tables).',
        average: 'The average of every K rows (X too).',
      },
    },
    k: { line: 'Keep (or average) every K rows.' },
    xMin: { line: 'The smallest X kept.' },
    xMax: { line: 'The largest X kept.' },
  },
  filterRows: {
    condition: { line: 'The rows kept: a condition on the variables, e.g. Group = "Placebo".' },
  },
  aggregate: {
    stats: { line: 'The summaries of each number variable in each group.' },
    threshold: { line: 'For “% above”: the share of values greater than this.' },
  },
  percentages: {
    of: {
      line: 'Which total each count is a percentage of.',
      options: {
        row: 'Its row’s total (compare outcomes between groups).',
        column: 'Its column’s total.',
        total: 'The grand total.',
      },
    },
  },
  survivalTime: {
    from: {
      line: 'The unit the times are in now.',
      options: { days: 'Days.', weeks: 'Weeks.', months: 'Months.', years: 'Years.' },
    },
    to: {
      line: 'The unit to convert them to.',
      options: { days: 'Days.', weeks: 'Weeks.', months: 'Months.', years: 'Years.' },
    },
  },
  simulateXY: {
    xMode: {
      line: 'Where the X values come from.',
      options: {
        arithmetic: 'Equally spaced: start, start + step, …',
        geometric: 'Each X the previous times a ratio (doses in steps).',
        table: 'The X values of the table analyzed.',
      },
    },
    xStart: { line: 'The first X.' },
    xStep: { line: 'The step (arithmetic) or ratio (geometric) between X values.' },
    xEnd: { line: 'Stop when X reaches this value.' },
    yFrom: {
      line: 'Simulate Y from an equation, or add scatter to the table’s Y values.',
      options: {
        equation: 'From an equation with parameters you set.',
        table: 'The table’s Y values plus random error.',
      },
    },
    equation: { line: 'The model the values follow.' },
    userEquation: { line: 'Your own equation.' },
    dataSets: { line: 'The parameter values of each simulated data set.' },
    replicates: { line: 'How many Y values at each X.' },
    ...SIM_ERROR,
  },
  simulateColumn: {
    meanMode: {
      line: 'Set each column’s mean, or draw the means at random.',
      options: {
        entered: 'The population mean you enter for each column.',
        random: 'Means drawn from a distribution you set.',
      },
    },
    meanOfMeans: { line: 'The average of the random column means.' },
    sdOfMeans: { line: 'How much the random column means vary.' },
    columns: { line: 'Each column’s title, size and mean.' },
    ...SIM_ERROR,
  },
  simulateContingency: {
    total: { line: 'How many subjects in the table.' },
    design: {
      line: 'Which totals the design fixes.',
      options: {
        crossSectional: 'Only the total: subjects sampled, then classified.',
        prospective: 'The row totals: groups followed for the outcome.',
        experimental: 'The row totals: subjects assigned to the groups.',
        caseControl: 'The column totals: cases and controls, then exposure.',
      },
    },
    rowTitles: { line: 'The names of the groups and outcomes.' },
    pRow1: { line: 'The share of subjects in the first row.' },
    pOutcome1: { line: 'The chance of the first outcome in the first row.' },
    pOutcome2: { line: 'The chance of the first outcome in the second row.' },
    pCases: { line: 'The share of subjects that are cases.' },
    pExposedCases: { line: 'The chance a case is in the first row.' },
    pExposedControls: { line: 'The chance a control is in the first row.' },
  },
  monteCarlo: {
    simulation: { line: 'How each simulated data set is made.' },
    analysis: { line: 'The analysis run on each simulated data set.' },
    tabulate: { line: 'The results collected from every simulation.' },
    hits: { line: 'What counts as a hit, e.g. P < 0.05: the fraction of hits is the power.' },
    hitDenominator: {
      line: 'Count hits out of every simulation, or only those with a result.',
      options: {
        all: 'Out of every simulation.',
        determined: 'Out of the simulations where the result could be computed.',
      },
    },
    simulations: { line: 'More simulations, a more precise fraction of hits.' },
    alpha: { line: 'Summaries report the fraction of P values below this.' },
  },
}
