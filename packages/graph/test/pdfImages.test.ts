import { describe, expect, it } from 'vitest'
import { type Scene, type SceneNode, sceneToPdf } from '../src/index.ts'
import { fonts } from './helpers.ts'
import { FIXTURE_H, FIXTURE_W, fixtureAlpha, fixtureAsset } from './images.ts'
import { deref, readPdf, streamText } from './pdfRead.ts'

// Roadmap 32: ellipses, paths, rounded rectangles and images in the PDF writer.

const sceneOf = (...children: SceneNode[]): Scene => ({
  width: 300,
  height: 200,
  root: { id: 'root', children },
  plot: { x: 0, y: 0, w: 300, h: 200 },
  warnings: [],
})
const stroke = { color: '#ff0000', width: 2, dash: 'solid' as const }
const png = fixtureAsset('rgba.png', 'b'.repeat(32))
const jpeg = fixtureAsset('photo.jpg', 'c'.repeat(32))
const cmyk = fixtureAsset('cmyk.jpg', 'd'.repeat(32))

const images = sceneOf(
  { id: 'a', prim: { type: 'image', x: 10, y: 20, w: 120, h: 70, asset: png } },
  {
    id: 'b',
    prim: {
      type: 'image',
      x: 150,
      y: 20,
      w: 60,
      h: 70,
      asset: jpeg,
      crop: { x: 0.5, y: 0, w: 0.5, h: 1 },
    },
  },
  // The same picture again: embedded once.
  { id: 'c', prim: { type: 'image', x: 10, y: 100, w: 24, h: 14, asset: png } },
  { id: 'd', prim: { type: 'image', x: 220, y: 100, w: 24, h: 14, asset: cmyk } },
)

/** The image XObjects of the page, by name. */
function xobjects(bytes: Uint8Array) {
  const pdf = readPdf(bytes)
  const catalog = deref(pdf, pdf.trailer, 'Root')
  const page = deref(pdf, deref(pdf, catalog.dict, 'Pages').dict, 'Kids \\[')
  const refs = /\/XObject << ([^>]*) >>/.exec(page.dict)![1]!
  const out = new Map<string, ReturnType<typeof deref>>()
  for (const m of refs.matchAll(/\/(\w+) (\d+) 0 R/g))
    out.set(m[1]!, deref(pdf, `/X ${m[2]} 0 R`, 'X'))
  return { pdf, page, out, content: streamText(deref(pdf, page.dict, 'Contents')) }
}

describe('sceneToPdf: shapes', () => {
  it('draws ellipses and rounded rectangles as Béziers and paths as their segments', () => {
    const bytes = sceneToPdf(
      sceneOf(
        { id: 'e', prim: { type: 'ellipse', cx: 50, cy: 50, rx: 40, ry: 20, stroke, fill: null } },
        {
          id: 'r',
          prim: {
            type: 'rect',
            x: 100,
            y: 20,
            w: 80,
            h: 40,
            rx: 8,
            stroke: null,
            fill: { color: '#00ff00', opacity: 0.5 },
          },
        },
        {
          id: 'p',
          prim: {
            type: 'path',
            d: [
              ['M', 200, 10],
              ['L', 210, 20],
              ['L', 200, 30],
            ],
            stroke,
            fill: null,
          },
        },
      ),
      fonts,
      { compress: false },
    )
    const { content } = xobjects2(bytes)
    expect(content).toContain('90 50 m 90 61.046 72.091 70 50 70 c')
    expect(content).toMatch(/108 20 m 172 20 l .* c .* h f/)
    expect(content).toContain('200 10 m 210 20 l 200 30 l S')
  })
})

/** Like `xobjects`, for pages without images. */
function xobjects2(bytes: Uint8Array) {
  const pdf = readPdf(bytes)
  const catalog = deref(pdf, pdf.trailer, 'Root')
  const page = deref(pdf, deref(pdf, catalog.dict, 'Pages').dict, 'Kids \\[')
  return { page, content: streamText(deref(pdf, page.dict, 'Contents')) }
}

describe('sceneToPdf: images', () => {
  it('embeds a JPEG as is, a PNG as RGB with its alpha as a soft mask, each once', () => {
    const { out, content, page } = xobjects(sceneToPdf(images, fonts, { compress: false }))
    expect([...out.keys()]).toEqual(['Im1', 'Im2', 'Im3'])
    const im1 = out.get('Im1')!
    expect(im1.dict).toContain(`/Width ${FIXTURE_W} /Height ${FIXTURE_H} /BitsPerComponent 8`)
    expect(im1.dict).toContain('/ColorSpace /DeviceRGB')
    expect(im1.stream!.length).toBe(FIXTURE_W * FIXTURE_H * 3)
    const mask = readPdf(sceneToPdf(images, fonts)).objects.get(
      Number(/\/SMask (\d+) 0 R/.exec(im1.dict)![1]),
    )!
    expect(mask.dict).toContain('/ColorSpace /DeviceGray')
    expect(mask.stream![3 * FIXTURE_W + 5]).toBe(fixtureAlpha(5, 3))
    const im2 = out.get('Im2')!
    expect(im2.dict).toContain('/Filter /DCTDecode')
    expect(im2.stream).toEqual(jpeg.bytes)
    // Adobe CMYK JPEGs are inverted.
    expect(out.get('Im3')!.dict).toContain('/ColorSpace /DeviceCMYK /Decode [1 0 1 0 1 0 1 0]')
    // Clipped to the box; the crop's left half pushed out of it.
    expect(content).toContain('10 20 120 70 re W n\n120 0 0 -70 10 90 cm /Im1 Do')
    expect(content).toContain('150 20 60 70 re W n\n120 0 0 -70 90 90 cm /Im2 Do')
    expect(content.match(/\/Im1 Do/g)!.length).toBe(2)
    // The soft mask blends in a transparency group.
    expect(page.dict).toContain('/Group << /Type /Group /S /Transparency /CS /DeviceRGB >>')
  })

  it('reads in pdf.js with every image painted', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const task = pdfjs.getDocument({ data: sceneToPdf(images, fonts), verbosity: 0 })
    const doc = await task.promise
    const ops = await (await doc.getPage(1)).getOperatorList()
    const painted = ops.fnArray.filter((f) => f === pdfjs.OPS.paintImageXObject).length
    expect(painted).toBe(4)
    await task.destroy()
  })

  it('draws a grey box for an image it can’t read', () => {
    const broken = { ...png, bytes: png.bytes.slice(0, 40) }
    const s = sceneOf({ id: 'x', prim: { type: 'image', x: 1, y: 2, w: 3, h: 4, asset: broken } })
    const { content } = xobjects2(sceneToPdf(s, fonts, { compress: false }))
    expect(content).toContain('1 2 3 4 re f')
    expect(content).not.toContain(' Do')
  })
})
