import {
  type ColumnId,
  type DataTable,
  type GraphNode,
  type Layer,
  levelKey,
  memberSlice,
  parsePointKey,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  filterRows,
  graphRows,
  layoutGraph,
  presetGraph,
  resolveSeries,
  type Scene,
  type SceneNode,
  splitGraphs,
} from '../src/index.ts'
import { appearanceTable, fonts, projectOf, sampleTable, sampleVariables } from './helpers.ts'

// Roadmap 34d: one graph per level of a text variable (a filter on the graph's rows, live with
// the table), per data set or per row — sets of ordinary graphs (decision 41).

const F = levelKey('F')
const M = levelKey('M')
const lay = (table: DataTable, graph: GraphNode, ...more: GraphNode[]): Scene =>
  layoutGraph({ project: projectOf(table, graph, ...more), graph, fonts })
const filtered = (g: GraphNode, level: string, variable = 'b'): GraphNode => ({
  ...g,
  seriesSource: { ...g.seriesSource, filter: { variable, level } },
})
const flat = (n: SceneNode, out: SceneNode[] = []) => {
  out.push(n)
  for (const c of n.children ?? []) flat(c, out)
  return out
}
/** The table rows of a scene's single points (marks keyed by a row). */
const pointRows = (s: Scene) =>
  new Set(
    flat(s.root).flatMap((n) => {
      const p = n.point === undefined ? null : parsePointKey(n.point)
      return p ? [p.row] : []
    }),
  )
/** Without its ids' graph-specific parts: a scene's structure and geometry. */
const plain = (s: Scene) => JSON.stringify(s.root)

describe('the filter', () => {
  const t = sampleVariables()

  it('keeps the rows of one level of a text variable, in table order', () => {
    expect(filterRows(t, { variable: 'b', level: F })).toEqual([0, 2, 4, 6, 8, 10, 12, 13])
    expect(filterRows(t, { variable: 'b', level: M })).toEqual([1, 3, 5, 7, 9, 11])
    // Levels are trimmed text; a level nobody has, a number or missing variable: no rows.
    expect(filterRows(t, { variable: 'a', level: levelKey('Mid') })).toEqual([2, 5, 8, 11])
    expect(filterRows(t, { variable: 'b', level: levelKey('X') })).toEqual([])
    expect(filterRows(t, { variable: 'c', level: F })).toEqual([])
    expect(filterRows(t, { variable: 'zz', level: F })).toEqual([])
  })

  it('leaves out excluded and empty cells, and follows edits (a new table object)', () => {
    const edited = structuredClone(t)
    const sex = edited.dataSets[1]!
    sex.text![0] = ' M '
    sex.text![1] = null
    sex.subcolumns[0]!.excluded = Array.from({ length: 14 }, (_, r) => r === 2)
    expect(filterRows(edited, { variable: 'b', level: F })).toEqual([4, 6, 8, 10, 12, 13])
    expect(filterRows(edited, { variable: 'b', level: M })).toEqual([0, 3, 5, 7, 9, 11])
    // The original is unchanged (cached per column object).
    expect(filterRows(t, { variable: 'b', level: F })[0]).toBe(0)
  })

  it('narrows a row slice to the level’s rows, in the slice’s order', () => {
    const g = filtered(presetGraph(t, 'points'), F)
    expect(graphRows(g, t)).toEqual([0, 2, 4, 6, 8, 10, 12, 13])
    const sliced = { ...g, seriesSource: { ...g.seriesSource, rows: [6, 1, 0, 3] } }
    expect(graphRows(sliced, t)).toEqual([6, 0])
    expect(graphRows(presetGraph(t, 'points'), t)).toBeNull()
  })

  it('a split graph draws only its level’s rows, as the same rows sliced would, on every frame', () => {
    const at = appearanceTable()
    const mapped = (id: string, mapping: GraphNode['mapping']) =>
      presetGraph(at, id, undefined, { mapping })
    // XY points coloured by Group with ellipses, hulls and paths; vectors to two variables.
    const xy = (back: Layer[]) => {
      const g = presetGraph(at, 'bubble')
      const layers = g.layers.map((l) =>
        l.aes ? ({ ...l, aes: { x: 'c', y: 'd', color: 'a' } } as Layer) : l,
      )
      return { ...g, layers: [...back, ...layers] }
    }
    const graphs: [string, GraphNode][] = [
      ['category box with points', mapped('boxPoints', { x: 'a', y: 'c' })],
      ['bars ± SD', mapped('barsPoints', { x: 'a', y: 'c' })],
      ['grouped by Site', mapped('barsPoints', { x: 'a', y: 'c', color: 'f' })],
      ['number × text', mapped('points', { x: 'c', y: 'a' })],
      ['text × text counts', mapped('bars', { x: 'a', y: 'f' })],
      ['heat map of counts', mapped('heatmap', { x: 'a', y: 'f' })],
      [
        'ellipses, hulls and a path',
        xy([
          { id: 'ellipse', geom: 'polygon', stat: { kind: 'ellipse', type: 'norm', level: 0.9 } },
          { id: 'hull', geom: 'polygon', stat: { kind: 'hull' } },
          { id: 'path', geom: 'path', stat: { kind: 'identity' } },
        ] as Layer[]),
      ],
      ['variables as columns', presetGraph(at, 'barsPoints')],
    ]
    for (const [what, g] of graphs) {
      for (const level of [F, M]) {
        const split = filtered(g, level)
        const rows = filterRows(at, { variable: 'b', level })
        const sliced = { ...g, seriesSource: { ...g.seriesSource, rows } }
        const s = lay(at, split)
        expect(plain(s), what).toBe(plain(lay(at, sliced)))
        for (const r of pointRows(s)) expect(rows, what).toContain(r)
      }
      expect(plain(lay(at, filtered(g, F))), what).not.toBe(plain(lay(at, g)))
    }
  })

  it('moves a row to the other graph when its level changes', () => {
    const g = presetGraph(t, 'points', undefined, { mapping: { x: 'a', y: 'c' } })
    const [f, m] = [filtered(g, F), filtered(g, M)]
    const rowsOf = (table: DataTable, graph: GraphNode) =>
      resolveSeries(projectOf(table, graph), graph).flatMap((s) => [...(s.rows ?? [])])
    expect(rowsOf(t, m)).not.toContain(0)
    const edited = structuredClone(t)
    edited.dataSets[1]!.text![0] = 'M'
    expect(rowsOf(edited, m)).toContain(0)
    expect(rowsOf(edited, f)).not.toContain(0)
  })

  it('says why a graph whose variable is gone shows nothing', () => {
    const g = filtered(presetGraph(t, 'points', undefined, { mapping: { x: 'a', y: 'c' } }), F)
    const gone = { ...t, dataSets: t.dataSets.filter((d) => d.id !== 'b') }
    expect(graphRows(g, gone)).toEqual([])
    expect(lay(gone, g).warnings).toContain(
      'The text variable this graph shows one level of is no longer in the table.',
    )
  })
})

describe('splitting a graph into a set', () => {
  const t = sampleVariables()
  const base = (): GraphNode => ({
    ...presetGraph(t, 'boxPoints', 'Scores', { mapping: { x: 'a', y: 'c' } }),
    title: { content: [{ text: 'Scores' }], style: { size: 14 } },
  })

  it('one graph per level, in the order they first appear: a set sharing Y, titled by level', () => {
    const set = splitGraphs(t, base(), { by: 'level', variable: 'b' })
    expect(set.map((g) => g.seriesSource.filter)).toEqual([
      { variable: 'b', level: F },
      { variable: 'b', level: M },
    ])
    expect(set.map((g) => g.title?.content)).toEqual([[{ text: 'F' }], [{ text: 'M' }]])
    expect(set.map((g) => g.title?.style)).toEqual([{ size: 14 }, { size: 14 }])
    expect(set.map((g) => g.name)).toEqual(['Sample variables – F', 'Sample variables – M'])
    expect(new Set(set.map((g) => g.split?.set)).size).toBe(1)
    expect(set[0]!.split).toMatchObject({ by: 'level', variable: 'b' })
    expect(set[0]!.links?.y).toBeDefined()
    expect(set[0]!.links).toEqual(set[1]!.links)
    // The category axis isn't shared (nothing to share).
    expect(set[0]!.links?.x).toBeUndefined()
    // One legend: the last graph's.
    expect(set.map((g) => g.legend.show)).toEqual([false, base().legend.show])
    expect(set.map((g) => g.id)).not.toContain(base().id)
    expect(set.map(memberSlice)).toEqual([F, M])
    // Categories in the whole table's order on every graph (M's rows show High first).
    expect(set.map((g) => g.levels)).toEqual([
      { a: ['Low', 'High', 'Mid'] },
      { a: ['Low', 'High', 'Mid'] },
    ])
    // Free scales: no link groups.
    const free = splitGraphs(t, base(), { by: 'level', variable: 'b', linkY: false })
    expect(free[0]!.links).toBeUndefined()
  })

  it('follows the graph’s order of levels of the split variable', () => {
    const ordered = { ...base(), levels: { a: ['Mid', 'High', 'Low'] } }
    const set = splitGraphs(t, ordered, { by: 'level', variable: 'a' })
    expect(set.map((g) => g.title?.content?.[0]?.text)).toEqual(['Mid', 'High', 'Low'])
    // Each keeps the mapping, layers and order of levels.
    for (const g of set) {
      expect(g.mapping).toEqual(ordered.mapping)
      expect(g.layers).toEqual(ordered.layers)
      expect(g.levels).toEqual(ordered.levels)
    }
    // A number variable has no levels.
    expect(splitGraphs(t, base(), { by: 'level', variable: 'c' })).toEqual([])
  })

  it('splits other tables per data set and grouped tables per row, as sets', () => {
    const xy = sampleTable('xy')
    const perSet = splitGraphs(xy, presetGraph(xy, 'meanSdJoined'), { by: 'dataSet' })
    expect(perSet.length).toBeGreaterThan(1)
    expect(perSet.map((g) => g.seriesSource.include)).toEqual(
      xy.dataSets
        .filter((d) => d.subcolumns.some((c) => c.values.some((v) => v != null)))
        .map((d) => [d.id]),
    )
    expect(new Set(perSet.map((g) => g.split?.set)).size).toBe(1)
    expect(perSet[0]!.split?.by).toBe('dataSet')
    // XY: both axes continuous, both shared.
    expect(perSet[0]!.links?.x).toBeDefined()
    expect(perSet[0]!.links?.y).toBeDefined()
    const grouped = sampleTable('grouped')
    const perRow = splitGraphs(grouped, presetGraph(grouped, 'barsPoints'), { by: 'row' })
    expect(perRow.map((g) => g.seriesSource.rows)).toEqual(perRow.map((_, i) => [i]))
    expect(perRow.every((g) => g.split?.by === 'row')).toBe(true)
    expect(splitGraphs(xy, presetGraph(xy, 'meanSdJoined'), { by: 'row' })).toEqual([])
  })

  it('a member of another table kind keeps every format of its data set', () => {
    const col = sampleTable('column')
    const g = presetGraph(col, 'barsPoints')
    const own = col.dataSets[1]!.id as ColumnId
    const styled = { ...g, seriesOverrides: { [own]: { color: { palette: 5 } } } }
    const set = splitGraphs(col, styled, { by: 'dataSet' })
    expect(set[1]!.seriesOverrides[own]).toEqual({ color: { palette: 5 } })
  })
})
