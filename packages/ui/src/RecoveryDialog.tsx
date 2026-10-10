import { Dialog } from './components/Dialog.tsx'
import { type RecoveryRecord, recoveryName, recoverySummary, recoveryTime } from './recovery.ts'

/**
 * Offers the recovery copies left by pages that closed with unsaved changes (roadmap 25): one as
 * a question, several as a list. Recover opens a copy as an unsaved project, Discard deletes
 * it, Later keeps them all for the next start.
 */
export function RecoveryDialog({
  records,
  onRecover,
  onDiscard,
  onLater,
}: {
  records: RecoveryRecord[]
  onRecover: (r: RecoveryRecord) => void
  onDiscard: (r: RecoveryRecord) => void
  onLater: () => void
}) {
  const now = Date.now()
  const only = records.length === 1 ? records[0] : undefined
  return (
    <Dialog
      title="Recover unsaved changes"
      onClose={onLater}
      footer={
        <>
          <button type="button" onClick={onLater}>
            Later
          </button>
          {only && (
            <>
              <button type="button" onClick={() => onDiscard(only)}>
                Discard
              </button>
              <button type="button" className="primary" onClick={() => onRecover(only)}>
                Recover
              </button>
            </>
          )}
        </>
      }
    >
      {only ? (
        <>
          <p>
            Recover unsaved changes to <strong>{recoveryName(only)}</strong> from{' '}
            {recoveryTime(only.time, now)}?
          </p>
          <p className="muted">{recoverySummary(only)}</p>
        </>
      ) : (
        <>
          <p>These projects had unsaved changes when they were last closed:</p>
          <ul className="recovery-list">
            {records.map((r) => (
              <li key={r.session}>
                <div>
                  <strong>{r.fileName ?? 'Untitled project'}</strong>{' '}
                  <span>{recoveryTime(r.time, now)}</span>
                  <div className="muted">{recoverySummary(r)}</div>
                </div>
                <button type="button" onClick={() => onDiscard(r)}>
                  Discard
                </button>
                <button type="button" className="primary" onClick={() => onRecover(r)}>
                  Recover
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="muted">
        A recovered project opens with its changes not yet saved: save it to keep them.
      </p>
    </Dialog>
  )
}
