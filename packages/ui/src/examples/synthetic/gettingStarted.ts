import type { FontRegistry } from '@ps/graph'
import type { Project } from '@ps/model'
import {
  addLayer,
  columnTable,
  draws,
  ExampleBuilder,
  layerStyle,
  removeLayer,
  rng,
} from './builder.ts'

/**
 * Getting started: column tables, t tests and one-way ANOVA, the common column graphs with live
 * significance brackets, and a figure page. All data are simulated (fixed seed).
 */
export function createGettingStarted(fonts: FontRegistry): Project {
  const b = new ExampleBuilder('Getting started: column data', fonts)
  const r = rng(101)

  // Two groups: the treated group is higher and a little more variable.
  const two = b.table(
    columnTable(
      'Enzyme activity',
      {
        Control: draws(10, () => r.normal(42, 6)),
        Treated: draws(10, () => r.normal(53, 9)),
      },
      'Enzyme activity (U/mg protein) in 10 control and 10 treated cultures. Simulated data. Compare the unpaired t test, Welch’s t test (no equal-SD assumption) and the Mann-Whitney test. The estimation plot shows the same comparison as an effect size: the difference between the means with its 95% CI on a floating right axis whose zero is the control mean.',
    ),
  )
  const scatter = b.graph(two, {
    preset: 'points',
    name: 'Enzyme activity (scatter)',
    yTitle: 'Activity (U/mg)',
  })
  b.graph(two, {
    preset: 'estimation',
    name: 'Enzyme activity (estimation plot)',
    yTitle: 'Activity (U/mg)',
    size: { plotWidth: 150 },
  })
  const t = b.analyze(two, 'ttest', {}, { name: 'Unpaired t test' })
  b.analyze(two, 'ttest', { unpaired: { assumeEqualSD: false } }, { name: 'Welch’s t test' })
  b.analyze(two, 'mannWhitney', {}, { name: 'Mann-Whitney test' })
  b.analyze(two, 'descriptive', {}, { name: 'Descriptive statistics' })
  b.brackets(scatter, t, { show: 'number' })

  // Three doses: one-way ANOVA with Tukey's comparisons, bars with every point.
  const doses = b.table(
    columnTable(
      'Dose response (3 groups)',
      {
        Vehicle: draws(8, () => r.normal(20, 3.5)),
        '1 mg/kg': draws(8, () => r.normal(24.5, 3.5)),
        '10 mg/kg': draws(8, () => r.normal(31, 3.5)),
      },
      'Plasma marker (ng/mL) in three dose groups of 8 animals. Simulated data. One-way ANOVA with Tukey’s multiple comparisons; the brackets on the graph are live. Each bar is labelled with its mean (Format graph › Appearance › Bar labels).',
    ),
  )
  const bars = b.graph(doses, {
    preset: 'barsPoints',
    name: 'Dose response (bars)',
    yTitle: 'Marker (ng/mL)',
    edit: (g) =>
      addLayer(g, {
        id: 'labels',
        geom: 'label',
        stat: { kind: 'summary', center: 'mean' },
        on: 'bars',
        style: { value: 'mean', position: 'above', format: { mode: 'fixed', digits: 1 } },
      }),
  })
  const anova = b.analyze(
    doses,
    'oneWayAnova',
    { comparisons: 'allPairs', allPairsMethod: 'tukey' },
    { name: 'One-way ANOVA (Tukey)' },
  )
  b.analyze(doses, 'normality', {}, { name: 'Normality tests' })
  b.brackets(bars, anova, { show: 'stars' })

  // Many values per group: a swarm of every point, median line, Kruskal-Wallis with Dunn's test.
  const cells = b.table(
    columnTable(
      'Cell area',
      {
        WT: draws(60, () => r.lognormal(Math.log(180), 0.3), 0),
        'KO 1': draws(60, () => r.lognormal(Math.log(215), 0.3), 0),
        'KO 2': draws(60, () => r.lognormal(Math.log(190), 0.3), 0),
      },
      'Area of 60 cells (µm²) per cell line, from microscopy. Simulated, right-skewed data. A swarm of every point with the median, and the Kruskal-Wallis test with Dunn’s comparisons. The violin plot shows the same data as smoothed distributions (kernel density), with lines at the median and quartiles.',
    ),
  )
  const swarm = b.graph(cells, {
    preset: 'pointsMedian',
    name: 'Cell area (swarm)',
    yTitle: 'Cell area (µm^{2})',
    size: { plotWidth: 180 },
    edit: (g) =>
      layerStyle(
        layerStyle(removeLayer(g, 'error'), 'points', { size: 4, fill: { type: 'none' } }),
        'center',
        { width: 0.5, line: { color: { rgb: '#000000' }, width: 2, dash: 'solid' } },
      ),
  })
  b.graph(cells, {
    preset: 'violinPoints',
    name: 'Cell area (violin)',
    yTitle: 'Cell area (µm^{2})',
    size: { plotWidth: 180 },
    edit: (g) => layerStyle(layerStyle(g, 'points', { size: 2.5 }), 'violin', { width: 0.8 }),
  })
  const kw = b.analyze(
    cells,
    'oneWayAnova',
    { gaussian: false, comparisons: 'allPairs' },
    { name: 'Kruskal-Wallis test (Dunn)' },
  )
  b.brackets(swarm, kw, { show: 'stars' })

  b.layout('Figure 1', [scatter, bars, swarm], { columns: 3, landscape: true, equalize: false })
  return b.project
}
