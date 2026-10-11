import type { DataTable, GraphNode, Layer, LayerOf } from '@ps/model'
import { withTrees } from '../src/index.ts'
import { graphOf, withLayer } from './graphs.ts'
import { fixedTable } from './helpers.ts'

// Roadmap 49c: dendrograms as layers — heat maps with their trees on each side, of other depths
// and gaps, equal steps, cut into clusters (coloured branches, strips, legend entries), drawn by
// data set, and dendrograms alone in both orientations — for the graph tests and their goldens.

const one = { type: 'replicates', count: 1 } as const

/** A grouped table of seven genes × five samples (one value per cell). */
export function genesTable(): DataTable {
  const rows = [
    [1, 9, 2, 8, 4],
    [2, 7, 1, 9, 3],
    [0, 8, 3, 7, 5],
    [5, 5, 6, 4, 2],
    [9, 1, 8, 2, 6],
    [3, 6, 2, 5, 9],
    [8, 2, 9, 1, 7],
  ]
  return fixedTable(
    'grouped',
    one,
    rows[0]!.map((_, j) => [rows.map((r) => r[j]!)]),
    {
      titles: rows[0]!.map((_, j) => `S${j + 1}`),
      rowTitles: rows.map((_, i) => `Gene ${i + 1}`),
    },
  )
}

/** A multiple-variables table of eight samples × four measurements. */
export function measuresTable(): DataTable {
  return fixedTable(
    'multipleVariables',
    one,
    [
      [[4.1, 3.2, 5.5, 6.0, 2.2, 4.8, 3.9, 5.1]],
      [[1.0, 2.1, 0.5, 0.9, 2.8, 1.4, 2.0, 0.7]],
      [[7.5, 6.1, 8.2, 8.9, 5.0, 7.1, 6.4, 8.0]],
      [[0.2, 0.9, 0.1, 0.3, 1.2, 0.6, 0.8, 0.2]],
    ],
    {
      titles: ['Height', 'Weight', 'Span', 'Mass'],
      rowTitles: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
    },
  )
}

/** A heat map clustering rows and columns, with both trees (styles and stats patched). */
export function clusteredMap(
  table: DataTable,
  rows: Partial<LayerOf<'dendrogram'>> = {},
  columns: Partial<LayerOf<'dendrogram'>> = {},
  patch: Partial<GraphNode> = {},
): GraphNode {
  const g = withLayer(graphOf(table, 'heatmap'), 'cells', {
    style: { cluster: { rows: true, columns: true } },
  })
  const layers = withTrees(g.layers).map((l): Layer => {
    if (l.geom !== 'dendrogram') return l
    const p = l.stat.of === 'rows' ? rows : columns
    return { ...l, ...p, stat: { ...l.stat, ...p.stat }, style: { ...l.style, ...p.style } }
  })
  return { ...g, layers, ...patch }
}

/** A dendrogram alone of a table (the preset), its tree layer patched. */
export function treeAlone(table: DataTable, patch: Partial<LayerOf<'dendrogram'>> = {}) {
  const g = graphOf(table, 'dendrogram')
  return {
    ...g,
    layers: g.layers.map((l) =>
      l.geom === 'dendrogram'
        ? ({
            ...l,
            ...patch,
            stat: { ...l.stat, ...patch.stat },
            style: { ...l.style, ...patch.style },
          } as Layer)
        : l,
    ),
  }
}

type Case = [name: string, table: DataTable, graph: GraphNode]

/** The goldens of roadmap 49c. */
export function dendrogramCases(): Case[] {
  const genes = genesTable()
  const measures = measuresTable()
  const k3 = { kind: 'cluster', of: 'rows', cut: { k: 3 } } as const
  return [
    [
      'tree-rows-left-columns-bottom',
      genes,
      clusteredMap(genes, { style: { side: 'left' } }, { style: { side: 'bottom' } }),
    ],
    [
      'tree-depths-gaps-steps',
      genes,
      clusteredMap(
        genes,
        { style: { depth: 60, gap: 12 } },
        { style: { depth: 18, gap: 0, heights: 'steps' } },
      ),
    ],
    [
      'tree-cut-strip-legend',
      genes,
      clusteredMap(
        genes,
        { stat: k3, style: { strip: true } },
        {
          stat: { kind: 'cluster', of: 'columns', cut: { h: 6 } },
          style: { strip: true, colorBranches: false, stripWidth: 5 },
        },
        { legend: { show: true, position: 'right' } },
      ),
    ],
    [
      'tree-cut-colours-left',
      genes,
      clusteredMap(
        genes,
        {
          stat: k3,
          style: {
            side: 'left',
            strip: true,
            line: { color: { rgb: '#555555' }, width: 1.25, dash: 'solid' },
            clusterColors: { '1': { rgb: '#d62728' }, '3': { palette: 5 } },
          },
        },
        {},
      ),
    ],
    [
      'tree-by-data-set',
      genes,
      clusteredMap(
        genes,
        { stat: k3 },
        { stat: { kind: 'cluster', of: 'columns', cut: { k: 2 } } },
        {
          drawOrder: 'series',
        },
      ),
    ],
    ['tree-alone-bottom-cut', genes, treeAlone(genes, { stat: k3, style: { strip: true } })],
    [
      'tree-alone-left-steps',
      measures,
      (() => {
        const g = treeAlone(measures, {
          stat: { kind: 'cluster', of: 'columns', linkage: 'average', distance: 'pearson' },
          style: { side: 'right', heights: 'steps' },
        })
        return { ...g, axes: { x: g.axes.y, y: g.axes.x } }
      })(),
    ],
    [
      'tree-alone-left-merge',
      measures,
      (() => {
        const g = treeAlone(measures, {
          style: { side: 'right' },
          stat: { kind: 'cluster', of: 'rows', linkage: 'ward' },
        })
        return { ...g, axes: { x: g.axes.y, y: g.axes.x } }
      })(),
    ],
  ]
}
