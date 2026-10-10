import type { Command } from '@ps/engine'
import {
  type DataSetColumn,
  type DataTable,
  isFormatted,
  type RichText,
  richPlain,
  titleRuns,
} from '@ps/model'
import { sameRichText, trimRuns } from '../richText/model.ts'
import { RichTextEditor, RichTextView } from '../richText/RichTextEditor.tsx'
import { type GridColumn, subTitleCommand } from './gridModel.ts'

// Formatted table titles (roadmap 28): data set, X, row and subcolumn titles typed in the rich
// text editor, stored as plain text plus runs when formatted. Everything else keeps reading the
// plain title.

/** A title as shown in the grid: formatted when it has a rich form. */
export function RichTitle({ title, rich }: { title: string; rich?: RichText | null }) {
  const runs = titleRuns(title, rich)
  return isFormatted(runs) ? (
    <span className="rich">
      <RichTextView runs={runs} />
    </span>
  ) : (
    title
  )
}

/** The one-line editor a title is renamed in (Enter or leaving it commits, Escape cancels). */
export function TitleEditor({
  value,
  label,
  placeholder,
  className = 'title-input',
  selectAll = true,
  onChange,
  onCommit,
  onCancel,
  onKeyDown,
  onPasteText,
}: {
  value: RichText
  label: string
  placeholder?: string
  className?: string
  selectAll?: boolean
  onChange?: (runs: RichText) => void
  onCommit: (runs: RichText) => void
  onCancel: () => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void
  onPasteText?: (text: string) => boolean
}) {
  return (
    <RichTextEditor
      className={className}
      value={value}
      label={label}
      placeholder={placeholder}
      autoFocus
      selectAll={selectAll}
      once
      // A title's size is kept for graphs; the grid shows it at its own size.
      showSizes={false}
      onChange={onChange}
      onCommit={(runs) => onCommit(runs)}
      onCancel={onCancel}
      onKeyDown={onKeyDown}
      onPasteText={onPasteText}
    />
  )
}

/** Renaming a data set to typed runs; null when nothing changed. */
export function renameDataSetCommand(
  t: DataTable,
  ds: DataSetColumn,
  runs: RichText,
): Command | null {
  const title = richPlain(runs)
  if (sameRichText(runs, titleRuns(ds.title, ds.titleRich))) return null
  return { type: 'table.renameDataSet', table: t.id, id: ds.id, title, rich: runs }
}

/** Renaming the X column to typed runs; null when nothing changed. */
export function renameXCommand(t: DataTable, runs: RichText): Command | null {
  if (!t.x || sameRichText(runs, titleRuns(t.x.title, t.x.titleRich))) return null
  return { type: 'table.renameX', table: t.id, title: richPlain(runs), rich: runs }
}

/** A row title from typed runs (trimmed; empty clears it). */
export function rowTitleCommand(t: DataTable, row: number, runs: RichText): Command {
  const rich = trimRuns(runs)
  const title = richPlain(rich)
  return { type: 'table.setRowTitle', table: t.id, row, title: title || null, rich }
}

/** The runs a row title is edited from. */
export const rowTitleRuns = (t: DataTable, row: number): RichText =>
  titleRuns(t.rowTitles?.[row] ?? '', t.rowTitlesRich?.[row])

/** Naming a subcolumn with typed runs (as `subTitleCommand`, formatting included). */
export function subTitleRichCommand(
  t: DataTable,
  col: Extract<GridColumn, { kind: 'data' }>,
  runs: RichText,
): Command | null {
  const rich = trimRuns(runs)
  const cmd = subTitleCommand(t, col, richPlain(rich))
  if (cmd?.type === 'table.setSubcolumnTitle') return cmd.title === null ? cmd : { ...cmd, rich }
  // Only the formatting changed.
  const title = col.ds.subcolumnTitles?.[col.sub]
  const before = title ? titleRuns(title, col.ds.subcolumnTitlesRich?.[col.sub]) : null
  if (!title || !before || sameRichText(rich, before) || richPlain(rich) !== title) return null
  return { type: 'table.setSubcolumnTitle', table: t.id, id: col.ds.id, sub: col.sub, title, rich }
}
