import type { DataTable, GraphNode } from '@ps/model'
import { graphOf } from './graphs.ts'
import { fixedTable, sampleTable } from './helpers.ts'

// Roadmap 47b: graphs of legends edited — entries reordered, laid out in columns filled either
// way, labelled on the legend alone — for the goldens and the legend's tests.

/** A column table of `n` data sets (`a`, `b`…) titled Group 1… with a few values each. */
export function groupsTable(n: number): DataTable {
  return fixedTable(
    'column',
    { type: 'replicates', count: 1 },
    Array.from({ length: n }, (_, i) => [[10 + i, 12 + i, 11 + (i % 3)]]),
    { titles: Array.from({ length: n }, (_, i) => `Group ${i + 1}`) },
  )
}

/** The goldens of roadmap 47b (new files; no golden before it changes). */
export function legendCases(): [name: string, table: DataTable, graph: GraphNode][] {
  const four = groupsTable(4)
  const five = groupsTable(5)
  const xy = sampleTable('xy')
  const box = { color: { rgb: '#000000' }, width: 0.5, dash: 'solid' } as const
  return [
    // Four entries, reordered, in two columns: a 2 × 2 legend beside the plot.
    [
      'legend-order-columns-2x2',
      four,
      graphOf(four, 'bars', (g) => ({
        legend: { ...g.legend, show: true, order: ['d', 'b', 'a', 'c'], columns: 2 },
      })),
    ],
    // Five entries above the plot in two columns, filled down each column first.
    [
      'legend-fill-columns',
      five,
      graphOf(five, 'points', (g) => ({
        legend: { ...g.legend, show: true, position: 'top', columns: 2, fill: 'columns' },
      })),
    ],
    // A legend-only label, formatted, in place of a data set's title.
    [
      'legend-labels',
      xy,
      graphOf(xy, 'meanSd', (g) => ({
        legend: {
          ...g.legend,
          show: true,
          labels: {
            a: [
              { text: 'Slow ' },
              { text: '(k', italic: true },
              { text: 'obs', sub: true },
              { text: ')' },
            ],
            b: [{ text: 'Fast', bold: true }],
          },
        },
      })),
    ],
    // Inside the plot in two columns, boxed.
    [
      'legend-columns-inside',
      xy,
      graphOf(xy, 'meanSd', (g) => ({
        legend: {
          ...g.legend,
          show: true,
          position: 'inside',
          inside: { x: 0.03, y: 0.03 },
          columns: 2,
          border: box,
        },
      })),
    ],
  ]
}
