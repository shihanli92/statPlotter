import type {
  SchematicArrow,
  SchematicBox,
  SchematicGlyph,
  SchematicSpec,
  TextStyle,
} from '@ps/model'
import type { FontRegistry } from './fonts/registry.ts'
import { arrowHead } from './layout/arrows.ts'
import type { Box, PathCmd, Prim, Scene, SceneNode, Stroke } from './scene.ts'
import { layoutText, wrapText } from './text/layout.ts'

// Roadmap 51f: "What will be tested" drawn — boxes on a grid (named, with a small picture of what
// is compared and a line of words), comparisons as arcs over a row (beside a column), lines under
// a row or straight arrows, the same subjects as links, a grid's factor headings and a legend for
// the links. The spec comes from @ps/analyses; nothing here knows which analysis or question
// asked: it lays out boxes, arrows and links. Geometry in points, text measured by fontkit.

/** The schematic's colours: light or dark, as the dialog around it. */
export interface SchematicTheme {
  ink: string
  muted: string
  box: string
  boxEdge: string
  control: string
  controlEdge: string
  arrow: string
  link: string
  glyph: string
  /** The panel behind (labels' halos). */
  paper: string
}

export const SCHEMATIC_THEMES: Readonly<Record<'light' | 'dark', SchematicTheme>> = {
  light: {
    ink: '#1d2126',
    muted: '#5c6470',
    box: '#f4f5f7',
    boxEdge: '#a9b0b9',
    control: '#e6eefc',
    controlEdge: '#2864cc',
    arrow: '#2864cc',
    link: '#a85600',
    glyph: '#5c6470',
    paper: '#ffffff',
  },
  dark: {
    ink: '#e6e8eb',
    muted: '#a3abb6',
    box: '#16181c',
    boxEdge: '#66707c',
    control: '#1d2b44',
    controlEdge: '#7aa8ff',
    arrow: '#7aa8ff',
    link: '#f0a050',
    glyph: '#a3abb6',
    paper: '#1f2227',
  },
}

/** The drawing's usual width, in points (the dialog's side panel). */
export const SCHEMATIC_WIDTH = 320

const PAD = 6
const GAP = 14
/** Room between columns joined by straight arrows (predictors → outcome). */
const WIDE_GAP = 40
const BOX_MIN = 46
const BOX_MAX = 116
const GLYPH_H = 12
const LEVEL_H = 10
const ARC_BASE = 12

const style = (size: number, bold = false, italic = false): TextStyle => ({
  font: 'sans',
  size,
  color: { rgb: '#000000' },
  bold,
  italic,
})
const LABEL = style(10, true)
const MEASURE = style(8.5)
const ARROW_LABEL = style(8, false, true)
const HEADING = style(8.5, true)
const FACTOR = style(8.5, false, true)

const solid = (color: string, width = 1): Stroke => ({ color, width, dash: 'solid' })

interface Ctx {
  fonts: FontRegistry
  t: SchematicTheme
}

/** Lines of `text` within `width`, at most `max` of them (the last ending "…" when cut). */
function fitLines(c: Ctx, text: string, st: TextStyle, width: number, max: number): string[] {
  if (!text) return []
  const wrapped = wrapText(c.fonts, [{ text }], st, width)
    .map((r) => r.text)
    .join('')
    .split('\n')
  if (wrapped.length <= max) return wrapped
  const lines = wrapped.slice(0, max)
  let last = `${lines[max - 1]!} ${wrapped.slice(max).join(' ')}`
  const w = (s: string) => layoutText(c.fonts, [{ text: s }], st).width
  while (last.length > 1 && w(`${last}…`) > width) last = last.slice(0, -1).trimEnd()
  lines[max - 1] = `${last}…`
  return lines
}

/** A block of text with its top-centre (or top-left) at (x, y). */
function textNode(
  c: Ctx,
  id: string,
  lines: readonly string[],
  st: TextStyle,
  color: string,
  x: number,
  y: number,
  anchor: 'middle' | 'start' = 'middle',
  halo = false,
): { node: SceneNode; h: number; w: number } {
  const layout = layoutText(c.fonts, [{ text: lines.join('\n') }], st, anchor)
  const left = anchor === 'middle' ? x - layout.width / 2 : x
  const h = layout.ascent + layout.descent
  return {
    node: {
      id,
      prim: {
        type: 'text',
        x: left,
        y: y + layout.ascent,
        layout,
        color,
        ...(halo ? { halo: { color: c.t.paper, width: 3 } } : {}),
      },
      bbox: { x: left, y, w: layout.width, h },
    },
    h,
    w: layout.width,
  }
}

const textHeight = (c: Ctx, lines: number, st: TextStyle) =>
  lines
    ? layoutText(c.fonts, [{ text: Array(lines).fill('X').join('\n') }], st).ascent +
      layoutText(c.fonts, [{ text: Array(lines).fill('X').join('\n') }], st).descent
    : 0

// ---- Glyphs --------------------------------------------------------------------------------

/** The small picture of what a box holds, centred at (cx, cy), 18 × 12 points. */
function glyph(kind: SchematicGlyph, cx: number, cy: number, color: string): Prim[] {
  const s = solid(color, 1)
  const fill = { color, opacity: 1 }
  const dot = (x: number, y: number): Prim => ({
    type: 'ellipse',
    cx: x,
    cy: y,
    rx: 1.3,
    ry: 1.3,
    stroke: null,
    fill,
  })
  const path = (d: PathCmd[], f = false): Prim => ({
    type: 'path',
    d,
    stroke: s,
    fill: f ? { color, opacity: 0.25 } : null,
  })
  const [l, r, t, b] = [cx - 9, cx + 9, cy - 6, cy + 6]
  switch (kind) {
    case 'mean':
      return [
        dot(cx - 6, cy + 3),
        dot(cx - 2, cy - 3),
        dot(cx + 2, cy + 2),
        dot(cx + 6, cy - 2),
        { type: 'line', x1: l, y1: cy, x2: r, y2: cy, stroke: solid(color, 1.4) },
      ]
    case 'ranks':
      return [0, 1, 2].map(
        (i): Prim => ({
          type: 'rect',
          x: l + 1 + i * 6,
          y: b - 4 * (i + 1),
          w: 4,
          h: 4 * (i + 1),
          stroke: null,
          fill,
        }),
      )
    case 'distribution':
      return [
        path([
          ['M', l, b],
          ['C', cx - 4, b, cx - 4, t, cx, t],
          ['C', cx + 4, t, cx + 4, b, r, b],
        ]),
      ]
    case 'proportion':
      return [
        { type: 'rect', x: l, y: cy - 3, w: 11, h: 6, stroke: null, fill },
        { type: 'rect', x: l, y: cy - 3, w: 18, h: 6, stroke: s, fill: null },
      ]
    case 'survival':
      return [
        {
          type: 'polyline',
          points: [
            [l, t],
            [l + 5, t],
            [l + 5, cy - 2],
            [l + 10, cy - 2],
            [l + 10, cy + 2],
            [l + 14, cy + 2],
            [l + 14, b - 1],
            [r, b - 1],
          ],
          stroke: s,
        },
      ]
    case 'curveUp':
    case 'curveDown': {
      const [y0, y1] = kind === 'curveUp' ? [b, t] : [t, b]
      return [
        path([
          ['M', l, y0],
          ['C', cx + 1, y0, cx - 1, y1, r, y1],
        ]),
      ]
    }
    case 'peak':
      return [
        path([
          ['M', l, b],
          ['C', cx - 3, b, cx - 3, t, cx, t],
          ['C', cx + 3, t, cx + 3, b, r, b],
        ]),
      ]
    case 'line':
      return [
        { type: 'line', x1: l, y1: b, x2: r, y2: t, stroke: solid(color, 1.2) },
        dot(cx - 4, cy + 4),
        dot(cx + 3, cy - 3),
      ]
    case 'scatter':
      return [dot(l + 2, b - 1), dot(cx - 3, cy + 2), dot(cx + 2, cy - 1), dot(r - 2, t + 1)]
    case 'area':
      return [
        path([['M', l, b], ['C', cx - 3, b - 12, cx + 3, t, r, cy], ['L', r, b], ['Z']], true),
      ]
    case 'summary':
      return [
        { type: 'line', x1: cx, y1: t, x2: cx, y2: b, stroke: s },
        {
          type: 'rect',
          x: cx - 5,
          y: cy - 3,
          w: 10,
          h: 6,
          stroke: s,
          fill: { color: '#000000', opacity: 0 },
        },
        { type: 'line', x1: cx - 5, y1: cy, x2: cx + 5, y2: cy, stroke: s },
      ]
    case 'none':
      return []
  }
}

// ---- Layout --------------------------------------------------------------------------------

interface Placed {
  box: SchematicBox
  x: number
  y: number
  w: number
  h: number
}

/** Levels for arcs over a row (or beside a column): narrow spans low, no two crossing on one. */
function levels(spans: { lo: number; hi: number; i: number }[]): Map<number, number> {
  const out = new Map<number, number>()
  const taken: { lo: number; hi: number; level: number }[] = []
  for (const s of [...spans].sort((p, q) => p.hi - p.lo - (q.hi - q.lo) || p.lo - q.lo)) {
    let level = 0
    while (taken.some((t) => t.level === level && s.lo < t.hi && t.lo < s.hi)) level++
    taken.push({ ...s, level })
    out.set(s.i, level)
  }
  return out
}

function heads(
  arrow: SchematicArrow,
  stroke: Stroke,
  start: [number, number, number, number],
  end: [number, number, number, number],
): Prim[] {
  const out: Prim[] = []
  const head = { shape: 'triangle' as const, size: 0.9 }
  const place = ([x, y, ux, uy]: [number, number, number, number]) => {
    const len = Math.hypot(ux, uy) || 1
    out.push(...arrowHead(head, x, y, ux / len, uy / len, stroke).prims)
  }
  if (arrow.heads === 'end' || arrow.heads === 'both') place(end)
  if (arrow.heads === 'both') place(start)
  return out
}

/** Where the line from `p`'s centre towards (tx, ty) leaves its box. */
function edgePoint(p: Placed, tx: number, ty: number): [number, number] {
  const cx = p.x + p.w / 2
  const cy = p.y + p.h / 2
  const dx = tx - cx
  const dy = ty - cy
  if (!dx && !dy) return [cx, cy]
  const sx = dx ? p.w / 2 / Math.abs(dx) : Number.POSITIVE_INFINITY
  const sy = dy ? p.h / 2 / Math.abs(dy) : Number.POSITIVE_INFINITY
  const k = Math.min(sx, sy)
  return [cx + dx * k, cy + dy * k]
}

/**
 * The schematic's scene: its width (points; wider when its boxes need it) and the theme's
 * colours. Boxes are placed by their row and column; a grid's headings name its levels.
 */
export function schematicScene(
  spec: SchematicSpec,
  fonts: FontRegistry,
  opts: { width?: number; theme?: 'light' | 'dark' } = {},
): Scene {
  const c: Ctx = { fonts, t: SCHEMATIC_THEMES[opts.theme ?? 'light'] }
  const { t } = c
  const nodes: SceneNode[] = []
  const boxes = spec.boxes
  const cols = boxes.reduce((m, b) => Math.max(m, b.column + 1), 0)
  const rows = boxes.reduce((m, b) => Math.max(m, b.row + 1), 0)
  const byId = new Map(boxes.map((b) => [b.id, b]))
  const grid = spec.grid

  // Columns: a grid's row headings at the left, then the boxes' columns.
  const straightAcross = spec.arrows.some((a) => {
    const [p, q] = [byId.get(a.from), byId.get(a.to)]
    return a.route === 'straight' && p && q && p.column !== q.column
  })
  const sideArcs = spec.arrows.some((a) => {
    const [p, q] = [byId.get(a.from), byId.get(a.to)]
    return a.route === 'arc' && p && q && p.row !== q.row && p.column === q.column
  })
  const gap = straightAcross ? WIDE_GAP : sideArcs ? GAP + 8 : GAP
  const rowHeadW = grid?.rowLevels.length
    ? Math.min(
        76,
        Math.max(
          ...grid.rowLevels.map((s) => layoutText(fonts, [{ text: s }], HEADING).width),
          grid.rows ? layoutText(fonts, [{ text: grid.rows }], FACTOR).width : 0,
        ) + 8,
      )
    : 0
  // Room for links beside a column (at the boxes' left) and arcs beside one (at their right).
  const sideLinks = spec.links.some((l) => {
    const rs = new Set(l.boxes.map((id) => byId.get(id)?.row))
    return rs.size > 1
  })
  const leftRoom = sideLinks ? 8 : 0
  const rightRoom = sideArcs ? 20 : 0
  const want = opts.width ?? SCHEMATIC_WIDTH
  const fixedW = rowHeadW + leftRoom + rightRoom + Math.max(0, cols - 1) * gap
  const bw = cols ? Math.max(BOX_MIN, Math.min(BOX_MAX, (want - 2 * PAD - fixedW) / cols)) : 0
  const gridW = fixedW + cols * bw
  const width = Math.max(want, 2 * PAD + gridW)
  const x0 = (width - gridW) / 2 + rowHeadW + leftRoom
  const colX = (k: number) => x0 + k * (bw + gap)

  // Each box's content and height.
  const inner = bw - 8
  const content = new Map(
    boxes.map((b) => {
      const label = fitLines(c, b.label, LABEL, inner, 2)
      const measure = fitLines(c, b.measure ?? '', MEASURE, inner, 2)
      const g = b.glyph && b.glyph !== 'none' ? GLYPH_H + 3 : 0
      const tag = b.role === 'control' ? textHeight(c, 1, MEASURE) + 1 : 0
      const members = b.members ? 9 + textHeight(c, 1, MEASURE) : 0
      const h =
        8 +
        tag +
        g +
        textHeight(c, label.length, LABEL) +
        (label.length && measure.length ? 2 : 0) +
        textHeight(c, measure.length, MEASURE) +
        members
      return [b.id, { label, measure, h: Math.max(grid ? 26 : 32, h) }] as const
    }),
  )

  // Arcs over rows (beside columns), their levels; lines under rows; links under rows.
  const arcsInRow = new Map<number, { lo: number; hi: number; i: number }[]>()
  const arcsInCol = new Map<number, { lo: number; hi: number; i: number }[]>()
  spec.arrows.forEach((a, i) => {
    const [p, q] = [byId.get(a.from), byId.get(a.to)]
    if (!p || !q || a.route !== 'arc') return
    if (p.row === q.row) {
      const l = arcsInRow.get(p.row) ?? []
      l.push({ lo: Math.min(p.column, q.column), hi: Math.max(p.column, q.column), i })
      arcsInRow.set(p.row, l)
    } else if (p.column === q.column) {
      const l = arcsInCol.get(p.column) ?? []
      l.push({ lo: Math.min(p.row, q.row), hi: Math.max(p.row, q.row), i })
      arcsInCol.set(p.column, l)
    }
  })
  const level = new Map<number, number>()
  for (const l of [...arcsInRow.values(), ...arcsInCol.values()])
    for (const [i, v] of levels(l)) level.set(i, v)
  const labelH = textHeight(c, 1, ARROW_LABEL)
  const above = (r: number) => {
    const l = arcsInRow.get(r) ?? []
    if (!l.length) return 0
    const top = Math.max(...l.map((s) => level.get(s.i) ?? 0))
    const labelled = l.some((s) => spec.arrows[s.i]!.label)
    return ARC_BASE + top * LEVEL_H + (labelled ? labelH + 3 : 0) + 4
  }
  const linkRows = new Set<number>()
  for (const link of spec.links) {
    const bs = link.boxes.map((id) => byId.get(id)).filter((b): b is SchematicBox => !!b)
    if (bs.length > 1 && bs.every((b) => b.row === bs[0]!.row)) linkRows.add(bs[0]!.row)
  }
  const belowArrows = new Map<number, number>()
  spec.arrows.forEach((a) => {
    const p = byId.get(a.from)
    if (p && a.route === 'below') belowArrows.set(p.row, (belowArrows.get(p.row) ?? 0) + 1)
  })
  const below = (r: number) =>
    (linkRows.has(r) ? 10 : 0) + (belowArrows.has(r) ? 10 + labelH + 2 : 0)

  // Rows from the top: the column factor and headings, then each row.
  let y = PAD
  if (grid?.columns) {
    const n = textNode(
      c,
      'factor/columns',
      [grid.columns],
      FACTOR,
      t.muted,
      x0 + (cols * bw + (cols - 1) * gap) / 2,
      y,
    )
    nodes.push(n.node)
    y += n.h + 2
  }
  if (grid?.columnLevels.length) {
    let h = 0
    grid.columnLevels.forEach((s, k) => {
      const n = textNode(
        c,
        `heading/column/${k}`,
        fitLines(c, s, HEADING, bw, 2),
        HEADING,
        t.ink,
        colX(k) + bw / 2,
        y,
      )
      nodes.push(n.node)
      h = Math.max(h, n.h)
    })
    y += h + 4
  }
  if (grid?.rows && rowHeadW) {
    const n = textNode(
      c,
      'factor/rows',
      [grid.rows],
      FACTOR,
      t.muted,
      x0 - leftRoom - rowHeadW,
      y,
      'start',
    )
    nodes.push(n.node)
    y += grid.columnLevels.length ? 0 : n.h + 2
  }
  const placed = new Map<string, Placed>()
  const rowTop: number[] = []
  const rowBottom: number[] = []
  for (let r = 0; r < rows; r++) {
    y += above(r)
    const inRow = boxes.filter((b) => b.row === r)
    const h = Math.max(0, ...inRow.map((b) => content.get(b.id)!.h))
    // A predictor column's outcome sits across the rows it is centred on (its own height).
    for (const b of inRow) placed.set(b.id, { box: b, x: colX(b.column), y, w: bw, h })
    rowTop[r] = y
    rowBottom[r] = y + h
    if (grid && r < grid.rowLevels.length && rowHeadW) {
      const lines = fitLines(c, grid.rowLevels[r]!, HEADING, rowHeadW - 6, 2)
      const n = textNode(
        c,
        `heading/row/${r}`,
        lines,
        HEADING,
        t.ink,
        x0 - leftRoom - rowHeadW,
        y + h / 2 - textHeight(c, lines.length, HEADING) / 2,
        'start',
      )
      nodes.push(n.node)
    }
    y += h + below(r) + (r < rows - 1 ? 8 : 0)
  }

  // Boxes.
  for (const p of placed.values()) {
    const b = p.box
    const k = content.get(b.id)!
    const control = b.role === 'control'
    const dashed = b.role === 'reference' || b.role === 'more'
    const children: SceneNode[] = [
      {
        id: `box/${b.id}/frame`,
        prim: {
          type: 'rect',
          x: p.x,
          y: p.y,
          w: p.w,
          h: p.h,
          rx: 4,
          stroke: {
            color: control ? t.controlEdge : t.boxEdge,
            width: control ? 1.6 : 1,
            dash: dashed ? 'dash' : 'solid',
          },
          fill: dashed ? null : { color: control ? t.control : t.box, opacity: 1 },
        },
      },
    ]
    const cx = p.x + p.w / 2
    let ty = p.y + 4
    if (control) {
      const n = textNode(c, `box/${b.id}/tag`, ['control'], MEASURE, t.controlEdge, cx, ty)
      children.push(n.node)
      ty += n.h + 1
    }
    if (b.glyph && b.glyph !== 'none') {
      children.push(
        ...glyph(b.glyph, cx, ty + GLYPH_H / 2, t.glyph).map((prim, i) => ({
          id: `box/${b.id}/glyph/${i}`,
          prim,
        })),
      )
      ty += GLYPH_H + 3
    }
    if (k.label.length) {
      const n = textNode(
        c,
        `box/${b.id}/label`,
        k.label,
        LABEL,
        b.role === 'more' ? t.muted : t.ink,
        cx,
        ty,
      )
      children.push(n.node)
      ty += n.h + 2
    }
    if (k.measure.length) {
      const n = textNode(c, `box/${b.id}/measure`, k.measure, MEASURE, t.muted, cx, ty)
      children.push(n.node)
      ty += n.h
    }
    if (b.members) {
      const shown = Math.min(b.members.count, 8)
      const span = (shown - 1) * 6
      const my = p.y + p.h - 6 - textHeight(c, 1, MEASURE) - 4
      for (let i = 0; i < shown; i++)
        children.push({
          id: `box/${b.id}/member/${i}`,
          prim: {
            type: 'ellipse',
            cx: cx - span / 2 + i * 6,
            cy: my,
            rx: 2,
            ry: 2,
            stroke: solid(t.glyph, 0.8),
            fill: null,
          },
        })
      children.push(
        textNode(c, `box/${b.id}/members`, [b.members.label], MEASURE, t.muted, cx, my + 4).node,
      )
    }
    nodes.push({ id: `box/${b.id}`, children, bbox: { x: p.x, y: p.y, w: p.w, h: p.h } })
  }

  // Links: a line under a row's boxes, or beside a column's, with a dot at each box.
  const linkStroke = solid(t.link, 1.2)
  spec.links.forEach((link, i) => {
    const ps = link.boxes.map((id) => placed.get(id)).filter((p): p is Placed => !!p)
    if (ps.length < 2) return
    const children: SceneNode[] = []
    const horizontal = ps.every((p) => p.box.row === ps[0]!.box.row)
    if (horizontal) {
      const ly = ps[0]!.y + ps[0]!.h + 6
      const xs = ps.map((p) => p.x + p.w / 2)
      children.push({
        id: `link/${i}/line`,
        prim: {
          type: 'line',
          x1: Math.min(...xs),
          y1: ly,
          x2: Math.max(...xs),
          y2: ly,
          stroke: linkStroke,
        },
      })
      for (const [k, x] of xs.entries()) {
        children.push({
          id: `link/${i}/tick/${k}`,
          prim: { type: 'line', x1: x, y1: ly - 6, x2: x, y2: ly, stroke: linkStroke },
        })
        children.push({
          id: `link/${i}/dot/${k}`,
          prim: {
            type: 'ellipse',
            cx: x,
            cy: ly,
            rx: 2,
            ry: 2,
            stroke: null,
            fill: { color: t.link, opacity: 1 },
          },
        })
      }
    } else {
      const lx = Math.min(...ps.map((p) => p.x)) - 4
      const ys = ps.map((p) => p.y + p.h / 2)
      children.push({
        id: `link/${i}/line`,
        prim: {
          type: 'line',
          x1: lx,
          y1: Math.min(...ys),
          x2: lx,
          y2: Math.max(...ys),
          stroke: linkStroke,
        },
      })
      for (const [k, yy] of ys.entries())
        children.push({
          id: `link/${i}/dot/${k}`,
          prim: {
            type: 'ellipse',
            cx: lx,
            cy: yy,
            rx: 2,
            ry: 2,
            stroke: null,
            fill: { color: t.link, opacity: 1 },
          },
        })
    }
    nodes.push({ id: `link/${i}`, children })
  })

  // Arrows.
  const arrowStroke = solid(t.arrow, 1.2)
  spec.arrows.forEach((a, i) => {
    const [p, q] = [placed.get(a.from), placed.get(a.to)]
    if (!p || !q) return
    const children: SceneNode[] = []
    const lv = level.get(i) ?? 0
    let labelAt: [number, number, 'above' | 'below' | 'right'] | null = null
    if (a.route === 'arc' && p.box.row === q.box.row) {
      const dir = q.x > p.x ? 1 : -1
      const off = 7 + lv * 7
      const x1 = p.x + p.w / 2 + dir * off
      const x2 = q.x + q.w / 2 - dir * off
      const top = Math.min(p.y, q.y)
      const h = ARC_BASE + lv * LEVEL_H
      const k = h * 1.333
      const d: PathCmd[] = [
        ['M', x1, top],
        ['C', x1, top - k, x2, top - k, x2, top],
      ]
      children.push({
        id: `arrow/${i}/line`,
        prim: { type: 'path', d, stroke: arrowStroke, fill: null },
      })
      children.push(
        ...heads(a, arrowStroke, [x1, top, 0, 1], [x2, top, 0, 1]).map((prim, j) => ({
          id: `arrow/${i}/head/${j}`,
          prim,
        })),
      )
      labelAt = [(x1 + x2) / 2, top - h - 2, 'above']
    } else if (a.route === 'arc' && p.box.column === q.box.column) {
      const right = p.x + p.w
      const [y1, y2] = [p.y + p.h / 2 + (q.y > p.y ? 3 : -3), q.y + q.h / 2 + (q.y > p.y ? -3 : 3)]
      const k = (6 + lv * 5) * 1.333
      const d: PathCmd[] = [
        ['M', right, y1],
        ['C', right + k, y1, right + k, y2, right, y2],
      ]
      children.push({
        id: `arrow/${i}/line`,
        prim: { type: 'path', d, stroke: arrowStroke, fill: null },
      })
      children.push(
        ...heads(a, arrowStroke, [right, y1, -1, 0], [right, y2, -1, 0]).map((prim, j) => ({
          id: `arrow/${i}/head/${j}`,
          prim,
        })),
      )
      labelAt = [right + k * 0.75 + 2, (y1 + y2) / 2, 'right']
    } else if (a.route === 'below') {
      const r = p.box.row
      const ly = rowBottom[r]! + (linkRows.has(r) ? 10 : 0) + 6
      const x1 = p.x + p.w / 2
      const x2 = q.x + q.w / 2
      children.push({
        id: `arrow/${i}/line`,
        prim: { type: 'line', x1, y1: ly, x2, y2: ly, stroke: arrowStroke },
      })
      for (const [k, x] of [x1, x2].entries())
        children.push({
          id: `arrow/${i}/tick/${k}`,
          prim: { type: 'line', x1: x, y1: ly - 4, x2: x, y2: ly, stroke: arrowStroke },
        })
      const dx = x2 - x1 || 1
      children.push(
        ...heads(a, arrowStroke, [x1, ly, -dx, 0], [x2, ly, dx, 0]).map((prim, j) => ({
          id: `arrow/${i}/head/${j}`,
          prim,
        })),
      )
      labelAt = [(x1 + x2) / 2, ly + 2, 'below']
    } else {
      const [qx, qy] = [q.x + q.w / 2, q.y + q.h / 2]
      const [px, py] = [p.x + p.w / 2, p.y + p.h / 2]
      const [sx, sy] = edgePoint(p, qx, qy)
      const [ex, ey] = edgePoint(q, px, py)
      children.push({
        id: `arrow/${i}/line`,
        prim: { type: 'line', x1: sx, y1: sy, x2: ex, y2: ey, stroke: arrowStroke },
      })
      children.push(
        ...heads(a, arrowStroke, [sx, sy, sx - ex, sy - ey], [ex, ey, ex - sx, ey - sy]).map(
          (prim, j) => ({ id: `arrow/${i}/head/${j}`, prim }),
        ),
      )
      labelAt = [(sx + ex) / 2, (sy + ey) / 2 - labelH - 1, 'above']
    }
    if (a.label && labelAt) {
      const [lx, ly, where] = labelAt
      const n =
        where === 'right'
          ? textNode(
              c,
              `arrow/${i}/label`,
              [a.label],
              ARROW_LABEL,
              t.arrow,
              lx,
              ly - labelH / 2,
              'start',
              true,
            )
          : textNode(
              c,
              `arrow/${i}/label`,
              [a.label],
              ARROW_LABEL,
              t.arrow,
              lx,
              where === 'above' ? ly - labelH : ly,
              'middle',
              true,
            )
      children.push(n.node)
    }
    nodes.push({ id: `arrow/${i}`, children })
  })

  // The links' legend.
  if (spec.links.length) {
    y += 6
    const label = spec.links[0]!.label ?? 'same subjects'
    const lx = PAD + 2
    nodes.push({
      id: 'legend/link',
      children: [
        {
          id: 'legend/link/line',
          prim: { type: 'line', x1: lx, y1: y + 5, x2: lx + 16, y2: y + 5, stroke: linkStroke },
        },
        {
          id: 'legend/link/dot',
          prim: {
            type: 'ellipse',
            cx: lx + 8,
            cy: y + 5,
            rx: 2,
            ry: 2,
            stroke: null,
            fill: { color: t.link, opacity: 1 },
          },
        },
        textNode(c, 'legend/link/label', [label], MEASURE, t.muted, lx + 22, y, 'start').node,
      ],
    })
    y += textHeight(c, 1, MEASURE)
  }
  const height = Math.max(y + PAD, rows ? 0 : 2 * PAD)
  const root: SceneNode = { id: 'schematic', children: nodes }
  return {
    width,
    height,
    root,
    plot: { x: 0, y: 0, w: width, h: height } satisfies Box,
    warnings: [],
  }
}
