import { type DraftStore, editCommands } from '@ps/engine'
import {
  canMoveLayers,
  graphScale,
  graphTheme,
  layerTitle,
  layoutGraph,
  type MarkInfo,
  markInfo,
  markSeries,
  newLayerIndex,
  newStyleLayer,
  SCREEN_SAMPLE,
  type SceneNode,
  type StylePath,
  styleAllowed,
  styleContext,
  stylesFor,
} from '@ps/graph'
import {
  type GraphNode,
  labelRuns,
  mergeRuns,
  type NodeId,
  type PresetRecipe,
  presetRecipe,
  type RichText,
  richPlain,
  sourceTable,
  type TextAlign,
} from '@ps/model'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import {
  CANVAS_KEYS,
  type Command,
  GROUPS,
  isViewKey,
  TOOLBAR_GROUPS,
  useCommands,
} from '../commands/index.ts'
import { formatShortcut, isMacPlatform } from '../commands/shortcut.ts'
import { CommandMenu, type CommandMenuState } from '../components/CommandMenu.tsx'
import type { MenuEntry } from '../components/commandItems.ts'
import { NoticeDialog } from '../components/Dialog.tsx'
import type { MenuItem } from '../components/Menu.tsx'
import { useConfirm } from '../components/modals.tsx'
import type { ShowError } from '../components/Toasts.tsx'
import { Tooltip } from '../components/Tooltip.tsx'
import { useUndoNotice } from '../components/undoNotice.tsx'
import { useDoc, useResultLookup, useServices, useSourceTable } from '../context.tsx'
import { sourceDataCommand, useWorkbookExport } from '../export/dataExport.tsx'
import { graphSourceSheets } from '../export/workbooks.ts'
import { editedElement, setEditedStyle } from '../formatBar/editStyle.ts'
import { FormatBar } from '../formatBar/FormatBar.tsx'
import { elementTarget } from '../formatBar/selectionStyles.ts'
import { EndHandles } from '../layout/handles.tsx'
import { SheetNotes } from '../reuse/SheetNotes.tsx'
import { sameRichText } from '../richText/model.ts'
import { EditorDock, RichTextEditor } from '../richText/RichTextEditor.tsx'
import {
  type AnnotationsOf,
  holdAnnotations,
  placeAnnotations,
} from '../selection/annotationKeys.ts'
import {
  clickSelect,
  elementName,
  elementOrder,
  entryStep,
  hoverSelect,
  marqueeSelect,
  replaceSelection,
  selectAll,
  selectedDataSets,
  selectionAnnouncement,
  stepIn,
  stepOut,
  tabStep,
} from '../selection/graphSelection.ts'
import { type BoxRule, picksInBox } from '../selection/pickInBox.ts'
import { kindName, kindOf, type SameScope, selectSameKind } from '../selection/sameKind.ts'
import {
  entryKeyOf,
  entryTargetIn,
  hitKey,
  hoverMarks,
  isLegendEntryPath,
  keyResolves,
  keysMatcher,
  sceneIndex,
} from '../selection/sceneKeys.ts'
import {
  EMPTY_SELECTION,
  elementKey,
  elementPaths,
  keyId,
  selectionOf as keysSelection,
  primaryPath,
  resolveSelection,
  type Selection,
  sameSelection,
  single,
} from '../selection/selection.ts'
import {
  FORMAT_MENU_IDS,
  sameKindCommands,
  selectionCommandEntries,
  selectMenuEntry,
} from '../selection/selectionMenu.ts'
import { requestReveal } from '../table/reveal.ts'
import { errorMessage } from '../util.ts'
import { GraphBuilder } from './builder/GraphBuilder.tsx'
import { CanvasOverlay, InsertionLine, readoutAt, TreeHandleRect } from './CanvasOverlay.tsx'
import {
  type CanvasDrag,
  dragOutcome,
  type ElementDrag,
  type MarqueeDrag,
  marqueeBox,
} from './canvasDrag.ts'
import {
  dragTargetAt,
  editTextStyle,
  legendLabelAt,
  lineEndPoint,
  nudgeBy,
  resetPositionOf,
  selectionOf,
  type TextEdit,
  textEditAt,
} from './canvasEdit.ts'
import { ELEMENT_SNAP_PX } from './canvasSnap.ts'
import { useClipboardEvents } from './clipboardEvents.ts'
import { type CopySource, copyFigureSvgCode, copyToClipboard } from './copyGraph.ts'
import { followPointer, type PointerSample } from './dragFrames.ts'
import { figureSourceOf, useExport } from './ExportDialog.tsx'
import { emptyGraphTable } from './emptyGraph.ts'
import { FormatDialog } from './format/FormatDialog.tsx'
import { FormatPanel } from './format/FormatPanel.tsx'
import { formatPanelCommands, useFormatHost } from './format/formatHost.ts'
import {
  axisPlace,
  describeTarget,
  type FormatTarget,
  formatTargetFor,
  graphPlace,
  LEGEND_PLACE,
  layerOfSelection,
  layerPlace,
  layerSeriesOf,
  layerView,
  placeName,
  selectionTarget,
  selectionText,
  singleMarkName,
} from './format/route.ts'
import {
  bracketableAnalyses,
  missingCurves,
  newBrackets,
  newLine,
  newTextBox,
} from './graphActions.ts'
import {
  cardPlace,
  HoverCard,
  scenePoints,
  selectedPoint,
  useHoverMark,
  useModifierHeld,
} from './HoverCard.tsx'
import { addTypedLayer, TreatmentGridDialog, typedLayer } from './inspector/AxisExtras.tsx'
import type { LayerSelection } from './inspector/context.ts'
import { addFunctionCommands } from './inspector/GraphSections.tsx'
import { addIdentityLayer, hasContinuousAxes, identityLayer } from './inspector/IdentityLine.tsx'
import {
  chosenLayers,
  duplicateLayersCommands,
  graphSeries,
  layersLabel,
  moveLayersCommands,
  removeLayersCommands,
  removeLayersQuestion,
  visibilityCommands,
} from './inspector/layers.ts'
import { VolcanoDialog, volcanoCommands } from './inspector/Volcano.tsx'
import {
  barSelection,
  entriesShownCommand,
  labelCommand,
  moveEntriesCommand,
  shownEntries,
  shownLabel,
} from './legendEdits.ts'
import { type PointRef, pointsName } from './pointEdits.ts'
import { ManagePresetsDialog, SavePresetDialog } from './presets/PresetDialogs.tsx'
import { printView } from './print.ts'
import { anchorPoint, type ResizeHandle, sizeTargets } from './resize.ts'
import { ResultDialog, type ResultDialogMode } from './results/ResultDialogs.tsx'
import {
  isSurvivalGraph,
  resultAnalyses,
  resultsAllowed,
  riskTableCommand,
} from './results/resultActions.ts'
import { HALO, HOVER_LIMIT, modsOf, PX_PER_PT, type SceneHit, SceneSvg } from './SceneSvg.tsx'
import { SplitDialog } from './SplitDialog.tsx'
import { screenScenes } from './sceneCache.ts'
import {
  deletable,
  deleteEdits,
  graphCommands,
  movableTargets,
  moveEdits,
  moveLabel,
  resetPaths,
} from './selectionEdits.ts'
import { swapMappedXY, swappable } from './swapXY.ts'
import { treeHandle } from './treeDrag.ts'
import {
  EmptyGraphNote,
  EVERY_POINT_HINT,
  EVERY_POINT_LABEL,
  ScreenSampleNote,
  useEveryPoint,
  Warnings,
  ZoomSelect,
} from './ViewChrome.tsx'
import { copyCommands, exportCommands, FORMAT_SHORTCUT, zoomCommands } from './viewCommands.ts'
import { GRAPH_ZOOMS } from './zoom.ts'

export function GraphView({
  id,
  onError,
  onNotice = onError,
  onOpen,
  initialFormat,
}: {
  id: NodeId
  onError: ShowError
  /** A passing message ("Copied … as vector (SVG) and image (PNG)."). */
  onNotice?: (msg: string) => void
  /** Show another node (e.g. a duplicate just made). */
  onOpen?: (id: NodeId) => void
  /** A Format dialog to open at once (e.g. on the function of a graph just made). */
  initialFormat?: FormatTarget
}) {
  const services = useServices()
  const { fonts, platform, store } = services
  const project = useDoc((d) => d)
  const graph = project.nodes[id] as GraphNode
  const canvasHint = useId()
  const { lookup, version } = useResultLookup()
  /**
   * What is selected (roadmap 44, decision 850): element keys of this graph, the primary one
   * feeding everything that acts on one element (the Format dialog, the hint, the hover card),
   * and the layer's marks a selected point was picked from (`drill`, decision 243). Held as set;
   * what is shown leaves out keys that no longer name anything drawn (`sel` below). Annotations
   * are held by id (audit 3, U2: `annotationKeys.ts`), at their indices now in `selState`.
   */
  const [held, setHeld] = useState<Selection>(EMPTY_SELECTION)
  /** The graph's annotations now (the store's: a selection set right after an edit). */
  const annotationsNow: AnnotationsOf = (k) =>
    k.kind === 'element' && k.graph === id
      ? ((store.getState().nodes[id] as GraphNode | undefined)?.annotations ?? [])
      : undefined
  const setSelState = (next: Selection | ((prev: Selection) => Selection)) =>
    setHeld((prev) =>
      holdAnnotations(
        typeof next === 'function' ? next(placeAnnotations(prev, annotationsNow)) : next,
        annotationsNow,
      ),
    )
  const selState = useMemo(
    () =>
      placeAnnotations(held, (k) =>
        k.kind === 'element' && k.graph === id ? graph.annotations : undefined,
      ),
    [held, graph.annotations, id],
  )
  /** One element (or nothing) selected, a point remembering where it was picked from. */
  const setSelected = (t: StylePath | null) =>
    setSelState((prev) => replaceSelection(prev, graph.id, t))
  const [zoom, setZoom] = useState(1.5)
  const trackUndo = useUndoNotice()
  const confirm = useConfirm()

  // Direct manipulation: dragging elements (legend, annotations, titles, tick labels, brackets,
  // point labels) and the plot's resize handles, editing text in place.
  const [drag, setDrag] = useState<CanvasDrag | null>(null)
  const [edit, setEdit] = useState<TextEdit | null>(null)
  const k = zoom * PX_PER_PT

  const table = useSourceTable(graph.seriesSource.table)
  // On screen at most 1,000 points per column or group unless every point is asked for
  // (decision 450); exports lay the graph out again with every point (`figure`).
  const [every, setEvery] = useEveryPoint(graph.id)
  const screen = every ? {} : { screen: SCREEN_SAMPLE }
  // `lookup` reads live engine state, so `version` stands in for "results changed". The scene
  // cache lays the graph out again only when what it read changed (audit 2, P3, P15): the
  // graph, its tables, the project's settings or its own analyses' results, not an edit
  // elsewhere in the project or another analysis' result; the same scene otherwise, so nothing
  // derived from it is redone.
  // biome-ignore lint/correctness/useExhaustiveDependencies: version tracks result changes
  const baseScene = useMemo(
    () => screenScenes.layout({ project, graph, fonts, result: lookup, ...screen }),
    [graph, project, fonts, lookup, version, every],
  )
  // The selection as drawn: keys of things the scene no longer draws (an undone title, a removed
  // layer, a hidden data set) left out, the same object while every key resolves; a whole layer
  // stays while the graph has it (roadmap 47: chosen in the list of layers, hidden or not).
  const { nodes: sceneNodes, marks: sceneMarks } = sceneIndex(baseScene.root)
  const sel = useMemo(
    () =>
      resolveSelection(
        selState,
        (key) =>
          key.kind === 'element' &&
          key.graph === graph.id &&
          keyResolves(sceneMarks, graph, key.path),
      ),
    [selState, sceneMarks, graph],
  )
  /** The primary key (null: nothing selected, the graph itself is the target). */
  const selected = primaryPath(sel)
  const drill = sel.drill ?? null
  const paths = useMemo(() => elementPaths(sel, graph.id), [sel, graph.id])
  const several = paths.length > 1
  /** The graph's top-level elements in reading order (⌘A, Tab). */
  const order = useMemo(() => elementOrder(graph, sceneNodes.all), [graph, sceneNodes])
  // Data sets' names for the hint, undo labels and screen readers.
  // biome-ignore lint/correctness/useExhaustiveDependencies: version tracks result changes
  const titles = useMemo(() => {
    const m = new Map(graphSeries(project, graph, lookup).map((x) => [x.key, x.title]))
    // Roadmap 47b: other legend entries (classes, result lines, categories) by their labels.
    for (const e of baseScene.legend ?? [])
      if (!m.has(e.key)) m.set(e.key, richPlain(labelRuns(e.label)))
    return (key: string) => m.get(key)
  }, [project, graph, lookup, version, baseScene])
  /**
   * Roadmap 47b: the legend's entries as laid out (every entry, hidden ones too), what a legend
   * entry's key formats (its scene target), and the selected entries' keys.
   */
  const legendItems = baseScene.legend ?? []
  const entryTarget = useMemo(() => entryTargetIn(sceneNodes), [sceneNodes])
  // Roadmap 43: the table this graph waits for values of, while none of its series has any.
  const emptyTable = useMemo(() => emptyGraphTable(project, graph), [graph, project])
  /** A drag's effect (see `dragOutcome`), against the graph as it was when the drag began. */
  const outcomeOf = (d: ElementDrag) =>
    dragOutcome(graph, baseScene, d, {
      threshold: ELEMENT_SNAP_PX / k,
      sizes: d.kind === 'resize' ? sizeTargets(project, graph) : [],
    })
  // biome-ignore lint/correctness/useExhaustiveDependencies: outcomeOf reads graph, baseScene, k
  const outcome = useMemo(
    () => (drag && drag.kind !== 'marquee' ? outcomeOf(drag) : null),
    [drag, graph, baseScene, k],
  )
  // biome-ignore lint/correctness/useExhaustiveDependencies: version tracks result changes
  const scene = useMemo(
    () =>
      // (A legend entry's drag changes nothing until it is dropped.)
      outcome && outcome.graph !== graph
        ? layoutGraph({ project, graph: outcome.graph, fonts, result: lookup, ...screen })
        : baseScene,
    [outcome, baseScene, project, fonts, lookup, version, every],
  )
  /**
   * What exports, copies and prints draw: the graph with every point (the canvas may draw a
   * sample), laid out and written in the export worker (roadmap 42).
   */
  const figure = (): CopySource => ({
    source: figureSourceOf(services),
    target: { kind: 'graph', graph: graph.id },
  })

  // The click that ends a real drag selects what was dragged, not what is under the pointer.
  const afterDrag = useRef<Selection | null>(null)

  // While dragging, a point of the plot stays put on screen however the graph reflows: the edge
  // or corner opposite a resize handle (the plot grows away from it), the bottom-left corner for
  // a moved element (which may grow the margins).
  const wrapRef = useRef<HTMLDivElement>(null)
  const anchor = useRef<{ x: number; y: number } | null>(null)
  const shifted = useRef({ x: 0, y: 0 })
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const a = drag ? anchor.current : null
    let [sx, sy] = [0, 0]
    if (a) {
      const r = el.getBoundingClientRect()
      const p = anchorPoint(scene.plot, drag?.kind === 'resize' ? drag.handle : null)
      sx = a.x - (r.left - shifted.current.x + p.x * k)
      sy = a.y - (r.top - shifted.current.y + p.y * k)
    }
    if (sx === shifted.current.x && sy === shifted.current.y) return
    shifted.current = { x: sx, y: sy }
    el.style.transform = sx || sy ? `translate(${sx}px, ${sy}px)` : ''
  })

  /**
   * Follows the pointer anywhere on the page from a press; the drag starts only once the pointer
   * really moves (dragging re-lays the graph out, which would replace the elements under a plain
   * click or double-click). Shown once an animation frame at most (roadmap 45), the latest
   * position; commits on release, from the last pointer move, as one undo step.
   */
  const follow = (
    e: React.PointerEvent,
    start: (ev: PointerSample) => ElementDrag,
    selectAfter: Selection,
    handle: ResizeHandle | null = null,
  ) => {
    const x0 = e.clientX
    const y0 = e.clientY
    const r = wrapRef.current?.getBoundingClientRect()
    const p = anchorPoint(baseScene.plot, handle)
    anchor.current = r
      ? { x: r.left - shifted.current.x + p.x * k, y: r.top - shifted.current.y + p.y * k }
      : null
    followPointer<ElementDrag>(x0, y0, {
      // What is dragged is selected from the start (its halo follows it).
      onStart: () => setSelState(selectAfter),
      at: (ev) => ({ ...start(ev), dx: (ev.clientX - x0) / k, dy: (ev.clientY - y0) / k }),
      show: (d) => flushSync(() => setDrag(d)),
      end: (d) => {
        if (d) commitDrag(d, selectAfter)
      },
    })
  }
  /** The end of a move or resize: what was dragged selected, the edit dispatched. */
  const commitDrag = (d: ElementDrag, selectAfter: Selection) => {
    setDrag(null)
    afterDrag.current = selectAfter
    // No click follows a release outside the graph: forget the selection it would have made.
    setTimeout(() => {
      afterDrag.current = null
    }, 0)
    if (Math.abs(d.dx) < 0.5 && Math.abs(d.dy) < 0.5) return
    const { commits, label } = outcomeOf(d)
    // (A legend entry dropped where it was: nothing.)
    if (!commits.length) return
    // Roadmap 43: announced with its Undo; dragging the same elements again replaces it.
    // Roadmap 44: several selected elements move together, one step ("Move 3 elements").
    trackUndo(() => store.dispatch(graphCommands(graph, commits), label), {
      group: `canvas:${graph.id}:${commits.map((c) => c.path.join('/')).join('|')}`,
    })
  }

  const onPointerDownNode = (hit: SceneHit, e: React.PointerEvent) => {
    // Roadmap 47b: a selected legend entry is dragged to another place in the legend.
    const entry = sceneNodes.entryOf.get(hit.node.id)
    if (
      entry &&
      e.button === 0 &&
      !modsOf(e).additive &&
      paths.some((p) => entryKeyOf(p) === entry.key)
    ) {
      const svg = (e.target as Element).closest('svg.scene')
      if (!svg) return
      e.preventDefault()
      const r = svg.getBoundingClientRect()
      const [x, y] = [(e.clientX - r.left) / k, (e.clientY - r.top) / k]
      follow(
        e,
        (ev) => ({ kind: 'entry', key: entry.key, x, y, dx: 0, dy: 0, free: ev.altKey }),
        sel,
      )
      return
    }
    const target = dragTargetAt(hit, graph)
    if (!target || e.button !== 0) return
    e.preventDefault()
    const own = selectionOf(target)
    const id = JSON.stringify(target)
    // A member of several selected elements: they move together (those that can move).
    if (several && paths.some((p) => JSON.stringify(p) === JSON.stringify(own))) {
      const others = movableTargets(graph, baseScene, paths).filter((t) => JSON.stringify(t) !== id)
      follow(e, (ev) => ({ kind: 'move', target, dx: 0, dy: 0, free: ev.altKey, others }), sel)
      return
    }
    if (target.kind === 'annotation' && !modsOf(e).additive)
      setSelected(['annotations', target.index])
    follow(
      e,
      (ev) => ({ kind: 'move', target, dx: 0, dy: 0, free: ev.altKey }),
      single(elementKey(graph.id, own)),
    )
  }
  const onPointerDownHandle = (handle: ResizeHandle, e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    follow(
      e,
      (ev) => ({
        kind: 'resize',
        handle,
        dx: 0,
        dy: 0,
        free: ev.altKey,
        aspect: ev.shiftKey,
        keepScale: ev.metaKey || ev.ctrlKey,
      }),
      sel,
      handle,
    )
  }
  /**
   * Roadmap 44 (O3, decisions 860–862): a press on empty canvas or a background draws a box once
   * the pointer moves 3 px (a plain click selects or clears as before). It picks the elements
   * with a mark wholly inside it, or (Alt at the press, or a data set selected) points of the
   * selected data sets; on release they replace the selection, or join it with Shift / ⌘. The
   * graph isn't laid out while it runs.
   */
  const startMarquee = (e: React.PointerEvent) => {
    if (e.button !== 0 || edit) return
    const svg = wrapRef.current?.querySelector('svg.scene')
    if (!svg) return
    e.preventDefault()
    const r = svg.getBoundingClientRect()
    const [x0, y0] = [e.clientX, e.clientY]
    const mods = modsOf(e)
    const sets = selectedDataSets(sel, graph.id)
    const before = sel
    const root = baseScene.root
    anchor.current = null
    const endMarquee = (d: MarqueeDrag, pick: boolean) => {
      setDrag(null)
      if (!pick) return
      const picked = [...new Set(picksInBox(root, marqueeBox(d), ruleOf(d)).map((p) => p.key))]
      const next = marqueeSelect(before, graph.id, picked, {
        additive: d.additive,
        points: d.points !== null,
      })
      // The click that may follow the release keeps what the box picked.
      afterDrag.current = next
      setTimeout(() => {
        afterDrag.current = null
      }, 0)
      selectAs(next)
    }
    followPointer<MarqueeDrag>(x0, y0, {
      cancellable: true,
      at: (ev) => ({
        kind: 'marquee',
        x: (x0 - r.left) / k,
        y: (y0 - r.top) / k,
        dx: (ev.clientX - x0) / k,
        dy: (ev.clientY - y0) / k,
        additive: mods.additive,
        points: mods.alt || sets.length > 0 ? sets : null,
      }),
      show: (d) => flushSync(() => setDrag(d)),
      end: (d, pick) => {
        if (d) endMarquee(d, pick)
      },
    })
  }
  const marquee = drag?.kind === 'marquee' ? drag : null
  /**
   * What the marquee would pick (its keys) and the marks showing the hover halo for them: an
   * element's every mark, a point's own; none above `HOVER_LIMIT` marks (the hint has the count).
   */
  const marqueePicks = useMemo(() => {
    if (!marquee) return null
    const picks = picksInBox(baseScene.root, marqueeBox(marquee), ruleOf(marquee))
    const keys = new Set(picks.map((p) => JSON.stringify(p.key)))
    const marks = new Map<string, SceneNode>()
    for (const p of picks) {
      const own = marquee.points || p.node.cloud ? [p.node] : hoverMarks(sceneMarks, p.key)
      for (const n of own) marks.set(n.id, n)
      if (marks.size > HOVER_LIMIT) break
    }
    return { count: keys.size, halos: marks.size > HOVER_LIMIT ? [] : [...marks.values()] }
  }, [marquee, baseScene, sceneMarks])
  // A selected line annotation's ends (roadmap 32): handles that move one end.
  const selLine =
    !several && selected?.[0] === 'annotations' && selected.length === 2 && !edit
      ? (() => {
          const index = Number(selected[1])
          const a = (outcome?.graph ?? graph).annotations[index]
          return a?.type === 'line' ? { index, a } : null
        })()
      : null
  const lineEnds = (() => {
    const from = selLine && lineEndPoint(scene, selLine.a, 'from')
    const to = selLine && lineEndPoint(scene, selLine.a, 'to')
    return from && to ? { from, to } : null
  })()
  const onPointerDownEnd = (end: 'from' | 'to', e: React.PointerEvent) => {
    if (e.button !== 0 || !selLine) return
    e.preventDefault()
    e.stopPropagation()
    const target = { kind: 'lineEnd' as const, index: selLine.index, end }
    follow(
      e,
      (ev) => ({ kind: 'move', target, dx: 0, dy: 0, free: ev.altKey, constrain: ev.shiftKey }),
      single(elementKey(graph.id, ['annotations', selLine.index])),
    )
  }
  // Roadmap 49c: a selected heat map's tree has a handle on its outer edge, dragged to resize it.
  const treeId =
    !several && !edit && selected?.[0] === 'layers' && selected.length === 2
      ? String(selected[1])
      : null
  const treeAt = treeId ? treeHandle(scene, outcome?.graph ?? graph, treeId) : null
  const onPointerDownTree = (e: React.PointerEvent) => {
    if (e.button !== 0 || !treeAt) return
    e.preventDefault()
    e.stopPropagation()
    const layer = treeAt.layer
    follow(e, (ev) => ({ kind: 'tree', layer, dx: 0, dy: 0, free: ev.altKey }), sel)
  }
  // The right-click / Add menu.
  const [menu, setMenu] = useState<CommandMenuState | null>(null)
  /** Roadmap 35: the dialog adding a result (label, line, band, table, bracket), if open. */
  const [resultDialog, setResultDialog] = useState<ResultDialogMode | null>(null)
  // Roadmap 36: the treatment grid's editor.
  const [gridEditor, setGridEditor] = useState(false)
  // Roadmap 46b: Insert › Volcano thresholds….
  const [volcanoDialog, setVolcanoDialog] = useState(false)
  const canvasRef = useRef<HTMLDivElement>(null)
  const focusCanvas = () => canvasRef.current?.focus({ preventScroll: true })
  /**
   * Audit 3 (A4): a run of Tabs on the canvas — the selection it started from and the one its
   * last Tab made (another selection since starts a new run). Past either end the focus leaves
   * with the selection the run started from, so the panel goes on formatting what was chosen.
   */
  const tabRun = useRef<{ from: Selection; at: Selection } | null>(null)
  const select = (t: StylePath | null) => {
    setSelected(t)
    // Keep keyboard focus on the canvas so Enter / Delete act on the selection.
    canvasRef.current?.focus({ preventScroll: true })
  }
  /** A whole new selection (several elements, a step in or out), the focus on the canvas. */
  const selectAs = (s: Selection) => {
    setSelState(s)
    canvasRef.current?.focus({ preventScroll: true })
  }
  /** What Same kind would select from the primary element (roadmap 45), null for nothing. */
  const sameKindName = (scope: SameScope) => {
    const k = selected && kindOf(graph, selected)
    return k ? kindName(graph, k, scope) : null
  }
  // Hover cards (roadmap 34d): a hovered mark's row or statistics; a single selected point's
  // stays. Roadmap 44 (O20): no hover card while a modifier is held (Shift-clicking marks), none
  // while a drag runs.
  const hoverMark = useHoverMark()
  const modifier = useModifierHeld()
  const pinned = useMemo(
    () => (several ? null : selectedPoint(baseScene.root, selected)),
    [baseScene, selected, several],
  )
  // (A selected point's card stays: Alt-Tab reaches its Go to row in Safari.)
  const cardNode = drag || edit ? null : ((modifier ? null : hoverMark.node) ?? pinned)
  // biome-ignore lint/correctness/useExhaustiveDependencies: version tracks result changes
  const cardInfo = useMemo(
    () => (cardNode ? markInfo(project, graph, cardNode, lookup) : null),
    [cardNode, project, graph, lookup, version],
  )
  const cardAt =
    cardNode && cardInfo ? cardPlace(baseScene.root, baseScene.width, cardNode, k) : null
  /** Go to row: the table, with the point's row selected. */
  const goToRow = (to: NonNullable<MarkInfo['goTo']>) => {
    requestReveal(to)
    onOpen?.(to.table)
  }
  /** ] and [: the next or previous single point selected (its card shows), in drawing order. */
  const stepPoint = (by: 1 | -1) => {
    const points = scenePoints(baseScene.root)
    if (!points.length) return
    const now = selected?.[0] === 'pointOverrides' ? selected : null
    const i = now
      ? points.findIndex((n) => n.point === now[2] && markSeries(n)?.key === now[1])
      : -1
    const next =
      points[i < 0 ? (by > 0 ? 0 : points.length - 1) : (i + by + points.length) % points.length]!
    select(['pointOverrides', markSeries(next)!.key, next.point!])
  }

  /** The Format dialog for the current selection (the graph's when nothing is selected). */
  const formatSelected = () =>
    // Roadmap 49b: several data sets of one layer selected: that layer's view of them together.
    selectionTarget(paths, selected, graph, layerSeriesOf(drill)?.layer, entryTarget)
  const selectedTarget = formatSelected()
  const selectedWhat = describeTarget(selectedTarget, graph)
  // Roadmap 46: the Format panel follows the selection (its scope, by the primary key); Format…,
  // Enter, double-click and ⌘1 show it, "Open in window" the dialog (`format.window`).
  const scopeOf = (p: StylePath | null) => (p ? keyId(elementKey(graph.id, p)) : 'graph')
  const formatHost = useFormatHost(scopeOf(selected), selectedTarget, initialFormat)
  const setFormat = (t: FormatTarget, focus = false) => formatHost.show(t, { focus })
  const formatOpen = formatHost.window !== null
  // Back to the canvas once a Format dialog has closed (the modal dialog holds focus till then).
  const wasOpen = useRef(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: focusCanvas reads a ref
  useEffect(() => {
    if (wasOpen.current && !formatOpen) focusCanvas()
    wasOpen.current = formatOpen
  }, [formatOpen])
  // Audit 3 (A14): a drawer over the canvas (narrow windows, 906) never hides the selection: when
  // it opens, or the selection changes while it is open, the canvas scrolls the selection's halos
  // clear of it (as far as their left edge stays in view).
  const selectionId = sel.keys.map(keyId).join('|')
  useEffect(() => {
    if (!formatHost.open || !selectionId) return
    const frame = requestAnimationFrame(() => {
      const area = canvasRef.current
      const panel = viewRef.current?.querySelector<HTMLElement>(':scope > .format-panel')
      if (!area || !panel) return
      const a = area.getBoundingClientRect()
      const p = panel.getBoundingClientRect()
      // Docked beside the canvas: nothing to do.
      if (p.left >= a.right - 1) return
      const boxes = [...area.querySelectorAll<SVGGraphicsElement>('svg.scene .selection')]
        .map((h) => h.getBoundingClientRect())
        .filter((r) => r.width > 0 || r.height > 0)
      if (!boxes.length) return
      const left = Math.min(...boxes.map((r) => r.left))
      const right = Math.max(...boxes.map((r) => r.right))
      const margin = 16
      const by = Math.min(right - (p.left - margin), left - (a.left + margin))
      if (by > 0) area.scrollLeft += by
    })
    return () => cancelAnimationFrame(frame)
  }, [formatHost.open, selectionId])
  // Roadmap 47: the points selected when several are (the panel formats them together).
  const points = paths.flatMap((p): PointRef[] =>
    p[0] === 'pointOverrides' && p.length === 3 ? [[String(p[1]), String(p[2])]] : [],
  )
  /** The panel's heading: the element selected, else what its place formats ("3 points"). */
  const panelName =
    pointsName(formatHost.target, graph, points) ?? placeName(formatHost.target, graph, titles)
  /** Something other than the whole graph is selected: Format… names it. */
  const formatsSelection = !!selected && selectedWhat !== 'graph'
  const formatButton = {
    shortcut: FORMAT_SHORTCUT,
    icon: 'paintbrush',
    toolbar: { group: TOOLBAR_GROUPS.view, order: 95 },
  }
  const removeAnnotation = (index: number) => {
    const a = graph.annotations[index]
    if (!a) return
    store.dispatch(
      {
        type: 'node.set',
        id: graph.id,
        path: ['annotations'],
        value: graph.annotations.filter((_, i) => i !== index),
      },
      a.type === 'bracket'
        ? 'Delete bracket'
        : a.type === 'text'
          ? 'Delete text'
          : a.type === 'table'
            ? 'Delete results table'
            : 'Delete line',
    )
    setSelected(null)
  }
  const addAnnotations = (added: GraphNode['annotations'], label: string) => {
    if (!added.length) {
      onError('No new comparisons to add (already shown, or none significant).', 'validation')
      return
    }
    store.dispatch(
      {
        type: 'node.set',
        id: graph.id,
        path: ['annotations'],
        value: [...graph.annotations, ...added],
      },
      label,
    )
    select(['annotations', graph.annotations.length])
  }
  // --- Results on the graph (roadmap 35) -------------------------------------------------------
  /** Insert › Result ▸ … */
  const resultMenu = (order: number) => ({
    menu: 'insert' as const,
    group: GROUPS.insert.page,
    order: 40 + order / 100,
    submenu: 'Result',
  })
  const canShowResults = resultsAllowed(project, graph, lookup)
  const hasAnalyses = resultAnalyses(project, graph).length > 0
  const survival = isSurvivalGraph(graph)
  const resultCommands: Command[] = [
    {
      id: 'insert.resultLabel',
      label: 'Result label…',
      menu: resultMenu(10),
      enabled: canShowResults && hasAnalyses,
      hint: 'A label of an analysis’ values (r and P, IC50…), live',
      keywords: ['result', 'label', 'P value', 'r', 'IC50', 'statistics'],
      run: () => setResultDialog({ kind: 'label' }),
    },
    {
      id: 'insert.dropLines',
      label: 'Drop lines…',
      menu: resultMenu(20),
      enabled: canShowResults && hasAnalyses && graph.frame === 'xy',
      hint: 'Lines from a fitted curve at a value (IC50, EC50) to the axes',
      run: () => setResultDialog({ kind: 'line' }),
    },
    {
      id: 'insert.resultLine',
      label: 'Reference line from a result…',
      menu: resultMenu(30),
      enabled: canShowResults && hasAnalyses,
      hint: 'A line at a mean, a control’s mean or any value of the results',
      run: () => setResultDialog({ kind: 'line' }),
    },
    {
      id: 'insert.resultBand',
      label: 'Shaded band from results…',
      menu: resultMenu(40),
      enabled: canShowResults && hasAnalyses,
      hint: 'A band between two values of the results (a confidence interval)',
      run: () => setResultDialog({ kind: 'band' }),
    },
    {
      id: 'insert.riskTable',
      label: 'Number at risk',
      menu: resultMenu(50),
      enabled: survival,
      checked: !!graph.riskTable?.show,
      hint: 'A table of the number at risk under the survival curves',
      run: () =>
        store.dispatch(
          riskTableCommand(graph, !graph.riskTable?.show),
          graph.riskTable?.show ? 'Hide number at risk' : 'Show number at risk',
        ),
    },
    {
      id: 'insert.resultTable',
      label: 'Inset results table…',
      menu: resultMenu(60),
      enabled: hasAnalyses,
      hint: 'A table of an analysis’ results in or beside the plot, live',
      run: () => setResultDialog({ kind: 'table' }),
    },
    {
      id: 'insert.xBracket',
      label: 'Bracket at one X…',
      menu: resultMenu(70),
      enabled: graph.frame === 'xy' && !survival,
      hint: 'Compare two data sets at one X (a time point) with a live P value',
      run: () => setResultDialog({ kind: 'xBracket' }),
    },
    {
      id: 'insert.groupBracket',
      label: 'Bracket from a group to one…',
      menu: resultMenu(80),
      enabled: graph.frame === 'category' || graph.frame === 'grouped',
      hint: 'Compare a group of bars, pooled, with one bar, with a live P value',
      run: () => setResultDialog({ kind: 'groupBracket' }),
    },
  ]
  const resultMenuItems = (): MenuItem[] =>
    resultCommands.map((c) => ({
      label: c.label,
      disabled: c.enabled === false,
      ...(c.checked !== undefined ? { checked: c.checked } : {}),
      onSelect: () => c.run(),
    }))
  /** Insert › Line at a value…, Shaded band…, Treatment grid…, Two-level labels (roadmap 36). */
  const axisExtraCommands = (): Command[] => {
    const categories = graph.frame === 'category' || graph.frame === 'grouped'
    const valued = categories || graph.frame === 'xy'
    // A new line or band in the middle of the Y axis as drawn (then its options to type values).
    const yAt = (f: number) => {
      const axis = scene.axes?.y
      const v = axis ? axis.fromPx(scene.plot.y + scene.plot.h * f) : 0
      return Number.isFinite(v) ? Number(v.toPrecision(3)) : 0
    }
    const addTyped = (kind: 'line' | 'band') => {
      const layer =
        kind === 'line'
          ? typedLayer(graph, 'line', [yAt(0.5)])
          : typedLayer(graph, 'band', [yAt(0.65), yAt(0.35)])
      store.dispatch(
        addTypedLayer(graph, layer),
        kind === 'line' ? 'Add line at a value' : 'Add shaded band',
      )
      setFormat(layerPlace(layer.id))
    }
    const spans = graph.axes.x.type === 'categorical' ? graph.axes.x.spans : undefined
    return [
      {
        id: 'insert.valueLine',
        label: 'Line at a value…',
        menu: insert(24),
        enabled: valued,
        hint: 'A reference line at a value you type, with an optional label',
        keywords: ['reference', 'line', 'threshold', 'cut-off', 'value'],
        run: () => addTyped('line'),
      },
      {
        id: 'insert.valueBand',
        label: 'Shaded band between values…',
        menu: insert(25),
        enabled: valued,
        hint: 'A shaded band between two values you type (a normal range)',
        keywords: ['band', 'range', 'shade', 'region'],
        run: () => addTyped('band'),
      },
      {
        id: 'insert.volcano',
        label: 'Volcano thresholds…',
        menu: insert(25.5),
        enabled: graph.frame === 'xy',
        hint: 'Lines at the fold change’s and P value’s cut-offs, the points coloured by significance',
        keywords: [
          'volcano',
          'log fold change',
          'logFC',
          'cut-off',
          'threshold',
          'significance',
          'DE',
          'differential expression',
        ],
        run: () => setVolcanoDialog(true),
      },
      {
        id: 'insert.treatmentGrid',
        label: 'Treatment grid (+/−)…',
        menu: insert(26),
        enabled: categories,
        hint: 'Rows of + and − under the categories (TNF, CHX…), seeded from their names',
        keywords: ['plus', 'minus', 'treatment', 'grid', 'table', 'conditions'],
        run: () => setGridEditor(true),
      },
      {
        id: 'insert.categorySpans',
        label: 'Two-level category labels',
        menu: insert(27),
        enabled: categories,
        checked: !!spans && spans.show !== false,
        hint: 'Labels spanning groups of categories (a grouped graph’s groups over their bars)',
        keywords: ['two-level', 'labels', 'groups', 'span', 'nested'],
        run: () =>
          store.dispatch(
            {
              type: 'node.set',
              id: graph.id,
              path: ['axes', 'x', 'spans'],
              value: spans && spans.show !== false ? undefined : { ...spans, show: undefined },
            },
            spans && spans.show !== false ? 'Remove two-level labels' : 'Two-level labels',
          ),
      },
    ]
  }
  /** Roadmap 46b: Insert › Identity line (y = x), then its options in the Format panel. */
  const identityCommands = (): Command[] => [
    {
      id: 'insert.identityLine',
      label: 'Identity line (y = x)',
      menu: insert(24.5),
      enabled: hasContinuousAxes(graph),
      disabledReason: 'Needs a graph with two continuous axes (an XY graph)',
      hint: 'A reference line y = x (or any slope and intercept) across the plot',
      keywords: ['identity', 'diagonal', 'y = x', 'unity', 'abline', 'slope', 'reference'],
      run: () => {
        const layer = identityLayer(graph)
        store.dispatch(addIdentityLayer(graph, layer), 'Add identity line')
        setFormat(layerPlace(layer.id))
      },
    },
  ]
  const onResultAdded = (added: { layer: string } | { annotation: number }) => {
    if ('layer' in added) {
      // A label, line or band: its options (the text, values, formats) at once.
      setFormat(layerPlace(added.layer))
    } else select(['annotations', added.annotation])
  }

  const addMenuItems = (): MenuEntry[] => {
    const items: MenuEntry[] = [
      { command: 'insert.text', label: 'Text box' },
      'insert.line',
      'insert.arrow',
      'insert.valueLine',
      'insert.valueBand',
      ...(hasContinuousAxes(graph) ? (['insert.identityLine'] as const) : []),
      ...(graph.frame === 'xy' ? (['insert.volcano'] as const) : []),
      ...(graph.frame === 'category' || graph.frame === 'grouped'
        ? (['insert.treatmentGrid', 'insert.categorySpans'] as const)
        : []),
      { label: 'Result', submenu: resultMenuItems() },
    ]
    if (graph.frame === 'category' || graph.frame === 'grouped')
      bracketableAnalyses(project, graph, lookup).forEach(({ a, result }, i) => {
        items.push({
          label: `Significance brackets from “${a.name}”`,
          separator: i === 0,
          onSelect: () =>
            addAnnotations(newBrackets(graph, a.id, result, false), 'Add significance brackets'),
        })
      })
    if (graph.frame === 'xy')
      items.push({
        label: 'Function curve (plot a function)…',
        separator: true,
        onSelect: () => {
          const { cmds, target } = addFunctionCommands(graph)
          store.dispatch(cmds, 'Add function')
          setFormat(layerView(String(target[1]), { fn: String(target[3]) }))
        },
      })
    if (graph.frame === 'xy')
      missingCurves(project, graph).forEach(({ a, edits }, i) => {
        items.push({
          label: `Curves from “${a.name}”`,
          separator: i === 0,
          onSelect: () => store.dispatch(editCommands(graph.id, edits), 'Add curves'),
        })
      })
    return items
  }
  /** A layer's actions: on the canvas' context menu and in Format › Layers. */
  const layerActions = (layerId: string | undefined) => {
    const l = graph.layers.find((x) => x.id === layerId)
    const table = sourceTable(project, graph.seriesSource.table, lookup)
    const c = table ? styleContext(table, graph.frame, graph.layers, graph.mapping) : null
    // Error bars and labels attached to this layer, where the matrix allows them.
    const addable =
      l && c && table
        ? stylesFor({ kind: c.kind, frame: graph.frame })
            .filter((s) => s.attaches && styleAllowed(s, c).allowed)
            .filter((s) => (s.id === 'error' ? l.geom === 'bar' || l.geom === 'points' : true))
            .map((s) => {
              const layer = { ...newStyleLayer(s, c), on: l.id }
              return { style: s, layer }
            })
        : []
    return {
      layer: l,
      name: l ? layerTitle(l, graph.frame) : '',
      ...layersActions(l ? [l.id] : []),
      addable,
    }
  }
  /**
   * Roadmap 47: actions on several layers at once (the canvas' whole layers selected, Format ›
   * Layers), one undo step each: "Hide 3 layers", "Bring 3 layers forward", "Delete 3 layers"
   * (asking first when it takes attached layers along); one layer's labels as before.
   */
  const layersActions = (given: readonly string[]) => {
    const ids = chosenLayers(graph, given)
    const n = ids.length
    const shown = graph.layers.some((l) => ids.includes(l.id) && l.visible !== false)
    return {
      ids,
      /** Some are drawn: Hide hides them all; else Show shows them. */
      shown,
      hide: () => {
        const cmds = visibilityCommands(graph, ids, !shown)
        if (cmds.length) store.dispatch(cmds, layersLabel(shown ? 'Hide' : 'Show', cmds.length))
      },
      forward: () =>
        n && store.dispatch(moveLayersCommands(graph, ids, 1), layersLabel('Bring', n, 'forward')),
      backward: () =>
        n && store.dispatch(moveLayersCommands(graph, ids, -1), layersLabel('Send', n, 'backward')),
      duplicate: () => {
        const { commands, copies } = duplicateLayersCommands(graph, ids)
        if (!commands.length) return
        store.dispatch(commands, layersLabel('Duplicate', n))
        // The copies selected (whole layers), the last one primary.
        setSelState(keysSelection(copies.map((id) => elementKey(graph.id, ['layers', id]))))
      },
      remove: async () => {
        if (!n) return
        // With the layers attached to them (one undo step brings them back), asked first.
        const q = removeLayersQuestion(graph, ids)
        if (q && !(await confirm(q))) return
        store.dispatch(removeLayersCommands(graph, ids).commands, layersLabel('Delete', n))
        setSelected(null)
      },
      // Forward: up the Layers list (its top row is in front); the layers attached go along.
      canForward: n > 0 && canMoveLayers(graph.layers, ids, 1),
      canBackward: n > 0 && canMoveLayers(graph.layers, ids, -1),
    }
  }
  /** The whole layers selected on the canvas (Alt-click, or chosen in the list of layers). */
  const wholeLayers = paths.flatMap((p) =>
    p[0] === 'layers' && p.length === 2 ? [String(p[1])] : [],
  )
  /**
   * Roadmap 47: the list of layers' selection is the canvas' whole layers: rows chosen there
   * select those layers here (the last one primary, its place shown in the panel).
   */
  const layerSelection: LayerSelection = {
    ids: wholeLayers,
    primary: selected?.[0] === 'layers' && selected.length === 2 ? String(selected[1]) : undefined,
    select: (ids, primary) => {
      if (!ids.length || primary === null) {
        setSelState(EMPTY_SELECTION)
        formatHost.setTarget(graphPlace('layers'), 'graph')
        return
      }
      const key = (l: string) => elementKey(graph.id, ['layers', l])
      setSelState(keysSelection(ids.map(key), key(primary)))
      formatHost.setTarget(layerPlace(primary, 'layers'), keyId(key(primary)))
    },
  }
  const layerMenuItems = (layerId: string): MenuEntry[] => {
    const a = layerActions(layerId)
    if (!a.layer) return []
    return [
      {
        label: a.layer.visible === false ? 'Show this layer' : 'Hide this layer',
        separator: true,
        onSelect: a.hide,
      },
      { label: 'Bring layer forward', disabled: !a.canForward, onSelect: a.forward },
      { label: 'Send layer backward', disabled: !a.canBackward, onSelect: a.backward },
      { label: 'Delete layer', danger: true, onSelect: () => void a.remove() },
      ...(a.addable.length
        ? [
            {
              label: 'Add',
              submenu: a.addable.map(({ style, layer }) => ({
                label: `${style.label} on ${a.name}`,
                onSelect: () =>
                  store.dispatch(
                    // In front of the layer it is on (and what is already on it).
                    {
                      type: 'graph.addLayer',
                      id: graph.id,
                      layer,
                      at: newLayerIndex(graph.layers, layer),
                    },
                    `Add ${style.label.toLowerCase()}`,
                  ),
              })),
            } as MenuEntry,
          ]
        : []),
    ]
  }
  const onContextMenuNode = (hit: SceneHit | null, e: React.MouseEvent) => {
    // No menu while a box is drawn.
    if (marquee) return
    // Roadmap 44: on one of several selected elements, the menu for all of them.
    if (several && hit && keysMatcher(paths)?.(hit.target, hit.node)) {
      setMenu({ x: e.clientX, y: e.clientY, entries: severalMenu(), label: 'Selected elements' })
      return
    }
    const hk = hit ? hitKey(hit.node, hit.target, sceneNodes.entryOf) : null
    // Roadmap 47b: a right-click on a legend entry is about that entry (its menu's actions).
    const next = isLegendEntryPath(hk)
      ? single(elementKey(graph.id, hk!))
      : clickSelect(sel, graph.id, hk, hit?.node.point, hit?.target, 1, {
          alt: false,
          additive: false,
        })
    selectAs(next)
    const key = primaryPath(next)
    const marks = layerSeriesOf(key)
    const target = formatTargetFor(key, graph, layerSeriesOf(next.drill)?.layer, entryTarget)
    const text = hit ? textEditAt(graph, baseScene, hit.target) : null
    const legendLabel = hit ? legendLabelAt(baseScene, graph, hit.node.id) : null
    const index = key?.[0] === 'annotations' ? Number(key[1]) : -1
    const items: MenuEntry[] = [
      { label: `Format ${describeTarget(target, graph)}…`, onSelect: () => setFormat(target) },
    ]
    // A point of a layer's data set that isn't selected yet: its own format one step away.
    const point = hit?.node.point
    if (point !== undefined && marks) {
      const t = formatTargetFor(['pointOverrides', marks.key, point], graph, marks.layer)
      items.push({
        label: `Format this ${singleMarkName(graph, point).replace('data ', '')}…`,
        onSelect: () => setFormat(t),
      })
    }
    // Roadmap 47: a single point selected: hidden on the graph (Delete does the same).
    const hidePoint = key?.[0] === 'pointOverrides' ? deleteEdits(graph, [key], titles) : null
    if (hidePoint)
      items.push({
        label: `${hidePoint.label} on the graph`,
        onSelect: () => {
          trackUndo(() => store.dispatch(hidePoint.commands, hidePoint.label))
          setSelState(EMPTY_SELECTION)
        },
      })
    // Go to row (roadmap 34d): the table, with the mark's row selected.
    const data = hit ? markInfo(project, graph, hit.node, lookup) : null
    if (data?.goTo && onOpen) {
      const to = data.goTo
      items.push({ label: 'Go to row', onSelect: () => goToRow(to) })
    }
    // The layer of a mark: hide, move, remove it; add error bars or labels on it.
    const layerId = layerOfSelection(key)
    if (layerId) items.push(...layerMenuItems(layerId))
    if (hit && text)
      items.push({
        label: 'Edit text',
        onSelect: () => onDoubleClickNode(hit, { additive: false }),
      })
    // Roadmap 47b: a legend entry's legend-only actions.
    const entryKey = entryKeyOf(key)
    if (entryKey !== null) items.push(...entryMenuItems(entryKey, legendLabel))
    // The Format menu's commands (they open on the selection, which is now what was clicked).
    if (target.place !== 'axis') items.push('format.axes')
    // A data set's or layer's own format is the first item; the whole graph's is one step away.
    if (target.place === 'point' || target.place === 'layer')
      items.push({ label: 'Format graph…', onSelect: () => setFormat(graphPlace()) })
    else if (target.place !== 'graph') items.push('format.graph')
    // Something moved on the canvas: back to where the layout puts it.
    if (resetPositionOf(graph, key).length) items.push('format.resetPosition')
    // Roadmap 45: Select ▸ Same kind, then the selection's registry commands (format painter).
    if (key) items.push('-', selectMenuEntry(['kind', 'everyLayer']))
    items.push(...selectionCommandEntries(FORMAT_MENU_IDS, 1))
    const annotation = index >= 0 ? graph.annotations[index] : undefined
    if (annotation)
      items.push(
        annotation.behind
          ? {
              label: 'Bring to front (over the data)',
              separator: true,
              onSelect: () => setBehind(index, false),
            }
          : {
              label: 'Send to back (behind the data)',
              separator: true,
              onSelect: () => setBehind(index, true),
            },
      )
    if (index >= 0)
      items.push({
        label: 'Delete',
        danger: true,
        separator: true,
        onSelect: () => removeAnnotation(index),
      })
    // Around the graph: what the whole graph offers.
    if (!hit)
      items.push(
        '-',
        'format.changeLayers',
        'format.duplicateAs',
        { label: 'Split into one graph per…', onSelect: () => setSplitting(true) },
        { label: 'Add result', submenu: resultMenuItems() },
        'edit.copyGraph',
        'file.export',
      )
    setMenu({ x: e.clientX, y: e.clientY, entries: items, label: 'Graph element' })
  }
  const setBehind = (index: number, behind: boolean) =>
    store.dispatch(
      {
        type: 'node.set',
        id: graph.id,
        path: ['annotations', index, 'behind'],
        value: behind || undefined,
      },
      behind ? 'Send to back' : 'Bring to front',
    )
  /**
   * The right-click menu of several selected elements (roadmap 44): only what applies to every
   * one of them, with their count.
   */
  const severalMenu = (): MenuEntry[] => {
    const n = paths.length
    const items: MenuEntry[] = []
    const movesAll = paths.every(
      (p) =>
        movableTargets(graph, baseScene, [p]).length > 0 || (p[0] === 'axes' && p.length === 2),
    )
    if (movesAll)
      items.push({
        label: `Reset position (${n})`,
        disabled: resets.length === 0,
        onSelect: resetPositions,
      })
    const annotations = paths.every((p) => p[0] === 'annotations')
    if (annotations) {
      const behind = (b: boolean) => () =>
        store.dispatch(
          paths.map((p) => ({
            type: 'node.set' as const,
            id: graph.id,
            path: ['annotations', Number(p[1]), 'behind'],
            value: b || undefined,
          })),
          b ? 'Send to back' : 'Bring to front',
        )
      items.push(
        { label: `Bring to front (${n})`, separator: true, onSelect: behind(false) },
        { label: `Send to back (${n})`, onSelect: behind(true) },
      )
    }
    // Roadmap 47: whole layers, what the list of layers does to them.
    if (wholeLayers.length === n) {
      const a = layersActions(wholeLayers)
      items.push(
        {
          label: `${a.shown ? 'Hide' : 'Show'} layers (${n})`,
          separator: true,
          onSelect: a.hide,
        },
        { label: `Bring layers forward (${n})`, disabled: !a.canForward, onSelect: a.forward },
        { label: `Send layers backward (${n})`, disabled: !a.canBackward, onSelect: a.backward },
        { label: `Duplicate layers (${n})`, onSelect: a.duplicate },
      )
    }
    const d = paths.every((p) => deletable(graph, p)) ? deleteEdits(graph, paths, titles) : null
    if (d)
      items.push({
        label: d.menuLabel,
        danger: true,
        separator: true,
        onSelect: deleteSelection,
      })
    // Roadmap 45: Select ▸ Same kind (of the primary), the selection's registry commands with
    // the count (format painter: "Paste format (3)").
    items.push(
      '-',
      selectMenuEntry(['kind', 'everyLayer']),
      ...selectionCommandEntries(FORMAT_MENU_IDS, n),
    )
    items.push('-', 'format.axes', 'format.graph')
    return items
  }
  const onDoubleClickNode = (hit: SceneHit, mods: { additive: boolean }) => {
    // Shift / ⌘-clicks in quick succession add to the selection; they format nothing.
    if (mods.additive) return
    // Roadmap 47b: an entry's label edits its legend-only label (the data set keeps its name).
    const legend = legendLabelAt(baseScene, graph, hit.node.id)
    if (legend) {
      editLegendLabel(legend)
      return
    }
    // Elsewhere on the legend: what the clicks selected (the legend, or an entry's place).
    if (hitKey(hit.node, hit.target, sceneNodes.entryOf)?.[0] === 'legend') {
      setFormat(formatSelected())
      return
    }
    const t = textEditAt(graph, baseScene, hit.target)
    if (t) setEdit(t)
    // Everything but text opens its Format dialog (text: right-click › Format…): a mark, its
    // layer's Appearance for that data set — a point too, whether or not it was selected
    // (roadmap 44, F16: a single point is Enter once selected, or right-click › Format this…).
    else setFormat(formatTargetFor(hit.target, graph))
  }
  /** Roadmap 47b: the in-place editor on a legend entry's label (its legend-only label). */
  const editLegendLabel = (at: NonNullable<ReturnType<typeof legendLabelAt>>) =>
    setEdit({ kind: 'legendLabel', key: at.key, value: at.value, box: at.box })
  /** Roadmap 47b: entries moved one place in the legend (shown ones; Alt+arrows, the menu). */
  const moveEntries = (keys: readonly string[], by: 1 | -1) => {
    const m = moveEntriesCommand(graph, legendItems, keys, by, true)
    if (m) trackUndo(() => store.dispatch(m.command, m.label))
  }
  /** Roadmap 47b: a legend entry's items of the right-click menu. */
  const entryMenuItems = (key: string, label: ReturnType<typeof legendLabelAt>): MenuEntry[] => {
    const can = (by: 1 | -1) => !!moveEntriesCommand(graph, legendItems, [key], by, true)
    const own = graph.legend.labels?.[key]
    const entryBox = sceneNodes.entries.find((n) => n.legendEntry?.key === key)
    const labelNode = entryBox?.children?.find((c) => c.id.endsWith('/label'))
    const at = label ?? (labelNode ? legendLabelAt(baseScene, graph, labelNode.id) : null)
    return [
      ...(at
        ? [{ label: 'Edit legend label', separator: true, onSelect: () => editLegendLabel(at) }]
        : []),
      {
        label: 'Use data set name',
        disabled: !own,
        onSelect: () => {
          const c = labelCommand(graph, key, null)
          if (c) trackUndo(() => store.dispatch(c, 'Use data set name'))
        },
      },
      {
        label: 'Hide from legend',
        onSelect: () => {
          const c = entriesShownCommand(graph, [key], false)
          if (c) trackUndo(() => store.dispatch(c, shownLabel(1, false)))
          setSelState(single(elementKey(graph.id, ['legend'])))
        },
      },
      { label: 'Move earlier', disabled: !can(-1), onSelect: () => moveEntries([key], -1) },
      { label: 'Move later', disabled: !can(1), onSelect: () => moveEntries([key], 1) },
    ]
  }
  const theme = graphTheme(project, graph)
  const editStyle = edit ? editTextStyle(graph, theme, edit) : null
  const commitEdit = (runs: RichText, align?: TextAlign) => {
    const e = edit
    setEdit(null)
    if (!e) return
    // A text box's alignment set in the editor's toolbar: in the same step as its text.
    const was = e.kind === 'graph' ? editTextStyle(graph, theme, e).align : undefined
    if (e.kind === 'graph' && align && was && align !== was) {
      const path = [...e.path.slice(0, -1), 'align']
      store.dispatch(
        [
          ...(sameRichText(runs, e.value)
            ? []
            : [{ type: 'node.set' as const, id: graph.id, path: e.path, value: mergeRuns(runs) }]),
          { type: 'node.set', id: graph.id, path, value: align === 'left' ? undefined : align },
        ],
        `Edit ${e.label.toLowerCase()}`,
      )
      return
    }
    if (sameRichText(runs, e.value)) return
    if (e.kind === 'legendLabel') {
      // Roadmap 47b: the legend's own label (emptied: the entry's own name again).
      const c = labelCommand(graph, e.key, runs)
      if (c)
        trackUndo(() =>
          store.dispatch(c, richPlain(runs).trim() ? 'Legend label' : 'Use data set name'),
        )
    } else {
      store.dispatch(
        { type: 'node.set', id: graph.id, path: e.path, value: mergeRuns(runs) },
        `Edit ${e.label.toLowerCase()}`,
      )
    }
  }

  const [duplicating, setDuplicating] = useState(false)
  const [splitting, setSplitting] = useState(false)
  const [changingLayers, setChangingLayers] = useState(false)
  /** The graph builder over an open Format dialog's draft (Graph settings › Change layers…). */
  const [draftBuilder, setDraftBuilder] = useState<DraftStore | null>(null)
  /** Save layers as preset… of this graph (or of a Format dialog's draft of it). */
  const [savingPreset, setSavingPreset] = useState<GraphNode | null>(null)
  const [managingPresets, setManagingPresets] = useState(false)
  /** A graph's layers as a preset recipe (null: nothing a preset can keep). */
  const recipeOf = (g: GraphNode): PresetRecipe | null => {
    const t = sourceTable(project, g.seriesSource.table, lookup)
    if (!t) return null
    try {
      return presetRecipe(g, t.tableKind, t)
    } catch {
      return null
    }
  }
  // Export… lays the graph out again at another width keeping its text size, or scales it.
  const exporter = useExport(
    () => ({ name: graph.name, target: figure().target }),
    'graph',
    onError,
  )
  const exportWorkbook = useWorkbookExport(onError)
  // Copy as vector (roadmap 23): Edit › Copy graph (⇧⌘C), and ⌘C with no text focused or selected.
  const viewRef = useRef<HTMLDivElement>(null)
  const copyGraph = () =>
    void copyToClipboard(platform, figure(), {
      what: `“${graph.name}”`,
      graph: graph.id,
    }).then(onNotice, (e: unknown) => onError(errorMessage(e)))
  useClipboardEvents(viewRef, { copy: copyGraph })
  const add = (make: () => GraphNode['annotations'][number], label: string) => () =>
    addAnnotations([make()], label)
  const insert = (order: number) => ({ menu: 'insert' as const, group: GROUPS.insert.page, order })
  // Arrow keys nudge the selected elements (a selected point: its label, when drawn), one step
  // for all; Reset position clears what was moved.
  const movables = useMemo(() => movableTargets(graph, baseScene, paths), [graph, baseScene, paths])
  const nudge = (dx: number, dy: number) => {
    if (!movables.length) return
    const { edits } = moveEdits(graph, baseScene, movables, dx, dy)
    // Audit 3 (A7): announced as a drag is ("Nudge graph title · Undo"), presses in a row of the
    // same elements replacing the notice in place.
    trackUndo(
      () => store.dispatch(graphCommands(graph, edits), moveLabel(edits).replace('Move', 'Nudge')),
      { group: `nudge:${graph.id}:${paths.map((p) => p.join('/')).join('|')}` },
    )
  }
  const resets = resetPaths(graph, paths)
  /** Roadmap 47b: the legend entries selected (their keys). */
  const selectedEntries = paths.flatMap((p) => entryKeyOf(p) ?? [])
  const resetPositions = () =>
    store.dispatch(
      resets.map((path) => ({ type: 'node.set' as const, id: graph.id, path, value: undefined })),
      'Reset position',
    )
  /**
   * Delete (roadmap 44, decision 852): selected annotations and whole layers removed (roadmap 47:
   * asking first when other layers go with them), data sets hidden in their layer, points hidden
   * on the graph, one step announced with its Undo. False when nothing selected can be deleted.
   */
  const deleteSelection = (): boolean => {
    const d = deleteEdits(graph, paths, titles)
    if (!d) return false
    const run = () => {
      trackUndo(() => store.dispatch(d.commands, d.label))
      setSelState(EMPTY_SELECTION)
    }
    const q = removeLayersQuestion(graph, d.layers)
    if (!q) run()
    else
      void confirm(q).then((yes) => {
        if (yes) run()
        focusCanvas()
      })
    return true
  }
  /** Format › Layers ▸ …: the selected layer (a mark's), else the first. */
  const layerCommands = (): Command[] => {
    const a = layerActions(layerOfSelection(selected) ?? layerOfSelection(drill))
    // Roadmap 47: several whole layers selected: every one of them.
    const all = wholeLayers.length > 1 ? layersActions(wholeLayers) : a
    const some = wholeLayers.length > 1 || !!a.layer
    const menu = (order: number) => ({
      menu: 'format' as const,
      group: GROUPS.format.style,
      order,
      submenu: 'Layers',
    })
    return [
      {
        id: 'format.changeLayers',
        label: 'Change layers…',
        menu: menu(5),
        hint: 'The graph builder over this graph: presets, plot styles, statistics',
        run: () => setChangingLayers(true),
      },
      {
        id: 'format.layers.savePreset',
        label: 'Save layers as preset…',
        menu: menu(60),
        hint: 'Keep these layers as a preset of your own, first in the graph builder',
        enabled: graph.layers.length > 0,
        run: () => setSavingPreset(graph),
      },
      {
        id: 'format.layers.managePresets',
        label: 'Manage presets…',
        menu: menu(70),
        hint: 'Rename, reorder, delete, export or import your presets; choose a default',
        run: () => setManagingPresets(true),
      },
      {
        id: 'format.layers.add',
        label: 'Add…',
        menu: menu(10),
        hint: 'Add a layer in the Format panel’s list of layers',
        run: () => setFormat(a.layer ? layerPlace(a.layer.id, 'layers') : graphPlace('layers')),
      },
      {
        id: 'format.layers.forward',
        label: 'Move forward',
        menu: menu(20),
        enabled: some && all.canForward,
        run: all.forward,
      },
      {
        id: 'format.layers.backward',
        label: 'Move backward',
        menu: menu(30),
        enabled: some && all.canBackward,
        run: all.backward,
      },
      {
        id: 'format.layers.toggle',
        label: all.shown || !some ? 'Hide' : 'Show',
        menu: menu(40),
        enabled: some,
        run: all.hide,
      },
      {
        id: 'format.layers.duplicate',
        label: 'Duplicate',
        menu: menu(45),
        enabled: some,
        run: all.duplicate,
      },
      {
        id: 'format.layers.remove',
        label: 'Delete',
        menu: menu(50),
        enabled: some,
        run: () => void all.remove(),
      },
    ]
  }
  const hasLegend = order.some((p) => p[0] === 'legend')
  const commands: Command[] = [
    {
      id: 'format.resetPosition',
      label: 'Reset position',
      menu: { menu: 'format', group: GROUPS.format.graph, order: 25 },
      enabled: resets.length > 0,
      hint: 'Put the selected title, tick labels, bracket or label back where the layout places it',
      run: resetPositions,
    },
    // Roadmap 44: every top-level element of the graph (decision 853).
    {
      id: 'edit.selectAll',
      label: 'Select all',
      menu: { menu: 'edit', group: GROUPS.edit.clipboard, order: 60 },
      shortcut: 'Mod+A',
      enabled: order.length > 0,
      hint: 'Select the title, axes, their titles and tick labels, the data sets, the legend and annotations',
      run: () => selectAs(selectAll(graph.id, order)),
    },
    // Roadmap 43: the toolbar's Format button (⇧⌘E) is named by what Enter on the canvas would
    // format and opens that dialog and tab: Format graph… with nothing selected (or the frame),
    // else Format title… / Format Y axis… / Format data set…, which then also heads the Format
    // menu, before Format graph… and Format axes…, as in the context menu. Last of its toolbar
    // group, so its label changing moves no other button.
    {
      id: 'format.graph',
      label: 'Format graph…',
      menu: { menu: 'format', group: GROUPS.format.graph, order: 10 },
      ...(formatsSelection ? {} : formatButton),
      hint: 'The graph’s layers, text, frame, size, data sets and labels (double-click a part to format it)',
      run: () => setFormat(graphPlace()),
    },
    ...(formatsSelection
      ? [
          {
            id: 'format.selection',
            label: `Format ${selectedWhat}…`,
            menu: { menu: 'format', group: GROUPS.format.graph, order: 5 },
            ...formatButton,
            keywords: ['format selection'],
            hint: 'Format what is selected (or double-click it)',
            run: () => setFormat(formatSelected()),
          } satisfies Command,
        ]
      : []),
    {
      id: 'format.axes',
      label: 'Format axes…',
      menu: { menu: 'format', group: GROUPS.format.graph, order: 20 },
      icon: 'ruler',
      hint: 'An axis: its range, ticks, numbers and title (or double-click an axis)',
      run: () => {
        const t = formatSelected()
        setFormat(t.place === 'axis' ? t : axisPlace('y'))
      },
    },
    // Audit 3 (A1): the legend from the keyboard (it is in Tab's order too).
    {
      id: 'format.legend',
      label: 'Format legend…',
      menu: { menu: 'format', group: GROUPS.format.graph, order: 21 },
      enabled: hasLegend,
      hideInPalette: !hasLegend,
      disabledReason: 'The graph shows no legend',
      hint: 'The legend: its entries, text, box and layout (or click the legend)',
      keywords: ['key', 'entries'],
      run: () => {
        selectAs(single(elementKey(graph.id, ['legend'])))
        setFormat(LEGEND_PLACE, true)
      },
    },
    {
      id: 'format.swapXY',
      label: 'Swap X and Y',
      menu: { menu: 'format', group: GROUPS.format.graph, order: 28 },
      enabled: !!table && swappable(graph),
      hideInPalette: !swappable(graph),
      hint: 'Map the Y variable to X and the X variable to Y (axes’ formats follow)',
      keywords: ['exchange axes', 'flip', 'variables'],
      run: () => {
        const cmds = table && swapMappedXY(graph, table)
        if (cmds) store.dispatch(cmds, 'Swap X and Y')
      },
    },
    {
      id: 'format.duplicateAs',
      label: 'Duplicate as…',
      menu: { menu: 'format', group: GROUPS.format.graph, order: 30 },
      hint: 'A copy with the same or other layers, optionally stacked with this one',
      run: () => setDuplicating(true),
    },
    // Roadmap 46: Format panel (⌘1) and Format in window….
    ...formatPanelCommands(formatHost, true, focusCanvas),
    ...layerCommands(),
    // Roadmap 45: Select ▸ Same kind (the Edit menu, the palette and the context menus).
    ...sameKindCommands(['kind', 'everyLayer'], sameKindName, (scope) => {
      const next = selectSameKind(sel, graph, sceneNodes.all, scope)
      if (next) selectAs(next)
    }),
    ...resultCommands,
    { id: 'insert.text', label: 'Text', menu: insert(10), run: add(newTextBox, 'Add text') },
    // Roadmap 36: axis extras.
    ...axisExtraCommands(),
    ...identityCommands(),
    {
      id: 'insert.line',
      label: 'Line',
      menu: insert(20),
      run: add(() => newLine('none'), 'Add line'),
    },
    {
      id: 'insert.arrow',
      label: 'Arrow',
      menu: insert(30),
      run: add(() => newLine('end'), 'Add arrow'),
    },
    ...copyCommands({
      copy: {
        hint: 'Copy the graph (as Copy graph) unless text is selected or being edited',
        run: copyGraph,
      },
      graph: { enabled: true, run: copyGraph },
      svgCode: () =>
        void copyFigureSvgCode(figure(), { what: `“${graph.name}”`, graph: graph.id }).then(
          onNotice,
          (e) => onError(errorMessage(e)),
        ),
    }),
    ...exportCommands({
      run: (f) => void exporter.exportAs(f),
      openDialog: exporter.open,
      print: () => printView(scene, figure(), onError),
    }),
    sourceDataCommand('graph', () =>
      exportWorkbook(
        () => graphSourceSheets({ project, result: lookup }, graph),
        `${graph.name} source data`,
      ),
    ),
    ...zoomCommands(GRAPH_ZOOMS, zoom, setZoom),
    {
      id: 'view.everyPoint',
      label: EVERY_POINT_LABEL,
      menu: { menu: 'view', group: GROUPS.view.options, order: 30 },
      checked: every,
      hint: EVERY_POINT_HINT,
      keywords: ['points', 'sample', 'large', 'all'],
      run: () => setEvery(!every),
    },
  ]
  useCommands('view', commands)

  const moving =
    drag?.kind === 'move' && several
      ? `Moving ${1 + (drag.others?.length ?? 0)} of ${paths.length}`
      : 'Moving'
  const deletes = paths.some((p) => deletable(graph, p))
  /** ⌘1 (Ctrl+1): the Format panel, named in the hint and the canvas' description (A4). */
  const panelKey = formatShortcut('Mod+1', isMacPlatform())
  const selectionHint = marquee
    ? marqueeHint(marquee, marqueePicks?.count ?? 0)
    : drag
      ? `${outcome?.readout ?? moving} · ${
          drag.kind === 'resize' ? 'Shift keeps the proportions, ⌘/Ctrl keeps the text size, ' : ''
        }Alt: no snapping`
      : several
        ? `${paths.length} elements selected: Shift-click to add or remove${
            movables.length ? `, drag or arrow keys to move ${movables.length}` : ''
          }${deletes ? ', Delete to remove or hide' : ''}`
        : selected
          ? `${
              isLegendEntryPath(selected)
                ? `${elementName(graph, selected, titles)} selected`
                : selectionText(selectedTarget, selected, graph)
            }: ${enterHint(selected)}${movables.length ? ', drag or arrow keys to move' : ''}${
              layerSeriesOf(selected)
                ? ', Delete hides it in this layer'
                : // Roadmap 47b: a legend entry.
                  isLegendEntryPath(selected)
                  ? ', drag or Alt+arrow keys to move it in the legend, Delete hides it from the legend'
                  : // Roadmap 47: a whole layer is removed, a point hidden on the graph.
                    selected[0] === 'layers' && selected.length === 2
                    ? ', Delete deletes the layer'
                    : selected[0] === 'pointOverrides' && deletable(graph, selected)
                      ? ', Delete hides it on the graph'
                      : ''
            }`
          : `Graph: click a part to select it, Shift-click to select several, Enter to format the graph, ${panelKey} for the Format panel`
  /** What Enter does on the selected element (roadmap 44: into a data set or an axis). */
  function enterHint(p: StylePath): string {
    if (layerSeriesOf(p)) return 'Enter for its points, double-click to format'
    // Roadmap 47b: the legend, then its entries.
    if (p[0] === 'legend' && p.length === 1)
      return 'click an entry (or Enter, ] or [) to select it, double-click to format'
    if (isLegendEntryPath(p))
      return '] or [ for the next or previous entry, Enter to format its data set, double-click its label to edit'
    if (p[0] === 'axes' && p.length === 2)
      return 'Enter for its tick labels, double-click to format'
    return textEditAt(graph, baseScene, p)
      ? 'Enter to format, double-click to edit'
      : 'Enter or double-click to format'
  }
  const announcement = selectionAnnouncement(graph, sel, titles)
  /**
   * Roadmap 47b: what the format bar formats — a legend entry its data set (its scene target: an
   * identity, a Significance class's or result line's layer), else the legend; the rest as is.
   */
  const barSel = useMemo(
    () =>
      barSelection(sel, (key) =>
        key.kind === 'element' ? entryTarget(String(key.path[2])) : undefined,
      ),
    [sel, entryTarget],
  )
  // Roadmap 45: the format bar — the selection's name and the elements it can switch to, and
  // the in-place editor's toolbar docked in it while text is edited.
  const barElements = () => [
    { key: null, name: 'Graph' },
    ...order.map((p) => ({ key: elementKey(graph.id, p), name: elementName(graph, p, titles) })),
  ]
  const [dock, setDock] = useState<HTMLElement | null>(null)
  const editedKey = edit?.kind === 'graph' ? editedElement(edit.path) : null

  return (
    <div ref={viewRef} className={`graph-view ${formatOpen ? 'formatting' : ''}`}>
      <div className="graph-main">
        <div className="view-toolbar fixed">
          <ZoomSelect zooms={GRAPH_ZOOMS} zoom={zoom} onChange={setZoom} />
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={menu?.label === 'Add to graph'}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              setMenu({
                x: r.left,
                y: r.bottom + 2,
                entries: addMenuItems(),
                label: 'Add to graph',
              })
            }}
          >
            Add ▾
          </button>
          {/* Roadmap 43: what is selected next to Add ▾ (two lines at most, the whole text in its
              tooltip), the graph's size at the right; the toolbar's height never changes. */}
          <span className="hint selection-hint">
            <Tooltip content={selectionHint || null} className="selection-text-anchor">
              <span className="selection-text">{selectionHint}</span>
            </Tooltip>
            <span className="size-readout">
              {(scene.width / 72).toFixed(2)} × {(scene.height / 72).toFixed(2)} in
            </span>
          </span>
        </div>
        <FormatBar
          sel={barSel}
          graph={graph.id}
          legendEntries={() => shownEntries(legendItems)}
          name={announcement.replace(/ selected$/, '')}
          elements={barElements}
          onSelect={(key) => selectAs(key ? single(key) : EMPTY_SELECTION)}
          onFormat={() => setFormat(formatSelected())}
          editing={
            edit
              ? `Editing ${edit.kind === 'legendLabel' ? 'legend label' : edit.label.toLowerCase()}`
              : null
          }
          onDock={setDock}
        />
        <SheetNotes node={graph} />
        <ScreenSampleNote sampled={scene.sampled} every={every} onEvery={setEvery} />
        <EmptyGraphNote table={emptyTable} onOpen={onOpen} />
        {/* biome-ignore lint/a11y/useSemanticElements: a scrolling canvas, not a form's fieldset */}
        <div
          ref={canvasRef}
          className="canvas"
          // Roadmap 41: named for screen readers, with its keys; ] and [ read the marks out one by
          // one (their hover card is a live status).
          role="group"
          aria-label={`${graph.name}: graph`}
          aria-describedby={canvasHint}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: focusable so Enter / Escape / Delete work
          tabIndex={0}
          onClick={(e) => {
            if (e.target !== e.currentTarget) return
            // A box released here keeps what it picked; else a click around the graph clears.
            const boxed = afterDrag.current
            afterDrag.current = null
            if (boxed) selectAs(boxed)
            else select(null)
          }}
          onPointerDown={(e) => {
            // Around the graph (not on its scroll bars): a box.
            const el = e.currentTarget
            const r = el.getBoundingClientRect()
            const onBars =
              e.clientX - r.left >= el.clientLeft + el.clientWidth ||
              e.clientY - r.top >= el.clientTop + el.clientHeight
            if (e.target === el && !onBars) startMarquee(e)
          }}
          onKeyDown={(e) => {
            // Keys typed in the inline text editor are its own.
            if (e.target !== e.currentTarget) return
            // The keys of the shortcut sheet's "On the canvas" (CANVAS_KEYS).
            if (isViewKey(CANVAS_KEYS.clear, e) || isViewKey(CANVAS_KEYS.out, e))
              setSelState(stepOut(sel, graph.id))
            else if (isViewKey(CANVAS_KEYS.format, e)) {
              // Into a data set's points or an axis' tick labels; else its Format dialog.
              const into = stepIn(sel, graph.id, sceneNodes, sceneMarks)
              if (into) setSelState(into)
              else setFormat(formatSelected(), true)
            } else if (
              isViewKey(CANVAS_KEYS.nextElement, e) ||
              isViewKey(CANVAS_KEYS.previousElement, e)
            ) {
              // A single point's card with Go to row: Tab reaches its button (decision 853).
              if (!e.shiftKey && pinned && cardNode === pinned && cardInfo?.goTo && onOpen) return
              const step = tabStep(sel, graph.id, order, e.shiftKey ? -1 : 1)
              const run =
                tabRun.current && sameSelection(tabRun.current.at, sel) ? tabRun.current : null
              // Past the last (or first) element the focus leaves the canvas, the selection back
              // to what it was before the Tabs.
              if (!step) {
                tabRun.current = null
                if (run && !sameSelection(run.from, sel)) setSelState(run.from)
                return
              }
              tabRun.current = { from: run?.from ?? sel, at: step }
              setSelState(step)
            } else if (isViewKey(CANVAS_KEYS.next, e) || isViewKey(CANVAS_KEYS.previous, e)) {
              const by = isViewKey(CANVAS_KEYS.next, e) ? 1 : -1
              // Audit 3 (A1): the legend's entries while the legend or an entry is selected.
              const entry = entryStep(sel, graph.id, sceneNodes.entries, by)
              if (entry) setSelState(entry)
              else stepPoint(by)
            } else if (isViewKey(CANVAS_KEYS.remove, e)) {
              if (!deleteSelection()) return
            } else if (
              selectedEntries.length &&
              (isViewKey(CANVAS_KEYS.entryEarlier, e) || isViewKey(CANVAS_KEYS.entryLater, e))
            )
              // Roadmap 47b: the selected legend entries one place earlier or later.
              moveEntries(selectedEntries, isViewKey(CANVAS_KEYS.entryEarlier, e) ? -1 : 1)
            else if (isViewKey(CANVAS_KEYS.nudge, e) || isViewKey(CANVAS_KEYS.nudgeMore, e)) {
              // Audit 3 (A3): here only, so arrows elsewhere never move the selection.
              const by = nudgeBy(e)
              if (!by || !movables.length) return
              nudge(by[0], by[1])
            } else return
            e.preventDefault()
          }}
          onContextMenu={(e) => {
            // Right-click around the graph: the graph's own menu.
            if (e.target !== e.currentTarget) return
            e.preventDefault()
            onContextMenuNode(null, e)
          }}
        >
          <span id={canvasHint} className="visually-hidden">
            Click a part of the graph to select it, Shift-click to select several; Tab steps through
            the parts (past the last, the focus leaves with the selection as it was), Enter goes
            into a data set or axis (or formats), Escape steps back out. ] and [ step through the
            points, reading each one’s values, or the legend’s entries. {panelKey} moves to the
            Format panel.
          </span>
          {/* Roadmap 44 (O18): what is selected, read out as it changes. */}
          <span
            className="visually-hidden"
            aria-live="polite"
            aria-atomic="true"
            data-testid="selection-announcement"
          >
            {announcement}
          </span>
          <div className="scene-wrap" ref={wrapRef}>
            <SceneSvg
              scene={scene}
              zoom={zoom}
              selected={paths}
              onSelect={(t, hit, clicks, mods) => {
                const dragged = afterDrag.current
                afterDrag.current = null
                selectAs(
                  dragged ??
                    clickSelect(sel, graph.id, t, hit?.node.point, hit?.target, clicks, mods),
                )
              }}
              onPointerDownNode={onPointerDownNode}
              onPointerDownEmpty={startMarquee}
              preview={marqueePicks?.halos ?? null}
              onDoubleClickNode={onDoubleClickNode}
              onContextMenuNode={onContextMenuNode}
              hoverTarget={(key, hit, mods) =>
                drag ? null : hoverSelect(sel, graph.id, key, hit.node.point, hit.target, mods)
              }
              canDrag={(hit) => !drag && !!dragTargetAt(hit, graph)}
              onHoverNode={hoverMark.hover}
              overlay={
                <>
                  <CanvasOverlay
                    scene={scene}
                    base={baseScene}
                    k={k}
                    guides={outcome?.guides ?? []}
                    handles={
                      !edit &&
                      (drag?.kind === 'resize' ||
                        (!drag &&
                          !several &&
                          (selected === null || selected[0] === 'axes' || selected[0] === 'style')))
                    }
                    active={drag?.kind === 'resize' ? drag.handle : null}
                    onPointerDownHandle={onPointerDownHandle}
                  />
                  {marquee && <MarqueeRect box={marqueeBox(marquee)} k={k} />}
                  {outcome?.insertion && <InsertionLine line={outcome.insertion} k={k} />}
                  {lineEnds && (
                    <EndHandles
                      from={lineEnds.from}
                      to={lineEnds.to}
                      k={k}
                      onPointerDown={onPointerDownEnd}
                    />
                  )}
                  {treeAt && (
                    <TreeHandleRect
                      handle={treeAt}
                      k={k}
                      active={drag?.kind === 'tree'}
                      onPointerDown={onPointerDownTree}
                    />
                  )}
                </>
              }
            />
            {cardInfo && cardAt && (
              <HoverCard
                info={cardInfo}
                place={cardAt}
                pinned={!hoverMark.node}
                events={hoverMark.card}
                {...(onOpen && cardInfo.goTo ? { onGoTo: () => goToRow(cardInfo.goTo!) } : {})}
              />
            )}
            {drag?.kind === 'resize' && outcome?.readout && (
              <div className="drag-readout" style={readoutAt(scene, drag.handle, k)}>
                {outcome.readout}
              </div>
            )}
            {drag?.kind === 'tree' && outcome?.readout && treeAt && (
              <div
                className="drag-readout"
                style={{ left: treeAt.x * k + 12, top: treeAt.y * k - 28 }}
              >
                {outcome.readout}
              </div>
            )}
            {edit && (
              <EditorDock.Provider value={dock}>
                <RichTextEditor
                  // One editor per opened text.
                  key={edit.kind === 'legendLabel' ? `legend/${edit.key}` : edit.path.join('/')}
                  className="inline-edit"
                  autoFocus
                  selectAll
                  once
                  label="Edit text"
                  value={edit.value}
                  multiline={edit.kind === 'graph'}
                  textStyle={editStyle?.style}
                  palette={graph.style.palette ?? theme.palette}
                  align={editStyle?.align}
                  style={{
                    left: edit.box.x * k - 4,
                    top: edit.box.y * k - 3,
                    minWidth: Math.max(edit.box.w * k + 16, 140),
                    // The text's size (runs of other sizes show relative to it).
                    fontSize: Math.max(12, (editStyle?.style.size ?? 12) * graphScale(graph) * k),
                  }}
                  onCommit={commitEdit}
                  onCancel={() => setEdit(null)}
                  {...(editedKey
                    ? {
                        onStyle: (patch) =>
                          setEditedStyle(
                            store,
                            fonts,
                            elementTarget(project, graph, editedKey, null, lookup).text,
                            patch,
                          ),
                      }
                    : {})}
                />
              </EditorDock.Provider>
            )}
          </div>
          <Warnings warnings={scene.warnings} />
        </div>
      </div>
      {formatHost.open && (
        <FormatPanel
          graphId={graph.id}
          target={formatHost.target}
          setTarget={(t) => formatHost.setTarget(t)}
          name={panelName}
          scope={scopeOf(selected)}
          onSelect={(path, t, more = []) => {
            // A part chosen in the panel (a layer, a bracket of the list, a layer its arrows step
            // to): selected on the canvas, the focus staying in the panel.
            const key = (p: StylePath) => elementKey(graph.id, p)
            setSelState(
              !path
                ? EMPTY_SELECTION
                : more.length
                  ? keysSelection([path, ...more].map(key), key(path))
                  : single(key(path)),
            )
            formatHost.setTarget(t, scopeOf(path))
          }}
          onOpenWindow={() => formatHost.openWindow()}
          onClose={() => {
            formatHost.close()
            focusCanvas()
          }}
          onEscape={focusCanvas}
          focus={formatHost.focus}
          actions={{
            onChangeLayers: () => setChangingLayers(true),
            onSavePreset: () => setSavingPreset(graph),
            onManagePresets: () => setManagingPresets(true),
            onSplit: () => setSplitting(true),
          }}
          onNotice={onNotice}
          layerSelection={layerSelection}
          legend={legendItems}
          {...(points.length > 1 ? { points } : {})}
        />
      )}
      {formatHost.window && (
        <FormatDialog
          graphId={graph.id}
          initial={formatHost.window}
          onClose={formatHost.closeWindow}
          onChangeLayers={setDraftBuilder}
          onSplit={() => setSplitting(true)}
          onSavePreset={setSavingPreset}
          onManagePresets={() => setManagingPresets(true)}
          points={points}
        />
      )}
      {menu && <CommandMenu menu={menu} onClose={() => setMenu(null)} />}
      {resultDialog && (
        <ResultDialog
          graphId={graph.id}
          mode={resultDialog}
          onClose={() => setResultDialog(null)}
          onAdded={onResultAdded}
          onError={onError}
        />
      )}
      {gridEditor && (
        <TreatmentGridDialog
          project={project}
          graph={graph}
          lookup={lookup}
          onApply={(g) =>
            store.dispatch(
              { type: 'node.set', id: graph.id, path: ['axes', 'x', 'treatments'], value: g },
              g ? 'Treatment grid' : 'Remove treatment grid',
            )
          }
          onClose={() => setGridEditor(false)}
        />
      )}
      {volcanoDialog && (
        <VolcanoDialog
          project={project}
          graph={graph}
          lookup={lookup}
          onApply={(choice) => {
            const { cmds, added } = volcanoCommands(project, graph, lookup, theme, choice)
            store.dispatch(cmds, 'Volcano thresholds')
            const sig = added.find((id) => id.startsWith('sig'))
            if (sig) setFormat(layerPlace(sig))
          }}
          onClose={() => setVolcanoDialog(false)}
        />
      )}
      {exporter.dialog}
      {splitting && (
        <SplitDialog
          graphId={graph.id}
          onClose={() => setSplitting(false)}
          onCreated={(nid) => onOpen?.(nid)}
        />
      )}
      {duplicating && (
        <GraphBuilder
          mode={{ kind: 'duplicate', graphId: graph.id }}
          onClose={() => setDuplicating(false)}
          onCreated={(nid) => onOpen?.(nid)}
        />
      )}
      {changingLayers && (
        <GraphBuilder
          mode={{ kind: 'change', graphId: graph.id }}
          onClose={() => setChangingLayers(false)}
        />
      )}
      {draftBuilder && (
        <GraphBuilder
          mode={{
            kind: 'change',
            graphId: graph.id,
            store: draftBuilder,
            graph: draftBuilder.getState().nodes[graph.id] as GraphNode,
          }}
          onClose={() => setDraftBuilder(null)}
        />
      )}
      {savingPreset &&
        (() => {
          const recipe = recipeOf(savingPreset)
          return recipe ? (
            <SavePresetDialog
              recipe={recipe}
              onClose={() => setSavingPreset(null)}
              onSaved={(_, message) => onNotice(message)}
            />
          ) : (
            <NoticeDialog
              title="Save as preset"
              message="This graph’s layers draw only analysis results or functions, which a preset can’t keep."
              onClose={() => setSavingPreset(null)}
            />
          )
        })()}
      {managingPresets && <ManagePresetsDialog onClose={() => setManagingPresets(false)} />}
    </div>
  )
}

/** What a marquee picks by (decision 861). */
const ruleOf = (d: MarqueeDrag): Exclude<BoxRule, { kind: 'touch' }> =>
  d.points ? { kind: 'points', dataSets: d.points.length ? d.points : null } : { kind: 'inside' }

/** The hint while a box is drawn: how many it picks, and the modifiers. */
function marqueeHint(d: MarqueeDrag, n: number): string {
  const what = d.points ? (n === 1 ? 'point' : 'points') : n === 1 ? 'element' : 'elements'
  const sets = d.points?.length ?? 0
  const of = !d.points
    ? ''
    : sets === 0
      ? ' of every data set'
      : ` of the selected data set${sets > 1 ? 's' : ''}`
  const rule = d.points
    ? 'a point is picked when its mark is inside the box'
    : 'a part is picked when one of its marks is inside the box, Alt picks points'
  return `${d.additive ? 'Adding' : 'Selecting'} ${n} ${what}${of} · ${rule}${
    d.additive ? '' : ', Shift or ⌘ adds'
  }`
}

/** A marquee's box over the graph, drawn as on layout pages (scene points). */
function MarqueeRect({
  box,
  k,
}: {
  box: { x: number; y: number; w: number; h: number }
  k: number
}) {
  return (
    <rect
      className="marquee"
      x={box.x}
      y={box.y}
      width={box.w}
      height={box.h}
      fill="rgba(47,124,246,0.08)"
      stroke={HALO}
      strokeWidth={1 / k}
      pointerEvents="none"
    />
  )
}
