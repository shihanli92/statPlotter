import { type FontRegistry, presetGraph, withTrees } from '@ps/graph'
import type { GraphNode, Project } from '@ps/model'
import {
  addLayer,
  axis,
  columnTable,
  draws,
  ExampleBuilder,
  groupedTable,
  layerStyle,
  rng,
  round,
  withLayer,
  xyTable,
} from './builder.ts'

/**
 * More graph types (roadmap 30): horizontal bars from a baseline, a forest-style plot and brackets
 * standing beside horizontal data; stacked and 100% stacked bars; a time course with a line
 * through each animal, a shaded error band and a gap at a missing value; geometric means with
 * their SD factor and a grand mean line; a clustered heat map of gene expression. All data are
 * simulated (fixed seed).
 */
export function createMoreGraphsExample(fonts: FontRegistry): Project {
  const b = new ExampleBuilder('More graph types', fonts)
  const r = rng(3030)
  const horizontal = (g: GraphNode): GraphNode => ({
    ...g,
    style: { ...g.style, orientation: 'horizontal' },
  })

  // Fold changes around 1: horizontal bars from a baseline of 1, a forest-style plot.
  const fold = b.table(
    columnTable(
      'Expression (fold change)',
      {
        Vehicle: draws(6, () => r.lognormal(0, 0.12), 2),
        'Drug A': draws(6, () => r.lognormal(Math.log(1.8), 0.15), 2),
        'Drug B': draws(6, () => r.lognormal(Math.log(0.55), 0.15), 2),
        'Drug C': draws(6, () => r.lognormal(Math.log(1.2), 0.2), 2),
      },
      'Fold change of a transcript over untreated cells, six wells per treatment. Simulated data. The bars start at 1 (no change) and go up or down from it, drawn horizontally (Format graph › Graph settings › Orientation; Appearance › Bars start at a baseline other than 0). The second graph shows each mean with its 95% CI, forest-style, with the ANOVA’s brackets standing beside the data.',
    ),
  )
  b.graph(fold, {
    name: 'Fold change (horizontal bars)',
    preset: 'bars',
    title: 'Fold change from 1',
    yTitle: 'Fold change',
    edit: (g) => horizontal(layerStyle(g, 'bars', { baseline: 1 })),
  })
  const forest = b.graph(fold, {
    name: 'Fold change (forest plot)',
    preset: 'meanSd',
    title: 'Mean with 95% CI',
    yTitle: 'Fold change',
    size: { plotWidth: 200, plotHeight: 150 },
    edit: (g) =>
      horizontal(
        layerStyle(
          withLayer(g, 'error', (l) => ({
            ...l,
            stat: { kind: 'summary', center: 'mean', error: 'CI' },
          })),
          'center',
          { width: 0.25 },
        ),
      ),
  })
  const anova = b.analyze(
    fold,
    'oneWayAnova',
    { comparisons: 'allPairs', allPairsMethod: 'tukey' },
    { name: 'One-way ANOVA of fold changes' },
  )
  b.brackets(forest, anova, { show: 'stars', keep: (c) => c.includes(b.key(fold, 'Vehicle')) })

  // Composition by treatment: stacked and 100% stacked bars.
  const types = ['Naive', 'Effector', 'Memory', 'Regulatory']
  const shares: Record<string, number[]> = {
    Naive: [48, 30, 22],
    Effector: [22, 38, 30],
    Memory: [20, 22, 38],
    Regulatory: [10, 10, 10],
  }
  const composition = b.table(
    groupedTable(
      'T cell subsets',
      ['Day 0', 'Day 7', 'Day 28'],
      Object.fromEntries(
        types.map((t) => [
          t,
          shares[t]!.map((m) => draws(3, () => Math.max(1, r.normal(m, m * 0.1)), 1)),
        ]),
      ),
      'Percent of CD3⁺ cells in each subset after vaccination, three donors per day. Simulated data. Stacked bars add the subsets up per day (mean ± SD on each segment); the 100% stacked bars show each day’s composition, drawn horizontally with gaps between the segments (Format graph › Graph settings › Data sets in each row).',
    ),
  )
  b.graph(composition, {
    name: 'T cell subsets (stacked)',
    preset: 'stacked',
    title: 'Stacked bars',
    yTitle: '% of CD3⁺ cells',
  })
  b.graph(composition, {
    name: 'T cell subsets (100% stacked, horizontal)',
    preset: 'stackedPercent',
    title: 'Composition by day',
    yTitle: '% of total',
    edit: (g) =>
      horizontal(
        withLayer(g, 'bars', (l) => ({
          ...l,
          position: { kind: 'stack', percent: true, gap: 1.5 },
        })),
      ),
  })

  // A time course with six animals per group: spaghetti, an error band, a missing value.
  const days = [0, 3, 7, 10, 14, 17, 21]
  const animal = (rate: number) => {
    const k = rate * Math.exp(r.normal(0, 0.18))
    const v0 = 60 + r.normal(0, 8)
    return days.map((d) => round(v0 * Math.exp(k * d) * Math.exp(r.normal(0, 0.06)), 0))
  }
  const byDay = (mice: number[][]): (number | null)[][] =>
    days.map((_, i) => mice.map((m) => m[i]!))
  const control = byDay(Array.from({ length: 6 }, () => animal(0.11)))
  const treated = byDay(Array.from({ length: 6 }, () => animal(0.05)))
  // One control mouse missed day 10; the treated group wasn't measured on day 17.
  control[3]![2] = null
  treated[5] = treated[5]!.map(() => null)
  const tumour = b.table(
    xyTable(
      'Tumour volume',
      'Day',
      days,
      { Control: control, Treated: treated },
      'Tumour volume (mm³) of six mice per group, each mouse a replicate subcolumn. Simulated data; one control mouse missed day 10 and the treated group was not measured on day 17. The first graph joins each mouse across the days (a spaghetti plot) with the group mean; the second shades mean ± SEM as a band and breaks the line and band at the missing day (Format graph › Appearance › Lines).',
    ),
  )
  b.graph(tumour, {
    name: 'Tumour volume (each mouse)',
    preset: 'spaghetti',
    title: 'Each mouse and the mean',
    yTitle: 'Volume (mm³)',
  })
  b.graph(tumour, {
    name: 'Tumour volume (mean ± SEM band)',
    preset: 'envelope',
    title: 'Mean ± SEM',
    yTitle: 'Volume (mm³)',
    // The SEM as the band; the line and band break at the missing day.
    edit: (g) =>
      layerStyle(
        withLayer(g, 'envelope', (l) => ({
          ...l,
          stat: { kind: 'summary', center: 'mean', error: 'SEM' },
          style: { opacity: 0.25, gaps: true },
        })),
        'line',
        { gaps: true },
      ),
  })

  // Antibody titres: geometric means with their SD factor on a log axis, and the grand mean.
  const titres = b.table(
    columnTable(
      'Antibody titres',
      {
        'Dose 1': draws(10, () => 2 ** Math.round(r.normal(7, 1.2)), 0),
        'Dose 2': draws(10, () => 2 ** Math.round(r.normal(9, 1.1)), 0),
        Booster: draws(10, () => 2 ** Math.round(r.normal(10.5, 0.9)), 0),
      },
      'Reciprocal endpoint titres of ten subjects per visit. Simulated data. Titres are log-normal, so the lines are geometric means with error bars of the geometric mean ×/÷ its SD factor on a log₂ axis (Format graph › Appearance › Error bars); the dashed line is the mean of every titre (Graph settings › Grand mean).',
    ),
  )
  b.graph(titres, {
    name: 'Antibody titres (geometric mean)',
    preset: 'points',
    title: 'Geometric mean ×/÷ SD factor',
    yTitle: 'Titre',
    edit: (g) => ({
      ...addLayer(
        withLayer(
          withLayer(g, 'center', (l) => ({ ...l, stat: { kind: 'summary', center: 'geomean' } })),
          'error',
          (l) => ({ ...l, stat: { kind: 'summary', center: 'geomean', error: 'geoSD' } }),
        ),
        { id: 'grandMean', geom: 'refline', stat: { kind: 'summary', center: 'mean', by: 'all' } },
        0,
      ),
      axes: { ...g.axes, y: axis(g.axes.y, { scale: 'log2' }) },
    }),
  })

  // Gene expression: a heat map of z-scores, genes and samples ordered by clustering.
  const genes = ['Il6', 'Tnf', 'Il1b', 'Cxcl10', 'Ifng', 'Il10', 'Tgfb1', 'Foxp3', 'Gzmb', 'Prf1']
  const samples = ['WT 1', 'WT 2', 'WT 3', 'KO 1', 'KO 2', 'KO 3']
  // Inflammatory genes up in the knockouts, regulatory ones down, cytotoxic ones unchanged.
  const shift = [2, 1.8, 1.5, 2.2, 1.2, -1.5, -1, -1.8, 0.2, 0]
  const base = genes.map(() => r.normal(8, 1.5))
  const expression = b.table(
    groupedTable(
      'Gene expression',
      genes,
      Object.fromEntries(
        samples.map((name, j) => [
          name,
          genes.map((_, i) => [round(base[i]! + (j >= 3 ? shift[i]! : 0) + r.normal(0, 0.4), 2)]),
        ]),
      ),
      'log₂ expression of ten genes in three wild-type and three knockout samples (one value per cell). Simulated data. The heat map shows each gene’s z-scores (row-scaled) on a blue–white–red scale, genes and samples ordered by hierarchical clustering (average linkage on 1 − Pearson r, as R’s hclust orders them), with the dendrograms beside the map (Format graph › Appearance). The samples separate by genotype.',
    ),
  )
  const map = withLayer(
    presetGraph(expression, 'heatmap', 'Gene expression (heat map)'),
    'cells',
    (l) => ({
      ...l,
      stat: { kind: 'cell', standardize: 'row' },
      style: {
        cluster: { rows: true, columns: true, linkage: 'average', distance: 'pearson' },
      },
    }),
  )
  b.add({
    ...map,
    // Roadmap 49c: the trees of the clustered genes and samples, layers of their own.
    layers: withTrees(map.layers),
    title: { content: [{ text: 'Gene expression (z-score)' }] },
    scales: { color: { colors: 'blueRed' } },
  })

  return b.project
}
