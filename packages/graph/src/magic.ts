import {
  type Aes,
  type AxisSpec,
  type ContinuousAxisSpec,
  type DataTable,
  type GraphNode,
  type Layer,
  type Project,
  type ResultLookup,
  type SeriesIdentity,
  sourceTable,
} from '@ps/model'
import { resolveSeries } from './data.ts'
import { FRAMES, matrixKindOf } from './layers/matrix.ts'
import { scaffoldFor } from './scaffold.ts'
import { defined } from './theme.ts'
import { DEFAULT_RIGHT_AXIS } from './yAxes.ts'

// Magic ("match format", decision 30 amended in roadmap 33c): a graph takes another's
// formats — styles, text, legend, axis formats and, by option, size, ranges, titles, per-data-set
// formats matched by position, and its layers. Layers are matched by id, then by geom and
// position; data and the graph's own analysis curves and functions stay the target's.

export interface MatchFormatOptions {
  /** Plot-area width and height. */
  size: boolean
  /** Axis ranges, tick intervals and scales (off by default: they depend on the data). */
  axisRanges: boolean
  /** Axis title text (styles are always copied). */
  axisTitles: boolean
  /** Per-data-set formats, matched by position (1st to 1st…). */
  dataSets: boolean
  /** The layers (and look): the source's when the target's table offers its frame. */
  layers: boolean
  /** Per-data-set formats matched by key instead of position (graphs of one set's levels). */
  dataSetsByKey?: boolean
}

export const DEFAULT_MATCH_OPTIONS: MatchFormatOptions = {
  size: true,
  axisRanges: false,
  axisTitles: false,
  dataSets: true,
  layers: true,
}

/**
 * Axis formats of `source` on `target`; optional settings the source lacks are cleared (keys set
 * to undefined are dropped, so the document stays plain serializable data).
 */
function matchAxis(target: AxisSpec, source: AxisSpec, opts: MatchFormatOptions): AxisSpec {
  const styled = {
    line: source.line,
    tickLabels: source.tickLabels,
    show: source.show,
    tickStyle: source.tickStyle,
    showLabels: source.showLabels,
    grid: source.grid,
    titleGap: source.titleGap,
    title: opts.axisTitles
      ? source.title
      : target.title && { ...target.title, style: source.title?.style ?? target.title.style },
  }
  const same =
    target.type === 'continuous' && source.type === 'continuous'
      ? {
          format: source.format,
          frame: source.frame,
          rotation: source.rotation,
          ...(opts.axisRanges
            ? {
                range: source.range,
                ticks: source.ticks,
                scale: source.scale,
                breaks: source.breaks,
                // Roadmap 36: the pieces' lengths, the marks at the breaks, listed ticks.
                pieces: source.pieces,
                breakMark: source.breakMark,
                tickValues: source.tickValues,
                tickText: source.tickText,
                reverse: source.reverse,
                anchor: source.anchor,
              }
            : {}),
        }
      : target.type === 'categorical' && source.type === 'categorical'
        ? { rotation: source.rotation }
        : {}
  return defined({ ...target, ...styled, ...same }) as AxisSpec
}

/**
 * The right Y axis of `target` after matching: the source's formats on the target's own right
 * axis; the source's right axis (its range and title text only by option) when the target has
 * none; the target's own when the source has none (its data sets may be plotted on it).
 */
function matchRightAxis(
  target: GraphNode['axes'],
  source: GraphNode['axes'],
  opts: MatchFormatOptions,
): { y2?: ContinuousAxisSpec } {
  const [t, s] = [target.y2, source.y2]
  if (!s) return t ? { y2: t } : {}
  return { y2: matchAxis(t ?? DEFAULT_RIGHT_AXIS, s, opts) as ContinuousAxisSpec }
}

const tableLayer = (l: Layer) => !l.data || l.data.from === 'table'

/** A layer's counterpart in a list: the one with its id and geom, else its geom and position. */
function counterpart(l: Layer, list: readonly Layer[], used: Set<Layer>): Layer | undefined {
  const pick = (test: (x: Layer) => boolean) => {
    const m = list.find((x) => !used.has(x) && tableLayer(x) && test(x))
    if (m) used.add(m)
    return m
  }
  return (
    pick((x) => x.id === l.id && x.geom === l.geom) ??
    pick((x) => x.geom === l.geom && (x.position?.kind ?? '') === (l.position?.kind ?? ''))
  )
}

/** Per-data-set entries with their keys mapped (`key` → `map[key]`; unmapped ones dropped). */
function remap<T>(entries: Record<string, T> | undefined, map: Map<string, string>) {
  const out: Record<string, T> = {}
  for (const [k, v] of Object.entries(entries ?? {})) {
    const to = map.get(k)
    if (to !== undefined) out[to] = v
  }
  return Object.keys(out).length ? out : undefined
}

/**
 * Audit 2 (G5): a source layer's mapped variables (`aes`) on the target's table: each variable
 * the target's table has is kept; another is the target's variable of the same title, else the
 * one at its place in the table; one with neither is left out (no dangling reference).
 */
function remapAes(
  aes: Aes,
  from: Pick<DataTable, 'dataSets'> | undefined,
  to: Pick<DataTable, 'dataSets'>,
): Aes {
  const own = new Set<string>(to.dataSets.map((d) => d.id))
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(aes) as [keyof Aes, string | undefined][]) {
    if (v === undefined) continue
    if (own.has(v)) {
      out[k] = v
      continue
    }
    const i = from?.dataSets.findIndex((d) => d.id === v) ?? -1
    const d = from?.dataSets[i]
    const match =
      (d?.title ? to.dataSets.find((t) => t.title === d.title) : undefined) ??
      (i >= 0 ? to.dataSets[i] : undefined)
    if (match) out[k] = match.id
  }
  return out as Aes
}

/** A layer with its per-data-set entries (or none). */
function withSeries(l: Layer, series: Layer['series'] | undefined): Layer {
  const { series: _, ...rest } = l
  return (series ? { ...rest, series } : rest) as Layer
}

/**
 * Makes `target` look like `source` ("Magic"): styles, text, legend, axis formats and,
 * by option, size, ranges, titles, data-set formats and layers. Data, titles' wording,
 * annotations, the target's analysis curves and functions and a bubble plot's variables stay the
 * target's own.
 */
export function matchGraphFormat(
  project: Project,
  target: GraphNode,
  source: GraphNode,
  opts: MatchFormatOptions = DEFAULT_MATCH_OPTIONS,
  /** Results, for graphs of result tables. */
  result?: ResultLookup,
): GraphNode {
  const table = sourceTable(project, target.seriesSource.table, result)
  // Data sets matched by position: the source's n-th formats go to the target's n-th (or, for
  // graphs of one set's levels or rows, each key's to the same key).
  const from = resolveSeries(project, source, result).map((s) => s.key)
  const to = resolveSeries(project, target, result).map((s) => s.key)
  const byPosition = opts.dataSetsByKey
    ? new Map(
        [...new Set([...from, ...to, ...Object.keys(source.seriesOverrides)])].map((k) => [k, k]),
      )
    : new Map(from.flatMap((k, i) => (to[i] === undefined ? [] : [[k, to[i]!]])))

  // The frames the target's table offers as the target maps it (its graph of variables' kind,
  // which matching keeps: `mapping` stays the target's).
  const copyLayers =
    opts.layers && !!table && FRAMES[matrixKindOf(table, target)].includes(source.frame)
  const fromTable = sourceTable(project, source.seriesSource.table, result)
  const frameChanges = copyLayers && source.frame !== target.frame
  const used = new Set<Layer>()
  const sourceUsed = new Set<Layer>()
  const own = target.layers.filter(tableLayer)
  const mine = target.layers.filter((l) => !tableLayer(l))
  const layers: Layer[] = copyLayers
    ? [
        ...mine,
        ...source.layers.filter(tableLayer).map((s) => {
          const t = counterpart(s, own, used)
          const series = opts.dataSets
            ? (remap<unknown>(s.series, byPosition) as Layer['series'])
            : t?.series
          const out = withSeries(s, series)
          // A bubble plot's variables are the target's own; the source's, on the target's
          // table (G5).
          if (t?.aes) return { ...out, aes: t.aes } as Layer
          if (!out.aes || !table) return out
          const { aes: _, ...rest } = out
          // Only a multiple-variables table's variables are mapped.
          if (table.tableKind !== 'multipleVariables') return rest as Layer
          return { ...rest, aes: remapAes(out.aes, fromTable, table) } as Layer
        }),
      ]
    : target.layers.map((t) => {
        if (!tableLayer(t)) return t
        const s = counterpart(t, source.layers, sourceUsed)
        if (!s) return t
        const { style: _, ...rest } = t
        const styled = (s.style ? { ...rest, style: s.style } : rest) as Layer
        return opts.dataSets
          ? withSeries(styled, remap<unknown>(s.series, byPosition) as Layer['series'])
          : styled
      })

  // Identities: by position, keeping the target's analysis curves' and functions' own.
  const notTable = new Set(
    mine.flatMap((l) =>
      l.data?.from === 'outputs'
        ? l.data.series.map((s) => s.id as string)
        : l.data?.from === 'functions'
          ? l.data.functions.map((f) => f.id as string)
          : [],
    ),
  )
  const seriesOverrides: Record<string, SeriesIdentity> = opts.dataSets
    ? {
        ...(remap(source.seriesOverrides, byPosition) ?? {}),
        ...Object.fromEntries(
          Object.entries(target.seriesOverrides).filter(([k]) => notTable.has(k)),
        ),
      }
    : target.seriesOverrides

  let axes: GraphNode['axes'] = {
    x: matchAxis(target.axes.x, source.axes.x, opts),
    y: matchAxis(target.axes.y, source.axes.y, opts),
    ...matchRightAxis(target.axes, source.axes, opts),
  }
  // Another frame (a column graph becoming a bubble plot…) needs that frame's axes.
  if (frameChanges && table)
    axes = scaffoldFor(table, {
      frame: source.frame,
      layers,
      ...(source.look ? { look: source.look } : {}),
    }).axes

  const out: GraphNode = {
    ...target,
    style: source.style,
    legend: legendFormat(source.legend, target.legend),
    axes,
    title: target.title && { ...target.title, style: source.title?.style ?? target.title.style },
    layers,
    seriesOverrides,
  }
  if (source.drawOrder) out.drawOrder = source.drawOrder
  else delete out.drawOrder
  if (opts.size) out.size = source.size
  if (copyLayers) {
    out.frame = source.frame
    if (source.look) out.look = source.look
    else delete out.look
    if (source.preset) out.preset = source.preset
    else delete out.preset
    if (source.scales) out.scales = source.scales
    else delete out.scales
    // Audit 3 (G3): a copied layer classing points by the cut-offs (Significance) reads the
    // source's; the graph's lines at a cut-off move with them (one set per graph).
    if (layers.some((l) => tableLayer(l) && readsCutoffs(l))) {
      if (source.cutoffs) out.cutoffs = source.cutoffs
      else delete out.cutoffs
    }
  }
  return out
}

/** A layer reading the graph's cut-offs: a Significance layer, a field at a cut-off. */
const readsCutoffs = (l: Layer): boolean =>
  l.stat.kind === 'threshold' ||
  (l.stat.kind === 'result' && Object.values(l.stat.fields).some((f) => f.ref.from === 'cutoff'))

/**
 * The source's legend with the target's own entries' order and legend-only labels (roadmap 47b:
 * they name the target's entries, and labels are wording, which stays the target's), and its own
 * hidden entries (audit 3, G5: the source's keys name the source's entries).
 */
function legendFormat(source: GraphNode['legend'], target: GraphNode['legend']) {
  const own = ['order', 'labels', 'hidden'] as const
  if (own.every((f) => !source[f] && !target[f])) return source
  const { order: _, labels: __, hidden: ___, ...rest } = source
  return {
    ...rest,
    ...(target.order ? { order: target.order } : {}),
    ...(target.labels ? { labels: target.labels } : {}),
    ...(target.hidden ? { hidden: target.hidden } : {}),
  }
}

/**
 * "Apply to all graphs of the set" (roadmap 34d): a graph of a set of split graphs takes another
 * member's formats — everything Magic copies, axis ranges and titles too, per-data-set formats by
 * key (a set of levels or rows shows the same data sets; a set of data sets keeps each graph's
 * own) — keeping
 * its own data, title text, links and legend's visibility (the set shows one legend).
 */
export function matchSetFormat(
  project: Project,
  target: GraphNode,
  source: GraphNode,
  result?: ResultLookup,
): GraphNode {
  const out = matchGraphFormat(
    project,
    target,
    source,
    {
      size: true,
      axisRanges: true,
      axisTitles: true,
      // A set of data sets keeps each graph's own data set's formats (its colour).
      dataSets: source.split?.by !== 'dataSet',
      layers: true,
      dataSetsByKey: true,
    },
    result,
  )
  return { ...out, legend: { ...out.legend, show: target.legend.show } }
}
