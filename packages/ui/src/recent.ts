// Open recent: the platform remembers up to MAX_RECENT project files, most recent first (desktop:
// paths in localStorage; web: File System Access handles in IndexedDB, Chromium only).

export const MAX_RECENT = 10

/** A remembered project file. */
export interface RecentFile {
  name: string
  /** The full path where there is one (desktop), shown as a hint. */
  path?: string
  /** What the platform reopens it from (a path, a file handle). */
  handle: unknown
}

/** `item` first, without the entries that are the same file, at most `max`. */
export function addRecent<T>(
  list: readonly T[],
  item: T,
  same: (a: T, b: T) => boolean,
  max = MAX_RECENT,
): T[] {
  return [item, ...list.filter((x) => !same(x, item))].slice(0, max)
}

/** Reads a stored list defensively (storage is outside the app's control). */
export function parseRecentPaths(json: string | null): { name: string; path: string }[] {
  try {
    const v: unknown = JSON.parse(json ?? '[]')
    if (!Array.isArray(v)) return []
    return v
      .filter(
        (x): x is { name: string; path: string } =>
          typeof x === 'object' &&
          x !== null &&
          typeof (x as { name?: unknown }).name === 'string' &&
          typeof (x as { path?: unknown }).path === 'string',
      )
      .map(({ name, path }) => ({ name, path }))
      .slice(0, MAX_RECENT)
  } catch {
    return []
  }
}
