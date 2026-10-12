import {
  type Allowed,
  aesAllowed,
  binsFill,
  builderDefaultFor,
  canMoveLayer,
  cellsAllowed,
  checkLayers,
  frameChoiceOf,
  frameChoiceSelected,
  histogramLayer,
  hostsFirst,
  isEmbeddingPair,
  type LayerChange,
  layerMovedBy,
  layerMovedTo,
  lookFor,
  mappingAxes,
  matrixKindOf,
  NESTED_DEFAULTS,
  type NestedOptions,
  nestedOf,
  newGraphNode,
  newStyleLayer,
  type PresetLayers,
  plotStyle,
  presetCellsAllowed,
  presetLayers,
  presetsFor,
  type RecipeExtras,
  recipeLayers,
  stacked,
  stackedArea,
  styleAllowed,
  styleContext,
  styleOfLayer,
  stylesFor,
  UNSTACKED,
  variableHistogram,
  withLayers,
  withNested,
  withOrientation,
  withStyleLayer,
} from '@ps/graph'
import {
  type DataTable,
  type Frame,
  type GraphLook,
  type GraphNode,
  isCellsTable,
  type Layer,
  type LevelMeasure,
  type LevelOrder,
  type NodeId,
  type Position,
  type ProjectSettings,
  type Stat,
  styledNewGraph,
  type UserPreset,
  type VariableMapping,
} from '@ps/model'

// The graph builder's state (roadmap 33c, design §7.1): a frame, its layers back to front (the
// layer table shows them front first, roadmap 33e), the preset they started from, and the options
// below the layer table. A pure reducer (as the rich text model is), so every step the builder
// offers is a tested function of the table.

export interface BuilderState {
  frame: Frame
  look: GraphLook
  /** Back to front. */
  layers: Layer[]
  /** The preset the layers started from (kept as provenance when edited). */
  preset?: string
  /** Edited since the preset was chosen (the presets row shows "Custom"). */
  custom: boolean
  /** Categories down the left (category and grouped frames). */
  horizontal: boolean
  /** Nested tables: how subjects are drawn. */
  nested?: NestedOptions
  /** What the last step did beyond the obvious (layers it left out, the frame it changed). */
  note?: string
  /** A user preset's drawing order and scales (applied with its layers). */
  drawOrder?: 'series'
  scales?: GraphNode['scales']
  /** Roadmap 49a: a user preset's cycles of symbols and line patterns (the graph's style's). */
  shapes?: NonNullable<GraphNode['style']['shapes']>
  dashes?: NonNullable<GraphNode['style']['dashes']>
  /** Roadmap 49d: a user preset's fill colours by data set (the graph's style's). */
  fillPalette?: NonNullable<GraphNode['style']['fillPalette']>
  /**
   * Multiple variables (roadmap 34a): the variables on a category, grouped or matrix graph's axes
   * (a text variable among them); absent for the variables as columns or mapped on XY points.
   */
  mapping?: VariableMapping
  /** The order of text variables' levels the graph keeps (its `levels`). */
  levels?: GraphNode['levels']
  /**
   * How levels not in `levels` are ordered (its `levelOrder`): natural for a new graph (roadmap
   * 34f), a graph's own when the builder changes or copies it.
   */
  levelOrder?: LevelOrder
}

/** What a variable can be mapped to besides the axes (roadmap 34b). */
export type Appearance = 'color' | 'fill' | 'shape' | 'size' | 'label'

/** How the data sets of a grouped graph sit in each row. */
export type Groups = 'dodge' | 'aligned' | 'stack' | 'percent'

export type BuilderAction =
  | { type: 'preset'; id: string }
  /** A user preset's recipe, made for the table (`recipeLayers`). */
  | { type: 'recipe'; spec: PresetLayers & RecipeExtras }
  /** A plot style's icon: adds its layer, or removes it when there; a frame choice switches. */
  | { type: 'toggle'; style: string }
  /** Removes a layer and the layers attached to it. */
  | { type: 'remove'; id: string }
  /**
   * One step towards the front (1: up in the list) or the back (−1: down), with the layers
   * attached just in front of it; attached layers stay in front of their hosts (`layerMovedBy`).
   */
  | { type: 'move'; id: string; by: -1 | 1 }
  /** To place `to` of the (back-to-front) list, as dragging its row does (`layerMovedTo`). */
  | { type: 'moveTo'; id: string; to: number }
  | { type: 'stat'; id: string; stat: Stat }
  | { type: 'groups'; value: Groups }
  | { type: 'horizontal'; on: boolean }
  | { type: 'nested'; value: Partial<NestedOptions> }
  /**
   * Multiple variables: a variable mapped to X, Y, size, colour, shape or labels of the points
   * (absent: none), or the group of lines by group (absent: the colour variable).
   */
  | {
      type: 'aes'
      field: 'x' | 'y' | 'size' | 'color' | 'fill' | 'shape' | 'label' | 'group' | 'xend' | 'yend'
      key?: string
    }
  /**
   * Multiple variables (roadmap 34b): a variable mapped to colour, shape, size or labels of the
   * graph's points (absent: none) — on an XY graph its mapped points' (`aes`), else the graph's
   * mapping (a text colour variable makes groups: `map`).
   */
  | { type: 'appearance'; field: Appearance; key?: string }
  /** XY areas overlapping (each to its baseline) or stacked. */
  | { type: 'areas'; stacked: boolean }
  /** Roadmap 34f: a histogram of a variable's groups overlaid (translucent) or stacked. */
  | { type: 'bins'; stacked: boolean }
  /** Pies: a pie or a donut. */
  | { type: 'look'; look: GraphLook }
  /**
   * Multiple variables (roadmap 34a): a variable of any type on X or Y, or a colour variable (none:
   * the variables as columns, or no colour); the frame follows the types (`mapVariable`).
   */
  | { type: 'map'; field: 'x' | 'y' | 'color'; key?: string }
  /** Text × text: what the bars or tiles show of each combination of levels. */
  | { type: 'measure'; value: LevelMeasure }
  /** The order of a text variable's levels on the graph (null: the table's order). */
  | { type: 'levels'; variable: string; order: string[] | null }
  /** Every variable's order of levels at once (Order of levels… cancelled: as they were). */
  | { type: 'allLevels'; levels: GraphNode['levels'] | undefined }
  /**
   * Roadmap 34g: an XY graph of variables' points coloured by their local density (in place of a
   * colour variable; the densest drawn on top), or not.
   */
  | { type: 'densityColor'; on: boolean }

const nestedTable = (t: DataTable) => t.tableKind === 'nested'

/**
 * The builder's start: the user's default preset for the table's kind, else a built-in preset
 * (`preset`, else the kind's default chip).
 */
export function initialBuilder(
  table: DataTable,
  preset?: string,
  userDefault?: UserPreset,
): BuilderState {
  if (userDefault) {
    const start = initialBuilder(table, preset)
    return builderReducer(table, start, {
      type: 'recipe',
      spec: recipeLayers(userDefault.recipe, table, userDefault.name),
    })
  }
  const ids = presetsFor(table.tableKind).map((p) => p.id)
  const id = preset && ids.includes(preset) ? preset : builderDefaultFor(table)
  const spec = presetLayers(id, table, { nested: NESTED_DEFAULTS })!
  return {
    frame: spec.frame,
    look: spec.look,
    layers: spec.layers,
    preset: id,
    custom: false,
    horizontal: turnedBy(table, spec.mapping) ?? false,
    ...(nestedTable(table) ? { nested: nestedOf(spec.layers) } : {}),
    ...(spec.mapping ? { mapping: spec.mapping } : {}),
    // Roadmap 34f: new graphs order levels naturally (C2 before C10).
    levelOrder: 'natural',
  }
}

/**
 * Whether a mapping turns the graph: number × text draws its categories down the left, text ×
 * number along X; undefined for others (text × text turns either way, by choice).
 */
function turnedBy(table: DataTable, mapping: VariableMapping | undefined): boolean | undefined {
  const axes = mapping && mappingAxes(table, mapping)
  return axes === 'nt' ? true : axes === 'tn' ? false : undefined
}

/** The builder over an existing graph (Change layers…, Duplicate as…). */
export function builderOf(graph: GraphNode, table: DataTable | undefined): BuilderState {
  return {
    frame: graph.frame,
    look: graph.look ?? lookFor(graph.frame, graph.layers),
    layers: graph.layers,
    ...(graph.preset ? { preset: graph.preset } : {}),
    custom: !!graph.preset,
    horizontal: graph.style.orientation === 'horizontal',
    ...(table && nestedTable(table) ? { nested: nestedOf(graph.layers) } : {}),
    ...(graph.mapping ? { mapping: graph.mapping } : {}),
    ...(graph.levels ? { levels: graph.levels } : {}),
    ...(graph.levelOrder ? { levelOrder: graph.levelOrder } : {}),
    ...(graph.scales ? { scales: graph.scales } : {}),
  }
}

/** Layers without one and those attached to it or drawing its data, transitively. */
function without(layers: readonly Layer[], id: string): Layer[] {
  const gone = new Set([id])
  for (let grew = true; grew; ) {
    grew = false
    for (const l of layers) {
      if (gone.has(l.id)) continue
      if ((l.on && gone.has(l.on)) || (l.data?.from === 'layer' && gone.has(l.data.layer))) {
        gone.add(l.id)
        grew = true
      }
    }
  }
  return layers.filter((l) => !gone.has(l.id))
}

/** Whether a list's XY areas overlap or stack. */
export const areasOf = (layers: readonly Layer[]): 'overlap' | 'stack' =>
  layers.some((l) => l.geom === 'area' && l.position?.kind === 'stack') ? 'stack' : 'overlap'

/** The groups setting a grouped list has. */
export function groupsOf(layers: readonly Layer[]): Groups {
  const bars = layers.find((l) => l.geom === 'bar' && l.position?.kind === 'stack')
  if (bars?.position?.kind === 'stack') return bars.position.percent ? 'percent' : 'stack'
  return layers.some((l) => !l.on && l.position?.kind === 'aligned') ? 'aligned' : 'dodge'
}

/** A position for layers of a grouped list (attached layers and bars of a stack apart). */
function placed(layers: readonly Layer[], groups: Groups): Layer[] {
  const p: Position = groups === 'aligned' ? { kind: 'aligned' } : { kind: 'dodge' }
  const stack: Position = { kind: 'stack', ...(groups === 'percent' ? { percent: true } : {}) }
  return layers.map((l) => {
    if (groups === 'stack' || groups === 'percent')
      return { ...l, position: l.geom === 'bar' ? stack : { kind: 'aligned' } } as Layer
    return { ...l, position: p } as Layer
  })
}

/** After an edit: the look its layers call for, marked custom. */
function edited(s: BuilderState, layers: Layer[], note?: string): BuilderState {
  const { note: _, ...rest } = s
  return {
    ...rest,
    layers,
    look: lookFor(s.frame, layers, s.look),
    custom: true,
    ...(note ? { note } : {}),
  }
}

/** The builder's next state. */
export function builderReducer(table: DataTable, s: BuilderState, a: BuilderAction): BuilderState {
  switch (a.type) {
    case 'densityColor':
      return withDensityColor(s, a.on)
    case 'preset': {
      // On the variables mapped; a preset that can't draw them (a bubble plot) leaves them. A
      // cells table's chips of a mark per row are disabled (roadmap 34f).
      if (!presetCellsAllowed(a.id, table, s.mapping ? { mapping: s.mapping } : {}).allowed)
        return s
      const nested = s.nested ? { nested: s.nested } : {}
      const spec =
        presetLayers(a.id, table, { ...nested, ...(s.mapping ? { mapping: s.mapping } : {}) }) ??
        (s.mapping ? presetLayers(a.id, table, nested) : undefined)
      if (!spec) return s
      const {
        note: _,
        drawOrder: _d,
        scales: _s,
        mapping: _m,
        shapes: _sh,
        dashes: _da,
        fillPalette: _fp,
        ...rest
      } = s
      const turned = turnedBy(table, spec.mapping)
      return {
        ...rest,
        frame: spec.frame,
        look: spec.look,
        layers: spec.layers,
        preset: a.id,
        custom: false,
        ...(spec.frame !== 'category' && spec.frame !== 'grouped' ? { horizontal: false } : {}),
        ...(turned !== undefined ? { horizontal: turned } : {}),
        ...(spec.mapping ? { mapping: spec.mapping } : {}),
      }
    }
    case 'recipe': {
      const {
        note: _n,
        drawOrder: _d,
        scales: _s,
        mapping: _m,
        shapes: _sh,
        dashes: _da,
        fillPalette: _fp,
        ...rest
      } = s
      const { spec } = a
      return {
        ...rest,
        frame: spec.frame,
        look: spec.look,
        layers: spec.layers,
        preset: spec.preset,
        custom: false,
        horizontal:
          turnedBy(table, spec.mapping) ??
          ((spec.frame === 'category' || spec.frame === 'grouped') &&
            spec.orientation === 'horizontal'),
        ...(s.nested ? { nested: nestedOf(spec.layers) } : {}),
        ...(spec.drawOrder ? { drawOrder: spec.drawOrder } : {}),
        ...(spec.scales ? { scales: spec.scales } : {}),
        ...(spec.shapes ? { shapes: spec.shapes } : {}),
        ...(spec.dashes ? { dashes: spec.dashes } : {}),
        ...(spec.fillPalette ? { fillPalette: spec.fillPalette } : {}),
        ...(spec.mapping ? { mapping: spec.mapping } : {}),
      }
    }
    case 'toggle': {
      const style = plotStyle(a.style)
      if (!style) return s
      if (style.frameChoice) {
        const c = styleContext(table, s.frame, s.layers, s.mapping)
        if (frameChoiceSelected(style, c)) return s
        if (!styleAllowed(style, c).allowed) return s
        let next = builderReducer(table, s, { type: 'preset', id: frameChoiceOf(style, c)! })
        // Roadmap 34f: a histogram of a graph of variables bins the X variable the graph had,
        // grouped by its text colour variable.
        if (next !== s && histogramLayer(next)) next = histogramFrom(table, s, next)
        return next === s
          ? s
          : {
              ...next,
              custom: true,
              note: `Changed to ${style.label.toLowerCase()}: the layers were replaced.`,
            }
      }
      const mine = s.layers.filter((l) => styleOfLayer(l, s.frame)?.id === style.id)
      if (mine.length) {
        let layers = s.layers
        for (const l of mine) layers = without(layers, l.id)
        return edited(s, layers)
      }
      const c = styleContext(table, s.frame, s.layers, s.mapping)
      if (!styleAllowed(style, c).allowed) return s
      let layer = newStyleLayer(style, c, s.frame === 'grouped' ? positionOf(s) : undefined)
      if (s.frame === 'grouped' && !layer.on && layer.geom === 'bar' && stacked(s.layers))
        layer = {
          ...layer,
          position: s.layers.find((l) => l.position?.kind === 'stack')!.position,
        } as Layer
      if (layer.geom === 'area' && areasOf(s.layers) === 'stack') layer = stackedArea(layer, true)
      let layers = withStyleLayer(c, layer)
      // New bars carry the error bars and labels already there.
      if (layer.geom === 'bar' && layer.stat.kind !== 'fraction')
        layers = hostsFirst(
          layers.map((l) =>
            (l.geom === 'errorbar' || l.geom === 'label') && !l.on
              ? ({ ...l, on: layer.id } as Layer)
              : l,
          ),
        )
      if (s.nested && (layer.geom === 'points' || layer.geom === 'center'))
        layers = withNested(layers, s.nested)
      return edited(s, layers)
    }
    case 'remove':
      return edited(s, without(s.layers, a.id))
    case 'move': {
      if (!canMoveLayer(s.layers, a.id, a.by)) return s
      return edited(s, layerMovedBy(s.layers, a.id, a.by))
    }
    case 'moveTo': {
      const next = layerMovedTo(s.layers, a.id, a.to)
      return next.every((l, i) => l === s.layers[i]) ? s : edited(s, next)
    }
    case 'stat':
      return edited(
        s,
        s.layers.map((l) => (l.id === a.id ? ({ ...l, stat: a.stat } as Layer) : l)),
      )
    case 'groups': {
      if (s.frame !== 'grouped') return s
      if (a.value === 'stack' || a.value === 'percent') {
        // Stacked bars draw no points, lines or boxes (decision 217).
        const dropped = s.layers.filter(
          (l) => !l.on && ['points', 'line', 'box', 'violin', 'center'].includes(l.geom),
        )
        let layers = s.layers
        for (const l of dropped) layers = without(layers, l.id)
        if (!layers.some((l) => l.geom === 'bar'))
          layers = [
            { id: 'bars', geom: 'bar', stat: { kind: 'summary', center: 'mean' } },
            ...layers,
          ]
        const note = dropped.length
          ? `Stacked bars draw no points, lines or boxes: ${dropped.map((l) => styleOfLayer(l, s.frame)?.label ?? l.geom).join(', ')} left out.`
          : undefined
        return edited(s, placed(layers, a.value), note)
      }
      return edited(s, placed(s.layers, a.value))
    }
    case 'horizontal': {
      // A number by a text variable turns with its variables: the text one on the axis down the
      // left is Y (number × text), along the bottom X (text × number).
      const axes = s.mapping && mappingAxes(table, s.mapping)
      if (s.mapping && (axes === 'tn' || axes === 'nt') && (axes === 'nt') !== a.on)
        return { ...s, horizontal: a.on, mapping: { ...s.mapping, x: s.mapping.y, y: s.mapping.x } }
      return { ...s, horizontal: a.on }
    }
    case 'nested': {
      if (!s.nested) return s
      const nested = { ...s.nested, ...a.value }
      return { ...edited(s, withNested(s.layers, nested)), nested }
    }
    case 'areas': {
      if (s.frame !== 'xy' || !s.layers.some((l) => l.geom === 'area')) return s
      let layers = s.layers.map((l) => stackedArea(l, a.stacked))
      // Stacked areas draw no points, lines, error bars or bands (they'd sit unstacked).
      const dropped = a.stacked
        ? layers.filter(
            (l) => (l.data?.from ?? 'table') === 'table' && UNSTACKED.area.includes(l.geom),
          )
        : []
      for (const l of dropped) layers = without(layers, l.id)
      const note = dropped.length
        ? `Stacked areas draw no points, lines, error bars or bands: ${dropped.map((l) => styleOfLayer(l, s.frame)?.label ?? l.geom).join(', ')} left out.`
        : undefined
      return edited(s, layers, note)
    }
    case 'aes':
      return edited(
        s,
        s.layers.map((l) => {
          // The group belongs to lines by group (and paths, roadmap 34c), the other variables to
          // the points; a histogram (roadmap 34f) bins X by the colour variable's groups.
          const grouping = l.geom === 'line' || l.geom === 'path'
          const ends = a.field === 'xend' || a.field === 'yend'
          if (!l.aes) return l
          if (l.geom === 'bar' && l.stat.kind === 'bin') {
            if (a.field !== 'x' && a.field !== 'color') return l
            const { [a.field]: _, ...rest } = l.aes
            const aes = a.key ? { ...rest, [a.field]: a.key } : rest
            return a.field === 'color' ? binsFill({ ...l, aes }) : ({ ...l, aes } as Layer)
          }
          if (a.field === 'group' ? !grouping : ends ? l.geom !== 'segment' : l.geom !== 'points')
            return l
          const aes = { ...l.aes }
          if (a.key) aes[a.field] = a.key
          else delete aes[a.field]
          return { ...l, aes } as Layer
        }),
      )
    case 'bins': {
      if (!histogramLayer(s)) return s
      return edited(
        s,
        s.layers.map((l) => {
          if (l.geom !== 'bar' || l.stat.kind !== 'bin') return l
          const { position: _, ...rest } = l
          return binsFill(a.stacked ? { ...rest, position: { kind: 'stack' } } : rest)
        }),
      )
    }
    case 'look':
      return s.frame === 'polar' ? { ...s, look: a.look, custom: true } : s
    case 'map':
      return mapVariable(table, s, a.field, a.key)
    case 'appearance':
      return mapAppearance(table, s, a.field, a.key)
    case 'measure': {
      if (!s.mapping) return s
      const { measure: _, ...rest } = s.mapping
      return { ...s, mapping: a.value === 'count' ? rest : { ...rest, measure: a.value } }
    }
    case 'levels': {
      const { [a.variable]: _, ...others } = s.levels ?? {}
      const levels = a.order ? { ...others, [a.variable]: a.order } : others
      const { levels: _l, ...rest } = s
      return Object.keys(levels).length ? { ...rest, levels } : rest
    }
    case 'allLevels': {
      const { levels: _l, ...rest } = s
      return a.levels ? { ...rest, levels: a.levels } : rest
    }
  }
}

// --- Variables on the axes (roadmap 34a) ------------------------------------------------------

/** The variables on a builder's axes: its mapping's, its mapped points' (XY), else none. */
export function axisVariables(s: BuilderState): { x?: string; y?: string; color?: string } {
  if (s.mapping) return { x: s.mapping.x, y: s.mapping.y, color: s.mapping.color }
  // A histogram of a variable (roadmap 34f): X binned, by its colour variable's groups.
  const hist = histogramLayer(s)
  if (hist) return { x: hist.aes?.x, color: hist.aes?.color }
  const points = s.layers.find((l) => l.geom === 'points' && l.aes)
  if (s.frame === 'xy' && points?.aes)
    return { x: points.aes.x, y: points.aes.y, color: points.aes.color }
  return {}
}

/** The variables a builder maps to colour, shape, size and labels (roadmap 34b). */
export function appearanceVariables(s: BuilderState): Partial<Record<Appearance, string>> {
  const points = s.frame === 'xy' ? s.layers.find((l) => l.geom === 'points' && l.aes) : undefined
  // A histogram (roadmap 34f): its groups' colour variable only.
  const hist = histogramLayer(s)
  const from = s.mapping ?? (hist ? { color: hist.aes?.color } : points?.aes) ?? {}
  const out: Partial<Record<Appearance, string>> = {}
  for (const f of ['color', 'fill', 'shape', 'size', 'label'] as const)
    if (from[f]) out[f] = from[f]
  return out
}

/**
 * Whether the builder offers a variable for an aesthetic: by the matrix (`aesAllowed`), for the
 * graph's kind and its layers; on a graph of variables a text colour variable must not be the
 * categories' (they are coloured already).
 */
export function appearanceAllowed(
  table: DataTable,
  s: BuilderState,
  field: Appearance,
  key: string,
): Allowed {
  const d = table.dataSets.find((x) => x.id === key)
  if (!d) return { allowed: false, reason: 'not in the table' }
  // A histogram (roadmap 34f) groups its values by a text variable's levels: nothing else maps.
  if (histogramLayer(s))
    return field !== 'color'
      ? { allowed: false, reason: 'a histogram draws bins, not rows' }
      : d.text
        ? { allowed: true }
        : { allowed: false, reason: 'a histogram groups by a text variable' }
  const kind = matrixKindOf(table, { ...(s.mapping ? { mapping: s.mapping } : {}) })
  if (s.mapping && field === 'color' && (key === s.mapping.x || key === s.mapping.y))
    return { allowed: false, reason: 'on an axis' }
  // A text colour variable makes the groups of a graph of variables: its frame follows.
  const frame =
    s.mapping && field === 'color' && d.text && kind !== 'mvTextText' ? 'grouped' : s.frame
  const cells = isCellsTable(table) ? { rows: table.rowCount } : null
  return aesAllowed(kind, frame, field, d.text ? 'text' : 'number', s.layers, cells)
}

const isText = (table: DataTable, key: string | undefined) =>
  !!table.dataSets.find((d) => d.id === key)?.text

/**
 * The builder with a variable on X, Y or colour: the frame follows the variables' types. Both
 * numbers: an XY graph of the rows (the points mapped); a text variable on X or Y: a category per
 * level (grouped by a text colour variable), turned when it is Y; two text variables: counts. The
 * layers the new graph draws stay; without any, the usual ones (a box with points, count bars).
 * No variable on X or Y: every variable as a column.
 */
function mapVariable(
  table: DataTable,
  s: BuilderState,
  field: 'x' | 'y' | 'color',
  key: string | undefined,
): BuilderState {
  // A histogram of a variable (roadmap 34f): another number variable binned, or another group.
  if (histogramLayer(s) && !s.mapping) {
    if (field === 'color' && (!key || isText(table, key)))
      return builderReducer(table, s, { type: 'aes', field: 'color', key })
    if (field === 'x' && key && !isText(table, key))
      return builderReducer(table, s, { type: 'aes', field: 'x', key })
  }
  const vars = { ...axisVariables(s) }
  if (key) vars[field] = key
  else delete vars[field]
  // A first variable on an axis brings a partner on the other: a number for a text variable.
  if (field !== 'color' && key) {
    const other = field === 'x' ? 'y' : 'x'
    if (!vars[other]) {
      const numbers = table.dataSets.filter((d) => !d.text && d.id !== key)
      const texts = table.dataSets.filter((d) => d.text && d.id !== key)
      vars[other] = (numbers[0] ?? texts[0])?.id
    }
  }
  if (!vars.x || !vars.y) return toColumns(table, s)
  const [tx, ty] = [isText(table, vars.x), isText(table, vars.y)]
  if (!tx && !ty) return toScatter(table, s, { x: vars.x, y: vars.y, color: vars.color })
  const cat = tx ? vars.x : vars.y
  // A text colour variable other than the categories' makes groups; a number one colours the
  // rows' points (roadmap 34b).
  const color = tx && ty ? undefined : vars.color && vars.color !== cat ? vars.color : undefined
  const measure = tx && ty ? s.mapping?.measure : undefined
  // Shape, size and labels stay with the rows' points (text × text graphs count rows: none).
  const more = tx && ty ? {} : appearanceOf(s)
  return withMapping(table, s, {
    x: vars.x,
    y: vars.y,
    ...(color ? { color } : {}),
    ...(measure ? { measure } : {}),
    ...more,
  })
}

/**
 * A builder's variables mapped to fill (roadmap 49d), shape, size and labels (its mapping's or
 * mapped points').
 */
function appearanceOf(s: BuilderState): Pick<VariableMapping, 'fill' | 'shape' | 'size' | 'label'> {
  const from = s.mapping ?? s.layers.find((l) => l.geom === 'points' && l.aes)?.aes ?? {}
  const out: Pick<VariableMapping, 'fill' | 'shape' | 'size' | 'label'> = {}
  for (const f of ['fill', 'shape', 'size', 'label'] as const) if (from[f]) out[f] = from[f]
  return out
}

/**
 * The builder with a variable mapped to colour, shape, size or labels (none: unmapped). An XY
 * graph's points map it (`aes`); a graph of variables' mapping holds it, a text colour variable
 * making groups within the categories (`mapVariable`), a number one colouring each row's point.
 * A number colour variable starts on viridis with a colour bar in the legend (when the graph has
 * no colour scale yet).
 */
function mapAppearance(
  table: DataTable,
  s: BuilderState,
  field: Appearance,
  key: string | undefined,
): BuilderState {
  const number = !!key && !isText(table, key)
  // A number colour (roadmap 49d: or fill) starts on viridis with a colour bar.
  const colorScale =
    (field === 'color' || field === 'fill') && number && !s.scales?.[field]
      ? { scales: { ...s.scales, [field]: { colors: 'viridis' as const, bar: { show: true } } } }
      : {}
  if (!s.mapping) {
    if (histogramLayer(s))
      return field === 'color' && (!key || !number)
        ? builderReducer(table, s, { type: 'aes', field: 'color', key })
        : s
    if (s.frame !== 'xy' || !s.layers.some((l) => l.geom === 'points' && l.aes)) return s
    if (field === 'color') return { ...mapVariable(table, s, 'color', key), ...colorScale }
    return { ...builderReducer(table, s, { type: 'aes', field, key }), ...colorScale }
  }
  if (field === 'color') return { ...mapVariable(table, s, 'color', key), ...colorScale }
  const { [field]: _, ...rest } = s.mapping
  return { ...s, mapping: key ? { ...rest, [field]: key } : rest, custom: true }
}

/**
 * Roadmap 34g: the builder with its mapped points coloured by their local density (`colorBy`),
 * the colour variable dropped and the densest points drawn on top (unless an order is set), or
 * back to a colour variable's colours (none chosen).
 */
function withDensityColor(s: BuilderState, on: boolean): BuilderState {
  const at = s.layers.findIndex((l) => l.geom === 'points' && l.aes && l.stat.kind !== 'dotplot')
  if (at < 0 || s.frame !== 'xy') return s
  const points = s.layers[at] as Extract<Layer, { geom: 'points' }>
  const style = { ...points.style }
  const aes = { ...points.aes }
  if (on) {
    style.colorBy = 'density'
    style.order ??= 'value'
    delete aes.color
  } else {
    delete style.colorBy
    delete style.adjust
    if (style.order === 'value') delete style.order
  }
  const layer = { ...points, aes, style } as Layer
  const layers = s.layers.map((l, i) => (i === at ? layer : l))
  return { ...s, layers, custom: true }
}

/** Whether the builder's mapped points are coloured by their local density (roadmap 34g). */
export const densityColored = (s: Pick<BuilderState, 'layers'>): boolean =>
  s.layers.some(
    (l) =>
      l.geom === 'points' &&
      !!l.aes &&
      (l.style as { colorBy?: string } | undefined)?.colorBy === 'density',
  )

/** Layers moved between a category and a grouped frame: side by side there, at their slot here. */
function reframed(layers: readonly Layer[], from: Frame, to: Frame): Layer[] {
  if (from === to) return [...layers]
  return layers.map((l) => {
    const { position: p, ...rest } = l
    if (to === 'grouped' && !l.on && l.geom !== 'tile')
      return { ...rest, position: p?.kind === 'stack' ? p : { kind: 'dodge' } } as Layer
    return rest as Layer
  })
}

/** The builder drawing a graph of variables mapped as given (see `mapVariable`). */
function withMapping(table: DataTable, s: BuilderState, mapping: VariableMapping): BuilderState {
  const kind = matrixKindOf(table, { mapping })
  const frame: Frame =
    kind === 'mvTextText'
      ? s.frame === 'matrix'
        ? 'matrix'
        : 'grouped'
      : mapping.color && isText(table, mapping.color)
        ? 'grouped'
        : 'category'
  // The layers the new graph draws stay (with what is attached to them); a cells table's (roadmap
  // 34f) without those drawing a mark per row.
  let layers = reframed(s.layers, s.frame, frame)
  const check = checkLayers({ frame, layers }, kind, { raw: true })
  const cells = isCellsTable(table) ? { rows: table.rowCount } : null
  const perRow = (l: Layer) => !cellsAllowed(kind, frame, l.geom, l.stat.kind, cells).allowed
  for (const l of [...layers])
    if (!check.get(l.id)?.allowed || perRow(l)) layers = without(layers, l.id)
  const { note: _n, ...rest } = s
  const turned = turnedBy(table, mapping)
  const base = { ...rest, mapping, ...(turned !== undefined ? { horizontal: turned } : {}) }
  if (layers.length)
    return { ...base, frame, layers, look: lookFor(frame, layers, s.look), custom: true }
  const id =
    kind === 'mvTextText'
      ? frame === 'matrix'
        ? 'heatmap'
        : 'bars'
      : cells
        ? 'groupViolin'
        : 'groupBoxPoints'
  const spec = presetLayers(id, table, { mapping })!
  return {
    ...base,
    frame: spec.frame,
    look: spec.look,
    layers: spec.layers,
    preset: id,
    custom: false,
  }
}

/** The builder with X and Y both number variables: an XY graph of the rows (points mapped). */
function toScatter(
  table: DataTable,
  s: BuilderState,
  vars: { x: string; y: string; color?: string },
): BuilderState {
  // Shape, size and labels mapped on a graph of variables stay with the points (roadmap 34b).
  const kept = s.mapping ? appearanceOf(s) : {}
  const aes = (l: Layer): Layer => {
    if (!l.aes || l.geom !== 'points') return l
    const { x: _x, y: _y, color: _c, ...more } = l.aes
    return {
      ...l,
      aes: {
        ...more,
        ...kept,
        x: vars.x,
        y: vars.y,
        ...(vars.color ? { color: vars.color } : {}),
      },
    } as Layer
  }
  const { note: _n, mapping: _m, ...rest } = s
  if (s.frame === 'xy' && !s.mapping && s.layers.some((l) => l.geom === 'points' && l.aes))
    return { ...rest, layers: s.layers.map(aes), custom: true }
  const spec = presetLayers('bubble', table)!
  // The scatter: no bubble sizes until a size variable is chosen.
  const layers = spec.layers.map((l) => {
    if (!l.aes) return l
    const { size: _s, ...more } = l.aes
    return aes({ ...l, aes: more } as Layer)
  })
  return {
    ...rest,
    frame: spec.frame,
    look: spec.look,
    layers,
    preset: 'bubble',
    custom: true,
    horizontal: false,
  }
}

/** The builder with no variable on an axis: every variable as a column (a scatter of them). */
function toColumns(table: DataTable, s: BuilderState): BuilderState {
  if (!s.mapping && (s.frame === 'category' || s.frame === 'matrix')) return s
  // A cells table's columns are boxes, not every value (roadmap 34f).
  const id = isCellsTable(table) ? 'box' : 'points'
  const spec = presetLayers(id, table)!
  const { note: _n, mapping: _m, ...rest } = s
  return {
    ...rest,
    frame: spec.frame,
    look: spec.look,
    layers: spec.layers,
    preset: id,
    custom: false,
    horizontal: false,
  }
}

/**
 * The histogram a builder switches to (roadmap 34f): of the number variable the graph had on X
 * (else the preset's), grouped by its text colour variable.
 */
function histogramFrom(table: DataTable, from: BuilderState, next: BuilderState): BuilderState {
  const vars = axisVariables(from)
  const bin = histogramLayer(next)
  if (!bin) return next
  const x = vars.x && !isText(table, vars.x) ? vars.x : bin.aes?.x
  const color = vars.color && isText(table, vars.color) ? vars.color : undefined
  const layer = { ...variableHistogram(x, color), id: bin.id }
  return { ...next, layers: next.layers.map((l) => (l === bin ? layer : l)) }
}

/** The position new layers of a grouped list take (stacked lists: at the row's centre). */
function positionOf(s: BuilderState): Position {
  const g = groupsOf(s.layers)
  return g === 'aligned' || g === 'stack' || g === 'percent'
    ? { kind: 'aligned' }
    : { kind: 'dodge' }
}

/** The plot styles the builder shows for a table, each selected or not and allowed or why not. */
export function styleChoices(table: DataTable, s: BuilderState) {
  const c = styleContext(table, s.frame, s.layers, s.mapping)
  return stylesFor({ kind: c.kind, frame: s.frame }).map((style) => ({
    style,
    selected: style.frameChoice
      ? frameChoiceSelected(style, c)
      : s.layers.some((l) => styleOfLayer(l, s.frame)?.id === style.id),
    allowed: styleAllowed(style, c),
  }))
}

/**
 * The graph the builder makes with the orders of levels it keeps: its stored orders (roadmap 34a)
 * and the order of the levels it stores none of — natural for a new graph (roadmap 34f), the
 * graph's own when it changes one (absent, first appearance, for graphs made before).
 */
export function withBuilderLevels(g: GraphNode, s: BuilderState, graph?: GraphNode): GraphNode {
  let out = g
  if (s.levels !== (graph?.levels ?? undefined)) {
    const { levels: _, ...rest } = out
    out = s.levels && Object.keys(s.levels).length ? { ...rest, levels: s.levels } : rest
  }
  if (s.levelOrder !== (graph?.levelOrder ?? undefined)) {
    const { levelOrder: _, ...rest } = out
    out = s.levelOrder ? { ...rest, levelOrder: s.levelOrder } : rest
  }
  return out
}

/** What OK applies: the frame, look, layers and preset (provenance). */
export function builderChange(s: BuilderState): LayerChange {
  return {
    frame: s.frame,
    look: s.look,
    layers: s.layers,
    ...(s.preset ? { preset: s.preset } : {}),
    mapping: s.mapping ?? null,
  }
}

/** Layers whose matrix check fails (none after any builder step; a test checks). */
export function builderIssues(table: DataTable, s: BuilderState): string[] {
  const c = styleContext(table, s.frame, s.layers, s.mapping)
  return s.layers.flatMap((l) => {
    const st = styleOfLayer(l, s.frame)
    if (!st) return []
    const others = { ...c, layers: s.layers.filter((x) => x !== l) }
    const a = styleAllowed(st, others)
    return a.allowed ? [] : [`${l.id}: ${a.reason}`]
  })
}

/** What the builder makes a graph of (`builtGraph`). */
export interface BuildInput {
  s: BuilderState
  /** The graph's table. */
  table: DataTable
  /** The table laid out of (a big table's sample in the preview; default `table`). */
  from?: DataTable
  /** The graph changed (Change layers) or copied (Duplicate as…); absent: a new graph. */
  graph?: GraphNode
  name: string
  /** A new graph's data sets and (grouped, contingency and XY tables) rows chosen. */
  dataSets: readonly string[]
  rows: readonly number[]
  rowsAvailable: readonly number[]
}

/** Tables whose rows a new graph can draw some of. */
export const sliceableKind = (table: DataTable): boolean =>
  table.tableKind === 'grouped' || table.tableKind === 'contingency' || table.tableKind === 'xy'

/**
 * The graph the builder makes (Create, Duplicate as…) or changes (Change layers) of its state:
 * its layers with the looks new layers start with (`newGraphNode`, `withLayers`:
 * `newLayerLooks`).
 */
export function builtGraph(input: BuildInput): GraphNode {
  const { s, table, graph, name, dataSets, rows, rowsAvailable } = input
  const from = input.from ?? table
  const sliceable = sliceableKind(table)
  const turnable = s.frame === 'category' || s.frame === 'grouped'
  const change = builderChange(s)
  let g = graph ? withLayers(graph, change, from) : newGraphNode(from, change, name)
  if (!graph) {
    const allSets = dataSets.length === table.dataSets.length
    const allRows =
      !sliceable ||
      (rows.length === rowsAvailable.length && rows.every((r, i) => r === rowsAvailable[i]))
    g = {
      ...g,
      seriesSource: {
        table: table.id,
        include: allSets ? 'all' : [...dataSets],
        ...(allRows ? {} : { rows: [...rows] }),
      },
    }
  }
  if (turnable || graph?.style.orientation) g = withOrientation(g, s.horizontal)
  // Roadmap 36: a new graph of an embedding's two axes (UMAP_1 by UMAP_2) draws corner arrows.
  if (!graph && g.frame === 'xy') {
    const v = axisVariables(s)
    const titleOf = (k: string | undefined) => table.dataSets.find((d) => d.id === k)?.title ?? ''
    if (v.x && v.y && isEmbeddingPair(titleOf(v.x), titleOf(v.y)))
      g = { ...g, style: { ...g.style, frame: 'arrows' } }
  }
  if (s.drawOrder) g = { ...g, drawOrder: s.drawOrder }
  if (s.scales) g = { ...g, scales: { ...g.scales, ...s.scales } }
  // Roadmap 49a: a user preset's cycles of symbols and line patterns.
  if (s.shapes) g = { ...g, style: { ...g.style, shapes: s.shapes } }
  if (s.dashes) g = { ...g, style: { ...g.style, dashes: s.dashes } }
  // Roadmap 49d: a user preset's fill colours by data set.
  if (s.fillPalette) g = { ...g, style: { ...g.style, fillPalette: s.fillPalette } }
  return withBuilderLevels(g, s, graph)
}

/**
 * The graph the builder's preview draws: the graph Create makes (`builtGraph`) as the document
 * holds it once made — a new graph with its project's style's axis frames and legend place, as
 * `node.add` (fresh) gives it — under the id it is laid out with (fix after 0.3.7, decision 1274:
 * the preview shows what Create makes).
 */
export function builderPreviewGraph(
  input: BuildInput,
  settings: Pick<ProjectSettings, 'theme' | 'style'>,
): GraphNode {
  const g = builtGraph(input)
  if (input.graph) return { ...g, id: input.graph.id }
  return { ...styledNewGraph(g, settings), id: 'builderPreview' as NodeId }
}
