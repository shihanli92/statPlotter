import type { ResultState } from '@ps/engine'
import {
  type AnalysisResult,
  type DataTable,
  type NodeId,
  type Project,
  sourceTable,
} from '@ps/model'
import { createContext, useCallback, useContext, useSyncExternalStore } from 'react'
import type { AppServices } from './services.ts'

export const ServicesContext = createContext<AppServices | null>(null)

export function useServices(): AppServices {
  const s = useContext(ServicesContext)
  if (!s) throw new Error('ServicesContext missing')
  return s
}

/**
 * Subscribes to the document; re-renders when the selected slice changes identity. The selector
 * must return existing objects (not build new arrays), or React will re-render forever — derive
 * with useMemo instead.
 */
export function useDoc<T>(select: (doc: Project) => T): T {
  const { store } = useServices()
  const subscribe = useCallback((fn: () => void) => store.subscribe(fn), [store])
  return useSyncExternalStore(subscribe, () => select(store.getState()))
}

export function useResultState(id: NodeId): ResultState | undefined {
  const { engine } = useServices()
  const subscribe = useCallback((fn: () => void) => engine.subscribe(fn), [engine])
  return useSyncExternalStore(subscribe, () => engine.get(id))
}

/**
 * Looks up the latest result of any analysis (the previous one while recomputing). `version`
 * changes whenever any result changes, for use in memo dependencies.
 */
export function useResultLookup(): {
  lookup: (id: NodeId) => AnalysisResult | undefined
  version: number
} {
  const { engine } = useServices()
  const subscribe = useCallback((fn: () => void) => engine.subscribe(fn), [engine])
  const version = useSyncExternalStore(subscribe, () => engine.version)
  const lookup = useCallback((id: NodeId) => engine.latest(id), [engine])
  return { lookup, version }
}

/**
 * The data table a node provides as a source: a data table, or the table an analysis produced
 * (its latest result's, addressed by the analysis' id). Re-renders when either changes.
 */
export function useSourceTable(id: NodeId | null | undefined): DataTable | undefined {
  const { store, engine } = useServices()
  const subscribe = useCallback(
    (fn: () => void) => {
      const a = store.subscribe(fn)
      const b = engine.subscribe(fn)
      return () => {
        a()
        b()
      }
    },
    [store, engine],
  )
  return useSyncExternalStore(subscribe, () =>
    id ? sourceTable(store.getState(), id, (n) => engine.latest(n)) : undefined,
  )
}

/** The asset store's version (changes when an image is added), for memo dependencies. */
export function useAssetsVersion(): number {
  const { assets } = useServices()
  const subscribe = useCallback((fn: () => void) => assets.subscribe(fn), [assets])
  return useSyncExternalStore(subscribe, () => assets.version)
}

export function useHistory() {
  const { store } = useServices()
  const subscribe = useCallback((fn: () => void) => store.subscribe(fn), [store])
  const undo = useSyncExternalStore(subscribe, () => store.undoLabel)
  const redo = useSyncExternalStore(subscribe, () => store.redoLabel)
  const dirty = useSyncExternalStore(subscribe, () => store.dirty)
  return { undo, redo, dirty }
}
