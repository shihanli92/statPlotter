import {
  type DataTable,
  type GraphEdit,
  type GraphNode,
  graphEdits,
  type Layer,
  type LayerOf,
  type NodeId,
  newSeriesId,
  type OutputDecl,
  type OutputSeries,
} from '@ps/model'
import { defaultContinuousAxis } from './layout/common.ts'
import { newGraphNode } from './scaffold.ts'

// Analysis outputs on graphs (decision 236): fitted curves, bands and output points are the
// series of three output layers — `curves` (lines), `curveBands` and `curvePoints` drawing the
// curves' data — made when a graph first gets outputs, at the back of its list (where migrating
// a v1 graph's extra series puts them). An output drawn as points has its line and band left out.

/** A series of the output layers for an analysis output. */
const seriesOf = (analysisId: NodeId, o: OutputDecl): OutputSeries => ({
  id: newSeriesId(),
  ref: { node: analysisId, key: o.key },
  ...(o.forDataSet ? { colorOf: o.forDataSet } : {}),
})

type Hidden = { hide: boolean }

/** The output layers with `added` outputs: made where missing, each output's marks shown. */
function outputLayers(
  layers: readonly Layer[],
  added: readonly { series: OutputSeries; decl: OutputDecl }[],
): Layer[] {
  const out = [...layers]
  const find = (id: string) => out.findIndex((l) => l.id === id)
  const entries = (show: (d: OutputDecl) => boolean, hidden: boolean) =>
    Object.fromEntries(
      added.flatMap(({ series, decl }) =>
        show(decl) === !hidden ? [] : [[series.id as string, { hide: !show(decl) } as Hidden]],
      ),
    )
  const merge = (l: Layer, more: Record<string, Hidden>): Layer =>
    Object.keys(more).length ? ({ ...l, series: { ...l.series, ...more } } as Layer) : l

  // Lines: every output but those drawn as points.
  const line = (d: OutputDecl) => d.mark !== 'points'
  let at = find('curves')
  if (at < 0) {
    const curves: LayerOf<'line'> = {
      id: 'curves',
      geom: 'line',
      stat: { kind: 'identity' },
      data: { from: 'outputs', series: added.map((a) => a.series) },
    }
    out.splice(0, 0, merge(curves, entries(line, false)))
    at = 0
  } else {
    const curves = out[at]!
    const data = curves.data?.from === 'outputs' ? curves.data.series : []
    out[at] = merge(
      { ...curves, data: { from: 'outputs', series: [...data, ...added.map((a) => a.series)] } },
      entries(line, curves.seriesHidden ?? false),
    )
  }
  // Bands with the lines; points only for outputs drawn with points.
  const roles: [string, Layer['geom'], (d: OutputDecl) => boolean, boolean][] = [
    ['curveBands', 'band', line, false],
    ['curvePoints', 'points', (d) => d.mark === 'points' || d.mark === 'linePoints', true],
  ]
  for (const [id, geom, show, hiddenByDefault] of roles) {
    const i = find(id)
    if (i >= 0) {
      out[i] = merge(out[i]!, entries(show, out[i]!.seriesHidden ?? false))
      at = i
      continue
    }
    // Bands come with the curves (analyses choose whether to compute them); points as needed.
    if (hiddenByDefault && !added.some((a) => show(a.decl))) continue
    const layer = {
      id,
      geom,
      stat: { kind: 'identity' },
      data: { from: 'layer', layer: 'curves' },
      ...(hiddenByDefault ? { seriesHidden: true } : {}),
    } as Layer
    out.splice(at + 1, 0, merge(layer, entries(show, hiddenByDefault)))
    at += 1
  }
  return out
}

/**
 * An analysis' declared outputs (fitted curves…) added to a graph of the analyzed table: the
 * graph's output layers draw them (made when the graph has none); outputs already on the graph
 * are skipped. With the edits doing it (none when nothing is added).
 */
export function withOutputSeries(
  graph: GraphNode,
  analysisId: NodeId,
  outputs: readonly OutputDecl[],
): { graph: GraphNode; edits: GraphEdit[] } {
  const have = new Set(
    graph.layers.flatMap((l) =>
      l.data?.from === 'outputs'
        ? l.data.series.filter((e) => e.ref.node === analysisId).map((e) => e.ref.key)
        : [],
    ),
  )
  // Roadmap 35: outputs with a graph of their own drawn on graphs of the variables they map too.
  const mapped = graph.layers.find((l) => l.geom === 'points' && l.aes)?.aes
  const onThis = (o: OutputDecl) =>
    !o.graph || (!!o.onGraphsOf && o.onGraphsOf.x === mapped?.x && o.onGraphsOf.y === mapped?.y)
  const added = outputs
    .filter((o) => onThis(o) && !have.has(o.key))
    .map((decl) => ({ decl, series: seriesOf(analysisId, decl) }))
  if (!added.length) return { graph, edits: [] }
  const seriesOverrides = { ...graph.seriesOverrides }
  for (const { decl, series } of added)
    if (decl.pointLabels)
      seriesOverrides[series.id] = { ...seriesOverrides[series.id], pointLabels: decl.pointLabels }
  const next: GraphNode = { ...graph, layers: outputLayers(graph.layers, added), seriesOverrides }
  return { graph: next, edits: graphEdits(graph, next) }
}

/**
 * New XY graphs for outputs that ask for a graph of their own (ROC curve, Bland-Altman plot…):
 * one graph per distinct `graph.id`, showing only those outputs.
 */
export function outputGraphsFor(
  table: DataTable,
  analysisId: NodeId,
  outputs: readonly OutputDecl[],
): GraphNode[] {
  const groups = new Map<string, OutputDecl[]>()
  for (const o of outputs)
    if (o.graph) groups.set(o.graph.id, [...(groups.get(o.graph.id) ?? []), o])
  return [...groups.values()].map((all) => {
    // A graph of the analysis' result table's variables (roadmap 34c): its other outputs drawn
    // over the points.
    const vars = all.find((d) => d.graph?.variables)?.graph?.variables
    const decls = vars ? all.filter((d) => !d.graph?.variables) : all
    const spec = all[0]!.graph!
    const base = newGraphNode(table, { frame: 'xy', look: 'xy.scatter', layers: [] }, spec.name)
    const axis = (title?: string, range?: [number, number]) => ({
      ...defaultContinuousAxis(),
      title: title ? { content: [{ text: title }] } : null,
      ...(range ? { range: { min: range[0], max: range[1] } } : {}),
    })
    const added = decls.map((decl) => ({ decl, series: seriesOf(analysisId, decl) }))
    const seriesOverrides: GraphNode['seriesOverrides'] = {}
    for (const { decl, series } of added)
      if (decl.pointLabels) seriesOverrides[series.id] = { pointLabels: decl.pointLabels }
    const points: Layer[] = vars
      ? [
          ...(vars.ellipses ? [ELLIPSES] : []),
          {
            id: 'points',
            geom: 'points',
            stat: { kind: 'identity' },
            aes: { x: vars.x, y: vars.y, ...(vars.color ? { color: vars.color } : {}) },
          },
        ]
      : []
    return {
      ...base,
      name: spec.name,
      layers: [...(added.length ? outputLayers([], added) : []), ...points],
      seriesSource: vars ? { table: analysisId, include: 'all' } : { table: table.id, include: [] },
      seriesOverrides,
      axes: { x: axis(spec.xTitle, spec.xRange), y: axis(spec.yTitle, spec.yRange) },
      ...(spec.square ? { size: { plotWidth: 180, plotHeight: 180 } } : {}),
      legend: { show: decls.length > 1 || !!vars?.color, position: 'right' },
      title: { content: [{ text: spec.name }] },
    }
  })
}

/** Roadmap 34c: the ellipse layer an analysis' graph of variables gets per colour group. */
export const ELLIPSES: Layer = {
  id: 'ellipses',
  geom: 'polygon',
  stat: { kind: 'ellipse', type: 'norm', level: 0.95 },
}

/**
 * The declared outputs that need a graph of their own on this project: those no graph shows yet
 * (editing an analysis keeps its graphs). A graph of the analysis' result table's variables
 * (roadmap 34c) is shown by a graph of that table mapping the same X and Y on its points and
 * drawing the graph's other outputs.
 */
export function outputsWithoutGraph(
  graphs: readonly GraphNode[],
  analysisId: NodeId,
  decls: readonly OutputDecl[],
): OutputDecl[] {
  const shows = (g: GraphNode, key: string) =>
    g.layers.some(
      (l) =>
        l.data?.from === 'outputs' &&
        l.data.series.some((s) => s.ref.node === analysisId && s.ref.key === key),
    )
  const shown = (d: OutputDecl) => {
    const vars = d.graph?.variables
    if (!vars) return graphs.some((g) => shows(g, d.key))
    const others = decls.filter((o) => o.graph?.id === d.graph?.id && !o.graph?.variables)
    return graphs.some(
      (g) =>
        g.seriesSource.table === analysisId &&
        g.layers.some((l) => l.geom === 'points' && l.aes?.x === vars.x && l.aes?.y === vars.y) &&
        others.every((o) => shows(g, o.key)),
    )
  }
  return decls.filter((d) => !shown(d))
}

/**
 * Roadmap 34c: graphs of an analysis' result table that should draw ellipses per group (an
 * analysis' "Ellipses per group" turned on after its graphs were made) and don't: each with the
 * ellipse layer to add, just behind its points.
 */
export function missingEllipses(
  graphs: readonly GraphNode[],
  analysisId: NodeId,
  decls: readonly OutputDecl[],
): { graph: GraphNode; layer: Layer; at: number }[] {
  const wanted = decls.flatMap((d) => (d.graph?.variables?.ellipses ? [d.graph.variables] : []))
  if (!wanted.length) return []
  return graphs.flatMap((g) => {
    if (g.seriesSource.table !== analysisId) return []
    const at = g.layers.findIndex(
      (l) => l.geom === 'points' && wanted.some((v) => l.aes?.x === v.x && l.aes?.y === v.y),
    )
    if (at < 0 || g.layers.some((l) => l.geom === 'polygon' || l.id === ELLIPSES.id)) return []
    return [{ graph: g, layer: ELLIPSES, at }]
  })
}
