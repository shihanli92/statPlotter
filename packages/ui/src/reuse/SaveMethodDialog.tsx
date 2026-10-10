import { createMethod, familyOf, METHOD_EXTENSION, methodImages, writeMethod } from '@ps/engine'
import type { DataTable, NodeId } from '@ps/model'
import { useState } from 'react'
import { Dialog, NoticeDialog } from '../components/Dialog.tsx'
import { Checkbox, Field } from '../components/fields.tsx'
import { useConfirm } from '../components/modals.tsx'
import { useDoc, useServices } from '../context.tsx'
import { errorMessage } from '../util.ts'
import { countNodes } from './names.ts'

const encoder = new TextEncoder()

/**
 * Analyze › Save as method… (roadmap 31): the table's analyses (with their parameters) and graphs
 * (with their formatting), and optionally its layouts, kept as a method in the user's library, or
 * exported as a file to share, to apply to any table of the same kind later.
 */
export function SaveMethodDialog({
  tableId,
  onClose,
  onDone,
}: {
  tableId: NodeId
  onClose: () => void
  /** A message for the user (saved, or what went wrong). */
  onDone: (msg: string) => void
}) {
  const { platform } = useServices()
  const confirm = useConfirm()
  const project = useDoc((d) => d)
  const table = project.nodes[tableId] as DataTable
  const [name, setName] = useState(table.name)
  const [description, setDescription] = useState('')
  const [layouts, setLayouts] = useState(true)
  const members = familyOf(project, tableId, layouts ? 'whole' : 'none').map(
    (id) => project.nodes[id]!,
  )
  const hasLayouts = familyOf(project, tableId, 'whole').some(
    (id) => project.nodes[id]?.kind === 'layout',
  )
  const images = methodImages(project, tableId, layouts)
  if (!members.some((n) => n.kind !== 'layout'))
    return (
      <NoticeDialog
        title="Save as method"
        message={`“${table.name}” has no analyses or graphs to save as a method.`}
        onClose={onClose}
      />
    )

  const method = () =>
    createMethod(project, tableId, { name: name.trim(), description: description.trim(), layouts })
  const save = async () => {
    const library = platform.methods
    if (!library) return
    try {
      const taken = (await library.list()).some((e) => e.name === name.trim())
      if (
        taken &&
        !(await confirm({ title: `Replace the method “${name.trim()}”?`, ok: 'Replace' }))
      )
        return
      await library.write(name.trim(), encoder.encode(writeMethod(method())))
      onDone(`Saved the method “${name.trim()}”. Apply it from Analyze › Apply method….`)
      onClose()
    } catch (e) {
      onDone(`Couldn’t save the method: ${errorMessage(e)}`)
    }
  }
  const exportFile = async () => {
    try {
      const m = method()
      await platform.exportFile(writeMethod(m), `${m.name}.${METHOD_EXTENSION}`, 'application/json')
    } catch (e) {
      onDone(`Couldn’t export the method: ${errorMessage(e)}`)
    }
  }

  return (
    <Dialog
      title="Save as method"
      onClose={onClose}
      footer={
        <>
          <button type="button" disabled={!name.trim()} onClick={() => void exportFile()}>
            Export to a file…
          </button>
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          {platform.methods && (
            <button
              type="button"
              className="primary"
              disabled={!name.trim()}
              onClick={() => void save()}
            >
              Save
            </button>
          )}
        </>
      }
    >
      <p className="muted">
        Keeps the {countNodes(members)} of “{table.name}” — parameters and formatting, not the data
        — to make them for any other {table.tableKind === 'xy' ? 'XY' : table.tableKind} table
        later.
      </p>
      <Field label="Method name">
        {(id) => (
          <input id={id} type="text" value={name} onChange={(e) => setName(e.target.value)} />
        )}
      </Field>
      <Field label="Description (optional)">
        {(id) => (
          <textarea
            id={id}
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        )}
      </Field>
      {hasLayouts && (
        <Checkbox
          label="Include layouts showing only its graphs and tables"
          checked={layouts}
          onChange={setLayouts}
        />
      )}
      {images > 0 && (
        <p className="help">
          {images === 1 ? 'The image' : `The ${images} images`} on its layouts{' '}
          {images === 1 ? 'is' : 'are'} left out: a method keeps no image files.
        </p>
      )}
    </Dialog>
  )
}
