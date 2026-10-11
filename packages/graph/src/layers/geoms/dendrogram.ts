import type { ColorRef, DendrogramStyle, LayerOf, StrokeStyle } from '@ps/model'
import { cutCount, cutree, type HClust } from '@ps/stats'
import { type LegendEntry, SWATCH, swatchRect } from '../../layout/legend.ts'
import type { SceneNode, Stroke, StylePath } from '../../scene.ts'
import { resolveStroke, seriesColor, type Theme } from '../../theme.ts'

// Dendrograms (roadmap 49c): a hierarchical clustering's tree as a layer of its own — beside a
// heat map (its leaves at the cells) or alone — drawn as R's plot.hclust draws it: one ⊓ per merge
// from its two branches up to the merge's height (R's merge heights, or equal steps), cut into
// clusters (R's cutree) with the branches below the cut in their cluster's colour and a strip of
// each leaf's cluster. Positions here are along the leaves (slots, 0-based in the tree's order)
// and up the tree (heights 0–1 of the tallest); the frame places them.

/** A tree's look and place, every field resolved (`DendrogramStyle` over the theme's). */
export interface ResolvedTree {
  depth: number
  gap: number
  side: 'left' | 'right' | 'top' | 'bottom'
  heights: 'merge' | 'steps'
  line: StrokeStyle
  colorBranches: boolean
  strip: boolean
  stripWidth: number
  clusterColors: Readonly<Record<string, ColorRef>>
}

/** A tree layer's style over the theme's defaults (`Theme.dendrogram`). */
export function treeStyle(layer: Pick<LayerOf<'dendrogram'>, 'style'>, theme: Theme): ResolvedTree {
  const s: DendrogramStyle = layer.style ?? {}
  const d = theme.dendrogram
  return {
    depth: s.depth ?? d.depth,
    gap: s.gap ?? d.gap,
    side: s.side ?? 'right',
    heights: s.heights ?? 'merge',
    line: s.line ?? d.line,
    colorBranches: s.colorBranches ?? true,
    strip: s.strip ?? false,
    stripWidth: s.stripWidth ?? d.stripWidth,
    clusterColors: s.clusterColors ?? {},
  }
}

/** Space between a cluster strip and the tree (or, alone, the leaves' names). */
export const STRIP_GAP = 2

/** A strip's band at a leaf's slot, overlapping the next a little so no seam shows. */
export const stripBand = (slot: number, size: number, count: number) => ({
  from: slot * size,
  len: size + (slot < count - 1 ? Math.min(0.5, size / 4) : 0),
})

/**
 * Each merge's height as drawn: R's merge height, or (equal steps) one step above the higher of
 * its two branches (a leaf at 0), so every merge stands a step over what it joins.
 */
export function treeHeights(
  hc: Pick<HClust, 'merge' | 'height'>,
  mode: 'merge' | 'steps',
): number[] {
  if (mode === 'merge') return [...hc.height]
  const out: number[] = []
  const of = (c: number) => (c < 0 ? 0 : out[c - 1]!)
  for (const [a, b] of hc.merge) out.push(1 + Math.max(of(a), of(b)))
  return out
}

/**
 * Roadmap 49c: a cut tree's clusters — each leaf's (R's cutree numbers, by row or column index),
 * how many there are, and each merge's: its cluster when every leaf under it is in one, else 0
 * (above the cut). Null for an uncut tree. A k beyond the leaves cuts them all apart (with a
 * warning).
 */
export interface TreeClusters {
  leaves: number[]
  count: number
  merges: number[]
}

export function treeClusters(
  hc: HClust,
  cut: LayerOf<'dendrogram'>['stat']['cut'],
  warnings: string[],
): TreeClusters | null {
  const n = hc.order.length
  if (!cut || n < 1) return null
  let c = cut
  if ('k' in c && c.k > n) {
    warnings.push(`The tree has ${n} leaves: cut into ${n} clusters.`)
    c = { k: n }
  }
  const leaves = cutree(hc, c)
  const merges: number[] = []
  const of = (x: number) => (x < 0 ? leaves[-x - 1]! : merges[x - 1]!)
  for (const [a, b] of hc.merge) {
    const ca = of(a)
    merges.push(ca !== 0 && ca === of(b) ? ca : 0)
  }
  return { leaves, count: cutCount(hc, c), merges }
}

/** A cluster's colour (number 1…): its own, else the palette's in turn. */
export function clusterColor(tree: ResolvedTree, palette: readonly string[], cluster: number) {
  return seriesColor(tree.clusterColors[String(cluster)] ?? { series: true }, palette, cluster - 1)
}

/** A line of a tree: [position along the leaves, height 0–1] points, its cluster (0: none). */
export interface TreeLine {
  points: [number, number][]
  cluster: number
}

/**
 * A tree's lines, merge by merge: one ⊓ from each branch (leaves at their slot in `hc.order`,
 * merges at the middle of their branches, as R's plot.hclust) up to the merge's height, `top`
 * the tallest; with clusters, a merge whose branches' colours differ from its own is three lines
 * (each branch, then the bar across in its own).
 */
export function treeLines(
  hc: HClust,
  heights: readonly number[],
  clusters: TreeClusters | null,
): TreeLine[][] {
  const n = hc.order.length
  const slot = new Array<number>(n)
  hc.order.forEach((leaf, i) => {
    slot[leaf] = i
  })
  const top = heights.reduce((m, h) => Math.max(m, h), 0) || 1
  const pos: number[] = []
  const at = (c: number): [number, number] =>
    c < 0 ? [slot[-c - 1]!, 0] : [pos[c - 1]!, heights[c - 1]! / top]
  const color = (c: number) =>
    clusters ? (c < 0 ? clusters.leaves[-c - 1]! : clusters.merges[c - 1]!) : 0
  return hc.merge.map(([a, b], k) => {
    const [pa, ha] = at(a)
    const [pb, hb] = at(b)
    const h = heights[k]! / top
    pos.push((pa + pb) / 2)
    const own = clusters ? clusters.merges[k]! : 0
    const [ca, cb] = [color(a), color(b)]
    if (ca === own && cb === own)
      return [
        {
          points: [
            [pa, ha],
            [pa, h],
            [pb, h],
            [pb, hb],
          ],
          cluster: own,
        },
      ]
    return [
      {
        points: [
          [pa, ha],
          [pa, h],
        ],
        cluster: ca,
      },
      {
        points: [
          [pa, h],
          [pb, h],
        ],
        cluster: own,
      },
      {
        points: [
          [pb, h],
          [pb, hb],
        ],
        cluster: cb,
      },
    ]
  })
}

/**
 * A tree's scene nodes: a polyline per merge (`<id>/<k>`; a merge of several colours a group of
 * its three lines `<id>/<k>/a|bar|b`) placed by `place(position, height)`, in the line's stroke or
 * (cut, branches coloured) its cluster's colour.
 */
export function treeNodes(o: {
  hc: HClust
  tree: ResolvedTree
  clusters: TreeClusters | null
  palette: readonly string[]
  id: string
  target: StylePath
  place: (pos: number, height: number) => [number, number]
}): SceneNode[] {
  const { hc, tree, palette, id, target, place } = o
  const clusters = tree.colorBranches ? o.clusters : null
  const line = resolveStroke(tree.line, palette)
  const stroke = (c: number): Stroke =>
    c ? { ...line, color: clusterColor(tree, palette, c) } : line
  const parts = ['a', 'bar', 'b']
  return treeLines(hc, treeHeights(hc, tree.heights), clusters).map((lines, k) => {
    const polyline = (l: TreeLine, nid: string): SceneNode => ({
      id: nid,
      target,
      prim: {
        type: 'polyline',
        points: l.points.map(([p, h]) => place(p, h)),
        stroke: stroke(l.cluster),
      },
    })
    return lines.length === 1
      ? polyline(lines[0]!, `${id}/${k}`)
      : {
          id: `${id}/${k}`,
          target,
          children: lines.map((l, i) => polyline(l, `${id}/${k}/${parts[i]}`)),
        }
  })
}

/**
 * A cut tree's strip: a band of each leaf's cluster colour (`<id>/strip/<slot>`), `rect(slot)` its
 * box at a leaf's slot (in the tree's order).
 */
export function stripNodes(o: {
  hc: HClust
  tree: ResolvedTree
  clusters: TreeClusters | null
  palette: readonly string[]
  id: string
  target: StylePath
  rect: (slot: number) => { x: number; y: number; w: number; h: number }
}): SceneNode[] {
  const { hc, tree, clusters, palette, id, target, rect } = o
  if (!tree.strip || !clusters) return []
  return hc.order.map((leaf, i) => {
    const box = rect(i)
    return {
      id: `${id}/strip/${i}`,
      target,
      prim: {
        type: 'rect',
        ...box,
        stroke: null,
        fill: { color: clusterColor(tree, palette, clusters.leaves[leaf]!), opacity: 1 },
      },
      bbox: box,
    }
  })
}

/**
 * Roadmap 49c: a cut tree's clusters in the legend — an entry per cluster ("Cluster 1"…; "Row
 * cluster 1"… when both trees are cut), its sample a swatch of the strip's colour (a strip drawn)
 * or a short line in the branches' colour, keyed `@<layer>/<n>`, a group per tree. Not for a layer
 * whose legend entry is hidden.
 */
export function treeLegend(
  kit: { palette: readonly string[] },
  trees: readonly {
    layer: LayerOf<'dendrogram'>
    tree: ResolvedTree
    clusters: TreeClusters | null
  }[],
): LegendEntry[] {
  const cut = trees.filter((t) => t.clusters && t.layer.legend !== 'hide')
  const both = cut.length > 1
  return cut.flatMap((t) => {
    const target: StylePath = ['layers', t.layer.id]
    const name = t.layer.stat.of === 'rows' ? 'Row cluster' : 'Column cluster'
    const line = resolveStroke(t.tree.line, kit.palette)
    return Array.from({ length: t.clusters!.count }, (_, i): LegendEntry => {
      const c = i + 1
      const id = `legend/tree/${t.layer.id}/${c}`
      const color = clusterColor(t.tree, kit.palette, c)
      return {
        key: `@${t.layer.id}/${c}`,
        id,
        target,
        group: `@${t.layer.id}`,
        label: both ? `${name} ${c}` : `Cluster ${c}`,
        sample: (x, cy) => [
          t.tree.strip
            ? {
                id: `${id}/swatch`,
                target,
                prim: {
                  type: 'rect',
                  ...swatchRect(x, cy),
                  stroke: null,
                  fill: { color, opacity: 1 },
                },
              }
            : {
                id: `${id}/line`,
                target,
                prim: {
                  type: 'line',
                  x1: x,
                  y1: cy,
                  x2: x + SWATCH,
                  y2: cy,
                  stroke: { ...line, color, width: Math.max(line.width, 1.5) },
                },
              },
        ],
      }
    })
  })
}
