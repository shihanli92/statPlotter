import {
  type GraphNode,
  graphOutputs,
  type Layer,
  type NodeId,
  newNodeId,
  type OutputSeries,
} from '@ps/model'

// Graph nodes (schema v2) for the engine tests: a frame, a look and layers, sparse otherwise.

/** Every value of a column graph (the layer most graphs have). */
export const POINTS: Layer = { id: 'points', geom: 'points', stat: { kind: 'identity' } }

/** An outputs layer: analysis outputs drawn as curves. */
export const curves = (series: OutputSeries[]): Layer => ({
  id: 'curves',
  geom: 'line',
  stat: { kind: 'identity' },
  data: { from: 'outputs', series },
})

/** A graph of a table (column scatter by default), with `extra` over it. */
export function testGraph(table: NodeId, extra: Partial<GraphNode> = {}): GraphNode {
  return {
    kind: 'graph',
    id: newNodeId(),
    name: 'g',
    frame: 'category',
    look: 'column.scatter',
    layers: [POINTS],
    seriesSource: { table, include: 'all' },
    seriesOverrides: {},
    size: { plotWidth: 100, plotHeight: 100 },
    axes: {
      x: { type: 'categorical', title: null, labels: 'dataSetTitles', rotation: 0 },
      y: {
        type: 'continuous',
        title: null,
        scale: 'linear',
        range: 'auto',
        ticks: 'auto',
        format: { mode: 'auto' },
        frame: 'plain',
        breaks: [],
      },
    },
    annotations: [],
    legend: { show: false, position: 'right' },
    title: null,
    style: {},
    ...extra,
  }
}

/** XY graphs (a frame of continuous axes). */
export const XY = { frame: 'xy', look: 'xy.scatter' } as const
/** Grouped graphs. */
export const GROUPED = { frame: 'grouped', look: 'grouped.bar' } as const

/** The analysis outputs a graph's layers draw. */
export const outputsOf = (g: GraphNode): OutputSeries[] => graphOutputs(g).map((o) => o.series)
