import { type FontRegistry, sliceGraphs } from '@ps/graph'
import { graphOutputs, type Project } from '@ps/model'
import { legendOnLast } from '../../graph/builder/GraphBuilder.tsx'
import { draws, ExampleBuilder, groupedTable, rng, round, title, withLayer } from './builder.ts'

/**
 * Grouped data: two-way ANOVA (ordinary and repeated measures), multiple t tests with a volcano
 * plot, multiple one-way ANOVAs, a three-way ANOVA, row statistics and fraction of total, with
 * grouped bar and time-course graphs. All data are simulated (fixed seed).
 */
export function createGroupedExample(fonts: FontRegistry): Project {
  const b = new ExampleBuilder('Grouped data', fonts)
  const r = rng(202)
  const cells = (means: number[], sd: number, n: number, digits = 1) =>
    means.map((m) => draws(n, () => r.normal(m, sd), digits))

  // Two-way ANOVA: the drug works better in knockouts (an interaction).
  const genotype = b.table(
    groupedTable(
      'Genotype × treatment',
      ['Wild type', 'Knockout'],
      { Vehicle: cells([40, 42], 5, 6), Drug: cells([47, 63], 5, 6) },
      'Rows are genotypes, data sets treatments, 6 mice per cell (subcolumns). Simulated data with a larger drug effect in knockouts. Two-way ANOVA with Šidák’s comparisons of the treatments within each genotype.',
    ),
  )
  const genoBars = b.graph(genotype, {
    preset: 'barsPoints',
    yTitle: 'Response (AU)',
  })
  const twoWay = b.analyze(
    genotype,
    'twoWayAnova',
    { comparisons: 'withinRows', allPairsMethod: 'sidak' },
    { name: 'Two-way ANOVA (Šidák)' },
  )
  b.brackets(genoBars, twoWay, { show: 'stars', maxP: Number.POSITIVE_INFINITY })

  // Repeated measures: each subject is a subcolumn followed over time (rows).
  const hours = [0, 1, 2, 4, 8, 24]
  // A rise to `peak` above baseline at 2 h, then a decline.
  const course = (peak: number) => hours.map((h) => 10 + (peak * h * Math.exp(1 - h / 2)) / 2)
  const subjects = (profile: number[]) => {
    const offsets = draws(6, () => r.normal(0, 2))
    return profile.map((m) => offsets.map((o) => round(m + o + r.normal(0, 1.5))))
  }
  const time = b.table(
    groupedTable(
      'Time course (repeated measures)',
      hours.map((h) => `${h} h`),
      { Placebo: subjects(course(1.5)), Drug: subjects(course(16)) },
      'Plasma level of 6 subjects per group (subcolumns) at six times (rows). Simulated data. Two-way repeated-measures ANOVA (rows repeated, Geisser-Greenhouse), Šidák’s comparisons at each time, and row statistics.',
    ),
  )
  const timeGraph = b.graph(time, {
    preset: 'connected',
    xTitle: 'Time after dose',
    yTitle: 'Plasma level (ng/mL)',
    size: { plotWidth: 240 },
    edit: (g) =>
      withLayer(g, 'error', (l) => ({
        ...l,
        stat: { kind: 'summary', center: 'mean', error: 'SEM' },
      })),
  })
  b.analyze(
    time,
    'twoWayAnova',
    { repeated: 'rows', comparisons: 'withinRows', allPairsMethod: 'sidak' },
    { name: 'Two-way RM ANOVA' },
  )
  b.analyze(time, 'rowStats', { ci: true }, { name: 'Row statistics' })

  // Multiple t tests, one per gene, and the volcano plot.
  const genes = Array.from({ length: 30 }, (_, i) => `Gene ${String(i + 1).padStart(2, '0')}`)
  const change = genes.map((_, i) => (i < 6 ? 1.6 - 0.15 * i : i < 9 ? -1.3 : 0))
  const base = genes.map(() => r.normal(8, 1.2))
  const expression = b.table(
    groupedTable(
      'Gene expression',
      genes,
      {
        Control: base.map((m) => draws(4, () => r.normal(m, 0.35), 2)),
        Treated: base.map((m, i) => draws(4, () => r.normal(m + change[i]!, 0.35), 2)),
      },
      'log2 expression of 30 genes (rows) in 4 control and 4 treated samples. Simulated: genes 1–6 go up, 7–9 down. Multiple unpaired t tests (Welch), one per row, with the two-stage FDR method; the volcano plot is the analysis’ own graph, its discoveries labelled with the gene names (row titles).',
    ),
  )
  const multi = b.analyze(
    expression,
    'multipleT',
    { difference: 'bMinusA' },
    { name: 'Multiple t tests (one per gene)' },
  )
  const volcano = b.outputGraphs(multi)[0]!
  b.edit(volcano, (g) => ({
    ...g,
    axes: {
      ...g.axes,
      x: { ...g.axes.x, title: title('Difference (log_{2} fold change)') },
    },
    legend: { ...g.legend, show: false },
    // The discoveries in orange, labelled with their gene names (italic, moved apart with
    // leader lines where crowded); the rest in grey.
    seriesOverrides: Object.fromEntries(
      graphOutputs(g).map(({ series: e }) => [
        e.id,
        e.ref.key === 'volcano:flagged'
          ? {
              ...g.seriesOverrides[e.id],
              color: { rgb: '#d55e00' },
              pointLabels: { source: 'rowTitle', which: 'all', max: 20, text: { italic: true } },
            }
          : { ...g.seriesOverrides[e.id], color: { rgb: '#999999' } },
      ]),
    ),
  }))

  // Multiple one-way ANOVAs: one per cytokine (row).
  const cytokines = b.table(
    groupedTable(
      'Cytokines',
      ['IL-6', 'TNF-α', 'IL-10'],
      {
        Unstimulated: cells([45, 30, 22], 8, 4, 0),
        LPS: [
          draws(4, () => r.normal(620, 80), 0),
          draws(4, () => r.normal(410, 60), 0),
          draws(4, () => r.normal(120, 25), 0),
        ],
        'LPS + inhibitor': [
          draws(4, () => r.normal(260, 50), 0),
          draws(4, () => r.normal(160, 35), 0),
          draws(4, () => r.normal(110, 25), 0),
        ],
      },
      'Three cytokines (rows, pg/mL) in cultures left unstimulated, stimulated with LPS, or LPS plus an inhibitor, 4 wells each. Simulated data. Multiple one-way ANOVAs, one per row, with Tukey’s comparisons.',
    ),
  )
  const cytoBars = b.graph(cytokines, {
    preset: 'barsPoints',
    yTitle: 'Concentration (pg/mL)',
    size: { plotWidth: 260 },
  })
  const oneWays = b.analyze(
    cytokines,
    'multipleOneWay',
    { comparisons: 'allPairs', allPairsMethod: 'tukey' },
    { name: 'Multiple one-way ANOVAs (Tukey)' },
  )
  // Brackets for the inhibitor's effect only (LPS vs. LPS + inhibitor, in each row).
  const lps = [b.key(cytokines, 'LPS'), b.key(cytokines, 'LPS + inhibitor')]
  b.brackets(cytoBars, oneWays, {
    show: 'stars',
    maxP: Number.POSITIVE_INFINITY,
    keep: (k) => lps.every((key) => k.includes(key)),
  })

  // Three-way ANOVA: genotype (A, B vs. C, D) × treatment (A, C vs. B, D) × tissue (rows).
  const tissues = ['Liver', 'Kidney', 'Heart']
  const threeWayData = b.table(
    groupedTable(
      'Genotype × treatment × tissue',
      tissues,
      {
        'WT · Vehicle': cells([20, 14, 9], 2.5, 4),
        'WT · Drug': cells([27, 19, 10], 2.5, 4),
        'KO · Vehicle': cells([21, 15, 9], 2.5, 4),
        'KO · Drug': cells([36, 26, 11], 2.5, 4),
      },
      'A 2 × 2 × 3 design: data sets A and B are wild type, C and D knockout (column factor 1); A and C vehicle, B and D drug (column factor 2); rows are tissues. 4 mice per cell. Simulated data. Ordinary three-way ANOVA.',
    ),
  )
  const threeWayGraph = b.graph(threeWayData, {
    preset: 'barsSem',
    yTitle: 'Enzyme activity (U/g)',
    size: { plotWidth: 300 },
  })
  // Small multiples: one graph per tissue (row), sharing a live Y range, on a page of their own.
  const slices = legendOnLast(
    sliceGraphs(
      threeWayData,
      'row',
      { ...threeWayGraph, size: { plotWidth: 130, plotHeight: 150 } },
      { linkY: true },
    ),
  ).map((g) => b.add(g))
  b.analyze(
    threeWayData,
    'threeWayAnova',
    { comparisons: 'oneFactor' },
    { name: 'Three-way ANOVA' },
  )

  // Fraction of total: each donor's cell counts as percentages of that donor's total.
  const counts = (m: number[]) => m.map((v) => [Math.round(r.normal(v, v * 0.12))])
  const composition = b.table(
    groupedTable(
      'Blood cell counts',
      ['T cells', 'B cells', 'NK cells', 'Monocytes'],
      {
        'Donor 1': counts([620, 140, 90, 150]),
        'Donor 2': counts([540, 190, 70, 200]),
        'Donor 3': counts([700, 110, 120, 120]),
      },
      'Counts of four cell types (rows) per donor. Simulated data. Fraction of total expresses each count as a percentage of the donor’s (column’s) total.',
    ),
  )
  b.graph(composition, { preset: 'bars', yTitle: 'Cells counted' })
  b.analyze(
    composition,
    'fractionOfTotal',
    { divideBy: 'column', display: 'percent' },
    { name: 'Fraction of total' },
  )

  // Three-way ANOVA with repeated measures: each subcolumn is one mouse measured at three times.
  const mouse = () => r.normal(0, 4)
  const rmCell = (drug: number, sex: number) => {
    const mice = Array.from({ length: 5 }, mouse)
    return [0, 1, 2].map((t) =>
      mice.map((m) => round(40 + 6 * t + 8 * drug * t + 3 * sex + m + r.normal(0, 2))),
    )
  }
  const rmTable = b.table(
    groupedTable(
      'Weight gain (repeated)',
      ['Week 1', 'Week 2', 'Week 3'],
      {
        'Vehicle, female': rmCell(0, 0),
        'Vehicle, male': rmCell(0, 1),
        'Drug, female': rmCell(1, 0),
        'Drug, male': rmCell(1, 1),
      },
      'Body weight (g) of 20 mice: each subcolumn is one mouse weighed in weeks 1–3 (the row factor is repeated), five per drug × sex group (the two column factors). Simulated: the drug speeds weight gain. Three-way repeated-measures ANOVA (Geisser-Greenhouse corrected) and the same model fitted as a mixed-effects model.',
    ),
  )
  b.graph(rmTable, { preset: 'barsSem', yTitle: 'Body weight (g)' })
  b.analyze(rmTable, 'threeWayAnova', { repeatedRows: true }, { name: 'Three-way RM ANOVA' })
  b.analyze(
    rmTable,
    'threeWayAnova',
    { repeatedRows: true, rmMethod: 'mixed' },
    { name: 'Three-way mixed-effects model' },
  )

  b.layout('Figure (grouped data)', [genoBars, timeGraph, volcano, cytoBars], {
    columns: 2,
    equalize: false,
  })
  b.layout('Small multiples (one graph per tissue)', slices, { columns: 3, landscape: true })
  return b.project
}
