import { folderLibrary, type Library, resilientLibrary } from '@ps/ui'
import {
  BaseDirectory,
  mkdir,
  readDir,
  readFile,
  remove,
  rename,
  writeFile,
} from '@tauri-apps/plugin-fs'

// The user's templates and methods (roadmap 31) and graph presets (roadmap 33c) for each platform (see packages/ui/src/reuse/library.ts).

// ---------------------------------------------------------------------------------------------
// Browser: IndexedDB in the app's origin, its own database (the Open recent and recovery ones keep
// their versions): a store per library, entries by name with the bytes and when they were saved.
// Templates are kept when saved or opened, so New from template lists the recent ones.
// ---------------------------------------------------------------------------------------------

const DB = 'plotting-software-library'
const STORES = ['templates', 'methods', 'presets', 'styles', 'settings'] as const
/** Recent templates kept in a browser (the oldest go first); methods are all kept. */
const MAX_TEMPLATES = 50

interface Stored {
  name: string
  modified: number
  bytes: Uint8Array
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // Version 2 added the presets' store; 3 (roadmap 37) the styles' and the settings'.
    const open = indexedDB.open(DB, 3)
    open.onupgradeneeded = () => {
      for (const s of STORES)
        if (!open.result.objectStoreNames.contains(s)) open.result.createObjectStore(s)
    }
    open.onerror = () => reject(open.error)
    open.onsuccess = () => resolve(open.result)
  })
}

async function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  op: (s: IDBObjectStore) => IDBRequest | undefined,
): Promise<T> {
  const db = await openDb()
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode)
    const req = op(t.objectStore(store))
    t.oncomplete = () => {
      db.close()
      resolve(req?.result as T)
    }
    t.onerror = t.onabort = () => {
      db.close()
      reject(t.error)
    }
  })
}

const isStored = (v: unknown): v is Stored =>
  typeof (v as Stored)?.name === 'string' && (v as Stored).bytes instanceof Uint8Array

export function idbLibrary(store: (typeof STORES)[number]): Library | undefined {
  if (typeof indexedDB === 'undefined') return undefined
  const all = async () =>
    ((await tx<unknown[]>(store, 'readonly', (s) => s.getAll())) ?? [])
      .filter(isStored)
      .sort((a, b) => b.modified - a.modified)
  return {
    async list() {
      return (await all()).map(({ name, modified }) => ({ name, modified }))
    },
    async read(name) {
      const v = await tx<unknown>(store, 'readonly', (s) => s.get(name))
      return isStored(v) ? v.bytes : null
    },
    async write(name, bytes) {
      const entry: Stored = { name, modified: Date.now(), bytes }
      await tx(store, 'readwrite', (s) => s.put(entry, name))
      const old = store === 'templates' ? (await all()).slice(MAX_TEMPLATES) : []
      if (old.length)
        await tx(store, 'readwrite', (s) => {
          for (const e of old) s.delete(e.name)
          return undefined
        })
    },
    async remove(name) {
      await tx(store, 'readwrite', (s) => s.delete(name))
    },
  }
}

/** The presets' library: IndexedDB, in memory from the first time it fails (or where it's absent). */
export const idbPresets = (): Library => resilientLibrary(idbLibrary('presets'))

/** The styles' library and the preferences (roadmap 37), likewise. */
export const idbStyles = (): Library => resilientLibrary(idbLibrary('styles'))
export const idbSettings = (): Library => resilientLibrary(idbLibrary('settings'))

// ---------------------------------------------------------------------------------------------
// Desktop: folders in the app data folder (in the fs plugin's scope, see capabilities), one file
// per entry: templates/<name>.pstemplate, methods/<name>.psmethod, presets/<name>.pspreset,
// styles/<name>.psstyle and settings/preferences.json (roadmap 37).
// ---------------------------------------------------------------------------------------------

const inAppData = { baseDir: BaseDirectory.AppData }

export function desktopLibrary(
  dir: 'templates' | 'methods' | 'presets' | 'styles' | 'settings',
  ext: string,
): Library {
  const at = (name: string) => `${dir}/${name}`
  return folderLibrary(
    {
      ensure: () => mkdir(dir, { ...inAppData, recursive: true }),
      list: async () =>
        (await readDir(dir, inAppData)).filter((e) => e.isFile).map((e) => ({ name: e.name })),
      read: (name) => readFile(at(name), inAppData),
      write: (name, bytes) => writeFile(at(name), bytes, inAppData),
      rename: (from, to) =>
        rename(at(from), at(to), {
          oldPathBaseDir: BaseDirectory.AppData,
          newPathBaseDir: BaseDirectory.AppData,
        }),
      remove: (name) => remove(at(name), inAppData),
    },
    ext,
  )
}
