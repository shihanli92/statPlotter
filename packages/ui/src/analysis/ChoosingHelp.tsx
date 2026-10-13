import { registry } from '@ps/analyses'
import {
  CARD_FAMILIES,
  entriesFor,
  type GuideOutline,
  guideOutline,
  KIND_NAMES,
} from '@ps/analyses/dialog'
import type { TableKind } from '@ps/model'
import { useState } from 'react'
import { Dialog } from '../components/Dialog.tsx'
import { MethodCardView } from './MethodCards.tsx'

// Roadmap 51a: Help › Choosing an analysis (design §2.2): a page generated from the chooser's
// trees and the method cards, each recommendation linking to its card. No hand-written copy.

const KINDS: TableKind[] = [
  'column',
  'grouped',
  'xy',
  'contingency',
  'survival',
  'partsOfWhole',
  'multipleVariables',
  'nested',
]

/** The card a recommendation's analysis shows with its default params. */
function leafCard(analysisId: string): string | undefined {
  const def = registry.get(analysisId)
  try {
    return def?.cards?.(def.params.parse({}))[0]
  } catch {
    return undefined
  }
}

function Outline({ step }: { step: GuideOutline }) {
  if (step.kind === 'leaf') {
    const card = leafCard(step.analysisId)
    return (
      <p className="help-leaf">
        → <strong>{registry.get(step.analysisId)?.title ?? step.analysisId}</strong>
        {card && (
          <>
            {' '}
            (<a href={`#card-${card}`}>about the method</a>)
          </>
        )}
        : {step.reason}
        {step.nextStep && <> {step.nextStep}</>}
      </p>
    )
  }
  if (step.kind === 'elsewhere') return <p className="help-leaf">→ {step.text}</p>
  return (
    <div className="help-question">
      <p>
        <strong>{step.text}</strong> <span className="muted">{step.why}</span>
      </p>
      <ul>
        {step.answers.map((a) => (
          <li key={a.text}>
            {a.text}
            {a.next && <Outline step={a.next} />}
          </li>
        ))}
      </ul>
      {step.follows && <Outline step={step.follows} />}
    </div>
  )
}

export function ChoosingHelp({ onClose }: { onClose: () => void }) {
  const [kind, setKind] = useState<TableKind>('column')
  return (
    <Dialog
      title="Choosing an analysis"
      onClose={onClose}
      wide
      footer={
        <button type="button" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="choosing-help">
        <p className="muted">
          The questions Analyze › Guide me asks, by the kind of table, and the method each answer
          leads to. Decide from the experiment, before seeing results; nothing here is computed.
        </p>
        <div className="tabs" role="tablist" aria-label="Table kind">
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={k === kind}
              className={k === kind ? 'on' : ''}
              onClick={() => setKind(k)}
            >
              {KIND_NAMES[k][0]!.toUpperCase() + KIND_NAMES[k].slice(1)}
            </button>
          ))}
        </div>
        <div role="tabpanel" aria-label={`${KIND_NAMES[kind]} tables`}>
          {entriesFor(kind).map((e) => (
            <section key={e.id} className="help-entry" aria-label={e.question}>
              <h3>{e.question}</h3>
              <Outline step={guideOutline(e.start)} />
            </section>
          ))}
        </div>
        <h2 className="help-cards-title">Method cards</h2>
        {CARD_FAMILIES.map((f) => (
          <section key={f.title} aria-label={f.title}>
            <h3>{f.title}</h3>
            {f.cards.map((c) => (
              <MethodCardView key={c.id} id={c.id} headingLevel={4} />
            ))}
          </section>
        ))}
      </div>
    </Dialog>
  )
}
