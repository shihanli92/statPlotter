import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'

/**
 * Fields normally commit on blur / Enter (one undo step per edit). Inside a Format dialog, which
 * edits a draft and commits once on OK, they commit on every valid keystroke instead so the
 * preview follows the typing ("live").
 */
export const LiveFields = createContext(false)

/**
 * Local text for a field showing `value`. It follows outside changes to the value, except while
 * the field has focus in live mode and the text already stands for the value (`same`): there the
 * value is echoing what is being typed, and re-formatting it ("1." → "1") would fight the typing.
 * Audit 3 (U1): a value the text no longer stands for came from outside (an Undo, the format
 * bar) and is taken even while focused; `typed` says whether the text was typed since it was
 * last taken, so a blur commits only what was typed and never writes a stale value back.
 */
function useFieldText(
  value: string,
  live: boolean,
  same: (text: string, value: string) => boolean = (t, v) => t === v,
) {
  const [text, setTextState] = useState(value)
  const current = useRef(value)
  const focused = useRef(false)
  const typed = useRef(false)
  const sameRef = useRef(same)
  sameRef.current = same
  /** Text shown that was not typed (the value, or a revert to it). */
  const setText = (t: string) => {
    typed.current = false
    current.current = t
    setTextState(t)
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: setText and the refs are stable
  useEffect(() => {
    if (live && focused.current && sameRef.current(current.current, value)) return
    setText(value)
  }, [value, live])
  const focusProps = {
    onFocus: () => {
      focused.current = true
    },
    onBlurSync: () => {
      focused.current = false
    },
  }
  /** Text the user typed (a later blur or Enter may commit it). */
  const type = (t: string) => {
    typed.current = true
    current.current = t
    setTextState(t)
  }
  return { text, setText, type, typed, focusProps }
}

/**
 * A labelled field (audit 2, U17: every dialog's and panel's): the label, the control `children`
 * renders with the id it is given, and a hint below it, which describes the control (pass the
 * second argument as its aria-describedby). `className` adds to "field" (a row of controls).
 */
export function Field({
  label,
  children,
  help,
  className,
}: {
  label: ReactNode
  children: (id: string, describedBy: string | undefined) => ReactNode
  help?: ReactNode
  className?: string
}) {
  const id = useId()
  const helpId = help ? `${id}-help` : undefined
  return (
    <div className={className ? `field ${className}` : 'field'}>
      <label htmlFor={id}>{label}</label>
      {children(id, helpId)}
      {help && (
        <div id={helpId} className="help">
          {help}
        </div>
      )}
    </div>
  )
}

/** Shown in place of a value that differs between the items a field edits ("All data sets"). */
const MIXED_TEXT = '—'
const MIXED_VALUE = '\u0000mixed'

/**
 * A labelled select. `mixed`: the items it edits differ, so it shows "—" (not a choice) until one
 * is picked, which then applies to all of them.
 */
export function Select<T extends string | number>({
  label,
  value,
  options,
  onChange,
  mixed = false,
}: {
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (v: T) => void
  mixed?: boolean
}) {
  return (
    <Field label={label}>
      {(id) => (
        <select
          id={id}
          value={mixed ? MIXED_VALUE : String(value)}
          title={mixed ? 'Differs between data sets' : undefined}
          onChange={(e) => {
            const opt = options.find((o) => String(o.value) === e.target.value)
            if (opt) onChange(opt.value)
          }}
        >
          {mixed && (
            <option value={MIXED_VALUE} disabled>
              {MIXED_TEXT} (differs)
            </option>
          )}
          {options.map((o) => (
            <option key={String(o.value)} value={String(o.value)}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  )
}

/**
 * Commits on blur or Enter; reverts on Escape or invalid input. `mixed`: the items it edits
 * differ, so it is blank ("—") until a number is typed, which then applies to all of them.
 */
export function NumberInput({
  label,
  value,
  onChange,
  min,
  max,
  step,
  help,
  mixed = false,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  help?: string
  mixed?: boolean
}) {
  const live = useContext(LiveFields)
  const shown = mixed ? '' : String(value)
  const parse = (t: string) => {
    const v = Number(t)
    return t.trim() === '' ||
      !Number.isFinite(v) ||
      (min !== undefined && v < min) ||
      (max !== undefined && v > max)
      ? null
      : v
  }
  const { text, setText, type, typed, focusProps } = useFieldText(
    shown,
    live,
    (t, s) => t === s || (s !== '' && parse(t) === Number(s)),
  )
  const commit = () => {
    // Nothing typed since the value was last taken: nothing to commit (U1).
    if (!typed.current) return
    const v = parse(text)
    if (v === null) {
      setText(shown)
      return
    }
    if (v !== value || mixed) onChange(v)
  }
  return (
    <Field label={label} help={help}>
      {(id) => (
        <input
          id={id}
          type="number"
          value={text}
          min={min}
          max={max}
          step={step ?? 'any'}
          placeholder={mixed ? MIXED_TEXT : undefined}
          title={mixed ? 'Differs between data sets' : undefined}
          onChange={(e) => {
            type(e.target.value)
            const v = live ? parse(e.target.value) : null
            if (v !== null && (v !== value || mixed)) onChange(v)
          }}
          onFocus={focusProps.onFocus}
          onBlur={() => {
            focusProps.onBlurSync()
            commit()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') setText(shown)
          }}
        />
      )}
    </Field>
  )
}

export function TextInput({
  label,
  value,
  onChange,
  placeholder,
  hideLabel = false,
  attrs,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  /** The label as the input's accessible name only (a field in a table row). */
  hideLabel?: boolean
  /** Data attributes for the input (`data-*`). */
  attrs?: Record<`data-${string}`, string | number>
}) {
  const live = useContext(LiveFields)
  const { text, setText, type, typed, focusProps } = useFieldText(value, live)
  const save = () => {
    if (typed.current && text !== value) onChange(text)
  }
  const input = (id?: string) => (
    <input
      {...attrs}
      id={id}
      aria-label={id ? undefined : label}
      type="text"
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        type(e.target.value)
        if (live && e.target.value !== value) onChange(e.target.value)
      }}
      onFocus={focusProps.onFocus}
      onBlur={() => {
        focusProps.onBlurSync()
        save()
        // Show the value as stored (e.g. a number as it was parsed).
        if (live) setText(value)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') save()
        if (e.key === 'Escape') setText(value)
      }}
    />
  )
  return hideLabel ? input() : <Field label={label}>{(id) => input(id)}</Field>
}

/**
 * A labelled checkbox. `mixed`: the items it edits differ, so it is indeterminate; a click then
 * ticks it for all of them.
 */
export function Checkbox({
  label,
  checked,
  onChange,
  mixed = false,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  mixed?: boolean
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = mixed
  }, [mixed])
  return (
    <label className="check field" title={mixed ? 'Differs between data sets' : undefined}>
      <input
        ref={ref}
        type="checkbox"
        checked={mixed ? false : checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  )
}

/**
 * What a graph shows of a list (its data sets, its rows): the items shown, ticked, in their order
 * (↑ / ↓ move one), then the others. `extra` adds controls before a shown item's arrows.
 */
export function OrderedChecklist<K extends string | number>({
  all,
  shown,
  label,
  noun,
  onChange,
  extra,
}: {
  all: readonly K[]
  shown: readonly K[]
  label: (k: K) => string
  /** What an item is, for the undo labels ("Show row", "Reorder rows"). */
  noun: string
  onChange: (shown: K[], undoLabel: string) => void
  extra?: (k: K) => ReactNode
}) {
  const move = (k: K, by: number) => {
    const next = shown.filter((x) => x !== k)
    next.splice(Math.max(0, Math.min(next.length, shown.indexOf(k) + by)), 0, k)
    onChange(next, `Reorder ${noun}s`)
  }
  return (
    <ul className="dataset-list">
      {[...shown, ...all.filter((k) => !shown.includes(k))].map((k) => {
        const on = shown.includes(k)
        return (
          <li key={k}>
            <label className="check">
              <input
                type="checkbox"
                checked={on}
                onChange={(e) =>
                  onChange(
                    e.target.checked ? [...shown, k] : shown.filter((x) => x !== k),
                    e.target.checked ? `Show ${noun}` : `Hide ${noun}`,
                  )
                }
              />
              {label(k)}
            </label>
            {on && (
              <span className="order">
                {extra?.(k)}
                <button
                  type="button"
                  aria-label={`Move ${label(k)} up`}
                  onClick={() => move(k, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Move ${label(k)} down`}
                  onClick={() => move(k, 1)}
                >
                  ↓
                </button>
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** A bare number box that may be left empty (undefined), for tables of values. */
export function OptionalNumber({
  value,
  onChange,
  label,
  placeholder,
}: {
  value: number | undefined
  onChange: (v: number | undefined) => void
  label: string
  placeholder?: string
}) {
  const [text, setText] = useState(value === undefined ? '' : String(value))
  useEffect(() => {
    setText((t) =>
      t.trim() !== '' && Number(t) === value ? t : value === undefined ? '' : String(value),
    )
  }, [value])
  // Audit 4 (A10): text that isn't a number is marked while typed and reverts when the box is
  // left (as NumberBox): what is shown is always what is used.
  const invalid = text.trim() !== '' && !Number.isFinite(Number(text.trim()))
  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={label}
      placeholder={placeholder}
      value={text}
      aria-invalid={invalid || undefined}
      className={invalid ? 'invalid' : undefined}
      title={invalid ? 'Not a number: leaving the box puts back the last value.' : undefined}
      onChange={(e) => {
        setText(e.target.value)
        const t = e.target.value.trim()
        if (t === '') onChange(undefined)
        else if (Number.isFinite(Number(t))) onChange(Number(t))
      }}
      onBlur={() => {
        if (invalid) setText(value === undefined ? '' : String(value))
      }}
    />
  )
}

/** A dialog's choice of one option: radio buttons under a legend. */
export function RadioGroup<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
}: {
  legend: string
  /** The radio buttons' shared name. */
  name: string
  value: T
  options: readonly { value: T; label: ReactNode; title?: string }[]
  onChange: (v: T) => void
}) {
  return (
    <fieldset className="field radio">
      <legend>{legend}</legend>
      {options.map((o) => (
        <label key={o.value} className="check" title={o.title}>
          <input
            type="radio"
            name={name}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
          />
          {o.label}
        </label>
      ))}
    </fieldset>
  )
}

/** Open/closed state of sections by title, kept while switching between selections. */
const sectionOpen = new Map<string, boolean>()

/** Where the Format places' sections keep their open state (per element kind and title). */
const SECTIONS_KEY = 'ps.formatSections'

function readSections(): Record<string, boolean> {
  try {
    const v = JSON.parse(localStorage.getItem(SECTIONS_KEY) ?? '{}')
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

function writeSection(key: string, open: boolean) {
  try {
    localStorage.setItem(SECTIONS_KEY, JSON.stringify({ ...readSections(), [key]: open }))
  } catch {}
}

/**
 * Roadmap 46 (stage 2): the sections of a Format place. `kind` is the element's kind ('axis',
 * 'series', 'graph'…): a section's open state is remembered per kind and title, across sessions.
 * `collapsed`: sections not saying otherwise start closed (all but Common). `force`: open (the
 * section a click or a search goes to).
 */
export interface SectionScope {
  kind: string
  collapsed?: boolean
  force?: boolean
}

export const SectionScopeContext = createContext<SectionScope | null>(null)

/**
 * Every section shown open (a search over the rendered fields, the completeness test), without
 * changing what is remembered.
 */
export const ExpandSections = createContext(false)

/**
 * Inside a section of a Format place that holds a whole layer's fields (a data set's Symbols, its
 * Bars…), the layer's own sections become plain sub-headings: one level of collapsing. `title` is
 * the holding section's: a sub-section of the same name shows no heading.
 */
const FlatSections = createContext<{ title: string } | null>(null)

/** A layer's rows that need no heading of their own in a data set's section (one field each). */
const PLAIN_SUBSECTIONS = new Set(['Statistic', 'Position'])

/** A collapsible inspector section; `collapsed` sets its initial state. */
export function Section({
  title,
  children,
  collapsed,
}: {
  title: string
  children: ReactNode
  collapsed?: boolean
}) {
  const flat = useContext(FlatSections)
  const scope = useContext(SectionScopeContext)
  const all = useContext(ExpandSections)
  const key = scope ? `${scope.kind}:${title}` : title
  const [open, setOpen] = useState(() => {
    if (scope?.force) return true
    const stored = scope ? readSections()[key] : sectionOpen.get(title)
    return stored ?? !(collapsed ?? scope?.collapsed ?? false)
  })
  // A section asked for while shown (a search's jump) opens.
  useEffect(() => {
    if (scope?.force) setOpen(true)
  }, [scope?.force])
  if (flat)
    return (
      <div className="inspector-subsection">
        {title !== flat.title && !PLAIN_SUBSECTIONS.has(title) && <h4>{title}</h4>}
        {children}
      </div>
    )
  const shown = open || all
  return (
    <section className="inspector-section">
      <h3>
        <button
          type="button"
          className="section-toggle"
          aria-expanded={shown}
          onClick={() => {
            if (scope) writeSection(key, !shown)
            else sectionOpen.set(title, !shown)
            setOpen(!shown)
          }}
        >
          <span className={shown ? 'chevron open' : 'chevron'} aria-hidden />
          {title}
        </button>
      </h3>
      {shown && <FlatSections.Provider value={null}>{children}</FlatSections.Provider>}
    </section>
  )
}

/**
 * A section holding a layer's fields as one block (`title`: the part it draws, "Symbols"): the
 * layer's sections inside show as sub-headings, not sections of their own.
 */
export function GroupSection({
  title,
  children,
  collapsed,
}: {
  title: string
  children: ReactNode
  collapsed?: boolean
}) {
  return (
    <Section title={title} {...(collapsed === undefined ? {} : { collapsed })}>
      <FlatSections.Provider value={{ title }}>{children}</FlatSections.Provider>
    </Section>
  )
}

/**
 * A bare numeric text box that tolerates partial input ("-", "1.", "2e"): the value updates
 * whenever the text is a complete number, and invalid text reverts on blur.
 */
export function NumberBox({
  value,
  onChange,
  ...rest
}: {
  value: number
  onChange: (v: number) => void
  id?: string
  min?: number
  max?: number
  'aria-label'?: string
  /** The hint describing it (a `Field`'s). */
  'aria-describedby'?: string
}) {
  const [text, setText] = useState(String(value))
  useEffect(() => {
    setText((t) => (Number(t) === value && t.trim() !== '' ? t : String(value)))
  }, [value])
  const parse = (t: string) => {
    const v = t.trim() === '' ? Number.NaN : Number(t)
    const inRange =
      (rest.min === undefined || v >= rest.min) && (rest.max === undefined || v <= rest.max)
    return Number.isFinite(v) && inRange ? v : null
  }
  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      value={text}
      onChange={(e) => {
        setText(e.target.value)
        const v = parse(e.target.value)
        if (v !== null && v !== value) onChange(v)
      }}
      onBlur={() => {
        if (parse(text) === null) setText(String(value))
      }}
    />
  )
}

/**
 * A colour picker that commits once, when the picker closes (the native `change` event), not on
 * every movement while dragging — so one colour choice is one undo step. In live mode (a Format
 * dialog's draft) it commits as it moves.
 */
export function ColorInput({
  value,
  onCommit,
  onDone,
  id,
  label,
}: {
  value: string
  onCommit: (rgb: string) => void
  /** The picker closed on a colour (its `change`): the colour chosen in the end. */
  onDone?: (rgb: string) => void
  id?: string
  /** Its accessible name, when no label names it. */
  label?: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  const commit = useRef(onCommit)
  commit.current = onCommit
  const done = useRef(onDone)
  done.current = onDone
  const live = useContext(LiveFields)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onChange = () => commit.current(el.value)
    const onEnd = () => done.current?.(el.value)
    // Live (in a Format dialog): follow the picker as it moves, for the preview.
    const event = live ? 'input' : 'change'
    el.addEventListener(event, onChange)
    el.addEventListener('change', onEnd)
    return () => {
      el.removeEventListener(event, onChange)
      el.removeEventListener('change', onEnd)
    }
  }, [live])
  // Uncontrolled while open; follow outside changes (undo, another selection).
  useEffect(() => {
    if (ref.current && ref.current.value !== value) ref.current.value = value
  }, [value])
  return <input ref={ref} id={id} aria-label={label} type="color" defaultValue={value} />
}
