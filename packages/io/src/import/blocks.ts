import { clean, filled, isText } from './cells.ts'
import { type BlockLayout, parseBlock } from './layout.ts'
import type { Sheet, SheetCell, SheetImportOptions } from './sheet.ts'
import { findStackedGroups, type StackedPart } from './stacked.ts'

/**
 * Journal source-data files (and many lab workbooks) hold several small tables on one sheet:
 * a title line, a header row, the values, then a blank row before the next table. Tables can also
 * sit side by side, separated by an empty column, each with its own title above it.
 */
export interface SheetBlock {
  /** Text of the title line above the table, if there is one. */
  title: string | null
  /** The table itself (header and values, not the title), inclusive and 0-based. */
  range: { r0: number; c0: number; r1: number; c1: number }
  /**
   * A grouped table stored as one sub-table per data set (see `findStackedGroups`): the parts
   * become its data sets. `range` then spans all of them, for previews.
   */
  parts?: StackedPart[]
  /** The structure read from the block (see `parseBlock`); imports use it when present. */
  layout?: BlockLayout
  /**
   * The rows and columns the block was read from, including rows after the values (statistics,
   * notes) up to the next blank row. Imports account for every number in it (`accountFor`).
   */
  area: { r0: number; c0: number; r1: number; c1: number }
}

/** Non-empty cells of a row within columns c0..c1. */
function cellsOf(row: readonly SheetCell[], c0: number, c1: number): number[] {
  const out: number[] = []
  for (let c = c0; c <= c1; c++) if (filled(row[c])) out.push(c)
  return out
}

/** A title line: text only, starting in the first column of its table. */
function titleCells(row: readonly SheetCell[], c0: number, c1: number): number[] | null {
  const cells = cellsOf(row, c0, c1)
  if (!cells.length || !cells.every((c) => isText(row[c]))) return null
  return cells
}

/**
 * Finds the tables on a sheet. A sheet that is one plain table gives one block without a title.
 * Blocks without any number (notes, captions) are left out.
 */
export function findBlocks(sheet: Sheet): SheetBlock[] {
  const rows = sheet.rows
  const width = rows[0]?.length ?? 0
  // Vertical runs of non-empty rows.
  const runs: [number, number][] = []
  for (let r = 0; r < rows.length; r++) {
    if (!cellsOf(rows[r]!, 0, width - 1).length) continue
    const start = r
    while (r + 1 < rows.length && cellsOf(rows[r + 1]!, 0, width - 1).length) r++
    runs.push([start, r])
  }

  const blocks: SheetBlock[] = []
  const isNumber = (v: SheetCell | undefined) => typeof v === 'number'
  let pendingTitles: { row: number; cols: number[]; text: string | null } | null = null
  for (const [a, b] of runs) {
    const r0 = a
    const titles = pendingTitles
    pendingTitles = null
    const first = titleCells(rows[a]!, 0, width - 1)
    // A run of text lines (one cell each), or one line of titles: the title of what follows.
    let allTitleLines = true
    for (let r = a; r <= b && allTitleLines; r++) {
      const t = titleCells(rows[r]!, 0, width - 1)
      if (!t || (t.length > 1 && b > a)) allTitleLines = false
    }
    if (allTitleLines && first) {
      const lines: string[] = []
      for (let r = a; r <= b; r++) {
        const t = titleCells(rows[r]!, 0, width - 1)!
        if (t.length === 1) lines.push(clean(String(rows[r]![t[0]!])))
      }
      pendingTitles = {
        row: b,
        cols: titleCells(rows[b]!, 0, width - 1)!,
        text: lines.join(' – ') || null,
      }
      continue
    }
    const empty = (c: number, from = r0) => {
      for (let r = from; r <= b; r++) if (filled(rows[r]![c])) return false
      return true
    }
    // Side-by-side tables: split where a title line starts the next table, or at empty columns
    // when every part has its own header (a title and data set names above its values).
    let segs: { c0: number; c1: number; title: string | null }[]
    if (titles && titles.cols.length > 1) {
      const t = titles
      segs = t.cols.map((s, i) => ({
        c0: s,
        c1: i + 1 < t.cols.length ? t.cols[i + 1]! - 1 : width - 1,
        title: isText(rows[t.row]![s]) ? clean(String(rows[t.row]![s])) : null,
      }))
    } else {
      const parts: { c0: number; c1: number }[] = []
      for (let c = 0; c < width; c++) {
        if (empty(c)) continue
        const c0 = c
        while (c + 1 < width && !empty(c + 1)) c++
        parts.push({ c0, c1: c })
      }
      const ownHeader = (p: { c0: number; c1: number }) => {
        let n = 0
        for (let r = r0; r <= b; r++) {
          const cs = cellsOf(rows[r]!, p.c0, p.c1)
          if (cs.some((c) => isNumber(rows[r]![c]))) break
          n += cs.filter((c) => isText(rows[r]![c])).length
        }
        return n >= 2
      }
      const hasValues = (p: { c0: number; c1: number }) => {
        for (let r = r0; r <= b; r++)
          for (let c = p.c0; c <= p.c1; c++) if (isNumber(rows[r]![c])) return true
        return false
      }
      segs =
        parts.length > 1 && parts.every((p) => hasValues(p) && ownHeader(p))
          ? parts.map((p) => ({ ...p, title: null }))
          : [{ c0: 0, c1: width - 1, title: null }]
    }
    for (const seg of segs) {
      const pending = seg.title ?? (titles && titles.cols.length === 1 ? titles.text : null)
      const area = { r0: a, r1: b, c0: seg.c0, c1: seg.c1 }
      const parsed = parseBlock(sheet, area, pending)
      if (parsed) {
        blocks.push({ title: parsed.title, range: parsed.range, layout: parsed.layout, area })
        continue
      }
      // Not a recognisable layout: the block as a plain range, as before.
      let pr0 = r0
      let ptitle = pending
      const firstSeg = titleCells(rows[a]!, seg.c0, seg.c1)
      if (
        !ptitle &&
        firstSeg?.length === 1 &&
        b > a &&
        cellsOf(rows[a + 1]!, seg.c0, seg.c1).length > 1
      ) {
        ptitle = clean(String(rows[a]![firstSeg[0]!]))
        pr0 = a + 1
      }
      let c1 = seg.c1
      while (c1 > seg.c0 && empty(c1, pr0)) c1--
      let c0 = seg.c0
      while (c0 < c1 && empty(c0, pr0)) c0++
      let r1 = b
      while (r1 > pr0 && !cellsOf(rows[r1]!, c0, c1).length) r1--
      let hasNumber = false
      for (let r = pr0; r <= r1 && !hasNumber; r++)
        for (let c = c0; c <= c1; c++) if (isNumber(rows[r]![c])) hasNumber = true
      if (!hasNumber) continue
      blocks.push({ title: ptitle, range: { r0: pr0, c0, r1, c1 }, area })
    }
  }
  // Per-data-set sub-tables replace the blocks they were read as.
  const groups = findStackedGroups(sheet)
  if (!groups.length) return blocks
  const overlaps = (b: SheetBlock) =>
    groups.some((g) => b.range.r0 <= g.range.r1 && g.range.r0 <= b.range.r1)
  return [
    ...blocks.filter((b) => !overlaps(b)),
    ...groups.map((g) => ({ title: g.title, range: g.range, parts: g.parts, area: g.range })),
  ].sort((p, q) => p.range.r0 - q.range.r0 || p.range.c0 - q.range.c0)
}

/** Header words that mark the first column as X. */
const X_TITLE =
  /^(x|time|times?\s*\(|t\s*\(|dose|conc|concentration|day|days|hour|hours|min|minutes|sec|seconds|age|distance)\b/i

export type BlockGuess = Pick<SheetImportOptions, 'tableKind' | 'headerRow' | 'firstColumn'> & {
  replicates: number
}

/**
 * Import settings that fit a block: a header when its first row is text over numbers; row titles
 * (a grouped table) when the first column is text; X when the first column is numeric under an
 * X-like title (time, dose…). For grouped and XY tables, the replicate count is the spacing of
 * the data set titles in the header (lab graphing tools write a title over the first of each data
 * set's columns and leave the rest blank).
 */
export function guessBlock(
  sheet: Sheet,
  range: SheetBlock['range'],
  parts?: SheetBlock['parts'],
  layout?: SheetBlock['layout'],
): BlockGuess {
  if (layout && !parts?.length) {
    const needsX = layout.kind === 'xy' || layout.kind === 'survival'
    return {
      tableKind: layout.kind,
      headerRow: true,
      firstColumn: needsX ? 'x' : layout.labelCol !== null ? 'rowTitles' : 'data',
      replicates:
        layout.orient === 'columns' && (layout.kind === 'grouped' || layout.kind === 'xy')
          ? Math.max(1, ...layout.sets.map((s) => s.cols.length))
          : 1,
    }
  }
  if (parts?.length) {
    const widths = parts.map((p) => p.range.c1 - p.range.c0)
    return {
      tableKind: 'grouped',
      headerRow: false,
      firstColumn: 'rowTitles',
      replicates: Math.max(1, ...widths),
    }
  }
  const { r0, c0, r1, c1 } = range
  const rows = sheet.rows
  const top = rows[r0]!
  const next = rows[r0 + 1]
  const headerRow =
    !!next &&
    cellsOf(top, c0, c1).some((c) => isText(top[c])) &&
    cellsOf(next, c0, c1).some((c) => typeof next[c] === 'number')
  const dataR0 = headerRow ? r0 + 1 : r0
  const firstCol: SheetCell[] = []
  for (let r = dataR0; r <= r1; r++) if (filled(rows[r]![c0])) firstCol.push(rows[r]![c0]!)
  const textFirst = firstCol.length > 0 && firstCol.every((v) => isText(v))
  const numericFirst = firstCol.length > 0 && firstCol.every((v) => typeof v === 'number')

  if (textFirst) {
    return {
      tableKind: 'grouped',
      headerRow,
      firstColumn: 'rowTitles',
      replicates: headerRow ? headerSpacing(top, c0 + 1, c1) : 1,
    }
  }
  if (numericFirst && headerRow && isText(top[c0]) && X_TITLE.test(top[c0].trim())) {
    return {
      tableKind: 'xy',
      headerRow,
      firstColumn: 'x',
      replicates: headerSpacing(top, c0 + 1, c1),
    }
  }
  return { tableKind: 'column', headerRow, firstColumn: 'data', replicates: 1 }
}

/**
 * Replicates per data set from a header's titles over columns c0..c1 (c1 = the last column with
 * data): the widest data set, each running from its title to the next (1 when every column has
 * a title).
 */
export function headerSpacing(header: readonly SheetCell[], c0: number, c1: number): number {
  const starts = cellsOf(header, c0, c1)
  if (starts.length < 2 || starts[0] !== c0) return 1
  let widest = c1 - starts[starts.length - 1]! + 1
  for (let i = 1; i < starts.length; i++) widest = Math.max(widest, starts[i]! - starts[i - 1]!)
  return widest
}
