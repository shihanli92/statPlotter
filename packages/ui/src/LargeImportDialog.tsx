import {
  type ColumnType,
  type CsvDelimiter,
  columnsToTable,
  csvSettings,
  type DecimalSeparator,
  distinctTexts,
  ImportError,
  isTextColumn,
  isTextData,
  MAX_IMPORT_LEVELS,
  manyLevelsReason,
  readCsv,
  type Sheet,
} from '@ps/io'
import type { DataTable, NodeId } from '@ps/model'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Dialog } from './components/Dialog.tsx'
import { Field } from './components/fields.tsx'
import { useServices } from './context.tsx'
import {
  CellRulesFields,
  type CellRulesState,
  cellRulesOf,
  initialCellRules,
} from './import/CellRulesFields.tsx'
import { currentPreferences } from './styles/styleStore.ts'
import { CellsTablePrompt } from './table/CellsTablePrompt.tsx'
import {
  CELLS_PROMPT_ROWS,
  type CellsChoice,
  needsCellsPrompt,
  withCellsChoice,
} from './table/cellsTable.ts'
import { errorMessage } from './util.ts'
import { type CsvRead, startCsvRead } from './worker/csvRead.ts'

// Importing a large CSV file (roadmap 34e): an export of Seurat, Scanpy or FlowJo with up to
// millions of rows becomes a multiple-variables table. The dialog previews the start of the file
// (the delimiter, the decimal separator, each column's type as it reads there); the file is then
// read in a worker straight into columns, with progress and Cancel, and the table made from them.

// Text files from `LARGE_CSV_BYTES` (import/largeFiles.ts) on are imported this way.

const PREVIEW_BYTES = 256 * 1024
const PREVIEW_ROWS = 6
const PREVIEW_COLS = 8

const baseName = (name: string) => {
  const file = name.split(/[\\/]/).pop() ?? name
  const dot = file.lastIndexOf('.')
  return dot > 0 ? file.slice(0, dot) : file
}

const MB = (b: number) => `${(b / 2 ** 20).toFixed(b < 10 * 2 ** 20 ? 1 : 0)} MB`

interface Preview {
  /** The first lines (a whole number of them). */
  text: string
  delimiter: CsvDelimiter
  decimal: DecimalSeparator
}

export function LargeImportDialog({
  fileName,
  blob,
  onClose,
  onCreated,
  onWarnings,
}: {
  fileName: string
  blob: Blob
  onClose: () => void
  onCreated: (id: NodeId) => void
  onWarnings: (message: string) => void
}) {
  const { store } = useServices()
  const [preview, setPreview] = useState<Preview | null>(null)
  const [name, setName] = useState(baseName(fileName))
  const decimalId = useId()
  const [header, setHeader] = useState(true)
  const [rowTitles, setRowTitles] = useState(false)
  // Decision 456: the table read, of more than 5,000 rows, waiting for the answer to whether it
  // is a cells table (asked once its rows are known; no checkbox: an estimate can't decide).
  const [asking, setAsking] = useState<{ table: DataTable; warnings: string[] } | null>(null)
  // Columns ticked by hand (the others: imported unless text of many levels, decision 416).
  const [picked, setPicked] = useState<Map<number, boolean>>(() => new Map())
  const [types, setTypes] = useState<ColumnType[]>([])
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ fraction: number; records: number } | null>(null)
  const [building, setBuilding] = useState(false)
  const read = useRef<CsvRead | null>(null)
  // The build's timer: cleared if the dialog closes first (audit 2, U13).
  const buildTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (buildTimer.current !== null) clearTimeout(buildTimer.current)
    },
    [],
  )

  // The start of the file: what it is delimited by, its decimal separator, its columns.
  useEffect(() => {
    let live = true
    blob
      .slice(0, PREVIEW_BYTES)
      .text()
      .then((t) => {
        if (!live) return
        const body = t.charCodeAt(0) === 0xfeff ? t.slice(1) : t
        // Whole lines only (the last one may be cut).
        const end = Math.max(body.lastIndexOf('\n'), 0)
        const text = blob.size > PREVIEW_BYTES && end > 0 ? body.slice(0, end) : body
        setPreview({ text, ...csvSettings(text) })
      })
      .catch((e) => setError(errorMessage(e)))
    return () => {
      live = false
      read.current?.cancel()
    }
  }, [blob])

  const sheet: Sheet | null = useMemo(
    () =>
      preview
        ? readCsv(preview.text, { delimiter: preview.delimiter, decimal: preview.decimal })
        : null,
    [preview],
  )
  const width = sheet?.rows[0]?.length ?? 0
  // Roadmap 39 (audit 2, U14): the user's missing codes and values at detection limits, as in the
  // import dialog (the Preferences' codes; limits read when the start of the file has any).
  const [editedRules, setRules] = useState<CellRulesState | null>(null)
  const firstRules = useMemo(
    () => (sheet ? initialCellRules(currentPreferences().missingCodes, [sheet]) : null),
    [sheet],
  )
  const rules = editedRules ?? firstRules
  useEffect(() => {
    setPicked(new Map())
    setTypes(Array.from({ length: width }, () => 'auto'))
  }, [width])
  const columns = useMemo(() => {
    if (!sheet) return []
    const rows = header ? sheet.rows.slice(1) : sheet.rows
    return Array.from({ length: width }, (_, c) => {
      const cells = rows.map((r) => r[c] ?? null)
      const text = isTextColumn(cells)
      return {
        title: header ? String(sheet.rows[0]?.[c] ?? '') || `Column ${c + 1}` : `Column ${c + 1}`,
        text,
        // Distinct values in the preview's rows (a text column's).
        levels: text ? distinctTexts(cells) : 0,
      }
    })
  }, [sheet, header, width])
  const previewRows = sheet ? sheet.rows.length - (header ? 1 : 0) : 0
  /** A text column of many distinct values in the preview: left out unless ticked. */
  const many = (c: number) =>
    columns[c]?.text === true && types[c] !== 'number' && columns[c]!.levels > MAX_IMPORT_LEVELS
  const include = columns.map((_, c) => picked.get(c) ?? !many(c))

  const busy = progress !== null || building
  const start = () => {
    if (!preview) return
    setError(null)
    setProgress({ fraction: 0, records: 0 })
    const skip = include.flatMap((on, c) => (on || (rowTitles && c === 0) ? [] : [c]))
    const cellRules = rules ? cellRulesOf(rules) : undefined
    const r = startCsvRead(
      blob,
      {
        delimiter: preview.delimiter,
        decimal: preview.decimal,
        skip,
        ...(cellRules ? { rules: cellRules } : {}),
      },
      (fraction, records) => setProgress({ fraction, records }),
    )
    read.current = r
    r.promise
      .then((data) => {
        read.current = null
        setProgress(null)
        setBuilding(true)
        // Let "Building the table…" show before the (synchronous) build.
        buildTimer.current = setTimeout(() => {
          buildTimer.current = null
          try {
            // Text columns found to have many distinct values only past the preview are left
            // out too, unless ticked by hand (decision 416).
            const late: string[] = []
            const kept = include.map((on, c) => {
              const col = data.columns[c]
              if (!on || picked.has(c) || !col || types[c] === 'number') return on
              const words = col.dict.length - col.missing.length
              if (words <= MAX_IMPORT_LEVELS || !isTextData(col, data.first[c] ?? null, header))
                return on
              late.push(`“${columns[c]?.title}” (${words.toLocaleString('en-US')} distinct values)`)
              return false
            })
            const built = columnsToTable(data, {
              name: name.trim() || baseName(fileName),
              headerRow: header,
              firstColumn: rowTitles ? 'rowTitles' : 'data',
              include: kept,
              types,
              ...(cellRules ? { rules: cellRules } : {}),
            })
            const { warnings, table } = built
            if (late.length)
              warnings.push(
                `Left out as text of many distinct values: ${late.join(', ')}; tick to import ${late.length === 1 ? 'it' : 'them'}.`,
              )
            if (needsCellsPrompt(table)) {
              setBuilding(false)
              setAsking({ table, warnings })
            } else add(table, warnings)
          } catch (e) {
            setBuilding(false)
            setError(errorMessage(e))
          }
        }, 30)
      })
      .catch((e) => {
        read.current = null
        setProgress(null)
        if (!(e instanceof ImportError && e.message === 'Cancelled.')) setError(errorMessage(e))
      })
  }
  /** Adds the table and closes. */
  const add = (table: DataTable, warnings: string[]) => {
    store.dispatch({ type: 'node.add', node: table }, `Import ${fileName}`)
    onCreated(table.id)
    if (warnings.length) onWarnings(warnings.join(' '))
    onClose()
  }
  /** The popup's answer: the table as a cells table or not, or nothing (Cancel: read again). */
  const answer = (choice: CellsChoice) => {
    const waiting = asking
    setAsking(null)
    const table = waiting && withCellsChoice(waiting.table, choice)
    if (waiting && table) add(table, waiting.warnings)
  }
  const cancel = () => {
    read.current?.cancel()
    read.current = null
    setProgress(null)
  }

  const pct = progress ? Math.round(progress.fraction * 100) : 0
  const shownRows = sheet ? sheet.rows.slice(0, PREVIEW_ROWS + (header ? 1 : 0)) : []
  return (
    <Dialog
      title={`Import “${fileName}”`}
      wide
      onClose={() => {
        cancel()
        onClose()
      }}
      footer={
        <>
          {progress ? (
            <button type="button" onClick={cancel}>
              Cancel import
            </button>
          ) : (
            <button type="button" onClick={onClose} disabled={building}>
              Cancel
            </button>
          )}
          <button type="button" className="primary" onClick={start} disabled={!preview || busy}>
            Import
          </button>
        </>
      }
    >
      <p className="hint">
        A large file ({MB(blob.size)}): it becomes a multiple-variables table, a variable per
        column, read in the background.
      </p>
      <Field label="Table name">
        {(id) => (
          <input id={id} value={name} disabled={busy} onChange={(e) => setName(e.target.value)} />
        )}
      </Field>
      {preview && (
        // Two label/select pairs in one row: the second labelled by its own id.
        <Field label="Delimiter">
          {(id) => (
            <>
              <select
                id={id}
                value={preview.delimiter}
                disabled={busy}
                onChange={(e) =>
                  setPreview({ ...preview, delimiter: e.target.value as CsvDelimiter })
                }
              >
                <option value=",">Comma</option>
                <option value=";">Semicolon</option>
                <option value={'\t'}>Tab</option>
                <option value="none">None (one column)</option>
              </select>
              <label htmlFor={decimalId}>Decimal separator</label>
              <select
                id={decimalId}
                value={preview.decimal}
                disabled={busy}
                onChange={(e) =>
                  setPreview({ ...preview, decimal: e.target.value as DecimalSeparator })
                }
              >
                <option value=".">Point (1.5)</option>
                <option value=",">Comma (1,5)</option>
              </select>
            </>
          )}
        </Field>
      )}
      <div className="field">
        <label>
          <input
            type="checkbox"
            checked={header}
            disabled={busy}
            onChange={(e) => setHeader(e.target.checked)}
          />{' '}
          First row holds the variables’ names
        </label>
        <label>
          <input
            type="checkbox"
            checked={rowTitles}
            disabled={busy}
            onChange={(e) => setRowTitles(e.target.checked)}
          />{' '}
          First column as row titles (e.g. cell barcodes)
        </label>
      </div>
      {sheet && rules && (
        <fieldset disabled={busy} className="large-import-rules">
          <CellRulesFields value={rules} onChange={setRules} sheet={sheet} header={header} />
        </fieldset>
      )}
      <p className="hint">
        A table of more than {CELLS_PROMPT_ROWS.toLocaleString('en-US')} rows asks, once read,
        whether it is a cells table (single-cell / cytometry).
      </p>
      {sheet && (
        <div className="import-preview">
          <table aria-label="Preview">
            <tbody>
              {shownRows.map((r, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: positional preview rows
                <tr key={i}>
                  {r.slice(0, PREVIEW_COLS).map((v, j) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: positional preview cells
                    <td key={j}>{v === null ? '' : String(v)}</td>
                  ))}
                  {r.length > PREVIEW_COLS && <td>…</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {columns.length > 0 && (
        <fieldset className="large-import-columns" disabled={busy}>
          <legend>
            Columns ({include.filter(Boolean).length} of {columns.length} imported)
          </legend>
          <div className="large-import-list">
            {columns.map((c, i) =>
              rowTitles && i === 0 ? null : (
                // biome-ignore lint/suspicious/noArrayIndexKey: columns by place
                <div key={i} className="large-import-column">
                  <label>
                    <input
                      type="checkbox"
                      checked={include[i] ?? true}
                      onChange={(e) => setPicked((m) => new Map(m).set(i, e.target.checked))}
                    />{' '}
                    {c.title}
                  </label>
                  {many(i) && (
                    <span className="muted">
                      {manyLevelsReason(
                        c.levels,
                        previewRows < blob.size / 64 ? previewRows : undefined,
                      )}
                    </span>
                  )}
                  <select
                    aria-label={`Type of ${c.title}`}
                    value={types[i] ?? 'auto'}
                    onChange={(e) =>
                      setTypes(types.map((t, k) => (k === i ? (e.target.value as ColumnType) : t)))
                    }
                  >
                    <option value="auto">{c.text ? 'Text (detected)' : 'Number (detected)'}</option>
                    <option value="number">Number</option>
                    <option value="text">Text (categories)</option>
                  </select>
                </div>
              ),
            )}
          </div>
        </fieldset>
      )}
      {progress && (
        <div className="export-progress" role="status">
          <progress value={progress.fraction} max={1} aria-label="Import progress" />
          <span>
            Reading… {pct}% ·{' '}
            {Math.max(0, progress.records - (header ? 1 : 0)).toLocaleString('en-US')} rows
          </span>
        </div>
      )}
      {building && (
        <p role="status" className="hint">
          Building the table…
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {asking && <CellsTablePrompt table={asking.table} onChoose={answer} />}
    </Dialog>
  )
}
