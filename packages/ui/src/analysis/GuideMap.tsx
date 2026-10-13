import type { GuideMapStep } from '@ps/analyses/dialog'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'

// Roadmap 51f: the map of the path through Guide me, under the question chosen in the rail —
// each question answered with its answer (the branch taken), the question to answer next, then
// the recommendation it leads to (or that one follows). A step is a button going back to its
// question (changing it keeps the later answers that still apply). One tab stop: ↑ ↓ (← →),
// Home and End move between the steps, Enter or Space goes there.

export function GuideMap({
  steps,
  methodTitle,
  onGo,
}: {
  steps: readonly GuideMapStep[]
  /** An analysis' name ("Welch’s t test"). */
  methodTitle: (analysisId: string) => string
  onGo: (step: GuideMapStep) => void
}) {
  const current = Math.max(
    0,
    steps.findIndex((s) => s.kind === 'next' || s.kind === 'leaf' || s.kind === 'elsewhere'),
  )
  const [active, setActive] = useState(current)
  const at = Math.min(active, steps.length - 1)
  // A new step (an answer given) moves the tab stop to where the path now stands.
  useEffect(() => setActive(current), [current])
  const list = useRef<HTMLOListElement>(null)
  const move = (i: number) => {
    const n = steps.length
    const next = (i + n) % n
    setActive(next)
    list.current?.querySelectorAll<HTMLButtonElement>('button.map-step')[next]?.focus()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') move(at + 1)
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') move(at - 1)
    else if (e.key === 'Home') move(0)
    else if (e.key === 'End') move(steps.length - 1)
    else return
    e.preventDefault()
  }
  const answered = steps.filter((s) => s.kind === 'answered').length
  return (
    <ol
      ref={list}
      className="guide-map"
      aria-label={`Your path: ${answered} question${answered === 1 ? '' : 's'} answered`}
      onKeyDown={onKey}
    >
      {steps.map((s, i) => {
        const tab = i === at ? 0 : -1
        const key =
          s.kind === 'answered' || s.kind === 'next' ? `${s.kind}-${s.questionId}` : s.kind
        if (s.kind === 'answered')
          return (
            <li key={key} className={`map-item answered${s.auto ? ' auto' : ''}`}>
              <button
                type="button"
                className="map-step"
                tabIndex={tab}
                title={s.question}
                aria-label={`Step ${i + 1}: ${s.question} Answer: ${s.answer}${s.auto ? ' (from your table).' : `, one of ${s.branches} answers. Go back to change it.`}`}
                onFocus={() => setActive(i)}
                onClick={() => onGo(s)}
              >
                <span className="map-question">{s.question}</span>
                <span className="map-answer">
                  <span aria-hidden="true">→ </span>
                  {s.answer}
                </span>
              </button>
            </li>
          )
        if (s.kind === 'next')
          return (
            <li key={key} className="map-item next">
              <button
                type="button"
                className="map-step"
                tabIndex={tab}
                aria-current="step"
                title={s.question}
                aria-label={`Step ${i + 1}, next: ${s.question}`}
                onFocus={() => setActive(i)}
                onClick={() => onGo(s)}
              >
                <span className="map-label">Next</span>
                <span className="map-question">{s.question}</span>
              </button>
            </li>
          )
        const end =
          s.kind === 'leaf'
            ? `Leads to: ${methodTitle(s.analysisId)}`
            : s.kind === 'elsewhere'
              ? 'Leads to: another table kind'
              : 'Then: a recommendation'
        return (
          <li key={key} className={`map-item end${s.kind === 'later' ? ' later' : ''}`}>
            <button
              type="button"
              className="map-step"
              tabIndex={tab}
              {...(s.kind === 'later' ? { 'aria-disabled': true } : {})}
              aria-label={
                s.kind === 'later'
                  ? 'Then: a recommendation, once the questions are answered'
                  : `${end}. Go to the recommendation.`
              }
              onFocus={() => setActive(i)}
              onClick={() => {
                if (s.kind !== 'later') onGo(s)
              }}
            >
              {end}
            </button>
          </li>
        )
      })}
    </ol>
  )
}
