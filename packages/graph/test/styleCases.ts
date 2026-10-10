import {
  type AnalysisResult,
  type AnnotationId,
  builtinStyle,
  type DocNode,
  type GraphNode,
  type Layer,
  type NodeId,
  type Project,
  type ProjectSettings,
  plainText,
  withProjectStyle,
} from '@ps/model'
import { newGraphNode, presetGraph, resetToStyle } from '../src/index.ts'
import { graphOf, layerOf, withLayer } from './graphs.ts'
import { appearanceTable, cytometryTable, projectOf, sampleTable } from './helpers.ts'
import { analysisNode, curvesLayer, DOSE_FIT, doseTable } from './resultCases.ts'

// Roadmap 37's goldens: one representative graph (bars, points, error bars, brackets, a legend)
// in each journal style, an XY fit in one, a graph with the user's edits kept through a change of
// style, and the same after Reset to style.

export type StyleCase = [
  name: string,
  project: Project,
  graph: GraphNode,
  results: Record<string, AnalysisResult>,
]

const JOURNALS = ['journal-nature', 'journal-cell', 'journal-science', 'journal-pnas'] as const

const settingsOf = (id: string): Pick<ProjectSettings, 'theme' | 'style'> => {
  const s = builtinStyle(id)!
  return { theme: s.id, style: s.style }
}

const inProject = (settings: Partial<ProjectSettings>, ...nodes: DocNode[]): Project => {
  const p = projectOf(...nodes)
  return { ...p, settings: { ...p.settings, ...settings } }
}

/** Bars of means with SD error bars and every point, two brackets, a note and a legend. */
export function representativeGraph(): { table: DocNode; graph: GraphNode } {
  const table = sampleTable('column')
  const [a, b, c] = table.kind === 'table' ? table.dataSets.map((d) => d.id) : []
  const graph = graphOf(table, 'barsPoints', (g) => ({
    title: { content: plainText('Response') },
    axes: {
      ...g.axes,
      y: { ...g.axes.y, title: { content: plainText('Signal (a.u.)') } },
    },
    legend: { ...g.legend, show: true },
    annotations: [
      {
        type: 'bracket',
        id: 'b1' as AnnotationId,
        a: a!,
        b: b!,
        label: { source: 'manual', text: '**' },
        level: 'auto',
      },
      {
        type: 'bracket',
        id: 'b2' as AnnotationId,
        a: a!,
        b: c!,
        label: { source: 'manual', text: 'ns' },
        level: 'auto',
      },
      {
        type: 'text',
        id: 't1' as AnnotationId,
        anchor: { space: 'plot', x: 0.05, y: 0.05 },
        content: { content: plainText('n = 3') },
      },
    ],
  }))
  return { table, graph }
}

export function styleCases(): StyleCase[] {
  const { table, graph } = representativeGraph()
  const journals = JOURNALS.map((id): StyleCase => {
    const g = withProjectStyle(graph, { theme: 'default' }, settingsOf(id), true)
    return [`style-${id.slice(8)}-bars-points`, inProject(settingsOf(id), table, g), g, {}]
  })

  // An XY fit (points, the fitted curves) in one journal's style.
  const dose = doseTable()
  const fit = analysisNode('fit', 'nonlinearFit', dose, ['a', 'b'], {}, 'Nonlinear fit')
  const xy = graphOf(dose, 'pointsOnly', (g) => ({
    layers: [...g.layers, curvesLayer('fit', ['a', 'b'])],
    axes: { ...g.axes, x: { ...g.axes.x, scale: 'log10' } as GraphNode['axes']['x'] },
  }))
  const nature = settingsOf('journal-nature')
  const xyFit: StyleCase = [
    'style-nature-xy-fit',
    inProject(nature, dose, fit, xy),
    withProjectStyle(xy, { theme: 'default' }, nature, true),
    { fit: DOSE_FIT },
  ]

  // The user's own formatting (title size, Y axis line, symbol size, a legend font) set under
  // one style, kept when the project changes to another; then cleared by Reset to style.
  const points = layerOf(graph, 'points')
  const edited: GraphNode = {
    ...withLayer(graph, points.id, { style: { size: 9 } }),
    title: { content: plainText('Response'), style: { size: 16, italic: true } },
    axes: { ...graph.axes, y: { ...graph.axes.y, line: { width: 2 } } },
    legend: { ...graph.legend, text: { font: 'serif' } },
  }
  const cell = settingsOf('journal-cell')
  const kept = withProjectStyle(edited, nature, cell, true)
  const reset = resetToStyle(kept, cell)
  // Audit 2 (G9): the newer geoms under a journal's style: ellipses with the groups' names at
  // their centroids, and density contours (lines and bands).
  const mv = appearanceTable()
  const bubble = presetGraph(mv, 'bubble')
  const overlays: GraphNode = {
    ...bubble,
    id: 'g1' as NodeId,
    layers: [
      {
        id: 'ellipse',
        geom: 'polygon',
        stat: { kind: 'ellipse', type: 'norm', level: 0.95 },
      } as Layer,
      ...bubble.layers.map((l) =>
        l.aes ? ({ ...l, aes: { x: 'c', y: 'd', color: 'a' } } as Layer) : l,
      ),
      { id: 'names', geom: 'label', stat: { kind: 'centroid' } } as Layer,
    ],
    legend: { ...bubble.legend, show: true },
  }
  const cy = cytometryTable()
  const dens = newGraphNode(cy, {
    frame: 'xy',
    look: 'bubble.scatter',
    layers: [
      {
        id: 'contours',
        geom: 'contour',
        stat: { kind: 'density2d', n: 50 },
        aes: {},
        style: { draw: 'both' },
      } as Layer,
      {
        id: 'points',
        geom: 'points',
        stat: { kind: 'identity' },
        aes: { x: 'c', y: 'd' },
        visible: false,
      } as Layer,
    ],
  })
  const arcsinh = { scale: 'arcsinh', arcsinh: { cofactor: 150 } }
  const contours = {
    ...dens,
    id: 'g2' as NodeId,
    axes: { ...dens.axes, x: { ...dens.axes.x, ...arcsinh }, y: { ...dens.axes.y, ...arcsinh } },
  } as GraphNode
  const newer: StyleCase[] = [
    [
      'style-nature-ellipses',
      inProject(nature, mv, overlays),
      withProjectStyle(overlays, { theme: 'default' }, nature, true),
      {},
    ],
    // Science-style: 1 pt data lines (contours are 0.75 pt by default).
    [
      'style-science-contours',
      inProject(settingsOf('journal-science'), cy, contours),
      withProjectStyle(contours, { theme: 'default' }, settingsOf('journal-science'), true),
      {},
    ],
  ]
  return [
    ...journals,
    xyFit,
    ...newer,
    ['style-edits-kept', inProject(cell, table, kept), kept, {}],
    ['style-reset', inProject(cell, table, reset), reset, {}],
  ]
}
