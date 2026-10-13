import type {
  GuideAnswers,
  GuideEntry,
  SchematicDesign,
  SchematicSpec,
  TableFacts,
} from '@ps/model'
import { walkAnswers, walkGuide } from '../guide/index.ts'
import { designOfParams, mergeDesign } from './design.ts'
import { type SchematicNames, schematicSpec } from './spec.ts'

// Roadmap 51f: "What will be tested" (docs/design/ANALYSIS_GUIDE.md §12) — the schematic of the
// question, built up as Guide me's questions are answered (each answer's `draws`, then the
// recommendation's params), or from the params of the method chosen in the dialog. Words and
// structure only: never the data's values, never a test (an import boundary test checks this
// folder).

export { CORRECTION_WORDS, designOfParams, mergeDesign, SCHEMATIC_ANALYSES } from './design.ts'
export { type SchematicNames, type SchematicOptions, schematicSpec } from './spec.ts'

/** The design Guide me's answers give so far (with the recommendation's params once reached). */
export function guideDesign(
  entry: GuideEntry,
  facts: TableFacts,
  answers: GuideAnswers,
): SchematicDesign {
  const walk = walkGuide(entry, facts, answers)
  const all = { ...answers, ...walkAnswers(walk, answers, facts) }
  let d: SchematicDesign = { ...(entry.draws ?? {}) }
  for (const t of walk.taken) {
    const a = t.question.answers.find((x) => x.id === t.answer)
    if (a?.draws) d = mergeDesign(d, a.draws)
  }
  // The values the answers asked for: the control, the set value, the outcome variable.
  if (all.control) d = { ...d, control: all.control }
  if (all.hypothetical !== undefined && all.hypothetical !== '') {
    const v = Number(all.hypothetical)
    if (Number.isFinite(v)) d = { ...d, hypothetical: v }
  }
  // A variables table's outcome (a 2 × 2's "outcome" is a column, set by its answer's draws).
  if (facts.variables) {
    if (all.outcome) d = { ...d, outcome: all.outcome }
    else if (all.event) d = { ...d, outcome: all.event }
  }
  if (walk.end?.kind === 'leaf') {
    const p = designOfParams(walk.end.analysisId, walk.end.params(facts, all))
    if (p) d = mergeDesign(d, p)
    // A question that is a recommendation by itself keeps its own measure ("Median survival in
    // each group" asks for medians, though the survival analysis compares the curves too).
    if (entry.start.kind === 'leaf' && entry.draws?.measure)
      d = { ...d, measure: entry.draws.measure }
  }
  return d
}

/** The schematic of Guide me's question with the answers given so far. */
export function guideSchematic(
  entry: GuideEntry,
  facts: TableFacts,
  answers: GuideAnswers,
  names: SchematicNames = {},
): SchematicSpec {
  const walk = walkGuide(entry, facts, answers)
  const pending = walk.current
    ? `Next: ${walk.current.text}`
    : walk.end?.kind === 'elsewhere'
      ? walk.end.text
      : undefined
  return schematicSpec(guideDesign(entry, facts, answers), facts, names, {
    fallback: entry.question,
    ...(pending ? { pending } : {}),
  })
}

/** The schematic of an analysis with these params (null: it draws none). */
export function analysisSchematic(
  analysisId: string,
  params: Readonly<Record<string, unknown>>,
  facts: TableFacts,
  names: SchematicNames = {},
): SchematicSpec | null {
  const d = designOfParams(analysisId, params)
  return d ? schematicSpec(d, facts, names) : null
}
