import { type Command, DraftStore } from '@ps/engine'
import {
  graphPalette,
  graphTheme,
  layoutGraph,
  type MarkInfo,
  markInfo,
  SCREEN_SAMPLE,
  type Scene,
  type SceneNode,
} from '@ps/graph'
import type { GraphNode, NodeId } from '@ps/model'
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { useRestoreFocus } from '../../components/Dialog.tsx'
import { useUndoNotice } from '../../components/undoNotice.tsx'
import { useResultLookup, useServices } from '../../context.tsx'
import { entryTargetIn, isLegendEntryPath, sceneIndex } from '../../selection/sceneKeys.ts'
import { errorMessage } from '../../util.ts'
import { cardPlace, HoverCard, useHoverMark } from '../HoverCard.tsx'
import type { PanelContext } from '../inspector/context.ts'
import { type PointRef, pointsFormatted, writePoints } from '../pointEdits.ts'
import { PX_PER_PT, SceneSvg } from '../SceneSvg.tsx'
import { FormatOptions, FormatTabs, shownTarget } from './FormatPanelBody.tsx'
import { FormatSearch, useFieldReveal } from './FormatSearch.tsx'
import {
  clickSelection,
  deselectTarget,
  dialogTitle,
  entryOf,
  type FormatTarget,
  formatTargetFor,
  graphPlace,
  highlightOf,
  layerPlace,
  layerSeriesOf,
} from './route.ts'
import { jumpTarget } from './search.ts'

const SIZE_KEY = 'ps.formatDialogSize'

/** The size the user last gave the Format dialog (null: the default, fitting the window). */
function readDialogSize(): { w: number; h: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem(SIZE_KEY) ?? 'null')
    return v && Number.isFinite(v.w) && Number.isFinite(v.h) && v.w > 0 && v.h > 0
      ? { w: v.w, h: v.h }
      : null
  } catch {
    return null
  }
}

function writeDialogSize(s: { w: number; h: number }) {
  try {
    localStorage.setItem(SIZE_KEY, JSON.stringify(s))
  } catch {}
}

/**
 * Prism-style Format dialogs (graph, axes, legend, bracket, text/line): the Format panel's "Open
 * in window" (roadmap 46). The dialog edits a draft of the document (DraftStore) shown in its live
 * preview; OK replays the draft onto the document as one undo step, Cancel / Escape drop it.
 * Which dialog and tab show follows `target`, which clicking in the preview (or a panel's "Format
 * …" link) changes without closing. Its options are the panel's (`FormatPanelBody.tsx`).
 */
export function FormatDialog({
  graphId,
  initial,
  onClose,
  onChangeLayers,
  onSavePreset,
  onManagePresets,
  onSplit,
  points,
}: {
  graphId: NodeId
  initial: FormatTarget
  onClose: () => void
  /**
   * The points selected in the view when several are (audit 3, U5): a point's place shown for
   * one of them writes its edits to each, as the panel does.
   */
  points?: readonly PointRef[]
  /** Applies the dialog's changes and opens "Split into one graph per…" (roadmap 34d). */
  onSplit?: () => void
  /** Opens the graph builder over the dialog's draft graph (Graph settings › Change layers…). */
  onChangeLayers?: (draft: DraftStore) => void
  /** Saves the draft graph's layers as a preset (Graph settings › Save layers as preset…). */
  onSavePreset?: (graph: GraphNode) => void
  onManagePresets?: () => void
}) {
  const { store, fonts } = useServices()
  const { lookup, version } = useResultLookup()
  const [draft] = useState(() => new DraftStore(store))
  const subscribe = useCallback((fn: () => void) => draft.subscribe(fn), [draft])
  const project = useSyncExternalStore(subscribe, () => draft.getState())
  const graph = project.nodes[graphId] as GraphNode
  const [chosen, setTarget] = useState(initial)
  // Roadmap 47: the layers selected in the dialog's list of layers (it has no canvas selection).
  const [layerIds, setLayerIds] = useState<readonly string[]>([])
  // The right Y axis tab closes when the axis is removed.
  const target = shownTarget(chosen, graph)
  const [error, setError] = useState<string | null>(null)
  const titleId = useId()
  const tabsId = useId()

  const theme = graphTheme(project, graph)
  const palette = graphPalette(graph, theme)
  const together = pointsFormatted(target, points)
  const dispatch = (input: Command | Command[], text?: string) => {
    const { cmds, label } = writePoints(graph, theme, together, input, text)
    try {
      draft.dispatch(cmds, label)
      setError(null)
    } catch (e) {
      setError(errorMessage(e, true))
    }
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: version tracks result changes
  const scene = useMemo(
    // At most 1,000 points per column or group, as on the canvas (decision 450).
    () => layoutGraph({ project, graph, fonts, result: lookup, screen: SCREEN_SAMPLE }),
    [project, graph, fonts, lookup, version],
  )

  const ctx: PanelContext = {
    graph,
    project,
    lookup,
    theme,
    palette,
    set: (path, value, label) => dispatch({ type: 'node.set', id: graph.id, path, value }, label),
    dispatch,
    onSelect: (t) => {
      // Read the draft afresh: a panel may have just added what it now selects.
      const g = draft.getState().nodes[graphId] as GraphNode
      if (t === null && (target.place === 'bracket' || target.place === 'object'))
        setTarget(graphPlace('annotations'))
      else setTarget(formatTargetFor(t, g))
    },
    onError: setError,
    ...(together ? { points: together.all.length } : {}),
    // Roadmap 47b: the legend's entries as the preview draws them.
    ...(scene.legend ? { legend: scene.legend } : {}),
    layerSelection: {
      ids: target.place === 'layer' && layerIds.includes(target.layer) ? layerIds : [],
      primary: target.place === 'layer' ? target.layer : undefined,
      select: (ids, primary) => {
        setLayerIds(ids)
        setTarget(primary === null ? graphPlace('layers') : layerPlace(primary, 'layers'))
      },
    },
    ...(onChangeLayers ? { onChangeLayers: () => onChangeLayers(draft) } : {}),
    ...(onSavePreset
      ? { onSavePreset: () => onSavePreset(draft.getState().nodes[graphId] as GraphNode) }
      : {}),
    ...(onManagePresets ? { onManagePresets } : {}),
    ...(onSplit
      ? {
          onSplit: () => {
            try {
              draft.commit(dialogTitle(target, graph))
              onClose()
              onSplit()
            } catch (e) {
              setError(errorMessage(e, true))
            }
          },
        }
      : {}),
  }

  const title = dialogTitle(target, graph)
  // Roadmap 43: OK's step is announced with its Undo ("Format graph · Undo").
  const trackUndo = useUndoNotice()
  const ok = () => {
    try {
      trackUndo(() => draft.commit(title))
      onClose()
    } catch (e) {
      setError(errorMessage(e, true))
    }
  }

  // --- Modal, movable, resizable --------------------------------------------------------------
  const ref = useRef<HTMLDialogElement>(null)
  const reveal = useFieldReveal(ref, chosen)
  useRestoreFocus()
  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
    // The current tab, or (no tabs) the first control of the options.
    d?.querySelector<HTMLElement>(
      '[data-autofocus], .format-options :is(input, select, button):not(:disabled)',
    )?.focus()
  }, [])
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const moving = useRef<{ x0: number; y0: number; ox: number; oy: number } | null>(null)
  // Roadmap 46 (P3): a size the user drags it to (its corner) is remembered; it opens at it, kept
  // inside the window (CSS: never larger than the window less 16 px).
  const [size] = useState(readDialogSize)
  const resizing = useRef<{ w: number; h: number } | null>(null)
  useEffect(() => {
    const up = () => {
      const d = ref.current
      const from = resizing.current
      resizing.current = null
      if (!d || !from) return
      const [w, h] = [Math.round(d.offsetWidth), Math.round(d.offsetHeight)]
      if (w !== from.w || h !== from.h) writeDialogSize({ w, h })
    }
    window.addEventListener('pointerup', up)
    return () => window.removeEventListener('pointerup', up)
  }, [])

  return (
    <dialog
      ref={ref}
      className="dialog format-dialog"
      aria-labelledby={titleId}
      style={{
        translate: `${offset.x}px ${offset.y}px`,
        ...(size ? { width: size.w, height: size.h } : {}),
      }}
      onPointerDown={(e) => {
        // A press on the dialog's own box (its resize corner), not on its content.
        if (e.target === e.currentTarget)
          resizing.current = { w: e.currentTarget.offsetWidth, h: e.currentTarget.offsetHeight }
      }}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onKeyDown={(e) => {
        const el = e.target as HTMLElement
        const mod = e.metaKey || e.ctrlKey
        // Undo / redo would act on the document behind the dialog: keep them in text fields.
        if (mod && ['z', 'y'].includes(e.key.toLowerCase())) {
          e.stopPropagation()
          return
        }
        if (
          e.key === 'Enter' &&
          !e.defaultPrevented &&
          !e.nativeEvent.isComposing &&
          !['BUTTON', 'SELECT', 'TEXTAREA', 'A', 'SUMMARY'].includes(el.tagName) &&
          (el as HTMLInputElement).type !== 'color'
        ) {
          // Fields commit on Enter themselves (synchronously, into the draft) before this runs.
          e.preventDefault()
          ok()
        }
      }}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: dragging the title bar moves the dialog (a mouse convenience) */}
      <header
        className="format-header"
        onPointerDown={(e) => {
          if (e.button !== 0 || (e.target as Element).closest('button, .format-search')) return
          e.currentTarget.setPointerCapture(e.pointerId)
          moving.current = { x0: e.clientX, y0: e.clientY, ox: offset.x, oy: offset.y }
        }}
        onPointerMove={(e) => {
          const m = moving.current
          // Keep the title bar on screen.
          const cx = window.innerWidth / 2 - 60
          const cy = window.innerHeight / 2 - 40
          const clamp = (v: number, lim: number) => Math.max(-lim, Math.min(lim, v))
          if (m)
            setOffset({
              x: clamp(m.ox + e.clientX - m.x0, cx),
              y: clamp(m.oy + e.clientY - m.y0, cy),
            })
        }}
        onPointerUp={() => {
          moving.current = null
        }}
        onDoubleClick={() => setOffset({ x: 0, y: 0 })}
        title="Drag to move; double-click to centre"
      >
        <h2 id={titleId}>{title}</h2>
        <span className="muted">{graph.name}</span>
        <FormatSearch
          ctx={ctx}
          current={target}
          onJump={(e) => {
            setTarget(jumpTarget(e))
            reveal(e)
          }}
        />
      </header>
      <FormatTabs id={tabsId} label={title} target={target} graph={graph} setTarget={setTarget} />
      <div className="format-body">
        <FormatOptions
          id={tabsId}
          labelledBy={titleId}
          ctx={ctx}
          target={target}
          setTarget={setTarget}
        />
        <Preview
          scene={scene}
          target={target}
          describe={(node) => markInfo(project, graph, node, lookup)}
          onBackground={() => setTarget(deselectTarget(target))}
          onPick={(t, hit, clicks, { alt }) => {
            // A click on empty space deselects, as on the canvas.
            if (!t) {
              setTarget(deselectTarget(target))
              return
            }
            // As on the canvas: a click on a point of the layer's data set being formatted picks
            // the point, Alt-click the whole layer.
            const sel = clickSelection(t, hit?.node.point, highlightOf(target), clicks, alt)
            const layer =
              layerSeriesOf(t)?.layer ??
              (target.place === 'series' || target.place === 'layer' ? target.layer : undefined)
            // Roadmap 47b: the legend first, then (once it is shown) one of its entries.
            const legendFirst =
              isLegendEntryPath(sel) && target.place !== 'legend' && entryOf(target) === undefined
            setTarget(
              formatTargetFor(
                legendFirst ? ['legend'] : sel,
                graph,
                layer,
                entryTargetIn(sceneIndex(scene.root).nodes),
              ),
            )
          }}
        />
      </div>
      <footer className="format-footer">
        <span className={error ? 'format-error' : 'muted'} role={error ? 'alert' : undefined}>
          {error ?? 'OK applies all changes as one undo step; Cancel discards them.'}
        </span>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="primary" onClick={ok}>
          OK
        </button>
      </footer>
    </dialog>
  )
}

/** The draft graph, fitted to the pane; clicking a part of it shows that part's options. */
function Preview({
  scene,
  target,
  onPick,
  onBackground,
  describe,
}: {
  scene: Scene
  target: FormatTarget
  /**
   * A hovered mark's data (roadmap 34d), shown in a card; no Go to row here: the dialog's changes
   * aren't applied yet.
   */
  describe: (node: SceneNode) => MarkInfo | null
  onPick: Parameters<typeof SceneSvg>[0]['onSelect']
  /** A click on the pane around the graph (deselects, like the canvas backdrop). */
  onBackground: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 400, h: 300 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const r = entry!.contentRect
      setBox({ w: r.width, h: r.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const hover = useHoverMark()
  const card = hover.node ? describe(hover.node) : null
  const pad = 16
  const zoom = Math.max(
    0.2,
    Math.min(
      2,
      (box.w - pad * 2) / (scene.width * PX_PER_PT),
      (box.h - pad * 2) / (scene.height * PX_PER_PT),
    ),
  )
  const place = hover.node ? cardPlace(scene.root, scene.width, hover.node, zoom * PX_PER_PT) : null
  const highlight = highlightOf(target)
  // biome-ignore lint/correctness/useExhaustiveDependencies: compared by value, not identity
  const highlighted = useMemo(() => (highlight ? [highlight] : []), [JSON.stringify(highlight)])
  return (
    <section className="format-preview" aria-label="Preview">
      <div className="format-preview-head">
        <strong>Preview</strong>
        <span className="muted">Click part of the graph to format it</span>
      </div>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: clicking around the graph deselects, as on the canvas */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: from the keyboard, the options choose the same (e.g. All data sets) */}
      <div
        className="format-preview-canvas"
        ref={ref}
        onClick={(e) => e.target === e.currentTarget && onBackground()}
      >
        <div className="scene-wrap">
          <SceneSvg
            scene={scene}
            zoom={zoom}
            selected={highlighted}
            onSelect={onPick}
            hoverTarget={(key, hit, { alt }) =>
              clickSelection(key, hit.node.point, highlightOf(target), 1, alt)
            }
            onHoverNode={hover.hover}
            label="Preview of the formatted graph"
          />
          {card && place && <HoverCard info={card} place={place} events={hover.card} />}
        </div>
      </div>
    </section>
  )
}
