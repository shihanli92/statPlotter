import { type FontRegistry, presetGraph } from '@ps/graph'
import type { GraphNode, Project } from '@ps/model'
import { ExampleBuilder, flatTable, rng, title, withLayer } from './builder.ts'

/** Counts of `n` draws falling in each category with these probabilities (seeded). */
function multinomial(n: number, p: number[], uniform: () => number): number[] {
  const counts = p.map(() => 0)
  const total = p.reduce((a, b) => a + b, 0)
  for (let i = 0; i < n; i++) {
    let u = uniform() * total
    let k = 0
    while (k < p.length - 1 && u >= p[k]!) u -= p[k++]!
    counts[k]!++
  }
  return counts
}

/**
 * Parts of whole: pie and donut charts (one per data set), 100% stacked bars, labels as
 * percentages or values, and one slice pulled out. All data are simulated (fixed seed).
 */
export function createPartsOfWholeExample(fonts: FontRegistry): Project {
  const b = new ExampleBuilder('Parts of whole', fonts)
  const r = rng(707)

  const cellTypes = ['T cells', 'B cells', 'NK cells', 'Monocytes', 'Other']
  const cells = b.table(
    // One row per part (cell type), one column per whole (tissue).
    flatTable(
      'Immune cells by tissue',
      'partsOfWhole',
      {
        Blood: multinomial(2000, [0.45, 0.12, 0.08, 0.28, 0.07], r.uniform),
        Spleen: multinomial(2000, [0.3, 0.45, 0.05, 0.08, 0.12], r.uniform),
        'Lymph node': multinomial(2000, [0.62, 0.3, 0.02, 0.02, 0.04], r.uniform),
      },
      cellTypes,
      'Leukocytes of 2,000 cells per tissue classified by flow cytometry. Simulated counts. Each column is a whole and each row a part: the pies show each tissue’s composition, the 100% stacked bars compare the tissues side by side, the donut pulls out the B cells of the spleen (click a slice twice to format it alone).',
    ),
  )
  const add = (g: GraphNode) => b.add(g)
  const pies = add({
    ...presetGraph(cells, 'pie', 'Immune cells (pies)'),
    title: title('Composition by tissue'),
  })
  const stacked = add({
    ...presetGraph(cells, 'wholeBars', 'Immune cells (100% stacked bars)'),
    title: title('Composition by tissue'),
  })
  const spleen = b.key(cells, 'Spleen')
  const donutGraph = presetGraph(cells, 'donut', 'Spleen (donut)')
  const donut = add({
    ...withLayer(donutGraph, 'labels', (l) => ({
      ...l,
      style: { content: 'categoryPercent', position: 'outside' },
    })),
    seriesSource: { ...donutGraph.seriesSource, include: [spleen] },
    size: { plotWidth: 170, plotHeight: 170 },
    title: title('Spleen'),
    legend: { ...donutGraph.legend, show: false },
    style: { polar: { hole: 0.55 } },
    pointOverrides: { [spleen]: { r1: { explode: 0.12 } } },
  })

  const answers = b.table(
    flatTable(
      'Survey: preferred assay',
      'partsOfWhole',
      { Respondents: [34, 21, 27, 9] },
      ['ELISA', 'Western blot', 'Flow cytometry', 'Mass spectrometry'],
      'Number of respondents choosing each assay (one answer each). Simulated. A pie with the counts and percentages on the slices.',
    ),
  )
  add({
    ...withLayer(presetGraph(answers, 'pie', 'Survey (pie)'), 'labels', (l) => ({
      ...l,
      style: { content: 'valuePercent', digits: 0 },
    })),
    title: title('Preferred assay (n = 91)'),
  })

  b.layout('Figure (parts of whole)', [pies, stacked, donut], {
    columns: 2,
    equalize: false,
    labels: 'A',
  })
  return b.project
}
