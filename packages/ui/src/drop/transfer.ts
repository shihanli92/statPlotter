import type { DroppedFile } from './dropQueue.ts'

// The files a drag, a drop or a paste carries (roadmaps 32 and 39), read one way by the window's
// drop queue and by a layout page (its images placed where dropped or pasted).

/**
 * Whether a drag, drop or paste carries files (not only text, or an element of the page). Some
 * browsers list a pasted image only among the items.
 */
export const carriesFiles = (data: DataTransfer | null): boolean =>
  !!data && ([...data.types].includes('Files') || [...data.items].some((i) => i.kind === 'file'))

/**
 * The files of a drop or paste: its items' (where some browsers put a pasted image only), else
 * its `files`; with file-system handles where the browser gives them (Chromium:
 * `getAsFileSystemHandle`, which must be asked for during the event, as the items are read).
 */
export async function transferFiles(data: DataTransfer | null): Promise<DroppedFile[]> {
  if (!data) return []
  const items = [...data.items].filter((i) => i.kind === 'file')
  const handles = items.map((i) => {
    const get = (i as { getAsFileSystemHandle?: () => Promise<unknown> }).getAsFileSystemHandle
    return get ? get.call(i).catch(() => null) : Promise.resolve(null)
  })
  const files = items.length
    ? items.map((i) => i.getAsFile()).filter((f): f is File => f !== null)
    : [...data.files]
  const resolved = await Promise.all(handles)
  return files.map((f, k) => {
    const h = resolved[k] as { kind?: string } | null | undefined
    return { name: f.name, blob: f, handle: h && h.kind === 'file' ? h : null }
  })
}

/** The files' names and bytes, in order. */
export const readFiles = (
  files: readonly { name: string; blob: Blob }[],
): Promise<{ name: string; bytes: Uint8Array }[]> =>
  Promise.all(
    files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.blob.arrayBuffer()) })),
  )
