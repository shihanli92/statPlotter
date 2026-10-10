import { createProject, DataTable, DEFAULT_LIMIT_RULE, type LimitRule } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { growthRatio } from '../../stats/test/timing.ts'
import {
  BINARY_TABLE_CELLS,
  findBlocks,
  finishCellRules,
  guessBlock,
  parseMissingCodes,
  prepareSheet,
  readCsv,
  readProjectFile,
  type Sheet,
  sheetToTable,
  withCellRules,
  writeProjectFile,
} from '../src/index.ts'

// Roadmap 39: the user's missing codes and values at detection limits on import.

const sheet = (rows: (string | number | null)[][]): Sheet => ({ name: 's', rows })

const columnTable = (s: Sheet, rules: Parameters<typeof withCellRules>[1]) =>
  withCellRules(s, rules, (sh) =>
    sheetToTable(sh, { name: 'T', tableKind: 'column', headerRow: true, firstColumn: 'data' }),
  )

describe('missing codes (roadmap 39)', () => {
  it('reads the codes typed in a list', () => {
    expect(parseMissingCodes('-999, ND; not done\n nd ,')).toEqual(['-999', 'nd', 'not done'])
  })

  it('empties cells with a missing code, as text or as numbers, ignoring case and spaces', () => {
    const s = sheet([
      ['A', 'B'],
      [1, ' nd '],
      [-999, 'Not done'],
      ['-999', 2],
      ['x', 3],
    ])
    const { table, warnings, counts } = columnTable(s, { missing: ['-999', 'ND', 'not done'] })
    expect(table.dataSets[0]!.subcolumns[0]!.values).toEqual([1, null, null, null])
    expect(table.dataSets[1]!.subcolumns[0]!.values).toEqual([null, null, 2, 3])
    expect(counts.missing).toBe(4)
    // "x" is not a code: counted as before.
    expect(warnings.join(' ')).toMatch(/1 non-numeric/)
    expect(warnings.join(' ')).toMatch(/4 cells with a missing code read as empty/)
  })

  it('leaves the sheet and the import unchanged without rules', () => {
    const s = sheet([['A'], ['<0.5'], [2]])
    expect(prepareSheet(s, {}).sheet).toBe(s)
    const plain = sheetToTable(s, {
      name: 'T',
      tableKind: 'column',
      headerRow: true,
      firstColumn: 'data',
    })
    const ruled = columnTable(s, {})
    expect(ruled.table.dataSets[0]!.subcolumns).toEqual(plain.table.dataSets[0]!.subcolumns)
    expect(ruled.warnings).toEqual(plain.warnings)
  })
})

describe('values at detection limits on import (roadmap 39)', () => {
  const s = sheet([
    ['Control', 'Treated'],
    ['<0.5', 3],
    [1.5, '>ULOQ'],
    ['BLQ', '< 2 ng/mL'],
    [2, 4],
  ])

  it('substitutes LOD/2 below and the limit above, flags the cells and keeps their text', () => {
    const { table } = columnTable(s, { limits: DEFAULT_LIMIT_RULE })
    expect(DataTable.safeParse(table).success).toBe(true)
    const [a, b] = table.dataSets.map((d) => d.subcolumns[0]!)
    expect(a!.values).toEqual([0.25, 1.5, null, 2])
    expect(a!.limit).toEqual([
      { side: 'below', text: '<0.5' },
      null,
      { side: 'below', text: 'BLQ' },
      null,
    ])
    // ">ULOQ" names no number: blank until a limit is typed.
    expect(b!.values).toEqual([3, null, 1, 4])
    expect(b!.limit?.[1]).toEqual({ side: 'above', text: '>ULOQ' })
    expect(table.limits).toEqual(DEFAULT_LIMIT_RULE)
  })

  it('uses limits typed per data set or for all for cells without a number', () => {
    const probe = columnTable(s, { limits: DEFAULT_LIMIT_RULE }).table
    const [ctl, trt] = probe.dataSets.map((d) => d.id)
    const rule: LimitRule = {
      below: { method: 'limit' },
      above: { method: 'limit' },
      lower: { all: 0.2, columns: { [ctl!]: 0.4 } },
      upper: { all: 100 },
    }
    // Ids differ per import: the typed limit applies by data set id, so the import is redone
    // with the ids the table will have (the dialog knows them from its preview).
    const prepared = prepareSheet(s, { limits: rule })
    expect(prepared.counts).toEqual({ missing: 0, below: 3, above: 1 })
    const built = withCellRules(s, { limits: rule }, (sh) => {
      const r = sheetToTable(sh, {
        name: 'T',
        tableKind: 'column',
        headerRow: true,
        firstColumn: 'data',
      })
      r.table.dataSets[0]!.id = ctl!
      r.table.dataSets[1]!.id = trt!
      return r
    }).table
    expect(built.dataSets[0]!.subcolumns[0]!.values).toEqual([0.5, 1.5, 0.4, 2])
    expect(built.dataSets[1]!.subcolumns[0]!.values).toEqual([3, 100, 2, 4])
  })

  it('counts limit cells as numbers, so a column of them stays a number variable', () => {
    const mv = withCellRules(
      sheet([
        ['IL6', 'Group'],
        ['<0.5', 'a'],
        ['<0.5', 'b'],
        [3, 'a'],
      ]),
      { limits: DEFAULT_LIMIT_RULE },
      (sh) =>
        sheetToTable(sh, {
          name: 'T',
          tableKind: 'multipleVariables',
          headerRow: true,
          firstColumn: 'data',
        }),
    ).table
    expect(mv.dataSets[0]!.text).toBeUndefined()
    expect(mv.dataSets[0]!.subcolumns[0]!.values).toEqual([0.25, 0.25, 3])
    expect(mv.dataSets[1]!.text).toEqual(['a', 'b', 'a'])
  })

  it('keeps titles that read as limits as they were written', () => {
    const t = withCellRules(
      sheet([
        ['<0.5 µm', 'B'],
        [1, 2],
      ]),
      { limits: DEFAULT_LIMIT_RULE },
      (sh) =>
        sheetToTable(sh, { name: 'T', tableKind: 'column', headerRow: true, firstColumn: 'data' }),
    ).table
    expect(t.dataSets[0]!.title).toBe('<0.5 µm')
  })

  it('detects a block’s layout on the prepared sheet, so limit and missing cells stay in it', () => {
    const csv = readCsv('Control,Treated\n1.2,ND\n<0.5,3.4\n-999,<LOD\n2.0,5.1\n', { name: 'c' })
    const rules = { missing: ['nd', '-999'], limits: DEFAULT_LIMIT_RULE }
    const prepared = prepareSheet(csv, rules)
    const block = findBlocks(prepared.sheet)[0]!
    const { table } = finishCellRules(
      sheetToTable(prepared.sheet, {
        name: 'T',
        ...guessBlock(prepared.sheet, block.range, block.parts, block.layout),
        ...(block.layout ? { layout: block.layout } : {}),
        area: block.area,
      }),
      prepared,
      rules,
    )
    expect(table.rowCount).toBe(4)
    expect(table.dataSets[0]!.subcolumns[0]!.values).toEqual([1.2, 0.25, null, 2])
    expect(table.dataSets[1]!.subcolumns[0]!.limit?.[2]).toEqual({ side: 'below', text: '<LOD' })
  })

  it('reads limits in CSV text with any spacing and signs', () => {
    const csv = readCsv('A\n<0.5\n< 0.5\n≤0.5\n<LLOQ\nbelow LOD\n7\n', { name: 'c' })
    const t = columnTable(csv, { limits: { ...DEFAULT_LIMIT_RULE, lower: { all: 1 } } }).table
    expect(t.dataSets[0]!.subcolumns[0]!.values).toEqual([0.25, 0.25, 0.25, 0.5, 0.5, 7])
  })

  it('round-trips flags and the rule through the project file, small and large tables', () => {
    for (const rows of [4, Math.ceil(BINARY_TABLE_CELLS / 2) + 10]) {
      const cells: (string | number)[][] = [['A', 'B']]
      for (let r = 0; r < rows; r++) cells.push([r % 3 === 0 ? '<0.5' : r, r])
      const { table } = columnTable(sheet(cells), { limits: DEFAULT_LIMIT_RULE })
      const project = createProject('P')
      project.nodes[table.id] = table
      project.order.push(table.id)
      const loaded = readProjectFile(writeProjectFile(project)).project
      expect(loaded.nodes[table.id]).toEqual(table)
    }
  })

  it('prepares sheets in time linear in their cells', () => {
    const sheets = new Map<number, Sheet>()
    const big = (n: number) => {
      let s = sheets.get(n)
      if (!s) {
        s = sheet(Array.from({ length: n }, (_, r) => [r % 2 ? '<0.5' : r, 'ND', r]))
        sheets.set(n, s)
      }
      return s
    }
    big(20_000)
    big(80_000)
    const ratio = growthRatio(
      (n) => void prepareSheet(big(n), { missing: ['nd'], limits: DEFAULT_LIMIT_RULE }),
      20_000,
    )
    expect(ratio).toBeLessThan(8)
  })
})
