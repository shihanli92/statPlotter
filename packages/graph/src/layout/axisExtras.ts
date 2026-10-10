import {
  axisUnit,
  type CornerArrows,
  labelRuns,
  type RichText,
  richPlain,
  type ScaleBar,
  type StrokeStyle,
} from '@ps/model'
import type { Box, SceneNode, Stroke } from '../scene.ts'
import { graphText, resolveStroke, type Theme } from '../theme.ts'
import { arrowHead } from './arrows.ts'
import { type AxisPlan, axisKey, type GraphContext, unionBoxes } from './common.ts'
import { placeText } from './text.ts'

// Roadmap 36: axis extras drawn over the plot by `composeGraph` for every frame with continuous
// axes — scale bars (a set length in data units, in a corner or from a data position, often in
// place of a hidden axis) and corner arrows (an axis style: short arrows from a corner with the
// axis titles beside them, as UMAP plots draw their axes).

/** Scale bars stand this far inside the plot's edges (pt). */
export const SCALE_BAR_INSET = 6
/** Room between a scale bar and its label (pt). */
const SCALE_BAR_GAP = 2
/** A scale bar's line (over the axis line's colour). */
const SCALE_BAR_LINE = { width: 2, dash: 'solid' } as const

/** The default label of a scale bar: its length, then the axis title's unit if it has one. */
export function scaleBarLabel(bar: ScaleBar, title: RichText | null | undefined): RichText {
  if (bar.label !== undefined) return labelRuns(bar.label)
  const n = Number(bar.length.toPrecision(6))
  const unit = axisUnit(richPlain(title ?? []))
  return [{ text: unit ? `${n} ${unit}` : String(n) }]
}

/**
 * A scale bar's ends along its axis (plot-local positions, ascending): `length` data units from
 * the axis' value at the bar's start — near the axis' start for a corner on that side (left,
 * bottom), back from its end for the other, or from a data position — so on a log axis it spans
 * the data units there. Null when it can't be drawn (off the axis, no length on screen).
 */
export function scaleBarSpan(
  plan: Pick<AxisPlan, 'toPx' | 'fromPx' | 'length' | 'which'>,
  bar: ScaleBar,
  at?: number,
): [number, number] | null {
  const place = bar.place ?? 'bottomRight'
  const L = plan.length
  let a: number
  let b: number
  if (typeof place === 'object') {
    const v0 = plan.which === 'x' ? place.x : place.y
    a = plan.toPx(v0)
    b = plan.toPx(v0 + bar.length)
  } else {
    // Which end of the axis the corner is at: left / bottom is the start of X / the end of Y's
    // plot-local range (Y grows downwards).
    const startSide = plan.which === 'x' ? place.endsWith('Left') : place.startsWith('bottom')
    const edge = at ?? (startSide === (plan.which === 'x') ? SCALE_BAR_INSET : L - SCALE_BAR_INSET)
    const v = plan.fromPx(edge)
    // Grow away from the corner, into the plot.
    const toward = plan.toPx(v + bar.length)
    const back = plan.toPx(v - bar.length)
    const inward = (p: number) => (edge < L / 2 ? p > edge : p < edge)
    const other = Number.isFinite(toward) && inward(toward) ? toward : back
    a = edge
    b = other
  }
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(b - a) < 1e-6) return null
  return [Math.min(a, b), Math.max(a, b)]
}

/**
 * Scale bars of the X and Y axes (plot-local): each a thick line `length` data units long with its
 * label on the side of the nearer plot edge (an X bar's under it at the bottom, over it at the
 * top; a Y bar's left of it on the left, reading upwards), so two in the same corner meet in an L
 * with their labels outside it. Returns the nodes and their bounds (the graph grows for them).
 */
export function drawScaleBars(
  ctx: GraphContext,
  theme: Theme,
  palette: readonly string[],
  plans: readonly AxisPlan[],
  W: number,
  H: number,
): { nodes: SceneNode[]; bounds: Box | null } {
  const nodes: SceneNode[] = []
  const bars = plans.flatMap((plan) => {
    const spec = plan.spec
    if (spec.type !== 'continuous' || !spec.scaleBar || spec.scaleBar.show === false) return []
    return [{ plan, bar: spec.scaleBar }]
  })
  if (!bars.length) return { nodes, bounds: null }
  const I = SCALE_BAR_INSET
  for (const { plan, bar } of bars) {
    const key = axisKey(plan)
    const target = ['axes', key, 'scaleBar']
    const place = bar.place ?? 'bottomRight'
    const corner = typeof place === 'string' ? place : null
    // In a corner the bar starts at the corner's inset point; X and Y bars there share it.
    const cx = corner ? (corner.endsWith('Left') ? I : W - I) : Number.NaN
    const cy = corner ? (corner.startsWith('top') ? I : H - I) : Number.NaN
    const span = scaleBarSpan(plan, bar, corner ? (plan.which === 'x' ? cx : cy) : undefined)
    if (!span) continue
    const style: StrokeStyle = {
      ...theme.axisLine,
      ...plan.spec.line,
      ...SCALE_BAR_LINE,
      ...bar.line,
    }
    const stroke: Stroke = resolveStroke(style, palette)
    const across =
      plan.which === 'x'
        ? corner
          ? cy
          : typeof place === 'object'
            ? otherPx(plans, 'y', place.y)
            : H - I
        : corner
          ? cx
          : typeof place === 'object'
            ? otherPx(plans, 'x', place.x)
            : W - I
    if (!Number.isFinite(across)) continue
    const [p0, p1] = span
    const line =
      plan.which === 'x'
        ? { x1: p0, y1: across, x2: p1, y2: across }
        : { x1: across, y1: p0, x2: across, y2: p1 }
    nodes.push({
      id: `axis/${key}/scaleBar/line`,
      target,
      prim: { type: 'line', ...line, stroke: { ...stroke } },
      bbox: {
        x: Math.min(line.x1, line.x2) - stroke.width / 2,
        y: Math.min(line.y1, line.y2) - stroke.width / 2,
        w: Math.abs(line.x2 - line.x1) + stroke.width,
        h: Math.abs(line.y2 - line.y1) + stroke.width,
      },
    })
    const content = scaleBarLabel(bar, plan.spec.title?.content)
    if (!richPlain(content)) continue
    const text = graphText(theme.tickLabel, ctx.graph, { ...plan.spec.tickLabels, ...bar.text })
    const off = stroke.width / 2 + SCALE_BAR_GAP
    const top = corner ? corner.startsWith('top') : false
    const left = corner ? corner.endsWith('Left') : true
    const placed =
      plan.which === 'x'
        ? placeText(
            ctx.fonts,
            `axis/${key}/scaleBar/label`,
            content,
            text,
            palette,
            (p0 + p1) / 2,
            top ? across - off : across + off,
            'middle',
            top ? 'bottom' : 'top',
            { target },
          )
        : placeText(
            ctx.fonts,
            `axis/${key}/scaleBar/label`,
            content,
            text,
            palette,
            left ? across - off : across + off,
            (p0 + p1) / 2,
            'middle',
            left ? 'bottom' : 'top',
            { target, angle: -90 },
          )
    nodes.push({ ...placed.node, bbox: placed.bbox })
  }
  return { nodes, bounds: unionBoxes(nodes.map((n) => n.bbox)) }
}

/** The plot-local position of a value on the other axis (a data position's across). */
function otherPx(plans: readonly AxisPlan[], which: 'x' | 'y', v: number): number {
  const plan = plans.find((p) => p.which === which && !p.right)
  return plan ? plan.toPx(v) : Number.NaN
}

/** Corner arrows' defaults: 0.2 of the plot's side, a 1 pt line, the titles 3 pt away. */
export const CORNER_ARROWS = { fraction: 0.2, gap: 3, width: 1 } as const

/** How far corner arrows' titles reach outside the plot, below (X) and beside (Y) it. */
export function cornerArrowDepth(plan: AxisPlan): number {
  return plan.title ? CORNER_ARROWS.gap + plan.title.thickness : 0
}

/**
 * Corner arrows (`GraphStyle.frame` 'arrows'): from the plot's corner (absent: bottom left) an
 * arrow along X and one along Y, `length` a fraction of the plot's side (absent 0.2) or points,
 * each axis' title beside its arrow outside the plot (X: under or over it, Y: reading upwards
 * beside it), centred on the arrow. Graph coordinates through `X` and `Y`.
 */
export function drawCornerArrows(
  ctx: GraphContext,
  theme: Theme,
  palette: readonly string[],
  opts: CornerArrows | undefined,
  x: AxisPlan,
  y: AxisPlan,
  X: (p: number) => number,
  Y: (p: number) => number,
): SceneNode[] {
  const W = x.length
  const H = y.length
  const corner = opts?.corner ?? 'bottomLeft'
  const left = corner.endsWith('Left')
  const bottom = corner.startsWith('bottom')
  const len = (side: number) =>
    opts?.unit === 'pt'
      ? Math.min(opts.length ?? side * CORNER_ARROWS.fraction, side)
      : Math.min(1, opts?.length ?? CORNER_ARROWS.fraction) * side
  const [lx, ly] = [len(W), len(H)]
  const ox = left ? 0 : W
  const oy = bottom ? H : 0
  const style = { ...theme.axisLine, width: CORNER_ARROWS.width, ...opts?.line }
  const stroke = resolveStroke(style, palette)
  const target = ['style', 'arrows']
  const nodes: SceneNode[] = []
  const arrow = (id: string, x2: number, y2: number) => {
    const [ax, ay] = [X(ox), Y(oy)]
    const [bx, by] = [X(x2), Y(y2)]
    const d = Math.hypot(bx - ax, by - ay)
    if (!(d > 0)) return
    const head = arrowHead({ shape: 'triangle' }, bx, by, (bx - ax) / d, (by - ay) / d, stroke)
    const cut = Math.min(head.cut, d / 2)
    const [ex, ey] = [bx - ((bx - ax) / d) * cut, by - ((by - ay) / d) * cut]
    nodes.push({
      id,
      target,
      children: [
        {
          id: `${id}/line`,
          target,
          prim: { type: 'line', x1: ax, y1: ay, x2: ex, y2: ey, stroke },
        },
        ...head.prims.map((prim, i) => ({ id: `${id}/head/${i}`, target, prim })),
      ],
    })
  }
  arrow('arrows/x', left ? lx : W - lx, oy)
  arrow('arrows/y', ox, bottom ? H - ly : ly)
  const gap = CORNER_ARROWS.gap + stroke.width / 2
  if (x.title) {
    const cx = left ? lx / 2 : W - lx / 2
    nodes.push(
      placeText(
        ctx.fonts,
        'axis/x/title',
        x.title.content,
        x.title.style,
        palette,
        X(cx),
        bottom ? Y(H) + gap : Y(0) - gap,
        'middle',
        bottom ? 'top' : 'bottom',
        { target: ['axes', axisKey(x), 'title'] },
      ).node,
    )
  }
  if (y.title) {
    const cy = bottom ? H - ly / 2 : ly / 2
    nodes.push(
      placeText(
        ctx.fonts,
        'axis/y/title',
        y.title.content,
        y.title.style,
        palette,
        left ? X(0) - gap : X(W) + gap,
        Y(cy),
        'middle',
        left ? 'bottom' : 'top',
        { target: ['axes', axisKey(y), 'title'], angle: -90 },
      ).node,
    )
  }
  return nodes
}

/** An embedding's axis name: UMAP_1, UMAP 2, tSNE_1, t-SNE2, PHATE_1, PaCMAP 2… */
const EMBEDDING =
  /^(umap|t-?sne|phate|pacmap|trimap|diffmap|dc|fa|draw_graph_fr|x_umap)[\s_.-]?([12])$/i

/**
 * Whether two variables are an embedding's two axes (UMAP_1 and UMAP_2, tSNE_1 and tSNE_2…):
 * the same method, 1 on X and 2 on Y. New graphs of them draw corner arrows (roadmap 36).
 */
export function isEmbeddingPair(xTitle: string, yTitle: string): boolean {
  const x = EMBEDDING.exec(xTitle.trim())
  const y = EMBEDDING.exec(yTitle.trim())
  return (
    !!x &&
    !!y &&
    x[1]!.replace('-', '').toLowerCase() === y[1]!.replace('-', '').toLowerCase() &&
    x[2] === '1' &&
    y[2] === '2'
  )
}
