import type { AnalysisResult, AnnotationId, DocNode, GraphNode, Layer, NodeId } from '@ps/model'
import { numberAtRisk } from '@ps/stats'
import { describe, expect, it } from 'vitest'
import {
  checkLayers,
  curveAt,
  frameAllowed,
  layoutGraph,
  type Scene,
  type SceneNode,
  withOutputSeries,
} from '../src/index.ts'
import { graphOf } from './graphs.ts'
import {
  byId,
  flatten,
  fonts,
  nodes,
  prim,
  projectOf,
  sampleTable,
  sampleVariables,
} from './helpers.ts'
import {
  analysisNode,
  CORRELATION,
  correlationTable,
  curvesLayer,
  DESCRIPTIVE,
  DOSE_FIT,
  doseTable,
  result,
  resultLayer,
  TTEST,
} from './resultCases.ts'

// Results on graphs (roadmap 35): labels, lines and bands of an analysis' values, brackets at one
// X and from a group to one, the number-at-risk table and inset tables — live, placed, formatted.

const lay = (nodesIn: DocNode[], graph: GraphNode, results: Record<string, AnalysisResult>) =>
  layoutGraph({ project: projectOf(...nodesIn, graph), graph, fonts, result: (id) => results[id] })

/** A text node's text. */
const textOf = (n: SceneNode) =>
  n.prim?.type === 'text' ? n.prim.layout.runs.map((r) => r.text).join('') : ''

/** The text of every text node whose id starts with a prefix. */
const texts = (s: Scene, prefix: string) =>
  flatten(s.root)
    .filter((n) => n.id.startsWith(prefix) && n.prim?.type === 'text')
    .map(textOf)

const corr = correlationTable()
const corrNode = analysisNode('corr', 'correlation', corr, ['a'])
const rpLayer = (more: Partial<Extract<Layer['stat'], { kind: 'result' }>> = {}) =>
  resultLayer('rp', 'label', 'corr', {
    fields: {
      r: { ref: { from: 'value', key: 'r' }, format: { digits: 2 } },
      P: { ref: { from: 'value', key: 'p' } },
    },
    template: [{ text: 'r', italic: true }, { text: ' = {r}, P = {P}' }],
    ...more,
  })
const corrGraph = (layer: Layer = rpLayer()) =>
  graphOf(corr, 'pointsOnly', (g) => ({ layers: [...g.layers, layer] }))

describe('result labels', () => {
  it('fill their template from the analysis’ values, and follow a new result (live)', () => {
    const graph = corrGraph()
    const s = lay([corr, corrNode], graph, { corr: CORRELATION })
    expect(texts(s, 'result/rp')).toEqual(['r = 0.98, P < 0.0001'])
    // The italic r: the template's own run format.
    const label = byId(s, 'result/rp/all/label')!
    expect(prim(label, 'text').layout.runs[0]).toMatchObject({ text: 'r' })
    const edited = result({
      values: { r: { kind: 'number', v: 0.5123 }, p: { kind: 'pvalue', v: 0.0371 } },
    })
    expect(texts(lay([corr, corrNode], graph, { corr: edited }), 'result/rp')).toEqual([
      'r = 0.51, P = 0.037',
    ])
    expect(s.warnings).toEqual([])
  })

  it('show "—" with a warning when a value is gone, "…" while the analysis computes', () => {
    const graph = corrGraph()
    const gone = lay([corr, corrNode], graph, {
      corr: result({ values: { r: { kind: 'number', v: 0.3 } } }),
    })
    expect(texts(gone, 'result/rp')).toEqual(['r = 0.30, P = —'])
    expect(gone.warnings.join()).toMatch(/“P” is no longer in the results of “correlation”/)
    expect(texts(lay([corr, corrNode], graph, {}), 'result/rp')).toEqual(['r = …, P = …'])
  })

  it('sit in a corner, at a data position or beside their curve, apart from each other', () => {
    const W = corrGraph().size.plotWidth
    const H = corrGraph().size.plotHeight
    const box = (s: Scene) => byId(s, 'result/rp/all/label')!.bbox!
    const at = (place: Extract<Layer['stat'], { kind: 'result' }>['place']) =>
      lay([corr, corrNode], corrGraph(rpLayer({ place })), { corr: CORRELATION })
    const plot = (s: Scene) => s.plot
    for (const corner of ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'] as const) {
      const s = at({ at: 'corner', corner })
      const b = box(s)
      const p = plot(s)
      if (corner.endsWith('Left')) expect(b.x).toBeCloseTo(p.x + 4)
      else expect(b.x + b.w).toBeCloseTo(p.x + p.w - 4)
      if (corner.startsWith('top')) expect(b.y).toBeCloseTo(p.y + 4)
      else expect(b.y + b.h).toBeCloseTo(p.y + p.h - 4)
    }
    // At (30, 20): its top-left there.
    const s = at({ at: 'data', x: 30, y: 20 })
    const x = s.axes!.x.toPx(30)
    const y = s.axes!.y.toPx(20)
    expect(box(s).x).toBeCloseTo(x)
    expect(box(s).y).toBeCloseTo(y)
    expect(W * H).toBeGreaterThan(0)
  })

  it('per data set: one each, in its colour, stacked in the corner', () => {
    const dose = doseTable()
    const fit = analysisNode('fit', 'nonlinearFit', dose, ['a', 'b'])
    const graph = graphOf(dose, 'pointsOnly', (g) => ({
      layers: [
        ...g.layers,
        resultLayer('ic', 'label', 'fit', {
          fields: {
            IC50: {
              ref: {
                from: 'cell',
                sheet: 'results',
                block: 'Best-fit values',
                row: 'IC50',
                column: '{dataSet}',
              },
              format: { digits: 3, axisUnit: 'x' },
            },
          },
          template: '{IC50}',
          per: 'dataSet',
        }),
      ],
    }))
    const s = lay([dose, fit], graph, { fit: DOSE_FIT })
    expect(texts(s, 'result/ic')).toEqual(['1.21 µM', '8.43 µM'])
    const [a, b] = [byId(s, 'result/ic/a/label')!, byId(s, 'result/ic/b/label')!]
    expect(prim(a, 'text').color).not.toBe(prim(b, 'text').color)
    expect(b.bbox!.y).toBeGreaterThanOrEqual(a.bbox!.y + a.bbox!.h)
    // A data set left out of the layer has no label.
    const hidden = {
      ...graph,
      layers: graph.layers.map((l) =>
        l.id === 'ic' ? { ...l, series: { b: { hide: true } } } : l,
      ) as Layer[],
    }
    expect(texts(lay([dose, fit], hidden, { fit: DOSE_FIT }), 'result/ic')).toEqual(['1.21 µM'])
  })

  it('appended to the legend’s entries instead', () => {
    const dose = doseTable()
    const fit = analysisNode('fit', 'nonlinearFit', dose, ['a', 'b'])
    const graph = graphOf(dose, 'pointsOnly', (g) => ({
      legend: { ...g.legend, show: true },
      layers: [
        ...g.layers,
        resultLayer('ic', 'label', 'fit', {
          fields: { IC50: { ref: { from: 'value', key: 'IC50:{key}' } } },
          template: 'IC50 = {IC50}',
          per: 'dataSet',
          show: 'legend',
        }),
      ],
    }))
    const s = lay([dose, fit], graph, { fit: DOSE_FIT })
    expect(nodes(s, 'result/ic')).toEqual([])
    expect(texts(s, 'legend/a')).toEqual(['Control (IC50 = 1.21)'])
    expect(texts(s, 'legend/b')).toEqual(['Treated (IC50 = 8.43)'])
  })
})

describe('result lines and bands', () => {
  const column = sampleTable('column')
  const desc = analysisNode('desc', 'descriptive', column, ['a', 'b', 'c'])
  const withLayers = (...layers: Layer[]) =>
    graphOf(column, 'pointsOnly', (g) => ({ layers: [...g.layers, ...layers] }))
  const meanLine = (key = 'mean:a') =>
    resultLayer('mean', 'refline', 'desc', {
      fields: { m: { ref: { from: 'value', key } } },
      at: 'm',
    })

  it('a line across the plot at a value, widening the axis to show it', () => {
    const s = lay([column, desc], withLayers(meanLine()), { desc: DESCRIPTIVE })
    const line = prim(byId(s, 'result/mean/all/line'), 'line')
    expect(line.y1).toBeCloseTo(s.axes!.y.toPx(13.5))
    expect(line.x2 - line.x1).toBeCloseTo(s.plot.w)
    const far = result({ values: { 'mean:a': { kind: 'number', v: 60 } } })
    const s2 = lay([column, desc], withLayers(meanLine()), { desc: far })
    expect(s2.axes!.y.fromPx(s2.plot.y)).toBeGreaterThanOrEqual(60)
  })

  it('per data set: each its own value, in its colour; turned with a horizontal graph', () => {
    const per = resultLayer('means', 'refline', 'desc', {
      fields: { m: { ref: { from: 'value', key: 'mean:{key}' } } },
      at: 'm',
      per: 'dataSet',
    })
    const s = lay([column, desc], withLayers(per), { desc: DESCRIPTIVE })
    const ys = ['a', 'b', 'c'].map((k) => prim(byId(s, `result/means/${k}/line`), 'line').y1)
    expect(ys.map((y) => s.axes!.y.fromPx(y))).toEqual([
      expect.closeTo(13.5),
      expect.closeTo(19.5),
      expect.closeTo(10),
    ])
    const strokes = ['a', 'b'].map(
      (k) => prim(byId(s, `result/means/${k}/line`), 'line').stroke.color,
    )
    expect(strokes[0]).not.toBe(strokes[1])
    const turned = withLayers(per)
    const h = lay(
      [column, desc],
      { ...turned, style: { ...turned.style, orientation: 'horizontal' } },
      {
        desc: DESCRIPTIVE,
      },
    )
    const v = prim(byId(h, 'result/means/a/line'), 'line')
    expect(v.x1).toBeCloseTo(v.x2)
    expect(h.axes!.x.fromPx(v.x1)).toBeCloseTo(13.5)
  })

  it('a band between two values, cut to the plot', () => {
    const band = resultLayer('ci', 'band', 'desc', {
      fields: {
        lo: {
          ref: {
            from: 'cell',
            sheet: 'descriptive',
            row: 'Lower 95% CI of mean',
            column: 'Control',
          },
        },
        hi: {
          ref: {
            from: 'cell',
            sheet: 'descriptive',
            row: 'Upper 95% CI of mean',
            column: 'Control',
          },
        },
      },
      lo: 'lo',
      hi: 'hi',
    })
    const s = lay([column, desc], withLayers(band), { desc: DESCRIPTIVE })
    const r = prim(byId(s, 'result/ci/all/band'), 'rect')
    expect(s.axes!.y.fromPx(r.y)).toBeCloseTo(15.46)
    expect(s.axes!.y.fromPx(r.y + r.h)).toBeCloseTo(11.54)
    expect(r.w).toBeCloseTo(s.plot.w)
  })

  it('drop lines from the fitted curve at a value of X to both axes', () => {
    const dose = doseTable()
    const fit = analysisNode('fit', 'nonlinearFit', dose, ['a', 'b'])
    const graph = graphOf(dose, 'pointsOnly', (g) => ({
      layers: [
        ...g.layers,
        curvesLayer('fit', ['a', 'b']),
        resultLayer('drop', 'refline', 'fit', {
          fields: { x: { ref: { from: 'value', key: 'IC50:{key}' } } },
          at: 'x',
          axis: 'x',
          drop: 'both',
          per: 'dataSet',
        }),
      ],
    }))
    const s = lay([dose, fit], graph, { fit: DOSE_FIT })
    const down = prim(byId(s, 'result/drop/a/drop/x'), 'line')
    const across = prim(byId(s, 'result/drop/a/drop/y'), 'line')
    expect(s.axes!.x.fromPx(down.x1)).toBeCloseTo(1.214, 6)
    expect(down.y2).toBeCloseTo(s.plot.y + s.plot.h)
    expect(across.x1).toBeCloseTo(s.plot.x)
    const y = curveAt(DOSE_FIT.outputs['curve:a']!, 1.214)!
    expect(s.axes!.y.fromPx(across.y1)).toBeCloseTo(y, 6)
    // Without the analysis' curve on the graph: none, and why.
    const bare = { ...graph, layers: graph.layers.filter((l) => l.id !== 'curves') }
    const s2 = lay([dose, fit], bare, { fit: DOSE_FIT })
    expect(nodes(s2, 'result/drop')).toEqual([])
    expect(s2.warnings.join()).toMatch(/Drop lines need/)
  })

  it('labels beside their curves keep off result lines and bands, inside the plot', () => {
    const dose = doseTable()
    const fit = analysisNode('fit', 'nonlinearFit', dose, ['a', 'b'])
    const IC50 = (more: object = {}) => ({
      ref: { from: 'value' as const, key: 'IC50:{key}' },
      ...more,
    })
    const graph = graphOf(dose, 'pointsOnly', (g) => ({
      axes: { ...g.axes, x: { ...g.axes.x, scale: 'log10' } as GraphNode['axes']['x'] },
      layers: [
        ...g.layers,
        curvesLayer('fit', ['a', 'b']),
        resultLayer('band', 'band', 'fit', {
          fields: { lo: { ref: { from: 'value', key: 'HillSlope:a' } }, hi: IC50() },
          lo: 'lo',
          hi: 'hi',
          axis: 'x',
          per: 'dataSet',
        }),
        resultLayer('drop', 'refline', 'fit', {
          fields: { x: IC50() },
          at: 'x',
          axis: 'x',
          drop: 'both',
          per: 'dataSet',
        }),
        resultLayer('ic', 'label', 'fit', {
          fields: { IC50: IC50({ format: { digits: 3 } }) },
          template: 'IC50 = {IC50}',
          per: 'dataSet',
          place: { at: 'curve' },
        }),
      ],
    }))
    const s = lay([dose, fit], graph, { fit: DOSE_FIT })
    const lines = nodes(s, 'result/drop').map((n) => prim(n, 'line'))
    expect(lines).toHaveLength(4)
    type Line = (typeof lines)[number]
    const hits = (b: { x: number; y: number; w: number; h: number }, l: Line) => {
      for (let k = 0; k <= 50; k++) {
        const x = l.x1 + ((l.x2 - l.x1) * k) / 50
        const y = l.y1 + ((l.y2 - l.y1) * k) / 50
        if (x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h) return true
      }
      return false
    }
    for (const k of ['a', 'b']) {
      const b = byId(s, `result/ic/${k}/label`)!.bbox!
      for (const l of lines) expect(hits(b, l), `${k} crosses a drop line`).toBe(false)
      expect(b.x).toBeGreaterThanOrEqual(s.plot.x + 2 - 1e-9)
      expect(b.y + b.h).toBeLessThanOrEqual(s.plot.y + s.plot.h - 2 + 1e-9)
      // Off the bands (from X = the Hill slope to the IC50) too.
      for (const j of ['a', 'b']) {
        const r = prim(byId(s, `result/band/${j}/band`), 'rect')
        expect(b.x >= r.x + r.w || b.x + b.w <= r.x, `${k} on band ${j}`).toBe(true)
      }
    }
    // Near its IC50's point on the curve.
    const down = lines[0]!
    const a = byId(s, 'result/ic/a/label')!.bbox!
    expect(Math.hypot(a.x - down.x1, a.y - down.y1)).toBeLessThan(60)
  })

  it('curveAt interpolates between a curve’s points, null outside them', () => {
    const c = { title: 'c', x: [0, 2, 1], y: [0, 4, 2] }
    expect(curveAt(c, 1.5)).toBe(3)
    expect(curveAt(c, 3)).toBeNull()
  })
})

describe('brackets on XY graphs and from a group to one', () => {
  it('at one X: beside the points there, spanning the two data sets’ centres, stacked outwards', () => {
    const xy = sampleTable('xy')
    const atx = analysisNode('atx', 'ttest', xy, ['a', 'b'], { atX: 5 })
    const bracket = (id: string, label = 'ns') => ({
      type: 'bracket' as const,
      id: id as AnnotationId,
      a: 'a',
      b: 'b',
      x: 5,
      label: { source: 'manual' as const, text: label },
      level: 'auto' as const,
    })
    const graph = graphOf(xy, 'meanSd', () => ({
      annotations: [
        bracket('n1'),
        {
          ...bracket('n2'),
          label: {
            source: 'analysis' as const,
            analysis: 'atx' as NodeId,
            comparison: 'a|b',
            show: 'p' as const,
          },
        },
      ],
    }))
    const s = lay([xy, atx], graph, { atx: TTEST('a', 'b', 0.0021) })
    const one = prim(byId(s, 'annotation/n1/line'), 'polyline').points
    const two = prim(byId(s, 'annotation/n2/line'), 'polyline').points
    // Vertical, right of X = 5, at the means (Slow 6.05, Fast 11.85).
    expect(one[1]![0]).toBe(one[2]![0])
    expect(one[1]![0]).toBeGreaterThan(s.axes!.x.toPx(5))
    expect(s.axes!.y.fromPx(one[1]![1])).toBeCloseTo(12.2 / 2 + 11.5 / 2, 6)
    expect(s.axes!.y.fromPx(one[2]![1])).toBeCloseTo(6.05, 6)
    expect(two[1]![0]).toBeGreaterThan(one[1]![0])
    expect(texts(s, 'annotation/n2/label')).toEqual(['P = 0.0021'])
    // Category graphs leave brackets at an X out; XY graphs leave those without one out.
    expect(
      nodes(
        lay([xy, atx], { ...graph, annotations: [{ ...bracket('n3'), x: undefined }] }, {}),
        'annotation/',
      ),
    ).toEqual([])
  })

  it('from a group to one: the group spanned by a line, the bracket from its centre', () => {
    const column = sampleTable('column')
    const graph = graphOf(column, 'bars', () => ({
      annotations: [
        {
          type: 'bracket',
          id: 'n1' as AnnotationId,
          a: 'a',
          b: 'c',
          group: ['b'],
          label: { source: 'manual', text: '*' },
          level: 'auto',
        },
      ],
    }))
    const s = lay([column], graph, {})
    const cx = (i: number) => s.axes!.x.toPx(i)
    const g = prim(byId(s, 'annotation/n1/group'), 'polyline').points
    const main = prim(byId(s, 'annotation/n1/line'), 'polyline').points
    expect(g[1]![0]).toBeCloseTo(cx(0))
    expect(g[2]![0]).toBeCloseTo(cx(1))
    expect(main[1]![0]).toBeCloseTo((cx(0) + cx(1)) / 2)
    expect(main[2]![0]).toBeCloseTo(cx(2))
    // The group's line under the bracket, on its leg's end.
    expect(g[1]![1]).toBeCloseTo(main[0]![1])
  })
})

describe('the number at risk under a survival graph', () => {
  const survival = sampleTable('survival')
  const graph = (
    more: Partial<NonNullable<GraphNode['riskTable']>> = {},
    axis: Partial<GraphNode['axes']['x']> = {},
  ) =>
    graphOf(survival, 'survival', (g) => ({
      riskTable: { show: true, ...more },
      axes: { ...g.axes, x: { ...g.axes.x, ...axis } as GraphNode['axes']['x'] },
    }))

  it('counts each group at the X axis’ ticks, under them, in the group’s colour; the graph grows', () => {
    const s = lay([survival], graph(), {})
    const without = lay([survival], { ...graph(), riskTable: undefined }, {})
    expect(s.height).toBeGreaterThan(without.height)
    expect(texts(s, 'riskTable/title')).toEqual(['Number at risk'])
    // Placebo: times 2, 3, 4, 5 (events at 2, 4, 5): at 0, 2, 4, 6, 8, 10.
    const subjects = [2, 3, 4, 5].map((time) => ({ time, event: true }))
    expect(texts(s, 'riskTable/a/').filter((t) => t !== 'Placebo')).toEqual(
      numberAtRisk(subjects, [0, 2, 4, 6, 8, 10]).map(String),
    )
    const tick = byId(s, 'riskTable/a/1')!
    expect(tick.bbox!.x + tick.bbox!.w / 2).toBeCloseTo(s.axes!.x.toPx(2))
    expect(prim(byId(s, 'riskTable/a/name'), 'text').color).not.toBe(
      prim(byId(s, 'riskTable/b/name'), 'text').color,
    )
  })

  it('follows the axis’ range and ticks, or counts at chosen times; the title can go', () => {
    const s = lay(
      [survival],
      graph({ title: '' }, { range: { min: 0, max: 6 }, ticks: { interval: 3, minor: 0 } }),
      {},
    )
    expect(texts(s, 'riskTable/title')).toEqual([])
    expect(texts(s, 'riskTable/b/').filter((t) => t !== 'Drug')).toEqual(['4', '4', '4'])
    const times = lay([survival], graph({ times: [5, 7] }), {})
    expect(texts(times, 'riskTable/a/').filter((t) => t !== 'Placebo')).toEqual(['1', '0'])
    expect(byId(times, 'riskTable/a/0')!.bbox!.x).toBeGreaterThan(times.axes!.x.toPx(4))
  })
})

describe('inset results tables', () => {
  const column = sampleTable('column')
  const desc = analysisNode('desc', 'descriptive', column, ['a', 'b', 'c'])
  const table = (more: Record<string, unknown> = {}): GraphNode =>
    graphOf(column, 'bars', () => ({
      annotations: [
        {
          type: 'table',
          id: 'n1' as AnnotationId,
          analysis: 'desc' as NodeId,
          sheet: 'descriptive',
          ...more,
        } as never,
      ],
    }))

  it('show a results sheet in a corner (or chosen rows), live, numbers to set digits', () => {
    const s = lay([column, desc], table({ rows: { from: 1, to: 1 }, digits: 3 }), {
      desc: DESCRIPTIVE,
    })
    expect(texts(s, 'annotation/n1/table/cell')).toEqual([
      'Control',
      'Drug A',
      'Drug B',
      'Mean',
      '13.5',
      '19.5',
      '10.0',
    ])
    const box = byId(s, 'annotation/n1')!.bbox!
    expect(box.x + box.w).toBeCloseTo(s.plot.x + s.plot.w - 4)
    expect(box.y).toBeCloseTo(s.plot.y + 4)
    // Beside the plot: the graph grows to the right.
    const right = lay([column, desc], table({ place: 'right' }), { desc: DESCRIPTIVE })
    expect(byId(right, 'annotation/n1')!.bbox!.x).toBeGreaterThan(right.plot.x + right.plot.w)
    expect(right.width).toBeGreaterThan(s.width)
    // A sheet gone: a placeholder, and why.
    const gone = lay([column, desc], table({ sheet: 'nothing' }), { desc: DESCRIPTIVE })
    expect(texts(gone, 'annotation/n1').join()).toMatch(/no such results sheet/)
  })
})

describe('fits per group on a graph of variables', () => {
  it('a curve fitted to a group’s rows takes the group’s colour', () => {
    const table = sampleVariables()
    const node = analysisNode('mvfit', 'nonlinearFitMV', table, ['c', 'd'])
    const graph = graphOf(table, 'bubble', (g) => ({
      layers: [
        ...g.layers.map((l) =>
          l.geom === 'points' ? ({ ...l, aes: { x: 'd', y: 'c', color: 'a' } } as Layer) : l,
        ),
        {
          id: 'curves',
          geom: 'line',
          stat: { kind: 'identity' },
          data: {
            from: 'outputs',
            series: ['0', '1'].map((i) => ({
              id: `c${i}` as never,
              ref: { node: 'mvfit' as NodeId, key: `mv:curve:${i}` },
            })),
          },
        },
      ],
    }))
    const outputs = {
      'mv:curve:0': { title: 'Low (fit)', x: [30, 60], y: [10, 20], group: 'Low' },
      'mv:curve:1': { title: 'High (fit)', x: [30, 60], y: [12, 24], group: 'High' },
    }
    const s = lay([table, node], graph, { mvfit: result({ outputs }) })
    const color = (id: string) => prim(nodes(s, `curve/${id}`)[0], 'polyline').stroke.color
    // The points of each group, in the group's colour.
    const pointOf = (row: number) =>
      flatten(s.root).find((n) => n.id.endsWith(`/point/${row}`) && n.prim?.type === 'symbol')!
    const fill = (row: number) => (prim(pointOf(row), 'symbol').fill as { color: string }).color
    expect(color('0')).toBe(fill(0)) // row 0: Low
    expect(color('1')).toBe(fill(1)) // row 1: High
  })
})

describe('fits per group linked to graphs of the variables they map', () => {
  it('adds an output with a graph of its own to graphs mapping its X and Y, not others', () => {
    const table = sampleVariables()
    const graph = graphOf(table, 'bubble', (g) => ({
      layers: g.layers.map((l) =>
        l.geom === 'points' ? ({ ...l, aes: { x: 'd', y: 'c', color: 'a' } } as Layer) : l,
      ),
    }))
    const decl = (x: string) => ({
      key: 'mv:curve:0',
      graph: { id: 'mvfit', name: 'Curve fit' },
      mark: 'line' as const,
      onGraphsOf: { x, y: 'c' },
    })
    expect(withOutputSeries(graph, 'mvfit' as NodeId, [decl('d')]).edits.length).toBeGreaterThan(0)
    expect(withOutputSeries(graph, 'mvfit' as NodeId, [decl('b')]).edits).toEqual([])
    expect(
      withOutputSeries(graph, 'mvfit' as NodeId, [{ ...decl('d'), onGraphsOf: undefined }]).edits,
    ).toEqual([])
  })
})

describe('the matrix', () => {
  it('draws results on every graph with value axes, histograms too; not on pies or heat maps', () => {
    expect(frameAllowed('category', 'column', 'label', 'result').allowed).toBe(true)
    expect(frameAllowed('xy', 'survival', 'refline', 'result').allowed).toBe(true)
    expect(frameAllowed('grouped', 'grouped', 'band', 'result').allowed).toBe(true)
    expect(frameAllowed('polar', 'partsOfWhole', 'label', 'result').allowed).toBe(false)
    expect(frameAllowed('matrix', 'grouped', 'label', 'result').allowed).toBe(false)
    const histogram = {
      frame: 'xy' as const,
      layers: [
        { id: 'bars', geom: 'bar', stat: { kind: 'bin' } },
        resultLayer('p', 'label', 'x', { fields: {}, template: 'P' }),
      ] as Layer[],
    }
    expect(checkLayers(histogram, 'column').get('p')?.allowed).toBe(true)
  })
})
