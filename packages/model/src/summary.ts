import type { ResultBlock, ResultValue, SummaryPart } from './analysis.ts'
import { formatP, pSummary } from './format.ts'
import type { ProjectSettings } from './project.ts'

// Roadmap 51d (design §8.2, U18, U26): the results' summary sentences as text. A summary block
// holds text and values; values are written here, as the reader sees them: numbers to three
// significant digits (no trailing zeros, no exponent where a unit prefix can carry the scale:
// 7.999e-9 M is "8 nM"), P values in the project's P style after "P =" or "P <", intervals as
// "95% CI 4.3 to 18.7", with the data's unit.

type PSettings = Pick<ProjectSettings, 'pValueStyle' | 'pValueDigits'>

const SI_PREFIXES: readonly [number, string][] = [
  [1e-15, 'f'],
  [1e-12, 'p'],
  [1e-9, 'n'],
  [1e-6, 'µ'],
  [1e-3, 'm'],
]
/** Units a prefix can scale (molar concentrations, amounts, masses, volumes). */
const SCALABLE = new Set(['M', 'mol', 'g', 'L'])

/** The factor and unit that write values of this size in a scalable unit in 1–999. */
function scaleFor(size: number, unit: string | undefined): { factor: number; unit: string } {
  if (!unit || !SCALABLE.has(unit) || !Number.isFinite(size) || size === 0 || size >= 1)
    return { factor: 1, unit: unit ?? '' }
  for (const [f, p] of SI_PREFIXES) if (size < f * 1000) return { factor: f, unit: p + unit }
  return { factor: 1, unit }
}

const SUPERSCRIPT: Record<string, string> = {
  '-': '⁻',
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
}

/**
 * A number to `sig` significant digits without trailing zeros ("11.5", "0.0042", "1,250" stays
 * "1250"); "—" when undefined, "∞" when infinite; scientific only beyond 1e-4 and 1e9.
 */
export function readableNumber(v: number, sig = 3): string {
  if (Number.isNaN(v)) return '—'
  if (!Number.isFinite(v)) return v > 0 ? '∞' : '−∞'
  if (v === 0) return '0'
  const mag = Math.floor(Math.log10(Math.abs(v)))
  const minus = v < 0 ? '−' : ''
  if (mag < -4 || mag >= 9) {
    const [m, e] = Math.abs(v)
      .toExponential(sig - 1)
      .split('e')
    const sup = [...String(Number(e))].map((c) => SUPERSCRIPT[c] ?? c).join('')
    return `${minus}${String(Number(m))} × 10${sup}`
  }
  const decimals = Math.min(15, Math.max(0, sig - 1 - mag))
  return minus + String(Number(Math.abs(v).toFixed(decimals)))
}

/** A number with its unit, a prefix carrying the scale where the unit takes one ("8 nM"). */
export function numberWithUnit(v: number, unit?: string, sig = 3): string {
  const s = scaleFor(Math.abs(v), unit)
  const text = readableNumber(v / s.factor, sig)
  return s.unit && Number.isFinite(v) ? `${text} ${s.unit}` : text
}

/** "P = 0.0014", "P < 0.0001" (the project's style), "P = —" when undefined; or "q = …". */
export function pText(p: number, settings: PSettings, letter = 'P'): string {
  const f = formatP(p, settings)
  if (f.startsWith('<')) return `${letter} < ${f.slice(1)}`
  if (f.startsWith('>')) return `${letter} > ${f.slice(1)}`
  return `${letter} = ${f}`
}

/** A value of a summary as text. */
export function summaryValueText(part: Exclude<SummaryPart, string>, settings: PSettings): string {
  const v: ResultValue = part.value
  switch (v.kind) {
    case 'pvalue':
      return part.role === 'p'
        ? pText(v.v, settings)
        : part.role === 'q'
          ? pText(v.v, settings, 'q')
          : formatP(v.v, settings)
    case 'pSummary':
      return pSummary(v.v, settings.pValueStyle)
    case 'number':
      return numberWithUnit(v.v, part.unit, v.digits ?? 3)
    case 'integer':
      return Number.isFinite(v.v) ? String(Math.round(v.v)) : '—'
    case 'interval': {
      const s = scaleFor(Math.max(Math.abs(v.lo), Math.abs(v.hi)), part.unit)
      const lo = readableNumber(v.lo / s.factor)
      const hi = readableNumber(v.hi / s.factor)
      const unit = s.unit ? ` ${s.unit}` : ''
      const level = `${+(v.level * 100).toFixed(2)}% CI`
      const range =
        Number.isFinite(v.hi) || Number.isNaN(v.hi)
          ? `${lo} to ${hi}${unit}`
          : `${lo}${unit} to infinity`
      return part.role === 'ci' ? `${level} ${range}` : range
    }
    case 'text':
      return v.v
    case 'bool':
      return v.v ? 'yes' : 'no'
  }
}

/** A summary block's sentence(s) as text (the accessible answer, the copy, the export). */
export function summaryText(
  block: Extract<ResultBlock, { type: 'summary' }>,
  settings: PSettings,
): string {
  return block.parts
    .map((p) => (typeof p === 'string' ? p : summaryValueText(p, settings)))
    .join('')
}

/** The summary block of a result, if it has one (in its first sheet). */
export function resultSummary(
  sheets: readonly { blocks: readonly ResultBlock[] }[],
): Extract<ResultBlock, { type: 'summary' }> | null {
  for (const s of sheets) for (const b of s.blocks) if (b.type === 'summary') return b
  return null
}

/** A sheet's blocks with its summary first (it is stored after them; it is read first). */
export function summaryFirst<B extends { type: string }>(blocks: readonly B[]): B[] {
  return [
    ...blocks.filter((b) => b.type === 'summary'),
    ...blocks.filter((b) => b.type !== 'summary'),
  ]
}
