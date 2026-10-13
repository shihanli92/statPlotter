import {
  type AnalysisResult,
  createTable,
  type DataTable,
  type ResultBlock,
  type ResultValue,
  TableKind,
} from '@ps/model'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { sampleTable } from '../../graph/test/helpers.ts'
import { child, elements, parseXml, type XmlElement } from '../src/import/xml.ts'
import {
  blockRows,
  type Cell,
  cellOf,
  delimitedFile,
  displayFormat,
  type ExportSheet,
  escapeHtml,
  exactTsvOf,
  exportText,
  formulaLike,
  gridToTsv,
  guardedText,
  htmlDocument,
  type Row,
  readXlsx,
  resultCells,
  resultSheetFileRows,
  resultSheetHtml,
  resultSheetRows,
  sheetNames,
  stackSections,
  tableRows,
  toDelimited,
  toHtmlTable,
  withExactTsv,
  writeXlsx,
  xmlText,
} from '../src/index.ts'

// Data and results out (roadmap 26): the writers, and tables and results as rows.

const BOM = String.fromCharCode(0xfeff)
const settings = { pValueStyle: 'GP' as const, pValueDigits: 4 }

/** Rows as plain values, as `readXlsx` gives them back: padded, trailing blanks dropped. */
function plain(rows: readonly Row[]): (number | string | null)[][] {
  const out = rows.map((r) =>
    r.map((c) => {
      const { v } = cellOf(c)
      if (typeof v === 'number') return Number.isFinite(v) ? v : null
      return v === null || v.trim() === '' ? null : v
    }),
  )
  while (out.length && out.at(-1)!.every((v) => v === null)) out.pop()
  const width = out.reduce((w, r) => Math.max(w, r.findLastIndex((v) => v !== null) + 1), 0)
  return out.map((r) => Array.from({ length: width }, (_, j) => r[j] ?? null))
}

/** Writes the sheets, checks every part is well-formed XML, reads them back. */
function roundTrip(sheets: ExportSheet[]) {
  const bytes = writeXlsx(sheets)
  const parts = unzipSync(bytes)
  for (const [name, data] of Object.entries(parts)) {
    expect(() => parseXml(strFromU8(data)), name).not.toThrow()
  }
  return { read: readXlsx(bytes), parts }
}

function expectRoundTrip(sheets: ExportSheet[]) {
  const { read } = roundTrip(sheets)
  expect(read.map((s) => s.rows)).toEqual(sheets.map((s) => plain(s.rows)))
  return read
}

const xmlOf = (parts: Record<string, Uint8Array>, path: string): XmlElement =>
  parseXml(strFromU8(parts[path]!))

describe('sheet names', () => {
  it('are made valid for Excel', () => {
    expect(
      sheetNames(['a/b', '[x]:*?\\', '', '  ', "'quoted'", 'History', 'x'.repeat(40)]),
    ).toEqual(['a_b', '_x_____', 'Sheet', 'Sheet (2)', 'quoted', 'History_', 'x'.repeat(31)])
  })

  it('are unique without regard to case, within 31 characters', () => {
    const long = 'Dose response of the long experiment'
    const names = sheetNames(['Data', 'data', 'DATA', long, long])
    expect(names.slice(0, 3)).toEqual(['Data', 'data (2)', 'DATA (3)'])
    expect(names[3]).toBe(long.slice(0, 31))
    expect(names[4]).toBe(`${long.slice(0, 27)} (2)`)
    for (const n of names) expect(n.length).toBeLessThanOrEqual(31)
  })

  it('never end in an apostrophe or half a surrogate pair when cut', () => {
    expect(sheetNames([`${'x'.repeat(30)}'y`])).toEqual(['x'.repeat(30)])
    expect(sheetNames([`${'x'.repeat(30)}😀`])).toEqual(['x'.repeat(30)])
  })
})

describe('CSV and TSV', () => {
  it('quote the delimiter, quotes and line breaks (RFC 4180) and pad rows', () => {
    const rows: Row[] = [['a,b', 'say "hi"', 'two\nlines', 'tab\there', 1.5], ['x']]
    expect(toDelimited(rows, ',')).toBe('"a,b","say ""hi""","two\nlines",tab\there,1.5\nx,,,,')
    expect(toDelimited(rows, '\t')).toBe(
      'a,b\t"say ""hi"""\t"two\nlines"\t"tab\there"\t1.5\nx\t\t\t\t',
    )
    expect(toDelimited([['cr\r']], ',')).toBe('"cr\r"')
  })

  it('write numbers in full and display text where given', () => {
    expect(toDelimited([[0.1 + 0.2, 1e-300, { v: 0.01234, text: '0.0123' }, null]], ',')).toBe(
      '0.30000000000000004,1e-300,0.0123,',
    )
  })

  it('files start with a byte-order mark, end lines with CRLF and guard formula-like text', () => {
    const file = delimitedFile([['=SUM(A1)', '+A1', '-x', '@me', -3, '-4.5', 'ok'], ['a,b']], ',')
    expect(file).toBe(`${BOM}'=SUM(A1),'+A1,'-x,'@me,-3,-4.5,ok\r\n"a,b",,,,,,\r\n`)
    expect(formulaLike('-1e-5')).toBe(false)
    expect(formulaLike('=1')).toBe(true)
    expect(formulaLike('\tx')).toBe(true)
  })
})

// Audit 2 X13: the clipboard guards formula-like text as CSV and TSV files do, and keeps the
// exact text in its HTML for this app's own paste.
describe('clipboard guard', () => {
  const hostile = ['=HYPERLINK("http://x","y")', '+1+1', '-x', '@SUM(A1)', '\tx', '\r=1']

  it('guards formula-like text cells, never numbers or their display text', () => {
    for (const s of hostile) expect(guardedText(s)).toBe(`'${s}`)
    for (const c of ['-3.2', '+4', '1e-5', 'ok', '', null, -3.2, { v: -1234.5, text: '-1,234.5' }])
      expect(guardedText(c)).toBe(exportText(c))
    expect(gridToTsv([['=1+1', -3, '-3.2', 'a\tb']], { guard: true })).toBe(
      `'=1+1\t-3\t-3.2\t"a\tb"`,
    )
    expect(gridToTsv([['=1+1', -3]])).toBe('=1+1\t-3')
    expect(toDelimited([['@me', { v: -2, text: '-2.00' }]], '\t', { guard: true })).toBe(
      `'@me\t-2.00`,
    )
    const html = toHtmlTable([['=1+1', -3, { v: -1, text: '-1,000' }]], { guard: true })
    expect(html).toContain(`>&#39;=1+1</td>`)
    expect(html).toContain('>-3</td>')
    expect(html).toContain('>-1,000</td>')
    expect(toHtmlTable([['=1+1']])).toContain('>=1+1</td>')
  })

  it('keeps the exact text in the HTML, read back however it is re-serialised', () => {
    const exact = `=SUM(A1)\t"q" & <b>\n-x é 🧬\r\n'already`
    const html = htmlDocument(withExactTsv(toHtmlTable([['x']], { guard: true }), exact))
    expect(html).not.toMatch(/[\t\n\r]/)
    expect(html.split('<table').length).toBe(2)
    expect(exactTsvOf(html)).toBe(exact)
    // A browser writes attribute values with only & " and no-break spaces escaped.
    const reserialised = `<meta charset="utf-8"><div data-ps-tsv="=SUM(A1)\t&quot;q&quot; &amp; <b>
-x&nbsp;é">x</div>`
    expect(exactTsvOf(reserialised)).toBe('=SUM(A1)\t"q" & <b>\n-x é')
    expect(exactTsvOf('<table><tr><td>=1</td></tr></table>')).toBeNull()
    expect(exactTsvOf('<p>data-ps-tsv="x"</p>')).toBeNull()
  })
})

describe('HTML', () => {
  it('escapes markup', () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;',
    )
    const html = toHtmlTable([
      ['<b>', 1],
      ['a\nb', null],
    ])
    expect(html).toContain('&lt;b&gt;')
    expect(html).toContain('a<br>b')
    expect(html).not.toContain('<b>')
  })

  it('spans titles, bolds headers, right-aligns numbers and greys excluded values', () => {
    const html = toHtmlTable([
      [{ v: 'Title', style: 'title' }],
      [
        { v: 'A', style: 'header' },
        { v: 'B', style: 'header' },
      ],
      [{ v: 2, excluded: true }, 3],
    ])
    expect(html.split('<tr>')).toHaveLength(4)
    expect(html).toContain('<th colspan="2"')
    expect(html).toMatch(
      /<td style="[^"]*text-align:right;color:#808080;font-style:italic">2<\/td>/,
    )
    expect(html).toMatch(/<th style="[^"]*font-weight:bold[^"]*">A<\/th>/)
  })
})

describe('xlsx', () => {
  it('reads back what it writes: numbers in full, text of every kind', () => {
    const tricky = [
      'a & b < c > d "e" \'f\'',
      'µ ± ≤ α 😀',
      '  leading and trailing  ',
      'tab\tand\nnew line',
      'carriage\r\nreturn',
      'control \u0001 char',
      'literal _x0041_ escape',
      'lone \ud800 surrogate',
    ]
    const sheets: ExportSheet[] = [
      {
        name: 'Numbers',
        rows: [
          [0.1 + 0.2, 1e-300, -1.5e21, 123456789.12345679, 5e-324, Number.MAX_VALUE],
          [null, Number.NaN, Number.POSITIVE_INFINITY, 7],
          [],
          [
            { v: 1.23456, format: '0.00', text: '1.23' },
            { v: 3, excluded: true },
          ],
        ],
      },
      { name: 'Text', rows: tricky.map((t) => [t]) },
    ]
    const { read } = roundTrip(sheets)
    expect(read[0]!.rows).toEqual(plain(sheets[0]!.rows))
    expect(read[1]!.rows.map((r) => r[0])).toEqual(
      tricky.map((t) => t.replace('\ud800', String.fromCharCode(0xfffd))),
    )
  })

  it('writes an empty workbook as one empty sheet', () => {
    const { read } = roundTrip([])
    expect(read).toEqual([{ name: 'Sheet1', rows: [] }])
    expect(roundTrip([{ name: 'Empty', rows: [[], [null]] }]).read[0]!.rows).toEqual([])
  })

  it('has bold titles, grey italic excluded values and number formats', () => {
    const { parts } = roundTrip([
      {
        name: 'S',
        rows: [
          [{ v: 'Title', style: 'title' }],
          [{ v: 'Head', style: 'header' }],
          [
            { v: 2.5, excluded: true },
            { v: 0.01234, format: '0.0000' },
          ],
          [{ v: 1e-7, format: '0.000E+00', excluded: true }],
        ],
      },
    ])
    const styles = xmlOf(parts, 'xl/styles.xml')
    const fonts = elements(child(styles, 'fonts')!, 'font')
    const xfs = elements(child(styles, 'cellXfs')!, 'xf')
    const fmts = new Map(
      elements(child(styles, 'numFmts')!, 'numFmt').map((f) => [
        f.attrs.numFmtId,
        f.attrs.formatCode,
      ]),
    )
    const sheet = xmlOf(parts, 'xl/worksheets/sheet1.xml')
    const cell = (ref: string) =>
      elements(child(sheet, 'sheetData')!, 'row')
        .flatMap((r) => elements(r, 'c'))
        .find((c) => c.attrs.r === ref)!
    const style = (ref: string) => {
      const xf = xfs[Number(cell(ref).attrs.s ?? 0)]!
      const font = fonts[Number(xf.attrs.fontId)]!
      return {
        bold: !!child(font, 'b'),
        italic: !!child(font, 'i'),
        color: child(font, 'color')?.attrs.rgb,
        format: fmts.get(xf.attrs.numFmtId!) ?? xf.attrs.numFmtId,
      }
    }
    expect(style('A1')).toMatchObject({ bold: true, italic: false })
    expect(style('A2')).toMatchObject({ bold: true, italic: false })
    expect(style('A3')).toMatchObject({ italic: true, color: 'FF808080', format: '0' })
    expect(style('B3')).toMatchObject({ italic: false, format: '0.0000' })
    expect(style('A4')).toMatchObject({ italic: true, format: '0.000E+00' })
  })

  it('links to other sheets by their written names', () => {
    const { parts, read } = roundTrip([
      { name: 'Contents', rows: [[{ v: "It's data", link: 1 }]] },
      { name: "It's data", rows: [[1]] },
    ])
    expect(read.map((s) => s.name)).toEqual(['Contents', "It's data"])
    const links = elements(
      child(xmlOf(parts, 'xl/worksheets/sheet1.xml'), 'hyperlinks')!,
      'hyperlink',
    )
    expect(links.map((l) => [l.attrs.ref, l.attrs.location])).toEqual([['A1', "'It''s data'!A1"]])
  })

  it('names sheets validly and uniquely', () => {
    const read = expectRoundTrip([
      { name: 'a/b', rows: [[1]] },
      { name: 'A/B', rows: [[2]] },
    ])
    expect(read.map((s) => s.name)).toEqual(['a_b', 'A_B (2)'])
  })

  it('escapes text for XML', () => {
    expect(xmlText('<&>"')).toBe('&lt;&amp;&gt;&quot;')
    expect(xmlText('\r\u0001')).toBe('_x000D__x0001_')
    expect(xmlText('_x00A0_')).toBe('_x005F_x00A0_')
  })
})

/** A table's rows as text (header styles dropped), for readable expectations. */
const texts = (rows: readonly Row[]) => rows.map((r) => r.map(exportText))

describe('data tables as rows', () => {
  it('every table kind reads back from xlsx and CSV', () => {
    for (const kind of TableKind.options) {
      const t = sampleTable(kind)
      const rows = tableRows(t)
      expectRoundTrip([{ name: t.name, rows }])
      // Every value of the table appears, in full.
      const values = t.dataSets.flatMap((d) => d.subcolumns.flatMap((c) => c.values))
      const out = rows.flat().map((c) => cellOf(c).v)
      for (const v of values) if (v !== null) expect(out, kind).toContain(v)
      expect(toDelimited(rows, ',').split('\n')).toHaveLength(rows.length)
    }
  })

  it('XY: X title, subcolumn labels and row values', () => {
    expect(texts(tableRows(sampleTable('xy')).slice(0, 3))).toEqual([
      ['X', 'Slow', '', 'Fast', ''],
      ['', 'Y1', 'Y2', 'Y1', 'Y2'],
      ['0', '1', '1.4', '2', '2.5'],
    ])
  })

  it('grouped and contingency: row titles first; column tables have one header row', () => {
    expect(texts(tableRows(sampleTable('grouped')).slice(0, 3))).toEqual([
      ['', 'Vehicle', '', '', 'Treated', '', ''],
      ['', 'Y1', 'Y2', 'Y3', 'Y1', 'Y2', 'Y3'],
      ['WT', '10', '12', '11', '14', '13', '16'],
    ])
    expect(texts(tableRows(sampleTable('contingency')))).toEqual([
      ['', 'Disease', 'Healthy'],
      ['Exposed', '20', '10'],
      ['Unexposed', '5', '25'],
    ])
    expect(texts(tableRows(sampleTable('column')))[0]).toEqual(['Control', 'Drug A', 'Drug B'])
  })

  it('nested tables name the subjects', () => {
    const t = sampleTable('nested')
    t.dataSets[0]!.subcolumnTitles = ['Mouse 1', null, null]
    expect(texts(tableRows(t)).slice(0, 2)).toEqual([
      ['Control', '', '', 'Treated', '', ''],
      ['Mouse 1', 'Subject 2', 'Subject 3', 'Subject 1', 'Subject 2', 'Subject 3'],
    ])
  })

  it('summary data: Mean / SD / N labels', () => {
    const t = createTable({ yFormat: { type: 'summary', preset: 'meanSdN' }, columns: 2 })
    t.dataSets[0]!.subcolumns.forEach((c, i) => {
      c.values = [[10.5, 2.25, 6][i]!]
    })
    expect(texts(tableRows(t))).toEqual([
      ['Group A', '', '', 'Group B', '', ''],
      ['Mean', 'SD', 'N', 'Mean', 'SD', 'N'],
      ['10.5', '2.25', '6', '', '', ''],
    ])
  })

  it('X with error bars gets an X error column', () => {
    const t = createTable({ tableKind: 'xy', columns: 1, rows: 1 })
    const cols = [1, 0.1].map((v) => ({ type: 'number' as const, values: [v] }))
    t.x = { ...t.x!, xFormat: 'numbersWithError', subcolumns: cols }
    expect(texts(tableRows(t))).toEqual([
      ['X', '', 'Group A'],
      ['X', 'X error', ''],
      ['1', '0.1', ''],
    ])
  })

  it('excluded values: kept and marked, or left blank', () => {
    const t = sampleTable('column')
    t.dataSets[0]!.subcolumns[0]!.excluded = [false, true, false, false, false, false]
    const marked = tableRows(t)
    expect(cellOf(marked[2]![0]!)).toEqual({ v: 15, excluded: true })
    expect(exportText(marked[2]![0]!)).toBe('15')
    expect(tableRows(t, { excluded: 'blank' })[2]![0]).toBeNull()
  })

  it('text and calculated variables', () => {
    const t = sampleTable('multipleVariables')
    t.dataSets[0]!.text = ['a', 'b', null, 'd', 'e', 'f']
    t.dataSets[0]!.subcolumns[0]!.values = t.dataSets[0]!.subcolumns[0]!.values.map(() => null)
    t.dataSets[3]!.formula = '=Dose*2'
    const rows = tableRows(t)
    expect(texts(rows).slice(0, 3)).toEqual([
      ['Age', 'Dose', 'Weight', 'Score'],
      ['a', '10', '1', '20'],
      ['b', '30', '4', '60'],
    ])
    expect(rows[3]![0]).toBeNull()
    expectRoundTrip([{ name: 'MV', rows }])
  })

  it("a graph's data sets and rows, in its order", () => {
    const t: DataTable = sampleTable('grouped')
    expect(texts(tableRows(t, { dataSets: ['b'], rows: [2, 0] }))).toEqual([
      ['', 'Treated', '', ''],
      ['', 'Y1', 'Y2', 'Y3'],
      ['Het', '18', '16', '19'],
      ['WT', '14', '13', '16'],
    ])
  })
})

describe('results as rows', () => {
  const values: ResultValue[] = [
    { kind: 'number', v: 1.234567 },
    { kind: 'number', v: 0.000012345, digits: 3 },
    { kind: 'number', v: Number.NaN },
    { kind: 'number', v: Number.NEGATIVE_INFINITY },
    { kind: 'integer', v: 12 },
    { kind: 'pvalue', v: 0.01234 },
    { kind: 'pvalue', v: 0.000001 },
    { kind: 'pSummary', v: 0.003 },
    { kind: 'interval', lo: -0.5, hi: 2.25, level: 0.95 },
    { kind: 'text', v: 'Welch' },
    { kind: 'bool', v: true },
  ]

  it('as displayed: the view’s text, numbers kept in full with a matching Excel format', () => {
    const cells = values.map((v) => resultCells(v, { settings }))
    expect(cells.map((c) => c.map(exportText))).toEqual([
      ['1.235'],
      ['1.23e-5'],
      ['—'],
      ['-∞'],
      ['12'],
      ['0.0123'],
      ['<0.0001'],
      ['**'],
      ['-0.5000 to 2.250'],
      ['Welch'],
      ['Yes'],
    ])
    expect(cells[0]![0]).toEqual({ v: 1.234567, text: '1.235', format: '0.000' })
    expect(cells[1]![0]).toEqual({ v: 0.000012345, text: '1.23e-5', format: '0.00E+00' })
    expect(cells[4]![0]).toEqual({ v: 12, text: '12', format: '0' })
    expect(cells[5]![0]).toEqual({ v: 0.01234, text: '0.0123', format: '0.0000' })
    // What Excel can't show as a number is text.
    for (const i of [2, 3, 6, 7, 8]) expect(typeof cells[i]![0]).toBe('string')
  })

  it('in full: raw numbers, an interval as two', () => {
    const cells = values.map((v) => resultCells(v, { settings, mode: 'full' }))
    expect(cells).toEqual([
      [1.234567],
      [0.000012345],
      [null],
      ['-∞'],
      [12],
      [0.01234],
      [0.000001],
      ['**'],
      [-0.5, 2.25],
      ['Welch'],
      ['Yes'],
    ])
  })

  it('Excel formats for displayed numbers', () => {
    expect(displayFormat('3')).toBe('0')
    expect(displayFormat('-0.050')).toBe('0.000')
    expect(displayFormat('.012')).toBe('#.000')
    expect(displayFormat('1.2e+10')).toBe('0.0E+00')
    expect(displayFormat('<.001')).toBeNull()
    expect(displayFormat('>0.9999')).toBeNull()
  })

  const blocks: ResultBlock[] = [
    {
      type: 'keyValue',
      title: 'Unpaired t test',
      rows: [
        { label: 'P value', value: { kind: 'pvalue', v: 0.0321 } },
        { label: '95% CI', value: { kind: 'interval', lo: 1, hi: 3, level: 0.95 } },
      ],
    },
    {
      type: 'table',
      title: 'Comparisons',
      columns: ['Comparison', 'Difference', '95% CI'],
      rows: [
        [
          { kind: 'text', v: 'A vs B' },
          { kind: 'number', v: 2 },
          { kind: 'interval', lo: 1, hi: 3, level: 0.95 },
        ],
        [
          { kind: 'text', v: 'A vs C' },
          { kind: 'number', v: 1 },
          { kind: 'text', v: '—' },
        ],
      ],
    },
    { type: 'note', text: 'Values of 0 were left out.' },
  ]

  it('every block kind, laid out as on screen', () => {
    const rows = stackSections(blocks.map((b) => ({ rows: blockRows(b, { settings }) })))
    expect(texts(rows)).toEqual([
      ['Unpaired t test'],
      ['P value', '0.0321'],
      ['95% CI', '1.000 to 3.000'],
      [],
      ['Comparisons'],
      ['Comparison', 'Difference', '95% CI'],
      ['A vs B', '2.000', '1.000 to 3.000'],
      ['A vs C', '1.000', '—'],
      [],
      ['Values of 0 were left out.'],
    ])
    expectRoundTrip([{ name: 'Results', rows }])
  })

  it('in full, an interval column splits in two', () => {
    const rows = blockRows(blocks[1]!, { settings, mode: 'full' })
    expect(texts(rows)).toEqual([
      ['Comparisons'],
      ['Comparison', 'Difference', '95% CI (lower)', '95% CI (upper)'],
      ['A vs B', '2', '1', '3'],
      ['A vs C', '1', '—', ''],
    ])
    expect(texts(blockRows(blocks[0]!, { settings, mode: 'full' }))[2]).toEqual([
      '95% CI',
      '1',
      '3',
    ])
  })

  // Roadmap 51d: the summary sentence first (it is stored last), a comparisons table's header
  // under its title.
  it('the summary first, as a sentence; a table’s header under its title', () => {
    const sheet = {
      key: 'r',
      title: 'R',
      blocks: [
        { ...blocks[1]!, caption: 'Tukey: all 2 pairs as one family.' } as ResultBlock,
        {
          type: 'summary',
          parts: [
            'B is higher than A by ',
            { value: { kind: 'number', v: 2, digits: 3 }, role: 'estimate' },
            ' (',
            { value: { kind: 'interval', lo: 1, hi: 3, level: 0.95 }, role: 'ci' },
            '); ',
            { value: { kind: 'pvalue', v: 0.00001 }, role: 'p' },
            '.',
          ],
        } as ResultBlock,
      ],
    }
    expect(texts(resultSheetRows(sheet, { settings })).slice(0, 4)).toEqual([
      ['B is higher than A by 2 (95% CI 1 to 3); P < 0.0001.'],
      [],
      ['Comparisons'],
      ['Tukey: all 2 pairs as one family.'],
    ])
    expect(resultSheetHtml(sheet.blocks, { settings })).toMatch(
      /^<p>B is higher than A by 2 \(95% CI 1 to 3\); P &lt; 0\.0001\.<\/p>/,
    )
  })

  it('a sheet for a file: heading, messages, blocks', () => {
    const result = {
      diagnostics: [{ level: 'warning', message: '1 value excluded' }],
    } as AnalysisResult
    const rows = resultSheetFileRows(
      't test – Results',
      result,
      { key: 'r', title: 'R', blocks },
      {
        settings,
      },
    )
    expect(texts(rows).slice(0, 4)).toEqual([
      ['t test – Results'],
      ['1 value excluded'],
      [],
      ['Unpaired t test'],
    ])
  })

  it('HTML: a table per block, notes as paragraphs, as displayed', () => {
    const html = resultSheetHtml(blocks, { settings, mode: 'full' })
    expect(html.split('<table').length - 1).toBe(2)
    expect(html).toContain('<p>Values of 0 were left out.</p>')
    expect(html).toContain('1.000 to 3.000')
  })
})

describe('stacked sections', () => {
  it('put a blank row between sections, each under its title', () => {
    const rows = stackSections([
      { title: 'A', rows: [[1]] },
      { rows: [[2]] },
      { title: 'C', rows: [] },
    ])
    expect(rows.map((r) => r.map((c: Cell) => exportText(c)))).toEqual([
      ['A'],
      ['1'],
      [],
      ['2'],
      [],
      ['C'],
    ])
  })
})
