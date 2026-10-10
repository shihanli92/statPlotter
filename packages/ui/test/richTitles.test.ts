import { DocumentStore } from '@ps/engine'
import { createProject, createTable, type DataTable } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { gridColumns } from '../src/table/gridModel.ts'
import {
  renameDataSetCommand,
  renameXCommand,
  rowTitleCommand,
  rowTitleRuns,
  subTitleRichCommand,
} from '../src/table/titles.tsx'

// The grid's title edits (roadmap 28): typed runs → the engine's title commands.

function setup() {
  const table = createTable({
    tableKind: 'nested',
    yFormat: { type: 'replicates', count: 2 },
    rows: 2,
  })
  const store = new DocumentStore(createProject())
  store.dispatch({ type: 'node.add', node: table })
  const t = () => store.getState().nodes[table.id] as DataTable
  return { store, t }
}

describe('title edits in the grid', () => {
  it('renames a data set with formatting, and not at all when nothing changed', () => {
    const { store, t } = setup()
    const ds = t().dataSets[0]!
    expect(renameDataSetCommand(t(), ds, [{ text: ds.title }])).toBeNull()
    const rich = [{ text: 'k' }, { text: 'off', sub: true }]
    store.dispatch(renameDataSetCommand(t(), ds, rich)!)
    expect(t().dataSets[0]).toMatchObject({ title: 'koff', titleRich: rich })
    // Only the formatting changes: still a rename, back to plain.
    store.dispatch(renameDataSetCommand(t(), t().dataSets[0]!, [{ text: 'koff' }])!)
    expect(t().dataSets[0]!.titleRich).toBeUndefined()
    expect(renameXCommand(t(), [{ text: 'X' }])).toBeNull()
  })

  it('trims row titles and keeps their runs', () => {
    const { store, t } = setup()
    store.dispatch(rowTitleCommand(t(), 1, [{ text: ' IC' }, { text: '50 ', sub: true }]))
    expect(t().rowTitles).toEqual([null, 'IC50'])
    expect(rowTitleRuns(t(), 1)).toEqual([{ text: 'IC' }, { text: '50', sub: true }])
    expect(rowTitleRuns(t(), 0)).toEqual([{ text: '' }])
  })

  it('names subjects with formatting, a formatting change alone included', () => {
    const { store, t } = setup()
    const col = () => gridColumns(t()).find((c) => c.kind === 'data' && c.sub === 1)!
    const data = () => col() as Extract<ReturnType<typeof col>, { kind: 'data' }>
    store.dispatch(subTitleRichCommand(t(), data(), [{ text: 'M2' }])!)
    expect(t().dataSets[0]!.subcolumnTitles).toEqual([null, 'M2'])
    const rich = [{ text: 'M' }, { text: '2', sup: true }]
    store.dispatch(subTitleRichCommand(t(), data(), rich)!)
    expect(t().dataSets[0]!.subcolumnTitlesRich).toEqual([null, rich])
    expect(subTitleRichCommand(t(), data(), rich)).toBeNull()
  })
})
