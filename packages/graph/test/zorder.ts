import type {
  AnalysisResult,
  AnnotationId,
  DataTable,
  Frame,
  Geom,
  GraphNode,
  Layer,
  NodeId,
  Stat,
  StatKind,
  VariableMapping,
} from '@ps/model'
import {
  frameAllowed,
  GEOM_STATS,
  lookFor,
  type MatrixKind,
  newGraphNode,
  resolveSeries,
  type Scene,
  type SceneNode,
} from '../src/index.ts'
import { projectOf } from './helpers.ts'

// Layer-order helpers (roadmap 33e): layers of every (geom, stat) the matrix allows, graphs of two
// of them, and a scene's marks in paint order with the layer that drew each.

/** A starting stat for a geom (the builder's where it has one). */
export function statFor(geom: Geom, kind: StatKind): Stat {
  switch (kind) {
    case 'identity':
      return { kind }
    case 'summary':
      return geom === 'errorbar' || geom === 'band'
        ? { kind, center: 'mean', error: 'SD' }
        : geom === 'refline'
          ? { kind, center: 'mean', by: 'all' }
          : { kind, center: 'mean' }
    case 'boxplot':
      return { kind, whiskers: 'minmax' }
    case 'range':
      return { kind }
    case 'density':
      return { kind, smoothing: 1, extent: 'truncated', center: 'median' }
    case 'km':
    case 'fraction':
    case 'cell':
      return { kind }
    case 'difference':
      return { kind, ci: 'pooled' }
    case 'bin':
      return { kind, measure: 'count' }
    case 'ellipse':
      return { kind, type: 'norm', level: 0.95 }
    case 'hull':
    case 'centroid':
      return { kind }
    case 'hexbin':
      return { kind, bins: 8 }
    case 'density2d':
      return { kind, n: 25 }
    case 'dotplot':
    case 'threshold':
      return { kind }
    case 'result':
      // Roadmap 35: a label, a line at a value, a band between two (`ZORDER_RESULT`'s values).
      return geom === 'label'
        ? {
            kind,
            fields: { v: VALUE('v') },
            template: 'V = {v}',
            place: { at: 'corner', corner: 'topRight' },
          }
        : geom === 'band'
          ? { kind, fields: { lo: VALUE('lo'), hi: VALUE('hi') }, lo: 'lo', hi: 'hi' }
          : { kind, fields: { v: VALUE('v') }, at: 'v' }
  }
}

const VALUE = (key: string) => ({ ref: { from: 'value' as const, key } })

/** The analysis result layers in z-order tests read (roadmap 35). */
export const ZORDER_ANALYSIS = 'an1' as NodeId
export const ZORDER_RESULT: AnalysisResult = {
  status: 'ok',
  diagnostics: [],
  sheets: [],
  values: {
    v: { kind: 'number', v: 15 },
    lo: { kind: 'number', v: 12 },
    hi: { kind: 'number', v: 18 },
  },
  comparisons: [],
  outputs: {},
}

export interface Spec {
  geom: Geom
  stat: StatKind
}

/** The (geom, stat) layers the matrix allows a table kind on a frame. */
export function specsFor(kind: MatrixKind, frame: Frame): Spec[] {
  const out: Spec[] = []
  for (const [geom, rows] of Object.entries(GEOM_STATS) as [Geom, (typeof GEOM_STATS)[Geom]][])
    for (const stat of rows[kind] ?? [])
      if (frameAllowed(frame, kind, geom, stat).allowed) out.push({ geom, stat })
  return out
}

/** A layer of a spec for a graph of a table kind on a frame. */
export function layerOf(id: string, spec: Spec, kind: MatrixKind, frame: Frame): Layer {
  const layer = { id, geom: spec.geom, stat: statFor(spec.geom, spec.stat) } as Layer
  // Roadmap 35: an analysis' results, wherever they are drawn.
  if (spec.stat === 'result')
    return { ...layer, data: { from: 'analysis', analysis: ZORDER_ANALYSIS } } as Layer
  // A dot plot (roadmap 34g) groups by a text variable (`sampleVariables`' Group).
  if (spec.stat === 'dotplot') return { ...layer, aes: { group: 'a' } } as Layer
  // Pair lines (roadmap 34c) join subjects wherever their points are: no position of their own.
  if (frame === 'grouped' && spec.geom !== 'connector')
    return { ...layer, position: { kind: 'dodge' } } as Layer
  // Roadmap 46b: a Significance layer classes a graph of variables' mapped points (no `aes`).
  if (spec.stat === 'threshold') return layer
  // A multiple-variables XY graph maps variables (points), and joins the rows by group (lines).
  if (frame === 'xy' && kind === 'multipleVariables')
    return {
      ...layer,
      aes:
        spec.geom === 'points'
          ? { x: 'a', y: 'b', color: 'c' }
          : // Vectors (roadmap 34c) end at two more variables.
            spec.geom === 'segment'
            ? { xend: 'c', yend: 'd' }
            : // A histogram (roadmap 34f) bins a variable.
              spec.stat === 'bin'
              ? { x: 'a' }
              : {},
    } as Layer
  return layer
}

const text = (s: string) => ({ source: 'manual' as const, text: s })

/** The keys of a graph's series (a graph of variables: its levels'). */
export const seriesKeys = (table: DataTable, graph: GraphNode): string[] =>
  resolveSeries(projectOf(table, graph), graph).map((s) => s.key)

/**
 * A graph of the sample table drawing two layers, `first` behind `second` (a graph of variables
 * with `mapping`).
 */
export function pairGraph(
  table: DataTable,
  frame: Frame,
  first: Layer,
  second: Layer,
  opts: {
    horizontal?: boolean
    drawOrder?: 'series'
    order?: string[]
    mapping?: VariableMapping
  } = {},
): GraphNode {
  const layers = [first, second]
  const base = newGraphNode(table, { frame, look: lookFor(frame, layers), layers })
  const g = opts.mapping ? { ...base, mapping: opts.mapping } : base
  const keys = seriesKeys(table, g)
  return {
    ...g,
    id: 'g1' as NodeId,
    ...(opts.drawOrder ? { drawOrder: opts.drawOrder } : {}),
    style: {
      ...g.style,
      ...(opts.horizontal ? { orientation: 'horizontal' as const } : {}),
    },
    // Point labels on the first data set, and a bracket between the first two (category graphs).
    // (By data set: the first data set's own order of its layers, front to back, if given.)
    seriesOverrides: {
      [keys[0]!]: {
        pointLabels: { source: 'y', which: 'all' },
        ...(opts.order ? { order: opts.order } : {}),
      },
    },
    annotations:
      frame === 'category' && keys.length > 1
        ? [
            {
              type: 'bracket',
              id: 'n1' as AnnotationId,
              a: keys[0]!,
              b: keys[1]!,
              label: text('**'),
              level: 'auto',
            },
          ]
        : [],
  }
}

/** A drawn mark: its id, the layer that drew it (nearest tagged ancestor) and its data set group. */
export interface Mark {
  id: string
  layer: string | undefined
  /** The `series/<key>` group holding it (drawing by data set). */
  group: string | undefined
  /** The top-level group it sits in (`axis/x`, `annotations`, `legend`, the plot's planes…). */
  top: string
}

/** Every drawn primitive of a scene in paint (document) order. */
export function paintOrder(scene: Scene): Mark[] {
  const out: Mark[] = []
  const walk = (
    n: SceneNode,
    layer: string | undefined,
    group: string | undefined,
    top: string,
  ) => {
    const l = n.layer ?? layer
    const g = /^series\/[^/]+$/.test(n.id) ? n.id : group
    if (n.prim) out.push({ id: n.id, layer: l, group: g, top })
    for (const c of n.children ?? []) walk(c, l, g, top)
  }
  for (const c of scene.root.children ?? []) walk(c, undefined, undefined, c.id)
  return out
}
