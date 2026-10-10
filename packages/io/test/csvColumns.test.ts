import { type DataTable, DEFAULT_LIMIT_RULE, type LimitRule } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { syntheticCsvText, syntheticTable } from '../../model/test/synthetic.ts'
import { growthRatio } from '../../stats/test/timing.ts'
import {
  type CellRules,
  CsvColumnReader,
  type CsvColumnsOptions,
  columnsToTable,
  ImportTooLargeError,
  readCsv,
  readCsvColumns,
  sheetToTable,
  withCellRules,
} from '../src/index.ts'

// Large CSV files read straight into columns (roadmap 34e): the same table as readCsv and
// sheetToTable give, whatever the chunks the text arrives in.

/** A table without its generated ids (data set ids follow their place). */
const plain = (t: DataTable) => ({
  ...t,
  id: 'x',
  dataSets: t.dataSets.map((d, i) => ({ ...d, id: `d${i}` })),
})

const viaSheet = (
  text: string,
  o: {
    headerRow?: boolean
    firstColumn?: 'data' | 'rowTitles'
    delimiter?: ',' | ';' | '\t'
    decimal?: '.' | ','
  } = {},
) => {
  const sheet = readCsv(text, {
    ...(o.delimiter ? { delimiter: o.delimiter } : {}),
    ...(o.decimal ? { decimal: o.decimal } : {}),
  })
  const r = sheetToTable(sheet, {
    name: 'T',
    tableKind: 'multipleVariables',
    headerRow: o.headerRow ?? true,
    firstColumn: o.firstColumn ?? 'data',
  })
  return { table: plain(r.table), warnings: r.warnings }
}

const viaColumns = (
  text: string,
  o: {
    headerRow?: boolean
    firstColumn?: 'data' | 'rowTitles'
    delimiter?: ',' | ';' | '\t'
    decimal?: '.' | ','
  } = {},
  chunk = Number.POSITIVE_INFINITY,
) => {
  const opts: CsvColumnsOptions = { delimiter: o.delimiter ?? ',', decimal: o.decimal ?? '.' }
  const reader = new CsvColumnReader(opts)
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  for (let i = 0; i < body.length; i += chunk) reader.push(body.slice(i, i + chunk))
  const r = columnsToTable(reader.end(), {
    name: 'T',
    headerRow: o.headerRow ?? true,
    firstColumn: o.firstColumn ?? 'data',
  })
  return { table: plain(r.table), warnings: r.warnings }
}

const CASES: [string, string, Parameters<typeof viaSheet>[1]?][] = [
  ['synthetic cells', syntheticCsvText({ rows: 120, genes: 3, pcs: 2 })],
  [
    'quotes, delimiters and line breaks in fields',
    'name,note,value\n"Smith, J","said ""hi""\nthen left",1.5\nLee,"x"y,2\n',
  ],
  ['CRLF and CR line endings, no final line break', 'a,b\r\n1,2\r3,4\r\n5,6'],
  ['empty lines inside and at the end', 'a,b\n1,2\n\n3,4\n\n\n'],
  ['ragged rows', 'a,b\n1,2,3\n4\n5,6,7,8\n'],
  [
    'text columns with numbers, numbers with stray words, missing marks',
    'grp,v\nA,1\n2,NA\nB,x\nC,n/a\n,3\n',
  ],
  ['mostly numbers with one word', 'v\n1\n2\nthree\n4\n'],
  ['no header', '1,a\n2,b\n3,NA\n', { headerRow: false }],
  ['row titles', 'cell,x\nNA,1\nc2,2\n7,3\n', { firstColumn: 'rowTitles' }],
  ['semicolons and decimal commas', 'a;b\n1,5;2\n3,25;x\n', { delimiter: ';', decimal: ',' }],
  ['tabs', 'a\tb\n1\t2\n', { delimiter: '\t' }],
  ['a byte-order mark', '﻿a,b\n1,2\n'],
  ['trailing empty columns', 'a,b,,\n1,2,,\n3,4,,\n'],
  ['unicode spaces in text', 'g,v\n CD4 naive ,1\nCD8,2\n'],
]

describe('CSV straight into columns', () => {
  it.each(CASES)('%s: the table readCsv and sheetToTable make', (_, text, o) => {
    const a = viaSheet(text, o)
    const b = viaColumns(text, o)
    expect(b.table).toEqual(a.table)
    expect(b.warnings).toEqual(a.warnings)
  })

  it.each(CASES)('%s: the same in chunks of any size', (_, text, o) => {
    const whole = viaColumns(text, o)
    for (const chunk of [1, 2, 3, 7, 64]) expect(viaColumns(text, o, chunk)).toEqual(whole)
  })

  it('reads the synthetic cells as the table they were generated as', () => {
    const o = { rows: 300, genes: 3, pcs: 2 }
    const read = columnsToTable(
      readCsvColumns(syntheticCsvText(o), { delimiter: ',', decimal: '.' }),
      {
        name: 'Synthetic cells',
        headerRow: true,
        firstColumn: 'data',
      },
    ).table
    const t = syntheticTable(o)
    expect(plain(read).dataSets.map((d) => [d.title, d.text ?? d.subcolumns[0]!.values])).toEqual(
      plain(t).dataSets.map((d) => [d.title, d.text ?? d.subcolumns[0]!.values]),
    )
  })

  it('leaves out columns, and takes the types chosen', () => {
    const data = readCsvColumns('id,g,v\n1,A,10\n2,B,x\n', {
      delimiter: ',',
      decimal: '.',
      skip: new Set([0]),
    })
    const { table, warnings } = columnsToTable(data, {
      name: 'T',
      headerRow: true,
      firstColumn: 'data',
      include: [false, true, true],
      types: ['auto', 'auto', 'text'],
    })
    expect(table.dataSets.map((d) => d.title)).toEqual(['g', 'v'])
    expect(table.dataSets[1]!.text).toEqual(['10', 'x'])
    expect(warnings).toEqual([])
  })

  it('refuses a table that would take more memory than allowed, saying what to do', () => {
    const r = new CsvColumnReader({ delimiter: ',', decimal: '.', maxBytes: 100_000 })
    expect(() => {
      r.push('a,b,c\n')
      for (let i = 0; i < 100; i++) r.push('1,2,3\n'.repeat(100))
    }).toThrow(ImportTooLargeError)
    expect(() => {
      const s = new CsvColumnReader({ delimiter: ',', decimal: '.', maxBytes: 100_000 })
      s.push(`a\n${'1\n'.repeat(20_000)}`)
    }).toThrow(/too large to import.*fewer columns/)
  })

  it('reads in time linear in the rows', () => {
    const texts = new Map<number, string>()
    const text = (n: number) => {
      let t = texts.get(n)
      if (!t) {
        t = syntheticCsvText({ rows: n, genes: 4, pcs: 2 })
        texts.set(n, t)
      }
      return t
    }
    const ratio = growthRatio(
      (n) =>
        columnsToTable(readCsvColumns(text(n), { delimiter: ',', decimal: '.' }), {
          name: 'T',
          headerRow: true,
          firstColumn: 'data',
        }),
      5000,
      4,
      2,
    )
    expect(ratio).toBeLessThan(8)
  })
})

// Audit 2, U14: the user's missing codes and values at detection limits (roadmap 39) are applied
// to a large file read into columns as the import dialog applies them to a sheet.

describe('CSV straight into columns, with missing codes and detection limits', () => {
  /** A table without its generated ids, its limit rule's columns keyed by place too. */
  const plainRuled = (t: DataTable) => {
    const p = plain(t)
    if (!t.limits) return p
    const place = new Map(t.dataSets.map((d, i) => [d.id as string, `d${i}`]))
    const side = (v: LimitRule['lower']) =>
      v?.columns
        ? {
            ...v,
            columns: Object.fromEntries(
              Object.entries(v.columns).map(([k, n]) => [place.get(k) ?? k, n]),
            ),
          }
        : v
    return {
      ...p,
      limits: { ...t.limits, lower: side(t.limits.lower), upper: side(t.limits.upper) },
    }
  }
  type O = { headerRow?: boolean; firstColumn?: 'data' | 'rowTitles' }
  const sheetRuled = (text: string, rules: CellRules, o: O = {}) => {
    const r = withCellRules(readCsv(text), rules, (sheet) =>
      sheetToTable(sheet, {
        name: 'T',
        tableKind: 'multipleVariables',
        headerRow: o.headerRow ?? true,
        firstColumn: o.firstColumn ?? 'data',
      }),
    )
    return { table: plainRuled(r.table), warnings: r.warnings }
  }
  const columnsRuled = (text: string, rules: CellRules, o: O = {}, chunk = Infinity) => {
    const reader = new CsvColumnReader({ delimiter: ',', decimal: '.', rules })
    for (let i = 0; i < text.length; i += chunk) reader.push(text.slice(i, i + chunk))
    const r = columnsToTable(reader.end(), {
      name: 'T',
      headerRow: o.headerRow ?? true,
      firstColumn: o.firstColumn ?? 'data',
      rules,
    })
    return { table: plainRuled(r.table), warnings: r.warnings }
  }

  const both: CellRules = {
    missing: ['-999', 'nd', 'not done'],
    limits: DEFAULT_LIMIT_RULE,
    limitColumnsByTitle: true,
  }
  const RULED: [string, string, CellRules, O?][] = [
    [
      'missing codes and limit cells in numbers and text',
      'id,conc,grp\n1,-999,A\n2,<0.5,ND\n3,1.2,B\n4, not done ,C\n5,>20,D\n6,< 0.1,<0.5\n',
      both,
    ],
    [
      'limit words with limits by column title and for all',
      'conc,od\n1,BLQ\n<0.2,2\nULOQ+,3\nLLOQ-,>ULOQ\n',
      {
        ...both,
        limits: {
          ...DEFAULT_LIMIT_RULE,
          lower: { all: 0.05, columns: { conc: 0.4 } },
          upper: { all: 100 },
        },
      },
    ],
    ['no header, codes in the first row', '-999,<0.1\n2,ND\n3,4\n', both, { headerRow: false }],
    ['row titles', 'cell,x\nND,<1\nc2,2\n<0.5,3\n', both, { firstColumn: 'rowTitles' }],
    ['missing codes only', 'a,b\n-999,1\n2,nd\n', { missing: ['-999', 'ND'] }],
    ['limits only', 'a,b\n<1,1\n2,BLQ\n', { limits: DEFAULT_LIMIT_RULE }],
    ['a row of codes only, at the end', 'a,b\n1,2\nND,-999\n', both],
  ]

  it.each(RULED)('%s: the table the import dialog makes', (_, text, rules, o) => {
    const a = sheetRuled(text, rules, o)
    const b = columnsRuled(text, rules, o)
    expect(b.table).toEqual(a.table)
    expect(b.warnings).toEqual(a.warnings)
  })

  it.each(RULED)('%s: the same in chunks of any size', (_, text, rules, o) => {
    const whole = columnsRuled(text, rules, o)
    for (const chunk of [1, 2, 5]) expect(columnsRuled(text, rules, o, chunk)).toEqual(whole)
  })

  it('substitutes and flags limit cells, and says what the rules did', () => {
    const r = columnsRuled(RULED[0]![1], both)
    const conc = r.table.dataSets[1]!.subcolumns[0]!
    expect(conc.values).toEqual([null, 0.25, 1.2, null, 20, 0.05])
    expect(conc.limit?.[1]).toEqual({ side: 'below', text: '<0.5' })
    expect(r.warnings.join(' ')).toMatch(/3 cells with a missing code read as empty/)
  })
})
