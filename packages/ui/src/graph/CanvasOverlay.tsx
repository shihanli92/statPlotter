import type { Scene } from '@ps/graph'
import type { CSSProperties, PointerEvent } from 'react'
import type { Guide } from '../layout/snap.ts'
import { handleSides, type ResizeHandle, resizeHandles } from './resize.ts'
import { HALO } from './SceneSvg.tsx'
import type { TreeHandle } from './treeDrag.ts'

// What is drawn over a graph while arranging it on the canvas (roadmaps 22, 23): the plot's
// resize handles and snap guides, on the graph view and on graphs placed on layout pages.

/** Handle size on screen, CSS pixels. */
const HANDLE_PX = 8

const MODIFIERS = 'Shift keeps the proportions, ⌘/Ctrl keeps the text size, Alt: no snapping'

function handleTitle(h: ResizeHandle): string {
  const s = handleSides(h)
  const what =
    s.x && s.y ? 'resize the plot' : s.x ? 'change the plot width' : 'change the plot height'
  return `Drag to ${what}; text and marks scale with it (${MODIFIERS})`
}

/** Where the size readout sits: beside the handle being dragged (CSS pixels in the wrap). */
export function readoutAt(scene: Scene, handle: ResizeHandle, k: number): CSSProperties {
  const h = resizeHandles(scene, HANDLE_PX / k).find((x) => x.handle === handle)
  if (!h) return {}
  // Away from the plot: left of a left-hand handle (right-aligned), else right; below a bottom one.
  const s = handleSides(handle)
  const top = s.y === 1 ? h.y * k + 10 : h.y * k - 28
  return s.x === -1
    ? { left: h.x * k - 12, top, transform: 'translateX(-100%)' }
    : { left: h.x * k + 12, top }
}

/** The guides a drag snapped to, 1 screen pixel wide at zoom `k`, shifted by (ox, oy). */
export function GuideLines({
  guides,
  k,
  ox = 0,
  oy = 0,
}: {
  guides: readonly Guide[]
  k: number
  ox?: number
  oy?: number
}) {
  return guides.map((g, i) => (
    <line
      // biome-ignore lint/suspicious/noArrayIndexKey: transient guides
      key={i}
      className="snap-guide"
      x1={(g.axis === 'x' ? g.at : g.from) + ox}
      x2={(g.axis === 'x' ? g.at : g.to) + ox}
      y1={(g.axis === 'x' ? g.from : g.at) + oy}
      y2={(g.axis === 'x' ? g.to : g.at) + oy}
      stroke="#e0218a"
      strokeWidth={1 / k}
      pointerEvents="none"
    />
  ))
}

/**
 * Drawn over the graph (scene points): the plot's resize handles and the guides a drag snapped
 * to (computed on the graph as it was when the drag began, so shifted with any reflow since).
 */
export function CanvasOverlay({
  scene,
  base,
  k,
  guides,
  handles,
  active,
  onPointerDownHandle,
}: {
  scene: Scene
  base: Scene
  k: number
  guides: readonly Guide[]
  handles: boolean
  active: ResizeHandle | null
  onPointerDownHandle: (h: ResizeHandle, e: PointerEvent) => void
}) {
  const ox = scene.plot.x - base.plot.x
  const oy = scene.plot.y - base.plot.y
  const size = HANDLE_PX / k
  return (
    <>
      <GuideLines guides={guides} k={k} ox={ox} oy={oy} />
      {handles &&
        resizeHandles(scene, size).map((h) => (
          // biome-ignore lint/a11y/noStaticElementInteractions: a pointer shortcut; the plot size is also in Format graph
          <rect
            key={h.handle}
            className={`resize-handle resize-${h.handle}${active === h.handle ? ' active' : ''}`}
            data-handle={h.handle}
            x={h.x - size / 2}
            y={h.y - size / 2}
            width={size}
            height={size}
            rx={1 / k}
            strokeWidth={1 / k}
            onPointerDown={(e) => onPointerDownHandle(h.handle, e)}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <title>{handleTitle(h.handle)}</title>
          </rect>
        ))}
    </>
  )
}

/**
 * Roadmap 49c: a selected heat map tree's handle, on the middle of its outer edge: dragged out
 * from the map the tree gets deeper, in shallower (one undo step).
 */
export function TreeHandleRect({
  handle,
  k,
  active,
  onPointerDown,
}: {
  handle: TreeHandle
  k: number
  active: boolean
  onPointerDown: (e: PointerEvent) => void
}) {
  const size = HANDLE_PX / k
  const across = handle.side === 'left' || handle.side === 'right'
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a pointer shortcut; the size is also in the tree's Format view
    <rect
      className={`resize-handle tree-handle${active ? ' active' : ''}`}
      data-testid="tree-handle"
      data-side={handle.side}
      x={handle.x - size / 2}
      y={handle.y - size / 2}
      width={size}
      height={size}
      rx={1 / k}
      strokeWidth={1 / k}
      style={{ cursor: across ? 'ew-resize' : 'ns-resize' }}
      onPointerDown={onPointerDown}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <title>
        {`Drag to change the dendrogram’s ${across ? 'width' : 'height'} (Alt: not rounded to half a point)`}
      </title>
    </rect>
  )
}

/** Roadmap 47b: where a dragged legend entry would go, a line between entries (scene points). */
export function InsertionLine({
  line,
  k,
}: {
  line: { x1: number; y1: number; x2: number; y2: number }
  k: number
}) {
  return (
    <line
      className="legend-insertion"
      data-testid="legend-insertion"
      {...line}
      stroke={HALO}
      strokeWidth={2 / k}
      strokeLinecap="round"
      pointerEvents="none"
    />
  )
}
