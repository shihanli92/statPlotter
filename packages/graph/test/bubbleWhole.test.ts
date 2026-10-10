import { createTable, GraphNode as GraphNodeSchema } from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  applyPreset,
  bubbleSizer,
  createGraphFor,
  hitTest,
  layoutGraph,
  matchGraphFormat,
  mixColor,
  presetsFor,
  type Scene,
  type SceneNode,
  sceneToSvg,
  wedgePoints,
} from '../src/index.ts'
import { graphOf, layerOf, withLayer } from './graphs.ts'
import { byId, flatten, fonts, prim, projectOf } from './helpers.ts'

const all = (s: Scene) => flatten(s.root)
const text = (n: SceneNode | undefined) =>
  prim(n, 'text')
    .layout.runs.map((r) => r.text)
    .join('')

describe('bubble plots', () => {
  function setup() {
    const table = createTable({ tableKind: 'multipleVariables', columns: 4, rows: 5 })
    const cols = [
      [1, 2, 3, 4, 5], // X
      [10, 30, 20, 50, 40], // Y
      [1, 4, 9, 16, null], // size (row 4 missing → left out)
      [0, 1, 2, 3, 4], // colour
    ]
    table.dataSets.forEach((d, i) => {
      d.title = ['Age', 'Dose', 'Weight', 'Score'][i]!
      d.subcolumns[0]!.values = cols[i]!
    })
    const graph = graphOf(table, 'bubble')
    return { table, graph, project: projectOf(table, graph) }
  }

  it('is offered for multiple-variables tables and made with titled axes', () => {
    expect(presetsFor('multipleVariables').map((p) => p.id)).toContain('bubble')
    const { graph, table } = setup()
    expect(graph.look).toBe('bubble.scatter')
    expect(layerOf(graph, 'bubbles').aes).toEqual({
      x: table.dataSets[0]!.id,
      y: table.dataSets[1]!.id,
      size: table.dataSets[2]!.id,
      color: table.dataSets[3]!.id,
    })
    expect(() => GraphNodeSchema.parse(graph)).not.toThrow()
  })

  it('places one bubble per complete row, area proportional to size, coloured by a gradient', () => {
    const { project, graph, table } = setup()
    const scene = layoutGraph({ project, graph, fonts })
    expect(scene.warnings).toEqual([])
    const yKey = table.dataSets[1]!.id
    const bubbles = all(scene).filter((n) => n.id.startsWith(`series/${yKey}/point/`))
    expect(bubbles).toHaveLength(4)
    const b3 = prim(byId(scene, `series/${yKey}/point/3`), 'symbol')
    const b0 = prim(byId(scene, `series/${yKey}/point/0`), 'symbol')
    expect(b3.cx).toBeCloseTo(scene.axes!.x.toPx(4), 6)
    expect(b3.cy).toBeCloseTo(scene.axes!.y.toPx(50), 6)
    // Largest (16) at the maximum diameter; 1 → 30·√(1/16) = 7.5.
    expect(b3.size).toBeCloseTo(30, 9)
    expect(b0.size).toBeCloseTo(7.5, 9)
    // Colour 0 → the light end, 3 → the dark end (the colour range of the rows drawn).
    expect(b0.fill?.color).toBe('#c6dbef')
    expect(b3.fill?.color).toBe('#08306b')
    // Big bubbles first (drawn behind).
    expect(bubbles[0]!.id).toBe(`series/${yKey}/point/3`)
    expect(bubbles[0]!.point).toBe('r3')
    // Legend: size and colour headings with reference bubbles.
    expect(text(byId(scene, 'legend/bubble/size/label'))).toBe('Weight')
    expect(text(byId(scene, 'legend/bubble/color/label'))).toBe('Score')
    const sizeSample = prim(byId(scene, 'legend/bubble/size/0/symbol'), 'symbol')
    expect(sizeSample.size).toBeGreaterThan(10)
    expect(sceneToSvg(scene)).toContain('<path')
    // A click on a bubble selects its point of the Y variable.
    const hit = hitTest(scene.root, b3.cx, b3.cy)
    expect(hit?.node.point).toBe('r3')
    expect(hit?.target).toEqual(['layers', 'bubbles', 'series', yKey])
  })

  it('sizes, colours and variable choices', () => {
    expect(bubbleSizer([-1, 1], 20, 4)(-1)).toBeCloseTo(4, 9)
    expect(bubbleSizer([-1, 1], 20, 4)(1)).toBeCloseTo(20, 9)
    expect(bubbleSizer([0, 100], 20, 4)(1)).toBeCloseTo(4, 9) // min size
    expect(mixColor('#000000', '#ffffff', 0.5)).toBe('#808080')
    const { project, graph, table } = setup()
    const swapped = withLayer(graph, 'bubbles', {
      aes: { x: table.dataSets[1]!.id, y: table.dataSets[0]!.id },
    })
    project.nodes[swapped.id] = swapped as never
    const scene = layoutGraph({ project, graph: swapped, fonts })
    const b = prim(byId(scene, `series/${table.dataSets[0]!.id}/point/4`), 'symbol')
    expect(b.cx).toBeCloseTo(scene.axes!.x.toPx(40), 6)
    expect(byId(scene, 'legend/bubble/size/0/symbol')).toBeUndefined()
  })

  it('switching a column graph to a bubble plot gives continuous axes; Magic keeps the variables', () => {
    const { table, graph, project } = setup()
    const column = createGraphFor(table)
    const bubble = applyPreset(column, 'bubble', table)
    expect(bubble.frame).toBe('xy')
    expect(bubble.axes.x.type).toBe('continuous')
    expect(bubble.id).toBe(column.id)
    const back = applyPreset(bubble, 'bars', table)
    expect(back.axes.x.type).toBe('categorical')
    const other = {
      ...withLayer(graph, 'bubbles', { aes: { x: 'aaa', y: 'bbb' } }),
      scales: { size: { max: 12 } },
    }
    const matched = matchGraphFormat(project, graph, other)
    expect(layerOf(matched, 'bubbles').aes?.x).toBe(layerOf(graph, 'bubbles').aes?.x)
    expect(matched.scales?.size?.max).toBe(12)
  })
})

describe('parts of whole', () => {
  function setup(type: 'whole.pie' | 'whole.donut' | 'whole.bar' = 'whole.pie') {
    const table = createTable({ tableKind: 'partsOfWhole', columns: 2, rows: 4 })
    table.rowTitles = ['Apples', 'Pears', 'Plums', 'Figs']
    table.dataSets[0]!.subcolumns[0]!.values = [50, 25, 25, null]
    table.dataSets[1]!.subcolumns[0]!.values = [10, 10, 10, 10]
    const graph =
      type === 'whole.pie'
        ? createGraphFor(table)
        : graphOf(table, type === 'whole.donut' ? 'donut' : 'wholeBars')
    return { table, graph, project: projectOf(table, graph) }
  }

  it('new parts-of-whole tables have row titles and graph as pies', () => {
    const { table, graph } = setup()
    expect(table.rowTitles).not.toBeNull()
    expect(graph.look).toBe('whole.pie')
    expect(presetsFor('partsOfWhole').map((p) => p.id)).toEqual(['pie', 'donut', 'wholeBars'])
  })

  it('draws one pie per data set, slices in proportion clockwise from 12 o’clock', () => {
    const { project, graph, table } = setup()
    const scene = layoutGraph({ project, graph, fonts })
    expect(scene.warnings).toEqual([])
    const key = table.dataSets[0]!.id
    const slice0 = prim(byId(scene, `series/${key}/slice/0`), 'polygon')
    const slice1 = prim(byId(scene, `series/${key}/slice/1`), 'polygon')
    // A pie slice starts at the centre; the first arc point is straight up.
    const [cx, cy] = slice0.points[0]!
    const top = slice0.points[1]!
    expect(top[0]).toBeCloseTo(cx, 6)
    expect(top[1]).toBeLessThan(cy)
    const r = cy - top[1]
    // Half of the pie: ends straight down.
    const end = slice0.points.at(-1)!
    expect(end[0]).toBeCloseTo(cx, 6)
    expect(end[1]).toBeCloseTo(cy + r, 6)
    // The next slice starts there and covers a quarter (ends at 9 o'clock).
    expect(slice1.points[1]![1]).toBeCloseTo(cy + r, 6)
    expect(slice1.points.at(-1)![0]).toBeCloseTo(cx - r, 6)
    // No slice for the empty row; percentages as labels; colours by category.
    expect(byId(scene, `series/${key}/slice/3`)).toBeUndefined()
    expect(text(byId(scene, `series/${key}/sliceLabel/0`))).toBe('50%')
    const key2 = table.dataSets[1]!.id
    expect(prim(byId(scene, `series/${key2}/slice/0`), 'polygon').fill.color).toBe(
      slice0.fill.color,
    )
    // Legend lists the categories; each pie has its data set's title under it.
    expect(text(byId(scene, 'legend/category/2/label'))).toBe('Plums')
    expect(text(byId(scene, `series/${key}/title`))).toBe(table.dataSets[0]!.title)
    expect(byId(scene, `series/${key}/slice/1`)!.point).toBe('r1')
    expect(sceneToSvg(scene)).toContain('<polygon')
  })

  it('donuts have a hole; slices explode; labels outside with category and percent', () => {
    const { project, graph, table } = setup('whole.donut')
    const key = table.dataSets[0]!.id
    const g = {
      ...withLayer(graph, 'labels', { style: { content: 'categoryPercent', position: 'outside' } }),
      pointOverrides: { [key]: { r1: { explode: 0.2, color: { rgb: '#ff0000' } } } },
    }
    project.nodes[g.id] = g as never
    const scene = layoutGraph({ project, graph: g, fonts })
    const s0 = prim(byId(scene, `series/${key}/slice/0`), 'polygon')
    const s1 = prim(byId(scene, `series/${key}/slice/1`), 'polygon')
    const s2 = prim(byId(scene, `series/${key}/slice/2`), 'polygon')
    expect(s1.fill.color).toBe('#ff0000')
    // Donut slice 0 (0°–180°): outer arc from 12 to 6 o'clock, then the inner arc back; the
    // hole is half the radius.
    const pts = s0.points
    const [outerTop, outerBottom] = [pts[0]!, pts[(pts.length >> 1) - 1]!]
    const [innerBottom, innerTop] = [pts[pts.length >> 1]!, pts.at(-1)!]
    const cy = (outerTop[1] + outerBottom[1]) / 2
    const cx = outerTop[0]
    expect(innerTop[0]).toBeCloseTo(cx, 6)
    expect((cy - innerTop[1]) / (cy - outerTop[1])).toBeCloseTo(0.5, 6)
    expect((innerBottom[1] - cy) / (outerBottom[1] - cy)).toBeCloseTo(0.5, 6)
    // Slice 2 (270°–360°) is not exploded: its outer arc ends at 12 o'clock on the centre;
    // slice 1 (180°–270°), exploded by 0.2 R, moves down-left (towards 225°).
    const r = cy - outerTop[1]
    expect(s2.points[(s2.points.length >> 1) - 1]![0]).toBeCloseTo(cx, 6)
    const s1Start = s1.points[0]! // outer arc at 180°: straight down, shifted
    const shift = 0.2 * r * Math.SQRT1_2
    expect(s1Start[0]).toBeCloseTo(cx - shift, 6)
    expect(s1Start[1]).toBeCloseTo(cy + r + shift, 6)
    expect(text(byId(scene, `series/${key}/sliceLabel/0`))).toBe('Apples (50%)')
    expect(wedgePoints(0, 0, 10, 5, 0, 90)).toHaveLength(2 * 46)
  })

  it('100% stacked bars stack the fractions to 100 on a percent axis', () => {
    const { project, graph, table } = setup('whole.bar')
    const scene = layoutGraph({ project, graph, fonts })
    expect(scene.warnings).toEqual([])
    const key = table.dataSets[1]!.id
    const y = scene.axes!.y
    const segs = [0, 1, 2, 3].map((r) => prim(byId(scene, `series/${key}/slice/${r}`), 'rect'))
    expect(segs[0]!.y + segs[0]!.h).toBeCloseTo(y.toPx(0), 6)
    expect(segs[0]!.y).toBeCloseTo(y.toPx(25), 6)
    expect(segs[3]!.y).toBeCloseTo(y.toPx(100), 6)
    expect(text(byId(scene, `series/${key}/sliceLabel/2`))).toBe('25%')
    expect(() => GraphNodeSchema.parse(graph)).not.toThrow()
  })

  it('100% stacked bars with a log Y spec keep a linear 0–100 axis, with a warning', () => {
    const { project, graph } = setup('whole.bar')
    const y = graph.axes.y.type === 'continuous' ? graph.axes.y : null
    const g = { ...graph, axes: { ...graph.axes, y: { ...y!, scale: 'log10' as const } } }
    const scene = layoutGraph({ project, graph: g, fonts })
    expect(scene.warnings).toEqual(['Stacked percentages need a linear Y axis.'])
    const labels = all(scene)
      .filter((n) => n.id.startsWith('axis/y/tickLabel/') && n.prim)
      .map(text)
    expect(labels).toEqual(['0', '25', '50', '75', '100'])
    expect(sceneToSvg(scene)).not.toMatch(/Infinity|NaN/)
  })
})
