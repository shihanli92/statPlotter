import { guideEntry, registry } from '@ps/analyses'
import {
  blockRows,
  type ResultsExportOptions,
  resultSheetHtml,
  resultSheetRows,
  toDelimited,
  toHtmlTable,
} from '@ps/io'
import {
  type AnalysisNode,
  type AnalysisResult,
  countLimitFlags,
  DEFAULT_LIMIT_RULE,
  describeLimitRule,
  formatResultValue,
  type GraphNode,
  hasLimitFlags,
  type NodeId,
  paramsOf,
  type ResultBlock,
  type ResultValue,
} from '@ps/model'
import { useEffect, useMemo, useRef, useState } from 'react'
import { type Command, GROUPS, useCommands } from '../commands/index.ts'
import { CommandMenu, type CommandMenuState } from '../components/CommandMenu.tsx'
import type { ShowError } from '../components/Toasts.tsx'
import { useDoc, useResultState, useServices, useSourceTable } from '../context.tsx'
import { useResultsExport } from '../export/dataExport.tsx'
import { copyTable, setClipboardData, type TableCopy, tableCopy } from '../export/tableClipboard.ts'
import { useClipboardEvents } from '../graph/clipboardEvents.ts'
import { newBrackets } from '../graph/graphActions.ts'
import { duplicateComparisons, duplicateText } from '../graph/results/duplicates.ts'
import { frozenCopy } from '../resultTables.ts'
import { SheetNotes } from '../reuse/SheetNotes.tsx'
import { TableView } from '../table/TableView.tsx'
import { errorMessage } from '../util.ts'
import { JobStatus } from './JobStatus.tsx'
import { MethodCards } from './MethodCards.tsx'
import { MethodHistory } from './MethodHistory.tsx'
import { needsHint } from './needs.ts'

/** Numbers line up in a monospace column; words (names, Yes/No) read as normal text. */
const cellClass = (v: ResultValue) =>
  v.kind === 'text' || v.kind === 'bool' || v.kind === 'pSummary' ? 'txt' : 'num'

function Block({
  block,
  settings,
}: {
  block: ResultBlock
  settings: { pValueStyle: 'GP' | 'APA' | 'NEJM'; pValueDigits: number }
}) {
  switch (block.type) {
    case 'note':
      return <p className="note">{block.text}</p>
    case 'keyValue':
      return (
        <table className="results kv">
          {block.title && (
            <thead>
              <tr>
                <th colSpan={2}>{block.title}</th>
              </tr>
            </thead>
          )}
          <tbody>
            {block.rows.map((r, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: labels can repeat ("95% CI of ratio")
              <tr key={i}>
                <td>{r.label}</td>
                <td className={cellClass(r.value)}>{formatResultValue(r.value, settings)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )
    case 'table':
      return (
        <table className="results grid">
          <thead>
            {block.title && (
              <tr>
                <th colSpan={block.columns.length}>{block.title}</th>
              </tr>
            )}
            <tr>
              {block.columns.map((c, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: positional columns
                <th key={i}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: positional rows
              <tr key={i}>
                {row.map((v, j) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: positional cells
                  <td key={j} className={j === 0 ? '' : cellClass(v)}>
                    {formatResultValue(v, settings)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )
  }
}

/** Key of the tab showing an analysis' result table (sheet keys are the plugin's). */
const TABLE_TAB = '\u0000table'

export function ResultsView({
  id,
  onEdit,
  onError,
  onAnalyze,
  onNewGraph,
  onOpen,
}: {
  id: NodeId
  onEdit: () => void
  onError: ShowError
  /** Opens a node (the data table Freeze makes, the table analyzed). */
  onOpen?: (id: NodeId) => void
  /** Analyze / graph a node's data table (here: this analysis' result table). */
  onAnalyze?: (id: NodeId) => void
  onNewGraph?: (id: NodeId) => void
}) {
  const { store } = useServices()
  const node = useDoc((d) => d.nodes[id]) as AnalysisNode
  const settings = useDoc((d) => d.settings)
  const project = useDoc((d) => d)
  const graphs = useMemo(
    () =>
      project.order
        .map((k) => project.nodes[k])
        .filter(
          (n): n is GraphNode =>
            n?.kind === 'graph' &&
            n.seriesSource.table === node.input.source &&
            // Graphs of analysis output only (volcano plot, ROC curve…) take no brackets.
            !(Array.isArray(n.seriesSource.include) && n.seriesSource.include.length === 0),
        ),
    [project, node.input.source],
  )
  // Roadmap 39: values substituted for ones at a detection limit are analysed as numbers.
  const limitNote = useMemo(() => {
    const src = project.nodes[node.input.source]
    if (src?.kind !== 'table' || !hasLimitFlags(src)) return null
    const { below, above } = countLimitFlags(src)
    const n = below + above
    return `${n} ${n === 1 ? 'value' : 'values'} of “${src.name}” ${n === 1 ? 'was' : 'were'} imported at a detection limit and substituted (${describeLimitRule(src.limits ?? DEFAULT_LIMIT_RULE)}). This analysis uses the substituted values; Edit › Limits… on the table changes them.`
  }, [project, node.input.source])
  const state = useResultState(id)
  const result: AnalysisResult | undefined =
    state?.status === 'ready'
      ? state.result
      : state?.status === 'pending'
        ? state.previous
        : undefined
  // The data table this analysis produces (Transform, Normalize…), shown first.
  const table = useSourceTable(id)
  const [tab, setTab] = useState<string | null>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset tab per analysis
  useEffect(() => setTab(null), [id])

  const addBrackets = (graph: GraphNode) => {
    if (!result) return
    // Labelled like the graph's existing brackets, as the Add menu and Format graph do.
    const added = newBrackets(graph, id, result, false)
    if (!added.length) {
      return onError(
        `No new comparisons to add to “${graph.name}” (already shown, or none significant).`,
        'validation',
      )
    }
    try {
      store.dispatch(
        {
          type: 'node.set',
          id: graph.id,
          path: ['annotations'],
          value: [...graph.annotations, ...added],
        },
        'Add significance brackets',
      )
    } catch (e) {
      onError(String(e))
    }
  }

  /** Roadmap 38: the result table as an editable data table of its own (one undo step). */
  const freeze = () => {
    if (!table) return
    const copy = frozenCopy(table, `${node.name} (frozen)`)
    try {
      store.dispatch({ type: 'node.add', node: copy }, 'Freeze as data table')
      onOpen?.(copy.id)
    } catch (e) {
      onError(errorMessage(e))
    }
  }

  const sheets = result?.sheets ?? []
  const tabs = [
    ...(table ? [{ key: TABLE_TAB, title: 'Data table' }] : []),
    ...sheets.map((s) => ({ key: s.key, title: s.title })),
  ]
  const current = tabs.find((t) => t.key === tab) ?? tabs[0]
  const sheet = sheets.find((s) => s.key === current?.key)
  const stale = state?.status === 'pending'

  // Copy (roadmap 26): the sheet shown, or one block (right-click), as a table as on screen: HTML
  // for Word and PowerPoint, tab-separated text for Excel. ⌘C when no text is selected; Edit ›
  // Copy.
  const viewRef = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<CommandMenuState | null>(null)
  const displayed: ResultsExportOptions = { settings }
  const sheetClip = (): TableCopy | null =>
    sheet
      ? tableCopy(
          (guard) => toDelimited(resultSheetRows(sheet, displayed), '\t', { guard }),
          resultSheetHtml(sheet.blocks, displayed, { guard: true }),
        )
      : null
  const blockClip = (b: ResultBlock): TableCopy => {
    const rows = blockRows(b, displayed)
    return tableCopy(
      (guard) => toDelimited(rows, '\t', { guard }),
      toHtmlTable(rows, { guard: true }),
    )
  }
  const copy = (data: TableCopy | null) => {
    if (data)
      copyTable(data, viewRef.current).catch((e: unknown) =>
        onError(`The clipboard could not be written here (${errorMessage(e)}).`),
      )
  }
  useClipboardEvents(viewRef, {
    copy: sheet
      ? (e) => {
          const data = sheetClip()
          if (data && !e.defaultPrevented) setClipboardData(e, data)
        }
      : undefined,
  })
  const exporter = useResultsExport(node.name, result, sheet, onError)

  const analyze = (order: number) => ({
    menu: 'analyze' as const,
    group: GROUPS.analyze.analyze,
    order,
  })
  const commands: Command[] = [
    {
      id: 'analyze.editParameters',
      label: 'Edit parameters…',
      menu: analyze(20),
      icon: 'settings-2',
      hint: 'Change this analysis’ parameters or the data sets it analyzes',
      run: onEdit,
    },
    {
      id: 'analyze.analyzeResultTable',
      label: 'Analyze this table…',
      menu: analyze(30),
      enabled: !!table && !!onAnalyze,
      hint: 'Analyze the data table these results produced',
      run: () => onAnalyze?.(id),
    },
    {
      id: 'analyze.graphResultTable',
      label: 'Graph this table…',
      menu: analyze(40),
      enabled: !!table && !!onNewGraph,
      hint: 'Graph the data table these results produced (it stays linked)',
      run: () => onNewGraph?.(id),
    },
    {
      id: 'analyze.freezeTable',
      label: 'Freeze as data table',
      menu: analyze(45),
      enabled: !!table,
      hint: 'An editable copy of this table as a data table of its own (it no longer follows its source)',
      keywords: ['copy', 'values', 'static', 'detach'],
      run: () => freeze(),
    },
    ...exporter.commands,
  ]
  if (sheet)
    commands.push({
      id: 'edit.copy',
      label: 'Copy',
      menu: { menu: 'edit', group: GROUPS.edit.clipboard, order: 20 },
      shortcut: 'Mod+C',
      nativeShortcut: true,
      icon: 'copy',
      hint: 'Copy this results sheet as tables (paste into Word, PowerPoint or Excel) unless text is selected',
      run: () => copy(sheetClip()),
    })
  useCommands('view', commands)

  // Roadmap 43 (UX review F22): an error says, if it is about too few values, what the analysis
  // needs, and links to the table analyzed.
  const source = project.nodes[node.input.source]
  const errorHelp = (message: string) => {
    const hint = needsHint(registry.get(node.analysisId), message)
    return (
      <>
        {hint && <span className="error-hint">{hint}</span>}
        {source && onOpen && (
          <button
            type="button"
            className="link"
            title={`Open “${source.name}”`}
            onClick={() => onOpen(source.id)}
          >
            Go to table
          </button>
        )}
      </>
    )
  }
  const firstError = result?.diagnostics.findIndex((d) => d.level === 'error') ?? -1

  // Roadmap 51a: How to read this — the method cards' null hypothesis and reading, with the
  // analyzed data sets' names; and, when Guide me set it up, the question it answers.
  const howTo = useMemo(() => {
    const def = registry.get(node.analysisId)
    const parsed = def && paramsOf(def, node)
    const ids = parsed?.ok ? (def?.cards?.(parsed.params) ?? []) : []
    const src = project.nodes[node.input.source]
    const titleOf = (k: string | undefined) =>
      src?.kind === 'table' ? src.dataSets.find((d) => d.id === k)?.title : undefined
    const p = (parsed?.ok ? parsed.params : {}) as { control?: unknown }
    const [a, b] = [titleOf(node.input.dataSets[0]), titleOf(node.input.dataSets[1])]
    const control = typeof p.control === 'string' ? titleOf(p.control) : undefined
    return {
      ids,
      names: { ...(a ? { A: a } : {}), ...(b ? { B: b } : {}), ...(control ? { control } : {}) },
    }
  }, [node, project])
  const guided = node.origin?.guide
  const duplicates = useMemo(
    () =>
      Object.values(project.nodes).flatMap((g) =>
        g.kind === 'graph'
          ? duplicateComparisons(g, project).filter((d) => d.tests.some((t) => t.analysis === id))
          : [],
      ),
    [project, id],
  )

  return (
    <div className="results-view" ref={viewRef}>
      {menu && <CommandMenu menu={menu} onClose={() => setMenu(null)} />}
      {exporter.dialog}
      <div className="view-toolbar">
        <button type="button" onClick={onEdit}>
          Parameters…
        </button>
        {table && (
          <button
            type="button"
            onClick={freeze}
            title="An editable copy of this table as a data table of its own (it no longer follows its source)"
          >
            Freeze as data table
          </button>
        )}
        {result &&
          result.comparisons.length > 0 &&
          graphs.map((g) => (
            <button type="button" key={g.id} onClick={() => addBrackets(g)}>
              Add brackets to “{g.name}”
            </button>
          ))}
        <span className="hint">
          {state?.status === 'pending' && 'Updating…'}
          {state?.status === 'ready' && 'Up to date'}
        </span>
      </div>
      <SheetNotes node={node} />
      {howTo.ids.length > 0 && (
        <details className="how-to-read">
          <summary>How to read this</summary>
          {guided && (
            <p className="muted">
              Set up with Guide me: “{guideEntry(guided.entry)?.question ?? guided.entry}”
              {guided.followed ? '' : ', then changed in the options'}.
            </p>
          )}
          <MethodCards ids={howTo.ids} names={howTo.names} mode="reading" />
        </details>
      )}
      {/* Roadmap 51c (§7.1, §7.5): the method's changes, and other tests of the same pairs. */}
      <MethodHistory node={node} />
      {duplicates.map((d) => (
        <div key={d.key} className="banner warning duplicate-tests" role="note">
          {duplicateText(d)} on “{d.graphName}”: {d.tests.map((t) => t.name).join('; ')}.
        </div>
      ))}
      {limitNote && (
        <div className="banner info limit-note" role="note">
          {limitNote}
        </div>
      )}
      <JobStatus id={id} state={state} />
      {state?.status === 'error' && !state.cancelled && (
        <div className="banner error results-error">
          <span>{state.message}</span>
          {errorHelp(state.message)}
        </div>
      )}
      {result && result.diagnostics.length > 0 && (
        <ul className="diagnostics">
          {result.diagnostics.map((d, i) => (
            <li key={d.message} className={d.level}>
              {i === firstError ? (
                <span className="results-error">
                  <span>{d.message}</span>
                  {errorHelp(d.message)}
                </span>
              ) : (
                d.message
              )}
            </li>
          ))}
        </ul>
      )}
      {state?.status === 'pending' && state.message && (
        <div className="banner info">{state.message}</div>
      )}
      {tabs.length > 1 && (
        <div className="tabs" role="tablist">
          {tabs.map((t) => (
            <button
              type="button"
              role="tab"
              aria-selected={t.key === current?.key}
              key={t.key}
              className={t.key === current?.key ? 'on' : ''}
              onClick={() => setTab(t.key)}
            >
              {t.title}
            </button>
          ))}
        </div>
      )}
      {current?.key === TABLE_TAB && table ? (
        <div className={`result-table ${stale ? 'stale' : ''}`}>
          <TableView id={id} source={table} onError={onError} />
        </div>
      ) : (
        <div className={`sheet ${stale ? 'stale' : ''}`}>
          {sheet?.blocks.map((b, i) => (
            // biome-ignore lint/a11y/noStaticElementInteractions: a context menu for the block
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: blocks are positional
              key={i}
              className="block"
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({
                  x: e.clientX,
                  y: e.clientY,
                  label: 'Results',
                  entries: [
                    ...(b.type === 'note'
                      ? []
                      : [{ label: 'Copy table', onSelect: () => copy(blockClip(b)) }]),
                    { command: 'edit.copy', label: 'Copy sheet' },
                  ],
                })
              }}
            >
              <Block block={b} settings={settings} />
            </div>
          ))}
          {!result && state?.status !== 'error' && <p className="muted">Calculating…</p>}
        </div>
      )}
    </div>
  )
}
