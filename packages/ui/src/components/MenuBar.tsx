import { useEffect, useRef, useState } from 'react'
import {
  isMacPlatform,
  type MenuId,
  useCommandRegistry,
  useCommandsVersion,
} from '../commands/index.ts'
import { menuItemsFor } from './commandItems.ts'
import { Menu, type MenuCloseReason } from './Menu.tsx'

/** What an empty menu says (Format has nothing until a table, graph or layout is open). */
const EMPTY_NOTE: Partial<Record<string, string>> = {
  format: 'Open a table, graph or layout to format it',
}

/**
 * The in-app menu bar (web; the desktop app uses native menus), built from the command registry.
 * A click opens a menu; while one is open, hovering another opens it; ← / → move between menus,
 * ↓ / Enter / Space open one, Escape leaves the bar, F10 focuses it. Focus goes back to where
 * it was (the grid, a graph) when a menu closes or an item runs.
 */
export function MenuBar() {
  const registry = useCommandRegistry()
  useCommandsVersion()
  const menus = registry.menus()
  const [isMac] = useState(isMacPlatform)
  const [open, setOpen] = useState<{
    id: MenuId
    focus: 'first' | 'last' | 'menu'
  } | null>(null)
  // The bar item that takes Tab focus (roving tabindex).
  const [current, setCurrent] = useState(0)
  const barRef = useRef<HTMLDivElement>(null)
  const returnTo = useRef<HTMLElement | null>(null)

  const buttons = () => [
    ...(barRef.current?.querySelectorAll<HTMLButtonElement>(':scope > div > button') ?? []),
  ]
  /** Remembers where the focus was before the bar took it. */
  const enter = () => {
    const a = document.activeElement as HTMLElement | null
    if (!barRef.current?.contains(a)) returnTo.current = a && a !== document.body ? a : null
  }
  const leave = () => {
    const to = returnTo.current
    returnTo.current = null
    if (to?.isConnected) to.focus({ preventScroll: true })
    else (document.activeElement as HTMLElement | null)?.blur()
  }

  // F10 focuses the bar (as on Windows and in GNOME).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F10' || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
      if (document.querySelector('dialog[open]')) return
      e.preventDefault()
      enter()
      setCurrent(0)
      buttons()[0]?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const index = open ? menus.findIndex((m) => m.id === open.id) : -1
  // A menu that disappeared (Arrange when leaving a layout) closes.
  useEffect(() => {
    if (open && index < 0) setOpen(null)
  }, [open, index])

  const step = (from: number, dir: -1 | 1) => (from + dir + menus.length) % menus.length

  const onClose = (reason?: MenuCloseReason) => {
    const i = index
    setOpen(null)
    if (reason === 'escape') buttons()[i]?.focus()
    else if (reason === 'select' || reason === 'tab') leave()
    else returnTo.current = null
  }

  const run = (id: string) => void registry.run(id)

  return (
    <div
      ref={barRef}
      className="menubar"
      role="menubar"
      aria-label="Main menu"
      onPointerDown={enter}
      onFocus={(e) => {
        if (!barRef.current?.contains(e.relatedTarget as Node)) {
          if (!returnTo.current && e.relatedTarget instanceof HTMLElement)
            returnTo.current = e.relatedTarget
        }
      }}
    >
      {menus.map((m, i) => {
        const isOpen = open?.id === m.id
        return (
          <div role="none" key={m.id} className="menubar-item">
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={isOpen}
              tabIndex={i === current ? 0 : -1}
              className={isOpen ? 'open' : ''}
              onFocus={() => setCurrent(i)}
              onClick={(e) => {
                // A click from the keyboard (Enter / Space) moves into the menu.
                const keyboard = e.detail === 0
                setOpen(isOpen ? null : { id: m.id, focus: keyboard ? 'first' : 'menu' })
                if (isOpen) leave()
              }}
              onPointerEnter={() => {
                if (open && !isOpen) setOpen({ id: m.id, focus: 'menu' })
              }}
              onKeyDown={(e) => {
                const bs = buttons()
                if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                  const j = step(i, e.key === 'ArrowRight' ? 1 : -1)
                  bs[j]?.focus()
                  if (open) setOpen({ id: menus[j]!.id, focus: 'first' })
                } else if (e.key === 'Home') bs[0]?.focus()
                else if (e.key === 'End') bs.at(-1)?.focus()
                else if (e.key === 'ArrowDown') setOpen({ id: m.id, focus: 'first' })
                else if (e.key === 'ArrowUp') setOpen({ id: m.id, focus: 'last' })
                else if (e.key === 'Escape') {
                  setOpen(null)
                  leave()
                } else return
                e.preventDefault()
                e.stopPropagation()
              }}
            >
              {m.title}
            </button>
            {isOpen && (
              <MenuAt
                anchor={buttons()[i]}
                // A fresh menu for each open (focus goes to it again).
                key={`${m.id}:${open.focus}`}
                items={
                  m.items.length
                    ? menuItemsFor(m.items, run, isMac)
                    : [{ label: EMPTY_NOTE[m.id] ?? 'Nothing here for this sheet', disabled: true }]
                }
                label={m.title}
                initialFocus={open.focus}
                insideRef={barRef}
                onClose={onClose}
                onArrowOut={(dir) => {
                  const j = step(i, dir)
                  buttons()[j]?.focus()
                  setOpen({ id: menus[j]!.id, focus: 'first' })
                }}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

function MenuAt({
  anchor,
  ...rest
}: { anchor: HTMLElement | undefined } & Omit<
  Parameters<typeof Menu>[0],
  'x' | 'y' | 'restoreFocus'
>) {
  const r = anchor?.getBoundingClientRect()
  return <Menu x={r?.left ?? 0} y={r?.bottom ?? 0} restoreFocus={false} anchored {...rest} />
}
