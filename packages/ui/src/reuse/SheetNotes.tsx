import type { AnalysisNode, DataTable, GraphNode, LayoutNode } from '@ps/model'
import { useEffect, useRef, useState } from 'react'
import { useServices } from '../context.tsx'

/** Rows to show the text whole (lines wrapped at about 100 characters), 2 to 12. */
const rowsFor = (text: string) =>
  Math.min(
    12,
    Math.max(
      2,
      text.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / 100)), 0),
    ),
  )

/**
 * A sheet's notes (roadmap 31): free text above a table, results, graph or layout page (Prism's "info" per
 * sheet), edited in place. Collapsed while empty; an edit is one undo step when the field loses
 * focus. Never drawn on graphs or exported with them.
 */
export function SheetNotes({ node }: { node: DataTable | AnalysisNode | GraphNode | LayoutNode }) {
  const { store } = useServices()
  const notes = node.notes ?? ''
  const [text, setText] = useState(notes)
  const [open, setOpen] = useState(notes !== '')
  const cancelled = useRef(false)
  // Follow the document (undo, redo, another sheet's notes).
  useEffect(() => setText(notes), [notes])
  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false
      setText(notes)
      return
    }
    if (text === notes) return
    const value = node.kind === 'table' ? text : text || undefined
    store.dispatch({ type: 'node.set', id: node.id, path: ['notes'], value }, 'Edit notes')
  }
  return (
    <details
      className="table-notes sheet-notes"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>Notes{!open && notes ? ` — ${notes.split('\n')[0]}` : ''}</summary>
      {open && (
        <textarea
          aria-label="Notes"
          value={text}
          rows={rowsFor(text)}
          placeholder="Notes about this sheet (methods, sources, what to check)…"
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              cancelled.current = true
              e.currentTarget.blur()
            }
          }}
        />
      )}
    </details>
  )
}
