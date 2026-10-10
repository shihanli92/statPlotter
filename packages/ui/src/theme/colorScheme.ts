import { useEffect } from 'react'

// The app's colours (roadmap 41, decisions 617–619): light or dark, chosen in Preferences or
// following the system. The stylesheet's tokens (styles.css `:root`) are redefined under
// `:root[data-theme='dark']`; this sets the attribute. Graphs, pages and previews keep their own
// colours on white paper in both.

/** The user's choice: light, dark, or absent for the system's. */
type ColorSchemeChoice = 'light' | 'dark' | undefined

/** The last choice, kept so the first paint (before preferences are read) already has it. */
const KEY = 'ps.colorScheme'
const QUERY = '(prefers-color-scheme: dark)'

const systemDark = (): boolean =>
  typeof matchMedia === 'function' ? matchMedia(QUERY).matches : false

/** The colours shown for a choice. */
export const resolveColorScheme = (choice: ColorSchemeChoice, dark: boolean): 'light' | 'dark' =>
  choice ?? (dark ? 'dark' : 'light')

/** Sets the document's colours for a choice (the system's now when absent). */
export function applyColorScheme(choice: ColorSchemeChoice, dark = systemDark()): 'light' | 'dark' {
  const scheme = resolveColorScheme(choice, dark)
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = scheme
  return scheme
}

const readChoice = (): ColorSchemeChoice => {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : undefined
  } catch {
    return undefined
  }
}

const rememberChoice = (choice: ColorSchemeChoice) => {
  try {
    if (choice) localStorage.setItem(KEY, choice)
    else localStorage.removeItem(KEY)
  } catch {}
}

/** At start, before preferences are read: the last choice, or the system's colours. */
export const initialColorScheme = (): 'light' | 'dark' => applyColorScheme(readChoice())

/**
 * Keeps the document's colours on the choice, following the system's when there is none; the
 * desktop window's title bar follows too (`setWindow`). `null`: not known yet (preferences still
 * being read), so the colours set at start stay.
 */
export function useColorScheme(
  choice: ColorSchemeChoice | null,
  setWindow?: (scheme: 'light' | 'dark' | null) => void,
) {
  useEffect(() => {
    if (choice === null) return
    rememberChoice(choice)
    applyColorScheme(choice)
    setWindow?.(choice ?? null)
    if (choice || typeof matchMedia !== 'function') return
    const media = matchMedia(QUERY)
    const changed = () => applyColorScheme(undefined, media.matches)
    media.addEventListener('change', changed)
    return () => media.removeEventListener('change', changed)
  }, [choice, setWindow])
}
