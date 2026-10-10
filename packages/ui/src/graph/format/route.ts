import { hasRightAxis, layerTitle, type StylePath } from '@ps/graph'
import type { GraphNode } from '@ps/model'
import { capitalize } from '../../util.ts'

// Roadmap 46 (stage 2, decisions 910–919): the Format options are organised by element. A target
// is a place — the graph, its title, an axis, the legend, a layer, a data set (or curve, function,
// point), a bracket, a text box or line — chosen by what is selected (`formatTargetFor`), each
// opening on its Common settings; `section` names a section to open and show (an axis title
// clicked opens its axis' Title section).

/** An axis of a graph. */
export type AxisKey = 'x' | 'y' | 'y2'

/**
 * Which series a place formats: every series of a layer (the picker's "All data sets"), one data
 * set (or one point of it), an analysis output or a function (by series id).
 */
export type SeriesPick =
  | { all: true }
  | { dataSet: string; point?: string }
  | { output: string }
  | { fn: string }

/** One series (not every series). */
export type OneSeries = Exclude<SeriesPick, { all: true }>

/** Where the Format panel (and dialog) is: an element of the graph, and a section to show. */
export type FormatTarget =
  /** The graph: its layers, text, frame, background, size, data sets, annotations… */
  | { place: 'graph'; section?: string }
  | { place: 'title' }
  | { place: 'axis'; axis: AxisKey; section?: string }
  /** `entry` (roadmap 47b): a legend entry selected that has no data set or layer of its own. */
  | { place: 'legend'; entry?: string }
  /**
   * A layer for every data set it draws (Alt-click, the layer list, Add layer); `entry`: the
   * legend entry (a Significance class, a result line) it was reached from.
   */
  | { place: 'layer'; layer: string; section?: string; entry?: string }
  /**
   * A data set (curve, function) in every layer drawing it, or one of its points; `layer` is the
   * layer it was picked in (its section opens); `entry`: the legend entry it was reached from.
   */
  | { place: 'series'; series: OneSeries; layer?: string; section?: string; entry?: string }
  | { place: 'bracket'; index: number }
  /** A text box, line, arrow or results table. */
  | { place: 'object'; index: number }

export const ALL_SERIES: SeriesPick = { all: true }

export const graphPlace = (section?: string): FormatTarget =>
  section ? { place: 'graph', section } : { place: 'graph' }
export const axisPlace = (axis: AxisKey, section?: string): FormatTarget =>
  section ? { place: 'axis', axis, section } : { place: 'axis', axis }
export const layerPlace = (layer: string, section?: string): FormatTarget =>
  section ? { place: 'layer', layer, section } : { place: 'layer', layer }
export const TITLE_PLACE: FormatTarget = { place: 'title' }
export const LEGEND_PLACE: FormatTarget = { place: 'legend' }

/** A series' place (every series of a layer: the layer's; no layer: the graph's). */
export function seriesPlace(series: SeriesPick, layer?: string, section?: string): FormatTarget {
  if ('all' in series) return layer ? layerPlace(layer, section) : graphPlace(section)
  return {
    place: 'series',
    series,
    ...(layer ? { layer } : {}),
    ...(section ? { section } : {}),
  }
}

/** The ids of a graph's analysis outputs and functions. */
function seriesKinds(graph: Pick<GraphNode, 'layers'>) {
  const outputs = new Set<string>()
  const functions = new Set<string>()
  for (const l of graph.layers) {
    if (l.data?.from === 'outputs') for (const s of l.data.series) outputs.add(s.id)
    if (l.data?.from === 'functions') for (const f of l.data.functions) functions.add(f.id)
  }
  return { outputs, functions }
}

/** Which series a key names: a data set, an analysis output or a function. */
function pickOf(graph: Pick<GraphNode, 'layers'>, key: string, point?: string): OneSeries {
  const { outputs, functions } = seriesKinds(graph)
  if (outputs.has(key)) return { output: key }
  if (functions.has(key)) return { fn: key }
  return point === undefined ? { dataSet: key } : { dataSet: key, point }
}

/** The series key of a pick (none for all series). */
export const pickKey = (p: SeriesPick): string | undefined =>
  'dataSet' in p ? p.dataSet : 'output' in p ? p.output : 'fn' in p ? p.fn : undefined

/**
 * The place of a selected (or clicked) element, given its selection key or scene style target.
 *
 * A layer's marks of a data set (`['layers', id, 'series', key]`) → that data set, its section of
 * the layer open; a whole layer (`['layers', id]`) → that layer for every data set; a data set's
 * identity → its data set; a single point → that point (on `layer`, the layer it was picked in,
 * when known); an axis or its tick labels → that axis; an axis title → its axis' Title section;
 * the graph title → the title; legend → legend; a legend entry (roadmap 47b) → its data set's
 * place, its layer's (a Significance class, a result line), else the legend's, naming the entry
 * (`entryPlace`; `entryTarget` gives an entry's scene target, else the legend's); brackets → the
 * bracket; text, lines and arrows → that object; the frame, plot area and background → the
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
        ? seriesPlace(pickOf(graph, String(fourth)), id)
        : layerPlace(id)
    }
    case 'pointOverrides':
    case 'pointLabel':
      if (second === undefined) return graphPlace()
      return seriesPlace(
        pickOf(graph, String(second), third === undefined ? undefined : String(third)),
        layer,
      )
    case 'seriesOverrides':
      return second !== undefined ? seriesPlace(pickOf(graph, String(second))) : graphPlace()
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

interface TabInfo<T extends string = string> {
  id: T
  label: string
}

/**
 * The tabs of a target's place, in order: the axes (X axis, Y axis — "Left Y axis" beside a right
 * one — and the right Y axis) switch between each other; every other place has none (an element
 * is chosen by selecting it, or by the data set picker of a data set or layer).
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
    case 'series':
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

/** The scene element to highlight in the preview for a target (null: nothing in particular). */
export function highlightOf(t: FormatTarget): StylePath | null {
  switch (t.place) {
    case 'graph':
      return null
    case 'title':
      return ['title']
    case 'series': {
      const s = t.series
      if ('dataSet' in s && s.point) return ['pointOverrides', s.dataSet, s.point]
      const key = pickKey(s)!
      return t.layer ? ['layers', t.layer, 'series', key] : ['seriesOverrides', key]
    }
    case 'layer':
      return ['layers', t.layer]
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
    case 'layer':
      return 'layer'
    case 'series':
      if ('output' in t.series) return 'curve'
      if ('fn' in t.series) return 'function'
      return t.series.point ? singleMarkName(graph, t.series.point) : 'data set'
    case 'bracket':
      return 'bracket'
    case 'object':
      return dialogTitle(t, graph).replace('Format ', '')
  }
}

/**
 * The heading of a place in the Format panel: "Graph", "Graph title", "Y axis" ("Left Y axis"
 * beside a right one), "Legend", a layer's name, a data set's ("Control"), "Data point of
 * “Control”", "Bracket", "Text box"…
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
    case 'series': {
      const key = pickKey(t.series)!
      const name = title(key)
      const what = describeTarget(t, graph)
      if ('dataSet' in t.series && t.series.point)
        return `${capitalize(what)} of ${name ? `“${name}”` : 'a data set'}`
      return name ?? capitalize(what)
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
 * Roadmap 47b: a legend entry's place — its data set's (curve's, function's) for an entry standing
 * for one (`target`, the entry's scene target: its identity), its layer's for a Significance class
 * or a result line, else the legend's (pie categories, guides) — naming the entry, so the panel
 * shows its legend-only actions.
 */
export function entryPlace(
  key: string,
  target: StylePath | undefined,
  graph: Pick<GraphNode, 'layers' | 'annotations' | 'frame' | 'axes'>,
): FormatTarget {
  const [head, id] = target ?? []
  let place: FormatTarget = LEGEND_PLACE
  if (head === 'seriesOverrides' && id !== undefined && target!.length === 2)
    place = seriesPlace(pickOf(graph, String(id)))
  else if (head === 'layers' && id !== undefined && target!.length === 2) {
    const l = graph.layers.find((x) => x.id === String(id))
    if (l && (l.stat.kind === 'threshold' || l.stat.kind === 'result')) place = layerPlace(l.id)
  }
  return { ...place, entry: key } as FormatTarget
}

/** Roadmap 47b: the legend entry a place was reached from, if any. */
export const entryOf = (t: FormatTarget): string | undefined =>
  t.place === 'legend' || t.place === 'layer' || t.place === 'series' ? t.entry : undefined

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
