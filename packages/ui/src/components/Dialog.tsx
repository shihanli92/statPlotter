import { type ReactNode, useEffect, useId, useRef } from 'react'

/** A dialog that only explains why it can't do its job (e.g. results still computing). */
export function NoticeDialog({
  title,
  message,
  onClose,
}: {
  title: string
  message: string
  onClose: () => void
}) {
  return (
    <Dialog
      title={title}
      onClose={onClose}
      footer={
        <button type="button" onClick={onClose}>
          Close
        </button>
      }
    >
      <p>{message}</p>
    </Dialog>
  )
}

/**
 * Gives the focus back to where it was when a dialog opened, once it closes (audit 2, U7): to
 * the field, button or canvas the user was on, unless what closed it moved the focus on purpose
 * (to another dialog, a sheet it opened). Call it in the dialog's component; it reads the focus
 * before the dialog takes it, so call it before the effect that opens the dialog.
 */
export function useRestoreFocus(): void {
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    return () => {
      const now = document.activeElement
      if ((!now || now === document.body) && before?.isConnected)
        before.focus({ preventScroll: true })
    }
  }, [])
}

/** A modal dialog; its footer is Cancel and a primary `okLabel` button unless `footer` is given. */
export function Dialog({
  title,
  children,
  onClose,
  footer,
  okLabel,
  onOk,
  okDisabled,
  wide,
  role,
  describedBy,
}: {
  title: string
  children: ReactNode
  onClose: () => void
  footer?: ReactNode
  okLabel?: string
  onOk?: () => void
  okDisabled?: boolean
  wide?: boolean
  /** A question to answer (audit 2, U26): an alert dialog. */
  role?: 'alertdialog'
  /** The id of the text that describes it (an alert dialog's message). */
  describedBy?: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  // Named by its heading (audit 2, U6).
  const titleId = useId()
  useRestoreFocus()
  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
  }, [])
  return (
    <dialog
      ref={ref}
      className={`dialog ${wide ? 'wide' : ''}`}
      role={role}
      aria-labelledby={titleId}
      aria-describedby={describedBy}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <header>
        <h2 id={titleId}>{title}</h2>
      </header>
      <div className="dialog-body">{children}</div>
      <footer>
        {footer ?? (
          <>
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="primary" disabled={okDisabled} onClick={onOk}>
              {okLabel}
            </button>
          </>
        )}
      </footer>
    </dialog>
  )
}
