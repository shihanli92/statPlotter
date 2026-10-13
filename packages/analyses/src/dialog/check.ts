import type {
  AnalysisDef,
  AnalysisFacts,
  Check,
  NormalizedDataSet,
  RunContext,
  TableKind,
} from '@ps/model'
import { countOf } from '../sketch/words.ts'
import { formProblems } from './conditions.ts'
import { type RoleAssignment, roleProblem, rolesOf } from './roles.ts'

// Roadmap 51b (design §4.6, U16): the checks the Analyze dialog shows before Analyze — the number
// of groups chosen, the roles, a choice greyed by another, the analysis' own `validate` (the one
// `run` returns as its failure) and descriptive notes about the data. Counts and shapes only:
// never a test's P.

type Params = Record<string, unknown>

/** What the chosen data sets are called on a table of this kind. */
export function setsWord(kind: TableKind, n: number): string {
  const one =
    kind === 'multipleVariables'
      ? 'variable'
      : kind === 'column' || kind === 'nested' || kind === 'survival'
        ? 'group'
        : 'data set'
  return n === 1 ? one : `${one}s`
}

/** The block about how many data sets are chosen, or null when the number fits. */
export function countCheck(
  def: Pick<AnalysisDef<unknown>, 'inputs'>,
  kind: TableKind,
  chosen: number,
): Check | null {
  const { min, max } = def.inputs
  if (chosen >= min && chosen <= max) return null
  const want =
    min === max
      ? `${min} ${setsWord(kind, min)}`
      : chosen < min
        ? `at least ${min} ${setsWord(kind, min)}`
        : `at most ${max} ${setsWord(kind, max)}`
  return { level: 'block', message: `Choose ${want} (${chosen} chosen).`, where: 'params' }
}

/** Notes on the groups' sizes (column and nested tables): equal, or which differ. */
export function sizeNotes(kind: TableKind, input: readonly NormalizedDataSet[]): Check[] {
  if (kind !== 'column' || input.length < 2 || input.some((d) => d.text)) return []
  const counts = input.map(countOf)
  if (counts.every((c) => c === counts[0]))
    return [{ level: 'ok', message: `${counts[0]} values in each group.` }]
  const most = Math.max(...counts)
  const fewer = input.filter((_, i) => counts[i]! < most)
  if (fewer.length > 3)
    return [{ level: 'note', message: `The groups have ${Math.min(...counts)} to ${most} values.` }]
  return fewer.map((d) => ({
    level: 'note' as const,
    message: `“${d.title || 'untitled'}” has ${countOf(d)} values; the most is ${most}.`,
  }))
}

/** Everything the dialog checks, in order: blocks first (the first is Analyze's reason). */
export function analysisChecks(args: {
  def: AnalysisDef<unknown>
  kind: TableKind
  input: readonly NormalizedDataSet[]
  params: Params
  facts: AnalysisFacts
  /** The roles' members (multiple-variables analyses with roles). */
  roles?: RoleAssignment
  context?: RunContext
}): Check[] {
  const { def, kind, input, params, facts } = args
  const out: Check[] = []
  const usesData = def.usesData?.(params) ?? true
  const roles = rolesOf(def)
  if (usesData && roles && args.roles) {
    const problem = roleProblem(roles, args.roles)
    if (problem) out.push({ level: 'block', message: problem, where: 'params' })
  }
  if (usesData && !out.length) {
    const count = countCheck(def, kind, input.length)
    if (count) out.push(count)
  }
  for (const p of formProblems(def.form, params, facts))
    out.push({ level: 'block', message: `${p.label}: ${p.reason}`, where: 'params' })
  const parsed = def.params.safeParse(params)
  if (!parsed.success) {
    out.push({
      level: 'block',
      message: `Invalid options: ${parsed.error.issues[0]?.message ?? 'check them'}.`,
      where: 'params',
    })
    return out
  }
  if (usesData && !out.some((c) => c.level === 'block')) {
    const problem = def.validate?.(input, parsed.data, args.context)
    if (problem) out.push({ level: 'block', message: problem.message, where: problem.where })
  }
  if (usesData) {
    out.push(...sizeNotes(kind, input))
    out.push(...(def.check?.(input, parsed.data, args.context) ?? []))
  }
  return [...out.filter((c) => c.level === 'block'), ...out.filter((c) => c.level !== 'block')]
}
