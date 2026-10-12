import {
  type FillStyle,
  type Geom,
  type GraphNode,
  isBySeries,
  type Layer,
  type LayerData,
  type LayerOf,
  type Project,
  type ResultLookup,
  type Stat,
  seriesShown,
  sourceTable,
  statOf,
} from '@ps/model'
import { aesVariables } from '../aesthetics.ts'
import { graphRows, resolveSeries } from '../data.ts'
import { cloudsOfRuns, drawsCloud, isLoneSymbol, isRowSymbol } from '../layout/cloud.ts'
import { type GraphContext, layoutBasics } from '../layout/common.ts'
import { evenSample, type SampledPoints, type SampleUnit } from '../layout/screen.ts'
import type { SceneNode, StylePath } from '../scene.ts'
import {
  graphFillPalette,
  type ResolvedSeriesStyle,
  resolveColor,
  seriesColor,
  type Theme,
} from '../theme.ts'
import { type GraphLooks, graphLooks } from './looks.ts'
import { dataOf, identityStyle, layerStyle, pointsOption } from './theme.ts'

/**
 * The marks of a geom that stand for single rows, counted towards the graph's points and drawn as
 * clouds when there are many: a points layer's symbols, a box layer's outliers (audit 2, G6).
 */
const ROW_SYMBOLS: Partial<Record<Geom, (n: SceneNode) => boolean>> = {
  points: isRowSymbol,
  box: isLoneSymbol,
}

/**
 * Roadmap 49a: each series' place in a graph, as its default colour counts it (`seriesColor`'s
 * indices): a data set's (level's) index, then the analysis outputs after the data sets, then the
 * functions after them.
 */
export function seriesPlaces(
  project: Project,
  graph: GraphNode,
  result?: ResultLookup,
): ReadonlyMap<string, number> {
  const places = new Map<string, number>()
  const series = resolveSeries(project, graph, result)
  for (const s of series) places.set(s.key, s.index)
  let n = series.length
  const add = (id: string) => {
    if (!places.has(id)) places.set(id, n)
    n++
  }
  for (const l of graph.layers)
    if (l.data?.from === 'outputs') for (const o of l.data.series) add(o.id)
  for (const l of graph.layers)
    if (l.data?.from === 'functions') for (const f of l.data.functions) add(f.id)
  return places
}

/**
 * Roadmap 49d: the geoms whose fills by data set (`{ series: true }` in a fill) are a data set's
 * fill colour — the fill channel — rather than its colour: points (and a box's outliers, an
 * estimation plot's differences), bars, boxes and violins. Not a dot plot's or Significance
 * layer's points (their statistics' colours), 100% bars and slices (a colour per category), nor
 * points filled row by row by mapped variables (`RowLook.fill`).
 */
const CHANNEL_FILLS: ReadonlySet<Geom> = new Set(['points', 'bar', 'box', 'violin', 'difference'])

/**
 * Roadmap 49d: whether a layer's fills by data set take the data set's fill colour. `rowFilled`:
 * the graph's points of every row are filled by a variable of their own (a category or grouped
 * graph of variables' `mapping.fill`, not its groups' variable).
 */
export function fillsByDataSet(
  graph: Pick<GraphNode, 'frame'>,
  layer: Layer,
  rowFilled = false,
): boolean {
  if (!CHANNEL_FILLS.has(layer.geom)) return false
  const stat = layer.stat.kind
  if (stat === 'dotplot' || stat === 'threshold' || stat === 'fraction') return false
  if (layer.geom !== 'points') return true
  // An XY graph of variables' mapped points are filled row by row (`RowLook.fill`).
  if (graph.frame === 'xy' && layer.aes) return false
  return !(rowFilled && stat === 'identity')
}

/** A frame's own plane drawn by data set: its layers, and its marks of some of them. */
export interface FramePlane {
  id: string
  layers: readonly Layer[]
  draw: (layers: readonly Layer[]) => SceneNode[]
  /** Its marks straight in the plot, not in a group of their own (v1's grand mean). */
  bare?: boolean
}

/**
 * A graph's layers during one layout: the theme and palette, each data set's style and stat per
 * layer (memoized), which layers draw which data sets, and the drawn marks per layer and data set
 * for the frame to assemble into planes.
 */
export class LayerKit {
  readonly graph: GraphNode
  readonly theme: Theme
  readonly palette: readonly string[]
  readonly warnings: string[]
  /** Marks per layer id and data set (output, function) key, in drawing order. */
  readonly marks = new Map<string, Map<string, SceneNode[]>>()
  private readonly styles = new Map<string, ResolvedSeriesStyle>()
  private readonly parts = new Map<string, string>()
  private readonly layerStyles = new Map<Layer, Map<string, ResolvedSeriesStyle>>()

  constructor(readonly ctx: GraphContext) {
    const { theme, palette, warnings } = layoutBasics(ctx)
    this.graph = ctx.graph
    this.theme = theme
    this.palette = palette
    this.warnings = warnings
  }

  /** Drawn layers (not set invisible) of a geom, in list order (back to front). */
  drawn<G extends Geom>(geom: G, test: (l: LayerOf<G>) => boolean = () => true): LayerOf<G>[] {
    return this.graph.layers.filter(
      (l): l is LayerOf<G> => l.geom === geom && l.visible !== false && test(l as LayerOf<G>),
    )
  }

  /** Every layer of a geom, drawn or not (their formats and stats still count, e.g. legends). */
  all<G extends Geom>(geom: G, test: (l: LayerOf<G>) => boolean = () => true): LayerOf<G>[] {
    return this.graph.layers.filter(
      (l): l is LayerOf<G> => l.geom === geom && test(l as LayerOf<G>),
    )
  }

  /** These layers in list order (back to front). */
  inList(layers: readonly Layer[]): Layer[] {
    return this.graph.layers.filter((l) => layers.includes(l))
  }

  byId(id: string | undefined): Layer | undefined {
    return id === undefined ? undefined : this.graph.layers.find((l) => l.id === id)
  }

  data(layer: Layer): LayerData {
    return dataOf(this.graph, layer)
  }

  /** Whether a layer draws a data set: it is visible and doesn't leave the data set out. */
  shows(layer: Layer, key: string): boolean {
    return layer.visible !== false && seriesShown(layer, key)
  }

  stat(layer: Layer, key: string): Stat {
    return statOf(layer, key)
  }

  /** A data set's identity (colour, Y axis, point labels) over the theme's defaults. */
  identity(key: string, curve = false): ResolvedSeriesStyle {
    const k = `\u0000${curve}\u0000${key}`
    let s = this.styles.get(k)
    if (!s) {
      s = identityStyle(this.theme, this.graph, key, curve)
      this.styles.set(k, s)
    }
    return s
  }

  /** A data set's look in a layer (see `layerStyle`). */
  style(layer: Layer, key: string): ResolvedSeriesStyle {
    let byKey = this.layerStyles.get(layer)
    if (!byKey) {
      byKey = new Map()
      this.layerStyles.set(layer, byKey)
    }
    let s = byKey.get(key)
    if (!s) {
      s = this.filled(
        layer,
        key,
        layerStyle(this.theme, this.graph, layer, key, this.stat(layer, key), () =>
          this.cycleIndex(key),
        ),
      )
      byKey.set(key, s)
    }
    return s
  }

  /**
   * Roadmap 49d: a series' fill colour where a layer's fill is the data set's — its own
   * (`seriesOverrides[key].fill`, else the graph's default), else the graph's fill palette's at
   * its place (`graphFillPalette`); undefined when neither is set: its fill is its colour, as
   * before. `curve`: an analysis output or function.
   */
  fillOf(key: string, curve = false): string | undefined {
    const own = this.identity(key, curve).fill
    if (own && !isBySeries(own)) return resolveColor(own, this.palette)
    const list = graphFillPalette(this.graph, this.theme)
    return list?.length ? list[this.cycleIndex(key) % list.length]!.toLowerCase() : undefined
  }

  /**
   * Roadmap 49d: a resolved style with its fills by data set (points', bars', boxes') in the
   * series' fill colour (`fillOf`) — resolved here, as shapes and dashes by data set are, so the
   * drawing code and legends see a concrete colour. Returned as it is (the same object) when the
   * series has no fill colour of its own, so graphs without one draw exactly as before.
   */
  private filled(layer: Layer, key: string, s: ResolvedSeriesStyle): ResolvedSeriesStyle {
    if (!fillsByDataSet(this.graph, layer, this.rowFilled)) return s
    if (s.fill === undefined && !graphFillPalette(this.graph, this.theme)) return s
    const fill = this.fillOf(key, dataOf(this.graph, layer).from !== 'table')
    if (fill === undefined) return s
    const color = { rgb: fill }
    const sub = (f: FillStyle): FillStyle =>
      f.type === 'solid' && isBySeries(f.color) ? { ...f, color } : f
    return {
      ...s,
      points: { ...s.points, fill: sub(s.points.fill) },
      bar: { ...s.bar, fill: sub(s.bar.fill) },
      box: { ...s.box, fill: sub(s.box.fill) },
    }
  }

  private places: ReadonlyMap<string, number> | undefined

  /**
   * Roadmap 49d: whether the graph sets fill colours of their own anywhere — a fill palette (its
   * own or its style's), a default fill or a data set's or level's own fill.
   */
  get fillChannel(): boolean {
    const own = (f: unknown) => f !== undefined && !isBySeries(f)
    return (
      !!graphFillPalette(this.graph, this.theme) ||
      own(this.graph.style.seriesDefaults?.fill) ||
      Object.values(this.graph.seriesOverrides).some((o) => own(o.fill))
    )
  }

  /**
   * Roadmap 49d: whether a category or grouped graph of variables fills its points of every row
   * by a variable (`mapping.fill`) other than its groups' (its text colour variable).
   */
  get rowFilled(): boolean {
    const m = this.graph.mapping
    if (m?.fill === undefined) return false
    if (m.fill !== m.color) return true
    const { project, result } = this.ctx
    const table = sourceTable(project, this.graph.seriesSource.table, result)
    return !table?.dataSets.find((d) => d.id === m.color)?.text
  }

  /**
   * Roadmap 49a: a series' place in the graph (`seriesPlaces`), at which its shape and line
   * pattern by data set are the graph's cycles' entries. Worked out only when a layer asks (a
   * shape or dash by data set); 0 for a key not drawn.
   */
  cycleIndex(key: string): number {
    this.places ??= seriesPlaces(this.ctx.project, this.graph, this.ctx.result)
    return this.places.get(key) ?? 0
  }

  private readonly memos = new Map<string, unknown>()

  /**
   * A value computed once per layout (this kit) under a key, shared by the extents and the drawing
   * (a graph of variables' rows and groups, histograms' bin widths: audit 2, G7 and G15). The key
   * names everything the value depends on besides the layout's graph and data.
   */
  memo<T>(key: string, make: () => T): T {
    if (this.memos.has(key)) return this.memos.get(key) as T
    const v = make()
    this.memos.set(key, v)
    return v
  }

  /**
   * The id part of a layer's marks of a data set: v1's pattern (`point`, `bar`…), with
   * `@<layer id>` added when another layer of the same geom already drew that part for it.
   */
  part(layer: Layer, key: string, part: string): string {
    const k = `${key}\u0000${part}`
    const owner = this.parts.get(k)
    if (owner === undefined) {
      this.parts.set(k, layer.id)
      return part
    }
    return owner === layer.id ? part : `${part}@${layer.id}`
  }

  /**
   * The per-row points a data set draws (in table order): all of them, or on screen
   * (`ctx.screen`, decision 450) at most its cap, evenly spread (`evenSample`), recorded for the
   * note (`sampled`). XY graphs' only when the screen sample says so (builder previews).
   */
  screenSample<T>(items: readonly T[], per: SampleUnit, xy = false): readonly T[] {
    const screen = this.ctx.screen
    if (!screen || (xy && !screen.xy) || items.length <= screen.points) return items
    const shown = Math.max(1, Math.floor(screen.points))
    if (!this.sampled || items.length > this.sampled.of)
      this.sampled = { shown, of: items.length, per }
    return evenSample(items, shown)
  }

  /** The largest data set a screen layout sampled (`screenSample`), for the note. */
  sampled: SampledPoints | undefined

  /** Points standing for rows the graph draws: symbol nodes, clouds' points and outliers. */
  private rowPoints = 0
  private clouded = false

  /** Records marks a layer drew for a data set (each marked with the layer's id). */
  add(layer: Layer, key: string, ...nodes: SceneNode[]): void {
    this.addList(layer, key, nodes)
  }

  /** `add` of a list of any length (no spread arguments: a data set's marks can be 100k+). */
  addList(layer: Layer, key: string, nodes: readonly SceneNode[]): void {
    const isRow = ROW_SYMBOLS[layer.geom]
    for (const n of nodes) {
      n.layer = layer.id
      if (!isRow) continue
      if (n.prim?.type === 'points') this.rowPoints += n.prim.n
      else if (isRow(n)) this.rowPoints++
    }
    let byKey = this.marks.get(layer.id)
    if (!byKey) {
      byKey = new Map()
      this.marks.set(layer.id, byKey)
    }
    const list = byKey.get(key)
    if (list) for (const n of nodes) list.push(n)
    else byKey.set(key, nodes.slice())
  }

  /** Settles the marks drawn so far (clouds of many points), as their first read does. */
  settle(): void {
    this.cloudRows()
  }

  nodes(layer: Layer, key: string): SceneNode[] {
    this.cloudRows()
    return this.marks.get(layer.id)?.get(key) ?? []
  }

  /**
   * Once every mark is drawn (the first read of them): when the graph's points standing for rows,
   * across all its layers and data sets, are more than `RASTER_THRESHOLD` (`drawsCloud`), every
   * points layer's symbols (Automatic) and every box layer's outliers become clouds in their
   * place — one image each on screen, the same symbols in exports (decision 451, audit 2 G6); a
   * points layer set to Always image always does, Always vector never.
   */
  private cloudRows(): void {
    if (this.clouded) return
    this.clouded = true
    for (const [id, byKey] of this.marks) {
      const layer = this.byId(id)
      const isRow = layer && ROW_SYMBOLS[layer.geom]
      if (!isRow) continue
      for (const [key, list] of byKey) {
        if (!drawsCloud(pointsOption(layer, key, 'render'), this.rowPoints)) continue
        if (list.some(isRow)) byKey.set(key, cloudsOfRuns(list, isRow))
      }
    }
  }

  /** Marks a frame drew for a layer as a whole (lines joining data sets, a grand mean…). */
  private readonly whole = new Map<string, SceneNode[]>()

  /** Records marks a frame drew for a layer as a whole (each marked with the layer's id). */
  addWhole(layer: Layer, ...nodes: SceneNode[]): void {
    this.addWholeList(layer, nodes)
  }

  /** The marks a frame drew for a layer as a whole. */
  wholeOf(layer: Layer): readonly SceneNode[] {
    return this.whole.get(layer.id) ?? []
  }

  /** `addWhole` of a list of any length (no spread arguments). */
  addWholeList(layer: Layer, nodes: readonly SceneNode[]): void {
    for (const n of nodes) n.layer = layer.id
    const list = this.whole.get(layer.id)
    if (list) for (const n of nodes) list.push(n)
    else this.whole.set(layer.id, [...nodes])
  }

  /**
   * Drawing by layer: every visible layer's marks in the list's order (back to front), a group
   * `layer/<id>` per layer holding its marks of every data set (in data set order), then those
   * drawn for it as a whole. Marks drawn by the frame (before-after lines, the grand mean, bands
   * and curves) stack by the list like every other, so moving a layer moves its marks.
   */
  layerPlane(keys: readonly string[]): SceneNode[] {
    return this.graph.layers
      .filter((l) => l.visible !== false)
      .map((l) => ({
        id: `layer/${l.id}`,
        children: [...keys.flatMap((k) => this.nodes(l, k)), ...(this.whole.get(l.id) ?? [])],
      }))
  }

  /**
   * The graph's variables mapped to appearance (roadmap 34b), as `graphLooks` makes them for this
   * layout: the rows the frame draws as points (`drawn`, table rows; null: those it maps, of a
   * graph of variables), the variable its data sets are the levels of, and its legend entries'
   * prefix and target. Undefined when nothing is mapped.
   */
  looks(o: {
    drawn: readonly number[]
    seriesVariable?: string
    prefix?: string
    target?: StylePath
    /** The mapped points' look (absent: the first points layer's). */
    points?: ResolvedSeriesStyle['points']
    /** Roadmap 34g: each table row's local density, colouring the points in place of a variable. */
    density?: Float64Array
  }): GraphLooks | undefined {
    if (!Object.keys(aesVariables(this.graph)).length && !o.density) return undefined
    const { project, result } = this.ctx
    const table = sourceTable(project, this.graph.seriesSource.table, result)
    if (!table) return undefined
    const points = this.all('points', (l) => this.graph.frame !== 'xy' || !!l.aes)[0]
    const style = points ? this.style(points, '') : this.identity('')
    return graphLooks({
      ctx: this.ctx,
      table,
      graph: this.graph,
      rows: graphRows(this.graph, table),
      drawn: o.drawn,
      palette: this.palette,
      levelColor: (key, k) => seriesColor(this.identity(key).color, this.palette, k),
      // Roadmap 49d: a level's fill colour (its own, the fill palette's at its place, its colour).
      levelFill: (key, k) => {
        const own = this.identity(key).fill
        if (own && !isBySeries(own)) return resolveColor(own, this.palette)
        const list = graphFillPalette(this.graph, this.theme)
        return list?.length
          ? list[k % list.length]!.toLowerCase()
          : seriesColor(this.identity(key).color, this.palette, k)
      },
      fillChannel: this.fillChannel,
      points: o.points ?? style.points,
      ...(o.seriesVariable !== undefined ? { seriesVariable: o.seriesVariable } : {}),
      ...(o.density ? { density: o.density } : {}),
      prefix: o.prefix ?? 'aes',
      target: o.target ?? ['legend'],
    })
  }

  /** Series-major: each data set's layers together (v1); else layer by layer. */
  get seriesMajor(): boolean {
    return this.graph.drawOrder === 'series'
  }

  /**
   * A data set's layers among `layers` back to front: the list's order, or, drawing by data set,
   * its own `order` (front to back) followed by the others.
   */
  orderOf(key: string, layers: readonly Layer[]): readonly Layer[] {
    const order = this.graph.seriesOverrides[key]?.order
    if (!order || !this.seriesMajor) return layers
    const front = order.flatMap((id) => layers.filter((l) => l.id === id))
    const rest = [...layers].reverse().filter((l) => !front.includes(l))
    return [...front, ...rest].reverse()
  }

  /**
   * Drawing by data set (v1): the frame's own planes (bands, areas, curves, before-after lines,
   * the grand mean…) beneath the data sets' groups, in their fixed order, as v1 drew them; but a
   * layer listed in front of every layer the groups draw (moved to the top of the list) has its
   * plane drawn over them (the planes there in the same order). Migrated v1 graphs list the
   * planes' layers first, so they draw as before.
   */
  planesAround(
    planes: readonly FramePlane[],
    groupLayers: readonly Layer[],
    groups: SceneNode,
  ): SceneNode[] {
    const at = (l: Layer) => this.graph.layers.indexOf(l)
    const last = Math.max(-1, ...groupLayers.filter((l) => l.visible !== false).map(at))
    const over = (l: Layer) => last >= 0 && at(l) > last
    const plane = (p: FramePlane, layers: readonly Layer[]): SceneNode[] => {
      const children = p.draw(layers)
      return p.bare ? children : [{ id: p.id, children }]
    }
    const under = planes.flatMap((p) =>
      plane(
        p,
        p.layers.filter((l) => !over(l)),
      ),
    )
    const above = planes.flatMap((p) => {
      const mine = p.layers.filter(over)
      return mine.length ? plane(p, mine) : []
    })
    return [...under, groups, ...above]
  }

  /**
   * The marks of a plane: data set by data set (each its layers in its order), or layer by layer
   * (each layer's marks of every data set, in data set order).
   */
  plane(layers: readonly Layer[], keys: readonly string[]): SceneNode[] {
    if (!this.seriesMajor) return layers.flatMap((l) => keys.flatMap((k) => this.nodes(l, k)))
    return keys.flatMap((k) => this.orderOf(k, layers).flatMap((l) => this.nodes(l, k)))
  }

  /**
   * The `series` plane: by data set, a group per data set (`series/<key>`) holding its layers'
   * marks in its order, then `after` (frame marks such as a pie's title); by layer, a group per
   * layer (`layer/<id>`) holding its marks of every data set, then the frame marks.
   */
  seriesPlane(
    layers: readonly Layer[],
    keys: readonly string[],
    after: (key: string) => SceneNode[] = () => [],
  ): SceneNode[] {
    if (this.seriesMajor)
      return keys.map((k) => ({
        id: `series/${k}`,
        target: ['seriesOverrides', k],
        children: [...this.orderOf(k, layers).flatMap((l) => this.nodes(l, k)), ...after(k)],
      }))
    const groups: SceneNode[] = layers.map((l) => ({
      id: `layer/${l.id}`,
      children: [...keys.flatMap((k) => this.nodes(l, k)), ...this.wholeOf(l)],
    }))
    const extra = keys.flatMap(after)
    return extra.length ? [...groups, { id: 'layer/frame', children: extra }] : groups
  }
}
