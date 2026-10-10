import { BIG_ARRAY } from './docPatches.ts'

// Copies of plain document data (objects, arrays, primitives). Anything else (a Date, a Map, a
// class instance) is not document data: it is kept as it is, for validation to refuse.

const isPlain = (v: object) => {
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

/** A deep copy of plain document data (objects, arrays, primitives). */
export function copyData<T>(v: T): T {
  if (Array.isArray(v)) return v.map(copyData) as T
  if (v !== null && typeof v === 'object' && isPlain(v)) {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v)) out[k] = copyData(x)
    return out as T
  }
  return v
}

/**
 * A copy of document data a command stores (audit 2, M8): every object and array copied, so
 * later commands of the same batch (which write inside what the document holds) and `freezeDoc`
 * never reach the caller's value, except arrays of `BIG_ARRAY` elements or more (a table's
 * per-row cells), which are shared: nothing writes them in place (edits replace them whole) and
 * the document leaves them unfrozen.
 */
export function copyDoc<T>(v: T): T {
  if (Array.isArray(v)) return (v.length >= BIG_ARRAY ? v : v.map(copyDoc)) as T
  if (v !== null && typeof v === 'object' && isPlain(v)) {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v)) out[k] = copyDoc(x)
    return out as T
  }
  return v
}
