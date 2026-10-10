import { unzlibSync } from 'fflate'
import { crc32 } from '../src/render/raster.ts'

// Minimal PNG, TIFF and JPEG readers for tests (unit and end-to-end): sizes, resolutions and,
// for PNG and TIFF, the pixels. Each checks the structure it reads and throws on anything off.

export interface Image {
  width: number
  height: number
  /** Samples per pixel (3 RGB, 4 RGBA). */
  channels: number
  /** Dots per inch, from the file. */
  dpi: { x: number; y: number } | null
  pixels: Uint8Array
}

const be32 = (b: Uint8Array, i: number) => new DataView(b.buffer, b.byteOffset).getUint32(i)

export function readPng(bytes: Uint8Array): Image & { chunks: string[] } {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (!sig.every((v, i) => bytes[i] === v)) throw new Error('not a PNG')
  let at = 8
  const chunks: string[] = []
  const idat: Uint8Array[] = []
  let width = 0
  let height = 0
  let channels = 0
  let dpi: Image['dpi'] = null
  while (at < bytes.length) {
    const len = be32(bytes, at)
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8))
    const data = bytes.subarray(at + 8, at + 8 + len)
    if (be32(bytes, at + 8 + len) !== crc32([bytes.subarray(at + 4, at + 8), data]))
      throw new Error(`bad CRC in ${type}`)
    chunks.push(type)
    if (type === 'IHDR') {
      width = be32(data, 0)
      height = be32(data, 4)
      if (data[8] !== 8) throw new Error('not 8-bit')
      channels = { 2: 3, 6: 4 }[data[9]!] ?? 0
    } else if (type === 'pHYs' && data[8] === 1)
      dpi = { x: Math.round(be32(data, 0) * 0.0254), y: Math.round(be32(data, 4) * 0.0254) }
    else if (type === 'IDAT') idat.push(data)
    at += 12 + len
  }
  const raw = unzlibSync(new Uint8Array(Buffer.concat(idat)))
  const stride = width * channels
  const pixels = new Uint8Array(stride * height)
  for (let r = 0; r < height; r++) {
    const f = raw[r * (stride + 1)]
    const row = raw.subarray(r * (stride + 1) + 1, (r + 1) * (stride + 1))
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? pixels[r * stride + i - channels]! : 0
      const up = r ? pixels[(r - 1) * stride + i]! : 0
      const pred = f === 0 ? 0 : f === 1 ? left : f === 2 ? up : Number.NaN
      if (Number.isNaN(pred)) throw new Error(`filter ${f} not read here`)
      pixels[r * stride + i] = (row[i]! + pred) & 255
    }
  }
  return { width, height, channels, dpi, pixels, chunks }
}

export function readTiff(bytes: Uint8Array): Image & { tags: Map<number, number[]> } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes[0] !== 0x49 || bytes[1] !== 0x49 || v.getUint16(2, true) !== 42)
    throw new Error('not a little-endian TIFF')
  const ifd = v.getUint32(4, true)
  const n = v.getUint16(ifd, true)
  const tags = new Map<number, number[]>()
  let last = 0
  for (let i = 0; i < n; i++) {
    const p = ifd + 2 + i * 12
    const tag = v.getUint16(p, true)
    if (tag <= last) throw new Error('tags out of order')
    last = tag
    const type = v.getUint16(p + 2, true)
    const count = v.getUint32(p + 4, true)
    const size = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8 }[type]!
    const at = count * size > 4 ? v.getUint32(p + 8, true) : p + 8
    const values: number[] = []
    for (let k = 0; k < count; k++) {
      if (type === 3) values.push(v.getUint16(at + k * 2, true))
      else if (type === 4) values.push(v.getUint32(at + k * 4, true))
      else if (type === 5)
        values.push(v.getUint32(at + k * 8, true) / v.getUint32(at + k * 8 + 4, true))
      else values.push(bytes[at + k]!)
    }
    tags.set(tag, values)
  }
  const one = (t: number) => tags.get(t)![0]!
  const [width, height, channels] = [one(256), one(257), one(277)]
  if (one(259) !== 8) throw new Error('not Deflate')
  const offsets = tags.get(273)!
  const counts = tags.get(279)!
  const pixels = new Uint8Array(
    Buffer.concat(offsets.map((o, i) => unzlibSync(bytes.subarray(o, o + counts[i]!)))),
  )
  if (pixels.length !== width * height * channels) throw new Error('strips don’t fill the image')
  const unit = tags.get(296)?.[0] ?? 2
  const dpi = unit === 2 && tags.has(282) ? { x: one(282), y: one(283) } : null
  return { width, height, channels, dpi, pixels, tags }
}

/** A JPEG's pixel size (SOF) and JFIF density. */
export function readJpeg(
  bytes: Uint8Array,
): Omit<Image, 'pixels' | 'channels'> & { jfif: boolean } {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('not a JPEG')
  let at = 2
  let dpi: Image['dpi'] = null
  let jfif = false
  while (at < bytes.length) {
    if (bytes[at] !== 0xff) throw new Error('bad marker')
    const marker = bytes[at + 1]!
    const len = (bytes[at + 2]! << 8) | bytes[at + 3]!
    const seg = bytes.subarray(at + 4, at + 2 + len)
    if (marker === 0xe0 && String.fromCharCode(...seg.subarray(0, 5)) === 'JFIF\0') {
      jfif = true
      if (seg[7] === 1) dpi = { x: (seg[8]! << 8) | seg[9]!, y: (seg[10]! << 8) | seg[11]! }
    }
    if (marker >= 0xc0 && marker <= 0xc2) {
      const height = (seg[1]! << 8) | seg[2]!
      const width = (seg[3]! << 8) | seg[4]!
      return { width, height, dpi, jfif }
    }
    at += 2 + len
  }
  throw new Error('no frame header')
}
