import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

// Roadmap 45: the format bar's drop-downs (font, sizes, colours, line widths and styles,
// symbols): a menu of radio items at a viewport position below its button, as the app's menus
// behave — arrow keys move (a grid of swatches by row and column), Enter or Space choose, Escape
// or Tab close, a press elsewhere closes, and the focus goes back to where it was (the canvas, or
// the button that opened it).

export interface BarMenuItem {
  /** Accessible name (and the text shown unless `content` is given). */
  label: string
  content?: ReactNode
  checked?: boolean
  /** Shown as a colour swatch. */
  swatch?: string
  style?: CSSProperties
  onSelect: () => void
}

export function BarMenu({
  anchor,
  label,
  items,
  columns = 1,
  onClose,
}: {
  /** The button it hangs from. */
  anchor: HTMLElement
  label: string
  items: readonly (BarMenuItem | '-')[]
  /** Swatches per row (1: a list). */
  columns?: number
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const back = useRef<Element | null>(null)
  const r = anchor.getBoundingClientRect()
  const real = items.filter((i): i is BarMenuItem => i !== '-')
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, as it opens
  useLayoutEffect(() => {
    back.current = document.activeElement
    const buttons = ref.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]')
    const at = Math.max(
      0,
      real.findIndex((i) => i.checked),
    )
    buttons?.[at]?.focus()
    // Inside the window.
    const el = ref.current
    if (el) {
      const b = el.getBoundingClientRect()
      if (b.right > window.innerWidth - 4)
        el.style.left = `${Math.max(4, window.innerWidth - 4 - b.width)}px`
      if (b.bottom > window.innerHeight - 4)
        el.style.maxHeight = `${Math.max(120, window.innerHeight - 8 - b.top)}px`
    }
  }, [])
  const close = (refocus = true) => {
    onClose()
    if (refocus && back.current instanceof HTMLElement) back.current.focus({ preventScroll: true })
  }
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (ref.current?.contains(e.target as Node) || anchor.contains(e.target as Node)) return
      onClose()
    }
    document.addEventListener('pointerdown', down, true)
    return () => document.removeEventListener('pointerdown', down, true)
  }, [anchor, onClose])
  const onKey = (e: React.KeyboardEvent) => {
    const buttons = [
      ...(ref.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]') ?? []),
    ]
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const go = (j: number) => buttons[(j + buttons.length) % buttons.length]?.focus()
    const step = { ArrowDown: columns, ArrowUp: -columns, ArrowRight: 1, ArrowLeft: -1 }[
      e.key as 'ArrowDown'
    ]
    e.stopPropagation()
    if (step !== undefined && (columns > 1 || e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      go(i + (columns > 1 ? step : Math.sign(step)))
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      go(e.key === 'Home' ? 0 : -1)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'Tab') {
      e.preventDefault()
      close()
    }
  }
  // In the body (not inside the bar): the bar's own button styles stay off its items.
  return createPortal(
    <div
      ref={ref}
      className={`bar-menu ${columns > 1 ? 'swatch-grid' : 'list'}`}
      role="menu"
      aria-label={label}
      style={{
        left: r.left,
        top: r.bottom + 2,
        ...(columns > 1
          ? { gridTemplateColumns: `repeat(${columns}, 24px)`, width: columns * 27 + 7 }
          : {}),
      }}
      onKeyDown={onKey}
      // Presses keep the focus where it is until an item is chosen.
      onMouseDown={(e) => e.preventDefault()}
    >
      {items.map((it, i) =>
        it === '-' ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: dividers are positional
          <hr key={`-${i}`} className="bar-menu-sep" />
        ) : (
          <button
            key={it.label}
            type="button"
            role="menuitemradio"
            aria-checked={!!it.checked}
            aria-label={it.content || it.swatch ? it.label : undefined}
            title={it.swatch ? it.label : undefined}
            tabIndex={-1}
            className={it.swatch ? 'swatch' : undefined}
            style={it.swatch ? { ...it.style, background: it.swatch } : it.style}
            onClick={() => {
              close()
              it.onSelect()
            }}
          >
            {it.swatch ? null : (it.content ?? it.label)}
          </button>
        ),
      )}
    </div>,
    document.body,
  )
}
