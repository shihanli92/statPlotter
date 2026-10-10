import { ARCSINH_COFACTOR, isCytoScale, isLogScale, logicleError, logicleParams } from '@ps/graph'
import {
  type AxisSpec,
  type NumberDisplay,
  richPlain,
  type StrokeStyle,
  type TickStyle,
} from '@ps/model'
import { Checkbox, NumberInput, Section, Select, TextInput } from '../../components/fields.tsx'
import { RichTextField, StrokeFields, sparseStroke } from '../../components/formatFields.tsx'
import type { AxisKey } from '../canvasEdit.ts'
import {
  BreaksSection,
  ScaleBarSection,
  SpansSection,
  TickValuesSection,
  TreatmentGridSection,
} from './AxisExtras.tsx'
import { effectiveText, type PanelContext } from './context.ts'
import { COMMON_TEXT, OTHER_TEXT, TextParts, textLabels } from './textParts.tsx'
import { removeRightAxisCommands } from './yAxis.ts'

// Roadmap 46 (stage 2): an axis' place in the Format panel, by element — Common (range and scale,
// interval and minor ticks, tick direction, its title and the title's and tick labels' font),
// then sections: Numbers (or a category axis' Labels), Title, Ticks, Ticks at values, Grid lines,
// Axis line and crossing, Axis breaks, Scale bar; a category X axis' treatment grid and spanning
// labels; the right Y axis' removal.

type Continuous = Extract<AxisSpec, { type: 'continuous' }>

const GRID: StrokeStyle = { color: { rgb: '#d9d9d9' }, width: 0.5, dash: 'solid' }
const MINOR_GRID: StrokeStyle = { color: { rgb: '#eeeeee' }, width: 0.5, dash: 'solid' }

const ROTATIONS = [
  { value: 0, label: 'Horizontal' },
  { value: 45, label: '45°' },
  { value: 90, label: 'Vertical' },
] as const

/** What an axis section is given. */
export interface AxisProps {
  ctx: PanelContext
  which: AxisKey
}

/** Writes a value at a path of the axis. */
const axisSetter =
  ({ ctx, which }: AxisProps) =>
  (path: (string | number)[], v: unknown, label?: string) =>
    ctx.set(['axes', which, ...path], v, label)

const tickStyleOf = (axis: AxisSpec): TickStyle => axis.tickStyle ?? {}

/** The tick labels' fields, named for them. */
const TICK_LABEL_TEXT = {
  ...textLabels('Tick label'),
  bold: 'Bold tick labels',
  italic: 'Italic tick labels',
}

/**
 * Roadmap 46 (stage 2, the user's choice): an axis' Common settings — its range and scale
 * (automatic or a minimum and maximum, linear or log…), the major tick interval and minor ticks,
 * the tick marks' direction, and its title with the title's and tick labels' font, size and bold.
 * A category axis: its labels' angle in place of the range.
 */
export function AxisCommon(p: AxisProps) {
  const { ctx, which } = p
  const { theme, palette } = ctx
  const axis = ctx.graph.axes[which]
  if (!axis) return <p className="muted">This graph has no right Y axis.</p>
  const set = axisSetter(p)
  const ticks = tickStyleOf(axis)
  return (
    <Section title="Common">
      {axis.type === 'continuous' && <RangeFields ctx={ctx} which={which} axis={axis} />}
      {axis.type === 'categorical' && (
        <Select
          label="Label angle"
          value={axis.rotation}
          options={ROTATIONS}
          onChange={(v) => set(['rotation'], v)}
        />
      )}
      <Select
        label="Tick marks"
        value={ticks.direction ?? theme.tickDirection}
        options={[
          { value: 'out', label: 'Outside' },
          { value: 'in', label: 'Inside' },
          { value: 'cross', label: 'Crossing' },
          { value: 'none', label: 'None' },
        ]}
        onChange={(direction) => set(['tickStyle'], { ...ticks, direction }, 'Format ticks')}
      />
      <RichTextField
        label="Title"
        value={axis.title?.content}
        multiline
        placeholder="No title"
        textStyle={effectiveText(ctx, theme.axisTitle, axis.title?.style)}
        palette={palette}
        onChange={(rt) =>
          set(['title'], rt ? { content: rt, style: axis.title?.style } : null, 'Axis title')
        }
      />
      {axis.title && (
        <TextParts
          parts={COMMON_TEXT}
          labels={textLabels('Title')}
          value={axis.title.style}
          inherited={effectiveText(ctx, theme.axisTitle)}
          palette={palette}
          onChange={(s) => set(['title', 'style'], s, 'Format axis title')}
        />
      )}
      <TextParts
        parts={COMMON_TEXT}
        labels={TICK_LABEL_TEXT}
        value={axis.tickLabels}
        inherited={effectiveText(ctx, theme.tickLabel)}
        palette={palette}
        onChange={(s) =>
          set(['tickLabels'], s, axis.type === 'continuous' ? 'Format numbers' : 'Format labels')
        }
      />
    </Section>
  )
}

/** A category axis' labels: shown or not, their colour and slant (their font is in Common). */
export function AxisLabelsSection(p: AxisProps) {
  const { ctx, which } = p
  const axis = ctx.graph.axes[which]
  if (axis?.type !== 'categorical') return null
  const set = axisSetter(p)
  return (
    <Section title="Labels">
      <Checkbox
        label="Show labels"
        checked={axis.showLabels !== false}
        onChange={(v) => set(['showLabels'], v ? undefined : false)}
      />
      <TextParts
        parts={OTHER_TEXT}
        labels={TICK_LABEL_TEXT}
        value={axis.tickLabels}
        inherited={effectiveText(ctx, ctx.theme.tickLabel)}
        palette={ctx.palette}
        reset
        onChange={(s) => set(['tickLabels'], s, 'Format labels')}
      />
    </Section>
  )
}

/** An axis title's colour, slant and distance from the axis (its text and font are in Common). */
export function AxisTitleSection(p: AxisProps) {
  const { ctx, which } = p
  const axis = ctx.graph.axes[which]
  if (!axis) return null
  const set = axisSetter(p)
  return (
    <Section title="Title">
      {axis.title ? (
        <TextParts
          parts={OTHER_TEXT}
          labels={textLabels('Title')}
          value={axis.title.style}
          inherited={effectiveText(ctx, ctx.theme.axisTitle)}
          palette={ctx.palette}
          reset
          onChange={(s) => set(['title', 'style'], s, 'Format axis title')}
        />
      ) : (
        <p className="muted">Type a title in Common to format it.</p>
      )}
      <NumberInput
        label="Extra space between title and axis (pt)"
        value={axis.titleGap ?? 0}
        min={0}
        max={72}
        onChange={(v) => set(['titleGap'], v || undefined)}
      />
    </Section>
  )
}

/** The ticks' length and thickness (their direction and interval are in Common). */
export function AxisTicksSection(p: AxisProps) {
  const { ctx, which } = p
  const { theme } = ctx
  const axis = ctx.graph.axes[which]
  if (!axis) return null
  const set = axisSetter(p)
  const ticks = tickStyleOf(axis)
  const setTicks = (patch: TickStyle) => set(['tickStyle'], { ...ticks, ...patch }, 'Format ticks')
  const lineStroke: StrokeStyle = { ...theme.axisLine, ...axis.line }
  return (
    <Section title="Ticks">
      <div className="field-row">
        <NumberInput
          label="Tick length (pt)"
          value={ticks.length ?? theme.tickLength}
          min={0}
          max={36}
          step={0.5}
          onChange={(length) => setTicks({ length })}
        />
        <NumberInput
          label="Tick thickness (pt)"
          value={ticks.width ?? theme.tickWidth ?? lineStroke.width}
          min={0}
          max={10}
          step={0.25}
          onChange={(width) => setTicks({ width })}
        />
      </div>
      {axis.type === 'continuous' && (
        <NumberInput
          label="Minor tick length (pt)"
          value={ticks.minorLength ?? theme.minorTickLength}
          min={0}
          max={36}
          step={0.5}
          onChange={(minorLength) => setTicks({ minorLength })}
        />
      )}
    </Section>
  )
}

/** The axis line, whether the axis shows, where it sits and where it crosses the other. */
export function AxisLineSection(p: AxisProps) {
  const { ctx, which } = p
  const { theme, palette } = ctx
  const axis = ctx.graph.axes[which]
  if (!axis) return null
  const set = axisSetter(p)
  const lineStroke: StrokeStyle = { ...theme.axisLine, ...axis.line }
  const hidden = axis.show === false
  return (
    <Section title="Axis line and crossing">
      <Checkbox
        label="Show the axis (line, ticks and labels)"
        checked={!hidden}
        onChange={(v) => set(['show'], v ? undefined : false, v ? 'Show axis' : 'Hide axis')}
      />
      {!hidden && (
        <StrokeFields
          label="Axis line"
          value={lineStroke}
          palette={palette}
          onChange={(s) =>
            s && set(['line'], sparseStroke(s, theme.axisLine, axis.line), 'Format axis line')
          }
        />
      )}
      {axis.type === 'continuous' && (
        <Select
          label="Position"
          value={axis.frame}
          options={[
            { value: 'plain', label: 'Touching the other axis' },
            { value: 'offset', label: 'Offset (a gap at the origin)' },
          ]}
          onChange={(v) => set(['frame'], v)}
        />
      )}
      {axis.type === 'continuous' && which !== 'y2' && (
        <TextInput
          label={`${which === 'x' ? 'X' : 'Y'} axis crosses the other axis at (blank = its start)`}
          value={axis.anchor === undefined ? '' : String(axis.anchor)}
          onChange={(v) => {
            const n = Number(v)
            if (v.trim() === '') set(['anchor'], undefined, 'Axis position')
            else if (Number.isFinite(n)) set(['anchor'], n, 'Axis position')
          }}
        />
      )}
    </Section>
  )
}

/** Major and minor grid lines. */
export function AxisGridSection(p: AxisProps) {
  const { ctx, which } = p
  const axis = ctx.graph.axes[which]
  if (!axis) return null
  const set = axisSetter(p)
  return (
    <Section title="Grid lines">
      <StrokeFields
        label="Major grid lines"
        value={axis.grid?.major}
        palette={ctx.palette}
        optional={{ defaults: GRID }}
        onChange={(s) => set(['grid'], { ...axis.grid, major: s }, 'Grid lines')}
      />
      {axis.type === 'continuous' && (
        <StrokeFields
          label="Minor grid lines"
          value={axis.grid?.minor}
          palette={ctx.palette}
          optional={{ defaults: MINOR_GRID }}
          onChange={(s) => set(['grid'], { ...axis.grid, minor: s }, 'Grid lines')}
        />
      )}
    </Section>
  )
}

/** One of an axis' extras: ticks at typed values, breaks, a scale bar; a category X axis' grid. */
export function AxisExtra({
  ctx,
  which,
  part,
}: AxisProps & { part: 'tickValues' | 'breaks' | 'scaleBar' | 'treatments' | 'spans' }) {
  const axis = ctx.graph.axes[which]
  if (!axis) return null
  if (axis.type === 'continuous') {
    if (part === 'tickValues') return <TickValuesSection ctx={ctx} which={which} axis={axis} />
    if (part === 'breaks')
      return axis.scale === 'linear' || axis.scale === 'log10' || axis.scale === 'log2' ? (
        <BreaksSection ctx={ctx} which={which} axis={axis} />
      ) : null
    if (part === 'scaleBar') return <ScaleBarSection ctx={ctx} which={which} axis={axis} />
    return null
  }
  // Roadmap 36: a +/− grid and spanning labels under the categories.
  if (which !== 'x' || (ctx.graph.frame !== 'category' && ctx.graph.frame !== 'grouped'))
    return null
  if (part === 'treatments') return <TreatmentGridSection ctx={ctx} axis={axis} />
  if (part === 'spans') return <SpansSection ctx={ctx} axis={axis} />
  return null
}

/** The right Y axis: taking it off. */
export function RightAxisRemoveSection({ ctx, which }: AxisProps) {
  if (which !== 'y2' || !ctx.graph.axes.y2) return null
  return (
    <Section title="Right Y axis">
      <p className="muted">Each data set chooses its axis in its own Advanced section.</p>
      <button
        type="button"
        className="danger"
        onClick={() => ctx.dispatch(removeRightAxisCommands(ctx.graph), 'Remove right Y axis')}
      >
        Remove the right Y axis (its data go back to the left)
      </button>
    </Section>
  )
}

/** Roadmap 34g: an arcsinh axis' cofactor (CyTOF's 5, flow cytometry's 150, or any). */
function ArcsinhFields({
  ctx,
  which,
  axis,
}: {
  ctx: PanelContext
  which: AxisKey
  axis: Continuous
}) {
  const cofactor = axis.arcsinh?.cofactor ?? ARCSINH_COFACTOR
  const set = (v: number) =>
    v > 0
      ? ctx.set(['axes', which, 'arcsinh'], { cofactor: v }, 'Arcsinh cofactor')
      : ctx.onError('The cofactor must be above zero.')
  return (
    <div className="field-row">
      <NumberInput label="Cofactor (asinh(x / cofactor))" value={cofactor} min={0} onChange={set} />
      <Select
        label="Typical"
        value={cofactor === 5 ? '5' : cofactor === 150 ? '150' : ''}
        options={[
          { value: '', label: 'Other' },
          { value: '5', label: 'Mass cytometry (5)' },
          { value: '150', label: 'Flow cytometry (150)' },
        ]}
        onChange={(v) => v && set(Number(v))}
      />
    </div>
  )
}

/**
 * Roadmap 34g: a logicle axis' parameters as flowCore names them (T top of scale, W linear
 * decades, M decades, A extra negative decades), each checked as the logicle scale needs.
 */
function LogicleFields({
  ctx,
  which,
  axis,
}: {
  ctx: PanelContext
  which: AxisKey
  axis: Continuous
}) {
  const p = logicleParams(axis.logicle)
  const set = (k: 'T' | 'W' | 'M' | 'A', v: number) => {
    const next = { ...axis.logicle, [k]: v }
    const problem = logicleError(next)
    if (problem) ctx.onError(`Logicle: ${problem}.`)
    else ctx.set(['axes', which, 'logicle'], next, 'Logicle parameters')
  }
  return (
    <>
      <div className="field-row">
        <NumberInput label="Top of scale (T)" value={p.T} min={1} onChange={(v) => set('T', v)} />
        <NumberInput
          label="Linear decades (W)"
          value={p.W}
          min={0}
          step={0.1}
          onChange={(v) => set('W', v)}
        />
      </div>
      <div className="field-row">
        <NumberInput
          label="Decades (M)"
          value={p.M}
          min={1}
          step={0.5}
          onChange={(v) => set('M', v)}
        />
        <NumberInput
          label="Extra negative decades (A)"
          value={p.A}
          step={0.5}
          onChange={(v) => set('A', v)}
        />
      </div>
    </>
  )
}

/** An axis' scale, range, reversal, tick interval and minor ticks (in Common). */
function RangeFields({
  ctx,
  which,
  axis,
}: {
  ctx: PanelContext
  which: AxisKey
  axis: Continuous
}) {
  const set = (path: (string | number)[], v: unknown, label?: string) =>
    ctx.set(['axes', which, ...path], v, label)
  const manual = axis.range !== 'auto'
  const t = axis.ticks === 'auto' ? null : axis.ticks
  return (
    <>
      {!ctx.graph.layers.some((l) => l.stat.kind === 'km') && (
        <Select
          label="Scale"
          value={axis.scale}
          options={[
            { value: 'linear', label: 'Linear' },
            { value: 'log10', label: 'Log 10' },
            { value: 'log2', label: 'Log 2' },
            // Roadmap 34g: cytometry display scales (zero and negative values shown).
            { value: 'arcsinh', label: 'Arcsinh (cytometry)' },
            { value: 'logicle', label: 'Logicle / biexponential' },
          ]}
          onChange={(v) => {
            // A log axis can't start at zero or below: fall back to an automatic range.
            const badRange =
              isLogScale(v as Continuous['scale']) && axis.range !== 'auto' && axis.range.min <= 0
            ctx.dispatch(
              [
                { type: 'node.set', id: ctx.graph.id, path: ['axes', which, 'scale'], value: v },
                ...(badRange
                  ? [
                      {
                        type: 'node.set' as const,
                        id: ctx.graph.id,
                        path: ['axes', which, 'range'],
                        value: 'auto',
                      },
                    ]
                  : []),
              ],
              'Axis scale',
            )
          }}
        />
      )}
      {axis.scale === 'arcsinh' && <ArcsinhFields ctx={ctx} which={which} axis={axis} />}
      {axis.scale === 'logicle' && <LogicleFields ctx={ctx} which={which} axis={axis} />}
      <Checkbox
        label="Automatic range"
        checked={!manual}
        onChange={(auto) =>
          set(
            ['range'],
            auto
              ? 'auto'
              : {
                  min: isLogScale(axis.scale) ? 1 : 0,
                  max: isLogScale(axis.scale) ? 1000 : isCytoScale(axis.scale) ? 1e5 : 10,
                },
            'Axis range',
          )
        }
      />
      {axis.range !== 'auto' && (
        <div className="field-row">
          <NumberInput
            label="Minimum"
            value={axis.range.min}
            onChange={(v) =>
              axis.range === 'auto' || v >= axis.range.max
                ? ctx.onError('The minimum must be below the maximum.')
                : isLogScale(axis.scale) && v <= 0
                  ? ctx.onError('A log axis must start above zero.')
                  : set(['range', 'min'], v, 'Axis range')
            }
          />
          <NumberInput
            label="Maximum"
            value={axis.range.max}
            onChange={(v) =>
              axis.range !== 'auto' && v > axis.range.min
                ? set(['range', 'max'], v, 'Axis range')
                : ctx.onError('The maximum must be above the minimum.')
            }
          />
        </div>
      )}
      <Checkbox
        label="Reverse the axis"
        checked={!!axis.reverse}
        onChange={(v) => set(['reverse'], v || undefined, 'Reverse axis')}
      />
      {axis.scale === 'linear' && (
        <>
          <div className="field-row">
            <NumberInput
              label="Major tick interval (0 = auto)"
              value={t?.interval ?? 0}
              min={0}
              onChange={(v) =>
                set(
                  ['ticks'],
                  v > 0 ? { interval: v, start: t?.start, minor: t?.minor ?? 0 } : 'auto',
                  'Tick interval',
                )
              }
            />
            <NumberInput
              label="Minor ticks per interval"
              value={t?.minor ?? 0}
              min={0}
              max={9}
              step={1}
              onChange={(minor) =>
                t
                  ? set(['ticks', 'minor'], Math.round(minor), 'Minor ticks')
                  : ctx.onError('Set a major tick interval first.')
              }
            />
          </div>
          {t && (
            <TextInput
              label="First tick at (blank = automatic)"
              value={t.start === undefined ? '' : String(t.start)}
              onChange={(v) => {
                const n = Number(v)
                if (v.trim() === '') set(['ticks', 'start'], undefined, 'Tick start')
                else if (Number.isFinite(n)) set(['ticks', 'start'], n, 'Tick start')
              }}
            />
          )}
        </>
      )}
    </>
  )
}

const FORMAT_MODES: { value: NumberDisplay['mode']; label: string }[] = [
  { value: 'auto', label: 'Automatic' },
  { value: 'fixed', label: 'Fixed decimals' },
  { value: 'scientific', label: 'Scientific (1.2e+3)' },
  { value: 'power10', label: 'Power of 10 (1.2×10³)' },
  { value: 'percent', label: 'Percent (×100 %)' },
]

const SUPERSCRIPT: Record<string, string> = {
  '-': '⁻',
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
}
const tenTo = (n: number) => `×10${[...String(n)].map((c) => SUPERSCRIPT[c] ?? c).join('')}`
/** Tick labels in units of 10ⁿ, for axes titled "(×10⁴)". */
const LABEL_POWERS = [0, 3, 4, 5, 6, 9, 2, 1, -1, -2, -3, -6].map((n) => ({
  value: n,
  label: n === 0 ? 'Data units' : `${tenTo(n)} (${n > 0 ? `${10 ** n} → 1` : `1 → ${10 ** -n}`})`,
}))

/**
 * A number axis' numbers: shown or not, their format and decimals, units of 10ⁿ, separators,
 * affixes, angle, and their slant and colour (their font, size and bold are in Common).
 */
export function AxisNumbersSection({ ctx, which }: AxisProps) {
  const axis = ctx.graph.axes[which]
  if (axis?.type !== 'continuous') return null
  const set = (path: (string | number)[], v: unknown, label?: string) =>
    ctx.set(['axes', which, ...path], v, label)
  const f = axis.format
  const setFormat = (patch: Partial<NumberDisplay>) =>
    set(['format'], { ...f, ...patch }, 'Number format')
  const titleText = richPlain(axis.title?.content)
  return (
    <Section title="Numbers">
      <Checkbox
        label="Show numbers"
        checked={axis.showLabels !== false}
        onChange={(v) => set(['showLabels'], v ? undefined : false, 'Show numbers')}
      />
      <div className="field-row">
        <Select
          label="Number format"
          value={f.mode}
          options={FORMAT_MODES}
          onChange={(mode) => setFormat({ mode })}
        />
        {f.mode !== 'auto' && (
          <NumberInput
            label="Decimals"
            value={f.digits ?? (f.mode === 'fixed' || f.mode === 'percent' ? 0 : 1)}
            min={0}
            max={15}
            step={1}
            onChange={(digits) => setFormat({ digits: Math.round(digits) })}
          />
        )}
      </div>
      <div className="field-row">
        <Select
          label="Numbers in units of"
          value={axis.labelPower ?? 0}
          options={LABEL_POWERS}
          onChange={(n) => set(['labelPower'], n || undefined, 'Label scale')}
        />
        {!!axis.labelPower && !titleText.includes('×10') && (
          <button
            type="button"
            className="small"
            title="Say in the axis title what the numbers are multiplied by"
            onClick={() =>
              set(
                ['title'],
                {
                  ...(axis.title ?? {}),
                  content: [
                    ...(axis.title?.content ?? []),
                    { text: `${titleText ? ' ' : ''}(×10` },
                    { text: String(axis.labelPower).replace('-', '−'), sup: true },
                    { text: ')' },
                  ],
                },
                'Axis title',
              )
            }
          >
            Add “({tenTo(axis.labelPower)})” to title
          </button>
        )}
      </div>
      <Checkbox
        label="Thousands separators (1,000)"
        checked={!!f.thousands}
        onChange={(thousands) => setFormat({ thousands: thousands || undefined })}
      />
      <div className="field-row">
        <TextInput
          label="Number prefix"
          value={f.prefix ?? ''}
          onChange={(prefix) => setFormat({ prefix: prefix || undefined })}
        />
        <TextInput
          label="Number suffix"
          value={f.suffix ?? ''}
          onChange={(suffix) => setFormat({ suffix: suffix || undefined })}
        />
      </div>
      <Select
        label="Number angle"
        value={axis.rotation ?? 0}
        options={ROTATIONS}
        onChange={(v) => set(['rotation'], v || undefined, 'Label angle')}
      />
      <TextParts
        parts={OTHER_TEXT}
        labels={TICK_LABEL_TEXT}
        value={axis.tickLabels}
        inherited={effectiveText(ctx, ctx.theme.tickLabel)}
        palette={ctx.palette}
        reset
        onChange={(s) => set(['tickLabels'], s, 'Format numbers')}
      />
    </Section>
  )
}
