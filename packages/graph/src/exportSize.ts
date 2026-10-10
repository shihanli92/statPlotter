import type { GraphContext } from './layout/common.ts'
import { layoutGraph } from './layout/dispatch.ts'
import { scaleScene } from './layout/scaled.ts'
import type { Scene, SceneNode } from './scene.ts'

// Export size (roadmap 27): a width in a physical unit or as a percentage of the graph's own,
// the height following its proportions, reached in one of two ways: "keep text size" lays the
// graph out again at the new overall size (the plot grows or shrinks, fonts, symbols and line
// widths stay: what resizing the graph does), "scale everything" scales the whole scene (what
// `size.scale` does). Layout pages are only scaled (their graphs are placed on a fixed page).

export type LengthUnit = 'mm' | 'cm' | 'in' | 'pt'

/** Points per unit. */
export const POINTS_PER: Record<LengthUnit, number> = {
  pt: 1,
  in: 72,
  mm: 72 / 25.4,
  cm: 72 / 2.54,
}

/** A width: in a unit, or a percentage of the graph's or page's own width. */
export interface ExportWidth {
  unit: LengthUnit | '%'
  value: number
}

/** Common journal figure widths (single, 1.5 and double column). */
export const JOURNAL_WIDTHS = [
  { label: 'Single column', mm: 85 },
  { label: '1.5 column', mm: 114 },
  { label: 'Double column', mm: 174 },
] as const

/** Export widths from 0.1 in to 100 in, whatever the unit. */
export const EXPORT_WIDTH_PT = { min: 7.2, max: 7200 } as const

/** The width in points, for a graph or page `natural` points wide. */
export function widthInPoints(w: ExportWidth, natural: number): number {
  const pt = w.unit === '%' ? (natural * w.value) / 100 : w.value * POINTS_PER[w.unit]
  return Math.min(EXPORT_WIDTH_PT.max, Math.max(EXPORT_WIDTH_PT.min, pt))
}

/** Points in a unit (to its display precision: 0.1 mm, 0.01 cm / in, 0.1 pt, 0.1 %). */
export function fromPoints(pt: number, unit: LengthUnit): number {
  const v = pt / POINTS_PER[unit]
  const k = unit === 'cm' || unit === 'in' ? 100 : 10
  return Math.round(v * k) / k
}

export type SizeMode = 'keepText' | 'scale'

const PLOT_SIDE = { min: 7.2, max: 14_400 } as const

/**
 * The graph laid out at an overall width (points), its height in the proportions of the graph as
 * it is, with text, symbols and line widths unchanged: the plot area takes the difference, as when
 * the graph is resized (its scale kept). Margins depend a little on the plot's size (tick labels),
 * so the plot size is corrected a few times; if the margins alone are wider than asked for, what
 * is left is made up by scaling.
 */
export function layoutGraphAtWidth(ctx: GraphContext, width: number): Scene {
  const natural = layoutGraph(ctx)
  if (Math.abs(natural.width - width) < 0.005) return natural
  const height = (natural.height * width) / natural.width
  const miss = (s: Scene) => Math.max(Math.abs(s.width - width), Math.abs(s.height - height))
  const clamp = (v: number) => Math.min(PLOT_SIDE.max, Math.max(PLOT_SIDE.min, v))
  // Secant steps on each side: the overall size grows with the plot at a rate of 1 or less (a
  // title wider than the plot grows by half), which the last two layouts measure.
  const slope = (d: number, dp: number) =>
    Math.abs(dp) > 1e-6 ? Math.min(1.5, Math.max(0.25, d / dp)) : 1
  let plot = { w: ctx.graph.size.plotWidth, h: ctx.graph.size.plotHeight }
  let rate = { w: 1, h: 1 }
  let scene = natural
  let best = natural
  for (let i = 0; i < 12 && miss(scene) > 0.005; i++) {
    const next = {
      w: clamp(plot.w + (width - scene.width) / rate.w),
      h: clamp(plot.h + (height - scene.height) / rate.h),
    }
    const size = { ...ctx.graph.size, plotWidth: next.w, plotHeight: next.h }
    const s = layoutGraph({ ...ctx, graph: { ...ctx.graph, size } })
    rate = {
      w: slope(s.width - scene.width, next.w - plot.w),
      h: slope(s.height - scene.height, next.h - plot.h),
    }
    plot = next
    scene = s
    if (miss(scene) < miss(best)) best = scene
  }
  return Math.abs(best.width - width) > 0.5 ? scaleScene(best, width / best.width) : best
}

/** A scene at an overall width: laid out again (graphs, keeping text size) or scaled. */
export function sceneAtWidth(
  scene: Scene,
  width: number,
  relayout?: (width: number) => Scene,
): Scene {
  if (Math.abs(scene.width - width) < 0.005) return scene
  return relayout ? relayout(width) : scaleScene(scene, width / scene.width)
}

/** The smallest font size drawn (points, as printed: placed subtrees' scales applied); null if none. */
export function smallestText(scene: Scene): number | null {
  let min = Number.POSITIVE_INFINITY
  const walk = (n: SceneNode, k: number) => {
    const s = k * (n.transform?.scale ?? 1)
    if (n.prim?.type === 'text')
      for (const r of n.prim.layout.runs) if (r.text.trim()) min = Math.min(min, r.size * s)
    for (const c of n.children ?? []) walk(c, s)
  }
  walk(scene.root, 1)
  return Number.isFinite(min) ? min : null
}
