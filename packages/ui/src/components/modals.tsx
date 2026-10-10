import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import { Dialog } from './Dialog.tsx'

// Audit 2 (U26): the app's modal dialogs. One slot holds the dialog open, whichever part of the
// app opened it (the shell, the organise, reuse and styles commands, batch export): each owner
// reads its own state from it and renders its dialog. Questions (`confirm`) are asked in a dialog
// of the app's own, over any other; never the browser's `window.confirm`, which Tauri's webviews
// don't show. Whether either is open is the one signal dropped files and the update prompt wait
// for (`open`).

/** An owner's view of the slot: what it has open, if anything. */
export interface ModalSlot<T> {
  /** This owner's dialog state, or null (nothing open, or another owner's dialog). */
  open: T | null
  /** Opens this owner's dialog (in place of whatever was open). */
  show: (value: T) => void
  /** Closes this owner's dialog; another owner's, opened since, stays. */
  close: () => void
}

/** A question asked before doing something that can't be taken back (or not easily). */
export interface Question {
  /** The question, the dialog's heading ("Discard unsaved changes?"). */
  title: string
  /** More about it, below the heading. */
  message?: string
  /** The button that goes ahead ("Discard", "Delete"); OK by default. */
  ok?: string
  /** Going ahead destroys something: the button says so by its colour. */
  danger?: boolean
}

/** Asks a question; true when the user goes ahead, false for Cancel or Escape. */
export type Confirm = (q: Question) => Promise<boolean>

/** The question asker of the app's modal host (rendered by the shell). */
export const ConfirmContext = createContext<Confirm>(() => Promise.resolve(false))
export const useConfirm = (): Confirm => useContext(ConfirmContext)

interface Asked {
  id: number
  q: Question
  answer: (yes: boolean) => void
}

/** The shell's modal host: the slot, the question asked, and whether a modal is open. */
export function useModalHost(): {
  slot: <T>(owner: string) => ModalSlot<T>
  confirm: Confirm
  /** A dialog of the slot's, or a question, is open. */
  open: boolean
  /** The question being asked, to render above everything (null when none). */
  question: ReactNode
} {
  const [current, setCurrent] = useState<{ owner: string; value: unknown } | null>(null)
  const [asked, setAsked] = useState<Asked | null>(null)
  // The question shown, and those asked meanwhile, waiting their turn.
  const active = useRef<Asked | null>(null)
  const queue = useRef<Asked[]>([])
  const ids = useRef(0)

  // Each owner's show and close, made once: they stay the same between renders.
  const actions = useRef(new Map<string, Pick<ModalSlot<unknown>, 'show' | 'close'>>())
  const slot = useCallback(
    <T,>(owner: string): ModalSlot<T> => {
      let a = actions.current.get(owner)
      if (!a) {
        a = {
          show: (value) => setCurrent({ owner, value }),
          close: () => setCurrent((c) => (c?.owner === owner ? null : c)),
        }
        actions.current.set(owner, a)
      }
      return { open: current?.owner === owner ? (current.value as T) : null, ...a }
    },
    [current],
  )

  const confirm = useCallback<Confirm>(
    (q) =>
      new Promise<boolean>((resolve) => {
        const next: Asked = {
          id: ++ids.current,
          q,
          answer: (yes) => {
            active.current = queue.current.shift() ?? null
            setAsked(active.current)
            resolve(yes)
          },
        }
        if (active.current) queue.current.push(next)
        else {
          active.current = next
          setAsked(next)
        }
      }),
    [],
  )

  const question = asked ? (
    <QuestionDialog key={asked.id} q={asked.q} onAnswer={asked.answer} />
  ) : null
  return { slot, confirm, open: current !== null || asked !== null, question }
}

/** A question in a modal dialog: Cancel, and the button that goes ahead (focused, as Enter). */
function QuestionDialog({ q, onAnswer }: { q: Question; onAnswer: (yes: boolean) => void }) {
  const ok = useRef<HTMLButtonElement>(null)
  const messageId = useId()
  // After the dialog opened (its effect runs first) and focused its first button.
  useEffect(() => ok.current?.focus(), [])
  const answered = useRef(false)
  const answer = (yes: boolean) => {
    if (answered.current) return
    answered.current = true
    onAnswer(yes)
  }
  return (
    <Dialog
      title={q.title}
      role="alertdialog"
      describedBy={q.message ? messageId : undefined}
      onClose={() => answer(false)}
      footer={
        <>
          <button type="button" onClick={() => answer(false)}>
            Cancel
          </button>
          <button
            ref={ok}
            type="button"
            className={q.danger ? 'danger' : 'primary'}
            onClick={() => answer(true)}
          >
            {q.ok ?? 'OK'}
          </button>
        </>
      }
    >
      {q.message && <p id={messageId}>{q.message}</p>}
    </Dialog>
  )
}
