import {
  type ColumnId,
  createProject,
  createTable,
  type DataTable,
  type NodeId,
  type Project,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { BIG_ARRAY, type Command, CommandError, DocumentStore, freezeDoc } from '../src/index.ts'

// Audit 2 (M2): what the store refuses when a command writes a table's per-row arrays (cells,
// text, flags, limit flags), whether it writes new arrays or arrays the document already holds
// elsewhere (a command copies arrays of `BIG_ARRAY` or more by reference, decision 674), on small
// and large tables; and that other edits of a table go through.

const T = 'vars' as NodeId
const n = 'n' as ColumnId
const s = 's' as ColumnId

function fixture(rows: number): Project {
  const p = createProject('P', new Date('2026-10-07T00:00:00Z'))
  const t = createTable({ tableKind: 'multipleVariables', rows, columns: 2, name: 'Vars' })
  t.id = T
  t.dataSets[0]!.id = n
  t.dataSets[1]!.id = s
  t.dataSets[0]!.subcolumns[0]!.values = Array.from({ length: rows }, (_, r) => r)
  t.dataSets[0]!.subcolumns[0]!.excluded = Array.from({ length: rows }, (_, r) => r === 1)
  t.dataSets[1]!.text = Array.from({ length: rows }, (_, r) => (r % 2 ? 'a' : null))
  t.rowTitles = Array.from({ length: rows }, () => null)
  p.nodes[T] = t
  p.order.push(T)
  return freezeDoc(p)
}

const VALUES = ['dataSets', 0, 'subcolumns', 0, 'values']
const EXCLUDED = ['dataSets', 0, 'subcolumns', 0, 'excluded']
const LIMIT = ['dataSets', 0, 'subcolumns', 0, 'limit']
const TEXT = ['dataSets', 1, 'text']

describe.each([5, BIG_ARRAY + 5])('a table of %i rows', (rows) => {
  const doc = fixture(rows)
  const t = doc.nodes[T] as DataTable
  const values = t.dataSets[0]!.subcolumns[0]!.values
  const excluded = t.dataSets[0]!.subcolumns[0]!.excluded!
  const text = t.dataSets[1]!.text!
  const set = (path: (string | number)[], value: unknown): Command => ({
    type: 'node.set',
    id: T,
    path,
    value,
  })
  const refused = (cmd: Command, message: RegExp) => {
    const store = new DocumentStore(doc)
    expect(() => store.dispatch(cmd)).toThrow(CommandError)
    expect(() => store.dispatch(cmd)).toThrow(message)
    expect(store.getState()).toBe(doc)
  }

  it('refuses new arrays holding what their kind may not', () => {
    refused(set(VALUES, [...values.slice(0, -1), Number.NaN]), /values\.\d+: Invalid input/)
    refused(set(VALUES, [...values.slice(0, -1), '1']), /values\.\d+: Invalid input/)
    refused(set(EXCLUDED, [...excluded.slice(0, -1), null]), /excluded\.\d+: Invalid input/)
    refused(set(TEXT, [...text.slice(0, -1), 3]), /text\.\d+: Invalid input/)
    refused(set(['rowTitles'], [...values]), /rowTitles\.\d+: Invalid input/)
    refused(
      set(
        LIMIT,
        values.map((_, r) => (r === 2 ? { side: 'sideways', text: '<1' } : null)),
      ),
      /limit\.2: Invalid input/,
    )
  })

  it('refuses arrays the table holds put where another kind goes', () => {
    refused(set(VALUES, text), /values\.\d+: Invalid input/)
    refused(set(VALUES, excluded), /values\.\d+: Invalid input/)
    refused(set(EXCLUDED, values), /excluded\.\d+: Invalid input/)
    refused(set(TEXT, values), /text\.\d+: Invalid input/)
    refused(set(['rowTitles'], values), /rowTitles\.\d+: Invalid input/)
    refused(
      { type: 'node.replace', node: { ...t, rowTitles: values as never } },
      /rowTitles\.\d+: Invalid input/,
    )
  })

  it('takes valid arrays, its own or new, and edits that leave the arrays alone', () => {
    const store = new DocumentStore(doc)
    store.dispatch(set(['rowTitles'], text))
    store.dispatch(
      set(
        VALUES,
        values.map((v) => (v === 3 ? null : v)),
      ),
    )
    store.dispatch({ type: 'node.rename', id: T, name: 'Renamed' })
    store.dispatch({ type: 'table.setColumnWidths', table: T, widths: { n: 80 } })
    store.dispatch({ type: 'node.replace', node: { ...t, name: 'Replaced' } })
    expect(store.historyLength.undo).toBe(5)
  })
})
