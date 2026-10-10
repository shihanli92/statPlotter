import type { ColorRef, RichText, TextAlign, TextStyle } from '@ps/model'
import type { FontRegistry } from '../fonts/registry.ts'
import { type Box, pointsBounds, type SceneNode, type StylePath } from '../scene.ts'
import { type LineAlign, layoutText, type TextLayout } from '../text/layout.ts'
import { resolveColor } from '../theme.ts'

export type HAnchor = 'start' | 'middle' | 'end'

/** A text box's line alignment (absent: left) as a layout alignment. */
export const lineAlign = (a: TextAlign | undefined): LineAlign =>
  a === 'center' ? 'middle' : a === 'right' ? 'end' : 'start'
export type VAnchor = 'baseline' | 'middle' | 'top' | 'bottom'

export interface PlacedText {
  node: SceneNode
  layout: TextLayout
  bbox: Box
}

/** Rotates the four corners of a box about (cx, cy) and returns their bounds. */
function rotatedBounds(b: Box, angle: number, cx: number, cy: number): Box {
  const r = (angle * Math.PI) / 180
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  const corners: [number, number][] = [
    [b.x, b.y],
    [b.x + b.w, b.y],
    [b.x, b.y + b.h],
    [b.x + b.w, b.y + b.h],
  ]
  return pointsBounds(
    corners.map(([x, y]) => [
      cx + (x - cx) * cos - (y - cy) * sin,
      cy + (x - cx) * sin + (y - cy) * cos,
    ]),
  )!
}

/**
 * The layout with its runs' and underlines' own colours resolved (`fill`), where they differ from
 * the text's `color` (a run coloured "the series' colour" takes the text's).
 */
function paintRuns(layout: TextLayout, palette: readonly string[], color: string): TextLayout {
  const painted = <T extends { color?: ColorRef }>(o: T): T => {
    const fill = o.color && resolveColor(o.color, palette, color)
    return fill && fill !== color ? { ...o, fill } : o
  }
  if (!layout.runs.some((r) => r.color)) return layout
  return {
    ...layout,
    runs: layout.runs.map(painted),
    ...(layout.underlines ? { underlines: layout.underlines.map(painted) } : {}),
  }
}

/**
 * Lays out text anchored at (x, y) and optionally rotated about that anchor point. Returns a
 * scene node with a text primitive whose runs are positioned exactly as measured. The lines of
 * multi-line text line up by `align`, else by the horizontal anchor (centred titles).
 */
export function placeText(
  fonts: FontRegistry,
  id: string,
  content: RichText,
  style: TextStyle,
  palette: readonly string[],
  x: number,
  y: number,
  h: HAnchor,
  v: VAnchor,
  opts: { angle?: number; target?: StylePath; align?: LineAlign } = {},
): PlacedText {
  const color = resolveColor(style.color, palette)
  const layout = paintRuns(layoutText(fonts, content, style, opts.align ?? h), palette, color)
  const left = h === 'start' ? x : h === 'middle' ? x - layout.width / 2 : x - layout.width
  const baseline =
    v === 'baseline'
      ? y
      : v === 'top'
        ? y + layout.ascent
        : v === 'bottom'
          ? y - layout.descent
          : y + (layout.ascent - layout.descent) / 2
  const unrotated: Box = {
    x: left,
    y: baseline - layout.ascent,
    w: layout.width,
    h: layout.ascent + layout.descent,
  }
  const angle = opts.angle ?? 0
  const bbox = angle ? rotatedBounds(unrotated, angle, x, y) : unrotated
  const node: SceneNode = {
    id,
    target: opts.target,
    prim: {
      type: 'text',
      x: left,
      y: baseline,
      layout,
      color,
      rotate: angle ? { angle, cx: x, cy: y } : undefined,
    },
    bbox,
  }
  return { node, layout, bbox }
}
