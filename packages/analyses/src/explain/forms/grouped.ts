import type { FormText } from './types.ts'

// Roadmap 51a: the text of the grouped tables' analyses; roadmap 51c: the rows of multiple
// one-way ANOVAs corrected (FDR, Benjamini-Hochberg, by default), Q = 5%, the RM method and df.

const FDR_METHOD = {
  line: 'Which false discovery rate method.',
  options: {
    bky: {
      line: 'Two-stage: more power with the same guarantee.',
      recommended: 'it has more power than Benjamini-Hochberg with the same guarantee',
      method: 'fdr',
    },
    bh: { line: 'The most widely used method; the two-stage one has more power.', method: 'fdrBh' },
    by: { line: 'Valid whatever the relation between the rows; conservative.', method: 'fdrBy' },
  },
} as const

const Q_TEXT = {
  line: 'The share of discoveries you accept as false, in percent (5% by default).',
  card: 'Q = 5% means that of the rows called discoveries, about 5% are expected to be false: the level usual in screens. Work saved before 0.3.9, when the default was 1%, keep theirs.',
} as const

const SIG_METHOD = {
  line: 'Which family-wise method.',
  options: {
    'holm-sidak': {
      line: 'Step-down: the most power of these three.',
      recommended: 'it has more power than Šidák or Bonferroni with the same guarantee',
      method: 'holmSidak',
    },
    sidak: { line: 'Splits the error rate equally among the rows.', method: 'sidak' },
    bonferroni: { line: 'Multiplies each P by the number of rows.', method: 'bonferroni' },
  },
} as const

const ALPHA_TEXT = { line: 'The chance of a false positive you accept, in percent (5%).' } as const

export const GROUPED_TEXT = {
  twoWayAnova: {
    repeated: {
      line: 'Were the same subjects measured across one of the factors?',
      card: 'Rows are one factor, data sets (columns) the other. Repeated across columns: subject i is replicate i of every column (a subject’s values run along a row). Repeated across rows: a subject’s values run down a subcolumn (a time course in the rows). Decided by the design.',
      options: {
        none: 'A different subject in every cell.',
        columns: 'The same subject across the columns (its values along a row).',
        rows: 'The same subject across the rows (a time course down a subcolumn).',
        both: 'The same subject in every cell.',
      },
    },
    interaction: {
      line: 'Test whether one factor changes the effect of the other.',
      options: {
        true: 'Row and column effects and their interaction.',
        false: 'Assume no interaction (needed with one value per cell).',
      },
    },
    comparisons: {
      line: 'Which comparisons answer your question, decided before the experiment.',
      card: 'Within each row compares the columns separately at every row (simple effects): what you usually want when the factors interact. Main effects average over the other factor, which misleads when the interaction is large.',
      options: {
        withinRows: 'At each row, compare the columns (each row its own question).',
        withinColumns: 'In each column, compare the rows.',
        allCells: 'Every cell with every other: many comparisons, little power.',
        mainColumns: 'Column means averaged over rows (only if no interaction is expected).',
        mainRows: 'Row means averaged over columns (only if no interaction is expected).',
        none: 'Only the overall effects.',
      },
    },
    kind: {
      line: 'Every pair, or each with a control?',
      options: {
        allPairs: 'Every mean with every other.',
        vsControl: 'Each mean with the first (the control).',
      },
    },
    family: {
      line: 'Which comparisons are adjusted together.',
      options: {
        perBlock: {
          line: 'Each row (or column) is its own family of comparisons.',
          recommended:
            'each row asks its own question, so its comparisons are adjusted only for each other',
        },
        all: 'All comparisons as one family: fewer false positives, less power.',
      },
    },
    allPairsMethod: {
      line: 'How the P values of the pairs are adjusted for their number.',
      card: 'Tukey compares every pair of means within a family; Šidák suits a few planned comparisons (two-way ANOVA within rows with few columns), which is why it is the starting choice here.',
    },
    sphericity: {
      line: 'Do the differences between any two levels of the repeated factor vary alike?',
      card: 'The Geisser-Greenhouse correction keeps P honest when they don’t (time courses). Main-effect comparisons of a repeated factor then use each comparison’s own error term. With missing values a mixed-effects model is fit, which assumes sphericity, so the question doesn’t apply then.',
    },
  },
  multipleT: {
    design: {
      line: 'Pairing is decided by how the experiment was done, not by the data.',
      options: {
        unpaired: 'Different subjects in each group.',
        paired: 'Replicate i of both data sets is the same subject.',
      },
    },
    distribution: {
      line: 'Measurements, values that change by a factor, or scores?',
      options: {
        gaussian: 'Measurements roughly symmetric in each row: t tests.',
        lognormal: 'Values that change by a factor: t tests of the logarithms.',
        nonparametric: 'Scores or skewed values: rank tests.',
      },
    },
    variance: {
      line: 'Can the two groups vary by different amounts in a row?',
      options: {
        welch: {
          line: 'Welch’s t test in each row: each group its own scatter.',
          recommended:
            'it protects P when scatter differs and costs almost nothing when it doesn’t',
          method: 'welchT',
        },
        individual: {
          line: 'Student’s t test in each row (equal scatter in a row).',
          method: 'studentT',
        },
        consistent: {
          line: 'One pooled SD for all rows: more power, if every row scatters alike.',
          method: 'studentT',
        },
      },
    },
    rankTest: {
      line: 'Which rank test for unpaired rows.',
      options: {
        mannWhitney: { line: 'Do values in one group tend to be larger?', method: 'mannWhitney' },
        kolmogorovSmirnov: {
          line: 'Any difference in shape; little power for a shift.',
          method: 'kolmogorovSmirnov',
        },
      },
    },
    approach: {
      line: 'With many rows, some P values are small by chance.',
      card: 'A false discovery rate keeps the share of false discoveries among the rows called discoveries low: for screening (genes, proteins) with follow-up. A family-wise method keeps the chance of any false positive low: when every claim matters.',
      options: {
        fdr: {
          line: 'Discoveries with a controlled share of false ones.',
          recommended: 'for many rows it keeps power while limiting false discoveries',
        },
        significance: 'Keep the chance of any false positive among the rows below alpha.',
        none: {
          line: 'Each row on its own: about 1 in 20 has P < 0.05 by chance.',
          method: 'noCorrection',
        },
      },
    },
    fdrMethod: FDR_METHOD,
    q: Q_TEXT,
    sigMethod: SIG_METHOD,
    alpha: ALPHA_TEXT,
    difference: {
      line: 'Which data set is subtracted from which (the sign of each difference).',
      options: {
        aMinusB: 'The first data set minus the second.',
        bMinusA: 'The second data set minus the first.',
      },
    },
    reportLogP: { line: 'Add −log10(P) to the results, as the volcano plot uses.' },
  },
  multipleOneWay: {
    gaussian: {
      line: 'Measurements, or scores and ranks? Decided by what you measured.',
      options: {
        true: 'Measurements: an ANOVA in each row.',
        false: 'Scores or ranks: Kruskal-Wallis in each row.',
      },
    },
    comparisons: {
      line: 'Which comparisons within each row, each row its own family.',
      card: 'The comparisons are adjusted within each row. The rows’ own P values are corrected across rows separately (below).',
      options: {
        allPairs: 'Every pair of groups in each row.',
        vsControl: 'Each group with one control, in each row.',
        none: 'Only whether any group differs in each row.',
      },
    },
    approach: {
      line: 'With many rows, some ANOVAs are significant by chance: correct for their number.',
      card: 'Twenty rows tested at 5% give about one significant row by chance. A false discovery rate (Benjamini-Hochberg by default) keeps the share of false discoveries among the rows low; a family-wise method keeps the chance of any false positive low. Work saved before 0.3.9 didn’t correct across rows, and keep that.',
      options: {
        fdr: {
          line: 'Discoveries among the rows, with a controlled share of false ones.',
          recommended: 'for many rows it keeps power while limiting false discoveries',
        },
        significance: 'Keep the chance of any false positive among the rows below alpha.',
        none: {
          line: 'Each row on its own: about 1 in 20 has P < 0.05 by chance.',
          method: 'noCorrection',
        },
      },
    },
    fdrMethod: FDR_METHOD,
    q: Q_TEXT,
    sigMethod: SIG_METHOD,
    alpha: ALPHA_TEXT,
  },
  threeWayAnova: {
    comparisons: {
      line: 'Which cell means to compare, decided before the experiment.',
      options: {
        none: 'Only the main effects and interactions.',
        allCells: 'Every cell with every other: many comparisons, little power.',
        vsControl: 'The first cell (the control) with each other cell.',
        oneFactor: 'Only cells that differ in one factor: fewer, more meaningful comparisons.',
      },
    },
    allPairsMethod: { line: 'How the P values of every pair of cells are adjusted.' },
    repeatedRows: { line: 'Each subcolumn is one subject measured in every row (time).' },
    repeatedCol1: { line: 'The same subjects in A and C, and in B and D.' },
    repeatedCol2: { line: 'The same subjects in A and B, and in C and D.' },
    rmMethod: {
      line: 'How repeated measures are analyzed when values are missing.',
      options: {
        auto: 'Repeated-measures ANOVA, or a mixed-effects model when values are missing.',
        anova: 'Repeated-measures ANOVA always, on the subjects with every value.',
        mixed: 'A mixed-effects model, which uses every value.',
      },
    },
  },
  rowStats: {
    scope: {
      line: 'Summarize each data set’s replicates, or all values in a row.',
      options: {
        perDataSet: 'The replicates of each data set, row by row.',
        allDataSets: 'Every value in the row, across data sets.',
      },
    },
    sd: { line: 'The scatter of the values in each row.' },
    sem: { line: 'How precisely each row’s mean is known.' },
    n: { line: 'How many values each row has.' },
    ci: { line: 'The range of true means compatible with the values.' },
    sum: { line: 'The total of each row.' },
    minMax: { line: 'The smallest and largest value of each row.' },
    median: { line: 'The middle value of each row.' },
  },
} satisfies Readonly<Record<string, FormText>>
