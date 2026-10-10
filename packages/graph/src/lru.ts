// Bounded caches (audit 2, G8 and G16): module-level caches keep at most a few entries, the least
// recently used going first, so a cycle through more entries than kept (a split set's graphs laid
// out in turn) evicts only what it hasn't used lately, and nothing grows without bound.

/** A map of at most `max` entries; reading or writing an entry makes it the most recent. */
export class Lru<K, V> {
  private readonly map = new Map<K, V>()

  constructor(readonly max: number) {}

  get size(): number {
    return this.map.size
  }

  has(key: K): boolean {
    return this.map.has(key)
  }

  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined
    const v = this.map.get(key) as V
    this.map.delete(key)
    this.map.set(key, v)
    return v
  }

  set(key: K, value: V): this {
    this.map.delete(key)
    this.map.set(key, value)
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value as K)
    return this
  }
}

/** The value for `key`, made (and kept) when missing. */
export function lruOf<K, V>(cache: Lru<K, V>, key: K, make: () => V): V {
  if (cache.has(key)) return cache.get(key) as V
  const v = make()
  cache.set(key, v)
  return v
}

/**
 * A cache of values per a path of objects (each kept weakly: entries go with any of them), then
 * per a short key, `max` kept per path. For results that depend on objects by identity — a table,
 * the rows a graph shows, the points a density is computed of — and a few parameters.
 */
export class WeakCache {
  private readonly root = new WeakMap<object, Node>()

  constructor(readonly max: number) {}

  get<T>(owners: readonly object[], key: string, make: () => T): T {
    let level = this.root
    let node: Node | undefined
    for (const o of owners) {
      node = level.get(o)
      if (!node) {
        node = { next: new WeakMap(), values: null }
        level.set(o, node)
      }
      level = node.next
    }
    if (!node) return make()
    node.values ??= new Lru(this.max)
    return lruOf(node.values as Lru<string, T>, key, make)
  }
}

interface Node {
  next: WeakMap<object, Node>
  values: Lru<string, unknown> | null
}
