import type { MethodCard } from '@ps/model'

// Roadmap 51a: the multiple-comparison cards (design §2.5's table). Each opens with the same
// sentence about families; the method's own words follow.

const FAMILY =
  'Each extra comparison is another chance of a false positive; this method keeps the chance of any false positive among the family (the comparisons adjusted together) at the level you choose.'

/** A comparison card; `family`: its reading opens with the family sentence. */
const card = (
  c: Omit<MethodCard, 'nullHypothesis' | 'assumptions'> &
    Partial<Pick<MethodCard, 'nullHypothesis' | 'assumptions'>>,
  family = true,
): MethodCard => ({
  nullHypothesis:
    'For each comparison, the two means are equal. Its adjusted P is the chance of a difference at least this large, allowing for the number of comparisons.',
  assumptions: [
    'Those of the analysis it follows (each value from a different subject, unless matched).',
  ],
  ...c,
  reading: family ? `${FAMILY} ${c.reading}` : c.reading,
})

export const tukey = card({
  id: 'tukey',
  name: 'Tukey’s multiple comparisons test',
  shortName: 'Tukey',
  question: 'Which pairs of group means differ, comparing every pair?',
  useWhen: `You want every pairwise comparison (the usual choice for all pairs).`,
  instead: [
    { card: 'dunnett', when: 'only comparisons with one control matter' },
    { card: 'sidak', when: 'you planned a few comparisons, not all pairs' },
  ],
  reading:
    'Read the adjusted P and the simultaneous 95% CI of each difference: together the CIs cover all the true differences 95% of the time.',
  more: {
    formula: 'Studentized range on the ANOVA’s error term (Tukey-Kramer for unequal sizes).',
    r: 'TukeyHSD(aov(y ~ group))',
  },
  references: [
    { text: 'Tukey JW (1953) The problem of multiple comparisons (unpublished)' },
    { text: 'Kramer CY (1956) Biometrics 12:307–310' },
  ],
})

export const dunnett = card({
  id: 'dunnett',
  name: 'Dunnett’s multiple comparisons test',
  shortName: 'Dunnett',
  question: 'Which groups differ from the control?',
  useWhen: `One control, and only comparisons with it matter; more power than Tukey for that, because it makes fewer comparisons.`,
  instead: [{ card: 'tukey', when: 'every pair of groups matters' }],
  reading:
    'Read the adjusted P and the simultaneous CI of each group’s difference from the control.',
  more: {
    formula: 'Multivariate t distribution of the differences from the control.',
    r: 'summary(multcomp::glht(aov(y ~ group), multcomp::mcp(group = "Dunnett")))',
  },
  references: [{ text: 'Dunnett CW (1955) J Am Stat Assoc 50:1096–1121' }],
})

export const sidak = card({
  id: 'sidak',
  name: 'Šidák’s multiple comparisons test',
  shortName: 'Šidák',
  question: 'Which of the comparisons you planned differ, adjusting for how many there are?',
  useWhen: `A few planned comparisons, not all pairs (two-way ANOVA within rows with few columns). Slightly more power than Bonferroni.`,
  instead: [
    { card: 'holmSidak', when: 'you need yes/no decisions only (more power, no CIs)' },
    { card: 'tukey', when: 'you compare every pair' },
  ],
  reading: 'Read the adjusted P and the matching CIs of each comparison.',
  more: { formula: 'Adjusted P = 1 − (1 − p)^m for m comparisons.', r: '1 - (1 - p)^m' },
  references: [{ text: 'Šidák Z (1967) J Am Stat Assoc 62:626–633' }],
})

export const holmSidak = card({
  id: 'holmSidak',
  name: 'Holm-Šidák multiple comparisons test',
  shortName: 'Holm-Šidák',
  question: 'Which comparisons differ, testing the smallest P first?',
  useWhen: `You need yes/no decisions, not intervals. It tests the smallest P first and relaxes for the rest, so it has more power than Šidák.`,
  instead: [{ card: 'sidak', when: 'you want confidence intervals' }],
  reading: 'Read the adjusted P values only: step-down methods have no CIs.',
  more: {
    formula: 'Step-down Šidák: the i-th smallest P compared with 1 − (1 − α)^(1/(m − i + 1)).',
    r: 'p.adjust(p, "holm")  # the Bonferroni form of the step-down',
  },
  references: [{ text: 'Holm S (1979) Scand J Stat 6:65–70' }],
})

export const holm = card({
  id: 'holm',
  name: 'Holm’s step-down correction',
  shortName: 'Holm',
  question: 'Which comparisons differ, testing the smallest P first?',
  useWhen: `A family of tests with yes/no answers (pairs of survival curves, Dunn’s rank comparisons, correlation pairs). It tests the smallest P first and relaxes for the rest, so it has more power than Bonferroni with the same guarantee.`,
  instead: [
    { card: 'bonferroni', when: 'you want the simplest adjustment' },
    { card: 'fdrBh', when: 'you screen many comparisons' },
  ],
  reading: 'Read the adjusted P values only: step-down methods have no CIs.',
  more: {
    formula: 'Step-down Bonferroni: the i-th smallest P multiplied by m − i + 1 (kept monotone).',
    r: 'p.adjust(p, "holm")',
  },
  references: [{ text: 'Holm S (1979) Scand J Stat 6:65–70' }],
})

export const bonferroni = card({
  id: 'bonferroni',
  name: 'Bonferroni correction',
  shortName: 'Bonferroni',
  question: 'Which comparisons differ, after multiplying each P by the number of comparisons?',
  useWhen: `Few comparisons, or comparisons that share data in ways other methods don’t model (pairs of rows of a contingency table). Simple and conservative.`,
  instead: [{ card: 'sidak', when: 'you want slightly more power with the same guarantee' }],
  reading: 'Read the adjusted P (at most 1) and the CIs at the stricter level.',
  more: { formula: 'Adjusted P = min(1, m · p); CIs at 1 − α/m.', r: 'p.adjust(p, "bonferroni")' },
  references: [{ text: 'Dunn OJ (1961) J Am Stat Assoc 56:52–64' }],
})

export const fdr = card(
  {
    id: 'fdr',
    name: 'False discovery rate (two-stage Benjamini, Krieger and Yekutieli)',
    shortName: 'FDR (two-stage)',
    question: 'Which comparisons are discoveries, keeping the share of false ones low?',
    nullHypothesis:
      'For each comparison, no difference. Its q value is the smallest false discovery rate at which it would count as a discovery.',
    useWhen:
      'Screening many rows (genes, proteins), with follow-up to confirm. It controls the expected share of false discoveries among the comparisons called discoveries, not the chance of any.',
    instead: [
      { card: 'fdrBh', when: 'you want the most widely used FDR method' },
      { card: 'holmSidak', when: 'every false positive is costly' },
    ],
    reading:
      'Read the q values and which comparisons are discoveries: of the discoveries, about Q% are expected to be false. The two-stage method has more power than Benjamini-Hochberg with the same guarantee.',
    more: {
      formula: 'Estimate the number of true nulls, then Benjamini-Hochberg at the adjusted level.',
      r: 'two-stage step-up as in the oracle’s padjust.R; p.adjust(p, "BH") for the one-stage method',
    },
    references: [{ text: 'Benjamini Y, Krieger AM, Yekutieli D (2006) Biometrika 93:491–507' }],
  },
  false,
)

export const fdrBh = card(
  {
    id: 'fdrBh',
    name: 'False discovery rate (Benjamini-Hochberg)',
    shortName: 'FDR (BH)',
    question: 'Which comparisons are discoveries, keeping the share of false ones low?',
    nullHypothesis:
      'For each comparison, no difference. Its q value is the smallest false discovery rate at which it would count as a discovery.',
    useWhen:
      'Screening many comparisons; the most widely used FDR method, valid when the tests are independent or positively related.',
    instead: [
      { card: 'fdr', when: 'you want more power with the same guarantee' },
      { card: 'fdrBy', when: 'the tests may be related in any way' },
    ],
    reading: 'Read the q values: of the discoveries, about Q% are expected to be false.',
    more: { formula: 'q_(i) = min over j ≥ i of m · p_(j) / j.', r: 'p.adjust(p, "BH")' },
    references: [{ text: 'Benjamini Y, Hochberg Y (1995) J R Stat Soc B 57:289–300' }],
  },
  false,
)

export const fdrBy = card(
  {
    id: 'fdrBy',
    name: 'False discovery rate (Benjamini-Yekutieli)',
    shortName: 'FDR (BY)',
    question: 'Which comparisons are discoveries, whatever the relation between the tests?',
    nullHypothesis:
      'For each comparison, no difference. Its q value is the smallest false discovery rate at which it would count as a discovery.',
    useWhen:
      'Screening many comparisons that may depend on each other in any way; more conservative than Benjamini-Hochberg.',
    instead: [{ card: 'fdrBh', when: 'the tests are independent or positively related' }],
    reading: 'Read the q values: of the discoveries, about Q% are expected to be false.',
    more: { formula: 'Benjamini-Hochberg with m replaced by m · Σ 1/i.', r: 'p.adjust(p, "BY")' },
    references: [{ text: 'Benjamini Y, Yekutieli D (2001) Ann Stat 29:1165–1188' }],
  },
  false,
)

export const gamesHowell = card({
  id: 'gamesHowell',
  name: 'Games-Howell multiple comparisons test',
  shortName: 'Games-Howell',
  question: 'Which pairs differ, without assuming equal scatter?',
  useWhen: `After Welch or Brown-Forsythe ANOVA with larger groups (about 50 or more values each).`,
  instead: [{ card: 'dunnettT3', when: 'the groups are smaller' }],
  reading: 'Read the adjusted P and CI of each difference.',
  more: {
    formula: 'Each pair’s own SE and Welch df, on the studentized range.',
    r: 'PMCMRplus::gamesHowellTest(y ~ group)',
  },
  references: [{ text: 'Games PA, Howell JF (1976) J Educ Stat 1:113–125' }],
})

export const dunnettT3 = card({
  id: 'dunnettT3',
  name: 'Dunnett’s T3 multiple comparisons test',
  shortName: 'Dunnett’s T3',
  question: 'Which pairs differ, without assuming equal scatter?',
  useWhen: `After Welch or Brown-Forsythe ANOVA with fewer than about 50 values per group, where it keeps its error rate better than Games-Howell.`,
  instead: [{ card: 'gamesHowell', when: 'the groups are large' }],
  reading: 'Read the adjusted P and CI of each difference.',
  more: {
    formula: 'Each pair’s own SE and Welch df, on the studentized maximum modulus.',
    r: 'PMCMRplus::dunnettT3Test(y ~ group)',
  },
  references: [{ text: 'Dunnett CW (1980) J Am Stat Assoc 75:796–800' }],
})

export const tamhaneT2 = card({
  id: 'tamhaneT2',
  name: 'Tamhane’s T2 multiple comparisons test',
  shortName: 'Tamhane’s T2',
  question: 'Which pairs differ, without assuming equal scatter?',
  useWhen: `After Welch or Brown-Forsythe ANOVA; a conservative choice (Šidák on Welch t tests).`,
  instead: [{ card: 'dunnettT3', when: 'you want slightly more power' }],
  reading: 'Read the adjusted P and CI of each difference.',
  more: {
    formula: 'Welch t tests of each pair, Šidák-adjusted.',
    r: 'PMCMRplus::tamhaneT2Test(y ~ group)',
  },
  references: [{ text: 'Tamhane AC (1979) J Am Stat Assoc 74:471–480' }],
})

export const dunn = card({
  id: 'dunn',
  name: 'Dunn’s multiple comparisons test',
  shortName: 'Dunn',
  question: 'Which pairs of groups differ in their ranks?',
  nullHypothesis:
    'For each pair, the two groups’ mean ranks are equal. Its adjusted P allows for the number of comparisons.',
  useWhen: `After Kruskal-Wallis or Friedman. It uses the ranks of all groups together.`,
  instead: [{ card: 'tukey', when: 'the analysis is an ANOVA of measurements' }],
  reading:
    'Read the adjusted P of each pair (Holm’s step-down by default; Šidák, Bonferroni or none on request); rank comparisons have no CIs.',
  more: {
    formula: 'z = difference in mean ranks / its SE (tie-corrected).',
    r: 'dunn.test::dunn.test(y, group, method = "holm")',
  },
  references: [{ text: 'Dunn OJ (1964) Technometrics 6:241–252' }],
})

export const fisherLsd = card(
  {
    id: 'fisherLsd',
    name: 'Fisher’s LSD test (no correction)',
    shortName: 'Fisher’s LSD',
    question: 'Which pairs differ, without adjusting for the number of comparisons?',
    nullHypothesis:
      'For each comparison, the two means are equal. Its P is not adjusted for the other comparisons.',
    useWhen: 'One planned comparison, after an overall F test. Not for screening many pairs.',
    instead: [{ card: 'tukey', when: 'you compare several pairs' }],
    reading:
      'Read each unadjusted P: with several comparisons the chance of at least one false positive grows (about 26% with six at 5%).',
    more: {
      formula: 't tests on the ANOVA’s pooled error term.',
      r: 'pairwise.t.test(y, g, p.adjust.method = "none")',
    },
    references: [{ text: 'Fisher RA (1935) The Design of Experiments' }],
  },
  false,
)

export const newmanKeuls = card(
  {
    id: 'newmanKeuls',
    name: 'Newman-Keuls test',
    shortName: 'Newman-Keuls',
    question: 'Which pairs differ, by a stepwise range test?',
    nullHypothesis: 'For each pair, the two means are equal.',
    useWhen:
      'Reproducing an older analysis. It doesn’t control the chance of any false positive, which is why it is not recommended.',
    instead: [{ card: 'tukey', when: 'you compare every pair (the usual choice)' }],
    reading: 'Read significant or not for each pair; it gives no P values or CIs.',
    more: {
      formula: 'Step-down studentized range on the ordered means.',
      r: 'step-down ptukey(), as in the oracle’s newman_keuls.R',
    },
    references: [{ text: 'Keuls M (1952) Euphytica 1:112–122' }],
  },
  false,
)

export const noCorrection = card(
  {
    id: 'noCorrection',
    name: 'No correction for multiple comparisons',
    shortName: 'Uncorrected',
    question: 'Which comparisons have P below the threshold, each on its own?',
    nullHypothesis: 'For each comparison, no difference; each P stands alone.',
    useWhen:
      'Few planned comparisons whose results you will report as separate questions, or a first look that later work corrects.',
    instead: [
      { card: 'fdr', when: 'you screen many rows' },
      { card: 'holmSidak', when: 'the comparisons form one family' },
    ],
    reading:
      'Read each P on its own: with 20 comparisons and no effect at all, about one will have P < 0.05 by chance.',
    more: { formula: 'No adjustment.', r: 'p.adjust(p, "none")' },
    references: [{ text: 'Rothman KJ (1990) Epidemiology 1:43–46' }],
  },
  false,
)

export const COMPARISON_CARDS: readonly MethodCard[] = [
  tukey,
  dunnett,
  sidak,
  holmSidak,
  holm,
  bonferroni,
  fdr,
  fdrBh,
  fdrBy,
  gamesHowell,
  dunnettT3,
  tamhaneT2,
  dunn,
  fisherLsd,
  newmanKeuls,
  noCorrection,
]
