import { mayNameInfo } from './formula.ts'
import { mapGraphRefs } from './graphRefs.ts'
import { type NodeId, newAnnotationId, newLayoutItemId, newNodeId } from './ids.ts'
import type { GraphNode, SplitSpec } from './layers.ts'
import { levelKey, levelsInTable, orderedLevels } from './levels.ts'
import type { LayoutItemOf, LayoutNode, SetGrid } from './other.ts'
import type { Project } from './project.ts'
import { nodeById } from './project.ts'
import { sourceTable } from './source.ts'
import { type RichText, richPlain, titleRuns } from './style.ts'
import type { DataTable } from './table.ts'

// Sets of split graphs (roadmap 34d, decisions 380–385): one ordinary graph per level of a text
// variable (`seriesSource.filter`), per data set (`include`) or per row (`rows`) of a table, each
// a copy of one graph (decision 41: small multiples are graphs, not a facet type), sharing a set
// id (`GraphNode.split`) and their axes through link groups (decision 40). A page places a set on
// a grid (`LayoutNode.grids`). When the table gains a level, data set or row the set has no graph
// of, the engine adds one like the others, in the same undo step as the edit
// (`followSplitSets`); a slice whose rows are gone keeps its graph until the user deletes it.

/** One slice of a table a set can show: its key (a level's, a data set's, a row) and title. */
/**
 * Roadmap 41 (decision 622): a level's colour pinned to the palette entry it has in the unsplit
 * graph (`index`), unless the level has its own colour. When a graph is split by the variable
 * that also colours it (its categories, groups or colours), each graph of the set shows one level
 * and would otherwise draw it in the first colour; pinned, colours follow the level.
 */
export function pinLevelColour(
  overrides: GraphNode['seriesOverrides'],
  key: string,
  index: number,
): GraphNode['seriesOverrides'] {
  if (overrides[key]?.color) return overrides
  return { ...overrides, [key]: { ...overrides[key], color: { palette: index } } }
}

/** Whether a set's levels have pinned colours (`pinLevelColour`), so a new level gets one too. */
const pinsLevels = (template: GraphNode, slices: readonly SplitSlice[]): boolean =>
  slices.some((s) => {
    const c = template.seriesOverrides[s.key]?.color
    return !!c && 'palette' in c
  })

export interface SplitSlice {
  /** `levelKey` of a level, a data set's key, or a row's index as text. */
  key: string
  title: RichText
}

/** The slice a set's graph shows (undefined: not a member, or its slice is unset). */
export function memberSlice(graph: Pick<GraphNode, 'split' | 'seriesSource'>): string | undefined {
  const src = graph.seriesSource
  switch (graph.split?.by) {
    case 'level':
      return src.filter?.level
    case 'dataSet':
      return Array.isArray(src.include) ? src.include[0] : undefined
    case 'row':
      return src.rows?.length === 1 ? String(src.rows[0]) : undefined
    default:
      return undefined
  }
}

/** The graphs of a set, in the project's order. */
export function setMembers(project: Pick<Project, 'nodes' | 'order'>, set: string): GraphNode[] {
  return project.order.flatMap((id) => {
    const n = nodeById(project.nodes, id)
    return n?.kind === 'graph' && n.split?.set === set ? [n] : []
  })
}

/** Whether a data set has a value in any of these rows (every row: absent). */
function hasValue(ds: DataTable['dataSets'][number], rows?: readonly number[]): boolean {
  return ds.subcolumns.some((c) =>
    rows ? rows.some((r) => c.values[r] != null) : c.values.some((v) => v != null),
  )
}

/**
 * The slices of `table` a set split like `template` shows, in the set's order: the levels of its
 * variable in the template's order of levels (then as they first appear), the number data sets
 * with values in table order, or the rows with values in the template's data sets.
 */
export function tableSlices(
  table: DataTable,
  split: Pick<SplitSpec, 'by' | 'variable'>,
  template: Pick<GraphNode, 'seriesSource' | 'levels' | 'levelOrder'>,
): SplitSlice[] {
  const rows = template.seriesSource.rows
  if (split.by === 'level') {
    const ds = table.dataSets.find((d) => d.id === split.variable)
    if (!ds?.text) return []
    const levels = orderedLevels(
      levelsInTable(ds, rows),
      template.levels?.[ds.id],
      template.levelOrder,
    )
    return levels.map((t) => ({ key: levelKey(t), title: [{ text: t }] }))
  }
  if (split.by === 'dataSet')
    return table.dataSets
      .filter((d) => !d.text && hasValue(d, rows))
      .map((d) => ({ key: d.id as string, title: titleRuns(d.title, d.titleRich) }))
  if (table.tableKind !== 'grouped' && table.tableKind !== 'contingency') return []
  const include = template.seriesSource.include
  const sets = table.dataSets.filter(
    (d) => !d.text && (include === 'all' || include.includes(d.id)),
  )
  const out: SplitSlice[] = []
  for (let r = 0; r < table.rowCount; r++) {
    if (!sets.some((d) => hasValue(d, [r]))) continue
    const title = table.rowTitles?.[r]
    out.push({
      key: String(r),
      title: title ? titleRuns(title, table.rowTitlesRich?.[r]) : [{ text: `Row ${r + 1}` }],
    })
  }
  return out
}

/** A slice's title as plain text (graph names). */
export const sliceName = (s: SplitSlice): string => richPlain(s.title)

/**
 * A new graph of the set showing `slice`, formatted like `template` (a graph of the set): its
 * layers, look, formats, mapping, size, axes, links and legend; titled with the slice's title (the
 * template's title style), named "<table> – <slice>". Brackets and single-point formats name the
 * template's own data and are left out (a level's brackets, between levels every graph shows,
 * are kept); text and line annotations are copied with new ids. A data set's graph moves the
 * template's formats of its data set to the new one (and its colour, when it follows the
 * palette, to the new data set's place); its curves of the template's data set are left out.
 */
export function memberOf(
  template: GraphNode,
  slice: SplitSlice,
  table: DataTable,
  legend: boolean,
): GraphNode {
  const split = template.split
  if (!split) throw new Error('not a graph of a set')
  let g: GraphNode = template
  if (split.by === 'dataSet') {
    const own = memberSlice(template)
    if (own !== undefined && own !== slice.key) {
      g = mapGraphRefs(template, {
        output: (o) => (o.colorOf === own ? 'drop' : 'keep'),
        key: (k) => (k === own ? slice.key : k === slice.key ? 'drop' : 'keep'),
      })
      // Audit 3 (G4): a legend-only label is wording about the template's own data set, not a
      // format: the new graph's entry shows its own title.
      const labels = g.legend.labels
      if (labels && Object.hasOwn(labels, slice.key)) {
        const { [slice.key]: _, ...rest } = labels
        const { labels: __, ...legend } = g.legend
        g = { ...g, legend: Object.keys(rest).length ? { ...legend, labels: rest } : legend }
      }
      const id = g.seriesOverrides[slice.key]
      const index = table.dataSets.findIndex((d) => d.id === slice.key)
      if (id?.color && 'palette' in id.color && index >= 0)
        g = {
          ...g,
          seriesOverrides: {
            ...g.seriesOverrides,
            [slice.key]: { ...id, color: { palette: index } },
          },
        }
    }
  }
  const src = g.seriesSource
  const seriesSource: GraphNode['seriesSource'] =
    split.by === 'level' && split.variable !== undefined
      ? { ...src, filter: { variable: split.variable, level: slice.key } }
      : split.by === 'dataSet'
        ? { ...src, include: [slice.key] }
        : { ...src, rows: [Number(slice.key)] }
  const { pointOverrides: _, ...rest } = g
  return {
    ...rest,
    id: newNodeId(),
    name: `${table.name} – ${sliceName(slice)}`,
    seriesSource,
    annotations: g.annotations
      .filter((a) => a.type !== 'bracket' || split.by === 'level')
      .map((a) => ({ ...a, id: newAnnotationId() })),
    title: {
      ...(template.title?.style ? { style: template.title.style } : {}),
      content: slice.title,
    },
    legend: { ...g.legend, show: legend },
  }
}

// ---- Page grids ---------------------------------------------------------------------------------

/** The top-left of a grid's cell `i` (row by row). */
export function gridCell(grid: SetGrid, i: number): { x: number; y: number } {
  return {
    x: grid.x + (i % grid.columns) * grid.dx,
    y: grid.y + Math.floor(i / grid.columns) * grid.dy,
  }
}

/** The cell an item placed at (x, y) is in (nearest, row by row). */
export function gridIndexAt(grid: SetGrid, x: number, y: number): number {
  const col = Math.max(0, Math.min(grid.columns - 1, Math.round((x - grid.x) / grid.dx)))
  const row = Math.max(0, Math.round((y - grid.y) / grid.dy))
  return row * grid.columns + col
}

/**
 * A page with its set's graphs (`order`: graph ids, the set's order) placed on its grid, each in
 * cell i, keeping its place within its old cell (new graphs: `like`'s, at its scale). Graphs of
 * the set not on the page yet are added after the set's item before them (or before the first);
 * the page grows taller when the grid passes its bottom. The grid may have a new column count.
 */
export function placeOnGrid(
  layout: LayoutNode,
  grid: SetGrid,
  order: readonly NodeId[],
  like?: NodeId,
): LayoutNode {
  const old = layout.grids?.find((g) => g.set === grid.set) ?? grid
  const items = [...layout.items]
  const at = new Map<NodeId, number>()
  items.forEach((it, i) => {
    if (it.type === 'graph' && order.includes(it.graph) && !at.has(it.graph)) at.set(it.graph, i)
  })
  const offset = (it: LayoutItemOf<'graph'>) => {
    const cell = gridCell(old, gridIndexAt(old, it.x, it.y))
    return { dx: it.x - cell.x, dy: it.y - cell.y }
  }
  const model = like === undefined ? undefined : at.get(like)
  const modelItem = (model === undefined ? undefined : items[model]) as
    | LayoutItemOf<'graph'>
    | undefined
  // New graphs' items, after the set's item placed before them.
  order.forEach((id, i) => {
    if (at.has(id)) return
    const before = order.slice(0, i).findLast((g) => at.has(g))
    const after = order.slice(i + 1).find((g) => at.has(g))
    const index =
      before !== undefined
        ? at.get(before)! + 1
        : after !== undefined
          ? at.get(after)!
          : items.length
    const item: LayoutItemOf<'graph'> = {
      type: 'graph',
      id: newLayoutItemId(),
      graph: id,
      x: 0,
      y: 0,
      scale: modelItem?.scale ?? 1,
    }
    items.splice(index, 0, item)
    for (const [g, j] of at) if (j >= index) at.set(g, j + 1)
    at.set(id, index)
  })
  const modelOffset = modelItem ? offset(modelItem) : { dx: 0, dy: 0 }
  let bottom = 0
  order.forEach((id, i) => {
    const j = at.get(id)!
    const it = items[j] as LayoutItemOf<'graph'>
    const isNew = !layout.items.includes(it)
    const off = isNew ? modelOffset : offset(it)
    const cell = gridCell(grid, i)
    items[j] = { ...it, x: cell.x + off.dx, y: cell.y + off.dy }
    bottom = Math.max(bottom, cell.y + grid.dy)
  })
  const grids = [...(layout.grids ?? []).filter((g) => g.set !== grid.set), grid]
  // The last row's cell ends a gap below its graphs; keep a margin under them.
  const height = Math.max(layout.page.height, Math.ceil(bottom + 24))
  return {
    ...layout,
    items,
    grids,
    ...(height !== layout.page.height ? { page: { ...layout.page, height } } : {}),
  }
}

// ---- Following the table ------------------------------------------------------------------------

/** What `followSplitSets` adds: new graphs (each after a graph of its set) and changed pages. */
export interface SplitFollowUp {
  /** `template`: the graph of the set it copies (audit 2, M9: it goes in that graph's folder). */
  graphs: { node: GraphNode; after: NodeId; template: NodeId }[]
  layouts: LayoutNode[]
}

/** The info sheets' names and fields, in navigator order (what formulas read of them). */
const infoOf = (p: Pick<Project, 'nodes' | 'order'>) =>
  p.order.flatMap((id) => {
    const n = nodeById(p.nodes, id)
    return n?.kind === 'info' ? [[n.name, n.fields]] : []
  })

/** The graphs of a project in sets, by set id (project order). */
function setsOf(project: Pick<Project, 'nodes' | 'order'>): Map<string, GraphNode[]> {
  const out = new Map<string, GraphNode[]>()
  for (const id of project.order) {
    const n = nodeById(project.nodes, id)
    if (n?.kind !== 'graph' || !n.split) continue
    const list = out.get(n.split.set)
    if (list) list.push(n)
    else out.set(n.split.set, [n])
  }
  return out
}

/** The member a new graph copies: one without a legend when the set shows one elsewhere. */
const templateOf = (members: readonly GraphNode[]) =>
  members.find((m) => !m.legend.show) ?? members[0]!

/**
 * Whether `tableSlices` reads the same of `was` as of `now` for a set split as `split` (the same
 * template): the same objects where it reads (a cell edit copies only its own column). Tables
 * with calculated variables are not compared (their values are the formulas', which read other
 * columns and info fields), but for a level split of a variable that is calculated in neither.
 */
function sameSlicesRead(
  was: DataTable,
  now: DataTable,
  split: Pick<SplitSpec, 'by' | 'variable'>,
): boolean {
  if (split.by === 'level') {
    const a = was.dataSets.find((d) => d.id === split.variable)
    const b = now.dataSets.find((d) => d.id === split.variable)
    return a === b && a?.formula === undefined
  }
  const calculated = (t: DataTable) => t.dataSets.some((d) => d.formula !== undefined)
  if (calculated(was) || calculated(now)) return false
  const sameSets =
    was.dataSets.length === now.dataSets.length &&
    was.dataSets.every((d, i) => d === now.dataSets[i])
  if (split.by === 'dataSet') return sameSets
  return (
    sameSets &&
    was.tableKind === now.tableKind &&
    was.rowCount === now.rowCount &&
    was.rowTitles === now.rowTitles &&
    was.rowTitlesRich === now.rowTitlesRich
  )
}

/**
 * After a change from `before` to `after`: for each set whose (data) table changed, a graph for
 * every slice the table now has that it did not have before the change and that the set's graphs
 * (after the change) show none of (decision 382: a new level, data set or row; slices the set
 * leaves out on purpose, or whose graph was deleted, stay without one, even when the delete and
 * the table's edit are one batch: phase 42), formatted like the others (`memberOf`), placed in
 * the set's order on every page with the set's grid. Null when nothing is added.
 */
export function followSplitSets(before: Project, after: Project): SplitFollowUp | null {
  const sets = setsOf(after)
  if (!sets.size) return null
  const graphs: SplitFollowUp['graphs'] = []
  const layouts = new Map<NodeId, LayoutNode>()
  // Audit 2 (M9): levels of calculated text variables may read info fields, so an edit of the
  // info sheets is a change of every table whose formulas may name one.
  let infoChanged: boolean | undefined
  const infoEdited = () =>
    (infoChanged ??= JSON.stringify(infoOf(before)) !== JSON.stringify(infoOf(after)))
  for (const [set, members] of sets) {
    const tableId = members[0]!.seriesSource.table
    const now = nodeById(after.nodes, tableId)
    const was = nodeById(before.nodes, tableId)
    if (now?.kind !== 'table' || was?.kind !== 'table') continue
    if (now === was && !(mayNameInfo(now) && infoEdited())) continue
    const template = templateOf(members)
    const split = template.split!
    // Audit 2 (M7): what the slices read unchanged, the table has no new slice (the same as
    // finding the slices of both, without reading every row).
    if (sameSlicesRead(was, now, split)) continue
    // Levels of calculated text variables (recode, cut) count as levels (roadmap 38), their
    // formulas reading the project's info fields (`sourceTable`).
    const old = new Set(
      tableSlices(sourceTable(before, tableId)!, split, template).map((s) => s.key),
    )
    const nowTable = sourceTable(after, tableId)!
    const slices = tableSlices(nowTable, split, template)
    // Phase 42: the slices shown are the set's graphs after the change, so a graph deleted (or
    // taken out of the set) in the same batch as the edit is not a slice without a graph to fill.
    const shown = new Set(members.map(memberSlice))
    const added = slices.filter((s) => !old.has(s.key) && !shown.has(s.key))
    if (!added.length) continue

    const legend = !members.some((m) => m.legend.show) && template.legend.show
    // A set whose levels keep their colours (roadmap 41): a new level takes its place's colour.
    const pins = split.by === 'level' && pinsLevels(template, slices)
    const made = added.map((s) => {
      const m = memberOf(template, s, nowTable, legend)
      return pins
        ? {
            ...m,
            seriesOverrides: pinLevelColour(m.seriesOverrides, s.key, slices.indexOf(s)),
          }
        : m
    })
    let last = members.at(-1)!.id
    for (const node of made) {
      graphs.push({ node, after: last, template: template.id })
      last = node.id
    }
    // The set's order: its slices as the table has them now, graphs of slices gone where they were.
    const bySlice = new Map<string, NodeId>()
    for (const g of [...members, ...made]) {
      const k = memberSlice(g)
      if (k !== undefined && !bySlice.has(k)) bySlice.set(k, g.id)
    }
    for (const id of after.order) {
      const page = layouts.get(id) ?? nodeById(after.nodes, id)
      if (page?.kind !== 'layout') continue
      const grid = page.grids?.find((g) => g.set === set)
      if (!grid) continue
      const order = setOrder(page, grid, members, made, slices)
      const like = page.items.find((it) => it.type === 'graph' && it.graph === template.id) as
        | LayoutItemOf<'graph'>
        | undefined
      layouts.set(page.id, placeOnGrid(page, grid, order, like?.graph))
    }
  }
  return graphs.length ? { graphs, layouts: [...layouts.values()] } : null
}

/**
 * The order of a set's graphs on a page: those on it in their grid order, each new graph after
 * the last one whose slice comes before its own in `slices` (else before the first after it).
 */
function setOrder(
  page: LayoutNode,
  grid: SetGrid,
  members: readonly GraphNode[],
  made: readonly GraphNode[],
  slices: readonly SplitSlice[],
): NodeId[] {
  const rank = new Map(slices.map((s, i) => [s.key, i]))
  const ids = new Set(members.map((m) => m.id))
  const placed = page.items
    .map((it, i) => ({ it, i }))
    .filter(
      (x): x is { it: LayoutItemOf<'graph'>; i: number } =>
        x.it.type === 'graph' && ids.has(x.it.graph),
    )
    .map((x) => ({ ...x, cell: gridIndexAt(grid, x.it.x, x.it.y) }))
    .sort((a, b) => a.cell - b.cell || a.i - b.i)
  const order: GraphNode[] = []
  const seen = new Set<NodeId>()
  for (const { it } of placed) {
    if (seen.has(it.graph)) continue
    seen.add(it.graph)
    order.push(members.find((m) => m.id === it.graph)!)
  }
  const rankOf = (g: GraphNode) => {
    const k = memberSlice(g)
    return k === undefined ? undefined : rank.get(k)
  }
  for (const g of made) {
    const r = rankOf(g)!
    let at = -1
    order.forEach((o, i) => {
      const ro = rankOf(o)
      if (ro !== undefined && ro < r) at = i
    })
    if (at < 0) {
      const next = order.findIndex((o) => (rankOf(o) ?? -1) > r)
      at = next < 0 ? order.length - 1 : next - 1
    }
    order.splice(at + 1, 0, g)
  }
  return order.map((g) => g.id)
}
