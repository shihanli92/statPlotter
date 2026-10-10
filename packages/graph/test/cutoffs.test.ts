import type { ContinuousAxisSpec, Cutoffs, DataTable, GraphNode, Layer } from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  checkLayers,
  geomAllowed,
  layoutLayers,
  type Scene,
  type SceneNode,
  sceneToSvg,
} from '../src/index.ts'
import { classAt, cutoffValues, DEFAULT_CUTOFFS } from '../src/layers/geoms/threshold.ts'
import { pmBand, pmLine, sigLine, significance, volcanoGraph, volcanoTable } from './cutoffCases.ts'
import { graphOf } from './graphs.ts'
import { byId, fixedTable, flatten, fonts, projectOf, sampleTable } from './helpers.ts'

// Roadmap 46b: lines and bands at ± a value, the Significance layer (points classed by the graph's
// cut-offs) and the cut-offs shared with the volcano thresholds' lines.

const lay = (table: DataTable, graph: GraphNode): Scene =>
  layoutLayers({ project: projectOf(table, graph), graph, fonts })

const prim = <T>(s: Scene, id: string) => byId(s, id)?.prim as T | undefined

/** The legend's labels of a Significance layer's classes. */
const classLabels = (s: Scene, layer = 'sig') =>
  ['up', 'down', 'ns'].map((k) => {
    const n = byId(s, `legend/threshold/${layer}/${k}/label`)
    return n?.prim?.type === 'text' ? n.prim.layout.runs.map((r) => r.text).join('') : undefined
  })

/** The fills of a Significance layer's symbols, by colour, counted. */
const fillsOf = (s: Scene, layer = 'sig') => {
  const out: Record<string, number> = {}
  for (const n of flatten(s.root))
    if (n.layer === layer && n.prim?.type === 'symbol' && n.prim.fill)
      out[n.prim.fill.color] = (out[n.prim.fill.color] ?? 0) + 1
  return out
}

const withX = (g: GraphNode, patch: Partial<ContinuousAxisSpec>): GraphNode => ({
  ...g,
  axes: { ...g.axes, x: { ...(g.axes.x as ContinuousAxisSpec), ...patch } },
})

describe('lines at ± a value', () => {
  const t = volcanoTable()

  it('draws one line at +c and one at −c, ids as a line’s and mirror/…', () => {
    const s = lay(t, volcanoGraph([pmLine('pm', 1)]))
    expect(s.warnings).toEqual([])
    const x = (v: number) => s.axes!.x.toPx(v)
    const plus = prim<{ x1: number; x2: number }>(s, 'result/pm/all/line')!
    const minus = prim<{ x1: number; x2: number }>(s, 'result/pm/all/mirror/line')!
    expect(plus.x1).toBeCloseTo(x(1), 6)
    expect(plus.x2).toBeCloseTo(x(1), 6)
    expect(minus.x1).toBeCloseTo(x(-1), 6)
  })

  it('a negative value draws the same two lines; 0 draws one', () => {
    const a = lay(t, volcanoGraph([pmLine('pm', -1)]))
    const b = lay(t, volcanoGraph([pmLine('pm', 1)]))
    expect(sceneToSvg(a)).toBe(sceneToSvg(b))
    const zero = lay(t, volcanoGraph([pmLine('pm', 0)]))
    expect(byId(zero, 'result/pm/all/line')).toBeDefined()
    expect(byId(zero, 'result/pm/all/mirror/line')).toBeUndefined()
  })

  it('widens the axis to both values', () => {
    const s = lay(t, volcanoGraph([pmLine('pm', 5)]))
    const x = s.axes!.x
    expect(x.fromPx(s.plot.x)).toBeLessThanOrEqual(-5)
    expect(x.fromPx(s.plot.x + s.plot.w)).toBeGreaterThanOrEqual(5)
    expect(byId(s, 'result/pm/all/mirror/line')).toBeDefined()
  })

  it('a log axis draws +c only (−c has no place on it)', () => {
    const xy = sampleTable('xy')
    const g = withX(volcanoGraph([pmLine('pm', 2)]), { scale: 'log10' })
    const s = lay(xy, { ...g, seriesSource: { ...g.seriesSource, table: xy.id } })
    expect(byId(s, 'result/pm/all/line')).toBeDefined()
    expect(byId(s, 'result/pm/all/mirror/line')).toBeUndefined()
  })

  it.each([1, -1])('labels each line with its own value (typed %d)', (v) => {
    const line = pmLine('pm', v)
    const labelled = {
      ...line,
      stat: { ...(line.stat as object), template: 'FC = {at}', lineLabel: 'end' },
    } as Layer
    const s = lay(t, volcanoGraph([labelled]))
    const text = (id: string) => {
      const n = byId(s, id)
      return n?.prim?.type === 'text' ? n.prim.layout.runs.map((r) => r.text).join('') : undefined
    }
    // The line at +1 (`line`) reads 1, the one at −1 (`mirror/line`) −1, whichever was typed.
    expect(text('result/pm/all/lineLabel')).toBe('FC = 1.00')
    expect(text('result/pm/all/mirror/lineLabel')).toMatch(/^FC = [−-]1.00$/)
  })

  it('names its legend entry “±1”', () => {
    const line = { ...pmLine('pm', 1), legend: undefined } as Layer
    const g = volcanoGraph([line])
    const s = lay(t, { ...g, legend: { ...g.legend, show: true } })
    const n = byId(s, 'legend/result/pm/label')
    expect(n?.prim?.type === 'text' && n.prim.layout.runs.map((r) => r.text).join('')).toBe('±1')
  })
})

describe('bands at ± a value', () => {
  const t = volcanoTable()

  it('between −c and +c: one band', () => {
    const s = lay(t, volcanoGraph([pmBand('b', 1, false)]))
    const x = (v: number) => s.axes!.x.toPx(v)
    const r = prim<{ x: number; w: number }>(s, 'result/b/all/band')!
    expect(r.x).toBeCloseTo(x(-1), 6)
    expect(r.x + r.w).toBeCloseTo(x(1), 6)
  })

  it('outside ±c: from +c to the axis’ end and from its start to −c', () => {
    const s = lay(t, volcanoGraph([pmBand('b', 1, true)]))
    const x = (v: number) => s.axes!.x.toPx(v)
    const hi = prim<{ x: number; w: number }>(s, 'result/b/all/band/0')!
    const lo = prim<{ x: number; w: number }>(s, 'result/b/all/band/1')!
    expect(hi.x).toBeCloseTo(x(1), 6)
    expect(hi.x + hi.w).toBeCloseTo(s.plot.x + s.plot.w, 6)
    expect(lo.x).toBeCloseTo(s.plot.x, 6)
    expect(lo.x + lo.w).toBeCloseTo(x(-1), 6)
  })

  it('outside ±c on a reversed axis: still beyond the values', () => {
    const s = lay(t, withX(volcanoGraph([pmBand('b', 1, true)]), { reverse: true }))
    const x = (v: number) => s.axes!.x.toPx(v)
    const hi = prim<{ x: number; w: number }>(s, 'result/b/all/band/0')!
    expect(hi.x).toBeCloseTo(s.plot.x, 6)
    expect(hi.x + hi.w).toBeCloseTo(x(1), 6)
  })

  // Audit 3 (G6): a band whose end falls where the axis shows nothing vanished whole.
  const broken = (g: GraphNode) => withX(g, { breaks: [{ from: 0.5, to: 1.5, gap: 8 }] })
  it('an end inside an axis break: the band up to the break', () => {
    const s = lay(t, broken(volcanoGraph([pmBand('b', 0.8, false)])))
    const x = (v: number) => s.axes!.x.toPx(v)
    const r = prim<{ x: number; w: number }>(s, 'result/b/all/band')!
    expect(r.x).toBeCloseTo(x(-0.8), 6)
    expect(r.x + r.w).toBeCloseTo(x(0.5), 3)
    // Beyond ±1, +1 in the break: from the break's end.
    const out = lay(t, broken(volcanoGraph([pmBand('b', 1, true)])))
    const ox = (v: number) => out.axes!.x.toPx(v)
    const hi = prim<{ x: number; w: number }>(out, 'result/b/all/band/0')!
    expect(hi.x).toBeCloseTo(ox(1.5), 3)
    expect(hi.x + hi.w).toBeCloseTo(out.plot.x + out.plot.w, 6)
    expect(prim(out, 'result/b/all/band/1')).toBeDefined()
  })

  it('an end at or below 0 on a log axis: the band from the axis’ start', () => {
    const xy = sampleTable('xy')
    const band = {
      id: 'b',
      geom: 'band',
      stat: {
        kind: 'result',
        fields: { lo: { ref: { from: 'number', v: -2 } }, hi: { ref: { from: 'number', v: 3 } } },
        lo: 'lo',
        hi: 'hi',
        axis: 'x',
      },
      data: { from: 'values' },
      legend: 'hide',
    } as Layer
    const g = withX(volcanoGraph([band]), { scale: 'log10' })
    const s = lay(xy, { ...g, seriesSource: { ...g.seriesSource, table: xy.id } })
    const r = prim<{ x: number; w: number }>(s, 'result/b/all/band')!
    expect(r.x).toBeCloseTo(s.plot.x, 6)
    expect(r.x + r.w).toBeCloseTo(s.axes!.x.toPx(3), 6)
  })
})

describe('the Significance layer', () => {
  const t = volcanoTable()

  it('classes every point, at a cut-off as significant, missing values left out', () => {
    // −log10 P ≥ 2 and |log2 FC| ≥ 1: rows 40 (1, 2) and 41 (−1, 2) are up and down.
    const cutoffs: Cutoffs = { fold: 1, sig: { value: 2 } }
    const g = volcanoGraph([significance()], cutoffs)
    const s = lay(t, { ...g, legend: { ...g.legend, show: true } })
    // Counted by hand from the table's arithmetic.
    const xs = Array.from({ length: 40 }, (_, i) => ((i * 37) % 61) / 10 - 3)
    const ys = Array.from({ length: 40 }, (_, i) => ((i * 53) % 47) / 8)
    let [up, down, ns] = [1, 1, 0]
    xs.forEach((x, i) => {
      const sig = ys[i]! >= 2
      if (sig && x >= 1) up++
      else if (sig && x <= -1) down++
      else ns++
    })
    expect(classLabels(s)).toEqual([`Up (${up})`, `Down (${down})`, `NS (${ns})`])
    expect(up + down + ns).toBe(42)
    // Drawn in the theme's colours, every classed point.
    expect(fillsOf(s)).toEqual({ '#d62728': up, '#1f77b4': down, '#a6a6a6': ns })
  })

  it('the not significant first, the significant over them', () => {
    const s = lay(t, volcanoGraph([significance()]))
    const fills = flatten(s.root)
      .filter((n) => n.layer === 'sig' && n.prim?.type === 'symbol')
      .map((n) => (n.prim as { fill: { color: string } }).fill.color)
    const lastNs = fills.lastIndexOf('#a6a6a6')
    expect(fills.indexOf('#1f77b4')).toBeGreaterThan(lastNs)
    expect(fills.indexOf('#d62728')).toBeGreaterThan(fills.lastIndexOf('#1f77b4'))
  })

  it('reads the P cut-off as −log10 P; a fold change on Y swaps the axes', () => {
    expect(cutoffValues({}).sig).toBeCloseTo(1.3010299956639813, 14)
    expect(cutoffValues({ cutoffs: DEFAULT_CUTOFFS })).toEqual(cutoffValues({}))
    const c = cutoffValues({ cutoffs: { fold: 1, sig: { value: 2 }, foldAxis: 'y' } })
    expect(classAt(c, 3, 1.5)).toBe('up')
    expect(classAt(c, 3, -1.5)).toBe('down')
    expect(classAt(c, 1, 1.5)).toBe('ns')
    expect(classAt(c, Number.NaN, 1.5)).toBeNull()
  })

  it('over mean points, the axis reaches every replicate it draws (audit 3, G7)', () => {
    // Three replicates, one far above the others: the means stay low.
    const reps = fixedTable(
      'xy',
      { type: 'replicates', count: 3 },
      [
        [
          [0, 0, 0, 0, 0],
          [0, 0, 0, 0, 0],
          [0, 0, 0, 0, 100],
        ],
      ],
      { titles: ['y'], x: [-3, -1, 0, 1, 3] },
    )
    const top = (layers: (g: GraphNode) => Layer[]) => {
      const g = graphOf(reps, 'meanSem', (g) => ({ layers: layers(g) }))
      const s = lay(reps, g)
      return s.axes!.y.fromPx(s.plot.y)
    }
    expect(top((g) => g.layers)).toBeLessThan(100)
    expect(top((g) => [...g.layers, significance()])).toBeGreaterThanOrEqual(100)
    // A hidden Significance layer draws nothing: the means' extent.
    expect(top((g) => [...g.layers, { ...significance(), visible: false }])).toBeLessThan(100)
  })

  it('classes by value whatever the axis’ scale (a log axis draws what it can)', () => {
    const cutoffs: Cutoffs = { fold: 1, sig: { value: 2 } }
    const linear = lay(t, volcanoGraph([significance()], cutoffs))
    const log = lay(
      t,
      withX(volcanoGraph([significance()], cutoffs), { scale: 'log10', range: 'auto' }),
    )
    const g = volcanoGraph([significance()], cutoffs)
    const shown = { ...g, legend: { ...g.legend, show: true } }
    const logShown = withX(shown, { scale: 'log10' })
    expect(classLabels(lay(t, logShown))).toEqual(classLabels(lay(t, shown)))
    // Only positive fold changes have a place on a log X axis: no down points drawn.
    expect(fillsOf(log)['#1f77b4']).toBeUndefined()
    expect(fillsOf(linear)['#1f77b4']).toBeGreaterThan(0)
  })

  it('moves with the cut-offs, as the lines at them do', () => {
    const layers = [pmLine('fc', 'cutoff'), sigLine('p'), significance()]
    const at = (cutoffs: Cutoffs) => {
      const g = volcanoGraph(layers, cutoffs)
      const s = lay(t, { ...g, legend: { ...g.legend, show: true } })
      return {
        labels: classLabels(s),
        x: s.axes!.x.fromPx(prim<{ x1: number }>(s, 'result/fc/all/line')!.x1),
        y: s.axes!.y.fromPx(prim<{ y1: number }>(s, 'result/p/all/line')!.y1),
      }
    }
    const a = at({ fold: 1, sig: { p: 0.01 } })
    const b = at({ fold: 2, sig: { p: 0.01 } })
    expect(a.x).toBeCloseTo(1, 6)
    expect(a.y).toBeCloseTo(2, 6)
    expect(b.x).toBeCloseTo(2, 6)
    expect(b.labels).not.toEqual(a.labels)
  })

  it('an axis of P values: significant at P ≤ the cut-off, the line at the P value', () => {
    const c = cutoffValues({ cutoffs: { fold: 1, sig: { p: 0.01 }, values: 'p' } })
    expect(c.sig).toBe(0.01)
    expect(classAt(c, 2, 0.01)).toBe('up')
    expect(classAt(c, -2, 0.001)).toBe('down')
    expect(classAt(c, 2, 0.02)).toBe('ns')
    // Not a P value: not classed.
    expect(classAt(c, 2, 1.5)).toBeNull()
    expect(classAt(c, 2, -0.1)).toBeNull()
    const axis = cutoffValues({ cutoffs: { fold: 1, sig: { value: 0.05 }, values: 'p' } })
    expect(classAt(axis, 1, 0.05)).toBe('up')
  })

  it('P = 0 (an underflowed P) is the most significant: classed, counted, drawn at the axis’ edge (audit 3, G8 / S5)', () => {
    const c = cutoffValues({ cutoffs: { fold: 1, sig: { p: 0.01 }, values: 'p' } })
    expect(classAt(c, 2, 0)).toBe('up')
    expect(classAt(c, 0.5, 0)).toBe('ns')
    const minus = cutoffValues({ cutoffs: { fold: 1, sig: { value: 2 } } })
    expect(classAt(minus, -2, Number.POSITIVE_INFINITY)).toBe('down')
    // A table of P values on a log axis: P = 0 has no place on it, so it is drawn at the edge
    // where the smallest P values are (the bottom of an axis that isn't reversed).
    const pTable = fixedTable('xy', { type: 'replicates', count: 1 }, [[[0.2, 0.001, 0, 0.5]]], {
      titles: ['P'],
      x: [0.5, -2, 2, 2],
    })
    const g = volcanoGraph([significance()], { fold: 1, sig: { p: 0.01 }, values: 'p' })
    const logY: GraphNode = {
      ...g,
      seriesSource: { ...g.seriesSource, table: pTable.id },
      legend: { ...g.legend, show: true },
      axes: { ...g.axes, y: { ...(g.axes.y as ContinuousAxisSpec), scale: 'log10' } },
    }
    const s = lay(pTable, logY)
    expect(classLabels(s)).toEqual(['Up (1)', 'Down (1)', 'NS (2)'])
    const symbols = flatten(s.root).filter((n) => n.layer === 'sig' && n.prim?.type === 'symbol')
    expect(symbols).toHaveLength(4)
    const cy = (color: string) =>
      symbols
        .map((n) => n.prim as { cy: number; fill: { color: string } })
        .find((p) => p.fill.color === color)!.cy
    const ys = symbols.map((n) => (n.prim as { cy: number }).cy)
    expect(cy('#d62728')).toBe(Math.max(...ys))
  })

  it('a class’ own colour', () => {
    const sig = { ...significance(), style: { classes: { up: { rgb: '#00aa00' } } } } as Layer
    expect(fillsOf(lay(t, volcanoGraph([sig])))['#00aa00']).toBeGreaterThan(0)
  })

  it('of a graph of variables: its mapped points', () => {
    const vars = sampleTable('multipleVariables')
    const mapped: Layer = {
      id: 'points',
      geom: 'points',
      stat: { kind: 'identity' },
      aes: { x: 'a', y: 'b' },
    }
    const g = { ...volcanoGraph([]), layers: [mapped, significance()] }
    const graph = { ...g, seriesSource: { ...g.seriesSource, table: vars.id } }
    const check = checkLayers(graph, 'multipleVariables')
    expect([...check.values()].every((x) => x.allowed)).toBe(true)
    const s = lay(vars, graph)
    const drawn = Object.values(fillsOf(s)).reduce((a, b) => a + b, 0)
    expect(drawn).toBeGreaterThan(0)
    // Without mapped points it has nothing to class.
    const alone = checkLayers({ ...graph, layers: [significance()] }, 'multipleVariables')
    expect(alone.get('sig')?.allowed).toBe(false)
  })

  it('of analysis outputs (another layer’s), and only on XY graphs', () => {
    expect(geomAllowed('xy', 'points', 'threshold', { outputs: true }).allowed).toBe(true)
    expect(geomAllowed('column', 'points', 'threshold').allowed).toBe(false)
    expect(geomAllowed('grouped', 'points', 'threshold').allowed).toBe(false)
  })

  it('no own legend entry for a data set only it draws', () => {
    const g = volcanoGraph([])
    const only = { ...g, layers: [significance()], legend: { ...g.legend, show: true } }
    const s = lay(t, only)
    expect(byId(s, 'legend/a/label')).toBeUndefined()
    expect(byId(s, 'legend/threshold/sig/up/label')).toBeDefined()
  })
})

/** (Scene nodes of a layer, for debugging.) */
export const ofLayer = (s: Scene, layer: string): SceneNode[] =>
  flatten(s.root).filter((n) => n.layer === layer)
