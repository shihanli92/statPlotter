// Roadmap 51f: "What will be tested" — a schematic of the question an analysis asks, built up as
// Guide me's questions are answered (docs/design/ANALYSIS_GUIDE.md §12). Code, not document data:
// @ps/analyses writes the design and the spec from the answers and params (the branching on the
// method is there), @ps/graph draws the spec without knowing which analysis asked. A schematic
// never holds a value of the data or a result: names, what is compared, how, and counts of the
// design only.

/**
 * What is compared, in each box (the groups' means, their ranks, a proportion, a survival
 * curve, a fitted curve's parameter…).
 */
export type SchematicMeasure =
  | 'mean'
  | 'logMean'
  | 'difference'
  | 'ratio'
  | 'ranks'
  | 'signedRanks'
  | 'distribution'
  | 'proportion'
  | 'risk'
  | 'odds'
  | 'diagnostic'
  | 'survival'
  | 'medianSurvival'
  | 'slope'
  | 'parameter'
  | 'curve'
  | 'association'
  | 'agreement'
  | 'separation'
  | 'summary'
  | 'shape'
  | 'outliers'
  | 'interpolate'
  | 'area'
  | 'smooth'
  | 'probability'
  | 'predict'
  | 'components'
  | 'counts'
  | 'fraction'
  | 'plan'

/**
 * How the parts of a design are compared: two groups, every pair, each against a control, a
 * trend in order, one test of all, each against a set value, within each row or column of a
 * grid, every cell, one factor's levels averaged over the other, one test per row, two
 * variables together, predictors of an outcome, one shared parameter against one each.
 */
export type SchematicComparisons =
  | 'pair'
  | 'allPairs'
  | 'vsControl'
  | 'trend'
  | 'none'
  | 'vsValue'
  | 'withinRows'
  | 'withinColumns'
  | 'allCells'
  | 'mainColumns'
  | 'mainRows'
  | 'perRow'
  | 'together'
  | 'predict'
  | 'shared'

/**
 * The design a schematic draws: what Guide me's answers (`GuideAnswer.draws`) and an analysis'
 * params say about the question, merged in that order. Every field is optional: a schematic
 * shows what is known so far.
 */
export interface SchematicDesign {
  /**
   * How the boxes are laid out: the groups in a row, a grid of rows × data sets (a grouped
   * table), the rows of a table of counts, X beside Y, predictors pointing at an outcome, a
   * standard curve and its unknowns, nothing (planning).
   */
  layout?: 'groups' | 'grid' | 'rows' | 'xy' | 'pair' | 'predict' | 'standard' | 'none'
  measure?: SchematicMeasure
  comparisons?: SchematicComparisons
  /**
   * Same subjects: no, yes (every group), across a grid's columns (within each row), across its
   * rows (within each column), or both.
   */
  matched?: 'no' | 'yes' | 'columns' | 'rows' | 'both'
  /** A grid's comparisons within a row or column: every pair, or each with the first. */
  kind?: 'allPairs' | 'vsControl'
  /** The control group's key (a data set's, or a row's index as text on a table of counts). */
  control?: string
  /** The set value a one-sample test compares with. */
  hypothetical?: number
  /** A one-tailed test's predicted direction (the analysis' sign: B − A above zero). */
  direction?: 'increase' | 'decrease'
  /** Each group's own scatter (Welch) or one pooled scatter. */
  scatter?: 'own' | 'pooled'
  /** The correction of the family of comparisons, in words ("Tukey", "the false discovery rate"). */
  correction?: string
  /** Several measurements per subject: the subjects are the units. */
  nested?: boolean
  /** A fitted curve's parameter compared or reported ("EC50", "slope"). */
  parameter?: string
  /** A curve's shape in its boxes. */
  curve?: 'up' | 'down' | 'line' | 'peak'
  /** How a shared parameter is decided ("the extra sum-of-squares F test", "AICc"). */
  decideBy?: string
  /** A table of counts' roles: the exposed (treated) row and the outcome column (0 or 1). */
  exposedRow?: number
  outcomeColumn?: number
  /** The outcome variable's key (predict). */
  outcome?: string
  /** Lines said under the drawing ("Steepness fitted", "Log-rank: the whole follow-up"). */
  notes?: readonly string[]
}

/** The small picture in a box of what is compared there. */
export type SchematicGlyph =
  | 'mean'
  | 'ranks'
  | 'distribution'
  | 'proportion'
  | 'survival'
  | 'curveUp'
  | 'curveDown'
  | 'peak'
  | 'line'
  | 'scatter'
  | 'area'
  | 'summary'
  | 'none'

/** A box: a group, a cell of a grid, a variable, a set value. */
export interface SchematicBox {
  id: string
  /** The user's name ("Treated"); a set value ("100"); empty in a grid's cells (its headings name it). */
  label: string
  /** What is compared in it ("mean", "mean rank", "% Died", "survival curve", "EC50"). */
  measure?: string
  glyph?: SchematicGlyph
  /**
   * 'control' drawn emphasized; 'reference' (a set value) dashed; 'outcome' and 'predictor' as
   * groups; 'more' a count of boxes left out ("+ 4 more").
   */
  role?: 'group' | 'control' | 'reference' | 'outcome' | 'predictor' | 'more'
  /** Its place: row and column of the drawing's grid, from 0. */
  row: number
  column: number
  /** Independent units inside it (a nested group's subjects): marks with a count. */
  members?: { count: number; label: string }
}

/** A comparison (or a prediction, an association) between two boxes. */
export interface SchematicArrow {
  from: string
  to: string
  /**
   * 'both': a difference either way (two-tailed); 'end': towards `to` (the group predicted
   * higher, an outcome predicted); 'none': together (an association, a shared parameter).
   */
  heads: 'both' | 'end' | 'none'
  /**
   * 'arc': a comparison over the boxes of a row (beside those of a column); 'below': one line
   * under a row from `from` to `to` (a trend, a shared parameter); 'straight': box to box.
   */
  route: 'arc' | 'below' | 'straight'
  /** A few words on it ("higher?", "steady rise or fall?"). */
  label?: string
}

/** Values of the same subjects: a line joining the boxes, in order. */
export interface SchematicLink {
  boxes: readonly string[]
  label?: string
}

/** The schematic: the question in words, then boxes, arrows and links to draw. */
export interface SchematicSpec {
  /** "Is the mean of Treated different from the mean of Control?" */
  question: string
  /** "If the treatment had no effect, …"; null when nothing is tested (a description, a fit). */
  noEffect: string | null
  boxes: SchematicBox[]
  arrows: SchematicArrow[]
  links: SchematicLink[]
  /** A grid's factor names and level headings (above its columns, left of its rows). */
  grid?: {
    columns?: string
    rows?: string
    columnLevels: readonly string[]
    rowLevels: readonly string[]
  }
  /** Lines under the drawing: the family and its correction, the independent units… */
  notes: string[]
  /** What is still to be decided ("Next: What kind of values?"). */
  pending?: string
  /** The text alternative: the whole drawing in words. */
  description: string
}
