import type { AnalysisDef, FormField, ShowIf } from '@ps/model'

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

/** A value as its field shows it (the option's label, a number, Yes / No, a list). */
function shownValue(f: FormField, v: unknown, titles: (k: string) => string): string {
  if ((f.kind === 'radio' || f.kind === 'select') && 'options' in f) {
    const o = f.options.find((x) => x.value === v)
    if (o) return o.label
  }
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'string' && f.kind === 'custom') return v ? titles(v) : '—'
  if (Array.isArray(v)) return v.length ? v.map((x) => titles(String(x))).join(', ') : 'none'
  if (v === undefined || v === null) return '—'
  return typeof v === 'object' ? JSON.stringify(v) : String(v)
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
  const removed = before.dataSets.filter((k) => !after.dataSets.includes(k))
  const added = after.dataSets.filter((k) => !before.dataSets.includes(k))
  if (removed.length || added.length)
    out.push(
      `Data sets: ${[
        ...(removed.length ? [`removed ${removed.map(titles).join(', ')}`] : []),
        ...(added.length ? [`added ${added.map(titles).join(', ')}`] : []),
      ].join('; ')}`,
    )
  else if (before.dataSets.join('|') !== after.dataSets.join('|'))
    out.push(`Data sets: reordered (${after.dataSets.map(titles).join(', ')})`)
  return out
}
