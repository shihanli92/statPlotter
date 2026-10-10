import type { Command } from '@ps/engine'
import type { Box, LegendItem, StylePath } from '@ps/graph'
import { type GraphNode, type LegendSpec, mergeRuns, type RichText, richPlain } from '@ps/model'
import { isLegendEntryPath } from '../selection/sceneKeys.ts'
import { type Selection, type SelKey, selectionOf } from '../selection/selection.ts'

// Roadmap 47b (decisions 980–999): edits of a graph's legend made from its entries — an entry
// moved within its group (the legend's order only: never the drawing order of marks, data sets or
// columns), hidden from the legend, given a legend-only label — and its grid (columns, fill). Pure:
// commands for the store, one undo step each. `items` is the legend as laid out (`Scene.legend`):
// every entry in its order, hidden ones too.

/** The legend written whole (one `node.set`). */
const legendCommand = (graph: GraphNode, legend: LegendSpec): Command => ({
  type: 'node.set',
  id: graph.id,
  path: ['legend'],
  value: legend,
})

/** One field of the legend set (`undefined`: taken out). */
const fieldCommand = <K extends keyof LegendSpec>(
  graph: GraphNode,
  field: K,
  value: LegendSpec[K] | undefined,
): Command => ({ type: 'node.set', id: graph.id, path: ['legend', field], value })

/** The legend with a field set, or taken out when `undefined`. */
function withField<K extends keyof LegendSpec>(
  legend: LegendSpec,
  field: K,
  value: LegendSpec[K] | undefined,
): LegendSpec {
  const { [field]: _, ...rest } = legend
  return (value === undefined ? rest : { ...rest, [field]: value }) as LegendSpec
}

/** The movable entries of a group (not headings, colour bars, "… more"), in the legend's order. */
export const groupItems = (items: readonly LegendItem[], group: string): LegendItem[] =>
  items.filter((e) => e.group === group && !e.fixed)

/** The group of an entry, if the legend has it. */
export const groupOfEntry = (items: readonly LegendItem[], key: string): string | undefined =>
  items.find((e) => e.key === key && !e.fixed)?.group

/**
 * The legend's order with one group's entries in `seq` (the whole group, so its order no longer
 * depends on `reverse` or on entries added later): the other groups' keys kept.
 */
export function orderWithGroup(legend: LegendSpec, seq: readonly string[]): string[] {
  const own = new Set(seq)
  return [...(legend.order ?? []).filter((k) => !own.has(k)), ...seq]
}

/**
 * `keys` of one group moved one place earlier (`by` −1) or later (+1) among the group's entries
 * (only those shown with `shownOnly`, as on the canvas; hidden ones keep their places): several
 * move together, each past the next one not moved, a block stopping at the end. The group's new
 * sequence (every entry), or null when nothing moves.
 */
export function entriesMovedBy(
  items: readonly LegendItem[],
  keys: readonly string[],
  by: 1 | -1,
  shownOnly = false,
): string[] | null {
  const group = keys.map((k) => groupOfEntry(items, k)).find((g) => g !== undefined)
  if (group === undefined) return null
  const all = groupItems(items, group)
  const moving = new Set(keys.filter((k) => groupOfEntry(items, k) === group))
  const slots = all.flatMap((e, i) => (!shownOnly || !e.hidden ? [i] : []))
  const seen = slots.map((i) => all[i]!.key)
  const next = [...seen]
  if (by < 0) {
    for (let i = 1; i < next.length; i++)
      if (moving.has(next[i]!) && !moving.has(next[i - 1]!))
        [next[i - 1], next[i]] = [next[i]!, next[i - 1]!]
  } else {
    for (let i = next.length - 2; i >= 0; i--)
      if (moving.has(next[i]!) && !moving.has(next[i + 1]!))
        [next[i + 1], next[i]] = [next[i]!, next[i + 1]!]
  }
  if (next.every((k, i) => k === seen[i])) return null
  const seq = all.map((e) => e.key)
  slots.forEach((slot, j) => {
    seq[slot] = next[j]!
  })
  return seq
}

/**
 * `key` dropped next to `target` (before it, or `after`), both of one group: the group's new
 * sequence, or null when it stays where it is (or they are of different groups).
 */
export function entryDropped(
  items: readonly LegendItem[],
  key: string,
  target: string,
  after: boolean,
): string[] | null {
  const group = groupOfEntry(items, key)
  if (group === undefined || groupOfEntry(items, target) !== group || key === target) return null
  const seq = groupItems(items, group).map((e) => e.key)
  const rest = seq.filter((k) => k !== key)
  const at = rest.indexOf(target) + (after ? 1 : 0)
  const next = [...rest.slice(0, at), key, ...rest.slice(at)]
  return next.every((k, i) => k === seq[i]) ? null : next
}

/** The command writing a group's new sequence into the legend's order. */
export const orderCommand = (graph: GraphNode, seq: readonly string[]): Command =>
  fieldCommand(graph, 'order', orderWithGroup(graph.legend, seq))

/** "Move legend entry", "Move 3 legend entries". */
export const moveEntriesLabel = (n: number): string =>
  n === 1 ? 'Move legend entry' : `Move ${n} legend entries`

/**
 * Moving entries one place (Alt+arrows, Move earlier / later): the command and its label, or null
 * when they can't move that way.
 */
export function moveEntriesCommand(
  graph: GraphNode,
  items: readonly LegendItem[],
  keys: readonly string[],
  by: 1 | -1,
  shownOnly = false,
): { command: Command; label: string } | null {
  const seq = entriesMovedBy(items, keys, by, shownOnly)
  if (!seq) return null
  const group = groupOfEntry(items, keys.find((k) => groupOfEntry(items, k) !== undefined)!)
  const n = keys.filter((k) => groupOfEntry(items, k) === group).length
  return { command: orderCommand(graph, seq), label: moveEntriesLabel(n) }
}

/** Entries shown or hidden in the legend (`legend.hidden`). */
export function entriesShownCommand(
  graph: GraphNode,
  keys: readonly string[],
  shown: boolean,
): Command | null {
  const was = graph.legend.hidden ?? []
  const next = shown
    ? was.filter((k) => !keys.includes(k))
    : [...was, ...keys.filter((k) => !was.includes(k))]
  if (next.length === was.length && next.every((k, i) => k === was[i])) return null
  return fieldCommand(graph, 'hidden', next.length ? next : undefined)
}

/** "Hide legend entry", "Hide 3 legend entries" (and Show). */
export const shownLabel = (n: number, shown: boolean): string =>
  `${shown ? 'Show' : 'Hide'} ${n === 1 ? 'legend entry' : `${n} legend entries`}`

/**
 * An entry's legend-only label (null: its own again, "Use data set name"); an empty one is no
 * label. Null when nothing changes.
 */
export function labelCommand(graph: GraphNode, key: string, runs: RichText | null): Command | null {
  const labels = { ...graph.legend.labels }
  const had = Object.hasOwn(labels, key)
  if (runs && richPlain(runs).trim()) labels[key] = mergeRuns(runs)
  else if (had) delete labels[key]
  else return null
  return fieldCommand(graph, 'labels', Object.keys(labels).length ? labels : undefined)
}

/** The grid's columns as laid out: `columns`, else one row above the plot, else one column. */
export function legendColumns(legend: LegendSpec, shown: number): number {
  return Math.max(
    1,
    Math.min(Math.max(1, shown), legend.columns ?? (legend.position === 'top' ? shown : 1)),
  )
}

/** The entries a legend shows (what its grid holds), for the columns' range. */
export const shownEntries = (items: readonly LegendItem[]): number =>
  items.filter((e) => !e.hidden).length

/** The grid's columns set (a number of columns, at every position). */
export function columnsCommand(graph: GraphNode, columns: number): Command {
  return fieldCommand(graph, 'columns', Math.max(1, Math.round(columns)))
}

/** The grid's fill (rows: across each row first, the default; columns: down each column). */
export function fillCommand(graph: GraphNode, fill: 'rows' | 'columns'): Command {
  return fieldCommand(graph, 'fill', fill === 'rows' ? undefined : fill)
}

/**
 * Reverse on or off (the Entries section's box): groups the order lists have their order reversed
 * too (reverse doesn't apply to them), so the whole legend turns over.
 */
export function reverseCommand(
  graph: GraphNode,
  items: readonly LegendItem[],
  on: boolean,
): Command {
  const listed = new Set(graph.legend.order ?? [])
  const groups = [
    ...new Set(items.filter((e) => !e.fixed && listed.has(e.key)).map((e) => e.group)),
  ]
  if (!groups.length) return fieldCommand(graph, 'reverse', on || undefined)
  let legend = withField(graph.legend, 'reverse', on || undefined)
  for (const g of groups)
    legend = {
      ...legend,
      order: orderWithGroup(
        legend,
        groupItems(items, g)
          .map((e) => e.key)
          .reverse(),
      ),
    }
  return legendCommand(graph, legend)
}

/** Where an entry's node is drawn (`Scene` coordinates): its key and its box. */
export interface EntryBox {
  key: string
  box: Box
}

/** Where a dragged entry goes: next to `target` (before it, or `after`), and the line showing it. */
export interface EntryInsertion {
  target: string
  after: boolean
  line: { x1: number; y1: number; x2: number; y2: number }
}

/**
 * Where an entry dragged to `p` goes among its group's entries as drawn (`boxes`, in the legend's
 * order, the dragged one among them), in a legend of any grid: next to the entry under the pointer
 * (else the nearest), before it in the first half of it along the way the entries run there
 * (across a row, or down a column), else after it; the line between them. Null where it is.
 */
export function entryInsertion(
  boxes: readonly EntryBox[],
  dragged: string,
  p: { x: number; y: number },
): EntryInsertion | null {
  if (boxes.length < 2) return null
  const dist = (b: Box) =>
    Math.hypot(Math.max(b.x - p.x, 0, p.x - (b.x + b.w)), Math.max(b.y - p.y, 0, p.y - (b.y + b.h)))
  let at = 0
  for (let i = 1; i < boxes.length; i++) if (dist(boxes[i]!.box) < dist(boxes[at]!.box)) at = i
  const t = boxes[at]!
  // The way the entries run at the target: towards a neighbour in the same row, across.
  const row = (o: EntryBox | undefined) =>
    !!o && Math.abs(o.box.y + o.box.h / 2 - (t.box.y + t.box.h / 2)) < t.box.h / 2
  const across = row(boxes[at + 1]) || row(boxes[at - 1])
  const after = across ? p.x >= t.box.x + t.box.w / 2 : p.y >= t.box.y + t.box.h / 2
  const own = boxes.findIndex((b) => b.key === dragged)
  // Dropped on itself, or just before the next one / after the one before: no move.
  if (t.key === dragged || (after ? at + 1 === own : at - 1 === own)) return null
  const { x, y, w, h } = t.box
  const line = across
    ? { x1: after ? x + w : x, y1: y, x2: after ? x + w : x, y2: y + h }
    : { x1: x, y1: after ? y + h : y, x2: x + w, y2: after ? y + h : y }
  return { target: t.key, after, line }
}

/**
 * What a legend entry formats in the format bar, given its scene target: its data set's identity
 * (curve's, function's), its layer (a Significance class, a result line), else the legend.
 */
export function entryFormatPath(target: StylePath | undefined): StylePath {
  return target?.[0] === 'seriesOverrides' || (target?.[0] === 'layers' && target.length === 2)
    ? target.slice(0, 2)
    : ['legend']
}

/**
 * The selection the format bar formats: legend entries replaced by what they format
 * (`entryFormatPath` of `targetOf`, their scene targets), the rest as is; the same object without
 * entries.
 */
export function barSelection(
  sel: Selection,
  targetOf: (k: SelKey) => StylePath | undefined,
): Selection {
  const entry = (k: SelKey | undefined) => !!k && k.kind !== 'item' && isLegendEntryPath(k.path)
  if (!sel.keys.some(entry)) return sel
  const as = (k: SelKey): SelKey =>
    entry(k) && k.kind !== 'item' ? { ...k, path: entryFormatPath(targetOf(k)) } : k
  const p = sel.keys[sel.primary]
  return selectionOf(sel.keys.map(as), p && as(p))
}
