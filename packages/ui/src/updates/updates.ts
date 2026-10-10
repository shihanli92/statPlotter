import type { AppPreferences } from '@ps/model'

// Updates of the desktop app (roadmap 41, decisions 612, 615): the platform finds them (Tauri's
// updater reading the latest GitHub Release's `latest.json`); this decides when to look and
// whether to offer what it finds. Pure, so tested with a fake updater.

/** An update the platform found. */
export interface AvailableUpdate {
  version: string
  /** The release notes (Markdown as written in the release; shown as text). */
  notes: string
  /** When it was published (ISO), where known. */
  date?: string
  /**
   * Downloads and installs it, then restarts the app. `progress` gets the fraction downloaded
   * (null while the size is unknown).
   */
  install(progress?: (fraction: number | null) => void): Promise<void>
}

/** The platform's updater (desktop app only). */
export interface Updates {
  /** False when this build has no update key (the release wasn't set up for updates). */
  supported(): Promise<boolean>
  /** The newer version, or null when this one is the latest. Throws when it can't tell. */
  check(): Promise<AvailableUpdate | null>
}

/** At most one automatic check a day. */
export const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000

/** Whether the app checks by itself now: on unless turned off, and not checked in a day. */
export function dueForCheck(prefs: AppPreferences, now: number): boolean {
  if (prefs.checkUpdates === false) return false
  const last = prefs.lastUpdateCheck
  // A clock set back since: check again.
  return last === undefined || now - last >= UPDATE_INTERVAL_MS || last > now
}

export type UpdateCheck =
  | { kind: 'unsupported' }
  | { kind: 'latest' }
  | { kind: 'available'; update: AvailableUpdate }
  /** Newer, but the user chose to skip this version (offered again only by "Check now"). */
  | { kind: 'skipped'; update: AvailableUpdate }
  | { kind: 'error'; message: string }

/**
 * Asks the updater. An automatic check passes over a skipped version; "Check now" (`manual`)
 * offers it anyway.
 */
export async function checkForUpdate(
  updates: Updates,
  prefs: AppPreferences,
  manual = false,
): Promise<UpdateCheck> {
  try {
    if (!(await updates.supported())) return { kind: 'unsupported' }
    const update = await updates.check()
    if (!update) return { kind: 'latest' }
    if (!manual && update.version === prefs.skippedVersion) return { kind: 'skipped', update }
    return { kind: 'available', update }
  } catch (e) {
    return { kind: 'error', message: e instanceof Error ? e.message : String(e) }
  }
}

/** What Preferences says after a check. */
export function checkMessage(check: UpdateCheck, current: string): string {
  switch (check.kind) {
    case 'unsupported':
      return UPDATES_NOT_SET_UP
    case 'latest':
      return `You have the latest version (${current}).`
    case 'available':
    case 'skipped':
      return `Version ${check.update.version} is available.`
    case 'error':
      return `Couldn’t check for updates: ${check.message}`
  }
}

export const UPDATES_NOT_SET_UP = 'Updates aren’t set up for this build.'

/** The preferences after a check (when it happened; a skipped version kept). */
export const afterCheck = (prefs: AppPreferences, now: number): AppPreferences => ({
  ...prefs,
  lastUpdateCheck: now,
})

/** The preferences after "Skip this version". */
export const skipping = (prefs: AppPreferences, version: string): AppPreferences => ({
  ...prefs,
  skippedVersion: version,
})
