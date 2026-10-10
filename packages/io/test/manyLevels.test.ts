import { columnLetters } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { growthRatio } from '../../stats/test/timing.ts'
import { type Area, accountFor, CellUse } from '../src/import/account.ts'
import { clean } from '../src/import/cells.ts'
import {
  distinctTexts,
  longToTable,
  MAX_IMPORT_LEVELS,
  manyLevelColumns,
  manyLevelsReason,
  type Sheet,
  type SheetCell,
  sheetToTable,
} from '../src/index.ts'

// Columns an import leaves out by default (roadmap 34e, decision 416): text columns of more than
// MAX_IMPORT_LEVELS distinct values — cell ids, barcodes — and the account of a wide sheet read
// as long data, in O(n log n).

/** A sheet: a header, then `rows` rows of the given columns' cells. */
function sheetOf(cols: Record<string, (r: number) => SheetCell>, rows: number): Sheet {
  const titles = Object.keys(cols)
  return {
    name: 'S',
    rows: [titles, ...Array.from({ length: rows }, (_, r) => titles.map((t) => cols[t]!(r)))],
  }
}

describe('text columns of many levels', () => {
  const sheet = sheetOf(
    {
      barcode: (r) => `AACG${r}-1`,
      cluster: (r) => `C${r % 12}`,
      levels200: (r) => `L${r % MAX_IMPORT_LEVELS}`,
      levels201: (r) => `L${r % (MAX_IMPORT_LEVELS + 1)}`,
      // Numbers that are ids are still numbers: not left out.
      cellNumber: (r) => 100_000 + r,
      score: (r) => (r % 7) / 3,
      withMissing: (r) => (r % 3 ? `x${r}` : 'NA'),
    },
    1000,
  )

  it('are the text columns of more than 200 distinct values (missing marks aside)', () => {
    const many = manyLevelColumns(sheet, { headerRow: true })
    expect([...many.keys()]).toEqual([0, 3, 6])
    expect(many.get(0)).toBe(1000)
    expect(many.get(3)).toBe(MAX_IMPORT_LEVELS + 1)
    expect(many.get(6)).toBe(666)
    expect(distinctTexts(['a', 'a ', null, 'NA', '', 'b'])).toBe(2)
    expect(manyLevelsReason(16171)).toBe('16,171 distinct values: left out (tick to import)')
  })

  it('are left out of the table when not included; the rest import as before', () => {
    const many = manyLevelColumns(sheet, { headerRow: true })
    const include = sheet.rows[0]!.map((_, c) => !many.has(c))
    const t = sheetToTable(sheet, {
      name: 'T',
      tableKind: 'multipleVariables',
      headerRow: true,
      firstColumn: 'data',
      include,
    }).table
    expect(t.dataSets.map((d) => d.title)).toEqual(['cluster', 'levels200', 'cellNumber', 'score'])
    expect(t.dataSets.find((d) => d.title === 'cellNumber')!.text).toBeUndefined()
    const all = sheetToTable(sheet, {
      name: 'T',
      tableKind: 'multipleVariables',
      headerRow: true,
      firstColumn: 'data',
    }).table
    expect(all.dataSets).toHaveLength(7)
  })
})

/** The grouping as it was (filtering every cell again for each line): the reference. */
function groupedBefore(sheet: Sheet, area: Area, cells: [number, number][]) {
  const R = sheet.rows
  const left = new Set(cells.map(([r, c]) => `${r}:${c}`))
  const lines: { byRow: boolean; k: number; cells: [number, number][] }[] = []
  while (left.size) {
    const rest = cells.filter(([r, c]) => left.has(`${r}:${c}`))
    const count = (byRow: boolean) => {
      const m = new Map<number, number>()
      for (const [r, c] of rest) m.set(byRow ? r : c, (m.get(byRow ? r : c) ?? 0) + 1)
      return [...m].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]!
    }
    const [row, nRow] = count(true)
    const [col, nCol] = count(false)
    const byRow = nRow >= nCol
    const k = byRow ? row : col
    const taken = rest.filter(([r, c]) => (byRow ? r : c) === k)
    for (const [r, c] of taken) left.delete(`${r}:${c}`)
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

describe('the account of numbers left out', () => {
  /** A sheet of numbers with every cell in `used` read as a value. */
  function account(rows: number, cols: number, used: (r: number, c: number) => boolean) {
    const sheet: Sheet = {
      name: 'S',
      rows: Array.from({ length: rows }, (_, r) =>
        Array.from({ length: cols }, (_, c) => ((r * 7 + c * 3) % 5 === 0 ? 'x' : r + c)),
      ),
    }
    const use = new CellUse(sheet)
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (used(r, c)) use.value(r, c)
    return { a: accountFor(sheet, { r0: 0, c0: 0, r1: rows - 1, c1: cols - 1 }, use), sheet }
  }

  it('groups the cells as before', () => {
    for (const [rows, cols, used] of [
      [20, 6, (r: number, c: number) => c === 2 || r === 5],
      [40, 9, (r: number, c: number) => (r * c) % 4 === 1],
      [15, 15, (r: number, c: number) => r === c],
      [8, 30, () => false],
    ] as const) {
      const { a, sheet } = account(rows, cols, used)
      const area = { r0: 0, c0: 0, r1: rows - 1, c1: cols - 1 }
      expect(a.groups).toEqual(groupedBefore(sheet, area, a.leftOut))
      expect(a.groups.reduce((n, g) => n + g.count, 0)).toBe(a.leftOut.length)
    }
  })

  it('a wide sheet read as long data is accounted for in about linear time', () => {
    const sheets = new Map<number, Sheet>()
    const sheet = (rows: number) => {
      let s = sheets.get(rows)
      if (!s) {
        s = sheetOf(
          {
            group: (r) => `G${r % 3}`,
            ...Object.fromEntries(
              Array.from({ length: 30 }, (_, k) => [`v${k}`, (r: number) => r * 31 + k]),
            ),
          },
          rows,
        )
        sheets.set(rows, s)
      }
      return s
    }
    const run = (rows: number) => longToTable(sheet(rows), { name: 'L', value: 1, group: 0 })
    expect(run(100).account!.leftOut.length).toBe(100 * 29)
    expect(growthRatio(run, 1000, 4, 2)).toBeLessThan(8)
  })
})

const text = (v: SheetCell | undefined) => (typeof v === 'string' ? clean(v) : '')
const quote = (s: string) => (s.length > 30 ? `“${s.slice(0, 30)}…”` : `“${s}”`)
