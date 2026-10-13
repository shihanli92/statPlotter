import {
  createTable,
  type FunctionCurve,
  type GraphNode,
  GraphNode as GraphNodeSchema,
  newSeriesId,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { PATHOLOGICAL_EQUATIONS } from '../../stats/test/pathologicalEquations.ts'
import {
  defaultFunctionParams,
  evaluateFunction,
  functionModel,
  layoutGraph,
  type Prim,
  presetGraph,
} from '../src/index.ts'
import { flatten, fonts, nodes, projectOf } from './helpers.ts'

const hill: FunctionCurve = {
  id: newSeriesId(),
  equation: 'agonist-response-variable-slope',
  params: { Bottom: 0, Top: 100, LogEC50: -6, HillSlope: 1 },
  from: -9,
  to: -3,
}

/** An XY graph with the functions in a functions layer behind the table's data. */
function setup(functions: FunctionCurve[], edit: (g: GraphNode) => GraphNode = (g) => g) {
  const table = createTable({ tableKind: 'xy', columns: 1, rows: 3 })
  const base = presetGraph(table, 'meanSd')
  const graph = edit({
    ...base,
    layers: [
      {
        id: 'functions',
        geom: 'line',
        stat: { kind: 'identity' },
        data: { from: 'functions', functions: functions.map(({ style: _, ...fc }) => fc) },
      },
      ...base.layers,
    ],
  })
  return { table, graph, project: projectOf(table, graph) }
}

describe('plot a function', () => {
  it('evaluates built-in equations at the given parameters', () => {
    expect(evaluateFunction(hill, [0, 1], false)!.x).toHaveLength(200)
    const d = evaluateFunction({ ...hill, points: 201 }, [0, 1], false)!
    expect(d.x[0]).toBe(-9)
    expect(d.x.at(-1)).toBe(-3)
    // At LogEC50 the response is half-way.
    const mid = d.x.findIndex((v) => Math.abs(v + 6) < 1e-9)
    expect(mid).toBeGreaterThan(0)
    expect(d.y[mid]).toBeCloseTo(50, 9)
    expect(d.title).toMatch(/Variable slope/)
    expect(defaultFunctionParams({ equation: 'agonist-response-variable-slope' })).toEqual({
      Bottom: 0,
      Top: 100,
      LogEC50: 1,
      HillSlope: 1,
    })
  })

  it('evaluates user-defined equations, reporting parse errors and missing values', () => {
    const fc: FunctionCurve = {
      id: newSeriesId(),
      equation: 'user',
      userEquation: 'Y = A*exp(-K*X) + C',
      params: { A: 10, K: 0.5 },
      from: 0,
      to: 4,
      points: 5,
    }
    const warnings: string[] = []
    const d = evaluateFunction(fc, [0, 1], false, warnings)!
    expect(d.y).toEqual([
      10,
      10 * Math.exp(-0.5),
      10 * Math.exp(-1),
      10 * Math.exp(-1.5),
      10 * Math.exp(-2),
    ])
    expect(warnings.join(' ')).toMatch(/no value for C/)
    const bad = functionModel({ equation: 'user', userEquation: 'Y = (X +' })
    expect('error' in bad && bad.error).toMatch(/Line 1/)
    // log(X) is undefined below zero: NaN, drawn as a gap.
    const log = evaluateFunction(
      { ...fc, userEquation: 'Y = log(X)', from: -1, to: 1, points: 3 },
      [0, 1],
      false,
    )!
    expect(Number.isNaN(log.y[0]!)).toBe(true)
  })

  it('plots an equation without parameters (Y = sin(X))', () => {
    const m = functionModel({ equation: 'user', userEquation: 'Y = sin(X)' })
    if ('error' in m) throw new Error(m.error)
    expect(m.params).toEqual([])
    expect(m.f(Math.PI / 2, [])).toBeCloseTo(1, 15)
  })

  it('draws the curve over its range, in the legend, and the axes include it', () => {
    const { project, graph } = setup([hill])
    expect(() => GraphNodeSchema.parse(graph)).not.toThrow()
    const scene = layoutGraph({ project, graph, fonts })
    expect(scene.warnings).toEqual([])
    const lines = nodes(scene, 'function/0/')
    expect(lines.length).toBeGreaterThan(0)
    expect(lines[0]!.target).toEqual(['layers', 'functions', 'series', hill.id])
    const pts = lines.flatMap((n) => (n.prim as Extract<Prim, { type: 'polyline' }>).points)
    const x = scene.axes!.x
    const y = scene.axes!.y
    expect(Math.min(...pts.map((p) => p[0]))).toBeCloseTo(x.toPx(-9), 6)
    expect(y.fromPx(scene.plot.y)).toBeGreaterThanOrEqual(99)
    expect(flatten(scene.root).some((n) => n.id === 'legend/function/0')).toBe(true)
  })

  it('without a range it spans the X axis, and a bad equation warns', () => {
    const { project, graph } = setup(
      [
        {
          ...hill,
          from: undefined,
          to: undefined,
          equation: 'straight-line',
          params: { Slope: 2, YIntercept: 1 },
        },
      ],
      (g) => ({
        ...g,
        axes: { ...g.axes, x: { ...g.axes.x, range: { min: 0, max: 10 } } } as GraphNode['axes'],
      }),
    )
    const scene = layoutGraph({ project, graph, fonts })
    const pts = nodes(scene, 'function/0/').flatMap(
      (n) => (n.prim as Extract<Prim, { type: 'polyline' }>).points,
    )
    const x = scene.axes!.x
    expect(Math.min(...pts.map((p) => p[0]))).toBeCloseTo(x.toPx(0), 6)
    expect(Math.max(...pts.map((p) => p[0]))).toBeCloseTo(x.toPx(10), 6)
    const bad = setup([{ ...hill, equation: 'nope' }])
    expect(layoutGraph({ ...bad, fonts }).warnings.join(' ')).toMatch(/Unknown equation/)
  })

  it('a pathological user equation is a warning, never a hang or a throw (audit 4 T1)', () => {
    for (const { label, text } of PATHOLOGICAL_EQUATIONS) {
      // The graph schema allows 20,000 characters; longer texts only reach the parser.
      if (text.length > 20000) continue
      const { project, graph } = setup([
        { ...hill, equation: 'user', userEquation: text, params: {} },
      ])
      expect(() => GraphNodeSchema.parse(graph), label).not.toThrow()
      const t0 = performance.now()
      const scene = layoutGraph({ project, graph, fonts })
      expect(performance.now() - t0, label).toBeLessThan(3000)
      expect(Array.isArray(scene.warnings), label).toBe(true)
    }
  })
})
