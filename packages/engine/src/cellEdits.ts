import { type DataTable, nodeById, type Project } from '@ps/model'
import type { Patch } from 'immer'
import { applyCommand, type Command } from './commands.ts'

// Cell edits without Immer (roadmap 34e, decision 401). Under Immer an edited column is a draft,
// and finishing it compares every index of the column for patches: a one-cell edit of a table
// of a million rows took ~100 ms and its undo as long. Here the column is copied once and the
// patches are made from the edited cells alone: one replace per changed cell, as Immer would
// write them, so undo and redo hold only what changed.

// Exclusions stay with Immer: they create, and prune, whole arrays of flags across the table.
type CellCommand = Extract<Command, { type: 'table.setCells' } | { type: 'table.setText' }>

const isCellCommand = (c: Command): c is CellCommand =>
  c.type === 'table.setCells' || c.type === 'table.setText'

type Path = (string | number)[]

/** A column array the commands touch: where it is, and the rows they may change. */
interface Touched {
  path: Path
  key: 'values' | 'text'
  owner: Record<string, unknown>
  before: unknown[] | undefined
  rows: Set<number>
}

/**
 * The next document and its patches for cell commands that stay within their tables' rows (no
 * growth), or null for anything else (the caller applies those with Immer). Commands are applied
 * by the ordinary reducers to a copy of only the touched columns and the objects above them, so
 * they check and refuse exactly as before.
 */
export function cellEditPatches(
  doc: Project,
  commands: readonly Command[],
): { next: Project; patches: Patch[]; inverse: Patch[] } | null {
  if (!commands.length || !commands.every(isCellCommand)) return null
  // Writable copies of the root, the nodes, each table and its touched containers.
  const root: Project = { ...doc, nodes: { ...doc.nodes } }
  const tables = new Map<string, DataTable>()
  const touched = new Map<unknown[] | string, Touched>()
  const tableOf = (id: string): DataTable | null => {
    let t = tables.get(id)
    if (t) return t
    const node = nodeById(doc.nodes, id)
    if (node?.kind !== 'table') return null
    t = { ...node, dataSets: node.dataSets.slice(), ...(node.x ? { x: { ...node.x } } : {}) }
    if (t.x) t.x.subcolumns = t.x.subcolumns.slice()
    root.nodes[t.id] = t
    tables.set(id, t)
    return t
  }
  const dataSetAt = (t: DataTable, i: number) => {
    const ds = t.dataSets[i]!
    if (!ownedDataSets.has(ds)) {
      const copy = { ...ds, subcolumns: ds.subcolumns.slice() }
      t.dataSets[i] = copy
      ownedDataSets.add(copy)
      return copy
    }
    return ds
  }
  const ownedDataSets = new Set<unknown>()
  const ownedSubs = new Set<unknown>()
  const touch = (owner: Record<string, unknown>, key: Touched['key'], path: Path, row: number) => {
    const id = `${path.join('\u0000')}\u0000${key}`
    let e = touched.get(id)
    if (!e) {
      const before = owner[key] as unknown[] | undefined
      // The column itself, copied once: the reducers write its cells in place.
      if (before) owner[key] = before.slice()
      e = { path, key, owner, before, rows: new Set() }
      touched.set(id, e)
    }
    e.rows.add(row)
  }
  const subcolumn = (t: DataTable, col: string, sub: number) => {
    if (col === 'x') {
      if (!t.x || !Number.isInteger(sub) || !t.x.subcolumns[sub]) return null
      let s = t.x.subcolumns[sub]!
      if (!ownedSubs.has(s)) {
        s = { ...s }
        t.x.subcolumns[sub] = s
        ownedSubs.add(s)
      }
      return { s, path: ['nodes', t.id, 'x', 'subcolumns', sub] as Path }
    }
    const i = t.dataSets.findIndex((d) => d.id === col)
    if (i < 0 || !Number.isInteger(sub)) return null
    const ds = dataSetAt(t, i)
    let s = ds.subcolumns[sub]
    if (!s) return null
    if (!ownedSubs.has(s)) {
      s = { ...s }
      ds.subcolumns[sub] = s
      ownedSubs.add(s)
    }
    return { s, path: ['nodes', t.id, 'dataSets', i, 'subcolumns', sub] as Path }
  }

  for (const cmd of commands) {
    const t = tableOf(cmd.table)
    if (!t) return null
    if (cmd.type === 'table.setText') {
      for (const e of cmd.edits) {
        if (!(e.row >= 0 && e.row < t.rowCount)) return null
        const i = t.dataSets.findIndex((d) => d.id === e.col)
        if (i < 0 || !t.dataSets[i]!.text) return null
        const ds = dataSetAt(t, i) as unknown as Record<string, unknown>
        touch(ds, 'text', ['nodes', t.id, 'dataSets', i], e.row)
      }
      continue
    }
    for (const e of cmd.edits) {
      if (!(e.row >= 0 && e.row < t.rowCount)) return null
      const at = subcolumn(t, e.col, e.sub)
      if (!at) return null
      // A cell flagged at a detection limit loses its flag: Immer's path (roadmap 39).
      if ((at.s as { limit?: unknown[] }).limit?.[e.row]) return null
      touch(at.s as unknown as Record<string, unknown>, 'values', at.path, e.row)
    }
  }
  // The reducers, on the copies (they validate and throw as on any document).
  for (const cmd of commands) applyCommand(root, cmd)

  const patches: Patch[] = []
  const inverse: Patch[] = []
  for (const e of touched.values()) {
    const after = e.owner[e.key] as unknown[] | undefined
    const path = [...e.path, e.key]
    if (!e.before || !after) return null
    // Most of a column edited (a fill down, a paste of a column): one patch of the whole column,
    // not a patch per cell.
    if (e.rows.size > 1000 && e.rows.size * 4 > after.length) {
      patches.push({ op: 'replace', path, value: after })
      inverse.push({ op: 'replace', path, value: e.before })
      continue
    }
    for (const r of [...e.rows].sort((a, b) => a - b)) {
      if (Object.is(after[r], e.before[r])) continue
      patches.push({ op: 'replace', path: [...path, r], value: after[r] })
      inverse.push({ op: 'replace', path: [...path, r], value: e.before[r] })
    }
  }
  return { next: root, patches, inverse }
}
