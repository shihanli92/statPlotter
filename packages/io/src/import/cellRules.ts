import {
  type CellColumn,
  type DataTable,
  describeLimitRule,
  type LimitFlag,
  type LimitRule,
  type ParsedLimit,
  parseLimitText,
  substituteLimit,
} from '@ps/model'
import type { Sheet, SheetCell } from './sheet.ts'

// The user's own missing-value codes and values at detection limits on import (roadmap 39,
// decisions 574–575). Both work on the sheet before any table is built from it, so every reader
// (blocks, layouts, long data, variables) treats them alike and stays unchanged without rules:
// a missing code becomes an empty cell; a limit cell ("<0.5", "BLQ") becomes a unique stand-in
// number, which the finished table's cells are then searched for and replaced by the substitute
// with a flag keeping the side and the original text.

export interface CellRules {
  /** Missing-value codes besides NA, N/A, NaN…: matched trimmed, ignoring case ("-999", "ND"). */
  missing?: readonly string[]
  /** Read values at a limit and substitute them by this rule; absent: limit text is not a number. */
  limits?: LimitRule
  /**
   * The rule's typed limits per data set are keyed by data set title (the import dialog knows
   * titles, not the ids the table will get): turned into ids once the table is built.
   */
  limitColumnsByTitle?: boolean
}

/** The rule with its per-column limits keyed by the table's data set ids instead of titles. */
export function limitRuleForTable(rule: LimitRule, table: DataTable): LimitRule {
  const byId = (cols: Record<string, number> | undefined) => {
    if (!cols) return undefined
    const out: Record<string, number> = {}
    for (const d of table.dataSets) {
      const v = cols[d.title]
      if (v !== undefined) out[d.id] = v
    }
    return Object.keys(out).length ? out : undefined
  }
  const side = (v: LimitRule['lower']) => {
    if (!v) return undefined
    const columns = byId(v.columns)
    const out = { ...(v.all !== undefined ? { all: v.all } : {}), ...(columns ? { columns } : {}) }
    return Object.keys(out).length ? out : undefined
  }
  const lower = side(rule.lower)
  const upper = side(rule.upper)
  const { lower: _l, upper: _u, ...rest } = rule
  return { ...rest, ...(lower ? { lower } : {}), ...(upper ? { upper } : {}) }
}

/** What the rules found in a sheet. */
export interface CellRuleCounts {
  missing: number
  below: number
  above: number
}

interface Mark {
  parsed: ParsedLimit
  text: string
}

/** A sheet with the rules applied, and its limit cells' stand-ins. */
export interface PreparedSheet {
  sheet: Sheet
  counts: CellRuleCounts
  /** Stand-in number → the limit cell it stands for. */
  marks: Map<number, Mark>
}

// Stand-ins: numbers no lab data holds, distinct (the step is far above their spacing).
const STAND_IN = 1.2345e300
const STEP = 1e287

/** A missing code typed in a list ("-999, ND; not done"): the codes, trimmed and lower case. */
export function parseMissingCodes(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[,;\n]/)
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s !== ''),
    ),
  ]
}

const codeOf = (cell: SheetCell): string | null =>
  typeof cell === 'string'
    ? cell.trim().toLowerCase()
    : typeof cell === 'number' && Number.isFinite(cell)
      ? String(cell)
      : null

/** The sheet with missing codes emptied and limit cells as stand-in numbers (copy on write). */
export function prepareSheet(sheet: Sheet, rules: CellRules): PreparedSheet {
  const codes = new Set((rules.missing ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean))
  // Numeric codes match numbers too: -999 typed matches the number −999 in a sheet.
  const numericCodes = new Set<number>()
  for (const c of codes) {
    const n = Number(c)
    if (c !== '' && Number.isFinite(n)) numericCodes.add(n)
  }
  const counts: CellRuleCounts = { missing: 0, below: 0, above: 0 }
  const marks = new Map<number, Mark>()
  if (!codes.size && !rules.limits) return { sheet, counts, marks }
  let rows: SheetCell[][] | null = null
  sheet.rows.forEach((row, r) => {
    row.forEach((cell, c) => {
      let next: SheetCell | undefined
      if (cell === null) return
      if (
        codes.size &&
        ((typeof cell === 'number' && numericCodes.has(cell)) ||
          (typeof cell === 'string' && codes.has(codeOf(cell)!)))
      ) {
        next = null
        counts.missing++
      } else if (rules.limits && typeof cell === 'string') {
        const parsed = parseLimitText(cell)
        if (parsed) {
          const stand = STAND_IN + STEP * marks.size
          marks.set(stand, { parsed, text: cell.trim().slice(0, 200) })
          counts[parsed.side]++
          next = stand
        }
      }
      if (next === undefined) return
      rows ??= sheet.rows.map((x) => x.slice())
      rows[r]![c] = next
    })
  })
  return { sheet: rows ? { ...sheet, rows } : sheet, counts, marks }
}

/**
 * The table built from a prepared sheet with its stand-ins replaced: in number cells by the
 * substitute under `rule`, flagged; in titles and text by the original text.
 */
export function finishLimits(
  table: DataTable,
  prepared: PreparedSheet,
  rule: LimitRule,
): DataTable {
  const { marks } = prepared
  if (!marks.size) return table
  const texts = new Map<string, string>()
  for (const [n, m] of marks) texts.set(String(n), m.text)
  const restore = <T extends string | null>(s: T): T =>
    s === null ? s : ((texts.get(s) ?? s) as T)
  const fix = (c: CellColumn, column?: string): CellColumn => {
    let values: (number | null)[] | null = null
    let limit: (LimitFlag | null)[] | null = null
    c.values.forEach((v, r) => {
      if (v === null || v < STAND_IN) return
      const m = marks.get(v)
      if (!m) return
      values ??= c.values.slice()
      limit ??= c.limit?.slice() ?? c.values.map(() => null)
      values[r] = substituteLimit(m.parsed, rule, column)
      limit[r] = { side: m.parsed.side, text: m.text }
    })
    return values ? { ...c, values, limit: limit! } : c
  }
  let any = false
  const dataSets = table.dataSets.map((d) => {
    const subcolumns = d.subcolumns.map((c) => fix(c, d.id))
    if (subcolumns.some((c, i) => c !== d.subcolumns[i])) any = true
    return {
      ...d,
      title: restore(d.title),
      subcolumns,
      ...(d.text ? { text: d.text.map(restore) } : {}),
      ...(d.subcolumnTitles ? { subcolumnTitles: d.subcolumnTitles.map(restore) } : {}),
    }
  })
  return {
    ...table,
    // X values at a limit become the substitute, unflagged (only Y cells carry flags).
    ...(table.x
      ? {
          x: {
            ...table.x,
            title: restore(table.x.title),
            subcolumns: table.x.subcolumns.map((c) => {
              const f = fix(c)
              const { limit: _, ...rest } = f
              return rest
            }),
          },
        }
      : {}),
    rowTitles: table.rowTitles ? table.rowTitles.map(restore) : null,
    dataSets,
    ...(any ? { limits: rule } : {}),
  }
}

/**
 * A table built from `prepared.sheet` finished under the rules: its limit cells substituted and
 * flagged, and a note of what the rules did added to its warnings. Callers that detect a sheet's
 * layout (blocks, long data) detect it on the prepared sheet, where limit cells are numbers and
 * missing codes empty, then build and finish (`withCellRules` does all three).
 */
export function finishCellRules<R extends { table: DataTable; warnings: string[] }>(
  built: R,
  prepared: PreparedSheet,
  rules: CellRules | undefined,
): R & { counts: CellRuleCounts } {
  if (!rules || (!rules.missing?.length && !rules.limits))
    return { ...built, counts: prepared.counts }
  const rule =
    rules.limits && rules.limitColumnsByTitle
      ? limitRuleForTable(rules.limits, built.table)
      : rules.limits
  const table = rule ? finishLimits(built.table, prepared, rule) : built.table
  const notes: string[] = []
  const { missing, below, above } = prepared.counts
  if (missing)
    notes.push(`${missing} ${missing === 1 ? 'cell' : 'cells'} with a missing code read as empty.`)
  if ((below || above) && rules.limits)
    notes.push(
      `${below + above} ${below + above === 1 ? 'value' : 'values'} at a detection limit substituted (${describeLimitRule(rules.limits)}) and flagged.`,
    )
  return { ...built, table, warnings: [...built.warnings, ...notes], counts: prepared.counts }
}

/**
 * `build` (a table from a sheet) under the rules: the sheet prepared, the table built from it and
 * finished (`finishCellRules`).
 */
export function withCellRules<R extends { table: DataTable; warnings: string[] }>(
  sheet: Sheet,
  rules: CellRules | undefined,
  build: (sheet: Sheet) => R,
): R & { counts: CellRuleCounts } {
  const prepared = prepareSheet(sheet, rules ?? {})
  return finishCellRules(build(prepared.sheet), prepared, rules)
}
