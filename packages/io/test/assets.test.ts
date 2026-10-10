import { createHash } from 'node:crypto'
import {
  type AnalysisNode,
  type AnalysisResult,
  createProject,
  createTable,
  type LayoutItem,
  type LayoutNode,
  newLayoutItemId,
  newNodeId,
  type Project,
} from '@ps/model'
import { unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { fixtureBytes } from '../../graph/test/images.ts'
import {
  AssetError,
  assetIdOf,
  MAX_ASSET_BYTES,
  ProjectFileError,
  pageTableGrid,
  readImageAsset,
  readProjectFile,
  sha256Hex,
  writeProjectFile,
} from '../src/index.ts'

// Images in project files (roadmap 32): content-hash ids, `assets/<id>.<ext>` entries, garbage
// collection on save, limits; and live page tables' cells.

const png = readImageAsset(fixtureBytes('rgba.png'))
const jpeg = readImageAsset(fixtureBytes('photo.jpg'))

function projectWith(...items: LayoutItem[]): Project {
  const p = createProject()
  const layout: LayoutNode = {
    kind: 'layout',
    id: newNodeId(),
    name: 'Figure',
    page: { width: 612, height: 792 },
    items,
    panelLabels: { show: true, style: 'A', size: 14 },
  }
  p.nodes[layout.id] = layout
  p.order.push(layout.id)
  return p
}
const image = (asset: typeof png, x = 0): LayoutItem => ({
  type: 'image',
  id: newLayoutItemId(),
  asset: asset.id,
  x,
  y: 0,
  w: 100,
  h: 60,
})
const names = (bytes: Uint8Array) =>
  Object.keys(unzipSync(bytes)).filter((n) => n.startsWith('assets/'))

describe('asset ids', () => {
  it('are the first 128 bits of the bytes’ SHA-256', () => {
    for (const data of [
      new Uint8Array(0),
      new TextEncoder().encode('abc'),
      fixtureBytes('photo.jpg'),
    ])
      expect(sha256Hex(data)).toBe(createHash('sha256').update(data).digest('hex'))
    // 55, 56 and 64 bytes: the padding's edge cases.
    for (const n of [55, 56, 63, 64, 65, 1000]) {
      const b = Uint8Array.from({ length: n }, (_, i) => i * 7)
      expect(sha256Hex(b)).toBe(createHash('sha256').update(b).digest('hex'))
    }
    expect(png.id).toBe(sha256Hex(png.bytes).slice(0, 32))
    // The same bytes, the same id: an image placed twice is stored once.
    expect(assetIdOf(png.bytes.slice())).toBe(png.id)
  })

  it('come with the image’s size, and refuse what can’t be placed', () => {
    expect(png).toMatchObject({ mime: 'image/png', width: 12, height: 7 })
    expect(jpeg).toMatchObject({ mime: 'image/jpeg', dpi: 300 })
    const tiff = Uint8Array.of(0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8)
    expect(() => readImageAsset(tiff)).toThrow(AssetError)
    expect(() => readImageAsset(tiff)).toThrow(/TIFF/)
    const big = new Uint8Array(MAX_ASSET_BYTES + 1)
    expect(() => readImageAsset(big)).toThrow(/at most 25 MB can be placed/)
  })
})

describe('project files with images', () => {
  it('round-trip the images their pages place, stored uncompressed', () => {
    const p = projectWith(image(png), image(jpeg, 120), image(png, 240))
    const bytes = writeProjectFile(p, { assets: new Map([png, jpeg].map((a) => [a.id, a])) })
    expect(names(bytes).sort()).toEqual([`assets/${jpeg.id}.jpg`, `assets/${png.id}.png`].sort())
    const back = readProjectFile(bytes)
    expect(back.project.nodes).toEqual(p.nodes)
    expect([...back.assets.keys()].sort()).toEqual([png.id, jpeg.id].sort())
    expect(back.assets.get(png.id)).toEqual({
      id: png.id,
      mime: 'image/png',
      width: 12,
      height: 7,
      bytes: png.bytes,
    })
    // Stored, not deflated (they are compressed already): the bytes are in the file as they are.
    expect(Buffer.from(bytes).includes(Buffer.from(jpeg.bytes))).toBe(true)
  })

  it('leave out images no page places any more (and ones the store doesn’t have)', () => {
    const p = projectWith(image(png))
    const bytes = writeProjectFile(p, { assets: new Map([png, jpeg].map((a) => [a.id, a])) })
    expect(names(bytes)).toEqual([`assets/${png.id}.png`])
    const none = writeProjectFile(p, { assets: new Map() })
    expect(names(none)).toEqual([])
    // Opens, with the image missing (its item shows a placeholder).
    expect(readProjectFile(none).assets.size).toBe(0)
  })

  it('skip damaged, mislabelled or unreferenced image entries, and refuse oversized ones', () => {
    const p = projectWith(image(png), image(jpeg))
    const files = unzipSync(writeProjectFile(p))
    const tamper = (edit: (f: Record<string, Uint8Array>) => void) => {
      const copy = { ...files }
      edit(copy)
      return zipSync(copy)
    }
    const bad = tamper((f) => {
      f[`assets/${png.id}.png`] = new TextEncoder().encode('<svg onload="x()"/>')
      f[`assets/${jpeg.id}.png`] = jpeg.bytes
      f[`assets/${'0'.repeat(32)}.png`] = png.bytes
      f['assets/__proto__.png'] = png.bytes
    })
    expect(readProjectFile(bad).assets.size).toBe(0)
    const huge = tamper((f) => {
      f[`assets/${png.id}.png`] = new Uint8Array(MAX_ASSET_BYTES + 10)
    })
    expect(() => readProjectFile(huge)).toThrow(ProjectFileError)
    expect(() => readProjectFile(huge)).toThrow(/too large to open/)
  })
})

describe('page tables', () => {
  function setup() {
    const project = createProject()
    const table = createTable({ columns: 2, rows: 3, name: 'Weights' })
    table.dataSets[0]!.title = 'Control'
    table.dataSets[0]!.subcolumns[0]!.values = [1, 2, 0.1 + 0.2]
    table.dataSets[1]!.subcolumns[0]!.values = [4, null, 6]
    const analysis = { kind: 'analysis', id: newNodeId(), name: 'Stats' } as AnalysisNode
    project.nodes[table.id] = table
    project.nodes[analysis.id] = analysis
    project.order.push(table.id, analysis.id)
    return { project, table, analysis }
  }

  it('show a data table as the grid does: titles, then values', () => {
    const { project, table } = setup()
    const g = pageTableGrid(project, { kind: 'table', node: table.id }, () => undefined)
    if ('error' in g) throw new Error(g.error)
    expect(g.rows[0]!.map((c) => [c.text, c.style])).toEqual([
      ['Control', 'header'],
      [table.dataSets[1]!.title, 'header'],
    ])
    expect(g.rows.slice(1).map((r) => r.map((c) => c.text))).toEqual([
      ['1', '4'],
      ['2', ''],
      ['0.3', '6'],
    ])
    expect(g.rows[1]![0]!.numeric).toBe(true)
  })

  it('show a results sheet as displayed, and say why when there is none', () => {
    const { project, analysis } = setup()
    const result = {
      status: 'ok',
      diagnostics: [],
      sheets: [
        {
          key: 'summary',
          title: 'Summary',
          blocks: [
            {
              type: 'keyValue',
              title: 'Test',
              rows: [
                { label: 'P value', value: { kind: 'pvalue', v: 0.00001 } },
                { label: 'Mean', value: { kind: 'number', v: 1.23456789, digits: 3 } },
              ],
            },
          ],
        },
      ],
      values: {},
      comparisons: [],
      outputs: {},
    } as unknown as AnalysisResult
    const lookup = (id: string) => (id === analysis.id ? result : undefined)
    const g = pageTableGrid(
      project,
      { kind: 'results', node: analysis.id, sheet: 'summary' },
      lookup,
    )
    if ('error' in g) throw new Error(g.error)
    expect(g.rows.map((r) => r.map((c) => c.text))).toEqual([
      ['Test'],
      ['P value', '<0.0001'],
      ['Mean', expect.stringMatching(/^1\.23/)],
    ])
    expect(g.rows[0]![0]!.style).toBe('title')
    const src = { kind: 'results' as const, node: analysis.id, sheet: 'summary' }
    expect(pageTableGrid(project, src, () => undefined)).toEqual({ error: 'not computed yet' })
    expect(pageTableGrid(project, { ...src, sheet: 'nope' }, lookup)).toEqual({
      error: '“Stats” has no such results sheet',
    })
    expect(pageTableGrid(project, { ...src, node: newNodeId() }, lookup)).toEqual({
      error: 'its source was deleted',
    })
    expect(pageTableGrid(project, { kind: 'table', node: analysis.id }, lookup)).toEqual({
      error: 'not computed yet',
    })
  })
})
