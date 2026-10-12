import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import { createTable, type DataTable, type GraphNode, type Layer, type NodeId } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { syntheticTable } from '../../model/test/synthetic.ts'
import { layoutGraph, presetGraph, type Scene, type SceneNode } from '../src/index.ts'
import { significance } from './cutoffCases.ts'
import { fonts, projectOf } from './helpers.ts'

// Audit 3, P1: a laid-out scene keeps only what it draws. Closures a scene stores (a cloud's
// `point`, the axes' `toPx` / `fromPx`) are made by small factories taking only what they read,
// so they don't hold the layout's whole working set — the project, its tables, the per-row
// looks and rows of the graph — through a context they share with the layout's other closures.

setFlagsFromString('--expose-gc')
const gc = runInNewContext('gc') as () => void

const key = (t: DataTable, title: string) => t.dataSets.find((d) => d.title === title)!.id

function umap(t: DataTable, front: Layer[] = []): GraphNode {
  const g = presetGraph(t, 'bubble')
  return {
    ...g,
    id: 'g1' as NodeId,
    layers: [
      ...g.layers.map((l) =>
        l.aes
          ? ({
              ...l,
              aes: { x: key(t, 'UMAP_1'), y: key(t, 'UMAP_2'), color: key(t, 'cluster') },
            } as Layer)
          : l,
      ),
      ...front,
    ],
  } as GraphNode
}

function xyTable(rows: number): DataTable {
  const t = createTable({ tableKind: 'xy', columns: 1, rows })
  t.x!.subcolumns[0]!.values = Array.from({ length: rows }, (_, i) => i)
  t.dataSets[0]!.subcolumns[0]!.values = Array.from({ length: rows }, (_, i) => (i * 7919) % 1000)
  return t
}

const isCloud = (n: SceneNode): boolean =>
  n.prim?.type === 'points' || (n.children ?? []).some(isCloud)

/**
 * Lays out a graph of a table made by `make` (held by nothing else) and keeps the scene: which
 * of the project, the table and a column's values are still reachable once collected (and that
 * the scene holds next to nothing of the heap besides). The heap measure is noisy on a shared
 * CI runner (once 54 and 57 bytes a point there, about 5 here), so it is taken up to three
 * times and the smallest counts: a scene that kept the layout's working set would hold 480 to
 * 790 bytes a point every time. The references are checked on every attempt.
 */
async function retained(make: () => DataTable, graphOf: (t: DataTable) => GraphNode) {
  const kept = new Set<string>()
  let best = Number.POSITIVE_INFINITY
  for (let attempt = 0; attempt < 3 && best >= 50; attempt++) {
    const m = await measure(make, graphOf)
    for (const k of m.kept) kept.add(k)
    best = Math.min(best, m.perPoint)
  }
  // About 5 bytes (was 480 to 790: the layout's rows, looks, project and caches).
  expect(best).toBeLessThan(50)
  return [...kept]
}

/** One layout of `retained`: what it keeps reachable, and the scene's heap per point. */
async function measure(make: () => DataTable, graphOf: (t: DataTable) => GraphNode) {
  const collect = async () => {
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, 0))
      gc()
    }
    return process.memoryUsage().heapUsed
  }
  // Once first, so the code it runs is compiled (and any lasting caches made) before measuring.
  {
    const t = make()
    const g = graphOf(t)
    layoutGraph({ project: projectOf(t, g), graph: g, fonts })
  }
  let t: DataTable | null = make()
  const g = graphOf(t)
  let project: ReturnType<typeof projectOf> | null = projectOf(t, g)
  let scene: Scene | null = layoutGraph({ project, graph: g, fonts })
  const refs = {
    project: new WeakRef(project),
    table: new WeakRef(t),
    values: new WeakRef(t.dataSets[0]!.subcolumns[0]!.values),
  }
  const rows = t.rowCount
  project = null
  t = null
  const withScene = await collect()
  const kept = Object.entries(refs)
    .filter(([, r]) => r.deref() !== undefined)
    .map(([k]) => k)
  expect(isCloud(scene.root)).toBe(true)
  // The scene is still in use (it draws, hits and maps points).
  expect(scene.axes!.x.fromPx(scene.plot.x)).toEqual(expect.any(Number))
  // The scene's own heap, per point drawn: what letting it go gives back (its typed arrays are
  // outside the heap). Measured as a difference with the scene and without it, so caches the
  // layout keeps (fonts, columns' categories) count on neither side.
  scene = null
  const perPoint = (withScene - (await collect())) / rows
  return { kept, perPoint }
}

describe('a laid-out scene (audit 3, P1)', () => {
  it('keeps no project, table or row of a bubble plot drawn as a cloud', async () => {
    const make = () => syntheticTable({ rows: 25_000, genes: 2, pcs: 2 })
    expect(await retained(make, (t) => umap(t))).toEqual([])
  })

  it('keeps none of a bubble plot with a Significance layer', async () => {
    const make = () => syntheticTable({ rows: 25_000, genes: 2, pcs: 2 })
    expect(await retained(make, (t) => umap(t, [significance()]))).toEqual([])
  })

  it('keeps none of an XY graph drawn as a cloud', async () => {
    expect(
      await retained(
        () => xyTable(25_000),
        (t) => ({ ...presetGraph(t, 'points'), id: 'g1' as NodeId }),
      ),
    ).toEqual([])
  })
})
