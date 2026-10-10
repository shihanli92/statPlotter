import { createGraphFor, layoutGraph, type Scene, smallestText } from '@ps/graph'
import { createTable, type LayoutNode, type NodeId, newLayoutItemId, newNodeId } from '@ps/model'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { fonts, projectOf } from '../../graph/test/helpers.ts'
import { readPdf } from '../../graph/test/pdfRead.ts'
import { batchItems, describeBatch, exportEach, zipFiles } from '../src/graph/batchExport.tsx'
import {
  DEFAULT_EXPORT,
  type ExportSettings,
  fileBaseOf,
  forgetExportChoice,
  loadExportSettings,
  parseExportSettings,
  saveExportSettings,
  uniqueFileNames,
} from '../src/graph/exportSettings.ts'
import { imageSize, imageTooLarge } from '../src/graph/figureFiles.ts'
import { PRINT_MARGIN, pageRule } from '../src/graph/print.ts'
import { createFigureCore } from '../src/worker/figureCore.ts'

// Roadmap 27: the Export dialog's settings, sizes, file names, batch export and print pages.

function setup() {
  const table = createTable({ tableKind: 'column', columns: 2, rows: 3 })
  table.dataSets.forEach((d, i) => {
    d.subcolumns[0]!.values = [1 + i, 2 + i, 4 + i]
  })
  const g1 = { ...createGraphFor(table), name: 'Weights' }
  const g2 = { ...createGraphFor(table), id: newNodeId(), name: 'Weights' }
  const layout: LayoutNode = {
    kind: 'layout',
    id: newNodeId(),
    name: 'Figure 1',
    page: { width: 612, height: 792 },
    items: [{ type: 'graph', id: newLayoutItemId(), graph: g1.id, x: 36, y: 36, scale: 0.5 }],
    panelLabels: { show: true, style: 'A', size: 14 },
  }
  const project = projectOf(table, g1, g2, layout)
  return { project, g1, g2, layout }
}

const settings = (patch: Partial<ExportSettings> = {}): ExportSettings => ({
  ...DEFAULT_EXPORT,
  ...patch,
})

describe('export settings', () => {
  it('reads remembered settings back, each field checked', () => {
    expect(parseExportSettings(null)).toEqual(DEFAULT_EXPORT)
    expect(
      parseExportSettings({ format: 'exe', dpi: 5, quality: 3, width: { unit: 'km' } }),
    ).toEqual(DEFAULT_EXPORT)
    const s = {
      format: 'tiff',
      width: { unit: 'mm', value: 85 },
      mode: 'scale',
      dpi: 600,
      quality: 0.5,
      transparent: true,
      pointsAsImage: true,
    }
    expect(parseExportSettings(JSON.parse(JSON.stringify(s)))).toEqual(s)
  })

  it('start from the Preferences’ format and resolution, then this session’s choice (U21)', () => {
    forgetExportChoice()
    expect(loadExportSettings({})).toMatchObject({ format: 'pdf', dpi: 300 })
    expect(loadExportSettings({ exportFormat: 'png', exportDpi: 600 })).toMatchObject({
      format: 'png',
      dpi: 600,
    })
    // Exported as SVG at 150 dpi: that, this session, whatever the Preferences say…
    const prefs = { exportFormat: 'tiff' as const, exportDpi: 1200 }
    saveExportSettings({ ...DEFAULT_EXPORT, format: 'svg', dpi: 150 })
    expect(loadExportSettings(prefs)).toMatchObject({ format: 'svg', dpi: 150 })
    // …until the Preferences change (or the app opens again).
    forgetExportChoice()
    expect(loadExportSettings(prefs)).toMatchObject({ format: 'tiff', dpi: 1200 })
    expect(loadExportSettings({})).toMatchObject({ format: 'pdf', dpi: 300 })
  })

  it('file names: safe and unique ignoring case', () => {
    expect(fileBaseOf('a/b: c?', 'graph')).toBe('a_b_ c_')
    expect(fileBaseOf(' ..', 'graph')).toBe('graph')
    expect(fileBaseOf('Fig. 1.', 'graph')).toBe('Fig. 1')
    expect(uniqueFileNames(['Graph', 'graph', 'Graph', 'x/y'], 'pdf')).toEqual([
      'Graph.pdf',
      'graph (2).pdf',
      'Graph (3).pdf',
      'x_y.pdf',
    ])
  })

  it('sizes: keep text size lays out again, scale everything scales, percentages', () => {
    const { project, g1 } = setup()
    const scene = layoutGraph({ project, graph: g1, fonts })
    const core = createFigureCore({ context: () => ({ project, fonts }) })
    const target = { kind: 'graph', graph: g1.id } as const
    const mm85 = { unit: 'mm' as const, value: 85 }
    const [kept] = core.measure([target], { width: mm85, mode: 'keepText' })
    expect(kept!.width).toBeCloseTo(240.945, 3)
    expect(kept!.natural).toBe(scene.width)
    // Laid out again: the text keeps its size.
    expect(kept!.minText).toBe(smallestText(scene))
    const [scaled] = core.measure([target], { width: mm85, mode: 'scale' })
    expect(scaled!.width).toBeCloseTo(240.945, 3)
    expect(scaled!.height).toBeCloseTo((scene.height * 240.945) / scene.width, 2)
    expect(scaled!.minText).toBeCloseTo((smallestText(scene)! * scaled!.width) / scene.width, 9)
    // 100% is the scene itself.
    const [same] = core.measure([target], { width: { unit: '%', value: 100 }, mode: 'keepText' })
    expect([same!.width, same!.height]).toEqual([scene.width, scene.height])
  })

  it('image sizes and limits', () => {
    const scene = { width: 72, height: 36 } as Scene
    expect(imageSize(scene, 300)).toEqual({ w: 300, h: 150 })
    expect(imageTooLarge('png', 8000, 8000)).toBeNull()
    expect(imageTooLarge('jpeg', 8000, 8000)).toMatch(/JPEG images are limited to 16.8 million/)
    expect(imageTooLarge('tiff', 40_000, 10)).toMatch(/32,767 a side/)
  })

  it('SVG and PDF: white background unless transparent; the PDF titled', async () => {
    const { project, g1 } = setup()
    const core = createFigureCore({ context: () => ({ project, fonts }) })
    const target = { kind: 'graph', graph: g1.id } as const
    const svg = core.file(target, settings({ format: 'svg' })) as string
    expect(svg).toContain('fill="#ffffff"/>')
    const clear = core.file(target, settings({ format: 'svg', transparent: true })) as string
    expect(clear.split('\n')[1]).not.toMatch(/^<rect x="0" y="0"/)
    const pdf = readPdf(
      core.file(target, settings({ transparent: true }), {
        title: 'Weights',
        date: Date.now(),
      }) as Uint8Array,
    )
    const info = [...pdf.objects.values()].find((o) => o.dict.includes('/Producer'))!
    expect(info.dict).toContain('/Title <FEFF')
    expect(info.dict).toMatch(/\/CreationDate \(D:\d{14}Z\)/)
  })
})

describe('batch export', () => {
  it('lists graphs or pages in navigator order', () => {
    const { project, layout, g1, g2 } = setup()
    expect(batchItems(project, 'graphs')).toEqual([
      { name: 'Weights', target: { kind: 'graph', graph: g1.id } },
      { name: 'Weights', target: { kind: 'graph', graph: g2.id } },
    ])
    expect(batchItems(project, 'pages')).toEqual([
      { name: layout.name, target: { kind: 'page', layout } },
    ])
  })

  it('writes every file under a unique name; a failure is reported and the rest written', async () => {
    const { project } = setup()
    const core = createFigureCore({ context: () => ({ project, fonts }) })
    const items = [
      ...batchItems(project, 'graphs'),
      { name: 'Broken', target: { kind: 'graph', graph: 'gone' as NodeId } } as const,
    ]
    const s = settings({ format: 'svg', width: { unit: 'mm', value: 85 } })
    const written: { name: string; data: Uint8Array | string }[] = []
    const seen: number[] = []
    const outcome = await exportEach(
      items,
      s,
      async (it) => core.file(it.target, s),
      async (name, data) => {
        written.push({ name, data })
      },
      (p) => seen.push(p.done),
    )
    expect(outcome).toEqual({
      written: 2,
      failed: [{ name: 'Broken', error: 'The graph is no longer in the project.' }],
    })
    expect(written.map((f) => f.name)).toEqual(['Weights.svg', 'Weights (2).svg'])
    for (const f of written) expect(f.data).toMatch(/width="240.945pt"/)
    expect(seen.at(-1)).toBe(3)
    expect(describeBatch(outcome, 'graphs', 'to “Figures”')).toBe(
      'Exported 2 graphs to “Figures”. Not exported: “Broken” (The graph is no longer in the project.)',
    )
    expect(describeBatch({ written: 1, failed: [] }, 'pages', 'in x.zip')).toBe(
      'Exported 1 page in x.zip.',
    )

    const zip = unzipSync(zipFiles(written, false))
    expect(Object.keys(zip)).toEqual(['Weights.svg', 'Weights (2).svg'])
    expect(strFromU8(zip['Weights.svg']!)).toBe(written[0]!.data)
  })
})
describe('print', () => {
  it('pages print edge to edge at their size; graphs with a half-inch margin', () => {
    const scene = { width: 200.5, height: 100 } as Scene
    expect(pageRule(scene, { width: 612, height: 792 })).toBe(
      '@page { size: 612pt 792pt; margin: 0pt; }',
    )
    expect(PRINT_MARGIN).toBe(36)
    expect(pageRule(scene)).toBe('@page { size: 272.5pt 172pt; margin: 36pt; }')
  })
})
