import { readFileSync } from 'node:fs'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../../stats/test/rng.ts'
import { cpuRatio } from '../../stats/test/timing.ts'
import { parseRef, stringItem, visitWorksheet, type WorksheetVisitor } from '../src/import/xlsx.ts'
import { child, elements, parseXml, type XmlElement } from '../src/import/xml.ts'
import { writeXlsx } from '../src/index.ts'

// Audit 2 (P13): worksheets read as their text is scanned (`visitWorksheet`, on `scanXml`) give
// exactly what reading their tree gave (`visitWorksheetTree` below, the reader's walk until the
// stream replaced it, of `parseXml`): the same rows and cells, the same errors. Compared over the
// shapes of the import tests' workbooks, the export's, the end-to-end fixture's, and random
// worksheets of every element the reader looks at (and others it skips), with entities, CDATA,
// prefixes, comments and malformed text. (Before the switch the test also compared `parseXml` on
// `scanXml` with the parser it replaced: the same trees and errors on all of these.)

/** The worksheet's rows and cells from its tree: the reader before the stream. */
function visitWorksheetTree(ws: XmlElement, visit: WorksheetVisitor): void {
  const textOf = (el: XmlElement) =>
    el.children.map((c) => (typeof c === 'string' ? c : '')).join('')
  const sheetData = child(ws, 'sheetData')
  for (const row of sheetData ? elements(sheetData, 'row') : []) {
    visit.row(row.attrs.r)
    for (const c of elements(row, 'c')) {
      const v = child(c, 'v')
      const is = child(c, 'is')
      visit.cell(c.attrs, v ? textOf(v) : undefined, is ? stringItem(is) : null)
    }
  }
}

type Event =
  | ['row', string | undefined]
  | ['c', Record<string, string>, string | undefined, string | null]

/** What a visitor sees, or the error its reading throws. */
function events(read: (v: WorksheetVisitor) => void): Event[] | string {
  const out: Event[] = []
  try {
    read({
      row: (r) => out.push(['row', r]),
      cell: (attrs, v, inline) => out.push(['c', { ...attrs }, v, inline]),
    })
  } catch (e) {
    return `${(e as Error).name}: ${(e as Error).message}`
  }
  return out
}

function same(text: string) {
  const tree = events((v) => visitWorksheetTree(parseXml(text), v))
  const scanned = events((v) => visitWorksheet(text, v))
  expect(scanned, text.slice(0, 300)).toEqual(tree)
}

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'

/** Worksheets of the import and robustness tests' shapes. */
const FIXED = [
  `<worksheet ${NS}><dimension ref="A1:E4"/><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="inlineStr"><is><t>Inline &amp; co</t></is></c></row>
<row r="2"><c r="A2"><v>1.5</v></c><c r="B2" t="b"><v>1</v></c><c r="C2"><f>A2*2</f><v>3</v></c><c r="D2" t="e"><v>#DIV/0!</v></c><c r="E2" t="b"><v>0</v></c></row>
<row r="4"><c r="A4" s="1"><v>45000</v></c><c r="B4" s="3"><v>2.5</v></c><c r="C4" t="str"><f>"x"&amp;"y"</f><v>xy</v></c><c r="D4" t="s"><v>2</v></c><c r="E4" t="s"><v>3</v></c></row>
</sheetData><mergeCells count="1"><mergeCell ref="A1:B1"/></mergeCells></worksheet>`,
  `<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>
<x:row><x:c><x:v>1</x:v></x:c><x:c s="2"><x:v>2</x:v></x:c></x:row>
<x:row><x:c t="d"><x:v>2024-01-02</x:v></x:c><x:c><x:f>SUM(A1:A1)</x:f></x:c></x:row>
</x:sheetData></x:worksheet>`,
  `<worksheet ${NS}><sheetData/></worksheet>`,
  '<worksheet><sheetData><row r="0"><c><v>1</v></c></row></sheetData></worksheet>',
  '<worksheet><sheetData><row r="abc"><c r="zz"><v>1</v></c></row><row r="-1"/></sheetData></worksheet>',
  '<?xml version="1.0"?>\n<!DOCTYPE x [<!ENTITY a "b">]><!-- c --><worksheet><sheetData><row><c t="inlineStr"><is><r><rPr><b/></rPr><t xml:space="preserve">Ri </t><t>no</t></r><r><t><![CDATA[ch<]]></t></r><rPh><t>skip</t></rPh><t>_x000D_</t></is></c></row></sheetData></worksheet>',
  '﻿<worksheet><sheetData><row><c><v>1</v><v>2</v></c><c><is/><is><t>b</t></is></c><c/><c><v/></c></row></sheetData><sheetData><row><c><v>9</v></c></row></sheetData></worksheet><again><sheetData><row><c><v>8</v></c></row></sheetData></again>',
  '<worksheet><other><sheetData><row><c><v>1</v></c></row></sheetData></other><sheetData><x><row><c><v>2</v></c></row></x><row><x><c><v>3</v></c></x><c><x><v>4</v></x><v>5<x>6</x>7</v></c></row></sheetData></worksheet>',
  '<worksheet> <sheetData ><row　r="1"><c\tr="A1"\nt="str"><v>&#x41;&#66;&unknown;&lt;</v></c></row></sheetData></worksheet>',
]

/** Malformed texts: each must fail the same way. */
const MALFORMED = [
  '',
  'just text',
  '<a><b></a>',
  '<a>',
  '<a b=c/>',
  '<a b="c/>',
  '<a b>',
  '<',
  '<a></b>',
  '</a>',
  '<a><!-- x',
  '<a><![CDATA[x',
  '<?x',
  '<a></a',
  '<worksheet><sheetData><row><c><v>1</v></c></row></sheetData>',
  `${'<a>'.repeat(1001)}${'</a>'.repeat(1001)}`,
  `${'<a>'.repeat(1000)}${'</a>'.repeat(1000)}`,
]

describe('worksheets read as they are scanned (audit 2, P13)', () => {
  it('the import tests’ worksheets, and malformed texts', () => {
    for (const text of [...FIXED, ...MALFORMED]) same(text)
  })

  it('the export’s worksheets and the end-to-end fixture’s', () => {
    const books = [
      writeXlsx([
        {
          name: 'A',
          rows: [
            ['x', 1, null, '  spaced  ', 'a&b<c>"d"', '\u0007ctrl'],
            [{ v: 1.5, format: '0.0' }, { v: 'Title', style: 'title' }, -0, 1e300],
          ],
        },
        { name: 'B', rows: [] },
      ]),
      new Uint8Array(
        readFileSync(new URL('../../../apps/e2e/fixtures/two-sheets.xlsx', import.meta.url)),
      ),
    ]
    for (const book of books)
      for (const [name, data] of Object.entries(unzipSync(book)))
        if (/worksheets\/.*\.xml$/.test(name)) same(strFromU8(data))
  })

  it('random worksheets of every element read and others', () => {
    const u = mulberry32(13)
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(u() * xs.length)]!
    const texts = ['1', ' 2.5 ', '', '&amp;', '&#x41;', 'a b', '_x0041_', '<![CDATA[<c>]]>', ' ']
    const attr = () =>
      pick([
        '',
        ` r="${pick(['A1', 'B2', 'zz', 'A0', '12', '$C$3'])}"`,
        ` t="${pick(['s', 'str', 'inlineStr', 'b', 'e', 'd', 'n'])}"`,
        ` s="${pick(['0', '1', '7'])}"`,
        ` x:r='${pick(['A1', '3'])}'`,
      ])
    const el = (name: string, inner: string) =>
      u() < 0.1 ? `<${name}${attr()}/>` : `<${name}${attr()}${attr()}>${inner}</${name}>`
    const many = (n: number, f: () => string) =>
      Array.from({ length: Math.floor(u() * n) }, f).join('')
    const run = () => el(pick(['t', 'rPr', 'x:t']), pick(texts))
    const inline = () =>
      many(4, () => (u() < 0.5 ? el('t', pick(texts)) : el(pick(['r', 'rPh', 'q']), many(3, run))))
    const valueOrNot = () =>
      many(4, () =>
        pick([
          el('v', pick(texts) + (u() < 0.2 ? el('x', pick(texts)) : '') + pick(texts)),
          el('is', inline()),
          el('f', 'A1'),
          el('x:v', pick(texts)),
          pick(texts),
          '<!-- c -->',
        ]),
      )
    const cells = () => many(5, () => el(pick(['c', 'c', 'c', 'x:c', 'd']), valueOrNot()))
    const rows = () => many(5, () => el(pick(['row', 'row', 'x:row', 'col']), cells()))
    for (let k = 0; k < 400; k++) {
      const body = many(3, () =>
        pick([el('sheetData', rows()), el('dimension', ''), el('other', el('sheetData', rows()))]),
      )
      let text = `<worksheet>${body}</worksheet>${u() < 0.1 ? '<two/>' : ''}`
      // Now and then broken: a character dropped or doubled.
      if (u() < 0.15) {
        const at = Math.floor(u() * text.length)
        text =
          u() < 0.5
            ? text.slice(0, at) + text.slice(at + 1)
            : text.slice(0, at) + text[at] + text.slice(at)
      }
      same(text)
    }
  })

  it('cell references read character by character as the expression read them', () => {
    // The reader's expression before (`parseRowNumber` for the row).
    const reference = (ref: string): [number, number] | null => {
      const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(ref)
      if (!m || !/^\d{1,9}$/.test(m[2]!)) return null
      const row = Number(m[2]!)
      if (row < 1) return null
      let col = 0
      for (const ch of m[1]!.toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64)
      return [row - 1, col - 1]
    }
    const u = mulberry32(7)
    const parts = [
      '$',
      'A',
      'z',
      'XFD',
      'aBc',
      'ABCD',
      '0',
      '1',
      '9',
      '007',
      '1234567890',
      '@',
      '[',
      '`',
      '{',
      'é',
      ' ',
      '\n',
      '-',
      '',
    ]
    const refs = [
      '',
      'A1',
      '$C$3',
      'zz',
      'A0',
      'ABCD1',
      'A$',
      '$$A1',
      'A1 ',
      'A123456789',
      'A1234567890',
    ]
    for (let k = 0; k < 20_000; k++)
      refs.push(
        Array.from(
          { length: 1 + Math.floor(u() * 5) },
          () => parts[Math.floor(u() * parts.length)],
        ).join(''),
      )
    for (const r of refs) expect(parseRef(r), JSON.stringify(r)).toEqual(reference(r))
  })

  it('cost less than building and walking the tree', () => {
    let text = '<worksheet><sheetData>'
    for (let r = 1; r <= 20_000; r++) {
      text += `<row r="${r}">`
      for (let c = 0; c < 10; c++)
        text += `<c r="${String.fromCharCode(65 + c)}${r}" s="1"><v>${(r * c) / 7}</v></c>`
      text += '</row>'
    }
    text += '</sheetData></worksheet>'
    const none: WorksheetVisitor = { row() {}, cell() {} }
    const ratio = cpuRatio(
      () => visitWorksheetTree(parseXml(text), none),
      () => visitWorksheet(text, none),
    )
    expect(ratio).toBeLessThan(0.9)
  })
})
