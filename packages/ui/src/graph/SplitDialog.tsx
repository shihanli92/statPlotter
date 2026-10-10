import type { SplitBy } from '@ps/model'
import { type GraphNode, type NodeId, sourceTable } from '@ps/model'
import { useMemo, useState } from 'react'
import { Dialog } from '../components/Dialog.tsx'
import { Checkbox, NumberInput, RadioGroup, Select } from '../components/fields.tsx'
import { useDoc, useResultLookup, useServices } from '../context.tsx'
import { errorMessage } from '../util.ts'
import { autoColumns, defaultSplitVariable, splitKinds, splitSet, textVariables } from './split.ts'

/**
 * "Split into one graph per…" (roadmap 34d): a set of graphs like this one, one per level of a
 * text variable, per data set or per row, on a new page, their axes shared (or free). The graph
 * itself stays as it is.
 */
export function SplitDialog({
  graphId,
  onClose,
  onCreated,
}: {
  graphId: NodeId
  onClose: () => void
  /** The page made, to show it. */
  onCreated?: (layout: NodeId) => void
}) {
  const { store, fonts } = useServices()
  const project = useDoc((d) => d)
  const { lookup } = useResultLookup()
  const graph = project.nodes[graphId] as GraphNode
  const table = sourceTable(project, graph.seriesSource.table, lookup)
  const kinds = table ? splitKinds(table, graph) : { level: false, dataSet: false, row: false }
  const vars = table ? textVariables(table) : []
  const [by, setBy] = useState<SplitBy>(kinds.level ? 'level' : kinds.dataSet ? 'dataSet' : 'row')
  const [variable, setVariable] = useState(() => defaultSplitVariable(graph, vars))
  const xLinkable = graph.axes.x.type === 'continuous'
  const yLinkable = graph.axes.y.type === 'continuous'
  const [linkX, setLinkX] = useState(true)
  const [linkY, setLinkY] = useState(true)
  const [columns, setColumns] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const made = useMemo(() => {
    if (!table) return null
    try {
      return splitSet(
        project,
        fonts,
        table,
        graph,
        {
          by,
          ...(by === 'level' ? { variable } : {}),
          linkX,
          linkY,
          ...(columns ? { columns } : {}),
        },
        lookup,
      )
    } catch (e) {
      return errorMessage(e)
    }
  }, [project, fonts, table, graph, by, variable, linkX, linkY, columns, lookup])
  const count = made && typeof made !== 'string' ? made.graphs.length : 0

  const ok = () => {
    if (!made || typeof made === 'string' || !made.graphs.length)
      return setError(typeof made === 'string' ? made : 'There is nothing to split by.')
    const at = project.order.indexOf(graph.id) + 1
    store.dispatch(
      [
        ...made.graphs.map((node, i) => ({ type: 'node.add' as const, node, at: at + i })),
        { type: 'node.add' as const, node: made.layout },
      ],
      'Split into one graph per…',
    )
    onCreated?.(made.layout.id)
    onClose()
  }

  const options = [
    ...(kinds.level ? [{ value: 'level' as const, label: 'Level of a text variable' }] : []),
    ...(kinds.dataSet ? [{ value: 'dataSet' as const, label: 'Data set' }] : []),
    ...(kinds.row ? [{ value: 'row' as const, label: 'Row' }] : []),
  ]
  return (
    <Dialog
      title={`Split “${graph.name}” into one graph per…`}
      onClose={onClose}
      okLabel={count ? `Make ${count} graphs` : 'Make graphs'}
      okDisabled={!count}
      onOk={ok}
    >
      {options.length === 0 ? (
        <p className="muted">
          This graph’s table has no text variable, data sets or rows to split by.
        </p>
      ) : (
        <>
          <RadioGroup<SplitBy>
            legend="One graph per"
            name="split-by"
            value={by}
            options={options}
            onChange={setBy}
          />
          {by === 'level' && (
            <Select
              label="Variable"
              value={variable}
              options={vars.map((v) => ({ value: v.id as string, label: v.title || '(untitled)' }))}
              onChange={setVariable}
            />
          )}
          {xLinkable && (
            <Checkbox
              label="Share the X axis range across the graphs (stays in sync)"
              checked={linkX}
              onChange={setLinkX}
            />
          )}
          {yLinkable && (
            <Checkbox
              label="Share the Y axis range across the graphs (stays in sync)"
              checked={linkY}
              onChange={setLinkY}
            />
          )}
          <NumberInput
            label="Columns on the page"
            value={columns ?? autoColumns(count || 1)}
            min={1}
            max={12}
            onChange={setColumns}
          />
          <p className="muted">
            {count
              ? `${count} graphs like this one on a new page, each titled with its ${by === 'level' ? 'level' : by === 'row' ? 'row' : 'data set'}; one legend. A new ${by === 'level' ? 'level' : by === 'row' ? 'row' : 'data set'} in the table gets its graph.`
              : 'Nothing to split by.'}
          </p>
        </>
      )}
      {error && <p className="error">{error}</p>}
    </Dialog>
  )
}
