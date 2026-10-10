import type { NodeId, Project } from '@ps/model'
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { currentSelection, type NavSelection, onlyOpen } from './navSelection.ts'

// Roadmap 47: the navigator's selection of several sheets, held by the navigator (the open sheet
// stays the shell's), and published for what offers to act on "the graphs selected in the
// navigator" elsewhere: the Styles dialog and the Format panel's Match format.

/**
 * The navigator's selection with `open` the open sheet: `set` replaces it (a plain click's
 * caller also opens the sheet); it starts again from the open sheet whenever another opens.
 */
export function useNavSelection(
  open: NodeId | null,
  project: Project,
): { selection: NavSelection; set: (next: NavSelection) => void } {
  const [raw, setRaw] = useState<NavSelection>(() => onlyOpen(open))
  const selection = useMemo(
    () => currentSelection(raw, open, (id) => !!project.nodes[id]),
    [raw, open, project],
  )
  const set = useCallback((next: NavSelection) => setRaw(next), [])
  const key = selection.ids.join(',')
  // biome-ignore lint/correctness/useExhaustiveDependencies: published when the ids change
  useEffect(() => publishNavSelection(selection.ids), [key])
  useEffect(() => () => publishNavSelection([]), [])
  return { selection, set }
}

// ---- Published --------------------------------------------------------------------------------

let published: readonly NodeId[] = []
const listeners = new Set<() => void>()

/** The navigator says which sheets are selected in it. */
export function publishNavSelection(ids: readonly NodeId[]): void {
  if (ids.length === published.length && ids.every((id, i) => id === published[i])) return
  published = [...ids]
  for (const l of listeners) l()
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

/** The sheets selected in the navigator (in the order selected). */
export function useNavigatorSelection(): readonly NodeId[] {
  return useSyncExternalStore(
    subscribe,
    () => published,
    () => published,
  )
}

/** Of `ids`, the graphs of `project`, in navigator order. */
export const graphsAmong = (project: Project, ids: readonly NodeId[]): NodeId[] => {
  const set = new Set(ids)
  return project.order.filter((id) => set.has(id) && project.nodes[id]?.kind === 'graph')
}
