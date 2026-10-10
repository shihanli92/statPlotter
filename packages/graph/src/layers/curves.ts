import type { GraphableDataSet, OutputSeries } from '@ps/model'
import { levelKey } from '@ps/model'
import type { ValueAxis } from '../layout/common.ts'
import type { PointLabelLayer } from '../layout/pointLabels.ts'
import { seriesColor } from '../theme.ts'
import type { LayerKit } from './kit.ts'

// Analysis outputs drawn as curves (fits, bands, points) on graphs with continuous axes: the xy
// frame's and (roadmap 34c) a graph of variables' (a biplot's vectors). Shared by both frames and
// by the geoms that draw them (audit 2, G12: no frame imports another).

/** A Y axis' mappings, with whether an (x, y) point can be drawn. */
export type XYAxis = Omit<ValueAxis, 'ok'> & { ok: (vx: number, vy: number) => boolean }

/** An analysis output or function as the geoms draw it. */
export interface XYCurve {
  /** Its id (the key of its identity and per-layer styles) and position among its kind. */
  id: string
  index: number
  data: GraphableDataSet
  color: string
  /** Drawn in a data set's colour (the legend then shows it with that data set). */
  matched: boolean
  right: boolean
}

/** What outputs and functions are drawn with. */
export interface XYCurveCtx {
  kit: LayerKit
  x: (v: number) => number
  left: XYAxis
  right: XYAxis
  W: number
  H: number
  inside: (px: number, py: number) => boolean
  /** Output points go to the label layer directly (they are not data-set points). */
  pointLabels: PointLabelLayer
}

/** Every output the graph's layers draw, in order (`index` as v1's extra series index). */
export function outputsOf(kit: LayerKit): OutputSeries[] {
  return kit.graph.layers.flatMap((l) => (l.data?.from === 'outputs' ? l.data.series : []))
}

/**
 * The analysis outputs a graph's layers draw (their colours after `count` data sets', or a data
 * set's when they follow one): an xy graph's, and (roadmap 34c) a graph of variables' (a biplot's
 * vectors over its scores).
 */
export function outputCurves(
  kit: LayerKit,
  count: number,
  colorOfKey: ReadonlyMap<string, string> = new Map(),
  /** Roadmap 35: the colour of a group an output was fitted to (`GraphableDataSet.group`). */
  groupColor?: (group: string) => string | undefined,
): XYCurve[] {
  const { graph, palette } = kit
  const { result } = kit.ctx
  const y2 = !!graph.axes.y2
  const outputs = outputsOf(kit)
  const curves: XYCurve[] = []
  outputs.forEach((e, index) => {
    const data = result?.(e.ref.node)?.outputs[e.ref.key]
    if (!data) return
    const id = kit.identity(e.id, true)
    const matchedColor = e.colorOf
      ? colorOfKey.get(e.colorOf)
      : data.group !== undefined
        ? groupColor?.(data.group)
        : undefined
    const color =
      'series' in id.color && matchedColor
        ? matchedColor
        : seriesColor(id.color, palette, count + index)
    const own = graph.seriesOverrides[e.id]?.yAxis
    const right =
      y2 &&
      (own ? own === 'right' : e.colorOf !== undefined && kit.identity(e.colorOf).yAxis === 'right')
    curves.push({ id: e.id, index, data, color, matched: !!matchedColor, right })
  })
  return curves
}

/** The analyses' fitted curves on the graph, for drop lines and labels at their ends. */
export function curveSources(kit: LayerKit, curves: readonly XYCurve[]) {
  const outputs = outputsOf(kit)
  return curves.flatMap((c) => {
    const o = outputs.find((e) => e.id === c.id)
    return o
      ? [
          {
            node: o.ref.node,
            ...(o.colorOf !== undefined
              ? { colorOf: o.colorOf }
              : c.data.group !== undefined
                ? { colorOf: levelKey(c.data.group) }
                : {}),
            data: c.data,
            color: c.color,
          },
        ]
      : []
  })
}
