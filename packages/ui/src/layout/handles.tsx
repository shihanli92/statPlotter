import type { Box } from '@ps/graph'
import type { LayoutItem } from '@ps/model'
import type { PointerEvent } from 'react'
import { handleSides, RESIZE_HANDLES, type ResizeHandle } from '../graph/resize.ts'
import { HALO } from '../graph/SceneSvg.tsx'
import { unionOf } from './arrange.ts'

// Handles on page items (roadmap 32): eight on a shape's or image's box (two on a text box's
// sides, four corners on a group or several items, which scale as one), one on each end of a
// line; and the selection they belong to.

/** Handle size on screen, CSS pixels. */
const HANDLE_PX = 8

/** The handles an item offers. */
type HandleSet = 'box' | 'sides' | 'corners' | 'none'

const CORNERS: readonly ResizeHandle[] = ['nw', 'ne', 'se', 'sw']
const SIDES: readonly ResizeHandle[] = ['e', 'w']

const handlesOf = (set: HandleSet): readonly ResizeHandle[] =>
  set === 'box' ? RESIZE_HANDLES : set === 'sides' ? SIDES : set === 'corners' ? CORNERS : []

/** A handle's centre on a box. */
function handleSpot(b: Box, h: ResizeHandle): { x: number; y: number } {
  const s = handleSides(h)
  return { x: b.x + (b.w * (s.x + 1)) / 2, y: b.y + (b.h * (s.y + 1)) / 2 }
}

const CURSORS: Record<ResizeHandle, string> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
}

/** The handles on a selected item's (or group's) box, in page points at zoom `k`. */
function BoxHandles({
  box,
  set,
  k,
  title,
  onPointerDown,
}: {
  box: Box
  set: HandleSet
  k: number
  title: string
  onPointerDown: (h: ResizeHandle, e: PointerEvent) => void
}) {
  const size = HANDLE_PX / k
  return handlesOf(set).map((h) => {
    const p = handleSpot(box, h)
    return (
      // biome-ignore lint/a11y/noStaticElementInteractions: a pointer shortcut; sizes are also in the inspector
      <rect
        key={h}
        className="item-handle"
        data-handle={h}
        x={p.x - size / 2}
        y={p.y - size / 2}
        width={size}
        height={size}
        fill="#ffffff"
        stroke={HALO}
        strokeWidth={1 / k}
        style={{ cursor: CURSORS[h] }}
        onPointerDown={(e) => onPointerDown(h, e)}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <title>{title}</title>
      </rect>
    )
  })
}

/** A handle pressed: an item's box (resize), a group's corner (scale), a line's end. */
export type HandlePress = {
  mode: 'resize' | 'group' | 'end'
  index: number
  handle?: ResizeHandle
  end?: 'from' | 'to'
}

/**
 * The selection on a page: a halo per item and a dashed box round several (with corner handles
 * that scale them as one), or the dashed box of the item selected alone with its handles (a
 * graph's size corner, a box's eight, a text box's sides, a line's ends). Locked items get none;
 * none are drawn while the selection is moved.
 */
export function SelectionOverlay({
  items,
  sel,
  boxOf,
  k,
  dragging,
  onGraphScale,
  onHandle,
}: {
  items: readonly LayoutItem[]
  sel: readonly number[]
  boxOf: (index: number) => Box | undefined
  k: number
  dragging: boolean
  onGraphScale: (e: PointerEvent) => void
  onHandle: (h: HandlePress, e: PointerEvent) => void
}) {
  const dashed = (b: Box, pad: number, className: string) => (
    <rect
      className={className}
      x={b.x - pad}
      y={b.y - pad}
      width={b.w + 2 * pad}
      height={b.h + 2 * pad}
      fill="none"
      stroke={HALO}
      strokeWidth={1 / k}
      strokeDasharray={`${4 / k} ${3 / k}`}
      pointerEvents="none"
    />
  )
  if (sel.length > 1) {
    const boxes = sel.flatMap((i) => boxOf(i) ?? [])
    const union = unionOf(boxes)
    const locked = sel.some((i) => items[i]?.locked)
    return (
      <>
        {boxes.map((b, n) => (
          <rect
            // biome-ignore lint/suspicious/noArrayIndexKey: one halo per selected item
            key={n}
            x={b.x - 2}
            y={b.y - 2}
            width={b.w + 4}
            height={b.h + 4}
            fill="rgba(47,124,246,0.06)"
            stroke={HALO}
            strokeWidth={1 / k}
            pointerEvents="none"
          />
        ))}
        {union && dashed(union, 4, 'selection group-selection')}
        {union && !locked && !dragging && (
          <BoxHandles
            box={union}
            set="corners"
            k={k}
            title="Drag to resize the selected items together (Alt: no snapping)"
            onPointerDown={(h, e) => onHandle({ mode: 'group', index: sel[0]!, handle: h }, e)}
          />
        )}
      </>
    )
  }
  const index = sel[0]
  const it = index !== undefined ? items[index] : undefined
  const box = index !== undefined ? boxOf(index) : undefined
  if (!it || !box || index === undefined) return null
  const set: HandleSet = it.locked
    ? 'none'
    : it.type === 'shape' || it.type === 'image'
      ? 'box'
      : it.type === 'text'
        ? 'sides'
        : 'none'
  return (
    <>
      {dashed(box, 2, 'selection')}
      {it.type === 'graph' && !it.locked && (
        <rect
          className="layout-handle"
          x={box.x + box.w - 4 / k}
          y={box.y + box.h - 4 / k}
          width={8 / k}
          height={8 / k}
          fill={HALO}
          onPointerDown={onGraphScale}
        />
      )}
      {set !== 'none' && !dragging && (
        <BoxHandles
          box={box}
          set={set}
          k={k}
          title={
            it.type === 'text'
              ? 'Drag to set the width the text wraps at'
              : it.type === 'image' && !it.freeAspect
                ? 'Drag to resize (proportions kept; Alt frees them and stops snapping)'
                : 'Drag to resize (Shift keeps the proportions, Alt: no snapping)'
          }
          onPointerDown={(h, e) => onHandle({ mode: 'resize', index, handle: h }, e)}
        />
      )}
      {it.type === 'line' && !it.locked && !dragging && (
        <EndHandles
          from={it.from}
          to={it.to}
          k={k}
          onPointerDown={(end, e) => onHandle({ mode: 'end', index, end }, e)}
        />
      )}
    </>
  )
}

/** Handles on a line's two ends. */
export function EndHandles({
  from,
  to,
  k,
  onPointerDown,
}: {
  from: { x: number; y: number }
  to: { x: number; y: number }
  k: number
  onPointerDown: (end: 'from' | 'to', e: PointerEvent) => void
}) {
  const r = HANDLE_PX / 2 / k
  return (['from', 'to'] as const).map((end) => {
    const p = end === 'from' ? from : to
    return (
      // biome-ignore lint/a11y/noStaticElementInteractions: a pointer shortcut; the ends are also in the inspector
      <circle
        key={end}
        className="item-handle"
        data-end={end}
        cx={p.x}
        cy={p.y}
        r={r}
        fill="#ffffff"
        stroke={HALO}
        strokeWidth={1 / k}
        style={{ cursor: 'move' }}
        onPointerDown={(e) => onPointerDown(end, e)}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <title>
          {end === 'from' ? 'Start' : 'End'}: drag to move this end (Shift: 45° steps, Alt: no
          snapping)
        </title>
      </circle>
    )
  })
}
