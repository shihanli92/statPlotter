import type { MethodCard } from '@ps/model'

// Roadmap 51a: cards of the analyses of several variables per subject (a multiple-variables
// table: one row per subject).

export const multipleRegression: MethodCard = {
  id: 'multipleRegression',
  name: 'Multiple linear regression',
  shortName: 'Multiple regression',
  question: 'How does a measurement depend on several predictors at once?',
  nullHypothesis:
    'For each predictor, its coefficient is 0 (no effect with the others held fixed). P is the chance of a coefficient at least this large if it were.',
  useWhen:
    'One measured outcome per subject and several predictors (age, dose, sex), continuous or categorical.',
  instead: [
    { card: 'logisticRegression', when: 'the outcome is yes/no' },
    { card: 'poissonRegression', when: 'the outcome is a count' },
    { card: 'multifactorAnova', when: 'every predictor is a category' },
  ],
  assumptions: [
    'Subjects are independent.',
    'The outcome changes linearly with each continuous predictor.',
    'Residuals roughly symmetric with similar scatter throughout.',
  ],
  reading:
    'Read each coefficient (the change in the outcome per unit of the predictor, others fixed) with its CI, and R². A large VIF means predictors carry the same information and their coefficients are unstable.',
  more: {
    formula: 'Least squares: y = b0 + b1·x1 + … + bk·xk.',
    r: 'summary(lm(y ~ x1 + x2 + …))',
  },
  references: [{ text: 'Harrell FE (2015) Regression Modeling Strategies, 2nd ed.' }],
}

export const logisticRegression: MethodCard = {
  id: 'logisticRegression',
  name: 'Multiple logistic regression',
  shortName: 'Logistic regression',
  question: 'How do several predictors change the odds of a yes/no outcome?',
  nullHypothesis:
    'For each predictor, its odds ratio is 1 (no effect with the others fixed). P is the chance of an odds ratio at least this far from 1 if it were.',
  useWhen:
    'One yes/no outcome per subject (coded 0 and 1) and one or more predictors, continuous or categorical.',
  instead: [
    { card: 'simpleLogistic', when: 'one predictor on an XY table' },
    { card: 'multipleRegression', when: 'the outcome is a measurement' },
  ],
  assumptions: [
    'Subjects are independent.',
    'The log odds change linearly with each continuous predictor.',
    'Enough subjects with each outcome (about ten per predictor).',
  ],
  reading:
    'Read each odds ratio with its CI and likelihood-ratio P. The ROC area and Hosmer-Lemeshow test say how well the model separates and fits the outcomes.',
  more: {
    formula: 'log odds = b0 + b1·x1 + …, by maximum likelihood.',
    r: 'glm(y ~ x1 + x2, family = binomial)',
  },
  references: [{ text: 'Hosmer DW, Lemeshow S (2000) Applied Logistic Regression' }],
}

export const poissonRegression: MethodCard = {
  id: 'poissonRegression',
  name: 'Poisson regression',
  shortName: 'Poisson regression',
  question: 'How do predictors change the rate of a counted event?',
  nullHypothesis:
    'For each predictor, its rate ratio is 1. P is the chance of a rate ratio at least this far from 1 if it were.',
  useWhen:
    'The outcome is a count actually counted (colonies, events, cells), one per subject or sample.',
  instead: [
    { card: 'multipleRegression', when: 'the outcome is a measurement' },
    { card: 'logisticRegression', when: 'the outcome is yes/no' },
  ],
  assumptions: [
    'Counts are independent.',
    'The variance equals the mean; a dispersion well above 1 means the P values are too small.',
  ],
  reading:
    'Read each rate ratio with its CI and P, and the dispersion: if it is well above 1, the counts vary more than Poisson allows.',
  more: {
    formula: 'log(rate) = b0 + b1·x1 + …, by maximum likelihood.',
    r: 'glm(y ~ x1 + x2, family = poisson)',
  },
  references: [{ text: 'Agresti A (2013) Categorical Data Analysis, 3rd ed.' }],
}

export const coxRegression: MethodCard = {
  id: 'coxRegression',
  name: 'Cox proportional hazards regression',
  shortName: 'Cox regression',
  question: 'How do predictors change the hazard of an event over time?',
  nullHypothesis:
    'For each predictor, its hazard ratio is 1. P is the chance of a hazard ratio at least this far from 1 if it were.',
  useWhen:
    'Time to an event with censoring, one row per subject, and predictors (treatment, age, a marker) to adjust for.',
  instead: [{ card: 'kaplanMeier', when: 'you only compare groups, without covariates' }],
  assumptions: [
    'Censoring is unrelated to the chance of the event.',
    'Proportional hazards: each predictor multiplies the hazard by the same amount at every time.',
  ],
  reading:
    'Read each hazard ratio with its CI: 2 means the event happens at twice the rate, others held fixed. Check that curves for the groups don’t cross (proportional hazards).',
  more: {
    formula: 'h(t) = h0(t)·exp(b1·x1 + …), by partial likelihood.',
    r: 'survival::coxph(Surv(time, event) ~ x1 + x2)',
  },
  references: [{ text: 'Cox DR (1972) J R Stat Soc B 34:187–220' }],
}

export const pca: MethodCard = {
  id: 'pca',
  name: 'Principal component analysis',
  shortName: 'PCA',
  question: 'Which few combinations of the variables explain most of their variation?',
  nullHypothesis: null,
  useWhen:
    'Many correlated measurements per subject (genes, markers, a panel of tests), to summarize them in a few components or to look for groups.',
  instead: [{ card: 'multipleRegression', when: 'you want to predict one outcome' }],
  assumptions: [
    'Continuous variables; text variables and 0/1 codes are better left out.',
    'Standardize the variables when they are in different units.',
  ],
  reading:
    'Read the variance explained by each component, the loadings (how much each variable contributes) and the scores (where each subject lies). Parallel analysis keeps the components that explain more than random data would.',
  more: {
    formula: 'Eigenvectors of the correlation (or covariance) matrix.',
    r: 'prcomp(d, scale. = TRUE)',
  },
  references: [
    {
      text: 'Jolliffe IT, Cadima J (2016) Phil Trans R Soc A 374:20150202',
      doi: '10.1098/rsta.2015.0202',
    },
  ],
}

export const MODEL_CARDS: readonly MethodCard[] = [
  multipleRegression,
  logisticRegression,
  poissonRegression,
  coxRegression,
  pca,
]
