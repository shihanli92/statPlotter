import type { NodeId, Project } from '@ps/model'
import type { ReactNode } from 'react'
import { type Command, GROUPS } from '../commands/index.ts'
import { lazyComponent } from '../components/lazy.tsx'
import type { ModalSlot } from '../components/modals.tsx'
import { useDoc } from '../context.tsx'
import { linkedSheets } from '../linkedSheets.ts'

// Reusing analyses (roadmap 31): the commands and dialogs for duplicating a family, applying a
// table's analyses and graphs to other tables, methods, templates, New graph like this and the
// table's entry format. The shell registers the commands and renders the dialog.

// The dialogs load when first shown (audit 2, P8).
const ApplyMethodDialog = lazyComponent(() =>
  import('./ApplyDialog.tsx').then((m) => m.ApplyMethodDialog),
)
const ApplyToTablesDialog = lazyComponent(() =>
  import('./ApplyDialog.tsx').then((m) => m.ApplyToTablesDialog),
)
const DuplicateFamilyDialog = lazyComponent(() =>
  import('./DuplicateFamilyDialog.tsx').then((m) => m.DuplicateFamilyDialog),
)
const NewGraphLikeDialog = lazyComponent(() =>
  import('./NewGraphLikeDialog.tsx').then((m) => m.NewGraphLikeDialog),
)
const SaveMethodDialog = lazyComponent(() =>
  import('./SaveMethodDialog.tsx').then((m) => m.SaveMethodDialog),
)
const TableFormatDialog = lazyComponent(() =>
  import('./TableFormatDialog.tsx').then((m) => m.TableFormatDialog),
)
const NewFromTemplateDialog = lazyComponent(() =>
  import('./TemplateDialogs.tsx').then((m) => m.NewFromTemplateDialog),
)
const SaveTemplateDialog = lazyComponent(() =>
  import('./TemplateDialogs.tsx').then((m) => m.SaveTemplateDialog),
)

type Open =
  | {
      kind: 'duplicateFamily' | 'applyTo' | 'saveMethod' | 'applyMethod' | 'tableFormat'
      table: NodeId
    }
  | { kind: 'graphLike'; graph: NodeId }
  | { kind: 'saveTemplate' | 'newFromTemplate' }

export function useReuse(opts: {
  selected: NodeId | null
  onSelect: (id: NodeId) => void
  /** A message for the user (a toast). */
  onMessage: (msg: string) => void
  /** What was done (a method or template saved): a passing message. */
  onNotice: (msg: string) => void
  /**
   * Replaces the project with a new untitled one, asking about unsaved changes first: whether it
   * did.
   */
  openProject: (project: Project) => Promise<boolean>
  fileName: string | null
  /** The shell's modal slot (audit 2, U26): the dialog open is held there. */
  slot: <T>(owner: string) => ModalSlot<T>
}): { commands: Command[]; dialog: ReactNode; newFromTemplate: () => void } {
  const project = useDoc((d) => d)
  const { open, show: setOpen, close } = opts.slot<Open>('reuse')
  const node = opts.selected ? project.nodes[opts.selected] : undefined
  // The data table of the selected sheet's family (the sheet itself for a table).
  const upstream = opts.selected ? linkedSheets(project, opts.selected).table : undefined
  const table = node?.kind === 'table' ? node : upstream ? project.nodes[upstream] : undefined
  const tableId = table?.kind === 'table' ? table.id : null
  const tableName = table ? `“${table.name}”` : 'a data table'
  const graphOfTable =
    node?.kind === 'graph' && project.nodes[node.seriesSource.table]?.kind === 'table' ? node : null
  const onTable = (kind: Extract<Open, { table: NodeId }>['kind']) => () =>
    tableId && setOpen({ kind, table: tableId })
  const reuse = (order: number) => ({
    menu: 'analyze' as const,
    group: GROUPS.analyze.reuse,
    order,
  })

  const commands: Command[] = [
    {
      id: 'file.newFromTemplate',
      label: 'New from template…',
      menu: { menu: 'file', group: GROUPS.file.open, order: 15 },
      keywords: ['template'],
      hint: 'A new project from a template: its tables (without values), analyses, graphs and layouts',
      run: () => setOpen({ kind: 'newFromTemplate' }),
    },
    {
      id: 'file.saveTemplate',
      label: 'Save as template…',
      menu: { menu: 'file', group: GROUPS.file.save, order: 30 },
      enabled: project.order.length > 0,
      keywords: ['template'],
      hint: 'Save the project without its data values, to start the next experiment from',
      run: () => setOpen({ kind: 'saveTemplate' }),
    },
    {
      id: 'edit.duplicateFamily',
      label: 'Duplicate family…',
      menu: { menu: 'edit', group: GROUPS.edit.sheet, order: 25 },
      enabled: node?.kind === 'table',
      keywords: ['copy', 'family', 'duplicate'],
      hint: 'Copy the data table with its analyses, graphs and layouts',
      run: onTable('duplicateFamily'),
    },
    {
      id: 'analyze.applyTo',
      label: 'Apply analyses and graphs to…',
      menu: reuse(10),
      enabled: !!tableId,
      keywords: ['reuse', 'apply', 'same analysis', 'other tables'],
      hint: `Make the analyses and graphs of ${tableName} for other tables of the same kind`,
      run: onTable('applyTo'),
    },
    {
      id: 'analyze.saveMethod',
      label: 'Save as method…',
      menu: reuse(20),
      enabled: !!tableId,
      keywords: ['method', 'recipe', 'reuse'],
      hint: `Keep the analyses and graphs of ${tableName} to apply to other tables and projects`,
      run: onTable('saveMethod'),
    },
    {
      id: 'analyze.applyMethod',
      label: 'Apply method…',
      menu: reuse(30),
      enabled: !!tableId,
      keywords: ['method', 'recipe', 'reuse', 'import'],
      hint: 'Make a saved method’s analyses and graphs for a table',
      run: onTable('applyMethod'),
    },
    {
      id: 'insert.graphLike',
      label: 'New graph like this…',
      menu: { menu: 'insert', group: GROUPS.insert.sheets, order: 25 },
      enabled: !!graphOfTable,
      keywords: ['next experiment', 'empty', 'copy graph'],
      hint: graphOfTable
        ? 'An empty table like this graph’s, with a copy of the graph on it'
        : 'Open a graph of a data table first',
      run: () => graphOfTable && setOpen({ kind: 'graphLike', graph: graphOfTable.id }),
    },
    {
      id: 'format.tableFormat',
      label: 'Change table format…',
      menu: { menu: 'format', group: GROUPS.format.table, order: 20 },
      enabled: node?.kind === 'table',
      keywords: ['replicates', 'mean sd n', 'sem', 'summary', 'entry format'],
      hint: 'Replicates or summary data (mean with SD, SEM or CV and N), converting the values',
      run: onTable('tableFormat'),
    },
  ]

  const common = { onClose: close, onError: opts.onMessage }
  let dialog: ReactNode = null
  if (open && 'table' in open && project.nodes[open.table]?.kind === 'table') {
    const t = open.table
    const created = { ...common, tableId: t, onCreated: opts.onSelect }
    if (open.kind === 'duplicateFamily') dialog = <DuplicateFamilyDialog {...created} />
    if (open.kind === 'applyTo') dialog = <ApplyToTablesDialog {...created} />
    if (open.kind === 'applyMethod') dialog = <ApplyMethodDialog {...created} />
    if (open.kind === 'saveMethod')
      dialog = <SaveMethodDialog tableId={t} onClose={close} onDone={opts.onNotice} />
    if (open.kind === 'tableFormat') dialog = <TableFormatDialog {...common} tableId={t} />
  } else if (open?.kind === 'graphLike' && project.nodes[open.graph])
    dialog = <NewGraphLikeDialog {...common} graphId={open.graph} onCreated={opts.onSelect} />
  else if (open?.kind === 'saveTemplate')
    dialog = (
      <SaveTemplateDialog
        defaultName={(opts.fileName ?? project.meta.title).replace(/\.psproj$/i, '')}
        onClose={close}
        onDone={opts.onNotice}
      />
    )
  else if (open?.kind === 'newFromTemplate')
    dialog = <NewFromTemplateDialog {...common} onOpen={opts.openProject} />

  return { commands, dialog, newFromTemplate: () => setOpen({ kind: 'newFromTemplate' }) }
}
