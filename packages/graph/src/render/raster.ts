import { Zlib, zlibSync } from 'fflate'

// Image files from rendered pixels (roadmap 27): PNG and TIFF encoders that take RGBA rows a band
// at a time (a large export is rendered in tiles, never as one canvas), with the resolution in
// the file (PNG pHYs, TIFF XResolution / YResolution), and the JFIF density of a browser-made
// JPEG. Opaque images are written as RGB, transparent ones as RGBA with unassociated alpha (what a
// canvas's getImageData gives).

export interface RasterOptions {
  /** Keep the alpha channel (a transparent background); otherwise RGB. */
  alpha: boolean
  /** Dots per inch, written into the file. */
  dpi: number
  /** Deflate effort (PNG; default 6). */
  level?: number
}

/** Takes the image's RGBA rows, top to bottom, in bands of whole rows; `finish` gives the file. */
export interface RasterWriter {
  write(rgba: Uint8Array | Uint8ClampedArray): void
  finish(): Uint8Array
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

/** CRC-32 (ISO 3309), as PNG chunks carry. */
export function crc32(parts: readonly Uint8Array[]): number {
  let c = 0xffffffff
  for (const p of parts)
    for (let i = 0; i < p.length; i++) c = CRC_TABLE[(c ^ p[i]!) & 255]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** RGBA rows as RGB (alpha dropped) or unchanged. */
function samples(rgba: Uint8Array | Uint8ClampedArray, alpha: boolean): Uint8Array {
  if (alpha) return new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength)
  const out = new Uint8Array((rgba.length / 4) * 3)
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    out[j] = rgba[i]!
    out[j + 1] = rgba[i + 1]!
    out[j + 2] = rgba[i + 2]!
  }
  return out
}

/** Pixels per metre for a resolution in dots per inch. */
export const dotsPerMetre = (dpi: number) => Math.round(dpi / 0.0254)

// ---- PNG ----------------------------------------------------------------------------------------

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const head = new Uint8Array(8)
  const view = new DataView(head.buffer)
  view.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) head[4 + i] = type.charCodeAt(i)
  const crc = new Uint8Array(4)
  new DataView(crc.buffer).setUint32(0, crc32([head.subarray(4), data]))
  return concat([head, data, crc])
}

/**
 * A PNG (8-bit RGB or RGBA, each row filtered "Up") with its resolution in a pHYs chunk and the
 * deflated data streamed into IDAT chunks as the bands arrive.
 */
export function pngWriter(width: number, height: number, opts: RasterOptions): RasterWriter {
  const channels = opts.alpha ? 4 : 3
  const stride = width * channels
  const idat: Uint8Array[] = []
  const z = new Zlib({ level: (opts.level ?? 6) as 6 }, (chunk) => {
    if (chunk.length) idat.push(pngChunk('IDAT', chunk))
  })
  let prev: Uint8Array = new Uint8Array(stride)
  let rows = 0
  return {
    write(rgba) {
      const px = samples(rgba, opts.alpha)
      const n = px.length / stride
      const out = new Uint8Array(n * (stride + 1))
      for (let r = 0; r < n; r++) {
        const row = px.subarray(r * stride, (r + 1) * stride)
        const o = r * (stride + 1)
        out[o] = 2 // Up: each byte minus the one above
        for (let i = 0; i < stride; i++) out[o + 1 + i] = (row[i]! - prev[i]!) & 255
        prev = row
      }
      // `prev` points into `px`, which stays alive until the next band.
      prev = prev.slice()
      rows += n
      z.push(out)
    },
    finish() {
      if (rows !== height) throw new Error(`PNG: ${rows} rows written of ${height}`)
      z.push(new Uint8Array(0), true)
      const ihdr = new Uint8Array(13)
      const v = new DataView(ihdr.buffer)
      v.setUint32(0, width)
      v.setUint32(4, height)
      ihdr[8] = 8 // bits per sample
      ihdr[9] = opts.alpha ? 6 : 2 // RGBA : RGB
      const phys = new Uint8Array(9)
      const p = new DataView(phys.buffer)
      p.setUint32(0, dotsPerMetre(opts.dpi))
      p.setUint32(4, dotsPerMetre(opts.dpi))
      phys[8] = 1 // metres
      return concat([
        Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
        pngChunk('IHDR', ihdr),
        pngChunk('pHYs', phys),
        ...idat,
        pngChunk('IEND', new Uint8Array(0)),
      ])
    },
  }
}

// ---- TIFF ---------------------------------------------------------------------------------------

/** TIFF tag ids used. */
const TAG = {
  width: 256,
  height: 257,
  bitsPerSample: 258,
  compression: 259,
  photometric: 262,
  stripOffsets: 273,
  samplesPerPixel: 277,
  rowsPerStrip: 278,
  stripByteCounts: 279,
  xResolution: 282,
  yResolution: 283,
  planarConfig: 284,
  resolutionUnit: 296,
  software: 305,
  extraSamples: 338,
} as const

const SHORT = 3
const LONG = 4
const RATIONAL = 5
const ASCII = 2

/** Uncompressed bytes per strip, about (whole rows). */
const STRIP_BYTES = 256 * 1024

/**
 * A baseline TIFF (little-endian, 8-bit RGB or RGBA with unassociated alpha), Deflate-compressed
 * (compression 8, zlib streams: what Photoshop, InDesign, Preview, Word and libtiff read) in
 * strips of about 256 kB, with its resolution in dots per inch.
 */
export function tiffWriter(width: number, height: number, opts: RasterOptions): RasterWriter {
  const channels = opts.alpha ? 4 : 3
  const stride = width * channels
  const rowsPerStrip = Math.max(1, Math.min(height, Math.floor(STRIP_BYTES / stride)))
  const strips: Uint8Array[] = []
  let pending: Uint8Array[] = []
  let pendingRows = 0
  let rows = 0
  const flush = () => {
    if (!pendingRows) return
    strips.push(zlibSync(concat(pending), { level: 6 }))
    pending = []
    pendingRows = 0
  }
  return {
    write(rgba) {
      const px = samples(rgba, opts.alpha)
      const n = px.length / stride
      for (let r = 0; r < n; r++) {
        pending.push(px.slice(r * stride, (r + 1) * stride))
        if (++pendingRows === rowsPerStrip) flush()
      }
      rows += n
    },
    finish() {
      if (rows !== height) throw new Error(`TIFF: ${rows} rows written of ${height}`)
      flush()
      const software = new TextEncoder().encode('statPlotter\0')
      type Entry = { tag: number; type: number; values: number[] | Uint8Array }
      const entries: Entry[] = [
        { tag: TAG.width, type: LONG, values: [width] },
        { tag: TAG.height, type: LONG, values: [height] },
        { tag: TAG.bitsPerSample, type: SHORT, values: Array(channels).fill(8) },
        { tag: TAG.compression, type: SHORT, values: [8] },
        { tag: TAG.photometric, type: SHORT, values: [2] },
        { tag: TAG.stripOffsets, type: LONG, values: [] },
        { tag: TAG.samplesPerPixel, type: SHORT, values: [channels] },
        { tag: TAG.rowsPerStrip, type: LONG, values: [rowsPerStrip] },
        { tag: TAG.stripByteCounts, type: LONG, values: strips.map((s) => s.length) },
        { tag: TAG.xResolution, type: RATIONAL, values: [Math.round(opts.dpi * 100), 100] },
        { tag: TAG.yResolution, type: RATIONAL, values: [Math.round(opts.dpi * 100), 100] },
        { tag: TAG.planarConfig, type: SHORT, values: [1] },
        { tag: TAG.resolutionUnit, type: SHORT, values: [2] },
        { tag: TAG.software, type: ASCII, values: software },
        ...(opts.alpha ? [{ tag: TAG.extraSamples, type: SHORT, values: [2] }] : []),
      ]
      // Layout: header, strips, then the IFD and the values too long for its entries.
      const header = 8
      let at = header
      const stripOffsets = strips.map((s) => {
        const o = at
        at += s.length
        return o
      })
      if (at % 2) at++ // the IFD starts on a word boundary
      entries.find((e) => e.tag === TAG.stripOffsets)!.values = stripOffsets
      const ifdAt = at
      const ifdSize = 2 + entries.length * 12 + 4
      const size = (e: Entry) =>
        e.type === RATIONAL ? 8 : e.type === LONG ? 4 : e.type === SHORT ? 2 : 1
      const count = (e: Entry) => (e.type === RATIONAL ? e.values.length / 2 : e.values.length)
      let extra = ifdAt + ifdSize
      const outside = new Map<Entry, number>()
      for (const e of entries) {
        const bytes = count(e) * size(e)
        if (bytes > 4) {
          outside.set(e, extra)
          extra += bytes + (bytes % 2)
        }
      }
      const out = new Uint8Array(extra)
      const v = new DataView(out.buffer)
      out.set([0x49, 0x49, 42, 0], 0) // "II*\0": little-endian TIFF
      v.setUint32(4, ifdAt, true)
      for (const [i, s] of strips.entries()) out.set(s, stripOffsets[i]!)
      v.setUint16(ifdAt, entries.length, true)
      const put = (e: Entry, pos: number) => {
        const vals = e.values
        for (let i = 0; i < vals.length; i++) {
          const x = vals[i]!
          if (e.type === ASCII) out[pos + i] = x
          else if (e.type === SHORT) v.setUint16(pos + i * 2, x, true)
          else v.setUint32(pos + i * 4, x, true)
        }
      }
      for (const [i, e] of entries.entries()) {
        const pos = ifdAt + 2 + i * 12
        v.setUint16(pos, e.tag, true)
        v.setUint16(pos + 2, e.type, true)
        v.setUint32(pos + 4, count(e), true)
        const o = outside.get(e)
        if (o === undefined) put(e, pos + 8)
        else {
          v.setUint32(pos + 8, o, true)
          put(e, o)
        }
      }
      v.setUint32(ifdAt + 2 + entries.length * 12, 0, true) // no further IFD
      return out
    },
  }
}

// ---- JPEG ---------------------------------------------------------------------------------------

/**
 * A JPEG with its resolution in the JFIF header: the APP0 segment's density set to `dpi` dots per
 * inch, or a JFIF APP0 inserted after the start-of-image marker where the encoder wrote none.
 */
export function jpegWithDpi(jpeg: Uint8Array, dpi: number): Uint8Array {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('not a JPEG')
  const d = Math.min(65535, Math.round(dpi))
  const isJfif =
    jpeg[2] === 0xff &&
    jpeg[3] === 0xe0 &&
    String.fromCharCode(...jpeg.subarray(6, 11)) === 'JFIF\0'
  if (isJfif) {
    const out = jpeg.slice()
    const v = new DataView(out.buffer)
    out[13] = 1 // dots per inch
    v.setUint16(14, d)
    v.setUint16(16, d)
    return out
  }
  const app0 = Uint8Array.of(
    0xff,
    0xe0,
    0,
    16,
    ...[0x4a, 0x46, 0x49, 0x46, 0], // "JFIF\0"
    1,
    2, // version 1.02
    1, // dots per inch
    d >> 8,
    d & 255,
    d >> 8,
    d & 255,
    0,
    0, // no thumbnail
  )
  return concat([jpeg.subarray(0, 2), app0, jpeg.subarray(2)])
}
