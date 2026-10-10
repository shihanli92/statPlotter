import type { Command } from '@ps/engine'
import type { DataTable, GridColumn } from '@ps/model'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ShowError } from '../components/Toasts.tsx'
import { type FindOptions, type FindTarget, findMatches, replaceCommands } from './find.ts'

// Edit › Find and replace (⌘F) over the grid (roadmap 29): every match highlighted, the current
// one selected and scrolled to; ⌘G / ⇧⌘G (or ↩ / ⇧↩ in the field) step through them, Esc closes.

/** A match's key in the grid's highlight set. */
export const matchKey = (m: FindTarget) =>
  m.kind === 'cell' ? `${m.r}:${m.c}` : `${m.kind === 'title' ? 't' : 's'}:${m.c}`

interface FindState {
  open: boolean
  matches: readonly FindTarget[]
  /** Keys of every match (`matchKey`) and of the current one. */
  keys: ReadonlySet<string>
  current: string | null
  show: () => void
  step: (dir: 1 | -1) => void
  bar: React.ReactNode
}

/**
 * The find bar's state and element. `onGo` selects and scrolls to a match; `dispatch` applies
 * replacements (one undo step) and reports whether it did; `readOnly` tables only find.
 */
export function useFind({
  table,
  cols,
  readOnly,
  onGo,
  dispatch,
  onError,
  onClose,
}: {
  table: DataTable
  cols: readonly GridColumn[]
  readOnly: boolean
  onGo: (m: FindTarget) => void
  dispatch: (cmds: Command[], label: string) => boolean
  onError: ShowError
  onClose: () => void
}): FindState {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [repl, setRepl] = useState('')
  const [opts, setOpts] = useState<FindOptions>({ matchCase: false, wholeCell: false })
  const [index, setIndex] = useState(0)
  const [status, setStatus] = useState<string | null>(null)
  const [focusToken, setFocusToken] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  const matches = useMemo(
    () => (open ? findMatches(table, cols, query, opts) : []),
    [open, table, cols, query, opts],
  )
  const at = matches.length ? Math.min(index, matches.length - 1) : -1
  const keys = useMemo(() => new Set(matches.map(matchKey)), [matches])
  const current = at >= 0 ? matchKey(matches[at]!) : null

  useEffect(() => {
    if (!open || focusToken === 0) return
    input.current?.focus()
    input.current?.select()
  }, [open, focusToken])

  const go = (i: number, list = matches) => {
    if (!list.length) return
    const k = ((i % list.length) + list.length) % list.length
    setIndex(k)
    onGo(list[k]!)
  }
  const search = (q: string, o: FindOptions) => {
    setStatus(null)
    const found = findMatches(table, cols, q, o)
    setIndex(0)
    if (found.length) onGo(found[0]!)
  }

  const replaceWith = (targets: readonly FindTarget[], label: string) => {
    const r = replaceCommands(table, cols, targets, query, repl, opts)
    if (!r.ok) return onError(r.error, 'validation')
    if (r.commands.length && !dispatch(r.commands, label)) return
    const skipped = r.skipped ? ` (${r.skipped} calculated left as they are)` : ''
    setStatus(`${r.replaced} replaced${skipped}`)
  }
  const replaceOne = () => {
    if (at < 0) return
    replaceWith([matches[at]!], 'Replace')
    // The same index is the next match once this one no longer matches.
    if (matches.length > 1) onGo(matches[(at + 1) % matches.length]!)
  }

  const close = () => {
    setOpen(false)
    setStatus(null)
    onClose()
  }

  const bar = open ? (
    // biome-ignore lint/a11y/useSemanticElements: a toolbar-like bar, not a form
    <div className="find-bar" role="search" aria-label="Find and replace">
      <input
        ref={input}
        type="search"
        aria-label="Find"
        placeholder="Find"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          search(e.target.value, opts)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            go(at + (e.shiftKey ? -1 : 1))
          } else if (e.key === 'Escape') {
            e.preventDefault()
            close()
          }
        }}
      />
      <button
        type="button"
        title="Previous match"
        aria-label="Previous match"
        onClick={() => go(at - 1)}
      >
        <ChevronUp size={14} />
      </button>
      <button type="button" title="Next match" aria-label="Next match" onClick={() => go(at + 1)}>
        <ChevronDown size={14} />
      </button>
      <span className="find-count" aria-live="polite">
        {query ? (matches.length ? `${at + 1} of ${matches.length}` : 'No matches') : ''}
      </span>
      {(
        [
          ['matchCase', 'Match case'],
          ['wholeCell', 'Whole cell'],
        ] as const
      ).map(([k, label]) => (
        <label key={k} className="check">
          <input
            type="checkbox"
            checked={opts[k]}
            onChange={(e) => {
              const next = { ...opts, [k]: e.target.checked }
              setOpts(next)
              search(query, next)
            }}
          />
          {label}
        </label>
      ))}
      {!readOnly && (
        <>
          <input
            type="text"
            aria-label="Replace with"
            placeholder="Replace with"
            value={repl}
            onChange={(e) => setRepl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                replaceOne()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                close()
              }
            }}
          />
          <button type="button" disabled={at < 0} onClick={replaceOne}>
            Replace
          </button>
          <button
            type="button"
            disabled={!matches.length}
            onClick={() => replaceWith(matches, 'Replace all')}
          >
            Replace all
          </button>
        </>
      )}
      {status && <span className="find-status">{status}</span>}
      <button
        type="button"
        className="find-close"
        aria-label="Close find"
        title="Close (Esc)"
        onClick={close}
      >
        <X size={14} />
      </button>
    </div>
  ) : null

  return {
    open,
    matches,
    keys,
    current,
    show: () => {
      setOpen(true)
      setFocusToken((n) => n + 1)
    },
    step: (dir) => {
      if (!open || !query) {
        setOpen(true)
        setFocusToken((n) => n + 1)
        return
      }
      go(at + dir)
    },
    bar,
  }
}
