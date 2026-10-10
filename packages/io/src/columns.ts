import type { DataTable, LimitFlag, Project, RichText } from '@ps/model'
import { MAX_ENTRY_BYTES } from './zip.ts'

// Large tables in project files (roadmap 34e, decision 404): a table of more than
// `BINARY_TABLE_CELLS` cells keeps its per-row arrays — each subcolumn's values, exclusions and
// limit flags, text variables, row titles and their formatting — in binary entries beside its
// JSON (`tables/<id>/<n>.col`), the JSON naming each one with `{"$col": "<n>"}`. Smaller tables
// stay JSON as before, so ordinary projects still open in older versions. All numbers
// little-endian:
//
//   header   "PSC1" · kind (u8: 1 numbers, 2 flags, 3 text, 4 limit flags, 5 rich text) · 3 zero
//            bytes · n (u32, the table's row count): 12 bytes
//   numbers  null bitmap (⌈n/8⌉ bytes, bit i = row i is empty, least significant bit first),
//            zero padding to a multiple of 8 bytes from the start, n × float64 (empty: 0)
//   flags    bitmap (bit i = true)
//   text     m (u32) · m × (byte length u32 · UTF-8) · code width w (u8: 1, 2 or 4) · zero
//            padding to a multiple of w · n × code (uint w; 0 empty, k the k-th text)
//   limits   as text, each word the side ("<" below, ">" above) then the original text (audit 2
//            M6; before, limit flags stayed JSON arrays, which files still hold and read)
//   rich     as text, each word a row's rich title as JSON (`RichText`; M6 too)

/** Tables with more cells than this store their columns in binary entries. */
export const BINARY_TABLE_CELLS = 100_000

const MAGIC = [0x50, 0x53, 0x43, 0x31] // "PSC1"
const KIND = { numbers: 1, flags: 2, text: 3, limits: 4, rich: 5 } as const
const HEADER = 12

/**
 * Most rows a binary column may have: a column of numbers of more rows wouldn't fit in an entry
 * (`MAX_ENTRY_BYTES`, 8 bytes a row). A count past it (or not the table's) is refused before
 * anything is allocated (audit 2 X7).
 */
export const MAX_COLUMN_ROWS = Math.floor(MAX_ENTRY_BYTES / 8)

/** A reference to a binary entry where a per-row array was. */
export interface ColumnRef {
  $col: string
}

export const isColumnRef = (v: unknown): v is ColumnRef =>
  typeof v === 'object' &&
  v !== null &&
  !Array.isArray(v) &&
  typeof (v as { $col?: unknown }).$col === 'string' &&
  Object.keys(v).length === 1

function header(kind: number, n: number, size: number): { bytes: Uint8Array; view: DataView } {
  const bytes = new Uint8Array(size)
  const view = new DataView(bytes.buffer)
  bytes.set(MAGIC, 0)
  bytes[4] = kind
  view.setUint32(8, n, true)
  return { bytes, view }
}

const align = (at: number, k: number) => Math.ceil(at / k) * k

/** The platform stores numbers little-endian (the file's order): typed arrays read them as is. */
const LITTLE = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1

/** Numbers (null for empty) as a binary column. */
export function encodeNumbers(values: readonly (number | null)[]): Uint8Array {
  const n = values.length
  const bits = Math.ceil(n / 8)
  const at = align(HEADER + bits, 8)
  const { bytes, view } = header(KIND.numbers, n, at + 8 * n)
  // A Float64Array over the data where the platform is little-endian (every one in practice).
  const f64 = LITTLE ? new Float64Array(bytes.buffer, at, n) : null
  for (let i = 0; i < n; i++) {
    const v = values[i]
    if (v === null || v === undefined) bytes[HEADER + (i >> 3)]! |= 1 << (i & 7)
    else if (f64) f64[i] = v
    else view.setFloat64(at + 8 * i, v, true)
  }
  return bytes
}

/** Flags as a binary column. */
export function encodeFlags(flags: readonly boolean[]): Uint8Array {
  const n = flags.length
  const { bytes } = header(KIND.flags, n, HEADER + Math.ceil(n / 8))
  for (let i = 0; i < n; i++) if (flags[i]) bytes[HEADER + (i >> 3)]! |= 1 << (i & 7)
  return bytes
}

/** Text (null for empty) as a dictionary-coded binary column. */
export const encodeText = (text: readonly (string | null)[]): Uint8Array =>
  encodeWords(KIND.text, text)

/** Limit flags (null for none) as a dictionary-coded binary column. */
export const encodeLimits = (flags: readonly (LimitFlag | null)[]): Uint8Array =>
  encodeWords(
    KIND.limits,
    flags.map((f) => (f ? `${f.side === 'below' ? '<' : '>'}${f.text}` : null)),
  )

/** Rich text (null for plain) as a dictionary-coded binary column of its JSON. */
export const encodeRich = (rich: readonly (RichText | null)[]): Uint8Array =>
  encodeWords(
    KIND.rich,
    rich.map((r) => (r ? JSON.stringify(r) : null)),
  )

function encodeWords(kind: number, text: readonly (string | null)[]): Uint8Array {
  const n = text.length
  const dict = new Map<string, number>()
  const codes = new Uint32Array(n)
  for (let i = 0; i < n; i++) {
    const t = text[i]
    if (t === null || t === undefined) continue
    let c = dict.get(t)
    if (c === undefined) {
      c = dict.size + 1
      dict.set(t, c)
    }
    codes[i] = c
  }
  const enc = new TextEncoder()
  const words = [...dict.keys()].map((t) => enc.encode(t))
  const w = dict.size < 0xff ? 1 : dict.size < 0xffff ? 2 : 4
  let size = HEADER + 4
  for (const b of words) size += 4 + b.length
  const codesAt = align(size + 1, w)
  const { bytes, view } = header(kind, n, codesAt + w * n)
  view.setUint32(HEADER, dict.size, true)
  let at = HEADER + 4
  for (const b of words) {
    view.setUint32(at, b.length, true)
    bytes.set(b, at + 4)
    at += 4 + b.length
  }
  bytes[at] = w
  for (let i = 0; i < n; i++) {
    const o = codesAt + w * i
    if (w === 1) bytes[o] = codes[i]!
    else if (w === 2) view.setUint16(o, codes[i]!, true)
    else view.setUint32(o, codes[i]!, true)
  }
  return bytes
}

export class ColumnFormatError extends Error {}

/**
 * A binary column back as the array it was (numbers or null, flags, text or null, limit flags or
 * null, rich text or null). `rowCount`: the table's, which the column's count must be.
 */
export function decodeColumn(
  bytes: Uint8Array,
  rowCount?: number,
): (number | null)[] | boolean[] | (string | null)[] | (LimitFlag | null)[] | (RichText | null)[] {
  if (bytes.length < HEADER || MAGIC.some((m, i) => bytes[i] !== m))
    throw new ColumnFormatError('not a column')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const kind = bytes[4]
  const n = view.getUint32(8, true)
  if (rowCount !== undefined && n !== rowCount)
    throw new ColumnFormatError(`the column has ${n} rows, the table ${rowCount}`)
  if (n > MAX_COLUMN_ROWS) throw new ColumnFormatError(`too many rows (${n})`)
  const need = (k: number) => {
    if (k > bytes.length) throw new ColumnFormatError('column cut short')
  }
  const bit = (i: number) => (bytes[HEADER + (i >> 3)]! >> (i & 7)) & 1
  need(HEADER + Math.ceil(n / 8))
  if (kind === KIND.flags) {
    const out = new Array<boolean>(n)
    for (let i = 0; i < n; i++) out[i] = bit(i) === 1
    return out
  }
  if (kind === KIND.numbers) {
    const at = align(HEADER + Math.ceil(n / 8), 8)
    need(at + 8 * n)
    const out = new Array<number | null>(n)
    const f64 = LITTLE
      ? (bytes.byteOffset + at) % 8 === 0
        ? new Float64Array(bytes.buffer, bytes.byteOffset + at, n)
        : new Float64Array(bytes.slice(at, at + 8 * n).buffer)
      : null
    for (let i = 0; i < n; i++) {
      if (bit(i)) out[i] = null
      else {
        const v = f64 ? f64[i]! : view.getFloat64(at + 8 * i, true)
        if (!Number.isFinite(v)) throw new ColumnFormatError('a cell is not a finite number')
        out[i] = v
      }
    }
    return out
  }
  if (kind === KIND.text || kind === KIND.limits || kind === KIND.rich) {
    need(HEADER + 4)
    const m = view.getUint32(HEADER, true)
    const dec = new TextDecoder('utf-8', { fatal: true })
    const dict: string[] = []
    let at = HEADER + 4
    for (let k = 0; k < m; k++) {
      need(at + 4)
      const len = view.getUint32(at, true)
      need(at + 4 + len)
      dict.push(dec.decode(bytes.subarray(at + 4, at + 4 + len)))
      at += 4 + len
    }
    need(at + 1)
    const w = bytes[at]!
    if (w !== 1 && w !== 2 && w !== 4) throw new ColumnFormatError('bad code width')
    const codesAt = align(at + 1, w)
    need(codesAt + w * n)
    const codes = new Uint32Array(n)
    for (let i = 0; i < n; i++) {
      const o = codesAt + w * i
      const c = w === 1 ? bytes[o]! : w === 2 ? view.getUint16(o, true) : view.getUint32(o, true)
      if (c > m) throw new ColumnFormatError('a code past the dictionary')
      codes[i] = c
    }
    if (kind === KIND.limits) {
      for (const word of dict)
        if (word[0] !== '<' && word[0] !== '>') throw new ColumnFormatError('a bad limit flag')
      const out = new Array<LimitFlag | null>(n)
      for (let i = 0; i < n; i++) {
        const word = codes[i] ? dict[codes[i]! - 1]! : null
        out[i] =
          word === null ? null : { side: word[0] === '<' ? 'below' : 'above', text: word.slice(1) }
      }
      return out
    }
    if (kind === KIND.rich) {
      const out = new Array<RichText | null>(n)
      for (let i = 0; i < n; i++) {
        if (!codes[i]) out[i] = null
        else
          try {
            // Parsed per row: rows don't share objects (as rows read from JSON don't).
            out[i] = JSON.parse(dict[codes[i]! - 1]!) as RichText
          } catch {
            throw new ColumnFormatError('a rich text is not valid JSON')
          }
      }
      return out
    }
    const out = new Array<string | null>(n)
    for (let i = 0; i < n; i++) out[i] = codes[i] ? dict[codes[i]! - 1]! : null
    return out
  }
  throw new ColumnFormatError(`unknown column kind ${kind}`)
}

/** Per-row cells of a table (each array counted). */
export function tableCells(t: DataTable): number {
  let arrays = (t.rowTitles ? 1 : 0) + (t.rowTitlesRich ? 1 : 0)
  for (const c of [...(t.x?.subcolumns ?? []), ...t.dataSets.flatMap((d) => d.subcolumns)])
    arrays += 1 + (c.excluded ? 1 : 0) + (c.limit ? 1 : 0)
  for (const d of t.dataSets) if (d.text) arrays++
  return arrays * t.rowCount
}

/**
 * A large table's JSON with its per-row arrays as references to binary entries (named
 * `<n>.col`, relative to `tables/<id>/`), and those entries; null for a table kept as JSON.
 */
/**
 * Dictionary-coded columns (text, limit flags, rich titles) and flags encoded, per array (the
 * document's arrays are never changed: an edit makes new ones): audit 3, P7 — every autosave
 * coded a million rows' texts again on the main thread. Numbers are encoded each time (a quick
 * loop; kept, they would hold 8 bytes a row more for as long as the table lives). The bytes are
 * shared: never written, and transferred only as copies.
 */
const encoded = new WeakMap<readonly unknown[], Uint8Array>()
const kept = new WeakSet<Uint8Array>()

function once<A extends readonly unknown[]>(a: A, encode: (a: A) => Uint8Array): Uint8Array {
  let bytes = encoded.get(a)
  if (!bytes) {
    bytes = encode(a)
    encoded.set(a, bytes)
    kept.add(bytes)
  }
  return bytes
}

/** Whether `packTable` keeps these bytes for the next packing (to transfer, copy them). */
export const isEncodedOnce = (bytes: Uint8Array): boolean => kept.has(bytes)

/**
 * A large table's JSON with its per-row arrays as binary entries. `numbers`: columns of numbers
 * encoded beforehand (`encodeNumbers`, by array), e.g. a few at a time between other work.
 */
export function packTable(
  t: DataTable,
  numbers?: ReadonlyMap<readonly unknown[], Uint8Array>,
): { json: unknown; columns: Map<string, Uint8Array> } | null {
  if (tableCells(t) <= BINARY_TABLE_CELLS) return null
  const columns = new Map<string, Uint8Array>()
  const ref = (bytes: Uint8Array): ColumnRef => {
    const name = `${columns.size}`
    columns.set(name, bytes)
    return { $col: name }
  }
  const sub = (c: DataTable['dataSets'][number]['subcolumns'][number]) => ({
    ...c,
    values: ref(numbers?.get(c.values) ?? encodeNumbers(c.values)),
    ...(c.excluded ? { excluded: ref(once(c.excluded, encodeFlags)) } : {}),
    ...(c.limit ? { limit: ref(once(c.limit, encodeLimits)) } : {}),
  })
  const json = {
    ...t,
    rowTitles: t.rowTitles ? ref(once(t.rowTitles, encodeText)) : null,
    ...(t.rowTitlesRich ? { rowTitlesRich: ref(once(t.rowTitlesRich, encodeRich)) } : {}),
    x: t.x ? { ...t.x, subcolumns: t.x.subcolumns.map(sub) } : null,
    dataSets: t.dataSets.map((d) => ({
      ...d,
      subcolumns: d.subcolumns.map(sub),
      ...(d.text ? { text: ref(once(d.text, encodeText)) } : {}),
    })),
  }
  return { json, columns }
}

/**
 * A table's JSON (as read) with its column references replaced by the decoded arrays read from
 * `entry(name)`; a reference to a missing or damaged entry throws a `ColumnFormatError`. Only the
 * places `packTable` writes are read; anything else is left for validation to judge.
 */
export function unpackTable(
  json: unknown,
  entry: (name: string) => Uint8Array | undefined,
): unknown {
  const obj = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v)
  if (!obj(json)) return json
  const rows = json.rowCount
  const col = (v: unknown): unknown => {
    if (!isColumnRef(v)) return v
    if (!/^\d+$/.test(v.$col)) throw new ColumnFormatError(`bad column name ${v.$col}`)
    if (typeof rows !== 'number' || !Number.isInteger(rows) || rows < 0 || rows > MAX_COLUMN_ROWS)
      throw new ColumnFormatError(`bad row count ${String(rows)}`)
    const bytes = entry(v.$col)
    if (!bytes) throw new ColumnFormatError(`column ${v.$col} is missing`)
    return decodeColumn(bytes, rows)
  }
  const sub = (c: unknown) =>
    obj(c)
      ? {
          ...c,
          values: col(c.values),
          ...(c.excluded !== undefined ? { excluded: col(c.excluded) } : {}),
          ...(c.limit !== undefined ? { limit: col(c.limit) } : {}),
        }
      : c
  const subs = (o: Record<string, unknown>) =>
    Array.isArray(o.subcolumns) ? { ...o, subcolumns: o.subcolumns.map(sub) } : o
  return {
    ...json,
    rowTitles: col(json.rowTitles),
    ...(json.rowTitlesRich !== undefined ? { rowTitlesRich: col(json.rowTitlesRich) } : {}),
    ...(obj(json.x) ? { x: subs(json.x) } : {}),
    ...(Array.isArray(json.dataSets)
      ? {
          dataSets: json.dataSets.map((d) =>
            obj(d) ? { ...subs(d), ...(d.text !== undefined ? { text: col(d.text) } : {}) } : d,
          ),
        }
      : {}),
  }
}

export type PackedTables = Map<string, { json: unknown; columns: Map<string, Uint8Array> }>

/**
 * The project's large tables packed: their JSON and binary entries by table id (`numbers`: as
 * `packTable`'s).
 */
export function packProject(
  project: Project,
  numbers?: ReadonlyMap<readonly unknown[], Uint8Array>,
): PackedTables {
  const out: PackedTables = new Map()
  for (const node of Object.values(project.nodes))
    if (node.kind === 'table') {
      const packed = packTable(node, numbers)
      if (packed) out.set(node.id, packed)
    }
  return out
}

/** The columns of numbers `packProject` encodes: every subcolumn's values of the large tables. */
export function largeNumberColumns(project: Project): (readonly (number | null)[])[] {
  const out: (readonly (number | null)[])[] = []
  for (const node of Object.values(project.nodes)) {
    if (node.kind !== 'table' || tableCells(node) <= BINARY_TABLE_CELLS) continue
    for (const c of node.x?.subcolumns ?? []) out.push(c.values)
    for (const d of node.dataSets) for (const c of d.subcolumns) out.push(c.values)
  }
  return out
}
