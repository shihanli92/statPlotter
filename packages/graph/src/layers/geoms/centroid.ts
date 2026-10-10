import { type LayerOf, plainText, type TextStyle } from '@ps/model'
import { mean, median } from '@ps/stats'
import { placeLabels, type RepelLabel } from '../../layout/repel.ts'
import { placeText } from '../../layout/text.ts'
import type { SceneNode } from '../../scene.ts'
import { layoutText } from '../../text/layout.ts'
import { graphText, type Theme } from '../../theme.ts'
import type { LayerKit } from '../kit.ts'
import { ownField } from '../theme.ts'
import type { OverlayAxes, OverlayGroup } from './overlay.ts'

// Labels at the groups' centres (roadmap 34e): each group's level name — a cluster's name on a
// UMAP — at the median (or mean) of its points' X and Y, from `@ps/stats`. Labels are centred
// there when the spot is free, else moved to the nearest free one by the point labels' placement
// (`placeLabels`), so they never cover each other; they cover the points (they name them).

// Audit 2 (G9): the defaults are the theme's (`Theme.centroid`).
export { CENTROID_THEME } from '../../theme.ts'

/** A group's centre in data units (median or mean of its finite X and Y), null when none. */
export function groupCentre(
  g: Pick<OverlayGroup, 'xs' | 'ys'>,
  center: 'median' | 'mean',
  ok: (x: number, y: number) => boolean,
): [number, number] | null {
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i < g.xs.length; i++)
    if (ok(g.xs[i]!, g.ys[i]!)) {
      xs.push(g.xs[i]!)
      ys.push(g.ys[i]!)
    }
  if (!xs.length) return null
  const f = center === 'mean' ? mean : median
  return [f(xs), f(ys)]
}

/** A centroid label layer's labels of the groups (plot-local), recorded under `key`. */
export function drawCentroids(
  kit: LayerKit,
  layer: LayerOf<'label'>,
  key: string,
  groups: readonly (OverlayGroup & { name: string })[],
  axes: OverlayAxes,
): void {
  if (layer.stat.kind !== 'centroid') return
  const center = layer.stat.center ?? 'median'
  const own = ownField(layer, key, 'text') as Partial<TextStyle> | undefined
  const style = graphText({ ...kit.theme.pointLabel, ...kit.theme.centroid.text }, kit.graph, own)
  const background =
    (ownField(layer, key, 'background') as Theme['centroid']['background'] | undefined) ??
    kit.theme.centroid.background
  const fonts = kit.ctx.fonts
  const part = kit.part(layer, key, 'centroid')
  const target = ['seriesOverrides', key, 'label']
  const pad = background === 'box' ? kit.theme.centroid.box.pad : 0
  const shown: { g: OverlayGroup & { name: string }; k: number; label: RepelLabel }[] = []
  groups.forEach((g, k) => {
    const c = groupCentre(g, center, axes.ok)
    if (!c || !g.name) return
    const [px, py] = [axes.x(c[0]), axes.y(c[1])]
    if (!(px >= 0 && px <= axes.W && py >= 0 && py <= axes.H)) return
    const t = layoutText(fonts, plainText(g.name), style)
    const w = t.width + 2 * pad
    const h = t.ascent + t.descent + 2 * pad
    shown.push({ g, k, label: { x: px, y: py, r: 0, w, h, centre: true } })
  })
  const placed = placeLabels(
    shown.map((s) => s.label),
    [],
    { width: axes.W, height: axes.H },
  )
  shown.forEach(({ g, k }, i) => {
    const box = placed[i]!.box
    const id = `series/${key}/${part}/${k}`
    const t = placeText(
      fonts,
      id,
      plainText(g.name),
      style,
      kit.palette,
      box.x + pad,
      box.y + pad,
      'start',
      'top',
      {
        target,
      },
    )
    const nodes: SceneNode[] = []
    if (background === 'box') {
      const b = kit.theme.centroid.box
      nodes.push({
        id: `${id}/box`,
        target,
        prim: {
          type: 'rect',
          ...box,
          fill: { color: b.fill, opacity: b.opacity },
          stroke: { color: b.border, width: 0.5, dash: 'solid' },
          rx: 2,
        },
      })
    }
    const text =
      background === 'halo' && t.node.prim?.type === 'text'
        ? { ...t.node, prim: { ...t.node.prim, halo: kit.theme.centroid.halo } }
        : t.node
    nodes.push(text)
    kit.addList(layer, key, nodes)
  })
}
