/**
 * Prism graphs from a .pzfx file's binary section (roadmap 39, decisions 570–573): what decodes
 * reliably — each graph's name, its data sets (which table and column, in Prism's order), the
 * graph and axis titles and whether they are shown, the axes' ranges, whether X is numeric, and
 * each data set's symbol and colour. Field by field with its evidence in
 * docs/design/PZFX_GRAPHS.md; anything else (the kind of marks, error bars, log scales, fonts) is
 * not read, and the importer says so.
 */
import type { SymbolShape } from '@ps/model'
import { childOf, childrenOf, descendantsOf, fields, type PcffRecord, readPcff } from './pcff.ts'

/** Record names (the tag's low 14 bits) this decoder reads. */
export const PCFF = {
  document: 0x0001,
  table: 0x0008,
  name: 0x0009,
  column: 0x000f,
  graph: 0x0012,
  graphHeader: 0x0013,
  dataSetOrder: 0x0015,
  axis: 0x0017,
  object: 0x0020,
  plot: 0x0028,
  text: 0x002b,
  textString: 0x002c,
  layout: 0x0035,
} as const

/** A table of the binary section: its name and columns (row titles first, then X, then Y). */
export interface PrismTableInfo {
  name: string
  /** Column ids (unique in the file) and titles, in table order. */
  columns: { id: number; title: string }[]
}

export interface PrismText {
  text: string
  /** Hidden in Prism (an object flag). */
  hidden: boolean
}

export interface PrismAxis {
  /** The axis' range as Prism last drew it. */
  min: number
  max: number
  /** Its title; null when the axis names none. */
  title: PrismText | null
}

export interface PrismDataSet {
  /** The binary table (index into `PrismGraphs.tables`) and column (index into its columns). */
  table: number
  column: number
  /** Symbol: only Prism's codes seen with certainty (circle, square, triangle). */
  shape?: SymbolShape
  /** `#rrggbb`: the data set's single colour, or its fill when its parts differ. */
  color?: string
}

export interface PrismGraph {
  name: string
  /** A continuous X axis (XY family); false: categories along X (column, grouped…). */
  xNumeric: boolean
  /** Data sets in Prism's order. */
  dataSets: PrismDataSet[]
  title: PrismText | null
  x: PrismAxis | null
  y: PrismAxis | null
}

export interface PrismGraphs {
  tables: PrismTableInfo[]
  graphs: PrismGraph[]
  /** Layouts in the file (not imported). */
  layouts: number
}

// --- Field positions (offsets in the payload; see PZFX_GRAPHS.md) --------------------------

/** 0x0013: u16 graph family (0: XY, numeric X) and u16 id of the title text. */
const GRAPH_FAMILY = 14
const GRAPH_TITLE_TEXT = 32
/** 0x0017: f64 range min and max, u16 id of the title text (0xffff: none). */
const AXIS_MIN = 16
const AXIS_MAX = 24
const AXIS_TITLE_TEXT = 48
/** 0x0020: u16 flags; 0x0200 hides the object. */
const OBJECT_FLAGS = 28
const HIDDEN = 0x0200
/** 0x0028: u16 data set id, u16 column id, u16 symbol code, six RGBA colours. */
const PLOT_DATA_SET = 0
const PLOT_COLUMN = 4
const PLOT_SYMBOL = 60
const PLOT_COLORS = 68
const NO_COLOR = 0xff

/** Prism's symbol codes for its first three data sets' defaults (A, B, C). */
const SYMBOLS: Record<number, SymbolShape> = { 5: 'circle', 1: 'square', 2: 'triangle' }

const latin1 = (bytes: Uint8Array) => String.fromCharCode(...bytes)

/** Record text: up to the first NUL; UTF-8 when it is valid, else Windows-1252. */
export function pcffString(payload: Uint8Array): string {
  const end = payload.indexOf(0)
  const bytes = end < 0 ? payload : payload.subarray(0, end)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    try {
      return new TextDecoder('windows-1252').decode(bytes)
    } catch {
      return latin1(bytes)
    }
  }
}

const nameOf = (rec: PcffRecord) => {
  const n = childOf(rec, PCFF.name)
  return n ? pcffString(n.payload) : ''
}

const hex2 = (n: number) => n.toString(16).padStart(2, '0')

function readTables(doc: PcffRecord): PrismTableInfo[] {
  return childrenOf(doc, PCFF.table).map((t) => ({
    name: nameOf(t),
    columns: childrenOf(t, PCFF.column).map((c) => ({
      id: fields(c.payload).u32(0) ?? -1,
      title: nameOf(c),
    })),
  }))
}

/** Text records of a graph by id, with the hidden flag of the object holding each. */
function textsOf(graph: PcffRecord): Map<number, PrismText> {
  const out = new Map<number, PrismText>()
  for (const obj of descendantsOf(graph, PCFF.object)) {
    const hidden = ((fields(obj.payload).u16(OBJECT_FLAGS) ?? 0) & HIDDEN) !== 0
    for (const t of childrenOf(obj, PCFF.text)) {
      const id = fields(t.payload).u16(0)
      const s = childOf(t, PCFF.textString)
      if (id === undefined || !s || out.has(id)) continue
      out.set(id, { text: pcffString(s.payload), hidden })
    }
  }
  return out
}

function colorOf(payload: Uint8Array): string | undefined {
  const f = fields(payload)
  const slots: string[] = []
  for (let k = 0; k < 6; k++) {
    const b = f.bytes(PLOT_COLORS + 4 * k, 4)
    if (!b) return undefined
    slots.push(b[3] === NO_COLOR ? '' : `#${hex2(b[0]!)}${hex2(b[1]!)}${hex2(b[2]!)}`)
  }
  const used = new Set(slots.filter((s) => s))
  if (used.size === 1) return [...used][0]
  // Prism's defaults: a border colour (slot 0) and a fill (slot 1); the fill tells sets apart.
  return slots[1] || slots[0] || undefined
}

function readGraph(
  g: PcffRecord,
  columns: Map<number, { table: number; column: number }>,
): PrismGraph {
  const head = fields(childOf(g, PCFF.graphHeader)?.payload ?? new Uint8Array())
  const texts = textsOf(g)
  const axes = childrenOf(g, PCFF.axis).map((a): PrismAxis | null => {
    const f = fields(a.payload)
    const min = f.f64(AXIS_MIN)
    const max = f.f64(AXIS_MAX)
    if (min === undefined || max === undefined || !Number.isFinite(min) || !Number.isFinite(max))
      return null
    if (!(min < max)) return null
    const titleId = f.u16(AXIS_TITLE_TEXT)
    return { min, max, title: titleId === undefined ? null : (texts.get(titleId) ?? null) }
  })
  const titleId = head.u16(GRAPH_TITLE_TEXT)

  // Data sets: the plot records (one per data set, by id), in the order record's order.
  const plots = new Map<number, PcffRecord>()
  for (const p of descendantsOf(g, PCFF.plot)) {
    const id = fields(p.payload).u16(PLOT_DATA_SET)
    if (id !== undefined && !plots.has(id)) plots.set(id, p)
  }
  const order: number[] = []
  const ord = childOf(g, PCFF.dataSetOrder)
  if (ord) {
    const f = fields(ord.payload)
    const n = f.u32(0) ?? 0
    for (let k = 0; k < n; k++) {
      const id = f.u32(4 + 4 * k)
      if (id === undefined) break
      order.push(id)
    }
  }
  for (const id of plots.keys()) if (!order.includes(id)) order.push(id)
  const dataSets: PrismDataSet[] = []
  for (const id of order) {
    const p = plots.get(id)
    if (!p) continue
    const f = fields(p.payload)
    const where = columns.get(f.u16(PLOT_COLUMN) ?? -1)
    if (!where) continue
    const shape = SYMBOLS[f.u16(PLOT_SYMBOL) ?? -1]
    const color = colorOf(p.payload)
    dataSets.push({ ...where, ...(shape ? { shape } : {}), ...(color ? { color } : {}) })
  }
  return {
    name: nameOf(g),
    xNumeric: head.u16(GRAPH_FAMILY) === 0,
    dataSets,
    title: titleId === undefined ? null : (texts.get(titleId) ?? null),
    x: axes[0] ?? null,
    y: axes[1] ?? null,
  }
}

/** Decodes an inflated graph block (`inflateTemplate`). Throws `PcffError` when unreadable. */
export function decodePrismGraphs(block: Uint8Array): PrismGraphs {
  const root = readPcff(block)
  const doc = root.children.find((c) => c.tag === PCFF.document) ?? root
  const tables = readTables(doc)
  const columns = new Map<number, { table: number; column: number }>()
  tables.forEach((t, ti) => {
    t.columns.forEach((c, ci) => {
      if (!columns.has(c.id)) columns.set(c.id, { table: ti, column: ci })
    })
  })
  return {
    tables,
    graphs: childrenOf(doc, PCFF.graph).map((g) => readGraph(g, columns)),
    layouts: childrenOf(doc, PCFF.layout).length,
  }
}
