import type { SizeUnit } from '@ps/model'
import { useEffect, useState } from 'react'
import { usePreferences } from './styleStore.ts'

// Sizes in the user's unit (roadmap 37: Preferences › Units; absent: inches, as before) and the
// graphs selected on the open layout page (the Styles dialog's "Selected graphs").

interface LengthUnit {
  id: SizeUnit
  /** Points per unit. */
  per: number
  step: number
  /** Decimals shown. */
  digits: number
}

export const UNITS: Record<SizeUnit, LengthUnit> = {
  in: { id: 'in', per: 72, step: 0.1, digits: 3 },
  mm: { id: 'mm', per: 72 / 25.4, step: 1, digits: 1 },
  pt: { id: 'pt', per: 1, step: 1, digits: 1 },
}

/** Points shown in a unit, rounded to its digits. */
export const inUnit = (pt: number, u: LengthUnit): number => +(pt / u.per).toFixed(u.digits)

/** The unit sizes are shown in. */
export function useUnit(): LengthUnit {
  return UNITS[usePreferences().units ?? 'in']
}

// --- The open page's selected graphs -------------------------------------------------------------

let pageSelection: { layout: string; graphs: string[] } | null = null
const listeners = new Set<() => void>()

/** The layout view says which graphs are selected on its page (null: no page open). */
export function setPageSelection(sel: { layout: string; graphs: string[] } | null): void {
  if (JSON.stringify(sel) === JSON.stringify(pageSelection)) return
  pageSelection = sel
  for (const l of listeners) l()
}

/** The graphs selected on the open page. */
export function usePageSelection(): { layout: string; graphs: string[] } | null {
  const [sel, setSel] = useState(pageSelection)
  useEffect(() => {
    const l = () => setSel(pageSelection)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
  return sel
}
