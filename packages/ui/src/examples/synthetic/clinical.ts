import type { FontRegistry } from '@ps/graph'
import {
  type AnalysisNode,
  type ColorRef,
  createTable,
  graphOutputs,
  type Project,
  type StrokeStyle,
} from '@ps/model'
import {
  columnTable,
  draws,
  ExampleBuilder,
  flatTable,
  rng,
  round,
  stroke,
  survivalTable,
  withLayer,
} from './builder.ts'

/** A curve's colour (its identity) and line (in the curves layer). */
interface CurveStyle {
  color?: ColorRef
  stroke?: StrokeStyle
}

/** Styles the curves of an analysis' own graphs by output key. */
function restyle(b: ExampleBuilder, analysis: AnalysisNode, styles: Record<string, CurveStyle>) {
  for (const g of b.outputGraphs(analysis))
    b.edit(g, (x) => {
      let out = x
      for (const { series: e } of graphOutputs(x)) {
        const s = styles[e.ref.key]
        if (!s) continue
        if (s.color)
          out = {
            ...out,
            seriesOverrides: {
              ...out.seriesOverrides,
              [e.id]: { ...out.seriesOverrides[e.id], color: s.color },
            },
          }
        const line = s.stroke
        if (line)
          out = withLayer(out, 'curves', (l) => ({
            ...l,
            series: {
              ...l.series,
              [e.id]: { ...l.series?.[e.id], style: { ...l.series?.[e.id]?.style, stroke: line } },
            },
          }))
      }
      return out
    })
}

/**
 * Survival, contingency and multiple variables: Kaplan-Meier with the log-rank test, contingency
 * tables (with the test for trend, comparisons of pairs of rows and Cramér's V), observed vs.
 * expected counts, a patient cohort with multiple linear, logistic, Poisson and Cox regression
 * (with estimated survival curves) and PCA (loadings plot, biplot, principal component
 * regression), a ROC curve, a Bland-Altman plot and a sample-size calculation. All data are
 * simulated (fixed seed).
 */
export function createClinicalExample(fonts: FontRegistry): Project {
  const b = new ExampleBuilder('Survival, contingency and multiple variables', fonts)
  const r = rng(505)

  // Survival: exponential event times, censored at the end of follow-up (180 days) or when
  // lost to follow-up.
  const arm = (n: number, medianDays: number) =>
    Array.from({ length: n }, () => {
      const t = r.exponential(medianDays / Math.LN2)
      const lost = r.uniform() < 0.15 ? r.uniform() * 180 : Number.POSITIVE_INFINITY
      const end = Math.min(t, lost, 180)
      return { time: Math.max(1, Math.round(end)), event: end === t }
    })
  const survival = b.table(
    survivalTable(
      'Survival by treatment',
      'Days',
      { Placebo: arm(24, 70), 'Low dose': arm(24, 110), 'High dose': arm(24, 200) },
      'Days to death (code 1) or censoring (code 0: alive at day 180 or lost to follow-up), 24 patients per arm, one per row. Simulated exponential survival times. Kaplan-Meier curves, the log-rank test, the test for trend and hazard ratios.',
    ),
  )
  b.graph(survival, { xTitle: 'Days after enrolment', size: { plotWidth: 260 } })
  b.analyze(survival, 'survival', {}, { name: 'Kaplan-Meier (log-rank)' })

  // Contingency: a 2 × 2 table (Fisher's exact test) and a 3 × 2 table (chi-square).
  const events = b.table(
    flatTable(
      'Adverse events',
      'contingency',
      { 'Adverse event': [9, 21], 'No event': [91, 79] },
      ['Drug', 'Placebo'],
      'Patients with and without an adverse event in each arm (100 per arm). Made-up counts. Fisher’s exact test with the relative risk and odds ratio.',
    ),
  )
  b.graph(events, { yTitle: 'Patients' })
  b.analyze(events, 'contingency', {}, { name: 'Fisher’s exact test' })
  const response = b.table(
    flatTable(
      'Response by dose',
      'contingency',
      { Responder: [12, 21, 30], 'Non-responder': [38, 29, 20] },
      ['10 mg', '20 mg', '40 mg'],
      'Responders and non-responders at three doses, 50 patients each. Made-up counts. Chi-square test, the chi-square test for trend (Cochran-Armitage), Cramér’s V, and every pair of doses compared (Fisher’s exact test on each pair, Bonferroni-corrected).',
    ),
  )
  b.graph(response, { yTitle: 'Patients' })
  b.analyze(response, 'contingency', { test: 'chiSquare' }, { name: 'Chi-square test' })
  b.analyze(
    response,
    'contingency',
    { test: 'fisher', pairwise: 'all', pairwiseMethod: 'bonferroni' },
    { name: 'Doses compared in pairs' },
  )

  // A cohort for multiple regression, logistic and Cox regression and PCA.
  const n = 120
  const cohort: Record<string, number[]> = {
    Age: [],
    BMI: [],
    Male: [],
    Dose: [],
    SBP: [],
    Cholesterol: [],
    Responder: [],
    Days: [],
    Died: [],
  }
  for (let i = 0; i < n; i++) {
    const age = Math.round(35 + 40 * r.uniform())
    const bmi = round(r.normal(27, 4))
    const male = r.uniform() < 0.5 ? 1 : 0
    const dose = [0, 10, 20, 40][i % 4]!
    cohort.Age!.push(age)
    cohort.BMI!.push(bmi)
    cohort.Male!.push(male)
    cohort.Dose!.push(dose)
    cohort.SBP!.push(
      Math.round(80 + 0.55 * age + 1.1 * bmi + 4 * male - 0.35 * dose + r.normal(0, 9)),
    )
    cohort.Cholesterol!.push(round(3.2 + 0.025 * age + 0.05 * bmi + r.normal(0, 0.6)))
    const logit = -2.5 + 0.08 * dose + 0.02 * (age - 55)
    cohort.Responder!.push(r.uniform() < 1 / (1 + Math.exp(-logit)) ? 1 : 0)
    const hazard = 0.004 * Math.exp(0.04 * (age - 55) - 0.025 * dose + 0.3 * male)
    const t = r.exponential(1 / hazard)
    cohort.Days!.push(Math.max(1, Math.round(Math.min(t, 365))))
    cohort.Died!.push(t < 365 ? 1 : 0)
  }
  // Text (categorical) variables: sex and treatment arm, written out from the codes above.
  const cohortTable = flatTable(
    'Patient cohort',
    'multipleVariables',
    { ...cohort, Sex: [], Arm: [] },
    null,
    '120 simulated patients: age, BMI, sex (Male = 1, and as text), dose (mg) and treatment arm (text), systolic blood pressure, cholesterol, response (1 = responder), days of follow-up and death (1) or censoring (0) at one year. Multiple linear regression of SBP (also with sex and arm as categorical predictors, an interaction and predicted SBP), logistic regression of response, Cox regression of survival (numeric and categorical), multifactor ANOVA of SBP by sex and arm, Kaplan-Meier curves by arm, and PCA of the continuous variables.',
  )
  const textOf = (title: string, values: string[]) => {
    cohortTable.dataSets.find((d) => d.title === title)!.text = values
  }
  textOf(
    'Sex',
    cohort.Male!.map((m) => (m ? 'Male' : 'Female')),
  )
  textOf(
    'Arm',
    cohort.Dose!.map((d) => (d ? `${d} mg` : 'Placebo')),
  )
  const mv = b.table(cohortTable)
  const k = (t: string) => b.key(mv, t)
  b.analyze(
    mv,
    'multipleRegression',
    { y: k('SBP') },
    { name: 'Multiple regression (SBP)', keys: ['SBP', 'Age', 'BMI', 'Male', 'Dose'].map(k) },
  )
  const logistic = b.analyze(
    mv,
    'logisticRegression',
    { y: k('Responder') },
    { name: 'Logistic regression (response vs. dose)', keys: ['Responder', 'Dose'].map(k) },
  )
  for (const g of b.outputGraphs(logistic))
    b.edit(g, (x) => ({
      ...x,
      axes: {
        ...x.axes,
        x:
          x.axes.x.type === 'continuous'
            ? { ...x.axes.x, title: { content: [{ text: 'Dose (mg)' }] } }
            : x.axes.x,
      },
    }))
  b.analyze(
    mv,
    'coxRegression',
    {
      time: k('Days'),
      event: k('Died'),
      // Estimated survival of 55-year-old women at three doses (model curves, not Kaplan-Meier).
      survivalCurves: [0, 20, 40].map((d) => ({ [k('Age')]: 55, [k('Male')]: 0, [k('Dose')]: d })),
    },
    { name: 'Cox regression', keys: ['Days', 'Died', 'Age', 'Male', 'Dose'].map(k) },
  )
  b.analyze(
    mv,
    'pca',
    { loadingsPlot: true, biplot: true },
    { name: 'Principal components', keys: ['Age', 'BMI', 'SBP', 'Cholesterol'].map(k) },
  )
  b.analyze(
    mv,
    'pca',
    { pcr: true, pcrY: k('SBP'), select: 'fixed', components: 2 },
    {
      name: 'Principal component regression (SBP)',
      keys: ['SBP', 'Age', 'BMI', 'Cholesterol', 'Dose'].map(k),
    },
  )

  // Text variables as categorical predictors (dummy coded; the reference level is the first in
  // the table: Male, Placebo), an age-by-sex interaction, and SBP predicted for new patients.
  b.analyze(
    mv,
    'multipleRegression',
    {
      y: k('SBP'),
      interactions: [[k('Age'), k('Sex')]],
      predictions: [
        { [k('Age')]: 45, [k('BMI')]: 25, [k('Sex')]: 'Female', [k('Arm')]: '40 mg' },
        { [k('Age')]: 70, [k('BMI')]: 30, [k('Sex')]: 'Male', [k('Arm')]: 'Placebo' },
      ],
    },
    {
      name: 'Multiple regression with categorical predictors (SBP)',
      keys: ['SBP', 'Age', 'BMI', 'Sex', 'Arm'].map(k),
    },
  )
  b.analyze(
    mv,
    'logisticRegression',
    // Nobody on placebo responds, so Arm as a factor would separate the outcome (the analysis
    // says so); the dose stays numeric here, with sex as a text predictor.
    {
      y: k('Responder'),
      predictions: [{ [k('Dose')]: 30, [k('Sex')]: 'Female', [k('Age')]: 55 }],
    },
    {
      name: 'Logistic regression (response by dose and sex)',
      keys: ['Responder', 'Dose', 'Sex', 'Age'].map(k),
    },
  )
  b.analyze(
    mv,
    'coxRegression',
    {
      time: k('Days'),
      event: k('Died'),
      survivalCurves: ['Placebo', '40 mg'].map((a) => ({ [k('Age')]: 55, [k('Arm')]: a })),
    },
    { name: 'Cox regression by arm and sex', keys: ['Days', 'Died', 'Age', 'Sex', 'Arm'].map(k) },
  )
  b.analyze(
    mv,
    'multifactorAnova',
    { y: k('SBP'), comparisons: 'mainEffects', compareFactor: k('Arm') },
    { name: 'Multifactor ANOVA (SBP by sex and arm)', keys: ['SBP', 'Sex', 'Arm'].map(k) },
  )
  const km = b.analyze(
    mv,
    'survivalFromVariables',
    { time: k('Days'), status: k('Died'), groups: [k('Arm')] },
    { name: 'Kaplan-Meier by arm', keys: ['Days', 'Died', 'Arm'].map(k) },
  )
  b.graph(km, { name: 'Survival by arm', xTitle: 'Days', size: { plotWidth: 260 } })

  // ROC: a biomarker in patients with and without the disease.
  const marker = b.table(
    columnTable(
      'Biomarker',
      {
        Controls: draws(40, () => r.lognormal(Math.log(12), 0.45)),
        Patients: draws(30, () => r.lognormal(Math.log(24), 0.45)),
      },
      'A serum biomarker (ng/mL) in 40 controls and 30 patients. Simulated lognormal data. The ROC curve shows how well it separates them (area under the curve with its CI) and the sensitivity and specificity at each cut-off.',
    ),
  )
  b.graph(marker, { preset: 'pointsMedian', yTitle: 'Biomarker (ng/mL)' })
  // Roadmap 51c (S39): the direction is said before the data are seen: patients higher.
  const roc = b.analyze(marker, 'roc', { direction: 'higher' }, { name: 'ROC curve' })
  // Planning the next study from this one as pilot data: patients per group for 90% power.
  b.analyze(
    marker,
    'powerAnalysis',
    { design: 'unpairedT', fromData: true, power: 0.9 },
    { name: 'Sample size (from the pilot biomarker data)' },
  )
  restyle(b, roc, {
    roc: { color: { rgb: '#0072b2' }, stroke: stroke('#0072b2', 2) },
    identity: { stroke: { ...stroke('#999999'), dash: 'dash' } },
  })

  // Bland-Altman: two methods measuring the same samples.
  const truth = Array.from({ length: 40 }, () => r.normal(120, 25))
  const methods = b.table(
    columnTable(
      'Method comparison',
      {
        'Lab analyser': truth.map((v) => round(v + r.normal(0, 4))),
        'Point of care': truth.map((v) => round(v * 1.03 + 2 + r.normal(0, 5))),
      },
      'Glucose (mg/dL) of 40 samples measured by a lab analyser and a point-of-care device (each row one sample). Simulated with a small proportional bias. Bland-Altman plot of the differences against the averages, with the bias and 95% limits of agreement, and the correlation.',
    ),
  )
  const ba = b.analyze(methods, 'blandAltman', {}, { name: 'Bland-Altman' })
  const limit = { stroke: { ...stroke('#666666'), dash: 'dash' as const } }
  restyle(b, ba, {
    pairs: { color: { rgb: '#0072b2' } },
    bias: { stroke: stroke('#000000', 1.5) },
    upper: limit,
    lower: limit,
  })
  b.analyze(methods, 'correlation', {}, { name: 'Correlation' })
  b.analyze(
    methods,
    'powerAnalysis',
    { design: 'correlation', r: 0.3, power: 0.8 },
    { name: 'Sample size to detect r = 0.3', keys: [] },
  )

  // Observed vs. expected counts (parts of whole): Mendel's peas against the 9:3:3:1 ratio.
  const peas = createTable({
    name: 'Pea phenotypes',
    tableKind: 'partsOfWhole',
    columns: 1,
    rows: 4,
  })
  peas.rowTitles = ['Round yellow', 'Round green', 'Wrinkled yellow', 'Wrinkled green']
  peas.dataSets[0]!.title = 'Peas'
  peas.dataSets[0]!.subcolumns[0]!.values = [315, 108, 101, 32]
  peas.notes =
    'Mendel’s dihybrid cross (556 peas), a textbook example. Compared with the 9:3:3:1 ratio by the chi-square goodness-of-fit test (P = 0.93: no evidence against the ratio).'
  b.table(peas)
  b.analyze(
    peas,
    'goodnessOfFit',
    { expectedAs: 'percentages', expected: [56.25, 18.75, 18.75, 6.25] },
    { name: 'Observed vs. expected (9:3:3:1)' },
  )

  // Poisson regression: counts of hospital visits per patient-year.
  const visits: Record<string, number[]> = { Visits: [], Age: [], Smoker: [] }
  for (let i = 0; i < 80; i++) {
    const age = Math.round(30 + 45 * r.uniform())
    const smoker = r.uniform() < 0.35 ? 1 : 0
    const mu = Math.exp(-1.2 + 0.025 * age + 0.6 * smoker)
    // Poisson draw by inversion.
    let x = 0
    let pr = Math.exp(-mu)
    let cdf = pr
    const u = r.uniform()
    while (u > cdf && x < 100) {
      x++
      pr *= mu / x
      cdf += pr
    }
    visits.Visits!.push(x)
    visits.Age!.push(age)
    visits.Smoker!.push(smoker)
  }
  const visitTable = b.table(
    flatTable(
      'Hospital visits',
      'multipleVariables',
      visits,
      null,
      'Hospital visits in one year of 80 simulated patients (a Poisson count) with age and smoking (1 = smoker). Poisson regression: the rate ratios per year of age and for smokers.',
    ),
  )
  b.analyze(
    visitTable,
    'poissonRegression',
    { y: b.key(visitTable, 'Visits') },
    { name: 'Poisson regression (visits)' },
  )

  return b.project
}
