import type { Command } from '@ps/engine'
import {
  binsFill,
  bubbleVariables,
  COLOR_MAPS,
  clusterColor,
  ELLIPSE_LABELS,
  GRADIENT_COLORS,
  GRAND_MEAN_LINE,
  histogramWidth,
  MISSING_COLOR,
  overlayStyle,
  POINTS_THEME,
  polarStyle,
  RASTER_THRESHOLD,
  type ResolvedSeriesStyle,
  stacked,
  stackedArea,
  treeClusters,
  treeLayer,
  treeOfLayer,
  treeStyle,
  UNSTACKED,
  WHISKER_LABELS,
} from '@ps/graph'
import {
  type ColorMapName,
  type GraphNode,
  type Layer,
  type LayerOf,
  MAX_CLUSTERS,
  type NumberDisplay,
  type Position,
  plainText,
  richPlain,
  type Stat,
  sourceTable,
  statOf,
} from '@ps/model'
import { type ReactNode, useMemo } from 'react'
import { ARROW_SHAPES } from '../../components/arrowFields.tsx'
import { ColorField } from '../../components/ColorPicker.tsx'
import { Checkbox, NumberInput, Section, Select, TextInput } from '../../components/fields.tsx'
import { SHAPES, StrokeFields } from '../../components/formatFields.tsx'
import { ResultLayerPanel } from '../results/ResultPanels.tsx'
import { AppearanceSection, appearanceRows } from './AppearanceTable.tsx'
import { TypedValuesPanel } from './AxisExtras.tsx'
import type { PanelContext } from './context.ts'
import {
  ContourFields,
  densityStatRows,
  HexFields,
  PointDensityFields,
  RasterFields,
} from './DensityFields.tsx'
import { ERROR_STATS, pairedError } from './errorBars.ts'
import { IdentityLinePanel, isTypedSloped } from './IdentityLine.tsx'
import {
  differsAcross,
  layerName,
  layerPath,
  resolvedStyles,
  type SeriesItem,
  statCommands,
  styleCommands,
} from './layers.ts'
import { CutoffFields, SignificancePanel } from './Volcano.tsx'

// Format graph › Appearance, the selected layer's fields (roadmap 33c, design §7.2): a Stat row
// and a Position row, then the sections of its geom — today's sections re-hosted per geom. They
// format every series the layer draws or one (the layer's style, or that series' entry in it) —
// roadmap 49b: or several data sets selected together (each one's entry); fields that differ
// between series show as mixed (decision 78).

/** The series a layer's fields format: every one (null), one (its key), several (their keys). */
export type SeriesKeys = string | readonly string[] | null

/** What a layer's fields edit, and how. */
export interface LayerEdit {
  ctx: PanelContext
  layer: Layer
  /** The series formatted: every one the layer draws, or one. */
  items: readonly SeriesItem[]
  /** The (first) series formatted, or null for all of them. */
  key: string | null
  /**
   * Roadmap 49b: the series formatted when not all of them — one, or several data sets selected
   * together (their own entries written, each); null for all.
   */
  keys: readonly string[] | null
  /** Resolved looks of the series formatted (v1 sections), the first shown. */
  styles: readonly ResolvedSeriesStyle[]
  style: ResolvedSeriesStyle
  /** Whether the series formatted differ in a field. */
  differs: (f: (s: ResolvedSeriesStyle) => unknown) => boolean
  /** Sets one style field of the layer (for the series formatted). */
  set: (field: string, value: unknown, label?: string) => void
  write: (changes: [string, unknown][], label?: string) => void
  /** The stat of the first series formatted (the layer's, with the series' own). */
  stat: Stat
  setStat: (stat: Stat, label: string) => void
  /**
   * Roadmap 46: the fields the place shows in its Common settings (`CommonLayerFields`: a line's
   * width and style, error bars' kind and cap width) are left out here.
   */
  common: boolean
}

/** The editor of a layer's fields for some of its series. */
function layerEdit(
  ctx: PanelContext,
  layer: Layer,
  items: readonly SeriesItem[],
  seriesKeys: SeriesKeys,
  common = false,
): LayerEdit {
  const chosen =
    seriesKeys === null ? null : typeof seriesKeys === 'string' ? [seriesKeys] : [...seriesKeys]
  const key = chosen?.[0] ?? null
  const keys = chosen ?? items.map((i) => i.key)
  const styles = resolvedStyles(ctx.theme, ctx.graph, layer, keys.length ? keys : [''])
  /** Each series formatted: the layer for all of them, else each one's own entry. */
  const each = (f: (k: string | null) => Command[]): Command[] =>
    chosen === null ? f(null) : chosen.flatMap((k) => f(k))
  return {
    ctx,
    layer,
    items,
    key,
    keys: chosen,
    common,
    styles,
    style: styles[0]!,
    differs: (f) => differsAcross(styles, f),
    set: (field, value, label) =>
      ctx.dispatch(
        each((k) => styleCommands(ctx.graph, layer, k, [[field, value]])),
        label,
      ),
    write: (changes, label) =>
      ctx.dispatch(
        each((k) => styleCommands(ctx.graph, layer, k, changes)),
        label,
      ),
    stat: keys[0] !== undefined ? statOf(layer, keys[0]) : layer.stat,
    setStat: (stat, label) =>
      ctx.dispatch(
        each((k) => statCommands(ctx.graph, layer, k, stat)),
        label,
      ),
  }
}

/** The keys of the series a layer's fields format (every one the layer draws, one, several). */
export const editedKeys = (e: Pick<LayerEdit, 'keys' | 'items'>): readonly string[] =>
  e.keys ?? e.items.map((i) => i.key)

const pct = (v: number) => Math.round(v * 100)
const CENTERS = [
  { value: 'mean', label: 'Mean' },
  { value: 'median', label: 'Median' },
  { value: 'geomean', label: 'Geometric mean' },
] as const
type Center = (typeof CENTERS)[number]['value']

const WHISKER_OPTIONS = Object.entries(WHISKER_LABELS).map(([value, label]) => ({
  value: value as Extract<Stat, { kind: 'boxplot' }>['whiskers'],
  label: value === 'tukey' ? 'Tukey (1.5 × IQR)' : `${label[0]!.toUpperCase()}${label.slice(1)}`,
}))

// --- Stat row ------------------------------------------------------------------------------

/** Whether the series formatted differ in a part of their statistic (all of them formatted). */
const mixedStatOf = (e: LayerEdit, f: (s: Stat) => unknown) =>
  editedKeys(e).some((k) => JSON.stringify(f(statOf(e.layer, k))) !== JSON.stringify(f(e.stat)))

/** What error bars (or a band) show: SD, SEM, a CI… or none. */
function ErrorKind({ e }: { e: LayerEdit }) {
  const summary = e.stat.kind === 'summary' ? e.stat : undefined
  if (!summary) return null
  return (
    <Select
      label={e.layer.geom === 'band' ? 'Band' : 'Error bars'}
      value={summary.error ?? 'none'}
      mixed={mixedStatOf(e, (s) => (s.kind === 'summary' ? (s.error ?? 'none') : null))}
      options={ERROR_STATS}
      onChange={(v) =>
        e.setStat(
          { ...summary, ...(v === 'none' ? { error: undefined } : { error: v }) } as Stat,
          v === 'none' ? 'Remove error bars' : 'Error bars',
        )
      }
    />
  )
}

/** The statistic a layer draws (and, for one series, that series' own). */
function StatRow({ e }: { e: LayerEdit }) {
  const { layer, stat, styles, ctx } = e
  const frame = ctx.graph.frame
  const mixedStat = (f: (s: Stat) => unknown) => mixedStatOf(e, f)
  const summary = stat.kind === 'summary' ? stat : undefined
  const center = (c: Center, label: string) => {
    if (!summary) return
    // Median goes with IQR / MAD, mean with SD / SEM / CI.
    const error = summary.error ? pairedError(c, summary.error) : undefined
    e.setStat({ ...summary, center: c, ...(error ? { error } : {}) }, label)
  }
  const rows: ReactNode[] = []
  if (layer.geom === 'bar' && stat.kind === 'bin') rows.push(<BinFields key="bin" e={e} />)
  // Roadmap 49c: a tree's clustering and cut.
  if (layer.geom === 'dendrogram') rows.push(<TreeStatRows key="tree" e={e} />)
  // Roadmap 34g: hexagons, densities and dot plots.
  rows.push(...densityStatRows(e))
  switch (layer.geom) {
    case 'points':
      if (layer.aes) break
      rows.push(
        <Select
          key="plot"
          label="Plot"
          value={stat.kind === 'identity' ? 'each' : (summary?.center ?? 'mean')}
          mixed={mixedStat((s) => (s.kind === 'summary' ? s.center : s.kind))}
          options={[
            { value: 'each', label: frame === 'xy' ? 'Each replicate' : 'Every value' },
            { value: 'mean', label: frame === 'xy' ? 'Mean (one symbol)' : 'Mean (one symbol)' },
            { value: 'median', label: 'Median (one symbol)' },
          ]}
          onChange={(v) =>
            e.setStat(
              v === 'each' ? { kind: 'identity' } : { kind: 'summary', center: v as Center },
              v === 'each' ? 'Plot every value' : 'Plot the mean',
            )
          }
        />,
      )
      break
    case 'bar':
    case 'center':
    case 'line':
    case 'step':
    case 'area':
      if (!summary || summary.by === 'all') break
      rows.push(
        <Select<Center>
          key="center"
          label={layer.geom === 'bar' ? 'Bar height' : layer.geom === 'center' ? 'Line at' : 'Join'}
          value={summary.center}
          mixed={mixedStat((s) => (s.kind === 'summary' ? s.center : null))}
          options={CENTERS}
          onChange={(v) => center(v, 'Change centre')}
        />,
      )
      break
    case 'errorbar':
    case 'band':
      if (!summary) break
      rows.push(
        <div className="field-row" key="error">
          <Select<Center>
            label="Centre"
            value={summary.center}
            mixed={mixedStat((s) => (s.kind === 'summary' ? s.center : null))}
            options={CENTERS}
            onChange={(v) => center(v, 'Change centre')}
          />
          {!(e.common && layer.geom === 'errorbar') && <ErrorKind e={e} />}
        </div>,
      )
      break
    case 'box':
      rows.push(
        <div className="field-row" key="box">
          <Select
            label="Draw"
            value={stat.kind === 'range' ? 'range' : 'boxplot'}
            mixed={mixedStat((s) => s.kind)}
            options={[
              { value: 'boxplot', label: 'Box (quartiles) and whiskers' },
              { value: 'range', label: 'Floating bar (min to max)' },
            ]}
            onChange={(v) =>
              e.setStat(
                v === 'range'
                  ? { kind: 'range', center: 'mean' }
                  : { kind: 'boxplot', whiskers: 'minmax' },
                v === 'range' ? 'Floating bars' : 'Box and whiskers',
              )
            }
          />
          {stat.kind === 'boxplot' ? (
            <Select
              label="Whiskers"
              value={stat.whiskers}
              mixed={mixedStat((s) => (s.kind === 'boxplot' ? s.whiskers : null))}
              options={WHISKER_OPTIONS}
              onChange={(v) => e.setStat({ ...stat, whiskers: v }, 'Whiskers')}
            />
          ) : stat.kind === 'range' ? (
            <Select<Center>
              label="Line at"
              value={stat.center ?? 'mean'}
              options={CENTERS}
              onChange={(v) => e.setStat({ ...stat, center: v }, 'Line at')}
            />
          ) : null}
        </div>,
      )
      break
    case 'violin':
      if (stat.kind !== 'density') break
      rows.push(
        <div className="field-row" key="violin">
          <Select
            label="Violin"
            value={stat.extent}
            options={[
              { value: 'truncated', label: 'Truncated (smallest to largest value)' },
              { value: 'extended', label: 'Extended (tails beyond the data)' },
            ]}
            onChange={(v) => e.setStat({ ...stat, extent: v }, 'Violin extent')}
          />
          <Select
            label="Smoothing"
            value={String(stat.smoothing)}
            options={[
              { value: '0.5', label: 'Less smooth (½ × bandwidth)' },
              { value: '1', label: 'Default (Silverman bandwidth)' },
              { value: '2', label: 'Smoother (2 × bandwidth)' },
              ...(![0.5, 1, 2].includes(stat.smoothing)
                ? [{ value: String(stat.smoothing), label: `${stat.smoothing} ×` }]
                : []),
            ]}
            onChange={(v) => e.setStat({ ...stat, smoothing: Number(v) }, 'Violin smoothing')}
          />
          <Select
            label="Line at"
            value={stat.center ?? 'none'}
            options={[...CENTERS.slice(0, 2), { value: 'none', label: 'None' }]}
            onChange={(v) => e.setStat({ ...stat, center: v }, 'Violin centre line')}
          />
        </div>,
      )
      break
    case 'polygon':
      // Roadmap 34c: an ellipse's kind and level, or the convex hull.
      rows.push(
        <div className="field-row" key="polygon">
          <Select
            label="Shape"
            value={stat.kind === 'ellipse' ? stat.type : 'hull'}
            mixed={mixedStat((s) => (s.kind === 'ellipse' ? s.type : s.kind))}
            options={[
              { value: 'norm', label: `Ellipse: ${ELLIPSE_LABELS.norm} (data, normal theory)` },
              { value: 't', label: `Ellipse: ${ELLIPSE_LABELS.t} (data, robust)` },
              { value: 'mean', label: 'Ellipse: confidence region of the mean' },
              { value: 'hull', label: 'Convex hull' },
            ]}
            onChange={(v) =>
              e.setStat(
                v === 'hull'
                  ? { kind: 'hull' }
                  : {
                      kind: 'ellipse',
                      type: v as 'norm' | 'mean' | 't',
                      level: stat.kind === 'ellipse' ? stat.level : 0.95,
                    },
                v === 'hull' ? 'Convex hull' : 'Ellipse type',
              )
            }
          />
          {stat.kind === 'ellipse' && (
            <NumberInput
              label="Level (%)"
              value={+(stat.level * 100).toPrecision(4)}
              min={1}
              max={99.9}
              step={1}
              onChange={(v) => e.setStat({ ...stat, level: v / 100 }, 'Ellipse level')}
            />
          )}
        </div>,
      )
      break
    case 'label':
      // Roadmap 34e: group names at the groups' centres — median or mean.
      if (stat.kind !== 'centroid') break
      rows.push(
        <Select
          key="centroid"
          label="Centre of each group"
          value={stat.center ?? 'median'}
          options={[
            { value: 'median', label: 'Median X and Y' },
            { value: 'mean', label: 'Mean X and Y' },
          ]}
          onChange={(v) => e.setStat({ ...stat, center: v }, 'Centre of each group')}
        />,
      )
      break
    case 'difference':
      if (stat.kind !== 'difference') break
      rows.push(
        <Select
          key="ci"
          label="Confidence interval of each difference"
          value={stat.ci}
          options={[
            { value: 'pooled', label: 'Unpaired t test (pooled SD)' },
            { value: 'welch', label: 'Welch (SDs not assumed equal)' },
          ]}
          onChange={(v) => e.setStat({ ...stat, ci: v }, 'Estimation CI')}
        />,
      )
      break
  }
  if (!rows.length) return null
  void styles
  return (
    <Section title="Statistic">
      {rows}
      {e.keys?.some((k) => JSON.stringify(statOf(layer, k)) !== JSON.stringify(layer.stat)) && (
        <button
          type="button"
          className="link"
          onClick={() =>
            ctx.dispatch(
              (e.keys ?? []).map((k) => ({
                type: 'node.set' as const,
                id: ctx.graph.id,
                path: layerPath(layer.id, 'series', k, 'stat'),
                value: undefined,
              })),
              'Same as all',
            )
          }
        >
          Same statistic as every data set
        </button>
      )}
    </Section>
  )
}

/** A histogram's bars: what they measure, and the bins' width (automatic or set). */
function BinFields({ e }: { e: LayerEdit }) {
  const { layer, stat, ctx } = e
  if (stat.kind !== 'bin' || layer.geom !== 'bar') return null
  const width = stat.width
  return (
    <div className="field-row">
      <Select
        label="Bars show"
        value={stat.measure ?? 'count'}
        options={[
          { value: 'count', label: 'Number of values' },
          { value: 'percent', label: 'Percent of the data set’s values' },
          { value: 'fraction', label: 'Fraction of the data set’s values' },
        ]}
        onChange={(v) => e.setStat({ ...stat, measure: v }, 'Histogram measure')}
      />
      <Checkbox
        label="Automatic bin width"
        checked={width === undefined}
        onChange={(auto) => {
          const { width: _, ...rest } = stat
          if (auto) e.setStat(rest, 'Automatic bin width')
          else {
            const now = histogramWidth(ctx.project, ctx.graph, layer, ctx.lookup)
            e.setStat({ ...rest, width: Number.isFinite(now) ? now : 1 }, 'Bin width')
          }
        }}
      />
      {width !== undefined && (
        <NumberInput
          label="Bin width"
          value={width}
          min={Number.MIN_VALUE}
          step={width / 2}
          onChange={(v) => v > 0 && e.setStat({ ...stat, width: v }, 'Bin width')}
        />
      )}
    </div>
  )
}

// --- Position row --------------------------------------------------------------------------

/** Where the layer's marks sit: side by side, at one position or stacked (grouped graphs). */
function PositionRow({ e }: { e: LayerEdit }) {
  const { ctx, layer } = e
  const { graph } = ctx
  if (e.key !== null || layer.on) return null
  if (graph.frame === 'category') return <SubjectsRow e={e} />
  if (graph.frame === 'xy' && layer.geom === 'area') return <AreaStackRow e={e} />
  if (graph.frame === 'xy' && layer.geom === 'bar' && layer.stat.kind === 'bin')
    return <BinStackRow e={e} />
  if (graph.frame !== 'grouped') return null
  const p = layer.position
  const value =
    p?.kind === 'stack'
      ? p.percent
        ? 'percent'
        : 'stack'
      : p?.kind === 'aligned'
        ? 'aligned'
        : 'dodge'
  const bars = layer.geom === 'bar'
  const setPosition = (position: Position, label: string) => {
    const cmds: Command[] = [
      { type: 'node.set', id: graph.id, path: layerPath(layer.id, 'position'), value: position },
    ]
    if (position.kind === 'stack') {
      // Stacked bars draw no points, lines or boxes (decision 217): those layers are hidden, and
      // the others sit at the row's centre.
      for (const l of graph.layers) {
        if (l.id === layer.id || l.on) continue
        if (['points', 'line', 'box', 'violin', 'center'].includes(l.geom) && l.visible !== false)
          cmds.push({
            type: 'node.set',
            id: graph.id,
            path: layerPath(l.id, 'visible'),
            value: false,
          })
        else if (l.geom === 'bar' && l.position?.kind !== 'stack')
          cmds.push({
            type: 'node.set',
            id: graph.id,
            path: layerPath(l.id, 'position'),
            value: { kind: 'aligned' },
          })
      }
    }
    ctx.dispatch(cmds, label)
  }
  return (
    <Section title="Position">
      <Select
        label="Data sets in each row"
        value={value}
        options={[
          { value: 'dodge', label: 'Side by side (interleaved)' },
          { value: 'aligned', label: 'At the same position (rows are time points)' },
          ...(bars
            ? [
                { value: 'stack', label: 'Stacked (one bar per row)' },
                { value: 'percent', label: 'Stacked, percent of each row’s total' },
              ]
            : []),
        ]}
        onChange={(v) =>
          setPosition(
            v === 'stack' || v === 'percent'
              ? {
                  kind: 'stack',
                  ...(v === 'percent' ? { percent: true } : {}),
                  ...(p?.kind === 'stack' && p.gap ? { gap: p.gap } : {}),
                }
              : { kind: v as 'dodge' | 'aligned' },
            v === 'stack' || v === 'percent' ? 'Stack bars' : 'Arrange data sets',
          )
        }
      />
      {p?.kind === 'stack' && (
        <NumberInput
          label="Gap between segments (pt)"
          value={p.gap ?? 0}
          min={0}
          max={20}
          step={0.5}
          onChange={(v) =>
            ctx.set(
              layerPath(layer.id, 'position'),
              { ...p, gap: v || undefined },
              'Gap between segments',
            )
          }
        />
      )}
      {!bars && stacked(graph.layers) && (
        <p className="muted">Stacked bars draw no points, lines or boxes over them.</p>
      )}
    </Section>
  )
}

/**
 * XY areas: each data set's to its baseline (overlapping), or stacked on the data sets before it.
 * Stacking hides the points, lines, error bars and bands of the table's data sets (they would
 * sit at unstacked values), as stacked bars do.
 */
function AreaStackRow({ e }: { e: LayerEdit }) {
  const { ctx, layer } = e
  const { graph } = ctx
  const stackedNow = layer.position?.kind === 'stack'
  const setStacked = (on: boolean) => {
    const cmds: Command[] = [
      { type: 'node.set', id: graph.id, path: layerPath(layer.id), value: stackedArea(layer, on) },
    ]
    if (on)
      for (const l of graph.layers)
        if (
          l.id !== layer.id &&
          (l.data?.from ?? 'table') === 'table' &&
          UNSTACKED.area.includes(l.geom) &&
          l.visible !== false
        )
          cmds.push({
            type: 'node.set',
            id: graph.id,
            path: layerPath(l.id, 'visible'),
            value: false,
          })
    ctx.dispatch(cmds, on ? 'Stack areas' : 'Overlap areas')
  }
  return (
    <Section title="Position">
      <Select
        label="Areas of the data sets"
        value={stackedNow ? 'stack' : 'overlap'}
        options={[
          { value: 'overlap', label: 'Overlapping (each to its baseline)' },
          { value: 'stack', label: 'Stacked (each on the ones before it)' },
        ]}
        onChange={(v) => setStacked(v === 'stack')}
      />
      {stackedNow && (
        <p className="muted">Stacked areas draw no points, lines, error bars or bands over them.</p>
      )}
    </Section>
  )
}

/**
 * A histogram's bars (roadmap 34f): the data sets' (a graph of variables' groups') bars overlapping
 * in the same bins (translucent when grouped) or stacked, each on the ones before it.
 */
function BinStackRow({ e }: { e: LayerEdit }) {
  const { ctx, layer } = e
  const stackedNow = layer.position?.kind === 'stack'
  const setStacked = (on: boolean) => {
    const { position: _, ...rest } = layer
    const value = binsFill((on ? { ...rest, position: { kind: 'stack' } } : rest) as Layer)
    ctx.dispatch(
      { type: 'node.set', id: ctx.graph.id, path: layerPath(layer.id), value },
      on ? 'Stack bins' : 'Overlap bins',
    )
  }
  return (
    <Section title="Position">
      <Select
        label="Bars of the data sets"
        value={stackedNow ? 'stack' : 'overlap'}
        options={[
          { value: 'overlap', label: 'Overlapping (each from zero)' },
          { value: 'stack', label: 'Stacked (each on the ones before it)' },
        ]}
        onChange={(v) => setStacked(v === 'stack')}
      />
    </Section>
  )
}

/** Nested groups: their subjects side by side or pooled, told apart by shade or symbol. */
function SubjectsRow({ e }: { e: LayerEdit }) {
  const { ctx, layer } = e
  const table = sourceTable(ctx.project, ctx.graph.seriesSource.table, ctx.lookup)
  if (table?.tableKind !== 'nested') return null
  if (layer.geom !== 'points' && !(layer.geom === 'center' && layer.stat.kind === 'summary'))
    return null
  const bySubject = layer.position?.kind === 'dodge'
  const mark = (layer.style as { subjects?: string } | undefined)?.subjects ?? 'none'
  return (
    <Section title="Subjects (nested data)">
      <div className="field-row">
        <Select
          label="Subjects of a group"
          value={bySubject ? 'subjects' : 'pooled'}
          options={[
            { value: 'subjects', label: 'Side by side' },
            { value: 'pooled', label: 'Pooled in one column' },
          ]}
          onChange={(v) =>
            ctx.set(
              layerPath(layer.id, 'position'),
              v === 'subjects' ? { kind: 'dodge', by: 'subject' } : undefined,
              'Format subjects',
            )
          }
        />
        <Select
          label="Told apart by"
          value={mark}
          options={[
            { value: 'shade', label: 'Shade of the group’s colour' },
            { value: 'shape', label: 'Symbol' },
            { value: 'none', label: 'Nothing' },
          ]}
          onChange={(v) => e.set('subjects', v === 'none' ? undefined : v, 'Format subjects')}
        />
      </div>
    </Section>
  )
}

// --- Geom sections -----------------------------------------------------------------------------

/** Opacity of a solid fill in the series' colour (bars, boxes, violins, slices). */
function FillOpacity({
  e,
  part,
  field = 'fill',
  label = 'Fill opacity',
}: {
  e: LayerEdit
  part: 'bar' | 'box'
  field?: string
  label?: string
}) {
  const opacity = (s: ResolvedSeriesStyle) => {
    const fill = s[part].fill
    return fill.type === 'solid' ? fill.opacity : 0
  }
  return (
    <NumberInput
      label={label}
      value={opacity(e.style)}
      mixed={e.differs(opacity)}
      min={0}
      max={1}
      step={0.05}
      onChange={(v) =>
        e.set(field, { type: 'solid', color: { series: true }, opacity: v }, 'Fill opacity')
      }
    />
  )
}

/** Width as a percent of the category, slot or bin. */
function WidthField({
  e,
  of,
  value,
}: {
  e: LayerEdit
  of: string
  value: (s: ResolvedSeriesStyle) => number
}) {
  return (
    <NumberInput
      label={`Width (% of the ${of})`}
      value={pct(value(e.style))}
      mixed={e.differs(value)}
      min={1}
      max={100}
      step={5}
      onChange={(v) => e.set('width', v / 100, 'Width')}
    />
  )
}

function SymbolsSection({ e, bubbles = false }: { e: LayerEdit; bubbles?: boolean }) {
  const { style, ctx } = e
  const frame = ctx.graph.frame
  const each = e.stat.kind === 'identity'
  // Roadmap 49a: shape, size, fill and outline are the Appearance table's (dot plots' and
  // Significance classes' symbols keep their own fields: their colours are the statistics').
  const table = appearanceRows(ctx.graph, e.layer).length > 0
  const arranged = each && (frame === 'category' || frame === 'grouped')
  if (table && !arranged) return null
  return (
    <Section title={bubbles ? 'Bubbles' : 'Symbols'}>
      {!table && (
        <>
          <div className="field-row">
            <Select
              label="Shape"
              value={style.points.shape}
              mixed={e.differs((x) => x.points.shape)}
              options={SHAPES}
              onChange={(v) => e.set('shape', v)}
            />
            {!bubbles && (
              <NumberInput
                label="Size (pt)"
                value={style.points.size}
                mixed={e.differs((x) => x.points.size)}
                min={1}
                max={30}
                step={0.5}
                onChange={(v) => e.set('size', v)}
              />
            )}
          </div>
          <Checkbox
            label="Hollow"
            checked={style.points.fill.type === 'none'}
            mixed={e.differs((x) => x.points.fill.type === 'none')}
            // Explicit values (not deletion) so they also override the layer's own.
            onChange={(v) =>
              e.set(
                'fill',
                v ? { type: 'none' } : { type: 'solid', color: { series: true }, opacity: 1 },
              )
            }
          />
          <PointBorder
            border={style.points.border}
            mixed={e.differs((x) => JSON.stringify(x.points.border))}
            palette={ctx.palette}
            onChange={(v) => e.set('border', v, 'Symbol border')}
          />
        </>
      )}
      {arranged && (
        <div className="field-row">
          <Select
            label="Arrangement"
            value={style.points.jitter === 'none' ? 'line' : 'swarm'}
            mixed={e.differs((x) => x.points.jitter === 'none')}
            options={[
              { value: 'swarm', label: 'Swarm (side by side, no overlap)' },
              { value: 'line', label: 'In one line' },
            ]}
            onChange={(v) => e.set('spread', v === 'line' ? 'none' : 'auto')}
          />
          {style.points.jitter !== 'none' && (
            <NumberInput
              label="Swarm width (pt, 0 = fit)"
              value={typeof style.points.jitter === 'number' ? style.points.jitter * 2 : 0}
              mixed={e.differs((x) => x.points.jitter)}
              min={0}
              max={500}
              step={1}
              onChange={(v) => e.set('spread', v > 0 ? v / 2 : 'auto')}
            />
          )}
        </div>
      )}
    </Section>
  )
}

type Border = ResolvedSeriesStyle['points']['border']

/**
 * A symbol's border: in the data set's colour, another colour (e.g. white, to separate
 * overlapping points), or none; and its width.
 */
function PointBorder({
  border,
  mixed,
  palette,
  onChange,
}: {
  border: Border
  mixed: boolean
  palette: readonly string[]
  onChange: (b: Border) => void
}) {
  const mode = border.width === 0 ? 'none' : 'series' in border.color ? 'series' : 'color'
  const color =
    'series' in border.color
      ? '#ffffff'
      : 'rgb' in border.color
        ? border.color.rgb
        : palette[border.color.palette % palette.length]!
  return (
    <div className="field-row">
      <Select
        label="Border"
        value={mode}
        mixed={mixed}
        options={[
          { value: 'series', label: 'Data set colour' },
          { value: 'color', label: 'Other colour' },
          { value: 'none', label: 'None' },
        ]}
        onChange={(m) =>
          onChange(
            m === 'none'
              ? { ...border, width: 0 }
              : {
                  ...border,
                  width: border.width === 0 ? 0.75 : border.width,
                  color: m === 'series' ? { series: true } : { rgb: color },
                },
          )
        }
      />
      {mode === 'color' && (
        <ColorField
          label="Border colour"
          value={color}
          palette={palette}
          onChange={(_, c) => onChange({ ...border, color: c })}
        />
      )}
      {mode !== 'none' && (
        <NumberInput
          label="Border width (pt)"
          value={border.width}
          min={0.25}
          max={5}
          step={0.25}
          onChange={(width) => onChange({ ...border, width })}
        />
      )}
    </div>
  )
}

function BarsSection({ e }: { e: LayerEdit }) {
  const { style, ctx, layer } = e
  const xy = ctx.graph.frame === 'xy'
  const stackedBars = layer.position?.kind === 'stack'
  const b = style.bar.baseline
  // Roadmap 49a: fill and outline are the Appearance table's (100% bars keep theirs).
  const table = appearanceRows(ctx.graph, layer).length > 0
  return (
    <Section title="Bars">
      <div className="field-row">
        {!table && <FillOpacity e={e} part="bar" />}
        <WidthField e={e} of={xy ? 'bin' : 'category'} value={(s) => s.bar.width} />
      </div>
      {!table && (
        <NumberInput
          label="Border (pt)"
          value={style.bar.border.width}
          mixed={e.differs((s) => s.bar.border.width)}
          min={0}
          max={10}
          step={0.25}
          onChange={(v) => e.set('border', { ...style.bar.border, width: v }, 'Bar border')}
        />
      )}
      {xy && (
        <NumberInput
          label="Bin width (X units, 0 = spacing of the X values)"
          value={style.bar.binWidth ?? 0}
          mixed={e.differs((s) => s.bar.binWidth ?? 0)}
          min={0}
          step={0.1}
          onChange={(v) => e.set('binWidth', v > 0 ? v : undefined, 'Bin width')}
        />
      )}
      {!stackedBars && layer.stat.kind !== 'fraction' && (
        <div className="field-row">
          <Checkbox
            label="Bars start at a baseline other than 0"
            checked={b !== undefined}
            mixed={e.differs((s) => s.bar.baseline !== undefined)}
            onChange={(v) => e.set('baseline', v ? 1 : undefined, 'Bar baseline')}
          />
          {b !== undefined && (
            <NumberInput
              label="Baseline (bars go up or down from it)"
              value={b}
              mixed={e.differs((s) => s.bar.baseline)}
              onChange={(v) => e.set('baseline', v, 'Bar baseline')}
            />
          )}
        </div>
      )}
    </Section>
  )
}

/** The width of error bars' caps. */
function CapWidth({ e }: { e: LayerEdit }) {
  return (
    <NumberInput
      label="Cap width (pt)"
      value={e.style.error.capWidth}
      mixed={e.differs((x) => x.error.capWidth)}
      min={0}
      max={40}
      onChange={(v) => e.set('capWidth', v)}
    />
  )
}

function ErrorBarsFields({ e }: { e: LayerEdit }) {
  const { style, ctx } = e
  const xErrors = ctx.graph.frame === 'xy'
  return (
    <Section title="Error bars">
      <div className="field-row">
        <Select
          label="Direction"
          value={style.error.direction}
          mixed={e.differs((x) => x.error.direction)}
          options={[
            { value: 'both', label: 'Both' },
            { value: 'above', label: 'Above' },
            { value: 'below', label: 'Below' },
          ]}
          onChange={(v) => e.set('direction', v)}
        />
        {!e.common && <CapWidth e={e} />}
      </div>
      {xErrors && (
        <Checkbox
          label="Error bars along X (the table’s X errors)"
          checked={style.error.x !== false}
          mixed={e.differs((x) => x.error.x !== false)}
          onChange={(v) => e.set('x', v ? undefined : false, 'X error bars')}
        />
      )}
    </Section>
  )
}

function CenterFields({ e }: { e: LayerEdit }) {
  const { style, ctx } = e
  return (
    <Section title="Centre line">
      {ctx.graph.frame !== 'xy' && (
        <NumberInput
          label="Line length (% of the column)"
          value={pct(style.center.width)}
          mixed={e.differs((x) => x.center.width)}
          min={1}
          max={100}
          step={5}
          onChange={(v) => e.set('width', v / 100, 'Centre line length')}
        />
      )}
    </Section>
  )
}

function BoxFields({ e }: { e: LayerEdit }) {
  return (
    <Section title="Box">
      <div className="field-row">
        <WidthField e={e} of="category" value={(s) => s.bar.width} />
      </div>
      <NumberInput
        label="Whisker caps (pt)"
        value={e.style.error.capWidth}
        mixed={e.differs((x) => x.error.capWidth)}
        min={0}
        max={40}
        onChange={(v) => e.set('capWidth', v)}
      />
    </Section>
  )
}

function ViolinFields({ e }: { e: LayerEdit }) {
  return (
    <Section title="Violin">
      <div className="field-row">
        <WidthField e={e} of="category" value={(s) => s.bar.width} />
      </div>
      <Checkbox
        label="Lines at the quartiles"
        checked={e.style.violin.quartiles}
        mixed={e.differs((s) => s.violin.quartiles)}
        onChange={(v) => e.set('quartiles', v, 'Quartile lines')}
      />
    </Section>
  )
}

/** The stroke a line layer draws (replicates' lines, or the line through the summary). */
function lineStroke(e: LayerEdit) {
  const { style, layer } = e
  const spaghetti = layer.stat.kind === 'identity' && (!layer.data || layer.data.from === 'table')
  return { spaghetti, stroke: spaghetti ? style.spaghetti.stroke : style.line.stroke }
}

function LineFields({ e }: { e: LayerEdit }) {
  const { style, layer } = e
  const { spaghetti } = lineStroke(e)
  // Roadmap 49a: its colour, width and style are the Appearance table's.
  if (!spaghetti && !(layer.geom === 'line' && (!layer.data || layer.data.from === 'table')))
    return null
  return (
    <Section title={layer.geom === 'step' ? 'Survival curve' : 'Line'}>
      {spaghetti && (
        <NumberInput
          label="Fade (0–0.95 towards white)"
          value={style.spaghetti.fade}
          mixed={e.differs((s) => s.spaghetti.fade)}
          min={0}
          max={0.95}
          step={0.05}
          onChange={(v) => e.set('fade', v, 'Fade replicate lines')}
        />
      )}
      {layer.geom === 'line' && (!layer.data || layer.data.from === 'table') && (
        <Checkbox
          label="Break the line at missing values (else join across them)"
          checked={style.line.gaps}
          mixed={e.differs((s) => s.line.gaps)}
          onChange={(v) => e.set('gaps', v, 'Gaps at missing values')}
        />
      )}
    </Section>
  )
}

function BandFields({ e }: { e: LayerEdit }) {
  const { style, layer } = e
  const envelope = layer.stat.kind === 'summary' && (!layer.data || layer.data.from === 'table')
  const opacity = (s: ResolvedSeriesStyle) => (envelope ? s.envelope.opacity : s.band.opacity)
  return (
    <Section title={layer.geom === 'area' ? 'Area' : 'Band'}>
      <NumberInput
        label={layer.geom === 'area' ? 'Fill opacity' : 'Band opacity'}
        value={layer.geom === 'area' ? style.area.opacity : opacity(style)}
        mixed={e.differs(layer.geom === 'area' ? (s) => s.area.opacity : opacity)}
        min={0}
        max={1}
        step={0.05}
        onChange={(v) => e.set('opacity', v, 'Opacity')}
      />
      {layer.geom === 'area' && (
        <NumberInput
          label="Down to (baseline)"
          value={style.area.baseline ?? 0}
          mixed={e.differs((s) => s.area.baseline ?? 0)}
          onChange={(v) => e.set('baseline', v || undefined, 'Area baseline')}
        />
      )}
    </Section>
  )
}

const LABEL_VALUES = [
  { value: 'value', label: 'Its value (bar height / centre)' },
  { value: 'mean', label: 'Mean' },
  { value: 'median', label: 'Median' },
  { value: 'n', label: 'n (number of values)' },
  { value: 'sd', label: 'SD' },
  { value: 'sem', label: 'SEM' },
] as const

/** A number above each bar or column (bar labels): what, where and in which format. */
function LabelFields({ e }: { e: LayerEdit }) {
  const { style, layer, ctx } = e
  if (layer.stat.kind === 'fraction') return <SliceLabelFields e={e} />
  if (layer.stat.kind === 'cell') return <CellLabelFields e={e} />
  if (layer.stat.kind === 'centroid') return <CentroidFields e={e} />
  const label = style.label
  const format: NumberDisplay = label.format
  const onBars = ctx.graph.layers.some((l) => l.id === layer.on && l.geom === 'bar')
  return (
    <Section title="Labels">
      <div className="field-row">
        <Select
          label="Show"
          value={label.stat as string}
          mixed={e.differs((s) => s.label.stat)}
          options={
            ctx.graph.frame === 'grouped'
              ? [...LABEL_VALUES, { value: 'percent', label: 'Percent of the row’s total' }]
              : LABEL_VALUES
          }
          onChange={(v) => e.set('value', v, 'Label')}
        />
        {onBars && (
          <Select
            label="Position"
            value={label.position}
            mixed={e.differs((s) => s.label.position)}
            options={[
              { value: 'above', label: 'Above the bar' },
              { value: 'inside', label: 'Inside, at the top' },
            ]}
            onChange={(v) => e.set('position', v, 'Label position')}
          />
        )}
      </div>
      <NumberFormatFields
        format={format}
        mixed={e.differs((s) => s.label.format.mode)}
        onChange={(f) => e.set('format', f, 'Label format')}
      />
      <div className="field-row">
        <NumberInput
          label="Font size (pt)"
          value={label.text.size ?? 11}
          mixed={e.differs((s) => s.label.text.size)}
          min={4}
          max={48}
          step={0.5}
          onChange={(v) => e.set('text', { ...label.text, size: v }, 'Label font')}
        />
        <Checkbox
          label="Bold"
          checked={!!label.text.bold}
          mixed={e.differs((s) => !!s.label.text.bold)}
          onChange={(v) => e.set('text', { ...label.text, bold: v }, 'Label font')}
        />
      </div>
    </Section>
  )
}

/** A style field set on the layer or for the data set formatted (not a theme default). */
function ownStyle(e: LayerEdit, name: string): unknown {
  const own = e.key !== null ? (e.layer.series?.[e.key]?.style as Record<string, unknown>) : null
  return own?.[name] ?? (e.layer.style as Record<string, unknown> | undefined)?.[name]
}

/** Roadmap 34e: group names at their centres — behind each name, and its text. */
function CentroidFields({ e }: { e: LayerEdit }) {
  const text = (ownStyle(e, 'text') ?? {}) as { size?: number; bold?: boolean }
  return (
    <Section title="Group names">
      <Select
        label="Behind each name"
        value={(ownStyle(e, 'background') as string | undefined) ?? 'halo'}
        options={[
          { value: 'halo', label: 'A white halo round the letters' },
          { value: 'box', label: 'A box' },
          { value: 'none', label: 'Nothing' },
        ]}
        onChange={(v) => e.set('background', v, 'Group names’ background')}
      />
      <div className="field-row">
        <NumberInput
          label="Font size (pt)"
          value={text.size ?? 10}
          min={4}
          max={48}
          step={0.5}
          onChange={(v) => e.set('text', { ...text, size: v }, 'Group names’ font')}
        />
        <Checkbox
          label="Bold"
          checked={text.bold ?? true}
          onChange={(v) => e.set('text', { ...text, bold: v }, 'Group names’ font')}
        />
      </div>
      <p className="muted">
        Each group (a level of the colour, else the shape variable) named at its centre, moved aside
        only where names would overlap.
      </p>
    </Section>
  )
}

/**
 * Roadmap 34e: how a points layer of every row draws its points — as an image on screen when
 * there are many — and in which order.
 */
function PointsDrawFields({ e }: { e: LayerEdit }) {
  const { layer, ctx } = e
  if (layer.geom !== 'points' || e.stat.kind !== 'identity' || ctx.graph.frame !== 'xy') return null
  const render = (ownStyle(e, 'render') as string | undefined) ?? POINTS_THEME.render
  const order = (ownStyle(e, 'order') as string | undefined) ?? POINTS_THEME.order
  return (
    <Section title="Many points">
      <Select
        label="On screen, draw the points"
        value={render}
        options={[
          {
            value: 'auto',
            // The graph's points, every layer and data set together (decision 451).
            label: `As an image above ${RASTER_THRESHOLD.toLocaleString('en-US')} points in the graph`,
          },
          { value: 'image', label: 'As an image' },
          { value: 'vector', label: 'As vectors (slow with many points)' },
        ]}
        onChange={(v) => e.set('render', v === 'auto' ? undefined : v, 'Points drawn as')}
      />
      <Select
        label="Order"
        value={order}
        options={[
          { value: 'table', label: 'Table order' },
          ...(layer.aes
            ? [{ value: 'value', label: 'By the colour (else size) value, highest on top' }]
            : []),
          { value: 'random', label: 'Shuffled (the same each time)' },
        ]}
        onChange={(v) => e.set('order', v === 'table' ? undefined : v, 'Drawing order')}
      />
      <p className="muted">Exports draw vectors unless asked for points as an image.</p>
    </Section>
  )
}

export function NumberFormatFields({
  format,
  mixed,
  onChange,
}: {
  format: NumberDisplay
  mixed: boolean
  onChange: (f: NumberDisplay) => void
}) {
  return (
    <div className="field-row">
      <Select
        label="Number format"
        value={format.mode === 'fixed' ? 'fixed' : format.mode === 'auto' ? 'auto' : 'other'}
        mixed={mixed}
        options={[
          { value: 'auto', label: 'Automatic (up to 3 significant digits)' },
          { value: 'fixed', label: 'Fixed decimals' },
          ...(format.mode !== 'auto' && format.mode !== 'fixed'
            ? [{ value: 'other', label: format.mode }]
            : []),
        ]}
        onChange={(v) => {
          if (v === 'other') return
          const { digits, ...rest } = format
          onChange(
            v === 'fixed'
              ? { ...rest, mode: 'fixed', digits: digits ?? 1 }
              : { ...rest, mode: 'auto' },
          )
        }}
      />
      {format.mode === 'fixed' && (
        <NumberInput
          label="Decimals"
          value={format.digits ?? 0}
          min={0}
          max={10}
          onChange={(v) => onChange({ ...format, digits: v })}
        />
      )}
    </div>
  )
}

/** Pie, donut and 100% bar labels: what they say, where, and the decimals of percents. */
function SliceLabelFields({ e }: { e: LayerEdit }) {
  const { layer, ctx } = e
  const s = (layer.style ?? {}) as { content?: string; position?: string; digits?: number }
  const pie = ctx.graph.frame === 'polar'
  return (
    <Section title="Slice labels">
      <div className="field-row">
        <Select
          label="Labels"
          value={s.content ?? 'percent'}
          options={[
            { value: 'percent', label: 'Percent' },
            { value: 'value', label: 'Value' },
            { value: 'valuePercent', label: 'Value (percent)' },
            { value: 'category', label: 'Category' },
            { value: 'categoryPercent', label: 'Category (percent)' },
          ]}
          onChange={(v) => e.set('content', v === 'percent' ? undefined : v, 'Slice labels')}
        />
        {pie && (
          <Select
            label="Position"
            value={s.position === 'outside' ? 'outside' : 'inside'}
            options={[
              { value: 'inside', label: 'Inside the slices' },
              { value: 'outside', label: 'Outside' },
            ]}
            onChange={(v) => e.set('position', v === 'inside' ? undefined : v, 'Slice labels')}
          />
        )}
      </div>
      <NumberInput
        label="Decimals of percentages"
        value={s.digits ?? 0}
        min={0}
        max={6}
        onChange={(v) => e.set('digits', v || undefined, 'Slice labels')}
      />
    </Section>
  )
}

const DECIMALS = ['auto', '0', '1', '2', '3']

/** A heat map's values in the cells: their decimals. */
function CellLabelFields({ e }: { e: LayerEdit }) {
  const format = (e.layer.style as { format?: NumberDisplay } | undefined)?.format
  const decimals = format?.mode === 'fixed' ? String(format.digits ?? 0) : 'auto'
  return (
    <Section title="Values in the cells">
      <Select
        label="Decimals"
        value={decimals}
        options={DECIMALS.map((d) => ({ value: d, label: d === 'auto' ? 'Automatic' : d }))}
        onChange={(v) =>
          e.set(
            'format',
            v === 'auto' ? undefined : { mode: 'fixed', digits: Number(v) },
            'Cell values',
          )
        }
      />
    </Section>
  )
}

/** Pie and donut slices: their fill and border, and the pie's hole, angle and direction. */
function SliceFields({ e }: { e: LayerEdit }) {
  const { ctx, style } = e
  const { graph } = ctx
  const border = style.bar.border
  const pie = graph.frame === 'polar'
  const polar = polarStyle(graph)
  const setPolar = (field: string, v: unknown, label: string) =>
    ctx.set(['style', 'polar', field], v, label)
  return (
    <>
      <Section title="Slices">
        <div className="field-row">
          <FillOpacity e={e} part="bar" label="Fill" />
          <NumberInput
            label="Border between parts (pt)"
            value={border.width}
            mixed={e.differs((s) => s.bar.border.width)}
            min={0}
            max={10}
            step={0.25}
            onChange={(v) => e.set('border', { ...border, width: v }, 'Slice border')}
          />
        </div>
        <p className="muted">
          Parts take their colours from the colour scheme, one per category (row); click a slice
          twice to colour it alone.
        </p>
      </Section>
      {pie && (
        <Section title="Pie">
          <div className="field-row">
            <NumberInput
              label="Hole (% of the radius; 0 = pie)"
              value={pct(polar.hole)}
              min={0}
              max={95}
              step={5}
              onChange={(v) => setPolar('hole', v / 100, 'Donut hole')}
            />
            <NumberInput
              label="First slice starts at (° from 12 o’clock)"
              value={polar.startAngle}
              min={-360}
              max={360}
              step={15}
              onChange={(v) => setPolar('startAngle', v, 'Pie rotation')}
            />
          </div>
          <Select
            label="Slices in row order"
            value={polar.clockwise ? 'cw' : 'ccw'}
            options={[
              { value: 'cw', label: 'Clockwise' },
              { value: 'ccw', label: 'Counter-clockwise' },
            ]}
            onChange={(v) => setPolar('clockwise', v === 'cw' ? undefined : false, 'Pie direction')}
          />
        </Section>
      )}
    </>
  )
}

/** The grand mean's line. */
function ReflineFields({ e }: { e: LayerEdit }) {
  const line = (e.layer.style as { line?: object } | undefined)?.line
  return (
    <Section title="Grand mean">
      <StrokeFields
        label="Line"
        value={{ ...GRAND_MEAN_LINE, ...line }}
        palette={e.ctx.palette}
        onChange={(v) => e.set('line', v, 'Grand mean line')}
      />
    </Section>
  )
}

/** Roadmap 34c: ellipses and hulls — outline, fill or both, the fill's opacity, the outline. */
function PolygonFields({ e }: { e: LayerEdit }) {
  const { ctx, layer } = e
  if (layer.geom !== 'polygon') return null
  const style = overlayStyle(layer, e.key ?? '', ctx.theme)
  return (
    <Section title={layer.stat.kind === 'hull' ? 'Hulls' : 'Ellipses'}>
      <Select
        label="Draw"
        value={style.draw}
        options={[
          { value: 'both', label: 'Fill and outline' },
          { value: 'fill', label: 'Fill only' },
          { value: 'outline', label: 'Outline only' },
        ]}
        onChange={(v) => e.set('draw', v, 'Ellipse fill and outline')}
      />
    </Section>
  )
}

/** Roadmap 34c: paths and vectors — the line, where the heads go, their shape and size. */
function ArrowLineFields({ e }: { e: LayerEdit }) {
  const { ctx, layer } = e
  if (layer.geom !== 'path' && layer.geom !== 'segment') return null
  const style = overlayStyle(layer, e.key ?? '', ctx.theme)
  const path = layer.geom === 'path'
  const table = sourceTable(ctx.project, ctx.graph.seriesSource.table, ctx.lookup)
  const numbers = (table?.dataSets ?? [])
    .filter((d) => !d.text)
    .map((d) => ({ value: d.id as string, label: d.title || d.id }))
  const texts = (table?.dataSets ?? [])
    .filter((d) => d.text)
    .map((d) => ({ value: d.id as string, label: d.title || d.id }))
  const setAes = (field: 'xend' | 'yend' | 'group', v: string, label: string) =>
    ctx.set(layerPath(layer.id, 'aes', field), v || undefined, label)
  return (
    <Section title={path ? 'Paths' : 'Vectors'}>
      {layer.geom === 'segment' && (
        <div className="field-row">
          <Select
            label="X end"
            value={layer.aes?.xend ?? ''}
            options={numbers}
            onChange={(v) => setAes('xend', v, 'Vector X end')}
          />
          <Select
            label="Y end"
            value={layer.aes?.yend ?? ''}
            options={numbers}
            onChange={(v) => setAes('yend', v, 'Vector Y end')}
          />
        </div>
      )}
      {path && layer.aes && (
        <Select
          label="One path per"
          value={layer.aes.group ?? ''}
          options={[{ value: '', label: 'Colour (or shape) group' }, ...texts]}
          onChange={(v) => setAes('group', v, 'Path groups')}
        />
      )}
      <div className="field-row">
        <Select
          label="Arrowheads"
          value={style.arrow}
          options={
            path
              ? [
                  { value: 'none', label: 'None' },
                  { value: 'end', label: 'At the end' },
                  { value: 'along', label: 'Along the path' },
                ]
              : [
                  { value: 'none', label: 'None' },
                  { value: 'end', label: 'At the end' },
                  { value: 'both', label: 'At both ends' },
                ]
          }
          onChange={(v) => e.set('arrow', v, 'Arrowheads')}
        />
        {style.arrow !== 'none' && (
          <Select
            label="Head"
            value={style.head.shape}
            options={ARROW_SHAPES.filter((s) => s.value !== 'none')}
            onChange={(v) =>
              v !== 'none' && e.set('head', { ...style.head, shape: v }, 'Arrowhead shape')
            }
          />
        )}
        {style.arrow !== 'none' && (
          <NumberInput
            label="Head size (%)"
            value={Math.round((style.head.size ?? 1) * 100)}
            min={25}
            max={500}
            step={5}
            onChange={(pct) =>
              e.set(
                'head',
                { shape: style.head.shape, ...(pct !== 100 ? { size: pct / 100 } : {}) },
                'Arrowhead size',
              )
            }
          />
        )}
      </div>
    </Section>
  )
}

/** An estimation plot's differences: guides, and the difference's symbol and CI line. */
function DifferenceFields({ e }: { e: LayerEdit }) {
  const guides = (e.layer.style as { guides?: boolean } | undefined)?.guides !== false
  return (
    <Section title="Estimation plot">
      <p className="muted">
        Each data set’s mean minus the first data set’s (the control), with its confidence interval,
        on the right axis (its zero is the control’s mean). Format that axis in Format axes › Right
        Y axis.
      </p>
      <Checkbox
        label="Dashed lines from the means to the difference axis"
        checked={guides}
        onChange={(v) => e.set('guides', v ? undefined : false, 'Estimation guides')}
      />
      <div className="field-row">
        <NumberInput
          label="Symbol size (pt)"
          value={e.style.points.size}
          min={1}
          max={30}
          step={0.5}
          onChange={(v) => e.set('size', v)}
        />
        <NumberInput
          label="Cap width (pt)"
          value={e.style.error.capWidth}
          min={0}
          max={40}
          onChange={(v) => e.set('capWidth', v)}
        />
      </div>
    </Section>
  )
}

function CensorFields({ e }: { e: LayerEdit }) {
  return (
    <Section title="Censored ticks">
      <NumberInput
        label="Tick height (pt)"
        value={e.style.points.size}
        mixed={e.differs((x) => x.points.size)}
        min={1}
        max={30}
        step={0.5}
        onChange={(v) => e.set('size', v)}
      />
    </Section>
  )
}

/**
 * Heat maps (roadmap 30): the colour map and its range, z-scores, clustering with dendrograms,
 * values in the cells (a labels layer on the cells) and the colour scale.
 */
function TileFields({ e }: { e: LayerEdit }) {
  const { ctx, layer } = e
  const { graph, palette } = ctx
  const tile = layer as LayerOf<'tile'>
  const color = graph.scales?.color ?? {}
  const style = tile.style ?? {}
  const cluster = style.cluster ?? {}
  const setScale = (field: string, v: unknown, label: string) =>
    ctx.set(['scales', 'color', field], v, label)
  const setCluster = (field: string, v: unknown, label: string) =>
    ctx.set(layerPath(layer.id, 'style', 'cluster', field), v, label)
  // A colour map, or two colours of the user's own (the colour scale's pair, as bubble plots).
  const two = Array.isArray(color.colors) ? color.colors : null
  const map = two ? null : COLOR_MAPS[typeof color.colors === 'string' ? color.colors : 'viridis']
  const clustered = !!(cluster.rows || cluster.columns)
  const standardize = tile.stat.kind === 'cell' ? (tile.stat.standardize ?? 'none') : 'none'
  const values = graph.layers.find((l) => l.geom === 'label' && l.on === layer.id)
  const showValues = !!values && values.visible !== false
  const bar = color.bar ?? {}
  return (
    <>
      <Section title="Colours">
        <div className="field-row">
          <Select
            label="Colour map"
            value={two ? 'two' : typeof color.colors === 'string' ? color.colors : 'viridis'}
            options={[
              ...Object.entries(COLOR_MAPS).map(([value, m]) => ({
                value: value as ColorMapName | 'two',
                label: m.diverging ? `${m.label} (diverging)` : m.label,
              })),
              { value: 'two', label: 'Two colours of my own' },
            ]}
            onChange={(v) =>
              setScale(
                'colors',
                v === 'viridis' ? undefined : v === 'two' ? [...GRADIENT_COLORS] : v,
                'Colour map',
              )
            }
          />
          <Checkbox
            label="Reversed"
            checked={!!color.reverse}
            onChange={(v) => setScale('reverse', v || undefined, 'Reverse colours')}
          />
        </div>
        {map && (
          <div className="palette-preview" aria-hidden>
            {map.stops.map((c) => (
              <span key={c} style={{ background: c }} />
            ))}
          </div>
        )}
        {two && (
          <div className="field-row">
            <ColorField
              label="Lowest value"
              value={two[0]}
              palette={palette}
              onChange={(rgb) => setScale('colors', [rgb, two[1]], 'Colour map')}
            />
            <ColorField
              label="Highest value"
              value={two[1]}
              palette={palette}
              onChange={(rgb) => setScale('colors', [two[0], rgb], 'Colour map')}
            />
          </div>
        )}
        <Checkbox
          label="Fixed range (else the data’s smallest to largest value)"
          checked={color.min !== undefined || color.max !== undefined}
          onChange={(v) =>
            ctx.dispatch(
              [
                {
                  type: 'node.set',
                  id: graph.id,
                  path: ['scales', 'color', 'min'],
                  value: v ? 0 : undefined,
                },
                {
                  type: 'node.set',
                  id: graph.id,
                  path: ['scales', 'color', 'max'],
                  value: v ? 1 : undefined,
                },
              ],
              'Colour range',
            )
          }
        />
        {(color.min !== undefined || color.max !== undefined) && (
          <div className="field-row">
            <NumberInput
              label="Lowest colour at"
              value={color.min ?? 0}
              onChange={(v) => setScale('min', v, 'Colour range')}
            />
            <NumberInput
              label="Highest colour at"
              value={color.max ?? 1}
              onChange={(v) => setScale('max', v, 'Colour range')}
            />
          </div>
        )}
        {map?.diverging && (
          <div className="field-row">
            <Checkbox
              label="Middle colour at a chosen value (else 0, or the range’s middle)"
              checked={color.midpoint !== undefined}
              onChange={(v) => setScale('midpoint', v ? 0 : undefined, 'Midpoint')}
            />
            {color.midpoint !== undefined && (
              <NumberInput
                label="Midpoint"
                value={color.midpoint}
                onChange={(v) => setScale('midpoint', v, 'Midpoint')}
              />
            )}
          </div>
        )}
        <ColorField
          label="Cells without a value"
          value={style.missing ?? MISSING_COLOR}
          palette={palette}
          onChange={(rgb) =>
            e.set('missing', rgb === MISSING_COLOR ? undefined : rgb, 'Missing colour')
          }
        />
        <Checkbox
          label="White lines between the cells"
          checked={!!style.border}
          onChange={(v) =>
            e.set(
              'border',
              v ? { color: { rgb: '#ffffff' }, width: 0.5, dash: 'solid' } : undefined,
              'Cell borders',
            )
          }
        />
      </Section>
      <Section title="Scaling and clustering">
        <Select
          label="Values shown"
          value={standardize}
          options={[
            { value: 'none', label: 'As entered (the mean of each cell)' },
            { value: 'row', label: 'Z-scores of each row' },
            { value: 'column', label: 'Z-scores of each column' },
          ]}
          onChange={(v) =>
            e.setStat(
              v === 'none'
                ? { kind: 'cell' }
                : { kind: 'cell', standardize: v as 'row' | 'column' },
              'Scale values',
            )
          }
        />
        <div className="field-row">
          <Checkbox
            label="Cluster rows"
            checked={!!cluster.rows}
            onChange={(v) => ctx.dispatch(clusterCommands(graph, tile, 'rows', v), 'Cluster rows')}
          />
          <Checkbox
            label="Cluster columns"
            checked={!!cluster.columns}
            onChange={(v) =>
              ctx.dispatch(clusterCommands(graph, tile, 'columns', v), 'Cluster columns')
            }
          />
        </div>
        {clustered && (
          <div className="field-row">
            <ClusterMethod
              value={cluster}
              onChange={(field, v, label) => setCluster(field, v, label)}
            />
          </div>
        )}
        <p className="muted">
          Rows (and columns) are ordered as R’s hclust orders them, clustered on the values shown.
          Their trees are layers of their own (Row dendrogram, Column dendrogram): their size, side
          and cut are theirs.
        </p>
      </Section>
      <Section title="Values in the cells and colour scale">
        <Checkbox
          label="Values in the cells"
          checked={showValues}
          onChange={(v) =>
            ctx.dispatch(
              values
                ? {
                    type: 'node.set',
                    id: graph.id,
                    path: layerPath(values.id, 'visible'),
                    value: v ? undefined : false,
                  }
                : {
                    type: 'graph.addLayer',
                    id: graph.id,
                    layer: { id: 'values', geom: 'label', stat: { kind: 'cell' }, on: layer.id },
                  },
              'Cell values',
            )
          }
        />
        <div className="field-row">
          <Checkbox
            label="Colour scale"
            checked={bar.show !== false}
            onChange={(v) =>
              setScale('bar', { ...bar, show: v ? undefined : false }, 'Colour scale')
            }
          />
          {bar.show !== false && (
            <Select
              label="Position"
              value={bar.position ?? 'right'}
              options={[
                { value: 'right', label: 'Right of the map' },
                { value: 'bottom', label: 'Below the map' },
              ]}
              onChange={(v) =>
                setScale('bar', { ...bar, position: v === 'right' ? undefined : v }, 'Colour scale')
              }
            />
          )}
        </div>
        {bar.show !== false && (
          <TextInput
            label="Title of the colour scale"
            value={bar.title ?? ''}
            placeholder={standardize !== 'none' ? 'z-score' : ''}
            onChange={(v) =>
              setScale('bar', { ...bar, title: v || undefined }, 'Colour scale title')
            }
          />
        )}
      </Section>
    </>
  )
}

/** A clustering's distance and linkage (R's dist / 1 − cor and hclust methods). */
function ClusterMethod({
  value,
  onChange,
}: {
  value: { distance?: 'euclidean' | 'pearson' | undefined; linkage?: string | undefined }
  onChange: (field: 'distance' | 'linkage', v: string | undefined, label: string) => void
}) {
  return (
    <>
      <Select
        label="Distance"
        value={value.distance ?? 'euclidean'}
        options={[
          { value: 'euclidean', label: 'Euclidean' },
          { value: 'pearson', label: '1 − Pearson r' },
        ]}
        onChange={(v) => onChange('distance', v === 'euclidean' ? undefined : v, 'Distance')}
      />
      <Select
        label="Linkage"
        value={value.linkage ?? 'complete'}
        options={[
          { value: 'complete', label: 'Complete' },
          { value: 'average', label: 'Average (UPGMA)' },
          { value: 'ward', label: 'Ward (ward.D2)' },
        ]}
        onChange={(v) => onChange('linkage', v === 'complete' ? undefined : v, 'Linkage')}
      />
    </>
  )
}

/**
 * Roadmap 49c: a heat map's clustering of its rows or columns turned on — with its tree, a layer
 * of its own (Row / Column dendrogram) added at the front unless one is there — or off, its trees
 * removed with it (a tree left would cluster the axis by itself). One step.
 */
export function clusterCommands(
  graph: GraphNode,
  tile: Layer,
  of: 'rows' | 'columns',
  on: boolean,
): Command[] {
  const set: Command = {
    type: 'node.set',
    id: graph.id,
    path: layerPath(tile.id, 'style', 'cluster', of),
    value: on || undefined,
  }
  const trees = graph.layers.filter((l) => l.geom === 'dendrogram' && l.stat.of === of)
  if (on)
    return trees.length
      ? [set]
      : [set, { type: 'graph.addLayer', id: graph.id, layer: treeLayer(of, graph.layers) }]
  return [
    set,
    ...trees.map((l): Command => ({ type: 'graph.removeLayer', id: graph.id, layer: l.id })),
  ]
}

/** Roadmap 49c: a tree's heat map — the graph's first drawn tile layer, if any. */
const heatMapOf = (graph: GraphNode) =>
  graph.layers.find((l): l is LayerOf<'tile'> => l.geom === 'tile' && l.visible !== false)

/** A height as a cut's default and in words: 4 significant digits. */
const roundHeight = (h: number) => +h.toPrecision(4)

/**
 * Roadmap 49c: a tree's clustering — what it is of (alone), its distance and linkage (beside a
 * heat map clustering that axis, the heat map's, shared with its other tree) — and its cut into
 * clusters (R's cutree: into k, or at a height, with the clusters it leaves).
 */
function TreeStatRows({ e }: { e: LayerEdit }) {
  const { ctx } = e
  const layer = e.layer as LayerOf<'dendrogram'>
  const stat = layer.stat
  const tile = heatMapOf(ctx.graph)
  const owner = tile?.style?.cluster?.[stat.of] ? tile : undefined
  // Audit 4 (P4): not on every render (the clustering itself is shared with the layout).
  const hc = useMemo(
    () => treeOfLayer(ctx.project, ctx.graph, layer, ctx.lookup),
    [ctx.project, ctx.graph, layer, ctx.lookup],
  )
  const n = hc?.order.length ?? 0
  const top = hc?.height.length ? hc.height[hc.height.length - 1]! : 0
  const cut = stat.cut
  const withStat = (patch: Record<string, unknown>, label: string) => {
    const next = { ...stat, ...patch } as Record<string, unknown>
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k]
    e.setStat(next as Stat, label)
  }
  // Two clusters: a cut half way between the two highest merges.
  const height2 = hc && hc.height.length > 1 ? (top + hc.height[hc.height.length - 2]!) / 2 : top
  return (
    <>
      {!tile && (
        <Select
          label="Tree of"
          value={stat.of}
          options={[
            { value: 'rows', label: 'The rows' },
            { value: 'columns', label: 'The data sets (columns)' },
          ]}
          onChange={(v) => withStat({ of: v }, 'Tree of')}
        />
      )}
      <div className="field-row">
        <ClusterMethod
          value={owner?.style?.cluster ?? stat}
          onChange={(field, v, label) =>
            owner
              ? ctx.set(layerPath(owner.id, 'style', 'cluster', field), v, label)
              : withStat({ [field]: v }, label)
          }
        />
      </div>
      {owner && (
        <p className="muted">
          The heat map’s clustering, which orders its cells (its other tree’s too).
        </p>
      )}
      <div className="field-row">
        <Select
          label="Cut the tree"
          value={cut ? ('k' in cut ? 'k' : 'h') : 'none'}
          options={[
            { value: 'none', label: 'Not cut' },
            { value: 'k', label: 'Into clusters' },
            { value: 'h', label: 'At a height' },
          ]}
          onChange={(v) =>
            withStat(
              {
                cut:
                  v === 'k'
                    ? { k: Math.min(2, Math.max(1, n)) }
                    : v === 'h'
                      ? { h: roundHeight(height2) }
                      : undefined,
              },
              v === 'none' ? 'Uncut tree' : 'Cut the tree',
            )
          }
        />
        {cut && 'k' in cut && (
          <NumberInput
            label="Clusters"
            value={cut.k}
            min={1}
            max={Math.max(1, Math.min(n, MAX_CLUSTERS))}
            step={1}
            onChange={(v) => withStat({ cut: { k: Math.max(1, Math.round(v)) } }, 'Clusters')}
          />
        )}
        {cut && 'h' in cut && (
          <NumberInput
            label="Height"
            value={cut.h}
            min={0}
            onChange={(v) => withStat({ cut: { h: Math.max(0, v) } }, 'Cut height')}
          />
        )}
      </div>
      {cut && hc && (
        <p className="muted">
          {'h' in cut
            ? `${treeClusters(hc, cut, [])?.count ?? 0} clusters at this height (merges from 0 to ${roundHeight(top)}).`
            : `Clusters as R’s cutree numbers them, in the order of the ${stat.of === 'rows' ? 'rows' : 'data sets'}.`}
        </p>
      )}
    </>
  )
}

/**
 * Roadmap 49c: a tree's size and place — beside a heat map its side, depth and gap (the outer
 * edge can be dragged on the canvas too), alone where its leaves are (the axes swapped with it) —
 * its branch heights, and a cut tree's colours and strip.
 */
function DendrogramFields({ e }: { e: LayerEdit }) {
  const { ctx } = e
  const { graph, theme, palette } = ctx
  const layer = e.layer as LayerOf<'dendrogram'>
  const tree = treeStyle(layer, theme)
  const alone = !heatMapOf(graph)
  const of = layer.stat.of
  const own = layer.style ?? {}
  const d = theme.dendrogram
  const set = (field: string, v: unknown, label: string) => e.set(field, v, label)
  const down = tree.side === 'left' || tree.side === 'right'
  const hc = useMemo(
    () => (layer.stat.cut ? treeOfLayer(ctx.project, graph, layer, ctx.lookup) : null),
    [ctx.project, graph, layer, ctx.lookup],
  )
  const count = hc ? (treeClusters(hc, layer.stat.cut, [])?.count ?? 0) : 0
  /** A dendrogram alone turned: its side, the axes and the plot's sides swapped, one step. */
  const leaves = (v: 'bottom' | 'left') => {
    if ((v === 'left') === down) return
    const cmds: Command[] = [
      ...styleCommands(graph, layer, null, [['side', v === 'left' ? 'right' : 'top']]),
      { type: 'node.set', id: graph.id, path: ['axes', 'x'], value: graph.axes.y },
      { type: 'node.set', id: graph.id, path: ['axes', 'y'], value: graph.axes.x },
      {
        type: 'node.set',
        id: graph.id,
        path: ['size'],
        value: {
          ...graph.size,
          plotWidth: graph.size.plotHeight,
          plotHeight: graph.size.plotWidth,
        },
      },
    ]
    ctx.dispatch(cmds, v === 'left' ? 'Leaves down the left' : 'Leaves along the bottom')
  }
  return (
    <>
      <Section title="Size and place">
        {alone ? (
          <Select
            label="Leaves"
            value={down ? 'left' : 'bottom'}
            options={[
              { value: 'bottom', label: 'Along the bottom (the tree above)' },
              { value: 'left', label: 'Down the left (the tree beside)' },
            ]}
            onChange={leaves}
          />
        ) : (
          <>
            <Select
              label="Side"
              value={
                of === 'rows'
                  ? tree.side === 'left'
                    ? 'left'
                    : 'right'
                  : tree.side === 'bottom'
                    ? 'bottom'
                    : 'top'
              }
              options={
                of === 'rows'
                  ? [
                      { value: 'right', label: 'Right of the map' },
                      { value: 'left', label: 'Left of the map (row names on the far side)' },
                    ]
                  : [
                      { value: 'top', label: 'Above the map' },
                      { value: 'bottom', label: 'Below the map (column names beyond it)' },
                    ]
              }
              onChange={(v) =>
                set('side', v === (of === 'rows' ? 'right' : 'top') ? undefined : v, 'Tree side')
              }
            />
            <div className="field-row">
              <NumberInput
                label={of === 'rows' ? 'Tree width (pt)' : 'Tree height (pt)'}
                value={tree.depth}
                min={4}
                max={400}
                onChange={(v) => set('depth', v === d.depth ? undefined : v, 'Dendrogram size')}
              />
              <NumberInput
                label="Gap to the map (pt)"
                value={tree.gap}
                min={0}
                max={100}
                onChange={(v) => set('gap', v === d.gap ? undefined : v, 'Dendrogram gap')}
              />
            </div>
          </>
        )}
        <Select
          label="Branch heights"
          value={tree.heights}
          options={[
            { value: 'merge', label: 'Merge heights (R’s hclust)' },
            { value: 'steps', label: 'Equal steps' },
          ]}
          onChange={(v) => set('heights', v === 'merge' ? undefined : v, 'Branch heights')}
        />
      </Section>
      {layer.stat.cut && (
        <Section title="Cluster colours">
          <Checkbox
            label="Branches below the cut in their cluster’s colour"
            checked={tree.colorBranches}
            onChange={(v) => set('colorBranches', v ? undefined : false, 'Cluster colours')}
          />
          <div className="field-row">
            <Checkbox
              label={
                alone ? 'Cluster strip by the leaves' : 'Cluster strip between the tree and the map'
              }
              checked={tree.strip}
              onChange={(v) => set('strip', v || undefined, 'Cluster strip')}
            />
            {tree.strip && (
              <NumberInput
                label="Strip width (pt)"
                value={tree.stripWidth}
                min={1}
                max={50}
                onChange={(v) =>
                  set('stripWidth', v === d.stripWidth ? undefined : v, 'Strip width')
                }
              />
            )}
          </div>
          {count > 0 && (
            <fieldset className="field cluster-colors">
              <legend>Cluster colours</legend>
              {Array.from({ length: Math.min(count, MAX_CLUSTER_SWATCHES) }, (_, i) => {
                const c = i + 1
                const mine = tree.clusterColors[String(c)]
                return (
                  <ColorField
                    key={c}
                    label={`Cluster ${c}`}
                    value={clusterColor(tree, palette, c)}
                    palette={palette}
                    automatic={{
                      on: !mine,
                      label: 'The palette’s',
                      css: clusterColor({ ...tree, clusterColors: {} }, palette, c),
                      onPick: () =>
                        set(
                          'clusterColors',
                          withoutKey(own.clusterColors, String(c)),
                          'Cluster colour',
                        ),
                    }}
                    onChange={(_, ref) =>
                      set(
                        'clusterColors',
                        { ...own.clusterColors, [String(c)]: ref },
                        'Cluster colour',
                      )
                    }
                  />
                )
              })}
              {count > MAX_CLUSTER_SWATCHES && (
                <p className="muted">
                  Clusters past {MAX_CLUSTER_SWATCHES} take the palette in turn.
                </p>
              )}
            </fieldset>
          )}
        </Section>
      )}
    </>
  )
}

/** Most cluster colours offered to pick (the others follow the palette). */
const MAX_CLUSTER_SWATCHES = 24

/** A record without a key (undefined when nothing is left). */
function withoutKey<T>(o: Readonly<Record<string, T>> | undefined, key: string) {
  if (!o) return undefined
  const { [key]: _, ...rest } = o
  return Object.keys(rest).length ? rest : undefined
}

/**
 * Bubble plots: which variables are X and Y (colour, shape, size and labels, and their scales:
 * Appearance by variable, roadmap 34b).
 */
function BubbleFields({ e }: { e: LayerEdit }) {
  const { ctx, layer } = e
  const { graph, project } = ctx
  const table = sourceTable(project, graph.seriesSource.table, ctx.lookup)
  if (!table) return null
  const vars = bubbleVariables(graph, table)
  const options = table.dataSets
    .filter((d) => !d.text)
    .map((d) => ({ value: d.id as string, label: d.title || d.id }))
  const titleOf = (k: string | undefined) => table.dataSets.find((d) => d.id === k)?.title
  /** Chooses a variable; an axis untitled or titled after the old variable follows the new one. */
  const choose = (field: 'x' | 'y', key: string) => {
    const cmds: Command[] = [
      {
        type: 'node.set',
        id: graph.id,
        path: layerPath(layer.id, 'aes', field),
        value: key || undefined,
      },
    ]
    const axis = graph.axes[field]
    const shown = richPlain(axis.title?.content)
    if (!axis.title || shown === titleOf(vars[field]))
      cmds.push({
        type: 'node.set',
        id: graph.id,
        path: ['axes', field, 'title'],
        value: { content: plainText(titleOf(key) ?? ''), style: axis.title?.style },
      })
    ctx.dispatch(cmds, 'Bubble variables')
  }
  return (
    <Section title="Map variables">
      <div className="field-row">
        <Select label="X" value={vars.x ?? ''} options={options} onChange={(v) => choose('x', v)} />
        <Select label="Y" value={vars.y ?? ''} options={options} onChange={(v) => choose('y', v)} />
      </div>
      <p className="muted">
        Rows missing X, Y or the size variable are left out. Colour, shape, size and labels by
        variable: Appearance by variable, above.
      </p>
    </Section>
  )
}

/** The sections of a layer's geom. */
function GeomSections({ e }: { e: LayerEdit }) {
  const { layer } = e
  switch (layer.geom) {
    case 'points':
      // A dot plot's dots (roadmap 34g): their symbol; sizes and colours are its statistics'.
      if (layer.stat.kind === 'dotplot') return <SymbolsSection e={e} />
      return layer.aes ? (
        <>
          <BubbleFields e={e} />
          <PointDensityFields e={e} />
          <SymbolsSection e={e} bubbles />
          <PointsDrawFields e={e} />
        </>
      ) : (
        <>
          <SymbolsSection e={e} />
          <PointsDrawFields e={e} />
        </>
      )
    case 'bar':
      return <BarsSection e={e} />
    case 'errorbar':
      return <ErrorBarsFields e={e} />
    case 'center':
      return <CenterFields e={e} />
    case 'box':
      return <BoxFields e={e} />
    case 'violin':
      return <ViolinFields e={e} />
    case 'line':
    case 'step':
      return <LineFields e={e} />
    case 'band':
    case 'area':
      return <BandFields e={e} />
    case 'censor':
      return <CensorFields e={e} />
    case 'connector':
      // Roadmap 49a: its line is the Appearance table's.
      return null
    case 'refline':
      return <ReflineFields e={e} />
    case 'difference':
      return <DifferenceFields e={e} />
    case 'tile':
      return <TileFields e={e} />
    case 'dendrogram':
      return <DendrogramFields e={e} />
    case 'wedge':
      return <SliceFields e={e} />
    case 'label':
      return <LabelFields e={e} />
    case 'polygon':
      return <PolygonFields e={e} />
    case 'path':
    case 'segment':
      return <ArrowLineFields e={e} />
    case 'hex':
      return <HexFields e={e} />
    case 'contour':
      return <ContourFields e={e} />
    case 'raster':
      return <RasterFields e={e} />
  }
}

/**
 * Roadmap 46 (stage 2): what a layer draws, by the part of a graph a reader sees — the title of
 * its section in a data set's place ("Symbols", "Bars", "Error bars", "Line"…) — and as a noun
 * for "Show points for this data set".
 */
export function layerPart(layer: Layer): { title: string; noun: string } {
  const stat = layer.stat.kind
  switch (layer.geom) {
    case 'points':
      // A dot plot's dots are symbols (sized and coloured by its statistics).
      return layer.aes && stat !== 'dotplot'
        ? { title: 'Bubbles', noun: 'bubbles' }
        : { title: 'Symbols', noun: 'points' }
    case 'bar':
      return stat === 'fraction'
        ? { title: 'Slices', noun: 'slices' }
        : { title: 'Bars', noun: 'bars' }
    case 'errorbar':
      return { title: 'Error bars', noun: 'error bars' }
    case 'center':
      return { title: 'Centre line', noun: 'the centre line' }
    case 'line':
      return { title: 'Line', noun: 'the line' }
    case 'step':
      return { title: 'Survival curve', noun: 'the survival curve' }
    case 'band':
      return { title: 'Band', noun: 'the band' }
    case 'area':
      return { title: 'Area', noun: 'the area' }
    case 'box':
      return { title: 'Box', noun: 'boxes' }
    case 'violin':
      return { title: 'Violin', noun: 'violins' }
    case 'label':
      return { title: 'Labels', noun: 'labels' }
    case 'polygon':
      return stat === 'hull'
        ? { title: 'Hulls', noun: 'hulls' }
        : { title: 'Ellipses', noun: 'ellipses' }
    case 'path':
      return { title: 'Paths', noun: 'paths' }
    case 'segment':
      return { title: 'Vectors', noun: 'vectors' }
    case 'censor':
      return { title: 'Censored ticks', noun: 'censored ticks' }
    case 'connector':
      return { title: 'Connecting lines', noun: 'connecting lines' }
    case 'difference':
      return { title: 'Estimation plot', noun: 'the estimation plot' }
    case 'wedge':
      return { title: 'Slices', noun: 'slices' }
    case 'hex':
      return { title: 'Hexagons', noun: 'hexagons' }
    case 'contour':
      return { title: 'Density contours', noun: 'density contours' }
    case 'raster':
      return { title: 'Density image', noun: 'the density image' }
    case 'tile':
      return { title: 'Heat map', noun: 'the heat map' }
    case 'dendrogram':
      return { title: 'Dendrogram', noun: 'the dendrogram' }
    case 'refline':
      return { title: 'Grand mean', noun: 'the grand mean' }
    default:
      return { title: 'Marks', noun: 'marks' }
  }
}

/**
 * Roadmap 46 (stage 2, the user's choice): a layer's fields a data set's (or layer's) Common
 * settings show — a line's width and style; error bars' kind and cap width — none for others.
 * The same layer's section then leaves them out (`LayerFields`' `common`).
 */
export function CommonLayerFields({
  ctx,
  layer,
  items,
  seriesKey,
}: {
  ctx: PanelContext
  layer: Layer
  items: readonly SeriesItem[]
  seriesKey: SeriesKeys
}) {
  const e = layerEdit(ctx, layer, items, seriesKey, true)
  // Roadmap 46b: the Significance layer's Common settings are the graph's cut-offs.
  if (layer.stat.kind === 'threshold') return <CutoffFields ctx={ctx} />
  // Roadmap 49a: the Appearance table's line width and style (by data set or fixed).
  if (layer.geom === 'line' || layer.geom === 'step')
    return <AppearanceSection e={e} only={['lineWidth', 'dash']} bare />
  if (layer.geom === 'errorbar')
    return (
      <div className="field-row">
        <ErrorKind e={e} />
        <CapWidth e={e} />
      </div>
    )
  return null
}

/** Whether a layer has fields in Common (`CommonLayerFields`). */
export const hasCommonFields = (layer: Layer): boolean =>
  layer.geom === 'line' ||
  layer.geom === 'step' ||
  layer.geom === 'errorbar' ||
  layer.stat.kind === 'threshold'

/** A layer's name and its entry in the legend (a layer's Advanced settings). */
export function LayerNameFields({ ctx, layer }: { ctx: PanelContext; layer: Layer }) {
  const set = (path: string, v: unknown, label: string) =>
    ctx.set(layerPath(layer.id, path), v, label)
  return (
    <>
      <TextInput
        label="Layer name"
        value={layer.name ?? ''}
        placeholder={layerName({ ...ctx.graph }, { ...layer, name: undefined } as Layer)}
        onChange={(v) => set('name', v.trim() ? v.trim().slice(0, 80) : undefined, 'Rename layer')}
      />
      <Checkbox
        label="Layer in the legend"
        checked={layer.legend !== 'hide'}
        onChange={(v) =>
          set('legend', v ? undefined : 'hide', v ? 'Layer in legend' : 'Layer out of legend')
        }
      />
    </>
  )
}

/** Whether a layer draws a data set ("Show points for this data set"). */
export function ShowForDataSet({
  ctx,
  layer,
  seriesKey,
}: {
  ctx: PanelContext
  layer: Layer
  seriesKey: string
}) {
  const hidden = layer.series?.[seriesKey]?.hide ?? layer.seriesHidden ?? false
  return (
    <Checkbox
      label={`Show ${layerPart(layer).noun} for this data set`}
      checked={!hidden}
      onChange={(v) =>
        ctx.set(
          layerPath(layer.id, 'series', seriesKey, 'hide'),
          v === !(layer.seriesHidden ?? false) ? undefined : !v,
          v ? 'Show layer for data set' : 'Hide layer for data set',
        )
      }
    />
  )
}

/** Whether a layer is a line, band or label of typed values or of an analysis' results. */
export const isResultLayer = (layer: Layer): boolean =>
  layer.stat.kind === 'result' && (layer.data?.from === 'values' || layer.data?.from === 'analysis')

/**
 * A layer's fields for every series it draws (`seriesKey` null) or one: its statistic, position
 * and its geom's sections — those `common` shows elsewhere left out. A layer of typed values or
 * an analysis' results: its own panel.
 */
export function LayerFields({
  ctx,
  layer,
  items,
  seriesKey,
  common = false,
}: {
  ctx: PanelContext
  layer: Layer
  items: readonly SeriesItem[]
  seriesKey: SeriesKeys
  /** The place's Common settings show this layer's `CommonLayerFields`. */
  common?: boolean
}) {
  const e = layerEdit(ctx, layer, items, seriesKey, common)
  // Roadmap 46b: an identity or reference line y = a·x + b.
  if (isTypedSloped(layer)) return <IdentityLinePanel ctx={ctx} layer={layer} />
  // Roadmap 36: a line or band at typed values.
  if (layer.stat.kind === 'result' && layer.data?.from === 'values')
    return (
      <TypedValuesPanel
        ctx={ctx}
        layer={layer as Parameters<typeof TypedValuesPanel>[0]['layer']}
      />
    )
  // Roadmap 46b: the Significance layer: the graph's cut-offs, its classes' colours, symbols.
  if (layer.stat.kind === 'threshold')
    return (
      <>
        <SignificancePanel ctx={ctx} layer={layer} />
        <GeomSections e={e} />
      </>
    )
  // Roadmap 35: a layer of an analysis' results.
  if (layer.stat.kind === 'result' && layer.data?.from === 'analysis')
    return (
      <ResultLayerPanel
        ctx={ctx}
        layer={layer as Parameters<typeof ResultLayerPanel>[0]['layer']}
      />
    )
  return (
    <>
      <StatRow e={e} />
      <PositionRow e={e} />
      <AppearanceSection
        e={e}
        omit={
          common && (layer.geom === 'line' || layer.geom === 'step') ? ['lineWidth', 'dash'] : []
        }
      />
      <GeomSections e={e} />
    </>
  )
}
