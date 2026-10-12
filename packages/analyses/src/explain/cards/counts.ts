import type { MethodCard } from '@ps/model'

// Roadmap 51a: cards of counts, proportions and survival.

export const fisherExact: MethodCard = {
  id: 'fisherExact',
  name: 'Fisher’s exact test',
  shortName: 'Fisher’s exact',
  question: 'Is the outcome related to the group, counting subjects?',
  nullHypothesis:
    'The proportion with the outcome is the same in every group. P is the chance of a table at least this unbalanced if it were.',
  useWhen:
    'Counts of subjects by group (rows) and outcome (columns), each subject counted once. Exact for any sample size.',
  instead: [
    { card: 'chiSquare', when: 'large tables where every expected count is at least 5' },
    { card: 'logisticRegression', when: 'you need to adjust for other factors' },
  ],
  assumptions: [
    'Each subject is counted once, in one cell.',
    'The subjects are independent (not the same subjects counted twice, before and after).',
  ],
  reading:
    'Read P, then the size of the effect on a 2 × 2 table: the relative risk (or odds ratio, for a case-control study) with its CI. A table too large for the exact test gets the chi-square test instead; the result says so.',
  more: {
    formula: 'The hypergeometric probability of every table with the same margins.',
    r: 'fisher.test(table)',
  },
  references: [{ text: 'Fisher RA (1922) J R Stat Soc 85:87–94' }],
}

export const chiSquare: MethodCard = {
  id: 'chiSquare',
  name: 'Chi-square test',
  shortName: 'Chi-square',
  question: 'Is the outcome related to the group, counting subjects?',
  nullHypothesis:
    'The proportions are the same in every group. P is the chance of counts at least this far from the expected ones if they were.',
  useWhen:
    'Counts of subjects by group and outcome when every expected count is at least about 5 (larger samples).',
  instead: [
    { card: 'fisherExact', when: 'small counts, or any 2 × 2 table' },
    { card: 'chiSquareTrend', when: 'the groups are in a meaningful order (doses)' },
  ],
  assumptions: [
    'Each subject is counted once; subjects are independent.',
    'Expected counts of at least about 5.',
  ],
  reading:
    'Read P and the effect size (phi for 2 × 2, Cramér’s V for larger tables). On 2 × 2 tables read the relative risk or odds ratio with its CI.',
  more: {
    formula: 'Sum over cells of (observed − expected)² / expected, on (r − 1)(c − 1) df.',
    r: 'chisq.test(table, correct = FALSE)',
  },
  references: [{ text: 'Pearson K (1900) Phil Mag 50:157–175' }],
}

export const chiSquareTrend: MethodCard = {
  id: 'chiSquareTrend',
  name: 'Chi-square test for trend',
  shortName: 'Chi-square for trend',
  question: 'Does the proportion with the outcome rise or fall steadily across ordered groups?',
  nullHypothesis:
    'No linear trend in the proportion across the rows. P is the chance of a trend at least this steep if there were none.',
  useWhen:
    'Rows in a meaningful order (doses, age bands) and two outcome columns. Only when the order is part of the question.',
  instead: [{ card: 'chiSquare', when: 'the rows have no order' }],
  assumptions: ['Rows equally spaced in their order.', 'Each subject counted once.'],
  reading:
    'Read P for the trend. In this version it is reported whenever the table has three or more rows and two columns, ticked by default; read it only if you planned it.',
  more: {
    formula: 'Cochran-Armitage: the linear component of chi-square with scores 1…r.',
    r: 'prop.trend.test(events, totals)',
  },
  references: [{ text: 'Armitage P (1955) Biometrics 11:375–386' }],
}

export const goodnessOfFit: MethodCard = {
  id: 'goodnessOfFit',
  name: 'Chi-square goodness of fit',
  shortName: 'Goodness of fit',
  question: 'Do the counts in each category match the proportions you expect?',
  nullHypothesis:
    'The categories occur in the expected proportions. P is the chance of counts at least this far from them if they did.',
  useWhen:
    'Counts of objects or events in three or more categories, compared with expected proportions (e.g. 9 : 3 : 3 : 1 in a cross).',
  instead: [{ card: 'binomialTest', when: 'two categories' }],
  assumptions: ['Each object counted once, independently.', 'Expected counts of at least about 5.'],
  reading: 'Read P and each category’s observed and expected count.',
  more: {
    formula: 'Sum over categories of (observed − expected)² / expected, on k − 1 df.',
    r: 'chisq.test(observed, p = expected / sum(expected))',
  },
  references: [{ text: 'Pearson K (1900) Phil Mag 50:157–175' }],
}

export const binomialTest: MethodCard = {
  id: 'binomialTest',
  name: 'Binomial test',
  shortName: 'Binomial',
  question: 'Does the split between two categories match the proportion you expect?',
  nullHypothesis:
    'The first category occurs with the expected proportion. P is the exact chance of a split at least this far from it if it did.',
  useWhen: 'Two categories (3 : 1, 50 : 50), any sample size.',
  instead: [{ card: 'goodnessOfFit', when: 'three or more categories' }],
  assumptions: ['Each object counted once, independently.'],
  reading: 'Read the exact P and the observed proportion.',
  more: { formula: 'Exact binomial probabilities.', r: 'binom.test(x, n, p = expected)' },
  references: [{ text: 'Clopper CJ, Pearson ES (1934) Biometrika 26:404–413' }],
}

export const kaplanMeier: MethodCard = {
  id: 'kaplanMeier',
  name: 'Kaplan-Meier survival curves',
  shortName: 'Kaplan-Meier',
  question: 'What fraction of subjects is still free of the event at each time?',
  nullHypothesis: null,
  useWhen:
    'Time until an event (death, relapse) with some subjects censored: still event-free when last seen, or lost to follow-up.',
  instead: [{ card: 'coxRegression', when: 'you need to adjust for covariates' }],
  assumptions: [
    'Censoring is unrelated to the chance of the event.',
    'Subjects entering at different times have the same outlook.',
  ],
  reading:
    'Read each curve with its CI and the median survival: the time at which half the subjects have had the event (“undefined” when the curve stays above 50%).',
  more: {
    formula: 'Product over event times of (1 − events / number at risk).',
    r: 'survival::survfit(Surv(time, event) ~ group)',
  },
  references: [{ text: 'Kaplan EL, Meier P (1958) J Am Stat Assoc 53:457–481' }],
}

export const logRank: MethodCard = {
  id: 'logRank',
  name: 'Log-rank (Mantel-Cox) test',
  shortName: 'Log-rank',
  question: 'Do the survival curves differ over the whole follow-up?',
  nullHypothesis:
    'All groups have the same survival. P is the chance of curves at least this far apart if they did.',
  useWhen:
    'Comparing survival curves, giving every event the same weight (recommended as the main test because it uses the whole follow-up).',
  instead: [
    { card: 'gehanBreslowWilcoxon', when: 'early differences matter most (decided in advance)' },
    { card: 'coxRegression', when: 'you need to adjust for covariates' },
  ],
  assumptions: [
    'Censoring is unrelated to the chance of the event.',
    'Most powerful when the hazards are proportional (curves that don’t cross).',
  ],
  reading:
    'Read P and the hazard ratio with its CI. The survival results in this version list the log-rank, trend and Gehan-Breslow-Wilcoxon tests together: decide which one answers your question before you look.',
  more: {
    formula: 'Observed against expected events in each group at every event time.',
    r: 'survival::survdiff(Surv(time, event) ~ group)',
  },
  references: [{ text: 'Mantel N (1966) Cancer Chemother Rep 50:163–170' }],
}

export const gehanBreslowWilcoxon: MethodCard = {
  id: 'gehanBreslowWilcoxon',
  name: 'Gehan-Breslow-Wilcoxon test',
  shortName: 'Gehan-Breslow-Wilcoxon',
  question: 'Do the survival curves differ, weighting early events more?',
  nullHypothesis:
    'All groups have the same survival. P is the chance of curves at least this far apart if they did.',
  useWhen: 'Comparing survival when early differences matter most, decided before the experiment.',
  instead: [{ card: 'logRank', when: 'the whole follow-up matters (the usual choice)' }],
  assumptions: [
    'Censoring is unrelated to the chance of the event; similar censoring in each group.',
  ],
  reading: 'Read P. It weights each event by the number still at risk, so early events count more.',
  more: {
    formula: 'The log-rank statistic weighted by the number at risk.',
    r: 'survival::survdiff(Surv(time, event) ~ group, rho = 1)  # the Peto-Peto relative',
  },
  references: [{ text: 'Gehan EA (1965) Biometrika 52:203–223' }],
}

export const SURVIVAL_AND_COUNT_CARDS: readonly MethodCard[] = [
  fisherExact,
  chiSquare,
  chiSquareTrend,
  goodnessOfFit,
  binomialTest,
  kaplanMeier,
  logRank,
  gehanBreslowWilcoxon,
]
