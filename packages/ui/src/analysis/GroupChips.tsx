import { type DragEvent, type KeyboardEvent, useId, useRef, useState } from 'react'

// Roadmap 51b (design §4.3, U6): the groups an analysis compares, as chips in the analysis' order —
// click (or Space) to include or leave out, drag or Alt + ←/→ to reorder, ⇄ to swap two groups,
// a control set on its chip (it moves first) — with the comparison spelled out below them.

export interface Chip {
  key: string
  title: string
}

/**
 * The chips' order: the chosen data sets in their order, then the others in table order (left
 * out). `chosen` is `input.dataSets`' order.
 */
export const chipOrder = (all: readonly Chip[], chosen: readonly string[]): Chip[] => [
  ...chosen.flatMap((k) => all.filter((c) => c.key === k)),
  ...all.filter((c) => !chosen.includes(c.key)),
]

/** The chosen keys after moving `key` by `by` places among the chosen ones. */
export function moved(chosen: readonly string[], key: string, by: number): string[] {
  const i = chosen.indexOf(key)
  const j = i + by
  if (i < 0 || j < 0 || j >= chosen.length) return [...chosen]
  const out = [...chosen]
  out.splice(i, 1)
  out.splice(j, 0, key)
  return out
}

export function GroupChips({
  all,
  chosen,
  onChange,
  label,
  sentence,
  control,
  onControl,
  hint,
}: {
  all: readonly Chip[]
  /** The chosen keys, in the analysis' order. */
  chosen: readonly string[]
  onChange: (chosen: string[]) => void
  /** "Groups", "Data sets", "Variables". */
  label: string
  /** "Comparing: “Treated” − “Control”." (aria-live). */
  sentence: string | null
  /** The control's key, when the analysis compares with one (a chip toggle, first). */
  control?: string
  onControl?: (key: string) => void
  /** A line on how many to choose. */
  hint?: string
}) {
  const id = useId()
  const chips = chipOrder(all, chosen)
  const [focus, setFocus] = useState(0)
  const refs = useRef<(HTMLDivElement | null)[]>([])
  const drag = useRef<string | null>(null)
  const at = Math.min(focus, chips.length - 1)

  const toggle = (key: string) =>
    onChange(chosen.includes(key) ? chosen.filter((k) => k !== key) : [...chosen, key])
  const moveFocus = (i: number) => {
    setFocus(i)
    refs.current[i]?.focus()
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>, chip: Chip, i: number) => {
    const on = chosen.includes(chip.key)
    if (e.key === ' ' || e.key === 'Enter') toggle(chip.key)
    else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && on) {
      const by = e.key === 'ArrowLeft' ? -1 : 1
      const next = moved(chosen, chip.key, by)
      onChange(next)
      const j = next.indexOf(chip.key)
      requestAnimationFrame?.(() => refs.current[j]?.focus())
      setFocus(j)
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') moveFocus(Math.max(0, i - 1))
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown')
      moveFocus(Math.min(chips.length - 1, i + 1))
    else if (e.key === 'Home') moveFocus(0)
    else if (e.key === 'End') moveFocus(chips.length - 1)
    else return
    e.preventDefault()
  }
  const onDrop = (e: DragEvent, key: string) => {
    e.preventDefault()
    const from = drag.current
    drag.current = null
    if (!from || from === key || !chosen.includes(key)) return
    const without = chosen.filter((k) => k !== from)
    const j = without.indexOf(key)
    onChange([...without.slice(0, j), from, ...without.slice(j)])
  }

  return (
    <div className="group-chips">
      <div className="group-chips-head">
        <span id={`${id}-label`} className="group-chips-label">
          {label}
        </span>
        {chosen.length === 2 && (
          <button
            type="button"
            className="chip-swap"
            title="Swap the two groups"
            aria-label="Swap the two groups"
            onClick={() => onChange([chosen[1]!, chosen[0]!])}
          >
            ⇄
          </button>
        )}
      </div>
      <div
        className="chips"
        role="listbox"
        aria-multiselectable="true"
        aria-orientation="horizontal"
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-help`}
      >
        {chips.map((c, i) => {
          const on = chosen.includes(c.key)
          const isControl = on && control === c.key
          return (
            <div
              key={c.key}
              ref={(el) => {
                refs.current[i] = el
              }}
              role="option"
              aria-selected={on}
              tabIndex={i === at ? 0 : -1}
              className={`chip${on ? ' on' : ''}${isControl ? ' control' : ''}`}
              draggable={on}
              onDragStart={() => {
                drag.current = c.key
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => onDrop(e, c.key)}
              onFocus={() => setFocus(i)}
              onClick={() => toggle(c.key)}
              onKeyDown={(e) => onKey(e, c, i)}
            >
              {on && <span className="chip-order">{chosen.indexOf(c.key) + 1}</span>}
              <span className="chip-title">{c.title || '(untitled)'}</span>
              {isControl && <span className="chip-badge">control</span>}
              {on && onControl && !isControl && (
                <button
                  type="button"
                  className="chip-control link"
                  tabIndex={-1}
                  title={`Make “${c.title}” the control`}
                  aria-label={`Make “${c.title}” the control`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onControl(c.key)
                  }}
                >
                  ☆
                </button>
              )}
            </div>
          )
        })}
      </div>
      <div id={`${id}-help`} className="help">
        {hint ?? 'Click or press Space to include a group; Alt + ←/→ or drag to reorder.'}
      </div>
      <div className="comparing" aria-live="polite">
        {sentence}
      </div>
    </div>
  )
}
