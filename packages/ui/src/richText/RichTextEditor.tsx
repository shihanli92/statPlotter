import { DEFAULT_THEME, FONT_STACKS, resolveColor } from '@ps/graph'
import {
  type ColorRef,
  type FontId,
  type RichText,
  richPlain,
  type TextAlign,
  type TextStyle,
} from '@ps/model'
import {
  type CSSProperties,
  createContext,
  type KeyboardEvent,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { isMacPlatform } from '../commands/shortcut.ts'
import { ServicesContext } from '../context.tsx'
import {
  cssColor,
  type DomNode,
  editableText,
  htmlRuns,
  offsetOf,
  pointAt,
  type RunView,
  runsToHtml,
} from './dom.ts'
import {
  applyTextChange,
  applyValues,
  type BaseFormats,
  clearFormatting,
  clearRunFields,
  collapsed,
  EditHistory,
  type Format,
  formatsOf,
  hasFormat,
  inheritFormats,
  type RunValues,
  replaceRange,
  restyle,
  type Selection,
  type Snapshot,
  type Style,
  sameRichText,
  selEnd,
  selectionStyles,
  selStart,
  singleLine,
  sliceRuns,
  stepSize,
  styleAt,
  toggleFormat,
  typeText,
  valuesOf,
  withFormat,
  withValues,
} from './model.ts'
import { Toolbar } from './Toolbar.tsx'

// The one rich text editor (roadmap 28): a contenteditable whose state is RichText runs. The
// browser only edits the text; every edit is read back as plain text and caret, turned into runs
// by the model (applyTextChange), and the markup rewritten from the runs when the browser's
// differs. Formatting comes from the toolbar, shortcuts and pasted HTML, never from the browser's
// own commands, so Chromium, WebKit and Firefox give the same runs. Typing is literal.

interface RichTextEditorProps {
  value: RichText
  /** Accessible name (the editable is a textbox). */
  label?: string
  /** Id of an element naming the editor, instead of `label`. */
  labelledBy?: string
  /** Line breaks allowed (Shift+Enter); otherwise the text is one line. */
  multiline?: boolean
  /** Every edit, as it happens. */
  onChange?: (runs: RichText) => void
  /** Enter, or focus leaving the editor (with the alignment, where the editor sets it). */
  onCommit?: (runs: RichText, align?: TextAlign) => void
  /** Escape. */
  onCancel?: () => void
  /** An editor opened for one edit: it commits or cancels once, then ignores its blur. */
  once?: boolean
  autoFocus?: boolean
  /** On focus: select everything (else the caret goes to the end). */
  selectAll?: boolean
  /** Runs first; a handler that calls preventDefault takes the key from the editor. */
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void
  /** Pasted plain text, first: return true to take it (e.g. several table cells). */
  onPasteText?: (text: string) => boolean
  className?: string
  style?: CSSProperties
  placeholder?: string
  id?: string
  /**
   * The element's resolved text style: the text shows in its font, weight, slant and colour (the
   * host sets the font size), runs' own values over it; the toolbar reads formats against it, and
   * sizes show relative to it. Absent: plain 12 pt sans in the field's own look (grid titles).
   */
  textStyle?: Pick<TextStyle, 'font' | 'size'> &
    Partial<Pick<TextStyle, 'color' | 'bold' | 'italic'>>
  /** The palette colour references resolve against (default: the theme's). */
  palette?: readonly string[]
  /** Runs' sizes shown in the text (grid titles show them at the grid's size). */
  showSizes?: boolean
  /** A text box's line alignment: the toolbar gets alignment buttons. */
  align?: TextAlign
  /** Alignment chosen in the toolbar, as it happens (a Format dialog's live preview). */
  onAlign?: (a: TextAlign) => void
  /**
   * Roadmap 45: font, size or colour chosen with the whole text selected sets the element's
   * style (as the format bar does; the field leaves the runs); a part selected still gets runs.
   * Absent: runs always (decision 153).
   */
  onStyle?: (patch: ElementStylePatch) => void
}

/** What the editor sets on the element's style with its whole text selected. */
export type ElementStylePatch = { font?: FontId; size?: number; color?: ColorRef | undefined }

/**
 * Roadmap 45: where an in-place editor puts its toolbar — the format bar's dock (run mode)
 * instead of floating over the canvas. Absent (undefined): it floats, as in the Format dialogs'
 * fields; null: docked, the dock not there yet.
 */
export const EditorDock = createContext<HTMLElement | null | undefined>(undefined)

const DEFAULT_STYLE: NonNullable<RichTextEditorProps['textStyle']> = { font: 'sans', size: 12 }

const dom = (n: Node) => n as unknown as DomNode

/** The format shortcut a key press is, if any (Mod+B / I / U, Mod+= subscript, Mod+Shift+= superscript). */
function formatKey(e: KeyboardEvent, mac: boolean): Format | null {
  if (!(mac ? e.metaKey : e.ctrlKey) || e.altKey) return null
  const k = e.key.toLowerCase()
  if (e.code === 'Equal' || k === '=' || k === '+') return e.shiftKey || k === '+' ? 'sup' : 'sub'
  if (e.shiftKey) return null
  return k === 'b' ? 'bold' : k === 'i' ? 'italic' : k === 'u' ? 'underline' : null
}

/** Mod+Shift+> grows the font a step, Mod+Shift+< shrinks it (as in Word). */
function stepKey(e: KeyboardEvent, mac: boolean): 1 | -1 | null {
  if (!(mac ? e.metaKey : e.ctrlKey) || e.altKey || !e.shiftKey) return null
  if (e.code === 'Period' || e.key === '>') return 1
  if (e.code === 'Comma' || e.key === '<') return -1
  return null
}

export function RichTextEditor(props: RichTextEditorProps) {
  const { value, multiline = false, className, style, placeholder, id } = props
  const base = props.textStyle ?? DEFAULT_STYLE
  const baseFormats: BaseFormats = { bold: !!base.bold, italic: !!base.italic }
  const palette = props.palette ?? DEFAULT_THEME.palette
  const view: RunView = { palette, ...(props.showSizes === false ? {} : { size: base.size }) }
  const ref = useRef<HTMLDivElement>(null)
  const wrap = useRef<HTMLSpanElement>(null)
  const bar = useRef<HTMLDivElement>(null)
  const model = useRef<Snapshot>({
    runs: multiline ? value : singleLine(value),
    sel: collapsed(richPlain(value).length),
    ...(props.align ? { align: props.align } : {}),
  })
  const history = useRef(new EditHistory(model.current))
  // A format chosen with the caret alone: what typing there is formatted with.
  const pending = useRef<{ style: Style; at: number } | null>(null)
  const composing = useRef(false)
  const done = useRef(false)
  const latest = useRef(props)
  latest.current = props
  const [focused, setFocused] = useState(false)
  const [, setVersion] = useState(0)
  const [place, setPlace] = useState<{ top: number; left: number; up: boolean } | null>(null)
  const mac = isMacPlatform()
  const refresh = () => setVersion((v) => v + 1)
  const dock = useContext(EditorDock)
  const services = useContext(ServicesContext)

  const readSel = (): Selection | null => {
    const el = ref.current
    const s = typeof window === 'undefined' ? null : window.getSelection()
    if (!el || !s?.anchorNode || !s.focusNode || !el.contains(s.anchorNode)) return null
    return {
      anchor: offsetOf(dom(el), dom(s.anchorNode), s.anchorOffset),
      focus: offsetOf(dom(el), dom(s.focusNode), s.focusOffset),
    }
  }
  const writeSel = (sel: Selection) => {
    const el = ref.current
    const s = window.getSelection()
    if (!el || !s || document.activeElement !== el) return
    const a = pointAt(dom(el), sel.anchor)
    const f = pointAt(dom(el), sel.focus)
    s.setBaseAndExtent(a.node as unknown as Node, a.offset, f.node as unknown as Node, f.offset)
  }
  const render = () => {
    const el = ref.current
    if (el) el.innerHTML = runsToHtml(model.current.runs, view)
  }

  /** A new state: markup rewritten when `rewrite`, caret placed, history kept, parent told. */
  const apply = (runs: RichText, sel: Selection, how: { rewrite: boolean; typing?: boolean }) => {
    model.current = { ...model.current, runs, sel }
    if (how.rewrite) {
      render()
      writeSel(sel)
    }
    history.current.push(model.current, !!how.typing, performance.now())
    refresh()
    latest.current.onChange?.(runs)
  }

  const currentSel = () => readSel() ?? model.current.sel

  // ---- Edits ------------------------------------------------------------------------------------

  const onInput = () => {
    const el = ref.current
    if (!el || composing.current) return
    let text = editableText(dom(el))
    if (!multiline) text = text.replace(/\n/g, ' ')
    const sel = readSel() ?? collapsed(text.length)
    const p = pending.current
    const runs = applyTextChange(model.current.runs, text, sel.focus, p?.style)
    if (runs === model.current.runs) return
    pending.current = null
    apply(runs, sel, { rewrite: el.innerHTML !== runsToHtml(runs, view), typing: true })
  }

  /**
   * Formats the selection: `range` over a range; at a caret `caret` sets the format the next
   * typing takes (as Word does).
   */
  const format = (
    range: (runs: RichText, a: number, b: number) => RichText,
    caret: (s: Style) => Style,
  ) => {
    const sel = currentSel()
    const [a, b] = [selStart(sel), selEnd(sel)]
    const { runs } = model.current
    if (a === b) {
      const p = pending.current?.at === a ? pending.current.style : styleAt(runs, a)
      pending.current = { style: caret(p), at: a }
      refresh()
      return
    }
    apply(range(runs, a, b), sel, { rewrite: true })
  }
  const toggle = (f: Format) =>
    format(
      (runs, a, b) => toggleFormat(runs, a, b, f, baseFormats),
      (p) => withFormat(p, f, !hasFormat(p, f, baseFormats), baseFormats),
    )
  const setValues = (v: RunValues) =>
    format(
      (runs, a, b) => applyValues(runs, a, b, v),
      (p) => withValues(p, v),
    )
  const step = (dir: 1 | -1) => {
    const grow = (s: Style) => withValues(s, { size: stepSize(s.size ?? base.size, dir) })
    format((runs, a, b) => restyle(runs, a, b, grow), grow)
  }
  const clear = () => format(clearFormatting, () => ({}))
  /** The whole text is selected (as it opens): font, size and colour go to the element. */
  const wholeSelected = () => {
    const sel = currentSel()
    const n = richPlain(model.current.runs).length
    return n > 0 && selStart(sel) === 0 && selEnd(sel) === n
  }
  const styleWhole = (patch: ElementStylePatch) => {
    latest.current.onStyle?.(patch)
    const runs = clearRunFields(
      model.current.runs,
      Object.keys(patch) as (keyof ElementStylePatch)[],
    )
    if (runs !== model.current.runs) apply(runs, currentSel(), { rewrite: true })
  }
  const toElement = () => !!latest.current.onStyle && wholeSelected()
  const chooseFont = (font: FontId) => {
    // The family's files start loading now: the drawing waits for them (decision 781).
    if (services && !services.fonts.has(font)) void services.fonts.ensure([font]).catch(() => {})
    if (toElement()) styleWhole({ font })
    else setValues({ font: font === base.font ? undefined : font })
  }
  const chooseSize = (size: number) => {
    if (toElement()) styleWhole({ size })
    else setValues({ size: size === base.size ? undefined : size })
  }
  const chooseColor = (color: ColorRef | undefined) => {
    if (toElement()) styleWhole({ color })
    else setValues({ color })
  }
  const stepAll = (dir: 1 | -1) => {
    if (!toElement()) return step(dir)
    const sizes = selectionStyles(model.current.runs, currentSel()).map((s) => s.size ?? base.size)
    styleWhole({ size: stepSize(Math.max(...sizes), dir) })
  }
  const setAlign = (align: TextAlign) => {
    if (model.current.align === align) return
    model.current = { ...model.current, align }
    history.current.push(model.current, false, performance.now())
    refresh()
    latest.current.onAlign?.(align)
  }

  const insert = (text: string) => {
    const sel = currentSel()
    const [a, b] = [selStart(sel), selEnd(sel)]
    const p = pending.current?.at === a ? pending.current.style : null
    pending.current = null
    apply(typeText(model.current.runs, a, b, text, p), collapsed(a + text.length), {
      rewrite: true,
    })
  }

  const restore = (snap: Snapshot | null) => {
    if (!snap) return
    const align = model.current.align
    model.current = snap
    pending.current = null
    render()
    writeSel(snap.sel)
    refresh()
    latest.current.onChange?.(snap.runs)
    if (snap.align && snap.align !== align) latest.current.onAlign?.(snap.align)
  }

  const commit = () => {
    if (props.once && done.current) return
    done.current = true
    latest.current.onCommit?.(model.current.runs, model.current.align)
  }

  // ---- Browser events ---------------------------------------------------------------------------

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    props.onKeyDown?.(e)
    if (e.defaultPrevented) return
    // Editing keys are the text's, not the views' around it (a layout page nudges items with the
    // arrows and deletes them with Backspace); Enter, Escape and Tab still reach dialogs and grids.
    if (!['Enter', 'Escape', 'Tab'].includes(e.key)) e.stopPropagation()
    if (composing.current || e.nativeEvent.isComposing || e.keyCode === 229) return
    const take = () => {
      e.preventDefault()
      e.stopPropagation()
    }
    const f = formatKey(e, mac)
    if (f) {
      take()
      toggle(f)
      return
    }
    const dir = stepKey(e, mac)
    if (dir) {
      take()
      stepAll(dir)
      return
    }
    const mod = mac ? e.metaKey : e.ctrlKey
    const k = e.key.toLowerCase()
    if (mod && !e.altKey && (k === 'z' || (k === 'y' && !mac))) {
      take()
      restore(k === 'z' && !e.shiftKey ? history.current.undo() : history.current.redo())
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (multiline && e.shiftKey) {
        e.stopPropagation()
        insert('\n')
      } else if (props.onCommit) {
        e.stopPropagation()
        commit()
      }
      return
    }
    if (e.key === 'Escape' && props.onCancel) {
      take()
      done.current = true
      props.onCancel()
    }
  }

  // Formatting, history, line breaks and drops the browser would do itself are ours.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onBeforeInput = (e: InputEvent) => {
      const t = e.inputType
      if (t === 'insertParagraph' || t === 'insertLineBreak') {
        e.preventDefault()
        if (multiline) insert('\n')
      } else if (t.startsWith('format')) {
        e.preventDefault()
        const f: Record<string, Format> = {
          formatBold: 'bold',
          formatItalic: 'italic',
          formatUnderline: 'underline',
          formatSuperscript: 'sup',
          formatSubscript: 'sub',
        }
        if (f[t]) toggle(f[t])
      } else if (t === 'historyUndo' || t === 'historyRedo') {
        e.preventDefault()
        restore(t === 'historyUndo' ? history.current.undo() : history.current.redo())
      } else if (t === 'insertFromDrop' || t === 'deleteByDrag') e.preventDefault()
    }
    el.addEventListener('beforeinput', onBeforeInput)
    return () => el.removeEventListener('beforeinput', onBeforeInput)
  })

  const onPaste = (e: React.ClipboardEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const plain = e.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n')
    if (props.onPasteText?.(plain)) return
    const html = e.clipboardData.getData('text/html')
    let runs: RichText = []
    if (html) {
      const doc = new DOMParser().parseFromString(html, 'text/html')
      runs = inheritFormats(
        htmlRuns(dom(doc.body), !!doc.querySelector('[data-ps-rich]')),
        baseFormats,
      )
    }
    const sel = currentSel()
    const [a, b] = [selStart(sel), selEnd(sel)]
    if (!runs.length) {
      // Plain text: formatted like typing there.
      const text = plain.replace(/\n+$/, '')
      if (!text) return
      const p = pending.current?.at === a ? pending.current.style : null
      runs = sliceRuns(typeText(model.current.runs, a, b, text, p), a, a + text.length)
    }
    if (!multiline) runs = singleLine(runs)
    pending.current = null
    const n = richPlain(runs).length
    apply(replaceRange(model.current.runs, a, b, runs), collapsed(a + n), { rewrite: true })
  }

  const onCopy = (e: React.ClipboardEvent, cut: boolean) => {
    const sel = currentSel()
    const [a, b] = [selStart(sel), selEnd(sel)]
    e.stopPropagation()
    if (a === b) return
    e.preventDefault()
    const part = sliceRuns(model.current.runs, a, b)
    e.clipboardData.setData('text/plain', richPlain(part))
    e.clipboardData.setData('text/html', `<span data-ps-rich="1">${runsToHtml(part, view)}</span>`)
    if (cut) apply(replaceRange(model.current.runs, a, b, []), collapsed(a), { rewrite: true })
  }

  // ---- Focus, selection and outside changes -------------------------------------------------

  // biome-ignore lint/correctness/useExhaustiveDependencies: the markup is written once here
  useLayoutEffect(() => {
    render()
    if (props.autoFocus) {
      ref.current?.focus()
      placeCaret()
    }
  }, [])

  const placeCaret = () => {
    const n = richPlain(model.current.runs).length
    const sel = props.selectAll ? { anchor: 0, focus: n } : collapsed(n)
    model.current = { ...model.current, sel }
    history.current = new EditHistory(model.current)
    writeSel(sel)
  }

  // A value changed from outside (undo, Reset, another field). While being edited, only a value
  // whose text changed and is not what the editor holds (its own edit echoed back, in a live
  // field) — an Undo or the format bar: audit 3 (U1), else a blur would write the stale text back.
  const seen = useRef(value)
  // biome-ignore lint/correctness/useExhaustiveDependencies: render and refresh read refs only
  useEffect(() => {
    const changed = !sameRichText(value, seen.current)
    seen.current = value
    if (focused && !changed) return
    const runs = multiline ? value : singleLine(value)
    if (sameRichText(runs, model.current.runs)) return
    const n = richPlain(runs).length
    const sel = focused
      ? {
          anchor: Math.min(model.current.sel.anchor, n),
          focus: Math.min(model.current.sel.focus, n),
        }
      : collapsed(n)
    model.current = { ...model.current, runs, sel }
    pending.current = null
    history.current = new EditHistory(model.current)
    render()
    if (focused) writeSel(sel)
    refresh()
  }, [value, focused, multiline])

  // An alignment changed from outside while not being edited.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh reads refs only
  useEffect(() => {
    if (focused || !props.align || props.align === model.current.align) return
    model.current = { ...model.current, align: props.align }
    refresh()
  }, [props.align, focused])

  // biome-ignore lint/correctness/useExhaustiveDependencies: readSel and refresh read refs only
  useEffect(() => {
    if (!focused) return
    const onSelection = () => {
      const sel = readSel()
      if (!sel) return
      if (pending.current && (sel.focus !== pending.current.at || sel.anchor !== sel.focus))
        pending.current = null
      const old = model.current.sel
      if (old.anchor === sel.anchor && old.focus === sel.focus) return
      model.current = { ...model.current, sel }
      refresh()
    }
    // The toolbar floats above the editor (below when there is no room), fixed to the viewport
    // so no scrolling box or dialog clips it, and kept inside it; its menus open upwards in the
    // lower half of the window.
    const measure = () => {
      const r = ref.current?.getBoundingClientRect()
      if (!r) return
      const h = bar.current?.offsetHeight ?? 58
      const w = bar.current?.offsetWidth ?? 260
      const top = r.top - h - 4 >= 0 ? r.top - h - 4 : r.bottom + 4
      const left = Math.max(4, Math.min(r.left, window.innerWidth - w - 4))
      const up = top > window.innerHeight / 2
      setPlace((p) =>
        p && p.top === top && p.left === left && p.up === up ? p : { top, left, up },
      )
    }
    measure()
    // Again once the toolbar is drawn and its size known.
    const frame = requestAnimationFrame(measure)
    document.addEventListener('selectionchange', onSelection)
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    const ro = new ResizeObserver(measure)
    if (ref.current) ro.observe(ref.current)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('selectionchange', onSelection)
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
      ro.disconnect()
    }
  }, [focused])

  const { runs, sel, align } = model.current
  const p = pending.current
  const styles =
    p && p.at === selStart(sel) && sel.anchor === sel.focus ? [p.style] : selectionStyles(runs, sel)
  const values = valuesOf(styles, base)
  const autoColor = resolveColor(base.color ?? { rgb: '#000000' }, palette)
  // The element's look (the host sets the size); runs' own markup overrides it.
  const look: CSSProperties | undefined = props.textStyle && {
    fontFamily: FONT_STACKS[base.font],
    fontWeight: base.bold ? 700 : 400,
    fontStyle: base.italic ? 'italic' : 'normal',
    color: autoColor,
  }
  const shownStyle = { ...look, ...style, ...(props.align ? { textAlign: align ?? 'left' } : {}) }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: tracks focus leaving editor and toolbar
    <span
      ref={wrap}
      className="rt-wrap"
      onBlur={(e) => {
        const to = e.relatedTarget as Node | null
        // Its toolbar may be docked in the format bar (a portal): still the editor's.
        if (wrap.current?.contains(to) || bar.current?.contains(to)) return
        setFocused(false)
        commit()
      }}
    >
      {/* biome-ignore lint/a11y/useSemanticElements: a rich textbox has no semantic element */}
      <div
        ref={ref}
        id={id}
        role="textbox"
        tabIndex={0}
        contentEditable
        suppressContentEditableWarning
        spellCheck
        aria-label={props.labelledBy ? undefined : props.label}
        aria-labelledby={props.labelledBy}
        aria-multiline={multiline}
        data-placeholder={placeholder}
        className={`rt-editor ${multiline ? 'multiline' : 'single'} ${className ?? ''}`}
        style={shownStyle}
        onInput={onInput}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onCopy={(e) => onCopy(e, false)}
        onCut={(e) => onCopy(e, true)}
        onDrop={(e) => e.preventDefault()}
        onFocus={() => setFocused(true)}
        onCompositionStart={() => {
          composing.current = true
        }}
        onCompositionEnd={() => {
          composing.current = false
          onInput()
        }}
      />
      {focused &&
        (dock === undefined ? place : dock) &&
        (() => {
          const toolbar = (
            <Toolbar
              mac={mac}
              formats={formatsOf(styles, baseFormats)}
              font={values.font}
              size={values.size}
              color={values.color}
              autoColor={autoColor}
              palette={palette}
              align={props.align ? align : undefined}
              place={place ?? { top: 0, left: 0, up: false }}
              docked={dock !== undefined}
              barRef={bar}
              onToggle={toggle}
              onFont={chooseFont}
              onSize={chooseSize}
              onStep={stepAll}
              onColor={chooseColor}
              onAlign={setAlign}
              onClear={clear}
              onSymbol={insert}
              onSizeDone={() => {
                ref.current?.focus()
                writeSel(model.current.sel)
              }}
            />
          )
          return dock ? createPortal(toolbar, dock) : toolbar
        })()}
    </span>
  )
}

/**
 * Rich text shown read-only (table headers and cells), in the editor's tags with runs' fonts and
 * colours; sizes are left at the grid's so a large one can't break its rows.
 */
export function RichTextView({ runs }: { runs: RichText }) {
  return (
    <>
      {runs.map((r, i) => {
        let node: ReactNode = r.text
        if (r.sub) node = <sub>{node}</sub>
        if (r.sup) node = <sup>{node}</sup>
        if (r.underline) node = <u>{node}</u>
        if (r.italic) node = <i>{node}</i>
        if (r.bold) node = <b>{node}</b>
        const color = r.color && cssColor(r.color, DEFAULT_THEME.palette)
        const css: CSSProperties | undefined =
          r.font || color || r.bold === false || r.italic === false
            ? {
                ...(r.font ? { fontFamily: FONT_STACKS[r.font] } : {}),
                ...(color ? { color } : {}),
                ...(r.bold === false ? { fontWeight: 'normal' } : {}),
                ...(r.italic === false ? { fontStyle: 'normal' } : {}),
              }
            : undefined
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: runs are positional
          <span key={i} style={css}>
            {node}
          </span>
        )
      })}
    </>
  )
}
