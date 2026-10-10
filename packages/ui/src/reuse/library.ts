import { fileBaseOf } from '../graph/exportSettings.ts'
import type { Library, LibraryEntry } from '../services.ts'

// The user's templates and methods on disk (desktop: folders in the app data folder), one file
// per entry named after it. The web keeps them in IndexedDB (apps/web/src/library.ts).

/** A folder's files, as the platform reads and writes them (names relative to the folder). */
export interface LibraryFolder {
  ensure(): Promise<void>
  list(): Promise<{ name: string; modified?: number }[]>
  read(name: string): Promise<Uint8Array>
  write(name: string, bytes: Uint8Array): Promise<void>
  rename(from: string, to: string): Promise<void>
  remove(name: string): Promise<void>
}

/** An entry's file name: its name made file-safe, with the extension. */
const libraryFileName = (name: string, ext: string) => `${fileBaseOf(name, 'untitled')}.${ext}`

/**
 * A library in a folder: `<name>.<ext>` files, each written to a temporary name and renamed into
 * place so a failed write never leaves half a file. Listed by name, newest first where the
 * platform says when a file changed.
 */
export function folderLibrary(folder: LibraryFolder, ext: string): Library {
  const suffix = `.${ext}`
  return {
    async list() {
      let files: { name: string; modified?: number }[]
      try {
        files = await folder.list()
      } catch {
        return [] // No folder yet: nothing saved.
      }
      return files
        .filter((f) => f.name.toLowerCase().endsWith(suffix) && f.name.length > suffix.length)
        .map((f): LibraryEntry => ({ name: f.name.slice(0, -suffix.length), modified: f.modified }))
        .sort((a, b) => (b.modified ?? 0) - (a.modified ?? 0) || a.name.localeCompare(b.name))
    },
    async read(name) {
      try {
        return await folder.read(libraryFileName(name, ext))
      } catch {
        return null
      }
    },
    async write(name, bytes) {
      await folder.ensure()
      const file = libraryFileName(name, ext)
      await folder.write(`${file}.tmp`, bytes)
      await folder.rename(`${file}.tmp`, file)
    },
    async remove(name) {
      await folder.remove(libraryFileName(name, ext))
    },
  }
}

/** A library kept in memory only (lost on reload): where no storage works. */
export function memoryLibrary(): Library {
  const files = new Map<string, { bytes: Uint8Array; modified: number }>()
  let clock = 0
  return {
    async list() {
      return [...files.entries()]
        .map(([name, f]) => ({ name, modified: f.modified }))
        .sort((a, b) => b.modified - a.modified)
    },
    async read(name) {
      return files.get(name)?.bytes ?? null
    },
    async write(name, bytes) {
      files.set(name, { bytes, modified: Date.now() + clock++ / 1000 })
    },
    async remove(name) {
      files.delete(name)
    },
  }
}

/**
 * A library that keeps working when its storage fails (a browser's private mode or blocked
 * IndexedDB): from the first failure on, an in-memory library holding what was read until then
 * and what is written after.
 */
export function resilientLibrary(primary: Library | undefined): Library {
  const memory = memoryLibrary()
  let failed = !primary
  const attempt = async <T>(op: (l: Library) => Promise<T>): Promise<T> => {
    if (!failed && primary)
      try {
        return await op(primary)
      } catch {
        failed = true
        console.warn(
          'Kept in memory only (presets, styles, preferences): the browser storage is unavailable.',
        )
      }
    return op(memory)
  }
  return {
    list: () => attempt((l) => l.list()),
    read: (name) => attempt((l) => l.read(name)),
    write: (name, bytes) => attempt((l) => l.write(name, bytes)),
    remove: (name) => attempt((l) => l.remove(name)),
  }
}
