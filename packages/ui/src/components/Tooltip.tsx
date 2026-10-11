import {
  cloneElement,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { portalHost } from './portalHost.ts'

// Roadmap 43: the app's own tooltip, in place of the native `title` on the toolbars (slow, never
// shown for the keyboard, invisible to tests). Shown after a short rest of the pointer, at once on
// keyboard focus; hidden on Escape, when the pointer leaves, on a press and on blur. It is never
// focusable and takes no pointer events, so it traps nothing.

/** How long the pointer rests on an element before its tooltip shows. */
export const TOOLTIP_DELAY_MS = 350
/** After a tooltip hides, the next one shows at once for this long (moving along a toolbar). */
const WARM_MS = 300

let warmUntil = 0

/**
 * Whether the last input was a pointer (a focus that follows a click shows no tooltip) rather
 * than the keyboard (Tab onto a button shows it at once).
 */
let pointerLast = false
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', () => (pointerLast = true), {
    capture: true,
    passive: true,
  })
  window.addEventListener('keydown', () => (pointerLast = false), { capture: true, passive: true })
}

type Shown = 'hover' | 'focus' | null

/**
 * A tooltip for one element (`children`, given `aria-describedby` while the tooltip shows).
 * The events are taken on a wrapper, so a disabled button (which gets none) still shows why it is
 * disabled. `content` null: no tooltip.
 */
export function Tooltip({
  content,
  children,
  className,
}: {
  content: ReactNode
  children: ReactElement<{ 'aria-describedby'?: string }>
  className?: string
}) {
  const [shown, setShown] = useState<Shown>(null)
  const anchor = useRef<HTMLSpanElement>(null)
  const tip = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // A press hides the tooltip until the pointer leaves (no reshowing under a clicking pointer).
  const pressed = useRef(false)
  const id = useId()
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  const clear = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }, [])
  const hide = useCallback(() => {
    clear()
    setShown((s) => {
      if (s) warmUntil = Date.now() + WARM_MS
      return null
    })
  }, [clear])
  useEffect(() => clear, [clear])

  // Escape hides it wherever the focus is (the pointer may rest on a button while typing).
  useEffect(() => {
    if (!shown) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [shown, hide])

  // Placed below the element, centred, kept inside the window (above it when there is no room).
  useLayoutEffect(() => {
    if (!shown) {
      setPos(null)
      return
    }
    const a = anchor.current?.getBoundingClientRect()
    const t = tip.current?.getBoundingClientRect()
    if (!a || !t) return
    const vw = window.innerWidth || document.documentElement.clientWidth
    const vh = window.innerHeight || document.documentElement.clientHeight
    const left = Math.max(4, Math.min(a.left + a.width / 2 - t.width / 2, vw - t.width - 4))
    const below = a.bottom + 6
    const top =
      below + t.height > vh - 4 && a.top - t.height - 6 >= 4 ? a.top - t.height - 6 : below
    setPos({ left, top })
  }, [shown])

  if (content === null || content === undefined || content === false) return children
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hears the pointer and focus of the element inside (a disabled button gets no events)
    <span
      ref={anchor}
      className={`tip-anchor${className ? ` ${className}` : ''}`}
      onPointerEnter={(e) => {
        if (e.pointerType === 'touch' || pressed.current) return
        clear()
        if (Date.now() < warmUntil) setShown((s) => s ?? 'hover')
        else timer.current = setTimeout(() => setShown((s) => s ?? 'hover'), TOOLTIP_DELAY_MS)
      }}
      onPointerLeave={() => {
        pressed.current = false
        clear()
        setShown((s) => {
          if (s !== 'hover') return s
          warmUntil = Date.now() + WARM_MS
          return null
        })
      }}
      onPointerDown={() => {
        pressed.current = true
        hide()
      }}
      onFocus={() => {
        if (pointerLast) return
        clear()
        setShown('focus')
      }}
      onBlur={hide}
    >
      {cloneElement(children, shown ? { 'aria-describedby': id } : {})}
      {shown &&
        createPortal(
          <div
            ref={tip}
            id={id}
            role="tooltip"
            className="tooltip"
            style={
              pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }
            }
          >
            {content}
          </div>,
          portalHost(anchor.current),
        )}
    </span>
  )
}

/**
 * A command's tooltip: its name and shortcut, then its hint, or why it is disabled (when known).
 */
export function CommandTip({
  name,
  shortcut,
  hint,
  disabledReason,
}: {
  name: string
  shortcut?: string | undefined
  hint?: string | undefined
  disabledReason?: string | undefined
}) {
  return (
    <>
      <span className="tooltip-head">
        <span className="tooltip-name">{name}</span>
        {shortcut && <kbd className="tooltip-key">{shortcut}</kbd>}
      </span>
      {disabledReason ? (
        <span className="tooltip-reason">{disabledReason}</span>
      ) : (
        hint && <span className="tooltip-hint">{hint}</span>
      )}
    </>
  )
}
