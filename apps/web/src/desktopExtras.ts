import { PROJECT_EXTENSION } from '@ps/io'
import type { AvailableUpdate, OpenedFiles, Updates } from '@ps/ui'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { relaunch } from '@tauri-apps/plugin-process'
import { check } from '@tauri-apps/plugin-updater'

// The desktop app's side of roadmap 41: files the operating system opens with the app, updates,
// and the window's colours. The Rust side is apps/desktop/src-tauri/src/lib.rs and open_files.rs.

const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path

/**
 * Files opened from the Finder, Explorer or the Dock: the shell keeps their paths until taken,
 * and reads each one once for the webview (`read_opened_file`: they never enter the file-system
 * plugin's scope; decision 656); the `opened-files` event says more are waiting.
 */
export const desktopOpenedFiles = (): OpenedFiles => ({
  async take() {
    const paths = await invoke<string[]>('take_opened_files')
    const files = []
    for (const path of paths) {
      try {
        const bytes = new Uint8Array(await invoke<ArrayBuffer>('read_opened_file', { path }))
        const name = baseName(path)
        // A project keeps its path, so Save writes it and Open recent remembers it.
        const handle = name.toLowerCase().endsWith(`.${PROJECT_EXTENSION}`) ? path : null
        files.push({ name, blob: new Blob([bytes as BlobPart]), handle })
      } catch (e) {
        console.warn(`Couldn’t read ${path}:`, e)
      }
    }
    return files
  },
  subscribe(ready) {
    let stop: (() => void) | null = null
    let stopped = false
    void listen('opened-files', () => ready()).then((un) => {
      if (stopped) un()
      else stop = un
    })
    return () => {
      stopped = true
      stop?.()
    }
  },
})

/**
 * Updates from the latest GitHub Release (Tauri's updater plugin), in builds made with an update
 * key; others say they have none (`updates_supported`).
 */
export const desktopUpdates = (): Updates => ({
  supported: () => invoke<boolean>('updates_supported').catch(() => false),
  async check() {
    const update = await check()
    if (!update) return null
    const found: AvailableUpdate = {
      version: update.version,
      notes: update.body ?? '',
      ...(update.date ? { date: update.date } : {}),
      async install(progress) {
        let total: number | null = null
        let done = 0
        await update.downloadAndInstall((event) => {
          if (event.event === 'Started') {
            total = event.data.contentLength ?? null
            progress?.(total ? 0 : null)
          } else if (event.event === 'Progress') {
            done += event.data.chunkLength
            progress?.(total ? Math.min(1, done / total) : null)
          } else progress?.(1)
        })
        await relaunch()
      },
    }
    return found
  },
})

/** The title bar follows the app's colours (null: the system's). */
export function setWindowColorScheme(scheme: 'light' | 'dark' | null) {
  getCurrentWindow()
    .setTheme(scheme)
    .catch(() => {})
}
