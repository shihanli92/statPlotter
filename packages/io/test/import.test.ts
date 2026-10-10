import { DataTable } from '@ps/model'
import { strToU8, type Zippable, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { dateDisplayedAsNumber, isDateFormatCode } from '../src/import/xlsx.ts'
import { parseXml, textContent } from '../src/import/xml.ts'
import {
  decodeText,
  describeAccount,
  detectLong,
  findBlocks,
  guessBlock,
  ImportError,
  importFile,
  longToTable,
  readCsv,
  readXlsx,
  type Sheet,
  type SheetImportOptions,
  sheetToTable,
  sniffDelimiter,
} from '../src/index.ts'

describe('xml', () => {
  it('parses elements, attributes, entities, CDATA, and skips comments and declarations', () => {
    const root = parseXml(
      `﻿<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e "v">]><!-- c -->
      <a k="1 &amp; 2" q='"'><b/><c>x &lt; y &#65;&#x42;<![CDATA[<raw>]]></c></a>`,
    )
    expect(root.name).toBe('a')
    expect(root.attrs).toEqual({ k: '1 & 2', q: '"' })
    expect(textContent(root).trim()).toBe('x < y AB<raw>')
  })

  it('reports malformed documents', () => {
    expect(() => parseXml('<a><b></a>')).toThrow(ImportError)
    expect(() => parseXml('<a>')).toThrow(/unclosed <a>/)
    expect(() => parseXml('<a b=c/>')).toThrow(/unquoted attribute/)
    expect(() => parseXml('just text')).toThrow(/no root element/)
  })
})

describe('readCsv', () => {
  it('handles RFC 4180 quoting, embedded delimiters, newlines and quotes, and CRLF', () => {
    const s = readCsv('name,"note, with comma","say ""hi""\nthere"\r\nA,1,"2"\r\n')
    expect(s.rows).toEqual([
      ['name', 'note, with comma', 'say "hi"\nthere'],
      ['A', 1, 2],
    ])
    expect(s.name).toBe('Sheet1')
  })

  it('pads ragged rows, keeps blank lines as empty rows, and reads CR line endings', () => {
    expect(readCsv('a,b,c\r1\r\r2,3').rows).toEqual([
      ['a', 'b', 'c'],
      [1, null, null],
      [null, null, null],
      [2, 3, null],
    ])
  })

  it('strips a BOM and converts numeric strings, leaving text and blanks alone', () => {
    const s = readCsv('﻿x,y\n 1.5 , -2e3\n"1,234",abc\n,""')
    expect(s.rows).toEqual([
      ['x', 'y'],
      [1.5, -2000],
      [1234, 'abc'],
      [null, null],
    ])
  })

  it('sniffs tab, comma, and semicolon delimiters', () => {
    expect(sniffDelimiter('a\tb\n1\t2')).toBe('\t')
    expect(sniffDelimiter('a,b\n1,2\n3,4')).toBe(',')
    expect(sniffDelimiter('a;b\n1,5;2\n3;4,25')).toBe(';')
    // A comma file with a semicolon inside some text stays a comma file.
    expect(sniffDelimiter('a,b\nx;y,1\n2,3')).toBe(',')
    // A quoted delimiter doesn't count.
    expect(sniffDelimiter('"a,b"\t1\n"c,d"\t2')).toBe('\t')
    expect(sniffDelimiter('single\ncolumn')).toBe(',')
  })

  it('reads decimal commas in semicolon files', () => {
    expect(readCsv('x;y\n1,5;2\n1.234,5;-0,25\n3.5;7').rows).toEqual([
      ['x', 'y'],
      [1.5, 2],
      [1234.5, -0.25],
      [3.5, 7],
    ])
  })

  it('honours an explicit delimiter', () => {
    expect(readCsv('a,b\t1', { delimiter: '\t' }).rows).toEqual([['a,b', 1]])
    expect(readCsv('a;b', { delimiter: ',' }).rows).toEqual([['a;b']])
  })

  it('reads empty text as an empty sheet', () => {
    expect(readCsv('').rows).toEqual([])
  })
})

// ── XLSX ─────────────────────────────────────────────────────────────────────────────────────

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

function workbook(sheets: { name: string; xml: string; chart?: boolean }[]): Uint8Array {
  const files: Zippable = {
    '[Content_Types].xml': strToU8('<Types/>'),
    '_rels/.rels': strToU8(
      `<Relationships><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    'xl/workbook.xml': strToU8(
      `<workbook ${NS} xmlns:r="${REL}"><sheets>${sheets
        .map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join('')}</sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<Relationships>${sheets
        .map(
          (s, i) =>
            `<Relationship Id="rId${i + 1}" Type="${REL}/${s.chart ? 'chartsheet' : 'worksheet'}" Target="${s.chart ? 'chartsheets' : 'worksheets'}/sheet${i + 1}.xml"/>`,
        )
        .join('')}<Relationship Id="rS" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/>` +
        `<Relationship Id="rT" Type="${REL}/styles" Target="/xl/styles.xml"/></Relationships>`,
    ),
    'xl/sharedStrings.xml': strToU8(
      `<sst ${NS}><si><t>Name</t></si>` +
        '<si><r><t>Ri</t></r><r><rPr><b/></rPr><t xml:space="preserve">ch </t></r><rPh><t>ignored</t></rPh></si>' +
        '<si><t>Line_x000D_</t></si><si><t>  </t></si></sst>',
    ),
    'xl/styles.xml': strToU8(
      `<styleSheet ${NS}><numFmts count="5"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/>` +
        '<numFmt numFmtId="165" formatCode="0.00&quot;d&quot;"/><numFmt numFmtId="166" formatCode="d.m"/>' +
        '<numFmt numFmtId="167" formatCode="dd\\.mm"/><numFmt numFmtId="168" formatCode="d/m"/></numFmts>' +
        '<cellXfs><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="14"/><xf numFmtId="165"/>' +
        '<xf numFmtId="166"/><xf numFmtId="167"/><xf numFmtId="168"/></cellXfs></styleSheet>',
    ),
  }
  sheets.forEach((s, i) => {
    files[`xl/${s.chart ? 'chartsheets' : 'worksheets'}/sheet${i + 1}.xml`] = strToU8(s.xml)
  })
  return zipSync(files)
}

const SHEET1 = `<worksheet ${NS}><dimension ref="A1:E4"/><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="inlineStr"><is><t>Inline &amp; co</t></is></c></row>
<row r="2"><c r="A2"><v>1.5</v></c><c r="B2" t="b"><v>1</v></c><c r="C2"><f>A2*2</f><v>3</v></c><c r="D2" t="e"><v>#DIV/0!</v></c><c r="E2" t="b"><v>0</v></c></row>
<row r="4"><c r="A4" s="1"><v>45000</v></c><c r="B4" s="3"><v>2.5</v></c><c r="C4" t="str"><f>"x"&amp;"y"</f><v>xy</v></c><c r="D4" t="s"><v>2</v></c><c r="E4" t="s"><v>3</v></c></row>
</sheetData><mergeCells count="1"><mergeCell ref="A1:B1"/></mergeCells></worksheet>`

// No cell references: cells and rows follow one another.
const SHEET2 = `<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>
<x:row><x:c><x:v>1</x:v></x:c><x:c s="2"><x:v>2</x:v></x:c></x:row>
<x:row><x:c t="d"><x:v>2024-01-02</x:v></x:c><x:c><x:f>SUM(A1:A1)</x:f></x:c></x:row>
</x:sheetData></x:worksheet>`

describe('readXlsx', () => {
  const bytes = workbook([
    { name: 'Data & more', xml: SHEET1 },
    { name: 'Chart', xml: '<chartsheet/>', chart: true },
    { name: 'Plain', xml: SHEET2 },
    { name: 'Empty', xml: `<worksheet ${NS}><sheetData/></worksheet>` },
  ])

  it('reads every worksheet with shared, rich, and inline strings, numbers, and booleans', () => {
    const sheets = readXlsx(bytes)
    expect(sheets.map((s) => s.name)).toEqual(['Data & more', 'Plain', 'Empty'])
    expect(sheets[0]).toEqual({
      name: 'Data & more',
      rows: [
        ['Name', 'Rich ', null, 'Inline & co', null],
        [1.5, true, 3, null, false],
        [null, null, null, null, null],
        [45000, 2.5, 'xy', 'Line\r', null],
      ],
      dateCells: 1,
    } satisfies Sheet)
  })

  it('follows cells without references, and counts built-in date formats and ISO date cells', () => {
    const plain = readXlsx(bytes)[1]!
    expect(plain.rows).toEqual([
      [1, 2],
      [45293, null],
    ])
    expect(plain.dateCells).toBe(2)
    expect(readXlsx(bytes)[2]).toEqual({ name: 'Empty', rows: [] })
  })

  it('reads dates shown as plain numbers ("27.9" under d.m) as those numbers', () => {
    // 27.9 typed in a day.month locale: Excel stores 27 September 2026 (day 46292) and shows 27.9.
    const sheet =
      `<worksheet ${NS}><sheetData><row r="1">` +
      '<c r="A1" s="4"><v>46292</v></c><c r="B1" s="5"><v>46296</v></c><c r="C1" s="6"><v>46292</v></c>' +
      '<c r="D1" s="4" t="d"><v>2026-10-01</v></c></row></sheetData></worksheet>'
    const [read] = readXlsx(workbook([{ name: 'S', xml: sheet }]))
    // dd.mm of 1 October reads 1.1; d/m stays a date (its day number).
    expect(read!.rows).toEqual([[27.9, 1.1, 46292, 1.1]])
    expect(read!.datesAsNumbers).toBe(3)
    expect(read!.dateCells).toBe(1)
    expect(dateDisplayedAsNumber(46292, 'm.d')).toBe(9.27)
    expect(dateDisplayedAsNumber(46292, '[$-407]d.m')).toBe(27.9)
    expect(dateDisplayedAsNumber(46292, 'd.m.yy')).toBeNull()
    expect(dateDisplayedAsNumber(46292, 'd.d')).toBeNull()
    // The 1904 system counts from 1 January 1904; day 60 of 1900 never existed.
    expect(dateDisplayedAsNumber(46292 - 1462, 'd.m', true)).toBe(27.9)
    expect(dateDisplayedAsNumber(60, 'd.m')).toBeNull()
    expect(dateDisplayedAsNumber(61, 'd.m')).toBe(1.3)
  })

  it('recognises date format codes', () => {
    for (const code of [
      'yyyy-mm-dd',
      'd/m/yy',
      'h:mm AM/PM',
      '[h]:mm:ss',
      '[$-409]mmm d',
      'dd"x"',
    ]) {
      expect(isDateFormatCode(code), code).toBe(true)
    }
    for (const code of ['General', '0.00', '#,##0;[Red]-#,##0', '0.00"d"', '0.0E+00', '"hms"0']) {
      expect(isDateFormatCode(code), code).toBe(false)
    }
  })

  it('rejects legacy and non-workbook files', () => {
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
    expect(() => readXlsx(ole)).toThrow(/legacy Excel/)
    expect(() => readXlsx(strToU8('not a zip'))).toThrow(ImportError)
    expect(() => readXlsx(zipSync({ 'a.xml': strToU8('<a/>') }))).toThrow(/no workbook/)
  })
})

// ── sheetToTable ─────────────────────────────────────────────────────────────────────────────

const values = (t: DataTable) => t.dataSets.map((d) => d.subcolumns.map((c) => c.values))
const opts = (o: Partial<SheetImportOptions>): SheetImportOptions => ({
  name: 'Imported',
  tableKind: 'column',
  headerRow: true,
  firstColumn: 'data',
  ...o,
})

describe('sheetToTable', () => {
  const sheet = (rows: Sheet['rows']): Sheet => ({ name: 'S', rows })

  it('builds a column table from a header row and data columns', () => {
    const { table, warnings } = sheetToTable(
      sheet([
        ['Control', 'Treated', null],
        [1, '2.5', null],
        [3, 'n/a', null],
        ['x', null, null],
        [null, null, null],
      ]),
      opts({}),
    )
    expect(DataTable.parse(table)).toEqual(table)
    expect(table).toMatchObject({
      kind: 'table',
      name: 'Imported',
      tableKind: 'column',
      yFormat: { type: 'replicates', count: 1 },
      rowCount: 3,
      rowTitles: null,
      x: null,
      notes: '',
    })
    expect(table.dataSets.map((d) => d.title)).toEqual(['Control', 'Treated'])
    expect(values(table)).toEqual([[[1, 3, null]], [[2.5, null, null]]])
    expect(warnings).toEqual(['1 non-numeric data cell was imported as empty (first: "x" in A4).'])
  })

  it('uses default titles without a header, and row titles from the first column', () => {
    const { table } = sheetToTable(
      sheet([
        ['r1', 1, 2],
        [7, 3, true],
        [null, 5, 6],
      ]),
      opts({ headerRow: false, firstColumn: 'rowTitles' }),
    )
    expect(table.rowTitles).toEqual(['r1', '7', null])
    expect(table.dataSets.map((d) => d.title)).toEqual(['Group A', 'Group B'])
    expect(values(table)).toEqual([[[1, 3, 5]], [[2, null, 6]]])
  })

  it('builds an XY table with X and side-by-side replicates', () => {
    const { table, warnings } = sheetToTable(
      sheet([
        ['Dose', 'Drug', null, 'Vehicle', 'extra'],
        [0, 1, 2, 3, 4],
        [1, 5, 6, 7, 8],
      ]),
      opts({ tableKind: 'xy', firstColumn: 'x', replicates: 2 }),
    )
    expect(table.x).toEqual({
      title: 'Dose',
      xFormat: 'numbers',
      subcolumns: [{ type: 'number', values: [0, 1] }],
    })
    expect(table.yFormat).toEqual({ type: 'replicates', count: 2 })
    expect(table.dataSets.map((d) => d.title)).toEqual(['Drug', 'Vehicle'])
    expect(values(table)).toEqual([
      [
        [1, 5],
        [2, 6],
      ],
      [
        [3, 7],
        [4, 8],
      ],
    ])
    expect(warnings).toEqual([])

    const odd = sheetToTable(
      sheet([
        [0, 1, 2, 3],
        [1, 4, 5, 6],
      ]),
      opts({ tableKind: 'xy', firstColumn: 'x', replicates: 2, headerRow: false }),
    )
    expect(odd.table.x!.title).toBe('X')
    expect(values(odd.table)[1]).toEqual([
      [3, 6],
      [null, null],
    ])
    expect(odd.warnings[0]).toMatch(/3 data columns don't divide into data sets of 2 replicates/)
  })

  it('builds grouped, contingency, and survival tables', () => {
    const grouped = sheetToTable(
      sheet([
        [null, 'Male', null, 'Female', null],
        ['Young', 1, 2, 3, 4],
        ['Old', 5, 6, 7, 8],
      ]),
      opts({ tableKind: 'grouped', firstColumn: 'rowTitles', replicates: 2 }),
    ).table
    expect(grouped.rowTitles).toEqual(['Young', 'Old'])
    expect(grouped.dataSets.map((d) => d.title)).toEqual(['Male', 'Female'])
    expect(values(grouped)[1]).toEqual([
      [3, 7],
      [4, 8],
    ])

    const contingency = sheetToTable(
      sheet([
        [null, 'Disease', 'Healthy'],
        ['Exposed', 12, 30],
        ['Unexposed', 5, 41],
      ]),
      opts({ tableKind: 'contingency', firstColumn: 'rowTitles' }),
    ).table
    expect(contingency.tableKind).toBe('contingency')
    expect(values(contingency)).toEqual([[[12, 5]], [[30, 41]]])

    const survival = sheetToTable(
      sheet([
        [10, 1, null],
        [12, null, 0],
      ]),
      opts({ tableKind: 'survival', firstColumn: 'x', headerRow: false }),
    ).table
    expect(survival.x!.title).toBe('Days elapsed')
    expect(values(survival)).toEqual([[[1, null]], [[null, 0]]])
  })

  it('reads only the given range', () => {
    const { table } = sheetToTable(
      sheet([
        ['junk', 'junk', 'junk'],
        ['junk', 'A', 'B'],
        ['junk', 1, 2],
        ['junk', 3, 4],
        ['junk', 'note', 'note'],
      ]),
      opts({ range: { r0: 1, c0: 1, r1: 3, c1: 9 } }),
    )
    expect(table.dataSets.map((d) => d.title)).toEqual(['A', 'B'])
    expect(values(table)).toEqual([[[1, 3]], [[2, 4]]])
  })

  it('leaves date-formatted cells to the caller (no warning)', () => {
    const { table, warnings } = sheetToTable(
      { name: 'S', rows: [['A'], [45000]], dateCells: 1 },
      opts({}),
    )
    expect(values(table)).toEqual([[[45000]]])
    expect(warnings).toEqual([])
  })

  it('rejects options that do not fit the table kind', () => {
    const s = sheet([
      [1, 2],
      [3, 4],
    ])
    expect(() => sheetToTable(s, opts({ tableKind: 'xy' }))).toThrow(/need the first column as X/)
    expect(() => sheetToTable(s, opts({ firstColumn: 'x' }))).toThrow(/have no X column/)
    expect(() => sheetToTable(s, opts({ replicates: 2 }))).toThrow(/only available for XY/)
    expect(() => sheetToTable(s, opts({ replicates: 0 }))).toThrow(/at least 1/)
    expect(() => sheetToTable(sheet([]), opts({}))).toThrow(/range is empty/)
    expect(() =>
      sheetToTable(
        s,
        opts({ tableKind: 'xy', firstColumn: 'x', range: { r0: 0, c0: 0, r1: 1, c1: 0 } }),
      ),
    ).toThrow(/no data columns/)
  })
})

// ── importFile ───────────────────────────────────────────────────────────────────────────────

describe('findBlocks / guessBlock (journal source-data sheets)', () => {
  const _ = null
  // Laid out like Nature source-data files: title, blank, header, values, blank, next table.
  // Data sets are as wide as the widest; the last one's empty columns are trimmed.
  const sheet: Sheet = {
    name: 'Foglio1',
    rows: [
      ['Fig. 1a WT vs KO', _, _, _, _, _, _, _, _, _, _],
      [_, _, _, _, _, _, _, _, _, _, _],
      [_, 'PBS', _, _, 'Pathogen', _, _, _, _, _, _],
      ['WT', 1, 2, 3, 10, 11, _, _, _, _, _],
      ['KO', 1.5, 2.5, _, 5, 6, 7, _, _, _, _],
      [_, _, _, _, _, _, _, _, _, _, _],
      ['Fig. 4c t test', _, _, _, _, _, _, _, _, _, _],
      [_, _, _, _, _, _, _, _, _, _, _],
      ['Vehicle', 'Drug', _, _, _, _, _, _, _, _, _],
      [4.2, 0.8, _, _, _, _, _, _, _, _, _],
      [7.9, 0.7, _, _, _, _, _, _, _, _, _],
      [_, _, _, _, _, _, _, _, _, _, _],
      ['Fig. 6h flux A', _, _, _, _, 'Fig. 6h flux B', _, _, _, _, _],
      [_, _, _, _, _, _, _, _, _, _, _],
      ['Time (s)', 'WT', 'KO', _, _, 'Time (s)', 'WT', 'KO', _, _, _],
      [1, 1.0, 0.9, _, _, 1, 1.1, 1.0, _, _, _],
      [2, 1.2, 0.95, _, _, 2, 1.3, 1.0, _, _, _],
      [_, _, _, _, _, _, _, _, _, _, _],
      ['notes only', _, _, _, _, _, _, _, _, _, _],
    ],
  }

  it('finds titled tables stacked and side by side', () => {
    const blocks = findBlocks(sheet)
    expect(blocks.map((b) => b.title)).toEqual([
      'Fig. 1a WT vs KO',
      'Fig. 4c t test',
      'Fig. 6h flux A',
      'Fig. 6h flux B',
    ])
    expect(blocks[0]!.range).toEqual({ r0: 2, c0: 0, r1: 4, c1: 6 })
    expect(blocks[2]!.range).toEqual({ r0: 14, c0: 0, r1: 16, c1: 2 })
    expect(blocks[3]!.range).toEqual({ r0: 14, c0: 5, r1: 16, c1: 7 })
  })

  it('guesses grouped, column and XY settings, with replicates from the header', () => {
    const [grouped, column, xy] = findBlocks(sheet).map((b) => guessBlock(sheet, b.range))
    expect(grouped).toEqual({
      tableKind: 'grouped',
      headerRow: true,
      firstColumn: 'rowTitles',
      replicates: 3,
    })
    expect(column).toEqual({
      tableKind: 'column',
      headerRow: true,
      firstColumn: 'data',
      replicates: 1,
    })
    expect(xy).toEqual({ tableKind: 'xy', headerRow: true, firstColumn: 'x', replicates: 1 })
  })

  it('imports a block: data sets start at their header titles', () => {
    const b = findBlocks(sheet)[0]!
    const { table, warnings } = sheetToTable(sheet, {
      name: b.title!,
      ...guessBlock(sheet, b.range),
      range: b.range,
    })
    expect(warnings).toEqual([])
    expect(table.rowTitles).toEqual(['WT', 'KO'])
    expect(table.dataSets.map((d) => d.title)).toEqual(['PBS', 'Pathogen'])
    expect(table.dataSets[1]!.subcolumns.map((c) => c.values)).toEqual([
      [10, 5],
      [11, 6],
      [null, 7],
    ])
  })

  it('a plain sheet is one untitled block', () => {
    const plain: Sheet = {
      name: 'S',
      rows: [
        ['A', 'B'],
        [1, 2],
        [3, 4],
      ],
    }
    expect(findBlocks(plain)).toMatchObject([
      { title: null, range: { r0: 0, c0: 0, r1: 2, c1: 1 }, layout: { kind: 'column' } },
    ])
  })

  it('titles place data sets of uneven width; titles that fit no layout are ignored', () => {
    const uneven = sheetToTable(
      {
        name: 'S',
        rows: [
          [_, 'A', _, 'B', _, _],
          ['r', 1, 2, 3, 4, 5],
        ],
      },
      { name: 'S', tableKind: 'grouped', headerRow: true, firstColumn: 'rowTitles', replicates: 3 },
    )
    expect(uneven.table.dataSets.map((d) => d.title)).toEqual(['A', 'B'])
    expect(uneven.table.dataSets[0]!.subcolumns.map((c) => c.values)).toEqual([[1], [2], [null]])
    expect(uneven.warnings).toEqual([])
    const tooWide = sheetToTable(
      {
        name: 'S',
        rows: [
          [_, 'A', _, _, _, 'B'],
          ['r', 1, 2, 3, 4, 5],
        ],
      },
      { name: 'S', tableKind: 'grouped', headerRow: true, firstColumn: 'rowTitles', replicates: 2 },
    )
    expect(tooWide.table.dataSets.map((d) => d.title)).toEqual(['A', 'Group B', 'B'])
  })
})

describe('stacked per-data-set sub-tables', () => {
  const _ = null
  // One sub-table per data set, same row titles, under measure titles (lab-style source data).
  const sheet: Sheet = {
    name: 'Fig 3b',
    rows: [
      ['% Foxp3+', 'WT', _, _],
      ['Med LN', 7.5, 7.9, 7.7],
      ['mLN', 5.0, 3.6, _],
      [_, _, _, _],
      [_, 'CD4Cre', _, _],
      ['MedLN', 10.5, 8.7, _],
      ['MLN', 4.6, 5.1, 6.3],
      [_, _, _, _],
      [_, _, _, _],
      ['Counts Foxp3+', _, _, _],
      ['Med LN', 131700, 94341, _],
      ['mLN', 214720, 198160, 723410],
      [_, _, _, _],
      ['Med LN', 14231, 300030, _],
      ['mLN', 374290, 456530, _],
      [_, _, _, _],
      ['% Treg', _, _, _],
      ['TIF1γWT', _, _, _],
      ['DMSO', 76, 89.9, _],
      ['XAV 939', 95.1, 92, _],
      [_, _, _, _],
      ['TIF1γΔFoxp3', _, _, _],
      ['DMSO', 60.1, 48.2, 50],
      ['XAV 939', 84.9, 95.5, 35.7],
    ],
  }

  it('merges sub-tables with matching rows into grouped tables, one per measure', () => {
    const blocks = findBlocks(sheet)
    expect(blocks.map((b) => b.title)).toEqual(['% Foxp3+', 'Counts Foxp3+', '% Treg'])
    expect(blocks.map((b) => b.parts?.map((p) => p.title))).toEqual([
      ['WT', 'CD4Cre'],
      // Unnamed data sets repeat the previous table's.
      ['WT', 'CD4Cre'],
      ['TIF1γWT', 'TIF1γΔFoxp3'],
    ])
  })

  it('builds a grouped table matching rows by title', () => {
    const b = findBlocks(sheet)[0]!
    const guess = guessBlock(sheet, b.range, b.parts)
    expect(guess).toEqual({
      tableKind: 'grouped',
      headerRow: false,
      firstColumn: 'rowTitles',
      replicates: 3,
    })
    const { table, warnings } = sheetToTable(sheet, { name: 'x', ...guess, parts: b.parts })
    expect(warnings).toEqual([])
    expect(table.rowTitles).toEqual(['Med LN', 'mLN'])
    expect(table.dataSets.map((d) => d.title)).toEqual(['WT', 'CD4Cre'])
    expect(table.dataSets[1]!.subcolumns.map((c) => c.values)).toEqual([
      [10.5, 4.6],
      [8.7, 5.1],
      [null, 6.3],
    ])
  })

  it('a lone line that does not resemble the data set names starts a new measure', () => {
    const blocks = findBlocks({
      name: 'S',
      rows: [
        [_, 'Treg WT + Naive', _],
        ['Spleen', 1, 2],
        [_, _, _],
        ['Treg TIF1γ cKO + Naive', _, _],
        ['Spleen', 3, 4],
        [_, _, _],
        ['Numbers of cells', _, _],
        ['Spleen', 5, 6],
        [_, _, _],
        ['Spleen', 7, 8],
      ],
    })
    expect(blocks.map((b) => [b.title, b.parts?.map((p) => p.title)])).toEqual([
      [null, ['Treg WT + Naive', 'Treg TIF1γ cKO + Naive']],
      ['Numbers of cells', ['Treg WT + Naive', 'Treg TIF1γ cKO + Naive']],
    ])
  })
})

describe('block layouts found in journal source data', () => {
  const _ = null
  /** Import every block with the settings the importer detects, as the app does. */
  const tables = (rows: Sheet['rows']) => {
    const sheet: Sheet = { name: 'S', rows }
    return findBlocks(sheet).map((b) => {
      const g = guessBlock(sheet, b.range, b.parts, b.layout)
      const { table, warnings, account } = sheetToTable(sheet, {
        name: b.title ?? 'S',
        ...g,
        range: b.range,
        area: b.area,
        ...(b.layout ? { layout: b.layout } : {}),
      })
      return { title: b.title, table, warnings, account: account! }
    })
  }
  const values = (t: ReturnType<typeof tables>[number]['table']) =>
    t.dataSets.map((d) => [d.title, d.subcolumns.map((c) => c.values)])

  it('title lines directly above the header; unlabelled time points as row titles', () => {
    const [t] = tables([
      ['Fig.1f', _, _, _, _, _],
      ['IFN-β protein level', _, _, _, _, _],
      [_, _, 'WT', _, 'KO', _],
      [_, 0, 9.5, 10.4, 7.9, 9.5],
      [_, 6, 73.3, 90.4, 58.7, 62],
    ])
    expect(t!.title).toBe('Fig.1f – IFN-β protein level')
    expect(t!.table.tableKind).toBe('grouped')
    expect(t!.table.rowTitles).toEqual(['0', '6'])
    expect(values(t!.table)).toEqual([
      [
        'WT',
        [
          [9.5, 73.3],
          [10.4, 90.4],
        ],
      ],
      [
        'KO',
        [
          [7.9, 58.7],
          [9.5, 62],
        ],
      ],
    ])
  })

  it('a group row over replicate labels, one row of values, and annotation rows', () => {
    const [t] = tables([
      [_, 'Figure 2C. Luciferase assay', _, _, _, _, _],
      [_, 'Condition', 'Control', _, _, 'LUBAC', _],
      [_, 'RLU', 'Experiment 1', 'Experiment 2', 'Experiment 3', 'Experiment 1', 'Experiment 2'],
      [_, _, 1, 1, 1, 25.8, 8.8],
      [_, 'P-value to WT', _, _, _, 'ns', _],
      [_, 'Statistical test', "Two-tailed Student's t test", _, _, _, _],
    ])
    expect(t!.title).toBe('Figure 2C. Luciferase assay – RLU')
    expect(t!.table.tableKind).toBe('column')
    expect(values(t!.table)).toEqual([
      ['Control', [[1, 1, 1]]],
      ['LUBAC', [[25.8, 8.8, null]]],
    ])
    expect(t!.warnings).toEqual([])
  })

  it('P-value and test columns are left out; unequal group widths', () => {
    const [t] = tables([
      ['Genotype', 'WT', _, _, 'MUT', _, 'P-value WT vs MUT', 'Statistical test'],
      ['IL-1B', 0.13, 0.11, 0.7, 87.6, 53.5, 0.0031, 'Two-tailed t test'],
      ['TNF', 3.3, 2.9, 3.1, 5.6, 4.0, 0.0168, 'Two-tailed t test'],
    ])
    expect(t!.table.tableKind).toBe('grouped')
    expect(t!.table.rowTitles).toEqual(['IL-1B', 'TNF'])
    expect(values(t!.table)).toEqual([
      [
        'WT',
        [
          [0.13, 3.3],
          [0.11, 2.9],
          [0.7, 3.1],
        ],
      ],
      [
        'MUT',
        [
          [87.6, 5.6],
          [53.5, 4.0],
          [null, null],
        ],
      ],
    ])
  })

  it('a super-header over data set names', () => {
    const [t] = tables([
      ['IFN-β', _, 'uninfected', _, 'infected', _],
      [_, _, 'Vector', 'ALOX15', 'Vector', 'ALOX15'],
      [_, _, 31, 32, 140, 291],
      [_, _, 30, 32, 128, 272],
    ])
    expect(t!.table.tableKind).toBe('column')
    expect(t!.table.dataSets.map((d) => d.title)).toEqual([
      'uninfected · Vector',
      'uninfected · ALOX15',
      'infected · Vector',
      'infected · ALOX15',
    ])
    expect(t!.title).toBe('IFN-β')
  })

  it('groups as rows, values across; one labelled row of sparse groups', () => {
    const [rows] = tables([
      ['colitis score', _, _, _],
      ['WT', 0, 0, 0],
      ['KO', 1, 2, 2],
    ])
    expect(rows!.title).toBe('colitis score')
    expect(values(rows!.table)).toEqual([
      ['WT', [[0, 0, 0]]],
      ['KO', [[1, 2, 2]]],
    ])
    const [sparse] = tables([
      ['LI-LP', _, _, _, _],
      ['+/+', _, _, '2m/2m', _],
      [24, 36.5, _, 1.87, 0.32],
    ])
    expect(sparse!.table.tableKind).toBe('column')
    expect(values(sparse!.table)).toEqual([
      ['+/+', [[24, 36.5]]],
      ['2m/2m', [[1.87, 0.32]]],
    ])
  })

  it('side-by-side tables, each with its own measure title', () => {
    const ts = tables([
      [_, '% GFP+', _, _, '% B220+', _],
      [_, 'Control', 'AML', _, 'Control', 'AML'],
      [_, 0, 16.3, _, 25.9, 6.2],
      [_, 0, 47.5, _, 24.7, 9.7],
    ])
    expect(ts.map((t) => t.title)).toEqual(['% GFP+', '% B220+'])
    expect(values(ts[1]!.table)).toEqual([
      ['Control', [[25.9, 24.7]]],
      ['AML', [[6.2, 9.7]]],
    ])
  })

  it('survival: 0/1 codes per group, and (time, event) column pairs', () => {
    const [staggered] = tables([
      ['Overall survival (days)', 'Untreated', 'Treated'],
      [28, 1, _],
      [30, 1, _],
      [35, _, 1],
      [60, _, 0],
    ])
    expect(staggered!.table.tableKind).toBe('survival')
    expect(staggered!.table.x?.subcolumns[0]).toEqual({ type: 'number', values: [28, 30, 35, 60] })
    const [pairs] = tables([
      ['Days post infection (d)', 'Vector', 'Days post infection (d)', 'ALOX15'],
      [2, 1, 5, 1],
      [4, 1, 21, 0],
    ])
    expect(pairs!.table.tableKind).toBe('survival')
    expect(pairs!.table.x?.subcolumns[0]).toEqual({ type: 'number', values: [2, 4, 5, 21] })
    expect(values(pairs!.table)).toEqual([
      ['Vector', [[1, 1, null, null]]],
      ['ALOX15', [[null, null, 1, 0]]],
    ])
  })

  it('rows that are replicates make a column table; numeric group titles', () => {
    const [images] = tables([
      ['Specks per nuclei', 'Empty', 'NLRP3'],
      ['Image 1', 0, 5.7],
      ['Image 2', 0, 3.3],
      ['p-value to NLRP3', 'n/a', 0.04],
    ])
    expect(images!.table.tableKind).toBe('column')
    expect(images!.table.rowTitles).toEqual(['Image 1', 'Image 2'])
    expect(values(images!.table)).toEqual([
      ['Empty', [[0, 0]]],
      ['NLRP3', [[5.7, 3.3]]],
    ])
    const [doses] = tables([
      [_, 'Control', _, 'H1N1', _, 25, _],
      [_, 0.7, 0.6, 1.5, 1.3, 2.7, 3.0],
    ])
    expect(doses!.table.dataSets.map((d) => d.title)).toEqual(['Control', 'H1N1', '25'])
  })

  it('warns when most data sets hold one value (replicates read the wrong way)', () => {
    const header = Array.from({ length: 10 }, (_, i) => `G${i + 1}`)
    const { warnings } = sheetToTable(
      { name: 'S', rows: [header, header.map((_, i) => i)] },
      { name: 'S', tableKind: 'column', headerRow: true, firstColumn: 'data' },
    )
    expect(warnings.join(' ')).toMatch(/10 of 10 data sets hold a single value/)
  })

  it('an empty column inside a table does not split it', () => {
    const ts = tables([
      ['Fig.4a', _, _, _],
      ['Pearson r', _, _, _],
      ['ALOX15 with TOM20', _, 'Healthy', 'Patient'],
      [_, _, 0.32, 0.69],
      [_, _, 0.21, 0.71],
    ])
    expect(ts).toHaveLength(1)
    expect(ts[0]!.title).toBe('Fig.4a – Pearson r – ALOX15 with TOM20')
  })

  it('accounts for every number: statistics after the values are reported as left out', () => {
    const [t] = tables([
      ['Genotype', 'WT', _, 'MUT', _, 'P value', 'Test'],
      ['IL-1B', 1, 2, 3, 4, 0.03, 't test'],
      ['TNF', 5, 6, 7, 8, 0.2, 't test'],
      ['P value', _, _, 0.01, _, _, _],
    ])
    expect(t!.account.values).toBe(8)
    expect(t!.account.leftOut).toEqual([
      [1, 5],
      [2, 5],
      [3, 3],
    ])
    expect(describeAccount(t!.account)).toBe(
      'Read 8 values. Left out 3 numbers: column F “P value” (2), row 4 “P value” (1).',
    )
  })

  it('statistics and summary words count only where those sit, after the values', () => {
    // "SD" (a rat strain) and "NS" (not stimulated) among the rows and data sets are data; "Mean"
    // and "SEM" as the last rows are a summary.
    const [t] = tables([
      ['Strain', 'NS', 'LPS', 'P value'],
      ['SD', 1, 2, 0.04],
      ['Wistar', 3, 4, 0.3],
      ['Mean', 2, 3, _],
      ['SEM', 1, 1, _],
    ])
    expect(t!.table.rowTitles).toEqual(['SD', 'Wistar'])
    expect(t!.table.dataSets.map((d) => d.title)).toEqual(['NS', 'LPS'])
    expect(t!.account.groups).toEqual([
      { where: 'column D “P value”', count: 2 },
      { where: 'rows 4–5 “Mean”', count: 4 },
    ])
    // Mean | SD columns are data (a format, not statistics about the data).
    const [u] = tables([
      ['A', _, 'B', _],
      ['mean', 'SD', 'mean', 'SD'],
      [-180, 15, -221, 21],
      [-252, 25, -205, 19],
    ])
    expect(u!.table.dataSets.map((d) => d.title)).toEqual([
      'A · mean',
      'A · SD',
      'B · mean',
      'B · SD',
    ])
    expect(u!.account.leftOut).toEqual([])
  })

  it('a misread shows as numbers left out', () => {
    // A second table right under the first, without a blank row: the importer stops at its
    // header, and its values are reported rather than lost silently.
    const [t] = tables([
      [_, 'WT', 'KO'],
      ['a', 1, 2],
      ['b', 3, 4],
      [_, 'Ctrl', 'Drug'],
      ['a', 5, 6],
      ['b', 7, 8],
    ])
    expect(t!.account.values).toBe(4)
    expect(t!.account.groups).toEqual([{ where: 'rows 5–6 “a”', count: 4 }])
  })
})

describe('long-format data (one value per row)', () => {
  // As R's write.csv writes it: an unnamed row-number column first.
  const csv = [
    '"","donor","sti","day","score"',
    '"1","sp43","IFNB",3,3.15',
    '"2","sp44","IFNB",3,2.52',
    '"3","sp54","IFNB",3,2.83',
    '"4","sp43","IIV",3,1.50',
    '"5","sp44","IIV",3,0.87',
    '"6","sp54","IIV",3,1.10',
    '"7","sp44","IIV",7,0.90',
  ].join('\n')
  const sheet = readCsv(csv)

  it('detects the grouping, subject and value columns, skipping R row numbers', () => {
    const info = detectLong(sheet)!
    expect(info.columns.map((c) => c.title)).toEqual(['donor', 'sti', 'day', 'score'])
    const col = (t: string) => info.columns.find((c) => c.title === t)!.index
    expect(info.guess).toEqual({
      value: col('score'),
      group: col('sti'),
      row: null,
      subject: col('donor'),
    })
    // A wide table is not long data, nor is a titled one with a text column.
    expect(detectLong(readCsv('A,B\n1,2\n3,4\n5,6\n7,8'))).toBeNull()
    const titled = 'Fig 3,,,\nGroup,WT,KO,Test\na,1,2,t test\nb,3,4,t test\nc,5,6,t test\n'
    expect(detectLong(readCsv(titled))).toBeNull()
  })

  it('builds a column table with subjects as rows, filtered', () => {
    const info = detectLong(sheet)!
    const { table } = longToTable(sheet, {
      name: 'Fig 4e',
      ...info.guess,
      filters: [{ col: 3, value: '3' }],
    })
    expect(table.tableKind).toBe('column')
    expect(table.rowTitles).toEqual(['sp43', 'sp44', 'sp54'])
    expect(table.dataSets.map((d) => [d.title, d.subcolumns[0]!.values])).toEqual([
      ['IFNB', [3.15, 2.52, 2.83]],
      ['IIV', [1.5, 0.87, 1.1]],
    ])
  })

  it('accounts for the values filtered out and the columns not used', () => {
    const info = detectLong(sheet)!
    const { account } = longToTable(sheet, {
      name: 'x',
      ...info.guess,
      filters: [{ col: 3, value: '3' }],
    })
    // The day-7 row, filtered out; R's row numbers are not data.
    expect(account!.values).toBe(6)
    expect(account!.groups).toEqual([{ where: 'row 8 “sp44”', count: 2 }])
  })

  it('a second factor makes a grouped table; subjects align the replicates', () => {
    const { table } = longToTable(sheet, { name: 'x', value: 4, group: 2, row: 3, subject: 1 })
    expect(table.tableKind).toBe('grouped')
    expect(table.rowTitles).toEqual(['3', '7'])
    const iiv = table.dataSets.find((d) => d.title === 'IIV')!
    // Replicate k is subject k (sp43, sp44, sp54).
    expect(iiv.subcolumns.map((c) => c.values)).toEqual([
      [1.5, null],
      [0.87, 0.9],
      [1.1, null],
    ])
  })
})

describe('zip archives', () => {
  it('reads every spreadsheet inside as sheets', () => {
    const zip = zipSync({
      'data/fig4e.csv': strToU8('a,b\n1,2\n3,4'),
      '__MACOSX/data/._fig4e.csv': strToU8('junk'),
      'readme.pdf': strToU8('%PDF'),
    } as Zippable)
    const res = importFile('supplement.zip', zip)
    expect(res.kind).toBe('sheets')
    if (res.kind === 'sheets') expect(res.sheets.map((s) => s.name)).toEqual(['fig4e'])
    expect(() => importFile('empty.zip', zipSync({ 'a.pdf': strToU8('x') } as Zippable))).toThrow(
      /no CSV or Excel/,
    )
  })
})

describe('importFile', () => {
  it('dispatches on the extension', () => {
    expect(importFile('data/My data.csv', strToU8('a;b\n1,5;2'))).toEqual({
      kind: 'sheets',
      sheets: [
        {
          name: 'My data',
          rows: [
            ['a', 'b'],
            [1.5, 2],
          ],
        },
      ],
    })
    expect(importFile('x.TSV', strToU8('a,b\t1'))).toEqual({
      kind: 'sheets',
      sheets: [{ name: 'x', rows: [['a,b', 1]] }],
    })
    const xlsx = importFile('book.xlsx', workbook([{ name: 'S', xml: SHEET2 }]))
    expect(xlsx.kind === 'sheets' && xlsx.sheets[0]!.name).toBe('S')
  })

  it('decodes UTF-16 and Windows-1252 text', () => {
    const utf16 = new Uint8Array([0xff, 0xfe, 0x41, 0, 0x09, 0, 0x31, 0])
    expect(importFile('unicode.txt', utf16)).toMatchObject({ sheets: [{ rows: [['A', 1]] }] })
    expect(decodeText(new Uint8Array([0x63, 0x61, 0x66, 0xe9]))).toBe('café')
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toBe('a')
  })

  it('rejects unsupported formats with a clear message', () => {
    expect(() => importFile('old.xls', new Uint8Array())).toThrow(/Save the workbook as .xlsx/)
    expect(() => importFile('new.prism', new Uint8Array())).toThrow(
      /\.prism files are not supported/,
    )
    expect(() => importFile('bin.pzf', new Uint8Array())).toThrow(ImportError)
    expect(() => importFile('pic.png', new Uint8Array())).toThrow(/Can't import \.png files/)
    expect(() => importFile('README', new Uint8Array())).toThrow(/without an extension/)
  })

  it('rejects a file with no data instead of offering an empty sheet', () => {
    // An empty CSV used to open the import dialog on nothing ("The selected range is empty").
    expect(() => importFile('empty.csv', new Uint8Array())).toThrow('The file has no data.')
    expect(() => importFile('blank.tsv', strToU8('\n\n'))).toThrow(ImportError)
    const empty = `<worksheet ${NS}><sheetData/></worksheet>`
    expect(() => importFile('blank.xlsx', workbook([{ name: 'S', xml: empty }]))).toThrow(
      'The file has no data.',
    )
    // A workbook with one blank sheet among others still imports.
    const res = importFile(
      'book.xlsx',
      workbook([
        { name: 'Blank', xml: empty },
        { name: 'S', xml: SHEET2 },
      ]),
    )
    expect(res.kind === 'sheets' && res.sheets.map((s) => s.name)).toEqual(['Blank', 'S'])
    // So does a zip with an empty CSV beside a full one.
    const zip = zipSync({ 'a.csv': new Uint8Array(), 'b.csv': strToU8('x\n1') } as Zippable)
    expect(importFile('two.zip', zip).kind).toBe('sheets')
  })
})
