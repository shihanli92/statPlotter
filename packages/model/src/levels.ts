import type { LevelOrder } from './layers.ts'
import type { DataSetColumn } from './table.ts'

// The levels of a text (categorical) variable of a multiple-variables table (roadmap 34a): the
// distinct values of its cells (trimmed; empty cells have none), in the order they first appear
// (or in natural order, roadmap 34f: `GraphNode.levelOrder`), unless a graph keeps an order of its
// own (`GraphNode.levels`). A graph drawing one category or
// group per level names it by a key made from its text (`levelKey`), so its formats follow the
// level wherever it is drawn.

/** Prefix of a level's series key; column ids are lowercase letters and digits, so never clash. */
const LEVEL_PREFIX = 'lv_'

/**
 * The series key of a level: its text's UTF-8 bytes in hex after `lv_` (a lone surrogate as
 * U+FFFD, as an encoder writes it). Safe as an object key and in element ids (no `/`, never
 * `__proto__`), and the same on every graph and table.
 */
export function levelKey(text: string): string {
  let hex = LEVEL_PREFIX
  const byte = (b: number) => {
    hex += b.toString(16).padStart(2, '0')
  }
  for (const ch of text) {
    let c = ch.codePointAt(0)!
    if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd
    if (c < 0x80) byte(c)
    else if (c < 0x800) {
      byte(0xc0 | (c >> 6))
      byte(0x80 | (c & 63))
    } else if (c < 0x10000) {
      byte(0xe0 | (c >> 12))
      byte(0x80 | ((c >> 6) & 63))
      byte(0x80 | (c & 63))
    } else {
      byte(0xf0 | (c >> 18))
      byte(0x80 | ((c >> 12) & 63))
      byte(0x80 | ((c >> 6) & 63))
      byte(0x80 | (c & 63))
    }
  }
  return hex
}

/** Whether a series key names a level (`levelKey`). */
export const isLevelKey = (key: string): boolean => key.startsWith(LEVEL_PREFIX)

/** The text of a level's key (`levelKey` reversed); null for other keys. */
export function levelOfKey(key: string): string | null {
  if (!isLevelKey(key)) return null
  const hex = key.slice(LEVEL_PREFIX.length)
  if (hex.length % 2 || !/^[0-9a-f]*$/.test(hex)) return null
  try {
    return decodeURIComponent(hex.replace(/../g, (b) => `%${b}`))
  } catch {
    return null
  }
}

/** A text cell's level: its trimmed text, or null when empty. */
export const levelAt = (text: readonly (string | null)[] | undefined, row: number): string | null =>
  text?.[row]?.trim() || null

/**
 * A text variable's levels in the order they first appear in `rows` (default: every row),
 * leaving out excluded cells.
 */
export function levelsInTable(ds: DataSetColumn, rows?: readonly number[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const excluded = ds.subcolumns[0]?.excluded
  const n = ds.text?.length ?? 0
  const take = (r: number) => {
    const t = levelAt(ds.text, r)
    if (t && !excluded?.[r] && !seen.has(t)) {
      seen.add(t)
      out.push(t)
    }
  }
  if (rows) for (const r of rows) take(r)
  else for (let r = 0; r < n; r++) take(r)
  return out
}

/**
 * The levels in a graph's order: those of `stored` that are present, in its order, then the
 * present ones it doesn't list — in table order (`present`'s, the default) or in natural order
 * (`order` 'natural', roadmap 34f) — so new levels go at the end. Levels gone from the table are
 * left out here but stay in the stored order.
 */
export function orderedLevels(
  present: readonly string[],
  stored?: readonly string[],
  order?: LevelOrder,
): string[] {
  const rest = (list: readonly string[]) =>
    order === 'natural' ? [...list].sort(naturalCompare) : [...list]
  if (!stored?.length) return rest(present)
  const here = new Set(present)
  const known = new Set<string>()
  const listed: string[] = []
  for (const t of stored)
    if (here.has(t) && !known.has(t)) {
      known.add(t)
      listed.push(t)
    }
  return [...listed, ...rest(present.filter((t) => !known.has(t)))]
}

// --- Natural order (roadmap 34f) --------------------------------------------------------------

/** A text's runs of ASCII digits and of other characters ("C10a" → "C", "10", "a"). */
const RUNS = /\d+|\D+/g

/** A run of text folded for its first comparison: accents dropped (NFKD), case ignored. */
const fold = (s: string): string =>
  s
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()

/** Code-point order (not UTF-16 units: astral characters after the BMP). */
function codePoints(a: string, b: string): number {
  const ia = a[Symbol.iterator]()
  const ib = b[Symbol.iterator]()
  for (;;) {
    const x = ia.next()
    const y = ib.next()
    if (x.done || y.done) return x.done ? (y.done ? 0 : -1) : 1
    const d = x.value.codePointAt(0)! - y.value.codePointAt(0)!
    if (d) return d < 0 ? -1 : 1
  }
}

/** Two runs of digits by value (any length: no rounding), then fewer leading zeros first. */
function digits(a: string, b: string): number {
  const x = a.replace(/^0+/, '')
  const y = b.replace(/^0+/, '')
  if (x.length !== y.length) return x.length < y.length ? -1 : 1
  if (x !== y) return x < y ? -1 : 1
  return 0
}

/**
 * Natural order of two texts (roadmap 34f): numbers inside the text by value ("C2" < "C10",
 * "2" < "10"), the rest by letter ignoring case and accents ("apple" < "Banana" < "cherry"), digits
 * before letters. Texts equal so far are told apart — fewer leading zeros first ("7" < "07"), then
 * accents and case by code point ("e" < "é", "A" < "a") — so the order is total and the same on
 * every machine (no locale).
 */
export function naturalCompare(a: string, b: string): number {
  if (a === b) return 0
  const ra = a.match(RUNS) ?? []
  const rb = b.match(RUNS) ?? []
  const n = Math.min(ra.length, rb.length)
  const isDigits = (s: string) => s.charCodeAt(0) >= 48 && s.charCodeAt(0) <= 57
  // First: numbers by value, text folded.
  for (let i = 0; i < n; i++) {
    const [x, y] = [ra[i]!, rb[i]!]
    const [dx, dy] = [isDigits(x), isDigits(y)]
    if (dx !== dy) return dx ? -1 : 1
    const c = dx ? digits(x, y) : codePoints(fold(x), fold(y))
    if (c) return c
  }
  if (ra.length !== rb.length) return ra.length < rb.length ? -1 : 1
  // Then: leading zeros, then the texts as written.
  for (let i = 0; i < n; i++) {
    const [x, y] = [ra[i]!, rb[i]!]
    if (isDigits(x) && x.length !== y.length) return x.length < y.length ? -1 : 1
  }
  return codePoints(a, b)
}

/**
 * A new stored order after the user reorders the shown levels: `shown` in its new order, then the
 * stored levels not shown now (gone from the table), kept for when they reappear.
 */
export function storedLevels(shown: readonly string[], stored?: readonly string[]): string[] {
  const here = new Set(shown)
  return [...shown, ...(stored ?? []).filter((t) => !here.has(t))]
}
