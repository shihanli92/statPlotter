import type { FontRegistry } from '@ps/graph'
import {
  type GraphNode,
  type Layer,
  newAnnotationId,
  newSeriesId,
  type Project,
  pointKey,
} from '@ps/model'
import { axis, ExampleBuilder, rng, round, title, xyTable } from './builder.ts'

/** Four-parameter logistic in log units. */
const logistic = (x: number, bottom: number, top: number, logEC50: number, hill: number) =>
  bottom + (top - bottom) / (1 + 10 ** ((logEC50 - x) * hill))

/**
 * Curve fitting and standard curves: a global dose-response fit with a shared parameter, a model
 * comparison and a test of whether one parameter differs, ELISA and BCA standard curves with
 * unknowns interpolated, enzyme inhibition with the inhibitor concentration as a data set
 * constant, a user-defined equation, ROUT with a residual plot, weighted fits with the test for
 * appropriate weighting, two intersecting lines, a different equation per data set, Deming and
 * simple logistic regression, and LOWESS / spline curves. All data are simulated (fixed seed).
 */
export function createCurveFitting(fonts: FontRegistry): Project {
  const b = new ExampleBuilder('Curve fitting and standard curves', fonts)
  const r = rng(303)
  const reps = (n: number, f: () => number, digits = 1) =>
    Array.from({ length: n }, () => round(f(), digits))

  // Dose-response: two agonists, same slope, different potency.
  const logDose = Array.from({ length: 11 }, (_, i) => -10 + i * 0.5)
  const agonist = (logEC50: number) =>
    logDose.map((x) => reps(3, () => logistic(x, 4, 100, logEC50, 1.4) + r.normal(0, 5)))
  const dr = b.table(
    xyTable(
      'Dose-response',
      'log[Agonist], M',
      logDose,
      { 'Agonist A': agonist(-8.1), 'Agonist B': agonist(-6.9) },
      'Response (% of maximum) to two agonists, triplicates at 11 concentrations. Simulated with a Hill slope of 1.4. A global fit shares the Hill slope between the two curves; a second fit compares the variable-slope model with a slope fixed at 1 (extra sum-of-squares F test and AICc).',
    ),
  )
  const drGraph = b.graph(dr, {
    preset: 'meanSd',
    yTitle: 'Response (%)',
    size: { plotWidth: 240 },
  })
  b.analyze(
    dr,
    'nonlinearFit',
    {
      equation: 'agonist-response-variable-slope',
      constraints: { HillSlope: { kind: 'shared' } },
      band: 'confidence',
    },
    { name: 'Global fit (shared Hill slope)' },
  )
  b.analyze(
    dr,
    'nonlinearFit',
    { equation: 'agonist-response-variable-slope', compareWith: 'agonist-response' },
    { name: 'Compare: variable vs. standard slope', link: false },
  )
  b.analyze(
    dr,
    'nonlinearFit',
    { equation: 'agonist-response-variable-slope', compareParams: ['LogEC50'] },
    { name: 'Does LogEC50 differ between the agonists?', link: false },
  )

  // ELISA: an IL-6 standard curve (duplicates) and five samples read off it.
  const stdConc = [1000, 500, 250, 125, 62.5, 31.25, 15.63, 7.81]
  const samples = [22, 48, 110, 260, 480]
  const od = (c: number) =>
    logistic(Math.log10(c), 0.06, 2.9, Math.log10(180), 1.1) * (1 + r.normal(0, 0.03))
  const elisa = b.table(
    xyTable(
      'ELISA standard curve',
      'log[IL-6], pg/mL',
      stdConc.map((c) => round(Math.log10(c), 3)),
      {
        OD450: [
          ...stdConc.map((c) => reps(2, () => od(c), 3)),
          ...samples.map((c) => reps(2, () => od(c), 3)),
        ],
      },
      `Optical density of IL-6 standards (duplicates; X is log10 of the concentration) and, below them, five samples with an OD but no X. The four-parameter fit interpolates each sample replicate (with a CI) into a result table; a Transform of that table turns log concentrations back into pg/mL. Simulated: the samples' true concentrations are ${samples.join(', ')} pg/mL.`,
    ),
  )
  elisa.rowTitles = [
    ...stdConc.map((c) => `Standard ${c} pg/mL`),
    ...samples.map((_, i) => `Sample ${i + 1}`),
  ]
  const elisaGraph = b.graph(elisa, {
    name: 'ELISA standard curve',
    preset: 'each',
    yTitle: 'OD_{450}',
    edit: (g) => ({ ...g, legend: { ...g.legend, show: false } }),
  })
  const elisaFit = b.analyze(
    elisa,
    'nonlinearFit',
    { equation: 'agonist-response-variable-slope', interpolate: true },
    { name: 'Standard curve fit (4PL) with interpolation' },
  )
  const odKey = b.key(elisa, 'OD450')
  // The unknowns on the standard curve: a graph of the interpolated values, plus the curve (the
  // standard curve's output layers, its series given ids of their own).
  const standard = b.project.nodes[elisaGraph.id] as GraphNode
  const curveLayers = (): { layers: Layer[]; ids: string[] } => {
    const ids: string[] = []
    const layers = standard.layers
      .filter((l) => l.data?.from === 'outputs' || l.data?.from === 'layer')
      .map((l): Layer => {
        if (l.data?.from !== 'outputs') return l
        const series = l.data.series.map((e) => {
          const id = newSeriesId()
          ids.push(id)
          return { ...e, id }
        })
        return { ...l, data: { from: 'outputs', series } } as Layer
      })
    return { layers, ids }
  }
  b.graph(elisaFit, {
    name: 'Interpolated unknowns',
    title: 'Samples on the standard curve',
    xTitle: 'log[IL-6], pg/mL',
    yTitle: 'OD_{450}',
    edit: (g) => {
      const curves = curveLayers()
      return {
        ...g,
        legend: { ...g.legend, show: false },
        style: { ...g.style, seriesDefaults: { color: { rgb: '#d55e00' } } },
        // Every replicate as a diamond, behind it the standard curve.
        layers: [
          ...curves.layers,
          {
            id: 'points',
            geom: 'points',
            stat: { kind: 'identity' },
            style: { shape: 'diamond', size: 7 },
          },
        ],
        seriesOverrides: Object.fromEntries(
          curves.ids.map((id) => [id, { color: { rgb: '#0072b2' } }]),
        ),
        // The first replicate of each sample (the table stacks two rows per sample) is labelled.
        pointOverrides: {
          [odKey]: Object.fromEntries(
            samples.map((_, i) => [pointKey(2 * i, 0), { label: `S${i + 1}` }]),
          ),
        },
      }
    },
  })
  b.analyze(
    elisaFit,
    'transform',
    { y: 'none', x: 'pow10' },
    { name: 'Interpolated concentrations (pg/mL)' },
  )

  // BCA assay: a linear standard curve with unknowns.
  const bsa = [0, 125, 250, 500, 750, 1000, 1500, 2000]
  const unknownsBsa = [180, 620, 1240]
  const absorb = (c: number) => 0.095 + 0.00098 * c + r.normal(0, 0.015)
  const bca = b.table(
    xyTable(
      'BCA protein assay',
      'BSA (µg/mL)',
      bsa,
      {
        A562: [
          ...bsa.map((c) => reps(2, () => absorb(c), 3)),
          ...unknownsBsa.map((c) => reps(2, () => absorb(c), 3)),
        ],
      },
      `Absorbance of BSA standards (duplicates) and three lysates below them (Y, no X), read off a straight line. Simulated: the lysates contain ${unknownsBsa.join(', ')} µg/mL.`,
    ),
  )
  b.graph(bca, {
    preset: 'each',
    yTitle: 'A_{562}',
    edit: (g) => ({ ...g, legend: { ...g.legend, show: false } }),
  })
  b.analyze(
    bca,
    'linearRegression',
    { interpolate: true, band: 'confidence' },
    { name: 'Linear standard curve' },
  )

  // Enzyme inhibition: data set titles are the inhibitor concentrations (data set constants).
  const substrate = [1, 2, 4, 8, 16, 32, 64]
  const velocity = (s: number, i: number) => (120 * s) / (6 * (1 + i / 3) + s)
  const inhibitors = [0, 2, 5, 10]
  const enzyme = b.table(
    xyTable(
      'Enzyme inhibition',
      '[Substrate], µM',
      substrate,
      Object.fromEntries(
        inhibitors.map((i) => [
          String(i),
          substrate.map((s) => reps(2, () => velocity(s, i) * (1 + r.normal(0, 0.04)))),
        ]),
      ),
      'Initial velocity at seven substrate concentrations with 0, 2, 5 or 10 µM inhibitor. Each data set’s title is its inhibitor concentration: the competitive inhibition model reads it as the data set constant I and fits Vmax, Km and Ki globally. Simulated with Vmax = 120, Km = 6 µM, Ki = 3 µM.',
    ),
  )
  const enzymeGraph = b.graph(enzyme, {
    preset: 'meanSd',
    yTitle: 'Velocity (nmol/min/mg)',
    size: { plotWidth: 240 },
    edit: (g) => ({
      ...g,
      annotations: [
        {
          type: 'text',
          id: newAnnotationId(),
          anchor: { space: 'plot', x: 1.04, y: -0.04 },
          content: title('[Inhibitor], µM', { size: 10, bold: true }),
        },
      ],
    }),
  })
  b.analyze(
    enzyme,
    'nonlinearFit',
    { equation: 'competitive-inhibition' },
    { name: 'Competitive inhibition (global)' },
  )

  // A user-defined equation: exponential decay to a plateau on a drifting baseline.
  const minutes = Array.from({ length: 16 }, (_, i) => i * 4)
  const decay = b.table(
    xyTable(
      'Photobleaching',
      'Time (min)',
      minutes,
      {
        Fluorescence: minutes.map((t) =>
          reps(2, () => 200 + 800 * Math.exp(-0.12 * t) + 1.5 * t + r.normal(0, 15), 0),
        ),
      },
      'Fluorescence decaying to a plateau while the baseline drifts upwards. Fit with a user-defined equation, Y = Plateau + Span*exp(-K*X) + Drift*X, from initial values. Simulated with Plateau = 200, Span = 800, K = 0.12, Drift = 1.5.',
    ),
  )
  b.graph(decay, {
    preset: 'each',
    yTitle: 'Fluorescence (AU)',
    edit: (g) => ({ ...g, legend: { ...g.legend, show: false } }),
  })
  b.analyze(
    decay,
    'nonlinearFit',
    {
      equation: 'user',
      userEquation: 'Y = Plateau + Span*exp(-K*X) + Drift*X',
      initialValues: { Plateau: 150, Span: 700, K: 0.1, Drift: 1 },
    },
    { name: 'User-defined equation' },
  )

  // ROUT: saturation binding with one bad replicate, a residual plot and diagnostics.
  const ligand = [0.5, 1, 2, 4, 6, 8, 12, 16, 24, 32]
  const binding = ligand.map((l) => reps(3, () => (1800 * l) / (4 + l) + r.normal(0, 40), 0))
  const outlierRow = 6
  binding[outlierRow]![1] = round(binding[outlierRow]![1]! * 0.55, 0)
  const bind = b.table(
    xyTable(
      'Binding with an outlier',
      '[Ligand], nM',
      ligand,
      { 'Specific binding': binding },
      `Specific binding (cpm) of a radioligand, triplicates. One replicate at ${ligand[outlierRow]} nM was planted as an outlier (45% low). The fit uses ROUT (Q = 1%) to find and remove it, and shows a residual plot, the runs test and a normality test of the residuals. Simulated with Bmax = 1800, Kd = 4 nM.`,
    ),
  )
  const bindKey = b.key(bind, 'Specific binding')
  const bindGraph = b.graph(bind, {
    preset: 'each',
    yTitle: 'Specific binding (cpm)',
    edit: (g) => ({
      ...g,
      legend: { ...g.legend, show: false },
      pointOverrides: {
        [bindKey]: {
          [pointKey(outlierRow, 1)]: {
            color: { rgb: '#d55e00' },
            fill: { type: 'none' },
            label: 'Outlier',
          },
        },
      },
    }),
  })
  const rout = b.analyze(
    bind,
    'nonlinearFit',
    {
      equation: 'one-site-specific',
      outliers: 'eliminate',
      diagnostics: { residuals: true, runsTest: true, normality: true },
    },
    { name: 'One site binding with ROUT' },
  )
  for (const g of b.outputGraphs(rout))
    b.edit(g, (x) => ({
      ...x,
      axes: { ...x.axes, x: axis(x.axes.x, { title: title('[Ligand], nM') }) },
      annotations: [
        {
          type: 'line',
          id: newAnnotationId(),
          space: 'data',
          from: { x: 0, y: 0 },
          to: { x: 32, y: 0 },
          stroke: { color: { rgb: '#888888' }, width: 1, dash: 'dash' },
          arrow: 'none',
          behind: true,
        },
      ],
    }))

  // Weighted fit: a decay whose scatter grows with Y (constant CV), weighted by 1/Y².
  const clearanceMin = [0, 2, 4, 6, 8, 12, 16, 20, 25, 30, 40, 50, 60]
  const clearance = b.table(
    xyTable(
      'Drug clearance',
      'Minutes',
      clearanceMin,
      {
        Plasma: clearanceMin.map((t) =>
          reps(3, () => (5 + 95 * Math.exp(-0.08 * t)) * (1 + r.normal(0, 0.08)), 2),
        ),
      },
      'Plasma concentration after a bolus, triplicates. Simulated with a constant 8% CV, so the scatter grows with Y: a one-phase decay weighted by 1/Y², with the test for appropriate weighting (a large P value: the weighting suits the data) and Hougaard’s skewness of the weighted fit.',
    ),
  )
  const decayGraph = b.graph(clearance, { preset: 'meanSd', yTitle: 'Concentration (ng/mL)' })
  b.analyze(
    clearance,
    'nonlinearFit',
    { equation: 'one-phase-decay', weighting: 'relative', weightingTest: true, hougaard: true },
    { name: 'One-phase decay (weighted 1/Y²)' },
  )

  // Two intersecting lines: growth before and after a treatment, sharing the crossing point.
  const days = Array.from({ length: 13 }, (_, i) => i)
  const before = days.map((d) => (d <= 7 ? [round(20 + 6 * (d - 7) + r.normal(0, 1.5))] : [null]))
  const after = days.map((d) => (d >= 5 ? [round(20 - 3 * (d - 7) + r.normal(0, 1.5))] : [null]))
  const lines = b.table(
    xyTable(
      'Treatment switch',
      'Day',
      days,
      { Rising: before, Falling: after },
      'A tumour volume index rising until about day 7 and falling after a treatment switch, the two phases overlapping on days 5–7. Simulated lines crossing at day 7, volume 20. “Two intersecting lines” fits one line per data set sharing the crossing point (Xcross, Ycross).',
    ),
  )
  const linesGraph = b.graph(lines, { yTitle: 'Volume index' })
  b.analyze(
    lines,
    'nonlinearFit',
    { equation: 'two-lines-crossing' },
    { name: 'Two lines: crossing point and slopes' },
  )

  // A different equation per data set: saturable uptake, and a straight nonspecific background.
  const conc = [0.5, 1, 2, 4, 8, 16, 32, 64]
  const mixed = b.table(
    xyTable(
      'Uptake and background',
      'Substrate, µM',
      conc,
      {
        Uptake: conc.map((c) => reps(2, () => (120 * c) / (6 + c) + r.normal(0, 4))),
        Background: conc.map((c) => reps(2, () => 3 + 0.4 * c + r.normal(0, 1.5))),
      },
      'Transport of a substrate (saturable, Michaelis-Menten) and nonspecific background (linear), duplicates. Simulated. One analysis fits a different equation to each data set.',
    ),
  )
  const mixedGraph = b.graph(mixed, { preset: 'meanSd', yTitle: 'Rate (pmol/min)' })
  b.analyze(
    mixed,
    'nonlinearFit',
    {
      equation: 'michaelis-menten',
      equationByDataSet: { [b.key(mixed, 'Background')]: { equation: 'straight-line' } },
    },
    { name: 'Michaelis-Menten and straight line' },
  )

  // Deming regression: two assays that both measure with error.
  const truth = Array.from({ length: 25 }, () => 20 + 180 * r.uniform())
  const assays = b.table(
    xyTable(
      'Two assays',
      'Assay A (mg/dL)',
      truth.map((v) => round(v + r.normal(0, 6))),
      { 'Assay B': truth.map((v) => [round(1.05 * v - 3 + r.normal(0, 6))]) },
      'The same 25 samples measured by two assays with similar imprecision. Simulated with a 5% proportional difference. Deming regression (X and Y equally uncertain) rather than ordinary regression, which assumes X is exact.',
    ),
  )
  const assayGraph = b.graph(assays, { yTitle: 'Assay B (mg/dL)' })
  b.analyze(assays, 'deming', {}, { name: 'Deming regression' })

  // Simple logistic regression: a binary outcome against a dose.
  const doses = Array.from({ length: 48 }, (_, i) => round(0.25 * (i % 16) + 0.5, 2))
  const killed = doses.map((d) => [r.uniform() < 1 / (1 + Math.exp(-(-5 + 2.2 * d))) ? 1 : 0])
  const lethality = b.table(
    xyTable(
      'Lethality',
      'Dose (mg/kg)',
      doses,
      { 'Died?': killed },
      '48 animals, 16 doses (three animals each); Y is 1 when the animal died. Simulated with an LD50 of 2.3 mg/kg. Simple logistic regression gives X at 50% (the LD50) and the fitted probability curve.',
    ),
  )
  const lethalityGraph = b.graph(lethality, { yTitle: 'Died (1) or survived (0)' })
  b.analyze(lethality, 'simpleLogistic', {}, { name: 'Simple logistic regression' })

  // LOWESS and an Akima spline: curves without a model.
  const hours = Array.from({ length: 48 }, (_, i) => i * 0.5)
  const glucose = b.table(
    xyTable(
      'Glucose trace',
      'Hours',
      hours,
      {
        Glucose: hours.map((h) => [
          round(
            95 +
              30 * Math.exp(-(((h - 6) / 2) ** 2)) +
              20 * Math.exp(-(((h - 13) / 1.5) ** 2)) +
              r.normal(0, 6),
          ),
        ]),
      },
      'A continuous glucose monitor reading every 30 minutes. Simulated with two meal peaks. A medium LOWESS curve shows the trend without a model.',
    ),
  )
  const glucoseGraph = b.graph(glucose, { yTitle: 'Glucose (mg/dL)' })
  b.analyze(glucose, 'fitSpline', { method: 'lowess', lowess: 'medium' }, { name: 'LOWESS' })
  b.analyze(
    clearance,
    'fitSpline',
    { method: 'akima' },
    { name: 'Akima spline through the means', link: false },
  )

  // ---- roadmap 20: equations and simulation -------------------------------------------------------

  // A user-defined equation with a special function: the gamma variate of a tracer's first pass.
  const tSec = Array.from({ length: 30 }, (_, i) => (i + 1) * 1.5)
  const gammaVariate = (t: number) =>
    // Γ(3.5) = 15√π/8.
    (800 * t ** (3.5 - 1) * Math.exp(-t / 3)) / (((15 * Math.sqrt(Math.PI)) / 8) * 3 ** 3.5)
  const bolus = b.table(
    xyTable(
      'Tracer first pass',
      'Seconds',
      tSec,
      { Signal: tSec.map((t) => [round(gammaVariate(t) + r.normal(0, 0.6), 2)]) },
      'Indicator concentration after a bolus, every 1.5 s. The gamma-variate model is a user-defined equation using Prism’s gamma() function: Y = A·X^(B−1)·exp(−X/C)/(gamma(B)·C^B), with A the area under the curve. Simulated with A = 800, B = 3.5, C = 3 s.',
    ),
  )
  const bolusGraph = b.graph(bolus, { yTitle: 'Signal' })
  b.analyze(
    bolus,
    'nonlinearFit',
    {
      equation: 'user',
      userEquation: 'Y = A*X^(B - 1)*exp(-X/C)/(gamma(B)*C^B)',
      initialRules: {
        A: { value: 30, rule: 'ymax' },
        B: { value: 3, rule: 'value' },
        C: { value: 0.3, rule: 'xatymid' },
      },
    },
    { name: 'Gamma variate (user equation with gamma())' },
  )

  // A differential equation: substrate depletion by an enzyme (no closed form in elementary
  // functions), fit directly as Y' = −Vmax·Y/(Km + Y) from Y[0] at time 0.
  const depletionMinutes = Array.from({ length: 16 }, (_, i) => i * 4)
  const depletion = (t: number) => {
    // Km·ln(S0/S) + S0 − S = Vmax·t, solved by bisection.
    let lo = 1e-12
    let hi = 100
    for (let k = 0; k < 200; k++) {
      const s = (lo + hi) / 2
      if (20 * Math.log(100 / s) + 100 - s - 3 * t > 0) lo = s
      else hi = s
    }
    return (lo + hi) / 2
  }
  const depleted = b.table(
    xyTable(
      'Substrate depletion',
      'Minutes',
      depletionMinutes,
      { Substrate: depletionMinutes.map((t) => reps(2, () => depletion(t) + r.normal(0, 1), 2)) },
      'Substrate remaining (µM) while an enzyme consumes it, duplicates every 4 minutes. The Michaelis-Menten rate law is fit as a differential equation, Y′ = −Vmax·Y/(Km + Y), starting from the parameter Y[0] at X = 0. Simulated with S0 = 100 µM, Vmax = 3 µM/min, Km = 20 µM.',
    ),
  )
  const substrateGraph = b.graph(depleted, { preset: 'meanSd', yTitle: 'Substrate (µM)' })
  b.analyze(
    depleted,
    'nonlinearFit',
    {
      equation: 'user',
      userEquation: "Y' = -Vmax*Y/(Km + Y)",
      initialValues: { Vmax: 1, Km: 10 },
      band: 'confidence',
    },
    { name: 'Differential equation fit' },
  )

  // New built-in equations: Gaddum/Schild with the antagonist concentration from the column titles.
  const agonistConc = Array.from({ length: 15 }, (_, i) => 1e-11 * 10 ** (i * 0.5))
  const schild = (b0: number) =>
    agonistConc.map((c) => [
      round(100 / (1 + ((1e-8 * (1 + (b0 * 10 ** 8) ** 1)) / c) ** 1) + r.normal(0, 3), 1),
    ])
  const antagonism = b.table(
    xyTable(
      'Antagonist shifts',
      '[Agonist], M',
      agonistConc,
      { '0': schild(0), '1e-8': schild(1e-8), '1e-7': schild(1e-7), '1e-6': schild(1e-6) },
      'Agonist concentration-response curves (X is the molar concentration, not its log) with a competitive antagonist at 0, 10 nM, 100 nM and 1 µM: the column titles are the antagonist concentrations. “Gaddum/Schild EC50 shift, X is concentration” fits all four curves at once, B taken from the titles (a data set constant), to find pA2 and the Schild slope. Simulated with EC50 = 10 nM and pA2 = 8.',
    ),
  )
  const antagonismGraph = b.graph(antagonism, {
    yTitle: 'Response (%)',
    edit: (g) => ({ ...g, axes: { ...g.axes, x: axis(g.axes.x, { scale: 'log10' }) } }),
  })
  b.analyze(
    antagonism,
    'nonlinearFit',
    { equation: 'gaddum-schild-conc' },
    { name: 'Gaddum/Schild (X is concentration)' },
  )
  b.analyze(
    antagonism,
    'nonlinearFit',
    { equation: 'agonist-conc-response-variable-slope' },
    { name: '[Agonist] vs. response, each curve on its own', link: false },
  )

  // Simulations and a Monte Carlo analysis: the power of an unpaired t test with n = 8 per group.
  const simulated = b.analyze(
    dr,
    'simulateXY',
    {
      xMode: 'arithmetic',
      xStart: -10,
      xStep: 0.5,
      xEnd: -5,
      equation: 'agonist-response-variable-slope',
      dataSets: [
        { title: 'Simulated', values: { Bottom: 0, Top: 100, LogEC50: -7.5, HillSlope: 1 } },
      ],
      replicates: 3,
      error: 'gaussian',
      sd: 8,
      seed: 20,
    },
    { name: 'Simulate XY data', keys: [], link: false },
  )
  b.graph(simulated, { name: 'Simulated dose-response', yTitle: 'Response' })
  b.analyze(
    dr,
    'monteCarlo',
    {
      simulation: {
        analysisId: 'simulateColumn',
        params: {
          columns: [
            { title: 'Control', n: 8, mean: 100 },
            { title: 'Treated', n: 8, mean: 115 },
          ],
          error: 'gaussian',
          sd: 15,
        },
      },
      analysis: { analysisId: 'ttest', params: {} },
      simulations: 500,
      seed: 11,
      tabulate: ['p', 'diff'],
      hits: { combine: 'both', conditions: [{ value: 'p', op: '<', than: 0.05 }] },
    },
    { name: 'Monte Carlo: power of an unpaired t test', keys: [], link: false },
  )

  b.layout('Figure (equations and simulation)', [bolusGraph, substrateGraph, antagonismGraph], {
    columns: 2,
    equalize: false,
  })
  b.layout(
    'Figure (more curve fitting)',
    [decayGraph, linesGraph, mixedGraph, assayGraph, lethalityGraph, glucoseGraph],
    { columns: 2, equalize: false },
  )
  b.layout('Figure (curve fitting)', [drGraph, elisaGraph, enzymeGraph, bindGraph], {
    columns: 2,
    equalize: false,
  })
  return b.project
}
