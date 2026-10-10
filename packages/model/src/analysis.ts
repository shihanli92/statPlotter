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
  }),
  /** Validated by the plugin's own schema, not here. */
  params: z.unknown(),
  /** Free text about the analysis (roadmap 31), edited above its results; absent = none. */
  notes: z.string().optional(),
})
export type AnalysisNode = z.infer<typeof AnalysisNode>

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

export const ResultBlock = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('keyValue'),
    title: z.string().optional(),
    rows: z.array(z.object({ label: z.string(), value: ResultValue })),
  }),
  z.object({
    type: z.literal('table'),
    title: z.string().optional(),
    columns: z.array(z.string()),
    rows: z.array(z.array(ResultValue)),
  }),
  z.object({ type: z.literal('note'), text: z.string() }),
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

export const Diagnostic = z.object({
  level: z.enum(['info', 'warning', 'error']),
  message: z.string(),
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

export interface ShowIf {
  path: readonly string[]
  in: readonly unknown[]
}

/** Declarative parameter form, rendered by the UI's generic analysis dialog. */
export type FormField = {
  /** Path into the params object. */
  path: readonly string[]
  label: string
  help?: string
  /** Show only when other fields have one of these values (all conditions must hold). */
  showIf?: ShowIf | readonly ShowIf[]
} & (
  | { kind: 'select'; options: readonly { value: string | number | boolean; label: string }[] }
  | { kind: 'radio'; options: readonly { value: string | number | boolean; label: string }[] }
  | { kind: 'checkbox' }
  | { kind: 'number'; min?: number; max?: number; step?: number }
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
}
