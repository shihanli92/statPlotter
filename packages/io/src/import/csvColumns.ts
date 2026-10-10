import {
  type DataSetColumn,
  type DataTable,
  DEFAULT_LIMIT_RULE,
  defaultColumnTitle,
  newColumnId,
  parseLimitText,
} from '@ps/model'
import { type DecimalSeparator, detectDecimal, parseNumberWith } from '../numbers.ts'
import {
  type CellRuleCounts,
  type CellRules,
  finishCellRules,
  type PreparedSheet,
  prepareSheet,
} from './cellRules.ts'
import { cellTitle, MISSING } from './cells.ts'
import { type CsvDelimiter, parseRecords, sniffDelimiter } from './csv.ts'
import { ImportError } from './errors.ts'
import { finishTable } from './finish.ts'
import type { SheetCell } from './sheet.ts'

// Large CSV files straight into columns (roadmap 34e, decision 405). `readCsv` builds a sheet —
// an object per cell, then a table from it — which takes gigabytes for a million rows of a
// Seurat or Scanpy export, and the whole text must fit one string. Here text is pushed in
// chunks (a stream of the file, in a worker) and each column kept as a Float64Array of numbers
// and, only once a word turns up in it, dictionary codes of its words: about 8 bytes a cell. The
// table built from them (`columnsToTable`) is the one `readCsv` and `sheetToTable` give for a
// multiple-variables table (a test compares them), except that the decimal separator comes from
// the start of the file (the import dialog shows it and can change it).

/** The table an import would make takes more memory than this (estimated): refused. */
export const MAX_IMPORT_BYTES = 1.5 * 2 ** 30

export class ImportTooLargeError extends ImportError {}

/**
 * The stand-in numbers `prepareSheet` gives cells at a detection limit (the first, and the step
 * between them), which `finishLimits` looks for: read off a sheet of two such cells, so cells
 * read here are finished by the same code as a sheet's.
 */
const [STAND_IN, STAND_IN_STEP] = (() => {
  const marks = prepareSheet(
    { name: '', rows: [['<1', '<2']] },
    { limits: DEFAULT_LIMIT_RULE },
  ).marks
  const [a, b] = [...marks.keys()]
  return [a!, b! - a!]
})()

/** A number token in the common case (decimal point, optional exponent): read with `Number`. */
const SIMPLE = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/

/** One column as it is read. */
class ColumnStore {
  nums: Float64Array
  codes: Int32Array | null = null
  /** Words by code − 1 (cells that aren't numbers, missing-value marks included). */
  readonly dict: string[] = []
  private readonly index = new Map<string, number>()
  /** Codes of missing-value marks (NA, n/a…). */
  readonly missing = new Set<number>()
  /** Cells with a number or a word other than a missing-value mark. */
  filled = 0
  /** Cells with a word other than a missing-value mark. */
  words = 0
  textBytes = 0

  constructor(capacity: number) {
    this.nums = new Float64Array(capacity).fill(Number.NaN)
  }

  grow(capacity: number) {
    const nums = new Float64Array(capacity).fill(Number.NaN)
    nums.set(this.nums)
    this.nums = nums
    if (this.codes) {
      const codes = new Int32Array(capacity)
      codes.set(this.codes)
      this.codes = codes
    }
  }

  word(row: number, s: string) {
    let c = this.index.get(s)
    if (c === undefined) {
      this.dict.push(s)
      c = this.dict.length
      this.index.set(s, c)
      this.textBytes += 2 * s.length + 48
      if (MISSING.has(s.trim().toLowerCase())) this.missing.add(c)
    }
    if (!this.codes) this.codes = new Int32Array(this.nums.length)
    this.codes[row] = c
    if (!this.missing.has(c)) {
      this.filled++
      this.words++
    }
  }
}

export interface CsvColumnsOptions {
  delimiter: CsvDelimiter
  decimal: DecimalSeparator
  /** Memory the table may take (estimated); default `MAX_IMPORT_BYTES`. */
  maxBytes?: number
  /** Columns (0-based) not to keep: their cells are skipped as they are read. */
  skip?: ReadonlySet<number>
  /**
   * Roadmap 39 (audit 2, U14): the user's missing codes and values at detection limits, applied
   * as the cells are read as `prepareSheet` applies them to a sheet (a missing code empty, a limit
   * cell a stand-in number); `columnsToTable` given the same rules finishes the table as
   * `finishCellRules` does, so a large file imports as the import dialog imports a small one.
   */
  rules?: CellRules
}

/** What `CsvColumnReader` read: the records as columns. */
export interface CsvColumns {
  /** Records read (the first included, when it is a header). */
  records: number
  /** The first record's cells (a header, or the first row of data). */
  first: SheetCell[]
  /** Per column (0-based, as in the file; skipped ones null): its cells from the second record on. */
  columns: (ColumnData | null)[]
  /** Rows after the first up to the last with a cell filled (trailing empty lines dropped). */
  rows: number
  /** What the rules found (cells of skipped columns aside). */
  counts: CellRuleCounts
  /** Stand-in number → the limit cell it stands for (as `PreparedSheet.marks`). */
  marks: PreparedSheet['marks']
}

/** A column's cells: numbers (NaN where none) and, where a word is, its code (0 none). */
export interface ColumnData {
  nums: Float64Array
  codes: Int32Array | null
  dict: string[]
  missing: number[]
  filled: number
  words: number
}

/**
 * Splits delimited text pushed in chunks into records (RFC 4180, as `parseRecords`: quoted fields
 * with doubled quotes and line breaks, text after a closing quote kept, LF / CRLF / CR endings,
 * no record after a final line break) and keeps each field in its column.
 */
export class CsvColumnReader {
  private readonly delim: string
  private readonly cols: (ColumnStore | null)[] = []
  private capacity = 1024
  private record = 0
  private col = 0
  private first: SheetCell[] = []
  /** The field being read: text so far (pieces of earlier chunks), quoted, inside quotes. */
  private piece = ''
  private quoted = false
  private inQuotes = false
  /** A quote inside quotes was the last character: a doubled quote or the closing one. */
  private quote = false
  /** The field has started (a quote opened it, or characters were read). */
  private started = false
  private lastCr = false
  private lastFilledRow = -1
  // The rules (`opts.rules`): missing codes (as text, and those that are numbers), limit cells.
  private readonly codes: Set<string>
  private readonly numericCodes = new Set<number>()
  private readonly counts: CellRuleCounts = { missing: 0, below: 0, above: 0 }
  private readonly marks: PreparedSheet['marks'] = new Map()

  constructor(private readonly opts: CsvColumnsOptions) {
    this.delim = opts.delimiter === 'none' ? '' : opts.delimiter
    this.codes = new Set(
      (opts.rules?.missing ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean),
    )
    for (const c of this.codes) {
      const n = Number(c)
      if (Number.isFinite(n)) this.numericCodes.add(n)
    }
  }

  /** Records completed so far. */
  get count(): number {
    return this.record
  }

  push(text: string): void {
    const n = text.length
    const d = this.delim
    let i = 0
    let start = 0
    while (i < n) {
      const ch = text.charCodeAt(i)
      if (this.inQuotes) {
        if (this.quote) {
          this.quote = false
          if (ch === 34) {
            // A doubled quote: one quote in the text.
            this.piece += '"'
            i++
            start = i
            continue
          }
          this.inQuotes = false
          start = i
          continue
        }
        if (ch === 34) {
          this.piece += text.slice(start, i)
          this.quote = true
          i++
          start = i
          continue
        }
        i++
        continue
      }
      if (this.lastCr) {
        this.lastCr = false
        if (ch === 10) {
          i++
          start = i
          continue
        }
      }
      if (!this.started && ch === 34 && this.piece === '' && i === start) {
        this.started = true
        this.quoted = true
        this.inQuotes = true
        i++
        start = i
        continue
      }
      if (d && ch === d.charCodeAt(0)) {
        this.piece += text.slice(start, i)
        this.field(true)
        i++
        start = i
        continue
      }
      if (ch === 10 || ch === 13) {
        this.piece += text.slice(start, i)
        this.field(false)
        this.endRecord()
        this.lastCr = ch === 13
        i++
        start = i
        continue
      }
      this.started = true
      i++
    }
    this.piece += text.slice(start, n)
  }

  /** The end of the text: a last record without a line break. */
  end(): CsvColumns {
    if (this.inQuotes) this.inQuotes = false
    if (this.started || this.piece !== '' || this.col > 0) {
      this.field(false)
      this.endRecord()
    }
    const rows = Math.max(0, this.lastFilledRow + 1)
    return {
      records: this.record,
      first: this.first,
      rows,
      counts: { ...this.counts },
      marks: this.marks,
      columns: this.cols.map((c) =>
        c
          ? {
              nums: c.nums.subarray(0, rows),
              codes: c.codes?.subarray(0, rows) ?? null,
              dict: c.dict,
              missing: [...c.missing],
              filled: c.filled,
              words: c.words,
            }
          : null,
      ),
    }
  }

  private field(more: boolean) {
    const raw = this.piece
    const quoted = this.quoted
    this.piece = ''
    this.quoted = false
    this.started = false
    this.quote = false
    const c = this.col
    this.col = more ? c + 1 : c
    // As readCsv: unquoted fields trimmed; blank is empty; numbers read with the separator.
    const s = quoted ? raw : raw.trim()
    let cell: SheetCell = null
    let num = Number.NaN
    if (s.trim() !== '') {
      if (this.opts.decimal === '.' && SIMPLE.test(s)) num = Number(s)
      else {
        const v = parseNumberWith(s, this.opts.decimal)
        if (v !== null) num = v
      }
      cell = Number.isNaN(num) ? s : num
    }
    // (A text field is a number or a string.)
    if (cell !== null && !(this.record > 0 && this.opts.skip?.has(c)))
      cell = this.ruled(cell as number | string)
    if (this.record === 0) {
      this.first[c] = cell
      return
    }
    if (cell === null || this.opts.skip?.has(c)) return
    const row = this.record - 1
    let store = this.cols[c]
    if (!store) {
      store = new ColumnStore(this.capacity)
      this.cols[c] = store
      for (let k = this.first.length; k < c; k++) this.first[k] = null
    }
    if (typeof cell === 'number') {
      store.nums[row] = cell
      store.filled++
    } else store.word(row, cell)
    if (row > this.lastFilledRow) this.lastFilledRow = row
  }

  /** A cell under the rules: a missing code empty, a limit cell its stand-in (`prepareSheet`). */
  private ruled(cell: number | string): number | string | null {
    if (
      this.codes.size &&
      (typeof cell === 'number'
        ? this.numericCodes.has(cell)
        : this.codes.has(cell.trim().toLowerCase()))
    ) {
      this.counts.missing++
      return null
    }
    if (this.opts.rules?.limits && typeof cell === 'string') {
      const parsed = parseLimitText(cell)
      if (parsed) {
        const stand = STAND_IN + STAND_IN_STEP * this.marks.size
        this.marks.set(stand, { parsed, text: cell.trim().slice(0, 200) })
        this.counts[parsed.side]++
        return stand
      }
    }
    return cell
  }

  private endRecord() {
    this.col = 0
    this.record++
    if (this.record === 1) return
    const row = this.record - 1
    if (row >= this.capacity) {
      this.capacity *= 2
      for (const c of this.cols) c?.grow(this.capacity)
      this.checkMemory()
    }
  }

  /** The table these columns make would take more memory than allowed: stop now. */
  private checkMemory() {
    let bytes = 0
    for (const c of this.cols) if (c) bytes += this.capacity * (c.codes ? 12 : 8) + c.textBytes
    const max = this.opts.maxBytes ?? MAX_IMPORT_BYTES
    if (bytes > max) throw tooLarge(bytes, max)
  }
}

const gb = (b: number) => `${(b / 2 ** 30).toFixed(1)} GB`

function tooLarge(bytes: number, max: number): ImportTooLargeError {
  return new ImportTooLargeError(
    `This file is too large to import: its table would take more than ${gb(bytes)} of memory ` +
      `(at most ${gb(max)}). Import fewer columns (untick them in the list), or split the file.`,
  )
}

export type ColumnType = 'auto' | 'number' | 'text'

export interface ColumnsTableOptions {
  name: string
  /** The first record holds the variables' names. */
  headerRow: boolean
  firstColumn: 'data' | 'rowTitles'
  /** Per column (as in the file): a type instead of the detected one. */
  types?: readonly ColumnType[]
  /** Per column: false leaves it out. */
  include?: readonly boolean[]
  /** The rules the columns were read under (`CsvColumnsOptions.rules`): the table finished so. */
  rules?: CellRules
}

/** A column's text by row (for text variables and row titles). */
function columnText(
  col: ColumnData | null,
  first: SheetCell,
  headerRow: boolean,
  rows: number,
  keepMissing: boolean,
): (string | null)[] {
  const out = new Array<string | null>(rows).fill(null)
  if (!headerRow) out[0] = keepMissing ? cellTitle(first) : textOf(first)
  if (!col) return out
  const at = headerRow ? 0 : 1
  const words = col.dict.map((w, k) =>
    !keepMissing && col.missing.includes(k + 1) ? null : cellTitle(w),
  )
  for (let r = 0; r < col.nums.length; r++) {
    const c = col.codes?.[r] ?? 0
    const v = col.nums[r]!
    out[r + at] = c ? words[c - 1]! : Number.isNaN(v) ? null : String(v)
  }
  return out
}

const textOf = (cell: SheetCell): string | null =>
  cell === null
    ? null
    : typeof cell === 'number'
      ? String(cell)
      : MISSING.has(String(cell).trim().toLowerCase())
        ? null
        : cellTitle(cell)

/** Whether a column reads as text: most of its filled cells are words (as `isTextColumn`). */
export function isTextData(col: ColumnData | null, first: SheetCell, headerRow: boolean): boolean {
  let words = col?.words ?? 0
  let filled = col?.filled ?? 0
  if (!headerRow && first !== null) {
    const missing = typeof first === 'string' && MISSING.has(first.trim().toLowerCase())
    if (!missing) {
      filled++
      if (typeof first === 'string') words++
    }
  }
  return words > 0 && words * 2 >= filled
}

/**
 * A multiple-variables table from columns read (`CsvColumnReader`): each column a variable —
 * text when most of its cells are words (or `types` says so), else numbers, words in it imported
 * as empty with a count — or, `firstColumn: 'rowTitles'`, the first column as row titles. The
 * same table `sheetToTable` makes of the sheet `readCsv` reads (`tableKind: 'multipleVariables'`).
 */
export function columnsToTable(
  data: CsvColumns,
  opts: ColumnsTableOptions,
): { table: DataTable; warnings: string[] } {
  const { headerRow } = opts
  const rows = headerRow ? data.rows : data.records > 0 ? Math.max(1, data.rows + 1) : 0
  // Columns: up to the last one with a title or a cell.
  let width = Math.max(data.first.length, data.columns.length)
  const empty = (c: number) =>
    cellTitle(data.first[c] ?? null) === null &&
    !(data.columns[c]?.filled || data.columns[c]?.dict.length)
  while (width > 0 && empty(width - 1)) width--
  if (!rows || !width) throw new ImportError('The file has no data.')
  const dataC0 = opts.firstColumn === 'rowTitles' ? 1 : 0
  if (dataC0 >= width) throw new ImportError('The selected range has no data columns.')
  const rowTitles =
    opts.firstColumn === 'rowTitles'
      ? columnText(data.columns[0] ?? null, data.first[0] ?? null, headerRow, rows, true)
      : null

  let dropped = 0
  let firstDropped = ''
  const dataSets: DataSetColumn[] = []
  for (let c = dataC0; c < width; c++) {
    if (opts.include && opts.include[c] === false) continue
    const col = data.columns[c] ?? null
    const first = data.first[c] ?? null
    const title = (headerRow ? cellTitle(first) : null) ?? defaultColumnTitle(c - dataC0)
    const type = opts.types?.[c] ?? 'auto'
    const text = type === 'text' || (type === 'auto' && isTextData(col, first, headerRow))
    const nulls = new Array<number | null>(rows).fill(null)
    const ds: DataSetColumn = {
      id: newColumnId(),
      title,
      subcolumns: [{ type: 'number', values: nulls }],
    }
    if (text) ds.text = columnText(col, first, headerRow, rows, false)
    else {
      const values = new Array<number | null>(rows)
      const at = headerRow ? 0 : 1
      if (!headerRow) {
        const v = typeof first === 'number' ? first : null
        if (v === null && first !== null && !MISSING.has(String(first).trim().toLowerCase())) {
          dropped++
          firstDropped ||= `“${String(first).slice(0, 20)}” in ${title}`
        }
        values[0] = v
      }
      for (let r = 0; r < rows - at; r++) {
        const v = col ? col.nums[r]! : Number.NaN
        values[r + at] = Number.isNaN(v) ? null : v
      }
      if (col?.words) {
        dropped += col.words
        if (!firstDropped && col.codes) {
          for (let r = 0; r < col.codes.length; r++) {
            const k = col.codes[r]!
            if (k && !col.missing.includes(k)) {
              firstDropped = `“${col.dict[k - 1]!.slice(0, 20)}” in ${title}`
              break
            }
          }
        }
      }
      ds.subcolumns[0]!.values = values
    }
    dataSets.push(ds)
  }
  if (!dataSets.length) throw new ImportError('No columns to import.')
  const warnings: string[] = []
  if (dropped)
    warnings.push(
      `${dropped} non-numeric ${dropped === 1 ? 'cell' : 'cells'} in numeric variables ${dropped === 1 ? 'was' : 'were'} imported as empty (first: ${firstDropped}).`,
    )
  const table = finishTable({
    name: opts.name,
    tableKind: 'multipleVariables',
    yFormat: { type: 'replicates', count: 1 },
    rowCount: rows,
    rowTitles,
    x: null,
    dataSets,
  })
  if (!opts.rules) return { table, warnings }
  // Limit cells substituted and flagged, and a note of what the rules did (`withCellRules`).
  const prepared: PreparedSheet = {
    sheet: { name: '', rows: [] },
    counts: data.counts,
    marks: data.marks,
  }
  const done = finishCellRules({ table, warnings }, prepared, opts.rules)
  return { table: done.table, warnings: done.warnings }
}

/** Reads a whole text at once (tests, small files): `CsvColumnReader` over it. */
export function readCsvColumns(text: string, opts: CsvColumnsOptions): CsvColumns {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const r = new CsvColumnReader(opts)
  r.push(body)
  return r.end()
}

/**
 * The delimiter and decimal separator of a file from its first lines (whole lines), as `readCsv`
 * decides them for a whole text: the large import's preview and the examples read files so.
 */
export function csvSettings(start: string): { delimiter: CsvDelimiter; decimal: DecimalSeparator } {
  const body = start.charCodeAt(0) === 0xfeff ? start.slice(1) : start
  const delimiter = sniffDelimiter(body)
  const records = parseRecords(body, delimiter === 'none' ? '' : delimiter)
  const detected = detectDecimal(records.flatMap((r) => r.map((f) => f.text)))
  const decimal: DecimalSeparator =
    delimiter === ';' ? (detected === '.' ? '.' : ',') : detected === ',' ? ',' : '.'
  return { delimiter, decimal }
}
