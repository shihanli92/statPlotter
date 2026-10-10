import type { DocumentStore } from '@ps/engine'
import type { Project } from '@ps/model'
import { createContext, useCallback, useContext, useEffect, useRef } from 'react'
import { type ToastAction, UNDO_NOTICE_MS } from './Toasts.tsx'

// Roadmap 43 (UX review F17): a one-step edit made outside the menus (a Format dialog's OK, a
// drag on the canvas or the page) says what it did for a moment, with Undo: "Format graph ·
// Undo". The notice's Undo undoes only that step: the notice goes as soon as the document
// changes again (another edit, an undo or redo, another project), so it never undoes another.

export interface UndoNoticeOptions {
  /**
   * The same thing edited again in a row (one element dragged twice) replaces the notice in
   * place rather than announcing a new one.
   */
  group?: string
}

/**
 * Runs `commit` (which makes at most one undo step); when it changed the document, the notice
 * names the step with an Undo. What `commit` throws is the caller's.
 */
export type TrackUndo = (commit: () => unknown, opts?: UndoNoticeOptions) => void

/**
 * The views' way to the shell's notices: `track` is stable (given out once); the shell sets
 * what it does (`useUndoNotices`). Without a shell (tests, previews) the commit just runs.
 */
export class UndoNotices {
  impl: TrackUndo | null = null
  readonly track: TrackUndo = (commit, opts) => {
    if (this.impl) this.impl(commit, opts)
    else commit()
  }
}

export const UndoNoticeContext = createContext(new UndoNotices())

/** The views' and dialogs' side: commits that announce themselves. */
export const useUndoNotice = (): TrackUndo => useContext(UndoNoticeContext).track

/** How the shell shows and takes back a notice. */
export interface NoticeChannel {
  /**
   * Shows a notice, returning its key; `key` given: the notice shown with it is replaced in
   * place (its time counted again, not announced again).
   */
  show: (msg: string, o: { duration: number; action: ToastAction; key?: number }) => number
  /** Takes back the notice of `key` if it is still the one shown. */
  drop: (key: number) => void
}

/**
 * The shell's side: shows the notices of the steps tracked (`UndoNotices.track`), and takes a
 * notice back when the document moves on from its step. `undo` is Edit › Undo, run only while
 * that step is still the last one made.
 */
export function useUndoNotices(
  store: DocumentStore,
  channel: NoticeChannel,
  undo: () => void,
): TrackUndo {
  const notices = useContext(UndoNoticeContext)
  const shown = useRef<{ key: number; state: Project; group?: string } | null>(null)
  const committing = useRef(false)
  const { show, drop } = channel
  const forget = useCallback(() => {
    const s = shown.current
    if (s && store.getState() !== s.state) {
      shown.current = null
      drop(s.key)
    }
  }, [store, drop])
  // Any change but the one being announced.
  useEffect(() => store.subscribe(() => committing.current || forget()), [store, forget])
  const track = useCallback<TrackUndo>(
    (commit, opts = {}) => {
      const before = store.getState()
      const last = shown.current
      committing.current = true
      try {
        commit()
      } finally {
        committing.current = false
      }
      const after = store.getState()
      const label = store.undoLabel
      if (after === before || !label) return forget()
      const again = opts.group !== undefined && last?.group === opts.group
      const key = show(label, {
        duration: UNDO_NOTICE_MS,
        action: {
          label: 'Undo',
          run: () => {
            if (store.getState() === after) undo()
          },
        },
        ...(again ? { key: last.key } : {}),
      })
      shown.current = { key, state: after, ...(opts.group ? { group: opts.group } : {}) }
    },
    [store, show, forget, undo],
  )
  useEffect(() => {
    notices.impl = track
    return () => {
      if (notices.impl === track) notices.impl = null
    }
  }, [notices, track])
  return track
}
