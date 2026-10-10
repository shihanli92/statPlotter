import { describe, expect, it } from 'vitest'
import {
  type ColumnId,
  createTable,
  DataTable,
  defaultColumnTitle,
  normalizeTable,
  tableIssues,
} from '../src/index.ts'

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))

describe('createTable', () => {
  it('creates a valid empty column table', () => {
    const t = createTable({ columns: 2, rows: 5 })
    expect(DataTable.parse(t)).toEqual(t)
    expect(t.dataSets.map((d) => d.title)).toEqual(['Group A', 'Group B'])
    expect(t.dataSets[0]!.subcolumns[0]!.values).toHaveLength(5)
  })

  it('forces one row for column tables with summary data', () => {
    const t = createTable({ yFormat: { type: 'summary', preset: 'meanSdN' }, rows: 10 })
    expect(t.rowCount).toBe(1)
    expect(t.dataSets[0]!.subcolumns).toHaveLength(3)
    expect(tableIssues(t)).toEqual([])
  })

  it('creates XY tables with an X column', () => {
    const t = createTable({ tableKind: 'xy', yFormat: { type: 'replicates', count: 3 } })
    expect(t.x?.subcolumns).toHaveLength(1)
    expect(tableIssues(t)).toEqual([])
  })
})

describe('defaultColumnTitle', () => {
  it('continues past Z like spreadsheet columns', () => {
    expect([0, 25, 26, 27, 701, 702].map(defaultColumnTitle)).toEqual([
      'Group A',
      'Group Z',
      'Group AA',
      'Group AB',
      'Group ZZ',
      'Group AAA',
    ])
  })
})

describe('table invariants', () => {
  const base = () => {
    const t = createTable({ columns: 2, rows: 3 })
    t.dataSets[0]!.subcolumns[0]!.values = [1, 2, null]
    return t
  }

  const messages = (t: unknown) => {
    const r = DataTable.safeParse(t)
    return r.success ? [] : r.error.issues.map((i) => i.message)
  }

  it('accepts a well-formed table', () => {
    expect(messages(base())).toEqual([])
  })

  it('rejects NaN and Infinity in cells', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const t = base()
      t.dataSets[0]!.subcolumns[0]!.values[2] = bad
      expect(DataTable.safeParse(t).success).toBe(false)
    }
  })

  it('rejects value arrays whose length differs from rowCount', () => {
    const t = base()
    t.dataSets[1]!.subcolumns[0]!.values.push(4)
    expect(messages(t)).toContain('expected 3 values, got 4')
  })

  it('rejects exclusion arrays whose length differs from rowCount', () => {
    const t = base()
    t.dataSets[0]!.subcolumns[0]!.excluded = [false]
    expect(messages(t)).toContain('expected 3 exclusion flags, got 1')
  })

  it('rejects a subcolumn count that does not match the format', () => {
    const t = base()
    t.dataSets[0]!.subcolumns.push(clone(t.dataSets[0]!.subcolumns[0]!))
    expect(messages(t)).toContain('expected 1 subcolumns, got 2')
  })

  it('rejects duplicate column ids', () => {
    const t = base()
    t.dataSets[1]!.id = t.dataSets[0]!.id as ColumnId
    expect(messages(t).some((m) => m.startsWith('duplicate column id'))).toBe(true)
  })

  it('rejects an X column on a column table, and a missing one on XY', () => {
    const t = base()
    t.x = { title: 'X', xFormat: 'numbers', subcolumns: [{ type: 'number', values: [1, 2, 3] }] }
    expect(messages(t)).toContain('column tables have no X column')

    const xy = createTable({ tableKind: 'xy' })
    xy.x = null
    expect(messages(xy)).toContain('xy tables require an X column')
  })

  it('rejects side-by-side replicates on column tables', () => {
    const t = createTable({ yFormat: { type: 'replicates', count: 2 } })
    expect(messages(t)).toContain('format not allowed for column tables')
  })

  it('rejects row titles of the wrong length', () => {
    const t = base()
    t.rowTitles = ['a', 'b']
    expect(messages(t)).toContain('expected 3 row titles, got 2')
  })

  it('fills defaulted fields when loading older/minimal JSON', () => {
    const raw = JSON.parse(JSON.stringify(base()))
    delete raw.notes
    delete raw.dataSets[0].subcolumns[0].type
    const t = DataTable.parse(raw)
    expect(t.notes).toBe('')
    expect(t.dataSets[0]!.subcolumns[0]!.type).toBe('number')
  })
})

describe('text and calculated variables (multiple-variables tables)', () => {
  it('are allowed in multiple-variables tables only, text sized to the rows', () => {
    const mv = createTable({ tableKind: 'multipleVariables', rows: 3, columns: 2 })
    mv.dataSets[0]!.text = ['WT', 'KO', null]
    mv.dataSets[1]!.formula = '=A*2'
    expect(tableIssues(mv)).toEqual([])
    const n = normalizeTable(mv)
    expect(n[0]!.text).toEqual(['WT', 'KO', null])
    expect(n[1]!.formula).toBe('=A*2')
    expect(n[1]!.text).toBeUndefined()

    mv.dataSets[0]!.text = ['WT']
    expect(tableIssues(mv).map((i) => i.message)).toContain('expected 3 text values, got 1')
    mv.dataSets[0]!.text = ['WT', 'KO', 'KO']
    mv.dataSets[0]!.formula = '=1'
    expect(tableIssues(mv).map((i) => i.message)).toContain(
      'a variable is text or calculated, not both',
    )

    const col = createTable({ rows: 3, columns: 1 })
    col.dataSets[0]!.text = ['a', 'b', 'c']
    expect(tableIssues(col).map((i) => i.message)).toContain(
      'text and calculated variables belong to multiple-variables tables',
    )
  })
})
