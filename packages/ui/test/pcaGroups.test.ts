import { registry } from '@ps/analyses'
import { DocumentStore } from '@ps/engine'
import {
  layoutGraph,
  missingEllipses,
  outputGraphsFor,
  outputsWithoutGraph,
  type Scene,
  type SceneNode,
  sceneToSvg,
} from '@ps/graph'
import { readProjectFile, writeProjectFile } from '@ps/io'
import {
  type AnalysisNode,
  type ColumnId,
  createProject,
  createTable,
  type DataSetKey,
  type DataTable,
  type GraphNode,
  type NodeId,
  normalizeDataSet,
  parseProject,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { startedEngine } from '../../engine/test/helpers.ts'
import { fonts } from '../../graph/test/helpers.ts'

// A PCA grouped by a text variable (roadmap 34c): its scores carried in a table with the group,
// the score plot coloured by group with an ellipse per group; live with the table and the
// grouping variable, through an edit of the analysis and a save and reopen.

/** Four measurements of 18 rows in three species, a second text variable (Site). */
function table(): DataTable {
  const t = createTable({ tableKind: 'multipleVariables', columns: 6, rows: 18 })
  t.id = 't1' as NodeId
  t.name = 'Flowers'
  const titles = ['Sepal', 'Petal', 'Width', 'Height', 'Species', 'Site']
  const species = ['setosa', 'versicolor', 'virginica']
  t.dataSets.forEach((d, i) => {
    d.id = String.fromCharCode(97 + i) as ColumnId
    d.title = titles[i]!
  })
  const wobble = (r: number, k: number) => (((r * 7 + k * 13) % 11) - 5) / 10
  for (const [i, d] of t.dataSets.slice(0, 4).entries())
    d.subcolumns[0]!.values = Array.from(
      { length: 18 },
      (_, r) => 5 + i + 2 * Math.floor(r / 6) * (i % 2 ? 1 : 0.5) + wobble(r, i),
    )
  t.dataSets[4]!.text = Array.from({ length: 18 }, (_, r) => species[Math.floor(r / 6)]!)
  t.dataSets[5]!.text = Array.from({ length: 18 }, (_, r) => (r % 2 ? 'North' : 'South'))
  return t
}

const keys = (t: DataTable) => t.dataSets.map((d) => d.id as DataSetKey)

async function setup(params: object = { groupBy: 'e', ellipses: true }) {
  const t = table()
  const def = registry.get('pca')!
  const parsed = def.params.parse(params)
  const pca: AnalysisNode = {
    kind: 'analysis',
    id: 'pca1' as NodeId,
    name: 'PCA',
    analysisId: 'pca',
    pluginVersion: def.version,
    input: { source: t.id, dataSets: keys(t) },
    params: parsed,
  }
  const store = new DocumentStore(createProject('P', new Date('2026-01-01T00:00:00Z')))
  store.dispatch({ type: 'node.add', node: t })
  store.dispatch({ type: 'node.add', node: pca })
  const graphs = outputGraphsFor(t, pca.id, def.outputs!(keys(t), parsed))
  for (const node of graphs) store.dispatch({ type: 'node.add', node })
  const engine = await startedEngine(store, registry)
  const result = (id: NodeId) => engine.latest(id)
  const scores = () =>
    store.getState().nodes[graphs.find((g) => g.name === 'PC scores')!.id] as GraphNode
  const scene = (g = scores()) =>
    layoutGraph({ project: store.getState(), graph: g, fonts, result })
  return { t, pca, store, engine, graphs, scores, scene, def, result }
}

const ids = (scene: Scene): string[] => {
  const out: string[] = []
  const walk = (n: SceneNode) => {
    out.push(n.id)
    for (const c of n.children ?? []) walk(c)
  }
  walk(scene.root)
  return out
}
const ellipses = (scene: Scene) => ids(scene).filter((i) => /\/ellipse\/\d+\/\d+$/.test(i))

describe('PCA grouped by a variable', () => {
  it('carries the groups in a table of scores; the PCA is that of the other variables', async () => {
    const { t, result, pca, def } = await setup()
    const r = result(pca.id)!
    expect(r.status).not.toBe('error')
    const scores = r.table!
    expect(scores.dataSets.map((d) => d.id)).toEqual(['pc1', 'pc2', 'group'])
    expect(scores.dataSets[2]!.title).toBe('Species')
    expect(scores.dataSets[2]!.text?.slice(0, 7)).toEqual([
      ...Array(6).fill('setosa'),
      'versicolor',
    ])
    // The same PCA as of the four measurements alone, unchanged without a group (no new
    // result: ANALYSES_VERSION stays).
    const plain = def.run(
      t.dataSets.slice(0, 4).map((d) => normalize(t, d.id)),
      def.params.parse({}),
    )
    expect(r.outputs.scores).toEqual(plain.outputs.scores)
    expect(r.sheets[0]).toEqual(plain.sheets[0])
    expect(plain.table).toBeUndefined()
    expect(scores.dataSets[0]!.subcolumns[0]!.values).toEqual(
      plain.outputs.scores!.x.map((v) => (Number.isFinite(v) ? v : null)),
    )
  })

  it('draws the score plot coloured by group with an ellipse per group', async () => {
    const { scene, scores } = await setup()
    const g = scores()
    expect(g.seriesSource.table).toBe('pca1')
    expect(g.layers.map((l) => l.geom)).toEqual(['polygon', 'points'])
    const s = scene()
    expect(ellipses(s).length).toBeGreaterThanOrEqual(3)
    expect(s.warnings).toEqual([])
  })

  it('follows edits of the table and of the grouping variable', async () => {
    const { store, engine, scene, t, pca } = await setup()
    const before = ellipses(scene()).length
    // A fourth species in the table: a fourth group and ellipse.
    store.dispatch({
      type: 'table.setText',
      table: t.id,
      edits: [12, 13, 14].map((row) => ({ col: 'e' as ColumnId, row, value: 'hybrid' })),
    })
    await engine.idle()
    expect(engine.latest(pca.id)!.table!.dataSets[2]!.text).toContain('hybrid')
    expect(ellipses(scene()).length).toBeGreaterThan(before)
    // Grouped by Site instead: two groups, the legend headed Site.
    store.dispatch({
      type: 'analysis.setParams',
      id: pca.id,
      params: {
        ...((store.getState().nodes[pca.id] as AnalysisNode).params as object),
        groupBy: 'f',
      },
    })
    await engine.idle()
    const table = engine.latest(pca.id)!.table!
    expect(table.dataSets[2]!.title).toBe('Site')
    expect(new Set(table.dataSets[2]!.text)).toEqual(new Set(['North', 'South']))
    expect(scene().warnings).toEqual([])
    store.undo()
    await engine.idle()
    expect(engine.latest(pca.id)!.table!.dataSets[2]!.title).toBe('Species')
  })

  it('keeps its graphs when edited; ellipses asked for later are added', async () => {
    const { store, def, pca, t, graphs: made } = await setup({ groupBy: 'e', biplot: true })
    expect(made.map((g) => g.name)).toEqual(['Scree plot', 'PC scores', 'Biplot'])
    const biplot = made[2]!
    // The biplot draws the scores table and the loading vectors over it.
    expect(biplot.seriesSource.table).toBe(pca.id)
    expect(biplot.layers.some((l) => l.data?.from === 'outputs')).toBe(true)
    const graphs = () =>
      Object.values(store.getState().nodes).filter((n): n is GraphNode => n.kind === 'graph')
    const decls = def.outputs!(keys(t), def.params.parse({ groupBy: 'e', biplot: true }))
    expect(outputsWithoutGraph(graphs(), pca.id, decls)).toEqual([])
    const withEllipses = def.outputs!(
      keys(t),
      def.params.parse({ groupBy: 'e', biplot: true, ellipses: true }),
    )
    const add = missingEllipses(graphs(), pca.id, withEllipses)
    expect(add.map((a) => a.graph.id)).toEqual(made.slice(1).map((g) => g.id))
    for (const a of add)
      store.dispatch({ type: 'graph.addLayer', id: a.graph.id, layer: a.layer, at: a.at })
    expect(missingEllipses(graphs(), pca.id, withEllipses)).toEqual([])
    // Ungrouped, the score plot is the outputs' graph as before.
    const plain = outputGraphsFor(t, pca.id, def.outputs!(keys(t), def.params.parse({})))
    expect(plain.map((g) => g.seriesSource)).toEqual([
      { table: t.id, include: [] },
      { table: t.id, include: [] },
    ])
  })

  it('survives a save and reopen', async () => {
    const { store, scores } = await setup()
    const back = readProjectFile(writeProjectFile(store.getState())).project
    expect(parseProject(JSON.parse(JSON.stringify(back)))).toBeTruthy()
    const graph = back.nodes[scores().id] as GraphNode
    expect(graph.layers).toEqual(scores().layers)
    const pca = back.nodes['pca1' as NodeId] as AnalysisNode
    expect(pca.params).toMatchObject({ groupBy: 'e', ellipses: true })
    const engine = await startedEngine(new DocumentStore(back), registry)
    const s = layoutGraph({ project: back, graph, fonts, result: (id) => engine.latest(id) })
    expect(ellipses(s).length).toBeGreaterThanOrEqual(3)
    // The legend names the groups.
    for (const name of ['setosa', 'versicolor', 'virginica']) expect(sceneToSvg(s)).toContain(name)
  })

  it('refuses a number variable as the group', async () => {
    const { result, pca } = await setup({ groupBy: 'a' })
    expect(result(pca.id)!.status).toBe('error')
  })
})

function normalize(t: DataTable, key: string) {
  return normalizeDataSet(t, t.dataSets.find((d) => d.id === key)!)
}
