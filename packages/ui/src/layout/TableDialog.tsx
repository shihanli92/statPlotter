import type { PageTableSource } from '@ps/model'
import { useState } from 'react'
import { Dialog } from '../components/Dialog.tsx'
import { Select } from '../components/fields.tsx'
import type { TableSourceChoice } from './tableSources.ts'

/** Insert › Table…: which data table, result table or results sheet the page shows (live). */
export function TableDialog({
  choices,
  onPick,
  onClose,
}: {
  choices: readonly TableSourceChoice[]
  onPick: (source: PageTableSource) => void
  onClose: () => void
}) {
  const [value, setValue] = useState(choices[0]?.value ?? '')
  const pick = choices.find((c) => c.value === value)
  return (
    <Dialog
      title="Insert table"
      okLabel="Insert"
      okDisabled={!pick}
      onOk={() => pick && onPick(pick.source)}
      onClose={onClose}
    >
      {choices.length ? (
        <>
          <Select
            label="Table to show"
            value={value}
            options={choices.map((c) => ({ value: c.value, label: c.label }))}
            onChange={setValue}
          />
          <p className="muted">
            The table stays live: it changes when the data or the results do. Its rows, columns and
            font are set in the inspector.
          </p>
        </>
      ) : (
        <p>There is no data table or result yet to show.</p>
      )}
    </Dialog>
  )
}
