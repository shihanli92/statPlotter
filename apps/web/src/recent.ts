import { addRecent, parseRecentPaths, type RecentFile, type RecentFiles } from '@ps/ui'

// Open recent for each platform (see packages/ui/src/recent.ts).

// ---------------------------------------------------------------------------------------------
// Browser (Chromium): File System Access handles kept in IndexedDB, which can store them. Reading
// one again needs the user's permission, asked on reopening.
// ---------------------------------------------------------------------------------------------

interface FileHandle {
  name: string
  kind: 'file'
  getFile(): Promise<File>
  isSameEntry(other: unknown): Promise<boolean>
  queryPermission?(opts: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
  requestPermission?(opts: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
}

const DB = 'plotting-software'
const STORE = 'recent'
const KEY = 'files'

function idb<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1)
    open.onupgradeneeded = () => open.result.createObjectStore(STORE)
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      const tx = db.transaction(STORE, mode)
      const req = op(tx.objectStore(STORE))
      tx.oncomplete = () => {
        db.close()
        resolve(req.result as T)
      }
      tx.onerror = () => {
        db.close()
        reject(tx.error)
      }
    }
  })
}

const readHandles = async (): Promise<RecentFile[]> => {
  const v = await idb<unknown>('readonly', (s) => s.get(KEY))
  return Array.isArray(v)
    ? v.filter((x): x is RecentFile => typeof x?.name === 'string' && typeof x?.handle === 'object')
    : []
}
const writeHandles = (list: RecentFile[]) => idb('readwrite', (s) => s.put(list, KEY))

export function webRecentFiles(): RecentFiles | undefined {
  if (typeof indexedDB === 'undefined' || !('showOpenFilePicker' in window)) return undefined
  return {
    list: readHandles,
    async add(file) {
      const handle = file.handle as FileHandle
      const list = await readHandles()
      const same = new Set<RecentFile>()
      for (const r of list) if (await handle.isSameEntry(r.handle).catch(() => false)) same.add(r)
      const next = addRecent(list, { name: file.name, handle }, (a) => same.has(a))
      await writeHandles(next)
      return next
    },
    async remove(file) {
      // Handles read back from IndexedDB are new objects: compare them as entries.
      const handle = file.handle as FileHandle
      const out: RecentFile[] = []
      for (const r of await readHandles())
        if (!(await handle.isSameEntry(r.handle).catch(() => false))) out.push(r)
      await writeHandles(out)
      return out
    },
    clear: () => writeHandles([]).then(() => {}),
    async open(file) {
      const handle = file.handle as FileHandle
      const opts = { mode: 'readwrite' as const }
      let state = (await handle.queryPermission?.(opts)) ?? 'granted'
      if (state !== 'granted') state = (await handle.requestPermission?.(opts)) ?? 'denied'
      if (state !== 'granted') return null
      const f = await handle.getFile()
      return { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()), handle }
    },
  }
}

// ---------------------------------------------------------------------------------------------
// Desktop: paths in localStorage (one origin: the app's own). The file-system scope has a picked
// file for the session only, so after a restart the shell reads a remembered path itself (the
// `read_project_file` command, .psproj files only; decision 656).
// ---------------------------------------------------------------------------------------------

const PATHS_KEY = 'ps.recentFiles'

export function desktopRecentFiles(opts: {
  read: (path: string) => Promise<Uint8Array>
  baseName: (path: string) => string
}): RecentFiles {
  const load = (): RecentFile[] => {
    try {
      return parseRecentPaths(localStorage.getItem(PATHS_KEY)).map((r) => ({
        ...r,
        handle: r.path,
      }))
    } catch {
      return []
    }
  }
  const store = (list: RecentFile[]) => {
    try {
      localStorage.setItem(
        PATHS_KEY,
        JSON.stringify(list.map((r) => ({ name: r.name, path: r.path }))),
      )
    } catch {}
    return list
  }
  return {
    list: async () => load(),
    add: async (file) => {
      const path = file.handle as string
      return store(
        addRecent(load(), { name: file.name, path, handle: path }, (a, b) => a.path === b.path),
      )
    },
    remove: async (file) => store(load().filter((r) => r.path !== file.path)),
    clear: async () => void store([]),
    async open(file) {
      const path = file.handle as string
      return { name: opts.baseName(path), bytes: await opts.read(path), handle: path }
    },
  }
}
