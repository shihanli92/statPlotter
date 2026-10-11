import { dataOf, frontFirst, hasRightAxis, layerTitle, type StylePath } from '@ps/graph'
import type { GraphNode, Layer } from '@ps/model'
import { capitalize } from '../../util.ts'

// Roadmap 46 (stage 2, decisions 910–919): the Format options are organised by element. A target
// is a place — the graph, its title, an axis, the legend, a layer, a point, a bracket, a text box
// or line — chosen by what is selected (`formatTargetFor`), each opening on its Common settings;
// `section` names a section to open and show (an axis title clicked opens its axis' Title
// section). Roadmap 49b (decisions 1226–1238): a data set is formatted one layer at a time — a
// mark clicked opens the layer that drew it with its data set picked, and the arrows step through
// the graph's layers (`stepLayer`), so a layer's view is a layer plus a pick of its series.

/** An axis of a graph. */
export type AxisKey = 'x' | 'y' | 'y2'

/** One series: a data set, an analysis output (curve) or a function (by series id). */
export type OneSeries = { dataSet: string } | { output: string } | { fn: string }

/** Roadmap 49b: several data sets of one layer, selected together (their fields shown mixed). */
export interface SeveralSeries {
  dataSets: readonly string[]
}

/**
 * Which series a layer's view formats: every series it draws (the picker's "All data sets"), one,
 * or several data sets selected together.
 */
export type SeriesPick = { all: true } | OneSeries | SeveralSeries

/** Where the Format panel (and dialog) is: an element of the graph, and a section to show. */
export type FormatTarget =
  /** The graph: its layers, text, frame, background, size, data sets, annotations… */
  | { place: 'graph'; section?: string }
  | { place: 'title' }
  | { place: 'axis'; axis: AxisKey; section?: string }
  /** `entry` (roadmap 47b): a legend entry selected that has no data set or layer of its own. */
  | { place: 'legend'; entry?: string }
  /**
   * Roadmap 49b: one layer's view — its fields for every series it draws (no `series`), for one
   * (a mark clicked: the data set, curve or function it draws) or for several data sets selected
   * together; the arrows step to the other layers. `entry`: the legend entry it was reached from.
   */
  | {
      place: 'layer'
      layer: string
      series?: OneSeries | SeveralSeries
      section?: string
      entry?: string
    }
  /** One point (bar, slice…) of a data set; `layer`: the layer it was picked in, when known. */
  | { place: 'point'; dataSet: string; point: string; layer?: string }
  | { place: 'bracket'; index: number }
  /** A text box, line, arrow or results table. */
  | { place: 'object'; index: number }

/** A layer's view (roadmap 49b). */
export type LayerTarget = Extract<FormatTarget, { place: 'layer' }>

export const ALL_SERIES: SeriesPick = { all: true }

export const graphPlace = (section?: string): FormatTarget =>
  section ? { place: 'graph', section } : { place: 'graph' }
export const axisPlace = (axis: AxisKey, section?: string): FormatTarget =>
  section ? { place: 'axis', axis, section } : { place: 'axis', axis }
/** A layer's view for every series it draws. */
export const layerPlace = (layer: string, section?: string): FormatTarget =>
  section ? { place: 'layer', layer, section } : { place: 'layer', layer }
export const TITLE_PLACE: FormatTarget = { place: 'title' }
export const LEGEND_PLACE: FormatTarget = { place: 'legend' }

/** A point's place. */
export const pointPlace = (dataSet: string, point: string, layer?: string): FormatTarget =>
  layer === undefined
    ? { place: 'point', dataSet, point }
    : { place: 'point', dataSet, point, layer }

/** A layer's view with a series pick (every series: the layer's own view). */
export function layerView(layer: string, series: SeriesPick, section?: string): FormatTarget {
  if ('all' in series) return layerPlace(layer, section)
  return { place: 'layer', layer, series, ...(section ? { section } : {}) }
}

/** The series a layer's view formats (every series: `{ all: true }`). */
export const pickOfTarget = (t: FormatTarget): SeriesPick =>
  t.place === 'layer' && t.series ? t.series : ALL_SERIES

/** The one series a layer's view formats (none: every series, or several). */
export const oneSeriesOf = (t: FormatTarget): OneSeries | undefined =>
  t.place === 'layer' && t.series && !('dataSets' in t.series) ? t.series : undefined

/** The layer a place is about: a layer's view's, a point's (when known). */
export const layerOfTarget = (t: FormatTarget): string | undefined =>
  t.place === 'layer' || t.place === 'point' ? t.layer : undefined

type LayerLike = Pick<Layer, 'id' | 'geom' | 'stat' | 'data'>

/**
 * Whether a layer's view picks among its series (roadmap 49b): not a heat map, the grand mean or
 * connecting lines (one look for the whole layer: the layer's options alone), not the
 * Significance layer (coloured by class, roadmap 46b), not a line, band or label of typed values
 * or results. An estimation plot's differences do (each data set's symbol and caps, decision
 * 1233).
 */
export function picksSeries(layer: LayerLike): boolean {
  if (['tile', 'refline', 'connector'].includes(layer.geom)) return false
  if (layer.stat.kind === 'threshold') return false
  return !(
    layer.stat.kind === 'result' &&
    (layer.data?.from === 'values' || layer.data?.from === 'analysis')
  )
}

/** Whether a layer draws a series and its view can pick it (`picksSeries`). */
export function drawsSeries(
  graph: Pick<GraphNode, 'layers'>,
  layer: LayerLike,
  pick: SeriesPick,
): boolean {
  if (!picksSeries(layer)) return false
  if ('all' in pick) return true
  const data = dataOf(graph as GraphNode, layer)
  if ('output' in pick)
    return data.from === 'outputs' && data.series.some((s) => s.id === pick.output)
  if ('fn' in pick) return data.from === 'functions' && data.functions.some((f) => f.id === pick.fn)
  return data.from === 'table'
}

/** The layers drawing a series (`drawsSeries`), front first as every list shows them. */
export function seriesLayers<L extends LayerLike>(
  graph: { layers: readonly L[] },
  pick: SeriesPick,
): L[] {
  return frontFirst(graph.layers).filter((l) =>
    drawsSeries(graph as unknown as Pick<GraphNode, 'layers'>, l, pick),
  )
}

/**
 * The layer a series is formatted in when no mark says which (its identity, a legend entry, a
 * label): the front-most layer drawing it of its own (not attached to another layer, nor drawing
 * another's data: the points, not their error bars; the curve, not its band), else the front-most
 * drawing it.
 */
export function homeLayer<L extends LayerLike & Pick<Layer, 'on'>>(
  graph: { layers: readonly L[] },
  pick: SeriesPick,
): L | undefined {
  const drawing = seriesLayers(graph, pick)
  return drawing.find((l) => l.on === undefined && l.data?.from !== 'layer') ?? drawing[0]
}

/**
 * A series' view (roadmap 49b): in `layer` when given (a mark clicked there; its own view when it
 * can't pick the series), else in its home layer (`homeLayer`); none: the graph's data sets.
 */
export function seriesTarget(
  graph: Pick<GraphNode, 'layers'>,
  pick: SeriesPick,
  layer?: string,
  section?: string,
): FormatTarget {
  const at = layer === undefined ? undefined : graph.layers.find((l) => l.id === layer)
  if (at) return drawsSeries(graph, at, pick) ? layerView(at.id, pick, section) : layerPlace(at.id)
  const home = homeLayer(graph, pick)
  if (home) return layerView(home.id, pick, section)
  return graphPlace('dataSets')
}

/**
 * Roadmap 49b: the layer `by` rows away from a view's layer in the Layers list's order (front
 * first): −1 the layer in front (the row above), 1 the one behind; null past either end (no
 * wrap). The series picked stay picked where that layer draws them, else every series.
 */
export function stepLayer(
  graph: Pick<GraphNode, 'layers'>,
  t: FormatTarget,
  by: -1 | 1,
): FormatTarget | null {
  const rows = frontFirst(graph.layers)
  const i = rows.findIndex((l) => l.id === layerOfTarget(t))
  const next = i < 0 ? undefined : rows[i + by]
  return next ? landOn(graph, t, next.id) : null
}

/** A view of another layer, keeping the series picked where it draws them (else every one). */
export function landOn(
  graph: Pick<GraphNode, 'layers'>,
  t: FormatTarget,
  id: string,
): FormatTarget {
  const layer = graph.layers.find((l) => l.id === id)
  const pick: SeriesPick = t.place === 'point' ? { dataSet: t.dataSet } : pickOfTarget(t)
  return layer && drawsSeries(graph, layer, pick) ? layerView(id, pick) : layerPlace(id)
}

/** Which series a key names: a data set, an analysis output or a function. */
function pickOf(graph: Pick<GraphNode, 'layers'>, key: string): OneSeries {
  for (const l of graph.layers) {
    if (l.data?.from === 'outputs' && l.data.series.some((s) => s.id === key))
      return { output: key }
    if (l.data?.from === 'functions' && l.data.functions.some((f) => f.id === key))
      return { fn: key }
  }
  return { dataSet: key }
}

/** The series key of a pick (none for all series or several). */
export const pickKey = (p: SeriesPick): string | undefined =>
  'dataSet' in p ? p.dataSet : 'output' in p ? p.output : 'fn' in p ? p.fn : undefined

/** The series keys a pick names (every series, none). */
export const pickKeys = (p: SeriesPick): readonly string[] =>
  'dataSets' in p ? p.dataSets : 'all' in p ? [] : [pickKey(p)!]

/**
 * The place of a selected (or clicked) element, given its selection key or scene style target.
 *
 * A layer's marks of a data set (`['layers', id, 'series', key]`) → that layer's view with the
 * data set picked (roadmap 49b; a layer that can't pick it: its own view); a whole layer
 * (`['layers', id]`) → that layer for every data set; a data set's identity → its view in the
 * front-most layer drawing it; a single point → that point (on `layer`, the layer it was picked
 * in, when known); an axis or its tick labels → that axis; an axis title → its axis' Title
 * section; the graph title → the title; legend → legend; a legend entry (roadmap 47b) → its data
 * set's view, its layer's (a Significance class, a result line), else the legend's, naming the
 * entry (`entryPlace`; `entryTarget` gives an entry's scene target, else the legend's); brackets
 * → the bracket; text, lines and arrows → that object; the frame, plot area and background → the
 * graph's Frame section; anything else → the graph.
 */
export function formatTargetFor(
  target: StylePath | null | undefined,
  graph: Pick<GraphNode, 'layers' | 'annotations' | 'frame' | 'axes'>,
  layer?: string,
  entryTarget?: (key: string) => StylePath | undefined,
): FormatTarget {
  const [head, second, third, fourth] = target ?? []
  switch (head) {
    case 'layers': {
      const id = String(second)
      if (!graph.layers.some((l) => l.id === id)) return graphPlace()
      return third === 'series' && fourth !== undefined
        ? seriesTarget(graph, pickOf(graph, String(fourth)), id)
        : layerPlace(id)
    }
    case 'pointOverrides':
    case 'pointLabel': {
      if (second === undefined) return graphPlace()
      const pick = pickOf(graph, String(second))
      if ('dataSet' in pick && third !== undefined)
        return pointPlace(pick.dataSet, String(third), layer)
      return seriesTarget(graph, pick, layer)
    }
    case 'seriesOverrides':
      return second !== undefined
        ? seriesTarget(graph, pickOf(graph, String(second)))
        : graphPlace()
    case 'axes': {
      const which = second === 'x' || second === 'y' ? second : second === 'y2' ? 'y2' : null
      if (!which || (which === 'y2' && !hasRightAxis(graph))) return graphPlace('frame')
      return axisPlace(which, third === 'title' ? 'title' : undefined)
    }
    case 'title':
      return TITLE_PLACE
    // Roadmap 35: the number at risk under a survival graph.
    case 'riskTable':
      return graphPlace('riskTable')
    case 'legend':
      if (second === 'entries' && third !== undefined)
        return entryPlace(String(third), entryTarget?.(String(third)), graph)
      return LEGEND_PLACE
    case 'annotations': {
      const index = Number(second)
      const a = graph.annotations[index]
      if (!a) return graphPlace('annotations')
      return a.type === 'bracket' ? { place: 'bracket', index } : { place: 'object', index }
    }
    case 'style':
      // Roadmap 36: corner arrows are the frame's style.
      if (
        second === 'frame' ||
        second === 'arrows' ||
        second === 'plotBackground' ||
        second === 'background'
      )
        return graphPlace('frame')
      if (second === 'bracket') return graphPlace('brackets')
      return graphPlace()
    default:
      return graphPlace()
  }
}

/**
 * The place of a selection of several elements (roadmap 49b): the primary element's, except
 * that marks of several data sets in the primary's layer are that layer's view of them together
 * (fields that differ shown mixed); marks in other layers are left to the format bar, the arrows
 * reaching their layers (decision 1229).
 */
export function selectionTarget(
  paths: readonly StylePath[],
  primary: StylePath | null | undefined,
  graph: Pick<GraphNode, 'layers' | 'annotations' | 'frame' | 'axes'>,
  layer?: string,
  entryTarget?: (key: string) => StylePath | undefined,
): FormatTarget {
  const t = formatTargetFor(primary, graph, layer, entryTarget)
  const one = oneSeriesOf(t)
  if (t.place !== 'layer' || !one || !('dataSet' in one) || paths.length < 2) return t
  const keys = [one.dataSet]
  for (const p of paths) {
    const m = layerSeriesOf(p)
    if (m?.layer === t.layer && !keys.includes(m.key) && 'dataSet' in pickOf(graph, m.key))
      keys.push(m.key)
  }
  return keys.length > 1 ? { ...t, series: { dataSets: keys } } : t
}

interface TabInfo<T extends string = string> {
  id: T
  label: string
}

/**
 * The tabs of a target's place, in order: the axes (X axis, Y axis — "Left Y axis" beside a right
 * one — and the right Y axis) switch between each other; every other place has none (an element
 * is chosen by selecting it, a layer by its arrows, a data set by its layer's picker).
 */
export function tabsFor(t: FormatTarget, graph?: Pick<GraphNode, 'frame' | 'layers' | 'axes'>) {
  if (t.place !== 'axis') return [] as TabInfo<AxisKey>[]
  const right = !!graph && hasRightAxis(graph)
  return [
    { id: 'x', label: 'X axis' },
    { id: 'y', label: right ? 'Left Y axis' : 'Y axis' },
    ...(right ? [{ id: 'y2', label: 'Right Y axis' }] : []),
  ] as TabInfo<AxisKey>[]
}

/** The tab of a target (an axis'). */
export function tabOf(t: FormatTarget): string | null {
  return t.place === 'axis' ? t.axis : null
}

/** The same kind of place on another tab (another axis). */
export function withTab(t: FormatTarget, tab: string): FormatTarget {
  return t.place === 'axis' ? axisPlace(tab as AxisKey) : t
}

/** The dialog's title (also the label of its undo step). */
export function dialogTitle(t: FormatTarget, graph: Pick<GraphNode, 'annotations'>): string {
  switch (t.place) {
    case 'graph':
    case 'layer':
    case 'point':
      return 'Format graph'
    case 'title':
      return 'Format title'
    case 'axis':
      return 'Format axes'
    case 'legend':
      return 'Format legend'
    case 'bracket':
      return 'Format significance bracket'
    case 'object': {
      const a = graph.annotations[t.index]
      if (a?.type === 'text') return 'Format text'
      if (a?.type === 'line') return a.arrow === 'none' ? 'Format line' : 'Format arrow'
      if (a?.type === 'table') return 'Format results table'
      return 'Format object'
    }
  }
}

/**
 * What a click on empty space in the preview leaves: nothing highlighted, as a click off the graph
 * does on the canvas: the graph's place.
 */
export function deselectTarget(_t: FormatTarget): FormatTarget {
  return graphPlace()
}

/**
 * The scene element to highlight in the preview for a target (null: nothing in particular); a
 * view of several data sets: the first's marks (`targetPaths`: all of them).
 */
export function highlightOf(t: FormatTarget): StylePath | null {
  switch (t.place) {
    case 'graph':
      return null
    case 'title':
      return ['title']
    case 'point':
      return ['pointOverrides', t.dataSet, t.point]
    case 'layer': {
      const key = t.series ? pickKeys(t.series)[0] : undefined
      return key === undefined ? ['layers', t.layer] : ['layers', t.layer, 'series', key]
    }
    case 'axis':
      return ['axes', t.axis]
    case 'legend':
      return t.entry === undefined ? ['legend'] : ['legend', 'entries', t.entry]
    case 'bracket':
    case 'object':
      return ['annotations', t.index]
  }
}

/**
 * What a view selects on the canvas (roadmap 49b: the arrows' selection follows the layer landed
 * on, as choosing it in the Layers list does): the layer's marks of each series picked, else the
 * whole layer; another place, its element.
 */
export function targetPaths(t: FormatTarget): StylePath[] {
  if (t.place !== 'layer') {
    const h = highlightOf(t)
    return h ? [h] : []
  }
  if (!t.series) return [['layers', t.layer]]
  return pickKeys(t.series).map((k) => ['layers', t.layer, 'series', k])
}

/**
 * What a single mark (`pointOverrides` key) is: a row's bar or box on grouped graphs (key
 * `r<row>`), a slice (pie, donut, stacked part), a bubble, else a data point.
 */
export function singleMarkName(
  graph: Pick<GraphNode, 'frame' | 'layers'>,
  key: string,
): 'bar' | 'box' | 'slice' | 'bubble' | 'data point' {
  if (/^r\d+$/.test(key)) {
    const has = (test: (l: GraphNode['layers'][number]) => boolean) =>
      graph.layers.some((l) => l.visible !== false && test(l))
    if (graph.frame === 'polar' || has((l) => l.geom === 'bar' && l.stat.kind === 'fraction'))
      return 'slice'
    if (has((l) => !!l.aes)) return 'bubble'
    if (graph.frame === 'grouped' && has((l) => l.geom === 'bar')) return 'bar'
    if (graph.frame === 'grouped' && has((l) => l.geom === 'box' || l.geom === 'violin'))
      return 'box'
  }
  return 'data point'
}

const AXIS_WORDS: Record<AxisKey, string> = { x: 'X axis', y: 'Y axis', y2: 'right Y axis' }

/** What a place formats, for the toolbar's Format button and the context menu ("Format …"). */
export function describeTarget(
  t: FormatTarget,
  graph: Pick<GraphNode, 'frame' | 'layers' | 'annotations'>,
): string {
  switch (t.place) {
    case 'graph':
      return 'graph'
    case 'title':
      return 'title'
    case 'axis':
      // An axis title selected: its axis' place, at its Title section.
      return t.section === 'title' ? `${AXIS_WORDS[t.axis]} title` : AXIS_WORDS[t.axis]
    case 'legend':
      return 'legend'
    case 'layer': {
      const s = t.series
      if (!s) return 'layer'
      if ('dataSets' in s) return 'data sets'
      if ('output' in s) return 'curve'
      if ('fn' in s) return 'function'
      return 'data set'
    }
    case 'point':
      return singleMarkName(graph, t.point)
    case 'bracket':
      return 'bracket'
    case 'object':
      return dialogTitle(t, graph).replace('Format ', '')
  }
}

/**
 * The heading of a place in the Format panel: "Graph", "Graph title", "Y axis" ("Left Y axis"
 * beside a right one), "Legend", a layer's name (roadmap 49b: a layer's view, whichever of its
 * series is picked), "Data point of “Control”", "Bracket", "Text box"…
 */
export function placeName(
  t: FormatTarget,
  graph: Pick<GraphNode, 'frame' | 'layers' | 'annotations' | 'axes'>,
  title: (key: string) => string | undefined = () => undefined,
): string {
  switch (t.place) {
    case 'graph':
      return 'Graph'
    case 'title':
      return 'Graph title'
    case 'axis':
      return t.axis === 'y' && hasRightAxis(graph) ? 'Left Y axis' : capitalize(AXIS_WORDS[t.axis])
    case 'legend':
      return 'Legend'
    case 'layer': {
      const l = graph.layers.find((x) => x.id === t.layer)
      return l ? layerTitle(l, graph.frame) : 'Layer'
    }
    case 'point': {
      const name = title(t.dataSet)
      return `${capitalize(describeTarget(t, graph))} of ${name ? `“${name}”` : 'a data set'}`
    }
    case 'bracket':
      return 'Bracket'
    case 'object':
      return graph.annotations[t.index]?.type === 'text'
        ? 'Text box'
        : capitalize(describeTarget(t, graph))
  }
}

/**
 * The selection hint's subject: "Data set selected in “Points (every value)”", "Layer “Error bars
 * (SD)” selected", "Data point selected", "Y axis tick labels selected".
 */
const STYLE_PARTS: Record<string, string> = {
  frame: 'Frame',
  arrows: 'Frame',
  plotBackground: 'Plot area',
  background: 'Graph background',
}

export function selectionText(
  target: FormatTarget,
  selected: StylePath,
  graph: Pick<GraphNode, 'frame' | 'layers' | 'annotations'>,
): string {
  const what = describeTarget(target, graph)
  const id = layerOfSelection(selected)
  const layer = id === undefined ? undefined : graph.layers.find((l) => l.id === id)
  const name = layer ? `“${layerTitle(layer, graph.frame)}”` : ''
  if (layer && what === 'layer') return `Layer ${name} selected`
  // The frame, plot area and background are formatted in the graph's place.
  if (selected[0] === 'style' && STYLE_PARTS[String(selected[1])])
    return `${STYLE_PARTS[String(selected[1])]} selected`
  const ticks = selected[0] === 'axes' && selected[2] === 'tickLabels' ? ' tick labels' : ''
  return `${capitalize(what)}${ticks} selected${layer && what === 'data set' ? ` in ${name}` : ''}`
}

/**
 * Roadmap 47b: a legend entry's place — its data set's (curve's, function's) view for an entry
 * standing for one (`target`, the entry's scene target: its identity; roadmap 49b: in the
 * front-most layer drawing it), its layer's for a Significance class or a result line, else the
 * legend's (pie categories, guides) — naming the entry, so the panel shows its legend-only
 * actions.
 */
export function entryPlace(
  key: string,
  target: StylePath | undefined,
  graph: Pick<GraphNode, 'layers' | 'annotations' | 'frame' | 'axes'>,
): FormatTarget {
  const [head, id] = target ?? []
  let place: FormatTarget = LEGEND_PLACE
  if (head === 'seriesOverrides' && id !== undefined && target!.length === 2) {
    const t = seriesTarget(graph, pickOf(graph, String(id)))
    if (t.place === 'layer') place = t
  } else if (head === 'layers' && id !== undefined && target!.length === 2) {
    const l = graph.layers.find((x) => x.id === String(id))
    if (l && (l.stat.kind === 'threshold' || l.stat.kind === 'result')) place = layerPlace(l.id)
  }
  return { ...place, entry: key } as FormatTarget
}

/** Roadmap 47b: the legend entry a place was reached from, if any. */
export const entryOf = (t: FormatTarget): string | undefined =>
  t.place === 'legend' || t.place === 'layer' ? t.entry : undefined

/** A layer's marks of one series (`['layers', id, 'series', key]`): the layer and key. */
export function layerSeriesOf(
  t: StylePath | null | undefined,
): { layer: string; key: string } | null {
  return t?.[0] === 'layers' && t[2] === 'series' && t[3] !== undefined
    ? { layer: String(t[1]), key: String(t[3]) }
    : null
}

/** The layer a selection names (a layer's marks, or the whole layer), if any. */
export const layerOfSelection = (t: StylePath | null | undefined): string | undefined =>
  t?.[0] === 'layers' && t[1] !== undefined ? String(t[1]) : undefined

/**
 * What a click on a mark selects (decision 243): the first click a layer's marks of the data set;
 * a click on one of those marks again (or on another mark of the data set while one of its points
 * is selected) the single point; Alt-click the whole layer across data sets. The second click of
 * a double-click never drills down, so double-clicking formats the layer's data set.
 */
export function clickSelection(
  hit: StylePath | null,
  point: string | undefined,
  selected: StylePath | null,
  clickCount = 1,
  alt = false,
): StylePath | null {
  const marks = layerSeriesOf(hit)
  if (marks && alt) return ['layers', marks.layer]
  // Roadmap 44 (decision 856): the second click of a double-click selects the layer's marks of
  // the data set even on a selected point, so a double-click on a point always formats its data
  // set (a single point: Enter once it is selected, or right-click › Format this data point…).
  if (!marks || point === undefined || clickCount > 1) return hit
  const same =
    (layerSeriesOf(selected)?.layer === marks.layer &&
      layerSeriesOf(selected)?.key === marks.key) ||
    (selected?.[0] === 'pointOverrides' && selected[1] === marks.key)
  return same ? ['pointOverrides', marks.key, point] : hit
}
