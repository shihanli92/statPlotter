import type { GraphLook } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { layoutGraph, layoutText, type Scene, type SceneNode, sceneToPdf } from '../src/index.ts'
import { graphOf, PRESET_OF_LOOK } from './graphs.ts'
import { fonts, projectOf, sampleTable } from './helpers.ts'
import { deref, pdfjsRead, readPdf, streamText } from './pdfRead.ts'

const style = {
  font: 'sans',
  size: 12,
  bold: false,
  italic: false,
  color: { rgb: '#000000' },
} as const

/** A scene of the given nodes, 200 × 100 pt. */
const sceneOf = (...children: SceneNode[]): Scene => ({
  width: 200,
  height: 100,
  root: { id: 'root', children },
  plot: { x: 0, y: 0, w: 200, h: 100 },
  warnings: [],
})

const text = (
  id: string,
  content: Parameters<typeof layoutText>[1],
  x: number,
  y: number,
  extra: object = {},
): SceneNode => ({
  id,
  prim: {
    type: 'text',
    x,
    y,
    layout: layoutText(fonts, content, style),
    color: '#112233',
    ...extra,
  },
})

/** A new graph of a sample table in the preset that draws a look. */
function graphScene(kind: Parameters<typeof sampleTable>[0], look: GraphLook): Scene {
  const table = sampleTable(kind)
  const graph = graphOf(table, PRESET_OF_LOOK[look])
  return layoutGraph({ project: projectOf(table, graph), graph, fonts })
}

describe('sceneToPdf', () => {
  it('writes a valid file: cross-references, page size, document info', async () => {
    const scene = sceneOf(text('t', [{ text: 'Mean ± SEM' }], 10, 50))
    const bytes = sceneToPdf(scene, fonts, {
      title: 'Graph “1”',
      date: new Date(Date.UTC(2026, 8, 30, 12)),
    })
    const pdf = readPdf(bytes)
    const info = deref(pdf, pdf.trailer, 'Info')
    expect(info.dict).toContain('/CreationDate (D:20260930120000Z)')
    const catalog = deref(pdf, pdf.trailer, 'Root')
    const page = deref(pdf, deref(pdf, catalog.dict, 'Pages').dict, 'Kids \\[')
    expect(page.dict).toContain('/MediaBox [0 0 200 100]')
    const read = await pdfjsRead(bytes)
    expect([read.width, read.height]).toEqual([200, 100])
    expect(read.info.Title).toBe('Graph “1”')
    expect(read.info.Producer).toBe('statPlotter')
    // Deterministic without a date.
    expect(sceneToPdf(scene, fonts)).toEqual(sceneToPdf(scene, fonts))
  })

  it('embeds each face as a TrueType subset with widths and a ToUnicode map', async () => {
    const scene = sceneOf(
      text('a', [{ text: 'AVA' }, { text: 'bold', bold: true }], 10, 30),
      text(
        'b',
        [
          { text: 'Serif', font: 'serif', italic: true },
          { text: 'x = 1', font: 'mono' },
        ],
        10,
        60,
      ),
      text('c', [{ text: 'Narrow', font: 'narrow' }], 10, 90),
    )
    const bytes = sceneToPdf(scene, fonts)
    const pdf = readPdf(bytes)
    const type0 = [...pdf.objects.values()].filter((o) => o.dict.includes('/Subtype /Type0'))
    const names = type0.map((o) => /\/BaseFont \/([A-Z]{6})\+(\S+)/.exec(o.dict)![2]).sort()
    expect(names).toEqual([
      'LiberationMono',
      'LiberationSans',
      'LiberationSans-Bold',
      'LiberationSansNarrow',
      'LiberationSerif-Italic',
    ])
    for (const o of type0) {
      expect(o.dict).toContain('/Encoding /Identity-H')
      const cid = deref(pdf, o.dict, 'DescendantFonts \\[')
      expect(cid.dict).toContain('/Subtype /CIDFontType2')
      expect(cid.dict).toContain('/CIDToGIDMap /Identity')
      expect(cid.dict).toMatch(/\/W \[0 \[\d+(\.\d+)?\] 1 \[/)
      const descriptor = deref(pdf, cid.dict, 'FontDescriptor')
      const file = deref(pdf, descriptor.dict, 'FontFile2')
      // A TrueType program, and a subset (the full faces are 140–400 kB).
      expect([...file.stream!.subarray(0, 4)]).toEqual([0, 1, 0, 0])
      expect(file.stream!.length).toBeLessThan(20_000)
      expect(Number(/\/Length1 (\d+)/.exec(file.dict)![1])).toBe(file.stream!.length)
      expect(streamText(deref(pdf, o.dict, 'ToUnicode'))).toContain('beginbfchar')
    }
    const read = await pdfjsRead(bytes)
    expect(read.text.replace(/\s+/g, ' ')).toContain('AVA')
    expect(read.text).toContain('bold')
    expect(read.text).toContain('Serif')
    expect(read.text.replace(/\s+/g, '')).toContain('x=1')
    expect(read.text).toContain('Narrow')
    expect(read.fonts).toHaveLength(5)
    for (const f of read.fonts) {
      expect(f.embedded).toBe(true)
      expect(f.mimetype).toBe('font/opentype')
    }
  })

  it('places glyphs where the layout measured them, kerning included', async () => {
    // "AV" kerns in Liberation Sans: the TJ array carries the adjustment.
    const t = text('t', [{ text: 'AVA' }], 10, 50)
    const pdf = readPdf(sceneToPdf(sceneOf(t), fonts, { compress: false }))
    const content = [...pdf.objects.values()].find((o) => o.stream && /\bBT\b/.test(streamText(o)))!
    const tj = /\[(.*)\] TJ/.exec(streamText(content))![1]!
    expect(tj).toMatch(/<\w{4}> \d+(\.\d+)? <\w{4}>/)
    // pdf.js puts the run's width where the layout does.
    const read = await pdfjsRead(sceneToPdf(sceneOf(t), fonts))
    const item = read.items.find((i) => i.str.includes('AVA'))!
    const layout = (t.prim as { layout: { width: number } }).layout
    expect(item.width).toBeCloseTo(layout.width, 2)
    expect(item.transform[4]).toBeCloseTo(10, 2)
    expect(item.transform[5]).toBeCloseTo(100 - 50, 2)
  })

  it('maps ligatures, symbols and scripts back to their text', async () => {
    const scene = sceneOf(
      text(
        't',
        [
          { text: 'IC' },
          { text: '50', sub: true },
          { text: ' = 1.2 µM, α β ≥ ' },
          { text: '2', sup: true },
        ],
        10,
        50,
      ),
    )
    const read = await pdfjsRead(sceneToPdf(scene, fonts))
    const all = read.items.map((i) => i.str).join('')
    // pdf.js normalizes what it extracts (NFKC: the micro sign becomes mu).
    for (const s of ['IC', '50', '= 1.2 µM, α β ≥', '2']) expect(all).toContain(s.normalize('NFKC'))
  })

  it('draws with the SVG’s colours, widths, dashes, caps, joins and opacity', () => {
    const scene = sceneOf(
      {
        id: 'l',
        prim: {
          type: 'line',
          x1: 0,
          y1: 10,
          x2: 100,
          y2: 10,
          stroke: { color: '#ff0000', width: 2, dash: 'dash' },
        },
      },
      {
        id: 'p',
        prim: {
          type: 'polygon',
          points: [
            [0, 0],
            [10, 0],
            [10, 10],
          ],
          fill: { color: '#00ff00', opacity: 0.5 },
          stroke: { color: '#0000ff', width: 1, dash: 'solid' },
        },
      },
      {
        id: 's',
        prim: {
          type: 'symbol',
          shape: 'circle',
          cx: 50,
          cy: 50,
          size: 10,
          stroke: null,
          fill: { color: '#336699', opacity: 1 },
        },
      },
      {
        id: 'moved',
        transform: { x: 20, y: 30, scale: 0.5 },
        children: [
          {
            id: 'r',
            prim: {
              type: 'rect',
              x: 0,
              y: 0,
              w: 10,
              h: 5,
              stroke: null,
              fill: { color: '#000', opacity: 1 },
            },
          },
        ],
      },
    )
    const pdf = readPdf(sceneToPdf(scene, fonts, { background: '#ffffff', compress: false }))
    const page = [...pdf.objects.values()].find((o) => o.dict.includes('/Type /Page '))!
    expect(page.dict).toMatch(
      /\/ExtGState << \/A1 << \/Type \/ExtGState \/ca 0.5 >> \/A2 << \/Type \/ExtGState \/ca 1 >>/,
    )
    expect(page.dict).toContain('/Group << /Type /Group /S /Transparency /CS /DeviceRGB >>')
    const ops = streamText(deref(pdf, page.dict, 'Contents'))
    expect(ops).toContain('1 0 0 -1 0 100 cm 4 M')
    // The background first.
    expect(ops).toMatch(/1 1 1 rg\n0 0 200 100 re f/)
    // Dashed red line, 2 pt, square caps; dash pattern as the SVG's (4 3 × width).
    expect(ops).toContain('2 w\n2 J\n[8 6] 0 d\n1 0 0 RG\n0 10 m 100 10 l S')
    // Half-transparent green fill, then the blue outline, butt caps, solid.
    expect(ops).toMatch(/0 1 0 rg\n\/A1 gs\n1 w\n0 J\n\[\] 0 d\n0 0 1 RG\n0 0 m 10 0 l 10 10 l h B/)
    // Opaque again for the circle (4 Bézier curves).
    expect(ops).toMatch(/0.2 0.4 0.6 rg\n\/A2 gs\n55 50 m (.* c ){4}h f/)
    // A placed subtree.
    expect(ops).toMatch(/q\n0.5 0 0 0.5 20 30 cm\n0 0 0 rg\n0 0 10 5 re f\nQ/)
  })

  it('draws rotated text, run colours and underlines', () => {
    const scene = sceneOf(
      text(
        't',
        [{ text: 'Y ' }, { text: 'axis', underline: true, color: { rgb: '#ff0000' } }],
        50,
        80,
        {
          rotate: { angle: -90, cx: 50, cy: 80 },
        },
      ),
    )
    const node = scene.root.children![0]!
    const prim = node.prim as { layout: { runs: { fill?: string }[] } }
    prim.layout.runs[1]!.fill = '#ff0000'
    const ops = streamText(
      [...readPdf(sceneToPdf(scene, fonts, { compress: false })).objects.values()].find(
        (o) => o.stream && /\bBT\b/.test(streamText(o)),
      )!,
    )
    expect(ops).toContain('0 -1 1 0 -30 130 cm')
    expect(ops).toMatch(/0.067 0.133 0.2 rg\n\/F1 12 Tf 1 0 0 -1 50 80 Tm/)
    expect(ops).toMatch(/1 0 0 rg\n\/F1 12 Tf 1 0 0 -1 [\d.]+ 80 Tm/)
    // The underline rect in the text's colour unless the run has its own.
    expect(ops).toMatch(/ET\n0.067 0.133 0.2 rg\n[\d.]+ [\d.]+ [\d.]+ [\d.]+ re f\nQ/)
  })

  it('draws a heat map’s cells and colour scale as filled rectangles (roadmap 30)', () => {
    const scene = graphScene('grouped', 'heatmap.cells')
    const pdf = readPdf(sceneToPdf(scene, fonts, { background: '#ffffff', compress: false }))
    const page = [...pdf.objects.values()].find((o) => o.dict.includes('/Type /Page '))!
    const ops = streamText(deref(pdf, page.dict, 'Contents'))
    // Six cells and 64 bands of the gradient, each a filled rectangle in its own colour, and
    // the gradient's two ends in viridis' end colours.
    const filled = ops.match(/ re f\n/g) ?? []
    expect(filled.length).toBeGreaterThanOrEqual(6 + 64)
    expect(ops).toContain('0.267 0.004 0.329 rg')
    expect(ops).toMatch(/0\.99\d? 0\.9\d* 0\.1\d* rg/)
  })

  it('writes every golden graph type as a readable PDF with its text', async () => {
    for (const [kind, type] of [
      ['xy', 'xy.scatter'],
      ['column', 'column.bar'],
      ['grouped', 'grouped.bar'],
      ['grouped', 'heatmap.cells'],
      ['partsOfWhole', 'whole.pie'],
      ['survival', 'survival.step'],
    ] as const) {
      const scene = graphScene(kind, type)
      const bytes = sceneToPdf(scene, fonts, { background: '#ffffff' })
      readPdf(bytes)
      const read = await pdfjsRead(bytes)
      expect(read.width).toBeCloseTo(scene.width, 2)
      expect(read.height).toBeCloseTo(scene.height, 2)
      for (const f of read.fonts) expect(f.embedded).toBe(true)
      // Every run's text is in the page's text.
      const runs: string[] = []
      const walk = (n: SceneNode) => {
        if (n.prim?.type === 'text') for (const r of n.prim.layout.runs) runs.push(r.text.trim())
        for (const c of n.children ?? []) walk(c)
      }
      walk(scene.root)
      const got = read.items.map((i) => i.str).join('')
      for (const r of runs.filter(Boolean)) expect(got, `${kind} ${type}`).toContain(r)
    }
  })
})
