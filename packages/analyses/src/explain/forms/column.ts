import type { FormText } from './types.ts'

// Roadmap 51a: the text of the column analyses' forms (design §2.6 for the t test); roadmap 51c:
// true of its defaults (Welch's t test, the direction of a one-tailed test, exact
// Kruskal-Wallis P, Dunn's comparisons by Holm, one normality test and the QQ plot).

const COMPARISONS_LINE = 'Which comparisons answer your question, decided before the experiment.'

export const COLUMN_TEXT: Readonly<Record<string, FormText>> = {
  descriptive: {
    quartiles: { line: 'The five-number summary: smallest, quartiles, median and largest values.' },
    ci: { line: 'The range of true means compatible with your data, at the level below.' },
    cv: { line: 'SD as a percentage of the mean: scatter relative to size.' },
    geometric: {
      line: 'The centre of values that change by a factor (concentrations, titres).',
    },
    moments: { line: 'How lopsided (skewness) and heavy-tailed (kurtosis) the values are.' },
    sum: { line: 'The total of each data set.' },
  },
  normality: {
    distribution: {
      line: 'Test the values as they are, their logarithms, or both.',
      options: {
        normal: 'Is there evidence the values aren’t normal?',
        lognormal: 'Is there evidence their logarithms aren’t normal?',
        both: 'Both: the values and their logarithms.',
      },
    },
    dagostino: {
      line: 'Combines skewness and kurtosis; needs at least 8 values.',
    },
    andersonDarling: { line: 'Weighs the tails of the distribution more than the others.' },
    shapiroWilk: {
      line: 'The most widely used test, with good power at small n (the one on by default).',
      card: 'A test of normality says whether there is evidence against a normal distribution. With few values it rarely finds any (which doesn’t show the data are normal); with many it flags trivial departures. Choose between a t test and a rank test from what you measure, not from this test.',
    },
    kolmogorovSmirnov: {
      line: 'The oldest test, with little power; kept for comparison with older work.',
    },
    qqPlot: {
      line: 'Each value against where a normal distribution would put it (on by default).',
      card: 'A QQ plot shows how the values depart from normal (curved: skewed; S-shaped: heavy tails), which a P value can’t. With few values the tests have little power, so the plot says more.',
    },
  },
  oneSample: {
    test: {
      line: 'Compare the mean of measurements, or the median of scores.',
      options: {
        t: { line: 'For roughly symmetric measurements.', method: 'oneSampleT' },
        wilcoxon: { line: 'For scores or very skewed values.', method: 'oneSampleWilcoxon' },
      },
    },
    predicted: {
      line: 'Whether you predicted the values above or below the hypothetical value.',
      options: {
        increase: 'Above the hypothetical value.',
        decrease: 'Below the hypothetical value.',
      },
    },
    hypothetical: {
      line: 'The value you expect if nothing happened, e.g. 100 for % of control.',
      card: 'Choose it before the experiment: 100 for values normalized to a control, 1 for ratios, 0 for differences. Testing a control normalized to exactly 100 is meaningless (it has no variation): compare the other groups with 100 instead.',
    },
  },
  ttest: {
    design: {
      line: 'Pairing is decided by how the experiment was done, not by the data.',
      card: 'Paired: each row is one subject, plate or day measured in both groups (before and after, two treatments on the same culture). Unpaired: different subjects in each group. Pairing removes subject-to-subject variation, so a paired test is usually more powerful, but only when the pairs are real.',
      options: {
        unpaired: 'Different subjects in each group.',
        paired: 'Each row is one subject, plate or day: its two values are compared.',
      },
    },
    'unpaired.assumeEqualSD': {
      line: 'A treatment often changes how much values vary, not only their mean.',
      card: 'Welch’s t test doesn’t assume the two groups vary by the same amount; it protects P when they don’t and costs almost nothing when they do. Student’s t test pools the two SDs: choose it only with a reason, such as a validated assay whose scatter doesn’t depend on the treatment. Decide from the experiment, not from a test of the SDs.',
      options: {
        false: {
          line: 'Welch’s t test: each group keeps its own SD.',
          recommended:
            'it protects P when scatter differs and costs almost nothing when it doesn’t',
          method: 'welchT',
        },
        true: {
          line: 'Student’s t test: only with a reason, e.g. a validated assay.',
          method: 'studentT',
        },
      },
    },
    'paired.measure': {
      line: 'Concentrations and fold changes usually change by a factor.',
      options: {
        difference: { line: 'The paired t test of the differences.', method: 'pairedT' },
        ratio: {
          line: 'Each subject’s value is multiplied: the ratio paired t test.',
          method: 'ratioPairedT',
        },
      },
    },
    reportFTestVariances: {
      line: 'An F test of the two SDs, for information; it doesn’t choose the test.',
      card: 'The results always show the ratio of the two SDs, as a description. Choosing between Student’s and Welch’s t test from an F test on the same data is a two-step procedure with worse error control than Welch’s test alone, and the F test is very sensitive to non-normal data.',
    },
    predicted: {
      line: 'Which group you predicted to be higher, before seeing the data.',
      options: {
        increase: 'The second group higher than the first.',
        decrease: 'The second group lower than the first.',
      },
    },
  },
  mannWhitney: {
    predicted: {
      line: 'Which group you predicted to have larger values, before seeing the data.',
      options: {
        increase: 'Values in the second group tend to be larger.',
        decrease: 'Values in the second group tend to be smaller.',
      },
    },
  },
  kolmogorovSmirnov: {},
  wilcoxon: {
    predicted: {
      line: 'Which direction you predicted for the differences within pairs.',
      options: {
        increase: 'The second value of each pair tends to be larger.',
        decrease: 'The second value of each pair tends to be smaller.',
      },
    },
    zeroHandling: {
      line: 'Pairs whose two values are equal: drop them, or rank them as zeros.',
      options: {
        wilcoxon: 'Leaves them out (the classic test).',
        pratt: 'Keeps them in the ranking; better with many ties at zero.',
      },
    },
  },
  oneWayAnova: {
    matched: {
      line: 'Were the same subjects measured in every group? Decided by the design.',
      card: 'Matched: each row is one subject (animal, donor, culture, experiment day) with a value in every group, as in a time course. Not matched: different subjects in each group.',
      options: {
        false: 'Different subjects in each group.',
        true: 'Each row is one subject measured in every group (repeated measures).',
      },
    },
    gaussian: {
      line: 'Measurements, or scores and ranks? Decided by what you measured.',
      card: 'ANOVA compares means of measurements. For scores (0–4 histology), ranks, or values you can’t make symmetric, a rank test asks whether values tend to be larger in some groups. Decide from what you measured, not from a normality test.',
      options: {
        true: 'Measurements: compare the means by ANOVA.',
        false: 'Scores or ranks: Kruskal-Wallis (Friedman if matched).',
      },
    },
    comparisons: {
      line: COMPARISONS_LINE,
      card: 'Every pair compares all groups with each other (Tukey); each with a control makes fewer comparisons and so has more power (Dunnett). The comparisons don’t need the overall ANOVA P below 0.05 first.',
      options: {
        allPairs: 'Every pair of groups.',
        vsControl: 'Each group with one control group.',
        trend: {
          line: 'A steady rise or fall across the groups in their order.',
          method: 'linearTrend',
        },
        none: 'Only whether any group differs (the overall test).',
      },
    },
    sphericity: {
      line: 'Do the differences between any two conditions vary about equally?',
      card: 'Repeated measures assume sphericity: the differences between any two conditions have about the same scatter. Time courses usually break it. The Geisser-Greenhouse correction keeps P honest. With missing values a mixed-effects model is fit, which assumes sphericity, so the question doesn’t apply then.',
    },
  },
  friedman: {
    comparisons: {
      line: COMPARISONS_LINE,
      options: {
        none: 'Only whether any condition differs.',
        allPairs: 'Every pair of conditions, by their rank sums.',
        vsControl: 'Each condition with one control.',
      },
    },
    correction: {
      line: 'How Dunn’s comparisons of the rank sums are adjusted for their number.',
      options: {
        holm: {
          line: 'Step-down: more power than Bonferroni, the same protection.',
          recommended:
            'it keeps the chance of any false positive at 5% with more power than Bonferroni',
          method: 'dunn',
        },
        sidak: { line: 'Splits the error rate among the comparisons.', method: 'dunn' },
        bonferroni: {
          line: 'Multiplies each P by the number of comparisons (before 0.3.9: “Dunn’s test”).',
          method: 'dunn',
        },
        none: {
          line: 'Each comparison unadjusted: only for one planned comparison.',
          method: 'noCorrection',
        },
      },
    },
  },
  nestedT: {
    predicted: {
      line: 'Which group you predicted to be higher, before seeing the data.',
      options: {
        increase: 'The second group higher than the first.',
        decrease: 'The second group lower than the first.',
      },
    },
  },
  nestedOneWay: {
    comparisons: {
      line: COMPARISONS_LINE,
      options: {
        allPairs: 'Every pair of groups.',
        vsControl: 'Each group with one control group.',
        none: 'Only whether any group differs.',
      },
    },
  },
  roc: {
    direction: {
      line: 'Say before looking whether patients have higher or lower values (required).',
      card: 'Deciding the direction from the data makes the area at least 0.5 by construction, so it overstates how well the marker separates the groups. Choose higher or lower from what you know about the marker. Curves saved before 0.3.9 that decided it from the data keep doing so, with a warning.',
      options: {
        higher: 'Patients have higher values than controls.',
        lower: 'Patients have lower values than controls.',
      },
    },
    ciMethod: {
      line: 'How the CIs of sensitivity and specificity are computed.',
      options: {
        clopperPearson: 'Exact (conservative): the intervals are at least as wide as needed.',
        wilsonBrown: 'Wilson/Brown: closer to the stated level, a little narrower.',
      },
    },
  },
  blandAltman: {
    measure: {
      line: 'Plot differences in your units, ratios, or percent differences.',
      options: {
        difference: 'When the differences are about the same size across the range.',
        ratio: 'When the differences grow with the size of the values.',
        percent: 'Differences as a percentage of the average of the two methods.',
      },
    },
    order: {
      line: 'Which method is subtracted from which (the sign of the bias).',
      options: {
        aMinusB: 'The first method minus the second.',
        bMinusA: 'The second method minus the first.',
      },
    },
  },
  identifyOutliers: {
    method: {
      line: 'Remove a value only with a known cause; report results with and without it.',
      card: 'Outlier tests flag values far from the rest. Removing them because a test flags them, then testing, makes P too small. Use them to find values to check (a pipetting error, a failed well), and report the analysis with and without them. Every analysis of the cleaned table says how many values were removed.',
      options: {
        rout: {
          line: 'Finds one or more outliers, controlling false discoveries.',
          recommended: 'it can find several outliers, where Grubbs’ finds at most one',
          method: 'rout',
        },
        grubbs: { line: 'At most one outlier, in roughly normal values.', method: 'grubbs' },
        grubbsIterative: { line: 'Grubbs’ repeated after each removal.', method: 'grubbs' },
      },
    },
    q: {
      line: 'The share of flagged values you accept as wrongly flagged.',
      options: {
        '0.1': 'Flags only very clear outliers.',
        '0.5': 'Between 0.1% and 1%.',
        '1': {
          line: 'Flags few good values.',
          recommended: 'it balances finding real outliers against flagging good values',
        },
        '5': 'Flags more values, more of them wrongly.',
        '10': 'Flags many values; for exploring only.',
      },
    },
    alpha: {
      line: 'The chance of flagging a value when there is no outlier.',
      options: {
        '0.0001': 'Very strict.',
        '0.001': 'Strict.',
        '0.01': 'Moderate.',
        '0.05': 'The usual level.',
        '0.1': 'Lenient: flags more values wrongly.',
      },
    },
  },
  frequencyDistribution: {
    tabulate: {
      line: 'Count the values in each bin, or show their share of the total.',
      options: {
        counts: 'The number of values in each bin.',
        relativePercent: 'Each bin’s share as a percentage.',
        relativeFraction: 'Each bin’s share as a fraction.',
      },
    },
    cumulative: { line: 'Running totals: how many values are at or below each bin.' },
    autoBinWidth: { line: 'Choose the bin width from the data.' },
    binWidth: { line: 'The width of every bin, in the data’s units.' },
    autoFirstCenter: { line: 'Choose where the first bin is centred from the data.' },
    firstCenter: { line: 'The centre of the first bin.' },
    useUpperLimit: { line: 'Leave out values above a limit you set.' },
    upperLimit: { line: 'Values above this are left out.' },
    replicates: {
      line: 'Bin every replicate, or only each row’s mean.',
      options: {
        each: 'Each replicate in its bin.',
        mean: 'The mean of each row’s replicates.',
      },
    },
  },
  correlation: {
    method: {
      line: 'A straight-line association, or any steady rise or fall?',
      options: {
        pearson: { line: 'Straight-line association of measurements.', method: 'pearson' },
        spearman: {
          line: 'Rank association: curved but steady, ranks, or outliers.',
          method: 'spearman',
        },
      },
    },
    correction: {
      line: 'With several pairs, some P values are small by chance: correct for their number.',
      card: 'Correlating every pair of several columns makes many tests. The false discovery rate (Benjamini-Hochberg) keeps the share of false findings low; Holm keeps the chance of any false positive low. With one pair there is nothing to correct. r describes association, not agreement: Bland-Altman checks whether two methods agree.',
      options: {
        fdr: {
          line: 'q values: of the pairs called significant, about 5% are expected false.',
          recommended: 'with many pairs it keeps power while limiting false findings',
          method: 'fdrBh',
        },
        holm: {
          line: 'The chance of any false positive among the pairs stays at 5%.',
          method: 'holm',
        },
        none: {
          line: 'Each pair on its own: about 1 in 20 is below 0.05 by chance.',
          method: 'noCorrection',
        },
      },
    },
    predicted: {
      line: 'Whether you predicted a positive or a negative correlation, before the data.',
      options: {
        increase: 'The two variables rise together.',
        decrease: 'One falls as the other rises.',
      },
    },
  },
  pStack: {
    approach: {
      line: 'Control the share of false discoveries, or the chance of any false positive.',
      card: 'With many P values some are small by chance. A false discovery rate keeps the share of false discoveries low (for screening, with follow-up). A family-wise method keeps the chance of any false positive low (when every claim matters).',
      options: {
        fdr: {
          line: 'Discoveries with a controlled share of false ones.',
          recommended: 'with many P values it keeps power while limiting false discoveries',
        },
        significance: 'Keep the chance of any false positive below alpha.',
        none: {
          line: 'Each P on its own: about 1 in 20 is below 0.05 by chance.',
          method: 'noCorrection',
        },
      },
    },
    fdrMethod: {
      line: 'Which false discovery rate method.',
      options: {
        bky: {
          line: 'Two-stage: more power with the same guarantee.',
          recommended: 'it has more power than Benjamini-Hochberg with the same guarantee',
          method: 'fdr',
        },
        bh: {
          line: 'The most widely used method; the two-stage one has more power.',
          method: 'fdrBh',
        },
        by: {
          line: 'Valid whatever the relation between the tests; conservative.',
          method: 'fdrBy',
        },
      },
    },
    q: {
      line: 'The share of discoveries you accept as false, in percent (5% by default).',
      card: 'Q = 5% means that of the rows called discoveries, about 5% are expected to be false: the level usual in screens. Work saved before 0.3.9, when the default was 1%, keep theirs.',
    },
    sigMethod: {
      line: 'Which family-wise method.',
      options: {
        'holm-sidak': {
          line: 'Step-down: the most power of these three.',
          recommended: 'it has more power than Šidák or Bonferroni with the same guarantee',
          method: 'holmSidak',
        },
        sidak: { line: 'Splits the error rate equally.', method: 'sidak' },
        bonferroni: { line: 'Multiplies each P by the number of tests.', method: 'bonferroni' },
      },
    },
    alpha: { line: 'The chance of a false positive you accept, in percent (5%).' },
  },
}
