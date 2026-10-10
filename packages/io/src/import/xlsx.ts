import { strFromU8 } from 'fflate'
import { MAX_ENTRY_BYTES, unzipLimited, ZipTooLargeError } from '../zip.ts'
import { type ImportBudget, importBudget, takeCells } from './budget.ts'
import { ImportError } from './errors.ts'
import { padRows, type Sheet, type SheetCell } from './sheet.ts'
import { child, elements, localName, parseXml, scanXml, type XmlElement } from './xml.ts'

const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0]

/** Excel escapes control characters in strings as _xHHHH_. */
const unescapeOoxml = (s: string) =>
  s.includes('_x')
    ? s.replace(/_x([0-9A-Fa-f]{4})_/g, (_, h: string) =>
        String.fromCharCode(Number.parseInt(h, 16)),
      )
    : s

/** Text of a string item (<si> or <is>): plain <t>, or the runs of rich text; phonetic runs skipped. */
export function stringItem(el: XmlElement): string {
  let s = ''
  for (const c of elements(el)) {
    const name = localName(c.name)
    if (name === 't') s += textOf(c)
    else if (name === 'r') {
      const t = child(c, 't')
      if (t) s += textOf(t)
    }
  }
  return unescapeOoxml(s)
}

const textOf = (el: XmlElement) => el.children.map((c) => (typeof c === 'string' ? c : '')).join('')

// Built-in number formats that display dates or times.
const BUILTIN_DATE_FORMATS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51,
  52, 53, 54, 55, 56, 57, 58,
])

/** Whether a custom number format code displays a date or time. */
export function isDateFormatCode(code: string): boolean {
  const s = code
    .replace(/"[^"]*"/g, '') // literal text
    .replace(/\\./g, '') // escaped characters
    .replace(/\[(h+|m+|s+)\]/gi, 'h') // elapsed time counts as time
    .replace(/\[[^\]]*\]/g, '') // colours, conditions, locales
  if (/^general$/i.test(s.trim())) return false
  return /[dmyhs]/i.test(s)
}

/**
 * The number a date cell shows, when its format displays it as one. Typed "27.9" in a
 * day.month locale, Excel stores the date 27 September but shows "27.9" with the format "d.m", so
 * the sheet reads (and copies) as 27.9. Formats of a day and a month part joined by "." or ","
 * (d.m, dd.mm, m.d…) give that number; any other format, or a serial that is no date, gives null.
 * `date1904`: the workbook counts days from 1904.
 */
export function dateDisplayedAsNumber(
  serial: number,
  code: string,
  date1904 = false,
): number | null {
  const s = code
    .replace(/"[^"]*"/g, '')
    .replace(/\\(.)/g, '$1')
    .replace(/\[[^\]]*\]/g, '')
    .trim()
  const m = /^(d{1,2}|m{1,2})[.,](d{1,2}|m{1,2})$/i.exec(s)
  if (!m) return null
  const [a, b] = [m[1]!.toLowerCase(), m[2]!.toLowerCase()]
  if (a[0] === b[0]) return null
  // 1900 system: day 1 is 1 January 1900 and day 60 the 29 February 1900 that never was.
  const days = Math.floor(serial) + (date1904 ? 1462 : 0)
  if (!(days >= 1) || days === 60) return null
  const date = new Date(Date.UTC(1899, 11, days > 60 ? 30 : 31) + days * 86_400_000)
  const part = (p: string) => {
    const v = p[0] === 'd' ? date.getUTCDate() : date.getUTCMonth() + 1
    return p.length === 2 ? String(v).padStart(2, '0') : String(v)
  }
  return Number(`${part(a)}.${part(b)}`)
}

function resolvePath(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const parts = base.split('/').slice(0, -1)
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg !== '.' && seg !== '') parts.push(seg)
  }
  return parts.join('/')
}

function relsPath(part: string): string {
  const i = part.lastIndexOf('/')
  return `${part.slice(0, i + 1)}_rels/${part.slice(i + 1)}.rels`
}

/** A 1-based row number ("12") → 0-based index; null unless it is a whole number ≥ 1. */
function parseRowNumber(s: string): number | null {
  if (!/^\d{1,9}$/.test(s)) return null
  const n = Number(s)
  return n >= 1 ? n - 1 : null
}

/**
 * 'BC12' → [11, 54] (0-based row, column); null for anything malformed (e.g. 'A0'): an optional
 * '$', one to three ASCII letters, an optional '$', then a row number (`parseRowNumber`). Read
 * character by character (once per cell: a regular expression was a fifth of reading a sheet).
 */
export function parseRef(ref: string): [number, number] | null {
  const n = ref.length
  let i = ref.charCodeAt(0) === 36 /* $ */ ? 1 : 0
  const start = i
  let col = 0
  for (; i < n; i++) {
    const c = ref.charCodeAt(i) & ~32
    if (c < 65 || c > 90) break
    col = col * 26 + (c - 64)
  }
  if (i === start || i - start > 3) return null
  if (ref.charCodeAt(i) === 36) i++
  const digits = i
  for (; i < n; i++) {
    const c = ref.charCodeAt(i)
    if (c < 48 || c > 57) return null
  }
  if (i === digits || i - digits > 9) return null
  const row = Number(ref.slice(digits))
  return row >= 1 ? [row - 1, col - 1] : null
}

/** ISO 8601 date (cells of type "d") → spreadsheet serial day number (1900 system). */
function isoToSerial(iso: string): number | null {
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) || !iso.includes('T') ? iso : `${iso}Z`)
  if (Number.isNaN(t)) return null
  return t / 86_400_000 + 25_569
}

/**
 * Reads every worksheet of an .xlsx workbook. Cells keep their cached values: numbers, strings
 * (shared, inline, or formula results), and booleans; error values become empty. Date-formatted
 * numbers stay serial numbers and are counted in `dateCells`, except dates shown as a plain number
 * ("27.9" for 27 September under "d.m"), which read as that number (`datesAsNumbers`). Merged cells are not expanded.
 * The sheets' padded grids share one budget of cells, and the inflated parts one of bytes
 * (`budget`: an archive's workbooks share the archive's); a part several sheets name is read
 * once, for the first.
 */
export function readXlsx(bytes: Uint8Array, budget: ImportBudget = importBudget()): Sheet[] {
  if (OLE_MAGIC.every((b, i) => bytes[i] === b)) {
    throw new ImportError(
      'This is a legacy Excel (.xls) or password-protected workbook. Save it as .xlsx and try again.',
    )
  }
  let files: Record<string, Uint8Array>
  try {
    files = unzipLimited(
      bytes,
      (name) => /\.(xml|rels)$/i.test(name),
      { entry: MAX_ENTRY_BYTES, total: budget.bytes },
      (used) => {
        budget.bytes -= used
      },
    )
  } catch (e) {
    if (e instanceof ZipTooLargeError) {
      throw new ImportError(`This workbook is too large to import: ${e.message}`)
    }
    throw new ImportError('Not an Excel workbook (the file is not a valid .xlsx archive).')
  }
  const xml = (path: string): XmlElement | undefined => {
    const data = files[path]
    return data ? parseXml(strFromU8(data)) : undefined
  }
  const relationships = (part: string): Map<string, { target: string; type: string }> => {
    const map = new Map<string, { target: string; type: string }>()
    const rels = xml(relsPath(part))
    for (const r of rels ? elements(rels, 'Relationship') : []) {
      if (r.attrs.TargetMode === 'External') continue
      map.set(r.attrs.Id ?? '', {
        target: resolvePath(part, r.attrs.Target ?? ''),
        type: r.attrs.Type ?? '',
      })
    }
    return map
  }

  const rootRels = relationships('')
  const workbookPath =
    [...rootRels.values()].find((r) => r.type.endsWith('/officeDocument'))?.target ??
    'xl/workbook.xml'
  const workbook = xml(workbookPath)
  if (!workbook || localName(workbook.name) !== 'workbook') {
    throw new ImportError('Not an Excel workbook (no workbook part found).')
  }
  const wbRels = relationships(workbookPath)
  const relOfType = (suffix: string) =>
    [...wbRels.values()].find((r) => r.type.endsWith(suffix))?.target

  const sst = xml(relOfType('/sharedStrings') ?? 'xl/sharedStrings.xml')
  const sharedStrings = sst ? elements(sst, 'si').map(stringItem) : []

  // Which style indices (the s attribute) display dates: their format code ('' for built-in
  // date formats), or false.
  const dateStyles: (string | false)[] = []
  const styles = xml(relOfType('/styles') ?? 'xl/styles.xml')
  if (styles) {
    const custom = new Map<number, string>()
    const numFmts = child(styles, 'numFmts')
    for (const f of numFmts ? elements(numFmts, 'numFmt') : []) {
      custom.set(Number(f.attrs.numFmtId), f.attrs.formatCode ?? '')
    }
    const cellXfs = child(styles, 'cellXfs')
    for (const xf of cellXfs ? elements(cellXfs, 'xf') : []) {
      const id = Number(xf.attrs.numFmtId ?? 0)
      const code = custom.get(id)
      dateStyles.push(
        code !== undefined ? isDateFormatCode(code) && code : BUILTIN_DATE_FORMATS.has(id) && '',
      )
    }
  }

  const pr = child(workbook, 'workbookPr')
  const date1904 = pr?.attrs.date1904 === '1' || pr?.attrs.date1904 === 'true'

  const sheets: Sheet[] = []
  const sheetList = child(workbook, 'sheets')
  const read = new Set<string>()
  for (const s of sheetList ? elements(sheetList, 'sheet') : []) {
    const relId = Object.entries(s.attrs).find(([k]) => localName(k) === 'id')?.[1]
    const rel = relId ? wbRels.get(relId) : undefined
    if (!rel?.type.endsWith('/worksheet')) continue // chart sheets, dialog sheets
    if (read.has(rel.target)) continue
    read.add(rel.target)
    // Read as its text is scanned, not as a tree (audit 2, P13).
    const data = files[rel.target]
    if (!data) continue
    sheets.push(
      readWorksheet(
        s.attrs.name ?? `Sheet${sheets.length + 1}`,
        strFromU8(data),
        sharedStrings,
        dateStyles,
        date1904,
        budget,
      ),
    )
  }
  if (sheets.length === 0) throw new ImportError('The workbook has no worksheets.')
  return sheets
}

/**
 * What a worksheet's cells are read from, in document order: each `<row>` of its (first)
 * `<sheetData>` with its `r`, then each of the row's `<c>`: its attributes, the text of its first
 * `<v>` (undefined without one) and the text of its first `<is>` (null without one).
 */
export interface WorksheetVisitor {
  row(r: string | undefined): void
  cell(attrs: Readonly<Record<string, string>>, v: string | undefined, inline: string | null): void
}

/**
 * The worksheet's rows and cells read from its text as it is scanned (audit 2, P13), without a
 * tree of the sheet (a tree of every cell and value was half of reading a large workbook): what
 * walking `parseXml`'s tree gave (`<sheetData>` the root's first, its `<row>`s, their `<c>`s,
 * a cell's first `<v>` and `<is>`), which a test compares, with the same checks of the whole text
 * (`scanXml`). Depths: the root 0, `sheetData` 1, rows 2, cells 3, `v` and `is` 4, an
 * inline string's `t` and `r` 5, a run's `t` 6.
 */
export function visitWorksheet(text: string, visit: WorksheetVisitor): void {
  /** 0: before the root, 1: in the root (the first element), 2: after it. */
  let root = 0
  /** The first `sheetData` (a child of the root): 0 before, 1 in it, 2 after. */
  let sheetData = 0
  let inRow = false
  let cell: { attrs: Record<string, string>; v: string | undefined; is: string | null } | null =
    null
  /** The value (`v`) and inline string (`is`) read so far: 0 none yet, 1 in it, 2 read. */
  let vState = 0
  let isState = 0
  let isText = ''
  /** What is open at depth 4 (`v`, `is` or another) and at 5 (`t`, `r` or another). */
  let at4 = ''
  let at5 = ''
  /** A run's first `t`: 0 none yet, 1 in it, 2 read. */
  let runT = 0
  const endCell = () => {
    visit.cell(cell!.attrs, cell!.v, cell!.is)
    cell = null
  }
  scanXml(text, {
    open(name, attrs, selfClosing, depth) {
      if (depth === 0) {
        if (root === 0) root = selfClosing ? 2 : 1
        return
      }
      if (root !== 1) return
      const local = localName(name)
      if (depth === 1) {
        if (sheetData === 0 && local === 'sheetData') sheetData = selfClosing ? 2 : 1
      } else if (depth === 2) {
        if (sheetData === 1 && local === 'row') {
          visit.row(attrs.r)
          inRow = !selfClosing
        }
      } else if (depth === 3) {
        if (inRow && local === 'c') {
          cell = { attrs, v: undefined, is: null }
          vState = 0
          isState = 0
          if (selfClosing) endCell()
        }
      } else if (!cell) return
      else if (depth === 4) {
        at4 = ''
        if (local === 'v' && vState === 0) {
          cell.v = ''
          vState = selfClosing ? 2 : 1
          if (!selfClosing) at4 = 'v'
        } else if (local === 'is' && isState === 0) {
          isText = ''
          if (selfClosing) {
            cell.is = ''
            isState = 2
          } else {
            isState = 1
            at4 = 'is'
          }
        }
      } else if (depth === 5) {
        at5 = ''
        if (at4 === 'is' && !selfClosing && (local === 't' || local === 'r')) {
          at5 = local
          runT = 0
        }
      } else if (depth === 6) {
        if (at5 === 'r' && runT === 0 && local === 't') runT = selfClosing ? 2 : 1
      }
    },
    close(_name, depth) {
      if (depth === 0) {
        if (root === 1) root = 2
      } else if (root !== 1) return
      else if (depth === 1) {
        if (sheetData === 1) sheetData = 2
      } else if (depth === 2) inRow = false
      else if (depth === 3) {
        if (cell) endCell()
      } else if (!cell) return
      else if (depth === 4) {
        if (at4 === 'v') vState = 2
        else if (at4 === 'is') {
          cell.is = unescapeOoxml(isText)
          isState = 2
        }
        at4 = ''
      } else if (depth === 5) at5 = ''
      else if (depth === 6) {
        if (runT === 1) runT = 2
      }
    },
    text(s, depth) {
      if (!cell) return
      if (depth === 5) {
        if (at4 === 'v') cell.v += s
      } else if (depth === 6) {
        if (at5 === 't') isText += s
      } else if (depth === 7) {
        if (runT === 1) isText += s
      }
    },
  })
}

function readWorksheet(
  name: string,
  ws: string,
  sharedStrings: readonly string[],
  dateStyles: readonly (string | false)[],
  date1904: boolean,
  budget: ImportBudget,
): Sheet {
  // Cells kept as three lists (no array per cell) until the budget has taken the grid.
  const cellRows: number[] = []
  const cellCols: number[] = []
  const cellValues: SheetCell[] = []
  let dateCells = 0
  let shownNumbers = 0
  /** A date: the number it shows (counted), or its serial (counted as a date). */
  const dated = (serial: number, style: string | false | undefined): number => {
    const shown = style ? dateDisplayedAsNumber(serial, style, date1904) : null
    if (shown === null) {
      dateCells++
      return serial
    }
    shownNumbers++
    return shown
  }
  let maxRow = -1
  let maxCol = -1
  let rowIndex = -1
  let colIndex = -1
  const visitor: WorksheetVisitor = {
    row(r) {
      // Malformed row and cell references are ignored (the position follows the previous one).
      rowIndex = (r ? parseRowNumber(r) : null) ?? rowIndex + 1
      colIndex = -1
    },
    cell(attrs, raw, inline) {
      const ref = attrs.r ? parseRef(attrs.r) : null
      if (ref) {
        rowIndex = ref[0]
        colIndex = ref[1]
      } else colIndex++
      let value: SheetCell = null
      switch (attrs.t ?? 'n') {
        case 's':
          value = raw === undefined ? null : (sharedStrings[Number(raw)] ?? null)
          break
        case 'str':
          value = raw === undefined ? null : unescapeOoxml(raw)
          break
        case 'inlineStr':
          value = inline
          break
        case 'b':
          value = raw === undefined ? null : raw.trim() === '1' || raw.trim() === 'true'
          break
        case 'e':
          value = null
          break
        case 'd': {
          const serial = raw === undefined ? null : isoToSerial(raw.trim())
          value = serial === null ? null : dated(serial, dateStyles[Number(attrs.s ?? 0)])
          break
        }
        default: {
          const n = raw === undefined || raw.trim() === '' ? Number.NaN : Number(raw)
          value = Number.isFinite(n) ? n : null
          const style = dateStyles[Number(attrs.s ?? 0)]
          if (value !== null && style !== false && style !== undefined) value = dated(value, style)
        }
      }
      if (typeof value === 'string' && value.trim() === '') value = null
      if (value === null) return
      cellRows.push(rowIndex)
      cellCols.push(colIndex)
      cellValues.push(value)
      if (rowIndex > maxRow) maxRow = rowIndex
      if (colIndex > maxCol) maxCol = colIndex
    },
  }
  visitWorksheet(ws, visitor)
  takeCells(budget, name, maxRow + 1, maxCol + 1)
  const rows: SheetCell[][] = Array.from({ length: maxRow + 1 }, () =>
    Array.from({ length: maxCol + 1 }, () => null),
  )
  for (let k = 0; k < cellValues.length; k++) rows[cellRows[k]!]![cellCols[k]!] = cellValues[k]!
  const sheet: Sheet = { name, rows: padRows(rows) }
  if (dateCells) sheet.dateCells = dateCells
  if (shownNumbers) sheet.datesAsNumbers = shownNumbers
  return sheet
}
