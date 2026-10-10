import { registry } from '@ps/analyses'
import {
  AssetStore,
  applyToTables,
  convertTable,
  createMethod,
  DocumentStore,
  duplicateFamily,
  readMethod,
  writeMethod,
} from '@ps/engine'
import { bracketsFromAnalysis, createGraphFor, withOutputSeries } from '@ps/graph'
import { readImageAsset, readProjectFile } from '@ps/io'
import {
  type AnalysisNode,
  type AnalysisResult,
  createProject,
  type DataSetKey,
  type DataTable,
  type GraphNode,
  graphOutputs,
  type LayoutNode,
  type NodeId,
  newLayoutItemId,
  newNodeId,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { startedEngine } from '../../engine/test/helpers.ts'
import { fixtureBytes } from '../../graph/test/images.ts'
import { templateBytes } from '../src/reuse/TemplateDialogs.tsx'
import { sampleTable } from '../src/samples.ts'

// Reusing analyses with the real plugins (roadmap 31): copies compute what analysing the copied
// data gives, applied analyses what analysing the target directly gives.

function analysis(
  name: string,
  analysisId: string,
  source: NodeId,
  dataSets: string[],
  params = {},
) {
  const def = registry.get(analysisId)!
  return {
    kind: 'analysis',
    id: newNodeId(),
    name,
    analysisId,
    pluginVersion: def.version,
    input: { source, dataSets },
    params: def.params.parse(params),
  } satisfies AnalysisNode
}

const createLayoutNode = (name: string, items: LayoutNode['items']): LayoutNode => ({
  kind: 'layout',
  id: newNodeId(),
  name,
  page: { width: 612, height: 792 },
  items,
  panelLabels: { show: true, style: 'A', size: 14 },
})

/** A result with node ids and a plugin's own table id taken out (they differ between copies). */
const comparable = (r: AnalysisResult | undefined, ids: ReadonlyMap<string, string>) =>
  JSON.parse(
    JSON.stringify(r, (k, v) =>
      k === 'id' && typeof v === 'string' ? '' : typeof v === 'string' ? (ids.get(v) ?? v) : v,
    ),
  )

/**
 * Dose-response curves (XY, triplicates) with a fit, curves on the graph, a normalized table and
 * a fit of that; and a column table with a t test, brackets and a log transform.
 */
async function project() {
  const store = new DocumentStore(createProject('Reuse', new Date('2026-10-01T00:00:00Z')))
  const xy = sampleTable('xy', 'Plate 1')
  const keys = xy.dataSets.map((d) => d.id as DataSetKey)
  const fit = analysis('Fit of Plate 1', 'nonlinearFit', xy.id, keys)
  const norm = analysis('Normalize of Plate 1', 'normalize', xy.id, keys)
  const fitNorm = analysis('Fit of Normalize of Plate 1', 'nonlinearFit', norm.id, keys)
  const graph = withOutputSeries(
    createGraphFor(xy, 'Plate 1'),
    fit.id,
    registry.get('nonlinearFit')!.outputs!(keys, fit.params),
  ).graph
  const col = sampleTable('column', 'Weights 1')
  const ckeys = col.dataSets.map((d) => d.id as DataSetKey)
  const t = analysis('t test of Weights 1', 'ttest', col.id, ckeys)
  const log = analysis('Log of Weights 1', 'transform', col.id, ckeys, { y: 'log10' })
  const colGraph = createGraphFor(col, 'Weights 1')
  store.dispatch(
    [xy, fit, norm, fitNorm, graph, col, t, log, colGraph].map((node) => ({
      type: 'node.add',
      node,
    })),
  )
  const engine = await startedEngine(store, registry)
  // Brackets from the t test's comparisons.
  store.dispatch({
    type: 'node.set',
    id: colGraph.id,
    path: ['annotations'],
    value: bracketsFromAnalysis(
      colGraph,
      t.id,
      engine.latest(t.id)!,
      'stars',
      Number.POSITIVE_INFINITY,
    ),
  })
  return { store, engine, xy, fit, norm, fitNorm, graph, col, t, log, colGraph }
}

describe('reusing analyses with the real plugins', () => {
  it('duplicates a family whose copies compute as the originals', async () => {
    const p = await project()
    const plan = duplicateFamily(p.store.getState(), p.xy.id, {
      find: 'Plate 1',
      replace: 'Plate 2',
      layouts: 'whole',
    })
    p.store.dispatch(plan.commands, 'Duplicate family')
    await p.engine.idle()
    const back = new Map([...plan.ids].map(([a, b]) => [b as string, a as string]))
    for (const id of [p.fit.id, p.norm.id, p.fitNorm.id]) {
      expect(p.engine.get(id)?.status).toBe('ready')
      expect(comparable(p.engine.latest(plan.ids.get(id)!), back)).toEqual(
        comparable(p.engine.latest(id), back),
      )
    }
    const g = p.store.getState().nodes[plan.ids.get(p.graph.id)!] as GraphNode
    const outputs = graphOutputs(g)
    expect(outputs.length).toBeGreaterThan(0)
    expect(outputs.map((o) => o.series.ref.node)).toEqual(outputs.map(() => plan.ids.get(p.fit.id)))
  })

  it('applies analyses and graphs to a table as if it had been analysed directly', async () => {
    const p = await project()
    // Another column table with other numbers, its data sets in the other order (by title).
    const other = sampleTable('column', 'Weights 2')
    other.dataSets.reverse()
    other.dataSets.forEach((d, i) => {
      d.subcolumns[0]!.values = d.subcolumns[0]!.values.map((v) => (v === null ? null : v + i * 3))
    })
    p.store.dispatch({ type: 'node.add', node: other })
    const doc = p.store.getState()
    const plan = applyToTables(doc, p.col.id, doc, [other.id], {
      match: 'title',
      layouts: false,
      find: 'Weights 1',
    })
    expect(plan.warnings).toEqual([])
    p.store.dispatch(plan.commands)
    const direct = analysis('direct', 'ttest', other.id, [
      other.dataSets[1]!.id,
      other.dataSets[0]!.id,
    ])
    p.store.dispatch({ type: 'node.add', node: direct })
    await p.engine.idle()
    const made = plan.created[0]!.nodes.map((id) => p.store.getState().nodes[id]!)
    const t = made.find((n) => n.name === 't test of Weights 2')!
    expect(p.engine.latest(t.id)?.values).toEqual(p.engine.latest(direct.id)?.values)
    // The graph's brackets name the new t test's comparisons, which it has.
    const g = made.find((n) => n.kind === 'graph') as GraphNode
    const keys = new Set(p.engine.latest(t.id)!.comparisons.map((c) => c.key))
    const brackets = g.annotations.filter((a) => a.type === 'bracket')
    expect(brackets.length).toBeGreaterThan(0)
    for (const b of brackets)
      expect(b.label.source === 'analysis' && keys.has(b.label.comparison)).toBe(true)
  })

  it('saves a method and applies it in another project', async () => {
    const p = await project()
    const m = readMethod(
      writeMethod(createMethod(p.store.getState(), p.xy.id, { name: 'Dose', layouts: true })),
    )
    const store = new DocumentStore(createProject())
    const plate = sampleTable('xy', 'Plate 9')
    store.dispatch({ type: 'node.add', node: plate })
    const engine = await startedEngine(store, registry)
    const plan = applyToTables(m.project, m.table, store.getState(), [plate.id], {
      match: 'position',
      layouts: true,
      find: 'Plate 1',
    })
    store.dispatch(plan.commands)
    await engine.idle()
    const fit = plan.created[0]!.nodes.map((id) => store.getState().nodes[id]!).find(
      (n) => n.name === 'Fit of Plate 9',
    )!
    // The same data as Plate 1, so the same fit (values keyed by the data sets' ids).
    const rekey = (v: object | undefined, from: DataTable, to: DataTable) => {
      let text = JSON.stringify(v)
      from.dataSets.forEach((d, i) => {
        text = text.replaceAll(d.id, to.dataSets[i]!.id)
      })
      return JSON.parse(text)
    }
    expect(rekey(engine.latest(fit.id)?.values, plate, p.xy)).toEqual(
      p.engine.latest(p.fit.id)?.values,
    )
  })

  it('keeps a template without values, marked as one, with its pages’ images', async () => {
    const p = await project()
    // A page with an image (roadmap 32), and another image no page places.
    const png = readImageAsset(fixtureBytes('rgba.png'))
    const jpeg = readImageAsset(fixtureBytes('photo.jpg'))
    const assets = new AssetStore()
    assets.add(png)
    assets.add(jpeg)
    const page = createLayoutNode('Figure', [
      { type: 'image', id: newLayoutItemId(), asset: png.id, x: 0, y: 0, w: 50, h: 50 },
    ])
    p.store.dispatch({ type: 'node.add', node: page })
    const {
      project: tpl,
      template,
      results,
      assets: images,
    } = readProjectFile(templateBytes(p.store.getState(), assets))
    expect(template).toBe(true)
    expect(results.size).toBe(0)
    expect([...images.keys()]).toEqual([png.id])
    expect(images.get(png.id)?.bytes).toEqual(png.bytes)
    const tables = Object.values(tpl.nodes).filter((n): n is DataTable => n.kind === 'table')
    expect(tables.map((t) => t.name).sort()).toEqual(['Plate 1', 'Weights 1'])
    for (const t of tables)
      expect(
        t.dataSets.every((d) => d.subcolumns.every((c) => c.values.every((v) => v === null))),
      ).toBe(true)
    expect(tpl.order).toEqual(p.store.getState().order)
  })

  it('gives the same t test from replicates and from the mean, SD and N computed from them', async () => {
    const col = sampleTable('column', 'W')
    const store = new DocumentStore(createProject())
    const keys = col.dataSets.map((d) => d.id as string)
    const raw = analysis('raw', 'ttest', col.id, keys)
    store.dispatch([col, raw].map((node) => ({ type: 'node.add' as const, node })))
    const engine = await startedEngine(store, registry)
    const before = engine.latest(raw.id)!
    expect(convertTable(col, { type: 'summary', preset: 'meanSdN' }).rowCount).toBe(1)
    store.dispatch({
      type: 'table.setYFormat',
      table: col.id,
      format: { type: 'summary', preset: 'meanSdN' },
    })
    await engine.idle()
    const after = engine.latest(raw.id)!
    expect(after.status).toBe('ok')
    expect((after.values.t as { v: number }).v).toBeCloseTo(
      (before.values.t as { v: number }).v,
      12,
    )
    expect((after.values.p as { v: number }).v).toBeCloseTo(
      (before.values.p as { v: number }).v,
      12,
    )
  })
})
