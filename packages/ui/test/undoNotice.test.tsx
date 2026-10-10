// @vitest-environment happy-dom
import { DocumentStore } from '@ps/engine'
import { createProject, createTable, type DataTable } from '@ps/model'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { UNDO_NOTICE_MS } from '../src/components/Toasts.tsx'
import {
  type NoticeChannel,
  type TrackUndo,
  UndoNoticeContext,
  UndoNotices,
  useUndoNotice,
  useUndoNotices,
} from '../src/components/undoNotice.tsx'

// Roadmap 43 (UX review F17): a step made outside the menus is announced with its Undo, which
// undoes only that step; the same thing edited again in a row replaces the notice in place.

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

interface Shown {
  msg: string
  key: number
  duration: number
  run: () => void
}

/** The shell (its channel recording what it shows) and a view's `track`, over a fresh store. */
function setUp() {
  const table: DataTable = createTable({ name: 'Data 1' })
  const store = new DocumentStore({
    ...createProject('P', new Date('2026-01-01T00:00:00Z')),
  })
  store.dispatch({ type: 'node.add', node: table }, 'New table')
  const shown: Shown[] = []
  const dropped: number[] = []
  let next = 0
  const channel: NoticeChannel = {
    show: (msg, o) => {
      const key = o.key ?? ++next
      shown.push({ msg, key, duration: o.duration, run: o.action.run })
      return key
    },
    drop: (key) => dropped.push(key),
  }
  const undo = vi.fn(() => store.undo())
  let track: TrackUndo = () => {}
  function Shell() {
    useUndoNotices(store, channel, undo)
    return <View />
  }
  function View() {
    track = useUndoNotice()
    return null
  }
  const notices = new UndoNotices()
  const host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  act(() =>
    root!.render(
      <UndoNoticeContext.Provider value={notices}>
        <Shell />
      </UndoNoticeContext.Provider>,
    ),
  )
  const rename = (name: string, label = 'Format graph') =>
    store.dispatch({ type: 'node.set', id: table.id, path: ['name'], value: name }, label)
  return {
    store,
    table,
    shown,
    dropped,
    undo,
    track: (...a: Parameters<TrackUndo>) => track(...a),
    rename,
  }
}

describe('the notice of a step with its Undo', () => {
  it('names the step just made, for a short while, and its Undo undoes it', () => {
    const t = setUp()
    t.track(() => t.rename('A'))
    expect(t.shown).toEqual([
      { msg: 'Format graph', key: 1, duration: UNDO_NOTICE_MS, run: expect.any(Function) },
    ])
    t.shown[0]!.run()
    expect(t.undo).toHaveBeenCalledTimes(1)
    expect(t.store.getState().nodes[t.table.id]?.name).toBe('Data 1')
    // The undo moved the document on: the notice is taken back.
    expect(t.dropped).toEqual([1])
  })

  it('shows nothing when the commit changed nothing, or threw', () => {
    const t = setUp()
    t.track(() => {})
    t.track(() => t.rename('Data 1'))
    expect(() =>
      t.track(() => {
        throw new Error('refused')
      }),
    ).toThrow('refused')
    expect(t.shown).toEqual([])
  })

  it('goes when the document changes again, and never undoes another step', () => {
    const t = setUp()
    t.track(() => t.rename('A'))
    // An edit made elsewhere (typing in a cell): the notice goes.
    t.rename('B', 'Rename')
    expect(t.dropped).toEqual([1])
    // A late press of its Undo does nothing.
    t.shown[0]!.run()
    expect(t.undo).not.toHaveBeenCalled()
    expect(t.store.undoLabel).toBe('Rename')
  })

  it('replaces the notice in place when the same thing is edited again in a row', () => {
    const t = setUp()
    t.track(() => t.rename('A', 'Move legend'), { group: 'legend' })
    t.track(() => t.rename('B', 'Move legend'), { group: 'legend' })
    // The second commit doesn't take the first notice back: it takes its place (same key).
    expect(t.dropped).toEqual([])
    expect(t.shown.map((s) => s.key)).toEqual([1, 1])
    // Something else dragged: a new notice.
    t.track(() => t.rename('C', 'Move title'), { group: 'title' })
    expect(t.shown.map((s) => s.key)).toEqual([1, 1, 2])
    // Only the last step's Undo works.
    t.shown[1]!.run()
    expect(t.undo).not.toHaveBeenCalled()
    t.shown[2]!.run()
    expect(t.undo).toHaveBeenCalledTimes(1)
    expect(t.store.undoLabel).toBe('Move legend')
  })

  it('just runs the commit outside the shell', () => {
    const notices = new UndoNotices()
    const commit = vi.fn()
    notices.track(commit)
    expect(commit).toHaveBeenCalledTimes(1)
  })
})
