import {
  createContext,
  type DragEvent,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  type DropHandled,
  type DropModifiers,
  type DroppedFile,
  DropQueue,
  NO_MODS,
} from './dropQueue.ts'
import {
  type DropKind,
  type DropStep,
  type DropTarget,
  dropHints,
  dropKindOf,
  type FileSource,
  kindsOfTypes,
} from './dropRouter.ts'
import { carriesFiles, transferFiles } from './transfer.ts'

// Files dropped on the window (roadmap 39): the overlay while files are dragged over it, and the
// queue (`DropQueue`) handling dropped files one after another, then a summary.

export {
  type DropHandled,
  type DropModifiers,
  type DroppedFile,
  NO_MODS,
} from './dropQueue.ts'

/** Hands files to the app's queue (a layout page passes on what isn't an image). */
export const DropContext = createContext<
  ((files: DroppedFile[], target: DropTarget, mods?: DropModifiers) => void) | null
>(null)
export const useDropFiles = () => useContext(DropContext)

export function useFileDrop({
  handle,
  dialogOpen,
  targetOf,
  onSummary,
}: {
  /** Handles one file (opens it, starts its import, adds it to the library…). */
  handle: (
    step: DropStep,
    files: DroppedFile[],
    target: DropTarget,
    mods: DropModifiers,
    source: FileSource,
  ) => Promise<DropHandled>
  /** A dialog is open: a waiting file's turn ends when it closes. */
  dialogOpen: boolean
  /** Where a drag is, from the element under the pointer. */
  targetOf: (el: Element | null) => DropTarget
  onSummary: (text: string, ok: boolean) => void
}) {
  const [overlay, setOverlay] = useState<{ hints: string[]; target: DropTarget } | null>(null)
  const depth = useRef(0)
  const latest = useRef({ handle, onSummary })
  latest.current = { handle, onSummary }
  const [queue] = useState(
    () =>
      new DropQueue(
        (q) => latest.current.handle(q.step, q.files, q.target, q.mods, q.source),
        (text, ok) => latest.current.onSummary(text, ok),
      ),
  )

  // A file waiting for its dialog: the next starts once it closes.
  useEffect(() => {
    if (!dialogOpen) queue.dialogClosed()
  }, [dialogOpen, queue])

  const enqueue = useCallback(
    (
      files: DroppedFile[],
      target: DropTarget,
      mods: DropModifiers = NO_MODS,
      source: FileSource = 'drop',
    ) => queue.enqueue(files, target, mods, source),
    [queue],
  )

  const kindsOf = (e: DragEvent): Set<DropKind> | null =>
    kindsOfTypes([...e.dataTransfer.items].filter((i) => i.kind === 'file').map((i) => i.type))

  const handlers = {
    onDragEnter: (e: DragEvent) => {
      if (!carriesFiles(e.dataTransfer)) return
      depth.current++
      const target = targetOf(e.target as Element)
      setOverlay({ hints: dropHints(kindsOf(e), target), target })
    },
    onDragOver: (e: DragEvent) => {
      if (!carriesFiles(e.dataTransfer)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      const target = targetOf(e.target as Element)
      setOverlay((o) =>
        o && o.target === target ? o : { hints: dropHints(kindsOf(e), target), target },
      )
    },
    onDragLeave: (e: DragEvent) => {
      if (!carriesFiles(e.dataTransfer)) return
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setOverlay(null)
    },
    onDrop: (e: DragEvent) => {
      depth.current = 0
      setOverlay(null)
      // A layout page took the drop (its images placed where dropped, the rest passed on).
      if (e.defaultPrevented || !carriesFiles(e.dataTransfer)) return
      e.preventDefault()
      const target = targetOf(e.target as Element)
      const mods = { alt: e.altKey, shift: e.shiftKey }
      void transferFiles(e.dataTransfer).then((files) => enqueue(files, target, mods))
    },
  }
  // A drag that ends outside the window, or on a page that took it, leaves no overlay behind.
  useEffect(() => {
    const clear = () => {
      depth.current = 0
      setOverlay(null)
    }
    window.addEventListener('dragend', clear)
    window.addEventListener('drop', clear)
    return () => {
      window.removeEventListener('dragend', clear)
      window.removeEventListener('drop', clear)
    }
  }, [])

  return { overlay, handlers, enqueue, kindOf: dropKindOf }
}

/** The overlay naming what dropping will do. */
export function DropOverlay({ hints }: { hints: string[] }) {
  return (
    <div className="drop-overlay" role="status" aria-live="polite" data-testid="drop-overlay">
      <div className="drop-card">
        <strong>Drop files to open or import them</strong>
        <ul>
          {hints.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}
