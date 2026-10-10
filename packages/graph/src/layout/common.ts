import {
  type AnalysisResult,
  type Annotation,
  type AxisSpec,
  formatP,
  type GraphNode,
  labelRuns,
  type NodeId,
  type Project,
  pSummary,
  type RichText,
  type TextStyle,
} from '@ps/model'
import type { FontRegistry } from '../fonts/registry.ts'
import { tickFormatter } from '../format.ts'
import { boxesUnion } from '../minMax.ts'
import {
  coarserStep,
  type LinearAxisDomain,
  makeAxisScale,
  niceLinearDomain,
  niceLogDomain,
  niceStep,
  type Scale,
  snap,
} from '../scale.ts'
import { type Box, nodeBounds, type PathCmd, type SceneNode, type Stroke } from '../scene.ts'
import { layoutText } from '../text/layout.ts'
import { graphPalette, graphText, graphTheme, resolveStroke, type Theme } from '../theme.ts'
import { cytoRange, cytoTicks, isLogScale, logicleParams, transformOf } from '../transform.ts'
import {
  type CategoryExtras,
  type CategoryLayout,
  categoryExtras,
  EXTRAS,
} from './categoryExtras.ts'
import { movePoints } from './cloud.ts'
import type { ScreenSample } from './screen.ts'
import { type HAnchor, placeText, type VAnchor } from './text.ts'

/**
 * What laying out a graph needs (one type for every layout since the v1 layouts went with roadmap
 * 33d: audit 2, P21).
 */
export interface GraphContext {
  project: Project
  graph: GraphNode
  fonts: FontRegistry
  theme?: Theme
  /** Latest result of an analysis: live bracket labels, fitted curves. */
  result?: (analysisId: NodeId) => AnalysisResult | undefined
  /**
   * Laid out for the screen (decision 450): each data set's per-row points capped (an even
   * sample; statistics from every row). Absent for exports: every point.
   */
  screen?: ScreenSample
}

/** What every layout starts from: the theme, the graph's palette and a list for warnings. */
export function layoutBasics(ctx: GraphContext) {
  const theme = ctx.theme ?? graphTheme(ctx.project, ctx.graph)
  return { theme, palette: graphPalette(ctx.graph, theme), warnings: [] as string[] }
}

export const PAD = 8
export const OFFSET_FRAME = 6
/** Half-length of the slanted marks drawn at an axis break. */
export const BREAK_MARK = 4
/** Most major ticks an axis draws; a manual interval giving more is widened (with a warning). */
export const MAX_TICKS = 500
const MAX_MINOR_TICKS = 5000

export type ContinuousAxis = Extract<AxisSpec, { type: 'continuous' }>

/** A continuous axis with default settings (automatic range, plain numbers), a new one each call. */
export const defaultContinuousAxis = (): ContinuousAxis => ({
  type: 'continuous',
  title: null,
  scale: 'linear',
  range: 'auto',
  ticks: 'auto',
  format: { mode: 'auto' },
  frame: 'plain',
  breaks: [],
})
export const DEFAULT_CONTINUOUS: ContinuousAxis = defaultContinuousAxis()

/**
 * A continuous axis spec for any axis: itself, or (for a categorical spec where a continuous one
 * is needed) the defaults with the categorical axis' title and common styling.
 */
export function asContinuous(spec: AxisSpec): ContinuousAxis {
  if (spec.type === 'continuous') return spec
  const { type: _type, labels: _labels, rotation, ...common } = spec
  return { ...DEFAULT_CONTINUOUS, ...common, rotation }
}

/** Tracks the data extent along one axis, ignoring values a log axis can't show. */
export class Extent {
  lo = Number.POSITIVE_INFINITY
  hi = Number.NEGATIVE_INFINITY
  /** The values are whole numbers (counts): automatic ticks never fall between them (34b). */
  integer = false
  constructor(private readonly log: boolean) {}
  add(v: number): void {
    if (!Number.isFinite(v) || (this.log && v <= 0)) return
    if (v < this.lo) this.lo = v
    if (v > this.hi) this.hi = v
  }
  addAll(values: Iterable<number>): void {
    for (const v of values) this.add(v)
  }
  get empty(): boolean {
    return this.lo > this.hi
  }
}

const capMinor = (minor: number | undefined, majors: number) =>
  minor && majors * (minor + 1) > MAX_MINOR_TICKS
    ? Math.max(0, Math.floor(MAX_MINOR_TICKS / Math.max(majors, 1)) - 1)
    : minor

/**
 * Whether automatic ticks at these values, on an axis over [min, max], leave their labels room
 * (see `tickFit`). Absent: any ticks fit.
 */
export type TickFit = (values: readonly number[], min: number, max: number) => boolean

/** Most times automatic ticks are made coarser for their labels to fit. */
const MAX_COARSER = 12

/**
 * The automatic ticks of a log axis thinned until their labels fit: every k-th power of the base
 * (k = 1, 2, 3, 5, 10, …; the exponents multiples of k), the powers left out kept as minor ticks.
 */
function thinLogTicks(d: LinearAxisDomain, base: number, fit: TickFit | undefined) {
  if (!fit || fit(d.ticks, d.min, d.max)) return d
  const exp = (v: number) => Math.round(Math.log(v) / Math.log(base))
  for (const k of [2, 3, 5, 10, 20, 50, 100]) {
    const kept = d.ticks.filter((v) => exp(v) % k === 0)
    if (kept.length < 2) break
    if (fit(kept, d.min, d.max) || k === 100) {
      const left = d.ticks.filter((v) => exp(v) % k !== 0)
      return { ...d, ticks: kept, minorTicks: [...d.minorTicks, ...left].sort((a, b) => a - b) }
    }
  }
  return d
}

/**
 * Automatic linear ticks made coarser (`coarserStep`) until their labels fit: `make` lays the
 * ticks out for a step. Stops at two ticks or fewer, or once a step spans the data (`span`): at
 * most three ticks then, the range no wider than two steps.
 */
function coarsen(
  step: number,
  span: number,
  make: (step: number) => LinearAxisDomain,
  fit: TickFit | undefined,
): LinearAxisDomain {
  let d = make(step)
  for (
    let i = 0;
    fit && i < MAX_COARSER && step < span && d.ticks.length > 2 && !fit(d.ticks, d.min, d.max);
    i++
  ) {
    step = coarserStep(step)
    d = make(step)
  }
  return d
}

/**
 * Axis domain and ticks. `includeZero` mimics Prism's Y autoscale, which starts at zero when all
 * data share a sign. A manual range that can't be drawn (min ≥ max, or min ≤ 0 on a log axis)
 * falls back to the automatic range with a warning; ticks never fall outside a manual range, and
 * an interval giving more than MAX_TICKS ticks is widened. Automatic ticks whose labels don't fit
 * (`fit`) take a coarser step (an automatic range widened to it), or on a log axis every k-th
 * power; a manual interval is kept. A linear axis with breaks is ticked piece by piece when drawn
 * (`planContinuousAxis`), so `fit` is left to that.
 */
export function continuousDomain(
  axis: ContinuousAxis,
  extent: Extent,
  includeZero: boolean,
  warnings: string[],
  fit?: TickFit,
): LinearAxisDomain {
  const tr = transformOf(axis)
  // Ticks at listed values (roadmap 36): automatic ticks aren't drawn, so not thinned for labels.
  if (customTicks(axis)) fit = undefined
  if (tr.cyto) return cytoDomain(axis, extent, warnings, fit)
  const isLog = isLogScale(axis.scale)
  if (!isLog && axis.breaks.length) fit = undefined
  let { lo, hi } = extent
  if (extent.empty) {
    lo = isLog ? 1 : 0
    hi = isLog ? 10 : 1
  }
  let range = axis.range
  if (range !== 'auto') {
    const { min, max } = range
    if (!Number.isFinite(min) || !Number.isFinite(max) || !(min < max)) {
      warnings.push('An axis range needs a minimum below its maximum; using an automatic range.')
      range = 'auto'
    } else if (isLog && min <= 0) {
      warnings.push('A log axis range must be positive; using an automatic range.')
      range = 'auto'
    }
  }
  if (isLog) {
    const base = axis.scale === 'log10' ? 10 : 2
    if (range !== 'auto') {
      const { min, max } = range
      const auto = niceLogDomain(min, max, base)
      const within = (v: number) => v >= min * (1 - 1e-9) && v <= max * (1 + 1e-9)
      return thinLogTicks(
        { min, max, ticks: auto.ticks.filter(within), minorTicks: auto.minorTicks.filter(within) },
        base,
        fit,
      )
    }
    if (extent.empty) warnings.push('A log axis needs positive values.')
    return thinLogTicks(niceLogDomain(lo, hi, base), base, fit)
  }
  const ticks: { interval?: number; start?: number; minor?: number } =
    axis.ticks === 'auto' ? {} : { ...axis.ticks }
  const tooMany = (span: number) =>
    ticks.interval !== undefined && span / ticks.interval > MAX_TICKS
  // A manual interval is kept as set.
  const fitAuto = () => (ticks.interval === undefined ? fit : undefined)
  if (range !== 'auto') {
    const { min, max } = range
    if (tooMany(max - min)) {
      warnings.push('The tick interval is too small for the axis range; using a wider one.')
      ticks.interval = undefined
    }
    const eps = (max - min) * 1e-9
    const within = (v: number) => v >= min - eps && v <= max + eps
    const make = (step: number): LinearAxisDomain => {
      const start = ticks.start ?? Math.ceil(min / step - 1e-9) * step
      const minor = capMinor(ticks.minor, (max - min) / step)
      const d = niceLinearDomain(min, max, { interval: step, start, minor })
      return {
        ...d,
        min,
        max,
        ticks: d.ticks.filter(within),
        minorTicks: d.minorTicks.filter(within),
      }
    }
    return coarsen(
      ticks.interval ?? wholeStep(niceStep(max - min), extent.integer),
      max - min,
      make,
      fitAuto(),
    )
  }
  const a = includeZero && lo >= 0 ? 0 : lo
  const b = includeZero && hi <= 0 ? 0 : hi
  if (tooMany(b - a)) {
    warnings.push('The tick interval is too small for the axis range; using a wider one.')
    ticks.interval = undefined
  }
  if (ticks.interval !== undefined) {
    const majors = (b - a) / ticks.interval
    return niceLinearDomain(a, b, {
      interval: ticks.interval,
      minor: capMinor(ticks.minor, majors),
    })
  }
  // Counts: a step under 1 becomes 1, from a whole number (the ends stay the data's).
  if (extent.integer && niceStep(b - a) < 1 && !extent.empty) {
    const [a1, b1] = [Math.floor(a), Math.ceil(b)]
    return coarsen(
      1,
      b1 - a1,
      (step) =>
        step === 1
          ? niceLinearDomain(a1, b1, {
              interval: 1,
              start: a1,
              minor: capMinor(ticks.minor, b1 - a1),
            })
          : niceLinearDomain(a1, b1, { step, minor: capMinor(ticks.minor, (b1 - a1) / step) }),
      fit,
    )
  }
  // The step `niceLinearDomain` would take (a single value: a range around it).
  const span = a === b ? (a === 0 ? 2 : Math.abs(a) * 0.2) : b - a
  return coarsen(
    niceStep(span),
    span,
    (step) => niceLinearDomain(a, b, { step, minor: capMinor(ticks.minor, (b - a) / step) }),
    fit,
  )
}

/**
 * Roadmap 34g: the domain and ticks of an arcsinh or logicle axis — automatic: zero always shown,
 * a logicle axis at least its whole display (`cytoRange`); a manual range as set; ticks at 0 and
 * the decades ±10ⁿ that stand apart, thinned while their labels crowd (`cytoTicks`).
 */
function cytoDomain(
  axis: ContinuousAxis,
  extent: Extent,
  warnings: string[],
  fit?: TickFit,
): LinearAxisDomain {
  const tr = transformOf(axis)
  let range = axis.range
  if (
    range !== 'auto' &&
    !(Number.isFinite(range.min) && Number.isFinite(range.max) && range.min < range.max)
  ) {
    warnings.push('An axis range needs a minimum below its maximum; using an automatic range.')
    range = 'auto'
  }
  const [min, max] =
    range !== 'auto'
      ? [range.min, range.max]
      : cytoRange(
          tr,
          extent.empty ? 0 : extent.lo,
          extent.empty ? 1 : extent.hi,
          axis.scale === 'logicle' ? logicleParams(axis.logicle).T : undefined,
        )
  const t = cytoTicks(tr, min, max, fit ? (values) => fit(values, min, max) : undefined)
  return { min, max, ...t }
}

/** A tick step, at least 1 for whole-number data. */
const wholeStep = (step: number, integer: boolean) => (integer && step < 1 ? 1 : step)

/**
 * A continuous value axis drawn over `range` (plot-local: [0, W] for X, [H, 0] for Y): its
 * domain (see `continuousDomain`; `fit`: whether automatic ticks leave their labels room, see
 * `tickFit`), scale, and the mappings marks use.
 */
export function valueAxis(
  spec: ContinuousAxis,
  extent: Extent,
  includeZero: boolean,
  range: [number, number],
  warnings: string[],
  fit?: TickFit,
) {
  const log = isLogScale(spec.scale)
  const dom = continuousDomain(spec, extent, includeZero, warnings, fit)
  const scale = makeAxisScale(transformOf(spec), [dom.min, dom.max], range, {
    reverse: spec.reverse,
    breaks: spec.breaks,
    pieces: spec.pieces,
  })
  const length = Math.abs(range[1] - range[0])
  // A bar's start: the value (0 by default) clamped to the axis; on a log axis 0 (or any value
  // ≤ 0) is the axis' start.
  const at = (b: number | undefined) =>
    log && !((b ?? 0) > 0) ? dom.min : Math.min(Math.max(b ?? 0, dom.min), dom.max)
  return {
    spec,
    log,
    dom,
    scale,
    /** A value the axis can show: finite, and positive on a log axis. */
    ok: (v: number) => Number.isFinite(v) && (!log || v > 0),
    /** Point position, or NaN when hidden (in a break or outside the plot). */
    point: (v: number) => {
      const p = scale(v)
      return p >= -0.5 && p <= length + 0.5 ? p : Number.NaN
    },
    /** End of a bar, box, band or error bar, clipped to the plot (log: ≤ 0 goes to the start). */
    end: (v: number) =>
      Math.max(0, Math.min(length, log && v <= 0 ? scale.edge(dom.min) : scale.edge(v))),
    /** Where bars start: zero, or the axis' start when zero is off the axis (or log). */
    baseline: at(undefined),
    /** Where bars with a chosen baseline start (roadmap 30); absent = `baseline`. */
    baselineAt: at,
  }
}

export type ValueAxis = ReturnType<typeof valueAxis>

/**
 * Ticks of a broken linear axis, planned piece by piece (each piece gets its share of ticks; an
 * automatic step made coarser while that piece's labels don't fit, `fits`).
 */
function pieceTicks(
  spec: ContinuousAxis,
  scale: Scale,
  pieces: readonly [number, number][],
  fits?: (values: readonly number[], positions: readonly number[]) => boolean,
): { ticks: number[]; minor: number[] } {
  const px = pieces.map(([lo, hi]) => Math.abs(scale(hi) - scale(lo)))
  const total = px.reduce((a, b) => a + b, 0) || 1
  const manual = spec.ticks === 'auto' ? null : spec.ticks
  const ticks: number[] = []
  const minor: number[] = []
  pieces.forEach(([lo, hi], i) => {
    const span = hi - lo
    let step = manual?.interval ?? niceStep(span, Math.max(1, (5 * px[i]!) / total))
    const auto = manual?.interval === undefined || span / step > MAX_TICKS
    if (span / step > MAX_TICKS) step = niceStep(span, Math.max(1, (5 * px[i]!) / total))
    const origin = manual?.start ?? 0
    const along = (step: number) => {
      const eps = step * 1e-9
      const first = origin + Math.ceil((lo - origin) / step - 1e-9) * step
      const out: number[] = []
      for (let v = first, k = 0; v <= hi + eps && k <= MAX_TICKS; k++, v = first + k * step)
        out.push(snap(v, step))
      return { first, eps, out }
    }
    let t = along(step)
    for (
      let k = 0;
      auto &&
      fits &&
      k < MAX_COARSER &&
      step < span &&
      t.out.length > 2 &&
      !fits(t.out, t.out.map(scale));
      k++
    ) {
      step = coarserStep(step)
      t = along(step)
    }
    const { first, eps } = t
    ticks.push(...t.out)
    const m = capMinor(manual?.minor, span / step) ?? 0
    if (m > 0) {
      const ms = step / (m + 1)
      for (let k = 0, v = first - step; v <= hi + eps && k < MAX_MINOR_TICKS; k++) {
        v = first - step + k * ms
        if (k % (m + 1) !== 0 && v >= lo - eps && v <= hi + eps) minor.push(snap(v, ms))
      }
    }
  })
  return { ticks, minor }
}

/**
 * Least room between neighbouring tick labels side by side along a continuous axis (reading
 * along it), in ems of their size. Labels stacked across it (a vertical axis' level labels, or
 * slanted ones) need only their lines apart: a line's height holds the font's own spacing.
 */
export const TICK_LABEL_GAP = 0.5

/**
 * Roadmap 36: an axis' listed ticks — `tickValues`, else the values of its `tickText` — major and
 * minor; null when it has none (automatic or interval ticks).
 */
export function customTicks(
  spec: Pick<ContinuousAxis, 'tickValues' | 'tickText'>,
): { major: number[]; minor: number[] } | null {
  if (spec.tickValues)
    return {
      major: spec.tickValues.major.filter(Number.isFinite),
      minor: (spec.tickValues.minor ?? []).filter(Number.isFinite),
    }
  if (spec.tickText?.length)
    return { major: spec.tickText.map((t) => t.value).filter(Number.isFinite), minor: [] }
  return null
}

/** Whether two tick values are the same (to 1e-9 of their size). */
const sameValue = (a: number, b: number) =>
  Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))

/**
 * The tick labels of values on a continuous axis as drawn: in units of 10ⁿ, in its format; a
 * value with text of its own (`tickText`, roadmap 36) labelled with it.
 */
export function continuousTickLabels(spec: ContinuousAxis, values: readonly number[]): RichText[] {
  // Labels in units of 10ⁿ ("×10⁴" axes); dividing by a power of ten keeps round ticks round.
  const power = spec.labelPower ?? 0
  const shown = (v: number) => (power > 0 ? v / 10 ** power : power < 0 ? v * 10 ** -power : v)
  const format = tickFormatter(spec.format, values.map(shown), spec.scale)
  const text = spec.tickText
  return values.map((v) => {
    const own = text?.find((t) => sameValue(t.value, v))
    return own ? labelRuns(own.text) : format(shown(v))
  })
}

/**
 * Whether the tick labels of a continuous axis at these values and plot-local positions along it
 * leave neighbours room, measured with the bundled fonts (labels centred on their ticks): labels
 * reading along the axis their widths and TICK_LABEL_GAP between them, labels stacked across it
 * their line heights, slanted (parallel) ones their line height across. Hidden labels always fit.
 */
export function tickLabelsFit(
  ctx: GraphContext,
  theme: Theme,
  which: Orientation,
  spec: ContinuousAxis,
  values: readonly number[],
  positions: readonly number[],
): boolean {
  if (spec.show === false || spec.showLabels === false || values.length < 2) return true
  const style = graphText(theme.tickLabel, ctx.graph, spec.tickLabels)
  const rotation = spec.rotation ?? 0
  const labels = continuousTickLabels(spec, values)
  const placed = labels
    .map((content, i) => {
      const t = layoutText(ctx.fonts, content, style)
      const h = t.ascent + t.descent
      // Room along the axis: the width of labels reading along it, else their height.
      const along = (which === 'x') === (rotation === 0) ? t.width : h
      return { pos: positions[i]!, room: rotation === 45 ? h * Math.SQRT2 : along }
    })
    .filter((p) => Number.isFinite(p.pos))
    .sort((a, b) => a.pos - b.pos)
  const reading = rotation !== 45 && (which === 'x') === (rotation === 0)
  const gap = reading ? TICK_LABEL_GAP * style.size : 0
  return placed.every(
    (p, i) => i === 0 || p.pos - placed[i - 1]!.pos >= (p.room + placed[i - 1]!.room) / 2 + gap,
  )
}

/**
 * A `TickFit` for an axis `length` points long drawn along `which` (positions from the values:
 * linear, or log by the axis' scale).
 */
export function tickFit(
  ctx: GraphContext,
  theme: Theme,
  which: Orientation,
  spec: ContinuousAxis,
  length: number,
): TickFit {
  const t = transformOf(spec).forward
  return (values, min, max) => {
    const [a, b] = [t(min), t(max)]
    const k = b > a ? length / (b - a) : 0
    return tickLabelsFit(
      ctx,
      theme,
      which,
      spec,
      values,
      values.map((v) => (t(v) - a) * k),
    )
  }
}

export type Orientation = 'x' | 'y'

export interface AxisTick {
  /** Plot-local position along the axis. */
  pos: number
  content: RichText
}

/** Everything needed to size and draw an axis (continuous or categorical). */
export interface AxisPlan {
  /** Along which side of the plot the axis runs: 'x' horizontally, 'y' vertically. */
  which: Orientation
  /**
   * A Y axis drawn on the plot's right (the right Y axis, `axes.y2`); an X axis drawn along the
   * plot's top (a horizontal estimation plot's difference axis).
   */
  right?: boolean
  /**
   * The axis spec it draws when that isn't the one its side suggests (horizontal graphs: the
   * category axis `x` runs down the left, the value axis `y` along the bottom).
   */
  key?: 'x' | 'y' | 'y2'
  spec: AxisSpec
  categorical: boolean
  /** Plot extent along the axis (plot width for X, height for Y). */
  length: number
  /**
   * Plot-local position of a value of this axis (categorical axes: the category index, 0 = first
   * category's centre). Values inside an axis break map to the break's edge.
   */
  toPx: (v: number) => number
  /** Inverse of `toPx`. */
  fromPx: (p: number) => number
  ticks: AxisTick[]
  /** Plot-local positions of minor ticks. */
  minor: number[]
  /** Axis-break gaps, plot-local [start, end] along the axis. */
  gaps: [number, number][]
  /** Draw this axis where the other axis has this value (continuous axes' `anchor`). */
  anchor?: number
  /**
   * A floating axis: its line runs only between these plot-local positions (e.g. an estimation
   * plot's difference axis, over the differences' range), not the plot's full length.
   */
  span?: [number, number]
  show: boolean
  line: Stroke
  tick: {
    direction: 'out' | 'in' | 'cross' | 'none'
    length: number
    minorLength: number
    stroke: Stroke
  }
  labels: {
    show: boolean
    style: TextStyle
    rotation: 0 | 45 | 90
    /** Largest label extent perpendicular to the axis. */
    depth: number
  }
  /** Tick-label overhang beyond the plot's start and end along the axis (left/right, top/bottom). */
  overhang: [number, number]
  title: { content: RichText; style: TextStyle; thickness: number; length: number } | null
  labelGap: number
  titleGap: number
  offset: number
  grid: { major: Stroke | null; minor: Stroke | null }
  /** Roadmap 36: a category axis' treatment grid and spans, beyond its names. */
  extras?: CategoryExtras
}

/** Style path key of an axis: 'x', 'y', or 'y2' for the right Y axis. */
export const axisKey = (plan: Pick<AxisPlan, 'which' | 'right' | 'key'>): 'x' | 'y' | 'y2' =>
  plan.key ?? (plan.right ? 'y2' : plan.which)

/** Anchoring of tick labels relative to their tick, per axis and label angle. */
function labelAnchor(
  which: Orientation,
  rotation: 0 | 45 | 90,
  right = false,
): { h: HAnchor; v: VAnchor; angle?: number } {
  // An X axis along the top: labels above it.
  if (which === 'x' && right)
    return rotation ? { h: 'start', v: 'middle', angle: -rotation } : { h: 'middle', v: 'bottom' }
  if (which === 'x')
    return rotation ? { h: 'end', v: 'middle', angle: -rotation } : { h: 'middle', v: 'top' }
  // Right Y axis: labels read away from the axis, mirroring the left one.
  if (right) {
    if (rotation === 90) return { h: 'middle', v: 'bottom', angle: 90 }
    if (rotation === 45) return { h: 'start', v: 'middle', angle: 45 }
    return { h: 'start', v: 'middle' }
  }
  if (rotation === 90) return { h: 'middle', v: 'bottom', angle: -90 }
  if (rotation === 45) return { h: 'end', v: 'middle', angle: -45 }
  return { h: 'end', v: 'middle' }
}

interface PlanInput {
  which: Orientation
  right?: boolean
  key?: 'x' | 'y' | 'y2'
  spec: AxisSpec
  categorical: boolean
  length: number
  toPx: (v: number) => number
  fromPx: (p: number) => number
  ticks: AxisTick[]
  minor: number[]
  gaps: [number, number][]
  anchor?: number
  span?: [number, number]
  offset: number
  rotation: 0 | 45 | 90
  /**
   * true: overhang from the labels' actual positions (categorical axes). false: as if the first
   * and last labels sat at the plot's ends, which keeps continuous axes stable as ranges change.
   */
  exactOverhang: boolean
  extras?: CategoryExtras
}

function planAxisFrom(
  ctx: GraphContext,
  theme: Theme,
  palette: readonly string[],
  input: PlanInput,
): AxisPlan {
  const { fonts, graph } = ctx
  const { which, spec, rotation } = input
  const show = spec.show !== false
  const labelStyle = graphText(theme.tickLabel, graph, spec.tickLabels)
  const showLabels = show && spec.showLabels !== false
  const right = !!input.right
  const anchor = labelAnchor(which, rotation, right)

  let depth = 0
  let overhang: [number, number] = [0, 0]
  if (showLabels && input.ticks.length) {
    const r = (rotation * Math.PI) / 180
    const measured = input.ticks.map((t) => {
      const probe = placeText(
        fonts,
        'probe',
        t.content,
        labelStyle,
        palette,
        0,
        0,
        anchor.h,
        anchor.v,
        {
          angle: anchor.angle,
        },
      )
      const b = probe.bbox
      const h = probe.layout.ascent + probe.layout.descent
      return {
        pos: t.pos,
        // Perpendicular extent; rotated X labels keep the (conservative) w·sin + h·cos.
        depth:
          which === 'y'
            ? Math.max(0, right ? b.x + b.w : -b.x)
            : rotation
              ? probe.layout.width * Math.sin(r) + h * Math.cos(r)
              : h,
        along: (which === 'x' ? [b.x, b.x + b.w] : [b.y, b.y + b.h]) as [number, number],
      }
    })
    depth = Math.max(0, ...measured.map((m) => m.depth))
    if (input.exactOverhang) {
      overhang = [
        Math.max(0, ...measured.map((m) => -(m.pos + m.along[0]))),
        Math.max(0, ...measured.map((m) => m.pos + m.along[1] - input.length)),
      ]
    } else {
      const first = measured.reduce((a, b) => (b.pos < a.pos ? b : a))
      const last = measured.reduce((a, b) => (b.pos > a.pos ? b : a))
      overhang = [Math.max(0, -first.along[0]), Math.max(0, last.along[1])]
    }
  }

  const extras = show ? input.extras : undefined
  if (extras)
    overhang = [
      Math.max(overhang[0], extras.overhang[0]),
      Math.max(overhang[1], extras.overhang[1]),
    ]
  const titleStyle = graphText(theme.axisTitle, graph, spec.title?.style)
  const titleProbe = spec.title?.content.length
    ? layoutText(fonts, spec.title.content, titleStyle)
    : null
  const line = resolveStroke({ ...theme.axisLine, ...spec.line }, palette)
  const ts = spec.tickStyle ?? {}
  return {
    which,
    ...(right ? { right } : {}),
    ...(input.key ? { key: input.key } : {}),
    spec,
    categorical: input.categorical,
    length: input.length,
    toPx: input.toPx,
    fromPx: input.fromPx,
    ticks: input.ticks,
    minor: input.minor,
    gaps: input.gaps,
    anchor: input.anchor,
    ...(input.span ? { span: input.span } : {}),
    show,
    line,
    tick: {
      direction: ts.direction ?? theme.tickDirection,
      length: ts.length ?? theme.tickLength,
      minorLength: ts.minorLength ?? theme.minorTickLength,
      stroke:
        (ts.width ?? theme.tickWidth) === undefined
          ? line
          : { ...line, width: ts.width ?? theme.tickWidth! },
    },
    labels: { show: showLabels, style: labelStyle, rotation, depth },
    overhang,
    title:
      titleProbe && spec.title
        ? {
            content: spec.title.content,
            style: titleStyle,
            thickness: titleProbe.ascent + titleProbe.descent,
            length: titleProbe.width,
          }
        : null,
    labelGap: theme.labelGap,
    titleGap: theme.titleGap + (spec.titleGap ?? 0),
    offset: input.offset,
    grid: {
      major: spec.grid?.major ? resolveStroke(spec.grid.major, palette) : null,
      minor: spec.grid?.minor ? resolveStroke(spec.grid.minor, palette) : null,
    },
    ...(extras ? { extras } : {}),
  }
}

// Audit 3, P1: an axis plan's maps outlive the layout (a scene's axes call them), so they are
// made here, out of the planners' scopes: a closure keeps every variable its scope's closures
// read (V8 shares one context among them), which there is the layout's context and project.

/** A continuous axis' maps of `scale`. */
const scaleMaps = (scale: Scale): Pick<AxisPlan, 'toPx' | 'fromPx'> => ({
  toPx: (v) => scale.edge(v),
  fromPx: (p) => scale.invert(p),
})

/** A categorical axis' maps, `slot` points per category. */
const categoryMaps = (slot: number): Pick<AxisPlan, 'toPx' | 'fromPx'> => ({
  toPx: (v) => (v + 0.5) * slot,
  fromPx: (p) => p / slot - 0.5,
})

/**
 * Plans a continuous axis over `dom` drawn with `scale` (plot-local: X ranges [0, W], Y ranges
 * [H, 0]; see `makeAxisScale`). With breaks, linear ticks are planned per visible piece.
 */
export function planContinuousAxis(
  ctx: GraphContext,
  theme: Theme,
  palette: readonly string[],
  which: Orientation,
  spec: ContinuousAxis,
  dom: LinearAxisDomain,
  scale: Scale,
  opts: { right?: boolean; span?: [number, number]; key?: 'x' | 'y' | 'y2' } = {},
): AxisPlan {
  let values = dom.ticks
  let minorValues = dom.minorTicks
  const custom = customTicks(spec)
  if (custom) {
    // Ticks at listed values (roadmap 36): those on the axis (inside its range, not in a break).
    const eps = Math.abs(dom.max - dom.min) * 1e-9
    const on = (v: number) =>
      v >= Math.min(dom.min, dom.max) - eps &&
      v <= Math.max(dom.min, dom.max) + eps &&
      Number.isFinite(scale(v))
    values = [...new Set(custom.major)].filter(on).sort((a, b) => a - b)
    minorValues = [...new Set(custom.minor)].filter(on).sort((a, b) => a - b)
  } else if (scale.pieces) {
    if (spec.scale === 'linear') {
      const t = pieceTicks(spec, scale, scale.pieces, (v, p) =>
        tickLabelsFit(ctx, theme, which, spec, v, p),
      )
      values = t.ticks
      minorValues = t.minor
    } else {
      values = values.filter((v) => Number.isFinite(scale(v)))
      minorValues = minorValues.filter((v) => Number.isFinite(scale(v)))
    }
  }
  const labels = continuousTickLabels(spec, values)
  const ticks = values.flatMap((v, i) => {
    const pos = scale(v)
    return Number.isFinite(pos) ? [{ pos, content: labels[i]! }] : []
  })
  const length = Math.abs(scale.range[1] - scale.range[0])
  return planAxisFrom(ctx, theme, palette, {
    which,
    right: opts.right,
    key: opts.key,
    spec,
    categorical: false,
    length,
    ...scaleMaps(scale),
    ticks,
    minor: minorValues.map((v) => scale(v)).filter(Number.isFinite),
    gaps: scale.gaps,
    anchor: spec.anchor,
    span: opts.span,
    offset: spec.frame === 'offset' ? OFFSET_FRAME : 0,
    rotation: spec.rotation ?? 0,
    exactOverhang: false,
  })
}

/**
 * Plans a categorical X axis: one tick and label per category at `slot` intervals (category i
 * centred at (i + 0.5)·slot). Labels rotate by the spec's angle; with 0, by 45° when they would
 * collide and 90° when the slots are too narrow even for slanted labels. With `which` 'y' the
 * categories run down the left from the top (horizontal graphs, heat map rows), labels level
 * unless rotated; `key` names the spec it draws when not the X axis.
 */
export function planCategoricalAxis(
  ctx: GraphContext,
  theme: Theme,
  palette: readonly string[],
  axisSpec: AxisSpec,
  labels: readonly (string | RichText)[],
  length: number,
  offset: number,
  opts: { which?: Orientation; key?: 'x' | 'y' | 'y2'; categories?: CategoryLayout } = {},
): AxisPlan {
  const which = opts.which ?? 'x'
  // Roadmap 36: a treatment grid and spans beyond the names (a grouped graph's bars named under
  // them with spans from the data; the names hidden under a grid).
  const extras = opts.categories
    ? categoryExtras(ctx, theme, palette, axisSpec, which, opts.categories)
    : null
  const spec = extras?.hideNames ? { ...axisSpec, showLabels: false } : axisSpec
  const own = extras?.ticks
  const ticks =
    own ??
    labels.map((l, i) => ({
      pos: (i + 0.5) * (length / Math.max(labels.length, 1)),
      content: labelRuns(l),
    }))
  const slot = own
    ? Math.min(length, ...own.slice(1).map((t, i) => Math.abs(t.pos - own[i]!.pos)))
    : length / Math.max(labels.length, 1)
  const style = graphText(theme.tickLabel, ctx.graph, spec.tickLabels)
  const set = spec.rotation ?? 0
  const shown = spec.show !== false && spec.showLabels !== false
  const probes =
    shown && which === 'x' ? ticks.map((t) => layoutText(ctx.fonts, t.content, style)) : []
  // Auto: 45° when labels would collide, 90° when even slanted labels would overlap.
  const collide = probes.some((p) => p.width > slot * 0.95)
  const crowded = probes.some((p) => slot * Math.SQRT1_2 < (p.ascent + p.descent) * 0.95)
  const auto: 0 | 45 | 90 = collide ? (crowded ? 90 : 45) : 0
  return planAxisFrom(ctx, theme, palette, {
    which,
    key: opts.key,
    spec,
    categorical: true,
    length,
    ...categoryMaps(length / Math.max(labels.length, 1)),
    ticks,
    minor: [],
    gaps: [],
    offset,
    rotation: set || auto,
    exactOverhang: true,
    ...(extras ? { extras } : {}),
  })
}

/**
 * The tick labels' distance from the ticks: the theme's gap plus the group's own move across the
 * axis (`tickLabelOffset`, roadmap 22), never so far in that they would cross the axis line.
 */
const labelDistance = (plan: AxisPlan, tickOut: number) =>
  Math.max(-tickOut, plan.labelGap + (plan.spec.tickLabelOffset ?? 0))

/**
 * How far ticks and labels reach out from the axis line, the parts adding up to it, and (roadmap
 * 36) where a category axis' extras start beyond them.
 */
function axisReach(plan: AxisPlan): {
  tickOut: number
  parts: number[]
  reach: number
  extrasAt: number
} {
  if (!plan.show) return { tickOut: 0, parts: [], reach: 0, extrasAt: 0 }
  const t = plan.tick
  const tickOut = t.direction === 'out' ? t.length : t.direction === 'cross' ? t.length / 2 : 0
  const parts = plan.labels.show
    ? [tickOut, labelDistance(plan, tickOut), plan.labels.depth]
    : [tickOut]
  // Labels moved in towards the axis still leave the ticks' own reach.
  const reach = Math.max(
    tickOut,
    parts.reduce((a, b) => a + b, 0),
  )
  if (!plan.extras) return { tickOut, parts, reach, extrasAt: 0 }
  const extrasAt = reach + EXTRAS.gap
  return { tickOut, parts, reach: extrasAt + plan.extras.depth, extrasAt }
}

/**
 * Space the axis needs outside the plot area. `inset` is how far inside the plot the axis line
 * sits (an anchored axis), which its ticks and labels can use first.
 */
export function axisDepth(plan: AxisPlan, inset = 0): number {
  const r = axisReach(plan)
  const body = inset > 0 ? plan.offset + Math.max(0, r.reach - inset) : plan.offset + r.reach
  return body + (plan.title ? plan.titleGap + plan.title.thickness : 0)
}

type ToGraph = (p: number) => number

/** Splits [0, length] around the gaps into visible runs. */
export function runsAround(length: number, gaps: readonly [number, number][]): [number, number][] {
  const out: [number, number][] = []
  let a = 0
  for (const [g0, g1] of gaps) {
    out.push([a, g0])
    a = g1
  }
  out.push([a, length])
  return out
}

/**
 * Draws an axis in graph coordinates. `X`/`Y` map plot-local to graph coordinates; `at` is the
 * plot-local position of the axis line across the axis (y for the X axis, x for the Y axis) and
 * `cross` the plot's extent across it (the title goes beyond the plot's bottom or left edge).
 * Returns the nodes (line, ticks, labels, break marks, title) and the bounds of everything but
 * the title.
 */
export function drawAxis(
  ctx: GraphContext,
  palette: readonly string[],
  plan: AxisPlan,
  X: ToGraph,
  Y: ToGraph,
  at: number,
  cross: number,
  opts: { line?: boolean } = {},
): { nodes: SceneNode[]; bbox: Box | null } {
  const { fonts } = ctx
  const w = plan.which
  const right = !!plan.right
  const key = axisKey(plan)
  const target = ['axes', key]
  const along = w === 'y' ? Y : X
  const s = plan.line
  const seg = (
    id: string,
    a0: number,
    a1: number,
    c0: number,
    c1: number,
    stroke: Stroke,
    t: (string | number)[] = target,
  ): SceneNode =>
    w === 'y'
      ? { id, target: t, prim: { type: 'line', x1: c0, y1: a0, x2: c1, y2: a1, stroke } }
      : { id, target: t, prim: { type: 'line', x1: a0, y1: c0, x2: a1, y2: c1, stroke } }
  // The left Y axis and a top X axis sit at the start of the plot's extent across them.
  const before = (w === 'y') !== right
  const axisAt =
    w === 'y'
      ? X(at) + (right ? plan.offset : -plan.offset)
      : Y(at) + (right ? -plan.offset : plan.offset)
  const out = before ? -1 : 1 // ticks point away from the plot
  const nodes: SceneNode[] = []
  const drawn: SceneNode[] = []
  const { tickOut, reach, extrasAt } = axisReach(plan)

  if (plan.show && opts.line !== false) {
    const span = plan.span ?? (w === 'y' ? [plan.length, 0] : [0, plan.length])
    if (!plan.gaps.length) {
      nodes.push(seg(`axis/${key}/line`, along(span[0]!), along(span[1]!), axisAt, axisAt, s))
    } else {
      nodes.push({
        id: `axis/${key}/line`,
        target,
        children: runsAround(plan.length, plan.gaps).map(([a, b], k) =>
          seg(`axis/${key}/line/${k}`, along(a), along(b), axisAt, axisAt, s),
        ),
      })
    }
  }

  const t = plan.tick
  const tickSpan = (len: number): [number, number] =>
    t.direction === 'in'
      ? [axisAt, axisAt - out * len]
      : t.direction === 'cross'
        ? [axisAt - (out * len) / 2, axisAt + (out * len) / 2]
        : [axisAt, axisAt + out * len]
  const ticks = plan.show && t.direction !== 'none'
  const anchor = labelAnchor(w, plan.labels.rotation, right)
  const labelAt = axisAt + out * (tickOut + labelDistance(plan, tickOut))
  const labelTarget = [...target, 'tickLabels']
  plan.ticks.forEach((tk, k) => {
    const p = along(tk.pos)
    if (ticks) {
      const [c0, c1] = tickSpan(t.length)
      nodes.push(seg(`axis/${key}/tick/${k}`, p, p, c0, c1, t.stroke))
    }
    if (plan.labels.show) {
      const [x, y] = w === 'y' ? [labelAt, p] : [p, labelAt]
      nodes.push(
        placeText(
          fonts,
          `axis/${key}/tickLabel/${k}`,
          tk.content,
          plan.labels.style,
          palette,
          x,
          y,
          anchor.h,
          anchor.v,
          { angle: anchor.angle, target: labelTarget },
        ).node,
      )
    }
  })
  if (ticks) {
    plan.minor.forEach((pos, k) => {
      const p = along(pos)
      const [c0, c1] = tickSpan(t.minorLength)
      nodes.push(seg(`axis/${key}/minorTick/${k}`, p, p, c0, c1, t.stroke))
    })
  }
  if (plan.show && opts.line !== false) {
    // Roadmap 36: the marks' style and size (absent: '//' at each edge, BREAK_MARK).
    const mark = plan.spec.type === 'continuous' ? plan.spec.breakMark : undefined
    const m = mark?.size ?? BREAK_MARK
    const style = mark?.style ?? 'slash'
    const breaks = [...target, 'breaks']
    plan.gaps.forEach(([g0, g1], k) => {
      if (style === 'gap') return
      if (style === 'zigzag') {
        // A zigzag across the gap joining the line's ends (two teeth, at least 2m wide).
        const mid = (g0 + g1) / 2
        const half = Math.max((g1 - g0) / 2, m)
        const [a0, a1] = [mid - half, mid + half]
        const d = a1 - a0
        const pts: [number, number][] = [
          [a0, 0],
          [a0 + d / 4, m],
          [a0 + (3 * d) / 4, -m],
          [a1, 0],
        ]
        const points = pts.map(([u, c]): [number, number] =>
          w === 'y' ? [axisAt + c, along(u)] : [along(u), axisAt + c],
        )
        nodes.push({
          id: `axis/${key}/break/${k}`,
          target: breaks,
          prim: { type: 'polyline', points, stroke: s },
        })
        return
      }
      ;[g0, g1].forEach((g, e) => {
        const p = along(g)
        // A short slanted stroke across the line at each edge of the gap.
        nodes.push(
          seg(
            `axis/${key}/break/${k}/${e}`,
            p + m / 2,
            p - m / 2,
            axisAt - m,
            axisAt + m,
            s,
            breaks,
          ),
        )
      })
    })
  }
  // Roadmap 36: a category axis' treatment grid and spans, beyond its names.
  if (plan.show && plan.extras) {
    const at = (p: number, d: number): [number, number] =>
      w === 'y' ? [axisAt + out * d, along(p)] : [along(p), axisAt + out * d]
    nodes.push({
      id: `axis/${key}/extras`,
      target,
      children: plan.extras.draw(at, extrasAt, target),
    })
  }
  drawn.push(...nodes)

  if (plan.title) {
    const inset = before ? at : cross - at
    const d = Math.max(0, reach - inset) + plan.titleGap
    // A title dragged on the canvas: moved from its computed place (roadmap 22).
    const moved = plan.spec.titleOffset ?? { dx: 0, dy: 0 }
    const mid = along(plan.length / 2) + (w === 'y' ? moved.dy : moved.dx)
    const [mx, my] = w === 'y' ? [moved.dx, 0] : [0, moved.dy]
    // Y titles read upwards, centred at their distance; the X title hangs below it.
    const { content, style, thickness } = plan.title
    const [x, y] =
      w === 'x'
        ? [mid, right ? Y(0) - plan.offset - d + my : Y(cross) + plan.offset + d + my]
        : right
          ? [X(cross) + plan.offset + d + thickness / 2 + mx, mid]
          : [X(0) - plan.offset - d - thickness / 2 + mx, mid]
    const opts = { ...(w === 'y' ? { angle: -90 } : {}), target: [...target, 'title'] }
    const v = w === 'y' ? 'middle' : right ? 'bottom' : 'top'
    const title = placeText(
      fonts,
      `axis/${key}/title`,
      content,
      style,
      palette,
      x,
      y,
      'middle',
      v,
      opts,
    )
    nodes.push(title.node)
  }
  return { nodes, bbox: unionBoxes(drawn.map(nodeBounds)) }
}

/** Grid lines across the plot at an axis' major and minor ticks (graph coordinates). */
export function drawGrid(
  plan: AxisPlan,
  X: ToGraph,
  Y: ToGraph,
  W: number,
  H: number,
): SceneNode[] {
  const w = plan.which
  const key = axisKey(plan)
  const target = ['axes', key, 'grid']
  const out: SceneNode[] = []
  const line = (id: string, pos: number, stroke: Stroke): SceneNode =>
    w === 'x'
      ? { id, target, prim: { type: 'line', x1: X(pos), y1: Y(0), x2: X(pos), y2: Y(H), stroke } }
      : { id, target, prim: { type: 'line', x1: X(0), y1: Y(pos), x2: X(W), y2: Y(pos), stroke } }
  const { major, minor } = plan.grid
  if (minor) plan.minor.forEach((p, k) => void out.push(line(`grid/${key}/minor/${k}`, p, minor)))
  if (major)
    plan.ticks.forEach((t, k) => void out.push(line(`grid/${key}/major/${k}`, t.pos, major)))
  return out
}

/** Union of boxes (nulls skipped); null when there are none. */
export function unionBoxes(boxes: readonly (Box | null | undefined)[]): Box | null {
  return boxesUnion(
    boxes.filter((b): b is Box => !!b && [b.x, b.y, b.w, b.h].every(Number.isFinite)),
  )
}

/** The graph title, if any, and the space it takes. */
export function titleBlock(
  ctx: GraphContext,
  theme: Theme,
  palette: readonly string[],
): { height: number; width: number; draw: (cx: number, y: number) => SceneNode | null } {
  const { graph, fonts } = ctx
  if (!graph.title?.content.length) return { height: 0, width: 0, draw: () => null }
  const style = graphText(theme.graphTitle, graph, graph.title.style)
  const content = graph.title.content
  const probe = layoutText(fonts, content, style)
  return {
    height: probe.ascent + probe.descent + theme.titleGap,
    width: probe.width,
    draw: (cx, y) =>
      placeText(fonts, 'title', content, style, palette, cx, y, 'middle', 'top', {
        target: ['title'],
      }).node,
  }
}

/** Moves a subtree from plot-local to graph coordinates. */
export function translate(node: SceneNode, dx: number, dy: number): SceneNode {
  const out: SceneNode = { ...node }
  if (node.bbox) out.bbox = { ...node.bbox, x: node.bbox.x + dx, y: node.bbox.y + dy }
  if (node.children) out.children = node.children.map((c) => translate(c, dx, dy))
  const p = node.prim
  if (p) {
    switch (p.type) {
      case 'line':
        out.prim = { ...p, x1: p.x1 + dx, y1: p.y1 + dy, x2: p.x2 + dx, y2: p.y2 + dy }
        break
      case 'polyline':
      case 'polygon':
        out.prim = { ...p, points: p.points.map(([x, y]) => [x + dx, y + dy]) }
        break
      case 'rect':
      case 'image':
        out.prim = { ...p, x: p.x + dx, y: p.y + dy }
        break
      case 'ellipse':
        out.prim = { ...p, cx: p.cx + dx, cy: p.cy + dy }
        break
      case 'path':
        out.prim = {
          ...p,
          d: p.d.map((c) =>
            c[0] === 'Z'
              ? c
              : ([c[0], ...c.slice(1).map((v, i) => (v as number) + (i % 2 ? dy : dx))] as PathCmd),
          ),
        }
        break
      case 'symbol':
        out.prim = { ...p, cx: p.cx + dx, cy: p.cy + dy }
        break
      case 'points':
        out.prim = movePoints(p, (x, y) => [x + dx, y + dy])
        break
      case 'text':
        out.prim = {
          ...p,
          x: p.x + dx,
          y: p.y + dy,
          rotate: p.rotate && { ...p.rotate, cx: p.rotate.cx + dx, cy: p.rotate.cy + dy },
        }
        break
    }
  }
  return out
}

type Pt = [number, number]

/** Liang–Barsky clip of segment a→b to the rectangle; null if fully outside. */
function clipSegment(a: Pt, b: Pt, w: number, h: number): [Pt, Pt] | null {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  let t0 = 0
  let t1 = 1
  const edges: [number, number][] = [
    [-dx, a[0]],
    [dx, w - a[0]],
    [-dy, a[1]],
    [dy, h - a[1]],
  ]
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null
    } else {
      const r = q / p
      if (p < 0) {
        if (r > t1) return null
        if (r > t0) t0 = r
      } else {
        if (r < t0) return null
        if (r < t1) t1 = r
      }
    }
  }
  return [
    [a[0] + t0 * dx, a[1] + t0 * dy],
    [a[0] + t1 * dx, a[1] + t1 * dy],
  ]
}

/**
 * Clips a polyline (plot-local coordinates) to the plot rectangle [0,w]×[0,h], splitting it where
 * it leaves the plot or where a point is non-finite (e.g. a curve undefined at some X).
 */
export function clipPolyline(points: readonly Pt[], w: number, h: number): Pt[][] {
  const runs: Pt[][] = []
  let cur: Pt[] = []
  const flush = () => {
    if (cur.length > 1) runs.push(cur)
    cur = []
  }
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    if (![a[0], a[1], b[0], b[1]].every(Number.isFinite)) {
      flush()
      continue
    }
    const seg = clipSegment(a, b, w, h)
    if (!seg) {
      flush()
      continue
    }
    const last = cur.at(-1)
    if (!last || last[0] !== seg[0][0] || last[1] !== seg[0][1]) {
      flush()
      cur.push(seg[0])
    }
    cur.push(seg[1])
    // Leaving the plot ends this run.
    if (seg[1][0] !== b[0] || seg[1][1] !== b[1]) flush()
  }
  flush()
  return runs
}

/** Label text of a significance bracket: live from its analysis comparison, or manual. */
export function bracketLabel(
  ctx: GraphContext,
  a: Extract<Annotation, { type: 'bracket' }>,
): RichText {
  if (a.label.source === 'manual') return labelRuns(a.label.text)
  return [{ text: bracketText(ctx, a.label) }]
}

function bracketText(
  ctx: GraphContext,
  src: Extract<Extract<Annotation, { type: 'bracket' }>['label'], { source: 'analysis' }>,
): string {
  const cmp = ctx.result?.(src.analysis)?.comparisons.find((c) => c.key === src.comparison)
  if (!cmp) return '…'
  const { settings } = ctx.project
  const p = cmp.pAdjusted ?? cmp.p
  const pText = formatP(p, settings)
  const pLabel = /^[<>]/.test(pText) ? `P ${pText[0]} ${pText.slice(1)}` : `P = ${pText}`
  const stars = pSummary(p, settings.pValueStyle)
  if (src.show === 'number') return pText
  return src.show === 'stars' ? stars : src.show === 'p' ? pLabel : `${stars} (${pLabel})`
}
