import {
  type ColumnId,
  createProject,
  createTable,
  type DataTable,
  type Frame,
  type GraphNode,
  type Layer,
  type NodeId,
  type TableKind,
  type YFormat,
} from '@ps/model'
import type { FontRegistry } from './fonts/registry.ts'
import type { MatrixKind } from './layers/matrix.ts'
import { defaultContinuousAxis } from './layout/common.ts'
import { layoutGraph } from './layout/dispatch.ts'
import { Lru } from './lru.ts'
import { plotStyle, styleLayer } from './plotStyles.ts'
import { presetLayers } from './presets.ts'
import type { Scene } from './scene.ts'

// Plot-style icons (roadmap 33c): each style drawn by the graph engine itself from a tiny fixed
// sample of a table kind, no axes or text, so an icon shows what the style draws in the user's
// palette. Deterministic (fixed data, ids and sizes) and cached per fonts, palette and style.

/** The icon's plot area (points); the builder shows it in a ~52 px circle. */
export const ICON_SIZE = { plotWidth: 48, plotHeight: 36 }

/** The part of an icon's scene to show: its plot area and a little round it. */
export function iconViewBox(scene: Scene): [number, number, number, number] {
  const pad = 3
  const { x, y, w, h } = scene.plot
  return [x - pad, y - pad, w + 2 * pad, h + 2 * pad]
}

/** A tiny table of a kind, fixed data and ids (`icon`, data sets `a`, `b`…). */
function iconTable(kind: TableKind): DataTable {
  const make = (yFormat: YFormat, cols: (number | null)[][][], x?: number[]) => {
    const rows = Math.max(...cols.flatMap((c) => c.map((s) => s.length)))
    const t = createTable({ tableKind: kind, yFormat, columns: cols.length, rows })
    t.id = 'icon' as NodeId
    t.name = 'Icon'
    t.dataSets.forEach((d, i) => {
      d.id = String.fromCharCode(97 + i) as ColumnId
      d.title = d.id
      d.subcolumns.forEach((s, j) => {
        s.values = Array.from({ length: rows }, (_, r) => cols[i]![j]?.[r] ?? null)
      })
    })
    if (x && t.x) t.x.subcolumns[0]!.values = x
    return t
  }
  const one = { type: 'replicates', count: 1 } as const
  const reps = (count: number) => ({ type: 'replicates', count }) as const
  switch (kind) {
    case 'xy':
      return make(
        reps(3),
        [
          [
            [1, 2.4, 3.1, 4.6],
            [1.6, 2, 3.8, 4.1],
            [1.2, 2.9, 3.4, 5],
          ],
          [
            [3, 3.6, 4.4, 4.2],
            [2.4, 4.1, 3.9, 5.1],
            [3.4, 3.2, 4.8, 4.6],
          ],
        ],
        [0, 1, 2, 3],
      )
    case 'survival':
      return make(
        one,
        [[[1, 0, 1, 1, null, null, null, null]], [[null, null, null, null, 1, 0, 0, 1]]],
        [2, 3, 5, 7, 3, 6, 8, 9],
      )
    case 'grouped':
    case 'contingency':
      return make(kind === 'contingency' ? one : reps(3), [
        [
          [4, 7],
          [5, 8],
          [3, 6],
        ],
        [
          [6, 9],
          [7, 10],
          [5, 8.5],
        ],
      ])
    case 'partsOfWhole':
      return make(one, [[[5, 3, 2]]])
    case 'multipleVariables':
      return make(one, [
        [[1, 2, 3, 4, 5, 6]],
        [[2, 3.5, 3, 5, 4.6, 6]],
        [[3, 1, 4, 2, 5, 3]],
        [[1, 4, 2, 5, 3, 6]],
      ])
    case 'nested':
      return make(reps(2), [
        [
          [3, 4, 3.5],
          [5, 5.6, 4.8],
        ],
        [
          [6, 6.8, 6.2],
          [7.4, 8, 7.1],
        ],
      ])
    default:
      return make(one, [[[3, 4.2, 3.6, 5]], [[6, 7.2, 5.8, 6.6]], [[4.4, 5, 4.1, 5.6]]])
  }
}

/**
 * Roadmap 34g: a dot plot's icon table — three number variables (`a`–`c`) by three groups of a
 * text variable (`g`), each group expressing a different variable most.
 */
function dotIconTable(): DataTable {
  const t = iconTable('multipleVariables')
  const g = t.dataSets[3]!
  g.id = 'g' as ColumnId
  g.title = 'g'
  g.text = ['x', 'x', 'y', 'y', 'z', 'z']
  const values = [
    [3, 2, 0, 0, 1, 0],
    [0, 1, 4, 3, 0, 0],
    [1, 0, 0, 1, 5, 4],
  ]
  values.forEach((v, i) => {
    t.dataSets[i]!.subcolumns[0]!.values = v
  })
  return t
}

/** Plot styles of dot plots (their icons group by the dot icon table's text variable). */
const DOT_STYLES = ['dotPlot', 'dotTiles']

/** The layers an icon draws for a style: the style's own, with what it needs to read as one. */
function iconLayers(id: string, kind: TableKind, table: DataTable, frame?: Frame) {
  const style = plotStyle(id)
  if (!style) return undefined
  if (style.frameChoice) return presetLayers(style.frameChoice, table)
  // Roadmap 34g: a dot plot's tiles under its dots; densities of points (hidden).
  if (id === 'dotTiles')
    return {
      frame: 'matrix' as const,
      layers: [
        { id: 'tiles', geom: 'tile', stat: { kind: 'dotplot' }, aes: { group: 'g' } },
        { id: 'dots', geom: 'points', stat: { kind: 'dotplot' }, aes: { group: 'g' } },
      ] as Layer[],
    }
  const on =
    frame && style.frames.includes(frame)
      ? frame
      : style.frames.includes('grouped') && (kind === 'grouped' || kind === 'contingency')
        ? 'grouped'
        : style.frames[0]!
  const own = styleLayer(style, on, kind)
  const mean = { kind: 'summary', center: 'mean' } as const
  const extra: Layer[] = []
  let layer: Layer = own
  if (id === 'labels') {
    // Labels on what they label: bars, slices, cells.
    const host: Layer =
      on === 'polar'
        ? { id: 'slices', geom: 'wedge', stat: { kind: 'fraction' } }
        : on === 'matrix'
          ? { id: 'cells', geom: 'tile', stat: { kind: 'cell' } }
          : kind === 'partsOfWhole'
            ? {
                id: 'segments',
                geom: 'bar',
                stat: { kind: 'fraction' },
                position: { kind: 'stack', percent: true },
              }
            : { id: 'bars', geom: 'bar', stat: mean }
    extra.push(host)
    layer = { ...own, on: host.id, style: { text: { size: 6 } } } as Layer
  } else if (id === 'rowTree' || id === 'columnTree') {
    // Roadmap 49c: a tree filling the icon (the plot), turned as it stands beside a heat map's
    // rows (across) or above its columns (upright).
    layer = { ...own, style: { side: id === 'rowTree' ? 'right' : 'top' } } as Layer
  } else if (id === 'pairs' || id === 'grandMean' || id === 'subjectMeans')
    extra.push({ id: 'points', geom: 'points', stat: { kind: 'identity' }, style: { size: 3 } })
  else if (id === 'center' || id === 'joinMeans')
    // An error layer drawing nothing: the means within the value axis.
    extra.push({ id: 'range', geom: 'errorbar', stat: { ...mean, error: 'none' } })
  else if (
    kind === 'multipleVariables' &&
    ['ellipses', 'hull', 'path', 'vectors', 'groupNames'].includes(id)
  ) {
    // Roadmap 34c: overlays, paths and vectors over a graph of variables' points; 34e: the
    // group's name at its centre.
    extra.push({
      id: 'bubbles',
      geom: 'points',
      stat: { kind: 'identity' },
      aes: { x: 'a', y: 'b' },
      style: { size: 3 },
    })
    if (id === 'vectors') layer = { ...own, aes: { xend: 'c', yend: 'd' } } as Layer
    if (id === 'groupNames') layer = { ...own, style: { text: { size: 6 } } } as Layer
  } else if (
    kind === 'multipleVariables' &&
    ['hexbin', 'contours', 'contourBands', 'densityImage'].includes(id)
  ) {
    // Roadmap 34g: densities of a graph of variables' points, the points hidden.
    extra.push({
      id: 'bubbles',
      geom: 'points',
      stat: { kind: 'identity' },
      aes: { x: 'a', y: 'b' },
      visible: false,
    })
    if (id === 'hexbin') layer = { ...own, stat: { kind: 'hexbin', bins: 4 } } as Layer
    else layer = { ...own, stat: { kind: 'density2d', n: 25, adjust: 1.5 } } as Layer
  } else if (id === 'ellipses' || id === 'hull' || id === 'path')
    extra.push({ id: 'points', geom: 'points', stat: { kind: 'identity' }, style: { size: 2 } })
  else if (id === 'groupLines')
    // Lines join the points of a graph of variables (the icon's table: one group).
    extra.push({
      id: 'bubbles',
      geom: 'points',
      stat: { kind: 'identity' },
      aes: { x: 'a', y: 'b' },
      style: { size: 3 },
    })
  return { frame: on, layers: [...extra, layer] }
}

/**
 * The table kind whose tiny table draws a style's icon for a graph of variables (roadmap 34a):
 * a column table's categories, a grouped table's groups, a contingency table's counts.
 */
export function iconKindFor(kind: MatrixKind, frame?: Frame): TableKind {
  if (kind === 'mvTextText') return 'contingency'
  if (kind === 'mvTextNumber' || kind === 'mvNumberText')
    return frame === 'grouped' ? 'grouped' : 'column'
  return kind
}

/** The kind of table an icon of a style draws, for a table kind (survival styles need one). */
function iconKind(id: string, kind: TableKind): TableKind {
  if (id === 'step' || id === 'censor') return 'survival'
  if (kind === 'survival' && id === 'band') return 'survival'
  return kind
}

/**
 * Icons per fonts, then style, table kind, frame and palette: the 512 used last kept (audit 2,
 * G16: every palette an icon was drawn in stayed). A builder shows a few dozen at a time.
 */
const cache = new WeakMap<FontRegistry, Lru<string, Scene | null>>()

/**
 * A plot style's icon for a table kind, laid out by the engine (no axes, legend or titles), in
 * `palette`; null when the style draws nothing for that kind.
 */
export function plotIcon(
  fonts: FontRegistry,
  id: string,
  tableKind: TableKind,
  opts: { frame?: Frame; palette?: readonly string[] } = {},
): Scene | null {
  const { frame, palette } = opts
  const key = `${id}\u0000${tableKind}\u0000${frame}\u0000${palette?.join() ?? ''}`
  let byKey = cache.get(fonts)
  if (!byKey) {
    byKey = new Lru(512)
    cache.set(fonts, byKey)
  }
  if (byKey.has(key)) return byKey.get(key)!
  const kind = iconKind(id, tableKind)
  const table = DOT_STYLES.includes(id) ? dotIconTable() : iconTable(kind)
  const spec = iconLayers(id, kind, table, frame)
  let scene: Scene | null = null
  if (spec) {
    const graph: GraphNode = {
      kind: 'graph',
      id: 'iconGraph' as NodeId,
      name: 'icon',
      frame: spec.frame,
      layers: spec.layers.map((l) =>
        l.geom === 'wedge' ? l : l.geom === 'points' && !l.style ? { ...l, style: { size: 4 } } : l,
      ) as Layer[],
      seriesSource: {
        table: table.id,
        include: spec.frame === 'polar' ? [table.dataSets[0]!.id] : 'all',
      },
      seriesOverrides: {},
      size: ICON_SIZE,
      axes: iconAxes(spec.frame, spec.layers),
      annotations: [],
      legend: { show: false, position: 'right' },
      title: null,
      style: { frame: 'none', ...(palette ? { palette: [...palette] } : {}) },
    }
    const project = createProject()
    project.nodes[table.id] = table
    project.order.push(table.id)
    scene = layoutGraph({ project, graph, fonts })
  }
  byKey.set(key, scene)
  return scene
}

/** An icon graph's axes: the frame's kind of axis, hidden, no titles or ticks. */
function iconAxes(frame: Frame, layers: readonly Layer[]): GraphNode['axes'] {
  const hidden = { show: false, title: null, tickStyle: { direction: 'none' as const } }
  const continuous = { ...defaultContinuousAxis(), ...hidden }
  const categorical = {
    type: 'categorical' as const,
    labels: 'dataSetTitles' as const,
    rotation: 0 as const,
    ...hidden,
  }
  const x = frame === 'xy' ? continuous : categorical
  const y = frame === 'matrix' ? categorical : continuous
  // An estimation plot's difference axis, hidden too.
  const y2 = layers.some((l) => l.geom === 'difference') ? { y2: continuous } : {}
  return { x, y, ...y2 } as GraphNode['axes']
}
