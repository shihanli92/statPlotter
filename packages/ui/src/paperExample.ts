import { registry } from '@ps/analyses'
import {
  bracketsFromAnalysis,
  equalizePlotSizes,
  type FontRegistry,
  layoutGraph,
  presetGraph,
} from '@ps/graph'
import {
  type AnalysisNode,
  createProject,
  type DataTable,
  type DocNode,
  type GraphNode,
  newNodeId,
  normalizeTable,
  type Project,
  type RichText,
} from '@ps/model'
import { exampleParams } from './examples/exampleParams.ts'
import { groupedTable as groupedTableOf } from './examples/synthetic/builder.ts'
import { newLayout, pageSpec, placeGraphs } from './layout/figure.ts'

/*
 * Data: source data of Stucchi, Galli, Cozzi et al., "Microbial adhesion promotes Piezo1
 * activation to initiate innate immunity", Nature Immunology (2026),
 * https://doi.org/10.1038/s41590-026-02643-y (CC BY 4.0). cells[row][data set] = values.
 */
const FIG1A = {
  'C. albicans': [
    [
      [769.118, 1545.215, 1788.612, 5715.489, 2934.883, 4292.984],
      [22642.61, 28009.42, 28963.91, 24844.71, 26084.04, 19572.59],
    ],
    [
      [204.1508, 2118.897, 1093.129],
      [802.0159, 2755.608, 855.6857],
    ],
    [
      [9232.975, 4024.519, 2953.457, 4803.052],
      [10310.36, 15289.71, 7972.588, 2147.004, 5424.456, 1705.929],
    ],
  ],
  'S. aureus': [
    [
      [1446.378, 573.403, 351.6899, 5920.055, 5518.35, 3135.152],
      [111765.8, 104328.6, 114292.3, 97863.17, 68980.01],
    ],
    [
      [1801.533, 745.0291, 1024.415],
      [27930.77, 26556.46, 13660.62],
    ],
    [
      [3671.989, 1473.368, 8694.098, 3220.355, 3787.459],
      [38760.36, 18037.7, 8774.352, 3852.224, 40473.21],
    ],
  ],
  'P. aeruginosa': [
    [
      [2290.115, 1107.722, 7590, 2597.436, 3767.029, 1182.444, 3932.099, 576.616],
      [102224.2, 109601.1, 110787.1, 106860, 92910],
    ],
    [
      [1247.737, 834.305, 503.1454, 434.0373, 65.3088],
      [46506, 15863.03, 15237.91, 34199.26, 26525.87, 39464.16],
    ],
    [
      [17027.93, 3122.074, 4119.545, 2790, 15300],
      [72625.57, 50670, 67800, 35100, 67470],
    ],
  ],
}
const FIG1C = {
  'Anti-IL-1α': [
    [
      [1481.982, 4202.685, 861.6881],
      [33750.53, 40959.69, 26669.18, 31276.86, 56927.77],
    ],
    [
      [2157.565, 1545.849, 4017.474],
      [16045.34, 12481.54, 21992.32, 13864.99, 11550.45],
    ],
  ],
  'Anti-IL-1β': [
    [
      [71.89904, 813.0946, 1499.781],
      [44014.74, 44086.27, 65342.37],
    ],
    [
      [1388.856, 970.9203, 658.3762, 218.7975],
      [76462.23, 63749.57, 53264.05],
    ],
  ],
}
const FIG2A_SA = [
  [
    [0.001808, 0.004119, 0.005917],
    [0.03093, 0.062066, 0.07756],
    [0.002572, 0.001, 0.00063],
    [0.014707, 0.026515, 0.014282],
  ],
  [
    [0.00123, 0.001284, 0.001017],
    [0.077045, 0.198409, 0.189813],
    [0.000903, 0.000848, 0.001049],
    [0.100995, 0.064384, 0.048931],
  ],
  [
    [0.002304, 0.002685, 0.001795],
    [0.146798, 0.268501, 0.181803],
    [0.000776, 0.000621, 0.000429],
    [0.085582, 0.065625, 0.068275],
  ],
  [
    [0.028492, 0.005097, 0.050464],
    [0.323705, 0.364755, 0.443329],
    [0.005312, 0.003769],
    [0.127428, 0.104937, 0.126127],
  ],
  [
    [0.000975, 0.000739, 0.006734],
    [0.271778, 0.078159, 0.115836],
    [0.005956, 0.007538, 0.012361],
    [0.080741, 0.054291, 0.036864],
  ],
  [
    [0.000942, 0.002213, 0.001563],
    [0.069051, 0.096468, 0.105719],
    [0.000514, 0.000528, 0.000357],
    [0.063066, 0.04898, 0.06115],
  ],
]

/** A grouped table from `cells[row][dataSet]` (the replicates). */
const groupedTable = (name: string, rowTitles: string[], titles: string[], cells: number[][][]) =>
  groupedTableOf(
    name,
    rowTitles,
    Object.fromEntries(titles.map((t, c) => [t, cells.map((row) => row[c]!)])),
  )

/** "Neutrophils (×10⁴) per ear". */
const scaledTitle = (before: string, power: number, after: string): RichText => [
  { text: `${before} (×10` },
  { text: String(power), sup: true },
  { text: `)${after}` },
]

type Cell = [row: number, dataSet: number]

/**
 * Figures 1 and 2a of a published paper rebuilt from its source data: floating bars with points,
 * axes in units of 10⁴, two-way ANOVA with the paper's comparisons as brackets. For checking the
 * app against published P values (see packages/analyses/test/published.test.ts).
 */
export function createPaperExample(fonts: FontRegistry): Project {
  const project = createProject('Paper example (Stucchi et al. 2026)')
  const add = (node: DocNode) => {
    project.nodes[node.id] = node
    project.order.push(node.id)
  }

  /** A grouped table, its graph, a two-way ANOVA and brackets for the chosen cell pairs. */
  const figure = (
    table: DataTable,
    preset: string,
    params: object,
    pairs: [Cell, Cell][],
    yTitle: RichText,
    labelPower?: number,
  ): GraphNode => {
    add(table)
    // Drawn by data set, as the examples were before roadmap 33b.
    const base: GraphNode = {
      ...presetGraph(table, preset, table.name),
      drawOrder: 'series',
    }
    const y = base.axes.y
    const graph: GraphNode =
      y.type === 'continuous'
        ? {
            ...base,
            axes: {
              ...base.axes,
              y: { ...y, title: { content: yTitle }, ...(labelPower ? { labelPower } : {}) },
            },
          }
        : base
    const def = registry.get('twoWayAnova')!
    const parsed = exampleParams(def, params)
    const keys = table.dataSets.map((d) => d.id)
    const analysis: AnalysisNode = {
      kind: 'analysis',
      id: newNodeId(),
      name: `Two-way ANOVA of ${table.name}`,
      analysisId: 'twoWayAnova',
      pluginVersion: def.version,
      input: { source: table.id, dataSets: keys },
      params: parsed,
    }
    add(analysis)
    // Brackets only for the comparisons the paper shows.
    const result = def.run(normalizeTable(table), parsed)
    const want = new Set(pairs.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]))
    const cellOf = (key: string, row?: number) => `${row},${(keys as string[]).indexOf(key)}`
    graph.annotations = bracketsFromAnalysis(graph, analysis.id, result, 'number').filter(
      (a) => a.type === 'bracket' && want.has(`${cellOf(a.a, a.rowA)}|${cellOf(a.b, a.rowB)}`),
    )
    add(graph)
    return graph
  }

  const genotypes = ['WT', 'MyD88 KO', 'IL-1R1 KO']
  const tukeyAll = { comparisons: 'allCells', allPairsMethod: 'tukey' }
  const fig1: GraphNode[] = Object.entries(FIG1A).map(([pathogen, cells]) =>
    figure(
      groupedTable(`Fig. 1a ${pathogen} (6 h)`, genotypes, ['PBS', pathogen], cells),
      'floating',
      tukeyAll,
      [
        [
          [0, 0],
          [0, 1],
        ],
        [
          [0, 1],
          [1, 1],
        ],
        [
          [0, 1],
          [2, 1],
        ],
        [
          [1, 0],
          [1, 1],
        ],
        [
          [1, 1],
          [2, 1],
        ],
        [
          [2, 0],
          [2, 1],
        ],
      ],
      scaledTitle('Neutrophils', 4, ' per ear'),
      4,
    ),
  )
  const sidakCols = { comparisons: 'withinColumns', allPairsMethod: 'sidak', family: 'all' }
  const fig1c = Object.entries(FIG1C).map(([antibody, cells]) =>
    figure(
      groupedTable(`Fig. 1c ${antibody}`, ['Isotype', antibody], ['PBS', 'C. albicans'], cells),
      'floating',
      sidakCols,
      [
        [
          [0, 1],
          [1, 1],
        ],
      ],
      scaledTitle('Neutrophils', 4, ' per ear'),
      4,
    ),
  )
  figure(
    groupedTable(
      'Fig. 2a S. aureus (Cxcl1)',
      ['2', '4', '6', '8', '10', '24'],
      ['WT + PBS', 'WT + S. aureus', 'IL-1R1 KO + PBS', 'IL-1R1 KO + S. aureus'],
      FIG2A_SA,
    ),
    'connected',
    { comparisons: 'withinRows', allPairsMethod: 'tukey' },
    [1, 2, 3, 4].map(
      (r) =>
        [
          [r, 1],
          [r, 3],
        ] as [Cell, Cell],
    ),
    [{ text: 'Relative ' }, { text: 'Cxcl1', italic: true }, { text: ' level' }],
  )

  // Figure 1 page: the five panels, plot areas aligned.
  const panels = equalizePlotSizes([...fig1, ...fig1c])
  for (const g of panels) project.nodes[g.id] = g
  const page = pageSpec('letter', 'landscape')
  const scene = (graph: GraphNode) => layoutGraph({ project, graph, fonts })
  const items = placeGraphs(panels, scene, page, { columns: 3 })
  add(newLayout('Figure 1 (reproduced)', page, items, { style: 'a' }))
  return project
}
