import {
  type Box,
  nodeBounds,
  type Scene,
  type SceneAxis,
  type SceneNode,
  type Stroke,
} from '../scene.ts'
import { resolveFill, type Theme } from '../theme.ts'
import { layoutNotes } from './annotations.ts'
import { cornerArrowDepth, drawCornerArrows, drawScaleBars } from './axisExtras.ts'
import {
  type AxisPlan,
  axisDepth,
  axisKey,
  drawAxis,
  drawGrid,
  type GraphContext,
  PAD,
  runsAround,
  titleBlock,
  translate,
  unionBoxes,
} from './common.ts'
import {
  LEGEND_GAP,
  LEGEND_INSIDE_PAD,
  LEGEND_TOP_GAP,
  type LegendEntry,
  legendBlock,
  legendItems,
} from './legend.ts'

/** What a graph-type layout hands over to be framed into a scene. */
export interface GraphParts {
  ctx: GraphContext
  theme: Theme
  palette: readonly string[]
  x: AxisPlan
  y: AxisPlan
  /** The right Y axis (drawn at the plot's right edge), when the graph has one. */
  y2?: AxisPlan
  /** An axis along the plot's top (a horizontal estimation plot's difference axis). */
  top?: AxisPlan
  /** Data layers in drawing order, plot-local (origin at the plot's top-left). */
  layers: SceneNode[]
  /** Significance brackets (plot-local) and the top of the highest one (≤ 0 above the plot). */
  brackets?: { nodes: SceneNode[]; top: number }
  legend?: { entries: LegendEntry[]; sampleWidth: number }
  /** Bounds (plot-local) of marks reaching past the plot, e.g. labels beside a pie. */
  reach?: Box | null
  /**
   * Room taken right of the plot by marks (a horizontal graph's brackets and bar labels), before
   * a right Y axis' depth and the legend.
   */
  aside?: number
  /**
   * Roadmap 35: a block under the X axis (a survival graph's number-at-risk table): its nodes
   * with the plot's left edge at x = 0 and the block's top at y = 0, and their bounds.
   */
  below?: { nodes: SceneNode[]; box: Box; gap: number }
  warnings: string[]
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** Plot-local position of an anchored axis line: the other axis' value, clamped to the plot. */
function anchorAt(own: AxisPlan, other: AxisPlan, fallback: number): number {
  if (own.anchor === undefined) return fallback
  const p = other.toPx(own.anchor)
  return Number.isFinite(p) ? clamp(p, 0, other.length) : fallback
}

/**
 * A scene's map of an axis planned plot-local, the plot at `origin` (audit 3, P1: made out of
 * `composeGraph`'s scope, so a scene keeps the plan's maps only, not the layout's parts).
 */
function sceneAxis(plan: AxisPlan, origin: number): SceneAxis {
  const { toPx, fromPx } = plan
  return {
    categorical: plan.categorical,
    toPx: (v) => origin + toPx(v),
    fromPx: (px) => fromPx(px - origin),
  }
}

/**
 * Frames a laid-out plot into a scene: margins sized to fit the axes, titles, legend, brackets
 * and annotations; backgrounds, grid lines, axes, the plot frame, annotations and the legend.
 */
export function composeGraph(parts: GraphParts): Scene {
  const { ctx, theme, palette, y2, top: x2 } = parts
  const { graph } = ctx
  const style = graph.style
  // Corner arrows (roadmap 36): the X and Y axes drawn as arrows from a corner, their titles
  // beside them; the axes' lines, ticks and labels left out.
  const arrows = style.frame === 'arrows'
  const bare = (p: AxisPlan): AxisPlan => ({
    ...p,
    show: false,
    ticks: [],
    minor: [],
    overhang: [0, 0],
    title: null,
    labels: { ...p.labels, show: false, depth: 0 },
  })
  const x = arrows ? bare(parts.x) : parts.x
  const y = arrows ? bare(parts.y) : parts.y
  const W = x.length
  const H = y.length

  const xAt = anchorAt(x, y, H) // plot-local y of the X axis line
  const yAt = anchorAt(y, x, 0) // plot-local x of the Y axis line
  const title = titleBlock(ctx, theme, palette)
  const legend = parts.legend
    ? legendBlock(ctx, theme, palette, parts.legend.entries, parts.legend.sampleWidth)
    : null
  const notes = layoutNotes(ctx, theme, palette, x, y)
  const bracketTop = parts.brackets?.top ?? 0

  // Inside legend, plot-local.
  const insideAt =
    legend?.position === 'inside'
      ? graph.legend.inside
        ? { x: graph.legend.inside.x * W, y: graph.legend.inside.y * H }
        : { x: W - legend.width - LEGEND_INSIDE_PAD, y: LEGEND_INSIDE_PAD }
      : null
  const topLegend = legend?.position === 'top' ? legend.height + LEGEND_TOP_GAP : 0
  const above = PAD + title.height + topLegend

  // --- Margins ---------------------------------------------------------------------------------
  let left = PAD + Math.max(axisDepth(y, yAt), x.overhang[0])
  // The right Y axis sits at the plot's right edge; a legend on the right goes beyond it (and
  // beyond marks standing right of the plot).
  // Tables beside the plot (roadmap 35) take room there too.
  const y2Depth = Math.max(y2 ? axisDepth(y2) : 0, parts.aside ?? 0, notes.aside)
  let top =
    above + Math.max(y.overhang[0], y2?.overhang[0] ?? 0, -bracketTop, x2 ? axisDepth(x2) : 0)
  let right =
    PAD +
    Math.max(
      x.overhang[1],
      y2Depth + (legend?.position === 'right' ? LEGEND_GAP + legend.width : 0),
      4,
    )
  let bottom = PAD + Math.max(axisDepth(x, H - xAt), y.overhang[1], y2?.overhang[1] ?? 0)
  // A block under the X axis (roadmap 35): below the axis' labels and title.
  const below = parts.below
  const belowAt = below ? Math.max(axisDepth(x, H - xAt), 0) + below.gap : 0
  if (below) {
    bottom = Math.max(bottom, PAD + belowAt + below.box.y + below.box.h)
    left = Math.max(left, PAD - below.box.x)
  }

  // Corner arrows' titles sit outside the plot by their corner.
  if (arrows) {
    const corner = style.arrows?.corner ?? 'bottomLeft'
    const dx = PAD + cornerArrowDepth(parts.x)
    const dy = PAD + cornerArrowDepth(parts.y)
    if (corner.startsWith('bottom')) bottom = Math.max(bottom, dx)
    else top = Math.max(top, above + dx - PAD)
    if (corner.endsWith('Left')) left = Math.max(left, dy)
    else right = Math.max(right, dy)
  }
  // Scale bars (roadmap 36): over the plot, a corner's labels inside it.
  const scaleBars = drawScaleBars(ctx, theme, palette, [parts.x, parts.y], W, H)

  // Centred elements wider (or taller) than the plot grow the margins on both sides.
  const across = (extent: number, span: number) => PAD + (extent - span) / 2
  for (const w of [
    title.width,
    x.title?.length ?? 0,
    legend?.position === 'top' ? legend.width : 0,
  ]) {
    if (w > W) {
      left = Math.max(left, across(w, W))
      right = Math.max(right, across(w, W))
    }
  }
  const yTitle = Math.max(y.title?.length ?? 0, y2?.title?.length ?? 0)
  if (yTitle > H) {
    top = Math.max(top, above + (yTitle - H) / 2)
    bottom = Math.max(bottom, across(yTitle, H))
  }
  if (legend?.position === 'right') bottom = Math.max(bottom, legend.height - H + PAD)
  // Annotations and an inside legend may reach past the plot: keep them in the scene.
  const reach = [
    notes.bounds,
    scaleBars.bounds,
    parts.reach ?? null,
    insideAt && legend ? { ...insideAt, w: legend.width, h: legend.height } : null,
  ]
  for (const b of reach) {
    if (!b) continue
    left = Math.max(left, PAD - b.x)
    top = Math.max(top, above - b.y)
    right = Math.max(right, b.x + b.w - W + PAD)
    bottom = Math.max(bottom, b.y + b.h - H + PAD)
  }

  let width = left + W + right
  let height = top + H + bottom
  const X = (px: number) => left + px
  const Y = (py: number) => top + py
  const shift = (n: SceneNode) => translate(n, left, top)

  // --- Nodes -----------------------------------------------------------------------------------
  const children: SceneNode[] = []
  /** Elements dragged from their computed places (roadmap 22): the graph grows to hold them. */
  const moved: SceneNode[] = []
  const plotBg = style.plotBackground && resolveFill(style.plotBackground, palette)
  if (plotBg) {
    const box = { x: X(0), y: Y(0), w: W, h: H }
    children.push({
      id: 'plotBackground',
      target: ['style', 'plotBackground'],
      prim: { type: 'rect', ...box, stroke: null, fill: plotBg },
      bbox: box,
    })
  }
  const grid = [
    ...drawGrid(y, X, Y, W, H),
    ...(y2 ? drawGrid(y2, X, Y, W, H) : []),
    ...drawGrid(x, X, Y, W, H),
    ...(x2 ? drawGrid(x2, X, Y, W, H) : []),
  ]
  if (grid.length) children.push({ id: 'grid', children: grid })
  const titleMove = graph.titleOffset ?? { dx: 0, dy: 0 }
  const titleNode = title.draw(X(W / 2) + titleMove.dx, PAD + titleMove.dy)
  if (titleNode) {
    children.push(titleNode)
    if (graph.titleOffset) moved.push(titleNode)
  }
  // Annotations sent behind the data are drawn before it (and so are under it for clicks too).
  const annotationNodes = [...(parts.brackets?.nodes ?? []), ...notes.nodes].map(shift)
  for (const n of annotationNodes) {
    const a = graph.annotations[Number(n.target?.[1])]
    if (a?.type === 'bracket' && a.offset) moved.push(n)
  }
  const isBehind = (n: SceneNode) => {
    const [head, idx] = n.target ?? []
    return head === 'annotations' && !!graph.annotations[Number(idx)]?.behind
  }
  const behind = annotationNodes.filter(isBehind)
  if (behind.length) children.push({ id: 'annotations/behind', children: behind })
  children.push(...parts.layers.map(shift))

  // The axes: plan, where the line sits across the plot, and the plot's extent across it.
  const axes: [AxisPlan, number, number][] = [
    [y, yAt, W],
    [x, xAt, H],
    ...(y2 ? [[y2, W, W] as [AxisPlan, number, number]] : []),
    ...(x2 ? [[x2, 0, H] as [AxisPlan, number, number]] : []),
  ]
  for (const [plan, at, cross] of axes) {
    const key = axisKey(plan)
    const a = drawAxis(ctx, palette, plan, X, Y, at, cross, { line: style.frame !== 'none' })
    const bbox = a.bbox ?? undefined
    children.push({ id: `axis/${key}`, target: ['axes', key], children: a.nodes, bbox })
    const title = plan.spec.titleOffset && a.nodes.find((n) => n.id === `axis/${key}/title`)
    if (title) moved.push(title)
  }
  if (style.frame === 'box') {
    const frame = boxFrame(x, y, xAt, yAt, X, Y, !!y2?.show)
    if (frame.length) children.push({ id: 'frame', target: ['style', 'frame'], children: frame })
  }
  if (arrows)
    children.push({
      id: 'arrows',
      target: ['style', 'arrows'],
      children: drawCornerArrows(ctx, theme, palette, style.arrows, parts.x, parts.y, X, Y),
    })
  if (scaleBars.nodes.length)
    children.push({ id: 'scaleBars', children: scaleBars.nodes.map(shift) })
  if (below) children.push(...below.nodes.map((n) => translate(n, left, top + H + belowAt)))
  children.push({
    id: 'annotations',
    children: annotationNodes.filter((n) => !isBehind(n)),
  })
  if (legend) {
    const at =
      legend.position === 'right'
        ? { x: X(W) + y2Depth + LEGEND_GAP, y: Y(0) }
        : legend.position === 'top'
          ? { x: X(W / 2) - legend.width / 2, y: PAD + title.height }
          : { x: X(insideAt!.x), y: Y(insideAt!.y) }
    children.push(legend.draw(at.x, at.y))
  } else {
    children.push({ id: 'legend', target: ['legend'], children: [] })
  }

  // Moved elements reaching past the margins grow the graph on that side (never shrink it:
  // space stays reserved at their computed places), so export keeps them whole.
  const reached = unionBoxes(moved.map(nodeBounds))
  const grow = reached
    ? {
        left: Math.max(0, PAD - reached.x),
        top: Math.max(0, PAD - reached.y),
        right: Math.max(0, reached.x + reached.w + PAD - width),
        bottom: Math.max(0, reached.y + reached.h + PAD - height),
      }
    : null
  let all = children
  if (grow && (grow.left || grow.top || grow.right || grow.bottom)) {
    all = children.map((n) => translate(n, grow.left, grow.top))
    left += grow.left
    top += grow.top
    width += grow.left + grow.right
    height += grow.top + grow.bottom
  }
  const bg = style.background && resolveFill(style.background, palette)
  if (bg) {
    const box = { x: 0, y: 0, w: width, h: height }
    all = [
      {
        id: 'background',
        target: ['style', 'background'],
        prim: { type: 'rect', ...box, stroke: null, fill: bg },
        bbox: box,
      },
      ...all,
    ]
  }

  return {
    width,
    height,
    plot: { x: left, y: top, w: W, h: H },
    root: { id: 'graph', target: [], children: all },
    warnings: [...new Set(parts.warnings)],
    axes: {
      x: sceneAxis(x, left),
      y: sceneAxis(y, top),
      ...(y2 ? { y2: sceneAxis(y2, top) } : {}),
    },
    // Roadmap 47b: the legend's every entry, for its editors.
    ...(parts.legend?.entries.length
      ? { legend: legendItems(graph.legend, parts.legend.entries) }
      : {}),
  }
}

/**
 * The sides of a 'box' frame not already drawn by an axis at the plot's edge (top and right,
 * plus bottom/left when that axis is hidden or anchored inside), broken where the axis is.
 */
function boxFrame(
  x: AxisPlan,
  y: AxisPlan,
  xAt: number,
  yAt: number,
  X: (p: number) => number,
  Y: (p: number) => number,
  /** A right Y axis draws the right side. */
  rightAxis = false,
): SceneNode[] {
  const W = x.length
  const H = y.length
  const out: SceneNode[] = []
  const side = (
    id: string,
    plan: AxisPlan,
    at: (p: number) => [number, number],
    stroke: Stroke,
  ) => {
    const runs = runsAround(plan.length, plan.gaps)
    runs.forEach(([r0, r1], k) => {
      const [x1, y1] = at(r0)
      const [x2, y2] = at(r1)
      out.push({
        id: runs.length > 1 ? `frame/${id}/${k}` : `frame/${id}`,
        target: ['style', 'frame'],
        prim: { type: 'line', x1, y1, x2, y2, stroke },
      })
    })
  }
  side('top', x, (p) => [X(p), Y(0)], x.line)
  if (!rightAxis) side('right', y, (p) => [X(W), Y(p)], y.line)
  if (!x.show || xAt !== H) side('bottom', x, (p) => [X(p), Y(H)], x.line)
  if (!y.show || yAt !== 0) side('left', y, (p) => [X(0), Y(p)], y.line)
  return out
}
