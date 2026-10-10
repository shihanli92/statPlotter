import { FONTS } from '@ps/graph'
import {
  type ColorRef,
  type FillStyle,
  type FontId,
  mergeRuns,
  type RichText,
  richPlain,
  type StrokeStyle,
  type SymbolShape,
  type TextAlign,
  type TextStyle,
} from '@ps/model'
import { useContext, useId } from 'react'
import { sameRichText } from '../richText/model.ts'
import { RichTextEditor } from '../richText/RichTextEditor.tsx'
import { ColorButtonField, colorOf } from './ColorPicker.tsx'
import { Checkbox, LiveFields, NumberInput, Select } from './fields.tsx'

export { colorOf }

/**
 * A colour reference (a palette entry, a colour, "the series' colour" when allowed) as a swatch
 * button opening the colour popover (`ColorPicker.tsx`). `automatic`: the field can be unset —
 * the popover offers it (by that label), `onAutomatic` unsets it, and an unset `value` shows as
 * Automatic (`fallback` being the colour drawn then).
 */
export function ColorRefField({
  label,
  value,
  palette,
  fallback = '#000000',
  allowSeries = false,
  mixed = false,
  automatic,
  onChange,
}: {
  label: string
  value: ColorRef | undefined
  palette: readonly string[]
  /** Colour shown when the value is unset or "series". */
  fallback?: string
  allowSeries?: boolean
  /** The items it edits have different colours: no swatch is shown as chosen. */
  mixed?: boolean
  /** The Automatic choice ("Automatic") and what it does (unset the value). */
  automatic?: { label?: string; onPick: () => void }
  onChange: (c: ColorRef) => void
}) {
  return (
    <ColorButtonField
      label={label}
      state={{
        css: colorOf(value, palette, fallback),
        value,
        mixed,
        auto: !!automatic && value === undefined,
      }}
      palette={palette}
      allowSeries={allowSeries}
      automatic={automatic ? { label: automatic.label ?? 'Automatic', css: fallback } : null}
      onChange={(c) => (c === undefined ? automatic?.onPick() : onChange(c))}
    />
  )
}

export const DASHES = [
  { value: 'solid', label: 'Solid' },
  { value: 'dash', label: 'Dashed' },
  { value: 'dot', label: 'Dotted' },
] as const

export const SHAPES: { value: SymbolShape; label: string }[] = [
  { value: 'circle', label: 'Circle' },
  { value: 'square', label: 'Square' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'diamond', label: 'Diamond' },
  { value: 'plus', label: 'Plus' },
  { value: 'cross', label: 'Cross' },
]

/**
 * A line's edit as a sparse override (roadmap 37, decision 531): the fields the element already
 * set, and those the edit made differ from what it inherits (the theme's, so the style's) — never
 * the inherited values copied in, so a style still reaches what the user left alone. Undefined
 * when nothing is the element's own.
 */
export function sparseStroke(
  next: StrokeStyle,
  inherited: StrokeStyle,
  own: Partial<StrokeStyle> | undefined,
): Partial<StrokeStyle> | undefined {
  const out: Partial<StrokeStyle> = {}
  for (const k of ['color', 'width', 'dash'] as const) {
    const same = JSON.stringify(next[k]) === JSON.stringify(inherited[k])
    if ((own && k in own) || !same) (out as Record<string, unknown>)[k] = next[k]
  }
  return Object.keys(out).length ? out : undefined
}

/** A box's border when one is switched on (legend, text boxes). */
export const THIN_BORDER: StrokeStyle = { color: { rgb: '#000000' }, width: 0.5, dash: 'solid' }

/** "Line width (pt)" and "Line style" of a line, for the caller's field row. */
export function LineWidthStyle({
  stroke,
  onChange,
}: {
  stroke: StrokeStyle
  onChange: (s: StrokeStyle) => void
}) {
  return (
    <>
      <NumberInput
        label="Line width (pt)"
        value={stroke.width}
        min={0.25}
        max={10}
        step={0.25}
        onChange={(width) => onChange({ ...stroke, width })}
      />
      <Select
        label="Line style"
        value={stroke.dash}
        options={DASHES}
        onChange={(dash) => onChange({ ...stroke, dash })}
      />
    </>
  )
}

/** Colour, width and dash of a line; `onChange(null)` when `optional` and switched off. */
export function StrokeFields({
  label,
  value,
  palette,
  allowSeries,
  optional,
  onChange,
}: {
  label: string
  value: StrokeStyle | undefined
  palette: readonly string[]
  allowSeries?: boolean
  /** Shows a checkbox to turn the line on/off (absent = off). */
  optional?: { defaults: StrokeStyle }
  onChange: (s: StrokeStyle | undefined) => void
}) {
  const on = !optional || !!value
  const s: StrokeStyle = value ??
    optional?.defaults ?? { color: { rgb: '#000000' }, width: 1, dash: 'solid' }
  return (
    <>
      {optional && (
        <Checkbox
          label={label}
          checked={on}
          onChange={(v) => onChange(v ? optional.defaults : undefined)}
        />
      )}
      {on && (
        <>
          <ColorRefField
            label={optional ? 'Colour' : `${label} colour`}
            value={s.color}
            palette={palette}
            allowSeries={allowSeries}
            onChange={(color) => onChange({ ...s, color })}
          />
          <div className="field-row">
            <NumberInput
              label="Width (pt)"
              value={s.width}
              min={0}
              max={20}
              step={0.25}
              onChange={(width) => onChange({ ...s, width })}
            />
            <Select
              label="Style"
              value={s.dash}
              options={DASHES}
              onChange={(dash) => onChange({ ...s, dash })}
            />
          </div>
        </>
      )}
    </>
  )
}

/** No fill, or a colour with opacity. */
export function FillFields({
  label,
  value,
  palette,
  defaultColor = { rgb: '#ffffff' },
  onChange,
}: {
  label: string
  value: FillStyle | undefined
  palette: readonly string[]
  defaultColor?: ColorRef
  onChange: (f: FillStyle | undefined) => void
}) {
  const solid = value?.type === 'solid' ? value : null
  return (
    <>
      <Checkbox
        label={label}
        checked={!!solid}
        onChange={(v) =>
          onChange(v ? { type: 'solid', color: defaultColor, opacity: 1 } : undefined)
        }
      />
      {solid && (
        <>
          <ColorRefField
            label="Colour"
            value={solid.color}
            palette={palette}
            fallback="#ffffff"
            onChange={(color) => onChange({ ...solid, color })}
          />
          <NumberInput
            label="Opacity (0–1)"
            value={solid.opacity}
            min={0}
            max={1}
            step={0.05}
            onChange={(opacity) => onChange({ ...solid, opacity })}
          />
        </>
      )}
    </>
  )
}

/** The bundled fonts, for font menus. */
const FONT_OPTIONS = (Object.keys(FONTS) as FontId[]).map((value) => ({
  value,
  label: FONTS[value].label,
}))

/**
 * Font, size, colour, bold, italic as sparse overrides: a field left alone stays inherited
 * (from the graph's base text style, then the theme).
 */
export function TextStyleFields({
  value,
  inherited,
  palette,
  onChange,
}: {
  value: Partial<TextStyle> | undefined
  /** The effective style when nothing is overridden. */
  inherited: TextStyle
  palette: readonly string[]
  onChange: (s: Partial<TextStyle> | undefined) => void
}) {
  const v = value ?? {}
  const eff = { ...inherited, ...v }
  const set = (patch: Partial<TextStyle>) => onChange({ ...v, ...patch })
  const overridden = Object.keys(v).length > 0
  return (
    <>
      <div className="field-row">
        <Select
          label="Font"
          value={eff.font}
          options={FONT_OPTIONS}
          onChange={(font) => set({ font })}
        />
        <NumberInput
          label="Size (pt)"
          value={eff.size}
          min={4}
          max={96}
          step={0.5}
          onChange={(size) => set({ size })}
        />
      </div>
      <div className="field-row">
        <Checkbox label="Bold" checked={eff.bold} onChange={(bold) => set({ bold })} />
        <Checkbox label="Italic" checked={eff.italic} onChange={(italic) => set({ italic })} />
      </div>
      <ColorRefField
        label="Colour"
        value={v.color}
        fallback={colorOf(inherited.color, palette, '#000000')}
        palette={palette}
        automatic={{
          // Inherited again (decision 531): the field leaves the overrides.
          onPick: () => {
            const { color: _, ...rest } = v
            onChange(Object.keys(rest).length ? rest : undefined)
          },
        }}
        onChange={(color) => set({ color })}
      />
      {overridden && (
        <button type="button" className="link" onClick={() => onChange(undefined)}>
          Reset to the graph’s text style
        </button>
      )}
    </>
  )
}

/** How a text box's lines line up. */
export const TEXT_ALIGNS: readonly { value: TextAlign; label: string }[] = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Centred' },
  { value: 'right', label: 'Right' },
]

/**
 * A rich text field (roadmap 28): typed as is, formatted with the editor's toolbar and shortcuts;
 * commits on blur / Enter, and in a Format dialog on every edit (empty text only on blur, which
 * removes it). `multiline`: Shift+Enter breaks the line. `textStyle` and `palette` are the
 * element's, for the toolbar's font, size and colour; `align` and `onAlign` give a text box's
 * alignment buttons.
 */
export function RichTextField({
  label,
  value,
  placeholder,
  multiline = false,
  textStyle,
  palette,
  align,
  onAlign,
  onChange,
}: {
  label: string
  value: RichText | null | undefined
  placeholder?: string
  multiline?: boolean
  textStyle?: TextStyle
  palette?: readonly string[]
  align?: TextAlign
  onAlign?: (a: TextAlign) => void
  onChange: (rt: RichText | null) => void
}) {
  const id = useId()
  const live = useContext(LiveFields)
  const current = value ?? []
  const commit = (rt: RichText) => {
    if (sameRichText(rt, current)) return
    onChange(richPlain(rt).trim() ? mergeRuns(rt) : null)
  }
  return (
    <div className="field">
      {/* biome-ignore lint/a11y/noLabelWithoutControl: labels the editor by aria-labelledby */}
      <label id={id}>{label}</label>
      <RichTextEditor
        value={current}
        labelledBy={id}
        multiline={multiline}
        placeholder={placeholder}
        textStyle={textStyle}
        palette={palette}
        align={align}
        onAlign={onAlign}
        onChange={(rt) => {
          // Emptying the box removes the text (and its style): only on blur, not mid-typing.
          if (live && richPlain(rt).trim()) commit(rt)
        }}
        onCommit={commit}
      />
    </div>
  )
}
