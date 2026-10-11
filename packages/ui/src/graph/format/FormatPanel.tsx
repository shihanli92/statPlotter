import type { Command } from '@ps/engine'
import { graphPalette, graphTheme, type LegendItem } from '@ps/graph'
import {
  diffValue,
  type GraphEdit,
  type GraphNode,
  type GraphPathSegment,
  getAt,
  type NodeId,
  type Project,
} from '@ps/model'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { formatShortcut, isMacPlatform } from '../../commands/index.ts'
import { focusVisibly } from '../../components/focusVisibly.ts'
import { useUndoNotice } from '../../components/undoNotice.tsx'
import { useDoc, useResultLookup, useServices } from '../../context.tsx'
import { errorMessage } from '../../util.ts'
import type { LayerSelection, PanelContext } from '../inspector/context.ts'
import { type PointRef, pointsFormatted, writePoints } from '../pointEdits.ts'
import { FormatPanelBody, shownTarget } from './FormatPanelBody.tsx'
import { FormatSearch, useFieldReveal } from './FormatSearch.tsx'
import type { FormatFocus } from './formatHost.ts'
import { panelKeyStays } from './formatHost.ts'
import { PanelSteps } from './panelSteps.ts'
import {
  dialogTitle,
  type FormatTarget,
  formatTargetFor,
  graphPlace,
  highlightOf,
  targetPaths,
} from './route.ts'
import { jumpTarget } from './search.ts'

const WIDTH_KEY = 'ps.formatPanelWidth'
export const PANEL_WIDTH = { min: 280, initial: 340, max: 560 }

function readWidth(): number {
  try {
    const w = Number(localStorage.getItem(WIDTH_KEY))
    return w >= PANEL_WIDTH.min && w <= PANEL_WIDTH.max ? w : PANEL_WIDTH.initial
  } catch {
    return PANEL_WIDTH.initial
  }
}

/** The extras a view offers the panel's buttons (Change layers…, presets, Split…). */
export type PanelActions = Pick<
  PanelContext,
  'onChangeLayers' | 'onSavePreset' | 'onManagePresets' | 'onSplit'
>

/** A path as text, a `{ id }` segment by its id. */
const pathText = (path: readonly GraphPathSegment[]) =>
  path.map((s) => (typeof s === 'object' ? `#${s.id}` : String(s))).join('/')

/**
 * The field a change writes, for merging quick repeats (decision 883's key: field + selection):
 * the paths of the values it sets, none (never merged) for other commands. Audit 3 (U4): a
 * record written whole (a tick style, a legend's place, a bracket's spacing) is keyed by the
 * fields in it that change against `doc`, so two fields of one record are two steps. Only a
 * record of several fields, before and after a record: a value of one field (a colour,
 * `{ palette }` or `{ rgb }`) is one field, whichever form it takes.
 */
export function fieldOf(cmds: Command | Command[], doc?: Project): string | undefined {
  const list = Array.isArray(cmds) ? cmds : [cmds]
  if (!list.length || list.some((c) => c.type !== 'node.set')) return undefined
  const record = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v)
  return list
    .map((c) => {
      if (c.type !== 'node.set') return ''
      const at = `${c.id}:${pathText(c.path)}`
      const value = c.value
      const before = doc ? getAt(doc.nodes[c.id], c.path) : undefined
      if (!record(value) || !record(before)) return at
      if (Object.keys(value).length < 2 && Object.keys(before).length < 2) return at
      const changed: GraphEdit[] = []
      diffValue(before, value, [], changed)
      const leaves = changed.flatMap((e) => (e.kind === 'set' ? [pathText(e.path)] : []))
      return leaves.length ? leaves.map((l) => (l ? `${at}/${l}` : at)).join(',') : at
    })
    .join('|')
}

/**
 * Roadmap 46: the Format panel docked right of the canvas (a drawer over it in narrow windows).
 * It formats the real graph: every change goes straight to the document, one undo step each,
 * quick repeats of one field merged (the format bar's `coalesce`, keyed by field and selection),
 * announced with Undo (a merged step replacing its notice). Revert undoes the steps it made since
 * the selection it formats began. It follows the canvas' selection (`target`); its own links
 * (a layer, a bracket of the list) select on the canvas (`onSelect`). Keys typed in it stay in
 * it; Escape gives the focus back to the canvas.
 */
export function FormatPanel({
  graphId,
  target: given,
  setTarget,
  name,
  scope,
  onSelect,
  onOpenWindow,
  onClose,
  onEscape,
  focus,
  actions = {},
  onNotice,
  layerSelection,
  points,
  legend,
}: {
  graphId: NodeId
  target: FormatTarget
  setTarget: (t: FormatTarget) => void
  /** What it formats ("Y axis", "Data set “Control”"): its heading. */
  name: string
  /** What is selected (a key): Revert's and the merged steps' scope. */
  scope: string
  /**
   * Selects a part of the graph on the canvas (null: nothing), to show `target`; `more`: other
   * parts selected with it (roadmap 49b: the marks of each data set a layer's view formats).
   */
  onSelect: (
    path: (string | number)[] | null,
    target: FormatTarget,
    more?: readonly (string | number)[][],
  ) => void
  onOpenWindow: () => void
  onClose: () => void
  /** Escape: the focus back on the canvas. */
  onEscape: () => void
  focus: FormatFocus | null
  actions?: PanelActions
  onNotice?: (msg: string) => void
  /** Roadmap 47: the layers selected in the view (the list of layers shows and sets them). */
  layerSelection?: LayerSelection
  /**
   * Roadmap 47: the points selected in the view when several are: a point's place shown for one
   * of them writes its edits to each.
   */
  points?: readonly PointRef[]
  /** Roadmap 47b: the legend's entries as the view lays the graph out (`Scene.legend`). */
  legend?: readonly LegendItem[]
}) {
  const { store } = useServices()
  const project = useDoc((d) => d)
  const { lookup } = useResultLookup()
  const titleId = useId()
  const tabsId = useId()
  const ref = useRef<HTMLElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [width, setWidth] = useState(readWidth)
  const trackUndo = useUndoNotice()
  const [steps] = useState(() => new PanelSteps(store))
  steps.begin(`${graphId} ${scope}`)
  useEffect(() => steps.attach(), [steps])
  // A field search's jump: the field revealed once its place is shown.
  const reveal = useFieldReveal(ref, given)

  // The view's canvas keeps its content clear of the panel when it is a drawer over it (CSS).
  useLayoutEffect(() => {
    const view = ref.current?.parentElement
    view?.style.setProperty('--format-panel-width', `${width}px`)
    return () => {
      view?.style.removeProperty('--format-panel-width')
    }
  }, [width])

  // The focus moves in only when asked (opened from the keyboard), at a section or the tab.
  useEffect(() => {
    if (!focus) return
    const el = ref.current
    const at = focus.section
      ? el?.querySelector<HTMLElement>(`[data-format-section="${CSS.escape(focus.section)}"]`)
      : null
    at?.scrollIntoView({ block: 'nearest' })
    const control = (at ?? el)?.querySelector<HTMLElement>(
      at
        ? ':is(input, select, textarea, button):not(:disabled)'
        : // The axes' tab, else the place's first field (not a section's heading).
          '[role="tab"][aria-selected="true"], .format-options :is(input, select, button:not(.section-toggle)):not(:disabled)',
    )
    // Audit 3 (A13): its ring shown (⌘1 is a key pressed with ⌘).
    if (control) focusVisibly(control)
  }, [focus])

  const graph = project.nodes[graphId]
  if (graph?.kind !== 'graph') return null
  const target = shownTarget(given, graph)
  const theme = graphTheme(project, graph)

  // Roadmap 47: a point's place shown for one of several selected points formats them all.
  const together = pointsFormatted(target, points)

  /** One change, straight to the document: one step, or merged into the field's last one. */
  const write = (input: Command | Command[], text?: string) => {
    const { cmds, label } = writePoints(graph, theme, together, input, text)
    const field = fieldOf(cmds, store.getState())
    const key = field === undefined ? undefined : steps.key(field)
    try {
      steps.run(() =>
        trackUndo(
          () => store.dispatch(cmds, label, key === undefined ? {} : { coalesce: key }),
          key === undefined ? {} : { group: key },
        ),
      )
      setError(null)
    } catch (e) {
      setError(errorMessage(e, true))
    }
  }
  const ctx: PanelContext = {
    graph,
    project,
    lookup,
    theme,
    palette: graphPalette(graph, theme),
    set: (path, value, label) => write({ type: 'node.set', id: graph.id, path, value }, label),
    dispatch: write,
    onSelect: (t) => {
      // Read the document afresh: a panel may have just added what it now selects.
      const g = store.getState().nodes[graphId] as GraphNode
      onSelect(
        t,
        t === null && (target.place === 'bracket' || target.place === 'object')
          ? graphPlace('annotations')
          : formatTargetFor(t, g),
      )
    },
    onError: setError,
    ...actions,
    ...(layerSelection ? { layerSelection } : {}),
    ...(together ? { points: together.all.length } : {}),
    ...(legend ? { legend } : {}),
  }

  const reverts = steps.count
  const revert = () => {
    const n = steps.revert()
    if (n) onNotice?.(`Reverted ${n} change${n === 1 ? '' : 's'} to ${name}`)
  }

  const resize = (to: number) => {
    const w = Math.round(Math.max(PANEL_WIDTH.min, Math.min(PANEL_WIDTH.max, to)))
    setWidth(w)
    try {
      localStorage.setItem(WIDTH_KEY, String(w))
    } catch {}
  }

  return (
    <aside
      ref={ref}
      className="format-panel"
      aria-labelledby={titleId}
      style={{ width }}
      data-testid="format-panel"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.defaultPrevented) {
          e.preventDefault()
          onEscape()
          return
        }
        // The view's keys (nudges, Delete, ⌘A, ⌘B…) act on the canvas' selection: not from here.
        if (panelKeyStays(e)) e.stopPropagation()
      }}
    >
      {/* biome-ignore lint/a11y/useSemanticElements: a draggable splitter, not a rule */}
      <div
        className="format-panel-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Format panel width"
        aria-valuenow={width}
        aria-valuemin={PANEL_WIDTH.min}
        aria-valuemax={PANEL_WIDTH.max}
        tabIndex={0}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          e.preventDefault()
          const [x0, w0] = [e.clientX, width]
          const el = e.currentTarget
          el.setPointerCapture(e.pointerId)
          const move = (ev: PointerEvent) => resize(w0 - (ev.clientX - x0))
          const up = () => {
            el.removeEventListener('pointermove', move)
            el.removeEventListener('pointerup', up)
            el.removeEventListener('pointercancel', up)
          }
          el.addEventListener('pointermove', move)
          el.addEventListener('pointerup', up)
          el.addEventListener('pointercancel', up)
        }}
        onDoubleClick={() => resize(PANEL_WIDTH.initial)}
        onKeyDown={(e) => {
          const by = e.key === 'ArrowLeft' ? 16 : e.key === 'ArrowRight' ? -16 : 0
          if (by) {
            e.preventDefault()
            resize(width + by)
          }
        }}
      />
      <header className="format-panel-header">
        <div className="format-panel-title">
          <h2 id={titleId}>{name}</h2>
          <button
            type="button"
            className="format-panel-close"
            aria-label="Close the Format panel"
            title={`Close (${formatShortcut('Mod+1', isMacPlatform())})`}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="format-panel-actions">
          <span className="muted">{graph.name}</span>
          <button
            type="button"
            disabled={reverts === 0}
            title={
              reverts
                ? `Undo the ${reverts === 1 ? 'change' : `${reverts} changes`} made here to ${name}`
                : `Nothing changed here since ${name} was selected`
            }
            onClick={revert}
          >
            Revert
          </button>
          <button
            type="button"
            title={`${dialogTitle(target, graph)} in a dialog with a preview (OK applies, Cancel discards)`}
            onClick={onOpenWindow}
          >
            Open in window
          </button>
        </div>
        <FormatSearch
          ctx={ctx}
          current={target}
          onJump={(e) => {
            // The element selected on the canvas (its place shown), then the field revealed.
            const t = jumpTarget(e)
            onSelect(highlightOf(t), t)
            reveal(e)
          }}
        />
        {error && (
          <p className="format-error" role="alert">
            {error}
          </p>
        )}
      </header>
      <FormatPanelBody
        id={tabsId}
        label={dialogTitle(target, graph)}
        labelledBy={titleId}
        ctx={ctx}
        target={target}
        setTarget={setTarget}
        onStep={(t) => {
          // Roadmap 49b: the layer landed on selected on the canvas, its marks highlighted.
          const [first = null, ...rest] = targetPaths(t)
          onSelect(first, t, rest)
        }}
        reveal={focus?.section}
      />
    </aside>
  )
}
