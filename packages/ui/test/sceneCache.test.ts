import { registry } from '@ps/analyses'
import { DocumentStore } from '@ps/engine'
import { type GraphContext, layoutGraph, layoutPage, SCREEN_SAMPLE, type Scene } from '@ps/graph'
import type { AnalysisResult, FolderId, GraphNode, LayoutNode, NodeId, Project } from '@ps/model'
import { createProject } from '@ps/model'
import { describe, expect, it, vi } from 'vitest'
import { startedEngine } from '../../engine/test/helpers.ts'
import { fonts } from '../../graph/test/helpers.ts'
import { SYNTHETIC_EXAMPLES } from '../src/examples/synthetic/index.ts'
import { createSceneCache, releaseOnReset } from '../src/graph/sceneCache.ts'
import { moveItem } from '../src/layout/items.ts'
import { builtExample } from './exampleBuilds.ts'

// Audit 2, P3 and P15: layouts per drag and per edit, counted. A page laid out again (each
// pointer move of a drag) lays out no graph unless one changed; an edit lays out only the graphs
// whose layout read what it changed; a new result of an analysis a graph doesn't read lays out
// nothing. Every scene the cache gives is the one a fresh layout makes.

vi.mock('../../model/src/ids.ts', async (importOriginal) =>
  (await import('./countedIds.ts')).countedIds(await importOriginal(), { always: false }),
)

const graphsOf = (p: Project) =>
  Object.values(p.nodes).filter((n): n is GraphNode => n.kind === 'graph')
const graphItems = (page: LayoutNode) => page.items.filter((i) => i.type === 'graph')
const pagesOf = (p: Project) =>
  Object.values(p.nodes).filter(
    (n): n is LayoutNode => n.kind === 'layout' && graphItems(n).length > 1,
  )

/** An example's project in a store, its analyses computed. */
async function started(id: string) {
  const example = SYNTHETIC_EXAMPLES.find((e) => e.id === id)!
  const project = (await builtExample(example))!
  const store = new DocumentStore(project)
  const engine = await startedEngine(store, registry)
  return { store, engine, lookup: (a: NodeId) => engine.latest(a) }
}

/** A scene's data (its axes' mapping functions left out: made anew by each layout). */
const plain = (s: Scene) => JSON.parse(JSON.stringify(s))

/** The page's items with the first moved by (d, d), as a drag's pointer move shows them. */
const dragged = (page: LayoutNode, d: number): LayoutNode => ({
  ...page,
  items: page.items.map((it, j) => (j === 0 ? moveItem(it, d, d) : it)),
})

describe('scene cache (audit 2, P3)', () => {
  it('lays out no graph when a page is drawn again or an item dragged', async () => {
    let pages = 0
    for (const ex of SYNTHETIC_EXAMPLES) {
      const { store, engine, lookup } = await started(ex.id)
      engine.stop()
      const doc = store.getState()
      for (const page of pagesOf(doc)) {
        pages++
        const n = graphItems(page).length
        const at = (layout: LayoutNode, graphScene?: (ctx: GraphContext) => Scene) =>
          layoutPage({
            project: doc,
            layout,
            fonts,
            result: lookup,
            screen: SCREEN_SAMPLE,
            ...(graphScene ? { graphScene } : {}),
          })
        const moves = 10
        const cache = createSceneCache()

        // Before: the page asks for every graph's scene on every pointer move, each a layout
        // (counted here as asked; laid out through the cache to keep the test quick).
        let asked = 0
        const counted = (ctx: GraphContext) => {
          asked++
          return cache.layout(ctx)
        }
        for (let i = 1; i <= moves; i++) at(dragged(page, i), counted)
        expect(asked).toBe(moves * n)

        // After: each graph laid out once, then none for the whole drag.
        cache.clear()
        const before0 = cache.layouts
        const first = at(page, cache.layout)
        expect(cache.layouts - before0).toBe(n)
        for (let i = 1; i <= moves; i++) {
          const s = at(dragged(page, i), cache.layout)
          if (i === moves) expect(plain(s)).toEqual(plain(at(dragged(page, i))))
        }
        expect(cache.layouts - before0).toBe(n)
        // The very same graph scenes: what draws them can skip them too.
        const graphRoots = (s: Scene) =>
          s.root.children
            ?.filter((c) => graphItems(page).some((i) => c.id === `item/${i.id}`))
            .map((c) => c.children?.[0])
        const again = graphRoots(at(page, cache.layout)) ?? []
        const before = graphRoots(first) ?? []
        expect(again).toHaveLength(n)
        for (const [i, r] of again.entries()) expect(r).toBe(before[i])
        expect(cache.layouts - before0).toBe(n)
      }
    }
    expect(pages).toBeGreaterThan(5)
  }, 120_000)

  it('lays out only the graphs an edit or a new result changes', async () => {
    const { store, engine, lookup } = await started('curve-fitting')
    engine.stop()
    const cache = createSceneCache()
    const layoutAll = (result: (id: NodeId) => AnalysisResult | undefined = lookup) => {
      const doc = store.getState()
      const before = cache.layouts
      for (const graph of graphsOf(doc))
        cache.layout({ project: doc, graph, fonts, result, screen: SCREEN_SAMPLE })
      return cache.layouts - before
    }
    const all = graphsOf(store.getState()).length
    expect(layoutAll()).toBe(all)
    expect(layoutAll()).toBe(0)

    // An edit no graph reads (a new, empty folder in the navigator): none.
    store.dispatch({ type: 'folder.add', folder: { id: 'unread' as FolderId, name: 'Unread' } })
    expect(layoutAll()).toBe(0)

    // One graph renamed: that graph.
    const g = graphsOf(store.getState())[0]!
    store.dispatch({ type: 'node.rename', id: g.id, name: `${g.name} (renamed)` })
    expect(layoutAll()).toBe(1)

    // A table's rows reversed: the graphs of it (and of what its analyses give), not all.
    const doc = store.getState()
    const table = Object.values(doc.nodes).find(
      (n) => n.kind === 'table' && graphsOf(doc).some((gr) => gr.seriesSource.table === n.id),
    )!
    const readers = graphsOf(doc).filter((gr) => gr.seriesSource.table === table.id).length
    const rows = table.kind === 'table' ? table.rowCount : 0
    store.dispatch({
      type: 'table.permuteRows',
      table: table.id,
      order: Array.from({ length: rows }, (_, i) => rows - 1 - i),
    })
    expect(layoutAll()).toBe(readers)

    // P15: a new result (a new object) of an analysis no graph reads lays out nothing; of one a
    // graph reads, the graphs reading it.
    const readBy = new Map<NodeId, Set<NodeId>>()
    for (const graph of graphsOf(store.getState())) {
      layoutGraph({
        project: store.getState(),
        graph,
        fonts,
        result: (id) => {
          readBy.set(id, (readBy.get(id) ?? new Set()).add(graph.id))
          return lookup(id)
        },
        screen: SCREEN_SAMPLE,
      })
    }
    const analyses = Object.values(store.getState().nodes).filter((n) => n.kind === 'analysis')
    const unread = analyses.filter((a) => !readBy.has(a.id))
    const read = analyses.find((a) => readBy.has(a.id))!
    expect(unread.length).toBeGreaterThan(0)
    const renewed =
      (ids: Set<NodeId>) =>
      (id: NodeId): AnalysisResult | undefined => {
        const r = lookup(id)
        return r && ids.has(id) ? { ...r } : r
      }
    expect(layoutAll(renewed(new Set(unread.map((a) => a.id))))).toBe(0)
    expect(layoutAll(renewed(new Set([read.id])))).toBe(readBy.get(read.id)!.size)
  })

  it('gives the scene a fresh layout makes, after every kind of edit', async () => {
    let checked = 0
    for (const ex of SYNTHETIC_EXAMPLES) {
      const { store, engine, lookup } = await started(ex.id)
      const cache = createSceneCache()
      const check = () => {
        const doc = store.getState()
        for (const graph of graphsOf(doc)) {
          const ctx = { project: doc, graph, fonts, result: lookup, screen: SCREEN_SAMPLE }
          expect(plain(cache.layout(ctx)), `${ex.id}: ${graph.name}`).toEqual(
            plain(layoutGraph(ctx)),
          )
          checked++
        }
      }
      check()
      for (const node of Object.values(store.getState().nodes)) {
        if (node.kind === 'table' && node.rowCount > 1) {
          store.dispatch({
            type: 'table.permuteRows',
            table: node.id,
            order: Array.from({ length: node.rowCount }, (_, i) => node.rowCount - 1 - i),
          })
        } else if (node.kind === 'info' && node.fields.length) {
          store.dispatch({ type: 'info.setField', id: node.id, index: 0, value: '2' })
        } else continue
        await engine.idle()
        check()
      }
      store.dispatch({ type: 'project.setSettings', settings: { pValueStyle: 'NEJM' } })
      await engine.idle()
      check()
      engine.stop()
    }
    expect(checked).toBeGreaterThan(100)
  }, 120_000)
})

describe('another project (audit 3, P5)', () => {
  it('lets the scenes and the export worker’s copy of the one before go', async () => {
    const { store, engine, lookup } = await started(SYNTHETIC_EXAMPLES[0]!.id)
    engine.stop()
    const cache = createSceneCache()
    const exporter = { release: vi.fn() }
    releaseOnReset(store, cache, exporter)
    const doc = store.getState()
    for (const graph of graphsOf(doc)) cache.layout({ project: doc, graph, fonts, result: lookup })
    expect(cache.size).toBe(graphsOf(doc).length)
    // An edit keeps them.
    store.dispatch({ type: 'node.rename', id: graphsOf(doc)[0]!.id, name: 'Renamed' })
    expect(cache.size).toBe(graphsOf(doc).length)
    expect(exporter.release).not.toHaveBeenCalled()
    store.reset(createProject())
    expect(cache.size).toBe(0)
    expect(exporter.release).toHaveBeenCalledOnce()
  })
})
