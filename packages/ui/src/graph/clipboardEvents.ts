import { type RefObject, useEffect, useRef } from 'react'
import { isTextTarget } from '../commands/index.ts'

// ⌘C / ⌘V on the graph and layout canvases (roadmap 23). The keys stay the browser's (Edit ›
// Copy / Paste are `nativeShortcut`, and on macOS the desktop app's menu items are the system's),
// so text fields, the inline text editor and selected text keep their own clipboard; the views
// take the document's copy and paste events only when none of those is involved.

/** Where a clipboard event happens, as far as deciding who owns it goes. */
interface ClipboardEventContext {
  /** Focus is in a text field (input, textarea, select, contenteditable). */
  inText: boolean
  /** Focus is in the view (or nowhere in particular: the page body). */
  inView: boolean
  /** Text is selected somewhere on the page (a copy then copies the text). */
  textSelected: boolean
  /** A modal dialog is open (it owns the keys). */
  dialogOpen: boolean
}

/** Whether the view takes this copy (`copy`) or paste (`paste`) event. */
export function viewOwnsClipboardEvent(kind: 'copy' | 'paste', c: ClipboardEventContext): boolean {
  if (c.inText || c.dialogOpen || !c.inView) return false
  return kind === 'paste' || !c.textSelected
}

function contextOf(root: HTMLElement | null): ClipboardEventContext {
  const active = document.activeElement
  const sel = window.getSelection()
  return {
    inText: isTextTarget(active),
    inView: !active || active === document.body || !!root?.contains(active),
    textSelected: !!sel && !sel.isCollapsed && sel.toString() !== '',
    dialogOpen: !!document.querySelector('dialog[open]'),
  }
}

/**
 * Takes the document's copy / paste events for a view while it is mounted. `copy` runs on ⌘C
 * (the browser's own copy then does nothing: there is no selection), with the event, on which a
 * view may put its own data (the results view's tables). `paste` returns whether it
 * handles the event (then its default is prevented). `beforecopy` / `beforepaste` are cancelled
 * when the view would take the event, which is what enables Copy / Paste in WebKit's menus when
 * nothing is selected (the desktop app on macOS).
 */
export function useClipboardEvents(
  root: RefObject<HTMLElement | null>,
  handlers: {
    copy?: (e: ClipboardEvent) => void
    paste?: { active: boolean; run: (e: ClipboardEvent) => boolean }
  },
): void {
  const latest = useRef(handlers)
  latest.current = handlers
  useEffect(() => {
    const owns = (kind: 'copy' | 'paste') => {
      const h = latest.current
      if (kind === 'copy' ? !h.copy : !h.paste?.active) return false
      return viewOwnsClipboardEvent(kind, contextOf(root.current))
    }
    const beforeCopy = (e: Event) => owns('copy') && e.preventDefault()
    const beforePaste = (e: Event) => owns('paste') && e.preventDefault()
    const onCopy = (e: ClipboardEvent) => {
      if (owns('copy')) latest.current.copy?.(e)
    }
    const onPaste = (e: ClipboardEvent) => {
      if (owns('paste') && latest.current.paste?.run(e)) e.preventDefault()
    }
    document.addEventListener('beforecopy', beforeCopy)
    document.addEventListener('beforepaste', beforePaste)
    document.addEventListener('copy', onCopy)
    document.addEventListener('paste', onPaste)
    return () => {
      document.removeEventListener('beforecopy', beforeCopy)
      document.removeEventListener('beforepaste', beforePaste)
      document.removeEventListener('copy', onCopy)
      document.removeEventListener('paste', onPaste)
    }
  }, [root])
}
