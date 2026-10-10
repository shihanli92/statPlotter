import type { LayerOf } from '@ps/model'
import { centerOf } from '../../data.ts'
import { resolveStroke } from '../../theme.ts'
import type { CategorySlot } from '../frames/category.ts'
import type { GroupedCell } from '../frames/grouped.ts'
import { ownField } from '../theme.ts'
import { nesting } from './points.ts'

// Centre lines: a short line at a summary (the group's, or each subject's of a nested group).

/** A data set's centre line in its category (category frame); by subject: one per subject. */
export function categoryCenter(c: CategorySlot, layer: LayerOf<'center'>): void {
  if (layer.stat.by === 'subject') {
    subjectMeans(c, layer)
    return
  }
  const { kit, key, x0, band, target, color, stats } = c
  const { ok: inPlot, point: yPoint } = c.Y
  const style = kit.style(layer, key)
  const center = centerOf(stats, style.center.stat)
  if (!inPlot(center)) return
  const { sideBySide, span } = nesting(c, layer, style)
  // Subjects side by side: unless set, the group's line spans its subjects.
  const explicit = ownField(layer, key, 'width')
  const w = (explicit === undefined && sideBySide ? span / band : style.center.width) * band
  const cy = yPoint(center)
  if (!Number.isFinite(cy)) return
  kit.add(layer, key, {
    id: `series/${key}/${kit.part(layer, key, 'center')}`,
    target: [...target, 'center'],
    prim: {
      type: 'line',
      x1: x0 - w / 2,
      y1: cy,
      x2: x0 + w / 2,
      y2: cy,
      stroke: resolveStroke(style.center.line, kit.palette, color),
    },
    bbox: { x: x0 - w / 2, y: cy - 2, w, h: 4 },
  })
  c.touch(cy)
}

/** A cell's centre line in its slot (grouped frame). */
export function groupedCenter(g: GroupedCell, layer: LayerOf<'center'>): void {
  const { kit, key, c, color, tRow, r } = g
  const { ok, point: yPoint } = g.axis
  const style = kit.style(layer, key)
  const center = centerOf(c, style.center.stat)
  if (g.hidden || !ok(center)) return
  const { sub, cx } = g.slots(layer)
  const x0 = cx(g.gi, g.si)
  const w = style.center.width * sub
  const cy = yPoint(center)
  if (!Number.isFinite(cy)) return
  kit.add(
    layer,
    key,
    g.mark({
      id: `series/${key}/${kit.part(layer, key, 'center')}/${tRow(r)}`,
      target: [...g.target, 'center'],
      prim: {
        type: 'line',
        x1: x0 - w / 2,
        y1: cy,
        x2: x0 + w / 2,
        y2: cy,
        stroke: resolveStroke(style.center.line, kit.palette, color),
      },
    }),
  )
  g.top = Math.min(g.top, cy)
}

/** Each subject's mean: a short line over its points (nested groups). */
function subjectMeans(c: CategorySlot, layer: LayerOf<'center'>): void {
  const { kit, key, band, target } = c
  const { ok: inPlot, point: yPoint } = c.Y
  const style = kit.style(layer, key)
  const { nest, m, sideBySide, span, subX, subjectLook } = nesting(c, layer, style)
  if (!nest) return
  const w = sideBySide ? (span / m) * 0.8 : band * 0.35
  const part = kit.part(layer, key, 'subjectMean')
  for (const s of c.subjects) {
    const cy = inPlot(s.mean) ? yPoint(s.mean) : Number.NaN
    if (!Number.isFinite(cy)) continue
    const subject = subjectLook(s.sub)
    const sx = subX(subject.k)
    kit.add(layer, key, {
      id: `series/${key}/${part}/${s.sub}`,
      target: [...target, 'center'],
      prim: {
        type: 'line',
        x1: sx - w / 2,
        y1: cy,
        x2: sx + w / 2,
        y2: cy,
        stroke: resolveStroke(style.center.line, kit.palette, subject.color),
      },
      bbox: { x: sx - w / 2, y: cy - 2, w, h: 4 },
    })
    c.touch(cy)
  }
}
