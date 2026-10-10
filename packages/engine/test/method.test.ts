import {
  createInfoSheet,
  createProject,
  createTable,
  type DataTable,
  type GraphNode,
  type LayoutNode,
  newNodeId,
  nodeDependencies,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  applyMethod,
  clearTableValues,
  createMethod,
  DocumentStore,
  METHOD_FORMAT,
  MethodError,
  methodContents,
  methodImages,
  methodTable,
  readMethod,
  templateOf,
  writeMethod,
} from '../src/index.ts'
import { deepFamily, graph, registry } from './familyFixture.ts'
import { curves, outputsOf, POINTS } from './graphs.ts'
import { startedEngine } from './helpers.ts'

describe('templates', () => {
  it('clears every value and keeps the rest of each table', () => {
    const t = createTable({ tableKind: 'xy', rows: 3, columns: 2 })
    t.x!.subcolumns[0]!.values = [1, 2, 3]
    t.dataSets[0]!.subcolumns[0]!.values = [4, 5, 6]
    t.dataSets[0]!.subcolumns[0]!.excluded = [false, true, false]
    t.dataSets[0]!.title = 'Dose'
    t.rowTitles = ['a', 'b', 'c']
    t.notes = 'units: mM'
    const c = clearTableValues(t)
    expect(c.x!.subcolumns[0]!.values).toEqual([null, null, null])
    expect(c.dataSets[0]!.subcolumns[0]).toEqual({ type: 'number', values: [null, null, null] })
    expect(c).toMatchObject({ rowCount: 3, rowTitles: ['a', 'b', 'c'], notes: 'units: mM' })
    expect(c.dataSets[0]!.title).toBe('Dose')
    expect(t.dataSets[0]!.subcolumns[0]!.values).toEqual([4, 5, 6])
  })

  it('keeps analyses, graphs and layouts; only tables change', () => {
    const f = deepFamily()
    const doc = f.store.getState()
    const tpl = templateOf(doc)
    expect(tpl.order).toEqual(doc.order)
    for (const id of doc.order) {
      const n = tpl.nodes[id]!
      if (n.kind === 'table')
        expect(n.dataSets.flatMap((d) => d.subcolumns[0]!.values).every((v) => v === null)).toBe(
          true,
        )
      else expect(n).toBe(doc.nodes[id])
    }
  })
})

describe('methods', () => {
  it('stores a family apart from its project, and applies it to another table', async () => {
    const f = deepFamily()
    // Data from a table outside the family is left out of the method.
    const outside = graph('Mixed', f.day1.id, {
      layers: [POINTS, curves([{ id: 's1' as never, ref: { node: f.other.id, key: 'x' } }])],
    })
    f.store.dispatch({ type: 'node.add', node: outside })
    const m = createMethod(f.store.getState(), f.day1.id, {
      name: 'Dose response',
      layouts: true,
      now: new Date('2026-10-01T00:00:00Z'),
    })
    expect(methodContents(m)).toEqual({ analysis: 4, graph: 3, layout: 1 })
    expect(methodTable(m).dataSets.map((d) => d.title)).toEqual(['Group A', 'Group B', 'Group C'])
    expect(methodTable(m).dataSets[0]!.subcolumns[0]!.values).toEqual([null, null, null, null])
    for (const n of Object.values(m.project.nodes))
      for (const r of nodeDependencies(n))
        expect(m.project.nodes[r], `${n.name} → ${r}`).toBeDefined()

    // Written, read back unchanged.
    const text = writeMethod(m)
    expect(JSON.parse(text)).toMatchObject({
      format: METHOD_FORMAT,
      version: 1,
      name: 'Dose response',
    })
    const back = readMethod(text)
    expect(back).toEqual(m)

    // Applied to a new table in a fresh project.
    const g = deepFamily()
    const target = createTable({ name: 'Plate 7', rows: 4, columns: 3 })
    target.dataSets.forEach((d, i) => {
      d.subcolumns[0]!.values = [i, i, i, i]
    })
    g.store.dispatch({ type: 'node.add', node: target })
    const engine = await startedEngine(g.store, registry)
    const plan = applyMethod(back, g.store.getState(), [target.id], { match: 'position' })
    expect(plan.warnings).toEqual([])
    g.store.dispatch(plan.commands, 'Apply method')
    await engine.idle()
    const made = plan.created[0]!.nodes.map((id) => g.store.getState().nodes[id]!)
    expect(made.map((n) => n.name)).toEqual([
      'Scale of Plate 7',
      'Sum of Scale of Plate 7',
      'Sum of Plate 7',
      'Expected of Plate 7',
      'Plate 7',
      'Scale of Plate 7',
      'Figure Plate 7',
      'Mixed',
    ])
    const mixed = made.find((n) => n.name === 'Mixed') as GraphNode
    expect(outputsOf(mixed)).toEqual([])
    // Its curves layer, left without curves, goes with them.
    expect(mixed.layers.map((l) => l.id)).toEqual(['points'])
    const sum = made.find((n) => n.name === 'Sum of Plate 7')!
    expect(engine.latest(sum.id)?.values).toMatchObject({
      'Group A': { v: 0 },
      'Group B': { v: 4 },
      'Group C': { v: 16 },
    })
  })

  it('leaves images on its pages out', () => {
    const f = deepFamily()
    const page = f.store.getState().nodes[f.whole.id] as LayoutNode
    f.store.dispatch({
      type: 'node.set',
      id: f.whole.id,
      path: ['items'],
      value: [
        ...page.items,
        { type: 'image', id: 'im1', asset: 'b'.repeat(32), x: 0, y: 0, w: 5, h: 5 },
      ],
    })
    const doc = f.store.getState()
    expect(methodImages(doc, f.day1.id, true)).toBe(1)
    expect(methodImages(doc, f.day1.id, false)).toBe(0)
    const m = createMethod(doc, f.day1.id, { name: 'M', layouts: true })
    const kept = m.project.nodes[f.whole.id] as LayoutNode
    expect(kept.items.map((it) => it.type)).toEqual(['graph', 'graph', 'text'])
  })

  it('refuses what is not a valid method file', () => {
    const f = deepFamily()
    const m = createMethod(f.store.getState(), f.day1.id, { name: 'M', layouts: false })
    const file = JSON.parse(writeMethod(m))
    const read = (v: unknown) => () => readMethod(typeof v === 'string' ? v : JSON.stringify(v))
    expect(read('{')).toThrow(MethodError)
    expect(read({ ...file, format: 'other' })).toThrow('Not a method file.')
    expect(read({ ...file, version: 2 })).toThrow(/newer version/)
    expect(read({ ...file, name: '' })).toThrow(/Invalid method file/)
    expect(read({ ...file, table: 'missing' })).toThrow(/its table is missing/)
    expect(read({ ...file, project: { ...file.project, schemaVersion: 99 } })).toThrow(
      /newer version/,
    )
    // A broken reference inside.
    const nodes = { ...file.project.nodes }
    const scale = nodes[f.scale.id]
    nodes[f.scale.id] = { ...scale, input: { ...scale.input, source: 'nowhere' } }
    expect(read({ ...file, project: { ...file.project, nodes } })).toThrow(/missing node/)
    // A table breaking its invariants.
    const t = nodes[f.day1.id] as DataTable
    nodes[f.day1.id] = { ...t, rowCount: 9 }
    expect(read({ ...file, project: { ...file.project, nodes } })).toThrow(MethodError)
  })
})

describe('methods and info sheets (audit 2, M5)', () => {
  it('hold the info sheets their table’s formulas read, and nothing else of the project', () => {
    const t = createTable({ name: 'Calc', tableKind: 'multipleVariables', columns: 2, rows: 2 })
    t.dataSets[1]!.formula = '=[Info: k] * 2'
    const sheet = (name: string) => ({
      ...createInfoSheet(newNodeId(), name),
      fields: [{ label: name === 'Read' ? 'k' : 'z', value: '3' }],
    })
    const [unused, read] = [sheet('Unused'), sheet('Read')]
    const store = new DocumentStore(createProject())
    for (const node of [unused, read, t]) store.dispatch({ type: 'node.add', node })
    const m = createMethod(store.getState(), t.id, { name: 'M', layouts: false })
    expect(m.project.order).toEqual([read.id, t.id])
    expect(m.project.nodes[read.id]).toEqual(read)
    expect(methodContents(m)).toEqual({ analysis: 0, graph: 0, layout: 0 })
    expect(readMethod(writeMethod(m)).project.nodes[read.id]).toEqual(read)
  })
})
