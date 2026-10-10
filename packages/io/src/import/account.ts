import { columnLetters } from '@ps/model'
import { asNumber, clean } from './cells.ts'
import type { Sheet, SheetCell } from './sheet.ts'

/**
 * Where every number in the part of a sheet a table came from went: into the table (values, X),
 * into its titles, or nowhere. The numbers left out are what a misread layout loses, so they are
 * reported by position, without judging what they are.
 */
export interface ImportAccount {
  /** Numbers read into the table as values or X. */
  values: number
  /** Numbers left out, `[row, column]` (0-based). */
  leftOut: [number, number][]
  /** The left-out numbers grouped by position: "row 14 “P value”", "columns F–G “Test”". */
  groups: { where: string; count: number }[]
}

export type Area = { r0: number; c0: number; r1: number; c1: number }

/** Cells a table was built from; see `CellUse.value` / `CellUse.label`. */
export class CellUse {
  private readonly width: number
  private readonly used = new Map<number, 'value' | 'label'>()
  constructor(sheet: Sheet) {
    this.width = sheet.rows[0]?.length ?? 0
  }
  /** A cell read as a value (or X). */
  value(r: number, c: number) {
    this.used.set(r * this.width + c, 'value')
  }
  /** A cell read as a title (data set, row, header). */
  label(r: number, c: number) {
    if (!this.used.has(r * this.width + c)) this.used.set(r * this.width + c, 'label')
  }
  get(r: number, c: number) {
    return this.used.get(r * this.width + c)
  }
}

const text = (v: SheetCell | undefined) => (typeof v === 'string' ? clean(v) : '')
const quote = (s: string) => (s.length > 30 ? `“${s.slice(0, 30)}…”` : `“${s}”`)

/** Accounts for the numbers in `area`. */
export function accountFor(sheet: Sheet, area: Area, use: CellUse): ImportAccount {
  const R = sheet.rows
  const r1 = Math.min(area.r1, R.length - 1)
  const c1 = Math.min(area.c1, (R[0]?.length ?? 0) - 1)
  let values = 0
  const leftOut: [number, number][] = []
  for (let r = Math.max(0, area.r0); r <= r1; r++)
    for (let c = Math.max(0, area.c0); c <= c1; c++) {
      if (asNumber(R[r]![c]) === null) continue
      const u = use.get(r, c)
      if (u === 'value') values++
      else if (u === undefined) leftOut.push([r, c])
    }
  return { values, leftOut, groups: groupCells(sheet, area, leftOut) }
}

/**
 * Left-out cells as whole rows or columns: repeatedly the row or column holding the most of those
 * not yet grouped (a row on ties), with adjacent lines of the same direction merged. Each group is
 * named by its position and the first text in it (a row's label, a column's header).
 */
function groupCells(sheet: Sheet, area: Area, cells: [number, number][]) {
  const R = sheet.rows
  // Roadmap 34e: in O(n log n). Each line's cells by index (in `cells` order), what is left of
  // each row and column, and a heap of rows and one of columns by what is left (largest first,
  // the lower index on ties; stale entries skipped) — where filtering every cell again for each
  // line took seconds for a wide sheet read as long data.
  const done = new Uint8Array(cells.length)
  const ofRow = new Map<number, number[]>()
  const ofCol = new Map<number, number[]>()
  cells.forEach(([r, c], i) => {
    const a = ofRow.get(r)
    if (a) a.push(i)
    else ofRow.set(r, [i])
    const b = ofCol.get(c)
    if (b) b.push(i)
    else ofCol.set(c, [i])
  })
  const leftRow = new Map([...ofRow].map(([k, v]) => [k, v.length]))
  const leftCol = new Map([...ofCol].map(([k, v]) => [k, v.length]))
  const rows = new LineHeap([...leftRow])
  const cols = new LineHeap([...leftCol])
  const lines: { byRow: boolean; k: number; cells: [number, number][] }[] = []
  let remaining = cells.length
  while (remaining) {
    const [row, nRow] = rows.top(leftRow)
    const [col, nCol] = cols.top(leftCol)
    const byRow = nRow >= nCol
    const k = byRow ? row : col
    const taken: [number, number][] = []
    for (const i of (byRow ? ofRow : ofCol).get(k)!) {
      if (done[i]) continue
      done[i] = 1
      remaining--
      const [r, c] = cells[i]!
      taken.push([r, c])
      const nr = leftRow.get(r)! - 1
      leftRow.set(r, nr)
      if (nr) rows.push([r, nr])
      const nc = leftCol.get(c)! - 1
      leftCol.set(c, nc)
      if (nc) cols.push([c, nc])
    }
    lines.push({ byRow, k, cells: taken })
  }
  lines.sort((a, b) => Number(b.byRow) - Number(a.byRow) || a.k - b.k)
  const groups: { byRow: boolean; a: number; b: number; cells: [number, number][] }[] = []
  for (const l of lines) {
    const last = groups[groups.length - 1]
    if (last && last.byRow === l.byRow && l.k === last.b + 1) {
      last.b = l.k
      for (const cell of l.cells) last.cells.push(cell)
    } else groups.push({ byRow: l.byRow, a: l.k, b: l.k, cells: [...l.cells] })
  }
  // In reading order of their first cell.
  const first = (g: (typeof groups)[number]) =>
    g.cells.reduce((m, [r, c]) => (r < m[0] || (r === m[0] && c < m[1]) ? [r, c] : m), g.cells[0]!)
  groups.sort((g, h) => {
    const [p, q] = [first(g), first(h)]
    return p[0] - q[0] || p[1] - q[1]
  })
  return groups.map(({ byRow, a, b, cells: cs }) => {
    let label = ''
    if (byRow) {
      for (let c = area.c0; c <= area.c1 && !label; c++) label = text(R[a]![c])
    } else {
      // The nearest text above the column's first left-out cell.
      const top = cs.reduce((m, [r, c]) => (c === a ? Math.min(m, r) : m), Number.POSITIVE_INFINITY)
      for (let r = top - 1; r >= area.r0 && !label; r--) label = text(R[r]![a])
    }
    const where = byRow
      ? a === b
        ? `row ${a + 1}`
        : `rows ${a + 1}–${b + 1}`
      : a === b
        ? `column ${columnLetters(a)}`
        : `columns ${columnLetters(a)}–${columnLetters(b)}`
    return { where: label ? `${where} ${quote(label)}` : where, count: cs.length }
  })
}

/** "Read 118 values. Left out 6 numbers: row 14 “P value” (3), column F (3)." */
export function describeAccount(a: ImportAccount): string {
  const read = `Read ${a.values} value${a.values === 1 ? '' : 's'}.`
  if (!a.leftOut.length) return read
  const shown = a.groups.slice(0, 4).map((g) => `${g.where} (${g.count})`)
  if (a.groups.length > 4) shown.push(`${a.groups.length - 4} more`)
  const n = a.leftOut.length
  return `${read} Left out ${n} number${n === 1 ? '' : 's'}: ${shown.join(', ')}.`
}

/** A max-heap of lines by cells left (the lower line index on ties), with lazy deletion. */
class LineHeap {
  private readonly a: [number, number][] = []
  constructor(items: [number, number][]) {
    for (const it of items) this.push(it)
  }
  private before(x: [number, number], y: [number, number]) {
    return x[1] > y[1] || (x[1] === y[1] && x[0] < y[0])
  }
  push(it: [number, number]) {
    const a = this.a
    a.push(it)
    for (let i = a.length - 1; i > 0; ) {
      const p = (i - 1) >> 1
      if (!this.before(a[i]!, a[p]!)) break
      ;[a[i], a[p]] = [a[p]!, a[i]!]
      i = p
    }
  }
  private pop() {
    const a = this.a
    const last = a.pop()!
    if (!a.length) return
    a[0] = last
    for (let i = 0; ; ) {
      const l = 2 * i + 1
      const r = l + 1
      let m = i
      if (l < a.length && this.before(a[l]!, a[m]!)) m = l
      if (r < a.length && this.before(a[r]!, a[m]!)) m = r
      if (m === i) break
      ;[a[i], a[m]] = [a[m]!, a[i]!]
      i = m
    }
  }
  /** The line with the most cells left, as `left` has them now ([line, 0] when none). */
  top(left: ReadonlyMap<number, number>): [number, number] {
    while (this.a.length && left.get(this.a[0]![0]) !== this.a[0]![1]) this.pop()
    return this.a[0] ?? [-1, 0]
  }
}
