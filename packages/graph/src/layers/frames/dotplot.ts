import {
  type DataTable,
  type LayerOf,
  levelAt,
  levelKey,
  normalizeDataSet,
  orderedLevels,
  primaryValues,
  sourceTable,
} from '@ps/model'
import { type DotPlotStats, dotPlotStats } from '@ps/stats'
import { continuousColor, legendValues, sizeScale } from '../../aesthetics.ts'
import { graphRows } from '../../data.ts'
import { tickFormatter } from '../../format.ts'
import { planCategoricalAxis } from '../../layout/common.ts'
import { composeGraph } from '../../layout/compose.ts'
import type { LegendEntry } from '../../layout/legend.ts'
import { symbolPaint } from '../../layout/points.ts'
import type { Scene, StylePath } from '../../scene.ts'
import type { LayerKit } from '../kit.ts'
import { colorBarEntry } from '../looks.ts'
import { cached } from '../stats/density.ts'

// Dot plots of single-cell data (roadmap 34g): variables (genes, markers) along the bottom, the
// levels of a text variable (clusters) down the left; at each crossing a dot sized by the percent
// of the level's rows "expressing" the variable (above a threshold) and coloured by its average
// (scaled per variable across the levels by default) — Seurat's `DotPlot`, the numbers from
// `@ps/stats` `dotPlotStats` (oracle suite `dotplot`). A tile layer of the same stat paints each
// crossing's average as a heat-map cell (a matrix plot) behind the dots. The matrix frame lays it
// out when its layers carry the `dotplot` stat; the variables are the graph's number data sets,
// the group variable the layers' `aes.group`.

/** The dot plot layers of a graph (their stat `dotplot`). */
export const dotPlotLayers = (kit: LayerKit) =>
  kit.graph.layers.filter((l) => l.stat.kind === 'dotplot') as (
    | LayerOf<'points'>
    | LayerOf<'tile'>
  )[]

/** Whether a graph is a dot plot (any layer with the `dotplot` stat). */
export const isDotPlot = (layers: readonly { stat: { kind: string } }[]) =>
  layers.some((l) => l.stat.kind === 'dotplot')

/** A dot plot's colours unless the graph's colour scale sets them: Seurat's light grey to blue. */
export const DOT_COLORS: [string, string] = ['#d3d3d3', '#0000ff']

/** The percent the largest dot stands for (100%: every row expressing). */
const FULL = 100

interface DotData {
  variables: { key: string; title: string }[]
  levels: string[]
  stats: DotPlotStats[]
  groupTitle: string
}

/** A dot plot's statistics per variable over the graph's rows, by level (cached per table). */
function dotData(
  kit: LayerKit,
  table: DataTable,
  layer: LayerOf<'points'> | LayerOf<'tile'>,
): DotData | null {
  const { graph } = kit
  const group = table.dataSets.find((d) => d.id === layer.aes?.group && !!d.text)
  if (!group) return null
  const include = graph.seriesSource.include
  const variables = table.dataSets
    .filter((d) => !d.text && (include === 'all' || include.includes(d.id)))
    .map((d) => ({ key: d.id as string, title: d.title || d.id }))
  const rows = graphRows(graph, table)
  const stat = layer.stat.kind === 'dotplot' ? layer.stat : { kind: 'dotplot' as const }
  const key = JSON.stringify([
    group.id,
    variables.map((v) => v.key),
    graph.levels?.[group.id] ?? null,
    graph.levelOrder ?? null,
    stat.threshold ?? 0,
    stat.average ?? 'mean',
    stat.scale ?? true,
  ])
  // Per table and rows shown (by identity, audit 2 G8), then the rest.
  return cached([table, rows ?? table], `dotplot|${key}`, () => {
    const excluded = group.subcolumns[0]?.excluded
    const level = (r: number) => (excluded?.[r] ? null : levelAt(group.text, r))
    const present: string[] = []
    const seen = new Set<string>()
    const each = (f: (r: number) => void) => {
      if (rows) for (const r of rows) f(r)
      else for (let r = 0; r < table.rowCount; r++) f(r)
    }
    each((r) => {
      const t = level(r)
      if (t !== null && !seen.has(t)) {
        seen.add(t)
        present.push(t)
      }
    })
    const levels = orderedLevels(present, graph.levels?.[group.id], graph.levelOrder)
    const at = new Map(levels.map((t, k) => [t, k]))
    const groups = new Int32Array(table.rowCount).fill(-1)
    each((r) => {
      const t = level(r)
      if (t !== null) groups[r] = at.get(t) ?? -1
    })
    const opts = {
      threshold: stat.threshold ?? 0,
      average: stat.average ?? 'mean',
      scale: stat.scale ?? true,
    }
    const stats = variables.map((v) => {
      const d = table.dataSets.find((x) => x.id === v.key)!
      return dotPlotStats(primaryValues(normalizeDataSet(table, d)), groups, levels.length, opts)
    })
    return { variables, levels, stats, groupTitle: group.title || group.id }
  })
}

/** Lays out a dot plot (see the module comment). */
export function layoutDotPlot(kit: LayerKit): Scene {
  const { ctx, graph, theme, palette, warnings } = kit
  const W = graph.size.plotWidth
  const H = graph.size.plotHeight
  const layers = dotPlotLayers(kit)
  const first = layers[0]!
  const table = sourceTable(ctx.project, graph.seriesSource.table, ctx.result)
  const data = table ? dotData(kit, table, first) : null
  if (!data) warnings.push('A dot plot needs a text variable to group the rows by.')
  else if (!data.variables.length) warnings.push('A dot plot needs number variables to show.')
  const variables = data?.variables ?? []
  const levels = data?.levels ?? []
  const nc = Math.max(variables.length, 1)
  const nr = Math.max(levels.length, 1)
  const cw = W / nc
  const ch = H / nr
  const stat = first.stat.kind === 'dotplot' ? first.stat : undefined
  const scaled = stat?.scale ?? true

  // Colours: the averages on the colour scale; sizes: the percents, by radius from 0% to 100%.
  const averages = (data?.stats ?? []).flatMap((s) => Array.from(s.average))
  const colors = continuousColor(averages, { colors: DOT_COLORS, ...graph.scales?.color })
  const fit = Math.max(1, Math.min(cw, ch) * 0.9)
  const sizer = sizeScale(
    [0, FULL],
    { by: 'radius', low: 0, high: FULL, min: 0, ...graph.scales?.size },
    {
      min: 0,
      max: fit,
    },
  )
  const target: StylePath = ['style', 'dotplot']

  for (const layer of layers) {
    if (layer.visible === false || !data) continue
    variables.forEach((v, j) => {
      if (!kit.shows(layer, v.key)) return
      const s = data.stats[j]!
      const style = kit.style(layer, v.key)
      const part = kit.part(layer, v.key, layer.geom === 'tile' ? 'cell' : 'dot')
      levels.forEach((t, i) => {
        const avg = s.average[i]!
        const pct = s.percent[i]!
        const color = colors.color(avg)
        const id = `series/${v.key}/${part}/${levelKey(t)}`
        const cellTarget = ['seriesOverrides', v.key, layer.geom === 'tile' ? 'tile' : 'points']
        if (layer.geom === 'tile') {
          const box = { x: j * cw, y: i * ch, w: cw, h: ch }
          kit.add(layer, v.key, {
            id,
            target: cellTarget,
            prim: { type: 'rect', ...box, stroke: null, fill: { color, opacity: 1 } },
            bbox: box,
          })
          return
        }
        const d = Number.isFinite(pct) ? sizer(pct) : 0
        if (!(d > 0)) return
        kit.add(layer, v.key, {
          id,
          target: cellTarget,
          prim: {
            type: 'symbol',
            shape: style.points.shape,
            cx: (j + 0.5) * cw,
            cy: (i + 0.5) * ch,
            size: d,
            ...symbolPaint(style.points, palette, color),
          },
        })
      })
    })
  }

  // --- Legend: the dots' sizes, then the averages' colour bar -----------------------------------
  const entries: LegendEntry[] = []
  const titles = graph.legend.titles ?? {}
  const heading = (k: string, label: string): LegendEntry[] =>
    label
      ? [
          {
            key: `dotplot/${k}`,
            id: `legend/dotplot/${k}`,
            target,
            label,
            sample: () => [],
            group: `dotplot/${k}`,
            fixed: true,
          },
        ]
      : []
  const dots = layers.find((l) => l.geom === 'points' && l.visible !== false)
  let sampleWidth = 14
  if (data && dots && dots.legend !== 'hide') {
    const refs = legendValues(0, FULL, 4, true)
    const fmt = tickFormatter({ mode: 'auto' }, refs)
    const style = kit.style(dots, variables[0]?.key ?? '')
    sampleWidth = Math.max(sampleWidth, ...refs.map(sizer))
    entries.push(...heading('size', titles.size ?? 'Percent expressed'))
    for (const [k, v] of refs.entries()) {
      const d = sizer(v)
      entries.push({
        key: `dotplot/size/${k}`,
        id: `legend/dotplot/size/${k}`,
        target,
        group: 'dotplot/size',
        label: `${fmt(v)
          .map((r) => r.text)
          .join('')}%`,
        height: d + 4,
        sample: (x, cy) => [
          {
            id: `legend/dotplot/size/${k}/symbol`,
            target,
            prim: {
              type: 'symbol',
              shape: style.points.shape,
              cx: x + sampleWidth / 2,
              cy,
              size: d,
              stroke: { color: '#555555', width: 0.75, dash: 'solid' },
              fill: null,
            },
          },
        ],
      })
    }
  }
  if (data && layers.some((l) => l.visible !== false && l.legend !== 'hide') && averages.length) {
    const bar = graph.scales?.color?.bar ?? {}
    entries.push(
      ...heading('color', titles.color ?? (scaled ? 'Average (scaled)' : 'Average')),
      colorBarEntry({
        ctx,
        palette,
        target,
        key: 'dotplot/color/bar',
        group: 'dotplot/color',
        scale: colors,
        ...(bar.ticks ? { ticks: bar.ticks } : {}),
        ...(bar.format ? { format: bar.format } : {}),
      }),
    )
  }

  // --- Axes: the variables along the bottom, the levels down the left ---------------------------
  const xPlan = planCategoricalAxis(
    ctx,
    theme,
    palette,
    graph.axes.x,
    variables.map((v) => v.title),
    W,
    0,
  )
  const yPlan = planCategoricalAxis(ctx, theme, palette, graph.axes.y, levels, H, 0, {
    which: 'y',
    key: 'y',
  })
  return composeGraph({
    ctx,
    theme,
    palette,
    x: xPlan,
    y: yPlan,
    layers: [{ id: 'series', children: kit.layerPlane(variables.map((v) => v.key)) }],
    legend: { entries, sampleWidth },
    warnings,
  })
}
