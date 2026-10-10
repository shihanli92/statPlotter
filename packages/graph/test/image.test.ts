import { describe, expect, it } from 'vitest'
import { assetDataUrl, base64, decodePng, ImageFormatError, imageInfo } from '../src/index.ts'
import { pngWriter } from '../src/render/raster.ts'
import { FIXTURE_H, FIXTURE_W, fixtureAlpha, fixtureBytes, fixtureRgb } from './images.ts'

const enc = new TextEncoder()

/** Every pixel of a decoded PNG against `rgb` and `alpha` formulas. */
function expectPixels(
  name: string,
  rgb: (x: number, y: number) => number[],
  alpha: ((x: number, y: number) => number) | null,
) {
  const d = decodePng(fixtureBytes(name))
  expect([d.width, d.height]).toEqual([FIXTURE_W, FIXTURE_H])
  for (let y = 0; y < FIXTURE_H; y++)
    for (let x = 0; x < FIXTURE_W; x++) {
      const i = y * FIXTURE_W + x
      expect([...d.rgb.subarray(i * 3, i * 3 + 3)], `${name} (${x}, ${y})`).toEqual(rgb(x, y))
      if (alpha) expect(d.alpha![i], `${name} alpha (${x}, ${y})`).toBe(alpha(x, y))
    }
  if (!alpha) expect(d.alpha).toBeNull()
}

describe('imageInfo', () => {
  it('reads PNG and JPEG sizes and resolutions from their headers', () => {
    expect(imageInfo(fixtureBytes('rgba.png'))).toEqual({
      mime: 'image/png',
      width: 12,
      height: 7,
    })
    expect(imageInfo(fixtureBytes('photo.jpg'))).toEqual({
      mime: 'image/jpeg',
      width: 12,
      height: 7,
      dpi: 300,
      components: 3,
    })
    expect(imageInfo(fixtureBytes('cmyk.jpg'))).toMatchObject({ components: 4, adobe: true })
    // pHYs: 144 dpi, as written in metres.
    const png = pngWriter(2, 1, { dpi: 144, alpha: false })
    png.write(new Uint8Array(8).fill(255))
    expect(imageInfo(png.finish()).dpi).toBeCloseTo(144, 0)
  })

  it('names what it refuses: TIFF, SVG, other formats, damaged files, huge images', () => {
    const tiff = Uint8Array.of(0x49, 0x49, 0x2a, 0, 8, 0, 0, 0)
    expect(() => imageInfo(tiff)).toThrow(/TIFF images can’t be placed/)
    expect(() => imageInfo(enc.encode('<?xml version="1.0"?>\n<svg xmlns="…"/>'))).toThrow(
      /SVG images aren’t supported/,
    )
    expect(() => imageInfo(enc.encode('<svg onload="x()"></svg>'))).toThrow(ImageFormatError)
    expect(() => imageInfo(enc.encode('GIF89a…'))).toThrow(/Only PNG and JPEG/)
    expect(() => imageInfo(enc.encode('hello'))).toThrow(/Not a PNG or JPEG/)
    expect(() => imageInfo(fixtureBytes('photo.jpg').subarray(0, 20))).toThrow(/damaged/)
    const huge = fixtureBytes('rgba.png').slice()
    new DataView(huge.buffer).setUint32(16, 30_000)
    expect(() => imageInfo(huge)).toThrow(/at most 20000 a side/)
  })
})

describe('decodePng', () => {
  it('decodes RGBA, grey, grey + alpha, 1- and 16-bit grey, palettes with tRNS, Adam7', () => {
    expectPixels('rgba.png', fixtureRgb, fixtureAlpha)
    expectPixels('interlaced.png', fixtureRgb, null)
    const g = (x: number, y: number) => (x * 20 + y) % 256
    expectPixels('gray.png', (x, y) => [g(x, y), g(x, y), g(x, y)], null)
    expectPixels('gray1.png', (x, y) => Array(3).fill(g(x, y) > 127 ? 255 : 0), null)
    expectPixels('grayalpha.png', (x) => Array(3).fill((x * 20) % 256), fixtureAlpha)
    const v16 = (x: number, y: number) => ((x * 5000 + y * 7) % 65536) >> 8
    expectPixels('gray16.png', (x, y) => Array(3).fill(v16(x, y)), null)
    const palette = [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [10, 20, 30],
    ]
    const trns = [255, 128, 0, 255]
    expectPixels(
      'palette.png',
      (x, y) => palette[(x + y) % 4]!,
      (x, y) => trns[(x + y) % 4]!,
    )
  })

  it('reads what the raster writer writes, and drops an alpha channel that is all opaque', () => {
    const w = pngWriter(3, 2, { dpi: 72, alpha: true })
    w.write(Uint8Array.from({ length: 24 }, (_, i) => (i % 4 === 3 ? 255 : i * 10)))
    const d = decodePng(w.finish())
    expect([...d.rgb]).toEqual([
      0, 10, 20, 40, 50, 60, 80, 90, 100, 120, 130, 140, 160, 170, 180, 200, 210, 220,
    ])
    expect(d.alpha).toBeNull()
  })
})

describe('data URLs', () => {
  it('encodes base64 as the platform does, and keeps one URL per image', () => {
    for (const n of [0, 1, 2, 3, 100, 70_001]) {
      const b = Uint8Array.from({ length: n }, (_, i) => (i * 37) % 256)
      expect(base64(b)).toBe(Buffer.from(b).toString('base64'))
    }
    const a = { mime: 'image/png' as const, bytes: fixtureBytes('rgba.png') }
    const url = assetDataUrl(a)
    expect(url.startsWith('data:image/png;base64,iVBOR')).toBe(true)
    expect(assetDataUrl(a)).toBe(url)
  })
})
