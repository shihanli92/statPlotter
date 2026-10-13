import { type AnalysisDef, type AnalysisRole, valueAt } from '@ps/model'

// Roadmap 51b (design §4.7, U12): the roles of multiple-variables analyses — Outcome, Predictors,
// Factors, Time, Event, Group by — shown as boxes. Roles write the params the analyses already
// read (`y`, `time`, `groups`…) and the analyzed variables (`input.dataSets`, the roles' members
// in role order), so stored analyses keep their shape.

type Params = Record<string, unknown>

const outcome = (label: string, accepts: AnalysisRole['accepts'] = 'number'): AnalysisRole => ({
  id: 'outcome',
  label,
  accepts,
  min: 1,
  max: 1,
  param: ['y'],
})
const predictors: AnalysisRole = {
  id: 'predictors',
  label: 'Predictors',
  accepts: 'any',
  min: 1,
  max: 63,
  help: 'Text variables are categorical; mark number codes as categorical below.',
}

/** Each analysis' roles (absent: a flat list of data sets). */
export const ROLES: Readonly<Record<string, readonly AnalysisRole[]>> = {
  multipleRegression: [outcome('Outcome (Y)'), predictors],
  logisticRegression: [outcome('Outcome (0 = no, 1 = yes)', 'binary'), predictors],
  poissonRegression: [outcome('Outcome (counts)'), predictors],
  coxRegression: [
    { id: 'time', label: 'Time', accepts: 'number', min: 1, max: 1, param: ['time'] },
    {
      id: 'event',
      label: 'Event (1 = event, 0 = censored)',
      accepts: 'binary',
      min: 1,
      max: 1,
      param: ['event'],
    },
    predictors,
  ],
  multifactorAnova: [
    outcome('Outcome (Y)'),
    {
      id: 'factors',
      label: 'Factors',
      accepts: 'any',
      min: 1,
      max: 63,
      help: 'Each level of a factor is a group (number codes count as levels).',
    },
  ],
  survivalFromVariables: [
    { id: 'time', label: 'Time', accepts: 'number', min: 1, max: 1, param: ['time'] },
    {
      id: 'event',
      label: 'Status (event or censored)',
      accepts: 'any',
      min: 1,
      max: 1,
      param: ['status'],
    },
    {
      id: 'groupBy',
      label: 'Group by (a curve for each combination of levels)',
      accepts: 'any',
      min: 0,
      max: 8,
      listParam: ['groups'],
    },
  ],
  pca: [
    {
      id: 'variables',
      label: 'Variables',
      accepts: 'number',
      min: 2,
      max: 255,
      help: 'Continuous number variables; coded (0/1) and text variables are left out unless added.',
    },
    {
      id: 'groupBy',
      label: 'Group by (colours the scores)',
      accepts: 'text',
      min: 0,
      max: 1,
      param: ['groupBy'],
    },
  ],
  nonlinearFitMV: [
    { id: 'x', label: 'X', accepts: 'number', min: 1, max: 1, param: ['x'] },
    { id: 'y', label: 'Y', accepts: 'number', min: 1, max: 1, param: ['y'] },
    {
      id: 'groupBy',
      label: 'Group by (a fit for each level)',
      accepts: 'any',
      min: 0,
      max: 1,
      param: ['group'],
    },
  ],
}

/** The roles of a definition (its own `roles`, else this table's). */
export const rolesOf = (def: Pick<AnalysisDef<unknown>, 'id' | 'roles'>) =>
  def.roles ?? ROLES[def.id]

/** The variables of each role, by role id. */
export type RoleAssignment = Record<string, string[]>

/** A variable of the table as roles see it. */
export interface RoleVariable {
  key: string
  title: string
  /** 'text', 'binary' (only 0 and 1) or 'number'. */
  type: 'number' | 'text' | 'binary'
}

/** Whether a role takes a variable of this type. */
export const accepts = (r: AnalysisRole, v: RoleVariable): boolean =>
  r.accepts === 'any' ||
  r.accepts === v.type ||
  (r.accepts === 'number' && v.type === 'binary') ||
  (r.accepts === 'binary' && v.type === 'number')

/**
 * The roles' members from stored params and data sets (editing, or a selection made elsewhere).
 * Single-variable roles read their param (an empty param: none, unless `fallback`, which takes
 * the variable at the role's position as the analyses do); the role without a param takes the
 * analyzed variables in no other role.
 */
export function assignRoles(
  roles: readonly AnalysisRole[],
  dataSets: readonly string[],
  params: Params,
  fallback: boolean,
): RoleAssignment {
  const out: RoleAssignment = {}
  const taken = new Set<string>()
  for (const r of roles) {
    if (r.param) {
      const v = valueAt(params, r.param)
      const key =
        typeof v === 'string' && v && dataSets.includes(v)
          ? v
          : fallback && r.min > 0
            ? dataSets.filter((k) => !taken.has(k))[0]
            : undefined
      out[r.id] = key && !taken.has(key) ? [key] : []
      for (const k of out[r.id]!) taken.add(k)
    } else if (r.listParam) {
      const v = valueAt(params, r.listParam)
      out[r.id] = (Array.isArray(v) ? (v as string[]) : []).filter(
        (k) => dataSets.includes(k) && !taken.has(k),
      )
      for (const k of out[r.id]!) taken.add(k)
    }
  }
  const rest = roles.find((r) => !r.param && !r.listParam)
  if (rest) out[rest.id] = dataSets.filter((k) => !taken.has(k))
  return out
}

/**
 * The params and analyzed variables the roles write: each single role's param, each list role's
 * param, and the members of every role in role order.
 */
export function applyRoles(
  roles: readonly AnalysisRole[],
  assignment: RoleAssignment,
  params: Params,
): { params: Params; dataSets: string[] } {
  let next = { ...params }
  const set = (path: readonly string[], value: unknown) => {
    const [head, ...rest] = path
    if (!head) return
    if (!rest.length) next = { ...next, [head]: value }
  }
  const dataSets: string[] = []
  for (const r of roles) {
    const members = assignment[r.id] ?? []
    if (r.param) set(r.param, members[0] ?? '')
    if (r.listParam) set(r.listParam, [...members])
    for (const k of members) if (!dataSets.includes(k)) dataSets.push(k)
  }
  return { params: next, dataSets }
}

/** What the roles still need ("Choose the outcome"), or null. */
export function roleProblem(
  roles: readonly AnalysisRole[],
  assignment: RoleAssignment,
): string | null {
  for (const r of roles) {
    const n = assignment[r.id]?.length ?? 0
    if (n < r.min) {
      const name = r.label.replace(/ \(.*\)$/, '').toLowerCase()
      return r.max === 1
        ? `Choose the ${name}.`
        : `Choose at least ${r.min} ${r.min === 1 ? 'variable' : 'variables'} for ${name}.`
    }
  }
  return null
}

/**
 * The roles a new analysis starts with (§4.7): the outcome (and other single roles) empty; the
 * list role with the variables it accepts — PCA's with the continuous ones only (variables coded
 * 0/1 and text variables left out, named in `leftOut`).
 */
export function startingRoles(
  roles: readonly AnalysisRole[],
  variables: readonly RoleVariable[],
): { assignment: RoleAssignment; leftOut: RoleVariable[] } {
  const assignment: RoleAssignment = {}
  let leftOut: RoleVariable[] = []
  for (const r of roles) assignment[r.id] = []
  const rest = roles.find((r) => !r.param && !r.listParam)
  if (rest) {
    const strict = rest.accepts === 'number'
    const fits = variables.filter((v) => (strict ? v.type === 'number' : accepts(rest, v)))
    assignment[rest.id] = fits.map((v) => v.key)
    leftOut = variables.filter((v) => !fits.includes(v))
  }
  return { assignment, leftOut }
}
