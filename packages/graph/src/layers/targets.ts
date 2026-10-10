import type { DataTable, GraphNode, Layer } from '@ps/model'
import { hasRawValues } from '../data.ts'
import type { Scene, SceneNode, StylePath } from '../scene.ts'
import { checkLayers, matrixKindOf } from './matrix.ts'

// Layer-scoped targets (roadmap 33c, design §5.4): the layer engine draws with v1's targets (its
// geoms were carved from the v1 layouts, roadmap 33a); `layoutGraph` then gives every mark its
// layer's target. A data set's marks in a layer target
// `['layers', id, 'series', key]` (outputs and functions by their ids), a layer drawn once for
// the graph (heat map cells, an estimation plot's differences, the grand mean, pies' labels,
// before-after lines) `['layers', id]`; a data set's identity (its group, legend entry) stays
// `['seriesOverrides', key]`. Targets aren't written to SVG: goldens don't change.

/** Graph-level v1 targets of chart options, by the geom of the layer now holding them. */
const CHART_GEOM: Record<string, Layer['geom']> = {
  heatmap: 'tile',
  estimation: 'difference',
  grandMean: 'refline',
  pie: 'label',
}

/** The scene with layer-scoped targets (in place: `layoutGraph`'s scene is its own). */
export function layerTargets(scene: Scene, graph: GraphNode): Scene {
  const outputs = graph.layers.flatMap((l) => (l.data?.from === 'outputs' ? l.data.series : []))
  const functions = graph.layers.flatMap((l) =>
    l.data?.from === 'functions' ? l.data.functions : [],
  )
  const byGeom = (geom: Layer['geom']) => graph.layers.find((l) => l.geom === geom)?.id
  const seriesKey = (t: StylePath): string | undefined => {
    const [root, i] = t
    if (root === 'seriesOverrides') return String(i)
    if (root === 'extraSeries') return outputs[Number(i)]?.id
    if (root === 'functions') return functions[Number(i)]?.id
    return undefined
  }
  const retarget = (t: StylePath, layer: string | undefined): StylePath => {
    const [root, second] = t
    if (root === 'seriesOverrides' || root === 'extraSeries' || root === 'functions') {
      const key = seriesKey(t)
      if (key === undefined) return t
      // A mark of a layer; else (a legend entry, a data set's group) the series' identity.
      if (layer && t.length >= 3) return ['layers', layer, 'series', key]
      return root === 'seriesOverrides' ? t : ['seriesOverrides', key]
    }
    if (root === 'style') {
      if (t.length === 1) {
        // Before-after lines.
        const id = layer ?? byGeom('connector')
        return id ? ['layers', id] : t
      }
      const geom = CHART_GEOM[String(second)]
      if (geom) {
        const id =
          geom === 'label' ? (layer ?? byGeom('label') ?? byGeom('wedge')) : (byGeom(geom) ?? layer)
        return id ? ['layers', id] : t
      }
    }
    return t
  }
  const walk = (n: SceneNode, layer: string | undefined) => {
    const own = n.layer ?? layer
    if (n.target) n.target = retarget(n.target, own)
    if (n.children) for (const c of n.children) walk(c, own)
  }
  walk(scene.root, undefined)
  return scene
}

/**
 * Warnings for layers the graph's table can't support (decision 229: kept and drawn as far as
 * possible), for those that drew something.
 */
export function matrixWarnings(
  scene: Scene,
  graph: GraphNode,
  table: Pick<DataTable, 'tableKind' | 'yFormat' | 'dataSets'> | undefined,
  name: (l: Layer) => string,
): string[] {
  if (!table) return []
  const drew = new Set<string>()
  const walk = (n: SceneNode) => {
    if (n.layer && (n.prim || n.children?.length)) drew.add(n.layer)
    for (const c of n.children ?? []) walk(c)
  }
  walk(scene.root)
  if (!drew.size) return []
  const checked = checkLayers(graph, matrixKindOf(table, graph), {
    raw: hasRawValues(table),
  })
  return graph.layers.flatMap((l) => {
    const a = checked.get(l.id)
    return a && !a.allowed && drew.has(l.id) ? [`${name(l)}: ${a.reason}.`] : []
  })
}
