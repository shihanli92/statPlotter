import type { DataTable, GridColumn } from '@ps/model'
import { useState } from 'react'
import { Dialog } from '../components/Dialog.tsx'
import { Field } from '../components/fields.tsx'
import { columnLabel, type SortKey } from './reorder.ts'

const KEYS = ['Sort by', 'Then by', 'Then by'] as const

/**
 * Edit › Sort…: up to three keys (any column: row titles, X, a data set's subcolumn, a text
 * variable), each ascending or descending. Every row of the table is sorted, kept whole.
 */
export function SortDialog({
  table,
  cols,
  initial,
  onSort,
  onClose,
}: {
  table: DataTable
  cols: readonly GridColumn[]
  /** The grid column the first key starts on (the focused one). */
  initial: number
  onSort: (keys: SortKey[]) => void
  onClose: () => void
}) {
  // A grid column index per key (−1: none) and its direction.
  const [keys, setKeys] = useState(() => [
    { c: Math.max(0, Math.min(initial, cols.length - 1)), descending: false },
    { c: -1, descending: false },
    { c: -1, descending: false },
  ])
  const set = (i: number, patch: Partial<(typeof keys)[number]>) =>
    setKeys((ks) => ks.map((k, j) => (j === i ? { ...k, ...patch } : k)))
  const chosen = keys.filter((k, i) => k.c >= 0 && keys.slice(0, i).every((p) => p.c >= 0))
  const sort = () => {
    onSort(chosen.map((k) => ({ col: cols[k.c]!, descending: k.descending })))
    onClose()
  }
  return (
    <Dialog
      title="Sort rows"
      onClose={onClose}
      okLabel="Sort"
      onOk={sort}
      okDisabled={!chosen.length}
    >
      <p className="muted">
        Sorts every row of “{table.name}” ({table.rowCount} rows), not only the selected cells: each
        row moves whole, with its title and excluded values. Numbers sort by value, text
        alphabetically (ignoring case); blank cells go last. Graphs, labels and analyses follow
        their rows. Undo puts the rows back.
      </p>
      {KEYS.map((label, i) => {
        const k = keys[i]!
        const off = i > 0 && keys[i - 1]!.c < 0
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: three fixed key rows
          <Field key={i} label={label} className="sort-key">
            {(id) => (
              <>
                <select
                  id={id}
                  value={k.c}
                  disabled={off}
                  onChange={(e) => set(i, { c: Number(e.target.value) })}
                >
                  {i > 0 && <option value={-1}>(none)</option>}
                  {cols.map((col, c) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: positional columns
                    <option key={c} value={c}>
                      {columnLabel(table, col)}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={`${label}: order`}
                  value={k.descending ? 'desc' : 'asc'}
                  disabled={off || k.c < 0}
                  onChange={(e) => set(i, { descending: e.target.value === 'desc' })}
                >
                  <option value="asc">Ascending (A→Z, 1→9)</option>
                  <option value="desc">Descending (Z→A, 9→1)</option>
                </select>
              </>
            )}
          </Field>
        )
      })}
    </Dialog>
  )
}
