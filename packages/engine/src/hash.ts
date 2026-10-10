import type { NormalizedDataSet } from '@ps/model'

/**
 * cyrb53-style 53-bit string/byte hash. Used for result-cache keys, where a collision would only
 * show a stale result, and 53 bits makes that vanishingly unlikely at our scale.
 */
class Hasher {
  private h1 = 0xdeadbeef
  private h2 = 0x41c6ce57

  u32(v: number): this {
    this.h1 = Math.imul(this.h1 ^ v, 2654435761)
    this.h2 = Math.imul(this.h2 ^ v, 1597334677)
    return this
  }

  str(s: string): this {
    this.u32(s.length)
    for (let i = 0; i < s.length; i++) this.u32(s.charCodeAt(i))
    return this
  }

  floats(a: Float64Array | null | undefined): this {
    if (!a) return this.u32(0xffffffff)
    this.u32(a.length)
    // Hash the exact bit patterns; NaN payloads are all the canonical NaN from normalize.
    const words = new Uint32Array(a.buffer, a.byteOffset, a.length * 2)
    for (let i = 0; i < words.length; i++) this.u32(words[i]!)
    return this
  }

  digest(): string {
    let { h1, h2 } = this
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
  }
}

const dataSetHashes = new WeakMap<NormalizedDataSet, string>()

/** Content hash of a normalized data set, memoized per object (normalize caches objects). */
export function hashDataSet(ds: NormalizedDataSet): string {
  const hit = dataSetHashes.get(ds)
  if (hit) return hit
  const h = new Hasher().str(ds.ref.node).str(ds.ref.key).str(ds.title).u32(ds.rowCount)
  for (const t of ds.rowTitles ?? []) h.str(t ?? '\u0000')
  h.floats(ds.x)
  if (ds.data.shape === 'replicates') {
    h.str('replicates')
    for (const r of ds.data.reps) h.floats(r)
  } else {
    const d = ds.data
    h.str('summary').floats(d.mean).floats(d.sd).floats(d.sem).floats(d.n).floats(d.lo).floats(d.hi)
  }
  h.u32(ds.counts.empty).u32(ds.counts.excluded)
  // Text and calculated variables (absent elsewhere, so other keys are unchanged).
  if (ds.text) {
    h.str('text')
    for (const t of ds.text) h.str(t ?? '\u0000')
  }
  if (ds.formula !== undefined) h.str('formula').str(ds.formula)
  const digest = h.digest()
  dataSetHashes.set(ds, digest)
  return digest
}

export function hashStrings(parts: readonly string[]): string {
  const h = new Hasher()
  for (const p of parts) h.str(p)
  return h.digest()
}
