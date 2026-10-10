import { newGraphLike } from '@ps/engine'
import { type DataTable, type GraphNode, graphAnalyses, type NodeId } from '@ps/model'
import { useState } from 'react'
import { Dialog } from '../components/Dialog.tsx'
import { Field } from '../components/fields.tsx'
import { useDoc, useServices } from '../context.tsx'
import { errorMessage } from '../util.ts'
import { countNodes, nextInSeries } from './names.ts'

/**
 * Insert › New graph like this… (roadmap 31): an empty table like the graph's (kind, format,
 * titles and rows, no values) with a copy of the graph on it, and copies of the analyses whose
 * curves and brackets it shows, for the next experiment. Opens the new table to fill in.
 */
export function NewGraphLikeDialog({
  graphId,
  onClose,
  onCreated,
  onError,
}: {
  graphId: NodeId
  onClose: () => void
  onCreated: (id: NodeId) => void
  onError: (msg: string) => void
}) {
  const { store } = useServices()
  const project = useDoc((d) => d)
  const graph = project.nodes[graphId] as GraphNode
  const table = project.nodes[graph.seriesSource.table] as DataTable
  const [name, setName] = useState(() =>
    nextInSeries(table.name, new Set(Object.values(project.nodes).map((n) => n.name))),
  )
  // The analyses its curves and brackets come from (copied with it).
  const count = graphAnalyses(graph).filter((id) => project.nodes[id]?.kind === 'analysis').length

  // Planned on OK (the empty copy of a large table is made once).
  const create = () => {
    try {
      const plan = newGraphLike(store.getState(), graphId, name.trim())
      store.dispatch(plan.commands, 'New graph like this')
      onCreated(plan.table)
      onClose()
    } catch (e) {
      onError(errorMessage(e))
    }
  }
  return (
    <Dialog
      title={`New graph like “${graph.name}”`}
      onClose={onClose}
      okLabel="Create"
      onOk={create}
      okDisabled={!name.trim()}
    >
      <p className="muted">
        Makes an empty table like “{table.name}” (same kind, format, titles and rows) with a copy of
        this graph
        {count ? ` and the ${countNodes(Array(count).fill({ kind: 'analysis' }))} it shows` : ''},
        for the next experiment’s data.
      </p>
      <Field label="Name of the new table">
        {(id) => (
          <input id={id} type="text" value={name} onChange={(e) => setName(e.target.value)} />
        )}
      </Field>
    </Dialog>
  )
}
