import { describe, expect, it } from 'vitest'
import {
  CELLS_TABLE_ROWS,
  createTable,
  GraphNode,
  isCellsTable,
  naturalCompare,
  orderedLevels,
} from '../src/index.ts'

// Roadmap 34f: natural order of levels (decision 434) and cells tables (decision 430).

const sorted = (xs: readonly string[]) => [...xs].sort(naturalCompare)

describe('natural order', () => {
  it('reads numbers inside the text by value', () => {
    expect(sorted(['C10', 'C2', 'C1', 'C0', 'C11', 'C3'])).toEqual([
      'C0',
      'C1',
      'C2',
      'C3',
      'C10',
      'C11',
    ])
    // Seurat's cluster numbers as text.
    expect(sorted(['10', '2', '0', '1', '13', '9'])).toEqual(['0', '1', '2', '9', '10', '13'])
    // Several numbers in one name, and numbers longer than a double holds exactly.
    expect(sorted(['S1_r10', 'S1_r2', 'S10_r1', 'S2_r1'])).toEqual([
      'S1_r2',
      'S1_r10',
      'S2_r1',
      'S10_r1',
    ])
    expect(sorted(['x123456789012345678901', 'x123456789012345678900', 'x99'])).toEqual([
      'x99',
      'x123456789012345678900',
      'x123456789012345678901',
    ])
  })

  it('puts fewer leading zeros first among equal numbers', () => {
    expect(sorted(['007', '7', '07', '8', '06'])).toEqual(['06', '7', '07', '007', '8'])
    expect(sorted(['C01', 'C1', 'C001', 'C2'])).toEqual(['C1', 'C01', 'C001', 'C2'])
    expect(naturalCompare('0', '00')).toBeLessThan(0)
  })

  it('ignores case and accents first, then tells them apart the same on every machine', () => {
    expect(sorted(['cherry', 'Banana', 'apple'])).toEqual(['apple', 'Banana', 'cherry'])
    // Equal but for case: upper case first (by code point), always.
    expect(sorted(['b', 'B', 'a', 'A'])).toEqual(['A', 'a', 'B', 'b'])
    // Accents fold for the first comparison: é sorts with e, after the plain e.
    expect(sorted(['f', 'é', 'e', 'd'])).toEqual(['d', 'e', 'é', 'f'])
    expect(sorted(['Zoë', 'Zoe', 'Zeta'])).toEqual(['Zeta', 'Zoe', 'Zoë'])
  })

  it('orders unicode by code point, astral characters after the basic plane', () => {
    expect(naturalCompare('😀', '￿')).toBeGreaterThan(0)
    expect(sorted(['β', 'α', 'a'])).toEqual(['a', 'α', 'β'])
    expect(sorted(['CD8 T', 'CD4 T', 'CD14 Mono'])).toEqual(['CD4 T', 'CD8 T', 'CD14 Mono'])
  })

  it('puts digits before letters, and shorter texts (a prefix) first', () => {
    expect(sorted(['b', '1', 'a', '10'])).toEqual(['1', '10', 'a', 'b'])
    expect(sorted(['C1a', 'C1', 'C'])).toEqual(['C', 'C1', 'C1a'])
    expect(sorted(['', 'a'])).toEqual(['', 'a'])
  })

  it('is a total order: antisymmetric, and transitive on a shuffled mix', () => {
    const xs = ['C2', 'c2', 'C02', 'C10', 'c10', 'é1', 'e1', 'E1', '10', '9', 'x', 'X', '', '😀']
    for (const a of xs)
      for (const b of xs) {
        expect(Math.sign(naturalCompare(a, b)) === -Math.sign(naturalCompare(b, a))).toBe(true)
        if (a !== b) expect(naturalCompare(a, b)).not.toBe(0)
      }
    const once = sorted(xs)
    expect(sorted([...xs].reverse())).toEqual(once)
    for (let i = 1; i < once.length; i++)
      expect(naturalCompare(once[i - 1]!, once[i]!)).toBeLessThan(0)
  })
})

describe('orderedLevels with an order for the levels not stored', () => {
  const present = ['C10', 'C2', 'C1']
  it('keeps the table’s order by default (graphs made before roadmap 34f)', () => {
    expect(orderedLevels(present)).toEqual(['C10', 'C2', 'C1'])
    expect(orderedLevels(present, undefined, 'appearance')).toEqual(['C10', 'C2', 'C1'])
  })
  it('sorts them naturally for natural graphs', () => {
    expect(orderedLevels(present, undefined, 'natural')).toEqual(['C1', 'C2', 'C10'])
  })
  it('puts a stored order first, new levels after it in the graph’s order', () => {
    expect(orderedLevels([...present, 'C3'], ['C2'], 'natural')).toEqual(['C2', 'C1', 'C3', 'C10'])
    expect(orderedLevels([...present, 'C3'], ['C2'])).toEqual(['C2', 'C10', 'C1', 'C3'])
    // Gone levels stay stored but aren't listed.
    expect(orderedLevels(['C1'], ['C9', 'C1'], 'natural')).toEqual(['C1'])
  })
  it('is an optional graph field: absent on old documents, validated when present', () => {
    expect(GraphNode.shape.levelOrder.safeParse(undefined).success).toBe(true)
    expect(GraphNode.shape.levelOrder.safeParse('natural').success).toBe(true)
    expect(GraphNode.shape.levelOrder.safeParse('alphabetical').success).toBe(false)
  })
})

describe('cells tables', () => {
  const mv = (rows: number, cellsTable?: boolean) => {
    const t = createTable({ tableKind: 'multipleVariables', rows: 1, columns: 1 })
    return { ...t, rowCount: rows, ...(cellsTable === undefined ? {} : { cellsTable }) }
  }
  it('are multiple-variables tables of more than 20,000 rows, unless set', () => {
    expect(CELLS_TABLE_ROWS).toBe(20_000)
    expect(isCellsTable(mv(20_000))).toBe(false)
    expect(isCellsTable(mv(20_001))).toBe(true)
    expect(isCellsTable(mv(100, true))).toBe(true)
    expect(isCellsTable(mv(1_000_000, false))).toBe(false)
  })
  it('are never other kinds of table', () => {
    const col = createTable({ tableKind: 'column', rows: 1, columns: 1 })
    expect(isCellsTable({ ...col, rowCount: 50_000 })).toBe(false)
    expect(isCellsTable({ ...col, cellsTable: true })).toBe(false)
  })
})
