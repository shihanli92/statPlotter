import { z } from 'zod'
import { APP_VERSION } from './factory.ts'
import { SymbolShape } from './graph.ts'
import {
  ColorScale,
  Frame,
  GraphLook,
  type GraphNode,
  Layer,
  LevelMeasure,
  layerIssues,
  MAX_LAYERS,
  SizeScale,
} from './layers.ts'
import { treesAsLayers } from './migrations/v2to3.ts'
import { Dash, RGB } from './style.ts'
import { type DataTable, TableKind } from './table.ts'

/** A variable's type, as a preset of a graph of variables keeps it. */
const VariableType = z.enum(['number', 'text'])

// The user's saved layer stacks (roadmap 33c, bringing forward part of roadmap 37): a preset is
// a graph's layer list as a recipe, free of anything tied to a table's data sets, kept in the
// user's library (desktop: `presets/` in the app data folder; web: IndexedDB) or shared as a
// `.pspreset` file.

export const PRESET_FORMAT = 'plotting-software-preset'
/**
 * Version of the preset file; newer files are refused. 2 (roadmap 49c): a heat map's dendrograms
 * are layers of their own (a version 1 recipe's layers are read through `treesAsLayers`, as
 * projects of schema v2 are migrated).
 */
export const PRESET_VERSION = 2
export const PRESET_EXTENSION = 'pspreset'
/** Longest preset name. */
export const PRESET_NAME_MAX = 60

/** What a preset keeps of a graph: its layers and the few graph-wide settings they go with. */
export const PresetRecipe = z
  .object({
    /** The table kind it was made for (it may fit others of the same frame). */
    tableKind: TableKind,
    frame: Frame,
    look: GraphLook.optional(),
    /** Back to front; no data-set keys (no `series`, `aes` mappings or outputs). */
    layers: z.array(Layer).min(1).max(MAX_LAYERS),
    orientation: z.literal('horizontal').optional(),
    drawOrder: z.literal('series').optional(),
    /**
     * Roadmap 49a: the graph's cycles of symbols and line patterns (data sets take them in turn
     * where a layer's shape or dash is the data set's).
     */
    shapes: z.array(SymbolShape).min(1).max(24).optional(),
    dashes: z.array(Dash).min(1).max(12).optional(),
    /** Roadmap 49d: the graph's fill colours by data set. */
    fillPalette: z.array(RGB).min(1).max(64).optional(),
    /** Colour maps (a fill variable's too, roadmap 49d) and bubble sizes (no value ranges). */
    scales: z.object({ color: ColorScale, fill: ColorScale, size: SizeScale }).partial().optional(),
    /**
     * A graph of a multiple-variables table's variables (roadmap 34a): the types of the variables
     * on its axes and colour, never the variables (the table's first ones of those types are
     * mapped when it is used), and what text × text counts.
     */
    variables: z
      .object({
        x: VariableType,
        y: VariableType,
        /** Text: groups (34a); a number (roadmap 34b): the points coloured on a colour map. */
        color: VariableType.optional(),
        /**
         * Roadmap 49d: the type of the variable mapped to fill, or 'color' when it is the colour's
         * variable.
         */
        fill: z.union([VariableType, z.literal('color')]).optional(),
        measure: LevelMeasure.optional(),
        /** Roadmap 34b: the types of the variables mapped to shape, size and labels. */
        shape: z.literal('text').optional(),
        size: z.literal('number').optional(),
        label: VariableType.optional(),
      })
      .optional(),
  })
  .superRefine((r, ctx) => {
    for (const issue of layerIssues(r))
      ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message })
  })
export type PresetRecipe = z.infer<typeof PresetRecipe>

/** A preset in the user's library. */
export interface UserPreset {
  name: string
  /** ISO date and time it was saved. */
  created: string
  appVersion: string
  recipe: PresetRecipe
  /** Place in the builder's row (the library's own; not exported). */
  order?: number
  /** Chosen when the builder opens for its table kind (the library's own; not exported). */
  isDefault?: boolean
}

const PresetName = z.string().trim().min(1).max(PRESET_NAME_MAX)

const PresetFile = z.object({
  format: z.literal(PRESET_FORMAT),
  version: z.number().int().min(1),
  name: PresetName,
  created: z.string(),
  appVersion: z.string(),
  recipe: PresetRecipe,
  order: z.number().int().optional(),
  isDefault: z.boolean().optional(),
})

export class PresetError extends Error {}

const FORBIDDEN = /[\\/:*?"<>|]/

/** Why a name can't be a new preset's (null: it can); `taken` are the names in use. */
export function presetNameProblem(name: string, taken: readonly string[] = []): string | null {
  const n = name.trim()
  if (!n) return 'Give the preset a name.'
  if (n.length > PRESET_NAME_MAX) return `A name has at most ${PRESET_NAME_MAX} characters.`
  if (FORBIDDEN.test(n) || n.startsWith('.'))
    return 'A name can’t contain / \\ : * ? " < > | or start with a dot.'
  const lower = n.toLowerCase()
  if (taken.some((t) => t.trim().toLowerCase() === lower))
    return `There is already a preset called “${n}”.`
  return null
}

/**
 * A name like `name` that isn't taken ("Bars (2)"). A name that can't be a preset's (one from a
 * shared file) is made one first.
 */
export const uniquePresetName = (name: string, taken: readonly string[]): string =>
  uniqueLibraryName(name, taken, 'Preset', PRESET_NAME_MAX, presetNameProblem)

/**
 * `name` made a valid preset or style name (the characters names refuse become "-", no leading
 * dots or spaces, at most `max` characters, `fallback` when nothing is left), then numbered
 * until it isn't taken. One of the numbers 2 … taken.length + 2 is free, so the search ends.
 */
export function uniqueLibraryName(
  name: string,
  taken: readonly string[],
  fallback: string,
  max: number,
  problem: (name: string, taken: readonly string[]) => string | null,
): string {
  const clean = (s: string) =>
    s
      .replace(/[\\/:*?"<>|]/g, '-')
      .replace(/^[\s.]+/, '')
      .trim()
  const base = clean(clean(name).slice(0, max)) || fallback
  if (!problem(base, taken)) return base
  for (let i = 2; i <= taken.length + 2; i++) {
    const suffix = ` (${i})`
    const next = `${base.slice(0, max - suffix.length).trim()}${suffix}`
    if (!problem(next, taken)) return next
  }
  throw new Error(`No free name for “${base}”.`)
}

/**
 * The recipe of a graph's layers: each layer's geom, stat, position, style, attachment,
 * visibility, name and legend choice, with the orientation, drawing order, look and colour /
 * size scales. Left out: everything tied to the table's data sets (per-data-set formats and
 * stats, variable mappings, which become the new table's defaults), layers drawing analysis
 * outputs or functions (and those on them), and the graph's titles, axes, annotations, point
 * formats and identities.
 */
export function presetRecipe(
  graph: Pick<GraphNode, 'frame' | 'look' | 'layers' | 'style' | 'drawOrder' | 'scales'> &
    Partial<Pick<GraphNode, 'mapping'>>,
  tableKind: TableKind,
  table?: Pick<DataTable, 'dataSets'>,
): PresetRecipe {
  const gone = new Set<string>()
  for (const l of graph.layers)
    if (l.data?.from === 'outputs' || l.data?.from === 'functions') gone.add(l.id)
  for (let grew = true; grew; ) {
    grew = false
    for (const l of graph.layers) {
      if (gone.has(l.id)) continue
      if ((l.on && gone.has(l.on)) || (l.data?.from === 'layer' && gone.has(l.data.layer))) {
        gone.add(l.id)
        grew = true
      }
    }
  }
  const layers = graph.layers
    .filter((l) => !gone.has(l.id))
    .map((l): Layer => {
      const { series: _s, seriesHidden: _h, aes, ...rest } = l
      // Variables mapped to aesthetics are the table's: the layer keeps that it maps them.
      return (aes ? { ...rest, aes: {} } : rest) as Layer
    })
  // Value ranges are the data's, levels' symbols the table's: neither is kept.
  const without = <T extends object>(o: T | undefined, keys: readonly string[]) =>
    o ? Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k))) : undefined
  const colorScale = without(graph.scales?.color, ['min', 'max', 'midpoint'])
  const fillScale = without(graph.scales?.fill, ['min', 'max', 'midpoint'])
  const sizeScale = without(graph.scales?.size, ['low', 'high'])
  const scales = {
    ...(colorScale && Object.keys(colorScale).length ? { color: colorScale } : {}),
    ...(fillScale && Object.keys(fillScale).length ? { fill: fillScale } : {}),
    ...(sizeScale && Object.keys(sizeScale).length ? { size: sizeScale } : {}),
  }
  // The types of the variables a graph of variables maps (not the variables: the table's own).
  const type = (k: string | undefined) => {
    const d = k === undefined ? undefined : table?.dataSets.find((x) => x.id === k)
    return d ? (d.text ? ('text' as const) : ('number' as const)) : undefined
  }
  // A graph of variables' mapping, or (number × number, roadmap 34b) its mapped points' `aes`.
  const points =
    graph.frame === 'xy' ? graph.layers.find((l) => l.geom === 'points' && l.aes) : undefined
  const m = graph.mapping ?? (points?.aes?.x && points.aes.y ? points.aes : undefined)
  const [x, y] = [type(m?.x), type(m?.y)]
  const more = m && {
    color: type(m.color),
    fill: m.fill !== undefined && m.fill === m.color ? ('color' as const) : type(m.fill),
    shape: type(m.shape) === 'text' ? ('text' as const) : undefined,
    size: type(m.size) === 'number' ? ('number' as const) : undefined,
    label: type(m.label),
  }
  const variables =
    m && x && y
      ? {
          x,
          y,
          ...Object.fromEntries(Object.entries(more ?? {}).filter(([, v]) => v !== undefined)),
          ...('measure' in m && m.measure ? { measure: m.measure } : {}),
        }
      : undefined
  return PresetRecipe.parse({
    tableKind,
    frame: graph.frame,
    ...(graph.look ? { look: graph.look } : {}),
    layers,
    ...(graph.style.orientation === 'horizontal' ? { orientation: 'horizontal' } : {}),
    ...(graph.drawOrder === 'series' ? { drawOrder: 'series' } : {}),
    ...(graph.style.shapes ? { shapes: graph.style.shapes } : {}),
    ...(graph.style.dashes ? { dashes: graph.style.dashes } : {}),
    ...(graph.style.fillPalette ? { fillPalette: graph.style.fillPalette } : {}),
    ...(Object.keys(scales).length ? { scales } : {}),
    ...(variables ? { variables } : {}),
  })
}

/** A new preset of a recipe. */
export function newUserPreset(name: string, recipe: PresetRecipe): UserPreset {
  return { name: name.trim(), created: new Date().toISOString(), appVersion: APP_VERSION, recipe }
}

/**
 * The preset file's text (JSON). `exported`: a file to share, without the library's own order
 * and default choice.
 */
export function writePreset(p: UserPreset, opts: { exported?: boolean } = {}): string {
  const file: z.input<typeof PresetFile> = {
    format: PRESET_FORMAT,
    version: PRESET_VERSION,
    name: p.name,
    created: p.created,
    appVersion: p.appVersion,
    recipe: p.recipe,
    ...(!opts.exported && p.order !== undefined ? { order: p.order } : {}),
    ...(!opts.exported && p.isDefault ? { isDefault: true } : {}),
  }
  return `${JSON.stringify(file, null, 1)}\n`
}

/** A version 1 preset file's recipe with v2 layers made v3's (roadmap 49c, `treesAsLayers`). */
function presetV1to2(raw: unknown): unknown {
  const file = raw as { recipe?: { layers?: unknown; frame?: unknown } }
  const recipe = file.recipe
  if (typeof recipe !== 'object' || recipe === null || !Array.isArray(recipe.layers)) return raw
  return { ...file, recipe: { ...recipe, layers: treesAsLayers(recipe.layers, recipe.frame) } }
}

/** A preset file read back and checked. Throws PresetError with a message for the user. */
export function readPreset(text: string): UserPreset {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new PresetError('Not a preset file (it is not valid JSON).')
  }
  if ((raw as { format?: unknown } | null)?.format !== PRESET_FORMAT)
    throw new PresetError('Not a preset file.')
  const version = (raw as { version?: unknown }).version
  if (typeof version === 'number' && version > PRESET_VERSION)
    throw new PresetError('This preset was saved by a newer version of the app.')
  const parsed = PresetFile.safeParse(version === 1 ? presetV1to2(raw) : raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new PresetError(
      `This preset can’t be used: ${issue ? `${issue.path.join('.') || 'file'}: ${issue.message}` : 'invalid file'}.`,
    )
  }
  const { format: _f, version: _v, ...rest } = parsed.data
  return rest
}
