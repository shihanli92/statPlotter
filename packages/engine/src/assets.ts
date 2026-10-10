import { type AssetId, assetRefs, type ImageAsset, type Project } from '@ps/model'

/**
 * The project's binary assets (images placed on layout pages, roadmap 32), held beside the
 * document: the document refers to them by id (a hash of the bytes), so it stays plain data.
 *
 * While a project is open the store only grows: an image removed from a page, or added by a step
 * that is undone, keeps its bytes, so undo and redo can always bring it back. What is written to
 * a file (Save, recovery copies) is only what the document refers to (`referenced`); the rest is
 * dropped when another project replaces this one (`replace`).
 */
export class AssetStore {
  private map = new Map<AssetId, ImageAsset>()
  private listeners = new Set<() => void>()
  /** Changes whenever an asset is added or the store replaced. */
  version = 0

  get(id: AssetId | string): ImageAsset | undefined {
    return this.map.get(id as AssetId)
  }

  has(id: AssetId | string): boolean {
    return this.map.has(id as AssetId)
  }

  /** Adds an asset; one already held under its id (the same bytes) is kept. */
  add(asset: ImageAsset): ImageAsset {
    const had = this.map.get(asset.id)
    if (had) return had
    this.map.set(asset.id, asset)
    this.changed()
    return asset
  }

  /** Every asset (another project was opened, or a new one started). */
  replace(assets: Iterable<ImageAsset>): void {
    this.map = new Map([...assets].map((a) => [a.id, a]))
    this.changed()
  }

  /** The assets the document refers to (what a file of it holds). */
  referenced(project: Pick<Project, 'nodes'>): Map<AssetId, ImageAsset> {
    const out = new Map<AssetId, ImageAsset>()
    for (const id of assetRefs(project.nodes)) {
      const a = this.map.get(id)
      if (a) out.set(id, a)
    }
    return out
  }

  /** Bytes held, for memory reports. */
  get size(): number {
    let n = 0
    for (const a of this.map.values()) n += a.bytes.length
    return n
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private changed() {
    this.version++
    for (const fn of this.listeners) fn()
  }
}
