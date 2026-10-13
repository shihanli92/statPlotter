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

/**
 * Audit 4 (G3): the longest name (a data set's, in the legend and on a category axis) and words
 * (an axis title, a bracket's label) a sketch draws, in characters, longer ones ending "…"; and
 * the most data sets it shows a legend for. A sketch is a picture of the design: thirty long
 * names must not make it hundreds of points tall.
 */
export const SKETCH_TEXT = { name: 24, words: 40, legend: 8 } as const

/** At most `n` whole characters (code points), ending "…" when cut. */
const clip = (s: string, n: number) => {
  const chars = [...s]
  return chars.length > n
    ? `${chars
        .slice(0, n - 1)
        .join('')
        .trimEnd()}…`
    : s
}

/**
 * A typed reference line at a value of an axis (as Add line does); dashed for a constraint
 * (roadmap 51e: "Bottom = 0" on a curve fit's sketch).
 */
const refline = (i: number, at: number, axis: 'x' | 'y', dashed = false): Layer =>
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
    ...(dashed ? { style: { line: { dash: 'dash' } } } : {}),
  }) as Layer

/**
 * The graph of a sketch panel and the project it is laid out in (its table and itself). `size`:
 * the plot size in points.
 */
export function sketchGraph(
  panel: SketchPanel,
  size: { width: number; height: number } = SKETCH_PLOT,
): { project: Project; graph: GraphNode } {
  // Names and words cut (audit 4 G3): the transient table's titles too.
  const table = {
    ...panel.table,
    dataSets: panel.table.dataSets.map((d) => ({ ...d, title: clip(d.title, SKETCH_TEXT.name) })),
    rowTitles:
      panel.table.rowTitles?.map((t) => (t === null ? t : clip(t, SKETCH_TEXT.name))) ?? null,
    x: panel.table.x && { ...panel.table.x, title: clip(panel.table.x.title, SKETCH_TEXT.words) },
  }
  const base = presetGraph(table, panel.preset, panel.title ?? 'Sketch')
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
  layers = [
    ...layers,
    ...(panel.lines ?? []).map((l, i) => refline(i, l.at, l.axis ?? 'y', l.dashed)),
  ]
  const annotations: Annotation[] = [
    ...(panel.brackets ?? []).map(
      (b, i): Annotation => ({
        type: 'bracket',
        id: `b${i}` as AnnotationId,
        a: b.a,
        b: b.b,
        label: { source: 'manual', text: clip(b.label, SKETCH_TEXT.words) },
        level: 'auto',
      }),
    ),
    // Roadmap 51e: names at data coordinates (a thumbnail's Top, Bottom, EC50; a constraint's).
    ...(panel.labels ?? []).map(
      (l, i): Annotation => ({
        type: 'text',
        id: `t${i}` as AnnotationId,
        anchor: { space: 'data', x: l.x, y: l.y },
        content: { ...title(clip(l.text, SKETCH_TEXT.words)), style: { size: 7 } },
      }),
    ),
  ]
  const axes = { ...base.axes }
  if (panel.axes?.yLog && axes.y.type === 'continuous') axes.y = { ...axes.y, scale: 'log10' }
  if (panel.axes?.xLog && axes.x.type === 'continuous') axes.x = { ...axes.x, scale: 'log10' }
  if (panel.axes?.xTitle)
    axes.x = { ...axes.x, title: title(clip(panel.axes.xTitle, SKETCH_TEXT.words)) }
  if (panel.axes?.yTitle)
    axes.y = { ...axes.y, title: title(clip(panel.axes.yTitle, SKETCH_TEXT.words)) }
  if (panel.axes?.bare) {
    axes.x = { ...axes.x, title: null, showLabels: false }
    axes.y = { ...axes.y, title: null, showLabels: false }
  }
  // One data set needs no legend (its name is the panel's title or axis); more than
  // SKETCH_TEXT.legend get none either (audit 4 G3: a legend of thirty made the picture 1,000
  // points tall; the sketch's words name the data sets).
  const n = table.dataSets.length
  const legend = n < 2 || n > SKETCH_TEXT.legend ? { ...base.legend, show: false } : base.legend
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
  project.nodes[table.id] = table
  project.nodes[graph.id] = graph
  project.order.push(table.id, graph.id)
  return { project, graph }
}
