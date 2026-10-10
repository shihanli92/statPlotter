import { z } from 'zod'
import {
  type GraphNodeV1,
  GraphNodeV1 as GraphNodeV1Schema,
  type GraphType,
  type MarkLayer,
  type SeriesStyle,
} from '../graph.ts'
import type {
  ErrorStat,
  Frame,
  Geom,
  GraphNode,
  GraphStyle,
  Layer,
  LayerStyle,
  Position,
  SeriesIdentity,
  Stat,
  StatKind,
  StatParams,
  StyleSection,
} from '../layers.ts'
import type { DataTable } from '../table.ts'

// Schema v1 → v2 (roadmap 33b, docs/design/GRAPH_LAYERS.md §6.2): every v1 graph node compiled
// into a frame plus layers that draw what v1 drew (`compileV1`, which roadmap 33a ran in memory
// for every layout). FROZEN since roadmap 33b: never edit this file (add the next migration). It
// depends on nothing that may change: v1's theme defaults that decide what is drawn, and where
// each layer style field comes from in v1, are copied here (`V1`, `sectionsOf`).

export interface MigrationNote {
  /**
   * 'approximated': drawn differently from v1 (v1's quirk replaced by the consistent behaviour of
   * layers); 'dropped': a v1 setting v1 itself ignored.
   */
  kind: 'approximated' | 'dropped'
  text: string
  /** The graph it concerns (its name), when migrating a project. */
  graph?: string
}

export interface CompiledGraph {
  graph: GraphNode
  report: MigrationNote[]
}

type RawProject = Record<string, unknown>

/**
 * The v1 → v2 migration of a raw (unvalidated) project: each graph node checked against the v1
 * schema (a ZodError, as v1 validation gave, when it fails) and compiled (`compileV1`, with its
 * data table when the source is one). Notes on what changed are added to `notes`.
 */
export function v1to2(raw: RawProject, notes: MigrationNote[] = []): RawProject {
  const nodes = raw.nodes
  if (typeof nodes !== 'object' || nodes === null || Array.isArray(nodes)) return raw
  const src = nodes as Record<string, unknown>
  // Null prototype, as the file reader builds it: an id like `constructor` is an ordinary key.
  const out: Record<string, unknown> = Object.create(null)
  for (const id of Object.keys(src)) {
    const node = src[id] as { kind?: unknown } | null
    if (node?.kind !== 'graph') {
      out[id] = node
      continue
    }
    const parsed = GraphNodeV1Schema.safeParse(node)
    if (!parsed.success)
      throw new z.ZodError(
        parsed.error.issues.map((i) => ({ ...i, path: ['nodes', id, ...i.path] })),
      )
    const graph = parsed.data
    const source = Object.hasOwn(src, graph.seriesSource.table)
      ? (src[graph.seriesSource.table] as Partial<DataTable> | null)
      : undefined
    const table =
      source?.kind === 'table' && Array.isArray(source.dataSets) && source.yFormat
        ? (source as DataTable)
        : undefined
    const compiled = compileV1(graph, table)
    out[id] = compiled.graph
    for (const n of compiled.report) notes.push({ ...n, graph: graph.name })
  }
  return { ...raw, nodes: out }
}

/** The v1 theme's defaults that decide what is drawn and how it is summarised (frozen). */
export interface V1Defaults {
  points: { show: boolean; replicates: 'mean' | 'each' }
  bar: { show: boolean }
  box: { kind: 'box' | 'floating' | 'violin'; whiskers: string; show: boolean }
  violin: { extent: string; smoothing: number }
  label: { show: boolean }
  center: { stat: string }
  error: { stat: string }
  line: { show: boolean }
  band: { show: boolean }
  spaghetti: { show: boolean }
  envelope: { show: boolean }
  area: { show: boolean }
  markOrder: MarkLayer[]
}

const BASE: V1Defaults = {
  points: { show: true, replicates: 'mean' },
  bar: { show: false },
  box: { kind: 'box', whiskers: 'minmax', show: false },
  violin: { extent: 'truncated', smoothing: 1 },
  label: { show: false },
  center: { stat: 'mean' },
  error: { stat: 'SD' },
  line: { show: false },
  band: { show: false },
  spaghetti: { show: false },
  envelope: { show: false },
  area: { show: false },
  markOrder: ['center', 'error', 'points', 'bar', 'line'],
}
const NO_CENTER = { center: { stat: 'none' } }
const NO_ERROR = { error: { stat: 'none' } }
const hiddenPoints = (replicates: 'mean' | 'each' = 'mean') => ({
  points: { show: false, replicates },
})
const WHOLE = { ...hiddenPoints(), ...NO_CENTER, ...NO_ERROR }

const V1: Record<GraphType, V1Defaults> = {
  'column.scatter': BASE,
  'column.bar': { ...BASE, ...hiddenPoints(), ...NO_CENTER },
  'column.box': { ...BASE, ...hiddenPoints(), center: { stat: 'median' }, ...NO_ERROR },
  'column.beforeAfter': { ...BASE, ...NO_CENTER, ...NO_ERROR },
  'grouped.bar': { ...BASE, ...hiddenPoints('each'), ...NO_CENTER },
  'grouped.scatter': { ...BASE, points: { show: true, replicates: 'each' } },
  'grouped.box': { ...BASE, ...hiddenPoints('each'), center: { stat: 'median' }, ...NO_ERROR },
  'column.estimation': { ...BASE, ...NO_ERROR },
  'xy.scatter': { ...BASE, ...NO_CENTER, markOrder: ['points', 'error', 'center', 'bar', 'line'] },
  'survival.step': { ...BASE, ...NO_CENTER, ...NO_ERROR, line: { show: true } },
  'bubble.scatter': { ...BASE, ...NO_CENTER, ...NO_ERROR },
  'whole.pie': { ...BASE, ...WHOLE },
  'whole.donut': { ...BASE, ...WHOLE },
  'whole.bar': { ...BASE, ...WHOLE },
  'heatmap.cells': BASE,
}
/** Curves of analysis outputs and functions. */
const CURVE: V1Defaults = { ...BASE, ...WHOLE, line: { show: true }, band: { show: true } }

/** A v1 graph type's frozen defaults (read by the v1 view, `v1view.ts`). */
export const v1DefaultsOf = (type: GraphType): Readonly<V1Defaults> => V1[type]

const FRAME: Record<string, Frame> = {
  column: 'category',
  grouped: 'grouped',
  xy: 'xy',
  survival: 'xy',
  bubble: 'xy',
  heatmap: 'matrix',
}

const GEO_ERRORS = new Set(['geoSD', 'geoCI'])
/** A data set's identity and drawing order: moved whole, never left out. */
const IDENTITY = new Set(['color', 'yAxis', 'pointLabels', 'markOrder'])
const has = (o: unknown, k: string): boolean =>
  typeof o === 'object' && o !== null && Object.hasOwn(o, k)
const nonEmpty = <T extends object>(o: T): T | undefined => (Object.keys(o).length ? o : undefined)

/** The front-to-back kinds of mark: the chosen ones, then the others in default order. */
const markOrder = (chosen: readonly MarkLayer[] | undefined, d: readonly MarkLayer[]) => {
  const out: MarkLayer[] = []
  for (const l of [...(chosen ?? []), ...d]) if (!out.includes(l)) out.push(l)
  return out
}

/** One role of a v1 graph: a layer, if anything uses it. */
interface Role {
  id: string
  geom: Layer['geom']
  /** The stat of the graph's defaults (no key) or of one data set. */
  stat: (k?: string) => Stat
  /** Whether v1 draws the role for the defaults (no key) or for one data set. */
  shows: (k?: string) => boolean
  /** Emit even when nothing shows (its formats feed the legend, its stat the axis range). */
  keep?: boolean
  visible?: false
  /** Drawn once for the graph, not per data set: not shown means `visible: false`. */
  graphLevel?: boolean
  position?: Position
  on?: string
  data?: Layer['data']
  aes?: Layer['aes']
  /** Style fields from graph-wide v1 settings, under the copied ones. */
  graphStyle?: LayerStyle
  /** Fields never copied from v1 series styles (settings v1 ignores for this graph type). */
  ignore?: readonly string[]
  /** Where styles come from: the graph's defaults and per-data-set styles (default), or curves. */
  styles?: { defaults: SeriesStyle | undefined; per: Record<string, SeriesStyle | undefined> }
}

/**
 * Compiles a v1 graph into a frame and layers drawing exactly what v1 draws. `table` is the
 * graph's source (data or result table) when known: it settles the before-after connectors' look
 * (the first data set's error bar line) and a few approximations noted in the report.
 */
export function compileV1(graph: GraphNodeV1, table?: DataTable): CompiledGraph {
  const type = graph.graphType
  const family = type.split('.')[0]!
  const report: MigrationNote[] = []
  const note = (kind: MigrationNote['kind'], text: string) => report.push({ kind, text })
  const frozen = V1[type]
  const S: SeriesStyle = graph.style.seriesDefaults ?? {}
  const O = graph.seriesOverrides
  const keys = Object.keys(O)

  /** Fields of v1 style sections the compilation read or copied (the others are reported). */
  const used = new WeakMap<object, Set<string>>()
  const use = (part: unknown, field: string) => {
    if (typeof part !== 'object' || part === null) return
    let fields = used.get(part)
    if (!fields) {
      fields = new Set()
      used.set(part, fields)
    }
    fields.add(field)
  }

  /** A v1 series style field: frozen theme → graph defaults → the data set's own (if a key). */
  // biome-ignore lint/suspicious/noExplicitAny: v1 fields are read by name; each use knows its type
  const f = (section: keyof V1Defaults & keyof SeriesStyle, field: string, k?: string): any => {
    let v = (frozen[section] as Record<string, unknown> | undefined)?.[field]
    const all = S[section]
    use(all, field)
    if (has(all, field)) v = (all as Record<string, unknown>)[field]
    const own = k === undefined ? undefined : O[k]?.[section]
    use(own, field)
    if (has(own, field)) v = (own as Record<string, unknown>)[field]
    return v
  }
  const center = (k?: string): string => f('center', 'stat', k)
  /** A summary's centre: v1's 'none' still puts bars and error bars at the mean. */
  const sumCenter = (k?: string) => {
    const c = center(k)
    return (c === 'none' ? 'mean' : c) as 'mean' | 'median' | 'geomean'
  }
  const err = (k?: string): ErrorStat => f('error', 'stat', k)
  const shown =
    (section: 'points' | 'line' | 'label' | 'spaghetti' | 'area' | 'envelope') => (k?: string) =>
      !!f(section, 'show', k)

  const layers: Layer[] = []
  /** Copies of the styles a role's layer takes from v1 series styles. */
  const copyStyle = (role: Role, layer: Pick<Layer, 'geom' | 'stat' | 'data'>) => {
    const fields = Object.entries(sectionsOf(layer)).filter(
      ([name]) => !role.ignore?.includes(name),
    )
    return (src: SeriesStyle | undefined): LayerStyle | undefined => {
      if (!src) return undefined
      let out: LayerStyle | undefined
      for (const [name, [section, field]] of fields) {
        const part = src[section]
        if (!has(part, field)) continue
        use(part, field)
        out ??= {}
        out[name] = (part as Record<string, unknown>)[field]
      }
      return out
    }
  }
  const emit = (role: Role) => {
    const stat0 = role.stat()
    const d = role.shows()
    const styles = role.styles ?? { defaults: S, per: O }
    const ids = Object.keys(styles.per)
    const shape = { geom: role.geom, stat: stat0, data: role.data } as Layer
    const copy = copyStyle(role, shape)
    const style = { ...role.graphStyle, ...copy(styles.defaults) }
    const series: Record<string, Record<string, unknown>> = {}
    let any = d
    for (const k of ids) {
      const e = role.shows(k)
      any ||= e
      const entry: Record<string, unknown> = {}
      if (e !== d) entry.hide = !e
      const own = copy(styles.per[k])
      if (own) entry.style = own
      const stat = statDiff(stat0, role.stat(k))
      if (stat) entry.stat = stat
      if (Object.keys(entry).length) series[k] = entry
    }
    const styled = Object.keys(style).length > 0 || ids.some((k) => series[k]?.style)
    if (!any && !role.keep && !styled) return
    layers.push({
      id: role.id,
      geom: role.geom,
      stat: stat0,
      ...(role.data ? { data: role.data } : {}),
      ...(role.position ? { position: role.position } : {}),
      ...(role.on && layers.some((l) => l.id === role.on) ? { on: role.on } : {}),
      ...(role.aes ? { aes: role.aes } : {}),
      ...(role.visible === false ? { visible: false } : {}),
      ...(d ? {} : role.graphLevel ? { visible: false } : { seriesHidden: true }),
      ...(Object.keys(style).length ? { style } : {}),
      ...(Object.keys(series).length ? { series } : {}),
    } as Layer)
  }

  // --- Graph-wide style and identities ------------------------------------------------------
  const st = graph.style
  const identity = (s: SeriesStyle | undefined): SeriesIdentity => {
    const out: SeriesIdentity = {}
    if (s?.color !== undefined) out.color = s.color
    if (s?.yAxis !== undefined) out.yAxis = s.yAxis
    if (s?.pointLabels !== undefined) out.pointLabels = s.pointLabels
    return out
  }
  const style: GraphStyle = {}
  for (const k of ['text', 'palette', 'frame', 'background', 'plotBackground', 'bracket'] as const)
    if (st[k] !== undefined) (style as Record<string, unknown>)[k] = st[k]
  const defaultsIdentity = nonEmpty(identity(S))
  if (defaultsIdentity) style.seriesDefaults = defaultsIdentity
  const seriesOverrides: Record<string, SeriesIdentity> = {}
  for (const k of keys) {
    const id = identity(O[k])
    if (Object.keys(id).length) seriesOverrides[k] = id
  }
  const scales: NonNullable<GraphNode['scales']> = {}
  const axes = { ...graph.axes }

  /** Front-to-back ids per kind of mark, for the defaults (no key) or one data set. */
  let kindIds: (kind: MarkLayer, k?: string) => string[] = () => []
  let frame: Frame = FRAME[family] ?? 'category'

  // Settings v1 ignores for this graph type.
  const unused = (what: string, present: unknown) => {
    if (present !== undefined) note('dropped', `${what}: not used by ${type} graphs`)
  }
  const isColumn = family === 'column'
  const orientable = family === 'column' || family === 'grouped'
  if (orientable && st.orientation !== undefined) style.orientation = st.orientation
  else unused('style.orientation', st.orientation)
  if (orientable && st.categoryGap !== undefined) style.categoryGap = st.categoryGap
  else unused('style.categoryGap', st.categoryGap)
  if (family !== 'grouped') unused('style.arrangement / stack', st.arrangement ?? st.stack)
  if (!isColumn) unused('style.nested', st.nested)
  if (!isColumn) unused('style.grandMean', st.grandMean)
  if (type !== 'column.estimation') unused('style.estimation', st.estimation)
  if (family !== 'bubble') unused('style.bubble', st.bubble)
  if (family !== 'whole') unused('style.pie', st.pie)
  if (family !== 'heatmap') unused('style.heatmap', st.heatmap)
  if (family !== 'xy' && graph.extraSeries.length) unused('extraSeries', graph.extraSeries)
  if (family !== 'xy') unused('functions', graph.functions?.length ? graph.functions : undefined)

  if (isColumn) compileColumn()
  else if (family === 'grouped') compileGrouped()
  else if (family === 'xy') compileXY()
  else if (family === 'survival') compileSurvival()
  else if (family === 'bubble') compileBubble()
  else if (family === 'whole') compileWhole()
  else compileHeatmap()

  // --- Drawing order in the series plane ---------------------------------------------------
  // v1 draws each data set's marks by kind (`markOrder`, front to back): the layer list (back to
  // front) follows the graph's defaults, and a data set drawn otherwise gets its own `order`.
  const emitted = new Set(layers.map((l) => l.id))
  const frontToBack = (k?: string) => {
    const own = k === undefined ? S.markOrder : (O[k]?.markOrder ?? S.markOrder)
    const kinds = markOrder(own, frozen.markOrder)
    return ['labels', ...kinds.flatMap((kind) => kindIds(kind, k).reverse())].filter((id) =>
      emitted.has(id),
    )
  }
  const ordered = frontToBack()
  const rank = new Map(ordered.map((id, i) => [id, -i]))
  // Layers of other planes first (as emitted), then the series plane back to front.
  layers.sort((a, b) => (rank.get(a.id) ?? -1e9) - (rank.get(b.id) ?? -1e9))
  for (const k of keys) {
    const own = frontToBack(k)
    if (own.join() !== ordered.join()) seriesOverrides[k] = { ...seriesOverrides[k], order: own }
  }
  if (family !== 'column' && family !== 'grouped' && family !== 'xy') {
    if (S.markOrder || keys.some((k) => O[k]?.markOrder)) unused('markOrder', true)
  }

  // v1 style settings nothing drew (sections of marks this graph type has not, as a bar's fill
  // kept on a scatter graph after a type change): left out, and reported.
  const lost = (whose: string, src: SeriesStyle | undefined) => {
    for (const [section, part] of Object.entries(src ?? {})) {
      if (IDENTITY.has(section) || typeof part !== 'object' || part === null) continue
      const d = (frozen as unknown as Record<string, Record<string, unknown> | undefined>)[section]
      const fields = Object.entries(part as Record<string, unknown>)
        .filter(([k, v]) => v !== undefined && !used.get(part)?.has(k) && d?.[k] !== v)
        .map(([k]) => k)
      if (fields.length)
        note('dropped', `${section} (${fields.join(', ')}) of ${whose}: not used by ${type} graphs`)
    }
  }
  lost('every data set', S)
  for (const k of keys) lost('a data set', O[k])
  if (family === 'xy') {
    for (const e of graph.extraSeries) lost('a curve', e.style)
    for (const fc of graph.functions ?? []) lost('a function', fc.style)
  }
  const dropped = new Set<string>()
  for (let i = report.length - 1; i >= 0; i--) {
    const n = report[i]!
    if (n.kind !== 'dropped') continue
    if (dropped.has(n.text)) report.splice(i, 1)
    dropped.add(n.text)
  }

  const out: GraphNode = {
    kind: 'graph',
    id: graph.id,
    name: graph.name,
    frame,
    layers,
    look: type,
    drawOrder: 'series',
    seriesSource: graph.seriesSource,
    seriesOverrides,
    ...(graph.pointOverrides ? { pointOverrides: graph.pointOverrides } : {}),
    size: graph.size,
    axes,
    annotations: graph.annotations,
    legend: graph.legend,
    title: graph.title,
    ...(graph.titleOffset ? { titleOffset: graph.titleOffset } : {}),
    style,
    ...(Object.keys(scales).length ? { scales } : {}),
    ...(graph.links ? { links: graph.links } : {}),
    ...(graph.notes !== undefined ? { notes: graph.notes } : {}),
  }
  return { graph: out, report }

  // --- Column graphs (and nested, and multiple variables as columns) -----------------------
  function compileColumn() {
    const isBar = type === 'column.bar'
    const isBox = type === 'column.box'
    const pairs = type === 'column.beforeAfter'
    const est = type === 'column.estimation'
    const nested = st.nested ?? {}
    const sideBySide = !pairs && nested.layout === 'subjects'
    const bySubject: Position | undefined = sideBySide
      ? { kind: 'dodge', by: 'subject' }
      : undefined
    const mark = pairs ? 'none' : (nested.mark ?? 'none')
    const kind = (k?: string): string => f('box', 'kind', k)
    const summary = (k?: string): Stat => ({ kind: 'summary', center: sumCenter(k) })

    if (st.grandMean?.show)
      emit({
        id: 'grandMean',
        geom: 'refline',
        stat: () => ({ kind: 'summary', center: 'mean', by: 'all' }),
        shows: () => true,
        graphStyle: st.grandMean.line ? { line: st.grandMean.line } : undefined,
        styles: { defaults: undefined, per: {} },
      })
    else if (st.grandMean?.line) note('dropped', 'style.grandMean.line: the grand mean is off')
    if (est)
      emit({
        id: 'diff',
        geom: 'difference',
        stat: () => ({ kind: 'difference', ci: st.estimation?.ci ?? 'pooled' }),
        shows: () => true,
        keep: true,
        graphStyle:
          st.estimation?.guides !== undefined ? { guides: st.estimation.guides } : undefined,
      })
    if (pairs) {
      // The connectors take the first data set's error bar line.
      const first = table ? firstKey(graph, table) : undefined
      let line: unknown
      for (const src of [S, first === undefined ? undefined : O[first]])
        if (has(src?.error, 'line')) line = src!.error!.line
      if (!table && keys.some((k) => has(O[k]?.error, 'line')))
        note('approximated', 'before–after lines: the first data set’s error bar line is unknown')
      emit({
        id: 'pairs',
        geom: 'connector',
        stat: () => ({ kind: 'identity' }),
        shows: () => true,
        keep: true,
        graphStyle: line !== undefined ? { line } : undefined,
        styles: { defaults: undefined, per: {} },
      })
    }
    if (isBar) emit({ id: 'bars', geom: 'bar', stat: summary, shows: () => true, keep: true })
    if (isBox) {
      emit({
        id: 'violin',
        geom: 'violin',
        stat: (k) => ({
          kind: 'density',
          smoothing: f('violin', 'smoothing', k),
          extent: f('violin', 'extent', k),
          center: center(k) as never,
        }),
        shows: (k) => kind(k) === 'violin',
      })
      emit({
        id: 'box',
        geom: 'box',
        stat: (k) =>
          kind(k) === 'floating'
            ? { kind: 'range', center: sumCenter(k) }
            : { kind: 'boxplot', whiskers: f('box', 'whiskers', k) },
        shows: (k) => kind(k) !== 'violin',
      })
    }
    emit({
      id: 'points',
      geom: 'points',
      stat: () => ({ kind: 'identity' }),
      shows: pairs ? () => true : shown('points'),
      keep: true,
      ...(bySubject ? { position: bySubject } : {}),
      graphStyle: {
        ...(mark !== 'none' ? { subjects: mark } : {}),
        ...(pairs ? { spread: 'none' } : {}),
      },
      ...(pairs ? { ignore: ['spread'] } : {}),
    })
    if (!pairs && nested.subjectMeans)
      emit({
        id: 'subjectMeans',
        geom: 'center',
        stat: () => ({ kind: 'summary', center: 'mean', by: 'subject' }),
        shows: () => true,
        ...(bySubject ? { position: bySubject } : {}),
        graphStyle: mark === 'shade' ? { subjects: 'shade' } : undefined,
        ignore: ['width'],
      })
    if (!isBox)
      emit({
        id: 'error',
        geom: 'errorbar',
        stat: (k) => ({ kind: 'summary', center: sumCenter(k), error: err(k) }),
        shows: () => true,
        keep: true,
        ...(isBar ? { on: 'bars' } : {}),
      })
    if (type === 'column.scatter' || est)
      emit({
        id: 'center',
        geom: 'center',
        stat: summary,
        shows: (k) => center(k) !== 'none',
        ...(bySubject ? { position: bySubject } : {}),
      })
    emit({
      id: 'labels',
      geom: 'label',
      stat: summary,
      shows: shown('label'),
      ...(isBar ? { on: 'bars' } : {}),
    })
    kindIds = (kind) =>
      kind === 'bar'
        ? ['bars', 'violin', 'box']
        : kind === 'points'
          ? ['points']
          : kind === 'center'
            ? ['subjectMeans', 'center']
            : kind === 'error'
              ? ['error']
              : []
  }

  // --- Grouped graphs (and contingency) ------------------------------------------------------
  function compileGrouped() {
    const isBar = type === 'grouped.bar'
    const isBox = type === 'grouped.box'
    const isScatter = type === 'grouped.scatter'
    const stacked = isBar && st.arrangement === 'stacked'
    const position: Position =
      stacked || st.arrangement === 'aligned' ? { kind: 'aligned' } : { kind: 'dodge' }
    if (!isBar && st.arrangement === 'stacked')
      note('dropped', 'style.arrangement: only bars stack')
    if (!stacked) unused('style.stack', st.stack)
    const mean = (k?: string) => isScatter && f('points', 'replicates', k) === 'mean'
    const summary = (k?: string): Stat => ({ kind: 'summary', center: sumCenter(k) })
    const kind = (k?: string): string => f('box', 'kind', k)

    emit({
      id: 'line',
      geom: 'line',
      stat: summary,
      shows: (k) => !isBox && !!f('line', 'show', k),
      position,
      ...(stacked ? { visible: false } : {}),
    })
    if (isBox) {
      emit({
        id: 'violin',
        geom: 'violin',
        stat: (k) => ({
          kind: 'density',
          smoothing: f('violin', 'smoothing', k),
          extent: f('violin', 'extent', k),
          center: center(k) as never,
        }),
        shows: (k) => kind(k) === 'violin',
        position,
      })
      emit({
        id: 'box',
        geom: 'box',
        stat: (k) =>
          kind(k) === 'floating'
            ? { kind: 'range', center: sumCenter(k) }
            : { kind: 'boxplot', whiskers: f('box', 'whiskers', k) },
        shows: (k) => kind(k) !== 'violin',
        position,
      })
    }
    if (isBar) {
      const stack = st.stack ?? {}
      emit({
        id: 'bars',
        geom: 'bar',
        stat: summary,
        shows: () => true,
        keep: true,
        position: stacked
          ? {
              kind: 'stack',
              ...(stack.percent ? { percent: true } : {}),
              ...(stack.gap !== undefined ? { gap: stack.gap } : {}),
            }
          : position,
      })
    }
    emit({
      id: 'points',
      geom: 'points',
      stat: (k) => (mean(k) ? summary(k) : { kind: 'identity' }),
      shows: shown('points'),
      keep: true,
      position,
      ...(stacked ? { visible: false } : {}),
    })
    if (
      isBar &&
      !stacked &&
      [undefined, ...keys].some(
        (k) => f('points', 'replicates', k) === 'mean' && shown('points')(k),
      )
    )
      note(
        'approximated',
        'points on grouped bars (mean replicates) now count in the Y axis range, as everything drawn does',
      )
    if (!isBox)
      emit({
        id: 'error',
        geom: 'errorbar',
        stat: (k) => ({ kind: 'summary', center: sumCenter(k), error: err(k) }),
        shows: () => true,
        keep: true,
        position,
        ...(isBar ? { on: 'bars' } : {}),
      })
    if (isScatter)
      emit({
        id: 'center',
        geom: 'center',
        stat: summary,
        shows: (k) => center(k) !== 'none' && !(mean(k) && shown('points')(k)),
        position,
      })
    emit({
      id: 'labels',
      geom: 'label',
      stat: summary,
      shows: shown('label'),
      position,
      ...(isBar ? { on: 'bars' } : {}),
    })
    kindIds = (kind, k) =>
      kind === 'line'
        ? ['line']
        : kind === 'bar'
          ? ['violin', 'box', 'bars']
          : kind === 'points'
            ? mean(k)
              ? []
              : ['points']
            : kind === 'error'
              ? ['error']
              : kind === 'center'
                ? [...(mean(k) ? ['points'] : []), 'center']
                : []
  }

  // --- XY graphs -------------------------------------------------------------------------------
  function compileXY() {
    const each = (k?: string) => f('points', 'replicates', k) === 'each'
    const geo = (k?: string) =>
      (center(k) === 'geomean' || GEO_ERRORS.has(err(k)) ? 'geomean' : 'mean') as 'mean' | 'geomean'
    const summary = (k?: string): Stat => ({ kind: 'summary', center: geo(k) })
    const extras = graph.extraSeries
    const fns = graph.functions ?? []
    const envelope = (k?: string) => !!f('envelope', 'show', k) && !each(k)

    // Analysis outputs (fitted curves, bands, output points) and functions.
    if (extras.length) {
      const per = Object.fromEntries(extras.map((e) => [e.id as string, e.style]))
      const curve = (section: 'line' | 'band' | 'points') => (k?: string) => {
        let v = CURVE[section].show
        const own = k === undefined ? undefined : per[k]?.[section]
        use(own, 'show')
        if (has(own, 'show')) v = !!(own as { show?: boolean }).show
        return v
      }
      const styles = { defaults: undefined, per }
      const identityStat = (): Stat => ({ kind: 'identity' })
      const series = extras.map(({ style: _, ...e }) => e)
      emit({
        id: 'curves',
        geom: 'line',
        stat: identityStat,
        shows: curve('line'),
        keep: true,
        data: { from: 'outputs', series },
        styles,
      })
      emit({
        id: 'curveBands',
        geom: 'band',
        stat: identityStat,
        shows: curve('band'),
        data: { from: 'layer', layer: 'curves' },
        styles,
      })
      emit({
        id: 'curvePoints',
        geom: 'points',
        stat: identityStat,
        shows: curve('points'),
        data: { from: 'layer', layer: 'curves' },
        styles,
      })
      for (const e of extras) {
        const id = identity(e.style)
        if (Object.keys(id).length) seriesOverrides[e.id] = id
      }
    }
    if (fns.length) {
      const per = Object.fromEntries(fns.map((fc) => [fc.id as string, fc.style]))
      emit({
        id: 'functions',
        geom: 'line',
        stat: () => ({ kind: 'identity' }),
        shows: (k) => {
          if (k === undefined) return true
          use(per[k]?.line, 'show')
          return has(per[k]?.line, 'show') ? !!per[k]!.line!.show : true
        },
        keep: true,
        data: { from: 'functions', functions: fns.map(({ style: _, ...fc }) => fc) },
        styles: { defaults: undefined, per },
      })
      for (const fc of fns) {
        const id = identity(fc.style)
        if (Object.keys(id).length) seriesOverrides[fc.id] = id
        use(fc.style?.points, 'show')
        if (fc.style?.points?.show)
          note(
            'approximated',
            'function points are not drawn, so the legend no longer shows a symbol for them',
          )
      }
    }

    emit({ id: 'area', geom: 'area', stat: summary, shows: shown('area') })
    emit({
      id: 'envelope',
      geom: 'band',
      stat: (k) => ({ kind: 'summary', center: geo(k), error: err(k) }),
      shows: envelope,
    })
    emit({
      id: 'subjects',
      geom: 'line',
      stat: () => ({ kind: 'identity' }),
      shows: shown('spaghetti'),
    })
    emit({
      id: 'line',
      geom: 'line',
      stat: summary,
      shows: shown('line'),
      keep: extras.some((e) => e.colorOf !== undefined),
    })
    emit({ id: 'bars', geom: 'bar', stat: summary, shows: (k) => !!f('bar', 'show', k) })
    emit({
      id: 'box',
      geom: 'box',
      stat: (k) => ({ kind: 'boxplot', whiskers: f('box', 'whiskers', k) }),
      shows: (k) => !!f('box', 'show', k),
    })
    emit({
      id: 'error',
      geom: 'errorbar',
      stat: (k) => ({ kind: 'summary', center: geo(k), error: envelope(k) ? 'none' : err(k) }),
      shows: (k) => !each(k),
      keep: [undefined, ...keys].some((k) => !each(k)),
    })
    emit({
      id: 'points',
      geom: 'points',
      stat: (k) => (each(k) ? { kind: 'identity' } : summary(k)),
      shows: shown('points'),
      keep: true,
    })
    emit({ id: 'labels', geom: 'label', stat: summary, shows: shown('label') })
    if (table && table.yFormat.type !== 'replicates' && [undefined, ...keys].some((k) => each(k)))
      note(
        'approximated',
        'every replicate of entered means: the Y axis range now reaches only what is drawn (no error bars)',
      )
    kindIds = (kind) =>
      kind === 'line'
        ? ['subjects', 'line']
        : kind === 'bar'
          ? ['bars', 'box']
          : kind === 'error'
            ? ['error']
            : kind === 'points'
              ? ['points']
              : []
  }

  function compileSurvival() {
    const km = (): Stat => ({ kind: 'km' })
    emit({ id: 'ciBand', geom: 'band', stat: km, shows: (k) => !!f('band', 'show', k) })
    emit({ id: 'curve', geom: 'step', stat: km, shows: shown('line'), keep: true })
    emit({ id: 'censor', geom: 'censor', stat: km, shows: shown('points') })
    unused('axes.y2', axes.y2)
    delete axes.y2
  }

  function compileBubble() {
    const b = st.bubble ?? {}
    // Mapped (an empty mapping: X and Y are the first two variables).
    const aes = {
      ...(b.x ? { x: b.x } : {}),
      ...(b.y ? { y: b.y } : {}),
      ...(b.size ? { size: b.size } : {}),
      ...(b.color ? { color: b.color } : {}),
    }
    emit({
      id: 'bubbles',
      geom: 'points',
      stat: () => ({ kind: 'identity' }),
      shows: () => true,
      keep: true,
      aes,
    })
    const size = nonEmpty({
      ...(b.maxSize !== undefined ? { max: b.maxSize } : {}),
      ...(b.minSize !== undefined ? { min: b.minSize } : {}),
    })
    if (size) scales.size = size
    if (b.colors) scales.color = { colors: b.colors }
    unused('axes.y2', axes.y2)
    delete axes.y2
  }

  function compileWhole() {
    const pie = st.pie ?? {}
    const bars = type === 'whole.bar'
    if (!bars) {
      frame = 'polar'
      const polar = nonEmpty({
        ...(pie.hole !== undefined ? { hole: pie.hole } : {}),
        ...(pie.startAngle !== undefined ? { startAngle: pie.startAngle } : {}),
        ...(pie.clockwise !== undefined ? { clockwise: pie.clockwise } : {}),
      })
      if (polar) style.polar = polar
    } else unused('style.pie (hole, angle, direction)', pie.hole ?? pie.startAngle ?? pie.clockwise)
    const fraction = (): Stat => ({ kind: 'fraction' })
    const host = bars ? 'segments' : 'slices'
    emit({
      id: host,
      geom: bars ? 'bar' : 'wedge',
      stat: fraction,
      shows: () => true,
      keep: true,
      ...(bars ? { position: { kind: 'stack', percent: true } } : {}),
    })
    const labels = nonEmpty({
      ...(pie.labels !== undefined && pie.labels !== 'none' ? { content: pie.labels } : {}),
      ...(!bars && pie.labelPosition !== undefined ? { position: pie.labelPosition } : {}),
      ...(pie.digits !== undefined ? { digits: pie.digits } : {}),
    })
    if (bars) unused('style.pie.labelPosition', pie.labelPosition)
    emit({
      id: 'labels',
      geom: 'label',
      stat: fraction,
      shows: () => true,
      keep: true,
      on: host,
      ...(pie.labels === 'none' ? { visible: false } : {}),
      graphStyle: labels,
      styles: { defaults: undefined, per: {} },
    })
  }

  function compileHeatmap() {
    const h = st.heatmap ?? {}
    const cluster = nonEmpty({
      ...(h.clusterRows !== undefined ? { rows: h.clusterRows } : {}),
      ...(h.clusterColumns !== undefined ? { columns: h.clusterColumns } : {}),
      ...(h.distance !== undefined ? { distance: h.distance } : {}),
      ...(h.linkage !== undefined ? { linkage: h.linkage } : {}),
      ...(h.dendrogram !== undefined ? { dendrogram: h.dendrogram } : {}),
    })
    const tile = nonEmpty({
      ...(h.missing !== undefined ? { missing: h.missing } : {}),
      ...(h.border !== undefined ? { border: h.border } : {}),
      ...(cluster ? { cluster } : {}),
    })
    emit({
      id: 'cells',
      geom: 'tile',
      stat: () => ({ kind: 'cell', ...(h.standardize ? { standardize: h.standardize } : {}) }),
      shows: () => true,
      keep: true,
      graphStyle: tile,
      styles: { defaults: undefined, per: {} },
    })
    const l = h.labels ?? {}
    emit({
      id: 'values',
      geom: 'label',
      stat: () => ({ kind: 'cell' }),
      shows: () => !!l.show,
      graphLevel: true,
      on: 'cells',
      graphStyle: nonEmpty({
        ...(l.format !== undefined ? { format: l.format } : {}),
        ...(l.text !== undefined ? { text: l.text } : {}),
      }),
      styles: { defaults: undefined, per: {} },
    })
    const color = nonEmpty({
      ...(h.colors !== undefined ? { colors: h.colors } : {}),
      ...(h.reverse !== undefined ? { reverse: h.reverse } : {}),
      ...(h.min !== undefined ? { min: h.min } : {}),
      ...(h.max !== undefined ? { max: h.max } : {}),
      ...(h.midpoint !== undefined ? { midpoint: h.midpoint } : {}),
      ...(h.colorBar !== undefined ? { bar: h.colorBar } : {}),
    })
    if (color) scales.color = color
  }
}

/** The parameters of `b` that differ from `a` (kind included), or undefined when none do. */
function statDiff(a: Stat, b: Stat): StatParams | undefined {
  const out: Record<string, unknown> = {}
  const A = a as Record<string, unknown>
  for (const [k, v] of Object.entries(b)) if (v !== undefined && A[k] !== v) out[k] = v
  return nonEmpty(out) as StatParams | undefined
}

/** The graph's first data set (as the graph's series list has it): numeric, included, present. */
function firstKey(graph: GraphNodeV1, table: DataTable): string | undefined {
  const include = graph.seriesSource.include
  const keys = include === 'all' ? table.dataSets.map((d) => d.id as string) : include
  return keys.find((k) => {
    const col = table.dataSets.find((d) => d.id === k)
    return col && !col.text
  })
}

// --- Where each layer style field comes from in v1 (frozen copy of 33b's `styleSections`) ------

type Sections = Readonly<Record<string, readonly [StyleSection, string]>>

const fields = (section: StyleSection, names: readonly string[]) =>
  Object.fromEntries(names.map((n) => [n, [section, n] as const]))
const POINT_FIELDS = { ...fields('points', ['shape', 'size', 'fill', 'border']) }

const sectionsCache = new Map<string, Sections>()

/** The v1 section and field each style field of a layer is copied from. */
function sectionsOf(layer: Pick<Layer, 'geom' | 'stat' | 'data'>): Sections {
  const table = !layer.data || layer.data.from === 'table'
  const key = `${layer.geom}:${layer.stat.kind}:${table}`
  let out = sectionsCache.get(key)
  if (!out) {
    out = sectionTable(layer.geom, layer.stat.kind, table)
    sectionsCache.set(key, out)
  }
  return out
}

/** Exported for the test that today's `styleSections` still agrees with this frozen copy. */
export function v1SectionTable(geom: Geom, stat: StatKind, table: boolean): Sections {
  return sectionTable(geom, stat, table)
}

function sectionTable(geom: Geom, stat: StatKind, table: boolean): Sections {
  switch (geom) {
    case 'points':
      return {
        ...POINT_FIELDS,
        spread: ['points', 'jitter'],
        excludedStyle: ['points', 'excludedStyle'],
      }
    case 'bar':
      return fields('bar', ['fill', 'border', 'width', 'binWidth', 'baseline'])
    case 'errorbar':
      return fields('error', ['direction', 'capWidth', 'line', 'x'])
    case 'center':
      return fields('center', ['line', 'width'])
    case 'box':
      return {
        ...fields('box', ['fill', 'border']),
        width: ['bar', 'width'],
        capWidth: ['error', 'capWidth'],
        centerLine: ['center', 'line'],
        outlierShape: ['points', 'shape'],
        outlierSize: ['points', 'size'],
        outlierFill: ['points', 'fill'],
        outlierBorder: ['points', 'border'],
      }
    case 'violin':
      return {
        ...fields('box', ['fill', 'border']),
        width: ['bar', 'width'],
        ...fields('violin', ['quartiles', 'quartileLine']),
        centerLine: ['center', 'line'],
      }
    case 'line':
      // A line through each replicate of the table's data sets ("spaghetti").
      if (table && stat === 'identity')
        return { ...fields('spaghetti', ['stroke', 'fade']), gaps: ['line', 'gaps'] }
      return fields('line', ['stroke', 'gaps'])
    case 'step':
      return fields('line', ['stroke'])
    case 'censor':
      return fields('points', ['size', 'border'])
    case 'area':
      return { ...fields('area', ['opacity', 'baseline']), gaps: ['line', 'gaps'] }
    case 'band':
      // An error envelope along the table's line, else a confidence band.
      if (table && stat === 'summary')
        return { opacity: ['envelope', 'opacity'], gaps: ['line', 'gaps'] }
      return fields('band', ['opacity'])
    case 'connector':
      return { line: ['error', 'line'] }
    case 'difference':
      return { ...POINT_FIELDS, line: ['error', 'line'], capWidth: ['error', 'capWidth'] }
    case 'wedge':
      return fields('bar', ['fill', 'border'])
    case 'label':
      return stat === 'summary'
        ? { value: ['label', 'stat'], ...fields('label', ['position', 'format', 'text']) }
        : {}
    default:
      return {}
  }
}
