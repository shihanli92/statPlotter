import { type AssetStore, templateOf } from '@ps/engine'
import { ProjectFileError, readProjectFile, TEMPLATE_EXTENSION, writeProjectFile } from '@ps/io'
import { createProject, type Project } from '@ps/model'
import { useCallback, useEffect, useState } from 'react'
import { Dialog } from '../components/Dialog.tsx'
import { Field } from '../components/fields.tsx'
import { useConfirm } from '../components/modals.tsx'
import { useServices } from '../context.tsx'
import type { LibraryEntry } from '../services.ts'
import { errorMessage } from '../util.ts'

// Project templates (roadmap 31): File › Save as template… keeps the project without its data
// values (tables with their titles, formats and rows; analyses, graphs and layouts; no results);
// File › New from template… opens one as a new untitled project, so Save asks for a new file.

/** A template file's bytes for a project, with the images its pages place. */
export const templateBytes = (project: Project, assets: AssetStore) =>
  writeProjectFile(templateOf(project), {
    template: true,
    assets: assets.referenced(project),
  })

/**
 * File › Save as template… . Desktop: into the templates folder (listed by New from template);
 * web: a download, remembered in this browser's recent templates too.
 */
export function SaveTemplateDialog({
  defaultName,
  onClose,
  onDone,
}: {
  defaultName: string
  onClose: () => void
  onDone: (msg: string) => void
}) {
  const { store, platform, assets } = useServices()
  const confirm = useConfirm()
  const [name, setName] = useState(defaultName)
  const desktop = platform.kind === 'desktop'
  const save = async () => {
    const n = name.trim()
    try {
      const bytes = templateBytes(store.getState(), assets)
      if (desktop && platform.templates) {
        const taken = (await platform.templates.list()).some((e) => e.name === n)
        if (taken && !(await confirm({ title: `Replace the template “${n}”?`, ok: 'Replace' })))
          return
        await platform.templates.write(n, bytes)
        onDone(`Saved the template “${n}”. Start from it with File › New from template….`)
      } else {
        await platform.exportFile(bytes, `${n}.${TEMPLATE_EXTENSION}`, 'application/octet-stream')
        await platform.templates?.write(n, bytes).catch(() => {})
      }
      onClose()
    } catch (e) {
      onDone(`Couldn’t save the template: ${errorMessage(e)}`)
    }
  }
  return (
    <Dialog
      title="Save as template"
      onClose={onClose}
      okLabel={desktop ? 'Save' : 'Save…'}
      okDisabled={!name.trim()}
      onOk={() => void save()}
    >
      <p className="muted">
        A template keeps the tables (titles, formats and rows, without their values), the analyses,
        graphs and layouts, ready for the next experiment’s data.
      </p>
      <Field label="Template name">
        {(id) => (
          <input id={id} type="text" value={name} onChange={(e) => setName(e.target.value)} />
        )}
      </Field>
    </Dialog>
  )
}

/**
 * File › New from template… : the templates kept (desktop: the templates folder; web: recent
 * ones), or Browse… for a template file. `onOpen` replaces the project (asking about unsaved
 * changes) and returns whether it did.
 */
export function NewFromTemplateDialog({
  onClose,
  onOpen,
  onError,
}: {
  onClose: () => void
  onOpen: (project: Project) => Promise<boolean>
  onError: (msg: string) => void
}) {
  const { platform, assets } = useServices()
  const confirm = useConfirm()
  const library = platform.templates
  const [entries, setEntries] = useState<LibraryEntry[]>([])
  const [chosen, setChosen] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    if (library) setEntries(await library.list().catch(() => []))
  }, [library])
  useEffect(() => {
    void refresh()
  }, [refresh])

  const open = async (bytes: Uint8Array) => {
    try {
      const { project, assets: images } = readProjectFile(bytes)
      // A new project: untitled, made now, with the template's images.
      if (!(await onOpen({ ...project, meta: createProject().meta }))) return
      assets.replace(images.values())
      onClose()
    } catch (e) {
      onError(
        e instanceof ProjectFileError
          ? e.message
          : `Couldn’t open the template: ${errorMessage(e)}`,
      )
    }
  }
  const openChosen = async () => {
    if (!library || !chosen) return
    const bytes = await library.read(chosen).catch(() => null)
    if (bytes) await open(bytes)
    else onError(`The template “${chosen}” is no longer there.`)
  }
  const browse = async () => {
    try {
      const file = await platform.openFile('Template', [TEMPLATE_EXTENSION])
      if (!file) return
      // The web remembers templates opened, for next time.
      if (platform.kind === 'web') {
        const name = file.name.replace(new RegExp(`\\.${TEMPLATE_EXTENSION}$`, 'i'), '')
        await library?.write(name, file.bytes).catch(() => {})
      }
      await open(file.bytes)
    } catch (e) {
      onError(`Couldn’t open the template: ${errorMessage(e)}`)
    }
  }
  const remove = async (name: string) => {
    if (
      !library ||
      !(await confirm({ title: `Remove the template “${name}” from this list?`, ok: 'Remove' }))
    )
      return
    await library.remove(name).catch((e) => onError(errorMessage(e)))
    if (chosen === name) setChosen(null)
    await refresh()
  }

  return (
    <Dialog
      title="New from template"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={() => void browse()}>
            Browse…
          </button>
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={!chosen}
            onClick={() => void openChosen()}
          >
            Open
          </button>
        </>
      }
    >
      {entries.length ? (
        <ul className="recovery-list" aria-label="Templates">
          {entries.map((e) => (
            <li key={e.name}>
              <button
                type="button"
                className={`list-item ${e.name === chosen ? 'on' : ''}`}
                aria-pressed={e.name === chosen}
                onClick={() => setChosen(e.name)}
                onDoubleClick={() => {
                  setChosen(e.name)
                  void library?.read(e.name).then((b) => b && open(b))
                }}
              >
                {e.name}
                {e.modified !== undefined && (
                  <span> · {new Date(e.modified).toLocaleDateString()}</span>
                )}
              </button>
              <button
                type="button"
                aria-label={`Remove ${e.name}`}
                title="Remove from the list"
                onClick={() => void remove(e.name)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">
          {platform.kind === 'desktop'
            ? 'No templates yet: save one with File › Save as template…, or browse for a template file.'
            : 'No recent templates in this browser: browse for a template file (.pstemplate).'}
        </p>
      )}
    </Dialog>
  )
}
