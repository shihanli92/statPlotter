import { seriesTitle } from '../../data.ts'
import {
  asContinuous,
  type ContinuousAxis,
  clipPolyline,
  planContinuousAxis,
  tickFit,
  valueAxis,
} from '../../layout/common.ts'
import { composeGraph } from '../../layout/compose.ts'
import {
  LEGEND_SAMPLE,
  lineSample,
  reversedEntries,
  SWATCH,
  seriesEntries,
  swatchSample,
} from '../../layout/legend.ts'
import { RISK_TABLE_GAP, riskTableBlock } from '../../layout/riskTable.ts'
import type { Scene } from '../../scene.ts'
import { resolveStroke, seriesColor } from '../../theme.ts'
import {
  drawResults,
  type ResultSeries,
  resultExtent,
  resultLegend,
  resultPlanes,
  withResultLabels,
} from '../geoms/result.ts'
import { glyphLayer } from '../glyphs.ts'
import type { LayerKit } from '../kit.ts'
import { linkedExtent } from '../links.ts'
import { kmSeries, staircase, survivalExtent } from '../stats/km.ts'

// Survival graphs: the xy frame with `km` layers — a staircase per group (step), tick marks at
// censored times (censor) and the confidence band (band, plane `bands`). Codes are the usual
// defaults (1 = event, 0 = censored).

/** Lays out a Kaplan-Meier graph. */
export function layoutSurvival(kit: LayerKit): Scene {
  const { ctx, graph, theme, palette, warnings } = kit
  const { project } = ctx
  const steps = kit.drawn('step')
  const bandLayers = kit.drawn('band', (l) => l.stat.kind === 'km')
  const censors = kit.drawn('censor')
  // Every km layer, drawn or not, for the data sets' colours and the legend's line.
  const curve = kit.all('step')[0] ?? kit.graph.layers.find((l) => l.stat.kind === 'km')!

  const series = kmSeries(project, graph, ctx.result).map((d) => {
    if (d.invalidCode > 0)
      warnings.push('Survival codes other than 1 (event) and 0 (censored) are ignored.')
    const style = kit.style(curve, d.s.key)
    return {
      s: d.s,
      style,
      color: seriesColor(style.color, palette, d.s.index),
      km: d.km,
      subjects: d.subjects,
    }
  })

  // Survival axes are linear: time from zero, percent survival from 0 to 100.
  const linear = (a: (typeof graph.axes)['x']): ContinuousAxis => ({
    ...asContinuous(a),
    scale: 'linear',
  })
  const xSpec = linear(graph.axes.x)
  const ySpec = linear(graph.axes.y)
  const results: ResultSeries[] = series.map((p) => ({
    key: p.s.key,
    title: p.s.title,
    color: p.color,
  }))
  const xe = linkedExtent(
    kit,
    'x',
    withResults(kit, survivalExtent(series, 'x'), 'x', results),
    false,
  )
  const ye = linkedExtent(
    kit,
    'y',
    withResults(kit, survivalExtent(series, 'y'), 'y', results),
    false,
  )
  const W = graph.size.plotWidth
  const H = graph.size.plotHeight
  const xFit = tickFit(ctx, theme, 'x', xSpec, W)
  const yFit = tickFit(ctx, theme, 'y', ySpec, H)
  const { dom: xDom, scale: x } = valueAxis(xSpec, xe, true, [0, W], warnings, xFit)
  const { dom: yDom, scale: y } = valueAxis(ySpec, ye, true, [H, 0], warnings, yFit)
  const pt = (t: number, v: number): [number, number] => [x(t), y(100 * v)]

  for (const p of series) {
    const key = p.s.key
    const target = ['seriesOverrides', key]
    const km = p.km
    if (!km) continue
    for (const layer of bandLayers) {
      if (!kit.shows(layer, key)) continue
      const style = kit.style(layer, key)
      const upper = staircase(km, (i) => km.steps[i]!.upper).map((q) => pt(q.t, q.v))
      const lower = staircase(km, (i) => km.steps[i]!.lower).map((q) => pt(q.t, q.v))
      const finite = (q: [number, number]) => Number.isFinite(q[0]) && Number.isFinite(q[1])
      if (upper.every(finite) && lower.every(finite)) {
        const clamp = (q: [number, number]): [number, number] => [
          Math.max(0, Math.min(W, q[0])),
          Math.max(0, Math.min(H, q[1])),
        ]
        kit.add(layer, key, {
          id: `series/${key}/${kit.part(layer, key, 'band')}`,
          target: [...target, 'band'],
          prim: {
            type: 'polygon',
            points: [...upper.map(clamp), ...lower.reverse().map(clamp)],
            fill: { color: p.color, opacity: style.band.opacity },
            stroke: null,
          },
        })
      }
    }
    for (const layer of steps) {
      if (!kit.shows(layer, key)) continue
      const pts = staircase(km, (i) => km.steps[i]!.survival).map((q) => pt(q.t, q.v))
      const stroke = resolveStroke(kit.style(layer, key).line.stroke, palette, p.color)
      clipPolyline(pts, W, H).forEach((run, k) => {
        kit.add(layer, key, {
          id: `series/${key}/${kit.part(layer, key, 'line')}/${k}`,
          target: [...target, 'line'],
          prim: { type: 'polyline', points: run, stroke },
        })
      })
    }
    for (const layer of censors) {
      if (!kit.shows(layer, key)) continue
      const style = kit.style(layer, key)
      const stroke = resolveStroke(style.points.border, palette, p.color)
      const h = style.points.size / 2
      km.steps.forEach((st, i) => {
        if (st.censored === 0) return
        const [cx, cy] = pt(st.time, st.survival)
        if (!(cx >= -0.5 && cx <= W + 0.5 && cy >= -0.5 && cy <= H + 0.5)) return
        kit.add(layer, key, {
          id: `series/${key}/${kit.part(layer, key, 'censor')}/${i}`,
          target: [...target, 'points'],
          prim: { type: 'line', x1: cx, y1: cy - h, x2: cx, y2: cy + h, stroke },
        })
      })
    }
  }

  // Labels, lines and bands of analyses' results (roadmap 35): Y in percent survival.
  drawResults({
    kit,
    U: W,
    V: H,
    W,
    H,
    u: x,
    v: y,
    scales: { x, y },
    point: (t, v) => [x(t), y(v)],
    series: results,
  })

  // --- Legend, axes ----------------------------------------------------------------------------
  const entries = [
    ...withResultLabels(
      kit,
      seriesEntries(series, (p, id, target, lx, ly) => {
        // Audit 2 (G4): with no curve drawn for the data set, its band's or censored ticks'
        // sample (`glyphLayer`); else (or with nothing drawn) the curve's line.
        const key = p.s.key
        const drawing = kit.graph.layers.filter(
          (l) => kit.data(l).from === 'table' && kit.shows(l, key),
        )
        const g = drawing.some((l) => l.geom === 'step')
          ? undefined
          : glyphLayer(drawing, ['band', 'censor'])
        if (!g)
          return [
            lineSample(id, target, resolveStroke(p.style.line.stroke, palette, p.color), lx, ly),
          ]
        const s = kit.style(g[1], key)
        // A curve's band is in the band's opacity.
        const style = { ...s, envelope: { ...s.envelope, opacity: s.band.opacity } }
        const at = lx + (LEGEND_SAMPLE - SWATCH) / 2
        return [swatchSample(id, target, g[0] as 'band', style, p.color, palette, at, ly)]
      }),
      results,
    ),
    ...resultLegend(kit, results),
  ]

  const keys = series.map((p) => p.s.key)
  const xPlan = planContinuousAxis(ctx, theme, palette, 'x', xSpec, xDom, x)
  // The number at risk under the X axis (roadmap 35), at its ticks or chosen times.
  const risk = riskTableBlock(
    ctx.fonts,
    palette,
    graph.riskTable,
    xPlan,
    series.map((p) => ({
      key: p.s.key,
      name: seriesTitle(p.s),
      color: p.color,
      subjects: p.subjects,
    })),
    W,
  )
  return composeGraph({
    ctx,
    theme,
    palette,
    x: xPlan,
    y: planContinuousAxis(ctx, theme, palette, 'y', ySpec, yDom, y),
    // By data set (v1): the bands beneath the curves (over them when moved to the top of the
    // list); by layer: the list's order.
    layers: kit.seriesMajor
      ? kit.planesAround(
          [
            { id: 'bands', layers: bandLayers, draw: (ls) => kit.plane(ls, keys) },
            ...resultPlanes(kit, keys),
          ],
          kit.inList([...steps, ...censors]),
          { id: 'series', children: kit.seriesPlane(kit.inList([...steps, ...censors]), keys) },
        )
      : [{ id: 'series', children: kit.layerPlane(keys) }],
    legend: {
      entries: reversedEntries(graph.legend, entries),
      sampleWidth: LEGEND_SAMPLE,
    },
    ...(risk ? { below: { ...risk, gap: RISK_TABLE_GAP } } : {}),
    warnings,
  })
}

/** An extent widened to an analysis' lines and bands (roadmap 35). */
function withResults(
  kit: LayerKit,
  e: ReturnType<typeof survivalExtent>,
  axis: 'x' | 'y',
  series: readonly ResultSeries[],
) {
  resultExtent(kit, axis, series, (v) => e.add(v))
  return e
}

/** A survival graph's extent along an axis (no text laid out). */
export function survivalExtentOf(kit: LayerKit, axis: 'x' | 'y') {
  const km = kmSeries(kit.ctx.project, kit.graph, kit.ctx.result)
  const results = km.map((d) => ({ key: d.s.key, title: d.s.title, color: '' }))
  return withResults(kit, survivalExtent(km, axis), axis, results)
}
