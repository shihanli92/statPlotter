import {
  COLOR_MAPS,
  DENSITY_BINS,
  DENSITY_GRID,
  DENSITY_SHARES,
  densityStyle,
  HEX_BINS,
} from '@ps/graph'
import { type ColorMapName, type Dash, isBySeries, type Layer, sourceTable } from '@ps/model'
import type { ReactNode } from 'react'
import { Checkbox, NumberInput, Section, Select, TextInput } from '../../components/fields.tsx'
import { StrokeFields } from '../../components/formatFields.tsx'
import type { LayerEdit } from './LayerFields.tsx'
import { layerPath } from './layers.ts'

// Format graph › Layers for roadmap 34g's layers: hexagons (their size, colours by count, a log
// scale), density contours and images (the bandwidth's multiplier, the grid, the levels, lines or
// filled bands), points coloured by their local density, and dot plots (the group variable, the
// threshold, the average and its scaling).

/** The stat rows of a density or dot plot layer (null for other layers). */
export function densityStatRows(e: LayerEdit): ReactNode[] {
  const { layer, stat } = e
  const rows: ReactNode[] = []
  if (stat.kind === 'hexbin')
    rows.push(
      <NumberInput
        key="bins"
        label="Hexagons across"
        value={stat.bins ?? HEX_BINS}
        min={2}
        max={300}
        step={1}
        onChange={(v) => e.setStat({ ...stat, bins: Math.round(v) }, 'Hexagons across')}
      />,
    )
  if (stat.kind === 'density2d') {
    rows.push(
      <div className="field-row" key="kde">
        <NumberInput
          label="Bandwidth × (adjust)"
          value={stat.adjust ?? 1}
          min={0.05}
          max={20}
          step={0.1}
          onChange={(v) => e.setStat({ ...stat, adjust: v }, 'Density bandwidth')}
        />
        <NumberInput
          label="Grid points per side"
          value={stat.n ?? DENSITY_GRID}
          min={10}
          max={400}
          step={10}
          onChange={(v) => e.setStat({ ...stat, n: Math.round(v) }, 'Density grid')}
        />
      </div>,
    )
    if (layer.geom === 'contour') {
      const shares = stat.shares ?? DENSITY_SHARES
      rows.push(
        <div className="field-row" key="levels">
          <Select
            label="Contour levels"
            value={stat.levels ?? 'pretty'}
            options={[
              { value: 'pretty', label: 'Round density levels (ggplot2’s)' },
              { value: 'shares', label: 'Enclosing shares of the points' },
            ]}
            onChange={(v) =>
              e.setStat(
                { ...stat, levels: v === 'pretty' ? undefined : (v as 'shares') },
                'Contour levels',
              )
            }
          />
          {stat.levels === 'shares' ? (
            <TextInput
              label="Shares (%)"
              value={shares.map((p) => +(p * 100).toPrecision(4)).join(', ')}
              onChange={(v) => {
                const list = v
                  .split(/[,;\s]+/)
                  .filter(Boolean)
                  .map((t) => Number(t) / 100)
                if (list.length && list.every((p) => p > 0 && p < 1))
                  e.setStat({ ...stat, shares: list.slice(0, 12) }, 'Contour shares')
              }}
            />
          ) : (
            <NumberInput
              label="About this many levels"
              value={stat.bins ?? DENSITY_BINS}
              min={2}
              max={40}
              step={1}
              onChange={(v) => e.setStat({ ...stat, bins: Math.round(v) }, 'Contour levels')}
            />
          )}
        </div>,
      )
    }
  }
  if (stat.kind === 'dotplot') {
    rows.push(<DotPlotRows key="dots" e={e} />)
  }
  return rows
}

/** Roadmap 34g: a dot plot's group variable, threshold, average and scaling. */
function DotPlotRows({ e }: { e: LayerEdit }) {
  const { ctx, layer, stat } = e
  if (stat.kind !== 'dotplot') return null
  const table = sourceTable(ctx.project, ctx.graph.seriesSource.table, ctx.lookup)
  const texts = table?.dataSets.filter((d) => !!d.text) ?? []
  const group = layer.aes?.group ?? ''
  /** Every dot plot layer groups by the same variable. */
  const setGroup = (v: string) =>
    ctx.dispatch(
      ctx.graph.layers
        .filter((l) => l.stat.kind === 'dotplot')
        .map((l) => ({
          type: 'node.set' as const,
          id: ctx.graph.id,
          path: layerPath(l.id, 'aes'),
          value: { ...l.aes, group: v },
        })),
      'Dot plot groups',
    )
  return (
    <>
      <Select
        label="Groups (rows)"
        value={group}
        options={[
          ...(group ? [] : [{ value: '', label: '(none)' }]),
          ...texts.map((d) => ({ value: d.id as string, label: d.title || d.id })),
        ]}
        onChange={(v) => v && setGroup(v)}
      />
      <div className="field-row">
        <NumberInput
          label="Expressing above"
          value={stat.threshold ?? 0}
          onChange={(v) => e.setStat({ ...stat, threshold: v }, 'Dot plot threshold')}
        />
        <Select
          label="Average"
          value={stat.average ?? 'mean'}
          options={[
            { value: 'mean', label: 'Mean' },
            { value: 'expm1', label: 'Log-normalised (Seurat: log1p of mean expm1)' },
          ]}
          onChange={(v) =>
            e.setStat({ ...stat, average: v as 'mean' | 'expm1' }, 'Dot plot average')
          }
        />
      </div>
      <Checkbox
        label="Scale each variable across the groups (z-score, clipped at ±2.5)"
        checked={stat.scale ?? true}
        onChange={(v) => e.setStat({ ...stat, scale: v ? undefined : false }, 'Dot plot scaling')}
      />
    </>
  )
}

type DensityLayer = Extract<Layer, { geom: 'hex' | 'contour' | 'raster' }>

/** The colours of a density layer's values: a colour map, reversed, log, and its colour bar. */
function DensityColorFields({ e, counts }: { e: LayerEdit; counts?: boolean }) {
  const layer = e.layer as DensityLayer
  const style = densityStyle(layer, e.key ?? '', e.ctx.theme)
  // The graph's style's colour map, else viridis: chosen, the layer keeps none of its own.
  const fallback = e.ctx.theme.colorMap ?? 'viridis'
  const colors = typeof style.colors === 'string' ? style.colors : fallback
  return (
    <>
      <div className="field-row">
        <Select
          label="Colour map"
          value={colors}
          options={Object.entries(COLOR_MAPS).map(([value, m]) => ({
            value: value as ColorMapName,
            label: m.diverging ? `${m.label} (diverging)` : m.label,
          }))}
          onChange={(v) => e.set('colors', v === fallback ? undefined : v, 'Colour map')}
        />
        <Checkbox
          label="Reversed"
          checked={!!style.reverse}
          onChange={(v) => e.set('reverse', v || undefined, 'Reverse colours')}
        />
      </div>
      {counts && (
        <Checkbox
          label="Colour by log10 of the count"
          checked={!!style.log}
          onChange={(v) => e.set('log', v || undefined, 'Log colours')}
        />
      )}
      <Checkbox
        label="Colour bar in the legend"
        checked={layer.legend !== 'hide'}
        onChange={(v) =>
          e.ctx.set(layerPath(layer.id, 'legend'), v ? undefined : 'hide', 'Colour bar')
        }
      />
    </>
  )
}

const opacityField = (e: LayerEdit, value: number | undefined, fallback: number) => (
  <NumberInput
    label="Opacity"
    value={value ?? fallback}
    min={0}
    max={1}
    step={0.05}
    onChange={(v) => e.set('opacity', v, 'Opacity')}
  />
)

/** Roadmap 34g: hexagons — colours by count, opacity, outline. */
export function HexFields({ e }: { e: LayerEdit }) {
  if (e.layer.geom !== 'hex') return null
  const style = densityStyle(e.layer, e.key ?? '', e.ctx.theme)
  return (
    <Section title="Hexagons">
      <DensityColorFields e={e} counts />
      {opacityField(e, style.opacity, 1)}
      <StrokeFields
        label="Outline"
        value={style.border}
        palette={e.ctx.palette}
        onChange={(v) => v && e.set('border', v, 'Hexagon outline')}
      />
    </Section>
  )
}

/** Roadmap 34g: density contours — lines, bands or both, the lines and the bands' colours. */
export function ContourFields({ e }: { e: LayerEdit }) {
  if (e.layer.geom !== 'contour') return null
  const style = densityStyle(e.layer, e.key ?? '', e.ctx.theme)
  const byGroup = isBySeries(style.stroke.dash)
  return (
    <Section title="Density contours">
      <Select
        label="Draw"
        value={style.draw}
        options={[
          { value: 'lines', label: 'Lines' },
          { value: 'bands', label: 'Filled bands' },
          { value: 'both', label: 'Filled bands and lines' },
        ]}
        onChange={(v) => e.set('draw', v === 'lines' ? undefined : v, 'Contours drawn')}
      />
      {style.draw !== 'bands' && (
        <>
          <StrokeFields
            label="Lines"
            value={{ ...style.stroke, dash: byGroup ? 'solid' : (style.stroke.dash as Dash) }}
            palette={e.ctx.palette}
            allowSeries
            onChange={(v) =>
              v && e.set('stroke', byGroup ? { ...v, dash: { series: true } } : v, 'Contour lines')
            }
          />
          {/* Roadmap 49d: the lines' pattern by group (the graph's line styles in turn). */}
          <Checkbox
            label="Line style by group (the graph’s line styles in turn)"
            checked={byGroup}
            onChange={(v) =>
              e.set(
                'stroke',
                { ...style.stroke, dash: v ? { series: true } : 'solid' },
                v ? 'Line style by group' : 'Fixed line style',
              )
            }
          />
        </>
      )}
      {style.draw !== 'lines' && (
        <>
          <DensityColorFields e={e} />
          {opacityField(e, style.opacity, 1)}
          <p className="muted">
            With a text colour variable each group’s bands take its colour, at the opacity per level
            (absent: 20%).
          </p>
        </>
      )}
    </Section>
  )
}

/** Roadmap 34g: a density image — its colours and opacity. */
export function RasterFields({ e }: { e: LayerEdit }) {
  if (e.layer.geom !== 'raster') return null
  const style = densityStyle(e.layer, e.key ?? '', e.ctx.theme)
  return (
    <Section title="Density image">
      <DensityColorFields e={e} />
      {opacityField(e, style.opacity, 1)}
    </Section>
  )
}

/** Roadmap 34g: mapped points coloured by their local density (in place of a colour variable). */
export function PointDensityFields({ e }: { e: LayerEdit }) {
  const { layer, ctx } = e
  if (layer.geom !== 'points' || !layer.aes || ctx.graph.frame !== 'xy') return null
  const style = (layer.style ?? {}) as { colorBy?: string; adjust?: number }
  const on = style.colorBy === 'density'
  return (
    <Section title="Colour by density">
      <Checkbox
        label="Colour each point by the density of points around it"
        checked={on}
        onChange={(v) => e.set('colorBy', v ? 'density' : undefined, 'Colour by density')}
      />
      {on && (
        <NumberInput
          label="Bandwidth × (adjust)"
          value={style.adjust ?? 1}
          min={0.05}
          max={20}
          step={0.1}
          onChange={(v) => e.set('adjust', v === 1 ? undefined : v, 'Density bandwidth')}
        />
      )}
      {on && (
        <p className="muted">
          The points’ 2D density (MASS::kde2d on a 100 × 100 grid, as ggplot2’s) at each point, on
          the colour scale (Appearance by variable); draw them by value to put the densest on top.
        </p>
      )}
    </Section>
  )
}
