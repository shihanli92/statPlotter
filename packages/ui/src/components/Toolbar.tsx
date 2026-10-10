import { type ReactNode, useRef, useState } from 'react'
import {
  type Command,
  type CommandRegistry,
  formatShortcut,
  isMacPlatform,
  useCommandRegistry,
  useCommandsVersion,
} from '../commands/index.ts'
import { CommandMenu, type CommandMenuState } from './CommandMenu.tsx'
import { Icon } from './icons.tsx'
import { CommandTip, Tooltip } from './Tooltip.tsx'

/** The label under a toolbar icon: its own short one, else the command's without "…". */
export const toolbarLabel = (c: Command) => c.toolbar?.label ?? c.label.replace(/…$/, '')

/**
 * The icon toolbar: the registry's toolbar commands, grouped with dividers between groups;
 * `children` go at the right end (the file name). Labelled (roadmap 43: a short label under each
 * icon, Keynote style) unless `iconsOnly` (View › Toolbar › Icons only). Each button's
 * accessible name is the command's label either way; its tooltip (the app's own, also on
 * keyboard focus) gives the name, the shortcut and the hint, or why it is disabled. A command
 * with `toolbar.split` gets a ▾ beside it opening a menu of other commands.
 */
export function Toolbar({ children, iconsOnly }: { children?: ReactNode; iconsOnly?: boolean }) {
  const registry = useCommandRegistry()
  useCommandsVersion()
  const [isMac] = useState(isMacPlatform)
  const [menu, setMenu] = useState<(CommandMenuState & { owner: string }) | null>(null)
  const groups = registry.toolbar()
  return (
    <div
      className={`icon-toolbar ${iconsOnly ? 'icons-only' : 'labelled'}`}
      role="toolbar"
      aria-label="Toolbar"
    >
      {groups.map((group, gi) => (
        <div className="icon-toolbar-group" key={group[0]!.toolbar!.group}>
          {gi > 0 && <span className="icon-toolbar-divider" aria-hidden="true" />}
          {group.map((c) => (
            <ToolbarItem
              key={c.id}
              command={c}
              registry={registry}
              isMac={isMac}
              iconsOnly={!!iconsOnly}
              menuOpen={menu?.owner === c.id}
              onMenu={(at) =>
                setMenu(
                  at && {
                    ...at,
                    owner: c.id,
                    entries: c.toolbar!.split!.items,
                    label: c.toolbar!.split!.label,
                  },
                )
              }
            />
          ))}
        </div>
      ))}
      <div className="icon-toolbar-end">{children}</div>
      {menu && <CommandMenu menu={menu} onClose={() => setMenu(null)} />}
    </div>
  )
}

function ToolbarItem({
  command: c,
  registry,
  isMac,
  iconsOnly,
  menuOpen,
  onMenu,
}: {
  command: Command
  registry: CommandRegistry
  isMac: boolean
  iconsOnly: boolean
  menuOpen: boolean
  onMenu: (at: { x: number; y: number } | null) => void
}) {
  const disabled = c.enabled === false
  const shortcut = c.shortcut ? formatShortcut(c.shortcut, isMac) : undefined
  const split = c.toolbar?.split
  // A press on ▾ while its menu is open closes the menu (the menu's own outside-press does that
  // first); the click that follows must not open it again.
  const wasOpen = useRef(false)
  const main = (
    <Tooltip
      content={
        <CommandTip
          name={c.label}
          shortcut={shortcut}
          hint={c.hint}
          disabledReason={disabled ? c.disabledReason : undefined}
        />
      }
    >
      <button
        type="button"
        className={`tool-button ${c.checked ? 'on' : ''}`}
        aria-label={c.label}
        aria-pressed={c.checked}
        disabled={disabled}
        // Keep the focus where the user works (a clicked icon shouldn't take it).
        onPointerDown={(e) => e.preventDefault()}
        onClick={() => registry.run(c.id)}
      >
        <Icon name={c.icon} size={iconsOnly ? 16 : 20} />
        {!iconsOnly && <span className="tool-label">{toolbarLabel(c)}</span>}
      </button>
    </Tooltip>
  )
  if (!split) return main
  return (
    <span className={`split-button${disabled ? ' disabled' : ''}`}>
      {main}
      <Tooltip content={<CommandTip name={split.label} />}>
        <button
          type="button"
          className="tool-button split-arrow"
          aria-label={split.label}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          disabled={disabled}
          onPointerDown={(e) => {
            e.preventDefault()
            wasOpen.current = menuOpen
          }}
          onClick={(e) => {
            const open = menuOpen || wasOpen.current
            wasOpen.current = false
            if (open) return onMenu(null)
            const r = e.currentTarget.closest('.split-button')!.getBoundingClientRect()
            onMenu({ x: r.left, y: r.bottom + 2 })
          }}
        >
          <svg viewBox="0 0 8 5" width="8" height="5" aria-hidden="true" focusable="false">
            <path d="M0 0h8L4 5z" fill="currentColor" />
          </svg>
        </button>
      </Tooltip>
    </span>
  )
}
