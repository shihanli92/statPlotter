/**
 * Number parsing for pasted and imported text, with a decimal point (1,234.5) or a decimal
 * comma (1.234,5), and a detector that decides between the two from the data.
 */

export type DecimalSeparator = '.' | ','

const normalize = (s: string) => s.trim().replace(/−/g, '-')

/** Comma thousands grouping: the first group has no leading zero ("0,125" is not grouped). */
const DOT_DECIMAL = /^[+-]?([1-9]\d{0,2}(,\d{3})+|\d+)?(\.\d*)?([eE][+-]?\d+)?$/

/**
 * Accepts plain and scientific notation, thousands separators ("1,234.5"), a leading '+', and
 * unicode minus. Rejects anything that isn't a whole number token (e.g. "12 mg", "1.2.3", and
 * "0,125", which is a decimal comma rather than thousands).
 */
export function parseNumber(s: string): number | null {
  const t = normalize(s)
  if (!DOT_DECIMAL.test(t) || !/\d/.test(t)) return null
  const n = Number(t.replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

const PLAIN_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/
const DECIMAL_COMMA = /^[+-]?([1-9]\d{0,2}(\.\d{3})+|\d*),\d+([eE][+-]?\d+)?$/
/** "1.500" in decimal-comma data: thousands grouping, i.e. 1500. */
const DOT_GROUPED = /^[+-]?[1-9]\d{0,2}(\.\d{3})+$/

/**
 * Numbers written with a decimal comma ("1,5", "1.234,5"); dots group thousands ("1.500" is
 * 1500). Other plain numbers ("1.5") are also accepted.
 */
export function parseDecimalCommaNumber(raw: string): number | null {
  const s = normalize(raw)
  let t: string
  if (DECIMAL_COMMA.test(s)) t = s.replace(/\./g, '').replace(',', '.')
  else if (DOT_GROUPED.test(s)) t = s.replace(/\./g, '')
  else if (PLAIN_NUMBER.test(s)) t = s
  else return null
  const v = Number(t)
  return Number.isFinite(v) ? v : null
}

export function parseNumberWith(s: string, decimal: DecimalSeparator): number | null {
  return decimal === ',' ? parseDecimalCommaNumber(s) : parseNumber(s)
}

const COMMA_FRACTION = /^[+-]?\d+,\d+([eE][+-]?\d+)?$/
const COMMA_GROUPED = /^[+-]?[1-9]\d{0,2}(,\d{3})+$/
const DOT_GROUPED_COMMA_FRACTION = /^[+-]?[1-9]\d{0,2}(\.\d{3})+,\d+([eE][+-]?\d+)?$/

/**
 * Which decimal separator the cells use: ',' when some cell can only be a decimal comma ("1,5",
 * "0,125", "1.234,5") and none uses a decimal point; '.' for the reverse; null when there is no
 * evidence either way or the evidence conflicts. "1,250" and "1.500" are ambiguous and don't count.
 */
export function detectDecimal(cells: Iterable<string>): DecimalSeparator | null {
  let comma = false
  let dot = false
  for (const raw of cells) {
    if (!raw) continue
    const s = normalize(raw)
    if (!/\d/.test(s)) continue
    if ((COMMA_FRACTION.test(s) && !COMMA_GROUPED.test(s)) || DOT_GROUPED_COMMA_FRACTION.test(s)) {
      comma = true
    } else if (s.includes('.') && !DOT_GROUPED.test(s) && parseNumber(s) !== null) {
      dot = true
    }
    if (comma && dot) return null
  }
  return comma ? ',' : dot ? '.' : null
}
