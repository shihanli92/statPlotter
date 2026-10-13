import {
  type AnalysisFacts,
  type Condition,
  type FieldTier,
  type FormField,
  type ShowIf,
  type Unavailable,
  valueAt,
} from '@ps/model'

// Roadmap 51b (design §4.4): which fields and options of a form apply, given the params and the
// facts of the chosen data — hidden when a field never applies to this table, greyed with the
// reason when another choice excludes it. One evaluator for the dialog and the tests.

type Params = Record<string, unknown>

/** Whether a condition holds for these params and facts. */
export function holds(c: Condition, params: Params, facts: AnalysisFacts): boolean {
  if ('anyOf' in c) return c.anyOf.some((x) => holds(x, params, facts))
  if ('path' in c) return c.in.includes(valueAt(params, c.path))
  if ('is' in c) return facts[c.fact] === c.is
  const v = facts[c.fact]
  return (c.atLeast === undefined || v >= c.atLeast) && (c.atMost === undefined || v <= c.atMost)
}

const all = (cs: readonly Condition[] | undefined, params: Params, facts: AnalysisFacts) =>
  (cs ?? []).every((c) => holds(c, params, facts))

/** The reason a choice is unavailable now (the first whose conditions all hold), or null. */
export function unavailableReason(
  u: readonly Unavailable[] | undefined,
  params: Params,
  facts: AnalysisFacts,
): string | null {
  for (const x of u ?? []) if (all(x.when, params, facts)) return x.reason
  return null
}

/** The `showIf` conditions of a field as a list. */
export const showIfList = (f: Pick<FormField, 'showIf'>): readonly ShowIf[] =>
  f.showIf ? (Array.isArray(f.showIf) ? (f.showIf as ShowIf[]) : [f.showIf as ShowIf]) : []

/** What the dialog shows of one field. */
export interface FieldState {
  field: FormField
  /** Shown: its `showIf` and `appliesTo` hold. */
  shown: boolean
  tier: FieldTier
  /** The whole field greyed with this reason (its stored value kept), or null. */
  unavailable: string | null
  /** Options greyed now, by value (as a string), with the reason. */
  options: ReadonlyMap<string, string>
  /**
   * The value chosen is greyed: Analyze is disabled until it is changed (never switched
   * silently). Null when the value is available.
   */
  problem: string | null
}

/** The state of every field of a form, in order. */
export function fieldStates(
  form: readonly FormField[],
  params: Params,
  facts: AnalysisFacts,
): FieldState[] {
  return form.map((f) => {
    const shown =
      showIfList(f).every((c) => holds(c, params, facts)) && all(f.appliesTo, params, facts)
    const u = f.unavailableIf
    const legacy =
      u && facts[u.fact] && (u.when ?? []).every((c) => holds(c, params, facts)) ? u.reason : null
    const unavailable = legacy ?? unavailableReason(f.unavailable, params, facts)
    const options = new Map<string, string>()
    if ('options' in f)
      for (const o of f.options) {
        const r = unavailableReason(o.unavailable, params, facts)
        if (r) options.set(String(o.value), r)
      }
    const current = valueAt(params, f.path)
    const chosen = 'options' in f ? options.get(String(current)) : undefined
    return {
      field: f,
      shown,
      tier: f.tier ?? 'essentials',
      unavailable,
      options,
      problem: shown && !unavailable && chosen ? chosen : null,
    }
  })
}

/**
 * The choices to change before Analyze (§4.4): a shown field whose chosen option is greyed, as
 * "{label}: {reason}".
 */
export function formProblems(
  form: readonly FormField[],
  params: Params,
  facts: AnalysisFacts,
): { label: string; path: readonly string[]; reason: string }[] {
  return fieldStates(form, params, facts).flatMap((s) =>
    s.problem ? [{ label: s.field.label, path: s.field.path, reason: s.problem }] : [],
  )
}
