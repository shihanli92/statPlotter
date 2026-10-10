import {
  type ColumnId,
  createProject,
  createTable,
  type DataTable,
  type DocNode,
  type Frame,
  type NodeId,
  type Project,
  TableKind,
  type VariableMapping,
  type YFormat,
} from '@ps/model'
import { expect } from 'vitest'
import type { MatrixKind, MvKind, Prim, Scene, SceneNode } from '../src/index.ts'
import { loadNodeFonts } from '../src/node.ts'

// Shared by the graph and ui tests (ui imports this file by path; check-deps scans src only).

/** The bundled fonts, loaded once per test file. */
export const fonts = await loadNodeFonts()

/** A project holding the given nodes, in navigator order (nothing validates it). */
export function projectOf(...nodes: DocNode[]): Project {
  const project = createProject()
  for (const n of nodes) {
    project.nodes[n.id] = n as DocNode
    project.order.push(n.id)
  }
  return project
}

/** Every node of a scene tree, depth first. */
export const flatten = (n: SceneNode, out: SceneNode[] = []): SceneNode[] => {
  out.push(n)
  for (const c of n.children ?? []) flatten(c, out)
  return out
}

export const byId = (s: Scene, id: string) => flatten(s.root).find((n) => n.id === id)

/** The drawn nodes whose id starts with `prefix`. */
export const nodes = (s: Scene, prefix: string) =>
  flatten(s.root).filter((n) => n.id.startsWith(prefix) && n.prim)

/** A node's primitive, asserting its type. */
export const prim = <T extends Prim['type']>(n: SceneNode | undefined, t: T) => {
  expect(n?.prim?.type, n?.id).toBe(t)
  return n!.prim as Extract<Prim, { type: T }>
}

/** CPU-time complexity check shared with the stats tests. */
export { cpuRatio, growthRatio } from '../../stats/test/timing.ts'

export const TABLE_KINDS: readonly TableKind[] = TableKind.options

/**
 * A table of a kind with fixed ids (table `t1`, data sets `a`, `b`…), so graphs of it render to
 * the same SVG on every run: `cols[data set][subcolumn][row]`.
 */
export function fixedTable(
  kind: TableKind,
  yFormat: YFormat,
  cols: (number | null)[][][],
  opts: { titles?: string[]; rowTitles?: string[]; x?: number[] } = {},
): DataTable {
  const rows = Math.max(...cols.flatMap((c) => c.map((s) => s.length)))
  const table = createTable({ tableKind: kind, yFormat, columns: cols.length, rows })
  table.id = 't1' as NodeId
  table.name = `Sample ${kind}`
  table.dataSets.forEach((d, i) => {
    d.id = String.fromCharCode(97 + i) as ColumnId
    if (opts.titles) d.title = opts.titles[i]!
    d.subcolumns.forEach((s, j) => {
      s.values = Array.from({ length: rows }, (_, r) => cols[i]![j]?.[r] ?? null)
    })
  })
  if (opts.rowTitles) table.rowTitles = opts.rowTitles
  if (opts.x) table.x!.subcolumns[0]!.values = opts.x
  return table
}

/**
 * A small deterministic table of each kind, with fixed ids (table `t1`, data sets `a`, `b`…) so
 * graphs of it render to the same SVG on every run.
 */
export function sampleTable(kind: TableKind): DataTable {
  const make = (
    yFormat: YFormat,
    cols: (number | null)[][][],
    opts: { titles?: string[]; rowTitles?: string[]; x?: number[] } = {},
  ) => fixedTable(kind, yFormat, cols, opts)
  const one: YFormat = { type: 'replicates', count: 1 }
  switch (kind) {
    case 'column':
      return make(
        one,
        [[[12, 15, 11, 14, 13, 16]], [[18, 21, 17, 22, 20, 19]], [[9, 11, 10, 8, 12, null]]],
        { titles: ['Control', 'Drug A', 'Drug B'] },
      )
    case 'xy':
      return make(
        { type: 'replicates', count: 2 },
        [
          [
            [1, 2.2, 2.9, 4.1, 5.2, 5.8],
            [1.4, 1.8, 3.3, 3.9, 4.6, 6.3],
          ],
          [
            [2, 3.6, 6.1, 8.4, 9.7, 12.2],
            [2.5, 4.2, 5.5, 7.8, 10.6, 11.5],
          ],
        ],
        { titles: ['Slow', 'Fast'], x: [0, 1, 2, 3, 4, 5] },
      )
    case 'grouped':
      return make(
        { type: 'replicates', count: 3 },
        [
          [
            [10, 20, 15],
            [12, 23, 14],
            [11, 19, 17],
          ],
          [
            [14, 26, 18],
            [13, 29, 16],
            [16, 24, 19],
          ],
        ],
        { titles: ['Vehicle', 'Treated'], rowTitles: ['WT', 'KO', 'Het'] },
      )
    case 'contingency':
      return make(one, [[[20, 5]], [[10, 25]]], {
        titles: ['Disease', 'Healthy'],
        rowTitles: ['Exposed', 'Unexposed'],
      })
    case 'survival':
      return make(
        one,
        [[[1, 0, 1, 1, null, null, null, null]], [[null, null, null, null, 1, 0, 1, 1]]],
        { titles: ['Placebo', 'Drug'], x: [2, 3, 4, 5, 6, 7, 8, 9] },
      )
    case 'nested':
      return make(
        { type: 'replicates', count: 3 },
        [
          [
            [5, 6, 5.5, 6.2],
            [7, 7.5, 6.8, 7.2],
            [4.5, 5.2, 4.9, 5.1],
          ],
          [
            [8, 8.6, 9.1, 8.2],
            [9.5, 10.1, 9.8, 9.2],
            [7.4, 7.9, 8.3, 7.7],
          ],
        ],
        { titles: ['Control', 'Treated'] },
      )
    case 'multipleVariables':
      return make(
        one,
        [
          [[21, 34, 45, 52, 63, 70]],
          [[10, 30, 20, 50, 40, 60]],
          [[1, 4, 9, 16, null, 25]],
          [[0, 1, 2, 3, 4, 5]],
        ],
        { titles: ['Age', 'Dose', 'Weight', 'Score'] },
      )
    case 'partsOfWhole':
      return make(one, [[[40, 25, 20, 15]], [[30, 30, 25, 15]]], {
        titles: ['2024', '2025'],
        rowTitles: ['Rent', 'Food', 'Travel', 'Other'],
      })
  }
}

/**
 * A small multiple-variables table with text variables (roadmap 34a), fixed ids: `a` Group (text,
 * three levels, first seen Low, High, Mid), `b` Sex (text), `c` Score, `d` Age; two rows of each
 * Group and Sex; row 12 has no Group, row 13 no Score (both left out of graphs of them).
 */
export function sampleVariables(): DataTable {
  const table = createTable({ tableKind: 'multipleVariables', columns: 4, rows: 14 })
  table.id = 't1' as NodeId
  table.name = 'Sample variables'
  const titles = ['Group', 'Sex', 'Score', 'Age']
  table.dataSets.forEach((d, i) => {
    d.id = String.fromCharCode(97 + i) as ColumnId
    d.title = titles[i]!
  })
  const groups = ['Low', 'High', 'Mid']
  table.dataSets[0]!.text = [...Array.from({ length: 12 }, (_, r) => groups[r % 3]!), null, 'Low']
  table.dataSets[1]!.text = [...'FMFMFMFMFMFMFF'].map((t) => t)
  table.dataSets[2]!.subcolumns[0]!.values = [
    12,
    18,
    15,
    10,
    21,
    14,
    13,
    19,
    16,
    11,
    22,
    15,
    30,
    null,
  ]
  table.dataSets[3]!.subcolumns[0]!.values = [
    34, 45, 52, 61, 29, 47, 55, 38, 41, 50, 33, 58, 44, 39,
  ]
  return table
}

/**
 * `sampleVariables` with two more variables to map to appearance (roadmap 34b): `e` BMI (a
 * number; row 5 empty) and `f` Site (text, North / South; row 7 empty).
 */
export function appearanceTable(): DataTable {
  const t = sampleVariables()
  const extra = createTable({ tableKind: 'multipleVariables', columns: 2, rows: 14 })
  const [bmi, site] = extra.dataSets.map((d) => structuredClone(d))
  bmi!.id = 'e' as ColumnId
  bmi!.title = 'BMI'
  bmi!.subcolumns[0]!.values = [
    21.5,
    24.1,
    27.8,
    19.9,
    31.2,
    null,
    22.4,
    25.6,
    29.3,
    23.0,
    26.7,
    20.8,
    28.1,
    24.9,
  ]
  site!.id = 'f' as ColumnId
  site!.title = 'Site'
  site!.text = Array.from({ length: 14 }, (_, r) => (r === 7 ? null : r % 3 ? 'North' : 'South'))
  return { ...t, dataSets: [...t.dataSets, bmi!, site!] }
}

/**
 * A mapping of `sampleVariables` for a graph of variables of a kind on a frame: text × number
 * Score by Group (coloured by Sex on grouped graphs), number × text the same way round turned,
 * text × text Group by Sex.
 */
export function sampleMapping(kind: MvKind, frame: Frame): VariableMapping {
  const color = frame === 'grouped' ? { color: 'b' } : {}
  if (kind === 'mvTextNumber') return { x: 'a', y: 'c', ...color }
  if (kind === 'mvNumberText') return { x: 'c', y: 'a', ...color }
  return { x: 'a', y: 'b' }
}

/**
 * The sample table of a matrix kind with the preset options for it: a graph of variables'
 * mapping (categories alone; `grouped`: coloured by Sex) on `sampleVariables`.
 */
export function sampleFor(
  kind: MatrixKind,
  grouped = false,
): { table: DataTable; opts: { mapping?: VariableMapping } } {
  if (!kind.startsWith('mv')) return { table: sampleTable(kind as TableKind), opts: {} }
  const mapping = sampleMapping(kind as MvKind, grouped ? 'grouped' : 'category')
  return { table: sampleVariables(), opts: { mapping } }
}

/**
 * Roadmap 34g: a small flow-cytometry-like multiple-variables table with fixed ids (`t1`; `p`
 * Population, text; `c` CD3, `d` CD19, `e` CD56: raw fluorescence, a negative population spread
 * round zero (negatives included) and a positive one log-normal about 10³–10⁴; `f` FSC-A, linear):
 * T cells (CD3⁺), B cells (CD19⁺), NK cells (CD56⁺) and debris (low everywhere). Deterministic.
 */
export function cytometryTable(rows = 400, seed = 7): DataTable {
  let s = seed >>> 0
  const u = () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(u(), 1e-12))) * Math.cos(2 * Math.PI * u())
  const pops = ['T cells', 'B cells', 'NK cells', 'Debris'] as const
  const neg = () => Math.round(gauss() * 150)
  const pos = (mu: number) => Math.round(10 ** (mu + gauss() * 0.25))
  const t = createTable({ tableKind: 'multipleVariables', columns: 5, rows })
  t.id = 't1' as NodeId
  t.name = 'Cytometry'
  const ids = ['p', 'c', 'd', 'e', 'f']
  const titles = ['Population', 'CD3', 'CD19', 'CD56', 'FSC-A']
  t.dataSets.forEach((d, i) => {
    d.id = ids[i] as ColumnId
    d.title = titles[i]!
  })
  const text: string[] = []
  const cols: number[][] = [[], [], [], []]
  for (let r = 0; r < rows; r++) {
    const k = Math.min(3, Math.floor(u() ** 1.3 * 4))
    const p = pops[k]!
    text.push(p)
    cols[0]!.push(p === 'T cells' ? pos(3.4) : neg())
    cols[1]!.push(p === 'B cells' ? pos(3.7) : neg())
    cols[2]!.push(p === 'NK cells' ? pos(3.1) : neg())
    cols[3]!.push(Math.round((p === 'Debris' ? 20000 : 80000) + gauss() * 12000))
  }
  t.dataSets[0]!.text = text
  for (let i = 0; i < 4; i++) t.dataSets[i + 1]!.subcolumns[0]!.values = cols[i]!
  return t
}
