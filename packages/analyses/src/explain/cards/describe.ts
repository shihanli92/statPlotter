import type { MethodCard } from '@ps/model'

// Roadmap 51a: cards of describing, checking and planning.

export const descriptive: MethodCard = {
  id: 'descriptive',
  name: 'Descriptive statistics',
  shortName: 'Descriptive',
  question: 'What do the values of each group look like: centre, spread, range?',
  nullHypothesis: null,
  useWhen: 'Summarizing each group before (or instead of) a test, and for reporting n, mean, SD.',
  instead: [{ card: 'normality', when: 'you want to look at the shape of the distribution' }],
  assumptions: ['None for the numbers; the CI of the mean assumes roughly symmetric values.'],
  reading:
    'SD describes the scatter of the values; SEM how precisely the mean is known (it shrinks with n). Report SD to describe data, the CI to show precision. The geometric mean suits values that change by a factor.',
  more: {
    formula: 'Mean, SD (n − 1), SEM = SD/√n, quartiles by R’s type 6.',
    r: 'summary(x); sd(x); quantile(x, type = 6)',
  },
  references: [{ text: 'Altman DG, Bland JM (2005) BMJ 331:903', doi: '10.1136/bmj.331.7521.903' }],
}

export const normality: MethodCard = {
  id: 'normality',
  name: 'Normality and lognormality tests',
  shortName: 'Normality tests',
  question:
    'Is there evidence that the values don’t come from a normal (or lognormal) distribution?',
  nullHypothesis:
    'The values come from a normal (or lognormal) distribution. P is the chance of a departure at least this large if they did.',
  useWhen:
    'Looking at the shape of each group, with a QQ plot. Not to choose a test: the design of the experiment decides that.',
  instead: [{ card: 'descriptive', when: 'you only need a summary' }],
  assumptions: ['The values are independent.'],
  reading:
    'A small P is evidence against a normal distribution; a large P is no evidence against it, which doesn’t show the data are normal (with few values the tests have little power). The QQ plot shows how the values depart.',
  more: {
    formula:
      'Shapiro-Wilk W; D’Agostino-Pearson K² from skewness and kurtosis; Anderson-Darling A²; Kolmogorov-Smirnov D with Lilliefors’ P.',
    r: 'shapiro.test(x); nortest::ad.test(x)',
  },
  references: [{ text: 'Shapiro SS, Wilk MB (1965) Biometrika 52:591–611' }],
}

export const grubbs: MethodCard = {
  id: 'grubbs',
  name: 'Grubbs’ test (outliers)',
  shortName: 'Grubbs',
  question: 'Is the most extreme value an outlier?',
  nullHypothesis:
    'No value is an outlier. P is the chance of a value at least this far from the mean if there were none.',
  useWhen:
    'Roughly normal values with at most one suspected outlier (iterative: repeated after removal).',
  instead: [{ card: 'rout', when: 'there may be several outliers' }],
  assumptions: ['Apart from outliers, the values are roughly normal.'],
  reading:
    'Read which value is flagged. Remove a value only with a known cause (a pipetting error, a failed well), and report the analysis with and without it.',
  more: {
    formula: 'G = max |x − mean| / SD, against its critical value.',
    r: 'outliers::grubbs.test(x)',
  },
  references: [{ text: 'Grubbs FE (1969) Technometrics 11:1–21' }],
}

export const frequencyDistribution: MethodCard = {
  id: 'frequencyDistribution',
  name: 'Frequency distribution',
  shortName: 'Histogram',
  question: 'How many values fall in each range (bin)?',
  nullHypothesis: null,
  useWhen: 'Making a histogram or a cumulative distribution of many values.',
  instead: [{ card: 'descriptive', when: 'you want summary numbers' }],
  assumptions: ['None; the bin width changes the picture, not the data.'],
  reading:
    'Read the count (or percentage) in each bin; the result is an XY table of bin centres ready to graph.',
  more: { formula: 'Counts in equal-width bins.', r: 'hist(x, plot = FALSE)' },
  references: [],
}

export const roc: MethodCard = {
  id: 'roc',
  name: 'ROC curve',
  shortName: 'ROC',
  question: 'How well does a measurement separate patients from controls?',
  nullHypothesis:
    'The measurement doesn’t separate the groups (area 0.5). P is the chance of an area at least this far from 0.5 if it didn’t.',
  useWhen:
    'A measurement in two groups (patients and controls, one column each), to choose a cutoff or judge a marker.',
  instead: [{ card: 'mannWhitney', when: 'you only ask whether the groups differ' }],
  assumptions: [
    'Each value from a different subject.',
    'Say whether patients have higher or lower values; deciding it from the data makes the area at least 0.5 by construction.',
  ],
  reading:
    'Read the area under the curve (0.5 no better than chance, 1 perfect) with its CI, and the sensitivity and specificity at each cutoff.',
  more: {
    formula: 'Sensitivity against 1 − specificity at every cutoff; area by the trapezoid rule.',
    r: 'pROC::roc(controls = A, cases = B, direction = "<")',
  },
  references: [{ text: 'Hanley JA, McNeil BJ (1982) Radiology 143:29–36' }],
}

export const blandAltman: MethodCard = {
  id: 'blandAltman',
  name: 'Bland-Altman method comparison',
  shortName: 'Bland-Altman',
  question: 'Do two methods measuring the same subjects agree, and by how much do they differ?',
  nullHypothesis: null,
  useWhen:
    'The same samples measured by two methods (each row one sample), to judge whether one can replace the other.',
  instead: [
    { card: 'deming', when: 'you want the line relating the two methods' },
    { card: 'pearson', when: 'never for agreement: correlation measures association' },
  ],
  assumptions: ['The differences are roughly symmetric, by the same amount across the range.'],
  reading:
    'Read the bias (the average difference) and the 95% limits of agreement: most differences between the methods lie between them. Whether that is close enough is a judgement about your measurement, not a P value.',
  more: {
    formula: 'Bias = mean(A − B); limits = bias ± 1.96 SD of the differences.',
    r: 'BlandAltmanLeh::bland.altman.stats(A, B)',
  },
  references: [
    { text: 'Bland JM, Altman DG (1986) Lancet 327:307–310', doi: '10.1016/S0140-6736(86)90837-8' },
  ],
}

export const power: MethodCard = {
  id: 'power',
  name: 'Sample size and power',
  shortName: 'Power',
  question:
    'How many subjects do you need to detect an effect, or how likely is a given n to detect it?',
  nullHypothesis: null,
  useWhen:
    'Planning an experiment for a t test, one-way ANOVA, two proportions, a correlation or a log-rank test.',
  instead: [{ card: 'monteCarlo', when: 'the design is unusual (simulate it)' }],
  assumptions: [
    'The effect is the smallest difference that matters biologically, not a pilot’s estimate (pilot effects are usually overestimates).',
  ],
  reading:
    'Read the n per group for the power you want (or the power of your n), and the power curve over a range of effects. Power computed from a finished experiment’s own effect adds nothing to its P value.',
  more: {
    formula: 'Noncentral t, F and chi-square distributions.',
    r: 'power.t.test(delta = d, sd = s, power = 0.8)',
  },
  references: [{ text: 'Cohen J (1988) Statistical Power Analysis for the Behavioral Sciences' }],
}

export const DESCRIBE_CARDS: readonly MethodCard[] = [
  descriptive,
  normality,
  grubbs,
  frequencyDistribution,
  roc,
  blandAltman,
  power,
]
