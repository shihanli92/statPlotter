import { type GraphNode, type Layer, type LayerOf, treesAsLayers, v2to3 } from '@ps/model'
import { type HClust, hclust, rowDistances } from '@ps/stats'
import { describe, expect, it } from 'vitest'
import {
  checkLayers,
  DENDROGRAM_THEME,
  heatmapData,
  layerTitle,
  layoutGraph,
  newStyleLayer,
  plotStyle,
  presetGraph,
  type Scene,
  styleAllowed,
  styleContext,
  treeClusters,
  treeHeights,
  treeLines,
  treeOfLayer,
  treeStyle,
  withClustered,
  withStyleLayer,
  withTrees,
} from '../src/index.ts'
import { clusteredMap, genesTable, measuresTable, treeAlone } from './dendrogramCases.ts'
import { byId, flatten, fonts, nodes, prim, projectOf } from './helpers.ts'

// Roadmap 49c: dendrograms as layers — the tree's geometry (merge heights or equal steps, cuts
// coloured per cluster), its place beside a heat map (each side, depth, gap, strip), the tree's
// owner (the tiles' clustering or the layer's own), a cut's legend, a dendrogram alone in both
// orientations, the matrix's rules, plot styles and presets, and the v2 → v3 migration's edges.

const lay = (graph: GraphNode, table = genesTable()): Scene =>
  layoutGraph({ project: projectOf(table, graph), graph, fonts })

/** Every polyline point of a scene's nodes under a prefix (groups' children too). */
const points = (s: Scene, prefix: string) =>
  flatten(s.root)
    .filter((n) => n.id.startsWith(prefix) && n.prim?.type === 'polyline')
    .flatMap((n) => prim(n, 'polyline').points)
const xs = (ps: [number, number][]) => ps.map((p) => p[0])
const ys = (ps: [number, number][]) => ps.map((p) => p[1])

// Leaves 0 and 1 merge at 1, then leaf 2 joins at 3: drawn in order 2, 0, 1.
const SMALL: HClust = {
  merge: [
    [-1, -2],
    [-3, 1],
  ],
  height: [1, 3],
  order: [2, 0, 1],
}

describe('a tree’s geometry', () => {
  it('draws a ⊓ per merge, branches at their leaves’ slots or their middles (R’s plot.hclust)', () => {
    const lines = treeLines(SMALL, treeHeights(SMALL, 'merge'), null)
    expect(lines.map((l) => l.map((x) => x.points))).toEqual([
      [
        [
          [1, 0],
          [1, 1 / 3],
          [2, 1 / 3],
          [2, 0],
        ],
      ],
      [
        [
          [0, 0],
          [0, 1],
          [1.5, 1],
          [1.5, 1 / 3],
        ],
      ],
    ])
  })

  it('equal steps: each merge one above its higher branch', () => {
    // ((0, 1), (2, 3)) then 4: steps 1, 1, 2, 3.
    const hc: HClust = {
      merge: [
        [-1, -2],
        [-3, -4],
        [1, 2],
        [-5, 3],
      ],
      height: [0.1, 0.5, 4, 9],
      order: [4, 0, 1, 2, 3],
    }
    expect(treeHeights(hc, 'steps')).toEqual([1, 1, 2, 3])
    expect(treeHeights(hc, 'merge')).toEqual([0.1, 0.5, 4, 9])
  })

  it('a cut colours the branches below it; a merge above it splits into its branches and bar', () => {
    const c = treeClusters(SMALL, { k: 2 }, [])!
    // R's cutree: leaves 0 and 1 together (cluster 1), leaf 2 alone (cluster 2).
    expect(c.leaves).toEqual([1, 1, 2])
    expect(c.count).toBe(2)
    expect(c.merges).toEqual([1, 0])
    const lines = treeLines(SMALL, SMALL.height, c)
    expect(lines[0]!.map((l) => l.cluster)).toEqual([1])
    // Leaf 2's branch in cluster 2, the bar above the cut in the line's colour, the (0, 1)
    // cluster's branch in cluster 1.
    expect(lines[1]!.map((l) => l.cluster)).toEqual([2, 0, 1])
    expect(lines[1]!.map((l) => l.points.length)).toEqual([2, 2, 2])
    // By height: the same as R's k from h.
    expect(treeClusters(SMALL, { h: 2 }, [])!.leaves).toEqual([1, 1, 2])
    expect(treeClusters(SMALL, { h: 0.5 }, [])!.count).toBe(3)
    expect(treeClusters(SMALL, undefined, [])).toBeNull()
  })

  it('a k past the leaves cuts each apart, with a warning', () => {
    const warnings: string[] = []
    expect(treeClusters(SMALL, { k: 9 }, warnings)!.leaves).toEqual([1, 2, 3])
    expect(warnings).toEqual(['The tree has 3 leaves: cut into 3 clusters.'])
  })

  it('resolves its style over the theme’s defaults', () => {
    expect(treeStyle({}, { dendrogram: DENDROGRAM_THEME } as never)).toEqual({
      depth: 36,
      gap: 6,
      side: 'right',
      heights: 'merge',
      line: { color: { rgb: '#000000' }, width: 0.75, dash: 'solid' },
      colorBranches: true,
      strip: false,
      stripWidth: 8,
      clusterColors: {},
    })
  })
})

describe('trees beside a heat map', () => {
  it('stand right of and above the map by default, `depth` deep and `gap` from it', () => {
    const s = lay(clusteredMap(genesTable()))
    const { x, y, w, h } = s.plot
    const rows = points(s, 'dendrogram/rows/')
    const cols = points(s, 'dendrogram/columns/')
    expect(nodes(s, 'dendrogram/rows/')).toHaveLength(6)
    expect(nodes(s, 'dendrogram/columns/')).toHaveLength(4)
    expect(Math.min(...xs(rows))).toBeCloseTo(x + w + 6, 9)
    expect(Math.max(...xs(rows))).toBeCloseTo(x + w + 6 + 36, 9)
    expect(Math.max(...ys(cols))).toBeCloseTo(y - 6, 9)
    expect(Math.min(...ys(cols))).toBeCloseTo(y - 6 - 36, 9)
    // Leaves at the rows' middles.
    for (const v of ys(rows)) expect(v).toBeGreaterThan(y)
    for (const v of ys(rows)) expect(v).toBeLessThan(y + h)
    // The marks target their layer.
    expect(byId(s, 'dendrogram/rows/0')!.target).toEqual(['layers', 'rowTree'])
    expect(byId(s, 'dendrogram/rows/0')!.layer).toBe('rowTree')
  })

  it('stand left of and below the map, the names beyond them; depths and gaps of their own', () => {
    const t = genesTable()
    const s = lay(
      clusteredMap(
        t,
        { style: { side: 'left', depth: 50, gap: 10 } },
        { style: { side: 'bottom', depth: 20, gap: 0 } },
      ),
      t,
    )
    const { x, y, h } = s.plot
    const rows = points(s, 'dendrogram/rows/')
    const cols = points(s, 'dendrogram/columns/')
    expect(Math.max(...xs(rows))).toBeCloseTo(x - 10, 9)
    expect(Math.min(...xs(rows))).toBeCloseTo(x - 60, 9)
    expect(Math.min(...ys(cols))).toBeCloseTo(y + h, 9)
    expect(Math.max(...ys(cols))).toBeCloseTo(y + h + 20, 9)
    // The row names left of the tree, the column names below it.
    const rowName = byId(s, 'axis/y/tickLabel/0')!.bbox!
    expect(rowName.x + rowName.w).toBeLessThan(x - 60)
    const colName = byId(s, 'axis/x/tickLabel/0')!.bbox!
    expect(colName.y).toBeGreaterThan(y + h + 20)
  })

  it('a strip of each leaf’s cluster between tree and map, the tree beyond it', () => {
    const t = genesTable()
    const s = lay(
      clusteredMap(t, {
        stat: { kind: 'cluster', of: 'rows', cut: { k: 3 } },
        style: { strip: true },
      }),
      t,
    )
    const { x, w } = s.plot
    const strip = nodes(s, 'dendrogram/rows/strip/').map((n) => prim(n, 'rect'))
    expect(strip).toHaveLength(7)
    expect(strip[0]!.x).toBeCloseTo(x + w + 6, 9)
    expect(strip[0]!.w).toBe(8)
    expect(new Set(strip.map((r) => r.fill!.color)).size).toBe(3)
    expect(Math.min(...xs(points(s, 'dendrogram/rows/')))).toBeCloseTo(x + w + 6 + 8 + 2, 9)
    // Each strip band is its leaf's cluster colour, the colour of the leaf's branch.
    const leafStroke = flatten(s.root).filter(
      (n) => n.id.startsWith('dendrogram/rows/') && n.prim?.type === 'polyline',
    )
    expect(leafStroke.length).toBeGreaterThan(6)
  })

  it('the cells follow a tree layer clustering an axis the tiles don’t', () => {
    const t = genesTable()
    const map = presetGraph(t, 'heatmap')
    const order = (g: GraphNode) =>
      nodes(lay(g, t), 'axis/y/tickLabel/').map((n) =>
        prim(n, 'text')
          .layout.runs.map((r) => r.text)
          .join(''),
      )
    const plain = order(map)
    const tree: Layer = { id: 'rowTree', geom: 'dendrogram', stat: { kind: 'cluster', of: 'rows' } }
    const own = order({ ...map, layers: [...map.layers, tree] })
    const tiles = order(withClusteredMap(map, tree))
    expect(own).not.toEqual(plain)
    // The same tree (Euclidean, complete) either way: the same order.
    expect(own).toEqual(tiles)
  })

  it('a hidden tree draws nothing; the tiles’ order stays', () => {
    const t = genesTable()
    const g = clusteredMap(t, { visible: false })
    const s = lay(g, t)
    expect(nodes(s, 'dendrogram/rows/')).toHaveLength(0)
    expect(nodes(s, 'dendrogram/columns/').length).toBeGreaterThan(0)
  })

  it('puts a cut tree’s clusters in the legend, unless the layer’s entry is hidden', () => {
    const t = genesTable()
    const cut = { stat: { kind: 'cluster', of: 'rows', cut: { k: 3 } } } as const
    const shown = { legend: { show: true, position: 'right' } } as const
    const s = lay(clusteredMap(t, cut, {}, shown), t)
    expect((s.legend ?? []).map((e) => [e.key, e.label])).toEqual([
      ['@rowTree/1', 'Cluster 1'],
      ['@rowTree/2', 'Cluster 2'],
      ['@rowTree/3', 'Cluster 3'],
    ])
    // The legend stands beyond the trees and the colour scale.
    const legend = byId(s, 'legend')!
    const scaleRight = Math.max(
      ...flatten(s.root)
        .filter((n) => n.id.startsWith('colorScale/') && n.bbox)
        .map((n) => n.bbox!.x + n.bbox!.w),
    )
    expect(flatten(legend).find((n) => n.bbox)!.bbox!.x).toBeGreaterThan(scaleRight)
    const hidden = lay(clusteredMap(t, { ...cut, legend: 'hide' }, {}, shown), t)
    expect(hidden.legend ?? []).toEqual([])
  })

  it('treeOfLayer gives the tree the frame draws (the tiles’ on z-scores)', () => {
    const t = genesTable()
    const g = clusteredMap(t)
    const z = {
      ...g,
      layers: g.layers.map((l) =>
        l.geom === 'tile' ? ({ ...l, stat: { kind: 'cell', standardize: 'row' } } as Layer) : l,
      ),
    }
    const project = projectOf(t, z)
    const rowTree = z.layers.find((l) => l.id === 'rowTree') as LayerOf<'dendrogram'>
    const hc = treeOfLayer(project, z, rowTree)!
    const s = lay(z, t)
    const labels = nodes(s, 'axis/y/tickLabel/').map((n) =>
      prim(n, 'text')
        .layout.runs.map((r) => r.text)
        .join(''),
    )
    const data = heatmapData(project, z)
    expect(labels).toEqual(hc.order.map((i) => t.rowTitles![data.rows[i]!]))
  })
})

/** The heat map with its tiles clustering the rows and a tree of them. */
const withClusteredMap = (map: GraphNode, tree: Layer): GraphNode => ({
  ...map,
  layers: withClustered([...map.layers, tree], 'rows'),
})

describe('a dendrogram alone', () => {
  it('fills the plot over its leaves along the bottom, the heights up the left', () => {
    const t = genesTable()
    const s = lay(treeAlone(t), t)
    const { x, y, w, h } = s.plot
    const ps = points(s, 'dendrogram/rows/')
    expect(Math.max(...ys(ps))).toBeCloseTo(y + h, 6)
    expect(Math.min(...xs(ps))).toBeGreaterThan(x)
    expect(Math.max(...xs(ps))).toBeLessThan(x + w)
    expect(nodes(s, 'axis/x/tickLabel/')).toHaveLength(7)
    expect(nodes(s, 'axis/y/tickLabel/').length).toBeGreaterThan(1)
    expect(s.warnings).toEqual([])
    // R's tree of the rows (Euclidean, complete): its top merge's height on the axis.
    const values = t.dataSets.map((d) => d.subcolumns[0]!.values as number[])
    const rows = values[0]!.map((_, i) => values.map((v) => v[i]!))
    const hc = hclust(rowDistances(rows, 'euclidean'), rows.length, 'complete')
    const top = Math.max(...hc.height)
    const axis = s.axes!.y
    expect(Math.min(...ys(ps))).toBeCloseTo(axis.toPx(top), 6)
  })

  it('beside its leaves down the left; equal steps fill the plot without a heights axis', () => {
    const t = measuresTable()
    const g = treeAlone(t, { style: { side: 'right', heights: 'steps' } })
    const s = lay({ ...g, axes: { x: g.axes.y, y: g.axes.x } }, t)
    const { x, w } = s.plot
    const ps = points(s, 'dendrogram/rows/')
    expect(Math.min(...xs(ps))).toBeCloseTo(x, 6)
    expect(Math.max(...xs(ps))).toBeCloseTo(x + w, 6)
    expect(nodes(s, 'axis/y/tickLabel/')).toHaveLength(8)
    expect(nodes(s, 'axis/x/tickLabel/')).toHaveLength(0)
  })

  it('a tree of the columns: the data sets as leaves', () => {
    const t = measuresTable()
    const s = lay(treeAlone(t, { stat: { kind: 'cluster', of: 'columns' } }), t)
    expect(nodes(s, 'dendrogram/columns/')).toHaveLength(3)
    expect(nodes(s, 'axis/x/tickLabel/')).toHaveLength(4)
  })
})

describe('the matrix, plot styles and presets', () => {
  const tree = (of: 'rows' | 'columns', id = `${of}Tree`): Layer => ({
    id,
    geom: 'dendrogram',
    stat: { kind: 'cluster', of },
  })
  const cells: Layer = { id: 'cells', geom: 'tile', stat: { kind: 'cell' } }

  it('allows a tree of the rows and one of the columns beside tiles; one tree alone', () => {
    const ok = (layers: Layer[]) =>
      [...checkLayers({ frame: 'matrix', layers }, 'grouped').values()].map((a) => a.allowed)
    expect(ok([cells, tree('rows'), tree('columns')])).toEqual([true, true, true])
    expect(ok([cells, tree('rows'), tree('rows', 'two')])).toEqual([true, true, false])
    expect(ok([tree('rows')])).toEqual([true])
    expect(ok([tree('rows'), tree('columns')])).toEqual([true, false])
    const xy = checkLayers({ frame: 'xy', layers: [tree('rows')] }, 'xy')
    expect(xy.get('rowsTree')!.allowed).toBe(false)
    expect(
      checkLayers({ frame: 'grouped', layers: [tree('rows')] }, 'grouped').get('rowsTree')!.reason,
    ).toMatch(/dendrograms are of heat maps/)
  })

  it('names trees by what they are of', () => {
    expect(layerTitle(tree('rows'), 'matrix')).toBe('Row dendrogram')
    expect(layerTitle(tree('columns'), 'matrix')).toBe('Column dendrogram')
    expect(layerTitle({ ...tree('rows'), name: 'Genes' } as Layer, 'matrix')).toBe('Genes')
  })

  it('a tree added to a heat map makes its tiles cluster that axis; one per axis', () => {
    const t = genesTable()
    const map = presetGraph(t, 'heatmap')
    const c = styleContext(t, 'matrix', map.layers)
    const style = plotStyle('rowTree')!
    expect(styleAllowed(style, c)).toEqual({ allowed: true })
    const layers = withStyleLayer(c, newStyleLayer(style, c))
    expect(layers.map((l) => l.id)).toEqual(['cells', 'rowTree'])
    expect(layers[0]!.style).toEqual({ cluster: { rows: true } })
    const again = styleContext(t, 'matrix', layers)
    expect(styleAllowed(style, again)).toEqual({
      allowed: false,
      reason: 'the graph has a tree of the rows',
    })
    expect(styleAllowed(plotStyle('columnTree')!, again).allowed).toBe(true)
    // A dendrogram alone: one tree, no cells to label.
    const alone = treeAlone(t)
    const a = styleContext(t, 'matrix', alone.layers)
    expect(styleAllowed(plotStyle('columnTree')!, a).reason).toBe('one tree without a heat map')
    expect(styleAllowed(plotStyle('labels')!, a).reason).toBe('values label the cells')
  })

  it('withTrees adds a tree for each axis the drawn tiles cluster, once', () => {
    const t = genesTable()
    const map = presetGraph(t, 'heatmap')
    expect(withTrees(map.layers)).toEqual(map.layers)
    const both = map.layers.map((l) =>
      l.geom === 'tile'
        ? ({ ...l, style: { cluster: { rows: true, columns: true } } } as Layer)
        : l,
    )
    const out = withTrees(both)
    expect(out.map((l) => l.id)).toEqual(['cells', 'rowTree', 'columnTree'])
    expect(withTrees(out)).toEqual(out)
  })

  it('the dendrogram preset: a tree of the rows over its leaves, for heat maps’ tables', () => {
    const g = presetGraph(genesTable(), 'dendrogram')
    expect(g.frame).toBe('matrix')
    expect(g.layers).toEqual([
      {
        id: 'rowTree',
        geom: 'dendrogram',
        stat: { kind: 'cluster', of: 'rows' },
        style: { side: 'top' },
      },
    ])
    expect(g.axes.y).toMatchObject({ type: 'continuous', title: { content: [{ text: 'Height' }] } })
    expect(g.legend.show).toBe(false)
  })
})

describe('the v2 → v3 migration', () => {
  const tile = (style: Record<string, unknown>, more: Record<string, unknown> = {}) => ({
    id: 'cells',
    geom: 'tile',
    stat: { kind: 'cell' },
    style,
    ...more,
  })

  it('names the trees apart from layers already there; leaves other frames’ tiles bare', () => {
    const out = treesAsLayers(
      [tile({ cluster: { rows: true, columns: true } }), { id: 'rowTree' }],
      'matrix',
    )
    expect((out as { id: string }[]).map((l) => l.id)).toEqual([
      'cells',
      'rowTree',
      'rowTree2',
      'columnTree',
    ])
    expect(treesAsLayers([tile({ cluster: { dendrogram: 20 } })], 'grouped')).toEqual([
      { id: 'cells', geom: 'tile', stat: { kind: 'cell' } },
    ])
    expect(
      treesAsLayers([tile({ missing: '#ffffff', cluster: { dendrogram: 20 } })], 'matrix'),
    ).toEqual([
      { id: 'cells', geom: 'tile', stat: { kind: 'cell' }, style: { missing: '#ffffff' } },
    ])
  })

  it('adds no layer past 32', () => {
    const many = Array.from({ length: 31 }, (_, i) => ({ id: `l${i}`, geom: 'label' }))
    const out = treesAsLayers([tile({ cluster: { rows: true, columns: true } }), ...many], 'matrix')
    expect(out).toHaveLength(32)
    expect((out.at(-1) as { id: string }).id).toBe('l30')
  })

  it('migrates a project’s graphs only, other nodes as they are', () => {
    const raw = {
      schemaVersion: 2,
      nodes: {
        t1: { kind: 'table', id: 't1' },
        g1: {
          kind: 'graph',
          id: 'g1',
          frame: 'matrix',
          layers: [tile({ cluster: { rows: true } })],
        },
      },
    }
    const out = v2to3(raw) as { nodes: Record<string, { layers?: unknown[] }> }
    expect(out.nodes.t1).toBe(raw.nodes.t1)
    expect(out.nodes.g1!.layers).toHaveLength(2)
    expect(raw.nodes.g1.layers).toHaveLength(1)
  })
})
