import type { Cutoffs, DataTable, GraphNode, Layer, NodeId } from '@ps/model'
import { graphOf } from './graphs.ts'
import { fixedTable } from './helpers.ts'

// Roadmap 46b: reference lines at ± a value and a volcano plot's thresholds — an XY table of
// genes' log2 fold changes (X) and −log10 P values (Y), lines at ±1 (typed in, and at the graph's
// cut-offs), a band beyond ±1, and the Significance layer classing the points. The values are
// plain arithmetic (no logarithms of random numbers): the same on every platform.

/** Genes: log2 fold change (X, −3 to 3) and −log10 P (Y, 0 to 5.75), one row each; row 40 empty. */
export function volcanoTable(): DataTable {
  const n = 40
  const x = Array.from({ length: n }, (_, i) => ((i * 37) % 61) / 10 - 3)
  const y: (number | null)[] = Array.from({ length: n }, (_, i) => ((i * 53) % 47) / 8)
  // Exactly at the cut-offs (|log2 FC| = 1, −log10 P = 2: significant), and a gene without a P.
  x.push(1, -1, 2)
  y.push(2, 2, null)
  return fixedTable('xy', { type: 'replicates', count: 1 }, [[y]], {
    titles: ['−log10 P'],
    x,
  })
}

/** A line at ± a value along X (typed in, or at the graph's fold change cut-off). */
export function pmLine(id: string, at: number | 'cutoff', more: Partial<Layer> = {}): Layer {
  return {
    id,
    geom: 'refline',
    stat: {
      kind: 'result',
      fields: {
        at: {
          ref: at === 'cutoff' ? { from: 'cutoff', which: 'fold' } : { from: 'number', v: at },
        },
      },
      at: 'at',
      axis: 'x',
      mirror: true,
    },
    data: { from: 'values' },
    legend: 'hide',
    ...more,
  } as Layer
}

/** A band at ± a value along X: between −c and +c, or beyond them. */
export function pmBand(id: string, at: number, outside: boolean): Layer {
  return {
    id,
    geom: 'band',
    stat: {
      kind: 'result',
      fields: { at: { ref: { from: 'number', v: at } } },
      at: 'at',
      axis: 'x',
      mirror: true,
      ...(outside ? { outside: true } : {}),
    },
    data: { from: 'values' },
    legend: 'hide',
  } as Layer
}

/** The line at the graph's significance cut-off (across, at its Y). */
export const sigLine = (id: string): Layer =>
  ({
    id,
    geom: 'refline',
    stat: {
      kind: 'result',
      fields: { at: { ref: { from: 'cutoff', which: 'sig' } } },
      at: 'at',
    },
    data: { from: 'values' },
    legend: 'hide',
  }) as Layer

/** A Significance layer (of the table's data sets). */
export const significance = (id = 'sig'): Layer => ({
  id,
  geom: 'points',
  stat: { kind: 'threshold' },
})

/** A scatter of the volcano table with these layers over its points. */
export function volcanoGraph(layers: Layer[], cutoffs?: Cutoffs): GraphNode {
  const t = volcanoTable()
  return graphOf(t, 'meanSd', (g) => ({
    layers: [{ id: 'points', geom: 'points', stat: { kind: 'identity' } }, ...layers],
    axes: {
      ...g.axes,
      x: {
        ...g.axes.x,
        title: { content: [{ text: 'log' }, { text: '2', sub: true }, { text: ' fold change' }] },
      },
      y: {
        ...g.axes.y,
        title: { content: [{ text: '−log' }, { text: '10', sub: true }, { text: ' P' }] },
      },
    } as GraphNode['axes'],
    ...(cutoffs ? { cutoffs } : {}),
  }))
}

/** The goldens of roadmap 46b (new files; no golden before it changes). */
export function cutoffCases(): [name: string, table: DataTable, graph: GraphNode][] {
  const t = volcanoTable()
  const grey = { type: 'solid', color: { rgb: '#c8c8c8' }, opacity: 1 } as const
  const volcano = volcanoGraph([
    pmLine('fcLines', 'cutoff', { name: 'log2 FC cut-off' }),
    sigLine('pLine'),
    significance(),
  ])
  volcano.layers[0] = {
    ...volcano.layers[0]!,
    style: { fill: grey, border: { color: { rgb: '#c8c8c8' }, width: 1, dash: 'solid' } },
  } as Layer
  volcano.legend = { ...volcano.legend, show: true, hidden: ['a'] }
  return [
    ['cutoff-pm-lines', t, volcanoGraph([pmLine('pm', 1)])],
    ['cutoff-pm-band-outside', t, volcanoGraph([pmBand('beyond', 1, true)])],
    ['cutoff-volcano-significance', t, volcano],
  ]
}

/** (A graph's id, for tests.) */
export const G1 = 'g1' as NodeId
