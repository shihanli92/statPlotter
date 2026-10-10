import {
  type Box,
  graphScale,
  graphText,
  isHorizontal,
  primBounds,
  type Scene,
  type SceneNode,
  type StylePath,
  type Theme,
  unionBoxes,
} from '@ps/graph'
import {
  type Annotation,
  type GraphNode,
  labelRuns,
  type Offset,
  type RichText,
  type TextAlign,
  type TextStyle,
} from '@ps/model'
import { sceneIndex } from '../selection/sceneKeys.ts'

/** An axis of the graph by its key: X, the left Y axis, or the right Y axis (`axes.y2`). */
export type AxisKey = 'x' | 'y' | 'y2'

/**
 * What a pointer-down on the graph can drag: the legend, a text box or line, and (roadmap 22) the
 * graph title, an axis title, an axis' tick labels as a group (across the axis only), a
 * significance bracket (up and down) and a point's label.
 */
export type DragTarget =
  | { kind: 'legend' }
  | { kind: 'annotation'; index: number }
  | { kind: 'title' }
  | { kind: 'axisTitle'; axis: AxisKey }
  | { kind: 'tickLabels'; axis: AxisKey }
  | { kind: 'bracket'; index: number }
  | { kind: 'pointLabel'; dataSet: string; point: string }
  /** One end of a line annotation (its handle, roadmap 32). */
  | { kind: 'lineEnd'; index: number; end: 'from' | 'to' }

const isAxis = (v: unknown): v is AxisKey => v === 'x' || v === 'y' || v === 'y2'

/** What a press on a node of the graph drags, if anything: any part of the legend drags it whole. */
export function dragTargetAt(
  hit: { node: SceneNode; target: StylePath | undefined },
  graph: GraphNode,
): DragTarget | null {
  const onLegend = hit.node.id === 'legend' || hit.node.id.startsWith('legend/')
  return onLegend && graph.legend.show ? { kind: 'legend' } : dragTargetOf(hit.target, graph)
}

/**
 * What dragging an element with this style target (or selection key) moves, if anything. Point
 * labels are scene nodes targeting `['pointLabel', seriesKey, pointKey]` (a data set key, or an
 * extra series' id for analysis output such as a volcano plot).
 */
export function dragTargetOf(
  target: StylePath | undefined | null,
  graph: GraphNode,
): DragTarget | null {
  if (!target?.length) return null
  const [head, second, third] = target
  // (Roadmap 47b: a legend entry moves within the legend, not on the graph.)
  if (head === 'legend' && second === 'entries') return null
  if (head === 'legend' && graph.legend.show) return { kind: 'legend' }
  if (head === 'title' && target.length === 1 && graph.title) return { kind: 'title' }
  if (head === 'axes' && isAxis(second) && graph.axes[second]) {
    if (third === 'title' && graph.axes[second]!.title) return { kind: 'axisTitle', axis: second }
    if (third === 'tickLabels') return { kind: 'tickLabels', axis: second }
    return null
  }
  if (head === 'annotations') {
    const index = Number(second)
    const a = graph.annotations[index]
    if (a && (a.type === 'text' || a.type === 'line')) return { kind: 'annotation', index }
    if (a?.type === 'bracket') return { kind: 'bracket', index }
  }
  if (head === 'pointLabel' && second !== undefined && third !== undefined)
    return { kind: 'pointLabel', dataSet: String(second), point: String(third) }
  return null
}

/** The selection (style path) of a dragged element, selected once the drag ends. */
export function selectionOf(t: DragTarget): StylePath {
  switch (t.kind) {
    case 'legend':
      return ['legend']
    case 'annotation':
    case 'bracket':
    case 'lineEnd':
      return ['annotations', t.index]
    case 'title':
      return ['title']
    case 'axisTitle':
      return ['axes', t.axis, 'title']
    case 'tickLabels':
      return ['axes', t.axis, 'tickLabels']
    // A point label selects its point (whose format holds the label).
    case 'pointLabel':
      return ['pointOverrides', t.dataSet, t.point]
  }
}

/**
 * What arrow keys nudge for a selection: the selected element, or a selected point's label.
 * (Whether the label is drawn is for the caller to check, e.g. with `elementBox`.)
 */
export function selectedDragTarget(
  selected: StylePath | null,
  graph: GraphNode,
): DragTarget | null {
  if (selected?.[0] === 'pointOverrides' && selected.length === 3)
    return { kind: 'pointLabel', dataSet: String(selected[1]), point: String(selected[2]) }
  return dragTargetOf(selected, graph)
}

/**
 * The tick-label group of an axis, selected by clicking its labels once the axis is selected
 * (as a single point once its data set is): otherwise what the click selects anyway.
 */
export function tickLabelSelection(
  key: StylePath | null,
  target: StylePath | undefined,
  selected: StylePath | null,
): StylePath | null {
  if (target?.[0] !== 'axes' || target[2] !== 'tickLabels') return key
  const within = selected?.[0] === 'axes' && selected[1] === target[1] && selected.length <= 3
  return within && (selected.length === 2 || selected[2] === 'tickLabels')
    ? target.slice(0, 3)
    : key
}

/**
 * How far an arrow key nudges the selected element: 1 pt, 10 pt with Shift (null: not an arrow).
 * The canvas handles these keys itself (audit 3, A3: `CANVAS_KEYS.nudge`, `nudgeMore`).
 */
export function nudgeBy(e: { key: string; shiftKey: boolean }): [number, number] | null {
  const step = e.shiftKey ? 10 : 1
  switch (e.key) {
    case 'ArrowLeft':
      return [-step, 0]
    case 'ArrowRight':
      return [step, 0]
    case 'ArrowUp':
      return [0, -step]
    case 'ArrowDown':
      return [0, step]
    default:
      return null
  }
}

/**
 * Along which scene axes an element moves: tick labels across their axis, brackets up and down
 * (left and right on horizontal graphs, whose X axis runs down the left and Y axis along the
 * bottom — or, the right one, the top).
 */
export function moveAxes(
  t: DragTarget,
  graph?: Parameters<typeof isHorizontal>[0],
): { x: boolean; y: boolean } {
  const across = !!graph && isHorizontal(graph)
  if (t.kind === 'tickLabels')
    return (t.axis === 'x') !== across ? { x: false, y: true } : { x: true, y: false }
  if (t.kind === 'bracket') return across ? { x: true, y: false } : { x: false, y: true }
  return { x: true, y: true }
}

/**
 * A tick-label group's move away from its axis line for a scene move (dx, dy): down for the X
 * axis, left for the Y axis, right for the right Y axis; on horizontal graphs left for X, down
 * for Y and up for the right Y axis (along the top).
 */
const acrossAxis = (axis: AxisKey, dx: number, dy: number, horizontal = false) =>
  horizontal
    ? axis === 'x'
      ? -dx
      : axis === 'y'
        ? dy
        : -dy
    : axis === 'x'
      ? dy
      : axis === 'y'
        ? -dx
        : dx

/** Offsets are stored to 0.01 pt; a zero offset is no offset. */
const tidy = (v: number, limit: number) => {
  const r = Math.round(Math.max(-limit, Math.min(limit, v)) * 100) / 100
  return r === 0 ? 0 : r
}
function addOffset(o: Offset | undefined, dx: number, dy: number): Offset | undefined {
  const next = { dx: tidy((o?.dx ?? 0) + dx, 2000), dy: tidy((o?.dy ?? 0) + dy, 2000) }
  return next.dx || next.dy ? next : undefined
}

/** Bounds of a subtree (its own bbox, or the union of its descendants'). */
export function nodeBox(n: SceneNode): Box | null {
  if (n.bbox) return n.bbox
  const boxes = (n.children ?? []).map(nodeBox).filter((b): b is Box => !!b)
  const p = n.prim
  if (p?.type === 'text') boxes.push(textBox(p))
  return unionBoxes(boxes)
}

/** Bounds of a text primitive, rotated when it is (e.g. a vertical Y axis title). */
export function textBox(p: Extract<SceneNode['prim'], { type: 'text' }>): Box {
  const b = {
    x: p.x,
    y: p.y - p.layout.ascent,
    w: p.layout.width,
    h: p.layout.ascent + p.layout.descent,
  }
  if (!p.rotate) return b
  const r = (p.rotate.angle * Math.PI) / 180
  const pts = [
    [b.x, b.y],
    [b.x + b.w, b.y],
    [b.x, b.y + b.h],
    [b.x + b.w, b.y + b.h],
  ].map(([x, y]) => {
    const dx = x! - p.rotate!.cx
    const dy = y! - p.rotate!.cy
    return [
      p.rotate!.cx + dx * Math.cos(r) - dy * Math.sin(r),
      p.rotate!.cy + dx * Math.sin(r) + dy * Math.cos(r),
    ]
  })
  const xs = pts.map((q) => q[0]!)
  const ys = pts.map((q) => q[1]!)
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  }
}

export function findNode(root: SceneNode, pred: (n: SceneNode) => boolean): SceneNode | null {
  if (pred(root)) return root
  for (const c of root.children ?? []) {
    const hit = findNode(c, pred)
    if (hit) return hit
  }
  return null
}

const sameTarget = (a: StylePath | undefined, b: StylePath) =>
  !!a && a.length === b.length && a.every((v, i) => v === b[i])

/** Moves a point by (dx, dy) scene points, in the annotation's own coordinate space. */
function movePoint(
  scene: Scene,
  space: 'plot' | 'data',
  p: { x: number; y: number },
  dx: number,
  dy: number,
): { x: number; y: number } | null {
  if (space === 'plot') return { x: p.x + dx / scene.plot.w, y: p.y + dy / scene.plot.h }
  const ax = scene.axes?.x
  const ay = scene.axes?.y
  if (!ax || !ay) return null
  return { x: ax.fromPx(ax.toPx(p.x) + dx), y: ay.fromPx(ay.toPx(p.y) + dy) }
}

/** Where an end of a line annotation is in the scene (null if it can't be placed). */
export function lineEndPoint(
  scene: Scene,
  a: Extract<Annotation, { type: 'line' }>,
  end: 'from' | 'to',
): { x: number; y: number } | null {
  const p = a[end]
  if (a.space === 'plot')
    return { x: scene.plot.x + p.x * scene.plot.w, y: scene.plot.y + p.y * scene.plot.h }
  const ax = scene.axes
  if (!ax) return null
  const q = { x: ax.x.toPx(p.x), y: ax.y.toPx(p.y) }
  return Number.isFinite(q.x) && Number.isFinite(q.y) ? q : null
}

/**
 * The graph with a drag applied (for the live preview and for the committed edit). Dragging a
 * legend that isn't inside the plot moves it inside, starting where it was drawn. (dx, dy) are
 * scene points; offsets are stored in the graph's own points, before its scale (roadmap 23), so
 * they scale with it.
 */
export function applyDrag(
  graph: GraphNode,
  scene: Scene,
  t: DragTarget,
  sceneDx: number,
  sceneDy: number,
): GraphNode {
  const k = graphScale(graph)
  const dx = sceneDx / k
  const dy = sceneDy / k
  switch (t.kind) {
    case 'title':
      return { ...graph, titleOffset: addOffset(graph.titleOffset, dx, dy) }
    case 'axisTitle':
    case 'tickLabels': {
      const spec = graph.axes[t.axis]
      if (!spec) return graph
      const next =
        t.kind === 'axisTitle'
          ? { ...spec, titleOffset: addOffset(spec.titleOffset, dx, dy) }
          : {
              ...spec,
              tickLabelOffset:
                tidy(
                  (spec.tickLabelOffset ?? 0) + acrossAxis(t.axis, dx, dy, isHorizontal(graph)),
                  200,
                ) || undefined,
            }
      return { ...graph, axes: { ...graph.axes, [t.axis]: next } }
    }
    case 'bracket': {
      const a = graph.annotations[t.index]
      if (a?.type !== 'bracket') return graph
      // Down (towards the data) is positive; on horizontal graphs the data are to the left.
      const by = isHorizontal(graph) ? -dx : dy
      const moved = { ...a, offset: tidy((a.offset ?? 0) + by, 2000) || undefined }
      return { ...graph, annotations: graph.annotations.map((x, i) => (i === t.index ? moved : x)) }
    }
    case 'pointLabel': {
      const at = pointLabelAt(scene, t.dataSet, t.point)
      if (!at) return graph
      const ref = labelRef(at.label)
      const labelOffset = {
        dx: tidy((ref.x + sceneDx - at.point.x) / k, 2000),
        dy: tidy((ref.y + sceneDy - at.point.y) / k, 2000),
      }
      const own = graph.pointOverrides?.[t.dataSet] ?? {}
      return {
        ...graph,
        pointOverrides: {
          ...graph.pointOverrides,
          [t.dataSet]: { ...own, [t.point]: { ...own[t.point], labelOffset } },
        },
      }
    }
  }
  if (t.kind === 'lineEnd') {
    const a = graph.annotations[t.index]
    if (a?.type !== 'line') return graph
    const p = movePoint(scene, a.space, a[t.end], sceneDx, sceneDy)
    if (!p) return graph
    const moved = { ...a, [t.end]: p }
    return { ...graph, annotations: graph.annotations.map((x, i) => (i === t.index ? moved : x)) }
  }
  if (t.kind === 'legend') {
    let start = graph.legend.inside
    if (graph.legend.position !== 'inside' || !start) {
      const legend = findNode(scene.root, (n) => sameTarget(n.target, ['legend']) && !!nodeBox(n))
      const b = legend ? nodeBox(legend) : null
      start = b
        ? { x: (b.x - scene.plot.x) / scene.plot.w, y: (b.y - scene.plot.y) / scene.plot.h }
        : { x: 0.65, y: 0.05 }
    }
    return {
      ...graph,
      legend: {
        ...graph.legend,
        position: 'inside',
        inside: { x: start.x + sceneDx / scene.plot.w, y: start.y + sceneDy / scene.plot.h },
      },
    }
  }
  const a = graph.annotations[t.index]
  if (!a) return graph
  let moved: Annotation | null = null
  if (a.type === 'text') {
    const p = movePoint(scene, a.anchor.space, a.anchor, sceneDx, sceneDy)
    if (p) moved = { ...a, anchor: { ...a.anchor, ...p } }
  } else if (a.type === 'line') {
    const from = movePoint(scene, a.space, a.from, sceneDx, sceneDy)
    const to = movePoint(scene, a.space, a.to, sceneDx, sceneDy)
    if (from && to) moved = { ...a, from, to }
  }
  if (!moved) return graph
  return { ...graph, annotations: graph.annotations.map((x, i) => (i === t.index ? moved! : x)) }
}

/**
 * Where a point's label is measured from for `PointStyle.labelOffset`: the centre of the label's
 * bounds (the offset is the label box centre minus the point's centre).
 */
const labelRef = (label: Box) => ({ x: label.x + label.w / 2, y: label.y + label.h / 2 })

/**
 * A point label in the scene and the point it labels. The label is the node targeting
 * `['pointLabel', seriesKey, pointKey]` with bounds (id `pointLabel/<seriesKey>/<pointKey>`; its
 * leader line, `…/leader`, shares the target). The point's centre is the label's centre minus the
 * node's `labelOffset` when the layout gives one; otherwise the series' mark for that point key
 * (`target ['seriesOverrides', seriesKey, …]`, `point` = the key): a symbol's centre, else the
 * centre of the mark's bounds.
 */
export function pointLabelAt(
  scene: Scene,
  dataSet: string,
  point: string,
): { label: Box; point: { x: number; y: number } } | null {
  const labelNode = findNode(
    scene.root,
    (n) =>
      sameTarget(n.target, ['pointLabel', dataSet, point]) &&
      !n.id.endsWith('/leader') &&
      !!nodeBox(n),
  )
  const label = labelNode ? nodeBox(labelNode) : null
  if (!labelNode || !label) return null
  // Relative to the label (a translated scene keeps it valid).
  const rel = labelNode.labelOffset
  if (rel) {
    const c = labelRef(label)
    return { label, point: { x: c.x - rel.dx, y: c.y - rel.dy } }
  }
  // The point's symbol if it has one, else its first mark (a bar, a box).
  let symbol: SceneNode | null = null
  let first: SceneNode | null = null
  const walk = (n: SceneNode, inherited?: StylePath) => {
    const target = n.target ?? inherited
    if (n.prim && n.point === point && target?.[0] === 'seriesOverrides' && target[1] === dataSet) {
      if (n.prim.type === 'symbol') symbol ??= n
      first ??= n
    }
    for (const c of n.children ?? []) walk(c, target)
  }
  walk(scene.root)
  const m = (symbol ?? first) as SceneNode | null
  if (!m?.prim) return null
  if (m.prim.type === 'symbol') return { label, point: { x: m.prim.cx, y: m.prim.cy } }
  const b = m.bbox ?? primBounds(m.prim)
  return b ? { label, point: { x: b.x + b.w / 2, y: b.y + b.h / 2 } } : null
}

/** The document edit that commits a drag: what changed in the dragged graph, and its undo label. */
export function commitOf(
  next: GraphNode,
  t: DragTarget,
): { path: StylePath; value: unknown; label: string } {
  switch (t.kind) {
    case 'legend':
      return { path: ['legend'], value: next.legend, label: 'Move legend' }
    case 'annotation':
      return {
        path: ['annotations', t.index],
        value: next.annotations[t.index],
        label: 'Move annotation',
      }
    case 'lineEnd':
      return {
        path: ['annotations', t.index],
        value: next.annotations[t.index],
        label: 'Move line end',
      }
    case 'bracket': {
      const a = next.annotations[t.index]
      return {
        path: ['annotations', t.index, 'offset'],
        value: a?.type === 'bracket' ? a.offset : undefined,
        label: 'Move bracket',
      }
    }
    case 'title':
      return { path: ['titleOffset'], value: next.titleOffset, label: 'Move graph title' }
    case 'axisTitle':
      return {
        path: ['axes', t.axis, 'titleOffset'],
        value: next.axes[t.axis]?.titleOffset,
        label: 'Move axis title',
      }
    case 'tickLabels':
      return {
        path: ['axes', t.axis, 'tickLabelOffset'],
        value: next.axes[t.axis]?.tickLabelOffset,
        label: 'Move tick labels',
      }
    case 'pointLabel':
      return {
        path: ['pointOverrides', t.dataSet, t.point, 'labelOffset'],
        value: next.pointOverrides?.[t.dataSet]?.[t.point]?.labelOffset,
        label: 'Move point label',
      }
  }
}

/**
 * The offsets Reset position clears for a selection: an element's own (graph title, axis title,
 * tick labels, bracket, a point's label), or an axis' title and tick labels together. Empty when
 * nothing selected has been moved.
 */
export function resetPositionOf(graph: GraphNode, selected: StylePath | null): StylePath[] {
  if (!selected?.length) return []
  const [head, second, third] = selected
  if (head === 'axes' && isAxis(second) && selected.length === 2) {
    const spec = graph.axes[second]
    const out: StylePath[] = []
    if (spec?.titleOffset) out.push(['axes', second, 'titleOffset'])
    if (spec?.tickLabelOffset) out.push(['axes', second, 'tickLabelOffset'])
    return out
  }
  // A selected point: its label's offset.
  if (head === 'pointOverrides' && second !== undefined && third !== undefined)
    return graph.pointOverrides?.[String(second)]?.[String(third)]?.labelOffset
      ? [['pointOverrides', second, third, 'labelOffset']]
      : []
  const t = dragTargetOf(selected, graph)
  if (!t || t.kind === 'legend' || t.kind === 'annotation') return []
  const c = commitOf(graph, t)
  return c.value === undefined ? [] : [c.path]
}

/**
 * A piece of text the user can double-click to edit in place, and where its value lives: titles
 * and text boxes (multi-line), or (roadmap 47b) a legend entry's legend-only label
 * (`legend.labels`; its data set's name stays).
 */
export type TextEdit =
  | { kind: 'graph'; path: StylePath; value: RichText; box: Box; label: string }
  | { kind: 'legendLabel'; key: string; value: RichText; box: Box }

export function textEditAt(
  graph: GraphNode,
  scene: Scene,
  target: StylePath | undefined,
): TextEdit | null {
  if (!target?.length) return null
  const nodeFor = (t: StylePath) =>
    findNode(scene.root, (n) => sameTarget(n.target, t) && (n.prim?.type === 'text' || !!n.bbox))
  const boxFor = (t: StylePath) => {
    const n = nodeFor(t)
    return n ? nodeBox(n) : null
  }
  if (target[0] === 'title' && graph.title) {
    const box = boxFor(['title'])
    return (
      box && {
        kind: 'graph',
        path: ['title', 'content'],
        value: graph.title.content,
        box,
        label: 'Graph title',
      }
    )
  }
  if (target[0] === 'axes' && target[2] === 'title') {
    const w = target[1] as AxisKey
    const t = graph.axes[w]?.title
    const box = boxFor(['axes', w, 'title'])
    return t && box
      ? {
          kind: 'graph',
          path: ['axes', w, 'title', 'content'],
          value: t.content,
          box,
          label: 'Axis title',
        }
      : null
  }
  if (target[0] === 'annotations') {
    const index = Number(target[1])
    const a = graph.annotations[index]
    if (a?.type !== 'text') return null
    const box = boxFor(['annotations', index])
    return (
      box && {
        kind: 'graph',
        path: ['annotations', index, 'content', 'content'],
        value: a.content.content,
        box,
        label: 'Text',
      }
    )
  }
  return null
}

/**
 * The effective style of the text an in-place edit opens, for the editor's toolbar (a data set's
 * title is edited as its legend entry), and a text box's alignment.
 */
export function editTextStyle(
  graph: GraphNode,
  theme: Theme,
  e: TextEdit,
): { style: TextStyle; align?: TextAlign } {
  if (e.kind === 'legendLabel') return { style: graphText(theme.legend, graph, graph.legend.text) }
  const [first, second] = e.path
  if (first === 'title') return { style: graphText(theme.graphTitle, graph, graph.title?.style) }
  if (first === 'axes')
    return {
      style: graphText(theme.axisTitle, graph, graph.axes[second as AxisKey]?.title?.style),
    }
  const a = graph.annotations[Number(second)]
  const spec = a?.type === 'text' ? a.content : undefined
  return { style: graphText(theme.text, graph, spec?.style), align: spec?.align ?? 'left' }
}

/**
 * A legend entry's label under a node (roadmap 47b: a double-click edits its legend-only label):
 * the entry's key, its label's box and the label it shows (its legend label, else its own).
 */
export function legendLabelAt(
  scene: Scene,
  graph: GraphNode,
  id: string,
): { key: string; box: Box; value: RichText } | null {
  const { nodes } = sceneIndex(scene.root)
  const entry = nodes.entryOf.get(id)
  if (!entry || !id.endsWith('/label')) return null
  const n = nodes.map.get(id)
  const box = n ? nodeBox(n) : null
  const own = scene.legend?.find((e) => e.key === entry.key)?.label
  const value = graph.legend.labels?.[entry.key] ?? (own === undefined ? [] : labelRuns(own))
  return box ? { key: entry.key, box, value } : null
}
