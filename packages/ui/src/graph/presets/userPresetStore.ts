import {
  newUserPreset,
  type PresetRecipe,
  presetNameProblem,
  readPreset,
  type TableKind,
  type UserPreset,
  uniquePresetName,
  writePreset,
} from '@ps/model'
import { useEffect, useState } from 'react'
import { useServices } from '../../context.tsx'
import type { Library } from '../../services.ts'

// The user's graph presets in their library (roadmap 33c): read, saved, renamed, reordered,
// made a table kind's default, imported and exported. Every change tells the open builders and
// dialogs (`usePresetLibrary`) to read the library again.

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** The presets in a library, in their order (then by name); unreadable entries are skipped. */
export async function loadPresets(library: Library): Promise<UserPreset[]> {
  const out: UserPreset[] = []
  for (const e of await library.list()) {
    const bytes = await library.read(e.name)
    if (!bytes) continue
    try {
      // The library's entry name wins over the file's (a renamed desktop file).
      out.push({ ...readPreset(decoder.decode(bytes)), name: e.name })
    } catch {
      // Not a preset (a stray file in the folder): left alone.
    }
  }
  return out.sort(
    (a, b) =>
      (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) ||
      a.name.localeCompare(b.name),
  )
}

const put = (library: Library, p: UserPreset) =>
  library.write(p.name, encoder.encode(writePreset(p)))

/** Every preset's place in the list, written where it changed. */
async function renumber(library: Library, presets: readonly UserPreset[]): Promise<void> {
  for (const [i, p] of presets.entries()) if (p.order !== i) await put(library, { ...p, order: i })
}

/**
 * Saves a new preset at the front of the list (user presets come first in the builder's row);
 * as its table kind's default when asked (the previous default of that kind stops being one).
 */
export async function savePreset(
  library: Library,
  name: string,
  recipe: PresetRecipe,
  opts: { isDefault?: boolean } = {},
): Promise<UserPreset> {
  const presets = await loadPresets(library)
  const problem = presetNameProblem(
    name,
    presets.map((p) => p.name),
  )
  if (problem) throw new Error(problem)
  const preset: UserPreset = {
    ...newUserPreset(name, recipe),
    order: 0,
    ...(opts.isDefault ? { isDefault: true } : {}),
  }
  await put(library, preset)
  for (const [i, p] of presets.entries()) {
    const undefault = opts.isDefault && p.isDefault && p.recipe.tableKind === recipe.tableKind
    if (p.order !== i + 1 || undefault)
      await put(library, { ...p, order: i + 1, ...(undefault ? { isDefault: false } : {}) })
  }
  changed()
  return preset
}

/** Renames a preset (throws with the reason when the new name can't be used). */
export async function renamePreset(library: Library, from: string, to: string): Promise<void> {
  const presets = await loadPresets(library)
  const p = presets.find((x) => x.name === from)
  if (!p || to.trim() === from) return
  const problem = presetNameProblem(
    to,
    presets.filter((x) => x !== p).map((x) => x.name),
  )
  if (problem) throw new Error(problem)
  await put(library, { ...p, name: to.trim() })
  await library.remove(from)
  changed()
}

/** Deletes a preset for good. */
export async function deletePreset(library: Library, name: string): Promise<void> {
  await library.remove(name)
  changed()
}

/** Moves a preset one place up (−1) or down (1) in the list. */
export async function movePreset(library: Library, name: string, by: -1 | 1): Promise<void> {
  const presets = await loadPresets(library)
  const i = presets.findIndex((p) => p.name === name)
  const j = i + by
  if (i < 0 || j < 0 || j >= presets.length) return
  const next = [...presets]
  ;[next[i], next[j]] = [next[j]!, next[i]!]
  await renumber(library, next)
  changed()
}

/** Makes a preset its table kind's default (or not); one default per kind. */
export async function setDefaultPreset(library: Library, name: string, on: boolean): Promise<void> {
  const presets = await loadPresets(library)
  const p = presets.find((x) => x.name === name)
  if (!p) return
  const kind: TableKind = p.recipe.tableKind
  for (const x of presets) {
    const want = x === p ? on : x.recipe.tableKind === kind && on ? false : !!x.isDefault
    if (want !== !!x.isDefault) await put(library, { ...x, isDefault: want })
  }
  changed()
}

/** A preset file's text read into the library under a free name (returned). */
export async function importPreset(library: Library, text: string): Promise<UserPreset> {
  const read = readPreset(text)
  const presets = await loadPresets(library)
  const name = uniquePresetName(
    read.name,
    presets.map((p) => p.name),
  )
  const preset: UserPreset = { ...read, name, order: presets.length, isDefault: false }
  const { isDefault: _, ...stored } = preset
  await put(library, stored)
  changed()
  return preset
}

/** A preset as a file to share (without the library's order and default). */
export const exportPreset = (p: UserPreset): string => writePreset(p, { exported: true })

// --- Change notices ----------------------------------------------------------------------------

const listeners = new Set<() => void>()
let generation = 0
function changed() {
  generation++
  for (const l of listeners) l()
}

/**
 * The user's presets, read again after every change; `loaded` once the first read finished (a
 * table kind's default is chosen then). Without a library (none on this platform): none.
 */
export function usePresetLibrary(): {
  library: Library | undefined
  presets: UserPreset[]
  loaded: boolean
} {
  const library = useServices().platform.presets
  const [state, setState] = useState<{ presets: UserPreset[]; loaded: boolean }>({
    presets: (library && cache.get(library)) || [],
    loaded: !library || cache.has(library),
  })
  const [gen, setGen] = useState(generation)
  useEffect(() => {
    const l = () => setGen(generation)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
  useEffect(() => {
    void gen
    if (!library) {
      setState({ presets: [], loaded: true })
      return
    }
    let live = true
    loadPresets(library).then(
      (presets) => {
        cache.set(library, presets)
        if (live) setState({ presets, loaded: true })
      },
      () => live && setState({ presets: [], loaded: true }),
    )
    return () => {
      live = false
    }
  }, [library, gen])
  return { library, ...state }
}

/** The last list read per library, so a builder opened again starts with it. */
const cache = new WeakMap<object, UserPreset[]>()
