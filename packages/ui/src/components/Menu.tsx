import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * Where the pointer last was (page coordinates), so a menu opening under a resting pointer can
 * tell the browser's movement-less pointer events (sent when content appears under it) from the
 * pointer really moving.
 */
let lastPointer: { x: number; y: number } | null = null
if (typeof window !== 'undefined') {
  const track = (e: PointerEvent) => {
    lastPointer = { x: e.clientX, y: e.clientY }
  }
  window.addEventListener('pointermove', track, { capture: true, passive: true })
  window.addEventListener('pointerdown', track, { capture: true, passive: true })
}

export interface MenuItem {
  label: string
  /** Runs the item; may be absent on an item that only opens its `submenu`. */
  onSelect?: () => void
  disabled?: boolean
  danger?: boolean
  /** Draw a divider above this item. */
  separator?: boolean
  /** Shortcut hint shown at the right, already formatted ('⇧⌘S'). */
  shortcut?: string
  /** A toggle: a tick when true (an item with `checked` set is a menuitemcheckbox). */
  checked?: boolean
  /** Items of a submenu this item opens (▸). */
  submenu?: readonly MenuItem[]
  /** Tooltip. */
  title?: string
}

/** Why a menu closed: an item was chosen, Escape, a click elsewhere, or Tab. */
export type MenuCloseReason = 'select' | 'escape' | 'outside' | 'tab'

/** Where the keyboard focus goes when a menu opens: an item, or the menu itself (mouse). */
type InitialFocus = 'first' | 'last' | 'menu'

interface MenuProps {
  x: number
  y: number
  items: readonly MenuItem[]
  label: string
  onClose: (reason?: MenuCloseReason) => void
  /**
   * ← / → that the menu doesn't use itself (→ on an item without a submenu, ← in the top
   * level): the menu bar moves to the neighbouring menu.
   */
  onArrowOut?: (dir: -1 | 1) => void
  /** Pointer presses inside this element don't close the menu (the menu bar's buttons). */
  insideRef?: RefObject<HTMLElement | null>
  /** Put the focus back where it was on closing (default); the menu bar does that itself. */
  restoreFocus?: boolean
  /** Default 'first'. */
  initialFocus?: InitialFocus
  /**
   * Hangs below something that must stay visible (a menu bar item): a menu too tall for the
   * window scrolls instead of moving up over it.
   */
  anchored?: boolean
}

/**
 * A pop-up menu (context menu, toolbar drop-down, menu of the menu bar) at a viewport position.
 * Arrow keys move, → / ← open and leave submenus, Enter / Space choose, Escape / Tab / a click
 * elsewhere close; focus returns to where it was.
 */
export function Menu({
  x,
  y,
  items,
  label,
  onClose,
  onArrowOut,
  insideRef,
  restoreFocus = true,
  initialFocus = 'first',
  anchored,
}: MenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  const restore = useRef(restoreFocus)
  restore.current = restoreFocus

  // Where the focus was before the menu opened (read while rendering: the panel's own effect,
  // which runs first, moves the focus into the menu).
  const [before] = useState(() => document.activeElement as HTMLElement | null)

  useEffect(() => {
    const el = ref.current
    const away = (e: PointerEvent) => {
      const t = e.target as Node
      if (!ref.current?.contains(t) && !insideRef?.current?.contains(t)) close.current('outside')
    }
    window.addEventListener('pointerdown', away, true)
    return () => {
      window.removeEventListener('pointerdown', away, true)
      if (!restore.current) return
      // Unless the chosen item moved focus on purpose (e.g. to the graph), put it back.
      const now = document.activeElement
      if (!now || now === document.body || el?.contains(now)) before?.focus({ preventScroll: true })
    }
  }, [insideRef, before])

  return (
    <MenuPanel
      panelRef={ref}
      x={x}
      y={y}
      items={items}
      label={label}
      initialFocus={initialFocus}
      anchored={anchored}
      onClose={onClose}
      onArrowOut={onArrowOut}
    />
  )
}

/** Enabled items of a menu panel, not those of its submenus. */
function ownItems(panel: HTMLElement | null): HTMLButtonElement[] {
  if (!panel) return []
  return [
    ...panel.querySelectorAll<HTMLButtonElement>(
      ':scope > button[role^="menuitem"]:not(:disabled), :scope > [role="none"] > button[role^="menuitem"]:not(:disabled)',
    ),
  ]
}

function MenuPanel({
  panelRef,
  x,
  y,
  altX,
  items,
  label,
  initialFocus,
  onClose,
  onArrowOut,
  onBack,
  anchored,
}: {
  panelRef?: RefObject<HTMLDivElement | null>
  anchored?: boolean
  x: number
  y: number
  /** For a submenu: the right edge to use instead when it doesn't fit to the right. */
  altX?: number
  items: readonly MenuItem[]
  label: string
  initialFocus: InitialFocus | null
  onClose: (reason?: MenuCloseReason) => void
  onArrowOut?: (dir: -1 | 1) => void
  /** Submenus: ← and Escape close just this level. */
  onBack?: () => void
}) {
  const ownRef = useRef<HTMLDivElement>(null)
  const ref = panelRef ?? ownRef
  const [pos, setPos] = useState<{ x: number; y: number; maxHeight?: number }>({ x, y })
  const [sub, setSub] = useState<{ index: number; focus: InitialFocus | null } | null>(null)
  const hover = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(hover.current), [])
  // Hover counts only once the pointer has really moved over the menu: a menu opened from the
  // keyboard under a resting pointer keeps the keyboard's item (browsers send pointer events
  // with no movement when content appears under the pointer).
  const moved = useRef(false)
  const start = useRef(lastPointer)
  /** Whether this pointer event is the pointer really moving (not resting where it was). */
  const isMove = (e: { clientX: number; clientY: number }) => {
    if (moved.current) return true
    const at = start.current
    if (!at) {
      start.current = { x: e.clientX, y: e.clientY }
      return false
    }
    moved.current = e.clientX !== at.x || e.clientY !== at.y
    return moved.current
  }
  const hoverRow = (i: number, open: boolean, item: MenuItem) => {
    clearTimeout(hover.current)
    if (open) return
    hover.current = setTimeout(
      () => setSub(item.submenu && !item.disabled ? { index: i, focus: null } : null),
      sub ? 250 : 120,
    )
  }

  // Keep the menu on screen (a submenu flips to the left of its item).
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    let nx = x
    if (nx + r.width > window.innerWidth - 4 && altX !== undefined) nx = altX - r.width
    setPos({
      x: Math.max(4, Math.min(nx, window.innerWidth - r.width - 4)),
      ...(anchored
        ? { y, maxHeight: window.innerHeight - y - 4 }
        : { y: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) }),
    })
  }, [x, y, altX, ref, anchored])

  useEffect(() => {
    if (!initialFocus) return
    const list = ownItems(ref.current)
    const target =
      initialFocus === 'menu' ? ref.current : initialFocus === 'last' ? list.at(-1) : list[0]
    target?.focus({ preventScroll: true })
  }, [initialFocus, ref])

  const move = (by: number | 'first' | 'last') => {
    const list = ownItems(ref.current)
    const i = list.indexOf(document.activeElement as HTMLButtonElement)
    const next =
      by === 'first'
        ? 0
        : by === 'last'
          ? list.length - 1
          : i < 0
            ? by > 0
              ? 0
              : list.length - 1
            : (i + by + list.length) % list.length
    list[next]?.focus()
  }

  const openSub = (index: number, focus: InitialFocus | null) => {
    clearTimeout(hover.current)
    setSub({ index, focus })
  }

  const buttonAt = (index: number) =>
    ref.current?.querySelector<HTMLButtonElement>(`:scope > [data-index="${index}"] > button`)

  const hasChecks = items.some((it) => it.checked !== undefined)

  return (
    <div
      ref={ref}
      className="menu"
      role="menu"
      aria-label={label}
      tabIndex={-1}
      style={{
        left: pos.x,
        top: pos.y,
        ...(pos.maxHeight ? { maxHeight: pos.maxHeight, overflowY: 'auto' } : {}),
      }}
      onKeyDown={(e) => {
        const focused = document.activeElement as HTMLElement | null
        const index = Number(focused?.parentElement?.dataset.index ?? Number.NaN)
        const item = focused?.parentElement?.parentElement === ref.current ? items[index] : null
        if (e.key === 'ArrowDown') move(1)
        else if (e.key === 'ArrowUp') move(-1)
        else if (e.key === 'Home') move('first')
        else if (e.key === 'End') move('last')
        else if (e.key === 'ArrowRight') {
          if (item?.submenu && !item.disabled) openSub(index, 'first')
          else if (onArrowOut) onArrowOut(1)
          else return
        } else if (e.key === 'ArrowLeft') {
          if (sub) setSub(null)
          else if (onBack) onBack()
          else if (onArrowOut) onArrowOut(-1)
          else return
        } else if (e.key === 'Escape') {
          // An open submenu without focus (hovered, or all its items disabled) closes first.
          if (sub) setSub(null)
          else if (onBack) onBack()
          else onClose('escape')
        } else if (e.key === 'Tab') onClose('tab')
        else {
          // Enter / Space choose the item (the button's click); the shell's shortcuts don't see
          // them.
          if (e.key === 'Enter' || e.key === ' ') e.stopPropagation()
          return
        }
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      {items.map((item, i) => {
        const open = sub?.index === i
        const button = (
          <button
            type="button"
            {...(item.checked !== undefined
              ? { role: 'menuitemcheckbox', 'aria-checked': item.checked }
              : { role: 'menuitem' })}
            aria-haspopup={item.submenu ? 'menu' : undefined}
            aria-expanded={item.submenu ? open : undefined}
            title={item.title}
            className={`${item.danger ? 'danger' : ''} ${item.separator ? 'separated' : ''} ${open ? 'open' : ''}`}
            disabled={item.disabled}
            onPointerMove={(e) => {
              // Pointer and keyboard share one highlight, as in native menus.
              if (isMove(e) && document.activeElement !== e.currentTarget)
                e.currentTarget.focus({ preventScroll: true })
            }}
            onClick={() => {
              if (item.submenu) return openSub(i, 'first')
              onClose('select')
              item.onSelect?.()
            }}
          >
            {hasChecks && <span className="menu-check">{item.checked ? '✓' : ''}</span>}
            <span className="menu-label">{item.label}</span>
            {item.shortcut && <span className="menu-shortcut">{item.shortcut}</span>}
            {item.submenu && (
              <span className="menu-arrow" aria-hidden="true">
                ▸
              </span>
            )}
          </button>
        )
        return (
          // A row per item: a submenu opens inside it, so pointer moves into the submenu count
          // as staying on the item. Delays let the pointer cross other items on the way.
          <div
            role="none"
            // biome-ignore lint/suspicious/noArrayIndexKey: items are positional (labels may repeat)
            key={`${i}:${item.label}`}
            data-index={i}
            className="menu-row"
            onPointerEnter={(e) => {
              if (isMove(e)) hoverRow(i, open, item)
            }}
            onPointerMove={(e) => {
              // The first real movement counts as entering the row under the pointer.
              if (!moved.current && isMove(e)) hoverRow(i, open, item)
            }}
          >
            {button}
            {open && item.submenu && (
              <SubmenuPanel
                anchor={buttonAt(i)}
                items={item.submenu}
                label={item.label}
                initialFocus={sub.focus}
                onClose={onClose}
                onBack={() => {
                  setSub(null)
                  buttonAt(i)?.focus()
                }}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

function SubmenuPanel({
  anchor,
  ...rest
}: {
  anchor: HTMLElement | null | undefined
  items: readonly MenuItem[]
  label: string
  initialFocus: InitialFocus | null
  onClose: (reason?: MenuCloseReason) => void
  onBack: () => void
}) {
  const r = anchor?.getBoundingClientRect()
  if (!r) return null
  // Aligned so the submenu's first item sits level with its item (4px padding + 1px border).
  return <MenuPanel x={r.right + 2} y={r.top - 5} altX={r.left - 2} {...rest} />
}
