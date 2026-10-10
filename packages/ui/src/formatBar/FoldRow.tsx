import {
  Children,
  isValidElement,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { Tooltip } from '../components/Tooltip.tsx'
import { type FoldId, foldedGroups, sameFolded } from './overflow.ts'

// Roadmap 47: the format bar's groups, folding into "More ▾" when the bar is too narrow
// (`overflow.ts` decides). The bar's children stay where they are, each group after a
// `<FoldMark id=…/>`: a group shown is wrapped in the bar, a folded one is drawn in the More
// popover (the same controls, opening the same menus), so nothing scrolls out of sight. Widths
// come from a ResizeObserver on the bar, its name and each group (no layout read per render).

/** Starts a group of the bar's children (until the next mark). */
export function FoldMark(_: { id: FoldId }): null {
  return null
}
/** What `FoldRow` looks for (not the function itself, which a hot reload replaces). */
FoldMark.foldMark = true as const

/** The gap between the bar's children (`.format-bar` `gap`). */
const GAP = 2
/** The More button's width until it has been measured. */
const MORE_WIDTH = 64

/** A width from an observer entry (its border box, with the gap after it). */
const widthOf = (e: ResizeObserverEntry) =>
  (e.borderBoxSize?.[0]?.inlineSize ?? e.target.getBoundingClientRect().width) + GAP

export function FoldRow({
  bar,
  children,
}: {
  bar: RefObject<HTMLElement | null>
  children: ReactNode
}) {
  const id = useId()
  // The groups, in order: each mark's id and the children after it.
  const units: { id: FoldId; nodes: ReactNode[] }[] = []
  for (const c of Children.toArray(children)) {
    if (isValidElement<{ id: FoldId }>(c) && (c.type as { foldMark?: true }).foldMark)
      units.push({ id: c.props.id, nodes: [] })
    else units.at(-1)?.nodes.push(c)
  }
  const present = units.filter((u) => u.nodes.length)

  const [folded, setFolded] = useState<ReadonlySet<FoldId>>(() => new Set())
  const widths = useRef(new Map<FoldId, number>())
  const sizes = useRef({ bar: 0, name: 0, more: MORE_WIDTH })
  const ids = present.map((u) => u.id).join()
  const decide = useCallback(() => {
    const s = sizes.current
    if (!s.bar) return
    const list = ids.split(',').filter(Boolean) as FoldId[]
    // Run mode (the editor docked, no groups): kept as it was for when they come back.
    if (!list.length) return
    const next = foldedGroups(
      s.bar,
      s.name + GAP,
      list.map((u) => ({ id: u, width: widths.current.get(u) ?? 0 })),
      s.more,
    )
    setFolded((f) => (sameFolded(f, next) ? f : next))
  }, [ids])
  const decideRef = useRef(decide)
  decideRef.current = decide
  const [observer] = useState(() =>
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver((entries, self) => {
          for (const e of entries) {
            const el = e.target as HTMLElement
            // A group just folded (taken out of the bar) keeps the width it had there.
            if (!el.isConnected) {
              self.unobserve(el)
              continue
            }
            if (el === bar.current) sizes.current.bar = e.contentRect.width
            else if (el.dataset.unit) widths.current.set(el.dataset.unit as FoldId, widthOf(e))
            else if (el.dataset.barItem === 'more') sizes.current.more = widthOf(e)
            else sizes.current.name = widthOf(e) - GAP
          }
          decideRef.current()
        }),
  )
  // After the commit: the bar's ref is set once its children's layout effects have run.
  useEffect(() => {
    const b = bar.current
    if (!observer || !b) return
    observer.observe(b)
    const name = b.querySelector('.fb-name')
    if (name) observer.observe(name)
    return () => observer.disconnect()
  }, [observer, bar])
  // A group added or gone (another selection's bar): decided again with what is known.
  useEffect(() => decide(), [decide])
  /** Observes a group (or the More button) while it is in the bar. */
  const observe = useCallback(
    (el: HTMLElement | null) => {
      if (el) observer?.observe(el)
    },
    [observer],
  )

  // ---- More ▾ --------------------------------------------------------------------------------
  const [open, setOpen] = useState<{ right: number; top: number; keyboard: boolean } | null>(null)
  const moreRef = useRef<HTMLButtonElement | null>(null)
  const moreButton = useCallback(
    (el: HTMLButtonElement | null) => {
      moreRef.current = el
      if (el) observer?.observe(el)
    },
    [observer],
  )
  const panel = useRef<HTMLDivElement>(null)
  const hidden = present.filter((u) => folded.has(u.id))
  const shown = open && hidden.length > 0
  useEffect(() => {
    if (open && !hidden.length) setOpen(null)
  })
  const items = () =>
    [...(panel.current?.querySelectorAll<HTMLElement>('[data-bar-item]') ?? [])].filter(
      (el) => !(el as HTMLButtonElement).disabled,
    )
  // Opened from the keyboard: the focus goes to its first control.
  // biome-ignore lint/correctness/useExhaustiveDependencies: as it opens
  useLayoutEffect(() => {
    if (open?.keyboard) items()[0]?.focus()
  }, [!!open])
  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => {
      const t = e.target as Element
      if (
        panel.current?.contains(t) ||
        moreRef.current?.contains(t) ||
        t.closest?.('.bar-menu, .color-popover')
      )
        return
      setOpen(null)
    }
    document.addEventListener('pointerdown', down, true)
    return () => document.removeEventListener('pointerdown', down, true)
  }, [open])
  const close = () => {
    setOpen(null)
    moreRef.current?.focus({ preventScroll: true })
  }
  const onPanelKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault()
      e.stopPropagation()
      close()
      return
    }
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
    if (e.target instanceof HTMLInputElement) return
    const list = items()
    const i = list.indexOf((e.target as HTMLElement).closest<HTMLElement>('[data-bar-item]')!)
    const j =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? list.length - 1
          : (i + (e.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length
    e.preventDefault()
    e.stopPropagation()
    list[j]?.focus()
  }

  return (
    <>
      {present.map((u) =>
        folded.has(u.id) ? null : (
          <span key={u.id} ref={observe} className="fb-unit" data-unit={u.id}>
            {u.nodes}
          </span>
        ),
      )}
      {hidden.length > 0 && (
        <Tooltip content={`More: ${hidden.map((u) => UNIT_NAMES[u.id]).join(', ')}`}>
          <button
            ref={moreButton}
            type="button"
            className="fb-menu-button fb-more"
            data-bar-item="more"
            aria-label="More format options"
            aria-expanded={!!shown}
            aria-controls={shown ? `${id}-more` : undefined}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              if (open) return setOpen(null)
              const r = e.currentTarget.getBoundingClientRect()
              setOpen({
                right: window.innerWidth - r.right,
                top: r.bottom + 2,
                keyboard: e.detail === 0,
              })
            }}
          >
            More
          </button>
        </Tooltip>
      )}
      {shown &&
        createPortal(
          <div
            ref={panel}
            id={`${id}-more`}
            className="format-bar fb-overflow"
            role="toolbar"
            aria-label="More format options"
            style={{ right: Math.max(4, open.right), top: open.top }}
            onKeyDown={onPanelKey}
          >
            {hidden.map((u) => (
              <span key={u.id} className="fb-unit" data-folded={u.id}>
                {u.nodes}
              </span>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}

/** The groups as the More button's tooltip names them. */
const UNIT_NAMES: Record<FoldId, string> = {
  text: 'Text',
  fill: 'Fill',
  line: 'Line',
  symbols: 'Symbols',
  layout: 'Legend layout',
  reset: 'Reset position',
  painter: 'Format painter',
  format: 'Format…',
}
