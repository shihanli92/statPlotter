import {
  duplicateFamily,
  type FamilyLayouts,
  familyOf,
  substitute,
  tableCopyName,
} from '@ps/engine'
import type { DataTable, NodeId } from '@ps/model'
import { useId, useState } from 'react'
import { Dialog } from '../components/Dialog.tsx'
import { RadioGroup } from '../components/fields.tsx'
import { useDoc, useServices } from '../context.tsx'
import { errorMessage } from '../util.ts'
import { countNodes, nextInSeries } from './names.ts'

/**
 * Edit › Duplicate family… (roadmap 31): a copy of a data table with its analyses, graphs and
 * layouts, linked to each other as the originals are, names changed by a text substitution
 * ("Day 1" → "Day 2"). One undo step.
 */
export function DuplicateFamilyDialog({
  tableId,
  onClose,
  onCreated,
  onError,
}: {
  tableId: NodeId
  onClose: () => void
  onCreated: (id: NodeId) => void
  onError: (msg: string) => void
}) {
  const { store } = useServices()
  const project = useDoc((d) => d)
  const table = project.nodes[tableId] as DataTable
  const [find, setFind] = useState(table.name)
  const [replace, setReplace] = useState(() =>
    nextInSeries(table.name, new Set(Object.values(project.nodes).map((n) => n.name))),
  )
  const [layouts, setLayouts] = useState<FamilyLayouts>('whole')
  const id = useId()

  const members = familyOf(project, tableId, layouts).map((id) => project.nodes[id]!)
  // Listed as the navigator's sections: the table, results, graphs, layouts.
  const rank = { table: 0, analysis: 1, graph: 2, layout: 3, info: 4 }
  const names = [
    tableCopyName(project, table.name, find, replace),
    ...[...members]
      .sort((a, b) => rank[a.kind] - rank[b.kind])
      .map((n) => substitute(n.name, find, replace)),
  ]

  // Planned on OK (the copy of a large table is made once).
  const create = () => {
    try {
      const plan = duplicateFamily(store.getState(), tableId, { find, replace, layouts })
      store.dispatch(plan.commands, 'Duplicate family')
      onCreated(plan.table)
      onClose()
    } catch (e) {
      onError(errorMessage(e))
    }
  }

  return (
    <Dialog
      title={`Duplicate “${table.name}” with its family`}
      onClose={onClose}
      okLabel="Duplicate"
      onOk={create}
    >
      <p className="muted">
        Copies the table and its values with {countNodes(members)}, linked to the copy as the
        originals are.
      </p>
      <div className="field inline-fields">
        <label htmlFor={`${id}-find`}>In the copies’ names, replace</label>
        <input
          id={`${id}-find`}
          type="text"
          value={find}
          onChange={(e) => setFind(e.target.value)}
        />
        <label htmlFor={`${id}-replace`}>with</label>
        <input
          id={`${id}-replace`}
          type="text"
          value={replace}
          onChange={(e) => setReplace(e.target.value)}
        />
      </div>
      <RadioGroup<FamilyLayouts>
        legend="Layouts"
        name="df-layouts"
        value={layouts}
        options={[
          { value: 'whole', label: 'Copy layouts showing only graphs of this table' },
          {
            value: 'any',
            label: 'Also layouts mixing them with other graphs (those stay shared)',
          },
          { value: 'none', label: 'No layouts' },
        ]}
        onChange={setLayouts}
      />
      <div className="field">
        <span className="field-label">The copies</span>
        <ul className="name-list" aria-label="The copies">
          {names.map((n, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: names repeat; the list is static
            <li key={i}>{n}</li>
          ))}
        </ul>
      </div>
    </Dialog>
  )
}
