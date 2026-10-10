import {
  CELLS_COLUMNS,
  cellsColumns,
  cellsColumnsNote,
  layoutGraph,
  newGraphNode,
  PREVIEW_MARKS,
  previewGraph,
  previewScreen,
  previewSource,
} from '@ps/graph'
import { type ColumnId, createTable, type DataTable, type NodeId } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { fonts, growthRatio, projectOf } from '../../graph/test/helpers.ts'
import {
  type BuilderAction,
  builderChange,
  builderReducer,
  initialBuilder,
} from '../src/graph/builder/builderState.ts'

// The builder on wide tables (decisions 452, 453): "Columns" of 60 number variables previews 20
// of them and about 5,000 per-row marks whatever the rows, and a cells table's columns start
// with its first 20 number variables.

/** `rows` rows × `cols` number variables, an ordinary table unless `cells`. */
function wide(rows: number, cols: number, cells = false): DataTable {
  const t = createTable({ tableKind: 'multipleVariables', columns: 0, rows: 0 })
  t.id = 't1' as NodeId
  t.name = 'Wide'
  t.rowCount = rows
  t.cellsTable = cells
  let a = 99
  t.dataSets = Array.from({ length: cols }, (_, k) => ({
    id: `v${k}` as ColumnId,
    title: `Gene ${k + 1}`,
    subcolumns: [
      {
        type: 'number' as const,
        values: Array.from({ length: rows }, () => {
          a = (Math.imul(a, 1103515245) + 12345) >>> 0
          return k + (a % 1000) / 250
        }),
      },
    ],
  }))
  return t
}

/** The builder's preview as GraphBuilder lays it out (decisions 433, 452). */
function preview(t: DataTable, s: ReturnType<typeof initialBuilder>) {
  const project = projectOf(t)
  const src = previewSource(project, t.id, undefined)
  const sample = src.project.nodes[t.id] as DataTable
  const made = { ...newGraphNode(sample, builderChange(s)), id: 'p' as NodeId }
  const { graph, sets } = previewGraph(made, t)
  return layoutGraph({
    project: { ...src.project, nodes: { ...src.project.nodes, [graph.id]: graph } },
    graph,
    fonts,
    screen: previewScreen(sets?.shown ?? null),
  })
}

const columns: BuilderAction = { type: 'toggle', style: 'columns' }

describe('the builder’s Columns on a wide table', () => {
  it('previews 20 columns of points, about 5,000 in all', () => {
    const t = wide(30_000, 60)
    const s = builderReducer(t, initialBuilder(t), columns)
    expect(s.layers.some((l) => l.geom === 'points' && l.stat.kind === 'identity')).toBe(true)
    const scene = preview(t, s)
    let points = 0
    const walk = (n: (typeof scene)['root']) => {
      if (n.prim?.type === 'symbol' && n.point !== undefined) points++
      if (n.prim?.type === 'points') points += n.prim.n
      for (const c of n.children ?? []) walk(c)
    }
    walk(scene.root)
    expect(points).toBeGreaterThan(0)
    expect(points).toBeLessThanOrEqual(PREVIEW_MARKS)
  })

  it('costs about the same for 200,000 rows × 60 variables as for 20,000', () => {
    const tables = new Map<number, DataTable>()
    const tableOf = (n: number) => {
      let t = tables.get(n)
      if (!t) {
        t = wide(n, 60)
        tables.set(n, t)
      }
      return t
    }
    const clicks: BuilderAction[] = [
      columns,
      { type: 'toggle', style: 'box' },
      { type: 'toggle', style: 'violin' },
      { type: 'toggle', style: 'heatmap' },
      columns,
    ]
    const clicking = (n: number) => {
      const t = tableOf(n)
      let s = initialBuilder(t)
      for (const a of clicks) {
        s = builderReducer(t, s, a)
        preview(t, s)
      }
    }
    tableOf(20_000)
    tableOf(200_000)
    // Linear work would be about 10 times as costly; a bounded preview is not.
    expect(growthRatio(clicking, 20_000, 10, 2)).toBeLessThan(3)
  }, 600_000)

  it('costs about the same for 60 variables as for 15 (the preview’s 20, 5,000 points)', () => {
    const tables = new Map<number, DataTable>()
    const tableOf = (cols: number) => {
      let t = tables.get(cols)
      if (!t) {
        t = wide(20_000, cols)
        tables.set(cols, t)
      }
      return t
    }
    const clicking = (cols: number) => {
      const t = tableOf(cols)
      preview(t, builderReducer(t, initialBuilder(t), columns))
    }
    tableOf(15)
    tableOf(60)
    // Every variable a column of 5,000 points (before decision 452) is 4 times as costly.
    expect(growthRatio(clicking, 15, 4, 2)).toBeLessThan(2)
  }, 600_000)
})

describe('a cells table’s Columns', () => {
  it('summarise its first 20 number variables to start with', () => {
    const t = wide(100, 60, true)
    const s = builderReducer(t, initialBuilder(t), columns)
    expect(s.layers.map((l) => l.geom)).toEqual(['box'])
    expect(cellsColumns(s, t)).toEqual(t.dataSets.slice(0, CELLS_COLUMNS).map((d) => d.id))
    expect(cellsColumnsNote(20, 60)).toBe(
      'Summarising 20 of 60 number variables: tick others under Data sets.',
    )
    // Not a cells table, few variables, or not columns: every one.
    const plain = wide(100, 60)
    expect(cellsColumns(builderReducer(plain, initialBuilder(plain), columns), plain)).toBeNull()
    const few = wide(100, 12, true)
    expect(cellsColumns(builderReducer(few, initialBuilder(few), columns), few)).toBeNull()
    expect(cellsColumns(initialBuilder(t), t)).toBeNull()
  })
})
