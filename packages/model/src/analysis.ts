import { z } from 'zod'
import { type PointLabels, RowIndices } from './graph.ts'
import { DataSetKey, DataSetRef, NodeId } from './ids.ts'
import type { NormalizedDataSet } from './normalize.ts'
import type { ResultTemplate } from './results.ts'
import { DataTable, type TableKind } from './table.ts'

export const AnalysisNode = z.object({
  kind: z.literal('analysis'),
  id: NodeId,
  name: z.string(),
  /** Plugin id, e.g. 'ttest', 'mannWhitney'. */
  analysisId: z.string().min(1),
  /** Version of the plugin's params schema this node was saved with. */
  pluginVersion: z.number().int().min(1),
  /** One source node (a table or another analysis) and the data sets selected from it. */
  input: z.object({
    source: NodeId,
    dataSets: z.array(DataSetKey),
    /**
     * Roadmap 35: only the values at this X of a table with X values (each data set's replicates
     * at the rows whose X is this), analyzed as a column table's data sets: a comparison at one
     * time point. Absent: every row.
     */
    atX: z.number().optional(),
    /**
     * Roadmap 35: data sets pooled into one before the analysis (a group of controls against one
     * patient): each pool's values together under its first data set's key, titled "A + B + C".
     */
    pools: z.array(z.array(DataSetKey).min(2).max(64)).max(32).optional(),
    /**
     * Roadmap 51c (§7.3): an XY table's data sets read as a grouped table's columns, each X value
     * a row (in order of first appearance, titled by the value) and the replicates at that X the
     * cell's values: a two-way ANOVA with comparisons at each X. Absent: as the table is.
     */
    byX: z.literal(true).optional(),
  }),
  /** Validated by the plugin's own schema, not here. */
  params: z.unknown(),
  /** Free text about the analysis (roadmap 31), edited above its results; absent = none. */
  notes: z.string().optional(),
  /**
   * Roadmap 51a: how the analysis was set up. `guide`: from the guided chooser (Guide me) — the
   * question's entry id, the answers by question id, and whether Analyze ran the recommended
   * method unchanged (`followed`) or the options were changed after "Use this". Absent: made by
   * hand (the list, a menu, a bracket…). Information only: it never changes what is computed.
   */
  origin: z
    .object({
      guide: z
        .object({
          entry: z.string(),
          answers: z.record(z.string(), z.string()),
          followed: z.boolean(),
        })
        .optional(),
      /**
       * Roadmap 51c (§7.3): made by a bracket on a graph (one test of two groups, not corrected
       * for the graph's other brackets).
       */
      bracket: z.literal(true).optional(),
    })
    .optional(),
  /**
   * Roadmap 51c (§7.1): the method's changes, oldest first: what it was before each change, what
   * changed (in the form's words), whether results had been seen, and the reason given. At most
   * 50 are kept; `historyEarlier` counts the older ones dropped. Absent: never changed.
   */
  history: z
    .array(z.lazy(() => MethodChange))
    .max(50)
    .optional(),
  historyEarlier: z.number().int().min(1).optional(),
  /**
   * Roadmap 51d (U23): the name was made from the method and groups (`AnalysisDef.methodName`)
   * and follows them when they change; renaming by hand clears it. Absent: the name is the
   * user's (every analysis made before 0.3.11).
   */
  autoName: z.literal(true).optional(),
})
export type AnalysisNode = z.infer<typeof AnalysisNode>

/** Roadmap 51c (§7.1): one change of an analysis' method. */
export const MethodChange = z.object({
  /** When (ISO date-time). */
  at: z.string(),
  /** The method before the change. */
  from: z.object({
    analysisId: z.string().min(1),
    pluginVersion: z.number().int().min(1),
    params: z.unknown(),
    dataSets: z.array(DataSetKey),
  }),
  /** What changed, in the form's words ("P value: Two-tailed → One-tailed"). */
  changes: z.array(z.string().max(500)).max(100),
  /** The analysis had results (seen) when it was changed. */
  afterResults: z.boolean(),
  /** Why, as typed in the notice (optional). */
  reason: z.string().max(500).optional(),
})
export type MethodChange = z.infer<typeof MethodChange>

/** Method changes kept in a node (older ones are counted, `historyEarlier`). */
export const MAX_METHOD_HISTORY = 50

// ---------------------------------------------------------------------------------------------
// Results. Derived data: never part of the undoable document, persisted only as a cache.
// Results may legitimately contain NaN / ±Infinity (e.g. an unbounded CI), so these schemas
// accept any JS number; the file serializer encodes non-finite values.
// ---------------------------------------------------------------------------------------------

const AnyNumber = z.custom<number>((v) => typeof v === 'number')

export const ResultValue = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('number'), v: AnyNumber, digits: z.number().int().optional() }),
  z.object({ kind: z.literal('integer'), v: AnyNumber }),
  z.object({ kind: z.literal('pvalue'), v: AnyNumber }),
  z.object({ kind: z.literal('pSummary'), v: AnyNumber }),
  z.object({ kind: z.literal('interval'), lo: AnyNumber, hi: AnyNumber, level: AnyNumber }),
  z.object({ kind: z.literal('text'), v: z.string() }),
  z.object({ kind: z.literal('bool'), v: z.boolean() }),
])
export type ResultValue = z.infer<typeof ResultValue>

/**
 * Roadmap 51d (design §8.2): a piece of a summary sentence — text, or a value shown as results
 * show it (a P value in the project's P style: `role: 'p'` reads "P = 0.0014" or "P < 0.0001",
 * `role: 'q'` "q = 0.012";
 * an interval with `role: 'ci'` reads "95% CI 4.3 to 18.7"), with the unit of the data after it.
 */
export const SummaryPart = z.union([
  z.string(),
  z.object({
    value: ResultValue,
    role: z.enum(['p', 'q', 'estimate', 'ci']).optional(),
    unit: z.string().optional(),
  }),
])
export type SummaryPart = z.infer<typeof SummaryPart>

/**
 * Roadmap 51d (§8.2): a block's stable key (`blockKey` in references) and whether it is a detail
 * (shown collapsed under Details: the omnibus table, effect sizes, the data analyzed…).
 */
const blockMeta = {
  key: z.string().optional(),
  detail: z.literal(true).optional(),
}

export const ResultBlock = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('keyValue'),
    title: z.string().optional(),
    /** Roadmap 51d: `key` is the row's stable key (`rowKey` in references: 'meanA', 'diff'). */
    rows: z.array(z.object({ label: z.string(), value: ResultValue, key: z.string().optional() })),
    ...blockMeta,
  }),
  z.object({
    type: z.literal('table'),
    title: z.string().optional(),
    columns: z.array(z.string()),
    rows: z.array(z.array(ResultValue)),
    /** Roadmap 51d: stable keys of the columns and rows ('' for one without), by position. */
    columnKeys: z.array(z.string()).optional(),
    rowKeys: z.array(z.string()).optional(),
    /** Roadmap 51d (S23): what the table's P values and CIs refer to (the family, the method). */
    caption: z.string().optional(),
    ...blockMeta,
  }),
  z.object({ type: z.literal('note'), text: z.string(), detail: z.literal(true).optional() }),
  /**
   * Roadmap 51d (§8.2): the answer in a sentence or two, generated from the result's own values
   * in the user's names; first in the results.
   */
  z.object({ type: z.literal('summary'), parts: z.array(SummaryPart) }),
])
export type ResultBlock = z.infer<typeof ResultBlock>

export const ResultSheet = z.object({
  key: z.string(),
  title: z.string(),
  blocks: z.array(ResultBlock),
})
export type ResultSheet = z.infer<typeof ResultSheet>

export const Comparison = z.object({
  /** Stable across recomputes so graph brackets can reference it. */
  key: z.string(),
  a: DataSetRef,
  b: DataSetRef,
  /** Grouped tables: the rows of the two cells compared (absent for whole data sets). */
  rowA: z.number().int().min(0).optional(),
  rowB: z.number().int().min(0).optional(),
  p: AnyNumber,
  pAdjusted: AnyNumber.optional(),
  estimate: z
    .object({ value: AnyNumber, lo: AnyNumber, hi: AnyNumber, label: z.string() })
    .optional(),
})
export type Comparison = z.infer<typeof Comparison>

/**
 * Roadmap 51e (design §9.3): a change of the analysis' params that answers a warning ("Fix Bottom =
 * 0"): each value set at its path, offered as a button opening Edit with it applied.
 */
export const DiagnosticFix = z.object({
  label: z.string(),
  set: z.array(z.object({ path: z.array(z.string()), value: z.unknown() })),
})
export type DiagnosticFix = z.infer<typeof DiagnosticFix>

export const Diagnostic = z.object({
  level: z.enum(['info', 'warning', 'error']),
  message: z.string(),
  /** Roadmap 51e: what to change, one click away (absent: none). */
  fix: DiagnosticFix.optional(),
})
export type Diagnostic = z.infer<typeof Diagnostic>

/** Graphable output of an analysis (fitted curve, residuals…). Arrays are plain for transport. */
export const GraphableDataSet = z.object({
  title: z.string(),
  x: z.array(AnyNumber),
  y: z.array(AnyNumber),
  lo: z.array(AnyNumber).optional(),
  hi: z.array(AnyNumber).optional(),
  /**
   * The analyzed table's row of each point (e.g. a volcano plot's rows), so points can be
   * labelled by row title, chosen by row and formatted singly (`pointOverrides` under the
   * extra series' id, point key `r<row>`).
   */
  rows: RowIndices.optional(),
  /** Each point's row title (null: none), for point labels. */
  rowTitles: z.array(z.string().nullable()).optional(),
  /**
   * Roadmap 35: the level of the text variable it was fitted to (a fit per group of a table's
   * variables): drawn in that group's colour on graphs colouring their points by the variable.
   */
  group: z.string().optional(),
})
export type GraphableDataSet = z.infer<typeof GraphableDataSet>

export const AnalysisResult = z.object({
  status: z.enum(['ok', 'warning', 'error']),
  diagnostics: z.array(Diagnostic),
  sheets: z.array(ResultSheet),
  /** Machine-readable values under stable keys ('p', 't', 'df', …). */
  values: z.record(z.string(), ResultValue),
  comparisons: z.array(Comparison),
  outputs: z.record(DataSetKey, GraphableDataSet),
  /**
   * The data table this analysis produces (Transform, Normalize, Frequency distribution…), which
   * other analyses and graphs can use as their source. Only from plugins with `producesTable`.
   * Its data set ids must be stable across runs (derived from the input keys and params, never
   * random), so graphs and analyses of it keep their references; its node id is ignored (the
   * table is addressed by the analysis node's id).
   */
  table: DataTable.optional(),
})
export type AnalysisResult = z.infer<typeof AnalysisResult>

// ---------------------------------------------------------------------------------------------
// Plugin contract. Implemented in @ps/analyses; the engine only sees this interface.
// ---------------------------------------------------------------------------------------------

/** Roadmap 51c: facts about the chosen data that make a question not apply (`unavailableIf`). */
export type AnalysisFact = 'missingInMatched'

export interface ShowIf {
  path: readonly string[]
  in: readonly unknown[]
}

// ---------------------------------------------------------------------------------------------
// Roadmap 51b: the Analyze dialog's contract (docs/design/ANALYSIS_GUIDE.md §4, §5). Code, not
// document data: tiers, conditions, checks, roles and the sketch never enter a project file.
// ---------------------------------------------------------------------------------------------

/**
 * Roadmap 51b (§4.4): counts and shapes of the chosen data the dialog reads (`analysisFacts` in
 * @ps/analyses), never a test of the data: whether every value is raw (not mean/SD/N), X values, a 2 × 2
 * table, matched values with gaps; how many groups (number data sets), data sets, values in the
 * fullest cell, rows with data, columns, and factors (multiple-variables ANOVA).
 */
export interface AnalysisFacts {
  raw: boolean
  /** The table has X values (XY and survival tables, results with X). */
  hasX: boolean
  twoByTwo: boolean
  missingInMatched: boolean
  groups: number
  dataSets: number
  maxPerCell: number
  rows: number
  columns: number
  factors: number
  /**
   * Roadmap 51e (§9.4, §4.4 row 22): a curve fit compares models or a parameter between data sets
   * (from the params: what is asked, not the data).
   */
  modelComparison: boolean
  /**
   * Roadmap 51e: the comparison asked for is between nested models (a parameter shared or not,
   * or two built-in models one of which is a special case of the other); false otherwise and for
   * a user-defined equation against anything.
   */
  modelsNested: boolean
}
export type BoolFact =
  | 'raw'
  | 'hasX'
  | 'twoByTwo'
  | 'missingInMatched'
  | 'modelComparison'
  | 'modelsNested'
export type CountFact = 'groups' | 'dataSets' | 'maxPerCell' | 'rows' | 'columns' | 'factors'

/**
 * Roadmap 51b (§4.4): a condition on the params (as `ShowIf`), on a fact about the chosen data,
 * or any of several.
 */
export type Condition =
  | ShowIf
  | { fact: BoolFact; is: boolean }
  | { fact: CountFact; atLeast?: number; atMost?: number }
  | { anyOf: readonly Condition[] }

/** Roadmap 51b: a choice greyed with the reason while all its conditions hold. */
export interface Unavailable {
  when: readonly Condition[]
  reason: string
}

/**
 * Roadmap 51b (§4.2): where a field sits in the dialog's options: Essentials (the design
 * questions, open), Reporting (confidence level, extra output; collapsed with a summary) or
 * Advanced (corrections, df and P methods, one-tailed P; collapsed with a count of changes).
 */
export type FieldTier = 'essentials' | 'reporting' | 'advanced'

/**
 * Roadmap 51b (§4.6): what the dialog says about the chosen data and options before Analyze:
 * ✓ ok, ! a note, ✗ a block (Analyze disabled with it as the reason). `where`: what to change —
 * the options, or the table's values. Never about a test's P.
 */
export interface Check {
  level: 'ok' | 'note' | 'block'
  message: string
  where?: 'params' | 'table'
  /** Roadmap 51e (§4.6, §9.2): one-click fixes offered beside it. */
  fix?: readonly CheckFix[]
}

/**
 * Roadmap 51e: a check's fix — params set at their paths, or an action the dialog performs
 * ('transformLog10X': a Transform analysis of X first, the analysis fit to its result).
 */
export interface CheckFix {
  label: string
  set?: readonly { path: readonly string[]; value: unknown }[]
  action?: 'transformLog10X'
}

/**
 * Roadmap 51b (§4.6): a problem `validate` finds before anything is computed (counts and shapes:
 * values per group, unpaired rows, non-positive values for a ratio, a direction not stated…),
 * returned by `run` as its failure (with `diagnostics`, the notes that come before it) and shown by
 * the dialog as a block — one function, so the two can't disagree.
 */
export interface Problem {
  message: string
  where: 'params' | 'table'
  /** Notes `run`'s failure carries before the error (excluded values…). */
  diagnostics?: Diagnostic[]
}

/**
 * Roadmap 51b (§4.5): the choices analyses share, carried across a change of method: the
 * confidence level, tails, the predicted direction, the control, the comparisons, matching.
 */
export type SharedKey = 'confidence' | 'tails' | 'direction' | 'control' | 'comparisons' | 'design'

/**
 * Where an analysis keeps a shared choice: its path, and (when the analysis words it its own
 * way) how its value reads as the shared one and back (matching: `true` / `false`).
 */
export interface SharedPath {
  path: readonly string[]
  read?: (value: unknown) => unknown
  write?: (shared: unknown) => unknown
}

/**
 * Roadmap 51b (§4.7): a role of a multiple-variables analysis (Outcome, Predictors, Factors, Group
 * by…), shown as a box variables are added to. `param`: where a single variable's key is kept
 * (absent: the role is the analyzed variables not in another role); `listParam`: a list of keys.
 */
export interface AnalysisRole {
  id: 'outcome' | 'predictors' | 'factors' | 'variables' | 'groupBy' | 'time' | 'event' | 'x' | 'y'
  label: string
  accepts: 'number' | 'text' | 'binary' | 'any'
  min: number
  max: number
  param?: readonly string[]
  listParam?: readonly string[]
  /** One line under the box. */
  help?: string
}

/** Roadmap 51b (§5): what an analysis' sketch knows besides the normalized data sets. */
export interface SketchContext {
  tableKind: TableKind
  xTitle: string | null
  /** Rows drawn per group at most (larger tables are sampled by rows, every k-th). */
  maxRows?: number
}

/**
 * Roadmap 51b (§5.1): one small graph of the sketch: a transient table drawn in a native preset
 * (`graph/src/presets.ts`), with brackets (typed labels) and reference lines. Data, never a
 * statistic of a test: no P, CI or fitted parameter.
 */
export interface SketchPanel {
  id: string
  /** Above the panel ("Differences B − A"). */
  title?: string
  table: DataTable
  preset: string
  brackets?: readonly { a: string; b: string; label: string }[]
  /** Reference lines across the plot: at a Y value (default) or an X value. */
  lines?: readonly { at: number; axis?: 'x' | 'y'; label?: string; dashed?: boolean }[]
  /**
   * Roadmap 51e: text at data coordinates (a model thumbnail's parameter names: "Top", "EC50" —
   * names, never values).
   */
  labels?: readonly { x: number; y: number; text: string }[]
  /**
   * `xLog`: a log10 X axis; `bare`: no tick labels or titles (a model thumbnail's shape alone).
   */
  axes?: { yLog?: boolean; xLog?: boolean; bare?: boolean; xTitle?: string; yTitle?: string }
  /** Data set keys drawn emphasized (the control). */
  highlight?: readonly string[]
  /**
   * Data set keys drawn as a line through their points instead of symbols (an XY panel's model
   * shape: its starting values, never a fit).
   */
  lineSets?: readonly string[]
}

/** Roadmap 51b (§5.1): the live sketch of an analysis being set up. */
export interface SketchSpec {
  panels: SketchPanel[]
  /** One line under it ("Each line links a subject’s two values"). */
  caption: string
  /** The text alternative (§5.7). */
  description: string
  /** "3 groups · 8 values each · not matched · 2 comparisons". */
  counts: string
  /** Descriptive notes beside it (the SDs' ratio, values left out); never a test. */
  notes?: readonly string[]
  sampled?: { shown: number; total: number }
}

// ---------------------------------------------------------------------------------------------
// Roadmap 51a: explanations (docs/design/ANALYSIS_GUIDE.md §2). Code, not document data: they
// never enter a project file, and changing them changes no result.
// ---------------------------------------------------------------------------------------------

/**
 * A method's plain-language card: what it asks, when to use it instead of its neighbours, how to
 * read it; the formula and the R call behind "More". Placeholders `{A}`, `{B}` and `{control}`
 * stand for the user's group names where a card is shown with data (results' How to read this).
 */
export interface MethodCard {
  /** 'welchT', 'tukey', 'kruskalWallis'. */
  id: string
  /** "Welch’s t test": also what a recommendation and Help show. */
  name: string
  /** "Welch’s t": a short label. */
  shortName: string
  /** What it asks, one sentence (≤ 160 characters). */
  question: string
  /**
   * The null hypothesis in words, and what P is (≤ 220 characters); null for a method that tests
   * nothing (a transform, a curve drawn through the points, a simulation).
   */
  nullHypothesis: string | null
  /** The situations it fits (≤ 320 characters). */
  useWhen: string
  /** Neighbours and when to prefer them (card ids). */
  instead: readonly { card: string; when: string }[]
  /** In experiment terms (each ≤ 160 characters). */
  assumptions: readonly string[]
  /** How to read the result (≤ 600 characters). */
  reading: string
  /** Behind "More": the formula, the R call, notes. */
  more: { formula: string; r: string; notes?: string }
  /** One to three (none for tools that compute no statistic). */
  references: readonly { text: string; doi?: string }[]
}

/** A field's text: one line always shown under the question; a longer card behind ⓘ. */
export interface FieldExplain {
  /** ≤ 90 characters. */
  line: string
  /** ≤ 500 characters. */
  card?: string
}

/** An option's text: one line under it, a card behind ⓘ, the reason for a tag. */
export interface OptionExplain {
  /** ≤ 90 characters. */
  line: string
  /** ≤ 400 characters. */
  card?: string
  /** "(recommended)" or "(not recommended)" in its label, with why (≤ 160 characters). */
  tag?: { kind: 'recommended' | 'notRecommended'; why: string }
  /** The method card this option selects (a test or a correction), if any. */
  method?: string
}

/** One choice of a select or radio field. */
export interface FormOption {
  value: string | number | boolean
  label: string
  explain?: OptionExplain
  /** Roadmap 51b (§4.4): greyed with the reason while another choice or a fact excludes it. */
  unavailable?: readonly Unavailable[]
}

/** Declarative parameter form, rendered by the UI's generic analysis dialog. */
export type FormField = {
  /** Path into the params object. */
  path: readonly string[]
  label: string
  /** Roadmap 51a: what the question asks, in a line (and a card behind ⓘ). */
  explain?: FieldExplain
  /** Show only when other fields have one of these values (all conditions must hold). */
  showIf?: ShowIf | readonly ShowIf[]
  /**
   * Roadmap 51c (S5): the question doesn't apply to this table while a fact about its data holds
   * (and, when given, other fields have these values): it is shown greyed with the reason, its
   * stored value kept. Facts are counts and shapes the dialog reads from the chosen data sets
   * (`missingInMatched`: a subject — a row of a column table, a subcolumn of a grouped table —
   * lacks a value the others have), never a test of the data.
   */
  unavailableIf?: { fact: AnalysisFact; when?: readonly ShowIf[]; reason: string }
  /** Roadmap 51b (§4.2): the dialog's tier (attached to every field by @ps/analyses). */
  tier?: FieldTier
  /** Roadmap 51b (§4.4): hidden unless every condition holds (it never applies otherwise). */
  appliesTo?: readonly Condition[]
  /** Roadmap 51b (§4.4): greyed with the reason while another choice excludes it. */
  unavailable?: readonly Unavailable[]
} & (
  | { kind: 'select'; options: readonly FormOption[] }
  | { kind: 'radio'; options: readonly FormOption[] }
  | { kind: 'checkbox' }
  /** `percent`: stored as a fraction, shown and typed as a percentage (roadmap 51c, S34). */
  | { kind: 'number'; min?: number; max?: number; step?: number; percent?: boolean }
  /** A plugin-specific editor the UI provides under this component id. */
  | { kind: 'custom'; component: string }
)

/** A graphable output an analysis will produce, declared before it runs. */
export interface OutputDecl {
  key: DataSetKey
  /** The analyzed data set it belongs to (curves take that series' colour). */
  forDataSet?: DataSetKey
  /**
   * Draw it on a new graph of its own (a ROC curve, a Bland-Altman plot…) instead of on graphs of
   * the analyzed table. Outputs naming the same graph `id` share one graph.
   */
  graph?: {
    id: string
    name: string
    xTitle?: string
    yTitle?: string
    /** Fixed axis ranges, e.g. 0–100 for a ROC curve. */
    xRange?: [number, number]
    yRange?: [number, number]
    /** Equal plot width and height (ROC curves). */
    square?: boolean
    /**
     * Roadmap 34c: the graph draws the analysis' result table instead of this output — a graph of
     * its variables (X and Y, a text variable mapped to colour) with an ellipse per colour group
     * when `ellipses` — and the other outputs of the same graph over it (a biplot's vectors).
     */
    variables?: { x: DataSetKey; y: DataSetKey; color?: DataSetKey; ellipses?: boolean }
  }
  /** How the output is drawn (default: a line). */
  mark?: 'line' | 'points' | 'linePoints'
  /** Automatic point labels of the output's points on a new graph (e.g. a volcano's flagged). */
  pointLabels?: PointLabels
  /**
   * Roadmap 35: also drawn on graphs of the analyzed table's variables mapping these X and Y (a
   * fit per group over its points, in the group's colour), though it has a graph of its own.
   */
  onGraphsOf?: { x: DataSetKey; y: DataSetKey }
}

/** What a plugin knows about its source besides the data sets (see `AnalysisDef.run`). */
export interface RunContext {
  /** Kind of the source table (or of the analyzed result's table). */
  tableKind: TableKind
  /** Title of the source's X column, if it has one. */
  xTitle: string | null
  /**
   * Roadmap 51c (S13, S20): the analysis whose result table is analyzed (chaining), with the
   * note its result gives about what it did to the values (`values.sourceNote`: "3 values were
   * removed as outliers (ROUT, Q = 1%)"). Absent for data tables.
   */
  source?: { analysisId: string; name: string; note?: string }
  /**
   * Roadmap 51d (U19): a grouped table's factor names (`DataTable.factorNames`), which results
   * use instead of "Row factor" and "Column factor". Absent: unnamed.
   */
  factorNames?: { rows?: string; columns?: string }
}

/**
 * Roadmap 51d (U23): what an analysis' automatic name is made of — the analyzed data sets'
 * titles in order, the table's name, the control's title, the factors' names.
 */
export interface MethodNames {
  dataSets: readonly string[]
  table: string
  control?: string
  factors?: { rows?: string; columns?: string }
}

/**
 * Roadmap 42: how far a run has got, `done` of `total` steps (simulations, data sets…; any unit,
 * `done` never decreasing within a run). Optional for a plugin to call; the caller throttles it
 * (at most a few calls a second reach the screen), so a loop calls it every so many iterations,
 * not every one (decision 131), and calling it never changes what the run computes.
 */
export type Progress = (done: number, total: number) => void

export interface AnalysisDef<P = unknown> {
  id: string
  /** Current params schema version. Bump when params change shape; add a migration. */
  version: number
  title: string
  /** Groups analyses in the Analyze dialog, e.g. 'Column analyses'. */
  category: string
  description: string
  form: readonly FormField[]
  /** Table kinds this analysis is offered for. */
  accepts: readonly TableKind[]
  /** How many data sets it consumes. */
  inputs: { min: number; max: number }
  /**
   * Phase 42: it analyzes numbers, a text variable only in a role chosen for it (PCA's grouping,
   * a fit's groups), so the Analyze dialog starts with the number variables ticked, not the text
   * ones (absent: the first data sets, text or not). Text variables stay offered.
   */
  numbersByDefault?: boolean
  /**
   * Whether it reads the analyzed data sets with these params (absent: always). Simulations
   * don't, a power analysis only from pilot data: the Analyze dialog then offers no data sets.
   */
  usesData?: (params: P) => boolean
  /** Must provide defaults for every field so `params.parse({})` yields a complete value. */
  params: z.ZodType<P>
  migrateParams?: (raw: unknown, fromVersion: number) => unknown
  /**
   * Pure; runs in a worker. `context` describes the source (always passed by the engine);
   * `progress`, when given, hears how far a long run has got (roadmap 42).
   */
  run: (
    input: readonly NormalizedDataSet[],
    params: P,
    context?: RunContext,
    progress?: Progress,
  ) => AnalysisResult
  /** The analysis produces a data table (`AnalysisResult.table`) usable as a source. */
  producesTable?: boolean
  /**
   * Graphable outputs (fitted curves…) this analysis will produce for the given inputs, so the UI
   * can link them into graphs when the analysis is created.
   */
  outputs?: (inputKeys: readonly DataSetKey[], params: P) => OutputDecl[]
  /**
   * Roadmap 35: the results it offers on graphs, ready to add (curated labels, lines and bands:
   * "r and P", "IC50 with drop lines"), for these parameters and source.
   */
  graphResults?: (
    params: P,
    context: { tableKind: TableKind; dataSets: readonly DataSetKey[] },
  ) => ResultTemplate[]
  /**
   * Roadmap 51a: the method cards of the method these params choose (`MethodCard.id`s), the test
   * first, then its comparisons, e.g. `['oneWayAnova', 'tukey']`. A pure function of params,
   * shown by the dialog's About this method, the results' How to read this and Help.
   */
  cards?: (params: P) => readonly string[]
  /**
   * Roadmap 51b (§4.6): the problems found before computing (counts and shapes), the first one
   * returned. `run` returns it as its failure; the dialog shows it as a block.
   */
  validate?: (
    input: readonly NormalizedDataSet[],
    params: P,
    context?: RunContext,
  ) => Problem | null
  /** Roadmap 51b (§4.6): notes about the data beyond `validate` (unequal sizes, unpaired rows). */
  check?: (input: readonly NormalizedDataSet[], params: P, context?: RunContext) => Check[]
  /** Roadmap 51b (§4.5): where this analysis keeps the choices shared across methods. */
  shared?: Partial<Record<SharedKey, SharedPath>>
  /** Roadmap 51b (§4.7): roles of a multiple-variables analysis. */
  roles?: readonly AnalysisRole[]
  /**
   * Roadmap 51b (§5): the live sketch — data and structure only, from the normalized input and
   * params (never a result).
   */
  sketch?: (
    input: readonly NormalizedDataSet[],
    params: P,
    context: SketchContext,
  ) => SketchSpec | null
  /**
   * Roadmap 51d (U23): the analysis' automatic name from its method and groups ("Welch’s t test:
   * Treated vs Control", "One-way ANOVA + Tukey: Dose response").
   */
  methodName?: (params: P, names: MethodNames) => string
}
