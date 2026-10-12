import { categoryKeyParts, rowCategoryKey, rowOfCategoryKey } from './axisExtras.ts'
import type { Annotation, AxisSpec, PointLabels } from './graph.ts'
import { categoryEntryKey, parsePointKey, pointKey, rowOfCategoryEntryKey } from './graph.ts'
import type { NodeId, SeriesId } from './ids.ts'
import type { GraphNode, Layer, LayerData, LayerId, OutputSeries } from './layers.ts'
import { isLevelKey } from './levels.ts'

// Every reference a graph makes (roadmap 33b, decision 241): the nodes it reads (its source, the
// analyses whose outputs its layers draw, the analyses labelling its brackets), the series keys
// it names (data sets of its source, outputs, functions) and the table rows it names. Every
// walker — node references and removal, reuse remapping, families, methods, row edits, data
// export — goes through `graphRefs` / `mapGraphRefs`, so a new place holding a reference is
// added here once (a test checks this against a walk of the schema).

/** Where a reference is in the graph node. */
export type RefPath = (string | number)[]

/**
 * What a series key names: a data set of the source table, an analysis output, a function, or a
 * level of a text variable (a category or group of a graph of variables, `levelKey`).
 */
export type SeriesKind = 'dataSet' | 'output' | 'function' | 'level'

/** Places that name a series by its key. */
export type KeyRole =
  /** `seriesSource.include[i]`. */
  | 'include'
  /** A key of `seriesOverrides` (a series' identity). */
  | 'identity'
  /** A key of `pointOverrides` (single points of a series). */
  | 'points'
  /** A key of a layer's `series` (that series' style and stat in the layer). */
  | 'layerSeries'
  /** An output's `colorOf` (the data set whose colour a curve takes). */
  | 'colorOf'
  /** A variable a layer maps to an aesthetic (`aes.x`…). */
  | 'aes'
  /**
   * A variable on a graph's axes or mapped to appearance (`mapping.x`, `y`, `color`; roadmap 34a;
   * `shape`, `size`, `label`, 34b; `fill`, 49d).
   */
  | 'mapping'
  /** A level's key in `scales.shape.levels` (its symbol; roadmap 34b). */
  | 'shapes'
  /** A text variable whose levels the graph orders (a key of `levels`). */
  | 'levels'
  /**
   * `legend.hidden[i]`, and (roadmap 47b) `legend.order[i]` and a key of `legend.labels`: entry
   * keys, the same in all three.
   */
  | 'legend'
  /**
   * Roadmap 34d: the text variable a graph's rows are filtered by and its level's key
   * (`seriesSource.filter`), and the variable a set of split graphs is split by (`split.variable`).
   */
  | 'filter'
  | 'split'
  /**
   * Roadmap 36: a data set naming a category (or a bar within a group) of a treatment grid's
   * cells or a span of category labels (`CategoryKey`).
   */
  | 'categories'

/** Places that name table rows by index. */
export type RowRole =
  /** `seriesSource.rows`: the rows shown, in order. */
  | 'slice'
  /** `pointLabels.rows` of a series' identity or of the identity defaults. */
  | 'pointLabels'

export type GraphRef =
  /** The table (or analysis, for its result table) the graph's series come from. */
  | { kind: 'source'; node: NodeId; path: RefPath }
  /** An analysis output drawn by an outputs layer; `path` is the `OutputSeries`. */
  | { kind: 'output'; node: NodeId; key: string; id: SeriesId; layer: LayerId; path: RefPath }
  /** A bracket between two series (rows on grouped graphs); `path` is the annotation. */
  | { kind: 'bracket'; annotation: Extract<Annotation, { type: 'bracket' }>; path: RefPath }
  /**
   * Roadmap 35: an analysis whose results a layer draws (labels, lines, bands: `path` is the
   * layer's `data.analysis`) or a table shows (`path` is the annotation's `analysis`).
   */
  | { kind: 'analysis'; node: NodeId; path: RefPath }
  /**
   * Roadmap 35: a key naming a value or comparison of those results ('slope:<data set>',
   * '<a>|<b>'), which may hold data set ids; `path` is the reference's `key`.
   */
  | { kind: 'resultKey'; key: string; path: RefPath }
  /** A series named by its key. */
  | { kind: 'key'; key: string; role: KeyRole; of: SeriesKind; path: RefPath }
  /** Table rows named by index. */
  | { kind: 'rows'; rows: readonly number[]; role: RowRole; path: RefPath }
  /** Single-point formats of a series, keyed by table row (`r<row>`, `r<row>s<sub>`). */
  | { kind: 'pointRows'; key: string; points: readonly string[]; path: RefPath }
  /**
   * Roadmap 36: a category key (`CategoryKey`: a series key, a grouped table's row `@<row>`, a
   * bar `<group>/<series>`) of a treatment grid's cells (`role` 'cells', the record's key), a
   * renamed span ('rename', the record's key) or a typed span's categories ('span').
   */
  | { kind: 'category'; key: string; role: 'cells' | 'rename' | 'span'; path: RefPath }

/** The data a layer draws: its own, or (`from: 'layer'`) the data of the layer it names. */
export function layerData(graph: Pick<GraphNode, 'layers'>, layer: Layer): LayerData {
  let data = layer.data ?? { from: 'table' as const }
  const seen = new Set<string>([layer.id])
  while (data.from === 'layer') {
    const id: string = data.layer
    const next = graph.layers.find((l) => l.id === id)
    if (!next || seen.has(next.id)) return { from: 'table' }
    seen.add(next.id)
    data = next.data ?? { from: 'table' }
  }
  return data
}

/** Every analysis output a graph's layers draw, in layer order. */
export function graphOutputs(
  graph: Pick<GraphNode, 'layers'>,
): { layer: Layer; index: number; series: OutputSeries }[] {
  return graph.layers.flatMap((layer) =>
    layer.data?.from === 'outputs'
      ? layer.data.series.map((series, index) => ({ layer, index, series }))
      : [],
  )
}

/** The ids of a graph's outputs and functions, by kind. */
function seriesKinds(graph: Pick<GraphNode, 'layers'>): (key: string) => SeriesKind {
  const outputs = new Set<string>()
  const functions = new Set<string>()
  for (const l of graph.layers) {
    if (l.data?.from === 'outputs') for (const s of l.data.series) outputs.add(s.id)
    if (l.data?.from === 'functions') for (const f of l.data.functions) functions.add(f.id)
  }
  return (key) =>
    outputs.has(key)
      ? 'output'
      : functions.has(key)
        ? 'function'
        : isLevelKey(key)
          ? 'level'
          : 'dataSet'
}

/** The fields of a graph's mapping naming variables (roadmap 34a, 34b). */
const MAPPED_FIELDS = ['x', 'y', 'color', 'fill', 'shape', 'size', 'label'] as const

/** Every reference of a graph (see the module comment), in document order. */
export function graphRefs(graph: GraphNode): GraphRef[] {
  const out: GraphRef[] = []
  const of = seriesKinds(graph)
  const key = (k: string, role: KeyRole, path: RefPath) => {
    out.push({ kind: 'key', key: k, role, of: of(k), path })
  }
  const labels = (p: PointLabels | undefined, path: RefPath) => {
    if (p?.rows) out.push({ kind: 'rows', rows: p.rows, role: 'pointLabels', path })
  }

  const src = graph.seriesSource
  out.push({ kind: 'source', node: src.table, path: ['seriesSource', 'table'] })
  if (Array.isArray(src.include))
    src.include.forEach((k, i) => {
      key(k, 'include', ['seriesSource', 'include', i])
    })
  if (src.rows)
    out.push({ kind: 'rows', rows: src.rows, role: 'slice', path: ['seriesSource', 'rows'] })
  if (src.filter) {
    key(src.filter.variable, 'filter', ['seriesSource', 'filter', 'variable'])
    key(src.filter.level, 'filter', ['seriesSource', 'filter', 'level'])
  }
  if (graph.split?.variable !== undefined) key(graph.split.variable, 'split', ['split', 'variable'])

  for (const [k, id] of Object.entries(graph.seriesOverrides)) {
    key(k, 'identity', ['seriesOverrides', k])
    labels(id.pointLabels, ['seriesOverrides', k, 'pointLabels', 'rows'])
  }
  labels(graph.style.seriesDefaults?.pointLabels, [
    'style',
    'seriesDefaults',
    'pointLabels',
    'rows',
  ])
  for (const [k, points] of Object.entries(graph.pointOverrides ?? {})) {
    key(k, 'points', ['pointOverrides', k])
    out.push({
      kind: 'pointRows',
      key: k,
      points: Object.keys(points),
      path: ['pointOverrides', k],
    })
  }

  graph.layers.forEach((layer, li) => {
    const at: RefPath = ['layers', li]
    if (layer.data?.from === 'outputs')
      layer.data.series.forEach((s, si) => {
        const path = [...at, 'data', 'series', si]
        out.push({
          kind: 'output',
          node: s.ref.node,
          key: s.ref.key,
          id: s.id,
          layer: layer.id,
          path,
        })
        if (s.colorOf !== undefined) key(s.colorOf, 'colorOf', [...path, 'colorOf'])
      })
    if (layer.data?.from === 'analysis') {
      out.push({ kind: 'analysis', node: layer.data.analysis, path: [...at, 'data', 'analysis'] })
      if (layer.stat.kind === 'result')
        for (const [name, f] of Object.entries(layer.stat.fields))
          if (f.ref.from === 'value' || f.ref.from === 'comparison')
            out.push({
              kind: 'resultKey',
              key: f.ref.key,
              path: [...at, 'stat', 'fields', name, 'ref', 'key'],
            })
    }
    for (const k of Object.keys(layer.series ?? {})) key(k, 'layerSeries', [...at, 'series', k])
    for (const [field, k] of Object.entries(layer.aes ?? {}))
      if (k !== undefined) key(k, 'aes', [...at, 'aes', field])
  })

  for (const axis of ['x', 'y'] as const) {
    const spec = graph.axes[axis]
    if (spec.type !== 'categorical') continue
    spec.treatments?.rows.forEach((row, ri) => {
      for (const k of Object.keys(row.cells))
        out.push({
          kind: 'category',
          key: k,
          role: 'cells',
          path: ['axes', axis, 'treatments', 'rows', ri, 'cells', k],
        })
    })
    for (const k of Object.keys(spec.spans?.rename ?? {}))
      out.push({
        kind: 'category',
        key: k,
        role: 'rename',
        path: ['axes', axis, 'spans', 'rename', k],
      })
    spec.spans?.list?.forEach((span, si) => {
      span.keys.forEach((k, ki) => {
        out.push({
          kind: 'category',
          key: k,
          role: 'span',
          path: ['axes', axis, 'spans', 'list', si, 'keys', ki],
        })
      })
    })
  }

  graph.annotations.forEach((a, i) => {
    if (a.type === 'bracket') out.push({ kind: 'bracket', annotation: a, path: ['annotations', i] })
    if (a.type === 'table')
      out.push({ kind: 'analysis', node: a.analysis, path: ['annotations', i, 'analysis'] })
  })
  graph.legend.hidden?.forEach((k, i) => {
    key(k, 'legend', ['legend', 'hidden', i])
  })
  graph.legend.order?.forEach((k, i) => {
    key(k, 'legend', ['legend', 'order', i])
  })
  for (const k of Object.keys(graph.legend.labels ?? {})) key(k, 'legend', ['legend', 'labels', k])
  if (graph.mapping)
    for (const field of MAPPED_FIELDS) {
      const k = graph.mapping[field]
      if (k !== undefined) key(k, 'mapping', ['mapping', field])
    }
  for (const k of Object.keys(graph.levels ?? {})) key(k, 'levels', ['levels', k])
  for (const k of Object.keys(graph.scales?.shape?.levels ?? {}))
    key(k, 'shapes', ['scales', 'shape', 'levels', k])
  return out
}

/** How `mapGraphRefs` changes a reference. */
export type RefChange<T> = T | 'keep' | 'drop'

export interface RefMapper {
  /** The source table (or analysis): another node. */
  source?: (node: NodeId) => NodeId
  /**
   * An output: another reference, or dropped (with its series everywhere: identity, layer
   * series, point formats, legend). An outputs layer left without outputs goes, with the layers
   * drawing its data.
   */
  output?: (o: OutputSeries) => RefChange<Pick<OutputSeries, 'ref' | 'colorOf'>>
  /** A bracket: changed, or dropped. */
  bracket?: (
    a: Extract<Annotation, { type: 'bracket' }>,
  ) => RefChange<Extract<Annotation, { type: 'bracket' }>>
  /**
   * A data set key (only `of: 'dataSet'` keys are offered): another key, or dropped from where it
   * is (a list entry, a record entry, a field).
   */
  key?: (key: string, role: KeyRole) => RefChange<string>
  /** Rows of a slice or of point labels: another list. */
  rows?: (rows: readonly number[], role: RowRole) => RefChange<number[]>
  /** A table row of a single point's format: another row, or dropped (with the format). */
  row?: (row: number) => number | null
  /**
   * Roadmap 35: an analysis whose results a layer draws or a table shows: another node, or
   * dropped (the layer goes, with the layers attached to it or drawing its data; the table goes).
   */
  analysis?: (node: NodeId) => RefChange<NodeId>
  /**
   * Roadmap 35: a key of a value or comparison those results are read at (`analysis`: the
   * layer's, before `analysis` maps it): another key, or null when what it names is gone (audit 2,
   * M4: a comparison of a deleted row), which drops the field (it reads "—").
   */
  resultKey?: (key: string, analysis: NodeId) => string | null
}

const moveKeys = <V>(
  rec: Record<string, V>,
  map: (k: string) => string | null,
): Record<string, V> | null => {
  let changed = false
  const out: Record<string, V> = {}
  for (const [k, v] of Object.entries(rec)) {
    const to = map(k)
    if (to !== k) changed = true
    if (to !== null) out[to] = v
  }
  return changed ? out : null
}

/**
 * A copy of the graph with its references changed by `m` (the graph itself is not modified;
 * unchanged parts are shared). Outputs are mapped first: a dropped output's id leaves every place
 * naming it.
 */
export function mapGraphRefs(graph: GraphNode, m: RefMapper): GraphNode {
  let g: GraphNode = graph
  const set = <K extends keyof GraphNode>(k: K, v: GraphNode[K]) => {
    g = { ...g, [k]: v }
  }

  // Outputs, and what goes with a dropped one.
  const gone = new Set<string>()
  if (m.output) {
    const layers = g.layers.map((l) => {
      if (l.data?.from !== 'outputs') return l
      let changed = false
      const series = l.data.series.flatMap((s) => {
        const c = m.output!(s)
        if (c === 'keep') return [s]
        changed = true
        if (c === 'drop') {
          gone.add(s.id)
          return []
        }
        const { colorOf: _, ...rest } = s
        return [{ ...rest, ref: c.ref, ...(c.colorOf !== undefined ? { colorOf: c.colorOf } : {}) }]
      })
      return changed ? ({ ...l, data: { ...l.data, series } } as Layer) : l
    })
    if (layers.some((l, i) => l !== g.layers[i])) set('layers', layers)
  }
  if (gone.size) {
    // Layers of outputs that have none left go, with the layers drawing their data.
    const empty = new Set(
      g.layers.filter((l) => l.data?.from === 'outputs' && !l.data.series.length).map((l) => l.id),
    )
    const dependent = (l: Layer) => l.data?.from === 'layer' && empty.has(l.data.layer)
    for (let grew = true; grew; ) {
      grew = false
      for (const l of g.layers)
        if (!empty.has(l.id) && (dependent(l) || (l.on !== undefined && empty.has(l.on)))) {
          empty.add(l.id)
          grew = true
        }
    }
    const without = (rec: Record<string, unknown> | undefined) =>
      rec && moveKeys(rec, (k) => (gone.has(k) ? null : k))
    set(
      'layers',
      g.layers
        .filter((l) => !empty.has(l.id))
        .map((l) => {
          const series = without(l.series)
          return series ? ({ ...l, series } as Layer) : l
        }),
    )
    const ids = without(g.seriesOverrides)
    if (ids) set('seriesOverrides', ids as GraphNode['seriesOverrides'])
    const points = without(g.pointOverrides)
    if (points) set('pointOverrides', points as GraphNode['pointOverrides'])
    const legend = legendKeys(g.legend, (k) => (gone.has(k) ? null : k))
    if (legend) set('legend', legend)
    if (empty.size)
      for (const [k, id] of Object.entries(g.seriesOverrides))
        if (id.order?.some((l) => empty.has(l)))
          set('seriesOverrides', {
            ...g.seriesOverrides,
            [k]: { ...id, order: id.order.filter((l) => !empty.has(l)) },
          })
  }

  if (m.source) {
    const to = m.source(g.seriesSource.table)
    if (to !== g.seriesSource.table) set('seriesSource', { ...g.seriesSource, table: to })
  }

  // Data set keys.
  const kind = seriesKinds(g)
  const mapKey = (k: string, role: KeyRole): string | null => {
    if (!m.key || kind(k) !== 'dataSet') return k
    const c = m.key(k, role)
    return c === 'keep' ? k : c === 'drop' ? null : c
  }
  if (m.key) {
    const src = g.seriesSource
    if (Array.isArray(src.include)) {
      const include = src.include.flatMap((k) => {
        const to = mapKey(k, 'include')
        return to === null ? [] : [to]
      })
      if (
        include.some((k, i) => k !== (src.include as string[])[i]) ||
        include.length !== src.include.length
      )
        set('seriesSource', { ...g.seriesSource, include })
    }
    const ids = moveKeys(g.seriesOverrides, (k) => mapKey(k, 'identity'))
    if (ids) set('seriesOverrides', ids)
    if (g.pointOverrides) {
      const points = moveKeys(g.pointOverrides, (k) => mapKey(k, 'points'))
      if (points) set('pointOverrides', points)
    }
    const layers = g.layers.map((l) => {
      let out = l
      if (l.series) {
        const series = moveKeys(l.series as Record<string, unknown>, (k) =>
          mapKey(k, 'layerSeries'),
        )
        if (series) out = { ...out, series } as Layer
      }
      if (l.aes) {
        const aes: Record<string, string> = {}
        let changed = false
        for (const [f, k] of Object.entries(l.aes)) {
          if (k === undefined) continue
          const to = mapKey(k, 'aes')
          if (to !== k) changed = true
          if (to !== null) aes[f] = to
        }
        if (changed) out = { ...out, aes } as Layer
      }
      if (l.data?.from === 'outputs' && l.data.series.some((s) => s.colorOf !== undefined)) {
        let changed = false
        const series = l.data.series.map((s) => {
          if (s.colorOf === undefined) return s
          const to = mapKey(s.colorOf, 'colorOf')
          if (to === s.colorOf) return s
          changed = true
          const { colorOf: _, ...rest } = s
          return to === null ? rest : { ...rest, colorOf: to }
        })
        if (changed) out = { ...out, data: { ...l.data, series } } as Layer
      }
      return out
    })
    if (layers.some((l, i) => l !== g.layers[i])) set('layers', layers)
    const legend = legendKeys(g.legend, (k) => mapKey(k, 'legend'))
    if (legend) set('legend', legend)
    if (g.mapping) {
      // The axes' variables: without either, no mapping (the graph shows the table's variables);
      // a variable mapped to appearance dropped leaves that aesthetic unmapped.
      const { x, y } = g.mapping
      const [mx, my] = [mapKey(x, 'mapping'), mapKey(y, 'mapping')]
      if (mx === null || my === null) {
        const { mapping: _, ...without } = g
        g = without
      } else {
        const next: Record<string, unknown> = { ...g.mapping, x: mx, y: my }
        let changed = mx !== x || my !== y
        for (const field of ['color', 'fill', 'shape', 'size', 'label'] as const) {
          const k = g.mapping[field]
          if (k === undefined) continue
          const to = mapKey(k, 'mapping')
          if (to === k) continue
          changed = true
          if (to === null) delete next[field]
          else next[field] = to
        }
        if (changed) set('mapping', next as GraphNode['mapping'])
      }
    }
    if (g.levels) {
      const levels = moveKeys(g.levels, (k) => mapKey(k, 'levels'))
      if (levels) set('levels', levels)
    }
    // A split graph's variable (roadmap 34d): without it, no filter (every row) and no set.
    const filter = g.seriesSource.filter
    if (filter) {
      const to = mapKey(filter.variable, 'filter')
      if (to === null) {
        const { filter: _, ...rest } = g.seriesSource
        set('seriesSource', rest)
      } else if (to !== filter.variable)
        set('seriesSource', { ...g.seriesSource, filter: { ...filter, variable: to } })
    }
    if (g.split?.variable !== undefined) {
      const to = mapKey(g.split.variable, 'split')
      if (to === null) {
        const { split: _, ...rest } = g
        g = rest
      } else if (to !== g.split.variable) set('split', { ...g.split, variable: to })
    }
  }

  // Rows.
  if (m.rows) {
    const rows = (r: readonly number[] | undefined, role: RowRole) => {
      if (!r) return undefined
      const c = m.rows!(r, role)
      return c === 'keep' || c === 'drop' ? undefined : c
    }
    const slice = rows(g.seriesSource.rows, 'slice')
    if (slice) set('seriesSource', { ...g.seriesSource, rows: slice })
    const labels = <T extends { pointLabels?: PointLabels }>(id: T): T => {
      const r = rows(id.pointLabels?.rows, 'pointLabels')
      return r ? { ...id, pointLabels: { ...id.pointLabels!, rows: r } } : id
    }
    let changed = false
    const ids: GraphNode['seriesOverrides'] = {}
    for (const [k, id] of Object.entries(g.seriesOverrides)) {
      ids[k] = labels(id)
      if (ids[k] !== id) changed = true
    }
    if (changed) set('seriesOverrides', ids)
    const defaults = g.style.seriesDefaults
    if (defaults) {
      const next = labels(defaults)
      if (next !== defaults) set('style', { ...g.style, seriesDefaults: next })
    }
  }
  if (m.row && g.pointOverrides) {
    let changed = false
    const points: NonNullable<GraphNode['pointOverrides']> = {}
    for (const [k, byPoint] of Object.entries(g.pointOverrides)) {
      const moved: typeof byPoint = {}
      for (const [p, style] of Object.entries(byPoint)) {
        const parsed = parsePointKey(p)
        const r: number | null = parsed ? m.row!(parsed.row) : null
        const next = parsed && r !== null ? pointKey(r, parsed.sub) : null
        if (next !== p) changed = true
        if (next !== null) moved[next] = style
      }
      points[k] = moved
    }
    if (changed) set('pointOverrides', points)
  }
  // Audit 3 (G1): a pie's legend entries are its categories by table row.
  if (m.row) {
    const legend = legendKeys(g.legend, (k) => {
      const row = rowOfCategoryEntryKey(k)
      if (row === null) return k
      const to = m.row!(row)
      return to === null ? null : categoryEntryKey(to)
    })
    if (legend) set('legend', legend)
  }

  // Category keys of treatment grids and spans (roadmap 36): their rows and data sets.
  if (m.row || m.key) {
    const axes = mapCategoryKeys(g.axes, (k) => mapCategoryKey(k, m, mapKey))
    if (axes) set('axes', axes)
  }

  // Keys of values and comparisons result layers read (roadmap 35).
  if (m.resultKey) {
    let changed = false
    const layers = g.layers.map((l) => {
      if (l.data?.from !== 'analysis' || l.stat.kind !== 'result') return l
      let moved = false
      const fields: typeof l.stat.fields = {}
      for (const [name, f] of Object.entries(l.stat.fields)) {
        const keyed = f.ref.from === 'value' || f.ref.from === 'comparison' ? f.ref : undefined
        const to = keyed ? m.resultKey!(keyed.key, l.data.analysis) : undefined
        if (to === undefined || !keyed || to === keyed.key) fields[name] = f
        else if (to === null) moved = true
        else {
          moved = true
          fields[name] = { ...f, ref: { ...keyed, key: to } }
        }
      }
      if (!moved) return l
      changed = true
      return { ...l, stat: { ...l.stat, fields } } as Layer
    })
    if (changed) set('layers', layers)
  }

  // Analyses of result layers and tables (roadmap 35).
  if (m.analysis) {
    const gone = new Set<string>()
    let changed = false
    const layers = g.layers.flatMap((l): Layer[] => {
      if (l.data?.from !== 'analysis') return [l]
      const c = m.analysis!(l.data.analysis)
      if (c === 'keep' || c === l.data.analysis) return [l]
      changed = true
      if (c === 'drop') {
        gone.add(l.id)
        return []
      }
      return [{ ...l, data: { ...l.data, analysis: c } } as Layer]
    })
    if (gone.size)
      for (let grew = true; grew; ) {
        grew = false
        for (const l of layers)
          if (
            !gone.has(l.id) &&
            ((l.on !== undefined && gone.has(l.on)) ||
              (l.data?.from === 'layer' && gone.has(l.data.layer)))
          ) {
            gone.add(l.id)
            grew = true
          }
      }
    if (changed) {
      set(
        'layers',
        layers.filter((l) => !gone.has(l.id)),
      )
      if (gone.size)
        for (const [k, id] of Object.entries(g.seriesOverrides))
          if (id.order?.some((l) => gone.has(l)))
            set('seriesOverrides', {
              ...g.seriesOverrides,
              [k]: { ...id, order: id.order.filter((l) => !gone.has(l)) },
            })
    }
    let tables = false
    const annotations = g.annotations.flatMap((a): GraphNode['annotations'] => {
      if (a.type !== 'table') return [a]
      const c = m.analysis!(a.analysis)
      if (c === 'keep' || c === a.analysis) return [a]
      tables = true
      return c === 'drop' ? [] : [{ ...a, analysis: c }]
    })
    if (tables) set('annotations', annotations)
  }

  // Brackets.
  if (m.bracket) {
    let changed = false
    const annotations = g.annotations.flatMap((a): GraphNode['annotations'] => {
      if (a.type !== 'bracket') return [a]
      const c = m.bracket!(a)
      if (c === 'keep') return [a]
      changed = true
      return c === 'drop' ? [] : [c]
    })
    if (changed) set('annotations', annotations)
  }
  return g
}

/**
 * A legend with the entry keys of its `hidden`, `order` (roadmap 47b: a key mapped onto one
 * already listed comes once) and `labels` mapped (null: dropped); null when none changed.
 */
function legendKeys(
  legend: GraphNode['legend'],
  map: (key: string) => string | null,
): GraphNode['legend'] | null {
  let out: GraphNode['legend'] | null = null
  const list = (field: 'hidden' | 'order', dedupe: boolean) => {
    const was = legend[field]
    if (!was) return
    const next: string[] = []
    for (const k of was) {
      const to = map(k)
      if (to !== null && !(dedupe && next.includes(to))) next.push(to)
    }
    if (next.length !== was.length || next.some((k, i) => k !== was[i]))
      out = { ...(out ?? legend), [field]: next }
  }
  list('hidden', false)
  list('order', true)
  if (legend.labels) {
    const labels = moveKeys(legend.labels, map)
    if (labels) out = { ...(out ?? legend), labels }
  }
  return out
}

/**
 * A category key mapped (roadmap 36): a group's table row by `m.row`, a data set by `m.key`
 * (role 'categories'); levels' keys are their text and stay. Null: its row or data set is gone.
 */
function mapCategoryKey(
  key: string,
  m: RefMapper,
  mapKey: (k: string, role: KeyRole) => string | null,
): string | null {
  const one = (part: string): string | null => {
    const row = rowOfCategoryKey(part)
    if (row !== null) {
      if (!m.row) return part
      const to = m.row(row)
      return to === null ? null : rowCategoryKey(to)
    }
    return mapKey(part, 'categories')
  }
  const { group, series } = categoryKeyParts(key)
  const g = one(group)
  if (g === null) return null
  if (series === undefined) return g
  const s = one(series)
  return s === null ? null : `${g}/${s}`
}

/** A graph's axes with their categorical specs' category keys mapped; null when none changed. */
function mapCategoryKeys<A extends { x: AxisSpec; y: AxisSpec }>(
  axes: A,
  map: (key: string) => string | null,
): A | null {
  let out: A | null = null
  for (const which of ['x', 'y'] as const) {
    const spec = axes[which]
    if (spec.type !== 'categorical') continue
    let next = spec
    if (spec.treatments) {
      let changed = false
      const rows = spec.treatments.rows.map((row) => {
        let moved = false
        const cells: Record<string, string> = {}
        for (const [k, v] of Object.entries(row.cells)) {
          const to = map(k)
          if (to !== k) moved = true
          if (to !== null) cells[to] = v
        }
        if (!moved) return row
        changed = true
        return { ...row, cells }
      })
      if (changed) next = { ...next, treatments: { ...spec.treatments, rows } }
    }
    const spans = spec.spans
    if (spans) {
      let changed = false
      let rename = spans.rename
      if (rename) {
        const moved = moveKeys(rename, map)
        if (moved) {
          rename = moved
          changed = true
        }
      }
      const list = spans.list?.flatMap((span) => {
        const keys = span.keys.flatMap((k) => {
          const to = map(k)
          return to === null ? [] : [to]
        })
        if (keys.length === span.keys.length && keys.every((k, i) => k === span.keys[i]))
          return [span]
        changed = true
        return keys.length ? [{ ...span, keys }] : []
      })
      if (changed) next = { ...next, spans: { ...spans, rename, list } }
    }
    if (next !== spec) out = { ...(out ?? axes), [which]: next }
  }
  return out
}

/**
 * The analyses whose outputs a graph draws, whose comparisons label its brackets, or whose
 * results its layers and tables show (roadmap 35).
 */
export function graphAnalyses(graph: GraphNode): NodeId[] {
  const out = new Set<NodeId>()
  for (const r of graphRefs(graph)) {
    if (r.kind === 'output' || r.kind === 'analysis') out.add(r.node)
    else if (r.kind === 'bracket' && r.annotation.label.source === 'analysis')
      out.add(r.annotation.label.analysis)
  }
  return [...out]
}
