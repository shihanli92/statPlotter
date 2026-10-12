import { registry } from '@ps/analyses'
import type { AnalysisNode, MethodChange } from '@ps/model'
import { useId } from 'react'

// Roadmap 51c (design §7.1, §7.2): changing a method after its results were seen is visible —
// a notice in the edit dialog (never blocking), and the method history under the results.

/** The notice shown when Apply would change the method of an analysis whose results were seen. */
export function MethodChangeNotice({
  changes,
  reason,
  onReason,
  onAddAsNew,
}: {
  changes: readonly string[]
  reason: string
  onReason: (reason: string) => void
  onAddAsNew: () => void
}) {
  const id = useId()
  return (
    <section className="method-change-notice" role="note" aria-labelledby={`${id}-title`}>
      <p>
        <strong id={`${id}-title`}>You are changing the method after seeing results.</strong>{' '}
        Changing the test after seeing P values makes them less trustworthy. Both methods will be
        listed in the method history under the results.
      </p>
      <ul className="method-changes">
        {changes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <label htmlFor={`${id}-reason`}>Reason (optional)</label>
      <textarea
        id={`${id}-reason`}
        rows={2}
        maxLength={500}
        value={reason}
        onChange={(e) => onReason(e.target.value)}
      />
      <div className="method-change-actions">
        <button type="button" onClick={onAddAsNew}>
          Add as a new analysis
        </button>
        <span className="help">Or Apply to change this one (the change is recorded).</span>
      </div>
    </section>
  )
}

const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

/** "12 Oct 2026" (the ISO date-time as given, if it isn't one). */
export const changeDate = (at: string) => {
  const d = new Date(at)
  return Number.isNaN(d.getTime()) ? at : DATE.format(d)
}

/** One line per change: when, what it was, whether after results, why. */
export function historyLines(node: Pick<AnalysisNode, 'history' | 'historyEarlier'>): string[] {
  const out = (node.history ?? []).map((h: MethodChange) => {
    const was = registry.get(h.from.analysisId)?.title ?? h.from.analysisId
    return `${changeDate(h.at)}: ${h.afterResults ? 'changed after its results were seen' : 'changed before results'} (it was ${was}): ${h.changes.join('; ')}${h.reason ? ` — reason: “${h.reason}”` : ''}.`
  })
  if (node.historyEarlier)
    out.unshift(`${node.historyEarlier} earlier change${node.historyEarlier > 1 ? 's' : ''}.`)
  return out
}

/** The method history, under the results (absent when the method never changed). */
export function MethodHistory({ node }: { node: AnalysisNode }) {
  const lines = historyLines(node)
  if (!lines.length) return null
  const after = (node.history ?? []).some((h) => h.afterResults)
  return (
    <details className="method-history" open={after}>
      <summary>
        Method history{after ? ': changed after results were seen' : ''} ({lines.length})
      </summary>
      <ul>
        {lines.map((l, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the history only grows, in order
          <li key={i}>{l}</li>
        ))}
      </ul>
    </details>
  )
}
