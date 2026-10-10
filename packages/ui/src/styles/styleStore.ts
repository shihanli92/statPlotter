import {
  type AppPreferences,
  type FigureStyle,
  newUserStyle,
  parsePreferences,
  readStyle,
  styleNameProblem,
  type UserStyle,
  uniqueStyleName,
  writeStyle,
} from '@ps/model'
import { useEffect, useState } from 'react'
import { useServices } from '../context.tsx'
import type { Library } from '../services.ts'

// The user's styles (roadmap 37, decision 537) and preferences (decision 538), kept as user
// presets are (decision 256): desktop `styles/<name>.psstyle` and `settings/preferences.json` in
// the app data folder, web IndexedDB (the library database, version 3), memory from the first
// failure. Every change tells the open dialogs to read again.

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** The styles in a library, in their order (then by name); unreadable entries are skipped. */
export async function loadStyles(library: Library): Promise<UserStyle[]> {
  const out: UserStyle[] = []
  for (const e of await library.list()) {
    const bytes = await library.read(e.name)
    if (!bytes) continue
    try {
      // The library's entry name wins over the file's (a renamed desktop file).
      const s = readStyle(decoder.decode(bytes))
      out.push({ ...s, name: e.name, style: { ...s.style, name: e.name } })
    } catch {
      // Not a style (a stray file in the folder): left alone.
    }
  }
  return out.sort(
    (a, b) =>
      (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) ||
      a.name.localeCompare(b.name),
  )
}

const put = (library: Library, s: UserStyle) => library.write(s.name, encoder.encode(writeStyle(s)))

/** Saves a new style at the end of the list (throws with the reason when the name is taken). */
export async function saveStyle(
  library: Library,
  name: string,
  style: FigureStyle,
): Promise<UserStyle> {
  const styles = await loadStyles(library)
  const problem = styleNameProblem(
    name,
    styles.map((s) => s.name),
  )
  if (problem) throw new Error(problem)
  const saved: UserStyle = { ...newUserStyle(name, style), order: styles.length }
  await put(library, saved)
  changed()
  return saved
}

/** Replaces a style's values (the Style editor's Save), keeping its name and place. */
export async function updateStyle(
  library: Library,
  name: string,
  style: FigureStyle,
): Promise<UserStyle> {
  const styles = await loadStyles(library)
  const old = styles.find((s) => s.name === name)
  if (!old) throw new Error(`There is no style called “${name}”.`)
  const next: UserStyle = { ...old, style: { ...style, name } }
  await put(library, next)
  changed()
  return next
}

/** Renames a style (throws with the reason when the new name can't be used). */
export async function renameStyle(library: Library, from: string, to: string): Promise<void> {
  const styles = await loadStyles(library)
  const s = styles.find((x) => x.name === from)
  if (!s || to.trim() === from) return
  const problem = styleNameProblem(
    to,
    styles.filter((x) => x !== s).map((x) => x.name),
  )
  if (problem) throw new Error(problem)
  const name = to.trim()
  await put(library, { ...s, name, style: { ...s.style, name } })
  await library.remove(from)
  changed()
}

/** Deletes a style for good (projects that use it keep its values). */
export async function deleteStyle(library: Library, name: string): Promise<void> {
  await library.remove(name)
  changed()
}

/** A style file's text read into the library under a free name (returned). */
export async function importStyle(library: Library, text: string): Promise<UserStyle> {
  const read = readStyle(text)
  const styles = await loadStyles(library)
  const name = uniqueStyleName(
    read.name,
    styles.map((s) => s.name),
  )
  const s: UserStyle = { ...read, name, style: { ...read.style, name }, order: styles.length }
  await put(library, s)
  changed()
  return s
}

/** A style as a file to share (without the library's order). */
export const exportStyle = (s: UserStyle): string => writeStyle(s, { exported: true })

// --- Preferences -----------------------------------------------------------------------------

const PREFS = 'preferences'
let prefsCache: AppPreferences | undefined

/** The user's preferences (none stored, or unreadable: none). */
export async function loadPreferences(library: Library | undefined): Promise<AppPreferences> {
  if (!library) {
    prefsCache = prefsCache ?? {}
    return prefsCache
  }
  try {
    const bytes = await library.read(PREFS)
    prefsCache = bytes ? parsePreferences(JSON.parse(decoder.decode(bytes))) : {}
  } catch {
    prefsCache = prefsCache ?? {}
  }
  return prefsCache
}

/** Stores the user's preferences. */
export async function savePreferences(
  library: Library | undefined,
  prefs: AppPreferences,
): Promise<void> {
  prefsCache = prefs
  if (library) await library.write(PREFS, encoder.encode(`${JSON.stringify(prefs, null, 1)}\n`))
  changed()
}

/** The preferences last read or saved in this session (none before the first read). */
export const currentPreferences = (): AppPreferences => prefsCache ?? {}

/** Whether the preferences have been read (or saved) in this session. */
export const preferencesRead = (): boolean => prefsCache !== undefined

// --- Change notices ----------------------------------------------------------------------------

const listeners = new Set<() => void>()
let generation = 0
function changed() {
  generation++
  for (const l of listeners) l()
}

function useGeneration(): number {
  const [gen, setGen] = useState(generation)
  useEffect(() => {
    const l = () => setGen(generation)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
  return gen
}

const cache = new WeakMap<object, UserStyle[]>()

/** The user's styles, read again after every change. Without a library: none. */
export function useStyleLibrary(): {
  library: Library | undefined
  styles: UserStyle[]
  loaded: boolean
} {
  const library = useServices().platform.styles
  const [state, setState] = useState<{ styles: UserStyle[]; loaded: boolean }>({
    styles: (library && cache.get(library)) || [],
    loaded: !library || cache.has(library),
  })
  const gen = useGeneration()
  useEffect(() => {
    void gen
    if (!library) {
      setState({ styles: [], loaded: true })
      return
    }
    let live = true
    loadStyles(library).then(
      (styles) => {
        cache.set(library, styles)
        if (live) setState({ styles, loaded: true })
      },
      () => live && setState({ styles: [], loaded: true }),
    )
    return () => {
      live = false
    }
  }, [library, gen])
  return { library, ...state }
}

/** The user's preferences, read once and again after every change. */
export function usePreferences(): AppPreferences {
  const library = useServices().platform.settings
  const [prefs, setPrefs] = useState<AppPreferences>(() => currentPreferences())
  const gen = useGeneration()
  useEffect(() => {
    void gen
    let live = true
    loadPreferences(library).then((p) => live && setPrefs(p))
    return () => {
      live = false
    }
  }, [library, gen])
  return prefs
}
