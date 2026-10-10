import { AssetStore } from '@ps/engine'
import type { AssetId, ImageAsset } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { AssetUrls, releaseAssetUrlsWith } from '../src/graph/assetUrls.ts'

// Audit 2, U23: the URLs images are shown from are revoked once the asset store no longer holds
// them (another project opened), and kept while it does.

const image = (id: string, n: number): ImageAsset =>
  ({
    id: id as AssetId,
    mime: 'image/png',
    bytes: new Uint8Array([n]),
    width: 1,
    height: 1,
  }) as ImageAsset

describe('image URLs', () => {
  it('are made once per image and revoked when another project replaces the store', () => {
    let made = 0
    const revoked: string[] = []
    const urls = new AssetUrls(
      () => `blob:${++made}`,
      (u) => revoked.push(u),
    )
    const store = new AssetStore()
    releaseAssetUrlsWith(store, urls)
    const a = store.add(image('a', 1))
    const b = store.add(image('b', 2))
    expect(urls.url(a)).toBe('blob:1')
    expect(urls.url(a)).toBe('blob:1')
    expect(urls.url(b)).toBe('blob:2')
    // Another image added: nothing revoked.
    store.add(image('c', 3))
    expect(revoked).toEqual([])
    // Another project, holding b (the same bytes) and new ones: a's URL goes, b's stays.
    store.replace([b, image('d', 4)])
    expect(revoked).toEqual(['blob:1'])
    expect(urls.size).toBe(1)
    expect(urls.url(b)).toBe('blob:2')
    store.replace([])
    expect(revoked).toEqual(['blob:1', 'blob:2'])
    expect(urls.size).toBe(0)
  })
})
