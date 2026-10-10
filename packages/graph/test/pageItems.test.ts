import {
  type AssetId,
  type ImageAsset,
  type LayoutItem,
  type LayoutItemId,
  type LayoutNode,
  type NodeId,
  PAGE_SIZES,
  type RichText,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  arrowSize,
  hitTest,
  layoutPage,
  layoutText,
  lineWithHeads,
  type PageContext,
  type PageTableCell,
  primBounds,
  sceneToSvg,
  tableSlice,
  themeFor,
  wrapText,
} from '../src/index.ts'
import { byId, flatten, fonts, nodes, prim, projectOf } from './helpers.ts'
import { fixtureAsset } from './images.ts'

const id = (s: string) => s as LayoutItemId
const theme = themeFor('default')

function page(items: LayoutItem[], extra: Partial<PageContext> = {}) {
  const layout: LayoutNode = {
    kind: 'layout',
    id: 'p1' as NodeId,
    name: 'Page',
    page: { ...PAGE_SIZES.letter },
    items,
    panelLabels: { show: true, style: 'A', size: 14 },
  }
  return layoutPage({ project: projectOf(layout), layout, fonts, ...extra })
}

const black = { color: { rgb: '#000000' }, width: 1, dash: 'solid' } as const
const style = { ...theme.text }

describe('text items', () => {
  it('lay out as before without a width or box', () => {
    const s = page([
      { type: 'text', id: id('t'), x: 50, y: 60, content: { content: [{ text: 'n = 3' }] } },
    ])
    const t = prim(byId(s, 'item/t'), 'text')
    const l = layoutText(fonts, [{ text: 'n = 3' }], style)
    expect(t.x).toBe(50)
    expect(t.y).toBeCloseTo(60 + l.ascent, 9)
    expect(s.items[0]).toMatchObject({ x: 50, y: 60, w: l.width, type: 'text' })
  })

  it('wrap at word boundaries within their width; long words break by letter', () => {
    const rt: RichText = [
      { text: 'The quick brown fox jumps over ' },
      { text: 'the lazy', bold: true },
      { text: ' dog' },
    ]
    const wrapped = wrapText(fonts, rt, style, 80)
    const lines = wrapped
      .map((r) => r.text)
      .join('')
      .split('\n')
    expect(lines.length).toBeGreaterThan(2)
    for (const line of lines) {
      expect(layoutText(fonts, [{ text: line }], style).width).toBeLessThanOrEqual(80 + 8)
      expect(line.startsWith(' ') || line.endsWith(' ')).toBe(false)
    }
    // Every word kept, the bold run still bold.
    expect(lines.join(' ')).toBe('The quick brown fox jumps over the lazy dog')
    expect(wrapped.some((r) => r.bold && r.text.includes('lazy'))).toBe(true)
    // Typed breaks stay; a word longer than the box is split.
    expect(
      wrapText(fonts, [{ text: 'a\nb' }], style, 500)
        .map((r) => r.text)
        .join(''),
    ).toBe('a\nb')
    const long = wrapText(fonts, [{ text: 'Supercalifragilistic' }], style, 30)
    expect(long[0]!.text.split('\n').length).toBeGreaterThan(2)
  })

  it('with a width, align lines within it; a border and background make a padded box', () => {
    const content = { content: [{ text: 'Short' }], align: 'right' as const }
    const s = page([
      {
        type: 'text',
        id: id('t'),
        x: 100,
        y: 100,
        content,
        width: 200,
        border: black,
        background: { type: 'solid', color: { rgb: '#ffff00' }, opacity: 1 },
        padding: 6,
      },
    ])
    const t = prim(byId(s, 'item/t/text'), 'text')
    expect(t.x + t.layout.width).toBeCloseTo(300, 6)
    const box = prim(byId(s, 'item/t/box'), 'rect')
    expect(box).toMatchObject({ x: 94, y: 94, w: 212, fill: { color: '#ffff00', opacity: 1 } })
    expect(s.items[0]).toMatchObject({ x: 94, y: 94, w: 212 })
    // Default padding with a border only.
    const plain = page([{ type: 'text', id: id('t'), x: 100, y: 100, content, border: black }])
    expect(plain.items[0]!.x).toBe(96)
  })
})

describe('line items and arrowheads', () => {
  it('draw a filled triangle exactly as graph arrows always did', () => {
    const stroke = { color: '#000000', width: 1, dash: 'solid' as const }
    const r = lineWithHeads(0, 0, 100, 0, stroke, { end: { shape: 'triangle' } })
    const { length, half } = arrowSize(1)
    expect(r.line).toEqual({ x1: 0, y1: 0, x2: 100 - length / 2, y2: 0 })
    expect(r.heads).toEqual([
      {
        type: 'polygon',
        points: [
          [100, 0],
          [100 - length, half],
          [100 - length, -half],
        ],
        fill: { color: '#000000', opacity: 1 },
        stroke: null,
      },
    ])
  })

  it('offer open, bar and circle heads at either end, scaled by size', () => {
    const s = page([
      {
        type: 'line',
        id: id('l'),
        from: { x: 100, y: 100 },
        to: { x: 200, y: 200 },
        stroke: { ...black, width: 2 },
        heads: { start: { shape: 'circle', size: 2 }, end: { shape: 'open' } },
      },
      {
        type: 'line',
        id: id('m'),
        from: { x: 300, y: 100 },
        to: { x: 400, y: 100 },
        stroke: black,
        heads: { end: { shape: 'bar' } },
      },
    ])
    expect(nodes(s, 'item/l/').map((n) => n.prim!.type)).toEqual(['line', 'path', 'ellipse'])
    const dot = prim(byId(s, 'item/l/head/1'), 'ellipse')
    expect(dot.rx).toBeCloseTo(arrowSize(2).length * 2 * 0.3, 9)
    expect([dot.cx, dot.cy]).toEqual([100, 100])
    const bar = prim(byId(s, 'item/m/head/0'), 'line')
    expect([bar.x1, bar.x2]).toEqual([400, 400])
    expect(Math.abs(bar.y2 - bar.y1)).toBeCloseTo(2 * arrowSize(1).half, 9)
    // Bounds reach round the heads.
    expect(s.items[0]!.x).toBeLessThan(100 - dot.rx + 0.01)
    // Hit along the line, not beside it.
    expect(hitTest(s.root, 150, 150)?.node.id).toBe('item/l/line')
    expect(hitTest(s.root, 180, 120)).toBeNull()
  })
})

describe('shape items', () => {
  it('are rectangles (corners rounded, radius clamped) or ellipses filling their box', () => {
    const s = page([
      {
        type: 'shape',
        id: id('r'),
        shape: 'rect',
        x: 10,
        y: 20,
        w: 100,
        h: 40,
        radius: 50,
        stroke: black,
        fill: { type: 'solid', color: { palette: 1 }, opacity: 0.5 },
      },
      { type: 'shape', id: id('e'), shape: 'ellipse', x: 200, y: 20, w: 100, h: 40, stroke: black },
    ])
    const r = prim(byId(s, 'item/r'), 'rect')
    expect(r.rx).toBe(20)
    expect(r.fill).toEqual({ color: theme.palette[1], opacity: 0.5 })
    const e = prim(byId(s, 'item/e'), 'ellipse')
    expect(e).toMatchObject({ cx: 250, cy: 40, rx: 50, ry: 20, fill: null })
    expect(primBounds(e)).toEqual({ x: 200, y: 20, w: 100, h: 40 })
    // An unfilled ellipse is hit on its outline only.
    expect(hitTest(s.root, 250, 40)).toBeNull()
    expect(hitTest(s.root, 300, 40)?.node.id).toBe('item/e')
    expect(hitTest(s.root, 50, 40)?.node.id).toBe('item/r')
    const svg = sceneToSvg(s)
    expect(svg).toContain('<rect x="10" y="20" width="100" height="40" rx="20"')
    expect(svg).toContain('<ellipse cx="250" cy="40" rx="50" ry="20" fill="none"')
  })
})

describe('image items', () => {
  const asset = fixtureAsset('rgba.png')
  const lookup = (a: AssetId): ImageAsset | undefined => (a === asset.id ? asset : undefined)
  const item = (crop?: { x: number; y: number; w: number; h: number }): LayoutItem => ({
    type: 'image',
    id: id('i'),
    asset: asset.id,
    x: 50,
    y: 60,
    w: 120,
    h: 70,
    ...(crop ? { crop } : {}),
    border: black,
  })

  it('stretch the picture (or its crop) over the box, with a border', () => {
    const s = page([item({ x: 0.25, y: 0, w: 0.5, h: 1 })], { asset: lookup })
    const img = prim(byId(s, 'item/i/image'), 'image')
    expect(img).toMatchObject({ x: 50, y: 60, w: 120, h: 70, crop: { x: 0.25, w: 0.5 } })
    expect(img.asset).toBe(asset)
    prim(byId(s, 'item/i/border'), 'rect')
    const svg = sceneToSvg(s)
    expect(svg).toContain(
      '<svg xmlns:xlink="http://www.w3.org/1999/xlink" x="50" y="60" width="120" height="70" viewBox="3 0 6 7" preserveAspectRatio="none" overflow="hidden"><image width="12" height="7" preserveAspectRatio="none" xlink:href="data:image/png;base64,',
    )
    expect(hitTest(s.root, 100, 100)?.node.id).toBe('item/i/image')
  })

  it('show a placeholder and a warning when the picture is missing', () => {
    const s = page([item()])
    expect(byId(s, 'item/i/image')).toBeUndefined()
    expect(prim(byId(s, 'item/i/box'), 'rect').stroke?.dash).toBe('dash')
    expect(prim(byId(s, 'item/i/note'), 'text').layout.runs[0]!.text).toBe('Missing image')
    expect(s.warnings).toContain('An image on this page is missing from the project.')
    expect(s.items[0]).toMatchObject({ x: 50, y: 60, w: 120, h: 70 })
  })
})

describe('table items', () => {
  const cell = (text: string, extra: Partial<PageTableCell> = {}): PageTableCell => ({
    text,
    ...extra,
  })
  const rows: PageTableCell[][] = [
    [cell('Descriptive statistics', { style: 'title' })],
    [cell(''), cell('Control', { style: 'header' }), cell('Treated', { style: 'header' })],
    [cell('Mean'), cell('43.48', { numeric: true }), cell('56.28', { numeric: true })],
    [cell('SD'), cell('3.831', { numeric: true }), cell('9.15', { numeric: true })],
    [cell('N'), cell('10', { numeric: true }), cell('10', { numeric: true })],
  ]

  it('keep header rows and slice the body by row and column ranges', () => {
    expect(tableSlice(rows, {}).length).toBe(5)
    const s = tableSlice(rows, { rows: { from: 1, to: 1 }, columns: { from: 0, to: 1 } })
    expect(s.map((r) => r.map((c) => c.text))).toEqual([
      ['Descriptive statistics'],
      ['', 'Control'],
      ['SD', '3.831'],
    ])
  })

  it('lay out columns to their widest cell, numbers right-aligned, headers bold, a grid', () => {
    const item: LayoutItem = {
      type: 'table',
      id: id('tb'),
      x: 40,
      y: 50,
      source: { kind: 'table', node: 'x' as NodeId },
    }
    const s = page([item], { table: () => ({ rows }) })
    const mean = prim(byId(s, 'item/tb/cell/2/1'), 'text')
    const sd = prim(byId(s, 'item/tb/cell/3/1'), 'text')
    // Right edges line up.
    expect(mean.x + mean.layout.width).toBeCloseTo(sd.x + sd.layout.width, 6)
    expect(prim(byId(s, 'item/tb/cell/1/1'), 'text').layout.runs[0]!.bold).toBe(true)
    expect(prim(byId(s, 'item/tb/cell/2/0'), 'text').layout.runs[0]!.bold).toBe(false)
    const grid = nodes(s, 'item/tb/grid/')
    // Six horizontal lines (5 rows) and four vertical (3 columns).
    expect(grid.length).toBe(10)
    const box = s.items[0]!
    expect(box).toMatchObject({ x: 40, y: 50, type: 'table' })
    // The title spans the row: the first column is as wide as its other cells need.
    const first = prim(grid[6], 'line')
    const second = prim(grid[7], 'line')
    expect(second.x1 - first.x1).toBeLessThan(40)
    const rowsOnly = page([{ ...item, grid: 'rows', headerBold: false, text: { size: 12 } }], {
      table: () => ({ rows }),
    })
    expect(nodes(rowsOnly, 'item/tb/grid/').length).toBe(6)
    expect(prim(byId(rowsOnly, 'item/tb/cell/1/1'), 'text').layout.runs[0]).toMatchObject({
      bold: false,
      size: 12,
    })
  })

  it('show why when there is nothing to draw', () => {
    const item: LayoutItem = {
      type: 'table',
      id: id('tb'),
      x: 40,
      y: 50,
      source: { kind: 'results', node: 'x' as NodeId, sheet: 's' },
    }
    const s = page([item], { table: () => ({ error: 'not computed yet' }) })
    expect(prim(byId(s, 'item/tb/note'), 'text').layout.runs[0]!.text).toBe('not computed yet')
    expect(s.warnings).toContain('A table on this page: not computed yet')
    expect(flatten(page([item]).root).some((n) => n.id === 'item/tb/note')).toBe(true)
  })
})
