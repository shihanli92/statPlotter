import type { MigrationNote } from '@ps/model'
import { Dialog } from './components/Dialog.tsx'

/**
 * Shown once after opening a file of an older format whose update changed something (roadmap
 * 33b): graphs drawn differently from before, and settings the old version ignored that were
 * left out. Saving writes the current format, which older versions can't open.
 */
export function MigrationNotice({
  notes,
  onClose,
}: {
  notes: readonly MigrationNote[]
  onClose: () => void
}) {
  const list = (kind: MigrationNote['kind']) =>
    notes
      .filter((n) => n.kind === kind)
      .map((n, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list
        <li key={i}>{n.graph ? `“${n.graph}”: ${n.text}` : n.text}</li>
      ))
  const changed = list('approximated')
  const dropped = list('dropped')
  return (
    <Dialog
      title="Updated from an older version"
      onClose={onClose}
      footer={
        <button type="button" onClick={onClose}>
          Close
        </button>
      }
    >
      <p>
        This project was saved by an older version of the app and has been updated. Once saved,
        older versions can no longer open it.
      </p>
      {changed.length > 0 && (
        <>
          <p>Drawn differently from before:</p>
          <ul>{changed}</ul>
        </>
      )}
      {dropped.length > 0 && (
        <>
          <p>Settings the older version ignored, left out:</p>
          <ul>{dropped}</ul>
        </>
      )}
    </Dialog>
  )
}
