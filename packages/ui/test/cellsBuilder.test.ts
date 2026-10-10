import {
  builderPresetsFor,
  histogramLayer,
  layoutGraph,
  newGraphNode,
  OVERLAID_BINS,
  presetCellsAllowed,
  presetGraph,
  previewSource,
  variableHistogram,
  withLayers,
} from '@ps/graph'
import type { DataTable, GraphNode, NodeId } from '@ps/model'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fonts, growthRatio, projectOf, sampleVariables } from '../../graph/test/helpers.ts'
import { syntheticTable } from '../../model/test/synthetic.ts'
import {
  appearanceAllowed,
  type BuilderAction,
  type BuilderState,
  builderChange,
  builderOf,
  builderReducer,
  initialBuilder,
  styleChoices,
  withBuilderLevels,
} from '../src/graph/builder/builderState.ts'
import { LatestOnly, PREVIEW_DELAY } from '../src/graph/builder/latest.ts'
import {
  CELLS_TABLE_LABEL,
  cellsTableByDefault,
  cellsTableCommand,
  cellsTableSetting,
} from '../src/table/cellsTable.ts'

// Roadmap 34f: the graph builder on cells tables (only what scales, disabled ones saying why),
// histograms of variables in the builder, the stored order of levels, the preview's latest-only
// scheduling and its cost by the table's rows.

const run = (table: DataTable, actions: BuilderAction[], from = initialBuilder(table)) =>
  actions.reduce((s, a) => builderReducer(table, s, a), from)
const cells = (): DataTable => ({ ...sampleVariables(), cellsTable: true })
const choice = (s: BuilderState, table: DataTable, id: string) =>
  styleChoices(table, s).find((c) => c.style.id === id)

describe('the builder on a cells table', () => {
  it('starts as an XY graph of the variables, in natural order', () => {
    const s = initialBuilder(cells())
    expect(s.preset).toBe('bubble')
    expect(s.levelOrder).toBe('natural')
    expect(initialBuilder(sampleVariables()).levelOrder).toBe('natural')
  })

  it('offers no swarm, saying why, and refuses its chip', () => {
    const t = cells()
    const violin = run(t, [{ type: 'preset', id: 'groupViolin' }])
    expect(violin.mapping).toEqual({ x: 'a', y: 'c' })
    expect(violin.layers.map((l) => l.geom)).toEqual(['violin', 'box'])
    expect(choice(violin, t, 'points')?.allowed).toEqual({
      allowed: false,
      reason: '14 rows: too many points for a swarm. Use a violin or box.',
    })
    expect(choice(violin, t, 'means')?.allowed.allowed).toBe(true)
    // Toggling a refused style, or picking a refused chip, changes nothing.
    expect(run(t, [{ type: 'toggle', style: 'points' }], violin)).toBe(violin)
    expect(run(t, [{ type: 'preset', id: 'groupBoxPoints' }], violin)).toBe(violin)
    expect(presetCellsAllowed('groupBoxPoints', t).allowed).toBe(false)
    expect(builderPresetsFor('multipleVariables', t).map((p) => p.id)).toContain('groupViolin')
  })

  it('maps a text variable to violins, not boxes with every point, and columns to boxes', () => {
    const t = cells()
    const s = run(t, [{ type: 'map', field: 'x', key: 'a' }])
    expect(s.preset).toBe('groupViolin')
    expect(s.layers.some((l) => l.geom === 'points')).toBe(false)
    const columns = run(t, [{ type: 'map', field: 'x', key: undefined }], s)
    expect(columns.preset).toBe('box')
    expect(columns.layers.map((l) => l.geom)).toEqual(['box'])
    const toColumns = run(t, [{ type: 'toggle', style: 'columns' }])
    expect(toColumns.preset).toBe('box')
    expect(choice(toColumns, t, 'pairs')?.allowed.reason).toBe(
      '14 rows: too many lines for before–after lines. Join the means instead.',
    )
    // The same table, not a cells table: every point kept, columns of points.
    const plain = run(sampleVariables(), [{ type: 'map', field: 'x', key: 'a' }])
    expect(plain.layers.some((l) => l.geom === 'points' && l.stat.kind === 'identity')).toBe(true)
    expect(run(sampleVariables(), [{ type: 'toggle', style: 'columns' }]).preset).toBe('points')
  })

  it('takes a swarm already on a graph off, though it couldn’t be added', () => {
    const t = cells()
    const g = presetGraph(t, 'groupBoxPoints', undefined, { mapping: { x: 'a', y: 'c' } })
    const s = builderOf(g, t)
    const points = choice(s, t, 'points')!
    expect(points.selected).toBe(true)
    expect(points.allowed.allowed).toBe(false)
    const off = run(t, [{ type: 'toggle', style: 'points' }], s)
    expect(off.layers.map((l) => l.geom)).toEqual(['box'])
  })

  it('maps no labels to more than 1,000 rows', () => {
    const t = {
      ...syntheticTable({ rows: 1200, genes: 1, pcs: 1, cellIds: false }),
      cellsTable: true,
    }
    const s = initialBuilder(t)
    const label = appearanceAllowed(t, s, 'label', t.dataSets[0]!.id)
    expect(label).toEqual({
      allowed: false,
      reason: '1,200 rows: too many labels. Use group names.',
    })
  })
})

describe('the order of levels the builder keeps', () => {
  const t = sampleVariables()
  const made = (s: BuilderState, graph?: GraphNode) =>
    withBuilderLevels(
      graph ? withLayers(graph, builderChange(s), t) : newGraphNode(t, builderChange(s)),
      s,
      graph,
    )
  it('is natural for a new graph', () => {
    expect(made(initialBuilder(t)).levelOrder).toBe('natural')
  })
  it('stays as it was for a graph made before (first appearance) when changed', () => {
    const old = presetGraph(t, 'groupBoxPoints', undefined, { mapping: { x: 'a', y: 'c' } })
    expect(old.levelOrder).toBeUndefined()
    const s = builderOf(old, t)
    expect(s.levelOrder).toBeUndefined()
    expect('levelOrder' in made(s, old)).toBe(false)
    const natural = { ...old, levelOrder: 'natural' as const }
    expect(made(builderOf(natural, t), natural).levelOrder).toBe('natural')
  })
})

describe('histograms of a variable in the builder', () => {
  const t = sampleVariables()
  const scatter = (): BuilderState =>
    run(t, [
      { type: 'preset', id: 'bubble' },
      { type: 'map', field: 'x', key: 'd' },
      { type: 'map', field: 'color', key: 'a' },
    ])

  it('switches from a scatter, binning its X by its colour groups', () => {
    const from = scatter()
    expect(choice(from, t, 'bubbles')?.selected).toBe(true)
    expect(choice(from, t, 'histogram')?.selected).toBe(false)
    const s = run(t, [{ type: 'toggle', style: 'histogram' }], from)
    expect(s.preset).toBe('histogramBins')
    expect(s.layers).toEqual([variableHistogram('d', 'a')])
    expect(choice(s, t, 'histogram')?.selected).toBe(true)
    expect(choice(s, t, 'bubbles')?.selected).toBe(false)
    // Chosen again: nothing; back to bubbles.
    expect(run(t, [{ type: 'toggle', style: 'histogram' }], s)).toBe(s)
    const back = run(t, [{ type: 'toggle', style: 'bubbles' }], s)
    expect(back.layers.some((l) => l.geom === 'points' && l.aes)).toBe(true)
  })

  it('changes the variable, the groups and how they stack from Map variables', () => {
    let s = run(t, [{ type: 'toggle', style: 'histogram' }], scatter())
    s = run(t, [{ type: 'map', field: 'x', key: 'c' }], s)
    expect(histogramLayer(s)?.aes).toEqual({ x: 'c', color: 'a' })
    s = run(t, [{ type: 'map', field: 'color', key: 'b' }], s)
    expect(histogramLayer(s)?.aes).toEqual({ x: 'c', color: 'b' })
    expect(histogramLayer(s)?.style).toEqual({ fill: OVERLAID_BINS })
    s = run(t, [{ type: 'bins', stacked: true }], s)
    expect(histogramLayer(s)?.position).toEqual({ kind: 'stack' })
    expect(histogramLayer(s)?.style).toBeUndefined()
    s = run(t, [{ type: 'bins', stacked: false }], s)
    expect(histogramLayer(s)?.position).toBeUndefined()
    s = run(t, [{ type: 'appearance', field: 'color', key: undefined }], s)
    expect(histogramLayer(s)?.aes).toEqual({ x: 'c' })
    expect(histogramLayer(s)?.style).toBeUndefined()
    // Groups are a text variable's; nothing else is mapped.
    expect(appearanceAllowed(t, s, 'color', 'd').allowed).toBe(false)
    expect(appearanceAllowed(t, s, 'color', 'a').allowed).toBe(true)
    expect(appearanceAllowed(t, s, 'size', 'd').reason).toBe('a histogram draws bins, not rows')
    // A Y variable makes a scatter again.
    const xy = run(t, [{ type: 'map', field: 'y', key: 'd' }], s)
    expect(histogramLayer(xy)).toBeUndefined()
    expect(xy.layers.find((l) => l.geom === 'points')?.aes).toMatchObject({ x: 'c', y: 'd' })
  })

  it('is offered on cells tables too', () => {
    const c = cells()
    const s = initialBuilder(c)
    expect(choice(s, c, 'histogram')?.allowed.allowed).toBe(true)
    const h = run(c, [{ type: 'toggle', style: 'histogram' }], s)
    expect(histogramLayer(h)).toBeDefined()
  })
})

describe('the preview of a big table', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('lays out only the last of quick changes, a moment after it', () => {
    vi.useFakeTimers()
    const latest = new LatestOnly()
    const ran: string[] = []
    latest.request(() => ran.push('bubbles'))
    vi.advanceTimersByTime(PREVIEW_DELAY - 1)
    latest.request(() => ran.push('histogram'))
    vi.advanceTimersByTime(PREVIEW_DELAY - 1)
    latest.request(() => ran.push('violins'))
    expect(latest.waiting).toBe(true)
    vi.advanceTimersByTime(PREVIEW_DELAY - 1)
    expect(ran).toEqual([])
    vi.advanceTimersByTime(1)
    expect(ran).toEqual(['violins'])
    expect(latest.waiting).toBe(false)
    // Cancelled (the dialog closed): never runs.
    latest.request(() => ran.push('late'))
    latest.cancel()
    vi.advanceTimersByTime(PREVIEW_DELAY * 10)
    expect(ran).toEqual(['violins'])
  })

  it('costs the same for 100,000 rows as for 25,000 when switching styles', () => {
    // Audit 2 (P10): both sizes are cells tables (the setting is on by itself only above 20,000
    // rows, so 20,000 against 200,000 compared a table drawn whole with a sampled one) and both
    // are more rows than the preview's sample, so they take the same path and only the rows
    // differ.
    const tables = new Map<number, DataTable>()
    const tableOf = (n: number) => {
      let t = tables.get(n)
      if (!t) {
        t = {
          ...syntheticTable({ rows: n, genes: 2, pcs: 2, cellIds: false }),
          id: 't1' as NodeId,
          cellsTable: true,
        }
        tables.set(n, t)
      }
      return t
    }
    const clicks: BuilderAction[] = [
      { type: 'toggle', style: 'histogram' },
      { type: 'toggle', style: 'bubbles' },
      { type: 'toggle', style: 'columns' },
      { type: 'preset', id: 'groupViolin' },
      { type: 'toggle', style: 'means' },
    ]
    const switching = (n: number) => {
      const t = tableOf(n)
      const project = projectOf(t)
      let s = initialBuilder(t)
      for (const a of clicks) {
        s = builderReducer(t, s, a)
        // The preview: the graph made of the sample, laid out.
        const src = previewSource(project, t.id, undefined)
        const sample = src.project.nodes[t.id] as DataTable
        const g = { ...newGraphNode(sample, builderChange(s)), id: 'p' as NodeId }
        layoutGraph({
          project: { ...src.project, nodes: { ...src.project.nodes, [g.id]: g } },
          graph: g,
          fonts,
        })
      }
    }
    tableOf(25_000)
    tableOf(100_000)
    // Linear work would be about 4 times as costly (a preview of the whole table measured 3.3); a
    // preview of a sample is not (about 1).
    expect(growthRatio(switching, 25_000, 4, 3)).toBeLessThan(2)
  })
})

describe('the cells-table setting', () => {
  it('is on by itself above 20,000 rows, and stays automatic when it agrees', () => {
    expect(cellsTableByDefault(20_000)).toBe(false)
    expect(cellsTableByDefault(20_001)).toBe(true)
    expect(cellsTableSetting(50_000, true)).toBeUndefined()
    expect(cellsTableSetting(50_000, false)).toBe(false)
    expect(cellsTableSetting(100, true)).toBe(true)
    expect(cellsTableSetting(100, false)).toBeUndefined()
    const t = sampleVariables()
    expect(cellsTableCommand(t, true)).toEqual({
      type: 'table.setCellsTable',
      table: t.id,
      on: true,
    })
    expect(cellsTableCommand(t, false)).toEqual({
      type: 'table.setCellsTable',
      table: t.id,
      on: null,
    })
    expect(CELLS_TABLE_LABEL).toBe('Cells table (single-cell / cytometry)')
  })
})
