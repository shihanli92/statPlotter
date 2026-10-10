import type { DataTable } from '@ps/model'
import { useEffect, useRef } from 'react'
import { Dialog } from '../components/Dialog.tsx'
import {
  CELLS_PROMPT_CELLS,
  CELLS_PROMPT_ORDINARY,
  CELLS_TABLE_LABEL,
  type CellsChoice,
  cellsPromptTitle,
} from './cellsTable.ts'

/**
 * Importing a multiple-variables table of more than 5,000 rows (decision 456): one decision — a
 * cells table (the default button) or an ordinary table — or Cancel, importing nothing.
 */
export function CellsTablePrompt({
  table,
  onChoose,
}: {
  table: Pick<DataTable, 'rowCount' | 'dataSets'>
  onChoose: (choice: CellsChoice) => void
}) {
  // The default answer has the focus (Enter takes it), once the dialog has opened: the Dialog's
  // own effect, a child's, runs first.
  const cells = useRef<HTMLButtonElement>(null)
  useEffect(() => cells.current?.focus(), [])
  return (
    <Dialog
      title={cellsPromptTitle(table)}
      onClose={() => onChoose('cancel')}
      footer={
        <>
          <button type="button" onClick={() => onChoose('cancel')}>
            Cancel
          </button>
          <button type="button" onClick={() => onChoose('ordinary')}>
            {CELLS_PROMPT_ORDINARY.label}
          </button>
          <button ref={cells} type="button" className="primary" onClick={() => onChoose('cells')}>
            {CELLS_PROMPT_CELLS.label}
          </button>
        </>
      }
    >
      <p>
        <strong>{CELLS_PROMPT_CELLS.label}</strong> {CELLS_PROMPT_CELLS.detail}
      </p>
      <p>
        <strong>{CELLS_PROMPT_ORDINARY.label}</strong>
        {CELLS_PROMPT_ORDINARY.detail}
      </p>
      <p className="muted">You can change it later: View › {CELLS_TABLE_LABEL}.</p>
    </Dialog>
  )
}
