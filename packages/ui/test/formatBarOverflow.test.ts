import { describe, expect, it } from 'vitest'
import { FOLD_ORDER, type FoldUnit, foldedGroups, sameFolded } from '../src/formatBar/overflow.ts'

// Roadmap 47: the format bar's groups that don't fit fold into "More ▾" — the actions first
// (Format…, the painter, Reset position), then Symbols, Line, Fill, Text; the name never.

/** The bar's groups at their widths in Chromium (px, with the gap after each). */
const UNITS: FoldUnit[] = [
  { id: 'text', width: 256 },
  { id: 'fill', width: 43 },
  { id: 'line', width: 156 },
  { id: 'symbols', width: 97 },
  { id: 'reset', width: 35 },
  { id: 'painter', width: 28 },
  { id: 'format', width: 62 },
]
const NAME = 66
const MORE = 60
const total = UNITS.reduce((n, u) => n + u.width, NAME)
const fold = (available: number, units = UNITS) => [...foldedGroups(available, NAME, units, MORE)]

describe('the format bar’s overflow', () => {
  it('folds nothing while everything fits', () => {
    expect(fold(total)).toEqual([])
    expect(fold(2000)).toEqual([])
  })

  it('folds the actions first, then Symbols, Line, Fill and Text, keeping room for More', () => {
    // One pixel short: the last action folds, and More must fit too.
    expect(fold(total - 1)).toEqual(['format'])
    expect(fold(total - 62 + MORE)).toEqual(['format'])
    expect(fold(total - 62 + MORE - 1)).toEqual(['format', 'painter'])
    expect(fold(total - 62 - 28 - 35 + MORE)).toEqual(['format', 'painter', 'reset'])
    // The docked Format panel at 1,210 px: a bar of 638 px.
    expect(fold(638)).toEqual(['format', 'painter', 'reset', 'symbols'])
    expect(fold(400)).toEqual(['format', 'painter', 'reset', 'symbols', 'line', 'fill'])
    // Narrower than the name and More: everything folds (the legend's Layout isn't in this bar).
    expect(fold(100)).toEqual(FOLD_ORDER.filter((id) => id !== 'layout'))
  })

  it('folds the legend’s Layout after the actions, before Symbols (roadmap 47b)', () => {
    const legend = [...UNITS.slice(0, 4), { id: 'layout' as const, width: 90 }, ...UNITS.slice(4)]
    const all = total + 90
    expect(fold(all, legend)).toEqual([])
    expect(fold(all - 62 - 28 - 35 + MORE - 1, legend)).toEqual([
      'format',
      'painter',
      'reset',
      'layout',
    ])
    expect(fold(100, legend)).toEqual(FOLD_ORDER)
  })

  it('folds only the groups the bar has (a bar without Format…), and remembers nothing', () => {
    const page = UNITS.filter((u) => u.id !== 'format')
    // One short: the painter folds, and Reset position to make room for More.
    expect(fold(total - 62 - 1, page)).toEqual(['painter', 'reset'])
    // Wider again: unfolded.
    expect(fold(total, page)).toEqual([])
  })

  it('compares answers as sets', () => {
    expect(sameFolded(new Set(['format', 'reset']), new Set(['reset', 'format']))).toBe(true)
    expect(sameFolded(new Set(['format']), new Set(['reset']))).toBe(false)
    expect(sameFolded(new Set(), new Set(['reset']))).toBe(false)
  })
})
