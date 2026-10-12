import {
  entriesFor,
  type MonteCarloParams,
  methodChanges,
  registry,
  tableFacts,
  withInnerVersion,
} from '@ps/analyses'
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
  normalizeColumn,
  paramsOf,
  type TableKind,
} from '@ps/model'
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Dialog, NoticeDialog } from '../components/Dialog.tsx'
import type { ShowError } from '../components/Toasts.tsx'
import { useUndoNotice } from '../components/undoNotice.tsx'
import { useDoc, useResultState, useServices, useSourceTable } from '../context.tsx'
import { showOnGraphsCommands } from '../graph/results/resultActions.ts'
import { recentAnalyses } from '../recentChoices.ts'
import { sourceProblem } from '../resultTables.ts'
import { errorMessage } from '../util.ts'
import { analysisGroups, COMMON_ANALYSES, searchAnalyses } from './analysisSearch.ts'
import { DataSourceField, remapSelection } from './DataSourceField.tsx'
import { defaultSelection } from './defaultSelection.ts'
import { type GuideChoice, GuidePanel } from './GuidePanel.tsx'
import { MethodCards } from './MethodCards.tsx'
import { MethodChangeNotice } from './MethodHistory.tsx'
import { variableInfo } from './mvFields.tsx'
import { ParamsForm } from './ParamsForm.tsx'
import { allFields } from './simulationFields.tsx'

type Params = Record<string, unknown>

/** Every custom form editor, by component id. */
const FIELDS = allFields()

/** Roadmap 51a: the dialog's two tabs. */
export type AnalyzeTab = 'guide' | 'all'

// Roadmap 51a (design §3.1, §3.3): view state, never in the document — the tab last used in
// each project (by its creation time), and the chooser's question, answers and data sets per
// table, kept for the session.
const lastTabs = new Map<string, AnalyzeTab>()
const guideMemory = new Map<
  string,
  { entry: string | null; answers: Record<string, string>; selection: string[] }
>()

/**
 * Roadmap 51a (U2): the analysis the list opens on: the one asked for, else the last one used
 * that this table's kind offers, else its first common analysis, else the first.
 */
export function openingAnalysis(
  defs: readonly { id: string }[],
  kind: TableKind,
  wanted?: string,
  recent: readonly string[] = [],
): string {
  const offered = (id: string | undefined) => !!id && defs.some((d) => d.id === id)
  if (offered(wanted)) return wanted!
  const used = recent.find((id) => offered(id))
  if (used) return used
  const common = (COMMON_ANALYSES[kind] ?? []).find((id) => offered(id))
  return common ?? defs[0]?.id ?? ''
}

/**
 * Roadmap 51c (S5): whether a subject lacks a value the others have among the chosen data sets —
 * a column table's row with some values but not all, a grouped table's row whose replicates
 * aren't all filled — so matched values would be fit by a mixed-effects model.
 */
export function missingInMatched(table: DataTable, keys: readonly string[]): boolean {
  const sets = keys.flatMap((k) => normalizeColumn(table, k) ?? [])
  if (sets.length < 2 || sets.some((d) => d.data.shape !== 'replicates')) return false
  const reps = sets.map((d) => (d.data.shape === 'replicates' ? d.data.reps : []))
  const rowCount = Math.max(...sets.map((d) => d.rowCount))
  const width = table.tableKind === 'grouped' ? Math.max(...reps.map((r) => r.length)) : 1
  for (let r = 0; r < rowCount; r++) {
    const cells = reps.flatMap((rs) =>
      Array.from({ length: width }, (_, j) => !Number.isNaN(rs[j]?.[r] ?? Number.NaN)),
    )
    if (cells.some(Boolean) && !cells.every(Boolean)) return true
  }
  return false
}

/** Plain values compared deeply (the params Use this wrote, and those submitted). */
const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

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
      /** Roadmap 51a: the tab to open on (absent: the one last used in this project). */
      tab?: AnalyzeTab
      /** Roadmap 51a: the chooser's question to open (Guide me on a question). */
      entry?: string
      /** Roadmap 51a: the data sets the chooser starts with (Compare these columns…). */
      dataSets?: string[]
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
  /** Roadmap 51a: a question needs another table kind: the New table dialog at that kind. */
  onNewTable?: (kind: TableKind) => void
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
    () => existing?.analysisId ?? openingAnalysis(defs, table.tableKind, wanted, recentAnalyses()),
  )
  const def = registry.get(defId)

  // Roadmap 51a: Guide me (the chooser) or All analyses. Editing, an analysis asked for by name
  // and a table made for an analysis that needs no data open on the list.
  const projectKey = useDoc((d) => d.meta.created)
  const guided = props.mode === 'create' && !draft && entriesFor(table.tableKind).length > 0
  const [tab, setTabState] = useState<AnalyzeTab>(() => {
    if (!guided) return 'all'
    if (props.mode === 'create' && props.tab) return props.tab
    if (props.mode === 'create' && props.entry) return 'guide'
    if (wanted && defs.some((d) => d.id === wanted)) return 'all'
    return lastTabs.get(projectKey) ?? 'guide'
  })
  const setTab = (t: AnalyzeTab) => {
    setTabState(t)
    lastTabs.set(projectKey, t)
  }
  const remembered = guideMemory.get(table.id)
  const startEntry = props.mode === 'create' ? props.entry : undefined
  const [guide, setGuideState] = useState(() => ({
    entry: startEntry ?? remembered?.entry ?? null,
    answers: startEntry && startEntry !== remembered?.entry ? {} : (remembered?.answers ?? {}),
    selection:
      (props.mode === 'create' ? props.dataSets : undefined) ??
      remembered?.selection ??
      table.dataSets.slice(0, 64).map((d) => d.id as string),
  }))
  const setGuide = (g: Partial<typeof guide>) => {
    const next = { ...guide, ...g }
    setGuideState(next)
    guideMemory.set(table.id, next)
  }
  const guideInput = useMemo(
    () =>
      guide.selection.flatMap((k) => {
        const n = normalizeColumn(table, k)
        return n ? [n] : []
      }),
    [table, guide.selection],
  )
  const facts = useMemo(() => tableFacts(table.tableKind, guideInput), [table, guideInput])
  // What Use this wrote, to record on OK whether it was kept (`origin.guide.followed`).
  const fromGuide = useRef<GuideChoice | null>(null)

  // Roadmap 43: the list's search (a combobox over it: type to filter, ↑ / ↓ to move, Enter to
  // pick) and its Common group first.
  const [query, setQuery] = useState('')
  // Roadmap 51a (U3): a query finds the chooser's questions, this table's analyses and, greyed,
  // what other table kinds answer.
  const found = useMemo(
    () => searchAnalyses(defs, table.tableKind, draft ? '' : query),
    [defs, table.tableKind, query, draft],
  )
  type Row =
    | { kind: 'def'; def: (typeof defs)[number] }
    | { kind: 'question'; id: string; label: string }
  const groups: { title: string | null; rows: Row[] }[] = useMemo(() => {
    if (!query.trim())
      return analysisGroups(defs, table.tableKind, '').map((g) => ({
        title: g.title,
        rows: g.defs.map((d): Row => ({ kind: 'def', def: d })),
      }))
    if (draft)
      return analysisGroups(defs, table.tableKind, query).map((g) => ({
        title: g.title,
        rows: g.defs.map((d): Row => ({ kind: 'def', def: d })),
      }))
    return [
      {
        title: 'Questions',
        rows: found.questions.map((e): Row => ({ kind: 'question', id: e.id, label: e.question })),
      },
      {
        title: 'Analyses for this table',
        rows: found.here.map((d): Row => ({ kind: 'def', def: d })),
      },
    ].filter((g) => g.rows.length)
  }, [defs, table.tableKind, query, found, draft])
  const rows = groups.flatMap((g) => g.rows)
  const [active, setActive] = useState(() =>
    Math.max(
      0,
      rows.findIndex((r) => r.kind === 'def' && r.def.id === defId),
    ),
  )
  const at = Math.min(active, Math.max(0, rows.length - 1))
  const listId = useId()
  const tabId = useId()
  const listRef = useRef<HTMLDivElement>(null)
  // Roadmap 51a: each tab puts the focus where its work starts (the search; the chosen question
  // or the first), after the dialog has opened (its own focus comes after this effect).
  const searchRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const t = setTimeout(() => {
      if (tab === 'all') searchRef.current?.focus()
      else
        panelRef.current
          ?.querySelector<HTMLButtonElement>(
            '.guide-entries [aria-pressed="true"], .guide-entries button',
          )
          ?.focus()
    }, 0)
    return () => clearTimeout(t)
  }, [tab])
  useEffect(() => {
    listRef.current?.querySelector(`[data-row="${at}"]`)?.scrollIntoView?.({ block: 'nearest' })
  }, [at])
  const trackUndo = useUndoNotice()

  const initialParams = (id: string): Params => {
    const d = registry.get(id)
    if (!d) return {}
    // Roadmap 51c: stored params migrated from their version (a saved analysis keeps its
    // options), never parsed alone.
    if (existing && existing.analysisId === id) {
      const r = paramsOf(d, existing)
      if (r.ok) return r.params as Params
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
  // Roadmap 51c (§7.1, §7.2): editing, what changes in the method, and whether results were seen.
  const [reason, setReason] = useState('')
  const ownState = useResultState(existing?.id ?? original.id)
  const seen =
    !!existing &&
    (ownState?.status === 'ready' || (ownState?.status === 'pending' && !!ownState.previous))
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

  /** Roadmap 51c (§7.1): the method's changes since the stored one (none when creating). */
  const changes = (() => {
    if (!existing) return []
    const was = registry.get(existing.analysisId)
    const now = def.params.safeParse(params)
    if (!was || !now.success) return []
    const before = paramsOf(was, existing)
    if (!before.ok) return []
    const name = (k: string) =>
      table.dataSets.find((d) => d.id === k)?.title ||
      original.dataSets.find((d) => d.id === k)?.title ||
      k
    return methodChanges(
      { def: was, params: before.params, dataSets: existing.input.dataSets },
      { def, params: now.data, dataSets: retarget ? existing.input.dataSets : dataSets },
      name,
    )
  })()

  /** A new node of the chosen method (create, or Add as a new analysis beside an edited one). */
  const newAnalysis = (p: unknown, name: string): AnalysisNode => ({
    kind: 'analysis',
    id: newNodeId(),
    name,
    analysisId: def.id,
    pluginVersion: def.version,
    input: { source: table.id, dataSets },
    params: p,
  })

  /** Roadmap 51c (§7.2): Add as a new analysis — the changed method beside the first. */
  const addAsNew = () => {
    const checked = def.params.safeParse(params)
    if (!checked.success)
      return props.onError(`Invalid parameters: ${checked.error.issues[0]?.message}`, 'validation')
    try {
      const node = newAnalysis(checked.data, `${def.title} of ${table.name}`)
      store.dispatch(
        [{ type: 'node.add', node }, ...linkOutputs(node.id, checked.data, dataSets)],
        `New ${def.title}`,
      )
      props.onCreated?.(node.id)
      props.onClose()
    } catch (e) {
      props.onError(errorMessage(e))
    }
  }

  const submit = () => {
    const checked = def.params.safeParse(params)
    if (!checked.success)
      return props.onError(`Invalid parameters: ${checked.error.issues[0]?.message}`, 'validation')
    // Roadmap 51c (design §6.1): stored whole, with the version of an embedded analysis' params.
    const parsed = {
      data:
        def.id === 'monteCarlo'
          ? withInnerVersion(checked.data as MonteCarloParams, (id) => registry.get(id))
          : checked.data,
    }
    try {
      if (props.mode === 'create') {
        const node: AnalysisNode = {
          ...newAnalysis(parsed.data, draft ? def.title : `${def.title} of ${table.name}`),
          // Roadmap 51a: set up with Guide me (and whether its params were kept).
          ...(fromGuide.current && fromGuide.current.analysisId === def.id
            ? {
                origin: {
                  guide: {
                    entry: fromGuide.current.entry,
                    answers: fromGuide.current.answers,
                    followed: sameValue(fromGuide.current.params, parsed.data),
                  },
                },
              }
            : {}),
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
              // Roadmap 51c (§7.1): the method before, in the history, in the same undo step.
              ...(changes.length && existing
                ? [
                    {
                      type: 'analysis.recordChange' as const,
                      id: props.analysisId,
                      change: {
                        at: new Date().toISOString(),
                        from: {
                          analysisId: existing.analysisId,
                          pluginVersion: existing.pluginVersion,
                          params: existing.params,
                          dataSets: existing.input.dataSets,
                        },
                        changes,
                        afterResults: seen,
                        ...(reason.trim() ? { reason: reason.trim().slice(0, 500) } : {}),
                      },
                    },
                  ]
                : []),
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
    const r = rows[i]
    if (!r) return
    setActive(i)
    if (r.kind === 'question') {
      setGuide({ entry: r.id, answers: {} })
      setTab('guide')
    } else if (r.def.id !== defId) pickDef(r.def.id)
  }

  /** Roadmap 51a: Use this: the recommended analysis and params, on the list's tab. */
  const useChoice = (c: GuideChoice) => {
    const d = registry.get(c.analysisId)
    if (!d) return
    const parsed = d.params.safeParse(c.params)
    const p = (parsed.success ? parsed.data : d.params.parse({})) as Params
    setDefId(d.id)
    setParams(p)
    const chosen = d.numbersByDefault
      ? guide.selection.filter((k) => !table.dataSets.find((x) => x.id === k)?.text)
      : guide.selection
    const n = Math.min(d.inputs.max, chosen.length)
    setSelected(n >= d.inputs.min ? chosen.slice(0, n) : defaultSelection(d, table))
    fromGuide.current = { ...c, params: p }
    const i = rows.findIndex((r) => r.kind === 'def' && r.def.id === d.id)
    if (i >= 0) setActive(i)
    setTab('all')
  }
  const optionId = (i: number) => `${listId}-${i}`
  let row = -1

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const n = Math.max(1, rows.length)
    if (e.key === 'ArrowDown') setActive((at + 1) % n)
    else if (e.key === 'ArrowUp') setActive((at - 1 + n) % n)
    else if (e.key === 'Home' && !query) setActive(0)
    else if (e.key === 'End' && !query) setActive(rows.length - 1)
    else if (e.key === 'Enter') pickRow(at)
    else return
    e.preventDefault()
  }
  const elsewhere = query.trim() ? found.elsewhere : []
  const newTable = (kind: TableKind) => {
    props.onClose()
    props.onNewTable?.(kind)
  }
  const cards = (() => {
    const p = def.params.safeParse(params)
    return p.success ? (def.cards?.(p.data) ?? []) : []
  })()
  const titleOf = (k: string | undefined) => table.dataSets.find((d) => d.id === k)?.title
  const control = typeof params.control === 'string' ? titleOf(params.control) : undefined
  const nameA = titleOf(selected[0])
  const nameB = titleOf(selected[1])
  const names = {
    ...(nameA ? { A: nameA } : {}),
    ...(nameB ? { B: nameB } : {}),
    ...(control ? { control } : {}),
  }

  const list = (
    <div className="analyze">
      <div className="analyze-list">
        <input
          type="text"
          ref={searchRef}
          className="analyze-search"
          role="combobox"
          aria-label="Search analyses"
          // No matches: no list to control (the message below says so).
          aria-expanded={rows.length > 0}
          aria-controls={rows.length ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={rows.length ? optionId(at) : undefined}
          placeholder="Search analyses or questions…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={onSearchKey}
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
                {g.rows.map((r) => {
                  const i = ++row
                  const on = r.kind === 'def' && r.def.id === defId
                  return (
                    // biome-ignore lint/a11y/useKeyWithClickEvents: the search field has the keys (combobox)
                    <div
                      key={r.kind === 'def' ? r.def.id : `q:${r.id}`}
                      id={optionId(i)}
                      data-row={i}
                      role="option"
                      tabIndex={-1}
                      aria-selected={on}
                      className={`list-item ${on ? 'on' : ''} ${i === at ? 'active' : ''} ${r.kind === 'question' ? 'question' : ''}`}
                      title={r.kind === 'def' && g.title === null ? r.def.category : undefined}
                      onClick={() => pickRow(i)}
                    >
                      {r.kind === 'def' ? r.def.title : r.label}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        )}
        {elsewhere.length > 0 && (
          <div className="analyze-elsewhere">
            <div className="analyze-group">Need another table kind</div>
            <ul>
              {elsewhere.slice(0, 8).map((m) => (
                <li key={m.id} className="muted">
                  <span>{m.label}</span>
                  <span className="help">{m.line}</span>
                  {props.onNewTable && (
                    <button type="button" className="link" onClick={() => newTable(m.needs)}>
                      New table…
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {!rows.length && !elsewhere.length && (
          <p className="muted analyze-empty">
            No analysis matches “{query}”.
            {guided && (
              <>
                {' '}
                <button type="button" className="link" onClick={() => setTab('guide')}>
                  Guide me
                </button>
              </>
            )}
          </p>
        )}
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
            facts: { missingInMatched: missingInMatched(table, selected) },
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
        {/* Roadmap 51a: the method's cards, below the options (the side panel is 51b's). */}
        {cards.length > 0 && (
          <details className="about-method">
            <summary>About this method</summary>
            <MethodCards ids={cards} names={names} />
          </details>
        )}
      </div>
    </div>
  )

  return (
    <Dialog
      title={props.mode === 'create' ? `Analyze “${table.name}”` : 'Analysis parameters'}
      onClose={props.onClose}
      wide
      okLabel="OK"
      onOk={submit}
      okDisabled={!countOk || tab === 'guide'}
    >
      {guided && (
        <div className="tabs analyze-tabs" role="tablist" aria-label="Choose an analysis">
          {(
            [
              ['guide', 'Guide me'],
              ['all', 'All analyses'],
            ] as const
          ).map(([t, label]) => (
            <button
              key={t}
              type="button"
              role="tab"
              id={`${tabId}-${t}`}
              aria-selected={tab === t}
              aria-controls={`${tabId}-panel`}
              className={tab === t ? 'on' : ''}
              onClick={() => setTab(t)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <div
        ref={panelRef}
        className="analyze-panel"
        {...(guided
          ? { role: 'tabpanel', id: `${tabId}-panel`, 'aria-labelledby': `${tabId}-${tab}` }
          : {})}
      >
        {props.mode === 'edit' && seen && changes.length > 0 && (
          <MethodChangeNotice
            changes={changes}
            reason={reason}
            onReason={setReason}
            onAddAsNew={addAsNew}
          />
        )}
        {tab === 'guide' ? (
          <GuidePanel
            kind={table.tableKind}
            tableName={table.name}
            facts={facts}
            groups={guideInput.map((d) => ({ key: d.ref.key as string, title: d.title }))}
            choices={table.dataSets.map((d) => ({ key: d.id as string, title: d.title }))}
            entryId={guide.entry}
            answers={guide.answers}
            selection={guide.selection}
            onEntry={(entry) =>
              setGuide({ entry, answers: entry === guide.entry ? guide.answers : {} })
            }
            onAnswers={(answers) => setGuide({ answers })}
            onSelection={(selection) => setGuide({ selection })}
            onUse={useChoice}
            onShowAll={() => setTab('all')}
            onNewTable={newTable}
          />
        ) : (
          list
        )}
      </div>
    </Dialog>
  )
}
