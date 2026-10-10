import {
  delimitedFile,
  type ExportSheet,
  type NumberMode,
  type ResultsExportOptions,
  resultSheetFileRows,
  tableRows,
  writeXlsx,
} from '@ps/io'
import type { AnalysisResult, DataTable, ResultSheet } from '@ps/model'
import { useState } from 'react'
import { type Command, GROUPS, TOOLBAR_GROUPS } from '../commands/index.ts'
import { Dialog } from '../components/Dialog.tsx'
import { RadioGroup } from '../components/fields.tsx'
import { useDoc, useServices } from '../context.tsx'
import { fileBaseOf } from '../graph/viewCommands.ts'
import type { Platform } from '../services.ts'
import { errorMessage } from '../util.ts'

// Data and results out (roadmap 26): File › Export ▸ for data tables and results, and the
// toolbar's Export… dialog with the format and its options.

export type DataFormat = 'csv' | 'tsv' | 'xlsx'

const FILE_TYPES: Record<DataFormat, { label: string; mime: string }> = {
  csv: { label: 'CSV (comma-separated)', mime: 'text/csv' },
  tsv: { label: 'TSV (tab-separated)', mime: 'text/tab-separated-values' },
  xlsx: {
    label: 'Excel workbook (.xlsx)',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
}

/** Offers sheets as a file: a workbook of all of them, or the first as CSV / TSV. */
export function exportSheets(
  platform: Platform,
  sheets: readonly ExportSheet[],
  fileBase: string,
  format: DataFormat,
): Promise<void> {
  const { mime } = FILE_TYPES[format]
  const data =
    format === 'xlsx'
      ? writeXlsx(sheets)
      : delimitedFile(sheets[0]?.rows ?? [], format === 'csv' ? ',' : '\t')
  return platform.exportFile(data, `${fileBase}.${format}`, mime)
}

/** Offers a workbook (Source data, All data and results), reporting failures. */
export function useWorkbookExport(onError: (msg: string) => void) {
  const { platform } = useServices()
  return (sheets: () => ExportSheet[], fileBase: string) => {
    let made: ExportSheet[]
    try {
      made = sheets()
    } catch (e) {
      return onError(`Export failed: ${errorMessage(e)}`)
    }
    exportSheets(platform, made, fileBaseOf(fileBase, 'data'), 'xlsx').catch((e: unknown) =>
      onError(`Export failed: ${errorMessage(e)}`),
    )
  }
}

interface DataExportOptions {
  format: DataFormat
  /** Tables: excluded values kept (marked in Excel) or left blank. */
  excluded: 'mark' | 'blank'
  /** Results: numbers as displayed or in full. */
  mode: NumberMode
  /** Results: every sheet of the analysis (a workbook) rather than the one shown. */
  all: boolean
}

const DEFAULTS: DataExportOptions = {
  format: 'xlsx',
  excluded: 'mark',
  mode: 'displayed',
  all: false,
}

const exportMenu = (order: number) => ({
  menu: 'file' as const,
  group: GROUPS.file.export,
  order,
  submenu: 'Export',
})

/**
 * File › Export ▸ Source data (Excel)… of a graph or a layout page: the tables and results it
 * shows (see `workbooks.ts`).
 */
export const sourceDataCommand = (what: 'graph' | 'page', run: () => void): Command => ({
  id: 'file.export.sourceData',
  label: 'Source data (Excel)…',
  menu: exportMenu(50),
  keywords: ['export excel', 'xlsx', 'source data', 'figure data'],
  hint:
    what === 'graph'
      ? 'Export the data this graph plots and the results it shows (fits, brackets) as an Excel workbook'
      : 'Export the data and results of every graph on this page as an Excel workbook, a sheet per panel',
  run,
})

/**
 * The toolbar's Export… (not in the menus, which have the formats), as the graph views have; its
 * ▾ offers the formats of File › Export ▸ (`items`, command ids).
 */
const exportButton = (hint: string, run: () => void, items: readonly string[]): Command => ({
  id: 'file.export',
  label: 'Export…',
  icon: 'download',
  toolbar: { group: TOOLBAR_GROUPS.view, order: 90, split: { label: 'Export as', items } },
  keywords: ['export', 'csv', 'excel', 'xlsx'],
  hint,
  run,
})

/** The dialog's state and how it is shown; `run` exports with the options chosen. */
function useExportDialog(
  kind: 'table' | 'results',
  what: string,
  run: (o: DataExportOptions) => Promise<void>,
  onError: (msg: string) => void,
  sheetTitle?: string,
) {
  const [shown, setShown] = useState(false)
  const exportWith = (o: Partial<DataExportOptions>) => {
    const options = { ...DEFAULTS, ...o }
    run(options).catch((e: unknown) =>
      onError(`${options.format.toUpperCase()} export failed: ${errorMessage(e)}`),
    )
  }
  const dialog = shown && (
    <DataExportDialog
      kind={kind}
      what={what}
      sheetTitle={sheetTitle}
      onExport={exportWith}
      onClose={() => setShown(false)}
    />
  )
  return { exportWith, open: () => setShown(true), dialog }
}

/** A data table's export (also a result table's): commands and the Export… dialog. */
export function useTableExport(table: DataTable, onError: (msg: string) => void) {
  const { platform } = useServices()
  const { exportWith, open, dialog } = useExportDialog(
    'table',
    table.name,
    (o) =>
      exportSheets(
        platform,
        [{ name: table.name, rows: tableRows(table, { excluded: o.excluded }) }],
        fileBaseOf(table.name, 'table'),
        o.format,
      ),
    onError,
  )
  const format = (id: DataFormat, order: number, label: string): Command => ({
    id: `file.export.${id}`,
    label,
    menu: exportMenu(order),
    keywords: [`export ${id}`, 'data table'],
    hint: `Export the data table as ${FILE_TYPES[id].label}, titles and all`,
    run: () => exportWith({ format: id }),
  })
  const commands: Command[] = [
    format('csv', 10, 'CSV…'),
    format('tsv', 20, 'TSV…'),
    format('xlsx', 30, 'Excel (.xlsx)…'),
    exportButton('Export the data table as CSV, TSV or Excel, with options', open, [
      'file.export.csv',
      'file.export.tsv',
      'file.export.xlsx',
    ]),
  ]
  return { commands, dialog }
}

/**
 * A results sheet's export: the sheet shown (CSV, TSV or Excel) or all the analysis' sheets as a
 * workbook, numbers as displayed or in full.
 */
export function useResultsExport(
  name: string,
  result: AnalysisResult | undefined,
  sheet: ResultSheet | undefined,
  onError: (msg: string) => void,
) {
  const { platform } = useServices()
  const settings = useDoc((d) => d.settings)
  const run = async (o: DataExportOptions) => {
    if (!result) throw new Error('the results are not calculated yet')
    const opts: ResultsExportOptions = { settings, mode: o.mode }
    const sheetsOf = (ss: readonly ResultSheet[]): ExportSheet[] =>
      ss.map((s) => ({
        name: s.title,
        rows: resultSheetFileRows(`${name} – ${s.title}`, result, s, opts),
      }))
    const table = result.table && { name: 'Data table', rows: tableRows(result.table) }
    if (o.all)
      return exportSheets(
        platform,
        [...(table ? [table] : []), ...sheetsOf(result.sheets)],
        fileBaseOf(name, 'results'),
        'xlsx',
      )
    if (!sheet) throw new Error('no results sheet is shown')
    return exportSheets(
      platform,
      sheetsOf([sheet]),
      fileBaseOf(`${name} – ${sheet.title}`, 'results'),
      o.format,
    )
  }
  const { exportWith, open, dialog } = useExportDialog('results', name, run, onError, sheet?.title)
  const commands: Command[] = [
    {
      id: 'file.export.xlsxAll',
      label: 'All results (Excel)…',
      menu: exportMenu(40),
      enabled: !!result,
      keywords: ['export excel', 'xlsx', 'results'],
      hint: 'Export every sheet of these results as one Excel workbook',
      run: () => exportWith({ all: true }),
    },
  ]
  if (sheet)
    commands.push(
      {
        id: 'file.export.csv',
        label: 'CSV…',
        menu: exportMenu(10),
        keywords: ['export csv', 'results'],
        hint: 'Export the results sheet shown as CSV, as displayed',
        run: () => exportWith({ format: 'csv' }),
      },
      {
        id: 'file.export.xlsx',
        label: 'Excel (.xlsx)…',
        menu: exportMenu(30),
        keywords: ['export excel', 'xlsx', 'results'],
        hint: 'Export the results sheet shown as an Excel workbook, as displayed',
        run: () => exportWith({ format: 'xlsx' }),
      },
      exportButton('Export these results as CSV, TSV or Excel, with options', open, [
        'file.export.csv',
        'file.export.xlsx',
        '-',
        'file.export.xlsxAll',
      ]),
    )
  return { commands, dialog }
}

/** Export… for a data table (format, excluded values) or results (sheets, format, numbers). */
function DataExportDialog({
  kind,
  what,
  sheetTitle,
  onExport,
  onClose,
}: {
  kind: 'table' | 'results'
  /** What is exported ("Data 1", an analysis' name). */
  what: string
  /** Results: the sheet shown. */
  sheetTitle?: string
  onExport: (o: DataExportOptions) => void
  onClose: () => void
}) {
  const [o, setO] = useState(DEFAULTS)
  const set =
    <K extends keyof DataExportOptions>(k: K) =>
    (v: DataExportOptions[K]) =>
      setO({ ...o, [k]: v })
  const workbook = kind === 'results' && o.all
  const formats = (Object.keys(FILE_TYPES) as DataFormat[]).map((f) => ({
    value: f,
    label: FILE_TYPES[f].label,
  }))
  return (
    <Dialog
      title={`Export “${what}”`}
      onClose={onClose}
      okLabel="Export…"
      onOk={() => {
        onClose()
        onExport(workbook ? { ...o, format: 'xlsx' } : o)
      }}
    >
      {kind === 'results' && (
        <RadioGroup
          legend="Sheets"
          name="export-sheets"
          value={o.all ? 'all' : 'one'}
          options={[
            ...(sheetTitle
              ? [{ value: 'one' as const, label: `This sheet (“${sheetTitle}”)` }]
              : []),
            { value: 'all' as const, label: 'All sheets (one Excel workbook)' },
          ]}
          onChange={(v) => set('all')(v === 'all')}
        />
      )}
      {!workbook && (
        <RadioGroup
          legend="Format"
          name="export-format"
          value={o.format}
          options={formats}
          onChange={set('format')}
        />
      )}
      {kind === 'table' ? (
        <RadioGroup
          legend="Excluded values"
          name="export-excluded"
          value={o.excluded}
          options={[
            { value: 'mark', label: 'Keep them (grey italic in Excel)' },
            { value: 'blank', label: 'Leave them blank' },
          ]}
          onChange={set('excluded')}
        />
      ) : (
        <RadioGroup
          legend="Numbers"
          name="export-numbers"
          value={o.mode}
          options={[
            { value: 'displayed', label: 'As displayed (rounded; P values as shown)' },
            { value: 'full', label: 'Full precision (an interval as two numbers)' },
          ]}
          onChange={set('mode')}
        />
      )}
    </Dialog>
  )
}
