import type { RichText, RiskTable } from '@ps/model'
import { numberAtRisk, type SurvivalSubject } from '@ps/stats'
import type { Box, SceneNode, StylePath } from '../scene.ts'
import { layoutText } from '../text/layout.ts'
import { resolveText } from '../theme.ts'
import { type AxisPlan, unionBoxes } from './common.ts'
import { placeText } from './text.ts'

// The number at risk under a Kaplan-Meier graph (roadmap 35): one row per group in the group's
// colour, its name before it, the counts at the X axis' major ticks (or at chosen times) centred
// under them, a heading above. Counts from `@ps/stats` `numberAtRisk` (oracle suite `atrisk`). The
// table is part of the graph: it follows the axis' range and ticks, and the graph grows to hold it.

/** A group's row: its key, name, colour and subjects. */
export interface RiskRow {
  key: string
  name: RichText
  color: string
  subjects: readonly SurvivalSubject[]
}

/** Space between the names and the plot's left edge, and between rows. */
const NAME_GAP = 6
const ROW_GAP = 2
/** The table's distance below the X axis (its labels and title). */
export const RISK_TABLE_GAP = 10

/** The heading's default text. */
export const RISK_TABLE_TITLE = 'Number at risk'

/** A tick's value, rounded off the position's floating-point noise. */
const tickValue = (x: AxisPlan, pos: number) => Number(x.fromPx(pos).toPrecision(12))

/**
 * The table's nodes, plot-left at x = 0 and its top at y = 0 (`box`: their bounds), or null when
 * hidden or without a time to count at. `W` is the plot's width.
 */
export function riskTableBlock(
  fonts: Parameters<typeof layoutText>[0],
  palette: readonly string[],
  spec: RiskTable | undefined,
  x: AxisPlan,
  rows: readonly RiskRow[],
  W: number,
): { nodes: SceneNode[]; box: Box } | null {
  if (!spec?.show || !rows.length) return null
  const at = (spec.times ?? x.ticks.map((t) => tickValue(x, t.pos)))
    .map((t) => ({ t, px: x.toPx(t) }))
    .filter((p) => Number.isFinite(p.px) && p.px >= -0.5 && p.px <= W + 0.5)
  if (!at.length) return null
  const style = resolveText(x.labels.style, spec.text)
  const target: StylePath = ['riskTable']
  const lineH = (rt: RichText) => {
    const t = layoutText(fonts, rt, style)
    return t.ascent + t.descent
  }
  const nodes: SceneNode[] = []
  let y = 0
  const titleText = spec.title ?? RISK_TABLE_TITLE
  const names = spec.names !== false
  // The names end clear of the first column's counts (centred under its tick).
  const counts = rows.map((r) =>
    numberAtRisk(
      r.subjects,
      at.map((p) => p.t),
    ),
  )
  const widest = Math.max(
    0,
    ...counts.map((c) => layoutText(fonts, [{ text: String(c[0]) }], style).width),
  )
  const nameEnd = Math.min(-NAME_GAP, at[0]!.px - widest / 2 - NAME_GAP)
  const nameLeft = names
    ? Math.min(0, ...rows.map((r) => nameEnd - layoutText(fonts, r.name, style).width))
    : 0
  if (titleText) {
    const title: RichText = [{ text: titleText }]
    const t = placeText(
      fonts,
      'riskTable/title',
      title,
      { ...style, bold: true },
      palette,
      nameLeft,
      y,
      'start',
      'top',
      { target },
    )
    nodes.push(t.node)
    y += lineH(title) + ROW_GAP * 2
  }
  rows.forEach((r, k) => {
    const color = { rgb: r.color }
    const rowStyle = spec.text?.color ? style : { ...style, color }
    if (names) {
      const t = placeText(
        fonts,
        `riskTable/${r.key}/name`,
        r.name,
        rowStyle,
        palette,
        nameEnd,
        y,
        'end',
        'top',
        { target },
      )
      nodes.push(t.node)
    }
    at.forEach((p, i) => {
      const t = placeText(
        fonts,
        `riskTable/${r.key}/${i}`,
        [{ text: String(counts[k]![i]) }],
        rowStyle,
        palette,
        p.px,
        y,
        'middle',
        'top',
        { target },
      )
      nodes.push(t.node)
    })
    y += lineH(r.name) + ROW_GAP
  })
  const box = unionBoxes(nodes.map((n) => n.bbox ?? null)) ?? { x: 0, y: 0, w: 0, h: 0 }
  return { nodes: [{ id: 'riskTable', target, children: nodes, bbox: box }], box }
}
