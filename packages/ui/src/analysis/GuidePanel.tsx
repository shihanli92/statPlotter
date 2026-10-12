import {
  entriesFor,
  fillReason,
  guideEntry,
  KIND_NAMES,
  methodCard,
  notHere,
  registry,
  walkAnswers,
  walkGuide,
  withNames,
} from '@ps/analyses'
import type {
  GuideAnswer,
  GuideAnswers,
  GuideAsk,
  GuideElsewhere,
  GuideLeaf,
  GuideQuestion,
  TableFacts,
  TableKind,
} from '@ps/model'
import { useEffect, useId, useRef } from 'react'

// Roadmap 51a: the Guide me tab of the Analyze dialog (design §3): the table kind's questions,
// follow-up questions about the experiment (counting ones answered from the table's shape), then
// a recommendation with its reason, what you will get and up to two alternatives. It writes
// params ("Use this"); it never runs anything and never shows a statistic.

/** What "Use this" hands the dialog. */
export interface GuideChoice {
  analysisId: string
  params: Record<string, unknown>
  entry: string
  answers: Record<string, string>
}

/** The table's shape in a sentence ("3 groups (A, B, C), 8 values each, raw values"). */
export function factsLine(f: TableFacts): string {
  if (f.kind === 'multipleVariables' && f.variables) {
    const v = f.variables
    const n = v.numbers.length + v.binary.length + v.texts.length
    return `${n} variable${n === 1 ? '' : 's'}: ${v.numbers.length} numbers, ${v.binary.length} coded 0/1, ${v.texts.length} text; ${f.rows} rows.`
  }
  if (f.kind === 'contingency' && f.contingency)
    return `A ${f.contingency.rows} × ${f.contingency.columns} table of counts.`
  const g = f.groups
  if (!g.length) return 'No data sets chosen.'
  const sizes = new Set(g.map((x) => x.n))
  const each =
    sizes.size === 1 ? `${g[0]!.n} values each` : `${g.map((x) => x.n).join(', ')} values`
  const names = g.length <= 6 ? ` (${g.map((x) => x.title || 'untitled').join(', ')})` : ''
  return `${g.length} ${g.length === 1 ? 'group' : 'groups'}${names}, ${each}, ${f.raw ? 'raw values' : 'entered as mean/SD/N'}.`
}

/** The method line ("One-way ANOVA · Tukey · 95% CI"). */
export function methodLine(analysisId: string, params: Record<string, unknown>): string {
  const def = registry.get(analysisId)
  if (!def) return analysisId
  const parsed = def.params.safeParse(params)
  const p = parsed.success ? (parsed.data as Record<string, unknown>) : {}
  const cards = (parsed.success ? def.cards?.(parsed.data) : undefined) ?? []
  const names = cards.map((id, i) => (i ? methodCard(id)?.shortName : methodCard(id)?.name) ?? id)
  const level =
    typeof p.confidenceLevel === 'number' ? `${Math.round(p.confidenceLevel * 100)}% CI` : null
  const tails = p.tails === 'two' ? 'two-tailed' : p.tails === 'one' ? 'one-tailed' : null
  return [...(names.length ? names : [def.title]), level, tails].filter(Boolean).join(' · ')
}

function AskField({
  ask,
  value,
  groups,
  onChange,
}: {
  ask: GuideAsk
  value: string
  groups: { key: string; title: string }[]
  onChange: (v: string) => void
}) {
  const id = useId()
  return (
    <span className="guide-ask">
      <label htmlFor={id}>{ask.label}</label>{' '}
      {ask.kind === 'group' ? (
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          {groups.map((g) => (
            <option key={g.key} value={g.key}>
              {g.title || '(untitled)'}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          type="number"
          className="guide-number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </span>
  )
}

/** One question as a radio group: its answers, unavailable ones greyed with the reason. */
function QuestionView({
  question,
  facts,
  answers,
  groups,
  onAnswer,
  onAsk,
}: {
  question: GuideQuestion
  facts: TableFacts
  answers: GuideAnswers
  groups: { key: string; title: string }[]
  onAnswer: (q: GuideQuestion, a: GuideAnswer) => void
  onAsk: (id: string, v: string) => void
}) {
  const name = useId()
  const hint = question.hint?.(facts) ?? null
  return (
    <fieldset className="guide-question" aria-describedby={`${name}-why`}>
      <legend>{question.text}</legend>
      <div id={`${name}-why`} className="help explain">
        {question.why}
      </div>
      {hint && (
        <div className="guide-hint" role="note">
          {hint}
        </div>
      )}
      {question.answers.map((a, i) => {
        const reason = a.unavailable?.(facts) ?? null
        const chosen = answers[question.id] === a.id
        const oid = `${name}-${i}`
        return (
          <div key={a.id} className={`radio-option${reason ? ' unavailable' : ''}`}>
            <label className="check">
              <input
                type="radio"
                name={name}
                checked={chosen && !reason}
                aria-disabled={reason ? true : undefined}
                aria-describedby={reason || a.explain ? oid : undefined}
                onChange={() => {
                  if (!reason) onAnswer(question, a)
                }}
              />
              {a.text}
            </label>
            {(reason || a.explain) && (
              <div id={oid} className="option-line">
                {reason ?? a.explain}
              </div>
            )}
            {chosen &&
              !reason &&
              a.asks?.map((ask) => (
                <AskField
                  key={ask.id}
                  ask={ask}
                  value={answers[ask.id] ?? ''}
                  groups={groups}
                  onChange={(v) => onAsk(ask.id, v)}
                />
              ))}
          </div>
        )
      })}
    </fieldset>
  )
}

function Recommendation({
  leaf,
  facts,
  answers,
  entryId,
  onUse,
  onShowAll,
}: {
  leaf: GuideLeaf
  facts: TableFacts
  answers: GuideAnswers
  entryId: string
  onUse: (c: GuideChoice) => void
  onShowAll: () => void
}) {
  const def = registry.get(leaf.analysisId)
  const params = leaf.params(facts, answers)
  const parsed = def?.params.safeParse(params)
  const cards = (parsed?.success ? def?.cards?.(parsed.data) : undefined) ?? []
  const card = cards[0] ? methodCard(cards[0]) : undefined
  const control = facts.groups.find((g) => g.key === answers.control)?.title
  const names = {
    ...(facts.groups[0] ? { A: facts.groups[0].title } : {}),
    ...(facts.groups[1] ? { B: facts.groups[1].title } : {}),
    ...(control ? { control } : {}),
  }
  const headingId = useId()
  const use = (analysisId: string, p: Record<string, unknown>) =>
    onUse({ analysisId, params: p, entry: entryId, answers: { ...answers } })
  return (
    <section className="guide-recommendation" aria-labelledby={headingId}>
      <h3 id={headingId}>Recommended: {card?.name ?? def?.title}</h3>
      <p className="guide-reason">{fillReason(leaf.reason, facts, answers)}</p>
      {card && (
        <p>
          <strong>You will get:</strong> {withNames(card.reading, names)}
        </p>
      )}
      {leaf.nextStep && <p className="guide-then">{leaf.nextStep}</p>}
      <p className="guide-method">{methodLine(leaf.analysisId, params)}</p>
      <div className="guide-actions">
        <button type="button" className="primary" onClick={() => use(leaf.analysisId, params)}>
          Use this
        </button>
        <button type="button" onClick={onShowAll}>
          Show all analyses
        </button>
      </div>
      {leaf.alternatives.length > 0 && (
        <div className="guide-alternatives">
          <h4>Alternatives</h4>
          <ul>
            {leaf.alternatives.map((alt) => {
              const p = alt.params(facts, answers)
              const label = methodLine(alt.analysisId, p).split(' · ')[0]
              return (
                <li key={`${alt.analysisId}-${alt.when}`}>
                  <strong>{label}</strong>: choose this when {alt.when}.{' '}
                  <button type="button" className="link" onClick={() => use(alt.analysisId, p)}>
                    Use {label}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </section>
  )
}

/** What another table kind would answer, and the button that makes one. */
function Elsewhere({
  end,
  onNewTable,
}: {
  end: GuideElsewhere
  onNewTable: (kind: TableKind) => void
}) {
  const needs = end.needs
  return (
    <section className="guide-recommendation" aria-label="Another table kind">
      <p>{end.text}</p>
      {end.action === 'newTable' && needs && (
        <button type="button" onClick={() => onNewTable(needs)}>
          New {KIND_NAMES[needs]} table…
        </button>
      )}
    </section>
  )
}

export function GuidePanel({
  kind,
  tableName,
  facts,
  groups,
  choices,
  entryId,
  answers,
  onEntry,
  onAnswers,
  onSelection,
  selection,
  onUse,
  onShowAll,
  onNewTable,
}: {
  kind: TableKind
  tableName: string
  facts: TableFacts
  /** The values a group ask offers (the data sets, or variables, chosen). */
  groups: { key: string; title: string }[]
  /** Every data set of the table, to choose which the questions are about. */
  choices: { key: string; title: string }[]
  entryId: string | null
  answers: GuideAnswers
  onEntry: (id: string) => void
  onAnswers: (a: Record<string, string>) => void
  selection: readonly string[]
  onSelection: (keys: string[]) => void
  onUse: (c: GuideChoice) => void
  onShowAll: () => void
  onNewTable: (kind: TableKind) => void
}) {
  const entries = entriesFor(kind)
  const others = notHere(kind)
  const entry = entryId ? guideEntry(entryId) : undefined
  const walk = entry && entries.includes(entry) ? walkGuide(entry, facts, answers) : null
  // The recommendation, once reached, scrolled into view (below the questions).
  const detail = useRef<HTMLDivElement>(null)
  const ended = walk?.end ?? null
  useEffect(() => {
    if (ended)
      detail.current
        ?.querySelector('.guide-recommendation')
        ?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [ended])
  /** The answers with the facts' and the asked values' (initial ones too). */
  const all = walk ? { ...answers, ...walkAnswers(walk, answers, facts) } : answers

  const answer = (q: GuideQuestion, a: GuideAnswer) => {
    // A new answer drops the answers of the questions after it.
    const at = walk?.taken.findIndex((t) => t.question === q) ?? -1
    const later = at < 0 ? [] : walk!.taken.slice(at + 1).map((t) => t.question.id)
    const next: Record<string, string> = {}
    for (const [k, v] of Object.entries(answers)) if (!later.includes(k)) next[k] = v
    next[q.id] = a.id
    for (const ask of a.asks ?? []) next[ask.id] ??= ask.initial?.(facts) ?? ''
    onAnswers(next)
  }

  return (
    <div className="analyze guide">
      <div className="analyze-list guide-rail">
        <h4 id="guide-rail-title">What do you want to know?</h4>
        <ul className="guide-entries" aria-labelledby="guide-rail-title">
          {entries.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                className={`list-item${e.id === entryId ? ' on' : ''}`}
                aria-pressed={e.id === entryId}
                onClick={() => onEntry(e.id)}
              >
                {e.question}
              </button>
            </li>
          ))}
        </ul>
        <details className="guide-elsewhere">
          <summary>Not here?</summary>
          <ul>
            {others.map((o) => (
              <li key={o.entry.id}>
                <span className="guide-elsewhere-question">{o.entry.question}</span>
                <span className="help">{o.line}</span>
                <button type="button" className="link" onClick={() => onNewTable(o.needs)}>
                  New {KIND_NAMES[o.needs]} table…
                </button>
              </li>
            ))}
          </ul>
        </details>
      </div>
      <div className="analyze-detail guide-detail" ref={detail}>
        <p className="guide-facts">
          <strong>Your table, “{tableName}”:</strong> {factsLine(facts)}
        </p>
        {choices.length > 1 && kind !== 'multipleVariables' && (
          <fieldset className="guide-groups">
            <legend>Data sets the questions are about</legend>
            {choices.map((c) => (
              <label key={c.key} className="check">
                <input
                  type="checkbox"
                  checked={selection.includes(c.key)}
                  onChange={(e) =>
                    onSelection(
                      choices
                        .map((x) => x.key)
                        .filter((k) => (k === c.key ? e.target.checked : selection.includes(k))),
                    )
                  }
                />
                {c.title || '(untitled)'}
              </label>
            ))}
          </fieldset>
        )}
        {!walk && (
          <p className="muted guide-start">
            Choose a question on the left. The guide asks about your experiment, then recommends an
            analysis with its reasons; nothing is computed until you press OK.
          </p>
        )}
        {walk && (
          <>
            <h3 className="guide-title">{entry!.question}</h3>
            {walk.taken.map((t) =>
              t.auto ? (
                <div key={t.question.id} className="guide-fact" role="note">
                  {t.question.text}{' '}
                  <strong>{t.question.answers.find((a) => a.id === t.answer)?.text}</strong>{' '}
                  <span className="help">(from your table or your question)</span>
                  {t.question.answers
                    .find((a) => a.id === t.answer)
                    ?.asks?.map((ask) => (
                      <AskField
                        key={ask.id}
                        ask={ask}
                        value={all[ask.id] ?? ''}
                        groups={groups}
                        onChange={(v) => onAnswers({ ...answers, [ask.id]: v })}
                      />
                    ))}
                </div>
              ) : (
                <QuestionView
                  key={t.question.id}
                  question={t.question}
                  facts={facts}
                  answers={answers}
                  groups={groups}
                  onAnswer={answer}
                  onAsk={(id, v) => onAnswers({ ...answers, [id]: v })}
                />
              ),
            )}
            {walk.current && (
              <QuestionView
                question={walk.current}
                facts={facts}
                answers={answers}
                groups={groups}
                onAnswer={answer}
                onAsk={(id, v) => onAnswers({ ...answers, [id]: v })}
              />
            )}
            {walk.end?.kind === 'leaf' && (
              <Recommendation
                leaf={walk.end}
                facts={facts}
                answers={all}
                entryId={entry!.id}
                onUse={onUse}
                onShowAll={onShowAll}
              />
            )}
            {walk.end?.kind === 'elsewhere' && <Elsewhere end={walk.end} onNewTable={onNewTable} />}
          </>
        )}
      </div>
    </div>
  )
}
