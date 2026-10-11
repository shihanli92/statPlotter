/**
 * Published results reproduced through the analysis plugins, the path the app takes.
 *
 * Data: source data of Stucchi, Galli, Cozzi et al., "Microbial adhesion promotes Piezo1
 * activation to initiate innate immunity", Nature Immunology (2026),
 * https://doi.org/10.1038/s41590-026-02643-y (CC BY 4.0). P values are those printed in the
 * figures, compared at the printed precision. The comparison family is the one that reproduces
 * the figure (among the two-way options); where the legend names another test, the note says so.
 */
import type { AnalysisResult } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { oneWayAnovaDef, ttest, twoWayAnovaDef } from '../src/index.ts'
import { columnTable, groupedTable, runDef } from './helpers.ts'

// cells[row][column] = replicate values; rows and columns in figure order.
const fig1aCa = [
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
]
const fig1aSa = [
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
]
const fig1aPa = [
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
]
const fig1bCa = [
  [
    [3246.216, 5738.062, 2125.412, 725.045, 2110.49, 7358.068],
    [4123482, 2058984, 1378180, 2353155],
  ],
  [
    [514.71, 315.6183],
    [18635.66, 16954.94, 9530.358],
  ],
  [
    [1920.474, 2402.662, 1472.302, 3609.424, 1790.339, 889.7198],
    [1341731, 2573127, 318518.7, 4252599],
  ],
]
const fig1cA = [
  [
    [1481.982, 4202.685, 861.6881],
    [33750.53, 40959.69, 26669.18, 31276.86, 56927.77],
  ],
  [
    [2157.565, 1545.849, 4017.474],
    [16045.34, 12481.54, 21992.32, 13864.99, 11550.45],
  ],
]
const fig1cB = [
  [
    [71.89904, 813.0946, 1499.781],
    [44014.74, 44086.27, 65342.37],
  ],
  [
    [1388.856, 970.9203, 658.3762, 218.7975],
    [76462.23, 63749.57, 53264.05],
  ],
]
const fig2aSa = [
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
const fig2cCa = [
  [
    [1.01072e-5, 3.33866e-6, 2.90647e-6],
    [1.29942e-6, 8.36402e-7, 8.66678e-7],
  ],
  [
    [0.000461318, 0.000716746, 0.002151338, 0.00157389],
    [4.31817e-6, 7.56908e-6, 2.01052e-6, 1.26061e-6],
  ],
  [
    [2.37844e-6, 6.96353e-6, 6.81762e-6],
    [9.10695e-6, 1.4699e-6],
  ],
  [
    [0.000192047, 0.000128339, 0.000132043, 0.00054771],
    [3.4747e-5, 7.43055e-6, 5.49214e-6, 4.97914e-7],
  ],
]
const fig4bSa = [
  [
    [1425.309, 971.4464, 2634.213],
    [43473.62, 89269.19, 63604.19],
  ],
  [
    [1949.35, 646.1715, 3561.117],
    [8909.322, 22566.44, 11417.56],
  ],
]
const fig4cCa = [
  [
    [4.296967, 7.899266, 4.47308, 2.062178],
    [0.864818, 0.746994, 0.631134, 0.593726],
  ],
  [
    [68.5165, 118.4455, 105.2612, 120.0324],
    [57.24507, 63.01309, 48.61668, 36.17521],
  ],
]
const fig5d = [
  [
    [4158.067, 7537.043, 1819.937, 2277.736, 963.9044],
    [53557.01, 24430.72, 20471.04, 55752.37],
  ],
  [
    [1083.53, 2549.495, 3389.138, 3021.505, 5954.98],
    [11061.74, 17502.38, 5970.986, 1352.605],
  ],
]
const fig6aPa = [
  [289.2172, 329.2892, 60.85829],
  [2452.854, 2749.571, 1772.215, 1650.82],
  [951.9024, 1069.19, 969.8247, 1015.992],
]

/** A printed P value: "<0.0001", ">0.99", or a number at the printed precision. */
function expectPrinted(p: number, printed: string) {
  if (printed.startsWith('<')) expect(p).toBeLessThan(Number(printed.slice(1)))
  else if (printed.startsWith('>')) expect(p).toBeGreaterThan(Number(printed.slice(1)))
  else expect(p.toFixed(printed.split('.')[1]!.length)).toBe(printed)
}

type Cell = [row: number, column: number]
function twoWay(cells: number[][][], params: object, expected: [Cell, Cell, string][]) {
  const t = groupedTable(cells)
  const r = runDef(twoWayAnovaDef, t, params)
  expect(r.status).not.toBe('error')
  const id = (c: number) => t.dataSets[c]!.id
  const is = (x: AnalysisResult['comparisons'][number], a: Cell, b: Cell) =>
    x.rowA === a[0] && x.a.key === id(a[1]) && x.rowB === b[0] && x.b.key === id(b[1])
  for (const [a, b, printed] of expected) {
    const c = r.comparisons.find((x) => is(x, a, b) || is(x, b, a))
    expect(c, `${a} vs ${b}`).toBeDefined()
    expectPrinted(c!.pAdjusted ?? c!.p, printed)
  }
}

const TUKEY_ALL = { comparisons: 'allCells', allPairsMethod: 'tukey' }
const SIDAK_ALL = { comparisons: 'allCells', allPairsMethod: 'sidak' }

describe('Stucchi et al. 2026, two-way ANOVA', () => {
  // Rows WT, MyD88 KO, IL-1R1 KO; columns PBS, pathogen.
  it('Fig. 1a C. albicans: Tukey, all cells', () => {
    twoWay(fig1aCa, TUKEY_ALL, [
      [[0, 0], [0, 1], '<0.0001'],
      [[0, 1], [1, 1], '<0.0001'],
      [[0, 1], [2, 1], '<0.0001'],
      [[1, 0], [1, 1], '>0.99'],
      [[1, 1], [2, 1], '0.19'],
      [[2, 0], [2, 1], '0.95'],
    ])
  })

  it('Fig. 1a S. aureus: Tukey, all cells', () => {
    twoWay(fig1aSa, TUKEY_ALL, [
      [[0, 0], [0, 1], '<0.0001'],
      [[0, 1], [1, 1], '<0.0001'],
      [[0, 1], [2, 1], '<0.0001'],
      [[1, 0], [1, 1], '0.22'],
      [[1, 1], [2, 1], '>0.99'],
      [[2, 0], [2, 1], '0.17'],
    ])
  })

  it('Fig. 1a P. aeruginosa: Tukey, all cells', () => {
    // The figure also prints <0.0001 for MyD88 PBS vs pathogen and MyD88 vs IL-1R1 (pathogen);
    // the data give 1.36e-4 and 1.31e-4 (R's TukeyHSD agrees), so those two are left out.
    twoWay(fig1aPa, TUKEY_ALL, [
      [[0, 0], [0, 1], '<0.0001'],
      [[0, 1], [1, 1], '<0.0001'],
      [[0, 1], [2, 1], '<0.0001'],
      [[2, 0], [2, 1], '<0.0001'],
    ])
  })

  it('Fig. 1b C. albicans (24 h): Tukey, all cells', () => {
    twoWay(fig1bCa, TUKEY_ALL, [
      [[0, 0], [0, 1], '0.0019'],
      [[0, 1], [1, 1], '0.0097'],
      [[0, 1], [2, 1], '0.99'],
      [[1, 1], [2, 1], '0.032'],
      [[2, 0], [2, 1], '0.0083'],
    ])
  })

  it('Fig. 1c: Šídák, rows compared within each column, one family', () => {
    const params = { comparisons: 'withinColumns', allPairsMethod: 'sidak', family: 'all' }
    twoWay(fig1cA, params, [[[0, 1], [1, 1], '0.0007']])
    twoWay(fig1cB, params, [[[0, 1], [1, 1], '0.14']])
  })

  it('Fig. 2a S. aureus: Tukey within each time point', () => {
    // Rows 2, 4, 6, 8, 10, 24 h; columns WT+PBS, WT+pathogen, KO+PBS, KO+pathogen.
    const params = { comparisons: 'withinRows', allPairsMethod: 'tukey' }
    twoWay(fig2aSa, params, [
      [[1, 1], [1, 3], '0.017'],
      [[2, 1], [2, 3], '0.0002'],
      [[3, 1], [3, 3], '<0.0001'],
      [[4, 1], [4, 3], '0.0039'],
    ])
  })

  it('Fig. 2c C. albicans: Šídák within rows, one family', () => {
    // Rows PBS 6 h, pathogen 6 h, PBS 24 h, pathogen 24 h; columns WT, MyD88 KO.
    const params = { comparisons: 'withinRows', allPairsMethod: 'sidak', family: 'all' }
    twoWay(fig2cCa, params, [
      [[1, 0], [1, 1], '0.0001'],
      [[3, 0], [3, 1], '0.77'],
    ])
  })

  it('Fig. 4b S. aureus: Šídák, all cells', () => {
    // Rows vehicle, bestatin; columns PBS, pathogen.
    twoWay(fig4bSa, SIDAK_ALL, [
      [[0, 0], [0, 1], '0.0012'],
      [[0, 1], [1, 1], '0.005'],
      [[1, 0], [1, 1], '0.82'],
    ])
  })

  it('Fig. 5d: Tukey, all cells', () => {
    // Rows vehicle, bestatin; columns PBS, Yoda1.
    twoWay(fig5d, TUKEY_ALL, [
      [[0, 1], [1, 1], '0.0027'],
      [[1, 0], [1, 1], '0.7961'],
    ])
  })
})

describe('Stucchi et al. 2026, column tests', () => {
  it('Fig. 4c C. albicans: unpaired t tests (Il1a, Cxcl1)', () => {
    for (const [cols, printed] of [
      [fig4cCa[0]!, '0.0165'],
      [fig4cCa[1]!, '0.0081'],
    ] as const) {
      const r = runDef(ttest, columnTable(cols))
      expectPrinted(r.comparisons[0]!.p, printed)
    }
  })

  it('Fig. 6a P. aeruginosa: one-way ANOVA, Tukey', () => {
    const t = columnTable(fig6aPa) // NT, WT, pilC-
    const r = runDef(oneWayAnovaDef, t)
    const p = (i: number, j: number) =>
      r.comparisons.find((c) => c.a.key === t.dataSets[i]!.id && c.b.key === t.dataSets[j]!.id)!
    expectPrinted(p(0, 1).pAdjusted!, '0.0002')
    expectPrinted(p(0, 2).pAdjusted!, '0.0384')
    expectPrinted(p(1, 2).pAdjusted!, '0.0031')
  })
})
