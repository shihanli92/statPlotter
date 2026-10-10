import type { FolderId, NodeId } from '@ps/model'
import { useState } from 'react'
import { Dialog } from '../components/Dialog.tsx'
import { useDoc, useServices } from '../context.tsx'

/**
 * Edit › Move to folder… (roadmap 40): the folders (subfolders under theirs), "No folder", or a
 * new folder holding the sheets. One undo step. Roadmap 47: `count` sheets selected in the
 * navigator (`ids`: them and their families), named by their count.
 */
export function MoveToFolderDialog({
  ids,
  count,
  onNewFolder,
  onClose,
}: {
  ids: NodeId[]
  /** Several selected sheets (2 or more). */
  count?: number
  onNewFolder: (members: NodeId[]) => void
  onClose: () => void
}) {
  const { store } = useServices()
  const project = useDoc((d) => d)
  const folders = project.folders ?? []
  const folderOf = (id: NodeId) => folders.find((f) => f.members.includes(id))?.id ?? ''
  // Several sheets in different folders: none of the choices is where they are.
  const now = ids.every((id) => folderOf(id) === folderOf(ids[0]!)) ? folderOf(ids[0]!) : null
  const [choice, setChoice] = useState<string | null>(now)
  const many = count !== undefined && count > 1
  const name = project.nodes[ids[0]!]?.name ?? 'the sheet'
  const ordered = folders
    .filter((f) => f.parent === undefined)
    .flatMap((f) => [f, ...folders.filter((s) => s.parent === f.id)])
  const ok = () => {
    if (choice === '+') onNewFolder(ids)
    else if (choice !== null && choice !== now)
      store.dispatch(
        { type: 'folder.file', ids, folder: choice ? (choice as FolderId) : null },
        many
          ? `Move ${count} sheets ${choice ? 'to folder' : 'out of folder'}`
          : choice
            ? 'Move to folder'
            : 'Move out of folder',
      )
    onClose()
  }
  return (
    <Dialog
      title={many ? `Move ${count} sheets to a folder` : `Move “${name}” to a folder`}
      onClose={onClose}
      okLabel="Move"
      onOk={ok}
    >
      {ids.length > (count ?? 1) && (
        <p className="hint">
          {many ? 'With their families' : 'With its family'}: {ids.length} sheets move together.
        </p>
      )}
      <fieldset className="folder-choices">
        <legend>Folder</legend>
        {[
          { id: '', label: 'No folder', depth: 0 },
          ...ordered.map((f) => ({ id: f.id, label: f.name, depth: f.parent ? 1 : 0 })),
          { id: '+', label: 'New folder', depth: 0 },
        ].map((o) => (
          <label key={o.id || 'none'} style={{ paddingLeft: o.depth * 16 }}>
            <input
              type="radio"
              name="folder"
              checked={choice === o.id}
              onChange={() => setChoice(o.id)}
            />{' '}
            {o.label}
          </label>
        ))}
      </fieldset>
    </Dialog>
  )
}
