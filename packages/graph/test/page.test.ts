import {
  createProject,
  createTable,
  type GraphNode,
  type LayoutNode,
  type NodeId,
  newLayoutItemId,
  newNodeId,
  type Project,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  applyPreset,
  arrangeGrid,
  createGraphFor,
  layoutGraph,
  layoutPage,
  matchGraphFormat,
  panelLabel,
  sceneToSvg,
} from '../src/index.ts'
import { flatten, fonts } from './helpers.ts'

function setup() {
  const project: Project = createProject()
  const add = (n: Project['nodes'][NodeId]) => {
    project.nodes[n.id] = n
    project.order.push(n.id)
  }
  const table = createTable({ columns: 2, rows: 3 })
  table.dataSets[0]!.subcolumns[0]!.values = [1, 2, 3]
  table.dataSets[1]!.subcolumns[0]!.values = [4, 5, 6]
  add(table)
  const g1 = createGraphFor(table, 'One')
  const g2 = applyPreset(createGraphFor(table, 'Two'), 'bars', table)
  add(g1)
  add(g2)
  const layout: LayoutNode = {
    kind: 'layout',
    id: newNodeId(),
    name: 'Figure 1',
    page: { width: 612, height: 792 },
    items: [
      { type: 'graph', id: newLayoutItemId(), graph: g1.id, x: 36, y: 40, scale: 0.5 },
      {
        type: 'text',
        id: newLayoutItemId(),
        x: 300,
        y: 700,
        content: { content: [{ text: 'n = 3' }] },
      },
      { type: 'graph', id: newLayoutItemId(), graph: g2.id, x: 320, y: 40, scale: 1 },
    ],
    panelLabels: { show: true, style: 'A', size: 14 },
  }
  add(layout)
  return { project, table, g1, g2, layout }
}

describe('layout pages', () => {
  it('places each graph with a transform and reports item boxes', () => {
    const { project, layout, g1 } = setup()
    const page = layoutPage({ project, layout, fonts })
    expect([page.width, page.height]).toEqual([612, 792])
    const item = flatten(page.root).find((n) => n.id === `item/${layout.items[0]!.id}`)!
    expect(item.transform).toEqual({ x: 36, y: 40, scale: 0.5 })
    const own = layoutGraph({ project, graph: g1, fonts })
    const box = page.items[0]!
    expect(box.w).toBeCloseTo(own.width / 2, 9)
    expect(box.h).toBeCloseTo(own.height / 2, 9)
    expect(page.items.map((b) => b.index)).toEqual([0, 1, 2])
  })

  it('letters graphs (not text) in item order', () => {
    const { project, layout } = setup()
    const page = layoutPage({ project, layout, fonts })
    const labels = flatten(page.root)
      .filter((n) => n.id.endsWith('/label') && n.id.startsWith('item/'))
      .map((n) => (n.prim?.type === 'text' ? n.prim.layout.runs[0]!.text : ''))
    expect(labels).toEqual(['A', 'B'])
    const off = layoutPage({
      project,
      layout: { ...layout, panelLabels: { ...layout.panelLabels, show: false } },
      fonts,
    })
    expect(flatten(off.root).some((n) => n.id.endsWith('/label') && n.id.startsWith('item/'))).toBe(
      false,
    )
    expect([panelLabel(0, '(a)'), panelLabel(27, 'A'), panelLabel(1, 'a')]).toEqual([
      '(a)',
      'AB',
      'b',
    ])
  })

  it('renders to SVG with nested transforms', () => {
    const { project, layout } = setup()
    const svg = sceneToSvg(layoutPage({ project, layout, fonts }))
    expect(svg).toContain('transform="translate(36 40) scale(0.5)"')
    expect(svg).toContain('transform="translate(320 40)"')
    expect(svg).toContain('n = 3')
    expect(svg).not.toContain('NaN')
  })

  it('shows a placeholder for a missing graph', () => {
    const { project, layout } = setup()
    const broken: LayoutNode = {
      ...layout,
      items: [{ type: 'graph', id: newLayoutItemId(), graph: newNodeId(), x: 0, y: 0, scale: 1 }],
    }
    const page = layoutPage({ project, layout: broken, fonts })
    expect(page.warnings).toHaveLength(1)
    expect(page.items[0]!.w).toBeGreaterThan(0)
  })

  it('arranges graphs on a grid, scaling down only', () => {
    const page = { width: 612, height: 792 }
    const cells = arrangeGrid(
      [
        { w: 200, h: 150 },
        { w: 400, h: 300 },
        { w: 100, h: 100 },
      ],
      page,
      2,
    )
    expect(cells[0]!.scale).toBe(1)
    expect(cells[1]!.scale).toBeCloseTo(270 / 400, 9) // cell width (612 − 72) / 2
    expect(cells[2]!.y).toBeCloseTo(36 + (792 - 72) / 2, 9)
    expect(cells[0]!.x + 200).toBeLessThanOrEqual(36 + 270)
  })
})

describe('match format (Magic)', () => {
  it('copies styles, size and data-set formats by position, not data or titles', () => {
    const { project, g1, g2, table } = setup()
    const [a, b] = table.dataSets.map((d) => d.id)
    const source: GraphNode = {
      ...g2,
      size: { plotWidth: 300, plotHeight: 200 },
      seriesOverrides: { [a!]: { color: { rgb: '#ff0000' } }, [b!]: { color: { rgb: '#00ff00' } } },
      style: { text: { size: 9 } },
      legend: { show: true, position: 'top' },
      axes: {
        ...g2.axes,
        y: {
          ...(g2.axes.y as Extract<GraphNode['axes']['y'], { type: 'continuous' }>),
          range: { min: 0, max: 50 },
          frame: 'offset',
          title: { content: [{ text: 'Source Y' }], style: { bold: false } },
        },
      },
    }
    const target: GraphNode = {
      ...g1,
      axes: { ...g1.axes, y: { ...g1.axes.y, title: { content: [{ text: 'Mine' }] } } },
    }
    const out = matchGraphFormat(project, target, source)
    expect(out.look).toBe('column.bar')
    expect(out.layers.map((l) => l.id)).toEqual(['bars', 'error'])
    expect(out.size).toEqual(source.size)
    expect(out.style).toEqual(source.style)
    expect(out.legend).toEqual(source.legend)
    expect(out.seriesOverrides).toEqual(source.seriesOverrides)
    const y = out.axes.y as Extract<GraphNode['axes']['y'], { type: 'continuous' }>
    expect(y.frame).toBe('offset')
    expect(y.range).toBe('auto') // ranges only on request
    expect(y.title).toEqual({ content: [{ text: 'Mine' }], style: { bold: false } })
    expect(out.seriesSource).toBe(target.seriesSource)
    expect(out.annotations).toBe(target.annotations)

    const all = matchGraphFormat(project, target, source, {
      size: false,
      axisRanges: true,
      axisTitles: true,
      dataSets: false,
      layers: false,
    })
    const y2 = all.axes.y as Extract<GraphNode['axes']['y'], { type: 'continuous' }>
    expect(y2.range).toEqual({ min: 0, max: 50 })
    expect(y2.title?.content).toEqual([{ text: 'Source Y' }])
    expect(all.size).toBe(target.size)
    expect(all.look).toBe(target.look)
    expect(all.layers.map((l) => l.id)).toEqual(target.layers.map((l) => l.id))
    expect(all.seriesOverrides).toBe(target.seriesOverrides)
  })

  it('keeps the layers when the target table does not offer the source’s frame', () => {
    const { project, g1 } = setup()
    const xyTable = createTable({ tableKind: 'xy', columns: 1, rows: 2 })
    project.nodes[xyTable.id] = xyTable
    const xyGraph = createGraphFor(xyTable)
    const out = matchGraphFormat(project, xyGraph, g1)
    expect(out.look).toBe('xy.scatter')
    expect(out.frame).toBe('xy')
    expect(out.layers).toEqual(xyGraph.layers)
  })
})
