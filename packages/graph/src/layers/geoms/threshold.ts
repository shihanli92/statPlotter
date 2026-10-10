import type { ColorRef, Cutoffs, GraphNode, Layer, LayerOf } from '@ps/model'
import {
  negLog10P,
  type ThresholdClass,
  type ThresholdCounts,
  type ThresholdCuts,
  thresholdClass,
  thresholdCounts,
} from '@ps/stats'
import { tableRow } from '../../data.ts'
import { CloudBuilder, drawsCloud } from '../../layout/cloud.ts'
import { LEGEND_SAMPLE, type LegendEntry } from '../../layout/legend.ts'
import { symbolPaint } from '../../layout/points.ts'
import type { SceneNode, StylePath } from '../../scene.ts'
import { resolveColor } from '../../theme.ts'
import type { XYCurve, XYCurveCtx } from '../curves.ts'
import type { XYSlot } from '../frames/xy.ts'
import { LEGEND_GLYPHS } from '../glyphs.ts'
import type { LayerKit } from '../kit.ts'
import { pointsOption } from '../theme.ts'
import { xyCenter } from './xyMarks.ts'

// Roadmap 46b: the Significance layer — points (geom `points`, stat `threshold`) classed by the
// graph's shared cut-offs (`GraphNode.cutoffs`, a volcano plot's thresholds) into up, down and not
// significant (`@ps/stats` `thresholdClass`: a point at a cut-off is significant), drawn in their
// class' colour (not significant first, so the coloured points sit on top) over whatever the
// layer reads (the table's data sets, or another layer's analysis outputs), and counted in the
// legend ("Up (12)"). The lines of the volcano thresholds read the same cut-offs (`ResultRef`
// `cutoff`), so they move together.

/** (P values and −log10 P, for the panels.) */
export { negLog10P, pOfNegLog10 } from '@ps/stats'

/** A Significance layer. */
export type ThresholdLayer = LayerOf<'points'> & { stat: { kind: 'threshold' } }

export const isThresholdLayer = (l: Layer): l is ThresholdLayer =>
  l.geom === 'points' && l.stat.kind === 'threshold'

/** The cut-offs a graph without its own uses: |fold change| ≥ 1 and P ≤ 0.05. */
export const DEFAULT_CUTOFFS: Cutoffs = { fold: 1, sig: { p: 0.05 } }

/** Theme defaults: up red, down blue, not significant grey. */
export const THRESHOLD_THEME: Readonly<Record<ThresholdClass, string>> = {
  up: '#d62728',
  down: '#1f77b4',
  ns: '#a6a6a6',
}

/** The classes as the legend and the panel name them, in the legend's order. */
export const CLASS_NAMES: Readonly<Record<ThresholdClass, string>> = {
  up: 'Up',
  down: 'Down',
  ns: 'NS',
}
export const LEGEND_CLASSES: readonly ThresholdClass[] = ['up', 'down', 'ns']
/** Drawing order: back to front (the significant points over the rest). */
const DRAW_CLASSES: readonly ThresholdClass[] = ['ns', 'down', 'up']

/** A graph's cut-offs as numbers: the fold change's, the significance's axis value, the axes. */
export interface CutoffValues {
  fold: number
  /** The significance's cut-off as a value of its axis (where its line stands). */
  sig: number
  foldAxis: 'x' | 'y'
  /** The significance axis holds P values (significant when at most the cut-off). */
  pValues: boolean
}

/** A graph's cut-offs (its own, else the defaults), the significance as an axis value. */
export function cutoffValues(graph: Pick<GraphNode, 'cutoffs'>): CutoffValues {
  const c = graph.cutoffs ?? DEFAULT_CUTOFFS
  const pValues = c.values === 'p'
  return {
    fold: Math.abs(c.fold),
    sig: 'p' in c.sig ? (pValues ? c.sig.p : negLog10P(c.sig.p)) : c.sig.value,
    foldAxis: c.foldAxis ?? 'x',
    pValues,
  }
}

/** A cut-off as a line's value (`ResultRef` `cutoff`). */
export const cutoffValue = (graph: Pick<GraphNode, 'cutoffs'>, which: 'fold' | 'sig'): number =>
  cutoffValues(graph)[which]

/**
 * The cut-offs as the classes compare them: P values on the axis are compared as −log10 P
 * (P ≤ the cut-off ⇔ −log10 P ≥ −log10 of it).
 */
const classCuts = (c: CutoffValues): ThresholdCuts => ({
  fold: c.fold,
  sig: c.pValues ? negLog10P(c.sig) : c.sig,
})

/** The fold change at axis values (X, Y). */
const foldAt = (c: CutoffValues, vx: number, vy: number) => (c.foldAxis === 'x' ? vx : vy)

/** The significance at axis values (X, Y), −log10 P when the axis holds P values. */
function sigAt(c: CutoffValues, vx: number, vy: number): number {
  const sig = c.foldAxis === 'x' ? vy : vx
  return c.pValues ? negLog10P(sig) : sig
}

/** A point's class at axis values (X, Y), by the graph's cut-offs and which axis is which. */
export const classAt = (c: CutoffValues, vx: number, vy: number): ThresholdClass | null =>
  thresholdClass(foldAt(c, vx, vy), sigAt(c, vx, vy), classCuts(c))

/** Plot-local pixels of axis values (null where they have no place: a log axis' ≤ 0). */
export type PlotMap = (vx: number, vy: number) => [number, number] | null

/**
 * Audit 3 (G8, S5): where a point beyond the end of its significance axis is drawn — P = 0 on an
 * axis of P values (no place on a log axis, or below its range), −log10 P = +∞ — at the plot's
 * edge on the significant side, its fold change where it belongs; null for any other point, or
 * when the fold change has no place in the plot.
 */
export function edgePlacer(
  c: CutoffValues,
  map: PlotMap,
  inside: (px: number, py: number) => boolean,
  W: number,
  H: number,
): (vx: number, vy: number) => [number, number] | null {
  const foldX = c.foldAxis === 'x'
  // Two significances any such axis can place, the second more significant.
  const [a, b] = c.pValues ? [0.5, 0.25] : [1, 2]
  return (vx, vy) => {
    const [fold, sig] = foldX ? [vx, vy] : [vy, vx]
    if (c.pValues ? sig !== 0 : sig !== Number.POSITIVE_INFINITY) return null
    const pa = foldX ? map(fold, a) : map(a, fold)
    const pb = foldX ? map(fold, b) : map(b, fold)
    if (!pa || !pb) return null
    const i = foldX ? 1 : 0
    const out: [number, number] = [pa[0], pa[1]]
    out[i] = pb[i]! > pa[i]! ? (foldX ? H : W) : 0
    return inside(out[0], out[1]) ? out : null
  }
}

/** A class' colour in a layer: its own (`style.classes`), else the theme's. */
export function classColor(kit: LayerKit, layer: Layer, k: ThresholdClass): string {
  const own = (layer.style as { classes?: Partial<Record<ThresholdClass, ColorRef>> } | undefined)
    ?.classes?.[k]
  return own ? resolveColor(own, kit.palette, THRESHOLD_THEME[k]) : THRESHOLD_THEME[k]
}

/** The counts of a layer's classes over the data sets it drew (this layout's). */
export const countsOf = (kit: LayerKit, layer: Layer): ThresholdCounts =>
  kit.memo(`threshold/${layer.id}`, () => ({ up: 0, down: 0, ns: 0, missing: 0 }))

/** A point a Significance layer classes: its axis values, its node's id and its row. */
export interface ClassedPoint {
  vx: number
  vy: number
  id: string
  /** Its table row (point key), −1 when it has none. */
  row: number
  sub?: number
  k?: number
}

/**
 * Draws a data set's (output's) points classed: each counted (missing values left out), then
 * drawn in its class' colour where `at` places it (null: not in the plot; then `edge`, for a
 * point beyond the significance axis' end) — not significant first. Many points (the points'
 * Render option, as every points layer) are one cloud.
 */
export function drawClassed(
  kit: LayerKit,
  layer: Layer,
  key: string,
  points: readonly ClassedPoint[],
  at: (vx: number, vy: number) => [number, number] | null,
  cloudId: string,
  edge?: (vx: number, vy: number) => [number, number] | null,
): void {
  const values = cutoffValues(kit.graph)
  const cuts = classCuts(values)
  const n = points.length
  const folds = new Float64Array(n)
  const sigs = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const p = points[i]!
    folds[i] = foldAt(values, p.vx, p.vy)
    sigs[i] = sigAt(values, p.vx, p.vy)
  }
  // The legend's counts are @ps/stats' (CLAUDE.md: numbers a stat draws come from @ps/stats).
  const tally = thresholdCounts(folds, sigs, cuts)
  const counts = countsOf(kit, layer)
  counts.up += tally.up
  counts.down += tally.down
  counts.ns += tally.ns
  counts.missing += tally.missing
  const byClass: Record<ThresholdClass, ClassedPoint[]> = { up: [], down: [], ns: [] }
  for (let i = 0; i < n; i++) {
    const k = thresholdClass(folds[i]!, sigs[i]!, cuts)
    if (k) byClass[k].push(points[i]!)
  }
  const style = kit.style(layer, key).points
  const size = style.size
  const target: StylePath = ['layers', layer.id]
  const cloud = drawsCloud(pointsOption(layer, key, 'render'), points.length)
    ? new CloudBuilder(cloudId)
    : null
  const nodes: SceneNode[] = []
  for (const k of DRAW_CLASSES) {
    const { stroke, fill } = symbolPaint(style, kit.palette, classColor(kit, layer, k))
    const paint = cloud?.paintOf(style.shape, stroke, fill) ?? 0
    for (const p of byClass[k]) {
      const xy = at(p.vx, p.vy) ?? edge?.(p.vx, p.vy)
      if (!xy) continue
      const [cx, cy] = xy
      if (cloud) cloud.add(cx, cy, size, paint, p.row, p.sub ?? -1, p.k ?? -1)
      else
        nodes.push({
          id: p.id,
          target,
          prim: { type: 'symbol', shape: style.shape, cx, cy, size, stroke, fill },
          bbox: { x: cx - size / 2, y: cy - size / 2, w: size, h: size },
        })
    }
  }
  if (cloud?.count) nodes.push({ id: cloudId, target, prim: cloud.build() })
  kit.addList(layer, key, nodes)
}

/**
 * The legend's entries of a graph's Significance layers: each class with its count ("Up (12)"),
 * a symbol in its colour (unless the layer's legend is hidden).
 */
export function thresholdLegend(kit: LayerKit, sampleWidth = LEGEND_SAMPLE): LegendEntry[] {
  const out: LegendEntry[] = []
  // By name (then id), so moving a layer in the list leaves the legend as it is.
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
  const layers = kit
    .drawn('points', isThresholdLayer)
    .sort((a, b) => cmp(a.name ?? '', b.name ?? '') || cmp(a.id, b.id))
  for (const l of layers) {
    if (l.legend === 'hide') continue
    const counts = countsOf(kit, l)
    const style = kit.style(l, '').points
    const target: StylePath = ['layers', l.id]
    for (const k of LEGEND_CLASSES) {
      const id = `legend/threshold/${l.id}/${k}`
      const color = classColor(kit, l, k)
      out.push({
        key: `@${l.id}/${k}`,
        id,
        target,
        label: `${CLASS_NAMES[k]} (${counts[k].toLocaleString('en-US')})`,
        sample: (x, cy) => {
          const { stroke, fill } = symbolPaint(style, kit.palette, color)
          const cx = x + sampleWidth / 2
          return [
            {
              id: `${id}/symbol`,
              target,
              prim: { type: 'symbol', shape: style.shape, cx, cy, size: style.size, stroke, fill },
            },
          ]
        },
      })
    }
  }
  return out
}

/**
 * Whether only Significance layers draw a data set (output): its own legend entry then stands for
 * nothing drawn in its colour — the classes' entries stand for its points.
 */
export function onlyClassed(kit: LayerKit, drawing: readonly Layer[], key: string): boolean {
  // The layers with a legend glyph of their own (labels, reference lines… stand for nothing).
  const shown = drawing.filter((l) => kit.shows(l, key) && LEGEND_GLYPHS[l.geom])
  return shown.length > 0 && shown.every(isThresholdLayer)
}

/** A data set's points classed (xy frame): every replicate at its X (entered means: the centre). */
export function xyThreshold(c: XYSlot, layer: ThresholdLayer): void {
  const { kit, key, p, x } = c
  const { scale: y, ok } = c.axis
  const part = kit.part(layer, key, 'point')
  const style = kit.style(layer, key)
  const points: ClassedPoint[] = []
  for (const r of p.rows) {
    const row = tableRow(p.s, r.row)
    if (r.stats.raw)
      r.stats.points.forEach((pt, k) => {
        points.push({
          vx: r.x,
          vy: pt.value,
          id: `series/${key}/${part}/${row}/${k}`,
          row,
          sub: pt.sub ?? 0,
          k,
        })
      })
    else
      points.push({
        vx: r.x,
        vy: xyCenter(r.stats, style),
        id: `series/${key}/${part}/${row}`,
        row,
      })
  }
  const map: PlotMap = (vx, vy) => (ok(vx, vy) ? [x(vx), y(vy)] : null)
  drawClassed(
    kit,
    layer,
    key,
    points,
    (vx, vy) => {
      const at = map(vx, vy)
      return at && c.inside(at[0], at[1]) ? at : null
    },
    `series/${key}/${part}`,
    edgePlacer(cutoffValues(kit.graph), map, c.inside, c.W, c.H),
  )
}

/** An analysis output's points classed (xy frame: a volcano plot's genes). */
export function xyCurveThreshold(o: XYCurveCtx, c: XYCurve, layer: ThresholdLayer): void {
  const { kit, x } = o
  const { data } = c
  const { scale: y, ok } = c.right ? o.right : o.left
  const part = kit.part(layer, c.id, 'point')
  const points: ClassedPoint[] = data.x.map((vx, i) => ({
    vx,
    vy: data.y[i]!,
    id: `curve/${c.index}/${part}/${i}`,
    row: data.rows?.[i] ?? i,
  }))
  const map: PlotMap = (vx, vy) => (ok(vx, vy) ? [x(vx), y(vy)] : null)
  drawClassed(
    kit,
    layer,
    c.id,
    points,
    (vx, vy) => {
      const at = map(vx, vy)
      return at && o.inside(at[0], at[1]) ? at : null
    },
    `curve/${c.index}/${part}`,
    edgePlacer(cutoffValues(kit.graph), map, o.inside, o.W, o.H),
  )
}
