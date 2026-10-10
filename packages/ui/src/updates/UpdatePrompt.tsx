import { useCallback, useEffect, useRef, useState } from 'react'
import { Dialog } from '../components/Dialog.tsx'
import { useServices } from '../context.tsx'
import { loadPreferences, savePreferences } from '../styles/styleStore.ts'
import { errorMessage } from '../util.ts'
import {
  type AvailableUpdate,
  afterCheck,
  checkForUpdate,
  dueForCheck,
  skipping,
} from './updates.ts'

// The desktop app's update prompt (roadmap 41): "Version X is available — Update now / Later /
// Skip this version", with the release notes. Checked at start, at most once a day, unless
// turned off in Preferences; "Check now" there opens the same prompt.

/** Listeners for an update found by Preferences' "Check now". */
const offered = new Set<(u: AvailableUpdate) => void>()
/** Shows the prompt for an update (Preferences' "Check now"). */
export const offerUpdate = (u: AvailableUpdate) => {
  for (const l of offered) l(u)
}

/**
 * The automatic check at start, and the prompt for whatever is found. `blocked`: a modal dialog
 * is open; the check waits for none to be, and the prompt of an update it found shows only while
 * none is (it waits behind the recovery dialog, Preferences…: audit 2, U22). An update offered
 * by Preferences' "Check now" shows at once, over Preferences.
 */
export function UpdateCheck({ blocked }: { blocked: boolean }) {
  const { platform } = useServices()
  const updates = platform.updates
  const [found, setFound] = useState<{ update: AvailableUpdate; asked: boolean } | null>(null)
  const update = found?.update ?? null
  const setUpdate = useCallback((u: AvailableUpdate | null) => {
    setFound(u ? { update: u, asked: false } : null)
  }, [])
  const started = useRef(false)

  useEffect(() => {
    const asked = (u: AvailableUpdate) => setFound({ update: u, asked: true })
    offered.add(asked)
    return () => {
      offered.delete(asked)
    }
  }, [])

  // Once, at start, when nothing else is being asked.
  useEffect(() => {
    if (!updates || blocked || started.current) return
    started.current = true
    void (async () => {
      const prefs = await loadPreferences(platform.settings)
      const now = Date.now()
      if (!dueForCheck(prefs, now)) return
      const check = await checkForUpdate(updates, prefs)
      if (check.kind === 'unsupported') return
      // Errors (offline) are quiet and tried again next start.
      if (check.kind === 'error') return
      await savePreferences(
        platform.settings,
        afterCheck(await loadPreferences(platform.settings), now),
      )
      if (check.kind === 'available') setUpdate(check.update)
    })().catch((e) => console.warn('Update check failed:', e))
  }, [updates, blocked, platform.settings, setUpdate])

  const skip = useCallback(async () => {
    if (!update) return
    setUpdate(null)
    await savePreferences(
      platform.settings,
      skipping(await loadPreferences(platform.settings), update.version),
    )
  }, [update, platform.settings, setUpdate])

  return update && (found?.asked || !blocked) ? (
    <UpdatePrompt update={update} onLater={() => setUpdate(null)} onSkip={() => void skip()} />
  ) : null
}

export function UpdatePrompt({
  update,
  onLater,
  onSkip,
}: {
  update: AvailableUpdate
  onLater: () => void
  onSkip: () => void
}) {
  const [progress, setProgress] = useState<number | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const installing = progress !== undefined && !error
  const install = async () => {
    setError(null)
    setProgress(null)
    try {
      await update.install(setProgress)
    } catch (e) {
      setError(`The update couldn’t be installed: ${errorMessage(e)}`)
    }
  }
  return (
    <Dialog
      title={`Version ${update.version} is available`}
      onClose={installing ? () => {} : onLater}
      footer={
        <>
          <button type="button" onClick={onSkip} disabled={installing}>
            Skip this version
          </button>
          <button type="button" onClick={onLater} disabled={installing}>
            Later
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => void install()}
            disabled={installing}
          >
            Update now
          </button>
        </>
      }
    >
      <div className="update-prompt" data-testid="update-prompt">
        {update.notes.trim() ? (
          <>
            <h3 className="pref-heading">What’s new</h3>
            <pre className="update-notes">{update.notes.trim()}</pre>
          </>
        ) : (
          <p className="muted">No release notes.</p>
        )}
        {installing && (
          <p role="status">
            {progress === null || progress === undefined
              ? 'Downloading…'
              : progress < 1
                ? `Downloading… ${Math.round(progress * 100)}%`
                : 'Installing; the app restarts when it’s done.'}
          </p>
        )}
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}
