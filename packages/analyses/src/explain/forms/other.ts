import type { FieldText, FormText } from './types.ts'

// Roadmap 51a: the text of the contingency, parts-of-whole, survival, multiple-variables and
// planning analyses.

const INTERCEPT: FieldText = {
  line: 'Leave on unless the outcome must be zero when every predictor is zero.',
}

const MV_COMMON = (outcome: string): FormText => ({
  intercept: INTERCEPT,
  interpolate: { line: `Fill in the ${outcome} of rows that have every predictor but no outcome.` },
  predictions: { line: `The ${outcome} the model predicts at predictor values you enter.` },
})

const CI_PROFILE: FieldText = {
  line: 'How the CIs of the coefficients are computed.',
  options: {
    profile: {
      line: 'From the profile likelihood.',
      recommended:
        'it stays accurate with few events or extreme probabilities, where Wald’s doesn’t',
    },
    wald: 'Estimate ± z·SE: fast, rough with few events.',
  },
}

const SURVIVAL_CI: FieldText = {
  line: 'How the CIs of the survival curves are computed.',
  options: {
    asymmetric: {
      line: 'Transformed, so they stay between 0% and 100%.',
      recommended: 'symmetric intervals can run below 0% or above 100% near the ends of the curve',
    },
    symmetric: 'Estimate ± z·SE: can run past 0% or 100%.',
  },
}

export const OTHER_TEXT: Readonly<Record<string, FormText>> = {
  contingency: {
    test: {
      line: 'Exact for any sample size, or the chi-square approximation.',
      options: {
        fisher: {
          line: 'Exact, for any sample size.',
          recommended: 'it is exact however small the counts, and computers make it quick',
          method: 'fisherExact',
        },
        chiSquare: {
          line: 'An approximation for large counts (expected ≥ 5).',
          method: 'chiSquare',
        },
      },
    },
    yates: { line: 'A correction for 2 × 2 tables that makes chi-square conservative.' },
    trend: {
      line: 'Only if the rows are in a meaningful order (doses, ages) and you planned it.',
      card: 'Tests a steady change in the proportion across ordered rows, for tables with two outcome columns and three or more rows. It is ticked by default in this version: untick it if the rows have no order.',
    },
    tails: {
      line: 'Applies to 2 × 2 tables; two-tailed asks about a difference in either direction.',
    },
    riskEstimates: {
      line: 'For a trial or cohort: the risk in each group, their ratio and difference.',
    },
    oddsRatio: { line: 'For a case-control study, where risks can’t be estimated.' },
    diagnostic: {
      line: 'Only if the table is a test result against the truth (2 × 2).',
      card: 'Rows: with and without the condition; columns: test positive and negative. Gives sensitivity, specificity and predictive values.',
    },
    effectSize: { line: 'The strength of the association, from 0 (none) to 1.' },
    pairwise: {
      line: 'Which rows differ: each pair of rows tested on its own.',
      card: 'Each pair of rows is tested on its own with the test chosen above, then adjusted for the number of pairs.',
      options: {
        none: 'Only the overall test.',
        all: 'Every pair of rows.',
        control: 'Each row with one control row.',
      },
    },
    pairwiseControl: { line: 'The row the others are compared with.' },
    pairwiseMethod: {
      line: 'How the pairs’ P values are adjusted for their number.',
      options: {
        bonferroni: {
          line: 'Multiplies each P by the number of pairs.',
          recommended:
            'the pairs share rows, and Bonferroni stays valid whatever the relation between them',
          method: 'bonferroni',
        },
        'holm-sidak': { line: 'Step-down: more power, adjusted P only.', method: 'holmSidak' },
        sidak: { line: 'Splits the error rate equally.', method: 'sidak' },
        none: { line: 'No adjustment: only for one planned pair.', method: 'noCorrection' },
      },
    },
  },
  goodnessOfFit: {
    expectedAs: {
      line: 'Enter what you expect as percentages or as counts.',
      options: {
        percentages: 'Percentages totalling 100 (e.g. 75 and 25 for 3 : 1).',
        counts: 'Counts totalling the number observed.',
      },
    },
    expected: { line: 'The proportion (or count) you expect in each category, set beforehand.' },
    test: {
      line: 'With two categories; more than two always use chi-square.',
      options: {
        binomial: {
          line: 'Exact, for any sample size.',
          recommended: 'it is exact for two categories however small the counts',
          method: 'binomialTest',
        },
        chiSquare: { line: 'An approximation for large counts.', method: 'goodnessOfFit' },
      },
    },
  },
  survival: {
    eventCode: { line: 'The number in Y that means the event happened (usually 1).' },
    censoredCode: { line: 'The number in Y that means censored: event-free when last seen.' },
    ciMethod: SURVIVAL_CI,
  },
  survivalFromVariables: {
    time: { line: 'Time from the start (entry, surgery) to the event or last contact.' },
    status: { line: 'Whether the event happened, or the subject was censored.' },
    groups: { line: 'A curve for each group (each combination of their values).' },
    eventCode: { line: 'For a numeric status: the number that means an event.' },
    censoredCode: { line: 'For a numeric status: the number that means censored.' },
    eventLevel: { line: 'For a text status: the value that means an event (“Died”).' },
    censoredLevel: { line: 'For a text status: the value that means censored; blank = any other.' },
    ciMethod: SURVIVAL_CI,
  },
  multipleRegression: {
    y: { line: 'The measurement you want to predict or explain.' },
    ...MV_COMMON('Y'),
  },
  logisticRegression: {
    y: { line: 'The yes/no outcome, coded 0 (no) and 1 (yes).' },
    ...MV_COMMON('probability'),
    ciMethod: CI_PROFILE,
    cutoff: { line: 'Predicted probabilities above this count as “yes” in the classification.' },
  },
  poissonRegression: {
    y: { line: 'The count (colonies, events) actually counted for each row.' },
    ...MV_COMMON('count'),
    ciMethod: {
      line: 'How the CIs of the rate ratios are computed.',
      options: {
        wald: 'Estimate ± z·SE: the usual choice, rough with small counts.',
        profile: 'From the profile likelihood: more accurate with small counts.',
      },
    },
  },
  coxRegression: {
    time: { line: 'Time from the start to the event or last contact.' },
    event: { line: 'Coded 1 when the event happened, 0 when censored.' },
    ties: {
      line: 'How events at the same time are handled.',
      options: {
        efron: {
          line: 'Efron’s approximation.',
          recommended: 'it is closer to the exact answer than Breslow’s when many times are tied',
        },
        breslow: 'Breslow’s approximation: simpler, slightly biased with many ties.',
      },
    },
    ciMethod: CI_PROFILE,
    survivalCurves: { line: 'Predicted survival curves for predictor values you enter.' },
    baseline: { line: 'The survival curve and hazard with every predictor at 0.' },
  },
  multifactorAnova: {
    y: { line: 'The measurement whose mean the factors may change.' },
    factors: { line: 'The categories that define the groups (genotype, sex, treatment).' },
    interactions: { line: 'Which factors may change each other’s effect.' },
    comparisons: {
      line: 'Which comparisons answer your question, decided before the experiment.',
      options: {
        none: 'Only the ANOVA table.',
        mainEffects: 'Levels of one factor, averaged over the others.',
        simpleEffects: 'Levels of one factor within each level of another.',
        cells: 'Every combination of two factors with every other.',
      },
    },
    compareFactor: { line: 'The factor whose levels are compared.' },
    byFactor: { line: 'The factor within whose levels the comparisons are made.' },
    method: {
      line: 'How the P values are adjusted for the number of comparisons.',
      options: {
        tukey: {
          line: 'Every pair, with adjusted P values and simultaneous CIs.',
          recommended:
            'made for comparing every pair of means, with CIs that cover them all together',
          method: 'tukey',
        },
        sidak: { line: 'Splits the error rate among the comparisons.', method: 'sidak' },
        bonferroni: {
          line: 'Multiplies each P by the number of comparisons.',
          method: 'bonferroni',
        },
        'holm-sidak': { line: 'Step-down: more power, adjusted P only.', method: 'holmSidak' },
        fisher: { line: 'No adjustment: only for one planned comparison.', method: 'fisherLsd' },
      },
    },
    family: {
      line: 'Which comparisons are adjusted together.',
      options: {
        perLevel: 'Each level of the other factor is its own family.',
        all: 'All comparisons as one family: fewer false positives, less power.',
      },
    },
  },
  pca: {
    standardize: {
      line: 'Recommended when variables are in different units: each then counts equally.',
    },
    select: {
      line: 'How many components to keep.',
      options: {
        parallel: {
          line: 'Those explaining more than random data would.',
          recommended:
            'it keeps only components that stand out from noise, where Kaiser’s rule keeps too many',
        },
        kaiser: 'Those with eigenvalue above 1 (often too many).',
        variance: 'Enough to explain a share of the variation you set.',
        fixed: 'A number you choose.',
      },
    },
    variancePercent: { line: 'The share of the total variation the kept components explain.' },
    components: { line: 'How many components to keep.' },
    simulations: { line: 'Random data sets for parallel analysis: more, steadier.' },
    seed: { line: 'The same seed gives the same parallel analysis each time.' },
    loadingsPlot: { line: 'How much each variable contributes to the first two components.' },
    biplot: { line: 'Subjects and variables on one plot of the first two components.' },
    pcr: {
      line: 'Predict an outcome from the kept components (left out of the PCA).',
    },
    pcrY: { line: 'The outcome the components predict.' },
    groupBy: {
      line: 'A text variable (left out of the PCA) that colours the groups on the plots.',
    },
    ellipses: { line: 'A 95% ellipse around each group on the score plot and biplot.' },
  },
  powerAnalysis: {
    design: {
      line: 'The analysis you plan to run.',
      options: {
        unpairedT: 'Two groups of different subjects.',
        pairedT: 'Two measurements of the same subjects.',
        oneSampleT: 'One group against a set value.',
        anova: 'Three or more groups of different subjects.',
        proportions: 'Two groups, a yes/no outcome.',
        correlation: 'Two measurements on the same subjects.',
        logRank: 'Two survival curves.',
      },
    },
    solveFor: {
      line: 'The sample size you need, or the power of a sample size.',
      options: {
        n: 'How many subjects for the power you want.',
        power: 'How likely a given n is to detect the effect.',
      },
    },
    power: { line: 'The chance of detecting the effect if it is real (0.8 is usual).' },
    n: { line: 'Subjects per group (or pairs, values, events).' },
    alpha: { line: 'The P below which you will call a result significant (0.05 is usual).' },
    fromData: {
      line: 'Use the selected columns as pilot data (pilot effects usually overestimate).',
    },
    difference: { line: 'The smallest difference that matters biologically.' },
    sd: { line: 'The scatter you expect, from earlier experiments.' },
    groups: { line: 'How many groups the ANOVA will compare.' },
    anovaInput: {
      line: 'How you state the effect for an ANOVA.',
      options: {
        variances: 'The variance of the group means and within groups.',
        cohensF: 'Cohen’s f, a standardized effect size.',
      },
    },
    betweenVar: { line: 'How much the group means you expect vary.' },
    withinVar: { line: 'How much values vary within a group.' },
    cohensF: { line: 'The ratio of the SD of the means to the SD within groups.' },
    p1: { line: 'The proportion with the outcome you expect in the first group.' },
    p2: { line: 'The proportion you expect in the second group.' },
    r: { line: 'The smallest correlation that would matter.' },
    hazardRatio: { line: 'The smallest hazard ratio that would matter (0.5 halves the rate).' },
    eventProbability: { line: 'The chance a subject has the event during the study.' },
  },
}
