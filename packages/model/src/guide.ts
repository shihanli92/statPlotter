import type { SchematicDesign } from './schematic.ts'
import type { TableKind } from './table.ts'

// Roadmap 51a: the guided chooser's trees as data (docs/design/ANALYSIS_GUIDE.md §3). Code, not
// document data: the trees live in @ps/analyses (`analyses/src/guide/`), the Analyze dialog's
// Guide me tab walks them, Help › Choosing an analysis is generated from them. A tree reads only
// the table's shape (`TableFacts`), never a result: it can't choose a test from a pre-test.

/**
 * What the chooser may know about the table analyzed: its shape, nothing inferential. Counting
 * questions (how many groups, raw values or mean/SD/N, 2 × 2 or larger) may be answered from it;
 * design questions (matched? scores or measurements? can scatter differ?) are always asked, the
 * facts adding at most a hint.
 */
export interface TableFacts {
  kind: TableKind
  /** The data sets chosen (in table order): key, title and number of values each. */
  groups: readonly { key: string; title: string; n: number }[]
  /** Every chosen data set holds raw values (not mean/SD/N). */
  raw: boolean
  /** Rows with a value in every chosen data set (pairing is possible when it equals the n's). */
  completeRows: number
  /** Every value is above zero (ratios and logarithms are possible). */
  allPositive: boolean
  /** The largest positive value over the smallest (0 when there are none). */
  spanRatio: number
  /** Every value is a whole number ≥ 0. */
  wholeNumbers: boolean
  /** Distinct values over the chosen data sets (few, ≤ 7, suggests scores). */
  distinctValues: number
  /** Subcolumns per cell (grouped, XY and nested tables' replicates; 1 otherwise). */
  replicates: number
  rows: number
  /** The row titles that are numbers, in order (a grouped table's rows that look like time). */
  numericRowTitles: number
  x?: { min: number; max: number; looksLog: boolean; looksConcentration: boolean; hasZero: boolean }
  contingency?: { rows: number; columns: number; minExpected: number }
  survival?: { codes: readonly number[] }
  /** Multiple-variables tables: the variables chosen, by type (0/1 codes are `binary`). */
  variables?: {
    numbers: readonly { key: string; title: string }[]
    texts: readonly { key: string; title: string }[]
    binary: readonly { key: string; title: string }[]
  }
}

/** The answers given, by question id (answer ids, or a picked group key / typed number). */
export type GuideAnswers = Readonly<Record<string, string>>

/** A question the user can ask of a table of the kinds listed (the chooser's rail). */
export interface GuideEntry {
  id: string
  /** "Are the groups different?" */
  question: string
  /** Where it is offered; on other kinds it is listed under "Not here?". */
  kinds: readonly TableKind[]
  /** Search words: "compare groups", "anova", "significant difference". */
  keywords: readonly string[]
  start: GuideStep
  /**
   * Roadmap 51f: what the question says about the design before any answer ("What will be
   * tested": a grid of cells, the means compared…).
   */
  draws?: SchematicDesign
}

export type GuideStep = GuideQuestion | GuideLeaf | GuideElsewhere

export interface GuideAnswer {
  id: string
  text: string
  /** One line under the answer. */
  explain?: string
  /** Why this answer can't apply to this table (greyed with the reason); null when it can. */
  unavailable?: (f: TableFacts) => string | null
  /**
   * Values this answer needs, recorded under their ids: a group (the control; on a variables
   * table, a variable such as the outcome) or a number (the hypothetical value).
   */
  asks?: readonly GuideAsk[]
  /**
   * Roadmap 51f: what this answer says about the design ("What will be tested"): the same
   * subjects, the means or the ranks, every pair… Data, merged in the order answered.
   */
  draws?: SchematicDesign
  next: GuideStep
}

export interface GuideAsk {
  id: string
  kind: 'group' | 'number'
  label: string
  /** The value offered first (a group's key, a number as text). */
  initial?: (f: TableFacts) => string
}

export interface GuideQuestion {
  kind: 'question'
  /** Answers are recorded under this id. */
  id: string
  /** "Were the same animals or samples measured in every group?" */
  text: string
  /** Why it is asked, one line. */
  why: string
  /** Information from the table's shape, never a preselected answer to a design question. */
  hint?: (f: TableFacts) => string | null
  /** Counting questions only: the answer the facts give (shown as a fact), else null to ask. */
  answeredBy?: (f: TableFacts) => string | null
  answers: readonly GuideAnswer[]
}

/** An alternative to a recommendation, with when to choose it. */
export interface GuideAlternative {
  analysisId: string
  params: (f: TableFacts, a: GuideAnswers) => Record<string, unknown>
  /** "the values are scores or ranks" (≤ 160 characters). */
  when: string
}

export interface GuideLeaf {
  kind: 'leaf'
  analysisId: string
  /** Parsed by the analysis' own params schema (every leaf is tested to parse and run). */
  params: (f: TableFacts, a: GuideAnswers) => Record<string, unknown>
  /** The reason written for these answers (≤ 200 characters; `{k}`, `{control}` filled in). */
  reason: string
  /** At most two. */
  alternatives: readonly GuideAlternative[]
  /** A next step, when this analysis prepares another (Transform, then a t test of its result). */
  nextStep?: string
}

/** A question this table can't answer: what it needs and what the button does. */
export interface GuideElsewhere {
  kind: 'elsewhere'
  /** The table kind that answers it (null: not available yet). */
  needs: TableKind | null
  /** "Curve fits need an XY table (X = concentration)." */
  text: string
  /** 'newTable': the New table dialog at `needs`; 'none': nothing to do here. */
  action: 'newTable' | 'none'
}
