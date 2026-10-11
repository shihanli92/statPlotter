import type { MigrationNote } from './v1to2.ts'

// Schema v2 → v3 (roadmap 49c, decision 1242): a heat map's dendrograms become layers of
// their own. In v2 the tile layer's `style.cluster` both ordered the cells (`rows`, `columns`,
// `distance`, `linkage`) and drew a tree beside the map for each clustered axis, `dendrogram`
// points deep; in v3 the tile keeps what orders its cells and each tree is a `dendrogram` layer
// (stat `cluster` of the rows or the columns), its depth in its own style. A graph migrated draws
// exactly what it drew (the trees' marks and scene ids unchanged). FROZEN once released: never
// edit this file (add the next migration). It depends on nothing that may change: it works on raw
// JSON and names every field it reads.

type RawProject = Record<string, unknown>
type Raw = Record<string, unknown>

/** The most layers a graph has (v3's `MAX_LAYERS`). */
const MAX_LAYERS = 32

const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A layer id like `base` not among `taken` (`rowTree`, `rowTree2`…). */
function freshId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base
  for (let i = 2; ; i++) if (!taken.has(`${base}${i}`)) return `${base}${i}`
}

/** A tile layer without v2's `cluster.dendrogram` (empty objects dropped). */
function withoutDepth(layer: Raw): Raw {
  const style = layer.style
  if (!isObject(style) || !isObject(style.cluster) || !('dendrogram' in style.cluster)) return layer
  const { dendrogram: _, ...cluster } = style.cluster
  const { cluster: _c, ...rest } = style
  const nextStyle = Object.keys(cluster).length ? { ...rest, cluster } : rest
  const { style: _s, ...bare } = layer
  return Object.keys(nextStyle).length ? { ...bare, style: nextStyle } : bare
}

/**
 * A v2 layer list (back to front) as v3 holds it: the tiles without `cluster.dendrogram`, and a
 * tree layer for each axis the heat map's tile clusters — the tile v2 drew from (the first one
 * drawn, else the first one), unless the graph is a dot plot (which drew no trees) — added at the
 * front, the rows' then the columns', hidden when that tile is hidden (v2 drew no trees then),
 * each `depth` the tile's `dendrogram` when it had one. Shared with the user presets' reader
 * (`readPreset`: preset files of version 1 hold v2 layers).
 */
export function treesAsLayers(layers: readonly unknown[], frame: unknown): unknown[] {
  const out = layers.map((l) => (isObject(l) && l.geom === 'tile' ? withoutDepth(l) : l))
  if (frame !== 'matrix') return out
  const all = layers.filter(isObject)
  if (all.some((l) => isObject(l.stat) && l.stat.kind === 'dotplot')) return out
  const tiles = all.filter((l) => l.geom === 'tile')
  const owner = tiles.find((l) => l.visible !== false) ?? tiles[0]
  const style = owner && isObject(owner.style) ? owner.style : undefined
  const cluster = style && isObject(style.cluster) ? style.cluster : undefined
  if (!owner || !cluster) return out
  const depth = typeof cluster.dendrogram === 'number' ? cluster.dendrogram : undefined
  const taken = new Set(all.map((l) => String(l.id)))
  const hidden = owner.visible === false
  for (const [axis, base] of [
    ['rows', 'rowTree'],
    ['columns', 'columnTree'],
  ] as const) {
    if (cluster[axis] !== true || out.length >= MAX_LAYERS) continue
    const id = freshId(base, taken)
    taken.add(id)
    out.push({
      id,
      geom: 'dendrogram',
      stat: { kind: 'cluster', of: axis },
      ...(depth !== undefined ? { style: { depth } } : {}),
      ...(hidden ? { visible: false } : {}),
    })
  }
  return out
}

/**
 * The v2 → v3 migration of a raw project: every graph's layers through `treesAsLayers`. Nothing
 * drawn changes, so there are no notes.
 */
export function v2to3(raw: RawProject, _notes: MigrationNote[] = []): RawProject {
  const nodes = raw.nodes
  if (!isObject(nodes)) return raw
  // Null prototype, as the file reader builds it: an id like `constructor` is an ordinary key.
  const out: Record<string, unknown> = Object.create(null)
  for (const id of Object.keys(nodes)) {
    const node = nodes[id]
    out[id] =
      isObject(node) && node.kind === 'graph' && Array.isArray(node.layers)
        ? { ...node, layers: treesAsLayers(node.layers, node.frame) }
        : node
  }
  return { ...raw, nodes: out }
}
