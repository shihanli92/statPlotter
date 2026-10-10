import {
  type ColorScale,
  type DataTable,
  type GraphNode,
  levelKey,
  type NumberDisplay,
  type PointLabels,
  type RichText,
  type SymbolShape,
} from '@ps/model'
import {
  type Aesthetic,
  aesVariables,
  type ContinuousColor,
  colorTransform,
  continuousColor,
  legendValues,
  levelShape,
  type MappedVariable,
  MISSING_POINT_COLOR,
  mappedVariable,
  type Sizer,
  sizeDefaults,
  sizeScale,
  variableText,
} from '../aesthetics.ts'
import { tickFormatter } from '../format.ts'
import { type GraphContext, layoutBasics, unionBoxes } from '../layout/common.ts'
import { type LegendEntry, reversedEntries, SWATCH, swatchRect } from '../layout/legend.ts'
import { symbolPaint } from '../layout/points.ts'
import type { SceneNode, StylePath } from '../scene.ts'
import type { ResolvedSeriesStyle } from '../theme.ts'
import type { Transform } from '../transform.ts'
import { colorBar } from './geoms/tile.ts'

// A graph's variables mapped to appearance as its frame draws them (roadmap 34b): each table
// row's point colour, symbol and size (`RowLook`, applied by `pointNodes` to points standing for
// one row), the automatic labels' text, and the legend's guides — a heading per mapped variable
// with its levels (colour and shape of one variable merged), a few sizes, colour swatches or a
// colour bar. The scales are `aesthetics.ts`'.

/** Each table row's point look (absent fields: the layer's own). */
/** Most levels a legend of a mapped variable lists (roadmap 34e); the rest are counted. */
export const LEGEND_MAX_LEVELS = 50

export interface RowLook {
  color?: (row: number) => string
  shape?: (row: number) => SymbolShape | undefined
  size?: (row: number) => number | undefined
}

/** Length of a colour bar in the legend, and how far its labels stand from the bar. */
const LEGEND_BAR = 96
/** The neutral grey of shape and size samples. */
const SAMPLE_GREY = '#555555'

export interface LooksInput {
  ctx: GraphContext
  table: DataTable | undefined
  graph: GraphNode
  /** The rows shown (a slice), null for all. */
  rows: readonly number[] | null
  /** The rows drawn as points (the scales' ranges and the legend's levels are theirs). */
  drawn: readonly number[]
  palette: readonly string[]
  /** A level's colour by its key and place (its identity's, else the palette's). */
  levelColor: (key: string, index: number) => string
  /** The mapped points' symbol: the shape sequence starts from it; samples draw in it. */
  points: ResolvedSeriesStyle['points']
  /**
   * The variable whose levels the frame's data sets are (a grouped graph's colour groups): its
   * colour is theirs (no colour per row), and a shape of it is their symbol.
   */
  seriesVariable?: string
  /** Legend entries' key prefix and target (`bubble`, `['style', 'bubble']`: the bubble plot's). */
  prefix: string
  target: StylePath
  /**
   * Roadmap 34g: each table row's local density (points coloured by density): the colour is this,
   * on the colour scale, in place of a colour variable, headed "Density".
   */
  density?: Float64Array
}

/** The pseudo-variable of points coloured by their local density (roadmap 34g). */
export const DENSITY_VARIABLE = '\u0000density'

export interface GraphLooks {
  vars: Partial<Record<Aesthetic, MappedVariable>>
  /** Each row's point look; absent when nothing is mapped per row. */
  row?: RowLook
  /** The level order of the colour variable (text) and its colours. */
  colorLevels?: { order: string[]; color: (level: string) => string }
  /** A number colour variable's scale. */
  colorScale?: ContinuousColor
  /** The size variable's diameters. */
  sizer?: Sizer
  /** The symbol of a data set that is a level of the shape variable (grouped graphs). */
  seriesShape: (key: string) => SymbolShape | undefined
  /** The label variable's text of a row (numbers in `format`). */
  labelText?: (row: number, format: NumberDisplay | undefined) => RichText | null
  /** A data set's automatic labels: its own, else (with a label variable) every point's value. */
  labels: (own: PointLabels | undefined) => PointLabels | undefined
  /** Legend entries of the mapped variables, and the width their samples need. */
  guides: (sampleWidth: number) => { entries: LegendEntry[]; sampleWidth: number }
}

/** The variables a graph maps to appearance, read from its table (those it has, of a usable type). */
function variables(
  input: Pick<LooksInput, 'table' | 'graph' | 'rows' | 'density'>,
): Partial<Record<Aesthetic, MappedVariable>> {
  const { table, graph, rows } = input
  if (!table) return {}
  const keys = aesVariables(graph)
  const out: Partial<Record<Aesthetic, MappedVariable>> = {}
  for (const a of Object.keys(keys) as Aesthetic[]) {
    const v = mappedVariable(table, graph, keys[a], rows)
    if (!v) continue
    // Shapes are a text variable's levels; sizes a number variable's values.
    if ((a === 'shape' && v.type !== 'text') || (a === 'size' && v.type !== 'number')) continue
    out[a] = v
  }
  // Roadmap 34g: points coloured by their local density, as if it were a number variable.
  if (input.density)
    out.color = { key: DENSITY_VARIABLE, title: 'Density', type: 'number', values: input.density }
  return out
}

/** A graph's mapped appearance (see the module comment). */
export function graphLooks(input: LooksInput): GraphLooks {
  const { graph, palette, drawn, points } = input
  const vars = variables(input)
  const { color, shape, size, label } = vars
  const titles = graph.legend.titles ?? {}
  const seriesVar = input.seriesVariable

  // Colour: a text variable's levels on the palette (by the graph's order), a number variable on
  // its colour scale. The data sets' own variable colours them as data sets.
  const perRowColor = !!color && color.key !== seriesVar
  const colorLevels =
    color?.type === 'text'
      ? (() => {
          const order = color.order ?? []
          const at = new Map(order.map((t, k) => [t, k]))
          const cache = new Map<string, string>()
          return {
            order,
            color: (t: string) => {
              let c = cache.get(t)
              if (!c) {
                c = input.levelColor(levelKey(t), at.get(t) ?? 0)
                cache.set(t, c)
              }
              return c
            },
          }
        })()
      : undefined
  const colorScale =
    color?.type === 'number'
      ? continuousColor(
          drawn.map((r) => color.values![r]!),
          colorSpecOf(input),
        )
      : undefined
  const missing = colorSpecOf(input)?.missing ?? MISSING_POINT_COLOR
  const rowColor = perRowColor
    ? (r: number) => {
        if (colorScale) return colorScale.color(color!.values![r]!)
        const t = color!.levels![r]
        return t ? colorLevels!.color(t) : missing
      }
    : undefined

  // Shape: the level's own symbol, else the sequence from the points' own.
  const shapeOrder = shape?.order ?? []
  const shapeAt = new Map(shapeOrder.map((t, k) => [t, k]))
  const stored = graph.scales?.shape?.levels
  const shapeOf = (t: string) => levelShape(points.shape, stored, t, shapeAt.get(t) ?? 0)
  const rowShape = shape
    ? (r: number) => {
        const t = shape.levels![r]
        return t ? shapeOf(t) : undefined
      }
    : undefined

  // Size: over the drawn rows' values.
  const sizeValues = size ? drawn.map((r) => size.values![r]!).filter(Number.isFinite) : []
  const sizer = size
    ? sizeScale(sizeValues, graph.scales?.size, sizeDefaults(graph.frame))
    : undefined
  const rowSize = size
    ? (r: number) => {
        const v = size.values![r]!
        return Number.isFinite(v) ? sizer!(v) : undefined
      }
    : undefined

  const row: RowLook | undefined =
    rowColor || rowShape || rowSize
      ? {
          ...(rowColor ? { color: rowColor } : {}),
          ...(rowShape ? { shape: rowShape } : {}),
          ...(rowSize ? { size: rowSize } : {}),
        }
      : undefined

  const levelOfKey = new Map((shape?.order ?? []).map((t) => [levelKey(t), t]))
  const seriesShape = (key: string) => {
    if (!shape || shape.key !== seriesVar) return undefined
    const t = levelOfKey.get(key)
    return t === undefined ? undefined : shapeOf(t)
  }

  const labelText = label
    ? (r: number, format: NumberDisplay | undefined) => variableText(label, r, format)
    : undefined
  const labels = (own: PointLabels | undefined): PointLabels | undefined =>
    own ?? (label ? { source: 'variable', which: 'all' } : undefined)

  // --- Guides ---------------------------------------------------------------------------------
  const guides = (base: number) => {
    const { prefix, target } = input
    const out: LegendEntry[] = []
    let sampleWidth = base
    const heading = (aes: Aesthetic, fallback: string): LegendEntry[] => {
      const label = titles[aes as 'color'] ?? fallback
      return label
        ? [
            {
              key: `${prefix}/${aes}`,
              id: `legend/${prefix}/${aes}`,
              target,
              label,
              sample: () => [],
              group: `${prefix}/${aes}`,
              fixed: true,
            },
          ]
        : []
    }
    // Roadmap 47b: each guide its own group of entries (reversed unless the legend orders it).
    const ordered = (items: LegendEntry[]) => reversedEntries(graph.legend, items)
    const present = (v: MappedVariable) => {
      const used = new Set<string>()
      for (const r of drawn) {
        const t = v.levels![r]
        if (t) used.add(t)
      }
      return (v.order ?? []).filter((t) => used.has(t))
    }
    /**
     * A legend of levels lists at most `LEGEND_MAX_LEVELS` (roadmap 34e: a variable of
     * thousands of levels), then a line saying how many more there are.
     */
    const capped = (levels: string[]) => levels.slice(0, LEGEND_MAX_LEVELS)
    const more = (aes: Aesthetic, levels: string[]): LegendEntry[] =>
      levels.length > LEGEND_MAX_LEVELS
        ? [
            {
              key: `${prefix}/${aes}/more`,
              id: `legend/${prefix}/${aes}/more`,
              target,
              label: `… and ${(levels.length - LEGEND_MAX_LEVELS).toLocaleString('en-US')} more`,
              sample: () => [],
              group: `${prefix}/${aes}`,
              fixed: true,
            },
          ]
        : []

    // Sizes: a few round values, largest first, over the scale's range (fixed, else the data's).
    if (size && sizer && sizeValues.length) {
      const refs = legendValues(sizer.lo, sizer.hi, 3, true)
      const fmt = tickFormatter({ mode: 'auto' }, refs)
      sampleWidth = Math.max(sampleWidth, ...refs.map(sizer))
      const items = refs.map((v, k): LegendEntry => {
        const d = sizer(v)
        return {
          key: `${prefix}/size/${k}`,
          id: `legend/${prefix}/size/${k}`,
          target,
          group: `${prefix}/size`,
          label: fmt(v)
            .map((t) => t.text)
            .join(''),
          height: d + 4,
          sample: (x, cy) => [
            {
              id: `legend/${prefix}/size/${k}/symbol`,
              target,
              prim: {
                type: 'symbol',
                shape: points.shape,
                cx: x + sampleWidth / 2,
                cy,
                size: d,
                stroke: { color: SAMPLE_GREY, width: 0.75, dash: 'solid' },
                fill: null,
              },
            },
          ],
        }
      })
      out.push(...heading('size', size.title), ...ordered(items))
    }

    // Colour: the levels drawn (with their symbols when shape maps the same variable), a few
    // swatches of a number variable, or its colour bar.
    const merged = !!shape && !!color && shape.key === color.key
    /**
     * Roadmap 41: rows drawn in the missing colour (no level, no value, or one the scale can't
     * show) get a last entry, "Missing", in that colour.
     */
    const missingEntry = (): LegendEntry[] => {
      if (!color) return []
      const lacks = colorScale
        ? drawn.some((r) => !colorScale.shows(color.values![r]!))
        : drawn.some((r) => !color.levels![r])
      if (!lacks) return []
      const key = `${prefix}/color/missing`
      return [
        {
          key,
          id: `legend/${key}`,
          target,
          label: 'Missing',
          group: `${prefix}/color`,
          fixed: true,
          sample: (x, cy) =>
            merged
              ? [
                  symbolNode(
                    `legend/${key}`,
                    target,
                    points,
                    missing,
                    palette,
                    x + sampleWidth / 2,
                    cy,
                  ),
                ]
              : [swatch(`legend/${key}`, target, missing, x + (sampleWidth - SWATCH) / 2, cy)],
        },
      ]
    }
    if (color && perRowColor && drawn.length) {
      if (colorLevels) {
        const levels = present(color)
        const at = new Map(colorLevels.order.map((t, k) => [t, k]))
        const items = capped(levels).map((t): LegendEntry => {
          const k = at.get(t)!
          const c = colorLevels.color(t)
          // Keyed by its level (audit 3, G2): a label or hidden entry follows it when the levels
          // are reordered; its node by its place.
          const id = `legend/${prefix}/color/${k}`
          const key = `${prefix}/color/${levelKey(t)}`
          return {
            key,
            id,
            target,
            label: t,
            group: `${prefix}/color`,
            sample: (x, cy) =>
              merged
                ? [
                    symbolNode(
                      id,
                      target,
                      { ...points, shape: shapeOf(t) },
                      c,
                      palette,
                      x + sampleWidth / 2,
                      cy,
                    ),
                  ]
                : [swatch(id, target, c, x + (sampleWidth - SWATCH) / 2, cy)],
          }
        })
        out.push(
          ...heading('color', color.title),
          ...ordered(items),
          ...more('color', levels),
          ...missingEntry(),
        )
      } else if (colorScale && colorSpecOf(input)?.bar?.show === true) {
        out.push(
          ...heading('color', color.title),
          { ...barEntry(input, colorScale, `${prefix}/color/bar`), group: `${prefix}/color` },
          ...missingEntry(),
        )
      } else if (colorScale) {
        // Over the scale's range (fixed, else the values it shows), not the raw data's.
        const shows = drawn.some((r) => colorScale.shows(color.values![r]!))
        const refs = shows ? legendValues(colorScale.lo, colorScale.hi, 4) : []
        const fmt = tickFormatter({ mode: 'auto' }, refs)
        const items = refs.map((v, k): LegendEntry => {
          const key = `${prefix}/color/${k}`
          return {
            key,
            id: `legend/${key}`,
            target,
            group: `${prefix}/color`,
            label: fmt(v)
              .map((t) => t.text)
              .join(''),
            sample: (x, cy) => [
              swatch(
                `legend/${key}`,
                target,
                colorScale.color(v),
                x + (sampleWidth - SWATCH) / 2,
                cy,
              ),
            ],
          }
        })
        out.push(...heading('color', color.title), ...ordered(items), ...missingEntry())
      }
    }

    // Shape: the levels drawn, each its symbol in grey (merged into the colour legend above, or
    // into the data sets' legend when they are its levels).
    if (shape && !merged && shape.key !== seriesVar && drawn.length) {
      const levels = present(shape)
      const items = capped(levels).map((t): LegendEntry => {
        const k = shapeAt.get(t)!
        // Keyed by its level (audit 3, G2), its node by its place.
        const id = `legend/${prefix}/shape/${k}`
        const key = `${prefix}/shape/${levelKey(t)}`
        return {
          key,
          id,
          target,
          label: t,
          group: `${prefix}/shape`,
          sample: (x, cy) => [
            symbolNode(
              id,
              target,
              { ...points, shape: shapeOf(t) },
              SAMPLE_GREY,
              palette,
              x + sampleWidth / 2,
              cy,
            ),
          ],
        }
      })
      out.push(...heading('shape', shape.title), ...ordered(items), ...more('shape', levels))
    }
    return { entries: out, sampleWidth }
  }

  return {
    vars,
    ...(row ? { row } : {}),
    ...(colorLevels ? { colorLevels } : {}),
    ...(colorScale ? { colorScale } : {}),
    ...(sizer ? { sizer } : {}),
    seriesShape,
    ...(labelText ? { labelText } : {}),
    labels,
    guides,
  }
}

/** A colour swatch with its left edge at x. */
const swatch = (
  id: string,
  target: StylePath,
  color: string,
  x: number,
  cy: number,
): SceneNode => ({
  id: `${id}/swatch`,
  target,
  prim: { type: 'rect', ...swatchRect(x, cy), stroke: null, fill: { color, opacity: 1 } },
})

/** A point symbol centred on (cx, cy) in a colour. */
function symbolNode(
  id: string,
  target: StylePath,
  points: ResolvedSeriesStyle['points'],
  color: string,
  palette: readonly string[],
  cx: number,
  cy: number,
): SceneNode {
  const size = Math.min(points.size, 12)
  return {
    id: `${id}/symbol`,
    target,
    prim: {
      type: 'symbol',
      shape: points.shape,
      cx,
      cy,
      size,
      ...symbolPaint(points, palette, color),
    },
  }
}

/**
 * The colour scale of the colour variable: the graph's; points coloured by their density (roadmap
 * 34g) default to viridis with a colour bar.
 */
function colorSpecOf(input: Pick<LooksInput, 'ctx' | 'graph' | 'density'>): ColorScale | undefined {
  const s = input.graph.scales?.color
  if (!input.density) return s
  return {
    colors: layoutBasics(input.ctx).theme.colorMap ?? 'viridis',
    ...s,
    bar: { show: true, ...s?.bar },
  }
}

/** A legend entry drawing a number colour variable's colour bar (upright, high at the top). */
function barEntry(input: LooksInput, scale: ContinuousColor, key: string): LegendEntry {
  const { ctx, palette, target } = input
  const bar = colorSpecOf(input)?.bar ?? {}
  const transform = colorTransform(colorSpecOf(input))
  return colorBarEntry({
    ctx,
    palette,
    target,
    key,
    scale,
    ...(bar.ticks ? { ticks: bar.ticks } : {}),
    ...(bar.format ? { format: bar.format } : {}),
    ...(transform.kind !== 'linear' ? { transform } : {}),
  })
}

/**
 * A legend entry drawing a colour bar (upright, high at the top): a number variable's colours
 * (roadmap 34b), a density layer's (roadmap 34g: counts, densities, maybe on a log scale).
 */
export function colorBarEntry(o: {
  ctx: GraphContext
  palette: readonly string[]
  target: StylePath
  key: string
  scale: Pick<ContinuousColor, 'lo' | 'hi' | 'color'>
  ticks?: number
  format?: NumberDisplay
  transform?: Transform
  integer?: boolean
  /** Roadmap 47b: the group of entries it heads (a variable's, a density layer's). */
  group?: string
}): LegendEntry {
  const { ctx, palette, target, key, scale } = o
  const draw = (x: number, y: number) =>
    colorBar(ctx, palette, scale, {
      position: 'right',
      title: '',
      at: { x, y },
      W: LEGEND_BAR,
      H: LEGEND_BAR,
      target: [...target],
      id: `legend/${key}`,
      ...(o.ticks ? { ticks: o.ticks } : {}),
      ...(o.format ? { format: o.format } : {}),
      ...(o.transform ? { transform: o.transform } : {}),
      ...(o.integer ? { integer: true } : {}),
    })
  const box = unionBoxes(draw(0, 0).map((n) => n.bbox ?? null)) ?? { x: 0, y: 0, w: 0, h: 0 }
  return {
    key,
    id: `legend/${key}`,
    target,
    label: '',
    height: LEGEND_BAR + 8,
    width: box.x + box.w,
    sample: (x, cy) => draw(x, cy - LEGEND_BAR / 2),
    // Roadmap 47b: a bar is no entry to move or relabel.
    fixed: true,
    ...(o.group ? { group: o.group } : {}),
  }
}
