import type {
  GraphNode,
  LabelThreshold,
  PointLabels,
  PointStyle,
  RichText,
  TextStyle,
} from '@ps/model'
import { labelPlain, labelRuns } from '@ps/model'
import type { FontRegistry } from '../fonts/registry.ts'
import type { SceneNode, Stroke } from '../scene.ts'
import { layoutText } from '../text/layout.ts'
import { resolveColor, resolveText, type Theme } from '../theme.ts'
import { labelText } from './labels.ts'
import { leaderLine, placeLabels, type RepelObstacle } from './repel.ts'
import { placeText } from './text.ts'

// Point labels (roadmap 22): text beside plotted points — a data set's automatic labels
// (`SeriesStyle.pointLabels`: the row title, or the X or Y value, of all points, those past
// thresholds, or chosen rows) and a point's own label (`PointStyle.label`), drawn alike. Layouts
// hand every drawn point to a `PointLabelLayer` while drawing (`pointNodes` does it); the layer
// then picks the labels, places them apart (`placeLabels`) and draws them over the data.

/** Default most labels per data set. */
export const MAX_POINT_LABELS = 100
/** Leader lines: a thin line in the label's colour unless styled. */
const LEADER_WIDTH = 0.5

/** A drawn point, as the layout knows it (plot-local position). */
export interface LabelPoint {
  /** Data set key (or an extra series' id): its `pointOverrides` and scene target. */
  series: string
  /** The point's key (`r<row>` / `r<row>s<sub>`). */
  key: string
  cx: number
  cy: number
  /** Symbol size (outer diameter). */
  size: number
  /** The point's colour (a label or leader "in the data set's colour"). */
  color: string
  /** Table row the value comes from (for `which: 'rows'`); absent when unknown. */
  row?: number
  /** The row's title, if it has one. */
  title?: string | null
  /** The point's X value (XY graphs) and Y value. */
  x?: number | null
  y?: number
}

/** Whether a point passes a data set's thresholds ('and': all of them; 'or': any). */
export function passesThresholds(
  thresholds: readonly LabelThreshold[],
  combine: 'and' | 'or',
  x: number | null | undefined,
  y: number | undefined,
): boolean {
  if (!thresholds.length) return true
  const test = (t: LabelThreshold) => {
    const v = t.value === 'x' ? x : y
    if (v === null || v === undefined || !Number.isFinite(v)) return false
    return t.test === 'abs'
      ? Math.abs(v) >= t.limit
      : t.test === 'above'
        ? v >= t.limit
        : v <= t.limit
  }
  return combine === 'or' ? thresholds.some(test) : thresholds.every(test)
}

/** Whether a data set's automatic labels include a point (before the `max` cap). */
export function labelChosen(labels: PointLabels, p: LabelPoint): boolean {
  switch (labels.which) {
    case 'all':
      return true
    case 'threshold':
      return passesThresholds(labels.thresholds ?? [], labels.combine ?? 'and', p.x, p.y)
    case 'rows':
      return p.row !== undefined && (labels.rows ?? []).includes(p.row)
  }
}

/**
 * The automatic label text of a point: its row title (nothing when the row has none), or its X
 * or Y value in the labels' number format. Null when there is nothing to show.
 */
export function autoLabelText(
  labels: PointLabels,
  p: LabelPoint,
  /** The label variable's text of a table row (roadmap 34b), for `source: 'variable'`. */
  variable?: (row: number, format: PointLabels['format']) => RichText | null,
): RichText | null {
  if (labels.source === 'none') return null
  if (labels.source === 'variable')
    return variable && p.row !== undefined ? variable(p.row, labels.format) : null
  if (labels.source === 'rowTitle') {
    const t = p.title?.trim()
    return t ? [{ text: t }] : null
  }
  const v = labels.source === 'x' ? p.x : p.y
  if (v === null || v === undefined || !Number.isFinite(v)) return null
  const text = labelText({ stat: 'value', format: labels.format ?? { mode: 'auto' } }, v)
  return text.some((r) => r.text) ? text : null
}

const xy = ([cx, cy]: [number, number]) => ({ cx, cy })

interface Picked {
  p: LabelPoint
  content: RichText
  own: PointStyle | undefined
  labels: PointLabels | undefined
  /** Placement order: larger first. */
  rank: number
}

/**
 * Collects a graph's drawn points while the layout draws them, then lays out their labels. One
 * per graph; `styleOf` gives a data set's (or extra series') automatic labels.
 */
export class PointLabelLayer {
  private readonly obstacles: RepelObstacle[] = []
  private readonly points: LabelPoint[] = []

  constructor(
    private readonly ctx: {
      graph: GraphNode
      fonts: FontRegistry
      theme: Theme
      palette: readonly string[]
    },
    private readonly styleOf: (series: string) => PointLabels | undefined,
    /** Where a point drawn at (x, y) ends up (horizontal graphs: turned; see `flipNode`). */
    private readonly map?: (x: number, y: number) => [number, number],
    /** The label variable's text of a table row (roadmap 34b). */
    private readonly variable?: (row: number, format: PointLabels['format']) => RichText | null,
  ) {}

  /**
   * Whether a point may get a label (its own, or its data set's automatic labels): a point cloud
   * (roadmap 34e) adds only those, neither a million obstacles nor candidates.
   */
  wants(series: string, key: string): boolean {
    if (labelPlain(this.ctx.graph.pointOverrides?.[series as never]?.[key]?.label).trim())
      return true
    const labels = this.styleOf(series)
    return !!labels && labels.source !== 'none'
  }

  /** A drawn point: labels keep off it, and it may get a label. */
  add(point: LabelPoint): void {
    const p = this.map ? { ...point, ...xy(this.map(point.cx, point.cy)) } : point
    this.obstacles.push({ x: p.cx, y: p.cy, r: p.size / 2 })
    this.points.push(p)
  }

  /**
   * Which points get a label and what it says. A point's own label always shows; a data set's
   * automatic labels show for the points its `which` chooses, at most `max` of them (default
   * 100): the most extreme ones — for thresholds the largest |Y| (then |X|), otherwise the
   * farthest from the plot's centre with both axes scaled to the plot's size.
   */
  pick(width: number, height: number): Picked[] {
    const { graph } = this.ctx
    const own: Picked[] = []
    const auto = new Map<string, Picked[]>()
    const centre = (p: LabelPoint) =>
      ((p.cx - width / 2) / (width || 1)) ** 2 + ((p.cy - height / 2) / (height || 1)) ** 2
    for (const p of this.points) {
      const o = graph.pointOverrides?.[p.series as never]?.[p.key]
      const labels = this.styleOf(p.series)
      if (labelPlain(o?.label).trim()) {
        own.push({ p, content: labelRuns(o!.label), own: o, labels, rank: Infinity })
        continue
      }
      if (!labels || labels.source === 'none' || !labelChosen(labels, p)) continue
      const content = autoLabelText(labels, p, this.variable)
      if (!content) continue
      const list = auto.get(p.series) ?? []
      list.push({ p, content, own: o, labels, rank: centre(p) })
      auto.set(p.series, list)
    }
    const out = [...own]
    for (const list of auto.values()) {
      const labels = list[0]!.labels!
      const max = labels.max ?? MAX_POINT_LABELS
      const extreme =
        labels.which === 'threshold'
          ? (a: Picked) => [Math.abs(a.p.y ?? 0), Math.abs(a.p.x ?? 0)]
          : (a: Picked) => [a.rank, 0]
      const sorted =
        list.length > max
          ? list
              .map((a, i) => ({ a, i, k: extreme(a) }))
              .sort((u, v) => v.k[0]! - u.k[0]! || v.k[1]! - u.k[1]! || u.i - v.i)
              .slice(0, max)
              .sort((u, v) => u.i - v.i)
              .map((u) => u.a)
          : list
      for (const a of sorted) out.push(a)
    }
    // Place the most extreme first (they get the spots nearest their points); stable otherwise.
    return out
      .map((a, i) => ({ a, i }))
      .sort((u, v) => v.a.rank - u.a.rank || u.i - v.i)
      .map((u) => u.a)
  }

  /**
   * The label layer (plot-local): each label a text node targeting `['pointLabel', series,
   * point]` with the point key and its offset from the point (`labelOffset`), and a leader line
   * (same target) when it was moved away from its point. Leaders are drawn under every label.
   */
  nodes(width: number, height: number): SceneNode[] {
    const picked = this.pick(width, height)
    if (!picked.length) return []
    const { fonts, theme, graph, palette } = this.ctx
    const base = resolveText(theme.pointLabel, graph.style.text)
    const laid = picked.map((a) => {
      const text = resolveText(base, a.labels?.text)
      // "The data set's colour" (a ColorRef `series`) is the point's.
      const style: TextStyle =
        'series' in text.color ? { ...text, color: { rgb: a.p.color } } : text
      const layout = layoutText(fonts, a.content, style)
      return { a, style, w: layout.width, h: layout.ascent + layout.descent }
    })
    // Dragged labels sit at point + offset; labels of data sets with repel off stay beside
    // their points.
    const placed = placeLabels(
      laid.map(({ a, w, h }) => {
        const off = a.own?.labelOffset ?? a.labels?.offset
        return {
          x: a.p.cx,
          y: a.p.cy,
          r: a.p.size / 2,
          w,
          h,
          ...(off ? { at: { x: a.p.cx + off.dx, y: a.p.cy + off.dy } } : {}),
          ...(a.labels?.repel === false ? { repel: false } : {}),
        }
      }),
      this.obstacles,
      { width, height },
    )

    const leaders: SceneNode[] = []
    const texts: SceneNode[] = []
    laid.forEach(({ a, style }, i) => {
      const { box, away } = placed[i]!
      const target = ['pointLabel', a.p.series, a.p.key]
      const id = `pointLabel/${a.p.series}/${a.p.key}`
      const t = placeText(fonts, id, a.content, style, palette, box.x, box.y, 'start', 'top', {
        target,
      })
      const labelOffset = {
        dx: box.x + box.w / 2 - a.p.cx,
        dy: box.y + box.h / 2 - a.p.cy,
      }
      texts.push({ ...t.node, point: a.p.key, labelOffset })
      const leader = a.labels?.leader
      const width = leader?.width ?? LEADER_WIDTH
      if (!away || width <= 0) return
      const line = leaderLine(a.p.cx, a.p.cy, a.p.size / 2, box)
      if (!line) return
      const labelColor = resolveColor(style.color, palette, a.p.color)
      const stroke: Stroke = {
        color: leader?.color ? resolveColor(leader.color, palette, a.p.color) : labelColor,
        width,
        dash: leader?.dash ?? 'solid',
      }
      leaders.push({
        id: `${id}/leader`,
        target,
        point: a.p.key,
        prim: { type: 'line', ...line, stroke },
      })
    })
    return [...leaders, ...texts]
  }
}
