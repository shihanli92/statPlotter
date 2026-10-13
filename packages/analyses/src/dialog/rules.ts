import type {
  AnalysisDef,
  Condition,
  FieldTier,
  FormField,
  FormOption,
  ShowIf,
  Unavailable,
} from '@ps/model'

// Roadmap 51b (design §4.2, §4.4): the Analyze dialog's words, tiers and conditions, written by
// analysis and field path in one place and attached to the definitions' forms when the registry
// is built (as the explanations are, decision 1277): the questions in the experiment's words
// (§4.2), every field's tier, and every invalid combination the reviews found (§4.4's table,
// `INVALID_COMBINATIONS`) hidden or greyed with its reason.

/** A change to every field of an analysis at a path. */
export interface FieldPatch {
  label?: string
  options?: Readonly<Record<string, { label?: string; unavailable?: readonly Unavailable[] }>>
  tier?: FieldTier
  appliesTo?: readonly Condition[]
  unavailable?: readonly Unavailable[]
  /** Replaces the field's `showIf` (null: shown always). */
  showIf?: ShowIf | readonly ShowIf[] | null
}

const p = (path: string, ...values: unknown[]): ShowIf => ({ path: path.split('.'), in: values })

// --- Reasons (§4.4) ------------------------------------------------------------------------------

export const NEEDS_RAW = 'Needs the raw values, not mean/SD/N.'
const NOT_WITH_RM = 'Not with repeated measures.'
const TREND_MATCHED = 'Not with matched rows: the trend test uses the ordinary ANOVA’s error term.'
const TREND_RANKS = 'Not with ranks.'
const TREND_SCATTER = 'Needs similar scatter (ordinary ANOVA).'
const ALL_CELLS_RM = 'Not with repeated measures: needs a pooled error term.'
const FAMILY_ALL =
  'Tukey and Dunnett adjust within one row; choose Šidák, Bonferroni or Holm-Šidák to adjust across rows.'
const ONE_PER_CELL = 'One value per cell: the interaction can’t be estimated.'
const THREE_WAY_RM = 'Not yet available with repeated measures.'
const TWO_FACTORS = 'Needs two factors.'
const THROUGH_ORIGIN = 'Not with the line forced through the origin.'
const ROBUST = 'Robust fits give best-fit values only.'
/** §4.4 row 22 (51e). */
export const NOT_NESTED = 'These models aren’t nested; compare them by AICc.'
const notNested: Unavailable = { when: [{ fact: 'modelsNested', is: false }], reason: NOT_NESTED }
const comparing: Condition = { fact: 'modelComparison', is: true }

const anyRepeated3: Condition = {
  anyOf: [p('repeatedRows', true), p('repeatedCol1', true), p('repeatedCol2', true)],
}
const rawOnly: Unavailable = { when: [{ fact: 'raw', is: false }], reason: NEEDS_RAW }
const twoByTwo: Condition = { fact: 'twoByTwo', is: true }
const threeGroups: Condition = { fact: 'groups', atLeast: 3 }
const NEEDS_X = 'Needs X values (an XY table).'
const noX: Unavailable = { when: [{ fact: 'hasX', is: false }], reason: NEEDS_X }
const hasX: Condition = { fact: 'hasX', is: true }
/** Transform's functions of X and Y. */
const USES_X = ['xDivY', 'yDivX', 'yMinusX', 'yPlusX', 'yTimesX', 'xMinusY']

/**
 * §4.4's table: each invalid combination and the patch preventing it (rows 5 and 9 are
 * elsewhere: 5's sphericity reason came with 51c, `unavailableIf`; 9 was fixed in 51c; 22 came
 * with 51e's nested-model metadata, `explain/equations.ts`). `refused`: `run` still returns a failure for the combination (the
 * guard stays for files and scripts).
 */
export const INVALID_COMBINATIONS: readonly {
  row: number
  analysis: string
  what: string
  refused: boolean
}[] = [
  { row: 1, analysis: 'oneWayAnova', what: 'trend with matched rows', refused: true },
  { row: 2, analysis: 'oneWayAnova', what: 'trend with scores (Kruskal-Wallis)', refused: true },
  { row: 3, analysis: 'oneWayAnova', what: 'trend with Welch or Brown-Forsythe', refused: true },
  { row: 4, analysis: 'oneWayAnova', what: 'Newman-Keuls with matched rows', refused: true },
  { row: 5, analysis: 'oneWayAnova', what: 'sphericity with missing values', refused: false },
  {
    row: 6,
    analysis: 'oneWayAnova',
    what: 'Welch’s methods labelled for each with a control',
    refused: false,
  },
  { row: 7, analysis: 'twoWayAnova', what: 'RM: compare every cell', refused: true },
  { row: 8, analysis: 'twoWayAnova', what: 'RM: Newman-Keuls', refused: true },
  {
    row: 10,
    analysis: 'twoWayAnova',
    what: 'Tukey or Dunnett with one family for all',
    refused: false,
  },
  { row: 11, analysis: 'twoWayAnova', what: 'full model with one value per cell', refused: true },
  {
    row: 12,
    analysis: 'threeWayAnova',
    what: 'RM method when nothing is repeated',
    refused: false,
  },
  {
    row: 13,
    analysis: 'threeWayAnova',
    what: 'comparisons with repeated measures',
    refused: false,
  },
  {
    row: 14,
    analysis: 'multifactorAnova',
    what: 'simple effects or cells with one factor',
    refused: true,
  },
  {
    row: 15,
    analysis: 'contingency',
    what: 'one-tailed, RR, NNT, OR, sensitivity on larger tables',
    refused: false,
  },
  {
    row: 16,
    analysis: 'contingency',
    what: 'trend on a 2 × 2 or with more outcome columns',
    refused: false,
  },
  {
    row: 17,
    analysis: 'linearRegression',
    what: 'compare slopes with one data set',
    refused: false,
  },
  {
    row: 18,
    analysis: 'linearRegression',
    what: 'through the origin and through a point',
    refused: false,
  },
  { row: 19, analysis: 'ttest', what: 'paired, rank and RM tests on mean/SD/N', refused: true },
  { row: 20, analysis: 'ttest', what: 'ratio paired t with values ≤ 0', refused: true },
  {
    row: 21,
    analysis: 'nonlinearFit',
    what: 'model comparison with robust regression',
    refused: false,
  },
  {
    row: 22,
    analysis: 'nonlinearFit',
    what: 'F test between models that aren’t nested',
    refused: false,
  },
  { row: 23, analysis: 'survival', what: 'trend with two groups', refused: false },
  { row: 24, analysis: 'survival', what: 'pairwise comparisons with two groups', refused: false },
  {
    row: 25,
    analysis: 'multipleT',
    what: 'Kolmogorov-Smirnov beside Mann-Whitney',
    refused: false,
  },
  { row: 26, analysis: 'multipleOneWay', what: 'Kruskal-Wallis on summary data', refused: true },
  { row: 27, analysis: 'ttest', what: 'one-tailed P with no stated direction', refused: true },
  { row: 28, analysis: 'roc', what: 'ROC with no stated direction', refused: true },
]

// --- Tiers (§4.2) ----------------------------------------------------------------------------

/** The tier of a path in every analysis, unless the analysis says otherwise. */
const SHARED_TIERS: Readonly<Record<string, FieldTier>> = {
  confidenceLevel: 'reporting',
  differenceAs: 'reporting',
  reportFTestVariances: 'reporting',
  reportEqualSdTests: 'reporting',
  reportLogP: 'reporting',
  band: 'reporting',
  'diagnostics.residuals': 'reporting',
  'diagnostics.runsTest': 'reporting',
  'diagnostics.replicatesTest': 'reporting',
  'diagnostics.normality': 'reporting',
  weightingTest: 'reporting',
  hougaard: 'reporting',
  covariance: 'reporting',
  effectSize: 'reporting',
  riskEstimates: 'reporting',
  oddsRatio: 'reporting',
  diagnostic: 'reporting',
  qqPlot: 'reporting',
  predictions: 'reporting',
  survivalCurves: 'reporting',
  baseline: 'reporting',
  tails: 'advanced',
  predicted: 'advanced',
  pMethod: 'advanced',
  kwPMethod: 'advanced',
  ddf: 'advanced',
  sphericity: 'advanced',
  rmMethod: 'advanced',
  allPairsMethod: 'advanced',
  controlMethod: 'advanced',
  welchMethod: 'advanced',
  oneFactorMethod: 'advanced',
  dunnMethod: 'advanced',
  zeroHandling: 'advanced',
  fdrMethod: 'advanced',
  sigMethod: 'advanced',
  yates: 'advanced',
  pairwiseMethod: 'advanced',
  ties: 'advanced',
  referenceRule: 'advanced',
  referenceLevels: 'advanced',
  intercept: 'advanced',
  ciMethod: 'advanced',
  seed: 'advanced',
}

/**
 * Roadmap 51e (§9.4, S18): how a curve fit's comparison is decided, asked with the comparison
 * (Essentials) and only when one is asked for; the F test greyed for models that aren't nested
 * (§4.4 row 22).
 */
const COMPARE_BY: FieldPatch = {
  tier: 'essentials',
  label: 'How will you decide between the two fits?',
  appliesTo: [comparing],
  options: { fTest: { unavailable: [notNested] } },
}

/** Each analysis' own words, tiers and conditions, by path. */
export const DIALOG_PATCHES: Readonly<Record<string, Readonly<Record<string, FieldPatch>>>> = {
  descriptive: {},
  normality: {},
  oneSample: {
    test: { label: 'Compare the mean or the median with the value?' },
    hypothetical: { label: 'Hypothetical value (what the groups are compared with)' },
  },
  ttest: {
    design: {
      label: 'Same subjects in both groups?',
      options: {
        unpaired: { label: 'Different subjects' },
        paired: {
          label: 'Yes, each row is one subject, plate or day',
          unavailable: [rawOnly],
        },
      },
    },
    'paired.measure': {
      label: 'Is the change a difference or a ratio?',
      options: {
        difference: { label: 'A difference (paired t test)' },
        ratio: { label: 'A ratio: values change by a factor (ratio paired t test)' },
      },
    },
  },
  mannWhitney: {},
  kolmogorovSmirnov: {},
  wilcoxon: {},
  oneWayAnova: {
    matched: {
      label: 'Same subjects in every group?',
      options: {
        false: { label: 'Different subjects' },
        true: {
          label: 'Yes, each row is one subject, plate or day',
          unavailable: [rawOnly],
        },
      },
    },
    gaussian: {
      label: 'What kind of values?',
      options: {
        true: { label: 'Measurements: ANOVA' },
        false: {
          label: 'Scores or ranks: Kruskal-Wallis (Friedman if matched)',
          unavailable: [rawOnly],
        },
      },
    },
    equalSD: {
      label: 'Could a treatment change how much values vary?',
      options: {
        yes: { label: 'No, similar scatter: ordinary ANOVA' },
        welch: { label: 'Yes, or not sure: Welch ANOVA' },
        brownForsythe: { label: 'Yes, centred on medians: Brown-Forsythe ANOVA' },
      },
    },
    comparisons: {
      label: 'Which comparisons?',
      options: {
        allPairs: { label: 'Every pair of groups' },
        vsControl: { label: 'Each group with a control' },
        trend: {
          label: 'A steady trend across the groups, in order',
          unavailable: [
            { when: [p('matched', true)], reason: TREND_MATCHED },
            { when: [p('gaussian', false)], reason: TREND_RANKS },
            { when: [p('equalSD', 'welch', 'brownForsythe')], reason: TREND_SCATTER },
          ],
        },
        none: { label: 'None' },
      },
    },
    control: { label: 'Control group' },
    allPairsMethod: {
      label: 'Correction for every pair',
      options: {
        'newman-keuls': { unavailable: [{ when: [p('matched', true)], reason: NOT_WITH_RM }] },
      },
    },
    controlMethod: { label: 'Correction for each with the control' },
  },
  friedman: {
    comparisons: {
      label: 'Which comparisons?',
      options: {
        none: { label: 'None' },
        allPairs: { label: 'Every pair of groups (mean ranks)' },
        vsControl: { label: 'Each group with a control' },
      },
    },
    control: { label: 'Control group' },
    correction: { tier: 'advanced' },
  },
  twoWayAnova: {
    repeated: {
      label: 'Were the same subjects measured across a factor?',
      options: {
        none: { label: 'No: different subjects in every cell' },
        columns: {
          label: 'Yes, across the columns: a subject’s values are spread across a row',
          unavailable: [rawOnly],
        },
        rows: {
          label: 'Yes, across the rows: a subject’s values are stacked in a subcolumn',
          unavailable: [rawOnly],
        },
        both: { label: 'Yes, across both factors', unavailable: [rawOnly] },
      },
    },
    interaction: {
      label: 'Can the effect of one factor depend on the other?',
      options: {
        true: {
          label: 'Yes: full model (row effect, column effect and interaction)',
          unavailable: [{ when: [{ fact: 'maxPerCell', atMost: 1 }], reason: ONE_PER_CELL }],
        },
        false: { label: 'No: main effects only (needed with one value per cell)' },
      },
    },
    comparisons: {
      label: 'Which comparisons?',
      options: {
        allCells: {
          unavailable: [{ when: [p('repeated', 'rows', 'columns', 'both')], reason: ALL_CELLS_RM }],
        },
      },
    },
    kind: { label: 'Compare' },
    family: {
      tier: 'advanced',
      options: {
        all: {
          unavailable: [
            { when: [p('kind', 'allPairs'), p('allPairsMethod', 'tukey')], reason: FAMILY_ALL },
            { when: [p('kind', 'vsControl'), p('controlMethod', 'dunnett')], reason: FAMILY_ALL },
          ],
        },
      },
    },
    allPairsMethod: {
      options: {
        'newman-keuls': {
          unavailable: [{ when: [p('repeated', 'rows', 'columns', 'both')], reason: NOT_WITH_RM }],
        },
      },
    },
  },
  multipleT: {
    design: {
      label: 'Same subjects in both groups?',
      options: {
        unpaired: { label: 'Different subjects' },
        paired: {
          label: 'Yes, values in the same subcolumn are one subject',
          unavailable: [rawOnly],
        },
      },
    },
    distribution: {
      label: 'What kind of values?',
      options: {
        gaussian: { label: 'Measurements' },
        lognormal: {
          label: 'Values that change by a factor (lognormal)',
          unavailable: [rawOnly],
        },
        nonparametric: { label: 'Scores or ranks', unavailable: [rawOnly] },
      },
    },
    variance: { label: 'Can the groups vary by different amounts?' },
    rankTest: { tier: 'advanced' },
    approach: { label: 'How should the many rows be corrected?' },
    q: { tier: 'advanced' },
    alpha: { tier: 'advanced' },
    difference: { tier: 'reporting' },
  },
  multipleOneWay: {
    gaussian: {
      label: 'What kind of values?',
      options: {
        true: { label: 'Measurements: ANOVA' },
        false: { label: 'Scores or ranks: Kruskal-Wallis', unavailable: [rawOnly] },
      },
    },
    equalSD: {
      label: 'Could a treatment change how much values vary?',
      options: {
        yes: { label: 'No, similar scatter: ordinary ANOVA' },
        welch: { label: 'Yes, or not sure: Welch ANOVA' },
        brownForsythe: { label: 'Yes, centred on medians: Brown-Forsythe ANOVA' },
      },
    },
    comparisons: {
      label: 'Which comparisons within each row?',
      options: {
        allPairs: { label: 'Every pair of groups' },
        vsControl: { label: 'Each group with a control' },
        none: { label: 'None' },
      },
    },
    control: { label: 'Control group' },
    approach: { label: 'How should the rows’ P values be corrected?' },
    q: { tier: 'advanced' },
    alpha: { tier: 'advanced' },
  },
  threeWayAnova: {
    comparisons: {
      label: 'Which comparisons?',
      options: {
        allCells: { unavailable: [{ when: [anyRepeated3], reason: THREE_WAY_RM }] },
        vsControl: { unavailable: [{ when: [anyRepeated3], reason: THREE_WAY_RM }] },
        oneFactor: { unavailable: [{ when: [anyRepeated3], reason: THREE_WAY_RM }] },
      },
    },
    rmMethod: { appliesTo: [anyRepeated3] },
    ddf: { appliesTo: [anyRepeated3] },
  },
  correlation: {
    method: { label: 'Measurements or ranks?' },
    correction: { tier: 'advanced' },
  },
  linearRegression: {
    throughPoint: {
      showIf: null,
      unavailable: [{ when: [p('throughOrigin', true)], reason: THROUGH_ORIGIN }],
    },
    pointX: { showIf: [p('throughPoint', true)], appliesTo: [p('throughOrigin', false)] },
    pointY: { showIf: [p('throughPoint', true)], appliesTo: [p('throughOrigin', false)] },
    replicates: { label: 'Are the replicates at each X independent points?' },
    compare: { appliesTo: [{ fact: 'dataSets', atLeast: 2 }] },
    interpolate: { tier: 'essentials' },
  },
  deming: { xForY: { tier: 'reporting' } },
  simpleLogistic: {
    roc: { tier: 'reporting' },
    rowPrediction: { tier: 'reporting' },
    range: { tier: 'reporting' },
    rangeMin: { tier: 'reporting' },
    rangeMax: { tier: 'reporting' },
  },
  nonlinearFit: {
    equationByDataSet: { tier: 'advanced' },
    initialValues: { tier: 'advanced' },
    initialRules: { tier: 'advanced' },
    limits: { tier: 'advanced' },
    fitMethod: { tier: 'advanced' },
    outliers: { tier: 'advanced' },
    routQ: { tier: 'advanced' },
    weighting: { tier: 'advanced' },
    weightPower: { tier: 'advanced' },
    replicates: { label: 'Are the replicates at each X independent points?' },
    compareWith: {
      unavailable: [{ when: [p('fitMethod', 'robust')], reason: ROBUST }],
    },
    compareParams: {
      unavailable: [{ when: [p('fitMethod', 'robust')], reason: ROBUST }],
    },
    compareBy: COMPARE_BY,
  },
  nonlinearFitMV: {
    initialValues: { tier: 'advanced' },
    initialRules: { tier: 'advanced' },
    limits: { tier: 'advanced' },
    fitMethod: { tier: 'advanced' },
    outliers: { tier: 'advanced' },
    routQ: { tier: 'advanced' },
    weighting: { tier: 'advanced' },
    weightPower: { tier: 'advanced' },
    replicates: { label: 'Are the replicates at each X independent points?' },
    compareWith: {
      unavailable: [{ when: [p('fitMethod', 'robust')], reason: ROBUST }],
    },
    compareParams: {
      unavailable: [{ when: [p('fitMethod', 'robust')], reason: ROBUST }],
    },
    compareBy: COMPARE_BY,
  },
  fitSpline: { table: { tier: 'reporting' } },
  roc: {},
  blandAltman: { order: { tier: 'reporting' } },
  contingency: {
    yates: { appliesTo: [twoByTwo] },
    trend: {
      appliesTo: [
        { fact: 'rows', atLeast: 3 },
        { fact: 'columns', atMost: 2 },
      ],
    },
    exposedRow: { appliesTo: [twoByTwo] },
    outcomeColumn: { appliesTo: [twoByTwo] },
    tails: { appliesTo: [twoByTwo] },
    predicted: { appliesTo: [twoByTwo] },
    riskEstimates: { appliesTo: [twoByTwo] },
    oddsRatio: { appliesTo: [twoByTwo] },
    diagnostic: { appliesTo: [twoByTwo] },
    pairwise: { appliesTo: [{ fact: 'rows', atLeast: 3 }] },
    pairwiseControl: { appliesTo: [{ fact: 'rows', atLeast: 3 }] },
    pairwiseMethod: { appliesTo: [{ fact: 'rows', atLeast: 3 }] },
  },
  goodnessOfFit: {},
  survival: {
    ciMethod: { tier: 'reporting' },
    trend: { appliesTo: [threeGroups] },
    pairwise: { appliesTo: [threeGroups] },
    pairwiseMethod: { appliesTo: [threeGroups] },
    hazardRatio: { tier: 'advanced' },
  },
  multipleRegression: {
    y: { label: 'Outcome (Y)' },
    interpolate: { tier: 'reporting' },
  },
  logisticRegression: {
    y: { label: 'Outcome (0 = no, 1 = yes)' },
    cutoff: { tier: 'advanced' },
    interpolate: { tier: 'reporting' },
  },
  poissonRegression: {
    y: { label: 'Outcome (counts)' },
    interpolate: { tier: 'reporting' },
  },
  coxRegression: {},
  multifactorAnova: {
    y: { label: 'Outcome (Y)' },
    comparisons: {
      label: 'Which comparisons?',
      options: {
        simpleEffects: {
          unavailable: [{ when: [{ fact: 'factors', atMost: 1 }], reason: TWO_FACTORS }],
        },
        cells: { unavailable: [{ when: [{ fact: 'factors', atMost: 1 }], reason: TWO_FACTORS }] },
      },
    },
    method: { tier: 'advanced' },
    family: { tier: 'advanced' },
  },
  survivalFromVariables: {
    ciMethod: { tier: 'reporting' },
    hazardRatio: { tier: 'advanced' },
  },
  pca: {
    simulations: { tier: 'advanced' },
    loadingsPlot: { tier: 'reporting' },
    biplot: { tier: 'reporting' },
    pcr: { tier: 'reporting' },
    pcrY: { tier: 'reporting' },
    ellipses: { tier: 'reporting' },
  },
  pStack: { q: { tier: 'advanced' }, alpha: { tier: 'advanced' } },
  areaUnderCurve: {
    minPeakHeight: { tier: 'advanced' },
    minPeakPoints: { tier: 'advanced' },
  },
  powerAnalysis: { tails: { tier: 'advanced' } },
  transform: {
    y: { options: Object.fromEntries(USES_X.map((v) => [v, { unavailable: [noX] }])) },
    x: { appliesTo: [hasX] },
    kx: { appliesTo: [hasX] },
  },
  prune: { mode: { options: { xRange: { unavailable: [noX] } } } },
  simulateXY: {
    xMode: { options: { table: { unavailable: [noX] } } },
    yFrom: { options: { table: { unavailable: [noX] } } },
    seed: { tier: 'advanced' },
  },
  monteCarlo: {
    hitDenominator: { tier: 'advanced' },
    alpha: { tier: 'reporting' },
  },
}

/** A field with a patch applied. */
function patched(f: FormField, patch: FieldPatch | undefined): FormField {
  const tier = patch?.tier ?? f.tier ?? SHARED_TIERS[f.path.join('.')] ?? 'essentials'
  let out: FormField = { ...f, tier }
  if (!patch) return out
  if (patch.label) out = { ...out, label: patch.label }
  if (patch.appliesTo) out = { ...out, appliesTo: patch.appliesTo }
  if (patch.unavailable) out = { ...out, unavailable: patch.unavailable }
  if (patch.showIf !== undefined) {
    const { showIf: _, ...rest } = out
    out = (patch.showIf === null ? rest : { ...rest, showIf: patch.showIf }) as FormField
  }
  if (patch.options && 'options' in out) {
    const o = patch.options
    const options = out.options.map((x): FormOption => {
      const op = o[String(x.value)]
      if (!op) return x
      return {
        ...x,
        ...(op.label ? { label: op.label } : {}),
        ...(op.unavailable ? { unavailable: op.unavailable } : {}),
      }
    })
    out = { ...out, options } as FormField
  }
  return out
}

/**
 * Roadmap 51b (§4.4 row 6): Welch's comparison methods listed under "each with the control" say
 * so: a second copy of the field shown for that choice.
 */
function welchForControl(form: readonly FormField[]): FormField[] {
  return form.flatMap((f) => {
    if (f.path.join('.') !== 'welchMethod' || !f.showIf) return [f]
    const cs = Array.isArray(f.showIf) ? (f.showIf as ShowIf[]) : [f.showIf as ShowIf]
    const comp = cs.find((c) => c.path.join('.') === 'comparisons')
    if (!comp) return [f]
    const other = cs.filter((c) => c !== comp)
    return [
      {
        ...f,
        label: 'Correction for every pair (unequal SDs)',
        showIf: [...other, p('comparisons', 'allPairs')],
      },
      {
        ...f,
        label: 'Correction for each with the control (unequal SDs)',
        showIf: [...other, p('comparisons', 'vsControl')],
      },
    ] as FormField[]
  })
}

/** An analysis' form with its dialog words, tiers and conditions. */
export function dialogForm(analysisId: string, form: readonly FormField[]): FormField[] {
  const patches = DIALOG_PATCHES[analysisId] ?? {}
  const base =
    analysisId === 'oneWayAnova' || analysisId === 'multipleOneWay' ? welchForControl(form) : form
  return base.map((f) => patched(f, patches[f.path.join('.')]))
}

/** Attaches the dialog's words, tiers and conditions to every definition's form (in place). */
export function attachDialog(defs: readonly AnalysisDef<unknown>[]): void {
  for (const d of defs) d.form = dialogForm(d.id, d.form)
}
