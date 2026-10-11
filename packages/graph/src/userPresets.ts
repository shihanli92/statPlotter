import type {
  DataTable,
  GraphNode,
  Layer,
  PresetRecipe,
  TableKind,
  UserPreset,
  VariableMapping,
} from '@ps/model'
import { checkLayers, type MatrixKind } from './layers/matrix.ts'
import { vectorEnds } from './plotStyles.ts'
import {
  defaultAes,
  dotPlotGroup,
  groupVariables,
  lookFor,
  OVERLAID_BINS,
  type PresetLayers,
} from './presets.ts'

// User presets (roadmap 33c, decision 255): a saved recipe (`presetRecipe` in @ps/model) applied
// to a table, the way a built-in preset's layer list is. Applying one goes through the same
// paths as the built-in presets: a new graph's scaffold, or Change layers' keep-formats rule.

/** The id a user preset's graphs carry as provenance (`GraphNode.preset`). */
export const userPresetId = (name: string) => `user:${name}`

/** A graph of variables' kind by the types a recipe keeps (roadmap 34a). */
const RECIPE_KINDS: Record<string, MatrixKind> = {
  tn: 'mvTextNumber',
  nt: 'mvNumberText',
  tt: 'mvTextText',
  nn: 'multipleVariables',
}

/**
 * The variables a recipe of a graph of variables maps on a table: the first ones of the types it
 * keeps (X, then another for Y, then colour, shape, size and labels, each a variable not mapped
 * yet; an aesthetic without one left unmapped); undefined when the table has too few for X and Y.
 */
export function recipeMapping(
  recipe: PresetRecipe,
  table: Pick<DataTable, 'dataSets'>,
): VariableMapping | undefined {
  const v = recipe.variables
  if (!v) return undefined
  const taken = new Set<string>()
  const pick = (type: 'number' | 'text' | undefined) => {
    if (!type) return undefined
    const d = table.dataSets.find((x) => !!x.text === (type === 'text') && !taken.has(x.id))
    if (d) taken.add(d.id)
    return d?.id
  }
  const x = pick(v.x)
  const y = pick(v.y)
  if (!x || !y) return undefined
  const more = {
    color: pick(v.color),
    shape: pick(v.shape),
    size: pick(v.size),
    label: pick(v.label),
  }
  return {
    x,
    y,
    ...Object.fromEntries(Object.entries(more).filter(([, k]) => k !== undefined)),
    ...(v.measure ? { measure: v.measure } : {}),
  }
}

/** Whether a recipe maps number × number variables (an XY graph's points, not a mapping). */
const pointsRecipe = (recipe: PresetRecipe) =>
  recipe.variables?.x === 'number' && recipe.variables.y === 'number'

/**
 * Whether a recipe fits a table kind (and table): every layer it draws is allowed there in its
 * frame; variable mappings, and graphs of variables, only for multiple-variables tables, those
 * with variables of the types it keeps.
 */
export function presetFits(
  recipe: PresetRecipe,
  kind: TableKind,
  table?: Pick<DataTable, 'dataSets'>,
): boolean {
  const mv = kind === 'multipleVariables'
  if ((recipe.layers.some((l) => l.aes) || recipe.variables) && !mv) return false
  if (recipe.variables && table && !recipeMapping(recipe, table)) return false
  const v = recipe.variables
  const matrixKind: MatrixKind = v ? RECIPE_KINDS[`${v.x[0]}${v.y[0]}`]! : kind
  // Vectors (roadmap 34c) end at the table's next two number variables, mapped when applied.
  const vectors = recipe.layers.some((l) => l.geom === 'segment')
  if (vectors && table && !vectorEnds(recipe.layers, table)) return false
  // A dot plot (roadmap 34g) groups by the table's first group variable.
  const dots = recipe.layers.some((l) => l.stat.kind === 'dotplot')
  if (dots && table && !groupVariables(table).length) return false
  // A histogram of a variable (roadmap 34f) bins the table's first number variable.
  const layers = recipe.layers.map((l) =>
    l.geom === 'segment'
      ? ({ ...l, aes: { xend: 'xend', yend: 'yend' } } as Layer)
      : l.geom === 'bar' && l.stat.kind === 'bin' && l.aes
        ? ({ ...l, aes: { x: 'x' } } as Layer)
        : l.stat.kind === 'dotplot'
          ? ({ ...l, aes: { group: 'group' } } as Layer)
          : l,
  )
  for (const a of checkLayers({ ...recipe, layers }, matrixKind, { raw: true }).values())
    if (!a.allowed) return false
  return true
}

/** The user presets that fit a table kind (and table), in the library's order. */
export const userPresetsFor = (
  presets: readonly UserPreset[],
  kind: TableKind,
  table?: Pick<DataTable, 'dataSets'>,
): UserPreset[] => presets.filter((p) => presetFits(p.recipe, kind, table))

/** The user preset chosen as the default for a table kind, if any fits. */
export const defaultUserPreset = (
  presets: readonly UserPreset[],
  kind: TableKind,
  table?: Pick<DataTable, 'dataSets'>,
): UserPreset | undefined =>
  presets.find(
    (p) => p.isDefault && p.recipe.tableKind === kind && presetFits(p.recipe, kind, table),
  )

/** What a user preset applies to a table besides its layers. */
export interface RecipeExtras {
  orientation?: 'horizontal'
  drawOrder?: 'series'
  scales?: GraphNode['scales']
  /** Roadmap 49a: the graph's cycles of symbols and line patterns. */
  shapes?: NonNullable<GraphNode['style']['shapes']>
  dashes?: NonNullable<GraphNode['style']['dashes']>
}

/**
 * A recipe's frame, look and layers for a table: its layers with the table's variables mapped
 * where they map variables (as a new bubble plot does), with what else it sets.
 */
export function recipeLayers(
  recipe: PresetRecipe,
  table: DataTable,
  name: string,
): PresetLayers & RecipeExtras {
  const vars = recipeMapping(recipe, table)
  // Number × number (roadmap 34b): the variables of the types kept on the mapped points; a recipe
  // kept before 34b (no types) maps the table's defaults, as a new bubble plot does.
  const points = pointsRecipe(recipe)
  const aes = (l: Layer): NonNullable<Layer['aes']> => {
    // Roadmap 34c's overlays, paths and vectors map nothing of their own (a vector's ends below),
    // nor do 34g's densities; a dot plot groups by the table's first group variable.
    if (['polygon', 'path', 'segment', 'hex', 'contour', 'raster'].includes(l.geom)) return {}
    if (l.stat.kind === 'dotplot') {
      const group = dotPlotGroup(table)?.id
      return group ? { group } : {}
    }
    // A histogram of a variable (roadmap 34f): the first number variable, by the first group
    // variable when the bars were grouped (stacked or translucent: the recipe keeps no variables).
    if (l.geom === 'bar' && l.stat.kind === 'bin') {
      const x = table.dataSets.find((d) => !d.text)?.id
      const grouped =
        l.position?.kind === 'stack' ||
        JSON.stringify(l.style?.fill) === JSON.stringify(OVERLAID_BINS)
      const color = grouped ? groupVariables(table)[0]?.id : undefined
      return { ...(x ? { x } : {}), ...(color ? { color } : {}) }
    }
    if (!points || !vars) return defaultAes(table)
    if (l.geom !== 'points') return {}
    const { measure: _, ...mapped } = vars
    return mapped
  }
  const mapped = recipe.layers.map((l): Layer => (l.aes ? { ...l, aes: aes(l) } : l))
  // Vectors (roadmap 34c) end at the table's next number variables.
  const ends = vectorEnds(mapped, table)
  const layers = mapped.map(
    (l): Layer => (l.geom === 'segment' && ends ? { ...l, aes: { ...l.aes, ...ends } } : l),
  )
  const mapping = points ? undefined : vars
  return {
    frame: recipe.frame,
    look: recipe.look ?? lookFor(recipe.frame, layers),
    layers,
    preset: userPresetId(name),
    ...(mapping ? { mapping } : {}),
    ...(recipe.orientation ? { orientation: recipe.orientation } : {}),
    ...(recipe.drawOrder ? { drawOrder: recipe.drawOrder } : {}),
    ...(recipe.scales ? { scales: recipe.scales } : {}),
    ...(recipe.shapes ? { shapes: recipe.shapes } : {}),
    ...(recipe.dashes ? { dashes: recipe.dashes } : {}),
  }
}
