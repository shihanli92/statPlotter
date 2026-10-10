import { FONTS } from '@ps/graph'
import type { FontId, TextStyle } from '@ps/model'
import { Checkbox, NumberInput, Select } from '../../components/fields.tsx'
import { ColorRefField, colorOf } from '../../components/formatFields.tsx'

// Roadmap 46 (stage 2): some of a text's style fields, named for the text they belong to ("Title
// font", "Tick label size (pt)", "Bold legend text"), so a place can show the font, size and bold
// in its Common settings and the rest in the text's own section, and a field search finds each by
// a name of its own. They write as `TextStyleFields` does: sparse overrides over the inherited
// style.

/** A text style field. */
export type TextPart = 'font' | 'size' | 'bold' | 'italic' | 'color'

/** Each part's label for a text: `font: 'Title font'`, `size: 'Title size (pt)'`… */
export type TextLabels = Record<TextPart, string>

/** The usual labels for a text named `name` ("Title", "Tick label", "Legend text"). */
export function textLabels(name: string): TextLabels {
  const lower = name.toLowerCase()
  return {
    font: `${name} font`,
    size: `${name} size (pt)`,
    bold: `Bold ${lower}`,
    italic: `Italic ${lower}`,
    color: `${name} colour`,
  }
}

const FONT_OPTIONS = (Object.keys(FONTS) as FontId[]).map((value) => ({
  value,
  label: FONTS[value].label,
}))

/** Some fields of a text's style (`parts`, in order), with the text's own labels. */
export function TextParts({
  parts,
  labels,
  value,
  inherited,
  palette,
  onChange,
  reset = false,
}: {
  parts: readonly TextPart[]
  labels: TextLabels
  value: Partial<TextStyle> | undefined
  inherited: TextStyle
  palette: readonly string[]
  onChange: (s: Partial<TextStyle> | undefined) => void
  /** Offer "Reset to the graph’s text style" when the text has its own style. */
  reset?: boolean
}) {
  const v = value ?? {}
  const eff = { ...inherited, ...v }
  const set = (patch: Partial<TextStyle>) => onChange({ ...v, ...patch })
  const has = (p: TextPart) => parts.includes(p)
  return (
    <>
      {(has('font') || has('size')) && (
        <div className="field-row">
          {has('font') && (
            <Select
              label={labels.font}
              value={eff.font}
              options={FONT_OPTIONS}
              onChange={(font) => set({ font })}
            />
          )}
          {has('size') && (
            <NumberInput
              label={labels.size}
              value={eff.size}
              min={4}
              max={96}
              step={0.5}
              onChange={(size) => set({ size })}
            />
          )}
        </div>
      )}
      {(has('bold') || has('italic')) && (
        <div className="field-row">
          {has('bold') && (
            <Checkbox label={labels.bold} checked={eff.bold} onChange={(bold) => set({ bold })} />
          )}
          {has('italic') && (
            <Checkbox
              label={labels.italic}
              checked={eff.italic}
              onChange={(italic) => set({ italic })}
            />
          )}
        </div>
      )}
      {has('color') && (
        <ColorRefField
          label={labels.color}
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
      )}
      {reset && Object.keys(v).length > 0 && (
        <button type="button" className="link" onClick={() => onChange(undefined)}>
          Reset to the graph’s text style
        </button>
      )}
    </>
  )
}

/** The parts of a text shown in Common (font, size, bold) and in its own section (the rest). */
export const COMMON_TEXT: readonly TextPart[] = ['font', 'size', 'bold']
export const OTHER_TEXT: readonly TextPart[] = ['italic', 'color']
