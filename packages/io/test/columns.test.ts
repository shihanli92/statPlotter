import {
  APP_VERSION,
  type ColumnId,
  createProject,
  type DataTable,
  DataTable as DataTableSchema,
  type LimitFlag,
  type NodeId,
  type RichText,
} from '@ps/model'
import { unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { syntheticTable } from '../../model/test/synthetic.ts'
import { growthRatio } from '../../stats/test/timing.ts'
import {
  BINARY_TABLE_CELLS,
  ColumnFormatError,
  decodeColumn,
  encodeFlags,
  encodeLimits,
  encodeNumbers,
  encodeRich,
  encodeText,
  isEncodedOnce,
  MAX_COLUMN_ROWS,
  ProjectFileError,
  packProject,
  packTable,
  readProjectFile,
  resultsForFile,
  tableCells,
  writeProjectFile,
} from '../src/index.ts'

// Large tables' columns in project files (roadmap 34e): binary entries for tables over
// BINARY_TABLE_CELLS cells, JSON for the others; every value back exactly.

const NOW = new Date('2026-10-02T00:00:00Z')

function projectWith(table: DataTable) {
  const p = createProject('P', NOW)
  p.nodes[table.id] = table
  p.order.push(table.id)
  return p
}

/** A synthetic table with exclusions and row titles too. */
function bigTable(rows: number): DataTable {
  const t = syntheticTable({ rows, genes: 4, pcs: 2 })
  const gene = t.dataSets.find((d) => d.title === 'GENE1')!.subcolumns[0]!
  gene.excluded = Array.from({ length: rows }, (_, r) => r % 97 === 0)
  t.rowTitles = Array.from({ length: rows }, (_, r) => (r % 3 ? `cell ${r}` : null))
  return t
}

describe('binary columns', () => {
  it('numbers keep every value, empty cells, −0 and the extremes', () => {
    const values = [
      0,
      -0,
      1,
      -1.5,
      null,
      Number.MAX_VALUE,
      -Number.MAX_VALUE,
      Number.MIN_VALUE,
      2 ** 53 + 2,
      0.1 + 0.2,
      null,
      1e-300,
      42,
    ]
    for (const n of [0, 1, 7, 8, 9, values.length]) {
      const v = values.slice(0, n)
      const back = decodeColumn(encodeNumbers(v)) as (number | null)[]
      expect(back).toHaveLength(n)
      back.forEach((x, i) => {
        expect(Object.is(x, v[i])).toBe(true)
      })
    }
  })

  it('flags and text (unicode, repeated levels, wide dictionaries) come back as they were', () => {
    const flags = Array.from({ length: 21 }, (_, i) => i % 3 === 0)
    expect(decodeColumn(encodeFlags(flags))).toEqual(flags)
    const text = ['CD4 naïve', null, 'CD8', 'CD4 naïve', '', 'β-cells 🧬', null]
    expect(decodeColumn(encodeText(text))).toEqual(text)
    for (const m of [300, 70_000]) {
      const many = Array.from({ length: m }, (_, i) => (i % 5 ? `id-${i}` : null))
      expect(decodeColumn(encodeText(many))).toEqual(many)
    }
    expect(decodeColumn(encodeText([]))).toEqual([])
  })

  it('refuses what isn’t a column, is cut short or holds what a cell can’t', () => {
    const good = encodeNumbers([1, 2, 3])
    expect(() => decodeColumn(good.subarray(0, 20))).toThrow(ColumnFormatError)
    expect(() => decodeColumn(new Uint8Array(16))).toThrow(ColumnFormatError)
    const nan = encodeNumbers([1])
    new DataView(nan.buffer).setFloat64(16, Number.NaN, true)
    expect(() => decodeColumn(nan)).toThrow(/finite/)
    const text = encodeText(['a'])
    text[text.length - 1] = 9
    expect(() => decodeColumn(text)).toThrow(/dictionary/)
  })

  // Audit 2 M6: limit flags and rich row titles are binary columns too.
  it('limit flags and rich text come back as they were', () => {
    const flags: (LimitFlag | null)[] = [
      { side: 'below', text: '<0.5' },
      null,
      { side: 'above', text: '>ULOQ' },
      { side: 'below', text: '<0.5' },
      { side: 'below', text: '' },
      { side: 'above', text: '<odd>' },
    ]
    expect(decodeColumn(encodeLimits(flags))).toEqual(flags)
    const rich: (RichText | null)[] = [
      [{ text: 'IL-6' }],
      null,
      [{ text: 'CO' }, { text: '2', sub: true }],
      [{ text: 'IL-6' }],
    ]
    const back = decodeColumn(encodeRich(rich)) as (RichText | null)[]
    expect(back).toEqual(rich)
    expect(back[0]).not.toBe(back[3])
    const bad = encodeLimits([{ side: 'below', text: 'x' }])
    bad[20] = 'x'.charCodeAt(0) // the first word's side: header, count, length
    expect(() => decodeColumn(bad)).toThrow(/bad limit flag/)
  })

  // Audit 2 X7: a column's row count was trusted and allocated.
  it('refuses a column whose row count isn’t the table’s, or past what a column can hold', () => {
    const flags = encodeFlags([true, false, true])
    expect(decodeColumn(flags, 3)).toEqual([true, false, true])
    expect(() => decodeColumn(flags, 4)).toThrow('the column has 3 rows, the table 4')
    const huge = new Uint8Array(64)
    huge.set(flags.subarray(0, 12))
    new DataView(huge.buffer).setUint32(8, 0xffffffff, true)
    expect(() => decodeColumn(huge)).toThrow(/too many rows/)
    expect(() => decodeColumn(huge, 0xffffffff)).toThrow(/too many rows/)
    expect(MAX_COLUMN_ROWS).toBe(2 ** 25)
  })
})

describe('hostile large tables (audit 2 X7)', () => {
  const tamper = (
    edit: (json: Record<string, unknown>, files: Record<string, Uint8Array>) => void,
  ) => {
    const t = bigTable(6000)
    const files = unzipSync(writeProjectFile(projectWith(t), { now: NOW }))
    const name = `tables/${t.id}.json`
    const json = JSON.parse(new TextDecoder().decode(files[name])) as Record<string, unknown>
    edit(json, files)
    files[name] = new TextEncoder().encode(JSON.stringify(json))
    return () => readProjectFile(zipSync(files))
  }

  it('a row count unlike the columns’ is a corrupt file', () => {
    const open = tamper((json) => {
      json.rowCount = 6001
    })
    expect(open).toThrow(ProjectFileError)
    expect(open).toThrow(/the column has 6000 rows, the table 6001/)
  })

  it('an absurd row count is refused before any column is read', () => {
    for (const rowCount of [0xffffffff, 2 ** 25 + 1, -1, 1.5, '6000']) {
      const open = tamper((json) => {
        json.rowCount = rowCount
      })
      expect(open).toThrow(/bad row count/)
    }
  })

  it('a column claiming more rows than its table is refused, not allocated', () => {
    const open = tamper((json, files) => {
      json.rowCount = 2 ** 25
      const col = files[`tables/${json.id}/0.col`]!
      new DataView(col.buffer, col.byteOffset).setUint32(8, 2 ** 25 + 7, true)
    })
    expect(open).toThrow(/the column has 33554439 rows, the table 33554432/)
  })
})

describe('limit flags and rich row titles in large tables (audit 2 M6)', () => {
  /** A large table with limit flags in every column and formatted row titles. */
  function flagged(rows: number): DataTable {
    const t = bigTable(rows)
    for (const d of t.dataSets)
      for (const c of d.subcolumns)
        c.limit = Array.from({ length: rows }, (_, r) =>
          r % 7 === 0 ? { side: r % 2 ? 'above' : 'below', text: r % 2 ? '>ULOQ' : '<0.5' } : null,
        )
    t.rowTitlesRich = Array.from({ length: rows }, (_, r) =>
      r % 3 && r % 5 === 0 ? [{ text: `cell ${r}`, italic: true }] : null,
    )
    return t
  }

  it('are binary entries, counted in the table’s cells, and read back exactly', () => {
    const t = flagged(6000)
    const columns = t.dataSets.flatMap((d) => d.subcolumns).length
    expect(tableCells(t)).toBe(tableCells(bigTable(6000)) + (columns + 1) * 6000)
    const bytes = writeProjectFile(projectWith(t), { now: NOW })
    const files = unzipSync(bytes)
    const json = new TextDecoder().decode(files[`tables/${t.id}.json`])
    expect(json.length).toBeLessThan(25_000)
    expect(json).not.toContain('ULOQ')
    expect(readProjectFile(bytes).project.nodes[t.id]).toEqual(t)
  })

  it('count towards making a table large', () => {
    const arrays = tableCells(syntheticTable({ rows: 1, genes: 1, pcs: 1 }))
    const rows = Math.floor(BINARY_TABLE_CELLS / arrays)
    const t = syntheticTable({ rows, genes: 1, pcs: 1 })
    expect(tableCells(t)).toBeLessThanOrEqual(BINARY_TABLE_CELLS)
    t.dataSets[0]!.subcolumns[0]!.limit = Array.from({ length: rows }, () => null)
    t.dataSets[0]!.subcolumns[0]!.limit[0] = { side: 'below', text: 'BLQ' }
    expect(tableCells(t)).toBeGreaterThan(BINARY_TABLE_CELLS)
    const bytes = writeProjectFile(projectWith(t), { now: NOW })
    expect(Object.keys(unzipSync(bytes)).some((n) => n.endsWith('.col'))).toBe(true)
    expect(readProjectFile(bytes).project.nodes[t.id]).toEqual(t)
  })

  it('files whose large tables keep limit flags and rich titles in JSON still read', () => {
    const t = flagged(6000)
    const files = unzipSync(writeProjectFile(projectWith(t), { now: NOW }))
    const name = `tables/${t.id}.json`
    const json = JSON.parse(new TextDecoder().decode(files[name]))
    json.rowTitlesRich = t.rowTitlesRich
    json.dataSets.forEach((d: { subcolumns: { limit?: unknown }[] }, i: number) => {
      d.subcolumns.forEach((c, j) => {
        c.limit = t.dataSets[i]!.subcolumns[j]!.limit
      })
    })
    files[name] = new TextEncoder().encode(JSON.stringify(json))
    expect(readProjectFile(zipSync(files)).project.nodes[t.id]).toEqual(t)
  })
})

describe('project files with large tables', () => {
  it('store a large table’s columns in binary entries and read it back exactly', () => {
    const t = bigTable(6000)
    expect(tableCells(t)).toBeGreaterThan(BINARY_TABLE_CELLS)
    const bytes = writeProjectFile(projectWith(t), { now: NOW })
    const names = Object.keys(unzipSync(bytes))
    expect(names.filter((n) => n.startsWith(`tables/${t.id}/`)).length).toBe(
      t.dataSets.length + t.dataSets.filter((d) => d.text).length + 2 /* exclusions, titles */,
    )
    // The JSON names its columns.
    const json = new TextDecoder().decode(unzipSync(bytes)[`tables/${t.id}.json`])
    expect(json.length).toBeLessThan(20_000)
    expect(json).toContain('"$col"')
    const back = readProjectFile(bytes).project.nodes[t.id] as DataTable
    expect(back).toEqual(t)
  })

  it('keeps small tables as JSON (older versions open them)', () => {
    const t = syntheticTable({ rows: 1000, genes: 2, pcs: 2 })
    expect(tableCells(t)).toBeLessThanOrEqual(BINARY_TABLE_CELLS)
    const bytes = writeProjectFile(projectWith(t), { now: NOW })
    expect(Object.keys(unzipSync(bytes)).some((n) => n.endsWith('.col'))).toBe(false)
    expect(readProjectFile(bytes).project.nodes[t.id]).toEqual(t)
  })

  it('writes the same file from tables packed beforehand (the serializing worker’s way)', () => {
    const p = projectWith(bigTable(6000))
    expect(writeProjectFile(p, { now: NOW, packed: packProject(p) })).toEqual(
      writeProjectFile(p, { now: NOW }),
    )
  })

  it('codes a column’s texts once while it is in the document (audit 3, P7)', () => {
    const t = bigTable(6000)
    const a = packTable(t)!
    const b = packTable(t)!
    const cluster = t.dataSets.findIndex((d) => d.title === 'cluster')
    const col = (p: typeof a, ref: unknown) => p.columns.get((ref as { $col: string }).$col)!
    const texts = (p: typeof a) => col(p, (p.json as DataTable).dataSets[cluster]!.text)
    expect(texts(b)).toBe(texts(a))
    expect(isEncodedOnce(texts(a))).toBe(true)
    expect(col(b, (b.json as DataTable).rowTitles)).toBe(col(a, (a.json as DataTable).rowTitles))
    // Numbers are encoded each time.
    const values = (p: typeof a) =>
      col(p, (p.json as DataTable).dataSets[cluster + 2]!.subcolumns[0]!.values)
    expect(values(b)).not.toBe(values(a))
    expect(isEncodedOnce(values(a))).toBe(false)
    // An edited column (a new array) is coded again; the file is the same as ever.
    const edited = {
      ...t,
      dataSets: t.dataSets.map((d, i) =>
        i === cluster ? { ...d, text: d.text!.map((x, r) => (r ? x : 'new')) } : d,
      ),
    }
    expect(texts(packTable(edited)!)).not.toBe(texts(a))
    expect(writeProjectFile(projectWith(t), { now: NOW })).toEqual(
      writeProjectFile(projectWith(structuredClone(t)), { now: NOW }),
    )
  })

  it('says a file is corrupt when a column is missing or damaged', () => {
    const t = bigTable(6000)
    const files = unzipSync(writeProjectFile(projectWith(t), { now: NOW }))
    const missing = { ...files }
    delete missing[`tables/${t.id}/0.col`]
    expect(() => readProjectFile(zipSync(missing))).toThrow(ProjectFileError)
    expect(() => readProjectFile(zipSync(missing))).toThrow(/column 0 is missing/)
    const damaged = { ...files, [`tables/${t.id}/1.col`]: new Uint8Array(5) }
    expect(() => readProjectFile(zipSync(damaged))).toThrow(/Corrupt project file/)
  })

  it('writes and reads in time linear in the rows', () => {
    const tables = new Map<number, DataTable>()
    const table = (n: number) => {
      let t = tables.get(n)
      if (!t) {
        t = syntheticTable({ rows: n, genes: 4, pcs: 2 })
        t.id = 't1' as NodeId
        tables.set(n, t)
      }
      return t
    }
    const ratio = growthRatio(
      (n) => readProjectFile(writeProjectFile(projectWith(table(n)), { now: NOW })),
      5000,
      4,
      2,
    )
    expect(ratio).toBeLessThan(8)
  })
})

describe('cached results of big result tables (roadmap 38)', () => {
  it('leaves out a result table of more than BINARY_TABLE_CELLS cells (recomputed on opening)', () => {
    const p = createProject('P', NOW)
    const small = syntheticTable({ rows: 100, genes: 2, pcs: 1 })
    const big = syntheticTable({ rows: 30_000, genes: 4, pcs: 2 })
    expect(tableCells(big)).toBeGreaterThan(BINARY_TABLE_CELLS)
    const ids = ['aaaaaaaaaaaa', 'bbbbbbbbbbbb'] as NodeId[]
    for (const id of ids)
      p.nodes[id] = {
        kind: 'analysis',
        id,
        name: 'Filter rows',
        analysisId: 'filterRows',
        pluginVersion: 1,
        input: { source: id, dataSets: [] },
        params: {},
      }
    const entry = (table: DataTable) => ({
      inputKey: 'k',
      result: {
        status: 'ok' as const,
        diagnostics: [],
        sheets: [],
        values: {},
        comparisons: [],
        outputs: {},
        table,
      },
    })
    const bytes = writeProjectFile(p, {
      now: NOW,
      results: new Map([
        [ids[0]!, entry(small)],
        [ids[1]!, entry(big)],
      ]),
    })
    const files = Object.keys(unzipSync(bytes))
    expect(files).toContain(`results/${ids[0]}.json`)
    expect(files).not.toContain(`results/${ids[1]}.json`)
    // Audit 2 (P14): the results the file keeps, taken before (for a worker): the same file.
    const all = new Map([
      [ids[0]!, entry(small)],
      [ids[1]!, entry(big)],
      ['cccccccccccc' as NodeId, entry(small)],
    ])
    const kept = resultsForFile(p, all)
    expect([...kept.keys()]).toEqual([ids[0]])
    expect(kept.get(ids[0]!)).toBe(all.get(ids[0]!))
    expect(writeProjectFile(p, { now: NOW, results: kept })).toEqual(
      writeProjectFile(p, { now: NOW, results: all }),
    )
    expect(writeProjectFile(p, { now: NOW, results: all })).toEqual(bytes)
  })
})

describe('a large table with every optional field set (audit 2, M13)', () => {
  /**
   * The optional places of a schema (dotted paths, `*` for list elements, `#` for record values):
   * fields that may be absent, null or defaulted, at every depth.
   */
  function optionalPlaces(schema: unknown): string[] {
    const out = new Set<string>()
    const defOf = (s: unknown) => (s as { _zod: { def: Record<string, unknown> } })._zod.def
    const walk = (s: unknown, path: string[], depth: number) => {
      if (depth > 12) return
      const def = defOf(s)
      switch (def.type) {
        case 'optional':
        case 'nullable':
        case 'default':
          out.add(path.join('.'))
          walk(def.innerType, path, depth)
          return
        case 'object':
          for (const [k, v] of Object.entries(def.shape as Record<string, unknown>))
            walk(v, [...path, k], depth + 1)
          return
        case 'array':
          walk(def.element, [...path, '*'], depth + 1)
          return
        case 'record':
          walk(def.valueType, [...path, '#'], depth + 1)
          return
        case 'union':
          for (const o of def.options as unknown[]) walk(o, path, depth)
          return
        case 'pipe':
          walk(def.in, path, depth)
          return
        default:
          return
      }
    }
    walk(schema, [], 0)
    out.delete('')
    return [...out].sort()
  }

  /** The values at a place (see `optionalPlaces`) in any of `roots`. */
  const valuesAt = (roots: unknown[], place: string): unknown[] =>
    place.split('.').reduce<unknown[]>(
      (vs, seg) =>
        vs.flatMap((v) => {
          if (v === null || typeof v !== 'object') return []
          if (seg === '*') return Array.isArray(v) ? v : []
          if (seg === '#') return Array.isArray(v) ? [] : Object.values(v)
          return Array.isArray(v) ? [] : [(v as Record<string, unknown>)[seg]]
        }),
      roots,
    )

  const ROWS = 20_000
  const numbers = (k: number) =>
    Array.from({ length: ROWS }, (_, r) =>
      r % 11 === 0
        ? null
        : r === 1
          ? -0
          : r === 2
            ? Number.MAX_VALUE
            : r === 3
              ? Number.MIN_VALUE
              : r === 4
                ? -Number.MAX_VALUE
                : Math.sin(r * k) * 10 ** ((r % 9) - 4),
    )
  const flags = (k: number) => Array.from({ length: ROWS }, (_, r) => (r + k) % 13 === 0)
  const limits = (k: number) =>
    Array.from({ length: ROWS }, (_, r) =>
      (r + k) % 17 === 0
        ? { side: (r % 2 ? 'above' : 'below') as 'above' | 'below', text: r % 3 ? '<0.5' : '' }
        : null,
    )
  const run = (text: string) => ({
    text,
    sup: true,
    sub: false,
    italic: true,
    bold: true,
    underline: true,
    font: 'serif' as const,
    size: 9,
    color: { palette: 2 },
  })
  const cells = (k: number) => ({
    type: 'number' as const,
    values: numbers(k),
    excluded: flags(k),
    limit: limits(k),
  })
  const display = { mode: 'fixed' as const, digits: 3, thousands: true, prefix: '$', suffix: ' µg' }
  const rowTitles = Array.from({ length: ROWS }, (_, r) =>
    r % 5 === 0 ? null : r % 7 === 0 ? '' : `ρ ${r} – “cell”`,
  )
  const rowTitlesRich = rowTitles.map((t, r) =>
    t && r % 3 === 0 ? [run(t.slice(0, 2)), { text: t.slice(2) }] : null,
  )
  const common = {
    kind: 'table' as const,
    rowCount: ROWS,
    rowTitles,
    rowTitlesRich,
    notes: 'Notes ✓',
    columnWidths: { x: 80, rowTitle: 120 },
    cellsTable: false,
    limits: {
      below: { method: 'fixed' as const, value: 0.25 },
      above: { method: 'fixed' as const, value: 99 },
      lower: { all: 0.5, columns: { aaaaaaaaaaaa: 0.4 } },
      upper: { all: 100, columns: { aaaaaaaaaaaa: 90 } },
    },
  }
  const xy: DataTable = {
    ...common,
    id: 'xyxyxyxyxyxy' as NodeId,
    name: 'XY',
    tableKind: 'xy',
    yFormat: { type: 'replicates', count: 2 },
    x: {
      title: 'Dose',
      titleRich: [run('Dose')],
      xFormat: 'numbersWithError',
      subcolumns: [cells(1), cells(2)],
      display,
    },
    dataSets: ['aaaaaaaaaaaa', 'bbbbbbbbbbbb'].map((id, i) => ({
      id: id as ColumnId,
      title: `Set ${i}`,
      titleRich: [run(`Set ${i}`)],
      subcolumns: [cells(3 + i), cells(5 + i)],
      subcolumnTitles: ['A', null],
      subcolumnTitlesRich: [[run('A')], null],
      display,
    })),
  }
  const variables: DataTable = {
    ...common,
    id: 'vvvvvvvvvvvv' as NodeId,
    name: 'Variables',
    tableKind: 'multipleVariables',
    yFormat: { type: 'replicates', count: 1 },
    x: null,
    dataSets: [
      { id: 'nnnnnnnnnnnn' as ColumnId, title: 'n', subcolumns: [cells(7)], display },
      {
        id: 'tttttttttttt' as ColumnId,
        title: 'group',
        titleRich: [run('group')],
        subcolumns: [{ type: 'number', values: Array(ROWS).fill(null) }],
        text: Array.from({ length: ROWS }, (_, r) =>
          r % 4 === 0 ? null : r % 9 === 0 ? '' : `level ${r % 23} ✓`,
        ),
      },
      {
        id: 'ffffffffffff' as ColumnId,
        title: 'twice',
        subcolumns: [{ type: 'number', values: Array(ROWS).fill(null) }],
        formula: '=n*2',
      },
    ],
  }

  it('sets them all (a new optional field fails here until the fixture holds it)', () => {
    for (const t of [xy, variables])
      expect(DataTableSchema.safeParse(t).error?.issues, t.name).toBeUndefined()
    const places = optionalPlaces(DataTableSchema)
    // A sanity check of the walk itself.
    expect(places).toContain('rowTitlesRich.*.*.color')
    expect(places).toContain('dataSets.*.subcolumns.*.limit')
    const unset = places.filter(
      (p) => !valuesAt([xy, variables], p).some((v) => v !== undefined && v !== null),
    )
    expect(unset).toEqual([])
  })

  it('saved and opened is the same table, every per-row array in binary columns', () => {
    for (const t of [xy, variables]) expect(tableCells(t)).toBeGreaterThan(BINARY_TABLE_CELLS)
    const p = createProject('P', NOW)
    for (const t of [xy, variables]) {
      p.nodes[t.id] = t
      p.order.push(t.id)
    }
    const bytes = writeProjectFile(p, { now: NOW })
    const files = unzipSync(bytes)
    for (const t of [xy, variables]) {
      const json = new TextDecoder().decode(files[`tables/${t.id}.json`])
      // No per-row array is left in the JSON (the table's own fields are small).
      expect(json.length, t.name).toBeLessThan(6_000)
      expect(json).not.toContain('<0.5')
    }
    const opened = readProjectFile(bytes)
    expect(opened.notes).toEqual([])
    expect(opened.project.nodes[xy.id]).toStrictEqual(xy)
    expect(opened.project.nodes[variables.id]).toStrictEqual(variables)
    expect(opened.project).toStrictEqual({
      ...p,
      meta: { ...p.meta, modified: NOW.toISOString(), appVersion: APP_VERSION },
    })
  })
})
