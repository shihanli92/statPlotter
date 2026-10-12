import type { OptionExplain } from '@ps/model'

// Roadmap 51a: the forms' text, written per analysis in `forms/*.ts` and attached to each
// definition's form at registration (`attachExplanations`), as the ready results on graphs are
// (`graphResults.ts`). An option's text is its line, or the full explanation; `recommended` /
// `notRecommended` give the reason for a tag in its label.

export type OptionText =
  | string
  | (Omit<OptionExplain, 'tag'> & { recommended?: string; notRecommended?: string })

export interface FieldText {
  line: string
  card?: string
  /** By the option's value (`String(value)`: 'true', '0.95', 'tukey'). */
  options?: Readonly<Record<string, OptionText>>
}

/** A form's text by field path (`path.join('.')`). */
export type FormText = Readonly<Record<string, FieldText>>
