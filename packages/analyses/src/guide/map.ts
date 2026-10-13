import type { GuideAnswers, GuideEntry, TableFacts } from '@ps/model'
import { walkGuide } from './index.ts'

// Roadmap 51f: the map of the path through Guide me — the questions answered with the answer
// chosen (by the user, or by the table: a fact), the question to answer next, then where the
// path leads (a recommendation, another table kind) or, before then, that a recommendation
// follows. Each step answered is a way back to its question; changing an answer keeps the later
// answers that still apply (`reanswer`).

export type GuideMapStep =
  | {
      kind: 'answered'
      questionId: string
      question: string
      answer: string
      /** Answered by the table or the question asked (a count), not by the user. */
      auto: boolean
      /** How many answers the question offers (the branches it could take). */
      branches: number
    }
  | { kind: 'next'; questionId: string; question: string; branches: number }
  | { kind: 'leaf'; analysisId: string }
  | { kind: 'elsewhere'; text: string }
  /** The recommendation, not reached yet. */
  | { kind: 'later' }

/** The steps of the path the answers take through `entry`'s tree. */
export function guideMap(
  entry: GuideEntry,
  facts: TableFacts,
  answers: GuideAnswers,
): GuideMapStep[] {
  const walk = walkGuide(entry, facts, answers)
  const steps: GuideMapStep[] = walk.taken.map((t) => ({
    kind: 'answered',
    questionId: t.question.id,
    question: t.question.text,
    answer: t.question.answers.find((a) => a.id === t.answer)?.text ?? t.answer,
    auto: t.auto,
    branches: t.question.answers.length,
  }))
  if (walk.current)
    steps.push({
      kind: 'next',
      questionId: walk.current.id,
      question: walk.current.text,
      branches: walk.current.answers.length,
    })
  const end = walk.end
  steps.push(
    !end
      ? { kind: 'later' }
      : end.kind === 'leaf'
        ? { kind: 'leaf', analysisId: end.analysisId }
        : { kind: 'elsewhere', text: end.text },
  )
  return steps
}

/**
 * The answers after `questionId` is answered `answerId`: the answers of the questions still on
 * the new path are kept (the same question asked further on, "What kind of values?" after
 * changing whether the subjects are matched), the others dropped; the values the new answer asks
 * for start at their initial values unless given.
 */
export function reanswer(
  entry: GuideEntry,
  facts: TableFacts,
  answers: GuideAnswers,
  questionId: string,
  answerId: string,
): Record<string, string> {
  const next: Record<string, string> = { ...answers, [questionId]: answerId }
  const walk = walkGuide(entry, facts, next)
  const chosen = [...walk.taken.map((t) => t.question), ...(walk.current ? [walk.current] : [])]
    .find((q) => q.id === questionId)
    ?.answers.find((a) => a.id === answerId)
  for (const ask of chosen?.asks ?? []) next[ask.id] ??= ask.initial?.(facts) ?? ''
  const after = walkGuide(entry, facts, next)
  const keep = new Set<string>()
  for (const t of after.taken) {
    keep.add(t.question.id)
    const a = t.question.answers.find((x) => x.id === t.answer)
    for (const ask of a?.asks ?? []) keep.add(ask.id)
  }
  if (after.current) keep.add(after.current.id)
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(next)) if (keep.has(k)) out[k] = v
  return out
}

/** The answers on the path, and those hidden by changing an answer (off the path for now). */
export interface GuideAnswerState {
  answers: Record<string, string>
  hidden: Record<string, string>
}

/**
 * Audit 4 (A4; amends 1339): `reanswer` that hides the answers that no longer apply instead of
 * deleting them, and gives a hidden answer back when its question is on the path again — so
 * changing an answer and changing it back (arrowing through a question's radios) loses nothing,
 * the recommendation included. An answer on the path is newer than a hidden one and stays.
 * Hidden answers are view state: never stored with the analysis.
 */
export function reanswerHiding(
  entry: GuideEntry,
  facts: TableFacts,
  state: GuideAnswerState,
  questionId: string,
  answerId: string,
): GuideAnswerState {
  const base = { ...state.hidden, ...state.answers }
  const answers = reanswer(entry, facts, base, questionId, answerId)
  const hidden: Record<string, string> = {}
  for (const [k, v] of Object.entries(base)) if (!(k in answers)) hidden[k] = v
  return { answers, hidden }
}
