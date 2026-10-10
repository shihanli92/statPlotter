import { describe, expect, it } from 'vitest'
import {
  createTable,
  isLevelKey,
  levelKey,
  levelOfKey,
  levelsInTable,
  orderedLevels,
  storedLevels,
} from '../src/index.ts'

// Levels of text variables (roadmap 34a): their keys, their table order, a graph's own order.

describe('levels', () => {
  it('keys a level by its text, safely and reversibly', () => {
    for (const t of ['Placebo', 'High dose', '__proto__', 'a/b', 'Ünïcødé ✓', '1'])
      expect(levelOfKey(levelKey(t))).toBe(t)
    expect(levelKey('Placebo')).toBe('lv_506c616365626f')
    expect(levelKey('__proto__')).not.toBe('__proto__')
    expect(levelKey('a/b')).not.toContain('/')
    expect(isLevelKey(levelKey('x'))).toBe(true)
    expect(isLevelKey('abc123')).toBe(false)
    expect(levelOfKey('abc')).toBeNull()
    // UTF-8 of every plane; a lone surrogate as U+FFFD.
    expect(levelKey('é😀')).toBe('lv_c3a9f09f9880')
    expect(levelKey('a\uD800')).toBe(levelKey('a�'))
  })

  it('lists a text variable’s levels in the order they first appear, trimmed, without empties', () => {
    const t = createTable({ tableKind: 'multipleVariables', columns: 1, rows: 6 })
    const ds = t.dataSets[0]!
    ds.text = [' B', 'A', null, '', 'B ', 'C']
    expect(levelsInTable(ds)).toEqual(['B', 'A', 'C'])
    // Excluded cells don't count; rows can be chosen.
    ds.subcolumns[0]!.excluded = [false, true, false, false, false, false]
    expect(levelsInTable(ds)).toEqual(['B', 'C'])
    expect(levelsInTable(ds, [5, 0])).toEqual(['C', 'B'])
  })

  it('orders levels by a stored order: new ones at the end, gone ones left out but kept', () => {
    expect(orderedLevels(['A', 'B', 'C'])).toEqual(['A', 'B', 'C'])
    expect(orderedLevels(['A', 'B', 'C'], ['C', 'A'])).toEqual(['C', 'A', 'B'])
    expect(orderedLevels(['A', 'B'], ['Z', 'B', 'B', 'A'])).toEqual(['B', 'A'])
    // Reordering what is shown keeps levels gone from the table, for when they come back.
    expect(storedLevels(['B', 'A'], ['Z', 'A', 'B'])).toEqual(['B', 'A', 'Z'])
    expect(orderedLevels(['A', 'B', 'Z'], ['B', 'A', 'Z'])).toEqual(['B', 'A', 'Z'])
  })
})
