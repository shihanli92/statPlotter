import {
  type AnalysisDef,
  type AnalysisNode,
  type AnalysisResult,
  type ColumnId,
  createProject,
  createTable,
  type DataTable,
  type DocNode,
  type GraphNode,
  type LayoutNode,
  type NodeId,
  newAnnotationId,
  newLayoutItemId,
  newNodeId,
  newSeriesId,
  nodeDependencies,
  type Project,
} from '@ps/model'
import { z } from 'zod'
import { type AnalysisRegistry, DocumentStore } from '../src/index.ts'
import { curves, POINTS } from './graphs.ts'

// A deep family for the reuse tests (roadmap 31): a table with a chain of analyses (a result
// table and an analysis of it), comparisons, curves, brackets, point labels and formats, a row
// slice, row parameters, shared axes and layouts, next to another table.

const empty = (): AnalysisResult => ({
  status: 'ok',
  diagnostics: [],
  sheets: [],
  values: {},
  comparisons: [],
  outputs: {},
})

const first = (ds: { data: { shape: string; reps?: Float64Array[]; mean?: Float64Array } }) =>
  ds.data.shape === 'replicates' ? ds.data.reps![0]! : ds.data.mean!

/** Each input's first subcolumn × factor, as a result table keeping the input keys. */
const scaleDef: AnalysisDef<{ factor: number }> = {
  id: 'test.scale',
  version: 1,
  title: 'Scale',
  category: 'Test',
  description: '',
  form: [],
  accepts: ['column'],
  inputs: { min: 1, max: 10 },
  params: z.object({ factor: z.number().default(2) }),
  producesTable: true,
  run(input, p) {
    const rowCount = Math.max(0, ...input.map((d) => d.rowCount))
    const table: DataTable = {
      ...createTable({ rows: rowCount, columns: 0 }),
      dataSets: input.map((ds) => ({
        id: ds.ref.key as ColumnId,
        title: `${ds.title} × ${p.factor}`,
        subcolumns: [
          {
            type: 'number' as const,
            values: Array.from(first(ds), (v) => (Number.isNaN(v) ? null : v * p.factor)),
          },
        ],
      })),
    }
    return { ...empty(), table }
  },
}

/** Sum of each input, a comparison of the first two and a "curve" per input. */
const sumDef: AnalysisDef<{ weights: Record<string, number> }> = {
  id: 'test.sum',
  version: 1,
  title: 'Sum',
  category: 'Test',
  description: '',
  form: [],
  accepts: ['column'],
  inputs: { min: 1, max: 10 },
  params: z.object({ weights: z.record(z.string(), z.number()).default({}) }),
  outputs: (keys) => keys.map((k) => ({ key: `curve:${k}`, forDataSet: k })),
  run(input, p) {
    const sums = input.map((d) => {
      let s = 0
      for (const v of first(d)) if (!Number.isNaN(v)) s += v * (p.weights[d.ref.key] ?? 1)
      return s
    })
    const [a, b] = input
    return {
      ...empty(),
      values: Object.fromEntries(
        input.map((d, i) => [d.title, { kind: 'number' as const, v: sums[i]! }]),
      ),
      comparisons:
        a && b ? [{ key: `${a.ref.key}|${b.ref.key}`, a: a.ref, b: b.ref, p: 0.01 }] : [],
      outputs: Object.fromEntries(
        input.map((d, i) => [
          `curve:${d.ref.key}`,
          { title: d.title, x: [0, 1], y: [0, sums[i]!] },
        ]),
      ),
    }
  },
}

const DEFS = [scaleDef, sumDef] as unknown as AnalysisDef<unknown>[]
export const registry: AnalysisRegistry = {
  engineVersion: 'test',
  get: (id) => DEFS.find((d) => d.id === id),
}

export function analysis(
  name: string,
  analysisId: string,
  source: NodeId,
  dataSets: string[],
  params: unknown = {},
): AnalysisNode {
  return {
    kind: 'analysis',
    id: newNodeId(),
    name,
    analysisId,
    pluginVersion: 1,
    input: { source, dataSets },
    params,
  }
}

export function graph(name: string, table: NodeId, extra: Partial<GraphNode> = {}): GraphNode {
  return {
    kind: 'graph',
    id: newNodeId(),
    name,
    frame: 'category',
    look: 'column.scatter',
    layers: [POINTS],
    seriesSource: { table, include: 'all' },
    seriesOverrides: {},
    size: { plotWidth: 100, plotHeight: 100 },
    axes: {
      x: { type: 'categorical', title: null, labels: 'dataSetTitles', rotation: 0 },
      y: {
        type: 'continuous',
        title: null,
        scale: 'linear',
        range: 'auto',
        ticks: 'auto',
        format: { mode: 'auto' },
        frame: 'plain',
        breaks: [],
      },
    },
    annotations: [],
    legend: { show: true, position: 'right' },
    title: null,
    style: {},
    ...extra,
  }
}

export function layout(name: string, graphs: NodeId[]): LayoutNode {
  return {
    kind: 'layout',
    id: newNodeId(),
    name,
    page: { width: 612, height: 792 },
    items: [
      ...graphs.map((g, i) => ({
        type: 'graph' as const,
        id: newLayoutItemId(),
        graph: g,
        x: 0,
        y: i * 200,
        scale: 1,
      })),
      {
        type: 'text' as const,
        id: newLayoutItemId(),
        x: 10,
        y: 10,
        content: { content: [{ text: 'Figure' }] },
      },
    ],
    panelLabels: { show: true, style: 'A', size: 14 },
  }
}

/** Day 1 (A, B, C; 4 rows) with its family, and Day 2 (a table with its own graph). */
export function deepFamily() {
  const day1 = createTable({ name: 'Day 1', rows: 4, columns: 3 })
  day1.rowTitles = ['r1', 'r2', 'r3', 'r4']
  const [A, B, C] = day1.dataSets.map((d) => d.id) as [ColumnId, ColumnId, ColumnId]
  day1.dataSets[0]!.subcolumns[0]!.values = [1, 2, 3, 4]
  day1.dataSets[1]!.subcolumns[0]!.values = [10, 20, 30, 40]
  day1.dataSets[2]!.subcolumns[0]!.values = [5, null, 7, 8]
  const other = createTable({ name: 'Other', rows: 2, columns: 2 })
  other.dataSets[0]!.subcolumns[0]!.values = [100, 200]

  const scale = analysis('Scale of Day 1', 'test.scale', day1.id, [A, B], { factor: 3 })
  const sumOfScale = analysis('Sum of Scale of Day 1', 'test.sum', scale.id, [A, B])
  const sum = analysis('Sum of Day 1', 'test.sum', day1.id, [A, B, C], { weights: { [C]: 2 } })
  // Row parameters (as goodness of fit's expected values per row) follow rows.
  const gof = analysis('Expected of Day 1', 'goodnessOfFit', day1.id, [A], {
    expected: [1, 2, 3, 4],
  })

  const bracket = newAnnotationId()
  const curve = newSeriesId()
  const g1 = graph('Day 1', day1.id, {
    seriesSource: { table: day1.id, include: [A, B, C], rows: [0, 1, 3] },
    seriesOverrides: {
      [A]: {
        color: { palette: 2 },
        pointLabels: { source: 'rowTitle', which: 'rows', rows: [0, 3] },
      },
      [C]: { color: { palette: 4 } },
    },
    pointOverrides: { [A]: { r1s0: { label: 'odd' }, r3s0: { color: { palette: 1 } } } },
    layers: [POINTS, curves([{ id: curve, ref: { node: sum.id, key: `curve:${A}` }, colorOf: A }])],
    annotations: [
      {
        type: 'bracket',
        id: bracket,
        a: A,
        b: B,
        label: { source: 'analysis', analysis: sum.id, comparison: `${A}|${B}`, show: 'stars' },
        level: 'auto',
      },
    ],
    legend: { show: true, position: 'right', hidden: [C] },
    links: { y: 'day1axes' },
  })
  const g2 = graph('Scale of Day 1', scale.id, {
    seriesSource: { table: scale.id, include: [B] },
    layers: [
      POINTS,
      curves([{ id: newSeriesId(), ref: { node: sumOfScale.id, key: `curve:${B}` } }]),
    ],
    links: { y: 'day1axes' },
  })
  const gOther = graph('Other', other.id)
  const whole = layout('Figure Day 1', [g1.id, g2.id])
  const mixed = layout('Figure both', [g1.id, gOther.id])

  const project: Project = createProject('Reuse')
  const nodes: DocNode[] = [day1, other, scale, sumOfScale, sum, gof, g1, g2, gOther, whole, mixed]
  for (const n of nodes) {
    project.nodes[n.id] = n
    project.order.push(n.id)
  }
  const store = new DocumentStore(project)
  return {
    store,
    day1,
    other,
    A,
    B,
    C,
    scale,
    sumOfScale,
    sum,
    gof,
    g1,
    g2,
    gOther,
    whole,
    mixed,
    bracket,
    curve,
  }
}

/** Every node a node refers to (analyses, graphs' sources, curves and brackets, layout graphs). */
export const refsOf = (n: DocNode): NodeId[] => nodeDependencies(n)
