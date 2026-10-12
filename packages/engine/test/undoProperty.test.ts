import {
  type AnalysisNode,
  type ColumnId,
  createInfoSheet,
  createProject,
  createTable,
  type DataTable,
  DEFAULT_LIMIT_RULE,
  type DocNode,
  type FolderId,
  type GraphNode,
  type GraphPathSegment,
  type Layer,
  type LayoutNode,
  type NodeId,
  type Project,
} from '@ps/model'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  BIG_ARRAY,
  COMMAND_TYPES,
  type Command,
  CommandError,
  type CommandType,
  DocumentStore,
} from '../src/index.ts'
import { POINTS, testGraph } from './graphs.ts'

// Audit 2 (M11): undo and redo over every command kind. Random sequences of commands (of every
// type in `COMMAND_TYPES`: a new command fails the coverage check until it has a generator here),
// alone or in batches, with undo and redo between them, on a project holding every kind of node
// and a table of more than `BIG_ARRAY` rows (its row inserts and deletes are compact row patches,
// decision 670). After each undo or redo the document is exactly the one it was at that point;
// undone to the start it is the start, redone it is the end. With a small history, the steps
// trimmed are the oldest: undoing all that is left reaches the document of the oldest step kept.

const id = <T extends string>(s: string) => s as T
const T = id<NodeId>('ttable')
const B = id<NodeId>('btable')
const V = id<NodeId>('vtable')
const I = id<NodeId>('info')
const A = id<NodeId>('analysis')
const G = id<NodeId>('graph')
const L = id<NodeId>('layout')
const NEW = [id<NodeId>('new1'), id<NodeId>('new2'), id<NodeId>('new3')]
const BIG = BIG_ARRAY + 4

const layer = (layerId: string, geom: 'points' | 'line' = 'points'): Layer =>
  ({ id: layerId, geom, stat: { kind: 'identity' } }) as Layer

const col = (s: string) => id<ColumnId>(s)
/** Data set ids by table (with ids the commands may add). */
const COLS: Record<string, ColumnId[]> = {
  [T]: [col('ta'), col('tb'), col('sx1'), col('nd1')],
  [B]: [col('ba'), col('bb'), col('nd1')],
  [V]: [col('vn'), col('vt'), col('vf'), col('nd2')],
}
const TABLES = [T, B, V, NEW[1]!]
const NODES = [T, B, V, I, A, G, L, ...NEW]
const FOLDERS = [id<FolderId>('fa'), id<FolderId>('fb'), id<FolderId>('fc')]

function withIds(t: DataTable, tableId: NodeId, ids: ColumnId[]): DataTable {
  t.id = tableId
  t.dataSets.forEach((d, i) => {
    d.id = ids[i]!
  })
  return t
}

/** A project of every kind of node: an XY table, a large column table, a table of variables… */
function fixture(): Project {
  const p = createProject('P', new Date('2026-10-07T00:00:00Z'))
  const xy = withIds(createTable({ tableKind: 'xy', rows: 6, columns: 2, name: 'XY' }), T, [
    col('ta'),
    col('tb'),
  ])
  xy.x!.subcolumns[0]!.values = [1, 2, 3, 4, 5, 6]
  xy.dataSets[0]!.subcolumns[0]!.values = [1, null, 3, 4, 5, 6]
  xy.dataSets[1]!.subcolumns[0]!.values = [6, 5, 4, null, 2, 1]
  xy.rowTitles = ['a', 'b', null, 'd', 'e', 'f']
  const big = withIds(createTable({ rows: BIG, columns: 2, name: 'Big' }), B, [
    col('ba'),
    col('bb'),
  ])
  big.dataSets[0]!.subcolumns[0]!.values = Array.from({ length: BIG }, (_, r) => r)
  big.dataSets[1]!.subcolumns[0]!.values = Array.from({ length: BIG }, (_, r) =>
    r % 3 ? r / 7 : null,
  )
  const vars = withIds(
    createTable({ tableKind: 'multipleVariables', rows: 5, columns: 3, name: 'Vars' }),
    V,
    [col('vn'), col('vt'), col('vf')],
  )
  vars.dataSets[0]!.title = 'vn'
  vars.dataSets[0]!.subcolumns[0]!.values = [1, 2, 3, null, 5]
  vars.dataSets[1]!.title = 'vt'
  vars.dataSets[1]!.text = ['x', 'y', null, 'x', '7']
  vars.dataSets[2]!.title = 'vf'
  vars.dataSets[2]!.formula = '=vn*2'
  const info = createInfoSheet(I, 'Info')
  info.fields = [
    { label: 'k', value: '2' },
    { label: 'note', value: 'text' },
  ]
  const analysis: AnalysisNode = {
    kind: 'analysis',
    id: A,
    name: 'Stats',
    analysisId: 'descriptive',
    pluginVersion: 1,
    input: { source: T, dataSets: ['ta', 'tb'] },
    params: {},
  }
  const graph: GraphNode = {
    ...testGraph(T, {
      layers: [POINTS, layer('line1', 'line')],
      seriesSource: { table: T, include: ['ta', 'tb'], rows: [0, 2, 4] },
      pointOverrides: { ta: { r1s0: { size: 3 } } },
    }),
    id: G,
    name: 'Graph',
  }
  const layout: LayoutNode = {
    kind: 'layout',
    id: L,
    name: 'Page',
    page: { width: 612, height: 792 },
    items: [{ type: 'graph', id: id('item1'), graph: G, x: 0, y: 0, scale: 1 }],
    panelLabels: { show: true, style: 'A', size: 14 },
  }
  for (const n of [xy, big, vars, info, analysis, graph, layout] as DocNode[]) {
    p.nodes[n.id] = n
    p.order.push(n.id)
  }
  p.folders = [
    { id: FOLDERS[0]!, name: 'Folder', members: [T] },
    { id: FOLDERS[1]!, name: 'Other', members: [] },
  ]
  return p
}

const FIXTURE = fixture()

// Values the generators draw from.
const text = fc.string({ maxLength: 4 })
const cell = fc.oneof(
  fc.constant(null),
  fc.constant(-0),
  fc.integer({ min: -5, max: 5 }),
  fc.double({ noNaN: true, noDefaultInfinity: true }),
)
/** A table (the one `node.add` adds less often: it is there only after that). */
const table = fc.oneof(
  { weight: 3, arbitrary: fc.constantFrom(T, B, V) },
  { weight: 1, arbitrary: fc.constantFrom(...TABLES) },
)
const node = fc.constantFrom(...NODES)
const folder = fc.constantFrom(...FOLDERS)
const anyCol = fc.constantFrom(...new Set(Object.values(COLS).flat()))
const tableAndCol = table.chain((t) =>
  fc.record({ t: fc.constant(t), c: fc.constantFrom(...(COLS[t] ?? [col('ta')])) }),
)
/** A row: small, or around the end of the large table. */
const row = fc.oneof(
  { weight: 4, arbitrary: fc.nat(7) },
  { weight: 1, arbitrary: fc.integer({ min: BIG - 2, max: BIG + 1 }) },
)
/** A subcolumn: mostly the first (most tables have one). */
const subcolumn = fc.oneof({ weight: 4, arbitrary: fc.constant(0) }, fc.constant(1))
const rich = (s: string) => [{ text: s, italic: true }]
const titled = text.chain((title) =>
  fc.record({
    title: fc.constant(title),
    rich: fc.option(fc.constant(rich(title)), { nil: undefined }),
  }),
)
const LAYERS = ['points', 'pts2', 'line1']
const someLayer = fc.constantFrom(POINTS, layer('pts2'), layer('line1', 'line'), {
  ...layer('lbl1'),
  geom: 'label',
  on: 'points',
} as unknown as Layer)
const permutation = fc.integer({ min: 0, max: 5 }).chain((n) =>
  fc.shuffledSubarray(
    Array.from({ length: n }, (_, i) => i),
    { minLength: n, maxLength: n },
  ),
)

// Nodes for node.add and node.replace.
const addable: DocNode[] = [
  createInfoSheet(NEW[0]!, 'New info'),
  withIds(createTable({ rows: 3, columns: 2, name: 'New table' }), NEW[1]!, [col('na'), col('nb')]),
  { ...testGraph(T), id: NEW[2]!, name: 'New graph' },
]
const replacements: DocNode[] = [
  { ...(FIXTURE.nodes[T] as DataTable), name: 'XY replaced', notes: 'n' },
  { ...(FIXTURE.nodes[G] as GraphNode), layers: [POINTS, layer('line1', 'line')] },
  { ...(FIXTURE.nodes[A] as AnalysisNode), input: { source: V, dataSets: ['vn'] } },
  { ...(FIXTURE.nodes[I] as DocNode), name: 'Info 2' } as DocNode,
]

type Gen<K extends CommandType> = fc.Arbitrary<Extract<Command, { type: K }>>

/** A generator of every command type (the record's type makes a new one a type error here). */
const GENERATORS: { [K in CommandType]: Gen<K> } = {
  'project.setSettings': fc.record(
    {
      type: fc.constant('project.setSettings'),
      settings: fc.record(
        {
          pValueStyle: fc.constantFrom('GP' as const, 'APA' as const, 'NEJM' as const),
          pValueDigits: fc.integer({ min: 0, max: 16 }),
          theme: fc.constantFrom('default', 'journal-nature'),
        },
        { requiredKeys: [] },
      ),
      clear: fc.constant(['style'] as const),
    },
    { requiredKeys: ['type', 'settings'] },
  ) as Gen<'project.setSettings'>,
  'node.add': fc.record(
    {
      type: fc.constant('node.add'),
      node: fc.constantFrom(...addable),
      at: fc.nat(9),
      fresh: fc.boolean(),
      folder: fc.option(folder, { nil: null }),
    },
    { requiredKeys: ['type', 'node'] },
  ),
  'node.remove': fc.record({ type: fc.constant('node.remove'), id: node }),
  'node.rename': fc.record({ type: fc.constant('node.rename'), id: node, name: text }),
  'node.move': fc.record({ type: fc.constant('node.move'), id: node, to: fc.nat(10) }),
  'node.replace': fc.record({
    type: fc.constant('node.replace'),
    node: fc.constantFrom(...replacements),
  }),
  'folder.add': fc.record(
    {
      type: fc.constant('folder.add'),
      folder: fc.record(
        { id: folder, name: text, parent: folder },
        { requiredKeys: ['id', 'name'] },
      ),
      at: fc.nat(3),
      members: fc.subarray(NODES, { maxLength: 3 }),
    },
    { requiredKeys: ['type', 'folder'] },
  ),
  'folder.rename': fc.record({ type: fc.constant('folder.rename'), id: folder, name: text }),
  'folder.remove': fc.record({ type: fc.constant('folder.remove'), id: folder }),
  'folder.move': fc.record(
    {
      type: fc.constant('folder.move'),
      id: folder,
      parent: fc.option(folder, { nil: null }),
      at: fc.nat(3),
    },
    { requiredKeys: ['type', 'id', 'parent'] },
  ),
  'folder.file': fc.record({
    type: fc.constant('folder.file'),
    ids: fc.subarray(NODES.slice(0, 7), { minLength: 1, maxLength: 2 }),
    folder: fc.option(fc.constantFrom(...FOLDERS.slice(0, 2)), { nil: null }),
  }),
  'info.setField': fc.record(
    {
      type: fc.constant('info.setField'),
      id: fc.constantFrom(I, NEW[0]!),
      index: fc.nat(2),
      label: fc.constantFrom('k', 'k2', 'note', ''),
      value: fc.constantFrom('3', 'x', ''),
    },
    { requiredKeys: ['type', 'id', 'index'] },
  ),
  'info.setFields': fc.record({
    type: fc.constant('info.setFields'),
    id: fc.constantFrom(I, NEW[0]!),
    fields: fc.array(fc.record({ label: text, value: text }), { maxLength: 3 }),
  }),
  'info.setNotes': text.chain((notes) =>
    fc.record(
      {
        type: fc.constant('info.setNotes' as const),
        id: fc.constantFrom(I, NEW[0]!),
        notes: fc.constant(notes),
        rich: fc.constant(rich(notes)),
      },
      { requiredKeys: ['type', 'id', 'notes'] },
    ),
  ),
  'table.setCells': tableAndCol.chain(({ t, c }) =>
    fc.record({
      type: fc.constant('table.setCells' as const),
      table: fc.constant(t),
      edits: fc.array(
        fc.record({
          col: fc.oneof(
            { weight: 3, arbitrary: fc.constant(c) },
            fc.constant('x' as const),
            anyCol,
          ),
          sub: subcolumn,
          row,
          value: cell,
        }),
        { minLength: 1, maxLength: 3 },
      ),
    }),
  ),
  'table.setText': fc.record({
    type: fc.constant('table.setText'),
    table: fc.constant(V),
    edits: fc.array(
      fc.record({
        col: fc.constantFrom(col('vt'), col('vn')),
        row: fc.nat(6),
        value: fc.option(fc.constantFrom('x', 'z', '4', ' '), { nil: null }),
      }),
      { minLength: 1, maxLength: 3 },
    ),
  }),
  'table.setVariableType': fc.record({
    type: fc.constant('table.setVariableType'),
    table: fc.constantFrom(V, T),
    ids: fc.subarray(COLS[V]!, { minLength: 1 }),
    to: fc.constantFrom('number' as const, 'text' as const),
  }),
  'table.setFormula': fc.record({
    type: fc.constant('table.setFormula'),
    table: fc.constant(V),
    id: fc.constantFrom(...COLS[V]!),
    formula: fc.constantFrom(null, '=vn+1', 'vn*[Info: k]', '=vn*', '=vt'),
  }),
  'table.setExcluded': tableAndCol.chain(({ t, c }) =>
    fc.record({
      type: fc.constant('table.setExcluded' as const),
      table: fc.constant(t),
      cells: fc.array(
        fc.record({
          col: fc.oneof({ weight: 5, arbitrary: fc.constant(c) }, fc.constant('x' as const)),
          sub: subcolumn,
          row: fc.oneof({ weight: 6, arbitrary: fc.nat(4) }, row),
        }),
        { minLength: 1, maxLength: 2 },
      ),
      excluded: fc.boolean(),
    }),
  ),
  'table.setLimits': fc.record({
    type: fc.constant('table.setLimits'),
    table,
    rule: fc.constantFrom(null, DEFAULT_LIMIT_RULE, {
      below: { method: 'fixed' as const, value: 0.5 },
      above: { method: 'blank' as const },
    }),
  }),
  'table.insertRows': fc.record({
    type: fc.constant('table.insertRows'),
    table,
    at: fc.oneof(fc.nat(6), fc.constantFrom(0, BIG - 1, BIG)),
    count: fc.nat(3),
  }),
  'table.deleteRows': fc.record({
    type: fc.constant('table.deleteRows'),
    table,
    rows: fc.array(row, { maxLength: 3 }),
  }),
  'table.setRowTitle': fc.record(
    {
      type: fc.constant('table.setRowTitle'),
      table,
      row,
      title: fc.option(fc.constantFrom('r', 'row 2'), { nil: null }),
      rich: fc.constant(rich('r')),
    },
    { requiredKeys: ['type', 'table', 'row', 'title'] },
  ),
  'table.showRowTitles': fc.record({
    type: fc.constant('table.showRowTitles'),
    table,
    show: fc.boolean(),
  }),
  'table.setCellsTable': fc.record({
    type: fc.constant('table.setCellsTable'),
    table,
    on: fc.constantFrom(true, false, null),
  }),
  'table.addDataSet': fc.record(
    {
      type: fc.constant('table.addDataSet'),
      table,
      id: fc.constantFrom(col('nd1'), col('nd2')),
      at: fc.nat(3),
      title: text,
    },
    { requiredKeys: ['type', 'table', 'id'] },
  ),
  'table.removeDataSets': tableAndCol.map(
    ({ t, c }): Extract<Command, { type: 'table.removeDataSets' }> => ({
      type: 'table.removeDataSets',
      table: t,
      ids: [c],
    }),
  ),
  'table.swapXY': fc.record({
    type: fc.constant('table.swapXY'),
    table: fc.constantFrom(T, B),
    dataSet: fc.constantFrom(col('ta'), col('tb'), col('sx1')),
    id: fc.constantFrom(col('sx1'), col('sx2')),
  }),
  'table.renameDataSet': tableAndCol.chain(({ t, c }) =>
    titled.map(({ title, rich }) => ({
      type: 'table.renameDataSet' as const,
      table: t,
      id: c,
      title,
      ...(rich ? { rich } : {}),
    })),
  ),
  'table.renameX': fc.tuple(table, titled).map(([t, { title, rich }]) => ({
    type: 'table.renameX' as const,
    table: t,
    title,
    ...(rich ? { rich } : {}),
  })),
  'table.moveDataSets': table.chain((t) =>
    fc.record({
      type: fc.constant('table.moveDataSets' as const),
      table: fc.constant(t),
      ids: fc.subarray(COLS[t] ?? [col('na')], { minLength: 1 }),
      to: fc.nat(3),
    }),
  ),
  'table.permuteRows': fc.record({
    type: fc.constant('table.permuteRows'),
    table,
    order: permutation,
  }),
  'table.setDisplay': tableAndCol.chain(({ t, c }) =>
    fc.record({
      type: fc.constant('table.setDisplay' as const),
      table: fc.constant(t),
      cols: fc.subarray([c, 'x' as const], { minLength: 1 }),
      display: fc.constantFrom(null, { mode: 'fixed' as const, digits: 2 }),
    }),
  ),
  'table.setColumnWidths': fc.record({
    type: fc.constant('table.setColumnWidths'),
    table,
    widths: fc.dictionary(
      fc.constantFrom('x', 'rowTitle', 'ta', 'vn'),
      fc.option(fc.integer({ min: 0, max: 2000 }), { nil: null }),
      { maxKeys: 2 },
    ),
  }),
  'table.setSubcolumnTitle': tableAndCol.chain(({ t, c }) =>
    fc.record(
      {
        type: fc.constant('table.setSubcolumnTitle' as const),
        table: fc.constant(t),
        id: fc.constant(c),
        sub: fc.nat(2),
        title: fc.option(fc.constantFrom('s1', 'r'), { nil: null }),
        rich: fc.constant(rich('r')),
      },
      { requiredKeys: ['type', 'table', 'id', 'sub', 'title'] },
    ),
  ),
  'table.setReplicateCount': fc.record({
    type: fc.constant('table.setReplicateCount'),
    table,
    count: fc.nat(3),
  }),
  'table.setYFormat': fc.record({
    type: fc.constant('table.setYFormat'),
    table,
    format: fc.constantFrom(
      { type: 'replicates' as const, count: 1 },
      { type: 'replicates' as const, count: 2 },
      { type: 'summary' as const, preset: 'meanSdN' as const },
      { type: 'summary' as const, preset: 'meanSem' as const },
    ),
  }),
  'analysis.setParams': fc.record({
    type: fc.constant('analysis.setParams'),
    id: fc.constantFrom(A, G),
    params: fc.constantFrom({}, { alpha: 0.05 }, { groups: [['ta', 'tb']], label: null }),
  }),
  'analysis.setInput': fc.record({
    type: fc.constant('analysis.setInput'),
    id: fc.constantFrom(A, G),
    dataSets: fc.subarray(['ta', 'tb', 'vn']),
  }),
  'analysis.recordChange': fc.record({
    type: fc.constant('analysis.recordChange'),
    id: fc.constantFrom(A, G),
    change: fc.record({
      at: fc.constant('2026-10-12T10:00:00.000Z'),
      from: fc.record({
        analysisId: fc.constantFrom('ttest', 'mannWhitney'),
        pluginVersion: fc.constantFrom(1, 2),
        params: fc.constantFrom({}, { tails: 'one' }),
        dataSets: fc.subarray(['ta', 'tb']),
      }),
      changes: fc.subarray(['P value: Two-tailed → One-tailed', 'Analysis: t test → Mann-Whitney']),
      afterResults: fc.boolean(),
      reason: fc.option(fc.constantFrom('wrong design', ''), { nil: undefined }),
    }),
  }),
  'node.set': fc.oneof(
    fc.record({
      type: fc.constant('node.set' as const),
      id: fc.constantFrom(G, NEW[2]!),
      path: fc.constantFrom<GraphPathSegment[]>(
        ['legend', 'show'],
        ['seriesOverrides', 'ta', 'color'],
        ['layers', { id: 'points' }, 'series'],
        ['size', 'plotWidth'],
        ['axes', 'y', 'range'],
      ),
      value: fc.constantFrom(undefined, true, 3, { palette: 2 }, { ta: { hide: true } }, 'auto'),
    }),
    fc.record({
      type: fc.constant('node.set' as const),
      id: fc.constantFrom(T, L, A),
      path: fc.constantFrom<GraphPathSegment[]>(
        ['notes'],
        ['name'],
        ['params', 'alpha'],
        ['items', 0, 'x'],
      ),
      value: fc.constantFrom(undefined, 'n', 0.1, 12),
    }),
  ),
  'graph.addLayer': fc.record(
    {
      type: fc.constant('graph.addLayer'),
      id: fc.constantFrom(G, NEW[2]!),
      layer: someLayer,
      at: fc.nat(3),
    },
    { requiredKeys: ['type', 'id', 'layer'] },
  ),
  'graph.removeLayer': fc.record({
    type: fc.constant('graph.removeLayer'),
    id: fc.constantFrom(G, NEW[2]!),
    layer: fc.constantFrom(...LAYERS),
  }),
  'graph.moveLayer': fc.record({
    type: fc.constant('graph.moveLayer'),
    id: fc.constantFrom(G, NEW[2]!),
    layer: fc.constantFrom(...LAYERS),
    to: fc.nat(3),
  }),
  'graph.setLayers': fc.record(
    {
      type: fc.constant('graph.setLayers'),
      id: fc.constantFrom(G, NEW[2]!),
      layers: fc.uniqueArray(someLayer, { maxLength: 3, selector: (l) => l.id }),
      look: fc.constantFrom('column.scatter' as const, 'column.bar' as const),
    },
    { requiredKeys: ['type', 'id', 'layers'] },
  ),
}

const anyCommand = fc.oneof(...COMMAND_TYPES.map((t) => GENERATORS[t] as fc.Arbitrary<Command>))

type Action = { kind: 'dispatch'; commands: Command[] } | { kind: 'undo' } | { kind: 'redo' }

const action: fc.Arbitrary<Action> = fc.oneof(
  { weight: 6, arbitrary: anyCommand.map((c) => ({ kind: 'dispatch' as const, commands: [c] })) },
  {
    weight: 1,
    arbitrary: fc
      .array(anyCommand, { minLength: 2, maxLength: 3 })
      .map((commands) => ({ kind: 'dispatch' as const, commands })),
  },
  { weight: 2, arbitrary: fc.constant({ kind: 'undo' as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: 'redo' as const }) },
)

/**
 * Runs `actions` on a store over the fixture, checking every undo and redo against the documents
 * seen; then undoes everything left and redoes it all. Counts the command types applied.
 */
function run(actions: Action[], history: { steps?: number; cells?: number }, applied: Set<string>) {
  const store = new DocumentStore(FIXTURE, history)
  const trims = history.steps !== undefined || history.cells !== undefined
  // The documents of the steps (index 0: the start) and the one shown.
  let states: Project[] = [store.getState()]
  let at = 0
  /** The oldest document undo can still reach. */
  const floor = () => at - store.historyLength.undo
  for (const a of actions) {
    if (a.kind === 'dispatch') {
      const before = store.getState()
      try {
        store.dispatch(a.commands)
      } catch (e) {
        if (!(e instanceof CommandError)) throw e
        // Refused: nothing changes.
        expect(store.getState()).toBe(before)
        continue
      }
      if (store.getState() === before) continue
      for (const c of a.commands) applied.add(c.type)
      states = [...states.slice(0, at + 1), store.getState()]
      at++
      if (!trims) expect(store.historyLength.undo).toBe(at)
      expect(store.historyLength.redo).toBe(0)
    } else if (a.kind === 'undo') {
      const can = at > floor()
      expect(store.undo()).toBe(can)
      if (!can) continue
      at--
      expect(store.getState()).toStrictEqual(states[at])
    } else {
      const can = at < states.length - 1
      expect(store.redo()).toBe(can)
      if (!can) continue
      at++
      expect(store.getState()).toStrictEqual(states[at])
    }
  }
  // Everything left undone: the start (or, with a trimmed history, the oldest step kept).
  const oldest = floor()
  expect(oldest).toBeGreaterThanOrEqual(0)
  if (!trims) expect(oldest).toBe(0)
  while (store.undo()) at--
  expect(at).toBe(oldest)
  expect(store.getState()).toStrictEqual(states[oldest])
  if (oldest === 0) expect(store.getState()).toStrictEqual(FIXTURE)
  // And all redone: the end.
  while (store.redo()) at++
  expect(at).toBe(states.length - 1)
  expect(store.getState()).toStrictEqual(states.at(-1))
}

describe('undo and redo over every command (audit 2, M11)', () => {
  it('the fixture is a valid project of every kind of node, with a large table', () => {
    const kinds = new Set(Object.values(FIXTURE.nodes).map((n) => n.kind))
    expect([...kinds].sort()).toEqual(['analysis', 'graph', 'info', 'layout', 'table'])
    // Valid as the store sees it (an edit of every node goes through).
    const store = new DocumentStore(FIXTURE)
    store.dispatch(NODES.slice(0, 7).map((n) => ({ type: 'node.rename', id: n, name: 'n' })))
    expect((FIXTURE.nodes[B] as DataTable).rowCount).toBeGreaterThan(BIG_ARRAY)
  })

  it('every command type has a generator', () => {
    expect(Object.keys(GENERATORS).sort()).toEqual([...COMMAND_TYPES].sort())
  })

  it('undone and redone step by step, then all the way: exactly the documents seen', () => {
    const applied = new Set<string>()
    fc.assert(
      fc.property(fc.array(action, { minLength: 1, maxLength: 40 }), (actions) => {
        run(actions, {}, applied)
      }),
      { numRuns: 500 },
    )
    // Every command type changed the document at least once (then was undone and redone).
    expect(COMMAND_TYPES.filter((t) => !applied.has(t))).toEqual([])
  }, 120_000)

  it('a trimmed history undoes back to its oldest step kept', () => {
    const applied = new Set<string>()
    const history = fc.oneof(
      fc.record({ steps: fc.integer({ min: 1, max: 4 }) }),
      // A bound by values held: a step of the large table holds more than the rest together.
      fc.record({ cells: fc.integer({ min: 1, max: 3 * BIG }) }),
    )
    fc.assert(
      fc.property(history, fc.array(action, { minLength: 1, maxLength: 30 }), (h, actions) => {
        run(actions, h, applied)
      }),
      { numRuns: 120 },
    )
    expect(applied.size).toBeGreaterThan(COMMAND_TYPES.length / 2)
  }, 120_000)

  it('row inserts and deletes of the large table keep only the rows (compact patches)', () => {
    const store = new DocumentStore(FIXTURE)
    store.dispatch({ type: 'table.insertRows', table: B, at: 5, count: 2 })
    store.dispatch({ type: 'table.deleteRows', table: B, rows: [0, BIG] })
    store.dispatch({
      type: 'table.setCells',
      table: B,
      edits: [{ col: col('ba'), sub: 0, row: BIG + 3, value: 1 }],
    })
    // Each step holds a few values, not the table's columns.
    const steps = (store as unknown as { undoStack: { cells: number }[] }).undoStack
    for (const s of steps) expect(s.cells).toBeLessThan(100)
    const end = store.getState()
    while (store.undo());
    expect(store.getState()).toStrictEqual(FIXTURE)
    while (store.redo());
    expect(store.getState()).toStrictEqual(end)
  })
})
