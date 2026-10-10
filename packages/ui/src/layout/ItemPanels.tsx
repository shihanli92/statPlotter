import { resolveText, TABLE_TEXT_SIZE, TEXT_BOX_PAD, type Theme } from '@ps/graph'
import type {
  AnalysisResult,
  AssetId,
  GraphNode,
  ImageAsset,
  LayoutItem,
  LayoutItemOf,
  NodeId,
  Project,
} from '@ps/model'
import { ArrowheadFields } from '../components/arrowFields.tsx'
import { Checkbox, NumberInput, Section, Select } from '../components/fields.tsx'
import {
  FillFields,
  RichTextField,
  StrokeFields,
  TEXT_ALIGNS,
  TextStyleFields,
  THIN_BORDER,
} from '../components/formatFields.tsx'
import { inUnit, useUnit } from '../styles/units.ts'
import { cropEdges, cropImage, imageAspect } from './items.ts'
import { sourceKey, tableSourceChoices } from './tableSources.ts'
import { DEFAULT_STROKE } from './tools.ts'

// The layout page's inspector for a selected item (roadmap 32): what each kind of item has, its
// position and size, and its lock.

const PT_PER_IN = 72
const UNIT_NAMES = { in: 'inches', mm: 'mm', pt: 'points' } as const

interface ItemPanelProps<T extends LayoutItem = LayoutItem> {
  item: T
  project: Project
  theme: Theme
  graphs: readonly GraphNode[]
  result: (id: NodeId) => AnalysisResult | undefined
  asset: (id: AssetId) => ImageAsset | undefined
  /** Sets a field of the item (a path within it). */
  set: (path: (string | number)[], value: unknown, label?: string) => void
  /** Replaces the item. */
  replace: (item: LayoutItem, label: string) => void
}

/** The kind's own sections, then Position (and size). */
export function ItemPanels(p: ItemPanelProps) {
  const it = p.item
  return (
    <>
      {it.type === 'graph' && <GraphPanel {...p} item={it} />}
      {it.type === 'text' && <TextPanel {...p} item={it} />}
      {it.type === 'line' && <LinePanel {...p} item={it} />}
      {it.type === 'shape' && <ShapePanel {...p} item={it} />}
      {it.type === 'image' && <ImagePanel {...p} item={it} />}
      {it.type === 'table' && <TablePanel {...p} item={it} />}
      <PositionPanel {...p} />
    </>
  )
}

function GraphPanel({ item, graphs, set }: ItemPanelProps<LayoutItemOf<'graph'>>) {
  return (
    <Section title="Graph">
      <Select
        label="Graph"
        value={item.graph}
        options={graphs.map((g) => ({ value: g.id, label: g.name }))}
        onChange={(v) => set(['graph'], v, 'Change graph')}
      />
      <NumberInput
        // The whole placed graph, as a picture; the graph's own "Scale text and marks" (Format
        // graph) is separate.
        label="Size on page (%)"
        value={Math.round(item.scale * 1000) / 10}
        min={5}
        max={500}
        onChange={(v) => set(['scale'], v / 100, 'Resize graph')}
      />
    </Section>
  )
}

function TextPanel({ item, theme, set, replace }: ItemPanelProps<LayoutItemOf<'text'>>) {
  const unit = useUnit()
  const style = resolveText(theme.text, item.content.style)
  const align = (v: string) => set(['content', 'align'], v === 'left' ? undefined : v, 'Align text')
  const framed = !!item.border || item.background?.type === 'solid'
  return (
    <>
      <Section title="Text">
        {/* Rich, with its formatting kept (roadmap 28). */}
        <RichTextField
          label="Text"
          value={item.content.content}
          multiline
          textStyle={style}
          palette={theme.palette}
          align={item.content.align ?? 'left'}
          onAlign={align}
          onChange={(rt) => set(['content', 'content'], rt ?? [{ text: '' }], 'Edit text')}
        />
        <Select
          label="Lines"
          value={item.content.align ?? 'left'}
          options={TEXT_ALIGNS}
          onChange={align}
        />
        <TextStyleFields
          value={item.content.style}
          inherited={theme.text}
          palette={theme.palette}
          onChange={(s) => set(['content', 'style'], s, 'Format text')}
        />
      </Section>
      <Section title="Box">
        <Checkbox
          label="Wrap lines at a width"
          checked={item.width !== undefined}
          onChange={(v) => {
            const { width: _, ...rest } = item
            replace(v ? { ...rest, width: 144 } : rest, v ? 'Wrap text' : 'Unwrap text')
          }}
        />
        {item.width !== undefined && (
          <NumberInput
            label={`Width (${unit.id})`}
            value={inUnit(item.width, unit)}
            min={7.2 / unit.per}
            max={7200 / unit.per}
            step={unit.step}
            onChange={(v) => set(['width'], v * unit.per, 'Text width')}
          />
        )}
        <StrokeFields
          label="Border"
          value={item.border}
          palette={theme.palette}
          optional={{ defaults: THIN_BORDER }}
          onChange={(s) => set(['border'], s, 'Text box')}
        />
        <FillFields
          label="Background"
          value={item.background}
          palette={theme.palette}
          onChange={(f) => set(['background'], f, 'Text box')}
        />
        {framed && (
          <NumberInput
            label="Padding (pt)"
            value={item.padding ?? TEXT_BOX_PAD}
            min={0}
            max={72}
            onChange={(v) => set(['padding'], v, 'Text box')}
          />
        )}
      </Section>
    </>
  )
}

function LinePanel({ item, theme, set }: ItemPanelProps<LayoutItemOf<'line'>>) {
  return (
    <Section title="Line">
      <StrokeFields
        label="Line"
        value={item.stroke}
        palette={theme.palette}
        onChange={(s) => set(['stroke'], s ?? DEFAULT_STROKE, 'Format line')}
      />
      <ArrowheadFields
        value={item.heads ?? {}}
        onChange={(h) => set(['heads'], h.start || h.end ? h : undefined, 'Arrowheads')}
      />
    </Section>
  )
}

function ShapePanel({ item, theme, set }: ItemPanelProps<LayoutItemOf<'shape'>>) {
  return (
    <Section title="Shape">
      <Select
        label="Shape"
        value={item.shape}
        options={[
          { value: 'rect', label: 'Rectangle' },
          { value: 'ellipse', label: 'Ellipse' },
        ]}
        onChange={(v) => set(['shape'], v, 'Change shape')}
      />
      {item.shape === 'rect' && (
        <NumberInput
          label="Corner radius (pt)"
          value={item.radius ?? 0}
          min={0}
          max={1000}
          onChange={(v) => set(['radius'], v || undefined, 'Round corners')}
        />
      )}
      <StrokeFields
        label="Outline"
        value={item.stroke}
        palette={theme.palette}
        optional={{ defaults: DEFAULT_STROKE }}
        onChange={(s) => set(['stroke'], s, 'Outline')}
      />
      <FillFields
        label="Fill"
        value={item.fill}
        palette={theme.palette}
        defaultColor={{ palette: 0 }}
        onChange={(f) => set(['fill'], f, 'Fill')}
      />
    </Section>
  )
}

function ImagePanel({ item, theme, asset, set, replace }: ItemPanelProps<LayoutItemOf<'image'>>) {
  const a = asset(item.asset)
  const edges = cropEdges(item.crop)
  const crop = (patch: Partial<typeof edges>) =>
    replace(cropImage(item, { ...edges, ...patch }), 'Crop image')
  const aspect = imageAspect(item, a)
  return (
    <>
      <Section title="Image">
        <p className="muted">
          {a
            ? `${a.width} × ${a.height} pixels, ${a.mime === 'image/png' ? 'PNG' : 'JPEG'}; ${Math.round((a.width * (item.crop?.w ?? 1) * PT_PER_IN) / Math.max(item.w, 1e-9))} dpi as placed`
            : 'The image is missing from this project.'}
        </p>
        <Checkbox
          label="Keep proportions when resizing"
          checked={!item.freeAspect}
          onChange={(v) => set(['freeAspect'], v ? undefined : true, 'Image proportions')}
        />
        {aspect && Math.abs(item.w / item.h - aspect) > 0.005 && (
          <button
            type="button"
            onClick={() =>
              set(['h'], Math.round((item.w / aspect) * 100) / 100, 'Image proportions')
            }
          >
            Restore the proportions
          </button>
        )}
        <StrokeFields
          label="Border"
          value={item.border}
          palette={theme.palette}
          optional={{ defaults: THIN_BORDER }}
          onChange={(s) => set(['border'], s, 'Image border')}
        />
      </Section>
      <Section title="Crop (% of the image)">
        <div className="field-row">
          <NumberInput
            label="Left"
            value={edges.left}
            min={0}
            max={99}
            onChange={(v) => crop({ left: v })}
          />
          <NumberInput
            label="Right"
            value={edges.right}
            min={0}
            max={99}
            onChange={(v) => crop({ right: v })}
          />
        </div>
        <div className="field-row">
          <NumberInput
            label="Top"
            value={edges.top}
            min={0}
            max={99}
            onChange={(v) => crop({ top: v })}
          />
          <NumberInput
            label="Bottom"
            value={edges.bottom}
            min={0}
            max={99}
            onChange={(v) => crop({ bottom: v })}
          />
        </div>
        {item.crop && (
          <button type="button" onClick={() => crop({ left: 0, right: 0, top: 0, bottom: 0 })}>
            Reset crop
          </button>
        )}
      </Section>
    </>
  )
}

function TablePanel({ item, project, theme, result, set }: ItemPanelProps<LayoutItemOf<'table'>>) {
  const choices = tableSourceChoices(project, result)
  const key = sourceKey(item.source)
  const known = choices.some((c) => c.value === key)
  const range = (which: 'rows' | 'columns', label: string) => {
    const r = item[which]
    const upd = (from: number, to: number | undefined) =>
      set(
        [which],
        from <= 0 && to === undefined
          ? undefined
          : { from: Math.max(0, from), ...(to !== undefined ? { to } : {}) },
        `Table ${which}`,
      )
    return (
      <div className="field-row">
        <NumberInput
          label={`First ${label}`}
          value={(r?.from ?? 0) + 1}
          min={1}
          step={1}
          onChange={(v) => upd(Math.round(v) - 1, r?.to)}
        />
        <NumberInput
          label={`Last ${label} (0: all)`}
          value={r?.to === undefined ? 0 : r.to + 1}
          min={0}
          step={1}
          onChange={(v) => upd(r?.from ?? 0, v >= 1 ? Math.round(v) - 1 : undefined)}
        />
      </div>
    )
  }
  return (
    <Section title="Table">
      <Select
        label="Shows"
        value={known ? key : ''}
        options={[
          ...(known ? [] : [{ value: '', label: 'Not available now' }]),
          ...choices.map((c) => ({ value: c.value, label: c.label })),
        ]}
        onChange={(v) => {
          const c = choices.find((x) => x.value === v)
          if (c) set(['source'], c.source, 'Table source')
        }}
      />
      {range('rows', 'row')}
      {range('columns', 'column')}
      <p className="muted">Rows count after the title rows, which always show.</p>
      <TextStyleFields
        value={item.text}
        inherited={{ ...theme.text, size: TABLE_TEXT_SIZE }}
        palette={theme.palette}
        onChange={(s) => set(['text'], s, 'Format table')}
      />
      <Checkbox
        label="Titles in bold"
        checked={item.headerBold ?? true}
        onChange={(v) => set(['headerBold'], v ? undefined : false, 'Format table')}
      />
      <Select
        label="Grid lines"
        value={item.grid ?? 'all'}
        options={[
          { value: 'all', label: 'Between all cells' },
          { value: 'rows', label: 'Between rows' },
          { value: 'none', label: 'None' },
        ]}
        onChange={(v) => set(['grid'], v === 'all' ? undefined : v, 'Format table')}
      />
      {(item.grid ?? 'all') !== 'none' && (
        <StrokeFields
          label="Grid"
          value={item.gridStroke ?? { color: { rgb: '#999999' }, width: 0.5, dash: 'solid' }}
          palette={theme.palette}
          onChange={(s) => set(['gridStroke'], s, 'Format table')}
        />
      )}
    </Section>
  )
}

/**
 * Where the item is (from the page's top left, in the unit chosen in Preferences: inches unless
 * another), its size, and its lock.
 */
function PositionPanel({ item, set, replace }: ItemPanelProps) {
  const unit = useUnit()
  const title = `Position (${UNIT_NAMES[unit.id]} from top left)`
  const at = (label: string, pt: number, path: (string | number)[], what: string) => (
    <NumberInput
      label={label}
      value={inUnit(pt, unit)}
      step={unit.id === 'in' ? 0.05 : unit.step}
      onChange={(v) => set(path, v * unit.per, what)}
    />
  )
  const lock = (
    <Checkbox
      label="Locked (not picked or moved on the page)"
      checked={!!item.locked}
      onChange={(v) => {
        const { locked: _, ...rest } = item
        replace(v ? { ...rest, locked: true } : rest, v ? 'Lock item' : 'Unlock item')
      }}
    />
  )
  if (item.type === 'line')
    return (
      <Section title={title}>
        <div className="field-row">
          {at('Start left', item.from.x, ['from', 'x'], 'Move line')}
          {at('Start top', item.from.y, ['from', 'y'], 'Move line')}
        </div>
        <div className="field-row">
          {at('End left', item.to.x, ['to', 'x'], 'Move line')}
          {at('End top', item.to.y, ['to', 'y'], 'Move line')}
        </div>
        {lock}
      </Section>
    )
  const sized = item.type === 'shape' || item.type === 'image'
  return (
    <Section title={title}>
      <div className="field-row">
        {at('Left', item.x, ['x'], 'Move item')}
        {at('Top', item.y, ['y'], 'Move item')}
      </div>
      {sized && (
        <div className="field-row">
          {at('Width', item.w, ['w'], 'Resize item')}
          {at('Height', item.h, ['h'], 'Resize item')}
        </div>
      )}
      {lock}
    </Section>
  )
}
