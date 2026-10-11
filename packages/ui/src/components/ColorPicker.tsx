import type { ColorRef } from '@ps/model'
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { ColorInput } from './fields.tsx'
import { portalHost } from './portalHost.ts'

// Roadmap 46 (UX review V6): one colour control for the Format panel's fields, the dialog's and
// the format bar's colour buttons — a button showing the colour (striped when the items differ,
// "Automatic" when nothing is set) that opens a popover: Automatic (when the field has one: it
// writes `undefined`, decision 531), the graph's palette, greys, the colours recently made
// custom, and a custom colour (a picker and a hex box). The popover is a non-modal dialog
// portalled to the body (never under the data grid's `.grid` rule), or into the modal dialog its
// button is in (`portalHost`, decision 1212), holding a listbox: arrows move across the swatches
// by row and column, Enter or Space pick (and close), Escape closes, the focus going back where it
// was (the button, or the canvas for the format bar's buttons, which keep it there). Tab cycles
// inside it.

/** Greys after the palette (the format bar's and the text editor's). */
export const GREYS: readonly (readonly [string, string])[] = [
  ['#000000', 'Black'],
  ['#404040', 'Dark grey'],
  ['#808080', 'Grey'],
  ['#bfbfbf', 'Light grey'],
  ['#ffffff', 'White'],
]

/** Swatches per row. */
export const COLOR_COLUMNS = 8
const RECENT_KEY = 'ps.recentColours'
const RECENT_MAX = COLOR_COLUMNS

/** The custom colours chosen lately, most recent first (remembered per user). */
export function recentColours(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(v)
      ? v.filter((c): c is string => typeof c === 'string' && HEX.test(c)).slice(0, RECENT_MAX)
      : []
  } catch {
    return []
  }
}

/** Remembers a custom colour as the most recent. */
export function rememberColour(rgb: string): void {
  const c = rgb.toLowerCase()
  if (!HEX.test(c)) return
  try {
    const next = [c, ...recentColours().filter((x) => x !== c)].slice(0, RECENT_MAX)
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {}
}

const HEX = /^#[0-9a-f]{6}$/i

/** "#abc", "abcdef", "#ABCDEF" → "#abcdef"; null when not a colour. */
export function parseHex(text: string): string | null {
  let t = text.trim().toLowerCase()
  if (!t.startsWith('#')) t = `#${t}`
  if (/^#[0-9a-f]{3}$/.test(t)) t = `#${t[1]}${t[1]}${t[2]}${t[2]}${t[3]}${t[3]}`
  return HEX.test(t) ? t : null
}

/** Resolves a colour reference for display (palette entries by index; the series' as `fallback`). */
export function colorOf(ref: ColorRef | undefined, palette: readonly string[], fallback: string) {
  if (!ref) return fallback
  if ('rgb' in ref) return ref.rgb
  if ('palette' in ref) return palette[ref.palette % palette.length] ?? fallback
  return fallback
}

/** What a colour control shows. */
export interface ColorState {
  /** The colour drawn (CSS); unused when mixed. */
  css: string
  /** The value as stored, when known (a palette entry, a colour, the series'); undefined: unset. */
  value?: ColorRef | undefined
  /** Nothing set: the Automatic choice is the current one (only with an `automatic` choice). */
  auto?: boolean
  /** The items edited differ: no choice is current, the swatch is striped. */
  mixed?: boolean
}

/** One choice of the popover. */
interface Choice {
  id: string
  label: string
  /** The swatch's colour (none for a choice drawn as text). */
  css?: string
  /** A whole row (Automatic, the series' colour). */
  wide?: boolean
  value: ColorRef | undefined
  /** A remembered colour (picking it moves it to the front). */
  recent?: boolean
  /** Drawn striped (Automatic when it means each item's own colour). */
  striped?: boolean
  /** Drawn as "no colour". */
  none?: boolean
}

/**
 * The Automatic choice (it picks `undefined`): its label ("Automatic", "No fill", "From the
 * colour scheme"), the colour it gives (none: drawn as "no colour"), or `striped` (each item its
 * own).
 */
export interface AutoChoice {
  label: string
  css?: string | null
  striped?: boolean
  /** Drawn as "no colour" (No fill, No line). */
  none?: boolean
}

export interface ColorPopoverProps {
  /** The button it hangs from (its position; a press on it is not "elsewhere"). */
  anchor: HTMLElement
  /** The dialog's name ("Fill colours", "Data set colour"). */
  label: string
  palette: readonly string[]
  current: ColorState
  automatic?: AutoChoice | null
  /** "Same colour as the data set" (`{ series: true }`). */
  allowSeries?: boolean
  /** A choice made from the list: the popover closes. */
  onPick: (c: ColorRef | undefined) => void
  /** A custom colour (the picker as it moves, or the hex box): the popover stays. */
  onCustom: (rgb: string) => void
  onClose: () => void
  /**
   * Where the focus goes as it closes: the element that had it (the canvas, for the format bar,
   * whose buttons never take it), or its button (a field's: Safari doesn't focus a clicked one).
   */
  restoreFocus?: 'previous' | 'anchor'
}

/** The choices in order, split into rows (wide ones alone, swatches by `COLOR_COLUMNS`). */
export function colorChoices(
  palette: readonly string[],
  o: {
    automatic?: AutoChoice | null
    allowSeries?: boolean
    recent?: readonly string[]
  } = {},
): Choice[][] {
  const rows: Choice[][] = []
  if (o.automatic)
    rows.push([
      {
        id: 'auto',
        label: o.automatic.label,
        ...(o.automatic.css ? { css: o.automatic.css } : {}),
        ...(o.automatic.striped ? { striped: true } : {}),
        ...(o.automatic.none ? { none: true } : {}),
        wide: true,
        value: undefined,
      },
    ])
  if (o.allowSeries)
    rows.push([
      { id: 'series', label: 'Same colour as the data set', wide: true, value: { series: true } },
    ])
  const swatches = (list: Choice[]) => {
    for (let i = 0; i < list.length; i += COLOR_COLUMNS) rows.push(list.slice(i, i + COLOR_COLUMNS))
  }
  const lower = palette.map((c) => c.toLowerCase())
  swatches(
    palette.map((c, i) => ({
      id: `p${i}`,
      label: `Palette colour ${i + 1}`,
      css: c,
      value: { palette: i },
    })),
  )
  swatches(
    GREYS.filter(([c]) => !lower.includes(c)).map(([c, name]) => ({
      id: `g${c.slice(1)}`,
      label: name,
      css: c,
      value: { rgb: c },
    })),
  )
  swatches(
    (o.recent ?? []).map((c) => ({
      id: `r${c.slice(1)}`,
      label: `Recent colour ${c}`,
      css: c,
      value: { rgb: c },
      recent: true,
    })),
  )
  return rows
}

/** The choice that is the current value: by reference first, else the same colour; none if mixed. */
export function currentChoice(rows: readonly Choice[][], s: ColorState): string | null {
  const all = rows.flat()
  if (s.auto) return all.find((c) => c.id === 'auto')?.id ?? null
  if (s.mixed) return null
  const v = s.value
  if (v && 'series' in v) return all.find((c) => c.id === 'series')?.id ?? null
  if (v && 'palette' in v) {
    const hit = all.find((c) => c.value && 'palette' in c.value && c.value.palette === v.palette)
    if (hit) return hit.id
  }
  const css = s.css.toLowerCase()
  return all.find((c) => c.css?.toLowerCase() === css && c.id !== 'auto')?.id ?? null
}

/**
 * Where the arrow keys go in rows of choices: ← / → along the order, ↑ / ↓ to the row above or
 * below at the same column (its last when shorter), Home / End to the first and last.
 */
export function moveIn(rows: readonly Choice[][], id: string | null, key: string): string | null {
  const flat = rows.flat()
  if (!flat.length) return null
  const r = rows.findIndex((row) => row.some((c) => c.id === id))
  if (r < 0) return key === 'End' || key === 'ArrowUp' ? flat.at(-1)!.id : flat[0]!.id
  const col = rows[r]!.findIndex((c) => c.id === id)
  const i = flat.findIndex((c) => c.id === id)
  switch (key) {
    case 'ArrowRight':
      return flat[Math.min(flat.length - 1, i + 1)]!.id
    case 'ArrowLeft':
      return flat[Math.max(0, i - 1)]!.id
    case 'ArrowDown':
    case 'ArrowUp': {
      const to = rows[r + (key === 'ArrowDown' ? 1 : -1)]
      return to ? to[Math.min(col, to.length - 1)]!.id : id
    }
    case 'Home':
      return flat[0]!.id
    case 'End':
      return flat.at(-1)!.id
    default:
      return id
  }
}

/** The popover of choices under (or above, without room) its button. */
export function ColorPopover({
  anchor,
  label,
  palette,
  current,
  automatic,
  allowSeries,
  onPick,
  onCustom,
  onClose,
  restoreFocus = 'previous',
}: ColorPopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const back = useRef<Element | null>(null)
  const uid = useId()
  const [recent] = useState(recentColours)
  const rows = colorChoices(palette, {
    automatic: automatic ?? null,
    allowSeries: !!allowSeries,
    recent,
  })
  const chosen = currentChoice(rows, current)
  const [active, setActive] = useState<string | null>(() => chosen ?? rows[0]?.[0]?.id ?? null)
  const optionId = (id: string) => `${uid}-${id}`
  const [hex, setHex] = useState(current.mixed ? '' : current.css)
  useEffect(() => {
    if (!current.mixed) setHex(current.css)
  }, [current.css, current.mixed])

  // As it opens: the focus on the list (the current choice active), the box inside the window.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, as it opens
  useLayoutEffect(() => {
    // (Not the list itself: effects may run twice as it mounts.)
    if (!ref.current?.contains(document.activeElement)) back.current = document.activeElement
    listRef.current?.focus({ preventScroll: true })
    const el = ref.current
    if (!el) return
    const a = anchor.getBoundingClientRect()
    const b = el.getBoundingClientRect()
    const below = a.bottom + 2
    const top =
      below + b.height > window.innerHeight - 4 && a.top - 2 - b.height >= 4
        ? a.top - 2 - b.height
        : below
    el.style.top = `${Math.max(4, top)}px`
    el.style.left = `${Math.max(4, Math.min(a.left, window.innerWidth - 4 - b.width))}px`
    el.style.maxHeight = `${Math.max(160, window.innerHeight - 8 - Math.max(4, top))}px`
  }, [])
  useEffect(() => {
    if (!active) return
    document.getElementById(optionId(active))?.scrollIntoView?.({ block: 'nearest' })
  })

  const close = (refocus = true) => {
    onClose()
    const to = restoreFocus === 'anchor' ? anchor : back.current
    if (refocus && to instanceof HTMLElement) to.focus({ preventScroll: true })
  }
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Node
      if (ref.current?.contains(t) || anchor.contains(t)) return
      onClose()
    }
    document.addEventListener('pointerdown', down, true)
    return () => document.removeEventListener('pointerdown', down, true)
  }, [anchor, onClose])

  const pick = (c: Choice) => {
    if (c.recent && c.css) rememberColour(c.css)
    close()
    onPick(c.value)
  }
  const custom = (rgb: string, remember: boolean) => {
    const c = parseHex(rgb)
    if (!c) return
    setHex(c)
    if (remember) rememberColour(c)
    onCustom(c)
  }

  const onListKey = (e: KeyboardEvent) => {
    if (['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault()
      setActive(moveIn(rows, active, e.key))
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const c = rows.flat().find((x) => x.id === active)
      if (c) pick(c)
    }
  }
  const onKey = (e: KeyboardEvent) => {
    // Keys stay in the popover: the view's (nudges, Delete) and the dialog's (⌘Enter = OK) never
    // see them.
    e.stopPropagation()
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'Tab') {
      // A dialog: Tab cycles inside it.
      const stops = [
        ...(ref.current?.querySelectorAll<HTMLElement>('[role="listbox"], input') ?? []),
      ]
      const i = stops.indexOf(document.activeElement as HTMLElement)
      e.preventDefault()
      stops[(i + (e.shiftKey ? -1 : 1) + stops.length) % stops.length]?.focus()
    }
  }

  return createPortal(
    <div
      ref={ref}
      className="color-popover"
      role="dialog"
      aria-label={label}
      data-testid="color-popover"
      onKeyDown={onKey}
      // Presses keep the focus where it is (the list, or the canvas for the format bar) until a
      // choice is made; the custom colour's inputs take it.
      onMouseDown={(e) => {
        if (!(e.target as Element).closest('input')) e.preventDefault()
      }}
    >
      <div
        ref={listRef}
        className="color-choices"
        role="listbox"
        aria-label={`${label}: choices`}
        tabIndex={0}
        aria-activedescendant={active ? optionId(active) : undefined}
        onKeyDown={onListKey}
      >
        {rows.map((row, r) => {
          const recentRow = row[0]?.recent && !rows[r - 1]?.[0]?.recent
          return (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
              key={r}
              className={`color-row ${row[0]?.wide ? 'wide' : ''}`}
              role="presentation"
            >
              {recentRow && (
                <div className="color-row-label" aria-hidden="true">
                  Recent
                </div>
              )}
              {row.map((c) => (
                // biome-ignore lint/a11y/useKeyWithClickEvents: the list's keys choose (aria-activedescendant)
                <div
                  key={c.id}
                  id={optionId(c.id)}
                  role="option"
                  tabIndex={-1}
                  aria-selected={c.id === chosen}
                  aria-label={c.label}
                  title={
                    c.wide
                      ? undefined
                      : c.label === `Recent colour ${c.css}`
                        ? c.css
                        : `${c.label} (${c.css})`
                  }
                  className={`color-choice ${c.wide ? 'wide' : 'cell'} ${c.id === active ? 'active' : ''}`}
                  onPointerEnter={() => setActive(c.id)}
                  onClick={() => pick(c)}
                >
                  {c.wide ? (
                    <>
                      <span
                        className={`color-chip ${c.id === 'series' ? 'series' : ''} ${c.striped ? 'mixed' : c.none ? 'none' : c.css || c.id === 'series' ? '' : 'blank'}`}
                        style={c.css ? { background: c.css } : undefined}
                        aria-hidden="true"
                      >
                        {c.id === 'series' ? '≡' : null}
                      </span>
                      {c.label}
                    </>
                  ) : (
                    <span className="color-chip" style={{ background: c.css }} aria-hidden="true" />
                  )}
                </div>
              ))}
            </div>
          )
        })}
      </div>
      <div className="color-custom">
        <span className="color-custom-picker">
          <ColorInput
            value={current.mixed ? current.css || '#000000' : current.css}
            onCommit={(rgb) => custom(rgb, false)}
            onDone={(rgb) => rememberColour(rgb)}
            label="Custom colour"
          />
          <span aria-hidden="true">Custom</span>
        </span>
        <input
          type="text"
          className="color-hex"
          aria-label="Hex colour"
          spellCheck={false}
          value={hex}
          placeholder="#rrggbb"
          onChange={(e) => setHex(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              custom(hex, true)
            }
          }}
          onBlur={() => {
            if (parseHex(hex) && parseHex(hex) !== current.css.toLowerCase()) custom(hex, true)
          }}
        />
      </div>
    </div>,
    portalHost(anchor),
  )
}

/** The swatch a colour control shows: the colour, stripes when mixed, a slash for none. */
export function ColorChip({ state, className = '' }: { state: ColorState; className?: string }) {
  return (
    <span
      className={`color-chip ${state.mixed ? 'mixed' : ''} ${!state.mixed && !state.css ? 'none' : ''} ${className}`}
      style={!state.mixed && state.css ? { background: state.css } : undefined}
      aria-hidden="true"
    />
  )
}

/** What a colour control says it holds. */
export function colorText(s: ColorState, automaticLabel = 'Automatic'): string {
  if (s.auto) return automaticLabel
  if (s.mixed) return 'Mixed'
  if (s.value && 'series' in s.value) return 'Data set’s'
  return s.css.toUpperCase()
}

/**
 * A labelled colour field: the button (its name the label and what it holds, "Data set colour
 * Automatic") and, when open, the popover. `onChange(undefined)` is Automatic.
 */
export function ColorButtonField({
  label,
  state,
  palette,
  automatic,
  allowSeries,
  onChange,
}: {
  label: ReactNode
  state: ColorState
  palette: readonly string[]
  automatic?: AutoChoice | null
  allowSeries?: boolean
  onChange: (c: ColorRef | undefined, css: string | null) => void
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const text = colorText(state, automatic?.label)
  const resolve = (c: ColorRef | undefined) =>
    c === undefined ? (automatic?.css ?? null) : colorOf(c, palette, state.css)
  return (
    <div className="field color-button-field">
      <label id={`${id}-label`} htmlFor={id}>
        {label}
      </label>
      <button
        ref={button}
        id={id}
        type="button"
        className="color-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-labelledby={`${id}-label ${id}-value`}
        title={state.mixed ? 'The items have different colours' : undefined}
        onClick={() => setOpen(!open)}
      >
        <ColorChip state={state} />
        <span id={`${id}-value`} className="color-value">
          {text}
        </span>
        <span className="color-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && button.current && (
        <ColorPopover
          anchor={button.current}
          label={typeof label === 'string' ? label : 'Colour'}
          palette={palette}
          current={state}
          automatic={automatic ?? null}
          allowSeries={allowSeries}
          onPick={(c) => onChange(c, resolve(c))}
          onCustom={(rgb) => onChange({ rgb }, rgb)}
          onClose={() => setOpen(false)}
          restoreFocus="anchor"
        />
      )}
    </div>
  )
}

/**
 * A colour as a colour (`value`, CSS): the panel's data set, point and colour-map colours.
 * `mixed`: the items it edits have different colours (a striped swatch); a choice applies to all.
 * `automatic`: the field can be unset (the Automatic choice), `on` when it is.
 */
export function ColorField({
  label,
  value,
  palette,
  onChange,
  mixed = false,
  automatic,
}: {
  label: string
  value: string
  palette: readonly string[]
  /** The colour picked, and as a reference to store (a palette entry or the colour itself). */
  onChange: (rgb: string, ref: ColorRef) => void
  mixed?: boolean
  automatic?: { on: boolean; label?: string; css?: string; onPick: () => void }
}) {
  return (
    <ColorButtonField
      label={label}
      state={{ css: value, mixed, auto: !!automatic?.on }}
      palette={palette}
      automatic={
        automatic
          ? {
              label: automatic.label ?? 'Automatic',
              css: automatic.css ?? null,
              striped: automatic.css === undefined,
            }
          : null
      }
      onChange={(c, css) => {
        if (c === undefined) automatic?.onPick()
        else onChange(css ?? colorOf(c, palette, value), c)
      }}
    />
  )
}
