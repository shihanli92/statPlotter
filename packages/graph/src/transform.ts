import type { ArcsinhParams, AxisScale, LogicleParams } from '@ps/model'
import {
  arcsinh,
  arcsinhInverse,
  LOGICLE_DEFAULTS,
  type Logicle,
  logicle,
  logicleProblem,
} from '@ps/stats'
import { Lru } from './lru.ts'

// The transforms of continuous scales (axes; roadmap 34g also colour scales): linear, log 10 and
// log 2, and the cytometry display transforms — arcsinh with a cofactor and logicle
// (biexponential), both showing zero and negative values, drawn with ticks at 0 and ±10ⁿ in raw
// units (as FlowJo's biexponential axes). Data stay in raw units everywhere; positions are linear
// in the transformed value. The numbers are `@ps/stats`' (oracle suite `cytometry`).

export interface Transform {
  kind: AxisScale
  /** Raw value → the transformed value positions are linear in. */
  forward(v: number): number
  /** Transformed value → raw value. */
  inverse(t: number): number
  /** Only positive values can be shown (log scales). */
  positive: boolean
  /** A cytometry transform (arcsinh, logicle): ticks at 0 and ±10ⁿ, zero always on the axis. */
  cyto: boolean
}

/** CyTOF's arcsinh cofactor, the default (flow cytometry's is usually 150). */
export const ARCSINH_COFACTOR = 5

/** What a transform is read from: an axis spec or a colour scale. */
export interface TransformSpec {
  scale: AxisScale
  arcsinh?: ArcsinhParams
  logicle?: LogicleParams
}

const LINEAR: Transform = {
  kind: 'linear',
  forward: (v) => v,
  inverse: (t) => t,
  positive: false,
  cyto: false,
}
const LOG10: Transform = {
  kind: 'log10',
  forward: Math.log10,
  inverse: (t) => 10 ** t,
  positive: true,
  cyto: false,
}
const LOG2: Transform = {
  kind: 'log2',
  forward: Math.log2,
  inverse: (t) => 2 ** t,
  positive: true,
  cyto: false,
}

/** A logicle scale's parameters with flowCore's defaults (unusable ones: the defaults). */
export function logicleParams(p: LogicleParams | undefined) {
  const full = { ...LOGICLE_DEFAULTS, ...p }
  return logicleProblem(full) ? { ...LOGICLE_DEFAULTS } : full
}

/** Why logicle parameters can't make a scale (shown beside them in Format), or null. */
export const logicleError = (p: LogicleParams | undefined): string | null =>
  logicleProblem({ ...LOGICLE_DEFAULTS, ...p })

/** Scales made per parameters, the few used last kept (audit 2, G16: they grew per value typed). */
const logicles = new Lru<string, Logicle>(16)
const arcsinhs = new Lru<number, Transform>(16)

function logicleTransform(p: LogicleParams | undefined): Transform {
  const full = logicleParams(p)
  const key = `${full.T}/${full.W}/${full.M}/${full.A}`
  let lg = logicles.get(key)
  if (!lg) {
    lg = logicle(full)
    logicles.set(key, lg)
  }
  const l = lg
  return {
    kind: 'logicle',
    forward: (v) => l.scale(v),
    inverse: (t) => l.inverse(t),
    positive: false,
    cyto: true,
  }
}

function arcsinhTransform(p: ArcsinhParams | undefined): Transform {
  const c = p?.cofactor && p.cofactor > 0 ? p.cofactor : ARCSINH_COFACTOR
  let t = arcsinhs.get(c)
  if (!t) {
    t = {
      kind: 'arcsinh',
      forward: (v) => arcsinh(v, c),
      inverse: (y) => arcsinhInverse(y, c),
      positive: false,
      cyto: true,
    }
    arcsinhs.set(c, t)
  }
  return t
}

/** The transform of a scale (an axis spec, or a kind alone with default parameters). */
export function transformOf(spec: TransformSpec | AxisScale): Transform {
  const s = typeof spec === 'string' ? { scale: spec } : spec
  switch (s.scale) {
    case 'linear':
      return LINEAR
    case 'log10':
      return LOG10
    case 'log2':
      return LOG2
    case 'arcsinh':
      return arcsinhTransform(s.arcsinh)
    case 'logicle':
      return logicleTransform(s.logicle)
  }
}

/** Whether a scale shows positive values only (log 10, log 2). */
export const isLogScale = (scale: AxisScale | undefined): boolean =>
  scale === 'log10' || scale === 'log2'

/** Whether a scale is a cytometry transform (arcsinh, logicle). */
export const isCytoScale = (scale: AxisScale | undefined): boolean =>
  scale === 'arcsinh' || scale === 'logicle'

// --- Ticks of cytometry scales --------------------------------------------------------------

/** The width of a decade near the top of the range, in transformed units. */
function decadeWidth(t: Transform, hi: number): number {
  const top = Math.max(10, Math.abs(hi))
  const e = Math.floor(Math.log10(top))
  return t.forward(10 ** e) - t.forward(10 ** (e - 1)) || 1
}

/**
 * A raw value snapped outward to the nearest k · 10ⁿ (k = 1…9) away from zero (`up`: towards +∞),
 * so an automatic range ends at a round value close to the data.
 */
function snapOut(v: number, up: boolean): number {
  if (v === 0 || !Number.isFinite(v)) return v
  const a = Math.abs(v)
  const e = Math.floor(Math.log10(a))
  const unit = 10 ** e
  const away = up === v > 0
  const k = away ? Math.ceil(a / unit - 1e-9) : Math.floor(a / unit + 1e-9)
  return Math.sign(v) * Math.max(k, away ? 1 : 0) * unit
}

/**
 * The automatic range of a cytometry axis over data [lo, hi] (raw units): zero always shown; a
 * logicle axis at least its whole display, from the scale's bottom (display 0) to T (display M);
 * ends past those snapped outward to a round value (k · 10ⁿ).
 */
export function cytoRange(t: Transform, lo: number, hi: number, top?: number): [number, number] {
  let a = Number.isFinite(lo) ? Math.min(lo, 0) : 0
  let b = Number.isFinite(hi) ? Math.max(hi, 0) : 1
  if (top !== undefined) {
    // Logicle: the display [0, M] (raw: inverse(0) to T).
    const bottom = t.inverse(0)
    a = a < bottom ? snapOut(a, false) : bottom
    b = b > top ? snapOut(b, true) : top
    return [a, b]
  }
  a = snapOut(a, false)
  b = snapOut(b, true)
  if (!(b > a)) b = a + 1
  return [a, b]
}

/**
 * Ticks of a cytometry axis over [min, max] (raw units): 0 and the decades ±10ⁿ inside it, a
 * decade left out when it stands closer than 0.6 of a full decade's width to the one before it
 * (the decades squeezed into the linear region near zero: FlowJo's 0, 10³, 10⁴, 10⁵); minor
 * ticks at 2–9 × 10ⁿ where they stand apart. `fit` thins the decades further (every 2nd, 3rd…)
 * while their labels crowd.
 */
export function cytoTicks(
  t: Transform,
  min: number,
  max: number,
  fit?: (values: readonly number[]) => boolean,
): { ticks: number[]; minorTicks: number[] } {
  const D = decadeWidth(t, Math.max(Math.abs(min), Math.abs(max)))
  const inside = (v: number) => v >= min - 1e-9 * Math.abs(min) && v <= max + 1e-9 * Math.abs(max)
  const top = Math.max(Math.abs(min), Math.abs(max), 1)
  const eMax = Math.ceil(Math.log10(top))
  const side = (sign: 1 | -1): number[] => {
    const kept: number[] = []
    let last = t.forward(0)
    for (let e = -3; e <= eMax; e++) {
      const v = sign * 10 ** e
      if (!inside(v)) continue
      const p = t.forward(v)
      if (Math.abs(p - last) >= 0.6 * D) {
        kept.push(v)
        last = p
      }
    }
    return kept
  }
  const pos = side(1)
  const neg = side(-1)
  const zero = inside(0) ? [0] : []
  let ticks = [...neg.reverse(), ...zero, ...pos]
  // Thin the decades while the labels crowd: every k-th from zero outward.
  if (fit && !fit(ticks))
    for (const k of [2, 3, 5, 10]) {
      const thin = (vs: number[]) => vs.filter((_, i) => (i + 1) % k === 0)
      const next = [...thin(neg.slice().reverse()).reverse(), ...zero, ...thin(pos)]
      ticks = next.length >= 2 ? next : ticks
      if (fit(ticks)) break
    }
  // Minor ticks: m · 10ⁿ between decades, where neighbours stand apart (0.08 of a decade).
  const minorTicks: number[] = []
  const minGap = 0.08 * D
  for (const sign of [1, -1] as const) {
    let last = Number.NaN
    for (let e = -3; e <= eMax; e++)
      for (let m = 1; m <= 9; m++) {
        const v = sign * m * 10 ** e
        if (!inside(v)) continue
        const p = t.forward(v)
        if (Number.isFinite(last) && Math.abs(p - last) < minGap) continue
        last = p
        if (m > 1 && !ticks.includes(v)) minorTicks.push(v)
      }
  }
  minorTicks.sort((a, b) => a - b)
  return { ticks, minorTicks }
}
