import {
  type Box,
  cloudIndex,
  cloudPointNode,
  type PointsPrim,
  primBounds,
  type SceneNode,
  type StylePath,
} from '@ps/graph'
import { textBox } from '../graph/canvasEdit.ts'
import { pointSeries, sceneIndex, selectionKey } from './sceneKeys.ts'

// The marquee's rules (roadmap 44, decisions 860–862), in one place for the layout page and the
// graph canvas: what a box drawn over a page's items or a graph's scene picks.

/**
 * How a box picks:
 * - `touch`: a page's items the box touches (decision 191), locked items skipped, groups whole;
 * - `inside`: a graph's elements with one of their marks wholly inside the box (a box round one
 *   bar picks its data set, round tick labels their group, round the title the title);
 * - `points`: single points (`pointOverrides` keys) whose mark lies wholly inside, of the data
 *   sets `dataSets` names (null: of every data set).
 */
export type BoxRule =
  | { kind: 'touch' }
  | { kind: 'inside' }
  | { kind: 'points'; dataSets: readonly string[] | null }

/** A page item as the marquee sees it: its box on the page, lock and group. */
export interface BoxItem {
  /** What the pick returns for it (the item's index on the page). */
  index: number
  box: Box
  locked?: boolean
  group?: string
}

/** A mark a box picked and the selection key it picks (a point's node for a cloud's point). */
export interface BoxPick {
  key: StylePath
  node: SceneNode
}

/** `b` wholly inside `box` (edges included). */
const inside = (b: Box, box: Box) =>
  b.x >= box.x && b.y >= box.y && b.x + b.w <= box.x + box.w && b.y + b.h <= box.y + box.h

/** `b` and `box` overlap (touching edges don't). */
const touches = (b: Box, box: Box) =>
  b.x < box.x + box.w && box.x < b.x + b.w && b.y < box.y + box.h && box.y < b.y + b.h

/** Backgrounds are never picked: a box starts on them. */
const isBackground = (t: StylePath) =>
  t[0] === 'style' && (t[1] === 'plotBackground' || t[1] === 'background')

/**
 * The element a mark with this target counts for in a box: its selection key, except that tick
 * labels count for their group (a click picks their axis first, decision 851).
 */
function elementKeyOf(t: StylePath): StylePath {
  if (t[0] === 'axes' && t[2] === 'tickLabels') return t.slice(0, 3)
  return selectionKey(t)
}

interface Mark {
  node: SceneNode
  /** The element it counts for (`inside`). */
  key: StylePath
  /** Its bounds (null for a cloud, whose points are looked up in its grid). */
  box: Box | null
  /** A single point's data set and key, when it is one. */
  series?: string
  point?: string
}

/** A mark's bounds: its own box, else its text's or primitive's (graph scenes have no transforms). */
function markBox(n: SceneNode): Box | null {
  if (n.bbox) return n.bbox
  if (n.prim?.type === 'text') return textBox(n.prim)
  return n.prim ? primBounds(n.prim) : null
}

const markLists = new WeakMap<SceneNode, Mark[]>()

/** A scene's marks in drawing order with their boxes, made once per scene. */
function marksOf(root: SceneNode): Mark[] {
  let list = markLists.get(root)
  if (list) return list
  list = []
  for (const n of sceneIndex(root).nodes.all) {
    const t = n.target
    if (!n.prim || !t?.length || isBackground(t)) continue
    const series = pointSeries(t)
    const box = n.prim.type === 'points' ? null : markBox(n)
    if (n.prim.type !== 'points' && !box) continue
    list.push({
      node: n,
      key: elementKeyOf(t),
      box,
      ...(series !== undefined ? { series } : {}),
      ...(n.point !== undefined ? { point: n.point } : {}),
    })
  }
  markLists.set(root, list)
  return list
}

/** The indices of a cloud's points wholly inside `box`, ascending (through the cloud's grid). */
export function cloudPointsInBox(p: PointsPrim, box: Box): number[] {
  if (!p.n) return []
  const g = cloudIndex(p)
  const cell = (v: number, v0: number, max: number) =>
    Math.max(0, Math.min(max - 1, Math.floor((v - v0) / g.cell)))
  const [c0, c1] = [cell(box.x, g.x0, g.cols), cell(box.x + box.w, g.x0, g.cols)]
  const [r0, r1] = [cell(box.y, g.y0, g.rows), cell(box.y + box.h, g.y0, g.rows)]
  const out: number[] = []
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++) {
      const k = r * g.cols + c
      for (let j = g.start[k]!; j < g.start[k + 1]!; j++) {
        const i = g.items[j]!
        const s = p.size[i]! / 2
        const [x, y] = [p.x[i]!, p.y[i]!]
        if (x - s >= box.x && y - s >= box.y && x + s <= box.x + box.w && y + s <= box.y + box.h)
          out.push(i)
      }
    }
  return out.sort((a, b) => a - b)
}

/**
 * Every mark of a graph's scene a box picks under `rule` (`inside` or `points`), with the key it
 * picks, in drawing order: for `inside` each element's first mark inside; for `points` each
 * point's marks inside (a cloud's points as nodes of their own). `box` is in scene points.
 */
export function picksInBox(
  root: SceneNode,
  box: Box,
  rule: Exclude<BoxRule, { kind: 'touch' }>,
): BoxPick[] {
  const out: BoxPick[] = []
  const seen = new Set<string>()
  const wanted = rule.kind === 'points' && rule.dataSets ? new Set(rule.dataSets.map(String)) : null
  const pick = (key: StylePath, node: SceneNode) => {
    const id = JSON.stringify(key)
    if (rule.kind === 'inside' && seen.has(id)) return
    seen.add(id)
    out.push({ key, node })
  }
  for (const m of marksOf(root)) {
    if (rule.kind === 'inside') {
      if (seen.has(JSON.stringify(m.key))) continue
      const p = m.node.prim
      if (p?.type === 'points') {
        const i = cloudPointsInBox(p, box)[0]
        if (i !== undefined) pick(m.key, cloudPointNode(m.node, i))
      } else if (m.box && inside(m.box, box)) pick(m.key, m.node)
      continue
    }
    // Points: of the data sets asked for.
    if (m.series === undefined || (wanted && !wanted.has(m.series))) continue
    const p = m.node.prim
    if (p?.type === 'points') {
      for (const i of cloudPointsInBox(p, box)) {
        const node = cloudPointNode(m.node, i)
        // A cloud's outliers have no key: they can't be selected alone.
        if (node.point) pick(['pointOverrides', m.series, node.point], node)
      }
    } else if (m.point !== undefined && m.box && inside(m.box, box))
      pick(['pointOverrides', m.series, m.point], m.node)
  }
  return out
}

/**
 * What a marquee picks (roadmap 44): on a page (`touch`), the indices of the unlocked items the
 * box touches with the other members of their groups, ascending; in a graph's scene (`inside`,
 * `points`), the selection keys picked, each once, in drawing order. `box` is in the page's or
 * the scene's points.
 */
export function pickInBox(items: readonly BoxItem[], box: Box, rule: { kind: 'touch' }): number[]
export function pickInBox(
  scene: SceneNode,
  box: Box,
  rule: Exclude<BoxRule, { kind: 'touch' }>,
): StylePath[]
export function pickInBox(
  source: readonly BoxItem[] | SceneNode,
  box: Box,
  rule: BoxRule,
): number[] | StylePath[] {
  if (rule.kind === 'touch') {
    const items = source as readonly BoxItem[]
    const hit = items.filter((it) => !it.locked && touches(it.box, box))
    const groups = new Set(hit.flatMap((it) => it.group ?? []))
    const out = new Set(hit.map((it) => it.index))
    for (const it of items) if (it.group && groups.has(it.group)) out.add(it.index)
    return [...out].sort((a, b) => a - b)
  }
  const seen = new Set<string>()
  const keys: StylePath[] = []
  for (const p of picksInBox(source as SceneNode, box, rule)) {
    const id = JSON.stringify(p.key)
    if (!seen.has(id)) {
      seen.add(id)
      keys.push(p.key)
    }
  }
  return keys
}

/** The box between two corners. */
export function boxBetween(a: { x: number; y: number }, b: { x: number; y: number }): Box {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  }
}
