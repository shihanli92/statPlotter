import type { Command } from '@ps/engine'
import {
  type ColumnWidth,
  columnWidthOf,
  type FitKeep,
  type FontRegistry,
  fitPageToWidth,
  fitToWidth,
  resetToStyle,
} from '@ps/graph'
import {
  DEFAULT_STYLE_ID,
  effectiveStyle,
  type GraphNode,
  isEmptyStyle,
  type LayoutNode,
  type NodeId,
  type Project,
  type ProjectSettings,
  type StyleChoice,
  withGraphStyle,
  withProjectStyle,
} from '@ps/model'

// What applying, resetting and fitting styles does to a project, as commands (one undo step
// each; roadmap 37, decisions 531–535).

/** Where a style goes: some graphs (their own style) or the whole project. */
export type StyleTarget =
  | { kind: 'graphs'; ids: readonly NodeId[] }
  /** `followAll`: every graph follows it (their own styles dropped); else only the project's. */
  | { kind: 'project'; followAll: boolean }

const graphsOf = (project: Project): GraphNode[] =>
  project.order.flatMap((id) => {
    const n = project.nodes[id]
    return n?.kind === 'graph' ? [n] : []
  })

const sameChoice = (a: StyleChoice | undefined, b: StyleChoice | undefined) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** The project's style as a choice (absent: the app's own look). */
export function projectChoice(settings: ProjectSettings): StyleChoice | undefined {
  if (settings.style) return { id: settings.theme, style: settings.style }
  return settings.theme && settings.theme !== DEFAULT_STYLE_ID
    ? { id: settings.theme, style: effectiveStyle(settings) ?? {} }
    : undefined
}

/** The settings a project has with this style (its P values too, when it sets them). */
function settingsWith(settings: ProjectSettings, choice: StyleChoice): ProjectSettings {
  const { style: _, ...rest } = settings
  const plain = choice.id === DEFAULT_STYLE_ID && isEmptyStyle(choice.style)
  return {
    ...rest,
    theme: choice.id,
    ...(plain ? {} : { style: choice.style }),
    ...(choice.style.pValue?.style ? { pValueStyle: choice.style.pValue.style } : {}),
    ...(choice.style.pValue?.digits ? { pValueDigits: choice.style.pValue.digits } : {}),
  }
}

const replaced = (before: GraphNode, after: GraphNode): Command[] =>
  after === before || JSON.stringify(after) === JSON.stringify(before)
    ? []
    : [{ type: 'node.replace', node: after }]

/**
 * Applying a style (decision 531): to graphs, each gets it as its own (none when it is the
 * project's); to the project, its settings change and graphs follow — keeping everything the
 * user set (only the axis frames and legend place still at the old style's values move).
 */
export function applyStyleCommands(
  project: Project,
  choice: StyleChoice,
  target: StyleTarget,
): Command[] {
  const settings = project.settings
  if (target.kind === 'graphs') {
    const own = sameChoice(choice, projectChoice(settings)) ? null : choice
    return target.ids.flatMap((id) => {
      const g = project.nodes[id]
      return g?.kind === 'graph' ? replaced(g, withGraphStyle(g, settings, own)) : []
    })
  }
  const next = settingsWith(settings, choice)
  const cmds: Command[] = [
    {
      type: 'project.setSettings',
      settings: {
        theme: next.theme,
        pValueStyle: next.pValueStyle,
        pValueDigits: next.pValueDigits,
        ...(next.style ? { style: next.style } : {}),
      },
      ...(next.style ? {} : { clear: ['style'] as const }),
    },
  ]
  for (const g of graphsOf(project))
    cmds.push(...replaced(g, withProjectStyle(g, settings, next, target.followAll)))
  return cmds
}

/** Reset to style (decision 533): these graphs' own formatting of what styles set cleared. */
export function resetStyleCommands(project: Project, ids: readonly NodeId[]): Command[] {
  return ids.flatMap((id) => {
    const g = project.nodes[id]
    return g?.kind === 'graph' ? replaced(g, resetToStyle(g, project.settings)) : []
  })
}

/** The graphs on a layout page, each once. */
export const pageGraphs = (project: Project, layout: LayoutNode): NodeId[] => [
  ...new Set(
    layout.items.flatMap((it) =>
      it.type === 'graph' && project.nodes[it.graph]?.kind === 'graph' ? [it.graph] : [],
    ),
  ),
]

/** The width of a column of a graph's (or the project's) style, in points. */
export const columnWidth = (project: Project, which: ColumnWidth, graph?: GraphNode): number =>
  columnWidthOf(effectiveStyle(project.settings, graph), which)

/** Fit to column (decision 535): a graph sized so the whole of it is `width` wide at scale 1. */
export function fitGraphCommands(
  project: Project,
  fonts: FontRegistry,
  graph: GraphNode,
  width: number,
  keep: FitKeep,
): Command[] {
  const size = fitToWidth({ project, graph, fonts }, width, keep)
  return [{ type: 'node.set', id: graph.id, path: ['size'], value: size }]
}

/** Fit to column: a page made `width` wide, its items in proportion, its graphs refitted. */
export function fitPageCommands(
  project: Project,
  fonts: FontRegistry,
  layout: LayoutNode,
  width: number,
  keep: FitKeep,
): Command[] {
  const fit = fitPageToWidth({ project, fonts }, layout, width, keep)
  return [
    { type: 'node.set', id: layout.id, path: ['page'], value: fit.page },
    { type: 'node.set', id: layout.id, path: ['items'], value: fit.items },
    ...[...fit.sizes].map(
      ([id, size]): Command => ({ type: 'node.set', id, path: ['size'], value: size }),
    ),
  ]
}
