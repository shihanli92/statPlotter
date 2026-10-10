import { categoryEntryKey, type Layer, pointKey } from '@ps/model'
import { seriesTitle } from '../../data.ts'
import {
  asContinuous,
  continuousDomain,
  Extent,
  planCategoricalAxis,
  planContinuousAxis,
  tickFit,
  unionBoxes,
} from '../../layout/common.ts'
import { composeGraph } from '../../layout/compose.ts'
import { type LegendEntry, reversedEntries, SWATCH, swatchRect } from '../../layout/legend.ts'
import { pointOverride } from '../../layout/points.ts'
import { placeText } from '../../layout/text.ts'
import { makeAxisScale } from '../../scale.ts'
import type { Box, Scene, SceneNode } from '../../scene.ts'
import {
  graphText,
  type ResolvedSeriesStyle,
  resolveColor,
  resolveFill,
  resolveStroke,
} from '../../theme.ts'
import { contrast, partLabel, polar, type ResolvedPieStyle, wedgePoints } from '../geoms/wedge.ts'
import type { LayerKit } from '../kit.ts'
import { type Part, type PartsOf, partsOf } from '../stats/fraction.ts'
import { polarStyle } from '../theme.ts'

// Parts of whole: each data set is a whole, its rows the parts (categories), drawn as wedges on
// the polar frame (a pie or donut per data set) or as a `fraction` bar stack on the category
// frame (100% stacked bars). A part's colour follows its category (the palette by row), the same
// in every whole; single slices are formatted through `pointOverrides` under the row key.

/** Lays out pies and donuts (the polar frame) or 100% stacked bars (`bars`). */
export function layoutParts(kit: LayerKit, bars: boolean): Scene {
  const { ctx, graph, theme, palette, warnings } = kit
  const host: Layer | undefined = bars
    ? kit.drawn('bar', (l) => l.stat.kind === 'fraction')[0]
    : kit.drawn('wedge')[0]
  const labelLayer = kit.all('label', (l) => host !== undefined && l.on === host.id)[0]
  const labelsShown = !!labelLayer && labelLayer.visible !== false
  const ls = labelLayer?.style ?? {}
  const parts = partsOf(ctx.project, graph, ctx.result, warnings)
  const wholes = host ? parts.wholes.filter((w) => kit.shows(host, w.s.key)) : []
  const { categories } = parts
  const styleOf = (w: PartsOf): ResolvedSeriesStyle => kit.style(host!, w.s.key)
  const pie: ResolvedPieStyle = {
    ...polarStyle(graph, kit.theme),
    labels: labelsShown ? (ls.content ?? 'percent') : 'none',
    labelPosition: ls.position === 'outside' ? 'outside' : 'inside',
    digits: ls.digits ?? 0,
  }
  const W = graph.size.plotWidth
  const H = graph.size.plotHeight
  const labelStyle = graphText(theme.tickLabel, graph)

  /** A part's colour and fill/border, with its own format applied. */
  const partStyle = (w: PartsOf, p: Part) => {
    const own = pointOverride(graph, w.s.key, pointKey(p.row))
    const base = palette[p.category % palette.length]!
    const color = own?.color ? resolveColor(own.color, palette, base) : base
    const style = styleOf(w)
    return {
      own,
      color,
      fill: resolveFill(own?.bar?.fill ?? style.bar.fill, palette, color),
      stroke: resolveStroke(own?.bar?.border ?? style.bar.border, palette, color),
    }
  }

  const reach: (Box | null)[] = []
  const n = Math.max(wholes.length, 1)
  /** Pie titles (several pies), after their slices and labels. */
  const titles = new Map<string, SceneNode>()
  /** 100% bars drawn by data set: each segment followed by its label. */
  const segments = new Map<string, SceneNode[]>()

  // --- Pies and donuts ------------------------------------------------------------------------
  let xPlan = planCategoricalAxis(ctx, theme, palette, { ...graph.axes.x, show: false }, [], W, 0)
  const yFlat = makeAxisScale('linear', [0, 1], [H, 0])
  let yPlan = planContinuousAxis(
    ctx,
    theme,
    palette,
    'y',
    { ...asContinuous(graph.axes.y), show: false },
    { min: 0, max: 1, ticks: [], minorTicks: [] },
    yFlat,
  )
  if (!bars && host) {
    const cell = W / n
    const outside = pie.labelPosition === 'outside' && pie.labels !== 'none'
    const titled = wholes.length > 1
    const titleRoom = titled ? labelStyle.size * 1.6 : 0
    // Exploded slices move out by a fraction of the radius: the pies shrink to keep them inside.
    const explode = Math.max(
      0,
      ...wholes.flatMap((w) =>
        w.parts.map((p) => pointOverride(graph, w.s.key, pointKey(p.row))?.explode ?? 0),
      ),
    )
    const R = Math.max(
      4,
      ((Math.min(cell, H - titleRoom) / 2) * (outside ? 0.72 : 0.96)) / (1 + explode),
    )
    wholes.forEach((w, i) => {
      const key = w.s.key
      const target = ['seriesOverrides', key]
      const cx = (i + 0.5) * cell
      const cy = (H - titleRoom) / 2
      let at = pie.startAngle
      const dir = pie.clockwise ? 1 : -1
      for (const p of w.parts) {
        const sweep = 360 * p.fraction
        const [a0, a1] = dir > 0 ? [at, at + sweep] : [at - sweep, at]
        at += dir * sweep
        if (sweep <= 0) continue
        const { own, color, fill, stroke } = partStyle(w, p)
        if (own?.hide) continue
        const mid = (a0 + a1) / 2
        const [ox, oy] = polar(0, 0, (own?.explode ?? 0) * R, mid)
        const points = wedgePoints(cx + ox, cy + oy, R, pie.hole * R, a0, a1)
        const pk = pointKey(p.row)
        kit.add(host, key, {
          id: `series/${key}/${kit.part(host, key, 'slice')}/${p.row}`,
          target: [...target, 'bar'],
          point: pk,
          prim: { type: 'polygon', points, fill: fill ?? { color, opacity: 0 }, stroke },
        })
        const content = partLabel(p, pie)
        if (content && labelLayer) {
          const inside = pie.labelPosition === 'inside'
          const rr = inside ? (pie.hole > 0 ? (1 + pie.hole) / 2 : 0.62) * R : R + 6
          const [lx, ly] = polar(cx + ox, cy + oy, rr, mid)
          const h = inside
            ? 'middle'
            : lx > cx + ox + 1
              ? 'start'
              : lx < cx + ox - 1
                ? 'end'
                : 'middle'
          const style = inside
            ? { ...labelStyle, color: { rgb: contrast(fill ? color : '#ffffff') } }
            : labelStyle
          const t = placeText(
            ctx.fonts,
            `series/${key}/${kit.part(labelLayer, key, 'sliceLabel')}/${p.row}`,
            content,
            style,
            palette,
            lx,
            ly,
            h,
            'middle',
            {
              target: ['style', 'pie'],
            },
          )
          // Inside labels only where they fit across the slice (tiny slices go unlabelled).
          const chord = 2 * rr * Math.sin((Math.min(sweep, 180) * Math.PI) / 360)
          const fits = !inside || sweep >= 180 || Math.max(t.bbox.w, t.bbox.h) <= chord
          if (fits) kit.add(labelLayer, key, { ...t.node, point: pk })
          if (fits) reach.push(t.bbox)
        }
      }
      if (titled) {
        const t = placeText(
          ctx.fonts,
          `series/${key}/title`,
          seriesTitle(w.s),
          labelStyle,
          palette,
          cx,
          H - titleRoom / 2,
          'middle',
          'middle',
          { target },
        )
        titles.set(key, t.node)
        reach.push(t.bbox)
      }
    })
  }

  // --- 100% stacked bars ------------------------------------------------------------------------
  if (bars && host) {
    const ySpec = asContinuous(graph.axes.y)
    const extent = new Extent(false)
    extent.add(0)
    extent.add(100)
    const linear = { ...ySpec, scale: 'linear' } as const
    const dom = continuousDomain(
      linear,
      extent,
      true,
      warnings,
      tickFit(ctx, theme, 'y', linear, H),
    )
    if (ySpec.scale !== 'linear') warnings.push('Stacked percentages need a linear Y axis.')
    const y = makeAxisScale('linear', [dom.min, dom.max], [H, 0], { reverse: ySpec.reverse })
    const yEnd = (v: number) => Math.max(0, Math.min(H, y(v)))
    const band = W / n
    wholes.forEach((w, i) => {
      const key = w.s.key
      const target = ['seriesOverrides', key]
      const x0 = (i + 0.5) * band
      const bw = styleOf(w).bar.width * band
      const children: SceneNode[] = []
      let base = 0
      for (const p of w.parts) {
        const top = base + p.fraction * 100
        const { own, color, fill, stroke } = partStyle(w, p)
        const [y0, y1] = [yEnd(base), yEnd(top)]
        base = top
        if (own?.hide || p.fraction <= 0) continue
        const box = { x: x0 - bw / 2, y: Math.min(y0, y1), w: bw, h: Math.abs(y0 - y1) }
        const cell = pointKey(p.row)
        const segment: SceneNode = {
          id: `series/${key}/${kit.part(host, key, 'slice')}/${p.row}`,
          target: [...target, 'bar'],
          point: cell,
          prim: { type: 'rect', ...box, fill, stroke },
          bbox: box,
        }
        kit.add(host, key, segment)
        children.push(segment)
        const content = partLabel(p, pie)
        if (content && labelLayer) {
          const t = placeText(
            ctx.fonts,
            `series/${key}/${kit.part(labelLayer, key, 'sliceLabel')}/${p.row}`,
            content,
            { ...labelStyle, color: { rgb: contrast(fill ? color : '#ffffff') } },
            palette,
            x0,
            box.y + box.h / 2,
            'middle',
            'middle',
            { target: ['style', 'pie'] },
          )
          // Only where the label fits inside its segment.
          if (t.bbox.h <= box.h && t.bbox.w <= bw) {
            const label = { ...t.node, point: cell }
            kit.add(labelLayer, key, label)
            children.push(label)
          }
        }
      }
      segments.set(key, children)
    })
    // Planned as the linear axis it is drawn on (a log spec over 0–100 would label 10^−∞).
    yPlan = planContinuousAxis(ctx, theme, palette, 'y', { ...ySpec, scale: 'linear' }, dom, y)
    xPlan = planCategoricalAxis(
      ctx,
      theme,
      palette,
      graph.axes.x,
      wholes.map((w) => seriesTitle(w.s)),
      W,
      0,
    )
  }

  // --- Legend: the categories ---------------------------------------------------------------------
  const first = wholes[0]
  const entries: LegendEntry[] = categories.map((c, k) => {
    const key = categoryEntryKey(c.row)
    const id = `legend/${key}`
    return {
      key,
      id,
      target: ['style', 'pie'],
      label: c.rich,
      sample: (x, cy) => {
        const color = palette[k % palette.length]!
        const style = first && styleOf(first).bar
        return [
          {
            id: `${id}/swatch`,
            target: ['style', 'pie'],
            prim: {
              type: 'rect',
              ...swatchRect(x, cy),
              stroke: style
                ? resolveStroke({ ...style.border, width: 0.5, color: { rgb: '#808080' } }, palette)
                : null,
              fill: style ? resolveFill(style.fill, palette, color) : { color, opacity: 1 },
            },
          },
        ]
      },
    }
  })

  const keys = wholes.map((w) => w.s.key)
  // In the list's order (drawing by layer: labels the user moved behind the slices go there).
  const planeLayers = kit.inList([host, labelLayer].filter((l) => l !== undefined) as Layer[])
  // 100% bars drawn by data set (v1): each segment followed by its label, unless the data set's
  // own order puts its labels behind the bars.
  const labelsBehind = (k: string) => {
    const order = kit.orderOf(k, planeLayers)
    return !!labelLayer && order.indexOf(labelLayer) < order.indexOf(host!)
  }
  const marks =
    bars && kit.seriesMajor
      ? keys.map((k) => ({
          id: `series/${k}`,
          target: ['seriesOverrides', k],
          children: labelsBehind(k)
            ? kit.orderOf(k, planeLayers).flatMap((l) => kit.nodes(l, k))
            : (segments.get(k) ?? []),
        }))
      : kit.seriesPlane(planeLayers, keys, (k) => {
          const t = titles.get(k)
          return t ? [t] : []
        })
  return composeGraph({
    ctx,
    theme,
    palette,
    x: xPlan,
    y: yPlan,
    layers: [{ id: 'series', children: marks }],
    legend: {
      entries: reversedEntries(graph.legend, entries),
      sampleWidth: SWATCH,
    },
    reach: unionBoxes(reach),
    warnings,
  })
}
