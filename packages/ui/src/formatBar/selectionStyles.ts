import type { Command } from '@ps/engine'
import {
  graphPalette,
  graphText,
  graphTheme,
  INSET_TABLE_SIZE,
  identityStyle,
  layerStyle,
  pointOverride,
  RESULT_THEME,
  resolveColor,
  resolveText,
  resultLineBase,
  type StylePath,
  seriesColor,
  TABLE_TEXT_SIZE,
  type Theme,
} from '@ps/graph'
import {
  type ColorRef,
  type FillStyle,
  type FontId,
  type GraphNode,
  type GraphPathSegment,
  type Layer,
  type LayoutItem,
  type LayoutNode,
  labelRuns,
  layerData,
  type NodeId,
  type Project,
  type ResultLookup,
  type RichLabel,
  type RichText,
  type StrokeStyle,
  type SymbolShape,
  seriesShown,
  statOf,
  styleSections,
  type TextStyle,
  toLabel,
} from '@ps/model'
import { singleMarkName } from '../graph/format/route.ts'
import { graphSeries, styleCommands } from '../graph/inspector/layers.ts'
import { resetPaths } from '../graph/selectionEdits.ts'
import { clearRunFields, stepSize } from '../richText/model.ts'
import type { Selection, SelKey } from '../selection/selection.ts'

// Roadmap 45 (the format bar): what each selected thing can be formatted with and where its
// formats live in the document. Pure: a selection (stage 44's keys: a graph's elements, a page's
// items, parts of graphs on a page) gives targets — each with its text style, fill, line and
// symbols as drawn (the effective style: theme ← graph base text ← the element's own) and the
// paths a change writes, sparse (decision 531: only the field changed; "Automatic" writes
// undefined), in layer paths (`['layers', { id }, …]`) and identity paths
// (`['seriesOverrides', key, …]`). The bar shows the values (mixed where the targets differ)
// and dispatches the commands these functions make, one undo step per change.

/** The groups of the bar, and what a target offers. */
export type Capability = 'text' | 'fill' | 'line' | 'mark' | 'position'
export const CAPABILITIES: readonly Capability[] = ['text', 'fill', 'line', 'mark', 'position']

/** Where a text style lives: a partial `TextStyle` at `path` of node `node`. */
export interface TextSlot {
  node: NodeId
  path: GraphPathSegment[]
  /** What the element draws without its own values (theme ← the graph's base text). */
  base: TextStyle
  /** Its own values. */
  own: Partial<TextStyle>
  /** The palette its colours resolve against. */
  palette: readonly string[]
  /** Its rich text, whose run-level font, size, colour, bold and italic a bar change clears. */
  runs?: { path: GraphPathSegment[]; value: RichText; label: boolean }
}

/**
 * A fill: a `FillStyle` at `path` (absent: `none` or the default), or a data set's colour, its
 * identity's (`['seriesOverrides', key, 'color']`).
 */
export type FillSlot =
  | {
      kind: 'fill'
      node: NodeId
      path: GraphPathSegment[]
      value: FillStyle | undefined
      /** The colour drawn (null: none). */
      shown: string | null
      palette: readonly string[]
    }
  | {
      kind: 'identity'
      node: NodeId
      key: string
      /**
       * Where the colour lives when not the data set's identity (roadmap 47: a point's own,
       * `['pointOverrides', key, point, 'color']`); Automatic follows the data set.
       */
      path?: GraphPathSegment[]
      value: ColorRef | undefined
      shown: string
      palette: readonly string[]
    }

/**
 * A line: a stroke at `path`, either partial (axis lines, brackets: fields written one by one) or
 * whole (borders and lines: the whole stroke written; an optional one may be removed).
 */
export interface LineSlot {
  node: NodeId
  path: GraphPathSegment[]
  partial: boolean
  /** Removing it is allowed (a border, an outline). */
  optional: boolean
  /** As drawn (null: none). */
  shown: StrokeStyle | null
  /** What a new stroke starts from when there is none. */
  fallback: StrokeStyle
  palette: readonly string[]
  /** The colour "same as the data set" draws in (a point's border: the point's colour). */
  seriesCss?: string
  /**
   * Audit 3 (U6): a layer's line (its `field`, for one data set or — `key` null — all, each
   * data set's own then dropped), written through the layer's style commands.
   */
  layerField?: { graph: GraphNode; layer: Layer; key: string | null; field: string }
}

/**
 * The symbols of a points layer, for one data set (`key`) or every one (null); roadmap 47: of one
 * point of data set `key` (`point`), written at its own override.
 */
export interface MarkSlot {
  node: NodeId
  graph: GraphNode
  layer: Layer
  key: string | null
  point?: string
  shape: SymbolShape
  size: number
  /** Audit 3 (U6): the symbols' size is a mapped variable's (the bar's size can't change it). */
  sizeMapped?: boolean
}

/** One selected thing, as the bar sees it. */
export interface Target {
  /** The key it comes from (null: the graph itself, nothing selected on its canvas). */
  key: SelKey | null
  text?: TextSlot
  fill?: FillSlot
  line?: LineSlot
  mark?: MarkSlot
  /** Its position can be reset (it was moved): the paths cleared. */
  position?: { node: NodeId; paths: StylePath[] }
  /**
   * A data set (a layer's marks of one, or its identity): what Paste format treats as one, with
   * the layer it was selected in.
   */
  dataSet?: { node: NodeId; key: string; graph: GraphNode; layer?: Layer }
  /** Roadmap 47b: a legend (itself, not an entry): its grid's layout, the bar's Layout group. */
  legend?: { node: NodeId; graph: GraphNode }
}

/** What resolving a selection needs. */
export interface StylesContext {
  project: Project
  lookup?: ResultLookup
  /** Nothing selected on this graph's canvas: the graph's base text (`style.text`). */
  graph?: NodeId
}

const BLACK_LINE: StrokeStyle = { color: { rgb: '#000000' }, width: 1, dash: 'solid' }

/** A text slot's own values (only those set). */
const ownOf = (o: Partial<TextStyle> | undefined): Partial<TextStyle> => {
  const out: Partial<TextStyle> = {}
  for (const [k, v] of Object.entries(o ?? {}))
    if (v !== undefined) (out as Record<string, unknown>)[k] = v
  return out
}

const fillShown = (f: FillStyle | undefined, palette: readonly string[]): string | null =>
  f?.type === 'solid' ? resolveColor(f.color, palette) : null

const strokeShown = (
  s: Partial<StrokeStyle> | undefined,
  base: StrokeStyle | null,
): StrokeStyle | null => (base ? { ...base, ...ownOfStroke(s) } : s ? (s as StrokeStyle) : null)

const ownOfStroke = (s: Partial<StrokeStyle> | undefined): Partial<StrokeStyle> => {
  const out: Partial<StrokeStyle> = {}
  for (const [k, v] of Object.entries(s ?? {}))
    if (v !== undefined) (out as Record<string, unknown>)[k] = v
  return out
}

/** The targets of an element of `graph` (its own canvas, or placed on a page). */
export function elementTarget(
  project: Project,
  graph: GraphNode,
  path: StylePath,
  key: SelKey | null,
  lookup?: ResultLookup,
): Target {
  const theme = graphTheme(project, graph)
  const palette = graphPalette(graph, theme)
  const node = graph.id
  const t: Target = { key }
  const text = (
    p: GraphPathSegment[],
    base: TextStyle,
    own: Partial<TextStyle> | undefined,
    runs?: TextSlot['runs'],
  ): TextSlot => ({
    node,
    path: p,
    base: graphText(base, graph),
    own: ownOf(own),
    palette,
    ...(runs ? { runs } : {}),
  })
  const resets = resetPaths(graph, [path])
  if (resets.length) t.position = { node, paths: resets }
  const [head, second, third] = path
  switch (head) {
    case 'title':
      if (graph.title)
        t.text = text(['title', 'style'], theme.graphTitle, graph.title.style, {
          path: ['title', 'content'],
          value: graph.title.content,
          label: false,
        })
      break
    case 'axes': {
      const a = String(second) as 'x' | 'y' | 'y2'
      const axis = graph.axes[a]
      if (!axis) break
      if (third === 'title') {
        if (axis.title)
          t.text = text(['axes', a, 'title', 'style'], theme.axisTitle, axis.title.style, {
            path: ['axes', a, 'title', 'content'],
            value: axis.title.content,
            label: false,
          })
      } else if (third === 'tickLabels' || third === undefined) {
        t.text = text(['axes', a, 'tickLabels'], theme.tickLabel, axis.tickLabels)
        if (third === undefined)
          t.line = {
            node,
            path: ['axes', a, 'line'],
            partial: true,
            optional: false,
            shown: strokeShown(axis.line, theme.axisLine),
            fallback: theme.axisLine,
            palette,
          }
      }
      break
    }
    case 'legend': {
      const l = graph.legend
      if (path.length === 1) t.legend = { node, graph }
      t.text = text(['legend', 'text'], theme.legend, l.text)
      t.fill = {
        kind: 'fill',
        node,
        path: ['legend', 'background'],
        value: l.background,
        shown: fillShown(l.background, palette),
        palette,
      }
      t.line = {
        node,
        path: ['legend', 'border'],
        partial: false,
        optional: true,
        shown: l.border ?? null,
        fallback: BLACK_LINE,
        palette,
      }
      break
    }
    case 'annotations': {
      const i = Number(second)
      const a = graph.annotations[i]
      if (!a) break
      const at = (...rest: GraphPathSegment[]): GraphPathSegment[] => ['annotations', i, ...rest]
      if (a.type === 'text') {
        t.text = text(at('content', 'style'), theme.text, a.content.style, {
          path: at('content', 'content'),
          value: a.content.content,
          label: false,
        })
        t.fill = {
          kind: 'fill',
          node,
          path: at('background'),
          value: a.background,
          shown: fillShown(a.background, palette),
          palette,
        }
        t.line = {
          node,
          path: at('border'),
          partial: false,
          optional: true,
          shown: a.border ?? null,
          fallback: BLACK_LINE,
          palette,
        }
      } else if (a.type === 'table') {
        t.text = text(at('text'), { ...theme.text, size: INSET_TABLE_SIZE }, a.text)
        t.fill = {
          kind: 'fill',
          node,
          path: at('background'),
          value: a.background,
          shown: fillShown(a.background, palette) ?? '#ffffff',
          palette,
        }
      } else if (a.type === 'line') {
        t.line = {
          node,
          path: at('stroke'),
          partial: false,
          optional: false,
          shown: a.stroke,
          fallback: a.stroke,
          palette,
        }
      } else if (a.type === 'bracket') {
        // Brackets' text and line are the graph's (Format bracket › All brackets).
        const b = graph.style.bracket ?? {}
        t.text = text(
          ['style', 'bracket', 'label'],
          theme.bracket.label,
          b.label,
          a.label.source === 'manual'
            ? { path: at('label', 'text'), value: labelRuns(a.label.text), label: true }
            : undefined,
        )
        t.line = {
          node,
          path: ['style', 'bracket', 'line'],
          partial: true,
          optional: false,
          shown: strokeShown(b.line, theme.bracket.line),
          fallback: theme.bracket.line,
          palette,
        }
      }
      break
    }
    case 'layers': {
      const layer = graph.layers.find((l) => l.id === String(second))
      if (!layer) break
      const k = third === 'series' && path[3] !== undefined ? String(path[3]) : null
      if (k !== null) {
        t.dataSet = { node, key: k, graph, layer }
        // Audit 3 (U6): the data set's colour only where it reaches what the layer draws.
        if (identityReaches(theme, graph, layer, k))
          t.fill = identityFill(project, graph, theme, k, lookup)
      }
      if (layer.geom === 'points') {
        const s = layerStyle(theme, graph, layer, k ?? '', statOf(layer, k ?? ''))
        t.mark = {
          node,
          graph,
          layer,
          key: k,
          shape: s.points.shape,
          size: s.points.size,
          ...(layer.aes?.size !== undefined || layer.stat.kind === 'dotplot'
            ? { sizeMapped: true }
            : {}),
        }
      }
      // Audit 3 (U6): the lines a layer draws (a line, error bars, a centre line): its Line.
      const lineField = LINE_FIELDS[layer.geom]
      const at = lineField && styleSections(layer)[lineField]
      if (at) {
        const s = layerStyle(theme, graph, layer, k ?? '', statOf(layer, k ?? ''))
        const stroke = (s[at[0]] as unknown as Record<string, StrokeStyle | undefined>)[at[1]]
        if (stroke)
          t.line = {
            node,
            path:
              k === null
                ? ['layers', { id: layer.id }, 'style', lineField]
                : ['layers', { id: layer.id }, 'series', k, 'style', lineField],
            partial: false,
            optional: false,
            shown: stroke,
            fallback: stroke,
            palette,
            seriesCss: resolveColor(
              s.color,
              palette,
              k === null
                ? undefined
                : (identityFill(project, graph, theme, k, lookup).shown ?? undefined),
            ),
            layerField: { graph, layer, key: k, field: lineField },
          }
      }
      // Roadmap 46b: a result's reference line (an identity line, a line at a value) as a whole:
      // its line, written whole (a layer's line style is a whole stroke).
      if (layer.geom === 'refline' && layer.stat.kind === 'result' && k === null) {
        const base = resultLineBase(theme, layer as Parameters<typeof resultLineBase>[1])
        const own = (layer.style as { line?: Partial<StrokeStyle> } | undefined)?.line
        const drawn: StrokeStyle = {
          ...base,
          color: 'series' in base.color ? { rgb: RESULT_THEME.grey } : base.color,
        }
        t.line = {
          node,
          path: ['layers', { id: layer.id }, 'style', 'line'],
          partial: false,
          optional: false,
          shown: strokeShown(own, drawn),
          fallback: drawn,
          palette,
        }
      }
      break
    }
    case 'pointOverrides':
      if (third !== undefined)
        pointSlots(t, project, graph, theme, String(second), String(third), lookup)
      break
    case 'seriesOverrides':
      if (second !== undefined && path.length === 2) {
        const k = String(second)
        t.dataSet = { node, key: k, graph }
        // Audit 3 (U6): its colour where a layer drawing it draws in it (else no Colour): its
        // marks' layers decide, bands and areas (shading under or round them) only alone.
        const all = graph.layers.filter((l) => drawsSeries(graph, l, k))
        const marks = all.filter((l) => l.geom !== 'band' && l.geom !== 'area')
        const drawing = marks.length ? marks : all
        if (!drawing.length || drawing.some((l) => identityReaches(theme, graph, l, k)))
          t.fill = identityFill(project, graph, theme, k, lookup)
      }
      break
    case 'style':
      if (second === 'background' || second === 'plotBackground') {
        const f = graph.style[second]
        t.fill = {
          kind: 'fill',
          node,
          path: ['style', second],
          value: f,
          shown: fillShown(f, palette) ?? (second === 'background' ? '#ffffff' : null),
          palette,
        }
      }
      break
  }
  return t
}

/**
 * Roadmap 47: a single point's formats, at its own override (`pointOverrides[key][point]`, what
 * the point's Format panel writes): its colour (the bar's fill), its border, and a symbol's shape
 * and size; a bar's or box's border is the bar's or box's own (`…bar.border`); a slice has its
 * colour only. Each as drawn: its own over the layer drawing it (its data set's).
 */
function pointSlots(
  t: Target,
  project: Project,
  graph: GraphNode,
  theme: Theme,
  key: string,
  point: string,
  lookup?: ResultLookup,
): void {
  const node = graph.id
  const palette = graphPalette(graph, theme)
  const at = (...rest: GraphPathSegment[]): GraphPathSegment[] => [
    'pointOverrides',
    key,
    point,
    ...rest,
  ]
  const own = pointOverride(graph, key, point) ?? {}
  const kind = singleMarkName(graph, point)
  const geoms: readonly Layer['geom'][] =
    kind === 'bar' ? ['bar'] : kind === 'box' ? ['box', 'violin'] : ['points']
  const layer = graph.layers.find((l) => geoms.includes(l.geom) && l.visible !== false)
  const style = layer ? layerStyle(theme, graph, layer, key, statOf(layer, key)) : null
  const dataSet = identityFill(project, graph, theme, key, lookup).shown ?? '#000000'
  const base = !style || 'series' in style.color ? dataSet : resolveColor(style.color, palette)
  const shown = own.color ? resolveColor(own.color, palette, base) : base
  t.fill = { kind: 'identity', node, key, path: at('color'), value: own.color, shown, palette }
  if (kind === 'slice' || !style) return
  const mark = kind === 'bar' || kind === 'box' ? kind : null
  const border = mark
    ? (own[mark]?.border ?? style[mark].border)
    : (own.border ?? style.points.border)
  t.line = {
    node,
    path: mark ? at(mark, 'border') : at('border'),
    partial: false,
    optional: false,
    shown: border,
    fallback: border,
    palette,
    seriesCss: shown,
  }
  if (!mark && layer)
    t.mark = {
      node,
      graph,
      layer,
      key,
      point,
      shape: own.shape ?? style.points.shape,
      size: own.size ?? style.points.size,
    }
}

/**
 * Audit 3 (U6): the style field holding the line a layer's geom draws (the bar's Line group):
 * its own stroke (a line, a step), an error bar's, a centre line's, a connector's.
 */
const LINE_FIELDS: Partial<Record<Layer['geom'], string>> = {
  line: 'stroke',
  step: 'stroke',
  errorbar: 'line',
  center: 'line',
  connector: 'line',
}

/**
 * Stats whose marks take colours of their own: categories (a pie's), expression (a dot plot's),
 * classes (Significance), values on a colour scale (cells, hexagons, densities).
 */
const OWN_COLOR_STATS = new Set(['fraction', 'dotplot', 'threshold', 'cell', 'hexbin', 'density2d'])

/**
 * Audit 3 (U6): whether a data set's colour (its identity's) is what a layer draws it in — not
 * where its marks have a colour of their own (a line, error bars, a centre line in theirs), a
 * mapped variable colours them, or the stat does (a pie's categories, a dot plot's expression,
 * Significance classes); labels are text.
 */
function identityReaches(theme: Theme, graph: GraphNode, layer: Layer, key: string): boolean {
  if (layer.geom === 'wedge' || layer.geom === 'label') return false
  if (OWN_COLOR_STATS.has(layer.stat.kind) || layer.aes?.color !== undefined) return false
  const s = layerStyle(theme, graph, layer, key, statOf(layer, key))
  const lineField = LINE_FIELDS[layer.geom]
  const at = lineField && styleSections(layer)[lineField]
  const solid = (f: FillStyle | null | undefined) => (f?.type === 'solid' ? f.color : undefined)
  const color: ColorRef | undefined =
    layer.geom === 'points'
      ? (solid(s.points.fill) ?? s.points.border?.color)
      : layer.geom === 'bar'
        ? solid(s.bar.fill)
        : layer.geom === 'box' || layer.geom === 'violin'
          ? (solid(s.box.fill) ?? s.box.border?.color)
          : at
            ? (s[at[0]] as unknown as Record<string, StrokeStyle | undefined>)[at[1]]?.color
            : undefined
  return !color || 'series' in color
}

/** Whether a layer draws the series `key` (shown): its outputs', functions' or the table's. */
function drawsSeries(graph: GraphNode, layer: Layer, key: string): boolean {
  if (layer.visible === false || !seriesShown(layer, key)) return false
  const d = layerData(graph, layer)
  if (d.from === 'outputs') return d.series.some((s) => s.id === key)
  if (d.from === 'functions') return d.functions.some((f) => f.id === key)
  if (d.from !== 'table') return false
  // A table's data set: not a curve of the graph's.
  return !graph.layers.some(
    (l) =>
      (l.data?.from === 'outputs' && l.data.series.some((s) => s.id === key)) ||
      (l.data?.from === 'functions' && l.data.functions.some((f) => f.id === key)),
  )
}

/** A data set's colour (its identity's), as drawn. */
function identityFill(
  project: Project,
  graph: GraphNode,
  theme: Theme,
  key: string,
  lookup?: ResultLookup,
): FillSlot {
  const series = graphSeries(project, graph, lookup)
  const dataSets = series.filter((s) => s.kind === 'dataSet').length
  const item = series.find((s) => s.key === key)
  const curve = !!item && item.kind !== 'dataSet'
  const id = identityStyle(theme, graph, key, curve)
  const index = !item ? 0 : item.kind === 'dataSet' ? item.index : dataSets + item.index
  const palette = graphPalette(graph, theme)
  return {
    kind: 'identity',
    node: graph.id,
    key,
    value: graph.seriesOverrides[key]?.color,
    shown: seriesColor(id.color, palette, index),
    palette,
  }
}

/** The graph's base text (nothing selected on its canvas, or a graph item on a page). */
export function graphBaseTarget(project: Project, graph: GraphNode, key: SelKey | null): Target {
  const theme = graphTheme(project, graph)
  return {
    key,
    text: {
      node: graph.id,
      path: ['style', 'text'],
      base: theme.text,
      own: ownOf(graph.style.text),
      palette: graphPalette(graph, theme),
    },
  }
}

/** A page item's target. */
export function itemTarget(project: Project, layout: LayoutNode, item: LayoutItem, key: SelKey) {
  const theme = graphTheme(project)
  const palette = theme.palette
  const node = layout.id
  const at = (...rest: GraphPathSegment[]): GraphPathSegment[] => [
    'items',
    { id: item.id },
    ...rest,
  ]
  const t: Target = { key }
  switch (item.type) {
    case 'graph': {
      const g = project.nodes[item.graph]
      return g?.kind === 'graph' ? graphBaseTarget(project, g, key) : t
    }
    case 'text':
      t.text = {
        node,
        path: at('content', 'style'),
        base: theme.text,
        own: ownOf(item.content.style),
        palette,
        runs: { path: at('content', 'content'), value: item.content.content, label: false },
      }
      t.fill = {
        kind: 'fill',
        node,
        path: at('background'),
        value: item.background,
        shown: fillShown(item.background, palette),
        palette,
      }
      t.line = {
        node,
        path: at('border'),
        partial: false,
        optional: true,
        shown: item.border ?? null,
        fallback: BLACK_LINE,
        palette,
      }
      break
    case 'table':
      t.text = {
        node,
        path: at('text'),
        base: { ...theme.text, size: TABLE_TEXT_SIZE },
        own: ownOf(item.text),
        palette,
      }
      break
    case 'shape':
      t.fill = {
        kind: 'fill',
        node,
        path: at('fill'),
        value: item.fill,
        shown: fillShown(item.fill, palette),
        palette,
      }
      t.line = {
        node,
        path: at('stroke'),
        partial: false,
        optional: true,
        shown: item.stroke ?? null,
        fallback: BLACK_LINE,
        palette,
      }
      break
    case 'line':
      t.line = {
        node,
        path: at('stroke'),
        partial: false,
        optional: false,
        shown: item.stroke,
        fallback: item.stroke,
        palette,
      }
      break
    case 'image':
      t.line = {
        node,
        path: at('border'),
        partial: false,
        optional: true,
        shown: item.border ?? null,
        fallback: BLACK_LINE,
        palette,
      }
      break
  }
  return t
}

/** The target of one selection key (null when what it names is gone). */
export function keyTarget(ctx: StylesContext, k: SelKey): Target | null {
  const { project } = ctx
  if (k.kind === 'element') {
    const g = project.nodes[k.graph]
    return g?.kind === 'graph' ? elementTarget(project, g, k.path, k, ctx.lookup) : null
  }
  const layout = project.nodes[k.layout]
  if (layout?.kind !== 'layout') return null
  const item = layout.items.find((it) => it.id === k.item)
  if (!item) return null
  if (k.kind === 'item') return itemTarget(project, layout, item, k)
  if (item.type !== 'graph') return null
  const g = project.nodes[item.graph]
  return g?.kind === 'graph' ? elementTarget(project, g, k.path, k, ctx.lookup) : null
}

/**
 * The targets of a selection, in its order; nothing selected on a graph's canvas (`ctx.graph`):
 * the graph's base text.
 */
export function selectionTargets(ctx: StylesContext, sel: Selection): Target[] {
  if (!sel.keys.length) {
    const g = ctx.graph ? ctx.project.nodes[ctx.graph] : undefined
    return g?.kind === 'graph' ? [graphBaseTarget(ctx.project, g, null)] : []
  }
  return sel.keys.flatMap((k) => keyTarget(ctx, k) ?? [])
}

/** What a target offers. */
export function capabilitiesOf(t: Target): Set<Capability> {
  const out = new Set<Capability>()
  if (t.text) out.add('text')
  if (t.fill) out.add('fill')
  if (t.line) out.add('line')
  if (t.mark) out.add('mark')
  if (t.position) out.add('position')
  return out
}

/**
 * The groups the bar enables: what every target offers (the intersection), but Reset position,
 * which acts on whichever targets were moved.
 */
export function sharedCapabilities(targets: readonly Target[]): Set<Capability> {
  if (!targets.length) return new Set()
  const sets = targets.map(capabilitiesOf)
  const out = new Set<Capability>(
    CAPABILITIES.filter((c) => c !== 'position' && sets.every((s) => s.has(c))),
  )
  if (sets.some((s) => s.has('position'))) out.add('position')
  return out
}

// ---- Values shown --------------------------------------------------------------------------------

/** A value the targets share, or mixed (then `value` is the first one's). */
export interface Field<T> {
  value: T
  mixed: boolean
}

function shared<T>(values: readonly T[], key: (v: T) => string = (v) => JSON.stringify(v)) {
  const value = values[0] as T
  const first = key(value)
  return { value, mixed: values.some((v) => key(v) !== first) }
}

/** A text style's colour as drawn (CSS), and its own reference (undefined: automatic). */
export interface ShownColor {
  css: string
  ref: ColorRef | undefined
}

export interface TextValues {
  font: Field<FontId>
  size: Field<number>
  bold: Field<boolean>
  italic: Field<boolean>
  color: Field<ShownColor>
}

type TextField = 'font' | 'size' | 'bold' | 'italic' | 'color'
const TEXT_FIELDS: readonly TextField[] = ['font', 'size', 'bold', 'italic', 'color']

/** An element's resolved text style (its runs aside). */
export const slotStyle = (s: TextSlot): TextStyle => resolveText(s.base, s.own)

/**
 * What a text slot draws of each field: one value per run with text, the run's own over the
 * element's (a title whose words differ in size is mixed); the element's when it has no runs.
 */
function drawnValues(s: TextSlot): Record<TextField, unknown[]> {
  const style = slotStyle(s)
  const runs = (s.runs?.value ?? []).filter((r) => r.text !== '')
  const out = {} as Record<TextField, unknown[]>
  for (const f of TEXT_FIELDS) {
    const el = f === 'color' ? resolveColor(style.color, s.palette) : style[f]
    out[f] = runs.length
      ? runs.map((r) => {
          const own = r[f]
          if (own === undefined) return el
          return f === 'color' ? resolveColor(own as ColorRef, s.palette) : own
        })
      : [el]
  }
  return out
}

/** The text values the bar shows for these slots (mixed where they or their runs differ). */
export function textValues(slots: readonly TextSlot[]): TextValues | null {
  if (!slots.length) return null
  const drawn = slots.map(drawnValues)
  const all = <T>(f: TextField) => drawn.flatMap((d) => d[f] as T[])
  const colors = all<string>('color')
  const color = shared(colors, (c) => c.toLowerCase())
  return {
    font: shared(all<FontId>('font')),
    size: shared(all<number>('size')),
    bold: shared(all<boolean>('bold')),
    italic: shared(all<boolean>('italic')),
    color: {
      value: { css: color.value, ref: slots[0]!.own.color ?? undefined },
      mixed: color.mixed,
    },
  }
}

/** The fill colour shown (CSS, null: none). */
export function fillValue(slots: readonly FillSlot[]): Field<string | null> | null {
  if (!slots.length) return null
  return shared(
    slots.map((s) => s.shown),
    (c) => (c === null ? 'none' : c.toLowerCase()),
  )
}

export interface LineValues {
  /** CSS colour (null: no line). */
  color: Field<string | null>
  width: Field<number | null>
  dash: Field<StrokeStyle['dash'] | null>
}

export function lineValues(slots: readonly LineSlot[]): LineValues | null {
  if (!slots.length) return null
  return {
    color: shared(
      slots.map((s) => (s.shown ? resolveColor(s.shown.color, s.palette, s.seriesCss) : null)),
      (c) => (c === null ? 'none' : c.toLowerCase()),
    ),
    width: shared(slots.map((s) => s.shown?.width ?? null)),
    dash: shared(slots.map((s) => s.shown?.dash ?? null)),
  }
}

export interface MarkValues {
  shape: Field<SymbolShape>
  size: Field<number>
  /** Audit 3 (U6): a mapped variable sizes some of them (the bar's size is off). */
  sizeMapped: boolean
}

export function markValues(slots: readonly MarkSlot[]): MarkValues | null {
  if (!slots.length) return null
  return {
    shape: shared(slots.map((s) => s.shape)),
    size: shared(slots.map((s) => s.size)),
    sizeMapped: slots.some((s) => s.sizeMapped),
  }
}

/** Every slot of one kind across the targets. */
export const textSlots = (ts: readonly Target[]) => ts.flatMap((t) => (t.text ? [t.text] : []))
export const fillSlots = (ts: readonly Target[]) => ts.flatMap((t) => (t.fill ? [t.fill] : []))
export const lineSlots = (ts: readonly Target[]) => ts.flatMap((t) => (t.line ? [t.line] : []))
export const markSlots = (ts: readonly Target[]) => ts.flatMap((t) => (t.mark ? [t.mark] : []))

// ---- Changes ----------------------------------------------------------------------------------

const set = (node: NodeId, path: GraphPathSegment[], value: unknown): Command => ({
  type: 'node.set',
  id: node,
  path,
  value,
})

/** What to store for cleared runs: runs for a text spec; a label as a string when plain. */
const storedRuns = (runs: RichText, label: boolean): RichText | RichLabel =>
  label ? toLabel(runs) : runs

/**
 * Sets text fields on every slot (sparse: each field its own path; `undefined` = Automatic,
 * the field removed), and clears them from the slots' runs in the same step (the user's choice:
 * the whole element follows the bar). `patch` may give a value per slot (grow / shrink).
 */
export function textCommands(
  slots: readonly TextSlot[],
  patch:
    | Partial<Record<TextField, unknown>>
    | ((s: TextSlot) => Partial<Record<TextField, unknown>>),
): Command[] {
  const out: Command[] = []
  for (const s of slots) {
    const p = typeof patch === 'function' ? patch(s) : patch
    const fields = Object.keys(p) as TextField[]
    for (const f of fields) {
      const v = p[f]
      if (v === undefined ? s.own[f] === undefined : JSON.stringify(s.own[f]) === JSON.stringify(v))
        continue
      out.push(set(s.node, [...s.path, f], v))
    }
    if (s.runs) {
      const cleared = clearRunFields(s.runs.value, fields)
      if (cleared !== s.runs.value)
        out.push(set(s.node, s.runs.path, storedRuns(cleared, s.runs.label)))
    }
  }
  return out
}

/** A font size a step up or down from each slot's own (as drawn), runs cleared. */
export const stepCommands = (slots: readonly TextSlot[], dir: 1 | -1): Command[] =>
  textCommands(slots, (s) => ({ size: stepSize(drawnSize(s), dir) }))

/** The size a slot draws at (its runs' largest when they differ, as Word's grow reads). */
function drawnSize(s: TextSlot): number {
  const sizes = drawnValues(s).size as number[]
  return Math.max(...sizes)
}

/** Bold or italic toggled for all: off when every slot has it, else on. */
export function toggleCommands(slots: readonly TextSlot[], f: 'bold' | 'italic'): Command[] {
  const v = textValues(slots)
  if (!v) return []
  const on = v[f].mixed || !v[f].value
  return textCommands(slots, { [f]: on })
}

/**
 * A fill colour for every slot: a data set's identity colour; a fill made solid in it (its
 * opacity kept); `undefined`: Automatic (the colour or fill removed).
 */
export function fillCommands(slots: readonly FillSlot[], color: ColorRef | undefined): Command[] {
  return slots.flatMap((s): Command[] => {
    if (s.kind === 'identity')
      return [set(s.node, s.path ?? ['seriesOverrides', s.key, 'color'], color)]
    if (color === undefined) return s.value === undefined ? [] : [set(s.node, s.path, undefined)]
    const opacity = s.value?.type === 'solid' ? s.value.opacity : 1
    return [set(s.node, s.path, { type: 'solid', color, opacity })]
  })
}

/**
 * Stroke fields for every slot: partial strokes field by field; whole ones written whole (from
 * what they draw, or a thin black line when they have none). `null`: no line (removed where
 * that is allowed).
 */
export function lineCommands(
  slots: readonly LineSlot[],
  patch: Partial<StrokeStyle> | null,
): Command[] {
  return slots.flatMap((s): Command[] => {
    if (patch === null) return s.optional && s.shown ? [set(s.node, s.path, undefined)] : []
    if (s.partial) return Object.entries(patch).map(([f, v]) => set(s.node, [...s.path, f], v))
    const l = s.layerField
    if (l)
      return styleCommands(l.graph, l.layer, l.key, [
        [l.field, { ...(s.shown ?? s.fallback), ...patch }],
      ])
    return [set(s.node, s.path, { ...(s.shown ?? s.fallback), ...patch })]
  })
}

/** Symbol shape or size for every slot (its layer's data set, or the whole layer). */
export function markCommands(
  slots: readonly MarkSlot[],
  patch: { shape?: SymbolShape; size?: number },
): Command[] {
  const changes = Object.entries(patch) as [string, unknown][]
  return slots.flatMap((s) =>
    s.point !== undefined && s.key !== null
      ? changes.map(([f, v]) => set(s.node, ['pointOverrides', s.key!, s.point!, f], v))
      : styleCommands(s.graph, s.layer, s.key, changes),
  )
}

/** Reset position: every moved target's offsets cleared. */
export const positionCommands = (targets: readonly Target[]): Command[] =>
  targets.flatMap((t) => t.position?.paths.map((p) => set(t.position!.node, p, undefined)) ?? [])

/** The undo label of a change: "Font size 10 pt (3 elements)". */
export const changeLabel = (what: string, n: number): string =>
  n > 1 ? `${what} (${n} elements)` : what
