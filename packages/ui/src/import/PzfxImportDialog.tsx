import { createGraphFor } from '@ps/graph'
import { ImportError, importFile, type PzfxGraphImport, type PzfxGraphReport } from '@ps/io'
import type { DataTable, NodeId, TableKind } from '@ps/model'
import { useMemo, useState } from 'react'
import { Dialog } from '../components/Dialog.tsx'
import { Checkbox } from '../components/fields.tsx'
import { useServices } from '../context.tsx'
import { errorMessage } from '../util.ts'

// Importing a .pzfx project (roadmap 39): its tables as before, and with "Import graphs"
// its graphs, each drawn from what decodes (`readPzfx` with graphs) or its table's default graph,
// then a report of what was matched and what is the default.

const KIND_NAMES: Record<TableKind, string> = {
  column: 'column',
  xy: 'XY',
  grouped: 'grouped',
  contingency: 'contingency',
  survival: 'survival',
  partsOfWhole: 'parts of whole',
  multipleVariables: 'multiple variables',
  nested: 'nested',
}

/** "5 XY tables, 2 grouped tables" */
function describeTables(tables: readonly DataTable[]): string {
  const counts = new Map<string, number>()
  for (const t of tables) {
    const k = KIND_NAMES[t.tableKind]
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  return [...counts].map(([k, n]) => `${n} ${k} ${n === 1 ? 'table' : 'tables'}`).join(', ')
}

/** "7 graphs: 7 drawn from the file's settings" */
export function describeGraphs(g: PzfxGraphImport): string {
  if (!g.found) return 'No graphs.'
  const parts = [`${g.decoded} drawn from the file’s settings`]
  const def = g.report.filter((r) => r.status === 'default').length
  const skipped = g.report.filter((r) => r.status === 'skipped').length
  if (def) parts.push(`${def} as the table’s default graph`)
  if (skipped) parts.push(`${skipped} not imported`)
  return `${g.found} ${g.found === 1 ? 'graph' : 'graphs'}: ${parts.join(', ')}.`
}

interface PzfxRead {
  tables: DataTable[]
  warnings: string[]
  graphs?: PzfxGraphImport
}

export function PzfxImportDialog({
  fileName,
  bytes,
  onClose,
  onCreated,
  onWarnings,
}: {
  fileName: string
  bytes: Uint8Array
  onClose: () => void
  onCreated: (id: NodeId) => void
  onWarnings: (msg: string) => void
}) {
  const { store } = useServices()
  const read = useMemo((): { ok: PzfxRead } | { error: string } => {
    try {
      const file = importFile(fileName, bytes, { graphs: true })
      if (file.kind !== 'tables') throw new ImportError('Not an XML project (.pzfx) file.')
      if (!file.tables.length)
        throw new ImportError('The file has no data tables this app can read.')
      return { ok: file }
    } catch (e) {
      return { error: e instanceof ImportError ? e.message : `Import failed: ${errorMessage(e)}` }
    }
  }, [fileName, bytes])
  const graphs = 'ok' in read ? read.ok.graphs : undefined
  const [withGraphs, setWithGraphs] = useState(() => (graphs?.decoded ?? 0) > 0)
  const [report, setReport] = useState<PzfxGraphReport[] | null>(null)

  const create = () => {
    if (!('ok' in read)) return
    const { tables, warnings } = read.ok
    const added =
      withGraphs && graphs
        ? graphs.graphs.map(({ graph, tableIndex }) => ({ graph, table: tables[tableIndex]! }))
        : tables.map((t) => ({ graph: createGraphFor(t, t.name), table: t }))
    store.dispatch(
      [
        ...tables.map((t) => ({ type: 'node.add' as const, node: t })),
        ...added.map(({ graph }) => ({ type: 'node.add' as const, node: graph, fresh: true })),
      ],
      `Import ${fileName}`,
    )
    onCreated(tables[0]!.id)
    const notes = withGraphs
      ? warnings.filter((w) => !/^Not imported: |graphs and layouts/.test(w))
      : warnings
    if (withGraphs && graphs?.layouts)
      notes.push(`${graphs.layouts} ${graphs.layouts === 1 ? 'layout' : 'layouts'} not imported.`)
    if (notes.length) onWarnings(notes.join(' '))
    if (withGraphs && graphs?.report.length) setReport(graphs.report)
    else onClose()
  }

  if (report) return <PzfxReportDialog fileName={fileName} report={report} onClose={onClose} />
  return (
    <Dialog
      title={`Import “${fileName}”`}
      onClose={onClose}
      okLabel="Import"
      onOk={create}
      okDisabled={!('ok' in read)}
    >
      {'ok' in read ? (
        <>
          <p>{describeTables(read.ok.tables)}.</p>
          {graphs && (
            <>
              <p className="muted">
                {describeGraphs(graphs)}
                {graphs.problem ? ` The file’s graphs couldn’t be read: ${graphs.problem}.` : ''}
              </p>
              <Checkbox label="Import graphs" checked={withGraphs} onChange={setWithGraphs} />
              <p className="muted">
                {withGraphs
                  ? 'Titles, axis titles and ranges, data sets, colours and symbols are taken from the file where they could be read; the kind of graph and error bars are each table’s default. A report follows.'
                  : 'Each table gets its default graph, as New graph makes.'}
              </p>
            </>
          )}
        </>
      ) : (
        <p className="error-text">{read.error}</p>
      )}
    </Dialog>
  )
}

/** What became of each of the file's graphs. */
function PzfxReportDialog({
  fileName,
  report,
  onClose,
}: {
  fileName: string
  report: readonly PzfxGraphReport[]
  onClose: () => void
}) {
  const label = { decoded: 'Read', default: 'Default graph', skipped: 'Not imported' }
  return (
    <Dialog
      title={`Graphs in “${fileName}”`}
      onClose={onClose}
      wide
      footer={
        <button type="button" className="primary" onClick={onClose}>
          Done
        </button>
      }
    >
      <ul className="import-report" aria-label="Graph report">
        {report.map((r, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: graphs may share names
          <li key={i}>
            <strong>{r.name}</strong>
            {r.table && r.table !== r.name ? ` (of “${r.table}”)` : ''} — {label[r.status]}
            {r.matched.length > 0 && <div>From the file: {r.matched.join(', ')}.</div>}
            {r.defaulted.length > 0 && (
              <div className="defaulted">
                {r.status === 'decoded' ? 'Default: ' : ''}
                {r.defaulted.join(', ')}.
              </div>
            )}
          </li>
        ))}
      </ul>
    </Dialog>
  )
}
