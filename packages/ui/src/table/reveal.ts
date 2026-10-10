import type { NodeId } from '@ps/model'
import { useEffect, useRef } from 'react'

// "Go to row" (roadmap 34d): a graph's hover card or menu asks for a table row; the table's view
// selects it (the whole row of a multiple-variables table, else the value's cell) and scrolls it
// into view when it shows that table, now or once the app has switched to it.

/** A table row to show: the row, and the value's data set and replicate (else the whole row). */
interface RowReveal {
  table: NodeId
  row: number
  column?: string
  sub?: number
}

let pending: RowReveal | null = null
const listeners = new Set<() => void>()

/** Asks the table's view to select and show a row (the app opens the table). */
export function requestReveal(r: RowReveal): void {
  pending = r
  for (const fn of listeners) fn()
}

/** Calls `show` with each row asked for of `table`: one pending now, and those asked later. */
export function useReveal(table: NodeId, show: (r: RowReveal) => void): void {
  const latest = useRef(show)
  latest.current = show
  useEffect(() => {
    const check = () => {
      const r = pending?.table === table ? pending : null
      if (!r) return
      latest.current(r)
      // Taken once the effects of this render have run (React's development re-run of effects
      // resets the selection on mount, then shows the row again).
      setTimeout(() => {
        if (pending === r) pending = null
      }, 0)
    }
    check()
    listeners.add(check)
    return () => {
      listeners.delete(check)
    }
  }, [table])
}
