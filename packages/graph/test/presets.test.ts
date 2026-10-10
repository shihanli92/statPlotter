import { type GraphNode, GraphNode as GraphNodeSchema } from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  applyPreset,
  GRAPH_PRESETS,
  layoutGraph,
  lookFor,
  type MatrixKind,
  NESTED_DEFAULTS,
  type NestedOptions,
  presetGraph,
  presetIssues,
  presetLayers,
  presetsFor,
  type SceneNode,
  sceneToSvg,
  withLayers,
} from '../src/index.ts'
import {
  fonts,
  projectOf,
  sampleFor,
  sampleTable,
  sampleVariables,
  TABLE_KINDS,
} from './helpers.ts'

// Native presets (roadmap 33c): layer lists valid by the matrix. (Each 33b preset was proven to
// draw what its compiled v1 style drew, scene and SVG, 75 preset × table kind comparisons and the
// nested variants, until the v1 creators went with roadmap 33d.)

const tables = new Map(TABLE_KINDS.map((k) => [k, sampleTable(k)]))
const flattenNodes = (n: SceneNode): SceneNode[] => [n, ...(n.children ?? []).flatMap(flattenNodes)]
const flattenIds = (n: SceneNode): string[] => flattenNodes(n).map((x) => x.id)

/**
 * The sample table a preset draws: `sampleFor`'s, but a dot plot (roadmap 34g) needs a text
 * variable to group by (`sampleVariables`).
 */
const presetSample = (id: string, kind: MatrixKind, grouped = false) =>
  id === 'dotPlot' ? { table: sampleVariables(), opts: {} } : sampleFor(kind, grouped)

describe('native presets', () => {
  it('are valid by the matrix for every table kind they list', () => {
    for (const p of GRAPH_PRESETS)
      for (const kind of p.tableKinds) {
        const { table, opts } = presetSample(p.id, kind)
        expect(presetIssues(table, p.id, opts), `${p.id} on ${kind}`).toEqual([])
        const g = presetGraph(table, p.id, undefined, opts)
        expect(() => GraphNodeSchema.parse(g), `${p.id} on ${kind}`).not.toThrow()
        expect(g.preset).toBe(p.id)
        expect(g.drawOrder).toBeUndefined()
      }
  })

  it('every table kind has presets, its default first among them', () => {
    for (const kind of TABLE_KINDS) expect(presetsFor(kind).length, kind).toBeGreaterThan(0)
    expect(presetLayers('heatmap', tables.get('column')!)).toBeUndefined()
    expect(presetLayers('nonsense', tables.get('column')!)).toBeUndefined()
  })

  it('use the look their layers call for', () => {
    for (const p of GRAPH_PRESETS)
      for (const kind of p.tableKinds) {
        const { table, opts } = presetSample(p.id, kind)
        const spec = presetLayers(p.id, table, opts)!
        expect(lookFor(spec.frame, spec.layers, spec.look), `${p.id} on ${kind}`).toBe(spec.look)
      }
  })

  it('draw on every table kind they list, without warnings', () => {
    for (const p of GRAPH_PRESETS)
      for (const kind of p.tableKinds)
        for (const grouped of kind.startsWith('mv') ? [false, true] : [false]) {
          const { table, opts } = presetSample(p.id, kind, grouped)
          const g = presetGraph(table, p.id, undefined, opts)
          const scene = layoutGraph({ project: projectOf(table, g), graph: g, fonts })
          // The sample table's rows without a Group or a Score are left out, with a note.
          const notes = scene.warnings.filter((w) => !/ left out\.$/.test(w))
          expect(notes, `${p.id} on ${kind}`).toEqual([])
          expect(sceneToSvg(scene)).not.toContain('NaN')
        }
  })

  it('changing layers keeps the formats of layers that stay (the builder’s Change layers)', () => {
    const table = tables.get('column')!
    const bars = presetGraph(table, 'bars')
    const fill = { type: 'solid' as const, color: { rgb: '#ff0000' }, opacity: 1 }
    const line = { color: { rgb: '#00ff00' }, width: 2, dash: 'solid' as const }
    const formatted: GraphNode = {
      ...bars,
      layers: bars.layers.map((l) =>
        l.id === 'bars'
          ? { ...l, name: 'My bars', style: { fill }, series: { a: { style: { width: 0.4 } } } }
          : l.id === 'error'
            ? { ...l, legend: 'hide', style: { line, direction: 'below' } }
            : l,
      ) as GraphNode['layers'],
    }
    // Bars with points: bars and error bars stay (their formats too), the preset's own error bar
    // direction wins, points are new.
    const g = withLayers(formatted, presetLayers('barsPoints', table)!)
    expect(g.layers.map((l) => l.id)).toEqual(['bars', 'points', 'error'])
    expect(g.layers[0]).toMatchObject({ name: 'My bars', style: { fill }, series: { a: {} } })
    expect(g.layers[2]).toMatchObject({ legend: 'hide', style: { line, direction: 'both' } })
    expect(g.preset).toBe('barsPoints')
    expect(g.look).toBe('column.bar')
    // A scatter: the error bars stay (free of the bars now), the bars go.
    const s = withLayers(formatted, presetLayers('points', table)!)
    expect(s.layers.map((l) => l.id)).toEqual(['points', 'error', 'center'])
    expect(s.layers[1]).toMatchObject({ style: { line, direction: 'below' } })
    expect(s.layers[1]!.on).toBeUndefined()
    // Matched by geom when the id differs; per-data-set stats only of the same stat kind.
    const twin: GraphNode = {
      ...formatted,
      layers: [
        {
          id: 'means',
          geom: 'points',
          stat: { kind: 'summary', center: 'mean' },
          style: { size: 9 },
          series: { a: { stat: { center: 'median' }, style: { shape: 'square' } } },
        },
      ],
    }
    const t = withLayers(twin, presetLayers('pointsOnly', table)!)
    expect(t.layers[0]).toEqual({
      id: 'points',
      geom: 'points',
      stat: { kind: 'identity' },
      style: { size: 9 },
      series: { a: { style: { shape: 'square' } } },
    })
  })

  it('changing frames brings the new frame’s axes; difference layers their axis', () => {
    const grouped = tables.get('grouped')!
    const g = presetGraph(grouped, 'bars')
    const map = withLayers(g, presetLayers('heatmap', grouped)!, grouped)
    expect(map.frame).toBe('matrix')
    expect(map.axes.y.type).toBe('categorical')
    expect(map.size).toEqual(g.size)
    expect(map.legend.show).toBe(false)
    const column = tables.get('column')!
    const est = withLayers(presetGraph(column, 'points'), presetLayers('estimation', column)!)
    expect(est.axes.y2).toBeDefined()
    expect(withLayers(est, presetLayers('points', column)!).axes.y2).toBeUndefined()
    expect(applyPreset(est, 'heatmap', column)).toBe(est)
  })

  it('nested subjects as the New graph options ask', () => {
    const table = tables.get('nested')!
    const options: NestedOptions[] = [
      NESTED_DEFAULTS,
      { layout: 'pooled', mark: 'none', subjectMeans: false },
      { layout: 'subjects', mark: 'shape', subjectMeans: true },
      { layout: 'pooled', mark: 'shade', subjectMeans: true },
    ]
    for (const nested of options)
      for (const id of ['points', 'barsPoints', 'pointsMean']) {
        const g = presetGraph(table, id, undefined, { nested })
        const scene = layoutGraph({ project: projectOf(table, g), graph: g, fonts })
        const what = `${id} ${JSON.stringify(nested)}`
        expect(scene.warnings, what).toEqual([])
        const ids = flattenIds(scene.root)
        // Subject means: a short line per subject.
        expect(
          ids.some((n) => n.includes('/subjectMean/')),
          what,
        ).toBe(nested.subjectMeans)
        // Side by side: the subjects' points at as many places across the group as subjects.
        const xs = new Set(
          flattenNodes(scene.root)
            .filter((n) => /^series\/a\/point\//.test(n.id) && n.prim?.type === 'symbol')
            .map((n) => Math.round((n.prim as { cx: number }).cx)),
        )
        if (nested.layout === 'subjects') expect(xs.size, what).toBeGreaterThanOrEqual(3)
      }
  })
})

describe('joining the points', () => {
  it('adding a before-after line keeps the look (and so the points) of the layers it joins', () => {
    const scatter = lookFor('category', [
      { id: 'points', geom: 'points', stat: { kind: 'identity' } },
    ])
    const joined = lookFor(
      'category',
      [
        { id: 'pairs', geom: 'connector', stat: { kind: 'identity' } },
        { id: 'points', geom: 'points', stat: { kind: 'identity' } },
      ],
      scatter,
    )
    expect(joined).toBe(scatter)
  })
})

describe('value axis titles of percent stacks', () => {
  const title = (g: GraphNode) => g.axes.y.title?.content.map((r) => r.text).join('') ?? null

  it('new graphs of 100% stacked bars say percent; counts and parts of whole as before', () => {
    const contingency = tables.get('contingency')!
    const grouped = tables.get('grouped')!
    expect(title(presetGraph(contingency, 'stackedPercent'))).toBe('Percent of subjects')
    expect(title(presetGraph(contingency, 'stacked'))).toBe('Number of subjects')
    expect(title(presetGraph(contingency, 'bars'))).toBe('Number of subjects')
    expect(title(presetGraph(grouped, 'stackedPercent'))).toBe('Percent of total')
    expect(title(presetGraph(grouped, 'stacked'))).toBeNull()
    expect(title(presetGraph(tables.get('partsOfWhole')!, 'wholeBars'))).toBe('Percent of total')
  })

  it('changing layers follows the default title, never the user’s own', () => {
    const table = tables.get('contingency')!
    const bars = presetGraph(table, 'bars')
    const pct = withLayers(bars, presetLayers('stackedPercent', table)!, table)
    expect(title(pct)).toBe('Percent of subjects')
    expect(title(withLayers(pct, presetLayers('bars', table)!, table))).toBe('Number of subjects')
    const own: GraphNode = {
      ...bars,
      axes: { ...bars.axes, y: { ...bars.axes.y, title: { content: [{ text: 'Patients' }] } } },
    }
    expect(title(withLayers(own, presetLayers('stackedPercent', table)!, table))).toBe('Patients')
  })
})
