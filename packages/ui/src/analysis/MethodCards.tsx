import { methodCard, withNames } from '@ps/analyses'
import type { MethodCard } from '@ps/model'

// Roadmap 51a: the method cards (design §2), drawn from the one source in @ps/analyses: the
// Analyze dialog's About this method, the results' How to read this, Help › Choosing an analysis
// and the chooser's recommendation.

export type CardNames = { A?: string; B?: string; control?: string }

/** The neighbours' names and when to prefer them. */
function Instead({ card, names }: { card: MethodCard; names: CardNames }) {
  if (!card.instead.length) return null
  return (
    <ul className="card-instead">
      {card.instead.map((i) => (
        <li key={i.card}>
          <strong>{methodCard(i.card)?.name ?? i.card}</strong> when {withNames(i.when, names)}
        </li>
      ))}
    </ul>
  )
}

/** "More": the formula, the R call, notes and references. */
function More({ card }: { card: MethodCard }) {
  return (
    <details className="card-more">
      <summary>More: formula, R and references</summary>
      <p>{card.more.formula}</p>
      <p>
        R: <code>{card.more.r}</code>
      </p>
      {card.more.notes && <p>{card.more.notes}</p>}
      {card.references.length > 0 && (
        <ul>
          {card.references.map((r) => (
            <li key={r.text}>
              {r.text}
              {r.doi && <> (doi: {r.doi})</>}
            </li>
          ))}
        </ul>
      )}
    </details>
  )
}

/**
 * One card. `mode`: 'about' (what it asks, when to use it, neighbours, assumptions, reading),
 * 'reading' (how to read a result: the null and the reading, with the user's names).
 */
export function MethodCardView({
  id,
  names = {},
  mode = 'about',
  headingLevel = 4,
}: {
  id: string
  names?: CardNames
  mode?: 'about' | 'reading'
  headingLevel?: 3 | 4 | 5
}) {
  const card = methodCard(id)
  if (!card) return null
  const H = `h${headingLevel}` as 'h4'
  const t = (s: string) => withNames(s, names)
  return (
    <section className="method-card" aria-label={card.name} id={`card-${card.id}`}>
      <H>{card.name}</H>
      <p className="card-question">{t(card.question)}</p>
      {mode === 'about' && (
        <>
          <p>
            <strong>Use it when:</strong> {t(card.useWhen)}
          </p>
          {card.instead.length > 0 && (
            <div>
              <strong>Choose instead:</strong>
              <Instead card={card} names={names} />
            </div>
          )}
          {card.assumptions.length > 0 && (
            <div>
              <strong>It assumes:</strong>
              <ul>
                {card.assumptions.map((a) => (
                  <li key={a}>{t(a)}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      {card.nullHypothesis && (
        <p>
          <strong>What P refers to:</strong> {t(card.nullHypothesis)}
        </p>
      )}
      <p>
        <strong>{mode === 'about' ? 'You will get:' : 'How to read it:'}</strong> {t(card.reading)}
      </p>
      <More card={card} />
    </section>
  )
}

/** Several cards (the test, then its comparisons). */
export function MethodCards({
  ids,
  names,
  mode,
}: {
  ids: readonly string[]
  names?: CardNames
  mode?: 'about' | 'reading'
}) {
  return (
    <div className="method-cards">
      {ids.map((id) => (
        <MethodCardView
          key={id}
          id={id}
          {...(names ? { names } : {})}
          {...(mode ? { mode } : {})}
        />
      ))}
    </div>
  )
}
