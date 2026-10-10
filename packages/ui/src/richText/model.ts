import {
  type ColorRef,
  type FontId,
  mergeRuns,
  type RichText,
  richPlain,
  sameColor,
  type TextAlign,
  type TextRun,
} from '@ps/model'

// The rich text editor's model (roadmap 28): the text is runs, positions are offsets into its
// plain text (a line break is one character). Pure functions, so the editing logic is tested
// without a browser; the component only maps these to and from the DOM.

/** The formats the editor sets. */
export type Format = 'bold' | 'italic' | 'underline' | 'sup' | 'sub'
const FORMATS: readonly Format[] = ['bold', 'italic', 'underline', 'sup', 'sub']

/** A run's formatting (everything but its text). */
export type Style = Omit<TextRun, 'text'>

/** A selection: `anchor` where it started, `focus` where the caret is. */
export interface Selection {
  anchor: number
  focus: number
}

export const selStart = (s: Selection) => Math.min(s.anchor, s.focus)
export const selEnd = (s: Selection) => Math.max(s.anchor, s.focus)
export const collapsed = (at: number): Selection => ({ anchor: at, focus: at })

const styleOf = ({ text: _, ...style }: TextRun): Style => style

/**
 * The formats runs inherit from their element (roadmap 28b): its style's bold and italic. A run
 * stores a format only where it differs, so `bold: false` is "not bold" in a bold element.
 */
export type BaseFormats = Partial<Record<Format, boolean>>

/** Whether a style has a format on: its own value, else the element's. */
export const hasFormat = (s: Style, f: Format, base: BaseFormats = {}): boolean =>
  (s[f] ?? base[f]) === true

/**
 * Sets one format on or off, stored only where it differs from the element's (`base`): off in a
 * bold element is `bold: false`, on is no value. Superscript and subscript exclude each other.
 */
export function withFormat(s: Style, f: Format, on: boolean, base: BaseFormats = {}): Style {
  const out: Style = { ...s }
  delete out[f]
  if (on && f === 'sup') delete out.sub
  if (on && f === 'sub') delete out.sup
  if (on !== !!base[f]) out[f] = on
  return out
}

/** The runs covering [start, end), split at the ends. */
export function sliceRuns(runs: RichText, start: number, end: number): RichText {
  const out: TextRun[] = []
  let at = 0
  for (const r of runs) {
    const a = Math.max(start, at)
    const b = Math.min(end, at + r.text.length)
    if (a < b) out.push({ ...r, text: r.text.slice(a - at, b - at) })
    at += r.text.length
  }
  return out
}

/** The style typing at `at` continues: the character before, or after at a line's start. */
export function styleAt(runs: RichText, at: number): Style {
  const plain = richPlain(runs)
  const before = at > 0 && plain[at - 1] !== '\n'
  const k = before ? at - 1 : at < plain.length ? at : at - 1
  if (k < 0) return {}
  const [r] = sliceRuns(runs, k, k + 1)
  return r ? styleOf(r) : {}
}

/** Runs with [start, end) replaced by `insert`. */
export function replaceRange(
  runs: RichText,
  start: number,
  end: number,
  insert: RichText,
): RichText {
  const len = richPlain(runs).length
  return mergeRuns([...sliceRuns(runs, 0, start), ...insert, ...sliceRuns(runs, end, len)])
}

/** Text typed over [start, end): in `style`, else the replaced text's first style, else `styleAt`. */
export function typeText(
  runs: RichText,
  start: number,
  end: number,
  text: string,
  style?: Style | null,
): RichText {
  const first = start < end ? sliceRuns(runs, start, start + 1)[0] : undefined
  const s = style ?? (first ? styleOf(first) : styleAt(runs, start))
  return replaceRange(runs, start, end, [{ ...s, text }])
}

/** The styles of a selection's characters, or (at a caret) the style typing would continue. */
export function selectionStyles(runs: RichText, sel: Selection): Style[] {
  const [a, b] = [selStart(sel), selEnd(sel)]
  const parts = a < b ? sliceRuns(runs, a, b).filter((r) => r.text !== '') : []
  return parts.length ? parts.map(styleOf) : [styleAt(runs, a)]
}

/** Which formats the selection has, for the toolbar: every character of it has it. */
export function formatsAt(
  runs: RichText,
  sel: Selection,
  base: BaseFormats = {},
): Record<Format, boolean> {
  return formatsOf(selectionStyles(runs, sel), base)
}

export const formatsOf = (styles: readonly Style[], base: BaseFormats = {}) =>
  Object.fromEntries(FORMATS.map((f) => [f, styles.every((s) => hasFormat(s, f, base))])) as Record<
    Format,
    boolean
  >

/** Runs with each run's style over [start, end) changed by `f`. */
export function restyle(
  runs: RichText,
  start: number,
  end: number,
  f: (s: Style) => Style,
): RichText {
  if (start >= end) return runs
  const middle = sliceRuns(runs, start, end).map((r) => ({ ...f(styleOf(r)), text: r.text }))
  return replaceRange(runs, start, end, middle)
}

/** Runs without bold or italic values the element has anyway (pasted `<b>` in a bold title). */
export const inheritFormats = (runs: RichText, base: BaseFormats): RichText =>
  mergeRuns(
    runs.map((r) => {
      const out = { ...r }
      for (const f of ['bold', 'italic'] as const) if (out[f] === !!base[f]) delete out[f]
      return out
    }),
  )

/**
 * Toggles a format over [start, end): off when every character has it (its own or the element's),
 * else on for all.
 */
export function toggleFormat(
  runs: RichText,
  start: number,
  end: number,
  f: Format,
  base: BaseFormats = {},
): RichText {
  if (start >= end) return runs
  const on = !formatsAt(runs, { anchor: start, focus: end }, base)[f]
  return restyle(runs, start, end, (s) => withFormat(s, f, on, base))
}

// ---- Font, size and colour (roadmap 28b) -------------------------------------------------------

/** What the toolbar sets on runs besides the formats: absent = the element's own. */
export interface RunValues {
  font?: FontId
  size?: number
  color?: ColorRef
}

/** A style with some of its font, size and colour set (an `undefined` clears it). */
export function withValues(s: Style, v: RunValues): Style {
  const out: Style = { ...s }
  for (const k of ['font', 'size', 'color'] as const) {
    if (!(k in v)) continue
    if (v[k] === undefined) delete out[k]
    else (out as RunValues)[k] = v[k] as never
  }
  return out
}

/** Sets (or, with `undefined`, clears) the font, size or colour of [start, end). */
export const applyValues = (runs: RichText, start: number, end: number, v: RunValues) =>
  restyle(runs, start, end, (s) => withValues(s, v))

/** The size box's list, which grow and shrink step through (beyond 72: tens, as Word does). */
export const FONT_SIZES: readonly number[] = [
  6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72,
]
const MIN_FONT_SIZE = 1
const MAX_FONT_SIZE = 400

/** A typed size: to the half point, within the limits; null when not a number. */
export function cleanSize(v: number): number | null {
  if (!Number.isFinite(v) || v <= 0) return null
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(v * 2) / 2))
}

/** The next size up (`dir` 1) or down (-1) from `size`. */
export function stepSize(size: number, dir: 1 | -1): number {
  if (dir > 0) {
    const next = FONT_SIZES.find((s) => s > size) ?? Math.floor(size / 10) * 10 + 10
    return Math.min(MAX_FONT_SIZE, next)
  }
  const prev =
    size > (FONT_SIZES.at(-1) as number)
      ? Math.max(FONT_SIZES.at(-1) as number, Math.ceil(size / 10) * 10 - 10)
      : ([...FONT_SIZES].reverse().find((s) => s < size) ?? Math.ceil(size) - 1)
  return Math.max(MIN_FONT_SIZE, prev)
}

/** The fields of a run an element's style also has. */
export type RunField = 'font' | 'size' | 'color' | 'bold' | 'italic'

/**
 * Runs with these fields taken out (the element's style then shows through): roadmap 45's
 * whole-element changes. The same runs when none has them.
 */
export function clearRunFields(runs: RichText, fields: readonly RunField[]): RichText {
  if (!runs.some((r) => fields.some((f) => r[f] !== undefined))) return runs
  return mergeRuns(
    runs.map((r) => {
      const out = { ...r }
      for (const f of fields) delete out[f]
      return out
    }),
  )
}

/** Removes every run-level format from [start, end): it shows in the element's style. */
export const clearFormatting = (runs: RichText, start: number, end: number) =>
  restyle(runs, start, end, () => ({}))

/**
 * The selection's font, size and colour for the toolbar, over the element's `base`: the value
 * every character has, else null (mixed, shown blank). A colour is undefined when automatic.
 */
export function valuesOf(
  styles: readonly Style[],
  base: { font: FontId; size: number },
): { font: FontId | null; size: number | null; color: ColorRef | undefined | null } {
  const same = <T>(vs: T[], eq: (a: T, b: T) => boolean = (a, b) => a === b) =>
    vs.every((v) => eq(v, vs[0] as T)) ? (vs[0] as T) : null
  return {
    font: same(styles.map((s) => s.font ?? base.font)),
    size: same(styles.map((s) => s.size ?? base.size)),
    color: same(
      styles.map((s) => s.color),
      sameColor,
    ),
  }
}

/**
 * The runs after the editable's text changed from `runs`' text to `text` (typing, deleting, IME,
 * spelling fixes): the changed span is found by the common prefix and suffix, the suffix kept
 * after `caret` (where the caret is now, which settles repeated letters). Inserted text takes
 * `style` (a format chosen at the caret before typing), else continues its neighbour's; the
 * formatting always comes from the model, never from the browser's markup.
 */
export function applyTextChange(
  runs: RichText,
  text: string,
  caret: number,
  style?: Style | null,
): RichText {
  const old = richPlain(runs)
  if (old === text) return runs
  let suffix = 0
  const maxSuffix = Math.min(old.length, text.length - Math.min(caret, text.length))
  while (suffix < maxSuffix && old[old.length - 1 - suffix] === text[text.length - 1 - suffix])
    suffix++
  let prefix = 0
  const maxPrefix = Math.min(old.length, text.length) - suffix
  while (prefix < maxPrefix && old[prefix] === text[prefix]) prefix++
  const inserted = text.slice(prefix, text.length - suffix)
  const end = old.length - suffix
  return inserted
    ? typeText(runs, prefix, end, inserted, style)
    : replaceRange(runs, prefix, end, [])
}

/** Runs without line breaks (single-line fields): each break becomes a space. */
export const singleLine = (runs: RichText): RichText =>
  runs.some((r) => r.text.includes('\n'))
    ? mergeRuns(runs.map((r) => ({ ...r, text: r.text.replace(/\r?\n/g, ' ') })))
    : runs

/** Runs without leading and trailing whitespace (titles are stored trimmed). */
export function trimRuns(runs: RichText): RichText {
  const plain = richPlain(runs)
  const start = plain.length - plain.trimStart().length
  const end = plain.trimEnd().length
  return start === 0 && end === plain.length ? runs : sliceRuns(runs, start, Math.max(start, end))
}

/** Whether two rich texts are the same text in the same formats. */
export const sameRichText = (a: RichText, b: RichText): boolean => {
  const [x, y] = [mergeRuns(a), mergeRuns(b)]
  return x.length === y.length && x.every((r, i) => JSON.stringify(r) === JSON.stringify(y[i]))
}

/** A snapshot of the editor for its own undo history. */
export interface Snapshot {
  runs: RichText
  sel: Selection
  /** A text box's line alignment, where the editor sets it. */
  align?: TextAlign
}

/**
 * The editor's undo history while it is open (the document gets one command when it commits):
 * typing within `mergeMs` of the last typing edit extends that step.
 */
export class EditHistory {
  private steps: Snapshot[]
  private index = 0
  private lastTyping = -Infinity

  constructor(initial: Snapshot) {
    this.steps = [initial]
  }

  push(s: Snapshot, typing: boolean, now: number, mergeMs = 1000): void {
    const merge = typing && now - this.lastTyping < mergeMs && this.index > 0
    this.steps = this.steps.slice(0, this.index + (merge ? 0 : 1))
    this.steps.push(s)
    this.index = this.steps.length - 1
    this.lastTyping = typing ? now : -Infinity
  }

  undo(): Snapshot | null {
    if (this.index === 0) return null
    this.lastTyping = -Infinity
    return this.steps[--this.index]!
  }

  redo(): Snapshot | null {
    if (this.index >= this.steps.length - 1) return null
    this.lastTyping = -Infinity
    return this.steps[++this.index]!
  }
}
