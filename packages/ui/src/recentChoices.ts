import { useSyncExternalStore } from 'react'

// Roadmap 43: what the toolbar's split buttons offer again — the graph presets and analyses
// the user chose last, remembered per user in localStorage (like `ps.showNavigator`), most recent
// first. Presets are kept per table kind (each kind has its own); analyses in one list (the
// toolbar offers those the current table accepts).

export const MAX_RECENT_CHOICES = 5

const PRESETS_KEY = 'ps.recentPresets'
const ANALYSES_KEY = 'ps.recentAnalyses'

const listeners = new Set<() => void>()
let version = 0

function read(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null')
  } catch {
    return null
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {}
  version++
  for (const fn of [...listeners]) fn()
}

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []

/** `id` first, without its earlier place, at most `MAX_RECENT_CHOICES`. */
export const withRecent = (list: readonly string[], id: string): string[] =>
  [id, ...list.filter((x) => x !== id)].slice(0, MAX_RECENT_CHOICES)

/** The presets chosen last for graphs of a table kind (built-in preset ids). */
export function recentPresets(kind: string): string[] {
  const all = read(PRESETS_KEY)
  return all && typeof all === 'object' && !Array.isArray(all)
    ? strings((all as Record<string, unknown>)[kind]).slice(0, MAX_RECENT_CHOICES)
    : []
}

export function rememberPreset(kind: string, preset: string) {
  const all = read(PRESETS_KEY)
  const obj = all && typeof all === 'object' && !Array.isArray(all) ? { ...all } : {}
  write(PRESETS_KEY, { ...obj, [kind]: withRecent(recentPresets(kind), preset) })
}

/** The analyses chosen last (analysis ids), whatever their table. */
export const recentAnalyses = (): string[] =>
  strings(read(ANALYSES_KEY)).slice(0, MAX_RECENT_CHOICES)

export function rememberAnalysis(id: string) {
  write(ANALYSES_KEY, withRecent(recentAnalyses(), id))
}

const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Re-renders when a choice is remembered (the toolbar's menus follow at once). */
export const useRecentChoicesVersion = () => useSyncExternalStore(subscribe, () => version)
