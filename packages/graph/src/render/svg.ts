import type { FontId } from '@ps/model'
import { FONTS } from '../fonts/manifest.ts'
import { assetDataUrl } from '../image.ts'
import {
  dashArray,
  type Fill,
  type Prim,
  pathData,
  type Scene,
  type SceneNode,
  type Stroke,
  symbolPath,
  transformAttr,
} from '../scene.ts'
import { cloudPointFinite, droppedNonFinite, finiteNumber, primFinite } from './finite.ts'

/**
 * Font stacks: our bundled face first (matched by the app's @font-face rules), then the installed
 * Liberation font, then its metric-compatible commercial equivalent, so exported SVGs render with
 * identical line breaks and widths in Illustrator/Inkscape/browsers.
 */
export const FONT_STACKS = {
  sans: `'${FONTS.sans.cssFamily}', 'Liberation Sans', Arial, Helvetica, sans-serif`,
  serif: `'${FONTS.serif.cssFamily}', 'Liberation Serif', 'Times New Roman', Times, serif`,
  mono: `'${FONTS.mono.cssFamily}', 'Liberation Mono', 'Courier New', Courier, monospace`,
  narrow: `'${FONTS.narrow.cssFamily}', 'Liberation Sans Narrow', 'Arial Narrow', sans-serif`,
} as const

/**
 * The stacks without the app's own @font-face family (which only the app defines): for SVGs read
 * elsewhere (exported files, the clipboard), so Illustrator, Word or Inkscape meet the installed
 * Liberation font first, then its metric-compatible equivalent.
 */
export const PORTABLE_FONT_STACKS = {
  sans: `'Liberation Sans', Arial, Helvetica, sans-serif`,
  serif: `'Liberation Serif', 'Times New Roman', Times, serif`,
  mono: `'Liberation Mono', 'Courier New', Courier, monospace`,
  narrow: `'Liberation Sans Narrow', 'Arial Narrow', sans-serif`,
} as const

type FontStacks = Readonly<Record<FontId, string>>

const n = finiteNumber

/**
 * Escapes for XML, dropping control characters XML 1.0 forbids (they make the file invalid) and
 * half characters (a lone UTF-16 surrogate: the file could not be encoded; audit 4 G5).
 */
const esc = (s: string) =>
  s
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

function strokeAttrs(s: Stroke | null): string {
  if (!s || s.width <= 0) return ' stroke="none"'
  const dash = dashArray(s)
  return ` stroke="${s.color}" stroke-width="${n(s.width)}"${dash ? ` stroke-dasharray="${dash}"` : ''}`
}

function fillAttrs(f: Fill | null): string {
  if (!f) return ' fill="none"'
  return ` fill="${f.color}"${f.opacity < 1 ? ` fill-opacity="${n(f.opacity)}"` : ''}`
}

/**
 * An image as a nested SVG whose viewBox is the part shown (the crop, in the image's pixels), so
 * the crop is clipped by the viewport and the picture stretched to the box, in every renderer
 * (browsers, Illustrator, Inkscape). `xlink:href` (declared here) for older readers.
 */
export function imageSvg(p: Extract<Prim, { type: 'image' }>, href: string): string {
  const { width: W, height: H } = p.asset
  const c = p.crop ?? { x: 0, y: 0, w: 1, h: 1 }
  return `<svg xmlns:xlink="http://www.w3.org/1999/xlink" x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" viewBox="${n(c.x * W)} ${n(c.y * H)} ${n(c.w * W)} ${n(c.h * H)}" preserveAspectRatio="none" overflow="hidden"><image width="${W}" height="${H}" preserveAspectRatio="none" xlink:href="${href}"/></svg>`
}

function primToSvg(p: Prim, fonts: FontStacks): string {
  switch (p.type) {
    case 'line':
      return `<line x1="${n(p.x1)}" y1="${n(p.y1)}" x2="${n(p.x2)}" y2="${n(p.y2)}"${strokeAttrs(p.stroke)} stroke-linecap="square"/>`
    case 'polyline':
      return `<polyline points="${p.points.map(([x, y]) => `${n(x)},${n(y)}`).join(' ')}" fill="none"${strokeAttrs(p.stroke)} stroke-linejoin="miter"/>`
    case 'polygon':
      return `<polygon points="${p.points.map(([x, y]) => `${n(x)},${n(y)}`).join(' ')}"${fillAttrs(p.fill)}${strokeAttrs(p.stroke)}/>`
    case 'rect': {
      const r = p.rx ? Math.min(p.rx, p.w / 2, p.h / 2) : 0
      return `<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}"${r > 0 ? ` rx="${n(r)}"` : ''}${fillAttrs(p.fill)}${strokeAttrs(p.stroke)}/>`
    }
    case 'ellipse':
      return `<ellipse cx="${n(p.cx)}" cy="${n(p.cy)}" rx="${n(p.rx)}" ry="${n(p.ry)}"${fillAttrs(p.fill)}${strokeAttrs(p.stroke)}/>`
    case 'path':
      return `<path d="${pathData(p.d)}"${fillAttrs(p.fill)}${strokeAttrs(p.stroke)} stroke-linejoin="miter"/>`
    case 'image':
      return imageSvg(p, assetDataUrl(p.asset))
    case 'symbol':
      return `<path d="${symbolPath(p.shape, p.cx, p.cy, p.size)}"${fillAttrs(p.fill)}${strokeAttrs(p.stroke)}/>`
    case 'points':
      return pointsToSvg(p)
    case 'text': {
      const transform = p.rotate
        ? ` transform="rotate(${n(p.rotate.angle)} ${n(p.rotate.cx)} ${n(p.rotate.cy)})"`
        : ''
      const spans = p.layout.runs
        .map(
          (r) =>
            `<tspan x="${n(p.x + r.x)}" y="${n(p.y + r.dy)}" font-family="${fonts[r.font]}" font-size="${n(r.size)}"${r.bold ? ' font-weight="bold"' : ''}${r.italic ? ' font-style="italic"' : ''}${r.fill ? ` fill="${r.fill}"` : ''}>${esc(r.text)}</tspan>`,
        )
        .join('')
      // Underlines as filled rects, turned with the text.
      const lines = (p.layout.underlines ?? [])
        .map(
          (u) =>
            `<rect x="${n(p.x + u.x)}" y="${n(p.y + u.y)}" width="${n(u.w)}" height="${n(u.h)}" fill="${u.fill ?? p.color}"${transform}/>`,
        )
        .join('')
      const halo = p.halo
        ? ` stroke="${p.halo.color}" stroke-width="${n(p.halo.width)}" stroke-linejoin="round" paint-order="stroke"`
        : ''
      return `<text fill="${p.color}"${halo}${transform} xml:space="preserve">${spans}</text>${lines}`
    }
  }
}

/**
 * A point cloud as the symbols it holds, in drawing order: exactly what a symbol node per point
 * writes (roadmap 34e), so a cloud exports as vectors byte for byte as before.
 */
function pointsToSvg(p: Extract<Prim, { type: 'points' }>): string {
  const paints = p.paints.map((q) => ({
    shape: q.shape,
    attrs: fillAttrs(q.fill) + strokeAttrs(q.stroke),
  }))
  const out: string[] = []
  for (let i = 0; i < p.n; i++) {
    if (!cloudPointFinite(p, i)) continue
    const q = paints[p.paint[i]!]!
    out.push(`<path d="${symbolPath(q.shape, p.x[i]!, p.y[i]!, p.size[i]!)}"${q.attrs}/>`)
  }
  return out.join('\n')
}

function nodeToSvg(node: SceneNode, out: string[], withIds: boolean, fonts: FontStacks) {
  const hasChildren = !!node.children?.length
  if (!node.prim && !hasChildren) return
  const t = node.transform ? ` transform="${transformAttr(node.transform)}"` : ''
  const open =
    withIds && (hasChildren || node.prim)
      ? `<g data-id="${esc(node.id)}"${t}>`
      : hasChildren || t
        ? `<g${t}>`
        : ''
  if (open) out.push(open)
  if (node.prim) {
    if (primFinite(node.prim)) out.push(primToSvg(node.prim, fonts))
    else droppedNonFinite(node.prim, 'SVG')
  }
  for (const c of node.children ?? []) nodeToSvg(c, out, withIds, fonts)
  if (open) out.push('</g>')
}

export interface SvgOptions {
  /** Emit data-id attributes for debugging and tests. */
  ids?: boolean
  /** Background colour; omitted = transparent. */
  background?: string
  /** Extra CSS, e.g. inlined @font-face rules for rasterizing through an <img>. */
  css?: string
  /**
   * Font stacks without the app's own family names (`PORTABLE_FONT_STACKS`), for SVGs used
   * outside the app; default the app's stacks (its @font-face names first).
   */
  portableFonts?: boolean
  /**
   * Draw only this part of the scene (points), at this size in pixels: a tile of a large image
   * rendered piece by piece. Default: the whole scene, sized in points.
   */
  frame?: { x: number; y: number; w: number; h: number; pxWidth: number; pxHeight: number }
}

/** Standalone SVG with physical size in points, suitable for export. */
export function sceneToSvg(scene: Scene, opts: SvgOptions = {}): string {
  const body: string[] = []
  if (opts.css) body.push(`<defs><style>${opts.css}</style></defs>`)
  if (opts.background) {
    body.push(
      `<rect x="0" y="0" width="${n(scene.width)}" height="${n(scene.height)}" fill="${opts.background}"/>`,
    )
  }
  nodeToSvg(
    scene.root,
    body,
    opts.ids ?? false,
    opts.portableFonts ? PORTABLE_FONT_STACKS : FONT_STACKS,
  )
  const f = opts.frame
  return [
    f
      ? `<svg xmlns="http://www.w3.org/2000/svg" width="${f.pxWidth}" height="${f.pxHeight}" viewBox="${n(f.x)} ${n(f.y)} ${n(f.w)} ${n(f.h)}" preserveAspectRatio="none">`
      : `<svg xmlns="http://www.w3.org/2000/svg" width="${n(scene.width)}pt" height="${n(scene.height)}pt" viewBox="0 0 ${n(scene.width)} ${n(scene.height)}">`,
    ...body,
    '</svg>',
  ].join('\n')
}
