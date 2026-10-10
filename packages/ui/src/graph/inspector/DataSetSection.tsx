import type { Command } from '@ps/engine'
import {
  curveOnRight,
  identityStyle,
  resolveColor,
  rightAxisAllowed,
  seriesColor,
  seriesOnRight,
} from '@ps/graph'
import type { Layer } from '@ps/model'
import { ColorField } from '../../components/ColorPicker.tsx'
import { Section, Select } from '../../components/fields.tsx'
import { PALETTES, paletteId } from '../palettes.ts'
import type { PanelContext } from './context.ts'
import { layerPath, type SeriesItem } from './layers.ts'
import { setAxisCommands } from './yAxis.ts'

// A series' identity (decision 235): its colour, Y axis and automatic point labels, shared by
// every layer drawing it. Roadmap 46 (stage 2): its colour opens the data set's Common settings,
// its axis is under Advanced, and sharing or resetting its format is "Copy this format to…".

/** The colour a series is drawn in (its own, else the palette's by position). */
function itemColor(ctx: PanelContext, item: SeriesItem, dataSets: number): string {
  const curve = item.kind !== 'dataSet'
  const id = identityStyle(ctx.theme, ctx.graph, item.key, curve)
  const index = item.kind === 'dataSet' ? item.index : dataSets + item.index
  return seriesColor(id.color, ctx.palette, index)
}

/** The colour a series takes with no colour of its own (its Automatic): the style's for it. */
function autoItemColor(ctx: PanelContext, item: SeriesItem, dataSets: number): string {
  const { color: _, ...own } = ctx.graph.seriesOverrides[item.key] ?? {}
  const graph = { ...ctx.graph, seriesOverrides: { ...ctx.graph.seriesOverrides, [item.key]: own } }
  return itemColor({ ...ctx, graph }, item, dataSets)
}

/** A series' colour, shared by every layer drawing it. */
export function SeriesColor({
  ctx,
  item,
  dataSets,
}: {
  ctx: PanelContext
  item: SeriesItem
  /** Data sets on the graph (outputs and functions take colours after them). */
  dataSets: number
}) {
  return (
    <ColorField
      label={item.kind === 'dataSet' ? 'Data set colour' : 'Colour'}
      value={itemColor(ctx, item, dataSets)}
      palette={ctx.palette}
      automatic={{
        on: ctx.graph.seriesOverrides[item.key]?.color === undefined,
        css: autoItemColor(ctx, item, dataSets),
        onPick: () => ctx.set(['seriesOverrides', item.key, 'color'], undefined, 'Colour'),
      }}
      onChange={(_, c) => ctx.set(['seriesOverrides', item.key, 'color'], c, 'Colour')}
    />
  )
}

/** "Plot on the left / right Y axis" for a series (XY and grouped graphs). */
export function YAxisSelect({ ctx, item }: { ctx: PanelContext; item: SeriesItem }) {
  const { graph } = ctx
  if (!rightAxisAllowed(graph)) return null
  const right =
    item.kind === 'output' ? curveOnRight(graph, item.key) : seriesOnRight(graph, item.key)
  return (
    <Select
      label="Plot on"
      value={right ? 'right' : 'left'}
      options={[
        { value: 'left', label: 'Left Y axis' },
        { value: 'right', label: 'Right Y axis' },
      ]}
      onChange={(side) =>
        ctx.dispatch(
          setAxisCommands(graph, item.key, side, item.kind === 'output'),
          side === 'right' ? 'Plot on right Y axis' : 'Plot on left Y axis',
        )
      }
    />
  )
}

/**
 * A data set's format copied to every other data set (all but its colour), or put back to the
 * default; its points' own formats reset.
 */
export function CopyFormatSection({ ctx, item }: { ctx: PanelContext; item: SeriesItem }) {
  const { graph } = ctx
  if (item.kind !== 'dataSet') return null
  const key = item.key
  const pointFormats = Object.keys(graph.pointOverrides?.[key as never] ?? {}).length
  const set = (path: (string | number)[], v: unknown): Command => ({
    type: 'node.set',
    id: graph.id,
    path,
    value: v,
  })
  // This series' own formats in every layer (its entries), and its identity but colour.
  const reset = (): Command[] => [
    ...graph.layers
      .filter((l) => l.series?.[key])
      .map((l) => set(layerPath(l.id, 'series', key) as never, undefined)),
    ...(['yAxis', 'pointLabels', 'order'] as const)
      .filter((f) => graph.seriesOverrides[key]?.[f] !== undefined)
      .map((f) => set(['seriesOverrides', key, f], undefined)),
  ]
  // Its formats (but colour) as every series' in each layer.
  const share = (): Command[] =>
    graph.layers.flatMap((l: Layer): Command[] => {
      const own = l.series?.[key]?.style
      if (!own || !Object.keys(own).length) return []
      return [
        set(layerPath(l.id, 'style') as never, { ...l.style, ...own }),
        ...Object.keys(l.series ?? {}).map((k) =>
          set(layerPath(l.id, 'series', k, 'style') as never, undefined),
        ),
      ]
    })
  return (
    <Section title="Copy this format to…">
      <button type="button" onClick={() => ctx.dispatch(share(), 'Apply format to all data sets')}>
        Every data set (all but its colour)
      </button>
      <button type="button" onClick={() => ctx.dispatch(reset(), 'Reset data set format')}>
        Reset this data set to the default
      </button>
      {pointFormats > 0 && (
        <button
          type="button"
          onClick={() => ctx.set(['pointOverrides', key], undefined, 'Reset single-point formats')}
        >
          Reset {pointFormats} single-point format(s), incl. hidden points
        </button>
      )}
    </Section>
  )
}

/** Every data set's colours: the colour scheme, one colour for all, back to the scheme. */
export function ColourSchemeFields({
  ctx,
  items,
}: {
  ctx: PanelContext
  items: readonly SeriesItem[]
}) {
  const { graph, palette, set } = ctx
  const dataSets = items.filter((i) => i.kind === 'dataSet')
  const colors = dataSets.map((i) => itemColor(ctx, i, dataSets.length))
  const colorsSet =
    graph.style.seriesDefaults?.color !== undefined ||
    Object.values(graph.seriesOverrides).some((o) => o.color !== undefined)
  const whole = graph.frame === 'polar' || graph.layers.some((l) => l.stat.kind === 'fraction')
  const clearOwn = (): Command[] =>
    Object.entries(graph.seriesOverrides)
      .filter(([, o]) => o.color !== undefined)
      .map(
        ([k]): Command => ({
          type: 'node.set',
          id: graph.id,
          path: ['seriesOverrides', k, 'color'],
          value: undefined,
        }),
      )
  return (
    <>
      <Select
        label="Colours of the data sets"
        value={paletteId(graph.style.palette) ?? (graph.style.palette ? 'custom' : 'okabe-ito')}
        options={[
          ...PALETTES.map((p) => ({ value: p.id, label: p.name })),
          ...(graph.style.palette && !paletteId(graph.style.palette)
            ? [{ value: 'custom', label: 'Custom' }]
            : []),
        ]}
        onChange={(id) => {
          const p = PALETTES.find((x) => x.id === id)
          if (p)
            set(['style', 'palette'], id === 'okabe-ito' ? undefined : p.colors, 'Colour scheme')
        }}
      />
      <div className="palette-preview">
        {palette.map((c) => (
          <span key={c} style={{ background: c }} />
        ))}
      </div>
      {!whole && dataSets.length > 0 && (
        <ColorField
          label="Colour of every data set"
          value={colors[0] ?? resolveColor({ series: true }, palette)}
          mixed={colors.some((c) => c !== colors[0])}
          palette={palette}
          automatic={{
            on: !colorsSet,
            label: 'From the colour scheme',
            onPick: () =>
              ctx.dispatch(
                [
                  {
                    type: 'node.set',
                    id: graph.id,
                    path: ['style', 'seriesDefaults', 'color'],
                    value: undefined,
                  },
                  ...clearOwn(),
                ],
                'Colour scheme',
              ),
          }}
          onChange={(_, c) =>
            ctx.dispatch(
              [
                {
                  type: 'node.set',
                  id: graph.id,
                  path: ['style', 'seriesDefaults', 'color'],
                  value: c,
                },
                ...clearOwn(),
              ],
              'Colour',
            )
          }
        />
      )}
      {colorsSet && !whole && (
        <button
          type="button"
          onClick={() =>
            ctx.dispatch(
              [
                {
                  type: 'node.set',
                  id: graph.id,
                  path: ['style', 'seriesDefaults', 'color'],
                  value: undefined,
                },
                ...clearOwn(),
              ],
              'Colour scheme',
            )
          }
        >
          Colour each data set from the colour scheme
        </button>
      )}
    </>
  )
}

/** Whether every data set's own formats in a layer can be reset to the layer's. */
export const hasOwnFormats = (layer: Layer): boolean =>
  Object.values(layer.series ?? {}).some((e) => e.style)

/** Every data set's own formats in a layer put back to the layer's. */
export function ResetLayerSeries({ ctx, layer }: { ctx: PanelContext; layer: Layer }) {
  if (!hasOwnFormats(layer)) return null
  return (
    <button
      type="button"
      onClick={() =>
        ctx.dispatch(
          Object.entries(layer.series ?? {})
            .filter(([, e]) => e.style)
            .map(
              ([k]): Command => ({
                type: 'node.set',
                id: ctx.graph.id,
                path: layerPath(layer.id, 'series', k, 'style'),
                value: undefined,
              }),
            ),
          'Reset data set formats',
        )
      }
    >
      Reset every data set to this layer’s format
    </button>
  )
}
