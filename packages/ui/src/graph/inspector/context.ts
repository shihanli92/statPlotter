import type { Command } from '@ps/engine'
import type { LegendItem, Theme } from '@ps/graph'
import type {
  AnalysisResult,
  GraphNode,
  GraphPathSegment,
  NodeId,
  Project,
  TextStyle,
} from '@ps/model'

/**
 * What every formatting panel needs: the graph, its theme, and ways to change it. In the Format
 * dialogs `project`/`graph` are the dialog's draft and `set`/`dispatch` write to it.
 */
export interface PanelContext {
  /** The graph node (schema v2): panels read it and write layer paths. */
  graph: GraphNode
  project: Project
  /** Latest analysis results (for brackets and curves). */
  lookup: (id: NodeId) => AnalysisResult | undefined
  theme: Theme
  palette: readonly string[]
  /** Sets a value at a path in the graph (one undo step, optional label). */
  set: (path: GraphPathSegment[], value: unknown, label?: string) => void
  dispatch: (cmds: Command | Command[], label?: string) => void
  /** Show the options for another part of the graph (a scene style target; null = the graph). */
  onSelect: (target: (string | number)[] | null) => void
  onError: (msg: string) => void
  /** Opens the graph builder over this graph (Change layers…), when the host offers it. */
  onChangeLayers?: () => void
  /** Saves this graph's layers as a preset (Save layers as preset…), when the host offers it. */
  onSavePreset?: () => void
  /** Opens Manage presets…, when the host offers it. */
  onManagePresets?: () => void
  /** Opens "Split into one graph per…" (roadmap 34d), when the host offers it. */
  onSplit?: () => void
  /**
   * Roadmap 47: the layers selected in the list of layers, held by the view (on the canvas and on
   * a page: the whole layers selected there); absent, the list selects one layer, the place shown.
   */
  layerSelection?: LayerSelection
  /**
   * Roadmap 47: how many points a point's place formats together (several selected: its edits
   * written to each); absent for one.
   */
  points?: number
  /**
   * Roadmap 47b: the legend's entries as the host lays the graph out (`Scene.legend`: every entry
   * in its order, hidden ones too), for the legend's editors; absent: the data sets alone.
   */
  legend?: readonly LegendItem[]
}

/** Roadmap 47: the layers selected in a list of layers, as the view keeps them. */
export interface LayerSelection {
  /** In the order selected (the view's selection's). */
  ids: readonly string[]
  /** The last one clicked: the place the Format panel shows. */
  primary: string | undefined
  /** Selects these layers, `primary` shown in the panel; none (`[]`, null): the graph. */
  select: (ids: readonly string[], primary: string | null) => void
}

/** The effective text style of an element: theme default ← graph base text ← element override. */
export function effectiveText(
  ctx: PanelContext,
  base: TextStyle,
  own?: Partial<TextStyle>,
): TextStyle {
  return { ...base, ...ctx.graph.style.text, ...own }
}
