import {
  type AnalysisNode,
  type ColumnId,
  createProject,
  createTable,
  type DataTable,
  type DocNode,
  type GraphNode,
  GraphNode as GraphNodeSchema,
  type GraphRef,
  graphRefs,
  type KeyRole,
  levelKey,
  mapGraphRefs,
  type NodeId,
  nodeDependencies,
  type Project,
  type RowRole,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { type Command, createMethod, mergePlan, produceCommands, remapNode } from '../src/index.ts'

// Audit 2 (M12): every walker of a graph's references handles every kind of reference. A graph
// names something at every kind `graphRefs` knows (`KINDS`, typed by the union of kinds and roles,
// so a new kind or role is a type error here until it has an entry); each walker is run on it and
// must leave no reference naming what it maps: graphRefs (visits every kind), mapGraphRefs, the
// reuse remap (`remapNode`), the data set remap of Swap X and Y and of deleting columns
// (`remapDataSetKeys`), the row remap of row inserts, deletes and reorders (`remapGraphRows`),
// the clean-up when an analysis is deleted (`node.remove`), Import from project (`mergePlan`),
// methods (`createMethod`) and node dependencies. The audit's M3 and M4 (a walker missing a kind)
// fail here. `EXPECT` says which walkers map each kind; the fixture is checked against it too (a
// kind names what a walker maps exactly when the walker is listed).

type Walker =
  | 'mapGraphRefs'
  | 'remapNode'
  | 'swapXY'
  | 'removeDataSets'
  | 'insertRows'
  | 'deleteRows'
  | 'permuteRows'
  | 'removeNode'
  | 'merge'
  | 'method'
  | 'nodeDependencies'

/** A kind of reference, with its role for keys, rows and categories. */
type RefKind =
  | Exclude<GraphRef['kind'], 'key' | 'rows' | 'category'>
  | `key:${KeyRole}`
  | `rows:${RowRole}`
  | `category:${Extract<GraphRef, { kind: 'category' }>['role']}`

function kindOf(r: GraphRef): RefKind {
  switch (r.kind) {
    case 'key':
      return `key:${r.role}`
    case 'rows':
      return `rows:${r.role}`
    case 'category':
      return `category:${r.role}`
    default:
      return r.kind
  }
}

const NODES: Walker[] = ['mapGraphRefs', 'remapNode', 'merge', 'nodeDependencies']
const DROPPED: Walker[] = ['removeNode', 'method']
const KEYS: Walker[] = ['mapGraphRefs', 'remapNode', 'swapXY', 'removeDataSets']
const ROWS: Walker[] = ['mapGraphRefs', 'remapNode', 'insertRows', 'deleteRows', 'permuteRows']
const both = (...lists: Walker[][]) => [...new Set(lists.flat())]

/**
 * The walkers mapping each kind; a string says why a kind is not in the fixture (it is never a
 * reference `graphRefs` gives).
 */
const EXPECT: Record<RefKind, Walker[] | string> = {
  source: NODES,
  output: both(NODES, DROPPED, KEYS),
  bracket: both(NODES, DROPPED, KEYS, ROWS),
  analysis: both(NODES, DROPPED),
  resultKey: both(KEYS, ROWS),
  'key:include': KEYS,
  'key:identity': KEYS,
  'key:points': KEYS,
  'key:layerSeries': KEYS,
  'key:colorOf': KEYS,
  'key:aes': KEYS,
  'key:mapping': KEYS,
  // Levels' symbols are keyed by the level's text: no walker maps them.
  'key:shapes': [],
  'key:levels': KEYS,
  'key:legend': KEYS,
  'key:filter': KEYS,
  'key:split': KEYS,
  'key:categories':
    'category keys are `category` references; mapGraphRefs passes their data sets to `key` in this role',
  'rows:slice': ROWS,
  'rows:pointLabels': ROWS,
  pointRows: ROWS,
  'category:cells': both(KEYS, ROWS),
  'category:rename': both(KEYS, ROWS),
  'category:span': both(KEYS, ROWS),
}

const KINDS = Object.keys(EXPECT) as RefKind[]
const IN_FIXTURE = KINDS.filter((k) => typeof EXPECT[k] !== 'string')

// What a reference names: node ids, data set ids, and rows ('#<row>'). Levels and output ids name
// no data set.
const tokens = (s: string) => s.match(/[0-9a-z]+/g) ?? []
function keyNames(key: string): string[] {
  const row = /^row(\d+):(.*)$/.exec(key)
  if (row) return [`#${row[1]}`, ...tokens(row[2]!)]
  const col = /^col([0-9a-z]+):(\d+)\|(\d+)$/.exec(key)
  if (col) return [...tokens(col[1]!), `#${col[2]}`, `#${col[3]}`]
  const cell = /^cell(\d+):([^|]+)\|(\d+):(.+)$/.exec(key)
  if (cell) return [`#${cell[1]}`, ...tokens(cell[2]!), `#${cell[3]}`, ...tokens(cell[4]!)]
  return tokens(key)
}
function categoryNames(key: string): string[] {
  return key.split('/').flatMap((part) => {
    const row = /^@(\d+)$/.exec(part)
    if (row) return [`#${row[1]}`]
    return part.startsWith('lv_') ? [] : [part]
  })
}
function names(r: GraphRef): string[] {
  switch (r.kind) {
    case 'source':
    case 'analysis':
      return [r.node]
    case 'output':
      return [r.node, ...keyNames(r.key)]
    case 'bracket': {
      const a = r.annotation
      return [
        a.a,
        a.b,
        ...(a.group ?? []),
        ...[a.rowA, a.rowB].flatMap((x) => (x === undefined ? [] : [`#${x}`])),
        ...(a.label.source === 'analysis'
          ? [a.label.analysis, ...keyNames(a.label.comparison)]
          : []),
      ]
    }
    case 'resultKey':
      return keyNames(r.key)
    case 'key':
      return r.of === 'dataSet' ? [r.key] : []
    case 'rows':
      return r.rows.map((x) => `#${x}`)
    case 'pointRows':
      return r.points.flatMap((p) => {
        const m = /^r(\d+)/.exec(p)
        return m ? [`#${m[1]}`] : []
      })
    case 'category':
      return categoryNames(r.key)
  }
}

const id = <T extends string>(s: string) => s as T
const T = id<NodeId>('ttable')
const U = id<NodeId>('utable')
const FIT = id<NodeId>('fit')
const ANOVA = id<NodeId>('anova')
const CORR = id<NodeId>('corr')
/** An analysis of another table (a method of T leaves it out). */
const EXT = id<NodeId>('ext')
const G = id<NodeId>('graph')
const ROW = 3
const LEVEL = levelKey('High')

const AXIS = {
  type: 'continuous' as const,
  title: null,
  scale: 'linear' as const,
  range: 'auto' as const,
  ticks: 'auto' as const,
  format: { mode: 'auto' as const },
  frame: 'plain' as const,
  breaks: [],
}

/** A bracket labelled by `analysis`' comparison `comparison` (its own table's keys and rows). */
const bracket = (n: string, analysis: NodeId, comparison: string) => ({
  type: 'bracket',
  id: n,
  a: 'qa',
  b: 'qb',
  rowA: ROW,
  rowB: ROW,
  label: { source: 'analysis', analysis, comparison, show: 'stars' },
  level: 'auto',
  group: ['qa'],
})

/** A graph of T naming data set `qa`, row 3 and analyses of T at every kind of reference. */
const GRAPH = {
  kind: 'graph',
  id: G,
  name: 'G',
  frame: 'xy',
  look: 'xy.scatter',
  layers: [
    { id: 'points', geom: 'points', stat: { kind: 'identity' }, series: { qa: { hide: true } } },
    {
      id: 'curves',
      geom: 'line',
      stat: { kind: 'identity' },
      data: {
        from: 'outputs',
        series: [
          { id: 'c1', ref: { node: FIT, key: 'curve:qa' }, colorOf: 'qa' },
          { id: 'c2', ref: { node: EXT, key: 'curve:ua' } },
        ],
      },
      series: { c1: { style: { gaps: true } } },
    },
    {
      id: 'bubbles',
      geom: 'points',
      stat: { kind: 'identity' },
      aes: { x: 'qa', y: 'qb', size: 'qa', color: 'qa', shape: 'qa', group: 'qa', label: 'qa' },
    },
    { id: 'vectors', geom: 'segment', stat: { kind: 'identity' }, aes: { xend: 'qa', yend: 'qa' } },
    {
      id: 'result',
      geom: 'label',
      stat: {
        kind: 'result',
        fields: {
          s: { ref: { from: 'value', key: 'slope:qa' } },
          p: { ref: { from: 'comparison', key: `row${ROW}:qa|qb` } },
        },
        template: '{s} {p}',
      },
      data: { from: 'analysis', analysis: CORR },
    },
  ],
  seriesSource: {
    table: T,
    include: ['qa', 'qb'],
    rows: [ROW],
    filter: { variable: 'qa', level: LEVEL },
  },
  split: { set: 's1', by: 'level', variable: 'qa' },
  seriesOverrides: {
    qa: { color: { palette: 1 }, pointLabels: { source: 'y', which: 'rows', rows: [ROW] } },
  },
  pointOverrides: { qa: { [`r${ROW}s0`]: { size: 3 } } },
  size: { plotWidth: 100, plotHeight: 100 },
  axes: {
    x: AXIS,
    y: {
      type: 'categorical',
      title: null,
      labels: 'dataSetTitles',
      rotation: 0,
      treatments: {
        rows: [{ title: 'TNF', cells: { qa: '+', [`@${ROW}`]: '-', [`@${ROW}/qa`]: '+' } }],
      },
      spans: {
        rename: { [`@${ROW}`]: 'G1', qa: 'A' },
        list: [{ label: 'L', keys: ['qa', `@${ROW}/qa`] }],
      },
    },
  },
  annotations: [
    bracket('n1', ANOVA, `row${ROW}:qa|qb`),
    bracket('n2', EXT, 'ua|ub'),
    { type: 'table', id: 'n3', analysis: CORR, sheet: 'results' },
    { type: 'table', id: 'n4', analysis: EXT, sheet: 'results' },
  ],
  legend: { show: true, position: 'right', hidden: ['qa', 'c1'] },
  title: null,
  style: { seriesDefaults: { pointLabels: { source: 'x', which: 'rows', rows: [ROW] } } },
  mapping: { x: 'qa', y: 'qb', color: 'qa', shape: 'qa', size: 'qa', label: 'qa' },
  levels: { qa: ['High', 'Low'] },
  scales: { shape: { levels: { [LEVEL]: 'square' } } },
} as unknown as GraphNode

function fixture(): Project {
  const p = createProject('P', new Date('2026-10-07T00:00:00Z'))
  const t = createTable({ tableKind: 'xy', rows: 6, columns: 3, name: 'T' })
  t.id = T
  ;['qa', 'qb', 'qn'].forEach((c, i) => {
    t.dataSets[i]!.id = id<ColumnId>(c)
  })
  for (const d of t.dataSets) d.subcolumns[0]!.values = [1, 2, 3, 4, 5, 6]
  t.x!.subcolumns[0]!.values = [1, 2, 3, 4, 5, 6]
  const u: DataTable = { ...createTable({ rows: 3, columns: 1, name: 'U' }), id: U }
  u.dataSets[0]!.id = id<ColumnId>('ua')
  const analysis = (node: NodeId, source: NodeId, analysisId: string): AnalysisNode => ({
    kind: 'analysis',
    id: node,
    name: node,
    analysisId,
    pluginVersion: 1,
    input: { source, dataSets: source === T ? ['qa', 'qb'] : ['ua'] },
    params: {},
  })
  const nodes: DocNode[] = [
    t,
    u,
    analysis(FIT, T, 'nonlinearRegression'),
    analysis(ANOVA, T, 'oneWayAnova'),
    analysis(CORR, T, 'correlation'),
    analysis(EXT, U, 'nonlinearRegression'),
    GRAPH,
  ]
  for (const n of nodes) {
    p.nodes[n.id] = n
    p.order.push(n.id)
  }
  return p
}

const DOC = fixture()

/** A graph after commands. */
const afterCommands = (commands: Command[]) =>
  produceCommands(DOC, commands)[0].nodes[G] as GraphNode | undefined

/**
 * Checks `walker` on the graph: the kinds it maps name one of `targets` before (exactly those),
 * none after; a renaming walker (`renamed`) leaves them naming the new names.
 */
function check(
  walker: Walker,
  after: GraphNode | undefined,
  targets: string[],
  renamed?: string[],
) {
  const before = graphRefs(GRAPH)
  const refs = after ? graphRefs(after) : []
  const hit = (rs: GraphRef[], list: string[]) => rs.flatMap(names).filter((n) => list.includes(n))
  for (const kind of IN_FIXTURE) {
    const expected = (EXPECT[kind] as Walker[]).includes(walker)
    const of = (rs: GraphRef[]) => rs.filter((r) => kindOf(r) === kind)
    expect(hit(of(before), targets).length > 0, `${kind} names what ${walker} maps`).toBe(expected)
    if (!expected) continue
    expect(hit(of(refs), targets), `${walker} maps every ${kind}`).toEqual([])
    if (renamed)
      expect(hit(of(refs), renamed).length, `${walker} keeps ${kind}, renamed`).toBeGreaterThan(0)
  }
}

/** Every name a reference may hold, renamed (nodes, data sets, rows). */
const NODE_MAP = new Map<NodeId, NodeId>([T, FIT, ANOVA, CORR].map((n) => [n, id(`${n}2`)]))
const KEY_MAP = new Map([
  ['qa', 'ra'],
  ['qb', 'rb'],
])
const row = (r: number) => r + 10
const OLD = [T, FIT, ANOVA, CORR, 'qa', 'qb', `#${ROW}`]
const NEW = [...NODE_MAP.values(), 'ra', 'rb', `#${row(ROW)}`]

describe('every walker of graph references handles every kind (audit 2, M12)', () => {
  it('the fixture is a valid graph naming something at every kind', () => {
    expect(GraphNodeSchema.safeParse(GRAPH).error?.issues).toBeUndefined()
    const seen = new Set(graphRefs(GRAPH).map(kindOf))
    expect([...seen].sort()).toEqual([...IN_FIXTURE].sort())
    for (const kind of KINDS.filter((k) => typeof EXPECT[k] === 'string'))
      expect(seen, kind).not.toContain(kind)
  })

  it('mapGraphRefs maps every kind', () => {
    const key = (k: string) => KEY_MAP.get(k) ?? k
    const mapped = (k: string) => {
      let out = k
      for (const [a, b] of KEY_MAP) out = out.replace(new RegExp(`\\b${a}\\b`, 'g'), b)
      return out.replace(new RegExp(`^row${ROW}:`), `row${row(ROW)}:`)
    }
    const node = (n: NodeId) => NODE_MAP.get(n) ?? n
    const after = mapGraphRefs(GRAPH, {
      source: node,
      output: (o) => ({
        ref: { node: node(o.ref.node), key: mapped(o.ref.key) },
        ...(o.colorOf !== undefined ? { colorOf: key(o.colorOf) } : {}),
      }),
      bracket: (a) => ({
        ...a,
        a: key(a.a),
        b: key(a.b),
        ...(a.group ? { group: a.group.map(key) } : {}),
        ...(a.rowA !== undefined ? { rowA: row(a.rowA) } : {}),
        ...(a.rowB !== undefined ? { rowB: row(a.rowB) } : {}),
        label:
          a.label.source === 'analysis'
            ? {
                ...a.label,
                analysis: node(a.label.analysis),
                comparison: mapped(a.label.comparison),
              }
            : a.label,
      }),
      key,
      rows: (rows) => rows.map(row),
      row,
      analysis: node,
      resultKey: mapped,
    })
    check('mapGraphRefs', after, OLD, NEW)
  })

  it('the reuse remap (remapNode) maps every kind', () => {
    const after = remapNode(GRAPH, {
      nodes: NODE_MAP,
      keys: KEY_MAP,
      rowsOf: T,
      rows: (r) => row(r),
      analysisSource: () => T,
    })
    check('remapNode', after, OLD, NEW)
  })

  it('Swap X and Y renames the data set everywhere (remapDataSetKeys)', () => {
    const after = afterCommands([
      { type: 'table.swapXY', table: T, dataSet: id('qa'), id: id('sx') },
    ])
    check('swapXY', after, ['qa'], ['sx'])
  })

  it('deleting a data set drops it everywhere (remapDataSetKeys)', () => {
    const after = afterCommands([{ type: 'table.removeDataSets', table: T, ids: [id('qa')] }])
    check('removeDataSets', after, ['qa'])
  })

  it('row inserts, deletes and reorders move every row reference (remapGraphRows)', () => {
    const inserted = afterCommands([{ type: 'table.insertRows', table: T, at: 0, count: 10 }])
    check('insertRows', inserted, [`#${ROW}`], [`#${ROW + 10}`])
    const deleted = afterCommands([{ type: 'table.deleteRows', table: T, rows: [ROW] }])
    check('deleteRows', deleted, [`#${ROW}`])
    // Row 3 first, the rows before it after it: row 3 is row 0 (the fixture names no other row).
    const permuted = afterCommands([{ type: 'table.permuteRows', table: T, order: [3, 0, 1, 2] }])
    check('permuteRows', permuted, [`#${ROW}`], ['#0'])
  })

  it('deleting analyses drops every reference to them', () => {
    const after = afterCommands([FIT, ANOVA, CORR].map((n) => ({ type: 'node.remove', id: n })))
    check('removeNode', after, [FIT, ANOVA, CORR])
  })

  it('Import from project (mergePlan) points every node reference at the copies', () => {
    const plan = mergePlan(createProject('Target'), DOC, { picked: [T] })
    const copy = plan.commands.find(
      (c): c is Extract<Command, { type: 'node.add' }> =>
        c.type === 'node.add' && c.node.id === plan.ids.get(G),
    )?.node as GraphNode
    const fresh = [T, FIT, ANOVA, CORR].map((n) => plan.ids.get(n)!)
    check('merge', copy, [T, FIT, ANOVA, CORR], fresh)
  })

  it('a method leaves out every reference to analyses of other tables', () => {
    const method = createMethod(DOC, T, { name: 'M', layouts: false })
    check('method', method.project.nodes[G] as GraphNode, [EXT])
  })

  it('node dependencies hold every node reference', () => {
    const deps = nodeDependencies(GRAPH)
    const kinds = IN_FIXTURE.filter((k) => (EXPECT[k] as Walker[]).includes('nodeDependencies'))
    for (const kind of kinds) {
      const named = graphRefs(GRAPH)
        .filter((r) => kindOf(r) === kind)
        .flatMap(names)
        .filter((n) => n in DOC.nodes)
      expect(named.length, kind).toBeGreaterThan(0)
      for (const n of named) expect(deps, `${kind}: ${n}`).toContain(n)
    }
    // The other kinds name no node.
    for (const kind of IN_FIXTURE.filter((k) => !kinds.includes(k)))
      expect(
        graphRefs(GRAPH)
          .filter((r) => kindOf(r) === kind)
          .flatMap(names)
          .filter((n) => n in DOC.nodes),
        kind,
      ).toEqual([])
  })
})
