import { readImageAsset } from '@ps/io'
import type { ImageAsset } from '@ps/model'

// Getting images onto a layout page (roadmap 32): Insert › Image… (the platform's file picker),
// a paste of an image from the clipboard and files dropped on the page. PNG and JPEG only: SVG
// images can run scripts, and browsers can't show TIFF (`readImageAsset` says so).

/** The file types Insert › Image… offers (TIFF too, to explain it can't be placed). */
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'tif', 'tiff'] as const

/** An image file read into an asset (with the resolution its header records), or why not. */
export function imageAsset(bytes: Uint8Array): ImageAsset & { dpi?: number } {
  return readImageAsset(bytes)
}
