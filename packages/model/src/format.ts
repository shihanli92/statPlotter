import type { ResultValue } from './analysis.ts'
import type { ProjectSettings } from './project.ts'

type PStyle = ProjectSettings['pValueStyle']

interface PStyleDef {
  /** Asterisk thresholds, most significant first. */
  stars: readonly [threshold: number, label: string][]
  format: (p: number, digits: number) => string
}

const trimLeadingZero = (s: string) => s.replace(/^0\./, '.')

/** P at `digits` decimals; one that would round up to 1 reads ">0.99…" (as Prism does). */
function fixedP(p: number, digits: number): string {
  const s = p.toFixed(digits)
  return Number(s) >= 1 ? `>${(1 - 10 ** -digits).toFixed(digits)}` : s
}

const P_STYLES: Record<PStyle, PStyleDef> = {
  // GraphPad style: up to four asterisks; P < 0.0001 reported as "<0.0001".
  GP: {
    stars: [
      [0.0001, '****'],
      [0.001, '***'],
      [0.01, '**'],
      [0.05, '*'],
    ],
    format: (p, digits) => {
      const floor = 10 ** -digits
      return p < floor ? `<${floor.toFixed(digits)}` : fixedP(p, digits)
    },
  },
  // APA: no leading zero, three decimals, "<.001".
  APA: {
    stars: [
      [0.001, '***'],
      [0.01, '**'],
      [0.05, '*'],
    ],
    format: (p) => {
      if (p < 0.001) return '<.001'
      const s = fixedP(p, 3)
      return s.startsWith('>') ? `>${trimLeadingZero(s.slice(1))}` : trimLeadingZero(s)
    },
  },
  // NEJM: "<0.001"; three decimals below 0.01, otherwise two.
  NEJM: {
    stars: [
      [0.001, '***'],
      [0.01, '**'],
      [0.05, '*'],
    ],
    format: (p) => (p < 0.001 ? '<0.001' : p < 0.01 ? p.toFixed(3) : fixedP(p, 2)),
  },
}

export function formatP(
  p: number,
  settings: Pick<ProjectSettings, 'pValueStyle' | 'pValueDigits'>,
): string {
  if (Number.isNaN(p)) return '—'
  return P_STYLES[settings.pValueStyle].format(p, settings.pValueDigits)
}

/** 'ns', '*', '**', … per the project's P value style. */
export function pSummary(p: number, style: PStyle): string {
  if (Number.isNaN(p)) return '—'
  for (const [threshold, label] of P_STYLES[style].stars) if (p <= threshold) return label
  return 'ns'
}

/**
 * About `sig` significant digits, never dropping integer digits; scientific notation for very
 * large or very small magnitudes. Trailing zeros are kept so columns of results line up.
 */
export function formatNumber(v: number, sig = 4): string {
  if (Number.isNaN(v)) return '—'
  if (!Number.isFinite(v)) return v > 0 ? '∞' : '-∞'
  if (v === 0) return '0'
  const mag = Math.floor(Math.log10(Math.abs(v)))
  if (mag < -4 || mag >= 9) return v.toExponential(sig - 1)
  const decimals = Math.min(8, Math.max(0, sig - 1 - mag))
  return v.toFixed(decimals)
}

export function formatResultValue(
  value: ResultValue,
  settings: Pick<ProjectSettings, 'pValueStyle' | 'pValueDigits'>,
): string {
  switch (value.kind) {
    case 'number':
      return formatNumber(value.v, value.digits ?? 4)
    case 'integer':
      return Number.isFinite(value.v) ? String(Math.round(value.v)) : formatNumber(value.v)
    case 'pvalue':
      return formatP(value.v, settings)
    case 'pSummary':
      return pSummary(value.v, settings.pValueStyle)
    case 'interval':
      return `${formatNumber(value.lo)} to ${formatNumber(value.hi)}`
    case 'text':
      return value.v
    case 'bool':
      return value.v ? 'Yes' : 'No'
  }
}
