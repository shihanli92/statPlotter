import type { MethodCard } from '@ps/model'

// Roadmap 51a: cards of the analyses that compute a table rather than test anything (data
// processing, manipulation, simulation). They have no null hypothesis and need no reference.

type Tool = Pick<MethodCard, 'id' | 'name' | 'question' | 'useWhen' | 'reading'> & {
  shortName?: string
  instead?: MethodCard['instead']
  assumptions?: MethodCard['assumptions']
  r: string
  formula?: string
  references?: MethodCard['references']
}

const tool = (t: Tool): MethodCard => ({
  id: t.id,
  name: t.name,
  shortName: t.shortName ?? t.name,
  question: t.question,
  nullHypothesis: null,
  useWhen: t.useWhen,
  instead: t.instead ?? [],
  assumptions: t.assumptions ?? [],
  reading: t.reading,
  more: { formula: t.formula ?? 'A calculation, no statistic.', r: t.r },
  references: t.references ?? [],
})

export const rowStats = tool({
  id: 'rowStats',
  name: 'Row statistics',
  question: 'What are the mean, SD, SEM and n of each row?',
  useWhen: 'Summarizing the replicates of each row, per data set or across them all.',
  instead: [{ card: 'descriptive', when: 'you want each column summarized' }],
  reading: 'Read each row’s summary; the result is a table you can graph or analyze further.',
  formula: 'Mean, SD (n − 1), SEM and CI of each row’s values.',
  r: 'apply(m, 1, mean); apply(m, 1, sd)',
})

export const fractionOfTotal = tool({
  id: 'fractionOfTotal',
  name: 'Fraction of total',
  question: 'What fraction of its column, row or grand total is each value?',
  useWhen: 'Showing parts of a whole, or counts as proportions before graphing.',
  reading: 'Read each value as a fraction (or percentage) of the total you chose.',
  r: 'prop.table(m, margin = 2)',
})

export const transform = tool({
  id: 'transform',
  name: 'Transform',
  question: 'What do the values look like on another scale (logarithms, reciprocals, ranks)?',
  useWhen:
    'Values that change by a factor (concentrations, fold changes): logarithms make a ratio into a difference, so a t test of the logs compares ratios.',
  instead: [{ card: 'normalize', when: 'you want values as a percentage of a reference' }],
  assumptions: ['Logarithms need values above zero; others are left empty.'],
  reading:
    'The result is a new table that follows its source. Analyze or graph it as any table; its titles say which transform it holds.',
  formula: 'The chosen function of each Y (and, on XY tables, X) value.',
  r: 'log10(y)',
})

export const normalize = tool({
  id: 'normalize',
  name: 'Normalize',
  question: 'What are the values as a percentage of a reference (0% and 100%)?',
  useWhen: 'Putting experiments on one scale before combining them, e.g. dose-response curves.',
  instead: [{ card: 'removeBaseline', when: 'you want differences or ratios from a baseline' }],
  assumptions: [
    'A group normalized to itself becomes exactly 100 with no variation: compare the other groups with 100 rather than testing it.',
  ],
  reading: 'Read each value as a percentage (or fraction) of the range you defined.',
  formula: '100 × (Y − zero) / (hundred − zero).',
  r: '100 * (y - zero) / (hundred - zero)',
})

export const removeBaseline = tool({
  id: 'removeBaseline',
  name: 'Remove baseline and column math',
  question: 'What are the values after subtracting (or dividing by) a baseline?',
  useWhen: 'Background subtraction, change from baseline, or combining data sets in pairs.',
  reading: 'The result is a new table of differences, ratios or sums that follows its source.',
  formula: 'Y − baseline, Y / baseline, 100 × (Y − baseline) / baseline, or Y + baseline.',
  r: 'y - baseline',
})

export const transpose = tool({
  id: 'transpose',
  name: 'Transpose',
  question: 'What does the table look like with rows and columns swapped?',
  useWhen: 'Data entered one way that an analysis or graph needs the other way.',
  reading: 'Each row becomes a data set, each data set a row.',
  r: 't(m)',
})

export const prune = tool({
  id: 'prune',
  name: 'Prune rows',
  question: 'What is a smaller table of every Kth row, or of an X range?',
  useWhen: 'Long traces too dense to graph, or a part of an XY table.',
  reading: 'The result is a smaller table that follows its source.',
  r: 'd[seq(1, nrow(d), by = k), ]',
})

export const filterRows = tool({
  id: 'filterRows',
  name: 'Filter rows',
  question: 'Which rows meet a condition?',
  useWhen:
    'Analyzing or graphing a subset (one sample, one sex) that follows the table as it changes.',
  reading: 'The result is a table of the rows kept; the results say how many.',
  r: 'subset(d, sample == "S1" & nCount > 500)',
})

export const aggregate = tool({
  id: 'aggregate',
  name: 'Aggregate by group',
  question: 'What are the mean, median, SD and n of each number variable, per group?',
  useWhen:
    'Summarizing many rows per group before testing, e.g. one value per sample (pseudobulk) so the samples are the independent units.',
  reading: 'The result has one row per group, following the source.',
  r: 'aggregate(cbind(x, y) ~ group, data = d, FUN = mean)',
})

export const percentages = tool({
  id: 'percentages',
  name: 'Row, column or total percentages',
  question: 'What percentage of its row, column or the total is each count?',
  useWhen: 'Comparing proportions between groups of different sizes, or graphing them stacked.',
  reading: 'The result is a table of the same kind holding percentages.',
  r: 'prop.table(m, margin = 1) * 100',
})

export const survivalTime = tool({
  id: 'survivalTime',
  name: 'Convert time units',
  question: 'What are the survival times in other units?',
  useWhen: 'Reporting in weeks, months or years times recorded in days.',
  reading: 'The result is a survival table with converted times (7 days a week, 365.25 a year).',
  r: 'time / 30.4375',
})

export const simulateXY = tool({
  id: 'simulateXY',
  name: 'Simulate XY data',
  question: 'What would data from this model, with this much scatter, look like?',
  useWhen: 'Teaching, checking an analysis on data with known parameters, or planning a design.',
  instead: [
    { card: 'monteCarlo', when: 'you want to repeat a simulation and an analysis many times' },
  ],
  reading: 'The result is an XY table of simulated values, the same each time for one random seed.',
  r: 'y <- f(x, params) + rnorm(length(x), sd = s)',
})

export const simulateColumn = tool({
  id: 'simulateColumn',
  name: 'Simulate column data',
  question: 'What would groups with these means and this scatter look like?',
  useWhen: 'Teaching, checking an analysis, or planning a design.',
  instead: [{ card: 'monteCarlo', when: 'you want many simulations analyzed' }],
  reading: 'The result is a column table of random values, the same each time for one random seed.',
  r: 'rnorm(n, mean = m, sd = s)',
})

export const simulateContingency = tool({
  id: 'simulateContingency',
  name: 'Simulate a contingency table',
  question: 'What would a 2 × 2 table look like for these probabilities and this design?',
  useWhen: 'Teaching, or planning a study with yes/no outcomes.',
  reading: 'The result is a 2 × 2 table of random counts, the same each time for one random seed.',
  r: 'rbinom(1, n, p)',
})

export const monteCarlo = tool({
  id: 'monteCarlo',
  name: 'Monte Carlo analysis',
  question: 'Across many simulated experiments, how often does an analysis give a given result?',
  useWhen:
    'Estimating power for an unusual design, or how an analysis behaves (its error rate, the spread of a fitted value).',
  instead: [{ card: 'power', when: 'a standard design with a formula' }],
  reading:
    'Read the distribution of each tabulated result and the fraction of hits (e.g. P < 0.05: the power) with its CI.',
  formula: 'Repeat: simulate, analyze, tabulate.',
  r: 'replicate(1000, t.test(rnorm(10, 10), rnorm(10, 12))$p.value < 0.05) |> mean()',
})

export const TOOL_CARDS: readonly MethodCard[] = [
  rowStats,
  fractionOfTotal,
  transform,
  normalize,
  removeBaseline,
  transpose,
  prune,
  filterRows,
  aggregate,
  percentages,
  survivalTime,
  simulateXY,
  simulateColumn,
  simulateContingency,
  monteCarlo,
]
