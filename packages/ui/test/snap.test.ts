import { describe, expect, it } from 'vitest'
import { SNAP_GAP, snapMove, snapScale } from '../src/layout/snap.ts'

const page = { width: 612, height: 792 }
// A graph whose plot area starts 40 pt in from its left edge (Y labels), another at 30 pt.
const upper = { box: { x: 100, y: 100, w: 200, h: 150 }, plot: { x: 140, y: 120, w: 150, h: 100 } }
const lowerAt = (x: number, y: number) => ({
  box: { x, y, w: 190, h: 150 },
  plot: { x: x + 30, y: y + 20, w: 150, h: 100 },
})

describe('snapping while dragging on a page', () => {
  it('lines up plot left edges (not outer boxes) within the threshold', () => {
    const lower = lowerAt(112, 300) // plot left at 142: 2 pt from the upper plot's 140
    const r = snapMove(lower, [upper], page, 0, 0, 5)
    expect(lower.plot.x + r.dx).toBe(140)
    expect(r.guides.some((g) => g.axis === 'x' && g.at === 140)).toBe(true)
  })

  it('snaps a stacking gap below a neighbour', () => {
    const lower = lowerAt(110, 253) // top 253; the gap snap wants 250 + SNAP_GAP
    const r = snapMove(lower, [upper], page, 0, 0, 5)
    expect(lower.box.y + r.dy).toBe(250 + SNAP_GAP)
  })

  it('snaps to the page margin, and leaves far moves alone', () => {
    const lone = { box: { x: 38, y: 400, w: 100, h: 80 } }
    expect(snapMove(lone, [], page, 0, 0, 5).dx).toBe(-2)
    const far = snapMove(lowerAt(350, 500), [upper], page, 0, 0, 5)
    expect([far.dx, far.dy]).toEqual([0, 0])
  })

  it('snaps a resize to the same plot width as another graph', () => {
    // At scale 1 the plot is 150 wide from x+30; the other plot is 180 wide.
    const other = { box: { x: 0, y: 0, w: 1, h: 1 }, plot: { x: 100, y: 400, w: 180, h: 120 } }
    const unit = { box: { x: 0, y: 0, w: 190, h: 150 }, plot: { x: 30, y: 20, w: 150, h: 100 } }
    const r = snapScale({ x: 50, y: 50, unit }, [other], 1.19, 5)
    expect(r.scale).toBeCloseTo(1.2, 12)
    expect(r.guides).toHaveLength(1)
  })
})
