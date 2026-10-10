import {
  folderRecoveryStorage,
  parseRecoveryRecord,
  type RecoveryRecord,
  type RecoveryStorage,
} from '@ps/ui'
import {
  BaseDirectory,
  mkdir,
  readDir,
  readFile,
  remove,
  rename,
  writeFile,
} from '@tauri-apps/plugin-fs'

// Recovery copies' storage for each platform (see packages/ui/src/recovery.ts).

// ---------------------------------------------------------------------------------------------
// Browser: IndexedDB in the app's origin. Chosen over the origin-private file system because it
// is in every engine the app supports with the same API (OPFS writes from the page need
// createWritable, which Safari lacks), writes the record and the copy in one transaction, and
// can keep a File System Access handle so Save goes back to the same file. Its own database, so
// the Open recent database's version is left alone.
// ---------------------------------------------------------------------------------------------

const DB = 'plotting-software-recovery'
const RECORDS = 'records'
const COPIES = 'copies'

interface StoredCopy {
  bytes: Uint8Array
  handle: unknown
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1)
    open.onupgradeneeded = () => {
      open.result.createObjectStore(RECORDS)
      open.result.createObjectStore(COPIES)
    }
    open.onerror = () => reject(open.error)
    open.onsuccess = () => resolve(open.result)
  })
}

/**
 * The page's connection, kept open (opened at start by `open()`): a write started in `pagehide`
 * then creates its transaction and issues its requests before the handler returns, where
 * waiting for `indexedDB.open` would wait past the page's end. Given up when another page wants
 * to upgrade the database or the browser closes it; the next operation reopens it.
 */
let connection: IDBDatabase | null = null
let opening: Promise<IDBDatabase> | null = null

function connect(): IDBDatabase | Promise<IDBDatabase> {
  if (connection) return connection
  opening ??= openDb().then(
    (db) => {
      const drop = () => {
        if (connection === db) connection = null
        db.close()
      }
      db.onversionchange = drop
      db.onclose = drop
      connection = db
      opening = null
      return db
    },
    (e) => {
      opening = null
      throw e
    },
  )
  return opening
}

/**
 * Runs `op` in one transaction over both stores; resolves with its result when committed. With
 * the connection open, the transaction and its requests are made synchronously, and a write asks
 * for its commit at once (`commit()`, where there is one) rather than when control returns to the
 * event loop, which a closing page may not do.
 */
function tx<T>(
  mode: IDBTransactionMode,
  op: (records: IDBObjectStore, copies: IDBObjectStore) => IDBRequest | undefined,
): Promise<T> {
  const run = (db: IDBDatabase) =>
    new Promise<T>((resolve, reject) => {
      let t: IDBTransaction
      try {
        t = db.transaction([RECORDS, COPIES], mode)
      } catch (e) {
        // Closed under us: the next operation reopens it.
        if (connection === db) connection = null
        reject(e)
        return
      }
      const req = op(t.objectStore(RECORDS), t.objectStore(COPIES))
      t.oncomplete = () => resolve(req?.result as T)
      t.onerror = t.onabort = () => reject(t.error)
      if (mode === 'readwrite') t.commit?.()
    })
  const db = connect()
  return db instanceof Promise ? db.then(run) : run(db)
}

/**
 * `keepHandles`: store the File System Access handle with the copy. Only where Open recent
 * stores handles too (Chromium with the open picker): storing one crashes Playwright's
 * Chromium, whose tests take the pickers away.
 */
export function idbRecoveryStorage(opts: { keepHandles: boolean }): RecoveryStorage | undefined {
  if (typeof indexedDB === 'undefined') return undefined
  return {
    open() {
      const db = connect()
      if (db instanceof Promise) db.catch(() => {})
    },
    async list() {
      let keys: IDBValidKey[] = []
      let values: unknown[] = []
      await tx('readonly', (records) => {
        const k = records.getAllKeys()
        const v = records.getAll()
        k.onsuccess = () => {
          keys = k.result
        }
        v.onsuccess = () => {
          values = v.result
        }
        return undefined
      })
      const out: RecoveryRecord[] = []
      const damaged: IDBValidKey[] = []
      values.forEach((v, i) => {
        const r = parseRecoveryRecord(v)
        if (r && r.session === keys[i]) out.push(r)
        else damaged.push(keys[i]!)
      })
      // A record that doesn't parse (damaged, or from another version) can never be offered.
      if (damaged.length)
        await tx('readwrite', (records, copies) => {
          for (const k of damaged) {
            records.delete(k)
            copies.delete(k)
          }
          return undefined
        }).catch(() => {})
      return out
    },
    async read(session) {
      let record: unknown
      let copy: StoredCopy | undefined
      await tx('readonly', (records, copies) => {
        const r = records.get(session)
        const c = copies.get(session)
        r.onsuccess = () => {
          record = r.result
        }
        c.onsuccess = () => {
          copy = c.result as StoredCopy | undefined
        }
        return undefined
      })
      const parsed = parseRecoveryRecord(record)
      if (!parsed || !(copy?.bytes instanceof Uint8Array)) return null
      return { record: parsed, bytes: copy.bytes, handle: copy.handle ?? null }
    },
    async write(slot) {
      const copy: StoredCopy = {
        bytes: slot.bytes,
        handle: opts.keepHandles && slot.handle ? slot.handle : null,
      }
      await tx('readwrite', (records, copies) => {
        copies.put(copy, slot.record.session)
        return records.put(slot.record, slot.record.session)
      })
    },
    async remove(session) {
      await tx('readwrite', (records, copies) => {
        records.delete(session)
        return copies.delete(session)
      })
    },
  }
}

// ---------------------------------------------------------------------------------------------
// Desktop: the app data folder's `recovery/` (in the fs plugin's scope, see
// capabilities/default.json), each file written to a temporary name and renamed into place.
// ---------------------------------------------------------------------------------------------

const DIR = 'recovery'
const inAppData = { baseDir: BaseDirectory.AppData }

export function desktopRecoveryStorage(): RecoveryStorage {
  const at = (name: string) => `${DIR}/${name}`
  return folderRecoveryStorage({
    ensure: () => mkdir(DIR, { ...inAppData, recursive: true }),
    list: async () => (await readDir(DIR, inAppData)).filter((e) => e.isFile).map((e) => e.name),
    read: (name) => readFile(at(name), inAppData),
    write: (name, bytes) => writeFile(at(name), bytes, inAppData),
    rename: (from, to) =>
      rename(at(from), at(to), {
        oldPathBaseDir: BaseDirectory.AppData,
        newPathBaseDir: BaseDirectory.AppData,
      }),
    remove: (name) => remove(at(name), inAppData),
  })
}
