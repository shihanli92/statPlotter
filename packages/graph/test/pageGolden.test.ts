import {
  type AssetId,
  builtinStyle,
  type LayoutItem,
  type LayoutItemId,
  type LayoutItemOf,
  type LayoutNode,
  type LineEnds,
  type NodeId,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  alignedGrid,
  fitPageToWidth,
  layoutGraph,
  layoutPage,
  type PageContext,
  type PageTableCell,
  presetGraph,
  sceneToSvg,
  splitGraphs,
} from '../src/index.ts'
import { fonts, projectOf, sampleTable, sampleVariables } from './helpers.ts'
import { fixtureAsset } from './images.ts'

// Golden SVGs of layout-page items (roadmap 32), beside the graphs' in `__snapshots__/golden/`.

const golden = (name: string) => `./__snapshots__/golden/page-${name}.svg`
const id = (s: string) => s as LayoutItemId
const black = { color: { rgb: '#000000' }, width: 1, dash: 'solid' } as const

function render(items: LayoutItem[], extra: Partial<PageContext> = {}): string {
  const layout: LayoutNode = {
    kind: 'layout',
    id: 'p1' as NodeId,
    name: 'Page',
    page: { width: 300, height: 200 },
    items,
    panelLabels: { show: true, style: 'A', size: 14 },
  }
  const svg = sceneToSvg(layoutPage({ project: projectOf(layout), layout, fonts, ...extra }), {
    ids: true,
  })
  expect(svg).not.toContain('NaN')
  return svg
}

describe('golden page items', () => {
  it('text boxes', async () => {
    await expect(
      render([
        {
          type: 'text',
          id: id('a'),
          x: 20,
          y: 20,
          width: 110,
          content: {
            content: [
              { text: 'Cells were imaged at ' },
              { text: '40×', bold: true },
              { text: ' and counted blind.' },
            ],
            align: 'center',
          },
          border: black,
          background: { type: 'solid', color: { rgb: '#fff6cc' }, opacity: 1 },
        },
        {
          type: 'text',
          id: id('b'),
          x: 170,
          y: 20,
          content: { content: [{ text: 'Plain text' }] },
        },
      ]),
    ).toMatchFileSnapshot(golden('text'))
  })

  it('lines and arrowheads', async () => {
    const line = (n: string, y: number, heads: LineEnds, width = 1): LayoutItemOf<'line'> => ({
      type: 'line',
      id: id(n),
      from: { x: 30, y },
      to: { x: 260, y: y + 10 },
      stroke: { ...black, width },
      heads,
    })
    await expect(
      render([
        line('a', 20, {}),
        line('b', 50, { end: { shape: 'triangle' } }),
        line('c', 80, { start: { shape: 'triangle' }, end: { shape: 'open', size: 1.5 } }, 1.5),
        line('d', 110, { start: { shape: 'bar' }, end: { shape: 'bar' } }),
        line('e', 140, { start: { shape: 'circle' }, end: { shape: 'triangle', size: 2 } }, 0.5),
        { ...line('f', 170, { end: { shape: 'triangle' } }), stroke: { ...black, dash: 'dash' } },
      ]),
    ).toMatchFileSnapshot(golden('lines'))
  })

  it('rectangles and ellipses', async () => {
    await expect(
      render([
        { type: 'shape', id: id('a'), shape: 'rect', x: 20, y: 20, w: 100, h: 60, stroke: black },
        {
          type: 'shape',
          id: id('b'),
          shape: 'rect',
          x: 140,
          y: 20,
          w: 120,
          h: 60,
          radius: 12,
          fill: { type: 'solid', color: { palette: 0 }, opacity: 0.3 },
        },
        {
          type: 'shape',
          id: id('c'),
          shape: 'ellipse',
          x: 20,
          y: 100,
          w: 120,
          h: 70,
          stroke: { color: { palette: 1 }, width: 2, dash: 'dot' },
          fill: { type: 'solid', color: { rgb: '#eeeeee' }, opacity: 1 },
        },
        {
          type: 'shape',
          id: id('d'),
          shape: 'ellipse',
          x: 180,
          y: 100,
          w: 60,
          h: 60,
          stroke: black,
        },
      ]),
    ).toMatchFileSnapshot(golden('shapes'))
  })

  it('images, cropped and missing', async () => {
    const asset = fixtureAsset('rgba.png')
    await expect(
      render(
        [
          {
            type: 'image',
            id: id('a'),
            asset: asset.id,
            x: 20,
            y: 20,
            w: 120,
            h: 70,
            border: black,
          },
          {
            type: 'image',
            id: id('b'),
            asset: asset.id,
            x: 160,
            y: 20,
            w: 60,
            h: 70,
            crop: { x: 0.5, y: 0, w: 0.5, h: 1 },
          },
          {
            type: 'image',
            id: id('c'),
            asset: 'f'.repeat(32) as AssetId,
            x: 20,
            y: 110,
            w: 120,
            h: 70,
          },
        ],
        { asset: (a) => (a === asset.id ? asset : undefined) },
      ),
    ).toMatchFileSnapshot(golden('images'))
  })

  it('a live table', async () => {
    const c = (text: string, extra: Partial<PageTableCell> = {}) => ({ text, ...extra })
    const rows = [
      [
        c(''),
        c('Control', { style: 'header' as const }),
        c('Treated', { style: 'header' as const }),
      ],
      [c('Mean'), c('43.48', { numeric: true }), c('56.28', { numeric: true })],
      [c('SD'), c('3.831', { numeric: true }), c('9.150', { numeric: true })],
      [c('N'), c('10', { numeric: true }), c('10', { numeric: true })],
    ]
    await expect(
      render(
        [
          {
            type: 'table',
            id: id('a'),
            x: 20,
            y: 20,
            source: { kind: 'table', node: 't' as NodeId },
          },
          {
            type: 'table',
            id: id('b'),
            x: 170,
            y: 20,
            source: { kind: 'table', node: 't' as NodeId },
            grid: 'rows',
            text: { font: 'serif', size: 8 },
            rows: { from: 0, to: 1 },
          },
        ],
        { table: () => ({ rows }) },
      ),
    ).toMatchFileSnapshot(golden('table'))
  })

  it('a set of graphs split by a text variable, on its grid (roadmap 34d)', async () => {
    const t = sampleVariables()
    const base = presetGraph(t, 'groupBoxPoints', undefined, { mapping: { x: 'a', y: 'c' } })
    const set = splitGraphs(t, base, { by: 'level', variable: 'a' }).map((g, i) => ({
      ...g,
      id: `g${i + 1}` as NodeId,
      split: { ...g.split!, set: 's1' },
      links: { y: 'ly' },
    }))
    const page = { width: 420, height: 300 }
    const all = projectOf(t, ...set)
    const scenes = set.map((graph) => ({ scene: layoutGraph({ project: all, graph, fonts }) }))
    const grid = alignedGrid(scenes, page, { columns: 2, equalPlotSize: true, margin: 18 })
    const layout: LayoutNode = {
      kind: 'layout',
      id: 'p1' as NodeId,
      name: 'Page',
      page,
      items: set.map((g, i) => ({
        type: 'graph' as const,
        id: id(`i${i}`),
        graph: g.id,
        ...grid.placements[i]!,
      })),
      panelLabels: { show: true, style: 'A', size: 14 },
      grids: [{ set: 's1', columns: 2, x: grid.x, y: grid.y, dx: grid.dx, dy: grid.dy }],
    }
    const svg = sceneToSvg(layoutPage({ project: projectOf(t, ...set, layout), layout, fonts }), {
      ids: true,
    })
    expect(svg).not.toContain('NaN')
    await expect(svg).toMatchFileSnapshot(golden('split-set'))
  })

  it('a page fitted to a journal style’s double column (roadmap 37)', async () => {
    const nature = builtinStyle('journal-nature')!
    const column = sampleTable('column')
    const xy = sampleTable('xy')
    const g1 = { ...presetGraph(column, 'barsPoints'), id: 'g1' as NodeId }
    const g2 = { ...presetGraph(xy, 'meanSd'), id: 'g2' as NodeId }
    const layout: LayoutNode = {
      kind: 'layout',
      id: 'p1' as NodeId,
      name: 'Figure',
      page: { width: 612, height: 300 },
      items: [
        { type: 'graph', id: id('a'), graph: g1.id, x: 20, y: 30, scale: 0.8 },
        { type: 'graph', id: id('b'), graph: g2.id, x: 320, y: 30, scale: 0.8 },
        {
          type: 'text',
          id: id('t'),
          x: 20,
          y: 260,
          width: 560,
          content: { content: [{ text: 'Mean ± SD; each point one replicate.' }] },
        },
      ],
      panelLabels: { show: true, style: 'a', size: 8 },
    }
    const base = projectOf(column, xy, g1, g2, layout)
    const project = {
      ...base,
      settings: { ...base.settings, theme: nature.id, style: nature.style },
    }
    const fit = fitPageToWidth({ project, fonts }, layout, nature.style.columns!.double!, 'aspect')
    const fitted = { ...layout, page: fit.page, items: fit.items }
    const graphs = [g1, g2].map((g) => ({ ...g, size: fit.sizes.get(g.id)! }))
    const after = {
      ...project,
      nodes: { ...project.nodes, ...Object.fromEntries([...graphs, fitted].map((n) => [n.id, n])) },
    }
    const scene = layoutPage({ project: after, layout: fitted, fonts })
    expect(scene.width).toBeCloseTo(nature.style.columns!.double!, 5)
    for (const it of fit.items) if (it.type === 'graph') expect(it.scale).toBe(1)
    const svg = sceneToSvg(scene, { ids: true })
    expect(svg).not.toContain('NaN')
    await expect(svg).toMatchFileSnapshot(golden('fit-to-column'))
  })
})
