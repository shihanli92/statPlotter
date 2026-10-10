import { presetFits } from '@ps/graph'
import {
  PRESET_EXTENSION,
  PRESET_NAME_MAX,
  type PresetRecipe,
  presetNameProblem,
  type TableKind,
  type UserPreset,
} from '@ps/model'
import { useId, useState } from 'react'
import { Dialog, NoticeDialog } from '../../components/Dialog.tsx'
import { Field } from '../../components/fields.tsx'
import { useConfirm } from '../../components/modals.tsx'
import { useServices } from '../../context.tsx'
import { errorMessage } from '../../util.ts'
import {
  deletePreset,
  exportPreset,
  importPreset,
  movePreset,
  renamePreset,
  savePreset,
  setDefaultPreset,
  usePresetLibrary,
} from './userPresetStore.ts'

// Save as preset… and Manage presets… (roadmap 33c, decisions 255–256): the user's layer stacks,
// kept in their library and offered first in the graph builder's presets row.

const KIND_NOUNS: Record<TableKind, string> = {
  column: 'column',
  grouped: 'grouped',
  xy: 'XY',
  contingency: 'contingency',
  survival: 'survival',
  partsOfWhole: 'parts-of-whole',
  multipleVariables: 'multiple-variables',
  nested: 'nested',
}

/** "column tables", "XY tables". */
const kindTables = (kind: TableKind) => `${KIND_NOUNS[kind]} tables`

/** The kinds of table a preset fits besides its own ("also nested tables"). */
function alsoFits(recipe: PresetRecipe): string {
  const others = (Object.keys(KIND_NOUNS) as TableKind[]).filter(
    (k) => k !== recipe.tableKind && presetFits(recipe, k),
  )
  return others.length ? `; also ${others.map((k) => KIND_NOUNS[k]).join(', ')}` : ''
}

/** Saves a layer stack as a preset: a name (checked as typed), and whether it is the default. */
export function SavePresetDialog({
  recipe,
  onClose,
  onSaved,
}: {
  recipe: PresetRecipe
  onClose: () => void
  /** Saved: a message for the user. */
  onSaved?: (preset: UserPreset, message: string) => void
}) {
  const { library, presets } = usePresetLibrary()
  const [name, setName] = useState('')
  const [isDefault, setIsDefault] = useState(false)
  const [tried, setTried] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const errorId = useId()
  if (!library)
    return (
      <NoticeDialog
        title="Save as preset"
        message="Presets can’t be kept on this platform."
        onClose={onClose}
      />
    )
  const problem = presetNameProblem(
    name,
    presets.map((p) => p.name),
  )
  const shown = (tried || name.trim() ? problem : null) ?? error
  const save = async () => {
    setTried(true)
    if (problem) return
    try {
      const p = await savePreset(library, name, recipe, { isDefault })
      onSaved?.(p, `Saved the preset “${p.name}”: it comes first in the graph builder’s presets.`)
      onClose()
    } catch (e) {
      setError(`Couldn’t save the preset: ${errorMessage(e)}`)
    }
  }
  const n = recipe.layers.length
  return (
    <Dialog title="Save as preset" onClose={onClose} okLabel="Save" onOk={() => void save()}>
      <p className="muted">
        Keeps the {n} layer{n === 1 ? '' : 's'} with their statistics, positions and styles, the
        orientation and drawing order, for {kindTables(recipe.tableKind)}
        {alsoFits(recipe)}. Not kept: titles, axis ranges, brackets and annotations, labels, single
        points and each data set’s own formats.
      </p>
      <Field label="Preset name">
        {(id) => (
          <input
            id={id}
            type="text"
            maxLength={PRESET_NAME_MAX + 20}
            value={name}
            aria-invalid={!!shown}
            aria-describedby={shown ? errorId : undefined}
            onChange={(e) => {
              setName(e.target.value)
              setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void save()
              }
            }}
            autoFocus
          />
        )}
      </Field>
      {shown && (
        <p id={errorId} className="error-text" role="alert">
          {shown}
        </p>
      )}
      <label className="check field">
        <input
          type="checkbox"
          checked={isDefault}
          onChange={(e) => setIsDefault(e.target.checked)}
        />
        Use as default for {kindTables(recipe.tableKind)}
      </label>
    </Dialog>
  )
}

/**
 * The user's presets: rename, delete, reorder, a table kind's default, export to a `.pspreset`
 * file and import one.
 */
export function ManagePresetsDialog({ onClose }: { onClose: () => void }) {
  const { platform } = useServices()
  const { library, presets, loaded } = usePresetLibrary()
  const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(null)
  const confirm = useConfirm()
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const id = useId()
  if (!library)
    return (
      <NoticeDialog
        title="Manage presets"
        message="Presets can’t be kept on this platform."
        onClose={onClose}
      />
    )
  const fail = (what: string) => (e: unknown) =>
    setMessage({ text: `${what}: ${errorMessage(e)}`, error: true })
  const run = (p: Promise<unknown>, what: string) => {
    setMessage(null)
    p.catch(fail(what))
  }
  const renameProblem = renaming
    ? presetNameProblem(
        renaming.to,
        presets.filter((p) => p.name !== renaming.from).map((p) => p.name),
      )
    : null
  const commitRename = async () => {
    if (!renaming || renameProblem) return
    try {
      await renamePreset(library, renaming.from, renaming.to)
      setRenaming(null)
    } catch (e) {
      fail('Couldn’t rename the preset')(e)
    }
  }
  const importFile = async () => {
    setMessage(null)
    try {
      const file = await platform.openFile('Graph preset', [PRESET_EXTENSION])
      if (!file) return
      const p = await importPreset(library, new TextDecoder().decode(file.bytes))
      setMessage({ text: `Imported the preset “${p.name}”.`, error: false })
    } catch (e) {
      fail('Couldn’t import the preset')(e)
    }
  }
  const exportFile = (p: UserPreset) =>
    run(
      platform.exportFile(exportPreset(p), `${p.name}.${PRESET_EXTENSION}`, 'application/json'),
      'Couldn’t export the preset',
    )

  return (
    <Dialog
      title="Manage presets"
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" onClick={() => void importFile()}>
            Import…
          </button>
          <span className="spacer" />
          <button type="button" className="primary" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <p className="muted">
        Your presets come first in the graph builder, for the tables they fit. Deleting one can’t be
        undone; graphs made with it keep their layers.
      </p>
      {loaded && presets.length === 0 && (
        <p className="muted">
          No presets yet: use Save as preset… in the graph builder, or Format › Layers ▸ Save layers
          as preset….
        </p>
      )}
      <ul className="preset-list" aria-label="Your presets">
        {presets.map((p, i) => (
          <li key={p.name} className="preset-row" aria-label={p.name}>
            {renaming?.from === p.name ? (
              <div className="preset-rename">
                <label htmlFor={`${id}-rename`} className="visually-hidden">
                  New name for {p.name}
                </label>
                <input
                  id={`${id}-rename`}
                  type="text"
                  value={renaming.to}
                  aria-invalid={!!renameProblem}
                  aria-describedby={renameProblem ? `${id}-rename-why` : undefined}
                  onChange={(e) => setRenaming({ from: p.name, to: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void commitRename()
                    else if (e.key === 'Escape') {
                      e.preventDefault()
                      e.stopPropagation()
                      setRenaming(null)
                    }
                  }}
                  autoFocus
                />
                <button
                  type="button"
                  disabled={!!renameProblem}
                  onClick={() => void commitRename()}
                >
                  Save name
                </button>
                <button type="button" onClick={() => setRenaming(null)}>
                  Cancel
                </button>
                {renameProblem && (
                  <span id={`${id}-rename-why`} className="error-text" role="alert">
                    {renameProblem}
                  </span>
                )}
              </div>
            ) : (
              <span className="preset-name">
                <span className="user-mark" aria-hidden="true">
                  ★
                </span>{' '}
                {p.name}
                <span className="muted">
                  {' '}
                  · {kindTables(p.recipe.tableKind)} · {p.recipe.layers.length} layer
                  {p.recipe.layers.length === 1 ? '' : 's'}
                </span>
              </span>
            )}
            <label className="check">
              <input
                type="checkbox"
                checked={!!p.isDefault}
                onChange={(e) =>
                  run(setDefaultPreset(library, p.name, e.target.checked), 'Couldn’t change it')
                }
              />
              Use as default for {kindTables(p.recipe.tableKind)}
            </label>
            <span className="preset-buttons">
              <button
                type="button"
                aria-label={`Move ${p.name} up`}
                disabled={i === 0}
                onClick={() => run(movePreset(library, p.name, -1), 'Couldn’t move it')}
              >
                ↑
              </button>
              <button
                type="button"
                aria-label={`Move ${p.name} down`}
                disabled={i === presets.length - 1}
                onClick={() => run(movePreset(library, p.name, 1), 'Couldn’t move it')}
              >
                ↓
              </button>
              <button
                type="button"
                aria-label={`Rename ${p.name}`}
                onClick={() => setRenaming({ from: p.name, to: p.name })}
              >
                Rename
              </button>
              <button type="button" aria-label={`Export ${p.name}`} onClick={() => exportFile(p)}>
                Export…
              </button>
              <button
                type="button"
                className="danger"
                aria-label={`Delete ${p.name}`}
                onClick={async () => {
                  const yes = await confirm({
                    title: `Delete “${p.name}” for good?`,
                    message: 'This can’t be undone.',
                    ok: 'Delete',
                    danger: true,
                  })
                  if (yes) run(deletePreset(library, p.name), 'Couldn’t delete the preset')
                }}
              >
                Delete
              </button>
            </span>
          </li>
        ))}
      </ul>
      {message && (
        <p
          className={message.error ? 'error-text' : 'muted'}
          role={message.error ? 'alert' : 'status'}
        >
          {message.text}
        </p>
      )}
    </Dialog>
  )
}
