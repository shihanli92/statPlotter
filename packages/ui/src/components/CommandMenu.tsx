import { useCommandRegistry, useCommandsVersion } from '../commands/index.ts'
import { commandItems, type MenuEntry } from './commandItems.ts'
import { Menu } from './Menu.tsx'

/** Where a context menu opened and what it offers. */
export interface CommandMenuState {
  x: number
  y: number
  entries: readonly MenuEntry[]
  label: string
}

/**
 * A context menu of commands (see `commandItems`). Its items are read from the registry as it
 * renders and again whenever the commands change, so a menu opened by the same click that
 * selected something shows the commands for the new selection.
 */
export function CommandMenu({ menu, onClose }: { menu: CommandMenuState; onClose: () => void }) {
  const registry = useCommandRegistry()
  useCommandsVersion()
  return (
    <Menu
      x={menu.x}
      y={menu.y}
      items={commandItems(registry, menu.entries)}
      label={menu.label}
      onClose={onClose}
    />
  )
}
