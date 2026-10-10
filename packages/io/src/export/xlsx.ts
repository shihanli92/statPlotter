import { columnLetters } from '@ps/model'
import { strToU8, type Zippable, zipSync } from 'fflate'
import { type Cell, cellOf, type ExportCell, type ExportSheet, exportText } from './cells.ts'

// A minimal Office Open XML workbook: content types, relationships, the workbook, one part per
// worksheet (inline strings) and the styles (bold titles, grey italic excluded values, number
// formats). Numbers are written in full (JavaScript's shortest round-trip form).

/** Excel's limits. */
export const EXCEL_LIMITS = { rows: 1_048_576, columns: 16_384, sheetName: 31 } as const

/**
 * Worksheet names Excel accepts, in order: at most 31 characters, none of [ ] : * ? / \, not
 * blank, not starting or ending with an apostrophe, not "History" (reserved), and unique without
 * regard to case ("Name (2)" for a repeat).
 */
export function sheetNames(wanted: readonly string[]): string[] {
  const used = new Set<string>()
  return wanted.map((w) => {
    let base = w
      .replace(/[[\]:*?/\\]/g, '_')
      // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters become spaces
      .replace(/[\x00-\x1f]/g, ' ')
      .trim()
      .replace(/^'+|'+$/g, '')
      .trim()
    if (!base || base.toLowerCase() === 'history') base = base ? `${base}_` : 'Sheet'
    for (let k = 1; ; k++) {
      const suffix = k === 1 ? '' : ` (${k})`
      const name = trimName(base, EXCEL_LIMITS.sheetName - suffix.length) + suffix
      if (!used.has(name.toLowerCase())) {
        used.add(name.toLowerCase())
        return name
      }
    }
  })
}

/** At most `n` UTF-16 units (Excel's count), not ending in half a surrogate pair or apostrophe. */
function trimName(s: string, n: number): string {
  let t = s.length > n ? s.slice(0, n) : s
  if (/[\ud800-\udbff]$/.test(t)) t = t.slice(0, -1)
  return t.replace(/'+$/, '').trimEnd() || 'Sheet'
}

/**
 * Text for XML: markup characters escaped; characters XML can't hold (controls, lone
 * surrogates) and carriage returns (which parsers turn into line feeds) in Excel's _xHHHH_
 * form, and text that already looks like that form escaped so it reads back unchanged.
 */
export function xmlText(s: string): string {
  return (
    s
      .replace(/_x[0-9A-Fa-f]{4}_/g, '_x005F$&')
      // biome-ignore lint/suspicious/noControlCharactersInRegex: these are what it replaces
      .replace(/[\x00-\x08\x0b-\x1f\ufffe\uffff]/g, (c) => `_x${hex4(c.charCodeAt(0))}_`)
      .replace(LONE_SURROGATE, REPLACEMENT_CHARACTER)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  )
}

const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, '0')
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g
const REPLACEMENT_CHARACTER = String.fromCharCode(0xfffd)

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const CT = 'application/vnd.openxmlformats-officedocument.spreadsheetml'

// Fonts: 0 normal, 1 bold (column titles), 2 grey italic (excluded values), 3 bold 12 pt (titles),
// 4 blue underlined (links).
const FONTS = [
  '',
  '<b/>',
  '<i/><sz val="11"/><color rgb="FF808080"/>',
  '<b/><sz val="12"/>',
  '<u/><sz val="11"/><color rgb="FF0563C1"/>',
].map(
  (f) =>
    `<font>${f.includes('<sz') ? f : `${f}<sz val="11"/>`}<name val="Calibri"/><family val="2"/></font>`,
)

const fontOf = (c: ExportCell) =>
  c.link !== undefined ? 4 : c.style === 'title' ? 3 : c.style === 'header' ? 1 : c.excluded ? 2 : 0

/** Cell formats (cellXfs) by font and number format, numbered as they are first used. */
class Styles {
  private formats = new Map<string, number>()
  private xfs = new Map<string, number>([['0|0', 0]])

  of(c: ExportCell): number {
    const font = fontOf(c)
    let fmt = 0
    if (c.format && typeof c.v === 'number') {
      fmt = this.formats.get(c.format) ?? 164 + this.formats.size
      this.formats.set(c.format, fmt)
    }
    const key = `${font}|${fmt}`
    let xf = this.xfs.get(key)
    if (xf === undefined) {
      xf = this.xfs.size
      this.xfs.set(key, xf)
    }
    return xf
  }

  xml(): string {
    const numFmts = [...this.formats]
      .map(([code, id]) => `<numFmt numFmtId="${id}" formatCode="${xmlText(code)}"/>`)
      .join('')
    const xfs = [...this.xfs.keys()]
      .map((k) => {
        const [font, fmt] = k.split('|')
        return `<xf numFmtId="${fmt}" fontId="${font}" fillId="0" borderId="0" xfId="0"${font === '0' ? '' : ' applyFont="1"'}${fmt === '0' ? '' : ' applyNumberFormat="1"'}/>`
      })
      .join('')
    return (
      `${XML_HEAD}<styleSheet xmlns="${NS}">` +
      (this.formats.size ? `<numFmts count="${this.formats.size}">${numFmts}</numFmts>` : '') +
      `<fonts count="${FONTS.length}">${FONTS.join('')}</fonts>` +
      '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      `<cellXfs count="${this.xfs.size}">${xfs}</cellXfs>` +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '</styleSheet>'
    )
  }
}

/** A worksheet name in a formula or link: always quoted, apostrophes doubled. */
const quoteName = (name: string) => `'${name.replace(/'/g, "''")}'`

function worksheetXml(sheet: ExportSheet, names: readonly string[], styles: Styles): string {
  if (sheet.rows.length > EXCEL_LIMITS.rows)
    throw new Error(`“${sheet.name}” has more rows than Excel allows (${EXCEL_LIMITS.rows}).`)
  const widths: number[] = []
  const links: string[] = []
  const rows: string[] = []
  sheet.rows.forEach((row, r) => {
    if (row.length > EXCEL_LIMITS.columns)
      throw new Error(
        `“${sheet.name}” has more columns than Excel allows (${EXCEL_LIMITS.columns}).`,
      )
    const cells: string[] = []
    row.forEach((raw: Cell, j) => {
      const c = cellOf(raw)
      const ref = `${columnLetters(j)}${r + 1}`
      const s = styles.of(c)
      const style = s ? ` s="${s}"` : ''
      const v = typeof c.v === 'number' && !Number.isFinite(c.v) ? null : c.v
      if (v === null) {
        if (s) cells.push(`<c r="${ref}"${style}/>`)
      } else if (typeof v === 'number') cells.push(`<c r="${ref}"${style}><v>${v}</v></c>`)
      else {
        const space = /^\s|\s$|[\t\n]/.test(v) ? ' xml:space="preserve"' : ''
        cells.push(`<c r="${ref}"${style} t="inlineStr"><is><t${space}>${xmlText(v)}</t></is></c>`)
      }
      if (c.link !== undefined && names[c.link] !== undefined)
        links.push(
          `<hyperlink ref="${ref}" location="${xmlText(`${quoteName(names[c.link]!)}!A1`)}"/>`,
        )
      // A title runs across the columns beside it: it doesn't size its column.
      if (c.style !== 'title') {
        const len = Math.max(
          ...exportText(c)
            .split('\n')
            .map((l) => l.length),
        )
        widths[j] = Math.max(widths[j] ?? 0, len)
      }
    })
    if (cells.length) rows.push(`<row r="${r + 1}">${cells.join('')}</row>`)
  })
  const cols = widths
    .map((w, j) =>
      w === undefined
        ? ''
        : `<col min="${j + 1}" max="${j + 1}" width="${Math.min(60, Math.max(9, w + 2))}" customWidth="1"/>`,
    )
    .join('')
  return (
    `${XML_HEAD}<worksheet xmlns="${NS}" xmlns:r="${REL_NS}">` +
    (cols ? `<cols>${cols}</cols>` : '') +
    (rows.length ? `<sheetData>${rows.join('')}</sheetData>` : '<sheetData/>') +
    (links.length ? `<hyperlinks>${links.join('')}</hyperlinks>` : '') +
    '</worksheet>'
  )
}

/** An .xlsx workbook of the sheets, in order (at least one: an empty one if none is given). */
export function writeXlsx(sheets: readonly ExportSheet[]): Uint8Array {
  const all = sheets.length ? sheets : [{ name: 'Sheet1', rows: [] }]
  const names = sheetNames(all.map((s) => s.name))
  const styles = new Styles()
  const files: Zippable = {}
  all.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(worksheetXml(s, names, styles))
  })
  const sheetRels = all.map(
    (_, i) =>
      `<Relationship Id="rId${i + 1}" Type="${REL_NS}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
  )
  files['[Content_Types].xml'] = strToU8(
    `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      `<Override PartName="/xl/workbook.xml" ContentType="${CT}.sheet.main+xml"/>` +
      all
        .map(
          (_, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${CT}.worksheet+xml"/>`,
        )
        .join('') +
      `<Override PartName="/xl/styles.xml" ContentType="${CT}.styles+xml"/>` +
      '</Types>',
  )
  files['_rels/.rels'] = strToU8(
    `${XML_HEAD}<Relationships xmlns="${PKG_REL_NS}">` +
      `<Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/>` +
      '</Relationships>',
  )
  files['xl/workbook.xml'] = strToU8(
    `${XML_HEAD}<workbook xmlns="${NS}" xmlns:r="${REL_NS}">` +
      '<bookViews><workbookView/></bookViews><sheets>' +
      names
        .map((n, i) => `<sheet name="${xmlText(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join('') +
      '</sheets></workbook>',
  )
  files['xl/_rels/workbook.xml.rels'] = strToU8(
    `${XML_HEAD}<Relationships xmlns="${PKG_REL_NS}">${sheetRels.join('')}` +
      `<Relationship Id="rId${all.length + 1}" Type="${REL_NS}/styles" Target="styles.xml"/>` +
      '</Relationships>',
  )
  files['xl/styles.xml'] = strToU8(styles.xml())
  return zipSync(files, { level: 6 })
}
