import type { LayerOf, StrokeStyle } from '@ps/model'
import type { SceneNode } from '../../scene.ts'
import { GRAND_MEAN_LINE, resolveStroke } from '../../theme.ts'

// Reference lines: a line across the plot at a statistic (the grand mean of every value).

// The grand mean line's default look is the theme's (audit 2, G9: a style's data line width).
export { GRAND_MEAN_LINE } from '../../theme.ts'

/** A line across the plot (width W) at plot-local y; none when y isn't finite. */
export function reflineNode(
  layer: LayerOf<'refline'>,
  y: number,
  W: number,
  palette: readonly string[],
  id = 'grandMean',
  line: StrokeStyle = GRAND_MEAN_LINE,
): SceneNode[] {
  if (!Number.isFinite(y)) return []
  return [
    {
      id,
      target: ['style', 'grandMean'],
      prim: {
        type: 'line',
        x1: 0,
        y1: y,
        x2: W,
        y2: y,
        stroke: resolveStroke({ ...line, ...layer.style?.line }, palette),
      },
      bbox: { x: 0, y: y - 2, w: W, h: 4 },
    },
  ]
}
