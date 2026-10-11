import type { DataTable, GraphNode } from '@ps/model'
import { builtGraph } from './goldenCases.ts'
import { graphOf, withLayer } from './graphs.ts'
import { fixedTable, sampleTable } from './helpers.ts'

// Roadmap 49a: aesthetics by data set or fixed, as ggplot's `aes(fill = group)` beside
// `geom_point(shape = 21, colour = 'black')` — the goldens and the resolution's tests. New files
// only: no golden before 49a changes.

const BLACK = { color: { rgb: '#000000' }, width: 1, dash: 'solid' } as const

/** An XY table of three data sets (one replicate each) over six X values. */
export function xyThree(): DataTable {
  return fixedTable(
    'xy',
    { type: 'replicates', count: 1 },
    [
      [[2, 3.1, 4.4, 5.2, 6.8, 7.1]],
      [[1.2, 2.2, 2.9, 4.1, 4.6, 5.9]],
      [[0.5, 1.1, 1.6, 2.4, 2.9, 3.3]],
    ],
    { titles: ['Low', 'Medium', 'High'], x: [1, 2, 3, 4, 5, 6] },
  )
}

/** A column table of `n` data sets (Group 1…) with a few values each. */
export function groupsOf(n: number): DataTable {
  return fixedTable(
    'column',
    { type: 'replicates', count: 1 },
    Array.from({ length: n }, (_, i) => [[10 + i, 12 + i, 11 + (i % 3), 13 + (i % 2)]]),
    { titles: Array.from({ length: n }, (_, i) => `Group ${i + 1}`) },
  )
}

const legend = (g: GraphNode): Partial<GraphNode> => ({ legend: { ...g.legend, show: true } })

/** The goldens of roadmap 49a. */
export function byGroupCases(): [name: string, table: DataTable, graph: GraphNode][] {
  const column = sampleTable('column')
  const xy = xyThree()
  const four = groupsOf(4)
  const pointsXY = builtGraph(xy, 'xy', ['points'])
  const linesXY = builtGraph(xy, 'xy', ['line', 'points'])
  return [
    // ggplot's aes(fill = group) + geom_point(shape = 21, colour = 'black'): each data set's
    // symbols filled in its colour, outlined in black (the legend's symbols too).
    [
      'bygroup-points-filled-black-outline',
      column,
      withLayer(graphOf(column, 'points', legend), 'points', {
        style: { fill: { type: 'solid', color: { series: true }, opacity: 1 }, border: BLACK },
      }),
    ],
    // Outlined in the data set's colour, filled white (hollow-looking, overlaps hidden).
    [
      'bygroup-points-outlined-white-fill',
      column,
      withLayer(graphOf(column, 'points', legend), 'points', {
        style: {
          fill: { type: 'solid', color: { rgb: '#ffffff' }, opacity: 1 },
          border: { color: { series: true }, width: 1.5, dash: 'solid' },
        },
      }),
    ],
    // Shapes by data set: circle, square, triangle (the default cycle), filled by data set with
    // a black outline, in the plot and the legend.
    [
      'bygroup-shapes-cycled',
      xy,
      withLayer({ ...pointsXY, legend: { ...pointsXY.legend, show: true } }, 'points', {
        style: { shape: { series: true }, size: 7, border: { ...BLACK, width: 0.75 } },
      }),
    ],
    // The graph's own cycle (two shapes for four data sets: they wrap, as colours do).
    [
      'bygroup-shapes-custom-cycle',
      four,
      withLayer(
        graphOf(four, 'points', (g) => ({
          ...legend(g),
          style: { ...g.style, shapes: ['diamond', 'triangle'] },
        })),
        'points',
        { style: { shape: { series: true } } },
      ),
    ],
    // Line patterns by data set: solid, dashed, dotted (lines and their legend samples).
    [
      'bygroup-dashes-cycled',
      xy,
      withLayer({ ...linesXY, legend: { ...linesXY.legend, show: true } }, 'line', {
        style: { stroke: { color: { series: true }, width: 1.5, dash: { series: true } } },
      }),
    ],
    // Bars of one fixed fill, outlined by data set.
    [
      'bygroup-bars-fixed-fill',
      column,
      withLayer(graphOf(column, 'bars', legend), 'bars', {
        style: {
          fill: { type: 'solid', color: { rgb: '#d9d9d9' }, opacity: 1 },
          border: { color: { series: true }, width: 1.5, dash: 'solid' },
        },
      }),
    ],
    // Boxes filled white (fixed), outlined by data set.
    [
      'bygroup-boxes-fixed-fill',
      column,
      withLayer(graphOf(column, 'box', legend), 'box', {
        style: {
          fill: { type: 'solid', color: { rgb: '#ffffff' }, opacity: 1 },
          border: { color: { series: true }, width: 1.25, dash: 'solid' },
        },
      }),
    ],
  ]
}
