import { useEffect, useState } from 'react'
import { useExportActivity } from './ExportDialog.tsx'

// The window's export status (roadmap 42): while an export, a copy or a print is being made in
// the export worker (seconds for a graph of a million points), what it is and how far it has got,
// so the window, which stays responsive meanwhile, says why the file hasn't come yet. Not for
// exports whose own dialog shows their progress.

/** Shown only after this long, so a quick export doesn't flash it. */
const SHOW_AFTER_MS = 400

export function ExportStatus() {
  const activity = useExportActivity()
  const label = activity?.status ? activity.label : null
  const [due, setDue] = useState<string | null>(null)
  useEffect(() => {
    setDue(null)
    if (!label) return
    const t = setTimeout(() => setDue(label), SHOW_AFTER_MS)
    return () => clearTimeout(t)
  }, [label])
  if (!activity || !label || due !== label) return null
  return (
    <div className="export-status" role="status">
      <span>{label}…</span>
      <progress
        aria-label={label}
        max={1}
        {...(activity.fraction !== null ? { value: activity.fraction } : {})}
      />
    </div>
  )
}
