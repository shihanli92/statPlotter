import {
  type Aes,
  type ColorScale,
  type DataSetColumn,
  type DataTable,
  type Frame,
  type GraphNode,
  type Layer,
  levelAt,
  levelKey,
  type NumberDisplay,
  normalizeDataSet,
  orderedLevels,
  primaryValues,
  type RichText,
  type SizeScale,
  type SymbolShape,
} from '@ps/model'
import { COLOR_MAPS, colorAt, mixColor } from './color.ts'
import { labelText } from './layout/labels.ts'
import { subjectShape } from './layout/nested.ts'
import { minMax } from './minMax.ts'
import { niceLinearDomain } from './scale.ts'
import { type Transform, transformOf } from './transform.ts'

// Variables mapped to appearance (roadmap 34b): each table row's point coloured by a variable (a
// text variable's levels on the palette, a number variable on a colour map), given a symbol by a
// text variable's level, sized by a number variable and labelled by any variable — on an XY graph
// of variables (its mapped points' `aes`) and on the category and grouped graphs 34a draws (the
// graph's `mapping`). The scales are pure functions of the values (tested on their own); the
// frames get each row's look (`RowLook`) and the legend's guides from here, so no frame code
// branches on a table kind.

/** What a variable can be mapped to besides the axes. */
export type Aesthetic = 'color' | 'shape' | 'size' | 'label'
export const AESTHETICS: readonly Aesthetic[] = ['color', 'shape', 'size', 'label']

/** The variables a graph maps to appearance, by aesthetic. */
export type AesVariables = Partial<Record<Aesthetic, string>>

/** A graph's mapped points layer (an XY graph of variables: `aes`). */
export const mappedPointsLayer = (
  graph: Pick<GraphNode, 'layers'>,
): Extract<Layer, { geom: 'points' }> | undefined =>
  graph.layers.find((l): l is Extract<Layer, { geom: 'points' }> => l.geom === 'points' && !!l.aes)

/**
 * The variables a graph maps to colour, shape, size and labels: an XY graph's mapped points'
 * (`aes`), else a category or grouped graph of variables' (`mapping`). The colour of a category or
 * grouped graph is the variable whose levels its groups are when it is text (34a), so only a
 * number variable colours its rows here (`rowAesthetics` decides with the table).
 */
export function aesVariables(graph: Pick<GraphNode, 'frame' | 'mapping' | 'layers'>): AesVariables {
  const from = (m: Partial<Record<Aesthetic, string>> | undefined): AesVariables => {
    const out: AesVariables = {}
    for (const a of AESTHETICS) if (m?.[a] !== undefined) out[a] = m[a]
    return out
  }
  if (graph.frame === 'xy') return from(mappedPointsLayer(graph)?.aes as Aes | undefined)
  if (graph.mapping && (graph.frame === 'category' || graph.frame === 'grouped'))
    return from(graph.mapping)
  return {}
}

// --- Scales ---------------------------------------------------------------------------------

/** The two-colour gradient a number variable's colour runs along unless a map is chosen. */
export const GRADIENT_COLORS: [string, string] = ['#c6dbef', '#08306b']
/** The colour of rows without a value (or level) of the colour variable. */
export const MISSING_POINT_COLOR = '#b4b4b4'
/** The symbol size range of a size variable (diameters, pt). */
export const SIZE_MAX = 30
export const SIZE_MIN = 4

/**
 * The size range a frame's mapped points take unless set: an XY graph's bubbles 4–30 pt across,
 * a category or grouped graph's points (in narrow slots) 3–14 pt.
 */
export const sizeDefaults = (frame: Frame): { min: number; max: number } =>
  frame === 'xy' ? { min: SIZE_MIN, max: SIZE_MAX } : { min: 3, max: 14 }

/**
 * A colour along a colour scale's colours at `t` (0 the low end, 1 the high end; clamped): on a
 * colour map (`colors` a map's name), else between two colours, reversed when asked. Number
 * variables' colours and heat maps share it.
 */
export function colorAlong(
  colors: NonNullable<ColorScale['colors']>,
  t: number,
  reverse = false,
): string {
  if (typeof colors === 'string') return colorAt(COLOR_MAPS[colors], t, reverse)
  const [c0, c1] = colors
  return reverse ? mixColor(c1, c0, t) : mixColor(c0, c1, t)
}

/** A number variable's colour scale over `values` (see `ColorScale`). */
export interface ContinuousColor {
  /** The ends of the range coloured (fixed, else the data's). */
  lo: number
  hi: number
  /** A value's colour: on the map (clamped, or the out-of-range colour), missing for NaN. */
  color: (v: number) => string
  /** A value's place along the map (0 at `lo`, 1 at `hi`; not clamped). */
  t: (v: number) => number
  /** Whether a value is on the map (roadmap 41): not, it is drawn in the missing colour. */
  shows: (v: number) => boolean
}

/**
 * The colour of a number variable's values: a colour map (`colors` a map's name; a diverging map
 * centred on `midpoint`, else 0 or the middle of the range) or two colours (absent: light to dark
 * blue), over the range [`min`, `max`] (absent: the values' smallest and largest), reversed when
 * asked. Values outside a fixed range take `outOfRange` (absent: the nearer end's colour); NaN
 * (a row without a value) takes `missing`. A range of one value is drawn in its high colour.
 */
export function continuousColor(
  values: readonly number[],
  s: ColorScale | undefined = {},
): ContinuousColor {
  // Roadmap 34g: colours along a transformed scale (log, arcsinh, logicle): the values that scale
  // can show, placed by their transformed values.
  const tr = colorTransform(s)
  if (tr.kind !== 'linear') return transformedColor(values, s, tr)
  const finite = values.filter(Number.isFinite)
  let [lo, hi] = finite.length ? minMax(finite) : [0, 1]
  lo = s.min ?? lo
  hi = s.max ?? hi
  if (lo > hi) [lo, hi] = [hi, lo]
  const map = typeof s.colors === 'string' ? COLOR_MAPS[s.colors] : null
  const mid =
    map?.diverging && hi > lo ? (s.midpoint ?? (lo < 0 && hi > 0 ? 0 : (lo + hi) / 2)) : Number.NaN
  const half = Math.max(hi - mid, mid - lo) || 1
  const t = (v: number) =>
    !(hi > lo) ? 1 : Number.isFinite(mid) ? 0.5 + (0.5 * (v - mid)) / half : (v - lo) / (hi - lo)
  const fixed = s.min !== undefined || s.max !== undefined
  const eps = 1e-12 * Math.max(1, Math.abs(lo), Math.abs(hi))
  const missing = s.missing ?? MISSING_POINT_COLOR
  const color = (v: number) => {
    if (!Number.isFinite(v)) return missing
    if (fixed && s.outOfRange && (v < lo - eps || v > hi + eps)) return s.outOfRange
    return colorAlong(s.colors ?? GRADIENT_COLORS, t(v), s.reverse)
  }
  return { lo, hi, color, t, shows: Number.isFinite }
}

/** Roadmap 34g: a colour scale's transform (absent: linear). */
export const colorTransform = (s: ColorScale | undefined): Transform =>
  transformOf({
    scale: s?.transform ?? 'linear',
    ...(s?.arcsinh ? { arcsinh: s.arcsinh } : {}),
    ...(s?.logicle ? { logicle: s.logicle } : {}),
  })

/**
 * `continuousColor` along a transformed scale (roadmap 34g): the range [`min`, `max`] (absent:
 * the values' that the scale shows) placed by the transformed values; a value the scale can't show
 * (≤ 0 on a log scale) is missing. Diverging maps centre on the middle of the transformed range.
 */
function transformedColor(
  values: readonly number[],
  s: ColorScale,
  tr: Transform,
): ContinuousColor {
  const shown = values.filter((v) => Number.isFinite(tr.forward(v)))
  let [lo, hi] = shown.length ? minMax(shown) : tr.positive ? [1, 10] : [0, 1]
  lo = s.min ?? lo
  hi = s.max ?? hi
  if (lo > hi) [lo, hi] = [hi, lo]
  const [t0, t1] = [tr.forward(lo), tr.forward(hi)]
  const t = (v: number) => (!(t1 > t0) ? 1 : (tr.forward(v) - t0) / (t1 - t0))
  const fixed = s.min !== undefined || s.max !== undefined
  const missing = s.missing ?? MISSING_POINT_COLOR
  const color = (v: number) => {
    const tv = tr.forward(v)
    if (!Number.isFinite(tv)) return missing
    if (fixed && s.outOfRange && (v < lo || v > hi)) return s.outOfRange
    return colorAlong(s.colors ?? GRADIENT_COLORS, t(v), s.reverse)
  }
  return { lo, hi, color, t, shows: (v) => Number.isFinite(tr.forward(v)) }
}

/**
 * A size variable's diameters (pt) for its values (see `SizeScale`), with the ends of the range
 * sized (fixed, else the data's; NaN without either), which its legend's values span.
 */
export interface Sizer {
  (v: number): number
  lo: number
  hi: number
}

/**
 * Symbol diameters for a size variable's values, from `min` to `max`:
 * - by area (the default): over the data's range with no negative value, area proportional to
 *   the value (the largest value `max` across, none smaller than `min`: the bubble plot's rule);
 *   otherwise area rising linearly from `min` at the range's low end to `max` at its high end;
 * - by radius: the diameter rising linearly from `min` to `max` over the range.
 * The range is [`low`, `high`] where fixed, else the data's; values outside it are clamped to the
 * ends' sizes, or (`outside: 'extend'`) sized past them (never below 0). A range of one value, or
 * no positive value by area, draws every symbol `max` across.
 */
export function sizeScale(
  values: readonly number[],
  s: SizeScale | undefined = {},
  defaults: { min: number; max: number } = { min: SIZE_MIN, max: SIZE_MAX },
): Sizer {
  const max = s.max ?? defaults.max
  const min = Math.min(s.min ?? defaults.min, max)
  const finite = values.filter(Number.isFinite)
  const [dLo, dHi] = finite.length ? minMax(finite) : [Number.NaN, Number.NaN]
  const lo = s.low ?? dLo
  const hi = s.high ?? dHi
  const extend = s.outside === 'extend'
  const fixed = s.low !== undefined || s.high !== undefined
  const sizer = (f: (v: number) => number): Sizer => Object.assign(f, { lo, hi })
  if (s.by !== 'radius' && !fixed) {
    // The bubble plot's sizes (before roadmap 34b), unchanged.
    if (!finite.length || !(hi > 0)) return sizer(() => max)
    if (lo >= 0) return sizer((v) => Math.max(min, max * Math.sqrt(Math.max(0, v) / hi)))
    return sizer((v) =>
      hi === lo ? max : Math.sqrt(min ** 2 + ((max ** 2 - min ** 2) * (v - lo)) / (hi - lo)),
    )
  }
  if (!(hi > lo)) return sizer(() => max)
  const at = (v: number) => {
    const t = (v - lo) / (hi - lo)
    return extend ? t : Math.max(0, Math.min(1, t))
  }
  if (s.by === 'radius') return sizer((v) => Math.max(0, min + (max - min) * at(v)))
  return sizer((v) => Math.sqrt(Math.max(0, min ** 2 + (max ** 2 - min ** 2) * at(v))))
}

/** The k-th level's symbol: its own (`levels` by level key), else the sequence from `base`. */
export const levelShape = (
  base: SymbolShape,
  stored: Readonly<Record<string, SymbolShape>> | undefined,
  level: string,
  k: number,
): SymbolShape => stored?.[levelKey(level)] ?? subjectShape(base, k)

/**
 * Round values for a legend between lo and hi (at most `count`, largest first): nice ticks inside
 * the range, else the ends. Whole numbers only when `integer`.
 */
export function legendValues(
  lo: number,
  hi: number,
  count: number,
  skipZero = false,
  integer = false,
): number[] {
  if (!(hi > lo)) return [hi]
  const ticks = niceLinearDomain(lo, hi, { target: count }).ticks.filter(
    (v) =>
      v >= lo - 1e-9 * (hi - lo) &&
      v <= hi + 1e-9 * (hi - lo) &&
      !(skipZero && v === 0) &&
      (!integer || Number.isInteger(v)),
  )
  const picked = ticks.length >= 2 ? ticks : [lo, hi]
  // Keep the ends and evenly spaced ones between, up to `count`.
  const step = Math.max(1, Math.ceil((picked.length - 1) / Math.max(1, count - 1)))
  const out = picked.filter((_, i) => i % step === 0 || i === picked.length - 1)
  return [...new Set(out)].sort((a, b) => b - a).slice(0, count)
}

// --- A graph's rows -------------------------------------------------------------------------

/** A mapped variable as the scales read it. */
export interface MappedVariable {
  key: string
  title: string
  type: 'number' | 'text'
  /** By table row: the value (NaN: none) of a number variable. */
  values?: Float64Array
  /** By table row: the level (null: none) of a text variable. */
  levels?: readonly (string | null)[]
  /** A text variable's levels in the graph's order (`GraphNode.levels`, then table order). */
  order?: string[]
}

/** A variable's reading of every row: a number variable's values, a text variable's levels. */
interface VariableRows {
  values?: Float64Array
  levels?: readonly (string | null)[]
  /** A text variable's levels present in the rows shown, in their order. */
  present?: string[]
}

/**
 * Variables' rows read, per table object (documents are immutable), variable and rows shown
 * (`graphRows` gives the same array for the same rows): audit 3, P4 and P6 — a layout and the
 * Format panel read a million rows' levels again for every edit of a graph.
 */
const variableRows = new WeakMap<
  DataTable,
  Map<string, Map<readonly number[] | null, VariableRows>>
>()

function rowsOf(table: DataTable, d: DataSetColumn, rows: readonly number[] | null): VariableRows {
  let byKey = variableRows.get(table)
  if (!byKey) {
    byKey = new Map()
    variableRows.set(table, byKey)
  }
  let byRows = byKey.get(d.id)
  if (!byRows) {
    byRows = new Map()
    byKey.set(d.id, byRows)
  }
  const hit = byRows.get(rows)
  if (hit) return hit
  let out: VariableRows
  if (!d.text) out = { values: primaryValues(normalizeDataSet(table, d)) }
  else {
    const excluded = d.subcolumns[0]?.excluded
    const levels = Array.from({ length: table.rowCount }, (_, r) =>
      excluded?.[r] ? null : levelAt(d.text, r),
    )
    const seen = new Set<string>()
    const present: string[] = []
    for (const r of rows ?? levels.keys()) {
      const t = levels[r]
      if (t && !seen.has(t)) {
        seen.add(t)
        present.push(t)
      }
    }
    out = { levels, present }
  }
  byRows.set(rows, out)
  return out
}

/**
 * A variable of a table as the scales read it, over the rows shown (`rows`: all when null). Its
 * per-row arrays are shared by every call for the same table, variable and rows: never written.
 */
export function mappedVariable(
  table: DataTable,
  graph: Pick<GraphNode, 'levels' | 'levelOrder'>,
  key: string | undefined,
  rows: readonly number[] | null,
): MappedVariable | undefined {
  const d: DataSetColumn | undefined =
    key === undefined ? undefined : table.dataSets.find((x) => x.id === key)
  if (!d) return undefined
  const title = d.title || d.id
  const read = rowsOf(table, d, rows)
  if (!d.text) return { key: d.id, title, type: 'number', values: read.values! }
  return {
    key: d.id,
    title,
    type: 'text',
    levels: read.levels!,
    order: orderedLevels(read.present!, graph.levels?.[d.id], graph.levelOrder),
  }
}

/** The text of a variable's value in a row, for a point's label (numbers in `format`). */
export function variableText(
  v: MappedVariable,
  row: number,
  format: NumberDisplay | undefined,
): RichText | null {
  if (v.type === 'text') {
    const t = v.levels?.[row]
    return t ? [{ text: t }] : null
  }
  const x = v.values?.[row]
  if (x === undefined || !Number.isFinite(x)) return null
  const text = labelText({ stat: 'value', format: format ?? { mode: 'auto' } }, x)
  return text.some((r) => r.text) ? text : null
}
