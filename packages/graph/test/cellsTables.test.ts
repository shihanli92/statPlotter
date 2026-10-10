import type { DataTable, GraphNode, Layer, NodeId, ResultLookup } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { syntheticTable } from '../../model/test/synthetic.ts'
import {
  aesAllowed,
  builderPresetsFor,
  cellsAllowed,
  cellsLabelsAllowed,
  checkLayers,
  DEFAULT_THEME,
  defaultPresetFor,
  EXTRA_CATEGORICAL,
  frameChoiceOf,
  graphPalette,
  layoutGraph,
  MAX_ROW_LABELS,
  mappedData,
  PREVIEW_ROWS,
  plotStyle,
  presetCellsAllowed,
  presetGraph,
  previewNote,
  previewSource,
  ROW_MARK_LAYERS,
  rowMarkLayer,
  rowMarkNotices,
  sampleTable as sampleOf,
  sampleRows,
  seriesColor,
  styleAllowed,
  styleContext,
} from '../src/index.ts'
import { fonts, projectOf, sampleTable, sampleVariables } from './helpers.ts'

// Roadmap 34f: cells tables (decisions 430, 431), builder previews of a sample (433), the
// 24-colour palette (432, 436) and graphs' natural order of levels (434).

/** The sample variables as a cells table (set, not by its rows). */
const cells = (): DataTable => ({ ...sampleVariables(), cellsTable: true })
const ROWS = { rows: 14 }

describe('the matrix’s layers of a mark per row', () => {
  it('lists swarms, before–after lines, paths, vectors, lines by group and per-value heat maps', () => {
    expect(ROW_MARK_LAYERS.map((r) => r.geom)).toEqual([
      'points',
      'connector',
      'path',
      'segment',
      'line',
      'tile',
      'label',
    ])
    expect(rowMarkLayer('mvTextNumber', 'category', 'points', 'identity')?.summary).toBe('violin')
    expect(rowMarkLayer('mvTextNumber', 'grouped', 'points', 'identity')).toBeDefined()
    // Means, boxes, violins, bars, counts, histograms and scatters of the rows scale.
    expect(rowMarkLayer('mvTextNumber', 'category', 'points', 'summary')).toBeUndefined()
    expect(rowMarkLayer('mvTextNumber', 'category', 'violin', 'density')).toBeUndefined()
    expect(rowMarkLayer('mvTextText', 'grouped', 'bar', 'summary')).toBeUndefined()
    expect(rowMarkLayer('multipleVariables', 'xy', 'points', 'identity')).toBeUndefined()
    expect(rowMarkLayer('multipleVariables', 'xy', 'bar', 'bin')).toBeUndefined()
    // Other tables' swarms are their data sets' replicates: never refused.
    expect(rowMarkLayer('column', 'category', 'points', 'identity')).toBeUndefined()
  })

  it('refuses them on cells tables with the rows and what to use instead', () => {
    expect(
      cellsAllowed('mvTextNumber', 'category', 'points', 'identity', { rows: 16_171 }),
    ).toEqual({
      allowed: false,
      reason: '16,171 rows: too many points for a swarm. Use a violin or box.',
    })
    expect(
      cellsAllowed('multipleVariables', 'category', 'connector', 'identity', { rows: 1 }).reason,
    ).toBe('1 row: too many lines for before–after lines. Join the means instead.')
    expect(cellsAllowed('mvTextNumber', 'category', 'points', 'identity', null).allowed).toBe(true)
    expect(cellsAllowed('mvTextNumber', 'category', 'box', 'boxplot', ROWS).allowed).toBe(true)
  })

  it('labels at most 1,000 rows of a cells table from a variable', () => {
    expect(MAX_ROW_LABELS).toBe(1000)
    expect(cellsLabelsAllowed({ rows: 1000 }).allowed).toBe(true)
    expect(cellsLabelsAllowed({ rows: 1001 }).reason).toBe(
      '1,001 rows: too many labels. Use group names.',
    )
    const points: Layer[] = [{ id: 'p', geom: 'points', stat: { kind: 'identity' }, aes: {} }]
    expect(aesAllowed('multipleVariables', 'xy', 'label', 'text', points, { rows: 5000 })).toEqual(
      cellsLabelsAllowed({ rows: 5000 }),
    )
    expect(aesAllowed('multipleVariables', 'xy', 'label', 'text', points, null).allowed).toBe(true)
    // Colour, shape and size by a variable scale.
    expect(aesAllowed('multipleVariables', 'xy', 'color', 'text', points, { rows: 5000 })).toEqual({
      allowed: true,
    })
  })
})

describe('what a cells table’s builder offers', () => {
  it('has no swarms or before–after lines among the plot styles, each saying why', () => {
    const t = cells()
    const c = styleContext(t, 'category', [], { x: 'a', y: 'c' })
    expect(c.cells).toEqual(ROWS)
    expect(styleAllowed(plotStyle('points')!, c)).toEqual({
      allowed: false,
      reason: '14 rows: too many points for a swarm. Use a violin or box.',
    })
    expect(styleAllowed(plotStyle('pairs')!, styleContext(t, 'category', [])).reason).toMatch(
      /before–after lines/,
    )
    for (const id of ['violin', 'box', 'bars', 'means', 'center', 'error', 'joinMeans'])
      expect(styleAllowed(plotStyle(id)!, c).allowed, id).toBe(true)
    // The same table, not a cells table: every style as before.
    const plain = styleContext(sampleVariables(), 'category', [], { x: 'a', y: 'c' })
    expect(plain.cells).toBeUndefined()
    expect(styleAllowed(plotStyle('points')!, plain).allowed).toBe(true)
  })

  it('turns to columns as boxes, keeps scatters and histograms', () => {
    const t = cells()
    const columns = plotStyle('columns')!
    const xy = styleContext(t, 'xy', presetGraph(t, 'bubble').layers)
    expect(frameChoiceOf(columns, xy)).toBe('box')
    expect(frameChoiceOf(columns, styleContext(sampleVariables(), 'xy', []))).toBe('points')
    expect(styleAllowed(columns, xy).allowed).toBe(true)
    expect(styleAllowed(plotStyle('histogram')!, xy).allowed).toBe(true)
    expect(styleAllowed(plotStyle('bubbles')!, styleContext(t, 'category', [])).allowed).toBe(true)
  })

  it('shows violins by group as a chip of cells tables, and disables the swarm’s', () => {
    expect(builderPresetsFor('multipleVariables', cells()).map((p) => p.id)).toContain(
      'groupViolin',
    )
    expect(
      builderPresetsFor('multipleVariables', sampleVariables()).map((p) => p.id),
    ).not.toContain('groupViolin')
    expect(presetCellsAllowed('groupBoxPoints', cells()).reason).toBe(
      '14 rows: too many points for a swarm. Use a violin or box.',
    )
    expect(presetCellsAllowed('groupBoxPoints', sampleVariables()).allowed).toBe(true)
    for (const id of ['groupViolin', 'bubble', 'scatterEllipses', 'histogramBins', 'box'])
      expect(presetCellsAllowed(id, cells()).allowed, id).toBe(true)
    expect(presetCellsAllowed('trajectories', cells()).allowed).toBe(false)
    const violin = presetGraph(cells(), 'groupViolin')
    expect(violin.layers.map((l) => l.geom)).toEqual(['violin', 'box'])
    expect(checkLayers(violin, 'mvTextNumber').get('violin')?.allowed).toBe(true)
  })

  it('starts new graphs of a cells table as an XY graph of its variables', () => {
    expect(defaultPresetFor(cells())).toBe('bubble')
    expect(defaultPresetFor(sampleVariables())).toBe('points')
    expect(defaultPresetFor({ ...sampleVariables(), rowCount: 30_000 })).toBe('bubble')
  })
})

describe('Format notices for graphs of a cells table drawing a mark per row', () => {
  const ids = (layers: readonly Layer[]) => layers.map((l) => l.id)

  it('takes the points off a box or violin', () => {
    const t = cells()
    const g = presetGraph(t, 'groupBoxPoints', undefined, { mapping: { x: 'a', y: 'c' } })
    const [n, ...more] = rowMarkNotices(g, t)
    expect(more).toEqual([])
    expect(n!.layer.id).toBe('points')
    expect(n!.reason).toBe('14 rows: too many points for a swarm. Use a violin or box.')
    expect(n!.fix.label).toBe('Remove the points')
    expect(ids(n!.fix.layers)).toEqual(['box'])
    // Not a cells table: nothing to say.
    expect(rowMarkNotices(g, sampleVariables())).toEqual([])
  })

  it('puts a violin in place of a swarm alone, joined means for before–after lines', () => {
    const t = cells()
    const swarm = presetGraph(t, 'points')
    const [n] = rowMarkNotices(swarm, t)
    expect(n!.fix.label).toBe('Use a violin instead')
    // The violin behind the mean and error bars that stay.
    expect(n!.fix.layers.map((l) => l.geom)).toEqual(['violin', 'errorbar', 'center'])
    const pairs = presetGraph(t, 'beforeAfter')
    const fixes = rowMarkNotices(pairs, t).map((x) => x.fix.label)
    expect(fixes).toContain('Join the means instead')
    const joined = rowMarkNotices(pairs, t).find((x) => x.layer.geom === 'connector')!
    expect(joined.fix.layers.some((l) => l.geom === 'line' && l.stat.kind === 'summary')).toBe(true)
    expect(joined.fix.layers.some((l) => l.geom === 'connector')).toBe(false)
  })

  it('offers to hide a layer with no summary, and leaves hidden layers alone', () => {
    const t = cells()
    const g = presetGraph(t, 'trajectories')
    const path = rowMarkNotices(g, t).find((n) => n.layer.geom === 'path')!
    expect(path.fix.label).toBe('Hide it')
    expect(path.fix.layers.find((l) => l.id === path.layer.id)?.visible).toBe(false)
    const hidden: GraphNode = { ...g, layers: path.fix.layers }
    expect(rowMarkNotices(hidden, t).some((n) => n.layer.geom === 'path')).toBe(false)
  })
})

describe('builder previews of big tables (a sample of the rows)', () => {
  it('spreads the rows evenly in table order, the first row first', () => {
    expect(sampleRows(10, 3)).toEqual([0, 3, 6])
    expect(sampleRows(2, 5)).toEqual([0, 1])
    const rows = sampleRows(1_000_000, PREVIEW_ROWS)
    expect(rows).toHaveLength(5000)
    expect(rows[0]).toBe(0)
    expect(rows.every((r, i) => i === 0 || r > rows[i - 1]!)).toBe(true)
  })

  it('cuts every per-row array to the sample, once per table object', () => {
    const t = syntheticTable({ rows: 900, genes: 2, pcs: 2 })
    expect(sampleOf(t)).toBe(t)
    const s = sampleOf(t, 100)
    expect(sampleOf(t, 100)).toBe(s)
    expect(s.rowCount).toBe(100)
    const rows = sampleRows(900, 100)
    for (const [i, d] of t.dataSets.entries()) {
      const out = s.dataSets[i]!
      expect(out.subcolumns[0]!.values).toEqual(rows.map((r) => d.subcolumns[0]!.values[r]))
      if (d.text) expect(out.text).toEqual(rows.map((r) => d.text![r]))
    }
  })

  it('lays a preview out of the sample, with a note; small tables whole', () => {
    const t = syntheticTable({ rows: 900, genes: 2, pcs: 2, cellIds: false })
    const project = projectOf(t)
    const src = previewSource(project, t.id, undefined, 300)
    expect(src.shown).toBe(300)
    expect(src.of).toBe(900)
    expect(previewNote(src)).toBe('Preview of 300 of 900 rows')
    expect((src.project.nodes[t.id] as DataTable).rowCount).toBe(300)
    expect(project.nodes[t.id]).toBe(t)
    const g = presetGraph(src.project.nodes[t.id] as DataTable, 'bubble')
    const scene = layoutGraph({
      project: projectOf(src.project.nodes[t.id] as DataTable, g),
      graph: g,
      fonts,
    })
    expect(scene.width).toBeGreaterThan(0)
    const whole = previewSource(project, t.id, undefined)
    expect(whole.project).toBe(project)
    expect(previewNote(whole)).toBeNull()
  })

  it('samples an analysis’ result table too', () => {
    const t = syntheticTable({ rows: 900, genes: 2, pcs: 2 })
    const node = { kind: 'analysis', id: 'a1' as NodeId } as never
    const project = { ...projectOf(t), nodes: { ...projectOf(t).nodes, a1: node } }
    const result = { table: t } as never
    const lookup: ResultLookup = (id) => (id === 'a1' ? result : undefined)
    const src = previewSource(project, 'a1', lookup, 200)
    expect(src).toMatchObject({ shown: 200, of: 900 })
    expect(src.result?.('a1' as NodeId)?.table?.rowCount).toBe(200)
  })
})

describe('the 24-colour palette', () => {
  const palette = graphPalette({ style: {} } as GraphNode, DEFAULT_THEME)
  it('is the 8 Okabe–Ito colours, then 16 more, all different', () => {
    expect(palette).toHaveLength(24)
    expect(palette.slice(0, 8)).toEqual(DEFAULT_THEME.palette)
    expect(palette.slice(8)).toEqual(EXTRA_CATEGORICAL)
    expect(new Set(palette.map((c) => c.toLowerCase())).size).toBe(24)
  })

  it('colours up to 8 levels as before, more without repeating until 24', () => {
    const old = (i: number) => DEFAULT_THEME.palette[i % 8]!
    const colour = (i: number) => seriesColor({ series: true }, palette, i)
    for (let i = 0; i < 8; i++) expect(colour(i)).toBe(old(i))
    const fourteen = Array.from({ length: 14 }, (_, i) => colour(i))
    expect(new Set(fourteen).size).toBe(14)
    expect(colour(8)).toBe(EXTRA_CATEGORICAL[0])
    expect(colour(8)).not.toBe(old(8))
    // Past 24 it wraps.
    expect(colour(24)).toBe(colour(0))
  })

  it('leaves a graph’s own palette as it is (wrapping)', () => {
    const own = ['#111111', '#222222']
    const g = { style: { palette: own } } as unknown as GraphNode
    expect(graphPalette(g, DEFAULT_THEME)).toEqual(own)
  })

  it('draws a 14-cluster UMAP in 14 colours', () => {
    const t = syntheticTable({ rows: 400, genes: 2, pcs: 2, cellIds: false })
    const key = (title: string) => t.dataSets.find((d) => d.title === title)!.id
    const g0 = presetGraph(t, 'bubble')
    const g: GraphNode = {
      ...g0,
      layers: g0.layers.map((l) =>
        l.aes
          ? ({ ...l, aes: { x: key('UMAP_1'), y: key('UMAP_2'), color: key('cluster') } } as Layer)
          : l,
      ),
      legend: { ...g0.legend, show: true },
    }
    const svg = JSON.stringify(layoutGraph({ project: projectOf(t, g), graph: g, fonts }).root)
    for (const c of palette.slice(0, 14)) expect(svg, c).toContain(c)
    for (const c of palette.slice(14)) expect(svg, c).not.toContain(c)
  })
})

describe('the order of levels a graph keeps no order of', () => {
  const t = sampleVariables()
  // Group's levels first appear as Low, High, Mid.
  const mapping = { x: 'a', y: 'c' }
  it('is the table’s for graphs made before roadmap 34f (no `levelOrder`)', () => {
    expect(mappedData(t, { mapping }, null)?.cats).toEqual(['Low', 'High', 'Mid'])
    expect(mappedData(t, { mapping, levelOrder: 'appearance' }, null)?.cats).toEqual([
      'Low',
      'High',
      'Mid',
    ])
  })
  it('is natural for new graphs, a stored order still first', () => {
    expect(mappedData(t, { mapping, levelOrder: 'natural' }, null)?.cats).toEqual([
      'High',
      'Low',
      'Mid',
    ])
    expect(
      mappedData(t, { mapping, levelOrder: 'natural', levels: { a: ['Mid'] } }, null)?.cats,
    ).toEqual(['Mid', 'High', 'Low'])
  })
  it('keeps a graph drawn the same when nothing says otherwise', () => {
    const g = presetGraph(sampleTable('column'), 'points')
    expect(g.levelOrder).toBeUndefined()
  })
})
