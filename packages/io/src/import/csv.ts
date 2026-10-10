import { type DecimalSeparator, detectDecimal, parseNumberWith } from '../numbers.ts'
import { checkPadding, type ImportBudget, takeCells } from './budget.ts'
import type { Sheet, SheetCell } from './sheet.ts'
import { padRows } from './sheet.ts'

/** 'none': one column per line (e.g. a single column of decimal-comma numbers). */
export type CsvDelimiter = ',' | '\t' | ';' | 'none'

export interface CsvOptions {
  /** 'auto' (default) sniffs tab, comma, or semicolon from the first lines. */
  delimiter?: 'auto' | CsvDelimiter
  /**
   * 'auto' (default): a decimal comma in semicolon files unless the numbers use a decimal point;
   * otherwise a decimal point unless the numbers can only be read with a decimal comma.
   */
  decimal?: 'auto' | DecimalSeparator
  /** Sheet name (default 'Sheet1'). */
  name?: string
}

export interface Field {
  text: string
  quoted: boolean
}

/**
 * Splits text into records (RFC 4180): fields may be quoted, quotes inside are doubled, and
 * quoted fields may contain delimiters and line breaks. Accepts LF, CRLF, and CR line endings.
 * A trailing line break does not start a new record.
 */
export function parseRecords(
  text: string,
  delim: string,
  maxRecords = Number.POSITIVE_INFINITY,
): Field[][] {
  const records: Field[][] = []
  const n = text.length
  let i = 0
  while (i < n && records.length < maxRecords) {
    const record: Field[] = []
    for (;;) {
      let field: Field
      if (text[i] === '"') {
        let s = ''
        let j = i + 1
        for (;;) {
          const q = text.indexOf('"', j)
          if (q < 0) {
            // Unterminated quote: take the rest of the text.
            s += text.slice(j)
            j = n
            break
          }
          s += text.slice(j, q)
          if (text[q + 1] === '"') {
            s += '"'
            j = q + 2
          } else {
            j = q + 1
            break
          }
        }
        // Anything between the closing quote and the delimiter is kept (lenient).
        let k = j
        while (k < n && text[k] !== delim && text[k] !== '\n' && text[k] !== '\r') k++
        field = { text: s + text.slice(j, k), quoted: true }
        i = k
      } else {
        let k = i
        while (k < n && text[k] !== delim && text[k] !== '\n' && text[k] !== '\r') k++
        field = { text: text.slice(i, k), quoted: false }
        i = k
      }
      record.push(field)
      if (i < n && text[i] === delim) {
        i++
        continue
      }
      // End of record.
      if (text[i] === '\r') i++
      if (text[i] === '\n') i++
      break
    }
    records.push(record)
  }
  return records
}

const PRIORITY = ['\t', ';', ','] as const

const INT_PAIR = /^[+-]?\d+,\d+$/

/**
 * One column of decimal-comma numbers ("Wert\n1,5\n2,25") looks like two integer columns when
 * split on commas. It is one column when there is no tab or semicolon and every line is two
 * integers joined by a comma, below a header without a comma. Without a header it's ambiguous
 * (1,5 could be two counts), so a leading zero after the comma ("1,05") is required as evidence.
 */
function isDecimalCommaColumn(sample: string): boolean {
  if (/[\t;]/.test(sample)) return false
  const lines = sample
    .split(/\r\n?|\n/)
    .slice(0, 50)
    .map((l) => l.trim())
    .filter((l) => l !== '')
  if (lines.length === 0) return false
  const [first, ...rest] = lines
  if (!first!.includes(',')) return rest.length > 0 && rest.every((l) => INT_PAIR.test(l))
  return lines.every((l) => INT_PAIR.test(l)) && lines.some((l) => /,0\d/.test(l))
}

/**
 * Picks the delimiter that splits the first lines into the most consistent number of fields
 * (at least two). Ties go to tab, then semicolon (so decimal commas in a semicolon file don't
 * look like delimiters), then comma. A single column of decimal-comma numbers gives 'none'.
 * Other single-column text defaults to comma.
 */
export function sniffDelimiter(text: string): CsvDelimiter {
  const sample = text.slice(0, 65536)
  if (isDecimalCommaColumn(sample)) return 'none'
  let best: CsvDelimiter = ','
  let bestScore = 0
  for (const d of PRIORITY) {
    const counts = parseRecords(sample, d, 50)
      .filter((r) => r.length > 1 || r[0]!.text.trim() !== '')
      .map((r) => r.length)
    if (counts.length === 0) continue
    const freq = new Map<number, number>()
    for (const c of counts) freq.set(c, (freq.get(c) ?? 0) + 1)
    let mode = 0
    let modeFreq = 0
    for (const [c, f] of freq) {
      if (f > modeFreq || (f === modeFreq && c > mode)) {
        mode = c
        modeFreq = f
      }
    }
    if (mode < 2) continue
    const score = modeFreq / counts.length
    if (score > bestScore) {
      best = d
      bestScore = score
    }
  }
  return best
}

/**
 * Reads delimited text (CSV, TSV, semicolon-separated) into one rectangular sheet. `budget`: the
 * import's cells, which the padded grid is taken from before it is padded (a long line over many
 * short ones would pad to far more cells than the text holds). Without one (a file on its own),
 * the padded grid may not be far larger than the cells read (`checkPadding`).
 */
export function readCsv(text: string, opts: CsvOptions = {}, budget?: ImportBudget): Sheet {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const delim = !opts.delimiter || opts.delimiter === 'auto' ? sniffDelimiter(body) : opts.delimiter
  // 'none': a delimiter that never matches, so each line is one field.
  const records = parseRecords(body, delim === 'none' ? '' : delim)
  let decimal: DecimalSeparator
  if (opts.decimal && opts.decimal !== 'auto') decimal = opts.decimal
  else {
    const detected = detectDecimal(records.flatMap((r) => r.map((f) => f.text)))
    decimal = delim === ';' ? (detected === '.' ? '.' : ',') : detected === ',' ? ',' : '.'
  }
  const rows: SheetCell[][] = records.map((record) =>
    record.map(({ text: raw, quoted }): SheetCell => {
      const s = quoted ? raw : raw.trim()
      if (s.trim() === '') return null
      return parseNumberWith(s, decimal) ?? s
    }),
  )
  const name = opts.name ?? 'Sheet1'
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0)
  if (budget) takeCells(budget, name, rows.length, width)
  else
    checkPadding(
      name,
      rows.length,
      width,
      rows.reduce((n, r) => n + r.length, 0),
    )
  return { name, rows: padRows(rows) }
}
