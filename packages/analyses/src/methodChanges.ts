import type { AnalysisDef, FormField, ShowIf } from '@ps/model'
import { equation, INITIAL_RULES } from '@ps/stats'
import { nameList } from './sketch/words.ts'

// Roadmap 51c (design §7.1): what changed in an analysis' method, in its form's words. A change
// of the analysis, of a field that defines the test (the design, equal SDs, the distribution,
// tails and direction, comparisons and their method, sphericity, the RM method, df, the P
// method, survival's test…) or of the data sets counts; reporting fields (the confidence level,
// effect sizes and extra output, the sign of differences) don't.

/** Fields that only report (their change isn't a change of method). */
const REPORTING = new Set([
  'confidenceLevel',
  'reportFTestVariances',
  'reportEqualSdTests',
  'reportLogP',
  'qqPlot',
  'effectSize',
  'riskEstimates',
  'oddsRatio',
  'differenceAs',
  'band',
  'hougaard',
  'covariance',
  'interpolate',
  'diagnostics',
  'quartiles',
  'ci',
  'cv',
  'geometric',
  'moments',
  'sum',
  'cumulative',
  'survivalCurves',
  'baseline',
  'predictions',
])

/** Whether a field defines the method (its change is recorded). */
export const isMethodField = (f: FormField): boolean => !REPORTING.has(f.path[0]!)

const at = (o: unknown, path: readonly string[]): unknown => {
  let v = o
  for (const k of path) v = (v as Record<string, unknown> | undefined)?.[k]
  return v
}

const shown = (f: FormField, p: unknown) =>
  [f.showIf ?? []].flat().every((c: ShowIf) => c.in.includes(at(p, c.path)))

/** At most `n` characters (whole ones), ending "…" when cut. */
const clip = (s: string, n: number) => {
  const chars = [...s]
  return chars.length > n ? `${chars.slice(0, n - 1).join('')}…` : s
}

/** The schema's limit on a history line (`MethodChange.changes`), and on their number. */
const MAX_LINE = 500
const MAX_LINES = 100
/** Names in a line before the rest are counted ("and 31 more"), and each name's length. */
const MAX_NAMES = 6
const MAX_NAME = 60

const entries = (v: unknown): [string, unknown][] =>
  v && typeof v === 'object' && !Array.isArray(v) ? Object.entries(v) : []

/** A model's name ("User-defined equation" for one's own; the id when unknown). */
const modelName = (v: unknown) =>
  v === 'user'
    ? 'User-defined equation'
    : v === 'none' || v === undefined || v === ''
      ? 'none'
      : (equation(String(v))?.name ?? clip(String(v), MAX_NAME))

const RULES = new Map(INITIAL_RULES.map((r) => [r.id, r.label]))

/** Parts of a value in a list ("Bottom = 0 (constant) and HillSlope shared"), or `none`. */
const listed = (parts: string[], none: string) => (parts.length ? nameList(parts, MAX_NAMES) : none)

/**
 * Audit 4 (U9): the curve fit's own fields in words — the model's name, "Bottom = 0
 * (constant)", "Top starts at 100", "LogEC50 between -9 and -3" — never ids or JSON.
 */
const COMPONENT_VALUES: Record<string, (v: unknown) => string> = {
  'nlfit.equation': modelName,
  'nlfit.compare': modelName,
  'nlfit.userEquation': (v) =>
    typeof v === 'string' && v.trim() ? `“${clip(v.trim().replace(/\s+/g, ' '), 80)}”` : '—',
  'nlfit.constraints': (v) =>
    listed(
      entries(v).flatMap(([name, c]) => {
        const { kind, value } = (c ?? {}) as { kind?: string; value?: number }
        if (kind === 'constant') return [`${name} = ${value} (constant)`]
        if (kind === 'shared') return [`${name} shared`]
        if (kind === 'dataSetConstant') return [`${name} = each data set’s title`]
        if (kind === 'meanX') return [`${name} = each data set’s mean X`]
        return []
      }),
      'all fitted',
    ),
  'nlfit.initialValues': (v) =>
    listed(
      entries(v).map(([name, x]) => `${name} starts at ${x}`),
      'automatic',
    ),
  'nlfit.initialRules': (v) =>
    listed(
      entries(v).map(([name, r]) => {
        const { value, rule } = (r ?? {}) as { value?: number; rule?: string }
        return !rule || rule === 'value'
          ? `${name} starts at ${value}`
          : `${name} starts at ${value} ${RULES.get(rule) ?? rule}`
      }),
      'none',
    ),
  'nlfit.limits': (v) =>
    listed(
      entries(v).flatMap(([name, l]) => {
        const { min, max } = (l ?? {}) as { min?: number; max?: number }
        if (min !== undefined && max !== undefined) return [`${name} between ${min} and ${max}`]
        if (min !== undefined) return [`${name} > ${min}`]
        if (max !== undefined) return [`${name} < ${max}`]
        return []
      }),
      'none',
    ),
  'nlfit.equationByDataSet': (v) => {
    const n = entries(v).length
    return n
      ? `${n} data set${n === 1 ? '' : 's'} with a model of ${n === 1 ? 'its' : 'their'} own`
      : 'none'
  },
}

/** A value as its field shows it (the option's label, a number, Yes / No, a list). */
function shownValue(f: FormField, v: unknown, titles: (k: string) => string): string {
  if ((f.kind === 'radio' || f.kind === 'select') && 'options' in f) {
    const o = f.options.find((x) => x.value === v)
    if (o) return o.label
  }
  const own = f.kind === 'custom' ? COMPONENT_VALUES[f.component] : undefined
  if (own) return own(v)
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'string' && f.kind === 'custom') return v ? clip(titles(v), MAX_NAME) : '—'
  if (Array.isArray(v))
    return listed(
      v.map((x) => clip(titles(String(x)), MAX_NAME)),
      'none',
    )
  if (v === undefined || v === null) return '—'
  return typeof v === 'object' ? clip(JSON.stringify(v), 120) : String(v)
}

export interface MethodState {
  def: AnalysisDef<unknown>
  params: unknown
  dataSets: readonly string[]
}

/**
 * The changes from `before` to `after`, one line each ("P value: Two-tailed → One-tailed",
 * "Data sets: removed Mouse 3"); none when the method is the same. Fields are compared where
 * either state shows them; `titles` names a data set key.
 */
export function methodChanges(
  before: MethodState,
  after: MethodState,
  titles: (key: string) => string = (k) => k,
): string[] {
  const out: string[] = []
  if (before.def.id !== after.def.id) out.push(`Analysis: ${before.def.title} → ${after.def.title}`)
  else {
    const seen = new Set<string>()
    for (const f of after.def.form) {
      const key = f.path.join('.')
      if (seen.has(key) || !isMethodField(f)) continue
      if (!shown(f, before.params) && !shown(f, after.params)) continue
      const a = at(before.params, f.path)
      const b = at(after.params, f.path)
      if (JSON.stringify(a) === JSON.stringify(b)) continue
      seen.add(key)
      const label = f.label.replace(/[?:]$/, '')
      out.push(`${label}: ${shownValue(f, a, titles)} → ${shownValue(f, b, titles)}`)
    }
  }
  // Audit 4 (G2): lists bounded ("and 31 more"), names and lines cut to the history's limits
  // (a longer line made the store refuse the whole change).
  const names = (keys: readonly string[]) =>
    listed(
      keys.map((k) => clip(titles(k), MAX_NAME)),
      'none',
    )
  const removed = before.dataSets.filter((k) => !after.dataSets.includes(k))
  const added = after.dataSets.filter((k) => !before.dataSets.includes(k))
  if (removed.length || added.length)
    out.push(
      `Data sets: ${[
        ...(removed.length ? [`removed ${names(removed)}`] : []),
        ...(added.length ? [`added ${names(added)}`] : []),
      ].join('; ')}`,
    )
  else if (before.dataSets.join('|') !== after.dataSets.join('|'))
    out.push(`Data sets: reordered (${names(after.dataSets)})`)
  return out.slice(0, MAX_LINES).map((l) => clip(l, MAX_LINE))
}
