import {
  type Annotation,
  type AnnotationId,
  createProject,
  type GraphNode,
  type Layer,
  type NodeId,
  type Project,
  type SketchPanel,
  type TextSpec,
} from '@ps/model'
import { presetGraph } from './presets.ts'

// Roadmap 51b (design §5.1): a panel of the Analyze dialog's live sketch as an ordinary v2 graph
// of a transient table — the native preset the analysis named, its brackets (typed labels), its
// reference lines (typed values) and the data sets drawn as lines — in a project of its own,
// never stored. Nothing here knows which analysis asked: the panel is data.

/** The sketch's plot size, in points. */
export const SKETCH_PLOT = { width: 220, height: 130 } as const

const title = (text: string): TextSpec => ({ content: [{ text }] })

/** A typed reference line at a value of an axis (as Add line does). */
const refline = (i: number, at: number, axis: 'x' | 'y'): Layer =>
  ({
    id: `ref${i}`,
    geom: 'refline',
    stat: {
      kind: 'result',
      fields: { at: { ref: { from: 'number', v: at } } },
      at: 'at',
      ...(axis === 'x' ? { axis: 'x' } : {}),
    },
    data: { from: 'values' },
    legend: 'hide',
  }) as Layer

/**
 * The graph of a sketch panel and the project it is laid out in (its table and itself). `size`:
 * the plot size in points.
 */
export function sketchGraph(
  panel: SketchPanel,
  size: { width: number; height: number } = SKETCH_PLOT,
): { project: Project; graph: GraphNode } {
  const base = presetGraph(panel.table, panel.preset, panel.title ?? 'Sketch')
  const lineSets = new Set(panel.lineSets ?? [])
  let layers: Layer[] = base.layers.map((l) =>
    lineSets.size && !l.data
      ? ({
          ...l,
          series: {
            ...(l.series ?? {}),
            ...Object.fromEntries([...lineSets].map((k) => [k, { hide: true }])),
          },
        } as Layer)
      : l,
  )
  if (lineSets.size)
    layers.push({
      id: 'shape',
      geom: 'line',
      stat: { kind: 'identity' },
      seriesHidden: true,
      series: Object.fromEntries([...lineSets].map((k) => [k, { hide: false }])),
    } as Layer)
  layers = [...layers, ...(panel.lines ?? []).map((l, i) => refline(i, l.at, l.axis ?? 'y'))]
  const annotations: Annotation[] = (panel.brackets ?? []).map((b, i) => ({
    type: 'bracket',
    id: `b${i}` as AnnotationId,
    a: b.a,
    b: b.b,
    label: { source: 'manual', text: b.label },
    level: 'auto',
  }))
  const axes = { ...base.axes }
  if (panel.axes?.yLog && axes.y.type === 'continuous') axes.y = { ...axes.y, scale: 'log10' }
  if (panel.axes?.xTitle) axes.x = { ...axes.x, title: title(panel.axes.xTitle) }
  if (panel.axes?.yTitle) axes.y = { ...axes.y, title: title(panel.axes.yTitle) }
  // One data set needs no legend (its name is the panel's title or axis).
  const legend = panel.table.dataSets.length < 2 ? { ...base.legend, show: false } : base.legend
  const graph: GraphNode = {
    ...base,
    legend,
    id: `sketchg${panel.id.replace(/[^0-9a-z]/g, '')}` as NodeId,
    layers,
    annotations,
    axes,
    title: null,
    size: { plotWidth: size.width, plotHeight: size.height },
  }
  const project = createProject('Sketch', new Date(0))
  project.nodes[panel.table.id] = panel.table
  project.nodes[graph.id] = graph
  project.order.push(panel.table.id, graph.id)
  return { project, graph }
}
