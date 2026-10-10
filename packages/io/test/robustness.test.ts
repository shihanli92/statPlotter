import {
  type AnalysisNode,
  type AnalysisResult,
  createProject,
  createTable,
  newNodeId,
  type Project,
} from '@ps/model'
import { strFromU8, strToU8, unzipSync, type Zippable, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { checkPadding } from '../src/import/budget.ts'
import { parseXml, textContent, type XmlElement } from '../src/import/xml.ts'
import {
  detectDecimal,
  gridToTsv,
  ImportError,
  importFile,
  MAX_IMPORT_CELLS,
  MAX_PADDING,
  ProjectFileError,
  parseClipboardGrid,
  parseNumber,
  readCsv,
  readProjectFile,
  readPzfx,
  readXlsx,
  sniffDelimiter,
  writeProjectFile,
} from '../src/index.ts'
import { unzipLimited, ZipTooLargeError } from '../src/zip.ts'

/** Rewrites the declared uncompressed size of every central-directory entry matching `name`. */
function declareSize(zip: Uint8Array, name: RegExp, size: number): Uint8Array {
  const out = zip.slice()
  const view = new DataView(out.buffer)
  for (let i = 0; i + 46 <= out.length; i++) {
    if (view.getUint32(i, true) !== 0x02014b50) continue
    const nameLen = view.getUint16(i + 28, true)
    const entry = strFromU8(out.subarray(i + 46, i + 46 + nameLen))
    if (name.test(entry)) view.setUint32(i + 24, size, true)
  }
  return out
}

describe('numbers and decimal separators', () => {
  it('does not read "0,125" as thousands', () => {
    expect(parseNumber('0,125')).toBeNull()
    expect(parseNumber('1,250')).toBe(1250)
    expect(parseNumber('-12,345.5')).toBe(-12345.5)
    expect(parseNumber('01,250')).toBeNull()
  })

  it('detects decimal commas only from unambiguous cells', () => {
    expect(detectDecimal(['1,250', '2,375', '0,125'])).toBe(',')
    expect(detectDecimal(['1,5', '1.234,5'])).toBe(',')
    expect(detectDecimal(['1,250', '2,375'])).toBeNull()
    expect(detectDecimal(['1.500', 'x'])).toBeNull()
    expect(detectDecimal(['1,5', '2.5'])).toBeNull()
    expect(detectDecimal(['2.5', '1,234'])).toBe('.')
  })
})

describe('clipboard', () => {
  it('pastes decimal-comma data', () => {
    expect(parseClipboardGrid('1,250\n2,375\n0,125\n')).toEqual([[1.25], [2.375], [0.125]])
    expect(parseClipboardGrid('a\tb\n1,5\t1.500\n')).toEqual([
      ['a', 'b'],
      [1.5, 1500],
    ])
    // Ambiguous or mixed data keeps the decimal point.
    expect(parseClipboardGrid('1,250\n2,375\n')).toEqual([[1250], [2375]])
    expect(parseClipboardGrid('1,5\t2.5\n')).toEqual([['1,5', 2.5]])
  })

  it('unquotes Excel cells with line breaks, tabs and quotes', () => {
    expect(parseClipboardGrid('"line1\nline2"\t1\n2\t3\n')).toEqual([
      ['line1\nline2', 1],
      [2, 3],
    ])
    expect(parseClipboardGrid('"a\tb"\t1\r\n')).toEqual([['a\tb', 1]])
    const grid = [['a\tb', 'x\ny', 'say "hi"', 1.5, null]]
    expect(parseClipboardGrid(gridToTsv(grid))).toEqual(grid)
  })

  it('a stray quote in plain text does not swallow the paste', () => {
    expect(parseClipboardGrid('"abc\t1\n2\t3')).toEqual([
      ['"abc', 1],
      [2, 3],
    ])
    expect(parseClipboardGrid('5" nail\t1\n')).toEqual([['5" nail', 1]])
  })
})

describe('readCsv decimal commas', () => {
  it('detects decimal commas in tab-separated text', () => {
    expect(readCsv('a\tb\n0,125\t0,5\n2,250\t1,75\n').rows).toEqual([
      ['a', 'b'],
      [0.125, 0.5],
      [2.25, 1.75],
    ])
  })

  it('reads one column of decimal-comma numbers as one column', () => {
    expect(sniffDelimiter('Wert\n1,5\n2,25\n3,75\n')).toBe('none')
    expect(readCsv('Wert\n1,5\n2,25\n3,75\n').rows).toEqual([['Wert'], [1.5], [2.25], [3.75]])
    expect(readCsv('1,05\n2,25\n').rows).toEqual([[1.05], [2.25]])
    // Two integer columns stay two columns.
    expect(readCsv('x,y\n1,5\n2,25').rows).toEqual([
      ['x', 'y'],
      [1, 5],
      [2, 25],
    ])
    expect(readCsv('1,5\n2,25\n').rows).toEqual([
      [1, 5],
      [2, 25],
    ])
  })

  it('reads "1.500" as 1500 in decimal-comma data', () => {
    expect(readCsv('a;b\n1.500;2,5\n1.250;3\n').rows).toEqual([
      ['a', 'b'],
      [1500, 2.5],
      [1250, 3],
    ])
    // A semicolon file whose numbers use a decimal point.
    expect(readCsv('a;b\n1.500;2.5\n').rows).toEqual([
      ['a', 'b'],
      [1.5, 2.5],
    ])
  })

  it('honours explicit delimiter and decimal options', () => {
    expect(readCsv('a;b\n1,5;2', { decimal: '.' }).rows).toEqual([
      ['a', 'b'],
      ['1,5', 2],
    ])
    expect(readCsv('x\n1,250\n2,375', { delimiter: 'none', decimal: ',' }).rows).toEqual([
      ['x'],
      [1.25],
      [2.375],
    ])
    const csv = strToU8('a\tb\n1,5\t2')
    expect(importFile('d.tsv', csv)).toMatchObject({
      sheets: [
        {
          rows: [
            ['a', 'b'],
            [1.5, 2],
          ],
        },
      ],
    })
    expect(importFile('d.tsv', csv, { delimiter: 'auto', decimal: '.' })).toMatchObject({
      sheets: [
        {
          rows: [
            ['a', 'b'],
            ['1,5', 2],
          ],
        },
      ],
    })
    expect(importFile('d.txt', csv, { delimiter: ',' })).toMatchObject({
      sheets: [
        {
          rows: [
            ['a\tb', null],
            [1, '5\t2'],
          ],
        },
      ],
    })
  })
})

// ── XLSX ──────────────────────────────────────────────────────────────────────────────────────

const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
function xlsx(sheetXml: string): Uint8Array {
  const files: Zippable = {
    '_rels/.rels': strToU8(
      `<Relationships><Relationship Id="rId1" Type="${OD}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    'xl/workbook.xml': strToU8(
      `<workbook xmlns:r="${OD}"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<Relationships><Relationship Id="rId1" Type="${OD}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    ),
    'xl/worksheets/sheet1.xml': strToU8(sheetXml),
  }
  return zipSync(files)
}
const ws = (rows: string) => `<worksheet><sheetData>${rows}</sheetData></worksheet>`

describe('readXlsx robustness', () => {
  it('ignores malformed row and cell references', () => {
    expect(readXlsx(xlsx(ws('<row r="0"><c><v>1</v></c></row>')))[0]!.rows).toEqual([[1]])
    expect(readXlsx(xlsx(ws('<row><c r="A0"><v>1</v></c></row>')))[0]!.rows).toEqual([[1]])
    expect(readXlsx(xlsx(ws('<row r="abc"><c r="zz"><v>1</v></c></row>')))[0]!.rows).toEqual([[1]])
    expect(
      readXlsx(
        xlsx(ws('<row r="2"><c r="B2"><v>1</v></c></row><row r="-1"><c><v>2</v></c></row>')),
      )[0]!.rows,
    ).toEqual([
      [null, null],
      [null, 1],
      [2, null],
    ])
  })

  it('refuses archives that would decompress to too much', () => {
    const book = xlsx(ws('<row><c><v>1</v></c></row>'))
    const bomb = declareSize(book, /sheet1\.xml$/, 0x7fffffff)
    expect(() => readXlsx(bomb)).toThrow(ImportError)
    expect(() => readXlsx(bomb)).toThrow(/too large to import/)
  })

  it('caps each entry and the whole archive', () => {
    const zip = zipSync({ a: new Uint8Array(100), b: new Uint8Array(100) })
    expect(Object.keys(unzipLimited(zip, undefined, { entry: 100, total: 200 }))).toEqual([
      'a',
      'b',
    ])
    expect(() => unzipLimited(zip, undefined, { entry: 99, total: 1000 })).toThrow(ZipTooLargeError)
    expect(() => unzipLimited(zip, undefined, { entry: 100, total: 199 })).toThrow(/more than/)
    // Entries that aren't extracted don't count.
    expect(unzipLimited(zip, (n) => n === 'a', { entry: 100, total: 100 })).toHaveProperty('a')
  })

  // Audit 2 X3: hostile archives.
  it('refuses declared sizes its compressed bytes can’t inflate to, before allocating', () => {
    // A few KB claiming 8 × 256 MB would have allocated 2 GiB.
    const files: Zippable = {}
    for (let i = 0; i < 8; i++) files[`e${i}`] = new Uint8Array(100)
    const liar = declareSize(zipSync(files), /^e/, 256 * 2 ** 20 - 1)
    expect(liar.length).toBeLessThan(4096)
    const roomy = { entry: 2 ** 30, total: 2 ** 32 }
    expect(() => unzipLimited(liar, undefined, roomy)).toThrow(/claims to decompress/)
    // A real 1000:1 entry is fine.
    const real = zipSync({ z: new Uint8Array(1_000_000) }, { level: 9 })
    expect(unzipLimited(real, undefined, roomy).z).toHaveLength(1_000_000)
  })

  it('refuses entries whose compressed sizes add up to more than the file', () => {
    const zip = zipSync({ a: new Uint8Array(100) })
    const view = new DataView(zip.buffer)
    for (let i = 0; i + 46 <= zip.length; i++)
      if (view.getUint32(i, true) === 0x02014b50) view.setUint32(i + 20, zip.length + 1, true)
    expect(() => unzipLimited(zip)).toThrow(/claim more bytes/)
  })

  it('refuses an archive listing absurdly many entries (a zip64 record claiming 4e9)', () => {
    // A zip64 end record (count 4e9, directory at 0), its locator, and the classic end record.
    const out = new Uint8Array(56 + 20 + 22)
    const v = new DataView(out.buffer)
    v.setUint32(0, 0x06064b50, true)
    v.setUint32(32, 4_000_000_000, true)
    v.setUint32(56, 0x07064b50, true)
    v.setUint32(56 + 8, 0, true)
    v.setUint32(76, 0x06054b50, true)
    v.setUint16(76 + 8, 0xffff, true)
    v.setUint16(76 + 10, 0xffff, true)
    expect(() => unzipLimited(out)).toThrow(/more than 100000 entries/)
    expect(() => readXlsx(out)).toThrow(ImportError)
    expect(() => readProjectFile(out)).toThrow(ProjectFileError)
  })

  it('entries named after Object.prototype members are plain keys, and `__proto__` is skipped', () => {
    // fflate can't write a `__proto__` entry: write `xxxxxxxxx` and rename it in the bytes.
    const zip = zipSync({
      constructor: strToU8('c'),
      toString: strToU8('t'),
      xxxxxxxxx: strToU8('p'),
    })
    const renamed = zip.slice()
    for (let i = 0; i + 9 <= renamed.length; i++)
      if (strFromU8(renamed.subarray(i, i + 9)) === 'xxxxxxxxx')
        renamed.set(strToU8('__proto__'), i)
    expect(Object.keys(unzipSync(renamed))).not.toContain('xxxxxxxxx')
    const got = unzipLimited(renamed)
    expect(Object.getPrototypeOf(got)).toBeNull()
    expect(Object.keys(got).sort()).toEqual(['constructor', 'toString'])
    expect(strFromU8(got['constructor' as string]!)).toBe('c')
    expect(got.valueOf).toBeUndefined()
  })

  it('a workbook relationship pointing at `constructor` or `__proto__` finds no part', () => {
    for (const target of ['/constructor', '/__proto__', '/hasOwnProperty']) {
      const files = unzipSync(xlsx(ws('<row><c><v>1</v></c></row>')))
      files['xl/_rels/workbook.xml.rels'] = strToU8(
        `<Relationships><Relationship Id="rId1" Type="${OD}/worksheet" Target="${target}"/></Relationships>`,
      )
      expect(() => readXlsx(zipSync(files))).toThrow(/no worksheets/)
    }
  })

  // Audit 2 X6: the cell and unzip budgets are a workbook's and an import's, not a sheet's.
  /** A workbook of sheets, each `<sheet>` naming one of `parts` (its index) by relationship. */
  function workbook(sheets: number[], parts: string[]): Uint8Array {
    const files: Zippable = {
      '_rels/.rels': strToU8(
        `<Relationships><Relationship Id="rId1" Type="${OD}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      ),
      'xl/workbook.xml': strToU8(
        `<workbook xmlns:r="${OD}"><sheets>${sheets
          .map((p, i) => `<sheet name="S${i + 1}" sheetId="${i + 1}" r:id="rId${p + 1}"/>`)
          .join('')}</sheets></workbook>`,
      ),
      'xl/_rels/workbook.xml.rels': strToU8(
        `<Relationships>${parts
          .map(
            (_, p) =>
              `<Relationship Id="rId${p + 1}" Type="${OD}/worksheet" Target="worksheets/sheet${p + 1}.xml"/>`,
          )
          .join('')}</Relationships>`,
      ),
    }
    parts.forEach((xml, p) => {
      files[`xl/worksheets/sheet${p + 1}.xml`] = strToU8(xml)
    })
    return zipSync(files)
  }
  // A1 and E2: a 2 × 5 grid (10 cells) from two values.
  const corners = ws(
    '<row r="1"><c r="A1"><v>1</v></c></row><row r="2"><c r="E2"><v>2</v></c></row>',
  )

  it('sheets share one budget of cells, counted before the grid is made', () => {
    const book = workbook([0, 1, 2], [corners, corners, corners])
    const budget = { cells: 25, bytes: 2 ** 29 }
    expect(() => readXlsx(book, budget)).toThrow(
      'Sheet "S3" is too large to import (2 rows × 5 columns; with the sheets before it, more than 20,000,000 cells).',
    )
    expect(readXlsx(book, { cells: 30, bytes: 2 ** 29 })).toHaveLength(3)
    // One sheet's bounding box alone (A1 and T1000001) past the cap: refused before padding.
    const huge = ws(
      '<row r="1"><c r="A1"><v>1</v></c></row><row r="1000001"><c r="T1000001"><v>2</v></c></row>',
    )
    expect(() => readXlsx(workbook([0], [huge]))).toThrow(
      'Sheet "S1" is too large to import (1000001 rows × 20 columns).',
    )
  })

  it('several sheets naming one part read it once', () => {
    const book = workbook([0, 0, 1, 0], [corners, ws('<row><c><v>3</v></c></row>')])
    const sheets = readXlsx(book, { cells: 11, bytes: 2 ** 29 })
    expect(sheets.map((s) => s.name)).toEqual(['S1', 'S3'])
  })

  it('a workbook inflates from the bytes left in the import', () => {
    const book = workbook([0], [corners])
    const budget = { cells: 100, bytes: 100 }
    expect(() => readXlsx(book, budget)).toThrow(/too large to import/)
    const roomy = { cells: 100, bytes: 2 ** 20 }
    readXlsx(book, roomy)
    expect(roomy.bytes).toBeLessThan(2 ** 20)
    expect(roomy.cells).toBe(90)
  })

  it('a .zip’s files share the import’s cell budget', () => {
    // Each CSV pads to 21 × 500,000 = 10.5 million cells from half a megabyte of text.
    const padded = strToU8(`${'x,'.repeat(20)}x${'\n.'.repeat(499_999)}\n`)
    const one = zipSync({ 'a.csv': padded })
    expect(importFile('one.zip', one)).toMatchObject({ kind: 'sheets' })
    const two = zipSync({ 'a.csv': padded, 'b.csv': padded })
    expect(() => importFile('two.zip', two)).toThrow(
      /Sheet "b" is too large to import \(500000 rows × 21 columns; with the sheets before it/,
    )
    // A long line over many short ones in one member: refused before it is padded.
    const bomb = zipSync({ 'c.csv': strToU8(`${','.repeat(100_000)}\n${'\n'.repeat(1_000)}`) })
    expect(() => importFile('bomb.zip', bomb)).toThrow(/too large to import/)
  })

  // Audit 2 (decision 720): a CSV on its own has no cap (large ones are legitimate), but its
  // padded grid may not be far larger than the cells its text holds.
  it('a CSV on its own refuses a long line over many short ones, before padding', () => {
    // 100,001 fields on one line over 1,000 empty ones: 100 million cells from 100 KB.
    const bomb = strToU8(`${','.repeat(100_000)}\n${'\n'.repeat(1_000)}`)
    expect(() => importFile('bomb.csv', bomb)).toThrow(ImportError)
    expect(() => importFile('bomb.csv', bomb)).toThrow(
      'Sheet "bomb" is too large to import (1001 rows × 100001 columns, almost all of them empty: one line is far longer than the others).',
    )
    // The same shape small enough to pad within the cap is read (padded as before).
    const small = importFile('small.csv', strToU8(`1${',2'.repeat(999)}\n${'3\n'.repeat(999)}`))
    expect(small).toMatchObject({ kind: 'sheets' })
    if (small.kind === 'sheets') expect(small.sheets[0]!.rows).toHaveLength(1000)
  })

  it('a large CSV on its own past the cap is read when it is near rectangular', () => {
    // (Grids past 20 million cells, by their counts: reading one takes gigabytes.)
    const big = MAX_IMPORT_CELLS * 3
    // Rectangular, ragged (half the rows a quarter as wide pad to 1.6 × their cells), a header.
    expect(() => checkPadding('a', 3_000_000, 20, big)).not.toThrow()
    expect(() => checkPadding('a', 3_000_000, 20, 1_500_000 * 25)).not.toThrow()
    expect(() => checkPadding('a', 3_000_001, 20, big + 1)).not.toThrow()
    // Up to MAX_PADDING times the cells read, then refused.
    expect(() => checkPadding('a', 3_000_000, 20, big / MAX_PADDING)).not.toThrow()
    expect(() => checkPadding('a', 3_000_000, 20, big / MAX_PADDING - 1)).toThrow(ImportError)
    // Any shape within the cap.
    expect(() => checkPadding('a', MAX_IMPORT_CELLS, 1, 1)).not.toThrow()
    expect(() => checkPadding('a', MAX_IMPORT_CELLS + 1, 1, 1)).toThrow(/too large to import/)
    // A sheet read through readCsv near the cap (2,000 × 1,000), ragged, is padded as before.
    const ragged = `${`1${',2'.repeat(999)}\n`.repeat(1_000)}${'1,2\n'.repeat(1_000)}`
    const sheet = readCsv(ragged)
    expect(sheet.rows).toHaveLength(2_000)
    expect(sheet.rows.at(-1)).toHaveLength(1_000)
  })

  it('a project file with lying sizes is refused as too large', () => {
    const { project } = sample()
    const bytes = declareSize(writeProjectFile(project), /^nodes|^tables|manifest/, 2 ** 28 - 1)
    expect(() => readProjectFile(bytes)).toThrow(ProjectFileError)
    expect(() => readProjectFile(bytes)).toThrow(/too large to open/)
  })
})

describe('deeply nested XML', () => {
  it('refuses absurd nesting with an ImportError', () => {
    const deep = `${'<a>'.repeat(200_000)}x${'</a>'.repeat(200_000)}`
    expect(() => parseXml(deep)).toThrow(/nested more than/)
    expect(() =>
      readPzfx(
        `<GraphPadPrismFile><Table TableType="OneWay"><Title>${deep}</Title></Table></GraphPadPrismFile>`,
      ),
    ).toThrow(ImportError)
  })

  it('textContent walks deep trees without recursion, in document order', () => {
    let el: XmlElement = { name: 'leaf', attrs: {}, children: ['x'] }
    for (let i = 0; i < 100_000; i++) el = { name: 'a', attrs: {}, children: ['<', el, '>'] }
    const text = textContent(el)
    expect(text.length).toBe(200_001)
    expect(text.slice(99_998, 100_003)).toBe('<<x>>')
    expect(textContent(parseXml('<a>1<b>2<BR/>3</b><skip>no</skip>4</a>'), ['skip'])).toBe('12\n34')
  })

  it('finds tables nested inside other elements, in file order', () => {
    const { tables } = readPzfx(
      '<GraphPadPrismFile><Folder><Table TableType="OneWay"><Title>one</Title><YColumn><Subcolumn><d>1</d></Subcolumn></YColumn></Table></Folder>' +
        '<Table TableType="OneWay"><Title>two</Title><YColumn><Subcolumn><d>2</d></Subcolumn></YColumn></Table></GraphPadPrismFile>',
    )
    expect(tables.map((t) => t.name)).toEqual(['one', 'two'])
  })
})

// ── Project file ──────────────────────────────────────────────────────────────────────────────

function sample(): { project: Project; analysis: AnalysisNode } {
  const project = createProject('Sample', new Date('2026-09-28T00:00:00Z'))
  const table = createTable({ rows: 2, columns: 1 })
  const analysis: AnalysisNode = {
    kind: 'analysis',
    id: newNodeId(),
    name: 'a',
    analysisId: 'descriptive',
    pluginVersion: 1,
    input: { source: table.id, dataSets: [] },
    params: {},
  }
  project.nodes[table.id] = table
  project.nodes[analysis.id] = analysis
  project.order.push(table.id, analysis.id)
  return { project, analysis }
}

const result: AnalysisResult = {
  status: 'ok',
  diagnostics: [],
  sheets: [
    {
      key: 'r',
      title: 'NaN',
      blocks: [{ type: 'note', text: 'Inf' }],
    },
  ],
  values: {
    text: { kind: 'text', v: '-Inf' },
    nan: { kind: 'number', v: Number.NaN },
    inf: { kind: 'number', v: Number.NEGATIVE_INFINITY },
  },
  comparisons: [],
  outputs: {},
}

const rezip = (bytes: Uint8Array, edit: (files: Record<string, Uint8Array>) => void) => {
  const files = unzipSync(bytes)
  edit(files)
  return zipSync(files)
}

describe('project file robustness', () => {
  it('keeps text that reads "NaN" or "Inf" apart from non-finite numbers', () => {
    const { project, analysis } = sample()
    const bytes = writeProjectFile(project, {
      results: new Map([[analysis.id, { inputKey: 'k', result }]]),
    })
    expect(readProjectFile(bytes).results.get(analysis.id)).toEqual({ inputKey: 'k', result })
  })

  it('drops old-style or unreadable result caches without failing', () => {
    const { project, analysis } = sample()
    const old = rezip(writeProjectFile(project), (files) => {
      files[`results/${analysis.id}.json`] = strToU8(
        JSON.stringify({
          inputKey: 'k',
          result: { ...result, values: { nan: { kind: 'number', v: 'NaN' } } },
        }),
      )
    })
    expect(readProjectFile(old).results.size).toBe(0)
    const corrupt = rezip(writeProjectFile(project), (files) => {
      files[`results/${analysis.id}.json`] = strToU8('{not json')
    })
    expect(readProjectFile(corrupt).results.size).toBe(0)
  })

  it('node files named after Object.prototype members are reported, not lost', () => {
    const { project } = sample()
    const table = createTable({ rows: 1, columns: 1 })
    const proto = rezip(writeProjectFile(project), (files) => {
      files['tables/__proto__.json'] = strToU8(JSON.stringify({ ...table, id: '__proto__' }))
    })
    expect(() => readProjectFile(proto)).toThrow(/bad node file tables\/__proto__.json/)
    const ctor = rezip(writeProjectFile(project), (files) => {
      const manifest = JSON.parse(strFromU8(files['manifest.json']!))
      manifest.order.push('constructor')
      files['manifest.json'] = strToU8(JSON.stringify(manifest))
    })
    expect(() => readProjectFile(ctor)).toThrow(/order lists missing node constructor/)
  })

  it('refuses archives that would decompress to too much', () => {
    const { project } = sample()
    const bomb = declareSize(writeProjectFile(project), /^tables\//, 0x7fffffff)
    expect(() => readProjectFile(bomb)).toThrow(ProjectFileError)
    expect(() => readProjectFile(bomb)).toThrow(/too large to open/)
  })
})
