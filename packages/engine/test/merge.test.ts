import {
  type AssetId,
  builtinStyle,
  createInfoSheet,
  createProject,
  createTable,
  type DataTable,
  type DocNode,
  type FolderId,
  type GraphNode,
  graphRefs,
  infoConstants,
  type LayoutNode,
  type NodeId,
  newLayoutItemId,
  newNodeId,
  nodeDependencies,
  type Project,
  projectIssues,
  tableFormulas,
  withConstants,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { DocumentStore, mergePlan, mergeSelection, removalWarnings } from '../src/index.ts'
import { deepFamily, graph, registry } from './familyFixture.ts'
import { startedEngine } from './helpers.ts'

// Roadmap 40: File › Import from project… — sheets of another project with new ids and every
// reference remapped, names made unique, styles, images, info sheets and folders brought along.

const ASSET = '0123456789abcdef0123456789abcdef' as AssetId

/** The reuse fixture as the other project: a journal style, a folder, an image, an info sheet. */
function source() {
  const f = deepFamily()
  const nature = builtinStyle('journal-nature')!
  const sheet = {
    ...createInfoSheet(newNodeId(), 'Experiment'),
    fields: [{ label: 'k', value: '2' }],
  }
  const formulas = createTable({ name: 'Formulas', tableKind: 'multipleVariables', columns: 2 })
  formulas.dataSets[1]!.formula = '=[Experiment: k] * 2'
  f.store.dispatch([
    { type: 'project.setSettings', settings: { theme: nature.id, style: nature.style } },
    { type: 'node.add', node: sheet },
    { type: 'node.add', node: formulas },
    { type: 'folder.add', folder: { id: 'exp' as FolderId, name: 'Experiment 1' } },
    { type: 'folder.file', ids: [f.day1.id, f.g1.id, f.whole.id], folder: 'exp' as FolderId },
  ])
  const page = f.store.getState().nodes[f.whole.id] as LayoutNode
  f.store.dispatch({
    type: 'node.replace',
    node: {
      ...page,
      items: [
        ...page.items,
        { type: 'image', id: newLayoutItemId(), asset: ASSET, x: 0, y: 0, w: 10, h: 10 },
      ],
    },
  })
  return { ...f, sheet, formulas, doc: f.store.getState() }
}

/** This project: a table and a graph named "Day 1", an info sheet named "Experiment". */
function target(): Project {
  const p = createProject('Target')
  const t = createTable({ name: 'Day 1' })
  const nodes: DocNode[] = [
    t,
    graph('Day 1', t.id),
    { ...createInfoSheet(newNodeId(), 'Experiment'), fields: [{ label: 'k', value: '5' }] },
  ]
  for (const n of nodes) {
    p.nodes[n.id] = n
    p.order.push(n.id)
  }
  p.folders = [{ id: 'mine' as FolderId, name: 'Experiment 1', members: [] }]
  return p
}

describe('mergeSelection', () => {
  it('brings a table’s family, a page’s graphs, and what they need', () => {
    const s = source()
    const withFamily = mergeSelection(s.doc, [s.day1.id], true)
    expect(withFamily).toEqual([
      s.day1.id,
      s.scale.id,
      s.sumOfScale.id,
      s.sum.id,
      s.gof.id,
      s.g1.id,
      s.g2.id,
    ])
    expect(mergeSelection(s.doc, [s.day1.id], false)).toEqual([s.day1.id])
    // A page brings its graphs and their tables and analyses (not the unused gof).
    expect(mergeSelection(s.doc, [s.whole.id], false)).toEqual([
      s.day1.id,
      s.scale.id,
      s.sumOfScale.id,
      s.sum.id,
      s.g1.id,
      s.g2.id,
      s.whole.id,
    ])
    // Whatever is brought, every reference stays inside.
    for (const picked of [[s.g2.id], [s.mixed.id], [s.sumOfScale.id]]) {
      const set = new Set(mergeSelection(s.doc, picked, false))
      for (const id of set)
        for (const dep of nodeDependencies(s.doc.nodes[id]!)) expect(set).toContain(dep)
    }
  })
})

describe('mergePlan', () => {
  it('adds copies with new ids and references remapped, in one undo step', async () => {
    const s = source()
    const store = new DocumentStore(target())
    const before = store.getState()
    const plan = mergePlan(before, s.doc, {
      picked: [s.whole.id, s.sheet.id, s.formulas.id],
      withFamily: true,
    })
    store.dispatch(plan.commands, 'Import from project')
    const doc = store.getState()
    expect(projectIssues(doc)).toEqual([])
    const copies = plan.created.map((id) => doc.nodes[id]!)
    // New ids only; every reference of a copy points at a copy.
    const inside = new Set<NodeId>(plan.created)
    for (const id of plan.created) expect(s.doc.nodes[id]).toBeUndefined()
    for (const n of copies) for (const dep of nodeDependencies(n)) expect(inside).toContain(dep)
    const g1 = doc.nodes[plan.ids.get(s.g1.id)!] as GraphNode
    const refs = graphRefs(g1)
    expect(refs.find((r) => r.kind === 'source')).toMatchObject({ node: plan.ids.get(s.day1.id) })
    expect(
      refs.filter((r) => r.kind === 'output').map((r) => r.kind === 'output' && r.node),
    ).toEqual([plan.ids.get(s.sum.id)])
    // Shared axes get a new group, linking the copies only.
    const g2 = doc.nodes[plan.ids.get(s.g2.id)!] as GraphNode
    expect(g1.links?.y).toBeDefined()
    expect(g1.links?.y).not.toBe('day1axes')
    expect(g2.links?.y).toBe(g1.links?.y)

    // Names taken by a sheet of the same kind get " (2)"; formulas follow a renamed info sheet.
    const names = (kind: string) => copies.filter((n) => n.kind === kind).map((n) => n.name)
    expect(names('table')).toEqual(['Day 1 (2)', 'Formulas'])
    expect(names('graph')).toEqual(['Day 1 (2)', 'Scale of Day 1'])
    expect(names('info')).toEqual(['Experiment (2)'])
    const formulas = doc.nodes[plan.ids.get(s.formulas.id)!] as DataTable
    expect(formulas.dataSets[1]!.formula).toBe('=[Experiment (2): k] * 2')
    expect(plan.renamed).toContainEqual({ from: 'Experiment', to: 'Experiment (2)' })

    // The other project's style stays the graphs' own; images are listed for the asset store.
    expect(g1.theme?.id).toBe('journal-nature')
    expect(g1.theme?.style).toEqual(builtinStyle('journal-nature')!.style)
    expect(plan.assets).toEqual([ASSET])

    // Its folder comes too, named apart from this project's.
    const folder = doc.folders!.find((f) => f.name === 'Experiment 1 (2)')!
    expect([...folder.members].sort()).toEqual(
      [s.day1.id, s.g1.id, s.whole.id].map((id) => plan.ids.get(id)!).sort(),
    )

    // The copies compute what the originals compute.
    const engine = await startedEngine(store, registry)
    const src = await startedEngine(s.store, registry)
    const sumCopy = engine.get(plan.ids.get(s.sum.id)!)
    const sumOrig = src.get(s.sum.id)
    expect(sumCopy?.status).toBe('ready')
    expect(sumCopy?.status === 'ready' && sumCopy.result.values).toEqual(
      sumOrig?.status === 'ready' && sumOrig.result.values,
    )

    // One undo step takes it all back.
    store.undo()
    expect(store.getState()).toEqual(before)
  })

  it('keeps graphs as they are when the projects share a style', () => {
    const s = source()
    const t = target()
    t.settings = { ...t.settings, theme: s.doc.settings.theme, style: s.doc.settings.style }
    const plan = mergePlan(t, s.doc, { picked: [s.g2.id], withFamily: false })
    const store = new DocumentStore(t)
    store.dispatch(plan.commands)
    const g2 = store.getState().nodes[plan.ids.get(s.g2.id)!] as GraphNode
    expect(g2.theme).toBeUndefined()
    // Unfiled sheets stay unfiled; the table it needs comes in its folder.
    const folders = store.getState().folders!
    expect(folders.some((f) => f.members.includes(g2.id))).toBe(false)
    expect(folders[1]!.members).toEqual([plan.ids.get(s.day1.id)])
  })
})

describe('info sheets formulas read (audit 2, M5)', () => {
  /** Another project: a table whose formulas read [Info: k] and [Lab: n] from two sheets. */
  function other() {
    const p = createProject('Other')
    const sheet = (name: string, label: string, value: string) => ({
      ...createInfoSheet(newNodeId(), name),
      fields: [{ label, value }],
    })
    const info = sheet('Experiment', 'k', '3')
    const lab = sheet('Lab', 'n', '4')
    const unused = sheet('Unused', 'z', '1')
    const t = createTable({ name: 'Calc', tableKind: 'multipleVariables', columns: 3, rows: 2 })
    t.dataSets[1]!.formula = '=[Info: k] * 2'
    t.dataSets[2]!.formula = '=[Lab: n] + [Info: K]'
    for (const n of [info, lab, unused, t]) {
      p.nodes[n.id] = n
      p.order.push(n.id)
    }
    return { p, info, lab, unused, t }
  }

  /** A formula's first value in a project (its info constants bound). */
  const firstValue = (doc: Project, t: DataTable, i: number) =>
    tableFormulas(withConstants(t, infoConstants(doc))).get(t.dataSets[i]!.id)?.values[0]

  it('a picked table brings the info sheets its formulas read', () => {
    const o = other()
    expect(mergeSelection(o.p, [o.t.id], true)).toEqual([o.info.id, o.lab.id, o.t.id])
    expect(firstValue(o.p, o.t, 1)).toBe(6)
  })

  it('formulas keep reading the imported sheet where this project has a field so labelled', () => {
    const o = other()
    const store = new DocumentStore(target())
    const plan = mergePlan(store.getState(), o.p, { picked: [o.t.id] })
    store.dispatch(plan.commands)
    const doc = store.getState()
    const t = doc.nodes[plan.ids.get(o.t.id)!] as DataTable
    // This project's "Experiment" holds k = 5 and comes first: [Info: k] names the copy.
    expect(t.dataSets[1]!.formula).toBe('=[Experiment (2): k] * 2')
    expect(t.dataSets[2]!.formula).toBe('=[Lab: n] + [Experiment (2): K]')
    expect(plan.warnings).toEqual([
      "“Calc”: [Info: k] now reads [Experiment (2): k] (this project's info sheets hold “k” too).",
    ])
    // The values are the other project's (k = 3), not this one's (k = 5).
    expect(firstValue(doc, t, 1)).toBe(6)
    expect(firstValue(doc, t, 2)).toBe(7)
  })

  it('warns before deleting an info sheet formulas read', () => {
    const o = other()
    expect(removalWarnings(o.p, o.info.id)).toEqual([
      'The formulas of “Calc” read “k”, “K” from “Experiment”.',
    ])
    expect(removalWarnings(o.p, o.lab.id)).toEqual(['The formulas of “Calc” read “n” from “Lab”.'])
    expect(removalWarnings(o.p, o.unused.id)).toEqual([])
    expect(removalWarnings(o.p, o.t.id)).toEqual([])
  })
})
