import type { SearchTarget } from '@ps/engine'
import type { NodeId } from '@ps/model'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { useAssetsVersion, useResultLookup, useServices } from '../context.tsx'
import { renderThumbnail, ThumbnailCache } from './thumbnails.ts'

// Roadmap 40's shared pieces: the thumbnails cache, and where a search result asks a view to
// take the user (a column, an info field).

export const ThumbnailsContext = createContext<ThumbnailCache | null>(null)

/** The app's thumbnails cache (one per window), drawing from the open project. */
export function useThumbnailCache(): ThumbnailCache {
  const services = useServices()
  const [cache] = useState(
    () =>
      new ThumbnailCache({
        project: () => services.store.getState(),
        result: (id) => services.engine.latest(id),
        assetsVersion: () => services.assets.version,
        render: (project, id) =>
          renderThumbnail(
            project,
            id,
            services.fonts,
            (a) => services.engine.latest(a),
            (a) => services.assets.get(a),
          ),
      }),
  )
  // Forget sheets deleted (a new project, undo of a creation).
  useEffect(() => services.store.subscribe((p) => cache.prune(p)), [services.store, cache])
  return cache
}

/**
 * A graph's or page's thumbnail (a data URL; null until first drawn). Redrawn in the background
 * when the drawing changes; the older one shows meanwhile.
 */
export function useThumbnail(id: NodeId): string | null {
  const cache = useContext(ThumbnailsContext)
  const subscribe = useCallback(
    (fn: () => void) => (cache ? cache.subscribe(fn) : () => {}),
    [cache],
  )
  useSyncExternalStore(subscribe, () => cache?.version ?? 0)
  // The document and results changing re-render callers (useDoc / results), asking again.
  useResultLookup()
  useAssetsVersion()
  return cache?.get(id) ?? null
}

// ---- Jumping to a match ------------------------------------------------------------------------

let pending: { node: NodeId; target: SearchTarget } | null = null
const listeners = new Set<() => void>()

/** Asks the view of `node` to show `target` (once it is open). */
export function requestFocus(node: NodeId, target: SearchTarget): void {
  pending = { node, target }
  for (const fn of listeners) fn()
}

/** Calls `show` with each target asked for of `node`: one pending now, and those asked later. */
export function useFocusRequest(node: NodeId, show: (t: SearchTarget) => void): void {
  const latest = useRef(show)
  latest.current = show
  useEffect(() => {
    const check = () => {
      const p = pending?.node === node ? pending : null
      if (!p) return
      latest.current(p.target)
      setTimeout(() => {
        if (pending === p) pending = null
      }, 0)
    }
    check()
    listeners.add(check)
    return () => {
      listeners.delete(check)
    }
  }, [node])
}
