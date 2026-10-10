import { FONTS, TABLE_TEXT_SIZE, type Theme } from '@ps/graph'
import type { ColorRef, FillStyle, FontId, LayoutItem, StrokeStyle, TextStyle } from '@ps/model'
import { Checkbox, NumberInput, Section, Select } from '../components/fields.tsx'
import { ColorRefField, DASHES, THIN_BORDER } from '../components/formatFields.tsx'

// The inspector of several page items (roadmap 44, UX review O4): the fields they share — a
// graph's size on the page, text style, border, fill — a value they differ in shown blank
// ("mixed"); a change applies to each of them, one undo step.

/** One field of one item: its index on the page, the path within it, the new value. */
export interface ItemEdit {
  index: number
  path: (string | number)[]
  value: unknown
}

type Picked = { item: LayoutItem; index: number }

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** The first value and whether the others differ from it. */
function shared<T>(values: readonly T[]): { value: T; mixed: boolean } {
  const value = values[0]!
  return { value, mixed: values.some((v) => !same(v, value)) }
}

const FONT_OPTIONS = (Object.keys(FONTS) as FontId[]).map((value) => ({
  value,
  label: FONTS[value].label,
}))

/** A text or table item's text style as drawn (its overrides over the page's text style). */
function textStyleOf(it: LayoutItem, theme: Theme): TextStyle | null {
  if (it.type === 'text') return { ...theme.text, ...it.content.style }
  if (it.type === 'table') return { ...theme.text, size: TABLE_TEXT_SIZE, ...it.text }
  return null
}

/** The text style's place in an item, and its overrides. */
function textStylePath(it: LayoutItem): { path: string[]; own: Partial<TextStyle> } | null {
  if (it.type === 'text') return { path: ['content', 'style'], own: it.content.style ?? {} }
  if (it.type === 'table') return { path: ['text'], own: it.text ?? {} }
  return null
}

/** An item's border (a shape's outline). */
function borderOf(it: LayoutItem): { path: string; value: StrokeStyle | undefined } | null {
  if (it.type === 'text' || it.type === 'image') return { path: 'border', value: it.border }
  if (it.type === 'shape') return { path: 'stroke', value: it.stroke }
  return null
}

/** An item's fill (a text box's background). */
function fillOf(
  it: LayoutItem,
): { path: string; value: FillStyle | undefined; color: ColorRef } | null {
  if (it.type === 'text')
    return { path: 'background', value: it.background, color: { rgb: '#ffffff' } }
  if (it.type === 'shape') return { path: 'fill', value: it.fill, color: { palette: 0 } }
  return null
}

export function SharedItemFields({
  picked,
  theme,
  setMany,
}: {
  picked: readonly Picked[]
  theme: Theme
  setMany: (edits: ItemEdit[], label: string) => void
}) {
  if (picked.length < 2) return null
  const graphs = picked.every((p) => p.item.type === 'graph')
  const texts = picked.every((p) => textStyleOf(p.item, theme))
  const borders = picked.every((p) => borderOf(p.item))
  const fills = picked.every((p) => fillOf(p.item))
  if (!graphs && !texts && !borders && !fills) return null
  return (
    <Section title={`Shared by the ${picked.length} items`}>
      {graphs && <GraphSizeField picked={picked} setMany={setMany} />}
      {texts && <TextFields picked={picked} theme={theme} setMany={setMany} />}
      {borders && <BorderFields picked={picked} theme={theme} setMany={setMany} />}
      {fills && <FillFieldsShared picked={picked} theme={theme} setMany={setMany} />}
    </Section>
  )
}

interface FieldsProps {
  picked: readonly Picked[]
  theme: Theme
  setMany: (edits: ItemEdit[], label: string) => void
}

function GraphSizeField({ picked, setMany }: Omit<FieldsProps, 'theme'>) {
  const scales = picked.map((p) => (p.item.type === 'graph' ? p.item.scale : 1))
  const s = shared(scales.map((v) => Math.round(v * 1000) / 10))
  return (
    <NumberInput
      label="Size on page (%)"
      value={s.value}
      mixed={s.mixed}
      min={5}
      max={500}
      onChange={(v) =>
        setMany(
          picked.map((p) => ({ index: p.index, path: ['scale'], value: v / 100 })),
          'Resize graphs',
        )
      }
    />
  )
}

function TextFields({ picked, theme, setMany }: FieldsProps) {
  const styles = picked.map((p) => textStyleOf(p.item, theme)!)
  const set = (patch: Partial<TextStyle>) =>
    setMany(
      picked.map((p) => {
        const t = textStylePath(p.item)!
        return { index: p.index, path: t.path, value: { ...t.own, ...patch } }
      }),
      'Format text',
    )
  const font = shared(styles.map((s) => s.font))
  const size = shared(styles.map((s) => s.size))
  const bold = shared(styles.map((s) => s.bold))
  const italic = shared(styles.map((s) => s.italic))
  const color = shared(styles.map((s) => s.color))
  return (
    <>
      <div className="field-row">
        <Select
          label="Font"
          value={font.value}
          mixed={font.mixed}
          options={FONT_OPTIONS}
          onChange={(v) => set({ font: v })}
        />
        <NumberInput
          label="Text size (pt)"
          value={size.value}
          mixed={size.mixed}
          min={4}
          max={96}
          step={0.5}
          onChange={(v) => set({ size: v })}
        />
      </div>
      <div className="field-row">
        <Checkbox
          label="Bold"
          checked={bold.value}
          mixed={bold.mixed}
          onChange={(v) => set({ bold: v })}
        />
        <Checkbox
          label="Italic"
          checked={italic.value}
          mixed={italic.mixed}
          onChange={(v) => set({ italic: v })}
        />
      </div>
      <ColorRefField
        label="Text colour"
        value={color.value}
        mixed={color.mixed}
        palette={theme.palette}
        onChange={(v) => set({ color: v })}
      />
    </>
  )
}

function BorderFields({ picked, theme, setMany }: FieldsProps) {
  const all = picked.map((p) => ({ p, b: borderOf(p.item)! }))
  const on = all.filter((x) => x.b.value)
  const anyOn = on.length > 0
  const set = (patch: Partial<StrokeStyle>) =>
    setMany(
      on.map(({ p, b }) => ({ index: p.index, path: [b.path], value: { ...b.value!, ...patch } })),
      'Border',
    )
  const color = shared(on.map((x) => x.b.value!.color))
  const width = shared(on.map((x) => x.b.value!.width))
  const dash = shared(on.map((x) => x.b.value!.dash))
  return (
    <>
      <Checkbox
        label="Border"
        checked={anyOn}
        mixed={anyOn && on.length < all.length}
        onChange={(v) =>
          setMany(
            all.map(({ p, b }) => ({
              index: p.index,
              path: [b.path],
              value: v ? (b.value ?? THIN_BORDER) : undefined,
            })),
            'Border',
          )
        }
      />
      {anyOn && (
        <>
          <ColorRefField
            label="Border colour"
            value={color.value}
            mixed={color.mixed}
            palette={theme.palette}
            onChange={(v) => set({ color: v })}
          />
          <div className="field-row">
            <NumberInput
              label="Border width (pt)"
              value={width.value}
              mixed={width.mixed}
              min={0}
              max={20}
              step={0.25}
              onChange={(v) => set({ width: v })}
            />
            <Select
              label="Border style"
              value={dash.value}
              mixed={dash.mixed}
              options={DASHES}
              onChange={(v) => set({ dash: v })}
            />
          </div>
        </>
      )}
    </>
  )
}

function FillFieldsShared({ picked, theme, setMany }: FieldsProps) {
  const all = picked.map((p) => ({ p, f: fillOf(p.item)! }))
  const solid = all.flatMap((x) =>
    x.f.value?.type === 'solid'
      ? [{ ...x, s: x.f.value as Extract<FillStyle, { type: 'solid' }> }]
      : [],
  )
  const anyOn = solid.length > 0
  const set = (patch: { color?: ColorRef; opacity?: number }) =>
    setMany(
      solid.map(({ p, f, s }) => ({ index: p.index, path: [f.path], value: { ...s, ...patch } })),
      'Fill',
    )
  const color = shared(solid.map((x) => x.s.color))
  const opacity = shared(solid.map((x) => x.s.opacity))
  return (
    <>
      <Checkbox
        label="Fill"
        checked={anyOn}
        mixed={anyOn && solid.length < all.length}
        onChange={(v) =>
          setMany(
            all.map(({ p, f }) => ({
              index: p.index,
              path: [f.path],
              value: v
                ? f.value?.type === 'solid'
                  ? f.value
                  : { type: 'solid', color: f.color, opacity: 1 }
                : undefined,
            })),
            'Fill',
          )
        }
      />
      {anyOn && (
        <>
          <ColorRefField
            label="Fill colour"
            value={color.value}
            mixed={color.mixed}
            palette={theme.palette}
            fallback="#ffffff"
            onChange={(v) => set({ color: v })}
          />
          <NumberInput
            label="Fill opacity (0–1)"
            value={opacity.value}
            mixed={opacity.mixed}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => set({ opacity: v })}
          />
        </>
      )}
    </>
  )
}
