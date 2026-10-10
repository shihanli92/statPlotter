import { jpegWithDpi } from '@ps/graph'
import { type RasterTile, WHITE } from './figureFiles.ts'

// Figure images (roadmap 27): the browser draws each tile's SVG (made by the export worker, or on
// this thread where there is none, roadmap 42) through an <img> onto a canvas, which needs the
// DOM; the pixels go back to whoever encodes them (`figureFiles.ts`' `RasterJob`).

/** Draws an SVG (sized in pixels) onto a new canvas; `fill` first where given. */
async function drawSvg(svg: string, w: number, h: number, fill: string | null) {
  const img = new Image()
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  try {
    img.src = url
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error(`the browser refused a ${w} × ${h} pixel canvas`)
    if (fill) {
      ctx.fillStyle = fill
      ctx.fillRect(0, 0, w, h)
    }
    ctx.drawImage(img, 0, 0, w, h)
    return canvas
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** A tile's pixels (RGBA): its SVG drawn by the browser. */
export type DrawTile = (svg: string, w: number, h: number) => Promise<Uint8ClampedArray>

export const drawTile: DrawTile = async (svg, w, h) => {
  const canvas = await drawSvg(svg, w, h, null)
  const data = canvas.getContext('2d')!.getImageData(0, 0, w, h).data
  canvas.width = 0 // free the canvas' memory now (Safari counts it until collected)
  return data
}

/**
 * A PNG or TIFF being made, wherever its SVGs come from and its pixels go: the tiles in order,
 * each one's SVG, its pixels put back (`put` resolves to the fraction written when a band is
 * complete), then the file.
 */
export interface RasterRun {
  tiles: readonly RasterTile[]
  svg(i: number): Promise<string>
  put(i: number, rgba: Uint8ClampedArray): Promise<number | null>
  finish(): Promise<Uint8Array>
}

/**
 * Draws every tile of `run` and returns the file. The next tile's SVG is asked for while one is
 * drawn (the worker makes it meanwhile).
 */
export async function rasterize(
  run: RasterRun,
  onProgress?: (done: number) => void,
  draw: DrawTile = drawTile,
): Promise<Uint8Array> {
  const ask = (i: number) => {
    const p = run.svg(i)
    p.catch(() => {}) // awaited below; a failure while a tile is drawn isn't unhandled
    return p
  }
  let next = run.tiles.length ? ask(0) : null
  for (const [i, t] of run.tiles.entries()) {
    const svg = await next!
    next = i + 1 < run.tiles.length ? ask(i + 1) : null
    const done = await run.put(i, await draw(svg, t.w, t.h))
    if (done !== null) onProgress?.(done)
  }
  return run.finish()
}

/** A JPEG of an SVG drawn at w × h pixels on white, at `quality` (0–1), with its density. */
export async function jpegOf(
  image: { w: number; h: number; svg: string },
  dpi: number,
  quality: number,
): Promise<Uint8Array> {
  const canvas = await drawSvg(image.svg, image.w, image.h, WHITE)
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('JPEG encoding failed'))),
      'image/jpeg',
      quality,
    ),
  )
  canvas.width = 0
  return jpegWithDpi(new Uint8Array(await blob.arrayBuffer()), dpi)
}
