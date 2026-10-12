import type { AnalysisDef, FieldExplain, FormField, FormOption, OptionExplain } from '@ps/model'
import { COLUMN_TEXT } from './forms/column.ts'
import { GROUPED_TEXT } from './forms/grouped.ts'
import { OTHER_TEXT } from './forms/other.ts'
import { SHARED_TEXT } from './forms/shared.ts'
import { TOOL_TEXT } from './forms/tools.ts'
import type { FieldText, FormText, OptionText } from './forms/types.ts'
import { XY_TEXT } from './forms/xy.ts'
import { CARDS_OF, COMPARISON_CARD, METHOD_FIELDS } from './methods.ts'

// Roadmap 51a: the explanations (docs/design/ANALYSIS_GUIDE.md §2): method cards, and the text of
// every field and option, written by family in `forms/*.ts` and attached to the definitions'
// forms when the registry is built (decision 1277). One source for the dialog, the results'
// How to read this, the chooser and Help.

export { CARD_FAMILIES, METHOD_CARDS, methodCard } from './cards/index.ts'
export { CARDS_OF } from './methods.ts'

/** Every analysis' form text by analysis id. */
export const FORM_TEXT: Readonly<Record<string, FormText>> = {
  ...COLUMN_TEXT,
  ...GROUPED_TEXT,
  ...XY_TEXT,
  ...OTHER_TEXT,
  ...TOOL_TEXT,
}

const optionExplain = (t: OptionText): OptionExplain => {
  if (typeof t === 'string') return { line: t }
  const { recommended, notRecommended, ...rest } = t
  return {
    ...rest,
    ...(recommended ? { tag: { kind: 'recommended' as const, why: recommended } } : {}),
    ...(notRecommended ? { tag: { kind: 'notRecommended' as const, why: notRecommended } } : {}),
  }
}

/** The text of one field of `analysisId`: its own, else the shared text of its path. */
export function fieldText(analysisId: string, path: readonly string[]): FieldText | undefined {
  const key = path.join('.')
  const own = FORM_TEXT[analysisId]?.[key]
  const shared = SHARED_TEXT[key]
  if (!own) return shared
  if (!shared) return own
  return {
    ...shared,
    ...own,
    options: { ...(shared.options ?? {}), ...(own.options ?? {}) },
  }
}

/** A form with its text attached (fields without text are left as they are). */
export function explainedForm(analysisId: string, form: readonly FormField[]): FormField[] {
  return form.map((f): FormField => {
    const t = fieldText(analysisId, f.path)
    if (!t) return f
    const explain: FieldExplain = { line: t.line, ...(t.card ? { card: t.card } : {}) }
    if (f.kind !== 'select' && f.kind !== 'radio') return { ...f, explain }
    const methods = METHOD_FIELDS.has(f.path.join('.'))
    const options = f.options.map((o): FormOption => {
      const ot = t.options?.[String(o.value)]
      if (!ot) return o
      const e = optionExplain(ot)
      const method = e.method ?? (methods ? COMPARISON_CARD[String(o.value)] : undefined)
      return { ...o, explain: { ...e, ...(method ? { method } : {}) } }
    })
    return { ...f, explain, options }
  })
}

/**
 * Attaches the text and the `cards` of every definition (in place: the registry's definitions
 * are the ones every package uses).
 */
export function attachExplanations(defs: readonly AnalysisDef<unknown>[]): void {
  for (const d of defs) {
    d.form = explainedForm(d.id, d.form)
    const cards = CARDS_OF[d.id]
    if (cards) d.cards = cards as AnalysisDef<unknown>['cards']
  }
}

/**
 * A card's text with the user's names: `{A}` and `{B}` the first and second data sets, `{control}`
 * the control (absent: the words "the first group", "the second group", "the control").
 */
export function withNames(
  text: string,
  names: { A?: string; B?: string; control?: string } = {},
): string {
  return text
    .replaceAll('{A}', names.A ? `“${names.A}”` : 'the first group')
    .replaceAll('{B}', names.B ? `“${names.B}”` : 'the second group')
    .replaceAll('{control}', names.control ? `“${names.control}”` : 'the control')
}
