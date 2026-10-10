import { FontsPending, presetGraph } from '@ps/graph'
import { readProjectFile, writeProjectFile } from '@ps/io'
import {
  type AnalysisResult,
  createInfoSheet,
  type FolderId,
  type GraphNode,
  type NodeId,
  newNodeId,
  type Project,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { deepFamily } from '../../engine/test/familyFixture.ts'
import { fonts, projectOf } from '../../graph/test/helpers.ts'
import { syntheticTable } from '../../model/test/synthetic.ts'
import { dropHints } from '../src/drop/dropRouter.ts'
import { tableRowsOfInfo } from '../src/organise/infoExport.ts'
import {
  familyItems,
  kindSections,
  type NavItem,
  sheetsToFile,
  visibleKeys,
} from '../src/organise/navModel.ts'
import { renderThumbnail, ThumbnailCache, thumbnailVersion } from '../src/organise/thumbnails.ts'

// Roadmap 40 in the app: the navigator's views with folders, the thumbnails cache, info sheets'
// export, folders in the project file, the drop overlay's words for projects.

const F = 'exp' as FolderId
const SUB = 'sub' as FolderId

/** The fixture's project with a folder (Day 1 and its graph) and a subfolder (the page). */
function filed() {
  const f = deepFamily()
  f.store.dispatch([
    { type: 'folder.add', folder: { id: F, name: 'Experiment' } },
    { type: 'folder.add', folder: { id: SUB, name: 'Figures', parent: F } },
    { type: 'folder.file', ids: [f.day1.id, f.g1.id], folder: F },
    { type: 'folder.file', ids: [f.whole.id], folder: SUB },
  ])
  return { ...f, doc: f.store.getState() }
}

/** Items as names: folders `{name: [...]}`, sheets their names. */
function shown(p: Project, items: readonly NavItem[]): unknown[] {
  return items.map((it) =>
    it.type === 'folder'
      ? { [`[${it.folder.name}]`]: shown(p, it.items) }
      : it.items.length
        ? { [p.nodes[it.id]!.name]: shown(p, it.items) }
        : `${it.link ? '→' : ''}${p.nodes[it.id]!.name}`,
  )
}

describe('the navigator’s views', () => {
  it('by kind: folders in each section holding its kind, subfolders inside, then the rest', () => {
    const { doc } = filed()
    const sections = kindSections(doc, new Set())
    const of = (kind: string) => shown(doc, sections.find((s) => s.kind === kind)!.items)
    expect(of('table')).toEqual([{ '[Experiment]': ['Day 1'] }, 'Other'])
    expect(of('graph')).toEqual([{ '[Experiment]': ['Day 1'] }, 'Scale of Day 1', 'Other'])
    expect(of('layout')).toEqual([
      { '[Experiment]': [{ '[Figures]': ['Figure Day 1'] }] },
      'Figure both',
    ])
    // A section without sheets of that kind in a folder doesn't show the folder.
    expect(of('analysis')).not.toContainEqual(expect.objectContaining({ '[Experiment]': [] }))
    // Moving up and down stays among the sheets beside it.
    const graphs = sections.find((s) => s.kind === 'graph')!.items
    const loose = graphs.filter((it) => it.type === 'sheet')
    expect(loose[0]!.type === 'sheet' && loose[0]!.siblings.length).toBe(2)
  })

  it('folds folders by key; an empty folder shows in every section', () => {
    const f = deepFamily()
    f.store.dispatch({ type: 'folder.add', folder: { id: F, name: 'Empty' } })
    const doc = f.store.getState()
    for (const s of kindSections(doc, new Set()))
      expect(s.items[0]).toMatchObject({ type: 'folder', count: 0 })
    const folded = kindSections(doc, new Set(['kind:folder:exp']))
    expect(folded[0]!.items[0]).toMatchObject({ type: 'folder', open: false })
    // Folded folders' sheets aren't keyboard stops.
    const { doc: d2 } = filed()
    const keys = visibleKeys(kindSections(d2, new Set(['kind:folder:exp']))[0]!.items)
    expect(keys).toEqual(['kind:folder:exp', d2.order[1]])
  })

  it('families: whole families in their table’s folder; Move to folder takes the family', () => {
    const { doc, day1, whole, scale, g1, sum } = filed()
    const items = familyItems(doc, new Set())
    const tree = shown(doc, items)
    expect(tree[0]).toEqual({
      '[Experiment]': [
        { '[Figures]': [{ 'Figure Day 1': ['→Day 1', '→Scale of Day 1'] }] },
        {
          'Day 1': [
            { 'Scale of Day 1': ['Sum of Scale of Day 1', 'Scale of Day 1'] },
            'Sum of Day 1',
            'Expected of Day 1',
            'Day 1',
          ],
        },
      ],
    })
    expect(tree.slice(1)).toEqual([{ Other: ['Other'] }, { 'Figure both': ['→Day 1', '→Other'] }])
    expect(sheetsToFile(doc, day1.id, 'family')).toEqual(
      expect.arrayContaining([day1.id, scale.id, sum.id, g1.id]),
    )
    expect(sheetsToFile(doc, day1.id, 'kind')).toEqual([day1.id])
    expect(sheetsToFile(doc, whole.id, 'family')).toEqual([whole.id])
    // Folding a family by its key.
    const folded = familyItems(doc, new Set([`family:node:${day1.id}`]))
    const exp = folded[0]!
    const fam = exp.items.find((x) => x.type === 'sheet' && x.id === day1.id)!
    expect(fam.open).toBe(false)
  })
})

/** A result lookup whose answers can be swapped. */
function results() {
  const map = new Map<NodeId, AnalysisResult>()
  return { map, lookup: (id: NodeId) => map.get(id) }
}

describe('thumbnails', () => {
  it('have a version that changes with what the drawing reads, and only then', () => {
    const f = deepFamily()
    const r = results()
    const v0 = thumbnailVersion(f.store.getState(), f.g1.id, r.lookup)!
    // Another table's edit: the same.
    f.store.dispatch({
      type: 'table.setCells',
      table: f.other.id,
      edits: [{ col: f.other.dataSets[0]!.id, sub: 0, row: 0, value: 7 }],
    })
    expect(thumbnailVersion(f.store.getState(), f.g1.id, r.lookup)).toBe(v0)
    // Its table's edit, its analysis' new result, the project's style: changed.
    f.store.dispatch({
      type: 'table.setCells',
      table: f.day1.id,
      edits: [{ col: f.A, sub: 0, row: 0, value: 9 }],
    })
    const v1 = thumbnailVersion(f.store.getState(), f.g1.id, r.lookup)!
    expect(v1).not.toBe(v0)
    r.map.set(f.sum.id, {
      status: 'ok',
      diagnostics: [],
      sheets: [],
      values: {},
      comparisons: [],
      outputs: {},
    })
    const v2 = thumbnailVersion(f.store.getState(), f.g1.id, r.lookup)!
    expect(v2).not.toBe(v1)
    f.store.dispatch({ type: 'project.setSettings', settings: { pValueDigits: 3 } })
    expect(thumbnailVersion(f.store.getState(), f.g1.id, r.lookup)).not.toBe(v2)
    // A page's version follows its graphs' data; tables have none.
    const p0 = thumbnailVersion(f.store.getState(), f.whole.id, r.lookup)
    f.store.dispatch({
      type: 'table.setCells',
      table: f.day1.id,
      edits: [{ col: f.A, sub: 0, row: 1, value: 9 }],
    })
    expect(thumbnailVersion(f.store.getState(), f.whole.id, r.lookup)).not.toBe(p0)
    expect(thumbnailVersion(f.store.getState(), f.day1.id, r.lookup)).toBeNull()
  })

  it('are drawn in the background once per version, and redrawn when out of date', () => {
    const f = deepFamily()
    const tasks: (() => void)[] = []
    const drawn: NodeId[] = []
    const cache = new ThumbnailCache({
      project: () => f.store.getState(),
      result: () => undefined,
      assetsVersion: () => 0,
      render: (_, id) => {
        drawn.push(id)
        return `url:${id}:${drawn.length}`
      },
      schedule: (t) => tasks.push(t),
    })
    let heard = 0
    cache.subscribe(() => heard++)
    // Nothing yet: asked for, queued, not drawn while editing goes on.
    expect(cache.get(f.g1.id)).toBeNull()
    expect(cache.get(f.g2.id)).toBeNull()
    expect(cache.get(f.g1.id)).toBeNull()
    expect(drawn).toEqual([])
    expect(tasks).toHaveLength(1)
    // Idle: the latest asked first, one per slot.
    tasks.shift()!()
    expect(drawn).toEqual([f.g1.id])
    tasks.shift()!()
    expect(drawn).toEqual([f.g1.id, f.g2.id])
    expect(heard).toBe(2)
    expect(cache.get(f.g1.id)).toBe(`url:${f.g1.id}:1`)
    expect(cache.isCurrent(f.g1.id)).toBe(true)
    expect(tasks).toHaveLength(0)
    // A change to its data: the old drawing shows until the new one is made.
    f.store.dispatch({
      type: 'table.setCells',
      table: f.day1.id,
      edits: [{ col: f.A, sub: 0, row: 0, value: 50 }],
    })
    expect(cache.isCurrent(f.g1.id)).toBe(false)
    expect(cache.isCurrent(f.g2.id)).toBe(false)
    expect(cache.get(f.g1.id)).toBe(`url:${f.g1.id}:1`)
    tasks.shift()!()
    expect(cache.get(f.g1.id)).toBe(`url:${f.g1.id}:3`)
    // Deleted sheets are forgotten.
    f.store.dispatch({ type: 'node.remove', id: f.g1.id })
    cache.prune(f.store.getState())
    expect(cache.get(f.g1.id)).toBeNull()
  })

  it('wait for a font family still loading, then draw (audit 2 P5)', async () => {
    const f = deepFamily()
    const tasks: (() => void)[] = []
    let loaded: () => void = () => {}
    const settled = new Promise<void>((resolve) => {
      loaded = resolve
    })
    let ready = false
    const cache = new ThumbnailCache({
      project: () => f.store.getState(),
      result: () => undefined,
      assetsVersion: () => 0,
      render: (_, id) => {
        if (!ready) throw new FontsPending('serif', settled)
        return `url:${id}`
      },
      schedule: (t) => tasks.push(t),
    })
    expect(cache.get(f.g1.id)).toBeNull()
    tasks.shift()!()
    // Not drawn, and not given up on: nothing queued until the family is in.
    expect(cache.isCurrent(f.g1.id)).toBe(false)
    expect(tasks).toHaveLength(0)
    ready = true
    loaded()
    await settled
    await Promise.resolve()
    expect(tasks).toHaveLength(1)
    tasks.shift()!()
    expect(cache.get(f.g1.id)).toBe(`url:${f.g1.id}`)
    expect(cache.isCurrent(f.g1.id)).toBe(true)
  })

  it('draw graphs and pages as SVG', () => {
    const f = deepFamily()
    const doc = f.store.getState()
    for (const id of [f.g1.id, f.whole.id]) {
      const url = renderThumbnail(
        doc,
        id,
        fonts,
        () => undefined,
        () => undefined,
      )!
      expect(url.startsWith('data:image/svg+xml')).toBe(true)
      expect(decodeURIComponent(url)).toContain('<svg')
    }
    expect(
      renderThumbnail(
        doc,
        f.day1.id,
        fonts,
        () => undefined,
        () => undefined,
      ),
    ).toBeNull()
    expect((doc.nodes[f.g1.id] as GraphNode).kind).toBe('graph')
  })
})

describe('thumbnails of big graphs (audit 3, P2)', () => {
  const draw = (p: Project, id: NodeId) =>
    decodeURIComponent(
      renderThumbnail(
        p,
        id,
        fonts,
        () => undefined,
        () => undefined,
      )!,
    )
  const symbols = (svg: string) => svg.match(/<path d="M[^"]*a/g)?.length ?? 0

  it('draw an XY graph of many rows from a sample of 2,000', () => {
    const t = syntheticTable({ rows: 30_000, genes: 2, pcs: 2 })
    const g = { ...presetGraph(t, 'bubble'), id: 'g' as NodeId }
    const svg = draw(projectOf(t, g), g.id)
    // Was every row's symbol (about 3 MB).
    expect(symbols(svg)).toBeLessThanOrEqual(2000)
    expect(svg.length).toBeLessThan(600_000)
  })

  it('draw more points than the canvas draws as symbols as images', () => {
    const t = syntheticTable({ rows: 1500, genes: 20, pcs: 0, cellIds: false })
    const g = { ...presetGraph(t, 'points'), id: 'g' as NodeId }
    const svg = draw(projectOf(t, g), g.id)
    expect(svg).toContain('<image')
    expect(symbols(svg)).toBeLessThan(100)
  })
})

describe('info sheets and folders in files', () => {
  it('export an info sheet’s fields and notes', () => {
    const sheet = {
      ...createInfoSheet(newNodeId(), 'Experiment', 'experiment'),
      notes: 'First line\nSecond',
    }
    sheet.fields[0]!.value = '2026-10-06'
    const rows = tableRowsOfInfo(sheet)
    expect(rows[1]).toEqual(['Date', '2026-10-06'])
    expect(rows.slice(-2)).toEqual([['First line'], ['Second']])
  })

  it('keep folders through a save, and none where there are none', () => {
    const { doc } = filed()
    const back = readProjectFile(writeProjectFile(doc)).project
    expect(back.folders).toEqual(doc.folders)
    const plain = deepFamily().store.getState()
    expect('folders' in readProjectFile(writeProjectFile(plain)).project).toBe(false)
  })

  it('a dropped project may be opened or imported', () => {
    expect(dropHints(new Set(['project']), 'other')[0]).toMatch(/imported into it \(Alt or Shift/)
  })
})
