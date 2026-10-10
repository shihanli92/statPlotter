import { describe, expect, it } from 'vitest'
import {
  constantList,
  createInfoSheet,
  createProject,
  createTable,
  type DataTable,
  type FolderId,
  folderIssues,
  type InfoNode,
  infoConstants,
  type NodeId,
  normalizeTable,
  parseProject,
  projectIssues,
  renameInfoInFormula,
  sourceTable,
  tableFormulas,
  uniqueName,
  withConstants,
} from '../src/index.ts'

// Roadmap 40: info sheets' fields as formula constants, and the navigator's folders.

function mv(cols: Record<string, (number | null)[] | string>): DataTable {
  const titles = Object.keys(cols)
  const rows = Math.max(1, ...Object.values(cols).map((v) => (Array.isArray(v) ? v.length : 0)))
  const t = createTable({ tableKind: 'multipleVariables', columns: titles.length, rows })
  titles.forEach((title, i) => {
    const ds = t.dataSets[i]!
    ds.title = title
    const v = cols[title]!
    if (typeof v === 'string') ds.formula = v
    else ds.subcolumns[0]!.values = v
  })
  return t
}

function info(name: string, fields: [string, string][]): InfoNode {
  return {
    ...createInfoSheet(name.toLowerCase().replace(/\W/g, '') as NodeId, name),
    fields: fields.map(([label, value]) => ({ label, value })),
  }
}

const values = (t: DataTable, title: string) => {
  const ds = t.dataSets.find((d) => d.title === title)!
  const f = tableFormulas(t).get(ds.id)!
  return { error: f.error, values: [...f.values].map((v) => (Number.isNaN(v) ? null : v)) }
}

function projectOf(...nodes: (DataTable | InfoNode)[]) {
  const p = createProject('Info')
  for (const n of nodes) {
    p.nodes[n.id] = n
    p.order.push(n.id)
  }
  return p
}

describe('info constants in formulas', () => {
  it('reads the first info sheet’s field, or a named sheet’s', () => {
    const t = mv({
      Conc: [1, 2, 4],
      Diluted: '=Conc * [Info: dilution]',
      Lot: '=[Assay 2: Dilution] + 0',
    })
    const a = info('Experiment', [
      ['Date', '2026-10-06'],
      ['Dilution', '10'],
    ])
    const b = info('Assay 2', [['dilution', '1,5']])
    const p = projectOf(t, a, b)
    const bound = sourceTable(p, t.id)!
    expect(values(bound, 'Diluted')).toEqual({ error: null, values: [10, 20, 40] })
    // A decimal comma reads as a number; labels and sheet names ignore case.
    expect(values(bound, 'Lot')).toEqual({ error: null, values: [1.5, 1.5, 1.5] })
    // Analyses see the same values (the normalized view of the bound table).
    const norm = normalizeTable(bound).find((d) => d.title === 'Diluted')!
    expect(norm.data.shape === 'replicates' && [...norm.data.reps[0]!]).toEqual([10, 20, 40])
  })

  it('is live: a new value gives new results, unchanged sheets the same objects', () => {
    const t = mv({ Conc: [1, 2], D: '=Conc * [Info: k]' })
    const a = info('Experiment', [['k', '2']])
    const p1 = projectOf(t, a)
    const c1 = infoConstants(p1)
    expect(infoConstants({ ...p1 })).toBe(c1)
    const v1 = values(withConstants(t, c1), 'D').values
    const a2 = { ...a, fields: [{ label: 'k', value: '3' }] }
    const p2 = { ...p1, nodes: { ...p1.nodes, [a.id]: a2 } }
    const c2 = infoConstants(p2)
    expect(c2).not.toBe(c1)
    expect(v1).toEqual([2, 4])
    expect(values(withConstants(t, c2), 'D').values).toEqual([3, 6])
    // A table whose formulas name no info field is itself.
    const plain = mv({ A: [1], B: '=A * 2' })
    expect(withConstants(plain, c2)).toBe(plain)
  })

  it('shows the formula error when the field is missing, empty or not a number', () => {
    const t = mv({
      A: [1],
      Missing: '=A * [Info: nothing]',
      Empty: '=[Info: empty]',
      Text: '=[Experiment: Investigator]',
      NoSheet: '=[Elsewhere: k]',
      Unbound: '=[Info: k]',
    })
    const a = info('Experiment', [
      ['empty', ' '],
      ['Investigator', 'Ada'],
      ['k', '1'],
    ])
    const bound = withConstants(t, infoConstants(projectOf(t, a)))
    expect(values(bound, 'Missing').error).toBe('no info sheet has a field “nothing”')
    expect(values(bound, 'Empty').error).toBe('the info field “empty” is empty')
    expect(values(bound, 'Text').error).toBe('the info field “Investigator” isn’t a number (“Ada”)')
    // A prefix naming no info sheet stays an unknown variable.
    expect(values(bound, 'NoSheet').error).toBe('no variable is called “Elsewhere: k”')
    // Without the project's constants (a table read on its own), the name is unknown.
    expect(values(t, 'Unbound').error).toBe('no variable is called “Info: k”')
  })

  it('prefers a variable of that title', () => {
    const t = mv({ 'Info: k': [5], D: '=[Info: k] * 2' })
    const bound = withConstants(t, infoConstants(projectOf(t, info('Experiment', [['k', '1']]))))
    expect(values(bound, 'D').values).toEqual([10])
  })

  it('rewrites references for renames, and lists the constants', () => {
    const rename = (f: string) =>
      renameInfoInFormula(f, (prefix, label) =>
        prefix.toLowerCase() === 'info' && label === 'k' ? `${prefix}: factor` : null,
      )
    expect(rename('=A * [Info: k] + [Info:k]')).toBe('=A * [Info: factor] + [Info: factor]')
    expect(rename('=A * 2')).toBeNull()
    const sheets = [
      info('Exp', [
        ['k', '2'],
        ['Who', 'Ada'],
      ]),
      info('Other', [['k', '3']]),
    ]
    expect(constantList(sheets).map((c) => [c.reference, c.number])).toEqual([
      ['[Info: k]', true],
      ['[Info: Who]', false],
      ['[Other: k]', true],
    ])
  })
})

describe('folders', () => {
  const f = (id: string, members: string[], parent?: string) => ({
    id: id as FolderId,
    name: id,
    members: members as NodeId[],
    ...(parent ? { parent: parent as FolderId } : {}),
  })
  const has = (id: NodeId) => ['a', 'b', 'c'].includes(id)

  it('checks ids, one level of nesting, members that exist once', () => {
    expect(folderIssues([f('f1', ['a']), f('f2', ['b'], 'f1')], has)).toEqual([])
    const msgs = (fs: ReturnType<typeof f>[]) => folderIssues(fs, has).map((i) => i.message)
    expect(msgs([f('f1', []), f('f1', [])])).toEqual(['duplicate folder f1'])
    expect(msgs([f('f1', [], 'zz')])).toEqual(['no folder zz'])
    expect(msgs([f('f1', []), f('f2', [], 'f1'), f('f3', [], 'f2')])).toEqual([
      'folders nest one level only',
    ])
    expect(msgs([f('f1', ['a', 'x'])])).toEqual(['folder lists missing node x'])
    expect(msgs([f('f1', ['a']), f('f2', ['a'])])).toEqual(['node a is in two folders (f1, f2)'])
  })

  it('is optional project data, validated with the project', () => {
    const t = createTable({ name: 'T' })
    const p = projectOf(t)
    expect(projectIssues(p)).toEqual([])
    const withFolders = { ...p, folders: [f('f1', [t.id])] }
    expect(projectIssues(withFolders)).toEqual([])
    expect(parseProject(withFolders).folders).toEqual(withFolders.folders)
    expect('folders' in parseProject(p)).toBe(false)
    expect(projectIssues({ ...p, folders: [f('f1', ['gone'])] })[0]!.message).toBe(
      'folder lists missing node gone',
    )
  })

  it('makes names unique', () => {
    expect(uniqueName('Data', ['Other'])).toBe('Data')
    expect(uniqueName('Data', ['data', 'Data (2)'])).toBe('Data (3)')
    expect(uniqueName('Data (2)', ['Data (2)'])).toBe('Data (3)')
  })
})
