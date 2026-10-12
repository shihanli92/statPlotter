import type { FieldText, FormText } from './types.ts'

// Roadmap 51a: text of the fields many analyses share (the confidence level, P value tails, the
// multiple-comparison methods…). An analysis' own text for a path, in `forms/*.ts`, wins; its
// options merge over these.

export const CONFIDENCE: FieldText = {
  line: 'How sure the intervals are: 95% CIs cover the true value in 95 of 100 experiments.',
  card: 'Every confidence interval in the results uses this level. A higher level gives wider intervals that miss the true value less often; a lower level gives narrower ones that miss it more often. It doesn’t change the P values.',
  options: {
    '0.9': 'Narrower intervals that miss the true value 1 time in 10.',
    '0.95': 'The usual level in biology and medicine.',
    '0.99': 'Wider intervals that miss the true value 1 time in 100.',
  },
}

export const TAILS: FieldText = {
  line: 'Two-tailed asks whether the groups differ in either direction.',
  card: 'Use one-tailed only if, before the experiment, you predicted the direction and would have treated a difference the other way as no effect. The P is then computed for the direction you state below; if the data go the other way, the result reports the large P and says so.',
  options: {
    two: {
      line: 'Asks about a difference in either direction.',
      recommended: 'the right choice unless you stated a direction before the experiment',
    },
    one: {
      line: 'Only in the direction you predicted before the experiment (stated below).',
      card: 'Choose it only for a direction stated before the experiment. Choosing one-tailed after seeing which way the data went doubles the chance of a false positive.',
    },
  },
}

export const PREDICTED: FieldText = {
  line: 'The direction you predicted before seeing the data; the P is for that direction.',
  card: 'A one-tailed P answers one direction only. If the data go the other way, the P is large (above 0.5) and the result says so: a difference the other way is, by your prediction, no effect. Work saved before 0.3.9 used the observed direction; they keep it, with a warning, until you state one.',
  options: {
    increase: 'The effect you predicted is an increase.',
    decrease: 'The effect you predicted is a decrease.',
  },
}

export const DDF: FieldText = {
  line: 'How the degrees of freedom of a mixed-effects model’s tests are counted.',
  card: 'Satterthwaite’s method works out the df from the data’s own balance, as most statistics packages do for mixed models; containment counts subjects minus groups. They agree for balanced data; with missing values Satterthwaite’s keeps P closer to its stated level.',
  options: {
    satterthwaite: {
      line: 'The df from the variance components (as lmerTest).',
      recommended: 'it keeps P honest when values are missing or groups are unbalanced',
    },
    containment: 'Subjects minus groups: the default before 0.3.9.',
  },
}

export const RM_METHOD: FieldText = {
  line: 'What happens when a subject misses a value.',
  card: 'Repeated-measures ANOVA needs every subject in every condition. With missing values a mixed-effects model uses every value instead, but it assumes equal correlation between all conditions (sphericity), so the Geisser-Greenhouse correction doesn’t apply; the result says which was fit. You can also analyze the complete subjects only.',
  options: {
    auto: 'ANOVA with complete data; a mixed-effects model when values are missing.',
    anova: 'ANOVA of the subjects with every value; the others are left out (said).',
    mixed: 'A mixed-effects model, with or without missing values.',
  },
}

export const DUNN_METHOD: FieldText = {
  line: 'How Dunn’s comparisons of the ranks are adjusted for their number.',
  options: {
    holm: {
      line: 'Step-down: more power than Bonferroni, the same protection.',
      recommended:
        'it keeps the chance of any false positive at 5% with more power than Bonferroni',
      method: 'dunn',
    },
    sidak: { line: 'Splits the error rate among the comparisons.', method: 'dunn' },
    bonferroni: { line: 'Multiplies each P by the number of comparisons.', method: 'dunn' },
    none: {
      line: 'Each comparison unadjusted: only for one planned comparison.',
      method: 'noCorrection',
    },
  },
}

export const KW_P_METHOD: FieldText = {
  line: 'Exact P counts every arrangement of the ranks; approximate uses chi-square.',
  card: 'With the small groups of most experiments the chi-square approximation can be far off. The exact P counts every way the ranks could fall into the groups; with large groups there are too many, and the approximation is used (the result says which).',
  options: {
    exactWhenPossible: 'Exact while the groups are small enough, else approximate (said).',
    approximate: 'The chi-square approximation: fast, but rough for small groups.',
  },
}

export const DIFFERENCE_AS: FieldText = {
  line: 'The sign of each difference: later group minus earlier, or group minus control.',
  card: 'New comparisons read “Treated − Control”: a positive difference means the later group (or the group compared with the control) is higher. Comparisons saved before 0.3.9 read “Control vs. Treated” as earlier minus later; they keep it. P values don’t change with the sign.',
  options: {
    laterMinusEarlier: 'Each group minus the control; later minus earlier for pairs.',
    earlierMinusLater: 'Earlier minus later (“A vs. B” = A − B), as before 0.3.9.',
  },
}

export const P_METHOD: FieldText = {
  line: 'Exact P counts every arrangement of the ranks; approximate uses the normal curve.',
  options: {
    exactWhenPossible:
      'Exact when the groups are small enough, else approximate (the result says).',
    approximate: 'The normal approximation: fast, but rough for small groups.',
  },
}

export const CONTROL: FieldText = {
  line: 'The group the others are compared with (vehicle, untreated, wild type).',
}

export const ALL_PAIRS_METHOD: FieldText = {
  line: 'How the P values of every pair are adjusted for the number of pairs.',
  card: 'Each extra comparison is another chance of a false positive. These methods keep the chance of any false positive among the comparisons (or the share of false discoveries) at the level you choose. Tukey is made for every pair; Šidák, Bonferroni and Holm-Šidák suit a few planned comparisons.',
  options: {
    tukey: {
      line: 'Every pair, with adjusted P values and simultaneous CIs.',
      recommended:
        'made for comparing every pair of means, with CIs that cover all the true differences together',
    },
    sidak: 'Splits the error rate among the comparisons; slightly more power than Bonferroni.',
    bonferroni: 'Multiplies each P by the number of comparisons: simple and conservative.',
    'holm-sidak': 'Step-down: more power than Šidák, but adjusted P values only (no CIs).',
    fisher: {
      line: 'No adjustment: only for one planned comparison after the overall test.',
      notRecommended:
        'with several comparisons the chance of a false positive grows with their number',
    },
    bky: 'Controls the share of false discoveries, for screening many comparisons.',
    'newman-keuls': {
      line: 'A stepwise range test giving significant or not, without P values or CIs.',
      notRecommended: 'it doesn’t control the chance of any false positive among the comparisons',
    },
  },
}

export const CONTROL_METHOD: FieldText = {
  line: 'How the P values of each group against the control are adjusted.',
  card: 'Comparing each group with one control makes fewer comparisons than every pair, so the adjustment is smaller and the power higher.',
  options: {
    dunnett: {
      line: 'Each group against the control, with adjusted P values and simultaneous CIs.',
      recommended: 'made for comparisons with one control, it has the most power for them',
    },
    sidak: 'Splits the error rate among the comparisons; slightly more power than Bonferroni.',
    bonferroni: 'Multiplies each P by the number of comparisons: simple and conservative.',
    'holm-sidak': 'Step-down: more power than Šidák, but adjusted P values only (no CIs).',
    fisher: {
      line: 'No adjustment: only for one planned comparison after the overall test.',
      notRecommended:
        'with several comparisons the chance of a false positive grows with their number',
    },
    bky: 'Controls the share of false discoveries, for screening many comparisons.',
  },
}

export const WELCH_METHOD: FieldText = {
  line: 'Comparisons that, like Welch ANOVA, don’t assume equal scatter.',
  card: 'These methods give each comparison its own standard error and df, so a group with more scatter doesn’t distort the P values of the others.',
  options: {
    'dunnett-t3': {
      line: 'Each pair with its own scatter; for groups of fewer than about 50 values.',
      recommended: 'it keeps its error rate better than Games-Howell with small groups',
    },
    'games-howell': {
      line: 'Each pair with its own scatter; for larger groups.',
      recommended: 'with about 50 or more values per group it has a little more power than T3',
    },
    'tamhane-t2': 'Šidák-adjusted Welch t tests: conservative.',
  },
}

export const ONE_FACTOR_METHOD: FieldText = {
  line: 'How the P values of the comparisons are adjusted for their number.',
  options: {
    sidak: 'Splits the error rate among the comparisons; CIs included.',
    bonferroni: 'Multiplies each P by the number of comparisons: simple and conservative.',
    'holm-sidak': {
      line: 'Step-down: more power than Šidák, but adjusted P values only (no CIs).',
      recommended:
        'for a set of planned comparisons it has the most power of the methods that control any false positive',
    },
    fisher: {
      line: 'No adjustment: only for one planned comparison after the overall test.',
      notRecommended:
        'with several comparisons the chance of a false positive grows with their number',
    },
    bky: 'Controls the share of false discoveries, for screening many comparisons.',
    'newman-keuls': {
      line: 'A stepwise range test giving significant or not, without P values or CIs.',
      notRecommended: 'it doesn’t control the chance of any false positive among the comparisons',
    },
  },
}

export const SPHERICITY: FieldText = {
  line: 'Do the differences between any two conditions vary about equally?',
  card: 'Repeated measures assume sphericity: the differences between any two conditions have about the same scatter. Time courses usually break it, because nearby times are more alike. The Geisser-Greenhouse correction lowers the df by how much it is broken, which keeps P honest; when sphericity holds it changes almost nothing.',
  options: {
    gg: {
      line: 'Corrects the df by how much sphericity is broken.',
      recommended:
        'it keeps P honest when conditions correlate unequally and costs little when they don’t',
    },
    assumed: 'No correction: only with a reason to expect equal correlations.',
  },
}

export const EQUAL_SD: FieldText = {
  line: 'A treatment can change how much values vary, not only their mean.',
  card: 'Ordinary ANOVA pools the scatter of all groups. If a treatment makes some subjects respond and others not, or group sizes differ a lot, its P can be wrong; Welch ANOVA doesn’t assume equal scatter. Decide from the experiment, not from a test of the SDs.',
  options: {
    yes: 'Ordinary ANOVA: similar scatter expected in every group.',
    welch: 'Welch ANOVA: each group keeps its own scatter.',
    brownForsythe: 'Brown-Forsythe ANOVA: like Welch, less affected by one very spread group.',
  },
}

export const REFERENCE_RULE: FieldText = {
  line: 'The level each category is compared with (its coefficients are differences from it).',
  options: {
    first: {
      line: 'The first level in the table, e.g. the control group entered first.',
      recommended: 'you decide the reference by the order you enter the data, usually the control',
    },
    last: 'The last level in the table.',
    mostFrequent: 'The level with the most subjects (the most precise comparisons).',
    leastFrequent: 'The level with the fewest subjects.',
  },
}

export const SHARED_TEXT: FormText = {
  confidenceLevel: CONFIDENCE,
  tails: TAILS,
  pMethod: P_METHOD,
  control: CONTROL,
  allPairsMethod: ALL_PAIRS_METHOD,
  controlMethod: CONTROL_METHOD,
  welchMethod: WELCH_METHOD,
  oneFactorMethod: ONE_FACTOR_METHOD,
  sphericity: SPHERICITY,
  equalSD: EQUAL_SD,
  predicted: PREDICTED,
  ddf: DDF,
  rmMethod: RM_METHOD,
  dunnMethod: DUNN_METHOD,
  kwPMethod: KW_P_METHOD,
  differenceAs: DIFFERENCE_AS,
  reportEqualSdTests: {
    line: 'Brown-Forsythe and Bartlett tests of the SDs, for information; they don’t choose the test.',
    card: 'Choosing between ordinary and Welch ANOVA from a test of the SDs on the same data is a two-step procedure with worse error control than deciding in advance. The results always show the ratio of the largest SD to the smallest, as a description.',
  },
  referenceRule: REFERENCE_RULE,
  referenceLevels: {
    line: 'Choose the reference level of each categorical predictor by hand.',
  },
  categorical: {
    line: 'Predictors that are categories (genotype, sex), not numbers on a scale.',
    card: 'A categorical predictor gets one coefficient per level other than the reference: the difference from the reference level. Number codes (1, 2, 3) of categories belong here too, or they are treated as a scale.',
  },
  interactions: {
    line: 'Whether one predictor changes the effect of another (drug × sex).',
  },
  seed: {
    line: 'The same seed gives the same random numbers, so the result can be repeated.',
  },
}
