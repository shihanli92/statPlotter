import type {
  GuideAnswers,
  GuideAsk,
  GuideElsewhere,
  GuideEntry,
  GuideLeaf,
  GuideQuestion,
  GuideStep,
  TableFacts,
  TableKind,
} from '@ps/model'
import { COMPARE_ENTRIES } from './compareGroups.ts'
import { COUNT_ENTRIES } from './counts.ts'
import { DESCRIBE_ENTRIES } from './describe.ts'
import { GROUPED_ENTRIES } from './grouped.ts'
import { SURVIVAL_ENTRIES, VARIABLE_ENTRIES } from './variables.ts'
import { COLUMN_CORRELATION, XY_ENTRIES } from './xy.ts'

// Roadmap 51a: the guided chooser (docs/design/ANALYSIS_GUIDE.md §3). Trees of questions about
// the experiment, by table kind, each ending in a recommended analysis with its params (a leaf)
// or in what another table kind would answer (elsewhere). Walking a tree reads `TableFacts` only.

export { tableFacts } from './facts.ts'
export {
  type GuideAnswerState,
  type GuideMapStep,
  guideMap,
  reanswer,
  reanswerHiding,
} from './map.ts'
export { doseResponseModel } from './xy.ts'

const byId = (entries: readonly GuideEntry[], id: string) => entries.find((e) => e.id === id)!

/** Every question, in the order each kind's rail lists them (design §3.4). */
export const GUIDE_ENTRIES: readonly GuideEntry[] = [
  // Column tables.
  byId(COMPARE_ENTRIES, 'groupsDiffer'),
  byId(COMPARE_ENTRIES, 'vsControl'),
  byId(COMPARE_ENTRIES, 'trend'),
  byId(COMPARE_ENTRIES, 'setValue'),
  byId(DESCRIBE_ENTRIES, 'describe'),
  byId(DESCRIBE_ENTRIES, 'normalOdd'),
  COLUMN_CORRELATION,
  byId(DESCRIBE_ENTRIES, 'methodsAgree'),
  byId(DESCRIBE_ENTRIES, 'roc'),
  byId(COMPARE_ENTRIES, 'distributions'),
  byId(DESCRIBE_ENTRIES, 'plan'),
  // Grouped, XY, contingency, survival, parts of whole, multiple variables, nested.
  ...GROUPED_ENTRIES,
  ...XY_ENTRIES,
  ...COUNT_ENTRIES.filter((e) => e.kinds.includes('contingency')),
  ...SURVIVAL_ENTRIES,
  ...COUNT_ENTRIES.filter((e) => e.kinds.includes('partsOfWhole')),
  ...VARIABLE_ENTRIES,
  byId(COMPARE_ENTRIES, 'nestedGroups'),
]

/** An entry by id. */
export const guideEntry = (id: string): GuideEntry | undefined =>
  GUIDE_ENTRIES.find((e) => e.id === id)

/** The questions a table of `kind` can answer, in rail order. */
export const entriesFor = (kind: TableKind): GuideEntry[] =>
  GUIDE_ENTRIES.filter((e) => e.kinds.includes(kind))

/** What a question of another kind needs, in a line (design §3.7). */
export const NEEDS_LINE: Readonly<Record<TableKind, string>> = {
  column: 'Needs a column table: one column per group.',
  xy: 'Needs an XY table: X is the dose, concentration or time.',
  grouped: 'Two factors need a grouped table: one factor in rows, the other in columns.',
  contingency: 'Counts of subjects by group and outcome need a contingency table.',
  survival: 'Survival needs a survival table (time, then event or censored).',
  partsOfWhole: 'Needs a parts-of-whole table: one count per category.',
  multipleVariables: 'Several variables per subject need a multiple-variables table.',
  nested: 'Several measurements per subject need a nested table.',
}

/** The table kinds' names, as the New table dialog says them. */
export const KIND_NAMES: Readonly<Record<TableKind, string>> = {
  column: 'column',
  xy: 'XY',
  grouped: 'grouped',
  contingency: 'contingency',
  survival: 'survival',
  partsOfWhole: 'parts-of-whole',
  multipleVariables: 'multiple-variables',
  nested: 'nested',
}

/** The questions other kinds answer ("Not here?"), each with the kind it needs. */
export function notHere(kind: TableKind): { entry: GuideEntry; needs: TableKind; line: string }[] {
  return GUIDE_ENTRIES.filter((e) => !e.kinds.includes(kind)).map((entry) => {
    const needs = entry.kinds[0]!
    return { entry, needs, line: NEEDS_LINE[needs] }
  })
}

// Audit 4 (P6): the empty results card's questions, without the trees (`guideQuestions.ts`).
export { GUIDE_QUESTIONS, topQuestions } from '../guideQuestions.ts'

// ---- Walking a tree --------------------------------------------------------------------------

/** One question on the way: the answer given (by the user, or by the facts: `auto`). */
export interface GuideStepTaken {
  question: GuideQuestion
  answer: string
  auto: boolean
}

export interface GuideWalk {
  taken: GuideStepTaken[]
  /** The question to answer next (null when the walk has ended). */
  current: GuideQuestion | null
  /** The recommendation, or what another kind would answer (null while questions remain). */
  end: GuideLeaf | GuideElsewhere | null
}

/**
 * Follows `entry`'s tree: counting questions the facts answer are answered (`auto`), the others
 * from `answers`; it stops at the first question without an answer (or with an answer that is
 * unavailable for this table).
 */
export function walkGuide(entry: GuideEntry, f: TableFacts, answers: GuideAnswers): GuideWalk {
  const taken: GuideStepTaken[] = []
  let step: GuideStep = entry.start
  for (let guard = 0; guard < 64; guard++) {
    if (step.kind !== 'question') return { taken, current: null, end: step }
    const auto = step.answeredBy?.(f) ?? null
    const id = auto ?? answers[step.id]
    const chosen = step.answers.find((a) => a.id === id)
    if (!chosen || (!auto && chosen.unavailable?.(f))) return { taken, current: step, end: null }
    taken.push({ question: step, answer: chosen.id, auto: !!auto })
    step = chosen.next
  }
  throw new Error(`The guide's tree “${entry.id}” is deeper than 64 questions.`)
}

/**
 * The answers a walk used, the facts' ones included (for the leaf's params and `origin.guide`);
 * a value an answer asks for and nobody gave yet takes its initial value.
 */
export function walkAnswers(
  walk: GuideWalk,
  answers: GuideAnswers,
  f: TableFacts,
): Record<string, string> {
  const out: Record<string, string> = {}
  // Audit 4 (U3): a group asked for that is no longer among the groups (left out of the data
  // sets the questions are about) takes the initial value, as the select shows it.
  const given = (ask: GuideAsk) => {
    const v = answers[ask.id]
    return ask.kind === 'group' && v !== undefined && !f.groups.some((g) => g.key === v)
      ? undefined
      : v
  }
  for (const t of walk.taken) {
    out[t.question.id] = t.answer
    const a = t.question.answers.find((x) => x.id === t.answer)
    for (const ask of a?.asks ?? []) out[ask.id] = given(ask) ?? ask.initial?.(f) ?? ''
  }
  return out
}

/** A reason with its placeholders filled: `{k}` groups, `{control}` the control's title. */
export function fillReason(text: string, f: TableFacts, answers: GuideAnswers): string {
  const control = f.groups.find((g) => g.key === answers.control)?.title ?? 'the control'
  return text.replaceAll('{k}', String(f.groups.length)).replaceAll('{control}', control)
}

// ---- Every path (tests, Help) --------------------------------------------------------------

export interface GuidePath {
  entry: GuideEntry
  /** The answers along the path, asks filled with their initial values. */
  answers: Record<string, string>
  end: GuideLeaf | GuideElsewhere
}

/**
 * Every path through `entry`'s tree the user could take on a table with these facts: every
 * answer of every question (counting questions too) except those the facts rule out
 * (`unavailable`), each ask filled with its initial value. Tests check every leaf.
 */
export function guidePaths(entry: GuideEntry, facts: TableFacts): GuidePath[] {
  const out: GuidePath[] = []
  const visit = (step: GuideStep, answers: Record<string, string>) => {
    if (step.kind !== 'question') {
      out.push({ entry, answers, end: step })
      return
    }
    for (const a of step.answers) {
      if (a.unavailable?.(facts)) continue
      const next: Record<string, string> = { ...answers, [step.id]: a.id }
      for (const ask of a.asks ?? []) next[ask.id] = ask.initial?.(facts) ?? ''
      visit(a.next, next)
    }
  }
  visit(entry.start, {})
  return out
}

/**
 * The steps of a tree for Help: each question with its answers and what each leads to. When
 * every answer leads to the same step (the answers only set params), they are listed once and
 * that step follows as `follows`, so the outline doesn't repeat a subtree per answer.
 */
export type GuideOutline =
  | {
      kind: 'question'
      text: string
      why: string
      answers: { text: string; next?: GuideOutline }[]
      follows?: GuideOutline
    }
  | { kind: 'leaf'; analysisId: string; reason: string; nextStep?: string }
  | { kind: 'elsewhere'; text: string }

export function guideOutline(step: GuideStep): GuideOutline {
  if (step.kind === 'leaf')
    return {
      kind: 'leaf',
      analysisId: step.analysisId,
      reason: step.reason,
      ...(step.nextStep ? { nextStep: step.nextStep } : {}),
    }
  if (step.kind === 'elsewhere') return { kind: 'elsewhere', text: step.text }
  const first = step.answers[0]?.next
  const shared = step.answers.length > 1 && step.answers.every((a) => a.next === first)
  return {
    kind: 'question',
    text: step.text,
    why: step.why,
    answers: step.answers.map((a) =>
      shared ? { text: a.text } : { text: a.text, next: guideOutline(a.next) },
    ),
    ...(shared && first ? { follows: guideOutline(first) } : {}),
  }
}
