import type { Command } from '@ps/engine'
import {
  type Aesthetic,
  ARCSINH_COFACTOR,
  aesVariables,
  COLOR_MAPS,
  GRADIENT_COLORS,
  graphFillPalette,
  graphRows,
  layerStyle,
  levelShape,
  levelsNote,
  MISSING_POINT_COLOR,
  mappedPointsLayer,
  mappedVariable,
  sizeDefaults,
  tooManyLevels,
} from '@ps/graph'
import {
  type ColorMapName,
  type ColorScale,
  type GraphPathSegment,
  levelKey,
  type SizeScale,
  sourceTable,
} from '@ps/model'
import { ColorField } from '../../components/ColorPicker.tsx'
import { Checkbox, NumberInput, Section, Select, TextInput } from '../../components/fields.tsx'
import { colorOf, SHAPES } from '../../components/formatFields.tsx'
import { MAX_LISTED_LEVELS } from '../LevelOrder.tsx'
import { variableLabel } from '../rows.ts'
import type { PanelContext } from './context.ts'
import { NumberFormatFields } from './LayerFields.tsx'
import { layerPath } from './layers.ts'

// Format graph › Appearance › Appearance by variable (roadmap 34b): the variables mapped to
// colour, shape, size and labels, and how — each level's colour and symbol, a number variable's
// colour map, its range, out-of-range and missing colours and its colour bar, the sizes' range
// and scaling, the legends' headings. XY graphs of variables map them on their points (`aes`);
// category and grouped graphs in their mapping (a text colour variable makes the groups, chosen
// in Change layers…).

const LABELS: Record<Aesthetic, string> = {
  color: 'Colour',
  fill: 'Fill',
  shape: 'Shape',
  size: 'Size',
  label: 'Labels',
}

/**
 * Roadmap 49a: where a graph maps variables to appearance — its mapped points layer (an XY graph
 * of variables: `aes`) or its mapping (category and grouped graphs) — and its table; undefined
 * when it maps none.
 */
export function variableTarget(ctx: PanelContext) {
  const { graph, project } = ctx
  const table = sourceTable(project, graph.seriesSource.table, ctx.lookup)
  const points = graph.frame === 'xy' ? mappedPointsLayer(graph) : undefined
  const mapped =
    !!points || (!!graph.mapping && (graph.frame === 'category' || graph.frame === 'grouped'))
  if (table?.kind !== 'table' || !mapped) return undefined
  return { table, points }
}

/** The path a variable mapped to an aesthetic is written at. */
const variablePath = (points: { id: string } | undefined, field: Aesthetic): GraphPathSegment[] =>
  points ? layerPath(points.id, 'aes', field) : ['mapping', field]

/**
 * Roadmap 49a (shared with the Appearance table): the commands mapping a variable to an
 * aesthetic (none: unmapping it); a new legend of it shows the legend if it was hidden, and a
 * number colour starts on viridis with a colour bar, as in the builder (decision 303).
 */
export function variableCommands(ctx: PanelContext, field: Aesthetic, key: string): Command[] {
  const { graph } = ctx
  const target = variableTarget(ctx)
  if (!target) return []
  const { table, points } = target
  return [
    { type: 'node.set', id: graph.id, path: variablePath(points, field), value: key || undefined },
    ...(key && field !== 'label' && !graph.legend.show
      ? [{ type: 'node.set' as const, id: graph.id, path: ['legend', 'show'], value: true }]
      : []),
    // A number colour (roadmap 49d: or fill) starts on viridis with a colour bar.
    ...(key &&
    (field === 'color' || field === 'fill') &&
    !graph.scales?.[field] &&
    !table.dataSets.find((d) => d.id === key)?.text
      ? [
          {
            type: 'node.set' as const,
            id: graph.id,
            path: ['scales', field],
            value: { colors: 'viridis', bar: { show: true } },
          },
        ]
      : []),
  ]
}

/** Roadmap 49a (shared with the Appearance table): the variables an aesthetic can be mapped to. */
export function variableOptions(
  ctx: PanelContext,
  field: Aesthetic,
): { value: string; label: string }[] {
  const target = variableTarget(ctx)
  if (!target) return []
  const { table, points } = target
  const { graph } = ctx
  const vars = aesVariables(graph)
  const fits = table.dataSets.filter((d) =>
    field === 'shape'
      ? !!d.text
      : field === 'size'
        ? !d.text
        : field === 'color' && !points
          ? !d.text && d.id !== graph.mapping?.y && d.id !== graph.mapping?.x
          : // Roadmap 49d: fill by any variable but the axes' (the groups' fills them as data sets).
            field === 'fill' && !points
            ? d.id !== graph.mapping?.y && d.id !== graph.mapping?.x
            : true,
  )
  // Roadmap 34e: text variables of more than 1,000 levels are no colour or shape (they stay
  // listed while chosen); many levels are counted in the label.
  return [
    // Roadmap 49d: no fill variable is the colour's (fill and outline one colour, as before).
    { value: '', label: field === 'fill' ? 'Same as the colour' : 'None' },
    ...fits
      .filter(
        (d) => field === 'label' || field === 'size' || d.id === vars[field] || !tooManyLevels(d),
      )
      .map((d) => ({ value: d.id, label: `${variableLabel(d)}${levelsNote(d)}` })),
  ]
}

export function AppearanceByVariableSection({ ctx }: { ctx: PanelContext }) {
  const { graph, palette } = ctx
  const target = variableTarget(ctx)
  if (!target) return null
  const { table, points } = target
  const vars = aesVariables(graph)
  const rows = graphRows(graph, table)
  /** Maps a variable (none: unmaps); a new legend of it shows the legend if it was hidden. */
  const choose = (field: Aesthetic, key: string) =>
    ctx.dispatch(variableCommands(ctx, field, key), `${LABELS[field]} by variable`)
  const textColor = !points && !!table.dataSets.find((d) => d.id === vars.color)?.text
  const options = (field: Aesthetic) => variableOptions(ctx, field)
  const picker = (field: Aesthetic) => (
    <Select
      label={`${LABELS[field]} by`}
      value={vars[field] ?? ''}
      options={options(field)}
      onChange={(v) => choose(field, v)}
    />
  )
  const title = (field: 'color' | 'fill' | 'shape' | 'size') => {
    const v = mappedVariable(table, graph, vars[field], rows)
    if (!v) return null
    return (
      <TextInput
        label="Legend heading"
        value={graph.legend.titles?.[field] ?? ''}
        placeholder={v.title}
        onChange={(t) =>
          ctx.set(['legend', 'titles', field], t.trim() ? t : undefined, 'Legend heading')
        }
      />
    )
  }
  const color = mappedVariable(table, graph, vars.color, rows)
  // Roadmap 49d: the fill variable, on a scale of its own (absent: the colour's).
  const fill = mappedVariable(table, graph, vars.fill, rows)
  const fillPalette = graphFillPalette(graph, ctx.theme)
  const shape = mappedVariable(table, graph, vars.shape, rows)
  const shapeLayer = points ?? graph.layers.find((l) => l.geom === 'points')
  const base = shapeLayer
    ? layerStyle(ctx.theme, graph, shapeLayer, '', shapeLayer.stat).points.shape
    : 'circle'
  const stored = graph.scales?.shape?.levels
  /** The levels past those listed, counted. */
  const more = (order: readonly string[] | undefined) =>
    (order?.length ?? 0) > MAX_LISTED_LEVELS ? (
      <p className="muted">
        … and {((order?.length ?? 0) - MAX_LISTED_LEVELS).toLocaleString('en-US')} more levels
      </p>
    ) : null
  return (
    <Section title="Appearance by variable">
      {textColor ? (
        <p className="muted">
          Colour: the groups of {color?.title} (Change layers… maps another variable).
        </p>
      ) : (
        picker('color')
      )}
      {color?.type === 'text' && (
        <div className="level-colors">
          {(color.order ?? []).slice(0, MAX_LISTED_LEVELS).map((t, k) => (
            <ColorField
              key={t}
              label={t}
              value={colorOf(
                graph.seriesOverrides[levelKey(t)]?.color,
                palette,
                palette[k % palette.length]!,
              )}
              palette={palette}
              onChange={(_, ref) =>
                ctx.set(['seriesOverrides', levelKey(t), 'color'], ref, `Colour of ${t}`)
              }
            />
          ))}
          {more(color.order)}
        </div>
      )}
      {color?.type === 'number' && <ColorScaleFields ctx={ctx} which="color" />}
      {color && title('color')}
      {picker('fill')}
      {fill?.type === 'text' && fill.key !== (textColor ? vars.color : undefined) && (
        <div className="level-colors">
          {(fill.order ?? []).slice(0, MAX_LISTED_LEVELS).map((t, k) => (
            <ColorField
              key={t}
              label={t}
              value={colorOf(
                graph.seriesOverrides[levelKey(t)]?.fill,
                palette,
                fillPalette?.[k % fillPalette.length] ??
                  colorOf(
                    graph.seriesOverrides[levelKey(t)]?.color,
                    palette,
                    palette[k % palette.length]!,
                  ),
              )}
              palette={palette}
              onChange={(_, ref) =>
                ctx.set(['seriesOverrides', levelKey(t), 'fill'], ref, `Fill of ${t}`)
              }
            />
          ))}
          {more(fill.order)}
        </div>
      )}
      {fill?.type === 'number' && fill.key !== vars.color && (
        <ColorScaleFields ctx={ctx} which="fill" />
      )}
      {fill && fill.key !== vars.color && title('fill')}
      {picker('shape')}
      {shape && (
        <div className="level-shapes">
          {(shape.order ?? []).slice(0, MAX_LISTED_LEVELS).map((t, k) => (
            <Select
              key={t}
              label={t}
              value={levelShape(base, stored, t, k)}
              options={SHAPES}
              onChange={(v) =>
                ctx.set(['scales', 'shape', 'levels', levelKey(t)], v, `Symbol of ${t}`)
              }
            />
          ))}
          {more(shape.order)}
          {title('shape')}
        </div>
      )}
      {picker('size')}
      {vars.size && <SizeScaleFields ctx={ctx} />}
      {vars.size && title('size')}
      {picker('label')}
      {vars.label && (
        <p className="muted">
          Each point is labelled with its row’s value; Point labels (a data set’s Appearance) sets
          which points, the number format, the offset and whether labels keep apart.
        </p>
      )}
    </Section>
  )
}

/**
 * A number variable's colours: map, range, out-of-range and missing colours, colour bar — the
 * colour's scale, or (roadmap 49d) the fill's.
 */
function ColorScaleFields({ ctx, which }: { ctx: PanelContext; which: 'color' | 'fill' }) {
  const { graph, palette } = ctx
  const c: ColorScale = graph.scales?.[which] ?? {}
  const set = (field: keyof ColorScale, v: unknown, label: string) =>
    ctx.set(['scales', which, field], v, label)
  const kind = Array.isArray(c.colors) ? 'two' : (c.colors ?? 'gradient')
  const two = Array.isArray(c.colors) ? c.colors : GRADIENT_COLORS
  const fixed = c.min !== undefined || c.max !== undefined
  const bar = c.bar ?? {}
  const map = typeof c.colors === 'string' ? COLOR_MAPS[c.colors] : null
  return (
    <>
      <div className="field-row">
        <Select
          label="Colour map"
          value={kind}
          options={[
            { value: 'gradient', label: 'Light to dark blue' },
            { value: 'two', label: 'Two colours of my own' },
            ...Object.entries(COLOR_MAPS).map(([value, m]) => ({
              value,
              label: m.diverging ? `${m.label} (diverging)` : m.label,
            })),
          ]}
          onChange={(v) =>
            set(
              'colors',
              v === 'gradient'
                ? undefined
                : v === 'two'
                  ? [...GRADIENT_COLORS]
                  : (v as ColorMapName),
              'Colour map',
            )
          }
        />
        <Checkbox
          label="Reversed"
          checked={!!c.reverse}
          onChange={(v) => set('reverse', v || undefined, 'Reverse colours')}
        />
      </div>
      {map && (
        <div className="palette-preview" aria-hidden>
          {map.stops.map((s) => (
            <span key={s} style={{ background: s }} />
          ))}
        </div>
      )}
      {kind === 'two' && (
        <div className="field-row">
          <ColorField
            label="Lowest value"
            value={two[0]}
            palette={palette}
            onChange={(rgb) => set('colors', [rgb, two[1]], 'Colour map')}
          />
          <ColorField
            label="Highest value"
            value={two[1]}
            palette={palette}
            onChange={(rgb) => set('colors', [two[0], rgb], 'Colour map')}
          />
        </div>
      )}
      {/* Roadmap 34g: colours along a log, arcsinh or logicle scale (as the axes can be). */}
      <div className="field-row">
        <Select
          label="Colour scale"
          value={c.transform ?? 'linear'}
          options={[
            { value: 'linear', label: 'Linear' },
            { value: 'log10', label: 'Log 10' },
            { value: 'arcsinh', label: 'Arcsinh (cytometry)' },
            { value: 'logicle', label: 'Logicle / biexponential' },
          ]}
          onChange={(v) => set('transform', v === 'linear' ? undefined : v, 'Colour scale')}
        />
        {c.transform === 'arcsinh' && (
          <NumberInput
            label="Cofactor"
            value={c.arcsinh?.cofactor ?? ARCSINH_COFACTOR}
            min={0}
            onChange={(v) =>
              v > 0
                ? set('arcsinh', { cofactor: v }, 'Arcsinh cofactor')
                : ctx.onError('The cofactor must be above zero.')
            }
          />
        )}
      </div>
      <Checkbox
        label="Fixed range (else the data’s smallest to largest value)"
        checked={fixed}
        onChange={(v) =>
          ctx.dispatch(
            [
              {
                type: 'node.set',
                id: graph.id,
                path: ['scales', which, 'min'],
                value: v ? 0 : undefined,
              },
              {
                type: 'node.set',
                id: graph.id,
                path: ['scales', which, 'max'],
                value: v ? 1 : undefined,
              },
            ],
            'Colour range',
          )
        }
      />
      {fixed && (
        <>
          <div className="field-row">
            <NumberInput
              label="Lowest colour at"
              value={c.min ?? 0}
              onChange={(v) => set('min', v, 'Colour range')}
            />
            <NumberInput
              label="Highest colour at"
              value={c.max ?? 1}
              onChange={(v) => set('max', v, 'Colour range')}
            />
          </div>
          <Checkbox
            label="Values outside the range in a colour of their own (else the nearer end’s)"
            checked={c.outOfRange !== undefined}
            onChange={(v) => set('outOfRange', v ? '#ff00ff' : undefined, 'Out-of-range colour')}
          />
          {c.outOfRange !== undefined && (
            <ColorField
              label="Outside the range"
              value={c.outOfRange}
              palette={palette}
              onChange={(rgb) => set('outOfRange', rgb, 'Out-of-range colour')}
            />
          )}
        </>
      )}
      <ColorField
        label="Rows without a value"
        value={c.missing ?? MISSING_POINT_COLOR}
        palette={palette}
        onChange={(rgb) =>
          set('missing', rgb === MISSING_POINT_COLOR ? undefined : rgb, 'Missing colour')
        }
      />
      <Checkbox
        label="Colour bar in the legend (else a few colour swatches)"
        checked={bar.show === true}
        onChange={(v) => set('bar', { ...bar, show: v || undefined }, 'Colour bar')}
      />
      {bar.show === true && (
        <>
          <NumberInput
            label="Ticks along the bar (0 = as many as fit)"
            value={bar.ticks ?? 0}
            min={0}
            max={12}
            step={1}
            onChange={(v) =>
              set('bar', { ...bar, ticks: v >= 2 ? Math.round(v) : undefined }, 'Colour bar ticks')
            }
          />
          <NumberFormatFields
            format={bar.format ?? { mode: 'auto' }}
            mixed={false}
            onChange={(f) =>
              set('bar', { ...bar, format: f.mode === 'auto' ? undefined : f }, 'Colour bar format')
            }
          />
        </>
      )}
    </>
  )
}

/** A size variable's sizes: by area or radius, smallest and largest, range, clamp or extend. */
function SizeScaleFields({ ctx }: { ctx: PanelContext }) {
  const { graph } = ctx
  const s: SizeScale = graph.scales?.size ?? {}
  const d = sizeDefaults(graph.frame)
  const set = (field: keyof SizeScale, v: unknown, label: string) =>
    ctx.set(['scales', 'size', field], v, label)
  const fixed = s.low !== undefined || s.high !== undefined
  return (
    <>
      <Select
        label="Scale sizes by"
        value={s.by ?? 'area'}
        options={[
          { value: 'area', label: 'Area (proportional to the value)' },
          { value: 'radius', label: 'Radius (diameter linear in the value)' },
        ]}
        onChange={(v) => set('by', v === 'area' ? undefined : v, 'Size scaling')}
      />
      <div className="field-row">
        <NumberInput
          label="Smallest (pt)"
          value={s.min ?? d.min}
          min={0}
          max={72}
          onChange={(v) => set('min', v, 'Sizes')}
        />
        <NumberInput
          label="Largest (pt)"
          value={s.max ?? d.max}
          min={1}
          max={144}
          onChange={(v) => set('max', v, 'Sizes')}
        />
      </div>
      <Checkbox
        label="Fixed range of values (else the data’s)"
        checked={fixed}
        onChange={(v) =>
          ctx.dispatch(
            [
              {
                type: 'node.set',
                id: graph.id,
                path: ['scales', 'size', 'low'],
                value: v ? 0 : undefined,
              },
              {
                type: 'node.set',
                id: graph.id,
                path: ['scales', 'size', 'high'],
                value: v ? 1 : undefined,
              },
            ],
            'Size range',
          )
        }
      />
      {fixed && (
        <>
          <div className="field-row">
            <NumberInput
              label="Smallest size at"
              value={s.low ?? 0}
              onChange={(v) => set('low', v, 'Size range')}
            />
            <NumberInput
              label="Largest size at"
              value={s.high ?? 1}
              onChange={(v) => set('high', v, 'Size range')}
            />
          </div>
          <Select
            label="Values outside the range"
            value={s.outside ?? 'clamp'}
            options={[
              { value: 'clamp', label: 'Clamped to the smallest or largest size' },
              { value: 'extend', label: 'Sized past them' },
            ]}
            onChange={(v) => set('outside', v === 'clamp' ? undefined : v, 'Size range')}
          />
        </>
      )}
    </>
  )
}
