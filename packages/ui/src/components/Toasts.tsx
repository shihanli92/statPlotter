import { useEffect, useRef, useState } from 'react'

// The app's passing messages (audit 2, U15). Two kinds, each in its own live region:
// - notices ("Copied…", "3 graphs on Layout 2"): role status, gone after a few seconds, the
//   time paused while the pointer or the focus is on them; a notice may carry one action, a
//   real button in the region ("Format graph · Undo", roadmap 43);
// - errors and warnings about data ("Save failed…", "12 cells imported as empty"): role alert,
//   kept until dismissed (or replaced by the next one), so none is missed; but for messages
//   about what was typed or chosen ("“abc” is not a number."), which go after a while (roadmap
//   43): nothing is lost when they go, and the next edit shows them again if still wrong.
// The regions are always there (empty when quiet), so screen readers announce what appears.
// Escape in a toast dismisses it; the focus goes back to where it came from.

export type ToastKind = 'notice' | 'error'

/**
 * What an error toast says (roadmap 43): a `failure` (an operation failed, data needs looking
 * at: kept until dismissed) or a `validation` message (what was typed or chosen can't be used:
 * gone after `VALIDATION_MS`).
 */
export type ErrorKind = 'failure' | 'validation'

/** Shows an error toast; a failure unless said otherwise. */
export type ShowError = (msg: string, kind?: ErrorKind) => void

/** A notice's button ("Undo"): runs, then the notice goes. */
export interface ToastAction {
  label: string
  run: () => void
}

export interface ToastMessage {
  msg: string
  kind: ToastKind
  /** Changes with every message (the same text again is shown again). */
  key: number
  /**
   * How long it stays, in ms, counted while neither hovered nor focused. Absent: a notice's
   * `NOTICE_MS`; an error stays until dismissed.
   */
  duration?: number
  action?: ToastAction
}

/** How long a notice stays, in ms (counted while neither hovered nor focused). */
export const NOTICE_MS = 5000
/** How long the notice of a step just made, with its Undo, stays (roadmap 43). */
export const UNDO_NOTICE_MS = 3000
/** How long a validation message stays (roadmap 43). */
export const VALIDATION_MS = 8000

/** An error toast: a validation message goes after `VALIDATION_MS`, a failure stays. */
export const errorToast = (msg: string, kind: ErrorKind, key: number): ToastMessage => ({
  msg,
  kind: 'error',
  key,
  ...(kind === 'validation' ? { duration: VALIDATION_MS } : {}),
})

/** How long `toast` stays, or null: until dismissed. */
export const toastDuration = (toast: ToastMessage): number | null =>
  toast.duration ?? (toast.kind === 'notice' ? NOTICE_MS : null)

function Toast({ toast, onDismiss }: { toast: ToastMessage; onDismiss: () => void }) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const paused = hovered || focused
  // The latest callback, without restarting the timer when the app renders again.
  const dismiss = useRef(onDismiss)
  dismiss.current = onDismiss
  // Where the focus came from when it came in (to give it back when the toast goes).
  const cameFrom = useRef<HTMLElement | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const ms = toastDuration(toast)
  // biome-ignore lint/correctness/useExhaustiveDependencies: each message counts its time anew
  useEffect(() => {
    if (ms === null || paused) return
    const t = setTimeout(() => dismiss.current(), ms)
    return () => clearTimeout(t)
  }, [toast, ms, paused])
  /** Gone at the user's word: the focus, if in it, back to where it was. */
  const close = () => {
    const back = cameFrom.current
    if (ref.current?.contains(document.activeElement) && back?.isConnected)
      back.focus({ preventScroll: true })
    onDismiss()
  }
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover pauses the timer; Escape closes
    <div
      ref={ref}
      className={`toast ${toast.kind}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={(e) => {
        const from = e.relatedTarget as HTMLElement | null
        if (from && !e.currentTarget.contains(from)) cameFrom.current = from
        setFocused(true)
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false)
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return
        e.preventDefault()
        e.stopPropagation()
        close()
      }}
    >
      <span className="toast-text">
        {toast.msg}
        {toast.action && (
          <>
            <span aria-hidden="true"> · </span>
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                toast.action!.run()
                close()
              }}
            >
              {toast.action.label}
            </button>
          </>
        )}
      </span>
      <button type="button" aria-label="Dismiss" onClick={close}>
        ×
      </button>
    </div>
  )
}

/** The error (if any) above the notice (if any), at the window's bottom right. */
export function Toasts({
  error,
  notice,
  onDismiss,
}: {
  error: ToastMessage | null
  notice: ToastMessage | null
  onDismiss: (kind: ToastKind) => void
}) {
  return (
    <div className="toasts">
      <div role="alert" className="toast-slot">
        {error && <Toast key={error.key} toast={error} onDismiss={() => onDismiss('error')} />}
      </div>
      <div role="status" className="toast-slot">
        {notice && <Toast key={notice.key} toast={notice} onDismiss={() => onDismiss('notice')} />}
      </div>
    </div>
  )
}
