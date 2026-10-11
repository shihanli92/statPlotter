import { registry } from '@ps/analyses'
import {
  type Command,
  compatibleTables,
  type DataSetMatch,
  editCommands,
  retargetAnalysis,
} from '@ps/engine'
import { missingEllipses, outputGraphsFor, outputsWithoutGraph, withOutputSeries } from '@ps/graph'
import {
  type AnalysisNode,
  type DataTable,
  type GraphNode,
  type NodeId,
  newNodeId,
} from '@ps/model'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Dialog, NoticeDialog } from '../components/Dialog.tsx'
import type { ShowError } from '../components/Toasts.tsx'
import { useUndoNotice } from '../components/undoNotice.tsx'
import { useDoc, useResultState, useServices, useSourceTable } from '../context.tsx'
import { showOnGraphsCommands } from '../graph/results/resultActions.ts'
import { sourceProblem } from '../resultTables.ts'
import { errorMessage } from '../util.ts'
import { analysisGroups } from './analysisSearch.ts'
import { DataSourceField, remapSelection } from './DataSourceField.tsx'
import { defaultSelection } from './defaultSelection.ts'
import { variableInfo } from './mvFields.tsx'
import { ParamsForm } from './ParamsForm.tsx'
import { allFields } from './simulationFields.tsx'

type Params = Record<string, unknown>

/** Every custom form editor, by component id. */
const FIELDS = allFields()

/**
 * Creates an analysis of a table (mode 'create') or edits an existing one ('edit'). One dialog
 * for every analysis: parameters come from each plugin's declarative form.
 */
type Props = (
  | {
      mode: 'create'
      tableId: NodeId
      /** Preselect this analysis (Analyze menu, palette) if the table's kind allows it. */
      analysisId?: string
      /**
       * A table not yet in the project (analyses that need no data, e.g. simulations, started
       * with no table open): added together with the analysis, in the same undo step.
       */
      draftTable?: DataTable
    }
  | { mode: 'edit'; analysisId: NodeId }
) & {
  onClose: () => void
  onCreated?: (id: NodeId) => void
  onError: ShowError
}

export function AnalyzeDialog(props: Props) {
  const existing = useDoc((d) =>
    props.mode === 'edit' ? (d.nodes[props.analysisId] as AnalysisNode) : null,
  )
  const tableId = props.mode === 'create' ? props.tableId : existing!.input.source
  // A data table, or the table an analysis produced (analyzing a result).
  const table = useSourceTable(tableId) ?? (props.mode === 'create' ? props.draftTable : undefined)
  const sourceNode = useDoc((d) => d.nodes[tableId])
  const sourceState = useResultState(tableId)
  if (!table) {
    return (
      <NoticeDialog
        title="Analyze"
        message={sourceProblem(sourceNode, table, sourceState)!}
        onClose={props.onClose}
      />
    )
  }
  return <AnalyzeForm {...props} existing={existing} table={table} />
}

function AnalyzeForm(props: Props & { existing: AnalysisNode | null; table: DataTable }) {
  const { store, engine } = useServices()
  const { existing, table: original } = props
  const project = useDoc((d) => d)

  // Editing an analysis of a data table: its Data can be another table of the same kind
  // (roadmap 31), its data sets and parameters remapped, its graphs following on OK.
  const others = useMemo(
    () =>
      existing && project.nodes[original.id]?.kind === 'table'
        ? compatibleTables(project, original)
        : [],
    [existing, project, original],
  )
  const [source, setSource] = useState<{ id: NodeId; match: DataSetMatch }>({
    id: original.id,
    match: 'position',
  })
  const retarget = existing && source.id !== original.id ? source : null
  const table = retarget ? (project.nodes[retarget.id] as DataTable) : original
  const retargeted = useMemo(
    () =>
      existing && source.id !== original.id
        ? retargetAnalysis(project, existing.id, source.id, source.match)
        : null,
    [project, existing, original, source],
  )
  // Selection and parameters in the original table's keys, while another table is shown.
  const base = useRef<{ selected: string[]; params: Params } | null>(null)

  // Offered by the kind of the table analyzed (for a result table, the kind it declares).
  // (A table made just for the analysis offers those that need no data.)
  const draft = props.mode === 'create' ? props.draftTable : undefined
  const defs = useMemo(
    () =>
      registry
        .list()
        .filter((d) => d.accepts.includes(table.tableKind) && (!draft || d.inputs.min === 0)),
    [table, draft],
  )
  const wanted = props.mode === 'create' ? props.analysisId : undefined
  const [defId, setDefId] = useState(
    existing?.analysisId ??
      (wanted && defs.some((d) => d.id === wanted) ? wanted : defs[0]?.id) ??
      '',
  )
  const def = registry.get(defId)

  // Roadmap 43: the list's search (a combobox over it: type to filter, ↑ / ↓ to move, Enter to
  // pick) and its Common group first.
  const [query, setQuery] = useState('')
  const groups = useMemo(
    () => analysisGroups(defs, table.tableKind, query),
    [defs, table.tableKind, query],
  )
  const rows = groups.flatMap((g) => g.defs)
  const [active, setActive] = useState(() =>
    Math.max(
      0,
      rows.findIndex((d) => d.id === defId),
    ),
  )
  const at = Math.min(active, Math.max(0, rows.length - 1))
  const listId = useId()
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    listRef.current?.querySelector(`[data-row="${at}"]`)?.scrollIntoView?.({ block: 'nearest' })
  }, [at])
  const trackUndo = useUndoNotice()

  const initialParams = (id: string): Params => {
    const d = registry.get(id)
    if (!d) return {}
    if (existing && existing.analysisId === id) {
      const r = d.params.safeParse(existing.params)
      if (r.success) return r.data as Params
    }
    return d.params.parse({}) as Params
  }
  const [params, setParams] = useState<Params>(() => initialParams(defId))

  const allKeys = table.dataSets.map((d) => d.id as string)
  const [selected, setSelected] = useState<string[]>(
    existing?.input.dataSets ?? defaultSelection(registry.get(defId), table),
  )

  const changeSource = (id: NodeId, match: DataSetMatch) => {
    if (!base.current) base.current = { selected, params }
    const b = base.current
    if (id === original.id) {
      setSelected(b.selected)
      setParams(b.params)
      base.current = null
    } else {
      const to = project.nodes[id] as DataTable
      const m = remapSelection(original, to, match, b.selected, b.params)
      setSelected(to.dataSets.map((d) => d.id as string).filter((k) => m.selected.includes(k)))
      setParams(m.params)
    }
    setSource({ id, match })
  }

  const [showOn, setShowOn] = useState<ReadonlySet<string>>(new Set())
  const tableGraphs = useDoc((d) =>
    Object.values(d.nodes).some((n) => n.kind === 'graph' && n.seriesSource.table === table.id),
  )

  if (!def) {
    return (
      <NoticeDialog
        title="Analyze"
        message={`No analyses are available for ${table.tableKind === 'nested' ? 'nested tables' : 'this table'} yet.`}
        onClose={props.onClose}
      />
    )
  }

  const pickDef = (id: string) => {
    setDefId(id)
    setParams(initialParams(id))
    setSelected(defaultSelection(registry.get(id), table))
  }

  const toggle = (key: string, on: boolean) => {
    const next = on ? [...selected, key] : selected.filter((k) => k !== key)
    // Keep table order so "column A vs B" reads naturally.
    setSelected(allKeys.filter((k) => next.includes(k)))
  }

  // Simulations (and the like, with these params) read no data sets: none to choose, none kept.
  const usesData = def.usesData?.(params) ?? true
  const dataSets = usesData ? selected : []
  const countOk =
    !usesData || (selected.length >= def.inputs.min && selected.length <= def.inputs.max)
  const countHint =
    def.inputs.min === def.inputs.max
      ? `Choose ${def.inputs.min} data set${def.inputs.min > 1 ? 's' : ''}.`
      : `Choose ${def.inputs.min} or more data sets.`

  /**
   * Links the analysis' declared outputs (fitted curves…) into graphs of the analyzed table, and
   * creates graphs for outputs that need their own.
   */
  const linkOutputs = (analysisId: NodeId, p: unknown, keys: string[]): Command[] => {
    const decls = def.outputs?.(keys, p) ?? []
    if (!decls.length) return []
    // Outputs that want a graph of their own (ROC curve, Bland-Altman plot…) get new graphs,
    // unless a graph already shows them (editing an analysis); a grouped PCA's graphs of its
    // scores table (roadmap 34c) get ellipses when asked for after they were made.
    const graphs = Object.values(store.getState().nodes).filter(
      (n): n is GraphNode => n.kind === 'graph',
    )
    const fresh = outputsWithoutGraph(graphs, analysisId, decls)
    const own: Command[] = outputGraphsFor(table, analysisId, fresh).map((node) => ({
      type: 'node.add',
      node,
      fresh: true,
    }))
    const ellipses: Command[] = missingEllipses(graphs, analysisId, decls).map((e) => ({
      type: 'graph.addLayer',
      id: e.graph.id,
      layer: e.layer,
      at: e.at,
    }))
    return [
      ...own,
      ...ellipses,
      ...Object.values(store.getState().nodes).flatMap((n): Command[] => {
        if (n.kind !== 'graph' || n.seriesSource.table !== table.id) return []
        return editCommands(n.id, withOutputSeries(n, analysisId, decls).edits)
      }),
    ]
  }

  // Roadmap 35: "Show on graph": the analysis' ready results offered here, added to the graphs of
  // the analyzed table with it (create mode).
  const offeredParams = def.params.safeParse(params)
  const offered =
    props.mode === 'create' && def.graphResults && offeredParams.success
      ? def
          .graphResults(offeredParams.data, { tableKind: table.tableKind, dataSets })
          .filter((t) => !!t.offer)
      : []

  const submit = () => {
    const parsed = def.params.safeParse(params)
    if (!parsed.success)
      return props.onError(`Invalid parameters: ${parsed.error.issues[0]?.message}`, 'validation')
    try {
      if (props.mode === 'create') {
        const node: AnalysisNode = {
          kind: 'analysis',
          id: newNodeId(),
          name: draft ? def.title : `${def.title} of ${table.name}`,
          analysisId: def.id,
          pluginVersion: def.version,
          input: { source: table.id, dataSets },
          params: parsed.data,
        }
        const chosen = offered.filter((t) => showOn.has(t.id))
        store.dispatch(
          [
            ...(draft ? [{ type: 'node.add' as const, node: draft }] : []),
            { type: 'node.add', node },
            ...linkOutputs(node.id, parsed.data, dataSets),
            ...(chosen.length
              ? showOnGraphsCommands(store.getState(), node, chosen, (id) => engine.latest(id))
              : []),
          ],
          `New ${def.title}`,
        )
        props.onCreated?.(node.id)
      } else {
        // Roadmap 43: announced with its Undo ("Change analysis · Undo").
        trackUndo(() =>
          store.dispatch(
            [
              // Another table analyzed: the analysis, its graphs and what reads its results move.
              ...(retargeted?.commands ?? []),
              { type: 'node.set', id: props.analysisId, path: ['analysisId'], value: def.id },
              {
                type: 'node.set',
                id: props.analysisId,
                path: ['pluginVersion'],
                value: def.version,
              },
              { type: 'analysis.setParams', id: props.analysisId, params: parsed.data },
              { type: 'analysis.setInput', id: props.analysisId, dataSets },
              ...(retargeted ? [] : linkOutputs(props.analysisId, parsed.data, dataSets)),
            ],
            retargeted ? 'Change analyzed table' : 'Change analysis',
          ),
        )
      }
      props.onClose()
    } catch (e) {
      props.onError(errorMessage(e))
    }
  }

  const pickRow = (i: number) => {
    const d = rows[i]
    if (!d) return
    setActive(i)
    if (d.id !== defId) pickDef(d.id)
  }
  const optionId = (i: number) => `${listId}-${i}`
  let row = -1

  return (
    <Dialog
      title={props.mode === 'create' ? `Analyze “${table.name}”` : 'Analysis parameters'}
      onClose={props.onClose}
      wide
      okLabel="OK"
      onOk={submit}
      okDisabled={!countOk}
    >
      <div className="analyze">
        <div className="analyze-list">
          <input
            type="text"
            className="analyze-search"
            role="combobox"
            aria-label="Search analyses"
            // No matches: no list to control (the message below says so).
            aria-expanded={rows.length > 0}
            aria-controls={rows.length ? listId : undefined}
            aria-autocomplete="list"
            aria-activedescendant={rows.length ? optionId(at) : undefined}
            placeholder="Search analyses…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            onKeyDown={(e) => {
              const n = Math.max(1, rows.length)
              if (e.key === 'ArrowDown') setActive((at + 1) % n)
              else if (e.key === 'ArrowUp') setActive((at - 1 + n) % n)
              else if (e.key === 'Home' && !query) setActive(0)
              else if (e.key === 'End' && !query) setActive(rows.length - 1)
              else if (e.key === 'Enter') pickRow(at)
              else return
              e.preventDefault()
            }}
          />
          {rows.length > 0 && (
            <div
              className="analyze-options"
              role="listbox"
              id={listId}
              aria-label="Analyses"
              ref={listRef}
            >
              {groups.map((g) => (
                // biome-ignore lint/a11y/useSemanticElements: a group of a listbox's options (no fieldset there)
                <div key={g.title ?? 'matches'} role="group" aria-label={g.title ?? 'Matches'}>
                  {g.title && (
                    <div className="analyze-group" aria-hidden="true">
                      {g.title}
                    </div>
                  )}
                  {g.defs.map((d) => {
                    const i = ++row
                    return (
                      // biome-ignore lint/a11y/useKeyWithClickEvents: the search field has the keys (combobox)
                      <div
                        key={d.id}
                        id={optionId(i)}
                        data-row={i}
                        role="option"
                        tabIndex={-1}
                        aria-selected={d.id === defId}
                        className={`list-item ${d.id === defId ? 'on' : ''} ${i === at ? 'active' : ''}`}
                        title={g.title === null ? d.category : undefined}
                        onClick={() => pickRow(i)}
                      >
                        {d.title}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
          {!rows.length && <p className="muted analyze-empty">No analysis matches “{query}”.</p>}
        </div>
        <div className="analyze-detail">
          <p className="muted">{def.description}</p>
          {usesData && others.length > 0 && (
            <DataSourceField
              tables={[original, ...others]}
              value={source.id}
              match={source.match}
              onChange={changeSource}
              warnings={retargeted?.warnings ?? []}
            />
          )}
          {usesData && (
            <fieldset className="field">
              <legend>Data sets to analyze</legend>
              {table.dataSets.map((ds) => (
                <label key={ds.id} className="check">
                  <input
                    type="checkbox"
                    checked={selected.includes(ds.id)}
                    onChange={(e) => toggle(ds.id, e.target.checked)}
                  />
                  {ds.title || '(untitled)'}
                </label>
              ))}
              <div className={`help ${countOk ? '' : 'error'}`}>{countHint}</div>
            </fieldset>
          )}
          <ParamsForm
            fields={def.form}
            value={params}
            onChange={setParams}
            custom={FIELDS}
            context={{
              dataSets: table.dataSets
                .filter((d) => selected.includes(d.id))
                .map((d) => ({ key: d.id, title: d.title, ...variableInfo(d) })),
              rows: Array.from({ length: table.rowCount }, (_, i) => ({
                index: i,
                title: table.rowTitles?.[i] || `Row ${i + 1}`,
              })),
            }}
          />
          {offered.length > 0 && tableGraphs && (
            <fieldset className="field">
              <legend>Show on graph</legend>
              {offered.map((t) => (
                <label key={t.id} className="check">
                  <input
                    type="checkbox"
                    checked={showOn.has(t.id)}
                    onChange={(e) => {
                      const next = new Set(showOn)
                      if (e.target.checked) next.add(t.id)
                      else next.delete(t.id)
                      setShowOn(next)
                    }}
                  />
                  {t.offer}
                </label>
              ))}
              <div className="help">On the graphs of “{table.name}”, live.</div>
            </fieldset>
          )}
        </div>
      </div>
    </Dialog>
  )
}
