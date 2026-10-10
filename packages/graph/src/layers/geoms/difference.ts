import type { ContinuousAxisSpec } from '@ps/model'
import type { GraphSeries, PlotStats } from '../../data.ts'
import {
  type AxisPlan,
  type GraphContext,
  planContinuousAxis,
  tickLabelsFit,
  type ValueAxis,
} from '../../layout/common.ts'
import { symbolPaint } from '../../layout/points.ts'
import { coarserStep, makeScale, niceStep, snap } from '../../scale.ts'
import type { SceneNode } from '../../scene.ts'
import { type ResolvedSeriesStyle, resolveStroke, type Theme } from '../../theme.ts'
import { DEFAULT_RIGHT_AXIS } from '../../yAxes.ts'
import type { EstimationDiff } from '../stats/difference.ts'

// The difference geom (estimation plots): each data set's difference from the first, with its
// CI, in slots of its own beside the data; guides from each group's mean to the difference axis,
// a floating secondary axis (the left scale shifted to the control's mean).

/** The difference axis of an estimation plot when the graph has no `axes.y2` of its own. */
export const ESTIMATION_AXIS: ContinuousAxisSpec = {
  ...DEFAULT_RIGHT_AXIS,
  title: { content: [{ text: 'Difference between means' }] },
}

/** An estimation plot's category layout. */
export interface DifferenceInput {
  /** The data sets, each with the difference layer's style for it. */
  series: readonly { s: GraphSeries; style: ResolvedSeriesStyle; color: string; stats: PlotStats }[]
  diffs: readonly EstimationDiff[]
  /** Centre of category i: the data sets, then the differences. */
  cx: (i: number) => number
  /** The (left) Y axis. */
  y: ValueAxis
  W: number
  H: number
  /** Records how high the marks of data set i reach (plot-local y), for brackets. */
  touch: (i: number, py: number) => void
  /** A horizontal graph: the difference axis runs along the top (marks stay vertical). */
  horizontal?: boolean
  /** Dashed guides from the means to the difference axis. */
  guides: boolean
  /** The difference axis' format (the graph's right axis). */
  axisSpec: ContinuousAxisSpec
  /** The id part of a data set's difference marks (`estimation`, with `@<layer>` if repeated). */
  part: (key: string) => string
}

/**
 * The differences of an estimation plot with their CIs, the guides from each group's mean to its
 * difference, and the floating difference axis on the right.
 */
export function differenceMarks(
  ctx: GraphContext,
  theme: Theme,
  palette: readonly string[],
  input: DifferenceInput,
): { nodes: SceneNode[]; guides: SceneNode[]; axis: AxisPlan | undefined } {
  const { series, diffs, cx, W, H, touch } = input
  const { point: yPoint, end: yEnd, dom, spec: ySpec } = input.y
  const nodes: SceneNode[] = []
  const guides: SceneNode[] = []
  const control = series[0]
  const guide = { color: '#808080', width: 0.75, dash: 'dash' as const }
  const showGuides = input.guides
  diffs.forEach((d, j) => {
    const p = series[d.index]!
    const key = p.s.key
    const target = ['seriesOverrides', key]
    const id = `${input.part(key)}/${key}`
    const x0 = cx(series.length + j)
    const at = (v: number) => (Number.isFinite(v) ? yPoint(d.control + v) : Number.NaN)
    const [yLo, yHi] = [yEnd(d.control + d.lo), yEnd(d.control + d.hi)]
    const children: SceneNode[] = []
    if (Number.isFinite(d.lo) && Number.isFinite(d.hi)) {
      const stroke = resolveStroke(p.style.error.line, palette, p.color)
      const cap = p.style.error.capWidth
      const lines: [number, number, number, number][] = [[x0, yHi, x0, yLo]]
      if (cap > 0) lines.push([x0 - cap / 2, yHi, x0 + cap / 2, yHi])
      if (cap > 0) lines.push([x0 - cap / 2, yLo, x0 + cap / 2, yLo])
      lines.forEach(([x1, y1, x2, y2], k) => {
        children.push({
          id: `${id}/ci/${k}`,
          target: [...target, 'error'],
          prim: { type: 'line', x1, y1, x2, y2, stroke },
        })
      })
      touch(d.index, Math.min(yHi, yLo))
    }
    const cy = at(d.diff)
    if (Number.isFinite(cy)) {
      const size = p.style.points.size * 1.4
      children.push({
        id: `${id}/diff`,
        target: [...target, 'points'],
        prim: {
          type: 'symbol',
          shape: p.style.points.shape,
          cx: x0,
          cy,
          size,
          ...symbolPaint(p.style.points, palette, p.color),
        },
        bbox: { x: x0 - size / 2, y: cy - size / 2, w: size, h: size },
      })
    }
    nodes.push({ id, target, children })
    // A dashed line from the group's mean to its difference (the axis' zero is the control's).
    const my = yPoint(d.mean)
    if (showGuides && Number.isFinite(my))
      guides.push({
        id: `${input.part(key)}/guide/${key}`,
        target: ['style', 'estimation'],
        prim: { type: 'line', x1: cx(d.index), y1: my, x2: x0, y2: my, stroke: guide },
      })
  })
  const zero = control ? yPoint(control.stats.mean) : Number.NaN
  if (showGuides && diffs.length && Number.isFinite(zero))
    guides.push({
      id: 'estimation/guide/control',
      target: ['style', 'estimation'],
      prim: { type: 'line', x1: cx(0), y1: zero, x2: W, y2: zero, stroke: guide },
    })
  // The difference axis: the left scale shifted so that 0 is the control's mean, drawn over
  // the range of the differences (with 0) only.
  const c0 = control?.stats.mean ?? Number.NaN
  let axis: AxisPlan | undefined
  if (diffs.length && Number.isFinite(c0)) {
    const spec = input.axisSpec
    const values = [0, ...diffs.flatMap((d) => [d.diff, d.lo, d.hi])].filter(Number.isFinite)
    const [lo, hi] = [Math.min(...values), Math.max(...values)]
    const interval = spec.ticks === 'auto' ? 0 : spec.ticks.interval
    const manual = interval > 0
    let step = manual ? interval : niceStep(Math.max(hi - lo, 1e-12), 4)
    const [dmin, dmax] = [dom.min - c0, dom.max - c0]
    // Horizontal: larger differences to the right, the axis along the top.
    const h = !!input.horizontal
    const scale = makeScale('linear', [dmin, dmax], !!ySpec.reverse !== h ? [0, H] : [H, 0])
    const plan = (step: number) => {
      const t0 = Math.max(Math.floor(lo / step + 1e-9) * step, dmin)
      const t1 = Math.min(Math.ceil(hi / step - 1e-9) * step, dmax)
      const ticks: number[] = []
      const first = Math.ceil(t0 / step - 1e-9) * step
      for (let k = 0; k < 200 && first + k * step <= t1 + step * 1e-9; k++)
        ticks.push(snap(first + k * step, step))
      return { t0, t1, ticks }
    }
    let { t0, t1, ticks } = plan(step)
    // Automatic ticks made coarser until their labels fit (as every value axis).
    const drawn: ContinuousAxisSpec = { ...spec, breaks: [], scale: 'linear' }
    const fits = (v: number[]) => tickLabelsFit(ctx, theme, h ? 'x' : 'y', drawn, v, v.map(scale))
    for (let k = 0; !manual && k < 12 && step < hi - lo && ticks.length > 2 && !fits(ticks); k++) {
      step = coarserStep(step)
      ;({ t0, t1, ticks } = plan(step))
    }
    const ends = [scale(t0), scale(t1)].sort((a, b) => a - b) as [number, number]
    axis = planContinuousAxis(
      ctx,
      theme,
      palette,
      h ? 'x' : 'y',
      drawn,
      { min: dmin, max: dmax, ticks, minorTicks: [] },
      scale,
      h ? { right: true, key: 'y2', span: ends } : { right: true, span: [ends[1], ends[0]] },
    )
  }
  return { nodes, guides, axis }
}
