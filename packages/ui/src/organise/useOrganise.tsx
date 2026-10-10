import { ProjectFileError, readProjectFile } from '@ps/io'
import {
  type AssetId,
  createInfoSheet,
  type ImageAsset,
  INFO_TEMPLATES,
  type NodeId,
  newNodeId,
  type Project,
} from '@ps/model'
import type { ReactNode } from 'react'
import { type Command, GROUPS } from '../commands/index.ts'
import { Dialog } from '../components/Dialog.tsx'
import { lazyComponent } from '../components/lazy.tsx'
import type { ModalSlot } from '../components/modals.tsx'
import { useServices } from '../context.tsx'
import { errorMessage } from '../util.ts'

// The Gallery and the import's dialog load when first shown (audit 2, P8).
const Gallery = lazyComponent(() => import('./Gallery.tsx').then((m) => m.Gallery))
const MergeDialog = lazyComponent(() => import('./MergeDialog.tsx').then((m) => m.MergeDialog))

// Roadmap 40's app commands: Insert › Info sheet ▸ (templates), File › Import from project…,
// View › Gallery, and the question a project dropped on an open one asks.

type Open =
  | { kind: 'gallery' }
  | {
      kind: 'merge'
      fileName: string
      source: Project
      assets: ReadonlyMap<AssetId, ImageAsset>
    }
  | {
      kind: 'openOrImport'
      file: { name: string; bytes: Uint8Array; handle: unknown }
    }

/** An info sheet's name: "Info", "Info 2"… (or the template's: "Experiment", "Experiment 2"…). */
function infoName(project: Project, base: string): string {
  const taken = new Set(Object.values(project.nodes).map((n) => n.name.toLowerCase()))
  if (!taken.has(base.toLowerCase())) return base
  for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`
}

export function useOrganise(opts: {
  onSelect: (id: NodeId) => void
  onMessage: (msg: string) => void
  /** What was done (graphs added to a page, sheets imported): a passing message. */
  onNotice: (msg: string) => void
  /** Opens a project file in place of this one (asking about unsaved changes). */
  openFile: (file: { name: string; bytes: Uint8Array; handle: unknown }) => void
  applyStyle: (graphs: NodeId[]) => void
  /** The shell's modal slot (audit 2, U26): the dialog open is held there. */
  slot: <T>(owner: string) => ModalSlot<T>
}): {
  commands: Command[]
  dialog: ReactNode
  /**
   * Starts an import of a project file into this one (the dialog of its sheets); false if the
   * file couldn't be read (the message shown, no dialog opened).
   */
  importFile: (file: { name: string; bytes: Uint8Array }) => boolean
  /** A project dropped on an open one: open it or import from it (asked). */
  askOpenOrImport: (file: { name: string; bytes: Uint8Array; handle: unknown }) => void
} {
  const { store, platform } = useServices()
  const { open, show: setOpen, close } = opts.slot<Open>('organise')

  const importFile = (file: { name: string; bytes: Uint8Array }): boolean => {
    try {
      const { project, assets } = readProjectFile(file.bytes)
      setOpen({ kind: 'merge', fileName: file.name, source: project, assets })
      return true
    } catch (e) {
      opts.onMessage(
        e instanceof ProjectFileError
          ? e.message
          : `Couldn’t read ${file.name}: ${errorMessage(e)}`,
      )
      return false
    }
  }

  const addInfo = (template: string) => {
    const t = INFO_TEMPLATES.find((x) => x.id === template)
    const doc = store.getState()
    const sheet = createInfoSheet(
      newNodeId(),
      infoName(doc, t && t.id !== 'blank' ? t.name : 'Info'),
      template,
    )
    // Info sheets go after the last one (else first: they describe the project).
    const lastInfo = doc.order.findLastIndex((id) => doc.nodes[id]?.kind === 'info')
    store.dispatch({ type: 'node.add', node: sheet, at: lastInfo + 1 }, 'New info sheet')
    opts.onSelect(sheet.id)
  }

  const commands: Command[] = [
    ...INFO_TEMPLATES.map(
      (t, i): Command => ({
        id: `insert.info.${t.id}`,
        label: t.id === 'blank' ? 'Blank' : `${t.name}`,
        menu: {
          menu: 'insert',
          group: GROUPS.insert.sheets,
          order: 50 + i / 10,
          submenu: 'Info sheet',
        },
        hint: t.labels.length
          ? `An info sheet with ${t.labels.join(', ')}`
          : 'An info sheet with no fields yet',
        keywords: ['info', 'experiment', 'metadata', 'notes', 'constants'],
        run: () => addInfo(t.id),
      }),
    ),
    {
      id: 'file.importProject',
      label: 'Import from project…',
      menu: { menu: 'file', group: GROUPS.file.import, order: 20 },
      hint: 'Sheets of another project (with their families) into this one',
      keywords: ['merge', 'combine', 'project', 'psproj'],
      run: async () => {
        try {
          const file = await platform.openProject()
          if (file) importFile(file)
        } catch (e) {
          opts.onMessage(`Couldn’t open the project: ${errorMessage(e)}`)
        }
      },
    },
    {
      id: 'view.gallery',
      label: 'Gallery',
      menu: { menu: 'view', group: GROUPS.view.panels, order: 30 },
      hint: 'Every graph and layout as a thumbnail',
      keywords: ['thumbnails', 'overview', 'graphs', 'pictures'],
      run: () => setOpen({ kind: 'gallery' }),
    },
  ]

  let dialog: ReactNode = null
  if (open?.kind === 'gallery')
    dialog = (
      <Gallery
        onOpen={(id) => {
          close()
          opts.onSelect(id)
        }}
        onClose={close}
        onApplyStyle={(graphs) => {
          close()
          opts.applyStyle(graphs)
        }}
        onMessage={opts.onNotice}
      />
    )
  else if (open?.kind === 'merge')
    dialog = (
      <MergeDialog
        fileName={open.fileName}
        source={open.source}
        assets={open.assets}
        onClose={close}
        onDone={(first, message) => {
          close()
          if (first) opts.onSelect(first)
          if (message) opts.onNotice(message)
        }}
        onError={opts.onMessage}
      />
    )
  else if (open?.kind === 'openOrImport') {
    const file = open.file
    dialog = (
      <Dialog
        title={`Open ${file.name}?`}
        onClose={close}
        footer={
          <>
            <button type="button" onClick={close}>
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                close()
                importFile(file)
              }}
            >
              Import into this project…
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => {
                close()
                opts.openFile(file)
              }}
            >
              Open
            </button>
          </>
        }
      >
        <p>
          Open the project in place of this one, or import some of its sheets into this project?
          (Hold Alt or Shift while dropping to import straight away.)
        </p>
      </Dialog>
    )
  }

  return {
    commands,
    dialog,
    importFile,
    askOpenOrImport: (file) => setOpen({ kind: 'openOrImport', file }),
  }
}
