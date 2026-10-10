import type { ImageAsset } from '@ps/model'

// Images placed on layout pages (roadmap 32): what their headers say, read in plain TypeScript
// (no DOM, so files open and export in workers and tests), and their bytes as data URLs.

/** What an image file's header says. */
export interface ImageInfo {
  mime: 'image/png' | 'image/jpeg'
  /** Pixels. */
  width: number
  height: number
  /** Resolution recorded in the file (pixels per inch), if any. */
  dpi?: number
  /** JPEG: colour components (1 grey, 3 YCbCr / RGB, 4 CMYK) and an Adobe marker (inverted CMYK). */
  components?: number
  adobe?: boolean
}

/** Why an image can't be placed. */
export class ImageFormatError extends Error {}

const ascii = (b: Uint8Array, at: number, n: number) =>
  String.fromCharCode(...b.subarray(at, at + n))
const u16 = (b: Uint8Array, at: number) => (b[at]! << 8) | b[at + 1]!
const u32 = (b: Uint8Array, at: number) => u16(b, at) * 65536 + u16(b, at + 2)

/** Largest image side accepted, in pixels (what browsers and PDF readers handle comfortably). */
export const MAX_IMAGE_SIDE = 20_000

/**
 * The format, size and resolution of a PNG or JPEG image from its header. Anything else throws
 * an `ImageFormatError` saying why (TIFF and SVG are named: browsers can't show TIFF, and SVG
 * images can run scripts).
 */
export function imageInfo(b: Uint8Array): ImageInfo {
  const info = b.length >= 8 && u32(b, 0) === 0x89504e47 ? pngInfo(b) : jpegOrOther(b)
  if (!(info.width > 0 && info.height > 0))
    throw new ImageFormatError('The image has no pixels (its header is damaged).')
  if (info.width > MAX_IMAGE_SIDE || info.height > MAX_IMAGE_SIDE)
    throw new ImageFormatError(
      `The image is ${info.width} × ${info.height} pixels; at most ${MAX_IMAGE_SIDE} a side can be placed.`,
    )
  return info
}

function pngInfo(b: Uint8Array): ImageInfo {
  if (b.length < 33 || ascii(b, 12, 4) !== 'IHDR')
    throw new ImageFormatError('The PNG file is damaged (no image header).')
  const info: ImageInfo = { mime: 'image/png', width: u32(b, 16), height: u32(b, 20) }
  // pHYs (pixels per metre) before the image data.
  for (let at = 8; at + 8 <= b.length; ) {
    const len = u32(b, at)
    const type = ascii(b, at + 4, 4)
    if (type === 'IDAT' || type === 'IEND') break
    if (type === 'pHYs' && len >= 9 && b[at + 16] === 1) {
      const ppm = u32(b, at + 8)
      if (ppm > 0) info.dpi = Math.round(ppm * 0.0254 * 100) / 100
    }
    at += 12 + len
  }
  return info
}

function jpegOrOther(b: Uint8Array): ImageInfo {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return jpegInfo(b)
  const head = ascii(b, 0, Math.min(b.length, 256)).trimStart()
  if (head.startsWith('II*\0') || head.startsWith('MM\0*'))
    throw new ImageFormatError(
      'TIFF images can’t be placed on a page (browsers can’t show them). Save it as PNG or JPEG first.',
    )
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<(!DOCTYPE svg|svg)/i.test(head))
    throw new ImageFormatError(
      'SVG images aren’t supported (they can contain scripts). Export it as PNG first.',
    )
  if (head.startsWith('GIF8') || (head.startsWith('RIFF') && ascii(b, 8, 4) === 'WEBP'))
    throw new ImageFormatError('Only PNG and JPEG images can be placed. Save it as PNG first.')
  throw new ImageFormatError('Not a PNG or JPEG image.')
}

function jpegInfo(b: Uint8Array): ImageInfo {
  let dpi: number | undefined
  let adobe = false
  for (let at = 2; at + 4 <= b.length; ) {
    if (b[at] !== 0xff) break
    const marker = b[at + 1]!
    if (marker === 0xff) {
      at++
      continue
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      at += 2
      continue
    }
    const len = u16(b, at + 2)
    // JFIF density (units 1: per inch, 2: per cm).
    if (marker === 0xe0 && ascii(b, at + 4, 5) === 'JFIF\0' && len >= 16) {
      const units = b[at + 11]
      const x = u16(b, at + 12)
      if (x > 0 && (units === 1 || units === 2)) dpi = units === 1 ? x : Math.round(x * 2.54)
    }
    if (marker === 0xee && ascii(b, at + 4, 5) === 'Adobe') adobe = true
    // Start of frame (baseline, extended, progressive, lossless; not DHT 0xc4, JPG 0xc8, DAC 0xcc).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (at + 9 >= b.length) break
      return {
        mime: 'image/jpeg',
        height: u16(b, at + 5),
        width: u16(b, at + 7),
        components: b[at + 9]!,
        ...(dpi ? { dpi } : {}),
        ...(adobe ? { adobe } : {}),
      }
    }
    if (marker === 0xda || marker === 0xd9) break
    at += 2 + len
  }
  throw new ImageFormatError('The JPEG file is damaged (no frame header).')
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Bytes as base64. */
export function base64(bytes: Uint8Array): string {
  const out: string[] = []
  let chunk = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b, c] = [bytes[i]!, bytes[i + 1], bytes[i + 2]]
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
    chunk +=
      B64[(n >> 18) & 63]! +
      B64[(n >> 12) & 63]! +
      (b === undefined ? '=' : B64[(n >> 6) & 63]!) +
      (c === undefined ? '=' : B64[n & 63]!)
    if (chunk.length >= 65536) {
      out.push(chunk)
      chunk = ''
    }
  }
  out.push(chunk)
  return out.join('')
}

const dataUrls = new WeakMap<Uint8Array, string>()

/** An image's bytes as a data URL (kept while the bytes are), for SVG exports. */
export function assetDataUrl(asset: Pick<ImageAsset, 'mime' | 'bytes'>): string {
  let url = dataUrls.get(asset.bytes)
  if (!url) {
    url = `data:${asset.mime};base64,${base64(asset.bytes)}`
    dataUrls.set(asset.bytes, url)
  }
  return url
}
