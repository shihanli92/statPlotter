import { describe, expect, it } from 'vitest'
import { Lru, lruOf, WeakCache } from '../src/lru.ts'

// Audit 2 (G8, G16): the bounded caches.

describe('Lru', () => {
  it('keeps the entries used last, evicting the least recently used', () => {
    const c = new Lru<string, number>(3)
    c.set('a', 1).set('b', 2).set('c', 3)
    expect(c.get('a')).toBe(1)
    c.set('d', 4)
    // 'b' was used least recently ('a' was read after it).
    expect([c.has('a'), c.has('b'), c.has('c'), c.has('d')]).toEqual([true, false, true, true])
    expect(c.size).toBe(3)
    c.set('c', 30)
    c.set('e', 5)
    expect(c.has('a')).toBe(false)
    expect(c.get('c')).toBe(30)
  })

  it('a cycle through more keys than kept misses only what it cycles past', () => {
    const c = new Lru<number, number>(4)
    let made = 0
    for (let pass = 0; pass < 3; pass++) for (const k of [0, 1, 2]) lruOf(c, k, () => ++made)
    expect(made).toBe(3)
  })

  it('keeps null and undefined values as entries', () => {
    const c = new Lru<string, null | undefined>(2)
    let made = 0
    const make = () => {
      made++
      return null
    }
    lruOf(c, 'n', make)
    lruOf(c, 'n', make)
    expect(made).toBe(1)
  })
})

describe('WeakCache', () => {
  it('caches per path of objects, then key; each path keeps its own entries', () => {
    const cache = new WeakCache(2)
    const [a, b] = [{}, {}]
    let made = 0
    const get = (path: object[], key: string) => cache.get(path, key, () => ++made)
    expect(get([a], 'x')).toBe(1)
    expect(get([a], 'x')).toBe(1)
    expect(get([a, b], 'x')).toBe(2)
    expect(get([b], 'x')).toBe(3)
    // Three keys on one path: the oldest goes, other paths keep theirs.
    get([a], 'y')
    get([a], 'z')
    expect(get([a], 'x')).toBe(6)
    expect(get([a, b], 'x')).toBe(2)
    // No path: made every time.
    expect(cache.get([], 'x', () => 'fresh')).toBe('fresh')
  })
})
