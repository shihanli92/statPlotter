import { createGraphFor, withLimitPoints } from '@ps/graph'
import {
  type BlockLayout,
  describeAccount,
  detectLong,
  findBlocks,
  finishCellRules,
  guessBlock,
  type LongInfo,
  longToTable,
  manyLevelColumns,
  manyLevelsReason,
  prepareSheet,
  type Sheet,
  type SheetBlock,
  type SheetImportOptions,
  type SheetImportResult,
  sheetToTable,
  type TextImportOptions,
} from '@ps/io'
import type { DataTable, NodeId } from '@ps/model'
import { useMemo, useState } from 'react'
import { Dialog } from './components/Dialog.tsx'
import { Field, RadioGroup } from './components/fields.tsx'
import { useServices } from './context.tsx'
import { CellRulesFields, cellRulesOf, initialCellRules } from './import/CellRulesFields.tsx'
import { currentPreferences } from './styles/styleStore.ts'
import { CellsTablePrompt } from './table/CellsTablePrompt.tsx'
import {
  CELLS_TABLE_HINT,
  type CellsChoice,
  cellsTableByDefault,
  cellsTableSetting,
  needsCellsPrompt,
  withCellsChoice,
} from './table/cellsTable.ts'
import { errorMessage } from './util.ts'

type Kind = SheetImportOptions['tableKind']

const KINDS: { id: Kind; label: string; first: SheetImportOptions['firstColumn'] }[] = [
  { id: 'column', label: 'Column', first: 'data' },
  { id: 'xy', label: 'XY (first column is X)', first: 'x' },
  { id: 'grouped', label: 'Grouped (first column holds row titles)', first: 'rowTitles' },
  { id: 'contingency', label: 'Contingency (counts)', first: 'rowTitles' },
  { id: 'survival', label: 'Survival (first column is time)', first: 'x' },
  {
    id: 'multipleVariables',
    label: 'Multiple variables (a column per variable; text columns stay text)',
    first: 'data',
  },
]

const PREVIEW_ROWS = 14
/** Bulk imports leave out tables larger than this (e.g. sequencing matrices). */
const BULK_MAX_COLUMNS = 100
const BULK_MAX_ROWS = 5000
const PREVIEW_COLS = 10

const cellText = (v: Sheet['rows'][number][number]) =>
  v === null ? '' : typeof v === 'number' ? String(+v.toPrecision(8)) : String(v)

/** What the importer read from a block, in a sentence. */
function describeLayout(l: BlockLayout, sheet: Sheet): string {
  const names = l.sets.map((s) => s.title || '(untitled)')
  const list = names.length > 4 ? `${names.slice(0, 4).join(', ')}, …` : names.join(', ')
  const n = `${names.length} data set${names.length === 1 ? '' : 's'} (${list})`
  const label = l.labelCol
  const labels =
    label === null ? [] : l.rows.map((r) => String(sheet.rows[r]![label] ?? '')).filter(Boolean)
  const rows =
    labels.length && l.kind !== 'xy' && l.kind !== 'survival'
      ? `, rows ${labels.slice(0, 3).join(', ')}${labels.length > 3 ? ', …' : ''}`
      : ''
  switch (l.orient) {
    case 'flat':
      return `Detected: ${n}, each from its cells in one row.`
    case 'rows':
      return `Detected: ${n}, one per row with the values across.`
    case 'pairs':
      return `Detected: survival data as (time, event) column pairs for ${n}.`
    default:
      return `Detected: ${n}${rows}${l.kind === 'xy' ? `, X = ${l.xTitle ?? 'first column'}` : ''}${l.kind === 'survival' ? `, time = ${l.xTitle ?? 'first column'}` : ''}.`
  }
}

/** A block's label in the table list: its title, or where it is. */
const blockLabel = (b: SheetBlock, i: number) =>
  b.title ?? `Table ${i + 1} (rows ${b.range.r0 + 1}–${b.range.r1 + 1})`

type Delimiter = NonNullable<TextImportOptions['delimiter']>
type Decimal = NonNullable<TextImportOptions['decimal']>

const DELIMITERS: { id: Delimiter; label: string }[] = [
  { id: 'auto', label: 'Detect' },
  { id: ',', label: 'Comma' },
  { id: ';', label: 'Semicolon' },
  { id: '\t', label: 'Tab' },
  { id: 'none', label: 'None (one column)' },
]

const DECIMALS: { id: Decimal; label: string }[] = [
  { id: 'auto', label: 'Detect' },
  { id: '.', label: 'Point (1.5)' },
  { id: ',', label: 'Comma (1,5)' },
]

export function ImportDialog({
  fileName,
  sheets: initialSheets,
  reparse,
  onClose,
  onCreated,
  onWarnings,
}: {
  fileName: string
  sheets: Sheet[]
  /** Delimited text only: re-reads the file with another delimiter / decimal separator. */
  reparse?: (opts: TextImportOptions) => Sheet[]
  onClose: () => void
  onCreated: (id: NodeId) => void
  onWarnings: (msg: string) => void
}) {
  const { store } = useServices()
  const [sheets, setSheets] = useState(initialSheets)
  const [text, setText] = useState<{ delimiter: Delimiter; decimal: Decimal }>({
    delimiter: 'auto',
    decimal: 'auto',
  })
  const [sheetIndex, setSheetIndex] = useState(0)
  const rawSheet = sheets[sheetIndex]!
  // Roadmap 39: the user's missing codes (from Preferences) and values at detection limits. The
  // layout is detected on the sheet with them applied (limit cells as numbers, missing codes
  // empty); the preview shows the sheet as written.
  const [rules, setRules] = useState(() =>
    initialCellRules(currentPreferences().missingCodes, initialSheets),
  )
  const cellRules = useMemo(() => cellRulesOf(rules), [rules])
  const prepared = useMemo(() => prepareSheet(rawSheet, cellRules), [rawSheet, cellRules])
  const sheet = prepared.sheet
  const prep = (sh: Sheet) => prepareSheet(sh, cellRules).sheet
  const base = fileName.replace(/\.[^.]+$/, '')
  // A sheet can hold several tables (journal source data): one title, header and values each.
  const blocks = useMemo(() => findBlocks(sheet), [sheet])
  const [blockIndex, setBlockIndex] = useState(0)
  const block = blocks[blockIndex] as SheetBlock | undefined
  const defaultName = (sh: Sheet, b: SheetBlock | undefined) =>
    b?.title ? b.title : sheets.length > 1 ? `${base} – ${sh.name}` : base
  const [name, setName] = useState(() => defaultName(sheet, blocks[0]))
  // The first guesses (for the initial settings), worked out once per sheet, not on every
  // render (audit 2, U10).
  const guess0 = useMemo(
    () =>
      blocks[0] ? guessBlock(sheet, blocks[0].range, blocks[0].parts, blocks[0].layout) : null,
    [sheet, blocks],
  )
  // Long ("tidy") data: one value per row, grouped by other columns (R and pandas exports).
  const long = useMemo(() => detectLong(sheet), [sheet])
  // A data frame of many number columns (a Seurat or Scanpy export) reads as every column a
  // variable (roadmap 34e), not as one value per row by its last number column.
  const frame0 = useMemo(() => isDataFrame(long), [long])
  const [kind, setKind] = useState<Kind>(
    frame0 ? 'multipleVariables' : (guess0?.tableKind ?? 'column'),
  )
  // The detected structure is used until the settings are changed by hand.
  const [custom, setCustom] = useState(frame0)
  const [first, setFirst] = useState<SheetImportOptions['firstColumn']>(
    frame0 ? 'data' : (guess0?.firstColumn ?? 'data'),
  )
  const [header, setHeader] = useState(frame0 || (guess0?.headerRow ?? false))
  const [replicates, setReplicates] = useState(guess0?.replicates ?? 1)
  const [error, setError] = useState<string | null>(null)

  const [mode, setMode] = useState<'table' | 'long'>(() => (long && !frame0 ? 'long' : 'table'))
  const [longOpts, setLongOpts] = useState(() => longDefaults(long))
  const onSheet = (sh: Sheet) => {
    const info = detectLong(sh)
    setMode(info && !isDataFrame(info) ? 'long' : 'table')
    setLongOpts(longDefaults(info))
    setPicked(new Map())
  }
  // Every column a variable (roadmap 34e, decision 416): text columns of more than 200 distinct
  // values (cell ids, barcodes) are left out unless ticked.
  const [picked, setPicked] = useState<Map<number, boolean>>(() => new Map())
  const variables = mode === 'table' && kind === 'multipleVariables'
  // Roadmap 34f: a multiple-variables table imported as a cells table (null: by its rows).
  const [cells, setCells] = useState<boolean | null>(null)
  // Decision 456: a multiple-variables table of more than 5,000 rows, built and waiting for the
  // answer to whether it is a cells table (the checkbox is for smaller ones).
  const [asking, setAsking] = useState<SheetImportResult | null>(null)
  const many = useMemo(
    () =>
      variables
        ? manyLevelColumns(sheet, {
            headerRow: header,
            ...(blocks.length > 1 && block ? { range: block.range } : {}),
          })
        : new Map<number, number>(),
    [variables, sheet, header, blocks, block],
  )
  const include = useMemo(() => {
    const width = sheet.rows[0]?.length ?? 0
    return Array.from({ length: width }, (_, c) => picked.get(c) ?? !many.has(c))
  }, [sheet, picked, many])

  /** Selects a sheet's table and applies the settings that fit it. */
  const pick = (sh: Sheet, bs: SheetBlock[], i: number) => {
    const b = bs[i]
    setBlockIndex(i)
    setName(defaultName(sh, b))
    if (b) detected(sh, b)
  }
  /** The settings detected for a block. */
  const detected = (sh: Sheet, b: SheetBlock) => {
    const g = guessBlock(sh, b.range, b.parts, b.layout)
    setCustom(false)
    setKind(g.tableKind)
    setFirst(g.firstColumn)
    setHeader(g.headerRow)
    setReplicates(g.replicates)
  }

  // The block with the rows after its values (statistics, notes), so what is left out shows.
  const shown = (mode === 'table' && block?.area) || {
    r0: 0,
    c0: 0,
    r1: sheet.rows.length - 1,
    c1: PREVIEW_COLS - 1,
  }
  const preview = useMemo(
    () =>
      rawSheet.rows
        .slice(shown.r0, Math.min(shown.r1 + 1, shown.r0 + PREVIEW_ROWS))
        .map((row) => row.slice(shown.c0, Math.min(shown.c1 + 1, shown.c0 + PREVIEW_COLS))),
    [rawSheet, shown.r0, shown.r1, shown.c0, shown.c1],
  )
  const needsX = kind === 'xy' || kind === 'survival'

  /** The table the current settings give. */
  const build = (tableName: string): SheetImportResult =>
    finishCellRules(buildFrom(sheet, tableName), prepared, cellRules)
  const buildFrom = (sheet: Sheet, tableName: string): SheetImportResult =>
    mode === 'long' && long
      ? longToTable(sheet, {
          name: tableName,
          value: longOpts.value,
          group: longOpts.group,
          row: longOpts.row,
          subject: longOpts.subject,
          filters:
            longOpts.filterCol !== null && longOpts.filterValue
              ? [{ col: longOpts.filterCol, value: longOpts.filterValue }]
              : [],
        })
      : sheetToTable(sheet, {
          name: tableName,
          tableKind: kind,
          headerRow: header,
          firstColumn: needsX ? 'x' : first,
          replicates: kind === 'xy' || kind === 'grouped' ? replicates : 1,
          // A table made of per-data-set sub-tables keeps them as its data sets.
          ...(block?.parts ? { parts: block.parts } : {}),
          ...(block?.layout && !custom ? { layout: block.layout } : {}),
          ...(blocks.length > 1 && block ? { range: block.range } : {}),
          ...(block ? { area: block.area } : {}),
          ...(kind === 'multipleVariables' ? { include } : {}),
        })
  // biome-ignore lint/correctness/useExhaustiveDependencies: build reads exactly these
  const result = useMemo((): { ok: SheetImportResult } | { error: string } => {
    try {
      return { ok: build('') }
    } catch (e) {
      return { error: errorMessage(e) }
    }
  }, [
    sheet,
    block,
    blocks,
    mode,
    long,
    longOpts,
    kind,
    header,
    first,
    replicates,
    custom,
    include,
    cellRules,
    prepared,
  ])
  // Only the cells the preview shows (a wide sheet read as long data leaves out a million).
  const leftOut = useMemo(() => {
    const out = new Set<string>()
    if (!('ok' in result)) return out
    for (const [r, c] of result.ok.account?.leftOut ?? [])
      if (
        r >= shown.r0 &&
        r < shown.r0 + PREVIEW_ROWS &&
        c >= shown.c0 &&
        c < shown.c0 + PREVIEW_COLS
      )
        out.add(`${r}:${c}`)
    return out
  }, [result, shown.r0, shown.c0])

  const reread = (next: typeof text) => {
    if (!reparse) return
    setText(next)
    try {
      const again = reparse(next)
      if (!again.length) throw new Error('The file has no data.')
      setSheets(again)
      setSheetIndex(0)
      const first = prep(again[0]!)
      pick(first, findBlocks(first), 0)
      onSheet(first)
      setError(null)
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  const create = () => {
    try {
      const built = build(name)
      if (needsCellsPrompt(built.table)) {
        setAsking(built)
        return
      }
      const setting =
        built.table.tableKind === 'multipleVariables' && cells !== null
          ? cellsTableSetting(built.table.rowCount, cells)
          : undefined
      add(setting === undefined ? built.table : { ...built.table, cellsTable: setting }, built)
    } catch (e) {
      setError(errorMessage(e))
    }
  }
  /** The popup's answer: the table imported as a cells table or not, or nothing (Cancel). */
  const answer = (choice: CellsChoice) => {
    const built = asking
    setAsking(null)
    const table = built && withCellsChoice(built.table, choice)
    if (!built || !table) return
    try {
      add(table, built)
    } catch (e) {
      setError(errorMessage(e))
    }
  }
  /** Adds the table and its graph in one undo step, and closes. */
  const add = (table: DataTable, { warnings }: SheetImportResult) => {
    // Values at a detection limit are drawn as open symbols on the new graph (decision 577).
    const graph = withLimitPoints(createGraphFor(table, name), table)
    store.dispatch(
      [
        { type: 'node.add', node: table },
        { type: 'node.add', node: graph, fresh: true },
      ],
      'Import data',
    )
    if (warnings.length) onWarnings(warnings.join(' '))
    onCreated(table.id)
    onClose()
  }

  /** Tables too big to import in bulk (whole omics matrices); they can still be picked one by one. */
  const tooBig = (b: SheetBlock) =>
    b.range.c1 - b.range.c0 + 1 > BULK_MAX_COLUMNS || b.range.r1 - b.range.r0 + 1 > BULK_MAX_ROWS
  const fileBlocks = useMemo(
    () =>
      sheets.length > 1
        ? sheets.map((raw) => {
            const prepared = prepareSheet(raw, cellRules)
            const sh = prepared.sheet
            return { sheet: sh, prepared, blocks: findBlocks(sh), long: detectLong(sh) }
          })
        : [],
    [sheets, cellRules],
  )
  const fileCount = fileBlocks.reduce(
    (n, f) => n + (f.long ? 1 : f.blocks.filter((b) => !tooBig(b)).length),
    0,
  )

  /**
   * Every table of this sheet (or of every sheet), each with the settings detected for it and a
   * graph, in one undo step.
   */
  const createAll = (scope: 'sheet' | 'file') => {
    try {
      const commands = []
      const notes: string[] = []
      let firstId: NodeId | null = null
      let skipped = 0
      const sources = scope === 'sheet' ? [{ sheet, prepared, blocks, long: null }] : fileBlocks
      for (const { sheet: sh, prepared: prep, blocks: bs, long: info } of sources) {
        // Long data: one table from the detected columns.
        if (info) {
          const { table, warnings } = finishCellRules(
            longToTable(sh, { name: sh.name, ...info.guess }),
            prep,
            cellRules,
          )
          commands.push(
            { type: 'node.add' as const, node: table },
            {
              type: 'node.add' as const,
              node: withLimitPoints(createGraphFor(table, sh.name), table),
              fresh: true,
            },
          )
          firstId ??= table.id
          for (const w of warnings) notes.push(`${sh.name}: ${w}`)
          continue
        }
        for (const [i, b] of bs.entries()) {
          if (scope === 'file' && tooBig(b)) {
            skipped++
            continue
          }
          const g = guessBlock(sh, b.range, b.parts, b.layout)
          const title =
            scope === 'sheet'
              ? blockLabel(b, i)
              : bs.length === 1 && !b.title
                ? sh.name
                : `${sh.name} – ${blockLabel(b, i)}`
          const { table, warnings, account } = finishCellRules(
            sheetToTable(sh, {
              name: title,
              ...g,
              range: b.range,
              area: b.area,
              ...(b.parts ? { parts: b.parts } : {}),
              ...(b.layout ? { layout: b.layout } : {}),
            }),
            prep,
            cellRules,
          )
          // Nothing shows these tables before import, so numbers left out are listed after it.
          if (account?.leftOut.length) warnings.push(describeAccount(account))
          commands.push(
            { type: 'node.add' as const, node: table },
            {
              type: 'node.add' as const,
              node: withLimitPoints(createGraphFor(table, title), table),
              fresh: true,
            },
          )
          firstId ??= table.id
          for (const w of warnings) notes.push(`${title}: ${w}`)
        }
      }
      if (skipped)
        notes.push(
          `${skipped} large ${skipped === 1 ? 'table was' : 'tables were'} left out; import them one at a time.`,
        )
      store.dispatch(commands, `Import ${commands.length / 2} tables`)
      if (notes.length) onWarnings(notes.join(' '))
      if (firstId) onCreated(firstId)
      onClose()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <Dialog
      title={`Import “${fileName}”`}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          {fileCount > blocks.length && (
            <button
              type="button"
              onClick={() => createAll('file')}
              title="Every table on every sheet, each with the settings detected for it, and a graph of each"
            >
              Import all {fileCount} tables in the file
            </button>
          )}
          {blocks.length > 1 && mode === 'table' && (
            <button
              type="button"
              onClick={() => createAll('sheet')}
              title="Each table with the settings detected for it, and a graph of each"
            >
              Import all {blocks.length} tables
            </button>
          )}
          <button type="button" className="primary" onClick={create}>
            Import{blocks.length > 1 ? ' this table' : ''}
          </button>
        </>
      }
    >
      {sheets.length > 1 && (
        <Field label="Sheet">
          {(id) => (
            <select
              id={id}
              value={sheetIndex}
              onChange={(e) => {
                const i = Number(e.target.value)
                setSheetIndex(i)
                const next = prep(sheets[i]!)
                pick(next, findBlocks(next), 0)
                onSheet(next)
              }}
            >
              {sheets.map((s, i) => (
                <option key={s.name} value={i}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      {reparse && (
        <Field label="Delimiter">
          {(id) => (
            <select
              id={id}
              value={text.delimiter}
              onChange={(e) => reread({ ...text, delimiter: e.target.value as Delimiter })}
            >
              {DELIMITERS.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      {reparse && (
        <Field label="Decimal separator">
          {(id) => (
            <select
              id={id}
              value={text.decimal}
              onChange={(e) => reread({ ...text, decimal: e.target.value as Decimal })}
            >
              {DECIMALS.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      {long && (
        <fieldset className="field radio">
          <legend>Read the sheet as</legend>
          <label className="check">
            <input
              type="radio"
              name="im-mode"
              checked={mode === 'long'}
              onChange={() => setMode('long')}
            />
            One value per row (long format), grouped by other columns
          </label>
          <label className="check">
            <input
              type="radio"
              name="im-mode"
              checked={mode === 'table' && kind !== 'multipleVariables'}
              onChange={() => {
                setMode('table')
                if (kind === 'multipleVariables' && block) detected(sheet, block)
              }}
            />
            A table as laid out
          </label>
          <label className="check">
            <input
              type="radio"
              name="im-mode"
              checked={mode === 'table' && kind === 'multipleVariables'}
              onChange={() => {
                // Every column a variable, text columns as text (categorical) variables.
                setMode('table')
                setKind('multipleVariables')
                setFirst('data')
                setHeader(true)
                setCustom(true)
              }}
            />
            Every column a variable (multiple-variables table, text columns kept as text)
          </label>
        </fieldset>
      )}
      {mode === 'table' && blocks.length > 1 && (
        <Field label="Table">
          {(id) => (
            <>
              <select
                id={id}
                value={blockIndex}
                onChange={(e) => pick(sheet, blocks, Number(e.target.value))}
              >
                {blocks.map((b, i) => (
                  <option key={`${b.range.r0}:${b.range.c0}`} value={i}>
                    {blockLabel(b, i)}
                  </option>
                ))}
              </select>
              <div className="muted">
                This sheet holds {blocks.length} tables. Settings below are detected for each one.
              </div>
            </>
          )}
        </Field>
      )}
      <div className="import-preview">
        <table>
          <tbody>
            {preview.map((row, r) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: positional preview rows
              <tr key={r}>
                {row.map((v, c) => (
                  <td
                    // biome-ignore lint/suspicious/noArrayIndexKey: positional preview cells
                    key={c}
                    className={`${typeof v === 'number' ? 'num' : ''}${leftOut.has(`${shown.r0 + r}:${shown.c0 + c}`) ? ' left-out' : ''}`}
                    title={
                      leftOut.has(`${shown.r0 + r}:${shown.c0 + c}`)
                        ? 'Not imported with these settings'
                        : undefined
                    }
                  >
                    {cellText(v)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="muted">
          {mode === 'table' && blocks.length > 1 && block
            ? `${block.area.r1 - block.area.r0 + 1} rows × ${block.area.c1 - block.area.c0 + 1} columns`
            : `${sheet.rows.length} rows × ${sheet.rows[0]?.length ?? 0} columns`}
          {sheet.dateCells ? ` · ${sheet.dateCells} date cells imported as day numbers` : ''}
          {sheet.datesAsNumbers
            ? ` · ${sheet.datesAsNumbers} date ${sheet.datesAsNumbers === 1 ? 'cell' : 'cells'} shown as numbers (e.g. 27.9) imported as those numbers`
            : ''}
        </div>
      </div>
      <div className="field">
        <div className="import-result-label">Imports as</div>
        {'ok' in result ? (
          <>
            <TablePreview table={result.ok.table} />
            {result.ok.account && (
              <div className={result.ok.account.leftOut.length ? 'import-account warn' : 'muted'}>
                {describeAccount(result.ok.account)}
                {result.ok.account.leftOut.length > 0 && ' Highlighted above.'}
              </div>
            )}
          </>
        ) : (
          <div className="error-text">{result.error}</div>
        )}
      </div>
      {mode === 'table' && block?.parts && kind === 'grouped' && (
        <div className="muted field">
          Combines {block.parts.length} sub-tables, one per data set (
          {block.parts.map((p, i) => p.title ?? `data set ${i + 1}`).join(', ')}), matching rows by
          title.
        </div>
      )}
      {mode === 'table' && block?.layout && !block.parts && (
        <div className="field">
          <label className="check">
            <input
              type="checkbox"
              checked={!custom}
              onChange={(e) => (e.target.checked ? detected(sheet, block) : setCustom(true))}
            />
            Use the detected layout
          </label>
          <div className="muted">
            {custom
              ? 'Reading the block as a plain range with the settings below.'
              : describeLayout(block.layout, sheet)}
          </div>
        </div>
      )}
      {variables && 'ok' in result && !needsCellsPrompt(result.ok.table) && (
        <div className="field">
          <label className="check" title={CELLS_TABLE_HINT}>
            <input
              type="checkbox"
              checked={cells ?? cellsTableByDefault(result.ok.table.rowCount)}
              onChange={(e) => setCells(e.target.checked)}
            />
            Treat as a cells table (single-cell / cytometry)
          </label>
        </div>
      )}
      <Field label="Table name">
        {(id) => <input id={id} value={name} onChange={(e) => setName(e.target.value)} />}
      </Field>
      <CellRulesFields value={rules} onChange={setRules} sheet={rawSheet} header={header} />
      {mode === 'long' && long && (
        <LongFields info={long} sheet={sheet} value={longOpts} onChange={setLongOpts} />
      )}
      {mode === 'table' && (
        <>
          <RadioGroup
            legend="Table type"
            name="im-kind"
            value={kind}
            options={KINDS.map((k) => ({ value: k.id, label: k.label }))}
            onChange={(id) => {
              setKind(id)
              setFirst(KINDS.find((k) => k.id === id)!.first)
              setCustom(true)
            }}
          />
          <label className="check field">
            <input
              type="checkbox"
              checked={header}
              onChange={(e) => {
                setHeader(e.target.checked)
                setCustom(true)
              }}
            />
            First row holds column titles
          </label>
          {!needsX && (
            <Field label="First column">
              {(id) => (
                <select
                  id={id}
                  value={first}
                  onChange={(e) => {
                    setFirst(e.target.value as SheetImportOptions['firstColumn'])
                    setCustom(true)
                  }}
                >
                  <option value="data">Data (like the other columns)</option>
                  <option value="rowTitles">Row titles</option>
                </select>
              )}
            </Field>
          )}
          {variables && (
            <ColumnPicks
              sheet={sheet}
              header={header}
              first={first}
              range={blocks.length > 1 && block ? block.range : undefined}
              include={include}
              many={many}
              onChange={(c, on) => setPicked((m) => new Map(m).set(c, on))}
            />
          )}
          {(kind === 'xy' || kind === 'grouped') && (
            <Field label="Replicate columns per data set">
              {(id) => (
                <input
                  id={id}
                  type="number"
                  min={1}
                  max={50}
                  value={replicates}
                  onChange={(e) => {
                    setReplicates(Math.max(1, Math.min(50, Number(e.target.value) || 1)))
                    setCustom(true)
                  }}
                />
              )}
            </Field>
          )}
        </>
      )}
      {error && <div className="error-text">{error}</div>}
      {asking && <CellsTablePrompt table={asking.table} onChoose={answer} />}
    </Dialog>
  )
}

const PREVIEW_TABLE_ROWS = 8
const PREVIEW_TABLE_COLS = 10

/** The first rows and columns of the table an import gives, with its shape. */
function TablePreview({ table }: { table: DataTable }) {
  const lead = table.x !== null ? (table.x.title ?? 'X') : table.rowTitles !== null ? '' : null
  const cols: { set: number; sub: number; values: (number | string | null)[] }[] = []
  table.dataSets.forEach((d, set) => {
    if (d.text) {
      cols.push({ set, sub: 0, values: d.text })
      return
    }
    d.subcolumns.forEach((c, sub) => {
      cols.push({ set, sub, values: c.type === 'number' ? c.values : [] })
    })
  })
  const shown = cols.slice(0, PREVIEW_TABLE_COLS)
  // Header spans: one per data set, over its shown replicate columns.
  const spans: { title: string; width: number }[] = []
  for (const c of shown) {
    const last = spans[spans.length - 1]
    if (last && c.sub > 0) last.width++
    else spans.push({ title: table.dataSets[c.set]!.title, width: 1 })
  }
  const reps = table.yFormat.type === 'replicates' ? table.yFormat.count : 1
  const kind =
    {
      column: 'Column',
      xy: 'XY',
      grouped: 'Grouped',
      contingency: 'Contingency',
      survival: 'Survival',
      multipleVariables: 'Multiple variables',
    }[table.tableKind as 'column'] ?? table.tableKind
  const rows = Math.min(table.rowCount, PREVIEW_TABLE_ROWS)
  return (
    <div className="import-preview result">
      <table>
        <thead>
          <tr className="head">
            {lead !== null && <td>{lead}</td>}
            {spans.map((s, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: positional preview columns
              <td key={i} colSpan={s.width}>
                {s.title}
              </td>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, r) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: positional preview rows
            <tr key={r}>
              {lead !== null && (
                <td className={table.x ? 'num' : 'row-title'}>
                  {table.x
                    ? cellText(
                        table.x.subcolumns[0]?.type === 'number'
                          ? (table.x.subcolumns[0].values[r] ?? null)
                          : null,
                      )
                    : (table.rowTitles?.[r] ?? '')}
                </td>
              )}
              {shown.map((c, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: positional preview cells
                <td key={i} className={typeof c.values[r] === 'string' ? '' : 'num'}>
                  {cellText(c.values[r] ?? null)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="muted">
        {kind} table · {table.dataSets.length}{' '}
        {table.tableKind === 'multipleVariables' ? 'variable' : 'data set'}
        {table.dataSets.length === 1 ? '' : 's'}
        {table.dataSets.some((d) => d.text)
          ? ` (${table.dataSets.filter((d) => d.text).length} text)`
          : ''}
        {reps > 1 ? ` × ${reps} replicates` : ''} · {table.rowCount} row
        {table.rowCount === 1 ? '' : 's'}
        {cols.length > shown.length || table.rowCount > rows ? ' (first shown)' : ''}
      </div>
    </div>
  )
}

type LongOpts = {
  value: number
  group: number
  row: number | null
  subject: number | null
  filterCol: number | null
  filterValue: string
}

function longDefaults(info: LongInfo | null): LongOpts {
  return {
    value: info?.guess.value ?? 0,
    group: info?.guess.group ?? 0,
    row: info?.guess.row ?? null,
    subject: info?.guess.subject ?? null,
    filterCol: null,
    filterValue: '',
  }
}

/** Column choices for a long-format import. */
function LongFields({
  info,
  sheet,
  value,
  onChange,
}: {
  info: LongInfo
  sheet: Sheet
  value: LongOpts
  onChange: (v: LongOpts) => void
}) {
  const set = (patch: Partial<LongOpts>) => onChange({ ...value, ...patch })
  const numeric = info.columns.filter((c) => c.numeric)
  const factors = info.columns.filter((c) => c.levels > 1 && c.levels <= 200)
  const label = (c: LongInfo['columns'][number]) =>
    `${c.title} (${c.levels} ${c.numeric ? 'values' : 'levels'})`
  const optional = (
    text: string,
    v: number | null,
    key: 'row' | 'subject' | 'filterCol',
    hint: string,
  ) => (
    <Field label={text}>
      {(id) => (
        <>
          <select
            id={id}
            value={v ?? ''}
            onChange={(e) =>
              set({
                [key]: e.target.value === '' ? null : Number(e.target.value),
                ...(key === 'filterCol' ? { filterValue: '' } : {}),
              })
            }
          >
            <option value="">None</option>
            {factors.map((c) => (
              <option key={c.index} value={c.index}>
                {label(c)}
              </option>
            ))}
          </select>
          <div className="muted">{hint}</div>
        </>
      )}
    </Field>
  )
  const filterLevels = useMemo(() => {
    if (value.filterCol === null) return []
    const seen: string[] = []
    for (const r of sheet.rows.slice(1)) {
      const v = r[value.filterCol]
      const t = v === null || v === undefined ? '' : String(v).trim()
      if (t && !seen.includes(t)) seen.push(t)
      if (seen.length >= 200) break
    }
    return seen
  }, [sheet, value.filterCol])
  return (
    <>
      <Field label="Values">
        {(id) => (
          <select
            id={id}
            value={value.value}
            onChange={(e) => set({ value: Number(e.target.value) })}
          >
            {numeric.map((c) => (
              <option key={c.index} value={c.index}>
                {c.title}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Data sets (one per level of)">
        {(id) => (
          <select
            id={id}
            value={value.group}
            onChange={(e) => set({ group: Number(e.target.value) })}
          >
            {factors.map((c) => (
              <option key={c.index} value={c.index}>
                {label(c)}
              </option>
            ))}
          </select>
        )}
      </Field>
      {optional(
        'Rows (a second factor)',
        value.row,
        'row',
        'Gives a grouped table; none gives a column table.',
      )}
      {optional(
        'Subjects (matching)',
        value.subject,
        'subject',
        'Values of one subject share a row, for paired or repeated-measures tests.',
      )}
      {optional('Only rows where', value.filterCol, 'filterCol', '')}
      {value.filterCol !== null && (
        <Field label="equals">
          {(id) => (
            <select
              id={id}
              value={value.filterValue}
              onChange={(e) => set({ filterValue: e.target.value })}
            >
              <option value="">(choose a value)</option>
              {filterLevels.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
    </>
  )
}

/**
 * Long data whose number columns are many (more than three) is a data frame of variables — a
 * Seurat, Scanpy or FlowJo export — rather than one value per row (roadmap 34e).
 */
const isDataFrame = (info: LongInfo | null) =>
  !!info && info.columns.filter((c) => c.numeric).length > 3

/**
 * Every column a variable (roadmap 34e, decision 416): each column ticked to import; text columns
 * of more than 200 distinct values are left out until ticked, with the reason beside them.
 */
function ColumnPicks({
  sheet,
  header,
  first,
  range,
  include,
  many,
  onChange,
}: {
  sheet: Sheet
  header: boolean
  first: SheetImportOptions['firstColumn']
  range: { r0: number; c0: number; r1: number; c1: number } | undefined
  include: readonly boolean[]
  many: ReadonlyMap<number, number>
  onChange: (column: number, on: boolean) => void
}) {
  const r0 = range?.r0 ?? 0
  const c0 = (range?.c0 ?? 0) + (first === 'rowTitles' ? 1 : 0)
  const c1 = range?.c1 ?? (sheet.rows[0]?.length ?? 0) - 1
  const cols = Array.from({ length: Math.max(0, c1 - c0 + 1) }, (_, k) => c0 + k)
  const title = (c: number) =>
    (header ? String(sheet.rows[r0]?.[c] ?? '').trim() : '') || `Column ${c + 1}`
  return (
    <fieldset className="field large-import-columns">
      <legend>
        Columns ({cols.filter((c) => include[c]).length} of {cols.length} imported)
      </legend>
      <div className="large-import-list">
        {cols.map((c) => (
          <div key={c} className="large-import-column">
            <label>
              <input
                type="checkbox"
                checked={include[c] ?? true}
                onChange={(e) => onChange(c, e.target.checked)}
              />{' '}
              {title(c)}
            </label>
            {many.has(c) && <span className="muted">{manyLevelsReason(many.get(c)!)}</span>}
          </div>
        ))}
      </div>
    </fieldset>
  )
}
