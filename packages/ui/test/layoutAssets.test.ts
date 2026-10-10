import { registry } from '@ps/analyses'
import { layoutPage, type PageScene } from '@ps/graph'
import { readImageAsset, readProjectFile, writeProjectFile } from '@ps/io'
import {
  type AnalysisNode,
  createProject,
  createTable,
  type LayoutItem,
  type LayoutNode,
  newLayoutItemId,
  newNodeId,
  type Project,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { fonts } from '../../graph/test/helpers.ts'
import { fixtureBytes } from '../../graph/test/images.ts'
import { pageSources } from '../src/layout/pageScene.ts'
import { createServices, load, projectFileParts, serialize } from '../src/services.ts'

// Roadmap 32: images held beside the document (undo keeps them, saves and recovery copies carry
// the placed ones) and live tables following their data and results.

const png = (() => {
  const { dpi: _, ...a } = readImageAsset(fixtureBytes('rgba.png'))
  return a
})()

function withLayout(items: LayoutItem[] = []): { project: Project; layout: LayoutNode } {
  const project = createProject()
  const layout: LayoutNode = {
    kind: 'layout',
    id: newNodeId(),
    name: 'Figure',
    page: { width: 612, height: 792 },
    items,
    panelLabels: { show: true, style: 'A', size: 14 },
  }
  project.nodes[layout.id] = layout
  project.order.push(layout.id)
  return { project, layout }
}
const imageItem = (): LayoutItem => ({
  type: 'image',
  id: newLayoutItemId(),
  asset: png.id,
  x: 10,
  y: 10,
  w: 120,
  h: 70,
})
const assetsIn = (bytes: Uint8Array) => [...readProjectFile(bytes).assets.keys()]

describe('images and undo', () => {
  it('keeps an image’s bytes while an undo step can bring it back; saves only placed ones', () => {
    const { project, layout } = withLayout()
    const s = createServices({ fonts, platform: {} as never, project })
    s.assets.add(png)
    s.store.dispatch({ type: 'node.set', id: layout.id, path: ['items'], value: [imageItem()] })
    expect(assetsIn(serialize(s, { selected: null }))).toEqual([png.id])
    s.store.undo()
    // Not placed: not written; still held.
    expect(assetsIn(serialize(s, { selected: null }))).toEqual([])
    expect(s.assets.has(png.id)).toBe(true)
    s.store.redo()
    expect(assetsIn(serialize(s, { selected: null }))).toEqual([png.id])
    // Deleting the item and undoing that brings the picture back too.
    s.store.dispatch({ type: 'node.set', id: layout.id, path: ['items'], value: [] })
    s.store.undo()
    const scene = layoutPage({
      project: s.store.getState(),
      layout: s.store.getState().nodes[layout.id] as LayoutNode,
      fonts,
      ...pageSources(s.store.getState(), undefined, (a) => s.assets.get(a)),
    })
    expect(scene.warnings).toEqual([])
  })

  it('adds the same bytes once; opening a file or a new project replaces the images', () => {
    const s = createServices({ fonts, platform: {} as never })
    expect(s.assets.add({ ...png, bytes: png.bytes.slice() })).toBe(s.assets.add(png))
    const v = s.assets.version
    s.assets.add(png)
    expect(s.assets.version).toBe(v)
    const { project } = withLayout([imageItem()])
    load(s, writeProjectFile(project, { assets: new Map([[png.id, png]]) }))
    expect(s.assets.get(png.id)?.bytes).toEqual(png.bytes)
    load(s, writeProjectFile(withLayout().project))
    expect(s.assets.has(png.id)).toBe(false)
  })

  it('recovery copies are what Save writes: the placed images included', () => {
    const { project } = withLayout([imageItem()])
    const s = createServices({ fonts, platform: {} as never, project })
    s.assets.add(png)
    const parts = projectFileParts(s, { selected: null })
    expect([...parts.assets.keys()]).toEqual([png.id])
    // The recovery worker writes exactly this.
    const copy = writeProjectFile(parts.project, parts)
    expect(readProjectFile(copy).assets.get(png.id)?.bytes).toEqual(png.bytes)
    expect(assetsIn(serialize(s, { selected: null }))).toEqual([png.id])
  })
})

describe('live tables on a page', () => {
  it('follow edits to their data table and the results computed from it', async () => {
    const table = createTable({ rows: 3, columns: 2 })
    table.dataSets[0]!.subcolumns[0]!.values = [1, 2, 3]
    table.dataSets[1]!.subcolumns[0]!.values = [4, 5, 6]
    const analysis: AnalysisNode = {
      kind: 'analysis',
      id: newNodeId(),
      name: 'Descriptive statistics',
      analysisId: 'descriptive',
      pluginVersion: registry.get('descriptive')!.version,
      input: { source: table.id, dataSets: table.dataSets.map((d) => d.id) },
      params: registry.get('descriptive')!.params.parse({}),
    }
    const { project, layout } = withLayout([
      {
        type: 'table',
        id: newLayoutItemId(),
        x: 20,
        y: 20,
        source: { kind: 'table', node: table.id },
      },
      {
        type: 'table',
        id: newLayoutItemId(),
        x: 20,
        y: 200,
        source: { kind: 'results', node: analysis.id, sheet: 'descriptive' },
      },
    ])
    for (const n of [table, analysis]) {
      project.nodes[n.id] = n
      project.order.unshift(n.id)
    }
    const s = createServices({ fonts, platform: {} as never, project })
    await s.engine.idle()
    const page = (): PageScene => {
      const doc = s.store.getState()
      return layoutPage({
        project: doc,
        layout: doc.nodes[layout.id] as LayoutNode,
        fonts,
        ...pageSources(doc, (id) => s.engine.latest(id), undefined),
      })
    }
    const texts = (sc: PageScene, prefix: string) => {
      const out: string[] = []
      const walk = (n: PageScene['root']) => {
        if (n.id.startsWith(prefix) && n.prim?.type === 'text')
          out.push(n.prim.layout.runs.map((r) => r.text).join(''))
        for (const c of n.children ?? []) walk(c)
      }
      walk(sc.root)
      return out
    }
    const [dataItem, resultItem] = (s.store.getState().nodes[layout.id] as LayoutNode).items
    const before = page()
    expect(texts(before, `item/${dataItem!.id}/cell/`)).toContain('3')
    expect(texts(before, `item/${resultItem!.id}/cell/`)).toContain('Mean')
    const mean = texts(before, `item/${resultItem!.id}/cell/`)
    expect(mean).toContain('2.000')
    s.store.dispatch({
      type: 'table.setCells',
      table: table.id,
      edits: [{ col: table.dataSets[0]!.id, sub: 0, row: 2, value: 30 }],
    })
    await s.engine.idle()
    const after = page()
    expect(texts(after, `item/${dataItem!.id}/cell/`)).toContain('30')
    expect(texts(after, `item/${resultItem!.id}/cell/`)).toContain('11.00')
    // Deleting the table takes its page tables with it (they show nothing any more).
    s.store.dispatch({ type: 'node.remove', id: table.id })
    expect((s.store.getState().nodes[layout.id] as LayoutNode).items).toEqual([])
  })
})
