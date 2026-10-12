import {
  boxInRoot,
  cloudPointIndex,
  cloudPointNode,
  hasHoverCard,
  type MarkInfo,
  markSeries,
  type SceneNode,
  type StylePath,
} from '@ps/graph'
import { type CSSProperties, Fragment, useEffect, useRef, useState } from 'react'

// Hover cards (roadmap 34d, decision 386): hovering a data mark of a graph — on its canvas, on a
// layout page, in the Format preview — shows its whole row or the statistics it draws
// (`markInfo`), beside the mark, over the graph (no layout shift), at any zoom. A single point
// selected (a click, or ] and [ from the keyboard) keeps its card open, so its "Go to row" button
// can be reached with Tab.

/** How long a card stays after the pointer leaves its mark (time to reach its button). */
const LINGER_MS = 300

/**
 * How long the pointer rests on a mark before its card shows (roadmap 44, O20): passing over
 * marks on the way to another, or clicking through them, shows none. Moving from one mark to
 * another while a card shows switches it at once.
 */
export const HOVER_DELAY_MS = 300

/** A mark hovered, its card kept while the pointer moves onto the card. */
export function useHoverMark() {
  const [node, setNode] = useState<SceneNode | null>(null)
  const shown = useRef<SceneNode | null>(null)
  shown.current = node
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const onCard = useRef(false)
  useEffect(() => () => clearTimeout(timer.current), [])
  const show = (n: SceneNode | null) =>
    setNode((prev) => (n && prev?.id === n.id && prev.point === n.point ? prev : n))
  /** The mark under the pointer (null: none). */
  const hover = (n: SceneNode | null) => {
    clearTimeout(timer.current)
    if (n && hasHoverCard(n)) {
      if (shown.current) show(n)
      else timer.current = setTimeout(() => show(n), HOVER_DELAY_MS)
      return
    }
    timer.current = setTimeout(() => {
      if (!onCard.current) setNode(null)
    }, LINGER_MS)
  }
  return {
    node,
    hover,
    clear: () => {
      clearTimeout(timer.current)
      setNode(null)
    },
    card: {
      onPointerEnter: () => {
        onCard.current = true
        clearTimeout(timer.current)
      },
      onPointerLeave: () => {
        onCard.current = false
        hover(null)
      },
    },
  }
}

const MODIFIERS = new Set(['Shift', 'Alt', 'Meta', 'Control'])

/**
 * Whether Shift, Alt, ⌘ or Ctrl is held (roadmap 44, O20): hover cards hide meanwhile, so they
 * don't cover the marks being Shift-clicked.
 */
export function useModifierHeld(): boolean {
  const [held, setHeld] = useState(false)
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (MODIFIERS.has(e.key)) setHeld(e.type === 'keydown')
      else setHeld(e.shiftKey || e.altKey || e.metaKey || e.ctrlKey)
    }
    const off = () => setHeld(false)
    window.addEventListener('keydown', on)
    window.addEventListener('keyup', on)
    window.addEventListener('blur', off)
    return () => {
      window.removeEventListener('keydown', on)
      window.removeEventListener('keyup', on)
      window.removeEventListener('blur', off)
    }
  }, [])
  return held
}

/** The scene node of a selected single point (`['pointOverrides', key, point]`), if drawn. */
export function selectedPoint(root: SceneNode, selected: StylePath | null): SceneNode | null {
  if (selected?.[0] !== 'pointOverrides') return null
  const [, key, point] = selected
  let out: SceneNode | null = null
  const walk = (n: SceneNode) => {
    if (out) return
    if (n.prim?.type === 'points') {
      // A point of a cloud (roadmap 34e).
      if (markSeries(n)?.key !== key) return
      const i = cloudPointIndex(n.prim, String(point))
      if (i >= 0) out = cloudPointNode(n, i)
    } else if (n.prim && n.point === point && markSeries(n)?.key === key) out = n
    else for (const c of n.children ?? []) walk(c)
  }
  walk(root)
  return out
}

/** The single points of a scene with a data set, in drawing order (for ] and [). */
export function scenePoints(root: SceneNode): SceneNode[] {
  const out: SceneNode[] = []
  const seen = new Set<string>()
  const walk = (n: SceneNode) => {
    if (n.prim?.type === 'points' && n.target?.[0] === 'layers') {
      // A cloud's points (roadmap 34e), each as a node of its own.
      for (let i = 0; i < n.prim.n; i++) {
        const p = cloudPointNode(n, i)
        const k = `${markSeries(n)?.key}\u0000${p.point}`
        if (!seen.has(k)) {
          seen.add(k)
          out.push(p)
        }
      }
      return
    }
    const m = n.prim && n.point !== undefined ? markSeries(n) : null
    if (m && n.target?.[0] === 'layers') {
      const k = `${m.key}\u0000${n.point}`
      if (!seen.has(k)) {
        seen.add(k)
        out.push(n)
      }
    }
    for (const c of n.children ?? []) walk(c)
  }
  walk(root)
  return out
}

/**
 * Where a card goes beside a node of a scene drawn at `k` CSS pixels per point: right of the mark,
 * or left of it in the right half of the scene; null when the node isn't in the scene.
 */
export function cardPlace(
  root: SceneNode,
  width: number,
  node: SceneNode,
  k: number,
): CSSProperties | null {
  const b = boxInRoot(root, node)
  if (!b) return null
  const gap = 8
  const top = Math.max(0, b.y * k - 4)
  return b.x + b.w / 2 > width / 2
    ? { right: (width - b.x) * k + gap, top }
    : { left: (b.x + b.w) * k + gap, top }
}

/** A hover card: the mark's heading and lines, and Go to row when it has a row to go to. */
export function HoverCard({
  info,
  place,
  onGoTo,
  pinned = false,
  events,
}: {
  info: MarkInfo
  place: CSSProperties
  onGoTo?: () => void
  /** Kept open for a selected point (announced to screen readers). */
  pinned?: boolean
  events?: { onPointerEnter: () => void; onPointerLeave: () => void }
}) {
  return (
    <div
      className="hover-card"
      data-testid="hover-card"
      role={pinned ? 'status' : 'tooltip'}
      style={place}
      {...events}
    >
      <div className="hover-card-title">{info.title}</div>
      {info.lines.length > 0 && (
        <dl>
          {info.lines.map((l, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: lines are fixed for a card
            <Fragment key={i}>
              <dt>{l.label}</dt>
              <dd>{l.value}</dd>
            </Fragment>
          ))}
        </dl>
      )}
      {onGoTo && info.goTo && (
        <button type="button" className="link" onClick={onGoTo}>
          Go to row
        </button>
      )}
    </div>
  )
}
