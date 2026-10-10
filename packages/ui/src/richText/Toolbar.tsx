import { FONT_SHORT, FONTS } from '@ps/graph'
import { type ColorRef, type FontId, sameColor, type TextAlign } from '@ps/model'
import { type KeyboardEvent, type ReactNode, type RefObject, useEffect, useState } from 'react'
import { cssColor } from './dom.ts'
import { cleanSize, FONT_SIZES, type Format } from './model.ts'
import { SYMBOL_GROUPS } from './symbols.ts'

// The rich text editor's floating toolbar (roadmaps 28, 28b), two compact rows: font, size, grow /
// shrink and colour; then bold … subscript, alignment (text boxes), clear formatting and symbols.
// Buttons never take the focus (mousedown is cancelled around them), so the text keeps its
// selection; only the size box does, and gives it back when a size is entered.

const FORMAT_BUTTONS: { format: Format; label: string; keys: string; icon: ReactNode }[] = [
  { format: 'bold', label: 'Bold', keys: 'Mod+B', icon: <b>B</b> },
  { format: 'italic', label: 'Italic', keys: 'Mod+I', icon: <i>I</i> },
  { format: 'underline', label: 'Underline', keys: 'Mod+U', icon: <u>U</u> },
  {
    format: 'sup',
    label: 'Superscript',
    keys: 'Mod+Shift+=',
    icon: (
      <>
        x<sup>2</sup>
      </>
    ),
  },
  {
    format: 'sub',
    label: 'Subscript',
    keys: 'Mod+=',
    icon: (
      <>
        x<sub>2</sub>
      </>
    ),
  },
]

const ALIGNS: { align: TextAlign; label: string; icon: string }[] = [
  { align: 'left', label: 'Align left', icon: '⇤' },
  { align: 'center', label: 'Align centre', icon: '↔' },
  { align: 'right', label: 'Align right', icon: '⇥' },
]

/** Black and greys beside the palette (black only when the palette lacks it). */
const GREYS: [string, string][] = [
  ['#000000', 'Black'],
  ['#404040', 'Dark grey'],
  ['#808080', 'Grey'],
  ['#bfbfbf', 'Light grey'],
  ['#ffffff', 'White'],
]

const keyHint = (keys: string, mac: boolean) =>
  mac ? keys.replace('Mod+', '⌘').replace('Shift+', '⇧') : keys.replace('Mod+', 'Ctrl+')

type Popup = 'font' | 'size' | 'color' | 'symbols' | null

interface ToolbarProps {
  mac: boolean
  /** Formats every selected character has (or typing continues). */
  formats: Record<Format, boolean>
  /** The selection's font, size and colour; null = mixed (shown blank), colour undefined = automatic. */
  font: FontId | null
  size: number | null
  color: ColorRef | undefined | null
  /** The element's colour, shown for "Automatic". */
  autoColor: string
  palette: readonly string[]
  /** Present for text boxes: the alignment buttons. */
  align?: TextAlign
  /** Where it floats (viewport coordinates); `up`: its menus open upwards. */
  place: { top: number; left: number; up: boolean }
  /** Roadmap 45: docked in the format bar (one row, in place) rather than floating. */
  docked?: boolean
  barRef: RefObject<HTMLDivElement | null>
  onToggle: (f: Format) => void
  onFont: (f: FontId) => void
  onSize: (size: number) => void
  onStep: (dir: 1 | -1) => void
  onColor: (c: ColorRef | undefined) => void
  onAlign: (a: TextAlign) => void
  onClear: () => void
  onSymbol: (c: string) => void
  /** The size box is done (entered or cancelled): the text takes the focus back. */
  onSizeDone: () => void
}

export function Toolbar(p: ToolbarProps) {
  const [popup, setPopup] = useState<Popup>(null)
  // An open menu closes with Escape (before the editor would cancel) or a press outside it.
  useEffect(() => {
    if (!popup) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      setPopup(null)
    }
    const onDown = (e: MouseEvent) => {
      if (!p.barRef.current?.contains(e.target as Node)) setPopup(null)
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('mousedown', onDown, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('mousedown', onDown, true)
    }
  }, [popup, p.barRef])
  const toggle = (which: Popup) => setPopup(popup === which ? null : which)
  const pick =
    <T,>(f: (v: T) => void) =>
    (v: T) => {
      setPopup(null)
      f(v)
    }
  const shownColor = p.color === null ? null : p.color ? cssColor(p.color, p.palette) : null
  const sizeText = p.size === null ? '' : String(p.size)
  const onSizeKey = (e: KeyboardEvent<HTMLInputElement>) => {
    // The size box's keys are its own (not the views' or the dialog's around it).
    e.stopPropagation()
    if (e.key === 'Enter') {
      e.preventDefault()
      const v = cleanSize(Number(e.currentTarget.value.replace(',', '.')))
      if (v !== null) p.onSize(v)
      else e.currentTarget.value = sizeText
      p.onSizeDone()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.currentTarget.value = sizeText
      p.onSizeDone()
    }
  }
  const button = (
    label: string,
    icon: ReactNode,
    onClick: () => void,
    extra: { pressed?: boolean; title?: string; expanded?: boolean; className?: string } = {},
  ) => (
    <button
      type="button"
      tabIndex={-1}
      aria-label={label}
      title={extra.title ?? label}
      aria-pressed={extra.pressed}
      aria-haspopup={extra.expanded === undefined ? undefined : 'menu'}
      aria-expanded={extra.expanded}
      className={extra.className}
      onClick={onClick}
    >
      {icon}
    </button>
  )

  return (
    <div
      ref={p.barRef}
      className={`rt-toolbar ${p.docked ? 'docked' : p.place.up ? 'up' : ''}`}
      role="toolbar"
      aria-label="Text format"
      style={p.docked ? undefined : { top: p.place.top, left: p.place.left }}
      // Clicks keep the focus and selection in the text (the size box excepted).
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).tagName !== 'INPUT') e.preventDefault()
      }}
    >
      <div className="rt-row">
        {button(
          'Font',
          <span className="rt-font">{p.font ? FONT_SHORT[p.font] : ''}</span>,
          () => toggle('font'),
          { expanded: popup === 'font', title: 'Font', className: 'rt-menu-button' },
        )}
        <span className="rt-size">
          {/* An editable box with a list of sizes beside it: a combobox, as in word processors. */}
          <input
            key={sizeText}
            role="combobox"
            aria-expanded={popup === 'size'}
            aria-autocomplete="none"
            aria-label="Font size"
            title="Font size (pt)"
            inputMode="decimal"
            defaultValue={sizeText}
            onKeyDown={onSizeKey}
            onFocus={(e) => {
              setPopup(null)
              e.currentTarget.select()
            }}
          />
          {button('Font sizes', '▾', () => toggle('size'), { expanded: popup === 'size' })}
        </span>
        {button('Grow font', 'A↑', () => p.onStep(1), {
          title: `Grow font (${keyHint('Mod+Shift+>', p.mac)})`,
        })}
        {button('Shrink font', 'A↓', () => p.onStep(-1), {
          title: `Shrink font (${keyHint('Mod+Shift+<', p.mac)})`,
        })}
        {button(
          'Text colour',
          <span className="rt-color">
            A
            <span
              className={`rt-color-bar ${shownColor === null && p.color !== undefined ? 'mixed' : ''}`}
              style={{
                background: p.color === undefined ? p.autoColor : (shownColor ?? undefined),
              }}
            />
          </span>,
          () => toggle('color'),
          { expanded: popup === 'color' },
        )}
      </div>
      <div className="rt-row">
        {FORMAT_BUTTONS.map((b) => (
          <span key={b.format} className="rt-item">
            {button(b.label, b.icon, () => p.onToggle(b.format), {
              pressed: p.formats[b.format],
              title: `${b.label} (${keyHint(b.keys, p.mac)})`,
            })}
          </span>
        ))}
        {p.align && <span className="rt-sep" />}
        {p.align &&
          ALIGNS.map((a) => (
            <span key={a.align} className="rt-item">
              {button(a.label, a.icon, () => p.onAlign(a.align), {
                pressed: p.align === a.align,
              })}
            </span>
          ))}
        <span className="rt-sep" />
        {button(
          'Clear formatting',
          <span className="rt-clear">
            T<sub>x</sub>
          </span>,
          p.onClear,
        )}
        {button('Insert symbol', 'Ω', () => toggle('symbols'), { expanded: popup === 'symbols' })}
      </div>

      {popup === 'font' && (
        <div className="rt-popup rt-list" role="menu" aria-label="Fonts">
          {(Object.keys(FONTS) as FontId[]).map((id) => (
            <button
              key={id}
              type="button"
              tabIndex={-1}
              role="menuitemradio"
              aria-checked={p.font === id}
              style={{ fontFamily: `'${FONTS[id].cssFamily}'` }}
              onClick={() => pick(p.onFont)(id)}
            >
              {FONTS[id].label}
            </button>
          ))}
        </div>
      )}
      {popup === 'size' && (
        <div className="rt-popup rt-list rt-sizes" role="menu" aria-label="Font sizes">
          {FONT_SIZES.map((s) => (
            <button
              key={s}
              type="button"
              tabIndex={-1}
              role="menuitemradio"
              aria-checked={p.size === s}
              onClick={() => pick(p.onSize)(s)}
            >
              {s}
            </button>
          ))}
        </div>
      )}
      {popup === 'color' && (
        <div className="rt-popup rt-colors" role="menu" aria-label="Text colours">
          <button
            type="button"
            tabIndex={-1}
            role="menuitemradio"
            aria-checked={p.color === undefined}
            className="rt-auto"
            onClick={() => pick(p.onColor)(undefined)}
          >
            <span className="swatch" style={{ background: p.autoColor }} /> Automatic
          </button>
          <div className="rt-swatches">
            {p.palette.map((c, i) => (
              <button
                // biome-ignore lint/suspicious/noArrayIndexKey: palette entries are positional
                key={i}
                type="button"
                tabIndex={-1}
                role="menuitemradio"
                aria-checked={!!p.color && sameColor(p.color, { palette: i })}
                aria-label={`Palette colour ${i + 1}`}
                title={c}
                className="swatch"
                style={{ background: c }}
                onClick={() => pick(p.onColor)({ palette: i })}
              />
            ))}
          </div>
          <div className="rt-swatches">
            {GREYS.filter(([c]) => c !== '#000000' || !p.palette.includes(c)).map(([c, name]) => (
              <button
                key={c}
                type="button"
                tabIndex={-1}
                role="menuitemradio"
                aria-checked={!!p.color && sameColor(p.color, { rgb: c })}
                aria-label={name}
                title={name}
                className="swatch"
                style={{ background: c }}
                onClick={() => pick(p.onColor)({ rgb: c })}
              />
            ))}
          </div>
        </div>
      )}
      {popup === 'symbols' && (
        // biome-ignore lint/a11y/useSemanticElements: a fieldset would be a form part
        <div className="rt-popup rt-symbols" role="group" aria-label="Symbols">
          {SYMBOL_GROUPS.map((g) => (
            // biome-ignore lint/a11y/useSemanticElements: as above
            <div key={g.label} role="group" aria-label={g.label}>
              {g.symbols.map(([c, name]) => (
                <button
                  key={c}
                  type="button"
                  tabIndex={-1}
                  aria-label={name}
                  title={name}
                  onClick={() => p.onSymbol(c)}
                >
                  {c}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
