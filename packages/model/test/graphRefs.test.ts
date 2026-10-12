import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import {
  CategoryKey,
  DataSetKey,
  type GraphNode,
  GraphNode as GraphNodeSchema,
  type GraphRef,
  graphAnalyses,
  graphOutputs,
  graphRefs,
  LegendSpec,
  layerData,
  levelKey,
  mapGraphRefs,
  NodeId,
  SeriesKey,
} from '../src/index.ts'

// `graphRefs` (roadmap 33b, decision 241): every reference walker goes through it, so it must find
// every place of the graph node's schema that names a node or a series.

const REF_SCHEMAS = new Set<unknown>([NodeId, DataSetKey, SeriesKey, CategoryKey])

/**
 * The places of a schema typed as a node or series reference: dotted paths with `*` for list and
 * record elements and `#key` for a record's keys.
 */
function refPaths(schema: z.ZodType): Set<string> {
  const out = new Set<string>()
  const seen = new Set<unknown>()
  const walk = (s: z.ZodType, path: string[]) => {
    if (REF_SCHEMAS.has(s)) {
      out.add(path.join('.'))
      return
    }
    const def = (s as unknown as { _zod: { def: Record<string, unknown> } })._zod.def
    const key = `${path.join('.')}\u0000`
    if (seen.has(s) && seen.has(key)) return
    seen.add(s)
    seen.add(key)
    switch (def.type) {
      case 'object':
        for (const [k, v] of Object.entries(def.shape as Record<string, z.ZodType>))
          walk(v, [...path, k])
        return
      case 'array':
        walk(def.element as z.ZodType, [...path, '*'])
        return
      case 'record':
        if (REF_SCHEMAS.has(def.keyType)) out.add([...path, '#key'].join('.'))
        walk(def.valueType as z.ZodType, [...path, '*'])
        return
      case 'optional':
      case 'nullable':
      case 'default':
      case 'readonly':
        walk(def.innerType as z.ZodType, path)
        return
      case 'union':
        for (const o of def.options as z.ZodType[]) walk(o, path)
        return
      case 'pipe':
        walk(def.in as z.ZodType, path)
        return
      default:
        return
    }
  }
  walk(schema, [])
  return out
}

/** The schema places a reference stands for. */
function placesOf(r: GraphRef): string[] {
  const abs = (p: (string | number)[]) => p.map((s) => (typeof s === 'number' ? '*' : s))
  switch (r.kind) {
    case 'source':
      return [abs(r.path).join('.')]
    case 'output':
      return ['ref.node', 'ref.key'].map((k) => [...abs(r.path), k].join('.'))
    case 'bracket':
      return ['a', 'b', 'label.analysis', 'group.*'].map((k) => [...abs(r.path), k].join('.'))
    case 'analysis':
      return [abs(r.path).join('.')]
    case 'key': {
      const p = abs(r.path)
      // Record keys: a series' identity, point formats, a layer's per-series entry.
      if (
        r.role === 'identity' ||
        r.role === 'points' ||
        r.role === 'layerSeries' ||
        r.role === 'levels' ||
        r.role === 'shapes'
      )
        p[p.length - 1] = '#key'
      return [p.join('.')]
    }
    case 'category': {
      // Roadmap 36: a grid's cells and renamed spans are records keyed by category.
      const p = abs(r.path)
      if (r.role !== 'span') p[p.length - 1] = '#key'
      return [p.join('.')]
    }
    default:
      return []
  }
}

const AXIS = {
  type: 'continuous' as const,
  title: null,
  scale: 'linear' as const,
  range: 'auto' as const,
  ticks: 'auto' as const,
  format: { mode: 'auto' as const },
  frame: 'plain' as const,
  breaks: [],
}

/** A graph naming something at every reference place. */
const FULL = {
  kind: 'graph',
  id: 'g1',
  name: 'G',
  frame: 'xy',
  look: 'xy.scatter',
  layers: [
    { id: 'points', geom: 'points', stat: { kind: 'identity' }, series: { a: { hide: true } } },
    {
      id: 'curves',
      geom: 'line',
      stat: { kind: 'identity' },
      data: {
        from: 'outputs',
        series: [{ id: 'c1', ref: { node: 'fit', key: 'curve:a' }, colorOf: 'a' }],
      },
      series: { c1: { style: { gaps: true } } },
    },
    {
      id: 'bands',
      geom: 'band',
      stat: { kind: 'identity' },
      data: { from: 'layer', layer: 'curves' },
    },
    {
      id: 'bubbles',
      geom: 'points',
      stat: { kind: 'identity' },
      aes: { x: 'a', y: 'b', size: 'c', color: 'd', fill: 'n', shape: 'e', group: 'f', label: 'g' },
    },
    // Roadmap 34c: vectors end at two more variables.
    { id: 'vectors', geom: 'segment', stat: { kind: 'identity' }, aes: { xend: 'l', yend: 'm' } },
    // Roadmap 35: a label of an analysis' results.
    {
      id: 'result',
      geom: 'label',
      stat: {
        kind: 'result',
        fields: { r: { ref: { from: 'value', key: 'r' } } },
        template: 'r = {r}',
      },
      data: { from: 'analysis', analysis: 'corr' },
    },
  ],
  seriesSource: {
    table: 't1',
    include: ['a', 'b'],
    rows: [2, 0],
    // Roadmap 34d: a split graph's level of a text variable.
    filter: { variable: 'n', level: 'lv_4d' },
  },
  split: { set: 's1', by: 'level', variable: 'n' },
  seriesOverrides: {
    a: { color: { palette: 1 }, pointLabels: { source: 'y', which: 'rows', rows: [1] } },
  },
  pointOverrides: { b: { r1s0: { size: 3 } } },
  size: { plotWidth: 100, plotHeight: 100 },
  // Roadmap 36: a treatment grid and spans keyed by categories (a data set, a level, a grouped
  // table's row, a bar within a group).
  axes: {
    x: AXIS,
    y: {
      type: 'categorical',
      title: null,
      labels: 'dataSetTitles',
      rotation: 0,
      treatments: {
        rows: [
          { title: 'TNF', cells: { a: '+', '@1': '-', '@1/b': '+', lv_4d: '', '@0/lv_4d': '+' } },
        ],
      },
      spans: { rename: { '@0': 'G1', '@1': 'G2' }, list: [{ label: 'L', keys: ['a', '@1/b'] }] },
    },
  },
  annotations: [
    {
      type: 'bracket',
      id: 'n1',
      a: 'a',
      b: 'b',
      rowA: 0,
      rowB: 1,
      label: { source: 'analysis', analysis: 'anova', comparison: 'a|b', show: 'stars' },
      level: 'auto',
      group: ['o'],
    },
    // Roadmap 35: a table of an analysis' results.
    { type: 'table', id: 'n2', analysis: 'corr', sheet: 'results' },
  ],
  legend: { show: true, position: 'right', hidden: ['b', 'c1'] },
  title: null,
  style: { seriesDefaults: { pointLabels: { source: 'x', which: 'rows', rows: [0] } } },
  mapping: { x: 'g', y: 'a', color: 'h', fill: 'o', shape: 'i', size: 'j', label: 'k' },
  levels: { g: ['High', 'Low'], h: ['M'] },
  scales: { shape: { levels: { lv_4d: 'square' } } },
} as unknown as GraphNode

describe('graphRefs', () => {
  it('is a valid graph to test with', () => {
    expect(GraphNodeSchema.safeParse(FULL).error?.issues).toBeUndefined()
  })

  it('visits every node and series reference the schema has (a walk of the schema)', () => {
    const schema = refPaths(GraphNodeSchema)
    // A sanity check of the walk itself.
    expect(schema).toContain('seriesSource.table')
    expect(schema).toContain('layers.*.data.series.*.ref.node')
    expect(schema).toContain('layers.*.series.#key')
    // (The categorical axis on either side.)
    const swapped = { ...FULL, axes: { x: FULL.axes.y, y: FULL.axes.x } }
    const visited = new Set([...graphRefs(FULL), ...graphRefs(swapped)].flatMap(placesOf))
    // The graph's own id names itself, not another node.
    schema.delete('id')
    for (const place of schema) expect(visited, place).toContain(place)
    expect(schema.size).toBeGreaterThan(12)
  })

  it('names what each key is: a data set, an output, a function', () => {
    const keys = graphRefs(FULL).flatMap((r) => (r.kind === 'key' ? [[r.role, r.key, r.of]] : []))
    expect(keys).toContainEqual(['layerSeries', 'c1', 'output'])
    expect(keys).toContainEqual(['legend', 'c1', 'output'])
    expect(keys).toContainEqual(['legend', 'b', 'dataSet'])
    expect(keys).toContainEqual(['colorOf', 'a', 'dataSet'])
    expect(keys).toContainEqual(['mapping', 'g', 'dataSet'])
    expect(keys).toContainEqual(['levels', 'h', 'dataSet'])
    expect(graphAnalyses(FULL).sort()).toEqual(['anova', 'corr', 'fit'])
    expect(graphOutputs(FULL).map((o) => o.series.id)).toEqual(['c1'])
    expect(layerData(FULL, FULL.layers[2]!)).toMatchObject({ from: 'outputs' })
  })

  it('maps data set keys everywhere they are named; outputs and functions keep their ids', () => {
    const next = mapGraphRefs(FULL, { key: (k) => (k === 'b' ? 'drop' : `${k}2`) })
    expect(next.seriesSource.include).toEqual(['a2'])
    expect(Object.keys(next.seriesOverrides)).toEqual(['a2'])
    expect(next.pointOverrides).toEqual({})
    expect(next.layers[0]!.series).toEqual({ a2: { hide: true } })
    expect(next.layers[1]!.series).toEqual({ c1: { style: { gaps: true } } })
    expect(next.layers[1]!.data).toMatchObject({ series: [{ colorOf: 'a2' }] })
    expect(next.layers[3]!.aes).toEqual({
      x: 'a2',
      size: 'c2',
      color: 'd2',
      fill: 'n2',
      shape: 'e2',
      group: 'f2',
      label: 'g2',
    })
    expect(next.legend.hidden).toEqual(['c1'])
    expect(next.mapping).toEqual({
      x: 'g2',
      y: 'a2',
      color: 'h2',
      fill: 'o2',
      shape: 'i2',
      size: 'j2',
      label: 'k2',
    })
    expect(next.levels).toEqual({ g2: ['High', 'Low'], h2: ['M'] })
    // Levels' symbols are keyed by their text: never remapped.
    expect(next.scales?.shape?.levels).toEqual({ lv_4d: 'square' })
    // Brackets are the caller's to map.
    expect(next.annotations).toBe(FULL.annotations)
    expect(FULL.seriesSource.include).toEqual(['a', 'b'])
  })

  it('keeps levels’ keys (their text) and drops a mapping without its X or Y variable', () => {
    const level = levelKey('High')
    const graph = {
      ...FULL,
      seriesOverrides: { ...FULL.seriesOverrides, [level]: { color: { palette: 3 } } },
      legend: { ...FULL.legend, hidden: [level] },
    }
    const keys = graphRefs(graph).flatMap((r) => (r.kind === 'key' ? [[r.role, r.key, r.of]] : []))
    expect(keys).toContainEqual(['identity', level, 'level'])
    const next = mapGraphRefs(graph, { key: (k) => (k === 'g' ? 'drop' : `${k}2`) })
    expect(next.seriesOverrides[level]).toEqual({ color: { palette: 3 } })
    expect(next.legend.hidden).toEqual([level])
    expect(next.mapping).toBeUndefined()
    expect(next.levels).toEqual({ h2: ['M'] })
    const noColor = mapGraphRefs(graph, {
      key: (k) => (['h', 'i', 'j', 'k', 'o'].includes(k) ? 'drop' : 'keep'),
    })
    expect(noColor.mapping).toEqual({ x: 'g', y: 'a' })
    expect(keys).toContainEqual(['shapes', 'lv_4d', 'level'])
    expect(keys).toContainEqual(['mapping', 'k', 'dataSet'])
    // Roadmap 49d: the fill variable too.
    expect(keys).toContainEqual(['mapping', 'o', 'dataSet'])
    expect(keys).toContainEqual(['aes', 'n', 'dataSet'])
  })

  it('drops an output with every place naming it, and output layers left empty', () => {
    const next = mapGraphRefs(
      {
        ...FULL,
        seriesOverrides: {
          ...FULL.seriesOverrides,
          c1: { color: { palette: 2 }, order: ['curves'] },
        },
      },
      { output: () => 'drop' },
    )
    expect(next.layers.map((l) => l.id)).toEqual(['points', 'bubbles', 'vectors', 'result'])
    expect(next.legend.hidden).toEqual(['b'])
    expect(Object.keys(next.seriesOverrides)).toEqual(['a'])
  })

  it('follows rows: slices, labelled rows, point formats', () => {
    const next = mapGraphRefs(FULL, {
      rows: (rows) => rows.map((r) => r + 10),
      row: (r) => (r === 1 ? null : r + 10),
    })
    expect(next.seriesSource.rows).toEqual([12, 10])
    expect(next.seriesOverrides.a!.pointLabels!.rows).toEqual([11])
    expect(next.style.seriesDefaults!.pointLabels!.rows).toEqual([10])
    expect(next.pointOverrides).toEqual({ b: {} })
  })

  it('walks and maps category keys of treatment grids and spans (roadmap 36)', () => {
    const cats = graphRefs(FULL).flatMap((r) => (r.kind === 'category' ? [[r.role, r.key]] : []))
    expect(cats).toContainEqual(['cells', '@1/b'])
    expect(cats).toContainEqual(['rename', '@0'])
    expect(cats).toContainEqual(['span', 'a'])
    // Rows follow row edits (row 1 deleted), data sets their copies (b gone); levels stay.
    const next = mapGraphRefs(FULL, {
      row: (r) => (r === 1 ? null : r + 10),
      key: (k) => (k === 'b' ? 'drop' : `${k}2`),
    })
    const y = next.axes.y
    if (y.type !== 'categorical') throw new Error('categorical')
    expect(y.treatments?.rows[0]?.cells).toEqual({ a2: '+', lv_4d: '', '@10/lv_4d': '+' })
    expect(y.spans?.rename).toEqual({ '@10': 'G1' })
    expect(y.spans?.list).toEqual([{ label: 'L', keys: ['a2'] }])
    // Unchanged keys leave the axes as they were.
    expect(mapGraphRefs(FULL, { row: (r) => r }).axes).toBe(FULL.axes)
  })

  it('walks a split graph’s filter and set (roadmap 34d): the variable a key, the level its own', () => {
    const keys = graphRefs(FULL).flatMap((r) => (r.kind === 'key' ? [[r.role, r.key, r.of]] : []))
    expect(keys).toContainEqual(['filter', 'n', 'dataSet'])
    expect(keys).toContainEqual(['filter', 'lv_4d', 'level'])
    expect(keys).toContainEqual(['split', 'n', 'dataSet'])
    // Remapped to another table: the variable follows, the level (its text) stays.
    const moved = mapGraphRefs(FULL, { key: (k) => `${k}2` })
    expect(moved.seriesSource.filter).toEqual({ variable: 'n2', level: 'lv_4d' })
    expect(moved.split).toEqual({ set: 's1', by: 'level', variable: 'n2' })
    // Without the variable: no filter (every row) and no set.
    const dropped = mapGraphRefs(FULL, { key: (k) => (k === 'n' ? 'drop' : 'keep') })
    expect(dropped.seriesSource.filter).toBeUndefined()
    expect(dropped.seriesSource.rows).toEqual([2, 0])
    expect(dropped.split).toBeUndefined()
    expect(FULL.split?.variable).toBe('n')
  })

  it('maps or drops the analyses of result layers and tables (roadmap 35)', () => {
    const refs = graphRefs(FULL).filter((r) => r.kind === 'analysis')
    expect(refs.map((r) => r.path.join('.'))).toEqual([
      'layers.5.data.analysis',
      'annotations.1.analysis',
    ])
    const moved = mapGraphRefs(FULL, {
      analysis: (n) => (n === 'corr' ? ('corr2' as NodeId) : 'keep'),
    })
    expect(moved.layers[5]!.data).toEqual({ from: 'analysis', analysis: 'corr2' })
    expect(moved.annotations[1]).toMatchObject({ type: 'table', analysis: 'corr2' })
    // Dropped: the layer goes with the layers attached to it, and the table.
    const attached = {
      ...FULL,
      layers: [
        ...FULL.layers,
        { id: 'more', geom: 'label', stat: { kind: 'identity' }, on: 'result' },
      ],
      seriesOverrides: { ...FULL.seriesOverrides, a: { order: ['result', 'points'] } },
    } as unknown as GraphNode
    const dropped = mapGraphRefs(attached, { analysis: () => 'drop' })
    expect(dropped.layers.map((l) => l.id)).toEqual([
      'points',
      'curves',
      'bands',
      'bubbles',
      'vectors',
    ])
    expect(dropped.annotations.map((a) => a.type)).toEqual(['bracket'])
    expect(dropped.seriesOverrides.a!.order).toEqual(['points'])
    expect(mapGraphRefs(FULL, { analysis: () => 'keep' })).toBe(FULL)
  })

  it('walks, maps and prunes the legend’s order and labels as its hidden (roadmap 47b)', () => {
    const graph = {
      ...FULL,
      legend: {
        ...FULL.legend,
        order: ['b', 'c1', 'a', '@result/up', 'zz'],
        labels: { a: [{ text: 'Alpha' }], c1: [{ text: 'Fit' }], b: [{ text: 'Beta' }] },
      },
    } as GraphNode
    expect(GraphNodeSchema.safeParse(graph).error?.issues).toBeUndefined()
    const keys = graphRefs(graph).flatMap((r) =>
      r.kind === 'key' && r.role === 'legend' ? [[r.path.join('.'), r.key, r.of]] : [],
    )
    expect(keys).toContainEqual(['legend.order.0', 'b', 'dataSet'])
    expect(keys).toContainEqual(['legend.order.1', 'c1', 'output'])
    expect(keys).toContainEqual(['legend.labels.a', 'a', 'dataSet'])
    // Renamed and dropped data sets; outputs, other entries' keys and unknown keys kept.
    const next = mapGraphRefs(graph, {
      key: (k) => (k === 'b' ? 'drop' : k === 'a' ? 'a2' : 'keep'),
    })
    expect(next.legend.order).toEqual(['c1', 'a2', '@result/up', 'zz'])
    expect(next.legend.labels).toEqual({ a2: [{ text: 'Alpha' }], c1: [{ text: 'Fit' }] })
    expect(next.legend.hidden).toEqual(['c1'])
    // Two keys mapped onto one: listed once in the order.
    expect(mapGraphRefs(graph, { key: (k) => (k === 'b' ? 'a' : 'keep') }).legend.order).toEqual([
      'a',
      'c1',
      '@result/up',
      'zz',
    ])
    // A dropped output leaves all three.
    const gone = mapGraphRefs(graph, { output: () => 'drop' })
    expect(gone.legend.order).toEqual(['b', 'a', '@result/up', 'zz'])
    expect(Object.keys(gone.legend.labels ?? {})).toEqual(['a', 'b'])
    expect(gone.legend.hidden).toEqual(['b'])
    // Nothing named changes: the same legend.
    expect(mapGraphRefs(graph, { key: () => 'keep' }).legend).toBe(graph.legend)
  })

  it('leaves the graph itself as it was when nothing changes', () => {
    expect(
      mapGraphRefs(FULL, { key: () => 'keep', output: () => 'keep', bracket: () => 'keep' }),
    ).toBe(FULL)
  })
})

describe('LegendSpec (roadmap 47b)', () => {
  const base = { show: true, position: 'right' } as const
  it('accepts an order, legend-only labels, a fill and columns at any position', () => {
    for (const position of ['right', 'top', 'inside'] as const)
      expect(
        LegendSpec.safeParse({
          ...base,
          position,
          columns: 2,
          fill: 'columns',
          order: ['b', 'a', '@sig/up'],
          labels: { a: [{ text: 'Control', bold: true }] },
        }).success,
      ).toBe(true)
    expect(LegendSpec.safeParse({ ...base, fill: 'rows', order: [], labels: {} }).success).toBe(
      true,
    )
  })

  it('rejects a fill but rows or columns, labels not rich text, an order not of keys', () => {
    expect(LegendSpec.safeParse({ ...base, fill: 'down' }).success).toBe(false)
    expect(LegendSpec.safeParse({ ...base, labels: { a: 'Control' } }).success).toBe(false)
    expect(LegendSpec.safeParse({ ...base, order: [1, 2] }).success).toBe(false)
    expect(LegendSpec.safeParse({ ...base, columns: 0 }).success).toBe(false)
  })
})
