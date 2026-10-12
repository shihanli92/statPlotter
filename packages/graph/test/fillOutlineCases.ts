import type { DataTable, GraphNode, Layer, NodeId } from '@ps/model'
import { presetGraph } from '../src/index.ts'
import { xyThree } from './byGroupCases.ts'
import { builtGraph } from './goldenCases.ts'
import { graphOf, withLayer } from './graphs.ts'
import { appearanceTable, sampleTable } from './helpers.ts'

// Roadmap 49d: fill and outline mapped separately, as ggplot's `fill =` beside `colour =` — a
// data set's fill colour beside its colour, the graph's fill palette, a fill variable on its own
// scale (one legend when it maps the colour's variable, two when not) and line patterns by group
// for the overlay geoms. New files only: no golden before 49d changes.

const BLACK = { color: { rgb: '#000000' }, width: 1, dash: 'solid' } as const
const BY = { series: true } as const
/** Light fills: the Okabe–Ito colours mixed half with white. */
export const LIGHT = ['#80b9d9', '#eaaf80', '#80cfb9', '#e6bcd3']

const legend = (g: GraphNode): Partial<GraphNode> => ({ legend: { ...g.legend, show: true } })

/** An XY graph of `appearanceTable`'s Score × Age points mapping `aes`, legend shown. */
export function mappedXY(aes: NonNullable<Layer['aes']>, more: Partial<GraphNode> = {}) {
  const t = appearanceTable()
  const g = presetGraph(t, 'bubble')
  const layers = g.layers.map((l) =>
    l.aes
      ? ({
          ...l,
          aes: { x: 'c', y: 'd', ...aes },
          style: {
            size: 9,
            fill: { type: 'solid', color: BY, opacity: 1 },
            border: { color: BY, width: 1.5, dash: 'solid' },
          },
        } as Layer)
      : l,
  )
  const graph: GraphNode = {
    ...g,
    id: 'g1' as NodeId,
    layers,
    legend: { ...g.legend, show: true },
    ...more,
  }
  return { table: t, graph }
}

/** The goldens of roadmap 49d. */
export function fillOutlineCases(): [name: string, table: DataTable, graph: GraphNode][] {
  const column = sampleTable('column')
  const xy = xyThree()
  const pointsXY = builtGraph(xy, 'xy', ['points'])
  const split = mappedXY({ color: 'a', fill: 'f' })
  const merged = mappedXY({ color: 'a', fill: 'a' }, { style: { fillPalette: LIGHT } })
  const number = mappedXY(
    { color: 'f', fill: 'e' },
    { scales: { fill: { colors: 'viridis', bar: { show: true } } } },
  )
  const ellipses = mappedXY({ color: 'a' })
  return [
    // ggplot's aes(fill = group) + colour = 'black' with fills of their own: light fills from
    // the graph's fill palette, black outlines; the legend's symbols the same.
    [
      'filloutline-fill-palette-black-outline',
      column,
      withLayer(
        graphOf(column, 'points', (g) => ({
          ...legend(g),
          style: { ...g.style, fillPalette: LIGHT },
        })),
        'points',
        { style: { fill: { type: 'solid', color: BY, opacity: 1 }, border: BLACK } },
      ),
    ],
    // Fill and outline each by data set, each its own colours: light fills, dark outlines (the
    // fill palette), one data set's fill its own (grey) — bars and their legend.
    [
      'filloutline-light-fill-dark-outline-bars',
      column,
      (() => {
        const g = withLayer(
          graphOf(column, 'bars', (g) => ({
            ...legend(g),
            style: { ...g.style, fillPalette: LIGHT },
          })),
          'bars',
          {
            style: {
              fill: { type: 'solid', color: BY, opacity: 1 },
              border: { color: BY, width: 1.5, dash: 'solid' },
            },
          },
        )
        const third = Object.keys(g.seriesOverrides)[2] ?? column.dataSets[2]!.id
        return {
          ...g,
          seriesOverrides: {
            ...g.seriesOverrides,
            [third]: { ...g.seriesOverrides[third], fill: { rgb: '#d9d9d9' } },
          },
        }
      })(),
    ],
    // XY data sets' points: each data set's fill colour beside its colour (the palette's).
    [
      'filloutline-xy-own-fills',
      xy,
      withLayer(
        {
          ...pointsXY,
          legend: { ...pointsXY.legend, show: true },
          seriesOverrides: Object.fromEntries(
            xy.dataSets.map((d, i) => [d.id, { fill: { rgb: LIGHT[i]! } }]),
          ),
        },
        'points',
        {
          style: {
            size: 8,
            fill: { type: 'solid', color: BY, opacity: 1 },
            border: { color: BY, width: 1.5, dash: 'solid' },
          },
        },
      ),
    ],
    // Fill and outline by different variables: outlines by Group, fills by Site — two legends.
    ['filloutline-variables-split-legends', split.table, split.graph],
    // Fill and outline by the same variable, the fills light: one legend, keys showing both.
    ['filloutline-variables-merged-legend', merged.table, merged.graph],
    // Fill by a number variable (a colour bar), outline by a text variable.
    ['filloutline-variables-fill-number', number.table, number.graph],
    // Ellipses by group with their outlines dashed by group (the graph's line styles in turn).
    [
      'filloutline-ellipses-dashed-by-group',
      ellipses.table,
      {
        ...ellipses.graph,
        layers: [
          {
            id: 'ellipse',
            geom: 'polygon',
            stat: { kind: 'ellipse', type: 'norm', level: 0.95 },
            style: {
              draw: 'both',
              fill: { type: 'solid', color: BY, opacity: 0.15 },
              border: { color: BY, width: 1.25, dash: BY },
            },
          } as Layer,
          ...ellipses.graph.layers,
        ],
      },
    ],
    // XY data sets' paths dashed by data set (overlay paths' resolver), legend samples too.
    [
      'filloutline-paths-dashed-by-data-set',
      xy,
      {
        ...pointsXY,
        legend: { ...pointsXY.legend, show: true },
        layers: [
          ...pointsXY.layers,
          {
            id: 'path',
            geom: 'path',
            stat: { kind: 'identity' },
            style: { stroke: { color: BY, width: 1.5, dash: BY } },
          } as Layer,
        ],
      },
    ],
  ]
}
