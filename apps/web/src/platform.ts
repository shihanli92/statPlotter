import { PROJECT_EXTENSION, readProjectFile, TEMPLATE_EXTENSION } from '@ps/io'
import { PRESET_EXTENSION, STYLE_EXTENSION } from '@ps/model'
import {
  type ClipboardFormat,
  type ExportData,
  isMacPlatform,
  METHOD_EXTENSION,
  type Platform,
  resilientLibrary,
} from '@ps/ui'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { join } from '@tauri-apps/api/path'
import { open, save } from '@tauri-apps/plugin-dialog'
import { readFile, writeFile } from '@tauri-apps/plugin-fs'
import { desktopOpenedFiles, desktopUpdates, setWindowColorScheme } from './desktopExtras.ts'
import { desktopLibrary, idbLibrary, idbPresets, idbSettings, idbStyles } from './library.ts'
import { setNativeMenus } from './nativeMenu.ts'
import { desktopRecentFiles, webRecentFiles } from './recent.ts'
import { desktopRecoveryStorage, idbRecoveryStorage } from './recovery.ts'

const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path

/**
 * Development only: a file from the repository's local `source_data/` folder (journal source
 * data, never committed), served by the dev server (see vite.config.ts). Deployed builds have no
 * such route and always get null.
 */
async function readSourceData(path: string): Promise<Uint8Array | null> {
  if (!import.meta.env.DEV) return null
  try {
    const url = `/__source_data/${path.split('/').map(encodeURIComponent).join('/')}`
    const res = await fetch(url)
    return res.ok ? new Uint8Array(await res.arrayBuffer()) : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------------------------
// Browser: File System Access API where available (Chromium), download/upload elsewhere.
// ---------------------------------------------------------------------------------------------

interface FsHandle {
  name: string
  getFile(): Promise<File>
  queryPermission?(opts: { mode: 'readwrite' }): Promise<PermissionState>
  requestPermission?(opts: { mode: 'readwrite' }): Promise<PermissionState>
  createWritable(): Promise<{
    write(data: BufferSource | Blob | string): Promise<void>
    close(): Promise<void>
  }>
}

type PickerWindow = Window & {
  showOpenFilePicker?: (opts: unknown) => Promise<FsHandle[]>
  showSaveFilePicker?: (opts: unknown) => Promise<FsHandle>
}

const w = window as PickerWindow
const projectTypes = [
  { description: 'Project', accept: { 'application/octet-stream': [`.${PROJECT_EXTENSION}`] } },
]
const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError'

function download(data: Uint8Array | string, name: string, mime: string) {
  const blob = new Blob([data as BlobPart], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function pickFileViaInput(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.oncancel = () => resolve(null)
    input.click()
  })
}

/** A file's contents, made now when given as a function (after the save location is chosen). */
const contents = (data: ExportData | (() => Promise<ExportData>)) =>
  typeof data === 'function' ? data() : Promise.resolve(data)

const fileBytes = async (file: File) => ({
  name: file.name,
  bytes: new Uint8Array(await file.arrayBuffer()),
})

/**
 * Writes through the File System Access API. `createWritable` writes to a swap file that
 * replaces the file only on `close()` (Chromium), so a failed or interrupted save leaves the
 * file as it was.
 */
async function writeHandle(handle: FsHandle, data: Uint8Array | string) {
  const writable = await handle.createWritable()
  await writable.write(data as BufferSource | string)
  await writable.close()
}

/**
 * A remembered handle (Open recent, a recovered project) may need the user's permission to
 * write again after a restart; false if they declined.
 */
async function mayWrite(handle: FsHandle): Promise<boolean> {
  const opts = { mode: 'readwrite' as const }
  let state = (await handle.queryPermission?.(opts)) ?? 'granted'
  if (state !== 'granted') state = (await handle.requestPermission?.(opts)) ?? 'denied'
  return state === 'granted'
}

const webRecent = isTauri() ? undefined : webRecentFiles()
const webRecovery = isTauri() ? undefined : idbRecoveryStorage({ keepHandles: !!webRecent })
const webTemplates = isTauri() ? undefined : idbLibrary('templates')
const webMethods = isTauri() ? undefined : idbLibrary('methods')
const webPresets = isTauri() ? undefined : idbPresets()
const webStyles = isTauri() ? undefined : idbStyles()
const webSettings = isTauri() ? undefined : idbSettings()

const webPlatform: Platform = {
  kind: 'web',
  ...(import.meta.env.DEV ? { readSourceData } : {}),
  ...(webRecent ? { recent: webRecent } : {}),
  ...(webRecovery ? { recovery: webRecovery } : {}),
  ...(webTemplates ? { templates: webTemplates } : {}),
  ...(webMethods ? { methods: webMethods } : {}),
  ...(webPresets ? { presets: webPresets } : {}),
  ...(webStyles ? { styles: webStyles } : {}),
  ...(webSettings ? { settings: webSettings } : {}),
  async openProject() {
    if (w.showOpenFilePicker) {
      try {
        const [handle] = await w.showOpenFilePicker({ types: projectTypes })
        return handle ? { ...(await fileBytes(await handle.getFile())), handle } : null
      } catch (e) {
        if (isAbort(e)) return null
        throw e
      }
    }
    const file = await pickFileViaInput(`.${PROJECT_EXTENSION}`)
    return file ? { ...(await fileBytes(file)), handle: null } : null
  },
  async openFile(_description, extensions) {
    const file = await pickFileViaInput(extensions.map((e) => `.${e}`).join(','))
    return file ? fileBytes(file) : null
  },
  async openData(_description, extensions) {
    const file = await pickFileViaInput(extensions.map((e) => `.${e}`).join(','))
    return file ? { name: file.name, blob: file } : null
  },
  async saveProject(bytes, suggestedName, handle) {
    const made = () => (typeof bytes === 'function' ? bytes() : Promise.resolve(bytes))
    try {
      // Declined permission for a remembered file: ask where instead.
      if (handle && (await mayWrite(handle as FsHandle))) {
        await writeHandle(handle as FsHandle, await made())
        return { name: (handle as FsHandle).name, handle }
      }
      if (w.showSaveFilePicker) {
        const h = await w.showSaveFilePicker({ suggestedName, types: projectTypes })
        await writeHandle(h, await made())
        return { name: h.name, handle: h }
      }
      download(await made(), suggestedName, 'application/octet-stream')
      return { name: suggestedName, handle: null }
    } catch (e) {
      if (isAbort(e)) return null
      throw e
    }
  },
  async exportFile(data, suggestedName, mime) {
    if (w.showSaveFilePicker) {
      // The picker first, while the click still counts as the user's (Chromium requires it).
      let h: FsHandle
      try {
        const ext = suggestedName.split('.').pop()!
        h = await w.showSaveFilePicker({
          suggestedName,
          types: [{ description: ext.toUpperCase(), accept: { [mime]: [`.${ext}`] } }],
        })
      } catch (e) {
        if (!isAbort(e)) throw e
        return
      }
      await writeHandle(h, await contents(data))
      return
    }
    download(await contents(data), suggestedName, mime)
  },
}

// ---------------------------------------------------------------------------------------------
// Desktop (Tauri): native dialogs and file access; the macOS pasteboard in Rust.
// ---------------------------------------------------------------------------------------------

const encoder = new TextEncoder()
const bytesOf = (data: ExportData) => (typeof data === 'string' ? encoder.encode(data) : data)

/** A file chosen in the native open dialog, read; its path is the handle. */
async function openPath(name: string, extensions: string[]) {
  const path = await open({ multiple: false, directory: false, filters: [{ name, extensions }] })
  return path ? { name: baseName(path), bytes: await readFile(path), handle: path } : null
}

const desktopPlatform: Platform = {
  ...(import.meta.env.DEV ? { readSourceData } : {}),
  kind: 'desktop',
  setMenus: setNativeMenus,
  recovery: desktopRecoveryStorage(),
  templates: desktopLibrary('templates', TEMPLATE_EXTENSION),
  methods: desktopLibrary('methods', METHOD_EXTENSION),
  presets: desktopLibrary('presets', PRESET_EXTENSION),
  styles: resilientLibrary(desktopLibrary('styles', STYLE_EXTENSION)),
  settings: resilientLibrary(desktopLibrary('settings', 'json')),
  // A remembered project is read by the shell (`read_project_file`, .psproj only), never put in
  // the file-system plugin's scope (decision 656).
  recent: desktopRecentFiles({
    read: async (path) => new Uint8Array(await invoke<ArrayBuffer>('read_project_file', { path })),
    baseName,
  }),
  openProject: () => openPath('Project', [PROJECT_EXTENSION]),
  openFile: (description, extensions) => openPath(description, [...extensions]),
  async openData(description, extensions) {
    const f = await openPath(description, [...extensions])
    return f ? { name: f.name, blob: new Blob([f.bytes as BlobPart]) } : null
  },
  async saveProject(bytes, suggestedName, handle) {
    const path =
      (handle as string | null) ??
      (await save({
        defaultPath: suggestedName,
        filters: [{ name: 'Project', extensions: [PROJECT_EXTENSION] }],
      }))
    if (!path) return null
    const made = typeof bytes === 'function' ? await bytes() : bytes
    // What is written must open again; the Rust side checks the disk gives back these bytes.
    readProjectFile(made)
    await saveAtomically(path, made)
    return { name: baseName(path), handle: path }
  },
  async exportFile(data, suggestedName) {
    const ext = suggestedName.split('.').pop()!
    const path = await save({
      defaultPath: suggestedName,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    })
    if (!path) return
    await writeFile(path, bytesOf(await contents(data)))
  },
  // Batch export: the dialog plugin lets the webview write in the folder picked (for the session).
  async pickFolder() {
    const dir = await open({ directory: true, multiple: false, recursive: false })
    if (!dir) return null
    return {
      name: baseName(dir),
      write: async (fileName, data) => writeFile(await join(dir, fileName), bytesOf(data)),
    }
  },
  // Copy as vector: PDF, PNG and SVG on the macOS pasteboard (Rust). Elsewhere (WebView2,
  // WebKitGTK) the webview's own clipboard API: PNG, SVG where it takes it, the SVG code as text.
  ...(isMacPlatform() ? { copyGraphics, clipboardStamp } : {}),
  // Roadmap 41: files opened from the operating system, updates, the title bar's colours.
  openedFiles: desktopOpenedFiles(),
  updates: desktopUpdates(),
  setColorScheme: setWindowColorScheme,
}

/**
 * Atomic save (save.rs): `<file>.tmp` written and read back, the previous version kept as
 * `<file>.bak`, then renamed over the file. One binary request: the path, then the bytes.
 */
async function saveAtomically(path: string, bytes: Uint8Array) {
  const p = encoder.encode(path)
  const body = new Uint8Array(p.length + bytes.length)
  body.set(p)
  body.set(bytes, p.length)
  await invoke('save_project_file', body, { headers: { 'x-path-length': String(p.length) } })
}

/**
 * One binary request: the SVG, the PNG, then the PDF, the first two's lengths in headers (see
 * clipboard.rs).
 */
async function copyGraphics(svg: string, png: Uint8Array, pdf: Uint8Array) {
  const text = encoder.encode(svg)
  const body = new Uint8Array(text.length + png.length + pdf.length)
  body.set(text)
  body.set(png, text.length)
  body.set(pdf, text.length + png.length)
  const stamp = await invoke<number>('copy_graphics', body, {
    headers: { 'x-svg-length': String(text.length), 'x-png-length': String(png.length) },
  })
  return { formats: ['pdf', 'png', 'svg'] satisfies ClipboardFormat[], stamp }
}

function clipboardStamp() {
  return invoke<number>('clipboard_change_count')
}

export const platform: Platform = isTauri() ? desktopPlatform : webPlatform
