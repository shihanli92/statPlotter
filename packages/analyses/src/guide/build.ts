import type {
  GuideAlternative,
  GuideAnswer,
  GuideAnswers,
  GuideElsewhere,
  GuideLeaf,
  GuideQuestion,
  GuideStep,
  TableFacts,
  TableKind,
} from '@ps/model'

// Roadmap 51a: small builders the trees are written with.

export type Params = (f: TableFacts, a: GuideAnswers) => Record<string, unknown>

export const question = (
  id: string,
  text: string,
  why: string,
  answers: readonly GuideAnswer[],
  extra: Pick<GuideQuestion, 'hint' | 'answeredBy'> = {},
): GuideQuestion => ({ kind: 'question', id, text, why, answers, ...extra })

export const answer = (
  id: string,
  text: string,
  next: GuideStep,
  extra: Omit<GuideAnswer, 'id' | 'text' | 'next'> = {},
): GuideAnswer => ({ id, text, next, ...extra })

export const leaf = (
  analysisId: string,
  params: Params,
  reason: string,
  alternatives: readonly GuideAlternative[] = [],
  nextStep?: string,
): GuideLeaf => ({
  kind: 'leaf',
  analysisId,
  params,
  reason,
  alternatives,
  ...(nextStep ? { nextStep } : {}),
})

export const alt = (analysisId: string, params: Params, when: string): GuideAlternative => ({
  analysisId,
  params,
  when,
})

export const elsewhere = (
  needs: TableKind | null,
  text: string,
  action: GuideElsewhere['action'] = needs ? 'newTable' : 'none',
): GuideElsewhere => ({ kind: 'elsewhere', needs, text, action })

/** Fixed params, whatever the answers. */
export const fixed =
  (p: Record<string, unknown>): Params =>
  () =>
    p

/** A hint when raw values are needed. */
export const needsRaw = (f: TableFacts) => (f.raw ? null : 'Needs the raw values, not mean/SD/N.')

/** Mean values per group. */
export const meanN = (f: TableFacts) =>
  f.groups.length ? f.groups.reduce((s, g) => s + g.n, 0) / f.groups.length : 0

/** A hint naming the groups' sizes (design facts, not a test of the data). */
export const sizesHint = (f: TableFacts) =>
  f.groups.length > 1 ? `Group sizes: ${f.groups.map((g) => g.n).join(', ')}.` : null

/** A hint when every chosen group has a value in every row (pairing is possible). */
export const pairingHint = (f: TableFacts) =>
  f.raw &&
  f.groups.length > 1 &&
  f.completeRows > 1 &&
  f.groups.every((g) => g.n === f.completeRows)
    ? 'Every row has a value in each group: matching is possible (the design decides).'
    : null

/** A hint about what the values look like (information only). */
export const valuesHint = (f: TableFacts) =>
  f.wholeNumbers && f.distinctValues > 0 && f.distinctValues <= 7
    ? `The values are ${f.distinctValues} different whole numbers: they look like scores.`
    : f.allPositive && f.spanRatio >= 100
      ? `The values span ${Math.floor(Math.log10(f.spanRatio))} orders of magnitude: they may change by a factor.`
      : null
