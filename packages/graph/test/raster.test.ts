import { describe, expect, it } from 'vitest'
import { crc32, jpegWithDpi, pngWriter, tiffWriter } from '../src/index.ts'
import { readJpeg, readPng, readTiff } from './imageRead.ts'

/** A w × h RGBA test image: a gradient with an alpha ramp. */
function image(w: number, h: number): Uint8Array {
  const px = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      px.set([(x * 7) & 255, (y * 13) & 255, (x * y) & 255, (x + y) & 255], i)
    }
  return px
}

const rgbOf = (rgba: Uint8Array) => rgba.filter((_, i) => i % 4 !== 3)

/** Writes the image in bands of `band` rows. */
function write(
  make: typeof pngWriter,
  w: number,
  h: number,
  alpha: boolean,
  band: number,
  dpi = 300,
) {
  const px = image(w, h)
  const out = make(w, h, { alpha, dpi })
  for (let y = 0; y < h; y += band) out.write(px.subarray(y * w * 4, Math.min(h, y + band) * w * 4))
  return { px, bytes: out.finish() }
}

describe('raster files', () => {
  it('crc32 matches the standard check value', () => {
    expect(crc32([new TextEncoder().encode('123456789')])).toBe(0xcbf43926)
  })

  it.each([false, true])('PNG (alpha %s): pixels, size and pHYs resolution', (alpha) => {
    const { px, bytes } = write(pngWriter, 37, 23, alpha, 5, 600)
    const png = readPng(bytes)
    expect(png.chunks[0]).toBe('IHDR')
    expect(png.chunks[1]).toBe('pHYs')
    expect(png.chunks.at(-1)).toBe('IEND')
    expect([png.width, png.height, png.channels]).toEqual([37, 23, alpha ? 4 : 3])
    expect(png.dpi).toEqual({ x: 600, y: 600 })
    expect(png.pixels).toEqual(alpha ? px : rgbOf(px))
  })

  it.each([false, true])('TIFF (alpha %s): Deflate strips, tags and resolution', (alpha) => {
    // Wide enough for several strips (about 256 kB each).
    const { px, bytes } = write(tiffWriter, 400, 300, alpha, 64, 1200)
    const tiff = readTiff(bytes)
    expect([tiff.width, tiff.height, tiff.channels]).toEqual([400, 300, alpha ? 4 : 3])
    expect(tiff.dpi).toEqual({ x: 1200, y: 1200 })
    expect(tiff.tags.get(262)).toEqual([2]) // RGB
    expect(tiff.tags.get(258)).toEqual(Array(alpha ? 4 : 3).fill(8))
    expect(tiff.tags.get(338)).toEqual(alpha ? [2] : undefined) // unassociated alpha
    expect(tiff.tags.get(273)!.length).toBeGreaterThan(1)
    expect(tiff.pixels).toEqual(alpha ? px : rgbOf(px))
  })

  it('writers refuse a short image', () => {
    const w = pngWriter(2, 2, { alpha: false, dpi: 72 })
    w.write(new Uint8Array(8))
    expect(() => w.finish()).toThrow(/1 rows written of 2/)
  })

  it('JPEG: sets the JFIF density, or adds a JFIF header', () => {
    // SOI, JFIF APP0 at 72 dpi aspect-only, SOF0 (8 bit, 20 × 10), EOI.
    const sof = [0xff, 0xc0, 0, 11, 8, 0, 10, 0, 20, 1, 1, 0x11, 0]
    const app0 = [0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]
    const jfif = Uint8Array.of(0xff, 0xd8, ...app0, ...sof, 0xff, 0xd9)
    const set = readJpeg(jpegWithDpi(jfif, 300))
    expect(set).toEqual({ width: 20, height: 10, dpi: { x: 300, y: 300 }, jfif: true })
    const bare = Uint8Array.of(0xff, 0xd8, ...sof, 0xff, 0xd9)
    expect(readJpeg(bare).jfif).toBe(false)
    expect(readJpeg(jpegWithDpi(bare, 600))).toEqual({
      width: 20,
      height: 10,
      dpi: { x: 600, y: 600 },
      jfif: true,
    })
  })
})
