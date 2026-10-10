import type { Command as DocCommand } from '@ps/engine'
import { FONT_SHORT, FONTS } from '@ps/graph'
import type { ColorRef, FontId, GraphNode, NodeId, StrokeStyle, SymbolShape } from '@ps/model'
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { type Command, GROUPS, useCommands } from '../commands/index.ts'
import { isMacPlatform } from '../commands/shortcut.ts'
import { type AutoChoice, ColorPopover, type ColorState } from '../components/ColorPicker.tsx'
import { DASHES, SHAPES } from '../components/formatFields.tsx'
import { Icon } from '../components/icons.tsx'
import { Tooltip } from '../components/Tooltip.tsx'
import { useUndoNotice } from '../components/undoNotice.tsx'
import { useDoc, useResultLookup, useServices } from '../context.tsx'
import { columnsCommand, fillCommand, legendColumns } from '../graph/legendEdits.ts'
import { cleanSize, FONT_SIZES } from '../richText/model.ts'
import { keyId, primaryKey, type Selection, type SelKey } from '../selection/selection.ts'
import { BarMenu, type BarMenuItem } from './BarMenu.tsx'
import { FoldMark, FoldRow } from './FoldRow.tsx'
import { canPaste, copyFormat, formatClipboard, pasteCommands } from './formatClipboard.ts'
import {
  type Capability,
  changeLabel,
  fillCommands,
  fillSlots,
  fillValue,
  keyTarget,
  lineCommands,
  lineSlots,
  lineValues,
  markCommands,
  markSlots,
  markValues,
  positionCommands,
  selectionTargets,
  sharedCapabilities,
  stepCommands,
  type Target,
  textCommands,
  textSlots,
  textValues,
  toggleCommands,
} from './selectionStyles.ts'

// Roadmap 45: the format bar, a strip of a fixed height under the graph and layout views'
// toolbars (Excel's and PowerPoint's ribbon formats, one row): the selection's name (▾ picks any
// element), then Text (font, size, grow / shrink, bold, italic, colour), Fill, Line (colour,
// width, style), Symbols (shape, size: points layers), Reset position, the format painter and
// Format…. A group is enabled when every selected thing has it (greyed in place otherwise);
// values they differ in show blank, "—", a striped swatch or a half-pressed B. Each change is
// one undo step naming it and the count ("Font size 10 pt (3 elements)"), announced with its
// Undo; quick repeats of the same change merge (A↑ five times is one step).
// While text is edited in place the bar acts on the text being edited (run mode): the editor's
// own toolbar is docked in it (`dockRef`) instead of floating over the canvas.
// Roadmap 47: groups that don't fit fold, in a fixed order, into "More ▾" at its right end
// (`FoldRow.tsx`, `overflow.ts`), so nothing scrolls out of sight.

/** A thing the name's ▾ can switch the selection to. */
export interface BarElement {
  key: SelKey | null
  name: string
}

export interface FormatBarProps {
  sel: Selection
  /** The graph whose base text the bar formats when nothing is selected (its canvas). */
  graph?: NodeId
  /** What is selected, as the hint names it ("Y axis title", "3 elements", "Graph"). */
  name: string
  /** Every element the selection can switch to (Excel's "Current selection"), when asked. */
  elements: () => readonly BarElement[]
  onSelect: (key: SelKey | null) => void
  /** Format… : the Format panel at the primary element, as Enter and ⇧⌘E show it. */
  onFormat?: () => void
  /** Text is edited in place: the bar is the editor's (run mode). */
  editing?: string | null
  /** Where the in-place editor puts its toolbar. */
  onDock?: (el: HTMLElement | null) => void
  /**
   * Roadmap 47b: how many entries a graph's legend shows (the Layout group's columns go up to
   * it); absent: as many as asked.
   */
  legendEntries?: (graph: NodeId) => number
}

/** The menus that are the colour popover. */
const COLOR_MENUS: readonly string[] = ['textColor', 'fill', 'lineColor']
const LINE_WIDTHS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6]
const MARK_SIZES = [2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16]
const SHAPE_GLYPHS: Record<SymbolShape, string> = {
  circle: '●',
  square: '■',
  triangle: '▲',
  diamond: '◆',
  plus: '+',
  cross: '✕',
}

type Menu =
  | 'name'
  | 'font'
  | 'size'
  | 'textColor'
  | 'fill'
  | 'lineColor'
  | 'lineWidth'
  | 'dash'
  | 'shape'
  | 'markSize'

/** The format painter: off, armed for one target, or kept on until Escape. */
type Painter = 'off' | 'once' | 'sticky'

export function FormatBar(props: FormatBarProps) {
  const { sel, editing } = props
  const services = useServices()
  const { store, fonts } = services
  const project = useDoc((d) => d)
  const { lookup, version } = useResultLookup()
  const trackUndo = useUndoNotice()
  const mac = isMacPlatform()
  // biome-ignore lint/correctness/useExhaustiveDependencies: version tracks result changes
  const targets = useMemo(
    () =>
      selectionTargets({ project, lookup, ...(props.graph ? { graph: props.graph } : {}) }, sel),
    [project, sel, props.graph, lookup, version],
  )
  const caps = useMemo(() => sharedCapabilities(targets), [targets])
  const on = (c: Capability) => caps.has(c) && !editing
  const texts = textSlots(targets)
  const fills = fillSlots(targets)
  const lines = lineSlots(targets)
  const marks = markSlots(targets)
  const tv = on('text') ? textValues(texts) : null
  const fv = on('fill') ? fillValue(fills) : null
  const lv = on('line') ? lineValues(lines) : null
  const mv = on('mark') ? markValues(marks) : null
  const ids = sel.keys.map(keyId).join('|') || `graph:${props.graph ?? ''}`
  const [menu, setMenu] = useState<{ which: Menu; anchor: HTMLElement } | null>(null)
  const [fontWait, setFontWait] = useState<FontId | null>(null)

  /** One undo step, announced; `coalesce`: quick repeats of the same change merge. */
  const apply = (cmds: DocCommand[], label: string, coalesce?: string) => {
    if (!cmds.length) return
    const key = coalesce ? `${coalesce}:${ids}` : undefined
    trackUndo(
      () => store.dispatch(cmds, label, key ? { coalesce: key } : {}),
      key ? { group: key } : undefined,
    )
  }
  const n = (slots: readonly unknown[]) => slots.length

  // ---- Text --------------------------------------------------------------------------------
  const setFont = (font: FontId) => {
    const run = () =>
      apply(
        textCommands(texts, { font }),
        changeLabel(`Font ${FONT_SHORT[font]}`, n(texts)),
        'font',
      )
    // A family not loaded yet: the change waits for it (a drawing never measures with another).
    if (fonts.has(font)) run()
    else {
      setFontWait(font)
      void fonts.ensure([font]).then(
        () => {
          setFontWait(null)
          run()
        },
        () => setFontWait(null),
      )
    }
  }
  const setSize = (size: number) =>
    apply(textCommands(texts, { size }), changeLabel(`Font size ${size} pt`, n(texts)), 'size')
  const grow = (dir: 1 | -1) =>
    apply(
      stepCommands(texts, dir),
      changeLabel(dir > 0 ? 'Grow font' : 'Shrink font', n(texts)),
      'size',
    )
  const toggle = (f: 'bold' | 'italic') => {
    const v = textValues(texts)
    if (!v) return
    const turnOn = v[f].mixed || !v[f].value
    const name = f === 'bold' ? 'bold' : 'italic'
    apply(
      toggleCommands(texts, f),
      changeLabel(turnOn ? `${name[0]!.toUpperCase()}${name.slice(1)}` : `Not ${name}`, n(texts)),
    )
  }
  const setTextColor = (color: ColorRef | undefined) =>
    apply(textCommands(texts, { color }), changeLabel('Text colour', n(texts)), 'textColor')
  // ---- Fill, line, symbols ------------------------------------------------------------------
  const setFill = (color: ColorRef | undefined) =>
    apply(
      fillCommands(fills, color),
      changeLabel(fills.every((f) => f.kind === 'identity') ? 'Colour' : 'Fill colour', n(fills)),
      'fill',
    )
  const setLine = (patch: Partial<StrokeStyle> | null, what: string, field: string) =>
    apply(lineCommands(lines, patch), changeLabel(what, n(lines)), field)
  const setMark = (patch: { shape?: SymbolShape; size?: number }, what: string, field: string) =>
    apply(markCommands(marks, patch), changeLabel(what, n(marks)), field)
  // ---- The legend's layout (roadmap 47b) ----------------------------------------------------------
  const legends =
    targets.length && targets.every((t) => t.legend) ? targets.map((t) => t.legend!) : []
  const layoutOn = legends.length > 0 && !editing
  const counts = legends.map((l) => props.legendEntries?.(l.graph.id) ?? Number.POSITIVE_INFINITY)
  const columnsShown = legends.map((l, i) =>
    legendColumns(
      l.graph.legend,
      Number.isFinite(counts[i]!) ? counts[i]! : (l.graph.legend.columns ?? 1),
    ),
  )
  const columns = {
    value: columnsShown[0] ?? 1,
    mixed: columnsShown.some((c) => c !== columnsShown[0]),
  }
  const gridFills = legends.map((l) => l.graph.legend.fill ?? 'rows')
  const gridFill = {
    value: gridFills[0] ?? 'rows',
    mixed: gridFills.some((f) => f !== gridFills[0]),
  }
  /** Every selected legend's columns one more or fewer (within 1 and its entries). */
  const stepColumns = (by: 1 | -1) => {
    const cmds = legends.flatMap((l, i) => {
      const next = Math.max(1, Math.min(counts[i]!, columnsShown[i]! + by))
      return next === columnsShown[i] ? [] : [columnsCommand(l.graph, next)]
    })
    const shown = Math.max(1, columns.value + by)
    apply(cmds, changeLabel(`Legend columns ${shown}`, cmds.length), 'legendColumns')
  }
  const setGridFill = (to: 'rows' | 'columns') => {
    const cmds = legends.flatMap((l) =>
      (l.graph.legend.fill ?? 'rows') === to ? [] : [fillCommand(l.graph, to)],
    )
    apply(
      cmds,
      changeLabel(
        to === 'columns' ? 'Legend fill down columns' : 'Legend fill across rows',
        cmds.length,
      ),
      'legendFill',
    )
  }
  const positioned = targets.filter((t) => t.position)
  const resetPosition = () =>
    apply(positionCommands(positioned), changeLabel('Reset position', positioned.length))

  // ---- The format painter ---------------------------------------------------------------------
  const copied = useSyncExternalStore(formatClipboard.subscribe, formatClipboard.get)
  const primary = primaryKey(sel)
  const primaryTarget = useMemo<Target | null>(
    () => (primary ? keyTarget({ project, lookup }, primary) : (targets[0] ?? null)),
    [primary, project, lookup, targets],
  )
  const graphOf = (gid: NodeId) => project.nodes[gid] as GraphNode | undefined
  const copyNow = () => {
    const f = copyFormat(primaryTarget, graphOf)
    formatClipboard.set(f)
    return f
  }
  const paste = (withColor: boolean, onto: readonly Target[] = targets) => {
    const c = formatClipboard.get()
    if (!c) return
    const p = pasteCommands(c, onto, { color: withColor })
    apply(p.commands, changeLabel(withColor ? 'Paste format with colour' : 'Paste format', p.count))
  }
  const [painter, setPainter] = useState<Painter>('off')
  const armedAt = useRef<Selection | null>(null)
  const arm = (mode: Painter) => {
    if (mode === 'off') {
      setPainter('off')
      return
    }
    if (!copyNow()) return
    armedAt.current = sel
    setPainter(mode)
  }
  // Armed: the next selection made is painted (the click on the target), once or until Escape.
  // biome-ignore lint/correctness/useExhaustiveDependencies: on a new selection only
  useEffect(() => {
    if (painter === 'off' || sel === armedAt.current || !sel.keys.length) return
    armedAt.current = sel
    paste(false)
    if (painter === 'once') setPainter('off')
  }, [sel])
  useEffect(() => {
    if (painter === 'off') return
    document.body.dataset.painting = 'true'
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      setPainter('off')
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      delete document.body.dataset.painting
      document.removeEventListener('keydown', onKey, true)
    }
  }, [painter])

  // ---- Commands (menus, palette, shortcut sheet, keys) -------------------------------------------
  const sizeBox = useRef<HTMLInputElement>(null)
  /** Where the size box gives the focus back (the canvas it was reached from). */
  const back = useRef<HTMLElement | null>(null)
  const textOn = on('text')
  const fmt = (order: number, submenu?: string) => ({
    menu: 'format' as const,
    group: GROUPS.format.text,
    order,
    ...(submenu ? { submenu } : {}),
  })
  const commands: Command[] = [
    {
      id: 'format.bold',
      label: 'Bold',
      shortcut: 'Mod+B',
      menu: fmt(10, 'Text'),
      enabled: textOn,
      hint: 'Bold the selected text elements (or the graph’s text)',
      run: () => toggle('bold'),
    },
    {
      id: 'format.italic',
      label: 'Italic',
      shortcut: 'Mod+I',
      menu: fmt(20, 'Text'),
      enabled: textOn,
      hint: 'Italicise the selected text elements',
      run: () => toggle('italic'),
    },
    {
      id: 'format.grow',
      label: 'Grow font',
      shortcut: 'Mod+Shift+>',
      menu: fmt(30, 'Text'),
      enabled: textOn,
      hint: 'The next size up for each selected text element',
      run: () => grow(1),
    },
    {
      id: 'format.shrink',
      label: 'Shrink font',
      shortcut: 'Mod+Shift+<',
      menu: fmt(40, 'Text'),
      enabled: textOn,
      hint: 'The next size down for each selected text element',
      run: () => grow(-1),
    },
    {
      id: 'format.fontSize',
      label: 'Font size…',
      menu: fmt(50, 'Text'),
      enabled: textOn,
      hint: 'Type a size for the selected text elements (the format bar’s size box)',
      keywords: ['text size', 'points'],
      run: () => sizeBox.current?.focus(),
    },
    {
      id: 'format.copyFormat',
      label: 'Copy format',
      shortcut: 'Mod+Alt+C',
      menu: fmt(60),
      enabled: !!primaryTarget && !editing,
      hint: 'Remember the selected element’s text, line, fill or symbols, to paste on others',
      keywords: ['format painter', 'copy style'],
      run: copyNow,
    },
    {
      id: 'format.pasteFormat',
      label: 'Paste format',
      shortcut: 'Mod+Alt+V',
      menu: fmt(70),
      enabled: !editing && canPaste(copied, targets),
      hint: 'Give the selected elements the copied format (data sets keep their colour)',
      keywords: ['format painter', 'paste style'],
      run: () => paste(false),
    },
    {
      id: 'format.pasteFormatWithColour',
      label: 'Paste format with colour',
      menu: fmt(80),
      enabled: !editing && canPaste(copied, targets),
      hint: 'Paste the copied format, data sets’ colour included',
      keywords: ['format painter', 'paste style', 'color'],
      run: () => paste(true),
    },
  ]
  useCommands('view', commands)

  // ---- Roving focus ------------------------------------------------------------------------------
  const barRef = useRef<HTMLDivElement>(null)
  const current = useRef<string | null>(null)
  useLayoutEffect(() => {
    const items = [...(barRef.current?.querySelectorAll<HTMLElement>('[data-bar-item]') ?? [])]
    const usable = items.filter((el) => !(el as HTMLButtonElement).disabled)
    const keep = usable.find((el) => el.dataset.barItem === current.current) ?? usable[0]
    for (const el of items) el.tabIndex = el === keep ? 0 : -1
  })
  const onBarKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End']
    if (!keys.includes(e.key)) return
    const t = e.target as HTMLElement
    if (t instanceof HTMLInputElement) {
      // The size box keeps its caret keys but at its ends.
      const atStart = t.selectionStart === 0 && t.selectionEnd === 0
      const atEnd = t.selectionStart === t.value.length
      if (!((e.key === 'ArrowLeft' && atStart) || (e.key === 'ArrowRight' && atEnd))) return
    }
    const usable = [
      ...(barRef.current?.querySelectorAll<HTMLElement>('[data-bar-item]') ?? []),
    ].filter((el) => !(el as HTMLButtonElement).disabled)
    const i = usable.indexOf(t.closest<HTMLElement>('[data-bar-item]')!)
    const j =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? usable.length - 1
          : (i + (e.key === 'ArrowRight' ? 1 : -1) + usable.length) % usable.length
    e.preventDefault()
    usable[j]?.focus()
  }

  // ---- Rendering --------------------------------------------------------------------------------
  const open = (which: Menu) => (e: React.MouseEvent<HTMLElement>) =>
    setMenu(menu?.which === which ? null : { which, anchor: e.currentTarget })
  const expanded = (which: Menu) => menu?.which === which
  /** A button of the bar: never takes the focus from the canvas on a press. */
  const button = (
    id: string,
    label: string,
    content: ReactNode,
    onClick: (e: React.MouseEvent<HTMLButtonElement>) => void,
    o: {
      disabled?: boolean
      pressed?: boolean | 'mixed'
      menu?: Menu
      className?: string
      tip?: string
      onDoubleClick?: () => void
    } = {},
  ) => (
    <Tooltip content={o.tip ?? label}>
      <button
        type="button"
        data-bar-item={id}
        aria-label={label}
        disabled={o.disabled}
        aria-pressed={o.pressed}
        aria-haspopup={o.menu ? (COLOR_MENUS.includes(o.menu) ? 'dialog' : 'menu') : undefined}
        aria-expanded={o.menu ? expanded(o.menu) : undefined}
        className={o.className}
        onMouseDown={(e) => e.preventDefault()}
        onFocus={() => {
          current.current = id
        }}
        onClick={onClick}
        onDoubleClick={o.onDoubleClick}
      >
        {content}
      </button>
    </Tooltip>
  )
  const swatch = (css: string | null | undefined, mixed: boolean) => (
    <span
      className={`bar-swatch ${mixed ? 'mixed' : ''} ${css === null ? 'none' : ''}`}
      style={!mixed && css ? { background: css } : undefined}
    />
  )
  const palette = texts[0]?.palette ?? fills[0]?.palette ?? lines[0]?.palette ?? []
  /** A colour menu: the shared colour popover (`ColorPicker.tsx`), as the Format panel's. */
  const colorMenu = (
    which: Menu,
  ): {
    label: string
    current: ColorState
    automatic: AutoChoice | null
    palette: readonly string[]
    pick: (c: ColorRef | undefined) => void
  } | null => {
    // The current colour (CSS), `undefined` for Automatic, `null` when the items differ.
    const of = (
      label: string,
      current: string | null | undefined,
      pick: (c: ColorRef | undefined) => void,
      automatic: AutoChoice | null,
      pal: readonly string[],
    ) => ({
      label,
      current: {
        css: current ?? '',
        mixed: current === null,
        auto: current === undefined && !!automatic,
      },
      automatic,
      palette: pal,
      pick,
    })
    switch (which) {
      case 'textColor':
        return of(
          'Text colours',
          tv && !tv.color.mixed && tv.color.value.ref
            ? tv.color.value.css
            : tv?.color.mixed
              ? null
              : undefined,
          setTextColor,
          { label: 'Automatic', css: tv && !tv.color.mixed ? tv.color.value.css : null },
          palette,
        )
      case 'fill': {
        const identity = fills.every((f) => f.kind === 'identity')
        return of(
          'Fill colours',
          fv && !fv.mixed
            ? fills.every((f) => f.value === undefined)
              ? undefined
              : fv.value
            : null,
          setFill,
          identity ? { label: 'Automatic', striped: true } : { label: 'No fill', none: true },
          fills[0]?.palette ?? palette,
        )
      }
      case 'lineColor':
        return of(
          'Line colours',
          lv && !lv.color.mixed ? (lv.color.value ?? undefined) : null,
          (c) =>
            c
              ? setLine({ color: c }, 'Line colour', 'lineColor')
              : setLine(null, 'No line', 'lineColor'),
          lines.every((l) => l.optional) ? { label: 'No line', none: true } : null,
          lines[0]?.palette ?? palette,
        )
      default:
        return null
    }
  }
  const menuOf = (
    which: Menu,
  ): { label: string; items: (BarMenuItem | '-')[]; columns?: number } | null => {
    switch (which) {
      case 'name':
        return {
          label: 'Select',
          items: props.elements().map((el) => ({
            label: el.name,
            checked:
              el.key === null
                ? sel.keys.length === 0
                : sel.keys.length === 1 && keyId(sel.keys[0]!) === keyId(el.key),
            onSelect: () => props.onSelect(el.key),
          })),
        }
      case 'font':
        return {
          label: 'Fonts',
          items: (Object.keys(FONTS) as FontId[]).map((f) => ({
            label: FONTS[f].label,
            checked: !!tv && !tv.font.mixed && tv.font.value === f,
            style: { fontFamily: `'${FONTS[f].cssFamily}'` },
            onSelect: () => setFont(f),
          })),
        }
      case 'size':
        return {
          label: 'Font sizes',
          items: FONT_SIZES.map((s) => ({
            label: String(s),
            checked: !!tv && !tv.size.mixed && tv.size.value === s,
            onSelect: () => setSize(s),
          })),
        }
      case 'lineWidth':
        return {
          label: 'Line widths',
          items: LINE_WIDTHS.map((w) => ({
            label: `${w} pt`,
            content: (
              <span className="bar-width">
                <span style={{ height: Math.max(1, w * 1.33) }} /> {w} pt
              </span>
            ),
            checked: !!lv && !lv.width.mixed && lv.width.value === w,
            onSelect: () => setLine({ width: w }, `Line width ${w} pt`, 'lineWidth'),
          })),
        }
      case 'dash':
        return {
          label: 'Line styles',
          items: DASHES.map((d) => ({
            label: d.label,
            checked: !!lv && !lv.dash.mixed && lv.dash.value === d.value,
            onSelect: () => setLine({ dash: d.value }, `${d.label} line`, 'dash'),
          })),
        }
      case 'shape':
        return {
          label: 'Symbol shapes',
          items: SHAPES.map((s) => ({
            label: s.label,
            content: (
              <>
                <span className="bar-glyph">{SHAPE_GLYPHS[s.value]}</span> {s.label}
              </>
            ),
            checked: !!mv && !mv.shape.mixed && mv.shape.value === s.value,
            onSelect: () => setMark({ shape: s.value }, `Symbol ${s.label.toLowerCase()}`, 'shape'),
          })),
        }
      case 'markSize':
        return {
          label: 'Symbol sizes',
          items: MARK_SIZES.map((s) => ({
            label: `${s} pt`,
            checked: !!mv && !mv.size.mixed && mv.size.value === s,
            onSelect: () => setMark({ size: s }, `Symbol size ${s} pt`, 'markSize'),
          })),
        }
      default:
        return null
    }
  }
  const shown = menu ? menuOf(menu.which) : null
  const colors = menu ? colorMenu(menu.which) : null
  const sizeText = tv && !tv.size.mixed ? String(tv.size.value) : ''
  const keyHint = (k: string) =>
    mac
      ? k.replace('Mod+', '⌘').replace('Shift+', '⇧').replace('Alt+', '⌥')
      : k.replace('Mod+', 'Ctrl+')
  const pressed = (f: { value: boolean; mixed: boolean } | undefined): boolean | 'mixed' =>
    f ? (f.mixed ? 'mixed' : f.value) : false

  return (
    <div
      ref={barRef}
      className={`format-bar ${editing ? 'editing' : ''}`}
      role="toolbar"
      aria-label="Format"
      data-testid="format-bar"
      onKeyDown={onBarKey}
    >
      <span className="fb-name">
        {editing ? (
          <span className="fb-name-text" title={editing}>
            {editing}
          </span>
        ) : (
          button(
            'name',
            `Selected: ${props.name}. Select another element`,
            <span className="fb-name-text">{props.name}</span>,
            open('name'),
            { menu: 'name', className: 'fb-name-button', tip: 'Select another part of the graph' },
          )
        )}
      </span>
      {/* Run mode: the in-place editor's toolbar docks here. */}
      <div className="fb-dock" ref={props.onDock} hidden={!editing} />
      {!editing && (
        <FoldRow bar={barRef}>
          <FoldMark id="text" />
          <span className="fb-sep" />
          {/* biome-ignore lint/a11y/useSemanticElements: a toolbar's group, not a form's fieldset */}
          <span className="fb-group" role="group" aria-label="Text">
            {button(
              'font',
              'Font',
              <span className="fb-font">
                {fontWait ? '…' : tv ? (tv.font.mixed ? '—' : FONT_SHORT[tv.font.value]) : ''}
              </span>,
              open('font'),
              {
                disabled: !tv,
                menu: 'font',
                className: 'fb-menu-button',
                tip: fontWait ? 'Loading the font…' : 'Font',
              },
            )}
            <span className={`fb-size ${tv ? '' : 'disabled'}`}>
              <input
                ref={sizeBox}
                key={`${sizeText}:${ids}`}
                data-bar-item="size"
                role="combobox"
                aria-expanded={expanded('size')}
                aria-autocomplete="none"
                aria-label="Font size"
                title="Font size (pt)"
                inputMode="decimal"
                disabled={!tv}
                defaultValue={sizeText}
                onFocus={(e) => {
                  current.current = 'size'
                  setMenu(null)
                  e.currentTarget.select()
                  back.current = e.relatedTarget as HTMLElement | null
                }}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  const done = () => {
                    const b = back.current
                    if (b?.isConnected) b.focus({ preventScroll: true })
                  }
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    const v = cleanSize(Number(e.currentTarget.value.replace(',', '.')))
                    if (v !== null) setSize(v)
                    else e.currentTarget.value = sizeText
                    done()
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    e.currentTarget.value = sizeText
                    done()
                  } else if (e.key === 'ArrowDown' && e.altKey) {
                    e.preventDefault()
                    setMenu({ which: 'size', anchor: e.currentTarget })
                  } else onBarKey(e as unknown as KeyboardEvent<HTMLDivElement>)
                }}
              />
              {button('sizes', 'Font sizes', '▾', open('size'), {
                disabled: !tv,
                menu: 'size',
                className: 'fb-drop',
              })}
            </span>
            {button('grow', 'Grow font', 'A↑', () => grow(1), {
              disabled: !tv,
              tip: `Grow font (${keyHint('Mod+Shift+>')})`,
            })}
            {button('shrink', 'Shrink font', 'A↓', () => grow(-1), {
              disabled: !tv,
              tip: `Shrink font (${keyHint('Mod+Shift+<')})`,
            })}
            {button('bold', 'Bold', <b>B</b>, () => toggle('bold'), {
              disabled: !tv,
              pressed: pressed(tv?.bold),
              tip: `Bold (${keyHint('Mod+B')})`,
            })}
            {button('italic', 'Italic', <i>I</i>, () => toggle('italic'), {
              disabled: !tv,
              pressed: pressed(tv?.italic),
              tip: `Italic (${keyHint('Mod+I')})`,
            })}
            {button(
              'textColor',
              'Text colour',
              <span className="fb-color">A{swatch(tv?.color.value.css, !!tv?.color.mixed)}</span>,
              open('textColor'),
              { disabled: !tv, menu: 'textColor' },
            )}
          </span>
          <FoldMark id="fill" />
          <span className="fb-sep" />
          {/* biome-ignore lint/a11y/useSemanticElements: as above */}
          <span className="fb-group" role="group" aria-label="Fill">
            {button(
              'fill',
              fills.length && fills.every((f) => f.kind === 'identity') ? 'Colour' : 'Fill colour',
              <span className="fb-color fill">
                <span className="fb-bucket" aria-hidden="true">
                  ◧
                </span>
                {swatch(fv?.value, !!fv?.mixed)}
              </span>,
              open('fill'),
              { disabled: !fv, menu: 'fill' },
            )}
          </span>
          <FoldMark id="line" />
          <span className="fb-sep" />
          {/* biome-ignore lint/a11y/useSemanticElements: as above */}
          <span className="fb-group" role="group" aria-label="Line">
            {button(
              'lineColor',
              'Line colour',
              <span className="fb-color line">
                <span className="fb-pen" aria-hidden="true">
                  ╱
                </span>
                {swatch(lv?.color.value, !!lv?.color.mixed)}
              </span>,
              open('lineColor'),
              { disabled: !lv, menu: 'lineColor' },
            )}
            {button(
              'lineWidth',
              'Line width',
              <span className="fb-text">
                {lv
                  ? lv.width.mixed
                    ? '—'
                    : lv.width.value === null
                      ? ''
                      : `${lv.width.value} pt`
                  : ''}
              </span>,
              open('lineWidth'),
              { disabled: !lv, menu: 'lineWidth', className: 'fb-menu-button narrow' },
            )}
            {button(
              'dash',
              'Line style',
              <span className="fb-text">
                {lv
                  ? lv.dash.mixed
                    ? '—'
                    : (DASHES.find((d) => d.value === lv.dash.value)?.label ?? '')
                  : ''}
              </span>,
              open('dash'),
              { disabled: !lv, menu: 'dash', className: 'fb-menu-button narrow' },
            )}
          </span>
          <FoldMark id="symbols" />
          <span className="fb-sep" />
          {/* biome-ignore lint/a11y/useSemanticElements: as above */}
          <span className="fb-group" role="group" aria-label="Symbols">
            {button(
              'shape',
              'Symbol shape',
              <span className="fb-text">
                {mv ? (mv.shape.mixed ? '—' : SHAPE_GLYPHS[mv.shape.value]) : ''}
              </span>,
              open('shape'),
              { disabled: !mv, menu: 'shape', className: 'fb-menu-button tiny' },
            )}
            {button(
              'markSize',
              'Symbol size',
              <span className="fb-text">
                {mv ? (mv.size.mixed ? '—' : `${mv.size.value} pt`) : ''}
              </span>,
              open('markSize'),
              {
                // Audit 3 (U6): not where a mapped variable sizes the symbols.
                disabled: !mv || mv.sizeMapped,
                menu: 'markSize',
                className: 'fb-menu-button narrow',
              },
            )}
          </span>
          <FoldMark id="layout" />
          {layoutOn && <span className="fb-sep" />}
          {layoutOn && (
            // biome-ignore lint/a11y/useSemanticElements: as above
            <span className="fb-group" role="group" aria-label="Legend layout">
              {button('columnsLess', 'Fewer legend columns', '−', () => stepColumns(-1), {
                disabled: !columns.mixed && columns.value <= 1,
                tip: 'Fewer columns in the legend',
              })}
              <output
                className="fb-text fb-columns"
                data-testid="legend-columns"
                title="Legend columns"
                aria-label={`Legend columns: ${columns.mixed ? 'mixed' : columns.value}`}
              >
                {columns.mixed ? '—' : columns.value} col
              </output>
              {button('columnsMore', 'More legend columns', '+', () => stepColumns(1), {
                disabled: !columns.mixed && counts.every((c, i) => columnsShown[i]! >= c),
                tip: 'More columns in the legend (up to its entries)',
              })}
              {button(
                'legendFill',
                'Fill down columns',
                <span className="fb-text">
                  {gridFill.value === 'columns' && !gridFill.mixed ? '⇊' : '⇉'}
                </span>,
                () =>
                  setGridFill(gridFill.value === 'columns' && !gridFill.mixed ? 'rows' : 'columns'),
                {
                  pressed: gridFill.mixed ? 'mixed' : gridFill.value === 'columns',
                  tip: 'Fill the legend down its columns (off: across its rows)',
                },
              )}
            </span>
          )}
          <FoldMark id="reset" />
          <span className="fb-sep" />
          {button('reset', 'Reset position', <Icon name="rotate-ccw" />, resetPosition, {
            disabled: !on('position'),
            tip: 'Reset position: put what was moved back where the layout places it',
          })}
          <FoldMark id="painter" />
          {button(
            'painter',
            painter === 'off' ? 'Format painter' : 'Format painter (on)',
            <Icon name="brush" />,
            () => arm(painter === 'off' ? 'once' : 'off'),
            {
              disabled: !primaryTarget || !copyFormat(primaryTarget, graphOf),
              pressed: painter !== 'off',
              onDoubleClick: () => arm('sticky'),
              tip:
                painter === 'sticky'
                  ? 'Format painter: on until Escape — click the parts to format'
                  : painter === 'once'
                    ? 'Format painter: click the part to format (Escape stops)'
                    : `Format painter: click, then click the part to format; double-click to keep it on (copy ${keyHint('Mod+Alt+C')}, paste ${keyHint('Mod+Alt+V')})`,
            },
          )}
          <FoldMark id="format" />
          {props.onFormat &&
            button('format', 'Format…', <span className="fb-text">Format…</span>, props.onFormat, {
              tip: 'The Format panel at the selection (Enter, ⇧⌘E; ⌘1 shows or hides it)',
            })}
        </FoldRow>
      )}
      {menu && shown && (
        <BarMenu
          anchor={menu.anchor}
          label={shown.label}
          items={shown.items}
          columns={shown.columns}
          onClose={() => setMenu(null)}
        />
      )}
      {menu && colors && (
        <ColorPopover
          anchor={menu.anchor}
          label={colors.label}
          palette={colors.palette}
          current={colors.current}
          automatic={colors.automatic}
          onPick={colors.pick}
          onCustom={(rgb) => colors.pick({ rgb })}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}
