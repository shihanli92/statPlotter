import { createProject, createTable, type NodeId, type Project } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { validSelection } from '../src/util.ts'

const withTables = (n: number): Project => {
  const p = createProject()
  for (let i = 0; i < n; i++) {
    const t = createTable({ name: `Data ${i + 1}` })
    p.nodes[t.id] = t
    p.order.push(t.id)
  }
  return p
}

describe('validSelection', () => {
  it('keeps a sheet that exists', () => {
    const p = withTables(2)
    expect(validSelection(p, p.order[1]!)).toBe(p.order[1])
  })

  it('falls back to the first sheet when the selected one is gone', () => {
    const p = withTables(2)
    expect(validSelection(p, 'gone' as NodeId)).toBe(p.order[0])
    expect(validSelection(createProject(), 'gone' as NodeId)).toBeNull()
  })

  it('shows the first sheet when sheets come back with none selected (redo after undo)', () => {
    // Undoing the only table leaves nothing selected; redoing it must show it again, not the
    // empty-project page beside a navigator listing sheets.
    const p = withTables(1)
    expect(validSelection(p, null)).toBe(p.order[0])
    expect(validSelection(createProject(), null)).toBeNull()
  })
})
