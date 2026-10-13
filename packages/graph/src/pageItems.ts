import {
  formatNumber,
  formatResultValue,
  type ImageAsset,
  type LayoutItemOf,
  type ProjectSettings,
  type ResultSheet,
  type ResultValue,
  type StrokeStyle,
  summaryFirst,
  summaryText,
  type TextStyle,
} from '@ps/model'
import type { FontRegistry } from './fonts/registry.ts'
import { lineWithHeads } from './layout/arrows.ts'
import { translate } from './layout/common.ts'
import { lineAlign, placeText } from './layout/text.ts'
import type { Box, Prim, SceneNode, StylePath } from './scene.ts'
import { wrapText } from './text/layout.ts'
import { resolveFill, resolveStroke, resolveText, type Theme } from './theme.ts'

// The items a layout page holds besides graphs (roadmap 32): text boxes, lines and arrows,
// rectangles and ellipses, images and live tables, each laid out as scene nodes with the box the
// page editor selects, resizes and snaps.

/** A laid-out page item: its scene node and its bounds on the page. */
export interface ItemScene {
  node: SceneNode
  box: Box
  warning?: string
}

/** Padding between a text item and its border or background, unless it sets its own. */
export const TEXT_BOX_PAD = 4

const PLACEHOLDER_STROKE = { color: '#999999', width: 0.5, dash: 'dash' as const }
const placeholderText: Partial<TextStyle> = { size: 9, color: { rgb: '#888888' } }

/** A dashed box with a note in it, for what can't be drawn (a missing image, a table's source). */
export function placeholder(
  fonts: FontRegistry,
  theme: Theme,
  id: string,
  target: StylePath,
  box: Box,
  note: string,
): SceneNode {
  const text = placeText(
    fonts,
    `${id}/note`,
    [{ text: note }],
    resolveText(theme.text, placeholderText),
    theme.palette,
    box.x + box.w / 2,
    box.y + box.h / 2,
    'middle',
    'middle',
  )
  return {
    id,
    target,
    children: [
      {
        id: `${id}/box`,
        prim: { type: 'rect', ...box, stroke: PLACEHOLDER_STROKE, fill: null },
      },
      text.node,
    ],
    bbox: box,
  }
}

/**
 * A text item: its text wrapped to `width` when it has one (lines aligned within that width),
 * inside a box when it has a border or background. An item with neither lays out exactly as page
 * text always did.
 */
export function textItem(
  fonts: FontRegistry,
  theme: Theme,
  item: LayoutItemOf<'text'>,
  target: StylePath,
): ItemScene {
  const id = `item/${item.id}`
  const style = resolveText(theme.text, item.content.style)
  const width = item.width
  const content =
    width !== undefined ? wrapText(fonts, item.content.content, style, width) : item.content.content
  const align = lineAlign(item.content.align)
  const t = placeText(fonts, id, content, style, theme.palette, item.x, item.y, 'start', 'top', {
    target,
    align,
  })
  const framed = !!item.border || item.background?.type === 'solid'
  if (width === undefined && !framed) return { node: t.node, box: t.bbox }

  // Lines line up within the box's width, not the widest line's.
  const shift =
    width !== undefined ? (width - t.layout.width) * { start: 0, middle: 0.5, end: 1 }[align] : 0
  const text = shift ? translate(t.node, shift, 0) : t.node
  const inner: Box = { x: item.x, y: t.bbox.y, w: width ?? t.bbox.w, h: t.bbox.h }
  const pad = framed ? (item.padding ?? TEXT_BOX_PAD) : 0
  const box: Box = {
    x: inner.x - pad,
    y: inner.y - pad,
    w: inner.w + 2 * pad,
    h: inner.h + 2 * pad,
  }
  const children: SceneNode[] = []
  if (framed)
    children.push({
      id: `${id}/box`,
      target,
      prim: {
        type: 'rect',
        ...box,
        stroke: item.border ? resolveStroke(item.border, theme.palette) : null,
        fill: item.background ? resolveFill(item.background, theme.palette) : null,
      },
    })
  children.push({ ...text, id: `${id}/text` })
  return { node: { id, target, children, bbox: box }, box }
}

/** A line or arrow: the line and its heads; bounds reach round the heads. */
export function lineItem(theme: Theme, item: LayoutItemOf<'line'>, target: StylePath): ItemScene {
  const id = `item/${item.id}`
  const stroke = resolveStroke(item.stroke, theme.palette)
  const { from, to } = item
  const r = lineWithHeads(from.x, from.y, to.x, to.y, stroke, item.heads ?? {})
  const reach = Math.max(stroke.width / 2, r.reach)
  const box: Box = {
    x: Math.min(from.x, to.x) - reach,
    y: Math.min(from.y, to.y) - reach,
    w: Math.abs(to.x - from.x) + 2 * reach,
    h: Math.abs(to.y - from.y) + 2 * reach,
  }
  const children: SceneNode[] = [
    { id: `${id}/line`, target, prim: { type: 'line', ...r.line, stroke } },
    ...r.heads.map((prim, k) => ({ id: `${id}/head/${k}`, target, prim })),
  ]
  return { node: { id, target, children, bbox: box }, box }
}

/** A rectangle (corners rounded by `radius`) or an ellipse filling the item's box. */
export function shapeItem(theme: Theme, item: LayoutItemOf<'shape'>, target: StylePath): ItemScene {
  const stroke = item.stroke ? resolveStroke(item.stroke, theme.palette) : null
  const fill = item.fill ? resolveFill(item.fill, theme.palette) : null
  const { x, y, w, h } = item
  const prim: Prim =
    item.shape === 'ellipse'
      ? { type: 'ellipse', cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2, stroke, fill }
      : {
          type: 'rect',
          x,
          y,
          w,
          h,
          stroke,
          fill,
          ...(item.radius ? { rx: Math.min(item.radius, w / 2, h / 2) } : {}),
        }
  const box = { x, y, w, h }
  return { node: { id: `item/${item.id}`, target, prim, bbox: box }, box }
}

/** An image in its box (the crop stretched to it), with its border; missing: a placeholder. */
export function imageItem(
  fonts: FontRegistry,
  theme: Theme,
  item: LayoutItemOf<'image'>,
  target: StylePath,
  asset: ImageAsset | undefined,
): ItemScene {
  const id = `item/${item.id}`
  const box = { x: item.x, y: item.y, w: item.w, h: item.h }
  if (!asset)
    return {
      node: placeholder(fonts, theme, id, target, box, 'Missing image'),
      box,
      warning: 'An image on this page is missing from the project.',
    }
  const children: SceneNode[] = [
    {
      id: `${id}/image`,
      target,
      prim: { type: 'image', ...box, asset, ...(item.crop ? { crop: item.crop } : {}) },
    },
  ]
  if (item.border)
    children.push({
      id: `${id}/border`,
      target,
      prim: { type: 'rect', ...box, stroke: resolveStroke(item.border, theme.palette), fill: null },
    })
  return { node: { id, target, children, bbox: box }, box }
}

// ---- Tables --------------------------------------------------------------------------------

/** A cell of a table on a page: its text, and whether it is a title / column title or a number. */
export interface PageTableCell {
  text: string
  /** A block's title (spans the row) or a column title. */
  style?: 'title' | 'header'
  numeric?: boolean
}

/** What a table item shows: rows of cells, or why it can't (its source is gone, not computed…). */
export type PageTableGrid = { rows: PageTableCell[][] } | { error: string }

/**
 * Roadmap 35: a results sheet as a table's cells, as the results view shows it (each block's
 * title, a table's column titles, a blank row between blocks), numbers to `digits` significant
 * digits when given (else as the results show them); numbers flagged for right alignment.
 */
export function resultSheetCells(
  sheet: ResultSheet,
  settings: Pick<ProjectSettings, 'pValueStyle' | 'pValueDigits'>,
  digits?: number,
): PageTableCell[][] {
  const value = (v: ResultValue): PageTableCell => {
    const text =
      digits === undefined
        ? formatResultValue(v, settings)
        : v.kind === 'number'
          ? formatNumber(v.v, digits)
          : v.kind === 'interval'
            ? `${formatNumber(v.lo, digits)} to ${formatNumber(v.hi, digits)}`
            : formatResultValue(v, settings)
    const numeric =
      (v.kind === 'number' || v.kind === 'integer' || v.kind === 'pvalue') &&
      Number.isFinite(v.v) &&
      /^-?(\d+(\.\d+)?|\.\d+|\d(\.\d+)?e[+-]\d+)$/.test(text)
    return { text, ...(numeric ? { numeric: true } : {}) }
  }
  const out: PageTableCell[][] = []
  for (const b of summaryFirst(sheet.blocks)) {
    if (out.length) out.push([])
    if (b.type === 'note') {
      out.push([{ text: b.text }])
      continue
    }
    if (b.type === 'summary') {
      out.push([{ text: summaryText(b, settings) }])
      continue
    }
    if (b.title) out.push([{ text: b.title, style: 'title' }])
    if (b.type === 'keyValue') for (const r of b.rows) out.push([{ text: r.label }, value(r.value)])
    else {
      out.push(b.columns.map((c) => ({ text: c, style: 'header' as const })))
      for (const r of b.rows) out.push(r.map(value))
    }
  }
  return out
}

/** Default table text: the theme's at 9 pt. */
export const TABLE_TEXT_SIZE = 9
const DEFAULT_GRID: StrokeStyle = { color: { rgb: '#999999' }, width: 0.5, dash: 'solid' }

/** Leading rows of titles and column titles (and blanks): the header the row range skips. */
export function headerRowCount(rows: readonly PageTableCell[][]): number {
  let n = 0
  while (n < rows.length && rows[n]!.every((c) => c.style || c.text === '')) n++
  // A table of headers only (no values yet) has no header: its rows are its body.
  return n === rows.length ? 0 : n
}

/** The rows and columns an item shows: its header rows, then the body rows and columns in range. */
export function tableSlice(
  rows: readonly PageTableCell[][],
  range: Pick<LayoutItemOf<'table'>, 'rows' | 'columns'>,
): PageTableCell[][] {
  const head = headerRowCount(rows)
  const body = rows.slice(head)
  const pick = <T>(a: readonly T[], r: { from: number; to?: number } | undefined) =>
    r ? a.slice(r.from, r.to === undefined ? undefined : r.to + 1) : [...a]
  const shown = [...rows.slice(0, head), ...pick(body, range.rows)]
  return range.columns ? shown.map((r) => pick(r, range.columns)) : shown
}

/**
 * A live table: each column as wide as its widest cell, a row per line of cells, numbers
 * right-aligned, titles spanning the row, headers bold (by default), grid lines between all
 * cells, between rows only, or none.
 */
export function tableItem(
  fonts: FontRegistry,
  theme: Theme,
  item: LayoutItemOf<'table'>,
  target: StylePath,
  grid: PageTableGrid | null,
): ItemScene {
  const id = `item/${item.id}`
  const style = resolveText(theme.text, { size: TABLE_TEXT_SIZE, ...item.text })
  if (!grid || 'error' in grid) {
    const box = { x: item.x, y: item.y, w: 144, h: 36 }
    return {
      node: placeholder(fonts, theme, id, target, box, grid ? grid.error : 'Table'),
      box,
      ...(grid ? { warning: `A table on this page: ${grid.error}` } : {}),
    }
  }
  const rows = tableSlice(grid.rows, item)
  const bold = item.headerBold ?? true
  const styleOf = (c: PageTableCell): TextStyle =>
    c.style && bold ? { ...style, bold: true } : style
  const padX = style.size * 0.45
  const padY = style.size * 0.2
  const font = fonts.get(style.font, 'regular')
  const lineH = ((font.ascent - font.descent) * style.size) / font.unitsPerEm
  const rowH = lineH + 2 * padY
  const cols = Math.max(0, ...rows.map((r) => r.length))
  // Titles span their row, so they don't widen the first column.
  const spans = (r: PageTableCell[]) => r[0]?.style === 'title' && r.slice(1).every((c) => !c.text)
  const measured = rows.map((r) =>
    r.map((c) =>
      c.text
        ? placeText(fonts, '', [{ text: c.text }], styleOf(c), theme.palette, 0, 0, 'start', 'top')
            .layout.width
        : 0,
    ),
  )
  const colW = Array.from(
    { length: cols },
    (_, j) =>
      Math.max(style.size, ...rows.map((r, i) => (spans(r) ? 0 : (measured[i]![j] ?? 0)))) +
      2 * padX,
  )
  const width = colW.reduce((s, w) => s + w, 0)
  const colX = colW.map((_, j) => item.x + colW.slice(0, j).reduce((s, w) => s + w, 0))
  const children: SceneNode[] = []
  rows.forEach((r, i) => {
    const y = item.y + i * rowH + padY
    r.forEach((c, j) => {
      if (!c.text) return
      const right = !!c.numeric && !c.style
      const x = right ? colX[j]! + colW[j]! - padX : colX[j]! + padX
      children.push(
        placeText(
          fonts,
          `${id}/cell/${i}/${j}`,
          [{ text: c.text }],
          styleOf(c),
          theme.palette,
          x,
          y,
          right ? 'end' : 'start',
          'top',
          { target },
        ).node,
      )
    })
  })
  const height = rows.length * rowH
  const lines = item.grid ?? 'all'
  if (lines !== 'none' && rows.length && cols) {
    const stroke = resolveStroke(item.gridStroke ?? DEFAULT_GRID, theme.palette)
    const segs: [number, number, number, number][] = []
    for (let i = 0; i <= rows.length; i++) {
      const y = item.y + i * rowH
      segs.push([item.x, y, item.x + width, y])
    }
    if (lines === 'all')
      for (let j = 0; j <= cols; j++) {
        const x = j === cols ? item.x + width : colX[j]!
        segs.push([x, item.y, x, item.y + height])
      }
    for (const [k, [x1, y1, x2, y2]] of segs.entries())
      children.push({
        id: `${id}/grid/${k}`,
        target,
        prim: { type: 'line', x1, y1, x2, y2, stroke },
      })
  }
  const box = { x: item.x, y: item.y, w: width, h: height }
  return { node: { id, target, children, bbox: box }, box }
}
