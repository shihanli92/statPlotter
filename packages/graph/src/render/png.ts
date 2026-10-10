import { unzlibSync } from 'fflate'

// A PNG decoder for the PDF writer (roadmap 32): any PNG (grey, RGB, palette, with alpha, 1 to 16
// bits, interlaced or not) as 8-bit RGB samples and, when it has transparency, 8-bit alpha — the
// image and soft mask a PDF image XObject takes.

export interface DecodedPng {
  width: number
  height: number
  /** Rows of R, G, B bytes. */
  rgb: Uint8Array
  /** One byte per pixel; null when the image is opaque. */
  alpha: Uint8Array | null
}

const u32 = (b: Uint8Array, at: number) =>
  ((b[at]! << 24) >>> 0) + (b[at + 1]! << 16) + (b[at + 2]! << 8) + b[at + 3]!

/** Samples per pixel by colour type. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

/** Adam7 passes: x0, y0, dx, dy. */
const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const

export function decodePng(b: Uint8Array): DecodedPng {
  let at = 8
  let width = 0
  let height = 0
  let depth = 8
  let type = 0
  let interlace = 0
  let palette: Uint8Array | null = null
  let trns: Uint8Array | null = null
  const idat: Uint8Array[] = []
  while (at + 8 <= b.length) {
    const len = u32(b, at)
    const name = String.fromCharCode(...b.subarray(at + 4, at + 8))
    const data = b.subarray(at + 8, at + 8 + len)
    if (name === 'IHDR') {
      width = u32(data, 0)
      height = u32(data, 4)
      depth = data[8]!
      type = data[9]!
      interlace = data[12]!
    } else if (name === 'PLTE') palette = data
    else if (name === 'tRNS') trns = data
    else if (name === 'IDAT') idat.push(data)
    else if (name === 'IEND') break
    at += 12 + len
  }
  const channels = CHANNELS[type]
  if (!channels || !width || !height) throw new Error('Unsupported or damaged PNG')
  const joined = new Uint8Array(idat.reduce((s, d) => s + d.length, 0))
  let o = 0
  for (const d of idat) {
    joined.set(d, o)
    o += d.length
  }
  const raw = unzlibSync(joined)
  const bpp = Math.max(1, (channels * depth) >> 3)

  const rgb = new Uint8Array(width * height * 3)
  const hasAlpha = type === 4 || type === 6 || trns !== null
  const alpha = hasAlpha ? new Uint8Array(width * height).fill(255) : null
  const max = (1 << depth) - 1

  /** Sample k of a pixel in an unfiltered row, scaled to 0–255 (palette index as is). */
  const sample = (row: Uint8Array, x: number, k: number): number => {
    if (depth === 8) return row[x * channels + k]!
    if (depth === 16) return row[(x * channels + k) * 2]!
    const bit = (x * channels + k) * depth
    const v = (row[bit >> 3]! >> (8 - depth - (bit & 7))) & max
    return type === 3 ? v : Math.round((v * 255) / max)
  }
  /** The raw value of a grey or RGB sample, for comparing with tRNS. */
  const rawSample = (row: Uint8Array, x: number, k: number): number => {
    if (depth === 16) return (row[(x * channels + k) * 2]! << 8) | row[(x * channels + k) * 2 + 1]!
    if (depth === 8) return row[x * channels + k]!
    const bit = (x * channels + k) * depth
    return (row[bit >> 3]! >> (8 - depth - (bit & 7))) & max
  }
  const put = (row: Uint8Array, x: number, px: number) => {
    const p = px * 3
    switch (type) {
      case 0: {
        const g = sample(row, x, 0)
        rgb[p] = rgb[p + 1] = rgb[p + 2] = g
        if (trns && trns.length >= 2 && rawSample(row, x, 0) === ((trns[0]! << 8) | trns[1]!))
          alpha![px] = 0
        return
      }
      case 2:
        for (let k = 0; k < 3; k++) rgb[p + k] = sample(row, x, k)
        if (
          trns &&
          trns.length >= 6 &&
          [0, 1, 2].every(
            (k) => rawSample(row, x, k) === ((trns![2 * k]! << 8) | trns![2 * k + 1]!),
          )
        )
          alpha![px] = 0
        return
      case 3: {
        const i = sample(row, x, 0)
        if (palette) for (let k = 0; k < 3; k++) rgb[p + k] = palette[i * 3 + k] ?? 0
        if (trns && i < trns.length) alpha![px] = trns[i]!
        return
      }
      case 4:
        rgb[p] = rgb[p + 1] = rgb[p + 2] = sample(row, x, 0)
        alpha![px] = sample(row, x, 1)
        return
      case 6:
        for (let k = 0; k < 3; k++) rgb[p + k] = sample(row, x, k)
        alpha![px] = sample(row, x, 3)
    }
  }

  let pos = 0
  /** Unfilters `rows` rows of `w` pixels, handing each row to `emit`. */
  const pass = (w: number, rows: number, emit: (row: Uint8Array, y: number) => void) => {
    if (!w || !rows) return
    const stride = Math.ceil((w * channels * depth) / 8)
    let prev = new Uint8Array(stride)
    for (let y = 0; y < rows; y++) {
      const filter = raw[pos++]
      const row = raw.slice(pos, pos + stride)
      pos += stride
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? row[i - bpp]! : 0
        const up = prev[i]!
        const c = i >= bpp ? prev[i - bpp]! : 0
        let add = 0
        if (filter === 1) add = a
        else if (filter === 2) add = up
        else if (filter === 3) add = (a + up) >> 1
        else if (filter === 4) {
          const pa = Math.abs(up - c)
          const pb = Math.abs(a - c)
          const pc = Math.abs(a + up - 2 * c)
          add = pa <= pb && pa <= pc ? a : pb <= pc ? up : c
        }
        row[i] = (row[i]! + add) & 255
      }
      emit(row, y)
      prev = row
    }
  }

  if (interlace) {
    for (const [x0, y0, dx, dy] of ADAM7) {
      const w = Math.ceil((width - x0) / dx)
      const h = Math.ceil((height - y0) / dy)
      if (w <= 0 || h <= 0) continue
      pass(w, h, (row, y) => {
        for (let x = 0; x < w; x++) put(row, x, (y0 + y * dy) * width + x0 + x * dx)
      })
    }
  } else {
    pass(width, height, (row, y) => {
      for (let x = 0; x < width; x++) put(row, x, y * width + x)
    })
  }
  // An alpha channel that is fully opaque needs no mask.
  const opaque = alpha?.every((v) => v === 255) ?? true
  return { width, height, rgb, alpha: opaque ? null : alpha }
}
