import { filled, isText } from './cells.ts'
import type { Sheet } from './sheet.ts'

/**
 * One data set of a grouped table laid out as its own sub-table: rows with a text row title
 * (column A) and values to the right, under a line naming the data set. Many lab sheets stack
 * these ("WT" block, then "CD4Cre" block, same row titles), sometimes under a measure title
 * ("% Foxp3+"). `range` holds the value rows only: column A (row titles) to the last value.
 */
export interface StackedPart {
  title: string | null
  range: { r0: number; c0: number; r1: number; c1: number }
}

export interface StackedGroup {
  /** The measure title over the group, if any. */
  title: string | null
  /** Everything the group covers, from its first title line to its last value row. */
  range: { r0: number; c0: number; r1: number; c1: number }
  parts: StackedPart[]
}

/** Row titles compare without case or spaces ("Med LN" = "MedLN", "mLN" = "MLN"). */
export const rowKey = (s: string) => s.toLowerCase().replace(/\s+/g, '')

/** Whether two data set names look like siblings: a shared word, or a shared start (≥ 4 chars). */
function similar(a: string, b: string): boolean {
  const words = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .split(/[\s+/,()-]+/)
        .filter((w) => w.length >= 2),
    )
  const wa = words(a)
  for (const w of words(b)) if (wa.has(w)) return true
  const [x, y] = [a.toLowerCase(), b.toLowerCase()]
  let n = 0
  while (n < x.length && x[n] === y[n]) n++
  return n >= 4
}

/**
 * Finds groups of stacked per-data-set sub-tables (see `StackedPart`) with matching row titles.
 * A line with one name in a value column names the next sub-table (text in column A of that line
 * is the measure title); a lone column-A line right above the rows names it too when it resembles
 * the group's other names, and otherwise starts a new measure. Only groups of two or more
 * sub-tables are returned; single tables are ordinary blocks.
 */
export function findStackedGroups(sheet: Sheet): StackedGroup[] {
  const rows = sheet.rows
  const width = rows[0]?.length ?? 0
  const lastNumber = (r: number) => {
    let last = -1
    for (let c = 1; c < width; c++) if (typeof rows[r]![c] === 'number') last = c
    return last
  }
  const isData = (r: number) => isText(rows[r]![0]) && lastNumber(r) > 0

  // Runs of value rows, with the non-empty lines between the previous run and this one.
  const subs: { r0: number; r1: number; c1: number; header: number[] }[] = []
  let prevEnd = -1
  for (let r = 0; r < rows.length; r++) {
    if (!isData(r)) continue
    const r0 = r
    let c1 = lastNumber(r)
    while (r + 1 < rows.length && isData(r + 1)) c1 = Math.max(c1, lastNumber(++r))
    const header: number[] = []
    for (let h = prevEnd + 1; h < r0; h++) if (rows[h]!.some(filled)) header.push(h)
    subs.push({ r0, r1: r, c1, header })
    prevEnd = r
  }

  const groups: StackedGroup[] = []
  let current: (StackedGroup & { keys: Set<string> }) | null = null
  const close = () => {
    if (current && current.parts.length > 1) {
      const { keys: _, ...g } = current
      groups.push(g)
    }
    current = null
  }
  for (const s of subs) {
    const keys = new Set<string>()
    for (let r = s.r0; r <= s.r1; r++) keys.add(rowKey(String(rows[r]![0])))
    // Names in value columns (a multi-name header is an ordinary grouped block, not a part).
    let name: string | null = null
    let measure: string | null = null
    let multi = false
    let nameLine = -1
    for (let i = s.header.length - 1; i >= 0; i--) {
      const h = s.header[i]!
      const texts: number[] = []
      for (let c = 1; c < width; c++) if (isText(rows[h]![c])) texts.push(c)
      if (texts.length > 1) multi = true
      if (texts.length === 1) {
        name = String(rows[h]![texts[0]!]).trim()
        if (isText(rows[h]![0])) measure = String(rows[h]![0]).trim()
        nameLine = i
        break
      }
    }
    if (multi) {
      close()
      continue
    }
    const aboveLines = s.header.slice(0, nameLine < 0 ? s.header.length : nameLine)
    const colA = aboveLines
      .filter((h) => isText(rows[h]![0]) && !rows[h]!.slice(1).some(filled))
      .map((h) => ({ h, text: String(rows[h]![0]).trim() }))
    if (name === null && colA.length) {
      const last = colA[colA.length - 1]!
      const adjacent = last.h === s.r0 - 1
      const groupName = current?.parts.find((p) => p.title)?.title
      const sibling = !!groupName && similar(last.text, groupName)
      if (adjacent && (colA.length > 1 || sibling)) {
        name = last.text
        colA.pop()
      }
    }
    if (measure === null && colA.length) measure = colA[colA.length - 1]!.text

    const sameRows =
      current !== null &&
      keys.size === current.keys.size &&
      [...keys].every((k) => (current as { keys: Set<string> }).keys.has(k))
    if (measure !== null || !sameRows) close()
    const part: StackedPart = { title: name, range: { r0: s.r0, c0: 0, r1: s.r1, c1: s.c1 } }
    if (current) {
      current.parts.push(part)
      current.range.r1 = s.r1
      current.range.c1 = Math.max(current.range.c1, s.c1)
    } else {
      current = {
        title: measure,
        range: { r0: s.header[0] ?? s.r0, c0: 0, r1: s.r1, c1: s.c1 },
        parts: [part],
        keys,
      }
    }
  }
  close()
  // A table that repeats the previous one's data sets unnamed (counts under percentages) takes
  // their names, position by position.
  groups.forEach((g, i) => {
    const prev = groups[i - 1]
    if (!prev || prev.parts.length !== g.parts.length) return
    g.parts.forEach((p, k) => {
      p.title ??= prev.parts[k]!.title
    })
  })
  return groups
}
