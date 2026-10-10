import type { FontId, ImageAsset } from '@ps/model'
import { zlibSync } from 'fflate'
import type * as fontkit from 'fontkit'
import { variantOf } from '../fonts/manifest.ts'
import type { FontRegistry } from '../fonts/registry.ts'
import { imageInfo } from '../image.ts'
import {
  dashArray,
  type Fill,
  OPEN_SHAPES,
  type PathCmd,
  type Prim,
  roundedRectPath,
  type Scene,
  type SceneNode,
  type Stroke,
} from '../scene.ts'
import { cloudPointFinite, droppedNonFinite, finiteNumber, primFinite } from './finite.ts'
import { decodePng } from './png.ts'

// Vector PDF straight from the scene (roadmap 27), on the web and in the desktop app alike: the
// scene's paths, strokes and fills with the SVG's colours, widths, dashes, caps and joins, and
// text as real text in the bundled fonts, embedded as TrueType subsets (CIDFontType2, Identity-H)
// with widths and a ToUnicode map, so it can be selected, searched and copied. Every glyph is
// placed where the layout measured it (fontkit's own shaping of the run, kerning included), so
// the PDF matches the screen and the SVG exactly.

/** The app's name as PDF readers show it (document properties). */
export const PDF_PRODUCER = 'statPlotter'

export interface PdfOptions {
  /** A colour under everything (as `sceneToSvg`'s); omitted = transparent. */
  background?: string
  /** Document title (Info dictionary). */
  title?: string
  /** Creation date; omitted = none, so the same scene gives the same bytes. */
  date?: Date
  /** Flate-compress streams (default true; tests turn it off to read the content). */
  compress?: boolean
}

const num = finiteNumber

/** '#rrggbb' (or '#rgb') as PDF colour operands; black if unreadable. */
function rgb(color: string): string {
  let h = color.startsWith('#') ? color.slice(1) : ''
  if (h.length === 3) h = [...h].map((c) => c + c).join('')
  const v = /^[0-9a-f]{6}$/i.test(h) ? Number.parseInt(h, 16) : 0
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => num(c / 255)).join(' ')
}

/** A PDF text string: UTF-16BE with a byte-order mark, as hex. */
function textString(s: string): string {
  let hex = 'FEFF'
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, '0')
  return `<${hex.toUpperCase()}>`
}

const hex4 = (v: number) => v.toString(16).padStart(4, '0')

/** UTF-16BE hex of code points (surrogate pairs above U+FFFF). */
function utf16Hex(codePoints: readonly number[]): string {
  return codePoints
    .map((c) => {
      if (c < 0x10000) return hex4(c)
      const v = c - 0x10000
      return hex4(0xd800 + (v >> 10)) + hex4(0xdc00 + (v & 0x3ff))
    })
    .join('')
}

// ---- Fonts --------------------------------------------------------------------------------------

/** fontkit's TrueType subset (its typings have `includeGlyph` return a boolean). */
interface FontSubset {
  /** Adds a glyph (by id in the full font); returns its id in the subset. */
  includeGlyph(glyph: number): number
  encode(): Uint8Array
}

/** A font as embedded: its subset, the widths and text of each glyph used, and its name. */
interface EmbeddedFont {
  name: string
  font: fontkit.Font
  family: FontId
  subset: FontSubset
  /** Subset glyph id (the CID) → advance width in 1/1000 em. */
  widths: Map<number, number>
  /** CID → the characters it stands for (first seen). */
  unicode: Map<number, number[]>
}

/** Six capital letters naming a subset (PDF 32000-1 §9.6.4), from its glyphs. */
function subsetTag(font: EmbeddedFont): string {
  let h = 2166136261
  for (const c of `${font.font.postscriptName}:${[...font.widths.keys()].join(',')}`) {
    h ^= c.charCodeAt(0)
    h = Math.imul(h, 16777619)
  }
  let tag = ''
  for (let i = 0; i < 6; i++) {
    tag += String.fromCharCode(65 + ((h >>> 0) % 26))
    h = Math.imul(h ^ (h >>> 13), 2654435761)
  }
  return tag
}

function toUnicodeCMap(unicode: Map<number, number[]>): string {
  const entries = [...unicode].filter(([, cps]) => cps.length > 0)
  const blocks: string[] = []
  // At most 100 mappings per block.
  for (let i = 0; i < entries.length; i += 100) {
    const chunk = entries.slice(i, i + 100)
    blocks.push(
      `${chunk.length} beginbfchar\n${chunk.map(([cid, cps]) => `<${hex4(cid)}> <${utf16Hex(cps)}>`).join('\n')}\nendbfchar`,
    )
  }
  return [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<0000> <ffff>',
    'endcodespacerange',
    ...blocks,
    'endcmap',
    'CMapName currentdict /CMap defineresource pop',
    'end',
    'end',
  ].join('\n')
}

// ---- The content stream -------------------------------------------------------------------------

type PaintState = {
  width: number
  cap: number
  join: number
  dash: string
  stroke: string
  fill: string
  alpha: number
}

/** Content stream operators, skipping graphics-state changes that change nothing. */
class Content {
  readonly ops: string[] = []
  private state: PaintState = {
    width: 1,
    cap: 0,
    join: 0,
    dash: '',
    stroke: '0 0 0',
    fill: '0 0 0',
    alpha: 1,
  }
  private saved: PaintState[] = []

  constructor(private readonly alphaName: (a: number) => string) {}

  push(op: string) {
    this.ops.push(op)
  }

  save() {
    this.ops.push('q')
    this.saved.push({ ...this.state })
  }

  restore() {
    this.ops.push('Q')
    this.state = this.saved.pop()!
  }

  private set<K extends keyof PaintState>(key: K, value: PaintState[K], op: () => string) {
    if (this.state[key] === value) return
    this.state[key] = value
    this.ops.push(op())
  }

  fill(color: string, alpha = 1) {
    const c = rgb(color)
    this.set('fill', c, () => `${c} rg`)
    this.set('alpha', alpha, () => `/${this.alphaName(alpha)} gs`)
  }

  stroke(s: Stroke, cap: number, join: number) {
    this.set('width', s.width, () => `${num(s.width)} w`)
    this.set('cap', cap, () => `${cap} J`)
    this.set('join', join, () => `${join} j`)
    const dash = dashArray(s) ?? ''
    this.set('dash', dash, () => `[${dash}] 0 d`)
    const c = rgb(s.color)
    this.set('stroke', c, () => `${c} RG`)
  }
}

const CAP = { butt: 0, square: 2 } as const
const MITER = 0
/** Control-point distance for a quarter circle drawn as a cubic Bézier. */
const KAPPA = 0.5522847498

const moveTo = (x: number, y: number) => `${num(x)} ${num(y)} m`
const lineTo = (x: number, y: number) => `${num(x)} ${num(y)} l`
const polyPath = (ps: readonly (readonly [number, number])[]) =>
  ps.map(([x, y], i) => (i ? lineTo(x, y) : moveTo(x, y))).join(' ')

/** Path commands as PDF path operators. */
const pathOps = (d: readonly PathCmd[]) =>
  d
    .map((c) =>
      c[0] === 'Z'
        ? 'h'
        : `${c
            .slice(1)
            .map((v) => num(v as number))
            .join(' ')} ${{ M: 'm', L: 'l', C: 'c' }[c[0]]}`,
    )
    .join(' ')

/** An ellipse as four cubic Béziers. */
function ellipseOps(cx: number, cy: number, rx: number, ry: number): string {
  const [kx, ky] = [rx * KAPPA, ry * KAPPA]
  const c = (...v: number[]) => `${v.map(num).join(' ')} c`
  return [
    moveTo(cx + rx, cy),
    c(cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry),
    c(cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy),
    c(cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry),
    c(cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy),
    'h',
  ].join(' ')
}

/** A symbol's outline, as `symbolPath` draws it in SVG. */
function symbolOps(
  shape: Extract<Prim, { type: 'symbol' }>['shape'],
  cx: number,
  cy: number,
  size: number,
) {
  const r = size / 2
  switch (shape) {
    case 'circle': {
      const k = r * KAPPA
      const c = (...v: number[]) => `${v.map(num).join(' ')} c`
      return [
        moveTo(cx + r, cy),
        c(cx + r, cy + k, cx + k, cy + r, cx, cy + r),
        c(cx - k, cy + r, cx - r, cy + k, cx - r, cy),
        c(cx - r, cy - k, cx - k, cy - r, cx, cy - r),
        c(cx + k, cy - r, cx + r, cy - k, cx + r, cy),
        'h',
      ].join(' ')
    }
    case 'square': {
      const s = r * 0.886
      return `${num(cx - s)} ${num(cy - s)} ${num(2 * s)} ${num(2 * s)} re`
    }
    case 'diamond': {
      const s = r * 1.2
      return `${polyPath([
        [cx, cy - s],
        [cx + s, cy],
        [cx, cy + s],
        [cx - s, cy],
      ])} h`
    }
    case 'triangle': {
      const s = r * 1.15
      const h = s * Math.sqrt(3)
      return `${polyPath([
        [cx, cy - (2 / 3) * h],
        [cx + s, cy + h / 3],
        [cx - s, cy + h / 3],
      ])} h`
    }
    case 'plus':
      return `${moveTo(cx - r, cy)} ${lineTo(cx + r, cy)} ${moveTo(cx, cy - r)} ${lineTo(cx, cy + r)}`
    case 'cross': {
      const s = r * 0.8
      return `${moveTo(cx - s, cy - s)} ${lineTo(cx + s, cy + s)} ${moveTo(cx + s, cy - s)} ${lineTo(cx - s, cy + s)}`
    }
  }
}

/**
 * An image as embedded: a JPEG's own bytes (DCTDecode), or a PNG decoded to 8-bit RGB with its
 * alpha as a soft mask (both Flate-compressed).
 */
type EmbeddedImage =
  | { name: string; kind: 'jpeg'; asset: ImageAsset; colorSpace: string; decode: string }
  | { name: string; kind: 'png'; asset: ImageAsset; rgb: Uint8Array; alpha: Uint8Array | null }

function embedImage(name: string, asset: ImageAsset): EmbeddedImage | null {
  try {
    if (asset.mime === 'image/jpeg') {
      const info = imageInfo(asset.bytes)
      const n = info.components ?? 3
      return {
        name,
        kind: 'jpeg',
        asset,
        colorSpace: n === 1 ? 'DeviceGray' : n === 4 ? 'DeviceCMYK' : 'DeviceRGB',
        // Adobe's CMYK JPEGs store inverted values.
        decode: n === 4 && info.adobe ? ' /Decode [1 0 1 0 1 0 1 0]' : '',
      }
    }
    const png = decodePng(asset.bytes)
    return { name, kind: 'png', asset, rgb: png.rgb, alpha: png.alpha }
  } catch {
    return null
  }
}

/** Builds the page's content and collects the fonts, opacities and images it uses. */
class PageWriter {
  readonly fonts = new Map<fontkit.Font, EmbeddedFont>()
  readonly alphas = new Map<number, string>()
  /** By their bytes: an image placed twice is embedded once (null: it couldn't be read). */
  readonly images = new Map<Uint8Array, EmbeddedImage | null>()
  readonly content = new Content((a) => this.alphaName(a))

  constructor(private readonly registry: FontRegistry) {}

  private alphaName(a: number): string {
    let name = this.alphas.get(a)
    if (!name) {
      name = `A${this.alphas.size + 1}`
      this.alphas.set(a, name)
    }
    return name
  }

  private fontFor(family: FontId, bold: boolean, italic: boolean): EmbeddedFont {
    const font = this.registry.get(family, variantOf(bold, italic))
    let e = this.fonts.get(font)
    if (!e) {
      const subset = font.createSubset() as unknown as FontSubset
      e = {
        name: `F${this.fonts.size + 1}`,
        font,
        family,
        subset,
        widths: new Map([[0, (font.getGlyph(0).advanceWidth * 1000) / font.unitsPerEm]]),
        unicode: new Map(),
      }
      this.fonts.set(font, e)
    }
    return e
  }

  /** Paints a path with an optional fill and stroke (fill first, as SVG does). */
  private paint(path: string, fill: Fill | null, stroke: Stroke | null, cap: number) {
    const s = stroke && stroke.width > 0 ? stroke : null
    if (!fill && !s) return
    const c = this.content
    if (fill) c.fill(fill.color, fill.opacity)
    if (s) c.stroke(s, cap, MITER)
    c.push(`${path} ${fill && s ? 'B' : fill ? 'f' : 'S'}`)
  }

  node(n: SceneNode) {
    if (n.transform) {
      const t = n.transform
      this.content.save()
      this.content.push(`${num(t.scale)} 0 0 ${num(t.scale)} ${num(t.x)} ${num(t.y)} cm`)
    }
    if (n.prim) {
      if (primFinite(n.prim)) this.prim(n.prim)
      else droppedNonFinite(n.prim, 'PDF')
    }
    for (const c of n.children ?? []) this.node(c)
    if (n.transform) this.content.restore()
  }

  private prim(p: Prim) {
    switch (p.type) {
      case 'line':
        return this.paint(`${moveTo(p.x1, p.y1)} ${lineTo(p.x2, p.y2)}`, null, p.stroke, CAP.square)
      case 'polyline':
        if (p.points.length < 2) return
        return this.paint(polyPath(p.points), null, p.stroke, CAP.butt)
      case 'polygon':
        if (p.points.length < 2) return
        return this.paint(`${polyPath(p.points)} h`, p.fill, p.stroke, CAP.butt)
      case 'rect':
        // As SVG: a rect without area isn't drawn.
        if (!(p.w > 0 && p.h > 0)) return
        return this.paint(
          p.rx && p.rx > 0
            ? pathOps(roundedRectPath(p.x, p.y, p.w, p.h, p.rx))
            : `${num(p.x)} ${num(p.y)} ${num(p.w)} ${num(p.h)} re`,
          p.fill,
          p.stroke,
          CAP.butt,
        )
      case 'ellipse':
        if (!(p.rx > 0 && p.ry > 0)) return
        return this.paint(ellipseOps(p.cx, p.cy, p.rx, p.ry), p.fill, p.stroke, CAP.butt)
      case 'path':
        if (p.d.length < 2) return
        return this.paint(pathOps(p.d), p.fill, p.stroke, CAP.butt)
      case 'image':
        return this.image(p)
      case 'symbol':
        return this.paint(
          symbolOps(p.shape, p.cx, p.cy, p.size),
          OPEN_SHAPES.has(p.shape) ? null : p.fill,
          p.stroke,
          CAP.butt,
        )
      case 'points':
        // A point cloud (roadmap 34e): its symbols, as symbol nodes draw them.
        for (let i = 0; i < p.n; i++) {
          if (!cloudPointFinite(p, i)) continue
          const q = p.paints[p.paint[i]!]!
          this.paint(
            symbolOps(q.shape, p.x[i]!, p.y[i]!, p.size[i]!),
            OPEN_SHAPES.has(q.shape) ? null : q.fill,
            q.stroke,
            CAP.butt,
          )
        }
        return
      case 'text':
        return this.text(p)
    }
  }

  /**
   * An image: clipped to its box, the whole picture scaled so the cropped part fills the box. The
   * page is flipped (y down), so the unit square is flipped back: the image's first row on top.
   */
  private image(p: Extract<Prim, { type: 'image' }>) {
    if (!(p.w > 0 && p.h > 0)) return
    const bytes = p.asset.bytes
    if (!this.images.has(bytes))
      this.images.set(bytes, embedImage(`Im${this.images.size + 1}`, p.asset))
    const img = this.images.get(bytes)
    const c = this.content
    if (!img) {
      // Unreadable: a light grey box where it would be.
      c.fill('#dddddd')
      c.push(`${num(p.x)} ${num(p.y)} ${num(p.w)} ${num(p.h)} re f`)
      return
    }
    const crop = p.crop ?? { x: 0, y: 0, w: 1, h: 1 }
    const [iw, ih] = [p.w / crop.w, p.h / crop.h]
    const [ix, iy] = [p.x - crop.x * iw, p.y - crop.y * ih]
    c.save()
    c.push(`${num(p.x)} ${num(p.y)} ${num(p.w)} ${num(p.h)} re W n`)
    c.push(`${num(iw)} 0 0 ${num(-ih)} ${num(ix)} ${num(iy + ih)} cm /${img.name} Do`)
    c.restore()
  }

  private text(p: Extract<Prim, { type: 'text' }>) {
    const c = this.content
    const runs = p.layout.runs.filter((r) => r.text !== '')
    const underlines = p.layout.underlines ?? []
    if (!runs.length && !underlines.length) return
    c.save()
    if (p.rotate) {
      const a = (p.rotate.angle * Math.PI) / 180
      const [cos, sin] = [Math.cos(a), Math.sin(a)]
      const { cx, cy } = p.rotate
      // rotate(angle cx cy), as in the SVG (y down, so positive turns clockwise).
      c.push(
        `${num(cos)} ${num(sin)} ${num(-sin)} ${num(cos)} ${num(cx - cos * cx + sin * cy)} ${num(cy - sin * cx - cos * cy)} cm`,
      )
    }
    if (runs.length && p.halo) {
      // The halo (roadmap 34e): the letters stroked first (render mode 1), round joins.
      c.stroke({ color: p.halo.color, width: p.halo.width, dash: 'solid' }, CAP.butt, 1)
      c.push('BT 1 Tr')
      for (const r of runs) {
        const f = this.fontFor(r.font, r.bold, r.italic)
        c.push(`/${f.name} ${num(r.size)} Tf 1 0 0 -1 ${num(p.x + r.x)} ${num(p.y + r.dy)} Tm`)
        c.push(this.glyphs(f, r.text, r.size))
      }
      c.push('0 Tr ET')
    }
    if (runs.length) {
      c.push('BT')
      for (const r of runs) {
        const f = this.fontFor(r.font, r.bold, r.italic)
        c.fill(r.fill ?? p.color)
        // The page is flipped (y down); the text matrix flips the glyphs back upright.
        c.push(`/${f.name} ${num(r.size)} Tf 1 0 0 -1 ${num(p.x + r.x)} ${num(p.y + r.dy)} Tm`)
        c.push(this.glyphs(f, r.text, r.size))
      }
      c.push('ET')
    }
    for (const u of underlines) {
      c.fill(u.fill ?? p.color)
      c.push(`${num(p.x + u.x)} ${num(p.y + u.y)} ${num(u.w)} ${num(u.h)} re f`)
    }
    c.restore()
  }

  /**
   * The run's glyphs as TJ strings of CIDs, each placed where fontkit's layout puts it: the
   * advance differs from the glyph's width by kerning (a TJ adjustment), and a glyph raised or
   * lowered by the font (marks) gets a text rise.
   */
  private glyphs(f: EmbeddedFont, text: string, size: number): string {
    const run = f.font.layout(text)
    const em = 1000 / f.font.unitsPerEm
    const out: string[] = []
    let items: string[] = []
    let rise = 0
    /** Where the text position is (1/1000 em), and where the pen is per the layout. */
    let at = 0
    let pen = 0
    const flush = () => {
      if (items.length) out.push(`[${items.join(' ')}] TJ`)
      items = []
    }
    run.glyphs.forEach((g, i) => {
      const pos = run.positions[i]!
      const cid = f.subset.includeGlyph(g.id)
      const width = g.advanceWidth * em
      f.widths.set(cid, width)
      if (!f.unicode.has(cid)) f.unicode.set(cid, [...g.codePoints])
      const y = Math.round(((pos.yOffset * size) / f.font.unitsPerEm) * 1000) / 1000
      if (y !== rise) {
        flush()
        out.push(`${num(y)} Ts`)
        rise = y
      }
      const adjust = Math.round((pen + pos.xOffset * em - at) * 1000) / 1000
      if (adjust !== 0) {
        items.push(num(-adjust))
        at += adjust
      }
      items.push(`<${hex4(cid)}>`)
      at += width
      pen += pos.xAdvance * em
    })
    flush()
    if (rise !== 0) out.push('0 Ts')
    return out.join(' ')
  }
}

// ---- The file -----------------------------------------------------------------------------------

const encoder = new TextEncoder()

/** Numbered objects written in order, with the cross-reference table. */
class PdfFile {
  private objects: (Uint8Array[] | null)[] = []

  alloc(): number {
    this.objects.push(null)
    return this.objects.length
  }

  set(id: number, dict: string) {
    this.objects[id - 1] = [encoder.encode(`${id} 0 obj\n${dict}\nendobj\n`)]
  }

  stream(id: number, dict: string, data: Uint8Array, compress: boolean) {
    const body = compress ? zlibSync(data, { level: 9 }) : data
    const filter = compress ? ' /Filter /FlateDecode' : ''
    const head = `${id} 0 obj\n<< /Length ${body.length}${filter}${dict ? ` ${dict}` : ''} >>\nstream\n`
    this.objects[id - 1] = [encoder.encode(head), body, encoder.encode('\nendstream\nendobj\n')]
  }

  bytes(root: number, info: number): Uint8Array {
    // A binary comment after the header marks the file as binary for transfer programs.
    const chunks: Uint8Array[] = [
      encoder.encode('%PDF-1.7\n'),
      Uint8Array.of(37, 226, 227, 207, 211, 10),
    ]
    let offset = chunks.reduce((s, c) => s + c.length, 0)
    const offsets: number[] = []
    for (const [i, obj] of this.objects.entries()) {
      if (!obj) throw new Error(`PDF object ${i + 1} was never written`)
      offsets.push(offset)
      for (const c of obj) {
        chunks.push(c)
        offset += c.length
      }
    }
    const xref = [
      'xref',
      `0 ${this.objects.length + 1}`,
      '0000000000 65535 f\r',
      ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n\r`),
      'trailer',
      `<< /Size ${this.objects.length + 1} /Root ${root} 0 R /Info ${info} 0 R >>`,
      'startxref',
      String(offset),
      '%%EOF\n',
    ].join('\n')
    chunks.push(encoder.encode(xref))
    const out = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0))
    let at = 0
    for (const c of chunks) {
      out.set(c, at)
      at += c.length
    }
    return out
  }
}

const pdfDate = (d: Date) =>
  `(D:${d.getUTCFullYear()}${[d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()].map((v) => String(v).padStart(2, '0')).join('')}Z)`

/** Font descriptor flags (PDF 32000-1 §9.8.2): fixed pitch, serif, symbolic, italic. */
function fontFlags(e: EmbeddedFont): number {
  const post = (e.font as unknown as { post?: { isFixedPitch?: number } }).post
  return (
    (post?.isFixedPitch ? 1 : 0) |
    (e.family === 'serif' ? 2 : 0) |
    4 |
    (e.font.italicAngle !== 0 ? 64 : 0)
  )
}

/** An image XObject (and its soft mask); returns its object number. */
function writeImage(file: PdfFile, img: EmbeddedImage): number {
  const { width, height, bytes } = img.asset
  const id = file.alloc()
  const head = `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /BitsPerComponent 8`
  if (img.kind === 'jpeg') {
    file.stream(
      id,
      `${head} /ColorSpace /${img.colorSpace}${img.decode} /Filter /DCTDecode`,
      bytes,
      false,
    )
    return id
  }
  let mask = ''
  if (img.alpha) {
    const m = file.alloc()
    file.stream(m, `${head} /ColorSpace /DeviceGray`, img.alpha, true)
    mask = ` /SMask ${m} 0 R`
  }
  file.stream(id, `${head} /ColorSpace /DeviceRGB${mask}`, img.rgb, true)
  return id
}

function writeFont(file: PdfFile, e: EmbeddedFont, compress: boolean): number {
  const [type0, cidFont, descriptor, fontFile, toUnicode] = [0, 0, 0, 0, 0].map(() => file.alloc())
  const name = `${subsetTag(e)}+${e.font.postscriptName.replace(/[^!-~]|[()<>[\]{}/%#]/g, '')}`
  const k = 1000 / e.font.unitsPerEm
  const bbox = e.font.bbox
  const cids = [...e.widths.keys()].sort((a, b) => a - b)
  const w = cids.map((cid) => `${cid} [${num(e.widths.get(cid)!)}]`).join(' ')
  file.set(
    type0!,
    `<< /Type /Font /Subtype /Type0 /BaseFont /${name} /Encoding /Identity-H /DescendantFonts [${cidFont} 0 R] /ToUnicode ${toUnicode} 0 R >>`,
  )
  file.set(
    cidFont!,
    `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptor} 0 R /CIDToGIDMap /Identity /W [${w}] >>`,
  )
  file.set(
    descriptor!,
    `<< /Type /FontDescriptor /FontName /${name} /Flags ${fontFlags(e)} /FontBBox [${[bbox.minX, bbox.minY, bbox.maxX, bbox.maxY].map((v) => num(v * k)).join(' ')}] /ItalicAngle ${num(e.font.italicAngle)} /Ascent ${num(e.font.ascent * k)} /Descent ${num(e.font.descent * k)} /CapHeight ${num((e.font.capHeight || e.font.ascent) * k)} /StemV 80 /FontFile2 ${fontFile} 0 R >>`,
  )
  const program = e.subset.encode()
  // fontkit writes Apple's 'true' as the sfnt version; 0x00010000 is what every reader takes.
  program.set([0, 1, 0, 0], 0)
  file.stream(fontFile!, `/Length1 ${program.length}`, program, compress)
  file.stream(toUnicode!, '', encoder.encode(toUnicodeCMap(e.unicode)), compress)
  return type0!
}

/**
 * A one-page PDF of the scene, the page its size in points. Text is embedded in the fonts it
 * was measured with (subsets), so `fonts` must be the registry the scene was laid out with.
 */
export function sceneToPdf(scene: Scene, fonts: FontRegistry, opts: PdfOptions = {}): Uint8Array {
  const compress = opts.compress ?? true
  const page = new PageWriter(fonts)
  const c = page.content
  // Scene coordinates are y-down from the top-left: flip the page once. SVG's default miter limit.
  c.push(`1 0 0 -1 0 ${num(scene.height)} cm 4 M`)
  if (opts.background) {
    c.fill(opts.background)
    c.push(`0 0 ${num(scene.width)} ${num(scene.height)} re f`)
  }
  page.node(scene.root)

  const file = new PdfFile()
  const [catalog, pages, pageObj, contents, info] = [0, 0, 0, 0, 0].map(() => file.alloc())
  const fontRefs = [...page.fonts.values()].map(
    (e) => `/${e.name} ${writeFont(file, e, compress)} 0 R`,
  )
  const alphas = [...page.alphas].map(
    ([a, name]) => `/${name} << /Type /ExtGState /ca ${num(a)} >>`,
  )
  const images = [...page.images.values()].filter((i): i is EmbeddedImage => !!i)
  const imageRefs = images.map((img) => `/${img.name} ${writeImage(file, img)} 0 R`)
  const resources = [
    fontRefs.length ? `/Font << ${fontRefs.join(' ')} >>` : '',
    alphas.length ? `/ExtGState << ${alphas.join(' ')} >>` : '',
    imageRefs.length ? `/XObject << ${imageRefs.join(' ')} >>` : '',
  ]
    .filter(Boolean)
    .join(' ')
  // Transparency (opacity, images' alpha): blend in RGB, as the SVG does in the browser.
  const group =
    [...page.alphas.keys()].some((a) => a < 1) || images.some((i) => i.kind === 'png' && i.alpha)
      ? ' /Group << /Type /Group /S /Transparency /CS /DeviceRGB >>'
      : ''
  file.set(catalog!, `<< /Type /Catalog /Pages ${pages} 0 R >>`)
  file.set(pages!, `<< /Type /Pages /Kids [${pageObj} 0 R] /Count 1 >>`)
  file.set(
    pageObj!,
    `<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 ${num(scene.width)} ${num(scene.height)}] /Resources << ${resources} >> /Contents ${contents} 0 R${group} >>`,
  )
  file.stream(contents!, '', encoder.encode(c.ops.join('\n')), compress)
  const infoEntries = [
    opts.title ? `/Title ${textString(opts.title)}` : '',
    `/Producer ${textString(PDF_PRODUCER)}`,
    `/Creator ${textString(PDF_PRODUCER)}`,
    opts.date ? `/CreationDate ${pdfDate(opts.date)}` : '',
  ].filter(Boolean)
  file.set(info!, `<< ${infoEntries.join(' ')} >>`)
  return file.bytes(catalog!, info!)
}
