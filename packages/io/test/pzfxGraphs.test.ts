import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GraphNode } from '@ps/model'
import { zlibSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import {
  decodePrismGraphs,
  graphFromPrism,
  inflateTemplate,
  MAX_TEMPLATE_BYTES,
  PcffError,
  type PrismGraph,
  pairTables,
  readPcff,
  readPzfx,
} from '../src/index.ts'

// Roadmap 39: the binary section of .pzfx files. The Prism-made fixtures (from the pzfx R
// package) each hold one table and its graph; the synthetic blocks below exercise the record
// reader and the decoder's structure on data built here (no user's file is used).

const DIR = join(import.meta.dirname, 'fixtures', 'pzfx')
const fixture = (f: string) => readFileSync(join(DIR, f), 'utf8')

// --- A tiny writer of the record format -----------------------------------------------------

type Rec = { tag: number; payload?: Uint8Array; children?: Rec[] }

function u16(...v: number[]) {
  const b = new Uint8Array(v.length * 2)
  const d = new DataView(b.buffer)
  for (const [i, x] of v.entries()) d.setUint16(i * 2, x, true)
  return b
}
function u32(...v: number[]) {
  const b = new Uint8Array(v.length * 4)
  const d = new DataView(b.buffer)
  for (const [i, x] of v.entries()) d.setUint32(i * 4, x, true)
  return b
}
function f64(...v: number[]) {
  const b = new Uint8Array(v.length * 8)
  const d = new DataView(b.buffer)
  for (const [i, x] of v.entries()) d.setFloat64(i * 8, x, true)
  return b
}
const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}
const pad = (b: Uint8Array, n: number) => cat(b, new Uint8Array(Math.max(0, n - b.length)))
const str = (s: string) => cat(new TextEncoder().encode(s), new Uint8Array([0]))
const at = (n: number, ...parts: [number, Uint8Array][]) => {
  const b = new Uint8Array(n)
  for (const [o, p] of parts) b.set(p, o)
  return b
}

function write(r: Rec): Uint8Array {
  const payload = r.payload ?? new Uint8Array()
  const container = r.children !== undefined
  const head = cat(u16(r.tag | (container ? 0x8000 : 0)), u32(payload.length), payload)
  if (!container) return head
  return cat(head, ...r.children!.map(write), u16(r.tag | 0x4000))
}
const block = (...recs: Rec[]) => cat(new TextEncoder().encode('PCFFGRA4'), ...recs.map(write))

const named = (tag: number, name: string, payload: Uint8Array, children: Rec[] = []): Rec => ({
  tag,
  payload,
  children: [{ tag: 0x09, payload: str(name) }, ...children],
})
const column = (id: number, title: string) => named(0x0f, title, pad(u32(id), 60))
const text = (id: number, s: string, hidden = false): Rec => ({
  tag: 0x20,
  payload: at(30, [28, u16(hidden ? 0x0332 : 0x0130)]),
  children: [{ tag: 0x2b, payload: pad(u16(id), 18), children: [{ tag: 0x2c, payload: str(s) }] }],
})
const axis = (min: number, max: number, title: number) =>
  ({ tag: 0x17, payload: at(60, [16, f64(min, max)], [48, u16(title)]) }) as Rec
const rgba = (r: number, g: number, b: number, a = 0) => new Uint8Array([r, g, b, a])
const plot = (ds: number, col: number, symbol: number, colors: Uint8Array[]): Rec => ({
  tag: 0x20,
  payload: at(30, [28, u16(0x30)]),
  children: [
    {
      tag: 0x28,
      payload: at(144, [0, u16(ds, 1, col, 1)], [60, u16(symbol)], [68, cat(...colors)]),
      children: [],
    },
  ],
})

/** One XY table (row titles, X, two Y) and a graph of it, as Prism lays them out. */
function synthetic(opts: { hiddenTitle?: boolean; family?: number } = {}) {
  const table = named(0x08, 'Growth', u16(0), [
    column(0, ''),
    column(1, 'Time'),
    column(2, 'Control'),
    column(3, 'Treated'),
  ])
  const same = (c: Uint8Array) => [c, c, c, c, c, c]
  const graph = named(0x12, 'Growth graph', u16(0), [
    { tag: 0x13, payload: at(48, [14, u16(opts.family ?? 0)], [32, u16(7)]) },
    { tag: 0x15, payload: u32(2, 1, 0) },
    axis(0, 10, 4),
    axis(-50, 150, 5),
    axis(0, 100, 6),
    {
      tag: 0x18,
      payload: new Uint8Array(12),
      children: [
        plot(0, 2, 5, same(rgba(0xff, 0x00, 0x66))),
        plot(1, 3, 1, [rgba(0, 0, 0), rgba(0xa0, 0xa0, 0xa4), ...same(rgba(0, 0, 0)).slice(2)]),
        text(7, 'Growth curves', opts.hiddenTitle),
        text(4, 'Hours'),
        text(5, 'OD 600'),
        text(6, 'Y1Title', true),
      ],
    },
  ])
  return block({ tag: 0x01, payload: new Uint8Array(12), children: [table, graph] })
}

describe('record reader (roadmap 39)', () => {
  it('reads tags, lengths and nested containers', () => {
    const root = readPcff(
      block({
        tag: 0x01,
        children: [
          { tag: 0x05, payload: u16(7) },
          { tag: 0x06, children: [] },
        ],
      }),
    )
    expect(root.children).toHaveLength(1)
    const doc = root.children[0]!
    expect(doc.tag).toBe(1)
    expect(doc.children.map((c) => c.tag)).toEqual([5, 6])
    expect([...doc.children[0]!.payload]).toEqual([7, 0])
  })

  it('closes containers left open at the end, and ignores unmatched end markers', () => {
    const bytes = cat(
      new TextEncoder().encode('PCFFGRA4'),
      u16(0x8001),
      u32(0),
      u16(0x4009), // no 0x09 container is open
      u16(0x0002),
      u32(1),
      new Uint8Array([9]),
    )
    const root = readPcff(bytes)
    expect(root.children[0]!.children.map((c) => c.tag)).toEqual([2])
  })

  it('refuses a wrong header and lengths past the end', () => {
    expect(() => readPcff(new TextEncoder().encode('NOTPRISM'))).toThrow(PcffError)
    const cut = cat(new TextEncoder().encode('PCFFGRA4'), u16(0x0002), u32(100), u16(1))
    expect(() => readPcff(cut)).toThrow(/past the end/)
  })

  it('inflates a template’s base64 text, and answers null for anything else', () => {
    const raw = synthetic()
    const b64 = Buffer.from(zlibSync(raw)).toString('base64')
    expect(inflateTemplate(`${b64.slice(0, 20)}\n  ${b64.slice(20)}`)).toEqual(raw)
    expect(inflateTemplate('not base64 !')).toBeNull()
  })

  // Audit 2 X2: a zlib bomb in `<Template>` inflated without a limit on the main thread.
  it('stops inflating past the cap and answers null (a bomb)', () => {
    const b64 = (raw: Uint8Array) => Buffer.from(zlibSync(raw, { level: 9 })).toString('base64')
    const zeros = (n: number) => new Uint8Array(n)
    expect(inflateTemplate(b64(zeros(1000)), 1000)).toHaveLength(1000)
    expect(inflateTemplate(b64(zeros(1001)), 1000)).toBeNull()
    expect(inflateTemplate(b64(zeros(3_000_000)), 1_000_000)).toBeNull()
    // Past the default cap (64 MB): a few dozen KB of base64 that would inflate to 65 MB.
    const bomb = b64(zeros(MAX_TEMPLATE_BYTES + 1024 * 1024))
    expect(bomb.length).toBeLessThan(200_000)
    expect(inflateTemplate(bomb)).toBeNull()
    // Cut-off data is refused too.
    expect(inflateTemplate(b64(synthetic()).slice(0, 24))).toBeNull()
  })
})

describe('Prism graph decoder (roadmap 39)', () => {
  it('reads tables, data sets, titles, ranges, colours and symbols from synthetic records', () => {
    const d = decodePrismGraphs(synthetic())
    expect(d.tables).toEqual([
      {
        name: 'Growth',
        columns: [
          { id: 0, title: '' },
          { id: 1, title: 'Time' },
          { id: 2, title: 'Control' },
          { id: 3, title: 'Treated' },
        ],
      },
    ])
    const g = d.graphs[0]!
    expect(g.name).toBe('Growth graph')
    expect(g.xNumeric).toBe(true)
    expect(g.title).toEqual({ text: 'Growth curves', hidden: false })
    expect(g.x).toEqual({ min: 0, max: 10, title: { text: 'Hours', hidden: false } })
    expect(g.y).toEqual({ min: -50, max: 150, title: { text: 'OD 600', hidden: false } })
    // Prism's order (data set 1 first), each with its table column.
    expect(g.dataSets).toEqual([
      { table: 0, column: 3, shape: 'square', color: '#a0a0a4' },
      { table: 0, column: 2, shape: 'circle', color: '#ff0066' },
    ])
  })

  it('reads hidden titles and categorical X', () => {
    const g = decodePrismGraphs(synthetic({ hiddenTitle: true, family: 1 })).graphs[0]!
    expect(g.title?.hidden).toBe(true)
    expect(g.xNumeric).toBe(false)
  })

  it('decodes the Prism-made fixtures: one graph of the table, Prism’s default titles', () => {
    for (const [file, sets, xNumeric] of [
      ['column.pzfx', 2, false],
      ['x_y_rep.pzfx', 3, true],
      ['exponential_decay.pzfx', 2, true],
    ] as const) {
      const { graphs } = readPzfx(fixture(file), { graphs: true })
      expect(graphs?.found, file).toBe(1)
      expect(graphs?.decoded, file).toBe(1)
      expect(graphs?.report[0]?.status, file).toBe('decoded')
      const g = graphs!.graphs[0]!.graph
      expect(GraphNode.safeParse(g).success).toBe(true)
      expect(graphs!.report[0]!.matched).toContain(`data sets (${sets})`)
      expect(g.axes.x.type === 'continuous').toBe(xNumeric)
    }
    // The XY fixture's titles: Prism's defaults where the user typed none.
    const xy = readPzfx(fixture('x_y_rep.pzfx'), { graphs: true }).graphs!.graphs[0]!.graph
    expect(xy.axes.x.title?.content).toEqual([{ text: 'XX' }])
    expect(xy.axes.y.title?.content).toEqual([{ text: 'YTitle' }])
    expect(xy.axes.y.type === 'continuous' && xy.axes.y.range).toEqual({ min: -50, max: 150 })
  })

  it('leaves graphs of analyses’ results out, and reports why', () => {
    // survival.pzfx: the graph draws the survival analysis' result table.
    const { graphs } = readPzfx(fixture('survival.pzfx'), { graphs: true })
    expect(graphs?.found).toBe(1)
    expect(graphs?.graphs).toEqual([])
    expect(graphs?.report[0]?.status).toBe('skipped')
  })

  it('keeps the table import unchanged and reads no graphs unless asked', () => {
    const plain = readPzfx(fixture('x_y_rep.pzfx'))
    const asked = readPzfx(fixture('x_y_rep.pzfx'), { graphs: true })
    expect(plain.graphs).toBeUndefined()
    const strip = (t: (typeof plain.tables)[number]) => ({ ...t, id: '', dataSets: [] })
    expect(asked.tables.map(strip)).toEqual(plain.tables.map(strip))
    expect(asked.warnings).toEqual(plain.warnings)
  })

  it('falls back to default graphs per table when the graph section can’t be read', () => {
    const xml = fixture('x_y_rep.pzfx').replace(
      /(<Template[^>]*>)[\s\S]*?(<\/Template>)/,
      '$1AAAA$2',
    )
    const { graphs, tables } = readPzfx(xml, { graphs: true })
    expect(graphs?.problem).toMatch(/could not be read/)
    expect(graphs?.graphs).toHaveLength(tables.length)
    expect(graphs?.report.every((r) => r.status === 'default')).toBe(true)
  })

  // Audit 2 X2 (step 2, X14): a bomb in the file itself imports as any unreadable section does.
  it('a graph section inflating past the cap gives default graphs, the tables as before', () => {
    const bomb = Buffer.from(
      zlibSync(new Uint8Array(MAX_TEMPLATE_BYTES + 1024 * 1024), { level: 9 }),
    ).toString('base64')
    const xml = fixture('x_y_rep.pzfx').replace(
      /(<Template[^>]*>)[\s\S]*?(<\/Template>)/,
      `$1${bomb}$2`,
    )
    const { graphs, tables } = readPzfx(xml, { graphs: true })
    expect(graphs?.problem).toMatch(/could not be read/)
    expect(graphs?.graphs).toHaveLength(tables.length)
    const strip = (t: (typeof tables)[number]) => ({ ...t, id: '', dataSets: [] })
    expect(tables.map(strip)).toEqual(readPzfx(fixture('x_y_rep.pzfx')).tables.map(strip))
  })

  it('pairs binary tables with the XML’s by name and columns; results tables stay unpaired', () => {
    const pairs = pairTables(
      [
        {
          name: 'A',
          columns: [
            { id: 0, title: '' },
            { id: 1, title: 'y' },
          ],
        },
        { name: 'Results', columns: [{ id: 2, title: '' }] },
        {
          name: 'A',
          columns: [
            { id: 3, title: '' },
            { id: 4, title: 'z' },
          ],
        },
      ],
      [
        { title: 'A', yTitles: ['z'] },
        { title: 'A', yTitles: ['y'] },
      ],
    )
    expect(pairs).toEqual([1, null, 0])
  })
})

describe('Prism graphs as native graphs (roadmap 39)', () => {
  const table = () => {
    const { tables } = readPzfx(fixture('x_y_rep.pzfx'))
    return tables[0]!
  }
  const info = {
    name: 'Data 1',
    columns: [
      { id: 0, title: '' },
      { id: 1, title: 'XX' },
      { id: 2, title: 'Ya' },
      { id: 3, title: 'Yb' },
      { id: 4, title: 'Yc' },
    ],
  }
  const prism = (over: Partial<PrismGraph> = {}): PrismGraph => ({
    name: 'Mine',
    xNumeric: true,
    dataSets: [
      { table: 0, column: 4, shape: 'triangle', color: '#107f80' },
      { table: 0, column: 2, shape: 'circle', color: '#000000' },
    ],
    title: { text: 'A title', hidden: false },
    x: { min: 0, max: 4, title: { text: 'Dose', hidden: false } },
    y: { min: 0, max: 200, title: { text: 'Signal', hidden: true } },
    ...over,
  })

  it('draws the table’s default graph with Prism’s data sets, titles, ranges, colours, symbols', () => {
    const t = table()
    const built = graphFromPrism(prism(), t, info)!
    const g = built.graph
    expect(g.name).toBe('Mine')
    expect(g.seriesSource.include).toEqual([t.dataSets[2]!.id, t.dataSets[0]!.id])
    expect(g.title?.content).toEqual([{ text: 'A title' }])
    expect(g.axes.x.title?.content).toEqual([{ text: 'Dose' }])
    expect(g.axes.y.title).toBeNull()
    expect(g.axes.x.type === 'continuous' && g.axes.x.range).toEqual({ min: 0, max: 4 })
    expect(g.axes.y.type === 'continuous' && g.axes.y.range).toEqual({ min: 0, max: 200 })
    expect(g.seriesOverrides[t.dataSets[2]!.id]?.color).toEqual({ rgb: '#107f80' })
    const points = g.layers.find((l) => l.geom === 'points')!
    expect(points.series?.[t.dataSets[2]!.id]?.style).toEqual({ shape: 'triangle' })
    expect(built.matched).toEqual([
      'data sets (2, in Prism’s order)',
      'title',
      'X axis title',
      'Y axis title (hidden)',
      'Y axis range 0 to 200',
      'X axis range 0 to 4',
      'colours',
      'symbols',
    ])
    expect(built.defaulted[0]).toMatch(/kind of graph/)
  })

  it('keeps X numeric (and its automatic range) when Prism drew X as categories, and says so', () => {
    const built = graphFromPrism(prism({ xNumeric: false }), table(), info)!
    const x = built.graph.axes.x
    expect(x.type === 'continuous' && x.range).toBe('auto')
    expect(built.defaulted[0]).toMatch(/X as categories/)
  })

  it('answers null when none of the data sets is the table’s', () => {
    expect(graphFromPrism(prism({ dataSets: [{ table: 0, column: 9 }] }), table(), info)).toBeNull()
  })
})
