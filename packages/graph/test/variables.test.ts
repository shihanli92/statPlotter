import { createTable, type DataTable } from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  bubbleData,
  createGraphFor,
  layoutGraph,
  MISSING_POINT_COLOR,
  presetGraph,
  resolveSeries,
  type SceneNode,
  themeFor,
} from '../src/index.ts'
import { layerOf } from './graphs.ts'
import { byId, fonts, prim, projectOf } from './helpers.ts'

const text = (n: SceneNode | undefined) =>
  prim(n, 'text')
    .layout.runs.map((r) => r.text)
    .join('')

/** Age, weight, a text group and a calculated variable. */
function cohort(): DataTable {
  const t = createTable({ tableKind: 'multipleVariables', columns: 4, rows: 5 })
  const [age, group, weight, calc] = t.dataSets
  age!.title = 'Age'
  age!.subcolumns[0]!.values = [30, 40, 50, 60, 70]
  group!.title = 'Group'
  group!.text = ['WT', 'KO', 'WT', null, 'Het']
  weight!.title = 'Weight'
  weight!.subcolumns[0]!.values = [60, 70, 80, 90, 100]
  calc!.title = 'Double weight'
  calc!.formula = '=Weight * 2'
  return t
}

describe('graphs of text and calculated variables', () => {
  it('a new bubble plot takes numeric X, Y and size, and the text variable as colour', () => {
    const t = cohort()
    const g = presetGraph(t, 'bubble')
    const [age, group, weight, calc] = t.dataSets.map((d) => d.id)
    expect(layerOf(g, 'bubbles').aes).toEqual({ x: age, y: weight, size: calc, color: group })
  })

  it('colours bubbles by category with the palette, and lists the categories', () => {
    const t = cohort()
    const graph = presetGraph(t, 'bubble')
    const project = projectOf(t, graph)
    const data = bubbleData(project, graph)
    expect(data.categories).toEqual(['WT', 'KO', 'Het'])
    // Row 3 has no group: drawn in the missing colour (roadmap 34b; it was left out before). The
    // size (calculated) is 2 × weight.
    expect(data.rows.map((r) => [r.row, r.color, r.size])).toEqual([
      [0, 0, 120],
      [1, 1, 140],
      [2, 0, 160],
      [3, Number.NaN, 180],
      [4, 2, 200],
    ])
    const scene = layoutGraph({ project, graph, fonts })
    const palette = themeFor(project.settings.theme).palette
    const yKey = t.dataSets[2]!.id
    expect(prim(byId(scene, `series/${yKey}/point/1`), 'symbol').fill?.color).toBe(palette[1])
    expect(prim(byId(scene, `series/${yKey}/point/4`), 'symbol').fill?.color).toBe(palette[2])
    expect(prim(byId(scene, `series/${yKey}/point/3`), 'symbol').fill?.color).toBe(
      MISSING_POINT_COLOR,
    )
    expect(text(byId(scene, 'legend/bubble/color/label'))).toBe('Group')
    expect(text(byId(scene, 'legend/bubble/color/0/label'))).toBe('WT')
    expect(text(byId(scene, 'legend/bubble/color/2/label'))).toBe('Het')
    expect(prim(byId(scene, 'legend/bubble/color/2/swatch'), 'rect').fill?.color).toBe(palette[2])
  })

  it('leaves text variables out of other graphs, and plots calculated values', () => {
    const t = cohort()
    const graph = createGraphFor(t)
    const series = resolveSeries(projectOf(t, graph), graph)
    expect(series.map((s) => s.title)).toEqual(['Age', 'Weight', 'Double weight'])
    const calc = series[2]!.ds
    expect(calc.data.shape === 'replicates' && [...calc.data.reps[0]!]).toEqual([
      120, 140, 160, 180, 200,
    ])
  })
})
