import type { Command as DocCommand } from '@ps/engine'
import {
  alignedGrid,
  boxInRoot,
  equalizePlotSizes,
  graphTheme,
  hitTest,
  imageInfo,
  layoutGraph,
  layoutPage,
  type MarkInfo,
  markInfo,
  matchGraphFormat,
  type PageScene,
  resolveText,
  SCREEN_SAMPLE,
  type Scene,
  type StylePath,
  TABLE_TEXT_SIZE,
  type Theme,
} from '@ps/graph'
import { AssetError } from '@ps/io'
import {
  type GraphNode,
  gridIndexAt,
  type LayoutItem,
  type LayoutItemId,
  type LayoutItemOf,
  type LayoutNode,
  type NodeId,
  newLayoutItemId,
  newNodeId,
  type PageTableSource,
  type Project,
  type RichText,
  setMembers,
  type TextAlign,
} from '@ps/model'
import {
  type CSSProperties,
  type PointerEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { flushSync } from 'react-dom'
import {
  type Command,
  GROUPS,
  isViewKey,
  PAGE_KEYS,
  TOOLBAR_GROUPS,
  useCommands,
} from '../commands/index.ts'
import { CommandMenu, type CommandMenuState } from '../components/CommandMenu.tsx'
import type { MenuEntry } from '../components/commandItems.ts'
import { useConfirm } from '../components/modals.tsx'
import type { ShowError } from '../components/Toasts.tsx'
import { Tooltip } from '../components/Tooltip.tsx'
import { useUndoNotice } from '../components/undoNotice.tsx'
import { useAssetsVersion, useDoc, useResultLookup, useServices } from '../context.tsx'
import { dropKindOf } from '../drop/dropRouter.ts'
import { carriesFiles, readFiles, transferFiles } from '../drop/transfer.ts'
import { useDropFiles } from '../drop/useFileDrop.tsx'
import { sourceDataCommand, useWorkbookExport } from '../export/dataExport.tsx'
import { layoutSourceSheets } from '../export/workbooks.ts'
import { setEditedStyle } from '../formatBar/editStyle.ts'
import { type BarElement, FormatBar } from '../formatBar/FormatBar.tsx'
import { itemTarget } from '../formatBar/selectionStyles.ts'
import { CanvasOverlay, GuideLines, InsertionLine } from '../graph/CanvasOverlay.tsx'
import { dragOutcome, type ElementDrag } from '../graph/canvasDrag.ts'
import { type DragTarget, selectionOf as dragKeyOf, dragTargetAt } from '../graph/canvasEdit.ts'
import { ELEMENT_SNAP_PX } from '../graph/canvasSnap.ts'
import { useClipboardEvents } from '../graph/clipboardEvents.ts'
import {
  type ClipboardSeen,
  type CopiedGraph,
  type CopySource,
  copiedToPaste,
  copyFigureSvgCode,
  copyToClipboard,
  graphClipboard,
  pastedImageIsCopy,
} from '../graph/copyGraph.ts'
import { frameThrottle } from '../graph/dragFrames.ts'
import { figureSourceOf, useExport } from '../graph/ExportDialog.tsx'
import { FormatDialog } from '../graph/format/FormatDialog.tsx'
import { FormatPanel } from '../graph/format/FormatPanel.tsx'
import { formatPanelCommands, useFormatHost } from '../graph/format/formatHost.ts'
import {
  axisPlace,
  describeTarget,
  type FormatTarget,
  formatTargetFor,
  graphPlace,
  layerPlace,
  layerSeriesOf,
  placeName,
} from '../graph/format/route.ts'
import { graphChangeCommands } from '../graph/graphActions.ts'
import { HoverCard, useHoverMark } from '../graph/HoverCard.tsx'
import type { LayerSelection } from '../graph/inspector/context.ts'
import { graphSeries, removeLayersQuestion } from '../graph/inspector/layers.ts'
import { barSelection, moveEntriesCommand, shownEntries } from '../graph/legendEdits.ts'
import { type PointRef, pointsName } from '../graph/pointEdits.ts'
import { printView } from '../graph/print.ts'
import { anchorPoint, type ResizeHandle, sizeTargets } from '../graph/resize.ts'
import {
  HALO,
  HIT_TOLERANCE_PX,
  modsOf,
  NodeEl,
  PX_PER_PT,
  pixelRatio,
  RasterScale,
  SceneHalos,
} from '../graph/SceneSvg.tsx'
import { screenScenes } from '../graph/sceneCache.ts'
import {
  type DeleteTally,
  deletable,
  deleteEdits,
  deleteLabel,
  graphCommands as elementCommands,
  movableTargets,
  moveEdits,
  moveLabel,
} from '../graph/selectionEdits.ts'
import {
  EVERY_POINT_HINT,
  EVERY_POINT_LABEL,
  ScreenSampleNote,
  useEveryPoint,
  Warnings,
  ZoomSelect,
} from '../graph/ViewChrome.tsx'
import {
  copyCommands,
  exportCommands,
  FORMAT_SHORTCUT,
  zoomCommands,
} from '../graph/viewCommands.ts'
import { LAYOUT_ZOOMS } from '../graph/zoom.ts'
import { SheetNotes } from '../reuse/SheetNotes.tsx'
import { sameRichText } from '../richText/model.ts'
import { EditorDock, type ElementStylePatch, RichTextEditor } from '../richText/RichTextEditor.tsx'
import {
  type AnnotationsOf,
  holdAnnotations,
  placeAnnotations,
} from '../selection/annotationKeys.ts'
import { elementName, elementOrder } from '../selection/graphSelection.ts'
import {
  dragSelection,
  enteredItems,
  itemIdsOf,
  itemKey,
  itemsSelection,
  type PageHit,
  pageElementClick,
  pageElementKey,
  pageElementName,
  pageElementsOf,
  pageElementsText,
  pageKeyResolves,
  pageStepOut,
  primaryPageElement,
} from '../selection/pageSelection.ts'
import { pickInBox } from '../selection/pickInBox.ts'
import {
  type PageGraph,
  pageKindName,
  selectSameItems,
  selectSameKindOnPage,
} from '../selection/sameKind.ts'
import {
  entryKeyOf,
  entryTargetIn,
  hitKey,
  keyResolves,
  keysMatcher,
  legendEntryPath,
  sceneIndex,
} from '../selection/sceneKeys.ts'
import {
  EMPTY_SELECTION,
  keyId,
  primaryKey,
  resolveSelection,
  type Selection,
  sameKey,
  selectionOf,
  single,
} from '../selection/selection.ts'
import {
  FORMAT_MENU_IDS,
  sameKindCommands,
  selectionCommandEntries,
  selectMenuEntry,
} from '../selection/selectionMenu.ts'
import { setPageSelection } from '../styles/units.ts'
import { requestReveal } from '../table/reveal.ts'
import { errorMessage, graphsOf } from '../util.ts'
import type { FigureTarget } from '../worker/figureCore.ts'
import {
  ALIGN_EDGES,
  type AlignEdge,
  alignMoves,
  applyMoves,
  arrangeUnits,
  distributeMoves,
  reorderItems,
  unionOf,
  type ZOrder,
} from './arrange.ts'
import { liveItems, type PageDrag } from './drags.ts'
import { arrangeGraphItems } from './figure.ts'
import { formatOnPage, markOnPage, pageFormatChoices } from './formatOnPage.ts'
import { type HandlePress, SelectionOverlay } from './handles.tsx'
import { InspectorDock } from './InspectorDock.tsx'
import { IMAGE_EXTENSIONS, imageAsset } from './images.ts'
import { arrangeMenu, pageItemCommands } from './itemCommands.ts'
import {
  copyItems,
  groupItems,
  idsAt,
  indicesOf,
  itemKindName,
  moveItem,
  setLocked,
  ungroupItems,
  withGroups,
} from './items.ts'
import { LayoutInspector } from './LayoutInspector.tsx'
import { pageSources } from './pageScene.ts'
import { fitScale, pasteableGraph, pastePlacement, selectedGraphOf } from './paste.ts'
import { pageSnapLines, snapMove, snapScale, snapValue } from './snap.ts'
import { type StackDirection, stackGraphs } from './stack.ts'
import { TableDialog } from './TableDialog.tsx'
import { ToolStrip } from './ToolStrip.tsx'
import { tableSourceChoices } from './tableSources.ts'
import { DRAW_TOOLS, type DrawTool, imageItemFor, tableItemFor } from './tools.ts'

/** Snap distance on screen, in pixels. */
const SNAP_PX = 6

/** A pointer move of a drag on the page: where (page points) and the modifiers held. */
interface PagePointer {
  p: { x: number; y: number }
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
  ctrlKey: boolean
}

/** Where an item starts (its top-left, a line's start), for paste offsets. */
const originOf = (it: LayoutItem) => (it.type === 'line' ? it.from : { x: it.x, y: it.y })

/** Steps off items already at the spot when pasting or duplicating. */
const PASTE_STEP = 12

export function LayoutView({
  id,
  onError,
  onNotice = onError,
  onOpen,
}: {
  id: NodeId
  onError: ShowError
  /** A passing message ("Copied … as vector (SVG) and image (PNG)."). */
  onNotice?: (msg: string) => void
  /** Show another node (Go to row: a table). */
  onOpen?: (id: NodeId) => void
}) {
  const services = useServices()
  const { fonts, platform, store, assets } = services
  const dropFiles = useDropFiles()
  const project = useDoc((d) => d)
  const layout = project.nodes[id] as LayoutNode
  const { lookup, version } = useResultLookup()
  const assetsVersion = useAssetsVersion()
  const [zoom, setZoom] = useState(1)
  // On screen at most 1,000 points per column or group unless every point is asked for
  // (decision 450); exports and copies lay the page out again with every point.
  const [every, setEvery] = useEveryPoint(layout.id)
  const screen = every ? {} : { screen: SCREEN_SAMPLE }
  /**
   * The page's selection (roadmap 44, decisions 870–872): items held by id (audit 2, U1) so an
   * undo, a reorder or a removal never moves it to other items, or parts of graphs on the page.
   * Derived each render with the keys that no longer name anything left out (`psel`). A graph's
   * annotations are held by id too (audit 3, U2: `annotationKeys.ts`).
   */
  const [heldSel, setHeldSel] = useState<Selection>(EMPTY_SELECTION)
  /** The annotations of the graph a page element is in, in `doc`. */
  const annotationsIn =
    (doc: Project): AnnotationsOf =>
    (k) => {
      if (k.kind !== 'pageElement') return undefined
      const at = (doc.nodes[id] as LayoutNode | undefined)?.items.find((it) => it.id === k.item)
      const g = at?.type === 'graph' ? doc.nodes[at.graph] : undefined
      return g?.kind === 'graph' ? g.annotations : []
    }
  const setPageSel = (s: Selection) =>
    setHeldSel(holdAnnotations(s, annotationsIn(store.getState())))
  // biome-ignore lint/correctness/useExhaustiveDependencies: annotationsIn reads `id` only
  const pageSel = useMemo(
    () => placeAnnotations(heldSel, annotationsIn(project)),
    [heldSel, project],
  )
  const trackUndo = useUndoNotice()
  const confirm = useConfirm()
  const pageItems = layout?.items
  /**
   * A graph item's graph and its scene on screen (the scene the page draws, from the scene
   * cache), if the item is a live graph that isn't locked.
   */
  const graphItem = (index: number | null) => {
    const item = index === null ? undefined : layout.items[index]
    if (item?.type !== 'graph' || item.locked) return null
    const graph = project.nodes[item.graph]
    if (graph?.kind !== 'graph') return null
    const scene: Scene = screenScenes.layout({
      project,
      graph,
      fonts,
      theme: undefined,
      result: lookup,
      ...screen,
    })
    return { index: index!, item, graph, scene }
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: version tracks result changes
  const psel = useMemo(() => {
    if (!pageItems) return EMPTY_SELECTION
    const drawn = (itemId: LayoutItemId, path: StylePath) => {
      const g = graphItem(pageItems.findIndex((it) => it.id === itemId))
      // Roadmap 47: a whole layer stays while its graph has it (chosen in the list of layers).
      return !!g && keyResolves(sceneIndex(g.scene.root).marks, g.graph, path)
    }
    return resolveSelection(pageSel, (k) => pageKeyResolves(k, pageItems, drawn))
  }, [pageSel, pageItems, project, fonts, lookup, version, every])
  const selIds = useMemo(() => itemIdsOf(psel), [psel])
  const setSelIds = (ids: LayoutItemId[]) => setPageSel(itemsSelection(id, ids))
  /** The selected parts of graphs on the page (none while items are selected). */
  const elems = pageElementsOf(psel)
  const primaryEl = primaryPageElement(psel)
  const sel = useMemo(() => (pageItems ? indicesOf(pageItems, selIds) : []), [pageItems, selIds])
  /** Selects the items at these indices of `among` (the page's items unless given). */
  const setSel = (indices: number[], among?: readonly LayoutItem[]) =>
    setSelIds(idsAt(among ?? layout.items, indices))
  const selected = sel.length === 1 ? sel[0]! : null
  const setSelected = (i: number | null) => setSel(i === null ? [] : [i])
  /** The graph item worked in: the item selected alone, or the one holding the primary part. */
  const ctxFound = primaryEl ? layout.items.findIndex((it) => it.id === primaryEl.item) : -1
  const ctxAt = selected ?? (ctxFound >= 0 ? ctxFound : null)
  // Roadmap 37: the Styles dialog's "selected graphs on the page".
  const selGraphs = sel.flatMap((i) => {
    const it = layout?.items[i]
    return it?.type === 'graph' ? [it.graph] : []
  })
  const selKey = selGraphs.join(',')
  useEffect(() => {
    setPageSelection({ layout: id, graphs: selKey ? selKey.split(',') : [] })
  }, [id, selKey])
  useEffect(() => () => setPageSelection(null), [])
  const [drag, setDrag] = useState<PageDrag | null>(null)
  /** The drawing tool in hand (roadmap 32); null: selecting. */
  const [tool, setTool] = useState<DrawTool | null>(null)
  const [tableDialog, setTableDialog] = useState(false)
  // Escape puts a tool down wherever the focus is (a toolbar button, the menus).
  useEffect(() => {
    if (!tool) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('dialog[open], [role="menu"]')) return
      setTool(null)
      setDrag((d) => (d?.mode === 'create' ? null : d))
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [tool])
  /**
   * A drag on a graph on the page itself (graph points): an element moved (with the other
   * selected parts, of this graph and others: `members`) or its plot resized. It starts once the
   * pointer has moved 3 px (`started`); a press without that is a click.
   */
  const [gdrag, setGdrag] = useState<{
    drag: ElementDrag
    startX: number
    startY: number
    /** The graph item dragged on. */
    index: number
    /** Selected movable parts of other graphs on the page, moving with it. */
    members?: { index: number; targets: DragTarget[] }[]
    /** The selection once the drag starts (the dragged part, unless one of several selected). */
    select?: Selection
    started: boolean
  } | null>(null)
  /**
   * The press that may become a click on a graph item: the selection before it (a click on a
   * graph worked in selects its part, decision 870) and whether it became a drag.
   */
  const press = useRef<{ index: number; before: Selection; moved: boolean } | null>(null)
  /** The page scene as it was when the drag began (snap targets, handle geometry). */
  const dragBase = useRef<PageScene | null>(null)
  const [columns, setColumns] = useState(2)
  const svgRef = useRef<SVGSVGElement>(null)
  // A text item being edited in place (its index).
  const [textEdit, setTextEdit] = useState<number | null>(null)
  const [menu, setMenu] = useState<CommandMenuState | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)

  const k = zoom * PX_PER_PT
  const theme = graphTheme(project)
  const asset = (aid: string) => assets.get(aid)
  const baseSizes = { textSize: theme.text.size, tableSize: TABLE_TEXT_SIZE }

  /**
   * The drag after snapping: for a move, the selection's offset (snapped for the grabbed item
   * against the other items); for a resize, the grabbed graph's new scale. Guides show what it
   * snapped to.
   */
  const snapped = useMemo(() => {
    const base = dragBase.current
    if (!drag || !base || (drag.mode !== 'move' && drag.mode !== 'scale')) return null
    const grabbed = base.items.find((b) => b.index === drag.index)
    if (!grabbed) return null
    const others = base.items
      .filter((b) => !(drag.mode === 'move' ? sel.includes(b.index) : b.index === drag.index))
      .map((b) => ({ box: b, plot: b.plot }))
    const threshold = drag.free ? -1 : SNAP_PX / k
    if (drag.mode === 'move') {
      const r = snapMove(
        { box: grabbed, plot: grabbed.plot },
        others,
        layout.page,
        drag.dx,
        drag.dy,
        threshold,
      )
      return { dx: r.dx, dy: r.dy, scale: 1, guides: r.guides }
    }
    const it = layout.items[drag.index]
    if (it?.type !== 'graph') return null
    const raw = Math.max(0.1, (grabbed.w + drag.dx) / grabbed.w) * it.scale
    const unit = {
      box: { x: 0, y: 0, w: grabbed.w / it.scale, h: grabbed.h / it.scale },
      plot: grabbed.plot && {
        x: (grabbed.plot.x - it.x) / it.scale,
        y: (grabbed.plot.y - it.y) / it.scale,
        w: grabbed.plot.w / it.scale,
        h: grabbed.plot.h / it.scale,
      },
    }
    const r = snapScale({ x: it.x, y: it.y, unit }, others, raw, threshold)
    return { dx: 0, dy: 0, scale: +r.scale.toFixed(4), guides: r.guides }
  }, [drag, sel, layout, k])

  /**
   * Resizing an item or a group, moving a line's end and drawing (roadmap 32): the items as they
   * would be, snapped to the other items and the page (Alt: not), and the guides snapped to.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: asset lookups follow assetsVersion
  const live = useMemo(() => {
    const base = dragBase.current
    if (!drag || !base) return null
    const threshold = drag.free ? -1 : SNAP_PX / k
    return liveItems(drag, base, layout, sel, threshold, baseSizes, (a) => assets.get(a))
  }, [drag, sel, layout, k, assetsVersion])

  // A graph selected alone on the page can be arranged like on its own canvas (roadmap 22): its
  // plot resized from handles, its titles, tick labels, brackets, legend… moved; a click on a part
  // selects it (roadmap 44), and the graph holding the selected part is worked in the same way.
  // Graphs come from the scene cache (audit 2, P3): laid out again only when what they read
  // changed, so a drag or an edit elsewhere lays out no graph.
  const ctx = graphItem(ctxAt)
  const selItem = ctxAt !== null ? layout.items[ctxAt] : undefined
  const selGraph = ctx?.graph ?? null
  const selScene = ctx?.scene ?? null
  // biome-ignore lint/correctness/useExhaustiveDependencies: version tracks result changes
  const graphOutcome = useMemo(() => {
    if (!gdrag?.started) return null
    const g0 = graphItem(gdrag.index)
    if (!g0) return null
    // A resize snaps to the plot sizes of the other graphs on the page.
    const onPage = layout.items.flatMap((it) => (it.type === 'graph' ? [it.graph] : []))
    const outcome = dragOutcome(g0.graph, g0.scene, gdrag.drag, {
      threshold: ELEMENT_SNAP_PX / (k * g0.item.scale),
      sizes: gdrag.drag.kind === 'resize' ? sizeTargets(project, g0.graph, onPage) : [],
    })
    // Selected parts of other graphs follow the dragged one's move, as far on the page.
    const changed = [{ base: g0, graph: outcome.graph, edits: outcome.commits }]
    const move = outcome.move
    for (const m of move ? (gdrag.members ?? []) : []) {
      const gj = graphItem(m.index)
      if (!gj || !move) continue
      const f = g0.item.scale / gj.item.scale
      const r = moveEdits(gj.graph, gj.scene, m.targets, move.dx * f, move.dy * f)
      changed.push({ base: gj, graph: r.graph, edits: r.edits })
    }
    // The page is drawn with the graphs as dragged (laid out once per move, not cached).
    const dragProject = {
      ...project,
      nodes: { ...project.nodes, ...Object.fromEntries(changed.map((c) => [c.graph.id, c.graph])) },
    }
    // A point of the plot stays put on the page while the graph reflows: the edge or corner
    // opposite a resize handle, the bottom-left corner for a moved element.
    const handle = gdrag.drag.kind === 'resize' ? gdrag.drag.handle : null
    const laid = changed.map((c) => {
      const s = layoutGraph({
        project: dragProject,
        graph: c.graph,
        fonts,
        result: lookup,
        ...screen,
      })
      const h = c.base === g0 ? handle : null
      const from = anchorPoint(c.base.scene.plot, h)
      const to = anchorPoint(s.plot, h)
      const scale = c.base.item.scale
      const shift = { x: (from.x - to.x) * scale, y: (from.y - to.y) * scale }
      return { ...c, index: c.base.index, scene: s, shift }
    })
    const count = laid.reduce((n, c) => n + c.edits.length, 0)
    const label = count === 1 ? outcome.label : `Move ${count} elements`
    return {
      guides: outcome.guides,
      readout: outcome.readout,
      project: dragProject,
      laid,
      label,
      // Roadmap 47b: where a dragged legend entry would go.
      insertion: outcome.insertion,
    }
  }, [gdrag, k, project, fonts, lookup, layout, version, every])

  // Items being dragged are drawn at their live (uncommitted) positions.
  const shown: LayoutNode = useMemo(() => {
    if (graphOutcome) {
      const items = layout.items.map((it, i) => {
        const c = graphOutcome.laid.find((l) => l.index === i)
        return c ? moveItem(it, c.shift.x, c.shift.y) : it
      })
      return { ...layout, items }
    }
    if (live) return { ...layout, items: live.items }
    if (!drag || !snapped) return layout
    const items = layout.items.map((it, i) => {
      if (drag.mode === 'move' && sel.includes(i)) return moveItem(it, snapped.dx, snapped.dy)
      if (drag.mode === 'scale' && i === drag.index && it.type === 'graph')
        return { ...it, scale: snapped.scale }
      return it
    })
    return { ...layout, items }
  }, [layout, drag, snapped, sel, graphOutcome, live])

  // biome-ignore lint/correctness/useExhaustiveDependencies: version and assetsVersion track results and images
  const scene = useMemo(
    () =>
      layoutPage({
        project: graphOutcome?.project ?? project,
        layout: shown,
        fonts,
        ...pageSources(project, lookup, asset),
        ...screen,
        graphScene: (c) =>
          graphOutcome?.laid.find((l) => l.graph === c.graph)?.scene ?? screenScenes.layout(c),
      }),
    [project, shown, fonts, lookup, version, graphOutcome, assetsVersion, every],
  )
  /**
   * What exports, copies and prints draw: the page (or a graph or items on it) with every point
   * (the page may draw a sample), laid out and written in the export worker (roadmap 42).
   */
  const figure = (target: FigureTarget = { kind: 'page', layout }): CopySource => ({
    source: figureSourceOf(services),
    target,
  })

  const dispatch = (cmds: DocCommand | DocCommand[], label?: string) => {
    try {
      store.dispatch(cmds, label)
    } catch (e) {
      onError(errorMessage(e, true))
    }
  }
  const set = (path: (string | number)[], value: unknown, label?: string) =>
    dispatch({ type: 'node.set', id, path, value }, label)
  const setItems = (items: LayoutItem[], label: string, selection?: number[]) => {
    set(['items'], items, label)
    if (selection) setSel(selection, items)
  }

  /** Pointer position on the page, in points. */
  const toPt = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current?.getBoundingClientRect()
    return { x: (e.clientX - (r?.left ?? 0)) / k, y: (e.clientY - (r?.top ?? 0)) / k }
  }
  const keys = (e: { altKey: boolean; shiftKey: boolean }) => ({
    free: e.altKey,
    shift: e.shiftKey,
  })

  const startDrag = (e: PointerEvent, index: number, mode: 'move' | 'scale') => {
    e.stopPropagation()
    // A right-click is for the item's menu (and keeps a multiple selection for it).
    if (e.button !== 0) return
    press.current = mode === 'move' ? { index, before: psel, moved: false } : null
    const it = layout.items[index]
    if ((e.shiftKey || e.metaKey || e.ctrlKey) && mode === 'move') {
      // With parts of graphs selected, Shift-click on a graph adds or removes its part (on the
      // click, `clickItem`).
      if (it?.type === 'graph' && elems.length) return
      // Shift / Cmd / Ctrl-click adds to (or removes from) the selection, a group as a whole.
      const members = withGroups(layout.items, [index])
      setSel(
        sel.includes(index)
          ? sel.filter((i) => !members.includes(i))
          : [...new Set([...sel, ...members])],
      )
      return
    }
    const p = toPt(e)
    // On a graph worked in (selected alone, or holding selected parts), a press on a movable
    // element (title, axis title, tick labels, bracket, legend, text) moves that element (with the
    // other selected parts when it is one of them); elsewhere it moves the graph on the page.
    const entered = mode === 'move' && !!it && enteredItems(psel).has(it.id)
    // Roadmap 47b: a selected legend entry of the graph worked in moves within its legend.
    const entry = entered ? selectedEntryAt(index, p.x, p.y) : null
    if (entry && !(e.shiftKey || e.metaKey || e.ctrlKey)) {
      ;(e.target as Element).setPointerCapture(e.pointerId)
      setGdrag({
        drag: { kind: 'entry', ...entry, dx: 0, dy: 0, free: false },
        startX: p.x,
        startY: p.y,
        index,
        select: psel,
        started: false,
      })
      return
    }
    const element = entered ? elementAt(index, p.x, p.y) : null
    if (element) {
      ;(e.target as Element).setPointerCapture(e.pointerId)
      startElementDrag(index, element, p, e.altKey)
      return
    }
    const next = mode === 'scale' || !sel.includes(index) ? withGroups(layout.items, [index]) : sel
    setSel(next)
    // Locked items (picked from the page panel) don't move.
    if (next.some((i) => layout.items[i]?.locked)) return
    ;(e.target as Element).setPointerCapture(e.pointerId)
    dragBase.current = scene
    setDrag({ mode, index, startX: p.x, startY: p.y, dx: 0, dy: 0, ...keys(e) })
  }
  /** A press on a handle: an item's box (resize), a group's corner, a line's end. */
  const startHandle = (e: PointerEvent, d: HandlePress) => {
    if (e.button !== 0) return
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    const p = toPt(e)
    dragBase.current = scene
    setDrag({ ...d, startX: p.x, startY: p.y, dx: 0, dy: 0, ...keys(e) })
  }
  const startMarquee = (e: PointerEvent) => {
    if (e.button !== 0) return
    if (!(e.shiftKey || e.metaKey || e.ctrlKey)) setSel([])
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    const p = toPt(e)
    setDrag({
      mode: 'marquee',
      index: -1,
      startX: p.x,
      startY: p.y,
      dx: 0,
      dy: 0,
      free: false,
      shift: false,
    })
  }
  /** A press with a drawing tool: the object is drawn from here (snapped, unless Alt). */
  const startCreate = (e: PointerEvent) => {
    if (e.button !== 0 || !tool) return
    e.stopPropagation()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    dragBase.current = scene
    let p = toPt(e)
    if (!e.altKey) {
      const lines = pageSnapLines(scene.items, layout.page)
      const t = SNAP_PX / k
      p = {
        x: snapValue(p.x, 'x', lines.x, t, 0, 0).v,
        y: snapValue(p.y, 'y', lines.y, t, 0, 0).v,
      }
    }
    setDrag({ mode: 'create', index: -1, tool, startX: p.x, startY: p.y, dx: 0, dy: 0, ...keys(e) })
  }
  /** The movable element of a graph item under a page point, if any. */
  const elementAt = (index: number, x: number, y: number): DragTarget | null => {
    const g = graphItem(index)
    if (!g) return null
    const s = g.item.scale
    const hit = hitTest(g.scene.root, (x - g.item.x) / s, (y - g.item.y) / s, 3 / (k * s))
    return hit ? dragTargetAt(hit, g.graph) : null
  }
  /**
   * Roadmap 47b: a selected legend entry of a graph item under a page point: its key and the
   * point in the graph's coordinates.
   */
  const selectedEntryAt = (index: number, x: number, y: number) => {
    const g = graphItem(index)
    if (!g) return null
    const s = g.item.scale
    const [gx, gy] = [(x - g.item.x) / s, (y - g.item.y) / s]
    const hit = hitTest(g.scene.root, gx, gy, 3 / (k * s))
    const entry = hit && sceneIndex(g.scene.root).nodes.entryOf.get(hit.node.id)
    if (!entry) return null
    const key = pageElementKey(id, g.item.id, legendEntryPath(entry.key))
    return psel.keys.some((k2) => sameKey(k2, key)) ? { key: entry.key, x: gx, y: gy } : null
  }
  /**
   * The part of a graph item under a page point that a click selects (decision 854's reach,
   * through the item's transform); null off its parts (nothing, or a background).
   */
  const partAt = (index: number, x: number, y: number): PageHit | null => {
    const g = graphItem(index)
    if (!g) return null
    const s = g.item.scale
    const tol = HIT_TOLERANCE_PX / (k * s)
    const hit = hitTest(g.scene.root, (x - g.item.x) / s, (y - g.item.y) / s, tol)
    const t = hit?.target
    if (!t?.length || (t[0] === 'style' && (t[1] === 'plotBackground' || t[1] === 'background')))
      return null
    // Roadmap 47b: the legend, or one of its entries (`hitKey`).
    const key = hitKey(hit!.node, t, sceneIndex(g.scene.root).nodes.entryOf)
    return key ? { key, point: hit!.node.point, target: t } : null
  }
  /**
   * A press on a movable part of a graph worked in: it is dragged (once the pointer moves 3 px)
   * and selected, with the other selected movable parts of this and other graphs when it is one
   * of several selected (stage 1's `moveEdits`, one undo step).
   */
  const startElementDrag = (
    index: number,
    target: DragTarget,
    p: { x: number; y: number },
    free: boolean,
  ) => {
    const g = graphItem(index)!
    const own = dragKeyOf(target)
    const key = pageElementKey(id, g.item.id, own)
    const member = elems.length > 1 && elems.some((k) => sameKey(k, key))
    const tid = JSON.stringify(target)
    const pathsOf = (itemId: LayoutItemId) => pageElementsOf(psel, itemId).map((k) => k.path)
    const others = member
      ? movableTargets(g.graph, g.scene, pathsOf(g.item.id)).filter(
          (t) => JSON.stringify(t) !== tid,
        )
      : []
    const members: { index: number; targets: DragTarget[] }[] = []
    const graphsSeen = new Set<string>([g.graph.id])
    for (const itemId of member ? new Set(elems.map((k) => k.item)) : []) {
      const gj = graphItem(layout.items.findIndex((it) => it.id === itemId))
      if (!gj || graphsSeen.has(gj.graph.id)) continue
      graphsSeen.add(gj.graph.id)
      const targets = movableTargets(gj.graph, gj.scene, pathsOf(itemId))
      if (targets.length) members.push({ index: gj.index, targets })
    }
    setGdrag({
      drag: { kind: 'move', target, dx: 0, dy: 0, free, ...(others.length ? { others } : {}) },
      startX: p.x,
      startY: p.y,
      index,
      members,
      select: dragSelection(psel, id, g.item.id, own),
      started: false,
    })
  }
  /**
   * A click on a graph item (after its press, `startDrag`): on the graph worked in, the part
   * under the pointer is selected (decision 870); with parts selected, Shift-click adds or
   * removes one of any graph. Not after a drag.
   */
  const clickItem = (e: React.MouseEvent, index: number) => {
    const pr = press.current
    press.current = null
    const it = layout.items[index]
    if (!pr || pr.index !== index || pr.moved || tool || it?.type !== 'graph') return
    const p = toPt(e)
    const next = pageElementClick(
      pr.before,
      id,
      it.id,
      partAt(index, p.x, p.y),
      Math.max(1, e.detail),
      modsOf(e),
    )
    if (next) setPageSel(next)
  }
  const startResize = (handle: ResizeHandle, e: PointerEvent) => {
    if (e.button !== 0 || selected === null) return
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    const p = toPt(e)
    setGdrag({
      index: selected,
      started: false,
      drag: {
        kind: 'resize',
        handle,
        dx: 0,
        dy: 0,
        free: e.altKey,
        aspect: e.shiftKey,
        keepScale: e.metaKey || e.ctrlKey,
      },
      startX: p.x,
      startY: p.y,
    })
  }
  const endGraphDrag = () => {
    const g = gdrag
    const o = graphOutcome
    setGdrag(null)
    if (!g) return
    if (press.current) press.current.moved = g.started
    if (!g.started || !o) return
    if (Math.abs(g.drag.dx) < 0.5 && Math.abs(g.drag.dy) < 0.5) return
    // (A legend entry dropped where it was: nothing.)
    if (!o.laid.some((c) => c.edits.length)) return
    // Each graph's edits, and its item moved so its plot stays put; one undo step.
    const cmds: DocCommand[] = o.laid.flatMap((c): DocCommand[] => [
      ...elementCommands(c.base.graph, c.edits),
      ...(Math.abs(c.shift.x) > 1e-6 || Math.abs(c.shift.y) > 1e-6
        ? [
            {
              type: 'node.set' as const,
              id,
              path: ['items', c.index],
              value: moveItem(layout.items[c.index]!, c.shift.x, c.shift.y),
            },
          ]
        : []),
    ])
    // Roadmap 43: announced with its Undo; the same elements dragged again replace it.
    const what = o.laid.map(
      (c) => `${c.graph.id}:${c.edits.map((x) => x.path.join('/')).join('|')}`,
    )
    trackUndo(() => dispatch(cmds, o.label), { group: `page:${id}:${what.join(',')}` })
  }
  /**
   * A pointer move of a drag, shown (roadmap 45) once an animation frame at most: the latest
   * position (`pageMoves`); a drag on a graph only once it has started (`onDragMove`).
   */
  const moveDrag = (e: PagePointer) => {
    const gItem = gdrag ? layout.items[gdrag.index] : undefined
    if (gdrag && gItem?.type === 'graph') {
      const p = e.p
      const s = gItem.scale
      // What is dragged is selected from the start.
      if (!gdrag.started && gdrag.select) setPageSel(gdrag.select)
      setGdrag({
        ...gdrag,
        started: true,
        drag: {
          ...gdrag.drag,
          dx: (p.x - gdrag.startX) / s,
          dy: (p.y - gdrag.startY) / s,
          free: e.altKey,
          ...(gdrag.drag.kind === 'resize'
            ? { aspect: e.shiftKey, keepScale: e.metaKey || e.ctrlKey }
            : {}),
        },
      })
      return
    }
    if (!drag) return
    const p = e.p
    setDrag({ ...drag, dx: p.x - drag.startX, dy: p.y - drag.startY, ...keys(e) })
  }
  /** The handlers of the latest render, for the frame that shows a move and the release. */
  const latest = useRef({ moveDrag, endDrag: () => {} })
  useLayoutEffect(() => {
    latest.current = { moveDrag, endDrag }
  })
  const pageMoves = useMemo(
    () => frameThrottle<PagePointer>((e) => flushSync(() => latest.current.moveDrag(e))),
    [],
  )
  useEffect(() => () => pageMoves.cancel(), [pageMoves])
  /** The graph drag whose pointer has gone 3 px, even if no frame has shown it yet. */
  const startedDrag = useRef<object | null>(null)
  const onDragMove = (e: PointerEvent) => {
    if (!drag && !gdrag) return
    const p = toPt(e)
    // Decision 120: a drag on a graph starts once the pointer has moved 3 px (a press is a click
    // till then), checked on every move.
    if (gdrag && !gdrag.started && startedDrag.current !== gdrag) {
      if (Math.hypot(p.x - gdrag.startX, p.y - gdrag.startY) * k < 3) return
      startedDrag.current = gdrag
    }
    pageMoves.push({
      p,
      altKey: e.altKey,
      shiftKey: e.shiftKey,
      metaKey: e.metaKey,
      ctrlKey: e.ctrlKey,
    })
  }
  /** The release: the last move shown first, then the drag ends as shown. */
  const onDragEnd = () => {
    pageMoves.flush()
    latest.current.endDrag()
  }
  const marqueeBox =
    drag?.mode === 'marquee'
      ? {
          x: Math.min(drag.startX, drag.startX + drag.dx),
          y: Math.min(drag.startY, drag.startY + drag.dy),
          w: Math.abs(drag.dx),
          h: Math.abs(drag.dy),
        }
      : null
  const endDrag = () => {
    if (gdrag) return endGraphDrag()
    const d = drag
    setDrag(null)
    if (!d) return
    if (d.mode === 'marquee') {
      const m = marqueeBox!
      if (m.w < 2 && m.h < 2) return
      // The items it touches, locked ones skipped, groups whole (decision 191; `pickInBox`).
      const hit = pickInBox(
        scene.items.map((b) => {
          const it = layout.items[b.index]
          return { index: b.index, box: b, locked: it?.locked, group: it?.group }
        }),
        m,
        { kind: 'touch' },
      )
      setSel(withGroups(layout.items, [...new Set([...sel, ...hit])]))
      return
    }
    if (d.mode === 'create') {
      const items = live?.items
      const made = items?.[items.length - 1]
      setTool(null)
      if (!items || !made) return
      setItems(items, `Add ${itemKindName(made).toLowerCase()}`, [items.length - 1])
      // A new text box is typed into straight away.
      if (made.type === 'text') setTextEdit(items.length - 1)
      return
    }
    if (press.current && d.mode === 'move')
      press.current.moved = Math.abs(d.dx) >= 0.5 || Math.abs(d.dy) >= 0.5
    if (Math.abs(d.dx) < 0.5 && Math.abs(d.dy) < 0.5) {
      // A click (no drag) on one of several selected items selects just that one (its group).
      if (d.mode === 'move' && sel.length > 1)
        setSel(withGroups(layout.items, [d.index]).length === sel.length ? sel : [d.index])
      return
    }
    // Roadmap 43: announced with its Undo; the same items dragged again replace it.
    const group = `page:${id}:${d.mode}:${selIds.join(',')}`
    if (live) {
      const label =
        d.mode === 'end' ? 'Move line end' : d.mode === 'group' ? 'Resize items' : 'Resize item'
      trackUndo(() => set(['items'], live.items, label), { group })
      return
    }
    const label = d.mode === 'scale' ? 'Resize graph' : sel.length > 1 ? 'Move items' : 'Move item'
    trackUndo(() => set(['items'], shown.items, label), { group })
  }
  /**
   * The selected parts of graphs on the page by graph (a graph placed twice counts once): its
   * item, graph, scene and the parts' keys.
   */
  const partsByGraph = () => {
    const out: { g: NonNullable<ReturnType<typeof graphItem>>; paths: StylePath[] }[] = []
    for (const k of elems) {
      const at = out.find((x) => x.g.item.id === k.item)
      if (at) at.paths.push(k.path)
      else {
        const g = graphItem(layout.items.findIndex((it) => it.id === k.item))
        if (g && !out.some((x) => x.g.graph.id === g.graph.id)) out.push({ g, paths: [k.path] })
      }
    }
    return out
  }
  /** The graph of an unlocked graph item, by the item's id (`graphItem`). */
  const itemGraphNode = (item: LayoutItemId) =>
    graphItem(layout.items.findIndex((it) => it.id === item))?.graph
  /** The page's graph items (unlocked) with their graphs and drawn nodes, for Same kind. */
  const sameKindGraphs = (): PageGraph[] =>
    layout.items.flatMap((it, i) => {
      const g = graphItem(i)
      return g ? [{ item: it.id, graph: g.graph, all: sceneIndex(g.scene.root).nodes.all }] : []
    })
  /** A graph's data sets' titles by key (for names and undo labels). */
  const titlesOf = (graph: GraphNode) => {
    const m = new Map(graphSeries(project, graph, lookup).map((x) => [x.key, x.title]))
    return (key: string) => m.get(key)
  }
  /** Arrow keys on selected parts of graphs: the movable ones move 1 pt (10 with Shift), one step. */
  const nudgeElements = (dx: number, dy: number) => {
    const cmds: DocCommand[] = []
    const all: ReturnType<typeof moveEdits>['edits'] = []
    for (const { g, paths } of partsByGraph()) {
      const targets = movableTargets(g.graph, g.scene, paths)
      if (!targets.length) continue
      const { edits } = moveEdits(g.graph, g.scene, targets, dx, dy)
      cmds.push(...elementCommands(g.graph, edits))
      all.push(...edits)
    }
    // Audit 3 (A7): announced, as a drag is.
    if (cmds.length)
      trackUndo(() => dispatch(cmds, moveLabel(all).replace('Move', 'Nudge')), {
        group: `nudge:${id}:parts`,
      })
  }
  const movableParts = partsByGraph().reduce(
    (n, { g, paths }) => n + movableTargets(g.graph, g.scene, paths).length,
    0,
  )
  const deletableParts = partsByGraph().some(({ g, paths }) =>
    paths.some((p) => deletable(g.graph, p)),
  )
  /**
   * Delete on selected parts of graphs (decision 852's rules, roadmap 47's): annotations and whole
   * layers removed (asking first when other layers go with them), data sets hidden in their layer,
   * points hidden on their graph, one step announced with its Undo; then the graph item of the
   * primary part is selected. Nothing when no part can be deleted.
   */
  const deleteElements = async () => {
    const done = partsByGraph().flatMap(({ g, paths }) => {
      const d = deleteEdits(g.graph, paths, titlesOf(g.graph))
      return d ? [{ g, d }] : []
    })
    if (!done.length) return
    const questions = done.flatMap(({ g, d }) => {
      const q = removeLayersQuestion(g.graph, d.layers)
      return q ? [q] : []
    })
    if (questions.length) {
      const q =
        questions.length === 1
          ? questions[0]!
          : { ...questions[0]!, title: 'Delete these layers and what is on them?' }
      const yes = await confirm(q)
      focusCanvas()
      if (!yes) return
    }
    const sum = (f: (t: DeleteTally) => number) => done.reduce((n, x) => n + f(x.d.tally), 0)
    const label =
      done.length === 1
        ? done[0]!.d.label
        : deleteLabel({
            annotations: sum((t) => t.annotations),
            layers: sum((t) => t.layers),
            dataSets: sum((t) => t.dataSets),
            points: sum((t) => t.points),
            point: done.find((x) => x.d.tally.points)?.d.tally.point ?? 'point',
            entries: sum((t) => t.entries ?? 0),
          })
    trackUndo(() =>
      dispatch(
        done.flatMap((x) => x.d.commands),
        label,
      ),
    )
    if (primaryEl) setPageSel(single(itemKey(id, primaryEl.item)))
  }
  /** Roadmap 47b: a part's graph item on the page (its graph and scene), by the item's id. */
  const itemOf = (item: LayoutItemId) => graphItem(layout.items.findIndex((it) => it.id === item))
  /**
   * Roadmap 47b: what the format bar formats — legend entries of graphs on the page as their
   * data sets (or layers, else the legend), as on the graph's canvas.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: itemOf reads the page and its scenes
  const barSel = useMemo(
    () =>
      barSelection(psel, (k) => {
        if (k.kind !== 'pageElement') return undefined
        const g = itemOf(k.item)
        return g ? entryTargetIn(sceneIndex(g.scene.root).nodes)(String(k.path[2])) : undefined
      }),
    [psel, layout, project, lookup, version],
  )
  /**
   * Roadmap 47b: Alt+arrows on legend entries selected in one graph on the page: moved one place
   * (one step); false when none is selected.
   */
  const moveEntriesOnPage = (by: 1 | -1): boolean => {
    const p = primaryEl
    const keys = p ? pageElementsOf(psel, p.item).flatMap((k) => entryKeyOf(k.path) ?? []) : []
    const g = p && itemOf(p.item)
    if (!keys.length || !g) return false
    const m = moveEntriesCommand(g.graph, g.scene.legend ?? [], keys, by, true)
    if (m) trackUndo(() => dispatch(m.command, m.label))
    return true
  }
  /** The Format dialog of the primary part of a graph on the page (its element's dialog and tab). */
  const elementFormat =
    primaryEl && selGraph
      ? formatTargetFor(
          primaryEl.path,
          selGraph,
          layerSeriesOf(psel.drill)?.layer,
          selScene ? entryTargetIn(sceneIndex(selScene.root).nodes) : undefined,
        )
      : null
  const elementWhat = elementFormat && selGraph ? describeTarget(elementFormat, selGraph) : null
  /**
   * Roadmap 46: the Format panel on a page formats the graph worked in (a part's own graph, or a
   * graph item selected alone), following the selection; it takes the inspector's place while it
   * is open and a graph is worked in (one right panel at a time), the inspector coming back for
   * other selections. "Open in window" is the dialog, as on the graph's canvas.
   */
  const primarySel = primaryKey(psel)
  const pageScope = primarySel ? keyId(primarySel) : 'page'
  const formatHost = useFormatHost(pageScope, elementFormat ?? graphPlace())
  const panelGraph = selGraph && (elems.length > 0 || selected !== null) ? selGraph : null
  const showFormat = (target: FormatTarget, focus = false) => formatHost.show(target, { focus })
  // Roadmap 47: the parts of the graph worked in that the panel's list of layers and its point
  // formats read: its whole layers (the list's selection) and its points.
  const panelItem = ctxAt === null ? undefined : layout.items[ctxAt]
  const panelParts = elems.filter((k) => k.item === panelItem?.id).map((k) => k.path)
  const panelPoints = panelParts.flatMap((p): PointRef[] =>
    p[0] === 'pointOverrides' && p.length === 3 ? [[String(p[1]), String(p[2])]] : [],
  )
  const panelLayers: LayerSelection = {
    ids: panelParts.flatMap((p) => (p[0] === 'layers' && p.length === 2 ? [String(p[1])] : [])),
    primary:
      primaryEl?.item === panelItem?.id &&
      primaryEl?.path[0] === 'layers' &&
      primaryEl.path.length === 2
        ? String(primaryEl.path[1])
        : undefined,
    select: (ids, primary) => {
      if (!panelItem) return
      if (!ids.length || primary === null) {
        const key = itemKey(id, panelItem.id)
        setPageSel(single(key))
        formatHost.setTarget(graphPlace('layers'), keyId(key))
        return
      }
      const key = (l: string) => pageElementKey(id, panelItem.id, ['layers', l])
      setPageSel(selectionOf(ids.map(key), key(primary)))
      formatHost.setTarget(layerPlace(primary, 'layers'), keyId(key(primary)))
    },
  }
  const formatElement = (focus = false) =>
    elementFormat && selGraph && showFormat(elementFormat, focus)

  /** Arrow keys nudge the selection by 1 pt (10 pt with Shift); locked items stay. */
  const nudge = (dx: number, dy: number) => {
    if (!sel.length || sel.some((i) => layout.items[i]?.locked)) return
    trackUndo(
      () =>
        set(
          ['items'],
          layout.items.map((it, i) => (sel.includes(i) ? moveItem(it, dx, dy) : it)),
          'Nudge',
        ),
      { group: `nudge:${id}:${sel.join(',')}` },
    )
  }

  /** Double-click on a graph of the page: the Format dialog of the element under the pointer. */
  const formatAt = (e: { clientX: number; clientY: number }, index: number) => {
    // Text: edited in place.
    if (layout.items[index]?.type === 'text') {
      setTextEdit(index)
      return
    }
    const f = formatOnPage(project, layout, scene, index, toPt(e))
    if (f) showFormat(f.target)
  }
  /**
   * Roadmap 45: a right-click on a selected part of a graph keeps the parts selected (as one on a
   * selected element of the canvas does, decision 852) and shows what applies to them: the
   * primary part's Format dialog, Select ▸ Same kind, the selection's registry commands with the
   * count (`FORMAT_MENU_IDS`). False when the pointer isn't on a selected part.
   */
  const partsMenuAt = (e: React.MouseEvent, index: number): boolean => {
    const it = layout.items[index]
    if (!elems.length || it?.type !== 'graph') return false
    const at = toPt(e)
    const hit = partAt(index, at.x, at.y)
    const mine = pageElementsOf(psel, it.id).map((k) => k.path)
    if (!hit || !keysMatcher(mine)?.(hit.target, { id: '', point: hit.point })) return false
    const entries: MenuEntry[] = [
      ...(elementFormat
        ? [{ label: `Format ${elementWhat}…`, onSelect: () => formatElement() }]
        : []),
      '-',
      selectMenuEntry(['kind', 'everyLayer', 'everyGraph']),
      ...selectionCommandEntries(FORMAT_MENU_IDS, elems.length),
    ]
    setMenu({ x: e.clientX, y: e.clientY, entries, label: 'Selected elements' })
    return true
  }
  const contextMenuAt = (e: React.MouseEvent, index: number) => {
    e.preventDefault()
    if (partsMenuAt(e, index)) return
    // Right-click on one of several selected items keeps them selected (Align, Stack…).
    const several = sel.length > 1 && sel.includes(index)
    if (!several) setSel(withGroups(layout.items, [index]))
    const f = formatOnPage(project, layout, scene, index, toPt(e))
    const entries: MenuEntry[] = f
      ? pageFormatChoices(f).map((c) => ({
          label: c.label,
          onSelect: () => showFormat(c.target),
        }))
      : []
    // Go to row (roadmap 34d): the table, with the mark's row selected.
    const mark = markOnPage(project, layout, scene, index, toPt(e))
    const to = mark ? markInfo(project, mark.graph, mark.node, lookup)?.goTo : undefined
    if (to && onOpen) entries.push({ label: 'Go to row', onSelect: () => goToRow(to) })
    entries.push('-')
    if (several)
      entries.push(
        'arrange.align.left',
        'arrange.align.top',
        'arrange.alignLeft',
        'arrange.alignTop',
        'arrange.stackVertical',
        'arrange.sideBySide',
        'arrange.equalSizes',
        '-',
        'arrange.group',
        'arrange.ungroup',
      )
    else entries.push('edit.copyGraph', '-', 'arrange.bringToFront', 'arrange.sendToBack')
    // Roadmap 45: Select ▸ all items of this type; the selection's registry commands, counted.
    entries.push(
      '-',
      selectMenuEntry(['kind']),
      ...selectionCommandEntries(
        FORMAT_MENU_IDS,
        several ? sel.length : withGroups(layout.items, [index]).length,
      ),
    )
    entries.push('-', 'edit.duplicate', 'arrange.lock', '-', {
      command: 'arrange.remove',
      danger: true,
    })
    setMenu({ x: e.clientX, y: e.clientY, entries, label: 'Page item' })
  }
  // Hover cards (roadmap 34d): a mark of a graph on the page, its row or statistics, beside it.
  const hoverMark = useHoverMark()
  const [hovered, setHovered] = useState<{ graph: GraphNode; at: CSSProperties } | null>(null)
  const hoverAt = (e: React.PointerEvent, index: number) => {
    if (drag || gdrag || tool) return hoverMark.hover(null)
    const mark = markOnPage(project, layout, scene, index, toPt(e))
    hoverMark.hover(mark?.node ?? null)
    // Moving within one mark changes nothing (no re-render per pointer move).
    if (!mark || (hovered?.graph.id === mark.graph.id && hoverMark.node?.id === mark.node.id))
      return
    const b = boxInRoot(scene.root, mark.node)
    const r = svgRef.current?.getBoundingClientRect()
    if (!b || !r) return
    const right = b.x + b.w / 2 > scene.width / 2
    setHovered({
      graph: mark.graph,
      at: right
        ? {
            position: 'fixed',
            right: window.innerWidth - (r.left + b.x * k) + 8,
            top: r.top + b.y * k - 4,
          }
        : { position: 'fixed', left: r.left + (b.x + b.w) * k + 8, top: r.top + b.y * k - 4 },
    })
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: version tracks result changes
  const card = useMemo(
    () =>
      hoverMark.node && hovered ? markInfo(project, hovered.graph, hoverMark.node, lookup) : null,
    [hoverMark.node, hovered, project, lookup, version],
  )
  const goToRow = (to: NonNullable<MarkInfo['goTo']>) => {
    requestReveal(to)
    onOpen?.(to.table)
  }

  /** Right-click on the page around the items. */
  const pageMenuAt = (e: React.MouseEvent) => {
    if (e.defaultPrevented) return
    e.preventDefault()
    const at = onPage(toPt(e))
    const entries: MenuEntry[] = [
      // Pastes where the menu was opened.
      { label: pasteLabel, disabled: !pasteable, onSelect: () => paste(null, at) },
      'insert.text',
      'insert.image',
      'insert.liveTable',
      '-',
      'arrange.grid',
      'arrange.equalSizes',
      'arrange.shareY',
      'arrange.matchFormat',
      'arrange.unlockAll',
      '-',
      'edit.copyPage',
      'file.export',
      'file.export.sourceData',
    ]
    setMenu({ x: e.clientX, y: e.clientY, entries, label: 'Page' })
  }
  const focusCanvas = () => canvasRef.current?.focus({ preventScroll: true })
  const closeFormat = () => {
    formatHost.closeWindow()
    focusCanvas()
  }

  const graphs = graphsOf(project)
  const exporter = useExport(
    () => ({ name: layout.name, target: figure().target }),
    'layout',
    onError,
  )
  const exportWorkbook = useWorkbookExport(onError)

  /** Adds items on top of the page and selects them. */
  const addItems = (added: LayoutItem[], label: string) => {
    if (!added.length) return
    const n = layout.items.length
    setItems(
      [...layout.items, ...added],
      label,
      added.map((_, i) => n + i),
    )
  }
  const addGraph = (gid: NodeId) => {
    const graph = project.nodes[gid] as GraphNode
    const s = layoutGraph({ project, graph, fonts })
    const scale = fitScale(layout.page, s)
    const offset = 12 * (layout.items.length % 8)
    addItems(
      [{ type: 'graph', id: newLayoutItemId(), graph: gid, x: 36 + offset, y: 36 + offset, scale }],
      'Add graph to layout',
    )
  }
  const addText = () =>
    addItems(
      [
        {
          type: 'text',
          id: newLayoutItemId(),
          x: 36,
          y: 36,
          content: { content: [{ text: 'Text' }] },
        },
      ],
      'Add text',
    )
  /** Image files onto the page (centred on `at` when given), or why they can't be placed. */
  const insertImages = (
    files: { name: string; bytes: Uint8Array }[],
    at: { x: number; y: number } | null,
  ) => {
    const room = { width: layout.page.width - 72, height: layout.page.height - 72 }
    const added: LayoutItem[] = []
    const problems: string[] = []
    files.forEach((f, i) => {
      try {
        const { dpi, ...img } = imageAsset(f.bytes)
        const held = assets.add(img)
        const spot = at && { x: at.x + i * PASTE_STEP, y: at.y + i * PASTE_STEP }
        added.push(imageItemFor({ ...held, ...(dpi ? { dpi } : {}) }, room, spot))
      } catch (e) {
        problems.push(
          e instanceof AssetError ? `${f.name ? `${f.name}: ` : ''}${e.message}` : errorMessage(e),
        )
      }
    })
    addItems(added, added.length > 1 ? 'Add images' : 'Add image')
    if (problems.length) onError(problems.join(' '))
  }
  const pickImage = async () => {
    try {
      const file = await platform.openFile('Images', IMAGE_EXTENSIONS)
      if (file) insertImages([file], null)
    } catch (e) {
      onError(errorMessage(e))
    }
  }
  const insertTable = (source: PageTableSource) => {
    setTableDialog(false)
    const offset = 12 * (layout.items.length % 8)
    addItems([tableItemFor(source, { x: 36 + offset, y: 36 + offset })], 'Add table')
  }

  const removeSelected = () => {
    if (!sel.length) return
    set(
      ['items'],
      layout.items.filter((_, i) => !sel.includes(i)),
      sel.length > 1 ? 'Remove items' : 'Remove item',
    )
    setSel([])
  }
  const zorder = (op: ZOrder) => {
    if (!sel.length) return
    const r = reorderItems(layout.items, sel, op)
    const label = {
      front: 'Bring to front',
      back: 'Send to back',
      forward: 'Bring forward',
      backward: 'Send backward',
    }[op]
    setItems(r.items, label, r.selection)
  }
  const arrange = () => {
    const scene = (graph: GraphNode) => layoutGraph({ project, graph, fonts })
    const graphOf = (it: LayoutItemOf<'graph'>) => {
      const g = project.nodes[it.graph]
      return g?.kind === 'graph' ? g : undefined
    }
    // In place (audit 2, U3): ids, groups, locks and the stacking order stay; locked graphs stay.
    set(
      ['items'],
      arrangeGraphItems(layout.items, graphOf, scene, layout.page, { columns }),
      'Arrange graphs',
    )
  }

  // ---- Arranging any items (roadmap 32) -------------------------------------------------------

  const boxOf = (i: number) => scene.items.find((b) => b.index === i)
  const units = arrangeUnits(layout.items, sel, boxOf)
  const anyLocked = sel.some((i) => layout.items[i]?.locked)
  const alignItems = (edge: AlignEdge) => {
    if (!units.length || anyLocked) return
    // Several: within their bounds; one item (or group): on the page.
    const ref =
      units.length > 1
        ? unionOf(units.map((u) => u.box))!
        : { x: 0, y: 0, w: layout.page.width, h: layout.page.height }
    const names: Record<AlignEdge, string> = {
      left: 'Align left',
      center: 'Align centres',
      right: 'Align right',
      top: 'Align top',
      middle: 'Align middles',
      bottom: 'Align bottom',
    }
    set(['items'], applyMoves(layout.items, alignMoves(units, edge, ref)), names[edge])
  }
  const distribute = (axis: 'x' | 'y') => {
    if (units.length < 3 || anyLocked) return
    set(
      ['items'],
      applyMoves(layout.items, distributeMoves(units, axis)),
      axis === 'x' ? 'Distribute horizontally' : 'Distribute vertically',
    )
  }
  const canGroup = units.length >= 2
  const grouped = sel.some((i) => layout.items[i]?.group)
  const group = () => {
    if (!canGroup) return
    const r = groupItems(layout.items, sel)
    setItems(r.items, 'Group', r.selection)
  }
  const ungroup = () => grouped && set(['items'], ungroupItems(layout.items, sel), 'Ungroup')
  const lockedCount = layout.items.filter((it) => it.locked).length
  const lock = () => {
    if (!sel.length) return
    set(['items'], setLocked(layout.items, sel, true), sel.length > 1 ? 'Lock items' : 'Lock item')
    setSel([])
  }
  const unlockAll = () =>
    lockedCount &&
    set(
      ['items'],
      setLocked(
        layout.items,
        layout.items.map((_, i) => i),
        false,
      ),
      'Unlock all',
    )
  /** Copies of the selection a step down and right, on top, selected (⌘D). */
  const duplicate = () => {
    if (!sel.length) return
    const copies = copyItems(
      sel.map((i) => layout.items[i]!),
      PASTE_STEP,
      PASTE_STEP,
    )
    addItems(copies, 'Duplicate')
  }

  /** The graphs the page actions work on: the shift-selection, else every graph on the page. */
  const targetGraphs = (): GraphNode[] => {
    const idx = sel.length >= 2 ? sel : layout.items.map((_, i) => i)
    const seen = new Set<string>()
    return idx.flatMap((i) => {
      const it = layout.items[i]
      const g = it?.type === 'graph' ? project.nodes[it.graph] : undefined
      if (g?.kind !== 'graph' || seen.has(g.id)) return []
      seen.add(g.id)
      return [g]
    })
  }
  const graphCommands = (next: GraphNode[], before: GraphNode[]) =>
    next.flatMap((g, i) => graphChangeCommands(before[i]!, g))
  const equalSizes = () => {
    const gs = targetGraphs()
    dispatch(graphCommands(equalizePlotSizes(gs), gs), 'Make plot sizes equal')
  }
  const shareY = () => {
    const gs = targetGraphs().filter((g) => g.axes.y.type === 'continuous')
    if (gs.length < 2)
      return onError('Choose at least two graphs with a numeric Y axis.', 'validation')
    const group = gs.find((g) => g.links?.y)?.links?.y ?? newNodeId()
    dispatch(
      gs.map((g) => ({
        type: 'node.set' as const,
        id: g.id,
        path: ['links'],
        value: { ...g.links, y: group },
      })),
      'Share Y axes',
    )
  }
  const matchFirst = () => {
    const [first, ...rest] = targetGraphs()
    if (!first || !rest.length) return onError('Choose at least two graphs.', 'validation')
    const next = rest.map((g) => matchGraphFormat(project, g, first, undefined, lookup))
    dispatch(graphCommands(next, rest), 'Match format')
  }

  /** A set's grid with another column count (roadmap 34d): its graphs re-placed in order. */
  const gridColumns = (setId: string, columns: number) => {
    const grid = layout.grids?.find((g) => g.set === setId)
    if (!grid || columns === grid.columns) return
    const members = new Set(setMembers(project, setId).map((g) => g.id))
    const order = layout.items
      .flatMap((it) =>
        it.type === 'graph' && members.has(it.graph)
          ? [{ graph: it.graph, cell: gridIndexAt(grid, it.x, it.y) }]
          : [],
      )
      .sort((a, b) => a.cell - b.cell)
      .map((x) => x.graph)
    // Laid out again on the page as a split first places them: fitted, plot areas aligned.
    const graphs = [...new Set(order)].map((g) => project.nodes[g] as GraphNode)
    const scenes = graphs.map((graph) => ({
      scene: layoutGraph({ project, graph, fonts, result: lookup }),
    }))
    const fit = alignedGrid(scenes, layout.page, { columns, equalPlotSize: true })
    const at = new Map(graphs.map((g, i) => [g.id, fit.placements[i]!]))
    const items = layout.items.map((it) =>
      it.type === 'graph' && at.has(it.graph) ? { ...it, ...at.get(it.graph)! } : it,
    )
    const { placements: _, ...metrics } = fit
    const grids = (layout.grids ?? []).map((g) =>
      g.set === setId ? { set: setId, ...metrics } : g,
    )
    dispatch({ type: 'node.replace', node: { ...layout, items, grids } }, 'Change columns')
  }

  const [stackShareY, setStackShareY] = useState(true)
  const [stackHideInner, setStackHideInner] = useState(true)
  /** Stack the shift-selected graphs (in their current order on the page), aligned by plot area. */
  const stack = (direction: StackDirection) => {
    const picked = sel
      .map((i) => ({ i, it: layout.items[i] }))
      .filter((x): x is { i: number; it: LayoutItemOf<'graph'> } => x.it?.type === 'graph')
      .sort((a, b) => (direction === 'vertical' ? a.it.y - b.it.y : a.it.x - b.it.x))
    const graphs = picked
      .map(({ it }) => project.nodes[it.graph])
      .filter((g): g is GraphNode => g?.kind === 'graph')
    if (graphs.length < 2 || graphs.length !== picked.length)
      return onError('Select two or more graphs on the page to stack them.', 'validation')
    // A shared range only makes sense for views of the same data.
    const sameTable = graphs.every((g) => g.seriesSource.table === graphs[0]!.seriesSource.table)
    const res = stackGraphs(project, graphs, fonts, layout.page, {
      direction,
      shareY: stackShareY && sameTable,
      hideInner: stackHideInner,
    })
    // Keep the group where it is: its top-left corner stays put.
    const ox = Math.min(...picked.map(({ it }) => it.x))
    const oy = Math.min(...picked.map(({ it }) => it.y))
    const dx = ox - Math.min(...res.placements.map((p) => p.x))
    const dy = oy - Math.min(...res.placements.map((p) => p.y))
    const items = layout.items.map((it, i): LayoutItem => {
      const k = picked.findIndex((p) => p.i === i)
      if (k < 0 || it.type !== 'graph') return it
      const p = res.placements[k]!
      return { ...it, x: p.x + dx, y: p.y + dy, scale: p.scale }
    })
    dispatch(
      [
        ...graphCommands(res.graphs, graphs),
        { type: 'node.set', id, path: ['items'], value: items },
      ],
      direction === 'vertical' ? 'Stack graphs' : 'Place graphs side by side',
    )
  }

  /** Moves the selected graphs so their plot areas share a left edge (or top edge). */
  const alignPlots = (edge: 'left' | 'top') => {
    const boxes = scene.items.filter((b) => sel.includes(b.index) && b.plot)
    if (boxes.length < 2) return onError('Select two or more graphs to align.', 'validation')
    const target = Math.min(...boxes.map((b) => (edge === 'left' ? b.plot!.x : b.plot!.y)))
    set(
      ['items'],
      layout.items.map((it, i) => {
        const b = boxes.find((x) => x.index === i)
        if (!b) return it
        return edge === 'left'
          ? moveItem(it, target - b.plot!.x, 0)
          : moveItem(it, 0, target - b.plot!.y)
      }),
      edge === 'left' ? 'Align plot left edges' : 'Align plot tops',
    )
  }
  const selectedGraphs = sel.filter((i) => layout.items[i]?.type === 'graph').length
  const graphsOnPage = layout.items.filter((it) => it.type === 'graph').length
  // What the page actions work on: two or more selected graphs, else every graph on the page.
  const pageGraphs = sel.length >= 2 ? selectedGraphs : graphsOnPage
  const selectedGraph = selItem?.type === 'graph' ? selItem.graph : undefined

  // Copy as vector (roadmap 23): Copy page (⇧⌘C), Copy graph (the graph selected alone), ⌘C
  // (that graph, else the selected items, else the page), and Paste (⌘V: the graph or items
  // copied last, where the pointer is; an image on the clipboard as an image item).
  const viewRef = useRef<HTMLDivElement>(null)
  /** The pointer on the page (points), or null when it is elsewhere. */
  const pointer = useRef<{ x: number; y: number } | null>(null)
  const onPage = (p: { x: number; y: number }) =>
    p.x >= 0 && p.y >= 0 && p.x <= layout.page.width && p.y <= layout.page.height ? p : null
  const copied = useSyncExternalStore(graphClipboard.subscribe, () => graphClipboard.get())
  const pasteable = !!copied?.items || !!pasteableGraph(project, copied?.graph ?? null)
  const pasteLabel = copied?.items ? 'Paste' : 'Paste graph'
  const copyGraph = selectedGraphOf(project, layout, sel)
  const report = (p: Promise<string>) =>
    void p.then(onNotice, (e: unknown) => onError(errorMessage(e)))
  /** The selected items, with the images they place, for the app's clipboard record. */
  const copiedItems = (): CopiedGraph['items'] => {
    const items = sel.map((i) => layout.items[i]!).filter(Boolean)
    const imgs = [
      ...new Set(items.flatMap((it) => (it.type === 'image' ? [it.asset] : []))),
    ].flatMap((a) => assets.get(a) ?? [])
    return { items: structuredClone(items), assets: imgs }
  }
  const copyPage = () =>
    report(
      copyToClipboard(platform, figure(), {
        what: `the page of “${layout.name}”`,
        graph: null,
      }),
    )
  const copySelectedGraph = () => {
    if (copyGraph && selScene)
      report(
        copyToClipboard(platform, figure({ kind: 'graph', graph: copyGraph.id }), {
          what: `“${copyGraph.name}”`,
          graph: copyGraph.id,
          items: copiedItems(),
        }),
      )
  }
  /** The selected items alone, as a page of their bounds (panel letters left off). */
  const selectionPage = (): FigureTarget | null => {
    const box = unionOf(sel.flatMap((i) => boxOf(i) ?? []))
    if (!box) return null
    const pad = 4
    const items = sel.map((i) => moveItem(layout.items[i]!, pad - box.x, pad - box.y))
    return {
      kind: 'page',
      layout: {
        ...layout,
        items,
        page: { width: box.w + 2 * pad, height: box.h + 2 * pad },
        panelLabels: { ...layout.panelLabels, show: false },
      },
    }
  }
  const copySelection = () => {
    if (copyGraph) return copySelectedGraph()
    const s = sel.length ? selectionPage() : null
    if (!s) return copyPage()
    report(
      copyToClipboard(platform, figure(s), {
        what:
          sel.length > 1
            ? `${sel.length} items`
            : itemKindName(layout.items[sel[0]!]!).toLowerCase(),
        graph: null,
        items: copiedItems(),
      }),
    )
  }
  /** Pastes copied page items: as copies, stepped off anything already at their place. */
  const pasteItems = (rec: NonNullable<CopiedGraph['items']>) => {
    for (const a of rec.assets) assets.add(a)
    // What can't come along: graphs and tables whose sheets aren't in this project.
    const fits = rec.items.filter((it) =>
      it.type === 'graph'
        ? project.nodes[it.graph]?.kind === 'graph'
        : it.type === 'table'
          ? !!project.nodes[it.source.node]
          : true,
    )
    if (!fits.length)
      return onError('The copied items show sheets that aren’t in this project.', 'validation')
    const taken = layout.items.map(originOf)
    const at = (dx: number) =>
      fits.some((it) => {
        const o = originOf(it)
        return taken.some((t) => Math.abs(t.x - o.x - dx) < 0.5 && Math.abs(t.y - o.y - dx) < 0.5)
      })
    let d = 0
    while (d < 20 * PASTE_STEP && at(d)) d += PASTE_STEP
    addItems(copyItems(fits, d, d), fits.length > 1 ? 'Paste items' : 'Paste item')
  }
  /** Pastes the copied graph or items if the clipboard still holds them (see `copiedToPaste`). */
  const pasteCopied = (seen: ClipboardSeen, at: { x: number; y: number } | null) => {
    const rec = copiedToPaste(graphClipboard.get(), seen)
    if (rec?.items) return pasteItems(rec.items)
    const graph = pasteableGraph(project, rec?.graph ?? null)
    if (!graph) {
      onError(
        'The clipboard holds no graph copied here: copy one first (Edit › Copy graph).',
        'validation',
      )
      return
    }
    const s = layoutGraph({ project, graph, fonts, result: lookup })
    const place = pastePlacement(layout.page, s, at, layout.items.map(originOf))
    addItems([{ type: 'graph', id: newLayoutItemId(), graph: graph.id, ...place }], 'Paste graph')
  }
  /** With what can be seen of the clipboard: its change count (desktop) and text (a paste event). */
  const paste = (text: string | null, at: { x: number; y: number } | null) => {
    const stamp = platform.clipboardStamp
    if (!stamp) return pasteCopied({ text }, at)
    stamp().then(
      (s) => pasteCopied({ stamp: s, text }, at),
      () => pasteCopied({ text }, at),
    )
  }
  /** Whether one pasted image file is the copy recorded last (see `pastedImageIsCopy`). */
  const isOwnCopy = (files: { bytes: Uint8Array }[], text: string | null) => {
    if (files.length !== 1 || !pasteable) return false
    let image: { width: number; height: number } | null = null
    try {
      image = imageInfo(files[0]!.bytes)
    } catch {}
    return pastedImageIsCopy(graphClipboard.get(), text, image)
  }
  useClipboardEvents(viewRef, {
    copy: copySelection,
    paste: {
      // Always: an image on the clipboard pastes as an image item.
      active: true,
      run: (e) => {
        const text = e.clipboardData?.getData('text/plain') ?? null
        const at = pointer.current
        if (carriesFiles(e.clipboardData)) {
          void transferFiles(e.clipboardData)
            .then(readFiles)
            .then((files) => {
              // The app's own copy (browsers paste its PNG as a file): paste the copy; also when
              // the files can't be had after all (Firefox lists some it doesn't give).
              if (!files.length ? pasteable : isOwnCopy(files, text)) paste(text, at)
              else insertImages(files, at)
            })
          return true
        }
        if (!pasteable) return false
        paste(text, at)
        return true
      },
    },
  })

  /** A part other than the whole graph is selected: Format… names it. */
  const formatsElement = !!elementWhat && elementWhat !== 'graph'
  const formatButton = {
    shortcut: FORMAT_SHORTCUT,
    icon: 'paintbrush',
    toolbar: { group: TOOLBAR_GROUPS.view, order: 95 },
  }
  const commands: Command[] = [
    // Roadmap 46: Format panel (⌘1) and Format in window… (a graph worked in).
    ...formatPanelCommands(formatHost, !!selGraph, focusCanvas),
    ...pageItemCommands({
      selected: sel.length,
      units: units.length,
      anyLocked,
      canGroup,
      grouped,
      lockedCount,
      tool,
      setTool,
      zorder,
      group,
      ungroup,
      lock,
      unlockAll,
      align: alignItems,
      distribute,
      pickImage: () => void pickImage(),
      openTable: () => setTableDialog(true),
      duplicate,
    }),
    {
      id: 'arrange.bringToFront',
      label: 'Bring to front',
      menu: arrangeMenu(GROUPS.arrange.order, 10),
      enabled: sel.length > 0,
      run: () => zorder('front'),
    },
    {
      id: 'arrange.sendToBack',
      label: 'Send to back',
      menu: arrangeMenu(GROUPS.arrange.order, 20),
      enabled: sel.length > 0,
      run: () => zorder('back'),
    },
    {
      id: 'arrange.remove',
      label: sel.length > 1 ? 'Remove items from page' : 'Remove from page',
      menu: arrangeMenu(GROUPS.arrange.order, 30),
      enabled: sel.length > 0,
      hint: 'Take the selected items off the page (the graphs themselves stay)',
      run: removeSelected,
    },
    {
      id: 'arrange.alignLeft',
      label: 'Align plot left edges',
      menu: arrangeMenu(GROUPS.arrange.align, 10),
      enabled: selectedGraphs >= 2,
      hint: 'Line up the selected graphs’ plot areas by their left edges',
      run: () => alignPlots('left'),
    },
    {
      id: 'arrange.alignTop',
      label: 'Align plot tops',
      menu: arrangeMenu(GROUPS.arrange.align, 20),
      enabled: selectedGraphs >= 2,
      hint: 'Line up the selected graphs’ plot areas by their top edges',
      run: () => alignPlots('top'),
    },
    {
      id: 'arrange.stackVertical',
      label: 'Stack vertically',
      menu: arrangeMenu(GROUPS.arrange.align, 30),
      enabled: selectedGraphs >= 2,
      hint: 'One above the other: equal plot widths, categories line up',
      run: () => stack('vertical'),
    },
    {
      id: 'arrange.sideBySide',
      label: 'Side by side',
      menu: arrangeMenu(GROUPS.arrange.align, 40),
      enabled: selectedGraphs >= 2,
      hint: 'Equal plot heights, Y scales line up',
      run: () => stack('horizontal'),
    },
    {
      id: 'arrange.equalSizes',
      label: 'Make plot sizes equal',
      menu: arrangeMenu(GROUPS.arrange.align, 50),
      enabled: pageGraphs >= 2,
      hint: 'The same plot size for the selected graphs (or every graph on the page)',
      run: equalSizes,
    },
    {
      id: 'arrange.shareY',
      label: 'Share the Y axis range',
      menu: arrangeMenu(GROUPS.arrange.graphs, 10),
      enabled: pageGraphs >= 2,
      hint: 'One automatic Y range for the selected graphs (or every graph on the page), kept in sync',
      run: shareY,
    },
    {
      id: 'arrange.matchFormat',
      label: 'Match format to the first',
      menu: arrangeMenu(GROUPS.arrange.graphs, 20),
      enabled: pageGraphs >= 2,
      hint: 'Give the selected graphs (or every graph on the page) the first one’s format',
      run: matchFirst,
    },
    {
      id: 'arrange.grid',
      label: `Arrange in a grid (${columns} column${columns > 1 ? 's' : ''})`,
      menu: arrangeMenu(GROUPS.arrange.graphs, 30),
      enabled: graphsOnPage > 0,
      hint: 'Every graph on the page on a grid, plot areas aligned (columns: in the Page panel; locked graphs stay where they are)',
      run: arrange,
    },
    // Roadmap 44: with a part of a graph selected, the Format button (⇧⌘E) names and opens it
    // (Format title… / Format Y axis… / Format data set…), as on the graph's own canvas.
    {
      id: 'format.graph',
      label: 'Format graph…',
      menu: { menu: 'format', group: GROUPS.format.graph, order: 10 },
      ...(formatsElement ? {} : formatButton),
      enabled: !!selectedGraph,
      disabledReason: 'Select a graph on the page',
      hint: 'Format the selected graph (or double-click it)',
      run: () => selectedGraph && showFormat(graphPlace()),
    },
    ...(formatsElement
      ? [
          {
            id: 'format.selection',
            label: `Format ${elementWhat}…`,
            menu: { menu: 'format', group: GROUPS.format.graph, order: 5 },
            ...formatButton,
            keywords: ['format selection'],
            hint: 'Format the selected part of the graph (or double-click it)',
            run: () => formatElement(),
          } satisfies Command,
        ]
      : []),
    {
      id: 'format.axes',
      label: 'Format axes…',
      menu: { menu: 'format', group: GROUPS.format.graph, order: 20 },
      icon: 'ruler',
      enabled: !!selectedGraph,
      disabledReason: 'Select a graph on the page',
      hint: 'Format the selected graph’s axes',
      run: () => selectedGraph && showFormat(axisPlace('y')),
    },
    {
      id: 'insert.text',
      label: 'Text',
      menu: { menu: 'insert', group: GROUPS.insert.page, order: 10 },
      run: addText,
    },
    ...graphs.map(
      (g, i): Command => ({
        id: `insert.graphOnPage.${g.id}`,
        label: g.name,
        menu: {
          menu: 'insert',
          group: GROUPS.insert.page,
          order: 20 + i / 1000,
          submenu: 'Graph on page',
        },
        hideInPalette: true,
        run: () => addGraph(g.id),
      }),
    ),
    {
      id: 'edit.selectAll',
      label: 'Select all',
      menu: { menu: 'edit', group: GROUPS.edit.clipboard, order: 60 },
      shortcut: 'Mod+A',
      enabled: layout.items.length > 0,
      // Locked items stay out (they are picked from the Page panel).
      run: () => setSel(layout.items.flatMap((it, i) => (it.locked ? [] : [i]))),
    },
    // Roadmap 45: Select ▸ Same kind (items of the primary's type; parts across graphs).
    ...sameKindCommands(
      ['kind', 'everyLayer', 'everyGraph'],
      (scope) => pageKindName(psel, layout.items, itemGraphNode, scope),
      (scope) => {
        const next =
          primaryKey(psel)?.kind === 'item'
            ? scope === 'kind'
              ? selectSameItems(psel, id, layout.items)
              : null
            : selectSameKindOnPage(psel, id, sameKindGraphs(), scope)
        if (next) setPageSel(next)
      },
    ),
    ...copyCommands({
      copy: {
        hint: 'Copy the graph selected alone, else the selected items, else the whole page (as vector graphics and an image)',
        run: copySelection,
      },
      graph: { enabled: !!copyGraph, run: copySelectedGraph },
      page: copyPage,
      // What Copy copies (the graph selected alone, else the selected items, else the page).
      svgCode: () => {
        if (copyGraph && selScene)
          return report(
            copyFigureSvgCode(figure({ kind: 'graph', graph: copyGraph.id }), {
              what: `“${copyGraph.name}”`,
              graph: copyGraph.id,
            }),
          )
        const s = sel.length ? selectionPage() : null
        report(
          s
            ? copyFigureSvgCode(figure(s), {
                what: sel.length > 1 ? `${sel.length} items` : 'the item',
                graph: null,
              })
            : copyFigureSvgCode(figure(), { what: `the page of “${layout.name}”`, graph: null }),
        )
      },
      paste: {
        enabled: pasteable,
        label: pasteLabel,
        ...(copied?.items ? { hint: 'Place copies of the items copied last on the page' } : {}),
        run: () => paste(null, null),
      },
    }),
    ...exportCommands({
      run: (f) => void exporter.exportAs(f),
      openDialog: exporter.open,
      print: () => printView(scene, figure(), onError, layout.page),
    }),
    sourceDataCommand('page', () =>
      exportWorkbook(
        () => layoutSourceSheets({ project, result: lookup }, layout),
        `${layout.name} source data`,
      ),
    ),
    ...zoomCommands(LAYOUT_ZOOMS, zoom, setZoom),
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

  const dragging = !!drag && drag.mode !== 'resize' && drag.mode !== 'group' && drag.mode !== 'end'
  // The graph drawn with its plot handles and snap guides: the one dragged on, else the graph
  // selected alone.
  const overlayAt = gdrag ? gdrag.index : selected !== null && selGraph ? selected : null
  const overlay = graphItem(overlayAt)
  const overlayShown = overlayAt !== null ? shown.items[overlayAt] : undefined
  const overlayScene = graphOutcome?.laid.find((l) => l.index === overlayAt)?.scene
  /** The graph items holding selected parts, each with its parts' keys. */
  const enteredParts = [...new Set(elems.map((e) => e.item))].flatMap((itemId) => {
    const g = graphItem(layout.items.findIndex((it) => it.id === itemId))
    return g ? [{ g, paths: pageElementsOf(psel, itemId).map((e) => e.path) }] : []
  })
  const graphOfItem = (itemId: LayoutItemId) => {
    const it = layout.items.find((x) => x.id === itemId)
    const g = it?.type === 'graph' ? project.nodes[it.graph] : undefined
    return g?.kind === 'graph' ? g : undefined
  }
  /** What is selected, read out (and the elements' inspector heading). */
  const partsText = pageElementsText(psel, graphOfItem, titlesOf)
  const announcement = elems.length
    ? partsText
    : sel.length > 1
      ? `${sel.length} items selected`
      : selected !== null
        ? itemKindName(layout.items[selected]!)
        : 'Page'
  // Roadmap 45: the format bar — its name, what its ▾ can select (the page's items, then the
  // parts of the graph worked in), the in-place editor's toolbar docked in it.
  const [dock, setDock] = useState<HTMLElement | null>(null)
  const barElements = (): BarElement[] => {
    const out: BarElement[] = [
      { key: null, name: 'Page' },
      ...layout.items.map((it) => ({
        key: itemKey(id, it.id),
        name: it.type === 'graph' ? `Graph “${graphOfItem(it.id)?.name ?? ''}”` : itemKindName(it),
      })),
    ]
    const g = ctxAt === null ? null : graphItem(ctxAt)
    if (g)
      for (const p of elementOrder(g.graph, sceneIndex(g.scene.root).nodes.all))
        out.push({
          key: pageElementKey(id, g.item.id, p),
          name: pageElementName(g.graph, p, titlesOf(g.graph)),
        })
    return out
  }
  const partsHint =
    elems.length === 1
      ? `${partsText}: Enter or double-click to format${
          movableParts ? ', drag or arrow keys to move' : ''
        }${deletableParts ? ', Delete to remove or hide' : ''}, Escape for the graph`
      : `${partsText}: Shift-click to add or remove${
          movableParts ? `, drag or arrow keys to move ${movableParts}` : ''
        }${deletableParts ? ', Delete to remove or hide' : ''}, Escape for the graph`

  return (
    <div ref={viewRef} className="graph-view">
      <div className="graph-main">
        {/* Roadmap 43 (O11): one row of a fixed height whatever is selected, so the page never
            moves under the pointer; a hint is one line, its whole text in its tooltip. */}
        <div className="view-toolbar fixed">
          <ZoomSelect zooms={LAYOUT_ZOOMS} zoom={zoom} onChange={setZoom} />
          <ToolStrip
            tool={tool}
            onTool={setTool}
            onImage={() => void pickImage()}
            onTable={() => setTableDialog(true)}
          />
          {tool ? (
            <ToolbarHint
              text={`${DRAW_TOOLS.find((t) => t.tool === tool)?.hint} · Shift: ${
                tool === 'line' || tool === 'arrow' ? '45° steps' : 'square or circle'
              } · Escape: stop drawing`}
            />
          ) : units.length >= 2 || selectedGraphs >= 2 ? (
            // Roadmap 44 (O4): aligning several items is here only (decision 116), not repeated in
            // the inspector: Align ▾ for any items, the plot buttons for graphs.
            <span
              className="align-bar"
              role="toolbar"
              aria-label={
                selectedGraphs >= 2 ? 'Arrange the selected graphs' : 'Arrange the selected items'
              }
            >
              <span className="sep" />
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={menu?.label === 'Align'}
                title="Line up or space out the selected items"
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect()
                  setMenu({
                    x: r.left,
                    y: r.bottom,
                    entries: [
                      ...ALIGN_EDGES.map(([edge, label]) => ({
                        command: `arrange.align.${edge}`,
                        label: `Align ${label.toLowerCase()}`,
                      })),
                      '-',
                      { command: 'arrange.distribute.x', label: 'Distribute horizontally' },
                      { command: 'arrange.distribute.y', label: 'Distribute vertically' },
                    ],
                    label: 'Align',
                  })
                }}
              >
                Align ▾
              </button>
              {selectedGraphs >= 2 && (
                <>
                  <span className="sep" />
                  <button
                    type="button"
                    title="Line up the plot areas' left edges"
                    onClick={() => alignPlots('left')}
                  >
                    ⇤ Align left
                  </button>
                  <button
                    type="button"
                    title="Line up the plot areas' top edges"
                    onClick={() => alignPlots('top')}
                  >
                    ⤒ Align tops
                  </button>
                  <button
                    type="button"
                    title="One above the other: equal plot widths, categories line up"
                    onClick={() => stack('vertical')}
                  >
                    ☰ Stack
                  </button>
                  <button
                    type="button"
                    title="Side by side: equal plot heights, Y scales line up"
                    onClick={() => stack('horizontal')}
                  >
                    ▥ Side by side
                  </button>
                  <button
                    type="button"
                    title="Give the selected graphs the same plot size"
                    onClick={equalSizes}
                  >
                    ▭ Same size
                  </button>
                </>
              )}
            </span>
          ) : graphOutcome ? (
            <ToolbarHint
              text={`${graphOutcome.readout ?? 'Moving'} · ${
                gdrag?.drag.kind === 'resize'
                  ? 'Shift keeps the proportions, ⌘/Ctrl keeps the text size, '
                  : ''
              }Alt: no snapping`}
            />
          ) : elems.length ? (
            <ToolbarHint text={partsHint} />
          ) : selGraph ? (
            <ToolbarHint text="Click a part to select it; handles resize the plot; drag titles, tick labels or brackets to move them, elsewhere to move the graph." />
          ) : (
            <ToolbarHint text="Drag items to move them (they snap into line; hold Alt to stop). Drag across the page or Shift-click to select several." />
          )}
        </div>
        <FormatBar
          sel={barSel}
          legendEntries={(g) => {
            const at = layout.items.findIndex((it) => it.type === 'graph' && it.graph === g)
            return shownEntries(graphItem(at)?.scene.legend ?? [])
          }}
          name={announcement.replace(/ selected$/, '')}
          elements={barElements}
          onSelect={(key) => setPageSel(key ? single(key) : EMPTY_SELECTION)}
          {...(formatsElement
            ? { onFormat: () => formatElement() }
            : selectedGraph
              ? { onFormat: () => showFormat(graphPlace()) }
              : {})}
          editing={textEdit !== null ? 'Editing text' : null}
          onDock={setDock}
        />
        <SheetNotes node={layout} />
        <ScreenSampleNote sampled={scene.sampled} every={every} onEvery={setEvery} />
        {/* biome-ignore lint/a11y/noStaticElementInteractions: clicking the backdrop deselects; Escape does the same from the keyboard */}
        <div
          ref={canvasRef}
          className="canvas"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: focusable so Escape / Delete work
          tabIndex={0}
          onClick={(e) => e.target === e.currentTarget && setSelected(null)}
          onPointerMove={(e) => {
            pointer.current = onPage(toPt(e))
          }}
          onPointerLeave={() => {
            pointer.current = null
          }}
          onDragOver={(e) => {
            if (!carriesFiles(e.dataTransfer)) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
          }}
          data-drop="page"
          onDrop={(e) => {
            if (!carriesFiles(e.dataTransfer)) return
            e.preventDefault()
            const at = onPage(toPt(e))
            // Roadmap 39: images go on the page where dropped; other files (a CSV, a project)
            // are the window's to handle, as dropped anywhere else.
            const all = [...e.dataTransfer.files]
            const others = all.filter((f) => dropKindOf(f.name) !== 'image')
            if (others.length && dropFiles)
              dropFiles(
                others.map((f) => ({ name: f.name, blob: f, handle: null })),
                'page',
              )
            if (others.length === all.length) return
            void transferFiles(e.dataTransfer)
              .then(readFiles)
              .then((files) =>
                insertImages(
                  files.filter((f) => dropKindOf(f.name) === 'image' || !f.name),
                  at,
                ),
              )
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              if (tool || drag?.mode === 'create') {
                setTool(null)
                setDrag(null)
                // A part of a graph steps back out to its graph item (decision 871), then nothing.
              } else setPageSel(pageStepOut(psel, id))
            }
            // Enter on a selected graph: Format graph (as on the graph's own canvas); on a selected
            // part of a graph, that part's Format dialog.
            const it = selected !== null ? layout.items[selected] : undefined
            // The keys of the shortcut sheet's "On a page" (PAGE_KEYS).
            if (isViewKey(PAGE_KEYS.format, e) && primaryEl && elementFormat) {
              e.preventDefault()
              formatElement(true)
            } else if (
              isViewKey(PAGE_KEYS.format, e) &&
              it?.type === 'graph' &&
              project.nodes[it.graph]
            ) {
              e.preventDefault()
              showFormat(graphPlace(), true)
            }
            if (isViewKey(PAGE_KEYS.remove, e) && elems.length) void deleteElements()
            else if (isViewKey(PAGE_KEYS.remove, e) && sel.length) removeSelected()
            // Roadmap 47b: the selected legend entries of the graph worked in, earlier or later.
            const earlier = isViewKey(PAGE_KEYS.entryEarlier, e)
            if (
              (earlier || isViewKey(PAGE_KEYS.entryLater, e)) &&
              moveEntriesOnPage(earlier ? -1 : 1)
            ) {
              e.preventDefault()
              return
            }
            const more = isViewKey(PAGE_KEYS.nudgeMore, e)
            if (!more && !isViewKey(PAGE_KEYS.nudge, e)) return
            const step = more ? 10 : 1
            const arrows: Record<string, [number, number]> = {
              ArrowLeft: [-step, 0],
              ArrowRight: [step, 0],
              ArrowUp: [0, -step],
              ArrowDown: [0, step],
            }
            const a = arrows[e.key]
            if (a && elems.length) {
              e.preventDefault()
              nudgeElements(a[0], a[1])
            } else if (a && sel.length) {
              e.preventDefault()
              nudge(a[0], a[1])
            }
          }}
        >
          <svg
            ref={svgRef}
            className={`scene page${tool ? ' drawing' : ''}`}
            width={scene.width * k}
            height={scene.height * k}
            viewBox={`0 0 ${scene.width} ${scene.height}`}
            role="img"
            aria-label="Layout page"
            onPointerMove={onDragMove}
            onPointerUp={onDragEnd}
            onPointerCancel={() => {
              pageMoves.cancel()
              setDrag(null)
              setGdrag(null)
            }}
            onPointerDown={startMarquee}
            onContextMenu={pageMenuAt}
          >
            <rect x={0} y={0} width={scene.width} height={scene.height} fill="#ffffff" />
            <RasterScale.Provider value={k * pixelRatio()}>
              <NodeEl node={scene.root} />
            </RasterScale.Provider>
            {scene.items.map((b) => {
              const it = shown.items[b.index]
              // An object being drawn has no hit area yet; locked items let clicks through.
              if (!it || (drag?.mode === 'create' && b.index === layout.items.length)) return null
              const events = {
                ...(it.type === 'graph'
                  ? {
                      onPointerMove: (e: PointerEvent) => hoverAt(e, b.index),
                      onPointerLeave: () => hoverMark.hover(null),
                    }
                  : {}),
                onPointerDown: (e: PointerEvent) => startDrag(e, b.index, 'move'),
                ...(it.type === 'graph'
                  ? { onClick: (e: React.MouseEvent) => clickItem(e, b.index) }
                  : {}),
                onDoubleClick: (e: React.MouseEvent) => formatAt(e, b.index),
                onContextMenu: (e: React.MouseEvent) => contextMenuAt(e, b.index),
              }
              const locked = it.locked ? { pointerEvents: 'none' as const } : {}
              return (
                <g key={b.id} data-kind={b.type}>
                  <rect
                    data-testid={`layout-item-${b.index}`}
                    className="layout-hit"
                    x={b.x}
                    y={b.y}
                    width={Math.max(b.w, 4)}
                    height={Math.max(b.h, 4)}
                    fill="transparent"
                    {...(it.type === 'line' ? { pointerEvents: 'none' as const } : locked)}
                    {...(it.type === 'line' ? {} : events)}
                  >
                    {it.type === 'graph' && (
                      <title>Double-click to format; right-click for more</title>
                    )}
                  </rect>
                  {it.type === 'line' && (
                    <line
                      data-testid={`layout-line-${b.index}`}
                      className="layout-hit"
                      x1={it.from.x}
                      y1={it.from.y}
                      x2={it.to.x}
                      y2={it.to.y}
                      stroke="transparent"
                      strokeWidth={Math.max(it.stroke.width, 10 / k)}
                      pointerEvents={it.locked ? 'none' : 'stroke'}
                      {...events}
                    />
                  )}
                </g>
              )
            })}
            <SelectionOverlay
              items={shown.items}
              sel={sel}
              boxOf={boxOf}
              k={k}
              dragging={dragging}
              onGraphScale={(e) => startDrag(e, selected!, 'scale')}
              onHandle={(h, e) => startHandle(e, h)}
            />
            {/* Roadmap 44: the selected parts of graphs, haloed through their items' transforms,
                each graph worked in outlined. */}
            {!drag &&
              enteredParts.map(({ g, paths }) => {
                const at = shown.items[g.index]
                const box = boxOf(g.index)
                if (at?.type !== 'graph') return null
                const s = g.item.scale
                return (
                  <g key={g.item.id} data-testid={`page-parts-${g.index}`}>
                    {box && (
                      <rect
                        className="entered-item"
                        x={box.x - 2}
                        y={box.y - 2}
                        width={box.w + 4}
                        height={box.h + 4}
                        fill="none"
                        stroke={HALO}
                        strokeOpacity={0.5}
                        strokeWidth={1 / k}
                        strokeDasharray={`${2 / k} ${3 / k}`}
                        pointerEvents="none"
                      />
                    )}
                    <g transform={`translate(${at.x} ${at.y}) scale(${s})`}>
                      <SceneHalos
                        scene={
                          graphOutcome?.laid.find((l) => l.index === g.index)?.scene ?? g.scene
                        }
                        selected={paths}
                        k={k * s}
                      />
                    </g>
                  </g>
                )
              })}
            {overlay && overlayShown?.type === 'graph' && !drag && (
              <g
                transform={`translate(${overlayShown.x} ${overlayShown.y}) scale(${overlay.item.scale})`}
              >
                <CanvasOverlay
                  scene={overlayScene ?? overlay.scene}
                  base={overlay.scene}
                  k={k * overlay.item.scale}
                  guides={graphOutcome?.guides ?? []}
                  handles={
                    overlayAt === selected && (!gdrag?.started || gdrag.drag.kind === 'resize')
                  }
                  active={gdrag?.drag.kind === 'resize' ? gdrag.drag.handle : null}
                  onPointerDownHandle={startResize}
                />
                {graphOutcome?.insertion && (
                  <InsertionLine line={graphOutcome.insertion} k={k * overlay.item.scale} />
                )}
              </g>
            )}
            {snapped && <GuideLines guides={snapped.guides} k={k} />}
            {live && <GuideLines guides={live.guides} k={k} />}
            {marqueeBox && (
              <rect
                x={marqueeBox.x}
                y={marqueeBox.y}
                width={marqueeBox.w}
                height={marqueeBox.h}
                fill="rgba(47,124,246,0.08)"
                stroke={HALO}
                strokeWidth={1 / k}
                pointerEvents="none"
              />
            )}
            {tool && (
              <rect
                data-testid="draw-surface"
                x={0}
                y={0}
                width={scene.width}
                height={scene.height}
                fill="transparent"
                style={{ cursor: 'crosshair' }}
                onPointerDown={startCreate}
              />
            )}
          </svg>
          {textEdit !== null && (
            <EditorDock.Provider value={dock}>
              <TextItemEditor
                key={textEdit}
                layout={layout}
                theme={theme}
                index={textEdit}
                scene={scene}
                svg={svgRef.current}
                canvas={canvasRef.current}
                k={k}
                onDone={(rt, align) => {
                  setTextEdit(null)
                  canvasRef.current?.focus()
                  const path = ['items', textEdit, 'content']
                  // Text and alignment in one step.
                  const cmds: DocCommand[] = [
                    ...(rt
                      ? [{ type: 'node.set' as const, id, path: [...path, 'content'], value: rt }]
                      : []),
                    ...(align
                      ? [
                          {
                            type: 'node.set' as const,
                            id,
                            path: [...path, 'align'],
                            value: align === 'left' ? undefined : align,
                          },
                        ]
                      : []),
                  ]
                  if (cmds.length) dispatch(cmds, 'Edit text')
                }}
                onStyle={(patch) => {
                  const it = layout.items[textEdit]
                  if (it)
                    setEditedStyle(
                      store,
                      fonts,
                      itemTarget(project, layout, it, itemKey(id, it.id)).text,
                      patch,
                    )
                }}
              />
            </EditorDock.Provider>
          )}
          <Warnings warnings={scene.warnings} />
          {/* Roadmap 44: what is selected on the page, read out as it changes. */}
          <span
            className="visually-hidden"
            aria-live="polite"
            aria-atomic="true"
            data-testid="page-selection-announcement"
          >
            {announcement}
          </span>
        </div>
      </div>
      {formatHost.open && panelGraph && ctxAt !== null ? (
        <FormatPanel
          graphId={panelGraph.id}
          target={formatHost.target}
          setTarget={(t) => formatHost.setTarget(t)}
          name={
            pointsName(formatHost.target, panelGraph, panelPoints) ??
            placeName(formatHost.target, panelGraph, titlesOf(panelGraph))
          }
          scope={pageScope}
          onSelect={(path, t) => {
            // A part chosen in the panel: selected on the page, in the graph worked in.
            const at = layout.items[ctxAt]
            if (!at) return
            const key = path ? pageElementKey(id, at.id, path) : itemKey(id, at.id)
            setPageSel(single(key))
            formatHost.setTarget(t, keyId(key))
          }}
          onOpenWindow={() => formatHost.openWindow()}
          onClose={() => {
            formatHost.close()
            focusCanvas()
          }}
          onEscape={focusCanvas}
          focus={formatHost.focus}
          onNotice={onNotice}
          layerSelection={panelLayers}
          {...(selScene?.legend ? { legend: selScene.legend } : {})}
          {...(panelPoints.length > 1 ? { points: panelPoints } : {})}
        />
      ) : (
        <InspectorDock>
          <LayoutInspector
            layout={layout}
            project={project}
            theme={theme}
            graphs={graphs}
            sel={sel}
            parts={
              elems.length && primaryEl
                ? {
                    title:
                      elems.length === 1 && selGraph
                        ? elementName(selGraph, primaryEl.path, titlesOf(selGraph))
                        : partsText,
                    where: [...new Set(elems.flatMap((e) => graphOfItem(e.item)?.name ?? []))].map(
                      (n) => `“${n}”`,
                    ),
                    format: formatsElement ? `Format ${elementWhat}…` : null,
                    onFormat: () => formatElement(),
                    onBack: () => setPageSel(single(itemKey(id, primaryEl.item))),
                  }
                : null
            }
            result={lookup}
            asset={asset}
            state={{
              anyLocked,
              units: units.length,
              canGroup,
              grouped,
              columns,
              setColumns,
              stackShareY,
              setStackShareY,
              stackHideInner,
              setStackHideInner,
            }}
            act={{
              set,
              select: setSel,
              setMany: (edits, label) =>
                dispatch(
                  edits.map((e) => ({
                    type: 'node.set' as const,
                    id,
                    path: ['items', e.index, ...e.path],
                    value: e.value,
                  })),
                  label,
                ),
              zorder,
              duplicate,
              remove: removeSelected,
              align: alignItems,
              distribute,
              group,
              ungroup,
              lock,
              unlockAll,
              addGraph,
              addText,
              addImage: () => void pickImage(),
              addTable: () => setTableDialog(true),
              arrange,
              stack,
              equalSizes,
              shareY,
              matchFirst,
              gridColumns,
            }}
          />
        </InspectorDock>
      )}
      {formatHost.window && selGraph && (
        <FormatDialog
          graphId={selGraph.id}
          initial={formatHost.window}
          onClose={closeFormat}
          points={panelPoints}
        />
      )}
      {tableDialog && (
        <TableDialog
          choices={tableSourceChoices(project, lookup)}
          onPick={insertTable}
          onClose={() => setTableDialog(false)}
        />
      )}
      {card && hovered && (
        <HoverCard
          info={card}
          place={hovered.at}
          events={hoverMark.card}
          {...(onOpen && card.goTo ? { onGoTo: () => goToRow(card.goTo!) } : {})}
        />
      )}
      {menu && <CommandMenu menu={menu} onClose={() => setMenu(null)} />}
      {exporter.dialog}
    </div>
  )
}

/** A text item on the page edited in place (double-click), over its own text. */
function TextItemEditor({
  layout,
  theme,
  index,
  scene,
  svg,
  canvas,
  k,
  onDone,
  onStyle,
}: {
  layout: LayoutNode
  theme: Theme
  index: number
  scene: { items: readonly { index: number; x: number; y: number; w: number; h: number }[] }
  svg: SVGSVGElement | null
  canvas: HTMLDivElement | null
  k: number
  /** The new text (null: unchanged) and the alignment when it changed. */
  onDone: (rt: RichText | null, align?: TextAlign) => void
  /** Font, size or colour chosen with the whole text selected (roadmap 45). */
  onStyle: (patch: ElementStylePatch) => void
}) {
  const item = layout.items[index]
  const box = scene.items.find((b) => b.index === index)
  if (item?.type !== 'text' || !box || !svg || !canvas) return null
  const value = item.content.content
  const style = resolveText(theme.text, item.content.style)
  const align = item.content.align ?? 'left'
  // The page's place in the (positioned, scrolling) canvas.
  const [s, c] = [svg.getBoundingClientRect(), canvas.getBoundingClientRect()]
  const origin = { x: s.left - c.left + canvas.scrollLeft, y: s.top - c.top + canvas.scrollTop }
  return (
    <RichTextEditor
      className="inline-edit"
      label="Edit text"
      value={value}
      multiline
      once
      autoFocus
      selectAll
      style={{
        left: origin.x + box.x * k - 4,
        top: origin.y + box.y * k - 3,
        minWidth: Math.max(box.w * k + 16, 140),
        ...(item.width !== undefined ? { maxWidth: box.w * k + 16 } : {}),
        fontSize: Math.max(12, style.size * k),
      }}
      textStyle={style}
      palette={theme.palette}
      align={align}
      onCommit={(rt, a) =>
        onDone(sameRichText(rt, value) ? null : rt, a && a !== align ? a : undefined)
      }
      onStyle={onStyle}
      onCancel={() => onDone(null)}
    />
  )
}

/** A view toolbar's hint: one line that never wraps the toolbar, the whole text in its tooltip. */
function ToolbarHint({ text }: { text: string }) {
  return (
    <Tooltip content={text} className="hint-anchor">
      <span className="hint">{text}</span>
    </Tooltip>
  )
}
