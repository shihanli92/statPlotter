import { createTable, GraphNode as GraphNodeSchema } from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  estimationDiffs,
  layoutGraph,
  plotStats,
  resolveSeries,
  type Scene,
  sceneToSvg,
} from '../src/index.ts'
import { graphOf } from './graphs.ts'
import { byId, flatten, fonts, prim, projectOf } from './helpers.ts'

const xLabels = (scene: Scene) =>
  flatten(scene.root)
    .filter((n) => n.id.startsWith('axis/x/tickLabel/'))
    .map((n) =>
      prim(n, 'text')
        .layout.runs.map((r) => r.text)
        .join(''),
    )

const A = [34.1, 38.5, 29.8, 41.2, 35.6, 32.3, 36.9, 30.4]
const B = [45.2, 52.8, 48.1, 39.7, 50.3, 47.6, 44.9, 51.5, 49.0]
const meanA = A.reduce((a, b) => a + b) / A.length

function setup(groups: (number | null)[][] = [A, B]) {
  const rows = Math.max(...groups.map((g) => g.length))
  const table = createTable({ columns: groups.length, rows })
  groups.forEach((g, i) => {
    table.dataSets[i]!.subcolumns[0]!.values = Array.from({ length: rows }, (_, r) => g[r] ?? null)
  })
  const graph = graphOf(table, 'estimation')
  return { table, graph, project: projectOf(table, graph) }
}

describe('estimation plots', () => {
  it("differences and CIs match R's t.test (pooled and Welch)", () => {
    const { project, graph } = setup()
    const series = resolveSeries(project, graph).map((s) => ({ s, stats: plotStats(s.ds) }))
    // R: t.test(B, A, var.equal = TRUE)$conf.int; t.test(B, A)$conf.int
    const [pooled] = estimationDiffs(series, false, 0.95)
    expect(pooled!.diff).toBeCloseTo(12.827777777777776, 12)
    expect(pooled!.lo).toBeCloseTo(8.7028408515212234, 10)
    expect(pooled!.hi).toBeCloseTo(16.952714704034328, 10)
    const [welch] = estimationDiffs(series, true, 0.95)
    expect(welch!.lo).toBeCloseTo(8.697906518103192, 10)
    expect(welch!.hi).toBeCloseTo(16.957649037452359, 10)
  })

  it('puts the difference on a floating right axis whose zero is the control mean', () => {
    const { project, graph, table } = setup()
    expect(graph.look).toBe('column.estimation')
    expect(graph.axes.y2).toBeDefined()
    const scene = layoutGraph({ project, graph, fonts })
    expect(scene.warnings).toEqual([])
    const y = scene.axes!.y
    const y2 = scene.axes!.y2!
    // Three slots: A, B and the difference.
    const keyB = table.dataSets[1]!.id
    const diff = prim(byId(scene, `estimation/${keyB}/diff`), 'symbol')
    expect(diff.cx).toBeCloseTo(scene.plot.x + (2.5 * scene.plot.w) / 3, 6)
    expect(diff.cy).toBeCloseTo(y.toPx(meanA + 12.827777777777776), 6)
    // The right axis maps 0 to the control's mean and has the left axis' units.
    expect(y2.toPx(0)).toBeCloseTo(y.toPx(meanA), 6)
    expect(y2.toPx(10) - y2.toPx(0)).toBeCloseTo(y.toPx(meanA + 10) - y.toPx(meanA), 6)
    // CI line from lo to hi.
    const ci = prim(byId(scene, `estimation/${keyB}/ci/0`), 'line')
    expect(Math.min(ci.y1, ci.y2)).toBeCloseTo(y.toPx(meanA + 16.952714704034328), 6)
    // Floating: the axis line spans the ticks around the differences, not the whole plot.
    const line = prim(byId(scene, 'axis/y2/line'), 'line')
    const len = Math.abs(line.y2 - line.y1)
    expect(len).toBeGreaterThan(0)
    expect(len).toBeLessThan(scene.plot.h)
    expect(y2.fromPx(Math.max(line.y1, line.y2))).toBeCloseTo(0, 6)
    expect(byId(scene, 'axis/y2/tickLabel/0')).toBeDefined()
    expect(xLabels(scene)).toEqual(['Group A', 'Group B', 'Difference'])
    expect(byId(scene, 'estimation/guide/control')).toBeDefined()
    expect(() => GraphNodeSchema.parse(graph)).not.toThrow()
    expect(sceneToSvg(scene)).toContain('Difference')
  })

  it('several groups against the first (control)', () => {
    const { project, graph, table } = setup([A, B, A.map((v) => v + 3)])
    const scene = layoutGraph({ project, graph, fonts })
    expect(scene.warnings).toEqual([])
    const keyC = table.dataSets[2]!.id
    const y = scene.axes!.y
    expect(prim(byId(scene, `estimation/${keyC}/diff`), 'symbol').cy).toBeCloseTo(
      y.toPx(meanA + 3),
      6,
    )
    expect(xLabels(scene).slice(3)).toEqual(['Group B − Group A', 'Group C − Group A'])
  })

  it('warns with one data set and on a log axis', () => {
    const one = setup([A])
    expect(layoutGraph({ ...one, fonts }).warnings.join(' ')).toMatch(/two or more/)
    const two = setup()
    const log = {
      ...two.graph,
      axes: { ...two.graph.axes, y: { ...two.graph.axes.y, scale: 'log10' as const } },
    }
    two.project.nodes[log.id] = log as never
    const s = layoutGraph({ project: two.project, graph: log, fonts })
    expect(s.warnings.join(' ')).toMatch(/linear Y axis/)
  })
})
