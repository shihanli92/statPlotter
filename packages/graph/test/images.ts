import { readFileSync } from 'node:fs'
import type { AssetId, ImageAsset } from '@ps/model'
import { imageInfo } from '../src/index.ts'

// Image fixtures (made with Pillow; `interlaced.png` written by hand as Adam7): 12 × 7 pixels
// whose samples follow the formulas below, so decoders can be checked pixel by pixel. Shared with
// the io and ui tests.

export const FIXTURE_W = 12
export const FIXTURE_H = 7
/** rgba.png, interlaced.png, photo.jpg (lossy): the colour of pixel (x, y). */
export const fixtureRgb = (x: number, y: number) => [
  (x * 20) % 256,
  (y * 30) % 256,
  ((x + y) * 9) % 256,
]
/** rgba.png, grayalpha.png: the alpha of pixel (x, y). */
export const fixtureAlpha = (x: number, y: number) => (x * 23 + y * 5) % 256

export const fixtureBytes = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)))

/** A fixture as an asset (its id a stand-in: the io package hashes real ones). */
export function fixtureAsset(name: string, id = 'a'.repeat(32)): ImageAsset {
  const bytes = fixtureBytes(name)
  const info = imageInfo(bytes)
  return { id: id as AssetId, mime: info.mime, width: info.width, height: info.height, bytes }
}
