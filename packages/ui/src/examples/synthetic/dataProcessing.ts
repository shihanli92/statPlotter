import { type FontRegistry, nestedOf, withNested } from '@ps/graph'
import { type Project, pointKey } from '@ps/model'
import {
  addLayer,
  axis,
  columnTable,
  draws,
  ExampleBuilder,
  layerStyle,
  nestedTable,
  rng,
  round,
  xyTable,
} from './builder.ts'

/**
 * Data processing and nested data: analyses that make tables (Transform, Normalize, Remove
 * baseline, Frequency distribution, Identify outliers) feeding other analyses and graphs, area
 * under the curve, and a nested table with the nested t test and one-way ANOVA. All data are
 * simulated (fixed seed).
 */
export function createDataProcessing(fonts: FontRegistry): Project {
  const b = new ExampleBuilder('Data processing and nested data', fonts)
  const r = rng(404)
  const reps = (n: number, f: () => number, digits = 1) =>
    Array.from({ length: n }, () => round(f(), digits))

  // Transform → t test: lognormal data are compared on the log scale.
  const skewed = b.table(
    columnTable(
      'IL-6 (skewed)',
      {
        Control: draws(12, () => r.lognormal(Math.log(40), 0.6), 1),
        Infected: draws(12, () => r.lognormal(Math.log(95), 0.6), 1),
      },
      'Serum IL-6 (pg/mL) in 12 control and 12 infected mice. Simulated lognormal data: right-skewed, with the spread growing with the mean. Transform (Y = log(Y)) makes a table of log10 values, and the t test analyzes that table; both update when a value here changes.',
    ),
  )
  b.graph(skewed, {
    preset: 'pointsMean',
    yTitle: 'IL-6 (pg/mL)',
    edit: (g) => ({ ...g, axes: { ...g.axes, y: axis(g.axes.y, { scale: 'log10' }) } }),
    title: 'IL-6 (log axis)',
  })
  const logs = b.analyze(skewed, 'transform', { y: 'log10' }, { name: 'log10 of IL-6' })
  const logGraph = b.graph(logs, {
    name: 'log10 IL-6',
    preset: 'points',
    title: 'log_{10} IL-6',
    yTitle: 'log_{10} IL-6 (pg/mL)',
  })
  const logT = b.analyze(logs, 'ttest', {}, { name: 't test of log10 IL-6' })
  b.brackets(logGraph, logT, { show: 'number' })

  // Normalize → curve fit: each data set scaled from its smallest (0%) to largest (100%) value.
  const logDose = Array.from({ length: 9 }, (_, i) => -9 + i * 0.5)
  const rlu = (bottom: number, top: number, logEC50: number) =>
    logDose.map((x) =>
      reps(
        3,
        () => (bottom + (top - bottom) / (1 + 10 ** (logEC50 - x))) * (1 + r.normal(0, 0.05)),
        0,
      ),
    )
  const reporter = b.table(
    xyTable(
      'Reporter assay (raw)',
      'log[Agonist], M',
      logDose,
      {
        'Cell line 1': rlu(1200, 48000, -7.4),
        'Cell line 2': rlu(800, 21000, -6.8),
      },
      'Luciferase signal (RLU), triplicates, in two cell lines with very different signal windows. Simulated data. Normalize scales each data set from its smallest (0%) to its largest (100%) mean; a normalized dose-response curve is then fit to the normalized table (a chained analysis).',
    ),
  )
  b.graph(reporter, { preset: 'meanSd', yTitle: 'Luminescence (RLU)' })
  const normalized = b.analyze(reporter, 'normalize', {}, { name: 'Normalized response' })
  b.graph(normalized, {
    name: 'Normalized response',
    preset: 'meanSd',
    title: 'Normalized response',
    xTitle: 'log[Agonist], M',
    yTitle: 'Response (%)',
  })
  b.analyze(
    normalized,
    'nonlinearFit',
    { equation: 'agonist-normalized-response-variable-slope' },
    { name: 'Fit of normalized response' },
  )

  // Remove baseline → area under the curve: blank wells subtracted, then the area of each trace.
  const seconds = Array.from({ length: 16 }, (_, i) => i * 4)
  const drift = (t: number) => 100 + 0.8 * t
  const pulse = (t: number, height: number) =>
    t < 8 ? 0 : height * ((t - 8) / 8) * Math.exp(1 - (t - 8) / 8)
  const calcium = b.table(
    xyTable(
      'Calcium traces',
      'Time (s)',
      seconds,
      {
        Blank: seconds.map((t) => reps(3, () => drift(t) + r.normal(0, 3), 0)),
        Agonist: seconds.map((t) => reps(3, () => drift(t) + pulse(t, 220) + r.normal(0, 8), 0)),
        'Agonist + antagonist': seconds.map((t) =>
          reps(3, () => drift(t) + pulse(t, 90) + r.normal(0, 8), 0),
        ),
      },
      'Fluorescence of a calcium dye (triplicate wells) after adding agonist at 8 s. Blank wells drift upwards. Simulated data. Remove baseline subtracts the blank at each time; area under the curve then measures each baseline-corrected response.',
    ),
  )
  b.graph(calcium, {
    preset: 'meanSd',
    yTitle: 'Fluorescence (AU)',
    // The means joined, behind the symbols and error bars.
    edit: (g) =>
      addLayer(g, { id: 'line', geom: 'line', stat: { kind: 'summary', center: 'mean' } }, 0),
  })
  const corrected = b.analyze(
    calcium,
    'removeBaseline',
    { mode: 'dataSet', baseline: b.key(calcium, 'Blank') },
    { name: 'Blank subtracted' },
  )
  b.graph(corrected, {
    name: 'Blank subtracted',
    preset: 'meanSd',
    title: 'Blank subtracted',
    xTitle: 'Time (s)',
    yTitle: 'ΔFluorescence (AU)',
    // The means joined, behind the symbols and error bars.
    edit: (g) =>
      addLayer(g, { id: 'line', geom: 'line', stat: { kind: 'summary', center: 'mean' } }, 0),
  })
  b.analyze(corrected, 'areaUnderCurve', {}, { name: 'Area under the curve' })

  // Frequency distribution and its graph.
  const diameters = b.table(
    columnTable(
      'Cell diameters',
      {
        Resting: draws(150, () => r.normal(11, 1.4), 1),
        Activated: draws(150, () => r.normal(14, 1.8), 1),
      },
      'Diameters (µm) of 150 resting and 150 activated cells. Simulated data. Frequency distribution bins them (automatic bin width) into an XY table of bin centres, graphed as a histogram: bars a bin wide at the bin centres, the two groups overlapping in translucent colours.',
    ),
  )
  const freq = b.analyze(diameters, 'frequencyDistribution', {}, { name: 'Frequency distribution' })
  b.graph(freq, {
    name: 'Frequency distribution',
    preset: 'histogram',
    title: 'Frequency distribution',
    xTitle: 'Diameter (µm)',
    yTitle: 'Number of cells',
    edit: (g) =>
      layerStyle(g, 'bars', { fill: { type: 'solid', color: { series: true }, opacity: 0.45 } }),
  })

  // Identify outliers → cleaned data → one-way ANOVA.
  const assay = columnTable(
    'Assay with an outlier',
    {
      'Batch 1': draws(8, () => r.normal(52, 3)),
      'Batch 2': draws(8, () => r.normal(55, 3)),
      'Batch 3': draws(8, () => r.normal(61, 3)),
    },
    'Potency (%) of three production batches, 8 assays each. One assay of batch 2 (row 4) was planted as an outlier. Identify outliers (ROUT, Q = 1%) finds it and makes a cleaned table with it left out; the one-way ANOVA analyzes the cleaned table.',
  )
  const outlierRow = 3
  assay.dataSets[1]!.subcolumns[0]!.values[outlierRow] = 91.4
  b.table(assay)
  const assayKey = b.key(assay, 'Batch 2')
  b.graph(assay, {
    preset: 'points',
    yTitle: 'Potency (%)',
    edit: (g) => ({
      ...g,
      pointOverrides: {
        [assayKey]: { [pointKey(outlierRow, 0)]: { color: { rgb: '#d55e00' }, label: 'Outlier' } },
      },
    }),
  })
  const cleaned = b.analyze(assay, 'identifyOutliers', {}, { name: 'Outliers (ROUT)' })
  const cleanGraph = b.graph(cleaned, {
    name: 'Assay, outlier removed',
    preset: 'points',
    title: 'Outlier removed',
    yTitle: 'Potency (%)',
  })
  const cleanAnova = b.analyze(
    cleaned,
    'oneWayAnova',
    {},
    { name: 'One-way ANOVA of cleaned data' },
  )
  b.brackets(cleanGraph, cleanAnova, { show: 'stars' })

  // Nested data: cells (rows) measured in each mouse (subcolumns) of three groups.
  const group = (mean: number, first: number) =>
    Object.fromEntries(
      Array.from({ length: 4 }, (_, m) => {
        const mouse = r.normal(mean, 2.2)
        return [`Mouse ${first + m}`, draws(6, () => r.normal(mouse, 1.5))]
      }),
    )
  const nested = b.table(
    nestedTable(
      'Dendritic spines',
      { Control: group(12, 1), 'Drug A': group(16, 5), 'Drug B': group(12.5, 9) },
      'Spine density (per 10 µm) of 6 neurons (rows) in each of 4 mice (subcolumns) per group. Simulated with mice differing more than neurons within a mouse, so the mouse is the experimental unit. Nested one-way ANOVA (mixed model) and a nested t test of Control vs. Drug A.',
    ),
  )
  const nestedGraph = b.graph(nested, {
    preset: 'pointsMean',
    yTitle: 'Spines per 10 µm',
    edit: (g) => ({
      ...g,
      layers: withNested(g.layers, { ...nestedOf(g.layers), subjectMeans: true }),
    }),
  })
  const nestedAnova = b.analyze(nested, 'nestedOneWay', {}, { name: 'Nested one-way ANOVA' })
  b.analyze(
    nested,
    'nestedT',
    {},
    {
      name: 'Nested t test (Control vs. Drug A)',
      keys: [b.key(nested, 'Control'), b.key(nested, 'Drug A')],
    },
  )
  b.brackets(nestedGraph, nestedAnova, { show: 'stars' })
  return b.project
}
