import type { MethodCard } from '@ps/model'

// Roadmap 51a: cards of the analyses with several factors, several measurements per subject, or
// one test per row.

export const twoWayAnova: MethodCard = {
  id: 'twoWayAnova',
  name: 'Two-way ANOVA',
  shortName: 'Two-way ANOVA',
  question:
    'How do two factors (rows and columns) affect the mean, and does one change the effect of the other?',
  nullHypothesis:
    'Three nulls: no row effect, no column effect, no interaction. Each P is the chance of an effect at least this large if its null were true.',
  useWhen:
    'Two factors crossed in one experiment (genotype × treatment), a different subject in every cell, replicates in subcolumns.',
  instead: [
    { card: 'twoWayRm', when: 'the same subjects are measured across one or both factors' },
    { card: 'multipleT', when: 'the rows are many genes, each a question of its own' },
    { card: 'multifactorAnova', when: 'there are more than two factors' },
  ],
  assumptions: [
    'Each value comes from a different subject.',
    'Each cell is roughly symmetric, with similar scatter in every cell.',
  ],
  reading:
    'Read the interaction first: a small P says the effect of one factor depends on the other, and the comparisons within each row (or column) describe it. Main effects average over the other factor, which misleads when the interaction is large.',
  more: {
    formula: 'F tests of each factor and the interaction on the residual mean square (type III).',
    r: 'car::Anova(lm(y ~ row * column, contrasts = list(row = contr.sum, column = contr.sum)), type = 3)',
  },
  references: [{ text: 'Maxwell SE, Delaney HD (2004) Designing Experiments and Analyzing Data' }],
}

export const twoWayRm: MethodCard = {
  id: 'twoWayRm',
  name: 'Two-way repeated-measures ANOVA',
  shortName: 'Two-way RM ANOVA',
  question:
    'How do two factors affect the mean when the same subjects are measured across one or both?',
  nullHypothesis:
    'No row effect, no column effect, no interaction. Each P is the chance of an effect at least this large if its null were true.',
  useWhen:
    'A time course in the same animals for two or more treatment groups, or each subject measured under every condition of a factor.',
  instead: [
    { card: 'twoWayAnova', when: 'every value is from a different subject' },
    { card: 'rmOneWay', when: 'there is only one factor' },
  ],
  assumptions: [
    'Subjects are independent of each other.',
    'The values are roughly symmetric.',
    'Sphericity for the repeated factor; the Geisser-Greenhouse correction allows for its lack.',
  ],
  reading:
    'Read the interaction first (does the time course differ between groups?), then the comparisons you chose. With missing values a mixed-effects model is fit instead and the result says so.',
  more: {
    formula:
      'Each effect tested on its own error term (subject × factor), df corrected by the Geisser-Greenhouse epsilon.',
    r: 'afex::aov_ez("subject", "y", d, between = "group", within = "time")',
  },
  references: [{ text: 'Geisser S, Greenhouse SW (1958) Ann Math Stat 29:885–891' }],
}

export const threeWayAnova: MethodCard = {
  id: 'threeWayAnova',
  name: 'Three-way ANOVA',
  shortName: 'Three-way ANOVA',
  question: 'How do three factors affect the mean, and do they interact?',
  nullHypothesis:
    'No main effect, two-way or three-way interaction, each in turn. Each P is the chance of an effect at least this large if its null were true.',
  useWhen:
    'A 2 × 2 × k design: the rows are one factor, data sets A–D the four combinations of two more.',
  instead: [
    { card: 'multifactorAnova', when: 'the factors have more levels (a multiple-variables table)' },
    { card: 'twoWayAnova', when: 'there are only two factors' },
  ],
  assumptions: [
    'Each value comes from a different subject, unless a factor is marked repeated.',
    'Similar scatter in every cell.',
  ],
  reading:
    'Read the highest interaction first: if the three-way interaction is large, the two-way effects differ between levels of the third factor. Main effects are averages and mislead when interactions are large.',
  more: {
    formula: 'Type III sums of squares of each term on the residual mean square.',
    r: 'car::Anova(lm(y ~ a * b * c), type = 3)',
  },
  references: [{ text: 'Maxwell SE, Delaney HD (2004) Designing Experiments and Analyzing Data' }],
}

export const multifactorAnova: MethodCard = {
  id: 'multifactorAnova',
  name: 'Multifactor ANOVA',
  shortName: 'Multifactor ANOVA',
  question: 'Which factors, and which of their interactions, affect the response?',
  nullHypothesis:
    'For each term, no effect. Each P is the chance of an effect at least this large if there were none.',
  useWhen:
    'One measurement per row of a multiple-variables table, with any number of categorical factors (genotype, sex, treatment), balanced or not.',
  instead: [
    { card: 'twoWayAnova', when: 'two factors laid out as a grouped table' },
    { card: 'multipleRegression', when: 'some predictors are continuous' },
  ],
  assumptions: [
    'Each row is a different subject.',
    'The residuals are roughly symmetric with similar scatter in every cell.',
  ],
  reading:
    'Read the ANOVA table (type III, so unbalanced designs are handled), interactions first, then the comparisons of marginal means you chose and the effect sizes.',
  more: {
    formula: 'Type III sums of squares with sum-to-zero contrasts.',
    r: 'car::Anova(lm(y ~ a * b + c, contrasts = list(...)), type = 3)',
  },
  references: [{ text: 'Maxwell SE, Delaney HD (2004) Designing Experiments and Analyzing Data' }],
}

export const nestedT: MethodCard = {
  id: 'nestedT',
  name: 'Nested t test',
  shortName: 'Nested t',
  question:
    'Do two groups differ when each subject gives several measurements (wells, cells, fields)?',
  nullHypothesis:
    'The two groups have the same mean. P is the chance of a difference at least this large if they did.',
  useWhen:
    'Two groups of subjects (animals, donors) with several technical measurements each, one subcolumn per subject.',
  instead: [
    { card: 'nestedOneWay', when: 'there are three or more groups' },
    { card: 'welchT', when: 'you average each subject’s replicates first' },
  ],
  assumptions: [
    'Subjects are independent; measurements within a subject are not.',
    'Roughly symmetric values with similar scatter between subjects in both groups.',
  ],
  reading:
    'Read the difference between the group means and its CI. Your independent units are the subjects, not the wells: the test counts them correctly, so its df follow the number of subjects.',
  more: {
    formula:
      'A mixed-effects model with subjects random; the group effect on containment df (the number of subjects − 2).',
    r: 'anova(nlme::lme(y ~ group, random = ~ 1 | subject))  # containment df',
    notes: 'Balanced designs give the t test of the subject means.',
  },
  references: [{ text: 'Lazic SE (2010) BMC Neuroscience 11:5', doi: '10.1186/1471-2202-11-5' }],
}

export const nestedOneWay: MethodCard = {
  id: 'nestedOneWay',
  name: 'Nested one-way ANOVA',
  shortName: 'Nested one-way',
  question:
    'Do three or more groups differ when each subject gives several measurements (wells, cells)?',
  nullHypothesis:
    'Every group has the same mean. P is the chance of means at least this spread out if they did.',
  useWhen:
    'Three or more groups of subjects, several technical measurements per subject, one subcolumn per subject.',
  instead: [
    { card: 'nestedT', when: 'there are two groups' },
    { card: 'oneWayAnova', when: 'one value per subject' },
  ],
  assumptions: [
    'Subjects are independent; measurements within a subject are not.',
    'Roughly symmetric values with similar scatter.',
  ],
  reading:
    'Read the overall P and then the comparisons you chose. The df follow the number of subjects, not the number of measurements.',
  more: {
    formula: 'A mixed-effects model with subjects random; F on containment df.',
    r: 'anova(nlme::lme(y ~ group, random = ~ 1 | subject))  # containment df',
  },
  references: [{ text: 'Lazic SE (2010) BMC Neuroscience 11:5', doi: '10.1186/1471-2202-11-5' }],
}

export const multipleT: MethodCard = {
  id: 'multipleT',
  name: 'Multiple t tests (one per row)',
  shortName: 'Multiple t tests',
  question: 'At which rows (genes, proteins, time points) do the two groups differ?',
  nullHypothesis:
    'At each row, the two groups have the same mean (or, with the rank test, the same distribution).',
  useWhen:
    'Two data sets measured at many rows, each row a question of its own (a gene, a protein), with a correction for testing so many rows.',
  instead: [
    { card: 'twoWayAnova', when: 'the rows are levels of a factor you care about (doses, times)' },
    { card: 'multipleOneWay', when: 'three or more groups at each row' },
  ],
  assumptions: [
    'At each row, each value comes from a different subject (unless paired).',
    'Roughly symmetric values in each row (or their logarithms, with the lognormal choice).',
  ],
  reading:
    'Read which rows are discoveries (false discovery rate) or significant (family-wise), with each row’s difference and q or adjusted P. The volcano plot shows the size of each difference against its −log10 P.',
  more: {
    formula:
      'A t test (or Mann-Whitney, Wilcoxon) per row, then the chosen correction across rows.',
    r: 'apply(m, 1, function(r) t.test(r[A], r[B])$p.value) |> p.adjust("BH")',
  },
  references: [{ text: 'Benjamini Y, Krieger AM, Yekutieli D (2006) Biometrika 93:491–507' }],
}

export const multipleOneWay: MethodCard = {
  id: 'multipleOneWay',
  name: 'Multiple one-way ANOVAs (one per row)',
  shortName: 'Multiple one-way ANOVAs',
  question: 'At which rows do three or more groups differ?',
  nullHypothesis: 'At each row, every group has the same mean (or distribution, by ranks).',
  useWhen: 'Three or more data sets measured at many rows, each row a question of its own.',
  instead: [
    { card: 'twoWayAnova', when: 'the rows are levels of a factor you care about' },
    { card: 'multipleT', when: 'two groups at each row' },
  ],
  assumptions: [
    'At each row, each value comes from a different subject.',
    'Roughly symmetric values in each row.',
  ],
  reading:
    'Read each row’s q value (false discovery rate across the rows, Benjamini-Hochberg by default) and its comparisons, each row its own family. Without the correction, with many rows some small P values come by chance.',
  more: {
    formula: 'A one-way ANOVA (or Kruskal-Wallis) per row.',
    r: 'apply(m, 1, function(r) oneway.test(r ~ g, var.equal = TRUE)$p.value)',
  },
  references: [{ text: 'Fisher RA (1925) Statistical Methods for Research Workers' }],
}

export const pStack: MethodCard = {
  id: 'pStack',
  name: 'Analyze a stack of P values',
  shortName: 'P value stack',
  question: 'Which of many P values are discoveries, allowing for how many there are?',
  nullHypothesis:
    'Each P value comes from a test whose null is true; the correction decides which are discoveries.',
  useWhen:
    'P values computed elsewhere (one per row), corrected together by a false discovery rate or a family-wise method.',
  instead: [{ card: 'multipleT', when: 'the raw values are in a grouped table' }],
  assumptions: ['The P values are valid on their own, and from one family of questions.'],
  reading:
    'Read the q (or adjusted P) of each row and which rows are discoveries. The graph of P against rank shows how the threshold cuts the list.',
  more: { formula: 'As the chosen correction.', r: 'p.adjust(p, "BH")' },
  references: [{ text: 'Benjamini Y, Hochberg Y (1995) J R Stat Soc B 57:289–300' }],
}

export const FACTORIAL_CARDS: readonly MethodCard[] = [
  twoWayAnova,
  twoWayRm,
  threeWayAnova,
  multifactorAnova,
  nestedT,
  nestedOneWay,
  multipleT,
  multipleOneWay,
  pStack,
]
