import type { GuideAnswers, GuideEntry, GuideStep, TableFacts } from '@ps/model'
import { alt, answer, elsewhere, fixed, leaf, question } from './build.ts'

// Roadmap 51a: the XY tables' questions (design §3.5, "Relationships and regression" and
// "Curves"), with today's params.

const replicatesQ = (then: GuideStep): GuideStep =>
  question(
    'replicates',
    'Are the replicates at each X independent experiments, or repeats of one sample?',
    'Repeated measurements of one sample are not independent: fit their means.',
    [
      answer('each', 'Independent (separate animals, separate experiments)', then),
      answer('mean', 'Repeats of one sample (technical replicates)', then),
    ],
    {
      answeredBy: (f) => (f.replicates <= 1 ? 'each' : null),
      draws: { mean: { notes: ['Replicates averaged first (technical repeats).'] } },
    },
  )

const replicates = (a: GuideAnswers) => a.replicates ?? 'each'

// ---- Dose-response -------------------------------------------------------------------------

/** The dose-response model the answers choose (an equation id of `EQUATIONS`). */
export function doseResponseModel(a: GuideAnswers): string {
  const base = a.direction === 'falls' ? 'inhibitor' : 'agonist'
  const conc = a.xScale === 'dose' ? '-conc' : ''
  const normalized = a.normalized === 'yes' ? '-normalized' : ''
  const slope = a.slope === 'standard' ? '' : '-variable-slope'
  return `${base}${conc}${normalized}-response${slope}`
}

/** The EC50 (IC50) parameter of that model. */
const midpoint = (a: GuideAnswers) =>
  `${a.xScale === 'dose' ? '' : 'Log'}${a.direction === 'falls' ? 'IC50' : 'EC50'}`

const doseParams = (_f: TableFacts, a: GuideAnswers) => ({
  equation: doseResponseModel(a),
  compareParams: a.compare === 'yes' ? [midpoint(a)] : [],
  // Roadmap 51e (§9.4, S18): how the comparison is decided, chosen before the fit.
  ...(a.compare === 'yes' ? { compareBy: a.compareBy === 'aicc' ? 'aicc' : 'fTest' } : {}),
  replicates: replicates(a),
  ciMethod: 'profile',
})

const doseLeaf = leaf(
  'nonlinearFit',
  doseParams,
  'A sigmoid fitted on the X scale you have: top, bottom, the EC50 (IC50) and, with a variable slope, its steepness. If a plateau isn’t reached, fix Bottom or Top.',
  [
    alt(
      'nonlinearFit',
      (f, a) => ({
        ...doseParams(f, a),
        equation: doseResponseModel({
          ...a,
          slope: a.slope === 'standard' ? 'variable' : 'standard',
        }),
      }),
      'you have a reason for the other slope (standard: Hill slope 1)',
    ),
  ],
)

// Asked in this order, each answer leading to the next question (built from the fit back).
/** Roadmap 51e (§9.4, S18): the comparison's method, chosen before the results. */
const compareByQ = (then: GuideStep) =>
  question(
    'compareBy',
    'How will you decide whether the EC50 (IC50) differs?',
    'One method, chosen now: reading both and keeping the one you like is test shopping.',
    [
      answer('fTest', 'Extra sum-of-squares F test (a P value)', then, {
        explain:
          'A shared EC50 against one per data set are nested models: the classical test applies.',
      }),
      answer('aicc', 'AICc (the probability that each model is right)', then),
    ],
    {
      draws: {
        fTest: { decideBy: 'the extra sum-of-squares F test' },
        aicc: { decideBy: 'AICc' },
      },
    },
  )
const compareQ = (then: GuideStep) =>
  question(
    'compare',
    'Compare the EC50 (IC50) between data sets?',
    'Decide before looking at the curves which parameter matters.',
    [
      answer('yes', 'Yes: does it differ between data sets?', compareByQ(then)),
      answer('no', 'No, fit each data set', then),
    ],
    {
      answeredBy: (f) => (f.groups.length < 2 ? 'no' : null),
      draws: {
        yes: { comparisons: 'shared', measure: 'parameter' },
        no: { comparisons: 'none', measure: 'curve' },
      },
    },
  )
const slopeQ = (then: GuideStep) =>
  question(
    'slope',
    'Do you expect the standard slope (Hill slope 1)?',
    'A variable slope fits the steepness too: one more parameter.',
    [
      answer('variable', 'Not necessarily: fit the steepness', then, {
        explain: 'Four parameters (top, bottom, EC50 and steepness): the usual choice.',
      }),
      answer('standard', 'Yes, there is a reason to fix it at 1', then),
    ],
    {
      draws: {
        variable: { notes: ['Steepness fitted (four parameters).'] },
        standard: { notes: ['Hill slope fixed at 1 (three parameters).'] },
      },
    },
  )
const normalizedQ = (then: GuideStep) =>
  question(
    'normalized',
    'Were the responses normalized to 0–100% with defined controls?',
    'Normalized data fix the plateaus at 0 and 100; others fit them.',
    [
      answer('yes', 'Yes, 0% and 100% are defined by controls', then),
      answer('no', 'No, the responses are in their own units', then),
    ],
    {
      draws: {
        yes: { notes: ['Plateaus fixed at 0 and 100%.'] },
        no: { notes: ['Top and bottom fitted.'] },
      },
    },
  )
const xScaleQ = (then: GuideStep) =>
  question(
    'xScale',
    'Is X the dose (concentration) or log(dose)?',
    'The models differ: the log forms expect log(concentration), the others concentrations.',
    [
      answer('log', 'log(dose), e.g. −9, −8, −7', then),
      answer('dose', 'The dose itself, e.g. 1e-9, 1e-8 (or 0.1, 1, 10 µM)', then),
    ],
    {
      draws: {
        log: { notes: ['X is log(dose).'] },
        dose: { notes: ['X is the dose itself.'] },
      },
      hint: (f) =>
        !f.x
          ? null
          : f.x.looksLog
            ? `X runs from ${f.x.min} to ${f.x.max}: it looks like log(concentration).`
            : f.x.looksConcentration
              ? `X runs from ${f.x.min} to ${f.x.max}, spanning orders of magnitude: it looks like concentrations.`
              : null,
    },
  )
const afterDirection = xScaleQ(normalizedQ(slopeQ(compareQ(replicatesQ(doseLeaf)))))

const doseResponse: GuideStep = question(
  'direction',
  'Does the response rise or fall as the dose increases?',
  'Rising responses give an EC50 (agonist), falling ones an IC50 (inhibitor).',
  [
    answer('rises', 'It rises (agonist: EC50)', afterDirection),
    answer('falls', 'It falls (inhibitor: IC50)', afterDirection),
  ],
  {
    draws: {
      rises: { curve: 'up', parameter: 'EC50' },
      falls: { curve: 'down', parameter: 'IC50' },
    },
  },
)

// ---- Other curves --------------------------------------------------------------------------

const fit = (equation: string, reason: string) =>
  leaf('nonlinearFit', fixed({ equation, replicates: 'each' }), reason)

const otherCurve: GuideStep = question(
  'experiment',
  'What kind of experiment?',
  'The model comes from the experiment, chosen before the fit.',
  [
    answer(
      'saturation',
      'Binding: saturation (total or specific binding against ligand)',
      fit(
        'one-site-specific',
        'One-site specific binding: Bmax (the number of sites) and Kd (the concentration giving half of them).',
      ),
    ),
    answer(
      'competition',
      'Binding: competition (log of the unlabelled ligand)',
      fit(
        'one-site-fit-logic50',
        'One-site competition: top, bottom and the IC50 of the unlabelled ligand.',
      ),
    ),
    answer(
      'association',
      'Binding: association kinetics (binding against time)',
      fit(
        'association-one-conc',
        'Association kinetics at one concentration of labelled ligand: kon, koff and Bmax.',
      ),
    ),
    answer(
      'dissociation',
      'Binding: dissociation (binding against time after washout)',
      fit(
        'dissociation-one-phase',
        'One-phase dissociation: the rate constant and the half-life of the complex.',
      ),
    ),
    answer(
      'enzyme',
      'Enzyme kinetics (velocity against substrate)',
      fit(
        'michaelis-menten',
        'Michaelis-Menten: Vmax and Km, the substrate concentration giving half of Vmax.',
      ),
    ),
    answer(
      'decay',
      'Decay (a signal falling with time)',
      fit(
        'one-phase-decay',
        'One-phase decay: the starting value, the plateau and the rate constant (half-life).',
      ),
    ),
    answer(
      'growth',
      'Growth without limit (early exponential growth)',
      fit(
        'exponential-growth',
        'Exponential growth: the starting value and the rate constant (doubling time).',
      ),
    ),
    answer(
      'logistic',
      'Growth to a plateau (cultures, populations)',
      fit('logistic-growth', 'Logistic growth: the starting value, the maximum and the rate.'),
    ),
    answer(
      'peak',
      'A peak (a distribution, a chromatogram)',
      fit('gaussian', 'A Gaussian peak: its amplitude, centre and width.'),
    ),
    answer(
      'other',
      'Something else',
      leaf(
        'nonlinearFit',
        fixed({}),
        'Choose the model in the options’ picker: by goal (binding, kinetics, peaks…), All equations (126 built in), or your own equation.',
      ),
    ),
  ],
  {
    draws: {
      saturation: { curve: 'up', parameter: 'Bmax and Kd' },
      competition: { curve: 'down', parameter: 'IC50' },
      association: { curve: 'up', parameter: 'kon and koff' },
      dissociation: { curve: 'down', parameter: 'koff (the half-life)' },
      enzyme: { curve: 'up', parameter: 'Vmax and Km' },
      decay: { curve: 'down', parameter: 'the rate constant (half-life)' },
      growth: { curve: 'up', parameter: 'the rate constant (doubling time)' },
      logistic: { curve: 'up', parameter: 'the maximum and the rate' },
      peak: { curve: 'peak', parameter: 'the centre and width' },
    },
  },
)

// ---- Relationships ---------------------------------------------------------------------------

const correlationQ = (kind: 'xy' | 'column'): GuideStep =>
  question(
    'shape',
    'What kind of relation do you expect?',
    'Pearson measures a straight-line association, Spearman any steady rise or fall.',
    [
      answer(
        'straight',
        'A straight line, with roughly symmetric scatter',
        leaf(
          'correlation',
          fixed({ method: 'pearson' }),
          'Pearson’s r measures how closely the points follow a straight line.',
          kind === 'column'
            ? [
                alt(
                  'blandAltman',
                  fixed({ measure: 'difference', order: 'bMinusA' }),
                  'the question is whether two methods agree',
                ),
              ]
            : [alt('linearRegression', fixed({}), 'you set X and want to predict Y from it')],
        ),
      ),
      answer(
        'monotone',
        'Rising or falling but curved, ranks, or a few outliers',
        leaf(
          'correlation',
          fixed({ method: 'spearman' }),
          'Spearman’s correlation measures a steady rise or fall, using ranks.',
          [alt('correlation', fixed({ method: 'pearson' }), 'the relation is a straight line')],
        ),
      ),
    ],
    {
      draws: {
        straight: { notes: ['A straight-line association (Pearson).'] },
        monotone: { notes: ['A steady rise or fall, by ranks (Spearman).'] },
      },
    },
  )

const straightLine: GuideStep = question(
  'setX',
  'Did you set X (dose, time, a standard’s concentration), or measure both?',
  'Regression predicts Y from an X you set; correlation describes two measurements.',
  [
    answer(
      'set',
      'I set X',
      replicatesQ(
        leaf(
          'linearRegression',
          (_f, a) => ({ replicates: replicates(a) }),
          'Linear regression finds the line that best predicts Y from X, and whether its slope differs from zero.',
          [
            alt('nonlinearFit', fixed({}), 'the relation curves (a model of the experiment)'),
            alt('correlation', fixed({}), 'you only want the strength of association'),
          ],
        ),
      ),
    ),
    answer(
      'both',
      'Both were measured',
      question(
        'want',
        'What do you want to know?',
        'Association and agreement are different questions.',
        [
          answer('strength', 'How strongly they are associated', correlationQ('xy')),
          answer(
            'agree',
            'Whether two methods agree',
            leaf(
              'deming',
              fixed({}),
              'Both methods are measured with error, so Deming regression gives the line relating them.',
              [alt('correlation', fixed({}), 'you only want the strength of association')],
            ),
          ),
        ],
        {
          draws: {
            strength: { measure: 'association', comparisons: 'together' },
            agree: { measure: 'agreement', comparisons: 'together' },
          },
        },
      ),
    ),
  ],
  {
    draws: {
      set: {
        measure: 'slope',
        curve: 'line',
        parameter: 'slope',
        comparisons: 'vsValue',
        hypothetical: 0,
      },
      both: { layout: 'xy' },
    },
  },
)

export const XY_ENTRIES: readonly GuideEntry[] = [
  {
    id: 'doseResponse',
    question: 'Fit a dose-response curve (EC50 / IC50)',
    kinds: ['xy'],
    keywords: [
      'dose response',
      'ec50',
      'ic50',
      'sigmoid',
      'hill slope',
      'curve fit',
      'potency',
      'agonist',
      'inhibitor',
    ],
    draws: { layout: 'groups', measure: 'curve' },
    start: doseResponse,
  },
  {
    id: 'standardCurve',
    question: 'Read unknowns off a standard curve',
    kinds: ['xy'],
    keywords: ['standard curve', 'interpolate', 'unknowns', 'elisa', 'bca', 'calibration'],
    draws: { layout: 'standard', measure: 'interpolate', comparisons: 'none' },
    start: question(
      'straight',
      'Is the standard curve straight?',
      'A line where it is straight; a sigmoid where it flattens at the ends.',
      [
        answer(
          'yes',
          'Yes, a straight line over the standards',
          leaf(
            'linearRegression',
            fixed({ interpolate: true }),
            'A straight standard curve; the unknowns (rows with a Y but no X) are read off it.',
          ),
        ),
        answer(
          'no',
          'No, it flattens at the ends',
          leaf(
            'nonlinearFit',
            fixed({ equation: 'agonist-conc-response-variable-slope', interpolate: true }),
            'A four-parameter sigmoid on concentrations reads unknowns where the curve flattens.',
            [
              alt(
                'nonlinearFit',
                fixed({ equation: 'asymmetric-5pl-conc', interpolate: true }),
                'the curve is asymmetric (5PL)',
              ),
              alt(
                'nonlinearFit',
                fixed({ equation: 'polynomial-2', interpolate: true }),
                'a gentle curve (second-order polynomial)',
              ),
            ],
          ),
        ),
      ],
      { draws: { yes: { curve: 'line' }, no: { curve: 'up' } } },
    ),
  },
  {
    id: 'otherCurve',
    question: 'Fit another curve (binding, kinetics, decay)',
    kinds: ['xy'],
    keywords: [
      'binding',
      'kd',
      'bmax',
      'michaelis menten',
      'km',
      'vmax',
      'decay',
      'half-life',
      'growth',
      'kinetics',
      'exponential',
      'curve fit',
    ],
    draws: { layout: 'groups', measure: 'curve', comparisons: 'none' },
    start: otherCurve,
  },
  {
    id: 'straightLine',
    question: 'Is there a straight-line relation?',
    kinds: ['xy'],
    keywords: ['linear regression', 'slope', 'line', 'least squares'],
    draws: { layout: 'groups' },
    start: straightLine,
  },
  {
    id: 'compareCurves',
    question: 'Compare slopes or curves',
    kinds: ['xy'],
    keywords: ['compare slopes', 'compare curves', 'compare ec50', 'parallel lines'],
    draws: { layout: 'groups', comparisons: 'shared' },
    start: question(
      'shape',
      'Straight lines or curves?',
      'Lines compare slopes; curves compare a parameter such as the EC50.',
      [
        answer(
          'lines',
          'Straight lines',
          leaf(
            'linearRegression',
            fixed({ compare: true }),
            'Tests whether the slopes differ; the intercepts are compared only if the slopes don’t.',
          ),
        ),
        answer('curves', 'Dose-response curves (compare the EC50 or IC50)', doseResponse),
      ],
      {
        draws: {
          lines: { measure: 'slope', curve: 'line', parameter: 'slope' },
          curves: { measure: 'parameter' },
        },
      },
    ),
  },
  {
    id: 'xyTogether',
    question: 'Do X and Y go up together?',
    kinds: ['xy'],
    keywords: ['correlation', 'pearson', 'spearman', 'association'],
    draws: { layout: 'xy', measure: 'association', comparisons: 'together' },
    start: correlationQ('xy'),
  },
  {
    id: 'yesNo',
    question: 'A yes/no outcome against X',
    kinds: ['xy'],
    keywords: ['logistic', 'binary', 'probability', 'yes no'],
    draws: { layout: 'xy', measure: 'probability', comparisons: 'predict' },
    start: leaf(
      'simpleLogistic',
      fixed({ ciMethod: 'profile' }),
      'Logistic regression models the probability of “yes” (Y = 1) as X changes.',
    ),
  },
  {
    id: 'auc',
    question: 'Area under the curve',
    kinds: ['xy'],
    keywords: ['area under curve', 'auc', 'integral', 'peaks', 'exposure'],
    draws: { layout: 'groups', measure: 'area', comparisons: 'none' },
    start: leaf(
      'areaUnderCurve',
      fixed({}),
      'The area between each curve and the baseline, and its peaks.',
    ),
  },
  {
    id: 'smooth',
    question: 'Smooth the points',
    kinds: ['xy'],
    keywords: ['smooth', 'lowess', 'spline', 'trend line'],
    draws: { layout: 'groups', measure: 'smooth', comparisons: 'none' },
    start: leaf(
      'fitSpline',
      fixed({ method: 'lowess' }),
      'A LOWESS curve follows the trend without a model; it gives no parameters and no P.',
      [
        alt(
          'fitSpline',
          fixed({ method: 'smoothingSpline' }),
          'you want to set the smoothness by knots',
        ),
      ],
    ),
  },
]

/** "Do two columns go up and down together?" on column tables. */
export const COLUMN_CORRELATION: GuideEntry = {
  id: 'goTogether',
  question: 'Do two columns go up and down together?',
  kinds: ['column'],
  keywords: ['correlation', 'pearson', 'spearman', 'association', 'related'],
  draws: { layout: 'pair', measure: 'association', comparisons: 'together' },
  start: correlationQ('column'),
}

/** Elsewhere steps used by other trees. */
export const NEEDS_XY = elsewhere(
  'xy',
  'Curve fits and regression need an XY table: X is the dose, concentration or time.',
)
