import { createProject, createTable, type GraphNode, type Project } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { COALESCE_MS, type Command, DocumentStore, DraftStore } from '../src/index.ts'
import { testGraph } from './graphs.ts'

// Roadmap 45: quick repeats of the same change on the same things are one undo step (A↑ pressed
// five times, a colour dragged across a picker), merged by the key given to `dispatch`.

function setup() {
  let clock = 1000
  const table = createTable({ rows: 2, columns: 1 })
  const graph = testGraph(table.id)
  const project = createProject('T', new Date('2026-01-01T00:00:00Z'))
  const store = new DocumentStore(project, { now: () => clock })
  store.dispatch([
    { type: 'node.add', node: table },
    { type: 'node.add', node: graph },
  ])
  const size = (v: number): Command => ({
    type: 'node.set',
    id: graph.id,
    path: ['axes', 'x', 'tickLabels', 'size'],
    value: v,
  })
  const g = () => store.getState().nodes[graph.id] as GraphNode
  const tick = (ms: number) => {
    clock += ms
  }
  return { store, graph, size, g, tick }
}

describe('coalescing steps (roadmap 45)', () => {
  it('five A↑ presses within the window are one step; undo goes back to before the first', () => {
    const { store, size, g, tick } = setup()
    const start = store.getState()
    const steps = store.historyLength.undo
    for (const v of [10, 11, 12, 14, 16]) {
      store.dispatch(size(v), `Font size ${v} pt`, { coalesce: 'grow:x' })
      tick(400)
    }
    expect(g().axes.x.tickLabels?.size).toBe(16)
    expect(store.historyLength.undo).toBe(steps + 1)
    expect(store.undoLabel).toBe('Font size 16 pt')
    const end = store.getState()
    store.undo()
    expect(store.getState()).toEqual(start)
    store.redo()
    expect(store.getState()).toEqual(end)
    store.undo()
    expect(store.getState()).toEqual(start)
  })

  it('the window counts from the latest part of the step', () => {
    const { store, size, tick } = setup()
    const steps = store.historyLength.undo
    // 6 × 1 s: longer than the window in all, each part within it of the one before.
    for (let i = 0; i < 6; i++) {
      store.dispatch(size(10 + i), 'Size', { coalesce: 'k' })
      tick(1000)
    }
    expect(store.historyLength.undo).toBe(steps + 1)
  })

  it('a different key, a pause, an edit or an undo between makes another step', () => {
    const { store, size, graph, tick } = setup()
    const steps = store.historyLength.undo
    store.dispatch(size(10), 'Size', { coalesce: 'a' })
    store.dispatch(size(11), 'Size', { coalesce: 'b' })
    expect(store.historyLength.undo).toBe(steps + 2)
    tick(COALESCE_MS)
    store.dispatch(size(12), 'Size', { coalesce: 'b' })
    expect(store.historyLength.undo).toBe(steps + 3)
    store.dispatch({ type: 'node.rename', id: graph.id, name: 'G' })
    store.dispatch(size(13), 'Size', { coalesce: 'b' })
    expect(store.historyLength.undo).toBe(steps + 5)
    store.undo()
    store.redo()
    store.dispatch(size(14), 'Size', { coalesce: 'b' })
    expect(store.historyLength.undo).toBe(steps + 6)
    // No key: never merged.
    store.dispatch(size(15), 'Size')
    store.dispatch(size(16), 'Size')
    expect(store.historyLength.undo).toBe(steps + 8)
  })

  it('undo and redo of merged steps are exact, step by step', () => {
    const { store, size, graph, tick } = setup()
    const seen: Project[] = [store.getState()]
    store.dispatch(size(9), 'Size', { coalesce: 'k' })
    tick(100)
    store.dispatch(size(10), 'Size', { coalesce: 'k' })
    seen.push(store.getState())
    store.dispatch({ type: 'node.rename', id: graph.id, name: 'G' })
    seen.push(store.getState())
    store.dispatch(size(11), 'Size', { coalesce: 'k' })
    store.dispatch(size(12), 'Size', { coalesce: 'k' })
    seen.push(store.getState())
    for (let i = seen.length - 2; i >= 0; i--) {
      store.undo()
      expect(store.getState()).toEqual(seen[i])
    }
    for (let i = 1; i < seen.length; i++) {
      store.redo()
      expect(store.getState()).toEqual(seen[i])
    }
  })

  it('a draft replays a merged step’s commands', () => {
    const { store, size, g } = setup()
    const draft = new DraftStore(store)
    draft.dispatch(size(10), 'Size', { coalesce: 'k' })
    draft.dispatch(size(12), 'Size', { coalesce: 'k' })
    expect(draft.historyLength.undo).toBe(1)
    expect(draft.commands()).toHaveLength(2)
    draft.commit('Format')
    expect(g().axes.x.tickLabels?.size).toBe(12)
  })
})
