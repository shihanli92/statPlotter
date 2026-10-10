import { describe, expect, it } from 'vitest'
import {
  createTable,
  DataTable,
  GraphNode,
  isFormatted,
  labelPlain,
  labelRuns,
  mergeRuns,
  richPlain,
  richTitleOf,
  titleRuns,
  toLabel,
} from '../src/index.ts'

describe('rich text helpers', () => {
  it('merges runs of one format and drops empty ones', () => {
    expect(
      mergeRuns([
        { text: 'a' },
        { text: 'b', bold: undefined },
        { text: '' },
        { text: '2', sup: true },
        { text: '3', sup: true },
      ]),
    ).toEqual([{ text: 'ab' }, { text: '23', sup: true }])
  })

  it('keeps runs of other sizes, fonts or colours apart (roadmap 28b)', () => {
    expect(
      mergeRuns([
        { text: 'a', size: 14 },
        { text: 'b', size: 14 },
        { text: 'c', size: 16 },
        { text: 'd', color: { palette: 1 } },
        { text: 'e', color: { palette: 1 } },
        { text: 'f', color: { rgb: '#ff0000' } },
        { text: 'g', font: 'mono' },
      ]),
    ).toEqual([
      { text: 'ab', size: 14 },
      { text: 'c', size: 16 },
      { text: 'de', color: { palette: 1 } },
      { text: 'f', color: { rgb: '#ff0000' } },
      { text: 'g', font: 'mono' },
    ])
    expect(isFormatted([{ text: 'a', size: 9 }])).toBe(true)
    expect(isFormatted([{ text: 'a', color: { rgb: '#000000' } }])).toBe(true)
    // Older files and plain text parse as before; the new fields are optional.
    expect(
      GraphNode.shape.title.parse({ content: [{ text: 'x', size: 20, font: 'narrow' }] }),
    ).toEqual({ content: [{ text: 'x', size: 20, font: 'narrow' }] })
  })

  it('tells formatted text from plain', () => {
    expect(isFormatted([{ text: 'a' }, { text: 'b' }])).toBe(false)
    expect(isFormatted([{ text: 'a', underline: true }])).toBe(true)
    // An explicit "not bold" run is formatting (it undoes a bold style).
    expect(isFormatted([{ text: 'a', bold: false }])).toBe(true)
    expect(isFormatted([{ text: '', italic: true }])).toBe(false)
  })

  it('stores labels as strings when plain', () => {
    expect(toLabel([{ text: 'p ' }, { text: '< 0.05' }])).toBe('p < 0.05')
    const rich = toLabel([{ text: 'n', italic: true }, { text: ' = 3' }])
    expect(rich).toEqual([{ text: 'n', italic: true }, { text: ' = 3' }])
    expect(labelPlain(rich)).toBe('n = 3')
    expect(labelRuns('x')).toEqual([{ text: 'x' }])
    expect(labelRuns(undefined)).toEqual([])
  })

  it('uses a rich title only while it spells the plain one', () => {
    const rich = [{ text: 'IC' }, { text: '50', sub: true }]
    expect(titleRuns('IC50', rich)).toBe(rich)
    expect(titleRuns('IC 50', rich)).toEqual([{ text: 'IC 50' }])
    expect(titleRuns('A', undefined)).toEqual([{ text: 'A' }])
    expect(richTitleOf([{ text: 'A' }])).toBeUndefined()
    expect(richPlain(richTitleOf(rich))).toBe('IC50')
  })

  it('loads documents with and without rich forms', () => {
    const t = createTable({ tableKind: 'grouped', rows: 2 })
    expect(DataTable.safeParse(t).success).toBe(true)
    const rich = [{ text: 'a', italic: true }]
    const ok = { ...t, rowTitles: ['a', null], rowTitlesRich: [rich, null] }
    expect(DataTable.safeParse(ok).success).toBe(true)
    // The rich list follows the row titles.
    expect(
      DataTable.safeParse({ ...t, rowTitles: null, rowTitlesRich: [rich, null] }).success,
    ).toBe(false)
    expect(DataTable.safeParse({ ...ok, rowTitlesRich: [rich] }).success).toBe(false)
  })

  it('accepts old string labels and new runs', () => {
    const labels = GraphNode.shape.pointOverrides.unwrap().valueType.valueType.shape.label
    expect(labels.safeParse('x').success).toBe(true)
    expect(labels.safeParse([{ text: 'x', sup: true }]).success).toBe(true)
  })
})
