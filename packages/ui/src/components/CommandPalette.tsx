import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  formatShortcut,
  isMacPlatform,
  menuPaths,
  type PaletteEntry,
  rankPalette,
  useCommandRegistry,
} from '../commands/index.ts'
import { useRestoreFocus } from './Dialog.tsx'

/** An entry the shell adds (an analysis, a sheet), with what it does. */
export interface PaletteExtra extends PaletteEntry {
  run: () => void
}

type Row = PaletteEntry & { run: () => void }

const MAX_ROWS = 60

/**
 * The command palette (⌘K): every command of the registry (run by id), plus the shell's extra
 * entries (analyses of the current table, the project's sheets). Type to filter; ↑ / ↓ choose,
 * Enter runs, Escape closes.
 */
export function CommandPalette({
  extras,
  onClose,
}: {
  extras: readonly PaletteExtra[]
  onClose: () => void
}) {
  const registry = useCommandRegistry()
  const ref = useRef<HTMLDialogElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const id = useId()
  const [isMac] = useState(isMacPlatform)

  // A snapshot on opening: the palette is short-lived and its commands don't change meanwhile.
  const entries = useMemo<Row[]>(() => {
    const paths = menuPaths(registry.menus())
    const commands: Row[] = registry
      .all()
      .filter((c) => !c.hideInPalette)
      .map((c) => ({
        id: c.id,
        label: c.label,
        section: paths.get(c.id) ?? 'Command',
        keywords: c.keywords,
        shortcut: c.shortcut ? formatShortcut(c.shortcut, isMac) : undefined,
        enabled: c.enabled !== false,
        hint: c.hint,
        run: () => void registry.run(c.id),
      }))
    const seen = new Set(commands.map((c) => c.id))
    return [...commands, ...extras.filter((e) => !seen.has(e.id))]
  }, [registry, extras, isMac])

  const rows = useMemo(() => rankPalette(entries, query).slice(0, MAX_ROWS), [entries, query])
  const at = Math.min(active, Math.max(0, rows.length - 1))

  // Back to where the user was, unless what ran moved the focus on purpose (a dialog).
  useRestoreFocus()
  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
  }, [])

  useEffect(() => {
    listRef.current?.querySelector(`[data-row="${at}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [at])

  const choose = (row: Row | undefined) => {
    if (!row?.enabled) return
    onClose()
    row.run()
  }

  return (
    <dialog
      ref={ref}
      className="palette"
      aria-label="Command palette"
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onPointerDown={(e) => {
        // A press on the backdrop (the dialog element itself, outside its box) closes.
        if (e.target === ref.current) onClose()
      }}
    >
      <input
        type="text"
        className="palette-input"
        role="combobox"
        aria-expanded="true"
        aria-controls={`${id}-list`}
        aria-activedescendant={rows.length ? `${id}-${at}` : undefined}
        aria-autocomplete="list"
        placeholder="Search commands, analyses and sheets…"
        autoFocus
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(0)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive((at + 1) % Math.max(1, rows.length))
          else if (e.key === 'ArrowUp') setActive((at - 1 + rows.length) % Math.max(1, rows.length))
          else if (e.key === 'PageDown') setActive(Math.min(rows.length - 1, at + 10))
          else if (e.key === 'PageUp') setActive(Math.max(0, at - 10))
          else if (e.key === 'Enter') choose(rows[at])
          // ⌘K again closes (the shell's shortcuts are off while a dialog is open).
          else if (e.key.toLowerCase() === 'k' && (isMac ? e.metaKey : e.ctrlKey)) onClose()
          else return
          e.preventDefault()
        }}
      />
      <div className="palette-list" role="listbox" id={`${id}-list`} ref={listRef}>
        {rows.map((r, i) => (
          // biome-ignore lint/a11y/useKeyWithClickEvents: the input handles the keys (combobox)
          <div
            key={r.id}
            id={`${id}-${i}`}
            data-row={i}
            role="option"
            tabIndex={-1}
            aria-selected={i === at}
            aria-disabled={!r.enabled}
            className={`palette-row ${i === at ? 'active' : ''} ${r.enabled ? '' : 'disabled'}`}
            title={r.hint}
            onPointerMove={() => i !== at && setActive(i)}
            onClick={() => choose(r)}
          >
            <span className="palette-label">{r.label}</span>
            <span className="palette-section">{r.section}</span>
            {r.shortcut && <kbd className="palette-shortcut">{r.shortcut}</kbd>}
          </div>
        ))}
        {!rows.length && <div className="palette-empty muted">Nothing matches “{query}”.</div>}
      </div>
    </dialog>
  )
}
