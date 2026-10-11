/**
 * Reads the data tables of an XML project (.pzfx). Analyses, graphs and layouts
 * (stored in the file as an opaque binary section) and info sheets are not imported.
 */
import {
  type CellColumn,
  type DataSetColumn,
  DataTable,
  isYFormatAllowed,
  MAX_REPLICATES,
  newColumnId,
  newNodeId,
  type RichText,
  richPlain,
  richTitleOf,
  type SummaryPreset,
  subcolumnRoles,
  type TableKind,
  type XColumn,
  type XFormat,
  type YFormat,
} from '@ps/model'
import { ImportError } from './errors.ts'
import { inflateTemplate, PcffError } from './pcff.ts'
import {
  defaultGraphsFor,
  graphsFromPzfx,
  type PzfxGraphImport,
  pairTables,
} from './pzfxGraphMap.ts'
import { decodePzfxGraphs } from './pzfxGraphs.ts'
import { richTextOf } from './pzfxText.ts'
import { isTextColumn } from './variables.ts'
import {
  child,
  descendants,
  elements,
  localName,
  parseXml,
  textContent,
  type XmlElement,
} from './xml.ts'

export interface PzfxImport {
  tables: DataTable[]
  warnings: string[]
  /**
   * Roadmap 39: the file's graphs, read from its binary section, when asked for
   * (`PzfxOptions.graphs`).
   */
  graphs?: PzfxGraphImport
}

export interface PzfxOptions {
  /** Read the file's graphs too (roadmap 39). */
  graphs?: boolean
}

const TABLE_TYPES: Record<string, TableKind> = {
  XY: 'xy',
  OneWay: 'column',
  TwoWay: 'grouped',
  Contingency: 'contingency',
  Survival: 'survival',
  // A data set per group, a subcolumn per subject, replicate measurements down the rows.
  Nested: 'nested',
  // A column per variable; a column of words is a text (categorical) variable.
  MultipleVariables: 'multipleVariables',
}

const SKIPPED_TYPES: Record<string, string> = {
  PartsOfWhole: 'parts of whole',
}

/**
 * Subcolumn titles of a Y column (nested tables name their subjects), from a
 * `SubColumnTitles` / `SubcolumnTitles` child: its `d` cells in order. Null when there are none.
 */
function subcolumnTitlesOf(
  yEl: XmlElement,
  count: number,
): { titles: (string | null)[]; rich: (RichText | null)[] | null } | null {
  const holder = elements(yEl).find((e) => localName(e.name).toLowerCase() === 'subcolumntitles')
  if (!holder) return null
  const cells = descendants(holder, () => true).filter((e) => localName(e.name) === 'd')
  const fields = Array.from({ length: count }, (_, k) => titleFields(cells[k]))
  const titles = fields.map((f) => (f.title === '' ? null : f.title))
  const rich = fields.map((f) => f.titleRich ?? null)
  return titles.some((t) => t !== null)
    ? { titles, rich: rich.some((r) => r !== null) ? rich : null }
    : null
}

/** .pzfx Y formats (the YFormat attribute) → summary presets. CV is a percent in the file. */
const SUMMARY_FORMATS: Record<string, SummaryPreset> = {
  SDN: 'meanSdN',
  SEN: 'meanSemN',
  CVN: 'meanCvN',
  SD: 'meanSd',
  SE: 'meanSem',
  CV: 'meanCvN', // no Mean/CV preset: N stays empty
  'low-high': 'meanPlusMinus', // mean, +error, −error
  'upper-lower-limits': 'meanUpperLower', // mean, upper limit, lower limit
}

interface RawCell {
  text: string | null
  excluded: boolean
  el: XmlElement
}

/** Own-property lookup (attribute values like "constructor" must not hit Object.prototype). */
const lookup = <T>(rec: Record<string, T>, key: string): T | undefined =>
  Object.hasOwn(rec, key) ? rec[key] : undefined

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

const isTable = (el: XmlElement) => {
  const name = localName(el.name)
  return name === 'Table' || name === 'HugeTable'
}

/** Tables anywhere in the document, in file order (not looking inside a table). */
const findTables = (root: XmlElement): XmlElement[] =>
  descendants(root, (e) => !isTable(e)).filter(isTable)

/**
 * Single-line text of a title (formatting dropped, whitespace runs collapsed; Symbol-font Greek
 * as Greek letters).
 */
const titleOf = (el: XmlElement | undefined): string =>
  el ? richPlain(richTextOf(el, 'collapse')) : ''

/** The plain title and, when formatted (roadmap 28), its rich form (`titleRich`). */
function titleFields(el: XmlElement | undefined): { title: string; titleRich?: RichText } {
  const runs = el ? richTextOf(el, 'collapse') : []
  const rich = richTitleOf(runs)
  return { title: richPlain(runs), ...(rich ? { titleRich: rich } : {}) }
}

function readSubcolumns(col: XmlElement | undefined): RawCell[][] {
  if (!col) return []
  return elements(col, 'Subcolumn').map((sub) =>
    elements(sub, 'd').map((d) => {
      const text = textContent(d).trim()
      return { text: text === '' ? null : text, excluded: d.attrs.Excluded === '1', el: d }
    }),
  )
}

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/
const COMMA_NUMBER = /^[+-]?(\d+,?\d*|,\d+)([eE][+-]?\d+)?$/

/**
 * .pzfx files hold numbers in the locale of the machine that wrote them: "1.", "3.25", "3,25",
 * "1.5E-3".
 */
export function parsePzfxNumber(raw: string): number | null {
  let s = raw.trim().replace(/−/g, '-')
  if (!NUMBER.test(s)) {
    if (!COMMA_NUMBER.test(s)) return null
    s = s.replace(',', '.')
  }
  const v = Number(s)
  return Number.isFinite(v) ? v : null
}

function noteText(table: XmlElement): string {
  return elements(table, 'FloatingNote')
    .map((n) =>
      textContent(n, ['WebLink'])
        .split('\n')
        .map((l) => l.replace(/\s+/g, ' ').trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim(),
    )
    .filter((s) => s !== '')
    .join('\n\n')
}

/**
 * Parses a .pzfx document. Every supported data table becomes a DataTable; anything that can't be
 * represented faithfully is skipped or adjusted with a message in `warnings`.
 */
export function readPzfx(xml: string, opts: PzfxOptions = {}): PzfxImport {
  const root = parseXml(xml)
  if (localName(root.name) !== 'GraphPadPrismFile') {
    throw new ImportError('Not an XML project (.pzfx) file.')
  }
  const warnings: string[] = []
  const tables: DataTable[] = []
  const tableEls = findTables(root)
  // The imported table of each XML table (null: skipped), for the file's graphs.
  const imported: (number | null)[] = []
  tableEls.forEach((el, i) => {
    const table = readTable(el, i, warnings)
    imported.push(table ? tables.length : null)
    if (table) tables.push(table)
  })

  const infos = elements(root, 'Info').length
  if (infos) warnings.push(`${plural(infos, 'info sheet')} not imported.`)
  const counts: string[] = []
  for (const [seq, label] of [
    ['AnalysisSequence', 'analysis'],
    ['GraphSequence', 'graph'],
    ['LayoutSequence', 'layout'],
  ] as const) {
    const refs = elements(root, seq).reduce((n, s) => n + elements(s, 'Ref').length, 0)
    if (refs) counts.push(plural(refs, label, label === 'analysis' ? 'analyses' : undefined))
  }
  if (counts.length) warnings.push(`Not imported: ${counts.join(', ')}.`)
  else if (child(root, 'Template')) {
    warnings.push('Analyses, graphs and layouts in the file were not imported.')
  }
  if (!opts.graphs) return { tables, warnings }
  const found = elements(root, 'GraphSequence').reduce((n, s) => n + elements(s, 'Ref').length, 0)
  return { tables, warnings, graphs: pzfxGraphsOf(root, tableEls, imported, tables, found) }
}

/** The file's graphs as native graphs, or default graphs per table when they can't be read. */
function pzfxGraphsOf(
  root: XmlElement,
  tableEls: XmlElement[],
  imported: (number | null)[],
  tables: DataTable[],
  found: number,
): PzfxGraphImport {
  const template = child(root, 'Template')
  const block = template ? inflateTemplate(textContent(template)) : null
  if (!block)
    return template
      ? defaultGraphsFor(tables, found, 'the file’s graph section could not be read')
      : { graphs: [], report: [], found, decoded: 0, layouts: 0 }
  try {
    const decoded = decodePzfxGraphs(block)
    const pairs = pairTables(
      decoded.tables,
      tableEls.map((el) => ({
        title: titleOf(child(el, 'Title')),
        yTitles: elements(el, 'YColumn').map((y) => titleOf(child(y, 'Title'))),
      })),
    )
    return graphsFromPzfx(decoded, tables, (b) => {
      const xmlIndex = pairs[b]
      return xmlIndex === null || xmlIndex === undefined ? null : (imported[xmlIndex] ?? null)
    })
  } catch (e) {
    if (!(e instanceof PcffError)) throw e
    return defaultGraphsFor(
      tables,
      found,
      `the file’s graph section could not be read (${e.message})`,
    )
  }
}

function readTable(el: XmlElement, index: number, warnings: string[]): DataTable | null {
  const name = titleOf(child(el, 'Title')) || `Data ${index + 1}`
  const warn = (msg: string) => warnings.push(`"${name}": ${msg}`)
  const type = el.attrs.TableType ?? ''
  let kind = lookup(TABLE_TYPES, type)
  if (!kind) {
    const skipped = lookup(SKIPPED_TYPES, type)
    warn(
      skipped
        ? `${skipped} tables are not supported yet; table skipped.`
        : `unknown table type "${type}"; table skipped.`,
    )
    return null
  }

  const rowTitleCols = readSubcolumns(child(el, 'RowTitlesColumn'))
  const xEl = child(el, 'XColumn')
  const xAdvEl = child(el, 'XAdvancedColumn')
  const xCols = readSubcolumns(xEl)
  const xAdvCols = readSubcolumns(xAdvEl)
  const yEls = elements(el, 'YColumn')
  const yCols = yEls.map(readSubcolumns)
  if (yEls.length === 0) {
    warn('the table has no data columns; table skipped.')
    return null
  }

  let rowCount = 0
  for (const sub of [...rowTitleCols, ...xCols, ...xAdvCols, ...yCols.flat()]) {
    rowCount = Math.max(rowCount, sub.length)
  }

  // Y format.
  const yfAttr = el.attrs.YFormat ?? 'replicates'
  const preset = lookup(SUMMARY_FORMATS, yfAttr)
  let yFormat: YFormat
  if (yfAttr === 'replicates') {
    const declared = Number(el.attrs.Replicates ?? 1) || 1
    const count = Math.max(declared, ...yCols.map((c) => c.length))
    if (count > MAX_REPLICATES) {
      warn(`${count} replicates exceed the maximum of ${MAX_REPLICATES}; table skipped.`)
      return null
    }
    yFormat = { type: 'replicates', count }
  } else if (preset) {
    yFormat = { type: 'summary', preset }
    if (yfAttr === 'CV') warn('Mean/CV data imported as Mean/CV/N with N empty.')
  } else {
    warn(`unsupported Y format "${yfAttr}"; table skipped.`)
    return null
  }

  if (kind === 'column') {
    if (yFormat.type === 'summary' && rowCount === 0) rowCount = 1
    if (yFormat.type === 'summary' ? rowCount > 1 : yFormat.count > 1) {
      if (yFormat.type === 'replicates') {
        warn('column table with side-by-side replicates imported as a grouped table.')
      } else warn('column table with several rows of summary data imported as a grouped table.')
      kind = 'grouped'
    }
  }
  if (!isYFormatAllowed(kind, yFormat)) {
    warn(`Y format "${yfAttr}" is not supported for ${kind} tables; table skipped.`)
    return null
  }

  let nonNumeric = 0
  let firstBad = ''
  const toColumn = (cells: RawCell[] | undefined, scale = 1): CellColumn => {
    const values: (number | null)[] = []
    const excluded: boolean[] = []
    let anyExcluded = false
    for (let r = 0; r < rowCount; r++) {
      const cell = cells?.[r]
      let v: number | null = null
      if (cell?.text != null) {
        v = parsePzfxNumber(cell.text)
        if (v === null) {
          nonNumeric++
          firstBad ||= cell.text.length > 20 ? `${cell.text.slice(0, 20)}…` : cell.text
        } else if (scale !== 1) v *= scale
      }
      values.push(v)
      const ex = v !== null && cell?.excluded === true
      excluded.push(ex)
      anyExcluded ||= ex
    }
    return anyExcluded ? { type: 'number', values, excluded } : { type: 'number', values }
  }

  // Row titles.
  let rowTitles: (string | null)[] | null = null
  let rowTitlesRich: (RichText | null)[] | null = null
  const titleCells = rowTitleCols[0] ?? []
  if (titleCells.some((c) => c.text !== null)) {
    rowTitles = Array.from({ length: rowCount }, (_, r) => titleCells[r]?.text ?? null)
    const rich = rowTitles.map((t, r) => {
      const runs = t === null ? undefined : richTitleOf(richTextOf(titleCells[r]!.el, 'trim'))
      return runs && richPlain(runs) === t ? runs : null
    })
    if (rich.some((r) => r !== null)) rowTitlesRich = rich
  }

  // X column.
  let x: XColumn | null = null
  const hasX = kind === 'xy' || kind === 'survival'
  const xFields = titleFields(xEl && child(xEl, 'Title'))
  const xTitle = xFields.title || (kind === 'survival' ? 'Days elapsed' : 'X')
  if (hasX) {
    const xfAttr = el.attrs.XFormat ?? 'numbers'
    let xFormat: XFormat = 'numbers'
    if (xfAttr === 'error') xFormat = 'numbersWithError'
    else if (xfAttr === 'date') {
      const dates = xAdvCols[0] ?? []
      if (!rowTitles && dates.some((c) => c.text !== null)) {
        rowTitles = Array.from({ length: rowCount }, (_, r) => dates[r]?.text ?? null)
        warn(
          'X dates imported as the numbers the file stores for them (time since the first date, in the ' +
            "table's units); the dates are kept as row titles.",
        )
      } else {
        warn(
          "X dates imported as the numbers the file stores for them (time since the first date, in the table's units).",
        )
      }
    } else if (xfAttr !== 'numbers') {
      warn(`X format "${xfAttr}" imported as plain numbers.`)
    }
    if (!xEl) warn('the table has no X column; X values are empty.')
    x = {
      title: xTitle,
      ...(xFields.title && xFields.titleRich ? { titleRich: xFields.titleRich } : {}),
      xFormat,
      subcolumns: Array.from({ length: xFormat === 'numbersWithError' ? 2 : 1 }, (_, k) =>
        toColumn(xCols[k]),
      ),
    }
  } else if (xCols.some((c) => c.some((d) => d.text !== null))) {
    warn('X values are not used by this table kind and were not imported.')
  }

  // Data sets.
  const roles = subcolumnRoles(yFormat)
  let extra = 0
  const dataSets: DataSetColumn[] = yEls.map((yEl, i) => {
    const subs = yCols[i]!
    if (subs.length > roles.length) extra += subs.length - roles.length
    const subTitles = kind === 'nested' ? subcolumnTitlesOf(yEl, roles.length) : null
    const cells = subs[0] ?? []
    if (kind === 'multipleVariables' && isTextColumn(cells.map((c) => c.text))) {
      return {
        id: newColumnId(),
        ...titleFields(child(yEl, 'Title')),
        subcolumns: [
          { type: 'number' as const, values: Array.from({ length: rowCount }, () => null) },
        ],
        text: Array.from({ length: rowCount }, (_, r) => cells[r]?.text ?? null),
      }
    }
    return {
      id: newColumnId(),
      ...titleFields(child(yEl, 'Title')),
      subcolumns: roles.map((role, k) => toColumn(subs[k], role === 'cv' ? 0.01 : 1)),
      ...(subTitles ? { subcolumnTitles: subTitles.titles } : {}),
      ...(subTitles?.rich ? { subcolumnTitlesRich: subTitles.rich } : {}),
    }
  })
  if (extra) warn(`${plural(extra, 'extra subcolumn')} beyond the Y format ignored.`)
  if (nonNumeric) {
    warn(`${plural(nonNumeric, 'non-numeric cell')} imported as empty (first: "${firstBad}").`)
  }

  const parsed = DataTable.safeParse({
    kind: 'table',
    id: newNodeId(),
    name,
    tableKind: kind,
    yFormat,
    rowCount,
    rowTitles,
    ...(rowTitlesRich ? { rowTitlesRich } : {}),
    x,
    dataSets,
    notes: noteText(el),
  })
  if (!parsed.success) {
    warn(`could not be imported (${parsed.error.issues[0]?.message ?? 'invalid data'}).`)
    return null
  }
  return parsed.data
}
