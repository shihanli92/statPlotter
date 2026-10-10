// What the app does with the user's data (roadmap 48): the same words as the README's Privacy
// section, shown on the start screen (folded under "Your data stays on this device.") and in
// Help › About. Each claim is checked against the code: the Content-Security-Policy in
// apps/web/public/_headers and tauri.conf.json (connect-src 'self'), no requests to other
// origins, fonts bundled, recovery copies in the browser's IndexedDB or the desktop app's data
// folder, and the desktop update check (updates/updates.ts: at most once a day, off in
// Preferences).

/** The one-line summary. */
export const PRIVACY_SUMMARY = 'Your data stays on this device.'

/** The privacy note for the web app or the desktop app. */
export function privacyText(desktop: boolean): string {
  return desktop
    ? 'statPlotter runs entirely on your computer. Your data, files and graphs stay there: ' +
        'nothing is uploaded, there is no account, and no tracking or analytics. The app’s ' +
        'window is also technically blocked from sending anything to any site (its security ' +
        'policy allows connections only to the app itself). The one exception: when this build ' +
        'is set up for updates, it asks the release page at most once a day whether a newer ' +
        'version exists, sending nothing about your work (turn it off in Preferences). Unsaved ' +
        'work is kept as a recovery copy in the app’s own folder on this computer.'
    : 'statPlotter runs entirely in your browser. Your data, files and graphs stay on your ' +
        'computer: nothing is uploaded to a server, there is no account, and no tracking or ' +
        'analytics. The app is also technically blocked from sending anything to any other ' +
        'site (its security policy allows connections only to its own address). Unsaved work ' +
        'is kept as a recovery copy in this browser’s storage on your device. On a shared ' +
        'computer, use a private window or clear the site’s data when you’re done.'
}
