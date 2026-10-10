import { type Annotation, type LayoutItemId, lineEndsOf } from '@ps/model'
import { type PageTableGrid, resultSheetCells, tableItem } from '../pageItems.ts'
import type { Box, SceneNode } from '../scene.ts'
import { graphText, resolveBracketStyle, resolveFill, resolveStroke, type Theme } from '../theme.ts'
import { lineWithHeads } from './arrows.ts'
import { type AxisPlan, bracketLabel, type GraphContext, translate, unionBoxes } from './common.ts'
import { flipBox, flipNode } from './orient.ts'
import { lineAlign, placeText } from './text.ts'

type Bracket = Extract<Annotation, { type: 'bracket' }>

/** Space between a horizontal graph's bracket label and the next bracket beyond it. */
const LABEL_CLEAR = 4

/** A bracket to draw between plot-local x positions x1 < x2. */
export interface BracketSpan {
  a: Bracket
  /** Index in graph.annotations. */
  idx: number
  x1: number
  x2: number
  /**
   * Roadmap 35: a group of bars pooled against one (`a.group`): the group's extent and the one's
   * place. The bracket runs from the group's centre to the one, over a line spanning the group.
   */
  group?: { x1: number; x2: number; to: number }
}

/**
 * Significance brackets (plot-local). `tops` are the highest points drawn at each x (smallest
 * plot y); an 'auto' bracket sits `gap` above the data it spans and stacks `step` above any
 * placed bracket it overlaps, narrow spans first (like Prism). Returns the nodes and the top of
 * the highest label (≤ 0 when brackets rise above the plot).
 *
 * Horizontal graphs (`across`: the value axis' length): spans and tops are given in the vertical
 * frame and the brackets come out turned (see `flipNode`), standing right of the data with
 * their labels level beside them; `top` is still in the vertical frame (the labels' right edge).
 */
export function layoutBrackets(
  ctx: GraphContext,
  theme: Theme,
  palette: readonly string[],
  spans: BracketSpan[],
  tops: readonly { x: number; top: number }[],
  H: number,
  across?: number,
): { nodes: SceneNode[]; top: number } {
  const bt = resolveBracketStyle(theme, ctx.graph)
  const stroke = resolveStroke(bt.line, palette)
  const width = (s: BracketSpan) => s.x2 - s.x1
  const sorted = [...spans].sort((p, q) => {
    const d = width(p) - width(q)
    return Math.abs(d) > 1e-9 ? d : p.x1 - q.x1
  })
  const placed: { x1: number; x2: number; y: number }[] = []
  let topMost = 0
  const nodes = sorted.map(({ a, idx, x1, x2, group }) => {
    let yLine: number
    // A group's line sits a tick below the bracket: the bracket a tick higher.
    const lift = group ? Math.abs(bt.tick) : 0
    if (a.level === 'auto') {
      const under = tops.filter((t) => t.x >= x1 - 1e-6 && t.x <= x2 + 1e-6).map((t) => t.top)
      yLine = Math.min(...under.filter(Number.isFinite), H) - bt.gap - lift
      for (const q of placed) if (q.x1 <= x2 && x1 <= q.x2) yLine = Math.min(yLine, q.y - bt.step)
    } else {
      const all = tops.map((t) => t.top).filter(Number.isFinite)
      yLine = Math.min(...all, H) - bt.gap - lift - a.level * bt.step
    }
    placed.push({ x1, x2, y: yLine })
    // A bracket dragged up or down (roadmap 22) moves from its stacked place; the brackets above
    // keep stacking on that computed place, so moving one never reshuffles the others.
    const moved = a.offset ?? 0
    yLine += moved
    const target = ['annotations', idx]
    // Two cells at the same x (aligned data sets, e.g. time points): the label alone, above them.
    const labelOnly = !group && x2 - x1 < 0.5
    const labelAt = labelOnly ? yLine + bt.gap / 2 : yLine - 2
    // A group to one: the bracket from the group's centre to the one (label centred over it).
    const [l1, l2] = group
      ? [
          Math.min((group.x1 + group.x2) / 2, group.to),
          Math.max((group.x1 + group.x2) / 2, group.to),
        ]
      : [x1, x2]
    const text =
      across === undefined
        ? placeText(
            ctx.fonts,
            `annotation/${a.id}/label`,
            bracketLabel(ctx, a),
            bt.label,
            palette,
            (l1 + l2) / 2,
            labelAt,
            'middle',
            'bottom',
          )
        : placeText(
            ctx.fonts,
            `annotation/${a.id}/label`,
            bracketLabel(ctx, a),
            bt.label,
            palette,
            across - labelAt,
            (l1 + l2) / 2,
            'start',
            'middle',
          )
    // The label's far edge from the data, in the vertical frame.
    const labelTop = across === undefined ? text.bbox.y : across - text.bbox.x - text.bbox.w
    topMost = Math.min(topMost, labelTop)
    // Beside horizontal data a label is as wide as its text: brackets overlapping this one stack
    // clear of it.
    if (across !== undefined) {
      const q = placed[placed.length - 1]!
      q.y = Math.min(q.y, labelTop - moved + bt.step - LABEL_CLEAR)
    }
    if (labelOnly) {
      // Later brackets over this x stack above the label.
      placed[placed.length - 1]!.y = labelTop - moved
      return {
        id: `annotation/${a.id}`,
        target,
        children: [{ ...text.node, target }],
        bbox: text.bbox,
      } satisfies SceneNode
    }
    const lineTop = Math.min(yLine, yLine + bt.tick)
    const line: SceneNode = {
      id: `annotation/${a.id}/line`,
      target,
      prim: {
        type: 'polyline',
        points: [
          [l1, yLine + bt.tick],
          [l1, yLine],
          [l2, yLine],
          [l2, yLine + bt.tick],
        ],
        stroke,
      },
    }
    // The group's line under the bracket's leg, its ends ticked down to the group's bars.
    const groupLine: SceneNode[] = group
      ? [
          {
            id: `annotation/${a.id}/group`,
            target,
            prim: {
              type: 'polyline',
              points: [
                [group.x1, yLine + 2 * bt.tick],
                [group.x1, yLine + bt.tick],
                [group.x2, yLine + bt.tick],
                [group.x2, yLine + 2 * bt.tick],
              ],
              stroke,
            },
          },
        ]
      : []
    const lineBox = { x: x1, y: lineTop, w: x2 - x1, h: Math.abs(bt.tick) * (group ? 2 : 1) }
    const turn = (n: SceneNode) => (across === undefined ? n : flipNode(n, across))
    return {
      id: `annotation/${a.id}`,
      target,
      children: [turn(line), ...groupLine.map(turn), { ...text.node, target }],
      bbox: unionBoxes([
        text.bbox,
        across === undefined ? lineBox : flipBox(lineBox, across),
      ]) as Box,
    } satisfies SceneNode
  })
  return { nodes, top: topMost }
}

/** A bracket at one X of an XY graph (roadmap 35): between the plot-local y of two points. */
export interface XYBracketSpan {
  a: Bracket
  idx: number
  /** Plot-local x of the X value, and how far right of it the points reach. */
  x: number
  reach: number
  y1: number
  y2: number
}

/**
 * Brackets at one X of an XY graph (roadmap 35: a comparison at a time point): standing right of
 * the points at that X, spanning the two data sets' centres, ticks towards the points, the label
 * right of the line; brackets at one X stack outwards (narrow spans first), `level` a fixed stack
 * place and `offset` a move right (dragged). Returns the nodes and how far right of the plot
 * they reach.
 */
export function layoutXYBrackets(
  ctx: GraphContext,
  theme: Theme,
  palette: readonly string[],
  spans: readonly XYBracketSpan[],
  W: number,
): { nodes: SceneNode[]; right: number } {
  const bt = resolveBracketStyle(theme, ctx.graph)
  const stroke = resolveStroke(bt.line, palette)
  const sorted = [...spans].sort((p, q) => {
    const d = Math.abs(p.y2 - p.y1) - Math.abs(q.y2 - q.y1)
    return Math.abs(d) > 1e-9 ? d : p.x - q.x
  })
  const placed: { x: number; y1: number; y2: number; at: number }[] = []
  let right = 0
  const nodes = sorted.map(({ a, idx, x, reach, y1, y2 }) => {
    const [top, bottom] = [Math.min(y1, y2), Math.max(y1, y2)]
    const base = x + reach + bt.gap
    let at = base
    if (a.level === 'auto') {
      for (const q of placed)
        if (Math.abs(q.x - x) < 0.5 && q.y1 <= bottom && top <= q.y2)
          at = Math.max(at, q.at + bt.step)
    } else at = base + a.level * bt.step
    placed.push({ x, y1: top, y2: bottom, at })
    at += a.offset ?? 0
    const target = ['annotations', idx]
    const tick = Math.abs(bt.tick)
    const line: SceneNode = {
      id: `annotation/${a.id}/line`,
      target,
      prim: {
        type: 'polyline',
        points: [
          [at - tick, top],
          [at, top],
          [at, bottom],
          [at - tick, bottom],
        ],
        stroke,
      },
    }
    const text = placeText(
      ctx.fonts,
      `annotation/${a.id}/label`,
      bracketLabel(ctx, a),
      bt.label,
      palette,
      at + 3,
      (top + bottom) / 2,
      'start',
      'middle',
    )
    const lineBox = { x: at - tick, y: top, w: tick, h: bottom - top }
    const bbox = unionBoxes([text.bbox, lineBox]) as Box
    right = Math.max(right, bbox.x + bbox.w - W)
    return {
      id: `annotation/${a.id}`,
      target,
      children: [line, { ...text.node, target }],
      bbox,
    } satisfies SceneNode
  })
  return { nodes, right }
}

/** Padding between a text annotation and its box. */
export const NOTE_PAD = 2

/**
 * Text and line annotations (plot-local). 'plot' coordinates are fractions of the plot area from
 * its top-left; 'data' coordinates are axis values (category index on categorical axes). Text is
 * anchored by its top-left corner. Annotations whose position can't be computed (e.g. a value
 * ≤ 0 on a log axis) are skipped.
 */
export function layoutNotes(
  ctx: GraphContext,
  theme: Theme,
  palette: readonly string[],
  x: AxisPlan,
  y: AxisPlan,
): { nodes: SceneNode[]; bounds: Box | null; aside: number } {
  const { graph, fonts } = ctx
  /** How far tables beside the plot reach right of it (roadmap 35). */
  let aside = 0
  const W = x.length
  const H = y.length
  const point = (space: 'plot' | 'data', px: number, py: number): [number, number] =>
    space === 'plot' ? [px * W, py * H] : [x.toPx(px), y.toPx(py)]
  const nodes: SceneNode[] = []
  graph.annotations.forEach((a, idx) => {
    const target = ['annotations', idx]
    const id = `annotation/${a.id}`
    if (a.type === 'text') {
      const [ax, ay] = point(a.anchor.space, a.anchor.x, a.anchor.y)
      if (!Number.isFinite(ax) || !Number.isFinite(ay) || !a.content.content.length) return
      const style = graphText(theme.text, graph, a.content.style)
      const text = placeText(
        fonts,
        `${id}/text`,
        a.content.content,
        style,
        palette,
        ax,
        ay,
        'start',
        'top',
        { target, align: lineAlign(a.content.align) },
      )
      const children: SceneNode[] = []
      let bbox = text.bbox
      const fill = a.background ? resolveFill(a.background, palette) : null
      if (a.border || fill) {
        bbox = {
          x: text.bbox.x - NOTE_PAD,
          y: text.bbox.y - NOTE_PAD,
          w: text.bbox.w + 2 * NOTE_PAD,
          h: text.bbox.h + 2 * NOTE_PAD,
        }
        children.push({
          id: `${id}/box`,
          target,
          prim: {
            type: 'rect',
            ...bbox,
            stroke: a.border ? resolveStroke(a.border, palette) : null,
            fill,
          },
          bbox,
        })
      }
      children.push(text.node)
      nodes.push({ id, target, children, bbox })
    } else if (a.type === 'table') {
      const node = insetTable(ctx, theme, palette, a, idx, W, H, point)
      if (node) {
        nodes.push(node)
        if (a.place === 'right') aside = Math.max(aside, node.bbox!.x + node.bbox!.w - W)
      }
    } else if (a.type === 'line') {
      const [x1, y1] = point(a.space, a.from.x, a.from.y)
      const [x2, y2] = point(a.space, a.to.x, a.to.y)
      if (![x1, y1, x2, y2].every(Number.isFinite)) return
      const stroke = resolveStroke(a.stroke, palette)
      const r = lineWithHeads(x1, y1, x2, y2, stroke, lineEndsOf(a))
      const children: SceneNode[] = [
        { id: `${id}/line`, target, prim: { type: 'line', ...r.line, stroke } },
        ...r.heads.map((prim, k) => ({ id: `${id}/arrow/${k}`, target, prim })),
      ]
      const reach = Math.max(stroke.width / 2, r.reach, 2)
      const bbox: Box = {
        x: Math.min(x1, x2) - reach,
        y: Math.min(y1, y2) - reach,
        w: Math.abs(x2 - x1) + 2 * reach,
        h: Math.abs(y2 - y1) + 2 * reach,
      }
      nodes.push({ id, target, children, bbox })
    }
  })
  return { nodes, bounds: unionBoxes(nodes.map((n) => n.bbox)), aside }
}

/** Space between an inset table and the plot's edges (or the plot, beside it). */
const TABLE_PAD = 4
/** An inset table's default text size (pt). */
export const INSET_TABLE_SIZE = 8

/**
 * Roadmap 35: a table of an analysis' results sheet in a corner of the plot, right of it or at
 * an anchor, live (the page tables' renderer, `tableItem`), over a background (white unless set).
 */
function insetTable(
  ctx: GraphContext,
  theme: Theme,
  palette: readonly string[],
  a: Extract<Annotation, { type: 'table' }>,
  idx: number,
  W: number,
  H: number,
  point: (space: 'plot' | 'data', x: number, y: number) => [number, number],
): SceneNode | null {
  const target = ['annotations', idx]
  const id = `annotation/${a.id}`
  const result = ctx.result?.(a.analysis)
  const sheet = result?.sheets.find((s) => s.key === a.sheet)
  const grid: PageTableGrid = !result
    ? { error: 'not computed yet' }
    : !sheet
      ? { error: 'no such results sheet' }
      : { rows: resultSheetCells(sheet, ctx.project.settings, a.digits) }
  const item = {
    type: 'table' as const,
    id: a.id as unknown as LayoutItemId,
    x: 0,
    y: 0,
    source: { kind: 'results' as const, node: a.analysis, sheet: a.sheet },
    ...(a.rows ? { rows: a.rows } : {}),
    ...(a.columns ? { columns: a.columns } : {}),
    text: { ...ctx.graph.style.text, size: INSET_TABLE_SIZE, ...a.text },
    grid: a.grid ?? 'rows',
    ...(a.gridStroke ? { gridStroke: a.gridStroke } : {}),
    ...(a.headerBold !== undefined ? { headerBold: a.headerBold } : {}),
  }
  const laid = tableItem(ctx.fonts, theme, item, target, grid)
  const { w, h } = laid.box
  const place = a.place ?? 'topRight'
  let at: [number, number]
  if (place === 'anchor') at = a.anchor ? point(a.anchor.space, a.anchor.x, a.anchor.y) : [0, 0]
  else if (place === 'right') at = [W + TABLE_PAD * 2, 0]
  else
    at = [
      place.endsWith('Left') ? TABLE_PAD : W - TABLE_PAD - w,
      place.startsWith('top') ? TABLE_PAD : H - TABLE_PAD - h,
    ]
  if (!at.every(Number.isFinite)) return null
  const box = { x: at[0], y: at[1], w, h }
  const fill = resolveFill(
    a.background ?? { type: 'solid', color: { rgb: '#ffffff' }, opacity: 1 },
    palette,
  )
  // The renderer's ids under the annotation's.
  const rename = (n: SceneNode): SceneNode => ({
    ...n,
    id: n.id.replace(`item/${a.id}`, `${id}/table`),
    ...(n.children ? { children: n.children.map(rename) } : {}),
  })
  const table = translate(rename(laid.node), at[0], at[1])
  return {
    id,
    target,
    children: [
      ...(fill
        ? [
            {
              id: `${id}/background`,
              target,
              prim: { type: 'rect' as const, ...box, stroke: null, fill },
            },
          ]
        : []),
      ...(table.children ?? []),
    ],
    bbox: box,
  }
}
