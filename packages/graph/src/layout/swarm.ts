import { minMax } from '../minMax.ts'

// Swarms (beeswarms): a column of points spread sideways so their symbols don't overlap. Placement
// only (geometry in points), used by the points geom; moved out of `data.ts` (audit 2, G12).

/**
 * A swarm of more points than this, crowded, is spread evenly instead (roadmap 34e; 1,000 since
 * audit 2 P1, was 10,000: a crowded swarm of 9,999 took a second to place, 11.6 s for a
 * column export of 20,000 rows). Up to it, a swarm placed point by point takes milliseconds.
 */
export const SWARM_MAX_POINTS = 1000

/**
 * Whether some band one diameter high holds four times the points a row of the width can (each
 * of `ys` standing for `weight` points: an even sample of a larger swarm's).
 */
function crowded(
  ys: readonly number[],
  diameter: number,
  maxHalfWidth: number,
  weight = 1,
): boolean {
  const sorted = Float64Array.from(ys).sort()
  const room = 4 * Math.max(1, (2 * maxHalfWidth) / diameter)
  for (let i = 0, j = 0; j < sorted.length; j++) {
    while (sorted[j]! - sorted[i]! > diameter) i++
    if ((j - i + 1) * weight > room) return true
  }
  return false
}

/** Placed points of one x slot (one diameter wide), in ascending y. */
interface SwarmSlot {
  xs: number[]
  ys: number[]
  /** The first point less than one diameter below the current one (those before can't collide). */
  from: number
}

/**
 * Horizontal offsets for a column of points so symbols don't overlap (a deterministic, compact
 * "beeswarm"). `ys` are point positions in points; returns x offsets in points. Points are placed
 * from the lowest up, each at the free position nearest the centre line given the points already
 * placed within one diameter vertically, alternating sides on ties so equal values fan out evenly.
 * A swarm wider than ±maxHalfWidth is compressed to fit (symbols then overlap).
 *
 * A point's walk out from the centre passes the points in the band one diameter below it, so a
 * swarm costs its points times its bands' (audit 2, P1). A crowded swarm of more than
 * `SWARM_MAX_POINTS` (a band holding over four rows of the width) is spread evenly instead, so a
 * larger swarm placed point by point has bands bounded by its width: linear in its points.
 */
export function swarmOffsets(
  ys: readonly number[],
  diameter: number,
  maxHalfWidth: number,
  /**
   * The points the swarm stands for: more than `ys` when they are an even sample of them (on
   * screen, decision 450), so the sample is spread as the whole swarm is (in exports).
   */
  of: number = ys.length,
): number[] {
  const out = new Array<number>(ys.length).fill(0)
  if (!(diameter > 0)) return out
  // Roadmap 34e: so many points close together that the swarm would be a solid band many times
  // over (and take quadratic time to place): spread evenly across the width instead, by a
  // low-discrepancy sequence.
  const weight = ys.length ? of / ys.length : 1
  if (of > SWARM_MAX_POINTS && crowded(ys, diameter, maxHalfWidth, weight)) {
    for (let i = 0; i < ys.length; i++)
      out[i] = ((((i + 1) * 0.6180339887) % 1) * 2 - 1) * maxHalfWidth
    return out
  }
  const order = ys.map((y, i) => [y, i] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1])
  // Symbols may touch; a hair of overlap from rounding is not visible.
  const d = diameter * 0.99
  const eps = 1e-9 * diameter
  // Placed points by x slot (width d), each slot in ascending y.
  const slots = new Map<number, SwarmSlot>()
  /**
   * The free position nearest `start` on one side of it: while placed points block the current
   * position (it lies inside the interval about one where a symbol at this y would overlap it),
   * step to the farthest end of those intervals on that side. Walks start at 0, or for a value
   * equal to the previous one at the edge of the points already holding that value (every
   * position up to there is taken), so long runs of ties stay linear. Nothing is allocated per
   * step (audit 2, P1).
   */
  const walk = (y: number, dir: 1 | -1, start: number) => {
    let x = start
    for (;;) {
      const j = Math.floor(x / d)
      let found = false
      let next = 0
      for (let s = j - 1; s <= j + 1; s++) {
        const slot = slots.get(s)
        if (!slot) continue
        const { xs, ys: sy } = slot
        let k = slot.from
        while (k < sy.length && sy[k]! <= y - d) k++
        slot.from = k
        for (; k < sy.length; k++) {
          const px = xs[k]!
          const h = Math.sqrt(Math.max(0, d * d - (y - sy[k]!) ** 2))
          if (!(px - h + eps < x && x < px + h - eps)) continue
          const end = dir > 0 ? px + h : px - h
          next = !found ? end : dir > 0 ? Math.max(next, end) : Math.min(next, end)
          found = true
        }
      }
      if (!found) return x
      x = next
    }
  }
  // Side of the last point placed off the centre line; ties go to the other side.
  let last = -1
  // Extent of the points placed at the current (equal) value.
  let tie = { y: Number.NaN, min: 0, max: 0 }
  for (const [y, i] of order) {
    if (y !== tie.y) tie = { y, min: 0, max: 0 }
    const right = walk(y, 1, Math.max(0, tie.max))
    let x = 0
    if (right !== 0) {
      const left = walk(y, -1, Math.min(0, tie.min))
      // Equally near on both sides (equal values): opposite the last one, so they fan out evenly.
      if (Math.abs(right + left) < eps) x = last < 0 ? right : left
      else x = right < -left ? right : left
      last = Math.sign(x)
    }
    tie.min = Math.min(tie.min, x)
    tie.max = Math.max(tie.max, x)
    const at = Math.floor(x / d)
    const slot = slots.get(at)
    if (slot) {
      slot.xs.push(x)
      slot.ys.push(y)
    } else slots.set(at, { xs: [x], ys: [y], from: 0 })
    out[i] = x
  }

  const widest = Math.max(0, minMax(out.map(Math.abs))[1])
  if (widest > maxHalfWidth && widest > 0) {
    const k = maxHalfWidth / widest
    for (let i = 0; i < out.length; i++) out[i]! *= k
  }
  return out
}
