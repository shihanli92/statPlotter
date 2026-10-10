import type { FontId } from '@ps/model'
import { FONTS } from './manifest.ts'

const NONE: readonly FontId[] = []
const seen = new WeakMap<object, readonly FontId[]>()

/**
 * The font families plain data names (every `font` field holding a bundled family's id, at any
 * depth), e.g. a document, so they can be loaded before it is drawn (audit 2 P5). Each object's
 * answer is kept, so scanning the next version of a document only walks what changed.
 */
export function fontsUsedBy(value: unknown): Set<FontId> {
  return new Set(typeof value === 'object' && value !== null ? scan(value) : NONE)
}

function scan(value: object): readonly FontId[] {
  const known = seen.get(value)
  if (known) return known
  let found: Set<FontId> | null = null
  const add = (ids: readonly FontId[]) => {
    if (!ids.length) return
    found ??= new Set()
    for (const id of ids) found.add(id)
  }
  if (Array.isArray(value)) {
    for (const v of value) if (typeof v === 'object' && v !== null) add(scan(v))
  } else {
    for (const [k, v] of Object.entries(value)) {
      if (typeof v === 'object' && v !== null) add(scan(v))
      else if (k === 'font' && typeof v === 'string' && Object.hasOwn(FONTS, v)) add([v as FontId])
    }
  }
  const ids: readonly FontId[] = found ? [...found] : NONE
  seen.set(value, ids)
  return ids
}
