import type { DataTable } from '@ps/model'
import { MAX_ENTRY_BYTES, unzipLimited, ZipTooLargeError } from '../zip.ts'
import { type ImportBudget, importBudget } from './budget.ts'
import { type CsvOptions, readCsv } from './csv.ts'
import { ImportError } from './errors.ts'
import { readPzfx } from './pzfx.ts'
import type { PzfxGraphImport } from './pzfxGraphMap.ts'
import type { Sheet } from './sheet.ts'
import { readXlsx } from './xlsx.ts'

// Re-exported: the importers named sheet columns before the model did.
export { columnLetters } from '@ps/model'
export { type Area, describeAccount, type ImportAccount } from './account.ts'
export {
  type BlockGuess,
  findBlocks,
  guessBlock,
  headerSpacing,
  type SheetBlock,
} from './blocks.ts'
export { type ImportBudget, importBudget, MAX_IMPORT_CELLS, MAX_PADDING } from './budget.ts'
export * from './cellRules.ts'
export { type CsvDelimiter, type CsvOptions, readCsv, sniffDelimiter } from './csv.ts'
export * from './csvColumns.ts'
export { ImportError } from './errors.ts'
export { type BlockLayout, parseBlock } from './layout.ts'
export {
  detectLong,
  type LongColumn,
  type LongImportOptions,
  type LongInfo,
  longToTable,
} from './long.ts'
export * from './pcff.ts'
export { type PzfxImport, type PzfxOptions, readPzfx } from './pzfx.ts'
export * from './pzfxGraphMap.ts'
export * from './pzfxGraphs.ts'
export {
  type ImportTableKind,
  type Sheet,
  type SheetCell,
  type SheetImportOptions,
  type SheetImportResult,
  sheetToTable,
} from './sheet.ts'
export { findStackedGroups, type StackedGroup, type StackedPart } from './stacked.ts'
export {
  distinctTexts,
  isTextColumn,
  MAX_IMPORT_LEVELS,
  manyLevelColumns,
  manyLevelsReason,
  variablesToTable,
} from './variables.ts'
export { readXlsx } from './xlsx.ts'

export type ImportedFile =
  | { kind: 'sheets'; sheets: Sheet[] }
  | {
      kind: 'tables'
      tables: DataTable[]
      warnings: string[]
      /** .pzfx: the file's graphs (roadmap 39), read with `ImportFileOptions.graphs`. */
      graphs?: PzfxGraphImport
    }

/** File extensions `importFile` accepts (for file pickers). */
export const IMPORT_EXTENSIONS = [
  'csv',
  'tsv',
  'tab',
  'txt',
  'xlsx',
  'xlsm',
  'pzfx',
  'zip',
] as const

/** Delimited-text extensions: these take `TextImportOptions` (delimiter, decimal separator). */
export const TEXT_EXTENSIONS = ['csv', 'tsv', 'tab', 'txt'] as const

export type TextImportOptions = Pick<CsvOptions, 'delimiter' | 'decimal'> & {
  /** .pzfx: read the file's graphs too (roadmap 39). */
  graphs?: boolean
}

const extensionOf = (name: string) => /\.([^.\\/]+)$/.exec(name)?.[1]?.toLowerCase() ?? ''

/** Whether `importFile` reads this file as delimited text (so `TextImportOptions` apply). */
export const isTextImport = (name: string): boolean =>
  (TEXT_EXTENSIONS as readonly string[]).includes(extensionOf(name))

/**
 * Decodes text by its byte-order mark (UTF-8, UTF-16 LE/BE); without one, as UTF-8, falling back
 * to Windows-1252 (older Excel CSV exports) when the bytes aren't valid UTF-8.
 */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3))
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

const baseName = (name: string) => {
  const file = name.split(/[\\/]/).pop() ?? name
  const dot = file.lastIndexOf('.')
  return dot > 0 ? file.slice(0, dot) : file
}

/**
 * Reads a file by extension: delimited text and Excel workbooks give sheets (the caller picks a
 * block and table kind, then calls `sheetToTable`); .pzfx projects give finished tables.
 * `text` overrides the sniffed delimiter and decimal separator of delimited text. A file whose
 * sheets have no values (an empty CSV, a workbook of blank sheets) is an ImportError.
 */
export function importFile(
  name: string,
  bytes: Uint8Array,
  text: TextImportOptions = {},
): ImportedFile {
  const file = readFile(name, bytes, text, importBudget())
  const filled = (s: Sheet) => s.rows.some((r) => r.some((v) => v !== null && v !== ''))
  if (file.kind === 'sheets' && !file.sheets.some(filled))
    throw new ImportError('The file has no data.')
  return file
}

/**
 * `importFile` without the check for data (a .zip's members may be empty). A .zip's members
 * share its `budget` of cells and inflated bytes (audit 2 X6).
 */
function readFile(
  name: string,
  bytes: Uint8Array,
  text: TextImportOptions,
  budget: ImportBudget,
  inArchive = false,
): ImportedFile {
  const ext = extensionOf(name)
  switch (ext) {
    case 'csv':
    case 'txt':
    case 'tsv':
    case 'tab': {
      const tabs = ext === 'tsv' || ext === 'tab'
      const delimiter = text.delimiter && text.delimiter !== 'auto' ? text.delimiter : undefined
      const sheet = readCsv(
        decodeText(bytes),
        {
          delimiter: delimiter ?? (tabs ? '\t' : 'auto'),
          decimal: text.decimal,
          name: baseName(name),
        },
        // A file on its own isn't capped (a large one is read in columns, roadmap 34e).
        inArchive ? budget : undefined,
      )
      return { kind: 'sheets', sheets: [sheet] }
    }
    case 'xlsx':
    case 'xlsm':
      return { kind: 'sheets', sheets: readXlsx(bytes, budget) }
    case 'pzfx':
      return { kind: 'tables', ...readPzfx(decodeText(bytes), { graphs: text.graphs }) }
    case 'zip': {
      // Journal supplements often zip their source data: every spreadsheet inside, as sheets.
      const keep = (f: string) =>
        !f.startsWith('__MACOSX/') &&
        !f.split('/').pop()!.startsWith('.') &&
        /\.(csv|tsv|tab|txt|xlsx|xlsm)$/i.test(f)
      let files: Record<string, Uint8Array>
      try {
        files = unzipLimited(bytes, keep, { entry: MAX_ENTRY_BYTES, total: budget.bytes }, (n) => {
          budget.bytes -= n
        })
      } catch (e) {
        if (e instanceof ZipTooLargeError)
          throw new ImportError(`The archive is too large: ${e.message}`)
        throw new ImportError('The .zip archive could not be read.')
      }
      const sheets: Sheet[] = []
      for (const [f, data] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
        const inner = readFile(f, data, text, budget, true)
        if (inner.kind !== 'sheets') continue
        const multi = inner.sheets.length > 1
        for (const s of inner.sheets)
          sheets.push({ ...s, name: multi ? `${baseName(f)} – ${s.name}` : baseName(f) })
      }
      if (!sheets.length) throw new ImportError('The archive holds no CSV or Excel files.')
      return { kind: 'sheets', sheets }
    }
    case 'xls':
      throw new ImportError(
        'Legacy Excel (.xls) files are not supported. Save the workbook as .xlsx and try again.',
      )
    // Binary projects (the extension is the file format's, kept as data): only the XML format
    // (.pzfx) is read.
    case 'prism':
    case 'pzf':
      throw new ImportError(
        `.${ext} files are not supported. Save the project in the XML format (.pzfx), then import ` +
          'that file.',
      )
    default:
      throw new ImportError(
        `${ext ? `Can't import .${ext} files.` : "Can't import a file without an extension."} ` +
          'Supported: CSV, TSV, TXT, XLSX, PZFX, and ZIP archives of these.',
      )
  }
}
