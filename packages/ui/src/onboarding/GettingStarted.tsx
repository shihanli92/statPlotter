import type { NodeId, Project } from '@ps/model'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { GROUPS, useCommandRegistry, useCommands } from '../commands/index.ts'
import { useDoc, useServices } from '../context.tsx'
import { type FigureExporter, figureExports } from '../worker/figureExport.ts'
import {
  type CardPref,
  documentTicks,
  doneCount,
  isFormatEdit,
  NO_TICKS,
  readCardPref,
  STEPS,
  type StepId,
  type Ticks,
  tableHasValues,
  tickMore,
  writeCardPref,
} from './steps.ts'

// Roadmap 47 (UX findings N8, N9): the getting-started checklist, a small card at the bottom of
// the navigator on a new project. Its steps tick themselves off (`steps.ts`); each one not done
// has a "Show me" that does the next sensible thing through the command registry (New data
// table…, New graph…, Analyze…, the Format panel, Export…), selecting a table or graph first when
// the command needs one. × hides it for good (localStorage); Help › Getting started shows it
// again. It never takes the focus.

/** What the keyboard reaches. */
const TABBABLE = 'button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])'

/**
 * Audit 3 (A8): where the focus goes when `el` goes with it inside — the last control before it
 * in the page (the navigator's last row), else the first after it.
 */
function neighbourOf(el: HTMLElement): HTMLElement | null {
  const all = [...document.querySelectorAll<HTMLElement>(TABBABLE)].filter(
    (c) =>
      !el.contains(c) &&
      !(c as HTMLButtonElement).disabled &&
      c.tabIndex >= 0 &&
      !c.closest('[hidden], [inert], [aria-hidden="true"]'),
  )
  const before = all.filter((c) => el.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_PRECEDING)
  return before.at(-1) ?? all.find((c) => !before.includes(c)) ?? null
}

/** How long a "Show me" waits for its command to become available (a sheet being opened). */
const PENDING_MS = 3000

interface Session {
  /** The project started empty (a new project): the card is offered. */
  fresh: boolean
  ticks: Ticks
}

export function GettingStarted({
  selected,
  onSelect,
  onShow,
  exporter = figureExports,
}: {
  selected: NodeId | null
  onSelect: (id: NodeId) => void
  /** Shows the navigator (hidden from the View menu), which holds the card. */
  onShow?: () => void
  /** The figure exporter whose finished exports tick "Export a graph" (tests pass their own). */
  exporter?: Pick<FigureExporter, 'finished' | 'subscribe'>
}) {
  const { store } = useServices()
  const registry = useCommandRegistry()
  const project = useDoc((d) => d)
  const id = useId()
  const [pref, setPrefState] = useState<CardPref>(() => readCardPref())
  const setPref = (p: CardPref) => {
    setPrefState(p)
    writeCardPref(p)
  }
  // Shown on any project once asked for (Help › Getting started), for this window's session.
  const [asked, setAsked] = useState(false)
  const [session, setSession] = useState<Session>(() => ({
    fresh: store.getState().order.length === 0,
    ticks: NO_TICKS,
  }))
  const tick = useCallback(
    (more: Partial<Record<StepId, boolean>>) =>
      setSession((s) => {
        const ticks = tickMore(s.ticks, more)
        return ticks === s.ticks ? s : { ...s, ticks }
      }),
    [],
  )

  // A project replaced: offered again when it is empty, its steps to do again. Format edits.
  useEffect(() => {
    let before = store.getState()
    return store.subscribe((after, change) => {
      if (change.kind === 'reset') setSession({ fresh: after.order.length === 0, ticks: NO_TICKS })
      else if (isFormatEdit(before, after, change)) tick({ format: true })
      before = after
    })
  }, [store, tick])
  // What the document shows done stays done (deleting the table later unticks nothing).
  // biome-ignore lint/correctness/useExhaustiveDependencies: `session.fresh` re-reads after a reset
  useEffect(() => tick(documentTicks(project)), [project, session.fresh])
  // An export or copy finished.
  useEffect(() => {
    let seen = exporter.finished
    return exporter.subscribe(() => {
      if (exporter.finished === seen) return
      seen = exporter.finished
      tick({ export: true })
    })
  }, [exporter, tick])

  // ---- Show me ----------------------------------------------------------------------------------
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  /** A command to run once the sheet it needs is shown (`when`) and it is enabled. */
  const pending = useRef<{ command: string; when: NodeId | null; until: number } | null>(null)
  const attempt = () => {
    const p = pending.current
    if (!p) return
    if (Date.now() > p.until) {
      pending.current = null
      return
    }
    if (p.when && selectedRef.current !== p.when) return
    if (registry.run(p.command)) pending.current = null
  }
  // Commands are registered as the views mount: tried once that has settled.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` reads refs only
  useEffect(
    () => registry.subscribe(() => void (pending.current && setTimeout(attempt, 0))),
    [registry],
  )
  // biome-ignore lint/correctness/useExhaustiveDependencies: on a sheet shown
  useEffect(() => {
    if (pending.current) setTimeout(attempt, 0)
  }, [selected])
  const runOn = (command: string, sheet: NodeId | null) => {
    pending.current = { command, when: sheet, until: Date.now() + PENDING_MS }
    if (sheet && selectedRef.current !== sheet) onSelect(sheet)
    else attempt()
  }

  const nodes = (p: Project) => p.order.map((nid) => p.nodes[nid]).filter((n) => !!n)
  /** The table a graph or an analysis is made of: the one shown, else one with values. */
  const tableToUse = (): NodeId | null => {
    const shown = selected ? project.nodes[selected] : undefined
    if (shown?.kind === 'table' || shown?.kind === 'analysis') return shown.id
    const tables = nodes(project).filter((n) => n.kind === 'table')
    return (tables.find((t) => t.kind === 'table' && tableHasValues(t)) ?? tables[0])?.id ?? null
  }
  const graphToUse = (): NodeId | null => {
    const shown = selected ? project.nodes[selected] : undefined
    if (shown?.kind === 'graph') return shown.id
    return nodes(project).find((n) => n.kind === 'graph')?.id ?? null
  }
  const showMe = (step: StepId) => {
    if (step === 'data') return void registry.run('insert.table')
    if (step === 'graph' || step === 'analysis') {
      const table = tableToUse()
      if (!table) return void registry.run('insert.table')
      return runOn(step === 'graph' ? 'insert.graph' : 'analyze.guide', table)
    }
    const graph = graphToUse()
    if (!graph) return showMe('graph')
    runOn(step === 'format' ? 'format.graph' : 'file.export', graph)
  }

  useCommands('app', [
    {
      id: 'help.gettingStarted',
      label: 'Getting started',
      menu: { menu: 'help', group: GROUPS.help.commands, order: 30 },
      keywords: ['checklist', 'tutorial', 'onboarding', 'first steps', 'help'],
      hint: 'Show the getting-started checklist at the bottom of the navigator',
      run: () => {
        setAsked(true)
        if (pref === 'hidden') setPref('open')
        onShow?.()
      },
    },
  ])

  const cardRef = useRef<HTMLElement>(null)
  /** Hidden for good (× or Hide this); the focus, if in the card, to its neighbour (A8). */
  const hide = () => {
    const el = cardRef.current
    if (el?.contains(document.activeElement)) neighbourOf(el)?.focus()
    setPref('hidden')
  }
  const shown = pref !== 'hidden' && (session.fresh || asked)
  if (!shown) return null
  const { ticks } = session
  const done = doneCount(ticks)
  const all = done === STEPS.length
  const collapsed = pref === 'collapsed'
  return (
    <section ref={cardRef} className="getting-started" aria-labelledby={`${id}-title`}>
      <div className="gs-head">
        <button
          type="button"
          className="gs-toggle"
          aria-expanded={!collapsed}
          aria-controls={collapsed ? undefined : `${id}-body`}
          onClick={() => setPref(collapsed ? 'open' : 'collapsed')}
        >
          <span className="gs-chevron" aria-hidden="true">
            {collapsed ? '▸' : '▾'}
          </span>
          <span id={`${id}-title`} className="gs-title">
            Getting started
          </span>
          <span className="gs-count">
            {done} of {STEPS.length}
          </span>
        </button>
        <button
          type="button"
          className="gs-close"
          aria-label="Hide getting started"
          title="Hide (Help › Getting started shows it again)"
          onClick={hide}
        >
          ×
        </button>
      </div>
      <div className="gs-meter" aria-hidden="true">
        <span style={{ width: `${(done / STEPS.length) * 100}%` }} />
      </div>
      {!collapsed && (
        <div id={`${id}-body`} className="gs-body">
          {all && (
            <p className="gs-all" role="status">
              All done: you’ve tried the basics.{' '}
              <button type="button" className="link" onClick={hide}>
                Hide this
              </button>
            </p>
          )}
          <ol className="gs-steps">
            {STEPS.map((s) => {
              const ok = ticks[s.id]
              return (
                <li key={s.id} className={ok ? 'done' : undefined} data-step={s.id}>
                  <span className="gs-check" aria-hidden="true">
                    {ok ? '✓' : ''}
                  </span>
                  <span className="gs-step" id={`${id}-${s.id}`}>
                    {s.title}
                    <span className="visually-hidden">{ok ? ' (done)' : ' (to do)'}</span>
                  </span>
                  {!ok && (
                    <button
                      type="button"
                      className="link gs-show"
                      aria-describedby={`${id}-${s.id}`}
                      title={s.hint}
                      onClick={() => showMe(s.id)}
                    >
                      Show me
                    </button>
                  )}
                </li>
              )
            })}
          </ol>
        </div>
      )}
    </section>
  )
}
