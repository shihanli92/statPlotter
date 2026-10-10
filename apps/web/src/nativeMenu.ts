import {
  isMacPlatform,
  type MenuModel,
  type NativeItem,
  nativeCommandItems,
  nativeMenuSpec,
  nativeStructureKey,
} from '@ps/ui'
import type { Resource } from '@tauri-apps/api/core'
import { CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu } from '@tauri-apps/api/menu'

// The desktop app's native menu bar, built from the command registry's menus (see
// packages/ui/src/commands/native.ts for the model and how shortcuts are handled). Updates are
// debounced and serialized; when only labels, enabled or checked states change, the items are
// updated in place, otherwise the menu bar is rebuilt.

const APP_NAME = 'statPlotter'
const DEBOUNCE_MS = 100

type CommandSpec = NativeItem & { kind: 'command' }

let latest: { menus: MenuModel[]; run: (id: string) => void } | null = null
let timer: ReturnType<typeof setTimeout> | undefined
let queue: Promise<void> = Promise.resolve()
let built: {
  key: string
  items: Map<string, MenuItem | CheckMenuItem>
  state: Map<string, CommandSpec>
  resources: Resource[]
} | null = null

export function setNativeMenus(menus: MenuModel[], run: (id: string) => void): void {
  latest = { menus, run }
  clearTimeout(timer)
  timer = setTimeout(() => {
    queue = queue.then(apply).catch((e) => console.error('Updating the native menus failed:', e))
  }, DEBOUNCE_MS)
}

async function apply(): Promise<void> {
  if (!latest) return
  const spec = nativeMenuSpec(latest.menus, { isMac: isMacPlatform(), appName: APP_NAME })
  const key = nativeStructureKey(spec)

  if (built?.key === key) {
    for (const it of nativeCommandItems(spec)) {
      const item = built.items.get(it.id)
      const prev = built.state.get(it.id)
      if (!item || !prev) continue
      if (prev.text !== it.text) await item.setText(it.text)
      if (prev.enabled !== it.enabled) await item.setEnabled(it.enabled)
      if (it.checked !== undefined && item instanceof CheckMenuItem && prev.checked !== it.checked)
        await item.setChecked(it.checked)
      built.state.set(it.id, it)
    }
    return
  }

  const resources: Resource[] = []
  const items = new Map<string, MenuItem | CheckMenuItem>()
  const state = new Map<string, CommandSpec>()
  const make = async (
    it: NativeItem,
  ): Promise<MenuItem | CheckMenuItem | Submenu | PredefinedMenuItem> => {
    if (it.kind === 'predefined') {
      const p = await PredefinedMenuItem.new({
        item: it.item === 'About' ? { About: null } : it.item,
        ...(it.text ? { text: it.text } : {}),
      })
      resources.push(p)
      return p
    }
    if (it.kind === 'submenu') {
      const kids = []
      for (const k of it.items) kids.push(await make(k))
      const s = await Submenu.new({ text: it.text, items: kids })
      resources.push(s)
      return s
    }
    // No item ids of ours: Tauri keys its click handlers by item id and drops the handler when an
    // item is dropped, so a rebuilt item reusing an old id would lose its handler.
    const commandId = it.id
    const opts = {
      text: it.text,
      enabled: it.enabled,
      ...(it.accelerator ? { accelerator: it.accelerator } : {}),
      action: () => latest?.run(commandId),
    }
    const m =
      it.checked !== undefined
        ? await CheckMenuItem.new({ ...opts, checked: it.checked })
        : await MenuItem.new(opts)
    resources.push(m)
    items.set(it.id, m)
    state.set(it.id, it)
    return m
  }

  const subs: Submenu[] = []
  for (const m of spec) {
    const kids = []
    for (const it of m.items) kids.push(await make(it))
    const s = await Submenu.new({ text: m.text, items: kids })
    resources.push(s)
    subs.push(s)
    if (isMacPlatform() && m.role === 'window') await s.setAsWindowsMenuForNSApp()
    if (isMacPlatform() && m.role === 'help') await s.setAsHelpMenuForNSApp()
  }
  const menu = await Menu.new({ items: subs })
  const previous = await menu.setAsAppMenu()
  const old = built
  built = { key, items, state, resources: [...resources, menu] }
  // Free the replaced menu's items on the Rust side.
  await previous?.close().catch(() => {})
  for (const r of old?.resources ?? []) await r.close().catch(() => {})
}
