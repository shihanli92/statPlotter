import type { Geom, Layer } from '@ps/model'

// A graph's layer list as the user edits it (roadmap 33e). The document keeps layers back to
// front (`layers[0]` drawn first); every list in the UI shows them front first, as Illustrator,
// Affinity, PowerPoint and Photoshop do: the top row is the front-most layer, and "up" means
// towards the front. These are the list operations in document terms, shared by the graph
// builder, Format graph › Layers and the canvas; the UI only turns rows into indices.

type Item = Pick<Layer, 'id' | 'on'>
type Kinded = Pick<Layer, 'id' | 'on' | 'geom'>

/** A layer's rows, front first: the document's list reversed. */
export const frontFirst = <T>(layers: readonly T[]): T[] => [...layers].reverse()

/** The index in the document of the row `row` of a front-first list of `n` layers. */
export const rowToIndex = (n: number, row: number): number => n - 1 - row

/**
 * A layer and the layers attached to it just in front of it (its error bars, labels), as index
 * ranges [start, end) of the list: they move together. An attached layer elsewhere in the list
 * (error bars in front of the points over their bars) is a block of its own.
 */
export function layerBlocks(layers: readonly Item[]): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i < layers.length; i++) {
    const last = out.at(-1)
    const host = last ? layers[last[0]]! : undefined
    if (last && host && layers[i]!.on === host.id) last[1] = i + 1
    else out.push([i, i + 1])
  }
  return out
}

/** A list with every attached layer in front of its host (moved just in front of it if not). */
export function hostsFirst<L extends Item>(layers: readonly L[]): L[] {
  const out = [...layers]
  for (let changed = true; changed; ) {
    changed = false
    for (const [i, x] of out.entries()) {
      const at = x.on === undefined ? -1 : out.findIndex((h) => h.id === x.on)
      if (at > i) {
        out.splice(i, 1)
        out.splice(at, 0, x)
        changed = true
        break
      }
    }
  }
  return out
}

/**
 * The list with a layer (and the layers attached just in front of it) moved so that it takes
 * place `to` of the list as it is (0: the back); attached layers stay in front of their hosts.
 * The same list when nothing moves.
 */
export function layerMovedTo<L extends Item>(layers: readonly L[], id: string, to: number): L[] {
  const from = layers.findIndex((l) => l.id === id)
  if (from < 0 || to < 0 || to >= layers.length) return [...layers]
  const [start, end] = layerBlocks(layers).find(([s]) => s === from) ?? [from, from + 1]
  if (to >= start && to < end) return [...layers]
  const block = layers.slice(start, end)
  const rest = [...layers.slice(0, start), ...layers.slice(end)]
  // In front of the layer it lands on when moving forward, behind it when moving back.
  const at = to > from ? to - block.length + 1 : to
  rest.splice(at, 0, ...block)
  return hostsFirst(rest)
}

/**
 * The list with a layer moved one step towards the front (1) or the back (−1): past the next
 * layer and those attached just in front of it. The layers attached just in front of the moved
 * one go with it; an attached layer stays in front of its host.
 */
export function layerMovedBy<L extends Item>(layers: readonly L[], id: string, by: 1 | -1): L[] {
  const from = layers.findIndex((l) => l.id === id)
  const blocks = layerBlocks(layers)
  const b = blocks.findIndex(([s]) => s === from)
  // An attached layer inside its host's block: one step within the block.
  if (b < 0) {
    const to = from + by
    if (from < 0 || to < 0 || to >= layers.length) return [...layers]
    const out = [...layers]
    out.splice(from, 1)
    out.splice(to, 0, layers[from]!)
    return hostsFirst(out)
  }
  const next = blocks[b + by]
  if (!next) return [...layers]
  return layerMovedTo(layers, id, by > 0 ? next[1] - 1 : next[0])
}

/** Whether moving a layer one step changes the list. */
export const canMoveLayer = (layers: readonly Item[], id: string, by: 1 | -1): boolean =>
  layerMovedBy(layers, id, by).some((l, i) => l.id !== layers[i]!.id)

/**
 * Roadmap 47: the ids of the rows from `a` to `b` (either order) as a front-first list shows them,
 * both included (a Shift-click's range); empty when either is not in the list.
 */
export function layersBetween(layers: readonly Item[], a: string, b: string): string[] {
  const rows = frontFirst(layers)
  const i = rows.findIndex((l) => l.id === a)
  const j = rows.findIndex((l) => l.id === b)
  if (i < 0 || j < 0) return []
  return rows.slice(Math.min(i, j), Math.max(i, j) + 1).map((l) => l.id)
}

/** These layers' ids in the list's order (front first), those not in the list left out. */
export function frontFirstIds(layers: readonly Item[], ids: Iterable<string>): string[] {
  const chosen = new Set(ids)
  return frontFirst(layers)
    .filter((l) => chosen.has(l.id))
    .map((l) => l.id)
}

/**
 * Roadmap 47: the list with several layers moved one step towards the front (1) or the back (−1)
 * together, keeping their order: the one nearest that end first, each past the next layer (and
 * those attached just in front of it) unless that is one of them that could not move, so a block
 * stops at the end of the list and the others close up behind it. A layer's attached layers in its
 * block go with it (chosen or not); an attached layer stays in front of its host.
 */
export function layersMovedBy<L extends Item>(
  layers: readonly L[],
  ids: readonly string[],
  by: 1 | -1,
): L[] {
  const chosen = new Set(ids.filter((id) => layers.some((l) => l.id === id)))
  const index = (list: readonly L[], id: string) => list.findIndex((l) => l.id === id)
  const blocks = layerBlocks(layers)
  // A layer attached in its host's block moves with its host when that is chosen too.
  const movers = [...chosen].filter((id) => {
    const i = index(layers, id)
    const [start] = blocks.find(([s, e]) => i >= s && i < e) ?? [i]
    return start === i || !chosen.has(layers[start]!.id)
  })
  movers.sort((a, b) => (index(layers, b) - index(layers, a)) * by)
  let out = [...layers]
  for (const id of movers) {
    const i = index(out, id)
    const now = layerBlocks(out)
    const b = now.findIndex(([s]) => s === i)
    const past = b >= 0 ? now[b + by] : ([i + by, i + by + 1] as [number, number])
    if (!past || past[0] < 0 || past[1] > out.length) continue
    if (out.slice(past[0], past[1]).some((l) => chosen.has(l.id))) continue
    out = layerMovedBy(out, id, by)
  }
  return out
}

/** Whether moving these layers one step changes the list. */
export const canMoveLayers = (layers: readonly Item[], ids: readonly string[], by: 1 | -1) =>
  layersMovedBy(layers, ids, by).some((l, i) => l.id !== layers[i]!.id)

/**
 * Roadmap 47: the list with several layers dragged together onto place `to` of the list as it is
 * (0: the back) by the row of `dragged` (one of them): each with the layers attached just in front
 * of it, in their order, in front of the layer at `to` when moving forward (from where `dragged`
 * is), behind it when moving back; attached layers stay in front of their hosts. The same list
 * when `to` is one of them. One layer: as `layerMovedTo`.
 */
export function layersMovedTo<L extends Item>(
  layers: readonly L[],
  ids: readonly string[],
  dragged: string,
  to: number,
): L[] {
  const from = layers.findIndex((l) => l.id === dragged)
  const target = layers[to]
  if (from < 0 || !target) return [...layers]
  const blocks = layerBlocks(layers)
  const moving = new Set<string>()
  for (const id of new Set([...ids, dragged])) {
    const i = layers.findIndex((l) => l.id === id)
    if (i < 0) continue
    const [start, end] = blocks.find(([s]) => s === i) ?? [i, i + 1]
    for (const l of layers.slice(start, end)) moving.add(l.id)
  }
  if (moving.has(target.id)) return [...layers]
  const block = layers.filter((l) => moving.has(l.id))
  const rest = layers.filter((l) => !moving.has(l.id))
  rest.splice(rest.indexOf(target) + (to > from ? 1 : 0), 0, ...block)
  return hostsFirst(rest)
}

/**
 * What a geom draws, for where a new layer goes. Fills cover an area (bars, boxes, violins,
 * areas, bands, tiles, slices, a difference's interval and guides, a reference line across the
 * plot): added to a graph, they would hide the marks already there, so they go behind them. Marks
 * are thin or small (symbols, lines, steps, connectors, centre lines, error bars, labels,
 * censor ticks): they go on top. Every geom is one or the other (a test checks).
 */
export const GEOM_LAYER_KIND: Readonly<Record<Geom, 'fill' | 'mark'>> = {
  bar: 'fill',
  box: 'fill',
  violin: 'fill',
  area: 'fill',
  band: 'fill',
  tile: 'fill',
  wedge: 'fill',
  difference: 'fill',
  refline: 'fill',
  polygon: 'fill',
  hex: 'fill',
  raster: 'fill',
  points: 'mark',
  line: 'mark',
  step: 'mark',
  connector: 'mark',
  center: 'mark',
  errorbar: 'mark',
  label: 'mark',
  censor: 'mark',
  path: 'mark',
  segment: 'mark',
  contour: 'mark',
  // Roadmap 49c: a tree's lines, beside the map (or alone).
  dendrogram: 'mark',
}

/**
 * Where a new layer goes (adding it; moves and presets keep their own orders): attached to a
 * host, just in front of the host and the layers already attached in front of it; a fill, just
 * behind the back-most mark (in front of the fills behind it), or on top when there is no mark;
 * a mark, on top.
 */
export function newLayerIndex(layers: readonly Kinded[], layer: Kinded): number {
  const host = layer.on === undefined ? -1 : layers.findIndex((l) => l.id === layer.on)
  if (host >= 0) {
    const block = layerBlocks(layers).find(([s]) => s === host)
    return block ? block[1] : host + 1
  }
  if (GEOM_LAYER_KIND[layer.geom] === 'fill') {
    const mark = layers.findIndex((l) => GEOM_LAYER_KIND[l.geom] === 'mark')
    if (mark >= 0) return mark
  }
  return layers.length
}
