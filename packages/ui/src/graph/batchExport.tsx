import type { AnalysisResult, LayoutNode, NodeId, Project } from '@ps/model'
import { zipSync } from 'fflate'
import type { ReactNode } from 'react'
import { type Command, GROUPS } from '../commands/index.ts'
import type { ModalSlot } from '../components/modals.tsx'
import { useServices } from '../context.tsx'
import type { ExportData, ExportFolder } from '../services.ts'
import { errorMessage } from '../util.ts'
import type { FigureItem } from '../worker/figureCore.ts'
import { type FigureSource, figureExports } from '../worker/figureExport.ts'
import { ExportDialog, type ExportProgress } from './ExportDialog.tsx'
import {
  EXPORT_FORMATS,
  type ExportSettings,
  fileBaseOf,
  uniqueFileNames,
} from './exportSettings.ts'

// Batch export (roadmap 27): File › Export ▸ All graphs… / All layout pages…, with the Export
// dialog's settings for every one. The desktop app writes a file per graph or page into a folder
// the user picks; browsers get one zip file. A graph that fails (too large at the resolution) is
// reported and the rest still exported. Each is laid out and written in the export worker
// (roadmap 42), one after the other.

/** Every graph, every page, or (roadmap 47) the graphs and pages selected in the navigator. */
type BatchKind = 'graphs' | 'pages' | 'figures'

/**
 * The graphs or layout pages of a project, in navigator order, to export; `only`: of these sheets
 * (roadmap 47's Export selected…; `kind` 'figures' takes both).
 */
export function batchItems(
  project: Project,
  kind: BatchKind,
  only?: readonly NodeId[],
): FigureItem[] {
  const among = only ? new Set(only) : null
  return project.order.flatMap((id): FigureItem[] => {
    const node = project.nodes[id]
    if (among && !among.has(id)) return []
    if (kind !== 'pages' && node?.kind === 'graph')
      return [{ name: node.name, target: { kind: 'graph', graph: node.id } }]
    if (kind !== 'graphs' && node?.kind === 'layout')
      return [{ name: node.name, target: { kind: 'page', layout: node as LayoutNode } }]
    return []
  })
}

/** What a batch of items is: graphs, pages, or both. */
const kindOfItems = (items: readonly FigureItem[]): BatchKind =>
  items.every((it) => it.target.kind === 'graph')
    ? 'graphs'
    : items.every((it) => it.target.kind === 'page')
      ? 'pages'
      : 'figures'

/** What a batch export did: files written, and the items that failed with why. */
interface BatchOutcome {
  written: number
  failed: { name: string; error: string }[]
}

/**
 * Renders every item (`render`) and hands each file to `write`, in order; a failure is recorded
 * and the next one tried.
 */
export async function exportEach(
  items: readonly FigureItem[],
  s: ExportSettings,
  render: (item: FigureItem, onProgress: (fraction: number) => void) => Promise<ExportData>,
  write: (fileName: string, data: ExportData) => Promise<void>,
  progress: (p: ExportProgress) => void = () => {},
): Promise<BatchOutcome> {
  const names = uniqueFileNames(
    items.map((it) => it.name),
    EXPORT_FORMATS[s.format].ext,
  )
  const out: BatchOutcome = { written: 0, failed: [] }
  for (const [i, it] of items.entries()) {
    progress({ done: i, total: items.length, current: { name: it.name, fraction: 0 } })
    try {
      const data = await render(it, (fraction) =>
        progress({ done: i, total: items.length, current: { name: it.name, fraction } }),
      )
      await write(names[i]!, data)
      out.written++
    } catch (e) {
      out.failed.push({ name: it.name, error: errorMessage(e) })
    }
  }
  progress({ done: items.length, total: items.length })
  return out
}
/** Already-compressed formats are stored in the zip as they are. */
const STORED = new Set(['pdf', 'png', 'tiff', 'jpeg'])

const encoder = new TextEncoder()

/** The files as one zip. */
export function zipFiles(files: readonly { name: string; data: ExportData }[], store: boolean) {
  return zipSync(
    Object.fromEntries(
      files.map((f) => [
        f.name,
        [typeof f.data === 'string' ? encoder.encode(f.data) : f.data, { level: store ? 0 : 6 }],
      ]),
    ),
  )
}

/** "Exported 3 graphs to Figures." and the failures, one per line. */
export function describeBatch(o: BatchOutcome, kind: BatchKind, where: string): string {
  const noun = (n: number) =>
    `${kind === 'graphs' ? 'graph' : kind === 'pages' ? 'page' : 'figure'}${n === 1 ? '' : 's'}`
  const done = o.written
    ? `Exported ${o.written} ${noun(o.written)} ${where}.`
    : 'Nothing was exported.'
  if (!o.failed.length) return done
  return `${done} Not exported: ${o.failed.map((f) => `“${f.name}” (${f.error})`).join('; ')}`
}

/** The batch open in the dialog: `selected` for the sheets selected in the navigator. */
interface Batch {
  kind: BatchKind
  items: FigureItem[]
  source: FigureSource
  selected?: boolean
}

/** The dialog's title and the export's activity for a batch. */
function batchTitles(b: Batch): { title: string; activity: string } {
  if (b.selected) {
    const what =
      b.kind === 'graphs' ? 'graphs' : b.kind === 'pages' ? 'layout pages' : 'graphs and pages'
    return { title: `Export the selected ${what}`, activity: `Exporting the selected ${what}` }
  }
  return b.kind === 'graphs'
    ? { title: 'Export all graphs', activity: 'Exporting every graph' }
    : { title: 'Export all layout pages', activity: 'Exporting every layout page' }
}

/**
 * File › Export ▸ All graphs… and All layout pages…: the commands and, while one runs, its
 * dialog. `onNotice` gets the outcome; `onError` a failure of the whole export. Roadmap 47:
 * `exportSheets` opens the same dialog for the graphs and pages among some sheets (the
 * navigator's Export selected…).
 */
export function useBatchExport(opts: {
  project: Project
  result: (id: NodeId) => AnalysisResult | undefined
  /** The project's name, for the zip file ("Weights graphs.zip"). */
  projectName: string
  onNotice: (msg: string) => void
  onError: (msg: string) => void
  /** The shell's modal slot (audit 2, U26): the dialog open is held there. */
  slot: <T>(owner: string) => ModalSlot<T>
}): {
  commands: Command[]
  dialog: ReactNode
  exportSheets: (ids: readonly NodeId[]) => void
} {
  const { platform, fonts, assets } = useServices()
  const { open, show: setOpen, close } = opts.slot<Batch>('batchExport')
  const count = (kind: 'graph' | 'layout') =>
    Object.values(opts.project.nodes).filter((n) => n.kind === kind).length

  const run = async (
    { kind, items, source, selected }: Batch,
    s: ExportSettings,
    progress: (p: ExportProgress) => void,
  ) => {
    const render = (it: FigureItem, onProgress: (fraction: number) => void) =>
      figureExports.render(source, it.target, s, { title: it.name, onProgress })
    if (platform.pickFolder) {
      const folder: ExportFolder | null = await platform.pickFolder()
      if (!folder) return
      const outcome = await exportEach(items, s, render, folder.write, progress)
      opts.onNotice(describeBatch(outcome, kind, `to “${folder.name}”`))
      return
    }
    // Browsers: one zip, its location asked for first (the files are made once it is chosen).
    const done: { outcome?: BatchOutcome } = {}
    const what = selected ? 'selected' : kind === 'graphs' ? 'graphs' : 'layouts'
    const zipName = `${fileBaseOf(`${opts.projectName} ${what}`, 'figures')}.zip`
    await platform.exportFile(
      async () => {
        const files: { name: string; data: ExportData }[] = []
        const outcome = await exportEach(
          items,
          s,
          render,
          async (name, data) => {
            files.push({ name, data })
          },
          progress,
        )
        done.outcome = outcome
        if (!files.length) throw new Error(describeBatch(outcome, kind, ''))
        return zipFiles(files, STORED.has(s.format))
      },
      zipName,
      'application/zip',
    )
    if (done.outcome) opts.onNotice(describeBatch(done.outcome, kind, `in ${zipName}`))
  }

  const source = (): FigureSource => ({
    project: opts.project,
    result: opts.result,
    asset: (id) => assets.get(id),
    fonts,
  })
  const show = (kind: BatchKind) =>
    setOpen({ kind, items: batchItems(opts.project, kind), source: source() })
  const exportSheets = (ids: readonly NodeId[]) => {
    const items = batchItems(opts.project, 'figures', ids)
    if (items.length) setOpen({ kind: kindOfItems(items), items, source: source(), selected: true })
  }
  const menu = (order: number) => ({
    menu: 'file' as const,
    group: GROUPS.file.export,
    order,
    submenu: 'Export',
  })
  const commands: Command[] = [
    {
      id: 'file.export.allGraphs',
      label: 'All graphs…',
      menu: menu(70),
      enabled: count('graph') > 0,
      keywords: ['export', 'batch', 'all graphs', 'figures', 'zip', 'folder'],
      hint: 'Export every graph, one file each, with the same format, size and resolution',
      run: () => show('graphs'),
    },
    {
      id: 'file.export.allPages',
      label: 'All layout pages…',
      menu: menu(71),
      enabled: count('layout') > 0,
      keywords: ['export', 'batch', 'all layouts', 'pages', 'figures', 'zip', 'folder'],
      hint: 'Export every layout page, one file each',
      run: () => show('pages'),
    },
  ]
  const titles = open ? batchTitles(open) : null
  const dialog = open && titles && (
    <ExportDialog
      title={titles.title}
      items={open.items}
      source={open.source}
      pages={open.kind === 'pages'}
      {...(open.kind === 'figures' ? { noun: 'graphs and pages' } : {})}
      onRun={(s, progress) =>
        figureExports.exclusive(titles.activity, () => run(open, s, progress), { status: false })
      }
      onError={(e) => opts.onError(`Export failed: ${e}`)}
      onClose={close}
    />
  )
  return { commands, dialog, exportSheets }
}
