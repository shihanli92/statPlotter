import type { Command } from '@ps/engine'
import {
  type Aesthetic,
  aesVariables,
  graphDashes,
  graphShapes,
  identityStyle,
  layerStyle,
  mappedPointsLayer,
  overlayStyle,
  seriesColor,
  seriesPlaces,
} from '@ps/graph'
import {
  type ColorRef,
  type Dash,
  type FillStyle,
  isBySeries,
  type Layer,
  type StrokeStyle,
  type SymbolShape,
  statOf,
  styleSections,
} from '@ps/model'
import type { ReactNode } from 'react'
import { NumberInput, Section, Select } from '../../components/fields.tsx'
import { ColorRefField, DASHES, SHAPES } from '../../components/formatFields.tsx'
import { variableCommands, variableOptions } from './AppearanceByVariable.tsx'
import type { PanelContext } from './context.ts'
import type { LayerEdit } from './LayerFields.tsx'
import { layerPath, styleCommands } from './layers.ts'

// Roadmap 49a: a layer's appearance as a table, aesthetic by aesthetic, each by data set (the
// group's colour, the graph's shapes or line patterns in turn), fixed (one value for every data
// set) or by variable (a multiple-variables table's mappings) — ggplot's `aes(fill = group)`
// beside `geom_point(colour = 'black')`. Rows only for what the layer's geom draws; a data set's
// own format (set by hand) still wins over the layer's, counted under its rows with a Reset.
// Three recipes above it set fill and outline in one step.

/** How an aesthetic is given. */
export type Mode = 'series' | 'fixed' | 'none' | 'variable'

export const MODE_LABELS: Readonly<Record<Mode, string>> = {
  series: 'By data set',
  fixed: 'Fixed',
  none: 'None',
  variable: 'By variable',
}

/** The kinds of row: an aesthetic of a mark. */
export type RowKind =
  | 'fill'
  | 'opacity'
  | 'outline'
  | 'outlineWidth'
  | 'line'
  | 'lineWidth'
  | 'dash'
  | 'shape'
  | 'size'

/** One row of the table: an aesthetic, the style field it is stored in, its modes. */
export interface AppearanceRow {
  kind: RowKind
  /** The layer style field (fill, border, stroke, line, shape, outlierShape, size). */
  field: string
  /** Its name in the table (the mode's label). */
  label: string
  /** The modes offered (one: no mode control). */
  modes: readonly Mode[]
  /** Roadmap 34b's mapping it can take (By variable). */
  aes?: Aesthetic
}

/** Shapes as glyphs (the cycle's preview). */
export const SHAPE_GLYPHS: Readonly<Record<SymbolShape, string>> = {
  circle: '●',
  square: '■',
  triangle: '▲',
  diamond: '◆',
  plus: '+',
  cross: '✕',
}
const DASH_GLYPHS: Readonly<Record<Dash, string>> = { solid: '——', dash: '– –', dot: '···' }

/** Whether a layer's points map variables (multiple variables): XY `aes`, else the mapping. */
function mapsVariables(
  graph: PanelContext['graph'],
  layer: Layer,
): { xy: boolean; mapped: boolean } {
  const xy = graph.frame === 'xy' && mappedPointsLayer(graph)?.id === layer.id
  const mapped =
    !xy &&
    !!graph.mapping &&
    (graph.frame === 'category' || graph.frame === 'grouped') &&
    layer.geom === 'points' &&
    layer.stat.kind === 'identity'
  return { xy, mapped }
}

const FILL_OUTLINE = (
  fillModes: readonly Mode[],
  outlineModes: readonly Mode[],
  fill = 'fill',
  border = 'border',
): AppearanceRow[] => [
  { kind: 'fill', field: fill, label: 'Fill', modes: fillModes },
  { kind: 'opacity', field: fill, label: 'Fill opacity', modes: ['fixed'] },
  { kind: 'outline', field: border, label: 'Outline', modes: outlineModes },
  { kind: 'outlineWidth', field: border, label: 'Outline width (pt)', modes: ['fixed'] },
]

const LINE = (field: string, colorModes: readonly Mode[], dashModes: readonly Mode[]) => [
  { kind: 'line' as const, field, label: 'Line', modes: colorModes },
  { kind: 'lineWidth' as const, field, label: 'Line width (pt)', modes: ['fixed'] as const },
  { kind: 'dash' as const, field, label: 'Line style', modes: dashModes },
]

const BY: readonly Mode[] = ['series', 'fixed', 'none']
const BY_NO_NONE: readonly Mode[] = ['series', 'fixed']
const FIXED: readonly Mode[] = ['fixed']

/**
 * The rows of a layer's table: the aesthetics its geom draws (none: the layer keeps its own
 * sections — densities, heat maps, slices, labels, the grand mean, estimation plots, censored
 * ticks, dot plots and Significance classes, whose colours are their statistics' or one line's).
 */
export function appearanceRows(graph: PanelContext['graph'], layer: Layer): AppearanceRow[] {
  const stat = layer.stat.kind
  switch (layer.geom) {
    case 'points': {
      if (stat === 'dotplot' || stat === 'threshold') return []
      const { xy, mapped } = mapsVariables(graph, layer)
      // A graph of variables' XY points: colours by the colour variable, no data sets to cycle.
      const color: readonly Mode[] = xy ? ['variable', 'fixed', 'none'] : BY
      return [
        ...FILL_OUTLINE(color, color),
        {
          kind: 'shape',
          field: 'shape',
          label: 'Shape',
          modes: xy ? ['fixed', 'variable'] : mapped ? ['series', 'fixed', 'variable'] : BY_NO_NONE,
          ...(xy || mapped ? { aes: 'shape' as const } : {}),
        },
        {
          kind: 'size',
          field: 'size',
          label: 'Size',
          modes: xy || mapped ? ['fixed', 'variable'] : FIXED,
          ...(xy || mapped ? { aes: 'size' as const } : {}),
        },
      ]
    }
    case 'bar':
      // Slices and 100% bars take a colour per category (their own section).
      return stat === 'fraction' ? [] : FILL_OUTLINE(BY, BY)
    case 'box':
      return [
        ...FILL_OUTLINE(BY, BY),
        { kind: 'shape', field: 'outlierShape', label: 'Outlier shape', modes: BY_NO_NONE },
      ]
    case 'violin':
      return FILL_OUTLINE(BY, BY)
    case 'polygon':
      // Whether fill or outline is drawn is the layer's Draw.
      return [...FILL_OUTLINE(BY_NO_NONE, BY_NO_NONE), ...LINE('border', [], FIXED).slice(2)]
    case 'errorbar':
    case 'center':
      return LINE('line', BY_NO_NONE, BY_NO_NONE)
    case 'line':
    case 'step':
      return LINE('stroke', BY_NO_NONE, BY_NO_NONE)
    case 'connector':
      // Lines between data sets: one colour.
      return LINE('line', FIXED, FIXED)
    case 'path':
    case 'segment':
      return LINE('stroke', BY_NO_NONE, FIXED)
    default:
      return []
  }
}

/** Whether a layer's style is resolved by the overlay geoms' own resolver (34c). */
const overlay = (l: Layer) => l.geom === 'polygon' || l.geom === 'path' || l.geom === 'segment'

/** A field as drawn for a data set, before any by-data-set value is resolved. */
function rawField(e: LayerEdit, key: string, field: string): unknown {
  const { layer, ctx } = e
  const own = (layer.series?.[key]?.style as Record<string, unknown> | undefined)?.[field]
  if (own !== undefined) return own
  const mine = (layer.style as Record<string, unknown> | undefined)?.[field]
  if (mine !== undefined) return mine
  // Neither set: the defaults, which are never by data set.
  if (overlay(layer))
    return (overlayStyle(layer as never, key, ctx.theme) as Record<string, unknown>)[field]
  const at = styleSections(layer)[field]
  if (!at) return undefined
  const s = layerStyle(ctx.theme, ctx.graph, layer, key, statOf(layer, key))
  return (s[at[0]] as unknown as Record<string, unknown>)[at[1]]
}

/** The layer's own value of a field (the base its edits change), else its first data set's. */
function layerField(e: LayerEdit, field: string): unknown {
  if (e.key !== null) return rawField(e, e.key, field)
  const mine = (e.layer.style as Record<string, unknown> | undefined)?.[field]
  return mine ?? rawField(e, e.items[0]?.key ?? '', field)
}

/** The keys the table formats: one data set (or several, roadmap 49b), or every one drawn. */
const keysOf = (e: LayerEdit): string[] =>
  e.keys ? [...e.keys] : e.items.length ? e.items.map((i) => i.key) : ['']

/**
 * Commands writing style fields: the layer's (data sets' own formats kept), or the data sets'
 * formatted (one, or several selected together: each one's own).
 */
export function writeCommands(e: LayerEdit, changes: readonly [string, unknown][]): Command[] {
  const { ctx, layer } = e
  if (e.keys) return e.keys.flatMap((k) => styleCommands(ctx.graph, layer, k, changes))
  return changes.map(([field, value]) => ({
    type: 'node.set' as const,
    id: ctx.graph.id,
    path: layerPath(layer.id, 'style', field),
    value,
  }))
}

/** Data sets with their own value of a field in the layer (set by hand). */
export function handSet(e: Pick<LayerEdit, 'layer' | 'items' | 'key'>, field: string): string[] {
  if (e.key !== null) return []
  const drawn = new Set(e.items.map((i) => i.key))
  return Object.entries(e.layer.series ?? {})
    .filter(([k, s]) => drawn.has(k) && s.style && Object.hasOwn(s.style, field))
    .map(([k]) => k)
}

/** A colour reference's mode. */
const colorMode = (c: ColorRef | undefined, xy: boolean): Mode =>
  c && isBySeries(c) ? (xy ? 'variable' : 'series') : 'fixed'

/** The mode of a row for one data set's value. */
function modeOf(
  row: AppearanceRow,
  value: unknown,
  vars: Partial<Record<Aesthetic, string>>,
  xy: boolean,
): Mode {
  switch (row.kind) {
    case 'fill': {
      const f = value as FillStyle | undefined
      return !f || f.type === 'none' ? 'none' : colorMode(f.color, xy)
    }
    case 'outline': {
      const s = value as StrokeStyle | undefined
      return !s || s.width === 0 ? 'none' : colorMode(s.color, xy)
    }
    case 'line':
      return colorMode((value as StrokeStyle | undefined)?.color, false)
    case 'dash':
      return isBySeries((value as { dash?: unknown } | undefined)?.dash) ? 'series' : 'fixed'
    case 'shape':
      if (row.aes && vars.shape !== undefined) return 'variable'
      return isBySeries(value) ? 'series' : 'fixed'
    case 'size':
      return row.aes && vars.size !== undefined ? 'variable' : 'fixed'
    default:
      return 'fixed'
  }
}

/** Whether values differ (compared as data). */
const differ = (values: readonly unknown[]) =>
  values.some((v) => JSON.stringify(v) !== JSON.stringify(values[0]))

/** The width a line gets when it is switched back on. */
const DEFAULT_OUTLINE: Partial<Record<Layer['geom'], number>> = { points: 0.75 }
const outlineWidth = (layer: Layer, s: StrokeStyle | undefined) =>
  s && s.width > 0 ? s.width : (DEFAULT_OUTLINE[layer.geom] ?? 1)

const BLACK: ColorRef = { rgb: '#000000' }
const WHITE: ColorRef = { rgb: '#ffffff' }

/** The recipes above the table: fill and outline set in one step. */
export const RECIPES = [
  { id: 'filledBlack', label: 'Filled by group, black outline' },
  { id: 'outlinedWhite', label: 'Outlined by group, white fill' },
  { id: 'solid', label: 'Solid by group' },
] as const
export type RecipeId = (typeof RECIPES)[number]['id']

/** A recipe's fill and border for a layer (its outline width and fill opacity kept). */
export function recipeChanges(e: LayerEdit, id: RecipeId): [string, unknown][] {
  const fill = layerField(e, 'fill') as FillStyle | undefined
  const border = layerField(e, 'border') as StrokeStyle | undefined
  const width = outlineWidth(e.layer, border)
  const opacity = fill?.type === 'solid' ? fill.opacity : 1
  const line = (color: ColorRef): StrokeStyle => ({ color, width, dash: border?.dash ?? 'solid' })
  const series: ColorRef = { series: true }
  switch (id) {
    case 'filledBlack':
      return [
        ['fill', { type: 'solid', color: series, opacity }],
        ['border', line(BLACK)],
      ]
    case 'outlinedWhite':
      return [
        ['fill', { type: 'solid', color: WHITE, opacity: 1 }],
        ['border', line(series)],
      ]
    case 'solid':
      return [
        ['fill', { type: 'solid', color: series, opacity: 1 }],
        ['border', line(series)],
      ]
  }
}

/** The geoms the recipes apply to (a fill and an outline). */
const RECIPE_GEOMS: ReadonlySet<Layer['geom']> = new Set(['points', 'bar', 'box', 'violin'])

/**
 * Roadmap 49a: a layer's Appearance — recipes, then a row per aesthetic its geom draws. `only`:
 * just those kinds (the line's width and style in Common); `omit`: those shown elsewhere.
 */
export function AppearanceSection({
  e,
  only,
  omit = [],
  bare = false,
}: {
  e: LayerEdit
  only?: readonly RowKind[]
  omit?: readonly RowKind[]
  /** Rows alone, without the section and recipes (Common's line width and style). */
  bare?: boolean
}) {
  const { ctx, layer } = e
  const rows = appearanceRows(ctx.graph, layer).filter(
    (r) => (!only || only.includes(r.kind)) && !omit.includes(r.kind),
  )
  if (!rows.length) return null
  const body = <AppearanceRows e={e} rows={rows} />
  if (bare) return body
  const kinds = new Set(rows.map((r) => r.kind))
  const recipes =
    RECIPE_GEOMS.has(layer.geom) &&
    kinds.has('fill') &&
    kinds.has('outline') &&
    !mapsVariables(ctx.graph, layer).xy
  return (
    <Section title="Appearance">
      {recipes && (
        <fieldset className="field appearance-recipes">
          <legend>Recipes</legend>
          {RECIPES.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => ctx.dispatch(writeCommands(e, recipeChanges(e, r.id)), r.label)}
            >
              {r.label}
            </button>
          ))}
        </fieldset>
      )}
      {body}
    </Section>
  )
}

/** The table's rows, with the count of data sets set by hand under each field's first row. */
function AppearanceRows({ e, rows }: { e: LayerEdit; rows: readonly AppearanceRow[] }) {
  const noted = new Set<string>()
  return (
    <div className="appearance-table">
      {rows.map((row) => {
        const first = !noted.has(row.field)
        noted.add(row.field)
        const own = first ? handSet(e, row.field) : []
        return (
          <div key={`${row.kind}:${row.field}`} className="appearance-item">
            <RowFields e={e} row={row} />
            {own.length > 0 && <HandSet e={e} row={row} keys={own} />}
          </div>
        )
      })}
    </div>
  )
}

/** "2 data sets set by hand · Reset": their own values of the field cleared, one step. */
function HandSet({ e, row, keys }: { e: LayerEdit; row: AppearanceRow; keys: readonly string[] }) {
  const { ctx, layer } = e
  const what = row.kind === 'outline' || row.kind === 'outlineWidth' ? 'outline' : row.label
  return (
    <p className="muted appearance-note">
      {keys.length === 1 ? '1 data set' : `${keys.length} data sets`} set by hand ·{' '}
      <button
        type="button"
        className="link"
        aria-label={`Reset ${what.toLowerCase()} of data sets set by hand`}
        onClick={() =>
          ctx.dispatch(
            keys.flatMap((k) => styleCommands(ctx.graph, layer, k, [[row.field, undefined]])),
            `Reset data sets’ ${what.toLowerCase()}`,
          )
        }
      >
        Reset
      </button>
    </p>
  )
}

/** One row: its mode and the value editor of that mode. */
function RowFields({ e, row }: { e: LayerEdit; row: AppearanceRow }) {
  const { ctx, layer } = e
  const { graph } = ctx
  const keys = keysOf(e)
  const values = keys.map((k) => rawField(e, k, row.field))
  const vars = row.aes || row.kind === 'fill' || row.kind === 'outline' ? aesVariables(graph) : {}
  const { xy } = mapsVariables(graph, layer)
  const modes = values.map((v) => modeOf(row, v, vars, xy))
  const mode = modes[0]!
  const mixedMode = differ(modes)
  const set = (changes: [string, unknown][], label: string, more: Command[] = []) =>
    ctx.dispatch([...more, ...writeCommands(e, changes)], label)
  const base = layerField(e, row.field)
  const label = `${row.label}`
  const modeSelect = (onMode: (m: Mode) => void) =>
    row.modes.length > 1 ? (
      <Select<Mode>
        label={label}
        value={row.modes.includes(mode) ? mode : row.modes[0]!}
        mixed={mixedMode}
        options={row.modes.map((m) => ({ value: m, label: MODE_LABELS[m] }))}
        onChange={onMode}
      />
    ) : (
      <div className="field">
        <span className="appearance-label">{label}</span>
        <span className="muted">{MODE_LABELS[row.modes[0]!]}</span>
      </div>
    )
  const place = (k: string) => seriesPlaces(ctx.project, graph, ctx.lookup).get(k) ?? 0
  const dataSetCss = (k: string) =>
    seriesColor(
      identityStyle(
        ctx.theme,
        graph,
        k,
        e.items.find((i) => i.key === k)?.kind !== undefined &&
          e.items.find((i) => i.key === k)?.kind !== 'dataSet',
      ).color,
      ctx.palette,
      place(k),
    )
  switch (row.kind) {
    case 'fill': {
      const fill = base as FillStyle | undefined
      const opacity = fill?.type === 'solid' ? fill.opacity : 1
      const firstColor =
        (values[0] as FillStyle | undefined)?.type === 'solid'
          ? (values[0] as Extract<FillStyle, { type: 'solid' }>).color
          : undefined
      const solid = (color: ColorRef): FillStyle => ({ type: 'solid', color, opacity })
      const onMode = (m: Mode) => {
        if (m === 'none') return set([[row.field, { type: 'none' }]], 'No fill')
        if (m === 'fixed')
          return set(
            [[row.field, solid(firstColor && !isBySeries(firstColor) ? firstColor : WHITE)]],
            'Fixed fill',
          )
        const map = m === 'variable' && vars.color === undefined ? firstVariable(ctx, 'color') : []
        return set([[row.field, solid({ series: true })]], 'Fill by data set', map)
      }
      return (
        <div className="field-row appearance-row">
          {modeSelect(onMode)}
          {mode !== 'none' || mixedMode ? (
            <ColorRefField
              label="Fill colour"
              value={firstColor}
              palette={ctx.palette}
              fallback={dataSetCss(keys[0]!)}
              allowSeries={row.modes.includes('series') || row.modes.includes('variable')}
              mixed={differ(
                values.map((v) =>
                  (v as FillStyle | undefined)?.type === 'solid'
                    ? (v as { color: ColorRef }).color
                    : null,
                ),
              )}
              onChange={(c) => set([[row.field, solid(c)]], 'Fill colour')}
            />
          ) : (
            <span />
          )}
        </div>
      )
    }
    case 'opacity': {
      const solidValues = values.filter(
        (v) => (v as FillStyle | undefined)?.type === 'solid',
      ) as Extract<FillStyle, { type: 'solid' }>[]
      if (!solidValues.length) return null
      const fill =
        (base as FillStyle | undefined)?.type === 'solid'
          ? (base as Extract<FillStyle, { type: 'solid' }>)
          : solidValues[0]!
      return (
        <div className="field-row appearance-row">
          <NumberInput
            label="Fill opacity"
            value={solidValues[0]!.opacity}
            mixed={differ(solidValues.map((f) => f.opacity))}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => set([[row.field, { ...fill, opacity: v }]], 'Fill opacity')}
          />
        </div>
      )
    }
    case 'outline':
    case 'line': {
      const stroke = base as StrokeStyle | undefined
      const first = values[0] as StrokeStyle | undefined
      const width = outlineWidth(layer, stroke)
      const line = (patch: Partial<StrokeStyle>): StrokeStyle => ({
        color: stroke?.color ?? BLACK,
        width: stroke?.width ?? width,
        dash: stroke?.dash ?? 'solid',
        ...patch,
      })
      const outline = row.kind === 'outline'
      const onMode = (m: Mode) => {
        if (m === 'none') return set([[row.field, line({ width: 0 })]], 'No outline')
        const w = outline ? { width } : {}
        if (m === 'fixed')
          return set(
            [
              [
                row.field,
                line({
                  ...w,
                  color: first?.color && !isBySeries(first.color) ? first.color : BLACK,
                }),
              ],
            ],
            outline ? 'Fixed outline' : 'Fixed line colour',
          )
        const map = m === 'variable' && vars.color === undefined ? firstVariable(ctx, 'color') : []
        return set(
          [[row.field, line({ ...w, color: { series: true } })]],
          outline ? 'Outline by data set' : 'Line colour by data set',
          map,
        )
      }
      const name = outline ? 'Outline colour' : 'Line colour'
      return (
        <div className="field-row appearance-row">
          {modeSelect(onMode)}
          {mode !== 'none' || mixedMode ? (
            <ColorRefField
              label={name}
              value={first?.color}
              palette={ctx.palette}
              fallback={dataSetCss(keys[0]!)}
              allowSeries={row.modes.includes('series') || row.modes.includes('variable')}
              mixed={differ(values.map((v) => (v as StrokeStyle | undefined)?.color))}
              onChange={(c) =>
                set([[row.field, line({ color: c, ...(outline ? { width } : {}) })]], name)
              }
            />
          ) : (
            <span />
          )}
        </div>
      )
    }
    case 'outlineWidth':
    case 'lineWidth': {
      const strokes = values as (StrokeStyle | undefined)[]
      if (row.kind === 'outlineWidth' && strokes.every((s) => !s || s.width === 0)) return null
      const stroke = base as StrokeStyle | undefined
      return (
        <div className="field-row appearance-row">
          <NumberInput
            label={row.label}
            value={strokes[0]?.width ?? 1}
            mixed={differ(strokes.map((s) => s?.width))}
            min={row.kind === 'outlineWidth' ? 0.25 : 0}
            max={10}
            step={0.25}
            onChange={(width) =>
              set(
                [
                  [
                    row.field,
                    {
                      color: stroke?.color ?? BLACK,
                      dash: stroke?.dash ?? 'solid',
                      ...stroke,
                      width,
                    },
                  ],
                ],
                row.kind === 'outlineWidth' ? 'Outline width' : 'Line width',
              )
            }
          />
        </div>
      )
    }
    case 'dash': {
      const stroke = base as StrokeStyle | undefined
      const first = values[0] as StrokeStyle | undefined
      const withDash = (dash: unknown) => ({
        color: stroke?.color ?? BLACK,
        width: stroke?.width ?? 1,
        ...stroke,
        dash,
      })
      const fixedDash = (first?.dash && !isBySeries(first.dash) ? first.dash : 'solid') as Dash
      const onMode = (m: Mode) =>
        set(
          [[row.field, withDash(m === 'series' ? { series: true } : fixedDash)]],
          m === 'series' ? 'Line style by data set' : 'Fixed line style',
        )
      return (
        <div className="field-row appearance-row">
          {row.modes.length > 1 ? (
            modeSelect(onMode)
          ) : (
            <Select<Dash>
              label="Line style"
              value={fixedDash}
              mixed={differ(values.map((v) => (v as StrokeStyle | undefined)?.dash))}
              options={DASHES}
              onChange={(d) => set([[row.field, withDash(d)]], 'Line style')}
            />
          )}
          {row.modes.length > 1 &&
            !mixedMode &&
            (mode === 'series' ? (
              <CyclePreview ctx={ctx} which="dashes" />
            ) : (
              <Select<Dash>
                label="Fixed line style"
                value={fixedDash}
                mixed={differ(values.map((v) => (v as StrokeStyle | undefined)?.dash))}
                options={DASHES}
                onChange={(d) => set([[row.field, withDash(d)]], 'Line style')}
              />
            ))}
        </div>
      )
    }
    case 'shape': {
      const fixed = (values.find((v) => typeof v === 'string') ??
        layerStyle(ctx.theme, graph, layer, keys[0]!, statOf(layer, keys[0]!)).points
          .shape) as SymbolShape
      const onMode = (m: Mode) => {
        const unmap =
          mode === 'variable' && m !== 'variable' ? variableCommands(ctx, 'shape', '') : []
        if (m === 'variable') return ctx.dispatch(firstVariable(ctx, 'shape'), 'Shape by variable')
        set(
          [[row.field, m === 'series' ? { series: true } : fixed]],
          m === 'series' ? 'Shape by data set' : 'Fixed shape',
          unmap,
        )
      }
      return (
        <div className="field-row appearance-row">
          {modeSelect(onMode)}
          {!mixedMode &&
            (mode === 'series' ? (
              <CyclePreview ctx={ctx} which="shapes" />
            ) : mode === 'variable' ? (
              <Select
                label="Shape variable"
                value={vars.shape ?? ''}
                options={variableOptions(ctx, 'shape')}
                onChange={(v) =>
                  ctx.dispatch(variableCommands(ctx, 'shape', v), 'Shape by variable')
                }
              />
            ) : (
              <Select<SymbolShape>
                label="Fixed shape"
                value={fixed}
                mixed={differ(values)}
                options={SHAPES}
                onChange={(v) => set([[row.field, v]], 'Shape')}
              />
            ))}
        </div>
      )
    }
    case 'size': {
      const sizes = values as (number | undefined)[]
      const onMode = (m: Mode) =>
        ctx.dispatch(
          m === 'variable' ? firstVariable(ctx, 'size') : variableCommands(ctx, 'size', ''),
          m === 'variable' ? 'Size by variable' : 'Fixed size',
        )
      return (
        <div className="field-row appearance-row">
          {row.modes.length > 1 && modeSelect(onMode)}
          {mode === 'variable' ? (
            <Select
              label="Size variable"
              value={vars.size ?? ''}
              options={variableOptions(ctx, 'size')}
              onChange={(v) => ctx.dispatch(variableCommands(ctx, 'size', v), 'Size by variable')}
            />
          ) : (
            <NumberInput
              label="Size (pt)"
              value={sizes[0] ?? 6}
              mixed={differ(sizes)}
              min={1}
              max={30}
              step={0.5}
              onChange={(v) => set([[row.field, v]], 'Symbol size')}
            />
          )}
        </div>
      )
    }
  }
}

/** The commands mapping an aesthetic's first fitting variable (none: nothing). */
function firstVariable(ctx: PanelContext, field: Aesthetic): Command[] {
  const v = variableOptions(ctx, field).find((o) => o.value !== '')
  return v ? variableCommands(ctx, field, v.value) : []
}

/** The graph's cycle (shapes or line styles) at a glance, with its editor folded under it. */
function CyclePreview({ ctx, which }: { ctx: PanelContext; which: 'shapes' | 'dashes' }) {
  const list =
    which === 'shapes' ? graphShapes(ctx.graph, ctx.theme) : graphDashes(ctx.graph, ctx.theme)
  const glyphs = list
    .map((v) => (which === 'shapes' ? SHAPE_GLYPHS[v as SymbolShape] : DASH_GLYPHS[v as Dash]))
    .join('  ')
  return (
    <details className="appearance-cycle">
      <summary
        title={`Each data set takes the next of the graph’s ${which === 'shapes' ? 'shapes' : 'line styles'}`}
      >
        {glyphs}
      </summary>
      <CycleListFields ctx={ctx} which={which} />
    </details>
  )
}

/**
 * Roadmap 49a: the graph's order of shapes (or line styles) data sets take in turn where a
 * layer's is by data set — edited like the palette: each place's choice, one added or the last
 * removed, back to the default order.
 */
export function CycleListFields({
  ctx,
  which,
}: {
  ctx: PanelContext
  which: 'shapes' | 'dashes'
}): ReactNode {
  const shapes = which === 'shapes'
  const list: readonly string[] = shapes
    ? graphShapes(ctx.graph, ctx.theme)
    : graphDashes(ctx.graph, ctx.theme)
  const own = ctx.graph.style[which]
  const noun = shapes ? 'Shape' : 'Line style'
  const options: readonly { value: string; label: string }[] = shapes ? SHAPES : DASHES
  const max = shapes ? 24 : 12
  const set = (next: readonly string[] | undefined, label: string) =>
    ctx.set(['style', which], next ? [...next] : undefined, label)
  const label = shapes ? 'Order of shapes' : 'Order of line styles'
  return (
    <fieldset className="field cycle-list">
      <legend>{label}</legend>
      <div className="field-row wrap">
        {list.map((v, i) => (
          <Select
            // biome-ignore lint/suspicious/noArrayIndexKey: a place in the list
            key={i}
            label={`${noun} ${i + 1}`}
            value={v}
            options={options}
            onChange={(x) =>
              set(
                list.map((y, j) => (j === i ? x : y)),
                label,
              )
            }
          />
        ))}
      </div>
      <div className="field-row wrap">
        {list.length < max && (
          <button
            type="button"
            className="link"
            onClick={() => set([...list, options[list.length % options.length]!.value], label)}
          >
            Add {shapes ? 'a shape' : 'a line style'}
          </button>
        )}
        {list.length > 1 && (
          <button type="button" className="link" onClick={() => set(list.slice(0, -1), label)}>
            Remove the last
          </button>
        )}
        {own && (
          <button type="button" className="link" onClick={() => set(undefined, label)}>
            Default order
          </button>
        )}
      </div>
    </fieldset>
  )
}

/** Roadmap 49a: the graph's place: its orders of shapes and line styles by data set. */
export function CycleListsSection({ ctx }: { ctx: PanelContext }) {
  if (ctx.graph.frame === 'polar' || ctx.graph.frame === 'matrix') return null
  return (
    <Section title="Shapes and line styles by data set">
      <p className="muted">
        Where a layer’s shape or line style is “By data set”, each data set takes the next of these,
        as its colour takes the colour scheme’s.
      </p>
      <CycleListFields ctx={ctx} which="shapes" />
      <CycleListFields ctx={ctx} which="dashes" />
    </Section>
  )
}
