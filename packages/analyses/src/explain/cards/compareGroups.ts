import type { MethodCard } from '@ps/model'

// Roadmap 51a: the compare-groups cards as the design gives them (docs/design/ANALYSIS_GUIDE.md
// §2.5); roadmap 51c: true of its defaults (Welch's t test, exact Kruskal-Wallis P, Dunn's
// comparisons by Holm, the RM method and Satterthwaite's df).

export const welchT: MethodCard = {
  id: 'welchT',
  name: 'Welch’s t test',
  shortName: 'Welch’s t',
  question: 'Do the two groups have the same mean?',
  nullHypothesis:
    'The two groups have the same mean. P is the chance of a difference at least this large if they did.',
  useWhen:
    'Two independent groups of measurements (different animals, wells or patients). Recommended for them because it doesn’t assume both groups vary by the same amount, and loses almost nothing when they do.',
  instead: [
    {
      card: 'pairedT',
      when: 'each value in one group has a partner in the other (same animal, same plate)',
    },
    { card: 'studentT', when: 'equal scatter is known from the method, e.g. a validated assay' },
    { card: 'mannWhitney', when: 'the values are scores or ranks' },
  ],
  assumptions: [
    'Each value comes from a different subject.',
    'Each group is roughly symmetric around its mean; this matters less as groups grow.',
  ],
  reading:
    'The result is the difference between the means ({B} − {A}) with its 95% CI: the range of true differences compatible with your data. P < 0.05 and a CI that excludes 0 say the same thing. A large P is no evidence of a difference, not proof the groups are alike: look at the width of the CI. The df is usually not a whole number; that is expected.',
  more: {
    formula:
      't = (mean B − mean A) / √(s_A²/n_A + s_B²/n_B); df by the Welch-Satterthwaite equation.',
    r: 't.test(B, A)   # Welch is R’s default',
  },
  references: [
    { text: 'Welch BL (1947) Biometrika 34:28–35' },
    { text: 'Ruxton GD (2006) Behavioral Ecology 17:688–690', doi: '10.1093/beheco/ark016' },
    {
      text: 'Delacre M, Lakens D, Leys C (2017) Int Rev Soc Psychol 30:92–101',
      doi: '10.5334/irsp.82',
    },
  ],
}

export const studentT: MethodCard = {
  id: 'studentT',
  name: 'Student’s t test',
  shortName: 'Student’s t',
  question: 'Do the two groups have the same mean, assuming they vary by the same amount?',
  nullHypothesis:
    'The two groups have the same mean. P is the chance of a difference at least this large if they did.',
  useWhen:
    'Two independent groups when you have a reason to expect equal scatter, such as a validated assay whose variability doesn’t depend on the treatment. Welch’s t test, the unpaired t test’s default, is the safer one.',
  instead: [
    {
      card: 'welchT',
      when: 'the scatter may differ (the safer choice, especially with unequal group sizes)',
    },
    { card: 'pairedT', when: 'the values are matched (same subject in both groups)' },
    { card: 'mannWhitney', when: 'the values are scores or ranks' },
  ],
  assumptions: [
    'Each value comes from a different subject.',
    'Each group is roughly symmetric around its mean.',
    'Both groups vary by the same amount. With unequal SDs and unequal group sizes its P can be far too small or too large.',
  ],
  reading:
    'As for Welch’s t test: read the difference {B} − {A} and its CI first. P < 0.05 and a CI that excludes 0 say the same thing; a large P is no evidence of a difference, not proof of none. The df is n_A + n_B − 2.',
  more: {
    formula: 't = (mean B − mean A) / (s_pooled · √(1/n_A + 1/n_B)), df = n_A + n_B − 2.',
    r: 't.test(B, A, var.equal = TRUE)',
  },
  references: [{ text: 'Student (1908) Biometrika 6:1–25' }],
}

export const pairedT: MethodCard = {
  id: 'pairedT',
  name: 'Paired t test',
  shortName: 'Paired t',
  question: 'Is the average difference within pairs zero?',
  nullHypothesis:
    'The mean of the differences {B} − {A} is 0. P is the chance of an average difference at least this large if it were.',
  useWhen:
    'Each value in one group has a partner in the same row: the same animal before and after, two treatments on the same culture, littermates, paired wells on one plate.',
  instead: [
    { card: 'welchT', when: 'the rows are not linked (different subjects in each group)' },
    { card: 'ratioPairedT', when: 'the effect is proportional (each value roughly doubles)' },
    { card: 'wilcoxon', when: 'the differences are scores or very skewed' },
  ],
  assumptions: [
    'The pairs are independent of each other.',
    'The differences are roughly symmetric; the two groups themselves need not be.',
  ],
  reading:
    'Read the mean difference with its CI. Pairing removes subject-to-subject variation, so the CI is usually narrower than unpaired. The design, not a test of the data, decides whether to pair. Rows with one value missing are left out.',
  more: {
    formula: 't = mean(d) / (SD(d)/√n), df = n − 1, where d = B − A in each row.',
    r: 't.test(B, A, paired = TRUE)',
  },
  references: [{ text: 'Student (1908) Biometrika 6:1–25' }],
}

export const ratioPairedT: MethodCard = {
  id: 'ratioPairedT',
  name: 'Ratio paired t test',
  shortName: 'Ratio paired t',
  question: 'Is the average ratio within pairs 1?',
  nullHypothesis:
    'The geometric mean of the ratios {B}/{A} is 1. P is the chance of an average ratio at least this far from 1 if it were.',
  useWhen:
    'Paired values where the effect is proportional: each subject’s value is multiplied (doubled, halved), as with concentrations, fold changes and cell counts.',
  instead: [
    { card: 'pairedT', when: 'the change is a difference of about the same size in every pair' },
    { card: 'wilcoxon', when: 'the values are scores' },
  ],
  assumptions: [
    'The pairs are independent of each other.',
    'Every value is above zero.',
    'The logarithms of the ratios are roughly symmetric.',
  ],
  reading:
    'Read the geometric mean ratio {B}/{A} with its CI: 2 means {B} is twice {A} on average. A CI that excludes 1 matches P < 0.05. Rows with one value missing are left out.',
  more: {
    formula: 'A paired t test on log10(B/A); the mean and its CI are transformed back to a ratio.',
    r: 't.test(log10(B), log10(A), paired = TRUE)',
  },
  references: [{ text: 'Student (1908) Biometrika 6:1–25' }],
}

export const mannWhitney: MethodCard = {
  id: 'mannWhitney',
  name: 'Mann-Whitney test',
  shortName: 'Mann-Whitney',
  question: 'Do values in one group tend to be larger than in the other?',
  nullHypothesis:
    'A value from {A} is as likely to be larger as smaller than a value from {B}. P is the chance of a rank difference at least this large if so.',
  useWhen:
    'Two independent groups of scores or ranks (a 0–4 histology score), or values where the order matters more than the size.',
  instead: [
    {
      card: 'welchT',
      when: 'the values are roughly symmetric measurements (more power, a difference in your units)',
    },
    { card: 'wilcoxon', when: 'the values are paired' },
    { card: 'kolmogorovSmirnov', when: 'any difference in shape matters, not only a shift' },
  ],
  assumptions: [
    'Each value comes from a different subject.',
    'It compares medians only when both groups have the same shape.',
  ],
  reading:
    'Read P and the shift between groups (Hodges-Lehmann: the median of all differences {B} − {A}) with its CI. With very small groups the smallest possible P is large: 3 against 3 can’t reach a two-tailed P below 0.10, however different the groups are.',
  more: {
    formula:
      'U from the rank sums; exact P from all rearrangements when the groups are small enough, else the normal approximation with continuity correction.',
    r: 'wilcox.test(B, A, conf.int = TRUE)',
  },
  references: [
    { text: 'Mann HB, Whitney DR (1947) Ann Math Stat 18:50–60' },
    { text: 'Hodges JL, Lehmann EL (1963) Ann Math Stat 34:598–611' },
  ],
}

export const wilcoxon: MethodCard = {
  id: 'wilcoxon',
  name: 'Wilcoxon matched-pairs signed-rank test',
  shortName: 'Wilcoxon',
  question: 'Are the differences within pairs centred on zero?',
  nullHypothesis:
    'The differences {B} − {A} are symmetric around 0. P is the chance of signed ranks at least this unbalanced if they were.',
  useWhen: 'Paired data as for the paired t test, but the differences are scores or very skewed.',
  instead: [
    { card: 'pairedT', when: 'the differences are roughly symmetric measurements' },
    { card: 'ratioPairedT', when: 'the effect is proportional' },
  ],
  assumptions: [
    'The pairs are independent of each other.',
    'The differences are symmetric around their median.',
  ],
  reading:
    'Read P and the median of the differences (Hodges-Lehmann) with its CI. Pairs with a difference of exactly zero are dropped (Wilcoxon) or ranked (Pratt); with many zeros, prefer Pratt. With 5 pairs the smallest two-tailed P is 0.0625.',
  more: {
    formula: 'W = the sum of the signed ranks of the absolute differences.',
    r: 'wilcox.test(B, A, paired = TRUE, conf.int = TRUE)',
    notes: 'Pratt: coin::wilcoxsign_test(B ~ A, zero.method = "Pratt").',
  },
  references: [
    { text: 'Wilcoxon F (1945) Biometrics Bulletin 1:80–83' },
    { text: 'Pratt JW (1959) J Am Stat Assoc 54:655–667' },
  ],
}

export const kolmogorovSmirnov: MethodCard = {
  id: 'kolmogorovSmirnov',
  name: 'Kolmogorov-Smirnov test',
  shortName: 'Kolmogorov-Smirnov',
  question: 'Do the two groups’ values come from the same distribution?',
  nullHypothesis:
    'Both groups come from the same distribution. P is the chance of a gap between their cumulative distributions at least this wide if they did.',
  useWhen:
    'Two independent groups when any difference matters (spread, shape or level), for example two size distributions of cells.',
  instead: [
    {
      card: 'mannWhitney',
      when: 'you expect one group to be shifted (it has more power for that)',
    },
    { card: 'welchT', when: 'the question is about the means of measurements' },
  ],
  assumptions: ['Each value comes from a different subject.'],
  reading:
    'Read P and D, the widest vertical gap between the two cumulative distributions. It has little power for a simple shift between groups. A large P is no evidence of a difference, not proof the distributions match.',
  more: {
    formula: 'D = max |F_A(x) − F_B(x)| over x; P exact for small samples, else asymptotic.',
    r: 'ks.test(A, B)',
  },
  references: [{ text: 'Smirnov N (1948) Ann Math Stat 19:279–281' }],
}

export const oneSampleT: MethodCard = {
  id: 'oneSampleT',
  name: 'One-sample t test',
  shortName: 'One-sample t',
  question: 'Is the mean different from a value you set before the experiment?',
  nullHypothesis:
    'The true mean equals the hypothetical value. P is the chance of a mean at least this far from it if it did.',
  useWhen:
    'One group of measurements compared with a fixed number: 100 for percent of control, 1 for a ratio, a published reference value.',
  instead: [
    { card: 'oneSampleWilcoxon', when: 'the values are scores or very skewed' },
    { card: 'pairedT', when: 'each value has its own partner measured in the experiment' },
  ],
  assumptions: [
    'The values are independent.',
    'They are roughly symmetric around their mean.',
    'The hypothetical value was chosen before seeing the data.',
  ],
  reading:
    'Read the difference between the mean and the hypothetical value, with its CI. A CI that excludes 0 matches P < 0.05. A control normalized to exactly 100 has no variation: compare the other groups with 100 rather than testing the control.',
  more: {
    formula: 't = (mean − value) / (SD/√n), df = n − 1.',
    r: 't.test(A, mu = value)',
  },
  references: [{ text: 'Student (1908) Biometrika 6:1–25' }],
}

export const oneSampleWilcoxon: MethodCard = {
  id: 'oneSampleWilcoxon',
  name: 'Wilcoxon signed-rank test (one sample)',
  shortName: 'Wilcoxon signed-rank',
  question: 'Do the values tend to lie above or below a value you set?',
  nullHypothesis:
    'The values are symmetric around the hypothetical value. P is the chance of signed ranks at least this unbalanced if they were.',
  useWhen: 'One group of scores, or very skewed values, compared with a fixed number.',
  instead: [{ card: 'oneSampleT', when: 'the values are roughly symmetric measurements' }],
  assumptions: ['The values are independent.', 'They are symmetric around their median.'],
  reading:
    'Read P and the median’s distance from the hypothetical value. Values equal to the hypothetical value are left out of the ranks. With few values the smallest possible P is large.',
  more: {
    formula: 'W = the sum of the signed ranks of (value − hypothetical).',
    r: 'wilcox.test(A, mu = value, conf.int = TRUE)',
  },
  references: [{ text: 'Wilcoxon F (1945) Biometrics Bulletin 1:80–83' }],
}

export const oneWayAnova: MethodCard = {
  id: 'oneWayAnova',
  name: 'One-way ANOVA',
  shortName: 'One-way ANOVA',
  question: 'Do all the groups have the same mean? A small P says at least one differs, not which.',
  nullHypothesis:
    'Every group has the same mean. P is the chance of means at least this spread out if they did.',
  useWhen:
    'Three or more independent groups of measurements, one factor (drug A, B, C, vehicle), similar scatter expected in each group.',
  instead: [
    {
      card: 'welchAnova',
      when: 'a treatment can change how much values vary, or group sizes differ a lot',
    },
    { card: 'rmOneWay', when: 'the same subjects appear in every group' },
    { card: 'kruskalWallis', when: 'the values are scores or ranks' },
    { card: 'twoWayAnova', when: 'there are two factors' },
    { card: 'nestedOneWay', when: 'there are several wells per animal' },
  ],
  assumptions: [
    'Each value comes from a different subject.',
    'Each group is roughly symmetric.',
    'The groups have similar SDs.',
  ],
  reading:
    'The overall F test answers “any difference?”. The comparisons you chose (every pair: Tukey; each with a control: Dunnett) say which groups differ, adjusted for their number. They don’t need the overall P below 0.05 first, and can disagree with it. R² is the share of all variation explained by the groups.',
  more: {
    formula: 'F = between-group mean square / within-group mean square.',
    r: 'anova(lm(y ~ group))',
  },
  references: [{ text: 'Fisher RA (1925) Statistical Methods for Research Workers' }],
}

export const welchAnova: MethodCard = {
  id: 'welchAnova',
  name: 'Welch ANOVA',
  shortName: 'Welch ANOVA',
  question: 'Do all the groups have the same mean, without assuming equal scatter?',
  nullHypothesis:
    'Every group has the same mean. P is the chance of means at least this spread out if they did.',
  useWhen:
    'Three or more independent groups whose scatter can differ (a treatment that makes some animals respond and others not), or whose sizes differ a lot.',
  instead: [
    { card: 'oneWayAnova', when: 'the groups are balanced with similar scatter' },
    { card: 'brownForsytheAnova', when: 'one group is much more spread than the others' },
    { card: 'kruskalWallis', when: 'the values are scores' },
  ],
  assumptions: [
    'Each value comes from a different subject.',
    'Each group is roughly symmetric.',
    'At least two values and some variation in every group.',
  ],
  reading:
    'Read it as one-way ANOVA. Its comparisons don’t assume equal scatter either: Dunnett’s T3 (recommended for fewer than about 50 values per group, as it keeps its error rate there) or Games-Howell (larger groups).',
  more: {
    formula: 'F* weights each group by n/s²; df by Welch’s approximation.',
    r: 'oneway.test(y ~ group, var.equal = FALSE)',
  },
  references: [{ text: 'Welch BL (1951) Biometrika 38:330–336' }],
}

export const brownForsytheAnova: MethodCard = {
  id: 'brownForsytheAnova',
  name: 'Brown-Forsythe ANOVA',
  shortName: 'Brown-Forsythe',
  question: 'Do all the groups have the same mean, without assuming equal scatter?',
  nullHypothesis:
    'Every group has the same mean. P is the chance of means at least this spread out if they did.',
  useWhen:
    'As Welch ANOVA: independent groups whose scatter can differ. It is less affected than Welch ANOVA by one very spread group.',
  instead: [
    { card: 'welchAnova', when: 'the usual choice when scatter differs' },
    { card: 'oneWayAnova', when: 'the groups have similar scatter' },
  ],
  assumptions: ['Each value comes from a different subject.', 'Each group is roughly symmetric.'],
  reading:
    'Read it as one-way ANOVA; its comparisons are those of Welch ANOVA (Dunnett’s T3, Games-Howell or Tamhane’s T2), which don’t assume equal scatter.',
  more: {
    formula: 'F* = Σ n_i (m_i − m)² / Σ (1 − n_i/N) s_i², df by Satterthwaite’s approximation.',
    r: 'onewaytests::bf.test(y ~ group, data = d)',
  },
  references: [{ text: 'Brown MB, Forsythe AB (1974) Technometrics 16:129–132' }],
}

export const kruskalWallis: MethodCard = {
  id: 'kruskalWallis',
  name: 'Kruskal-Wallis test',
  shortName: 'Kruskal-Wallis',
  question: 'Do values tend to be larger in some groups than in others?',
  nullHypothesis:
    'All groups come from the same distribution. P is the chance of mean ranks at least this spread out if they did.',
  useWhen:
    'Three or more independent groups of scores or ranks, or values you can’t make symmetric (by taking logs, for instance).',
  instead: [
    { card: 'oneWayAnova', when: 'the values are measurements' },
    { card: 'welchAnova', when: 'measurements whose scatter differs' },
    { card: 'friedman', when: 'the subjects are matched' },
  ],
  assumptions: [
    'Each value comes from a different subject.',
    'It compares medians only if the groups have the same shape.',
  ],
  reading:
    'Read P and the mean rank of each group. Dunn’s comparisons use the ranks of all groups together and are adjusted for their number (Holm by default). P is exact for small groups (every arrangement of the ranks counted) and the chi-square approximation for larger ones; the result says which.',
  more: {
    formula:
      'H from the rank sums (tie-corrected); exact P by enumerating the arrangements of the ranks, else chi-square on k − 1 df.',
    r: 'kruskal.test(y ~ group)  # approximate P',
    notes:
      'Exact: coin::kruskal_test(y ~ group, distribution = approximate()) estimates it. Dunn: dunn.test::dunn.test(y, group, method = "holm").',
  },
  references: [
    { text: 'Kruskal WH, Wallis WA (1952) J Am Stat Assoc 47:583–621' },
    { text: 'Dunn OJ (1964) Technometrics 6:241–252' },
  ],
}

export const rmOneWay: MethodCard = {
  id: 'rmOneWay',
  name: 'Repeated-measures one-way ANOVA',
  shortName: 'RM one-way ANOVA',
  question: 'Does the mean change across conditions measured in the same subjects?',
  nullHypothesis:
    'The condition means are equal. P is the chance of differences at least this large if they were.',
  useWhen:
    'Every subject (animal, donor, culture, experiment day) has a value in every condition or at every time, one subject per row.',
  instead: [
    { card: 'oneWayAnova', when: 'each value is from a different subject' },
    { card: 'friedman', when: 'the values are scores' },
    { card: 'nestedOneWay', when: 'there are several technical replicates per subject' },
    { card: 'twoWayRm', when: 'there is also a between-subject factor' },
  ],
  assumptions: [
    'Subjects are independent of each other.',
    'The values are roughly symmetric.',
    'Sphericity: the differences between any two conditions vary about equally. Time courses usually break it.',
  ],
  reading:
    'Read P for the conditions. The Geisser-Greenhouse correction (recommended because nearby times are usually more alike) lowers the df to keep P honest; its epsilon near 1 means sphericity holds. With missing values a mixed-effects model is fit instead (or always, or the complete subjects only, as you choose): it uses every value but assumes sphericity; the result says so, with its df (Satterthwaite by default).',
  more: {
    formula:
      'F = condition mean square / (condition × subject) mean square, df × epsilon. Mixed: REML with a random subject intercept.',
    r: 'afex::aov_ez("subject", "y", d, within = "condition")',
    notes: 'Mixed: anova(lmerTest::lmer(y ~ condition + (1 | subject))).',
  },
  references: [
    { text: 'Geisser S, Greenhouse SW (1958) Ann Math Stat 29:885–891' },
    { text: 'Satterthwaite FE (1946) Biometrics Bulletin 2:110–114' },
  ],
}

export const friedman: MethodCard = {
  id: 'friedman',
  name: 'Friedman test',
  shortName: 'Friedman',
  question: 'Within subjects, do values tend to be larger in some conditions than in others?',
  nullHypothesis:
    'Within each subject, every ordering of the conditions is equally likely. P is the chance of rank sums at least this spread out if so.',
  useWhen: 'Matched subjects (one per row, as for repeated measures) with scores or ranks.',
  instead: [
    { card: 'rmOneWay', when: 'the values are measurements' },
    { card: 'kruskalWallis', when: 'the groups are not matched' },
  ],
  assumptions: [
    'Subjects are independent of each other.',
    'Values are ranked within each subject; rows with a missing value are left out.',
  ],
  reading:
    'Read P (exact for small designs, else approximate; the result says which) and the rank sum of each condition. Dunn’s comparisons (Siegel-Castellan form) are adjusted for their number, by Holm by default.',
  more: {
    formula: 'Ranks 1…k within each subject; a chi-square statistic from the rank sums.',
    r: 'friedman.test(y ~ condition | subject)',
  },
  references: [{ text: 'Friedman M (1937) J Am Stat Assoc 32:675–701' }],
}

export const linearTrend: MethodCard = {
  id: 'linearTrend',
  name: 'Test for linear trend',
  shortName: 'Linear trend',
  question: 'Do the group means rise or fall steadily across the groups, in their order?',
  nullHypothesis:
    'There is no linear trend in the means across the groups. P is the chance of a slope at least this steep if there were none.',
  useWhen:
    'Ordered groups (doses, ages, passages) where you predicted a steady rise or fall before the experiment.',
  instead: [
    { card: 'tukey', when: 'you want to know which pairs of groups differ' },
    { card: 'linearRegression', when: 'the groups are numeric doses entered as X' },
  ],
  assumptions: [
    'The assumptions of ordinary one-way ANOVA.',
    'The groups are equally spaced in the order of the table.',
  ],
  reading:
    'Read the slope (the change in mean per group step) and its P. The result also says how much of the variation between groups is not linear.',
  more: {
    formula: 'A linear contrast with scores 1…k on the ANOVA’s error term.',
    r: 'summary(lm(y ~ as.numeric(group)))  # with the ANOVA’s residual mean square',
  },
  references: [{ text: 'Altman DG (1991) Practical Statistics for Medical Research' }],
}

export const COMPARE_GROUP_CARDS: readonly MethodCard[] = [
  welchT,
  studentT,
  pairedT,
  ratioPairedT,
  mannWhitney,
  wilcoxon,
  kolmogorovSmirnov,
  oneSampleT,
  oneSampleWilcoxon,
  oneWayAnova,
  welchAnova,
  brownForsytheAnova,
  kruskalWallis,
  rmOneWay,
  friedman,
  linearTrend,
]
