import { canConvert, convertTable } from '@ps/engine'
import {
  type DataTable,
  isYFormatAllowed,
  MAX_REPLICATES,
  type NodeId,
  type SummaryPreset,
  type YFormat,
} from '@ps/model'
import { useState } from 'react'
import { Dialog } from '../components/Dialog.tsx'
import { Field, RadioGroup } from '../components/fields.tsx'
import { useDoc, useServices } from '../context.tsx'
import { SUMMARY_FORMATS } from '../NewTableDialog.tsx'
import { errorMessage } from '../util.ts'

const label = (f: YFormat) =>
  f.type === 'replicates'
    ? `${f.count} replicate${f.count === 1 ? '' : 's'} (subcolumns)`
    : (SUMMARY_FORMATS.find((s) => s.id === f.preset)?.label ?? f.preset)

/** Values in a table's subcolumns from `count` on (removed by fewer replicates). */
function valuesPast(t: DataTable, count: number): number {
  let n = 0
  for (const d of t.dataSets)
    for (const c of d.subcolumns.slice(count)) n += c.values.filter((v) => v !== null).length
  return n
}

/**
 * Format › Change table format… (roadmap 31): the entry format without retyping the data — more
 * or fewer replicates; replicates summarized as mean with SD, SEM or CV and N; between SD, SEM
 * and CV given N (exact); ± errors and limits. Says what would be lost first. One undo step.
 */
export function TableFormatDialog({
  tableId,
  onClose,
  onError,
}: {
  tableId: NodeId
  onClose: () => void
  onError: (msg: string) => void
}) {
  const { store } = useServices()
  const table = useDoc((d) => d.nodes[tableId]) as DataTable
  const from = table.yFormat
  const reps =
    from.type === 'replicates' &&
    isYFormatAllowed(table.tableKind, { type: 'replicates', count: 2 })
  const [count, setCount] = useState(from.type === 'replicates' ? from.count : 1)
  const presets = SUMMARY_FORMATS.filter((s) =>
    canConvert(table.tableKind, from, { type: 'summary', preset: s.id }),
  )
  const [choice, setChoice] = useState<'replicates' | SummaryPreset>(
    reps ? 'replicates' : (presets[0]?.id ?? 'replicates'),
  )
  const to: YFormat =
    choice === 'replicates' ? { type: 'replicates', count } : { type: 'summary', preset: choice }

  let note: string
  let ok = true
  if (choice === 'replicates') {
    const lost = from.type === 'replicates' && count < from.count ? valuesPast(table, count) : 0
    ok = from.type === 'replicates' && count !== from.count
    note = lost
      ? `Removes the last ${from.type === 'replicates' ? from.count - count : 0} subcolumns and the ${lost} value${lost === 1 ? '' : 's'} in them (Undo brings them back).`
      : 'Adds or removes empty subcolumns.'
  } else {
    const { lost } = convertTable(table, to)
    note =
      from.type === 'replicates'
        ? `Replaces the ${lost} value${lost === 1 ? '' : 's'} entered by ${label(to).toLowerCase()} computed from them${table.tableKind === 'column' ? ' (one row per data set)' : ' in each row'}; excluded values are left out. Analyses that need each value (nonparametric tests, normality tests…) can’t use summary data. Undo brings the values back.`
        : lost
          ? `${lost} entered value${lost === 1 ? '' : 's'} can’t be converted and ${lost === 1 ? 'is' : 'are'} dropped (for example an SEM without N gives no SD).`
          : 'Every value converts exactly (SD = SEM × √N = CV × |mean|).'
  }

  const apply = () => {
    try {
      store.dispatch(
        choice === 'replicates'
          ? { type: 'table.setReplicateCount', table: tableId, count }
          : { type: 'table.setYFormat', table: tableId, format: to },
        'Change table format',
      )
      onClose()
    } catch (e) {
      onError(errorMessage(e))
    }
  }

  const options = [
    ...(reps ? [{ value: 'replicates' as const, label: 'Replicate values in subcolumns' }] : []),
    ...presets.map((p) => ({ value: p.id, label: p.label })),
  ]
  return (
    <Dialog
      title="Change table format"
      onClose={onClose}
      okLabel="Change format"
      okDisabled={!ok || !options.length}
      onOk={apply}
    >
      <p className="muted">
        “{table.name}” is entered as {label(from).toLowerCase()}.
      </p>
      {options.length ? (
        <>
          <RadioGroup
            legend="Enter the values as"
            name="tf-format"
            value={choice}
            options={options}
            onChange={setChoice}
          />
          {choice === 'replicates' && (
            <Field label="Subcolumns per data set">
              {(id) => (
                <input
                  id={id}
                  type="number"
                  min={1}
                  max={MAX_REPLICATES}
                  value={count}
                  onChange={(e) =>
                    setCount(
                      Math.max(
                        1,
                        Math.min(MAX_REPLICATES, Math.round(Number(e.target.value)) || 1),
                      ),
                    )
                  }
                />
              )}
            </Field>
          )}
          <p className="help" role="status">
            {note}
          </p>
        </>
      ) : (
        <p className="help">This table’s format can’t be changed without retyping its values.</p>
      )}
    </Dialog>
  )
}
