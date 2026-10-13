import type { Check, CheckFix, Diagnostic, DiagnosticFix, NormalizedDataSet } from '@ps/model'
import { type EquationMeta, equationMeta } from './explain/equations.ts'

// Roadmap 51e (design §9.2, §9.3, S8): what a curve fit says about its X before the fit (the X
// scale a model expects against the X the table holds) and about dose-response numbers after it
// (a midpoint outside the doses, a plateau the data don't reach, a midpoint the data don't
// determine, too few doses, an ambiguous fit) — each with what to do and, where one exists, a
// one-click fix. Descriptive rules on the table and on fitted numbers: no new statistic.

/** What X looks like: its range and whether it reads as log(concentration) or concentrations. */
export interface XLooks {
  min: number
  max: number
  /** Some X < 0, every X within −15 … 0, spanning 1 to 8 units (log molar). */
  looksLog: boolean
  /**
   * Every X ≥ 0, at least two positive, the positive ones spanning a factor of 100 or more
   * (concentrations or doses, zeros allowed: a vehicle).
   */
  looksConcentration: boolean
  /** How many X values are 0 (no logarithm). */
  zeros: number
}

/** The look of a set of X values (finite ones; null when there are none). */
export function xLooks(values: Iterable<number>): XLooks | null {
  const x = [...values].filter(Number.isFinite)
  if (!x.length) return null
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  let posMin = Number.POSITIVE_INFINITY
  let posMax = 0
  let positive = 0
  let zeros = 0
  for (const v of x) {
    if (v < min) min = v
    if (v > max) max = v
    if (v > 0) {
      positive++
      if (v < posMin) posMin = v
      if (v > posMax) posMax = v
    } else if (v === 0) zeros++
  }
  return {
    min,
    max,
    looksLog: min < 0 && min >= -15 && max <= 0 && max - min >= 1 && max - min <= 8,
    looksConcentration: min >= 0 && positive >= 2 && posMax / posMin >= 100,
    zeros,
  }
}

/** A number for a message: "1e-10", "3.2e-7", "−9", "0.5". */
export function xText(v: number): string {
  if (!Number.isFinite(v)) return String(v)
  const a = Math.abs(v)
  const s =
    a !== 0 && (a < 1e-3 || a >= 1e6)
      ? a.toExponential(1).replace(/\.0e/, 'e').replace('e+', 'e')
      : String(+a.toPrecision(3))
  return (v < 0 ? '−' : '') + s
}

/** The X values of the chosen data sets (an XY table's X column, once per row). */
export function xValuesOf(input: readonly NormalizedDataSet[]): number[] {
  const out: number[] = []
  const seen = new Set<ArrayLike<number>>()
  for (const d of input) {
    if (!d.x || seen.has(d.x)) continue
    seen.add(d.x)
    for (let r = 0; r < d.rowCount; r++) {
      const v = d.x[r]
      if (v !== undefined && Number.isFinite(v)) out.push(v)
    }
  }
  return out
}

/** The action of the "Transform X to log10" fix: a Transform analysis first, then the fit. */
export const TRANSFORM_LOG10_X = 'transformLog10X'

/**
 * §9.2: the X a model expects against the X of the chosen data (notes with fixes, before the fit).
 * `equationId`: a built-in model (user-defined ones expect nothing).
 */
export function xScaleChecks(equationId: string, x: readonly number[]): Check[] {
  const meta = equationMeta(equationId)
  const look = xLooks(x)
  if (!meta || !look) return []
  const range = `${xText(look.min)} to ${xText(look.max)}`
  const out: Check[] = []
  if (meta.xScale === 'log' && look.looksConcentration) {
    const fix: CheckFix[] = [{ label: 'Transform X to log10', action: TRANSFORM_LOG10_X }]
    if (meta.otherScale)
      fix.push({
        label: 'Use the concentration form of this model',
        set: [{ path: ['equation'], value: meta.otherScale }],
      })
    out.push({
      level: 'note',
      message: `X looks like concentrations (${range}), but this model expects log(concentration).`,
      fix,
    })
    if (look.zeros)
      out.push({
        level: 'note',
        message: `${look.zeros} row${look.zeros === 1 ? ' has' : 's have'} X = 0, which has no logarithm and ${look.zeros === 1 ? 'is' : 'are'} left out once X is on a log scale. Fit on the concentration scale, or enter the vehicle as a very low dose.`,
      })
  } else if (meta.xScale === 'concentration' && look.looksLog) {
    out.push({
      level: 'note',
      message: `X looks like log molar (${range}), but this model expects concentrations.`,
      ...(meta.otherScale
        ? {
            fix: [
              {
                label: 'Use the log form of this model',
                set: [{ path: ['equation'], value: meta.otherScale }],
              },
            ],
          }
        : {}),
    })
  }
  return out
}

/** X with its log10 (0 and negative X become blank), as "Transform X to log10" makes it. */
export function withLog10X(input: readonly NormalizedDataSet[]): NormalizedDataSet[] {
  const done = new Map<ArrayLike<number>, Float64Array>()
  return input.map((d) => {
    if (!d.x) return d
    let x = done.get(d.x)
    if (!x) {
      x = Float64Array.from(d.x, (v) => (v > 0 ? Math.log10(v) : Number.NaN))
      done.set(d.x, x)
    }
    return { ...d, x }
  })
}

// ---- after the fit (§9.3) -------------------------------------------------------------------

/** One data set's fit, as the warnings read it. */
export interface FittedCurve {
  title: string
  x: ArrayLike<number>
  y: ArrayLike<number>
  /** The model's value at an X (the fitted curve). */
  at: (x: number) => number
  /** A parameter's estimate and CI (NaN when not computed), or null when not fitted. */
  param: (name: string) => { value: number; lo: number; hi: number; fitted: boolean } | null
  status: 'converged' | 'maxIterations' | 'singular' | 'invalid'
  /** Fitted (free) parameters of this data set. */
  free: number
}

const constant = (name: string, value: number): DiagnosticFix => ({
  label: `Fix ${name} = ${value}`,
  set: [{ path: ['constraints', name], value: { kind: 'constant', value } }],
})

/** "EC50" for LogEC50, "IC50" for IC50, "Kd"… */
const midpointWord = (name: string) => name.replace(/^Log/i, '')

/**
 * Whether the responses look normalized to 0–100 (a Top of 100 is then a sensible constraint):
 * within −20 … 130 and spanning 20 or more.
 */
const looksPercent = (lo: number, hi: number) => lo >= -20 && hi <= 130 && hi - lo >= 20

function extent(a: ArrayLike<number>): [number, number] {
  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY
  for (let i = 0; i < a.length; i++) {
    const v = a[i]!
    if (!Number.isFinite(v)) continue
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  return [lo, hi]
}

/**
 * §9.3: the warnings a fitted dose-response (or saturation, Michaelis-Menten, Boltzmann…) curve
 * raises, for a built-in model with a midpoint or plateaus. `level`: the CI's level (for words).
 */
export function curveWarnings(
  equationId: string,
  fits: readonly FittedCurve[],
  level: number,
): Diagnostic[] {
  const meta = equationMeta(equationId)
  if (!meta) return []
  const out: Diagnostic[] = []
  const many = fits.length > 1
  for (const f of fits) {
    if (f.status === 'invalid' || f.status === 'maxIterations') continue
    const who = many ? `“${f.title}”: ` : ''
    out.push(...oneCurve(meta, f, who, level))
  }
  return out
}

function oneCurve(meta: EquationMeta, f: FittedCurve, who: string, level: number): Diagnostic[] {
  const out: Diagnostic[] = []
  const [xMin, xMax] = extent(f.x)
  const [yMin, yMax] = extent(f.y)
  if (!(xMax > xMin)) return out
  const dose = meta.xScale === 'log' || meta.xScale === 'concentration'
  const tested = dose ? 'doses tested' : 'X values tested'
  const rises = f.at(xMax) >= f.at(xMin)
  const top = meta.top ? f.param(meta.top) : null
  const bottom = meta.bottom ? f.param(meta.bottom) : null
  // The plateau at each end of X (the curve's own direction), for the advice's wording and fix.
  const highEnd = rises ? meta.top : meta.bottom
  const lowEnd = rises ? meta.bottom : meta.top
  const fixFor = (name: string | undefined): DiagnosticFix | undefined => {
    if (!name) return undefined
    const p = f.param(name)
    if (!p?.fitted) return undefined
    if (name === meta.bottom) return constant(name, 0)
    if (name === meta.top && looksPercent(yMin, yMax)) return constant(name, 100)
    return undefined
  }

  // Too few doses for the parameters.
  const distinct = new Set<number>()
  for (let i = 0; i < f.x.length; i++) if (Number.isFinite(f.x[i]!)) distinct.add(f.x[i]!)
  if (dose && meta.midpoint && distinct.size <= f.free + 1)
    out.push({
      level: 'warning',
      message: `${who}${distinct.size} doses for ${f.free} fitted parameters: too few to define the curve. Test more doses, or fit fewer parameters (fix a plateau).`,
    })

  // The midpoint outside the doses.
  const mid = meta.midpoint ? f.param(meta.midpoint) : null
  if (mid?.fitted && Number.isFinite(mid.value)) {
    const word = midpointWord(meta.midpoint!)
    if (mid.value < xMin || mid.value > xMax) {
      const beyond = mid.value > xMax ? highEnd : lowEnd
      const fix = fixFor(beyond)
      out.push({
        level: 'warning',
        message: `${who}The ${word} lies outside the ${tested} (${meta.midpoint} = ${xText(mid.value)}; ${xText(xMin)} to ${xText(xMax)}): it is an extrapolation. Test ${mid.value > xMax ? 'higher' : 'lower'} doses${beyond ? `, or constrain ${beyond}` : ''}.`,
        ...(fix ? { fix } : {}),
      })
    } else if (!Number.isNaN(mid.lo) && !Number.isNaN(mid.hi)) {
      // Poorly determined: the CI wider than the doses (on a log scale for concentrations).
      const logScale = meta.xScale === 'concentration' && xMin > 0
      const width = logScale
        ? mid.lo > 0 && mid.hi > 0
          ? Math.log10(mid.hi / mid.lo)
          : Number.POSITIVE_INFINITY
        : mid.hi - mid.lo
      const span = logScale ? Math.log10(xMax / xMin) : xMax - xMin
      if (!(width <= span))
        out.push({
          level: 'warning',
          message: `${who}The data don’t determine the ${word} well: its ${Math.round(level * 100)}% CI spans more than the ${tested}. Constrain a plateau the data don’t reach, or test doses either side of it.`,
        })
    }
  }

  // Plateaus beyond the data.
  const range = yMax - yMin
  if (range > 0)
    for (const [name, p] of [
      [meta.top, top],
      [meta.bottom, bottom],
    ] as const) {
      if (!name || !p?.fitted || !Number.isFinite(p.value)) continue
      const above = p.value > yMax + range
      const below = p.value < yMin - range
      if (!above && !below) continue
      const which = name === meta.top ? 'top' : 'bottom'
      const towards = name === highEnd ? 'higher' : 'lower'
      const fix = fixFor(name)
      out.push({
        level: 'warning',
        message: `${who}The ${which} plateau isn’t reached by the data: ${name} = ${xText(p.value)} is far ${above ? 'above the highest' : 'below the lowest'} response (${xText(above ? yMax : yMin)}). ${fix ? fix.label : `Constrain ${name}`}${name === meta.top && !fix ? ' (e.g. 100 for normalized data)' : ''} or test ${towards} doses.`,
        ...(fix ? { fix } : {}),
      })
    }

  // Ambiguous: a parameter the data can't determine.
  if (f.status === 'singular') {
    const fix = fixFor(meta.bottom) ?? fixFor(meta.top)
    out.push({
      level: 'warning',
      message: `${who}What to do about the ambiguous fit: constrain a parameter the data can’t determine${fix ? ` (${fix.label})` : ''}, or collect data where the curve changes.`,
      ...(fix ? { fix } : {}),
    })
  }
  return out
}
