import {
  analysisChecks,
  analysisFacts,
  analysisSchematic,
  applyRoles,
  assignRoles,
  carryOver,
  comparingText,
  entriesFor,
  fieldStates,
  type MonteCarloParams,
  methodChanges,
  methodNameOf,
  type RoleAssignment,
  type RoleVariable,
  registry,
  roleProblem,
  rolesOf,
  SKETCH_MAX_ROWS,
  setsWord,
  startingRoles,
  TRANSFORM_LOG10_X,
  tableFacts,
  withInnerVersion,
  withLog10X,
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
  type AnalysisDef,
  type AnalysisNode,
  type Check,
  type CheckFix,
  type DataTable,
  type DiagnosticFix,
  type FormField,
  type GraphNode,
  type NodeId,
  type NormalizedDataSet,
  newNodeId,
  normalizeColumn,
  paramsOf,
  type SchematicSpec,
  type SketchSpec,
  type TableKind,
} from '@ps/model'
import {
  type CSSProperties,
  type KeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
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
import { GroupChips } from './GroupChips.tsx'
import { type GuideChoice, GuidePanel, methodLine } from './GuidePanel.tsx'
import { MethodCards } from './MethodCards.tsx'
import { MethodChangeNotice } from './MethodHistory.tsx'
import { pickModel } from './ModelPicker.tsx'
import { variableInfo } from './mvFields.tsx'
import { OptionTiers } from './OptionTiers.tsx'
import { FieldCard, setPath } from './ParamsForm.tsx'
import { RoleBoxes } from './RoleBoxes.tsx'
import { SchematicView } from './SchematicView.tsx'
import { SketchView } from './SketchView.tsx'
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

/** Roadmap 51b (§4.1): the dialog's size, remembered (a convenience: it may be lost). */
const SIZE_KEY = 'ps.analyzeDialog.size'
function storedSize(): { width: number; height: number } | null {
  try {
    const s = JSON.parse(localStorage.getItem(SIZE_KEY) ?? 'null')
    return s && typeof s.width === 'number' && typeof s.height === 'number' ? s : null
  } catch {
    return null
  }
}
function storeSize(size: { width: number; height: number }) {
  try {
    localStorage.setItem(SIZE_KEY, JSON.stringify(size))
  } catch {}
}

/**
 * Roadmap 51f: whether "What will be tested" is open in the side panel of All analyses (for the
 * session; it starts open).
 */
let schematicOpen = true

/** Roadmap 51b (§5.8): the sketch and checks follow the options this long after a change (ms). */
export const SKETCH_DEBOUNCE_MS = 120

/** A value that follows `value` once it has stood for `ms` (the first value at once). */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

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

/** Plain values compared deeply (the params Use this wrote, and those submitted). */
const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/** A table's variables as roles see them (number, coded 0/1, or text). */
function roleVariables(table: DataTable): RoleVariable[] {
  return table.dataSets.map((d) => {
    if (d.text) return { key: d.id, title: d.title, type: 'text' as const }
    const n = normalizeColumn(table, d.id)
    const seen = new Set<number>()
    if (n?.data.shape === 'replicates')
      for (const v of n.data.reps[0] ?? []) {
        if (Number.isFinite(v)) seen.add(v)
        if (seen.size > 2) break
      }
    const binary = seen.size === 2 && seen.has(0) && seen.has(1)
    return { key: d.id, title: d.title, type: binary ? ('binary' as const) : ('number' as const) }
  })
}

/** The paths a definition's roles edit (not shown again among its options). */
function rolePaths(def: AnalysisDef<unknown>): Set<string> {
  const roles = rolesOf(def)
  if (!roles) return new Set()
  const out = new Set<string>()
  for (const r of roles) {
    if (r.param) out.add(r.param.join('.'))
    if (r.listParam) out.add(r.listParam.join('.'))
  }
  // A multiple-variables ANOVA's factors are its Factors box.
  if (def.id === 'multifactorAnova') out.add('factors')
  return out
}

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
  | {
      mode: 'edit'
      analysisId: NodeId
      /** Roadmap 51e (§9.3): a result warning's fix ("Fix Bottom = 0"), applied on opening. */
      fix?: DiagnosticFix
    }
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

/** What the dialog remembers of a method while another is shown (§4.5: returning restores it). */
interface MethodState {
  params: Params
  selected: string[]
  roles: RoleAssignment | null
}

function AnalyzeForm(props: Props & { existing: AnalysisNode | null; table: DataTable }) {
  const { store, engine, fonts } = useServices()
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
  const guideFacts = useMemo(() => tableFacts(table.tableKind, guideInput), [table, guideInput])
  // Roadmap 51f: the names "What will be tested" uses besides the data sets' titles.
  const guideNames = useMemo(
    () => ({
      rowTitles: guideInput[0]?.rowTitles ?? table.rowTitles ?? null,
      factors: table.factorNames ?? {},
      xTitle: table.x?.title ?? null,
    }),
    [guideInput, table],
  )
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
  const sideId = useId()
  const reasonId = useId()
  const listRef = useRef<HTMLDivElement>(null)
  // Roadmap 51b (§4.1, U28): editing opens on the current method, the list folded away until
  // "Change method…"; a narrow dialog folds it too (a strip opening the list over the options).
  const [changing, setChanging] = useState(props.mode === 'create')
  const [railOpen, setRailOpen] = useState(false)
  const [sketchHidden, setSketchHidden] = useState(false)
  const [infoField, setInfoField] = useState<FormField | null>(null)
  // Roadmap 51a: each tab puts the focus where its work starts (the search; the chosen question
  // or the first), after the dialog has opened (its own focus comes after this effect).
  const searchRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const changeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const t = setTimeout(() => {
      if (tab === 'all') (changing ? searchRef.current : changeRef.current)?.focus()
      else
        panelRef.current
          ?.querySelector<HTMLButtonElement>(
            '.guide-entries [aria-pressed="true"], .guide-entries button',
          )
          ?.focus()
    }, 0)
    return () => clearTimeout(t)
  }, [tab, changing])
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
      if (r.ok) {
        // Roadmap 51e: opened by a warning's fix: its values set (shown, applied on Apply).
        const fix = props.mode === 'edit' ? props.fix : undefined
        let p = r.params as Params
        for (const x of fix?.set ?? []) p = setPath(p, x.path, x.value)
        return p
      }
    }
    return d.params.parse({}) as Params
  }
  const [params, setParams] = useState<Params>(() => initialParams(defId))

  const variables = useMemo(() => roleVariables(table), [table])
  const startRoles = (d: AnalysisDef<unknown> | undefined, keys: readonly string[], p: Params) => {
    const roles = d && rolesOf(d)
    if (!roles) return null
    if (existing && existing.analysisId === d.id) return assignRoles(roles, keys, p, true)
    return startingRoles(roles, variables).assignment
  }
  const [selected, setSelected] = useState<string[]>(
    () => existing?.input.dataSets ?? defaultSelection(registry.get(defId), table),
  )
  const [roleState, setRoleState] = useState<RoleAssignment | null>(() =>
    startRoles(registry.get(defId), existing?.input.dataSets ?? [], params),
  )
  // Roadmap 51b (§4.5): what each method had, so returning to it restores its choices; whether
  // the groups were chosen (by the chips, Guide me, an edited analysis) or are a default.
  const visited = useRef(new Map<string, MethodState>())
  const touched = useRef(props.mode === 'edit' || !!(props.mode === 'create' && props.dataSets))

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
      setSelected(m.selected)
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

  // Roadmap 51b (§4.7): with roles, the params and data sets are the roles' (written back).
  const roles = def ? rolesOf(def) : undefined
  const roleApplied = useMemo(
    () => (roles && roleState ? applyRoles(roles, roleState, params) : null),
    [roles, roleState, params],
  )
  const effectiveParams = roleApplied?.params ?? params
  const usesData = def ? (def.usesData?.(effectiveParams) ?? true) : true
  const chosen = roleApplied?.dataSets ?? selected
  const dataSets = usesData ? chosen : []

  const tableInput = useMemo(
    () =>
      dataSets.flatMap((k) => {
        const n = normalizeColumn(table, k)
        return n ? [n] : []
      }),
    [table, dataSets],
  )
  // Roadmap 51e (§9.2): "Transform X to log10" — a new curve fit of a data table is made of a
  // Transform analysis (X = log10(X)) and the fit of its result; until Analyze, the checks and the
  // sketch see the transformed X.
  const [transformFirst, setTransformFirst] = useState(false)
  const canTransform =
    props.mode === 'create' &&
    !draft &&
    project.nodes[table.id]?.kind === 'table' &&
    def?.id === 'nonlinearFit'
  const logX = transformFirst && canTransform
  const input = useMemo(() => (logX ? withLog10X(tableInput) : tableInput), [logX, tableInput])
  const facts = useMemo(
    () => analysisFacts(table.tableKind, input, effectiveParams),
    [table, input, effectiveParams],
  )
  const states = useMemo(
    () => (def ? fieldStates(def.form, effectiveParams, facts) : []),
    [def, effectiveParams, facts],
  )
  const context = useMemo(
    () => ({ tableKind: table.tableKind, xTitle: table.x?.title ?? null }),
    [table],
  )
  /** The checks of these options (blocks first). */
  const checksOf = (p: Params, sets: readonly NormalizedDataSet[]): Check[] =>
    def
      ? analysisChecks({
          def,
          kind: table.tableKind,
          input: sets,
          params: p,
          facts: analysisFacts(table.tableKind, sets, p),
          ...(roles && roleState ? { roles: roleState } : {}),
          context,
        })
      : []
  // Roadmap 51b (§4.6, §5.8): the checks and the sketch follow the options, debounced.
  const settled = useDebounced({ defId, params: effectiveParams, input }, SKETCH_DEBOUNCE_MS)
  const stale =
    settled.defId !== defId || settled.params !== effectiveParams || settled.input !== input
  const settledDef = registry.get(settled.defId)
  const checks = useMemo(
    () =>
      settledDef && settledDef === def
        ? analysisChecks({
            def: settledDef,
            kind: table.tableKind,
            input: settled.input,
            params: settled.params,
            facts: analysisFacts(table.tableKind, settled.input, settled.params),
            ...(roleState && rolesOf(settledDef) ? { roles: roleState } : {}),
            context,
          })
        : [],
    [settled, settledDef, def, roleState, table, context],
  )
  const sketch: SketchSpec | null = useMemo(() => {
    if (!settledDef?.sketch || !usesData) return null
    // Roles still to fill: nothing to draw yet (the check says what to choose).
    const r = rolesOf(settledDef)
    if (r && roleState && roleProblem(r, roleState)) return null
    const parsed = settledDef.params.safeParse(settled.params)
    if (!parsed.success) return null
    try {
      return settledDef.sketch(settled.input, parsed.data, { ...context, maxRows: SKETCH_MAX_ROWS })
    } catch {
      return null
    }
  }, [settled, settledDef, context, usesData, roleState])

  const leftOut = useMemo(() => {
    if (!roles || existing) return []
    return startingRoles(roles, variables).leftOut
  }, [roles, existing, variables])

  // Roadmap 51b (§4.1): a remembered size (dragging the corner), within the screen.
  const [size] = useState(storedSize)

  // Roadmap 51b (§4.1): the layout by the dialog's own width (measured, as the Format dialog
  // does), and its size remembered when the user drags its corner.
  const layoutOf = (w: number) => (w >= 1100 ? 'wide' : w >= 860 ? 'medium' : 'narrow')
  // The first layout from the window (no flash of three columns in a small window).
  const [width, setWidth] = useState<'wide' | 'medium' | 'narrow'>(() =>
    layoutOf(
      typeof window === 'undefined'
        ? 1200
        : Math.min(size?.width ?? 1200, 1200, window.innerWidth * 0.94),
    ),
  )
  const observed = useRef<Element | null>(null)
  const observe = (el: HTMLDivElement | null) => {
    if (!el || observed.current === el || typeof ResizeObserver === 'undefined') return
    observed.current = el
    const d = el.closest('dialog')
    let first = true
    new ResizeObserver(() => {
      const w = (d ?? el).getBoundingClientRect().width
      setWidth(layoutOf(w))
      if (first || !d) {
        first = false
        return
      }
      const r = d.getBoundingClientRect()
      if (r.width > 200 && r.height > 200)
        storeSize({ width: Math.round(r.width), height: Math.round(r.height) })
    }).observe(el)
  }

  // Roadmap 51d (U19): the factor names asked for beside grouped analyses (`asksFactors`).
  const [factorNames, setFactorNames] = useState<{ rows: string; columns: string }>(() => ({
    rows: table.factorNames?.rows ?? '',
    columns: table.factorNames?.columns ?? '',
  }))

  // Roadmap 51f: "What will be tested" for the method chosen — its params and the data sets
  // chosen, in the names the table and the dialog give (factor names as typed).
  const schematic: SchematicSpec | null = useMemo(() => {
    if (!settledDef || !usesData) return null
    const r = rolesOf(settledDef)
    if (r && roleState && roleProblem(r, roleState)) return null
    const parsed = settledDef.params.safeParse(settled.params)
    if (!parsed.success) return null
    try {
      return analysisSchematic(
        settledDef.id,
        parsed.data as Record<string, unknown>,
        tableFacts(table.tableKind, settled.input),
        {
          rowTitles: settled.input[0]?.rowTitles ?? table.rowTitles ?? null,
          factors: factorNames,
          xTitle: table.x?.title ?? null,
        },
      )
    } catch {
      return null
    }
  }, [settled, settledDef, usesData, roleState, table, factorNames])
  const [showSchematic, setShowSchematic] = useState(schematicOpen)

  if (!def) {
    return (
      <NoticeDialog
        title="Analyze"
        message={`No analyses are available for ${table.tableKind === 'nested' ? 'nested tables' : 'this table'} yet.`}
        onClose={props.onClose}
      />
    )
  }

  /** Roadmap 51b (§4.5): another method, keeping the choices they share. */
  const pickDef = (id: string) => {
    const next = registry.get(id)
    if (!next || id === defId) return
    visited.current.set(defId, { params, selected, roles: roleState })
    const back = visited.current.get(id)
    const p =
      back?.params ??
      carryOver({ def, params: effectiveParams }, { def: next, params: initialParams(id) })
    // The groups chosen are kept (§4.5); a selection never touched is the new method's own.
    const keep = selected.length && touched.current ? selected : defaultSelection(next, table)
    const trimmed = keep.slice(0, Number.isFinite(next.inputs.max) ? next.inputs.max : undefined)
    setDefId(id)
    setParams(p)
    setSelected(back?.selected ?? trimmed)
    setRoleState(back?.roles ?? startRoles(next, chosen, p))
    setInfoField(null)
  }

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
  const offeredParams = def.params.safeParse(effectiveParams)
  // Roadmap 51b (U14): offered while editing too (added to the graphs on Apply).
  const offered =
    def.graphResults && offeredParams.success
      ? def
          .graphResults(offeredParams.data, { tableKind: table.tableKind, dataSets })
          .filter((t) => !!t.offer)
      : []

  /** Roadmap 51c (§7.1): the method's changes since the stored one (none when creating). */
  const changes = (() => {
    if (!existing) return []
    const was = registry.get(existing.analysisId)
    const now = def.params.safeParse(effectiveParams)
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

  // Roadmap 51d (U19): a grouped table's factor names, asked for beside the two-way and
  // many-rows analyses (taken from the table; stored on it, additively).
  const asksFactors =
    table.tableKind === 'grouped' &&
    ['twoWayAnova', 'threeWayAnova', 'multipleT', 'multipleOneWay'].includes(def.id)
  const factorCommands = (): Command[] => {
    if (!asksFactors) return []
    const rows = factorNames.rows.trim().slice(0, 80)
    const columns = factorNames.columns.trim().slice(0, 80)
    if (rows === (table.factorNames?.rows ?? '') && columns === (table.factorNames?.columns ?? ''))
      return []
    const value =
      rows || columns ? { ...(rows ? { rows } : {}), ...(columns ? { columns } : {}) } : undefined
    return [{ type: 'node.set', id: table.id, path: ['factorNames'], value }]
  }

  /**
   * Roadmap 51d (U23): the name of the method and its groups ("Welch’s t test: Treated vs
   * Control"), which follows them until the user renames the analysis.
   */
  const autoName = (p: unknown, keys: readonly string[] = dataSets): string =>
    methodNameOf(def, p, {
      dataSets: keys.map((k) => table.dataSets.find((d) => d.id === k)?.title || k),
      table: table.name,
      ...(typeof (p as { control?: unknown })?.control === 'string'
        ? {
            control:
              table.dataSets.find((d) => d.id === (p as { control: string }).control)?.title ?? '',
          }
        : {}),
      ...(asksFactors && (factorNames.rows || factorNames.columns)
        ? { factors: { rows: factorNames.rows, columns: factorNames.columns } }
        : table.factorNames
          ? { factors: table.factorNames }
          : {}),
    })

  /** A new node of the chosen method (create, or Add as a new analysis beside an edited one). */
  const newAnalysis = (p: unknown, name: string = autoName(p)): AnalysisNode => ({
    kind: 'analysis',
    id: newNodeId(),
    name,
    analysisId: def.id,
    pluginVersion: def.version,
    input: { source: table.id, dataSets },
    params: p,
    autoName: true,
  })

  // Roadmap 51b (§4.6, U16): problems are shown before Analyze, which is disabled with the first
  // one as its reason (checked again, undebounced, on Analyze).
  const firstBlock = (list: readonly Check[]) => list.find((c) => c.level === 'block')
  const block = tab === 'guide' ? null : firstBlock(checks)

  /** The params as stored (Monte Carlo's inner analysis versioned), or the problem. */
  const ready = (): { data: unknown } | null => {
    const now = firstBlock(checksOf(effectiveParams, input))
    if (now) {
      props.onError(now.message, 'validation')
      return null
    }
    const checked = def.params.safeParse(effectiveParams)
    if (!checked.success) {
      props.onError(`Invalid parameters: ${checked.error.issues[0]?.message}`, 'validation')
      return null
    }
    // Roadmap 51c (design §6.1): stored whole, with the version of an embedded analysis' params.
    return {
      data:
        def.id === 'monteCarlo'
          ? withInnerVersion(checked.data as MonteCarloParams, (id) => registry.get(id))
          : checked.data,
    }
  }

  /** Roadmap 51c (§7.2): Add as a new analysis — the changed method beside the first. */
  const addAsNew = () => {
    const parsed = ready()
    if (!parsed) return
    try {
      const node = newAnalysis(parsed.data)
      store.dispatch(
        [
          ...factorCommands(),
          { type: 'node.add', node },
          ...linkOutputs(node.id, parsed.data, dataSets),
        ],
        `New ${def.title}`,
      )
      props.onCreated?.(node.id)
      props.onClose()
    } catch (e) {
      props.onError(errorMessage(e))
    }
  }

  const submit = () => {
    if (tab === 'guide') return
    const parsed = ready()
    if (!parsed) return
    const chosenResults = offered.filter((t) => showOn.has(t.id))
    try {
      if (props.mode === 'create' && logX) {
        // Roadmap 51e (§9.2): X = log10(X) by a Transform analysis, the fit of its result.
        const transform = registry.get('transform')!
        const tnode: AnalysisNode = {
          kind: 'analysis',
          id: newNodeId(),
          name: `log10(X) of ${table.name}`,
          analysisId: transform.id,
          pluginVersion: transform.version,
          input: { source: table.id, dataSets },
          params: transform.params.parse({ y: 'none', x: 'log10' }),
        }
        const node: AnalysisNode = {
          ...newAnalysis(parsed.data),
          input: { source: tnode.id, dataSets },
        }
        store.dispatch(
          [
            { type: 'node.add', node: tnode },
            { type: 'node.add', node },
          ],
          `New ${def.title} of log10(X)`,
        )
        props.onCreated?.(node.id)
      } else if (props.mode === 'create') {
        const node: AnalysisNode = {
          ...newAnalysis(parsed.data, draft ? def.title : autoName(parsed.data)),
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
        store.dispatch(
          [
            ...(draft ? [{ type: 'node.add' as const, node: draft }] : []),
            ...factorCommands(),
            { type: 'node.add', node },
            ...linkOutputs(node.id, parsed.data, dataSets),
            ...(chosenResults.length
              ? showOnGraphsCommands(store.getState(), node, chosenResults, (id) =>
                  engine.latest(id),
                )
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
              ...factorCommands(),
              // Roadmap 51d (U23): an automatic name follows the method and the groups.
              ...(existing?.autoName && autoName(parsed.data) !== existing.name
                ? [
                    {
                      type: 'node.set' as const,
                      id: props.analysisId,
                      path: ['name'],
                      value: autoName(parsed.data),
                    },
                  ]
                : []),
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
              ...(chosenResults.length && existing && !retargeted
                ? showOnGraphsCommands(
                    store.getState(),
                    { ...existing, analysisId: def.id, params: parsed.data },
                    chosenResults,
                    (id) => engine.latest(id),
                  )
                : []),
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
    } else if (r.def.id !== defId) {
      pickDef(r.def.id)
      setRailOpen(false)
    }
  }

  /** Roadmap 51a: Use this: the recommended analysis and params, on the list's tab. */
  const useChoice = (c: GuideChoice) => {
    const d = registry.get(c.analysisId)
    if (!d) return
    const parsed = d.params.safeParse(c.params)
    const p = (parsed.success ? parsed.data : d.params.parse({})) as Params
    visited.current.set(defId, { params, selected, roles: roleState })
    visited.current.delete(d.id)
    setDefId(d.id)
    setParams(p)
    const picked = d.numbersByDefault
      ? guide.selection.filter((k) => !table.dataSets.find((x) => x.id === k)?.text)
      : guide.selection
    const n = Math.min(d.inputs.max, picked.length)
    const sel = n >= d.inputs.min ? picked.slice(0, n) : defaultSelection(d, table)
    setSelected(sel)
    touched.current = true
    setRoleState(startRoles(d, sel, p))
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
    const p = def.params.safeParse(effectiveParams)
    return p.success ? (def.cards?.(p.data) ?? []) : []
  })()
  const titleOf = (k: string | undefined) => table.dataSets.find((d) => d.id === k)?.title
  const controlKey =
    typeof effectiveParams.control === 'string' && effectiveParams.control
      ? effectiveParams.control
      : undefined
  const control = titleOf(controlKey)
  const nameA = titleOf(dataSets[0])
  const nameB = titleOf(dataSets[1])
  const names = {
    ...(nameA ? { A: nameA } : {}),
    ...(nameB ? { B: nameB } : {}),
    ...(control ? { control } : {}),
  }

  // Roadmap 51b (§4.3): the groups as chips; a control chosen on its chip moves first.
  // A control matters when the analysis compares with one (or always has one: survival).
  const hasControl =
    def.form.some((f) => f.path.join('.') === 'control') &&
    (!('comparisons' in effectiveParams) || effectiveParams.comparisons === 'vsControl')
  const chips = table.dataSets.map((d) => ({ key: d.id as string, title: d.title }))
  const setControl = (key: string) => {
    touched.current = true
    setParams({ ...params, control: key })
    setSelected([key, ...selected.filter((k) => k !== key)])
  }
  const sentence = comparingText(
    def,
    effectiveParams,
    dataSets.map((k) => titleOf(k) ?? ''),
    titleOf(controlKey ?? dataSets[0]),
  )
  const { min, max } = def.inputs
  const word = setsWord(table.tableKind, 2)
  const countHint =
    min === max
      ? `Choose ${min} ${setsWord(table.tableKind, min)}.`
      : Number.isFinite(max)
        ? `Choose ${min} to ${max} ${word}.`
        : `Choose ${min} or more ${word}.`

  /** The rail: the search and the list (All analyses). */
  const list = (
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
  )

  const hiddenPaths = rolePaths(def)
  // The control is chosen on the chips (and the field), as the comparisons say.
  const showChips = usesData && !roles

  /** Roadmap 35: the results offered on the table's graphs (Reporting, §4.2). */
  const showOnGraph = (
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
  )

  /** The options column: the method, the data, the tiers. */
  const options = (
    <div className="analyze-detail">
      <div className="method-head">
        <h3 className="method-title">{def.title}</h3>
        <p className="muted method-description">{def.description}</p>
      </div>
      {props.mode === 'edit' && seen && changes.length > 0 && (
        <MethodChangeNotice
          changes={changes}
          reason={reason}
          onReason={setReason}
          onAddAsNew={addAsNew}
        />
      )}
      {usesData && others.length > 0 && (
        <DataSourceField
          tables={[original, ...others]}
          value={source.id}
          match={source.match}
          onChange={changeSource}
          warnings={retargeted?.warnings ?? []}
        />
      )}
      {showChips && (
        <GroupChips
          all={chips}
          chosen={selected}
          onChange={(next) => {
            touched.current = true
            setSelected(next)
          }}
          label={
            table.tableKind === 'multipleVariables'
              ? 'Variables'
              : word.replace(/^./, (c) => c.toUpperCase())
          }
          sentence={sentence}
          control={hasControl && dataSets.length > 1 ? (controlKey ?? dataSets[0]) : undefined}
          onControl={hasControl ? setControl : undefined}
          hint={countHint}
        />
      )}
      {usesData && asksFactors && (
        <fieldset className="field factor-names">
          <legend>Factor names</legend>
          <label>
            Rows are{' '}
            <input
              type="text"
              value={factorNames.rows}
              maxLength={80}
              placeholder="Row factor (e.g. Genotype)"
              aria-label="Row factor name"
              onChange={(e) => setFactorNames({ ...factorNames, rows: e.target.value })}
            />
          </label>{' '}
          <label>
            Data sets are{' '}
            <input
              type="text"
              value={factorNames.columns}
              maxLength={80}
              placeholder="Column factor (e.g. Treatment)"
              aria-label="Column factor name"
              onChange={(e) => setFactorNames({ ...factorNames, columns: e.target.value })}
            />
          </label>
          <div className="help">
            Used in the results instead of “Row factor” and “Column factor”.
          </div>
        </fieldset>
      )}
      {usesData && roles && roleState && (
        <RoleBoxes
          roles={roles}
          variables={variables}
          assignment={roleState}
          onChange={setRoleState}
          leftOut={leftOut}
        />
      )}
      <OptionTiers
        def={def}
        states={states}
        params={effectiveParams}
        onChange={setParams}
        custom={FIELDS}
        context={{
          dataSets: table.dataSets
            .filter((d) => dataSets.includes(d.id))
            .map((d) => ({ key: d.id, title: d.title, ...variableInfo(d) })),
          rows: Array.from({ length: table.rowCount }, (_, i) => ({
            index: i,
            title: table.rowTitles?.[i] || `Row ${i + 1}`,
          })),
          facts,
        }}
        onInfo={(f) => setInfoField(infoField === f ? null : f)}
        infoPanel={sideId}
        infoShown={infoField}
        hidden={hiddenPaths}
        reportingExtra={offered.length > 0 && tableGraphs ? showOnGraph : undefined}
        reportingExtraSummary={showOn.size ? 'on graph' : undefined}
      />
    </div>
  )

  /** Roadmap 51e (§4.6, §9.2): a check's one-click fix — params set, or X transformed first. */
  const applyFix = (f: CheckFix) => {
    if (f.action === TRANSFORM_LOG10_X) {
      setTransformFirst(true)
      return
    }
    let p = params
    for (const x of f.set ?? [])
      p =
        x.path.length === 1 && x.path[0] === 'equation'
          ? pickModel(p, String(x.value), 'all')
          : setPath(p, x.path, x.value)
    setParams(p)
  }
  const fixOffered = (f: CheckFix) => f.action !== TRANSFORM_LOG10_X || canTransform

  /** The side panel: the sketch, the checks, the cards. */
  const side = (
    <aside className="analyze-side" id={sideId} aria-label="Your data and the method">
      {schematic && (
        <details
          className="schematic-details"
          open={showSchematic}
          onToggle={(e) => {
            const open = e.currentTarget.open
            schematicOpen = open
            setShowSchematic(open)
          }}
        >
          <summary className="side-heading">What will be tested</summary>
          <SchematicView
            spec={schematic}
            fonts={fonts}
            heading={null}
            compact={width === 'narrow'}
          />
        </details>
      )}
      {sketch && !sketchHidden && <SketchView spec={sketch} fonts={fonts} stale={stale} />}
      {sketch && (
        <button
          type="button"
          className="link sketch-toggle"
          aria-expanded={!sketchHidden}
          onClick={() => setSketchHidden(!sketchHidden)}
        >
          {sketchHidden ? 'Show sketch' : 'Hide sketch'}
        </button>
      )}
      {usesData && (checks.length > 0 || logX) && (
        <section className="checks" aria-label="Checks">
          <h3 className="side-heading">Checks</h3>
          <ul>
            {logX && (
              <li className="check-ok transform-first">
                <span className="check-icon" aria-hidden="true">
                  ✓
                </span>
                <span>
                  X will be transformed to log10 first: Analyze adds a Transform analysis of “
                  {table.name}” and fits its result.{' '}
                  <button
                    type="button"
                    className="link check-fix"
                    onClick={() => setTransformFirst(false)}
                  >
                    Keep X as it is
                  </button>
                </span>
              </li>
            )}
            {checks.map((c) => (
              <li key={`${c.level}:${c.message}`} className={`check-${c.level}`}>
                <span className="check-icon" aria-hidden="true">
                  {c.level === 'block' ? '✗' : c.level === 'note' ? '!' : '✓'}
                </span>
                {c.level === 'block' ? <span className="visually-hidden">Error: </span> : null}
                <span>
                  {c.message}
                  {c.level === 'block' && c.where === 'table' && (
                    <span className="help"> (change the table’s values)</span>
                  )}
                  {c.fix?.filter(fixOffered).map((f) => (
                    <button
                      key={f.label}
                      type="button"
                      className="check-fix"
                      onClick={() => applyFix(f)}
                    >
                      {f.label}
                    </button>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {infoField ? (
        <section className="side-card">
          <h3 className="side-heading">{infoField.label}</h3>
          {infoField.explain?.line && <p>{infoField.explain.line}</p>}
          <FieldCard field={infoField} />
          <button type="button" className="link" onClick={() => setInfoField(null)}>
            Back to About this method
          </button>
        </section>
      ) : (
        cards.length > 0 && (
          <section className="side-card about-method">
            <h3 className="side-heading">About this method</h3>
            <MethodCards ids={cards} names={names} />
          </section>
        )
      )}
    </aside>
  )

  const editing = props.mode === 'edit' && !changing
  const okLabel = props.mode === 'create' ? 'Analyze' : 'Apply'
  const okDisabled = tab === 'guide' || !!block
  const reasonText =
    tab === 'guide' ? 'Choose an analysis (Use this, or All analyses) first.' : block?.message

  const dialogStyle: CSSProperties | undefined = size
    ? { width: `min(${size.width}px, 96vw)`, height: `min(${size.height}px, 92vh)` }
    : undefined
  const onDialogKey = (e: KeyboardEvent<HTMLDialogElement>) => {
    const mod = e.metaKey || e.ctrlKey
    if (mod && e.key === 'Enter') {
      e.preventDefault()
      if (!okDisabled) submit()
    } else if (mod && guided && (e.key === '1' || e.key === '2')) {
      e.preventDefault()
      setTab(e.key === '1' ? 'guide' : 'all')
    } else if (mod && (e.key === 'k' || e.key === 'K') && tab === 'all') {
      e.preventDefault()
      setChanging(true)
      setRailOpen(true)
      setTimeout(() => searchRef.current?.focus(), 0)
    }
  }

  const footer = (
    <>
      <span className="method-line" aria-live="polite">
        {tab === 'all' && <>Method: {methodLine(def.id, effectiveParams)}</>}
      </span>
      {okDisabled && reasonText && (
        <span id={reasonId} className="ok-reason">
          {reasonText}
        </span>
      )}
      <button type="button" onClick={props.onClose}>
        Cancel
      </button>
      <button
        type="button"
        className="primary"
        aria-disabled={okDisabled || undefined}
        disabled={okDisabled}
        aria-describedby={okDisabled && reasonText ? reasonId : undefined}
        onClick={submit}
      >
        {okLabel}
      </button>
    </>
  )

  return (
    <Dialog
      title={
        props.mode === 'create'
          ? `Analyze “${table.name}”`
          : `Edit “${existing?.name ?? def.title}”`
      }
      onClose={props.onClose}
      wide
      className="analyze-dialog"
      style={dialogStyle}
      onKeyDown={onDialogKey}
      footer={footer}
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
        ref={(el) => {
          panelRef.current = el
          observe(el)
        }}
        className="analyze-panel"
        {...(guided
          ? { role: 'tabpanel', id: `${tabId}-panel`, 'aria-labelledby': `${tabId}-${tab}` }
          : {})}
      >
        {tab === 'guide' ? (
          <GuidePanel
            kind={table.tableKind}
            tableName={table.name}
            facts={guideFacts}
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
            fonts={fonts}
            names={guideNames}
            layout={width}
          />
        ) : (
          <div
            className={`analyze analyze3${width === 'wide' ? '' : ' medium'}${width === 'narrow' ? ' narrow' : ''}${editing ? ' editing' : ''}${railOpen ? ' rail-open' : ''}${sketchHidden ? ' sketch-hidden' : ''}`}
          >
            <nav className="analyze-rail" aria-label="Analyses">
              <div className="rail-strip">
                {editing ? (
                  <>
                    <span className="rail-method">{def.title}</span>
                    <button
                      type="button"
                      ref={changeRef}
                      onClick={() => {
                        setChanging(true)
                        setTimeout(() => searchRef.current?.focus(), 0)
                      }}
                    >
                      Change method…
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="rail-toggle"
                    aria-expanded={railOpen}
                    title="All analyses (⌘K)"
                    onClick={() => setRailOpen(!railOpen)}
                  >
                    <span className="rail-method">{def.title}</span> ▸
                  </button>
                )}
              </div>
              {!editing && list}
            </nav>
            <div className="analyze-options-column">{options}</div>
            {side}
          </div>
        )}
      </div>
    </Dialog>
  )
}
