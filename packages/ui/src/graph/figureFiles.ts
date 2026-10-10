import {
  browserFontLoader,
  FONT_VARIANTS,
  FONTS,
  type FontBytesLoader,
  type FontRegistry,
  pngWriter,
  type RasterWriter,
  type Scene,
  type SceneNode,
  sceneToPdf,
  sceneToSvg,
  tiffWriter,
} from '@ps/graph'
import type { FontId } from '@ps/model'

// Figure files (roadmap 27): SVG and PDF from the scene; PNG / TIFF / JPEG drawn by the browser
// from SVGs of the scene (the bundled fonts inlined) and encoded here with their resolution.
// Large images are rendered in tiles no browser refuses (Safari caps a canvas at 16.7 million
// pixels) and encoded band by band, so a double-column figure at 1200 dpi fits. Nothing here
// touches the DOM: the export worker (roadmap 42) makes the files, and the tiles' SVGs, with the
// same code the main thread uses where there is no worker (`exportGraph.ts` draws the tiles).

export const WHITE = '#ffffff'

const embeddedCss = new Map<FontId, Promise<string>>()

function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/** A family's @font-face rules with its four faces inlined. */
function familyCss(id: FontId, load: FontBytesLoader): Promise<string> {
  const family = FONTS[id]
  let css = embeddedCss.get(id)
  if (!css) {
    css = Promise.all(
      FONT_VARIANTS.map(async (variant) => {
        const bytes = await load(family.files[variant])
        const bold = variant === 'bold' || variant === 'boldItalic'
        const italic = variant === 'italic' || variant === 'boldItalic'
        return `@font-face{font-family:'${family.cssFamily}';src:url(data:font/ttf;base64,${toBase64(bytes)}) format('truetype');font-weight:${bold ? 700 : 400};font-style:${italic ? 'italic' : 'normal'}}`
      }),
    ).then((rules) => rules.join('\n'))
    // A failed load is tried again next time.
    css.catch(() => embeddedCss.delete(id))
    embeddedCss.set(id, css)
  }
  return css
}

/** The font families a scene's text uses. */
function sceneFonts(node: SceneNode, out = new Set<FontId>()): Set<FontId> {
  if (node.prim?.type === 'text') for (const r of node.prim.layout.runs) out.add(r.font)
  for (const c of node.children ?? []) sceneFonts(c, out)
  return out
}

/**
 * @font-face rules with the bundled fonts inlined, for SVGs rasterized via <img>: only the
 * families the scene uses (each is 0.5–1.6 MB).
 */
export const fontCss = async (
  scene: Scene,
  load: FontBytesLoader = browserFontLoader,
): Promise<string> =>
  (await Promise.all([...sceneFonts(scene.root)].map((id) => familyCss(id, load)))).join('\n')

/**
 * The SVG of an export or a copy: white background (none when transparent), size in points,
 * text as text in fonts other applications know by name (Liberation, then Arial / Times New
 * Roman: metric-compatible).
 */
export const exportSvg = (scene: Scene, opts: { transparent?: boolean } = {}) =>
  sceneToSvg(scene, { ...(opts.transparent ? {} : { background: WHITE }), portableFonts: true })

/** The vector PDF of an export or a copy (fonts embedded as subsets); dated now unless told. */
export const exportPdf = (
  scene: Scene,
  fonts: FontRegistry,
  opts: { transparent?: boolean; title?: string; date?: Date } = {},
) =>
  sceneToPdf(scene, fonts, {
    ...(opts.transparent ? {} : { background: WHITE }),
    ...(opts.title ? { title: opts.title } : {}),
    date: opts.date ?? new Date(),
  })

/** The SVG File › Print… puts in the page: the app's own font names (the page has the fonts). */
export const printSvg = (scene: Scene) => sceneToSvg(scene, { background: WHITE })

// ---- Images -------------------------------------------------------------------------------------

/** Largest image written, in pixels (PNG and TIFF, rendered in tiles): 400 MB of RGBA at most. */
const MAX_IMAGE_PIXELS = 100_000_000
/** And per side (what image readers commonly take). */
const MAX_IMAGE_SIDE = 32_767
/** JPEG comes from one canvas, so Safari's canvas limit applies: 16.7 million pixels… */
const MAX_CANVAS_PIXELS = 16_777_216
/** …and at most this many a side. */
const MAX_CANVAS_SIDE = 16_384

export type ImageFormat = 'png' | 'tiff' | 'jpeg'

/** Transparency is possible (JPEG has none). */
export const canBeTransparent = (f: string) => f !== 'jpeg'

/** An image's size in pixels at `dpi` (1 pt = 1/72 in). */
export const imageSize = (scene: { width: number; height: number }, dpi: number) => ({
  w: Math.max(1, Math.round((scene.width * dpi) / 72)),
  h: Math.max(1, Math.round((scene.height * dpi) / 72)),
})

/** Why an image of this size can't be made, or null when it can. */
export function imageTooLarge(format: ImageFormat, w: number, h: number): string | null {
  const [pixels, side] =
    format === 'jpeg' ? [MAX_CANVAS_PIXELS, MAX_CANVAS_SIDE] : [MAX_IMAGE_PIXELS, MAX_IMAGE_SIDE]
  if (w * h <= pixels && Math.max(w, h) <= side) return null
  const mp = (pixels / 1e6).toFixed(1).replace(/\.0$/, '')
  return format === 'jpeg'
    ? `JPEG images are limited to ${mp} million pixels (${side.toLocaleString('en-US')} a side, the browser’s limit for one canvas). Lower the resolution or the size, or use PNG or TIFF.`
    : `Images are limited to ${mp} million pixels (${side.toLocaleString('en-US')} a side). Lower the resolution or the size.`
}

/** Rows rendered at a time: at most this many pixels (64 MB of RGBA), 4096 rows. */
const BAND_PIXELS = 16_777_216
const TILE_SIDE = 4096

/** A tile of an image, in pixels: drawn from its own SVG. */
export interface RasterTile {
  x: number
  y: number
  w: number
  h: number
}

/** An image to draw: its size, its tiles in drawing order and, for each, the SVG to draw. */
export interface RasterPlan {
  w: number
  h: number
  tiles: RasterTile[]
}

/**
 * A PNG or TIFF being made: the tiles' SVGs (of that part of the scene, fonts inlined), and their
 * pixels put back in order, band by band into the writer. The tiles of a band are as wide as the
 * image together; a band is written when its last tile is in.
 */
export class RasterJob implements RasterPlan {
  readonly w: number
  readonly h: number
  readonly tiles: RasterTile[] = []
  private readonly writer: RasterWriter
  private readonly kx: number
  private readonly ky: number
  private band: Uint8Array | null = null
  private next = 0

  constructor(
    private readonly scene: Scene,
    private readonly opts: { dpi: number; transparent: boolean; css: string },
    make: (w: number, h: number) => RasterWriter,
  ) {
    const { w, h } = imageSize(scene, opts.dpi)
    const tooLarge = imageTooLarge('png', w, h)
    if (tooLarge) throw new Error(tooLarge)
    this.w = w
    this.h = h
    this.writer = make(w, h)
    // Points per pixel on each axis (rounding the pixel size makes them differ slightly).
    this.kx = scene.width / w
    this.ky = scene.height / h
    const bandRows = Math.max(1, Math.min(h, TILE_SIDE, Math.floor(BAND_PIXELS / w)))
    for (let y = 0; y < h; y += bandRows) {
      const bh = Math.min(bandRows, h - y)
      for (let x = 0; x < w; x += TILE_SIDE)
        this.tiles.push({ x, y, w: Math.min(TILE_SIDE, w - x), h: bh })
    }
  }

  /** The SVG of tile `i`, sized in pixels. */
  svg(i: number): string {
    const t = this.tiles[i]!
    const { kx, ky } = this
    const frame = {
      x: t.x * kx,
      y: t.y * ky,
      w: t.w * kx,
      h: t.h * ky,
      pxWidth: t.w,
      pxHeight: t.h,
    }
    return sceneToSvg(this.scene, {
      ...(this.opts.transparent ? {} : { background: WHITE }),
      css: this.opts.css,
      frame,
    })
  }

  /**
   * Tile `i`'s pixels (RGBA, its rows in order), the tiles in order. Returns the fraction of the
   * image written when this completes a band, else null.
   */
  put(i: number, rgba: Uint8Array | Uint8ClampedArray): number | null {
    if (i !== this.next) throw new Error(`tile ${i} out of order (expected ${this.next})`)
    this.next++
    const t = this.tiles[i]!
    const { w } = this
    if (t.x === 0) this.band = new Uint8Array(w * t.h * 4)
    const band = this.band!
    for (let r = 0; r < t.h; r++)
      band.set(rgba.subarray(r * t.w * 4, (r + 1) * t.w * 4), (r * w + t.x) * 4)
    if (t.x + t.w < w) return null
    this.writer.write(band)
    this.band = null
    return (t.y + t.h) / this.h
  }

  /** The file, once every tile is in. */
  finish(): Uint8Array {
    if (this.next !== this.tiles.length) throw new Error('the image is not complete')
    return this.writer.finish()
  }
}

/** A PNG (`alpha` when transparent) or TIFF job for `scene` at `dpi`. */
export const rasterJob = (
  scene: Scene,
  format: 'png' | 'tiff',
  opts: { dpi: number; transparent: boolean; css: string },
) =>
  new RasterJob(scene, opts, (w, h) =>
    (format === 'png' ? pngWriter : tiffWriter)(w, h, { alpha: opts.transparent, dpi: opts.dpi }),
  )

/** A JPEG's one SVG (on white, JPEG has no transparency) at `dpi`, sized in pixels. */
export function jpegSvg(
  scene: Scene,
  dpi: number,
  css: string,
): { w: number; h: number; svg: string } {
  const { w, h } = imageSize(scene, dpi)
  const tooLarge = imageTooLarge('jpeg', w, h)
  if (tooLarge) throw new Error(tooLarge)
  const svg = sceneToSvg(scene, {
    background: WHITE,
    css,
    frame: { x: 0, y: 0, w: scene.width, h: scene.height, pxWidth: w, pxHeight: h },
  })
  return { w, h, svg }
}
