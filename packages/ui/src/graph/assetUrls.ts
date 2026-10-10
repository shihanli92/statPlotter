import type { AssetStore } from '@ps/engine'
import { assetDataUrl } from '@ps/graph'
import type { ImageAsset } from '@ps/model'

// Images on pages are shown from object URLs of their bytes (one per image, made when first
// drawn). Audit 2, U23: they were never revoked, so every project opened kept the images of the
// ones before it alive. The URLs of images the asset store no longer holds (another project
// opened, a new one started) are revoked when the store changes. Audit 3, P3: point clouds' images
// (made by the screen, never in the store) have URLs of their own, held by the elements showing
// them (`HeldUrls`) and revoked a little after the last lets go, so a drag or an edit that
// redraws a cloud doesn't keep each image it made.

type Asset = Pick<ImageAsset, 'id' | 'mime' | 'bytes'>

const defaultCreate = (a: Asset): string =>
  typeof URL.createObjectURL === 'function'
    ? URL.createObjectURL(new Blob([a.bytes as BlobPart], { type: a.mime }))
    : assetDataUrl(a)

const defaultRevoke = (url: string): void => {
  if (url.startsWith('blob:')) URL.revokeObjectURL(url)
}

export class AssetUrls {
  private readonly urls = new Map<Uint8Array, { id: string; url: string }>()

  constructor(
    private readonly create: (a: Asset) => string = defaultCreate,
    private readonly revoke: (url: string) => void = defaultRevoke,
  ) {}

  /** The image's URL (made once per image's bytes). */
  url(a: Asset): string {
    let hit = this.urls.get(a.bytes)
    if (!hit) {
      hit = { id: a.id, url: this.create(a) }
      this.urls.set(a.bytes, hit)
    }
    return hit.url
  }

  /** Revokes the URLs of images `holds` no longer holds (by id, the same bytes). */
  release(holds: (id: string, bytes: Uint8Array) => boolean): void {
    for (const [bytes, { id, url }] of this.urls) {
      if (holds(id, bytes)) continue
      this.revoke(url)
      this.urls.delete(bytes)
    }
  }

  /** URLs held, for tests. */
  get size(): number {
    return this.urls.size
  }
}

/**
 * Object URLs held by the elements showing them: made when first asked for in a render, revoked
 * `graceMs` after the last element holding one lets go (or after it was made, when none took it:
 * a render never shown). The grace keeps a URL an element lets go of and takes again at once
 * (React's StrictMode runs effects twice; an element moved to another parent).
 */
export class HeldUrls {
  private readonly urls = new Map<
    Uint8Array,
    { url: string; holds: number; timer: ReturnType<typeof setTimeout> | null }
  >()

  constructor(
    private readonly create: (a: Asset) => string = defaultCreate,
    private readonly revoke: (url: string) => void = defaultRevoke,
    private readonly graceMs = 5000,
  ) {}

  /** The image's URL (made once per image's bytes while held). */
  url(a: Asset): string {
    let e = this.urls.get(a.bytes)
    if (!e) {
      e = { url: this.create(a), holds: 0, timer: null }
      this.urls.set(a.bytes, e)
      this.check(a.bytes)
    }
    return e.url
  }

  /** Holds the image's URL (made by `url`) until the returned function is called. */
  hold(a: Asset): () => void {
    const e = this.urls.get(a.bytes)
    if (!e) return () => {}
    e.holds++
    let held = true
    return () => {
      if (!held) return
      held = false
      e.holds--
      if (e.holds === 0) this.check(a.bytes)
    }
  }

  /** Revokes the URL `graceMs` from now unless it is held then. */
  private check(bytes: Uint8Array) {
    const e = this.urls.get(bytes)
    if (!e) return
    if (e.timer) clearTimeout(e.timer)
    e.timer = setTimeout(() => {
      e.timer = null
      if (e.holds > 0 || this.urls.get(bytes) !== e) return
      this.revoke(e.url)
      this.urls.delete(bytes)
    }, this.graceMs)
  }

  /** URLs held or in their grace, for tests. */
  get size(): number {
    return this.urls.size
  }
}

const shared = new AssetUrls()

/** An image's bytes as a URL the page can show (an object URL, kept while its store holds it). */
export const assetUrl = (a: Asset): string => shared.url(a)

/** The URLs of point clouds' images (audit 3, P3). */
export const cloudUrls = new HeldUrls()

/** Releases the URLs of images `store` stops holding, whenever it changes; returns the unsubscribe. */
export function releaseAssetUrlsWith(store: AssetStore, urls: AssetUrls = shared): () => void {
  return store.subscribe(() => urls.release((id, bytes) => store.get(id)?.bytes === bytes))
}
