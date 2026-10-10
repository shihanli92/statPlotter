import type { AxisScale, NumberDisplay, RichText } from '@ps/model'

/**
 * Number formatting for axis tick labels (and anything else showing numbers the way an axis
 * does). Output is rich text so powers of ten get a real superscript run.
 */

const MINUS = '−'
const TIMES = '×'

const minus = (s: string) => (s.startsWith('-') ? MINUS + s.slice(1) : s)

/** Groups the integer part of a plain decimal string in thousands ("1234567.5" → "1,234,567.5"). */
function group(s: string): string {
  const neg = s.startsWith('-') || s.startsWith(MINUS)
  const body = neg ? s.slice(1) : s
  const [int, frac] = body.split('.') as [string, string | undefined]
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return (neg ? s[0] : '') + grouped + (frac === undefined ? '' : `.${frac}`)
}

/** Fixed decimals with a true minus sign; values that round to zero print as 0, never −0. */
export function tickText(v: number, decimals: number): string {
  const s = Math.abs(v) < 10 ** -(decimals + 2) ? (0).toFixed(decimals) : v.toFixed(decimals)
  return minus(/^-0(\.0*)?$/.test(s) ? s.slice(1) : s)
}

/**
 * Fewest decimals (≤ 10) that represent every value exactly. The tolerance is relative for
 * small magnitudes, so 2e-11 needs 11 decimals rather than rounding to 0.
 */
export function decimalsFor(values: readonly number[]): number {
  for (let d = 0; d <= 10; d++) {
    if (
      values.every((v) => {
        const x = v * 10 ** d
        return Math.abs(Math.round(x) - x) <= 1e-6 * Math.min(1, Math.abs(x))
      })
    )
      return d
  }
  return 10
}

/** Fewest mantissa decimals (≤ 6) giving every value exactly in scientific notation. */
function mantissaDecimals(values: readonly number[]): number {
  for (let d = 0; d <= 6; d++) {
    if (
      values.every((v) => {
        if (v === 0 || !Number.isFinite(v)) return true
        const back = Number(v.toExponential(d))
        return Math.abs(back - v) <= Math.abs(v) * 1e-9
      })
    )
      return d
  }
  return 6
}

/** Mantissa and exponent strings of v with `d` mantissa decimals (exponent without '+'). */
function sci(v: number, d: number): { m: string; e: number } {
  const [m, e] = v.toExponential(d).split('e') as [string, string]
  return { m: minus(m), e: Number(e) }
}

const exponent = (e: number) => (e < 0 ? MINUS + String(-e) : String(e))

/** Log-axis tick label: plain numbers for moderate decades, otherwise the base with a superscript. */
export function logTickText(v: number, base: 10 | 2): RichText {
  const e = Math.round(base === 10 ? Math.log10(v) : Math.log2(v))
  if (base === 10 && e >= -3 && e <= 4) return [{ text: tickText(v, Math.max(0, -e)) }]
  return [{ text: String(base) }, { text: exponent(e), sup: true }]
}

/**
 * Roadmap 34g: a cytometry axis' tick label (arcsinh, logicle): 0, decades of 1,000 and more as
 * 10ⁿ (−10ⁿ below zero) as FlowJo labels them, smaller values as plain numbers.
 */
export function cytoTickText(v: number): RichText {
  if (v === 0) return [{ text: '0' }]
  const a = Math.abs(v)
  const e = Math.round(Math.log10(a))
  if (e >= 3 && Math.abs(10 ** e - a) <= a * 1e-9)
    return [{ text: v < 0 ? `${MINUS}10` : '10' }, { text: exponent(e), sup: true }]
  return [{ text: tickText(v, decimalsFor([v])) }]
}

export interface NumberFormatOptions {
  /** Decimals for 'auto' mode (and 'percent' without digits); default: fewest that show v exactly. */
  decimals?: number
  /** Mantissa decimals for 'power10' without digits; default: fewest that show v exactly. */
  mantissa?: number
  /** Log axis base: 'auto' uses decade labels, 'power10' shows the bare power (10ⁿ / 2ⁿ). */
  log?: 10 | 2
  /** Roadmap 34g: a cytometry axis: 'auto' labels 0 and ±10ⁿ (`cytoTickText`). */
  cyto?: boolean
}

/**
 * Formats one number for display.
 *
 * - `auto`: plain decimals (the fewest that show the value, or `options.decimals`); on log axes,
 *   plain numbers for 10⁻³…10⁴ and 10ⁿ beyond.
 * - `fixed`: `digits` decimals (default 0).
 * - `scientific`: 1.5e+3 with `digits` mantissa decimals (default 1).
 * - `power10`: 1.5×10³ with a superscript exponent (`digits` mantissa decimals, default the
 *   fewest needed); on log axes an exact power of the base prints as 10ⁿ (or 2ⁿ) alone.
 * - `percent`: value × 100 with `digits` decimals (default the fewest needed) and a % sign.
 *
 * `thousands` groups the integer part with commas (auto, fixed, percent); `prefix` and `suffix`
 * are added around the number. Negative numbers use a true minus sign.
 */
export function formatNumber(
  v: number,
  format: NumberDisplay,
  options: NumberFormatOptions = {},
): RichText {
  const body = formatBody(v, format, options)
  const out: RichText = []
  if (format.prefix) out.push({ text: format.prefix })
  out.push(...body)
  if (format.suffix) out.push({ text: format.suffix })
  return out
}

function formatBody(v: number, format: NumberDisplay, options: NumberFormatOptions): RichText {
  if (!Number.isFinite(v)) return [{ text: Number.isNaN(v) ? '' : v > 0 ? '∞' : `${MINUS}∞` }]
  const thousands = (s: string) => (format.thousands ? group(s) : s)
  const log = options.log
  switch (format.mode) {
    case 'auto': {
      if (options.cyto) return cytoTickText(v)
      if (log) return logTickText(v, log)
      return [{ text: thousands(tickText(v, options.decimals ?? decimalsFor([v]))) }]
    }
    case 'fixed':
      return [{ text: thousands(tickText(v, format.digits ?? options.decimals ?? 0)) }]
    case 'scientific': {
      const { m, e } = sci(v, format.digits ?? 1)
      return [{ text: `${m}e${e < 0 ? '-' : '+'}${Math.abs(e)}` }]
    }
    case 'percent': {
      const p = v * 100
      const d = format.digits ?? options.decimals ?? decimalsFor([p])
      return [{ text: `${thousands(tickText(p, d))}%` }]
    }
    case 'power10': {
      if (v === 0) return [{ text: '0' }]
      if (log && format.digits === undefined) {
        const e = Math.round(log === 10 ? Math.log10(v) : Math.log2(v))
        if (v > 0 && Math.abs(log ** e - v) <= v * 1e-9)
          return [{ text: String(log) }, { text: exponent(e), sup: true }]
      }
      const d = format.digits ?? options.mantissa ?? mantissaDecimals([v])
      const { m, e } = sci(v, d)
      return [{ text: `${m}${TIMES}10` }, { text: exponent(e), sup: true }]
    }
  }
}

/** 'auto' on a linear axis switches to powers of ten beyond these magnitudes. */
export const AUTO_POWER10 = { below: 1e-4, atOrAbove: 1e7 } as const

/**
 * A formatter for a set of tick values that share decimals (0, 0.5, 1.0 rather than 0, 0.5, 1),
 * e.g. an axis' tick labels. 'auto' on a linear axis shows powers of ten when every value is
 * tiny (< 10⁻⁴) or any is huge (≥ 10⁷); 'fixed' without digits on a log axis uses as many
 * decimals as the smallest tick needs.
 */
export function tickFormatter(
  format: NumberDisplay,
  values: readonly number[],
  scale: AxisScale = 'linear',
): (v: number) => RichText {
  const log = scale === 'log10' ? 10 : scale === 'log2' ? 2 : undefined
  const cyto = scale === 'arcsinh' || scale === 'logicle'
  let fmt = format
  if (cyto && fmt.mode === 'auto') return (v) => formatNumber(v, fmt, { cyto })
  if (fmt.mode === 'auto' && !log) {
    const big = Math.max(0, ...values.filter(Number.isFinite).map(Math.abs))
    if (big > 0 && (big < AUTO_POWER10.below || big >= AUTO_POWER10.atOrAbove))
      fmt = { ...fmt, mode: 'power10' }
  }
  const options: NumberFormatOptions = { log }
  if (fmt.mode === 'auto') options.decimals = decimalsFor(values)
  if (fmt.mode === 'fixed' && log) options.decimals = decimalsFor(values)
  if (fmt.mode === 'percent') options.decimals = decimalsFor(values.map((v) => v * 100))
  if (fmt.mode === 'power10') options.mantissa = mantissaDecimals(values)
  return (v) => formatNumber(v, fmt, options)
}

/** Plain text of rich text (superscripts written with ^), e.g. for previews and tooltips. */
export function richTextToString(content: RichText): string {
  return content.map((r) => (r.sup ? `^${r.text}` : r.sub ? `_${r.text}` : r.text)).join('')
}
